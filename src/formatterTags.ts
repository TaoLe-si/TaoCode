// 格式化标记（`@formatter:off` / `@formatter:on`）—— `FormatterTagHandler` 的可移植内核。
//
// 上游逐条（`platform/code-style-impl/src/com/intellij/formatting/FormatterTagHandler.java`）：
//   · 标记名与默认值：`CodeStyleSettings.FORMATTER_ON_TAG = "@formatter:on"`、
//     `FORMATTER_OFF_TAG = "@formatter:off"`（:469-470），可被设置改成别的串（本仓把改名的口留在
//     参数里，不存设置）；
//   · `extractFormatterTag`（:32-48）：在给定区间里**先找 ON 再找 OFF**，比较用大小写不敏感的
//     `StringUtil.equalsIgnoreCase`（:50-58）；正则模式（`FORMATTER_TAGS_ACCEPT_REGEXP`）本仓不移植
//     （没有那套设置面，不发明）；
//   · `EnabledRangesCollector.processText`（:70-84）：**逐行**在行文本里找标记，标记的落点是
//     **行首**（不是标记自身的位置）；`@formatter:off` 从那一行起禁用，`@formatter:on` 从那一行起恢复；
//   · `getRanges`（:86-106）：在 `initialRange` 里切出所有"启用"的子区间；未闭合的 off 一直禁到区间末尾；
//     开头的 on 是空操作（本来就没禁用）。
//
// 两个如实说明：
//   1. `processText` 只处理**以 \n 结尾**的行（上游就是 `if (c == '\n')` 才判标记）——文件最后一行
//      没有换行符时，那一行上的标记上游也看不见；这里照抄，不"顺手修正"（修了就不是同一个口径了）。
//   2. 上游 `extractFormatterTag` 在整行文本上匹配（不对注释做词法过滤）——字符串字面量里出现
//      `@formatter:off` 同样生效。这是上游行为，本仓保持同一口径。
//
// 本仓的消费链路：`src/semanticActions.ts` 的 `runFormatting`（Ctrl+Alt+L / 保存时格式化 / 选区格式化
// 都走它）。两条口径，别混：
//   · **请求侧切分**（`enabledFormatRanges`，本文件末尾）：选区跨 `@formatter:off` 边界时把区间
//     切成仍可格式化的子区间，**每段各发一次** `rangeFormatting` —— 上游对禁用段是「从区间里挖掉、
//     其余照排」（`CodeFormatterFacade.java:232-235` + `InitialInfoBuilder.java:334`），不是整个选区不排。
//   · **响应侧兜底**（`filterFormatEdits`）：语言服务不认识这些标记，越界给出的编辑里
//     没被某个启用子区间整条包住的**整条丢掉**（宁可少改，绝不把用户手写的对齐冲掉）。
//     切分之后这条基本只剩兜底作用：子区间之间不相交，服务器守区间时给不出跨界编辑。

export type FormatterTag = 'on' | 'off' | 'none'

/** 标记名（上游 `CodeStyleSettings.FORMATTER_ON_TAG` / `FORMATTER_OFF_TAG` 的默认值）。 */
export const FORMATTER_ON_TAG = '@formatter:on'
export const FORMATTER_OFF_TAG = '@formatter:off'

export interface FormatterTagOptions {
  onTag?: string
  offTag?: string
}

export interface TextRangeOffsets {
  start: number
  end: number
}

/** `isFormatterTagAt`（:50-58）：首字符先比、再整串大小写不敏感比较。 */
function isFormatterTagAt(text: string, position: number, tagName: string): boolean {
  if (!tagName.length || position + tagName.length > text.length) return false
  if (tagName[0] !== text[position]) return false
  return text.slice(position, position + tagName.length).toLowerCase() === tagName.toLowerCase()
}

/** `extractFormatterTag`（:32-48）：ON 优先于 OFF（上游先查 onPattern 再看 offPattern）。 */
export function extractFormatterTag(text: string, startOffset: number, endOffset: number, options: FormatterTagOptions = {}): FormatterTag {
  const onTag = options.onTag ?? FORMATTER_ON_TAG
  const offTag = options.offTag ?? FORMATTER_OFF_TAG
  const from = Math.max(0, startOffset)
  const to = Math.min(text.length, endOffset)
  for (let position = from; position < to; position += 1) {
    if (isFormatterTagAt(text, position, onTag)) return 'on'
    if (isFormatterTagAt(text, position, offTag)) return 'off'
  }
  return 'none'
}

/** 这一行上有没有格式化标记（`getFormatterTag(PsiComment)` 的行级等价物）。 */
export function formatterTagOfLine(line: string, options: FormatterTagOptions = {}): FormatterTag {
  return extractFormatterTag(line, 0, line.length, options)
}

