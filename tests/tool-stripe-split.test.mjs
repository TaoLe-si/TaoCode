// 侧条上的**后半组**（IDEA 的 side tool / `WindowInfo.isSplit`）的判据。
//
// 上游坐标（本机参考树逐行数过）：
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractDroppableStripe.kt:57-72`
//     比较器第一判据「side buttons in the end」（`:59-62`），同组才比 `order`（`:68-70`）；
//   · 同文件 `:592-597` 分隔件插在**第一个 split 之前**、`:602-609` 插在第 0 位（整条都是后半组）不画；
//   · 同文件 `:250-256`（`finishDrop` 把落点算成 `isSplit` 交给 `setSideToolAndAnchor`）与
//     `:463-469`（落点在分隔线之下 ⇒ 后半组）；
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/StripeButtonSeparator.kt:22-37`
//     盒子 32×11、画的是一条居中的 24×1 线；
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowInfoImpl.kt:91-92`
//     `isSplit`（XML 属性名 `side_tool`，默认 false）；
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/DesktopLayout.kt:46`
//     初值 = EP `secondary`（`ToolWindowSetInitializer.kt:368` 的 `sideTool`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { STRIPE_SEPARATOR_HEIGHT_PX, STRIPE_SEPARATOR_LINE_THICKNESS_PX, STRIPE_SEPARATOR_LINE_WIDTH_PX,
         splitForDrop, splitStripeButtonsLast, stripeSeparatorIndex } from '../src/toolStripeSplit.ts'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'
import { createToolStripeDrag } from '../src/toolStripeDrag.ts'
import { windowInfo } from '../src/toolWindowManager.ts'

const LAYOUT_KEY = 'taocode.toolLayout:project'

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

function stored(values) {
  return JSON.parse(values.get(LAYOUT_KEY) ?? '{"windows":{}}').windows
}

// --- 纯规则：`createButtonLayoutComparator` 的第一判据 ------------------------------------------

test('后半组排在前面那组之后，同组内保持原次序（AbstractDroppableStripe.kt:59-70）', () => {
  const split = new Set(['outline', 'bookmarks'])
  assert.deepEqual(splitStripeButtonsLast(['files', 'git', 'outline', 'bookmarks'], id => split.has(id)),
                   ['files', 'git', 'outline', 'bookmarks'], '出厂次序本来就是这样 ⇒ 不许重排前面那组')
  // 用户把 项目 拖到 结构 之后（顺序表里 files 排到了 split 项之间）⇒ 仍然排在后半组之前。
  assert.deepEqual(splitStripeButtonsLast(['outline', 'files', 'bookmarks', 'git'], id => split.has(id)),
                   ['files', 'git', 'outline', 'bookmarks'])
  assert.deepEqual(splitStripeButtonsLast(['a', 'b'], () => false), ['a', 'b'], '一个后半组都没有 ⇒ 原样')
  assert.deepEqual(splitStripeButtonsLast(['a', 'b'], () => true), ['a', 'b'], '全是后半组也保持次序（只分组不排序）')
})

test('分隔件画在第一个后半组之前；那一位是 0 就不画（:592-597 与 :602-609）', () => {
  const split = new Set(['outline', 'bookmarks'])
  assert.equal(stripeSeparatorIndex(['files', 'git', 'outline', 'bookmarks'], id => split.has(id)), 2)
  assert.equal(stripeSeparatorIndex(['files', 'git'], () => false), null, '没有后半组 ⇒ 没有分隔件')
  assert.equal(stripeSeparatorIndex(['outline', 'bookmarks'], id => split.has(id)), null,
               '整条都是后半组 ⇒ 分隔件会落在第 0 位，上游在这种情况下不画')
})

test('落点在下标轴上对上"压在分隔线之下"（:463-469），缝不存在时不猜（不写这一位）', () => {
  assert.equal(splitForDrop(2, 2), true, '落在分隔件所在槽位 ⇒ 进后半组')
  assert.equal(splitForDrop(2, 3), true)
  assert.equal(splitForDrop(2, 1), false, '落在分隔件之前 ⇒ 留在前面那组')
  assert.equal(splitForDrop(null, 9), null,
               '这一侧还没有后半组：上游会把缝临时挂出来当落点，但那是"鼠标压在缝本体"才成立（tryDroppingOnGap），行标记模型给不出 ⇒ 保持原值')
})

