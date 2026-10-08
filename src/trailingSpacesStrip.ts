// 行尾空白清理的 **filter 层 / 档位换算 / `.editorconfig` provider** —— 上游四处契约在本仓的等价物。
//
// 执行体（逐行扫描、倒序删除、末行换行）在 `src/editorSaveTransforms.ts`；本文件补它没有的四件：
//
//   1. filter 链的合成与三种短路（`StripTrailingSpacesUtil.java:27-45`、`:112-121`）：
//      NOT_ALLOWED 整篇否决 / POSTPONED 稍后重试 / ENFORCED_REMOVAL 作废其余 filter；
//      `getMaxSpacesToLeave` 的「第一个 Smart filter 说了算、普通 filter 能否决」顺序判据。
//   2. `SmartStripTrailingSpacesFilter` 的唯一实现 `KeepTrailingSpacesOnEmptyLinesFilter`
//      （`platform/lang-impl/src/com/intellij/psi/codeStyle/KeepTrailingSpacesOnEmptyLinesFilterFactory.java:23-90`）：
//      空白行按**上下文非空行的缩进**保留若干个字符；没有非空邻居 ⇒ `-1`（整行不动）。
//   3. `TrailingSpacesStripper.clearLineModificationFlags`（`:139-173`）里「哪些光标行要留」的判据：
//      只在「只清改动行 + 要清 + 非虚拟空格」时收集光标行，落盘后清脏标记时把它们排除。
//   4. `.editorconfig` provider 的**五个字段**（`plugins/editorconfig/backend/src/configmanagement/
//      EditorConfigTrailingSpacesOptionsProvider.kt:27-45`）：`editorSaveTransforms.ts` 只落了
//      `stripTrailingSpaces` 与 `ensureNewLineAtEof` 两个；另三个（`changedLinesOnly` 的取反式、
//      `removeTrailingBlankLines` 恒 null、`keepTrailingSpacesOnCaretLine` 恒 null）在这里补齐。
//
// 触发时机（保存前 / 显式 Save All / 全文档），三个入口都指到同一个执行体 `strip`：
//   · 保存：`TrailingSpacesStripper.beforeDocumentSaving`（`:61-63`）与 `beforeAllDocumentsSaving`（`:52-58`）；
//   · 显式 Save All：`SaveAllAction.actionPerformed`（`platform/platform-impl/src/com/intellij/ide/actions/
//     SaveAllAction.kt:22`）在 `saveAllDocuments()` **之前**调 `stripSpacesFromCaretLines`（同文件 `:37-42`），
//     而那一支只在 `isStripTrailingSpaces && !isKeepTrailingSpacesOnCaretLine` 时才 strip —— 与保存路径
//     的区别是它**强制** `skipCaretLines = false`（`:41` 第三个实参），即显式 Save All 不受「光标挡路」保护。
//   · 「全文档」不是另一个入口：它是 `isChangedLinesOnly = false`（`Whole` 档，`:387-391`）走出来的；
//     `DocumentImpl.stripTrailingSpaces(project)` 那两个重载（`DocumentImpl.java:468-477`）标着 `@TestOnly`，
//     只有测试用，不算生产触发点。
//   键入时**没有**这条 pass：上游键入路径（`EditorRawTypedHandler.kt` / `DefaultRawTypedHandler.java`）
//   与 `EditorImpl.java` 都不引用 `TrailingSpacesStripper`（grep 零命中），行尾空白是保存期的纪律。

import {
  STRIP_TRAILING_SPACES_CHANGED, STRIP_TRAILING_SPACES_NONE, STRIP_TRAILING_SPACES_WHOLE,
  editorConfigSaveOverrides, lineAtOffset, lineRanges, saveTrimOptionsFromSettings, stripTrailingSpaces,
  type SaveTrimOptions, type SaveTrimSettings, type StripTrailingSpacesMode,
} from './editorSaveTransforms.ts'

export { STRIP_TRAILING_SPACES_CHANGED, STRIP_TRAILING_SPACES_NONE, STRIP_TRAILING_SPACES_WHOLE }
export type { StripTrailingSpacesMode }

