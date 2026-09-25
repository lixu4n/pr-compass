/**
 * SearchService — function-level simulation (not a running HTTP server).
 *
 * This is a plain TypeScript module. It simulates search-service behavior
 * through direct function calls, not via HTTP. There is no express/http
 * server here; the "response" objects are plain data structures that mimic
 * what an HTTP handler would return.
 *
 * Baseline behavior (current, on `main`):
 *   - A query that matches no documents returns status 200 and an empty list.
 *
 * A future PR will propose changing this so that no results → 404.
 * That change is NOT implemented here. Git will preserve this baseline.
 */

export interface SearchResponse {
  status: 200
  body: { results: SearchResult[] }
}

export interface SearchResult {
  id: string
  title: string
  snippet: string
}

/** In-memory document store for the simulation. */
const DOCUMENTS: SearchResult[] = [
  { id: '1', title: 'Getting started', snippet: 'How to install and configure the service.' },
  { id: '2', title: 'API reference',   snippet: 'Full list of endpoints and parameters.' },
  { id: '3', title: 'Changelog',       snippet: 'Recent changes and migration notes.' },
]

/**
 * Simulates a search query against the in-memory document store.
 *
 * Baseline: always returns 200.
 * - If documents match, body.results is non-empty.
 * - If no documents match, body.results is an empty array.
 */
export function search(query: string): SearchResponse {
  const q = query.trim().toLowerCase()
  const results =
    q.length === 0
      ? []
      : DOCUMENTS.filter(
          (doc) =>
            doc.title.toLowerCase().includes(q) ||
            doc.snippet.toLowerCase().includes(q),
        )

  return {
    status: 200,
    body: { results },
  }
}
