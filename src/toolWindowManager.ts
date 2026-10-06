// 工具窗口的**统一门面**（IDEA `ToolWindowManager` / `ToolWindowManagerEx` / `WindowInfo`）。
//
// 判词原文（docs/inventory/verdict-toolwindow-openapi.md §B-1）：
//   · `ToolWindowManager`（接口）「缺：统一门面（`getToolWindow`/`getToolWindows`/
//     `getActiveToolWindowId`/`invokeLater`）」；
//   · `ToolWindowManagerEx` 「缺：`clearSideStack`、`getToolWindowManagerListeners` 那层扩展面」；
//   · `WindowInfo` 「缺：**每窗口聚合对象**（可见+锚点+顺序+条纹按钮+自动隐藏一处）」；
//   · `ToolWindowEx` 「缺：`getAnchor`/`getType`/`setAutoHide` 的完整接口面」。
// 这四条缺的是**同一个东西**：本仓把窗口状态摊在 `src/toolWindowStripes.ts` 的七八个 getter 上，
// 组件要自己去拼（`src/components/ToolWindowHeader.vue` 原先就是连读三份 store 指针）。
// 这里把它们收成一个可查询的对象，语义逐条对齐上游。
//
// 上游坐标（参考树 intellij-community-master）：
//   · `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowManager.kt:120`（`toolWindowIds`）、
//     `:122`（`toolWindowIdSet`）、`:127`（`activeToolWindowId`）、`:132`（`lastActiveToolWindowId`）、
//     `:139`（`getToolWindow(id)`：**没注册就返回 null，不猜**）、`:144`（`invokeLater`）；
//   · `platform/platform-impl/src/com/intellij/openapi/wm/ex/ToolWindowManagerEx.kt:19`
//     （`toolWindows`）、`:28`（`getMoreButtonSide`）、`:50`（`getIdsOn(anchor)`）；
//   · `platform/platform-api/src/com/intellij/openapi/wm/WindowInfo.kt:9-50` 的 20 个属性，
//     默认 pane id 常量在 `:7`（`WINDOW_INFO_DEFAULT_TOOL_WINDOW_PANE_ID = "root"`），
//     `safeToolWindowPaneId` 在 `:53`。
//
// 架构不等价的部分如实处理（桃 2026-10-05 指示）：
//   · `weight` / `sideWeight`（`WindowInfo.kt:14-15`）—— 上游是**权重**，本仓侧条存的是**像素宽度**
//     （`src/stripeResize.ts`，判词 §B-5 已登记这条差异），所以这里给出 `stripeWidth`（像素）
//     而不是造一个量不出来的权重；
//   · `internalType`（`:32`）是上游"浮层还没落地前的暂存类型"，本仓改类型是同步写状态，
//     没有暂存位 ⇒ 不建模（不是缺口，是没有那一态）；
//   · `clearSideStack` / `getToolWindowManagerListeners`（`ToolWindowManagerEx.kt:44`、`:26-24` 的
//     `getLayout`/`setLayout`）留在原判词的"还差"里：前者依附 auto-hide 的侧栈对象（本仓一个 dock
//     同时只装一个窗口，没有栈可清），后者的 `DesktopLayout` 权重模型即上面那条差异。
import { DEFAULT_TOOL_ORDER, toolActiveOnStart, toolCanCloseContents, toolSecondary, toolWindowRegistration,
        type ToolWindowAnchor, type ToolWindowId } from './toolWindowMeta.ts'
// 常驻栈的"从栈顶往下找第一个还可用的"那一步已经有实现并且有判据（`src/activeToolWindow.ts:43-49`，
// 上游 `ToolWindowManagerImpl.kt:746-753`），门面只复用它的纯函数，不再写第二份遍历。
import { lastActiveId } from './activeToolWindow.ts'
import type { ToolWindowContentUiType } from './toolWindowContentUi.ts'
import type { ToolWindowType, ViewMode } from './toolWindowViewMode.ts'
import type { Rect } from './popupPosition.ts'