// ---------------------------------------------------------------- A. 三档与它们的两个布尔

/**
 * 三档 → `TrailingSpacesOptions` 的那两个布尔（`TrailingSpacesStripper.java:367-391` 的两个回落分支）：
 *   · `isStripTrailingSpaces()` = 不是 `None`（`:368-372`）；
 *   · `isChangedLinesOnly()` = 不是 `Whole`（`:387-391`）—— 注意 **`None` 也是 true**，
 *     即「一档都不清」与「只清改动行」在这一格上同为 true，靠前一个布尔区分。
 */
export function trailingSpacesOptionsFromMode(mode: StripTrailingSpacesMode): {
  stripTrailingSpaces: boolean
  changedLinesOnly: boolean
} {
  return {
    stripTrailingSpaces: mode !== STRIP_TRAILING_SPACES_NONE,
    changedLinesOnly: mode !== STRIP_TRAILING_SPACES_WHOLE,
  }
}

/** `.editorconfig` 的 `trim_trailing_whitespace` 折算成三档；`null` = 这个键没解出（回落 IDE 设置）。 */
export function modeFromTrimOverride(trim: boolean | undefined): StripTrailingSpacesMode | null {
  if (trim === true) return STRIP_TRAILING_SPACES_WHOLE
  if (trim === false) return STRIP_TRAILING_SPACES_NONE
  return null
}

// ---------------------------------------------------------------- B. filter 链

/**
 * 一条 filter 的等价物。上游三种预定义 filter（`StripTrailingSpacesFilter.java:29,40,50,61`）
 * 加两种用户实现（普通 / Smart）。
 */
export type StripFilter =
  | { kind: 'not-allowed' }                                        // :29
  | { kind: 'postponed' }                                          // :40
  | { kind: 'enforced-removal' }                                   // :61
  | { kind: 'normal', stripSpacesAllowedForLine: (line: number) => boolean }
  | { kind: 'smart', trailingSpacesToLeave: (line: number) => number }

/** filter 链的合成结果，逐字段对齐 `StripTrailingSpacesUtil.stripTrailingSpaces` 的入参。 */
export interface StripFilterChain {
  /** 出现 `ENFORCED_REMOVAL` ⇒ 其余 filter 作废，每行都留 0 个（`:35-38`）。 */
  enforcedRemoval: boolean
  /** `NOT_ALLOWED` ⇒ 整篇不动（`:43-45`）。 */
  strippingNotAllowed: boolean
  /** `POSTPONED` ⇒ 此刻不能清、稍后重试（`:40-45`）。 */
  postponed: boolean
  /** 每行保留几个行尾空白；`-1` = 这行完全不动（`SmartStripTrailingSpacesFilter.java:21-33`）。 */
  trailingSpacesToLeave: (line: number) => number
}

/**
 * `StripTrailingSpacesUtil.java:27-45` 的收集循环 + `:112-121` 的 `getMaxSpacesToLeave`。
 *
 * 收集顺序照抄：第一个出现的 `NOT_ALLOWED` / `POSTPONED` 成为 `specialFilter`（`:32-34`）；
 * 一旦出现 `ENFORCED_REMOVAL` 就**清空已收集的 filter 并跳出**（`:35-38`）；
 * 其余进 `filters`（`:39-41`）。`specialFilter` 非空时直接返回（`:43-45`）。
 */
