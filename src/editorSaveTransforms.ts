// 保存时的两条**纯文本执行体**：去行尾空白（trim trailing whitespace）与保证末行换行
// （insert final newline）。上游这两条是同一段代码里的前后两段，本文件按同一条链照抄。
//
// ---------------------------------------------------------------- 上游落点（逐个开文件核实过）
//
// 先记一笔纠偏：任务书给的三处坐标**都不指向这条行为** ——
//   · `platform/ide-impl/src/com/intellij/openapi/editor/impl/TrimUtil.kt` 与
//     `.../ByWordRt.kt` 在本树里不存在；同名文件在 `platform/util/diff/src/com/intellij/diff/comparison/`，
//     那是 **diff 的按词切分与上下文裁剪**，与行尾空白无关（三条路各搜过：包路径没有、语义在
//     `TrailingSpacesStripper` / `StripTrailingSpacesUtil`、XML 里的 `id` 是
//     `editorConfigTrailingSpacesOptionsProvider`，见 `intellij.editorconfig.backend.xml:54`）。
//   · `platform/ide-impl/src/com/intellij/openapi/editor/EditorSettings.java` 同理不在那个路径；
//     真身在 `platform/editor-ui-api/src/com/intellij/openapi/editor/EditorSettings.java`（275 行），
//     而那份里**没有**任何行尾空白 / 末行换行的设置项（`grep -n "TrailingSpace|LINE_FEED|LineFeedAtEOF"` 无命中）。
//     这两条设置的宿主是 `EditorSettingsExternalizable`。
//
// 执行体（保存前的文档变换）：
//   · `platform/platform-impl/src/com/intellij/openapi/editor/impl/TrailingSpacesStripper.java`（400 行）
//     :46 类本体是 `FileDocumentManagerListener`；:61-63 `beforeDocumentSaving` → `strip(document)`；
//     :65-110 `strip()` 的三段（清行尾 → 删末段空行 → 补末行换行）；:80-109 **末行换行那一段**；
//     :112-131 `removeTrailngBlankLines`（上游原文就是这样拼错的函数名）；:285-292 按文件临时禁用；
//     :295-322 `getOptions()` 的四道门（不可写 / 没有文件 / 文件已失效 / 被临时禁用）；
//     :324-399 `MyTrailingSpacesOptions`：每个字段先取 provider，取不到才回落到 IDE 设置（:367-398）。
//   · `platform/core-impl/src/com/intellij/openapi/editor/impl/StripTrailingSpacesUtil.java`（125 行）
//     :19 批量阈值；:27-45 filter 收集与三种短路（NOT_ALLOWED / POSTPONED / ENFORCED_REMOVAL）；
//     :46-54 每行只记**最大**光标偏移；:60-90 逐行扫描；:62 只清「改动过的行」这一档；
//     :66-67 行首/行尾偏移（**行分隔符不算进行内容**）；:68-74 只认空格与制表符；
//     :78-84 光标挡路 ⇒ 这行留到下次；:85-89 按 filter 保留 N 个；:95-108 撤销透明写 + 倒序删除；
//     :112-121 `getMaxSpacesToLeave`：第一个 Smart filter 说了算，普通 filter 否决 ⇒ -1。
//   · 触发时机：`platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/FileDocumentManagerImpl.java`
//     :1214-1245 的 `multiCast` 顺序是 消息总线 → 显式 listener（Actions on Save 在这一层）→
//     **:1237 最后**才轮到 `myTrailingSpacesStripper` ⇒ 本仓的这两条 pass 必须跑在
//     `src/actionsOnSave.ts` 之后（`src/App.vue` 的 `save()` 里就是先后两行）。
//     :376-392 `saveDocumentAsIs` 会临时把这条 pass 关掉（本仓对应「本地历史回滚」那条直写链路，见 §接线）。
//
// 设置项（IDE 级默认值，宿主是 `EditorSettingsExternalizable`，**不是** `EditorSettings`）：
//   · `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java`
//     :73 `STRIP_TRAILING_SPACES = STRIP_TRAILING_SPACES_CHANGED`（默认「只清改动过的行」，**不是**关掉的）；
//     :74 `IS_ENSURE_NEWLINE_AT_EOF = false`（末行换行默认**关**）；:75 `REMOVE_TRAILING_BLANK_LINES = false`；
//     :142 `KEEP_TRAILING_SPACE_ON_CARET_LINE = true`（光标挡路时不清那一行）；
//     :216-218 三档字面值 `None` / `Changed` / `Whole`；读接口 :804-806、:815-817、:826-829、:1144-1146。
//
// `.editorconfig` 的覆盖（本仓已经解析过这两个键，缺的就是这里）：
//   · `plugins/editorconfig/backend/src/configmanagement/EditorConfigTrailingSpacesOptionsProvider.kt`
//     :13-23 只有 `trim_trailing_whitespace` 或 `insert_final_newline` **至少解出一个**才返回 options；
//     :27-45 五个字段的映射 —— 注意 :39-41 `getChangedLinesOnly() = if (trim != null) !trim else null`
//     （`trim = true` ⇒ 整文件清，`trim = false` ⇒ 完全不清）；
//     :48-56 取值只认 `true` / `false`（大小写不敏感），其它写法（含 `unset`）解不出 ⇒ 回落 IDE 设置。
//   · `plugins/editorconfig/backend/src/configmanagement/EditorConfigTrailingSpacesFilterFactory.java`
//     :16-37 —— provider 说 `trim = true` 时返回 `ENFORCED_REMOVAL`，把语言侧 filter **全部作废**。
//   · `plugins/editorconfig/backend/src/Utils.kt` :249-253 `isEnabledFor`（三道前置门）+
//     :240-241 `isApplicableTo`、:243-247 `.editorconfig` **自己不吃这些键**。
//   · 注册：`intellij.editorconfig.backend.xml:54`（options provider）、`:58`（filter factory）。
//
// 语言侧 filter（上游一共注册了 7 家，本仓能兑现多少写清楚）：
//   · `platform/lang-impl/src/com/intellij/psi/codeStyle/KeepTrailingSpacesOnEmptyLinesFilterFactory.java`
//     :21 类本体、:30-35 空白行按上下文的缩进**保留**若干个、:93-99 只有 `project != null` 且
//     :102-113 `shouldKeepTrailingSpacesOnEmptyLines` 为真才装这个 filter —— 判据是
//     `IndentOptions.KEEP_INDENTS_ON_EMPTY_LINES`（`CommonCodeStyleSettings.java:1047` 默认 **false**），
//     而本仓的 `IndentOptions`（`src/codeStyleSettings.ts:42-51`）只有能兑现的四个字段、**没有**这一项
//     ⇒ 恒为 false ⇒ 上游注册在 `intellij.platform.lang.impl.xml:1546` 的这条 filter 在本仓等价于
//     「不装」。本文件仍把 filter 的接缝（`trailingSpacesToLeave` / `strippingNotAllowed`）留着，
//     键一旦落下来就是接一条实现，不用改执行体。
//   · 其余 6 家（Java / Kotlin / Groovy / YAML / Properties / Markdown）都过
//     `PsiBasedStripTrailingSpacesFilter`（PSI 词法档）或各自的设置项 —— 本仓没有 PSI 引擎，
//     **不移植**，见 §做不到。Markdown 那家实际只按 `MarkdownSettings.isStripTrailingSpacesOnSave`
//     返回 ALL_LINES / NOT_ALLOWED（`MarkdownStripTrailingSpacesFilterFactory.java:18-26`），
//     是纯粹「按文件类型整篇否决」，接缝就是 `strippingNotAllowed`。
//
// ---------------------------------------------------------------- 本仓落点与两处如实差异
//
// 1. **行分隔符模型**：本仓正文用 `\n` 或 `\r\n`（与 `src/editorConfig.ts:153` 的 `split(/\r?\n/)` 同源）。
//    行内容不含分隔符 ⇒ CRLF 文件末尾的 `\r` 不会被当成行尾空白清掉，也不会挡着清理（上游 :66-67 的
//    `getLineStartOffset` / `getLineEndOffset` 同样把分隔符排除在行内容之外）。
// 2. **「改动过的行」**：上游是文档的逐行脏标记（`StripTrailingSpacesUtil.java:62` 的 `isLineModified`，
//    落盘后由 `FileDocumentManagerImpl.java:502` 清）。本仓没有逐行脏标记，等价物是
//    **与上次落盘正文的行差异**（复用 `src/diffText.ts:103` 的 `computeLCS`，与保存冲突预览同一套对齐）。
//    差异：内容改回原样的行在上游仍算「改过」、这里不算 ⇒ 少清几行，不会多清，方向保守。
//    拿不到基线（`savedText` 缺失）时**整条 pass 不做**，不猜。
//
// ---------------------------------------------------------------- 接线
//
// 消费方：`src/editorFileOps.ts`（本域的执行入口 `applySaveTextTransforms` 从那里再导出给 `App.vue`），
// `src/App.vue` 的 `save()` 要在 `runActionsOnSave(...)` 之后调一次（整段可照抄的接法在
// `docs/wiring-requests-2026-10-06-saveops.md`）。上游 `beforeAllDocumentsSaving` 那条「这次没清干净、
// 下次统一补」的队列（`TrailingSpacesStripper.java:52-58`）在本仓没有对应对象：本仓**每次保存都重跑**
// 这条 pass，所以 `deferredLines` 只用来向用户交代「这几行被光标挡着没清」。

