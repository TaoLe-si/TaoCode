// 错误树/消息视图 —— 上游 `ErrorViewStructure` + `ErrorTreeElement`/`ErrorTreeElementKind`
// + `ErrorViewTextExporter`（`platform/platform-impl/src/com/intellij/ide/errorTreeView/`，
// kind 那一枚举在 `platform/platform-api/src/com/intellij/ide/errorTreeView/`）。
//
// 上游结构（逐条对照，行号是本机参考树实测）：
//   · `ErrorViewStructure.java:44-50` `ourMessagesOrder`：根的子节点按 **INFO, ERROR, WARNING,
//     NOTE, GENERIC** 的固定顺序排（`:114-121`，空桶不出现）；
//   · `:124-129` 根的另一批子节点是**具名分组**（`GroupingElement`，组名 = 文件的 presentableUrl，
//     `:236-247`），组里挂的是 `NavigatableMessageElement`（`:330-353`；`groupName == null`
//     的那一支不进组、直接按 kind 挂在根上）；
//   · `NewErrorTreeViewPanel.kt:174` 把这份 structure 交给 `ErrorViewTextExporter`，所以
//     **导出器导的就是面板在显示的那棵树**（`ErrorViewTextExporter.java:72` 逐节点走
//     `myStructure.getChildElements(...)`）；
//   · `ErrorTreeElementKind.getPresentableText()`（`ErrorTreeElementKind.java:39-41`）给导出行的
//     kind 前缀（IdeBundle `errortree.information`/`errortree.error`/`errortree.warning`/
//     `errortree.note`，`:131-134` 英文原文各带一个冒号；GENERIC 的是空串 `:22`）；
//   · `ErrorViewTextExporter.java:70-87`：每条子节点前先换行、`shift(buffer, indent)`、
//     递归时 `indent + 4`；`:77-79` `withUsages`（=「Show details」那颗勾）为 false 时
//     **跳过 `NavigatableMessageElement`**、组头与不可跳转的 simple 消息不跳。
//   · 树有多深：`ErrorViewStructure.getChildElements` 只对 `element == root` 与
//     `element instanceof GroupingElement` 两种情况给子节点，其余一律 `EMPTY_ARRAY`（`:109-152`）
//     ⇒ 这棵树**恒为 root → 组 → 消息两层**，`indent + 4` 只会加一次。本仓照这个深度做，
//     不造第三层（`docs/batch-2026-10-06-msgaudit.md` 的 B6「补多级缩进」到这儿为止：
//     缺的不是缩进，是**导出没跟着屏幕上的分组**，见 `errorTreeSections`）。
//
// 本仓：构建/运行/LSP 的问题都在 `src/problems.ts` 的 `ProblemRow` 表里（问题面板与状态栏同一数据源）。
// 这里的映射是 —— 严重度分桶（1 错误 / 2 警告 / 3 提示 / 4 信息）当具名分组、每条问题当
// `NavigatableMessageElement`（有真实路径与行列，可跳转）；文本导出就是 `ErrorViewTextExporter`
// 的等价物，消费者是问题面板的「导出文本…」（IDEA 的消息窗口也有这条 Export to text file）。
//
// 与上游的**有意差异**两条，写在落点旁边、不假装一致：
//   · 组头带条目数（`错误 (3)`）—— 上游 `GroupingElement` 的 `text` 只有名字
//     （`GroupingElement.java:18-23`）；长列表里没有条数没法对账。
//   · 行内的位置串用 `路径:行:列`（与编辑器/问题面板同一口径），上游是
//     `errortree.prefix.line` = `line ({0})`（`NewErrorTreeViewPanel.kt:223` +
//     `IdeBundle.properties:142`），只有行没有列；而且上游在组里还要把 kind 文案**再**拼一遍
//     （`NavigatableMessageElement.java:52-54` 的 `getExportTextPrefix()` 自己就带
//     `getKind().getPresentableText()`，`ErrorViewTextExporter.java:91-92` 又拼了一次），
//     那是同一行出现两遍 `Error:` 的既有毛病，本仓不抄。
import type { ProblemRow } from './problems.ts'
// 复制文案与 kind 前缀要的严重度名/检查项名：与问题面板、状态栏同一份，别在这儿再映一遍。
import { severityLabel } from './highlightLevels.ts'
import { identityOfRow } from './inspectionIdentity.ts'

