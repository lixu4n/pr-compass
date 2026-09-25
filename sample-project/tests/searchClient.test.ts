import { describe, it, expect } from 'vitest'
import { interpretResponse, formatDisplay } from '../src/searchClient'
import type { SearchResponse } from '../src/searchService'

describe('interpretResponse', () => {
  it('returns empty state when results array is empty', () => {
    const response: SearchResponse = { status: 200, body: { results: [] } }
    expect(interpretResponse(response)).toEqual({ kind: 'empty' })
  })

  it('returns results state when results are present', () => {
    const response: SearchResponse = {
      status: 200,
      body: {
        results: [{ id: '1', title: 'Foo', snippet: 'Bar' }],
      },
    }
    const state = interpretResponse(response)
    expect(state.kind).toBe('results')
    if (state.kind === 'results') {
      expect(state.items).toHaveLength(1)
      expect(state.items[0].id).toBe('1')
    }
  })
})

describe('formatDisplay', () => {
  it('returns "No results found." for empty state', () => {
    expect(formatDisplay({ kind: 'empty' })).toBe('No results found.')
  })

  it('formats result items as readable lines', () => {
    const state = {
      kind: 'results' as const,
      items: [{ id: '2', title: 'API reference', snippet: 'Full list of endpoints.' }],
    }
    expect(formatDisplay(state)).toContain('API reference')
    expect(formatDisplay(state)).toContain('[2]')
  })
})
