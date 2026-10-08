// 「在工程内查找」结果面板的**按目录分组**与**头部动作工具条**的纯规则层（零 Vue / 零 DOM）。
//
// 订正留痕（任务书给的出处不是这一族）：`platform/lang-impl/src/com/intellij/find/impl/livePreview/
// LivePreviewController.java:40` 是 `public final class LivePreviewController implements
// LivePreview.Delegate, FindUtil.ReplaceDelegate` 的**类声明那一行**，讲的是**编辑器内**的实时高亮
// （同目录只有 `LivePreview` / `SearchResults` / `SelectionManager` / 两个 `*Presentation`，
// **没有** `LivePreviewPanel` / `LivePreviewTable` 两个类，`ls` 过整个目录）。「在工程内查找」的结果窗口
// 是 **UsageView**：`platform/lang-impl/src/com/intellij/find/findInProject/FindInProjectManager.java:86-98`
// （`UsageViewManager.getInstance(myProject)` → `manager.searchAndShowUsages(...)`，`UsageViewPresentation`
// 由 `FindInProjectUtil.setupViewPresentation` 造，`FindInProjectUtil.java:395-453`）。
// 所以「分组规则」在 `platform/usageView-impl/src/com/intellij/usages/impl/rules/`，
// 「头部工具条」在 `platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:989`
// （`createActionsToolbar`）→ `:1074-1119`（`createActions`）。
//
// 与 `src/usageViewGrouping.ts` 的关系（**明确**）：
//   · 同一套上游规则。Find 结果的目录分组就是 `rules/DirectoryGroupingRule.java`（档号 400，
//     `UsageGroupingRulesDefaultRanks.java:27`）与 `rules/DirectoryStructureGroupingRule.java`（同档号），
//     文件层是 `rules/FileGroupingRule.java`（档号 500，`:30-32`）；`src/usageViewGrouping.ts` 的
//     `buildUsageTree` 已经把**目录层 + 文件层**实现了，键格式、比较器、计数文本都在那里。
//   · 因此本模块**复用**那三份，不再写第二遍：`usageGroupKey`（组键）、`usageCounterText`（组行计数，
//     `UsageViewBundle.properties:131`）、`compareUsageTreeTextIgnoreCase`（组间比较，
//     `src/usageViewTreeModel.ts:140`，上游 `DirectoryGroupingRule.java:189` 的 `compareToIgnoreCase`）。
//   · 本模块**新增**的、`usageViewGrouping.ts` 里没有的那一块是：上游那**两个互相独立的开关**
//     —— `isGroupByPackage`（默认 **true**，`platform/usageView/src/com/intellij/usages/UsageViewSettings.kt:23`）
//     与 `isGroupByDirectoryStructure`（默认 **false**，`:26`）—— 二者**都会**产出目录层，但形态不同
//     （前者每个直接父目录一个组、后者逐级一条链），且写入时互斥（见 `toggleFindGrouping`）。
//     `usageViewGrouping.ts` 只建了「目录结构」那一档（`showDirectories`，默认关），
//     所以它给出的「默认不分目录层」只对 `isGroupByDirectoryStructure` 成立，**不**等于 Find 窗口的默认档。
//
// 纯数据层：只 import 上面那三个既有导出，不 import vue / DOM / bridge，便于 `node --test` 直测。

import { usageCounterText, usageGroupKey } from './usageViewGrouping.ts'
import { compareUsageLocations, compareUsageTreeTextIgnoreCase } from './usageViewTreeModel.ts'

// ---------------------------------------------------------------- 输入

/**
 * 一条查找命中（`src/bridge.ts:186-188` 的 `SearchPreviewMatch` 里与本模块有关的三格）。
 * **`line` 与 `column` 都是 1 基**（宿主 `native/search.cpp:698` 用
 * `code_points(...) + 1` 报列号），与 `UsageLocationLike`（0 基 `line`/`character`）**不同**，
 * 所以位置文本直接拼，不走 `usagePositionText`（那个会 +1）。
 */
export interface FindResultLike {
  path: string
  /** 1 基行号。 */
  line: number
  /** 1 基列号（码点数）。 */
  column: number
}

/** 位置文本 `行:列`（两格都是 1 基，`native/search.cpp:698` 的口径）。 */
export function findResultPositionText(result: FindResultLike): string {
  return `${result.line}:${result.column}`
}

/** 把命中折成用法树那一套坐标（`column` 1 基 → `character` 0 基），只为复用既有比较器。 */
function asUsageLocation(result: FindResultLike): { path: string; line: number; character: number } {
  return { path: result.path, line: result.line - 1, character: result.column - 1 }
}

// ---------------------------------------------------------------- 分组档（两个开关 + 互斥）

/**
 * 目录分组的两个档（`UsageViewSettings` 的两个布尔）加两个附属档。
 * 默认值逐条取上游构造器的默认参数（`UsageViewSettings.kt:20-27`）与各属性的 `property(...)` 初值。
 */
export interface FindGroupingOptions {
  /** `GROUP_BY_PACKAGE`，默认 **true**（`UsageViewSettings.kt:23` 的构造参数 + `:97`）。 */
  groupByPackage: boolean
  /** `GROUP_BY_DIRECTORY_STRUCTURE`，默认 **false**（`:26` + `:103`）。 */
  groupByDirectoryStructure: boolean
  /** `COMPACT_MIDDLE_DIRECTORIES`，默认 **false**（`:109`）。 */
  compactMiddleDirectories: boolean
  /** `GROUP_BY_FILE_STRUCTURE`，默认 **true**（`:21` + `:100`）。 */
  groupByFileStructure: boolean
  /** `SHORT_FILE_PATH`，默认 **true**（`:115`）。 */
  showShortFilePath: boolean
  /** 工作区根（本仓路径本来就是工作区相对的，默认空串 = 不用剥前缀）。 */
  basePath: string
}

