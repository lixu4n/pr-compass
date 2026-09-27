import { describe, it, expect } from 'vitest'
import { selectChangedContext } from '../../tools/compass/context-selection.js'

describe('change-aware context selection', () => {
  it('includes a late changed function rather than an unrelated file prefix', () => {
    const raw = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join('\n')
    const result = selectChangedContext(raw, '@@ -200,1 +200,1 @@', 2000)
    expect(result.selected[0].start).toBe(188)
    expect(result.selected[0].text).toContain('line 200')
    expect(result.selected[0].text).not.toContain('line 1\n')
    expect(result.partial).toBe(true)
  })
  it('merges overlapping neighborhoods without duplicating evidence', () => {
    const result = selectChangedContext('a\n'.repeat(100), '@@ -20 +20 @@\n@@ -25 +25 @@', 2000)
    expect(result.selected).toHaveLength(1)
    expect(result.selected[0]).toMatchObject({ start: 8, end: 37 })
  })
  it('never exceeds the UTF-8 budget or cuts a source line', () => {
    const result = selectChangedContext('éé\nhello\nworld', undefined, 6)
    expect(result.selected[0].text).toBe('éé')
    expect(Buffer.byteLength(result.selected.map(s => s.text).join(''))).toBeLessThanOrEqual(6)
  })
  it('handles an empty budget without inventing source text', () => {
    expect(selectChangedContext('hello', '@@ -1 +1 @@', 0).selected).toEqual([])
  })
})
