// 桶 8（拖放）· 侧条拖放的**插入位指示**判据。
//
// 上游形状（逐条开过本机参考树，路径相对
// `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractDroppableStripe.kt`
//     的 `doLayout` 一次只认**一个**落点：每一档在认领之前都要先问 `!data.dragTargetChosen`
//     （`:354`、`:375`、`:409`、`:436`），谁先认领就把 `dragTargetChosen` 置上（`:400`、`:440`）；
//   · 只有**一个按钮都没认领**时，`:436-441` 那条兜底才把落点放到末尾（`dragInsertPosition = -1`、
//     `dragToSide = true`）—— 末尾槽不是"永远生效"，它是兜底；
//   · `:443-444`：连兜底都没发生（落点在这条条纹之外）⇒ `drawRectangle` 归零，也就是**不画**。
//
// DOM 里的对应麻烦：同一次 `dragover` 会先命中被悬停的按钮（`before = 那个按钮`），
// 再冒泡到轨道本体（轨道那条 `dragover` 给的是 `before = null` = 末尾）。
// 没有"`dragTargetChosen`"那一位的话，轨道的兜底会把按钮已经认领的落点覆盖掉 ——
// 用户看到的表现就是**插入线永远画在条尾**，而右侧条连那条都不画（宿主把它的 `drop-at-end` 写死成
// `false`，见 `docs/wiring-requests-2026-10-06-dnd8.md` D-1）。
// 本文件钉的就是这两件事：按钮优先、末尾槽按侧独立生效；外加"取消拖放不留副作用"。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createToolStripeDrag } from '../src/toolStripeDrag.ts'
import { loadSfc } from './vue-sfc-loader.mjs'

const { component: ToolStripe } = loadSfc('src/components/ToolStripe.vue')

/** 一次拖放的夹具：`events` 记录宿主被调用了几次（"取消不留副作用"就查这个）。 */
function harness(options = {}) {
  const events = []
  const anchors = options.anchors ?? { files: 'left', git: 'left', gradle: 'right' }
  const order = { left: ['files', 'git'], right: ['gradle'], bottom: [] }
  const rendered = { left: ['files', 'git'], right: ['gradle'], bottom: [] }
  const drag = createToolStripeDrag({
    toolAnchors: () => anchors,
    toolOrder: () => ({ value: order }),
    setToolAnchor: (id, side) => events.push(`anchor:${id}:${side}`),
    saveToolOrder: () => events.push('save'),
    stripeIds: side => rendered[side],
    isSplit: () => false,
    setSideTool: (id, split) => events.push(`sideTool:${id}:${split}`),
  })
  const event = () => ({ dataTransfer: { effectAllowed: 'move', dropEffect: '' }, preventDefault: () => {} })
  return { drag, events, order, event }
}

/** 轨道 + 按钮都画一遍的最小 props（`isDropBefore` 用**模块真身**，不是桩）。 */
function stripeProps(drag, overrides) {
  return {
    side: 'left', ids: ['files', 'git'], labels: { files: '项目', git: '提交' },
    icons: { files: 'span', git: 'span' }, mnemonicOf: () => '1', isDisabled: () => false,
    isActive: () => false, dragging: drag.draggingTool.value, isDropBefore: drag.isDropBefore,
    dropAtEnd: false, width: 0, showNames: false, compact: false, moreIds: [], moreOnThisSide: false,
    ...overrides,
  }
}
const render = props => renderToString(createSSRApp({ render: () => h(ToolStripe, props) }))

// ── 1. 按钮优先：同一次 dragover 里轨道的末尾兜底不得覆盖按钮认领的落点 ─────────────────────
test('同一次 dragover：按钮认领的落点不被轨道的末尾兜底覆盖（dragTargetChosen）', () => {
  const h = harness()
  const ev = h.event()
  h.drag.onToolDragStart('files', { dataTransfer: { setData: () => {}, effectAllowed: '' } })
  // DOM 的真实顺序：先是按钮那条（before='git'），冒泡之后是轨道那条（before=null）。
  h.drag.onToolDragOver('left', 'git', ev)
  h.drag.onToolDragOver('left', null, ev)
  assert.equal(h.drag.isDropBefore('left', 'git'), true,
    '插入线该钉在被悬停的那个按钮之前；轨道的 null 兜底把这次事件的认领覆盖掉就是"插入线永远在条尾"')
  assert.equal(h.drag.isDropBefore('left', null), false, '这次事件已被按钮认领，末尾槽不该同时亮')
})

// ── 2. 末尾槽仍然是真落点：下一次事件落在轨道空白处 ⇒ 兜底生效 ─────────────────────────────
test('落到轨道空白处（新的一次 dragover）才算末尾槽', () => {
  const h = harness()
  h.drag.onToolDragStart('files', { dataTransfer: { setData: () => {}, effectAllowed: '' } })
  h.drag.onToolDragOver('left', 'git', h.event())
  h.drag.onToolDragOver('left', null, h.event())
  assert.equal(h.drag.isDropBefore('left', null), true, '末尾槽要在"指针真的不在任何按钮上"时亮')
  assert.equal(h.drag.isDropBefore('left', 'git'), false, '末尾亮时按钮那条要灭，否则同时画两根线')
})

