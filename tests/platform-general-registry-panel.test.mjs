// 「系统设置」页新加的两块（已改动设置的浏览/重置面板 + 注册表键表）的判据。
//
// 立场与仓里其它判据一样：**行为判据**，不是形状判据。
//   · 恢复默认只能动被点名的那一项，数组/对象必须深拷贝（否则页面会一直共享默认对象里那只数组）；
//   · 注册表表只给「真有回退通道」的行放恢复默认按钮（没有后端的控件不放），
//     且上游那条「没有任何改动时按钮是灰的」的门控要真的在（RegistryUi.java:485）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  changedSettings, inspectableSettings, restoreSettingToDefault, restoreSettingsToDefault,
} from '../src/settingsInspector.ts'
import {
  REGISTRY_KEYS, REGISTRY_RESTART_NOTE, registryKeySpec, registryRowRevertible,
  restoreRegistryDefault, visibleRegistryRows,
} from '../src/registryKeys.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 只放三个字段的最小"设置模型"，形状口径与真实 GeneralSettingsState 一致。 */
const DEFAULTS = { confirmExit: true, deleteToBin: false, scopes: ['a', 'b'] }

const clone = object => JSON.parse(JSON.stringify(object))
const spec = key => {
  const found = REGISTRY_KEYS.find(item => item.key === key)
  assert.ok(found, `键表里没有 ${key}`)
  return found
}

test('恢复默认只动被点名的那一项', () => {
  const target = clone(DEFAULTS)
  target.confirmExit = false
  target.deleteToBin = true
  assert.equal(restoreSettingToDefault(DEFAULTS, target, 'confirmExit'), true)
  assert.deepEqual(target, { confirmExit: true, deleteToBin: true, scopes: ['a', 'b'] })
})

test('本来就是默认值时返回 false（调用方据此不标脏）', () => {
  assert.equal(restoreSettingToDefault(DEFAULTS, clone(DEFAULTS), 'deleteToBin'), false)
})

test('默认对象里没有的键不许动', () => {
  const target = clone(DEFAULTS)
  target.stray = 1
  assert.equal(restoreSettingToDefault(DEFAULTS, target, 'stray'), false)
  assert.equal(target.stray, 1)
})

test('数组/对象默认值必须深拷贝，不能让页面共享默认对象里那只数组', () => {
  const target = clone(DEFAULTS)
  target.scopes.push('c')
  assert.equal(restoreSettingToDefault(DEFAULTS, target, 'scopes'), true)
  assert.deepEqual(target.scopes, ['a', 'b'])
  assert.notEqual(target.scopes, DEFAULTS.scopes, '还原后的数组不能再是默认对象里那只')
  target.scopes.push('d')
  assert.deepEqual(DEFAULTS.scopes, ['a', 'b'], '改页面上的数组不许改到默认值')
})

test('整页恢复默认返回被改回的键', () => {
  const target = clone(DEFAULTS)
  target.confirmExit = false
  target.scopes = []
  assert.deepEqual(restoreSettingsToDefault(DEFAULTS, target), ['confirmExit', 'scopes'])
  assert.deepEqual(restoreSettingsToDefault(DEFAULTS, target), [], '再点一次没有东西可恢复')
})

test('检查器列表带默认值（按钮提示要用），数组按"N 项"渲染', () => {
  const target = clone(DEFAULTS)
  target.deleteToBin = true
  target.scopes = []
  const rows = inspectableSettings(DEFAULTS, target)
  assert.deepEqual(rows.map(row => row.path), ['deleteToBin', 'scopes'])
  assert.deepEqual(rows.map(row => [row.value, row.defaultValue]), [['true', 'false'], ['[0 项]', '[2 项]']])
  assert.deepEqual(changedSettings(DEFAULTS, clone(DEFAULTS)), [], '全默认时一行都没有')
})

test('注册表表：速度搜索是过滤档（不匹配的行走掉）', () => {
  const general = { autoShowProcessPopup: false, fuzzyFileSearch: true }
  assert.ok(visibleRegistryRows(general, '').length > 3, '空查询放行全部')
  assert.deepEqual(visibleRegistryRows(general, 'fuzzy').map(row => row.key),
    ['search.everywhere.fuzzy.files.enabled'])
  assert.equal(visibleRegistryRows(general, 'Scroll').length, 2, 'h/v 两条滚动步长都该命中')
  assert.deepEqual(visibleRegistryRows(general, 'zzzq'), [])
})

