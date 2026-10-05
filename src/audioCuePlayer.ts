// 音频提示的**播放**（WebAudio 合成音）—— 上游播 `sounds/*.wav`，本仓不往发行包里塞音频：
// `AudioCue` 的 `resource` 那一栏在本仓换成 `tone`（频率/时长/波形），语义（哪个 cue 什么时候响）
// 一个字没改。用法与职责见 src/audioCues.ts 的模块头。
//
// 播放本身要能被关掉（设置 `audioCuesMode`）、能被测试替身接住（`createAudioCuePlayer` 注入
// `contextFactory`），所以这里只有"把 cue 变成一次短音"这一件事，不含任何判断逻辑。
import { cueById, type AudioCueId } from './audioCues.ts'

export interface AudioCuePlayer {
  /** 播一个 cue（换文件/关静音/无声环境都不抛错，静默失败）。 */
  play: (id: AudioCueId) => void
  /** 关掉（组件卸载时调用；之后 play 是空操作）。 */
  dispose: () => void
}

export interface AudioCuePlayerDeps {
  /** 当前是不是开着音频提示（每次播放前读一次，设置改了立刻生效）。 */
  enabled: () => boolean
  /** 测试替身用；默认 `new AudioContext()`（懒创建，第一次播放时才建）。 */
  contextFactory?: () => AudioContext | null
}

export function createAudioCuePlayer(deps: AudioCuePlayerDeps): AudioCuePlayer {
  let context: AudioContext | null = null
  let disposed = false

  const ensureContext = (): AudioContext | null => {
    if (disposed) return null
    if (context) return context
    try {
      context = deps.contextFactory ? deps.contextFactory() : new AudioContext()
    } catch {
      context = null   // 没有音频设备 / 浏览器策略不允许：静默（屏幕阅读器用户另有 SR 通道）
    }
    return context
  }

  return {
    play(id) {
      if (disposed || !deps.enabled()) return
      const audio = ensureContext()
      if (!audio) return
      const { tone } = cueById(id)
      try {
        const oscillator = audio.createOscillator()
        const gain = audio.createGain()
        oscillator.type = tone.type
        oscillator.frequency.value = tone.frequency
        // 两端各留 5ms 斜坡：方波直接开关会有咔哒声（上游是现成 wav，没这个问题）。
        const now = audio.currentTime
        const seconds = tone.durationMs / 1000
        gain.gain.setValueAtTime(0, now)
        gain.gain.linearRampToValueAtTime(0.08, now + 0.005)
        gain.gain.setValueAtTime(0.08, now + Math.max(0.005, seconds - 0.005))
        gain.gain.linearRampToValueAtTime(0, now + seconds)
        oscillator.connect(gain)
        gain.connect(audio.destination)
        oscillator.start(now)
        oscillator.stop(now + seconds)
      } catch {
        /* 播放失败不该影响编辑 */
      }
    },
    dispose() {
      disposed = true
      try { void context?.close() } catch { /* 已经关了 */ }
      context = null
    },
  }
}
