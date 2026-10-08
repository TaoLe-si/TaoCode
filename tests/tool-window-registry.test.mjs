// 工具窗口**注册表**的判据 —— IDEA `ToolWindowEP` + `ToolWindowFactory` + `RegisterToolWindowTask`
// 那一层在本仓的等价物（`src/toolWindowMeta.ts` 的 `TOOL_WINDOW_REGISTRY`）。
//
// 这一条门禁要防的事：**加一个工具窗口又被拆成四处改**（id 联合 + 标题表 + 图标表 + 锚点表 +
// 顺序表 + 可用性函数）。所以：
//   ① 每条记录都要齐（id/title/icon/anchor）；
//   ② 其余几张表必须**等于**注册表派生出来的那一份（不是"另有一份看着一样"）；
//   ③ 可用性只准住在注册表里（窗口自己的 `shouldBeAvailable`），别处不许再按 id 判一遍；
//   ④ 派生出来的默认布局与上游 `defaultToolWindowlayoutProvider.kt:244-267` 的 V1/V2 一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_TOOL_ANCHORS, DEFAULT_TOOL_ORDER, TOOL_MNEMONIC_ORDER, TOOL_WINDOW_REGISTRY,
  shouldBeAvailable, toolIcons, toolTitles, toolWindowOrder, toolWindowRegistration,
} from '../src/toolWindowMeta.ts'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function withStorage(run) {
  const store = new Map()
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: key => { store.delete(key) },
  }
  try { return run(store) } finally { globalThis.localStorage = previous }
}
const stripesWith = overrides => createToolWindowStripes({
  isDesktop: true,
  workspace: { value: { root: 'D:/p', name: 'p', entries: [] } },
  lspReady: { value: true },
  gradleAvailable: { value: false },
  explorer: { value: true },
  activeView: { value: 'files' },
  ...overrides,
})

test('每条注册项都齐，且 id 不重复', () => {
  const ids = TOOL_WINDOW_REGISTRY.map(entry => entry.id)
  assert.equal(new Set(ids).size, ids.length, 'id 不能重复')
  for (const entry of TOOL_WINDOW_REGISTRY) {
    assert.ok(entry.id && typeof entry.id === 'string', '缺 id')
    assert.ok(entry.title && typeof entry.title === 'string', `${entry.id} 缺条纹标题`)
    assert.ok(entry.icon, `${entry.id} 缺图标`)
    assert.ok(['left', 'right', 'bottom'].includes(entry.anchor), `${entry.id} 的锚点不合法`)
  }
  assert.equal(toolWindowRegistration('files')?.title, '项目')
  assert.equal(toolWindowRegistration('不存在的窗口'), undefined, '查不到就是没有这个窗口')
})

