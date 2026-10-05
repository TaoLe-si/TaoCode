// 工具窗口的「视图模式」（IDEA `ToolWindowViewModeAction$ViewMode` + `ToolWindowType` + `autoHide`）。
//
// 判词里这一族的"还差"（docs/inventory/verdict-toolwindow-openapi.md）：
//   `ToolWindowType` —— 「只兑现 DOCKED」；`ToolWindowEx` —— 「`getAnchor`/`getType`/`setAutoHide`
//   的完整接口面」；`WindowInfo` —— 「每窗口聚合对象」；`SideStack` —— 「只在 auto-hide 下用，
//   本仓无 auto-hide」。上游的五个视图模式因此一直挂着（`docs/class-parity-todo.md:428`）。
//
// 上游事实（逐条对照参考树）：
//   · 四种窗口类型 `ToolWindowType.java:4-6`：DOCKED / FLOATING / SLIDING / WINDOWED；
//   · 五个视图模式 `ToolWindowViewModeAction.java:31-37`：DockPinned / DockUnpinned / Undock /
//     Float / Window，各自的动作 id 就是那五个 `*Mode`（注册在
//     `intellij.platform.ide.impl.actions.xml:677-681`，成组于 `:479` 的 `TW.ViewModeGroup`，
//     `popup="true"` ⇒ 是一个**子菜单**）；
//   · 「哪一个模式当前生效」= (type, autoHide) 二元组（`:48-57` 的 `isApplied`）：
//       DockPinned   = DOCKED  且 !autoHide
//       DockUnpinned = DOCKED  且 autoHide
//       Undock       = SLIDING（autoHide 不参与判断）
//       Float        = FLOATING
//       Window       = WINDOWED
//     反向读法 `fromWindowInfo`（`:59-66`）：DOCKED 时按 autoHide 分 DockPinned/DockUnpinned；
//   · 选中一项 = 先 `setType(...)` 再 `setAutoHide(mode == DockUnpinned || mode == Undock)`
//     （`:68-76`）—— 注意 **Undock 会自己把 autoHide 打开**，而 `isApplied` 却不看 autoHide，
//     这两条要一起抄，否则会以为"取消停靠后 autoHide 被清了"；
//   · 可用性与可见性：`update()` 是 `setEnabledAndVisible(getToolWindow(e) != null)`（`:138-141`）
//     ⇒ 只要有一个工具窗口在，这五条就都在（没有"按锚点筛掉某几档"这一说）；
//   · 类型改的是 `WindowInfoImpl.type`（默认 DOCKED，`WindowInfoImpl.kt:74`）与
//     `isAutoHide`（默认 false，`:46-47`，XML 属性名 `auto_hide`）；`setType` 落到
//     `ToolWindowManagerImpl.setToolWindowType`（`:1759-1797`，先摘装饰器再按新类型重开），
//     `setAutoHide` 落到 `:1742-1757`（同值直接 return，不等值才 applyWindowInfo + 广播）；
//   · **autoHide 到底干什么**（这条是用户可见行为的全部来源）：
//     `ToolWindowManagerLifecycle.kt:108-138` —— 收到 FOCUS_LOST 且
//     ① 有"真的拿到了焦点"的对方组件（`:62`：temporary / 不可见的都不算）、
//     ② 该窗口可见（`:112`）、③ `isAutoHide || type == SLIDING`（`:116`）、
//     ④ 它没"即将拿到焦点"（`:124`，切 sliding 窗口时编辑器会临时接焦点）、
//     ⑤ 焦点没留在**同一个**工具窗口里（`:129-130`）、
//     ⑥ 焦点没进弹层或模态对话框（`:131-133`）⇒ `deactivateToolWindow`（收掉）。
//
// 本仓的架构不等价怎么处理（桃 2026-10-05 指示：按用户可见行为在本仓做出来）：
//   · DOCKED + autoHide（停靠不固定）与 SLIDING（取消停靠）⇒ **焦点离开该 dock 就把面板收起**，
//     这条完全能做（本仓有 `focusedDock()` 那一族判据 + 弹层栈 `popupHasFocusWithin`），本模块落它；
//   · FLOATING / WINDOWED 要把面板从 dock 里挪到"浮层 / 独立帧"。浮层容器与 dock 的显隐都长在
//     `src/App.vue`（保留文件），独立帧还要宿主 C++ 开第二个 WebView2 窗口 ——
//     所以这两档**先按能力探测决定是否出现**：`document` 里有 `TOOL_WINDOW_OVERLAY_HOST_ID`
//     那个宿主容器才给「浮动」这一行（没有容器就渲染一行点了什么也不会发生的假控件）。
//     宿主接线见 docs/wiring-requests-2026-10-06-bucket8.md；「窗口(Window)」在任何形态下都要
//     第二个原生窗口，登记为具体卡点。
//   · 浮层的几何（可拖可缩、越界夹取、记住上次位置）在本模块的纯函数里，接线一到即可用。
import { pointInside, type Rect } from './popupPosition.ts'
import type { MenuRow } from './menus/types.ts'

