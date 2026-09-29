// **每窗口可见性**（IDEA `WindowInfoImpl.isVisible`，默认 false）的判据 —— 第四十三批。
//
// 上游三处：
//   · `WindowInfoImpl.isVisible`（`:78-80`，默认 **false**，序列化成 `visible` 属性）；
//   · `ToolWindowImpl.show()/hide()` 改的就是它 ⇒ 展开/收起跟着**项目**存；
//   · `ToolWindowSetInitializer` 装配时按存档把 `isVisible = true` 的窗口放回去。
// 本仓每侧只有一个可见窗口（侧栏 `leftView`、底部 `bottomTab`），所以"可见的那个"= 选中的那个；
// 那一侧一个都没有 ⇒ 那一侧收起。**只有存档显式写过 `visible` 才恢复** —— 没写过（新项目/刚播种）
// 不许覆盖宿主的默认（宽窗口默认开项目视图那一条）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'
import { hasExplicitVisibility, visibleWindowIds, windowVisible } from '../src/toolLayoutProfiles.ts'

function withStorage(seed = {}) {
  const values = new Map(Object.entries(seed))
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
  return { values, restore: () => { globalThis.localStorage = previous } }
}

function host(root = 'A', initial = {}) {
  const workspace = ref({ root })
  const explorer = ref(initial.explorer ?? false)
  const leftView = ref(initial.leftView ?? 'files')
  const bottom = ref(initial.bottom ?? false)
  const bottomTab = ref(initial.bottomTab ?? 'output')
  const stripes = createToolWindowStripes({
    isDesktop: true, workspace, lspReady: { value: true }, gradleAvailable: { value: true },
    explorer, activeView: { get value() { return leftView.value }, set value(id) { leftView.value = id } },
    bottom, bottomTab,
  })
  return { stripes, workspace, explorer, leftView, bottom, bottomTab }
}
const saved = (storage, root = 'A') => JSON.parse(storage.values.get(`taocode.toolLayout:${root}`))

test('存档里没写过 visible ⇒ 一个都不放回，也不动宿主的默认', () => {
  const storage = withStorage()
  try {
    // 宿主默认（宽窗口开项目视图）——记录里没有 visible 这一栏
    storage.values.set('taocode.toolLayout:A', JSON.stringify({ windows: { files: { anchor: 'left' } } }))
    const h = host('A', { explorer: true })
    assert.equal(h.explorer.value, true, '宿主自己的默认保持不动')
    assert.equal(h.bottom.value, false)
  } finally { storage.restore() }
})

test('展开/收起都写进记录（上游 show()/hide() 改的就是 isVisible）', async () => {
  const storage = withStorage()
  try {
    const h = host('A')
    assert.deepEqual(saved(storage)?.windows?.files?.visible, false, '装配时就落了"侧栏没开"')
    h.explorer.value = true
    await nextTick()
    assert.equal(saved(storage).windows.files.visible, true, '展开侧栏 ⇒ 那个窗口 visible')
    assert.equal(saved(storage).windows.git.visible, false, '同侧别的窗口不可见（每侧只有一个）')
    h.explorer.value = false
    await nextTick()
    assert.equal(saved(storage).windows.files.visible, false, '收起之后要写回 false')
  } finally { storage.restore() }
})

test('底部那一侧按内容记：固定内容与停靠底部的工具窗口都算', async () => {
  const storage = withStorage()
  try {
    const h = host('A')
    h.bottom.value = true
    h.bottomTab.value = 'vcslog'
    await nextTick()
    assert.equal(saved(storage).windows.vcslog.visible, true, '停靠底部的工具窗口')
    h.bottomTab.value = 'terminal'
    await nextTick()
    assert.equal(saved(storage).windows.terminal.visible, true, '固定底部内容也是同一个字段')
    assert.equal(saved(storage).windows.vcslog.visible, false)
  } finally { storage.restore() }
})

test('打开项目时按存档放回上次那些窗口（含"两个都收着"这一档）', () => {
  const storage = withStorage({
    'taocode.toolLayout:A': JSON.stringify({ windows: {
      files: { anchor: 'left', visible: false }, git: { anchor: 'left', visible: false },
      output: { visible: false }, vcslog: { anchor: 'bottom', visible: true },
    } }),
  })
  try {
    const h = host('A', { explorer: true, leftView: 'files', bottom: false })
    assert.equal(h.explorer.value, false, '存档说侧栏收着 ⇒ 就算宿主默认开着也要收')
    assert.equal(h.bottom.value, true, '存档说 vcslog 开着 ⇒ 底部展开')
    assert.equal(h.bottomTab.value, 'vcslog', '并把那一格选中')
  } finally { storage.restore() }
})

test('侧栏开着时选中的那个窗口就是可见的那个', () => {
  const storage = withStorage({
    'taocode.toolLayout:A': JSON.stringify({ windows: {
      files: { anchor: 'left', visible: false }, git: { anchor: 'left', visible: true },
    } }),
  })
  try {
    const h = host('A', { explorer: false })
    assert.equal(h.explorer.value, true)
    assert.equal(h.leftView.value, 'git', '放回的是存档里 visible 的那一个')
  } finally { storage.restore() }
})

test('可见性按项目分开', async () => {
  const storage = withStorage()
  try {
    const h = host('A')
    h.explorer.value = true
    await nextTick()
    h.workspace.value = { root: 'B' }
    await nextTick()
    assert.equal(h.explorer.value, true, 'B 没有显式可见性 ⇒ 不动宿主的当前值')
    h.explorer.value = false
    await nextTick()
    h.workspace.value = { root: 'A' }
    await nextTick()
    assert.equal(h.explorer.value, true, '回到 A ⇒ 放回 A 那次开着的侧栏')
  } finally { storage.restore() }
})

test('纯判据：没写 = 不可见，只有显式 true 才算可见', () => {
  assert.equal(windowVisible({}), false)
  assert.equal(windowVisible({ visible: false }), false)
  assert.equal(windowVisible({ visible: true }), true)
  const layout = { windows: { a: { visible: true }, b: { visible: false }, c: {} } }
  assert.deepEqual(visibleWindowIds(layout), ['a'])
  assert.equal(hasExplicitVisibility(layout), true)
  assert.equal(hasExplicitVisibility({ windows: { c: {} } }), false)
  assert.equal(hasExplicitVisibility(null), false)
})
