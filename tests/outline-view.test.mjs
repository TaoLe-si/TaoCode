import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { arrange, outlineKey, treeOf } from '../src/outlineView.ts'
import {
  KIND_WEIGHT, compareAlphaKeysIgnoreCase, orderFileStructurePopup, symbolKindRank, symbolPresentableName,
} from '../src/outlineView.ts'

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

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

test('grouping by symbol kind orders members before fields, per level', () => {
  const mixed = treeOf([
    sym('C', 5, 0, 10),
    sym('bField', 8, 1, 2, 2),
    sym('zMethod', 6, 3, 4, 2),
    sym('aConst', 14, 5, 6, 2),
  ])
  assert.deepEqual(names(arrange(mixed, { sort: false, flat: false, filter: '' })), [
    'C:d0', 'C.bField:d1', 'C.zMethod:d1', 'C.aConst:d1',
  ], 'document order without grouping')
  assert.deepEqual(names(arrange(mixed, { sort: false, flat: false, group: true, filter: '' })), [
    'C:d0', 'C.zMethod:d1', 'C.bField:d1', 'C.aConst:d1',
  ], 'methods (rank 1) before fields/constants (rank 2), original order inside a rank')
  assert.deepEqual(names(arrange(mixed, { sort: true, flat: false, group: true, filter: '' })), [
    'C:d0', 'C.zMethod:d1', 'C.aConst:d1', 'C.bField:d1',
  ], 'name sort applies inside the kind group')
})

// 折叠（上游 `StructureViewComponent` 的树展开态）—— 判据在 src/outlineView.ts 的
// `OutlineEntry.hasChildren`/`collapsed` 与 `OutlineView.collapsed`。
test('collapsing a node hides its descendants and marks the caret state', () => {
  const runKey = outlineKey(symbols[1])                       // Sample.run
  const rows = arrange(tree, { sort: false, flat: false, filter: '', collapsed: new Set([runKey]) })
  assert.deepEqual(names(rows), ['Sample:d0', 'Sample.run:d1', 'Sample.calc:d1', 'main:d0'])
  const sample = rows[0]
  assert.equal(sample.hasChildren, true, 'Sample 还有子节点，要画箭头')
  assert.equal(sample.collapsed, false)
  const run = rows[1]
  assert.equal(run.key, runKey)
  assert.equal(run.hasChildren, true)
  assert.equal(run.collapsed, true)
  assert.equal(rows[2].symbol.name, 'calc', '被收起的子节点之后，后面的兄弟照常显示')
})

test('a node without children has no caret and collapsing it is a no-op', () => {
  const nestedKey = outlineKey(symbols[2])                    // Sample.run.nested（叶子）
  const rows = arrange(tree, { sort: false, flat: false, filter: '', collapsed: new Set([nestedKey]) })
  assert.deepEqual(names(rows), [
    'Sample:d0', 'Sample.run:d1', 'Sample.run.nested:d2', 'Sample.calc:d1', 'main:d0',
  ])
  assert.equal(rows[2].hasChildren, false)
  assert.equal(rows[2].collapsed, false)
})

test('the flat view ignores collapse state entirely', () => {
  const runKey = outlineKey(symbols[1])
  const rows = arrange(tree, { sort: false, flat: true, filter: '', collapsed: new Set([runKey]) })
  assert.deepEqual(names(rows), [
    'Sample:d0', 'Sample.run:d0', 'Sample.run.nested:d0', 'Sample.calc:d0', 'main:d0',
  ])
  assert.equal(rows.some(entry => entry.hasChildren), false, '平铺列表没有树，不画箭头')
})

test('an active filter auto-expands collapsed branches', () => {
  const runKey = outlineKey(symbols[1])
  const rows = arrange(tree, { sort: false, flat: false, filter: 'nest', collapsed: new Set([runKey]) })
  assert.deepEqual(names(rows), ['Sample:d0', 'Sample.run:d1', 'Sample.run.nested:d2'],
    '过滤命中在折叠的分支里时，路径要展开（IDEA speed search 同则）')
  assert.equal(rows[1].collapsed, false)
  assert.equal(rows[1].hasChildren, true)
})

