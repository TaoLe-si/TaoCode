// 应用级设置的「本机级 vs 可漫游」拆分 —— 上游 `GeneralLocalSettings` 的等价物
// （`platform/ide-core/src/com/intellij/ide/GeneralLocalSettings.kt`）。
//
// 上游依据：
//   · `:17-18` `@State(name = "GeneralLocalSettings", storages = [Storage(value = "ide.general.local.xml",
//     roamingType = RoamingType.DISABLED)])` —— DISABLED = **不漫游**，只跟这台机器走；
//   · `:79-83` `GeneralLocalState` 三个键；`:28-35` `getDefaultAlternativeBrowserPath()`；
//     `:66-70` `browserPath` 的 getter 回落；`:42-58` 一次性的迁移。
//
// ⚠️ 本模块**没有生产消费方**：真正拆出去要动 `native/settings_schema.cpp`（本机级键表与落盘）、
// `src/settingsModel.ts`（GeneralSettingsState 去掉这三键）、`src/settingsTransfer.ts` +
// `native/settings_transfer.cpp`（导出归档要排除本机级键），四处都不在本 lane 的文件所有权内。
// 这里把分类与默认值钉住，接线时直接用。详见 `src/generalSettingsLocal.ts` 模块头。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultAlternativeBrowserPath,
  defaultGeneralLocalState,
  GENERAL_LOCAL_SETTING_KEYS,
  isMachineLocalGeneralKey,
  resolveBrowserPath,
  splitGeneralSettingsByRoaming,
} from '../src/generalSettingsLocal.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('本机级键就是 GeneralLocalState 的三个（GeneralLocalSettings.kt:79-83），不多不少', () => {
  assert.deepEqual([...GENERAL_LOCAL_SETTING_KEYS], ['defaultProjectDirectory', 'useDefaultBrowser', 'browserPath'])
  for (const key of GENERAL_LOCAL_SETTING_KEYS) assert.equal(isMachineLocalGeneralKey(key), true)
  assert.equal(isMachineLocalGeneralKey('reopenLastProject'), false)
  assert.equal(isMachineLocalGeneralKey(''), false)
})

test('默认值逐条对齐：useDefaultBrowser 默认 true、browserPath 默认 null（:81/:82）', () => {
  assert.deepEqual(defaultGeneralLocalState(), { defaultProjectDirectory: '', useDefaultBrowser: true, browserPath: null })
})

test('browserPath 的按平台回落（:28-35 / getter :66-70）', () => {
  assert.equal(defaultAlternativeBrowserPath('windows'), 'C:\\Program Files\\Internet Explorer\\IExplore.exe')
  assert.equal(defaultAlternativeBrowserPath('mac'), 'open')
  assert.equal(defaultAlternativeBrowserPath('linux'), '/usr/bin/firefox')
  // getter 是 `state.browserPath ?: default` —— 空串与 null 一样要回落。
  assert.equal(resolveBrowserPath(null, 'linux'), '/usr/bin/firefox')
  assert.equal(resolveBrowserPath('  ', 'linux'), '/usr/bin/firefox')
  assert.equal(resolveBrowserPath('/opt/chrome', 'linux'), '/opt/chrome')
})

test('拆开一份扁平设置：只有三个本机级键被挑走，其余可漫游', () => {
  const { roaming, machineLocal } = splitGeneralSettingsByRoaming({
    defaultProjectDirectory: 'D:/Work',
    useDefaultBrowser: false,
    browserPath: '/opt/chrome',
    reopenLastProject: true,
    confirmExit: true,
  })
  assert.deepEqual(Object.keys(roaming).sort(), ['confirmExit', 'reopenLastProject'])
  assert.deepEqual(machineLocal, { defaultProjectDirectory: 'D:/Work', useDefaultBrowser: false, browserPath: '/opt/chrome' })
})

test('坏值按 GeneralLocalState 的形状兜底，不把脏值带走（unknown 键归可漫游，宁多不少）', () => {
  const { roaming, machineLocal } = splitGeneralSettingsByRoaming({
    defaultProjectDirectory: 42,
    useDefaultBrowser: 'false',
    browserPath: 7,
    someUnknownKey: true,
  })
  assert.deepEqual(machineLocal, defaultGeneralLocalState(), '类型不符回落默认值')
  assert.deepEqual(Object.keys(roaming), ['someUnknownKey'])
})

test('现状登记：defaultProjectDirectory 已经是真设置（本仓落在可漫游那一份里）', () => {
  // 上游它在本机级（:80），本仓在 general 设置里；消费点是打开流程的默认目录。
  const model = read('src/settingsModel.ts')
  assert.match(model, /defaultProjectDirectory: string/, '模型里没有这一格')
  assert.match(read('src/workspaceLifecycle.ts'), /generalSettings\.value\.defaultProjectDirectory\.trim\(\) \|\| defaultParent\.value/,
    '打开/新建项目的默认目录没有消费这一格')
  assert.match(read('src/components/SettingsDialog.vue'), /v-model="general\.defaultProjectDirectory"/,
    '设置页没有这一行输入框')
})
