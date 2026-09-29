// 工具窗口停靠条的状态（IDEA `ToolWindowAnchor` / `AbstractDroppableStripe` 的对应物）——
// 从 App.vue 搬出的一域（2026-09-27 加 Gradle 工具窗口时 App.vue 顶到了机检上限，顺手拆出来）。
//
// 判据：这一族只回答一句话 ——「每个工具窗口停在哪一侧、那一侧的按钮按什么顺序排、现在能不能打开」。
// 与内容无关（内容在 ToolWindowView.vue），与"当前激活哪个窗口"也无关（那是宿主的 `leftView`）。
//
// 状态自持（锚点表 + 顺序表 + 两份 localStorage 镜像），宿主只 import 同名变量，模板零改动 ——
// 与 src/statusWidgets.ts、src/progressPanel.ts 同一个"状态模块"模式。
import { computed, reactive, ref, type Ref } from 'vue'
import { DEFAULT_TOOL_ANCHORS, DEFAULT_TOOL_ORDER, type ToolWindowId } from './toolWindowMeta.ts'
import type { Workspace } from './bridge'

/** IDEA 的 `ToolWindowAnchor`（TaoCode 只用 left/right/bottom）。 */
export type Anchor = 'left' | 'right' | 'bottom'

const ANCHOR_STORAGE_KEY = 'taocode.toolAnchors'
const ORDER_STORAGE_KEY = 'taocode.toolOrder'
const HIDDEN_STRIPE_STORAGE_KEY = 'taocode.hiddenStripeButtons'

export interface ToolWindowStripesDeps {
  isDesktop: boolean
  /**
   * 项目是否打开（`vcslog` / `gradle` 的可用性）。
   * 只读视图：它在宿主里声明得比本模块早，但 `gradleAvailable` 这类要等其它域组装完才存在，
   * 所以调用方用惰性 getter 传（`{ get value() { return x.value } }`）。
   */
  workspace: { readonly value: Workspace | null }
  /** 语言服务是否就绪（结构视图的可用性）。同上，惰性传入。 */
  lspReady: { readonly value: boolean }
  /** 当前项目是不是 Gradle 项目（Gradle 工具窗口的可用性）。同上，惰性传入。 */
  gradleAvailable: { readonly value: boolean }
  /** 「项目视图是否显示」—— 把一个窗口挪到某一侧时要顺手打开它，否则窗口会看不见。 */
  explorer: Ref<boolean>
  /**
   * 当前激活的窗口（宿主的 `leftView`）。
   * 只读它的**锚点**（用于最大化/布局），所以注入只读视图就够。
   */
  activeView: { readonly value: ToolWindowId }
}

