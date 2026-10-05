// `src/stickyLines.ts` 的**层数**与作用域白名单（`lp/sticky-lines`）：
//   · 只把作用域符号当粘性行（字段/变量/常量不占位置 —— IDEA 的语言 provider 也是这个口径）；
//   · 同一行起头的多条只留最内层那条（App.vue 用 startLine 当 key，撞 key 会让两行跳同一处）；
//   · `stickyLinesLimit` 是**层数上限**，取最内层 N 条（外层在上）。
//
// 用真实 Vue 响应式（`ref`/`computed` 在 Node 里可用）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'

import { createStickyLines, isScopeSymbol, stickyScopes } from '../src/stickyLines.ts'

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

test('层数上限取最内层 N 条；关掉开关或极限为 0 时为空', () => {
  const outline = ref(OUTLINE)
  const settings = ref({ showStickyLines: true, stickyLinesLimit: 2 })
  let line = 5
  const { stickyLines } = createStickyLines({ editorSettings: settings, outline, currentLine: () => line })
  assert.deepEqual(stickyLines.value.map(entry => entry.name), ['load', 'Inner'], '上限 2 = 最内两层')
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
