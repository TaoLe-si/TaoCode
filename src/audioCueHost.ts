// 音频提示的**宿主侧状态域**：把「诊断表变了」「代码折叠了」这两件事折成一次播放。
//
// 分工（照本仓已有的三层拆法）：
//   · `src/audioCues.ts`      纯规则（六个 cue 的表 / 优先级 / 节流窗口 / 判定函数）；
//   · `src/audioCuePlayer.ts` 播放（WebAudio 合成音，开关门控）；
//   · 本模块                  接线：记住上一次的诊断快照与上次播放时刻，决定**要不要**播。
//
// 上游对应物：`EditorAudioCuesManager`（节流 + 按 mode 播）+ 两个探测器
// （`ErrorWarningAudioCueDetector` / `FoldedCodeAudioCueDetector`）。
import { ref, type Ref } from 'vue'
import {
  CUE_DEDUPE_WINDOW_MS, cueForDiagnostics, cueForFold, detectDiagnosticCues, detectFoldedCues,
  diagnosticsChanged, disabledCueIds, isAudioCueMode,
  isAudioCueModeOn, isCueEnabled, pickCue, settleCues, settleDelayMs, shouldPlay, TYPING_WINDOW_MS,
  toDiagnosticLike, type AudioCueId, type DiagnosticLike, type PendingCue,
} from './audioCues.ts'
import { createAudioCuePlayer, type AudioCuePlayer } from './audioCuePlayer.ts'
import type { LspDiagnostic } from './bridge.ts'

export interface AudioCueHostDeps {
  /**
   * 应用级设置（`generalSettings`）——`audioCuesMode` 与两个相关项就在里面：
   * `supportScreenReaders` 当 AUTO 档的屏幕阅读器探针；`audioCuesDisabled` 是可选的逐 cue 停用表。
   */
  settings: Ref<{ audioCuesMode?: unknown; supportScreenReaders?: unknown; audioCuesDisabled?: unknown }>
  /** 当前活动文件的路径（折叠/诊断都只对活动文件响）。 */
  activePath: { readonly value: string }
  /** 当前光标行（1 基）。 */
  caretLine: () => number
  /** 播放器替身（判据用）；默认走 WebAudio。 */
  player?: AudioCuePlayer
  /** 时钟（判据用），默认 `Date.now`。 */
  now?: () => number
  /**
   * 光标停靠用的定时器（上游 `EditorAudioCuesManager.kt:131` 的 `debounce` + `collectLatest`）：
   * 默认就是上游那两档时长（停 50ms，紧挨着编辑停 1000ms，见 `src/audioCues.ts` 的
   * `settleDelayMs`），连按方向键只响一次。判据里注入替身可以同步驱动这一拍。
   */
  schedule?: (run: () => void, delayMs: number) => (() => void) | null
  /**
   * 当前文件**此刻折着**的那些行的起始行号（1 基）—— 上游那份是问 `FoldingModelEx`
   * （`FoldedCodeAudioCueDetector.kt:19-24`）。本仓的编辑器只上报「刚刚折起了哪一行」这一个事件，
   * 没有可查的当前折叠集合 ⇒ 不给这一项时，光标移到折叠行**不响**（只有折叠那一下响），
   * 补这条链路要编辑器侧上报折叠起点全集（见报告的接线请求）。
   */
  foldedLines?: () => readonly number[]
}

export interface AudioCueHost {
  /** 诊断表变了就播一次（内部先比对快照，没变不播）。 */
  noteDiagnostics: (path: string, items: readonly LspDiagnostic[]) => void
  /** 刚折起来一行（1 基）时调用。 */
  noteFold: (line: number) => void
  /**
   * 光标行变化：这一行的探测器接管（上游 `EditorAudioCueDetector` EP ——
   * `ErrorWarningAudioCueDetector.kt:16-36` 与 `FoldedCodeAudioCueDetector.kt:13-26` 都是
   * **按光标所在行**问的），停稳一拍再响：`EditorAudioCuesManager.kt:131` 的 `debounce`。
   */
  setCaretLine: (line: number) => void
  /** 关标签/切文件时清掉快照，避免把上一个文件的诊断差额算到新文件头上。 */
  reset: (path?: string) => void
  /** 最近播过什么（状态栏/调试可读，也方便判据断言）。 */
  lastCue: Ref<AudioCueId | null>
  dispose: () => void
}