export function defaultFindGroupingOptions(): FindGroupingOptions {
  return {
    groupByPackage: true,
    groupByDirectoryStructure: false,
    compactMiddleDirectories: false,
    groupByFileStructure: true,
    showShortFilePath: true,
    basePath: '',
  }
}

/**
 * 读档时的那道闸：`ActiveRules.java:44` 只在 `isGroupByPackage() && !isGroupByDirectoryStructure()`
 * 时才装目录（包）规则，`:56` 只在 `isGroupByDirectoryStructure()` 时装目录结构规则。
 * 于是「两个都为真」在**生效层**等于只走目录结构那一支（存储里那个布尔不动）。
 */
export function normalizeFindGroupingOptions(options: Partial<FindGroupingOptions> = {}): FindGroupingOptions {
  const merged = { ...defaultFindGroupingOptions(), ...options }
  if (merged.groupByDirectoryStructure) merged.groupByPackage = false
  return merged
}

/** 目录分组生效的档（两个开关都不开 = 没有目录层）。 */
export function findDirectoryLayerMode(options: FindGroupingOptions): 'none' | 'package' | 'structure' {
  if (options.groupByDirectoryStructure) return 'structure'
  if (options.groupByPackage) return 'package'
  return 'none'
}

/** `GroupByDirectoryAction` 的 id（`DirectoryGroupingRule.java:104` 的 `getGroupingActionId()`）。 */
export const DIRECTORY_GROUPING_ACTION_ID = 'UsageGrouping.Directory'
/** `DirectoryStructureGroupingRule` 的 id（`DirectoryStructureGroupingRule.java:67`）。 */
export const DIRECTORY_STRUCTURE_GROUPING_ACTION_ID = 'UsageGrouping.DirectoryStructure'
/** 文件结构那一档的 id（`FileGroupingRule.java:58`）。 */
export const FILE_STRUCTURE_GROUPING_ACTION_ID = 'UsageGrouping.FileStructure'

/**
 * 按下「按目录分组」那一格：`GroupByDirectoryAction.setOptionValue`（`GroupByDirectoryAction.java:22-28`）
 * 在置真时**顺手把目录结构关掉**（`setGroupByDirectoryStructure(false)`，注释写着 mutually exclusive）。
 */
export function toggleFindGrouping(actionId: string, options: FindGroupingOptions): FindGroupingOptions {
  const next = { ...options }
  if (actionId === DIRECTORY_STRUCTURE_GROUPING_ACTION_ID) {
    next.groupByDirectoryStructure = !options.groupByDirectoryStructure
    // `GroupByDirectoryStructureAction.java:22-26`：置真时把包（目录）那一档关掉。
    if (next.groupByDirectoryStructure) next.groupByPackage = false
    return next
  }
  if (actionId === DIRECTORY_GROUPING_ACTION_ID) {
    next.groupByPackage = !options.groupByPackage
    if (next.groupByPackage) next.groupByDirectoryStructure = false
    return next
  }
  if (actionId === FILE_STRUCTURE_GROUPING_ACTION_ID) next.groupByFileStructure = !options.groupByFileStructure
  return next
}

// ---------------------------------------------------------------- 分组动作表（Group By 弹出组）

/** 一档分组动作（工具条弹出组里的一行）。 */
export interface FindGroupingAction {
  /** 上游动作 id（`intellij.platform.usageView.impl.actions.xml:3-10` 的 `id=`）。 */
  id: string
  /** 呈现文本（`UsageViewBundle.properties` / `IdeBundle.properties` 的键值，中文包同名键）。 */
  title: string
  /** 档号（`UsageGroupingRulesDefaultRanks.java`）。 */
  rank: number
  /** 当前是否选中（`RuleAction.isSelected` → `getOptionValue`，`RuleAction.java:41-44`）。 */
  selected: boolean
  /** 这一档在本仓有没有真实落点（false ⇒ 不渲染，见各条 note）。 */
  available: boolean
  /** 不渲染的原因（`available` 为 true 时为空串）。 */
  unavailableReason: string
}

/**
 * `UsageGroupingRuleProviderImpl.createGroupingActions`（`UsageGroupingRuleProviderImpl.java:55-88`）
 * 给出的项集合。Find 结果的 presentation 被 `FindInProjectUtil.java:441` 置了
 * `setUsageTypeFilteringAvailable(true)` ⇒ 走 `:72-78` 那一支（含 Usage Type）。
 * 顺序：`UsageViewImpl.java:1149` 先按呈现文本字母序排（`sortGroupingActions`，`:1203-1205`），
 * 再把 Module 挪到 Flatten Modules 之前（`moveActionTo`，`:1150-1151` / `:1155-1176`）。
 * 这里按**排序后**的最终顺序给出（英文呈现文本字母序：Directory, Directory Structure, File Structure,
 * Flatten Modules, Module, Usage Type，再把 Module 挪到 Flatten Modules 前）。
 */
