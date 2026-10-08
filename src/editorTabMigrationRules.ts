// **编辑器多窗口 · 标签的开关与窗口间迁移**（上游 `EditorWindow.closeFile/addComposite`、
// `EditorsSplitters.closeFileInWindows/closeAllFiles`、`SplitAction`、
// `MoveEditorToOppositeTabGroupAction`、拖拽落点）的纯规则层：零 Vue、零 DOM。
//
// 分屏树与窗口生命周期在 `src/editorWindowRules.ts`；本文件只做"标签在窗口里怎么开关、
// 在窗口之间怎么搬"，因此单向 import 那个文件，没有环。
//
// 判据：`tests/editor-window-rules.test.mjs`。

import {
  EDITOR_TAB_LIMIT_DEFAULT, leafWindowIds, orderedWindows, parentSplitterOf, removeLeaf,
  siblingWindowIds, splitWindow, unsplit, windowById, windowsShowing, type ClosedTabRecord,
  type EditorWindowState, type SplitOrientation, type WindowTable,
} from './editorWindowRules.ts'
import { canDetachEditor, type DetachedWindowCapability } from './editorWindows.ts'

/** `DockableEditorContainerFactory.kt:16` —— `DockContainerFactory` 的注册 id。 */
export const DOCK_CONTAINER_TYPE = 'file-editors'

/** 拖动落点档（`DockableEditorTabbedContainer.kt:260-269` 的 `currentDropSide`，`-1` = 没有落点）。 */
export type DropSide = 'TOP' | 'LEFT' | 'BOTTOM' | 'RIGHT' | 'CENTER'

/** 标签条位置（`UISettings.TABS_NONE = 0`，其余取 `SwingConstants` 的 TOP/BOTTOM/LEFT/RIGHT）。 */
export type TabPlacement = 'none' | 'top' | 'bottom' | 'left' | 'right'

/** `FileEditorManagerKeys.kt:69` 的 `FORBID_TAB_SPLIT`（`:62-67` 的注释就是判据）。 */
export function forbidSplit(flags: { forbidTabSplit?: boolean }): boolean {
  return flags.forbidTabSplit === true
}

/**
 * `EditorWindow.kt:342-350` 的插入下标：给了 `index` 就用它（`:342-343`）；
 * 否则预览标签落在**最后一个预览标签之后**（`:344-346`）；
 * 再否则按 `openTabsAtTheEnd`（默认 false，`UISettingsState.kt:154`）—— 默认插在**当前标签之后**（`:348`）。
 */
export function insertIndexFor(
  window: EditorWindowState,
  options: { index?: number; usePreviewTab?: boolean; openTabsAtTheEnd?: boolean } = {},
): number {
  if (options.index != null && options.index >= 0) return Math.min(options.index, window.tabs.length)
  if (options.usePreviewTab === true) {
    const lastPreview = window.tabs.indexOf(window.preview)
    if (lastPreview >= 0) return lastPreview + 1
  }
  if (options.openTabsAtTheEnd === true) return window.tabs.length
  const selected = window.tabs.indexOf(window.active)
  return selected < 0 ? window.tabs.length : selected + 1
}

export interface OpenFileOptions {
  index?: number
  pin?: boolean
  selectAsCurrent?: boolean
  usePreviewTab?: boolean
  openTabsAtTheEnd?: boolean
  forbidTabSplit?: boolean
}

/**
 * `FileEditorManagerImpl.kt:1103-1106` + `EditorWindow.kt:331-395` 的可见结果：
 *   · `forbidSplitFor(file)` 且这个窗口还没开它 ⇒ **先关掉别处的副本**（`:1103-1105`）；
 *   · 已经开着 ⇒ 只切选中（上游复用 composite，不新建标签）；
 *   · 否则按 `insertIndexFor` 插入，`pin` 置固定（`:388-390`），`selectAsCurrent` 选中
 *     并把当前窗口切过来（`:392-395`）。
 */
