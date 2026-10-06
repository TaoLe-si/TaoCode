// 状态栏**组件注册表**的判据（IDEA `StatusBarWidgetFactory` + `StatusBarWidgetsManager` +
// `StatusBarWidgetSettings` 三件）。
//
// 上游逐条核过的出处：
//   · 工厂字段面 `platform-api/.../StatusBarWidgetFactory.java`：`getId`(:31-34)、`getDisplayName`(:37-41)、
//     `isAvailable`(:68-70)、`isEnabledByDefault`(:112-114)、`isConfigurable`(:122-124)、`isInternal`(:128-130)。
//   · 三道闸 `StatusBarWidgetsManager.updateWidget`(:98-100)：
//     `(isConfigurable && !settings.isEnabled(factory)) || !isAvailable || !isAllowedByInternalMode` ⇒ 不建。
//   · "只存与默认不同的" `StatusBarWidgetSettings.setEnabled`(:32-40)；查回来是 `widgets[id] ?: isEnabledByDefault`(:26-28)。
//   · 勾选清单只列 `isConfigurable` 的（`StatusBarActionManager.getActionsFor` :191-196）。
//   · 默认值出处：`Memory`/`PowerSaveMode`/`VfsRefresh` 的 `isEnabledByDefault() = false`；
//     `SmartModeIndicator` 默认 false 且 `isInternal = true`；`FatalError` `isConfigurable = false`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configurableFactories, migrateHiddenKeys, shouldCreateWidget, widgetEnabled, widgetToggleEnabled, withWidgetEnabled } from '../src/statusBarWidgets.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const factory = (over = {}) => ({ id: 'x', displayName: 'X', ...over })

test('默认值：没存过就按 isEnabledByDefault，默认是 true', () => {
  assert.equal(widgetEnabled({}, factory()), true, '上游默认 true')
  assert.equal(widgetEnabled({}, factory({ enabledByDefault: false })), false)
  // 存过的值优先
  assert.equal(widgetEnabled({ x: false }, factory()), false)
  assert.equal(widgetEnabled({ x: true }, factory({ enabledByDefault: false })), true)
})

test('切到与默认相同的值时把那条删掉（上游 setEnabled :32-40）', () => {
  const off = factory({ enabledByDefault: false })
  // 默认关的组件开一下 → 存 true
  assert.deepEqual(withWidgetEnabled({}, off, true), { x: true })
  // 再关回去 = 回到默认 → 这条从存档里消失（不是存一个 false）
  assert.deepEqual(withWidgetEnabled({ x: true }, off, false), {})
  // 默认开的组件关一下 → 存 false；再开回去 → 消失
  const on = factory()
  assert.deepEqual(withWidgetEnabled({}, on, false), { x: false })
  assert.deepEqual(withWidgetEnabled({ x: false }, on, true), {})
  // 别的组件的覆盖不受影响
  assert.deepEqual(withWidgetEnabled({ y: false }, on, false), { y: false, x: false })
})

test('三道闸：不可配置时忽略可见性，isAvailable/isInternal 各自否决', () => {
  // 不可配置的组件即使被显式关了也照样画（它不由可见性设置管）
  assert.equal(shouldCreateWidget(factory({ configurable: false }), { x: false }), true)
  // 可配置且被关 → 不画
  assert.equal(shouldCreateWidget(factory(), { x: false }), false)
  // 不可用 → 不画，哪怕它是开着的
  assert.equal(shouldCreateWidget(factory({ available: false }), {}), false)
  // 内部组件在本仓（无内部模式）不画
  assert.equal(shouldCreateWidget(factory({ internal: true }), {}), false)
})

test('勾选清单只列可配置且非内部的组件（上游 getActionsFor 过滤 isConfigurable）', () => {
  const all = [factory({ id: 'a' }), factory({ id: 'b', configurable: false }), factory({ id: 'c', internal: true })]
  assert.deepEqual(configurableFactories(all).map(entry => entry.id), ['a'])
})

test('editor-based 工厂在没有编辑器时不可开启（上游 canBeEnabledOn）', () => {
  // StatusBarEditorBasedWidgetFactory.canBeEnabledOn = getTextEditor(statusBar) != null
  const based = factory({ editorBased: true })
  assert.equal(widgetToggleEnabled(based, true), true, '有编辑器时可点')
  assert.equal(widgetToggleEnabled(based, false), false, '没编辑器时变灰')
  // 不是 editor-based 的组件两种情形都可点
  assert.equal(widgetToggleEnabled(factory(), false), true)
  assert.equal(widgetToggleEnabled(factory(), true), true)
  // 内部组件（本仓无内部模式）一律不可开启
  assert.equal(widgetToggleEnabled(factory({ internal: true }), true), false)
})

