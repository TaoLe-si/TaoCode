// `src/codeLens.ts` 的锚点归并规则 + `src/codeLensExtension.ts` 的接线：
//   · 同一个 LSP `range`（= 同一个符号）上多个 provider 的条目，上游放进**同一个 inlay 的列表**
//     用间隔逐个画（`CodeVisionListPainter.kt:37-49`、`DelimiterPainter.kt:26-28`），不是一行一条；
//   · 同一锚点可见条目的上限 5 来自 `CodeVisionHost.kt:85` 的 `defaultVisibleLenses`，
//     截断规则在 `CodeVisionListData.updateVisible()`（`CodeVisionListData.kt:45-57`）；
//   · `editor.codeVision.more.inlay` 缺省 false（`registry.properties:1759`），被截掉的条目没有入口；
//   · 渲染前先过 Code Vision 的总闸/组闸（`CodeVisionHost.kt:341` 与 `:348-350`），
//     闸在归并之前 ⇒ 关掉的组不占可见上限的槽位（见下面那几条 `renderedTitles` 用例）。
//
// 2026-10-06 codelens2：本文件原来有两条「接线：…」用 `readFileSync('src/codeLensExtension.ts')` +
// `includes`/正则，钉的是**源码/配置形状**（改个参数名就红，画错了反而测不出）。现在全部换成
// **渲染结果**判据：跑真实控制器与真实 provider 注册表，数 `EditorView.decorations` 里实际剩下
// 哪几条（等值比较，没有放松成 includes）。核心新增那一条是「四组逐组关掉 ⇒ 被关那一组 0 条」，
// 四个组 id 取上游 `PlatformCodeVisionIds.kt:5-7`（references/inheritors/problems）与
// `LspCodeVisionProvider.kt:20`。
//
// 2026-10-06 codelens3：codelens2 把"当场改表 ⇒ 装饰跟着变"钉死了，但**从盘上读回**那一条链
// 仍然只核配置读写（`restoreCodeVisionSettings` 的调用点在 `src/workspaceLifecycle.ts:224`，
// 判据只有 `code-vision-anchor-limit.test.mjs:110-123` 那一条"坏值回出厂 5"）。补的三条：
//   · 盘上写着关掉某一组 ⇒ 那一组装饰 0 条；换回出厂空数组 ⇒ 立刻回来（这一步把
//     `restoreCodeVisionSettings` 从"往旧表追加"改成上游 `CodeVisionSettings.kt:164-166` 的整份替换）；
//   · 缺键 = 保持现值、空数组 = 明确打开（两种"没写"要分清）；
//   · 设置页 SSR 真渲染四组复选框与数字格（旧实现只列两组时，右键关掉的那一族在界面上隐形）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createSSRApp, h, nextTick } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'
import { CODE_LENS_VISIBLE_MAX, anchoredLenses, groupAnchoredLenses } from '../src/codeLens.ts'
import { createCodeLens, setCodeLens } from '../src/codeLensExtension.ts'
import { createCodeVisionRegistry } from '../src/codeVisionProviders.ts'
import { CODE_VISION_HIDE_ALL_ID, CODE_VISION_HIDE_PROVIDER_ID, CODE_VISION_GROUP_IDS,
         INHERITORS_CODE_VISION_GROUP_ID, LSP_CODE_VISION_GROUP_ID, PROBLEMS_CODE_VISION_GROUP_ID,
         USAGES_CODE_VISION_GROUP_ID, codeVisionGroupName, codeVisionSettings, codeVisionSettingsPatch,
         handleCodeVisionExtraAction, restoreCodeVisionSettings, setCodeVisionGroupEnabled } from '../src/codeLensSettings.ts'

const lens = (line, title, extra = {}) => ({
  title, command: `cmd.${title}`,
  range: { startLine: line, startChar: 0, endLine: line, endChar: 1 }, ...extra,
})

test('同一锚点的条目归并成一行，顺序照适配器给的顺序', () => {
  const rows = groupAnchoredLenses(anchoredLenses([
    lens(3, 'usages'), lens(3, 'inheritors'), lens(3, 'problems'),
  ]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].line, 3)
  assert.deepEqual(rows[0].items.map(item => item.title), ['usages', 'inheritors', 'problems'])
  assert.equal(rows[0].hidden, 0)
})

test('同一行的两个不同锚点（startChar 不同）是两行，按 startChar 排序', () => {
  const rows = groupAnchoredLenses(anchoredLenses([
    { title: 'b', command: 'cmd.b', range: { startLine: 2, startChar: 20, endLine: 2, endChar: 25 } },
    { title: 'a', command: 'cmd.a', range: { startLine: 2, startChar: 4, endLine: 2, endChar: 8 } },
  ]))
  assert.deepEqual(rows.map(row => row.startChar), [4, 20])
  assert.deepEqual(rows.map(row => row.items.length), [1, 1])
})

test('可见上限是上游的 defaultVisibleLenses = 5，超出部分计入 hidden', () => {
  const items = Array.from({ length: 8 }, (_, index) => lens(0, `l${index}`))
  const rows = groupAnchoredLenses(anchoredLenses(items))
  assert.equal(CODE_LENS_VISIBLE_MAX, 5)
  assert.equal(rows[0].items.length, 5)
  assert.deepEqual(rows[0].items.map(item => item.title), ['l0', 'l1', 'l2', 'l3', 'l4'])
  assert.equal(rows[0].hidden, 3)
})

