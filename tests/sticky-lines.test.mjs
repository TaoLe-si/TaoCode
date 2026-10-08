// `src/stickyLines.ts` 的**层数**与作用域白名单（`lp/sticky-lines`）：
//   · 只把作用域符号当粘性行（字段/变量/常量不占位置 —— IDEA 的语言 provider 也是这个口径）；
//   · 同一行起头的多条只留最内层那条（App.vue 用 startLine 当 key，撞 key 会让两行跳同一处）；
//   · `stickyLinesLimit` 是**层数上限**，超出时留**最外** N 条、裁掉最内的（外层在上；
//     与视口那一档同向，也是上游 `VisualStickyLines.kt:144-148` 排满即 `break` 的方向）；
//   · 多分栏时上面两刀（provider 白名单、层数上限）**对每块面板各生效一次**，不是几块合起来算一份。
//
// 用真实 Vue 响应式（`ref`/`computed` 在 Node 里可用）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'

import { createStickyLines, isScopeSymbol, stickyScopes } from '../src/stickyLines.ts'
import { stickyVisualLines } from '../src/stickyLineViewport.ts'

const symbol = (name, kind, startLine, endLine) => ({ name, kind, detail: '', startLine, startChar: 0, endLine, endChar: 0 })

// 一个真实形状的 documentSymbol 列表（扁平，含非作用域成员）。
const OUTLINE = [
  symbol('Config', 5, 0, 20),        // class
  symbol('DEFAULT', 14, 1, 1),       // constant —— 不是作用域
  symbol('load', 6, 2, 8),           // method
  symbol('path', 8, 3, 3),           // field —— 不是作用域
  symbol('count', 13, 5, 5),         // variable —— 不是作用域
  symbol('Inner', 5, 4, 6),          // nested class（与 load 重叠的方法体里）
  symbol('helper', 12, 10, 12),      // function（顶层函数）
  symbol('KIND', 22, 11, 11),        // enum member —— 不是作用域
]

test('作用域白名单：类/方法/函数/命名空间算，字段/变量/常量不算', () => {
  assert.equal(isScopeSymbol(symbol('X', 5, 0, 1)), true)
  assert.equal(isScopeSymbol(symbol('x', 8, 0, 1)), false)
  assert.equal(isScopeSymbol(symbol('x', 13, 0, 1)), false)
  assert.equal(isScopeSymbol(symbol('x', 14, 0, 1)), false)
  assert.equal(isScopeSymbol(symbol('', 5, 0, 1)), false, '空名字不显示')
  assert.equal(isScopeSymbol(symbol('x', 5, 3, 2)), false, '倒序区间不显示')
  assert.equal(isScopeSymbol(symbol('x', 5, 0.5, 2)), false, '非整数行号不显示')
})

test('光标行包含链：外层在前，非作用域符号被滤掉', () => {
  // 光标在第 5 行（1 基）→ 0 基 4：Config 0..20、load 2..8、Inner 4..6 都包含它；
  // count（变量）被滤掉；排序后 Config 在上、Inner（最内层）在下。
  assert.deepEqual(stickyScopes(OUTLINE, 5).map(entry => entry.name), ['Config', 'load', 'Inner'])
  // 光标正好在 load 的起始行（0 基 2 → 1 基 3）也算一层；上一行（1 基 2）就不算了。
  assert.deepEqual(stickyScopes(OUTLINE, 3).map(entry => entry.name), ['Config', 'load'])
  assert.deepEqual(stickyScopes(OUTLINE, 2).map(entry => entry.name), ['Config'])
  // 顶层函数内部（第 11 行）：Config 也包含它（Fixture 里 helper 在类体内）。
  assert.deepEqual(stickyScopes(OUTLINE, 11).map(entry => entry.name), ['Config', 'helper'])
})

