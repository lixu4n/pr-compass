# Sample task: search-service response contract

## Context

The search service (`sample-project/src/searchService.ts`) is a function-level simulation of a
REST-like search endpoint. It is used as the subject for PR Compass analysis exercises.

## Baseline behavior (current, on `main`)

- A search query that matches no documents returns `status: 200` and `body: { results: [] }`.
- The client (`searchClient.ts`) checks `results.length === 0` to display an empty state.
- There are no other known callers.

## Proposed change (not yet implemented)

A team member is considering changing the no-results response to `status: 404` with
`body: { error: "No results found" }`, on the grounds that "no resource was found."

This change has not been implemented. The baseline is what is currently in the repository.

## How to proceed

See `README.md` → "Next steps: creating the real sample PR" for the exact git commands to:
1. Commit the baseline.
2. Create a branch.
3. Implement the change.
4. Open a PR.
5. Analyze it with `/review-brief`.
