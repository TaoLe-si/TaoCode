// **独立编辑器窗口**（上游 `DockableEditorTabbedContainer` / `IdeProjectFrameAllocator` /
// `EditSourceInNewWindowAction` 一族）在本仓的还原。
//
// 上游是什么：
//   · `FileEditorManagerImpl.OpenMode`（`platform/platform-impl/src/com/intellij/openapi/fileEditor/
//     impl/FileEditorManagerImpl.kt:217-219`）三档 `NEW_WINDOW` / `RIGHT_SPLIT` / `DEFAULT`；
//   · 手势 → 档位在 `getOpenMode(event)`（同文件 `:2596-2619`）：**Shift+点击**（`MOUSE_CLICKED/
//     PRESSED/RELEASED` 且修饰键恰为 `SHIFT_DOWN_MASK`，`:2599-2603`）或按下的键位里含
//     `IdeActions.ACTION_OPEN_IN_NEW_WINDOW`（`:2609-2612`）⇒ `NEW_WINDOW`；
//     `ACTION_OPEN_IN_RIGHT_SPLIT` ⇒ `RIGHT_SPLIT`（`:2613-2615`）；
//   · 动作 `EditSourceInNewWindowAction`（`platform/platform-impl/src/com/intellij/ide/actions/
//     EditSourceInNewWindowAction.java:31-40`）：取当前文件、置 `CLOSING_TO_REOPEN` 后调
//     `manager.openFileInNewWindow(file)` —— 于是**源标签关掉、在另一个窗口里打开**，
//     关掉那个窗口时再放回来（`FileEditorManagerKeys.CLOSING_TO_REOPEN`）；
//     它要求**恰好一个非目录文件**（`:44-46` 的 `update`），默认键位 Shift+F4
//     （`platform/platform-resources/src/keymaps/$default.xml:729-731`）；
//   · 菜单面：编辑器标签右键组（`PlatformActions.xml:919`，在 `PinActiveEditorTab` 之后）与
//     其它键位组（`:140`）；拖拽档在 `DockableEditorTabbedContainer.kt:224-240` 的
//     `dropIntoNewlyCreatedWindow` → 统计 id `OpenElementInNewWindow`（`:239`）。
//
// **本仓为什么不是原生第二窗口（如实）**：宿主 `native/main.cpp:1662-1665` 的
// `add_NewWindowRequested` 对**任何**弹出请求都 `put_Handled(TRUE)` 直接取消
// （防任意弹窗），且 `native/main.cpp` 是禁改文件、`Method` 清单里没有任何"再开一帧"的通道
// —— 真正的 Win32 第二窗口在本仓不可达。所以按本仓架构还原**同一个用户可见功能**：
//
//   ① **窗口内浮出编辑器**（默认档）：`EditSourceInNewWindow` 把标签从它的栏里**摘出来**，
//      在一个浮层里渲染同一个编辑器（可移动/可调整大小/可关）。关掉浮层 = 标签放回原栏，
//      这正是上游 `CLOSING_TO_REOPEN` 的语义。浮层形态照本仓已有的先例
//      （`src/toolWindowViewMode.ts:137-146` 的 `#tool-window-overlay`「浮动」形态）——
//      同一套宿主能力探测（容器不在 DOM 里就不渲染这一行，不放假控件）。
//   ② **真浏览器窗口**（开发/预览档）：`window.open` 打开同一个同源页面并带上
//      `?detached=<path>`，新窗口用 `localStorage` 与主窗口共享状态。**只在浏览器预览里可用**
//      （`isDesktop` 为假）；WebView2 里这条被宿主取消，`browserWindowSupported` 会如实报 false。
//
// 纯数据层：不 import vue/DOM 类型（用结构类型 + 可选注入的 `win`），便于单测。
//
// 判据：`tests/editor-windows.test.mjs`。

/** `FileEditorManagerImpl.OpenMode` 的本仓三档。 */
export type EditorOpenMode = 'newWindow' | 'rightSplit' | 'default'

/** 上游 `IdeActions` 的两个 id（`getOpenMode` 按它们判档）。 */
export const ACTION_OPEN_IN_NEW_WINDOW = 'OpenElementInNewWindow'
export const ACTION_OPEN_IN_RIGHT_SPLIT = 'OpenInRightSplit'

