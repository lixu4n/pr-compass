# Compatibility note: search response contract

## Contract as of baseline

The search service returns the following shape for all queries:

```typescript
{ status: 200, body: { results: SearchResult[] } }
```

The client `interpretResponse()` function depends on this contract. It checks
`response.body.results.length` to determine whether to show the empty state.

## What breaks if status changes to 404

If the service is changed to return `404` when results are empty:

1. **`searchClient.ts`** will receive a response it does not expect. The current `SearchResponse`
   type only allows `status: 200`. The TypeScript type must be widened.
2. **`interpretResponse()`** must be updated to handle a 404-style response rather than checking
   `results.length`.
3. **Unit tests in `sample-project/tests/`** that assert `status: 200` for empty queries will
   fail and must be updated.

## What does NOT break (known callers)

As of the baseline, `searchClient.ts` is the only known consumer of `searchService.ts`.
No CLI tools, integration tests, or downstream services reference `search()` directly.

**This assessment is based on the function-level simulation only.** In a real HTTP service,
additional callers (other services, external clients) might exist and would need auditing.

## Known open question

Is HTTP 404 the right status for "valid query, zero results"?
REST conventions differ:
- Some APIs use 200 + empty list (the resource *collection* exists; it just has no matching items).
- Some APIs use 404 (no resource was found).

The choice affects client error-handling contracts, caching behavior, and any downstream consumers.
This decision needs explicit team agreement before implementing the change.
