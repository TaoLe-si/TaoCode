// 文件选择器的**树模型与交互语义** —— `pf/file-chooser` 族级判词的主体部分。
//
// 上游依据（逐条核过，行号可复现）：
//   · `platform/ide-core/src/com/intellij/openapi/fileChooser/FileElement.java:24-27`
//     一个元素 = (VirtualFile, name)；`:29-35` parent 链；`:45-61` `getPath()` 沿 parent 链
//     拼路径（根节点那一层不带分隔符，`:50`）；`:81-83` `isHidden`；`:85-87`/`:106-112` `isArchive`。
//   · `…/fileChooser/FileChooserDescriptor.java` 的判定面（已落在 `src/fileChooserDescriptor.ts`）：
//     `isFileVisible` `:296-320`、`isFileSelectable` `:326-337`、`isHidden` `:341-343`、
//     `withRoots` / `withExtensionFilter` / `isChooseFolders` / `isChooseJarContents`。
//   · 判词点名的「树形浏览」：上游**只有一棵 `JTree`**（`platform/platform-impl/src/com/intellij/
//     openapi/fileChooser/ex/FileChooserDialogImpl.java:206` `myFileSystemTree.getTree()`、`:393-396`
//     选择/展开监听），孩子按 `FileTreeModel.java:303-310` **懒加载**，展开由
//     `FileChooserDialogImpl.java:465` `FileTreeExpansionListener` 触发。
//     ⚠️ **订正（2026-10-06 复核）**：本文件早先的版本写着「上游是 `FileChooserDialog` 的
//     `FileViewMode`（TREE / LIST 两个值）」—— 三条路都搜过（按文件名 `FileViewMode` 全树只有
//     `recentFiles` 的 `createRecentFileViewModel` 命中；在 `com/intellij/openapi/fileChooser/` 包内
//     搜 `viewMode`/`VIEW_MODE` 零命中；keymap/action 的 XML id 里也没有），**上游没有这个枚举**，
//     那条坐标是编的，已删除。本仓的 `ChooserViewMode` 因此**不**声称照抄上游的两套控件：
//     `tree` = 真按 `FileTreeModel` 的懒加载把展开的目录**就地嵌套**画出来（`visibleChooserRows`），，
//     `list` = 只列当前目录那一层（`chooserChildren` 直接用）。这是本仓架构下承接同一件
//     用户可见事（"看得到层级"vs"只看当前层"）的做法，排序两档共用同一条（`:275-288`）。
//   · 「最近文件 / 收藏位置」：上游的 `RecentFileManager`/`FavoritesList` 是**独立**的
//     `JTree` 根（`FileChooserDialog` 左侧那几行），它们与目录树共享 `FileElement` 叶子形状，
//     所以本仓把两者做成同一个 `ChooserNode` 树的两种根。
//   · 「文件名输入」：`FileChooserDialog` 底部的 filename 字段；上游在
//     `TextFieldWithBrowseButton` 那一栏，本仓落成 `resolveTypedName`。
//   · 「新建目录」：上游 `NewFolderAction.java:96-110`（老选择器）与
//     `universal/UniversalFileChooser.kt:408-440`（新选择器）都是「问一个名字 → 建 → 选中新目录」，
//     名字里带分隔符时**逐段建多级**（`NioFileSystemTree.kt:417-428` 的
//     `for (name in StringUtil.tokenize(newFolderName, "\\/"))`）。
//     ⚠️ **订正（2026-10-06 复核）**：早先的版本写着「本仓的宿主没有『创建目录』桥」，
//     因此那个按钮**不渲染**——那条说法是错的：`file.create` 带 `directory` 形参
//     （`native/main.cpp:985-989` → `Workspace::create` `native/workspace.cpp:971`），
//     `src/generateRefactor.ts:58` 与 `src/scratchFiles.ts:25` 已经在用它建目录。
//     于是这里落 `newFolderPlan`（校验 + 逐段折算），组件那边的按钮变成真能点的。
//
// 本仓与上游最大的不等价，写在这里免得被当成 bug：
//   **本仓的目录枚举只有一条通道** —— 宿主 `workspace.list(path)`，且它**只能列工作区之内**
//   （`native/workspace.cpp` 的 `Workspace::list` 走的是 pin 过的根，见
//   `native/workspace_test.cpp:179-204` 的清单口径）。所以：
//     · 工作区内的导航是真数据；
//     · 工作区外的路径只能给一个**不可展开**的节点（标 `outside: true`），
//       点它等于请宿主打开原生对话框（`dialog.pickFile` / `dialog.pickDirectory`）。
//   绝不为了「让树看起来完整」去编目录内容。

