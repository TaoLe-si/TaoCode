import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shellSource } from './shell-source.mjs'
import { lastActiveId, nextContentIndex, pushActive, removeActive } from '../src/activeToolWindow.ts'

const always = () => true

// ActiveStack.push (:64-68) — remove(id, true) then push, so the newest activation is the last
// element (peekPersistent(0) === stack.get(size - 1), :78-80).
test('activating a tool window puts it on top and never duplicates it', () => {
  let stack = []
  stack = pushActive(stack, 'files')
  stack = pushActive(stack, 'terminal')
  assert.deepEqual(stack, ['files', 'terminal'])
  // Re-activating the older one moves it to the top instead of appending a copy.
  stack = pushActive(stack, 'files')
  assert.deepEqual(stack, ['terminal', 'files'])
  // The top of the stack is the newest activation.
  assert.equal(lastActiveId(stack, always), 'files')
})

test('pushing does not mutate the array it was given', () => {
  const original = ['files']
  const next = pushActive(original, 'git')
  assert.deepEqual(original, ['files'])
  assert.deepEqual(next, ['files', 'git'])
})

// setHiddenState (:711-718) calls remove(entry, false): hiding touches the short stack only, so
// the recorded "last focused" window survives a close and F12 is able to reopen it.
test('hiding a window leaves the persistent stack alone', () => {
  const stack = pushActive(pushActive([], 'files'), 'terminal')
  assert.deepEqual(stack, ['files', 'terminal'])
  // Nothing to call here: the port performs no removal on hide, which is the assertion.
  assert.equal(lastActiveId(stack, always), 'terminal')
})

// :1217 — unregistering is the one path that takes a window out of the persistent stack.
test('removing keeps the order of the survivors', () => {
  assert.deepEqual(removeActive(['files', 'git', 'terminal'], 'git'), ['files', 'terminal'])
  assert.deepEqual(removeActive(['files'], 'git'), ['files'])
  assert.deepEqual(removeActive([], 'git'), [])
})

// :746-753 — the first *available* id walking down from the top, not simply the top id.
test('the jump target is the top-most available window', () => {
  const stack = ['files', 'git', 'terminal']
  assert.equal(lastActiveId(stack, always), 'terminal')
  // The terminal was unregistered/unavailable: fall through to the next one down.
  assert.equal(lastActiveId(stack, id => id !== 'terminal'), 'git')
  assert.equal(lastActiveId(stack, id => id === 'files'), 'files')
})

// JumpToLastWindowAction.java:32-44 — with nothing available the action is disabled, so the
// caller must be able to tell "no target" from "target".
test('an empty or entirely unavailable stack has no target', () => {
  assert.equal(lastActiveId([], always), undefined)
  assert.equal(lastActiveId(['files', 'git'], () => false), undefined)
})

// The order the editor's own activations produce: enter the editor (persistent stack untouched),
// come back with F12 -> the window that was focused before, not "files".
test('F12 returns to the window focused before the editor was used', () => {
  let stack = []
  stack = pushActive(stack, 'files')
  stack = pushActive(stack, 'search')
  stack = pushActive(stack, 'terminal')
  // Editor has focus now; nothing is pushed or cleared by that (:36-38 only clears the short stack).
  assert.equal(lastActiveId(stack, always), 'terminal')
  // F12 activates it, and focusing it pushes it to the top again (updateToolWindow :679).
  stack = pushActive(stack, 'terminal')
  assert.deepEqual(stack, ['files', 'search', 'terminal'])
})

