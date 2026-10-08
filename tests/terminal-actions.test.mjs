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
import {
  terminalAlternateBuffer, terminalLineScrollKeyApplies, terminalScrollBy, terminalScrollingApplies, terminalViewportAtBottom,
} from '../src/terminalScrolling.ts'

/** @typedef {import('../src/terminalActions.ts').TerminalActionContext} TerminalActionContext */
/** @type {(overrides?: Partial<TerminalActionContext>) => TerminalActionContext} */
function ctx(overrides = {}) {
  return {
    hasTerminal: true, running: true, desktop: true, busy: false, groupSize: 1,
    searchOpen: false, searchHasText: false, paneCount: 1, exited: false, alternateBuffer: false,
    tabIndex: 0, tabCount: 1, moveFocusToEditorWithEscape: false, editorVisible: true,
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
    'terminal.font.reset', 'terminal.rename', 'terminal.search', 'terminal.reap', 'terminal.close', 'terminal.restart',
    'terminal.page.up', 'terminal.page.down', 'terminal.line.up', 'terminal.line.down', 'terminal.focus.editor']) {
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
  assert.match(panel, /terminalActionKeyFor\(event, \{ moveFocusToEditorWithEscape: moveFocusWithEscape\.value \}\)/,
    '面板的按键派发问这张表（Esc 那一格要把设置传进去，默认关时这把键根本不进这张表）')
  assert.match(panel, /if \(event\.type === 'keydown'\) toggleSearch\(\)/, 'Ctrl+F 真的开查找条')
  assert.match(panel, /if \(event\.type === 'keydown'\) void spawn\(\)/, 'Ctrl+Shift+T 真的新建标签')
  assert.match(panel, /function moveTab\(pane: Pane, forward: boolean\)/, '移动标签的实现挂在面板上')
  assert.match(panel, /@click="selected && moveTab\(selected, false\)"/, '工具条左移按钮接 moveTab(false)')
  assert.match(panel, /@click="selected && moveTab\(selected, true\)"/, '工具条右移按钮接 moveTab(true)')
})

// 翻页滚动终端输出两条（termact 这一批新增的用户可见终端动作）。
// 上游：`plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:205-208`
// （`Terminal.PageUp`，`$default` 键位 shift PAGE_UP）与 `:209-212`（`Terminal.PageDown` = shift PAGE_DOWN）；
// 文案 `plugins/terminal/resources/messages/TerminalBundle.properties:83`（Page Up）与 `:85`（Page Down）；
// 实现 `plugins/terminal/frontend/src/com/intellij/terminal/frontend/action/TerminalScrollingActions.kt:16/:18`（动作类）
// 与同文件 `:37/:39`（`PageUpHandler` = `Unit.PAGE, -1`、`PageDownHandler` = `Unit.PAGE, +1`）
// 与同文件 `:27-29`（启用门 isOutputModelEditor）；
// 语义 `.../view/impl/TerminalOutputScrollingModel.kt:33-38`（一页 = 视口里整行的行数，负数向上）+
// `TerminalOutputScrollingModelImpl.kt:143-172`（`coerceIn` 夹住两端）；
// 菜单位置 `intellij.terminal.frontend.xml:266-268`（ClearBuffer → PageUp → PageDown）。

const pageKeyUp = { type: 'keydown', code: 'PageUp', key: 'PageUp', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false }

test('翻页两条登记在册，键位与上游一致（frontend.xml:205-212）', () => {
  const registry = build()
  const up = find(registry, 'terminal.page.up')
  const down = find(registry, 'terminal.page.down')
  assert.ok(up && down, '两条都在这张表里')
  assert.deepEqual(up.keyStrokes, ['Shift+PageUp'])
  assert.deepEqual(down.keyStrokes, ['Shift+PageDown'])
  assert.equal(up.name, '向上翻页')
  assert.equal(down.name, '向下翻页')
  assert.equal(up.scope, 'context', '上游这两条只在有终端输出时可用')
  assert.equal(terminalActionKeyFor(pageKeyUp), 'pageUp')
  assert.equal(terminalActionKeyFor({ ...pageKeyUp, code: 'PageDown', key: 'PageDown' }), 'pageDown')
  // 不带 Shift 的 PageUp / PageDown 绝不能被面板吃掉 —— 那是 less / man 的翻页键。
  assert.equal(terminalActionKeyFor({ ...pageKeyUp, shiftKey: false }), null)
  assert.equal(terminalActionKeyFor({ ...pageKeyUp, ctrlKey: true }), null)
  assert.equal(terminalActionKeyFor({ ...pageKeyUp, altKey: true }), null)
  assert.equal(terminalActionKeyFor({ ...pageKeyUp, metaKey: true }), null)
  // keyup 再触发一次会多滚一页。
  assert.equal(terminalActionKeyFor({ ...pageKeyUp, type: 'keyup' }), null)
})