export function openFileInWindow(
  table: WindowTable,
  windowId: number,
  path: string,
  options: OpenFileOptions = {},
): { table: WindowTable; windowId: number; inserted: boolean } {
  let next = table
  const window = windowById(next, windowId)
  if (!window) return { table, windowId, inserted: false }
  if (forbidSplit(options) && !window.tabs.includes(path)) next = closeFileEverywhere(next, path)
  const target = windowById(next, windowId) ?? window
  const select = options.selectAsCurrent !== false
  if (target.tabs.includes(path)) {
    const windows = next.windows.map(candidate => candidate.id === windowId ? { ...candidate, active: path } : candidate)
    return { table: { ...next, windows, current: select ? windowId : next.current }, windowId, inserted: false }
  }
  const index = insertIndexFor(target, options)
  const tabs = [...target.tabs]
  tabs.splice(index, 0, path)
  const pinned = options.pin === true && !target.pinned.includes(path) ? [...target.pinned, path] : [...target.pinned]
  const windows = next.windows.map(candidate => candidate.id === windowId
    ? { ...candidate, tabs, pinned, active: select ? path : candidate.active }
    : candidate)
  return { table: { ...next, windows, current: select ? windowId : next.current }, windowId, inserted: true }
}

/**
 * `EditorsSplitters.kt:1238-1268` 的 `openInRightSplit`：
 * 取当前窗口的父 `Splitter`，看它的 `secondComponent`（`:1247`）——**不是**当前窗口
 * （`:1248`，即当前窗口在 first 侧、右边确实另有一块）就复用那块里开着的窗口（`:1250-1260`）；
 * 否则水平分屏（`:1263-1268`，新组在右）。
 */
export function openInRightSplit(table: WindowTable, path: string): { table: WindowTable; windowId: number } {
  const current = table.current == null ? null : windowById(table, table.current)
  if (!current) return { table, windowId: -1 }
  const parent = parentSplitterOf(table.layout, current.id)
  if (parent && !leafWindowIds(parent.second).includes(current.id)) {
    const rightWindow = leafWindowIds(parent.second)
      .map(candidate => windowById(table, candidate))
      .find(candidate => candidate != null)
    if (rightWindow) {
      const opened = openFileInWindow(table, rightWindow.id, path, { selectAsCurrent: true })
      return { table: opened.table, windowId: rightWindow.id }
    }
  }
  const split = splitWindow(table, current.id, 'horizontal', {
    forceSplit: true, virtualFile: path, fileIsSecondaryComponent: true,
  })
  return { table: split.table, windowId: split.newWindowId ?? current.id }
}

/**
 * `EditorWindow.kt:817-847` 的 `computeIndexToSelect` —— 关掉当前标签之后选中谁：
 *   · 关的不是当前标签 ⇒ 当前标签不动（`:819-822`）；
 *   · `activeMruEditorOnClose`（默认 false，`UISettingsState.kt:159`）⇒ 回**最近访问过且还开着**的文件
 *     （`:825-840`，倒着扫历史）；
 *   · `activeRightEditorOnClose`（默认 false）且右边还有标签 ⇒ 选右边那个（`:841-843`）；
 *   · 否则选左邻（`:846`），第一个位置则 `-1`（上游交给标签条自己决定）。
 */
export function selectIndexOnClose(
  window: EditorWindowState,
  path: string,
  options: { history?: readonly string[]; activeMruEditorOnClose?: boolean; activeRightEditorOnClose?: boolean } = {},
): number {
  const fileIndex = window.tabs.indexOf(path)
  if (fileIndex < 0) return -1
  if (window.active !== path) return window.tabs.indexOf(window.active)
  if (options.activeMruEditorOnClose === true) {
    const history = options.history ?? []
    for (let i = history.length - 1; i >= 0; i--) {
      const candidate = history[i]!
      if (candidate === path) continue
      const index = window.tabs.indexOf(candidate)
      if (index >= 0) return index
    }
  }
  if (options.activeRightEditorOnClose === true && fileIndex + 1 < window.tabs.length) return fileIndex + 1
  return fileIndex > 0 ? fileIndex - 1 : -1
}

