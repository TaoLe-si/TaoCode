// pv/todo 的颜色列与作用域过滤（`src/todoView.ts`）的判据。
//
// 上游：IDEA 的 TODO 工具窗口按 `TodoPattern` 的颜色显示标记列（颜色方案 `TodoAttributes`），
// 工具栏有作用域过滤（`project.scopes`）。本仓颜色存在模式表里（`#RRGGBB`），作用域过滤
// 复用 `src/scopes.ts` 的求值（与 Find in Files 同一套），这里逐条钉住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TODO_COLOR_FALLBACK, filterTodoItemsByScope, markerMatches, matchingTodoPattern, todoItemColor } from '../src/todoView.ts'
import { isTodoColor, validateTodoPatterns } from '../src/todoPatterns.ts'

const patterns = [
  { pattern: '\\btodo\\b.*', description: '待办', color: '#4a86e8' },
  { pattern: 'FIXME', description: '需要修', color: '#e5484d', caseSensitive: true },
]

test('标记匹配与扫描同一语义（\\b 包裹、默认不区分大小写）', () => {
  assert.equal(markerMatches('// todo: 写文档', patterns[0].pattern), true)
  assert.equal(markerMatches('// TODO: 写文档', patterns[0].pattern), true)
  assert.equal(markerMatches('// todos: 复数不算', patterns[0].pattern), false)
  assert.equal(markerMatches('// fixme 小写不算', 'FIXME', true), false)
  assert.equal(markerMatches('// FIXME 命中', 'FIXME', true), true)
})

test('坏正则退化为字面量包含，空白模式永不命中（不把每行都点亮）', () => {
  assert.equal(markerMatches('a (b', '(', false), true)
  assert.equal(markerMatches('anything', '', false), false)
})

test('命中哪条模式：表序即优先级，首条命中', () => {
  assert.equal(matchingTodoPattern('// TODO FIXME', patterns)?.description, '待办')
  assert.equal(matchingTodoPattern('// nothing', patterns), undefined)
})

test('颜色列：模式自带颜色优先，缺省用中性色（不冒充方案色）', () => {
  assert.equal(todoItemColor('// TODO x', patterns), '#4a86e8')
  assert.equal(todoItemColor('// FIXME x', patterns), '#e5484d')
  assert.equal(todoItemColor('// 无标记', patterns), TODO_COLOR_FALLBACK)
  assert.equal(todoItemColor('// TODO x', [{ pattern: 'TODO', description: 'd', color: 'red' }]), TODO_COLOR_FALLBACK,
    '非法颜色不落到 DOM 上')
})

test('颜色校验：只认 #RRGGBB（设置页与原生同一套）', () => {
  assert.equal(isTodoColor('#4a86e8'), true)
  assert.equal(isTodoColor('#ABCDEF'), true)
  assert.equal(isTodoColor('4a86e8'), false)
  assert.equal(isTodoColor('#4a86e'), false)
  assert.equal(isTodoColor('red'), false)
  assert.equal(validateTodoPatterns([{ pattern: 'TODO', description: 'd', color: '#4a86e8' }]), null)
  assert.match(validateTodoPatterns([{ pattern: 'TODO', description: 'd', color: 'red' }]), /#RRGGBB/)
})

test('作用域过滤：空选择不过滤，未知作用域不过滤，命中只留范围内的条目', () => {
  const items = [
    { path: 'src/main/App.java', line: 1, text: '// TODO a', kind: '待办' },
    { path: 'src/test/AppTest.java', line: 2, text: '// TODO b', kind: '待办' },
    { path: 'docs/README.md', line: 3, text: '// TODO c', kind: '待办' },
  ]
  const scopes = [{ name: '主源码', pattern: 'file:src/main//*', shared: false }]
  assert.deepEqual(filterTodoItemsByScope(items, '', scopes), items)
  assert.deepEqual(filterTodoItemsByScope(items, '不存在', scopes), items)
  assert.deepEqual(filterTodoItemsByScope(items, '主源码', scopes).map(item => item.path), ['src/main/App.java'])
})

test('作用域过滤：非法模式一条都不留（Invalid 恒假），与 Find in Files 同语义', () => {
  const items = [{ path: 'src/a.ts', line: 1 }]
  assert.deepEqual(filterTodoItemsByScope(items, '坏', [{ name: '坏', pattern: 'file:(' }]), [])
})

test('面板与设置页真的接了颜色列/作用域过滤（不是死代码）', () => {
  const panel = readFileSync('src/components/TodoPanel.vue', 'utf8')
  assert.match(panel, /todo-color-dot/)
  assert.match(panel, /scopeName/)
  const page = readFileSync('src/components/TodoPatternsPage.vue', 'utf8')
  assert.match(page, /type="color"/)
  const view = readFileSync('src/components/ToolWindowView.vue', 'utf8')
  assert.match(view, /:scopes="\(ctx\.scopes \?\? \[\]\) as any" :module-name="ctx\.moduleName \?\? ''"/)
})
