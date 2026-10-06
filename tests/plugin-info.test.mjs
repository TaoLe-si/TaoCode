// 插件的**信息提供者与启用裁决**层（`src/pluginInfo.ts`）的判据。
//
// 上游依据（相对 `intellij-community-master/`，行号本轮实数）：
//  · `platform/ide-core/plugins/src/com/intellij/ide/plugins/UltimateDependencyChecker.kt:10-25`
//    `canBeEnabled(pluginId)` —— 「这个插件在当前 IDE 上下文里能不能被启用」
//  · `platform/ide-core/plugins/src/com/intellij/ide/plugins/PluginFeatureService.kt:69-71`
//    `getPluginForFeature(featureType, implementationName)`（反向索引本体 `data.kt:50-59` 的
//    `PluginFeatureMap.get(implementationName)`，`:59`）
//  · `platform/platform-impl/src/com/intellij/ide/plugins/PluginManagerStateService.kt:115-139`
//    `preparePluginErrors`：全局原因（成环）与逐插件原因分两截，一条环只进一次 `globalErrors`
//  · `platform/core-api/resources/messages/CoreBundle.properties:31`（`File ''{0}'' contains invalid plugin descriptor`）、
//    `:32`（`Plugins {0} cannot be loaded because they form a dependency cycle`）、
//    `:33`（`Depends on plugin ''{0}'' which was marked as incompatible`）、
//    `:34`（`Requires plugin ''{0}'' to be enabled`）、`:36`（`Requires plugin ''{0}'' to be installed`）、
//    `:42`（`Module {0} is declared by multiple plugins`）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  canBeEnabled,
  duplicateFeatures,
  featureProviders,
  pluginLoadingError,
  pluginLoadingErrors,
} from '../src/pluginInfo.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function command(id, action) {
  return { id, title: id, action, group: '插件' }
}
function template(key) {
  return { key, body: 'x', description: '', languages: [] }
}
function plugin(overrides = {}) {
  return {
    id: 'demo', name: 'Demo', version: '1.0', description: '', path: 'C:/plugins/demo',
    enabled: true, error: '', commands: [], templates: [], ...overrides,
  }
}

test('canBeEnabled：清单坏 / 成环 / 必需依赖缺装 三种都点不动，并各给一条原因', () => {
  const brokenManifest = canBeEnabled(plugin({ error: '不是合法 JSON' }))
  assert.equal(brokenManifest.enabled, false)
  assert.match(brokenManifest.reason, /清单无法读取/)

  const cyclic = canBeEnabled(plugin({ dependencyCycle: ['a', 'b'] }))
  assert.equal(cyclic.enabled, false)
  assert.match(cyclic.reason, /循环/)
  assert.match(cyclic.reason, /a、b/, '成环原因要把环上的成员点出来（CoreBundle.properties:32 的 {0}）')

  const missing = canBeEnabled(plugin({ missingDependencies: ['base-lib'] }))
  assert.equal(missing.enabled, false)
  assert.match(missing.reason, /base-lib/, '缺装原因要点名缺哪个（CoreBundle.properties:36 的 {0}）')

  const ok = canBeEnabled(plugin())
  assert.equal(ok.enabled, true)
  assert.equal(ok.reason, '', '能点时不塞话')
})

test('canBeEnabled：必需依赖装着但被停用 —— 点得动（启用会连带把它启起来）', () => {
  // 上游 `PluginEnabler` 不拦这一种，本仓 `native/plugins.cpp` 的 `set_enabled` 同样递归启用必需依赖，
  // 所以这里**不能**把它判成点不动（判错了就是一个永远点不下去的复选框）。
  const verdict = canBeEnabled(plugin({ disabledDependencies: ['base-lib'] }))
  assert.equal(verdict.enabled, true)
  assert.equal(verdict.reason, '')
})

test('pluginLoadingError：停用的插件不算加载失败；缺装/停用/成环逐条点名并带上被牵连的依赖方', () => {
  assert.equal(pluginLoadingError(plugin()), '')
  assert.equal(pluginLoadingError(plugin({ enabled: false })), '', '它就是被停用了，不是加载不起来')

  const missing = pluginLoadingError(plugin({ missingDependencies: ['base'], requiredBy: ['extra'] }))
  assert.match(missing, /需要先安装依赖插件：base/)
  assert.match(missing, /依赖它的插件也起不来：extra/, 'CoreBundle.properties:38-39 的口径：装不起来的插件，它的依赖方同样起不来')

  const disabled = pluginLoadingError(plugin({ disabledDependencies: ['base'] }))
  assert.match(disabled, /需要启用依赖插件：base/, 'CoreBundle.properties:34')

  const cyclic = pluginLoadingError(plugin({ dependencyCycle: ['a', 'b'], requiredBy: ['a'] }))
  assert.match(cyclic, /必需依赖形成循环：a、b/)
  assert.equal(cyclic.includes('依赖它的插件也起不来'), false, '环上的成员已经由循环那条解释了，不再重复点名')
})