export function findGroupingActions(options: FindGroupingOptions = defaultFindGroupingOptions()): FindGroupingAction[] {
  const actions: FindGroupingAction[] = [
    {
      id: DIRECTORY_GROUPING_ACTION_ID,
      // `IdeBundle.properties:1833` "Group by Directory"；中文包同名键 = 按目录分组。
      title: '按目录分组',
      rank: 400,
      selected: false,
      available: true,
      unavailableReason: '',
    },
    {
      id: DIRECTORY_STRUCTURE_GROUPING_ACTION_ID,
      // `UsageViewBundle.properties:21` "Directory Structure"；中文包 = 目录结构。
      title: '目录结构',
      rank: 400,
      selected: false,
      available: true,
      unavailableReason: '',
    },
    {
      id: FILE_STRUCTURE_GROUPING_ACTION_ID,
      // `UsageViewBundle.properties:20` "File Structure"；中文包 = 文件结构。
      title: '文件结构',
      rank: 500,
      selected: false,
      // `FileGroupingRule` 那一档要 `documentSymbol` 才建得出成员层；本仓宿主没接符号时切了不会有变化。
      available: false,
      unavailableReason: '成员层需要 LSP documentSymbol（上游 ClassGroupingRule 的 PSI 等价物），宿主未注入符号源',
    },
    {
      id: 'UsageGrouping.FlattenModules',
      // `UsageViewBundle.properties:25` "Flatten Modules"；中文包 = 平展模块。
      title: '平展模块',
      rank: 300,
      selected: false,
      // `ModuleGroupingRule`（`rules/ModuleGroupingRule.java:32`）要模块表；本仓单根工作区没有模块。
      available: false,
      unavailableReason: '本仓工作区单根、没有模块表（同 src/usageViewGrouping.ts 的登记）',
    },
    {
      id: 'UsageGrouping.Module',
      // `UsageViewBundle.properties:23` "Module"；中文包 = 模块。
      title: '模块',
      rank: 300,
      selected: false,
      available: false,
      unavailableReason: '同上：没有模块表，ModuleGroupingRule 无输入',
    },
    {
      id: 'UsageGrouping.UsageType',
      // `UsageViewBundle.properties:22` "Usage Type"；中文包 = 用法类型。
      title: '用法类型',
      rank: 200,
      selected: false,
      // `UsageTypeGroupingRule` 要 read/write/unknown 那一档（`UsageInfo.getPriority()`）；
      // 本仓结果来自原生文本扫描，没有这一档（同 src/usageViewTreeModel.ts 的架构不等价登记）。
      available: false,
      unavailableReason: '原生文本扫描没有 read/write/unknown 用法类型',
    },
  ]
  const mode = findDirectoryLayerMode(options)
  // 当前档选中的那一格（`RuleAction.isSelected` → `getOptionValue`，`RuleAction.java:41-44`）。
  return actions.map(action => ({ ...action, selected: isFindGroupingSelected(action.id, mode) }))
}

/** 某一格当前是否选中（三个开关各对应一格；其余几档本仓不生效 ⇒ 一律 false）。 */
export function isFindGroupingSelected(actionId: string, mode: 'none' | 'package' | 'structure'): boolean {
  if (actionId === DIRECTORY_GROUPING_ACTION_ID) return mode === 'package'
  if (actionId === DIRECTORY_STRUCTURE_GROUPING_ACTION_ID) return mode === 'structure'
  return false
}

// ---------------------------------------------------------------- 分组键 / 组标题 / 排序

/** 路径规范化（`\\` → `/`，去掉开头的 `./`），与 `src/usageViewGrouping.ts` 的 `normalize` 同一口径。 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

/** 剥掉工作区根前缀（本仓路径本来就是相对的，`basePath` 空串时原样返回）。 */
function relativeToBase(path: string, basePath: string): string {
  const base = normalizePath(basePath).replace(/\/+$/, '')
  if (!base) return path
  if (path === base) return ''
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
}

/**
 * 分组键：命中所在文件的**直接父目录**。
 * 上游 `DirectoryGroupingRule.getParentGroupFor`（`DirectoryGroupingRule.java:65-78`）取的就是
 * `file.getParent()`（`VirtualFileWindow` 先取 delegate，`:69-71`），拿不到父目录就返回 null（不收进这一档）。
 * 返回 `''` = 文件就在工作区根下。
 */
export function findResultDirectory(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  return index < 0 ? '' : normalized.slice(0, index)
}

/**
 * 目录组的标题。
 * 上游 `DirectoryGroupingRule.getPresentableGroupText`（`DirectoryGroupingRule.java:131-157`）：
 *   · 默认构造器是 `this(project, true, false)`（`:50-52`，`myFlattenDirs=true`、`compactMiddleDirectories=false`）
 *     ⇒ 走 `:149-155` 那一支：`baseDirectoryFor(dir)` 拿到包含它的工程基础目录（`:85-95`），
 *     标题 = `VfsUtilCore.getRelativePath(dir, baseDir, '/')`（`VfsUtilCore.java:160-191` 按分隔符逐级拼名字，
 *     **不含**基础目录自身那一级）；取不到基础目录时退回 `myDir.getPresentableUrl()`（`:153`）。
 *   · `compactMiddleDirectories=true` 时走 `:133-147`：`baseDir.getParent()` 那一级**也**算进去
 *     （`:141-145`），所以标题多一层。
 * 本仓工作区单根 ⇒ 基础目录 = 工作区根，标题就是工作区相对的目录路径（`basePath` 空串时即目录路径本身）。
 */
export function findDirectoryGroupTitle(dirPath: string, options: FindGroupingOptions): string {
  const normalized = normalizePath(dirPath)
  const relative = relativeToBase(normalized, options.basePath)
  if (!options.compactMiddleDirectories) return relative
  // compact：多带一层（基础目录名）。本仓路径已是相对的 ⇒ 没有上层可带，原样返回。
  return relative
}

/**
 * 一个命中要挂进的那条目录组链，**由外到内**。
 *   · `package` 档（`myFlattenDirs=true`）= 只一个组，就是直接父目录（`DirectoryGroupingRule.java:72-74`）；
 *   · `structure` 档且 `compactMiddleDirectories=false`：从父目录**一路往上到基础目录之前**每级一个组
 *     （`DirectoryStructureGroupingRule.java:49-54` 的 `while (dir != null && !dir.equals(baseDir))`，
 *     基础目录本身**不**成组），最后 `Collections.reverse`（`:56`）⇒ 最外层在前；
 *   · `structure` 档且 `compactMiddleDirectories=true`：只一个组（`DirectoryStructureGroupingRule.java:44-47`
 *     的 `if (compactMiddleDirectories)` 分支），中间层被折叠。
 * 基础目录直接下的文件 ⇒ 返回空链（上游这一档不给目录组，文件直接挂在文件层）。
 */