test('上限可覆盖（设置页的 anchorLimit 位）；非法上限退回缺省', () => {
  const items = Array.from({ length: 4 }, (_, index) => lens(0, `l${index}`))
  const rows = groupAnchoredLenses(anchoredLenses(items), 2)
  assert.equal(rows[0].items.length, 2)
  assert.equal(rows[0].hidden, 2)
  const many = Array.from({ length: 7 }, (_, index) => lens(0, `m${index}`))
  assert.equal(groupAnchoredLenses(anchoredLenses(many), 0)[0].items.length, CODE_LENS_VISIBLE_MAX)
})

test('行序稳定：不同行按行号排；同一锚点内不改顺序', () => {
  const rows = groupAnchoredLenses(anchoredLenses([lens(9, 'x'), lens(1, 'a'), lens(9, 'y'), lens(1, 'b')]))
  assert.deepEqual(rows.map(row => [row.line, row.items.map(item => item.title)]),
    [[1, ['a', 'b']], [9, ['x', 'y']]])
})

test('没有 range 的条目归并时也跳过（不编造位置）', () => {
  const rows = groupAnchoredLenses([{ line: 0, item: { title: 'x', command: 'cmd' } }, { line: 1, item: lens(1, 'ok') }])
  assert.deepEqual(rows.map(row => row.line), [1])
})

test('渲染落点：同锚点合成**一条**块装饰，非法条目根本进不了装饰集', () => {
  // 这条原来钉的是 `readFileSync('src/codeLensExtension.ts')` + 一串 includes/indexOf ——
  // 钉的是"源码长什么样"，改个参数名、挪一行注释都会红，而真正的回归（画错了）反而测不出。
  // 派单要求：同样精确地钉**渲染结果**（等值比较，不放松成 includes）。四件事逐个变成可数的东西：
  //   ① 同锚点两条 = **一条**装饰、行里两个条目（上游 `CodeVisionListPainter.kt:37-49` 的一行多条 +
  //      `DelimiterPainter.kt:26-28` 的间隔，本仓的等价物就是"一行两件"，不是"两条装饰"）；
  //   ② 装饰是**块**装饰、`side: -1`、落在锚点行的**行首**（Code Vision 在行上方，不是行内 inlay）；
  //   ③ 点击校验（`codeLensItemProblem`）在渲染**之前**就生效：坏命令的条目一条都不剩
  //      （原来这条钉的是源码里 `const payload = codeLensCommand(this.lens.item)` 那一行）；
  //   ④ 行号越界的条目跳过，界内的照常画（服务端算的时候文档可能已经变了）。
  const { state, rows } = renderedRows([gated(1, 'a'), gated(1, 'b')])
  assert.equal(rows.length, 1, '同锚点的两条被画成了两条装饰（上游是一个 inlay 里的一行多条）')
  assert.deepEqual(rows[0].titles, ['a', 'b'])
  assert.equal(rows[0].block, true, '不是块装饰 ⇒ 条目会挤进代码行里（那是 inlay hint 的位置）')
  assert.equal(rows[0].side, -1, 'side 不是 -1 ⇒ 条目会画到行下方')
  assert.equal(rows[0].from, state.doc.line(2).from, '装饰没落在锚点行的行首')
})

test('渲染落点：命令不合法的条目一条都不画（点击校验在渲染之前，不是渲染之后再挑）', () => {
  const span = line => ({ startLine: line, startChar: 0, endLine: line, endChar: 1 })
  const broken = [
    { title: '', command: 'cmd', range: span(1) },
    { title: '空白命令', command: '   ', range: span(1) },
    { title: '超长命令', command: 'x'.repeat(257), range: span(1) },
    { title: '参数不是数组', command: 'cmd', arguments: { a: 1 }, range: span(1) },
    { title: '参数过不了桥', command: 'cmd', arguments: [() => 1], range: span(1) },
    { title: '没有 range', command: 'cmd' },
  ]
  assert.deepEqual(renderedRows(broken).rows, [], '坏条目也被画出来了 ⇒ 点它会发出与看到的不一致的命令')
  // 混在好条目里也只留好的那一条（装饰集整体为空 ≠ 过滤在起作用，这一半才是判据）。
  const mixed = renderedRows([...broken, gated(1, 'good')])
  assert.deepEqual(mixed.rows.map(row => row.titles), [['good']])
})

test('渲染落点：行号越界的条目跳过，界内的照常画', () => {
  const rows = renderedRows([gated(1, 'in'), gated(99, 'out'), gated(2, 'in2')]).rows
  assert.deepEqual(rows.map(row => row.line), [1, 2], '越界条目没被跳过，或界内条目被一起丢了')
})

