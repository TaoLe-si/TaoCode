// 音频提示（无障碍）—— IDEA `com.intellij.ide.audioCues` 那一族的等价物。
//
// 逐条对照的上游源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · `IdeAudioCues.kt`：六个 cue，**id / 优先级 / 资源**三件都抄下来 ——
//       `error.line` 20、`error.caret` 30、`warning.line` 40、`warning.caret` 50、
//       `folded.line` 130、`folded.caret` 140；资源分别是 `sounds/error.wav`、`sounds/warning.wav`、
//       `sounds/code_folding.wav`（`:13-39` 的 `AudioCue(id, messagePointer, resource, OWNER, priority)`）。
//       `line` = 光标**不在**那一行（屏幕阅读器读不到），`caret` = 光标就在那一行。
//   · `IdeAudioCueProvider`（`IdeAudioCues.kt:42-46`）：六个 cue 一起注册进 `AudioCueProvider`。
//   · `AudioCuesSettings`（`AudioCuesSettings.kt:17-24`）：`@State(name="AudioCues",
//     storages=[Storage("audiocues.xml")])`，有一个 `mode`；`EditorAudioCuesManager` 按 mode 决定
//     播不播、并按优先级**节流**（同一时刻只播最高优先级的那个）。
//   · 三个探测器：`EditorAudioCueDetector`（光标行的诊断）、`ErrorWarningAudioCueDetector`
//     （诊断变化）、`FoldedCodeAudioCueDetector`（代码被折叠）。
//
// **本仓的三点如实差异**（都写在这里，不藏在别处）：
//   1. 上游播 wav；本仓用 **WebAudio 合成音**（不往发行包里塞二进制音频，也不引新依赖）——
//      音高/时长按 cue 语义定：error 低而短、warning 中、folded 轻。
//   2. 上游按「屏幕阅读器开着」自动决定（`AudioCuesSettings.kt:85-89` 的 `AudioCuesMode.isOn`：
//      AUTO 看 `ScreenReader.isActive()`、ON 恒真、OFF 恒假），默认档是 **AUTO**
//      （`AudioCuesSettingsState.mode = AudioCuesMode.AUTO`，`:70`）；本仓给同一个设置
//      `audioCuesMode`（三档 auto/on/off 同名同义），但默认档是 **off** —— 这是一处**有意偏离**，
//      差异记在 `src/settingsModel.ts` 的字段注释与 `docs/settings-parity.md` §21。
//   3. 上游三个探测器的**触发时机**要读 PSI/编辑器事件；本仓接的是已有数据流：
//      诊断表变化（`lspDiagnostics`）与折叠动作（`foldedRanges` 的变化由调用方喂进来）。
import type { LspDiagnostic } from './bridge.ts'

export type AudioCueId =
  | 'error.line' | 'error.caret' | 'warning.line' | 'warning.caret'
  | 'folded.line' | 'folded.caret'

export interface AudioCueDefinition {
  id: AudioCueId
  /** 上游 `IdeBundle` 的显示名（中文包）。 */
  label: string
  /** 上游的优先级：数字越小越先播（`IdeAudioCues.kt` 里的第 5 个实参）。 */
  priority: number
  /** 合成音参数（替代上游的 wav 资源）。 */
  tone: { frequency: number; durationMs: number; type: OscillatorType }
}

/** 六个 cue，id / 优先级逐条抄上游；音色是本仓的等价物。 */
export const AUDIO_CUES: readonly AudioCueDefinition[] = [
  { id: 'error.line', label: '错误（光标不在该行）', priority: 20, tone: { frequency: 220, durationMs: 120, type: 'square' } },
  { id: 'error.caret', label: '错误（光标所在行）', priority: 30, tone: { frequency: 260, durationMs: 120, type: 'square' } },
  { id: 'warning.line', label: '警告（光标不在该行）', priority: 40, tone: { frequency: 440, durationMs: 90, type: 'triangle' } },
  { id: 'warning.caret', label: '警告（光标所在行）', priority: 50, tone: { frequency: 494, durationMs: 90, type: 'triangle' } },
  { id: 'folded.line', label: '代码被折叠（光标不在该行）', priority: 130, tone: { frequency: 660, durationMs: 50, type: 'sine' } },
  { id: 'folded.caret', label: '代码被折叠（光标所在行）', priority: 140, tone: { frequency: 740, durationMs: 50, type: 'sine' } },
]