test('同一行起头的多条只留最内层（App.vue 的 key 不会撞）', () => {
  const oneLine = [symbol('A', 5, 3, 6), symbol('a', 6, 3, 6)]
  assert.deepEqual(stickyScopes(oneLine, 5).map(entry => entry.name), ['A'],
    '区间完全相同（类与方法都占了这块）时留结构视图里的外层那条')
  const sameStart = [symbol('A', 5, 3, 10), symbol('a', 6, 3, 6)]
  assert.deepEqual(stickyScopes(sameStart, 5).map(entry => entry.name), ['a'],
    '同行起头、区间不同：留最内层那条（endLine 更小）')
})

test('层数上限留最外 N 条（与视口那一档同向）；关掉开关或极限为 0 时为空', () => {
  const outline = ref(OUTLINE)
  const settings = ref({ showStickyLines: true, stickyLinesLimit: 2 })
  let line = 5
  const { stickyLines } = createStickyLines({ editorSettings: settings, outline, currentLine: () => line })
  // stickyScopes 给 ['Config','load','Inner']（外层在前）；上限 2 ⇒ 留最外两条、裁掉最内的 Inner。
  // 上游 `VisualStickyLines.kt:144-148` 排满 lineLimit 即 break，候选按 `VisualStickyLine.kt:21-27`
  // 的 primaryLine 升序（外层在前）⇒ 被裁的是最内那一条；与视口那一档（stickyVisualLines 的早停）同向。
  assert.deepEqual(stickyLines.value.map(entry => entry.name), ['Config', 'load'], '上限 2 = 最外两层')
  settings.value = { showStickyLines: true, stickyLinesLimit: 5 }
  assert.deepEqual(stickyLines.value.map(entry => entry.name), ['Config', 'load', 'Inner'])
  settings.value = { showStickyLines: false, stickyLinesLimit: 5 }
  assert.deepEqual(stickyLines.value, [])
  settings.value = { showStickyLines: true, stickyLinesLimit: 0 }
  assert.deepEqual(stickyLines.value, [])
  settings.value = { showStickyLines: true, stickyLinesLimit: 5 }
  line = undefined
  assert.deepEqual(stickyLines.value, [], '没打开文件时没有粘性行')
})

// 视口滚动那一档（`lp/sticky-lines` 的剩余缺口）：上游钉的是**起始行已经滚出可视区顶部**的那些作用域
// —— `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/VisualStickyLines.kt:67-86`
// 的 `collectLogical` 从 `visibleArea.y` 换算出顶行，`StickyLinesManager.kt:32,86,111` 由
// `visibleAreaChanged` 驱动重算；本仓拿不到滚动量时（顶边渲染在冻结的 `App.vue`）退回按光标行判。
test('给了可视区顶行时，起始行还看得见的那一层不再重复钉住', () => {
  const scopes = [
    { name: 'Config', kind: 5, startLine: 0, endLine: 40 },
    { name: 'load', kind: 6, startLine: 9, endLine: 20 },
  ]
  assert.deepEqual(stickyScopes(scopes, 15, 'java').map(entry => entry.name), ['Config', 'load'],
    '不给顶行 = 维持按光标行的现状')
  assert.deepEqual(stickyScopes(scopes, 15, 'java', 10).map(entry => entry.name), ['Config'],
    'load 的首行正好是可视区第一行 ⇒ 不必重复钉')
  assert.deepEqual(stickyScopes(scopes, 15, 'java', 11).map(entry => entry.name), ['Config', 'load'],
    '两层的起始行都在顶行之上 ⇒ 都钉')
  assert.deepEqual(stickyScopes(scopes, 15, 'java', 1).map(entry => entry.name), [],
    '一行都没滚出去 ⇒ 一条都不钉')
})

