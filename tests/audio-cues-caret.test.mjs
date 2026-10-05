// 音频提示的**光标那一路**（`pf/audio-cues` 族里缺的最后一条）。
//
// 上游的三个探测器都是**按光标所在行**问的，并且每一次光标移动要先停稳一拍才探测：
//   · `platform/platform-impl/src/com/intellij/ide/audioCues/ErrorWarningAudioCueDetector.kt:20-33`
//     —— 取 `lineStart..lineEnd` 重叠的高亮，severity ≥ WARNING 给 line 档，
//     高亮区间还含住光标偏移时**再**加一条 caret 档；
//   · `FoldedCodeAudioCueDetector.kt:15-24` —— 同一形状（折叠行 / 折叠区间含住光标）；
//   · `EditorAudioCueDetector.kt:23-27` —— `EditorAudioCue(cue, lineCounterpart)`：caret 档记着它细化哪条 line 档；
//   · `EditorAudioCuesManager.kt:52-54`（`ide.audio.cues.editor.settle.delay.ms` 默认 **50**，
//     注册声明在 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:494-499`）、
//     `:65`（紧挨着编辑时 **1000**）、`:68`（判定"属于那次编辑"的窗口 **100**）、
//     `:131`（`debounce { if (it.editAdjacent) editAdjacentSettleDelay else settleDelay }`）、
//     `:143-152`（探测完的挑选：换行 → 整组，同一行 → 只留 caret 档；caret 档在它那条 line 档
//     也响且没被停用时静音）、`:83`（oldPosition == newPosition 直接丢）、`:87-92`（程序化移动静默立基线）。
//
// 本仓之前只有"诊断表变了/折叠那一下"两路，`setCaretLine` 只把行号记下来 ——
// **光标自己走到一条错误行上是不响的**。这一族判词里的"缺"就剩这条，本文件是它的门禁。
import test from 'node:test'
import assert from 'node:assert/strict'

import { detectDiagnosticCues, detectFoldedCues, settleCues, settleDelayMs, AUDIO_CUES_SETTLE_MS, EDIT_ADJACENT_SETTLE_MS } from '../src/audioCues.ts'
import { createAudioCueHost } from '../src/audioCueHost.ts'

/** 上游 `EditorAudioCuesManager.kt:52-54,65,68` 的三个时长，逐个钉住。 */
test('停靠时长抄上游：50ms，紧挨着编辑 1000ms', () => {
  assert.equal(AUDIO_CUES_SETTLE_MS, 50)
  assert.equal(EDIT_ADJACENT_SETTLE_MS, 1000)
  assert.equal(settleDelayMs(false), 50)
  assert.equal(settleDelayMs(true), 1000)
})

test('探测器按行给出 line 档 + caret 档，caret 档记着自己的 line 档', () => {
  const cues = detectDiagnosticCues([{ severity: 1, line: 7 }], 7)
  assert.deepEqual(cues, [{ id: 'error.line' }, { id: 'error.caret', lineCounterpart: 'error.line' }])
  assert.deepEqual(detectDiagnosticCues([{ severity: 2, line: 7 }], 7),
    [{ id: 'warning.line' }, { id: 'warning.caret', lineCounterpart: 'warning.line' }])
  // 不是这一行的诊断什么都探不到（上游只看 lineStart..lineEnd 的重叠）。
  assert.deepEqual(detectDiagnosticCues([{ severity: 1, line: 8 }], 7), [])
  // 提示级（severity 3/4）不上报：上游的门槛是 `severity >= WARNING`。
  assert.deepEqual(detectDiagnosticCues([{ severity: 3, line: 7 }], 7), [])
  assert.deepEqual(detectFoldedCues([4, 9], 9), [{ id: 'folded.line' }, { id: 'folded.caret', lineCounterpart: 'folded.line' }])
  assert.deepEqual(detectFoldedCues([4], 9), [])
})

