// IDEA's "Next / Previous Highlighted Error", ported from
// platform/lang-impl/src/com/intellij/codeInsight/daemon/impl/GotoNextErrorHandler.java.
//
// The action pair is declared in lang-impl's plugin XML
// (platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:376-377), sits in the
// Navigate menu as `<group id="GoToErrorGroup">` immediately after "Go to Line"
// (platform/platform-impl/resources/idea/PlatformActions.xml:609-615) and is bound to F2 /
// Shift+F2 (platform/platform-resources/src/keymaps/$default.xml:658-660 and :679-681;
// "macOS System Shortcuts.xml":425,430). The titles are
// "Next Highlighted Error" / "Previous Highlighted Error"
// (platform/platform-resources-en/src/messages/ActionsBundle.properties:708-711).
//
// gotoNextError() (:64-91) walks the severities from the highest down to
// SeverityRegistrar.SHOWN_SEVERITIES_OFFSET (SeverityRegistrar.java:47 = 2) and stops at the
// first level that yields a highlight, so a file's errors always win over its warnings:
// DaemonCodeAnalyzerSettings.isNextErrorActionGoesToErrorsFirst() is true by default
// (DaemonCodeAnalyzerSettings.java:17,30-33).
//
// The order is HighlightSeverity's own comparison value (HighlightSeverity.java:124-125):
// ERROR 400 > WARNING 300 > WEAK_WARNING / INFO 200 > SERVER PROBLEM 100 >
// TEXT ATTRIBUTES 11 > INFORMATION 10, and the offset of 2 drops the last two — a plain
// INFORMATION highlight is never a navigation target.
//
// IDEA's own language-server client maps LSP severities onto those levels
// (platform/lsp/src/api/customization/LspDiagnosticsCustomizer.kt:80-85):
//
//   DiagnosticSeverity.Error   -> HighlightSeverity.ERROR
//   DiagnosticSeverity.Warning -> HighlightSeverity.WARNING
//   everything else            -> HighlightSeverity.WEAK_WARNING
//
// which is exactly the three tiers below. Since nothing a language server publishes lands
// below WEAK_WARNING, the two levels the offset removes are unreachable here.
//
// Inside the chosen tier findInfo() (:93-114) keeps two candidates — the best *goto-able*
// highlight and the best highlight overall — and isBetterThan() (:116-132) defines "best",
// comparing document offsets against the caret:
//
//   forward : the smallest offset strictly after the caret, else the first in the file
//   backward: the largest offset strictly before the caret, else the last in the file
//
// ("strictly" in both directions: the forward test is `caretOffset < offset` and the
// backward branch prefers a candidate that fails `caretOffset <= offset`, i.e. one that is
// strictly earlier. A caret sitting exactly on a highlight is therefore not "here" for
// either action — F2 goes on, Shift+F2 goes back.)
//
// The last-resort wrap comes from the `caretOffsetIfNoLuck` buckets (:97, :104-107): -1 for
// forward (every offset counts as "after it") and the document length for backward.
//
// The offset IDEA navigates to is the highlight's start plus `navigationShift` (0 for
// everything here; the after-end-of-line case is described in CodeEditor.vue's goToError).

/** An LSP diagnostic's navigation-relevant fields (bridge.ts `LspDiagnostic`, 0-based). */
export interface ErrorLocation {
  line: number
  character: number
}

export interface ErrorDiagnostic extends ErrorLocation {
  severity: number
}

/** The three reachable IDEA severity levels, highest first — see the header. */
export const ERROR_TIER = 0
export const WARNING_TIER = 1
export const WEAK_WARNING_TIER = 2

/**
 * LspDiagnosticsCustomizer.kt:80-85 collapsed onto a navigation tier. Anything that is not
 * an LSP error or warning is a WEAK_WARNING in IDEA, whatever the server called it.
 */
export function errorTier(severity: number): number {
  if (severity === 1) return ERROR_TIER
  if (severity === 2) return WARNING_TIER
  return WEAK_WARNING_TIER
}

/** InspectionsBundle.properties:152 `no.errors.found.in.this.file`. */
export const NO_ERRORS_IN_FILE = '此文件中未发现错误。'

/** Document order, which is what IDEA's offset comparison compares. */
function comparePosition(a: ErrorLocation, b: ErrorLocation): number {
  return a.line - b.line || a.character - b.character
}

/**
 * GotoNextErrorHandler.isBetterThan() (:123-132), transcribed against document order. A
 * candidate only replaces the current one on a *strict* improvement, which is what makes two
 * highlights at one offset resolve to the earlier of the two.
 */
function betterThan<T extends ErrorLocation>(
  current: T | null, candidate: T, caret: ErrorLocation, forward: boolean,
): boolean {
  if (!current) return true
  const relative = comparePosition(candidate, caret)
  const currentRelative = comparePosition(current, caret)
  // forward compares `caretOffset < offset`, backward `caretOffset <= offset` — so the
  // backward test is "the highlight sits at or after the caret", NOT the other way round.
  const after = forward ? relative > 0 : relative >= 0
  const currentAfter = forward ? currentRelative > 0 : currentRelative >= 0
  // :127 / :130 — when the two sit on opposite sides of the caret, the candidate that falls
  // on the searched side wins: later than the caret going forward, earlier going back.
  if (after !== currentAfter) return forward ? after : relative < 0
  // :127 / :130 — otherwise the nearest one wins: the smaller offset forward, the larger back.
  return forward ? relative < currentRelative : relative > currentRelative
}

/**
 * GotoNextErrorHandler.findInfo() (:93-114): the highlight to navigate to, or null when the
 * file has none. `forward` is GotoNextError (true) / GotoPreviousError (false).
 */
export function nextErrorTarget<T extends ErrorDiagnostic>(
  diagnostics: readonly T[], caret: ErrorLocation, forward: boolean,
): T | null {
  if (!diagnostics.length) return null

  // :72-89 — the highest level present wins outright, then the search happens inside it.
  let tier = WEAK_WARNING_TIER
  for (const item of diagnostics) {
    const candidate = errorTier(item.severity)
    if (candidate < tier) tier = candidate
  }

  // processHighlights walks the highlights in document order, so a stable sort reproduces
  // the order the comparison above relies on for ties.
  const pool = diagnostics.filter(item => errorTier(item.severity) === tier).slice()
  pool.sort(comparePosition)

  let best: T | null = null
  for (const item of pool) if (betterThan(best, item, caret, forward)) best = item
  // The `caretOffsetIfNoLuck` bucket (:97, :104-107) is what turns "nothing ahead" into the
  // first highlight of the file; the backward direction always has a candidate by then.
  return best ?? pool[0]!
}
