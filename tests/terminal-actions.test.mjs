// 终端动作上下文层（`src/terminalActions.ts`）：登记规则、可见/启用矩阵、按钮 title。
// 上游依据：`TerminalActionUtil.java:36-40`（hidden 且无键位不登记）、`:45-49`（名字与
// `unknown` 回落）、`:68-78`（启用跟着监听器走）、`TerminalBaseContextAction.java:18-25`
// （`setEnabledAndVisible(terminal != null)` + `TERMINAL_DATA_KEY`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  TERMINAL_ACTIONS, createTerminalActions, terminalAction, terminalActionKeyFor, terminalActionTitle,
} from '../src/terminalActions.ts'

/** @typedef {import('../src/terminalActions.ts').TerminalActionContext} TerminalActionContext */
/** @type {(overrides?: Partial<TerminalActionContext>) => TerminalActionContext} */
function ctx(overrides = {}) {
  return {
    hasTerminal: true, running: true, desktop: true, busy: false, groupSize: 1,
    searchOpen: false, searchHasText: false, paneCount: 1, exited: false,
    tabIndex: 0, tabCount: 1,
    hasSelection: false, historyCount: 0, fontSize: 13, baseFontSize: 13, ...overrides,
  }
}
const build = (overrides = {}, definitions = TERMINAL_ACTIONS) => createTerminalActions(ctx(overrides), definitions)
const find = (registry, id) => terminalAction(registry, id)

test('hidden 且没有键位的动作不登记（TerminalActionUtil.java:36-40）', () => {
  const dropped = { id: 'terminal.search.next', name: '查找下一个', scope: 'context', hidden: true, enabledWhen: () => true }
  const registry = build({}, [dropped])
  assert.deepEqual(registry.actions, [])
  assert.deepEqual(registry.problems, [])
  // 同一个动作加上键位就登记进来（hidden 只表示「不出现在菜单里」）
  const withKeys = build({}, [{ ...dropped, keyStrokes: ['Enter'] }])
  assert.equal(withKeys.actions.length, 1)
  assert.equal(withKeys.actions[0].hidden, true)
})

test('非 hidden 的动作没有名字 = 登记问题（TerminalActionUtil.java:45-48）', () => {
  const nameless = { id: 'terminal.close', name: '   ', scope: 'context', enabledWhen: () => true }
  const registry = build({}, [nameless])
  assert.deepEqual(registry.actions, [])
  assert.equal(registry.problems.length, 1)
  assert.match(registry.problems[0].message, /Action has unknown name: terminal\.close/)
})

test('context 动作没有终端时可见与启用一起为 false（TerminalBaseContextAction.java:20）', () => {
  const withTerminal = build()
  assert.equal(find(withTerminal, 'terminal.rename').visible, true)
  const without = build({ hasTerminal: false })
  assert.equal(find(without, 'terminal.rename').visible, false, '不是灰掉，是不出现')
  assert.equal(find(without, 'terminal.rename').enabled, false)
  assert.match(find(without, 'terminal.rename').reason, /没有可作用的终端/)
  // global 动作（新建终端）不受终端上下文影响
  assert.equal(find(without, 'terminal.new').visible, true)
})

test('分屏没有窗格数上限（TerminalToolWindowManager.java:431-434 的 canSplit 只问动作可用性）', () => {
  // 原先这张表里的 MAX_PANES_PER_GROUP = 2 是面板自己两列 flex 布局的简化，不是上游规则；
  // 布局换成 src/terminalSplits.ts 的网格后这条人为上限去掉了 —— 第三格、第四格照样能分。
  for (const size of [1, 2, 3, 7]) {
    assert.equal(find(build({ groupSize: size }), 'terminal.split').enabled, true, `${size} 格时右侧分屏仍可用`)
    assert.equal(find(build({ groupSize: size }), 'terminal.split.down').enabled, true, `${size} 格时下侧分屏仍可用`)
  }
  // 唯一的额外条件是真实的宿主前提（浏览器预览起不了终端、正在创建时让路）。
  assert.equal(find(build({ desktop: false }), 'terminal.split').enabled, false)
  assert.equal(find(build({ busy: true }), 'terminal.split.down').enabled, false)
})