import {
  configValueForKey, editorConfigDirsFor, isEditorConfigPath, mergeEditorConfigs,
  type ParsedEditorConfig,
} from './editorConfig.ts'
import { codeStyleToggles, type EditorConfigReader } from './codeStyleSettings.ts'
import { computeLCS } from './diffText.ts'

/** 上游 `STRIP_TRAILING_SPACES_NONE`（`EditorSettingsExternalizable.java:216`）。 */
export const STRIP_TRAILING_SPACES_NONE = 'None'
/** 上游 `STRIP_TRAILING_SPACES_CHANGED`（同文件 :217，**默认档**，见 :73）。 */
export const STRIP_TRAILING_SPACES_CHANGED = 'Changed'
/** 上游 `STRIP_TRAILING_SPACES_WHOLE`（同文件 :218）。 */
export const STRIP_TRAILING_SPACES_WHOLE = 'Whole'

/** 设置页那一格的三档取值（上游 `@StripTrailingSpaces` 的 `@MagicConstant`，:220-221）。 */
export type StripTrailingSpacesMode = 'None' | 'Changed' | 'Whole'

/**
 * 宿主设置面。**字段全部可选**：读不到就走上游默认（`EditorSettingsExternalizable` 的 `OptionSet`
 * 初值），缺键**不等于**用户的存档坏了 —— 这条是本仓出过事故的规矩。
 */