/** 上游 `ErrorTreeElementKind` 的五个档（GENERIC 没有可显示文案，导出时前缀为空）。 */
export type ErrorTreeKind = 'info' | 'error' | 'warning' | 'note' | 'generic'

/** `ErrorViewStructure.ourMessagesOrder` 的固定顺序 —— 输入顺序不影响输出顺序。 */
export const ERROR_TREE_KIND_ORDER: readonly ErrorTreeKind[] = ['info', 'error', 'warning', 'note', 'generic']

/** `ErrorTreeElementKind.getPresentableText()` 的文案（本仓界面语言）。 */
export const ERROR_TREE_KIND_LABEL: Record<ErrorTreeKind, string> = {
  info: '信息', error: '错误', warning: '警告', note: '提示', generic: '',
}

/** 严重度 → kind。上游 `ErrorTreeElementKind.convertMessageFromCompilerErrorType`（MessageCategory → kind）的对应物。 */
export function errorTreeKind(severity: number): ErrorTreeKind {
  switch (severity) {
    case 1: return 'error'
    case 2: return 'warning'
    case 3: return 'note'
    case 4: return 'info'
    default: return 'generic'
  }
}

/** 一个分组（上游 `GroupingElement` 的等价物）：同 kind 的消息桶。 */
export interface ErrorTreeBucket {
  kind: ErrorTreeKind
  /** 组名（空桶不产生分组；GENERIC 的名字为空串，导出时不会有组头行）。 */
  label: string
  rows: ProblemRow[]
}

/** 按 kind 分桶：只保留非空桶，顺序固定为 `ERROR_TREE_KIND_ORDER`（与上游 getChildElements(root) 同口径）。 */
export function buildErrorTree(rows: readonly ProblemRow[]): ErrorTreeBucket[] {
  const buckets = new Map<ErrorTreeKind, ProblemRow[]>()
  for (const row of rows) {
    const kind = errorTreeKind(row.severity)
    const list = buckets.get(kind)
    if (list) list.push(row)
    else buckets.set(kind, [row])
  }
  return ERROR_TREE_KIND_ORDER
    .filter(kind => (buckets.get(kind)?.length ?? 0) > 0)
    .map(kind => ({ kind, label: ERROR_TREE_KIND_LABEL[kind], rows: buckets.get(kind)! }))
}

/** 组头文案：`错误 (3)`（上游组名 + 条目数；没有条目数的组头在长列表里没法对账）。 */
export function bucketHeader(bucket: ErrorTreeBucket): string {
  return bucket.label ? `${bucket.label} (${bucket.rows.length})` : `(${bucket.rows.length})`
}

/** 一条消息的导出行：`路径:行:列 消息`（0 基行列转 1 基，与编辑器/问题面板同一口径）。 */
export function errorTreeLine(row: ProblemRow): string {
  const position = `${row.path}:${row.line + 1}:${row.character + 1}`
  return row.message ? `${position} ${row.message}` : position
}

/**
 * 一行导出文本：kind 前缀 + 位置与消息。
 * 上游 `ErrorViewTextExporter.exportElement`（`:89-104`）先 `buffer.append(element.getKind()
 * .getPresentableText())` 再拼元素自己的文本 —— **每一行都带 kind**。
 * `withKind: false` 只在 kind 分桶那一层用（组头本身就是那一级，重复一遍等于把「错误」写两遍，
 * 那是上游 `:91-92` + `NavigatableMessageElement.java:52-54` 拼出来的既有毛病，本仓不抄）。
 */
export function errorTreeRowText(row: ProblemRow, withKind: boolean): string {
  if (!withKind) return errorTreeLine(row)
  const kind = ERROR_TREE_KIND_LABEL[errorTreeKind(row.severity)]
  return kind ? `${kind} ${errorTreeLine(row)}` : errorTreeLine(row)
}

