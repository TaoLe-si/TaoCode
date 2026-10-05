// 注册表键模型（`src/registryKeys.ts`）：类型化校验、来源/改动判定、编辑与恢复默认、
// 速度搜索过滤、重启提示子集、设置项绑定（`ExperimentalFeatureRegistryValueWrapper`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REGISTRY_KEYS, applyRegistryEdit, coerceRegistryValue, experimentalRegistryEnabled,
  filterRegistryKeys, registryKeySpec, registryRows, registryToggleKeys, registryValue,
  registryValueChanged, restartRequiredChanges, restoreRegistryDefaults,
} from '../src/registryKeys.ts'
import { defaultGeneralSettings } from '../src/settingsModel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('键表：登记项齐备且默认值与上游一致', () => {
  assert.ok(REGISTRY_KEYS.length >= 8)
  const byKey = new Map(REGISTRY_KEYS.map(spec => [spec.key, spec]))
  const popup = byKey.get('ide.windowSystem.autoShowProcessPopup')
  assert.equal(popup.defaultValue, 'false', 'registry.properties:209-210 默认 false')
  assert.equal(popup.field, 'autoShowProcessPopup')
  assert.equal(byKey.get('clipboard.history.max.items').defaultValue, '100')
  assert.equal(byKey.get('clipboard.history.max.memory').defaultValue, '10000000')
  assert.equal(byKey.get('vfs.background.refresh.interval').defaultValue, '15000')
  assert.equal(byKey.get('ide.tabbedPane.dragToSplitRatio').defaultValue, '0.2')
  assert.equal(byKey.get('ide.max.tool.window.layout.name.length').defaultValue, '50')
  // 每个登记项的消费者文件必须真实存在（表就是本仓的 RegistryKeyBean）。
  for (const spec of REGISTRY_KEYS) {
    assert.ok(spec.consumer.startsWith('src/'), spec.key)
    readFileSync(join(root, spec.consumer), 'utf8')
  }
})

test('类型化解析：布尔/整数/小数，非法值拒绝而不是静默修正', () => {
  const boolean = registryKeySpec('search.everywhere.fuzzy.files.enabled')
  assert.equal(coerceRegistryValue(boolean, ' true '), 'true')
  assert.equal(coerceRegistryValue(boolean, 'yes'), null, '不是 true/false 就拒绝')
  const items = registryKeySpec('clipboard.history.max.items')
  assert.equal(coerceRegistryValue(items, '0200'), '200', '整数规范化')
  assert.equal(coerceRegistryValue(items, '2.5'), null)
  const ratio = registryKeySpec('ide.tabbedPane.dragToSplitRatio')
  assert.equal(coerceRegistryValue(ratio, '0.25'), '0.25')
  assert.equal(coerceRegistryValue(ratio, 'x'), null)
  assert.equal(registryKeySpec('no.such.key'), undefined)
})

test('生效值与来源：设置项绑定优先，其次覆盖，最后默认', () => {
  const spec = registryKeySpec('ide.windowSystem.autoShowProcessPopup')
  assert.equal(registryValue(spec, new Map()), 'false')
  assert.equal(registryValueChanged(spec, new Map()), false)
  assert.equal(registryValue(spec, new Map([[spec.key, 'true']])), 'true')
  assert.equal(registryValueChanged(spec, new Map([[spec.key, 'true']])), true)
  // 设置项绑定：即使覆盖表里有值，也以设置页为准（ExperimentalFeatureRegistryValueWrapper 的口径）。
  const general = { ...defaultGeneralSettings, autoShowProcessPopup: true }
  assert.equal(registryValue(spec, new Map([[spec.key, 'false']]), general), 'true')
  assert.equal(rowsWith(general).get(spec.key).source, '设置页')
  assert.equal(rowsWith(new Map([[spec.key, 'true']])).get(spec.key).source, '用户覆盖')
  assert.equal(rowsWith(new Map()).get(spec.key).source, '默认')
})

