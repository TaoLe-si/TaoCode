import test from 'node:test'
import assert from 'node:assert/strict'

import {
  addHistoryEntry,
  formatHistory,
  parseHistory,
  popupHistory,
  SEARCH_HISTORY_LABEL,
  SEARCH_HISTORY_SIZE,
  SETTINGS_SEARCH_HISTORY_KEY,
  stepHistory,
} from '../src/searchHistory.ts'

test('the search history mirrors SearchTextField: size 5, stored under SettingsSearchHistory', () => {
  // SearchTextField.java:69 (myHistorySize = 5), SettingsSearch.java:25 (property name).
  assert.equal(SEARCH_HISTORY_SIZE, 5)
  assert.equal(SETTINGS_SEARCH_HISTORY_KEY, 'taocode.settingsSearchHistory')
  assert.equal(SEARCH_HISTORY_LABEL, '搜索历史')
})

test('new entries go to the front, trimmed, and the oldest drops out when full', () => {
  // addElement (:356-384).
  assert.deepEqual(addHistoryEntry([], '  缩进  '), { entries: ['缩进'], changed: true })
  assert.deepEqual(addHistoryEntry(['b'], 'a').entries, ['a', 'b'])
  const full = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(addHistoryEntry(full, 'f').entries, ['f', 'a', 'b', 'c', 'd'])
})

test('an empty query is never stored, and the caller is told nothing changed', () => {
  // :357-360 + the `if (addElement(...))` guard at :285.
  assert.deepEqual(addHistoryEntry(['a'], ''), { entries: ['a'], changed: false })
  assert.deepEqual(addHistoryEntry(['a'], '   '), { entries: ['a'], changed: false })
})

test('an entry already at the top is a no-op, a duplicate further down moves to the top', () => {
  // :370-373 (index == 0 → return false) and :374-377 (index > 0 → move to top).
  assert.deepEqual(addHistoryEntry(['a', 'b'], 'a'), { entries: ['a', 'b'], changed: false })
  assert.deepEqual(addHistoryEntry(['a', 'b'], 'b'), { entries: ['b', 'a'], changed: true })
})

test('duplicates are found case-insensitively; the casing only changes when the entry moves', () => {
  // :365 StringUtil.equalsIgnoreCase — but a duplicate at index 0 is returned untouched (:370-373),
  // so the stored spelling stays whatever it was.
  assert.deepEqual(addHistoryEntry(['Indent', 'b'], 'indent'), { entries: ['Indent', 'b'], changed: false })
  // Further down it moves to the top and then takes the spelling that was typed (:374-377, :382).
  assert.deepEqual(addHistoryEntry(['b', 'Indent'], 'indent'), { entries: ['indent', 'b'], changed: true })
})

test('parseHistory reads the newline-joined property value and drops empty items', () => {
  // :322-330.
  assert.deepEqual(parseHistory('a\nb'), ['a', 'b'])
  assert.deepEqual(parseHistory('a\n\nb\n'), ['a', 'b'])
  assert.deepEqual(parseHistory(''), [])
  assert.deepEqual(parseHistory(null), [])
  assert.deepEqual(parseHistory('nonsense'), ['nonsense'])
  // A list longer than the size is capped so the popup and the cycling agree.
  assert.deepEqual(parseHistory('a\nb\nc\nd\ne\nf\ng'), ['a', 'b', 'c', 'd', 'e'])
})

test('formatHistory writes the format `reset()` reads back', () => {
  assert.equal(formatHistory(['a', 'b']), 'a\nb')
  assert.deepEqual(parseHistory(formatHistory(['缩进', '主题'])), ['缩进', '主题'])
})

test('the popup lists at most five entries', () => {
  // getSize() :351-354.
  assert.deepEqual(popupHistory(['a', 'b', 'c', 'd', 'e', 'f']), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(popupHistory(['a']), ['a'])
})

test('Alt+Up walks backwards from the top and wraps onto the last entry', () => {
  // :178-181 — the index starts at 0, decreases, and wraps to size - 1.
  const first = stepHistory(['a', 'b'], 'a', 0, 'prev')
  assert.deepEqual(first, { entries: ['a', 'b'], index: 1, text: 'b', changed: false })
  const again = stepHistory(first.entries, first.text, first.index, 'prev')
  assert.deepEqual(again, { entries: ['a', 'b'], index: 0, text: 'a', changed: false })
})

test('Alt+Down walks forwards from index 0 and wraps onto the first entry', () => {
  // :189-191 — the index starts at 0, so the first Alt+Down lands on the second entry.
  const first = stepHistory(['a', 'b', 'c'], 'a', 0, 'next')
  assert.deepEqual(first, { entries: ['a', 'b', 'c'], index: 1, text: 'b', changed: false })
  const wrapped = stepHistory(first.entries, first.text, 2, 'next')
  assert.deepEqual(wrapped, { entries: ['a', 'b', 'c'], index: 0, text: 'a', changed: false })
})

test('a step first records the text in the field, and does nothing when there is only one entry', () => {
  // :176/:187 — `if (!myFullList.contains(getText())) addCurrentTextToHistory()`, so the typed text
  // is stored first and Alt+Up then walks to the entry before it.
  const recorded = stepHistory(['old'], 'new', 0, 'prev')
  assert.deepEqual(recorded, { entries: ['new', 'old'], index: 1, text: 'old', changed: true })
  // getSize() < 2 → return without touching the text (:177/:188).
  assert.deepEqual(stepHistory([], '', 0, 'prev'), { entries: [], index: 0, text: '', changed: false })
  assert.deepEqual(stepHistory(['typed'], 'typed', 0, 'next'), { entries: ['typed'], index: 0, text: 'typed', changed: false })
})

test('the recorded text check is case-sensitive, like the source', () => {
  // `contains` (:176) is case-sensitive while addElement dedups case-insensitively (:365), and the
  // index-0 early return (:370-373) means a differently-cased entry at the top stays as it is.
  assert.deepEqual(stepHistory(['indent', 'b'], 'INDENT', 0, 'prev'), { entries: ['indent', 'b'], index: 1, text: 'b', changed: false })
  // Further down, the same input does move the entry up and rewrites its casing.
  assert.deepEqual(stepHistory(['b', 'indent'], 'INDENT', 0, 'prev').entries, ['INDENT', 'b'])
})