export function stripFilterChain(filters: readonly StripFilter[]): StripFilterChain {
  const kept: StripFilter[] = []
  let special: 'not-allowed' | 'postponed' | null = null
  let enforced = false
  for (const filter of filters) {
    if (special === null && (filter.kind === 'not-allowed' || filter.kind === 'postponed')) {
      special = filter.kind
    }
    else if (filter.kind === 'enforced-removal') {
      special = null
      kept.length = 0
      enforced = true
      break
    }
    else {
      kept.push(filter)
    }
  }
  if (enforced) {
    return { enforcedRemoval: true, strippingNotAllowed: false, postponed: false, trailingSpacesToLeave: () => 0 }
  }
  if (special !== null) {
    return {
      enforcedRemoval: false,
      strippingNotAllowed: special === 'not-allowed',
      postponed: special === 'postponed',
      trailingSpacesToLeave: () => -1,
    }
  }
  return {
    enforcedRemoval: false,
    strippingNotAllowed: false,
    postponed: false,
    // :112-121 逐字：按收集顺序走，第一个 Smart 直接定数；普通 filter 否决 ⇒ -1；都没说 ⇒ 0。
    trailingSpacesToLeave: (line: number) => {
      for (const filter of kept) {
        if (filter.kind === 'smart') return filter.trailingSpacesToLeave(line)
        if (filter.kind === 'normal' && !filter.stripSpacesAllowedForLine(line)) return -1
      }
      return 0
    },
  }
}

/**
 * 宿主会注册哪几条 filter。本仓能兑现的只有两处：
 *   · `.editorconfig` 的 `ENFORCED_REMOVAL`（`EditorConfigTrailingSpacesFilterFactory.java:32-33`）；
 *   · 空白行缩进保留（`KeepTrailingSpacesOnEmptyLinesFilterFactory.java:93-99`）—— 装它的条件是
 *     `IndentOptions.KEEP_INDENTS_ON_EMPTY_LINES`（`CommonCodeStyleSettings.java:1047`，默认 **false**）。
 * 五家 PSI 侧 filter 依赖词法档，本仓没有 PSI 引擎，不在这里伪造（见报告「无法核实」）。
 */
export function documentStripFilters(input: {
  document?: StripDocumentLike | null
  keepIndentsOnEmptyLines?: boolean
  enforcedRemoval?: boolean
}): StripFilter[] {
  if (input.enforcedRemoval) return [{ kind: 'enforced-removal' }]
  if (input.keepIndentsOnEmptyLines && input.document) {
    return [{ kind: 'smart', trailingSpacesToLeave: keepTrailingSpacesOnEmptyLinesFilter(input.document) }]
  }
  return [{ kind: 'normal', stripSpacesAllowedForLine: () => true }]   // ALL_LINES（:50-55）
}

// ---------------------------------------------------------------- C. Smart filter 本体

/**
 * `KeepTrailingSpacesOnEmptyLinesFilterFactory.java:30-35` 的 `getTrailingSpacesToLeave`：
 * 空白行返回 `getMaxIndentChars(line)`，非空白行返回 0。
 * `getMaxIndentChars`（`:47-58`）取**上下最近两个非空行缩进的较大者**；一个都没有 ⇒ `-1`。
 */
export function keepTrailingSpacesOnEmptyLinesFilter(document: StripDocumentLike): (line: number) => number {
  return (line: number) => {
    const start = document.getLineStartOffset(line)
    const end = document.getLineEndOffset(line)
    if (!containsWhitespacesOnly(document.text, start, end)) return 0
    return maxIndentChars(document, line)
  }
}

/** `containsWhitespacesOnly`（`:38-45`）：只认四个空白字符，其余一律非空。 */
function containsWhitespacesOnly(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; ++i) {
    const char = text[i]
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') continue
    return false
  }
  return true
}

/** `getMaxIndentChars`（`:47-58`）：两个方向各找一个非空行，取缩进列数的最大值。 */
function maxIndentChars(document: StripDocumentLike, line: number): number {
  let count = -1
  const before = nonEmptyLineBefore(document, line)
  if (before >= 0) count = countIndentCharsAt(document, before)
  const after = nonEmptyLineAfter(document, line)
  if (after >= 0) count = Math.max(count, countIndentCharsAt(document, after))
  return count
}

/** `getNonEmptyLineBefore`（`:60-68`）。 */
function nonEmptyLineBefore(document: StripDocumentLike, line: number): number {
  for (let candidate = line - 1; candidate >= 0; --candidate) {
    if (!containsWhitespacesOnly(document.text, document.getLineStartOffset(candidate), document.getLineEndOffset(candidate))) {
      return candidate
    }
  }
  return -1
}

