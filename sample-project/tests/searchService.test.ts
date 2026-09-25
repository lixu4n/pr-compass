import { describe, it, expect } from 'vitest'
import { search } from '../src/searchService'

describe('search — baseline behavior', () => {
  it('returns status 200 for a query with no results', () => {
    const response = search('zzz-no-match')
    expect(response.status).toBe(200)
  })

  it('returns an empty results array for a query with no matches', () => {
    const response = search('zzz-no-match')
    expect(response.body.results).toEqual([])
  })

  it('returns status 200 for a query with results', () => {
    const response = search('changelog')
    expect(response.status).toBe(200)
  })

  it('returns matching documents for a known query', () => {
    const response = search('api')
    expect(response.body.results.length).toBeGreaterThan(0)
    expect(response.body.results[0].title).toBe('API reference')
  })

  it('is case-insensitive', () => {
    const lower = search('getting started')
    const upper = search('GETTING STARTED')
    expect(lower.body.results).toEqual(upper.body.results)
  })

  it('returns empty list for a blank query', () => {
    const response = search('   ')
    expect(response.body.results).toEqual([])
  })
})
