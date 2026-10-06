// 卸载前的「谁还依赖它」—— IDEA 的 `UninstallAction` 在删除插件前先问一次，
// 并把依赖者逐个列进正文。本仓卸载是删目录（`native/plugins.cpp` 的 `uninstall`），
// 不连带删依赖者，所以这一段列的是**真后果**：依赖者会停在「必需依赖缺失」的无效态。
//
// 上游依据（相对 `intellij-community-master/`，行号本轮实数）：
//  · `platform/platform-impl/src/com/intellij/ide/plugins/newui/UninstallAction.kt:91-103`
//    逐个模型取 dependants：空 → 普通确认（`:105-111`），非空 → 换一条列出依赖者的正文再问（`:96-102`）
//  · 同文件 `:137-155` `getUninstallDependentsMessage`（把名字逐个拼进正文）
//  · 同文件 `:127-135` `getUninstallAllMessage`（没有依赖者时的正文）
//  · 同文件 `:50-55` 卸载动作对 bundled 插件**不可见**（本仓没有 bundled 那一层，见交付报告 §6）
//  · `platform/platform-impl/src/com/intellij/ide/plugins/newui/DefaultUiPluginManagerController.kt:754-769`
//    `prepareToUninstall` 的结果形状；`:1452-1479` `getDependents` 的依赖者判定
//  · `platform/platform-impl/src/com/intellij/ide/plugins/marketplace/PrepareToUninstallResult.kt:10-15`
//  · `platform/platform-api/resources/messages/IdeBundle.properties:457`（正文一）、
//    `:459`（标题）、`:2359`（正文二：列出依赖者）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pluginUninstallPrompt, pluginsDependingOn } from '../src/pluginGroups.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function plugin(overrides = {}) {
  return {
    id: 'demo', name: 'Demo', version: '1.0', description: '', path: 'C:/plugins/demo',
    enabled: true, commands: [], templates: [], ...overrides,
  }
}

test('依赖者判定：直接引用者 + 传递引用者都收，自己不算', () => {
  const base = plugin({ id: 'base', name: 'Base' })
  const mid = plugin({ id: 'mid', name: 'Mid', depends: ['base'] })
  const leaf = plugin({ id: 'leaf', name: 'Leaf', depends: ['mid'] })
  const unrelated = plugin({ id: 'other', name: 'Other' })
  const all = [base, mid, leaf, unrelated]

  assert.deepEqual(pluginsDependingOn('base', all).map(item => item.id), ['leaf', 'mid'])
  assert.deepEqual(pluginsDependingOn('mid', all).map(item => item.id), ['leaf'])
  assert.deepEqual(pluginsDependingOn('unrelated-id', all), [])
})

test('停用着的候选者不算依赖者（getDependents 的 !descriptor.isEnabled() → continue，:1464）', () => {
  const base = plugin({ id: 'base', name: 'Base' })
  const active = plugin({ id: 'active', name: 'Active', depends: ['base'] })
  const off = plugin({ id: 'off', name: 'Off', depends: ['base'], enabled: false })
  assert.deepEqual(pluginsDependingOn('base', [base, active, off]).map(item => item.id), ['active'])
})

test('中间节点停用也拦不住传递判定（上游只对候选者自己看启用状态）', () => {
  const base = plugin({ id: 'base', name: 'Base' })
  const midOff = plugin({ id: 'mid', name: 'Mid', depends: ['base'], enabled: false })
  const leaf = plugin({ id: 'leaf', name: 'Leaf', depends: ['mid'] })
  // `mid` 自己因停用不列（`:1464`），但 `leaf` 是启用着的候选者，探路经过 mid 命中 base。
  assert.deepEqual(pluginsDependingOn('base', [base, midOff, leaf]).map(item => item.id), ['leaf'])
})

test('只走必需依赖：optionalDepends 不构成依赖者（processAllNonOptionalDependencies，:1469）', () => {
  const base = plugin({ id: 'base', name: 'Base' })
  const optional = plugin({ id: 'opt', name: 'Opt', optionalDepends: ['base'] })
  assert.deepEqual(pluginsDependingOn('base', [base, optional]), [])
})

test('依赖环不会把判定跑飞（本仓允许清单写坏，探路必须有 visited）', () => {
  const a = plugin({ id: 'a', name: 'A', depends: ['b'] })
  const b = plugin({ id: 'b', name: 'B', depends: ['a'] })
  const c = plugin({ id: 'c', name: 'C', depends: ['b'] })
  assert.deepEqual(pluginsDependingOn('a', [a, b, c]).map(item => item.id).sort(), ['b', 'c'])
})

test('正文两条路：没有依赖者是 prompt.uninstall.plugin，有依赖者逐个点名（:457 / :2359）', () => {
  const solo = plugin({ id: 'solo', name: 'Solo' })
  const plain = pluginUninstallPrompt(solo, [solo])
  assert.deepEqual(plain.dependents, [])
  assert.equal(plain.title, '卸载插件？')
  assert.equal(plain.message, '确定要卸载插件「Solo」吗？')

  const base = plugin({ id: 'base', name: 'Base' })
  const first = plugin({ id: 'one', name: 'First Plugin', depends: ['base'] })
  const second = plugin({ id: 'two', name: 'Second Plugin', depends: ['base'] })
  const prompt = pluginUninstallPrompt(base, [base, first, second])
  assert.equal(prompt.dependents.length, 2)
  // 逐个名字各占一行（上游把它们拼成 HTML 列表：`UninstallAction.kt:142-146`）
  assert.match(prompt.message, /^以下 2 个插件依赖「Base」：\n {2}First Plugin\n {2}Second Plugin\n确定要移除「Base」吗？$/)
})

test('名称缺失时退回 id（本仓的兜底口径与列表行一致）', () => {
  const base = plugin({ id: 'base', name: 'Base' })
  const anonymous = plugin({ id: 'ghost', name: '', depends: ['base'] })
  const prompt = pluginUninstallPrompt(base, [base, anonymous])
  assert.equal(prompt.dependents.length, 1)
  assert.match(prompt.message, /ghost/)
})

test('接线：详情面板在确认卸载前渲染这段提醒', () => {
  const dialog = read('src/components/PluginDialog.vue')
  assert.match(dialog, /pluginUninstallPrompt/)
  assert.match(dialog, /uninstallPrompt\.dependents\.length/)
  assert.match(dialog, /class="plugin-detail-warning"/)
})
