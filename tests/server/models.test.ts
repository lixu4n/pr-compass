import { describe, it, expect, vi } from 'vitest'
import { analyzeWithModel } from '../../tools/server/models.js'
import { settings, collection, brief } from './fixtures.js'
const { status, purpose, relevantContext, readingOrder, limitations, unavailableReason } = brief
const modelOutput = { status, purpose, relevantContext, readingOrder, limitations, unavailableReason }
function response(status = 'completed', output = JSON.stringify(modelOutput)) {
  return new Response(JSON.stringify({ status, output: [{ type: 'message', content: [{ type: 'output_text', text: output }] }], usage: { input_tokens: 42, output_tokens: 20 } }))
}
describe('OpenAI adapter', () => {
  it('uses one bounded stateless request and validates citations before assembly', async () => {
    const fetcher = vi.fn(async () => response()) as unknown as typeof fetch
    const result = await analyzeWithModel(collection, 'Return JSON.', settings, 'secret-key', 'bob', fetcher)
    expect(result.brief.provenance.headCommitSha).toBe(collection.headSha)
    expect(result.usage.inputTokens).toBe(42)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetcher).mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(JSON.parse(String(init?.body))).toMatchObject({ store: false, tools: [], max_output_tokens: 2048 })
    expect(String(init?.body)).not.toContain('secret-key')
  })
  it('rejects an incomplete response rather than treating output as successful', async () => {
    const fetcher = vi.fn(async () => response('incomplete')) as unknown as typeof fetch
    await expect(analyzeWithModel(collection, 'Return JSON.', settings, 'key', 'bob', fetcher)).rejects.toThrow('incomplete')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not expose provider error bodies or retry paid calls', async () => {
    const fetcher = vi.fn(async () => new Response('private-code-and-key', { status: 429 })) as unknown as typeof fetch
    await expect(analyzeWithModel(collection, 'Return JSON.', settings, 'key', 'bob', fetcher)).rejects.toThrow('HTTP 429')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects invented source identifiers', async () => {
    const bad = { ...modelOutput, purpose: { ...purpose, sourceId: 'made-up' } }
    const fetcher = vi.fn(async () => response('completed', JSON.stringify(bad))) as unknown as typeof fetch
    await expect(analyzeWithModel(collection, 'Return JSON.', settings, 'key', 'bob', fetcher)).rejects.toThrow('source-linked')
  })
})
