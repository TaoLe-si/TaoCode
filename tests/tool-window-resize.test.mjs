import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RESIZE_CHARS, anchorIsHorizontal, resizeDirectionEnabled, stretchDelta, stretchSign } from '../src/toolWindowResize.ts'

// ToolWindowAnchor.java:49-51 — only TOP and BOTTOM are horizontal anchors, so the pair of resize
// actions that literally "stretches width" is the one for the side docks.
test('only top and bottom anchors are horizontal', () => {
  assert.equal(anchorIsHorizontal('top'), true)
  assert.equal(anchorIsHorizontal('bottom'), true)
  assert.equal(anchorIsHorizontal('left'), false)
  assert.equal(anchorIsHorizontal('right'), false)
})

// ResizeToolWindowAction.Left/Right.update (:127-131, :144-148) and Up/Down.update
// (:161-165, :178-182) enable a pair per axis and nothing else.
test('each anchor enables exactly one pair of directions', () => {
  const expected = {
    left: ['left', 'right'],
    right: ['left', 'right'],
    top: ['up', 'down'],
    bottom: ['up', 'down'],
  }
  for (const [anchor, enabled] of Object.entries(expected))
    for (const direction of ['left', 'right', 'up', 'down'])
      assert.equal(resizeDirectionEnabled(anchor, direction), enabled.includes(direction),
        `${anchor} / ${direction} should be ${enabled.includes(direction) ? 'enabled' : 'disabled'}`)
})

// `stretch` (:107-121) squared with the four subclasses' isIncrementAction flags. The arrow names
// the direction the divider travels, so a left-docked window shrinks on "Left" and a right-docked
// one grows on it — the mirror image, which is the part a hand-written port gets wrong.
test('the divider travels in the direction the action names', () => {
  const leftDock = { left: -1, right: 1 }
  const rightDock = { left: 1, right: -1 }
  const bottomDock = { up: 1, down: -1 }
  const topDock = { up: -1, down: 1 }
  for (const [direction, sign] of Object.entries(leftDock))
    assert.equal(stretchSign('left', direction), sign, `left dock / ${direction}`)
  for (const [direction, sign] of Object.entries(rightDock))
    assert.equal(stretchSign('right', direction), sign, `right dock / ${direction}`)
  for (const [direction, sign] of Object.entries(bottomDock))
    assert.equal(stretchSign('bottom', direction), sign, `bottom dock / ${direction}`)
  for (const [direction, sign] of Object.entries(topDock))
    assert.equal(stretchSign('top', direction), sign, `top dock / ${direction}`)
})

// `stretch` only acts when the direction's axis matches the anchor (:110, :114): the mismatched
// pairs return early instead of stretching the wrong dimension.
test('a direction on the wrong axis is not a resize at all', () => {
  assert.equal(stretchSign('left', 'up'), 0)
  assert.equal(stretchSign('left', 'down'), 0)
  assert.equal(stretchSign('bottom', 'left'), 0)
  assert.equal(stretchSign('bottom', 'right'), 0)
  assert.equal(stretchDelta('left', 'up', 35), 0)
})

// The step itself: registry chars (5) times the measured UI-font metric, so the caller's
// measurement is all that varies.
test('the delta is the signed step', () => {
  assert.equal(RESIZE_CHARS, 5)
  assert.equal(stretchDelta('left', 'right', 35), 35)
  assert.equal(stretchDelta('left', 'left', 35), -35)
  assert.equal(stretchDelta('bottom', 'up', 90), 90)
  assert.equal(stretchDelta('bottom', 'down', 90), -90)
})

// Hiding every tool window must take the resize actions with it: `update` bails out when the
// window is invisible or the anchor axis does not match the focused dock (`:52-80`).
test('the resize rows are wired to the focused dock and to the real panel sizes', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  const lines = app.split('\n')
  const ids = ['window.resizeToolWindowLeft', 'window.resizeToolWindowRight', 'window.resizeToolWindowUp', 'window.resizeToolWindowDown']
  const rows = ids.map(id => lines.findIndex(line => line.includes(`id: '${id}'`)))
  for (const [index, id] of ids.entries()) assert.ok(rows[index] >= 0, `the Window menu has no ${id} row`)
  assert.deepEqual(rows, [...rows].sort((a, b) => a - b), 'the four rows are out of order')

  // The keys are `$default.xml:873-884`.
  const keys = ['Ctrl Alt Shift ArrowLeft', 'Ctrl Alt Shift ArrowRight', 'Ctrl Alt Shift ArrowUp', 'Ctrl Alt Shift ArrowDown']
  for (const [index, key] of keys.entries())
    assert.ok(lines[rows[index]].includes(`keys: '${key}'`), `${ids[index]} shows the wrong shortcut`)

  // The action must resolve the active tool window the way the rest of the menu does, and the
  // panel it resizes has to be the one `setPanelSize` owns. `activeToolWindowDock()` (not the raw
  // focus test) is what keeps the row usable while the Window menu itself holds the focus.
  assert.ok(app.includes('function resizeTarget()'), 'the active tool window is not resolved for a resize')
  assert.ok(/function resizeTarget\(\)[\s\S]{0,220}activeToolWindowDock\(\)/.test(app), 'the resize does not resolve the active tool window')
  assert.ok(app.includes('function stretchToolWindow('), 'the resize action is missing')
  assert.ok(/setPanelSize\(target\.panel, .*stretchDelta\(/.test(app), 'the resize does not go through setPanelSize')
  assert.ok(app.includes('RESIZE_CHARS'), 'the registry step is not used')
})

// Ctrl+Alt+Shift+Arrow is a superset of Back/Forward's Ctrl+Alt+Arrow, so those two branches have
// to exclude Shift — the same shadowing bug the F12 fix addressed.
test('Back and Forward do not swallow the resize chords', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  const lines = app.split('\n')
  const resize = lines.findIndex(line => line.includes('function onKey(event: KeyboardEvent)'))
  assert.ok(resize >= 0, 'the window-level handler moved')
  for (const [key, action] of [['ArrowLeft', 'goBack'], ['ArrowRight', 'goForward']]) {
    const back = lines.findIndex((line, index) => index > resize
      && line.includes('event.ctrlKey && event.altKey')
      && line.includes(`event.key === '${key}'`)
      && line.includes(action))
    assert.ok(back > resize, `the Back/Forward branch for ${key} moved`)
    assert.ok(lines[back].includes('!event.shiftKey'),
      `Back/Forward for ${key} must exclude Shift, or Ctrl+Alt+Shift+${key} can never reach the resize action`)
  }
})