export interface SaveTrimSettings {
  /** 上游 `OptionSet.STRIP_TRAILING_SPACES`（:73），默认 `Changed`。 */
  stripTrailingSpaces?: StripTrailingSpacesMode
  /** 上游 `OptionSet.IS_ENSURE_NEWLINE_AT_EOF`（:74），默认 false。 */
  ensureNewLineAtEof?: boolean
  /** 上游 `OptionSet.KEEP_TRAILING_SPACE_ON_CARET_LINE`（:142），默认 true。 */
  keepTrailingSpacesOnCaretLine?: boolean
  /** 上游 `OptionSet.REMOVE_TRAILING_BLANK_LINES`（:75），默认 false。契约字段，执行体本批不做。 */
  removeTrailingBlankLines?: boolean
}

/** 上游默认档（四个数字都指到 `EditorSettingsExternalizable` 的字段初值行号）。 */
export const UPSTREAM_SAVE_TRIM_DEFAULTS = {
  stripTrailingSpaces: STRIP_TRAILING_SPACES_CHANGED,
  ensureNewLineAtEof: false,
  keepTrailingSpacesOnCaretLine: true,
  removeTrailingBlankLines: false,
} as const

/**
 * 一次保存要用的判定结果。字段与上游 `TrailingSpacesOptions`（
 * `platform/platform-api/src/com/intellij/openapi/fileEditor/TrailingSpacesOptions.java:7` 是其
 * `isEnsureNewLineAtEOF`）逐条对齐，五个都是一个坑，**不许缺**。
 */
export interface SaveTrimOptions {
  /** `isStripTrailingSpaces()`：清不清行尾。 */
  stripTrailingSpaces: boolean
  /** `isChangedLinesOnly()`：只清改动过的行（`None`/`Changed` 档为 true，`Whole` 为 false）。 */
  changedLinesOnly: boolean
  /** `isEnsureNewLineAtEOF()`：补不补末行换行。 */
  ensureNewLineAtEof: boolean
  /** `isKeepTrailingSpacesOnCaretLine()`：光标挡路时那行留到下次。 */
  keepTrailingSpacesOnCaretLine: boolean
  /** `isRemoveTrailingBlankLines()`：契约字段，本批不执行（见 `applySaveTextTransforms` 的注释）。 */
  removeTrailingBlankLines: boolean
}

