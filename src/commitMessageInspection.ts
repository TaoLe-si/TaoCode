/**
 * IDEA's commit-message inspections, ported from
 * `platform/vcs-impl/src/com/intellij/vcs/commit/message/`.
 *
 * Three inspections run over the commit message document, all of them derived from the same
 * right-margin check:
 *
 *   SubjectLimitInspection           line 0 must not exceed `RIGHT_MARGIN`       (:19,33-36)
 *   BodyLimitInspection              every line from 1 on must not exceed it     (:26,50-57)
 *   SubjectBodySeparationInspection  line 1 must be empty, i.e. "right margin 0" (:32-36)
 *
 * The shared primitive is `BaseCommitMessageInspection.checkRightMargin` (:144-157): with
 * `start`/`end` being the line's offsets, the problem range is
 * `TextRange(start + rightMargin, end)` — the part *beyond* the margin, not the whole line.
 * Here the range is expressed inside the line (`[rightMargin, lineLength)`), which is the same
 * thing once the line offset is dropped.
 *
 * What is deliberately *not* here:
 *
 *  - Showing the right margin (`VcsConfiguration.USE_COMMIT_MESSAGE_MARGIN`, default true,
 *    `VcsConfiguration.java:73` → `CommitMessage.java:338-339 setRightMarginShown`). A column
 *    ruler is only meaningful in a fixed-width editor — IDEA's commit field is an
 *    `EditorTextField` drawn with the editor font, TaoCode's is a proportional-font
 *    `<textarea>`. A "column 72" line under a proportional font would sit at an invented
 *    position, and switching the field to a monospace font is a look-and-feel decision left to
 *    桃. The overflow is reported instead: each problem shows the exact substring IDEA underlines.
 *  - `settings.commit.postpone.slow.checks` (`NON_MODAL_COMMIT_POSTPONE_SLOW_CHECKS`, default
 *    true): TaoCode's only commit check is a blocking TODO confirm dialog; "postpone" would move
 *    it after the commit, changing what that dialog means rather than porting it.
 *  - `checkbox.clear.initial.commit.message` (`CLEAR_INITIAL_COMMIT_MESSAGE`, default false):
 *    IDEA's non-clearing branch restores the change list's own message
 *    (`AbstractCommitMessagePolicy.kt:47-53`), a concept TaoCode does not have — the observable
 *    result (an empty box after a commit) is already what TaoCode does.
 */

/** `SubjectLimitInspection.kt:19` and `BodyLimitInspection.kt:26`. */
export const DEFAULT_RIGHT_MARGIN = 72
/** The options UI is a `spinner(0..10000)` in both inspections (`:27`, `:36`). */
export const RIGHT_MARGIN_MIN = 0
export const RIGHT_MARGIN_MAX = 10000

export const COMMIT_MESSAGE_INSPECTION_STORAGE_KEY = 'taocode.commitMessageInspections'

export interface CommitMessageInspectionSettings {
  /** `SubjectLimitInspection` enabled. */
  subjectLimit: boolean
  subjectRightMargin: number
  /** `BodyLimitInspection` enabled. */
  bodyLimit: boolean
  bodyRightMargin: number
  /** `SubjectBodySeparationInspection` enabled. */
  subjectBodySeparation: boolean
  /** `VcsConfiguration.WRAP_WHEN_TYPING_REACHES_RIGHT_MARGIN` (`:74`, default false). */
  wrapOnTyping: boolean
}

/** Every inspection is enabled and both margins are 72, as in IDEA's default profile. */
export const DEFAULT_INSPECTION_SETTINGS: CommitMessageInspectionSettings = {
  subjectLimit: true,
  subjectRightMargin: DEFAULT_RIGHT_MARGIN,
  bodyLimit: true,
  bodyRightMargin: DEFAULT_RIGHT_MARGIN,
  subjectBodySeparation: true,
  wrapOnTyping: false,
}