/**
 * `EditorWindow.kt:685-739` 的 `closeFile`（窗口内的可见结果）：
 * 记 `removedTabs`（`:698-701`：先 `addLast`，**`size >= tabLimit` 就 `removeFirst`** ——
 * 于是栈里最多留 `tabLimit - 1` 条）、按 `selectIndexOnClose` 改选中（`:708-709`）、
 * `disposeIfNeeded` 且窗口空了 ⇒ `removeIfEmpty`（`:714`）⇒ `removeFromSplitter` + `dispose`
 * （`:767-774`、`:783-815`）。
 */
export function closeFileInWindow(
  table: WindowTable,
  windowId: number,
  path: string,
  options: {
    disposeIfNeeded?: boolean
    history?: readonly string[]
    activeMruEditorOnClose?: boolean
    activeRightEditorOnClose?: boolean
    tabLimit?: number
  } = {},
): { table: WindowTable; closed: boolean; emptied: boolean; selected: string } {
  const window = windowById(table, windowId)
  if (!window) return { table, closed: false, emptied: false, selected: '' }
  const index = window.tabs.indexOf(path)
  if (index < 0) return { table, closed: false, emptied: false, selected: window.active }
  const tabs = window.tabs.filter(candidate => candidate !== path)
  const selectIndex = selectIndexOnClose(window, path, options)
  const selected = tabs[selectIndex >= 0 ? Math.min(selectIndex, tabs.length - 1) : 0] ?? ''
  const limit = Math.max(1, options.tabLimit ?? EDITOR_TAB_LIMIT_DEFAULT)
  const closedStack = [...window.closed, { path, index, pinned: window.pinned.includes(path) } as ClosedTabRecord]
  while (closedStack.length >= limit) closedStack.shift()
  const updated: EditorWindowState = {
    ...window,
    tabs,
    active: window.active === path ? selected : window.active,
    pinned: window.pinned.filter(candidate => candidate !== path),
    preview: window.preview === path ? '' : window.preview,
    closed: closedStack,
  }
  let next: WindowTable = { ...table, windows: table.windows.map(candidate => candidate.id === windowId ? updated : candidate) }
  const emptied = tabs.length === 0
  if (emptied && options.disposeIfNeeded === true) {
    const sibling = siblingWindowIds(table, windowId)[0] ?? null
    next = {
      ...next,
      layout: removeLeaf(next.layout, windowId),
      windows: next.windows.filter(candidate => candidate.id !== windowId),
      current: next.current === windowId ? sibling : next.current,
    }
  }
  return { table: next, closed: true, emptied, selected }
}

/**
 * `EditorsSplitters.kt:947-949` 的 `closeFile(file, moveFocus)` + `:961-1003` 的 `closeFileInWindows`：
 * 在**所有**开着这个文件的窗口里关一遍，然后 `:992-1001` 清理空窗口 ——
 * 那一步调的是 `window.unsplit(setCurrent = false)`，即**空窗口把兄弟窗口的标签吸收进来**
 * （`unsplit` 第一句是"父不是 Splitter 就 return"，所以本来就没分屏的空窗口原地留着）。
 * 这是"关掉一个标签之后其它标签去哪"的真实答案：不是窗口消失，而是**兄弟窗口并进来**。
 */
export function closeFileEverywhere(
  table: WindowTable,
  path: string,
  options: {
    disposeIfNeeded?: boolean
    history?: readonly string[]
    activeMruEditorOnClose?: boolean
    activeRightEditorOnClose?: boolean
    tabLimit?: number
    normalizeSplits?: boolean
  } = {},
): WindowTable {
  let next = table
  for (const windowId of windowsShowing(next, path)) {
    next = closeFileInWindow(next, windowId, path, options).table
  }
  return cleanupEmptyWindows(next, options)
}