test('pluginLoadingErrors：一条环只报一次（上游 globalErrors 不按插件拆）', () => {
  const list = [
    plugin({ id: 'a', name: 'A', dependencyCycle: ['a', 'b'] }),
    plugin({ id: 'b', name: 'B', dependencyCycle: ['a', 'b'] }),
    plugin({ id: 'c', name: 'C' }),
  ]
  const errors = pluginLoadingErrors(list)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /依赖循环：a、b/)

  assert.deepEqual(pluginLoadingErrors([plugin({ id: 'c' })]), [], '没有环就没有全局原因')
})

test('featureProviders：只看会真正被加载的插件，动作按 action、模板按 key', () => {
  const users = [
    plugin({ id: 'p1', commands: [command('cmd.a', 'editor.toggleComment')], templates: [template('Logd')] }),
    plugin({ id: 'p2', commands: [command('cmd.b', 'app.about')] }),
    plugin({ id: 'p3', broken: '必需依赖 base 没装', commands: [command('cmd.c', 'editor.toggleComment')] }),
    plugin({ id: 'p4', error: '清单坏', templates: [template('Logd')] }),
  ]
  const ids = list => list.map(item => item.id)
  // p3 是 broken（装不起来）、p4 清单读不出来 —— 上游那张表是在扩展点处理过程中登记的，
  // 未加载的插件不登记，所以两者都不算提供者。
  assert.deepEqual(ids(featureProviders(users, 'action', 'editor.toggleComment')), ['p1'])
  assert.deepEqual(ids(featureProviders(users, 'template', 'Logd')), ['p1'])
  assert.deepEqual(featureProviders(users, 'action', 'nope'), [], '没有提供者是空数组，不是 null')
})

test('duplicateFeatures：同一入口点被多个插件声明是一条错误，插件名去重并按名排序', () => {
  const users = [
    plugin({ id: 'p1', name: 'Alpha', commands: [command('c1', 'app.about')] }),
    plugin({ id: 'p2', name: 'Beta', commands: [command('c2', 'app.about'), command('c3', 'app.about')] }),
    plugin({ id: 'p3', name: 'Gamma', enabled: false, templates: [template('Logd')] }),
    plugin({ id: 'p4', name: 'Delta', templates: [template('Logd')] }),
    plugin({ id: 'p5', name: 'Eps', error: '清单坏', commands: [command('c9', 'app.about')] }),
  ]
  const found = duplicateFeatures(users)
  assert.deepEqual(found.map(item => `${item.type}:${item.name}`), ['action:app.about', 'template:Logd'])
  assert.deepEqual(found[0].plugins, ['Alpha', 'Beta'], '同一插件声明两次只算一个所有者；读不出清单的 p5 不计')
  assert.deepEqual(found[1].plugins, ['Delta', 'Gamma'], '停用的插件仍计（上游的模块 id 冲突与启用状态无关），所有者按名排序')
})

test('duplicateFeatures：没有冲突就是空表（界面上不渲染那一节）', () => {
  const users = [
    plugin({ id: 'p1', name: 'Alpha', commands: [command('c1', 'app.about')] }),
    plugin({ id: 'p2', name: 'Beta', templates: [template('Logd')] }),
  ]
  assert.deepEqual(duplicateFeatures(users), [])
})

test('接线：加载错误清单与「另由谁贡献」真的进了插件页', () => {
  const dialog = read('src/components/PluginDialog.vue')
  // 整页的加载错误（全局成环 + 重复声明）—— 空表时整节不渲染
  assert.match(dialog, /const loadErrors = computed\(\(\) => \[\n {2}\.\.\.pluginLoadingErrors\(props\.plugins\)/)
  assert.match(dialog, /v-if="loadErrors\.length" class="plugin-load-errors" role="status"/)
  // 逐插件的加载原因走 pluginLoadingError，而不是只把 native 的 broken 串贴上去
  assert.match(dialog, /pluginLoadingError\(selected\)/)
  // 反向索引用在命令与模板行上
  assert.match(dialog, /otherProviders\('action', command\.action\)/)
  assert.match(dialog, /otherProviders\('template', template\.key\)/)
  assert.match(dialog, /function otherProviders\(kind: 'action' \| 'template', name: string\): PluginInfo\[\]/)
  // 复选框那道门仍然是 canBeEnabled（不是另一套判据）
  assert.match(dialog, /:disabled="busy \|\| !pluginCanToggle\(plugin\)"/)
  assert.match(dialog, /return canBeEnabled\(plugin\)\.enabled/)
})