export function createToolWindowStripes(deps: ToolWindowStripesDeps) {
  // 默认停靠与顺序的唯一来源是 toolWindowMeta.ts 的 DEFAULT_TOOL_ANCHORS / DEFAULT_TOOL_ORDER
  //（对照 defaultToolWindowlayoutProvider.kt:244-281 的 V1/V2 默认布局）：
  //   left : Project(files) → Commit(git) → Structure(outline) → Bookmarks
  //   bottom: Version Control(vcslog) → Find(search) → TODO → Debug（+tests，已登记偏差）
  //   right : Gradle、Notifications
  //   Local History 在 IDEA 是弹窗而非工具窗口（ShowHistoryAction）：TaoCode 同款为 App.vue
  //   里的 LocalHistoryDialog，不再占用磁贴。
  const toolAnchors = reactive<Record<ToolWindowId, Anchor>>({ ...DEFAULT_TOOL_ANCHORS })
  try {
    const saved = JSON.parse(localStorage.getItem(ANCHOR_STORAGE_KEY) ?? '{}') as Partial<Record<ToolWindowId, Anchor>>
    for (const key of Object.keys(toolAnchors) as ToolWindowId[])
      if (saved[key] === 'left' || saved[key] === 'right' || saved[key] === 'bottom') toolAnchors[key] = saved[key]!
  } catch { /* corrupted state falls back to the anchors */ }
  function saveToolAnchors() {
    try { localStorage.setItem(ANCHOR_STORAGE_KEY, JSON.stringify(toolAnchors)) } catch { /* storage unavailable: kept for this session */ }
  }
  function setToolAnchor(id: ToolWindowId, anchor: Anchor) {
    toolAnchors[id] = anchor
    for (const side of ['left', 'right', 'bottom'] as const) {
      if (side !== anchor) toolOrder.value[side] = toolOrder.value[side].filter(item => item !== id)
    }
    if (!toolOrder.value[anchor].includes(id)) toolOrder.value[anchor].push(id)
    saveToolAnchors()
    saveToolOrder()
    // Moving to a side the panel is not shown on would leave it invisible.
    if (anchor !== 'bottom') deps.explorer.value = true
  }
  const activeAnchor = computed<Anchor>(() => toolAnchors[deps.activeView.value] ?? 'left')
  // IDEA's AbstractDroppableStripe lets a stripe button be dragged to another stripe
  // (finishDrop -> setSideToolAndAnchor) or reordered in place. The order is a machine
  // preference, so it persists next to the anchors.
  // 每个锚点**只列属于它的**窗口 —— 之前这里把 `vcslog/todo/debug` 列在 `left` 下、`bottom` 却是空的，
  // 而 `stripeOrder` 是 `toolOrder[side].filter(id => toolAnchors[id] === side)`，于是底部那条的顺序
  // 永远排不出来（只能靠兜底顺序），左侧那条还得每次过滤掉三个不属于它的项。默认值要和 `toolAnchors` 一致。
  const toolOrder = ref<Record<Anchor, ToolWindowId[]>>({
    left: [...DEFAULT_TOOL_ORDER.left], right: [...DEFAULT_TOOL_ORDER.right], bottom: [...DEFAULT_TOOL_ORDER.bottom],
  })
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) ?? 'null') as Partial<Record<Anchor, ToolWindowId[]>> | null
    if (saved) {
      for (const side of ['left', 'right', 'bottom'] as const) {
        const list = saved[side]
        if (Array.isArray(list))
          toolOrder.value[side] = list.filter((id): id is ToolWindowId => typeof id === 'string' && Object.hasOwn(toolAnchors, id))
      }
    }
  } catch { /* corrupted state falls back to the default order */ }
  // 锚点可能已保存而目标顺序缺失（旧版移动只写锚点）；每一侧都补齐自己的窗口。
  for (const side of ['left', 'right', 'bottom'] as const) {
    const list = [...new Set(toolOrder.value[side])].filter(id => toolAnchors[id] === side)
    const rest = (Object.keys(toolAnchors) as ToolWindowId[]).filter(id => toolAnchors[id] === side && !list.includes(id))
    toolOrder.value[side] = [...list, ...rest]
  }
  function saveToolOrder() {
    try { localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(toolOrder.value)) } catch { /* session-only */ }
  }
  /**
   * 「从侧栏移除」的窗口（`RemoveStripeButtonAction`，`ToolWindowImpl.kt:914-925`）：
   * 执行的是 `hideToolWindow(id, removeFromStripe = true)` —— 面板收起**并且**按钮从侧条上摘掉
   * （`ToolWindowManagerImpl.kt:849-853` 的 `info.isShowStripeButton = false` + `entry.removeStripeButton()`）。
   * 这不是"隐藏"：隐藏只收面板，按钮还在（本仓的 `chromeHidden` / `explorer` 那条路）。
   * 与锚点/顺序一样是机器偏好，所以同样持久化。
   */
  const hiddenStripeButtons = reactive(new Set<ToolWindowId>())
  try {
    const saved = JSON.parse(localStorage.getItem(HIDDEN_STRIPE_STORAGE_KEY) ?? '[]') as unknown
    if (Array.isArray(saved)) for (const id of saved)
      if (typeof id === 'string' && Object.hasOwn(toolAnchors, id)) hiddenStripeButtons.add(id as ToolWindowId)
  } catch { /* corrupted state falls back to "nothing was removed" */ }
  function saveHiddenStripeButtons() {
    try { localStorage.setItem(HIDDEN_STRIPE_STORAGE_KEY, JSON.stringify([...hiddenStripeButtons])) } catch { /* session-only */ }
  }
  /** `RemoveStripeButtonAction.actionPerformed`（`:923-925`）。 */
  function removeStripeButton(id: ToolWindowId) {
    hiddenStripeButtons.add(id)
    saveHiddenStripeButtons()
  }
  /**
   * 复原：上游 `showToolWindowImpl` 里 `toBeShownInfo.isShowStripeButton = true`
   * （`ToolWindowManagerImpl.kt:942`）—— 也就是**激活该窗口**（View 菜单 / 快捷键 / 任一条激活路径）
   * 就会把按钮放回侧条。本仓把这个动作放在 `activateToolWindow` 里。
   */
  function restoreStripeButton(id: ToolWindowId) {
    if (!hiddenStripeButtons.delete(id)) return
    saveHiddenStripeButtons()
  }
  const stripeOrder = computed(() => (side: Anchor) => toolOrder.value[side].filter(id => (toolAnchors[id] ?? 'left') === side && !hiddenStripeButtons.has(id)))
  // Which tool windows can be opened right now (IDEA disables an unavailable window
  // instead of hiding it, so the stripe keeps a stable layout).
  function toolDisabled(id: ToolWindowId): boolean {
    if (id === 'outline') return !deps.lspReady.value
    if (id === 'vcslog') return !deps.isDesktop || !deps.workspace.value
    // Gradle 窗口只在"项目确实是 Gradle 项目"时可用（IDEA 的 GradleToolWindowFactory
    // 在没有链接外部工程时给的是空态）。
    if (id === 'gradle') return !deps.isDesktop || !deps.workspace.value || !deps.gradleAvailable.value
    return false
  }
  // 「停靠在底部的工具窗口」（IDEA 的任意停靠）：底部 dock 的 tab 条与内容区都纳入它们。
  // 底部 dock 的那排 tab 也是"侧条按钮"的一种形态（`SquareStripeButton` 的底部版），
  // 所以"从侧栏移除"之后它同样不该出现在这里 —— 上游 `isShowStripeButton` 也管着这一处
  // （`ToolWindowsWidget.java:164`、`SwitcherRendering.kt:241` 都拿它当可见性判据）。
  const bottomAnchoredIds = computed<ToolWindowId[]>(() =>
    stripeOrder.value('bottom').filter(id => !toolDisabled(id)))
  /**
   * 点一个工具窗口入口时，它该去哪个 dock —— **只看锚点，不看窗口种类**。
   *
   * 这是「把项目树挪到底部后就再也切不回来」那个 bug 的修复点。宿主原来的
   * `activateToolWindow` 先写了 `files` / `outline` 两个专属分支再判断锚点：一旦这两个
   * 窗口被 Move to Bottom 搬走（`setToolAnchor` 同时把它们从左栏顺序里摘掉），左栏就没有
   * 它们的入口了，而点击路径又只操作 `leftView` / `explorer` —— 两侧都够不着，窗口失联。
   *
   * IDEA 的规则是 `ToolWindowManagerImpl.activateToolWindow` 一律按窗口**当前的**
   * `ToolWindowAnchor` 决定 dock，与窗口种类无关；这里照抄。宿主拿到返回值后照做即可，
   * 顺序由这个纯函数保证，不再依赖"谁写在前面"。
   */
  function activationTarget(id: ToolWindowId): { dock: 'bottom' | 'side'; anchor: Anchor } {
    const anchor = toolAnchors[id] ?? 'left'
    return { dock: anchor === 'bottom' ? 'bottom' : 'side', anchor }
  }
  // 该窗口当前的停靠边（`activeAnchor` 只回答"激活中的那个"，这里回答任意一个）。
  function anchorOf(id: ToolWindowId): Anchor { return toolAnchors[id] ?? 'left' }

  return { toolAnchors, activeAnchor, setToolAnchor, saveToolAnchors, toolOrder, saveToolOrder, stripeOrder, hiddenStripeButtons,
           removeStripeButton, restoreStripeButton, toolDisabled, bottomAnchoredIds, activationTarget, anchorOf }
}