/** `WindowInfo.kt:9-50` 在本仓的形状（字段名逐条对上游；两处如实差异见文件头）。 */
export interface ToolWindowInfo {
  /** `WindowInfo.id`（`:10`）。 */
  id: string
  /** `WindowInfo.order`（`:12`）：同一条侧条里的序号。 */
  order: number
  /** `WindowInfo.weight`/`sideWeight`（`:14-15`）的本仓等价物：**像素**宽度，0 = 没拖过。 */
  stripeWidth: number
  /** `WindowInfo.isVisible`（`:17`）。 */
  isVisible: boolean
  /** `WindowInfo.isFromPersistentSettings`（`:20`）：这一格是被"上次的可见性"打开的。 */
  isFromPersistentSettings: boolean
  /** `WindowInfo.anchor`（`:22`）。 */
  anchor: ToolWindowAnchor
  /** `WindowInfo.floatingBounds`（`:24`）：没存过 = null（`WindowInfoImpl.kt:53` 的全 0 谓词）。 */
  floatingBounds: Rect | null
  /** `WindowInfo.isMaximized`（`:26`）：本仓的最大化是宿主的一个 ref，由调用方注入。 */
  isMaximized: boolean
  /** `WindowInfo.isSplit`（`:28`）。 */
  isSplit: boolean
  /** `WindowInfo.type`（`:30`）。 */
  type: ToolWindowType
  /** `WindowInfo.isActiveOnStart`（`:34`）：项目打开时该不该自动亮出来。 */
  isActiveOnStart: boolean
  /** `WindowInfo.isAutoHide`（`:36`，XML 属性名 `auto_hide`）。 */
  isAutoHide: boolean
  /** `WindowInfo.isDocked`（`:38`）：上游就是 `type == DOCKED` 的派生位。 */
  isDocked: boolean
  /** `WindowInfo.isShowStripeButton`（`:40`）：侧条按钮在不在。 */
  isShowStripeButton: boolean
  /** `WindowInfo.contentUiType`（`:42`）。 */
  contentUiType: ToolWindowContentUiType
  /** `WindowInfo.toolWindowPaneId`（`:50`）+ 默认值 `:7`；本仓只有一个 pane ⇒ 恒为 `"root"`。 */
  toolWindowPaneId: string
  /** 当前视图模式（`ViewMode.fromWindowInfo`，`ToolWindowViewModeAction.java:59-66`）。 */
  viewMode: ViewMode
  /** 可用性（`ToolWindow.isAvailable`）：不可用的窗口不进任何列表，也不给菜单行。 */
  isAvailable: boolean
}

/** `WindowInfo.kt:7` 的默认 pane id。 */
export const WINDOW_INFO_DEFAULT_TOOL_WINDOW_PANE_ID = 'root'

/**
 * 门面要读的窗口状态。这里是 `src/toolWindowStripes.ts` 暴露的那一份的**子集视图**
 * （`installToolWindowManager` 由 stripes 自己调用，见那边的 `ToolWindowLayoutState`），
 * 抽成接口是为了本模块可单测：夹具给一个对象就够了。
 */