/** IDE 级默认（上游 `MyTrailingSpacesOptions` 的四个回落分支，:367-398）。 */
export function saveTrimOptionsFromSettings(settings: SaveTrimSettings = {}): SaveTrimOptions {
  const mode = settings.stripTrailingSpaces ?? UPSTREAM_SAVE_TRIM_DEFAULTS.stripTrailingSpaces
  return {
    // :368-372：`None` 之外都算「要清」。
    stripTrailingSpaces: mode !== STRIP_TRAILING_SPACES_NONE,
    // :387-391：只有 `Whole` 算「整文件清」，`Changed`（默认）与 `None` 都是「只清改动行」。
    changedLinesOnly: mode !== STRIP_TRAILING_SPACES_WHOLE,
    ensureNewLineAtEof: settings.ensureNewLineAtEof ?? UPSTREAM_SAVE_TRIM_DEFAULTS.ensureNewLineAtEof,
    keepTrailingSpacesOnCaretLine:
      settings.keepTrailingSpacesOnCaretLine ?? UPSTREAM_SAVE_TRIM_DEFAULTS.keepTrailingSpacesOnCaretLine,
    removeTrailingBlankLines:
      settings.removeTrailingBlankLines ?? UPSTREAM_SAVE_TRIM_DEFAULTS.removeTrailingBlankLines,
  }
}

/** `.editorconfig` 那两个键解出来的覆盖（解不出的字段留空 = 回落 IDE 设置，:18-20 的 null 语义）。 */
export interface EditorConfigSaveOverrides {
  stripTrailingSpaces?: boolean
  changedLinesOnly?: boolean
  ensureNewLineAtEof?: boolean
  /** 上游 filter factory 的 `ENFORCED_REMOVAL`（`EditorConfigTrailingSpacesFilterFactory.java:32-33`）。 */
  enforcedRemoval: boolean
}

/**
 * `EditorConfigTrailingSpacesOptionsProvider.getBooleanValue`（:48-56）+ `FileOptions`（:27-45）。
 * 两个键都解不出 ⇒ `null`（:18-22 返回 null，整份 options 不生效，回落 IDE 设置）。
 */
export function editorConfigSaveOverrides(
  properties: Record<string, string>,
): EditorConfigSaveOverrides | null {
  const trim = booleanValue(configValueForKey(properties, 'trim_trailing_whitespace'))
  const finalNewline = booleanValue(configValueForKey(properties, 'insert_final_newline'))
  if (trim === null && finalNewline === null) return null
  const overrides: EditorConfigSaveOverrides = { enforcedRemoval: trim === true }
  if (trim !== null) {
    overrides.stripTrailingSpaces = trim
    // :39-41：`trim = true` ⇒ changedLinesOnly = false（整文件清）；`trim = false` ⇒ true（无意义，本来就不清）。
    overrides.changedLinesOnly = !trim
  }
  if (finalNewline !== null) overrides.ensureNewLineAtEof = finalNewline
  return overrides
}

/** 上游只认大小写不敏感的 `true` / `false`，其它写法（含 `unset`/`none`）解不出（:50-54）。 */
function booleanValue(value: string): boolean | null {
  if (value.toLowerCase() === 'false') return false
  if (value.toLowerCase() === 'true') return true
  return null
}

/** provider 覆盖 IDE 设置：谁解出结果谁说话，解不出的字段保留回落值（:337-365 的「先设者胜」）。 */
export function applyEditorConfigSaveOverrides(
  base: SaveTrimOptions,
  overrides: EditorConfigSaveOverrides | null,
): SaveTrimOptions {
  if (!overrides) return base
  return {
    stripTrailingSpaces: overrides.stripTrailingSpaces ?? base.stripTrailingSpaces,
    changedLinesOnly: overrides.changedLinesOnly ?? base.changedLinesOnly,
    ensureNewLineAtEof: overrides.ensureNewLineAtEof ?? base.ensureNewLineAtEof,
    keepTrailingSpacesOnCaretLine: base.keepTrailingSpacesOnCaretLine,
    removeTrailingBlankLines: base.removeTrailingBlankLines,
  }
}

