// 「外观与行为 › 音频提示」（`ide.audiocues`）的行为回归。
//
// 上游依据：
//   · 注册行 `intellij.platform.ide.impl.xml:971-976`（`groupId="appearance" groupWeight="140" id="ide.audiocues"`）；
//   · 面板结构 `AudioCuesConfigurable.kt:27-61`（mode 下拉 + `indent{}` 里逐 cue 复选 + `enabledIf(mode != OFF)`）；
//   · 状态与值域 `AudioCuesSettings.kt:69-72`（`mode` / `disabledCues`）、`:75-79`（三档）、`:85-89`（`isOn`）；
//   · 六个 cue 的 id/优先级 `IdeAudioCues.kt:13-39`。
// 纯规则那一半（优先级、节流、判定）由 tests/audio-cues.test.mjs 覆盖；这里钉的是
// **设置页 → 键表 → 消费链路** 这一段，以及「不放假控件」：mode 关掉时逐 cue 必须不可勾。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUDIO_CUE_IDS, disabledCueIds, isAudioCueMode, setCueEnabled } from '../src/audioCues.ts'
import { createAudioCuePreviewer, PREVIEW_BYPASSES_CUE_GATES, shouldPreviewOnFocus } from '../src/audioCuePreview.ts'
import { defaultGeneralSettings } from '../src/settingsModel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('页面照上游排布：mode 下拉三档 + 逐 cue 复选，整档关掉时逐 cue 禁用', () => {
  const page = read('src/components/AudioCuesSettingsPage.vue')
  // 三档来自 AudioCuesMode.entries（AudioCuesConfigurable.kt:37-38）。
  for (const option of ['auto', 'on', 'off'])
    assert.match(page, new RegExp(`<option value="${option}">`), `mode 下拉缺 ${option} 档`)
  // 逐 cue 复选是 v-for 渲染的（六个 cue 来自 IdeAudioCues.kt:13-39），不是硬写六行。
  assert.match(page, /v-for="cue in AUDIO_CUES"/)
  // `.enabledIf(mode != AudioCuesMode.OFF)`（AudioCuesConfigurable.kt:60）。
  assert.match(page, /:disabled="!cuesEnabled"/)
  assert.match(page, /const cuesEnabled = computed\(\(\) => mode\.value !== 'off'\)/)
  // 勾选走 AudioCuesSettings.setCueEnabled（:49-53）：勾上从表里去掉，勾掉加回去。
  assert.match(page, /setCueEnabled\(disabled\.value, id, checked\)/)
})

test('两组规则函数在页面里的用法与上游同义（值域 + 停用表往返）', () => {
  // 三档值域（AudioCuesSettings.kt:75-79）
  assert.ok(isAudioCueMode('auto') && isAudioCueMode('on') && isAudioCueMode('off'))
  assert.ok(!isAudioCueMode('ON') && !isAudioCueMode(undefined))
  // disabledCues 往返：默认空 = 六个 cue 全开（同上游空 Set 默认）
  assert.equal(defaultGeneralSettings.audioCuesDisabled.length, 0)
  assert.equal(disabledCueIds(defaultGeneralSettings.audioCuesDisabled).size, 0)
  const afterOff = setCueEnabled(disabledCueIds([]), 'error.line', false)
  assert.deepEqual([...afterOff], ['error.line'])
  assert.equal(setCueEnabled(afterOff, 'error.line', true).size, 0, '重新勾上要从停用表里去掉')
  assert.equal(AUDIO_CUE_IDS.length, 6, '停用表的长度上限就是 cue 数（native 校验按 6 拦）')
})

test('两格都是真设置：模型 + native 键表/默认值/校验 + 预览白名单四处都登记', () => {
  const model = read('src/settingsModel.ts')
  assert.match(model, /audioCuesMode\?: 'auto' \| 'on' \| 'off'/, 'mode 必须是三档（上游 AudioCuesMode）')
  assert.match(model, /audioCuesDisabled: string\[\]/, '模型里没有逐 cue 停用表')
  assert.equal(defaultGeneralSettings.audioCuesMode, 'off', '默认 off（上游默认 AUTO，差异记在字段注释里）')
  assert.match(model, /audioCuesMode: 'off',\s*\n\s*audioCuesDisabled: \[\],/, '默认值：off + 空停用表')

  const hpp = read('native/settings_schema.hpp')
  assert.match(hpp, /"audioCuesMode", "audioCuesDisabled",/, 'native 键表白名单漏了这两格 ⇒ 整次保存被 known_keys 拒')
  const cpp = read('native/settings_schema.cpp')
  assert.match(cpp, /\{"audioCuesMode", "off"\}, \{"audioCuesDisabled", Json::array\(\)\},/, 'native 默认值要与前端一致')
  // 校验：三档 + 停用表必须是已知的六个 cue id
  assert.match(cpp, /audioCuesMode must be auto, on or off\./)
  assert.match(cpp, /audioCuesDisabled must be an array of at most 6 cue ids\./)
  for (const id of AUDIO_CUE_IDS)
    assert.ok(cpp.includes(`"${id}"`), `native 校验的 cue id 表缺 ${id}`)

  // 预览态是同一条规则的第二道关卡（原生那一侧桌面端才是真源）。
  const preview = read('src/bridgePreview.ts')
  assert.match(preview, /key === 'audioCuesDisabled'/, 'settings.general.update 的白名单漏了新键')
  assert.match(preview, /无效设置：audioCuesDisabled/)
})

