// 项目树右键的「将目录标记为」那一组（`pv/project-view` 族判词里点名的
// `MarkRootGroup` / `MarkAsContentRootAction` 缺口）。
//
// 上游成员表与规则（逐条对照）：
//   · 组本体：`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:252-253`
//     （`<group id="MarkRootGroup" class="...MarkRootGroup" popup="true">`，组里是空的，成员由插件
//     用 `add-to-group` 塞进来）；挂到项目树右键：`platform/platform-impl/resources/idea/LangActions.xml:475`
//     `<reference ref="MarkRootGroup"/>`。
//   · 组标题：`platform/lang-impl/src/com/intellij/ide/projectView/actions/MarkRootGroup.java:16-22`
//     —— 选区里有目录就用 `group.MarkRootGroup.text`，**全是文件**时换成 `group.MarkRootGroup.file.text`；
//     `isFilesOnlySelection` 在 `:24-32`（选区空 ⇒ 不算 files-only）。
//     文案取自 `plugins/localization-zh/lib/localization-zh.jar` 的 `messages/ActionsBundle.properties`：
//     「将目录标记为」/「将文件标记为」（英文原句 `ActionsBundle.properties:1871-1872`）。
//   · 组内容（基础平台那一组，顺序即渲染顺序）：
//     `idea/customization/min/resources/intellij.platform.customization.min.xml:61-67`
//     —— `MarkContentRootGroup` = `MarkExcludeRoot` → `MarkAsContentRoot` → `UnmarkRoot`，整组 `anchor="last"`。
//   · 各项文案：`platform/platform-resources-en/src/messages/ActionsBundle.properties:1862-1865`
//     （`Excluded` / `Not Excluded` / `Unmark`），中文同键「已排除」；`UnmarkRoot` 的标题是**动态**的
//     （`UnmarkRootAction.java:29-41`）：只碰到排除时是 `mark.as.unmark.excluded`「取消排除」，
//     碰到单一类型的根时是 `mark.as.unmark`「取消标记为{0}」，多种时 `mark.as.unmark.several`「取消标记」
//     （三个键的中文都取自 zh 包 `messages/LangBundle.properties`）。
//   · 可见性：
//     - `MarkAsContentRootAction.kt:20-31`：`isEnabledAndVisible ⇔ 全是目录 && 当前已被排除`
//       （`MarkAsContentRootAction.kt:25-29` 那个 `files.all { it.isDirectory && fileIndex.isExcluded(it) && … }`）
//       —— 也就是「未排除」只在已经排除的行上出现，和「已排除」互斥；
//     - `MarkRootActionBase.java:76-93`：`hasNonEmptySelection = acceptsFiles() ? hasDirsOrRoots || hasFiles
//       : hasDirsOrRoots && !hasFiles`；`MarkExcludeRootAction.java:24-56` 的 `modifyRoots` 走
//       `entry.addExcludeFolder(vFile)`（`:51`），`acceptsFiles()` 在 `:59-60`；
//     - `UnmarkRootAction.java:26-28` `acceptsFiles()` 返回 true，落点在 `:90` `entry.removeExcludeFolder(...)`。
//   · 排除的确认弹窗：`MarkExcludeRootAction.java:34-42` —— 只有 `Registry.is("ide.hide.excluded.files")`
//     为真才先问一次（`dialog.message.are.you.sure.you.would.like.to.exclude`）。本仓不弹：
//     排除在本仓是可再点一次就撤回来的开关（「未排除」那一项就是反向操作），不是不可逆动作。
//
// 与上游的**不等价处**（如实写明，都是本仓后端给的约束）：
//   · 上游的排除是「这条内容根下的这一个文件夹」（`ContentEntry.addExcludeFolder`，按路径记）；
//     本仓的 `ProjectSettings.excludedDirs`（`src/settingsModel.ts:102`）是**目录名表**：
//     命中规则是「路径的任一目录段等于这个名字」（`src/projectRoots.ts:64-70` 的 `excludedByNames`），
//     搜索侧也按名字折成 glob 并**丢掉带路径分隔符的条目**（`src/searchExclusions.ts:18-27`）。
//     所以这里写入的是**目录名**，效果和上游不一样但用户看得到同一件事：那一棵不再出现在树/搜索里。
//   · `MarkSourceRootGroup` / `MarkGeneratedSourceRootGroup`（`java/java-backend/resources/META-INF/JavaPlugin.xml:1236-1246`）
//     没有做：它们的成员与文案在本地这棵上游树里取不到（`MarkSourceRootActionGroup.java:18` 只给了类本体，
//     标签不在本 checkout 的 `JavaUiBundle.properties` 里），按取证口径写「无法核实」，不猜文案、不放假控件。
//   · 纯文件选区：上游那三个动作里只有 `UnmarkRoot` 收文件（`UnmarkRootAction.java:26-28`），
//     而本仓的标记只有「目录名排除」与「源根路径」两种，都对文件不起作用 ⇒ 整组不渲染（组标题仍然
//     按 `MarkRootGroup.java:19` 算成「将文件标记为」，但 `markRootItems` 给出空表，调用方据此不画这一格）。
import { excludedByNames } from './projectRoots.ts'

