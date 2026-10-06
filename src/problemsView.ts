// 问题视图的过滤、排序与分组（IDEA `ProblemsView` 的工具栏与树比较器）。
//
// 上游：`ProblemsView` 继承 `ProblemsViewPanel`，树用 `ProblemsTreeModel` + `ProblemsViewNodeComparator`
//   排序；工具栏动作在 `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:81-107`：
//     「Options」弹层 = 严重度过滤（`SeverityFiltersActionGroup`）+ 三个排序开关 + 按检查器分组；
//     另有 QuickFixes / ShowPreview / ExpandAll / CollapseAll。
//   严重度过滤是**多选**（`ProblemsViewState.hideBySeverity` 存"被藏起来的严重度"集合，
//   `ProblemFilter.kt:20` 一行 `!state.hideBySeverity.contains(severity)`）—— 不是单选下拉。
//   排序开关就是 `ProblemsViewNodeComparator` 的三个构造参数
//   （`ProblemsViewPanel.java:524-529` `createComparator()`）。
// 本仓的问题面板（`src/components/ProblemsPanel.vue`）把这些做成纯函数 + 一行渲染，
// 派生数据仍来自 `src/problems.ts`（LSP 诊断），所以过滤/排序/分组规则能单测。
import type { ProblemRow } from './problems.ts'
// 高亮级别模型（`HighlightDisplayLevel` 的计数面）：哪些级别进"错误/警告"两格由级别对象定，
// 不在计数处再写一遍 `severity === 1`（见 src/highlightLevels.ts）。
// 「按严重级分组」那一档的**组键、组名与组序**也取自同一份级别表：级别对象只在这儿有一份，
// 面板/计数/分派都从这里折，不再各写一遍严重度到名字的三元表达式。
import { HIGHLIGHT_LEVELS, levelById, levelForSeverity, type HighlightLevelId } from './highlightLevels.ts'
// 检查项身份（(source, code, tags) → 上游的 HighlightDisplayKey 那一格），见 src/inspectionIdentity.ts。
import { NO_CHECKER_LABEL, identityOfRow } from './inspectionIdentity.ts'

/**
 * 分组方式。`source` 是「按检查器分组」（上游 `ProblemsView.GroupByToolId` 的分组维度）；
 * `code` 是**按诊断码**分组 —— 上游把「按检查器分组」记成一个开关
 * （`ProblemsViewState.kt:28` `var groupByToolId: Boolean by property(false)`，默认关），
 * 而分组**键**取自检查项身份（tool id）。本仓把检查项身份拆成两列（`ProblemRow.source` 是检查器名、
 * `ProblemRow.code` 是诊断码，见 `src/problems.ts` 的注释），所以两列各给一档。
 * `inspection` 是这两列折出来的**检查项本身**：键 = 身份键（与 `src/inspectionProfile.ts` 的门控同一把），
 * 标题 = 检查项显示名，逐条对应上游
 * `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/HighlightingProblem.kt:85-89`
 * （`problemGroup.problemName ?: inspectionToolId` → `HighlightDisplayKey` 的显示名）与
 * `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewGroupNode.kt:11-19`
 * （组节点的名字就是这个 group 字符串）。
 */
export type ProblemGrouping = 'none' | 'file' | 'directory' | 'source' | 'code' | 'inspection' | 'severity'

// `severity` 是本轮补的一档 = 上游 Inspect Code Results 的「Group by Severity」开关
// （`platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:37` `GROUP_BY_SEVERITY = false` 默认关、
//   `:70-93` `createGroupBySeverityAction`，文案 `inspection.action.group.by.severity=Group by Severity`
//   在 `platform/analysis-api/resources/messages/InspectionsBundle.properties:98-100`；
//   动作挂在工具栏 `platform/lang-impl/src/com/intellij/codeInspection/ui/InspectionResultsView.java:320,336`）。
// 树那一侧的形状：根节点的直接子节点就是**一个严重级一个组节点**
// （`platform/lang-impl/src/com/intellij/codeInspection/ui/InspectionTree.java:452-479`
//   `groupedBySeverity ? myModel.createSeverityGroupNode(severityRegistrar, errorLevel, root) : root`，
//   `createSeverityGroupNode` 在 `platform/lang-impl/src/com/intellij/codeInspection/ui/InspectionTreeModel.java:151-157`
//   —— 按 level 去重，同一个级别只建一个节点），组节点的标题取
//   `platform/lang-impl/src/com/intellij/codeInspection/ui/InspectionSeverityGroupNode.java:37-39`
//   （`myLevel.getSeverity().getDisplayCapitalizedName()` = 那一级的**首字母大写显示名**，
//    文案在 `platform/analysis-api/resources/messages/InspectionsBundle.properties:22,38,46,50`）；
//   组与组之间的次序在 `platform/lang-impl/src/com/intellij/codeInspection/ui/InspectionResultsViewComparator.java:34-38`
//   （两个都是级别组时 `-registrar.compare(severity1, severity2)` = **严重度降序**，级别组又排在其它节点之前）。
// 本仓的落点：组键 = `src/highlightLevels.ts` 的级别 id，组名 = 该级的显示名，组序 = 级别 rank 升序
// （rank 就是严重度降序，见那一份表的注释），与上面三条逐一对应。
//
// `sortFoldersFirst` 那一档**没有**承接（上游 `ProblemsViewState.kt:29` 默认 true +
// `ProblemsViewNodeComparator.kt:21-24`）：那条规则只作用在**同层的两个 `FileNode`** 之间
// （目录节点排在文件节点之前），本仓的树只有一层组头，同层没有"目录 vs 文件"的兄弟可言 ⇒
// 它落在 `groupProblems` 的 `directory` 档（见下面 `orderDirectoryGroups`），不在分组档位里。