import {
  fileNameOf, isArchivePath, isFileSelectable, isFileVisible, matchesExtensionFilter,
  type FileChooserDescriptor,
} from './fileChooserDescriptor.ts'
import { caseConflictFor, type CaseEntry, type CaseConflict } from './fileChooserCase.ts'
// 复用仓里已有的自然序实现，不再抄第二份（`NaturalComparator.naturalCompare(…, ignoreCase=true, likeFileNames=false)`
// 的等价物，判据在 `tests/problems-view.test.mjs` 那一侧）。
import { naturalCompare } from './problemsView.ts'
import { fileTypeManager } from './fileTypeRegistry.ts'

/** 路径统一按 `/`（与工作区其余部分同口径）。 */
const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

/** `FileElement`（`FileElement.java:18-35`）的等价物：名字 + 路径 + parent 链。 */
export interface ChooserNode {
  /** 显示名（`getName()`，`FileElement.java:41-43`）。 */
  readonly name: string
  /** 完整路径（`getPath()` 沿 parent 拼出来的那一份，`FileElement.java:45-61`）。工作区根是 `''`。 */
  readonly path: string
  readonly kind: 'directory' | 'file'
  readonly children: readonly ChooserNode[]
  /** 归档（`isArchive`，`FileElement.java:85-87`）。 */
  readonly archive: boolean
  /**
   * 落在工作区之外，本仓列不出它的内容（见文件头的不等价说明）。
   * 这种节点**不渲染展开箭头**，双击/回车走宿主原生对话框。
   */
  readonly outside: boolean
  /** 主机给的隐藏标记（`Entry` 上没有；`isFileHidden` 只判以点开头那一半，见 `fileChooserDescriptor.ts:225-227`）。 */
  readonly hidden?: boolean
}

/** 宿主 `workspace.list` 的返回形状（`Entry`，`src/bridge.ts:54`）。 */
export interface ChooserListing {
  readonly entries: readonly { name: string; path: string; kind: 'directory' | 'file' }[]
}

/**
 * `FileViewMode`：上游 `FileChooserDialog` 的 TREE / LIST 两值。
 * 差别只落在**排序与分组**（本仓没有真的两套控件，共用一棵虚拟树）。
 */
export type ChooserViewMode = 'tree' | 'list'

/** 排序口径（上游 `FileTreeModel.State.compare`，`tree/FileTreeModel.java:275-288`）。 */
export interface ChooserSort {
  readonly mode: ChooserViewMode
  /** 目录在前（`:279-281` 的 `sortDirectories` 那一支）。 */
  readonly directoriesFirst: boolean
  /**
   * 归档跟目录一起排（`:282-285`：`sortArchives && descriptor.isChooseJarContents()` 时
   * `FileElement.isArchive` 为真的文件排在普通文件之前）。
   * 默认开；`chooseJarContents` 关掉时这一档整个不生效（上游那个 `&&`）。
   */
  readonly sortArchives?: boolean
}

