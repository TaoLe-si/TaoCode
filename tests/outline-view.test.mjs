import test from 'node:test'
import assert from 'node:assert/strict'

import { arrange, treeOf } from '../src/outlineView.ts'

const sym = (name, kind, startLine, endLine, startChar = 0, detail = '') => ({
  name, kind, detail, startLine, startChar, endLine, endChar: startChar + name.length,
})

// What the native layer hands over: the server's tree, flattened depth-first.
const symbols = [
  sym('Sample', 5, 4, 20),
  sym('run', 6, 6, 9, 4, 'void'),
  sym('nested', 13, 7, 8, 8),
  sym('calc', 6, 12, 15, 4, 'int'),
  sym('main', 12, 25, 30),
]
const tree = treeOf(symbols)
// "trail" plus depth is what the row shows, so the helper prints both.
const names = list => list.map(entry => `${entry.trail ? entry.trail + '.' : ''}${entry.symbol.name}:d${entry.depth}`)

test('the flattened answer is nested again by containment', () => {
  assert.equal(tree.length, 2)
  assert.equal(tree[0].symbol.name, 'Sample')
  assert.deepEqual(tree[0].children.map(node => node.symbol.name), ['run', 'calc'])
  assert.deepEqual(tree[0].children[0].children.map(node => node.symbol.name), ['nested'])
  assert.equal(tree[1].symbol.name, 'main')
})

test('the default view keeps document order and depth', () => {
  assert.deepEqual(names(arrange(tree, { sort: false, flat: false, filter: '' })), [
    'Sample:d0', 'Sample.run:d1', 'Sample.run.nested:d2', 'Sample.calc:d1', 'main:d0',
  ])
})

test('alphabetical order reorders siblings only', () => {
  assert.deepEqual(names(arrange(tree, { sort: true, flat: false, filter: '' })), [
    'main:d0', 'Sample:d0', 'Sample.calc:d1', 'Sample.run:d1', 'Sample.run.nested:d2',
  ])
})

test('the flat view drops the indentation but keeps the container path', () => {
  assert.deepEqual(names(arrange(tree, { sort: false, flat: true, filter: '' })), [
    'Sample:d0', 'Sample.run:d0', 'Sample.run.nested:d0', 'Sample.calc:d0', 'main:d0',
  ])
})

test('the filter keeps an ancestor while a descendant still matches', () => {
  assert.deepEqual(names(arrange(tree, { sort: false, flat: false, filter: 'nest' })), [
    'Sample:d0', 'Sample.run:d1', 'Sample.run.nested:d2',
  ])
  assert.deepEqual(arrange(tree, { sort: false, flat: false, filter: 'zzz' }), [])
  assert.deepEqual(names(arrange(tree, { sort: false, flat: false, filter: '  CALC  ' })), [
    'Sample:d0', 'Sample.calc:d1',
  ], 'surrounding spaces and case are ignored, the parent stays as context')
})
