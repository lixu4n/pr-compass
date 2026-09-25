/**
 * SearchService — function-level simulation (not a running HTTP server).
 *
 * This is a plain TypeScript module. It simulates search-service behavior
 * through direct function calls, not via HTTP. There is no express/http
 * server here; the "response" objects are plain data structures that mimic
 * what an HTTP handler would return.
 *
 * Changed behavior (on feat/404-empty-search):
 *   - A query that matches no documents returns status 404 and an error body.
 *   - A query that matches documents still returns status 200 and a results list.
 *
 * Baseline behavior (on main):
 *   - A search with no results returns status 200 and an empty list.
 */

export interface SearchResponseOk {
  status: 200
  body: { results: SearchResult[] }
}

export interface SearchResponseNotFound {
  status: 404
  body: { error: string }
}

export type SearchResponse = SearchResponseOk | SearchResponseNotFound

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
 * Changed: returns 404 when no results are found (including blank query).
 * Returns 200 only when at least one result matches.
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

  if (results.length === 0) {
    return {
      status: 404,
      body: { error: 'No results found' },
    }
  }

  return {
    status: 200,
    body: { results },
  }
}