export interface ToolWindowManagerSource {
  anchorOf: (id: string) => ToolWindowAnchor
  /** 同一条侧条上的顺序（`ToolWindowManagerEx.kt:50` 的 `getIdsOn(anchor)` 用同一个来源）。 */
  idsOn: (anchor: ToolWindowAnchor) => readonly string[]
  visibleIds: () => readonly string[]
  /** `WindowInfo.isShowStripeButton` 的取反来源（`hiddenStripeButtons` 那张集）。 */
  stripeButtonHidden: (id: string) => boolean
  contentUiType: (id: string) => ToolWindowContentUiType
  stripeWidth: (id: string) => number
  typeState: (id: string) => { type: ToolWindowType; autoHide: boolean }
  viewModeOf: (id: string) => ViewMode
  floatingBoundsOf: (id: string) => Rect | null
  toolDisabled: (id: string) => boolean
  /** `ToolWindowManagerImpl.setToolWindowType`/`setToolWindowAutoHide` 的写入点（视图模式选一档）。 */
  setViewMode: (id: string, mode: ViewMode) => boolean
  /** `WindowInfo.isMaximized`：宿主的那一份（`App.vue` 的 `maximizedToolWindow`）。 */
  maximizedId?: () => string | null
  /** `WindowInfo.isSplit`：布局里存过这一位就用它（上游用户可以拖出来另一档，
   *  `AbstractDroppableStripe.kt:254-255` 的 `setSideToolAndAnchor`）；没存过就退回注册表的初值
   *  （EP `secondary` → `sideTool` → `DesktopLayout.kt:46`）。 */
  isSplit?: (id: string) => boolean
  /**
   * `ToolWindowManager.isEditorComponentActive`（`ToolWindowManager.kt:112-115`）的**真判据**：
   * 上游问的是焦点主人 —— `ToolWindowManagerState.kt:52-55` 就是
   * `ComponentUtil.getParentOfType(EditorsSplitters::class, focusOwner) != null`，
   * 与"有没有窗口开着"无关（窗口开着而光标在编辑器里，上游答 true）。
   * 本仓由 `src/toolWindowStripes.ts` 用那张 dock 选择器表（`src/toolWindowDocks.ts` 的 `dockOf`）给，
   * 门面自己不碰 DOM ⇒ Node 夹具可单测。没给的那一档宿主退化成"没有窗口可见"，
   * 是**保守**的近似（不是同一条判据，登记在此）。给 `undefined` = 这一档宿主答不出来（Node/SSR 没 DOM）。
   */
  editorComponentActive?: () => boolean | undefined
  /**
   * `ToolWindowManager.lastActiveToolWindowId`（`ToolWindowManager.kt:132`）的来源：
   * 上游那份**持久**激活栈（`ActiveStack.java:21-25`，编辑区拿到焦点不清、隐藏也不清，
   * 只有注销窗口才真删，`ToolWindowManagerImpl.kt:1217`）。
   * 栈本身住在宿主（push 的唯一写入点是宿主的 `recordActiveToolWindow`，
   * 见 `src/appToolWindowActivation.ts:57-66` 那个注入回调），门面只**读**它并按可用性筛
   * （上游 `:749-753` 的 `getLastActiveToolWindows()` 就是 `filter { it.isAvailable }`）。
   * 没给 = 宿主还没把这一位接进来 ⇒ `lastActiveToolWindowId()` 答 `null`，不自己记账
   * （两份真相正是原判词 §6-1 拦着不让做的事）。
   */
  activationStack?: () => readonly string[]
}

export interface ToolWindowManager {
  /** `ToolWindowManager.kt:139`：没注册（不可用且不认识）的 id 返回 null，不猜。 */
  getToolWindow: (id: string | null | undefined) => ToolWindowInfo | null
  /** 同上但返回聚合对象；id 不在出厂表里也照样给（底部那些内容是运行期注册的窗口）。 */
  windowInfo: (id: string) => ToolWindowInfo
  /** `ToolWindowManager.kt:120`：全部注册窗口（出厂表 ∪ 运行期注册的底部内容），按出厂顺序。 */
  toolWindowIds: () => string[]
  /** `ToolWindowManager.kt:122`。 */
  toolWindowIdSet: () => Set<string>
  /** `ToolWindowManager.kt:127`：此刻占着那一格的窗口（侧栏 + 底部各一格，取最近激活的那条）。 */
  activeToolWindowId: () => string | null
  /**
   * `ToolWindowManager.kt:132`：**上一个激活过的**窗口（F12「转到上一个工具窗口」的目标）。
   * 与 `activeToolWindowId` 的区别就是上游那两个 getter 的区别：这一位读的是常驻栈，
   * 窗口被收掉也还留在栈里（`ToolWindowManagerImpl.kt:712-718` 的 `setHiddenState` 走
   * `activeStack.remove(entry, false)`，`false` = 不动持久栈；只有注销窗口才真删，`:1217`），
   * 所以要**从栈顶往下找第一个还可用的**（`ToolWindowManagerImpl.kt:746-753`），
   * 栈空或全不可用答 `null`（= 上游把动作灰掉，`JumpToLastWindowAction.java:32-44`）。
   */
  lastActiveToolWindowId: () => string | null
  /** `ToolWindowManagerEx.kt:50`：某一条侧条上的窗口 id（顺序即侧条顺序）。 */
  getIdsOn: (anchor: ToolWindowAnchor) => string[]
  /** `ToolWindowManagerEx.kt:19`：只列**可用**的窗口（不可用的不渲染，假控件禁令）。 */
  toolWindows: () => ToolWindowInfo[]
  /**
   * `ToolWindow.canCloseContents()`（`ToolWindowImpl.kt:647`）的按 id 查询：
   * 注册表里那条 EP 记录的 `canCloseContents`（`ToolWindowEP.java:81-82`）。
   * `null` = 这个 id 在本仓没有注册记录（底部那几格固定内容）⇒ 调用方沿用"有几条内容"那条既有判据。
   */
  canCloseContents: (id: string) => boolean | null
  /** `ToolWindowManager.kt:115` 的 `isEditorComponentActive`：焦点主人不在 dock 里就是编辑器 active（判据由宿主给，见 `editorComponentActive`）。 */
  isEditorComponentActive: () => boolean
  /** `ToolWindowManager.kt:144` 的 `invokeLater`：排到本帧命令队列尾部（微任务）。 */
  invokeLater: (task: () => void) => void
  /** 选一档视图模式（`ToolWindowViewModeAction.setSelected`，`:127-135`）；值没变返回 false。 */
  setViewMode: (id: string, mode: ViewMode) => boolean
}

