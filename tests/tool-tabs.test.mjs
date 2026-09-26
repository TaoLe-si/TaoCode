import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  CLOSEABLE_TOOL_TABS,
  canCloseAllContents,
  canCloseOtherContents,
  canHideAllToolWindows,
  hasVisibleToolWindow,
  hideAllToolWindowsTitle,
  isCloseableToolTab,
  presentCloseableTabs,
  tabsCloseAllWouldRemove,
  tabsCloseOtherWouldRemove,
} from '../src/toolTabs.ts'

const presence = (over = {}) => ({ references: false, hierarchy: false, blame: false, ...over })

// `ContentManagerImpl.canCloseAllContents()` (:472-481): `canCloseContents() && any isCloseable`.
// An empty tool window therefore disables the action instead of firing a no-op.
test('CloseAllTabs is enabled exactly while some closeable content is in the strip', () => {
  assert.equal(canCloseAllContents(presence()), false)
  assert.equal(canCloseAllContents(presence({ references: true })), true)
  assert.equal(canCloseAllContents(presence({ hierarchy: true })), true)
  assert.equal(canCloseAllContents(presence({ blame: true })), true)
  assert.equal(canCloseAllContents(presence({ references: true, blame: true })), true)
})

// `ToolWindowCloseOtherTabsAction.update` (:23-26) adds `it !== content`, so a single content the
// action was invoked on is not enough to enable it.
test('CloseOtherTabs needs one closeable content besides the one it was invoked on', () => {
  assert.equal(canCloseOtherContents('references', presence({ references: true })), false)
  assert.equal(canCloseOtherContents('references', presence({ references: true, blame: true })), true)
  // A permanent content (Output, Problems, …) is a legal target: nothing is spared then.
  assert.equal(canCloseOtherContents('output', presence({ references: true })), true)
  assert.equal(canCloseOtherContents('output', presence()), false)
})

// ToolWindowCloseAllTabsAction.kt:11-18 — every closeable content, the selected one included.
test('CloseAllTabs removes the whole closeable set, in strip order', () => {
  assert.deepEqual(tabsCloseAllWouldRemove(presence({ references: true, hierarchy: true, blame: true })), ['references', 'hierarchy', 'blame'])
  assert.deepEqual(tabsCloseAllWouldRemove(presence({ blame: true })), ['blame'])
  assert.deepEqual(tabsCloseAllWouldRemove(presence()), [])
})

// ToolWindowCloseOtherTabsAction.kt:11-19 — same loop with `content !== cur`, so the content the
// action was invoked on survives whatever it is.
test('CloseOtherTabs spares exactly the selected content', () => {
  assert.deepEqual(tabsCloseOtherWouldRemove('hierarchy', presence({ references: true, hierarchy: true, blame: true })), ['references', 'blame'])
  assert.deepEqual(tabsCloseOtherWouldRemove('output', presence({ references: true, hierarchy: true })), ['references', 'hierarchy'])
  // Sparing a content that is not there changes nothing: the whole set goes.
  assert.deepEqual(tabsCloseOtherWouldRemove('references', presence({ hierarchy: true })), ['hierarchy'])
})

// The closeable set is the *subset* of the strip whose contents can go away; the fixed tabs are
// never in it, and `isCloseableToolTab` is the narrowing test the callers use.
test('the closeable set holds only the three removable contents', () => {
  for (const tab of CLOSEABLE_TOOL_TABS) assert.equal(isCloseableToolTab(tab), true)
  for (const tab of ['output', 'run', 'problems', 'terminal', 'about']) assert.equal(isCloseableToolTab(tab), false)
  assert.equal(presentCloseableTabs(presence({ references: true, hierarchy: true, blame: true })).length, 3)
})

// HideAllToolWindowsAction: the row's text is what tells the user which way the toggle goes
// (:41-46, `IdeBundle.properties:384-385`), and a state with neither windows to hide nor a saved
// layout disables it (:36, :48).
test('HideAllWindows flips its text between hide and restore', () => {
  const all = { explorer: true, activity: false, bottom: true }
  const none = { explorer: false, activity: false, bottom: false }
  assert.equal(hasVisibleToolWindow(all), true)
  assert.equal(hasVisibleToolWindow(none), false)

  assert.equal(hideAllToolWindowsTitle(all, null), '隐藏所有工具窗口')
  assert.equal(canHideAllToolWindows(all, null), true)
  // Everything hidden by the action itself: the row offers the way back.
  assert.equal(hideAllToolWindowsTitle(none, all), '恢复窗口')
  assert.equal(canHideAllToolWindows(none, all), true)
  // Nothing hidden *by the action* and nothing on screen: the source leaves the row disabled.
  assert.equal(canHideAllToolWindows(none, null), false)
  assert.equal(hideAllToolWindowsTitle(none, null), '隐藏所有工具窗口')
  // Any single visible dock is enough to hide all.
  for (const dock of ['explorer', 'activity', 'bottom'])
    assert.equal(canHideAllToolWindows({ explorer: false, activity: false, bottom: false, [dock]: true }, null), true)
})