/**
 * 一条问题的**复制文案**（上游 `NewErrorTreeViewPanel.kt:251-259` 的 `performCopy`：每个选中节点 =
 * `NewErrorTreeRenderer.calcPrefix(element)` + 元素自己的 `text`，节点之间 `joinToString("\n")`）。
 * `calcPrefix`（`NewErrorTreeRenderer.java:227-239`）对 `NavigatableMessageElement` 取 kind 的
 * 可显示文案 + `getRendererTextPrefix()`，那个前缀来自 `NewErrorTreeViewPanel.kt:226-231` 的
 * `createRendererPrefix`（`(行)` / `(行, 列)`）⇒ 本仓的「严重度: 路径:行:列」。
 * 末尾括号里是检查项：上游的 `rendererTextPrefix` 只给位置，这一格是本仓多出来的（面板那一行本来就
 * 画着来源/检查项两列，复制不带就对不上账），没有来源也没有码时不编造、整段省掉。
 *
 * 2026-10-06 从 `src/components/ProblemsPanel.vue` 搬进来（`docs/batch-2026-10-06-errtree.md`）：
 * 复制的是**树节点**，格式属于元素模型不属于宿主；搬过来同时给 `errorTree.ts` 添了第二个生产消费方。
 */
export function errorTreeCopyText(row: ProblemRow): string {
  const head = `${severityLabel(row.severity)}: ${row.path}:${row.line + 1}:${row.character + 1}`
  const item = identityOfRow(row).displayName
  return `${head} — ${row.message}${item ? `（${item}）` : ''}`
}

/** 面板当前那一层的分组（只取 `src/problemsView.ts` 的 `ProblemGroup` 里导出要用的两格）。 */
export interface ErrorTreeOuterGroup {
  label: string
  rows: readonly ProblemRow[]
}

/** 导出树的一层：组头 + 组内消息（上游 `GroupingElement` 与它 `getChildElements` 出来的子节点）。 */
export interface ErrorTreeSection {
  /** 组头，已带条目数。这一层永远有头 —— 「不进组」的那批按 kind 分桶补头，见 `errorTreeSections`。 */
  header: string
  /** 组头说的**是不是** kind：说 kind 时行内不再重复 kind（见 `errorTreeRowText`）。 */
  kindHeader: boolean
  rows: readonly ProblemRow[]
}

/** kind 分桶那一层 —— 上游 root 里 `groupName == null` 的那一支（`ErrorViewStructure.java:338-340`）。 */
function kindSections(rows: readonly ProblemRow[]): ErrorTreeSection[] {
  return buildErrorTree(rows).map(bucket => ({ header: bucketHeader(bucket), kindHeader: true, rows: bucket.rows }))
}

/**
 * 要导出的那棵树 = **屏幕上那棵树**（上游 `NewErrorTreeViewPanel.kt:174` 交给导出器的就是面板那份
 * `ErrorViewStructure`，`ErrorViewTextExporter.java:56,70-87` 逐层走它的 `getChildElements`）。
 * 三条规则逐字照 `ErrorViewStructure.java:109-153`：
 *   · 面板分了组 ⇒ 一个组一个头（`:124-129` 的具名分组），组与组的顺序、组内消息的顺序
 *     都是面板算好的那一份（先过滤再排序再分组，见 `src/problemsView.ts` 的三段顺序）；
 *   · 「不进组」的那一批（`groupProblems` 把 `groupKeyOf` 折出空串的条目单列一组、`label` 是空串 ——
 *     上游同一形状见 `ProblemsViewHighlightingChildrenBuilder.kt:56-61`）**不画空标题**，
 *     而是补 kind 头并按 `ourMessagesOrder` 排（`:114-122` 那一支）；
 *   · 没传分组，或传进来的分组全是空标签（= 面板的「不分组」那一档）⇒ 整棵就是 kind 分桶，
 *     与本模块落地时的形状逐字一致（`tests/error-tree.test.mjs` 钉着）。
 * 深度与上游同为 root → 组 → 消息，**没有第三层**（见文件头对 `:109-152` 的核对）。
 */
export function errorTreeSections(
  rows: readonly ProblemRow[],
  groups: readonly ErrorTreeOuterGroup[] = [],
): ErrorTreeSection[] {
  if (!groups.some(group => group.label)) return kindSections(rows)
  const sections: ErrorTreeSection[] = []
  for (const group of groups) {
    if (group.label) sections.push({ header: `${group.label} (${group.rows.length})`, kindHeader: false, rows: group.rows })
    else sections.push(...kindSections(group.rows))
  }
  return sections
}