// —— 渲染闸（`shouldShowCodeVisionEntry` 的消费点）———————————————————————————
// 上游在**收集**那一步就把不该出现的条目挡在外面，不是画出来再藏：
//   · 总闸：`platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionHost.kt:341`
//     `if (!lifeSettingModel.isEnabledWithRegistry.value) return emptyList()`，它读的是
//     `platform/lang-api/src/com/intellij/codeInsight/codeVision/settings/CodeVisionSettings.kt:55-56`
//     的 `var codeVisionEnabled`；
//   · 组闸：同文件 `:348-350` —— `val settings = CodeVisionSettings.getInstance()` /
//     `for (provider in providers) { if (!settings.isProviderEnabled(provider.groupId)) continue`；
//   · `isProviderEnabled` 本身**不看总闸**（`CodeVisionSettings.kt:93-95` 的注释
//     `Ignores [State.isEnabled]`，实现 `:96-104`），所以两层是 AND —— 正是
//     `src/codeLensSettings.ts:119-124` 的 `shouldShowCodeVisionEntry`。
// 本仓没有后台收集线程，等价的落点就是 `buildDecorations`（装饰集是唯一"出现"条目的地方）。
const GATED_DOC = 'class A {\n  void f() {}\n  void g() {}\n}\n'
const gated = (line, title, providerId) => ({
  title, command: `cmd.${title}`, providerId,
  range: { startLine: line, startChar: 0, endLine: line, endChar: 1 },
})

/** 从一份编辑器状态里读回实际画出来的装饰（位置、块/`side`、每行的条目与 `hidden`）。 */
function rowsOfState(state) {
  const rows = []
  for (const value of state.facet(EditorView.decorations)) {
    const set = typeof value === 'function' ? value(state) : value
    if (!set || !set.between) continue
    set.between(0, state.doc.length, (from, _to, decoration) => {
      const row = decoration?.spec?.widget?.row
      rows.push({
        from, block: decoration?.spec?.block, side: decoration?.spec?.side,
        line: row?.line ?? null, titles: row?.items.map(item => item.title) ?? [], hidden: row?.hidden ?? null,
      })
    })
  }
  return rows
}

/**
 * 真跑一遍渲染通道：把这些条目送进 `setCodeLens`，读回装饰集里**实际画出来的东西**
 * （位置、块/行内、`side`、每行的条目与 `hidden`），而不是源码文本。
 */
function renderedRows(items) {
  const controller = createCodeLens({
    query: async () => ({ available: true, items: [] }),
    enabled: () => false, view: () => undefined, onCommand: () => {},
  })
  try {
    const base = EditorState.create({ doc: GATED_DOC, extensions: [controller.extension] })
    const state = base.update({ effects: setCodeLens.of(anchoredLenses(items)) }).state
    const rows = rowsOfState(state)
    return { state, rows, titles: rows.flatMap(row => row.titles) }
  } finally {
    controller.dispose()
  }
}

/** 只要"画出了哪几条"的用例走这一层（与重写前的 `renderedTitles` 逐字同义）。 */
function renderedTitles(items) {
  return renderedRows(items).titles
}

/** 那份单例设置表的快照/回滚（异步用例里 `withSettings` 那种 try/finally 不便用时用这两个）。 */
function captureSettings() {
  return { enabled: codeVisionSettings.enabled, visibleEntries: codeVisionSettings.visibleEntries,
    disabled: { ...codeVisionSettings.disabledGroups }, enabledGroups: { ...codeVisionSettings.enabledGroups } }
}
function applySettings(saved) {
  codeVisionSettings.enabled = saved.enabled
  codeVisionSettings.visibleEntries = saved.visibleEntries
  codeVisionSettings.disabledGroups = saved.disabled
  codeVisionSettings.enabledGroups = saved.enabledGroups
}

/** 用完把单例恢复成出厂档，别把闸漏给同文件后面的用例。 */
function withSettings(patch, run) {
  const before = captureSettings()
  try {
    codeVisionSettings.enabled = patch.enabled ?? true
    for (const id of patch.disabled ?? []) setCodeVisionGroupEnabled(id, false)
    return run()
  } finally {
    applySettings(before)
  }
}

test('闸全开时两条通道都画（服务端 lens 归 LSP 组、本地条目归自己的组）', () => {
  const titles = renderedTitles([gated(1, 'usages'), gated(1, '2 个错误', 'problems')])
  assert.deepEqual(titles, ['usages', '2 个错误'])
})

test('总闸关掉 ⇒ 整族一条都不画（上游收集入口的 return emptyList）', () => {
  const all = [gated(1, 'usages'), gated(2, 'inheritors'), gated(1, '2 个错误', 'problems')]
  assert.equal(renderedTitles(all).length, 3)
  assert.deepEqual(withSettings({ enabled: false }, () => renderedTitles(all)), [])
})

test('关掉某一组只少那一组：服务端 lens 归并键是 LspCodeVisionProvider', () => {
  const items = [gated(1, 'usages'), gated(2, 'inheritors'), gated(1, '2 个错误', 'problems')]
  assert.deepEqual(withSettings({ disabled: [LSP_CODE_VISION_GROUP_ID] }, () => renderedTitles(items)), ['2 个错误'])
  assert.deepEqual(withSettings({ disabled: ['problems'] }, () => renderedTitles(items)), ['usages', 'inheritors'])
})