/**
 * 默认排序：目录在前、**自然序**、不区分大小写。
 * 上游那条名字比较是 `StringUtil.naturalCompare(one.getName(), two.getName())`
 * （`FileTreeModel.java:287`）→ `platform/util/src/com/intellij/openapi/util/text/StringUtil.java:2691-2693`
 * 的 `NaturalComparator.INSTANCE.compare` → `platform/util/base/src/com/intellij/openapi/util/text/NaturalComparator.java:20-34`
 * （`ignoreCase=true`、`likeFileNames=false`：数字段按位数与数值比，`a2` 排在 `a10` 前）。
 * ⚠️ 早先这里写的是「字母序 + `AlphabeticalComparator`」，与本仓实现的 `toLowerCase()` 字典序；
 * 那既不是上游的坐标也不是上游的次序，2026-10-06 一并订正为自然序。
 */
export const DEFAULT_SORT: ChooserSort = { mode: 'tree', directoriesFirst: true, sortArchives: true }

/** 上游 `StringUtil.naturalCompare` 的等价物（见 `DEFAULT_SORT` 那段）。 */
const compareName = (left: string, right: string) => naturalCompare(left, right)

/**
 * 排序分组号（`FileTreeModel.java:279-286` 的两级判定折成一个数）：
 * 目录 0；`sortArchives` 且描述件收 jar 内容时归档也是 0 之后的 1；其余文件 2。
 * `directoriesFirst` 为假时不分组（`:279` 的那个 `if` 不进）。
 */
const chooserRank = (node: ChooserNode, descriptor: FileChooserDescriptor, sort: ChooserSort): number => {
  if (!sort.directoriesFirst) return 0
  if (node.kind === 'directory') return 0
  if (sort.sortArchives !== false && descriptor.chooseJarContents && node.archive) return 1
  return 2
}

/**
 * 一个目录清单 → 子节点列表。
 *
 * 可见性照 `FileChooserDescriptor.isFileVisible`（`:296-320`）**整条**走，经
 * `fileChooserDescriptor.ts` 里那三个判定：非目录先看「这个描述件收不收文件」
 * （`chooseFiles`，或 `chooseJarContents` 且是归档，`:302-304`），再看扩展名过滤
 * （`matchesFilters`，`:305-307`）—— **不合过滤的文件是"不出现"，不是"灰掉"**；
 * 然后才是忽略清单（`:310-312`）与隐藏项（`:314-316`）。
 * 目录跳过前两段（`:301` 的 `if (!file.isDirectory())`），所以「只选文件」时目录仍然出现，
 * 只是不可选 —— 这是上游的形状，本仓照抄。
 *
 * 排序：`directoriesFirst` 为真时「目录段 →（收 jar 内容时的）归档段 → 文件段」，
 * 段内与整表混排都用**自然序**（`FileTreeModel.java:287`）。
 */
export function chooserChildren(
  descriptor: FileChooserDescriptor,
  path: string,
  listing: ChooserListing | null,
  sort: ChooserSort = DEFAULT_SORT,
): ChooserNode[] {
  if (!listing) return []
  const nodes: ChooserNode[] = []
  for (const entry of listing.entries) {
    const name = entry.name || fileNameOf(entry.path)
    if (entry.kind !== 'directory') {
      // `:301-308`：非目录的两道可见性闸门。归档那一支是 `chooseJarContents`（`:302`）。
      const collectable = descriptor.chooseFiles || (descriptor.chooseJarContents && isArchivePath(name))
      if (!collectable || !matchesExtensionFilter(descriptor, name)) continue
    }
    if (!isFileVisible(descriptor, name)) continue
    const childPath = path ? `${path}/${name}` : name
    nodes.push({
      name, path: childPath, kind: entry.kind, children: [],
      archive: entry.kind === 'file' && isArchivePath(name),
      outside: false,
    })
  }
  nodes.sort((left, right) => {
    const rank = chooserRank(left, descriptor, sort) - chooserRank(right, descriptor, sort)
    if (rank !== 0) return rank
    return compareName(left.name, right.name)
  })
  return nodes
}

/** 行是不是灰的（可见但不可选；上游把不可选目录画成灰色而非隐藏）。 */
export function isNodeSelectable(descriptor: FileChooserDescriptor, node: ChooserNode): boolean {
  if (node.outside) return false
  return isFileSelectable(descriptor, node.path, node.kind, node.hidden)
}