test('备用屏里翻页两条不启用（TerminalScrollingActions.kt:27-29 的 isOutputModelEditor）', () => {
  assert.equal(find(build(), 'terminal.page.up').enabled, true)
  assert.equal(find(build(), 'terminal.page.down').enabled, true)
  const alternate = build({ alternateBuffer: true })
  for (const id of ['terminal.page.up', 'terminal.page.down']) {
    assert.equal(find(alternate, id).enabled, false, `${id} 在备用屏里应当不可用`)
    assert.match(find(alternate, id).reason, /备用屏/)
    // 上游那道门 disable 而不 hide（`isEnabled`，不是 `isEnabledAndVisible`）⇒ 条目还在，只是灰的。
    assert.equal(find(alternate, id).visible, true)
  }
  // 没有终端时两条整条不出现（TerminalBaseContextAction.java:20 的 setEnabledAndVisible(terminal != null)）。
  const none = build({ hasTerminal: false })
  assert.equal(find(none, 'terminal.page.up').visible, false)
  assert.equal(find(none, 'terminal.page.down').visible, false)
  // 键盘那一路与菜单那一路问的是同一个真源（这一条门现在是滚动四条共用的，故改名 terminalScrollingApplies）。
  assert.equal(terminalScrollingApplies(false), true)
  assert.equal(terminalScrollingApplies(true), false)
})

test('两条的 title 带上键位，或者把「为什么点不动」说清楚', () => {
  assert.equal(terminalActionTitle(find(build(), 'terminal.page.up'), 'x'), '向上翻页（Shift+PageUp）')
  assert.equal(terminalActionTitle(find(build(), 'terminal.page.down'), 'x'), '向下翻页（Shift+PageDown）')
  assert.equal(terminalActionTitle(find(build({ alternateBuffer: true }), 'terminal.page.up'), 'x'),
    '向上翻页：这个终端在全屏程序里（备用屏），翻页交回该程序。')
})

test('接线：面板真的按这两条滚整页，备用屏把键交回程序，菜单两条紧跟清空缓冲区', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  const scrolling = readFileSync(new URL('../src/terminalScrolling.ts', import.meta.url), 'utf8')
  assert.match(panel, /if \(!terminalScrollingApplies\(isAlternateScreen\(pane\)\)\) return true/, '备用屏里不拦键，交回全屏程序')
  assert.match(panel, /terminalScrollBy\(pane\.instance, 'page', actionKey === 'pageUp' \? -1 : 1\)/, '键盘那一路滚一整页')
  assert.match(panel, /terminalScrollBy\(pane\.instance, unit, direction\)/, '菜单那一路按档位滚（page/line 都走这一条）')
  assert.match(scrolling, /target\.scrollPages\(direction\)/, 'page 那一档落到 xterm 的 scrollPages')
  assert.match(scrolling, /target\.scrollLines\(direction\)/, 'line 那一档落到 xterm 的 scrollLines')
  assert.match(panel, /alternateBuffer: isAlternateScreen\(current\)/, '上下文那一格真按备用屏算，不是写死 false')
  assert.match(panel, /terminalAlternateBuffer\(pane\?\.instance\.buffer\.active\)/, '备用屏的读数来自 xterm 的 buffer.active')
  assert.match(scrolling, /buffer\?\.type === 'alternate'/, '备用屏判定读的是 buffer.type')
  const clearAt = panel.indexOf('@click="clearBuffer"')
  const upAt = panel.indexOf('@click="scrollPage(-1)"')
  const downAt = panel.indexOf('@click="scrollPage(1)"')
  assert.ok(clearAt > 0 && upAt > clearAt && downAt > upAt, '菜单顺序 = ClearBuffer → PageUp → PageDown（frontend.xml:266-268）')
})

