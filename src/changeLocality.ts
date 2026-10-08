// **改动局部性**（`com.intellij.daemon.changeLocalityDetector` 的消费端与内建两支）。
//
// 上游是什么：`ChangeLocalityDetector`（`platform/analysis-api/src/com/intellij/codeInsight/daemon/ChangeLocalityDetector.java:33`）
// 让高亮子系统声明「改了某个元素之后，只要重算哪一小段」——
// `getChangeHighlightingDirtyScopeFor(changedElement)` 返回那个祖先元素，返回 null = 拿不准（按原范围）。
// 消费方是 `PsiChangeHandler.java:59` 的 `EP_NAME`；出厂两支：
//   · `DefaultChangeLocalityDetector`（`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1030`）：
//     改动落在**空白或注释**里（且注释里没有 `noinspection` 抑制标记）时就只重算那一处；
//   · `MultiLineTodoLocalityDetector`（`platform/todo/resources/intellij.platform.todo.xml:53`）：
//     多行 TODO 打开时，注释的改动要把**相邻的注释行**一起算进脏范围（`TodoConfiguration.isMultiLine()`）。
//
// 本仓的落点：EP 宿主在 `src/daemonExtensionPoints.ts`（第三批），本模块给内建两支 + 消费入口
// `narrowChangeLocalityRangesFor`，真实消费点是 `src/highlightPasses.ts` 的两拍
// （`runGeneralHighlightingPass` 的按脏范围重算、`runMainHighlightPasses` 的主 pass 分派）——
// 那条链上游就是 `PsiChangeHandler` → dirty scope → `GeneralHighlightingPass`。
//
// 与上游的如实差异：本仓没有 PSI，改动的形状是**行区间**（`src/highlightPasses.ts` 的
// `dirtyLineRanges` 用前后文本的公共前缀/后缀算出来的），所以
//   · 「改动落在注释里」用**词面**判定（行首空白之后是不是注释前缀，与 `src/todoMultiLine.ts`
//     的续行判定同一份前缀表），上游按 PSI 的 `PsiComment`/`PsiWhiteSpace` 判；
//   · 返回的是**收窄/放宽后的行区间**，不是 `PsiElement`。
//
// `MultiLineTodoLocalityDetector` 的开关从调用方注入（`TodoConfiguration.isMultiLine()` 的等价物）：
// 本仓那一格是 `src/components/TodoPanel.vue` 的 `multiLine`（默认**关**，与上游默认开不同），
// 所以缺省也是关 —— 没打开多行 TODO 的会话里，脏范围与接入前逐字节相同（不是静默改行为），
// 接线请求见 `docs/wiring-requests-2026-10-07-pvdm.md` P-3。
//
// 纯数据层：只 import `src/daemonExtensionPoints.ts` 与 `src/todoMultiLine.ts`（前缀表单一来源），
// 不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// 判据：`tests/change-locality.test.mjs`。

import {
  CHANGE_LOCALITY_DETECTOR_EP, narrowChangeLocalityRanges, registerChangeLocalityDetector,
  type ChangeLocalityInput, type ChangeLocalityRange,
} from './daemonExtensionPoints.ts'
import { TODO_COMMENT_PREFIXES } from './todoMultiLine.ts'

export { CHANGE_LOCALITY_DETECTOR_EP, narrowChangeLocalityRanges }
export type { ChangeLocalityInput, ChangeLocalityRange }

/** 内建两支的贡献 id（逐字取上游类名，便于按「哪一支在跑」排查）。 */
export const DEFAULT_CHANGE_LOCALITY_ID = 'DefaultChangeLocalityDetector'
export const MULTI_LINE_TODO_LOCALITY_ID = 'MultiLineTodoLocalityDetector'

/**
 * 抑制标记（上游 `DefaultChangeLocalityDetector` 明确排除带 `noinspection` 的注释，
 * `SuppressionUtilCore.SUPPRESS_INSPECTIONS_TAG_NAME = "noinspection"`）。那一类注释的改动
 * 会影响整份文件的报错，所以**不能**只重算那一处。
 */