test('闸在归并**之前**：关掉的组不占 defaultVisibleLenses=5 的槽位', () => {
  // 同一锚点上 3 条服务端 + 3 条本地，**本地在前**（合流规则 `mergeCodeVisionEntries` 就是本地优先）。
  // 闸在后 ⇒ 6 条先归并截 5 ⇒ 留下 L1,L2,L3,s1,s2，再滤掉本地只剩 ['s1','s2']；
  // 闸在前 ⇒ 本地那 3 条根本不进归并 ⇒ ['s1','s2','s3'] 全在。这条用例的区别点就在这里。
  const items = [gated(1, 'L1', 'problems'), gated(1, 'L2', 'problems'), gated(1, 'L3', 'problems'),
                 gated(1, 's1'), gated(1, 's2'), gated(1, 's3')]
  const visible = withSettings({ disabled: ['problems'] }, () => renderedTitles(items))
  assert.deepEqual(visible, ['s1', 's2', 's3'])
  assert.equal(CODE_LENS_VISIBLE_MAX, 5)
})

test('右键「隐藏这一组」/「全部隐藏」：写完设置就按新闸原地重画，且不再问服务器', async () => {
  // 这条原来钉的是源码文本（`extension.includes('if (handleCodeVisionExtraAction…')` 两行）。
  // 按派单改成同样精确的**渲染结果**判据：走右键真正执行的那两个函数
  // （`src/codeLensExtension.ts` 菜单项的 onPick = `handleCodeVisionExtraAction` + `onGateApplied`，
  // 后者就是 `watch(codeVisionSettings)` 里那一句 `applyGateChange`），看装饰集里剩下什么。
  // 不在这里点 DOM：Node 没有 document，菜单本身由渲染通道的样式/事件负责，与闸无关。
  const items = [gated(1, 'usages'), gated(2, 'inheritors'), gated(1, '2 个错误', 'problems')]
  const before = captureSettings()
  let queries = 0
  let state = null
  const view = { dispatch: spec => { state = state.update(spec).state } }
  const controller = createCodeLens({
    // `enabled: () => false` ⇒ 控制器自己一次都不会问；问了就是"关一组去重问一次服务器"。
    query: async () => { queries++; return { available: true, items: [] } },
    enabled: () => false, view: () => view, onCommand: () => {},
  })
  try {
    state = EditorState.create({ doc: GATED_DOC, extensions: [controller.extension] })
    state = state.update({ effects: setCodeLens.of(anchoredLenses(items)) }).state
    assert.deepEqual(rowsOfState(state).flatMap(row => row.titles), ['usages', '2 个错误', 'inheritors'])
    // ①「隐藏这一组」：problems 整组从装饰集里消失，其余两组一条不少。
    assert.equal(handleCodeVisionExtraAction(CODE_VISION_HIDE_PROVIDER_ID, 'problems'), true)
    await nextTick()
    assert.deepEqual(rowsOfState(state).flatMap(row => row.titles), ['usages', 'inheritors'],
      '隐藏 problems 之后装饰集不是"只剩另两组"（要么没重画，要么关错了组）')
    assert.equal(queries, 0, '关一组又去问了一次服务器（上游 `CodeVisionSettings.kt:120` 广播的是"重新收集"）')
    // ②「全部隐藏」：总闸关掉 ⇒ 装饰集空，仍然不问服务器。
    assert.equal(handleCodeVisionExtraAction(CODE_VISION_HIDE_ALL_ID, LSP_CODE_VISION_GROUP_ID), true)
    await nextTick()
    assert.deepEqual(rowsOfState(state), [], '「全部隐藏」之后装饰集没清空')
    assert.equal(queries, 0)
  } finally {
    controller.dispose()
    applySettings(before)
  }
})

// —— 四组逐组关（渲染侧的组 = 设置页能勾的组 = 盘上允许存的组）—————————————————
// 上面几条的条目是手工带 `providerId` 的。本仓**真会渲染**的组一共四组，本地那三组的 id
// 不是本仓起的：`platform/lang-impl/src/com/intellij/codeInsight/codeVision/settings/PlatformCodeVisionIds.kt:5-7`
// = `USAGES("references")` / `INHERITORS("inheritors")` / `PROBLEMS("problems")`，
// 服务端 lens 那一组 = `platform/lsp-impl/src/impl/features/codeLens/LspCodeVisionProvider.kt:20`。
// 派单要的判据就是这一条：**关某组 ⇒ 那组在 CodeMirror 装饰集里产出 0 条**，
// 而且条目取自真实注册表（`createCodeVisionRegistry().compute(...)`），不是测试自己拼的 providerId。
const VISION_CONTEXT = {
  path: 'src/A.java', language: 'java',
  // kind 5 = class、6 = method（LSP SymbolKind），锚点白名单见 `src/codeVisionProviders.ts`。
  outline: [
    { name: 'A', kind: 5, startLine: 0, endLine: 3, startChar: 6 },
    { name: 'f', kind: 6, startLine: 1, endLine: 1, startChar: 7 },
  ],
  problems: [{ line: 1, severity: 1 }],
  usages: [{ line: 1, character: 7, count: 3 }],
  inheritors: [{ line: 0, character: 6, count: 2 }],
}
/**
 * 测试自己把四组的 id **逐字**列一遍（不取 `CODE_VISION_GROUP_IDS`）：取它就等于让白名单自己
 * 决定"测几组"，白名单退回两组时这条会跟着变短 ⇒ 假绿。常量值本身在下面那条同源用例里核。
 */