test('四张表都是注册表派生出来的，不是另抄一份', () => {
  const ids = TOOL_WINDOW_REGISTRY.map(entry => entry.id)
  assert.deepEqual(toolWindowOrder, ids, '枚举顺序 = 注册表顺序')
  assert.deepEqual(Object.keys(toolTitles), ids)
  assert.deepEqual(Object.keys(toolIcons), ids)
  assert.deepEqual(Object.keys(DEFAULT_TOOL_ANCHORS), ids)
  for (const entry of TOOL_WINDOW_REGISTRY) {
    assert.equal(toolTitles[entry.id], entry.title)
    assert.equal(toolIcons[entry.id], entry.icon)
    assert.equal(DEFAULT_TOOL_ANCHORS[entry.id], entry.anchor)
  }
  const source = read('src/toolWindowMeta.ts')
  assert.match(source, /export const toolTitles: Record<ToolWindowId, string> = derived\(/, '标题表要派生')
  assert.match(source, /export const DEFAULT_TOOL_ORDER: Record<ToolWindowAnchor, ToolWindowId\[\]> = \{/, '顺序表要派生')
})

test('默认布局派生出上游 V1/V2 的那三行（defaultToolWindowlayoutProvider.kt:244-267）', () => {
  assert.deepEqual(DEFAULT_TOOL_ORDER.left, ['files', 'git', 'outline', 'bookmarks'])
  assert.deepEqual(DEFAULT_TOOL_ORDER.bottom, ['vcslog', 'search', 'todo', 'debug'])
  // 右条纹那一行上游 V2 是 Notifications → AIAssistant → Database → Gradle → Maven
  // （`defaultToolWindowlayoutProvider.kt:263-273`）。本仓只保留 Gradle + Notifications，
  // 外加**对标 `AIAssistant` 那一格**的 Agent 对话窗口（`agent`，右锚、非 side tool）。
  // 表里的次序是**画出来**的次序 ⇒ 前面那一组（gradle、agent）在前，side tool（notifications）末尾。
  assert.deepEqual(DEFAULT_TOOL_ORDER.right, ['gradle', 'agent', 'notifications'])
})

test('助记符只给有 Activate 动作的窗口（注册表的 numbered）', () => {
  assert.deepEqual(TOOL_MNEMONIC_ORDER, ['files', 'git', 'vcslog', 'search', 'todo', 'outline', 'bookmarks', 'debug'])
  assert.ok(!TOOL_MNEMONIC_ORDER.includes('gradle') && !TOOL_MNEMONIC_ORDER.includes('notifications'))
})

test('可用性只住在注册表里：shouldBeAvailable 逐条对得上', () => {
  const all = { isDesktop: true, hasWorkspace: true, lspReady: true, gradleAvailable: true }
  for (const entry of TOOL_WINDOW_REGISTRY) assert.equal(shouldBeAvailable(entry.id, all), true, `${entry.id} 在一切就绪时可用`)
  // 上游 AbstractExternalSystemToolWindowFactory.java:32-34（Gradle）、
  // vcsToolWindowFactories.kt:60-63（VCS 日志）、以及本仓对结构视图的映射。
  assert.equal(shouldBeAvailable('gradle', { ...all, gradleAvailable: false }), false)
  assert.equal(shouldBeAvailable('gradle', { ...all, isDesktop: false }), false)
  assert.equal(shouldBeAvailable('vcslog', { ...all, hasWorkspace: false }), false)
  assert.equal(shouldBeAvailable('vcslog', { ...all, isDesktop: false }), false)
  assert.equal(shouldBeAvailable('outline', { ...all, lspReady: false }), false)
  assert.equal(shouldBeAvailable('files', { ...all, lspReady: false, gradleAvailable: false, hasWorkspace: false }), true,
    '没有 available 的窗口恒可用（上游也没有 shouldBeAvailable）')
  // 状态域不许再按 id 判一遍 —— 那条判据的存在就是"加窗口要改两处"的来源。
  const state = read('src/toolWindowStripes.ts')
  const body = state.slice(state.indexOf('function toolDisabled'), state.indexOf('function toolDisabled') + 400)
  assert.ok(!/id === '/.test(body), 'toolDisabled 里不许再出现按 id 的分支')
  assert.match(body, /shouldBeAvailable\(id, \{/, '它只该把项目状态递给注册表')
})

test('状态域与条纹按钮读的是同一条判据', () => {
  withStorage(() => {
    const noGradle = stripesWith({ gradleAvailable: { value: false } })
    assert.equal(noGradle.toolDisabled('gradle'), true, '不是 Gradle 项目 ⇒ 窗口灰着（但按钮还在）')
    assert.ok(noGradle.stripeOrder.value('right').includes('gradle'), '灰着 ≠ 从条纹上摘掉')
    const ready = stripesWith({ gradleAvailable: { value: true } })
    assert.equal(ready.toolDisabled('gradle'), false)
    const noLsp = stripesWith({ lspReady: { value: false } })
    assert.equal(noLsp.toolDisabled('outline'), true)
  })
})
