// 值窗口的「历史栈」—— 上游 `DebuggerTreeWithHistoryContainer`
// （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/evaluate/quick/common/DebuggerTreeWithHistoryContainer.java`）
// 的等价物。检查窗口（`XInspectAction` → `XInspectDialog` → `DebuggerTreeWithHistoryPanel`，
// 见 `src/components/DebugInspectWindow.vue`）与求值弹层都用它。
//
// 用户可见行为（全部来自上面那个类的行号，逐条照搬）：
//   · 打开时历史里只有根节点自己（`:48-52`），`index = -1`；
//   · 「设为根」（SetAsRoot，`:154-201`）把选中的子节点插到当前项之后并跳过去；
//   · 往回 / 往前各有一步（`:129-152` / `:105-127`），快捷键 Alt+← / Alt+→（`:93` / `:97`）；
//   · 两者的可用性只看「历史长度 > 1」与 index 位置（`:120` / `:145`）；
//   · 容量判据是 `index < HISTORY_SIZE`，`HISTORY_SIZE = 11`（`:42` / `:78`）。
//
// 如实保留上游的一个怪癖：`addToHistory` 用 `splice` **插入**，所以「往回走之后
// 再钻进去」不会截断前向历史，前向段会被顶到后面继续可达（`:84`）。这里照搬，
// 不替它「修好」—— 上游就是这个行为。
//
// 「根节点」在本仓是一个 DAP `variablesReference`：把子节点设为根 = 把树的根换成
// 那个 reference（`collectReferenceRows` 已经能以任意 reference 为根，见
// `src/debugDataView.ts`），不需要任何新的协议能力。

/** 上游 `HISTORY_SIZE`（`DebuggerTreeWithHistoryContainer.java:42`）。 */
export const VALUE_HISTORY_SIZE = 11

export interface ValueHistoryEntry {
  /** 树根的容器 reference（DAP `variablesReference`）。 */
  reference: number
  /** 工具栏 / 标题上显示的名字（上游 `DebuggerTreeCreator.getTitle(selectedItem)`）。 */
  label: string
}

export interface ValueHistory {
  entries: ValueHistoryEntry[]
  /** 当前项下标；`-1` = 只有初始项、还没钻进去过（上游构造器把 index 留成 -1）。 */
  index: number
}

/** 打开窗口：历史里只有根节点自己，index = -1。 */
export function createValueHistory(reference: number, label: string): ValueHistory {
  return { entries: [{ reference, label }], index: -1 }
}

/**
 * 「设为根」：插到当前项之后并跳到它。
 * 容量判据照搬上游 `myCurrentIndex < HISTORY_SIZE`（`:78`）——注意它比的是 **index**
 * 而不是列表长度，所以列表最长会到 `VALUE_HISTORY_SIZE + 1`。
 */
export function pushValueHistory(history: ValueHistory, entry: ValueHistoryEntry): ValueHistory {
  if (history.index >= VALUE_HISTORY_SIZE) return history
  const index = history.index === -1 ? 1 : history.index + 1
  const entries = history.entries.slice()
  entries.splice(index, 0, entry)
  return { entries, index }
}

export function canGoBackward(history: ValueHistory): boolean {
  return history.entries.length > 1 && history.index > 0
}

export function canGoForward(history: ValueHistory): boolean {
  return history.entries.length > 1 && history.index < history.entries.length - 1
}

export function goBackward(history: ValueHistory): ValueHistory {
  return canGoBackward(history) ? { entries: history.entries, index: history.index - 1 } : history
}

export function goForward(history: ValueHistory): ValueHistory {
  return canGoForward(history) ? { entries: history.entries, index: history.index + 1 } : history
}

/**
 * 当前该显示的那一项。`index === -1` 时退回第 0 项（初始根）——
 * 上游 `updateTree()` 直接 `myHistory.get(myCurrentIndex)`（`:67`），只在
 * `addToHistory` 之后调用；我们让窗口一打开就有东西可显示，所以取第 0 项。
 */
export function currentValueHistoryEntry(history: ValueHistory): ValueHistoryEntry | undefined {
  return history.entries[history.index < 0 ? 0 : history.index]
}

/**
 * 「设为根」能不能点（上游 `SetAsRootAction.update`，`:164-171`）：
 * 必须有选中路径，路径深度超过根节点（根可见时 `> 1`，根不可见时 `> 2`），
 * 并且选中的不是叶子。本仓的根节点是可见的（检查窗口直接把它画出来），
 * 所以调用方按 `rootVisible = true` 传。
 */
export function canSetAsRoot(
  selectedPathCount: number, selectedIsLeaf: boolean, rootVisible = true,
): boolean {
  if (selectedPathCount <= (rootVisible ? 1 : 2)) return false
  return !selectedIsLeaf
}
