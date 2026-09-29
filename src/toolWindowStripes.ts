// 工具窗口停靠条的状态（IDEA `ToolWindowAnchor` / `AbstractDroppableStripe` 的对应物）——
// 从 App.vue 搬出的一域（2026-09-27 加 Gradle 工具窗口时 App.vue 顶到了机检上限，顺手拆出来）。
//
// 判据：这一族只回答一句话 ——「每个工具窗口停在哪一侧、那一侧的按钮按什么顺序排、现在能不能打开」。
// 与内容无关（内容在 ToolWindowView.vue），与"当前激活哪个窗口"也无关（那是宿主的 `leftView`）。
//
// 状态自持（锚点表 + 顺序表 + 两份 localStorage 镜像），宿主只 import 同名变量，模板零改动 ——
// 与 src/statusWidgets.ts、src/progressPanel.ts 同一个"状态模块"模式。
import { computed, reactive, ref, watch, type Ref } from 'vue'
import { DEFAULT_TOOL_ANCHORS, DEFAULT_TOOL_ORDER, shouldBeAvailable, toolWindowMnemonic, type ToolWindowId } from './toolWindowMeta.ts'
import { DEFAULT_PROJECT_FRAME_PROFILE, layoutMigrationKey, resolveProjectLayout, type LegacyMachineLayout, type StoredProjectLayout } from './toolLayoutProfiles.ts'
import { STRIPE_NAMES_DEFAULT_WIDTH, clampStripeWidth, stripeWidthsAfterShowNames, type StripeSide } from './stripeResize.ts'
import { sortedByMnemonicThenId } from './toolWindows.ts'
import type { Workspace } from './bridge'

/** IDEA 的 `ToolWindowAnchor`（TaoCode 只用 left/right/bottom）。 */
export type Anchor = 'left' | 'right' | 'bottom'