test('outline keys identify a symbol by name and position', () => {
  const a = { name: 'run', kind: 6, startLine: 6, startChar: 4, endLine: 9, endChar: 8 }
  assert.notEqual(outlineKey(a), outlineKey({ ...a, startLine: 30 }), '同名不同位置的符号不能撞键')
  assert.equal(outlineKey(a), outlineKey({ ...a }), '同一个符号每次得到同一个键')
})

// 「不放假控件」的门禁：跟随编辑器光标那一格要真数据（编辑器光标）才画。
// 挂载点（src/components/ToolWindowView.vue 的 <OutlinePanel>）目前不传 `source`
// ⇒ 按钮必须带 `v-if="source"`。把 v-if 删掉（画一个点了没反应的开关）这条就红。
test('the follow-editor toggle is not rendered without caret data', () => {
  const panel = read('../src/components/OutlinePanel.vue')
  const row = panel.split('\n').find(line => line.includes('aria-label="跟随编辑器光标"'))
  assert.ok(row, '跟随编辑器光标那一格必须存在（上游 StructureViewComponent.java:804 的开关）')
  assert.match(row, /v-if="source"/, '没有编辑器光标数据时整格不渲染，不能留假开关')
  const mount = read('../src/components/ToolWindowView.vue')
  const tag = mount.split('\n').find(line => line.includes('<OutlinePanel'))
  assert.ok(tag, '结构视图必须挂在工具窗口里')
  if (!tag.includes(':source=')) {
    assert.match(row, /v-if="source"/, '挂载点没喂 source ⇒ 开关只能按 source 条件渲染（接线请求 W1）')
  }
})

// ---------------------------------------------------------------------------
// 种类档 = 上游 `KindSorter.java:33-58` 的权重表（数字照抄，映射逐条写在 src/outlineView.ts）。
// 上一版把「构造器/方法」与「属性/字段」各自压成同一档，于是这两对次序只能退回文档序。
// ---------------------------------------------------------------------------
test('构造器排在方法之前（KindSorter.java:46-49 的 30 分与 35 分）', () => {
  const list = treeOf([
    sym('Class', 5, 0, 20),
    sym('doWork', 6, 5, 6, 4),      // Method → 35
    sym('Class', 9, 2, 3, 4),       // Constructor → 30
    sym('doOther', 6, 8, 9, 4),
  ])
  assert.deepEqual(names(arrange(list, { sort: false, flat: false, group: true, filter: '' })), [
    'Class:d0', 'Class.Class:d1', 'Class.doWork:d1', 'Class.doOther:d1',
  ], '构造器（9）先于任何方法（6），与它们在文档里的位置无关')
  assert.deepEqual(names(arrange(list, { sort: false, flat: false, filter: '' })), [
    'Class:d0', 'Class.doWork:d1', 'Class.Class:d1', 'Class.doOther:d1',
  ], '不开种类档时保持文档序（工具窗口的出厂档：StructureViewFactoryImpl.java:51 的 ACTIVE_ACTIONS = ""）')
})

test('属性排在字段之前（KindSorter.java:51-55 的 40 分与 50 分）', () => {
  const list = treeOf([
    sym('count', 8, 1, 2, 2),        // Field → 50
    sym('size', 7, 3, 4, 2),         // Property → 40
    sym('TOTAL', 14, 5, 6, 2),       // Constant → 50
  ])
  assert.deepEqual(names(arrange(list, { sort: false, flat: false, group: true, filter: '' })), [
    'size:d0', 'count:d0', 'TOTAL:d0',
  ], '属性先于字段/常量；同档（50）内部保持文档序')
})