/** `ToolWindowType.java:4-6`。 */
export type ToolWindowType = 'docked' | 'floating' | 'sliding' | 'windowed'

/** `ToolWindowViewModeAction.java:31-36` 的五个模式（顺序即菜单顺序）。 */
export type ViewMode = 'dockPinned' | 'dockUnpinned' | 'undock' | 'float' | 'window'

export const VIEW_MODES: readonly ViewMode[] = ['dockPinned', 'dockUnpinned', 'undock', 'float', 'window']

/** `ToolWindowViewModeAction.java:32-36` 括号里的动作 id（注册处 `intellij.platform.ide.impl.actions.xml:677-681`）。 */
export const VIEW_MODE_ACTION_IDS: Record<ViewMode, string> = {
  dockPinned: 'DockPinnedMode',
  dockUnpinned: 'DockUnpinnedMode',
  undock: 'UndockMode',
  float: 'FloatMode',
  window: 'WindowMode',
}

/**
 * 文案：随 IDE 发货的中文包 `plugins/localization-zh/lib/localization-zh.jar!messages/ActionsBundle.properties`
 * （行号：484 / 487 / 2324 / 2485 / 899 与 483/486/2323/2484/898 两列，组名 `group.TW.ViewModeGroup.text`
 * 该 jar 内没有 ⇒ 取英文包 `ActionsBundle.properties:1146` 的 "View Mode" 义译）。
 */
export const VIEW_MODE_GROUP_TITLE = '视图模式'
export const VIEW_MODE_LABELS: Record<ViewMode, { title: string; description: string }> = {
  dockPinned: { title: '停靠固定', description: '使工具窗口停靠并固定' },
  dockUnpinned: { title: '停靠不固定', description: '使工具窗口停靠但焦点丢失时自动隐藏' },
  undock: { title: '取消停靠', description: '使工具窗口滑动并在焦点丢失时自动隐藏' },
  float: { title: '浮动', description: '将工具窗口移至单独的对话框' },
  window: { title: '窗口', description: '将工具窗口移至单独的框架' },
}

/** `ViewMode.isApplied(ToolWindow)`（`:48-57`）的输入：只有 (type, autoHide) 这两个自由度参与。 */
export interface WindowTypeState {
  type: ToolWindowType
  autoHide: boolean
}

/** `ViewMode.isApplied`（`:48-57`）。 */
export function isModeApplied(mode: ViewMode, state: WindowTypeState): boolean {
  switch (mode) {
    case 'dockPinned': return state.type === 'docked' && !state.autoHide
    case 'dockUnpinned': return state.type === 'docked' && state.autoHide
    case 'undock': return state.type === 'sliding'
    case 'float': return state.type === 'floating'
    case 'window': return state.type === 'windowed'
  }
}

/** `ViewMode.fromWindowInfo`（`:59-66`）：从窗口状态反读当前模式（DOCKED 那一支再按 autoHide 分档）。 */
export function viewModeOf(state: WindowTypeState): ViewMode {
  switch (state.type) {
    case 'docked': return state.autoHide ? 'dockUnpinned' : 'dockPinned'
    case 'floating': return 'float'
    case 'sliding': return 'undock'
    case 'windowed': return 'window'
  }
}

/** `ViewMode.applyTo`（`:68-76`）：选中一档 ⇒ 写成哪一对 (type, autoHide)。 */
export function applyViewMode(mode: ViewMode): WindowTypeState {
  const type: ToolWindowType = mode === 'undock' ? 'sliding'
    : mode === 'float' ? 'floating'
    : mode === 'window' ? 'windowed' : 'docked'
  return { type, autoHide: mode === 'dockUnpinned' || mode === 'undock' }
}

/**
 * 「这一档现在能不能兑现」= 宿主能力探测（避免假控件，见文件头）。
 * 上游不筛（`:138-141` 只看"有没有工具窗口"），本仓筛的是**渲染前提**：
 * 浮层容器不在 DOM 里 ⇒ 「浮动」一行都不该出现；「窗口」还要第二个原生窗口，永远先不给。
 */