// 布局是**项目级**的（上游：当前布局存在项目的 workspace 里，`WindowManagerImpl` 的 WindowInfo 集合；
// 档案只负责"这个项目还没存过布局时给它种一套"，见 src/toolLayoutProfiles.ts）。
// 旧版的三个**机器级**键保留：改版后第一次打开项目时把它们迁进来一次（`FORCE_ONCE` 的语义），
// 之后新项目一律按档案播种 —— 不会把用户现有布局悄悄丢掉，也不会把它往每个项目上复制。
const LEGACY_ANCHOR_STORAGE_KEY = 'taocode.toolAnchors'
const LEGACY_ORDER_STORAGE_KEY = 'taocode.toolOrder'
const LEGACY_HIDDEN_STRIPE_STORAGE_KEY = 'taocode.hiddenStripeButtons'
const LAYOUT_MIGRATED_KEY = 'taocode.toolLayoutMigrated'
/** 项目级布局的键：`taocode.toolLayout:<root>`（一份里含 anchors/order/hidden/version）。 */
const projectLayoutKey = (root: string) => `taocode.toolLayout:${root}`

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
  /**
   * 紧凑模式（`UISettings.compactMode`）：侧条宽度的下限 33/40 由它决定（`ResizeStripeManager.kt:139`）。
   * 可选 —— 不传就是非紧凑。
   */
  compactMode?: { readonly value: boolean }
  /**
   * 「显示工具窗口名称」（`UISettings.showToolWindowsNames`）：它就是侧条能不能拖的那道闸
   * （2026.2 的 `ResizeStripeManager.Companion.isShowNames()`）。可选 —— 不传就是名称关。
   */
  showNames?: { readonly value: boolean }
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
  /** 当前布局属于哪个项目（null = 还没打开项目；档案馆与落盘都按它走）。 */
  const layoutRoot = ref<string | null>(null)

  function readJson<T>(key: string, fallback: T): T {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown
      return raw === null || raw === undefined ? fallback : raw as T
    } catch { return fallback }
  }
  function writeJson(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* session-only */ }
  }
  function readStoredLayout(root: string): StoredProjectLayout | null {
    const raw = readJson<unknown>(projectLayoutKey(root), null)
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
    const layout = raw as StoredProjectLayout
    return {
      anchors: layout.anchors && typeof layout.anchors === 'object' ? layout.anchors : {},
      order: layout.order && typeof layout.order === 'object' ? layout.order : {},
      hidden: Array.isArray(layout.hidden) ? layout.hidden.filter((id): id is ToolWindowId => typeof id === 'string') : [],
    }
  }
  /** 旧版机器级布局（三键）——只在迁移那一次被读。 */
  function readLegacyLayout(): LegacyMachineLayout | null {
    const anchors = readJson<Partial<Record<ToolWindowId, Anchor>>>(LEGACY_ANCHOR_STORAGE_KEY, {})
    const order = readJson<Partial<Record<Anchor, ToolWindowId[]>>>(LEGACY_ORDER_STORAGE_KEY, {})
    const hidden = readJson<ToolWindowId[]>(LEGACY_HIDDEN_STRIPE_STORAGE_KEY, [])
    const hasAnchors = anchors && typeof anchors === 'object' && Object.keys(anchors).length > 0
    const hasOrder = order && typeof order === 'object' && Object.keys(order).length > 0
    const hasHidden = Array.isArray(hidden) && hidden.length > 0
    if (!hasAnchors && !hasOrder && !hasHidden) return null
    return { anchors: hasAnchors ? anchors : {}, order: hasOrder ? order : {}, hidden: hasHidden ? hidden : [] }
  }
  function markLayoutMigrated() { try { localStorage.setItem(LAYOUT_MIGRATED_KEY, '1') } catch { /* session-only */ } }
  function layoutMigrated(): boolean { try { return localStorage.getItem(LAYOUT_MIGRATED_KEY) === '1' } catch { return false } }
  /** 该档案强推做到哪一版了（上游存在应用级 PropertiesComponent 里，`:13/57-63`）。 */
  function appliedLayoutVersion(profileId: string): number {
    const raw = readJson<unknown>(layoutMigrationKey(profileId), 0)
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  }
  function markAppliedLayoutVersion(profileId: string, version: number) {
    try { localStorage.setItem(layoutMigrationKey(profileId), String(version)) } catch { /* session-only */ }
  }

  /**
   * 把一套存档布局叠到出厂默认上（键级覆盖 + 顺序补齐）。锚点表里出现过的窗口一律留在
   * "出厂默认那一侧"或存档给的那一侧，之后 `normalizeOrder()` 会把每一侧补全。
   */
  function applyLayout(layout: StoredProjectLayout) {
    for (const id of Object.keys(toolAnchors) as ToolWindowId[]) {
      const anchor = layout.anchors?.[id]
      toolAnchors[id] = anchor === 'left' || anchor === 'right' || anchor === 'bottom' ? anchor : DEFAULT_TOOL_ANCHORS[id]
    }
    toolOrder.value = {
      left: [...DEFAULT_TOOL_ORDER.left], right: [...DEFAULT_TOOL_ORDER.right], bottom: [...DEFAULT_TOOL_ORDER.bottom],
    }
    for (const side of ['left', 'right', 'bottom'] as const) {
      const list = layout.order?.[side]
      if (Array.isArray(list))
        toolOrder.value[side] = list.filter((id): id is ToolWindowId => typeof id === 'string' && Object.hasOwn(toolAnchors, id))
    }
    normalizeOrder()
    hiddenStripeButtons.clear()
    for (const id of layout.hidden ?? [])
      if (Object.hasOwn(toolAnchors, id)) hiddenStripeButtons.add(id)
  }
  /** 锚点可能已保存而目标顺序缺失（旧版移动只写锚点）；每一侧都补齐自己的窗口。 */
  function normalizeOrder() {
    for (const side of ['left', 'right', 'bottom'] as const) {
      const list = [...new Set(toolOrder.value[side])].filter(id => toolAnchors[id] === side)
      const rest = (Object.keys(toolAnchors) as ToolWindowId[]).filter(id => toolAnchors[id] === side && !list.includes(id))
      toolOrder.value[side] = [...list, ...rest]
    }
  }

  /**
   * 切到某个项目：读它的布局；没有就按**档案**播种（`resolveProjectLayout` 的两条应用模式 +
   * 旧版机器级布局的一次性迁移）。上游等价物是 `ToolWindowLayoutProfileProviderService.getProfile()`
   * + 项目打开时给窗口上种（`ToolWindowSetInitializer`）。
   */
  function applyProjectLayout(root: string | null) {
    layoutRoot.value = root
    if (!root) {
      // 没打开项目时工作台根本不渲染（WelcomePage 那一支），布局保持出厂默认即可。
      applyLayout({ anchors: {}, order: {}, hidden: [] })
      return
    }
    const resolved = resolveProjectLayout({
      stored: readStoredLayout(root),
      appliedVersion: appliedLayoutVersion(DEFAULT_PROJECT_FRAME_PROFILE.id),
      legacy: { layout: readLegacyLayout(), alreadyMigrated: layoutMigrated() },
    })
    applyLayout(resolved.layout)
    if (resolved.persist) saveLayout()
    if (resolved.migrated) markLayoutMigrated()
    if (resolved.writeAppliedVersion !== null) markAppliedLayoutVersion(DEFAULT_PROJECT_FRAME_PROFILE.id, resolved.writeAppliedVersion)
  }

  /** 当前项目的整套布局落盘（一个键，三张表 + 档案版本）。 */
  function saveLayout() {
    const root = layoutRoot.value
    if (!root) return
    writeJson(projectLayoutKey(root), {
      anchors: { ...toolAnchors },
      order: { ...toolOrder.value },
      hidden: [...hiddenStripeButtons],
    } satisfies StoredProjectLayout)
  }
  function saveToolAnchors() { saveLayout() }
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
  // (finishDrop -> setSideToolAndAnchor) or reordered in place. The order belongs to the
  // **project's** layout (upstream keeps it in the project's workspace file), so it
  // persists inside the same per-project layout record as the anchors.
  // 每个锚点**只列属于它的**窗口 —— 之前这里把 `vcslog/todo/debug` 列在 `left` 下、`bottom` 却是空的，
  // 而 `stripeOrder` 是 `toolOrder[side].filter(id => toolAnchors[id] === side)`，于是底部那条的顺序
  // 永远排不出来（只能靠兜底顺序），左侧那条还得每次过滤掉三个不属于它的项。默认值要和 `toolAnchors` 一致。
  const toolOrder = ref<Record<Anchor, ToolWindowId[]>>({
    left: [...DEFAULT_TOOL_ORDER.left], right: [...DEFAULT_TOOL_ORDER.right], bottom: [...DEFAULT_TOOL_ORDER.bottom],
  })
  function saveToolOrder() { saveLayout() }
  /**
   * 「从侧栏移除」的窗口（`RemoveStripeButtonAction`，`ToolWindowImpl.kt:914-925`）：
   * 执行的是 `hideToolWindow(id, removeFromStripe = true)` —— 面板收起**并且**按钮从侧条上摘掉
   * （`ToolWindowManagerImpl.kt:849-853` 的 `info.isShowStripeButton = false` + `entry.removeStripeButton()`）。
   * 这不是"隐藏"：隐藏只收面板，按钮还在（本仓的 `chromeHidden` / `explorer` 那条路）。
   * 与锚点/顺序一样是机器偏好，所以同样持久化。
   */
  // 隐藏集与锚点/顺序同属项目的布局（`isShowStripeButton` 就存在 WindowInfo 里），所以一起落盘。
  const hiddenStripeButtons = reactive(new Set<ToolWindowId>())
  function saveHiddenStripeButtons() { saveLayout() }
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

  // --- 侧条宽度（IDEA `ResizeStripeManager`）-----------------------------------------------------
  // 上游把两侧的宽度存在 `UISettings.toolWindowLeftSideCustomWidth` / `…RightSideCustomWidth` 里
  // （`ResizeStripeManager.kt:230-249` 的 `getSideCustomWidth` / `setSideCustomWidth`），
  // 与锚点/顺序一样是机器偏好，所以在同一处持久化。
  const WIDTH_STORAGE_KEY = 'taocode.stripeWidths'
  function readStoredWidth(side: StripeSide): number | undefined {
    try {
      const raw = JSON.parse(localStorage.getItem(WIDTH_STORAGE_KEY) ?? 'null') as unknown
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
      const value = (raw as Record<string, unknown>)[side]
      return typeof value === 'number' ? value : undefined
    } catch { /* 坏存档 → 按默认宽度 */ return undefined }
  }
  // 建模块时**只读存档**（不碰 `deps.compactMode` / `deps.showNames` —— 那两个要等设置域组装完，
  // 在宿主里声明得比本模块晚，这里读它们会撞 TDZ；实测过：非 immediate 的 `watch` 在创建时就会
  // 求值一次取 oldValue，所以连 watch 也不能挂在这一层）。折算与夹取都放到读的那一刻。
  const stripeWidths = reactive<Record<StripeSide, number>>({ left: readStoredWidth('left') ?? 0, right: readStoredWidth('right') ?? 0 })
  function saveStripeWidths() {
    try { localStorage.setItem(WIDTH_STORAGE_KEY, JSON.stringify(stripeWidths)) } catch { /* session-only */ }
  }
  /**
   * 这一侧此刻的宽度。**名称关着就是 0**，存档里的值不参与 —— 上游 `updateState`（`:89-102`）在
   * `isShowNames()` 为假时把 `myCustomWidth` 直接归零、连分隔线一起摘掉（存档值只在名称开着时读）。
   * 名称开着但还没存过宽度时按 `applyShowNames` 的默认值折算，否则轨道会被 CSS 兜底撑宽、
   * 而拖拽起点还是 0（两者不一致时，第一次拖动会跳一下）。
   */
  function stripeWidth(side: StripeSide): number {
    if (deps.showNames?.value !== true) return 0
    const stored = stripeWidths[side]
    if (!(stored > 0)) return STRIPE_NAMES_DEFAULT_WIDTH
    return clampStripeWidth(stored, deps.compactMode?.value === true)
  }
  /** 拖动一帧（`setSideCustomWidth`，`:240-253`）。 */
  function setStripeWidth(side: StripeSide, width: number) {
    stripeWidths[side] = clampStripeWidth(width, deps.compactMode?.value === true)
    saveStripeWidths()
  }
  /**
   * `applyShowNames()`（`:215-228`）：开关名称 = 把两侧宽度重置成默认（开）或 0（关）。
   * 由**宿主**在设置变化时调用（上游同样是设置页 `onApply` 与 `ToolWindowShowNamesAction` 触发，
   * 不是常驻监听）—— 本模块不挂 watch：那条 watch 会在建模块时就求值一次，而设置域还没组装完。
   * 启动时**不**调用它，否则用户拖出来的宽度每次重启都会被抹掉。
   */
  function applyShowNamesWidths(showNames: boolean) {
    const next = stripeWidthsAfterShowNames(showNames)
    stripeWidths.left = next.left
    stripeWidths.right = next.right
    saveStripeWidths()
  }

  // --- 「更多」按钮（IDEA `MoreSquareStripeButton` + `ShowMoreToolWindowsAction`）----------------
  // 上游把它放在「上条纹」之后（`ToolWindowToolbar.initMoreButton` 在非扩展形态下
  // `topStripe.parent.add(moreButton, BorderLayout.CENTER)`），点开的是**没有侧条按钮**的窗口列表
  // （`ToolWindowsGroup.getToolWindowActions(project, true)`，`ToolWindowsGroup.java:47-77`），
  // 右键是「移至<对侧>」那一条（`MoreSquareStripeButton.createPopupGroup:49-61`）。
  const MORE_BUTTON_STORAGE_KEY = 'taocode.moreButtonSide'
  /** `ToolWindowManagerState.kt:31/60`：默认 LEFT；`:86-87` 只在**不是 LEFT** 时才写进存档。 */
  const moreButtonSide = ref<StripeSide>(readMoreButtonSide())
  function readMoreButtonSide(): StripeSide {
    try { return localStorage.getItem(MORE_BUTTON_STORAGE_KEY) === 'right' ? 'right' : 'left' } catch { return 'left' }
  }
  function moveMoreButtonTo(side: StripeSide) {
    moreButtonSide.value = side
    try {
      // 上游序列化只记"与默认不同"的那一档（`ToolWindowManagerState.kt:86-87`）。
      if (side === 'left') localStorage.removeItem(MORE_BUTTON_STORAGE_KEY)
      else localStorage.setItem(MORE_BUTTON_STORAGE_KEY, side)
    } catch { /* session-only */ }
  }
  /**
   * 弹层的行 = 现在**没有侧条按钮**的可用窗口。
   * 上游的跳过规则是 `isShowStripeButton() && isAvailable() && isStripeButtonShow(window)`
   * （`ToolWindowsGroup.java:50-53`）—— "按钮在条纹上而且在"才跳过。本仓每个可用窗口都必有一条按钮，
   * 所以"没有按钮"只剩一种情况：被「从侧栏移除」（`RemoveStripeButtonAction`）摘掉了。
   * 不可用的窗口不进表（本仓不列假行，与状态栏那个弹层同一条规矩）。
   */
  const moreButtonRows = computed(() => sortedByMnemonicThenId(
    (Object.keys(toolAnchors) as ToolWindowId[]).filter(id => hiddenStripeButtons.has(id) && !toolDisabled(id)),
    toolWindowMnemonic))
  /** `AbstractMoreSquareStripeButton.isAvailable`（`MoreSquareStripeButton.kt:142`）：有行才有这个按钮。 */
  function moreButtonAvailable(): boolean { return moreButtonRows.value.length > 0 }
  /** `MoreSquareStripeButton.isAvailable`（`:78-80`）：还要这一侧的 `side` 等于 `getMoreButtonSide()`。 */
  function moreButtonVisible(side: StripeSide): boolean { return moreButtonSide.value === side && moreButtonAvailable() }
  // Which tool windows can be opened right now (IDEA disables an unavailable window
  // instead of hiding it, so the stripe keeps a stable layout).
  // 每条窗口的判据都住在**注册表**里（`ToolWindowFactory.shouldBeAvailable` 那一栏，
  // 见 src/toolWindowMeta.ts 里每条记录上方的出处）；这里只把当前的项目状态递进去。
  function toolDisabled(id: ToolWindowId): boolean {
    return !shouldBeAvailable(id, {
      isDesktop: deps.isDesktop,
      hasWorkspace: Boolean(deps.workspace.value),
      lspReady: deps.lspReady.value,
      gradleAvailable: deps.gradleAvailable.value,
    })
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

  // 建模块时按**当前项目**装配一次（`workspace` 在宿主里声明得比这里早，所以读它是安全的；
  // `lspReady` / `gradleAvailable` 那类更晚声明的只在函数体里用，不走这条路）。
  applyProjectLayout(deps.workspace.value?.root ?? null)
  // 换项目 = 换一套布局（上游：项目的 workspace 里存着它自己的 WindowInfo）。
  watch(() => deps.workspace.value?.root ?? null, root => applyProjectLayout(root))

  return { toolAnchors, activeAnchor, setToolAnchor, saveToolAnchors, toolOrder, saveToolOrder, stripeOrder, hiddenStripeButtons,
           removeStripeButton, restoreStripeButton, toolDisabled, bottomAnchoredIds, activationTarget, anchorOf,
           stripeWidths, stripeWidth, setStripeWidth, applyShowNamesWidths, moreButtonSide, moveMoreButtonTo, moreButtonRows,
           moreButtonAvailable, moreButtonVisible }
}
