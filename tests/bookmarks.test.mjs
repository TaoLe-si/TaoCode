import test from 'node:test'
import assert from 'node:assert/strict'

import { bookmarkOwner, nextBookmark, placeBookmark, removeBookmark, sortedBookmarks } from '../src/bookmarks.ts'

test('F11 adds a bookmark on the line and clears it again', () => {
  const once = placeBookmark([], 'src/a.cpp', 12)
  assert.deepEqual(once, [{ path: 'src/a.cpp', line: 12 }])
  assert.equal('mnemonic' in once[0], false, 'a plain bookmark carries no digit key')
  assert.deepEqual(placeBookmark(once, 'src/a.cpp', 12), [])
  assert.deepEqual(placeBookmark(once, 'src/a.cpp', 13), [once[0], { path: 'src/a.cpp', line: 13 }])
})

test('a digit moves to the new line and frees its old owner', () => {
  const first = placeBookmark([], 'src/a.cpp', 10, 3)
  const moved = placeBookmark(first, 'src/b.cpp', 7, 3)
  assert.deepEqual(moved, [{ path: 'src/a.cpp', line: 10 }, { path: 'src/b.cpp', line: 7, mnemonic: 3 }])
  assert.equal(bookmarkOwner(moved, 3).path, 'src/b.cpp')
  assert.equal(bookmarkOwner(moved, 0), undefined, 'an unused digit has no owner')
})

test('the same digit on the same line is a toggle off', () => {
  const marked = placeBookmark([], 'src/a.cpp', 10, 9)
  assert.deepEqual(placeBookmark(marked, 'src/a.cpp', 10, 9), [])
  const renamed = placeBookmark(marked, 'src/a.cpp', 10, 1)
  assert.deepEqual(renamed, [{ path: 'src/a.cpp', line: 10, mnemonic: 1 }], 'a different digit renames it')
  assert.deepEqual(placeBookmark(renamed, 'src/a.cpp', 10), [], 'F11 removes a digit bookmark outright')
})

test('the walk follows document order and wraps around the project', () => {
  const list = [
    { path: 'src/b.cpp', line: 3 },
    { path: 'src/a.cpp', line: 40 },
    { path: 'src/a.cpp', line: 5, mnemonic: 1 },
  ]
  assert.deepEqual(sortedBookmarks(list).map(entry => `${entry.path}:${entry.line}`),
    ['src/a.cpp:5', 'src/a.cpp:40', 'src/b.cpp:3'])
  assert.equal(nextBookmark(list, 'src/a.cpp', 5, false).line, 40)
  assert.equal(nextBookmark(list, 'src/a.cpp', 40, false).path, 'src/b.cpp', 'the walk crosses into the next file')
  assert.equal(nextBookmark(list, 'src/b.cpp', 3, false).path, 'src/a.cpp', 'it wraps to the very first one')
  assert.equal(nextBookmark(list, 'src/b.cpp', 3, true).line, 40)
  assert.equal(nextBookmark(list, 'src/a.cpp', 5, true).path, 'src/b.cpp', 'backwards wraps to the last')
  assert.equal(nextBookmark(list, 'src/a.cpp', 1, true).line, 3, 'before the first it still lands somewhere')
  assert.equal(nextBookmark([], 'src/a.cpp', 1, false), undefined, 'no bookmarks means no jump')
})

test('the panel can drop one entry without touching the rest', () => {
  const list = [{ path: 'a', line: 1 }, { path: 'b', line: 2, mnemonic: 4 }]
  assert.deepEqual(removeBookmark(list, list[1]), [{ path: 'a', line: 1 }])
  assert.deepEqual(removeBookmark(list, { path: 'c', line: 9 }), list)
})
