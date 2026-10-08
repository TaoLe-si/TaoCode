// **编辑器多窗口 · 窗口生命周期 + 分屏树**（上游 `EditorsSplitters` 的窗口表 + `EditorWindow`
// 的分裂/合并/持久化）的纯规则层：零 Vue、零 DOM。
//
// 为什么单独一个文件：本仓已有两个模块各占一半，谁都不管"窗口"这件事 ——
//   · `src/editorWindows.ts` 管**手势与几何**：`getOpenMode` 判档（`FileEditorManagerImpl.kt:2596-2619`）、
//     浮层几何、`?detached=` 浏览器档、宿主能力探测；
//   · `src/detachedEditorsHost.ts` 管那一档的**宿主状态**：一个扁平 `DetachedEditor[]`
//     （path + 原位 pane/index），摘出/放回。
// 上游 `NEW_WINDOW` 档落地的是一个**独立 `DockableEditorTabbedContainer`**，它自带一个
// `EditorsSplitters`，于是自带一整套**窗口表 + 分屏树**（`DockableEditorContainerFactory.kt:49-73`
// 的匿名子类）。本仓的 `DetachedEditor` 只是"某一栏里的一个标签浮出来了"，没有窗口表、
// 没有嵌套分屏、没有"窗口空了之后它的标签去哪"。
//
// 职责边界：**本文件 = 窗口与分屏树**（建/加/删窗口、当前窗口、split/unsplit/翻转方向/
// 比例归一化、树与持久化形状）。**标签的开关与窗口间迁移**在 `src/editorTabMigrationRules.ts`。
//
// 复用而不重写（见报告第 5 节）：`NEW_WINDOW` 档**能不能兑现**仍由 `editorWindows.ts` 的
// `canDetachEditor` / `DetachedWindowCapability` 说了算（宿主能力探测只有一处真相），
// 本模块只接它的结论。`OpenMode` 手势判档、浮层几何、拖出边界（`dropDetachesTab`）也不重复实现。
//
// 判据：`tests/editor-window-rules.test.mjs`。

/** `UISettingsState.kt:68` —— `editorTabLimit` 默认 30（`EditorWindow.kt:97-107` 的 `tabLimit`）。 */
export const EDITOR_TAB_LIMIT_DEFAULT = 30

/** `EditorWindow.kt:529` —— `createSplitter(proportion = 0.5f, minProp = 0.1f, maxProp = 0.9f)`。 */
export const SPLIT_DEFAULT_PROPORTION = 0.5
export const SPLIT_MIN_PROPORTION = 0.1
export const SPLIT_MAX_PROPORTION = 0.9

/**
 * `intellij.platform.ide.impl.xml:1513` —— `editor.normalize.splits` 默认 **false**
 * （`EditorWindow.kt:582-614` 的 `normalizeProportionsIfNeed` 因此默认不生效）。
 */
export const NORMALIZE_SPLITS_DEFAULT = false

/**
 * 分屏方向。上游 `EditorWindow.split(orientation: Int)`（`EditorWindow.kt:488-495`）收的是
 * `JSplitPane` 常量，再换算成 `Splitter.isVertical`（`:529` 的 `orientation == JSplitPane.VERTICAL_SPLIT`）：
 *   · `vertical`   ⇒ 两块**上下**叠放（`Splitter.java:88-92`：`vertical = true` 即 above one another）；
 *   · `horizontal` ⇒ 两块**左右**并排。
 * `SplitVerticallyAction` 传 `SwingConstants.VERTICAL = 1`（`SplitVerticallyAction.java:8`），
 * 而 `JSplitPane.VERTICAL_SPLIT = 0` ⇒ 换算后 `vertical = false` ⇒ **左右并排**，
 * 与它的文案 "Split Right"（`ActionsBundle.properties:1257`）一致。
 */
export type SplitOrientation = 'horizontal' | 'vertical'

// ---------------------------------------------------------------------------
// 分屏树
// ---------------------------------------------------------------------------