test('分隔件的尺寸是上游那两个数（StripeButtonSeparator.kt:22-23 与 :31-32）', () => {
  assert.equal(STRIPE_SEPARATOR_HEIGHT_PX, 11)
  assert.equal(STRIPE_SEPARATOR_LINE_WIDTH_PX, 24)
  assert.equal(STRIPE_SEPARATOR_LINE_THICKNESS_PX, 1)
})

// --- 状态：初值 / 覆盖 / 存档 --------------------------------------------------------------------

test('isSplit 的初值就是注册表的 EP secondary（DesktopLayout.kt:46）', t => {
  storage(t)
  const h = host()
  assert.equal(h.isSplitOf('outline'), true, 'intellij.platform.structureView.xml 写了 secondary="true"')
  assert.equal(h.isSplitOf('bookmarks'), true)
  assert.equal(h.isSplitOf('notifications'), true)
  assert.equal(h.isSplitOf('files'), false)
  assert.equal(h.isSplitOf('gradle'), false)
  assert.deepEqual(h.stripeOrder.value('right'), ['gradle', 'notifications'])
})

test('拖出来的那一位覆盖注册表初值，并且换项目后还在', t => {
  const values = storage(t)
  const h = host()
  assert.equal(h.setSideTool('files', true), true, '值真的变了才返回 true')
  assert.equal(h.setSideTool('files', true), false, '同值再写返回 false 且不写盘')
  // 前面那组（files 已经进了后半组 ⇒ 只剩 git）按顺序表原序，后半组 = files→outline→bookmarks。
  assert.deepEqual(h.stripeOrder.value('left'), ['git', 'files', 'outline', 'bookmarks'])
  assert.equal(stored(values).files.split, true, '与初值不同 ⇒ 写进那条 <window_info>')
  // 重新装载同一个项目（同一份存档）：覆盖值回来，顺序也跟着重新分组。
  assert.deepEqual(host().stripeOrder.value('left'), ['git', 'files', 'outline', 'bookmarks'])
})

test('存档只写“与初值不同”的那一档：EP 是 true 的窗口没被拖过时不写这一栏', t => {
  const values = storage(t)
  const h = host()
  assert.equal(stored(values).outline?.split, undefined, 'outline 的初值本来就是 true ⇒ 不写')
  assert.equal(stored(values).files?.split, undefined, '没拖过也不写')
  h.setSideTool('outline', false)
  assert.equal(stored(values).outline.split, false, '把 side tool 拖回前半组 = 与初值不同 ⇒ 必须写')
  assert.equal(h.isSplitOf('outline'), false)
  assert.deepEqual(h.stripeOrder.value('left'), ['files', 'git', 'outline', 'bookmarks'])
})

test('旧存档没有 split 这一栏 ⇒ 回到 EP 初值，不判损坏（新增键不许锁项目）', t => {
  const values = storage(t)
  values.set(LAYOUT_KEY, JSON.stringify({ windows: {
    files: { anchor: 'left', order: 0, visible: true },
    outline: { anchor: 'left', order: 1 },
  } }))
  const h = host()
  assert.equal(h.isSplitOf('files'), false)
  assert.equal(h.isSplitOf('outline'), true)
  assert.deepEqual(h.stripeOrder.value('left'), ['files', 'git', 'outline', 'bookmarks'])
})

test('底部那一排不套分组：它是内容标签，不是 StripeV2(BOTTOM)（有意差异，理由见模块头）', t => {
  storage(t)
  const h = host()
  h.setSideTool('vcslog', true)
  assert.deepEqual(h.stripeOrder.value('bottom'), ['vcslog', 'search', 'todo', 'debug'],
                   '底部顺序仍按用户的表来，不把 vcslog 挪到末尾')
  assert.deepEqual(h.stripeOrder.value('left'), ['files', 'git', 'outline', 'bookmarks'])
})

test('门面的 WindowInfo.isSplit 读的是那一张覆盖表（不再是只有 EP 那一位）', t => {
  storage(t)
  const h = host()
  assert.equal(windowInfo('outline')?.isSplit, true)
  h.setSideTool('outline', false)
  assert.equal(windowInfo('outline')?.isSplit, false, '门面必须跟着用户拖出来的那一位走')
  assert.equal(windowInfo('files')?.isSplit, false)
})

