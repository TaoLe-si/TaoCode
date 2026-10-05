// 音频提示的**三档开关与逐 cue 停用**的判据（`src/audioCues.ts` + `src/audioCueHost.ts`）。
//
// 上游依据：
//   · `AudioCuesMode.isOn`（`AudioCuesSettings.kt:84-88`）：AUTO → 屏幕阅读器是否开着、ON 恒真、OFF 恒假；
//   · `AudioCuesSettings.isCueEnabled`/`setCueEnabled`（同文件 :47-63）：mode 开着且 cue 不在 disabledCues；
//   · `EditorAudioCuesManager` 的播放一拍同时受这两层门控。
// 本仓差异：AUTO 的探针是「支持屏幕阅读器」设置（DOM 探测不到系统屏幕阅读器）。
import test from 'node:test'
import assert from 'node:assert/strict'

const { isAudioCueModeOn, disabledCueIds, isCueEnabled, setCueEnabled, AUDIO_CUE_IDS } = await import('../src/audioCues.ts')
const { createAudioCueHost } = await import('../src/audioCueHost.ts')
const { ref } = await import('vue')

test('AUTO 档按屏幕阅读器探针走，ON/OFF 恒真/恒假', () => {
  assert.equal(isAudioCueModeOn('auto', true), true)
  assert.equal(isAudioCueModeOn('auto', false), false)
  assert.equal(isAudioCueModeOn('on', false), true)
  assert.equal(isAudioCueModeOn('off', true), false)
})

test('停用表：只认字符串 id，坏值不炸；setCueEnabled 是"返回新表"', () => {
  assert.deepEqual([...disabledCueIds(['error.line', '', 7, null])], ['error.line'])
  assert.deepEqual([...disabledCueIds(undefined)], [])
  assert.deepEqual([...disabledCueIds('error.line')], [], '非数组不当成表')
  const start = new Set(['warning.line'])
  assert.deepEqual([...setCueEnabled(start, 'error.line', false)], ['warning.line', 'error.line'])
  assert.deepEqual([...setCueEnabled(start, 'warning.line', true)], [])
  assert.deepEqual([...start], ['warning.line'], '原表不动')
})

test('isCueEnabled：mode 与停用表两层门控', () => {
  assert.equal(isCueEnabled('error.line', 'on', false), true)
  assert.equal(isCueEnabled('error.line', 'off', true), false)
  assert.equal(isCueEnabled('error.line', 'auto', true), true)
  assert.equal(isCueEnabled('error.line', 'auto', false), false)
  assert.equal(isCueEnabled('error.line', 'on', false, new Set(['error.line'])), false)
})

test('宿主：AUTO 档由 supportScreenReaders 决定播不播（同一批诊断）', async () => {
  const settings = ref({ audioCuesMode: 'auto', supportScreenReaders: false })
  const played = []
  const host = createAudioCueHost({
    settings,
    activePath: { value: 'a.ts' },
    caretLine: () => 1,
    player: { play: id => played.push(id), dispose: () => {} },
    now: () => 1000,
  })
  host.setCaretLine(99)     // 光标不在诊断行上 → line 档
  const diagnostics = [{ line: 0, character: 0, severity: 1, message: '坏' }]
  host.noteDiagnostics('a.ts', diagnostics)
  assert.deepEqual(played, [], 'AUTO 档 + 屏幕阅读器关着 = 静默')
  settings.value.supportScreenReaders = true
  host.noteDiagnostics('a.ts', [])           // 快照先变一次，避免和上一条只差"没变"
  host.noteDiagnostics('a.ts', diagnostics)
  assert.deepEqual(played, ['error.line'], 'AUTO 档 + 屏幕阅读器开着 = 按优先级播')
  host.dispose()
})

test('宿主：逐 cue 停用后该 cue 不播，且不占用节流窗口', async () => {
  const settings = ref({ audioCuesMode: 'on', audioCuesDisabled: ['error.line'] })
  const played = []
  const host = createAudioCueHost({
    settings,
    activePath: { value: 'a.ts' },
    caretLine: () => 99,      // 光标不在诊断行上 → 走 line 档（error.line）
    player: { play: id => played.push(id), dispose: () => {} },
    now: () => 1000,
  })
  host.setCaretLine(99)
  host.noteDiagnostics('a.ts', [{ line: 0, character: 0, severity: 1, message: '坏' }])
  assert.deepEqual(played, [], 'error.line 被停用')
  // 停用一个 cue 不该把窗口也占掉：同一拍里的警告仍然播得出来（上游 isCueEnabled 只挡播放）。
  host.reset()
  settings.value.audioCuesDisabled = ['warning.line']
  host.noteDiagnostics('a.ts', [{ line: 0, character: 0, severity: 1, message: '坏' }])
  assert.deepEqual(played, ['error.line'])
  assert.ok(AUDIO_CUE_IDS.includes('error.line'))
  host.dispose()
})
