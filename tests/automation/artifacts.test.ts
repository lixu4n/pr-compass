import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveArtifacts } from '../../tools/compass/artifacts.js'
import { makeOkBrief, makeUnavailableBrief } from './fixtures.js'
import { render } from '../../tools/compass/render.js'

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
async function outputFolder() {
  const folder = await mkdtemp(join(tmpdir(), 'compass-artifact-test-'))
  folders.push(folder)
  return join(folder, 'output')
}

describe('inspectable local artifacts', () => {
  it('writes the exact brief and comment under a commit-specific run directory', async () => {
    const brief = makeOkBrief()
    const markdown = render(brief)
    const result = await saveArtifacts(brief, markdown, await outputFolder())
    expect(result.directory).toContain(`test-org-test-repo-pr42-${brief.provenance.headCommitSha}-`)
    expect(JSON.parse(await readFile(result.jsonPath, 'utf8'))).toEqual(brief)
    expect(await readFile(result.markdownPath, 'utf8')).toBe(markdown)
    expect((await stat(result.jsonPath)).mode & 0o777).toBe(0o600)
  })

  it('does not overwrite an earlier run on the same commit', async () => {
    const brief = makeOkBrief()
    const folder = await outputFolder()
    const first = await saveArtifacts(brief, 'First', folder)
    const second = await saveArtifacts(brief, 'Second', folder)
    expect(first.directory).not.toBe(second.directory)
    expect(await readFile(first.markdownPath, 'utf8')).toBe('First')
    expect(await readFile(second.markdownPath, 'utf8')).toBe('Second')
  })

  it('also preserves unavailable output without inventing a successful report', async () => {
    const brief = makeUnavailableBrief('No completed analysis.')
    const result = await saveArtifacts(brief, render(brief), await outputFolder())
    expect(JSON.parse(await readFile(result.jsonPath, 'utf8')).status).toBe('unavailable')
    expect(await readFile(result.markdownPath, 'utf8')).toContain('Context brief unavailable')
  })

  it('rejects unsafe provenance before constructing filesystem paths', async () => {
    const brief = makeOkBrief()
    brief.provenance.repository = '../../escape'
    await expect(saveArtifacts(brief, 'text', await outputFolder())).rejects.toThrow(/Invalid artifact provenance/)
    brief.provenance.repository = 'test-org/test-repo'
    brief.provenance.headCommitSha = '../escape'
    await expect(saveArtifacts(brief, 'text', await outputFolder())).rejects.toThrow(/Invalid artifact provenance/)
  })
})