/** 面板下拉里能选到的档（`src/problemsPanelState.ts` 的读档白名单与它一一对应）。 */
export const PROBLEM_GROUPINGS: readonly ProblemGrouping[] =
  ['none', 'file', 'directory', 'source', 'code', 'inspection', 'severity']

/** LSP 严重度的四档（1 错误 / 2 警告 / 3 提示 / 4 信息），过滤器与清单按它枚举。 */
export const PROBLEM_SEVERITIES: readonly number[] = [1, 2, 3, 4]

/**
 * 严重度过滤：**被隐藏**的严重度集合（上游 `ProblemsViewState.hideBySeverity` 的形状）。
 * 空集 = 全部显示；勾选某档 = 把它加进 `hidden`（上游 `SeverityFilterAction.setSelected`
 * 走 `addSeverity`，`ProblemFilter.kt:80-83`）。
 */
export interface ProblemFilter {
  hidden: readonly number[]
  query: string
}

export const DEFAULT_PROBLEM_FILTER: ProblemFilter = { hidden: [], query: '' }

/** 单选下拉 → 隐藏集合（面板从旧的单选存档迁移时用；`null` = 全显示 = 空集）。 */
export function hiddenSeveritiesFor(single: number | null | undefined): number[] {
  if (single === null || single === undefined || !PROBLEM_SEVERITIES.includes(single)) return []
  return PROBLEM_SEVERITIES.filter(severity => severity !== single)
}

/**
 * 严重度过滤 + 文本过滤（消息 / 路径 / 来源 / 诊断码 / 检查项显示名任一命中）。空查询不过滤。
 *
 * 上游的过滤器只按严重度（`ProblemFilter.kt:18-20`，`!(state.hideBySeverity.contains(highlighting.severity))`），
 * 文本框是本仓多出来的；既然多出来了，就得能搜到面板上看得见的那一列 —— 检查项名与诊断码。
 */
export function filterProblems(rows: readonly ProblemRow[], filter: ProblemFilter): ProblemRow[] {
  const query = filter.query.trim().toLowerCase()
  const hidden = filter.hidden
  return rows.filter(row =>
    (!hidden.includes(row.severity)) &&
    (!query || row.message.toLowerCase().includes(query) ||
      row.path.toLowerCase().includes(query) || row.source.toLowerCase().includes(query) ||
      (row.code ?? '').toLowerCase().includes(query) ||
      identityOfRow(row).displayName.toLowerCase().includes(query)))
}

// —— 自然序（`StringUtil.naturalCompare` → `NaturalComparator.INSTANCE.compare`，`ignoreCase=true`、
//    `likeFileNames=false`：`platform/util/base/.../NaturalComparator.java:20-27`）——
//    上游的问题树按名排序走的就是它（`ProblemsViewNodeComparator.kt:4,25`），本仓的排序照抄。
//    逐条对应 `NaturalComparator.java:45-105`。

/** `Strings.isDecimalDigit`（`Strings.java:28-30`）= ASCII 0-9。 */
function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}

/** `Strings.compare(char,char,ignoreCase=true)`（`Strings.java:46-66`）：先比差，差为 0 才走大小写折叠。 */
function compareChars(a: number, b: number): number {
  const diff = a - b
  if (diff === 0) return 0
  const upperA = fold(a, true)
  const upperB = fold(b, true)
  const upperDiff = upperA - upperB
  if (upperDiff !== 0) return fold(upperA, false) - fold(upperB, false)
  return upperDiff
}

/** `StringUtilRt.toUpperCase/toLowerCase(char)`：单字符折叠；有多字符展开（ß→SS）时退回原码位。 */
function fold(code: number, upper: boolean): number {
  const text = String.fromCharCode(code)
  const folded = upper ? text.toUpperCase() : text.toLowerCase()
  return folded.length === 1 ? folded.charCodeAt(0) : code
}