test('不认识的种类落最后一档，类型参数不在类型那一档（KindSorter.java:57 的 60 分）', () => {
  assert.equal(symbolKindRank(5), KIND_WEIGHT.type)
  assert.equal(symbolKindRank(10), KIND_WEIGHT.type)
  assert.equal(symbolKindRank(11), KIND_WEIGHT.type)
  assert.equal(symbolKindRank(23), KIND_WEIGHT.type)
  assert.equal(symbolKindRank(9), KIND_WEIGHT.constructor)
  assert.equal(symbolKindRank(6), KIND_WEIGHT.method)
  assert.equal(symbolKindRank(12), KIND_WEIGHT.method)
  assert.equal(symbolKindRank(7), KIND_WEIGHT.property)
  assert.equal(symbolKindRank(8), KIND_WEIGHT.field)
  assert.equal(symbolKindRank(13), KIND_WEIGHT.field)
  assert.equal(symbolKindRank(14), KIND_WEIGHT.field)
  assert.equal(symbolKindRank(22), KIND_WEIGHT.field)
  // 26 = TypeParameter：`getWeight` 只认七个 instanceof 分支，它不在其中 ⇒ 60 分。
  assert.equal(symbolKindRank(26), KIND_WEIGHT.other)
  assert.equal(symbolKindRank(1), KIND_WEIGHT.other, 'File 也是「其余」')
  assert.equal(symbolKindRank(999), KIND_WEIGHT.other)
  // 弹层那一档只有「类型」换权重（KindSorter.java:38 的 isPopup ? 53 : 10）。
  assert.equal(symbolKindRank(5, true), KIND_WEIGHT.typeInPopup)
  assert.equal(symbolKindRank(6, true), KIND_WEIGHT.method, '方法在弹层里仍是 35 分')
  assert.equal(symbolKindRank(8, true), KIND_WEIGHT.field, '字段在弹层里仍是 50 分')
})

// ---------------------------------------------------------------------------
// 名称档 = `Sorter.java:35-42` 的 `compareToIgnoreCase`（码元折叠），不是 JS 的 localeCompare。
// 键取 `getAlphaSortKey()`（`SorterUtil.java:13-17`），Java 侧就是光秃秃的名字
// （`JavaVariableBaseTreeElement.java:34-42`）。
// ---------------------------------------------------------------------------
test('名称档按码元折叠比：下划线不在字母之前（compareToIgnoreCase，不是 localeCompare）', () => {
  assert.equal(compareAlphaKeysIgnoreCase('_foo', 'Bar') > 0, true,
    "'_'(95) 对 'B'(66) ⇒ 上游判 _foo 在后；localeCompare 会判标点在前，那是另一种次序")
  assert.equal(compareAlphaKeysIgnoreCase('apple', 'Banana') < 0, true)
  assert.equal(compareAlphaKeysIgnoreCase('Beta', 'apple') > 0, true, '大写字母仍按字母本身比，不按码点分组')
  assert.equal(compareAlphaKeysIgnoreCase('run', 'run'), 0)
  assert.equal(compareAlphaKeysIgnoreCase('run', 'runner') < 0, true, '前缀短者在前')
  assert.equal(compareAlphaKeysIgnoreCase('', 'A') < 0, true, '取不到名字给 ""（JavaVariableBaseTreeElement.java:41）')
  const list = treeOf([sym('_hidden', 6, 0, 1), sym('Bar', 6, 3, 4), sym('alpha', 6, 6, 7)])
  assert.deepEqual(names(arrange(list, { sort: true, flat: false, filter: '' })),
    ['alpha:d0', 'Bar:d0', '_hidden:d0'],
    '码元折叠：alpha(A=65) < Bar(B=66) < _hidden(_=95)；localeCompare 会把下划线挪到最前')
})

test('显示名带上签名（上游的 presentation text = 名字 + detail）', () => {
  assert.equal(symbolPresentableName(sym('run', 6, 3, 9, 4, '(): void')), 'run(): void')
  assert.equal(symbolPresentableName(sym('count', 8, 1, 2, 2, ': int')), 'count: int')
  assert.equal(symbolPresentableName(sym('NoDetail', 5, 0, 9)), 'NoDetail', '服务器没给 detail ⇒ 不编一段签名')
  assert.equal(symbolPresentableName({ ...sym('x', 5, 0, 1), detail: undefined }), 'x', 'detail 缺失也不能变成 "undefined"')
  // 面板那一行画的必须是这个（`PsiMethodTreeElement.java:64-72` / `JavaVariableBaseTreeElement.java:24-33`）。
  const panel = read('../src/components/OutlinePanel.vue')
  assert.match(panel, /· \$\{symbolPresentableName\(symbol\)\}/, '行文本要由 presentable name 组成')
  assert.match(panel, /entry\.trail \? `\$\{entry\.trail\}\.\$\{symbolPresentableName\(entry\.symbol\)\}`/,
    'tooltip 的限定名那一支也要带上签名')
})