/**
 * 树的一格。上游是 `Splitter` / `EditorWindowHolder` 两种组件
 * （`EditorsSplitters.kt:1272-1298` 的 `writePanel` 只认这两种）：`Splitter` 有
 * `firstComponent` / `secondComponent`，`EditorWindowHolder` 就是一个窗口
 * （`EditorWindowHolder.java` 只有 `getEditorWindow()` 一个方法）。
 */
export interface LeafNode { kind: 'leaf'; window: number }
export interface SplitNode {
  kind: 'split'
  orientation: SplitOrientation
  /** `EditorWindow.kt:529` 初值 0.5，夹在 0.1..0.9。 */
  proportion: number
  first: LayoutNode
  second: LayoutNode
}
export type LayoutNode = LeafNode | SplitNode

/** 一个 `EditorWindow`（`EditorWindow.kt:78-129` 里对本仓可见的那些字段）。 */
export interface EditorWindowState {
  id: number
  /** 标签顺序（上游 `tabbedPane.tabs.tabs` 的顺序）。 */
  tabs: string[]
  /** `selectedComposite` 对应的标签（上游 `selectedFile`）。 */
  active: string
  /** 固定标签（上游 `composite.isPinned`）。 */
  pinned: string[]
  /** 预览标签位（上游 `composite.isPreview`；`addComposite` :344-346 按它定位）。 */
  preview: string
  /** `EditorWindow.kt:119` 的 `removedTabs`：本窗关掉的标签，**栈**（新关的在后）。 */
  closed: ClosedTabRecord[]
  /** `EditorsSplitters.kt:902` / `DockableEditorContainerFactory.kt:66-67` 的 `isFloating`。 */
  floating: boolean
}

/** `EditorWindow.kt:1163-1173` 的 `RemovedTabInfo`：文件 + 它当时的开法（含原位下标）。 */
export interface ClosedTabRecord { path: string; index: number; pinned: boolean }

/** 一个 `EditorsSplitters`：窗口表 + 分屏树 + 当前窗口（`EditorsSplitters.kt:204-223`）。 */
export interface WindowTable {
  windows: EditorWindowState[]
  layout: LayoutNode
  /** `_currentWindowFlow`（`EditorsSplitters.kt:204-216`）；没有窗口时是 null。 */
  current: number | null
  nextId: number
}

/** 新开一张只有一个窗口、一个标签的窗口表。 */
export function createWindowTable(tabs: readonly string[] = [], active = tabs[0] ?? '', floating = false): WindowTable {
  const window: EditorWindowState = {
    id: 0, tabs: [...tabs], active: tabs.includes(active) ? active : (tabs[0] ?? ''),
    pinned: [], preview: '', closed: [], floating,
  }
  return { windows: [window], layout: { kind: 'leaf', window: 0 }, current: 0, nextId: 1 }
}

export function windowById(table: WindowTable, id: number): EditorWindowState | null {
  return table.windows.find(window => window.id === id) ?? null
}

/** 树里的叶子顺序 —— 上游 `getOrderedWindows()`（`EditorsSplitters.kt:1099-1119`）的遍历序。 */
export function leafWindowIds(node: LayoutNode): number[] {
  if (node.kind === 'leaf') return [node.window]
  return [...leafWindowIds(node.first), ...leafWindowIds(node.second)]
}

/** 按树序排好的窗口表（上游 `getOrderedWindows` 的断言：条数必须与窗口表一致）。 */
export function orderedWindows(table: WindowTable): EditorWindowState[] {
  return leafWindowIds(table.layout)
    .map(id => windowById(table, id))
    .filter((window): window is EditorWindowState => window != null)
}

/** `EditorsSplitters.kt:1796-1801` 的 `getSplitCount`：叶子数（1 = 没分屏）。 */
export function splitCount(node: LayoutNode): number {
  return node.kind === 'leaf' ? 1 : splitCount(node.first) + splitCount(node.second)
}