test('挑选规则抄 processCaretPosition：换行播 line 档并把 caret 档静音，同一行只播 caret 档', () => {
  const both = [{ id: 'error.line' }, { id: 'error.caret', lineCounterpart: 'error.line' }]
  const allOn = () => true
  assert.deepEqual(settleCues(both, true, allOn), ['error.line'], '换到这一行：播 line 档')
  assert.deepEqual(settleCues(both, false, allOn), ['error.caret'], '同一行内再停一次：只播 caret 档')
  // 上游 `:150` 那个 `settings.isCueEnabled(counterpart)`：line 档被停用时，caret 档**不再被静音**；
  // 两条都留在待播列表里，停用那条由播放器丢（`AudioCuePlayer.kt:26` 的 `cues.filter(settings::isCueEnabled)`，
  // 本仓是 `fire()` 里的 `cueAllowed`）。
  const lineOff = id => id !== 'error.line'
  assert.deepEqual(settleCues(both, true, lineOff), ['error.line', 'error.caret'], 'line 档停用 ⇒ 不再静音 caret 档')
})

/** 同步驱动停靠：`schedule` 替身记录延时、手动落地，不开真定时器。 */
function harness(options = {}) {
  const { baseline = true, ...rest } = options
  const played = []
  const pending = []
  let clock = 10000
  const settings = { audioCuesMode: 'on', supportScreenReaders: false, audioCuesDisabled: [] }
  const host = createAudioCueHost({
    settings: { value: settings },
    activePath: { value: 'a.java' },
    caretLine: () => 1,
    player: { play: id => played.push(id), dispose: () => {} },
    now: () => clock,
    schedule: (run, delayMs) => {
      const item = { run, delayMs, cancelled: false }
      pending.push(item)
      return () => { item.cancelled = true }
    },
    ...rest,
  })
  // App.vue 那一侧的 `watch(() => active.value?.line, …, { immediate: true })`：
  // 装配时先上报一次当前行，只立基线不响。之后每一拍才是真的"光标走到了某一行"。
  if (baseline) host.setCaretLine(1)
  // 停靠落地：跑最后一个未被取消的（上游 `debounce` + `collectLatest` 的语义）。
  function settle() {
    const last = pending[pending.length - 1]
    if (!last || last.cancelled) return
    last.cancelled = true
    clock += 1000
    last.run()
  }
  return { host, played, pending, settings, settle, advance: ms => { clock += ms } }
}

test('光标走到错误行：停稳之后响 line 档（这是本族最后一条真的缺口）', () => {
  const t = harness()
  t.host.noteDiagnostics('a.java', [{ line: 4, character: 0, severity: 1, message: 'x' }])
  assert.equal(t.played.length, 1, '诊断表变化那一拍照旧响')
  t.advance(500)
  t.host.setCaretLine(5)
  assert.equal(t.pending[0].delayMs, AUDIO_CUES_SETTLE_MS, '过了 100ms 的编辑窗口 ⇒ 普通 50ms 停靠')
  t.settle()
  assert.deepEqual(t.played, ['error.line', 'error.line'], '光标停到第 5 行（0 基第 4 行）也要响')
})

test('连按方向键只响一次：后一拍取消前一拍（debounce + collectLatest）', () => {
  const t = harness()
  t.host.noteDiagnostics('a.java', [{ line: 9, character: 0, severity: 2, message: 'y' }])
  t.played.length = 0
  t.host.setCaretLine(8)
  t.host.setCaretLine(9)
  t.host.setCaretLine(10)
  assert.equal(t.pending.length, 3, '每一次移动都排了一拍')
  t.settle()
  assert.deepEqual(t.played, ['warning.line'], '只有停下来的那一拍落地')
})

