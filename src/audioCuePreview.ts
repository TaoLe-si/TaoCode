// 音频提示设置页的**试听**（上游 `AudioCuePlayer.preview` + `AudioCuesConfigurable` 的两个触发点）。
//
// 上游坐标：
//   · `AudioCuePlayer.preview`（`platform/platform-impl/src/com/intellij/ide/audioCues/AudioCuePlayer.kt:34-36`）
//     `fun preview(vararg cues: AudioCue) { if (cues.isNotEmpty()) playEnabled(cues.distinctBy { it.id }) }`
//     —— **直接** `playEnabled`，既不过 `play()` 的那道 `cues.filter(settings::isCueEnabled)`
//     （`:26`），也不看 mode。所以试听的是「这个音长什么样」，不是「现在会不会响」。
//   · 触发点一：勾选框上的 `.actionListener { _, _ -> player.preview(cue) }`
//     （`AudioCuesConfigurable.kt:49`）—— 复选框上**任何**动作（鼠标点、聚焦后按空格/回车）都试听。
//   · 触发点二：`.applyToComponent { whenFocusGained { e -> when (e.cause) {
//       FocusEvent.Cause.TRAVERSAL_FORWARD, FocusEvent.Cause.TRAVERSAL_BACKWARD -> player.preview(cue) } } }`
//     （`AudioCuesConfigurable.kt:50-57`）—— **只有**键盘遍历导致的聚焦才试听；
//     `else -> {}` 明确表示鼠标点击引起的聚焦不试听（那一次已经由 `:49` 覆盖了）。
//
// 与上游的架构差别（照实记）：上游是 Swing，`FocusEvent.Cause` 是 AWT 给的；本仓是 DOM，
// `focus` 事件不带 cause。`shouldPreviewOnFocus` 因此收一个由调用方判定的 cause 字符串，
// 判定本身在页面里（`mousedown` ⇒ 指针、`keydown` ⇒ 键盘），规则集中在本模块便于判据。
import { createAudioCuePlayer, type AudioCuePlayer } from './audioCuePlayer.ts'
import type { AudioCueId } from './audioCues.ts'

/** 聚焦的成因。`pointer` = 指针点过来的（上游 `FocusEvent.Cause` 落在 `else` 分支，不试听）。 */
export type PreviewFocusCause = 'traversal-forward' | 'traversal-backward' | 'pointer' | 'other'

/**
 * `AudioCuesConfigurable.kt:51-56` 的 `when (e.cause)`：只有 `TRAVERSAL_FORWARD` /
 * `TRAVERSAL_BACKWARD` 试听，其余（含指针点击）不试听。
 */
export function shouldPreviewOnFocus(cause: PreviewFocusCause): boolean {
  return cause === 'traversal-forward' || cause === 'traversal-backward'
}

/**
 * `AudioCuePlayer.preview`（`AudioCuePlayer.kt:34-36`）**绕过** `isCueEnabled`
 * （mode 档 + 逐 cue 停用表，`AudioCuesSettings.kt:44-47`）。
 * 本仓 `createAudioCuePlayer` 的门是注入的 `enabled` 回调（`src/audioCuePlayer.ts:39`），
 * 试听专用实例恒给 `true` 即等价于上游那道 `playEnabled` 直调。
 */
export const PREVIEW_BYPASSES_CUE_GATES = true

export interface AudioCuePreviewerDeps {
  /** 判据用替身；默认走 WebAudio（`createAudioCuePlayer`，与 `audioCueHost` 同一份播放器实现）。 */
  player?: AudioCuePlayer
  /** 测试替身用；透传给 `createAudioCuePlayer`。 */
  contextFactory?: () => AudioContext | null
}

export interface AudioCuePreviewer {
  /** 试听一个 cue（`preview(cue)`，`:34-36` 的 `distinctBy { it.id }` 在单 cue 调用下无意义，略）。 */
  preview: (id: AudioCueId) => void
  /** 页面卸载时关掉 AudioContext。 */
  dispose: () => void
}

export function createAudioCuePreviewer(deps: AudioCuePreviewerDeps = {}): AudioCuePreviewer {
  const player = deps.player ?? createAudioCuePlayer({
    enabled: () => PREVIEW_BYPASSES_CUE_GATES,
    ...(deps.contextFactory ? { contextFactory: deps.contextFactory } : {}),
  })
  return {
    preview(id) { player.play(id) },
    dispose() { player.dispose() },
  }
}