export function findDirectoryGroupChain(dirPath: string, options: FindGroupingOptions): string[] {
  const mode = findDirectoryLayerMode(options)
  if (mode === 'none') return []
  const normalized = normalizePath(dirPath)
  // 基础目录直接下的文件不成目录组（`DirectoryStructureGroupingRule.java:50` 的 `!dir.equals(baseDir)`）；
  // 本仓工作区单根 ⇒ 相对基础目录为空串就是这一档。package 档上游会给出一个**标题为空**的组
  // （`DirectoryGroupingRule.java:152-153` 的 `getRelativePath` 在同级时返回空串），本仓与既有
  // `src/usageViewGrouping.ts` 的建树同档：这一级不收，免得画一行没有名字的组。
  if (relativeToBase(normalized, options.basePath) === '') return []
  if (mode === 'package') return [normalized]
  if (options.compactMiddleDirectories) return [normalized]
  // structure：逐级往上，去掉基础目录那一级，再反转成由外到内。
  const base = normalizePath(options.basePath).replace(/\/+$/, '')
  const chain: string[] = []
  let current = normalized
  while (current) {
    if (base && current === base) break
    chain.push(current)
    const index = current.lastIndexOf('/')
    current = index < 0 ? '' : current.slice(0, index)
  }
  chain.reverse()
  return chain
}

/** 组键（复用 `src/usageViewGrouping.ts:455` 的 `usageGroupKey`，目录路径带尾斜杠）。 */
export function findDirectoryGroupKey(dirPath: string): string {
  return usageGroupKey('directory', dirPath ? `${dirPath}/` : '')
}

/** 文件组键（同 `FileGroupingRule` 那一档，`usageGroupKey('file', path)`）。 */
export function findFileGroupKey(path: string): string {
  return usageGroupKey('file', normalizePath(path))
}

/**
 * 文件组的标题。
 * 上游 `FileGroupingRule.getAdjustedName`（`FileGroupingRule.java:93-95`）：
 * `showShortFilePath ? UniqueVFilePathBuilder.getUniqueVirtualFilePath(...) : myFile.getName()`；
 * 开不开由 `UsageViewSettings.isShortFilePathEnabled()`（`UsageViewSettings.kt:118`）
 * = `showShortFilePath && !isGroupByDirectoryStructure && !isGroupByPackage` 决定。
 * ⇒ 有目录层时只给文件名；没有目录层时给整条相对路径（本仓工作区单根，相对路径本身就唯一）。
 */
export function findFileGroupTitle(path: string, options: FindGroupingOptions): string {
  const normalized = normalizePath(path)
  if (findDirectoryLayerMode(options) === 'none') return relativeToBase(normalized, options.basePath)
  const index = normalized.lastIndexOf('/')
  return index < 0 ? normalized : normalized.slice(index + 1)
}

/** 目录组之间：同档比标题（`DirectoryGroupingRule.java:188-190` 的 `compareToIgnoreCase`）。 */
export function compareFindGroupTitles(left: string, right: string): number {
  return compareUsageTreeTextIgnoreCase(left, right)
}

/**
 * 同一父节点下两个孩子的先后：种类先（目录 < 文件），同类再比标题。
 * 上游两处叠起来：`GroupNode.java:350-357` 先比档号（目录结构 400 在文件结构 500 之前，
 * `UsageGroupingRulesDefaultRanks.java:27`/`:31`），同档再 `UsageGroupBase.java:19-23`
 * （先 `myOrder` 再 `compareToIgnoreCase`）。
 */
export function compareFindTreeSiblings(
  left: { kind: FindTreeNodeKind; title: string },
  right: { kind: FindTreeNodeKind; title: string },
): number {
  const rank = (kind: FindTreeNodeKind): number => (kind === 'directory' ? 0 : 1)
  if (rank(left.kind) !== rank(right.kind)) return rank(left.kind) - rank(right.kind)
  return compareFindGroupTitles(left.title, right.title)
}

/**
 * 同一个文件里两处命中的先后：行 → 列。
 * 上游 `UsageViewImpl.USAGE_COMPARATOR_BY_FILE_AND_OFFSET`（`UsageViewImpl.java:207-234`）：
 * 先用法优先级（`:214`，本仓没有这一档，见 `src/usageViewTreeModel.ts` 的登记），
 * 再 `compareByFileAndOffset`（`:225-234`：同文件比 `getNavigationOffset()`，不同文件比
 * `VfsUtilCore.compareByPath`，`VfsUtilCore.java:818-850`）。同文件那半 = 行 → 列，复用既有 `compareUsageLocations`。
 */
export function compareFindMatches(left: FindResultLike, right: FindResultLike): number {
  return compareUsageLocations(asUsageLocation(left), asUsageLocation(right))
}

// ---------------------------------------------------------------- 建树

export type FindTreeNodeKind = 'directory' | 'file'

/** 分组树节点：目录（可嵌套）或文件（叶子挂它下面）。 */
export interface FindTreeNode {
  kind: FindTreeNodeKind
  /** 组键（目录 = `usageGroupKey('directory', 目录路径 + '/')`；文件 = `usageGroupKey('file', 路径)`）。 */
  key: string
  /** 目录路径（`/` 结尾，根下为 `''`）或文件路径（工作区相对）。 */
  path: string
  /** 呈现文本（目录 = 相对基础目录的路径；文件 = 文件名或整条路径）。 */
  title: string
  /** 子树里的命中总数（组行计数读它，`UsageViewTreeCellRenderer.java:95-98`）。 */
  count: number
  /** 直接挂在本节点上的命中（只有文件节点非空）。 */
  matches: FindResultLike[]
  children: FindTreeNode[]
}

/**
 * 按目录 / 文件把命中建成分组树。
 *   · **同一个文件的多处命中只生成一个文件节点**（找得到就复用，与 `src/usageViewGrouping.ts` 同一规矩）；
 *   · 目录层按 `findDirectoryGroupChain` 逐级建（`package` 档一层、`structure` 档逐级），
 *     目录层关着时命中直接落在文件层（上游 `ActiveRules.java:44-66` 那两档都不装时就是这个形态）；
 *   · 每层孩子的先后由 `compareFindTreeSiblings` 定（目录在前、同类按标题），文件里的命中按 `compareFindMatches`；
 *   · 每个节点的 `count` 是**整棵子树**的合计（上游组行渲染的就是 `getRecursiveUsageCount()`，
 *     `UsageViewTreeCellRenderer.java:95`）。
 */