function margin(saved: unknown, fallback: number): number {
  if (typeof saved !== 'number' || !Number.isInteger(saved)) return fallback
  if (saved < RIGHT_MARGIN_MIN || saved > RIGHT_MARGIN_MAX) return fallback
  return saved
}

function flag(saved: unknown, fallback: boolean): boolean {
  return typeof saved === 'boolean' ? saved : fallback
}

/**
 * Tolerates anything localStorage hands back: a corrupt or half-written entry falls back to the
 * IDEA default per field instead of dropping the whole configuration (the same policy the other
 * `taocode.*` keys use).
 */
export function resolveInspectionSettings(saved: unknown): CommitMessageInspectionSettings {
  const value = (saved && typeof saved === 'object' ? saved : {}) as Partial<CommitMessageInspectionSettings>
  return {
    subjectLimit: flag(value.subjectLimit, DEFAULT_INSPECTION_SETTINGS.subjectLimit),
    subjectRightMargin: margin(value.subjectRightMargin, DEFAULT_INSPECTION_SETTINGS.subjectRightMargin),
    bodyLimit: flag(value.bodyLimit, DEFAULT_INSPECTION_SETTINGS.bodyLimit),
    bodyRightMargin: margin(value.bodyRightMargin, DEFAULT_INSPECTION_SETTINGS.bodyRightMargin),
    subjectBodySeparation: flag(value.subjectBodySeparation, DEFAULT_INSPECTION_SETTINGS.subjectBodySeparation),
    wrapOnTyping: flag(value.wrapOnTyping, DEFAULT_INSPECTION_SETTINGS.wrapOnTyping),
  }
}

export type CommitMessageProblemKind = 'subject' | 'body' | 'separation'

/**
 * The quick fixes a problem offers. IDEA passes `vararg fixes` into `checkRightMargin` (`:146`):
 * `SubjectLimitInspection` passes `ReformatCommitMessageQuickFix` only (`:35`),
 * `BodyLimitInspection` passes `WrapLineQuickFix` + `ReformatCommitMessageQuickFix` (`:54-55`),
 * `SubjectBodySeparationInspection` passes `AddBlankLineQuickFix` + `ReformatCommitMessageQuickFix`
 * (`:33-35`).
 */
export type CommitMessageFix = 'wrap' | 'blankLine' | 'reformat'

export interface CommitMessageProblem {
  kind: CommitMessageProblemKind
  /** 0-based line index, as IDEA's `descriptor.getLineNumber()` (`:75-76`). */
  line: number
  /** Offsets inside the line; `[start, end)` is exactly the range IDEA highlights (`:151-153`). */
  start: number
  end: number
  message: string
  fixes: readonly CommitMessageFix[]
}

/** `VcsBundle.properties:1161` "Subject cannot exceed {0} characters". */
export const SUBJECT_LIMIT_MESSAGE = (rightMargin: number) => `主题行不能超过 ${rightMargin} 个字符`
/** `VcsBundle.properties:1158` "Body lines cannot exceed {0} characters". */
export const BODY_LIMIT_MESSAGE = (rightMargin: number) => `正文行不能超过 ${rightMargin} 个字符`
/** `VcsBundle.properties:1160` "Missing blank line between subject and body". */
export const MISSING_BLANK_LINE_MESSAGE = '主题与正文之间缺少空行'
/** `VcsBundle.properties:1157` / `:1159` / `:917` — the quick-fix family names. */
export const FIX_LABELS: Record<CommitMessageFix, string> = {
  reformat: '重新格式化提交信息',
  wrap: '换行',
  blankLine: '插入空行',
}

/**
 * IDEA's document is UTF-16 (`Document.getLineEndOffset` counts `char`s, not code points), so a
 * surrogate pair counts as two characters here as well — that is what keeps the reported range
 * identical to the one IDEA would highlight. `\n` only: a `<textarea>` value never contains a
 * lone `\r`.
 */
