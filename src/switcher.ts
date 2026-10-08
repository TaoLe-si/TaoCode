// **Ctrl+Tab 切换器（Switcher）的纯模型** —— 上游 `com.intellij.ide.actions.Switcher` /
// `SwitcherActions` / `SwitcherSpeedSearch`（`platform/platform-impl/src/com/intellij/ide/actions/`）
// 与 `frontendSwitcherItemsCollector.kt`（`platform/recentFiles/frontend/`）在本仓的等价物。
//
// 上游那套是 Swing 弹窗 + 两张 JList（文件列表 + 工具窗口列表）+ 速度搜索；本仓 UI 是 Vue/DOM，
// 所以这一模块只做**与 UI 无关的那一半**：条目怎么收集、初始选中谁、按 Tab 怎么走、速度搜索
// 怎么过滤、哪些键提交/取消；渲染与按键事件由宿主（`src/switcherHost.ts`）与组件承担。
//
// 逐条对齐的上游语义（行号取上面两个文件）：
//   · `SWITCHER_ELEMENTS_LIMIT = 30`（Switcher.kt:854）—— 文件列表上限；
//   · `getFilesToShow`（:855-909）：先放**编辑器选择历史**（每个文件一份、去重、到 30 停）；
//     若已有**多于一个**编辑器条目就直接返回（不再混最近文件）；否则补 `getRecentFiles`，
//     倒序 append、`addedFiles` 去重；最后「只有一个编辑器且它不在首位」时插到最前；
//   · `getRecentFiles`（:916-932）：最近文件列表里，把「当前打开但不在最近里」的文件插到
//     **第一个命中的打开文件**之后；
//   · `getFilesSelectedIndex`（:809-829）：初始选中 = 正向找第一个**不是当前标签**的条目，
//     反向则从末尾找 —— 所以按 Ctrl+Tab 立刻松手 = 切到上一个文件（不是当前这个）；
//   · `go(forward)`（Switcher.kt:563-580）：索引 ±1；越界时在两列表之间切换（files ↔ toolWindows），
//     并把索引落到另一张表的 0 / 末尾；
//   · 工具窗口助记符：首字母为大写字母就用它，否则用 `getIndexShortcut`（:958-961，
//     `(index+1)` 按 `radix=(index+1).coerceIn(2..36)` 转大写）；
//   · 速度搜索（`SwitcherSpeedSearch.kt`）：按输入前缀过滤（本仓按 title/subtitle 大小写不敏感）。
//
// **与上游的差异（如实）**：上游条目是 `SwitcherVirtualFile`（持 `VirtualFile` + `EditorWindow`，
// 能"在右分栏打开"、能显示问题标记）；本仓条目是**路径/工具窗口 id 的字符串身份**，没有
// VirtualFile 与 EditorWindow，也没有 pinned 切换器的多条选择与「下一个问题文件」导航（见
// `switcherStep` 的注释）。这些在单进程、无双窗格的等价物下没有落点。
//
// 判据：`tests/switcher.test.mjs`。

/** 文件列表上限（上游 `SWITCHER_ELEMENTS_LIMIT`，Switcher.kt:854）。 */
export const SWITCHER_ELEMENTS_LIMIT = 30

/** 条目来源：编辑器（编辑器）与「最近文件」两类，外加工具窗口。 */
export type SwitcherItemKind = 'editor' | 'recent' | 'toolwindow'

export interface SwitcherItem {
  /** 稳定身份：文件是路径，工具窗口是 id。 */
  id: string
  kind: SwitcherItemKind
  /** 显示名（文件取基名、工具窗口取标题）。 */
  title: string
  /** 次要文本（文件是路径、工具窗口是 id）。 */
  subtitle: string
  /** 文件路径（工具窗口条目为空）。 */
  path?: string
  /** 工具窗口的助记符（首字母或序号；文件条目为空）。 */
  mnemonic?: string
}

export interface SwitcherSources {
  /** 编辑器选择历史（最近在前）= 上游 `getSelectionHistoryList()`。 */
  openEditors: readonly string[]
  /** 最近文件（最近在前）= 上游 `EditorHistoryManager.fileList`。 */
  recentFiles: readonly string[]
  /** 「只看已编辑」（recent-files 切换器的复选框）= 上游 `IdeDocumentHistory.changedFiles`。 */
  onlyEditedFiles?: readonly string[]
  /** 工具窗口条目（id + 标题）。 */
  toolWindows?: readonly { id: string; title: string }[]
  /** 当前标签的路径（初始选中要跳过它）。 */
  currentPath?: string
}

export interface SwitcherItemList {
  items: SwitcherItem[]
  /** 工具窗口那一档的条目（与文件条目分属两张表，见 `go`）。 */
  toolWindows: SwitcherItem[]
}

/** 取路径的显示名（两平台分隔符都认）。 */
export function baseNameOf(path: string): string {
  const value = String(path ?? '')
  const cut = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  return cut >= 0 ? value.slice(cut + 1) : value
}

/**
 * `getRecentFiles` 的等价物（Switcher.kt:916-932）：把「当前打开但不在最近列表里」的文件
 * 插到**第一个命中的打开文件之后**；没有命中的打开文件时插到最前（上游 `index` 初始 0）。
 */
export function mergeRecentWithOpen(recentFiles: readonly string[], openEditors: readonly string[]): string[] {
  const recent = [...recentFiles]
  const recentSet = new Set(recent)
  const openSet = new Set(openEditors)
  let index = 0
  for (let i = 0; i < recent.length; i += 1) {
    if (openSet.has(recent[i]!)) { index = i; break }
  }
  const extras = openEditors.filter(file => !recentSet.has(file))
  recent.splice(index, 0, ...extras)
  return recent
}

