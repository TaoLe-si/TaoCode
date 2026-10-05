// 项目视图的**压缩目录**（`pv/project-view` / `pv/project-view-nodes` 族）—— 上游齿轮「外观」里的
// `ProjectView.CompactDirectories`（本仓文案「压缩目录」）在本仓的等价物。
//
// 上游坐标（逐条对照，本仓不移植的部分写在每条后面）：
//   · 动作注册：`platform/projectView/shared/resources/intellij.platform.projectView.xml:98-99`
//     （`ProjectView.ToolWindow.Appearance.Actions` 这一组里，位置在 FlattenPackages/HideEmptyMiddlePackages
//     之后、`ProjectView.FileNesting` 之前）；
//   · 文案：`platform/platform-resources-en/src/messages/ActionsBundle.properties:1459-1460`
//     （`Compact Directories` / "Merge two similar directories to a single node if the first directory
//     contains only a second directory"），中文「压缩目录」取自
//     `plugins/localization-zh/lib/localization-zh.jar` 的 `messages/ActionsBundle.properties`
//     同键 —— 描述句就是下面 `singleDirectoryChild` 的判据；
//   · 默认档：**false**（`platform/editor-ui-api/src/com/intellij/ide/util/treeView/NodeOptions.java:41-43`
//     的 `default boolean isCompactDirectories() { return false; }`，
//     `platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewState.kt:36` 取的就是这个默认）；
//   · 合并规则：`platform/lang-impl/src/com/intellij/ide/scopeView/ScopeViewTreeModel.java:595-608`
//     —— 从每个目录子节点出发反复取「唯一的那个子目录」，取到了就把这一格换成最深的那个；
//     `getSingleDirectory`（`:657-661`）就是「children.size() != 1 ⇒ null，否则唯一的子项必须是目录」；
//   · 显示名：`ScopeViewTreeModel.java:789-792` —— 被并进来的每一格的名字按顺序用
//     `VfsUtilCore.VFS_SEPARATOR_CHAR`（`/`）连起来再接自己，所以 `src` + `components` + `ui`
//     显示为 `src/components/ui`；包目录才用 `.` 分隔（`isPackage(getIcon())`），
//     本仓没有 PSI，目录一律是文件系统目录 ⇒ 只有 `/` 这一条路；
//   · 图标那一半（`:598-606` 的 `icon.equals(iconNext)` / `isFolder(icon) && !isPackage(iconNext)`）
//     在无 PSI 的本仓恒成立：所有目录用同一个文件夹图标，所以链只要满足「唯一子目录」就一直并。
//
// 与上游的**不等价处**（如实写明）：
//   · 上游的树模型在 `createChildren` 里同步拿到子列表（它的 VFS/PSI 缓存是现成的）；本仓的目录内容是
//     点开才向宿主请求一次（`src/projectTreeModel.ts` 的 `load`），所以链的**取子列表**这一半由模型
//     异步预热后交给这里的同步 `childrenOf`。本模块只做纯规则，不碰 IO。
//   · `MAX_COMPACT_CHAIN`：上游没有链深上限（靠 VFS 不把符号链接当目录展开）；本仓的 `workspace.list`
//     没有这条保证，环形的符号链接会让链无限长，所以给一个硬上限并把这一格标成「不可并」。
export const VFS_SEPARATOR = '/'

/** 链深上限：防本仓 VFS 层的符号链接环（上游无此项，见模块头）。 */
export const MAX_COMPACT_CHAIN = 16

export interface CompactEntry {
  path: string
  name: string
  kind: 'file' | 'directory'
}

/** 一条被并起来的目录行：行代表最深的那个目录，名字是整条链。 */
export interface CompactChain<E extends CompactEntry> {
  /** 这一行真正指向的目录（上游 `child = childNext` 最后停下来的那个）。 */
  entry: E
  /** 链上每一格的名字（含首尾），显示时按 `/` 连起来。 */
  names: readonly string[]
  /** 链长（首格算 1）。>1 才是真的并起来了。 */
  depth: number
}

/** `getSingleDirectory`（`ScopeViewTreeModel.java:657-661`）：恰好一个子项且它是目录。 */
export function singleDirectoryChild<E extends CompactEntry>(children: readonly E[] | undefined): E | null {
  if (!children || children.length !== 1) return null
  const only = children[0]!
  return only.kind === 'directory' ? only : null
}

/** 显示名（`ScopeViewTreeModel.java:789-792`，非包目录用 `/` 连接，末尾不留分隔符）。 */
export function compactName(names: readonly string[]): string {
  return names.join(VFS_SEPARATOR)
}

/**
 * 从 `head` 出发并到底（`ScopeViewTreeModel.java:595-608` 的那个 while）。
 * `childrenOf` 是已经预热好的目录内容（本仓由 `projectTreeModel` 的缓存提供）；
 * 读不到子列表时**不并**（宁可不并，也不给出一行假的名字）。
 */
export function compactChainOf<E extends CompactEntry>(head: E, childrenOf: (path: string) => readonly E[] | undefined): CompactChain<E> {
  const names = [head.name]
  let current = head
  while (names.length < MAX_COMPACT_CHAIN) {
    const next = singleDirectoryChild(childrenOf(current.path))
    if (!next) break
    names.push(next.name)
    current = next
  }
  return { entry: current, names, depth: names.length }
}

/**
 * 把一层列表里的目录换成并好之后的那一行（`ScopeViewTreeModel.java:595-608` 的
 * `children.add(mapper.apply(parent, child, icon))` —— 加进去的是走到底的那个 child）。
 * 只处理目录；文件、合成行（NUL 前缀）与根行原样留着。
 */
export function compactListing<E extends CompactEntry>(listing: readonly E[], childrenOf: (path: string) => readonly E[] | undefined): E[] {
  return listing.map(entry => {
    if (entry.kind !== 'directory' || entry.path === '' || entry.path.startsWith('\u0000')) return entry
    const chain = compactChainOf(entry, childrenOf)
    return chain.depth > 1 ? { ...chain.entry, name: compactName(chain.names) } : entry
  })
}
