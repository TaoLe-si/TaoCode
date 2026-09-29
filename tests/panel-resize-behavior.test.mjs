import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as vue from 'vue'
import * as appearance from '../src/appearance.ts'
import * as toolWindowResize from '../src/toolWindowResize.ts'

// Run the production host with real Vue reactivity; only resolve its extensionless imports.
const js = ts.transpileModule(readFileSync(new URL('../src/panelResize.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports = {}
new Function('require', 'exports', js)(name => {
  if (name === 'vue') return vue
  if (name === './appearance') return appearance
  if (name === './toolWindowResize') return toolWindowResize
  throw new Error(`Unexpected import: ${name}`)
}, exports)

function environment(t) {
  const values = new Map()
  const bounds = { groups: { width: 800, height: 500 }, column: { width: 800, height: 800 } }
  const globals = {
    window: { innerWidth: 1400, innerHeight: 1000 },
    document: {
      querySelector(selector) {
        if (selector === '.editor-groups') return { getBoundingClientRect: () => bounds.groups }
        if (selector === '.editor-column') return { getBoundingClientRect: () => bounds.column }
        return null
      },
    },
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
  }
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous)
      else delete globalThis[key]
    })
  }
  return { values, bounds }
}

function host(t, { anchor = 'left', orientation = 'horizontal', size = 240, remember = false } = {}) {
  const env = environment(t)
  const deps = {
    editorSettings: vue.ref({ wideScreenSupport: false, rememberSizeForEachToolWindow: remember }),
    panelSizes: vue.reactive({ explorer: 240, trace: 300, output: 180 }),
    activity: vue.ref(false), explorer: vue.ref(true), leftView: vue.ref('files'),
    bottomTab: vue.ref('terminal'), toolAnchors: vue.reactive({ files: anchor, git: 'left', todo: 'bottom' }),
    bottom: vue.ref(true), workspace: vue.ref({ root: 'project' }), zenMode: vue.ref(false),
    resizing: vue.ref(false), splitModel: vue.reactive({ orientation }), splitSize: vue.ref(size),
    activeToolWindowDock: () => 'side',
  }
  deps.activeAnchor = vue.computed(() => deps.toolAnchors[deps.leftView.value])
  deps.splitOrientation = vue.computed(() => deps.splitModel.orientation)
  const scope = vue.effectScope()
  const api = scope.run(() => exports.createPanelResize(deps))
  t.after(() => { api.cancelResize(); scope.stop() })
  return { ...api, deps, ...env }
}

class Separator extends EventTarget {
  captured = new Set()
  focus() {}
  setPointerCapture(id) { this.captured.add(id) }
  hasPointerCapture(id) { return this.captured.has(id) }
  releasePointerCapture(id) { this.captured.delete(id); this.emit('lostpointercapture', { pointerId: id }) }
  emit(type, props = {}) {
    const event = new Event(type, { cancelable: true })
    Object.assign(event, { pointerId: 7, clientX: 400, clientY: 300 }, props)
    this.dispatchEvent(event)
  }
}
function pointer(target, props = {}) {
  return { currentTarget: target, button: 0, pointerId: 7, clientX: 400, clientY: 300, preventDefault() {}, ...props }
}
function key(key, props = {}) {
  return { key, prevented: false, preventDefault() { this.prevented = true }, ...props }
}

for (const [anchor, movement, expected] of [['left', 30, 270], ['right', -30, 270], ['right', 30, 210]]) {
  test(`${anchor} explorer drag by ${movement}px follows its dock edge`, t => {
    const h = host(t, { anchor })
    const target = new Separator()
    h.startResize(pointer(target), 'explorer')
    target.emit('pointermove', { clientX: 400 + movement })
    assert.equal(h.deps.panelSizes.explorer, expected)
    target.emit('pointerup')
    assert.equal(h.deps.resizing.value, false)
  })
}

for (const [anchor, arrow, expected] of [
  ['left', 'ArrowLeft', 224], ['left', 'ArrowRight', 256],
  ['right', 'ArrowLeft', 256], ['right', 'ArrowRight', 224],
]) {
  test(`${anchor} explorer separator ${arrow} moves the divider in the named direction`, t => {
    const h = host(t, { anchor })
    const event = key(arrow)
    h.resizeKey(event, 'explorer')
    assert.equal(h.deps.panelSizes.explorer, expected)
    assert.equal(event.prevented, true)
  })
}

test('bottom and trace dividers retain their grow-left/up direction', t => {
  const h = host(t)
  h.resizeKey(key('ArrowUp'), 'output')
  h.resizeKey(key('ArrowLeft'), 'trace')
  assert.equal(h.deps.panelSizes.output, 196)
  assert.equal(h.deps.panelSizes.trace, 316)
  const target = new Separator()
  h.startResize(pointer(target), 'output')
  target.emit('pointermove', { clientY: 270 })
  assert.equal(h.deps.panelSizes.output, 226)
})

test('split measurement and clamping exclude the bottom dock from the editor groups', t => {
  const h = host(t, { orientation: 'vertical' })
  assert.equal(h.editorStageSize('x'), 800)
  assert.equal(h.editorStageSize('y'), 500)
  h.setSplitSize(600)
  assert.equal(h.deps.splitSize.value, 300)
  h.bounds.groups.height = 450
  h.onWindowResize()
  assert.equal(h.deps.splitSize.value, 250)
})