/** 上游 `ErrorViewTextExporter.java:106-110` 的 `shift(buffer, indent)`：N 个空格。 */
function shift(indent: number): string {
  return ' '.repeat(indent)
}

/** 上游 `getReportText` 每下一层加的缩进量（`ErrorViewTextExporter.java:85` 的 `indent + 4`）。 */
const INDENT_STEP = 4

/**
 * 文本导出（上游 `ErrorViewTextExporter.getReportText`）：
 *   · 组头在缩进 0，组内每条消息缩进 `INDENT_STEP`（上游 `:83-85` 的 `shift` + `indent + 4`）；
 *   · `details === false`（上游「Show details」不勾）⇒ 只跳消息叶子、组头全留
 *     （`:77-79` 跳的正是 `NavigatableMessageElement`）；
 *   · 行间换行、末尾带一个换行（写文件用；上游 `:80-82` 是"每条前换行"、结尾不带，
 *     带不带在这份文件里没人看得见，取对本仓写盘通道更稳的那一种）。
 */
export function errorTreeText(
  rows: readonly ProblemRow[],
  options: { details?: boolean; groups?: readonly ErrorTreeOuterGroup[] } = {},
): string {
  const details = options.details !== false
  const lines: string[] = []
  for (const section of errorTreeSections(rows, options.groups ?? [])) {
    lines.push(section.header)
    if (details) for (const row of section.rows) lines.push(`${shift(INDENT_STEP)}${errorTreeRowText(row, !section.kindHeader)}`)
  }
  return lines.length ? `${lines.join('\n')}\n` : ''
}

/**
 * 一条问题在两次推送之间的**身份**（上游比的是树节点对象本身，本仓问题表每帧由语言服务重推，
 * 只能按内容比）。位置 + 严重度 + 消息 + 检查器 + 诊断码全参与：少一格就会把"同一处消息变了"
 * 当成没变，或者把"挪了一列"当成两条新错误。
 */
export function errorTreeRowKey(row: ProblemRow): string {
  return [row.path, row.line, row.character, row.severity, row.message, row.source, row.code ?? ''].join('\u0000')
}

/**
 * 新到的**错误**要把哪些组从折叠集合里放出来（上游 `NewErrorTreeViewPanel.kt:331-361` 的
 * `updateAddedElement`，末尾 `:357-360`：
 *   if (element.kind == ErrorTreeElementKind.ERROR) { // expand automatically only errors
 *       future!!.thenRun { makeVisible(element) } }
 * `makeVisible` = `:363-365` 的 `structureModel.makeVisible(element, myTree) {}`，展开的是这条元素
 * 到根的那条路径 ⇒ 效果 = 「折着的组里冒出一个错误，那一组当场展开」；
 * 警告/提示/信息新到**不**展开（上面那句注释就是这一条区别对待）。
 * 只**移除**键、从不新增 ⇒ 用户手动折的东西不会被这条规则反向盖掉。
 * `groupKeyOf` 由调用方按面板当前的分组档给（`src/problemsView.ts` 的 `groupKeyOf`）；不分组那一档
 * 键是空串（`groupProblems` 的 `key: ''`），而面板的 `collapseAll` 本来就把空键滤掉
 * （`ProblemsPanel.vue` 的 `.filter(Boolean)`），所以那一档下这条是空操作 —— 不是把空串当组键存进去。
 */
export function expandGroupsForNewErrors(
  collapsed: readonly string[],
  previousKeys: ReadonlySet<string>,
  next: readonly ProblemRow[],
  groupKeyOf: (row: ProblemRow) => string,
): string[] {
  if (!collapsed.length) return [...collapsed]
  const opened = new Set<string>()
  for (const row of next) {
    if (errorTreeKind(row.severity) !== 'error') continue
    if (previousKeys.has(errorTreeRowKey(row))) continue
    opened.add(groupKeyOf(row))
  }
  return opened.size ? collapsed.filter(key => !opened.has(key)) : [...collapsed]
}

/** 导出文件名（与 HTML 报告同一时间戳口径）：`error-report-20261004-1530.txt`。 */
export function errorReportFileName(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}`
  return `error-report-${stamp}.txt`
}
