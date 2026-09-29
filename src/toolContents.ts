// 工具窗口里"同一个窗口挂多条内容"的模型 —— IDEA `ContentManager` 的那一半（addContent）。
//
// 以前本仓的引用/层次各只有一条内容（`toolTabs.ts` 的 `ToolTabPresence` 是 kind → boolean），
// 于是"再查一次引用"只能把上一批结果冲掉。IDEA 不是这样：Find 工具窗口的内容管理器里
// **每次搜索是一条 Content**，标签条上就是一行，能不能被顶替由这条内容自己的三个开关决定。
//
// 上游依据（逐条对到本机参考树）：
//   · `doAddContent`（`platform/platform-impl/src/com/intellij/ui/content/impl/ContentManagerImpl.java:198-243`）：
//     同一条对象再 add 一次 = **挪到末尾**而不是复制一份（`:209-213`）；新内容插入位置
//     `index < 0 ? size : index`（`:228`）；加完在 `isToSelectAddedContent()` 或"当前没选中且不允许空选中"
//     时选中它（`:232-242`）。
//   · `findContent(String displayName)`（`platform/ide-core/src/com/intellij/ui/content/ContentManager.java:102`）：
//     按名字找是**调用方**的事，管理器自己不查名去重。
//   · `addContent`（`platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:149-192`）
//     = 搜索类内容真正的规矩，本模块照它写：
//       `toOpenInNewTab |= 选中的那条被钉住`（`:158`）；不开新标签且这条可复用时，**从尾到头**找一条
//       没钉住、可复用、且没在搜索中的内容当被顶替者（`:162-178`，注释：选中的那条排在候选末尾，
//       是"最后也是最好"的删除对象）；先 `addContent(content, indexToAdd)` 再 `removeContent(被顶替者)`
//       再 `setSelectedContent(新的)`（`:185-189`）—— 顺序是有意的：先占位再删，索引才不会错。
//   · `getTabName()`（`platform/platform-impl/src/com/intellij/ui/content/impl/ContentImpl.java:135-137`）：
//     标签上写的是 tabName，没设过才退回 displayName。
//   · 标签文字（`createPresentation`，`platform/lang-impl/src/com/intellij/find/findUsages/FindUsagesManager.java:551-565`）：
//       tabName = `find.usages.of.element.tab.name` = `{0} of {1}`
//         （`platform/analysis-impl/resources/messages/FindBundle.properties:32`），
//       其中 `{0}` = `find.usages.panel.title.usages` = `Usages`
//         （`platform/analysis-api/resources/messages/AnalysisBundle.properties:13`，经
//          `generateUsagesString()`，`platform/analysis-impl/src/com/intellij/find/findUsages/FindUsagesOptions.java:101-103`），
//       `{1}` = 元素的**短名**；
//       panelTitle = `find.usages.of.element.in.scope.panel.title` = `{0} in {1}`（上面那份 FindBundle:31，长名 + 范围）。
//   · 钉住那个开关是 `PinActiveTabAction`
//     （`platform/platform-impl/src/com/intellij/ide/actions/PinActiveTabAction.java:52-70`）：
//     动作本身就是取反，标题在 `action.pin.tab` ⇄ `action.unpin.tab` 之间换。
//   · `isLockable` 传给 `createContent(component, name, isLockable)`（上面那份 UsageViewContentManagerImpl:179）
//     就是 `Content.isCloseable()` 的反面，所以本模块的每条内容都可关（搜索结果是可关内容，不是常驻视图）。
export interface ToolContent<T = unknown> {
  id: number
  /** 标签条上的文字（`Content.getTabName()`）。 */
  tabName: string
  /** 面板顶部的标题（`presentation.getTabText()`），与标签文字不是一回事。 */
  panelTitle: string
  /** `Content.isPinned()`：钉住的不会被下一次搜索顶替。 */
  pinned: boolean
  /** `UsageView.isSearchInProgress()`：还在搜的那条也不会被顶替。 */
  searching: boolean
  /** `REUSABLE_CONTENT_KEY`：只有可复用的内容会当被顶替候选。 */
  reusable: boolean
  payload: T
}

export interface AddToolContent<T> {
  contents: ToolContent<T>[]
  /** 新加那条的 id —— 它总是被选中（`:189`）。 */
  selectedId: number
  /** 被顶替掉的那条的 id，没有则 null（调用方要据此清掉自己的状态）。 */
  removedId: number | null
}

/**
 * `UsageViewContentManagerImpl.addContent`（`:149-192`）。`newId` 由调用方的序号器给，
 * 本模块不持有计数器：内容列表是响应式的，序号必须在宿主那边单调。
 */
