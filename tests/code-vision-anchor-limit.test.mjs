// Code Vision 的**第二层**：同一个锚点最多画几条，而且这一档由设置表给（不是常量）。
// 上游链路（每一步都亲自打开过那一行）：
//   · 出厂 5 —— `platform/lang-api/src/com/intellij/codeInsight/codeVision/settings/CodeVisionSettings.kt:38-39`
//     `var visibleMetricsAboveDeclarationCount: Int = 5` / `var visibleMetricsNextToDeclarationCount: Int = 5`；
//   · 读档 —— 同文件 `:140-147` 的 `getAnchorLimit(position)`（Top 档读上面那个字段）；
//   · 灌进视图 —— `platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionHost.kt:287-288`
//     `viewService.setPerAnchorLimits(... (lifeSettingModel.getAnchorLimit(it) ?: defaultVisibleLenses))`，
//     那张 `maxVisibleLensCount` 表在 `.../codeVision/ui/model/ProjectCodeVisionModelImpl.kt:30`；
//   · 截断 —— `platform/lang-impl/src/com/intellij/codeInsight/codeVision/ui/model/CodeVisionListData.kt:45-57`
//     `visibleCount = minOf(count, anchoredLens.size)` → `anchoredLens.subList(0, visibleCount)`
//     ⇒ **保留前缀、不改顺序**；被截掉的没有「更多…」入口（`CodeVisionListData.kt:60` 读
//     `editor.codeVision.more.inlay`，缺省 false —— 见 `src/codeLens.ts:124-125`）。
// 第一层（档位：总闸 + 每组）在 `tests/code-lens-grouping.test.mjs` 已钉；本文件补的是
// ①第二层的解析与消费、②**两层合起来**的形状（闸必须仍然在上限之前）、③设置变了要立刻重画
// （上游 `CodeVisionHost.kt:298-300` 的 `visibleMetricsAboveDeclarationCount.advise { … fire(...) }`）。
// 本仓落点：`src/codeLensSettings.ts` 的 `codeVisionVisibleEntryLimit`（纯判定）＋
// `src/codeLensExtension.ts` 的 `buildDecorations`（消费点）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { nextTick } from 'vue'

import { anchoredLenses } from '../src/codeLens.ts'
import { createCodeLens, setCodeLens } from '../src/codeLensExtension.ts'
import { CODE_VISION_VISIBLE_COUNT, codeVisionSettings, codeVisionSettingsPatch,
         codeVisionVisibleEntryLimit, restoreCodeVisionSettings, setCodeVisionGroupEnabled } from '../src/codeLensSettings.ts'

const DOC = 'class A {\n  void f() {}\n  void g() {}\n  void h() {}\n}\n'

// 一条挂在某个锚点上的 lens；`providerId` 省略 = 服务端下发（归 LSP 那一组）。
const lens = (line, title, startChar = 0, providerId) => ({
  title, command: `cmd.${title}`, providerId,
  range: { startLine: line, startChar, endLine: line, endChar: startChar + 1 },
})

/** 从一份编辑器状态里读回"实际成行的那几行"（行号、锚点列、标题、被截条数）。 */
function rowsFrom(state) {
  const rows = []
  for (const value of state.facet(EditorView.decorations)) {
    const set = typeof value === 'function' ? value(state) : value
    if (!set || !set.between) continue
    set.between(0, state.doc.length, (_from, _to, decoration) => {
      const row = decoration?.spec?.widget?.row
      if (row) rows.push({ line: row.line, startChar: row.startChar, titles: row.items.map(item => item.title), hidden: row.hidden })
    })
  }
  return rows
}

/** 用完把单例恢复成出厂档，别把设置漏给同文件后面的用例。 */
function snapshot() {
  return { enabled: codeVisionSettings.enabled, visibleEntries: codeVisionSettings.visibleEntries,
    disabled: { ...codeVisionSettings.disabledGroups }, enabledGroups: { ...codeVisionSettings.enabledGroups } }
}
function restore(snapshotState) {
  codeVisionSettings.enabled = snapshotState.enabled
  codeVisionSettings.visibleEntries = snapshotState.visibleEntries
  codeVisionSettings.disabledGroups = snapshotState.disabled
  codeVisionSettings.enabledGroups = snapshotState.enabledGroups
}

