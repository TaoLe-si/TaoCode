import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyLegend, legendGroups, legendText } from '../src/commitLegend.ts'

// ChangeInfoCalculator.kt:7-9,16-26 splits changes into NEW / MODIFICATION|MOVED /
// DELETED; git reports the same classification as the index status letter.
test('staged changes are classified by their git index status', () => {
  assert.deepEqual(classifyLegend([
    { indexStatus: 'A' }, { indexStatus: 'a' }, { indexStatus: '?' },
    { indexStatus: 'M' }, { indexStatus: 'R' }, { indexStatus: 'C' }, { indexStatus: 'T' }, { indexStatus: 'U' },
    { indexStatus: 'D' },
  ]), { added: 3, modified: 5, deleted: 1 })
})

test('an unreadable index status counts as a modification, never as a new file', () => {
  assert.deepEqual(classifyLegend([{ indexStatus: '' }, { indexStatus: ' ' }]), { added: 0, modified: 2, deleted: 0 })
})

test('nothing staged means an empty legend, which keeps the panel hidden', () => {
  assert.deepEqual(classifyLegend([]), { added: 0, modified: 0, deleted: 0 })
  assert.deepEqual(legendGroups({ added: 0, modified: 0, deleted: 0 }), [])
  assert.equal(legendText(legendGroups({ added: 0, modified: 0, deleted: 0 }), false), '')
})

test('empty groups are dropped and the remaining ones keep their IDEA order', () => {
  const groups = legendGroups({ added: 1, modified: 0, deleted: 2 })
  assert.deepEqual(groups.map(group => group.kind), ['added', 'deleted'])
  assert.equal(legendText(groups, false), '1 个新增   2 个删除')
  assert.equal(legendText(groups, true), '+1 −2')
})

test('the full legend joins groups with the three-space gap of CommitLegendPanel', () => {
  const groups = legendGroups({ added: 2, modified: 1, deleted: 3 })
  assert.equal(legendText(groups, false), '2 个新增   1 个修改   3 个删除')
})

test('the compact legend uses the literal one-character labels', () => {
  const groups = legendGroups({ added: 2, modified: 1, deleted: 3 })
  assert.equal(legendText(groups, true), '+2 *1 −3')
  assert.deepEqual(groups.map(group => group.compact), ['+', '*', '−'])
})

test('the compact legend is never wider than the full one', () => {
  const groups = legendGroups({ added: 10, modified: 20, deleted: 30 })
  assert.ok(legendText(groups, true).length < legendText(groups, false).length)
})