/** 动作 id（与上游同名；`src/keymapBindings.ts` 与编辑器右键菜单按它引用）。 */
export const EDIT_SOURCE_IN_NEW_WINDOW_ACTION = 'EditSourceInNewWindow'

/** 默认键位（`$default.xml:729-731` 的 `shift F4`）。 */
export const EDIT_SOURCE_IN_NEW_WINDOW_KEYS = 'Shift F4'

/** 浮层容器的 id（与本仓「浮动工具窗口」共用同一个宿主容器，见 `toolWindowViewMode`）。 */
export const EDITOR_OVERLAY_HOST_ID = 'tool-window-overlay'

/** 新窗口 URL 的参数名（浏览器档：同源页面 + `?detached=<工作区相对路径>`）。 */
export const DETACHED_QUERY_KEY = 'detached'

/** 最小的事件形状（不 import DOM 类型；`event.type`/`shiftKey`/`button` 够判档）。 */
export interface OpenModeEvent {
  type: string
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  /** 按键事件里的 `key`（大写比较，与 `KeyboardEvent.key` 同口径）。 */
  key?: string
  /** 当前生效键位表里这一组按键对应的动作 id（宿主查完传进来，见 `keymapActionIds`）。 */
  actionIds?: readonly string[]
}

/**
 * `getOpenMode(event)` 的等价物（`FileEditorManagerImpl.kt:2596-2619` 逐条对位）。
 *
 *   · 鼠标档：`type` 是 `click`/`mousedown`/`mouseup` 之一、**修饰键恰好是 Shift**
 *     （上游比的是 `modifiersEx == SHIFT_DOWN_MASK`，所以带 Ctrl/Alt/Meta 时**不算**）⇒ `newWindow`；
 *   · 键盘档：按下的键位映射到的动作里有 `OpenElementInNewWindow` ⇒ `newWindow`、
 *     有 `OpenInRightSplit` ⇒ `rightSplit`；
 *   · 其余 ⇒ `default`。
 */
export function openModeForEvent(event: OpenModeEvent | null | undefined): EditorOpenMode {
  if (!event) return 'default'
  const isMouseClick = event.type === 'click' || event.type === 'mousedown' || event.type === 'mouseup'
  if (isMouseClick) {
    const onlyShift = event.shiftKey === true && !event.ctrlKey && !event.altKey && !event.metaKey
    return onlyShift ? 'newWindow' : 'default'
  }
  for (const id of event.actionIds ?? []) {
    if (id === ACTION_OPEN_IN_NEW_WINDOW) return 'newWindow'
    if (id === ACTION_OPEN_IN_RIGHT_SPLIT) return 'rightSplit'
  }
  return 'default'
}

/** 一个被摘出来的标签（浮层里渲染的那一格）。 */
export interface DetachedEditor {
  /** 工作区相对路径（标签身份）。 */
  path: string
  /** 摘出前所在的栏（关掉浮层时放回这里）。 */
  pane: number
  /** 摘出前在栏里的下标（放回原位用；栏已经变了就按路径找）。 */
  index: number
  /** 浮层位置与大小（视口坐标）。 */
  x: number
  y: number
  width: number
  height: number
}

/** 浮层几何的上下限（视口百分比口径，避免拖出屏幕 / 缩到看不见）。 */
export const DETACHED_MIN_SIZE = { width: 320, height: 240 }
export const DETACHED_DEFAULT_SIZE = { width: 720, height: 520 }
/** 相对主窗口的初始偏移（新窗口不与主窗口完全重叠 —— 上游 `IdeProjectFrameAllocator`
 *  也是错开摆放，`platform/platform-impl/src/com/intellij/openapi/project/impl/IdeProjectFrameAllocator.kt:186-200`）。 */
export const DETACHED_OFFSET = { x: 48, y: 48 }

/**
 * 浮层的初始几何：按视口居中 + 错开偏移，并**夹进视口**（上游给新 frame 设 bounds 时也做这层夹取，
 * 否则多显示器/小屏下新窗口会开在看不见的地方）。没有视口尺寸（无 DOM）时给默认尺寸 + 偏移。
 */
