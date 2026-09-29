import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'
import { createToolStripeDrag } from '../src/toolStripeDrag.ts'
import { DEFAULT_TOOL_ORDER } from '../src/toolWindowMeta.ts'

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
  const deps = {
    isDesktop: true, workspace: ref({ root: 'project' }), lspReady: ref(true),
    gradleAvailable: ref(true), explorer: ref(false), activeView: ref('files'),
  }
  return { ...createToolWindowStripes(deps), deps }
}

test('moving a tool inserts one reachable stripe entry and persists both placement and order', t => {
  const values = storage(t)
  const h = host()
  for (const side of ['right', 'bottom', 'left', 'right']) {
    h.setToolAnchor('files', side)
    assert.equal(h.activeAnchor.value, side)
    assert.equal(h.stripeOrder.value(side).filter(id => id === 'files').length, 1)
    for (const other of ['left', 'right', 'bottom'].filter(anchor => anchor !== side))
      assert.equal(h.toolOrder.value[other].includes('files'), false)
    assert.equal(JSON.parse(values.get('taocode.toolAnchors')).files, side)
    assert.deepEqual(JSON.parse(values.get('taocode.toolOrder')), h.toolOrder.value)
  }
  assert.equal(h.deps.explorer.value, true)
  const order = [...h.stripeOrder.value('right')]
  h.setToolAnchor('files', 'right')
  assert.deepEqual(h.stripeOrder.value('right'), order, 'same-anchor moves must not reorder the stripe')
  assert.deepEqual(host().stripeOrder.value('right'), order)
})

test('stripe state does not mutate the shared default order arrays', t => {
  storage(t)
  const original = structuredClone(DEFAULT_TOOL_ORDER)
  t.after(() => {
    for (const side of ['left', 'right', 'bottom'])
      DEFAULT_TOOL_ORDER[side].splice(0, DEFAULT_TOOL_ORDER[side].length, ...original[side])
  })
  const h = host()
  h.toolOrder.value.left.reverse()
  h.toolOrder.value.bottom.push('files')
  assert.deepEqual(DEFAULT_TOOL_ORDER, original)
  assert.deepEqual(host().toolOrder.value, original)
})

test('bottom content choices respect restored stripe order and availability', t => {
  storage(t)
  const h = host()
  h.toolOrder.value.bottom = ['debug', 'search', 'todo', 'vcslog']
  assert.deepEqual(h.bottomAnchoredIds.value, ['debug', 'search', 'todo', 'vcslog'])
  h.deps.workspace.value = null
  // workspace=null 时 vcslog 不可用被滤掉；search 没有可用性门槛，保留。
  assert.deepEqual(h.bottomAnchoredIds.value, ['debug', 'search', 'todo'])
})

test('a saved anchor stays reachable when the saved target order is missing or stale', t => {
  const values = storage(t)
  values.set('taocode.toolAnchors', JSON.stringify({ files: 'right', gradle: 'bottom' }))
  values.set('taocode.toolOrder', JSON.stringify({ left: ['files', 'git'], bottom: ['todo', 'removed', 'todo'] }))
  const h = host()
  assert.deepEqual(h.stripeOrder.value('right'), ['notifications', 'files'])
  // 回填按 DEFAULT_TOOL_ORDER：bottom = vcslog→search→todo→debug→tests（search 已移到底部），
  // 挪过来的 gradle 排在默认成员之后；left = files→outline→bookmarks→history（无 search）。
  assert.deepEqual(h.stripeOrder.value('bottom'), ['todo', 'vcslog', 'search', 'debug', 'gradle'])
  assert.deepEqual(h.stripeOrder.value('left'), ['git', 'outline', 'bookmarks'])
})

test('dragging across stripes still honors the requested insertion position', t => {
  storage(t)
  const h = host()
  const drag = createToolStripeDrag({
    toolAnchors: () => h.toolAnchors, toolOrder: () => h.toolOrder,
    setToolAnchor: h.setToolAnchor, saveToolOrder: h.saveToolOrder,
  })
  drag.onToolDragStart('files', {})
  drag.onToolDrop('right', 'gradle', { preventDefault() {} })
  assert.deepEqual(h.stripeOrder.value('right'), ['files', 'gradle', 'notifications'])
  assert.equal(h.stripeOrder.value('left').includes('files'), false)
  assert.deepEqual(host().stripeOrder.value('right'), ['files', 'gradle', 'notifications'])
})

// 真 bug 回归：项目树/结构被 Move to Bottom 搬到底部后**再也切不回来**。
// 成因是宿主的 activate 先写了 files/outline 两个专属分支再判断锚点，而 setToolAnchor
// 同时把它们从左栏顺序里摘掉 —— 左栏没入口、点击路径又只走 leftView/explorer，两侧失联。
// 规则（IDEA ToolWindowManagerImpl.activateToolWindow）：activate 一律只看当前锚点，
// 与窗口种类无关。activationTarget 就是把这条规则变成可测的纯函数。
test('a window moved to the bottom is still reachable, and can be moved back', t => {
  storage(t)
  const h = host()
  for (const id of ['files', 'outline', 'git']) {
    assert.equal(h.activationTarget(id).dock, 'side', `${id} 默认在侧边`)
    h.setToolAnchor(id, 'bottom')
    // 左侧顺序里已经没有它了 —— 这正是当初"切不回来"的成因。
    assert.equal(h.stripeOrder.value('left').includes(id), false, `${id} 应从左栏顺序移除`)
    // 但它仍是底部 dock 的一个入口，点击会走到 bottom 而不是 side。
    assert.equal(h.activationTarget(id).dock, 'bottom', `${id} 搬到底部后必须走 bottom`)
    assert.equal(h.bottomAnchoredIds.value.includes(id), true, `${id} 底部 tab 条上要有入口`)
    h.setToolAnchor(id, 'left')
    assert.equal(h.activationTarget(id).dock, 'side', `${id} 搬回左侧后必须走 side`)
    assert.equal(h.stripeOrder.value('left').includes(id), true, `${id} 搬回左侧要恢复入口`)
  }
})

test('activationTarget answers per window, and unknown ids fall back to the side', t => {
  storage(t)
  const h = host()
  h.setToolAnchor('git', 'bottom')
  h.setToolAnchor('files', 'right')
  assert.equal(h.anchorOf('git'), 'bottom')
  assert.equal(h.anchorOf('files'), 'right')
  // 锚点是 right 而不是 bottom 时，右侧 stripe 就是它的入口。
  assert.equal(h.stripeOrder.value('right').includes('files'), true)
  assert.equal(h.activationTarget('files').dock, 'side')
  assert.equal(h.activationTarget('git').dock, 'bottom')
  assert.equal(h.activationTarget('not-a-window').dock, 'side')
})
