/** Select actual changed-line neighborhoods, never execute or import target code. */
export function selectChangedContext(raw: string, patch: string | undefined, maxBytes: number, radius = 12) {
  const lines = raw.split('\n')
  const starts = [...(patch ?? '').matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
  const ranges: [number, number][] = starts.map((m): [number, number] => {
    const start = Math.min(lines.length, Math.max(1, Number(m[1])))
    return [Math.max(1, start - radius), Math.min(lines.length, start + Math.max(1, Number(m[2] ?? 1)) - 1 + radius)]
  }).sort((a, b) => a[0] - b[0])
  if (!ranges.length) ranges.push([1, Math.min(lines.length, 2 * radius + 1)])
  const merged: [number, number][] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1])
    else merged.push([...range])
  }
  const selected: { start: number; end: number; text: string }[] = []
  let used = 0
  for (const [start, end] of merged) {
    const kept: string[] = []
    for (let n = start; n <= end; n++) {
      const text = lines[n - 1]
      const bytes = Buffer.byteLength(text + (kept.length ? '\n' : ''))
      if (used + bytes > maxBytes) break
      kept.push(text); used += bytes
    }
    if (kept.length) selected.push({ start, end: start + kept.length - 1, text: kept.join('\n') })
  }
  return { selected, partial: selected.reduce((n, s) => n + s.end - s.start + 1, 0) < lines.length }
}