/** 包住这个叶子的 `Splitter`（`EditorWindow.kt:909-912` 的 `inSplitter()` 读的就是 `parent`）。 */
export function parentSplitterOf(node: LayoutNode, id: number): SplitNode | null {
  if (node.kind === 'leaf') return null
  if (node.first.kind === 'leaf' && node.first.window === id) return node
  if (node.second.kind === 'leaf' && node.second.window === id) return node
  return parentSplitterOf(node.first, id) ?? parentSplitterOf(node.second, id)
}

/** `EditorWindow.kt:909-912` —— 窗口的父组件是不是 `Splitter`。 */
export function isInSplitter(table: WindowTable, id: number): boolean {
  return parentSplitterOf(table.layout, id) != null
}

/**
 * 同一 `Splitter` 子树下的其它窗口 —— 上游 `siblings()`（`EditorWindow.kt:624-628`：
 * `isDescendingFrom(it.component, splitter)`，所以嵌套的也算）。
 */
export function siblingWindowIds(table: WindowTable, id: number): number[] {
  const parent = parentSplitterOf(table.layout, id)
  if (!parent) return []
  return leafWindowIds(parent).filter(candidate => candidate !== id)
}

/** 上游 `findWindows(file)`（`EditorsSplitters.kt:1090`）：哪些窗口开着这个文件。 */
export function windowsShowing(table: WindowTable, path: string): number[] {
  return orderedWindows(table).filter(window => window.tabs.includes(path)).map(window => window.id)
}

export function windowShowing(table: WindowTable, path: string): EditorWindowState | null {
  const id = windowsShowing(table, path)[0]
  return id === undefined ? null : windowById(table, id)
}

// ---------------------------------------------------------------------------
// 窗口表：建 / 加 / 删 / 当前窗口
// ---------------------------------------------------------------------------

/**
 * `EditorsSplitters.kt:1042-1048` 的 `createCurrentWindow()`：**只在没有当前窗口时**建一个空窗口
 * （上游那一行是 `LOG.assertTrue(currentWindow == null)`），加进窗口表并设为当前。
 * 本仓不抛断言，返回 `created: false` 如实说明"已经有窗口了"。
 */
export function createCurrentWindow(table: WindowTable, floating = false): { table: WindowTable; created: boolean } {
  if (table.current != null) return { table, created: false }
  return { table: addWindow(table, [], floating), created: true }
}

/** `EditorsSplitters.kt:1070-1074` 的 `addWindow`：登记窗口 + 取消空态创建（空态那一半不在本仓）。 */
export function addWindow(table: WindowTable, tabs: readonly string[] = [], floating = false): WindowTable {
  const id = table.nextId
  const window: EditorWindowState = {
    id, tabs: [...tabs], active: tabs[0] ?? '', pinned: [], preview: '', closed: [], floating,
  }
  // 新窗口的叶子挂在当前窗口旁边（上游只有先 `split` 才进树，这是同一结果的模型侧写法）。
  const anchor = table.current ?? table.windows[table.windows.length - 1]?.id
  const layout = anchor == null
    ? { kind: 'leaf', window: id } as LayoutNode
    : insertLeafAfter(table.layout, anchor, id)
  return { windows: [...table.windows, window], layout, current: id, nextId: id + 1 }
}

/**
 * `EditorWindow.kt:783-815` 的 `removeFromSplitter()`：窗口从它的 `Splitter` 里摘掉，
 * **另一个组件顶替那个 `Splitter` 的位置**（父还是 `Splitter` 就顶进父的一侧，父是
 * `EditorsSplitters` 就 `clearEditorComponent()` + `addEditorComponent(otherComponent)`，`:795-813`），
 * 然后 `dispose()`（`:814`）。不在分屏里（`:784-786`）直接 return —— 窗口原地留着。
 * `EditorsSplitters.kt:1076-1081` 的 `removeWindow` 只管窗口表与当前窗口指针。
 */
