# sample-project

A function-level TypeScript simulation of a search service and its client.

**This is not a running HTTP server.** It contains plain TypeScript modules that can be called
directly. The "responses" are plain data objects that mimic what an HTTP handler would return.

## Purpose

This project exists to give the team a real, committable codebase that can serve as the subject
of a pull request analyzed by the `review-brief` Bob skill.

## Modules

- `src/searchService.ts` — simulates a search endpoint. Accepts a query string, returns a
  `SearchResponse` with `status: 200` and `body: { results: [...] }`.
- `src/searchClient.ts` — interprets a `SearchResponse` into a `DisplayState` (results or empty).

## Running the tests

From the repository root:

```bash
npm test
```

Tests for the sample project are in `sample-project/tests/` and are included in the root Vitest run.

## Baseline behavior

- A query with no matching documents: `status: 200`, `body: { results: [] }`.
- The client displays "No results found."

## The proposed change (not yet implemented)

A future PR will change the no-results response to HTTP 404.
See `docs/sample-context/compatibility.md` for the compatibility analysis.
