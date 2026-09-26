import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVATION_KEYS,
  focusableWidgets,
  navigateWidget,
  resolveRestoreTarget,
  shouldFocusFirstWidget,
} from '../src/statusBarNav.ts'

// IdeStatusBarImpl.kt:874-880,901-902
test('only shown and enabled widgets enter the focus cycle', () => {
  const widgets = [
    { id: 'file', hidden: false, disabled: false },
    { id: 'branch', hidden: false, disabled: true },
    { id: 'position', hidden: true, disabled: false },
    { id: 'encoding', hidden: false, disabled: false },
  ]
  assert.deepEqual(focusableWidgets(widgets).map(w => w.id), ['file', 'encoding'])
})

test('the widget order is the visual left-to-right order', () => {
  const widgets = ['left', 'progress', 'right'].map(id => ({ id, hidden: false, disabled: false }))
  assert.deepEqual(focusableWidgets(widgets).map(w => w.id), ['left', 'progress', 'right'])
})

// IdeStatusBarImpl.kt:952-962 — after the last widget comes the first, before the first the last.
test('navigation wraps around in both directions', () => {
  assert.equal(navigateWidget(0, 3, 'next'), 1)
  assert.equal(navigateWidget(2, 3, 'next'), 0)
  assert.equal(navigateWidget(0, 3, 'previous'), 2)
  assert.equal(navigateWidget(1, 3, 'previous'), 0)
})

test('a single widget keeps the focus on itself', () => {
  assert.equal(navigateWidget(0, 1, 'next'), 0)
  assert.equal(navigateWidget(0, 1, 'previous'), 0)
})

test('an empty status bar has nothing to focus', () => {
  assert.equal(navigateWidget(0, 0, 'next'), -1)
  assert.equal(navigateWidget(0, 0, 'previous'), -1)
})

// The status bar can be entered without a widget being current (focus on the bar itself).
test('entering with no current widget picks the end the direction asks for', () => {
  assert.equal(navigateWidget(-1, 4, 'next'), 0)
  assert.equal(navigateWidget(-1, 4, 'previous'), 3)
})

// FocusStatusBarAction.kt:10-21 -> IdeStatusBarImpl.kt:863-872
test('the focus action never walks out of the status bar', () => {
  assert.equal(shouldFocusFirstWidget(true, 5), false)
  assert.equal(shouldFocusFirstWidget(false, 5), true)
  assert.equal(shouldFocusFirstWidget(false, 0), false)
})

// IdeStatusBarImpl.kt:579-596
test('a stale saved focus falls back to the editor', () => {
  assert.equal(resolveRestoreTarget(true, true), 'previous')
  assert.equal(resolveRestoreTarget(true, false), 'editor')
  assert.equal(resolveRestoreTarget(false, true), 'editor')
  assert.equal(resolveRestoreTarget(false, false), 'editor')
})

// IdeStatusBarImpl.kt:566,573-576 — the guard matches what a plain <button> already does.
test('space and enter both activate the focused widget', () => {
  assert.deepEqual([...ACTIVATION_KEYS], ['Space', 'Enter'])
})
