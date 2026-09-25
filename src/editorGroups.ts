// IDEA's editor-group model: two panes, each with its own tab list and selection; a
// Tab may live in both groups at once ("split same"). Pure state transitions so the
// invariants (every open file stays reachable; unsplit merges back) are testable.

export interface PaneGroup<T> { tabs: T[]; activePath: string }
export type Pane = 0 | 1

export interface SplitModel<T> {
  groups: [PaneGroup<T>, PaneGroup<T>]
  focused: Pane
  orientation: 'none' | 'horizontal' | 'vertical'
}

export function createSplitModel<T>(): SplitModel<T> {
  return { groups: [{ tabs: [], activePath: '' }, { tabs: [], activePath: '' }], focused: 0, orientation: 'none' }
}

export function otherPane(pane: Pane): Pane { return pane === 0 ? 1 : 0 }

// IDEA's "Clone or Split Right/Down": the new group starts as a clone of the focused
// one; the selected tab then moves out — unless it is the only one, which leaves the
// same file visible in both panes ("split same").
export function splitTabOutIn<T>(model: SplitModel<T>, pathOf: (tab: T) => string, tab: T, orientation: 'horizontal' | 'vertical'): void {
  if (model.orientation !== 'none' && model.orientation !== orientation) {
    // IDEA's "Move to Opposite Group": switching direction un-splits first so the tab
    // is back in the focused group and the move below actually applies.
    const keepActive = pathOf(tab)
    const wasFocused: Pane = model.focused
    unsplitModel(model)
    model.focused = otherPane(wasFocused)
    const group = model.groups[model.focused]
    if (group.tabs.some(item => pathOf(item) === keepActive)) group.activePath = keepActive
  }
  const from = model.groups[model.focused]
  if (!from.tabs.includes(tab)) return
  from.activePath = pathOf(tab)
  const to = model.groups[otherPane(model.focused)]
  if (model.orientation === 'none') {
    for (const other of [...to.tabs]) if (!from.tabs.includes(other)) from.tabs.push(other)
    model.orientation = orientation
    const merged = [...from.tabs]
    if (merged.length > 1) {
      const index = merged.indexOf(tab)
      // The moved tab leaves the source group but stays in the clone: IDEA's split
      // keeps the file reachable in both groups, selection included.
      from.tabs.splice(index, 1)
      from.activePath = pathOf(from.tabs[Math.min(index, from.tabs.length - 1)!])
      to.activePath = pathOf(tab)
    } else {
      to.activePath = from.activePath
    }
    // `to` may alias `from`'s old array reference; assign after the splice so neither
    // operation disturbs the other.
    to.tabs = [...merged]
    model.focused = otherPane(model.focused)
    return
  }
  // Already split: show the tab in the opposite group, moving it there when the
  // source group keeps at least one tab behind.
  if (!to.tabs.includes(tab)) to.tabs.push(tab)
  to.activePath = pathOf(tab)
  if (from.tabs.length > 1) {
    const index = from.tabs.indexOf(tab)
    from.tabs.splice(index, 1)
    from.activePath = pathOf(from.tabs[Math.min(index, from.tabs.length - 1)!])
  }
  model.focused = otherPane(model.focused)
}

export function unsplitModel<T>(model: SplitModel<T>): void {
  if (model.orientation === 'none') return
  const [first, second] = model.groups
  // IDEA's Unsplit merges the second group into the first; when the *second* group
  // had focus its selection survives as the merged group's selection.
  const keepActive = model.focused === 1 && second.activePath ? second.activePath : first.activePath
  for (const tab of second.tabs) if (!first.tabs.includes(tab)) first.tabs.push(tab)
  second.tabs = []
  second.activePath = ''
  first.activePath = keepActive
  model.orientation = 'none'
  model.focused = 0
}

export function unsplitAllModel<T>(model: SplitModel<T>): void {
  model.orientation = 'none'
  model.groups[1].tabs = []
  model.groups[1].activePath = ''
  model.focused = 0
}

export function closeTabInPane<T>(model: SplitModel<T>, pathOf: (tab: T) => string, pane: Pane, tab: T): boolean {
  const group = model.groups[pane]
  const index = group.tabs.indexOf(tab)
  if (index < 0) return false
  group.tabs.splice(index, 1)
  if (group.activePath === pathOf(tab))
    group.activePath = group.tabs[Math.min(index, group.tabs.length - 1)] ? pathOf(group.tabs[Math.min(index, group.tabs.length - 1)]!) : ''
  // The buffer stays open while any pane still shows it.
  return !model.groups[0].tabs.includes(tab) && !model.groups[1].tabs.includes(tab)
}

// IDEA's tab drag & drop: dropping a tab onto the tab strip of its own group
// reorders it before the tab under the pointer; dropping onto the other group's
// strip moves it there (when split) and selects it. The same transitions back the
// tab-context "Move Right/Down" rows, so drag and menu can never disagree.
export function dropTabOnGroup<T>(model: SplitModel<T>, pathOf: (tab: T) => string, fromPane: Pane, tab: T, toPane: Pane, targetPath?: string): void {
  const from = model.groups[fromPane]
  if (!from.tabs.includes(tab)) return
  if (toPane === fromPane) {
    // Dropping a tab onto itself only selects it; the order must not move.
    if (targetPath !== undefined && targetPath === pathOf(tab)) {
      from.activePath = pathOf(tab)
      return
    }
    const index = from.tabs.indexOf(tab)
    from.tabs.splice(index, 1)
    let insert = targetPath === undefined ? from.tabs.length : from.tabs.findIndex(item => pathOf(item) === targetPath)
    if (insert < 0) insert = from.tabs.length
    from.tabs.splice(insert, 0, tab)
    from.activePath = pathOf(tab)
    return
  }
  const to = model.groups[toPane]
  if (model.orientation === 'none') {
    // No split yet: a cross-group drop is IDEA's "split & move" via drag.
    splitTabOutIn(model, pathOf, tab, 'horizontal')
    return
  }
  from.tabs.splice(from.tabs.indexOf(tab), 1)
  if (!to.tabs.includes(tab)) {
    let insert = targetPath === undefined ? to.tabs.length : to.tabs.findIndex(item => pathOf(item) === targetPath)
    if (insert < 0) insert = to.tabs.length
    to.tabs.splice(insert, 0, tab)
  }
  to.activePath = pathOf(tab)
  from.activePath = from.tabs[0] ? pathOf(from.tabs[0]) : ''
  model.focused = toPane
}

// EditorWindow.closeNewFileUnderTabsLimit: once the group is over the limit, files
// are closed in IDEA's order — untouched tabs first (everything outside the selection
// history), then least-recently-selected, and never the just-opened or modified ones.
export function tabClosingOrder<T>(tabs: readonly T[], activePath: string, history: readonly string[], pathOf: (tab: T) => string, dirtyOf: (tab: T) => boolean): T[] {
  const inHistory = new Set(history)
  const order = new Set<T>()
  for (const tab of tabs) if (!inHistory.has(pathOf(tab))) order.add(tab)
  for (const path of [...history].reverse()) {
    const tab = tabs.find(item => pathOf(item) === path)
    if (tab && !dirtyOf(tab)) order.add(tab)
  }
  for (const tab of tabs) if (!dirtyOf(tab)) order.add(tab)
  for (const tab of tabs) order.add(tab)
  const selected = tabs.find(tab => pathOf(tab) === activePath)
  if (selected) { order.delete(selected); order.add(selected) }
  return [...order].filter(tab => pathOf(tab) !== activePath && !dirtyOf(tab))
}
