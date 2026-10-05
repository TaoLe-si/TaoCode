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
// 都走它）。语言服务的格式化结果（LSP TextEdit）里**落在禁用区间内的一条整个丢掉**——上游对禁用区间
// 就是"不重排"，本仓按"宁可少改、不改禁用段"的保守侧落地（跨启用/禁用边界的编辑整条放弃，不会把
// 用户手写的对齐冲掉）。

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
