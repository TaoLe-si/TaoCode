import { strict as assert } from 'node:assert'
import test from 'node:test'
import { buildTodoTree, flattenTodoRows, orderedItems, packageIds } from '../src/todoTree.ts'

const item = (path, line, kind = '待办') => ({ path, line, text: `// ${kind} ${line}`, kind })
const shape = rows => rows.map(row => `${row.depth}:${row.node.kind}:${row.item ? row.item.line : row.node.label}`)

test('grouping off gives one node per file, items sorted by line', () => {
  const tree = buildTodoTree([item('src/b.ts', 9), item('src/a.ts', 2), item('src/a.ts', 1)], { showPackages: false, flattenPackages: false })
  assert.deepEqual(tree.map(node => node.id), ['src/a.ts', 'src/b.ts'])
  assert.deepEqual(tree[0].items.map(entry => entry.line), [1, 2])
})

test('packages nest one node per directory level', () => {
  const tree = buildTodoTree([item('src/main/java/App.java', 3), item('src/test/Case.java', 7), item('README.md', 1)],
    { showPackages: true, flattenPackages: false })
  assert.deepEqual(tree.map(node => node.id), ['README.md', 'src'])
  assert.deepEqual(tree[1].children.map(node => node.id), ['src/main', 'src/test'])
  assert.deepEqual(orderedItems(tree).map(entry => `${entry.path}:${entry.line}`),
    ['README.md:1', 'src/main/java/App.java:3', 'src/test/Case.java:7'], 'tree order drives the occurrence walk')
  assert.deepEqual(packageIds(tree), ['src', 'src/main', 'src/main/java', 'src/test'])
})

test('flatten packages collapses the chain into one labelled node', () => {
  const tree = buildTodoTree([item('src/main/java/App.java', 3), item('src/test/Case.java', 7), item('src/main/java/Nested.java', 4)],
    { showPackages: true, flattenPackages: true })
  assert.deepEqual(tree.map(node => node.id), ['src/main/java', 'src/test'])
  assert.equal(tree[0].label, 'src/main/java', 'the flattened label is the whole path')
  assert.deepEqual(tree[0].children.map(node => node.id), ['src/main/java/App.java', 'src/main/java/Nested.java'])
})

test('root level files stay unpackaged when flattening', () => {
  const tree = buildTodoTree([item('README.md', 1), item('src/a.ts', 2)], { showPackages: true, flattenPackages: true })
  assert.deepEqual(tree.map(node => node.id), ['README.md', 'src'])
  assert.equal(tree[0].kind, 'file')
})

test('rows only reveal children of expanded packages', () => {
  const tree = buildTodoTree([item('src/a.ts', 2), item('src/deep/b.ts', 5)], { showPackages: true, flattenPackages: false })
  assert.deepEqual(shape(flattenTodoRows(tree, new Set())), ['0:package:src'])
  assert.deepEqual(shape(flattenTodoRows(tree, new Set(['src']))),
    ['0:package:src', '1:file:a.ts', '2:file:2', '1:package:deep'])
  assert.deepEqual(shape(flattenTodoRows(tree, new Set(['src', 'src/deep']))),
    ['0:package:src', '1:file:a.ts', '2:file:2', '1:package:deep', '2:file:b.ts', '3:file:5'])
})