/** `getNonEmptyLineAfter`（`:70-78`）。 */
function nonEmptyLineAfter(document: StripDocumentLike, line: number): number {
  for (let candidate = line + 1; candidate < document.lineCount; ++candidate) {
    if (!containsWhitespacesOnly(document.text, document.getLineStartOffset(candidate), document.getLineEndOffset(candidate))) {
      return candidate
    }
  }
  return -1
}

/**
 * `countIndentCharsAt`（`:80-89`）：从行首数空格与制表符，遇到别的字符就停。
 * 上游的循环边界是 `getTextLength()` 而不是行尾 —— 行尾换行符天然会 break，结果相同，这里照抄边界。
 */
function countIndentCharsAt(document: StripDocumentLike, line: number): number {
  let count = 0
  for (let offset = document.getLineStartOffset(line); offset < document.textLength; ++offset) {
    const char = document.text[offset]
    if (char !== ' ' && char !== '\t') break
    ++count
  }
  return count
}

// ---------------------------------------------------------------- D. 光标行判据

/**
 * 文档的只读投影。上游用 `DocumentImpl` 的逐行脏标记与偏移换算；本仓没有文档对象，
 * 由 `documentFromText` 从纯文本造一个（行分隔符不算进行内容，与 `src/editorConfig.ts` 同源）。
 */
export interface StripDocumentLike {
  readonly text: string
  readonly lineCount: number
  readonly textLength: number
  getLineStartOffset(line: number): number
  getLineEndOffset(line: number): number
  getLineNumber(offset: number): number
  /** 上游 `DocumentImpl.isLineModified`（`DocumentImpl.java:210-212`）。 */
  isLineModified(line: number): boolean
}

/** 从纯文本造一份投影；`changedLines` 就是本仓的「逐行脏标记」承接物（缺省 = 一行都没改）。 */
export function documentFromText(text: string, changedLines?: Iterable<number>): StripDocumentLike {
  const ranges = lineRanges(text)
  const modified = new Set<number>(changedLines ?? [])
  return {
    text,
    lineCount: ranges.length,
    textLength: text.length,
    getLineStartOffset: (line: number) => ranges[clamp(line, ranges.length)]!.start,
    getLineEndOffset: (line: number) => ranges[clamp(line, ranges.length)]!.end,
    getLineNumber: (offset: number) => lineAtOffset(ranges, offset),
    isLineModified: (line: number) => modified.has(line),
  }
}

function clamp(line: number, count: number): number {
  if (line < 0) return 0
  return line >= count ? count - 1 : line
}

/** `clearLineModificationFlags` 的结果：哪些行落盘后仍算脏、哪些光标行要留。 */
export interface CaretLineJudgment {
  /** 上游清完脏标记后仍为脏的行 = 改动行去掉光标行。 */
  stripLines: number[]
  /** 被光标挡住、这次不清的行（`:162-172`）。 */
  caretLines: number[]
}

/**
 * `TrailingSpacesStripper.java:139-173`：`clearLineModificationFlags` 在落盘后清掉逐行脏标记，
 * **除了**「虚拟空格关闭时」光标所在的行 —— 那几行没被清干净，下次保存要接着清。
 *
 * 前置门在 `:152-159`：只有 `isChangedLinesOnly() && isStripTrailingSpaces()` 且
 * `!activeEditor.getSettings().isVirtualSpace()` 时才收集光标行；虚拟空格开着时一个都不收集
 * （注释原文「when virtual space enabled, we can strip whitespace anywhere」）。
 */