const EXPECTED_GROUPS = ['LspCodeVisionProvider', 'problems', 'references', 'inheritors']
/** 每组应当各贡献且只贡献这些条目（标题文案由各自的 provider 产出，测试不自己拼）。 */
const GROUP_TITLES = {
  LspCodeVisionProvider: ['run'],
  references: ['3 个用法'],
  inheritors: ['2 个继承者'],
  problems: ['1 个错误'],
}
const sorted = values => [...values].sort()
const titlesOfAllGroups = () => sorted(Object.values(GROUP_TITLES).flat())

test('真实注册表确实产出那三组本地条目 + 服务端 lens 一组（否则下面的"关掉⇒0 条"是空对空）', () => {
  const local = createCodeVisionRegistry().compute(VISION_CONTEXT)
  assert.deepEqual(sorted(local.map(entry => entry.providerId)), sorted(['problems', 'references', 'inheritors']),
    '注册表产出的组与预期不符（provider id 改了 ⇒ 下面那几条会假绿）')
  assert.deepEqual(sorted(local.map(entry => entry.title)),
    sorted(titlesOfAllGroups().filter(title => !GROUP_TITLES[LSP_CODE_VISION_GROUP_ID].includes(title))))
})

test('四组逐组关掉：被关那一组在装饰集里是 0 条，其余三组一条不少（真通道、真注册表）', async () => {
  globalThis.window = { setTimeout, clearTimeout }   // 控制器用 window.setTimeout 去抖，Node 里没有 DOM
  const registry = createCodeVisionRegistry()
  let queries = 0
  let state = null
  // 假 view 要**有 `state` 这一格**（控制器读的是 `state.doc` 那份文档修订号，见
  // `src/codeLensExtension.ts` 的 `semanticRevisionOf`），并且 `dispatch` 把事务真的作用回状态上。
  const view = { get state() { return state }, dispatch: spec => { state = state.update(spec).state } }
  const controller = createCodeLens({
    query: async () => {
      queries++
      return { available: true, items: [{ title: 'run', command: 'editor.run', range: { startLine: 0, startChar: 6, endLine: 0, endChar: 7 } }] }
    },
    enabled: () => true, view: () => view, onCommand: () => {},
    local: () => registry.compute(VISION_CONTEXT),
    policy: { openMs: 0, changeMs: 0, focusMs: 0 },
  })
  const before = captureSettings()
  try {
    state = EditorState.create({ doc: GATED_DOC, extensions: [controller.extension] })
    controller.schedule('open')
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(queries, 1, '一轮刷新应该只问服务器一次')
    assert.deepEqual(sorted(rowsOfState(state).flatMap(row => row.titles)), titlesOfAllGroups(),
      '四组全开时应画出这四条（少一条 ⇒ 下面每条用例的"其余三组"就不成立）')
    for (const groupId of EXPECTED_GROUPS) {
      const snapshot = captureSettings()
      try {
        setCodeVisionGroupEnabled(groupId, false)
        await nextTick()
        const left = sorted(rowsOfState(state).flatMap(row => row.titles))
        const expected = sorted(titlesOfAllGroups().filter(title => !GROUP_TITLES[groupId].includes(title)))
        assert.deepEqual(left, expected, `关掉 ${groupId} 之后装饰集里剩的就是那一条`)
        assert.equal(left.filter(title => GROUP_TITLES[groupId].includes(title)).length, 0,
          `关掉 ${groupId} 之后它自己那组仍有装饰`)
        assert.equal(queries, 1, `关 ${groupId} 不该重新问服务器（上游只广播"重新收集"）`)
      } finally {
        applySettings(snapshot)
        await nextTick()
      }
    }
    assert.deepEqual(sorted(rowsOfState(state).flatMap(row => row.titles)), titlesOfAllGroups(), '回滚后四组要都在')
  } finally {
    controller.dispose()
    applySettings(before)
  }
})

test('能被关掉的组 = 真会渲染的组：白名单与注册表同源，四组的组名都不退回 id', async () => {
  const { previewSettingsError } = await import('../src/previewSettings.ts')
  const languages = ['java', 'cpp', 'typescript', 'other']
  // ⓪ 四个组 id 常量的**值**逐字等于上游的组键（`PlatformCodeVisionIds.kt:5-7` + `LspCodeVisionProvider.kt:20`），
  //    白名单就是这四个 ⇒ 少一列（或把 id 改名）当场红，而不是让上面那条用例悄悄少测一组。
  assert.deepEqual([LSP_CODE_VISION_GROUP_ID, PROBLEMS_CODE_VISION_GROUP_ID,
                    USAGES_CODE_VISION_GROUP_ID, INHERITORS_CODE_VISION_GROUP_ID].slice().sort(),
    sorted(EXPECTED_GROUPS), '四个组 id 常量与上游组键不再逐字相同')
  assert.deepEqual(CODE_VISION_GROUP_IDS.slice().sort(), sorted(EXPECTED_GROUPS),
    'CODE_VISION_GROUP_IDS 少了/多了组：设置页、预览校验与原生白名单就是这一份')
  // ① 注册表里每一个 provider id 都必须在白名单里（少一个 ⇒ 右键隐藏那一组之后盘上存不下，
  //    下一次读盘还会被 `validate_editor_patch` 判 INVALID_SETTINGS）。
  const produced = createCodeVisionRegistry().providers().map(provider => provider.id)
  assert.deepEqual(sorted(EXPECTED_GROUPS), sorted([LSP_CODE_VISION_GROUP_ID, ...produced]),
    '真实 provider 的集合与白名单不相等（渲染会产出的组必须全部能被关掉）')
  // ② 四组逐组都能写进盘上那两把键（前端预览态与原生同一套规则）。
  for (const id of CODE_VISION_GROUP_IDS) {
    assert.equal(previewSettingsError('codeVisionDisabledGroups', [id], languages), null, `${id} 关不掉：白名单不认这一组`)
    assert.equal(previewSettingsError('codeVisionEnabledGroups', [id], languages), null, `${id} 打不开：白名单不认这一组`)
    assert.notEqual(codeVisionGroupName(id), id, `${id} 的组名退回了裸 id（右键菜单与设置页会露出内部 id）`)
  }
  // ③ 未知组与非字符串条目仍然拒（把白名单放开不等于取消校验）。
  assert.equal(previewSettingsError('codeVisionDisabledGroups', ['nope'], languages), '无效设置：codeVisionDisabledGroups')
  assert.equal(previewSettingsError('codeVisionDisabledGroups', [42], languages), '无效设置：codeVisionDisabledGroups')
  assert.equal(previewSettingsError('codeVisionEnabledGroups', [['problems']], languages), '无效设置：codeVisionEnabledGroups')
})

