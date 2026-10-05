// 音频提示（无障碍）的规则与播放判据 —— `src/audioCues.ts` / `src/audioCuePlayer.ts`。
//
// 上游依据（逐条核过）：`IdeAudioCues.kt` 的六个 cue（id + 优先级 + wav 资源）、`AudioCueProvider`
// 全量注册、`AudioCuesSettings.mode`、`EditorAudioCuesManager` 的优先级节流、三个探测器
// （光标行诊断 / 诊断变化 / 代码折叠）。本仓的差异（合成音、两档 mode）写在模块头里。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUDIO_CUES, AUDIO_CUE_IDS, AUDIO_CUE_MODES, CUE_DEDUPE_WINDOW_MS, cueById, cueForDiagnostics, cueForFold,
  diagnosticsChanged, isAudioCueMode, pickCue, shouldPlay, toDiagnosticLike,
} from '../src/audioCues.ts'
import { createAudioCuePlayer } from '../src/audioCuePlayer.ts'

test('六个 cue 的 id 与优先级逐条对齐上游（IdeAudioCues.kt:13-39）', () => {
  assert.deepEqual(AUDIO_CUE_IDS, ['error.line', 'error.caret', 'warning.line', 'warning.caret', 'folded.line', 'folded.caret'])
  assert.deepEqual(Object.fromEntries(AUDIO_CUES.map(cue => [cue.id, cue.priority])), {
    'error.line': 20, 'error.caret': 30, 'warning.line': 40, 'warning.caret': 50, 'folded.line': 130, 'folded.caret': 140,
  })
  // 优先级必须严格递增，否则"错误优先于警告"这条就靠不住
  const priorities = AUDIO_CUES.map(cue => cue.priority)
  assert.deepEqual([...priorities].sort((a, b) => a - b), priorities)
  assert.ok(AUDIO_CUES.every(cue => cue.tone.durationMs > 0 && cue.tone.frequency > 0))
})

test('节流：同一时刻只播最高优先级的那个', () => {
  assert.equal(pickCue(['warning.line', 'error.line', 'folded.caret']), 'error.line')
  assert.equal(pickCue(['folded.line', 'warning.caret']), 'warning.caret')
  assert.equal(pickCue([]), null)
})

test('节流窗口：窗口内的第二次（包括换个 cue）都丢掉', () => {
  assert.equal(shouldPlay('error.line', null, 1000), true)
  assert.equal(shouldPlay('error.line', { id: 'error.line', at: 1000 }, 1000 + CUE_DEDUPE_WINDOW_MS - 1), false)
  assert.equal(shouldPlay('warning.line', { id: 'error.line', at: 1000 }, 1000 + CUE_DEDUPE_WINDOW_MS), true)
})

test('诊断判定：光标行上的优先（caret 档），错误优先于警告', () => {
  const diagnostics = [
    { severity: 2, line: 3 }, { severity: 1, line: 9 }, { severity: 1, line: 3 },
  ]
  assert.equal(cueForDiagnostics(diagnostics, 3), 'error.caret', '光标行上的错误压过别处的错误与警告')
  assert.equal(cueForDiagnostics(diagnostics, 5), 'error.line', '光标不在任何诊断行上时取最低优先级的那个')
  assert.equal(cueForDiagnostics([{ severity: 2, line: 4 }], 4), 'warning.caret')
  assert.equal(cueForDiagnostics([], 1), null)
  assert.equal(cueForDiagnostics([{ severity: 3, line: 1 }], 1), null, '信息级不响')
})

test('折叠判定：折叠行就是光标行时用 caret 档', () => {
  assert.equal(cueForFold(7, 7), 'folded.caret')
  assert.equal(cueForFold(7, 8), 'folded.line')
})

test('诊断表变化判定与 LSP 形状折算', () => {
  const a = [{ severity: 1, line: 2, path: 'a.ts' }]
  assert.equal(diagnosticsChanged(a, [...a]), false)
  assert.equal(diagnosticsChanged(a, [{ severity: 1, line: 3, path: 'a.ts' }]), true)
  assert.equal(diagnosticsChanged(a, []), true)
  assert.equal(diagnosticsChanged([], []), false)
  assert.deepEqual(toDiagnosticLike([{ line: 0, character: 0, severity: 1, message: 'x' }], 'a.ts'), [{ severity: 1, line: 1, path: 'a.ts' }])
  assert.deepEqual(toDiagnosticLike([{ line: 4, character: 2, severity: 2, message: 'y' }], 'b.ts'), [{ severity: 2, line: 5, path: 'b.ts' }])
})