export interface MarkRootTarget {
  /** 项目内相对路径（与 `src/bridge.ts` 的 `Entry.path` 同一口径）。 */
  path: string
  name: string
  kind: 'file' | 'directory'
}

/** 本仓认得的两种「标记」：`excludedDirs` 的名字表与 `java.sourcePaths` 的源根表。 */
export interface MarkRootState {
  excludedDirs: readonly string[]
  sourcePaths: readonly string[]
}

export type MarkRootCommand = 'exclude' | 'include' | 'unmark'

/** 文案（zh 包 + 上游键名，见模块头）。 */
export const MARK_ROOT_TEXTS = Object.freeze({
  /** `group.MarkRootGroup.text`。 */
  groupDirectory: '将目录标记为',
  /** `group.MarkRootGroup.file.text`（`MarkRootGroup.java:19` 的 files-only 分支）。 */
  groupFile: '将文件标记为',
  /** `action.MarkExcludeRoot.text`。 */
  exclude: '已排除',
  /** `action.MarkAsContentRoot.text`（英文 "Not Excluded"）。 */
  include: '未排除',
  /** `mark.as.unmark.excluded`（`UnmarkRootAction.java:34`）。 */
  unmarkExcluded: '取消排除',
  /** `mark.as.unmark`（`UnmarkRootAction.java:41` 的 `getActionText` 那条路）。 */
  unmarkAsTemplate: '取消标记为{0}',
  /** `mark.as.unmark.several`。 */
  unmarkSeveral: '取消标记',
  /** 本仓 `java.sourcePaths` 这一种的类型名（`src/projectRoots.ts:20` 的 SOURCE_ROOT_LABELS 同源）。 */
  sourcesRoot: '源代码根目录',
})

/** `MarkRootGroup.isFilesOnlySelection`（`:24-32`）：非空且全是文件。 */
export function isFilesOnlySelection(targets: readonly MarkRootTarget[]): boolean {
  if (!targets.length) return false
  return targets.every(target => target.kind === 'file')
}

/** 组标题（`MarkRootGroup.java:16-22`）。 */
export function markRootGroupTitle(targets: readonly MarkRootTarget[]): string {
  return isFilesOnlySelection(targets) ? MARK_ROOT_TEXTS.groupFile : MARK_ROOT_TEXTS.groupDirectory
}

/** 这一格里当前选区碰到的排除名（`excludedByNames` 的口径：任一目录段命中名字就算被排除）。 */
function excludedNameOf(target: MarkRootTarget, state: MarkRootState): string | null {
  if (target.kind !== 'directory') return null
  return excludedByNames(target.path, state.excludedDirs)
}

function isSourceRoot(target: MarkRootTarget, state: MarkRootState): boolean {
  return state.sourcePaths.some(root => root === target.path || target.path.startsWith(`${root}/`))
}

/**
 * 成员表与可见性（顺序 = `customization.min.xml:62-65`）。
 * 返回空表 = 这一格整条不渲染（`MarkAsContentRootAction.kt:24-29` 那种
 * `isEnabledAndVisible = false` 的写法，本仓就是不画）。
 */