/** 把条目灌进渲染通道（一次性通道，用完即弃），返回装饰集里实际成行的那几行。 */
function rowsOf(items, settings) {
  const before = snapshot()
  const controller = createCodeLens({
    query: async () => ({ available: true, items: [] }),
    enabled: () => false, view: () => undefined, onCommand: () => {},
  })
  try {
    if (settings) {
      // 上限与档位都吃**设置表**，所以用例改的就是那一份表。
      codeVisionSettings.visibleEntries = settings.visibleEntries ?? CODE_VISION_VISIBLE_COUNT
      codeVisionSettings.enabled = settings.enabled ?? true
      for (const id of settings.disabled ?? []) setCodeVisionGroupEnabled(id, false)
    }
    const base = EditorState.create({ doc: DOC, extensions: [controller.extension] })
    return rowsFrom(base.update({ effects: setCodeLens.of(anchoredLenses(items)) }).state)
  } finally {
    controller.dispose()
    restore(before)
  }
}

const sameAnchor = prefix => Array.from({ length: 8 }, (_, index) => lens(1, `${prefix}${index}`))

// —— 纯判定：设置表里那一个数怎么解析成上限 ————————————————————————————

test('出厂上限就是上游那两个 5（CodeVisionSettings.kt:38-39），不是随手取的正整数', () => {
  assert.equal(CODE_VISION_VISIBLE_COUNT, 5)
  assert.equal(codeVisionSettings.visibleEntries, 5, '运行时表的出厂值不是 5')
  assert.equal(codeVisionVisibleEntryLimit(), 5)
})

test('上限读设置表里的值：3 就吐 3、1 就吐 1、10 就吐 10（设置页那一格真的在喂渲染侧）', () => {
  const table = { enabled: true, disabledGroups: {}, enabledGroups: {} }
  for (const [value, expected] of [[3, 3], [1, 1], [10, 10]]) {
    assert.equal(codeVisionVisibleEntryLimit({ ...table, visibleEntries: value }), expected)
  }
})

test('坏值（0 / 负数 / 小数 / NaN）回出厂 5，与 CodeVisionHost.kt:288 的 ?: defaultVisibleLenses 同形', () => {
  const table = { enabled: true, disabledGroups: {}, enabledGroups: {} }
  for (const bad of [0, -1, -5, 2.5, Number.NaN]) {
    assert.equal(codeVisionVisibleEntryLimit({ ...table, visibleEntries: bad }), 5, `坏值 ${String(bad)} 没有被兜回出厂 5`)
  }
})

test('restoreCodeVisionSettings 只认正整数：旧存档缺键/坏值都不许把出厂 5 改坏', () => {
  const before = snapshot()
  try {
    for (const bad of [undefined, null, 0, -3, 1.5, Number.NaN, '3']) {
      restoreCodeVisionSettings({ codeVisionEnabled: true, codeVisionVisibleEntries: bad })
      assert.equal(codeVisionSettings.visibleEntries, 5, `灌入 ${String(bad)} 之后表里不是出厂 5`)
    }
    restoreCodeVisionSettings({ codeVisionVisibleEntries: 2 })
    assert.equal(codeVisionSettings.visibleEntries, 2)
    assert.equal(codeVisionSettingsPatch().codeVisionVisibleEntries, 2, '存盘出口没带上这一键')
    restoreCodeVisionSettings({ codeVisionEnabled: true })   // 缺这一键 = 保持现值，不许按字段数量判损坏
    assert.equal(codeVisionSettings.visibleEntries, 2)
  } finally { restore(before) }
})

// —— 渲染侧消费：上限真的决定画几条 —————————————————————————————————

test('同一锚点 8 条、上限 3 ⇒ 只画前三条（上游 subList(0, minOf(count, size)) 的前缀形状）', () => {
  const rows = rowsOf(sameAnchor('a'), { visibleEntries: 3 })
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].titles, ['a0', 'a1', 'a2'], '截断的不是上游那一段前缀（顺序或取用的区间变了）')
  assert.equal(rows[0].hidden, 5)
})

