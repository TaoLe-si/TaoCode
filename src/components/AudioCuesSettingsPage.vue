<script setup lang="ts">
// 「外观与行为 › 音频提示」页 —— 上游 `AudioCuesConfigurable`（`ide.audiocues`）。
//
// 注册证据：`platform/platform-impl/resources/intellij.platform.ide.impl.xml:971-976`
//   `<applicationConfigurable groupId="appearance" groupWeight="140" id="ide.audiocues"
//      provider="com.intellij.ide.audioCues.AudioCuesConfigurableProvider" …/>`
// 面板照 `AudioCuesConfigurable.kt:27-61` 的 `panel {}` 逐段：
//   · 一行说明（`:31-33`）→ 本页 section-description；
//   · mode 下拉绑 `settings.state.mode`（`:36-40`），选项是 `AudioCuesMode.entries`（三档，
//     `AudioCuesSettings.kt:75-79`）；
//   · `indent { … }` 里每个 cue 一个复选框，勾选态 = `cue.id !in state.disabledCues`、
//     勾选回调 = `settings.setCueEnabled(cue, checked)`（`:42-59`）；
//   · 那一整块 `enabledIf(mode != OFF)`（`:60`）—— 关掉时逐 cue 的勾选无意义，本页照做。
//
// 上游的试听在两个地方，本页都接上了：勾选框上任何动作（`.actionListener { player.preview(cue) }`
// `AudioCuesConfigurable.kt:49`），以及键盘遍历导致的聚焦（`whenFocusGained` + `TRAVERSAL_FORWARD`/
// `TRAVERSAL_BACKWARD`，`:50-57`；`else -> {}` 表示鼠标点击引起的聚焦不试听，那一次已由 `:49` 覆盖）。
// 规则在 `src/audioCuePreview.ts`（含「试听绕过 mode 与逐 cue 停用表」这条，
// `AudioCuePlayer.kt:34-36` 的 `preview` 直调 `playEnabled`）；DOM 没有 `FocusEvent.Cause`，
// 成因由本页用「上一次交互是 mousedown 还是 keydown」判定，如实记在那个模块头上。
//
// `settings` 是对话框那份**同一个** general 草稿对象，保存仍由对话框的「应用」统一做。
import { computed, onBeforeUnmount } from 'vue'
import { AUDIO_CUES, disabledCueIds, isAudioCueMode, setCueEnabled, type AudioCueId, type AudioCueMode } from '../audioCues.ts'
import { createAudioCuePreviewer, shouldPreviewOnFocus, type PreviewFocusCause } from '../audioCuePreview.ts'
import type { GeneralSettingsState } from '../settingsModel'

const props = defineProps<{ settings: GeneralSettingsState; busy?: boolean }>()

const previewer = createAudioCuePreviewer()
onBeforeUnmount(() => previewer.dispose())
// 指针点过之后的那一次聚焦不算键盘遍历（上游 `FocusEvent.Cause` 的 else 分支）。
let lastInteractionWasPointer = false
function markPointer() { lastInteractionWasPointer = true }
function markKeyboard() { lastInteractionWasPointer = false }
function focusCause(): PreviewFocusCause {
  if (!lastInteractionWasPointer) return 'traversal-forward'
  lastInteractionWasPointer = false
  return 'pointer'
}

/** `AudioCuesSettingsState.mode`：坏值兜到 off（与 `audioCueHost` 的 `isAudioCueMode` 同一判据）。 */
const mode = computed<AudioCueMode>(() => (isAudioCueMode(props.settings.audioCuesMode) ? props.settings.audioCuesMode : 'off'))
const disabled = computed(() => disabledCueIds(props.settings.audioCuesDisabled))
/** `.enabledIf(mode != AudioCuesMode.OFF)`（`AudioCuesConfigurable.kt:60`）。 */
const cuesEnabled = computed(() => mode.value !== 'off')

function setMode(value: string) {
  if (isAudioCueMode(value)) props.settings.audioCuesMode = value
}

function toggleCue(id: AudioCueId, checked: boolean) {
  // `AudioCuesSettings.setCueEnabled`（:49-53）：勾上就从停用表里去掉，勾掉就加回去。
  props.settings.audioCuesDisabled = [...setCueEnabled(disabled.value, id, checked)]
  // `.actionListener { _, _ -> player.preview(cue) }`（`AudioCuesConfigurable.kt:49`）：任何动作都试听。
  previewer.preview(id)
}
</script>

<template>
  <h3>外观与行为 › 音频提示</h3>
  <p class="section-description">
    对应 IDEA Settings › Appearance &amp; Behavior › Audio Cues（注册证据 <code>intellij.platform.ide.impl.xml:971-976</code>，
    <code>groupId="appearance" groupWeight="140" id="ide.audiocues"</code>）。
  </p>
  <fieldset class="settings-fields" :disabled="busy">
    <div class="input-row">
      <label for="audio-cues-mode">播放</label>
      <select id="audio-cues-mode" :value="mode" @change="setMode(($event.target as HTMLSelectElement).value)">
        <option value="auto">自动（屏幕阅读器开启时）</option>
        <option value="on">总是</option>
        <option value="off">从不</option>
      </select>
    </div>
    <p class="field-hint">
      对应 <code>AudioCuesMode</code>（<code>AudioCuesSettings.kt:75-79</code>）的 auto / on / off 三档；
      「自动」的判据在上游是 <code>ScreenReader.isActive()</code>（<code>:87</code>），
      本仓用「系统设置 › 辅助功能与字体 › 支持屏幕阅读器」当探针（<code>src/audioCues.ts:65-75</code>）。
      默认是<strong>关闭</strong>（上游默认 <code>AUTO</code>，差异记在 <code>src/settingsModel.ts</code> 的字段注释里）。
    </p>
    <p class="field-hint">逐条提示（关掉整档时不可勾）</p>
    <label v-for="cue in AUDIO_CUES" :key="cue.id" class="checkbox-row">
      <input
        type="checkbox"
        :checked="!disabled.has(cue.id)"
        :disabled="!cuesEnabled"
        @mousedown="markPointer"
        @keydown="markKeyboard"
        @focus="shouldPreviewOnFocus(focusCause()) && previewer.preview(cue.id)"
        @change="toggleCue(cue.id, ($event.target as HTMLInputElement).checked)"
      /><span>{{ cue.label }}</span>
    </label>
    <p class="field-hint">
      六个 cue 的 id 与优先级逐条抄 <code>IdeAudioCues.kt:13-39</code>（同一时刻只播优先级最高的那个）。
      勾选框与键盘聚焦都会试听一声（<code>AudioCuesConfigurable.kt:49</code> 与 <code>:50-57</code>）——
      试听走 <code>AudioCuePlayer.preview</code>（<code>AudioCuePlayer.kt:34-36</code>），**不受**上方「播放」档与
      逐条停用表影响，正如上游那样：这里试听的是「这个音长什么样」，不是「现在会不会响」。
      本仓播的是 WebAudio 合成音而非上游的 <code>sounds/*.wav</code>。
    </p>
  </fieldset>
</template>
