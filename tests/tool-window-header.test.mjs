import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAXIMIZE_SHORTCUT_CODE,
  MAXIMIZE_SHORTCUT_LABEL,
  canMaximize,
  headerAction,
  reconcileMaximized,
  toggleMaximized,
} from '../src/toolWindowHeader.ts'

// ToolWindowHeader.kt:212-256 — the gesture order is: popup trigger, close click, activate, dblclick.
test('the context menu never also activates the window', () => {
  assert.equal(headerAction({ kind: 'contextmenu' }), 'menu')
})

test('a plain left click activates the window', () => {
  assert.equal(headerAction({ kind: 'click', button: 0 }), 'activate')
  assert.equal(headerAction({ kind: 'click' }), 'activate')
})

test('a double click maximizes', () => {
  assert.equal(headerAction({ kind: 'dblclick' }), 'maximize')
})

// UIUtil.java:1843-1846 — `BUTTON2 || BUTTON1 && isShiftDown()`.
test('middle click and shift+left click are both close clicks', () => {
  assert.equal(headerAction({ kind: 'aux', button: 1 }), 'hide')
  assert.equal(headerAction({ kind: 'click', button: 0, shiftKey: true }), 'hide')
  assert.equal(headerAction({ kind: 'click', button: 0, shiftKey: false }), 'activate')
})

test('the other mouse buttons are ignored', () => {
  assert.equal(headerAction({ kind: 'click', button: 2 }), null)
  assert.equal(headerAction({ kind: 'aux', button: 2 }), null)
  assert.equal(headerAction({ kind: 'aux', button: 0 }), null)
  assert.equal(headerAction({ kind: 'mousedown' }), null)
})

// MaximizeToolWindowAction.java:36 — `setMaximized(toolWindow, !isMaximized(toolWindow))`.
test('maximizing is a toggle on the same side', () => {
  assert.equal(toggleMaximized(null, 'left'), 'left')
  assert.equal(toggleMaximized('left', 'left'), null)
  assert.equal(toggleMaximized('left', 'right'), 'right')
  assert.equal(toggleMaximized('right', 'right'), null)
})

// ToolWindowPane.kt:544-553 — `stretch` is not undone by another window becoming active.
test('a different active dock ends the stretch', () => {
  assert.equal(reconcileMaximized('left', 'left', true), 'left')
  assert.equal(reconcileMaximized('left', 'right', true), null)
  assert.equal(reconcileMaximized('left', null, true), null)
  assert.equal(reconcileMaximized(null, 'left', true), null)
})

test('hiding the dock ends the stretch', () => {
  assert.equal(reconcileMaximized('right', 'right', false), null)
  assert.equal(reconcileMaximized('right', 'right', true), 'right')
})

// MaximizeToolWindowAction.update:45-63 — no tool window in the context disables the action.
test('without a workspace or a visible dock the action is unavailable', () => {
  assert.equal(canMaximize(true, true), true)
  assert.equal(canMaximize(false, true), false)
  assert.equal(canMaximize(true, false), false)
  assert.equal(canMaximize(false, false), false)
})

// $default.xml:885-887 `control shift QUOTE`; macOS keeps ctrl (macOS System Shortcuts.xml:394-396).
test('the shortcut is the Quote key with Ctrl+Shift on every platform', () => {
  assert.equal(MAXIMIZE_SHORTCUT_CODE, 'Quote')
  assert.equal(MAXIMIZE_SHORTCUT_LABEL, "Ctrl Shift '")
})
