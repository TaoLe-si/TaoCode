import test from 'node:test'
import assert from 'node:assert/strict'
import { mnemonicBindings, mnemonicOf, naturalCompare, sortedByTitle } from '../src/toolWindows.ts'

// The mnemonic is a property of the tool window, not of its stripe position
// (ActivateToolWindowAction.kt:88-111 reads it from the keymap), so reordering the stripe
// must not renumber anything.
const ORDER = ['files', 'git', 'vcslog', 'search']

test('every numbered tool window keeps its digit regardless of stripe order', () => {
  assert.equal(mnemonicOf(ORDER, 'files'), '1')
  assert.equal(mnemonicOf(ORDER, 'git'), '2')
  assert.equal(mnemonicOf(ORDER, 'vcslog'), '3')
  assert.equal(mnemonicOf(ORDER, 'search'), '4')
  // A reordered stripe is a different list; the ids keep the digits they were given.
  assert.equal(mnemonicOf([...ORDER].reverse(), 'files'), '4')
})

test('tool windows without a number report no mnemonic', () => {
  assert.equal(mnemonicOf(ORDER, 'terminal'), undefined)
  assert.equal(mnemonicOf(ORDER, ''), undefined)
})

test('aliases bind an extra digit and never collide with the positional numbers', () => {
  const bindings = mnemonicBindings(ORDER, { '0': 'git' })
  assert.equal(bindings['0'], 'git')
  assert.equal(bindings['1'], 'files')
  assert.equal(bindings['4'], 'search')
  assert.equal(bindings['5'], undefined)
  // An alias on a digit that also has a positional owner wins (IDEA binds Alt+0 to the
  // Commit tool window while Alt+1..9 stay with the project tool windows).
  assert.equal(mnemonicBindings(ORDER, { '1': 'git' })['1'], 'git')
})

// StringUtil.naturalCompare: digit runs compare numerically, the rest by code unit.
test('natural compare orders embedded numbers numerically, not lexically', () => {
  assert.ok(naturalCompare('file2', 'file10') < 0)
  assert.ok(naturalCompare('file10', 'file2') > 0)
  assert.equal(naturalCompare('file2', 'file2'), 0)
  assert.ok(naturalCompare('a', 'ab') < 0)
  assert.ok(naturalCompare('ab', 'a') > 0)
  assert.equal(naturalCompare('', ''), 0)
  assert.ok(naturalCompare('', 'a') < 0)
  assert.ok(naturalCompare('a', '') > 0)
})

test('natural compare falls back to code-unit order for non-digit text', () => {
  // No collation is involved: this is the same "uppercase before lowercase" ordering
  // Java's String.compareTo gives, which is what IDEA sorts stripe titles with.
  assert.ok(naturalCompare('A', 'a') < 0)
  assert.ok(naturalCompare('任务', '搜索') < 0)
  assert.deepEqual(['文件10', '文件2', '文件1'].sort(naturalCompare), ['文件1', '文件2', '文件10'])
})

test('the tool windows widget lists windows by stripe title', () => {
  const windows = [
    { id: 'todo', title: '任务' },
    { id: 'files', title: '资源管理器' },
    { id: 'search', title: '搜索' },
  ]
  assert.deepEqual(sortedByTitle(windows, window => window.title).map(window => window.id), ['todo', 'search', 'files'])
  assert.deepEqual(windows.map(window => window.id), ['todo', 'files', 'search'], 'the input stays untouched')
})