// The three F12 shortcuts, checked against the source so they cannot drift apart again. This is
// the bug the earlier audit found: `$default.xml:846-848` makes bare F12 JumpToLastWindow, while
// the handler sent F12 into FileStructure ($default.xml:279-281) and that branch swallowed
// Ctrl+Shift+F12 (HideAllWindows, :870-872) because it never looked at Shift.
test('F12 is JumpToLastWindow, Ctrl+F12 is FileStructure, Ctrl+Shift+F12 is HideAllWindows', () => {
  // 快捷键分派在 2026-09-27 从 App.vue 拆到 src/keymap.ts，所以这里读整个外壳（App.vue + 各模块）；
  // 三条绑定仍在同一个函数体内，相对顺序不变，`bare < bail` 的断言依然成立。
  const app = shellSource()
  const lines = app.split('\n')
  const find = (...checks) => lines.findIndex(line => checks.every(check => line.includes(check)))

  const bare = find("event.key === 'F12'", 'jumpToLastToolWindow()')
  assert.ok(bare >= 0, 'bare F12 does not run jumpToLastToolWindow')
  // The handler bails out early when neither Ctrl nor Alt is held, so the branch above it has to
  // come first — otherwise bare F12 is silently dropped again.
  const bail = lines.findIndex(line => line.includes('if (!(event.ctrlKey || event.metaKey) && !event.altKey) return'))
  assert.ok(bail >= 0, 'the modifier bail-out moved; revisit this assertion')
  assert.ok(bare < bail, 'bare F12 sits below the modifier bail-out and can never fire')

  const hide = find("event.key === 'F12'", 'toggleMaximizeEditor()')
  const structure = find("event.key === 'F12'", "openSymbol('file')")
  assert.ok(hide >= 0, 'Ctrl+Shift+F12 no longer runs HideAllWindows/toggleMaximizeEditor')
  assert.ok(structure >= 0, 'Ctrl+F12 no longer opens FileStructure')
  assert.ok(hide < structure, 'Ctrl+Shift+F12 is swallowed by the Ctrl+F12 branch again')
  assert.ok(lines[structure].includes('!event.shiftKey'), 'the FileStructure branch must exclude Shift')

  // WindowMenu › ActiveToolwindowGroup (PlatformActions.xml:653-660).
  const row = lines.find(line => line.includes("id: 'window.jumpToLastWindow'"))
  assert.ok(row, 'the Window menu has no 「跳到上一个工具窗口」 row')
  assert.ok(row.includes("keys: 'F12'"), 'the row shows the wrong shortcut')
  assert.ok(row.includes('jumpToLastToolWindow'), 'the row does not run the action')
})

// Every path that brings a tool window forward must record it, or F12 goes back to the wrong
// window. `showView`/`showOutput` are the two shared helpers; nothing may set `leftView` or
// `bottomTab` directly on an activation path.
test('the activation paths are recorded through the shared helpers', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  for (const call of ['recordActiveToolWindow(view)', 'recordActiveToolWindow(tab)'])
    assert.ok(app.includes(call), `${call} is missing: an activation would not be recorded`)
  // The bottom tab buttons and the status-bar Problems widget go through showOutput.
  assert.equal(/@click="bottomTab = '/.test(app), false, 'a tab button sets bottomTab directly instead of calling showOutput')
})

// ContentManagerImpl.selectNextContent / selectPreviousContent (621-646): pure arithmetic on the
// content count and the current index, both wrapping.
test('selecting the next and previous content wraps around the tab strip', () => {
  assert.equal(nextContentIndex(3, 0, 1), 1)
  assert.equal(nextContentIndex(3, 1, 1), 2)
  assert.equal(nextContentIndex(3, 2, 1), 0)   // last -> first
  assert.equal(nextContentIndex(3, 0, -1), 2)  // first -> last
  assert.equal(nextContentIndex(3, 2, -1), 1)
})

// :624-626 — `index = selectedContent == null ? -1 : ...`, so "nothing selected" is index -1. The
// previous branch then computes (-1 - 1 + count) % count = count - 2, *not* the last tab; that
// asymmetry is the source's, and pinning it here keeps a later "cleanup" from silently changing it.
test('nothing selected starts from the first tab going forward and from count - 2 going back', () => {
  assert.equal(nextContentIndex(4, undefined, 1), 0)
  assert.equal(nextContentIndex(4, undefined, -1), 2)
  assert.equal(nextContentIndex(3, -1, 1), 0)
  assert.equal(nextContentIndex(3, -1, -1), 1)
})

// :623 — the source asserts contentCount > 1 and bails out when the content is null.
test('a single tab is not navigable', () => {
  assert.equal(nextContentIndex(0, undefined, 1), undefined)
  assert.equal(nextContentIndex(1, 0, 1), undefined)
  assert.equal(nextContentIndex(1, 0, -1), undefined)
})

test('a stale index outside the strip is treated as nothing selected', () => {
  assert.equal(nextContentIndex(3, 5, 1), 0)
  assert.equal(nextContentIndex(3, 5, -1), 1)
})