/** `EditorsSplitters.kt:992-1001` 的收尾循环：空窗口 `unsplit(setCurrent = false)`。 */
export function cleanupEmptyWindows(table: WindowTable, options: { tabLimit?: number; normalizeSplits?: boolean } = {}): WindowTable {
  let next = table
  for (const windowId of orderedWindows(table).map(window => window.id)) {
    const window = windowById(next, windowId)
    if (!window || window.tabs.length !== 0) continue
    next = unsplit(next, windowId, { setCurrent: false, tabLimit: options.tabLimit, normalizeSplits: options.normalizeSplits })
  }
  return next
}

/**
 * `EditorsSplitters.kt:710-733` 的 `closeAllFiles(repaint)`：
 * 先清空窗口表并 `dispose()` 每个窗口（`:713-717`），再逐个
 * `window.closeFile(file, disposeIfNeeded = false, transferFocus = false)`（`:725-729`），
 * 最后把当前窗口指针清掉（`:731-733`）。
 *
 * 这就是"**关掉独立窗口之后它的标签去哪**"的答案（`DockWindow.kt:262-271` 的 `windowClosing`
 * → `container.closeAll()` → `DockableEditorTabbedContainer.kt:322-326` 逐个 `close`）：
 * **标签被关掉**，各窗自己的 `removedTabs` 留着它们好让 Reopen Closed Tab 还原，
 * **不会**自动回到主窗口 —— 回主窗口只发生在打开时（`EditSourceInNewWindowAction.java:30-35`
 * 的 `CLOSING_TO_REOPEN`）。容器空了之后 `isEmpty`（`DockableEditorTabbedContainer.kt:333-334`）
 * 为真，`disposeWhenEmpty = true`（`DockableEditorContainerFactory.kt:72`）
 * ⇒ `DockWindow.closeIfEmpty()`（`DockWindow.kt:176-181`）关窗。
 */
export function closeAllFiles(table: WindowTable): {
  table: WindowTable
  closedPaths: string[]
  perWindow: { windowId: number; closed: ClosedTabRecord[] }[]
} {
  const ordered = orderedWindows(table)
  const closedPaths: string[] = []
  const perWindow: { windowId: number; closed: ClosedTabRecord[] }[] = []
  for (const window of ordered) {
    closedPaths.push(...window.tabs)
    const stack: ClosedTabRecord[] = [...window.closed]
    window.tabs.forEach((path, index) => {
      stack.push({ path, index, pinned: window.pinned.includes(path) })
      while (stack.length >= EDITOR_TAB_LIMIT_DEFAULT) stack.shift()
    })
    perWindow.push({ windowId: window.id, closed: stack })
  }
  const windows = table.windows.map(window => {
    const entry = perWindow.find(candidate => candidate.windowId === window.id)
    return entry ? { ...window, tabs: [], active: '', pinned: [], preview: '', closed: entry.closed } : window
  })
  return { table: { ...table, windows, current: null }, closedPaths, perWindow }
}

/**
 * `EditorWindow.kt:659-671` 的 `hasClosedTabs` / `restoreClosedTab`：
 * 从本窗栈顶取一个（`removeLastOrNull`，`:663`），重开并选中
 * （`:669` 的 `selectAsCurrent = true, requestFocus = true`）。
 */
export function restoreClosedTab(table: WindowTable, windowId: number): { table: WindowTable; path: string | null } {
  const window = windowById(table, windowId)
  const last = window?.closed[window.closed.length - 1]
  if (!window || !last) return { table, path: null }
  const popped = window.closed.slice(0, -1)
  const reopened = openFileInWindow(
    { ...table, windows: table.windows.map(candidate => candidate.id === windowId ? { ...candidate, closed: popped } : candidate) },
    windowId,
    last.path,
    { index: last.index, pin: last.pinned, selectAsCurrent: true },
  )
  return { table: reopened.table, path: last.path }
}

// ---------------------------------------------------------------------------
// 标签迁移
// ---------------------------------------------------------------------------