/** 行标灰时给的那句原因（tooltip / `aria-disabled` 的说明）。 */
export function nodeSelectableReason(descriptor: FileChooserDescriptor, node: ChooserNode): string {
  if (node.outside) return '该路径在工作区之外，本仓列不出内容（用宿主对话框选它）。'
  if (isNodeSelectable(descriptor, node)) return ''
  return node.kind === 'directory'
    ? `「${descriptor.title}」只能选文件，目录只能进入不能选中。`
    : `不符合「${descriptor.extensionFilter?.label ?? '文件类型'}」的过滤条件。`
}

// ── 文件名输入（`FileChooserDialog` 底部的 filename 字段）──────────────────────────

/** 文件名输入框的判定结果。 */
export interface TypedNameResult {
  /** 去掉尾部空白与两侧引号之后的**文件名**（不含目录部分）。空串 = 没输入。 */
  readonly name: string
  /** 输入里带的目录部分（`"sub/a.txt"` 里的 `sub`），空串 = 就在当前目录下。 */
  readonly directory: string
  /** 拼回完整路径（当前目录 + 输入里的目录部分 + 文件名）。 */
  readonly path: string
  /** 能不能拿它去选（按描述件判定文件那一支）。 */
  readonly selectable: boolean
  /** 不可选时的一句原因。 */
  readonly problem: string
}

/**
 * 解析文件名输入框的内容。
 *
 * 上游 `FileChooserDialog` 的 filename 字段允许带相对目录（`"sub/a.txt"` 直接跳两层），
 * 两侧引号会被剥掉（从资源管理器拖路径进来常带引号），尾部空白也去掉。
 * 这里照这两条，并把结果按描述件的**文件**那一支复核（目录部分给 `isUnderRoots` 之外的
 * 那一层由调用方补：`path` 已经拼好，调用方拿它去跑 `selectionProblem` 即可）。
 */