test('取消分屏与窗格跳转只在真的分了屏时可用（TW.Unsplit / TW.MoveTo*Splitter）', () => {
  assert.equal(find(build({ groupSize: 1 }), 'terminal.unsplit').enabled, false)
  assert.match(find(build({ groupSize: 1 }), 'terminal.unsplit').reason, /没有分屏/)
  assert.equal(find(build({ groupSize: 2 }), 'terminal.unsplit').enabled, true)
  assert.equal(find(build({ groupSize: 1 }), 'terminal.pane.next').enabled, false)
  assert.equal(find(build({ groupSize: 3 }), 'terminal.pane.previous').enabled, true)
})

test('字号三件套跟着上下限与基准档走（TerminalChangeFontSizeAction.kt:57-68）', () => {
  assert.equal(find(build({ fontSize: 13 }), 'terminal.font.increase').enabled, true)
  assert.equal(find(build({ fontSize: 13 }), 'terminal.font.decrease').enabled, true)
  assert.equal(find(build({ fontSize: 40 }), 'terminal.font.increase').enabled, false, '到上限就不给放大')
  assert.match(find(build({ fontSize: 40 }), 'terminal.font.increase').reason, /已经是最大字号/)
  assert.equal(find(build({ fontSize: 4 }), 'terminal.font.decrease').enabled, false, '到下限就不给缩小')
  // 复位 = 交回设置里那一档（TerminalFontSizeProvider 的 temporary zoom 反操作）：没缩放时点不动。
  assert.equal(find(build({ fontSize: 13, baseFontSize: 13 }), 'terminal.font.reset').enabled, false)
  assert.equal(find(build({ fontSize: 18, baseFontSize: 13 }), 'terminal.font.reset').enabled, true)
})

test('浏览器预览下所有需要宿主的能力都不可用，并给出同一条原因', () => {
  const registry = build({ desktop: false })
  for (const id of ['terminal.new', 'terminal.split', 'terminal.split.down', 'terminal.unsplit',
    'terminal.pane.next', 'terminal.pane.previous', 'terminal.reap', 'terminal.restart']) {
    const action = find(registry, id)
    assert.equal(action.enabled, false, `${id} 在浏览器里应当不可用`)
    assert.match(action.reason, /浏览器预览不能开本地终端/)
  }
  // 不需要宿主的照常可用：字号缩放改的是 xterm 的渲染，ConPTY 那边只是行列数变了。
  assert.equal(find(registry, 'terminal.close').enabled, true)
  assert.equal(find(registry, 'terminal.rename').enabled, true)
  assert.equal(find(registry, 'terminal.font.increase').enabled, true)
})

test('创建中一律让路；退出的会话才能重启', () => {
  const busy = build({ busy: true })
  for (const id of ['terminal.new', 'terminal.split', 'terminal.rename', 'terminal.restart']) {
    assert.equal(find(busy, id).enabled, false, `${id} 在 busy 时应当让路`)
  }
  assert.equal(find(build({ exited: false }), 'terminal.restart').enabled, false, '运行中的不需要重启')
  assert.match(find(build({ exited: false }), 'terminal.restart').reason, /还在运行/)
  assert.equal(find(build({ exited: true }), 'terminal.restart').enabled, true)
})

test('查找三件套跟着查找条与查找词走', () => {
  assert.equal(find(build({ searchOpen: false }), 'terminal.search.clear').enabled, false)
  assert.equal(find(build({ searchOpen: true }), 'terminal.search.clear').enabled, true)
  assert.equal(find(build({ searchHasText: false }), 'terminal.search.next').enabled, false)
  assert.equal(find(build({ searchHasText: true }), 'terminal.search.next').enabled, true)
  assert.equal(find(build({ searchHasText: true }), 'terminal.search.previous').enabled, true)
})