export function removeWindow(table: WindowTable, id: number): WindowTable {
  const windows = table.windows.filter(window => window.id !== id)
  const layout = windows.length === 0 ? { kind: 'leaf', window: id } as LayoutNode : removeLeaf(table.layout, id)
  return { ...table, windows, layout, current: table.current === id ? null : table.current }
}

/** 把叶子换成它的兄弟子树（"另一个组件顶替"）。 */
export function removeLeaf(node: LayoutNode, id: number): LayoutNode {
  if (node.kind === 'leaf') return node
  if (node.first.kind === 'leaf' && node.first.window === id) return node.second
  if (node.second.kind === 'leaf' && node.second.window === id) return node.first
  return { ...node, first: removeLeaf(node.first, id), second: removeLeaf(node.second, id) }
}

/** 把整棵子树压成只剩这个叶子的一个格子（"本窗口组件顶替掉整个 Splitter"，`EditorWindow.kt:889-891`）。 */
export function collapseToSelf(node: LayoutNode, id: number): LayoutNode {
  if (node.kind === 'leaf') return node
  const directChild = (node.first.kind === 'leaf' && node.first.window === id)
    || (node.second.kind === 'leaf' && node.second.window === id)
  if (directChild) return { kind: 'leaf', window: id }
  return { ...node, first: collapseToSelf(node.first, id), second: collapseToSelf(node.second, id) }
}

/** 把一个新叶子插到某个窗口旁边（`addWindow` 用）。 */
function insertLeafAfter(node: LayoutNode, afterId: number, newId: number): LayoutNode {
  if (node.kind === 'leaf') {
    if (node.window !== afterId) return node
    return {
      kind: 'split', orientation: 'horizontal', proportion: SPLIT_DEFAULT_PROPORTION,
      first: node, second: { kind: 'leaf', window: newId },
    }
  }
  return { ...node, first: insertLeafAfter(node.first, afterId, newId), second: insertLeafAfter(node.second, afterId, newId) }
}

/** 把树里某个叶子换成另一棵子树（上游 `swapComponents`，`EditorWindow.kt:1143-1158`）。 */
export function replaceLeaf(node: LayoutNode, id: number, replacement: LayoutNode): LayoutNode {
  if (node.kind === 'leaf') return node.window === id ? replacement : node
  return { ...node, first: replaceLeaf(node.first, id, replacement), second: replaceLeaf(node.second, id, replacement) }
}

/**
 * `EditorWindow.kt:654-657` 的 `dispose()`（取消作用域 + `owner.removeWindow(this)`）；
 * `:767-774` 的 `removeIfEmpty()` 是它的前置闸 —— **`tabCount == 0` 才摘**。
 */
export function windowDisposesWhenEmpty(table: WindowTable, id: number): boolean {
  const window = windowById(table, id)
  return window != null && window.tabs.length === 0
}

/**
 * `EditorsSplitters.kt:1020-1040` 的 `getOrCreateCurrentWindow(file)`：
 *   ① 没有当前窗口 ⇒ 优先挑**已经开着这个文件**的窗口（`:1021-1025`）；再退"随便哪个窗口"
 *      （`:1027-1033`）；都没有才新建（`:1029`）；
 *   ② 有当前窗口、这个文件开在别的窗口里而当前窗口没开 ⇒ 当前窗口切过去（`:1036-1038`）。
 * `EditorsSplitters.kt:737-742` 的 `setCurrentWindow` 只改 `_currentWindowFlow`。
 */
export function getOrCreateCurrentWindow(table: WindowTable, path: string): WindowTable {
  const showing = windowsShowing(table, path)
  if (table.current == null) {
    if (showing.length > 0) return { ...table, current: showing[0]! }
    const any = orderedWindows(table)[0]
    if (any) return { ...table, current: any.id }
    return createCurrentWindow(table).table
  }
  if (showing.length > 0 && !showing.includes(table.current)) return { ...table, current: showing[0]! }
  return table
}