// The rest of WindowMenu > ActiveToolwindowGroup (PlatformActions.xml:653-660): the three narrower
// hides, the tab rows, and CloseActiveTab on the key the source gives it.
test('the remaining ActiveToolwindowGroup actions are wired', () => {
  // 菜单行现在在 src/menus/*.ts 里，所以看整个外壳（App.vue 仍在最前）。
  const app = shellSource()
  const lines = app.split('\n')
  const find = (...checks) => lines.findIndex(line => checks.every(check => line.includes(check)))

  // HideActiveWindow is Shift+Esc (:867-869) and must be handled before the generic Escape branch.
  // The handler wraps onto a second line, so the call is matched on its own line.
  const hide = find("event.key === 'Escape'", "event.shiftKey")
  assert.ok(hide >= 0, 'Shift+Esc is not handled at all')
  assert.ok(lines[hide].includes('hideActiveToolWindow()') || lines[hide + 1].includes('hideActiveToolWindow(); return }'),
    'Shift+Esc does not hide the active tool window')
  // The window-level handler is one function; earlier Escape handlers elsewhere must not be
  // mistaken for its own generic branch.
  const onKey = lines.findIndex(line => line.includes('function onKey(event: KeyboardEvent)'))
  assert.ok(onKey >= 0, 'the window-level handler moved')
  const esc = lines.findIndex((line, index) => index > onKey && line.includes("if (event.key === 'Escape') {"))
  assert.ok(esc > onKey && hide > onKey && hide < esc, 'Shift+Esc is below the generic Escape branch and can never fire')

  // NextTab / PreviousTab are Alt+Right / Alt+Left (:309-311, :717-719).
  assert.ok(find("event.key === 'ArrowRight'", 'selectNextTab()') >= 0, 'Alt+Right is not bound to NextTab')
  assert.ok(find("event.key === 'ArrowLeft'", 'selectPreviousTab()') >= 0, 'Alt+Left is not bound to PreviousTab')

  // Ctrl+Shift+F4 is CloseActiveTab (:260-262), and the reopen action it used to steal it from has
  // no binding in the Windows default keymap at all.
  assert.ok(find("event.key === 'F4'", 'closeActiveTab()') >= 0, 'Ctrl+Shift+F4 does not close the active tab')
  const reopen = lines.find(line => line.includes("id: 'file.reopenClosedTab'"))
  assert.ok(reopen && !reopen.includes('Ctrl Shift F4'), 'ReopenClosedTab still borrows Ctrl+Shift+F4')

  for (const [id, keys] of [['window.hideActiveWindow', 'Shift Esc'], ['window.nextTab', 'Alt Right'], ['window.previousTab', 'Alt Left'], ['window.closeActiveTab', 'Ctrl Shift F4']]) {
    const row = lines.find(line => line.includes(`id: '${id}'`))
    assert.ok(row, `the Window menu has no ${id} row`)
    assert.ok(row.includes(`keys: '${keys}'`), `${id} shows the wrong shortcut`)
  }
  for (const id of ['window.hideSideWindows', 'window.hideBottomWindows', 'window.closeOtherTabs', 'window.closeAllTabs'])
    assert.ok(app.includes(`id: '${id}'`), `the Window menu has no ${id} row`)
  // CloseOtherTabs keeps the active tab and clears only the closeable ones
  // (ToolWindowCloseOtherTabsAction.kt:11-19). The condition itself now lives in `src/toolTabs.ts`
  // and is unit-tested there; what is asserted here is that this call site did not go back to a
  // hand-rolled per-tab guard that would drift from it.
  const other = app.slice(app.indexOf('function closeOtherToolTabs'), app.indexOf('function closeAllToolTabs'))
  assert.ok(other.includes('tabsCloseOtherWouldRemove(ctx.bottomTab.value, toolTabPresence())'),
    'closeOtherToolTabs no longer spares the selected tab through the shared content model')
  assert.equal(/bottomTab\.value !== '(references|hierarchy)',/.test(other), false,
    'a hand-rolled per-tab guard is back in closeOtherToolTabs')

  // CodeMirror binds Alt+Left/Right to syntax-wise caret motion; the tab pair would fight it.
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  for (const key of ['Alt-ArrowLeft', 'Alt-ArrowRight'])
    assert.ok(editor.includes(`{ key: '${key}', preventDefault: true, run: () => true }`), `${key} is not shadowed in the editor`)
})