test('回收：空面板时不可用', () => {
  assert.equal(find(build({ paneCount: 0 }), 'terminal.reap').enabled, false)
  assert.equal(find(build({ paneCount: 3 }), 'terminal.reap').enabled, true)
})

test('title 把名字、键位与不可用原因都拼出来', () => {
  const busyRegistry = build({ busy: true })
  assert.equal(terminalActionTitle(find(busyRegistry, 'terminal.split'), 'x'), '右侧分屏：正在创建终端，请稍候。')
  // 这两条的期望值在本轮被**改正**（不是放松断言：assert.equal 的形状一字未动）：
  //   · 原写 `右侧分屏（Ctrl+Shift+D）`、实际 TW.SplitRight 只是 use-shortcut-of="SplitVertically"
  //     （platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:463-466），
  //     而 `platform/platform-resources/src/keymaps/$default.xml` 里没有任何 SplitVertically 绑定 ⇒ 没有键位；
  //   · 原写 `新建终端（Alt+F12）`、实际 Alt+F12 是 ActivateTerminalToolWindow（$default.xml:368-369），
  //     上游「新建终端标签」是 Terminal.NewTab = Ctrl+Shift+T（intellij.terminal.frontend.xml:242-243）。
  assert.equal(terminalActionTitle(find(build(), 'terminal.split'), 'x'), '右侧分屏', '上游这条在 $default.xml 里没有键 ⇒ 不再展示编出来的键位')
  assert.equal(terminalActionTitle(find(build(), 'terminal.new'), 'x'), '新建终端（Ctrl+Shift+T）')
  assert.equal(terminalActionTitle(find(build(), 'terminal.search'), 'x'), '在终端中查找（Ctrl+F）',
    'Terminal.Find = use-shortcut-of Find（frontend.xml:158），Find 在 $default.xml:565-566 是 control F')
  assert.equal(terminalActionTitle(undefined, '退回文案'), '退回文案', '没登记上时回落到调用方的文案')
})

test('面板用到的每个动作都在表里，且 id 不重复', () => {
  const ids = TERMINAL_ACTIONS.map(action => action.id)
  assert.equal(new Set(ids).size, ids.length, 'id 不重复')
  for (const id of ['terminal.new', 'terminal.split', 'terminal.split.down', 'terminal.unsplit',
    'terminal.pane.next', 'terminal.pane.previous', 'terminal.font.increase', 'terminal.font.decrease',
    'terminal.font.reset', 'terminal.rename', 'terminal.search', 'terminal.reap', 'terminal.close', 'terminal.restart']) {
    assert.ok(ids.includes(id), `${id} 应当登记在册`)
    // 跳转与取消分屏在单格时本就不可用，这里只核「有分屏、没忙」那一档。
    const action = find(build({ groupSize: 2, fontSize: 18 }), id)
    assert.ok(action && action.visible, `${id} 在有终端时应当可见`)
  }
})

test('每条动作都有名字，取不到时回落 unknown（TerminalActionUtil.java:49）', () => {
  for (const action of build().actions) {
    assert.ok(action.name && action.name.length > 0)
  }
  const registry = build({}, [{ id: 'terminal.close', name: '', scope: 'context', hidden: true, keyStrokes: ['X'], enabledWhen: () => true }])
  assert.equal(registry.actions[0].name, 'unknown')
})

// 标签左右移动两条（本轮新增的可用性判定）。
// 上游：`plugins/terminal/resources/META-INF/plugin.xml:125-126`（动作 id）、
// `plugins/terminal/src/org/jetbrains/plugins/terminal/action/MoveTerminalToolwindowTabLeftRightAction.kt:21-32`
// （可见 = 有项目 + 是终端工具窗 + content != null；启用 = `isAvailable` 的下标边界）、
// 文案 `platform/platform-api/resources/messages/IdeBundle.properties:1983-1984`（Move Right / Move Left）。