test('旧存档（隐藏键数组）能迁移成 id→覆盖 映射，坏输入一律当空', () => {
  assert.deepEqual(migrateHiddenKeys(['branch', 'memory']), { branch: false, memory: false })
  for (const bad of [null, undefined, 'x', 3, {}, [1, 2], ['ok', 5]]) {
    const mapped = migrateHiddenKeys(bad)
    assert.equal(typeof mapped, 'object', `${String(bad)} 应给出对象`)
    for (const value of Object.values(mapped)) assert.equal(value, false, '只映射成 false')
  }
})

test('装配：App.vue 的勾选清单走注册表，且工具栏/状态栏那三条不是工厂', () => {
  const app = read('src/App.vue')
  assert.match(app, /v-for="widget in listWidgets\(\)"/, '勾选清单没走注册表')
  assert.match(app, /:aria-checked="widgetChecked\(widget\.id\)"/, '勾选态没走注册表')
  assert.match(app, /@click="toggleWidget\(widget\.id\)"/, '切换没走注册表')
  assert.match(app, /:disabled="!widgetClickable\(widget\.id, Boolean\(active\)\)"/,
    'editor-based 组件的可点态没接上（没编辑器时该变灰）')
  assert.match(app, /import \{ listWidgets, showAllWidgets, showWidget, toggleWidget, widgetChecked, widgetClickable \} from '\.\/statusWidgets'/,
    'App.vue 没从注册表取这六个 API')
  const registry = read('src/statusWidgets.ts')
  // 上游不经过工厂的三个直接画进面板的组件，本仓保留在清单里但标 factory: false。
  // （原写四条、含 `bridge` —— 那条是「模板不消费」的假控件，2026-10-06 桶 status2 已删，
  //   判定过程见 `src/statusWidgets.ts` 表头与 `tests/statusbar-popup-motion-parity.test.mjs` 的 KNOWN_GAPS 注释。）
  for (const id of ['file', 'progress', 'problems']) {
    assert.match(registry, new RegExp(`\\{ id: '${id}', displayName: '[^']+', factory: false \\}`),
      `${id} 应登记为"不是工厂"（上游它直接画进状态栏面板）`)
  }
  // 每个真工厂都要写出上游 id，否则审计对照与门控无从核对。
  const lines = registry.split('\n').filter(line => /^\s*\{ id: '.+', .*factory: true/.test(line))
  // 第九十八批加了 `VfsRefresh`（上游 `VfsRefreshIndicatorWidgetFactory`）⇒ 11 → 12；
  // 本批加 `LanguageServiceStatusBarWidget`（`intellij.platform.lang.impl.xml:1509`、
  // `LanguageServiceWidgetFactory.kt:10`，文案 `LangBundle.properties:604`）⇒ 12 → 13。
  assert.equal(lines.length, 13, `真工厂应有 13 条，实为 ${lines.length}`)
  for (const line of lines) assert.match(line, /upstreamId: '[^']+'/, `缺 upstreamId：${line.trim()}`)
})

test('上游默认值按源码落表（Memory/PowerSave 默认关）', () => {
  const registry = read('src/statusWidgets.ts')
  assert.match(registry, /upstreamId: 'Memory', enabledByDefault: false/, 'Memory 上游默认关')
  assert.match(registry, /upstreamId: 'PowerSaveMode', enabledByDefault: false/, 'PowerSaveMode 上游默认关')
  // 上游 id 必须逐个对得上（含 git 的小写 id 与缩进那个长 id）。
  for (const upstream of ['git', 'Position', 'LineSeparator', 'Encoding', 'ReadOnlyAttribute', 'InsertOverwrite',
    'CodeStyleStatusBarWidget', 'Notifications', 'LanguageServiceStatusBarWidget']) {
    assert.ok(registry.includes(`upstreamId: '${upstream}'`), `缺上游 id ${upstream}`)
  }
  // 语言服务那条不能按 `SmartModeIndicator` 登记：那个上游默认关且 isInternal，
  // 会让本仓这个 chip 默认消失（本仓的语义是 Language Services widget）。
  assert.equal(/upstreamId: 'SmartModeIndicator'/.test(registry), false, 'smertMode 不该按内部指示器登记')
})