export function resolveCaretLines(input: {
  document: StripDocumentLike
  caretOffsets: readonly number[]
  virtualSpace: boolean
}): CaretLineJudgment {
  const stripLines: number[] = []
  for (let line = 0; line < input.document.lineCount; ++line) {
    if (input.document.isLineModified(line)) stripLines.push(line)
  }
  const caretLines: number[] = []
  if (input.virtualSpace) return { stripLines, caretLines }
  const seen = new Set<number>()
  for (const offset of input.caretOffsets) {
    const line = input.document.getLineNumber(offset)
    if (seen.has(line)) continue
    seen.add(line)
    caretLines.push(line)
  }
  return { stripLines: stripLines.filter(line => !seen.has(line)), caretLines }
}

// ---------------------------------------------------------------- E. .editorconfig provider 的五个字段

/** `EditorConfigTrailingSpacesOptionsProvider.FileOptions`（`:25-46`）的五个字段 + 折算出的三档。 */
export interface TrailingSpacesFileOverride {
  /** `getStripTrailingSpaces()`（`:27-29`）：`trim_trailing_whitespace` 原值。 */
  stripTrailingSpaces: boolean | undefined
  /** `getChangedLinesOnly()`（`:39-41`）：`trim = true` ⇒ 整文件清（false）；`trim = false` ⇒ true。 */
  changedLinesOnly: boolean | undefined
  /** `getEnsureNewLineAtEOF()`（`:31-33`）：`insert_final_newline` 原值。 */
  ensureNewLineAtEof: boolean | undefined
  /** `EditorConfigTrailingSpacesFilterFactory.java:32-33`：`trim = true` ⇒ 语言侧 filter 全部作废。 */
  enforcedRemoval: boolean
  /** 折算出的三档；`null` = `trim_trailing_whitespace` 没解出（回落 IDE 设置）。 */
  mode: StripTrailingSpacesMode | null
}

/**
 * `.editorconfig` 两个键 → provider 的五个字段。option 层复用 `editorConfigSaveOverrides`
 * （取值域只认大小写不敏感的 `true` / `false`，`EditorConfigTrailingSpacesOptionsProvider.kt:48-56`），
 * 这里再补它没落的 `removeTrailingBlankLines` / `keepTrailingSpacesOnCaretLine` 两个**恒 null** 的字段
 * （`:35-37` / `:43-45`）—— 它们在 `applyTrailingSpacesOverride` 里表现为「不覆盖，保留回落值」。
 */
export function trailingSpacesOverrideFromProperties(
  properties: Record<string, string>,
): TrailingSpacesFileOverride | null {
  const base = editorConfigSaveOverrides(properties)
  if (!base) return null
  return {
    stripTrailingSpaces: base.stripTrailingSpaces,
    changedLinesOnly: base.changedLinesOnly,
    ensureNewLineAtEof: base.ensureNewLineAtEof,
    enforcedRemoval: base.enforcedRemoval,
    mode: modeFromTrimOverride(base.stripTrailingSpaces),
  }
}

/**
 * provider 覆盖 IDE 设置：解出的字段说话，解不出的保留回落值
 * （`TrailingSpacesStripper.java:337-365` 的「先设者胜」，null 不参与覆盖）。
 * `keepTrailingSpacesOnCaretLine` / `removeTrailingBlankLines` 恒取回落值 —— provider 这两个恒 null。
 */
export function applyTrailingSpacesOverride(base: SaveTrimOptions, override: TrailingSpacesFileOverride): SaveTrimOptions {
  return {
    stripTrailingSpaces: override.stripTrailingSpaces ?? base.stripTrailingSpaces,
    changedLinesOnly: override.changedLinesOnly ?? base.changedLinesOnly,
    ensureNewLineAtEof: override.ensureNewLineAtEof ?? base.ensureNewLineAtEof,
    keepTrailingSpacesOnCaretLine: base.keepTrailingSpacesOnCaretLine,
    removeTrailingBlankLines: base.removeTrailingBlankLines,
  }
}

/** 生效档：`.editorconfig` 解出了 `trim_trailing_whitespace` 就用它折算的三档，否则用 IDE 设置那一格。 */
export function effectiveTrailingSpacesMode(
  settingsMode: StripTrailingSpacesMode,
  override: TrailingSpacesFileOverride | null,
): StripTrailingSpacesMode {
  return override?.mode ?? settingsMode
}