// ---------------------------------------------------------------------------
// 弹层（Ctrl+F12）的默认档位：`FileStructurePopup.java:750` 上 `getDefaultValue`（`:938-942`）
// ⇒ 名称档 + 种类档默认开，且用的是 `POPUP_INSTANCE`（`JavaFileTreeModel.java:68`
// + `KindSorter.java:38`）⇒ **嵌套类型落在成员下面**，工具窗口里它在最上面。
// ---------------------------------------------------------------------------
test('弹层默认档：逐层排、类型在成员之后（POPUP_INSTANCE）', () => {
  const symbols = [
    sym('Demo', 5, 0, 30),                       // 顶层类：弹层里 53 分
    sym('value', 8, 2, 3, 2),                    // 字段 50
    sym('toString', 6, 4, 6, 2),                 // 方法 35
    sym('Demo', 9, 7, 8, 2),                     // 构造器 30
    sym('Inner', 5, 10, 12, 2),                  // 嵌套类：与成员同一层判（53）
    sym('helper', 12, 35, 36),                   // 顶层函数 35（在 Demo 的区间之外）
  ]
  const rows = symbols.map((s, index) => ({ name: s.name, line: s.startLine, character: s.startChar, index }))
  const ordered = orderFileStructurePopup(symbols, rows)
  assert.deepEqual(ordered.map(row => row.name), ['helper', 'Demo', 'Demo', 'toString', 'value', 'Inner'],
    '顶层：成员在前（35）→ 类型（53）；类名下的成员自己再排一轮（构造器 30 → 方法 35 → 字段 50 → 嵌套类 53）')
  // 同一份符号在工具窗口里出厂不排（StructureViewFactoryImpl.java:51/:140-147）。
  assert.deepEqual(names(arrange(treeOf(symbols), { sort: false, flat: false, filter: '' })), [
    'Demo:d0', 'Demo.value:d1', 'Demo.toString:d1', 'Demo.Demo:d1', 'Demo.Inner:d1', 'helper:d0',
  ], '文档序 = 工具窗口的出厂样子，弹层的重排不能反过来影响它')
  // 行认不到时不丢行（稳定 + 末尾）。
  const extra = [...rows, { name: 'ghost', line: 99, character: 0, index: 6 }]
  assert.equal(orderFileStructurePopup(symbols, extra).length, 7)
  assert.equal(orderFileStructurePopup(symbols, extra).at(-1).name, 'ghost')
  assert.deepEqual(orderFileStructurePopup(symbols, [rows[0]]), [rows[0]], '0/1 行不重排')
})