// 逐行滚动两条 + 把焦点切回编辑器一条（teampage 这一批 = termact 报告 §1 里「本批未做、可做」那两条）。
// 上游坐标（本轮逐行 sed 打开过，不沿用任何别人写过的行号）：
//   · `plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:197-200` = `Terminal.LineUp`
//     （`:199` 的 `$default` 键位 **control UP**）；`:201-204` = `Terminal.LineDown`（`:203` **control DOWN**）；
//     文案 `plugins/terminal/resources/messages/TerminalBundle.properties:79`（Line Up）/ `:81`（Line Down）；
//     实现 `plugins/terminal/frontend/src/com/intellij/terminal/frontend/action/TerminalScrollingActions.kt:12`/`:14`
//     （两个类）+ `:41`/`:43`（`Unit.LINE, ∓1`）+ `:48-49`（`Unit.LINE -> scrollByLines(direction)`）
//     + 门在同文件 `:27-29`（与翻页两条**同一句**）；菜单位置同 xml `:269-271`（:269 是 `<separator/>`）。
//   · `plugins/terminal/resources/META-INF/plugin.xml:127` = `Terminal.SwitchFocusToEditor`（**没有** `<keyboard-shortcut>`），
//     类 `plugins/terminal/src/org/jetbrains/plugins/terminal/action/TerminalMoveFocusToEditorAction.kt:15-26`
//     （`:18` = `activateEditorComponent()`；`:21-25` = `isEnabledAndVisible` 那三格门，用的是 isReworkedTerminalEditor）；
//     文案 `TerminalBundle.properties:6`；键来自设置那一格
//     `plugins/terminal/frontend/src/com/intellij/terminal/frontend/settings/TerminalOptionsConfigurable.kt:401-405`
//     （预设 Escape = 同文件 `:869-872`；勾选框初值 = 同文件 `:786` 的 `curShortcuts.isNotEmpty()` ⇒ 默认不勾）；
//     Esc 归谁另看 `platform/execution-impl/src/com/intellij/terminal/TerminalEscapeKeyListener.java:49-60`
//     （终端工具窗里「只有匹配上那条 shortcut 才交回编辑器」= `:51-53`）。
//   · 本批新增模块 `src/terminalScrolling.ts`：门、档位、备用屏读数，以及 Ctrl+↑/↓ 归谁的那条代理规则。

const lineUpKey = { type: 'keydown', code: 'ArrowUp', key: 'ArrowUp', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }
const escapeKey = { type: 'keydown', code: 'Escape', key: 'Escape', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }

test('逐行两条登记在册，键位是 control UP/DOWN 而不是翻页那两把（frontend.xml:197-204）', () => {
  const registry = build()
  const up = find(registry, 'terminal.line.up')
  const down = find(registry, 'terminal.line.down')
  assert.ok(up && down, '两条都在这张表里')
  assert.deepEqual(up.keyStrokes, ['Ctrl+↑'])
  assert.deepEqual(down.keyStrokes, ['Ctrl+↓'])
  assert.equal(up.name, '向上滚动一行')
  assert.equal(down.name, '向下滚动一行')
  assert.equal(up.scope, 'context')
  assert.equal(down.hidden, false, '上游这两条在右键菜单里（frontend.xml:270-271）⇒ 不是隐藏动作')
  assert.equal(terminalActionKeyFor(lineUpKey), 'lineUp')
  assert.equal(terminalActionKeyFor({ ...lineUpKey, code: 'ArrowDown', key: 'ArrowDown' }), 'lineDown')
  // 裸 ↑/↓ 是 shell 的命令历史，绝不能被吃掉（上游把它给 `Terminal.SelectBlockBelow`，plugin.xml:167-169）。
  assert.equal(terminalActionKeyFor({ ...lineUpKey, ctrlKey: false }), null)
  // 加了 Shift 就不是这一条：上游 `control UP` 与 `shift PAGE_UP` 是两档键，不许混。
  assert.equal(terminalActionKeyFor({ ...lineUpKey, shiftKey: true }), null)
  assert.equal(terminalActionKeyFor({ ...lineUpKey, altKey: true }), null)
  assert.equal(terminalActionKeyFor({ ...lineUpKey, metaKey: true }), null)
  assert.equal(terminalActionKeyFor({ ...lineUpKey, type: 'keyup' }), null)
  // 翻页那两把仍然只认带 Shift 的 PageUp/Down，两套互不错认。
  assert.equal(terminalActionKeyFor(pageKeyUp), 'pageUp')
})