/** 出厂表里的 id（`DEFAULT_TOOL_ORDER` 三条侧条展平）；运行期注册的底部内容另计。 */
const EXTRA_REGISTRY: string[] = []
/** 上游是 `project.getService(ToolWindowManager.class)`；本仓一份进程级实例（同 `popupDispatcher`）。 */
let installed: ToolWindowManagerSource | null = null

/** stripes 建好状态后自己调用（`src/toolWindowStripes.ts` 的 `createToolWindowStripes` 末尾）。 */
export function installToolWindowManager(source: ToolWindowManagerSource | null): void {
  installed = source
}

/**
 * 运行期注册的窗口（底部的 output/run/problems/… 不在出厂锚点表里）。
 *
 * 生产方是 `src/toolWindowStripes.ts` 的 `refreshContentUiTypes()`：每次装载项目布局，
 * 把布局里那些**不在出厂锚点表**的内容 id 逐条登记（同一个循环里另存了一份 `extraContentIds`，
 * 那条是给落盘用的；这一条是给门面查询用的）。
 * 上游的对应接口就是 `ToolWindowManager.kt:39` 的 `registerToolWindow(id, …)` 与
 * `:107-108` 的 `unregisterToolWindow(id)` —— 本仓没有工厂期注册那条路，只有"读到布局即登记"。
 * 为什么不靠可见集兜底：`toolWindowIds()`（`ToolWindowManager.kt:120`）答的是**注册过的**，
 * 收起来的 output 照样是注册过的；只有可见集就答不出"没开着但存在"的那些，
 * `getToolWindow('output')`（`:139`）会在窗口没开时错答 null。
 */
export function registerToolWindowId(id: string): void {
  if (!EXTRA_REGISTRY.includes(id)) EXTRA_REGISTRY.push(id)
}

/** 换项目 / 重新装载布局时先清掉上一份登记（`unregisterToolWindow`，`ToolWindowManager.kt:108`）。 */
export function resetRegisteredToolWindowIds(): void { EXTRA_REGISTRY.length = 0 }

function knownIds(): string[] {
  const out: string[] = []
  for (const ids of Object.values(DEFAULT_TOOL_ORDER)) for (const id of ids) if (!out.includes(id)) out.push(id)
  for (const id of EXTRA_REGISTRY) if (!out.includes(id)) out.push(id)
  // 已经可见但两个表都没有的（例如以后新加的内容），也从可见集里补上：
  // 上游 `toolWindowIds` 返回的就是"注册过的"，注册入口不止出厂表这一条路。
  if (installed) for (const id of installed.visibleIds()) if (!out.includes(id)) out.push(id)
  return out
}