export function detachedGeometry(viewport: { width: number; height: number } | null | undefined, ordinal = 0): {
  x: number; y: number; width: number; height: number
} {
  const viewWidth = viewport && viewport.width > 0 ? viewport.width : DETACHED_DEFAULT_SIZE.width + DETACHED_OFFSET.x * 2
  const viewHeight = viewport && viewport.height > 0 ? viewport.height : DETACHED_DEFAULT_SIZE.height + DETACHED_OFFSET.y * 2
  const width = Math.max(DETACHED_MIN_SIZE.width, Math.min(DETACHED_DEFAULT_SIZE.width, viewWidth - DETACHED_OFFSET.x * 2))
  const height = Math.max(DETACHED_MIN_SIZE.height, Math.min(DETACHED_DEFAULT_SIZE.height, viewHeight - DETACHED_OFFSET.y * 2))
  const step = Math.max(0, ordinal) * 24
  const x = Math.max(0, Math.min(viewWidth - width, Math.round((viewWidth - width) / 2) + DETACHED_OFFSET.x + step))
  const y = Math.max(0, Math.min(viewHeight - height, Math.round((viewHeight - height) / 2) + DETACHED_OFFSET.y + step))
  return { x, y, width, height }
}

/** 拖动/缩放浮层之后的夹取（不让它跑出视口、不让它小于下限）。 */
export function clampDetachedGeometry(
  geometry: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number } | null | undefined,
): { x: number; y: number; width: number; height: number } {
  const width = Math.max(DETACHED_MIN_SIZE.width, Math.round(geometry.width))
  const height = Math.max(DETACHED_MIN_SIZE.height, Math.round(geometry.height))
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return { x: Math.round(geometry.x), y: Math.round(geometry.y), width, height }
  // 至少留 32px 的标题栏在视口里，否则浮层会变成"关不掉的看不见窗口"。
  const x = Math.max(32 - width, Math.min(viewport.width - 32, Math.round(geometry.x)))
  const y = Math.max(0, Math.min(viewport.height - 32, Math.round(geometry.y)))
  return { x, y, width, height }
}

/** 摘出/放回的状态迁移（纯函数：吃一份栏表，回一份新的）。 */
export interface DetachPlan {
  /** 摘出后各栏的标签路径（源栏里已经去掉那一条）。 */
  groups: string[][]
  detached: DetachedEditor | null
  /** 摘出被拒绝的原因（可摘时 null）。 */
  reason: string | null
}

/**
 * 摘出一个标签（`EditSourceInNewWindowAction.actionPerformed` 的可移植一半）。
 *
 * 上游那道闸：**恰好一个非目录文件**（`EditSourceInNewWindowAction.java:44-46`）——
 * 本仓对应「给了路径且它在某一栏里」。已经在浮层里的路径再摘一次是 no-op（不产生第二个浮层，
 * 上游 `openFileInNewWindow` 也复用已开的窗口）。
 */
export function detachTab(
  groups: readonly (readonly string[])[],
  path: string,
  pane: number,
  viewport?: { width: number; height: number } | null,
  ordinal = 0,
): DetachPlan {
  const snapshot = groups.map(list => [...list])
  if (!path) return { groups: snapshot, detached: null, reason: '没有要摘出的文件。' }
  const source = snapshot[pane]
  if (!source) return { groups: snapshot, detached: null, reason: '这个文件不在任何编辑器栏里。' }
  const index = source.indexOf(path)
  if (index < 0) return { groups: snapshot, detached: null, reason: `「${path}」不在第 ${pane + 1} 栏里。` }
  source.splice(index, 1)
  const geometry = detachedGeometry(viewport, ordinal)
  return { groups: snapshot, detached: { path, pane, index, ...geometry }, reason: null }
}

/**
 * 把一个标签放回它原来的栏（关掉浮层 = 上游 `CLOSING_TO_REOPEN` 的那条路：
 * `FileEditorManagerKeys.CLOSING_TO_REOPEN` 置位后打开，关窗时按同一个键放回）。
 * 原位下标还在且那一格空着就插回原位，否则按原下标夹取 —— 不把标签放到别的栏里。
 */