export function messageLines(text: string): string[] {
  return text.split('\n')
}

/**
 * `BaseCommitMessageInspection.checkRightMargin` (`:144-157`): a line is too long when
 * `end > start + rightMargin`; the reported range is the part past the margin.
 */
function checkRightMargin(line: string, rightMargin: number): { start: number; end: number } | null {
  if (line.length <= rightMargin) return null
  return { start: rightMargin, end: line.length }
}

/**
 * Runs every enabled inspection over the message.
 *
 * IDEA's three inspections are independent tools and the profile does not fix an order between
 * them, so the output is ordered deterministically: by line, and within a line in the fixed
 * order subject → separation → body (both checks can fire on line 1).
 */
export function inspectCommitMessage(
  text: string,
  settings: CommitMessageInspectionSettings,
): CommitMessageProblem[] {
  const lines = messageLines(text)
  const problems: CommitMessageProblem[] = []

  if (settings.subjectLimit) {
    const range = checkRightMargin(lines[0] ?? '', settings.subjectRightMargin)
    if (range) {
      problems.push({
        kind: 'subject',
        line: 0,
        ...range,
        message: SUBJECT_LIMIT_MESSAGE(settings.subjectRightMargin),
        fixes: ['reformat'],
      })
    }
  }

  // SubjectBodySeparationInspection.java:32-36 — `checkRightMargin(..., line = 1, rightMargin = 0)`,
  // i.e. line 1 must be empty before the commit body starts.
  if (settings.subjectBodySeparation && lines.length > 1) {
    const range = checkRightMargin(lines[1] ?? '', 0)
    if (range) {
      problems.push({
        kind: 'separation',
        line: 1,
        ...range,
        message: MISSING_BLANK_LINE_MESSAGE,
        fixes: ['blankLine', 'reformat'],
      })
    }
  }

  // BodyLimitInspection.kt:51 — the body is `1 until document.getLineCount()`.
  if (settings.bodyLimit) {
    for (let line = 1; line < lines.length; line += 1) {
      const range = checkRightMargin(lines[line] ?? '', settings.bodyRightMargin)
      if (range) {
        problems.push({
          kind: 'body',
          line,
          ...range,
          message: BODY_LIMIT_MESSAGE(settings.bodyRightMargin),
          fixes: ['wrap', 'reformat'],
        })
      }
    }
  }

  return problems
}

/** The substring IDEA underlines (`TextRange(start + rightMargin, end)`, `:152`). */
export function exceedingText(text: string, problem: CommitMessageProblem): string {
  const line = messageLines(text)[problem.line] ?? ''
  return line.slice(problem.start, problem.end)
}

interface SplitLine {
  /** The wrapped lines, in order. */
  parts: string[]
  /** Offsets in the original line where a newline is inserted. */
  breaks: number[]
  /** Offsets of the single spaces that the break replaced. */
  dropped: number[]
}

/**
 * Greedy wrap at the right margin: break after the last space that still fits, otherwise break
 * exactly at the margin (a word longer than the margin has to be cut somewhere). IDEA delegates
 * this to `LineWrappingUtil.doWrapLongLinesIfNecessary` (`BodyLimitInspection.kt:90-94`), i.e. to
 * the editor's own wrap model; for plain text the observable result is the same. A continuation
 * line gets no extra indentation — a commit message has no language indentation rules to keep.
 */
function splitLine(line: string, rightMargin: number): SplitLine {
  const parts: string[] = []
  const breaks: number[] = []
  const dropped: number[] = []
  // A margin of 0 cannot advance; return the line untouched instead of looping forever.
  if (rightMargin > 0) {
    let rest = line
    let base = 0
    while (rest.length > rightMargin) {
      const window = rest.slice(0, rightMargin + 1)
      const space = window.lastIndexOf(' ')
      const cut = space > 0 ? space : rightMargin
      parts.push(rest.slice(0, cut))
      breaks.push(base + cut)
      if (space > 0) {
        dropped.push(base + cut)
        base += cut + 1
        rest = rest.slice(cut + 1)
      } else {
        base += cut
        rest = rest.slice(cut)
      }
    }
    if (rest.length) parts.push(rest)
  }
  if (!parts.length) parts.push(line)
  return { parts, breaks, dropped }
}

