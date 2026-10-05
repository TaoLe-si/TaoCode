// 重命名的预览账与**冲突检测**（上游 `rename` 族的 `RenameUsage` / `RenameConflict` /
// `RenameViewDescriptor` / `preview/` 那一层：IDEA 在应用重命名前先算出"哪些文件、哪些位置
// 会被改"，把冲突标出来，再让用户确认）。
//
// 本仓的重命名走 LSP `textDocument/rename`，服务器回一份 WorkspaceEdit。应用前的这一步在
// `src/semanticActions.ts` 的 `applyRename` 里做三件事：
//   · **冲突拒绝**：同一文件里两条编辑区间重叠、或同一位置两次插入不同文本 —— 顺次套用时的
//     结果取决于顺序，写下去就是静默改坏文件（LSP 规范禁止重叠编辑，但坏服务器真实存在）；
//   · **去重**：完全相同的编辑（同区间同文本）只应用一次 —— 有的服务器会重复报同一条；
//   · **账目**：把「共 N 处、M 个文件」写进完成提示，用户能看出这次重命名动了多大范围。
//   · **「在注释和字符中搜索」**（`RenameDialog.java:66/280-281` 的 `myCbSearchInComments`，
//     默认勾上）：LSP 的 `textDocument/rename` 不接这个开关（协议里没有该字段），
//     所以语言服务给的编辑之外，本仓**另算**一遍注释/字符串里的字面出现并追加为编辑；
//     上游是 `elementProcessor.setToSearchInComments(...)`（`RenameDialog.java:376`）
//     把开关交给 `RenameProcessor`，后者靠 `TextOccurrencesUtil` 找那些出现 —— 本仓的等价物是
//     `nonCodeUsages`（见 `src/nonCodeUsages.ts`）。
//
// 纯函数（输入就是 bridge 的 `LspFileEdits` 形状），可单测。
import type { LspFileEdits, LspTextEdit } from './bridge'
import { nonCodeUsages, type FileText } from './nonCodeUsages.ts'

/** 「在注释和字符中搜索」—— 上游 `RefactoringBundle.properties:36` `search.in.comments.and.strings`
 *  的中文文案（zh 语言包同键值原文），去掉 `(&C)` 助记符（本仓复选框不画助记符）。 */
export const SEARCH_IN_COMMENTS_LABEL = '在注释和字符中搜索'
/** 「搜索文本匹配项」—— `RefactoringBundle.properties:38` `search.for.text.occurrences`（同上）。 */
export const SEARCH_TEXT_OCCURRENCES_LABEL = '搜索文本匹配项'
/** 上游两个复选框的缺省档：`RenameDialog.java:281` `myCbSearchInComments.setSelected(true)`、
 *  `SafeDeleteDialog.java:163` 读 `RefactoringSettings.SAFE_DELETE_SEARCH_IN_COMMENTS`（新建实例为真）。 */
export const SEARCH_IN_COMMENTS_DEFAULT = true

/** 一处会被改的位置（上游 `RenameUsage` 的落点；行号按编辑器口径 0 基，展示时 +1）。 */
export interface RenameUsage {
  path: string
  line: number
  character: number
  /** 服务器要写进去的新文本。 */
  text: string
}

/** 一对互相覆盖的编辑（上游 `RenameConflict`：同一处被两条编辑盯上）。 */
export interface RenameConflict {
  path: string
  first: LspTextEdit
  second: LspTextEdit
}

export interface RenamePreview {
  /** 去重且按文件、位置排好的编辑 —— 应用时用这一份，不用服务器原样返回的那一份。 */
  edits: LspFileEdits[]
  /** 去重后还剩几处编辑。 */
  usageCount: number
  /** 涉及几个文件（只算还有编辑的文件）。 */
  files: number
  usages: RenameUsage[]
  conflicts: RenameConflict[]
}

const isEmptyEdit = (edit: LspTextEdit) => edit.startLine === edit.endLine && edit.startChar === edit.endChar