/**
 * `MoveEditorToOppositeTabGroupAction.kt:22-45`（默认构造器 `:20` 是 `closeSource = true`）：
 *   · **必须恰好一个兄弟窗口**（`:29-31`，否则整条动作不动）；
 *   · 置 `CLOSING_TO_REOPEN`（`:34`）后关源窗口里的它（`:36`，`disposeIfNeeded = true`），
 *     再在兄弟窗口里打开（`:38-43`，`entry` 带着原状态），最后清标记（`:44`）。
 */
export function moveTabToOppositeGroup(
  table: WindowTable,
  fromWindowId: number,
  path: string,
  options: { history?: readonly string[]; tabLimit?: number } = {},
): { table: WindowTable; moved: boolean; reason: string } {
  const siblings = siblingWindowIds(table, fromWindowId)
  if (siblings.length !== 1) return { table, moved: false, reason: '必须恰好有一个相邻分栏才能移动。' }
  const closed = closeFileInWindow(table, fromWindowId, path, options)
  if (!closed.closed) return { table, moved: false, reason: '这个文件不在那一栏里。' }
  const opened = openFileInWindow(closed.table, siblings[0]!, path, { selectAsCurrent: true })
  return { table: opened.table, moved: true, reason: '' }
}

/**
 * `OpenEditorInOppositeTabGroupAction`（`MoveEditorToOppositeTabGroupAction.kt:70`，`closeSource = false`）
 * —— 同一条路但**不关源**，于是文件同时出现在两栏（本仓的 "split same"）。
 */
export function openCopyInOppositeGroup(
  table: WindowTable,
  fromWindowId: number,
  path: string,
): { table: WindowTable; opened: boolean; reason: string } {
  const siblings = siblingWindowIds(table, fromWindowId)
  if (siblings.length !== 1) return { table, opened: false, reason: '必须恰好有一个相邻分栏。' }
  const opened = openFileInWindow(table, siblings[0]!, path, { selectAsCurrent: true })
  return { table: opened.table, opened: true, reason: '' }
}

/**
 * `SplitAction.isEnabled`（`SplitAction.java:73-82`）：
 *   · `forbidSplitFor(file)` 且不是"搬走"档 ⇒ 不可用（`:77-79`）；
 *   · 标签数下限：搬走档（`closeSource = true`）要 **2** 个，保留档要 **1** 个（`:80-81`）。
 */
export function splitActionAvailability(
  tabCount: number,
  options: { closeSource?: boolean; forbidTabSplit?: boolean } = {},
): { enabled: boolean; reason: string } {
  const closeSource = options.closeSource === true
  if (!closeSource && forbidSplit(options)) return { enabled: false, reason: '这个文件不允许同时出现在两个编辑器里。' }
  const minimum = closeSource ? 2 : 1
  if (tabCount < minimum) {
    return { enabled: false, reason: closeSource ? '这一栏至少要两个标签才能搬走一个。' : '这一栏至少要有一个标签。' }
  }
  return { enabled: true, reason: '' }
}

/**
 * `SplitAction.actionPerformed`（`SplitAction.java:35-57`）的落地：
 * 先（搬走档）关源（`:43-54`），再 `window.split(orientation, true, file, true)`（`:56`）。
 * `SplitVerticallyAction` 传 `SwingConstants.VERTICAL`（`SplitVerticallyAction.java:8`）、
 * `SplitHorizontallyAction` 传 `SwingConstants.HORIZONTAL`（`SplitHorizontallyAction.java:8`），
 * 经 `EditorWindow.kt:529` 的换算得到 `vertical`（上下）/ `horizontal`（左右）两档 —— 见 `SplitOrientation`。
 */