export interface ViewModeCapability {
  /** App.vue 里有没有 `<div id="tool-window-overlay">` 这个宿主容器（接线请求 W1）。 */
  overlayHostPresent: boolean
  /** 宿主能不能开第二个窗口（`native/` 目前没有该请求面）。 */
  separateFrameSupported: boolean
}

export function isViewModeRenderable(mode: ViewMode, capability: ViewModeCapability): boolean {
  if (mode === 'window') return capability.separateFrameSupported
  if (mode === 'float') return capability.overlayHostPresent
  return true
}

/**
 * 浮层的宿主容器 id（接线请求 W1：`src/App.vue` 的 workbench 里挂一个
 * `<div id="tool-window-overlay">`，本仓的「浮动」形态渲染到它里面）。
 * **容器在不在 DOM 里就是这一档能不能兑现的判据** —— 容器没有 ⇒ 菜单里不出现这一行，
 * 不会出现"点了什么也不会发生"的假控件；接线一到，这一行自动出现，不需要再改代码。
 */
export const TOOL_WINDOW_OVERLAY_HOST_ID = 'tool-window-overlay'

/** 从 DOM 读宿主能力（`document` 不在就等于没有：SSR / 单测）。 */
export function viewModeCapabilityFromDom(doc: { getElementById: (id: string) => unknown } | null | undefined): ViewModeCapability {
  return {
    overlayHostPresent: Boolean(doc?.getElementById(TOOL_WINDOW_OVERLAY_HOST_ID)),
    // 第二个原生窗口：宿主 `native/` 现在只有一个 WebView2 控制器，没有任何"再开一帧"的请求面。
    separateFrameSupported: false,
  }
}

/** 该模式是否"焦点丢失即收起"（`ToolWindowManagerLifecycle.kt:116` 的那一条判据）。 */
export function autoHidesWhenUnfocused(state: WindowTypeState): boolean {
  return state.autoHide || state.type === 'sliding'
}

/** `hideIfAutoHideToolWindowLostFocus` 的一次判定输入（`ToolWindowManagerLifecycle.kt:108-138`）。 */
export interface FocusLossInput {
  /** `windowInfo.isVisible`（`:112`）。 */
  visible: boolean
  state: WindowTypeState
  /** 焦点现在在哪个工具窗口里（`getToolWindowIdForComponent(oppositeComponent)`，`:129`）；null = 不在任何工具窗口。 */
  focusedWindowId: string | null
  /** 被检查的那一个。 */
  windowId: string
  /** 该窗口即将拿到焦点（`:124` 的 `isAboutToReceiveFocus`）。 */
  aboutToReceiveFocus?: boolean
  /** 焦点进了弹层（`:131` 的 `getParentBalloonFor`）。 */
  focusGoesToPopup?: boolean
  /** 焦点进了对话框（`:132`）。 */
  focusGoesToDialog?: boolean
}

/**
 * 「这个 auto-hide 的窗口刚才把焦点真的丢掉了、该收」= `hideIfAutoHideToolWindowLostFocus`
 * （`ToolWindowManagerLifecycle.kt:108-138`）逐条照抄，顺序也照上游（先易后难，命中即不收）。
 */
export function shouldHideOnFocusLoss(input: FocusLossInput): boolean {
  if (!input.visible) return false
  if (!autoHidesWhenUnfocused(input.state)) return false
  if (input.aboutToReceiveFocus) return false
  if (input.focusedWindowId === input.windowId) return false
  if (input.focusGoesToPopup || input.focusGoesToDialog) return false
  return true
}

/** 「浮动」浮层的几何：视口 + 当前矩形，夹取到视口内（越界就贴着边收进来）。 */
export const FLOATING_MIN_WIDTH = 240
export const FLOATING_MIN_HEIGHT = 160
/** 记住的浮层位置默认按窗口 1/3 宽、1/3 高起（本仓没有上游的 weight 模型，见 §E 差异）。 */
export const FLOATING_DEFAULT_FRACTION = 0.33

export function clampFloatingBounds(bounds: Rect, viewport: Rect): Rect {
  const width = Math.min(Math.max(bounds.width, Math.min(FLOATING_MIN_WIDTH, viewport.width)), viewport.width)
  const height = Math.min(Math.max(bounds.height, Math.min(FLOATING_MIN_HEIGHT, viewport.height)), viewport.height)
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, viewport.x), viewport.x + Math.max(0, viewport.width - width)),
    y: Math.min(Math.max(bounds.y, viewport.y), viewport.y + Math.max(0, viewport.height - height)),
  }
}