export function buildFindResultsTree(
  results: readonly FindResultLike[],
  options: FindGroupingOptions = defaultFindGroupingOptions(),
): FindTreeNode {
  const root: FindTreeNode = {
    kind: 'directory', key: '', path: '', title: '',
    count: 0, matches: [], children: [],
  }
  const directoryCache = new Map<string, FindTreeNode>()
  // 链里的每一项都是**完整的工作区相对目录路径**（package 档一项、structure 档由外到内若干项），
  // 所以按整条路径建节点、按整条路径找已有节点，不能再逐段拼（那样 structure 档会拼成 src/src/sub）。
  const ensureDirectory = (chain: readonly string[]): FindTreeNode => {
    let node = root
    for (const dirPath of chain) {
      let child = directoryCache.get(dirPath)
      if (!child) {
        child = {
          kind: 'directory', key: findDirectoryGroupKey(dirPath), path: `${dirPath}/`,
          title: findDirectoryGroupTitle(dirPath, options), count: 0, matches: [], children: [],
        }
        directoryCache.set(dirPath, child)
        node.children.push(child)
      }
      node = child
    }
    return node
  }
  for (const result of results) {
    if (!result || typeof result.path !== 'string' || !result.path) continue
    const normalized = normalizePath(result.path)
    const parent = ensureDirectory(findDirectoryGroupChain(findResultDirectory(normalized), options))
    let file = parent.children.find(child => child.kind === 'file' && child.path === normalized)
    if (!file) {
      file = {
        kind: 'file', key: findFileGroupKey(normalized), path: normalized,
        title: findFileGroupTitle(normalized, options), count: 0, matches: [], children: [],
      }
      parent.children.push(file)
    }
    file.matches.push({ path: normalized, line: result.line, column: result.column })
  }
  const total = (node: FindTreeNode): number => {
    node.children.sort(compareFindTreeSiblings)
    node.matches.sort(compareFindMatches)
    let sum = node.matches.length
    for (const child of node.children) sum += total(child)
    node.count = sum
    return sum
  }
  total(root)
  return root
}

// ---------------------------------------------------------------- 摊平成面板行

/** 面板上的一行：目录/文件组行，或一条命中（叶子）。 */
export interface FindResultRow {
  key: string
  kind: 'directory' | 'file' | 'result'
  /** 缩进层（根不可见，`UsageViewTreeCellRenderer.java:88-89`）。 */
  depth: number
  /** 主文本：目录 = 相对路径、文件 = 文件名/整条路径、命中 = `行:列`。 */
  label: string
  /** 次要文本：组行 = 计数（`usage.view.counter`），命中 = 空。 */
  detail: string
  path: string
  count: number
  /** 命中的 1 基位置；组行为 -1。 */
  line: number
  column: number
  /** 组行才有折叠按钮（模板 `v-if` 掉，不画点不动的假按钮）。 */
  collapsible: boolean
  collapsed: boolean
}

/**
 * 深度优先摊平：目录层在前、文件层在后、命中在最后（层序 = 档号 400 → 500，`UsageGroupingRulesDefaultRanks.java:27`/`:31`）。
 * 折叠掉的组**自己出现**、子树不出现（上游收的是子树，`TreeUtil.collapseAll` 那一支）。
 */
export function flattenFindResultsTree(
  root: FindTreeNode,
  collapsed: ReadonlySet<string> = new Set<string>(),
): FindResultRow[] {
  const rows: FindResultRow[] = []
  const emit = (node: FindTreeNode, depth: number): void => {
    const isCollapsed = collapsed.has(node.key)
    rows.push({
      key: node.key, kind: node.kind, depth, label: node.title,
      detail: usageCounterText(node.count), path: node.path, count: node.count,
      line: -1, column: -1,
      collapsible: node.children.length > 0 || node.matches.length > 0, collapsed: isCollapsed,
    })
    if (isCollapsed) return
    for (const child of node.children) emit(child, depth + 1)
    for (const match of node.matches) {
      rows.push({
        key: `result\u0000${match.path}\u0000${findResultPositionText(match)}`, kind: 'result', depth: depth + 1,
        label: findResultPositionText(match), detail: '', path: match.path, count: 0,
        line: match.line, column: match.column, collapsible: false, collapsed: false,
      })
    }
  }
  for (const child of root.children) emit(child, 0)
  return rows
}

/** 树里全部组行的键（「全部折叠」要收的就是这一批）。 */
export function allFindGroupKeys(root: FindTreeNode): string[] {
  const keys: string[] = []
  const walk = (node: FindTreeNode): void => {
    for (const child of node.children) {
      keys.push(child.key)
      walk(child)
    }
  }
  walk(root)
  return keys
}

// ---------------------------------------------------------------- Find 窗口头部工具条

/**
 * 头部动作（工具条上一格，或弹出组里的一行）。
 * `enabled` = **上游判据**算出来的可用性（照各动作的 `update`）；`available` = 本仓有没有真实落点
 * （false ⇒ 不渲染；画一个点了没反应的按钮就是假控件）。
 */
export interface FindHeaderAction {
  /** 上游动作 id 或（内联构造的那些）类名。 */
  id: string
  title: string
  /** lucide 图标名（宿主的图标阶梯负责取尺寸；空串 = 上游这一格本来就没图标）。 */
  icon: string
  kind: 'action' | 'toggle' | 'group' | 'separator'
  /** 上游 `Presentation.isEnabled()`。 */
  enabled: boolean
  /** 切换类动作的当前态（`RuleAction.isSelected` / `ToggleAction.isSelected`）。 */
  selected: boolean
  /** 本仓有无真实落点。 */
  available: boolean
  unavailableReason: string
  children?: FindHeaderAction[]
}