export const AUDIO_CUE_IDS = AUDIO_CUES.map(cue => cue.id)

export function cueById(id: AudioCueId): AudioCueDefinition {
  const cue = AUDIO_CUES.find(entry => entry.id === id)
  if (!cue) throw new Error(`未知的音频提示：${id}`)
  return cue
}

/** `AudioCuesSettingsState.mode`：三档，与上游 `AudioCuesMode` 的 AUTO/ON/OFF 同名同义。 */
export const AUDIO_CUE_MODES = ['auto', 'on', 'off'] as const
export type AudioCueMode = (typeof AUDIO_CUE_MODES)[number]

export function isAudioCueMode(value: unknown): value is AudioCueMode {
  return typeof value === 'string' && (AUDIO_CUE_MODES as readonly string[]).includes(value)
}

/**
 * `AudioCuesMode.isOn`（`AudioCuesSettings.kt:84-88`）：AUTO 看屏幕阅读器是否开着、ON 恒真、OFF 恒假。
 * 上游 AUTO 用 `ScreenReader.isActive()` 探测；DOM 宿主探测不到系统屏幕阅读器，本仓用
 * 「支持屏幕阅读器」设置（`supportScreenReaders`，`GeneralSettingsState.kt:265`）当探针 ——
 * 这是用户自己声明的状态，语义与上游一致，只是来源不同（如实记在族判词里）。
 */
export function isAudioCueModeOn(mode: AudioCueMode, screenReaderActive: boolean): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return screenReaderActive
}

/** `AudioCuesSettingsState.disabledCues`：逐 cue 停用的 id 集合（存的是 id 列表，容忍坏值）。 */
export function disabledCueIds(value: unknown): Set<string> {
  const out = new Set<string>()
  if (Array.isArray(value)) {
    for (const item of value) if (typeof item === 'string' && item) out.add(item)
  }
  return out
}

/** `AudioCuesSettings.isCueEnabled`：mode 开着**且**这个 cue 不在停用表里。 */
export function isCueEnabled(
  id: AudioCueId, mode: AudioCueMode, screenReaderActive: boolean, disabled: ReadonlySet<string> = new Set(),
): boolean {
  return isAudioCueModeOn(mode, screenReaderActive) && !disabled.has(id)
}

/** `AudioCuesSettings.setCueEnabled`：返回新的停用集合（enable=true 从表里去掉，否则加入）。 */
export function setCueEnabled(disabled: ReadonlySet<string>, id: AudioCueId, enabled: boolean): Set<string> {
  const next = new Set(disabled)
  if (enabled) next.delete(id)
  else next.add(id)
  return next
}

/**
 * 同一时刻只播一个：按优先级取最小的（上游 `EditorAudioCuesManager` 的节流）。
 * `windowMs` 内的重复 cue 也要并掉 —— 一次编辑可能同时触发好几条诊断。
 */
export const CUE_DEDUPE_WINDOW_MS = 700

export interface PendingCue { id: AudioCueId; at: number }

/** 从一批候选里挑要播的那个（优先级最小；同优先级按给定顺序取第一个）。 */
export function pickCue(candidates: readonly AudioCueId[]): AudioCueId | null {
  let best: AudioCueId | null = null
  let bestPriority = Number.POSITIVE_INFINITY
  for (const id of candidates) {
    const priority = cueById(id).priority
    if (priority < bestPriority) { best = id; bestPriority = priority }
  }
  return best
}

/** 节流：距上一次播放不足一个窗口就丢掉（同一个 cue 反复触发同理）。 */
export function shouldPlay(candidate: AudioCueId, last: PendingCue | null, now: number, windowMs = CUE_DEDUPE_WINDOW_MS): boolean {
  if (last === null) return true
  return now - last.at >= windowMs
}