test('注册表表：来源列跟着真通道走，值跟着设置字段走', () => {
  const general = { autoShowProcessPopup: true, fuzzyFileSearch: false }
  const rows = visibleRegistryRows(general, '')
  const popup = rows.find(row => row.key === 'ide.windowSystem.autoShowProcessPopup')
  assert.equal(popup.source, '设置页')
  assert.equal(popup.value, 'true')
  assert.equal(popup.changed, true, '与上游默认值 false 不一致 ⇒ 已改动')
  const clipboard = rows.find(row => row.key === 'clipboard.history.max.items')
  assert.equal(clipboard.source, '默认')
  assert.equal(clipboard.value, '100')
  assert.equal(clipboard.changed, false)
})

test('注册表表：列头排序三列都真在排（上游 TableRowSorter，RegistryUi.java:193）', () => {
  const general = { autoShowProcessPopup: false, fuzzyFileSearch: false }
  for (const column of ['key', 'value', 'source']) {
    const values = visibleRegistryRows(general, '', column).map(row => row[column])
    assert.deepEqual(values, [...values].sort((a, b) => a.localeCompare(b)), `${column} 列没在排序`)
    if (column === 'source') assert.equal(new Set(values).size, 2, '来源列有两种值，排序得把它们分开')
  }
})

test('恢复默认：只有真能改回去的键给动作，且按上游的启用门控判"改过没有"', () => {
  const general = { autoShowProcessPopup: true, fuzzyFileSearch: true }
  assert.equal(registryRowRevertible(spec('clipboard.history.max.items')), false,
    '没有回退通道的键不给编辑/恢复入口（没有后端就不渲染控件）')
  assert.equal(registryRowRevertible(spec('ide.windowSystem.autoShowProcessPopup')), true)
  assert.equal(restoreRegistryDefault(spec('ide.windowSystem.autoShowProcessPopup'), general), true)
  assert.equal(general.autoShowProcessPopup, false, '改回上游默认值 false')
  assert.equal(restoreRegistryDefault(spec('ide.windowSystem.autoShowProcessPopup'), general), false,
    '已经是默认值 ⇒ 不动、不标脏')
  assert.equal(registryKeySpec('nope.key'), undefined, '未知键不进来')
})

test('需重启的说明是上游 registry.key.requires.ide.restart.note 那句话', () => {
  assert.equal(REGISTRY_RESTART_NOTE, '需要重启 IDE 才生效。')
})

test('面板接线：设置页真的把两块挂上了（不是只过了自己测试的死模块）', () => {
  const toggles = read('src/components/GeneralRegistryToggles.vue')
  assert.match(toggles, /inspectableSettings\(defaultGeneralSettings, props\.general\)/,
    '已改动列表要从设置模型算，别自己数键')
  assert.match(toggles, /restoreSettingsToDefault\(defaultGeneralSettings, props\.general, \[path\]\)/,
    '逐行恢复默认要只动那一键')
  assert.match(toggles, /:disabled="!anyRevertibleChange"/,
    '「恢复默认」按钮必须跟着 RegistryUi.java:485 那条启用门控')
  assert.match(toggles, /visibleRegistryRows\(props\.general, registryQuery\.value, sortColumn\.value\)/,
    '表行来自 registryKeys 的过滤 + 排序，组件不自己算')
  assert.match(toggles, /role="table" aria-label="注册表键"/, '表格要有可访问名')
  assert.match(toggles, /aria-sort=/, '列头排序状态要能被读屏念出来')
  // 没有后端的控件不许存在：注册表键的值列必须是文本，不是输入框。
  assert.doesNotMatch(toggles, /<input[^>]*v-model="row\./, '注册表值不许做成可编辑输入框（没有覆盖值存储位）')
  assert.match(read('src/components/SettingsDialog.vue'), /<GeneralRegistryToggles :general="general" \/>/,
    '挂载点还在设置页的「系统设置」上')
})