/**
 * `.editorconfig` 里这两个键的生效覆盖（走完整层级：近 → 远找文件、坏文件与 `root = true` 收口、
 * **离文件最近的赢**）。层级原语全部复用 `src/editorConfig.ts`，不重算第二遍。
 *
 * 前置门对齐上游 `Utils.isEnabledFor`（`Utils.kt:249-253`）：
 *   · 总开关 —— `EditorConfigSettings.ENABLED`，本仓是 `codeStyleToggles.editorConfigEnabled`；
 *   · `.editorconfig` **自己**不参与（`Utils.kt:243-247`，走 `isEditorConfigPath`）；
 *   · 没有 reader（非桌面端 / 没开工作区）⇒ 这一层不覆盖，回落 IDE 设置。
 */
export async function editorConfigSaveOverridesFor(input: {
  path: string
  root?: string
  read?: EditorConfigReader
}): Promise<EditorConfigSaveOverrides | null> {
  if (!input.read) return null
  if (!codeStyleToggles.value.editorConfigEnabled) return null
  if (isEditorConfigPath(input.path)) return null
  const collected: { dir: string, parsed: ParsedEditorConfig }[] = []
  for (const dir of editorConfigDirsFor(input.path, input.root)) {
    let parsed: ParsedEditorConfig | null
    try {
      parsed = await input.read(dir)
    } catch {
      break  // 坏文件：上游 `is InvalidEditorConfig -> break`（`EditorConfigPropertiesService.kt:95-97`）
    }
    if (!parsed) continue
    collected.push({ dir, parsed })
    if (parsed.isRoot) break
  }
  // `editorConfigDirsFor` 是近 → 远；`mergeEditorConfigs` 是「后写的赢」⇒ 传**远 → 近**。
  const properties = mergeEditorConfigs(input.path, collected.reverse())
  return editorConfigSaveOverrides(properties)
}

/** `Utils.isEditorConfigName` / `isEditorConfigFile`（`Utils.kt:243-247`）：文件名大小写不敏感。 */
export { isEditorConfigPath }

// ---------------------------------------------------------------- 行模型

/** 一行的内容区间 `[start, end)`：**不含**行分隔符（上游 `getLineStartOffset` / `getLineEndOffset`）。 */
export interface LineRange { start: number, end: number }

/**
 * 按 `\n` 切、把结尾的 `\r` 归给行分隔符。末尾有换行 ⇒ 多出一个空行，
 * 与 IDEA 的 `getLineCount()` 行为一致（`"a\n"` 是两行，末行空 ⇒ 已经「有末行换行」）。
 */
export function lineRanges(text: string): LineRange[] {
  const ranges: LineRange[] = []
  let start = 0
  for (;;) {
    const newline = text.indexOf('\n', start)
    if (newline < 0) { ranges.push({ start, end: text.length }); return ranges }
    const hasCr = newline > start && text.charCodeAt(newline - 1) === 13
    ranges.push({ start, end: hasCr ? newline - 1 : newline })
    start = newline + 1
  }
}

/** 偏移 → 行号（上游 `document.getLineNumber(offset)`；落在分隔符里的偏移归前一行）。 */
export function lineAtOffset(ranges: LineRange[], offset: number): number {
  let line = 0
  for (let index = 0; index < ranges.length; ++index) if (ranges[index]!.start <= offset) line = index
  return line
}

/**
 * 行列（0 基）→ **序列化正文**里的偏移。CodeMirror 内部按 `\n` 计位，所以 CRLF 正文必须由这个
 * 函数换算，不能直接把 `selection.head` 传进来（会整体偏 N）。
 */
export function offsetInText(text: string, line: number, character: number): number {
  const ranges = lineRanges(text)
  const range = ranges[Math.min(line, ranges.length - 1)]
  if (!range) return text.length
  return range.start + Math.min(character, range.end - range.start)
}

/** `CharArrayUtil.containsOnlyWhiteSpaces`（`platform/util/base/src/com/intellij/util/text/CharArrayUtil.java:365-373`）。 */
function containsOnlyWhiteSpaces(text: string): boolean {
  for (const char of text) {
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') continue
    return false
  }
  return true
}