test('逐行两条与翻页两条共用上游那一道门（备用屏里四条全不启用，只灰不藏）', () => {
  const alternate = build({ alternateBuffer: true })
  for (const id of ['terminal.page.up', 'terminal.page.down', 'terminal.line.up', 'terminal.line.down']) {
    assert.equal(find(alternate, id).enabled, false, `${id} 在备用屏里应当不可用`)
    assert.match(find(alternate, id).reason, /备用屏/)
    assert.equal(find(alternate, id).visible, true, '上游是 isEnabled，不是 isEnabledAndVisible ⇒ 条目还在')
  }
  const none = build({ hasTerminal: false })
  for (const id of ['terminal.line.up', 'terminal.line.down']) {
    assert.equal(find(none, id).visible, false, '没有终端时整条不出现（TerminalBaseContextAction.java:20）')
  }
  assert.equal(terminalActionTitle(find(build(), 'terminal.line.up'), 'x'), '向上滚动一行（Ctrl+↑）')
  assert.equal(terminalActionTitle(find(alternate, 'terminal.line.down'), 'x'),
    '向下滚动一行：这个终端在全屏程序里（备用屏），逐行滚动交回该程序。')
})

test('Ctrl+↑/↓ 归谁：贴底（正在敲命令）交回 shell，滚离底部才接管；备用屏一律不抢', () => {
  // 本仓分不出上游那个「焦点在提示符还是在输出」的区（OSC 133 无产生者），用的代理是视口位置。
  assert.equal(terminalLineScrollKeyApplies(false, true), false, '贴底 = 键归 shell（PSReadLine 的历史检索要留着）')
  assert.equal(terminalLineScrollKeyApplies(false, false), true, '已滚离底部 = 在读输出，键归这两条动作')
  assert.equal(terminalLineScrollKeyApplies(true, false), false, '备用屏里连动作都不启用，更不抢键')
  assert.equal(terminalLineScrollKeyApplies(true, true), false)
  // 两条读数也真是从 buffer 那三格算的，不是恒真/恒假。
  assert.equal(terminalViewportAtBottom({ type: 'normal', viewportY: 0, baseY: 0 }), true)
  assert.equal(terminalViewportAtBottom({ type: 'normal', viewportY: 3, baseY: 40 }), false)
  assert.equal(terminalViewportAtBottom(undefined), true, '没有窗格时按贴底答 = 不抢键')
  assert.equal(terminalAlternateBuffer({ type: 'alternate', viewportY: 0, baseY: 0 }), true)
  assert.equal(terminalAlternateBuffer({ type: 'normal', viewportY: 0, baseY: 0 }), false)
  assert.equal(terminalAlternateBuffer(null), false)
})

test('档位分派照上游那个 when 分支：page 走 scrollPages、line 走 scrollLines，方向原样传', () => {
  const calls = []
  const target = { scrollLines: n => calls.push(['lines', n]), scrollPages: n => calls.push(['pages', n]) }
  terminalScrollBy(target, 'page', -1)
  terminalScrollBy(target, 'page', 1)
  terminalScrollBy(target, 'line', -1)
  terminalScrollBy(target, 'line', 1)
  assert.deepEqual(calls, [['pages', -1], ['pages', 1], ['lines', -1], ['lines', 1]],
    '档位或方向传错就是「向上翻页变成向下」这种用户一眼看得见的错')
})

test('把焦点切回编辑器：默认（上游那格没勾）不启用，并把「为什么」说清楚', () => {
  const focus = find(build(), 'terminal.focus.editor')
  assert.ok(focus, '这条登记在册')
  assert.equal(focus.hidden, true, '上游这条**没有菜单条目**（frontend.xml:256-274 里没有它）⇒ 隐藏动作')
  assert.deepEqual(focus.keyStrokes, ['Escape'], 'Esc 是上游那条设置给的唯一预设（TerminalOptionsConfigurable.kt:869-872）')
  assert.equal(focus.enabled, false, '上游默认无键 ⇒ 本仓默认也不可用')
  assert.match(focus.reason, /默认没有键/)
  assert.equal(terminalActionTitle(focus, 'x'),
    '把焦点切回编辑器：上游这条默认没有键：要在设置里勾「Move focus to the Editor with: Escape」才交得出焦点。')
  // 隐藏 + 无键位会被登记规则直接丢掉（TerminalActionUtil.java:36-40）⇒ 反向证明这条能存在靠的就是那把 Esc。
  const stripped = build({}, [{ ...TERMINAL_ACTIONS.find(a => a.id === 'terminal.focus.editor'), keyStrokes: [] }])
  assert.equal(terminalAction(stripped, 'terminal.focus.editor'), undefined)
})