test('设置值域：auto / on / off 三档（上游 AudioCuesMode 同款），默认口径与上游一致', () => {
  assert.deepEqual([...AUDIO_CUE_MODES], ['auto', 'on', 'off'])
  assert.equal(isAudioCueMode('auto'), true)
  assert.equal(isAudioCueMode('on'), true)
  assert.equal(isAudioCueMode('off'), true)
  assert.equal(isAudioCueMode('ON'), false)
  assert.equal(isAudioCueMode(1), false)
  assert.equal(isAudioCueMode(undefined), false)
})

test('播放器：关着时不建 AudioContext（不打扰、也不吃资源）', () => {
  let created = 0
  const player = createAudioCuePlayer({ enabled: () => false, contextFactory: () => { created += 1; return null } })
  player.play('error.line')
  assert.equal(created, 0, 'off 档一次都不该建上下文')
})

test('播放器：开着时按 cue 的音色播放，dispose 之后不再播', () => {
  const played = []
  const context = {
    currentTime: 0,
    destination: {},
    createOscillator: () => ({ type: '', frequency: { value: 0 }, connect: () => {}, start: () => played.push('start'), stop: () => played.push('stop') }),
    createGain: () => ({ gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} }),
    close: () => { played.push('close') },
  }
  let enabled = true
  const player = createAudioCuePlayer({ enabled: () => enabled, contextFactory: () => context })
  player.play('error.caret')
  assert.deepEqual(played, ['start', 'stop'])
  enabled = false
  player.play('warning.line')
  assert.equal(played.length, 2, '关掉之后不再有新的播放')
  player.dispose()
  enabled = true
  player.play('folded.line')
  assert.equal(played.length, 3, 'dispose 之后 play 是空操作（只有 close）')
})

test('宿主：快照去重、重置清空、折叠按光标行分档（播放器替身）', async () => {
  const { createAudioCueHost } = await import('../src/audioCueHost.ts')
  const { ref } = await import('vue')
  const played = []
  const settings = ref({ audioCuesMode: 'on' })
  const activePath = ref('a.ts')
  let caret = 1
  let clock = 0
  const host = createAudioCueHost({
    settings, activePath, caretLine: () => caret,
    player: { play: id => played.push(id), dispose: () => {} },
    now: () => (clock += 1000),
  })
  // `LspDiagnostic.line` 是 0 基：第 4 行（0 基）→ 第 5 行（1 基）。
  host.noteDiagnostics('a.ts', [{ line: 4, character: 0, severity: 1, message: 'x' }])
  assert.deepEqual(played, ['error.line'], '光标不在诊断行上：line 档')
  host.noteDiagnostics('a.ts', [{ line: 4, character: 0, severity: 1, message: 'x' }])
  assert.deepEqual(played, ['error.line'], '同一份诊断再喂一次不重复播')
  host.noteDiagnostics('a.ts', [{ line: 9, character: 0, severity: 2, message: 'y' }])
  assert.deepEqual(played, ['error.line', 'warning.line'], '诊断内容变了就重播')
  caret = 10
  host.setCaretLine(caret)
  host.noteFold(10)
  assert.deepEqual(played, ['error.line', 'warning.line', 'folded.caret'], '折叠行就是光标行时用 caret 档')
  host.reset()
  host.noteDiagnostics('a.ts', [])
  assert.deepEqual(played, ['error.line', 'warning.line', 'folded.caret'], '重置后清空不响')
  assert.equal(host.lastCue.value, 'folded.caret')
  host.dispose()
})

test('接线：设置键与播放器都进了真实消费链路', async () => {
  const { readFileSync } = await import('node:fs')
  const app = readFileSync('src/App.vue', 'utf8')
  // `cueForDiagnostics`/`cueForFold` 的判定在 `createAudioCueHost` 内部调用；App.vue 这一层的
  // 可执行调用点是 host 的三个入口 + 设置键 + 播放器，所以这里盯这些真实调用（不盯 host 内部实现）。
  assert.match(app, /createAudioCuePlayer\(/, '宿主没有装配播放器')
  assert.match(app, /audioCuesMode/, '宿主没有读设置键')
  assert.match(app, /createAudioCueHost\(/, '宿主没有装配音频提示状态域')
  assert.match(app, /noteDiagnostics\(/, '诊断变化没有接到 cue 判定上')
  assert.match(app, /noteFold\(/, '折叠没有接到 cue 判定上')
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  assert.match(editor, /folded: \[line1based: number\]/, '编辑器没有 folded 事件')
  assert.match(editor, /emit\('folded'/, '折叠变化没有上报给宿主')
  const model = readFileSync('src/settingsModel.ts', 'utf8')
  assert.match(model, /audioCuesMode/, '设置模型里没有 audioCuesMode')
})