// 接线判据：重排必须真的挂在**弹层那一条路**上（`fileSymbolEntries`），不能只在测试里被调用。
// 同时钉住「结构工具窗口那条路不经过它」—— 两条路的出厂档不同（弹层两档默认开、窗口全关），
// 接错一侧就等于把上游的两个默认值搅在一起。
test('接线：Ctrl+F12 那条路走弹层档位，结构工具窗口那条路不走', async () => {
  const navigation = read('../src/lspNavigation.ts')
  const wired = navigation.match(/return orderFileStructurePopup\(\s*outline\.value as NavigationDocumentSymbol\[\],\s*filterSymbols\(documentSymbolEntries\(outline\.value as NavigationDocumentSymbol\[\], path, query\), hiddenSymbolGroups\.value\)\)/)
  assert.ok(wired, 'fileSymbolEntries 没有把弹层档位接在过滤之后（orderFileStructurePopup 成死函数）')
  const panel = read('../src/components/OutlinePanel.vue')
  assert.equal(/orderFileStructurePopup/.test(panel), false, '结构工具窗口的出厂档是文档序，不许走弹层那份重排')
  // 2026-10-07 epclose2：面板先过 `com.intellij.structureViewBuilder` 类 EP（`outlineRowsFromProviders`），
  // 没有第三方构建器认领时仍回落 `arrange`，喂进去的仍是**面板自己的四档**（`view` 由本组件那几个开关拼）。
  // 判据意图不变：结构工具窗口那条路走的是本面板的档位，不是弹层那份重排。
  assert.match(panel, /sort: sortByName\.value, flat: flatView\.value, group: groupByKind\.value,/, '面板的档位仍是本组件自己的四个开关（不走弹层那份）')
  assert.match(panel, /\?\? arrange\(tree\.value, view\)/, '没有第三方构建器时仍回落 arrange(…, 面板自己的四档)')
})

test('真渲：一行的文本就是上游那份 presentation（名字 + 签名），过滤计数不受影响', async () => {
  const { createSSRApp, h } = await import('vue')
  const { renderToString } = await import('vue/server-renderer')
  const { loadSfc } = await import('./vue-sfc-loader.mjs')
  const { component } = loadSfc('src/components/OutlinePanel.vue')
  const symbols = [
    sym('run', 6, 3, 9, 4, '(): void'),
    sym('count', 8, 1, 2, 2, ': int'),
    sym('Bare', 5, 12, 20, 0, ''),
  ]
  const html = await renderToString(createSSRApp({
    render: () => h(component, { path: 'src/A.java', symbols, available: true }),
  }))
  assert.ok(html.includes('方法 · run(): void'), `行文本要带签名，实测没有：${html.match(/outline-kind[^<]*</)?.[0] ?? '没有 outline-kind'}`)
  assert.ok(html.includes('字段 · count: int'), '字段那一行同样带类型')
  assert.ok(html.includes('类 · Bare'), '服务器没给签名 ⇒ 只有名字，不编一段出来')
  assert.ok(html.includes('title="方法 · run(): void"'), 'tooltip 的那一支走同一个 presentable name')
})

// ---------------------------------------------------------------- 行图标（pvclose 2026-10-06）
// 上游 `LspStructureViewSupport.kt:21` 的 getIcon(symbol) 与层级侧
// `LspHierarchyNodeDescriptor.kt:48` 是同一条 `symbolKindCustomizer.getIcon(kind)`
// ⇒ 本仓**只有一张** kind→图标表（`src/hierarchyRenderer.ts:51-64`），结构视图走转发。

test('行图标是**转发**同一张表，不是本仓的第二份 SymbolKind→图标表', async () => {
  const { symbolRowIcon } = await import('../src/outlineView.ts')
  const { HIERARCHY_KIND_ICONS, hierarchyKindIcon } = await import('../src/hierarchyRenderer.ts')
  const kinds = Object.keys(HIERARCHY_KIND_ICONS).map(Number)
  assert.ok(kinds.length >= 10, `层级那张表至少得覆盖类型/方法/字段那几档，实测 ${kinds.length}`)
  for (const kind of kinds) {
    assert.equal(symbolRowIcon(kind), hierarchyKindIcon(kind), `kind ${kind} 必须转发给同一份表，不是另算`)
    assert.notEqual(symbolRowIcon(kind), null, `kind ${kind} 在层级侧有图标，结构侧不许丢`)
  }
  // 第二份表长什么样是明确的：在 outlineView.ts / 面板里再开一个 kind→组件的 Record 或 map。
  const view = read('../src/outlineView.ts')
  assert.equal(/Record<\s*number\s*,\s*Component/.test(view), false, 'outlineView.ts 里出现了第二张 kind→图标表')
  const panel = read('../src/components/OutlinePanel.vue')
  assert.equal(/KIND_ICONS/.test(panel), false, '面板里自己拼了一张图标表')
})