/** 出厂浮层矩形：视口左上角偏内一格，尺寸按 `DEFAULT_WEIGHT = 0.33`（`WindowInfoImpl.kt:35`）。 */
export function defaultFloatingBounds(viewport: Rect): Rect {
  const width = Math.max(FLOATING_MIN_WIDTH, Math.round(viewport.width * FLOATING_DEFAULT_FRACTION))
  const height = Math.max(FLOATING_MIN_HEIGHT, Math.round(viewport.height * FLOATING_DEFAULT_FRACTION))
  return clampFloatingBounds({ x: viewport.x + 24, y: viewport.y + 24, width, height }, viewport)
}

/** 标题栏拖动浮层：按下点 + 位移 ⇒ 新矩形（仍夹在视口内）。 */
export function floatingBoundsAfterDrag(start: Rect, viewport: Rect, dx: number, dy: number): Rect {
  return clampFloatingBounds({ ...start, x: start.x + dx, y: start.y + dy }, viewport)
}

/** 落点在不在这块浮层里（`WindowInfo.floatingBounds` 的命中判据，`:24`）。 */
export function floatingBoundsContain(bounds: Rect, point: { x: number; y: number }): boolean {
  return pointInside(bounds, point)
}

/** `WindowInfo.floatingBounds` 的"没存过"判据（`:53` 的默认值谓词：全 0 矩形等于 null）。 */
export function floatingBoundsStored(bounds: Rect | null | undefined): bounds is Rect {
  return !!bounds && !(bounds.width === 0 && bounds.height === 0 && bounds.x === 0 && bounds.y === 0)
}

/** 建菜单行的上下文。 */
export interface ViewModeRowsContext {
  /** 当前状态；null = 没有工具窗口 ⇒ 整组不给（`ToolWindowViewModeAction.java:138-141`）。
   *  是个取值函数而不是快照：菜单行会缓存，`checked` 必须在被问的那一刻现读。 */
  state: () => WindowTypeState | null
  /** 宿主能力。 */
  capability: ViewModeCapability
  /** 选一档（`setSelected`，`:127-135`：已经是这一档就什么都不做）。 */
  apply: (mode: ViewMode) => void
}

/**
 * `TW.ViewModeGroup` 的子行（`ToolWindowViewModeAction$Group`，`:158-181`：成员就是
 * `ViewMode.values()` 的**声明顺序**，一条不多一条不少）。
 * 每行是 radio（上游是 `DumbAwareToggleAction` ⇒ 菜单里是单选态），标题 + 描述进 title 提示。
 * 渲染不出来的一档整行不给（假控件禁令）。
 */
export function viewModeRows(context: ViewModeRowsContext): MenuRow[] {
  if (!context.state()) return []
  const rows: MenuRow[] = []
  for (const mode of VIEW_MODES) {
    if (!isViewModeRenderable(mode, context.capability)) continue
    const label = VIEW_MODE_LABELS[mode]
    rows.push({
      id: `window.viewMode.${VIEW_MODE_ACTION_IDS[mode]}`,
      title: label.title,
      keywords: `${label.title} ${VIEW_MODE_ACTION_IDS[mode]} 视图模式 view mode`,
      checked: () => { const state = context.state(); return state !== null && isModeApplied(mode, state) },
      // `setSelected`（`:127-135`）：`if (!myMode.isApplied(window)) myMode.applyTo(window)`。
      run: () => { const state = context.state(); if (state && !isModeApplied(mode, state)) context.apply(mode) },
    })
  }
  return rows
}

/** 「视图模式」这一组本身作为一个 popup 行（`intellij.platform.ide.impl.actions.xml:479` 的 `popup="true"`）。 */
export function viewModeGroupRow(context: ViewModeRowsContext): MenuRow | null {
  const rows = viewModeRows(context)
  if (!rows.length) return null
  return { id: 'window.viewMode.group', title: VIEW_MODE_GROUP_TITLE, childrenOf: () => viewModeRows(context) }
}

/**
 * 侧条/条纹按钮的「点一下该把它打开成什么形态」（`ToolWindowManagerImpl.showWindow` 在
 * FLOATING 时用的是浮层装饰器 —— 本仓同一条判据分给宿主）。
 */
export function opensAsOverlay(state: WindowTypeState): boolean {
  return state.type === 'floating' || state.type === 'windowed'
}