export function splitTab(
  table: WindowTable,
  windowId: number,
  path: string,
  orientation: SplitOrientation,
  options: { closeSource?: boolean; history?: readonly string[] } = {},
): { table: WindowTable; newWindowId: number | null; reason: string } {
  const window = windowById(table, windowId)
  if (!window) return { table, newWindowId: null, reason: '没有这个分栏。' }
  const availability = splitActionAvailability(window.tabs.length, { closeSource: options.closeSource })
  if (!availability.enabled) return { table, newWindowId: null, reason: availability.reason }
  let next = table
  if (options.closeSource === true) {
    const closed = closeFileInWindow(next, windowId, path, { history: options.history })
    if (!closed.closed) return { table, newWindowId: null, reason: '这个文件不在那一栏里。' }
    next = closed.table
  }
  const split = splitWindow(next, windowId, orientation, {
    forceSplit: true, virtualFile: path, focusNew: true, fileIsSecondaryComponent: true,
  })
  return { table: split.table, newWindowId: split.newWindowId, reason: split.newWindowId == null ? '这一栏没有可分屏的标签。' : '' }
}

/** `MoveTabRightAction.java:11` / `MoveTabDownAction.java:11` —— 两档都是 `closeSource = true`。 */
export const MOVE_TAB_RIGHT_ORIENTATION: SplitOrientation = 'horizontal'
export const MOVE_TAB_DOWN_ORIENTATION: SplitOrientation = 'vertical'

/**
 * 拖出标签（`EditorTabbedContainer.kt:469-540` 的 `EditorTabbedContainerDragOutDelegate`）：
 * 起拖时先挑一个接替的选中标签（`:477-486`）并记下起始下标与固定状态（`:489-491`）；
 * 落地时**非复制**档置 `CLOSING_TO_REOPEN` 后 `closeFile`（`:519-527`）；
 * `Ctrl` 或容器回 `ACCEPT_COPY` 是复制档（`:515-518`，源标签取消隐藏）。
 */
export function dragOutStart(
  table: WindowTable,
  windowId: number,
  path: string,
  options: { history?: readonly string[] } = {},
): { table: WindowTable; startIndex: number; pinnedAtStart: boolean; selected: string } {
  const window = windowById(table, windowId)
  if (!window) return { table, startIndex: -1, pinnedAtStart: false, selected: '' }
  const startIndex = window.tabs.indexOf(path)
  // `getTabToSelect`（`:481-485`）拿不到接替者时是 null ⇒ 这里给空串，不擅自选第一个。
  const selectIndex = selectIndexOnClose(window, path, options)
  const selected = selectIndex >= 0 ? (window.tabs[selectIndex] ?? '') : ''
  return { table, startIndex, pinnedAtStart: window.pinned.includes(path), selected }
}

export function dragOutFinish(
  table: WindowTable,
  fromWindowId: number,
  path: string,
  options: { copy?: boolean; toWindowId?: number; index?: number; history?: readonly string[] } = {},
): { table: WindowTable; closedInSource: boolean; movedTo: number | null } {
  if (options.copy === true) return { table, closedInSource: false, movedTo: null }
  const closed = closeFileInWindow(table, fromWindowId, path, { history: options.history })
  if (!closed.closed) return { table, closedInSource: false, movedTo: null }
  if (options.toWindowId == null) return { table: closed.table, closedInSource: true, movedTo: null }
  const opened = openFileInWindow(closed.table, options.toWindowId, path, { index: options.index, selectAsCurrent: true })
  return { table: opened.table, closedInSource: true, movedTo: options.toWindowId }
}

/**
 * `DockableEditorTabbedContainer.kt:167-235` 的 `add(...)`：
 *   · 落点有档位且不是 `CENTER`（`:176`）⇒ 在**目标窗口**上 `split`，
 *     `BOTTOM`/`TOP` 走 `JSplitPane.VERTICAL_SPLIT`（`:178`）、
 *     `fileIsSecondaryComponent = dropSide != LEFT && dropSide != TOP`（`:182`）
 *     ⇒ 落在左/上时新组排在前面；
 *   · 否则按 `dropInfoIndex` 插进目标窗口的标签条（`:196`、`:232`）；
 *   · `editor.keep.pinned.tabs.on.left`（默认 true）时还有"插在固定标签之间"的判定（`:197-229`），
 *     本仓只做它的可见结论：`pin` 跟随来源（`:232` 的 `dropInBetweenPinnedTabs ?: dockableEditor.isPinned`）。
 */