// 两条路径的裁剪方向必须一致：宿主没透面板度量时走退化路径（按光标行），透了就走视口路径
// （`stickyVisualLines`）。同一份结构、同一个 `stickyLinesLimit`，两边留的必须是同一批层 ——
// 上游只有「排满 lineLimit 即 break、裁掉最内的」这一种（`VisualStickyLines.kt:144-148`），
// 两条路反向 = 缺陷。这里用三层都够宽（>=5 行）的嵌套，绕开 min-width 与去重的干扰，只比裁剪方向。
test('limit 小于层数时，退化路径与视口路径留的是同一批最外层（裁剪方向不许两路相反）', () => {
  const wide = [
    { name: 'Outer', kind: 5, startLine: 0, endLine: 100 },
    { name: 'Mid', kind: 6, startLine: 10, endLine: 90 },
    { name: 'Inner', kind: 6, startLine: 20, endLine: 80 },
  ]
  const settings = ref({ showStickyLines: true, stickyLinesLimit: 2 })
  const { stickyLines } = createStickyLines({ editorSettings: settings, outline: ref(wide), currentLine: () => 50 })
  assert.deepEqual(stickyLines.value.map(entry => entry.name), ['Outer', 'Mid'], '退化路径留最外两条')
  // 顶行 60（1 基）在三层起始行之下 ⇒ 三层都算「已滚出」；窗口/相交/宽度都不裁它们，只剩上限那一刀。
  const viaView = stickyVisualLines(wide, { id: 'pane', firstVisibleLine: 60 }, 2)
  assert.deepEqual(viaView.map(entry => entry.name), ['Outer', 'Mid'], '视口路径也留最外两条 —— 两条路同向')
})

// 多分栏从这一层往上的每一刀都要**对每块面板各生效一次**，不是几块合起来算一份
// （上游：层挂在文档的模型上 `StickyLinesModelImpl.java:93-100`，面板与判据挂在每个编辑器上
// `StickyLinesManager.kt:15-34`、`:86-99`）。这里钉的是 `createStickyLines` 的 `views` 出口
// 与 provider 白名单/层数上限的先后：白名单在前（两块面板看到的是同一份过滤后的候选），
// 上限在最后（每块各自裁到 limit 条）。
test('多分栏：provider 白名单与层数上限对每块面板各自生效', () => {
  const scopes = [
    { name: 'Config', kind: 5, startLine: 0, endLine: 60 },
    { name: 'count', kind: 8, startLine: 10, endLine: 20 },   // 够宽，但字段不是作用域 ⇒ 任何一块都不该看到它
    { name: 'load', kind: 6, startLine: 14, endLine: 50 },
    { name: 'deep', kind: 6, startLine: 30, endLine: 45 },
  ]
  const views = [{ id: 'left', firstVisibleLine: 40 }, { id: 'right', firstVisibleLine: 40 }]
  const settings = ref({ showStickyLines: true, stickyLinesLimit: 1 })
  const { stickyLinesByView } = createStickyLines({
    editorSettings: settings, outline: ref(scopes), currentLine: () => 41, views: () => views,
  })
  assert.deepEqual(stickyLinesByView.value.get('left').map(entry => entry.name), ['Config'])
  assert.deepEqual(stickyLinesByView.value.get('right').map(entry => entry.name), ['Config'],
    '上限 1 ⇒ 每块各自只留最外那条（合起来两行，不是一块面板的两行）')
  settings.value = { showStickyLines: true, stickyLinesLimit: 3 }
  assert.deepEqual(stickyLinesByView.value.get('left').map(entry => entry.name), ['Config', 'load', 'deep'],
    '抬到 3 ⇒ 每块各自拿到三层；字段 count 始终不在（白名单在每块面板之前都过一遍）')
  // 闸门那一条对**两份出口是同一条**：全局关掉 / 这一语言关掉 ⇒ 一块面板的那份都没有（不画半块面板）。
  const closed = createStickyLines({
    editorSettings: ref({ showStickyLines: true, stickyLinesLimit: 3 }),
    outline: ref(scopes), currentLine: () => 41, views: () => views, language: () => 'java',
    stickyLanguages: () => ({ java: false }),
  })
  assert.equal(closed.stickyLinesByView.value.size, 0, '按语言那一档同样管住 views 那份出口')
  assert.deepEqual(closed.stickyLines.value, [], '两份出口同时为空')
})
