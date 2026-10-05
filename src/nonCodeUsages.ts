// 注释与字符串里的**用法**（上游 `TextOccurrencesUtil` / `UsageSearchContext` 那一层）。
//
// 上游把这块能力挂在三处，本模块是它们的共同纯规则：
//   · 安全删除（`platform/lang-impl/src/com/intellij/refactoring/safeDelete/SafeDeleteProcessor.java:449-464`）：
//     `addNonCodeUsages(...)` 里 `searchInCommentsAndStrings` 为真时走
//     `TextOccurrencesUtil.addUsagesInStringsAndComments`（`:459`），
//     `searchNonJava` 为真时走 `addTextOccurrences`（`:463`）；对话框上那两个勾选框
//     在 `SafeDeleteDialog.java:149` 与 `:155`，默认值来自
//     `RefactoringSettings.SAFE_DELETE_SEARCH_IN_COMMENTS` / `..._IN_NON_JAVA`（`:163-165`）。
//   · 重命名（`platform/lang-impl/src/com/intellij/refactoring/rename/RenameDialog.java:66/280-281`）：
//     「在注释和字符中搜索」复选框**默认勾上**（`:281`），`doOKAction` 把它交给
//     `elementProcessor.setToSearchInComments(...)`（`:376`）与
//     `new RenameProcessor(..., isSearchInComments(), isSearchInNonJavaFiles())`（`:405`）。
//   · 查找用法（`platform/indexing-api/src/com/intellij/psi/search/UsageSearchContext.java:22-38`）：
//     搜索范围是位标志 `IN_CODE 0x1` / `IN_COMMENTS 0x2` / `IN_STRINGS 0x4` /
//     `IN_FOREIGN_LANGUAGES 0x8`，可按位组合 —— 本仓的 `nonCodeUsages` / `codeUsages`
//     就是这三档的纯函数形态。
//
// **本仓的边界（如实记）**：上游靠 PSI 的 `PsiElement` 判定一段文本是不是注释/字符串
// （词法分析器给出 token 类型）。本仓没有 PSI，用**单趟扫描 + 语言的注释标记**判定，
// 覆盖上最常见的形态：行注释、块注释（可嵌套检查到闭合）、`'…'` / `"…"` / `` `…``
// 三种引号串（反斜杠转义）、以及 Python 的三引号串（`"""…"""` / `'''…'''`）。
// 与词法分析器的已知差异：字符字面量里的引号（`'a'` 在 C 里是字符不是串）会被当成串；
// 模板字符串里的 `${…}` 插值不递归判定 —— 两处都只影响"哪些出现算注释/字符串"的边界，
// 不会写坏文件（下游要么只是报数，要么在同一份区间上做整词替换）。
import type { CommentStyle } from './commentToggle.ts'

/** 文本里"不是代码"的那一类：注释或字符串（上游 `IN_COMMENTS` / `IN_STRINGS` 两档）。 */
export type NonCodeKind = 'comment' | 'string'

export interface NonCodeRange { from: number; to: number; kind: NonCodeKind }

/** 出现的位置（`line`/`character` 是 0 基的 LSP 口径，与 `LspLocation` 同层）。 */
export interface TextOccurrence {
  from: number
  to: number
  line: number
  character: number
  kind: NonCodeKind | 'code'
}

/** 标识符字符：ASCII 字母数字与 `_`/`$`，以及非 ASCII（Unicode 标识符的近似，同 usageHighlight）。 */
function isWordCharacter(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char) || char.charCodeAt(0) > 127
}

/** 三种普通引号（`'` / `"` / `` ` ``）。反引号是 JS/TS 的模板串。 */
const QUOTES = new Set(['\'', '"', '`'])
/** Python 的三引号：先于单引号判定。 */
const TRIPLES = ['"""', "'''"]

/**
 * 扫出文本里的注释与字符串区间（单趟，所以字符串里的 `//` 不会开注释、注释里的 `"` 不会开串）。
 *
 * 规则：
 *   · 未闭合的块注释/字符串一直算到文末（与词法分析器同效：文件没写完也该高亮到头）。
 *   · 三引号只在行首或前一个字符是空白/标点时才算三引号，否则 `"a" + "b"` 这类拼接不会误判。
 *   · 反斜杠转义：`\"` 不结束字符串。Python 的三引号前同样支持 `\` 转义。
 *   · `style` 为 null（没有该语言的注释标记）时只扫字符串 —— 纯文本文件也还能报字符串里的出现。
 */
