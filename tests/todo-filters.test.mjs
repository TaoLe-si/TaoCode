// pv/todo 的命名过滤器（`src/todoFilters.ts`，上游 `TodoFilter`/`TodoConfiguration.myTodoFilters`）与
// 「当前文件」作用域的判据。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clearTodoFilters, filterTodoItems, saveTodoFilters, todoFilters, validateTodoFilters } from '../src/todoFilters.ts'
import { TODO_CURRENT_FILE_SCOPE, filterTodoItemsByScope } from '../src/todoView.ts'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const patterns = [
  { pattern: 'TODO', description: '待办' },
  { pattern: 'FIXME', description: '需要修', caseSensitive: true },
]

test('过滤器校验：空名 / 重名 / 引用不存在的标记都要被拒', () => {
  assert.equal(validateTodoFilters([{ name: '我的', patterns: ['TODO'] }], patterns), null)
  assert.match(validateTodoFilters([{ name: '  ', patterns: [] }], patterns), /名字不能为空/)
  assert.match(validateTodoFilters([{ name: 'a', patterns: [] }, { name: 'a', patterns: ['TODO'] }], patterns), /名字重复/)
  assert.match(validateTodoFilters([{ name: 'a', patterns: ['NOPE'] }], patterns), /不存在的标记/)
})

test('保存/清空：写进应用级 ref，重名与坏引用不落盘', () => {
  clearTodoFilters()
  assert.equal(saveTodoFilters([{ name: '待办only', patterns: ['TODO'] }], patterns), null)
  assert.deepEqual(todoFilters.value, [{ name: '待办only', patterns: ['TODO'] }])
  assert.match(saveTodoFilters([{ name: 'x', patterns: ['MISSING'] }], patterns), /不存在的标记/)
  assert.deepEqual(todoFilters.value, [{ name: '待办only', patterns: ['TODO'] }], '坏表不覆盖已保存的')
  clearTodoFilters()
  assert.deepEqual(todoFilters.value, [])
})

test('按过滤器裁剪：不选/未知过滤器不过滤，命中集合外的标记被裁掉', () => {
  const items = [
    { text: '// TODO a', path: 'a.ts', line: 1 },
    { text: '// FIXME b', path: 'b.ts', line: 2 },
    { text: '// TODO FIXME c', path: 'c.ts', line: 3 },
  ]
  const filters = [{ name: '只看待办', patterns: ['TODO'] }]
  assert.deepEqual(filterTodoItems(items, '', filters, patterns).length, 3)
  assert.deepEqual(filterTodoItems(items, '不存在', filters, patterns).length, 3)
  assert.deepEqual(filterTodoItems(items, '只看待办', filters, patterns).map(item => item.path), ['a.ts', 'c.ts'])
})

test('当前文件作用域：只留当前路径；没有当前文件时为空', () => {
  const items = [{ path: 'a.ts', line: 1 }, { path: 'b.ts', line: 2 }]
  assert.deepEqual(filterTodoItemsByScope(items, TODO_CURRENT_FILE_SCOPE, [], '', 'a.ts').map(item => item.path), ['a.ts'])
  assert.deepEqual(filterTodoItemsByScope(items, TODO_CURRENT_FILE_SCOPE, [], '', ''), [])
})

test('面板与设置页真的接上过滤器/当前文件作用域', () => {
  const panel = read('../src/components/TodoPanel.vue')
  assert.match(panel, /todoFilters/)
  assert.match(panel, /filterTodoItems\(/)
  assert.match(panel, /TODO_CURRENT_FILE_SCOPE/)
  const page = read('../src/components/TodoPatternsPage.vue')
  assert.match(page, /saveTodoFilters/)
  assert.match(page, /toggleFilterPattern/)
})