export function addToolContent<T>(contents: readonly ToolContent<T>[], selectedId: number | null,
                                  newId: number, next: Omit<ToolContent<T>, 'id'>,
                                  openInNewTab: boolean): AddToolContent<T> {
  const fresh = { ...next, id: newId }
  // `toOpenInNewTab |= selected.isPinned()`（`:158`）：选中的那条被钉住时**根本不进**顶替分支
  // （`:162` 的 `if (!toOpenInNewTab && reusable)`），所以不是"去找别的可顶替的"，而是直接新开一条。
  const selected = contents.find(content => content.id === selectedId) ?? null
  const toOpenInNewTab = openInNewTab || (selected?.pinned ?? false)
  const targetId = toOpenInNewTab || !next.reusable ? null : replaceableContentAt(contents, selectedId)
  if (targetId === null) {
    return { contents: insertAt(contents, -1, fresh), selectedId: newId, removedId: null }
  }
  const index = contents.findIndex(content => content.id === targetId)
  // **先占位再删**（`:185-188`）：先 add 到被顶替者的下标，再把它移走，标签条上的位置才不会跳。
  return {
    contents: insertAt(contents, index, fresh).filter(content => content.id !== targetId),
    selectedId: newId,
    removedId: targetId,
  }
}

/**
 * 被顶替候选（`:162-178`）：**从尾往前**第一条"没钉住 + 可复用 + 没在搜索中"的内容。
 * 上游那个循环没有 break，实际留下的是**最后匹配**的那条，即从尾往前第一条。
 */
export function replaceableContentAt<T>(contents: readonly ToolContent<T>[], selectedId: number | null): number | null {
  const order = [...contents]
  const selected = contents.find(content => content.id === selectedId)
  // 选中的那条排在候选**末尾**（`:164-167` 是 `append(contents, selectedContent)`），所以它优先。
  if (selected) order.push(selected)
  let candidate: number | null = null
  for (const content of order) {
    if (isReplaceable(content)) candidate = content.id
  }
  return candidate
}

function isReplaceable<T>(content: ToolContent<T>): boolean {
  return !content.pinned && content.reusable && !content.searching
}

function insertAt<T>(contents: readonly ToolContent<T>[], index: number, content: ToolContent<T>): ToolContent<T>[] {
  const list = [...contents]
  const at = index < 0 ? list.length : Math.min(index, list.length)
  list.splice(at, 0, content)
  return list
}

/** `ContentManagerImpl.removeContent`：删一条；选中它的是调用方的事。 */
export function removeToolContent<T>(contents: readonly ToolContent<T>[], id: number): ToolContent<T>[] {
  return contents.filter(content => content.id !== id)
}

/** `PinActiveTabAction.actionPerformed`（`:53-59`）：动作本身就是**取反**，不是"设为 true"。 */
export function togglePinned<T>(contents: readonly ToolContent<T>[], id: number): ToolContent<T>[] {
  return contents.map(content => content.id === id ? { ...content, pinned: !content.pinned } : content)
}

export function selectedToolContent<T>(contents: readonly ToolContent<T>[], id: number | null): ToolContent<T> | null {
  return contents.find(content => content.id === id) ?? null
}

// --- 三条"能不能关 / 关哪些"：改成**按条目数**判，不再按 kind ------------------------------------
// 谓词的形状仍照 `toolTabs.ts` 记的那三处上游（`canCloseAllContents` / `canCloseContents` /
// 两个 action 的 update()），只是量从"这个 kind 在不在"换成"这个内容管理器里有几条"。

/** `ContentManagerImpl.canCloseAllContents()`（`:472-481`）：至少有一条可关的内容。 */
export function canCloseAllToolContents<T>(contents: readonly ToolContent<T>[]): boolean {
  return contents.length > 0
}

/** `ToolWindowCloseOtherTabsAction.update`（`:21-27`）：**除了选中的那条**还有别的可关内容。 */
export function canCloseOtherToolContents<T>(contents: readonly ToolContent<T>[], selectedId: number | null): boolean {
  return contents.some(content => content.id !== selectedId)
}

/** `ToolWindowCloseAllTabsAction.actionPerformed`（`:11-18`）：全部，含选中的那条。 */
export function toolContentsToCloseAll<T>(contents: readonly ToolContent<T>[]): number[] {
  return contents.map(content => content.id)
}

/** `ToolWindowCloseOtherTabsAction.actionPerformed`（`:11-19`）：只跳过选中的那条。 */
export function toolContentsToCloseOthers<T>(contents: readonly ToolContent<T>[], selectedId: number | null): number[] {
  return contents.filter(content => content.id !== selectedId).map(content => content.id)
}

/**
 * 标签文字：`{0} of {1}`（`FindBundle.properties:32`）—— 上游的 `{0}` 是 `Usages`
 * （`AnalysisBundle.properties:13`），`{1}` 是元素短名。本仓的界面文案是中文，
 * 语序按中文改，但**带引号的短名与"某物 的 引用"这一形状**是上游给的。
 */
export function usagesTabName(shortName: string): string {
  return `对“${shortName}”的引用`
}

/** `{0} in {1}`（`FindBundle.properties:31`）：长名 + 搜索范围。 */
export function usagesPanelTitle(longName: string, scope: string): string {
  return `${longName} 在${scope}中`
}
