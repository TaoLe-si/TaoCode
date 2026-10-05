// 换锚点时**可见性要跟着搬** —— 真 bug 回归。
//
// 上游原文：`ToolWindowManagerImpl.kt:1700-1726` `hideIfNeededAndShowAfterTask`
//   :1706  val wasVisible = entry.readOnlyWindowInfo.isVisible
//   :1708-1710  开着就先收起来（搬的过程中先藏）
//   :1712  task()  —— 真正搬（`doSetAnchor`）
//   :1714-1719  搬完若原来开着：`info.isVisible = true` + `doShowWindow(...)`（在新位置重新显示）
//   :1720-1722  原来还持有焦点的话再 `requestFocusInWindow()`
// ⇒ 搬动**不改变**"开着还是收着"；旧实现只搬不显示，于是搬到哪一边就从哪一边失联。
//
// 旧实现的两个具体后果（本仓的形态差异）：
//   ① 搬到底部时 `setToolAnchor` 只在 `anchor !== 'bottom'` 分支里打开面板，而底部 dock 只在
//      `bottom` 为真时渲染（`App.vue` 的 `v-if="bottom"`）⇒ 窗口的标签条根本不在；
//   ② 侧栏那边则是**无条件** `explorer = true`，把原来收着的窗口也点亮，还顺手顶掉正在显示的那个。
//
// 与 tests/tool-window-stripes.test.mjs 里「搬到底部后还能搬回来」那一条互补：那条管**入口**
// （`activationTarget` / `stripeOrder`），这里管**搬完那一瞬间它是不是看得见**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'

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

/** 夹具与 tool-window-stripes.test.mjs 同形，但把 `bottom` / `bottomTab` 也传进来（宿主 App.vue:256）。 */
function host(t, init = {}) {
  const values = storage(t)
  const deps = {
    isDesktop: true, workspace: ref({ root: 'project' }), lspReady: ref(true),
    gradleAvailable: ref(true), explorer: ref(false), activeView: ref('files'),
    bottom: ref(false), bottomTab: ref('output'),
    ...init,
  }
  return { ...createToolWindowStripes(deps), deps, values }
}

test('a visible side window moved to the bottom opens the bottom dock on that window', t => {
  // 项目树开着（侧栏只在 explorer && activeAnchor==='left' 时渲染 —— 见 App.vue 的两个 aside）。
  const h = host(t, { explorer: ref(true), activeView: ref('files') })
  h.setToolAnchor('files', 'bottom')
  // 锚点一翻，两侧 aside 都不再渲染（`activeAnchor` 变了）；底部 dock 不打开 ⇒ 整个窗口凭空消失。
  assert.equal(h.activeAnchor.value, 'bottom')
  assert.equal(h.deps.bottom.value, true, '搬到底部必须把 dock 打开，否则新位置没有入口')
  assert.equal(h.deps.bottomTab.value, 'files', '打开的是刚搬过去的那个窗口')
  assert.equal(h.bottomAnchoredIds.value.includes('files'), true, '它在底部标签条上要有入口')
})

test('a window that was hidden stays hidden when it is re-anchored to the side', t => {
  // `wasVisible` 为假时上游不做 `doShowWindow`（:1714）—— 亮它属于替用户做决定，
  // 而且会把正在显示的另一个窗口顶掉（`activeView` 只有一份）。
  const h = host(t, { explorer: ref(true), activeView: ref('files') })
  h.setToolAnchor('bookmarks', 'right')
  assert.equal(h.toolAnchors.bookmarks, 'right')
  assert.equal(h.deps.explorer.value, true, '侧栏本来就开着，不该被这次搬动改变')
  assert.equal(h.deps.activeView.value, 'files', '原来显示的项目树不能被一个隐藏窗口顶掉')
})

test('a hidden window moved to the bottom still lands on a reachable entry', t => {
  const h = host(t, { explorer: ref(true), activeView: ref('files') })
  h.setToolAnchor('bookmarks', 'bottom')
  // 底部 dock 的条纹长在 dock 里面（`v-if="bottom"`），所以这一侧必须打开 —— 这不是"替用户决定"，
  // 而是搬完了得有个入口能看见，否则就是「搬走之后再也没法切回来」。
  assert.equal(h.deps.bottom.value, true)
  assert.equal(h.deps.bottomTab.value, 'bookmarks')
  // 侧栏原本显示的窗口不动：两条 dock 各自的可见窗口是各自一份。
  assert.equal(h.deps.explorer.value, true)
  assert.equal(h.deps.activeView.value, 'files')
})

test('the side dock follows a visible window across left ↔ right', t => {
  for (const [from, to] of [['left', 'right'], ['right', 'left']]) {
    const h = host(t, { explorer: ref(true), activeView: ref('files') })
    h.setToolAnchor('files', from)
    assert.equal(h.activeAnchor.value, from)
    h.setToolAnchor('files', to)
    assert.equal(h.activeAnchor.value, to, `左↔右搬运后 activeAnchor 必须是 ${to}`)
    assert.equal(h.deps.explorer.value, true, '侧栏必须还开着，否则窗口跟着 activeAnchor 一起消失')
    assert.equal(h.deps.activeView.value, 'files', '搬完显示的就是它')
  }
})

test('visibility is persisted after the move, not one frame later', t => {
  // §22 的写入点：`saveVisibility` 的 watch 建时要先求值一次，被读的 ref 必须声明得够早。
  // 落盘判据 = `WindowInfo.visible`（`WindowInfo.isVisible`），搬完再开项目仍要回到同一处。
  const h = host(t, { explorer: ref(true), activeView: ref('files') })
  h.setToolAnchor('files', 'bottom')
  h.saveVisibility()
  const saved = JSON.parse(h.values.get('taocode.toolLayout:project') ?? '{"windows":{}}')
  assert.equal(saved.windows.files?.visible, true, '搬到底部后它仍然是开着的那个窗口')
  assert.equal(saved.windows.files?.anchor, 'bottom')
})