/** `EditorsSplitters.kt:737-742` / `:1056-1062` 的 `setCurrentWindow`（`requestFocus` 那一半归 UI）。 */
export function setCurrentWindow(table: WindowTable, id: number | null): WindowTable {
  if (id != null && windowById(table, id) == null) return table
  return { ...table, current: id }
}

/**
 * `FileEditorManagerImpl.kt:2818-2826` 的 `isSingletonDockWindow`：窗口在**别的** dock 容器里
 * （不是主 splitters），且只有一个标签、且那个标签是"独享窗口"的编辑器
 * （`isSingletonFileEditor`，`:2815-2816` 读 `SINGLETON_EDITOR_IN_WINDOW`）。
 */
export function isSingletonDockWindow(table: WindowTable, id: number, singletonEditorInWindow: boolean): boolean {
  const window = windowById(table, id)
  if (!window || !window.floating) return false
  return window.tabs.length === 1 && singletonEditorInWindow
}

/**
 * `DiffEditorTabFilesManagerImpl.kt:157-159` 的 `isSingletonEditorInWindow`：
 * 浮动 splitters 里只有一个标签 —— 这一档的窗口**不承接别的文件**
 * （`FileEditorManagerKeys.kt:71-85` 的 `SINGLETON_EDITOR_IN_WINDOW` 注释就是这条语义）。
 */
export function isSingletonEditorInWindow(table: WindowTable, id: number): boolean {
  const window = windowById(table, id)
  return window != null && window.floating && window.tabs.length === 1
}

/**
 * `FileEditorManagerImpl.kt:1216-1230` 的 `getWindowToOpen`。`EDITOR_OPEN_INACTIVE_SPLITTER`
 * 默认 `true`（`intellij.platform.ide.impl.xml:1505`），于是
 * `forceUseActiveSplitter = !true = false`（`:1220`），走
 * `options.reuseOpen ? findWindowInAllSplitters(file) : null`（`:1223`）——
 * 默认档 `existingWindow = null`，落到 `getOrCreateCurrentWindow(file)`（`:1229`）。
 * 命中 `isSingletonDockWindow` 的窗口**不**承接别的文件（`:1226`），此时也退到它。
 */
export function openTargetWindow(
  table: WindowTable,
  path: string,
  options: { reuseOpen?: boolean; singletonEditorInWindow?: boolean } = {},
): { table: WindowTable; windowId: number } {
  if (options.reuseOpen === true) {
    const candidate = windowShowing(table, path)
    if (candidate && !isSingletonDockWindow(table, candidate.id, options.singletonEditorInWindow === true)) {
      return { table, windowId: candidate.id }
    }
  }
  const next = getOrCreateCurrentWindow(table, path)
  const window = windowById(next, next.current ?? -1)
  if (window) return { table: next, windowId: window.id }
  const created = createCurrentWindow(next)
  return { table: created.table, windowId: created.table.current! }
}

/**
 * `FileEditorManagerImpl.kt:1257-1266` 的 `getOrCreateCurrentWindow` 前半段：
 * 当前选中的是"独享窗口"的编辑器、它孤零零地待在一个分屏里（`tabCount == 1`）⇒
 * 新标签落到**兄弟**窗口，免得把那个独享编辑器挤掉。
 */
export function preferSiblingForSingleton(table: WindowTable): number | null {
  const current = table.current == null ? null : windowById(table, table.current)
  if (!current) return null
  if (!isSingletonEditorInWindow(table, current.id)) return null
  if (!isInSplitter(table, current.id)) return null
  return siblingWindowIds(table, current.id)[0] ?? null
}

// ---------------------------------------------------------------------------
// 分裂 / 合并
// ---------------------------------------------------------------------------

