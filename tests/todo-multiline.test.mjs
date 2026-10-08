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

// 标记列的**口径**（2026-10-06 todo2 读盘订正）：`SearchMatch.column` 是 1 基码点列
// （native/search.cpp:698 `code_points(content, line_start, pos) + 1`；`SearchPanel.vue:736`
// 也是直接当"行列"显示），而上游 `IndexPatternSearcher.java:285-287` 比的是匹配**起始偏移**（0 基）。
// 本函数按上游取 0 基，换算在调用方。这一条钉的是"喂错口径真的有后果"：
// 续行在标记列只有**一个**空格时，喂 1 基值会把整段续行丢掉。
test('标记列取 0 基偏移：把桥接的 1 基值直接喂进来会少并一行', () => {
  const lines = ['// TODO: aaa', '//  bbb', 'code()']
  // `// TODO: aaa` 里 T 的 0 基列是 3，桥接给的是 4。
  assert.deepEqual(todoContinuationLines(lines, 1, 3, patterns), ['//  bbb'])
  assert.deepEqual(todoContinuationLines(lines, 1, 4, patterns), [])
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

// 订正（2026-10-06 todo2）：这一支以前把模式 `split('|')` 之后按**字面串** indexOf 找标记词，
// 于是出厂表里的 `\btodo\b.*` 当作字面永远找不到 —— 预览里"标记词上色"对出厂模式从不生效。
// 上游这一位是 `IndexPattern.getWordToHighlight()`（IndexPattern.java:61-65，字面词由
// IndexPatternOptimizerImpl.java:22-24 从正则里抽出：内置两条短路成 `todo` / `fixme`），
// 再由 `TodoHighlightVisitor.java:91-93` 在区间里定位；抽不出词（`:92` 拿到 null）就整条不画。
test('标记词位置走正则：出厂的 \\btodo\\b.* 也定得到位', () => {
  assert.deepEqual(todoMarkerRegions('// TODO: 出厂模式', [{ pattern: '\\btodo\\b.*' }]), [{ start: 3, length: 4 }])
  assert.deepEqual(todoMarkerRegions('// fixme: 出厂模式', [{ pattern: '\\bfixme\\b.*' }]), [{ start: 3, length: 5 }])
  // 带标点的标记只画词面部分（`TODO:` 上色 `TODO`），与上游取字面词一致。
  assert.deepEqual(todoMarkerRegions('// TODO: 带冒号', [{ pattern: 'TODO:' }]), [{ start: 3, length: 4 }])
  // 匹配串开头不是词字符 ⇒ 没有"标记词"可上色，整条不画（上游 :92 的 null 门）。
  assert.deepEqual(todoMarkerRegions('// :TODO x', [{ pattern: ':TODO' }]), [])
  // 区分大小写的模式按自己的档位找（上游同一份 Pattern）。
  assert.deepEqual(todoMarkerRegions('// todo 与 TODO', [{ pattern: 'TODO', caseSensitive: true }]), [{ start: 10, length: 4 }])
  // 坏正则退化为整条字面包含，不抛异常（与 markerMatches 同一容错口径）。
  assert.deepEqual(todoMarkerRegions('a (b', [{ pattern: '(' }]), [{ start: 2, length: 1 }])
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
  // 订正（2026-10-06 todo2）：这一条原来钉的是 `item.column` **原样**传进去，而 `SearchMatch.column`
  // 其实是 1 基（native/search.cpp:698 的 `code_points(...) + 1`），上游比的是 0 基匹配起始偏移
  // （IndexPatternSearcher.java:285-287）⇒ 断言改成钉"换算后的形状"，仍然精确到调用点。
  assert.match(panel, /item\.additional = todoContinuationLines\(lines, item\.line, \(item\.column \?\? 1\) - 1/,
    '扫描后按文件补续行（1 基列换算成 0 基偏移）')
  assert.match(panel, /v-model="multiLine"/, '分组方式弹层里有那一格')
  assert.match(panel, /cell\.display\?\.lines \?\? \[\]/, '续行渲染成自己的行')
  assert.match(panel, /:value="TODO_CHANGE_LIST_SCOPE"/, '作用域下拉里有「变更列表」')
  assert.match(panel, /if \(name === TODO_CHANGE_LIST_SCOPE\) void loadChangeList\(\)/, '选中该作用域时才去拿 git 变更集')
  assert.match(panel, /@keydown="onTreeKeydown"/, '键盘挂在树上')
  assert.match(panel, /revealOccurrence\(\{ path: row\.item\.path, line: row\.item\.line \}\)/, '速度搜索命中后是选中那一行')
  assert.match(panel, /:class="\{ marked: part\.mark \}"/, '预览里的标记上色')
  assert.match(panel, /v-if="multilineNote"/, '多行只补了前 N 个文件时要说清')
})