// —— 从**盘上**读回那一条链（不是设置页/右键当场写表）———————————————————————
// 上面几条吃的都是 `setCodeVisionGroupEnabled` —— 那是"当场生效"那两个入口（设置页勾、右键隐藏）。
// 这一条吃的是 `restoreCodeVisionSettings(...)`，也就是 `src/workspaceLifecycle.ts:224` 在
// 打开工程时灌进运行时表的那一份（四把键来自 `native/settings_schema.cpp:414-417` 的默认值）。
// 为什么要单独钉：**"存得下"与"存了会画"是两件事** —— 白名单、`codeVisionSettingsPatch()`、
// 原生校验都能绿，而读回那一步写成"往旧表里追加"照样让装饰集与盘上相反
// （工程 A 关掉 `references`，打开盘上写着空数组的工程 B 时那一组仍然不画 —— 2026-10-06 codelens3
// 就是照这条把 `restoreCodeVisionSettings` 改成整份替换的；上游 `CodeVisionSettings.kt:164-166`
// 的 `loadState` 换掉整个 `State`，那两个集合是 `State` 上的 `var`（`:45`/`:50`））。
/** 盘上那四把键的一份草稿；缺省 = 出厂档（原生侧补的那四个默认值）。 */
const diskDraft = patch => ({
  codeVisionEnabled: true, disabledGroups: [], enabledGroups: [], codeVisionVisibleEntries: 5, ...patch,
})

/** 起一条"四组都会画"的真通道：服务端 lens 只问一次，本地三组吃真实注册表。 */
async function fourGroupChannel() {
  globalThis.window = { setTimeout, clearTimeout }   // 控制器用 window.setTimeout 去抖，Node 里没有 DOM
  const registry = createCodeVisionRegistry()
  let queries = 0
  let state = null
  // 同上一条用例：假 view 要有 `state`（控制器读文档修订号走的是 `state.doc`）。
  const view = { get state() { return state }, dispatch: spec => { state = state.update(spec).state } }
  const controller = createCodeLens({
    query: async () => {
      queries++
      return { available: true, items: [{ title: 'run', command: 'editor.run',
        range: { startLine: 0, startChar: 6, endLine: 0, endChar: 7 } }] }
    },
    enabled: () => true, view: () => view, onCommand: () => {},
    local: () => registry.compute(VISION_CONTEXT),
    policy: { openMs: 0, changeMs: 0, focusMs: 0 },
  })
  state = EditorState.create({ doc: GATED_DOC, extensions: [controller.extension] })
  controller.schedule('open')
  await new Promise(resolve => setTimeout(resolve, 20))
  return { controller, queries: () => queries, titles: () => sorted(rowsOfState(state).flatMap(row => row.titles)) }
}

/** 某一组关掉时装饰集里应当剩下的那几条（其余三组一条不少）。 */
const titlesWithout = (...groupIds) =>
  sorted(titlesOfAllGroups().filter(title => !groupIds.some(id => GROUP_TITLES[id].includes(title))))