/**
 * `EditorWindow.kt:497-580` 的 `split(...)`。逐条：
 *   · `tabCount < 1` ⇒ 返回 null（`:507-509`，空窗口分不了屏）；
 *   · `!forceSplit && inSplitter()` ⇒ **不新建**，把文件开进第一个兄弟窗口并返回它
 *     （`:511-523`，这是 `OpenInRightSplit` 的"复用"档）；
 *   · 新建 `Splitter(0.5, 0.1, 0.9)`（`:529`）顶替原窗口组件（`:538`）；
 *   · `fileIsSecondaryComponent` 决定新窗口放 `firstComponent` 还是 `secondComponent`
 *     （`:539-546`）；拖放落点在 LEFT/TOP 时传 `false`（`DockableEditorTabbedContainer.kt:182`）
 *     ⇒ 新组在上/左；
 *   · 新窗口**只开选中的那一个文件**（`:550-551` 的注释与 `nextFile`），不是克隆全部标签
 *     —— 源窗口的标签一个不少地留在原地；
 *   · `selectAsCurrent = focusNew`（`:560`）⇒ 不聚焦时当前窗口不变。
 */
export function splitWindow(
  table: WindowTable,
  id: number,
  orientation: SplitOrientation,
  options: { forceSplit?: boolean; virtualFile?: string; focusNew?: boolean; fileIsSecondaryComponent?: boolean } = {},
): { table: WindowTable; newWindowId: number | null; reusedWindowId: number | null } {
  const window = windowById(table, id)
  if (!window || window.tabs.length < 1) return { table, newWindowId: null, reusedWindowId: null }
  if (options.forceSplit !== true && isInSplitter(table, id)) {
    const target = siblingWindowIds(table, id)[0]
    if (target !== undefined) return { table, newWindowId: null, reusedWindowId: target }
  }
  const nextFile = options.virtualFile ?? window.active
  const newId = table.nextId
  const self: LeafNode = { kind: 'leaf', window: id }
  const fresh: LeafNode = { kind: 'leaf', window: newId }
  const fileIsSecondary = options.fileIsSecondaryComponent !== false
  const splitter: SplitNode = {
    kind: 'split',
    orientation,
    proportion: SPLIT_DEFAULT_PROPORTION,
    first: fileIsSecondary ? self : fresh,
    second: fileIsSecondary ? fresh : self,
  }
  const newWindow: EditorWindowState = {
    id: newId,
    tabs: nextFile ? [nextFile] : [],
    active: nextFile,
    pinned: nextFile && window.pinned.includes(nextFile) ? [nextFile] : [],
    preview: '',
    closed: [],
    floating: window.floating,
  }
  return {
    table: {
      ...table,
      windows: [...table.windows, newWindow],
      layout: replaceLeaf(table.layout, id, splitter),
      current: options.focusNew === false ? table.current : newId,
      nextId: newId + 1,
    },
    newWindowId: newId,
    reusedWindowId: null,
  }
}

/**
 * `EditorWindow.kt:858-900` 的 `unsplit(setCurrent)` —— **关闭时如何合并**：
 *   · 兄弟窗口（同一 `Splitter` 子树里的其它窗口，`:861`）的每个 composite 合进本窗口，
 *     条件是"本窗口还没有这个文件"且"本窗口标签数 < `editorTabLimit`"（`:874`）；
 *   · 合不进来的（重复文件 / 超限）走 `manager.disposeComposite` 丢掉（`:883`）；
 *   · 兄弟窗口 `dispose()`（`:886`）；
 *   · `swapComponents(parent, toAdd = tabbedPane.component, toRemove = splitter)`（`:889-891`）
 *     ⇒ 整棵 `Splitter` 子树被本窗口的格子顶替，兄弟窗口连同它们的标签一起消失；
 *   · 选中的 composite 优先用本窗口原来的，否则取第一个兄弟的（`:864`）。
 * `unsplitAll()`（`:902-907`）就是 `while (inSplitter()) unsplit(setCurrent = true)`。
 */