export function markRootItems(targets: readonly MarkRootTarget[], state: MarkRootState): { id: MarkRootCommand; label: string }[] {
  if (!targets.length) return []
  const directories = targets.filter(target => target.kind === 'directory')
  // 本仓的两种标记都只作用在目录上：文件选区（含混着文件的选区里的文件）没有落点。
  if (!directories.length) return []
  const items: { id: MarkRootCommand; label: string }[] = []
  const excluded = directories.map(target => excludedNameOf(target, state))
  const allExcluded = excluded.every(name => name !== null)
  const noneExcluded = excluded.every(name => name === null)
  const marked = directories.map(target => ({ excluded: excludedByNames(target.path, state.excludedDirs) !== null, root: isSourceRoot(target, state) }))
  const allMarked = marked.every(item => item.excluded || item.root)
  const allExcludedOnly = marked.every(item => item.excluded && !item.root)
  const allRootOnly = marked.every(item => !item.excluded && item.root)
  // 上游的判据是 `files.all { … }`（`MarkAsContentRootAction.kt:25-29`、`UnmarkRootAction.java:44-55`
  // 的 `ContainerUtil.all`）：**整段选区都满足**才给这一项。混着「已排除 / 未排除」的选区两个都不给，
  // 于是整格空表 ⇒ 调用方不渲染（上游 `MarkRootGroup` 是 `NonTrivialActionGroup`，子项全隐藏就把组本身也藏掉）。
  if (noneExcluded) items.push({ id: 'exclude', label: MARK_ROOT_TEXTS.exclude })
  else if (allExcluded) items.push({ id: 'include', label: MARK_ROOT_TEXTS.include })
  if (allMarked) {
    // 动态标题（`UnmarkRootAction.java:29-41`）：只碰到排除 ⇒ 「取消排除」；只碰到源根 ⇒ 「取消标记为{0}」；
    // 两种混在一起 ⇒ 「取消标记」（`mark.as.unmark.several`）。
    const label = allExcludedOnly ? MARK_ROOT_TEXTS.unmarkExcluded
      : allRootOnly ? MARK_ROOT_TEXTS.unmarkAsTemplate.replace('{0}', MARK_ROOT_TEXTS.sourcesRoot)
        : MARK_ROOT_TEXTS.unmarkSeveral
    items.push({ id: 'unmark', label })
  }
  return items
}

/**
 * 一个命令要写回设置的那一份（调用方交给 `project.settings.update`，
 * 与本仓既有的写法同一条路：`src/treeActions.ts:88` 的 `associateFileType`）。
 * 没有任何可写的（例如给没标记过的目录按「取消标记」）就返回 null，调用方不动磁盘。
 */
export function markRootPatch(command: MarkRootCommand, targets: readonly MarkRootTarget[], state: MarkRootState): MarkRootState & {
  /** 写回去的两份表；没变的那一份保持原样，调用方按名字取用。 */
  changed: readonly ('excludedDirs' | 'sourcePaths')[]
} {
  const directories = targets.filter(target => target.kind === 'directory')
  const excludedDirs = [...state.excludedDirs]
  const sourcePaths = [...state.sourcePaths]
  const changed: ('excludedDirs' | 'sourcePaths')[] = []
  if (command === 'exclude') {
    for (const target of directories) {
      if (excludedByNames(target.path, excludedDirs)) continue
      if (!excludedDirs.includes(target.name)) { excludedDirs.push(target.name); changed.push('excludedDirs') }
    }
  }
  if (command === 'include' || command === 'unmark') {
    for (const target of directories) {
      const name = excludedByNames(target.path, excludedDirs)
      if (command === 'unmark' && !name) {
        // 只被源根标记命中的目录：取消的是源根那一份。
        const root = sourcePaths.find(root => root === target.path || target.path.startsWith(`${root}/`))
        if (root) { sourcePaths.splice(sourcePaths.indexOf(root), 1); changed.push('sourcePaths') }
        continue
      }
      if (name && !excludedDirs.includes(name)) continue
      if (name) { excludedDirs.splice(excludedDirs.indexOf(name), 1); changed.push('excludedDirs') }
      if (command === 'unmark') {
        const root = sourcePaths.find(root => root === target.path || target.path.startsWith(`${root}/`))
        if (root) { sourcePaths.splice(sourcePaths.indexOf(root), 1); changed.push('sourcePaths') }
      }
    }
  }
  return { excludedDirs, sourcePaths, changed: [...new Set(changed)] }
}

/** 给通知用的那句话（本仓自己组织的提示语，上游没有对应文案：动作不弹 toast）。 */
export function markRootNotice(command: MarkRootCommand, targets: readonly MarkRootTarget[], changed: readonly string[]): string {
  if (!changed.length) return '没有需要更改的标记。'
  const names = targets.filter(target => target.kind === 'directory').map(target => target.name)
  const what = names.length === 1 ? names[0]! : `${names.length} 个目录`
  if (command === 'exclude') return `已把 ${what} 按名字排除（设置 → 项目结构 里可改回）`
  if (command === 'include') return `已取消排除 ${what}`
  return `已取消 ${what} 的标记`
}