/**
 * `getEnabledRanges`（:60-68）/ `EnabledRangesCollector`（:70-106）：
 * 在 `initialRange` 内返回仍可格式化的区间。没有标记时返回原区间本身（上游 `!FORMATTER_TAGS_ENABLED`
 * 的快路径；默认 `FORMATTER_TAGS_ENABLED = true`，有标记才起作用，等价于同一结果）。
 */
export function enabledRanges(text: string, initialRange: TextRangeOffsets, options: FormatterTagOptions = {}): TextRangeOffsets[] {
  const start0 = Math.max(0, initialRange.start)
  const end0 = Math.min(text.length, initialRange.end)
  if (end0 <= start0) return []
  const tags: { offset: number; tag: 'on' | 'off' }[] = []
  let lineStart = 0
  for (let position = 0; position < text.length; position += 1) {
    if (text[position] !== '\n') continue
    const tag = extractFormatterTag(text, lineStart, position, options)
    if (tag === 'off') tags.push({ offset: lineStart, tag: 'off' })
    else if (tag === 'on') tags.push({ offset: lineStart, tag: 'on' })
    lineStart = position + 1
  }
  tags.sort((left, right) => left.offset - right.offset)

  const ranges: TextRangeOffsets[] = []
  let start = start0
  let enabled = true
  for (const info of tags) {
    if (info.tag === 'off' && enabled) {
      if (info.offset > start) ranges.push({ start, end: Math.min(info.offset, end0) })
      enabled = false
    } else if (info.tag === 'on' && !enabled) {
      start = Math.max(info.offset, start0)
      if (start >= end0) break
      enabled = true
    }
  }
  if (start < end0 && enabled) ranges.push({ start, end: end0 })
  return ranges.filter(range => range.end > range.start)
}

/** 文件里出现过任一标记（没有标记时调用方可以完全跳过过滤，保持既有行为）。 */
export function hasFormatterTags(text: string, options: FormatterTagOptions = {}): boolean {
  const onTag = options.onTag ?? FORMATTER_ON_TAG
  const offTag = options.offTag ?? FORMATTER_OFF_TAG
  const lower = text.toLowerCase()
  return lower.includes(onTag.toLowerCase()) || lower.includes(offTag.toLowerCase())
}

/** LSP 位置（行/字符，UTF-16 偏移）→ 文本偏移。越界钳到文本两端。 */
export function offsetAt(text: string, line: number, character: number): number {
  let offset = 0
  let current = 0
  while (current < line && offset < text.length) {
    const next = text.indexOf('\n', offset)
    if (next < 0) { offset = text.length; break }
    offset = next + 1
    current += 1
  }
  return Math.min(text.length, Math.max(0, offset) + Math.max(0, character))
}