/**
 * 自然序比较（`NaturalComparator.naturalCompare(s1, s2, len1, len2, true, false)`）。
 * 数字段（含前置空格与前导零）按位数比：位数多的更大（`:57-59`）。
 */
export function naturalCompare(a: string, b: string): number {
  if (a === b) return 0
  const length1 = a.length
  const length2 = b.length
  let i = 0
  let j = 0
  while (i < length1 && j < length2) {
    const code1 = a.charCodeAt(i)
    const code2 = b.charCodeAt(j)
    const digit1 = isDigit(code1) || code1 === 0x20
    const digit2 = isDigit(code2) || code2 === 0x20
    if (digit1 && digit2) {
      let start1 = i
      while (start1 < length1 && a.charCodeAt(start1) === 0x20) start1++
      while (start1 < length1 && a.charCodeAt(start1) === 0x30) start1++
      let start2 = j
      while (start2 < length2 && b.charCodeAt(start2) === 0x20) start2++
      while (start2 < length2 && b.charCodeAt(start2) === 0x30) start2++
      let end1 = start1
      while (end1 < length1 && isDigit(a.charCodeAt(end1))) end1++
      let end2 = start2
      while (end2 < length2 && isDigit(b.charCodeAt(end2))) end2++
      const lengthDiff = (end1 - start1) - (end2 - start2)
      if (lengthDiff !== 0) return lengthDiff
      for (let k = 0; k < end1 - start1; k++) {
        const diff = a.charCodeAt(start1 + k) - b.charCodeAt(start2 + k)
        if (diff !== 0) return diff
      }
      const fullLengthDiff = (end1 - i) - (end2 - j)
      if (fullLengthDiff !== 0) return fullLengthDiff
      for (let k = 0; k < start1 - i; k++) {
        const diff = a.charCodeAt(i + k) - b.charCodeAt(j + k)
        if (diff !== 0) return diff
      }
      i = end1 - 1
      j = end2 - 1
    } else {
      // `NaturalComparator.compareChars`（`:116-121`）：空格排在 '#' 这类字符之前。
      if (code1 === 0x20 && code2 > 0x20 && code2 < 0x30) return +1
      if (code2 === 0x20 && code1 > 0x20 && code1 < 0x30) return -1
      const diff = compareChars(code1, code2)
      if (diff !== 0) return diff
    }
    i++
    j++
  }
  if (i < length1) return +1
  if (j < length2) return -1
  if (length1 !== length2) return length1 - length2
  return 0
}

/**
 * 排序开关（上游 `ProblemsViewState.sortBySeverity`/`sortByName`，默认见 `ProblemsViewState.kt:30-31`；
 * `sortFoldersFirst` 在同一份状态的 `:29`，上游默认 **true** ——
 * `var sortFoldersFirst: Boolean by property(true)`，本仓照抄默认值）。
 * 上游工具栏把这三个开关一起递给比较器
 * （`ProblemsViewPanel.java:523-529` `new ProblemsViewNodeComparator(isNullableOrSelected(getSortFoldersFirst()), isNullableOrSelected(getSortBySeverity()), isNotNullAndSelected(getSortByName()))`），
 * 本仓同一份三格也在 `sortProblems`/`groupProblems` 两个入口之间共用。
 */
export interface ProblemSort {
  sortFoldersFirst: boolean
  sortBySeverity: boolean
  sortByName: boolean
}

export const DEFAULT_PROBLEM_SORT: ProblemSort = { sortFoldersFirst: true, sortBySeverity: true, sortByName: false }

/**
 * 位置比较。上游是 `ProblemsViewNodeComparator.comparePosition`（`:43-46`，先行后列），
 * 而上游的问题节点都挂在自己的 `FileNode` 下 —— 同一个文件天然聚在一起。本仓的表是**一张扁平表**
 * （分组发生在排序之后），所以路径必须进比较键，否则「按文件」分组前不同文件的问题会交错。
 * 路径用自然序，与上游 `naturalCompare(node1.name, node2.name)`（`:25`）同一口径。
 */
function comparePosition(a: ProblemRow, b: ProblemRow): number {
  const byPath = naturalCompare(a.path, b.path)
  if (byPath !== 0) return byPath
  return a.line - b.line || a.character - b.character
}

/**
 * 问题行的排序（`ProblemsViewNodeComparator.compareI`，`:28-41`）：
 *   · `sortBySeverity` → 严重度**降序**（`node2.getSeverity().compareTo(node1.getSeverity())`）；
 *   · `sortByName` → 先按消息自然序，再按位置；否则先按位置，再按消息自然序。
 *
 * 「降序」怎么落到 LSP 的数字上：上游比的是 `HighlightSeverity` 的**比较值**
 * （`HighlightSeverity.java:124-125` ERROR 400 > WARNING 300 > WEAK_WARNING/INFO 200 > INFORMATION 10），
 * 而 LSP 把同一档报成 1 错误 / 2 警告 / 3 提示 / 4 信息 —— 数字小的更严重。
 * 所以「严重度降序」= LSP 数字**升序**，与 `src/problems.ts` 的初始排序一致。
 * 默认档（`sortBySeverity: true` / `sortByName: false`）的产出就是本仓一直用的
 * 「严重度 → 路径 → 行号」。返回新数组（`Array.prototype.sort` 稳定：全字段相同时保持传入顺序）。
 */
