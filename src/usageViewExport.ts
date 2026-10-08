// 用法视图「导出到文本文件」的**模块侧文本构造**：把面板已经装配好的那一列行拍成文件内容。
//
// 为什么要有这一份而不是继续用 `src/usageViewGrouping.ts` 的 `exportUsageTreeText`：
// 那边吃的是**树**（自己再 `flattenUsageTree` 一遍），而面板画的那一列行是
// `usageTreeRows(usageRowsForQuery(...))` 的产物（行模型 ②稳定 id / ③折叠对账 / ④每层计数，
// `src/usageViewTreeModel.ts`）。两条路各数一遍账 = 同一份规则写第二遍，迟早漂。
// 本模块**只吃行**（`UsageTreeRow[]`），自己绝不遍历树：树里有哪几层、层的先后、计数、
// 位置文本，全部由既有的那一份算好送进来（`usageViewGrouping.ts` 与 `usageViewTreeModel.ts` 都是只读复用）。
//
// 上游出处（2026-10-06 逐行开参考树核过；根 =
// `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · 导出本体 `platform/usageView-impl/src/com/intellij/usages/impl/ExporterToTextFile.java`（97 行）：
//     - `:25-29` `getReportText()` = `appendNode(buf, modelRoot, System.lineSeparator(), "")`；
//     - `:31-47` `appendNode`：先打 indent，`node.getParent() != null` 才打印这一行，
//       子级缩进 = `indent + "    "`（`:35`，**四个空格**），根只把缩进往下传（`:38-40`）；
//     - `:57-63` 组行 = `getPresentableGroupText()` + `" "`（`:60`）+ `" (" + usages.n(getRecursiveUsageCount()) + ")"`；
//     - `:73-81` 叶子 = 逐个 `TextChunk` 拼接，`chunkCount == 1` 时补一个空格（注释
//       `// add space after line number`）⇒ 观测到的是「行号 正文」；chunk0 = 行号
//       （`platform/usageView/src/com/intellij/usages/ChunkExtractor.java:361` 的
//       `String.valueOf(lineNumber + 1)`），其后是那一行的正文（同文件 `:336`），
//       `computeText` 整体见 `platform/usageView/src/com/intellij/usages/UsageInfo2UsageAdapter.java:184-214`；
//     - `:84-91` `getDefaultFilePath` / `exportedTo` = 读写 `UsageViewSettings.getExportFileName()`
//       （上一次导出用的那条路径，写在成功之后 —— 调用点是
//       `platform/platform-impl/src/com/intellij/ide/util/ExportToFileUtil.java:66`）；
//     - `:93-96` `canExport` = `!isSearchInProgress() && areTargetsValid()`
//       （`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1863` / `:2174`）；
//     - 契约四格本身在 `platform/platform-api/src/com/intellij/ide/ExporterToTextFile.java:11-32`。
//   · **黄金样本**（逐空格照它对齐）`platform/platform-tests/testSrc/com/intellij/usages/impl/UsageViewTest.java:262-270`：
//     ```
//     Usages  (1 usage found)
//         Unclassified  (1 usage found)
//             light_idea_test_case  (1 usage found)
//                   (1 usage found)
//                       X.java  (1 usage found)
//                           1 public class X{ int xxx; } //comment
//     ```
//     最后一行是「行号 + 一个空格 + 正文」；倒数第二行的 14 个空格 = 深度 3 的 12 空格 +
//     `:60` 那个空格 + `" ("` 的第一个空格（那一档的组文本是空串）⇒ 缩进确实是每层四个空格，没有例外。
//   · 上游**没有结尾统计行**（黄金样本止于最后一条用法行）：总数那一格是**根组行** `Usages  (N usages found)`。
//     本仓的根不可见（`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewTreeCellRenderer.java:88-89`，
//     同 `src/usageViewTreeModel.ts:88` 的登记），行模型里也没有那一行 ⇒ 统计改放**结尾一行**，
//     措辞复用既有那一份（`usageSummary`，`src/usageViewGrouping.ts:350-353`），不新造文案。
//   · 落盘：上游走 `ExportToFileUtil.chooseFileAndExport`（`ExportToFileUtil.java:58-102`：保存对话框 +
//     已存在时「覆盖/追加/取消」+ `FileWriter(UTF_8)`）。本仓的通道是宿主的
//     `dialog.saveFile` + `app.writeExportFiles`（`native/export_file.hpp:29` 的放行清单
//     `{".html", ".htm", ".txt"}` ⇒ `.txt` 真能写），面板侧既有同款：
//     `src/components/ProblemsPanel.vue:543-558`（文本导出）与 `src/App.vue:1385-1389`（层级导出）。
//
// 架构不等价处（如实登记，不假装有）：
//   · 叶子的**正文行**：本仓的行模型里没有文本（`UsageLocationLike` 只有 `path/line/character`，
//     `src/usageViewGrouping.ts:76-81`；那条缺口在 `src/usageViewGrouping.ts:62-64` 已登记）。
//     补它要逐条引用去读文件（`file.read`），导出侧不开新数据源 ⇒ 叶子仍是 `行:列`。
//   · 被排除的用法（`ExporterToTextFile.java:49-52` 的 `(excluded) ` 前缀）：本仓没有「排除」这一态，
//     没有数据源就没有那一格，不做。
//   · `UsageTargetNode`（`:64-66`）：本仓没有 target 层（`src/usageViewTreeModel.ts:85-89`）。
//   · 组行文本与左括号**之间**：上游是两个空格（`:60` 那个 `append(" ")` 加上 `" ("`），
//     本仓既有导出是一个空格且被三条既有断言钉着（`tests/usage-view-panel-rows.test.mjs:98-107/156/332`）。
//     改它要同时动只读模块 `src/usageViewGrouping.ts` 与那三条断言 ⇒ 本模块**跟既有形状一致**，
//     不留两份形状；统一请求写在 `docs/batch-2026-10-06-usageexport.md` §6。
//   · 上游导的是 model（折叠状态与 speed search 都不影响它 —— 上游的 speed search 根本不过滤），
//     所以本模块的入参由调用方给「同一份装配链、空折叠集」的那一列行；过滤串那一条差异登记在
//     `src/referenceContents.ts` 的 `exportReferencesText` 头上。

