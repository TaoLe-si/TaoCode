// `src/popupStack.ts` 的**接线判据** —— 模块自己那 15 条规则在 `tests/popup-stack.test.mjs`，
// 这一份只管一件事：真实的弹层组件有没有把自己注册进那条栈，以及注册之后用户能感到的行为。
//
// 上游坐标（参考树 intellij-community-master）：
//   · 全局链有两个入口：`PopupDispatcher.java:36` 的 `addAWTEventListener(..., MouseEvent.MOUSE_PRESSED)`
//     与 `:37` 的 `addKeyEventDispatcher(ourInstance)` —— 鼠标与键盘**共用一条链、一个所有者**；
//   · 键盘侧 `StackingPopupDispatcherImpl.java:181-193`：关闭请求（Esc）交给 `findPopup()`
//     （`:168-178`，丢掉已释放的栈顶后的最上面那层），不是交给"自己挂了监听的那个组件"；
//   · `:141` 的 `canClose()` 是在遍历里**现场**调的，所以本仓把它做成谓词而不是登记值；
//   · 弹层必须"在场"才答得出「焦点进弹层没有」：`ToolWindowManagerLifecycle.kt:131` 的
//     `getParentBalloonFor(focusedComponent)` 问的就是当前所有弹层，本仓由 `popupHasFocusWithin`
//     回答 —— **没注册的层等于没有层**，于是开着菜单时 autoHide 的窗口会当场收掉。
//
// SSR 夹具说明：`renderToString` 不跑 `onBeforeUnmount`，所以"宿主把 v-if 落下来 ⇒ 出栈"这一步
// 由用例显式 `stack.remove(id)` 代做（宿主那句就是 `anchorMenu.value = null`，
// 见 `src/toolWindowActions.ts` 的 `closeAnchorMenu`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSSRApp, defineComponent, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { popupDispatcher, popupStackDepth, usePopupLayer } from '../src/popupStack.ts'
import { loadSfc } from './vue-sfc-loader.mjs'

const { component: AnchorMenu } = loadSfc('src/components/ToolWindowAnchorMenu.vue')
// 三处新消费点要**真加载得起来**：值 import 漏了 `.ts` 扩展名时 Node ESM 报
// `ERR_MODULE_NOT_FOUND`、整个模块（连它的测试）一起红 —— 上面那些源码 grep 看不出这种坏法，
// 所以这里按本仓惯例做一次真实求值（`loadSfc` 会连带解析组件的全部依赖链）。
loadSfc('src/components/ToolWindowGear.vue')
loadSfc('src/components/ToolWindowHeader.vue')
loadSfc('src/components/ContentComboLabel.vue')
const { component: TabContextMenu } = loadSfc('src/components/TabContextMenu.vue')

function stackOf() { return popupDispatcher() }

/** `layers()` 每次都返回新快照对象，所以按 **id** 记账，只摘本用例压进去的那几层。 */
function isolated(t) {
  const stack = stackOf()
  const before = new Set(stack.layers().map(layer => layer.id))
  t.after(() => { for (const layer of stack.layers()) if (!before.has(layer.id)) stack.remove(layer.id) })
  return stack
}

/** 渲染一次锚点菜单，返回它压进栈的那一层（渲染前后栈的差集就是它）。 */
async function mountAnchor(closed) {
  const stack = stackOf()
  const before = new Set(stack.layers().map(layer => layer.id))
  await renderToString(createSSRApp({
    render: () => h(AnchorMenu, { anchor: 'bottom', x: 10, y: 20, onClose: () => closed.push('close') }),
  }))
  const added = stack.layers().filter(layer => !before.has(layer.id))
  assert.equal(added.length, 1, `一次挂载应该只压一层，实际压了 ${added.length} 层`)
  return added[0]
}

