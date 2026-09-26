/**
 * SearchService — function-level simulation (not a running HTTP server).
 *
 * Baseline behavior (on main):
 *   - A search with no results returns status 200 and an empty list.
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
 * Always returns status 200; an empty or unmatched query returns an empty list.
 */
export function search(query: string): SearchResponse {
  const q = query.trim().toLowerCase()
  const results =
    q.length === 0
      ? []
      : DOCUMENTS.filter(
          (doc) =>
            doc.title.toLowerCase().includes(q)
        )

  return {
    status: 200,
    body: { results },
  }
}