/** `(line1,char1)` 是否严格在 `(line2,char2)` 之前。 */
function before(line1: number, char1: number, line2: number, char2: number): boolean {
  return line1 < line2 || (line1 === line2 && char1 < char2)
}

/**
 * 两条编辑是否互相覆盖。端部相接（前一条的 end == 后一条的 start）不算 ——
 * LSP 允许这种相邻编辑，套用顺序不影响结果。
 * 空编辑（插入）当点处理：`[start, end)` 的半开区间判定天然把「插在区间端部」放行、
 * 把「插在区间内部」判成覆盖。
 */
function overlapping(a: LspTextEdit, b: LspTextEdit): boolean {
  if (isEmptyEdit(a) && isEmptyEdit(b))
    // 同一位置插两段不同文本：谁先谁后决定最终内容 —— 服务器自己都说不清。
    return a.startLine === b.startLine && a.startChar === b.startChar && a.text !== b.text
  return before(a.startLine, a.startChar, b.endLine, b.endChar) &&
         before(b.startLine, b.startChar, a.endLine, a.endChar)
}

const sameEdit = (a: LspTextEdit, b: LspTextEdit) =>
  a.text === b.text && a.startLine === b.startLine && a.startChar === b.startChar &&
  a.endLine === b.endLine && a.endChar === b.endChar

const positionOf = (a: LspTextEdit, b: LspTextEdit) =>
  a.startLine - b.startLine || a.startChar - b.startChar ||
  a.endLine - b.endLine || a.endChar - b.endChar || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0)

/**
 * 把服务器返回的编辑折成预览账。文件顺序保持输入顺序（服务器给的顺序就是它的意图顺序），
 * 文件内按位置排序。**不会修改入参**。
 */
export function renamePreviewOf(edits: readonly LspFileEdits[]): RenamePreview {
  const files: LspFileEdits[] = []
  const usages: RenameUsage[] = []
  const conflicts: RenameConflict[] = []
  let usageCount = 0
  for (const file of edits) {
    const unique: LspTextEdit[] = []
    for (const edit of file.textEdits ?? []) {
      // 完全相同的编辑只算一次；不同文本的同区间编辑留给冲突检测去抓。
      if (unique.some(candidate => sameEdit(candidate, edit))) continue
      unique.push(edit)
    }
    unique.sort(positionOf)
    for (let index = 0; index < unique.length; index++) {
      for (let other = index + 1; other < unique.length; other++) {
        if (!overlapping(unique[index]!, unique[other]!)) continue
        conflicts.push({ path: file.path, first: unique[index]!, second: unique[other]! })
      }
      usages.push({ path: file.path, line: unique[index]!.startLine, character: unique[index]!.startChar, text: unique[index]!.text })
    }
    if (!unique.length) continue
    usageCount += unique.length
    files.push({ path: file.path, textEdits: unique })
  }
  return { edits: files, usageCount, files: files.length, usages, conflicts }
}

/** 冲突时给用户的话（点出第一处冲突的文件与行，行号按编辑器口径 +1）。 */
export function renameConflictMessage(preview: RenamePreview): string {
  const first = preview.conflicts[0]!
  return `重命名未应用：${first.path} 第 ${first.first.startLine + 1} 行有 ${preview.conflicts.length} 处互相覆盖的编辑` +
         '（语言服务返回的编辑区间重叠，顺次套用会写坏文件）。请改用其他名字，或报告这个语言服务的 bug。'
}

/** 完成提示里的账目：`共 7 处`（文件数由 `applyEditsToFiles` 自己报「更新 N 个文件」）。 */
export function renameUsageSummary(preview: RenamePreview): string {
  return `共 ${preview.usageCount} 处`
}

/**
 * 「在注释和字符中搜索」算出来的追加编辑。
 *
 * 每一处出现变成一条**整词替换**的 LSP 编辑（与语言服务给的编辑同形，所以下游
 * `applyEditsToFiles` / 冲突检测 / 预览树全都不需要改）。计数口径：
 *   · `count` 是追加的编辑条数；
 *   · `files` 是有追加编辑的文件数；
 *   · `skipped` 是**与语言服务编辑落在同一处**而被丢弃的（那种出现语言服务自己已经改了，
 *     追加第二次就是重复写入）；
 *   · `truncated` 是扫描达上限（不冒充全量）。
 */