export function sortProblems(rows: readonly ProblemRow[], sort: ProblemSort): ProblemRow[] {
  return [...rows].sort((a, b) => {
    if (sort.sortBySeverity && a.severity !== b.severity) return a.severity - b.severity
    if (sort.sortByName) {
      const byName = naturalCompare(a.message, b.message)
      return byName !== 0 ? byName : comparePosition(a, b)
    }
    const byPosition = comparePosition(a, b)
    return byPosition !== 0 ? byPosition : naturalCompare(a.message, b.message)
  })
}

export interface ProblemGroup {
  /** 分组键（不分组时是空串）。 */
  key: string
  /** 分组标题（不分组时是空串，面板据此不画标题行）。 */
  label: string
  rows: ProblemRow[]
}

/** 目录键：`src/a/B.java` → `src/a`；根级文件归到 `.`（IDEA 的按目录分组也把根单列）。 */
function directoryOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'
}

/**
 * 严重级键（`severity` 档）：那一行的**高亮级别 id**。
 * 上游的组节点就是按 `HighlightDisplayLevel` 对象去重的
 * （`InspectionTreeModel.java:151-157` 的 `getOrAdd(level, …)` —— 同一个 level 只建一个节点），
 * 本仓用级别 id 当那把同样的键。
 * 每一条诊断都折得出级别（`levelForSeverity` 对未知严重度回落到最弱一级，不返回空），
 * 所以这一档**没有**「不进组」的那些行 —— 与 `code`/`inspection` 两档的形状不同，那是
 * `HighlightingProblem.kt:87` 的 `?: return null`，这里没有对应的 null 分支。
 */
export function severityKeyOf(row: ProblemRow): string {
  return levelForSeverity(row.severity).id
}

/**
 * 诊断码键：`ProblemRow.code`（`src/problems.ts` 把它从 `LspDiagnostic.code` 透传过来，
 * 本地检查则回落到检查器短名）。**没有码的行不进组** —— 上游在那一档就是把 `group == null`
 * 的问题直接挂在父节点下，不造一个组节点：
 * `ProblemsViewHighlightingChildrenBuilder.kt:53-62`
 * （`problems.groupBy { it.group }.flatMap { (group, problems) -> if (group != null) listOf(组节点)
 *   else problems.toProblemNodes(parent, virtualFile) }`），而 `group` 为 null 的条件就在
 * `HighlightingProblem.kt:87`（`info?.problemGroup?.problemName ?: info?.inspectionToolId ?: return null`）。
 * ⇒ 订正前任在这里造的「（无诊断码）」占位组：那是**编出来的组名**，上游没有这一格。
 * 注意 `code` 一列是**可选**的：只有真的带了 `code` 的服务端/本地检查才会分出多组，
 * 全空时这一档退化成「整表都不进组」（与上游同形状），不是空面板。
 */
export function codeOf(row: ProblemRow): string {
  return row.code?.trim() || ''
}

/** 来源键：LSP 诊断的 `source`（检查器名）；没有来源的行单列一组（「按来源」是本仓多出来的一档，
 *  没有上游的组节点语义可照，故保留显式占位组，不渲染成空白标题）。 */
export const NO_SOURCE_LABEL = NO_CHECKER_LABEL
export function sourceOf(row: ProblemRow): string {
  return row.source?.trim() || NO_SOURCE_LABEL
}

/**
 * 分组**键**：`groupProblems` 与「只看某一组」的过滤（`focusRows`）共用这一把键，
 * 否则面板上的组头与过滤条件会各算一份、互相对不上。
 * 键为空串 = 这一行在该档下**不进任何组**（上游 `group == null` 的那一支，
 * `ProblemsViewHighlightingChildrenBuilder.kt:56-61`）。
 */
export function groupKeyOf(row: ProblemRow, grouping: ProblemGrouping): string {
  return grouping === 'file' ? row.path
    : grouping === 'source' ? sourceOf(row)
    : grouping === 'code' ? codeOf(row)
    : grouping === 'inspection' ? inspectionKeyOf(row)
    : grouping === 'severity' ? severityKeyOf(row)
    : grouping === 'none' ? ''
    : directoryOf(row.path)
}