export function reattachTab(groups: readonly (readonly string[])[], detached: DetachedEditor): string[][] {
  const snapshot = groups.map(list => [...list])
  const pane = Math.max(0, Math.min(snapshot.length - 1, detached.pane))
  const target = snapshot[pane]
  if (!target) return snapshot
  if (target.includes(detached.path)) return snapshot
  const at = Math.max(0, Math.min(target.length, detached.index))
  target.splice(at, 0, detached.path)
  return snapshot
}

/** 宿主能力（照 `toolWindowViewMode.viewModeCapabilityFromDom` 的口径：容器在不在 DOM 里说了算）。 */
export interface DetachedWindowCapability {
  /** 浮层容器在不在 DOM 里（`EDITOR_OVERLAY_HOST_ID`）。 */
  overlayHostPresent: boolean
  /** 能不能开真浏览器窗口（`window.open` 可用且不是 WebView2 宿主）。 */
  browserWindowSupported: boolean
}

export function detachedWindowCapability(input: {
  doc?: { getElementById: (id: string) => unknown } | null
  isDesktop: boolean
  /** 注入的 `window`（无 DOM 时 undefined）。 */
  win?: { open?: unknown } | null
}): DetachedWindowCapability {
  return {
    overlayHostPresent: Boolean(input.doc?.getElementById(EDITOR_OVERLAY_HOST_ID)),
    // WebView2 宿主里 `window.open` 会被 `add_NewWindowRequested` 取消（`native/main.cpp:1662`），
    // 所以只有浏览器预览那一档才算"能开"。宿主能力探测而非猜测 —— 与浮层容器同一条纪律。
    browserWindowSupported: !input.isDesktop && typeof input.win?.open === 'function',
  }
}

/** 独立窗口这一档现在能不能兑现（不能就不渲染那一行，不放假控件）。 */
export function canDetachEditor(capability: DetachedWindowCapability): boolean {
  return capability.overlayHostPresent || capability.browserWindowSupported
}

/** 浏览器档的新窗口 URL：同源页面 + `?detached=<路径>`（`localStorage` 因此天然共享）。 */
export function detachedWindowUrl(baseUrl: string, path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}${DETACHED_QUERY_KEY}=${encodeURIComponent(normalized)}`
}

/** `window.open` 的 features 串（尺寸与位置照浮层几何；新窗口同样错开摆放）。 */
export function detachedWindowFeatures(geometry: { x: number; y: number; width: number; height: number }): string {
  return `popup=yes,width=${Math.round(geometry.width)},height=${Math.round(geometry.height)},left=${Math.round(geometry.x)},top=${Math.round(geometry.y)}`
}

/** 从当前页面 URL 读「本窗口是不是独立窗口」（新窗口启动时判一次，决定只渲染一个编辑器）。 */
export function detachedPathFromUrl(search: string): string | null {
  const query = String(search ?? '').replace(/^\?/, '')
  if (!query) return null
  for (const part of query.split('&')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index) !== DETACHED_QUERY_KEY) continue
    try { return decodeURIComponent(part.slice(index + 1)) } catch { return null }
  }
  return null
}

/**
 * 拖拽档：标签被拖到**编辑区之外**（浏览器里没有"另一个窗口"可落，所以本仓的等价物是
 * 「拖出标签条所在的矩形」）⇒ 摘成浮层。上游那条统计 id 是 `OpenElementInNewWindow`
 * （`DockableEditorTabbedContainer.kt:239` 的 `-1` 档），判定在 `:224-240` 的
 * `dropIntoNewlyCreatedWindow`。
 *
 * 返回 true 表示这一落该走"摘出"而不是"分屏/重排"。判据是**落点在容器矩形之外** ——
 * 容器内的边缘落点仍然走分屏（`src/tabDragSplit.ts` 的四块梯形），两者不抢同一落点。
 */
export function dropDetachesTab(
  point: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
  outsideMargin = 0,
): boolean {
  return point.x < bounds.x - outsideMargin || point.y < bounds.y - outsideMargin
    || point.x > bounds.x + bounds.width + outsideMargin || point.y > bounds.y + bounds.height + outsideMargin
}