import { usageSummary, usagesFoundText, type UsageTreeRow } from './usageViewGrouping.ts'

/** 一行导出的形状（`UsageTreeRow` 的只读子集 —— 本模块不需要 id/level，也不重算任何东西）。 */
export type UsageExportRow = Pick<UsageTreeRow, 'kind' | 'depth' | 'label' | 'count' | 'path' | 'line' | 'character'>

/** 每下一层加的缩进量（`ExporterToTextFile.java:35` 的 `indent + "    "`）。 */
export const USAGE_EXPORT_INDENT = '    '

/** 写文件用的行分隔符：本仓的写盘通道与判据都按 `\n` 比（`errorTreeText` 同一条口径）。 */
const EXPORT_LINE_SEPARATOR = '\n'

export interface UsageExportOptions {
  /** 标题行（上游那一格是根组行 `Usages`，本仓是面板标题；为空就不写标题也不写那条空行）。 */
  header?: string
  /** 结尾统计（默认开）；上游没有这一行，措辞复用既有 `usageSummary`，见模块头。 */
  summary?: boolean
  /** 行分隔符，默认 `\n`。上游传的是 `System.lineSeparator()`（`:27`）。 */
  lineSeparator?: string
}

/** 一条组行（目录 / 文件 / 类 / 方法）：`呈现文本 (找到 N 条用法)` —— `ExporterToTextFile.java:57-63`。 */
export function usageExportGroupLine(row: UsageExportRow): string {
  return `${row.label} (${usagesFoundText(row.count)})`
}

/**
 * 一条用法叶子：位置文本（`行:列`，1 基，`usageViewGrouping.ts` 的 `usagePositionText` 算好的那一格）。
 * 上游此处是「行号 + 空格 + 正文」（`:73-81` + `ChunkExtractor.java:361`），本仓没有正文文本，见模块头的架构不等价。
 */
export function usageExportLeafLine(row: UsageExportRow): string {
  return row.label
}

