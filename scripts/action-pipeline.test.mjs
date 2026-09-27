// Offline integration of the real packaged CLI. HTTP and Bob are synthetic;
// unexpected network/subprocess operations are blocked, not sent externally.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const MARKER = '<!-- compass:context-brief:v1 -->'

async function exercise(scenario, publish = false) {
  const root = await mkdtemp(join(tmpdir(), 'compass-pipeline-test-'))
  try {
    const packageDir = join(root, 'package')
    await cp(new URL('../action-dist/', import.meta.url), packageDir, { recursive: true })
    const home = join(root, 'home')
    const cwd = join(root, 'working-directory')
    await mkdir(home)
    await mkdir(cwd)
    const bob = join(root, 'fake-bob')
    const requestsPath = join(root, 'requests.jsonl')
    const prompt = {
      status: 'ok', purpose: { summary: 'Synthetic test: explain a renamed helper.', basis: 'declared', sourceId: 'pr-1' },
      relevantContext: [{ statement: 'The changed helper returns a value.', basis: 'inferred', sourceIds: ['src-3'] }],
      readingOrder: [{ order: 1, label: 'src/example.ts', reason: 'Start with the changed helper.', sourceId: 'src-3' }],
      limitations: [], unavailableReason: null,
    }
    await writeFile(bob, `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('Bob Shell 2.0.5'); process.exit(0); }
if (args[1] === '--help') {
  console.log('--format --workspace --mode --max-cost --max-turns --log-level --disable-mcp --disable-subagents --disable-tool-groups --accept-license');
  process.exit(0);
}
if (args[0] !== 'run' || !args.includes('--disable-tool-groups')) process.exit(2);
process.stdin.resume();
process.stdin.on('end', () => console.log(JSON.stringify(${JSON.stringify({
      type: 'result', status: scenario === 'unavailable' ? 'error' : 'success', last_message: JSON.stringify(prompt),
    })})));
`, { mode: 0o700 })

    const hook = join(root, 'fake-services.mjs')
    await writeFile(hook, `
import { appendFileSync } from 'node:fs';
import cp from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const forbidden = () => { throw new Error('Unexpected network or subprocess in offline pipeline test'); };
const originalSpawn = cp.spawn;
cp.spawn = function(command, args, options) {
  if (command !== ${JSON.stringify(bob)}) return forbidden();
  return originalSpawn(command, args, options);
};
for (const key of ['spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = forbidden;
net.connect = net.createConnection = forbidden;
net.Socket.prototype.connect = forbidden;
tls.connect = forbidden;
http.request = http.get = https.request = https.get = forbidden;
syncBuiltinESMExports();
let head = ${JSON.stringify(HEAD)};
const base = ${JSON.stringify(BASE)};
const root = '/repos/owner/repo';
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json'}});
globalThis.fetch = async (input, init) => {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  appendFileSync(${JSON.stringify(requestsPath)}, JSON.stringify({method, path:url.pathname, body}) + '\\n');
  if (url.origin === 'https://api.openai.com' && ${JSON.stringify(scenario)} === 'openai') return json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:${JSON.stringify(JSON.stringify(prompt))}}]}],usage:{input_tokens:100,output_tokens:50}});
  if (url.origin !== 'https://api.github.com') return forbidden();
  if (method === 'POST' && url.pathname === root + '/check-runs') return json({id:55},201);
  if (method === 'PATCH' && url.pathname === root + '/check-runs/55') return json({id:55});
  if (method === 'GET' && url.pathname === root + '/pulls/42') return json({
    number:42,title:'Synthetic integration PR',body:'Rename an example helper.',state:'open',draft:false,
    user:{login:'synthetic-author',type:'User'},html_url:'https://github.com/owner/repo/pull/42',
    base:{sha:base,ref:'main',repo:{full_name:'owner/repo',private:false}},
    head:{sha:head,ref:'feature',repo:{full_name:'owner/repo',private:false}}
  });
  if (method === 'GET' && url.pathname === root + '/pulls/42/files') return json([{
    filename:'src/example.ts',status:'modified',additions:1,deletions:1,changes:2,sha:head,
    patch:'@@ -1 +1 @@\\n-export const oldName = 1\\n+export const newName = 1',
    blob_url:'https://github.com/owner/repo/blob/' + head + '/src/example.ts',contents_url:''
  }]);
  if (method === 'GET' && url.pathname === root + '/compare/' + base + '...' + head) return json({merge_base_commit:{sha:base}});
  if (method === 'GET' && decodeURIComponent(url.pathname) === root + '/contents/src/example.ts') return json({
    type:'file',content:Buffer.from('export const newName = 1').toString('base64'),encoding:'base64',size:24,sha:head,html_url:null
  });
  if (method === 'GET' && url.pathname.startsWith(root + '/contents/')) return json({message:'Not Found'},404);
  if (method === 'GET' && url.pathname === root + '/issues/42/comments') {
    if (${JSON.stringify(scenario)} === 'stale') head = 'c'.repeat(40);
    return json(${JSON.stringify(scenario)} === 'openai' ? [
      {id:70,body:${JSON.stringify(MARKER)}+'\\nOld Actions brief',user:{login:'github-actions[bot]'}},
      {id:71,body:${JSON.stringify(MARKER)}+'\\nOld North brief',user:{login:'compass-by-north[bot]'}}
    ] : []);
  }
  if (method === 'POST' && url.pathname === root + '/issues/42/comments') return json({
    id:123,body:body.body,user:{login:'github-actions[bot]'}
  },201);
  if (method === 'PATCH' && url.pathname === root + '/issues/comments/71') return json({id:71});
  return forbidden();
};
`, 'utf8')

    const outputDir = join(root, 'reports')
    const run = spawnSync(process.execPath, [
      '--import', hook, join(packageDir, 'index.mjs'),
    ], {
      cwd,
      env: {
        PATH: dirname(process.execPath), HOME: home, TMPDIR: root,
        INPUT_OWNER: 'owner', INPUT_REPO: 'repo', INPUT_PR_NUMBER: '42',
        GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'synthetic-actions-token',
        BOB_API_KEY: 'synthetic-test-key', BOB_PATH: bob,
        COMPASS_ACCEPT_BOB_LICENSE: 'true', COMPASS_OUTPUT_DIR: outputDir,
        ...(scenario === 'openai' ? {COMPASS_APP_SLUG:'compass-by-north',COMPASS_PROVIDER:'openai',OPENAI_API_KEY:'synthetic-openai-key',COMPASS_PROGRESS:'true',COMPASS_HEAD_SHA:HEAD} : {}),
        // Omitting the flag exercises the safer default dry-run behavior.
        ...(publish ? { COMPASS_DRY_RUN: 'false' } : {}),
      },
      encoding: 'utf8', timeout: 15_000, maxBuffer: 200_000,
    })
    assert.ifError(run.error)
    assert.doesNotMatch(run.stderr, /Unexpected network or subprocess/)
    const requests = (await readFile(requestsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    const folders = await readdir(outputDir)
    assert.equal(folders.length, 1)
    const brief = JSON.parse(await readFile(join(outputDir, folders[0], 'context-brief.json'), 'utf8'))
    const markdown = await readFile(join(outputDir, folders[0], 'context-comment.md'), 'utf8')
    return { run, requests, brief, markdown }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('packaged dry-run saves inspectable output and makes no GitHub writes', async () => {
  const { run, requests, brief, markdown } = await exercise('success')
  assert.equal(run.status, 0, run.stderr)
  assert.equal(brief.provenance.headCommitSha, HEAD)
  assert.equal(brief.status, 'ok')
  assert.ok(markdown.startsWith(MARKER))
  assert.match(markdown, /Synthetic test/)
  assert.match(run.stdout, /JSON saved to/)
  assert.ok(requests.every((request) => request.method === 'GET'))
})

test('packaged write flow uses the Actions identity without GET /user', async () => {
  const { run, requests } = await exercise('success', true)
  assert.equal(run.status, 0, run.stderr)
  const writes = requests.filter((request) => request.method !== 'GET')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].path, '/repos/owner/repo/issues/42/comments')
  assert.ok(writes[0].body.body.startsWith(MARKER))
  assert.ok(!requests.some((request) => request.path === '/user'))
})

test('packaged stale run keeps its local artifact but does not publish', async () => {
  const { run, requests, brief } = await exercise('stale', true)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /Stale analysis/)
  assert.equal(brief.provenance.headCommitSha, HEAD)
  assert.ok(requests.every((request) => request.method === 'GET'))
})

test('packaged failed analysis produces unavailable output and a failed job, not a success verdict', async () => {
  const { run, requests, brief, markdown } = await exercise('unavailable', true)
  assert.equal(run.status, 1)
  assert.equal(brief.status, 'unavailable')
  assert.match(markdown, /Context brief unavailable/)
  assert.ok(requests.some((request) => request.method === 'POST' && request.body.body.includes('Context brief unavailable')))
})

 test('packaged OpenAI flow makes one inference and reports progress through publication', async () => {
  const {run, requests, brief} = await exercise('openai', true)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(brief.status, 'ok')
  const inference = requests.filter(r => r.path === '/v1/responses')
  assert.equal(inference.length, 1)
  assert.equal(inference[0].body.store, false)
  assert.deepEqual(inference[0].body.tools, [])
  const checks = requests.filter(r => r.path.includes('/check-runs'))
  assert.deepEqual(checks.map(r => r.body.output.title), ['Gathering context', 'Analyzing context', 'Posting comment', 'Brief posted'])
  assert.equal(checks.at(-1).body.conclusion, 'success')
  assert.equal(requests.filter(r => r.method === 'POST' && r.path.endsWith('/comments')).length, 0)
  assert.equal(requests.filter(r => r.method === 'PATCH' && r.path.endsWith('/comments/71')).length, 1)
})