export interface LineColumnEdit {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

/**
 * 把落在禁用区间内的编辑整个丢掉（上游对禁用区间不重排；跨边界的编辑按保守侧整条放弃）。
 * 文件里没有标记时返回原数组的副本，调用方可以据此走零开销路径。
 */
export function filterFormatEdits<T extends LineColumnEdit>(text: string, edits: readonly T[], options: FormatterTagOptions = {}): T[] {
  if (!edits.length || !hasFormatterTags(text, options)) return [...edits]
  const enabled = enabledRanges(text, { start: 0, end: text.length }, options)
  const covered = (range: TextRangeOffsets) => enabled.some(item => item.start <= range.start && item.end >= range.end)
  return edits.filter(edit => {
    const start = offsetAt(text, edit.startLine, edit.startChar)
    const end = Math.max(start, offsetAt(text, edit.endLine, edit.endChar))
    return covered({ start, end })
  })
}

/* ── 请求侧的区间切分（csi/formatter ③：切分而不是放弃跨界的那条编辑）────────────── */

/** LSP 的区间形状（与 `bridge.ts:162` 的 `LspRange` 同形；本模块不 import bridge，保持纯函数）。 */
export interface FormatPoint { line: number; character: number }
export interface FormatRange { start: FormatPoint; end: FormatPoint }

/**
 * 文本偏移 → LSP 的（行, 字符），`offsetAt` 的反向换算。
 * 行 0 基；只按 `\n` 分行（`\r\n` 里的 `\r` 归前一行的内容）—— 与 `offsetAt` 同一个口径，
 * 两者互逆：`offsetAt(text, ...lineColumnAt(text, offset)) === clamp(offset)`。
 */
export function lineColumnAt(text: string, offset: number): FormatPoint {
  const clamped = Math.max(0, Math.min(text.length, offset))
  let line = 0
  let lineStart = 0
  for (let index = 0; index < clamped; ++index) {
    if (text[index] !== '\n') continue
    line += 1
    lineStart = index + 1
  }
  return { line, character: clamped - lineStart }
}

/**
 * 把「要格式化的区间」按 `@formatter:off` 切成**仍可格式化**的子区间（位置升序）。
 *
 * 上游依据（本仓旧注释引错了地方，留痕订正）：切分不在 `AdjustFormatRangesState.java`
 * —— 那个类走的是 `Block`/`ExtraRangesProvider` 的 PSI 块模型
 * （`platform/code-style-impl/src/com/intellij/formatting/AdjustFormatRangesState.java:36-60`）。
 * 真正让禁用段不参与重排的是这两处：
 *   · `CodeFormatterFacade.setDisabledRanges`（`platform/code-style-impl/src/com/intellij/psi/impl/source/codeStyle/CodeFormatterFacade.java:232-235`）
 *     —— 拿 `FormatterTagHandler.getEnabledRanges(file.getNode(), file.getTextRange())`，
 *     用 `TextRangeUtil.excludeRanges` 把「整文件减去启用段」记成禁用区间（`:109`、`:197` 各调一次）；
 *   · `InitialInfoBuilder.isInDisabledRange`（`platform/code-style-impl/src/com/intellij/formatting/InitialInfoBuilder.java:334`）
 *     —— 命中禁用段的空白**跳过处理**，区间里其余部分照常重排。
 * 净效果：跨 `@formatter:off` 边界的选区，**能排的那半照样排**，不是整条编辑一起丢。
 *
 * 本仓没有本地格式化模型，重排由语言服务做 ⇒ 同一件事只能在**请求侧**做：把区间切开、
 * 每段各发一次 `textDocument/rangeFormatting`（`src/semanticActions.ts` 的 `requestFormatting`）。
 * 三条边界口径：
 *   · 文件里没有标记 → 原样返回 `[range]`（调用方走单次请求那条旧路径，零额外往返）；
 *   · 整段都在禁用区里 → 返回 `[]`（一条请求都不发）；
 *   · 子区间的端点落在标记**所在行的行首**（沿用 `enabledRanges` 的 `EnabledRangesCollector` 口径，
 *     `FormatterTagHandler.java:70-84`），不会把 `// @formatter:off` 那一行排进去。
 */
export function enabledFormatRanges(text: string, range: FormatRange, options: FormatterTagOptions = {}): FormatRange[] {
  if (!hasFormatterTags(text, options)) return [range]
  const start = offsetAt(text, range.start.line, range.start.character)
  const end = Math.max(start, offsetAt(text, range.end.line, range.end.character))
  return enabledRanges(text, { start, end }, options)
    .map(part => ({ start: lineColumnAt(text, part.start), end: lineColumnAt(text, part.end) }))
}

/** 一条格式化编辑（`bridge.ts:132` 的 `LspTextEdit` 用得上的那部分）。 */
export interface FormatEdit extends LineColumnEdit { text: string }

/** 两条编辑是否真的重叠（端部相接不算 —— LSP 允许 `[a,b)` `[b,c)` 这种相邻编辑）。 */
function editsOverlap(a: FormatEdit, b: FormatEdit): boolean {
  const aBeforeB = a.endLine < b.startLine || (a.endLine === b.startLine && a.endChar <= b.startChar)
  const bBeforeA = b.endLine < a.startLine || (b.endLine === a.startLine && b.endChar <= a.startChar)
  return !aBeforeB && !bBeforeA
}

/**
 * 把多段 `rangeFormatting` 的响应并成一份（`enabledFormatRanges` 切出几段就有几份）。
 *   · 文件次序 = 首次出现的次序，段内编辑按段的位置升序 append ⇒ 合起来就是偏移升序；
 *   · **完全相同**的编辑只留一条（相邻两段各报同一条时，套第二遍就是把同一段文本再写一次）；
 *   · 跨段**重叠**的编辑丢掉后到的那条并计入 `dropped`（子区间本不相交，真出现就是服务器越界；
 *     `applyTextEdits` 是倒序套用，重叠会写坏文本 ⇒ 宁可少排一段）。
 */
export function mergeFormatParts<Edit extends FormatEdit>(
  parts: readonly { available: boolean; edits?: readonly { path: string; textEdits: readonly Edit[] }[] }[],
): { available: boolean; edits: { path: string; textEdits: Edit[] }[]; dropped: number } {
  const byPath = new Map<string, Edit[]>()
  const keys = new Map<string, Set<string>>()
  let available = false
  let dropped = 0
  for (const part of parts) {
    if (part.available) available = true
    for (const file of part.edits ?? []) {
      const kept = byPath.get(file.path) ?? []
      const seen = keys.get(file.path) ?? new Set<string>()
      for (const edit of file.textEdits ?? []) {
        const key = `${edit.startLine}:${edit.startChar}:${edit.endLine}:${edit.endChar}\u0000${edit.text}`
        if (seen.has(key)) { ++dropped; continue }
        if (kept.some(item => editsOverlap(item, edit))) { ++dropped; continue }
        seen.add(key)
        kept.push(edit)
      }
      byPath.set(file.path, kept)
      keys.set(file.path, seen)
    }
  }
  const edits = [...byPath].filter(([, textEdits]) => textEdits.length)
    .map(([path, textEdits]) => ({ path, textEdits }))
  return { available, edits, dropped }
}