/**
 * 文件那一张表的条目（`getFilesToShow` 的等价物，见文件头逐条对应）。
 * `onlyEdited` 为真时「最近」那一段改用 `onlyEditedFiles`（recent-files 切换器的复选框）。
 */
export function collectSwitcherItems(sources: SwitcherSources): SwitcherItemList {
  const editors = [...sources.openEditors]
  const added = new Set<string>()
  const items: SwitcherItem[] = []
  for (const path of editors) {
    if (added.has(path)) continue
    added.add(path)
    items.push({ id: path, kind: 'editor', title: baseNameOf(path), subtitle: path, path })
    if (items.length >= SWITCHER_ELEMENTS_LIMIT) break
  }
  // 已有多于一个编辑器条目：就到此为止（上游 `if (filesData.size > 1) return filesData`）。
  if (items.length <= 1) {
    const source = sources.onlyEditedFiles && sources.onlyEditedFiles.length ? sources.onlyEditedFiles : sources.recentFiles
    const recent = mergeRecentWithOpen(source, editors)
    // 倒序 append（上游 `for (i in filesForInit.size - 1 downTo minIndex)`）：最近的在后面那句
    // 注释里是"从尾到头压栈后顺序反过来"，本仓按上游同一趟倒序。
    for (let i = recent.length - 1; i >= 0; i -= 1) {
      const path = recent[i]!
      if (added.has(path)) continue
      added.add(path)
      items.push({ id: path, kind: 'recent', title: baseNameOf(path), subtitle: path, path })
      if (items.length >= SWITCHER_ELEMENTS_LIMIT) break
    }
    // 只有一个编辑器且不在首位：插到最前（Switcher.kt:910-914）。
    if (editors.length === 1 && items.length && items[0]!.path !== editors[0]) {
      if (added.add(editors[0]!)) items.unshift({ id: editors[0]!, kind: 'editor', title: baseNameOf(editors[0]!), subtitle: editors[0]!, path: editors[0]! })
    }
  }
  const toolWindows: SwitcherItem[] = (sources.toolWindows ?? []).map((window, index) => ({
    id: window.id,
    kind: 'toolwindow' as const,
    title: window.title,
    subtitle: window.id,
    mnemonic: toolWindowMnemonic(window.title, index),
  }))
  return { items, toolWindows }
}

/**
 * 工具窗口助记符（Switcher.kt:935-961）：标题里第一个大写字母优先；否则退回
 * `getIndexShortcut(index)` —— `(index+1)` 按 `radix=(index+1).coerceIn(2..36)` 转大写，
 * 超出 `0..35` 给 null。
 */
export function toolWindowMnemonic(title: string, index: number): string | undefined {
  for (const character of String(title ?? '')) {
    if (character >= 'A' && character <= 'Z') return character
  }
  if (index < 0 || index > 35) return undefined
  const radix = Math.min(Math.max(index + 1, 2), 36)
  return (index + 1).toString(radix).toUpperCase()
}

/** 初始选中（`getFilesSelectedIndex`）:正向找第一个不是当前标签的条目，反向从末尾找；全同给 -1。 */
export function initialSwitcherIndex(items: readonly SwitcherItem[], currentPath: string | undefined, forward: boolean): number {
  if (forward) {
    for (let i = 0; i < items.length; i += 1) if (items[i]!.path !== currentPath) return i
  } else {
    for (let i = items.length - 1; i >= 0; i -= 1) if (items[i]!.path !== currentPath) return i
  }
  return -1
}

/** 两张表之间的一步（`go(forward)` 的等价物）：越界就换表，索引落到另一张表的 0 / 末尾。 */
export interface SwitcherCursor {
  list: 'files' | 'toolwindows'
  index: number
}
export function switcherStep(cursor: SwitcherCursor, itemsCount: number, toolWindowsCount: number, forward: boolean): SwitcherCursor {
  const currentCount = cursor.list === 'files' ? itemsCount : toolWindowsCount
  let index = cursor.index + (forward ? 1 : -1)
  let list = cursor.list
  if ((forward && index >= currentCount) || (!forward && index < 0)) {
    // 两张表都非空时才换表；否则在单表里环绕。
    if (itemsCount > 0 && toolWindowsCount > 0) {
      list = list === 'files' ? 'toolwindows' : 'files'
      const otherCount = list === 'files' ? itemsCount : toolWindowsCount
      index = forward ? 0 : otherCount - 1
    } else {
      index = forward ? 0 : Math.max(currentCount - 1, 0)
    }
  }
  return { list, index }
}

/**
 * 速度搜索（`SwitcherSpeedSearch.kt` 的等价物）：按前缀过滤，title/subtitle 都参与、大小写不敏感。
 * 空前缀给原表（不过滤）。
 */
export function filterSwitcherItems(items: readonly SwitcherItem[], prefix: string): SwitcherItem[] {
  const query = String(prefix ?? '').trim().toLowerCase()
  if (!query) return [...items]
  return items.filter(item => item.title.toLowerCase().includes(query) || item.subtitle.toLowerCase().includes(query))
}

/** 当前选中的条目（`commit` 的目标）；索引越界给 null。 */
export function currentSwitcherItem(list: SwitcherItemList, cursor: SwitcherCursor): SwitcherItem | null {
  const items = cursor.list === 'files' ? list.items : list.toolWindows
  return items[cursor.index] ?? null
}