test('未识别的种类没有图标（不占图标位、不画假图标）', async () => {
  const { symbolRowIcon } = await import('../src/outlineView.ts')
  assert.equal(symbolRowIcon(1), null, 'File(1) 不在表里 ⇒ 应当是 null')
  assert.equal(symbolRowIcon(99), null, '越界的 kind 同样不猜图标')
})

test('真渲：认到的种类行行首画图标，认不到的那一行一个图标都不多画', async () => {
  const { createSSRApp, h } = await import('vue')
  const { renderToString } = await import('vue/server-renderer')
  const { loadSfc } = await import('./vue-sfc-loader.mjs')
  const { component } = loadSfc('src/components/OutlinePanel.vue')
  const symbols = [
    sym('Sample', 5, 1, 20),   // Class ⇒ 有图标
    sym('run', 6, 3, 9, 4),    // Method ⇒ 有图标
    sym('notes', 1, 11, 12),   // File ⇒ 没有，也不占位
  ]
  const html = await renderToString(createSSRApp({
    render: () => h(component, { path: 'src/B.java', symbols, available: true }),
  }))
  const icons = html.match(/class="[^"]*\boutline-icon\b[^"]*"/g) ?? []
  assert.equal(icons.length, 2, `三行里两行认得出种类 ⇒ 只该画 2 个图标，实测 ${icons.length}：${icons.join(' | ')}`)
  // 图标是装饰：文字那一份种类信息仍在，读屏不靠图形。（`tests/vue-sfc-loader.mjs` 把 lucide
  // 组件替成 `<span data-stub="…">`，所以这里钉的是** carrying outline-icon 那个元素本身**
  // 带 aria-hidden，而不是钉死标签名 —— 真机上那是 `<svg>`，判据两边都成立。）
  const iconTag = html.match(/<[a-z]+[^>]*class="[^"]*\boutline-icon\b[^"]*"[^>]*>/)
  assert.ok(iconTag, '没有一个带 outline-icon 的元素被画出来')
  assert.match(iconTag[0], /aria-hidden="true"/, '行图标没标 aria-hidden')
  assert.ok(html.includes('类 · Sample') && html.includes('方法 · run'), '加了图标不许把种类文字挤掉')
})

test('真渲：行序一个字没动（图标只贴在最前面，不参与排序）', async () => {
  const { createSSRApp, h } = await import('vue')
  const { renderToString } = await import('vue/server-renderer')
  const { loadSfc } = await import('./vue-sfc-loader.mjs')
  const { component } = loadSfc('src/components/OutlinePanel.vue')
  const symbols = [
    sym('zebra', 8, 1, 2), sym('alpha', 6, 3, 4), sym('Middle', 5, 5, 9),
  ]
  const html = await renderToString(createSSRApp({
    render: () => h(component, { path: 'src/C.java', symbols, available: true }),
  }))
  const order = ['zebra', 'alpha', 'Middle'].filter(name => html.indexOf(name) !== -1)
    .sort((a, b) => html.indexOf(a) - html.indexOf(b))
  assert.deepEqual(order, ['zebra', 'alpha', 'Middle'], '出厂档是文档序，图标不该改变它')
})

test('接线：面板走 outlineView 的 symbolRowIcon，没有绕过模块自己取组件', () => {
  const panel = read('../src/components/OutlinePanel.vue')
  assert.match(panel, /import \{[^}]*symbolRowIcon[^}]*\} from '\.\.\/outlineView/, '面板没从 outlineView 取图标')
  assert.match(panel, /icon: symbolRowIcon\(entry\.symbol\.kind\)/, '行上的 icon 不是 symbolRowIcon 算出来的')
  assert.match(panel, /<component v-if="entry\.icon" :is="entry\.icon"/, '模板没有真的把图标画出来')
  // 计数那一格仍按 arrange 的 rows 算，不是按贴了图标的 displayRows 另算一遍。
  assert.match(panel, /\{\{ filter\.trim\(\) \? `\$\{rows\.length\}\/\$\{symbols\.length\}` : symbols\.length \}\}/,
    '行首计数没走 rows（图标那一步应当不改行数）')
})
