// `src/codeLens.ts` 的锚点归并规则 + `src/codeLensExtension.ts` 的接线：
//   · 同一个 LSP `range`（= 同一个符号）上多个 provider 的条目，上游放进**同一个 inlay 的列表**
//     用间隔逐个画（`CodeVisionListPainter.kt:37-49`、`DelimiterPainter.kt:26-28`），不是一行一条；
//   · 同一锚点可见条目的上限 5 来自 `CodeVisionHost.kt:85` 的 `defaultVisibleLenses`，
//     截断规则在 `CodeVisionListData.updateVisible()`（`CodeVisionListData.kt:45-57`）；
//   · `editor.codeVision.more.inlay` 缺省 false（`registry.properties:1759`），被截掉的条目没有入口；
//   · 渲染前先过 Code Vision 的总闸/组闸（`CodeVisionHost.kt:341` 与 `:348-350`），
//     闸在归并之前 ⇒ 关掉的组不占可见上限的槽位（见下面那几条 `renderedTitles` 用例）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { CODE_LENS_VISIBLE_MAX, anchoredLenses, groupAnchoredLenses } from '../src/codeLens.ts'
import { createCodeLens, setCodeLens } from '../src/codeLensExtension.ts'
import { LSP_CODE_VISION_GROUP_ID, codeVisionSettings, setCodeVisionGroupEnabled } from '../src/codeLensSettings.ts'

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

test('接线：CodeMirror 落点按锚点行渲染，并保留 codeLensCommand 的点击校验', () => {
  const extension = readFileSync('src/codeLensExtension.ts', 'utf8')
  // 钉的是**意图**而不是字面：渲染的那一步必须①先过 Code Vision 的闸、②再按锚点归并，
  // 且归并吃的是**过闸之后**的那一份（闸在后会让被关掉的组白占 `defaultVisibleLenses` 的 5 个槽）。
  // 原来这条钉的是 `groupAnchoredLenses(lenses)` 这个字面形状，把参数名钉死了 ——
  // 与本仓上游口径（`CodeVisionHost.kt:348-350` 先 `isProviderEnabled` 再收集）冲突，故按意图重写。
  // 留痕（K-4 本轮）：重写后的 `groupAnchoredLenses(visible)` 仍然钉错了东西 —— **不带第二参**
  // 就等于把每锚点上限钉成出厂常量，而上游那一步吃的是设置值：
  // `CodeVisionListData.kt:46` 的 `projectModel.maxVisibleLensCount[anchor]` 由
  // `CodeVisionHost.kt:287-288` 从 `CodeVisionSettings.getAnchorLimit(...)`
  // （`CodeVisionSettings.kt:140-147`，出厂值 `:38-39`）灌进来。
  // ⇒ 按意图再重写一次，并且**变严**：既要求带第二参、又要求那参数是设置表解析出来的，
  //    还禁止再出现不带上限的 `groupAnchoredLenses(visible)` 形状。
  const gate = extension.indexOf('lenses.filter(lens => shouldShowCodeVisionEntry(codeVisionGroupId(lens.item)))')
  const grouped = /groupAnchoredLenses\(visible,\s*codeVisionVisibleEntryLimit\(\)/.exec(extension)
  assert.ok(gate > 0, '渲染没有过 Code Vision 的组闸（shouldShowCodeVisionEntry 仍是死导入）')
  assert.ok(grouped, '渲染没有按锚点归并，或归并时没有吃设置表里的每锚点上限')
  assert.ok(!extension.includes('groupAnchoredLenses(visible)'), '每锚点上限写成了常量：设置页那一格就成了死旋钮')
  assert.ok(grouped.index > gate, '闸在归并之后：关掉的组会占掉可见上限的槽位')
  assert.ok(extension.includes('const payload = codeLensCommand(this.lens.item)'), '点击没有复用 codeLensCommand')
  assert.ok(extension.includes("'.cm-code-lens-delimiter'"), '同锚点条目之间没有分隔（DelimiterPainter 的等价物）')
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

/** 真跑一遍渲染通道：把这些条目送进 `setCodeLens`，读回装饰集里实际成行的标题。 */
function renderedTitles(items) {
  const controller = createCodeLens({
    query: async () => ({ available: true, items: [] }),
    enabled: () => false, view: () => undefined, onCommand: () => {},
  })
  try {
    const base = EditorState.create({ doc: GATED_DOC, extensions: [controller.extension] })
    const state = base.update({ effects: setCodeLens.of(anchoredLenses(items)) }).state
    const titles = []
    for (const value of state.facet(EditorView.decorations)) {
      const set = typeof value === 'function' ? value(state) : value
      if (!set || !set.between) continue
      set.between(0, state.doc.length, (_from, _to, decoration) => {
        const row = decoration?.spec?.widget?.row
        if (row) titles.push(...row.items.map(item => item.title))
      })
    }
    return titles
  } finally {
    controller.dispose()
  }
}

/** 用完把单例恢复成出厂档，别把闸漏给同文件后面的用例。 */
function withSettings(patch, run) {
  const before = { enabled: codeVisionSettings.enabled, disabled: { ...codeVisionSettings.disabledGroups }, enabledGroups: { ...codeVisionSettings.enabledGroups } }
  try {
    codeVisionSettings.enabled = patch.enabled ?? true
    for (const id of patch.disabled ?? []) setCodeVisionGroupEnabled(id, false)
    return run()
  } finally {
    codeVisionSettings.enabled = before.enabled
    codeVisionSettings.disabledGroups = before.disabled
    codeVisionSettings.enabledGroups = before.enabledGroups
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

test('接线：右键「隐藏这一组」写完设置立刻按新闸重画，不等下一次刷新', () => {
  const extension = readFileSync('src/codeLensExtension.ts', 'utf8')
  assert.ok(extension.includes('if (handleCodeVisionExtraAction(id, groupId)) onGateApplied()'),
    '右键动作没有把「设置变了」通知渲染通道')
  assert.ok(extension.includes('if (effect.is(codeVisionGateChanged)) return buildDecorations(transaction.state, lastLenses'),
    '设置变了没有按新闸重建装饰集')
})