// --- 落点写回（toolStripeDrag）------------------------------------------------------------------

function dragFixture(h) {
  const calls = []
  const drag = createToolStripeDrag({
    toolAnchors: () => h.toolAnchors, toolOrder: () => h.toolOrder,
    setToolAnchor: h.setToolAnchor, saveToolOrder: h.saveToolOrder,
    stripeIds: side => h.stripeOrder.value(side),
    isSplit: id => h.isSplitOf(id),
    setSideTool: (id, split) => { calls.push([id, split]); h.setSideTool(id, split) },
  })
  return { drag, calls }
}

test('把按钮落到分隔件之后 = 变成 side tool，落到之前 = 回到前半组（:250-256 的那一次写入）', t => {
  storage(t)
  const h = host()
  const { drag, calls } = dragFixture(h)
  drag.onToolDragStart('files', {})
  drag.onToolDrop('left', null, { preventDefault() {} })  // 末尾 = 分隔件之下
  assert.deepEqual(calls, [['files', true]])
  assert.deepEqual(h.stripeOrder.value('left'), ['git', 'outline', 'bookmarks', 'files'])

  drag.onToolDragStart('files', {})
  drag.onToolDrop('left', 'git', { preventDefault() {} }) // 落在前半组里
  assert.deepEqual(calls, [['files', true], ['files', false]])
  assert.equal(h.isSplitOf('files'), false)
})

test('这一侧没有后半组时，落点不改 isSplit（缝还没挂出来，不猜）', t => {
  storage(t)
  const h = host()
  h.setSideTool('outline', false)
  h.setSideTool('bookmarks', false)
  const { drag, calls } = dragFixture(h)
  drag.onToolDragStart('files', {})
  drag.onToolDrop('left', null, { preventDefault() {} })
  assert.deepEqual(calls, [], '没有分隔件 ⇒ 落末尾只是排到最后，不动分组')
  assert.deepEqual(h.stripeOrder.value('left'), ['git', 'outline', 'bookmarks', 'files'])
})

test('宿主没给这一对（isSplit/setSideTool）时拖放照旧只排序', t => {
  storage(t)
  const h = host()
  const drag = createToolStripeDrag({
    toolAnchors: () => h.toolAnchors, toolOrder: () => h.toolOrder,
    setToolAnchor: h.setToolAnchor, saveToolOrder: h.saveToolOrder,
  })
  drag.onToolDragStart('files', {})
  drag.onToolDrop('left', null, { preventDefault() {} })
  assert.equal(h.isSplitOf('files'), false, '没有写入点就不动分组')
  // 顺序表里 files 落到了末尾，但它不属于后半组 ⇒ 比较器仍把它排回前面那组（:59-62）。
  assert.deepEqual(h.stripeOrder.value('left'), ['git', 'files', 'outline', 'bookmarks'])
})

// --- 消费链路门禁（画那一条线的是 ToolStripe.vue，不是又一篇只过自己测试的规则）------------------

test('ToolStripe.vue 真的按门面那一位画分隔件（不许退化成常量表或第二份判据）', () => {
  const src = readFileSync('src/components/ToolStripe.vue', 'utf8')
  assert.match(src, /from '\.\.\/toolStripeSplit\.ts'/, '分组规则必须复用 toolStripeSplit，不许在组件里再写一份')
  assert.match(src, /from '\.\.\/toolWindowManager\.ts'/, 'isSplit 必须读门面那一份聚合对象')
  assert.match(src, /stripeSeparatorIndex\(props\.ids/, '分隔件位置由 stripeSeparatorIndex 给')
  assert.match(src, /separatorAt === index/, '模板里要在对应槽位前画那一条线')
  assert.doesNotMatch(src, /separatorLine[\s\S]{0,120}#[0-9a-fA-F]{3,6}/, '分隔件颜色走令牌，不许裸 hex')
  const gate = readFileSync('src/toolWindowStripes.ts', 'utf8')
  assert.match(gate, /splitStripeButtonsLast\(ids, isSplitOf\)/, 'stripeOrder 必须过比较器')
  assert.match(gate, /isSplit: id => isSplitOf\(id as ToolWindowId\)/, '门面必须拿到同一位来源')
})