test('消费链路：停用表真的逐 cue 生效（audioCueHost 的 cueAllowed 每一拍都读它）', () => {
  const host = read('src/audioCueHost.ts')
  assert.match(host, /isCueEnabled\(id, current, deps\.settings\.value\.supportScreenReaders === true, disabledCueIds\(deps\.settings\.value\.audioCuesDisabled\)\)/,
    '宿主没有把停用表接到逐 cue 判定上 —— 设置存下来也不会有任何效果')
  assert.match(host, /if \(!cueAllowed\(id\)\) return/, '停用的 cue 连节流都不该占')
  const app = read('src/App.vue')
  assert.match(app, /createAudioCueHost\(/, '宿主没有装配音频提示状态域')
})

test('放置位置：自己的页挂在 group:appearance，不是 general 的子节点，也不再占 general 的一行', () => {
  const tree = read('src/settingsTreeMeta.ts')
  assert.match(tree, /\{ key: 'ide\.audiocues', label: '音频提示'[^}]*parent: 'group:appearance'/)
  const dialog = read('src/components/SettingsDialog.vue')
  assert.match(dialog, /<AudioCuesSettingsPage :settings="general" :busy="busy" \/>/, '对话框没有挂这一页')
  assert.match(dialog, /data-page="ide\.audiocues"/, '面板要与设置树那一页对上')
  // 上游它是独立 configurable（intellij.platform.ide.impl.xml:971-976），
  // 所以 general 页里那行旧的二选一下拉必须走掉（否则两处都能改同一格）。
  assert.ok(!dialog.includes('audio-cues-hint'), 'general 页里还留着旧的「音频提示」下拉')
})

test('试听接上了：勾选框任何动作都试听（AudioCuesConfigurable.kt:49）', () => {
  const page = read('src/components/AudioCuesSettingsPage.vue')
  // .actionListener { _, _ -> player.preview(cue) }：change（鼠标点 / 聚焦后按空格回车）都试听。
  assert.match(page, /previewer\.preview\(id\)/, '勾选后没有试听')
  assert.match(page, /@change="toggleCue\(cue\.id,/)
})

test('键盘遍历的聚焦才试听，指针点击引起的聚焦不试听（AudioCuesConfigurable.kt:50-57 的 else -> {}）', () => {
  assert.equal(shouldPreviewOnFocus('traversal-forward'), true)
  assert.equal(shouldPreviewOnFocus('traversal-backward'), true)
  assert.equal(shouldPreviewOnFocus('pointer'), false)
  assert.equal(shouldPreviewOnFocus('other'), false)
  // DOM 没有 FocusEvent.Cause，成因靠「上一次交互是 mousedown 还是 keydown」判定。
  const page = read('src/components/AudioCuesSettingsPage.vue')
  assert.match(page, /@mousedown="markPointer"/)
  assert.match(page, /@keydown="markKeyboard"/)
  assert.match(page, /@focus="shouldPreviewOnFocus\(focusCause\(\)\)/)
})

test('试听绕过 mode 与逐 cue 停用表（AudioCuePlayer.kt:34-36 的 preview 直调 playEnabled）', () => {
  // 上游：play() 过 `cues.filter(settings::isCueEnabled)`（AudioCuePlayer.kt:26），
  //       preview() 直接 playEnabled（:34-36）—— 本仓的试听实例 enabled 恒真即等价。
  assert.equal(PREVIEW_BYPASSES_CUE_GATES, true)
  // 对照组：编辑器里那一声仍要过 mode + 停用表（audioCueHost 的 cueAllowed）。
  const host = read('src/audioCueHost.ts')
  assert.match(host, /if \(!cueAllowed\(id\)\) return/, '正常播放的门被试听改掉了 —— 停用的 cue 会响')
  assert.match(read('src/audioCuePlayer.ts'), /if \(disposed \|\| !deps\.enabled\(\)\) return/, '播放器的门被绕过了')
})

test('试听真的会响：走的是 audioCueHost 同一份播放器，且卸载时关掉', () => {
  const played = []
  const previewer = createAudioCuePreviewer({ player: { play: id => played.push(id), dispose() {} } })
  previewer.preview('error.line')
  assert.deepEqual(played, ['error.line'])
  // 试听实例的 enabled 恒真 ⇒ 不受 audioCuesMode 影响（PREVIEW_BYPASSES_CUE_GATES）。
  assert.equal(PREVIEW_BYPASSES_CUE_GATES, true)
  const page = read('src/components/AudioCuesSettingsPage.vue')
  assert.match(page, /onBeforeUnmount\(\(\) => previewer\.dispose\(\)\)/, '离开设置页不关 AudioContext')
})