/**
 * 检查项键（`inspection` 档）：与 `src/inspectionProfile.ts` 的门控同一把键。
 * 上游的组键折不出身份时就是 null（`HighlightingProblem.kt:87` 的 `?: return null`），
 * 本仓用空串表示同一个意思 —— 这一行不进组。
 */
export function inspectionKeyOf(row: ProblemRow): string {
  return identityOfRow(row).key
}

/**
 * 承接上游 `groupByToolId` 的两档：键折自检查项身份（tool id 的等价物）。
 * 只有这两档照上游的两条同层行为（`file`/`directory`/`source`/`none` 是本仓自己的档，
 * 没有对应的组节点语义，保持首次出现顺序与占位组）：
 *  · 键为空的问题不进组，排在所有组之前（`ProblemsViewNodeComparator.kt:19-20`
 *    `if (node1 is ProblemNodeI) return -1 // problem node before other nodes`）；
 *  · 组与组之间按**组名**自然序（`:25` `naturalCompare(node1.name, node2.name)`，
 *    组名 = `ProblemsViewGroupNode.kt:19` 的 `getName()` = group 串）。
 */
const TOOL_ID_GROUPINGS: readonly ProblemGrouping[] = ['code', 'inspection']

/**
 * 分组的**标题**：`code`/`inspection` 两档用检查项显示名（上游 `HighlightingProblem.kt:88` 的
 * `HighlightDisplayKey.getDisplayNameByKey` 那一格），其余档的标题就是键本身。
 * 键保持原粒度（裸诊断码 / 裸来源），面板存档与既有判据都读键，不动。
 */
function groupLabel(grouping: ProblemGrouping, key: string, rows: readonly ProblemRow[]): string {
  const first = rows[0]
  if (!first) return key
  if (grouping === 'severity') return levelById(key as HighlightLevelId).label
  if (grouping === 'inspection') return identityOfRow(first).displayName || key
  if (grouping === 'code') return first.code ? identityOfRow(first).displayName || key : key
  return key
}

/**
 * 「目录排在文件之前」（上游第三个排序开关 `sortFoldersFirst`）在**本仓的一层组头**上怎么落地。
 *
 * 上游那条规则只比同层的两个 `FileNode`（`ProblemsViewNodeComparator.kt:21-24`：
 * 两个都是文件节点时，`file.isDirectory` 的那个在前；随后一律 `naturalCompare(name)`，见 `:25`）。
 * 本仓的树只有一层组，组键是「这一批问题所在的目录」，所以同层的兄弟关系要按**键的路径层级**还原：
 * 目录 D 的直接子项 = D 自己的那一组（键 = D，装的是直接放在 D 里的文件）+ 所有以 D 为前缀的更深层组
 * （子目录）。上游的展开顺序 = 先所有子目录（含它们的整棵子树），再 D 自己的文件组 —— 这就是本仓的
 * 「DFS + 每层子目录先」，逐字对应上面那条比较器；关掉开关时退回纯自然序（`:25` 那一把）。
 * 键 `.` 是本仓的根（`directoryOf` 给根级文件造的），等价于上游 root 那一层。
 */
export function orderDirectoryGroups(keys: readonly string[], foldersFirst: boolean): string[] {
  if (!foldersFirst) return [...keys].sort((a, b) => naturalCompare(a, b))
  const present = new Set(keys)
  /** 键的父目录键（`src/a` → `src`，`src` → `.`，`.` → 空串 = 虚拟根）。 */
  const parentOf = (key: string): string => {
    const cut = key.lastIndexOf('/')
    if (key === '.') return ''
    return cut < 0 ? '.' : key.slice(0, cut)
  }
  const nameOf = (key: string): string => (key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key)
  // 子目录关系只在**同一父级**内成立：父键 → 该父级下出现过的子目录键（保持自然序）。
  const childDirs = new Map<string, string[]>()
  for (const key of present) {
    let current = key
    // 将每个键沿路径上溯，把它登记到沿途每一层的子目录清单里
    // （`src/a/b` 要同时是 `src/a` 与 `src` 的后代，中间层没有自己的组时也不断开）。
    while (current !== '' && current !== '.') {
      const parent = parentOf(current)
      const list = childDirs.get(parent) ?? []
      if (!list.includes(current)) list.push(current)
      childDirs.set(parent, list)
      current = parent
    }
  }
  const ordered: string[] = []
  const walk = (dir: string) => {
    const children = (childDirs.get(dir) ?? []).sort((a, b) => naturalCompare(nameOf(a), nameOf(b)))
    // 上游同层的顺序 = 先所有**子目录**（整棵子树），再本层自己的文件组（比较器 :21-24 + 树的 DFS）。
    // 所以这里**不**在进子目录之前把子目录键端出来，子目录自己的那一组要等它的子树走完（下面那行）。
    for (const child of children) walk(child)
    if (dir !== '' && present.has(dir) && !ordered.includes(dir)) ordered.push(dir)
  }
  walk('.')
  // 理论上走不到：`present` 里每个键都在某一层被登记过。留着是为了**不静默丢组**
  // （丢一组 = 面板上少一批问题，那是看不见的错）。
  for (const key of keys) if (!ordered.includes(key)) ordered.push(key)
  return ordered
}