export function dropTabOnWindow(
  table: WindowTable,
  options: {
    path: string
    fromWindowId: number
    toWindowId: number
    dropSide: DropSide
    index?: number
    pin?: boolean
    history?: readonly string[]
  },
): { table: WindowTable; splitWindowId: number | null; actionId: string | null } {
  const { path, fromWindowId, toWindowId, dropSide } = options
  const actionId = dragDropActionId(dropSide)
  if (dropSide !== 'CENTER' && windowById(table, toWindowId)) {
    const orientation: SplitOrientation = dropSide === 'TOP' || dropSide === 'BOTTOM' ? 'vertical' : 'horizontal'
    const fileIsSecondary = dropSide !== 'LEFT' && dropSide !== 'TOP'
    let next = table
    if (fromWindowId !== toWindowId) {
      const closed = closeFileInWindow(next, fromWindowId, path, { history: options.history })
      if (closed.closed) next = closed.table
    }
    const split = splitWindow(next, toWindowId, orientation, {
      forceSplit: true, virtualFile: path, focusNew: true, fileIsSecondaryComponent: fileIsSecondary,
    })
    return { table: split.table, splitWindowId: split.newWindowId, actionId }
  }
  let next = table
  const source = windowById(next, fromWindowId)
  const pinned = options.pin ?? source?.pinned.includes(path) ?? false
  if (fromWindowId !== toWindowId) {
    const closed = closeFileInWindow(next, fromWindowId, path, { history: options.history })
    if (closed.closed) next = closed.table
  }
  const opened = openFileInWindow(next, toWindowId, path, { index: options.index, pin: pinned, selectAsCurrent: true })
  return { table: opened.table, splitWindowId: null, actionId }
}

/**
 * `DockableEditorTabbedContainer.kt:237-246` 的 `recordDragStats`：落点 → 统计 id。
 * `-1`（没有落点 = 拖到新建窗口）是 `OpenElementInNewWindow`（`:239`）。
 */
export function dragDropActionId(dropSide: DropSide | null): string | null {
  switch (dropSide) {
    case 'TOP': return 'SplitVertically'
    case 'LEFT': return 'SplitHorizontally'
    case 'BOTTOM': return 'MoveTabDown'
    case 'RIGHT': return 'MoveTabRight'
    default: return null
  }
}

// ---------------------------------------------------------------------------
// 独立窗口的可用性判据（DockableEditorTabbedContainer 那一档）
// ---------------------------------------------------------------------------

/**
 * `EditSourceInNewWindowAction.update`（`EditSourceInNewWindowAction.java:47-50`）：
 * 有 project 且 `getVirtualFiles(e).length == 1`（`getVirtualFiles` 在 `:39-45` 把目录滤掉）
 * —— 即**恰好一个非目录文件**。
 */
export function editSourceInNewWindowAvailable(input: { hasProject: boolean; fileCount: number; isDirectory: boolean }): boolean {
  return input.hasProject && !input.isDirectory && input.fileCount === 1
}

export interface NewWindowDecision {
  /** 这一档能不能兑现。 */
  allowed: boolean
  /** `reuse` = 复用已开的独立窗口；`create` = 新建容器；`none` = 什么都不做。 */
  action: 'reuse' | 'create' | 'none'
  /** `forbidSplitFor(file)` 时上游会先把别处的副本关掉（`FileEditorManagerImpl.kt:1073-1075`）。 */
  closeExistingCopies: boolean
  reason: string
}

