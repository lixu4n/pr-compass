// Offline deterministic selection evaluation. No model/network calls or accuracy claims.
import { build } from 'esbuild'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir = await mkdtemp(join(tmpdir(), 'compass-eval-'))
try {
 const outfile = join(dir, 'selection.mjs')
 await build({entryPoints:['tools/compass/context-selection.ts'],outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent'})
 const { selectChangedContext } = await import(pathToFileURL(outfile).href)
 const cases = JSON.parse(await readFile('evidence/context-eval/cases.json','utf8'))
 const raw = Array.from({length:250},(_,i)=>`line ${i+1}`).join('\n')
 const results = cases.filter(c=>c.kind==='selection').map(c=>{
  const selected=selectChangedContext(raw,`@@ -${c.line} +${c.line} @@`,2000).selected.map(s=>s.text).join('\n')
  const old=Buffer.from(raw).subarray(0,2000).toString()
  const score=text=>text.includes(c.mustInclude)&&!text.includes(c.mustExclude)
  return {id:c.id,baselinePass:score(old),changedContextPass:score(selected),bytes:Buffer.byteLength(selected)}
 })
 console.log(JSON.stringify({type:'synthetic-selection-regression',results,humanCasesPending:cases.filter(c=>c.kind==='human').map(c=>c.id),modelCalls:0,note:'This measures fixture selection constraints, NOT model accuracy or engineer time savings.'},null,2))
 if(results.some(r=>!r.changedContextPass))process.exitCode=1
} finally {await rm(dir,{recursive:true,force:true})}