test('锚点菜单一挂载就压进全局弹层栈（不再自挂 window 监听抢同一次点击）', async t => {
  const stack = isolated(t)
  const depth = stack.layers().length
  const closed = []
  const layer = await mountAnchor(closed)
  assert.equal(stack.layers().length, depth + 1)
  // `isCancelOnClickOutside()`（`:130`）与 `canClose()`（`:141`）：普通菜单两个都为真。
  assert.equal(layer.cancelOnClickOutside, true, '锚点菜单声明了「点外面不收起」')
  assert.equal(layer.canClose, true)
  assert.equal(typeof layer.cancel, 'function', '栈没有可调用的 cancel ⇒ :153 那一步是空的')
})

test('Esc 只关最上面那一层，下面那层留着（:181-193 的 findPopup）', async t => {
  const stack = isolated(t)
  const first = []
  const second = []
  const layerA = await mountAnchor(first)
  const layerB = await mountAnchor(second)
  assert.equal(stack.closeRequest(), true, '栈上有层时 Esc 必须收下这次按键')
  assert.deepEqual(second, ['close'], 'Esc 关掉的应该是**最后打开**的那层')
  assert.deepEqual(first, [], '下层不该被同一次 Esc 带走')
  // 宿主把 v-if 落下来 ⇒ 组件卸载 ⇒ 出栈（这里代做，见文件头）。
  stack.remove(layerB.id)
  assert.equal(stack.layers().includes(layerB), false)
  assert.equal(stack.layers().some(layer => layer.id === layerA.id), true)
})

test('这一层的 cancel 就是组件自己的 close 事件（:153 的 popup.cancel）', async t => {
  const stack = isolated(t)
  const closed = []
  const layer = await mountAnchor(closed)
  layer.cancel()
  assert.deepEqual(closed, ['close'], '栈调用 cancel 时组件要真的把菜单收起来，而不是空转')
})

test('空栈时 Esc 放行给页面（:185 的 popup == null ⇒ return false）', t => {
  const stack = isolated(t)
  for (const layer of stack.layers()) stack.remove(layer.id)
  assert.equal(popupStackDepth(), 0)
  assert.equal(stack.closeRequest(), false)
  assert.equal(stack.closeRequest(), false, '连按两次也不该凭空造出一层')
})

// ── usePopupLayer 的契约：canClose 现问（组件侧唯一的入口） ──────────────────────────
let canCloseNow = true
const GuardedLayer = defineComponent({
  emits: ['cancel'],
  setup(_props, { emit }) {
    const box = ref(null)
    const shown = ref(true)
    usePopupLayer(box, shown, () => emit('cancel'), { canClose: () => canCloseNow })
    return () => h('div', { ref: box })
  },
})

test('canClose 是每次判定**现问**的，不是登记时的快照（:141 在遍历里现场调）', async t => {
  const stack = isolated(t)
  const cancelled = []
  await renderToString(createSSRApp({ render: () => h(GuardedLayer, { onCancel: () => cancelled.push('x') }) }))
  canCloseNow = false
  assert.equal(stack.closeRequest(), false, '这一层此刻不许关（有未提交的校验），Esc 不该把它带走')
  assert.deepEqual(cancelled, [])
  canCloseNow = true
  assert.equal(stack.closeRequest(), true, '放开闸之后同一次请求就该关掉它')
  assert.deepEqual(cancelled, ['x'])
})