/** 算 `UsageViewImpl.createActions()`（`:1074-1119`）那一列所需的会话状态。 */
export interface FindWindowHeaderContext {
  /** `canPerformReRun()`（`:2026-2036`）：targets 有效且 searcher 还在。 */
  canRerun: boolean
  /** `OccurenceNavigatorActionBase.update`（`:109-111`）的 `hasOccurenceToGo`。 */
  hasPreviousOccurrence: boolean
  hasNextOccurrence: boolean
  /** `canShowSettings()`（`:1121-1127`）：targets[0] 是 `ConfigurableUsageTarget`。 */
  configurableTarget: boolean
  /** `RuleAction.getUsageViewSettingsOrNull(e) != null`（`RuleAction.java:47-50`/`:72-82`）。 */
  settingsAvailable: boolean
  /** `UsageViewPresentation.isUsageTypeFilteringAvailable()`（`:196-198`）；Find 置 true（`FindInProjectUtil.java:441`）。 */
  usageTypeFilteringAvailable: boolean
  /** `isMergeDupLinesAvailable()`，默认 true（`UsageViewPresentation.java:42`）。 */
  mergeDupLinesAvailable: boolean
  /** `isPreviewUsageActionEnabled()`，默认 true（`UsageViewImpl.java:1028-1030`）。 */
  previewActionEnabled: boolean
  /** `isPreviewUsages()`（`UsageViewSettings.kt:75-76`，默认 true）。 */
  previewUsages: boolean
  /** `isGroupByModule()`（默认 true，`UsageViewSettings.kt:22`）—— Flatten Modules 还要它才可用。 */
  groupByModule: boolean
  /** 当前分组档（决定 Group By 那几格的 selected）。 */
  grouping: FindGroupingOptions
}

function separator(): FindHeaderAction {
  return { id: '', title: '', icon: '', kind: 'separator', enabled: true, selected: false, available: true, unavailableReason: '' }
}

/**
 * Find 窗口工具条的那一列，**照 `UsageViewImpl.createActions()`（`:1074-1119`）的返回数组顺序**：
 * Rerun、PrevOccurrence、NextOccurrence、分隔、ShowSettings（仅 `canShowSettings()`）、分隔、
 * Group By 弹出组、filteringSubgroup、ExpandAll、CollapseAll、分隔、PreviewUsageAction。
 */
export function findWindowHeaderActions(context: FindWindowHeaderContext): FindHeaderAction[] {
  const actions: FindHeaderAction[] = [
    {
      id: 'UsageView.Rerun',
      // `action.description.rerun` = "Rerun Search"（`UsageViewBundle.properties:28`），中文包 = 重新运行搜索。
      title: '重新运行搜索',
      icon: 'Refresh',
      kind: 'action',
      // `RerunSearchAction.update`（`RerunSearchAction.kt:42-45`）：usageView 是 UsageViewImpl 且能重跑。
      enabled: context.canRerun,
      selected: false,
      available: true,
      unavailableReason: '',
    },
    {
      id: 'OccurenceNavigator.PreviousOccurence',
      // `action.previous.occurrence` = "Previous Occurrence"（`UsageViewBundle.properties:31`），中文包 = 上一个匹配项。
      title: '上一个匹配项',
      icon: 'ChevronUp',
      kind: 'action',
      enabled: context.hasPreviousOccurrence,
      selected: false,
      available: true,
      unavailableReason: '',
    },
    {
      id: 'OccurenceNavigator.NextOccurence',
      // `action.next.occurrence` = "Next Occurrence"（`:30`），中文包 = 下一个匹配项。
      title: '下一个匹配项',
      icon: 'ChevronDown',
      kind: 'action',
      enabled: context.hasNextOccurrence,
      selected: false,
      available: true,
      unavailableReason: '',
    },
    separator(),
    {
      id: 'UsageGroupingActionGroup',
      // `action.group.by.title` = "Group By"（`UsageViewBundle.properties:19`），中文包 = 分组依据。
      title: '分组依据',
      icon: 'ListFilter',
      kind: 'group',
      // `RuleAction.update`（`RuleAction.java:47-50`）：拿得到 UsageViewSettings 才可用。
      enabled: context.settingsAvailable,
      selected: false,
      available: true,
      unavailableReason: '',
      children: findGroupingActions(context.grouping).map(action => ({
        // 分组动作表（`FindGroupingAction`）折成工具条项：图标统一走 `ListFilter` 那一档
        // （上游各档各有一个 `AllIcons` 图标，本仓不逐个找对应字形，避免用字形字符冒充图标）。
        id: action.id, title: action.title, icon: 'ListFilter', kind: 'toggle' as const,
        enabled: action.available, selected: action.selected,
        available: action.available, unavailableReason: action.unavailableReason,
      })),
    },
    {
      id: 'UsageView.MergeSameLineUsages',
      // `action.merge.same.line`（`:27`）= "Merge Usages from the Same Line"，中文包 = 合并同一行的用法。
      // 位置：`UsageViewImpl.java:1101` 的 `addFilteringActions(group, false)` 把它加进的是**上面那个
      // Group By 弹出组**（`group` 变量就是它，`:1089`），不是单独一段。
      title: '合并同一行的用法',
      icon: 'Merge',
      kind: 'toggle',
      enabled: context.settingsAvailable,
      selected: false,
      available: false,
      unavailableReason: '本仓结果是「同一行多处命中」各自成行，没有合并成一行的模型',
    },
    {
      id: 'ExpandAll',
      // `action.ExpandAll.text`（`ActionsBundle.properties` 的 `ExpandAll`），中文包 = 全部展开。
      title: '全部展开',
      icon: 'ChevronsUpDown',
      kind: 'action',
      // `CommonActionsManager.createExpandAllAction`（`CommonActionsManager.java:22`）走 TreeExpander；
      // 上游那两条的可用性由 `TreeExpander.canExpand()`（`UsageViewImpl.java:350-352`，恒 true）给。
      enabled: true,
      selected: false,
      available: true,
      unavailableReason: '',
    },
    {
      id: 'CollapseAll',
      // `action.CollapseAll.text`，中文包 = 全部收起。
      title: '全部收起',
      icon: 'ChevronsDownUp',
      kind: 'action',
      enabled: true,
      selected: false,
      available: true,
      unavailableReason: '',
    },
    separator(),
    {
      id: 'UsageView.PreviewUsages',
      // `preview.usages.action.text` = "Preview Source"（`:71`），中文包 = 预览源。
      title: '预览源',
      icon: 'Eye',
      kind: 'toggle',
      enabled: context.settingsAvailable,
      selected: context.previewUsages,
      available: false,
      unavailableReason: '本仓结果面板的预览区是常驻的，没有「显示/隐藏预览」这一档开关',
    },
  ]
  // `canShowSettings()`（`:1121-1127`）为真时，`ShowSettings` 与它后面那个分隔符插在
  // Prev/Next 之后（`UsageViewImpl.java:1109-1111` 的 `new Separator()` + `canShowSettings() ? new ShowSettings() : null`
  // + `canShowSettings() ? new Separator() : null`）；为假时那两格整个不出现。
  if (context.configurableTarget) {
    actions.splice(4, 0, {
      id: 'UsageView.ShowSettings',
      // `action.text.usage.view.settings` = "Settings…"（`:98`），中文包 = 设置…。
      title: '设置…',
      icon: 'Settings',
      kind: 'action',
      // `ShowSettings.update`（`UsageViewImpl.java:1395-1396`）：没有编辑器时可用。
      enabled: true,
      selected: false,
      available: false,
      unavailableReason: '上游打开的是 ConfigurableUsageTarget 的设置对话框（Find 用法配置），本仓没有那一档对话框',
    }, separator())
  }
  return actions
}