export const CHANGE_LOCALITY_SUPPRESSION_MARKERS: readonly string[] = [
  'noinspection', 'noqa', 'nolint', '@SuppressWarnings', 'eslint-disable',
]

/** 这一行去掉行首空白后是不是空白行（含空行）。 */
export function isBlankLine(line: string): boolean {
  return line.trim().length === 0
}

/** 这一行的词面注释前缀（与 `src/todoMultiLine.ts` 的续行判定同一份表）；不是注释行给 null。 */
export function commentMarkerOf(line: string): string | null {
  const trimmed = line.trimStart()
  if (!trimmed) return null
  const sorted = [...TODO_COMMENT_PREFIXES].sort((a, b) => b.length - a.length)
  for (const marker of sorted) if (trimmed.startsWith(marker)) return marker
  return null
}

/** 这一行是不是注释行（`PsiComment` 的词面等价物）。 */
export function isCommentLine(line: string): boolean {
  return commentMarkerOf(line) !== null
}

/** 一段行区间里每一行都是空白或注释（`PsiWhiteSpace | PsiComment` 那一档的词面等价物）。 */
export function commentOrBlankOnly(lines: readonly string[], range: ChangeLocalityRange): boolean {
  for (let line = range.start; line <= range.end; line++) {
    const text = lines[line]
    if (text === undefined) continue
    if (!isBlankLine(text) && !isCommentLine(text)) return false
  }
  return true
}

/** 这一段里有没有抑制标记（有 ⇒ 整份文件的行为可能变，退回「拿不准」）。 */
export function hasSuppressionMarker(lines: readonly string[], range: ChangeLocalityRange): boolean {
  for (let line = range.start; line <= range.end; line++) {
    const text = lines[line]
    if (text === undefined) continue
    const lower = text.toLowerCase()
    if (CHANGE_LOCALITY_SUPPRESSION_MARKERS.some(marker => lower.includes(marker.toLowerCase()))) return true
  }
  return false
}

/**
 * `DefaultChangeLocalityDetector.getChangeHighlightingDirtyScopeFor` 的等价物（`:20-28`）：
 * 改动整段落在空白/注释里且没有抑制标记 ⇒ 只重算这一段（返回原区间）；
 * 其余（碰到代码、或注释里有 `noinspection`）⇒ null = 拿不准，调用方保留原范围。
 *
 * 本仓的行区间本来就是「改动到的那几行」，所以这一支对注释/空白改动是**恒等**的
 * —— 它在 EP 里存在的意义与上游一致：把「拿不准」与「只算这一处」两档区分开，
 * 让后面接的第三方检查器（例如「代码块内改动只重算那个块」）能按同一顺序插进这条链。
 */
export function defaultChangeLocalityRange(input: ChangeLocalityInput): ChangeLocalityRange | null {
  if (!commentOrBlankOnly(input.lines, input.changed)) return null
  if (hasSuppressionMarker(input.lines, input.changed)) return null
  return { ...input.changed }
}

/**
 * 多行 TODO 的注释块：从 `range` 上下扩到相邻的注释行（中间最多隔一个空行，
 * 照上游 `findAdjacentComment` 的 `newLines > (nextLine ? 0 : 1)` 那条停止条件）。
 * 只在 `range` 本身是注释/空白时才扩（改到代码上就交给下一支 / 拿不准）。
 */