/**
 * 分组。组顺序 = 组内第一条问题在传入顺序里的出现顺序，组内顺序保持传入顺序
 * （面板把排序开关的结果先算好再传进来，所以「按文件分组」不会把错误排到警告后面）。
 * 承接 `groupByToolId` 的两档（`code`/`inspection`）例外：按上游把未分组的问题排在组前、
 * 组之间按组名自然序，见 `TOOL_ID_GROUPINGS` 的注释。
 * 另两条例外也照上游：
 *  · `severity` 档 —— 组之间按**严重度降序**（级别 rank 升序），不是首次出现顺序
 *    （`InspectionResultsViewComparator.java:34-38`）；
 *  · `directory` 档 —— 受第三个排序开关 `sortFoldersFirst` 管，见 `orderDirectoryGroups`。
 * 第三参可省：省的时侯用 `DEFAULT_PROBLEM_SORT.sortFoldersFirst`（上游默认 true）。
 */
export function groupProblems(
  rows: readonly ProblemRow[],
  grouping: ProblemGrouping,
  sort: Pick<ProblemSort, 'sortFoldersFirst'> = DEFAULT_PROBLEM_SORT,
): ProblemGroup[] {
  if (grouping === 'none') return [{ key: '', label: '', rows: [...rows] }]
  const byToolId = TOOL_ID_GROUPINGS.includes(grouping)
  const groups = new Map<string, ProblemRow[]>()
  const ungrouped: ProblemRow[] = []
  for (const row of rows) {
    const key = groupKeyOf(row, grouping)
    if (byToolId && key === '') { ungrouped.push(row); continue }
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  const result = [...groups.entries()].map(([key, list]) => ({ key, label: groupLabel(grouping, key, list), rows: list }))
  if (grouping === 'directory') {
    const order = orderDirectoryGroups(result.map(group => group.key), sort.sortFoldersFirst)
    const byKey = new Map(result.map(group => [group.key, group]))
    return order.map(key => byKey.get(key) ?? { key, label: key, rows: [] })
  }
  if (grouping === 'severity') {
    result.sort((a, b) => levelById(a.key as HighlightLevelId).rank - levelById(b.key as HighlightLevelId).rank)
    return result
  }
  if (!byToolId) return result
  result.sort((a, b) => naturalCompare(a.label, b.label))
  return ungrouped.length ? [{ key: '', label: '', rows: ungrouped }, ...result] : result
}

/**
 * 「只看某一组」的可见性过滤（面板组头上的按钮与工具栏的清除入口用它）。
 *
 * 上游没有「按组过滤」这个工具栏动作（`intellij.platform.problemView.ui.xml:81-107` 的 Options 里
 * 只有严重度 + 三个排序开关 + GroupByToolId），但它的可见性模型是一条**逐条问题的谓词**
 * （`ProblemFilter.kt:17-22` `(Problem) -> Boolean`，由 `ProblemsTreeModel` 在建树时套用），
 * 而"整族显隐"的开关上游给在两个地方：
 *  · 「Show Other Problems」把一批低严重度当成**一组**整体显隐（`ProblemFilter.kt:62-75`）；
 *  · 检查项在 profile 里停用 ⇒ 该 tool 的问题根本不进表（`InspectionProfileImpl.java:804`）。
 * 本仓把第一种形状从"严重度的一族"推广到"分组维度的某一组"：谓词仍是逐条的，
 * 不持久化（上游的选中态也不在 `ProblemsViewState` 里，见 `ProblemsViewState.kt:20-33` 全清单）。
 * `focus === null` = 没有焦点（全显示）；`grouping === 'none'` 时没有组可焦，原样返回（不做空动作）。
 */
export function focusRows(rows: readonly ProblemRow[], grouping: ProblemGrouping, focus: string | null): ProblemRow[] {
  if (focus === null || grouping === 'none') return [...rows]
  return rows.filter(row => groupKeyOf(row, grouping) === focus)
}

/** 组头「停用此检查项」可用的档：折不出检查项身份的档（file/directory/none）不给这个动作。 */
export const MUTABLE_GROUPINGS: readonly ProblemGrouping[] = ['inspection', 'source', 'code']

/**
 * 这一组的**停用键集合**（面板组头上的「停用此检查项」写进 profile 的键）：
 *  · `inspection` 档的组键本来就是身份键（`src/inspectionIdentity.ts` 的 `key`）；
 *  · `source` 档 = 整个检查器（占位组「（无来源）」折不出身份，返回空数组 = 不给按钮，
 *    否则往 profile 里写一个没人读的键就是假控件）；
 *  · `code` 档 = 组内**出现过的每一把身份键**。同一个诊断码可能来自两个语言服务
 *    （tsserver 与 eslint 都报 `6133`），按码分组会把它们并进一组；只停第一条的话
 *    另一条还留在表上。上游按 tool id 分组时一个组节点只对应一个 key
 *    （`ProblemsViewGroupNode.kt:11-19` 的 `group` 串就是那个身份），本仓的码档比它粗，
 *    所以逐条折出身份再停 —— 落点粒度仍是上游的单个 `HighlightDisplayKey`
 *    （`InspectionProfileImpl.java:804` `isToolEnabled(HighlightDisplayKey key, PsiElement)`）。
 */
export function groupMuteKeys(group: { key: string; rows: readonly ProblemRow[] }, grouping: ProblemGrouping): string[] {
  if (!group.key || !MUTABLE_GROUPINGS.includes(grouping)) return []
  if (grouping === 'source') return group.key === NO_SOURCE_LABEL ? [] : [group.key]
  if (grouping === 'inspection') return [group.key]
  const keys = new Set<string>()
  for (const row of group.rows) {
    const key = identityOfRow(row).key
    if (key) keys.add(key)
  }
  return [...keys]
}

// 严重度计数：级别归属只在 `src/highlightLevels.ts` 的 `levelForSeverity` 一处定义，
// 计数只在这函数里做一次。面板标题行已经在读它（`src/components/ProblemsPanel.vue` 的 `tableCounts`）；
// 状态栏那一格**还没接**（`src/App.vue` 仍就地 `filter(p => p.severity === 1)`）⇒ 接线请求见
// `docs/wiring-requests-2026-10-06-prob3.md` R1，钉桩见 `tests/problem-count-single-source.test.mjs`。
export function problemCounts(rows: readonly ProblemRow[]): { errors: number; warnings: number; infos: number } {
  const at = new Map(levelCountsOf(rows).map(item => [item.id, item.count]))
  const one = (id: HighlightLevelId) => at.get(id) ?? 0
  // 三格口径不变（`src/highlightLevels.ts` 的 WEAK_WARNING/INFO 两档一起进「信息」格），
  // 只是不再自己数一遍 —— 与逐级别计数同一份实现，两处不会漂。
  return { errors: one('ERROR'), warnings: one('WARNING'), infos: one('WEAK_WARNING') + one('INFO') }
}

// —— 逐严重级的计数（上游树节点尾巴上那一串「3 errors 1 warning」）——
//    上游依据（逐条）：
//      · 每个节点带一组「级别 + 条数」：`InspectionTreeNode.java:81-99`
//        （`getProblemLevels()` 缓存 + `visitProblemSeverities` 把子节点的 `LevelAndCount` 按级别
//         `mergeInt(..., Math::addExact)` 累加进 `Object2IntMap<HighlightDisplayLevel>`）；
//      · 尾巴文案：`InspectionTreeTailRenderer.java:34-67` ——
//        级别种数 **超过** `MAX_LEVEL_TYPES = 5`（`:23`）时只报一个合计
//        （`:56-59` 走 `inspection.problem.descriptor.count` =
//         `platform/analysis-api/resources/messages/InspectionsBundle.properties:83`
//         `{0, choice, 0#|1#(1 item)|2#({0,number,integer} items)}`：0 条 = 空串、1 条 = `(1 item)`、
//         其余 = `(N items)`）；否则**逐级**各报一条
//        （`:61-67` `levelAndCount.getLevel().getSeverity().getCountMessage(count)`）；
//      · `getCountMessage` 的模板在 `platform/analysis-api/src/com/intellij/lang/annotation/HighlightSeverity.java:176-180`，
//        四级文案逐字在 `platform/analysis-api/resources/messages/InspectionsBundle.properties:43,39,35,23`
//        （`{0} {0, choice, 0#warnings|1#warning|2#warnings}` 等 —— **数量为 1 时用单数**）；
//      · 颜色的那一档：`:63-65` —— ERROR 那一条只在**没有**按严重级分组时用红色（`TREE_RED`），
//        分组时级别已经写在组名上了，就统一灰色（`TREE_GRAY`）。

/** 一个级别在一组问题里的条数（上游 `LevelAndCount` 的等价物）。 */
export interface ProblemLevelCount {
  /**
   * 级别 id（本仓四档在 `src/highlightLevels.ts`：ERROR/WARNING/WEAK_WARNING/INFO）。
   * 类型开成 `string` 而不是那四档的字面联合，是为了让**逐级 → 合计**那条回落
   * （上游 `InspectionTreeTailRenderer.java:56-59` 的 `MAX_LEVEL_TYPES`）能被判据喂到：
   * 上游的级别表本身是可注册的（`SeverityRegistrar` 允许注册自定义严重度），
   * 把这里钉成四档就等于宣称「那一支永远走不到」。
   */
  id: string
  /** 级别的显示名（`src/highlightLevels.ts` 那一份，与本仓其它严重度文案同源）。 */
  label: string
  count: number
}

/**
 * 逐级别计数：只产出**在场**的级别，顺序恒为 `HIGHLIGHT_LEVELS` 的顺序
 * （ERROR → WARNING → WEAK_WARNING → INFO = 严重度降序，与上游
 * `InspectionResultsViewComparator.java:34-38` 排级别组节点同一方向）。
 * 空表产出空数组（上游的 `getProblemLevels()` 对没有问题的节点也是空数组，不造一个「0 errors」）。
 */
export function levelCountsOf(rows: readonly ProblemRow[]): ProblemLevelCount[] {
  const counted = new Map<HighlightLevelId, number>()
  for (const row of rows) {
    const id = levelForSeverity(row.severity).id
    counted.set(id, (counted.get(id) ?? 0) + 1)
  }
  return HIGHLIGHT_LEVELS
    .filter(level => (counted.get(level.id) ?? 0) > 0)
    .map(level => ({ id: level.id, label: level.label, count: counted.get(level.id) ?? 0 }))
}

/** 上游 `InspectionTreeTailRenderer.MAX_LEVEL_TYPES`（`:23`）。 */
export const MAX_TAIL_LEVEL_TYPES = 5

/** 尾巴上的一格。 */
export interface ProblemTailEntry {
  /** 级别 id；合计那一格是 `'TOTAL'`（`inspection.problem.descriptor.count` 不分级别）。 */
  id: string
  text: string
  /** 这一格是否用「错误红」画（上游只有 ERROR 那一格、且**没**按严重级分组时才是红，`:63-65`）。 */
  error: boolean
}

/**
 * 一条级别的计数文案。上游模板是 `{0} {severity name}`，且数量为 1 时用单数
 * （`InspectionsBundle.properties:43` `{0} {0, choice, 0#warnings|1#warning|2#warnings}`，
 * `HighlightSeverity.java:176-180` 取的就是这一串）。中文没有单复数变化，所以本仓的形态是
 * 「名字 + 数字」——与本仓已有的那份同口径计数文案一致（`src/inspectionReport.ts` 的
 * `错误 <b>3</b>`），数字与级别的对应关系仍然逐字照上游。
 */
export function levelCountText(count: number, label: string): string {
  return `${label} ${count}`
}

/** 合计那一格（上游 `inspection.problem.descriptor.count`：0 条 = 空串）。 */
export function itemsCountText(total: number): string {
  return total <= 0 ? '' : total === 1 ? '(1 item)' : `(${total} items)`
}

/**
 * 一组问题的尾巴计数。`groupedBySeverity` = 这一份表是不是**按严重级分组**在显示
 * （上游那个开关 `AnalysisUIOptions.GROUP_BY_SEVERITY`，只影响 ERROR 那一格的颜色，`:63-65`）。
 * 级别种数 > `MAX_TAIL_LEVEL_TYPES` 时只给一格合计（`:56-59`）。
 * 本仓的级别表当前只有四档，所以合计那一格在现网走不到 —— 留出来是给自定义严重度
 * （上游 `SeverityRegistrar` 允许注册新级别）与判据用的，不是在面板上摆的空控件。
 */
export function problemTailCounts(levels: readonly ProblemLevelCount[], groupedBySeverity: boolean): ProblemTailEntry[] {
  const total = levels.reduce((sum, item) => sum + item.count, 0)
  if (levels.length > MAX_TAIL_LEVEL_TYPES) {
    const text = itemsCountText(total)
    return text ? [{ id: 'TOTAL', text, error: false }] : []
  }
  return levels.map(item => ({
    id: item.id,
    text: levelCountText(item.count, item.label),
    error: item.id === 'ERROR' && !groupedBySeverity,
  }))
}

/**
 * 面板组头实际画的那一串。与上游的一处**有意差异**（记在这，不假装一致）：
 * 本仓的组头本来就带一个总条数（`group.count`），组内只有一级时再补一格「错误 3」就是同一个数的
 * 第二遍 ⇒ 那种情况不画；混了两个及以上级别时才画逐级，那时它才是新信息。
 * 按严重级分组时每组恒一级 ⇒ 这一节恒空，组名本身已经是那一级
 * （组名 = 级别显示名，上游同一格是 `InspectionSeverityGroupNode.java:37-39`）。
 */
export function groupTailOf(rows: readonly ProblemRow[], groupedBySeverity: boolean): ProblemTailEntry[] {
  const levels = levelCountsOf(rows)
  return levels.length > 1 ? problemTailCounts(levels, groupedBySeverity) : []
}