test('盘上写着「关掉某一组」⇒ 那一组在装饰集里 0 条；换回出厂空数组 ⇒ 立刻回来（读回是整份替换）', async () => {
  const before = captureSettings()
  const { controller, queries, titles } = await fourGroupChannel()
  try {
    assert.deepEqual(titles(), titlesOfAllGroups(), '开局四组没都画出来 ⇒ 下面每条都是空对空')
    assert.equal(queries(), 1, '一轮刷新应该只问服务器一次')
    for (const groupId of EXPECTED_GROUPS) {
      const snapshot = captureSettings()
      try {
        // ① 关：入参形状与 `src/workspaceLifecycle.ts:224` 逐字相同（四把键一起给）。
        restoreCodeVisionSettings(diskDraft({ disabledGroups: [groupId] }))
        await nextTick()
        assert.deepEqual(titles(), titlesWithout(groupId),
          `盘上关掉 ${groupId} 之后，装饰集里剩的不是"其余三组"（要么那一组还在，要么关错了组）`)
        assert.equal(queries(), 1, `读回一份新设置又去问了一次服务器（上游 loadState 之后只是失效重收集）`)
        // ② 开：盘上回到出厂空数组 ⇒ 那一组必须立刻回来。旧实现（只加不删）在这一半红。
        restoreCodeVisionSettings(diskDraft({}))
        await nextTick()
        assert.deepEqual(titles(), titlesOfAllGroups(),
          `盘上不再关 ${groupId} 之后它没回来 ⇒ 读回是"追加"而不是"整份替换"，界面与装饰集相反`)
      } finally {
        applySettings(snapshot)
        await nextTick()
      }
    }
    // ③ 存盘出口 ↔ 读回入口对四组无损：关两组 → `codeVisionSettingsPatch()` → 原样灌回 ⇒ 画出来的一样。
    restoreCodeVisionSettings(diskDraft({ disabledGroups: [USAGES_CODE_VISION_GROUP_ID, PROBLEMS_CODE_VISION_GROUP_ID] }))
    await nextTick()
    const closed = titles()
    assert.deepEqual(closed, titlesWithout(USAGES_CODE_VISION_GROUP_ID, PROBLEMS_CODE_VISION_GROUP_ID))
    const saved = codeVisionSettingsPatch()
    assert.deepEqual(sorted(saved.disabledGroups), sorted([USAGES_CODE_VISION_GROUP_ID, PROBLEMS_CODE_VISION_GROUP_ID]),
      '存盘出口没带上关掉的这两组（L-4 一接，重启就会把它们画回来）')
    assert.equal(saved.codeVisionEnabled, true)
    assert.equal(saved.codeVisionVisibleEntries, 5, '存盘出口没带上每锚点条数')
    restoreCodeVisionSettings(diskDraft({}))                       // 先读到一份出厂档
    await nextTick()
    assert.deepEqual(titles(), titlesOfAllGroups())
    restoreCodeVisionSettings(saved)                                // 再把存的那一份原样灌回
    await nextTick()
    assert.deepEqual(titles(), closed, 'patch → restore 这一趟往返改变了渲染结果（存下来的不是画出来的那份）')
    assert.equal(queries(), 1, '读回设置的过程中又问了一次服务器')
  } finally {
    controller.dispose()
    applySettings(before)
  }
})

test('缺键 = 保持现值（旧存档没有这一键时不许把已关的那一组偷偷打开）', async () => {
  const before = captureSettings()
  try {
    restoreCodeVisionSettings(diskDraft({ disabledGroups: [USAGES_CODE_VISION_GROUP_ID] }))
    assert.deepEqual(renderedTitles([gated(1, 'usages', USAGES_CODE_VISION_GROUP_ID), gated(1, 'other')]), ['other'],
      '关掉之后那一组还在画（前置条件就不成立）')
    // 一份只带总闸与条数的补丁（旧存档的形状）：两组集合都不在 ⇒ 谁也不许被改动。
    restoreCodeVisionSettings({ codeVisionEnabled: true, codeVisionVisibleEntries: 3 })
    assert.deepEqual(renderedTitles([gated(1, 'usages', USAGES_CODE_VISION_GROUP_ID), gated(1, 'other')]), ['other'],
      '盘上没写这一组，读回时却被打开了')
    assert.equal(codeVisionSettings.visibleEntries, 3, '带了的键没生效（读回只认正整数，3 是合法值）')
    // 空数组是"写了"，不是"没写"：整份替换的语义要能真的把那一组打开。
    restoreCodeVisionSettings(diskDraft({}))
    assert.deepEqual(renderedTitles([gated(1, 'usages', USAGES_CODE_VISION_GROUP_ID), gated(1, 'other')]), ['usages', 'other'])
  } finally {
    applySettings(before)
  }
})

// —— 设置页那一侧：四组的复选框是真的按盘上那一份勾着（不是数源码） ————————————
// 钉的是 codelens2 在本页落的那两件事（`src/components/CodeVisionSettingsPage.vue:51` 的
// `GROUPS = CODE_VISION_GROUP_IDS`、`:76-77` 把第四把键刷进运行时表）。旧实现只列两组 ⇒
// 「用法计数 / 继承者计数」两个复选框**根本不存在**，用户在页面上看不到自己右键关掉的那一族。
// 这里 SSR 真渲染那一份组件，读回来的是 HTML 里的复选框与勾选状态。
/** 用一份草稿编辑器设置渲染 Code Vision 页，返回 HTML 文本。 */
async function renderVisionPage(settings) {
  const { component } = loadSfc('src/components/CodeVisionSettingsPage.vue')
  const app = createSSRApp({ render: () => h(component, { settings, busy: false }) })
  app.config.warnHandler = message => { throw new Error(`CodeVisionSettingsPage 渲染告警：${message}`) }
  return renderToString(app)
}