export function multiLineCommentBlock(
  lines: readonly string[], range: ChangeLocalityRange, maxGap = 1,
): ChangeLocalityRange {
  if (!commentOrBlankOnly(lines, range)) return { ...range }
  let start = range.start
  let end = range.end
  let gap = 0
  while (start - 1 >= 0) {
    const text = lines[start - 1]
    if (text === undefined) break
    if (isBlankLine(text)) {
      if (gap >= maxGap) break
      gap++
      start--
      continue
    }
    if (isCommentLine(text)) { start--; gap = 0; continue }
    break
  }
  gap = 0
  while (end + 1 < lines.length) {
    const text = lines[end + 1]
    if (text === undefined) break
    if (isBlankLine(text)) {
      if (gap >= maxGap) break
      gap++
      end++
      continue
    }
    if (isCommentLine(text)) { end++; gap = 0; continue }
    break
  }
  return { start, end }
}

/**
 * `MultiLineTodoLocalityDetector.getChangeHighlightingDirtyScopeFor` 的等价物（`:26-41`）：
 * 多行 TODO 关着 ⇒ null（上游第一句就是 `if (!isMultiLine()) return null`）；
 * 开着且改动落在注释/空白里 ⇒ 那一段注释块；其余 ⇒ null。
 *
 * `multiLine` 是开关的提供函数（本仓的 `TodoPanel.vue` 那一格；缺省**关**，见文件头的如实差异）。
 */
export function multiLineTodoChangeLocalityRange(
  input: ChangeLocalityInput, multiLine: () => boolean,
): ChangeLocalityRange | null {
  let on = false
  try { on = multiLine() === true } catch { on = false }
  if (!on) return null
  if (!commentOrBlankOnly(input.lines, input.changed)) return null
  return multiLineCommentBlock(input.lines, input.changed)
}

/** 内建两支的贡献（`multiLine` 是开关的提供函数，注册处注入）。
 *
 * 消费面取**第一支非 null**，所以顺序有意义：「会放宽范围」的多行 TODO 那一支排在**前面**，
 * `DefaultChangeLocalityDetector` 那种「只算这一处」的收窄档排后面 —— 否则它对所有注释/空白改动
 * 都返回非 null，后面那支永远轮不到（上游两支是平级 EP，先后由 order 定；本仓把放宽档放前，
 * 与上游 TODO 模块的 order 在 lang-impl 之前同一方向）。
 */
export function bundledChangeLocalityDetectors(
  multiLine: () => boolean = () => false,
): Array<{ id: string; getChangeHighlightingDirtyScopeFor: (input: ChangeLocalityInput) => ChangeLocalityRange | null }> {
  return [
    { id: MULTI_LINE_TODO_LOCALITY_ID, getChangeHighlightingDirtyScopeFor: (input: ChangeLocalityInput) => multiLineTodoChangeLocalityRange(input, multiLine) },
    { id: DEFAULT_CHANGE_LOCALITY_ID, getChangeHighlightingDirtyScopeFor: defaultChangeLocalityRange },
  ]
}

let bundledRegistered = false

/**
 * 把内建两支登记进 `com.intellij.daemon.changeLocalityDetector`（幂等）。
 * `multiLine` 缺省关（本仓 `TodoPanel.vue` 的现状），打开后多行注释的改动会放宽脏范围。
 */
export function registerBundledChangeLocalityDetectors(multiLine: () => boolean = () => false): void {
  if (bundledRegistered) return
  bundledRegistered = true
  for (const detector of bundledChangeLocalityDetectors(multiLine)) {
    registerChangeLocalityDetector(detector, { source: 'bundled' })
  }
}

registerBundledChangeLocalityDetectors()

/** 内建两支已登记（判据与排查用）。 */
export function bundledChangeLocalityRegistered(): boolean {
  return bundledRegistered
}

/**
 * 脏范围过 `ChangeLocalityDetector` 的唯一入口（`src/highlightPasses.ts` 两拍调它）。
 * 走 `narrowChangeLocalityRanges`（第一支非 null 赢），所以内建两支与第三方按同一顺序过。
 */
export function narrowChangeLocalityRangesFor(
  path: string, language: string, text: string, ranges: readonly ChangeLocalityRange[],
): ChangeLocalityRange[] {
  return narrowChangeLocalityRanges(path, language, text, ranges)
}