/** `wrapLine` without the caret bookkeeping — the shape a unit test wants to assert on. */
export function wrapLine(line: string, rightMargin: number): string[] {
  return splitLine(line, rightMargin).parts
}

/** `BodyLimitInspection.reformat` / `WrapLineQuickFix` over the body range (`:72-88`). */
export function wrapBodyLines(text: string, rightMargin: number): string {
  const lines = messageLines(text)
  const out: string[] = lines.length ? [lines[0]!] : []
  for (let line = 1; line < lines.length; line += 1) out.push(...wrapLine(lines[line] ?? '', rightMargin))
  return out.join('\n')
}

/**
 * `SubjectBodySeparationInspection.AddBlankLineQuickFix` (`:58-68`): if line 1 is not already
 * empty, insert a `\n` at its start — the blank line itself becomes line 1 afterwards.
 */
export function addBlankLineAfterSubject(text: string): string {
  const lines = messageLines(text)
  if (lines.length <= 1) return text
  if ((lines[1] ?? '').length === 0) return text
  lines.splice(1, 0, '')
  return lines.join('\n')
}

/**
 * `ReformatCommitMessageAction.reformat` (`ReformatCommitMessageAction.java:54-59`) runs every
 * enabled inspection's own `reformat`: the body limit wraps the body lines, the separation check
 * inserts the missing blank line. `SubjectLimitInspection` has no reformat of its own, which is
 * why an over-long subject line is *not* touched by this action (IDEA warns about it and offers
 * the same action, but the action cannot shorten a line — the fix is to rewrite the summary).
 */
export function reformatCommitMessage(
  text: string,
  settings: CommitMessageInspectionSettings,
): string {
  let out = text
  if (settings.subjectBodySeparation) out = addBlankLineAfterSubject(out)
  if (settings.bodyLimit) out = wrapBodyLines(out, settings.bodyRightMargin)
  return out
}

/**
 * `WRAP_WHEN_TYPING_REACHES_RIGHT_MARGIN` (`VcsConfiguration.java:74`) →
 * `CommitMessage.java:340 setWrapWhenTypingReachesRightMargin` → the editor's auto hard wrap: the
 * line being typed is broken once it reaches the right margin. The commit field uses the *body*
 * margin for this (`:338` feeds `settings.getRightMargin()` from `BodyLimitSettings`).
 *
 * Returns the new text plus where the caret ends up: every line break inserted in front of the
 * caret moves it right by one, every space dropped there moves it left by one.
 */
export function wrapOnTyping(text: string, caret: number, rightMargin: number): { text: string; caret: number } {
  if (rightMargin <= 0) return { text, caret }
  const safeCaret = Math.max(0, Math.min(caret, text.length))
  const lineStart = text.lastIndexOf('\n', safeCaret - 1) + 1
  let lineEnd = text.indexOf('\n', lineStart)
  if (lineEnd < 0) lineEnd = text.length

  const line = text.slice(lineStart, lineEnd)
  if (line.length <= rightMargin) return { text, caret }

  const { parts, breaks, dropped } = splitLine(line, rightMargin)
  const inLine = safeCaret - lineStart
  const inserted = breaks.filter(offset => offset < inLine).length
  const removed = dropped.filter(offset => offset < inLine).length
  const replacement = parts.join('\n')
  return {
    text: text.slice(0, lineStart) + replacement + text.slice(lineEnd),
    caret: lineStart + inLine + inserted - removed,
  }
}