function rowsWith(overridesOrGeneral) {
  const rows = overridesOrGeneral instanceof Map
    ? registryRows(overridesOrGeneral)
    : registryRows(new Map(), overridesOrGeneral)
  return new Map(rows.map(row => [row.key, row]))
}

test('编辑：未知键与类型错误给错误；改成默认值时删掉覆盖', () => {
  const unknown = applyRegistryEdit(new Map(), 'nope.key', '1')
  assert.ok('error' in unknown && unknown.error.includes('未知'))
  const bound = applyRegistryEdit(new Map(), 'ide.windowSystem.autoShowProcessPopup', 'true')
  assert.ok('error' in bound && bound.error.includes('设置页'), '升格为设置项的键不在覆盖表里改')
  const bad = applyRegistryEdit(new Map(), 'clipboard.history.max.items', 'many')
  assert.ok('error' in bad)
  const edited = applyRegistryEdit(new Map(), 'clipboard.history.max.items', '50')
  assert.equal(edited.overrides.get('clipboard.history.max.items'), '50')
  const back = applyRegistryEdit(edited.overrides, 'clipboard.history.max.items', '100')
  assert.equal(back.overrides.has('clipboard.history.max.items'), false, '等于默认值时不留覆盖')
})

test('恢复默认与重启提示：只清给定键、只报需要重启的改动', () => {
  const overrides = new Map([['clipboard.history.max.items', '50'], ['ide.tabbedPane.dragToSplitRatio', '0.3']])
  const restored = restoreRegistryDefaults(overrides, ['clipboard.history.max.items'])
  assert.equal(restored.has('clipboard.history.max.items'), false)
  assert.equal(restored.get('ide.tabbedPane.dragToSplitRatio'), '0.3')
  assert.equal(restoreRegistryDefaults(overrides).size, 0, '不传键 = 全部恢复')
  // 现有登记键都不要求重启（与上游 registry.properties 的这些条目一致），所以改动子集为空；
  // 判定本身以表里的 restartRequired 为准，登记了就会出现在这里。
  assert.deepEqual(restartRequiredChanges(new Map([['clipboard.history.max.items', '50']]), new Map()), [])
  assert.ok(REGISTRY_KEYS.every(spec => typeof spec.restartRequired === 'boolean'))
})

test('速度搜索过滤：空查询全放行，驼峰缩写命中，不重排', () => {
  assert.equal(filterRegistryKeys(REGISTRY_KEYS, '').length, REGISTRY_KEYS.length)
  const hits = filterRegistryKeys(REGISTRY_KEYS, 'aspp').map(spec => spec.key)
  assert.ok(hits.includes('ide.windowSystem.autoShowProcessPopup'), `驼峰缩写应命中，实际 ${hits.join(',')}`)
  const all = filterRegistryKeys(REGISTRY_KEYS, 'clipboard')
  assert.deepEqual(all.map(spec => spec.key), ['clipboard.history.max.items', 'clipboard.history.max.memory'], '命中顺序 = 表顺序')
  assert.deepEqual(filterRegistryKeys(REGISTRY_KEYS, 'zzz'), [])
})

test('设置页开关绑定：两条实验项 + 说明来自表', () => {
  const toggles = registryToggleKeys()
  assert.deepEqual(toggles.map(spec => spec.field).sort(), ['autoShowProcessPopup', 'fuzzyFileSearch'])
  assert.ok(toggles.every(spec => spec.experimentalId && spec.description.length > 8))
  assert.equal(experimentalRegistryEnabled(toggles[0], { ...defaultGeneralSettings, autoShowProcessPopup: true }), true)
  assert.equal(experimentalRegistryEnabled(toggles[0], defaultGeneralSettings), false)
})

test('接线：设置页开关的说明/改动标注取自注册表键表', () => {
  const component = readFileSync(join(root, 'src/components/GeneralRegistryToggles.vue'), 'utf8')
  assert.match(component, /from '\.\.\/registryKeys'/, '组件没有接注册表键表')
  assert.match(component, /registryKeySpec\(/, '组件没有用表里的说明')
  assert.match(component, /v-model="general\.fuzzyFileSearch"/, '搜索开关的绑定不能在重构里丢')
})
