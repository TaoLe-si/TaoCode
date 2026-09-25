import test from 'node:test'
import assert from 'node:assert/strict'
import { locationWindow, locationSnippet } from '../src/recentLocations.ts'

// The window is 2*radius+1 lines wide whenever the document allows it.
test('middle lines get the full five-line window', () => {
  assert.deepEqual(locationWindow(5, 20), { start: 3, end: 7 })
})

// RecentLocationsDataModel shifts the window so the caret keeps its context even at a
// document edge: line 0 of 20 shows 0..4, not -2..2 clamped to 0..2.
test('first line slides the window down instead of shrinking it', () => {
  assert.deepEqual(locationWindow(0, 20), { start: 0, end: 4 })
})

test('last line slides the window up', () => {
  // getLinesRange computes `after` with document.lineCount (1-based) while endLine
  // clamps at lineCount - 1, so the bottom edge keeps a full before-context.
  assert.deepEqual(locationWindow(19, 20), { start: 16, end: 19 })
})

test('short documents clamp without inverting', () => {
  assert.deepEqual(locationWindow(1, 2), { start: 0, end: 1 })
  assert.equal(locationWindow(0, 0), null)
})

test('snippet joins the window and reports the first rendered line', () => {
  const lines = ['a', 'b', 'c', 'd', 'e', 'f']
  const result = locationSnippet(lines, 2)
  assert.equal(result.text, 'a\nb\nc\nd\ne')
  assert.equal(result.firstLine, 0)
})

// StringUtil.trimLeading/trimTrailing count newlines around the trimmed text; blank
// edges must disappear while the caret line stays visible.
test('snippet trims leading and trailing blank lines', () => {
  const lines = ['', '', 'code', '', '']
  const result = locationSnippet(lines, 2)
  assert.equal(result.text, 'code')
  assert.equal(result.firstLine, 2)
})

test('blank lines between content survive; only the edges trim', () => {
  assert.equal(locationSnippet(['x', '  ', '\t', '  ', 'y'], 2).text, 'x\n  \n\t\n  \ny')
})

test('lineShift moves reported numbering without changing the window', () => {
  const lines = ['a', 'b', 'c']
  const result = locationSnippet(lines, 1, 3)
  assert.equal(result.text, 'a\nb\nc')
  assert.equal(result.firstLine, 3)
})

test('long lines are capped at 1000 characters', () => {
  const result = locationSnippet(['x'.repeat(1500)], 0)
  assert.equal(result.text.length, 1000)
})
