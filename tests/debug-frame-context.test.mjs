import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as vue from 'vue'
import * as exception from '../src/exceptionInfo.ts'
import * as completion from '../src/debugCompletions.ts'
import * as debugDataView from '../src/debugDataView.ts'
import * as exceptionBreakpoints from '../src/exceptionBreakpoints.ts'
import * as debugValueCopy from '../src/debugValueCopy.ts'
import * as debugEvaluateHistory from '../src/debugEvaluateHistory.ts'
import * as debugAttach from '../src/debugAttach.ts'
import * as debugWatches from '../src/debugWatches.ts'
import * as debugInlineValues from '../src/debugInlineValues.ts'
import * as debugMultilineEvaluate from '../src/debugMultilineEvaluate.ts'

const source = readFileSync('src/components/DebugPanel.vue', 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
const code = ts.transpileModule(source + '\nexport const probe = { frames, selectedFrameIndex, selectedFrame, scopes, values, open, varRows, expr, exprResult, watches, selectFrame, selectThread, refreshStack, refreshWatches, runEvaluate, rowActions, rowMenuTarget, multilineResults, runMultiline, syncInlineValues, showExecutionPoint, attachHistory };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function setup(overrides = {}) {
  const state = vue.reactive({ running: true, paused: true, threadId: 1, reason: null, currentLocation: null })
  const calls = []
  const bridge = {
    BridgeError: Error, dapState: state, dapConsole: [], dapBreakpoints: new Map(), dapThreadSignal: { version: 0 },
    dapSetCurrentLocation: value => { state.currentLocation = value; calls.push(['location', value]) },
    dapSelectThread: id => { state.threadId = id },
    dapStackTrace: async () => ({ frames: [{ id: 10, line: 2, name: 'top', path: 'a.java' }, { id: 20, line: 9, name: 'caller', path: 'b.java' }] }),
    dapThreads: async () => ({ threads: [] }), dapExceptionInfo: async () => ({ available: false }),
    dapScopes: async id => { calls.push(['scopes', id]); return { scopes: [] } },
    dapEvaluate: async (text, context, frame) => { calls.push(['evaluate', frame, context]); return { result: String(frame) } },
    ...overrides,
  }
  const exports = {}
  new Function('require', 'exports', 'defineProps', 'defineEmits', code)(name => {
    if (name === 'vue') return { ...vue, watch: () => {}, onBeforeUnmount: () => {} }
    if (name === '../bridge') return bridge
    if (name === '../exceptionInfo') return exception
    if (name === '../debugCompletions') return completion
    if (name === '../debugDataView') return debugDataView
    if (name === '../exceptionBreakpoints') return exceptionBreakpoints
    if (name === '../debugValueCopy') return debugValueCopy
    if (name === '../debugEvaluateHistory') return debugEvaluateHistory
    if (name === '../debugAttach') return debugAttach
    if (name === '../debugWatches') return debugWatches
    if (name === '../debugInlineValues') return debugInlineValues
    if (name === '../debugMultilineEvaluate') return debugMultilineEvaluate
    // 行内监视的接线层（`src/debugInlineWatchSync.ts`，上游 InlineWatch）：面板把当前帧当锚点。
    // 真实的 composable 会去派发编辑器 effect，这里同样给记录调用的桩，行内监视的判据在
    // tests/debug-inline-watch-wiring.test.mjs 里单独跑。
    if (name === '../debugInlineWatchSync') return {
      useInlineWatches: () => ({
        inlineWatches: { value: [] }, isShown: () => false,
        toggle: () => {}, sync: () => calls.push(['inline-watch', 'sync']), clear: () => calls.push(['inline-watch', 'clear']),
      }),
    }
    // 编辑器侧的挂点（CodeEditor 冻结，行内值推进通过 editorDebugLine 的 effect 派发）：
    // 单测里不需要真实 EditorView，给一个记录调用的桩。
    if (name === '../editorDebugLine') return { setDebugInlineValues: value => calls.push(['inline', value]), syncDebugLine: () => {} }
    if (name === '../clipboard') return { copyToClipboard: async () => {} }
    return {}
  }, exports, () => ({ activePath: 'a.java' }), () => () => {})
  return { ...exports.probe, state, calls }
}

test('selecting a non-top frame updates scopes, watch evaluation and expression evaluation', async () => {
  const panel = setup()
  await panel.refreshStack()
  panel.watches.value = [{ text: 'count', value: '' }]
  await panel.selectFrame(1, 20)
  panel.expr.value = 'count'
  await panel.runEvaluate()
  assert.equal(panel.selectedFrame.value.id, 20)
  assert.deepEqual(panel.calls.filter(call => call[0] === 'evaluate').map(call => call[1]), [20, 20])
  assert.match(panel.exprResult.value, /20/)
  assert.equal(panel.watches.value[0].value, '20')
})

test('late scope responses cannot overwrite a newer frame', async () => {
  let deliver
  const panel = setup({ dapScopes: id => id === 20 ? new Promise(resolve => { deliver = resolve }) : Promise.resolve({ scopes: [{ name: 'new', reference: 30, expensive: true }] }) })
  await panel.refreshStack()
  const old = panel.selectFrame(1, 20)
  await panel.selectFrame(0, 10)
  deliver({ scopes: [{ name: 'stale', reference: 99, expensive: true }] })
  await old
  assert.equal(panel.scopes.value[0].name, 'new')
})

test('ordinary variable roots expand, actual ancestor cycles are stopped', () => {
  const panel = setup()
  panel.scopes.value = [{ name: 'Locals', reference: 1, expensive: false }]
  panel.values[1] = [{ name: 'object', value: '{...}', reference: 2 }]
  panel.values[2] = [{ name: 'parent', value: '{...}', reference: 1 }]
  panel.open.s0 = true
  assert.equal(panel.varRows.value[1].name, 'object')
  panel.open['s0-0'] = true
  assert.equal(panel.varRows.value[2].name, 'parent')
  panel.open['s0-0-0'] = true
  assert.equal(panel.varRows.value.at(-1).name, '（循环引用）')
})

test('thread selection changes the target used by stepping and evaluates its stack', async () => {
  const panel = setup()
  await panel.selectThread(7)
  assert.equal(panel.state.threadId, 7)
  assert.equal(panel.selectedFrame.value.id, 10)
})

test('debug panel host forwards adapter kind and converts DAP lines to zero-based editor lines', () => {
  const view = readFileSync('src/components/ToolWindowView.vue', 'utf8')
  assert.match(view, /:adapter-kind="ctx\.runConfigDebugAdapter"/)
  assert.match(view, /@jump="target => ctx\.onReveal\(\{ path: target\.path \?\? ctx\.activePath, line: Math\.max\(0, target\.line - 1\)/)
  assert.doesNotMatch(source, /frames\.value\[0\]\?\.id/)
})
