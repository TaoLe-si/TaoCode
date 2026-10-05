// 欢迎页最近项目列表的**选择与键盘**规则（纯函数，无 Vue / 无 DOM）。
//
// 2026-10-06 桶 14c 从 `src/components/WelcomePage.vue` 搬出，组件里只留接线；
// 下面每一段的上游坐标就是原注释里那几条，一起搬过来：
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/welcomeScreen/recentProjects/RecentProjectFilteringTree.kt:189-191`
//     —— ENTER 激活选中项、ALT+DELETE 移除它；
//   · 同文件的 SHIFT / CTRL 鼠标按下进树的 SelectionModel（多选自上游这一族，
//     `RemoveSelectedProjectsAction` 删的是**选中的那一片**，不是光标所在那一行）。
//
// 为什么能拆成纯函数：这三条规则只认「当前可见列表 + 已有选区 + 这一次点击/按键」，
// 不认存储、不认桥接、也不认渲染。

/** 一次行点击用到的三个修饰键（`MouseEvent` 的这三项就够判了）。 */
export interface RowClickModifiers {
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

/** 点击之后的选区与「上一次点的那行」（Shift 段选的锚点）。 */
export interface RowSelection {
  selected: Set<string>
  lastClicked: string
}

/**
 * IDEA's recent-project list is multi-selectable: RecentProjectFilteringTree wires
 * SHIFT and CTRL mouse presses into the tree's selection model, and
 * RemoveSelectedProjectsAction removes *the selection*, not just the focused row.
 *
 * 三条分支（与原组件里的控制流逐条对应）：
 *   · 裸点击 = 清空选区（原来只在 `size > 0` 时才换新 Set，避免无谓的重渲染），锚点变成这一行；
 *   · Shift = 从锚点到这一行的**闭区间**并入选区；锚点不在可见列表里（被过滤掉了）就退化成
 *     下面那条单行切换，与上游 `Tree` 的 anchor 失效行为一致；
 *   · Ctrl / Cmd = 单行增删（toggle），锚点跟着走。
 */
export function selectionAfterClick(
  list: readonly string[], selected: Set<string>, lastClicked: string, path: string,
  modifiers: RowClickModifiers,
): RowSelection {
  if (!modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.metaKey) {
    return { selected: selected.size > 0 ? new Set<string>() : selected, lastClicked: path }
  }
  if (modifiers.shiftKey && lastClicked && list.includes(lastClicked)) {
    const lastIndex = list.indexOf(lastClicked)
    const currentIndex = list.indexOf(path)
    if (lastIndex !== -1 && currentIndex !== -1) {
      const [start, end] = lastIndex < currentIndex ? [lastIndex, currentIndex] : [currentIndex, lastIndex]
      const next = new Set(selected)
      for (let i = start; i <= end; i += 1) next.add(list[i]!)
      return { selected: next, lastClicked }
    }
  }
  // CTRL/CMD toggles a single row.
  const next = new Set(selected)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return { selected: next, lastClicked: path }
}

/**
 * 那一行按下的键算不算「删除」（Delete 与 Backspace 同义，就是上游树里的 remove binding）。
 * 调用方自己负责 `preventDefault`，这里只回答是不是那个键。
 */
export function isRowDeleteKey(key: string): boolean {
  return key === 'Delete' || key === 'Backspace'
}

/**
 * 删除动作作用在**哪些行**上：光标所在行已经在选区里就是整片选区，否则只有它自己
 * （`RemoveSelectedProjectsAction` 取的是 selection，selection 不包含焦点行时退化为焦点行）。
 * 顺序跟着可见列表走，所以返回的是 `list` 里的原对象。
 */
export function deleteTargets<T extends { path: string }>(list: readonly T[], selected: ReadonlySet<string>, path: string): T[] {
  if (!selected.has(path)) return list.filter(item => item.path === path)
  return list.filter(item => selected.has(item.path))
}

/** 搜索框里那两把键的判决（RecentProjectFilteringTree.kt:189-191）。 */
export type SearchKeyAction = 'open' | 'remove' | 'noop' | null

/**
 * ReopenProjectAction 之外的那半：搜索框（列表的第一个焦点位）里 ENTER 激活当前行、
 * ALT+DELETE 移除它。busy 或路径不可用时 ENTER **仍然被吃掉**但什么都不做（与上游
 * 那棵树的 binding 一致：键已经归树管了，不能再让表单去提交），
 * 而 ALT+DELETE 走 `remove` —— 记录删得掉，磁盘文件不会被碰。
 */
export function searchKeyAction(
  key: string, altKey: boolean, active: { available: boolean } | undefined, busy: boolean,
): SearchKeyAction {
  if (!active) return null
  if (key === 'Enter') return active.available && !busy ? 'open' : 'noop'
  if (key === 'Delete' && altKey) return 'remove'
  return null
}