/**
 * 「改动过的行」= 当前正文里**不在** LCS 公共段中的行（与保存冲突预览同一套对齐，`src/diffText.ts:103`）。
 * 上游用文档的逐行脏标记；本仓用与上次落盘正文的差异，差异已写进模块头（保守方向）。
 */
export function changedLinesAgainstSaved(savedText: string, text: string): Set<number> {
  const before = lineRanges(savedText).map(range => savedText.slice(range.start, range.end))
  const after = lineRanges(text).map(range => text.slice(range.start, range.end))
  const common = new Set(computeLCS(before, after).map(pair => pair.to))
  const changed = new Set<number>()
  for (let line = 0; line < after.length; ++line) if (!common.has(line)) changed.add(line)
  return changed
}

// ---------------------------------------------------------------- 第一段：去行尾空白

export interface StripTrailingSpacesInput {
  text: string
  /** 上游 `inChangedLinesOnly`（:24）。为真时必须给 `savedText`，否则整段不动。 */
  changedLinesOnly?: boolean
  /** 上次落盘的正文（本仓「改动过的行」的基线）。 */
  savedText?: string
  /**
   * 每行**保留**几个行尾空白字符；`-1` = 这行完全不动。
   * 上游 `getMaxSpacesToLeave`（:112-121）：Smart filter 给数、普通 filter 给否决。
   */
  trailingSpacesToLeave?: (line: number) => number
  /** 整篇否决（上游 `NOT_ALLOWED`，`StripTrailingSpacesUtil.java:43-45` 直接返回）。 */
  strippingNotAllowed?: boolean
  /** 上游 `ENFORCED_REMOVAL`（:35-38）：为真时 filter 列表清空 ⇒ 每行都留 0 个。 */
  enforcedRemoval?: boolean
  /** 光标偏移（与 `text` 同坐标系）。上游只在 `keepTrailingSpacesOnCaretLine` 为真时传（:229）。 */
  caretOffsets?: number[]
}

export interface StripTrailingSpacesResult {
  text: string
  /** 这次清掉的行（0 基）。 */
  strippedLines: number[]
  /** 光标挡着、这次没清的行 —— 上游的 `markAsNeedsStrippingLater`（:81，:109）。 */
  deferredLines: number[]
}

/**
 * `StripTrailingSpacesUtil.stripTrailingSpaces`（:21-110）的纯文本等价物。
 *
 * 上游的「撤销透明写 + 批量事务 + 倒序 `deleteString`」（:95-108）在这里就是倒序拼串；
 * 光标复位（`TrailingSpacesStripper.java:231-240`）不需要 —— 只删行**尾**空白，列坐标取 min 即可，
 * 而本仓的 `setDraft` 整篇重挂，CodeMirror 自己收敛光标。
 */
export function stripTrailingSpaces(input: StripTrailingSpacesInput): StripTrailingSpacesResult {
  const { text } = input
  if (input.strippingNotAllowed) return { text, strippedLines: [], deferredLines: [] }
  if (input.changedLinesOnly && input.savedText === undefined) {
    // 没有基线就判不出「哪些行改过」；上游此时是「所有行都没脏」⇒ 一行都不清。
    return { text, strippedLines: [], deferredLines: [] }
  }
  const ranges = lineRanges(text)
  // :46-54：每行只记**最大**那个光标偏移（没光标的行不进这张表，等价于上游 fastutil 的缺省 0 比较）。
  const caretByLine = new Map<number, number>()
  for (const offset of input.caretOffsets ?? []) {
    const line = lineAtOffset(ranges, offset)
    const known = caretByLine.get(line)
    if (known === undefined || offset > known) caretByLine.set(line, offset)
  }
  const changed = input.changedLinesOnly ? changedLinesAgainstSaved(input.savedText ?? '', text) : null
  const deletions: LineRange[] = []
  const strippedLines: number[] = []
  const deferredLines: number[] = []
  for (let line = 0; line < ranges.length; ++line) {
    const leave = input.enforcedRemoval ? 0 : (input.trailingSpacesToLeave?.(line) ?? 0)
    if (input.changedLinesOnly && !changed!.has(line)) continue          // :62
    if (leave < 0) continue                                              // :62（maxSpacesToLeave 为负）
    const { start, end } = ranges[line]!
    let whiteSpaceStart = -1
    for (let offset = end - 1; offset >= start; --offset) {
      const char = text[offset]
      if (char !== ' ' && char !== '\t') break                           // :68-74：只认空格与制表符
      whiteSpaceStart = offset
    }
    if (whiteSpaceStart < 0) continue                                    // :75-77
    const caret = caretByLine.get(line)
    if (caret !== undefined && whiteSpaceStart < caret) {                // :78-84
      deferredLines.push(line)
      continue
    }
    const finalStart = whiteSpaceStart + leave                           // :85
    if (finalStart < end) { deletions.push({ start: finalStart, end }); strippedLines.push(line) }
  }
  // :100-106：从后往前删，前面的偏移才不会被后面的删除挪掉。
  let next = text
  for (let index = deletions.length - 1; index >= 0; --index) {
    const deletion = deletions[index]!
    next = next.slice(0, deletion.start) + next.slice(deletion.end)
  }
  return { text: next, strippedLines, deferredLines }
}

