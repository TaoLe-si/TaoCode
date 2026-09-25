// IDEA's Recent Locations snippet window (RecentLocationsDataModel.kt): for a caret
// line, take up to `radius` lines before and after, then shift the window toward the
// caret when one side runs out of document, so every location shows the same number
// of context lines. Pure so the arithmetic is unit-testable (tests/recent-locations.test.mjs).

export function locationWindow(line: number, lineCount: number, radius = 2): { start: number; end: number } | null {
  if (lineCount <= 0) return null
  const before = Math.min(radius, line)
  const after = Math.min(radius, lineCount - line)
  const startLine = Math.max(line - (before + radius - after), 0)
  const endLine = Math.min(line + (after + radius - before), lineCount - 1)
  return startLine <= endLine ? { start: startLine, end: endLine } : { start: line, end: line }
}

const MAX_LINE_CHARS = 1000 // getTrimmedRange caps each rendered line at 1000 chars

// trims leading blank lines, trailing blank lines, and clamps each line's length.
export function locationSnippet(lines: string[], line: number, lineShift = 0, radius = 2): { text: string; firstLine: number } {
  const window = locationWindow(line, lines.length, radius)
  if (!window) return { text: '', firstLine: 0 }
  const body = lines.slice(window.start, window.end + 1).map(row => row.slice(0, MAX_LINE_CHARS))
  let leading = 0
  while (leading < body.length && !body[leading]!.trim()) leading++
  let trailing = 0
  while (trailing < body.length - leading && !body[body.length - 1 - trailing]!.trim()) trailing++
  const trimmed = body.slice(leading, body.length - trailing)
  return { text: trimmed.join('\n'), firstLine: window.start + leading + lineShift }
}