for (const [orientation, coordinate, origin] of [['horizontal', 'clientX', 400], ['vertical', 'clientY', 300]]) {
  test(`${orientation} divider drag grows the right/bottom secondary pane when moving left/up`, t => {
    const h = host(t, { orientation })
    const target = new Separator()
    h.startSplitResize(pointer(target))
    target.emit('pointermove', { [coordinate]: origin - 30, pointerId: 99 })
    assert.equal(h.deps.splitSize.value, 240, 'another pointer cannot resize this pane')
    target.emit('pointermove', { [coordinate]: origin - 30 })
    assert.equal(h.deps.splitSize.value, 270)
    target.emit('pointermove', { [coordinate]: origin + 30 })
    assert.equal(h.deps.splitSize.value, 210)
  })
}

for (const [orientation, grow, shrink] of [['horizontal', 'ArrowLeft', 'ArrowRight'], ['vertical', 'ArrowUp', 'ArrowDown']]) {
  test(`${orientation} split separator arrows grow and shrink the secondary pane`, t => {
    const h = host(t, { orientation })
    h.resizeSplitKey(key(grow))
    assert.equal(h.deps.splitSize.value, 256)
    h.resizeSplitKey(key(shrink))
    assert.equal(h.deps.splitSize.value, 240)
  })
}

test('the first split resize initializes the secondary size from half the editor groups', t => {
  const h = host(t, { orientation: 'vertical', size: 0 })
  const target = new Separator()
  h.startSplitResize(pointer(target))
  assert.equal(h.deps.splitSize.value, 250)
  h.cancelResize()
  h.deps.splitSize.value = 0
  h.resizeSplitKey(key('ArrowUp'))
  assert.equal(h.deps.splitSize.value, 266)
})

for (const stop of ['pointerup', 'pointercancel', 'lostpointercapture', 'cancelResize']) {
  test(`${stop} removes split dragging listeners so later pointer moves cannot resize`, t => {
    const h = host(t)
    const target = new Separator()
    h.startSplitResize(pointer(target))
    if (stop === 'cancelResize') h.cancelResize()
    else target.emit(stop)
    assert.equal(h.deps.resizing.value, false)
    assert.equal(target.hasPointerCapture(7), false)
    target.emit('pointermove', { clientX: 450 })
    assert.equal(h.deps.splitSize.value, 240)
    // A stale stop listener on an old separator must not terminate the next drag.
    const next = new Separator()
    h.startSplitResize(pointer(next))
    target.emit('pointerup')
    assert.equal(h.deps.resizing.value, true)
  })
}

test('starting another resize cancels the old split drag and detaches its move listener', t => {
  const h = host(t)
  const old = new Separator()
  h.startSplitResize(pointer(old))
  const next = new Separator()
  h.startResize(pointer(next), 'explorer')
  old.emit('pointermove', { clientX: 460 })
  assert.equal(h.deps.splitSize.value, 240)
  assert.equal(old.hasPointerCapture(7), false)
  assert.equal(h.deps.resizing.value, true)
  next.emit('pointermove', { clientX: 420 })
  assert.equal(h.deps.panelSizes.explorer, 260)
})

test('modified arrow chords are left to window-level shortcuts', t => {
  const h = host(t, { anchor: 'right' })
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
    const event = key('ArrowLeft', { [modifier]: true })
    h.resizeKey(event, 'explorer')
    h.resizeSplitKey(event)
    assert.equal(event.prevented, false)
  }
  assert.equal(h.deps.panelSizes.explorer, 240)
  assert.equal(h.deps.splitSize.value, 240)
})

test('remembered bottom size is stored for bottomTab, independently of the side window', t => {
  const h = host(t, { remember: true })
  h.setPanelSize('output', 230)
  h.setPanelSize('explorer', 310)
  assert.deepEqual(JSON.parse(h.values.get('taocode.toolSizes')), { 'terminal:bottom': 230, 'files:side': 310 })
  assert.equal(h.toolSizes['files:bottom'], undefined)
})

test('changing bottomTab restores its own remembered height without changing the side width', async t => {
  const h = host(t, { remember: true })
  h.toolSizes['todo:bottom'] = 280
  h.toolSizes['output:bottom'] = 210
  h.deps.bottomTab.value = 'todo'
  await vue.nextTick()
  assert.equal(h.deps.panelSizes.output, 280)
  assert.equal(h.deps.panelSizes.explorer, 240)
  h.deps.bottomTab.value = 'output'
  await vue.nextTick()
  assert.equal(h.deps.panelSizes.output, 210)
})

test('changing the side view cannot restore an unrelated bottom height', async t => {
  const h = host(t, { remember: true })
  h.toolSizes['todo:bottom'] = 300
  h.toolSizes['git:side'] = 320
  h.deps.leftView.value = 'todo'
  await vue.nextTick()
  assert.equal(h.deps.panelSizes.output, 180, 'terminal remains selected in the bottom dock')
  h.deps.leftView.value = 'git'
  await vue.nextTick()
  assert.equal(h.deps.panelSizes.explorer, 320)
})

test('remember-size disabled neither records nor restores per-window dimensions', async t => {
  const h = host(t)
  h.toolSizes['todo:bottom'] = 280
  h.toolSizes['git:side'] = 320
  h.setPanelSize('output', 220)
  h.deps.bottomTab.value = 'todo'
  h.deps.leftView.value = 'git'
  await vue.nextTick()
  assert.equal(h.deps.panelSizes.output, 220)
  assert.equal(h.deps.panelSizes.explorer, 240)
  assert.equal(h.values.has('taocode.toolSizes'), false)
})
