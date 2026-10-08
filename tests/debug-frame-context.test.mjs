import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as vue from 'vue'
import * as exception from '../src/exceptionInfo.ts'
import * as completion from '../src/debugCompletions.ts'
import * as debugDataView from '../src/debugDataView.ts'
// 「按类型分组」的派生与组展开态存档（`src/debugFrameTree.ts`，2026-10-06 从 DebugPanel/debugDataView
// 抽出的同一份实现）：面板现在从它读回组键，桩里必须给真模块，否则面板 setup 就抛。
import * as debugFrameTree from '../src/debugFrameTree.ts'
// 面板侧的分组视图状态（`src/debugGroupView.ts`，2026-10-06 从 DebugPanel 抽出以回到 900 行内）：
// 真模块用 vue 的 ref/watch，桩里必须给真的，否则面板 setup 就抛。
import * as debugGroupView from '../src/debugGroupView.ts'
import * as exceptionBreakpoints from '../src/exceptionBreakpoints.ts'
import * as debugValueCopy from '../src/debugValueCopy.ts'
import * as debugEvaluateHistory from '../src/debugEvaluateHistory.ts'
import * as debugAttach from '../src/debugAttach.ts'
import * as debugWatches from '../src/debugWatches.ts'
import * as debugInlineValues from '../src/debugInlineValues.ts'
import * as debugMultilineEvaluate from '../src/debugMultilineEvaluate.ts'
// 面板把分页取数收进了 `src/dapRequests.ts`（`dapStackTracePage`/`dapVariablesPage`）：
// 它经 `setDapTransport` 注入取数通道，桩里必须给**真模块**并用桥接桩喂它，否则
// `refreshStack`/`selectThread` 调到的 `dapStackTracePage` 是 undefined，帧列表永远空。
import * as dapRequests from '../src/dapRequests.ts'
// 下面这七个都是面板现用的真模块（分页参数整形、变量分页视图态、行动作清单、源快照/能力位
// 原因、断点发送器、图标尺寸）。`..` 用真模块而非空对象 —— 空对象会让 setup 期/停机链上的
// 调用点炸掉（面板 script 的顶层计算与 refreshStack 都碰得到）。
import * as debugPaging from '../src/debugPaging.ts'
import * as debugVariablePaging from '../src/debugVariablePaging.ts'
import * as debugRowActions from '../src/debugRowActions.ts'
import * as debugSources from '../src/debugSources.ts'
import * as dbgBreakpointUpdate from '../src/dbgBreakpointUpdate.ts'
import * as uiIcons from '../src/uiIcons.ts'

const source = readFileSync('src/components/DebugPanel.vue', 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
const code = ts.transpileModule(source + '\nexport const probe = { frames, selectedFrameIndex, selectedFrame, scopes, values, open, varRows, expr, exprResult, watches, selectFrame, selectThread, refreshStack, refreshWatches, runEvaluate, rowActions, rowMenuTarget, multilineResults, runMultiline, syncInlineValues, showExecutionPoint };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
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
  // 面板的 `dapStackTracePage`/`dapVariablesPage` 由 `src/dapRequests.ts` 提供，取数通道是它
  // 的注入点：这里换成上面这组桥接桩（默认会走真 bridge.ts，在 Node 里发不出去）。
  // 取数通道必须在每个用例里重设 —— 模块是单例，上一个用例的桩不能漏到下一个。
  dapRequests.setDapTransport({
    capability: () => false,
    request: async () => ({}),
    stackTrace: bridge.dapStackTrace,
    variables: bridge.dapVariables ?? (async () => ({ variables: [] })),
  })
  const exports = {}
  new Function('require', 'exports', 'defineProps', 'defineEmits', code)(name => {
    if (name === 'vue') return { ...vue, watch: () => {}, onBeforeUnmount: () => {} }
    if (name === '../bridge') return bridge
    if (name === '../exceptionInfo') return exception
    if (name === '../debugCompletions') return completion
    if (name === '../debugDataView') return debugDataView
    if (name === '../debugFrameTree') return debugFrameTree
    if (name === '../debugGroupView') return debugGroupView
    if (name === '../exceptionBreakpoints') return exceptionBreakpoints
    if (name === '../debugValueCopy') return debugValueCopy
    if (name === '../debugEvaluateHistory') return debugEvaluateHistory
    if (name === '../debugAttach') return debugAttach
    if (name === '../debugWatches') return debugWatches
    // 监视列表的状态与操作（`src/debugWatchesStore.ts`，2026-10-06 从 DebugPanel 抽出）：
    // 真模块用 vue 的 ref/watch，这里给一个同形的桩；动作判定在 tests/debug-watch-actions.test.mjs。
    if (name === '../debugWatchesStore') return {
      useDebugWatches: () => {
        const watches = vue.ref([])
        return {
          watches,
          add: text => { const t = String(text).trim(); if (!t || watches.value.some(w => w.text === t)) return false; watches.value.push({ text: t, value: '' }); return true },
          remove: text => { watches.value = watches.value.filter(w => w.text !== text) },
          move: () => {}, removeAll: () => { watches.value = [] },
          togglePause: text => { watches.value = watches.value.map(w => w.text === text ? { ...w, paused: !w.paused } : w) },
          rename: () => false,
          setValue: (text, value) => { const entry = watches.value.find(w => w.text === text); if (entry) entry.value = value },
        }
      },
    }
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
    if (name === '../dapRequests') return dapRequests
    if (name === '../debugPaging') return debugPaging
    if (name === '../debugVariablePaging') return debugVariablePaging
    if (name === '../debugRowActions') return debugRowActions
    if (name === '../debugSources') return debugSources
    if (name === '../dbgBreakpointUpdate') return dbgBreakpointUpdate
    if (name === '../uiIcons') return uiIcons
    return {}
  }, exports, () => ({ activePath: 'a.java' }), () => () => {})
  return { ...exports.probe, state, calls }
}

// 用例之间还原取数通道（`setDapTransport()` 无参 = 回真桥接），别把桩漏给同进程的后续用例。
after(() => dapRequests.setDapTransport())

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