// ── 3. 按侧独立：右条的末尾落点不借左条的判据，反之也一样 ─────────────────────────────────
test('末尾槽按侧独立生效（右侧条不再因为宿主写死 false 就完全没有指示）', () => {
  const h = harness()
  h.drag.onToolDragStart('files', { dataTransfer: { setData: () => {}, effectAllowed: '' } })
  h.drag.onToolDragOver('right', null, h.event())
  assert.equal(h.drag.isDropBefore('right', null), true, '拖到右条空白 = 右条的末尾落点')
  assert.equal(h.drag.isDropBefore('left', null), false, '左条不该跟着亮')
  assert.equal(h.drag.isDropBefore('right', 'gradle'), false)
})

// ── 4. 真模板：标记画在被悬停按钮**之前**，并画在右条末尾 ─────────────────────────────────
test('模板真的把标记画在认领的那个按钮之前', async () => {
  const h = harness()
  h.drag.onToolDragStart('files', { dataTransfer: { setData: () => {}, effectAllowed: '' } })
  // 同一次事件：按钮先认领，轨道随后冒泡上来给 null —— 兜底不该覆盖它。
  const ev = h.event()
  h.drag.onToolDragOver('left', 'git', ev)
  h.drag.onToolDragOver('left', null, ev)
  const html = await render(stripeProps(h.drag, {}))
  const marker = html.indexOf('stripe-drop-marker')
  const gitButton = html.indexOf('aria-label="切换提交"')
  const filesButton = html.indexOf('aria-label="切换项目"')
  assert.ok(marker >= 0, '一个标记都没画')
  assert.ok(marker < gitButton, '标记必须画在 git 按钮之前（落点 = 插在它前面）')
  assert.ok(filesButton < marker, '标记不能在第一个按钮之前')
  assert.equal((html.match(/stripe-drop-marker/g) ?? []).length, 1, '一次拖放只该有一根插入线')
})

test('右条末尾：组件按落点自己画得出标记，不依赖宿主的 drop-at-end', async () => {
  const h = harness()
  h.drag.onToolDragStart('files', { dataTransfer: { setData: () => {}, effectAllowed: '' } })
  h.drag.onToolDragOver('right', null, h.event())
  const html = await render(stripeProps(h.drag, { side: 'right', ids: ['gradle'] }))
  assert.equal((html.match(/stripe-drop-marker/g) ?? []).length, 1,
    '右侧条拖到末尾时必须画指示（宿主那一位写死 false 是保留文件里的不对称，见 D-1）')
  // 没有落点时一根都不画（`:443-444`：连兜底都没发生就把矩形归零）。
  h.drag.onToolDragEnd()
  const idle = await render(stripeProps(h.drag, { side: 'right', ids: ['gradle'], dragging: null }))
  assert.ok(!idle.includes('stripe-drop-marker'), '取消/结束后不该有残留标记')
})

// ── 5. 取消拖放不留副作用 ────────────────────────────────────────────────────────────────
test('取消拖放（dragend）：标记清空、认领记录清空，且不产生任何写入', () => {
  const h = harness()
  const before = JSON.stringify(h.order)
  h.drag.onToolDragStart('files', { dataTransfer: { setData: () => {}, effectAllowed: '' } })
  h.drag.onToolDragOver('left', 'git', h.event())
  h.drag.onToolDragOver('right', null, h.event())
  h.drag.onToolDragEnd()
  assert.equal(h.drag.dropTarget.value, null, 'dropTarget 必须清空')
  assert.equal(h.drag.draggingTool.value, null, 'draggingTool 必须清空')
  assert.equal(h.drag.isDropBefore('right', null), false, '取消后残留的末尾标记 = 副作用')
  assert.equal(h.drag.isDropBefore('left', 'git'), false)
  assert.deepEqual(h.order, { left: ['files', 'git'], right: ['gradle'], bottom: [] }, '顺序一点没动')
  assert.equal(JSON.stringify(h.order), before)
  assert.deepEqual(h.events, [], '取消拖放不该产生任何锚点/顺序/分组的写入')
  // 认领记录也要一起清掉，否则下一段拖放的末尾落点会被上一段的认领吃掉（画不出线）。
  const next = h.event()
  h.drag.onToolDragStart('files', { dataTransfer: { setData: () => {}, effectAllowed: '' } })
  h.drag.onToolDragOver('left', 'git', next)
  h.drag.onToolDragOver('left', null, next)
  assert.equal(h.drag.isDropBefore('left', 'git'), true, '下一段拖放仍要按"按钮优先"')
})

test('落回自己原来的位置 = 什么都不写（同一次拖放取消的另一种形态）', () => {
  const h = harness()
  h.drag.onToolDragStart('git', { dataTransfer: { setData: () => {}, effectAllowed: '' } })
  const ev = h.event()
  h.drag.onToolDragOver('left', 'git', ev)
  h.drag.onToolDrop('left', 'git', ev)
  assert.deepEqual(h.order.left, ['files', 'git'], '原地松手不许把窗口挪到条尾')
  assert.deepEqual(h.events, [], '原地松手不该落盘、不该改锚点、不该改分组')
  assert.equal(h.drag.isDropBefore('left', 'git'), false)
})
