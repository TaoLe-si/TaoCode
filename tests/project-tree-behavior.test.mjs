import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sortProjectEntries, compareProjectFileNames } from '../src/projectTreeSort.ts'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const entry = (name, kind = 'file') => ({ name, path: name, kind })

test('project filename ordering handles numeric runs without mutating input', () => {
  const input = [entry('file10'), entry('file2'), entry('file02')]
  assert.deepEqual(sortProjectEntries(input, { sortKey: 'BY_NAME', foldersAlwaysOnTop: false }).map(e => e.name), ['file2', 'file02', 'file10'])
  assert.equal(input[0].name, 'file10')
  assert.equal(compareProjectFileNames('same', 'same'), 0)
})
test('folder grouping is independent of type sorting', () => {
  const input = [entry('z.ts', 'directory'), entry('a.java'), entry('README')]
  assert.equal(sortProjectEntries(input, { sortKey: 'BY_TYPE', foldersAlwaysOnTop: true })[0].name, 'z.ts')
  assert.deepEqual(sortProjectEntries(input, { sortKey: 'BY_TYPE', foldersAlwaysOnTop: false }).map(e => e.name), ['a.java', 'z.ts', 'README'])
})
test('default project toolbar replaces bulk expansion and has no environment badge', () => {
  const source = read('../src/components/ToolWindowView.vue')
  assert.doesNotMatch(source, /class="local-tag"|<RefreshCw/)
  assert.doesNotMatch(source, /title="全部展开"|title="刷新目录"/)
  assert.match(source, /:disabled="!ctx.canExpandRecursively\(\)"/)
  // 动作行就地渲染在树的上方。原先它被 Teleport 搬进 dock 标题栏的
  // `#project-title-actions-*`，而那个目标在 ToolWindowView 首次挂载时根本不在文档里
  // （Vue 先把 v-if 的 aside 挂进游离元素、最后才插入），于是 teleport 子树没有 el，
  // 补丁阶段抛异常并把同批次后面的兄弟节点一起带崩。
  assert.doesNotMatch(source, /<Teleport/)
  assert.doesNotMatch(source, /projectHeaderTarget/)
  assert.match(source, /class="workspace-heading"/)
  assert.match(read('../src/App.vue'), /class="editor-groups"/)
  assert.match(source, /@keydown.f5.prevent="ctx.onRefreshTree\(\)"/)
  // Removing title actions must not remove the underlying bulk operation.
  assert.match(read('../src/toolViewContext.ts'), /onExpandAll:.*expandAll\(/)
})