export function createAudioCueHost(deps: AudioCueHostDeps): AudioCueHost {
  const now = deps.now ?? (() => Date.now())
  const player = deps.player ?? createAudioCuePlayer({ enabled: () => meansOn(deps.settings) })
  const lastCue = ref<AudioCueId | null>(null)
  let last: PendingCue | null = null
  let snapshotPath = ''
  let snapshot: DiagnosticLike[] = []
  let caretLine = 1
  // 上游 `EditorAudioCuesManager.LAST_SETTLED_LINE`（`:59`）：上一次**探测过**的那一行。
  // 它决定这一拍算"到新行"还是"同一行内继续走"（`:145-147`），两者播的档位不同。
  let settledLine: number | null = null

  function meansOn(settings: AudioCueHostDeps['settings']): boolean {
    // 三档：默认 off（本仓设置默认值）时静默；AUTO 档由 `supportScreenReaders` 当探针
    // （上游 AUTO 用 `ScreenReader.isActive()`，DOM 探测不到系统屏幕阅读器，详见 audioCues.ts）。
    const mode = settings.value.audioCuesMode
    const current = isAudioCueMode(mode) ? mode : 'off'
    return isAudioCueModeOn(current, settings.value.supportScreenReaders === true)
  }

  function cueAllowed(id: AudioCueId): boolean {
    const mode = deps.settings.value.audioCuesMode
    const current = isAudioCueMode(mode) ? mode : 'off'
    return isCueEnabled(id, current, deps.settings.value.supportScreenReaders === true, disabledCueIds(deps.settings.value.audioCuesDisabled))
  }

  function fire(id: AudioCueId): void {
    // 逐 cue 停用（`AudioCuesSettings.isCueEnabled`）与节流都在这一拍判：停用的 cue 连节流都不占。
    if (!cueAllowed(id)) return
    const at = now()
    if (!shouldPlay(id, last, at, CUE_DEDUPE_WINDOW_MS)) return
    last = { id, at }
    lastCue.value = id
    player.play(id)
  }

  // ── 光标这一路的探测（`EditorAudioCuesManager` 的那套 settle 规则）───────────────────────
  //
  // 上游的探测器是**按光标所在行**问的（`ErrorWarningAudioCueDetector.kt:20-33` 取
  // `lineStart..lineEnd` 重叠的高亮，`FoldedCodeAudioCueDetector.kt:15-24` 同理），
  // 并且每一次光标移动都要先停稳 `ide.audio.cues.editor.settle.delay.ms`（默认 50ms；
  // 紧挨着一次编辑时是 1000ms，`EditorAudioCuesManager.kt:65,131`）才真的探测 ——
  // 连按方向键一路走只响一声。本仓原来的 `setCaretLine` 只把行号记下来给别的探测器用，
  // 光标自己走到一条错误行上是**不响**的，这就是缺的那一条。
  let lastDiagnosticAt = 0
  let cancelSettle: (() => void) | null = null

  /** 上游 `TYPING_WINDOW`（`:68`，100ms）：诊断表刚变过 ⇒ 这次移动属于那次编辑，停得更久。 */
  function editAdjacent(): boolean {
    return lastDiagnosticAt !== 0 && now() - lastDiagnosticAt <= TYPING_WINDOW_MS
  }

  function detectAndPlay(): void {
    // 没有活动文件就没有诊断快照。
    if (!deps.activePath.value) return
    const line = caretLine
    const lineChanged = settledLine !== line
    // 上游在探测之后无条件把这一行记成"已停靠"（`EditorAudioCuesManager.kt:145-146`），
    // 没有探测到东西也算停过了 —— 否则下一次停在同一行会被当成"换行"重播 line 档。
    settledLine = line
    // 折叠那一档只有宿主给了"当前折着的行"才探得到；本仓的编辑器现在只上报
    // 「刚刚折起了哪一行」（`CodeEditor.vue:1025-1027` 的 foldedSeen 只报新增），
    // 展开没有事件，自己攒一份集合会在展开后响错 ⇒ 不攒，等宿主喂（见报告的接线请求）。
    const cues = [...detectDiagnosticCues(snapshot, line), ...detectFoldedCues(deps.foldedLines?.() ?? [], line)]
    if (!cues.length) return
    // 上游 `processCaretPosition`（`:145-152`）：换了行播 line 档（caret 档在它细化的 line 档也响且没被停用时静音），
    // 同一行内再停一次只播 caret 档。
    for (const id of settleCues(cues, lineChanged, cueAllowed)) fire(id)
  }

  function scheduleSettle(): void {
    const delayMs = settleDelayMs(editAdjacent())
    const run = deps.schedule ?? ((handler: () => void, ms: number) => {
      const timer = setTimeout(handler, ms)
      return () => clearTimeout(timer)
    })
    if (cancelSettle !== null) cancelSettle()
    cancelSettle = run(detectAndPlay, delayMs) ?? null
  }

  return {
    noteDiagnostics(path, items) {
      const next = toDiagnosticLike(items, path)
      const sameFile = snapshotPath === path
      const changed = !sameFile || diagnosticsChanged(snapshot, next)
      snapshotPath = path
      snapshot = next
      // 上游 documentListener 记的 `LAST_DOCUMENT_CHANGE_AT`（`:60`、`:106`、`:111`）——
      // 本仓没有裸的文档变更事件，诊断表变了就是"刚编辑过"的那个时刻。
      if (changed) lastDiagnosticAt = now()
      if (!changed) return
      const cue = cueForDiagnostics(next, caretLine)
      if (cue) fire(cue)
    },
    noteFold(line) {
      if (!deps.activePath.value) return
      fire(cueForFold(line, caretLine))
    },
    setCaretLine(line) {
      if (!(line > 0)) return
      const previous = caretLine
      caretLine = line
      // 上游 `caretPositionChanged` 第一句就是 `if (e.oldPosition == e.newPosition) return`（`:83`）；
      // 本仓只拿到行号，所以同步行移动在这里被吃掉。
      if (line === previous && settledLine === line) return
      // **第一次**上报只立基线不响：上游那条"程序化移动（开文件恢复光标、折叠恢复…）
      // 静默把 settled line 挪过去"的分支（`:87-92`）。App.vue 的 watch 带 `immediate: true`，
      // 装配时就会来一次，没有这一步的话每次开文件都可能凭空响一声。
      if (settledLine === null) { settledLine = line; return }
      scheduleSettle()
    },
    reset(path) {
      if (path !== undefined && path !== snapshotPath) return
      if (cancelSettle !== null) { cancelSettle(); cancelSettle = null }
      snapshot = []; snapshotPath = ''
      settledLine = null
      lastDiagnosticAt = 0
    },
    lastCue,
    dispose() {
      if (cancelSettle !== null) { cancelSettle(); cancelSettle = null }
      player.dispose()
    },
  }
}

export { pickCue }
