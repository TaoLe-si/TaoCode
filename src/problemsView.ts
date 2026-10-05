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
import { levelForSeverity } from './highlightLevels.ts'
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
export type ProblemGrouping = 'none' | 'file' | 'directory' | 'source' | 'code' | 'inspection'

/** 面板下拉里能选到的档（`src/problemsPanelState.ts` 的读档白名单与它一一对应）。 */
export const PROBLEM_GROUPINGS: readonly ProblemGrouping[] = ['none', 'file', 'directory', 'source', 'code', 'inspection']

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

/** 排序开关（上游 `ProblemsViewState.sortBySeverity`/`sortByName`，默认见 `ProblemsViewState.kt:30-31`）。 */
export interface ProblemSort {
  sortBySeverity: boolean
  sortByName: boolean
}

export const DEFAULT_PROBLEM_SORT: ProblemSort = { sortBySeverity: true, sortByName: false }

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
  if (grouping === 'inspection') return identityOfRow(first).displayName || key
  if (grouping === 'code') return first.code ? identityOfRow(first).displayName || key : key
  return key
}

/**
 * 分组。组顺序 = 组内第一条问题在传入顺序里的出现顺序，组内顺序保持传入顺序
 * （面板把排序开关的结果先算好再传进来，所以「按文件分组」不会把错误排到警告后面）。
 * 承接 `groupByToolId` 的两档（`code`/`inspection`）例外：按上游把未分组的问题排在组前、
 * 组之间按组名自然序，见 `TOOL_ID_GROUPINGS` 的注释。
 */
export function groupProblems(rows: readonly ProblemRow[], grouping: ProblemGrouping): ProblemGroup[] {
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

/** 严重度计数（状态栏与面板标题同一套口径；级别归属见 `src/highlightLevels.ts`）。 */
export function problemCounts(rows: readonly ProblemRow[]): { errors: number; warnings: number; infos: number } {
  let errors = 0, warnings = 0, infos = 0
  for (const row of rows) {
    const level = levelForSeverity(row.severity).id
    if (level === 'ERROR') ++errors
    else if (level === 'WARNING') ++warnings
    else ++infos
  }
  return { errors, warnings, infos }
}