test('把焦点切回编辑器：设置开了且有可见编辑器才可用；没有可交接的编辑器照样不可用', () => {
  assert.equal(find(build({ moveFocusToEditorWithEscape: true }), 'terminal.focus.editor').enabled, true)
  const noEditor = build({ moveFocusToEditorWithEscape: true, editorVisible: false })
  assert.equal(find(noEditor, 'terminal.focus.editor').enabled, false)
  assert.match(find(noEditor, 'terminal.focus.editor').reason, /没有可见的编辑器/)
  // 上游的启用门是 isReworkedTerminalEditor（输出区 || 备用屏，比滚动那四条宽一档）⇒ 备用屏里这条照样启用。
  assert.equal(find(build({ moveFocusToEditorWithEscape: true, alternateBuffer: true }), 'terminal.focus.editor').enabled, true)
  // 没有终端时整条不出现（scope = context 对应上游 update() 的 isEnabledAndVisible）。
  assert.equal(find(build({ hasTerminal: false, moveFocusToEditorWithEscape: true }), 'terminal.focus.editor').visible, false)
})

test('Esc 这把键当下归谁：设置没开就不进这张表，带任何修饰的 Escape 也不算', () => {
  assert.equal(terminalActionKeyFor(escapeKey), null, '缺省（没传 options）= 上游默认无键 ⇒ 交回 shell')
  assert.equal(terminalActionKeyFor(escapeKey, { moveFocusToEditorWithEscape: false }), null)
  assert.equal(terminalActionKeyFor(escapeKey, { moveFocusToEditorWithEscape: true }), 'focusEditor')
  assert.equal(terminalActionKeyFor({ ...escapeKey, ctrlKey: true }, { moveFocusToEditorWithEscape: true }), null)
  assert.equal(terminalActionKeyFor({ ...escapeKey, shiftKey: true }, { moveFocusToEditorWithEscape: true }), null)
  assert.equal(terminalActionKeyFor({ ...escapeKey, type: 'keyup' }, { moveFocusToEditorWithEscape: true }), null)
})

test('接线：面板真按这两条逐行滚、真把焦点交出去，而且**没有**给 SwitchFocusToEditor 摆菜单条目', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /if \(actionKey === 'lineUp' \|\| actionKey === 'lineDown'\)/, '面板有逐行那一路')
  assert.match(panel, /if \(!terminalLineScrollKeyApplies\(isAlternateScreen\(pane\), !terminalViewportAtBottom\(pane\.instance\.buffer\.active\)\)\) return true/,
    '贴底/备用屏时 return true 把键交回 shell')
  assert.match(panel, /terminalScrollBy\(pane\.instance, 'line', actionKey === 'lineUp' \? -1 : 1\)/, '键盘那一路滚一行')
  assert.match(panel, /if \(actionKey === 'focusEditor'\) return focusActiveEditor\(\) \? false : true/,
    'Esc 那一路：真的把焦点交出去了才吃键，否则原样给 shell')
  assert.match(panel, /moveFocusToEditorWithEscape: moveFocusWithEscape\.value/, '上下文那一格真按设置算，不是写死')
  assert.match(panel, /settings\?\.moveFocusToEditorWithEscape \?\? false/, '缺省 false = 上游默认无键那一档')
  assert.match(panel, /editorVisible: hasVisibleEditor\(\)/, '「有没有可见编辑器」是真读数')
  assert.match(panel, /pickEditorToFocus\(editorFocusCandidates\(\)\)\?\.offsetParent/, '用的就是 src/editorFocus.ts 那组选择器')
  const pageDownAt = panel.indexOf('@click="scrollPage(1)"')
  const lineUpAt = panel.indexOf('@click="scrollLine(-1)"')
  const lineDownAt = panel.indexOf('@click="scrollLine(1)"')
  assert.ok(pageDownAt > 0 && lineUpAt > pageDownAt && lineDownAt > lineUpAt,
    '菜单顺序 = PageDown →（上游的分隔符）→ LineUp → LineDown（frontend.xml:268-271）')
  assert.equal(panel.indexOf('terminal.focus.editor'), -1,
    '上游这条没有菜单条目 ⇒ 本仓也不摆（菜单里不该出现「把焦点切回编辑器」这种假控件）')
})