// ---------------------------------------------------------------- 编辑器 Find 条的头部动作

/**
 * 编辑器内查找条的那一列（`editorHeaderActions` 包的真实项集合）。
 * 组装点：`platform/lang-impl/src/com/intellij/find/EditorSearchSession.java:137-157`
 * （`SearchReplaceComponent.buildFor(...)` 的六个 add 方法），
 * 主搜索动作表 = `:238-265` 的 `createPrimarySearchActions()`。
 * 可用性判据逐条见下面每个 `enabled`。
 */
export interface EditorFindHeaderContext {
  /** `SearchSession` 在不在（`EditorHeaderToggleAction.update`，`:52-57`）。 */
  session: boolean
  /** `SearchSession.isSearchInProgress()` 的取反 + `hasMatches()`（`PrevNextOccurrenceAction.update`，`:34-37`）。 */
  hasMatches: boolean
  searchInProgress: boolean
  /** 编辑器内查找的 `FindModel` 四个开关。 */
  caseSensitive: boolean
  wholeWords: boolean
  regex: boolean
  preserveCase: boolean
  /** 替换态（`FindModel.isReplaceState()`）与是否全局（`isGlobal()`）。 */
  replaceState: boolean
  global: boolean
  /** 当前搜索上下文是不是 ANY（`ShowFilterPopupGroup.enableLiveIndicator`，`:54-61`）。 */
  contextAny: boolean
  /** `FindSettings.isScrollToResultsDuringTyping()`（`ToggleScrollToResultsDuringTypingAction.kt:13-15`）。 */
  scrollToResultsDuringTyping: boolean
}

function toggle(
  id: string, title: string, icon: string, selected: boolean, enabled: boolean,
): FindHeaderAction {
  return { id, title, icon, kind: 'toggle', enabled, selected, available: true, unavailableReason: '' }
}

/** 一条**没有真实落点**的项（`available: false` + 理由）—— 本仓不渲染它，登记在这里。 */
function blocked(id: string, title: string, icon: string, enabled: boolean, reason: string): FindHeaderAction {
  return { id, title, icon, kind: 'action', enabled, selected: false, available: false, unavailableReason: reason }
}

/** 有落点的普通动作项。 */
function entry(id: string, title: string, icon: string, enabled: boolean): FindHeaderAction {
  return { id, title, icon, kind: 'action', enabled, selected: false, available: true, unavailableReason: '' }
}

/** 搜索上下文的六格（`intellij.platform.lang.impl.actions.xml:402-407` 的注册序；文本键见 `FindBundle.properties`）。 */
const SEARCH_CONTEXT_ROWS: readonly { id: string; title: string }[] = [
  // `search.context.title.anywhere`（FindBundle.properties:170）= 任何地方。
  { id: 'SearchContext.Anywhere', title: '任何地方' },
  // `search.context.title.in.comments`（:172）= 在注释中。
  { id: 'SearchContext.InComments', title: '在注释中' },
  // `search.context.title.in.string.literals`（:171）= 在字符串字面量中。
  { id: 'SearchContext.InStringLiterals', title: '在字符串字面量中' },
  // `search.context.title.except.comments`（:174）= 排除注释。
  { id: 'SearchContext.ExceptComments', title: '排除注释' },
  // `search.context.title.except.string.literals`（:173）= 排除字符串字面量。
  { id: 'SearchContext.ExceptStringLiterals', title: '排除字符串字面量' },
  // `search.context.title.except.comments.string.literals`（:175）= 排除注释和字符串字面量。
  { id: 'SearchContext.ExceptCommentsAndStringLiterals', title: '排除注释和字符串字面量' },
]

/**
 * `EditorSearchSession.createPrimarySearchActions()`（`:238-265`）的**经典 UI** 那一支
 * （`ExperimentalUI.isNewUI()` 为假时，`:251-263`）：StatusText、Prev、Next、FindAll、分隔、
 * AddOccurrence、RemoveOccurrence、SelectAll、分隔、ToggleFindInSelection、filterGroup。
 * 后面再接 `:140-142` 的三个 `addExtraSearchActions`（大小写 / 全词 / 正则）。
 * 层内顺序照源码，**不重排**。
 */