export function resolveTypedName(
  descriptor: FileChooserDescriptor,
  currentDirectory: string,
  typed: string,
): TypedNameResult {
  const base = normalize(currentDirectory)
  // 引号与尾部空白：拖进来的路径常带引号（`"C:\a\b.txt"`），`FileChooserDialog` 也会剥。
  const cleaned = typed.trim().replace(/^["']|["']$/g, '').trim()
  const slash = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'))
  const directory = slash >= 0 ? normalize(cleaned.slice(0, slash)) : ''
  const name = slash >= 0 ? cleaned.slice(slash + 1) : cleaned
  const path = [base, directory, name].filter(Boolean).join('/')
  if (!name) return { name: '', directory, path: base, selectable: false, problem: '没有输入文件名。' }
  if (!isFileSelectable(descriptor, path, 'file')) {
    const filter = descriptor.extensionFilter
    const patterns = filter ? filter.extensions.map(extension => `*.${extension}`).join('、') : ''
    return {
      name, directory, path, selectable: false,
      problem: !descriptor.chooseFiles
        ? `「${descriptor.title}」只能选目录。`
        : `不符合「${filter?.label ?? '文件类型'}」的过滤（${patterns}）。`,
    }
  }
  return { name, directory, path, selectable: true, problem: '' }
}

// ── 覆盖确认与大小写冲突（选择器在写盘前要问的那两句）────────────────────────────

/** 覆盖确认的判定结果。 */
export interface OverwriteCheck {
  /** 目标已存在（要覆盖）。 */
  readonly exists: boolean
  /** 大小写冲突（`src/fileChooserCase.ts` 的 `CaseConflict`；没有就是 null）。 */
  readonly caseConflict: CaseConflict | null
  /** 弹给用户的一句话；不需要确认时是空串。 */
  readonly question: string
  /** 有没有需要用户点头的事。 */
  readonly needsConfirmation: boolean
}

const asCaseEntries = (entries: readonly { name: string; kind: 'directory' | 'file' }[]): CaseEntry[] =>
  entries.map(entry => ({ name: entry.name, kind: entry.kind }))

/**
 * 选完之后、写盘之前的**覆盖确认**。
 *
 * 上游那一侧分两问：
 *   · 「文件已存在，是否替换？」（`FileChooserDialog` 的确认弹层，`FileChooserDescriptor.validateSelectedFiles` 之后）；
 *   · 「同名（忽略大小写）的文件已存在」（`FileSystemUtil.java:222-223` 判 sensitive 时的那一档）。
 * 本仓合成一次判定：把目标所在目录的清单给进来，两问一次答。
 *
 * `directoryListing` 可以是 null（调用方没有该目录的清单）——那时只答第一问，
 * 大小写那一问**如实说判不了**，不猜（上游在 UNKNOWN 分支也不猜，`:170-205`）。
 */
export function checkOverwrite(
  directoryListing: ChooserListing | null,
  targetPath: string,
): OverwriteCheck {
  const entries = directoryListing?.entries ?? []
  const targetName = fileNameOf(targetPath)
  const existing = entries.find(entry => entry.name === targetName)
  const caseConflict = directoryListing
    ? caseConflictFor(asCaseEntries(entries), targetName)
    : null
  if (!existing) {
    return caseConflict
      ? { exists: false, caseConflict, question: caseConflict.message, needsConfirmation: true }
      : { exists: false, caseConflict: null, question: '', needsConfirmation: false }
  }
  const question = `「${targetName}」已存在，要替换它吗？`
  return {
    exists: true,
    caseConflict,
    question: caseConflict ? `${question}\n${caseConflict.message}` : question,
    needsConfirmation: true,
  }
}

// ── 左侧的「最近 / 收藏」两行（上游是独立的 JTree 根）────────────────────────────

/** 一条最近文件或收藏位置。 */
export interface ChooserShortcut {
  readonly label: string
  /** 完整路径（上游 `FavoritesList` 存的是 root + path 两段，本仓合成一个）。 */
  readonly path: string
  readonly kind: 'directory' | 'file'
}

/**
 * 最近文件行（上游 `RecentFileManager` 那一族，`FileChooserDialog` 左侧第一组）。
 *
 * 上游的最近列表是**全局**的、按最近打开排序、去重；本仓的等价数据源是
 * `src/recentFilesModel.ts` 的 `RecentFilesMutableState`（桶内已落），调用方把清单给进来。
 * 这里只做对话框那一侧的加工：**目录优先**（选目录时目录排前面，上游 LIST 视图同口径）、
 * 去重、按 `limit` 截断。
 */
export function recentShortcuts(paths: readonly string[], limit = 10): ChooserShortcut[] {
  const seen = new Set<string>()
  const out: ChooserShortcut[] = []
  for (const raw of paths) {
    const path = normalize(raw)
    if (!path || seen.has(path.toLowerCase())) continue
    seen.add(path.toLowerCase())
    out.push({ label: fileNameOf(path), path, kind: 'file' })
    if (out.length >= limit) break
  }
  return out
}

/**
 * 收藏位置行（上游 `FavoritesList`，`FileChooserDialog` 左侧第二组）。
 * 上游收藏的是**根**（一个 project root / 外部目录），所以只接受目录；
 * 传进来的文件路径会被丢掉 —— 如实说明而不是悄悄画成一行。
 */
export function favoriteShortcuts(roots: readonly string[]): ChooserShortcut[] {
  return roots
    .map(normalize)
    .filter(Boolean)
    .map(path => ({ label: fileNameOf(path) || path, path, kind: 'directory' as const }))
}

// ── 树形浏览（`FileTreeModel` 的懒加载孩子 + 就地展开）─────────────────────────────

/**
 * 叶子判定（`tree/FileTreeModel.java:298-301` 的 `isLeaf`）：
 *   · 目录**永远不是**叶子（`:299` 的 `if (file.isDirectory()) return false`）；
 *   · 文件是叶子，除非描述件收 jar 内容且它是归档（`:300` 的
 *     `!descriptor.isChooseJarContents() || !FileElement.isArchive(file)`）。
 * 工作区外的条目在本仓列不出内容，画成叶子（不编出没有孩子的展开箭头）。
 */
export function isChooserLeaf(descriptor: FileChooserDescriptor, node: ChooserNode): boolean {
  if (node.outside) return true
  if (node.kind === 'directory') return false
  return !descriptor.chooseJarContents || !node.archive
}

/** 选择器树里的一行（上游 `JTree` 的一行，`FileChooserDialogImpl.java:206` 那棵树）。 */
export interface ChooserRow {
  readonly node: ChooserNode
  /** 缩进层级：根的孩子是 0。上游是 `TreePath` 的深度，本仓自己数。 */
  readonly depth: number
  /** 已展开的目录（`FileChooserDialogImpl.java:465` `FileTreeExpansionListener` 的那个状态）。 */
  readonly expanded: boolean
  /** 叶子（`isChooserLeaf`）—— 非叶子才画展开箭头。 */
  readonly leaf: boolean
  /** 展开了但**列不出内容**（宿主没有那一层的清单 / jar 内部没有通道）：行仍画，孩子不编。 */
  readonly unlisted: boolean
}

/** 清单表：路径 → 该路径的目录清单（null = 列不出）。 */
export type ChooserListings = Readonly<Record<string, ChooserListing | null>>

/**
 * 防御上限：宿主万一回了一个「自己也是自己的孩子」的清单，递归不能把渲染卡死。
 * 上游 `JTree` 靠 `TreePath` 天然不会绕圈，本仓的扁平行表要自己兜一下。
 */
const EXPANSION_ROW_LIMIT = 512

/**
 * 把「已展开的目录集合」折成**一列要画的行**（`FileTreeModel.java:303-310` 的 `getChildren`
 * 是懒加载的，`FileChooserDialogImpl.java:465-486` 的展开监听才是触发点）。
 *
 * 两条模式（见文件头的订正）：
 *   · `mode === 'list'`：只列 `rootPath` 这一层，深度全是 0；
 *   · `mode === 'tree'`：`expandedPaths` 里的目录就地嵌套，孩子继续按同一条排序规则排。
 * 只有**目录**会被展开；`outside` 的节点不展开（列不出内容，不猜）。
 */
export function visibleChooserRows(
  descriptor: FileChooserDescriptor,
  rootPath: string,
  listings: ChooserListings,
  expandedPaths: readonly string[],
  sort: ChooserSort = DEFAULT_SORT,
): ChooserRow[] {
  const nested = sort.mode === 'tree'
  const base = normalize(rootPath)
  const expanded = new Set(expandedPaths.map(normalize))
  const rows: ChooserRow[] = []
  const walk = (path: string, depth: number): void => {
    const listing = listings[path] ?? null
    for (const node of chooserChildren(descriptor, path, listing, sort)) {
      const leaf = isChooserLeaf(descriptor, node)
      const isExpanded = nested && !leaf && !node.outside && expanded.has(node.path)
      rows.push({ node, depth, expanded: isExpanded, leaf, unlisted: isExpanded && listings[node.path] == null })
      if (isExpanded && rows.length < EXPANSION_ROW_LIMIT) walk(node.path, depth + 1)
    }
  }
  walk(base, 0)
  return rows
}

// ── 「新建目录」（`NewFolderAction.java:96-150` + `NioFileSystemTree.kt:417-428`）─────

/** 新目录名的判定结果。 */
export interface NewFolderPlan {
  /** 按 `StringUtil.tokenize(input, "\\/")` 折出来的段（`NioFileSystemTree.kt:419`）。 */
  readonly segments: readonly string[]
  /** 当前目录 + 全部段 = 要建的那条路径。 */
  readonly path: string
  /** 拦下来不给建的那句话（`:129-147` 的 `checkInput` 返回 false 的那些档）。空串 = 可以建。 */
  readonly error: string
  /** 警告但仍放行的一档（`:143-146`：名字在忽略清单里时**设了 errorText 却 return true**）。 */
  readonly warning: string
  readonly creatable: boolean
}

/**
 * `StringUtil.tokenize(input, "\\/")`（`NewFolderAction.java:129`、`NioFileSystemTree.kt:419`）——
 * 上游那里是 `StringTokenizer`（`platform/util/src/com/intellij/openapi/util/text/StringUtil.java:1366-1367`
 * → `:923-931`），**跳过空段、不剥空白**，这里同口径。
 */
export const tokenizeFolderName = (input: string): string[] =>
  input.split(/[\\/]/).filter(token => token.length > 0)

/**
 * 校验 + 折算新目录名，逐条照 `NewFolderAction.java:126-149` 的 `NewFolderValidator.checkInput`：
 *   1. **只有第一段**查重（`:130` 的 `if (firstToken)` 才 `findChild`），撞目录给
 *      「已存在名为『X』的文件夹」（`IdeBundle.properties:2650`），撞文件给
 *      「已存在名为『X』的文件」（`:2651`），返回 false；
 *   2. 任意一段是 `.` 或 `..` → 「不能用『X』作文件夹名」（`:2652`），返回 false；
 *   3. 某一段在忽略清单里（`FileTypeManager.isFileIgnored`，`:143-146`）→
 *      「建出来也不会显示」（`:2653`），但**返回 true**（放行 + 警告）；
 *   4. 名字为空 → 不报错但没有可建的东西（`:148` 的 `!inputString.isEmpty()`），拦下。
 * `listing` 给 null（调用方没有该目录的清单）时第 1 条判不了 —— **不猜**，按上游
 * `Files.createDirectories` 的幂等语义放行（`NioFileSystemTree.kt:421`）。
 *
 * ⚠️ 与上游的一条**有意偏差**：这里先把整串 `trim()` 再折段。上游 `checkInput` 只判
 * `isEmpty()`，`StringTokenizer` 不剥空白，于是 `' a'` 会建出一个名为「空格 a」的目录。
 * 本仓这个输入框与文件名输入框同一个（`resolveTypedName` 也先 trim 再剥引号，见上面那段），
 * 粘贴带空白的路径是常态，所以统一剥一次首尾空白；**段与段之间的空白照上游保留**。
 */
export function newFolderPlan(
  currentDirectory: string,
  input: string,
  listing: ChooserListing | null,
): NewFolderPlan {
  const segments = tokenizeFolderName(input.trim())
  const base = normalize(currentDirectory)
  const path = [...(base ? [base] : []), ...segments].join('/')
  if (!segments.length) return { segments, path: base, error: '请填写新目录名。', warning: '', creatable: false }
  const first = segments[0]!
  if (listing) {
    const hit = listing.entries.find(entry => entry.name === first)
    if (hit) {
      return {
        segments, path, creatable: false, warning: '',
        error: hit.kind === 'directory' ? `已存在名为「${first}」的文件夹。` : `已存在名为「${first}」的文件。`,
      }
    }
    // 完全同名那一档上面已经拦了；这里接**只差大小写**的那一档
    // （`src/fileChooserCase.ts` 的 `caseConflictFor` ← `FileSystemUtil.java:201-223`）。
    // 为什么建目录也要过它：在 Windows 这种不敏感卷上，「已有 SRC、再建 src」
    // 会被 `Files.createDirectories`（`NioFileSystemTree.kt:421`，幂等）**静默吃掉** ——
    // 用户输入框里写的名字和盘上留下的名字不一样。本仓把这句结论原样报出来，不放行。
    const conflict = caseConflictFor(asCaseEntries(listing.entries), first)
    if (conflict) return { segments, path, error: conflict.message, warning: '', creatable: false }
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      return { segments, path, error: `不能用「${segment}」作文件夹名。`, warning: '', creatable: false }
    }
  }
  const warning = segments.some(segment => fileTypeManager.isFileIgnored(segment))
    ? '这个名字在忽略清单里，建出来也不会显示。'
    : ''
  return { segments, path, error: '', warning, creatable: true }
}
