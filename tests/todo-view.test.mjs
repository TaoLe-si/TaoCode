// pv/todo 的颜色列与作用域过滤（`src/todoView.ts`）的判据。
//
// 上游：IDEA 的 TODO 工具窗口按 `TodoPattern` 的颜色显示标记列（颜色方案 `TodoAttributes`），
// 工具栏有作用域过滤（`project.scopes`）。本仓颜色存在模式表里（`#RRGGBB`），作用域过滤
// 复用 `src/scopes.ts` 的求值（与 Find in Files 同一套），这里逐条钉住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TODO_COLOR_FALLBACK, filterTodoItemsByScope, keepPatternHits, markerMatches, matchingTodoPattern, todoItemColor } from '../src/todoView.ts'
import { isTodoColor, validateTodoPatterns } from '../src/todoPatterns.ts'

const patterns = [
  { pattern: '\\btodo\\b.*', description: '待办', color: '#4a86e8' },
  { pattern: 'FIXME', description: '需要修', color: '#e5484d', caseSensitive: true },
]

test('标记匹配与扫描同一语义（默认不区分大小写）', () => {
  assert.equal(markerMatches('// todo: 写文档', patterns[0].pattern), true)
  assert.equal(markerMatches('// TODO: 写文档', patterns[0].pattern), true)
  assert.equal(markerMatches('// todos: 复数不算', patterns[0].pattern), false)
  assert.equal(markerMatches('// fixme 小写不算', 'FIXME', true), false)
  assert.equal(markerMatches('// FIXME 命中', 'FIXME', true), true)
})

// 订正（2026-10-06 todo2）：这一族原先把用户写的模式再包一层 `\b(source)\b`，并在测试标题里
// 把"包 \b"说成与扫描同一语义。自己开上游核过：`IndexPattern.compilePattern()`
// （platform/indexing-api/src/com/intellij/psi/search/IndexPattern.java:80-89）把模式串**原样**
// 交给 `Pattern.compile`，命中是 `matcher.find()` 的子串语义
// （platform/editor-ui-ex/src/com/intellij/psi/impl/search/IndexPatternSearcher.java:247）——
// 上游没有隐式 `\b`。所以旧的包裹是**不符**，不是语义；下面钉回上游口径。
test('模式按原样就是正则：上游不包隐式 \\b', () => {
  // 带标点的标记在 IDEA 里正常命中；被 `\b(...)\b` 包住后恒为 0 条（`:` 右侧没有词边界）。
  assert.equal(markerMatches('// TODO: 带冒号', 'TODO:'), true)
  assert.equal(markerMatches('// FIXME(bob) 谁负责', 'FIXME\\(bob\\)'), true)
  // 出厂表两条模式自己写了 \\b，"复数不算"这一条语义不变（见上一个 test）。
  assert.equal(markerMatches('// MYTODOXX 里不算', '\\bTODO\\b'), false)
  // 裸词按上游 find() 的子串语义命中 —— 与提交前 TODO 检查那条链（src/todoScan.ts 把模式
  // 原样交给 search.run，宿主见 SourceControl.vue:487）同一个口径，两处不再两样说法。
  assert.equal(markerMatches('// TODOS 复数也命中（与上游一致）', 'TODO'), true)
})

// 「区分大小写」这一档以前是假控件：面板扫描把 caseSensitive 写死 false，勾选不改变可见集合，
// 只让标记名与色点消失。上游是两段式 —— 粗筛（索引计数，IndexPatternSearcher.java:66-74）之后
// 由**每条模式自己的** Pattern 定夺（:239-247）。本仓等价物就是 keepPatternHits。
test('粗筛之后按每条模式定夺：勾了「区分大小写」就真的缩小集合', () => {
  const rows = [
    { path: 'a.ts', line: 1, text: '// todo 小写' },
    { path: 'a.ts', line: 2, text: '// TODO 大写' },
  ]
  const strict = [{ pattern: 'TODO', description: '待办', caseSensitive: true }]
  assert.deepEqual(keepPatternHits(rows, strict).map(row => [row.line, row.kind]), [[2, '待办']])
  const loose = [{ pattern: 'TODO', description: '待办' }]
  assert.deepEqual(keepPatternHits(rows, loose).map(row => row.line), [1, 2])
  // 表空 ⇒ 一个标记都没定义，什么都不留（不是"退回找 TODO"）。
  assert.deepEqual(keepPatternHits(rows, []), [])
  // 命中的那条模式给 kind（表序即优先级）。
  assert.deepEqual(keepPatternHits([{ path: 'a', line: 9, text: '// FIXME 修' }], patterns)
    .map(row => [row.line, row.kind]), [[9, '需要修']])
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

// 面板那一侧的三条判据（都能失败）：粗筛不包 \b、粗筛结果过 keepPatternHits 定夺、
// 标记过滤带上那条模式自己的 caseSensitive。
test('面板不再把「区分大小写」当摆设', () => {
  const panel = readFileSync('src/components/TodoPanel.vue', 'utf8')
  assert.match(panel, /keepPatternHits\(/, '扫描结果要按每条模式定夺，否则勾选毫无效果')
  assert.doesNotMatch(panel, /\\\\b\(/, '扫描查询不再隐式包 \\b(...)：模式按原样用')
  assert.match(panel, /markerMatches\(item\.text, filterPattern\.value, chosen\?\.caseSensitive/,
    '标记过滤要用选中模式自己的 caseSensitive')
  // 出厂空表时的引导文案指向页面真正所在的位置（SettingsDialog.vue:961 的标题是「编辑器 › TODO」，
  // 旧文案写的「项目结构」是这次搬页之前的错位）。
  assert.match(panel, /编辑器 › TODO/)
  assert.doesNotMatch(panel, /设置 › 项目结构 里增减/)
})