export function nonCodeRanges(text: string, style: CommentStyle | null = null): NonCodeRange[] {
  const ranges: NonCodeRange[] = []
  const line = style?.line
  const block = style?.block
  let at = 0
  while (at < text.length) {
    if (line && text.startsWith(line, at)) {
      const end = text.indexOf('\n', at)
      ranges.push({ from: at, to: end < 0 ? text.length : end, kind: 'comment' })
      at = end < 0 ? text.length : end + 1
      continue
    }
    if (block && text.startsWith(block[0], at)) {
      const close = text.indexOf(block[1], at + block[0].length)
      const to = close < 0 ? text.length : close + block[1].length
      ranges.push({ from: at, to, kind: 'comment' })
      at = to
      continue
    }
    const triple = TRIPLES.find(quote => text.startsWith(quote, at) && isTripleStart(text, at))
    if (triple) {
      const from = at
      let cursor = at + triple.length
      let closed = false
      while (cursor < text.length) {
        if (text[cursor] === '\\') { cursor += 2; continue }
        if (text.startsWith(triple, cursor)) { cursor += triple.length; closed = true; break }
        ++cursor
      }
      const to = closed ? cursor : text.length
      ranges.push({ from, to, kind: 'string' })
      at = to
      continue
    }
    const quote = text[at]!
    if (QUOTES.has(quote)) {
      const from = at
      let cursor = at + 1
      let closed = false
      while (cursor < text.length) {
        const char = text[cursor]!
        if (char === '\\') { cursor += 2; continue }
        // 普通的单双引号串不能跨行（模板串可以跨行，所以只对 ` 与 Python 之外的单双引号生效）。
        if (char === '\n' && quote !== '`') break
        if (char === quote) { ++cursor; closed = true; break }
        ++cursor
      }
      const to = closed ? cursor : Math.min(cursor, text.length)
      ranges.push({ from, to, kind: 'string' })
      at = Math.max(to, from + 1)
      continue
    }
    ++at
  }
  return ranges
}

/** 三引号只在词边界上成立（`"""` 前面是标识符字符时那是空串 + 引号拼接）。 */
function isTripleStart(text: string, at: number): boolean {
  if (at === 0) return true
  return !isWordCharacter(text[at - 1]!)
}

/** 偏移 → 0 基行列（与 `LspLocation` 同口径；只算到 `at` 之前的换行数）。 */
function positionOf(text: string, at: number): { line: number; character: number } {
  let line = 0
  let lineStart = 0
  for (let index = 0; index < at; ++index) {
    if (text[index] === '\n') { ++line; lineStart = index + 1 }
  }
  return { line, character: at - lineStart }
}

/** `at` 落在哪个区间里（区间不重叠，按起点线性扫；空 ranges 直接返回 null）。 */
function rangeAt(ranges: readonly NonCodeRange[], at: number): NonCodeKind | null {
  for (const range of ranges) {
    if (range.from > at) break
    if (at < range.to) return range.kind
  }
  return null
}

/** 一个位置算注释、算字符串、还是算代码（上游 `UsageSearchContext` 的三档判定入口）。 */
export function occurrenceKind(text: string, at: number, style: CommentStyle | null = null): NonCodeKind | 'code' {
  return rangeAt(nonCodeRanges(text, style), at) ?? 'code'
}

export interface OccurrenceOptions {
  /** 只看注释（`IN_COMMENTS`）／只看字符串（`IN_STRINGS`）；缺省两类都要。 */
  kind?: NonCodeKind
  /** 大小写不敏感（默认敏感，与上游 `WordsScanner` 的默认一致）。 */
  caseSensitive?: boolean
  /** 词边界：默认要求（`foo` 不匹配 `foobar`）。 */
  wholeWord?: boolean
  /** 上限（防超长文件一次报几万处）；达到即停。 */
  limit?: number
}

const DEFAULT_LIMIT = 2000

/**
 * 文本里 `word` 的出现（按位置升序，每条带分类）。
 * 上游那条链是 `LowLevelSearchUtil.processElementsAtOffsets` + `WordsScanner`（词边界）+
 * `PsiUtilCore`/`UsageSearchContext`（分类）；本仓合成一个纯文本扫描。
 */
export function occurrencesOf(text: string, word: string, style: CommentStyle | null = null, options: OccurrenceOptions = {}): TextOccurrence[] {
  if (!word) return []
  const wholeWord = options.wholeWord !== false
  const caseSensitive = options.caseSensitive !== false
  const limit = options.limit ?? DEFAULT_LIMIT
  const ranges = nonCodeRanges(text, style)
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? word : word.toLowerCase()
  const out: TextOccurrence[] = []
  let at = haystack.indexOf(needle)
  while (at >= 0 && out.length < limit) {
    const to = at + word.length
    const before = at > 0 ? text[at - 1]! : ''
    const after = to < text.length ? text[to]! : ''
    const boundaryOk = !wholeWord || ((!before || !isWordCharacter(before)) && (!after || !isWordCharacter(after)))
    if (boundaryOk) {
      const kind = rangeAt(ranges, at) ?? 'code'
      if (!options.kind || kind === options.kind)
        out.push({ from: at, to, ...positionOf(text, at), kind })
    }
    at = haystack.indexOf(needle, at + 1)
  }
  return out
}