test('上限 1 ⇒ 只剩第一条；上限 8 ⇒ 八条全画；上限 5（出厂）⇒ 前五条（不是只加不减的软断言）', () => {
  assert.deepEqual(rowsOf(sameAnchor('b'), { visibleEntries: 1 })[0].titles, ['b0'])
  assert.deepEqual(rowsOf(sameAnchor('b'), { visibleEntries: 8 })[0].titles,
    ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'])
  assert.deepEqual(rowsOf(sameAnchor('b'), { visibleEntries: 5 })[0].titles, ['b0', 'b1', 'b2', 'b3', 'b4'])
})

test('上限是**每锚点**而不是每编辑器行：同一行两个锚点各 3 条、上限 2 ⇒ 两行各画 2', () => {
  const items = [lens(2, 'p0', 0), lens(2, 'p1', 0), lens(2, 'p2', 0), lens(2, 'q0', 12), lens(2, 'q1', 12), lens(2, 'q2', 12)]
  assert.deepEqual(rowsOf(items, { visibleEntries: 2 }).map(row => [row.startChar, row.titles, row.hidden]),
    [[0, ['p0', 'p1'], 1], [12, ['q0', 'q1'], 1]])
})

// —— 两层的合成：档位关 ⇒ 该族不渲染，而且不占上限的槽位 ————————————————

test('上限调到 2 时关掉的族依旧不占槽位（闸在前、上限在后，新上限下顺序仍成立）', () => {
  const items = [lens(1, 'L1', 0, 'problems'), lens(1, 'L2', 0, 'problems'), lens(1, 'L3', 0, 'problems'),
                 lens(1, 's1'), lens(1, 's2'), lens(1, 's3')]
  // 闸在后 ⇒ 先按 2 截断只剩 ['L1','L2']，再被滤光 ⇒ 一行都不剩；闸在前 ⇒ 服务端 3 条截成 2 条。
  assert.deepEqual(rowsOf(items, { visibleEntries: 2, disabled: ['problems'] })[0].titles, ['s1', 's2'])
  // 档位全开 ⇒ 画的是本地那两条（合流规则本地优先），钉的是"闸开着时这一族确实进列表"。
  assert.deepEqual(rowsOf(items, { visibleEntries: 2 })[0].titles, ['L1', 'L2'])
})

test('关掉的族一条都不画：上限调到 10 也不会因为"还有空槽位"就漏出来', () => {
  const items = [lens(1, 'x'), lens(2, 'y'), lens(1, 'z', 0, 'problems')]
  assert.deepEqual(rowsOf(items, { visibleEntries: 10, disabled: ['problems'] }).map(row => row.titles), [['x'], ['y']])
  assert.deepEqual(rowsOf(items, { visibleEntries: 10, enabled: false }), [])
})

// —— 设置变了要立刻重画（上游 CodeVisionHost.kt:298-300 那条 advise） ———————

test('改小/改大上限都不必等下一次刷新：渲染通道按新档重建装饰集', async () => {
  const before = snapshot()
  const dispatched = []
  const controller = createCodeLens({
    query: async () => ({ available: true, items: [] }),
    enabled: () => false, view: () => view, onCommand: () => {},
  })
  const view = { dispatch: spec => { state = state.update(spec).state; dispatched.push(spec) } }
  let state = EditorState.create({ doc: DOC, extensions: [controller.extension] })
  try {
    state = state.update({ effects: setCodeLens.of(anchoredLenses(sameAnchor('w'))) }).state
    assert.deepEqual(rowsFrom(state)[0].titles, ['w0', 'w1', 'w2', 'w3', 'w4'], '出厂档应先画 5 条')
    codeVisionSettings.visibleEntries = 2
    await nextTick()
    assert.equal(dispatched.length, 1, '改上限没有触发按新档重画（这一格要等下一次刷新才见效）')
    assert.deepEqual(rowsFrom(state)[0].titles, ['w0', 'w1'], '重画没有按新上限截断')
    codeVisionSettings.visibleEntries = 7
    await nextTick()
    assert.deepEqual(rowsFrom(state)[0].titles, ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'], '调大上限后没有把多出来的条目放回来')
    codeVisionSettings.enabled = false
    await nextTick()
    assert.deepEqual(rowsFrom(state), [], '总闸关掉后装饰集里还留着条目')
  } finally {
    controller.dispose()
    restore(before)
  }
})
