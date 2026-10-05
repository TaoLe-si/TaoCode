// dbg/settings 本轮补齐的四格 + 求值对话框形态的键一致性门禁：
// 前端 GeneralSettingsState / 默认值 / native 白名单与默认值 / toolViewContext 传递 /
// 设置页渲染 / DebugPanel 消费，六处缺一就是「界面能勾、永远存不下来」那一类缺陷
// （先例见 tests/settings-keys-parity.test.mjs 的文件头）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')
const KEYS = ['debuggerShowValuesInline', 'debuggerShowLibraryFrames', 'debuggerConfirmBreakpointRemoval', 'debuggerUnmuteOnStop', 'debuggerEvaluationMode']

test('前端类型与默认值都在（逐键）', () => {
  const model = read('src/settingsModel.ts')
  const iface = model.match(/export interface GeneralSettingsState \{([\s\S]*?)\n\}/)
  assert.ok(iface, '找不到 GeneralSettingsState')
  const defaults = model.match(/export const defaultGeneralSettings[^=]*= \{([\s\S]*?)\n\}/)
  assert.ok(defaults, '找不到 defaultGeneralSettings')
  for (const key of KEYS.slice(0, 4)) {
    assert.match(iface[1], new RegExp(`${key}: boolean`), `${key} 字段类型`)
    assert.match(defaults[1], new RegExp(`${key}: false`), `${key} 默认值`)
  }
  assert.match(iface[1], /debuggerEvaluationMode: 'expression' \| 'codeFragment'/)
  assert.match(defaults[1], /debuggerEvaluationMode: 'expression'/)
})

test('native 白名单、默认值与校验都登记（漏了就整次 settings.general.update 被拒）', () => {
  const hpp = read('native/settings_schema.hpp').match(/GENERAL_SETTING_KEYS\[\] = \{([\s\S]*?)\};/)
  assert.ok(hpp, '找不到 GENERAL_SETTING_KEYS')
  for (const key of KEYS) assert.match(hpp[1], new RegExp(`"${key}"`), key)
  const cpp = read('native/settings_schema.cpp').match(/Json general_defaults_impl\(\) \{([\s\S]*?)\n\}/)
  assert.ok(cpp, '找不到 general_defaults_impl')
  assert.match(cpp[1], /\{"debuggerShowValuesInline", false\}/)
  assert.match(cpp[1], /\{"debuggerShowLibraryFrames", false\}/)
  assert.match(cpp[1], /\{"debuggerConfirmBreakpointRemoval", false\}/)
  assert.match(cpp[1], /\{"debuggerUnmuteOnStop", false\}/)
  assert.match(cpp[1], /\{"debuggerEvaluationMode", "expression"\}/)
  const full = read('native/settings_schema.cpp')
  const validation = full.match(/void validate_general_patch\(const Json& patch\) \{([\s\S]*?)\n\}/)
  assert.ok(validation, '找不到 validate_general_patch 定义')
  assert.match(validation[1], /debuggerEvaluationMode must be expression or codeFragment/)
})

test('toolViewContext 把每一格传进 DebugPanel 的 debugView', () => {
  const ctx = read('src/toolViewContext.ts')
  for (const key of KEYS) {
    const field = key.replace(/^debugger/, '')
    const fieldName = field[0].toLowerCase() + field.slice(1)
    assert.match(ctx, new RegExp(`${fieldName}: generalSettings\\?\\.value\\?\\.${key}`), `${fieldName} 传递`)
  }
})

test('设置页有每一格（数据视图组 + 通用组 + 求值形态下拉）', () => {
  const page = read('src/components/DebuggerSettingsPage.vue')
  assert.match(page, /settings\.debuggerShowValuesInline/)
  assert.match(page, /settings\.debuggerShowLibraryFrames/)
  assert.match(page, /settings\.debuggerConfirmBreakpointRemoval/)
  assert.match(page, /settings\.debuggerUnmuteOnStop/)
  assert.match(page, /v-model="settings\.debuggerEvaluationMode"/)
  assert.match(page, /XDebuggerGeneralSettings/, '页面注明上游类')
  const dialog = read('src/components/SettingsDialog.vue')
  assert.match(dialog, /<DebuggerSettingsPage :settings="general"/)
})

test('每一格都有真实消费点（不是死开关）', () => {
  const panel = read('src/components/DebugPanel.vue')
  const dataView = read('src/debugDataView.ts')
  assert.match(dataView, /showValuesInline\?: boolean/)
  assert.match(dataView, /showLibraryFrames\?: boolean/)
  assert.match(dataView, /confirmBreakpointRemoval\?: boolean/)
  assert.match(dataView, /unmuteOnStop\?: boolean/)
  assert.match(dataView, /evaluationMode\?: 'expression' \| 'codeFragment'/)
  assert.match(panel, /if \(!dataView\.value\.showValuesInline \|\| !stopped\.value\)/, '行内值消费')
  assert.match(panel, /visibleFrames\(frames, dataView\.showLibraryFrames === true, selectedFrameIndex\)/, '库帧消费')
  assert.match(panel, /:confirm-removal="dataView\.confirmBreakpointRemoval === true"/, '移断点确认消费')
  assert.match(panel, /:unmute-on-stop="dataView\.unmuteOnStop === true"/, '自动取消静音消费')
  assert.match(panel, /:mode="dataView\.evaluationMode \?\? 'expression'"/, '求值对话框形态消费')
})