// `CLOSEABLE_TOOL_TABS` claims strip order, and the strip lives in App.vue's `BOTTOM_TABS`. The
// iteration order of the removal loops follows it, so the two are compared mechanically rather
// than by eye.
test('the closeable set is BOTTOM_TABS filtered, in the strip order App.vue declares', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  const line = app.split('\n').find(l => l.includes('const BOTTOM_TABS'))
  assert.ok(line, 'BOTTOM_TABS moved; revisit this assertion')
  const ids = [...line.matchAll(/'([a-z]+)'/g)].map(m => m[1])
  assert.ok(ids.length >= 5, 'BOTTOM_TABS could not be parsed')
  const closeableInStripOrder = ids.filter(id => isCloseableToolTab(id))
  assert.deepEqual([...CLOSEABLE_TOOL_TABS], closeableInStripOrder)
})

// The three WindowMenu rows (`PlatformActions.xml:664-666`), and the native key that must stay off
// CloseAllTabs: it borrows `CloseAllEditors`, which `$default.xml` never binds.
test('the Window menu carries CloseAllTabs right after CloseOtherTabs, without a shortcut', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  const lines = app.split('\n')
  const other = lines.findIndex(l => l.includes("id: 'window.closeOtherTabs'"))
  const all = lines.findIndex(l => l.includes("id: 'window.closeAllTabs'"))
  assert.ok(other >= 0 && all >= 0, 'a Window-menu row is missing')
  assert.ok(all > other, 'CloseAllTabs is not the row right after CloseOtherTabs')
  // Only comments may sit between the two rows (`PlatformActions.xml:666` puts them adjacent).
  for (const line of lines.slice(other + 1, all))
    assert.ok(line.trim().startsWith('//') || line.trim() === '', `CloseAllTabs is not adjacent to CloseOtherTabs: ${line.trim()}`)
  assert.equal(lines[all].includes('keys:'), false, 'CloseAllTabs must not show a shortcut the source does not bind')
  assert.ok(lines[all].includes('closeAllTabsTarget') && lines[all].includes('closeAllToolTabs'), 'the row does not run the action')

  // The reference source tree is not part of this repo, so this half is skipped where it is absent.
  const keymapPath = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master/platform/platform-resources/src/keymaps/$default.xml'
  if (existsSync(keymapPath)) {
    const keymap = readFileSync(keymapPath, 'utf8')
    for (const id of ['CloseAllEditors', 'CloseAllEditorsButActive'])
      assert.equal(keymap.includes(`id="${id}"`), false, `${id} gained a default key: the no-shortcut decision needs revisiting`)
  }
})

// The actions share one content model instead of three copies of the same condition, which is the
// whole reason `src/toolTabs.ts` exists.
test('every tool-tab removal path goes through the shared module', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  for (const call of ['tabsCloseAllWouldRemove(toolTabPresence())', "tabsCloseOtherWouldRemove(bottomTab.value, toolTabPresence())", 'canCloseAllContents(toolTabPresence())', 'canCloseOtherContents(bottomTab.value, toolTabPresence())'])
    assert.ok(app.includes(call), `${call} is missing: a removal path re-implements the condition`)
  assert.equal(/bottomTab\.value !== '(references|hierarchy|blame)'/.test(app), false, 'a hand-rolled per-tab guard is back')
})

// `HideAllToolWindowsAction.kt:14-32` — the toggle snapshots the layout before hiding and clears
// the snapshot when it restores; and the View menu must not carry a second face of the action
// (`PlatformActions.xml:521-597` has no maximize item).
test('HideAllWindows is a single Window-menu row that restores what it hid', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  const lines = app.split('\n')
  const row = lines.filter(l => l.includes("id: 'window.hideAllWindows'"))
  assert.equal(row.length, 1, 'HideAllWindows must have exactly one menu row')
  assert.ok(row[0].includes("keys: 'Ctrl Shift F12'"), 'HideAllWindows lost its Ctrl+Shift+F12 binding')
  assert.ok(row[0].includes('hideAllToolWindowsTitle(currentChrome(), savedChrome.value)'), 'the row no longer flips its text')
  assert.ok(row[0].includes('canHideAllToolWindows(currentChrome(), savedChrome.value)'), 'the row does not use the source enable test')
  assert.equal(app.includes("id: 'view.maximizeEditor'"), false, 'the View menu carries HideAllWindows a second time')

  const save = app.indexOf('savedChrome.value = chrome')
  const clear = app.indexOf('savedChrome.value = null')
  assert.ok(save >= 0 && clear >= 0 && save < clear, 'the toggle no longer snapshots before it restores')
})