export interface NonCodeRenameEdits {
  edits: LspFileEdits[]
  count: number
  files: number
  skipped: number
  truncated: boolean
}

/** 语言服务已经要改的位置（按文件收成 `line:char` 集合，用来剔掉重复追加）。 */
function claimedKeys(preview: RenamePreview): Map<string, Set<string>> {
  const claimed = new Map<string, Set<string>>()
  for (const usage of preview.usages) {
    const key = `${usage.line}:${usage.character}`
    const set = claimed.get(usage.path) ?? new Set<string>()
    set.add(key)
    claimed.set(usage.path, set)
  }
  return claimed
}

/**
 * 为重命名追加注释/字符串里的字面出现。
 * `files` 是「路径 → 当前文本 + 该语言的注释标记」；拿不到文本的文件不参与（不猜）。
 */
export function nonCodeRenameEdits(
  word: string,
  newName: string,
  files: readonly FileText[],
  preview: RenamePreview,
  limit = 2000,
): NonCodeRenameEdits {
  if (!word || !newName || word === newName) return { edits: [], count: 0, files: 0, skipped: 0, truncated: false }
  const claimed = claimedKeys(preview)
  const edits: LspFileEdits[] = []
  let count = 0
  let skipped = 0
  let truncated = false
  for (const file of files) {
    if (count >= limit) { truncated = true; break }
    if (typeof file.text !== 'string') continue
    const found = nonCodeUsages(file.text, word, file.style ?? null, { limit: limit - count })
    if (found.length >= limit - count) truncated = true
    const already = claimed.get(file.path) ?? new Set<string>()
    const mine: LspTextEdit[] = []
    for (const occurrence of found) {
      if (already.has(`${occurrence.line}:${occurrence.character}`)) { ++skipped; continue }
      mine.push({
        text: newName,
        startLine: occurrence.line, startChar: occurrence.character,
        endLine: occurrence.line, endChar: occurrence.character + word.length,
      })
      ++count
    }
    if (mine.length) edits.push({ path: file.path, textEdits: mine })
  }
  return { edits, count, files: edits.length, skipped, truncated }
}

/**
 * 把追加的编辑并进已有账：**按路径合并**后重新去重与冲突检测。
 * 走 `renamePreviewOf` 这条既有链路，所以「重叠就整个不应用」那条保证对新编辑同样成立
 * （注释里的出现被别的编辑切开时会报冲突，而不是静默写坏）。
 */
export function mergePreviewEdits(preview: RenamePreview, extra: readonly LspFileEdits[]): RenamePreview {
  const additions = extra.filter(file => file?.textEdits?.length)
  if (!additions.length) return preview
  const byPath = new Map<string, LspTextEdit[]>()
  for (const file of preview.edits) byPath.set(file.path, [...file.textEdits])
  for (const file of additions) {
    const list = byPath.get(file.path) ?? []
    list.push(...file.textEdits)
    byPath.set(file.path, list)
  }
  return renamePreviewOf([...byPath].map(([path, textEdits]) => ({ path, textEdits })))
}

/** 预览对话框里那个复选框的副标题：`注释与字符串里还有 7 处匹配，会一并更新。` */
export function nonCodeRenameSummary(extra: NonCodeRenameEdits): string {
  if (!extra.count) return '注释与字符串里没有匹配的出现。'
  const parts = [`注释与字符串里还有 ${extra.count} 处匹配`]
  if (extra.files > 1) parts.push(`分布在 ${extra.files} 个文件`)
  parts.push('会一并更新')
  if (extra.skipped) parts.push(`其中 ${extra.skipped} 处语言服务已处理，不重复改`)
  if (extra.truncated) parts.push('已达扫描上限')
  return `${parts.join('，')}。`
}
