// dbg/* 数据视图（`src/debugDataView.ts`）与「设置 › 调试器」两格的判据。
//
// 上游：`XDebuggerDataViewSettings`（xdebugger-impl 的 settings 包）在 Variables 视图里
// 提供「隐藏 null 元素」与「按名排序」两格。本仓的两格从设置页（DebuggerSettingsPage）
// 经 general settings 落盘（native/settings_schema.cpp 的 GENERAL_SETTING_KEYS），
// 消费点在 DebugPanel 的变量树。这里既钉规则，也钉三处键表不许漂。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_DEBUG_DATA_VIEW, collectReferenceRows, collectVarRows, isNullValueText, visibleChildren } from '../src/debugDataView.ts'

const v = (name, value, reference = 0, named = true) => ({ name, value, reference, named })

test('null 值文本的识别覆盖各适配器的写法', () => {
  for (const text of ['null', 'nullptr', 'nil', 'None', 'undefined', ' null ', 'NULL']) assert.equal(isNullValueText(text), true, text)
  for (const text of ['0', 'false', '""', 'nully', 'nan']) assert.equal(isNullValueText(text), false, text)
})

test('隐藏 null：不可展开的 null 值不显示，可展开的 null 对象保留', () => {
  const children = [v('a', '1'), v('b', 'null'), v('c', 'nullptr'), v('d', 'None'), v('e', 'null', 7)]
  const visible = visibleChildren(children, { hideNullValues: true, sortByName: false })
  assert.deepEqual(visible.map(entry => entry.variable.name), ['a', 'e'])
  assert.deepEqual(visible.map(entry => entry.index), [0, 4], '保留原始下标（显示名 [i] 要真实）')
  assert.equal(visibleChildren(children, DEFAULT_DEBUG_DATA_VIEW).length, 5, '默认不隐藏')
})

test('按名排序：命名变量排好序，数组元素保持索引序且下标不变', () => {
  const named = [v('zeta', '1'), v('alpha', '2'), v('mid', '3')]
  const sorted = visibleChildren(named, { hideNullValues: false, sortByName: true })
  assert.deepEqual(sorted.map(entry => entry.variable.name), ['alpha', 'mid', 'zeta'])
  const indexical = [v('0', 'a', 0, false), v('1', 'b', 0, false), v('2', 'c', 0, false)]
  assert.deepEqual(visibleChildren(indexical, { hideNullValues: false, sortByName: true }).map(entry => entry.variable.name), ['0', '1', '2'])
})

test('两类选项叠在一起：先隐藏再排序', () => {
  const children = [v('b', 'null'), v('a', '1'), v('c', 'null', 3), v('d', '')]
  const visible = visibleChildren(children, { hideNullValues: true, sortByName: true })
  assert.deepEqual(visible.map(entry => entry.variable.name), ['a', 'c', 'd'])
})

test('collectVarRows：作用域展开、隐藏 null、循环引用截断仍成立', () => {
  const scopes = [{ name: 'Locals', reference: 1, variablesReference: 1, expensive: false }]
  const values = {
    1: [v('object', '{...}', 2), v('empty', 'null')],
    2: [v('parent', '{...}', 1)],
  }
  const open = { s0: true, 's0-0': true, 's0-0-0': true }
  const rows = collectVarRows(scopes, values, open, { hideNullValues: true, sortByName: false })
  assert.deepEqual(rows.map(row => row.name), ['Locals', 'object', 'parent', '（循环引用）'])
})

test('collectReferenceRows 与变量树共用同一套展开/选项规则', () => {
  const values = { 5: [v('b', '2'), v('a', '1')] }
  const rows = collectReferenceRows(5, values, {}, { hideNullValues: false, sortByName: true })
  assert.deepEqual(rows.map(row => row.name), ['a', 'b'])
})

// —— 键登记不许漂（前端默认 / 原生白名单 / 原生默认 / 预览态白名单四份）——
const read = path => readFileSync(path, 'utf8')

test('两格在 defaultGeneralSettings 里有默认值（false）', () => {
  const block = read('src/settingsModel.ts').match(/export const defaultGeneralSettings[^=]*= \{([\s\S]*?)\n\}/)
  assert.ok(block, '找不到 defaultGeneralSettings')
  assert.match(block[1], /debuggerHideNullValues: false/)
  assert.match(block[1], /debuggerSortByName: false/)
})

test('两格在 native GENERAL_SETTING_KEYS 白名单与 general_defaults_impl 里都有', () => {
  const hpp = read('native/settings_schema.hpp').match(/GENERAL_SETTING_KEYS\[\] = \{([\s\S]*?)\};/)
  assert.ok(hpp, '找不到 GENERAL_SETTING_KEYS')
  assert.match(hpp[1], /"debuggerHideNullValues"/)
  assert.match(hpp[1], /"debuggerSortByName"/)
  const cpp = read('native/settings_schema.cpp').match(/Json general_defaults_impl\(\) \{([\s\S]*?)\n\}/)
  assert.ok(cpp, '找不到 general_defaults_impl 定义')
  assert.match(cpp[1], /\{"debuggerHideNullValues", false\}/)
  assert.match(cpp[1], /\{"debuggerSortByName", false\}/)
})

test('两格在预览态的 settings.general.update 白名单里（否则浏览器里勾了也存不下）', () => {
  // 该白名单已从 src/bridge.ts 拆到 src/bridgePreview.ts（模块化拆分，行为逐字未改）
  const bridge = read('src/bridgePreview.ts')
  assert.match(bridge, /key === 'debuggerHideNullValues' \|\| key === 'debuggerSortByName'/)
})

test('设置页与消费点真的接上（不是死开关）', () => {
  const page = read('src/components/DebuggerSettingsPage.vue')
  assert.match(page, /settings\.debuggerHideNullValues/)
  assert.match(page, /settings\.debuggerSortByName/)
  const dialog = read('src/components/SettingsDialog.vue')
  assert.match(dialog, /<DebuggerSettingsPage :settings="general"/)
  const meta = read('src/settingsTreeMeta.ts')
  assert.match(meta, /key: 'debugger'/)
  const panel = read('src/components/DebugPanel.vue')
  assert.match(panel, /collectVarRows\(scopes\.value, values, open, dataView\.value\)/)
  assert.match(panel, /dataView\?: DebugDataViewOptions/)
  const view = read('src/components/ToolWindowView.vue')
  assert.match(view, /:data-view="ctx\.debugView"/)
})