/**
 * `FileEditorManagerImpl.kt:1048-1091` 的 `NEW_WINDOW` 分支（入口是 `:1279-1289` 的
 * `openFileInNewWindow`，固定 `openMode = NEW_WINDOW`、`requestFocus = true`）：
 *   · `reuseOpen` 且**别的容器**里已经有窗口开着这个文件 ⇒ 复用那个窗口（`:1051-1071`）；
 *   · `forbidSplitFor(file)` ⇒ 先 `closeFile(file)`（`:1073-1075`）；
 *   · 然后 `DockManagerImpl.createNewDockContainerFor(...)`（`:1081-1090`）——
 *     那要求 `DockManager` 里注册了 `file-editors` 工厂（`DockableEditorContainerFactory.kt:16`）
 *     且宿主真能开一帧窗口（`DockManagerImpl.kt:449-498` 里 `window.show(true)`）。
 * 本仓把"能不能开"如实交给 `editorWindows.ts` 的 `canDetachEditor`（浮层容器在 DOM 里、
 * 或浏览器档能 `window.open`），不重复造能力探测。
 */
export function newWindowAvailability(request: {
  fileCount: number
  isDirectory: boolean
  hasProject: boolean
  reuseOpen?: boolean
  existingWindowWithFile?: boolean
  forbidTabSplit?: boolean
  capability: DetachedWindowCapability
  containerTypeRegistered?: boolean
}): NewWindowDecision {
  const closeExistingCopies = forbidSplit(request)
  if (!editSourceInNewWindowAvailable(request)) {
    return { allowed: false, action: 'none', closeExistingCopies, reason: '要在新窗口里打开，需要恰好一个非目录文件。' }
  }
  if (request.reuseOpen === true && request.existingWindowWithFile === true) {
    return { allowed: true, action: 'reuse', closeExistingCopies, reason: '' }
  }
  if (request.containerTypeRegistered === false) {
    return { allowed: false, action: 'none', closeExistingCopies, reason: `宿主没有注册 ${DOCK_CONTAINER_TYPE} 容器。` }
  }
  if (!canDetachEditor(request.capability)) {
    return { allowed: false, action: 'none', closeExistingCopies, reason: '宿主开不出独立窗口，也没有可浮出的容器。' }
  }
  return { allowed: true, action: 'create', closeExistingCopies, reason: '' }
}

/**
 * `EditorWindow.kt:638-642` 的 `updateTabsVisibility`：
 * 浮动窗口里只有一个标签且这个编辑器"独享窗口"时**藏掉标签条**（`:639`），或
 * `editorTabPlacement == TABS_NONE`（`UISettings.TABS_NONE = 0`，`:640`），或
 * 演示模式且没开 `ide.editor.tabs.visible.in.presentation.mode`（`:641`）。
 */
export function tabsHiddenInWindow(input: {
  floating: boolean
  tabCount: number
  singletonEditorInWindow: boolean
  tabPlacement: TabPlacement
  presentationMode: boolean
  tabsVisibleInPresentationMode?: boolean
}): boolean {
  if (input.floating && input.tabCount === 1 && input.singletonEditorInWindow) return true
  if (input.tabPlacement === 'none') return true
  return input.presentationMode && input.tabsVisibleInPresentationMode !== true
}

/**
 * `DockableEditorTabbedContainer.kt:333-335` 的 `isEmpty` / `isDisposeWhenEmpty`：
 * 只有"首次展示时那批文件开完了"（`fileOpeningCompleted`，`:337-342` 的 `showNotify`）
 * 且所有窗口都空（`splitters.isEmptyVisible`，`EditorsSplitters.kt:933-934`）容器才算空；
 * `disposeWhenEmpty` 由工厂固定传 **true**（`DockableEditorContainerFactory.kt:72`）。
 */
export function containerIsEmpty(input: { fileOpeningCompleted: boolean; windowsEmptyVisible: boolean }): boolean {
  return input.fileOpeningCompleted && input.windowsEmptyVisible
}

export function containerDisposesWhenEmpty(): boolean {
  return true
}

/**
 * `DockableEditorTabbedContainer.kt:125-128` 的 `getContentResponse`：
 * 找得到标签条且标签条**没被藏起来**才 `ACCEPT_MOVE`；`:144` 的兜底是
 * "当前窗口，再退第一个窗口"。
 */
export function acceptsTabDrop(input: { tabsFound: boolean; hideTabs: boolean }): boolean {
  return input.tabsFound && !input.hideTabs
}