// ── 两处消费点的形状判据（模板接线在 SSR 里点不出来，按本仓惯例查源码） ──────────────
test('内容下拉标签（COMBO 形态）也注册进同一条栈', () => {
  const combo = readFileSync(new URL('../src/components/ContentComboLabel.vue', import.meta.url), 'utf8')
  assert.ok(combo.includes("from '../popupStack.ts'"),
    '没有值 import（或漏了 .ts 扩展名）⇒ Node ESM 下整个组件加载失败')
  assert.match(combo, /usePopupLayer\(menu, open, \(\) => \{ open\.value = false \}/,
    '下拉列表打开时没压栈 / cancel 没收回自己的 open')
  assert.match(combo, /<div v-if="open" ref="menu" class="content-combo-menu"/,
    '栈要拿这一层的 DOM 根节点量矩形、判「焦点进了弹层」')
})

test('标签右键菜单也压进同一条栈（原先只有 backdrop，栈看不见它）', async t => {
  const stack = isolated(t)
  const closed = []
  const before = new Set(stack.layers().map(layer => layer.id))
  const ctx = {
    fileBookmarkLabel: () => '添加书签', tabLine: () => 0, workspaceRoot: () => 'D:/p', copy: () => {},
    canCloseOthers: () => false, canCloseRight: () => false, canCloseLeft: () => false, canCloseUnpinned: () => false,
    hasWorkspace: () => false, isDesktop: false, hasTab: () => false, splitOrientation: () => 'none',
    pinned: () => false, isPreview: () => false, languageChoices: [],
  }
  await renderToString(createSSRApp({
    render: () => h(TabContextMenu, { ctx, path: 'a.ts', pane: 0, x: 10, y: 20, onClose: () => closed.push('close') }),
  }))
  const added = stack.layers().filter(layer => !before.has(layer.id))
  assert.equal(added.length, 1, `标签菜单一次挂载该压一层，实际 ${added.length} 层`)
  // 栈顶收到这一层时走的正是宿主那条 close（`App.vue` 里 `@close="tabMenu = null"`）。
  added[0].cancel()
  assert.deepEqual(closed, ['close'], 'cancel 没回给宿主 ⇒ Esc 收了栈但菜单还挂着')
  // 外壳要把自己的根节点露出来：栈量矩形（`:116-164` 判落点）与判焦点（`:131`）都靠它。
  const shell = readFileSync(new URL('../src/components/AnchoredMenu.vue', import.meta.url), 'utf8')
  assert.match(shell, /defineExpose\(\{ box \}\)/, 'AnchoredMenu 没把浮层根节点露给宿主 ⇒ 注册进栈也量不到矩形')
  const menu = readFileSync(new URL('../src/components/TabContextMenu.vue', import.meta.url), 'utf8')
  assert.match(menu, /<AnchoredMenu ref="menu"/, '没有接住外壳露出来的那一层 DOM 根节点')
})

test('锚点菜单不再自己挂全局监听：一条链只该有一个所有者', () => {
  const menu = readFileSync(new URL('../src/components/ToolWindowAnchorMenu.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(menu, /window\.addEventListener/,
    '组件自挂监听 ⇒ 两层弹层抢同一次 pointerdown，点开上层时把下层一起关掉')
  assert.ok(menu.includes("from '../popupStack.ts'"), '锚点菜单没有接弹层栈')
})

// ── 两段式 Esc 的那个真实消费者：内容下拉的速度搜索 ────────────────────────────────
// 上游：`SelectContentStep.kt:17`（这一层列表**默认**开速度搜索）、
// `SpeedSearch.java:77-81`（压着过滤串时 Esc 只清串并吃掉按键）、
// `AbstractPopup.java:3003-3010`（没在过滤时才 cancel，同样吃掉按键）。
test('内容下拉把过滤串交给栈：holdingFilter 现问 + resetFilter 清串', () => {
  const combo = readFileSync(new URL('../src/components/ContentComboLabel.vue', import.meta.url), 'utf8')
  assert.match(combo, /holdingFilter: \(\) => filter\.value !== ''/,
    '没有把「正压着过滤串」交给栈 ⇒ 第一段永远走不到，一次 Esc 直接收掉列表')
  assert.match(combo, /resetFilter: \(\) => \{ filter\.value = '' \}/,
    '没有清串的那一步 ⇒ 栈只能空转（`SpeedSearch.updatePattern("")`，:79）')
  // 过滤串是**现场问**的，与上游同一条（`SpeedSearch.java:78` 就在按键分发里问）：登记成布尔就答不出。
  assert.doesNotMatch(combo, /holdingFilter: (true|false)/, 'holdingFilter 写成了登记值，不是现问的谓词')
  assert.match(combo, /<SpeedSearchBar :open="true" :query="filter"/,
    '列表里没有那根过滤输入框（`SpeedSearchPatternField`，`ListPopupImpl.java:938`）')
})

test('栈真的两段式：压着串第一次只清串，第二次才收起这一层（用真实组件的那两条回调）', () => {
  const stack = stackOf()
  let filter = 'out'
  let cancelled = 0
  const id = stack.push({
    bounds: null, cancelOnClickOutside: true, canClose: true,
    holdingFilter: false, holdingFilterNow: () => filter !== '',
    resetFilter: () => { filter = '' },
    cancel: () => { cancelled++; stack.remove(id) },
  })
  assert.equal(stack.closeRequest(), true, '清串那一次也算弹层吃掉了按键（:80 的 e.consume()）')
  assert.equal(filter, '')
  assert.equal(cancelled, 0, '第一次 Esc 不该取消弹层')
  assert.equal(stack.closeRequest(), true)
  assert.equal(cancelled, 1, '第二次才走 `AbstractPopup:3008` 的 cancel')
})

test('Esc 由弹层收走时把按键吃掉：源码里那条 consume 调用是本仓的 e.consume()（:126-131）', () => {
  const stackSource = readFileSync(new URL('../src/popupStack.ts', import.meta.url), 'utf8')
  assert.match(stackSource, /if \(api\.closeRequest\(\)\) event\.consume\(\)/,
    '处理了却没 consume ⇒ 页面自己那条 Esc 链在同一次按键里跟着执行，两段式塌成一段')
  assert.match(stackSource, /consume: \(\) => \{ event\.preventDefault\(\); event\.stopPropagation\(\) \}/,
    'consume 必须真的拦住 DOM 事件（捕获阶段 + preventDefault/stopPropagation）')
  assert.match(stackSource, /if \(event\.alreadyConsumed\) return/,
    '缺了 `SpeedSearch.java:58` 的 `e.isConsumed()` 那道闸')
})

// ── 另外两处"自己挂全局监听"的弹层：一并交给这条栈（2026-10-06）────────────────────
// 判据与上面锚点菜单那条同源：一条全局链只该有一个所有者。
// 齿轮菜单原先自挂 `pointerdown`(捕获) + `keydown`，与栈上那一份**同一次点击两个裁决者**；
// 标题栏菜单原先只有 DOM 局部的 `@keydown.esc.stop`，栈看不见它 ⇒ 它开着时
// `popupHasFocusWithin` 答"没进弹层"，auto-hide 的面板（`ToolWindowManagerLifecycle.kt:131`）当场收掉。
test('齿轮弹层交出它自挂的两条全局监听，改压同一条栈', () => {
  const gear = readFileSync(new URL('../src/components/ToolWindowGear.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(gear, /window\.addEventListener/,
    '齿轮还自挂全局监听 ⇒ 与栈抢同一次 pointerdown，一次点外面收掉两层')
  assert.doesNotMatch(gear, /onUnmounted/, '自挂监听的退订路径应当随监听一起消失')
  assert.ok(gear.includes("from '../popupStack.ts'"), '齿轮没有接弹层栈')
  assert.match(gear, /usePopupLayer\(menu, open, \(\) => \{ open\.value = false \}/,
    '齿轮没把开合交给栈（cancel 必须收回自己的 open，:153 的 popup.cancel）')
  assert.match(gear, /<div ref="menu" class="tool-menu tool-gear-menu"/,
    '栈量不到这一层的矩形，也判不出焦点进没进弹层')
})

test('标题栏菜单也压进同一条栈（它原先只有 DOM 局部 Esc）', () => {
  const header = readFileSync(new URL('../src/components/ToolWindowHeader.vue', import.meta.url), 'utf8')
  assert.ok(header.includes("import { usePopupLayer } from '../popupStack.ts'"),
    '标题栏菜单没有接弹层栈（值 import 漏 .ts ⇒ Node ESM 下整个组件加载失败）')
  // 这一层的开合是宿主的 prop（`menuOpen`），所以喂给栈的是它的只读投影，不是本地 ref。
  assert.match(header, /const menuShown = computed\(\(\) => props\.menuOpen\)/,
    '没有把宿主的开合状态投影给栈')
  assert.match(header, /usePopupLayer\(menu, menuShown, closeMenu/,
    '标题栏菜单没有压栈，或 cancel 没走宿主那条 closeMenu')
})
