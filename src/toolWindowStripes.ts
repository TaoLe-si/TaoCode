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
import {
  DEFAULT_PROJECT_FRAME_PROFILE, autoHideOf, contentUiTypeOf, floatingBoundsOf, hasExplicitVisibility, layoutMigrationKey,
  resolveProjectLayout, stripeButtonShown, toolWindowTypeOf, visibleWindowIds, windowInfoOf,
  type LegacyMachineLayout, type StoredProjectLayout, type ToolWindowType, type WindowInfo,
} from './toolLayoutProfiles.ts'
import { resolveContentUiType, type ToolWindowContentUiType } from './toolWindowContentUi.ts'
import { dockOf } from './toolWindowDocks.ts'
import { popupHasFocusWithin } from './popupStack.ts'
// 统一门面：本工厂是它的**唯一安装点**（`ToolWindowManager.kt:30` 的 `getInstance(project)` 同义）。
// `registerToolWindowId` 是门面那份注册表的运行期入口（上游 `ToolWindowManager.kt:99-108` 的
// `registerToolWindow`/`unregisterToolWindow` 那一对的本仓等价物）：底部那几格固定内容
// （output/run/problems/references/hierarchy/terminal）**不在出厂锚点表里**，
// 但上游它们各自就是工具窗口、一样有 `WindowInfo`（见下面 `extraContentIds` 那条注释），
// 所以从项目布局里读到就要登记，否则门面的 `getToolWindow('output')` 只在"开着"的那一刻答得出。
import { installToolWindowManager, registerToolWindowId, resetRegisteredToolWindowIds, toolWindowSplitDefault } from './toolWindowManager.ts'
// 条纹的「后半组」（`AbstractDroppableStripe.kt:57-72` 的比较器 + `StripeButtonSeparator` 那条分隔件）。
import { splitStripeButtonsLast } from './toolStripeSplit.ts'
import { applyViewMode, shouldHideOnFocusLoss, viewModeOf, type ViewMode, type WindowTypeState } from './toolWindowViewMode.ts'
// 侧条按钮的挂/摘配对契约 + 分栏比例的哨兵（上游 `ToolWindowEntry` / `ToolWindowPaneState`）。
import { attachStripeButton, detachStripeButton } from './toolWindowPaneState.ts'
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
/** 改版前的全局内容类型键（`src/toolWindowActions.ts` 曾自持它）——只读一次做采纳。 */
const LEGACY_CONTENT_UI_STORAGE_KEY = 'taocode.toolWindowContentUi'
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
  /** 「项目视图是否显示」—— 承载侧栏那条 dock 的 `isVisible`（换锚点时按可见性搬运，见 `setToolAnchor`）。 */
  explorer: Ref<boolean>
  /**
   * 当前显示的窗口（宿主的 `leftView`）。除了读它的**锚点**，还要按项目的
   * `WindowInfo.isVisible` 把它**写回**去（打开项目时恢复上次开着的那一个），所以是可写的。
   */
  activeView: { value: ToolWindowId }
  /**
   * 底部 dock 是否展开（宿主的 `bottom`）—— 它承担底部那几个内容的 `isVisible`。
   * 可选：不传就当作"底部一直没开"（单测夹具大多不关心这一侧）。
   */
  bottom?: Ref<boolean>
  /** 底部 dock 当前显示哪一格（宿主的 `bottomTab`）；恢复时也要写它。同上，可选。 */
  bottomTab?: Ref<string>
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
  /**
   * 常驻的**激活栈**（IDEA `ActiveStack.java:21-25` 那份"编辑区拿到焦点也不清"的持久栈，
   * 宿主 `App.vue` 的 `activeToolWindows`）。门面的 `lastActiveToolWindowId`
   * （`ToolWindowManager.kt:132`）读的就是它。
   * 可选 —— 宿主没给时门面答 `null`（上游同样是"栈空 = 什么都别做"，`JumpToLastWindowAction.java:32-44`
   * 那时把动作自己灰掉），不替宿主猜一个窗口。
   */
  activeStack?: { readonly value: readonly string[] }
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
  // 底部那一侧的两个状态（可选依赖 → 给个本地兜底，测试夹具不传也能跑）。
  const bottomRef: Ref<boolean> = deps.bottom ?? ref(false)
  const bottomTabRef: Ref<string> = deps.bottomTab ?? ref('')

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
    if (!layout.windows || typeof layout.windows !== 'object' || Array.isArray(layout.windows)) return null
    return { windows: layout.windows }
  }
  /**
   * 旧版的**机器级**布局 —— 改版前是三个键（锚点表 / 顺序表 / 隐藏集），顺序表还是
   * `{ side: [ids] }` 这个形状。只在迁移那一次被读，读完折成"每窗口一条记录"。
   */
  function readLegacyLayout(): LegacyMachineLayout | null {
    const anchors = readJson<Partial<Record<ToolWindowId, Anchor>>>(LEGACY_ANCHOR_STORAGE_KEY, {})
    const order = readJson<Partial<Record<Anchor, ToolWindowId[]>>>(LEGACY_ORDER_STORAGE_KEY, {})
    const hidden = readJson<ToolWindowId[]>(LEGACY_HIDDEN_STRIPE_STORAGE_KEY, [])
    const hasAnchors = anchors && typeof anchors === 'object' && Object.keys(anchors).length > 0
    const hasOrder = order && typeof order === 'object' && Object.keys(order).length > 0
    const hasHidden = Array.isArray(hidden) && hidden.length > 0
    if (!hasAnchors && !hasOrder && !hasHidden) return null
    const windows: Record<string, WindowInfo> = {}
    let rank = 0
    for (const side of ['left', 'right', 'bottom'] as const) {
      for (const id of Array.isArray(order?.[side]) ? order[side]! : []) {
        if (typeof id !== 'string' || !Object.hasOwn(toolAnchors, id)) continue
        windows[id] = { ...windows[id], order: rank++ }
      }
      rank = 0
    }
    for (const id of Object.keys(anchors ?? {}) as ToolWindowId[]) {
      const anchor = anchors?.[id]
      if (anchor === 'left' || anchor === 'right' || anchor === 'bottom') windows[id] = { ...windows[id], anchor }
    }
    for (const id of Array.isArray(hidden) ? hidden : []) {
      if (typeof id === 'string' && Object.hasOwn(toolAnchors, id)) windows[id] = { ...windows[id], showStripeButton: false }
    }
    return { windows }
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
   * 改版前内容类型是**一个全局键**（`taocode.toolWindowContentUi`）。它在上游没有对应物
   * （`WindowInfo.contentUiType` 一直是每窗口的），所以做一次性采纳：项目布局里**没写过**的内容
   * 继续按这个旧值走（等价于"这台机器上的默认"），用户一旦在某一个内容上点过「合并标签页」，
   * 那个内容就有了自己的显式值，此后各内容各管各的 —— 现状不变，也不把旧值硬盖到每个项目上。
   */
  function readLegacyContentUiType(): ToolWindowContentUiType | null {
    try {
      const raw = localStorage.getItem(LEGACY_CONTENT_UI_STORAGE_KEY)
      return raw === null ? null : resolveContentUiType(raw)
    } catch { return null }
  }
  const legacyContentUiType = readLegacyContentUiType()
  /**
   * 每个内容的 `WindowInfo.contentUiType`（`WindowInfoImpl` 默认 TABBED）。**存的是显式值**：
   * 项目布局里写过的那个；没写过的先按旧全局键（迁移）或默认走，不写进表里。
   */
  const contentUiTypes = reactive<Record<string, ToolWindowContentUiType>>({})
  /**
   * 记录里那些**不是工具窗口**的内容 id（底部那几格固定内容：output/run/problems/references/
   * hierarchy/terminal）。它们在上游各自就是工具窗口、一样有 `WindowInfo`，所以落盘时也要跟着写
   * `visible`/`contentUiType` —— 只是它们不在注册表里，得单独记一份。
   */
  const extraContentIds = new Set<string>()
  /**
   * 此刻开着的窗口/内容（上游每窗口一个 `isVisible`；本仓每侧只有一个）。
   * 它是**写入端的缓存**：宿主那两个状态一变就重算并落盘。
   */
  const visibleIds = ref<string[]>([])
  function refreshContentUiTypes(layout: StoredProjectLayout) {
    for (const key of Object.keys(contentUiTypes)) delete contentUiTypes[key]
    extraContentIds.clear()
    for (const [id, info] of Object.entries(layout.windows ?? {})) {
      if (info.contentUiType === 'tabbed' || info.contentUiType === 'combo') contentUiTypes[id] = info.contentUiType
      if (!Object.hasOwn(toolAnchors, id)) { extraContentIds.add(id); registerToolWindowId(id) }
    }
  }
  /** 某个内容此刻的内容条形态（上游 `ToolWindowImpl.kt:521` 读的就是 `windowInfo.contentUiType`）。 */
  function contentUiType(id: string): ToolWindowContentUiType {
    return resolveContentUiType(contentUiTypes[id] ?? legacyContentUiType ?? 'tabbed')
  }
  /** `ToggleContentUiTypeAction.setSelected` 的落地：改的是**这一个**内容的记录，并落盘。 */
  function setContentUiType(id: string, type: ToolWindowContentUiType) {
    contentUiTypes[id] = resolveContentUiType(type)
    saveLayout()
  }

  // --- 视图模式（`ToolWindowViewModeAction$ViewMode` = `WindowInfoImpl.type` + `isAutoHide`）------
  /**
   * 每个窗口的 (type, autoHide) 二元组。**存进项目布局的那条记录里**（上游就是把它们存在
   * `<window_info type="..." auto_hide="..."/>` 上：`WindowInfoImpl.kt:46-47`、`:74`），
   * 所以"这个窗口的视图模式"和"停在哪一侧"一样是**每工程**的状态。
   * 没写过的窗口 = 出厂默认 DOCKED + autoHide=false（同 `WindowInfoImpl` 的默认值）。
   */
  const windowTypes = reactive<Record<string, { type: ToolWindowType; autoHide: boolean }>>({})
  /** 读这一个窗口的视图模式状态（默认档不写进表，避免每条存档都拖一份全量）。 */
  function windowTypeState(id: string): { type: ToolWindowType; autoHide: boolean } {
    return windowTypes[id] ?? { type: 'docked', autoHide: false }
  }
  function viewModeOfId(id: string) { return viewModeOf(windowTypeState(id)) }
  /**
   * 选一档视图模式（`ToolWindowViewModeAction.setSelected`，`:127-135`：已经是这一档就什么都不做）。
   * 上游 `setToolWindowType`（`ToolWindowManagerImpl.kt:1759-1769`）与 `setToolWindowAutoHide`
   * （`:1742-1757`）两条都带"同值直接 return"的闸，这里同一条：值没变就不写盘、也不重开面板。
   */
  function setViewMode(id: string, mode: ViewMode): boolean {
    const next = applyViewMode(mode)
    const current = windowTypeState(id)
    if (current.type === next.type && current.autoHide === next.autoHide) return false
    windowTypes[id] = next
    saveLayout()
    // 上游改类型时会把面板按新类型重开一次并要焦点（`setToolWindowTypeImpl`，`:1785-1791`）：
    // 从浮形态改回停靠/dock 时若窗口还开着，要让它回到自己那一侧，否则"看不见却还占着可见状态"。
    if (visibleIds.value.includes(id) && next.type === 'docked') showAfterTypeChange(id)
    return true
  }
  /**
   * 改完类型后按**新**位置把它亮出来（`showView` 走 `activationTarget` ⇒ 只看锚点，不看种类）。
   * 宿主没传 `showView` 时（单测夹具）退化成"只保证那一侧的 dock 开着"。
   */
  function showAfterTypeChange(id: string) {
    const anchor = toolAnchors[id as ToolWindowId] ?? 'left'
    if (anchor === 'bottom') {
      bottomTabRef.value = id
      bottomRef.value = true
      return
    }
    deps.activeView.value = id as ToolWindowId
    deps.explorer.value = true
  }
  /**
   * **自动隐藏**（上游的 FOCUS_LOST 处理链，`ToolWindowManagerLifecycle.kt:55-138`）。
   * 本仓没有 AWT 事件队列，等价的事件是 document 上的 `focusin` —— 它的 `target` 就是上游
   * `FocusEvent.getOppositeComponent()` 的"真的拿到焦点的那个组件"（`:62` 排除的 temporary /
   * 不可见那两种情况在 DOM 里由 focusin 自己保证：焦点没落到任何元素上就不产生 focusin）。
   * 逐条判据在 `shouldHideOnFocusLoss`（纯函数，可单测），这里只负责把 DOM 翻译成它的输入。
   */
  function hideAutoHideWindowsOnFocusChange(focused: Element | null) {
    const dock = dockOf(focused)
    for (const id of visibleIds.value) {
      // 不在锚点表里的可见内容（output/run/problems/references/hierarchy/terminal）在上游
      // 各自也是一个工具窗口，默认就停在底部。
      const anchor = toolAnchors[id as ToolWindowId] ?? 'bottom'
      const shownInDock: 'side' | 'bottom' | null = anchor === 'bottom' ? 'bottom' : 'side'
      // 焦点还在**这一侧 dock** 里 ⇒ 该窗口没真的丢焦点（`:129-130` 的"焦点仍在同一工具窗口"）。
      // 注意用的是 dock 而不是 id：本仓一个 dock 同时只显示一个窗口，dock 就是那个窗口的容器。
      const stillInside = dock === shownInDock
      if (shouldHideOnFocusLoss({
        visible: true,
        state: windowTypeState(id),
        focusedWindowId: stillInside ? id : null,
        windowId: id,
        focusGoesToPopup: popupHasFocusWithin(focused),
        focusGoesToDialog: Boolean(focused?.closest('dialog, [role="dialog"], .modal-backdrop')),
      })) {
        if (shownInDock === 'bottom') bottomRef.value = false
        else deps.explorer.value = false
      }
    }
  }
  function onDocumentFocusIn(event: FocusEvent) {
    hideAutoHideWindowsOnFocusChange(event.target as Element | null)
  }
  /**
   * 「浮动」那一档下每个窗口的矩形（`WindowInfo.floatingBounds`，`WindowInfoImpl.kt:24/49-53`）。
   * 上游由浮层装饰器在拖动/缩放结束时写回（`saveFloatingOrWindowedState`，
   * `ToolWindowManagerLifecycle.kt:190-192`），本仓同样只记一份、按项目落盘。
   */
  const floatingBounds = reactive<Record<string, { x: number; y: number; width: number; height: number } | null>>({})
  function restoreFloatingBounds(layout: StoredProjectLayout) {
    for (const key of Object.keys(floatingBounds)) delete floatingBounds[key]
    for (const [id, info] of Object.entries(layout.windows ?? {})) {
      const bounds = floatingBoundsOf(info)
      if (bounds) floatingBounds[id] = bounds
    }
  }
  function floatingBoundsOfId(id: string) { return floatingBounds[id] ?? null }
  /** 拖动/缩放结束时记一次（写回项目布局，和 type/autoHide 同一条 `<window_info>`）。 */
  function setFloatingBounds(id: string, bounds: { x: number; y: number; width: number; height: number }) {
    floatingBounds[id] = bounds
    saveLayout()
  }

  /**
   * 把一套存档布局叠到出厂默认上（键级覆盖 + 顺序补齐）。锚点表里出现过的窗口一律留在
   * "出厂默认那一侧"或存档给的那一侧，之后 `normalizeOrder()` 会把每一侧补全。
   */
  function applyLayout(layout: StoredProjectLayout) {
    for (const id of Object.keys(toolAnchors) as ToolWindowId[]) {
      const anchor = windowInfoOf(layout, id).anchor
      toolAnchors[id] = anchor === 'left' || anchor === 'right' || anchor === 'bottom' ? anchor : DEFAULT_TOOL_ANCHORS[id]
    }
    // 顺序：先按记录里的 `order`（上游 `WindowInfoImpl.order`）排，没写过的保持注册表默认次序。
    toolOrder.value = {
      left: [...DEFAULT_TOOL_ORDER.left], right: [...DEFAULT_TOOL_ORDER.right], bottom: [...DEFAULT_TOOL_ORDER.bottom],
    }
    const ids = Object.keys(toolAnchors) as ToolWindowId[]
    for (const side of ['left', 'right', 'bottom'] as const) {
      const ranked = ids.filter(id => toolAnchors[id] === side && typeof windowInfoOf(layout, id).order === 'number')
      if (!ranked.length) continue
      ranked.sort((a, b) => (windowInfoOf(layout, a).order ?? 0) - (windowInfoOf(layout, b).order ?? 0))
      const rest = toolOrder.value[side].filter(id => !ranked.includes(id))
      toolOrder.value[side] = [...ranked, ...rest]
    }
    normalizeOrder()
    hiddenStripeButtons.clear()
    for (const id of Object.keys(toolAnchors) as ToolWindowId[])
      if (!stripeButtonShown(windowInfoOf(layout, id))) hiddenStripeButtons.add(id)
    // 门面那份注册表也一起换项目：上一条记录里登记的内容 id 不算这个项目注册过的
    //（`unregisterToolWindow`，`ToolWindowManager.kt:107-108` 的本仓等价物）。
    resetRegisteredToolWindowIds()
    refreshContentUiTypes(layout)
    // 视图模式（type/autoHide）跟着那条记录一起回来 —— 上游也是存在同一个 `<window_info>` 上。
    for (const key of Object.keys(windowTypes)) delete windowTypes[key]
    for (const [id, info] of Object.entries(layout.windows ?? {})) {
      if (info.type !== undefined || info.autoHide !== undefined)
        windowTypes[id] = { type: toolWindowTypeOf(info), autoHide: autoHideOf(info) }
    }
    // 后半组那一位同样躺在 `<window_info>` 上（上游 `side_tool`）：先清空，只认显式写过的布尔值，
    // 没写过的回到注册表初值（EP `secondary`）。
    for (const key of Object.keys(windowSplit)) delete windowSplit[key]
    for (const [id, info] of Object.entries(layout.windows ?? {}))
      if (typeof info.split === 'boolean') windowSplit[id] = info.split
    restoreFloatingBounds(layout)
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
   * 旧版机器级布局的一次性迁移），**再按存档里的 `isVisible` 把上次开着的窗口放回去**。
   * 上游等价物是 `ToolWindowLayoutProfileProviderService.getProfile()`
   * + 项目打开时给窗口上种（`ToolWindowSetInitializer`）。
   */
  function applyProjectLayout(root: string | null) {
    layoutRoot.value = root
    if (!root) {
      // 没打开项目时工作台根本不渲染（WelcomePage 那一支），布局保持出厂默认即可。
      applyLayout({ windows: {} })
      return
    }
    const resolved = resolveProjectLayout({
      stored: readStoredLayout(root),
      appliedVersion: appliedLayoutVersion(DEFAULT_PROJECT_FRAME_PROFILE.id),
      legacy: { layout: readLegacyLayout(), alreadyMigrated: layoutMigrated() },
    })
    applyLayout(resolved.layout)
    // 恢复"上次开着的那几个窗口"：**只有存档显式写过 `visible`** 才动宿主的默认
    // （新项目/刚播种的没有这一栏，别去覆盖"宽窗口默认开项目视图"那种现状）。
    if (hasExplicitVisibility(resolved.layout)) restoreVisibility(resolved.layout)
    if (resolved.persist) saveLayout()
    if (resolved.migrated) markLayoutMigrated()
    if (resolved.writeAppliedVersion !== null) markAppliedLayoutVersion(DEFAULT_PROJECT_FRAME_PROFILE.id, resolved.writeAppliedVersion)
  }

  /**
   * 上游 `ToolWindowSetInitializer` 装配时做的事：把存档里 `isVisible = true` 的窗口展开。
   * 本仓每个 dock 同时只显示一个窗口（`leftView` / `bottomTab`），所以"可见的那个"就是选中的那个；
   * 那一侧一个都没有 ⇒ 那一侧收起（上游同样按 `isVisible` 决定 dock 显不显示）。
   */
  function restoreVisibility(layout: StoredProjectLayout) {
    const visible = visibleWindowIds(layout)
    const side = visible.find(id => Object.hasOwn(toolAnchors, id) && toolAnchors[id as ToolWindowId] !== 'bottom')
    if (side) {
      deps.activeView.value = side as ToolWindowId
      deps.explorer.value = true
    } else {
      deps.explorer.value = false
    }
    // 底部那一侧：可见的内容可能是固定的底部标签（output/run/problems/…）也可能是停靠在底部的工具窗口。
    const bottom = visible.find(id => !Object.hasOwn(toolAnchors, id) || toolAnchors[id as ToolWindowId] === 'bottom')
    if (bottom) {
      bottomTabRef.value = bottom
      bottomRef.value = true
    } else {
      bottomRef.value = false
    }
  }

  /**
   * 把"现在哪些窗口开着"写回记录（上游 `ToolWindowImpl.show()/hide()` 改的就是 `windowInfo.isVisible`）。
   * 每侧只可能有一个可见窗口：侧栏是 `leftView`，底部是 `bottomTab`。
   */
  function currentVisibleIds(): string[] {
    const ids: string[] = []
    if (deps.explorer.value) ids.push(String(deps.activeView.value))
    if (bottomRef.value && bottomTabRef.value) ids.push(String(bottomTabRef.value))
    return ids
  }
  function saveVisibility() {
    if (!layoutRoot.value) return
    visibleIds.value = currentVisibleIds()
    saveLayout()
  }

  /**
   * 视图模式往那条记录里写的那几栏。**只写与默认不同的**（上游同一条规矩：
   * `WindowInfoImpl.kt:44/47/74/95` 的属性都带 `skipIfEquals` 式的默认值谓词，
   * `ToolWindowManagerState.kt:86-87` 更是显式"只有不是 LEFT 才写"）。
   * 这样旧存档 / 新项目读出来仍然是"没写过 = DOCKED + 不自动隐藏"，加字段也不会把
   * 用户现有布局判成损坏。
   */
  function windowTypePatch(id: string): WindowInfo {
    const stored = windowTypes[id]
    if (!stored) return floatingBounds[id] ? { floatingBounds: floatingBounds[id] } : {}
    const patch: WindowInfo = {}
    if (stored.type !== 'docked') patch.type = stored.type
    if (stored.autoHide) patch.autoHide = true
    if (floatingBounds[id]) patch.floatingBounds = floatingBounds[id]
    return patch
  }
  /**
   * 当前项目的整套布局落盘：**每窗口一条记录**（上游 `ToolWindowManagerState` 存的就是一串
   * `<window_info>`）。三张运行时表由这些记录派生 —— 写回时把当前值原样折回去，外加已存的
   * `contentUiType`（那是直接躺在项目布局里的，见 `setContentUiType`）。
   */
  function saveLayout() {
    const root = layoutRoot.value
    if (!root) return
    const windows: Record<string, WindowInfo> = {}
    for (const id of Object.keys(toolAnchors) as ToolWindowId[]) {
      const side = toolAnchors[id]
      const rank = toolOrder.value[side].indexOf(id)
      windows[id] = {
        anchor: side,
        order: rank >= 0 ? rank : undefined,
        showStripeButton: !hiddenStripeButtons.has(id),
        contentUiType: contentUiTypes[id],
        visible: visibleIds.value.includes(id),
        // 后半组那一位只在**用户拖过**（与注册表初值不同）时写（`WindowInfoImpl` 的默认值谓词同一条规矩）。
        split: splitPatch(id),
        ...windowTypePatch(id),
      }
    }
    // 内容条形态与可见性的键不止工具窗口：底部那几格固定内容（output/run/problems/…）也各有这两种
    // 状态（上游它们各自就是工具窗口，WindowInfo 里一样有 `contentUiType`/`isVisible`），单独并进来。
    for (const id of new Set([...extraContentIds, ...Object.keys(contentUiTypes), ...visibleIds.value, ...Object.keys(windowTypes)])) {
      if (Object.hasOwn(toolAnchors, id)) continue
      windows[id] = {
        ...(windows[id] ?? {}),
        ...(contentUiTypes[id] ? { contentUiType: contentUiTypes[id] } : {}),
        visible: visibleIds.value.includes(id),
        ...windowTypePatch(id),
      }
    }
    writeJson(projectLayoutKey(root), { windows } satisfies StoredProjectLayout)
  }
  function saveToolAnchors() { saveLayout() }
  /**
   * 换锚点的唯一入口（标题栏「移动到…」、条纹拖放、底部 dock 的锚点菜单都走这里）。
   *
   * 可见性是**搬着走**的，上游 `hideIfNeededAndShowAfterTask`（`ToolWindowManagerImpl.kt:1700-1726`）
   * 就是这条规则的原文：搬之前先记下窗口是不是开着（`:1706` `wasVisible = …isVisible`），
   * 先收起来（`:1708-1710`），搬（`:1712`），搬完若原来开着就**在新位置重新显示**
   * （`:1714-1719` `info.isVisible = true` + `doShowWindow`）。搬动不改变"开着还是收着"。
   *
   * 本仓两条 dock 各自的可见窗口只有一个（`currentVisibleIds`：侧栏是 `leftView`，底部是 `bottomTab`），
   * 照抄时有一处**形态差异**必须说清楚：底部 dock 的条纹（那排标签）长在 dock **里面**
   * （`App.vue` 的 `v-if="bottom"`），侧栏条纹则一直可见。所以搬到底部要**一定**把 dock 打开并选中它
   * —— 否则新位置根本没有入口（这也是 `src/toolWindowActions.ts` 的 `moveAnchorTo` 早就跟着 `showView` 的原因）；
   * 搬去左/右侧则按上游：原来开着才跟着亮，原来收着就还收着。
   */
  function setToolAnchor(id: ToolWindowId, anchor: Anchor) {
    const wasVisible = currentVisibleIds().includes(id)
    toolAnchors[id] = anchor
    for (const side of ['left', 'right', 'bottom'] as const) {
      if (side !== anchor) toolOrder.value[side] = toolOrder.value[side].filter(item => item !== id)
    }
    if (!toolOrder.value[anchor].includes(id)) toolOrder.value[anchor].push(id)
    if (anchor === 'bottom') {
      bottomRef.value = true
      bottomTabRef.value = id
    } else if (wasVisible) {
      deps.explorer.value = true
      deps.activeView.value = id
    }
    saveToolAnchors()
    saveToolOrder()
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
    // 挂/摘**严格配对**（上游 `ToolWindowEntry.stripeButton` 的 setter 断言，`ToolWindowEntry.kt:38-45`）：
    // 重复移除同一个按钮不写盘也不重复通知 —— 契约在 `detachStripeButton` 里，可单测。
    if (!detachStripeButton(hiddenStripeButtons.has(id) ? null : id).ok) return
    hiddenStripeButtons.add(id)
    saveHiddenStripeButtons()
  }
  /**
   * 复原：上游 `showToolWindowImpl` 里 `toBeShownInfo.isShowStripeButton = true`
   * （`ToolWindowManagerImpl.kt:942`）—— 也就是**激活该窗口**（View 菜单 / 快捷键 / 任一条激活路径）
   * 就会把按钮放回侧条。本仓把这个动作放在 `activateToolWindow` 里。
   */
  function restoreStripeButton(id: ToolWindowId) {
    // 同一条配对契约的另一半：当前**已挂**（不在隐藏集里）就不能再挂一次。
    // `hiddenStripeButtons` 是"按钮不在侧条上"的集合，所以这里的 current 恰好是它的取反。
    if (!attachStripeButton(hiddenStripeButtons.has(id) ? null : id, id).ok) return
    hiddenStripeButtons.delete(id)
    saveHiddenStripeButtons()
  }
  // 门面本体那份查询：`isSplit` 现在有了真来源（下面 `windowSplit` 那张表 + 注册表初值），
  // 不再是只有 EP 那一位（原写「布局存过则优先」但没有存的地方，见报告 §6-2 的留痕）。
  /**
   * `WindowInfo.isSplit`（`WindowInfoImpl.kt:91-92`，XML 属性名 `side_tool`）里**用户拖出来的那一部分**。
   * 存档没写过的窗口回到注册表初值 —— EP 的 `secondary` → `sideTool`（`DesktopLayout.kt:46`），
   * 读法就是门面那条 `toolWindowSplitDefault`。
   * 它是"条纹上的后半组"那一条分组规则的开关（`AbstractDroppableStripe.kt:57-72`）。
   */
  const windowSplit = reactive<Record<string, boolean>>({})
  function isSplitOf(id: ToolWindowId): boolean {
    const stored = windowSplit[id]
    return stored === undefined ? toolWindowSplitDefault(id) ?? false : stored
  }
  /**
   * 落点改变后半组身份（上游 `finishDrop` → `setSideToolAndAnchor(..., isSplit)`，
   * `AbstractDroppableStripe.kt:250-256`）。值没变返回 false 且不写盘。
   */
  function setSideTool(id: ToolWindowId, split: boolean): boolean {
    if (isSplitOf(id) === split) return false
    windowSplit[id] = split
    saveLayout()
    return true
  }
  /**
   * 存档只写**与注册表初值不同**的那一档（同 `windowTypePatch` 的纪律：
   * `WindowInfoImpl.kt:91-92` 的默认值是 false，`side_tool` 只在为 true 时才出现在 `<window_info>` 上）。
   * 旧存档没有这一栏 ⇒ 读出来是 `undefined` = 回到 EP 初值，不参与"布局损坏"判定。
   */
  function splitPatch(id: ToolWindowId): boolean | undefined {
    const stored = windowSplit[id]
    return stored === undefined || stored === (toolWindowSplitDefault(id) ?? false) ? undefined : stored
  }
  const stripeOrder = computed(() => (side: Anchor) => {
    const ids = toolOrder.value[side].filter(id => (toolAnchors[id] ?? 'left') === side && !hiddenStripeButtons.has(id))
    // 「side buttons in the end」（`AbstractDroppableStripe.kt:59-62`）：同一条侧条里后半组排在前面那组之后。
    // 底部那一排不套 —— 它是内容标签（`TabbedPaneContentUI`），不是 `StripeV2(BOTTOM)` 那条方形按钮条纹；
    // 上游同处的反向序那一支（`:63-67`）也因此不参与。理由写在 `src/toolStripeSplit.ts` 文件头。
    return side === 'bottom' ? ids : splitStripeButtonsLast(ids, isSplitOf)
  })

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

  /**
   * 命名布局（`ToolWindowDefaultLayoutManager`）存取快照时的两个"每窗口"字段：
   * `isShowStripeButton` 与 `contentUiType`。恢复布局 = 把这两个也写回去，所以这里给出
   * 一次性原子替换（`ToolWindowManagerImpl.setLayout` 也是直接改 `WindowInfo`，
   * 不走 `RemoveStripeButtonAction`/`ToggleContentUiTypeAction` 的单窗口路径）。
   */
  function explicitContentUiTypes(): Record<string, ToolWindowContentUiType> {
    const out: Record<string, ToolWindowContentUiType> = {}
    for (const [id, type] of Object.entries(contentUiTypes)) out[id] = resolveContentUiType(type)
    return out
  }
  /** 替换整张显式形态表（快照是完整状态：没列出的内容回到"没显式设过"）。 */
  function applyContentUiTypes(types: Record<string, ToolWindowContentUiType>) {
    for (const key of Object.keys(contentUiTypes)) delete contentUiTypes[key]
    for (const [id, type] of Object.entries(types)) contentUiTypes[id] = resolveContentUiType(type)
    saveLayout()
  }
  /** 按快照设置侧条按钮的显隐（列进 `hidden` 的摘掉，其余挂回）；只写一次盘。 */
  function applyStripeButtons(hidden: readonly string[]) {
    const want = new Set(hidden.filter(id => Object.hasOwn(toolAnchors, id)))
    for (const id of Object.keys(toolAnchors) as ToolWindowId[]) {
      if (want.has(id)) hiddenStripeButtons.add(id)
      else hiddenStripeButtons.delete(id)
    }
    saveHiddenStripeButtons()
  }

  // 建模块时按**当前项目**装配一次（`workspace` 在宿主里声明得比这里早，所以读它是安全的；
  // `lspReady` / `gradleAvailable` 那类更晚声明的只在函数体里用，不走这条路）。
  applyProjectLayout(deps.workspace.value?.root ?? null)
  // 换项目 = 换一套布局（上游：项目的 workspace 里存着它自己的 WindowInfo）。
  watch(() => deps.workspace.value?.root ?? null, root => applyProjectLayout(root))
  // 展开/收起与"显示哪一格"都是 `WindowInfo.isVisible` 的写入点（上游 `show()/hide()` 做同一件事）。
  // 这一条 watch 的源读的是宿主里声明在本模块**之前**的那几个 ref（`explorer`/`bottom`/`bottomTab`/
  // `leftView`）—— 非 immediate 的 watch 建时会求值一次，晚了会撞 TDZ，所以宿主那边把它们挪到了前面。
  watch([deps.explorer, bottomRef, () => bottomTabRef.value, () => deps.activeView.value], () => saveVisibility())

  // 自动隐藏的焦点监听：浏览器里才装（SSR/Node 下没有 document）。
  // 上游挂在 AWT 事件队列上（`ToolWindowManagerLifecycle.kt:167-168`），本仓的等价物是
  // document 上的 focusin（冒上来的"谁拿到了焦点"= 上游 FOCUS_LOST 的 oppositeComponent）。
  if (typeof document !== 'undefined') document.addEventListener('focusin', onDocumentFocusIn)

  activeLayoutState = {
    hiddenStripeButtons, explicitContentUiTypes, applyContentUiTypes, applyStripeButtons,
    windowTypeState, viewModeOfId, setViewMode, floatingBoundsOfId, setFloatingBounds,
  }

  // 统一门面（`ToolWindowManager.kt:120-144` + `ToolWindowManagerEx.kt:19-50` + `WindowInfo.kt:9-50`）：
  // 把散在本工厂闭包里的七八个 getter 收成一个可查询的聚合对象，组件读一次就够
  // （`src/toolWindowManager.ts`；消费方 `src/components/ToolWindowHeader.vue` 的视图模式那一组）。
  // 一个进程一份窗口状态，所以后建的实例覆盖先建的（与上面 `activeLayoutState` 同一条纪律）。
  installToolWindowManager({
    // 门面的查询面按 `string` 收 id（底部那几格内容不在出厂 id 联合里，见上面 `registerToolWindowId`
    // 那条注释），本工厂的窄类型在这里按调用点各收一次口。
    anchorOf: id => anchorOf(id as ToolWindowId),
    idsOn: side => toolOrder.value[side].filter(id => (toolAnchors[id as ToolWindowId] ?? 'left') === side),
    visibleIds: () => visibleIds.value,
    stripeButtonHidden: id => hiddenStripeButtons.has(id as ToolWindowId),
    contentUiType,
    // 侧条宽度是**按侧**的（`src/stripeResize.ts`），底部那一格没有宽度这一位。
    stripeWidth: id => (anchorOf(id as ToolWindowId) === 'bottom' ? 0 : stripeWidth(anchorOf(id as ToolWindowId) as StripeSide)),
    typeState: windowTypeState,
    viewModeOf: viewModeOfId,
    floatingBoundsOf: floatingBoundsOfId,
    toolDisabled: id => toolDisabled(id as ToolWindowId),
    setViewMode,
    // `WindowInfo.isSplit` 的真来源（上面那张 `windowSplit` + 注册表初值）—— 门面那条
    // 「布局存过则优先，否则退回 EP `secondary`」的判据到这里才真的有两档。
    isSplit: id => isSplitOf(id as ToolWindowId),
    // `isEditorComponentActive`（`ToolWindowManager.kt:112-115`）上游问的是**焦点主人**
    //（`ToolWindowManagerState.kt:52-55` 的 `getParentOfType(EditorsSplitters, focusOwner) != null`），
    // 与"有没有窗口开着"无关。本仓的同一问法就是那张 dock 选择器表（`src/toolWindowDocks.ts`）：
    // 焦点主人不在侧栏也不在底部 ⇒ 在编辑器。没有 DOM（SSR / 单测）时返回 undefined，
    // 门面退回它原来那条保守近似，不假装答得出。
    editorComponentActive: () => (typeof document === 'undefined' ? undefined
      : dockOf(document.activeElement) === 'editor'),
    // `lastActiveToolWindowId`（`ToolWindowManager.kt:132`）的那一份真相住在宿主（激活的 push/hide
    // 都发生在宿主的 `recordActiveToolWindow` 里，`appToolWindowActivation.ts:57-66`），
    // 所以这里只做转发：宿主给了 `activeStack` 才接，没给就不接（门面答 null，不自己记第二份账）。
    activationStack: deps.activeStack ? () => deps.activeStack?.value ?? [] : undefined,
  })

  return { toolAnchors, activeAnchor, setToolAnchor, saveToolAnchors, toolOrder, saveToolOrder, stripeOrder, hiddenStripeButtons,
           isSplitOf, setSideTool,
           removeStripeButton, restoreStripeButton, toolDisabled, bottomAnchoredIds, activationTarget, anchorOf,
           stripeWidths, stripeWidth, setStripeWidth, applyShowNamesWidths, moreButtonSide, moveMoreButtonTo, moreButtonRows,
           moreButtonAvailable, moreButtonVisible, contentUiType, setContentUiType, explicitContentUiTypes,
           applyContentUiTypes, applyStripeButtons,
           windowTypeState, viewModeOfId, setViewMode, floatingBoundsOfId, setFloatingBounds,
           hideAutoHideWindowsOnFocusChange,
           visibleIds, saveVisibility }
}

/**
 * 活着的工具窗口状态实例（同 `macroHost` 的 `activeSession` 手法）：命名布局的拍快照/恢复
 * （`src/toolLayouts.ts`）要读「摘掉的按钮」与「显式设过的标签形态」，这两项住在工厂闭包里，
 * 宿主又不给 `createToolLayouts` 传它们（那是另一个域的依赖表），所以这里留一个同性质的指针。
 * 一个进程只有一份窗口状态；测试里后建的实例覆盖先建的。
 */
export interface ToolWindowLayoutState {
  /** `WindowInfo.isShowStripeButton === false` 的那些窗口。 */
  hiddenStripeButtons: ReadonlySet<string>
  /** 显式设过 `contentUiType` 的内容 → 形态（含底部固定内容；没设过的不出现）。 */
  explicitContentUiTypes: () => Record<string, ToolWindowContentUiType>
  /** 用一份快照替换整张显式形态表。 */
  applyContentUiTypes: (types: Record<string, ToolWindowContentUiType>) => void
  /** 用一份快照替换侧条按钮的显隐集。 */
  applyStripeButtons: (hidden: readonly string[]) => void
  /** 某个窗口此刻的视图模式状态（`WindowInfoImpl.type` + `isAutoHide`）。 */
  windowTypeState: (id: string) => WindowTypeState
  /** 某个窗口此刻是哪一个视图模式（`ViewMode.fromWindowInfo`）。 */
  viewModeOfId: (id: string) => ViewMode
  /** 选一档（`ToolWindowViewModeAction.setSelected`）；值没变返回 false（上游同值直接 return）。 */
  setViewMode: (id: string, mode: ViewMode) => boolean
  /** 「浮动」那一档记住的矩形（`WindowInfo.floatingBounds`）；没存过 = null。 */
  floatingBoundsOfId: (id: string) => { x: number; y: number; width: number; height: number } | null
  /** 记一次浮层矩形（拖动/缩放结束时）。 */
  setFloatingBounds: (id: string, bounds: { x: number; y: number; width: number; height: number }) => void
}
let activeLayoutState: ToolWindowLayoutState | null = null
export function activeToolWindowLayoutState(): ToolWindowLayoutState | null { return activeLayoutState }