/** 只要注释/字符串里的出现（`SafeDeleteProcessor.addNonCodeUsages` 的 `searchInCommentsAndStrings` 档）。 */
export function nonCodeUsages(text: string, word: string, style: CommentStyle | null = null, options: OccurrenceOptions = {}): TextOccurrence[] {
  return occurrencesOf(text, word, style, options).filter(occurrence => occurrence.kind !== 'code')
}

/** 只要代码里的出现（`UsageSearchContext.IN_CODE` 那一档）。 */
export function codeUsages(text: string, word: string, style: CommentStyle | null = null, options: OccurrenceOptions = {}): TextOccurrence[] {
  return occurrencesOf(text, word, style, options).filter(occurrence => occurrence.kind === 'code')
}

/** 一个文件里的非代码用法账（去重后按位置升序，天然有序）。 */
export interface NonCodeReport {
  /** 注释里的出现数。 */
  comments: number
  /** 字符串里的出现数。 */
  strings: number
  /** 合计（注释 + 字符串）。 */
  usages: number
  /** 出现在几个文件里（跨文件聚合时用）。 */
  files: number
  /** 逐条明细（给用法树用；跨文件聚合时带上路径）。 */
  occurrences: (TextOccurrence & { path?: string })[]
  /** 扫描被上限截断（上游的 `TextOccurrencesUtil` 也有长度控制；截断必须如实报，不能当全量）。 */
  truncated: boolean
}

export interface FileText { path: string; text: string; style?: CommentStyle | null }

/**
 * 跨文件聚一份非代码用法账。`limit` 是**全局**上限（分到每个文件头上会算错总数），
 * 所以逐文件跑并累计，达到上限即停并标 `truncated`。
 * 上游的对应物是 `SafeDeleteProcessor.findUsages` → `UsageViewUtil.removeDuplicatedUsages`
 * （`SafeDeleteProcessor.java:163`）—— 位置去重由 `TextOccurrence` 的 `from`/`path` 承担。
 */
export function nonCodeReport(files: readonly FileText[], word: string, limit = DEFAULT_LIMIT): NonCodeReport {
  const occurrences: (TextOccurrence & { path?: string })[] = []
  const paths = new Set<string>()
  let comments = 0
  let strings = 0
  let truncated = false
  for (const file of files) {
    if (occurrences.length >= limit) { truncated = true; break }
    const remaining = limit - occurrences.length
    const found = nonCodeUsages(file.text, word, file.style ?? null, { limit: remaining })
    if (found.length >= remaining) truncated = true
    for (const occurrence of found) {
      occurrences.push({ ...occurrence, path: file.path })
      if (occurrence.kind === 'comment') ++comments
      else ++strings
      paths.add(file.path)
    }
  }
  return { comments, strings, usages: comments + strings, files: paths.size, occurrences, truncated }
}

/** 分类的中文标签（给对话框/用法树的分组标题印）。 */
export const NON_CODE_KIND_LABELS: Record<NonCodeKind, string> = { comment: '注释', string: '字符串' }

/** 分组后的行（按上游的分类顺序：先注释后字符串；同组内按文件→位置）。 */
export interface NonCodeGroup { kind: NonCodeKind; label: string; occurrences: (TextOccurrence & { path?: string })[] }

export function groupNonCodeUsages(report: NonCodeReport): NonCodeGroup[] {
  const groups: NonCodeGroup[] = []
  for (const kind of ['comment', 'string'] as const) {
    const occurrences = report.occurrences.filter(occurrence => occurrence.kind === kind)
      .sort((left, right) => (left.path ?? '').localeCompare(right.path ?? '') || left.from - right.from)
    if (occurrences.length) groups.push({ kind, label: NON_CODE_KIND_LABELS[kind], occurrences })
  }
  return groups
}

/**
 * 有非代码用法时的提示语（`SafeDeleteDialog` 那两个勾选框的可见后果）。
 * 没有就返回空串（不打扰用户，与 `safeDeleteNotice` 的约定一致）。
 */
export function nonCodeUsageNotice(name: string, report: NonCodeReport): string {
  if (report.usages <= 0) return ''
  const parts: string[] = []
  if (report.comments) parts.push(`注释 ${report.comments} 处`)
  if (report.strings) parts.push(`字符串 ${report.strings} 处`)
  const suffix = report.truncated ? '（扫描已达上限，这不是全部）' : ''
  return `「${name}」在 ${report.files} 个文件的${parts.join('、')}里还有字面出现${suffix}：` +
    '这些是非代码引用，删除后不会编译报错，但文档与文案会留下旧名字。'
}