test('设置页按盘上那一份勾着**四**组：勾掉的那一组没打勾，数字格吃第四把键', async () => {
  const draft = {
    codeVisionEnabled: true, codeVisionVisibleEntries: 3,
    codeVisionDisabledGroups: [USAGES_CODE_VISION_GROUP_ID], codeVisionEnabledGroups: [],
  }
  const html = await renderVisionPage(draft)
  // ① 四组都在页上（少一组 = 右键关掉的那一族在界面上是隐形的）。
  for (const id of CODE_VISION_GROUP_IDS) {
    const label = `显示 ${codeVisionGroupName(id)} 嵌入提示`
    const at = html.indexOf(label)
    assert.ok(at > 0, `设置页上没有「${label}」这一行的复选框（白名单与页面不同源）`)
    // ② 勾的状态就是盘上那一份：往前找这一行里的那个 `<input …>`，只有"没被关掉"的那三组带 checked。
    const input = html.slice(html.lastIndexOf('<input', at), at)
    assert.match(input, /aria-describedby="cv-group-[a-zA-Z]+-hint"/, `「${label}」那一条不是分组复选框`)
    assert.equal(input.includes('checked'), id !== USAGES_CODE_VISION_GROUP_ID,
      `「${label}」的勾选状态与盘上那份不一致（关掉的是 ${USAGES_CODE_VISION_GROUP_ID}）`)
  }
  // ③ 第四把键（每锚点条数）真的进到了那一格里，不是写死的 5。
  assert.match(html, /<input[^>]*type="number"[^>]*value="3"/, '数字格没按盘上那一份显示（第四把键在页面上是死的）')
  assert.match(html, /min="1" max="10"/, '那一格的界不是上游的 spinner(1..10, 1)')
})

// —— 原生那一份白名单与前端口径同源（2026-10-06 codevision2）——————————————————
// 上面两条核的都是**前端**那一份（`CODE_VISION_GROUP_IDS`）与设置页。把白名单砍成两组的那次事故
// 发生在**原生**那一份（`native/settings_editor_keys.hpp` 的 Code Vision 分支），而那份的判据在
// ctest（`native/settings_editor_keys_test.cpp`）里 —— ctest 不跑在 JS 门禁这一侧 ⇒ 少一组这件事
// 在 JS 侧**没人喊**，而后果不是"少一个选项"：运行时那张表由右键「隐藏这一组」直接写
// （`src/codeLensSettings.ts` 的 `handleCodeVisionExtraAction` 不查白名单），写进去的那一组在
// 读盘那一条链（`project_settings_state.cpp` 的 prune → `validate_editor_patch` → 补默认）被判
// INVALID_SETTINGS ⇒ **整本编辑器设置**都存不下去、也读不回来。
// 所以这三份账（上游组键 / 前端常量 / 原生白名单 / ctest 那份清单）必须逐字钉在一起：
// `EXPECTED_GROUPS` 是上游组键的**逐字拷贝**（不取前端常量，取它等于让白名单自己决定测几组）。
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const readNative = relative => readFileSync(join(REPO_ROOT, relative), 'utf8')

/** 从 hpp 里取 Code Vision 那两个组集合的校验分支正文（从 `key ==` 到那一个 `return true;`）。 */
function nativeGroupBranch(hpp) {
  const start = hpp.indexOf('key == "codeVisionDisabledGroups"')
  if (start < 0) return null
  const end = hpp.indexOf('return true;', start)
  return end < 0 ? null : hpp.slice(start, end)
}

test('原生白名单 = 前端白名单 = 上游那四个组键（少一组 = 右键隐藏那一组之后整本设置存不下去）', () => {
  const hpp = readNative('native/settings_editor_keys.hpp')
  const branch = nativeGroupBranch(hpp)
  assert.ok(branch, 'native/settings_editor_keys.hpp 里找不到那两个组集合的校验分支（分支被删 ⇒ 组数组只剩"必须是数组"这一道，什么组 id 都能存）')
  const nativeIds = [...branch.matchAll(/id !=+ "([^"]+)"/g)].map(match => match[1])
  assert.deepEqual(nativeIds.slice().sort(), sorted(EXPECTED_GROUPS),
    `原生白名单与上游组键不再逐字相同（实得 ${JSON.stringify(nativeIds)}）—— 少一组就是那条"存不下去"的缺陷`)
  assert.equal(nativeIds.length, 4, '原生白名单被改短了（四组 ⇒ 上游三个本地组键 + LSP 那一组）')
  // 拒未知组这件事本身不能跟着没（放开白名单 ≠ 取消校验）。
  assert.match(branch, /Unknown Code Vision group/, '那条分支不再拒绝未知组')
  assert.match(branch, /的条目必须是组 id 字符串/, '那条分支不再拒绝非字符串条目')
  // ctest 那一份清单（`native/settings_editor_keys_test.cpp`）也跟着同源：两边一起改短，
  // 上面那两条会同时失效 ⇒ 这一条是那条"自己决定测几组"的兜底。
  const cppTest = readNative('native/settings_editor_keys_test.cpp')
  const listed = cppTest.match(/const char\* const known_groups\[\]\s*=\s*\{([^}]*)\}/)
  assert.ok(listed, 'ctest 里没有那份四组清单')
  assert.deepEqual([...listed[1].matchAll(/"([^"]+)"/g)].map(match => match[1]).sort(), sorted(EXPECTED_GROUPS),
    'ctest 的 known_groups 与上游组键不再逐字相同')
  // 前端那一份（设置页 / 预览校验 / 右键写的都是它）也在同一根线上。
  assert.deepEqual(CODE_VISION_GROUP_IDS.slice().sort(), sorted(EXPECTED_GROUPS))
})
