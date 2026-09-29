import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as vue from 'vue'
import * as layoutModel from '../src/toolLayout.ts'
import * as metadata from '../src/toolWindowMeta.ts'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'

// Follow scope-persistence.test.mjs: execute the host with real Vue and production dependencies.
// Transpilation resolves the host's extensionless import without mocking its behavior.
const js = ts.transpileModule(readFileSync(new URL('../src/toolLayouts.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports = {}
new Function('require', 'exports', js)(name => {
  if (name === 'vue') return vue
  if (name === './toolWindowMeta.ts') return metadata
  if (name === './toolLayout' || name === './toolLayout.ts') return layoutModel
  throw new Error(`Unexpected import: ${name}`)
}, exports)

function storage(t) {
  const values = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  } })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  })
  return values
}

function host() {
  const explorer = vue.ref(false)
  const leftView = vue.ref('files')
  const stripes = createToolWindowStripes({
    isDesktop: true, workspace: vue.ref({ root: 'project' }), lspReady: vue.ref(true),
    gradleAvailable: vue.ref(true), explorer, activeView: leftView,
  })
  const sizesSet = []
  const deps = {
    notify() {}, menu: vue.ref(null), nameDialog: vue.ref(null), nameInput: vue.ref(null),
    explorer, bottom: vue.ref(false), leftView, bottomTab: vue.ref('output'),
    panelSizes: vue.reactive({ explorer: 240, trace: 300, output: 180 }),
    ...stripes,
    isLeftToolWindowId: id => Object.hasOwn(stripes.toolAnchors, id),
    setPanelSize(panel, value) { sizesSet.push([panel, value]); deps.panelSizes[panel] = value },
  }
  return { ...exports.createToolLayouts(deps), ...stripes, deps, sizesSet }
}

const custom = () => ({
  explorer: false, bottom: true, view: 'gradle', tab: 'notifications',
  anchors: {
    files: 'right', git: 'left', search: 'left', outline: 'left', bookmarks: 'left',
    vcslog: 'bottom', todo: 'bottom', debug: 'bottom', gradle: 'left', notifications: 'bottom',
  },
  order: {
    left: ['gradle', 'git', 'search', 'outline', 'bookmarks'], right: ['files'],
    bottom: ['notifications', 'debug', 'todo', 'vcslog'],
  },
  sizes: { explorer: 350, trace: 310, output: 260 },
})

// ToolWindowDefaultLayoutManager.kt:225-235 / 267-278 round-trip order and every anchor,
// including BOTTOM. TaoCode's default placements come from its shared metadata.
test('factory restoration uses all shared default anchors and stripe orders', t => {
  storage(t)
  const h = host()
  for (const id of metadata.toolWindowOrder) h.toolAnchors[id] = 'left'
  h.toolOrder.value = { left: [...metadata.toolWindowOrder].reverse(), right: [], bottom: [] }
  h.useFactoryToolLayout()
  assert.deepEqual({ ...h.toolAnchors }, metadata.DEFAULT_TOOL_ANCHORS)
  assert.deepEqual(h.toolOrder.value, metadata.DEFAULT_TOOL_ORDER)
  for (const side of ['left', 'right', 'bottom'])
    assert.deepEqual(h.stripeOrder.value(side), metadata.DEFAULT_TOOL_ORDER[side])
})

test('capture and normalization retain every bottom-anchored tool without aliasing live state', t => {
  storage(t)
  const h = host()
  for (const id of metadata.toolWindowOrder) h.toolAnchors[id] = 'bottom'
  h.toolOrder.value.bottom = [...metadata.toolWindowOrder].reverse()
  h.deps.bottomTab.value = 'debug'
  const snapshot = h.captureToolLayout()
  for (const id of metadata.toolWindowOrder) assert.equal(snapshot.anchors[id], 'bottom', id)
  assert.deepEqual(layoutModel.normalizeToolLayout(snapshot, h.factoryToolLayout()), snapshot)
  h.toolAnchors.debug = 'right'
  h.toolOrder.value.bottom.pop()
  h.deps.panelSizes.output = 999
  assert.equal(snapshot.anchors.debug, 'bottom')
  assert.equal(snapshot.order.bottom.length, metadata.toolWindowOrder.length)
  assert.equal(snapshot.sizes.output, 180)
})