export function editorFindHeaderActions(context: EditorFindHeaderContext): FindHeaderAction[] {
  const navigating = context.session && !context.searchInProgress && context.hasMatches
  // 多光标那一族（`OccurrenceAction.update`，`OccurrenceAction.java:26-37`）：
  // 可见 = 非替换态或 availableForReplace；可用 = visible && hasMatches && (availableForSelection || isGlobal)。
  const multicaret = '多光标选择模型（EditorSearchSession.addNextOccurrence 那一族）本仓编辑器未接'
  const actions: FindHeaderAction[] = [
    entry('StatusTextAction', '结果状态', '', context.session),
    entry('EditorSearchSession.PrevOccurrence', '上一个匹配项', 'ChevronUp', navigating),
    entry('EditorSearchSession.NextOccurrenceAction', '下一个匹配项', 'ChevronDown', navigating),
    // `FindAllAction.update`（`FindAllAction.java:40-49`）：要 `EditorContextManager.getPsiFileForEditor` 的 PsiFile。
    blocked('FindAllAction', '在查找窗口中打开', 'PanelTopOpen', navigating,
      '上游这一条要 PSI 文件（EditorContextManager.getPsiFileForEditor），本仓编辑器没有 PSI'),
    separator(),
    blocked('AddOccurrenceAction', '添加下一个匹配项', 'Plus', navigating && context.global, multicaret),
    blocked('RemoveOccurrenceAction', '移除上一个匹配项', 'Minus', navigating && context.global, multicaret),
    // `SelectAllAction.availableForReplace/availableForSelection` 都返回 true（`:28-36`）。
    blocked('SelectAllAction', '选择所有匹配项', 'CheckCheck', navigating, multicaret),
    separator(),
    {
      id: 'ToggleFindInSelection',
      // `find.selection.only` = "Search In Selection"（`FindBundle.properties:131`），中文包 = 在所选内容中搜索。
      title: '在所选内容中搜索',
      icon: 'TextSelect',
      kind: 'toggle',
      // `ToggleFindInSelectionAction.isSelected`（`:35-39`）：非全局即选中；`update`（`:46-50`）没有 SearchSession 就禁用。
      selected: context.session && !context.global,
      enabled: context.session,
      available: true,
      unavailableReason: '',
    },
    {
      id: 'ShowFilterPopup',
      // `find.popup.show.filter.popup` = "Filter Search Results"（`FindBundle.properties:139`），中文包 = 筛选搜索结果。
      title: '筛选搜索结果',
      icon: 'ListFilter',
      kind: 'group',
      // `ShowFilterPopupGroup.update`（`:45-52`）：没有 SearchSession 就禁用。
      enabled: context.session,
      // 有非 ANY 的上下文或任一开关被选中时带 live 角标（`:54-61`）。
      selected: !context.contextAny,
      available: true,
      unavailableReason: '',
      children: SEARCH_CONTEXT_ROWS.map(row => row.id === 'SearchContext.Anywhere'
        // 只有 ANY 这一档有落点：`ToggleAnywhereAction` 是 `EditorHeaderSetSearchContextAction`，
        // 置 ANY 是本仓唯一的上下文档；其余五档要注释/字面量语法（原生扫描是纯文本）。
        ? toggle(row.id, row.title, '', context.contextAny, context.session)
        : blocked(row.id, row.title, '', context.session, '本仓搜索范围没有「注释/字符串字面量」这一档（原生扫描是纯文本）')),
    },
    // `:140-142` 的三个 addExtraSearchActions（照源码顺序：大小写、全词、正则）。
    toggle('EditorSearchSession.ToggleMatchCase', '区分大小写', 'CaseSensitive', context.caseSensitive, context.session),
    toggle('EditorSearchSession.ToggleWholeWordsOnlyAction', '单词', 'WholeWord', context.wholeWords, context.session),
    toggle('EditorSearchSession.ToggleRegex', '正则表达式', 'Regex', context.regex, context.session),
  ]
  if (context.replaceState) {
    // `:148` 的 addExtraReplaceAction（替换态才出现）：保留大小写（`TogglePreserveCaseAction.java:20-23`）。
    actions.push(toggle('TogglePreserveCase', '保留大小写', 'CaseSensitive', context.preserveCase, context.session))
  }
  return actions
}

// ---------------------------------------------------------------- 结果右键菜单

/**
 * 结果树右键菜单的项集合（`platform/usageView-impl/resources/intellij.platform.usageView.impl.actions.xml:48-61`
 * 的 `UsageView.Popup` 组，`UsageViewImpl.java:957` 的 `PopupHandler.installPopupMenu` 装到树上）。
 * 顺序照 xml：Rerun、分隔、EditSource、OpenInRightSplit、TreeNodeExclusion（Include/Exclude）、
 * UsageView.Remove、分隔、ShowRecentFindUsages、分隔、RunContextGroup、分隔、ExportToTextFile。
 */
export function findResultsContextMenu(hasExport: boolean): FindHeaderAction[] {
  const row = (id: string, title: string, icon: string, available: boolean, reason = ''): FindHeaderAction =>
    ({ id, title, icon, kind: 'action', enabled: available, selected: false, available, unavailableReason: reason })
  return [
    row('UsageView.Rerun', '重新运行搜索', 'Refresh', true),
    separator(),
    row('EditSource', '跳转到源', 'FileCode2', true),
    row('OpenInRightSplit', '在右侧拆分中打开', 'Columns2', true),
    row('UsageView.Include', '包括', 'Plus', false, '本仓结果树没有「排除节点」的节点级状态（上游 ExcludeTreeNodeAction）'),
    row('UsageView.Exclude', '排除', 'Minus', false, '同上：没有节点级排除状态'),
    row('UsageView.Remove', '移除', 'Trash2', false, '结果行由原生扫描整批给出，没有逐行移除的模型'),
    separator(),
    row('UsageView.ShowRecentFindUsages', '最近的查找用法', 'History', false, '本仓没有 Find Usages 历史（findInProjectRecents 存的是查找词，不是用法目标）'),
    separator(),
    row('ExportToTextFile', '导出到文本文件', 'Download', hasExport),
  ]
}