// TODO 补上的三条：多行条目（`MultiLineTodoLocalityDetector` / `findContinuation`）、
// 变更列表作用域（`ChangeListTodosPanel`）、预览里标记词的上色（`TodoHighlightVisitor`）。
// 上游坐标见 src/todoMultiLine.ts 与 src/todoView.ts 的文件头。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  TODO_MAX_DISPLAYED_LINES, todoContinuationLines, todoDisplayText, todoFullText, todoMarkerRegions,
} from '../src/todoMultiLine.ts'
import { TODO_CHANGE_LIST_SCOPE, filterTodoItemsByPaths, filterTodoItemsByScope } from '../src/todoView.ts'

const patterns = [{ pattern: 'TODO', description: '待办' }, { pattern: 'FIXME', description: '待修' }]

test('续行：正文比标记更靠右的注释行才并进来', () => {
  const lines = [
    'class A {',
    '  // TODO: first line',
    '  //    continuation one',
    '  //    continuation two',
    '  return 0;',
  ]
  assert.deepEqual(todoContinuationLines(lines, 2, 5, patterns),
    ['//    continuation one', '//    continuation two'])
})

test('续行不并代码行，也不并正文起得更早的注释行', () => {
  const stopAtCode = ['  // TODO: a', '  int x = 1;']
  assert.deepEqual(todoContinuationLines(stopAtCode, 1, 5, patterns), [])
  // 上游 `IndexPatternSearcher.java:285-287`：标记列上不是空白就停 —— 同级缩进的下一行
  // 注释（`// and that`，正文从第 5 列就开始）不算延续。
  const sameColumn = ['  // TODO: a', '  // and that']
  assert.deepEqual(todoContinuationLines(sameColumn, 1, 5, patterns), [])
})

test('续行里再出现标记就停：那是另一条 TODO', () => {
  const lines = ['  // TODO: a', '  //      plain tail', '  //      FIXME: b', '  //      more']
  assert.deepEqual(todoContinuationLines(lines, 1, 5, patterns), ['//      plain tail'])
})

test('块注释的 * 续行算延续（allowedContinuationPrefixChars）', () => {
  const lines = ['  /* TODO: 说明', '   *    第二行', '   */']
  assert.deepEqual(todoContinuationLines(lines, 1, 7, patterns), ['*    第二行'])
})

test('标记行本身不在注释里时不并任何东西', () => {
  assert.deepEqual(todoContinuationLines(['TODO: 裸文本', '   后面一行'], 1, 0, patterns), [])
})

test('显示形状：主行 + 最多 10 条续行，超了给「更多」', () => {
  assert.equal(TODO_MAX_DISPLAYED_LINES, 10)
  const many = Array.from({ length: 12 }, (_, index) => `//   line ${index}`)
  const view = todoDisplayText('// TODO: head', many)
  assert.equal(view.head, '// TODO: head')
  assert.equal(view.lines.length, 10)
  assert.equal(view.more, true)
  assert.equal(todoDisplayText('// TODO: head', ['//   one']).more, false)
  // 完整描述文本按 \n 连接（`TodoHighlightVisitor.java:110-118` 的 formatDescription）。
  assert.equal(todoFullText('a', ['b', 'c']), 'a\nb\nc')
  assert.equal(todoFullText('a', []), 'a')
})

test('标记词位置：默认不区分大小写，全出现都标', () => {
  const regions = todoMarkerRegions('// TODO x TODO y', patterns)
  assert.deepEqual(regions, [{ start: 3, length: 4 }, { start: 10, length: 4 }])
  const strict = todoMarkerRegions('// todo x', [{ pattern: 'TODO', caseSensitive: true }])
  assert.deepEqual(strict, [])
  const marked = todoMarkerRegions('// FIXME: 坏了', patterns)
  assert.deepEqual(marked, [{ start: 3, length: 5 }])
})

test('变更列表作用域：空集合什么都不留，路径按段归一', () => {
  const items = [{ path: 'src/a.ts' }, { path: 'src\\b.ts' }, { path: 'src/c.ts' }]
  assert.deepEqual(filterTodoItemsByPaths(items, ['src/a.ts', 'src/b.ts']).map(item => item.path), ['src/a.ts', 'src\\b.ts'])
  assert.deepEqual(filterTodoItemsByPaths(items, []), [])
})

test('作用域下拉里的「变更列表」走的是同一条过滤链', () => {
  const items = [{ path: 'src/a.ts' }, { path: 'src/c.ts' }]
  assert.deepEqual(filterTodoItemsByScope(items, TODO_CHANGE_LIST_SCOPE, [], '', 'src/a.ts', ['src/c.ts'])
    .map(item => item.path), ['src/c.ts'])
  // 没选作用域时仍是全量（哨兵值不与命名作用域冲突）。
  assert.equal(filterTodoItemsByScope(items, '', [], '', '', []).length, 2)
})

test('面板真的接上了多行/变更列表/速度搜索（不是死代码）', () => {
  const panel = readFileSync('src/components/TodoPanel.vue', 'utf8')
  // 钉**挂点**而不是符号名：只 import 不用、或者只声明不绑定的假接线要能被照出来。
  assert.match(panel, /item\.additional = todoContinuationLines\(lines, item\.line, item\.column/, '扫描后按文件补续行')
  assert.match(panel, /v-model="multiLine"/, '分组方式弹层里有那一格')
  assert.match(panel, /cell\.display\?\.lines \?\? \[\]/, '续行渲染成自己的行')
  assert.match(panel, /:value="TODO_CHANGE_LIST_SCOPE"/, '作用域下拉里有「变更列表」')
  assert.match(panel, /if \(name === TODO_CHANGE_LIST_SCOPE\) void loadChangeList\(\)/, '选中该作用域时才去拿 git 变更集')
  assert.match(panel, /@keydown="onTreeKeydown"/, '键盘挂在树上')
  assert.match(panel, /revealOccurrence\(\{ path: row\.item\.path, line: row\.item\.line \}\)/, '速度搜索命中后是选中那一行')
  assert.match(panel, /:class="\{ marked: part\.mark \}"/, '预览里的标记上色')
  assert.match(panel, /v-if="multilineNote"/, '多行只补了前 N 个文件时要说清')
})
