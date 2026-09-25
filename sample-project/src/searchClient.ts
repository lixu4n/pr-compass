/**
 * SearchClient — consumes SearchService responses.
 *
 * This is a plain TypeScript module (not a browser or HTTP client).
 * It models what a UI layer or downstream consumer would do with
 * the response returned by search().
 */

import type { SearchResponse, SearchResult } from './searchService'

export type DisplayState =
  | { kind: 'results'; items: SearchResult[] }
  | { kind: 'empty' }

/**
 * Interprets a SearchResponse and returns a display state.
 *
 * Baseline: the service always returns 200, so the client distinguishes
 * results from empty solely by checking the results array length.
 *
 * When the service changes to return 404 for no results, this function
 * will need to be updated to handle the new response shape.
 */
export function interpretResponse(response: SearchResponse): DisplayState {
  if (response.body.results.length === 0) {
    return { kind: 'empty' }
  }
  return { kind: 'results', items: response.body.results }
}

/**
 * Returns a human-readable message for a given display state.
 * Useful for rendering in a UI or CLI output.
 */
export function formatDisplay(state: DisplayState): string {
  if (state.kind === 'empty') {
    return 'No results found.'
  }
  return state.items.map((r) => `[${r.id}] ${r.title}: ${r.snippet}`).join('\n')
}