/** 单独一行的导出文本（含缩进）—— 面板行序不动，这里只做呈现，不排序也不补层。 */
export function usageExportLine(row: UsageExportRow): string {
  const indent = USAGE_EXPORT_INDENT.repeat(Math.max(0, row.depth))
  return `${indent}${row.kind === 'usage' ? usageExportLeafLine(row) : usageExportGroupLine(row)}`
}

/** 这一列行里的用法叶子（结尾统计与「已导出 N 条」都用这一份，免得两处各 filter 各数）。 */
export function usageExportLeaves(rows: readonly UsageExportRow[]): UsageExportRow[] {
  return rows.filter(row => row.kind === 'usage')
}

/**
 * 整份导出文本（对应上游 `getReportText()`，`:25-29`）。
 * 空行序列 ⇒ 空串：没有内容就不写标题也不写统计（与既有 `exportUsageTreeText` 同一档，
 * `tests/usage-view-panel-rows.test.mjs:107` 钉着「空结果导出空串」）。
 */
export function usageExportText(rows: readonly UsageExportRow[], options: UsageExportOptions = {}): string {
  const separator = options.lineSeparator ?? EXPORT_LINE_SEPARATOR
  if (!rows.length) return ''
  const lines: string[] = []
  if (options.header) lines.push(options.header, '')
  for (const row of rows) lines.push(usageExportLine(row))
  // 结尾统计：`N 处引用 / M 个文件`（既有 `usageSummary` 那一份措辞，一条规则不写两遍）。
  if (options.summary !== false) lines.push('', usageSummary(usageExportLeaves(rows)))
  return lines.join(separator)
}

/**
 * 能不能导出（`:93-96` 的 `canExport`）：还在搜 / 选中的那条内容已经没了 ⇒ 不能。
 * 多加的一条 `rowCount > 0` 是本仓的（上游的空 model 也能导出一份空文件）：面板那两个整体动作
 * 本来就是 `:disabled="!rows.length"`（`src/components/ReferencePanel.vue:80-81`），
 * 导一个只有标题的文件出来是噪声，而且画得出、点得动却写出空文件才是真糊弄。
 */
export function canExportUsages(state: { searching: boolean; targetsValid: boolean; rowCount: number }): boolean {
  return !state.searching && state.targetsValid && state.rowCount > 0
}

/** 文件名里不许出现的字符（Windows 与 POSIX 的并集；`dialog.saveFile` 的默认名用）。 */
const UNSAFE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g

/** 把查询名压成可当文件名的那一段（太长截到 40，空/全非法退回 `usages`）。 */
export function usageExportNameSeed(name: string): string {
  const cleaned = (name ?? '').replace(UNSAFE_NAME_CHARS, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned ? cleaned.slice(0, 40) : 'usages'
}

/**
 * 默认文件名（`:84-86` 的 `getDefaultFilePath` 在本仓的等价物 = 「这个查询的默认导出名」）。
 * 形状照本仓既有那一份（`src/errorTree.ts:245-249` 的 `error-report-<yyyymmdd-HHmm>.txt`），
 * 扩展名固定 `.txt` —— 写盘通道只放行 `.html`/`.htm`/`.txt`（`native/export_file.hpp:29`）。
 */
export function usageExportFileName(name: string, date = new Date()): string {
  const two = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}`
  return `usages-${usageExportNameSeed(name)}-${stamp}.txt`
}

/** 上一次导出用的默认名（`getDefaultFilePath` 里存的那一条；`ExportDialogBase` 用它的 basename，见 `ExportToFileUtil.java:122`）。 */
export function usageExportSuggestedName(rememberedPath: string, name: string, date = new Date()): string {
  const tail = (rememberedPath ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  return tail.toLowerCase().endsWith('.txt') ? tail : usageExportFileName(name, date)
}

/** 写完之后的成功说明（上游是「静默写完 + `exportedTo` 记路径」，本仓面板要给用户一句话；措辞照 `ProblemsPanel.vue:552` 那一条）。 */
export function usageExportSavedNote(path: string, rowCount: number): string {
  return `已导出 ${usagesFoundText(rowCount)}：${path}`
}