export interface DiagnosticLike { severity: number; path?: string; line: number }

/**
 * `EditorAudioCueDetector`（`:1-80`）的等价判定：给诊断表（按文件）与当前光标行，
 * 挑出该播的 cue —— 光标行上的诊断优先（caret 档），否则 line 档；错误优先于警告。
 */
export function cueForDiagnostics(diagnostics: readonly DiagnosticLike[], caretLine: number): AudioCueId | null {
  // 分两档收集：光标行上的一档、其余一档 —— 先在两档内各自按优先级取（错误 > 警告），
  // 再让 caret 档压过 line 档（与函数头上的判定规则一致；优先级数字跨档不可直接比）。
  const caret: AudioCueId[] = []
  const line: AudioCueId[] = []
  for (const diagnostic of diagnostics) {
    const onCaret = diagnostic.line === caretLine
    const target = onCaret ? caret : line
    if (diagnostic.severity === 1) target.push(onCaret ? 'error.caret' : 'error.line')
    else if (diagnostic.severity === 2) target.push(onCaret ? 'warning.caret' : 'warning.line')
  }
  return pickCue(caret) ?? pickCue(line)
}

/** `FoldedCodeAudioCueDetector`：折叠发生在光标行上就是 caret 档，否则 line 档。 */
export function cueForFold(foldedLine: number, caretLine: number): AudioCueId {
  return foldedLine === caretLine ? 'folded.caret' : 'folded.line'
}

/** 「诊断表变了没有」：按 entry 比较（同一条诊断的行/严重度/消息），顺序无关。 */
export function diagnosticsChanged(before: readonly DiagnosticLike[], after: readonly DiagnosticLike[]): boolean {
  if (before.length !== after.length) return true
  const key = (entry: DiagnosticLike) => `${entry.severity}:${entry.line}:${entry.path ?? ''}`
  const left = before.map(key).sort()
  const right = after.map(key).sort()
  return left.some((value, index) => value !== right[index])
}

// ── 光标停靠（settle）的三个时长：上游 `EditorAudioCuesManager` 的常数 ──────────────────────
//
// 上游把**每一次**光标移动都丢进一条 `debounce` 流（`EditorAudioCuesManager.kt:130-135`），
// 光标停稳了才探测、才响 —— 一路按方向键不该响十次。
//
// 本仓为什么把 settle 只用在光标这一路：App.vue 接的是 `watch(() => active.value?.line)`，
// 行号不变时根本没有事件（同步行移动不产生新拍），也就是事件源本身已经按行去重了一次；
// 上游那份 debounce 防的是同一个字符位置上的重复 CaretEvent。

/** `ide.audio.cues.editor.settle.delay.ms` 的默认值（`intellij.platform.ide.impl.xml:494-499`，读法见 `EditorAudioCuesManager.kt:52-54`）。 */
export const AUDIO_CUES_SETTLE_MS = 50
/** `EDIT_ADJACENT_SETTLE_DELAY`（`EditorAudioCuesManager.kt:65`）：紧挨着一次编辑时停得更久。 */
export const EDIT_ADJACENT_SETTLE_MS = 1000
/** `TYPING_WINDOW`（`EditorAudioCuesManager.kt:68`）：文档变更后这么久以内的光标移动算"属于那次编辑"。 */
export const TYPING_WINDOW_MS = 100

/** 该停多久才探测：紧挨着编辑（`editAdjacent`）用 1000ms，否则用注册表默认的 50ms。 */
export function settleDelayMs(editAdjacent: boolean): number {
  return editAdjacent ? EDIT_ADJACENT_SETTLE_MS : AUDIO_CUES_SETTLE_MS
}

/** LSP 诊断（`LspDiagnostic.line` 是 0 基）折成本模块要的形状（1 基行）。 */
export function toDiagnosticLike(items: readonly LspDiagnostic[], path: string): DiagnosticLike[] {
  return items.map(item => ({ severity: item.severity ?? 1, line: item.line + 1, path }))
}