/**
 * 注册表那三条 EP 布尔位的按 id 读法（`toolWindowMeta.ts` 的派生表）。
 * **没有这条注册记录的 id**（底部那几格固定内容 output/run/problems/… 在本仓没有 `<toolWindow>` 注册，
 * 上游它们是各自注册过的工具窗口）答 `undefined` = "门面答不出这一位"，
 * 而不是替它们编一个默认值 —— 调用方据此退回自己那条既有判据。
 */
function registrationFlag(table: Record<ToolWindowId, boolean>, id: string): boolean | undefined {
  return toolWindowRegistration(id) ? table[id as ToolWindowId] : undefined
}

/** `WindowInfo.isSplit` 的注册表来源：EP `secondary` → `sideTool` → `DesktopLayout.kt:46`。 */
export function toolWindowSplitDefault(id: string): boolean | undefined {
  return registrationFlag(toolSecondary, id)
}

/**
 * `ToolWindow.canCloseContents()`（`ToolWindowImpl.kt:647`，值来自 `RegisterToolWindowTaskData.canCloseContent`
 * 即 EP 的 `canCloseContents`，`ToolWindowSetInitializer.kt:369`）。
 * 上游用它的那几条：`ContentManagerImpl.java:139-141` 与 `:473`（Close All 的第一道闸）、
 * `ContentTabLabel.java:170`（标签上的关闭按钮 = `content.isCloseable() && window.canCloseContents()`）、
 * `CloseActiveTabAction.java:25/46`、`ToolWindowCloseOtherTabsAction.kt:25`、`TabbedContentAction.java:87/114`。
 * `null` = 这个 id 在本仓没有注册记录 ⇒ 调用方沿用"有几条内容"那条既有判据，不替它猜。
 */
export function canCloseContents(id: string): boolean | null {
  return registrationFlag(toolCanCloseContents, id) ?? null
}

/** `WindowInfo.isActiveOnStart` 的注册表来源：EP `doNotActivateOnStart` 取反（`WindowInfoImpl.kt:165-170`）。 */
export function toolWindowActiveOnStart(id: string): boolean | undefined {
  return registrationFlag(toolActiveOnStart, id)
}

/** `WindowInfo` 的装配点：所有字段都从 source 现读，不做任何本地缓存。 */
export function assembleWindowInfo(id: string, source: ToolWindowManagerSource,
                            maximizedId: string | null = source.maximizedId?.() ?? null): ToolWindowInfo {
  const anchor = source.anchorOf(id)
  const typeState = source.typeState(id)
  return {
    id,
    // `WindowInfo.order`：同侧条内的序号；不在这条侧条上的（未注册/被摘掉的）给到末尾。
    order: source.idsOn(anchor).indexOf(id),
    stripeWidth: source.stripeWidth(id),
    isVisible: source.visibleIds().includes(id),
    // 本仓的可见性本来就来自那份随项目的存档（`src/toolLayoutProfiles.ts`），
    // 所以"来自持久设置"与"当前可见"同源；宿主显式点开时会重写这条记录（上游同一条）。
    isFromPersistentSettings: true,
    anchor,
    floatingBounds: source.floatingBoundsOf(id),
    isMaximized: maximizedId === id,
    isSplit: source.isSplit?.(id) ?? toolWindowSplitDefault(id) ?? false,
    type: typeState.type,
    // `WindowInfoImpl.kt:165-170` 的 `canActivateOnStart`：EP 没写 `doNotActivateOnStart` 才允许启动即亮。
    // 那一档之后上游还要看"是不是窗口型/浮层且应用在前台"（`ToolWindowManagerImpl.kt:1172-1174`），
    // 本仓的 dock 一格同时只装一个窗口，所以**近似**成"这一侧能不能占着那一格"：
    // 底部那一格没有启动即亮的通道（除非它本来就开着）。EP 那一位现在是真源，近似只剩这一句。
    isActiveOnStart: toolWindowActiveOnStart(id) !== false && (anchor !== 'bottom' || source.visibleIds().includes(id)),
    isAutoHide: typeState.autoHide,
    // `WindowInfo.isDocked`（`:38`）在上游就是 type == DOCKED 的派生位。
    isDocked: typeState.type === 'docked',
    isShowStripeButton: !source.stripeButtonHidden(id),
    contentUiType: source.contentUiType(id),
    toolWindowPaneId: WINDOW_INFO_DEFAULT_TOOL_WINDOW_PANE_ID,
    viewMode: source.viewModeOf(id),
    isAvailable: !source.toolDisabled(id),
  }
}