test('第一次上报只立基线不响（上游那条程序化移动的静默分支）', () => {
  const t = harness()
  t.host.noteDiagnostics('a.java', [{ line: 0, character: 0, severity: 1, message: 'x' }])
  t.played.length = 0
  t.host.setCaretLine(1)
  assert.equal(t.pending.length, 0, '没有排队：装配时那一次 immediate 上报不该响')
  t.host.setCaretLine(2)
  t.settle()
  assert.deepEqual(t.played, [], '第 2 行没有诊断，不该凭空响')
})

test('切文件（reset）之后重新立基线，且未落地的停靠被撤掉', () => {
  const t = harness()
  t.host.noteDiagnostics('a.java', [{ line: 3, character: 0, severity: 1, message: 'x' }])
  t.host.setCaretLine(4)
  assert.equal(t.pending.length, 1)
  t.host.reset()
  assert.equal(t.pending[0].cancelled, true, '切文件时排队里的停靠要撤掉')
  t.played.length = 0
  t.host.setCaretLine(4)
  assert.equal(t.pending.length, 1, 'reset 之后第一次上报只立基线，不再排新一拍')
  t.settle()
  assert.equal(t.played.length, 0, '被撤掉的那一拍不会落地')
})

test('同一行内再停靠只补 caret 档；换了行才补 line 档', () => {
  const t = harness()
  t.host.noteDiagnostics('a.java', [{ line: 6, character: 0, severity: 1, message: 'x' }])
  t.played.length = 0
  t.host.setCaretLine(7)
  t.settle()
  assert.deepEqual(t.played, ['error.line'], '换到第 7 行 ⇒ line 档')
  // 走出去又走回来，而且中间那一拍没落地（停靠窗口内）：探测发生在**同一行**上，
  // 上游 `:147` 那句 `if (newLine) cues else cues.filter { it.lineCounterpart != null }` 就只管这种。
  t.host.setCaretLine(9)
  t.host.setCaretLine(7)
  t.advance(2000)
  t.settle()
  assert.deepEqual(t.played, ['error.line', 'error.caret'], '同一行内再停 ⇒ 只补 caret 档')
})

test('紧挨着一次编辑时按 1000ms 停（上游 TYPING_WINDOW 之内算编辑相邻）', () => {
  const t = harness()
  t.host.noteDiagnostics('a.java', [{ line: 2, character: 0, severity: 2, message: 'x' }])
  t.host.setCaretLine(3)
  assert.equal(t.pending[0].delayMs, EDIT_ADJACENT_SETTLE_MS, '诊断表刚变过 ⇒ 这次移动属于那次编辑')
  t.advance(5000)
  t.host.setCaretLine(4)
  assert.equal(t.pending[1].delayMs, AUDIO_CUES_SETTLE_MS, '过了 100ms 窗口就是普通的 50ms')
})

test('逐 cue 停用接进光标这一路：停掉 line 档之后，走到错误行响的是 caret 档', () => {
  const t = harness()
  t.settings.audioCuesDisabled = ['error.line']
  t.host.noteDiagnostics('a.java', [{ line: 4, character: 0, severity: 1, message: 'x' }])
  assert.deepEqual(t.played, [], 'line 档被停用 ⇒ 诊断表那一拍也不响')
  t.advance(500)
  t.host.setCaretLine(5)
  t.settle()
  assert.deepEqual(t.played, ['error.caret'], '上游那条静音判据看的是"line 档还响不响"，不是"存不存在"')
})

test('折叠那一档等宿主给"当前折着的行"，自己攒集合会在展开后响错', () => {
  const folded = [12]
  const t = harness({ foldedLines: () => folded })
  t.host.noteDiagnostics('a.java', [])
  t.played.length = 0
  t.host.setCaretLine(12)
  t.settle()
  assert.deepEqual(t.played, ['folded.line'], '宿主给了折叠行才探得到')
  folded.length = 0
  t.advance(2000)
  t.host.setCaretLine(11)
  t.host.setCaretLine(12)
  t.settle()
  assert.deepEqual(t.played, ['folded.line'], '折叠没了就不再响（集合由宿主维护，不是本机攒的）')
})