// ---------------------------------------------------------------- 第二段：末行换行

export interface EnsureNewLineInput {
  /** 已经跑过去行尾空白那一段的正文（上游是同一次 `strip()` 里的先后顺序，:69-109）。 */
  text: string
  /** `options.isStripTrailingSpaces()` —— 末行是纯空白时**要不要顺手删掉**（:89）。 */
  stripTrailingSpaces: boolean
  /** `options.isKeepTrailingSpacesOnCaretLine()`（:90）。 */
  keepTrailingSpacesOnCaretLine: boolean
  caretOffsets?: number[]
}

export type FinalNewLineAction = 'added' | 'last-line-cleared' | 'unchanged'

export interface EnsureNewLineResult { text: string, action: FinalNewLineAction }

/**
 * `TrailingSpacesStripper.strip()` 的末行换行段（:80-109）。逐条照抄的判据：
 *   · `lines > 0` 且末行**非空**（`start != end`）才处理 —— 末行空就说明已经有末行换行；
 *   · 末行是纯空白 + 这次开了行尾清理 + 光标没落在末行 ⇒ **删掉末行**而不是补换行（:89-92）；
 *   · 否则在末行行尾插一个 `\n`（:94，上游字面就是插 `"\n"`）。
 */
export function ensureNewLineAtEnd(input: EnsureNewLineInput): EnsureNewLineResult {
  const { text } = input
  const ranges = lineRanges(text)
  if (!ranges.length) return { text, action: 'unchanged' }
  const last = ranges[ranges.length - 1]!
  if (last.start === last.end) return { text, action: 'unchanged' }
  const content = text.slice(last.start, last.end)
  const caretInside = (input.caretOffsets ?? []).some(offset => offset >= last.start && offset <= last.end)
  if (containsOnlyWhiteSpaces(content) && input.stripTrailingSpaces
    && !(input.keepTrailingSpacesOnCaretLine && caretInside)) {
    return { text: text.slice(0, last.start) + text.slice(last.end), action: 'last-line-cleared' }
  }
  return { text: `${text.slice(0, last.end)}\n${text.slice(last.end)}`, action: 'added' }
}

// ---------------------------------------------------------------- 保存入口

/** 整条 pass 没执行的原因（上游 `getOptions()` 返回 null 的那几道门，:295-322）。 */
export type SaveTransformSkip = null
  | 'document-not-writable'      // :296 `document.isWritable()`
  | 'no-backing-file'            // :298 `getFile(document) == null`
  | 'file-invalid'               // :299 `file.isValid()`
  | 'stripping-disabled-for-file'  // :299 `DISABLE_FOR_FILE_KEY`

export interface SaveTransformInput {
  path: string
  /** 将要落盘的正文（`src/actionsOnSave.ts` 处理完的那一份）。 */
  text: string
  options: SaveTrimOptions
  /** 上次落盘的正文；`changedLinesOnly` 为真时缺它就一行都不清（见模块头第 2 条差异）。 */
  savedText?: string
  caretOffsets?: number[]
  /** 上游 `document.isWritable()`：本仓是标签页的只读档。 */
  writable?: boolean
  /** 本仓：正文有没有对应的磁盘文件（浏览器示例缓冲没有）。 */
  backedByFile?: boolean
  /** 本仓：文件还在不在（保存冲突/外部删除的兜底）。 */
  fileValid?: boolean
  /** 上游 `TrailingSpacesStripper.setEnabled(file, false)`（:285-292，`saveDocumentAsIs` 用）。 */
  strippingDisabledForFile?: boolean
  trailingSpacesToLeave?: (line: number) => number
  strippingNotAllowed?: boolean
  /** `.editorconfig` 的 `ENFORCED_REMOVAL`。 */
  enforcedRemoval?: boolean
}