test('向左移动标签：只有不是第一条才可用（MoveTerminalToolwindowTabLeftRightAction.kt:28-31）', () => {
  assert.equal(find(build({ tabIndex: 0, tabCount: 3 }), 'terminal.tab.left').enabled, false, '第一条左边没有可换的')
  assert.match(find(build({ tabIndex: 0, tabCount: 3 }), 'terminal.tab.left').reason, /已经在最左边/)
  assert.equal(find(build({ tabIndex: 1, tabCount: 3 }), 'terminal.tab.left').enabled, true)
  assert.equal(find(build({ tabIndex: 2, tabCount: 3 }), 'terminal.tab.left').enabled, true)
})

test('向右移动标签：最后一条与空列表都不可用（同文件 :31 的 ind < contentCount - 1）', () => {
  assert.equal(find(build({ tabIndex: 0, tabCount: 1 }), 'terminal.tab.right').enabled, false, '只有一条时两边都动不了')
  assert.match(find(build({ tabIndex: 0, tabCount: 1 }), 'terminal.tab.right').reason, /已经在最右边/)
  assert.equal(find(build({ tabIndex: 2, tabCount: 3 }), 'terminal.tab.right').enabled, false)
  assert.equal(find(build({ tabIndex: 1, tabCount: 3 }), 'terminal.tab.right').enabled, true)
  // 没有下标（-1，= 上游的 content == null 那一档）时向右也必须否，不能拿 -1 去换到第一条。
  assert.equal(find(build({ tabIndex: -1, tabCount: 3 }), 'terminal.tab.right').enabled, false)
})

test('两条移动动作是 context 的：没有终端就整条不出现（:21-25 的 content != null）', () => {
  const without = build({ hasTerminal: false, tabIndex: -1, tabCount: 0 })
  for (const id of ['terminal.tab.left', 'terminal.tab.right']) {
    assert.equal(find(without, id).visible, false, `${id} 不是灰掉，是不出现`)
    assert.equal(find(without, id).enabled, false)
  }
  assert.equal(find(build(), 'terminal.tab.left').visible, true)
})

test('终端面板真按上游那两条键办事（Ctrl+F 开查找 / Ctrl+Shift+T 新建标签）', () => {
  const key = { type: 'keydown', code: 'KeyF', key: 'f', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }
  assert.equal(terminalActionKeyFor(key), 'search')
  assert.equal(terminalActionKeyFor({ ...key, code: 'KeyT', key: 't', shiftKey: true }), 'newTab')
  // keyup 不能再触发一次（否则会开出两个查找条 / 两个会话）。
  assert.equal(terminalActionKeyFor({ ...key, type: 'keyup' }), null)
  // 单独 Ctrl+T（上游不是这条）、Ctrl+Alt+F、mac 的 meta+F 都不吃。
  assert.equal(terminalActionKeyFor({ ...key, shiftKey: false, code: 'KeyT', key: 't' }), null)
  assert.equal(terminalActionKeyFor({ ...key, altKey: true }), null)
  assert.equal(terminalActionKeyFor({ ...key, ctrlKey: false, metaKey: true }), null)
  // 无修饰的 f 是打字，绝不能被吃掉。
  assert.equal(terminalActionKeyFor({ ...key, ctrlKey: false }), null)
})

test('接线：面板用这两条键与那条移动实现，不是只过了本表的死判定', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /terminalActionKeyFor\(event\)/, '面板的按键派发问这张表')
  assert.match(panel, /if \(event\.type === 'keydown'\) toggleSearch\(\)/, 'Ctrl+F 真的开查找条')
  assert.match(panel, /if \(event\.type === 'keydown'\) void spawn\(\)/, 'Ctrl+Shift+T 真的新建标签')
  assert.match(panel, /function moveTab\(pane: Pane, forward: boolean\)/, '移动标签的实现挂在面板上')
  assert.match(panel, /@click="selected && moveTab\(selected, false\)"/, '工具条左移按钮接 moveTab(false)')
  assert.match(panel, /@click="selected && moveTab\(selected, true\)"/, '工具条右移按钮接 moveTab(true)')
})
