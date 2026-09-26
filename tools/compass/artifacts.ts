/** Persist an inspectable result before any optional GitHub write. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ContextBrief } from '../../src/types/ContextBrief.js'

export async function saveArtifacts(brief: ContextBrief, markdown: string, outputRoot: string) {
  const repository = brief.provenance.repository
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      repository.split('/').some((part) => part === '.' || part === '..' || part.length > 100) ||
      !/^[0-9a-f]{40}$/i.test(brief.provenance.headCommitSha) ||
      !Number.isSafeInteger(brief.provenance.prNumber) || brief.provenance.prNumber < 1) {
    throw new Error('Invalid artifact provenance; refusing to construct output paths.')
  }
  const root = resolve(outputRoot)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const prefix = `${repository.replace('/', '-')}-pr${brief.provenance.prNumber}-${brief.provenance.headCommitSha}-`
  const directory = await mkdtemp(join(root, prefix))
  const jsonPath = join(directory, 'context-brief.json')
  const markdownPath = join(directory, 'context-comment.md')
  await writeFile(jsonPath, JSON.stringify(brief, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await writeFile(markdownPath, markdown, { encoding: 'utf8', mode: 0o600 })
  return { directory, jsonPath, markdownPath }
}