export function unsplit(
  table: WindowTable,
  id: number,
  options: { setCurrent?: boolean; tabLimit?: number; normalizeSplits?: boolean } = {},
): WindowTable {
  if (!isInSplitter(table, id)) return table
  const self = windowById(table, id)
  if (!self) return table
  const tabLimit = options.tabLimit ?? EDITOR_TAB_LIMIT_DEFAULT
  const siblingIds = siblingWindowIds(table, id)
  const tabs = [...self.tabs]
  const pinned = [...self.pinned]
  let active = self.active
  for (const siblingId of siblingIds) {
    const sibling = windowById(table, siblingId)
    if (!sibling) continue
    for (const path of sibling.tabs) {
      if (!tabs.includes(path) && tabs.length < tabLimit) {
        tabs.push(path)
        if (sibling.pinned.includes(path) && !pinned.includes(path)) pinned.push(path)
      }
    }
    if (!tabs.includes(active)) active = sibling.active
  }
  if (!tabs.includes(active)) active = tabs[0] ?? ''
  const merged: EditorWindowState = { ...self, tabs, active, pinned }
  const windows = table.windows
    .filter(window => window.id === id || !siblingIds.includes(window.id))
    .map(window => (window.id === id ? merged : window))
  // 兄弟窗口被 `dispose()`（`:886`）⇒ `removeWindow` 的 `compareAndSet(window, null)`
  // （`EditorsSplitters.kt:1076-1078`）会把"当前窗口正好是被dispose 的那个"清成 null。
  const current = options.setCurrent === false
    ? (table.current != null && siblingIds.includes(table.current) ? null : table.current)
    : id
  const next: WindowTable = {
    ...table,
    windows,
    layout: collapseToSelf(table.layout, id),
    current,
  }
  return options.normalizeSplits ? normalizeProportionsFrom(next, id) : next
}

/** `EditorWindow.kt:902-907` 的 `unsplitAll()`。 */
export function unsplitAll(table: WindowTable, id: number, options: { tabLimit?: number; normalizeSplits?: boolean } = {}): WindowTable {
  let next = table
  let guard = 0
  while (isInSplitter(next, id) && guard++ < 64) next = unsplit(next, id, { ...options, setCurrent: true })
  return next
}

/** `EditorWindow.kt:849-855` 的 `changeOrientation()`：只翻转**包着这个窗口的那个** `Splitter`。 */
export function changeOrientation(table: WindowTable, id: number): WindowTable {
  const flip = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'leaf') return node
    const isTargetParent = (node.first.kind === 'leaf' && node.first.window === id)
      || (node.second.kind === 'leaf' && node.second.window === id)
    const first = flip(node.first)
    const second = flip(node.second)
    if (!isTargetParent) return { ...node, first, second }
    return { ...node, orientation: node.orientation === 'horizontal' ? 'vertical' : 'horizontal', first, second }
  }
  return { ...table, layout: flip(table.layout) }
}

/**
 * `EditorWindow.kt:582-614` 的 `normalizeProportionsIfNeed`：
 * 从窗口往上走，**同方向**的祖先 `Splitter` 收进栈（换方向就停，`:602-604`），然后
 * `proportion = 该组件在 first 侧 ? 1 - 1/(2+i) : 1/(2+i)`（`:612`），`i` 从 0 递增（最近的祖先在前）。
 * 由 `editor.normalize.splits` 控制，默认 false（`intellij.platform.ide.impl.xml:1513`）。
 */
export function normalizeProportionsFrom(table: WindowTable, id: number): WindowTable {
  const chain: { node: SplitNode; isFirst: boolean }[] = []
  const walk = (node: LayoutNode): boolean => {
    if (node.kind === 'leaf') return node.window === id
    if (walk(node.first)) { chain.push({ node, isFirst: true }); return true }
    if (walk(node.second)) { chain.push({ node, isFirst: false }); return true }
    return false
  }
  walk(table.layout)
  if (chain.length === 0) return table
  let orientation: SplitOrientation | null = null
  const kept: { node: SplitNode; isFirst: boolean }[] = []
  for (const entry of chain) {
    if (orientation === null) orientation = entry.node.orientation
    else if (orientation !== entry.node.orientation) break
    kept.push(entry)
  }
  const proportions = new Map<SplitNode, number>()
  kept.forEach((entry, i) => {
    proportions.set(entry.node, entry.isFirst ? 1 - 1 / (2 + i) : 1 / (2 + i))
  })
  const apply = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'leaf') return node
    const first = apply(node.first)
    const second = apply(node.second)
    const proportion = proportions.get(node)
    return { ...node, first, second, proportion: proportion ?? node.proportion }
  }
  return { ...table, layout: apply(table.layout) }
}