// ── 探测器（上游 `EditorAudioCueDetector` EP 的两个实现）────────────────────────────────────
//
// `EditorAudioCue`（`platform/platform-impl/src/com/intellij/ide/audioCues/EditorAudioCueDetector.kt:23-27`）
// 不只是一个 cue id，还带 `lineCounterpart` —— "这条 caret 档是在细化哪条 line 档"。
// 那两个探测器给的集合是**可能同时含 line 与 caret 两档**的（`ErrorWarningAudioCueDetector.kt:29-32`、
// `FoldedCodeAudioCueDetector.kt:19-24`），怎么从集合里挑着播由 `settleCues` 决定。

/** 上游 `EditorAudioCue(cue, lineCounterpart)`：caret 档带着它细化的那条 line 档。 */
export interface DetectedCue {
  id: AudioCueId
  /** 这条是 caret 档时，它细化的 line 档（line 档自己 = undefined）。 */
  lineCounterpart?: AudioCueId
}

/** `ErrorWarningAudioCueDetector.detect`（`:16-36`）：这一行压着的诊断 → line 档，光标就在上面时再加 caret 档。 */
export function detectDiagnosticCues(diagnostics: readonly DiagnosticLike[], line: number): DetectedCue[] {
  const found: DetectedCue[] = []
  const add = (id: AudioCueId) => { if (!found.some(entry => entry.id === id)) found.push({ id }) }
  const addCaret = (id: AudioCueId, lineCounterpart: AudioCueId) => {
    add(lineCounterpart)
    const caretEntry = found.find(entry => entry.id === id)
    if (caretEntry) caretEntry.lineCounterpart = lineCounterpart
    else found.push({ id, lineCounterpart })
  }
  for (const diagnostic of diagnostics) {
    // 上游按 `lineStart..lineEnd` 取**重叠**的高亮（`processRangeHighlightersOverlappingWith`），
    // 并跳过文件级注释（`!info.isFileLevelAnnotation`）；本仓的诊断快照是行粒度的
    // （`LspDiagnostic` 只保证行号，多行区间的 endLine 由生产方按需给），所以重叠判据退化成行相等。
    if (diagnostic.line !== line) continue
    if (diagnostic.severity === 1) addCaret('error.caret', 'error.line')
    else if (diagnostic.severity === 2) addCaret('warning.caret', 'warning.line')
  }
  return found
}

/** `FoldedCodeAudioCueDetector.detect`（`:13-26`）：这一行有折叠区间 → folded.line，光标压在上面再加 folded.caret。 */
export function detectFoldedCues(foldedLines: readonly number[], line: number): DetectedCue[] {
  if (!foldedLines.includes(line)) return []
  return [{ id: 'folded.line' }, { id: 'folded.caret', lineCounterpart: 'folded.line' }]
}

/**
 * `EditorAudioCuesManager.processCaretPosition`（`EditorAudioCuesManager.kt:143-152`）的挑选规则：
 *   · **换了行**：整组都算数；**没换行**：只保留带 `lineCounterpart` 的那几条（caret 档），
 *     于是同一行内的移动不会把 line 档重播一遍（`:145-147`）；
 *   · 一条 caret 档，如果它细化的那条 line 档**也在这一组里且没被停用**，就把它静音
 *     （`:148-151`：`counterpart != null && scoped.any { it.cue === counterpart } && settings.isCueEnabled(counterpart)`）
 *     —— 一行同时给出 line 与 caret 两档时，播的是 line 档。
 * `cueEnabled` 是宿主那一侧的逐条开关（上游 `AudioCuesSettings.isCueEnabled`）。
 */
export function settleCues(
  cues: readonly DetectedCue[], lineChanged: boolean, cueEnabled: (id: AudioCueId) => boolean,
): AudioCueId[] {
  const scoped = lineChanged ? [...cues] : cues.filter(cue => cue.lineCounterpart !== undefined)
  return scoped
    .filter(cue => {
      const counterpart = cue.lineCounterpart
      if (!counterpart) return true
      return !(scoped.some(other => other.id === counterpart) && cueEnabled(counterpart))
    })
    .map(cue => cue.id)
}