test('apply restores all docks, selections and sizes through the host setter', t => {
  storage(t)
  const h = host()
  const snapshot = custom()
  h.applyToolLayout(snapshot)
  assert.deepEqual(h.captureToolLayout(), snapshot)
  assert.deepEqual(h.sizesSet, [['explorer', 350], ['trace', 310], ['output', 260]])
  assert.deepEqual(h.stripeOrder.value('bottom'), snapshot.order.bottom)
  snapshot.order.bottom.reverse()
  assert.equal(h.toolOrder.value.bottom[0], 'notifications', 'applied order must not alias the snapshot')
})

test('apply accepts every registered bottom tool as the selected tab, not just fixed content tabs', t => {
  storage(t)
  const h = host()
  for (const id of metadata.toolWindowOrder) {
    const snapshot = h.factoryToolLayout()
    snapshot.anchors[id] = 'bottom'
    snapshot.tab = id
    h.deps.bottomTab.value = 'output'
    h.applyToolLayout(snapshot)
    assert.equal(h.deps.bottomTab.value, id)
  }
  for (const tab of metadata.BOTTOM_TABS) {
    h.applyToolLayout({ ...h.factoryToolLayout(), tab })
    assert.equal(h.deps.bottomTab.value, tab)
  }
})

test('restoring a named layout persists its anchors and all stripe orders for a new session', t => {
  const values = storage(t)
  const h = host()
  const snapshot = custom()
  h.toolLayoutStore.value = layoutModel.saveLayout(h.toolLayoutStore.value, 'Workspace', snapshot)
  h.persistToolLayouts()
  h.restoreCurrentToolLayout()
  const saved = JSON.parse(values.get('taocode.toolLayout:project') ?? 'null')
  assert.deepEqual(saved?.anchors, snapshot.anchors, '锚点落在项目级布局里')
  assert.deepEqual(saved?.order, snapshot.order, '顺序也落在同一份里')
  const reopened = host()
  assert.deepEqual({ ...reopened.toolAnchors }, snapshot.anchors)
  for (const side of ['left', 'right', 'bottom'])
    assert.deepEqual(reopened.stripeOrder.value(side), snapshot.order[side])
  reopened.restoreCurrentToolLayout()
  assert.deepEqual(reopened.captureToolLayout(), snapshot)
})

test('restore repairs incomplete saved orders on their actual anchors and ignores removed ids', t => {
  storage(t)
  const h = host()
  const snapshot = h.factoryToolLayout()
  snapshot.anchors.files = 'right'
  snapshot.order = { left: ['git'], right: ['files', 'removed', 'files'], bottom: ['tests'] }
  snapshot.view = 'removed'
  snapshot.tab = 'removed'
  h.applyToolLayout(snapshot)
  assert.deepEqual(h.stripeOrder.value('right'), ['files', 'gradle', 'notifications'])
  assert.deepEqual(h.stripeOrder.value('bottom'), ['vcslog', 'search', 'todo', 'debug'])
  assert.deepEqual(h.stripeOrder.value('left'), ['git', 'outline', 'bookmarks'])
  assert.equal(h.deps.leftView.value, 'files')
  assert.equal(h.deps.bottomTab.value, 'output')
})

test('loading a partial named snapshot normalizes it before applying bottom placement', t => {
  const values = storage(t)
  values.set('taocode.toolWindowLayouts', JSON.stringify({
    active: 'Old', layouts: { Old: { anchors: { files: 'bottom' }, tab: 'files', bottom: true } },
  }))
  const h = host()
  assert.doesNotThrow(() => h.restoreCurrentToolLayout())
  assert.equal(h.toolAnchors.files, 'bottom')
  assert.equal(h.deps.bottomTab.value, 'files')
  assert.ok(h.stripeOrder.value('bottom').includes('files'))
  assert.deepEqual(h.stripeOrder.value('right'), ['gradle', 'notifications'])
})

test('saving live changes keeps bottom tools and does not change after later moves', t => {
  storage(t)
  const h = host()
  h.toolAnchors.gradle = 'bottom'
  h.toolOrder.value.bottom = ['gradle', 'tests', 'todo', 'debug', 'vcslog']
  h.deps.bottomTab.value = 'gradle'
  h.storeCurrentToolLayout()
  const stored = h.toolLayoutStore.value.layouts[h.toolLayoutStore.value.active]
  assert.equal(stored.anchors.gradle, 'bottom')
  assert.equal(stored.tab, 'gradle')
  assert.deepEqual(stored.order.bottom, ['gradle', 'tests', 'todo', 'debug', 'vcslog'])
  h.toolAnchors.gradle = 'right'
  h.toolOrder.value.bottom.reverse()
  assert.equal(stored.anchors.gradle, 'bottom')
  assert.deepEqual(stored.order.bottom, ['gradle', 'tests', 'todo', 'debug', 'vcslog'])
})