// ---------------------------------------------------------------------------
// 分屏树的持久化形状（照抄 writePanel / EditorSplitterState 的属性名）
// ---------------------------------------------------------------------------

/** `EditorsSplitters.kt:1272-1298` 的 `writePanel`：`splitter` / `leaf` 两种元素 + 两个属性。 */
export interface SerializedSplit {
  kind: 'split'
  orientation: SplitOrientation
  proportion: number
  first: SerializedPanel
  second: SerializedPanel
}
export interface SerializedLeaf { kind: 'leaf'; window: number }
export type SerializedPanel = SerializedSplit | SerializedLeaf

/**
 * 属性名逐字照抄：`split-orientation` 取 `"vertical"|"horizontal"`
 * （`:1276` 的 `if (component.orientation) "vertical" else "horizontal"`）、
 * `split-proportion`（`:1277`）、`split-first` / `split-second`（`:1278` / `:1281`）、`leaf`（`:1288`）。
 */
export function serializeLayout(node: LayoutNode): SerializedPanel {
  if (node.kind === 'leaf') return { kind: 'leaf', window: node.window }
  return {
    kind: 'split',
    orientation: node.orientation,
    proportion: node.proportion,
    first: serializeLayout(node.first),
    second: serializeLayout(node.second),
  }
}

/**
 * `EditorSplitterState`（`EditorsSplitters.kt:1347-1387`）的解析侧：
 * 有 `split-first` + `split-second` 才是 `Splitter`，否则看 `leaf`（`:1358-1383`）；
 * `split-orientation == "vertical"` ⇒ `isVertical = true`（`:1331`）；
 * `split-proportion` 缺省 **0.5**（`:1334`）。
 */
export function parseLayout(raw: unknown, assignWindowId?: () => number): LayoutNode | null {
  if (raw == null || typeof raw !== 'object') return null
  const element = raw as Record<string, unknown>
  const first = element['split-first']
  const second = element['split-second']
  if (first != null && second != null) {
    const firstNode = parseLayout(first, assignWindowId)
    const secondNode = parseLayout(second, assignWindowId)
    if (!firstNode || !secondNode) return null
    const rawProportion = element['split-proportion']
    const proportion = typeof rawProportion === 'number' ? rawProportion
      : typeof rawProportion === 'string' ? Number.parseFloat(rawProportion) : Number.NaN
    return {
      kind: 'split',
      orientation: element['split-orientation'] === 'vertical' ? 'vertical' : 'horizontal',
      proportion: Number.isFinite(proportion) ? proportion : SPLIT_DEFAULT_PROPORTION,
      first: firstNode,
      second: secondNode,
    }
  }
  if (element['leaf'] == null) return null
  return { kind: 'leaf', window: assignWindowId ? assignWindowId() : -1 }
}

/**
 * `DockManagerImpl.kt:417` / `:468` —— `FileEditorManagerKeys.REOPEN_WINDOW.get(file, true)`：
 * 只有显式置 `false` 才不随工程一起恢复（`FileEditorManagerKeys.kt:107-115`）。
 */
export function reopenWindowOnStartup(flag: boolean | undefined): boolean {
  return flag !== false
}

/**
 * `DockManagerImpl.kt:105-109` —— `WINDOW_DIMENSION_KEY.get(file)`：文件自己声明窗口尺寸的 key，
 * 没声明就是 null（新窗口不记住尺寸）。
 */
export function windowDimensionKey(file: { windowDimensionKey?: string }): string | null {
  return file.windowDimensionKey ?? null
}