// ---------------------------------------------------------------- F. 合成入口

export interface TrailingSpacesSaveInput {
  text: string
  /** IDE 设置那一格的三档（`src/settingsModel.ts` 的 `stripTrailingSpaces`）。 */
  settings?: SaveTrimSettings
  /** 该文件生效的 `.editorconfig` 属性表（`src/editorConfig.ts` 的 `mergeEditorConfigs` 产物）。 */
  properties?: Record<string, string> | null
  /** 上次落盘正文 —— 「只清改动行」的基线。 */
  savedText?: string
  caretOffsets?: number[]
  /** 有它才能跑「光标行判据」（`clearLineModificationFlags`）。 */
  document?: StripDocumentLike | null
  /** 上游 `activeEditor.getSettings().isVirtualSpace()`（`TrailingSpacesStripper.java:155`）。 */
  virtualSpace?: boolean
  /** 宿主注册的 filter 链；缺省时按 `documentStripFilters` 的两条来。 */
  filters?: readonly StripFilter[]
}

export interface TrailingSpacesSaveResult {
  text: string
  /** 生效档（IDE 设置 + `.editorconfig` 覆盖合成后的那一个）。 */
  mode: StripTrailingSpacesMode
  options: SaveTrimOptions
  changed: boolean
  strippedLines: number[]
  deferredLines: number[]
  /** filter 链的短路结果，交给调用方决定要不要重试。 */
  chain: StripFilterChain
}

/**
 * 一次保存的行尾清理：**档位 → 光标行 → filter 链 → 执行体**。
 *
 * 上游这条顺序在 `TrailingSpacesStripper.strip()`（`:65-78`）与 `StripTrailingSpacesUtil`（`:21-110`）里，
 * 四段各自的门都在上面逐条注明。执行体本身（倒序删除）不在这里重写 —— 调 `stripTrailingSpaces`。
 */
export function stripTrailingSpacesForSave(input: TrailingSpacesSaveInput): TrailingSpacesSaveResult {
  const settings = input.settings ?? {}
  const override = input.properties ? trailingSpacesOverrideFromProperties(input.properties) : null
  const base = saveTrimOptionsFromSettings(settings)
  const options = override ? applyTrailingSpacesOverride(base, override) : base
  const mode = effectiveTrailingSpacesMode(settings.stripTrailingSpaces ?? STRIP_TRAILING_SPACES_CHANGED, override)
  const chain = stripFilterChain(input.filters ?? documentStripFilters({
    document: input.document ?? null,
    enforcedRemoval: override?.enforcedRemoval ?? false,
  }))

  // 光标行只在「只清改动行 + 要清 + 光标挡路要留」时才算（`:152-159` + `:229`）。
  let caretOffsets = input.caretOffsets
  const document = input.document ?? null
  if (document && options.changedLinesOnly && options.stripTrailingSpaces && options.keepTrailingSpacesOnCaretLine) {
    const judged = resolveCaretLines({
      document,
      caretOffsets: input.caretOffsets ?? [],
      virtualSpace: input.virtualSpace ?? false,
    })
    // 把光标行换成它的**行尾偏移**：执行体判「行尾空白起点 < 光标偏移」时这几行就会被延后（`:78-84`）。
    caretOffsets = judged.caretLines.map(line => document.getLineEndOffset(line))
  }

  const stripped = stripTrailingSpaces({
    text: input.text,
    changedLinesOnly: options.changedLinesOnly,
    savedText: input.savedText,
    caretOffsets: options.keepTrailingSpacesOnCaretLine ? caretOffsets : undefined,
    strippingNotAllowed: chain.strippingNotAllowed,
    enforcedRemoval: chain.enforcedRemoval,
    trailingSpacesToLeave: chain.trailingSpacesToLeave,
  })
  return {
    text: stripped.text,
    mode,
    options,
    changed: stripped.text !== input.text,
    strippedLines: stripped.strippedLines,
    deferredLines: stripped.deferredLines,
    chain,
  }
}