/** 门面本体。没有安装状态（还没建项目 / SSR 夹具）时所有查询回答"没有窗口"，不抛。 */
export function toolWindowManager(): ToolWindowManager {
  const source = installed
  return {
    getToolWindow(id) {
      if (!source || !id) return null
      // `ToolWindowManager.kt:139` 的注释就写着"没有这个 id 就返回 null"。
      if (!knownIds().includes(id)) return null
      return assembleWindowInfo(id, source)
    },
    windowInfo(id) {
      if (!source) throw new Error('toolWindowManager: 没有安装窗口状态（项目还没建）')
      return assembleWindowInfo(id, source)
    },
    toolWindowIds: knownIds,
    toolWindowIdSet: () => new Set(knownIds()),
    activeToolWindowId() {
      // 一个 dock 同时只装一格：可见集里**最后**亮出来的那一个（上游的 activeToolWindowId 同义）。
      const visible = source?.visibleIds() ?? []
      return visible.length ? visible[visible.length - 1]! : null
    },
    getIdsOn: anchor => (source ? [...source.idsOn(anchor)] : []),
    lastActiveToolWindowId() {
      // 上游读的是 `activeStack` 那份持久栈（`ToolWindowManagerImpl.kt:746-747`），本仓那一份住在宿主
      //（唯一的 push 点是宿主的 `recordActiveToolWindow`），所以**宿主没接这一位时答 null**，
      // 门面不自己记账 —— 两处真相就是原判词 §6-1 拦着的事。
      const stack = source?.activationStack?.()
      if (!stack || !stack.length) return null
      // 栈顶往下第一个**仍可用**的（`:749-753` 的 `filter { it.isAvailable }`），可用性的判据
      // 与 `ToolWindowInfo.isAvailable` 同一位（`!toolDisabled`）。
      return lastActiveId(stack, id => !(source ? source.toolDisabled(id) : true)) ?? null
    },
    toolWindows() {
      if (!source) return []
      // 不可用的窗口不列（假控件禁令）：上游 `ToolWindow.isAvailable` 为假时侧条按钮都不画。
      return knownIds().map(id => assembleWindowInfo(id, source)).filter(info => info.isAvailable)
    },
    // 这一位读的是注册表而不是窗口状态（EP 声明在装配期就定了，不随项目变），
    // 所以门面没装状态时也答得出来 —— 与上面那些"现读 source"的字段是两类查询。
    canCloseContents,
    isEditorComponentActive() {
      // 上游问焦点主人（`ToolWindowManagerState.kt:52-55`），本仓由宿主经 `editorComponentActive`
      // 给同一判据（`dockOf(document.activeElement) === 'editor'`，见 `src/toolWindowStripes.ts`）。
      // 宿主没装配点（还没建项目 / SSR 夹具）时才退化成"没有任何窗口可见 ⇒ 焦点只可能在编辑器"。
      const focusAnswer = source?.editorComponentActive?.()
      if (focusAnswer !== undefined) return focusAnswer
      // 本仓的"哪个 dock 有焦点"住在 `src/toolWindowActions.ts` 的 `lastDockFocus`；
      // 门面不反过来依赖它（那条链会拖进引用视图/标签导航）。
      return (source?.visibleIds().length ?? 0) === 0
    },
    invokeLater(task) { queueMicrotask(task) },
    setViewMode(id, mode) { return installed ? installed.setViewMode(id, mode) : false },
  }
}

/** 便利导出：`windowInfo(id)`（组件读一份聚合对象，不再连读三份 store 指针）。 */
export function windowInfo(id: string): ToolWindowInfo | null {
  return installed ? assembleWindowInfo(id, installed) : null
}