export interface SaveTransformResult {
  text: string
  changed: boolean
  skipped: SaveTransformSkip
  strippedLines: number[]
  deferredLines: number[]
  /** `not-requested` = 设置与 `.editorconfig` 都没说要补末行换行。 */
  finalNewLine: FinalNewLineAction | 'not-requested'
}

/**
 * 一次保存的完整 pass：**先清行尾、再补末行换行**（上游 `strip()` 的 :69-110 就是这个先后）。
 *
 * 上游第三段 `removeTrailingBlankLines`（:76-78 + :112-131）**不在本批两条之内**：
 * 它有自己的设置项 `REMOVE_TRAILING_BLANK_LINES`（默认 false，`EditorSettingsExternalizable.java:75`），
 * 本仓那格没有可持久化的键，所以留成契约字段 `removeTrailingBlankLines` 而不给执行体 ——
 * 判词与「不做」的理由一起写在 `docs/batch-2026-10-06-saveops.md`。
 */
export function applySaveTextTransforms(input: SaveTransformInput): SaveTransformResult {
  // 四道门（:295-322）：任一不过 = 整条 pass 不做，正文原样落盘。
  const skipped: SaveTransformSkip =
    (input.writable ?? true) === false ? 'document-not-writable'
      : (input.backedByFile ?? true) === false ? 'no-backing-file'
        : (input.fileValid ?? true) === false ? 'file-invalid'
          : (input.strippingDisabledForFile ?? false) ? 'stripping-disabled-for-file'
            : null
  const empty: SaveTransformResult = {
    text: input.text, changed: false, skipped,
    strippedLines: [], deferredLines: [], finalNewLine: 'not-requested',
  }
  if (skipped) return empty

  let text = input.text
  let strippedLines: number[] = []
  let deferredLines: number[] = []
  if (input.options.stripTrailingSpaces) {
    const stripped = stripTrailingSpaces({
      text,
      changedLinesOnly: input.options.changedLinesOnly,
      savedText: input.savedText,
      caretOffsets: input.caretOffsets,
      trailingSpacesToLeave: input.trailingSpacesToLeave,
      strippingNotAllowed: input.strippingNotAllowed,
      enforcedRemoval: input.enforcedRemoval,
    })
    text = stripped.text
    strippedLines = stripped.strippedLines
    deferredLines = stripped.deferredLines
  }
  let finalNewLine: FinalNewLineAction | 'not-requested' = 'not-requested'
  if (input.options.ensureNewLineAtEof) {
    const ensured = ensureNewLineAtEnd({
      text,
      stripTrailingSpaces: input.options.stripTrailingSpaces,
      keepTrailingSpacesOnCaretLine: input.options.keepTrailingSpacesOnCaretLine,
      caretOffsets: input.caretOffsets,
    })
    text = ensured.text
    finalNewLine = ensured.action
  }
  return { text, changed: text !== input.text, skipped: null, strippedLines, deferredLines, finalNewLine }
}

// ---------------------------------------------------------------- 接线用的一次性入口

/**
 * 「IDE 设置 + `.editorconfig` 覆盖」合成一份生效档（上游 `getOptions()` 里 provider 覆盖
 * `EditorSettingsExternalizable` 的那一步，`TrailingSpacesStripper.java:304-317`）。
 * 设置键还没落 ⇒ `settings` 传空对象即可，全部落到上游默认档。
 */
export async function saveTrimOptionsFor(input: {
  path: string
  root?: string
  settings?: SaveTrimSettings
  read?: EditorConfigReader
}): Promise<{ options: SaveTrimOptions, enforcedRemoval: boolean }> {
  const base = saveTrimOptionsFromSettings(input.settings ?? {})
  if (!input.read) return { options: base, enforcedRemoval: false }
  const overrides = await editorConfigSaveOverridesFor({ path: input.path, root: input.root, read: input.read })
  return {
    options: applyEditorConfigSaveOverrides(base, overrides),
    enforcedRemoval: overrides?.enforcedRemoval ?? false,
  }
}
