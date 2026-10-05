<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch, nextTick } from 'vue'
import { PenLine, RefreshCw, Bug, ChevronDown, ChevronRight, Pause, Play, StepForward, StepBack, Rewind, Square, X, Crosshair, Copy, LocateFixed, SquarePen, ListTree, Eye } from 'lucide-vue-next'
import { BridgeError } from '../bridge'
import {
  dapBreakpoints, dapCapability, dapConsole, dapEvaluate, dapExceptionInfo,
  dapProgress, dapReverseContinue, dapScopes, dapStepBack,
  dapDisconnect, dapRestart, dapRestartFrame, dapLoadBreakpoints, dapSetCurrentLocation, dapStart, dapState, dapStep, dapStackTrace, dapTerminate, dapThreads, dapThreadSignal,
  dapVariables, dapSetVariable, dapSetExpression, dapCompletions, dapSelectThread,
  type DapExceptionInfo as DapException, type DapFrame, type DapScope, type DapThread, type DapVariable,
} from '../bridge'
import { exceptionBreakModeLabel, exceptionHeadline, exceptionValueExpression, flattenCauseChain, showsExceptionNode } from '../exceptionInfo'
// 异常断点的共享状态（Debug 面板与「查看断点…」对话框同一份，见 src/exceptionBreakpoints.ts）。
import { applyExceptionFilters, exceptionBreakpointGroup, parseExceptionFilters, sendExceptionBreakpoints, toggleExceptionBreakpoint } from '../exceptionBreakpoints'
import { iconSize } from '../uiIcons'
import { completionSuggestions, completionTypeLabel, type DapCompletionItem } from '../debugCompletions'
import { applyLoadedSourceSnapshot, applyModuleSnapshot, capabilityReason } from '../debugSources'
import { DEFAULT_DEBUG_DATA_VIEW, collectReferenceRows, collectVarRows, visibleFrames, type DebugDataViewOptions, type VarRow } from '../debugDataView'
import { copyToClipboard } from '../clipboard'
import { debugCopyNote, debugCopyText, type DebugCopyRow, type DebugCopyMode } from '../debugValueCopy'
import { debugRowActions, debugRowTarget, type DebugRowActionTarget } from '../debugRowActions'
import { pushEvaluateHistory } from '../debugEvaluateHistory'
import { attachGuidance, attachSelectorError, loadAttachHistory, parseAttachSelector, pushAttachTarget, saveAttachHistory } from '../debugAttach'
import { loadWatches, saveWatches, DEBUG_WATCHES_LIMIT } from '../debugWatches'
import { inlineSourceScope, inlineValueEntries } from '../debugInlineValues'
import { setDebugInlineValues } from '../editorDebugLine'
import { useInlineWatches } from '../debugInlineWatchSync'
import { multilineResultText, type MultilineResultLine } from '../debugMultilineEvaluate'
import DebugRowMenu from './DebugRowMenu.vue'
import DebugValueOverlays, { type DebugValueOverlay } from './DebugValueOverlays.vue'
import DebugEvaluateDialog from './DebugEvaluateDialog.vue'
import DebugMemoryView from './DebugMemoryView.vue'
import DebugSourceLists from './DebugSourceLists.vue'
import DebugBreakpointsPane from './DebugBreakpointsPane.vue'
import DebugConsolePane from './DebugConsolePane.vue'

const props = defineProps<{ activePath: string; ready: boolean; root?: string; evaluateRequest?: { text: string; nonce: number } | null; program?: string; cwd?: string; adapterKind?: string; dataView?: DebugDataViewOptions | null }>()
const emit = defineEmits<{ jump: [target: { path?: string; line: number }] }>()
// 「设置 › 调试器」的各格（隐藏 null / 按名排序 / 行内值 / 库帧 / 移断点确认 / 自动取消静音 /
// 求值对话框形态）经 props 进来（App 从 general settings 透传，见 src/toolViewContext.ts）；
// 面板本地的两个视图开关（按类型分组 / 按数组显示）并进同一份 options，变量树一个入口消费。
// `groupByType`/`arrayViews` 声明在变量树那一段（computed 的 getter 惰性求值，顺序无碍）。
const dataView = computed<DebugDataViewOptions>(() => ({
  ...(props.dataView ?? DEFAULT_DEBUG_DATA_VIEW),
  groupByType: groupByType.value,
  arrayViews: arrayViews.value,
}))

// These three used to be a second, independent copy of the run configuration: the
// Run tab and the Debug panel could disagree about what is being launched. They now
// come from the current run configuration (App passes them down) and are read-only
// here, with a pointer to where they are edited.
const kind = computed(() => props.adapterKind?.trim() || 'cppvsdbg')
const program = computed(() => props.program?.trim() ?? '')
const cwd = computed(() => props.cwd?.trim() || '.')
// 附加说明（本机 PID / 连接标识怎么解释 + 远程附加的真实前提）在 src/debugAttach.ts。
const attachText = computed(() => attachGuidance(kind.value))
const attachId = ref('')
// 最近附加过的目标（上游 `AttachToProcessDialog` 的「最近使用」栏）：进程列表要宿主枚举通道
// （本仓没有，见 dbg/attach 判词），最近填过的标识是纯前端事实，存 localStorage。
const storage = typeof localStorage === 'undefined' ? null : localStorage
const attachHistory = ref<string[]>(loadAttachHistory(storage))
const frames = ref<DapFrame[]>([])
const scopes = ref<DapScope[]>([])
const values = reactive<Record<number, DapVariable[]>>({})   // variablesReference -> children
const open = reactive<Record<string, boolean>>({})
const busy = ref(false)
const error = ref('')
// 断点区（DebugBreakpointsPane）：停在断点后的三条规则（临时/依赖/自动取消静音）由它实现，
// refreshStack 落定当前执行点后回调它的 applyStopRules。
const breakpointsPane = ref<InstanceType<typeof DebugBreakpointsPane> | null>(null)
const threads = ref<DapThread[]>([])
// IDEA's breakpoints dialog exception rows: the adapter's filter list plus the
// checked subset. 两者都是**共享状态**（src/exceptionBreakpoints.ts）——「查看断点…」
// 对话框里的异常分组读的是同一份，勾选在两边同步。
const exceptionGroup = computed(() => exceptionBreakpointGroup())
const exceptionsOpen = ref(true)
// 行动作弹层（上游 `XDebuggerTree` 右键菜单那一组动作，见 DebugRowMenu.vue 的文件头）：
// 本仓的行是按钮，右键菜单没有宿主，用行尾按钮开一个小弹层承载同一组动作。
// 清单在 `src/debugRowActions.ts`（条目 + 禁用原因 + 变量行 → 入参的适配），
// 这里只留「弹层开在哪 + 点了之后做什么」。
type RowMenuTarget = DebugRowActionTarget & { row: DebugCopyRow }
const copyMenu = ref<{ target: RowMenuTarget; x: number; y: number } | null>(null)
// 「检查」/「与剪贴板比较」两个值浮窗（`DebugValueOverlays.vue` 是它们的共同挂载点）。
const valueOverlay = ref<DebugValueOverlay | null>(null)
const copyNote = ref('')
// 行内值（`showValuesInline`）与「按数组显示」的容器集合（`ViewAsArray` 的等价物）。
const arrayViews = ref<number[]>([])
function openCopy(target: RowMenuTarget, event: MouseEvent) { copyNote.value = ''; copyMenu.value = { target, x: event.clientX, y: event.clientY } }
function rowActions(target: RowMenuTarget) { return debugRowActions(target, { paused: dapState.paused }) }
async function pickRowAction(mode: string) {
  const menu = copyMenu.value
  if (!menu) return
  copyMenu.value = null
  const target = menu.target
  if (mode === 'copy-value' || mode === 'copy-name') {
    const copyMode: DebugCopyMode = mode === 'copy-value' ? 'value' : 'name'
    const text = debugCopyText(target.row, copyMode)
    await copyToClipboard(text)
    copyNote.value = debugCopyNote(target.row, copyMode, Boolean(text))
    return
  }
  if (mode === 'watch') { addWatchText(target.expression); return }
  if (mode === 'console') { await evaluateInConsole(target.expression); return }
  if (mode === 'array-on') { arrayViews.value = [...new Set([...arrayViews.value, target.reference])]; return }
  if (mode === 'array-off') { arrayViews.value = arrayViews.value.filter(reference => reference !== target.reference); return }
  if (mode === 'inspect') { valueOverlay.value = { mode, name: target.row.name, value: target.row.value, reference: target.reference }; return }
  if (mode === 'compare-clipboard') { valueOverlay.value = { mode, name: target.row.name, value: target.row.value, reference: target.reference } }
}
/** 变量行 → 行动作弹层的入参（`debugRowTarget`：孩子加载过才能判定「按数组显示」可用）。 */
function rowMenuTarget(row: VarRow): RowMenuTarget {
  return { ...debugRowTarget(row, values[row.reference] ?? [], arrayViews.value), row }
}
// 当前选中的栈帧。IDEA 的 Frames 视图也是"选中的那一帧才有 active 高亮、才显示它的作用域"，
// 而异常节点只在**最顶层帧**出现（`JavaStackFrame:319-321` 的 `getUiIndex() != 0` 规则）。
const selectedFrameIndex = ref(0)
const selectedFrame = computed(() => frames.value[selectedFrameIndex.value])
let frameGeneration = 0
const currentFrame = (generation: number) => generation === frameGeneration && dapState.running && dapState.paused
// DAP `exceptionInfo` 的回答：异常停住时才有值，会话继续/结束时清空。
const activeException = ref<DapException | null>(null)
const exceptionHeadlineText = computed(() => exceptionHeadline(activeException.value))
const exceptionCauses = computed(() => flattenCauseChain(activeException.value))
// IDEA 只在最顶层帧挂异常节点；切到别的帧去看局部变量时它就该消失。
const exceptionVisible = computed(() => Boolean(exceptionHeadlineText.value) && showsExceptionNode(selectedFrameIndex.value))
// 适配器给的「能求值出异常对象」的表达式；没有它就没有"展开异常对象"这一步。
const exceptionValue = computed(() => exceptionValueExpression(activeException.value))
// IDEA's Watches view: expressions re-evaluated against the current top frame on
// every stop, kept for the whole session. 本轮补**跨会话持久化**：表达式文本按项目根
// 存 localStorage（上游 WatchesManager 随项目状态保存），重启后还在，值启动时重算。
interface Watch { text: string; value: string }
const watches = ref<Watch[]>(loadWatches(storage, props.root ?? '').map(text => ({ text, value: '' })))
const newWatch = ref('')
watch(watches, list => saveWatches(storage, props.root ?? '', list.map(watch => watch.text).slice(0, DEBUG_WATCHES_LIMIT)), { deep: true })

const stopped = computed(() => dapState.running && dapState.paused)
const running = computed(() => dapState.running)
// 行内监视（上游 `InlineWatch`，规则/接线见 src/debugInlineWatchSync.ts）：锚点 = 当前帧。
const inlineWatches = useInlineWatches({
  watches,
  anchor: () => {
    const frame = selectedFrame.value
    const path = frame?.path ?? props.activePath
    return stopped.value && frame && path ? { path, line: frame.line } : null
  },
  // 就地编辑行内监视的表达式 = 改这条监视本身（上游 EditInlineWatch → showInplaceEditor）。
  renameWatch: (from, to) => {
    if (watches.value.some(watch => watch.text === to)) return
    watches.value = watches.value.map(watch => watch.text === from ? { text: to, value: '' } : watch)
    void refreshWatches()
  },
})
// Empty lists state *why* they are empty: a session that is running cannot answer
// for the threads, and a session that is not paused has no variables to show.
const threadHint = computed(() => {
  if (!running.value) return '调试会话未启动；填好 program 后点“启动”或“附加”。'
  if (!stopped.value) return '会话正在运行，暂停（⏸）后会在此列出线程。'
  return '适配器没有报告线程。'
})
const frameHint = computed(() => {
  if (!stopped.value) return '未在断点处停止，暂无调用堆栈。'
  return '当前线程没有可用的栈帧。'
})
const varsHint = computed(() => {
  if (!stopped.value) return '未在断点处停止，暂无变量。'
  return '当前帧没有可见作用域。'
})
const exitHint = computed(() => dapState.exitCode === null ? ''
  : dapState.exitCode === 0 ? '被调试程序已自行结束，退出码 0。'
    : `被调试程序已自行结束，退出码 ${dapState.exitCode}（非 0 表示异常结束）。`)
// A percentage the adapter reports can be out of range; the bar is clamped instead
// of overflowing its track. `null` means indeterminate and gets no fill at all.
const progressWidth = (percentage: number | null) =>
  percentage === null ? undefined : `${Math.min(100, Math.max(0, percentage))}%`

function rememberFilters(capabilities: Record<string, unknown> | undefined) {
  applyExceptionFilters(parseExceptionFilters(capabilities))
}

async function start() {
  error.value = ''
  if (!program.value.trim()) { error.value = '请填写要调试的程序路径。'; return }
  try {
    const result = await dapStart({ command: '', args: [], kind: kind.value.trim() || 'cppvsdbg', program: program.value.trim(), cwd: cwd.value.trim() || '.', stopOnEntry: false })
    rememberFilters(result.capabilities)
    await sendExceptionBreakpoints()
    await refreshStack()
  } catch (caught) { error.value = message(caught) }
}
// IDEA's Attach to Process: no program of our own, the adapter joins a running one
// via its selector (processId for cppvsdbg/lldb-dap, pipeName for others).
async function attach() {
  error.value = ''
  const selector = attachId.value.trim()
  const problem = attachSelectorError(selector)
  if (problem) { error.value = problem; return }
  const parsed = parseAttachSelector(selector)!
  try {
    const configuration = parsed.kind === 'pid' ? { processId: parsed.processId } : { pipeName: parsed.pipeName }
    const result = await dapStart({ command: '', args: [], kind: kind.value.trim() || 'cppvsdbg', program: '', cwd: cwd.value.trim() || '.', stopOnEntry: false, configuration: { request: 'attach', ...configuration } })
    attachHistory.value = pushAttachTarget(attachHistory.value, selector)
    saveAttachHistory(storage, attachHistory.value)
    rememberFilters(result.capabilities)
    await sendExceptionBreakpoints()
    await refreshStack()
  } catch (caught) { error.value = message(caught) }
}
async function step(action: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut') {
  error.value = ''; busy.value = true
  try { await dapStep(action); if (action !== 'pause') await refreshStack() }
  catch (caught) { error.value = message(caught) }
  finally { busy.value = false }
}
async function stop() { busy.value = true; try { await dapTerminate(); frames.value = []; scopes.value = []; threads.value = [] } finally { busy.value = false } }
// IDEA's Disconnect (as opposed to Stop): the adapter detaches first, which matters
// for an attached process that must stay alive after the debugger leaves. That is
// DAP `disconnect {terminateDebuggee: false}` —— 之前这里发的是默认的 terminate=true，
// 与按钮提示"保留被调试进程"不符（真会把目标进程杀掉）。
async function disconnect() {
  busy.value = true
  try {
    await dapDisconnect(false)
    frames.value = []; scopes.value = []; threads.value = []
  } catch (caught) { error.value = message(caught) }
  finally { busy.value = false }
}
// IDEA Frames 视图的「丢弃帧」：DAP `restartFrame`（需要适配器声明 supportsRestartFrame）——
// 把执行回滚到这一帧重新跑，用于"回到上一层再看一遍"。
async function dropFrame(frame: DapFrame) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await dapRestartFrame(frame.id)
    await refreshStack()
  } catch (caught) {
    const code = caught instanceof BridgeError ? caught.code : ''
    error.value = code === 'DAP_UNSUPPORTED' ? '该调试适配器不支持丢弃帧。' : message(caught)
  } finally { busy.value = false }
}
// 协议侧补齐的族：反向调试（supportsStepBack）。这个能力位规范**默认 false**：
// 没声明就禁用入口并写明原因。内存/反汇编与清单重取也是同族，分别拆在
// DebugMemoryView.vue / DebugSourceLists.vue。
const canStepBack = computed(() => dapCapability('supportsStepBack'))
async function reverse(kind: 'back' | 'continue') {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await (kind === 'back' ? dapStepBack() : dapReverseContinue()); await refreshStack() }
  catch (caught) { error.value = message(caught) } finally { busy.value = false }
}
// IDEA 的「重新运行」（Run 工具窗口的 Ctrl+F5 / Debug 面板）：适配器声明了 supportsRestartRequest
// 就原地重启（断点与异常过滤器都还留在适配器里），否则退化成「停止 + 重新启动」。
async function restart() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await dapRestart({ noDebug: false })
    await refreshStack()
  } catch (caught) {
    const code = caught instanceof BridgeError ? caught.code : ''
    if (code !== 'DAP_UNSUPPORTED') { error.value = message(caught); return }
    try {
      await dapTerminate()
      frames.value = []; scopes.value = []; threads.value = []
      await start()
    } catch (fallback) { error.value = message(fallback) }
  } finally { busy.value = false }
}
// The gutter mirrors the adapter's own breakpoint list whenever a session becomes
// live, so a session started elsewhere still shows its breakpoints here.
watch(() => dapState.running, running => { if (running) void dapLoadBreakpoints().then(() => breakpointsPane.value?.resendRemembered()).catch(() => undefined) }, { immediate: true })
// 读回来之后还要按面板的状态**全量重发**一遍：静音 / 取消勾选 / 依赖这三条位只在本仓前端，native 只记得上次收到的那份。
// 依据见 `src/dbgBreakpointUpdate.ts` 文件头（`JavaBreakpointHandler.java:31-44` 装入 + `…VisualizationManager.kt:306-315` 全量重算）。
// The thread list is refetched on the adapter's own `thread` events (a thread can
// start or exit between two stops, which is why this is not only driven by stops).
async function refreshThreads() {
  if (!dapState.running) { threads.value = []; return }
  try { threads.value = (await dapThreads()).threads }
  catch (caught) { error.value = message(caught); threads.value = [] }
}
async function refreshStack() {
  const generation = ++frameGeneration
  if (!stopped.value) { frames.value = []; scopes.value = []; dapSetCurrentLocation(null); setDebugInlineValues(null); return }
  try {
    void refreshThreads()
    const result = await dapStackTrace()
    if (!currentFrame(generation)) return
    frames.value = result.frames
    selectedFrameIndex.value = 0
    const top = frames.value[0]
    if (top) dapSetCurrentLocation({ path: top.path ?? props.activePath, line: top.line }); else dapSetCurrentLocation(null)
    await refreshScopes(selectedFrame.value?.id)
    syncInlineValues()
    await breakpointsPane.value?.applyStopRules()
    if (currentFrame(generation)) { await refreshWatches(); await refreshException() }
  } catch (caught) { if (currentFrame(generation)) { error.value = message(caught); frames.value = []; dapSetCurrentLocation(null) } }
}
// Switching threads is the IDEA Threads dropdown's primary action; we just ask the
// adapter for the chosen thread's frames and reuse the same stack UI.
async function selectThread(id: number) {
  error.value = ''
  if (!stopped.value) return
  const generation = ++frameGeneration
  dapSelectThread(id)
  try {
    const result = await dapStackTrace(id)
    if (!currentFrame(generation)) return
    frames.value = result.frames
    selectedFrameIndex.value = 0
    const top = frames.value[0]
    if (top) dapSetCurrentLocation({ path: top.path ?? props.activePath, line: top.line }); else dapSetCurrentLocation(null)
    await refreshScopes(selectedFrame.value?.id)
    syncInlineValues()
    if (currentFrame(generation)) { await refreshWatches(); await refreshException() }
  } catch (caught) { if (currentFrame(generation)) error.value = message(caught) }
}
async function refreshScopes(frameId?: number) {
  const generation = frameGeneration
  scopes.value = []
  for (const key of Object.keys(values)) delete values[Number(key)]
  if (frameId === undefined) return
  try {
    const result = await dapScopes(frameId)
    if (!currentFrame(generation)) return
    scopes.value = result.scopes
    for (const scope of scopes.value) { if (!currentFrame(generation)) return; if (!scope.expensive) await loadScope(scope.reference) }
  } catch (caught) { if (currentFrame(generation)) error.value = message(caught) }
}
// DAP `exceptionInfo`：**只在** `stopped` 的 reason 是 exception 时才问。断点/单步/暂停
// 这些停机原因根本没有异常可报，问了适配器也只能答"没有"，白跑一次往返。
// 适配器答不上来时回的是 `available:false`（请求本身成功），不会走到 catch。
async function refreshException() {
  const generation = frameGeneration
  activeException.value = null
  if (!stopped.value || !dapState.reason?.startsWith('exception')) return
  try {
    const info = await dapExceptionInfo(dapState.threadId)
    if (currentFrame(generation)) activeException.value = info.available ? info : null
  } catch (caught) {
    // 真的失败了（超时、适配器不支持这个请求、会话已结束）。不静默吞掉 —— 面板已经有
    // 错误行，卡片本身不显示。
    error.value = message(caught)
  }
}
// 选帧：IDEA 的 Frames 视图点哪一帧，作用域就换成哪一帧的；`active` 高亮跟着走。
// 异常节点不重新拉取（它属于线程而不是帧），只是按 `showsExceptionNode` 决定显不显示。
async function selectFrame(index: number, frameId: number) {
  if (!stopped.value || frames.value[index]?.id !== frameId) return
  const generation = ++frameGeneration
  selectedFrameIndex.value = index
  completions.value = []; exprResult.value = ''; exprReference.value = 0
  const frame = selectedFrame.value
  dapSetCurrentLocation(frame ? { path: frame.path ?? props.activePath, line: frame.line } : null)
  await refreshScopes(frameId)
  syncInlineValues()
  if (currentFrame(generation)) await refreshWatches()
}
async function loadScope(reference: number) {
  const generation = frameGeneration
  try { const result = await dapVariables(reference); if (currentFrame(generation)) values[reference] = result.variables }
  catch (caught) { if (currentFrame(generation)) { values[reference] = []; error.value = message(caught) } }
}
// Variables are a tree of arbitrary depth: a scope holds variables, and any variable
// with a `variablesReference` opens another level. 摊平与「数据视图」选项（隐藏 null /
// 按名排序 / 按类型分组 / 按数组显示，XDebuggerDataViewSettings 一族）都在
// src/debugDataView.ts，可单测。
const groupByType = ref(false)
const varRows = computed<VarRow[]>(() => collectVarRows(scopes.value, values, open, dataView.value))
// A row is toggled by its path, not its reference: the same reference can appear at
// several places and each of them must remember its own state.
function toggleRow(row: VarRow) {
  if (!row.expandable) return
  open[row.key] = !open[row.key]
  if (open[row.key] && values[row.reference] === undefined) void loadScope(row.reference)
}
// IDEA 的 XValue.setValue（变量树里改值）与 Watches 的「Set Value…」：DAP 规范分别是
// `setVariable`（容器 reference + 变量名 + 新值）与 `setExpression`（表达式 + 新值 + 可选 frameId）。
// 两者返回的是同一条变量的新值，但父节点可能因此变化，所以成功后重读容器 / 重算监视。
const editing = ref<{ kind: 'var' | 'watch'; key: string; draft: string } | null>(null)
const editInput = ref<HTMLInputElement>()
const setBusy = ref(false)
async function beginEdit(kind: 'var' | 'watch', key: string, current: string) {
  editing.value = { kind, key, draft: current }
  await nextTick()
  editInput.value?.select()
}
function cancelEdit() { editing.value = null }
async function commitEdit(kind: 'var' | 'watch', key: string, target: { container?: number; apiName?: string; expression?: string; frameId?: number }) {
  const next = editing.value
  if (!next || next.kind !== kind || next.key !== key || setBusy.value) return
  const value = next.draft
  setBusy.value = true
  error.value = ''
  try {
    if (kind === 'var') {
      await dapSetVariable(target.container ?? 0, target.apiName ?? '', value)
      editing.value = null
      await loadScope(target.container ?? 0)
    } else {
      const result = await dapSetExpression(target.expression ?? '', value, target.frameId ?? 0)
      editing.value = null
      const watch = watches.value.find(entry => entry.text === target.expression)
      if (watch) watch.value = `${result.value}${result.type ? ` : ${result.type}` : ''}`
    }
  } catch (caught) { error.value = message(caught) }
  finally { setBusy.value = false }
}
function message(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }

watch(() => dapState.paused, paused => {
  // 继续运行后异常节点就该消失（IDEA 的异常只在停在异常上时显示）；行内值同理。
  if (!paused) { ++frameGeneration; activeException.value = null; scopes.value = []; frames.value = []; setDebugInlineValues(null); inlineWatches.clear() }
  else void refreshStack()
}, { immediate: true })
watch(() => dapState.running, live => { if (!live) { frames.value = []; scopes.value = []; threads.value = []; activeException.value = null; selectedFrameIndex.value = 0; setDebugInlineValues(null); inlineWatches.clear() } })
// A `thread` event means the adapter's list changed; the panel only ever shows the
// adapter's answer, so it refetches instead of guessing at the delta.
watch(() => dapThreadSignal.version, () => void refreshThreads())
// IDEA's Watches: every stop re-evaluates the list against the new top frame.
async function refreshWatches() {
  if (!stopped.value) return
  const frame = selectedFrame.value?.id ?? 0
  const generation = frameGeneration
  for (const watch of watches.value) {
    if (!currentFrame(generation)) return
    try {
      const result = await dapEvaluate(watch.text, 'watch', frame)
      if (currentFrame(generation)) watch.value = `${result.result}${result.type ? ` : ${result.type}` : ''}`
    } catch (caught) { if (currentFrame(generation)) watch.value = message(caught) }
  }
  inlineWatches.sync()   // 行内监视的文本就是这一轮算出的值（同一次停住里推进）
}
function addWatch() {
  const text = newWatch.value.trim()
  addWatchText(text)
  if (text) newWatch.value = ''
}
/** 加监视的具体动作（输入框与行动作弹层的 `XAddToWatchesTreeAction` 共用）。 */
function addWatchText(text: string) {
  const trimmed = text.trim()
  if (!trimmed || watches.value.some(watch => watch.text === trimmed)) return
  watches.value.push({ text: trimmed, value: '' })
  void refreshWatches()
}
function removeWatch(text: string) { watches.value = watches.value.filter(watch => watch.text !== text) }

// 在控制台中求值（上游 `EvaluateInConsoleFromTreeAction`）：DAP `evaluate` 的 `repl` 上下文，
// 结果写进调试控制台 —— 与适配器自己的 repl 输出同一块面板（`dapConsole`）。
async function evaluateInConsole(expression: string) {
  const text = expression.trim()
  if (!text || !dapState.paused) return
  error.value = ''
  try {
    const result = await dapEvaluate(text, 'repl', selectedFrame.value?.id ?? 0)
    dapConsole.push({ category: 'console', text: `> ${text}` })
    dapConsole.push({ category: 'console', text: `${result.result}${result.type ? ` : ${result.type}` : ''}` })
  } catch (caught) { error.value = message(caught) }
}
// 掉到当前执行点（上游 `ShowExecutionPointAction`，Alt+F10）：把编辑器跳到适配器报告的
// 当前栈顶位置 —— 浏览器（读了别的文件）之后一眼回到"程序停在哪"。
function showExecutionPoint() {
  const location = dapState.currentLocation
    ?? (selectedFrame.value ? { path: selectedFrame.value.path ?? props.activePath, line: selectedFrame.value.line } : null)
  if (location) emit('jump', location)
}

// IDEA's Evaluate Expression (Alt+F8): the editor hands over the selection, the panel
// runs it against the frame the debugger is stopped in.
const expr = ref('')
// 求值历史（上游 `XDebuggerTreeWithHistory` 的表达式历史）：只记**成功求值过**的表达式，
// 作为 datalist 候选与 DAP 补全同一个下拉；规则在 src/debugEvaluateHistory.ts。
const exprHistory = ref<string[]>([])
// DAP `completions`：表达式输入框的补全。**IDEA 侧没有平台级对应类**（见 src/debugCompletions.ts
// 的模块注释）—— 这件事被收进协议，由适配器回答，所以这里只管请求与落项。
// 请求失败（没声明 `supportsCompletionsRequest`、会话已结束…）**静默**：补全只是锦上添花，
// 为一个可选提示弹错误会打断正在输入表达式的人。
const completions = ref<DapCompletionItem[]>([])
let completionTimer: number | undefined
let completionGeneration = 0
function scheduleCompletions(text: string) {
  const requestGeneration = ++completionGeneration
  const generation = frameGeneration
  if (completionTimer !== undefined) clearTimeout(completionTimer)
  const trimmed = text.trim()
  if (!trimmed || !stopped.value) { completions.value = []; return }
  completionTimer = window.setTimeout(() => {
    completionTimer = undefined
    if (!currentFrame(generation)) return
    const current = () => requestGeneration === completionGeneration && currentFrame(generation)
    void dapCompletions(trimmed, trimmed.length, selectedFrame.value?.id ?? 0)
      .then(result => { if (current()) completions.value = result.available ? completionSuggestions(result.items) : [] })
      .catch(() => { if (current()) completions.value = [] })
  }, 250)
}
watch(expr, value => scheduleCompletions(value))
watch(newWatch, value => scheduleCompletions(value))
// 继续运行 / 会话结束后候选就失效了（那是上一帧的符号）。
watch(() => dapState.paused, paused => { if (!paused) completions.value = [] })
onBeforeUnmount(() => { if (completionTimer !== undefined) clearTimeout(completionTimer); setDebugInlineValues(null); inlineWatches.clear() })
const exprResult = ref('')
// An adapter answers `evaluate` with a `variablesReference` when the value is a
// structure: keep it (and its children) so the result can be browsed like a watch.
const exprReference = ref(0)
const exprOpen = ref(true)
const exprRows = computed<VarRow[]>(() => {
  if (!exprReference.value) return []
  return collectReferenceRows(exprReference.value, values, open, dataView.value)
})
// 展开异常对象：把适配器给的 `evaluateName` 塞进求值框再走一遍求值通道
// （IDEA 里等价于在变量树里展开那个异常节点）。
async function inspectException() {
  if (!exceptionValue.value) return
  expr.value = exceptionValue.value
  await runEvaluate()
}
async function runEvaluate() {
  const generation = frameGeneration
  const text = expr.value.trim()
  if (!text) { exprResult.value = ''; exprReference.value = 0; return }
  if (!stopped.value) { exprResult.value = '需要先停在断点上才能求值。'; exprReference.value = 0; return }
  try {
    const result = await dapEvaluate(text, 'watch', selectedFrame.value?.id ?? 0)
    if (!currentFrame(generation) || expr.value.trim() !== text) return
    exprResult.value = `${text} = ${result.result}${result.type ? ` : ${result.type}` : ''}`
    exprReference.value = result.variablesReference ?? 0
    exprOpen.value = true
    exprHistory.value = pushEvaluateHistory(exprHistory.value, text)
    // Dereference immediately so the tree has something to expand into.
    if (exprReference.value > 0 && values[exprReference.value] === undefined) await loadScope(exprReference.value)
  } catch (caught) { if (currentFrame(generation)) { exprResult.value = message(caught); exprReference.value = 0 } }
}
function toggleExprRow(row: VarRow) { toggleRow(row) }
// 多行求值对话框（上游 `XExpressionDialog` / `XDebuggerMultilineEditor`，口径见
// src/debugMultilineEvaluate.ts）：逐行、同帧、按顺序求值；失败行标红但不阻断后续行。
const evaluateOpen = ref(false)
const evaluating = ref(false)
const multilineResults = ref<MultilineResultLine[]>([])
async function runMultiline(lines: string[]) {
  if (evaluating.value || !lines.length) return
  evaluating.value = true
  const generation = frameGeneration
  const frame = selectedFrame.value?.id ?? 0
  const results: MultilineResultLine[] = []
  multilineResults.value = results
  try {
    for (const line of lines) {
      if (!currentFrame(generation)) break
      try {
        const result = await dapEvaluate(line, 'watch', frame)
        results.push({ expression: line, text: multilineResultText(line, result.result, result.type), error: false })
        exprHistory.value = pushEvaluateHistory(exprHistory.value, line)
      } catch (caught) {
        results.push({ expression: line, text: `${line}：${message(caught)}`, error: true })
      }
      multilineResults.value = [...results]
    }
  } finally { evaluating.value = false }
}
function removeHistory(text: string) { exprHistory.value = exprHistory.value.filter(entry => entry !== text) }
function clearHistory() { exprHistory.value = [] }
// 行内值（上游 `XDebuggerInlineValuesProvider` 的子集，见 src/debugInlineValues.ts）：
// 每次刷新作用域后把当前帧第一个已加载作用域的变量推进编辑器扩展（CodeEditor 冻结，
// 挂点是它已经在用的 `debugLineExtension`，见 src/editorDebugLine.ts）。
function syncInlineValues() {
  if (!dataView.value.showValuesInline || !stopped.value) { setDebugInlineValues(null); return }
  const frame = selectedFrame.value
  const scope = inlineSourceScope(scopes.value, values)
  const entries = scope ? inlineValueEntries(values[scope.reference] ?? []) : []
  setDebugInlineValues(frame && entries.length ? { line: frame.line, entries } : null)
}
watch(() => props.evaluateRequest?.nonce, () => {
  const request = props.evaluateRequest
  if (!request) return
  expr.value = request.text
  void runEvaluate()
})
</script>

<template>
  <div class="debug-panel">
    <div class="panel-heading"><span><Bug :size="iconSize.control" />调试</span></div>

    <div class="debug-config">
      <p class="debug-field"><span>kind</span><strong>{{ kind }}</strong></p>
      <p class="debug-field"><span>program</span><strong>{{ program || '（未填写）' }}</strong></p>
      <p class="debug-field"><span>cwd</span><strong>{{ cwd }}</strong></p>
      <p class="debug-hint">这些值来自「运行」面板的当前配置，改配置即生效（避免两处各存一份）。</p>
      <div class="debug-config-buttons">
        <button class="debug-btn primary" :disabled="!ready || busy || running" title="启动调试会话（command 取自 TaoCode.dap.json 对应 kind）" @click="start"><Bug :size="iconSize.menu" />启动</button>
        <!-- IDEA's Attach to Process: the same handshake with the `attach` request. -->
        <button class="debug-btn" :disabled="!ready || busy || running" title="附加到正在运行的进程（进程 PID 或管道名）" @click="attach"><Crosshair :size="iconSize.menu" />附加</button>
      </div>
      <label class="debug-field"><span>附加到</span><input v-model="attachId" list="debug-attach-history" class="debug-input" aria-label="要附加的进程 PID 或管道名" placeholder="PID（如 4242）或 pipeName" spellcheck="false" @keydown.enter.prevent="attach" /></label>
      <datalist id="debug-attach-history">
        <option v-for="entry in attachHistory" :key="`attach:${entry}`" :value="entry">最近附加</option>
      </datalist>
      <p v-if="attachHistory.length" class="debug-hint">最近附加过：{{ attachHistory.slice(0, 3).join('、') }}</p>
      <p class="debug-hint">{{ attachText }}</p>
    </div>

    <div v-if="exceptionGroup" class="debug-exceptions">
      <button class="debug-collapse" :aria-expanded="exceptionsOpen" @click="exceptionsOpen = !exceptionsOpen">
        <span class="debug-expander"><ChevronDown v-if="exceptionsOpen" :size="iconSize.dense" aria-hidden="true" /><ChevronRight v-else :size="iconSize.dense" aria-hidden="true" /></span>
        <span class="debug-exceptions-title">{{ exceptionGroup.label }}（{{ exceptionGroup.enabled }}/{{ exceptionGroup.total }}）</span>
      </button>
      <template v-if="exceptionsOpen">
        <label v-for="row in exceptionGroup.rows" :key="row.filter" class="debug-exception" :title="row.description">
          <input type="checkbox" :checked="row.checked" @change="toggleExceptionBreakpoint(row.filter)" />
          {{ row.label }}
        </label>
      </template>
    </div>

    <div class="debug-toolbar">
      <button class="debug-btn" :disabled="!stopped || busy" title="继续 (F9)" @click="step('continue')"><Play :size="iconSize.menu" />继续</button>
      <button class="debug-btn" :disabled="!running || stopped || busy" title="暂停" aria-label="暂停" @click="step('pause')"><Pause :size="iconSize.menu" /></button>
      <button class="debug-btn" :disabled="!stopped || busy" title="单步跳过 (F8)" aria-label="单步跳过" @click="step('next')"><StepForward :size="iconSize.menu" /></button>
      <button class="debug-btn" :disabled="!stopped || busy" title="单步进入 (F7)" aria-label="单步进入" @click="step('stepIn')"><ChevronDown :size="iconSize.menu" /></button>
      <button class="debug-btn" :disabled="!stopped || busy" title="单步跳出 (Shift+F8)" aria-label="单步跳出" @click="step('stepOut')"><ChevronRight :size="iconSize.menu" /></button>
      <!-- DAP `stepBack` / `reverseContinue`（反向调试）共用 supportsStepBack（规范默认 false）：
           没声明的适配器禁用按钮并在 title 里写明原因 —— 不渲染一个点了没反应的假控件。 -->
      <button v-if="running" class="debug-btn" :disabled="!stopped || busy || !canStepBack" :title="canStepBack ? '反向执行一步' : capabilityReason('supportsStepBack')" aria-label="反向执行一步" @click="reverse('back')"><StepBack :size="iconSize.menu" /></button>
      <button v-if="running" class="debug-btn" :disabled="!stopped || busy || !canStepBack" :title="canStepBack ? '反向继续执行' : capabilityReason('supportsStepBack')" aria-label="反向继续执行" @click="reverse('continue')"><Rewind :size="iconSize.menu" /></button>      <button class="debug-btn" :disabled="!running || busy" title="重新运行 (Ctrl+F5)" aria-label="重新运行" @click="restart"><RefreshCw :size="iconSize.menu" /></button>
      <button class="debug-btn" :disabled="!running || busy" title="停止" aria-label="停止" @click="stop"><Square :size="iconSize.menu" /></button>
      <button class="debug-btn" :disabled="!running || busy" title="断开调试器（保留被调试进程）" aria-label="断开调试器" @click="disconnect"><X :size="iconSize.menu" /></button>
      <!-- 上游 `ShowExecutionPointAction`（Alt+F10）：从别的文件跳回当前执行点。 -->
      <button class="debug-btn" :disabled="!dapState.currentLocation" title="显示执行点（跳到当前停止位置）" aria-label="显示执行点" @click="showExecutionPoint"><LocateFixed :size="iconSize.menu" /></button>
    </div>

    <p v-if="error" class="debug-error">{{ error }}</p>
    <p v-if="copyNote" class="debug-copy-note" role="status">{{ copyNote }}</p>

    <!-- 内存 / 反汇编视图：整块拆到 DebugMemoryView.vue（面板贴着机检上限），
         没声明能力的适配器整块不渲染。 -->
    <DebugMemoryView v-if="running && (dapCapability('supportsReadMemoryRequest') || dapCapability('supportsDisassembleRequest'))" :stopped="stopped" />
    <div class="debug-evaluate">
      <!-- 补全用原生 `<datalist>`：不引入新的下拉组件（也就没有新的选中/键盘/定位逻辑要维护），
             而 IDEA 的 Evaluate 输入框本来就是"边打字边给候选"。 -->
<input v-model="expr" list="debug-completions" class="debug-input" aria-label="调试表达式" placeholder="表达式，回车求值（编辑器里 Alt+F8 取选区）" spellcheck="false" @keydown.enter.prevent="runEvaluate" />
      <datalist id="debug-completions">
        <option v-for="item in completions" :key="item.label" :value="item.label">{{ completionTypeLabel(item.type) }}</option>
        <option v-for="entry in exprHistory" :key="`history:${entry}`" :value="entry">历史</option>
      </datalist>
      <button class="debug-btn" :disabled="!stopped || busy" title="求值 (Alt+F8)" @click="runEvaluate">求值</button>
      <!-- 上游 `XExpressionDialog` / `XDebuggerMultilineEditor`：多行（代码片段）求值 + 历史面板。 -->
      <button class="debug-btn" :disabled="!stopped" title="多行求值 / 求值历史" @click="evaluateOpen = true"><SquarePen :size="iconSize.menu" />求值…</button>
    </div>
    <p v-if="exprResult" class="debug-eval-result">{{ exprResult }}</p>
    <div v-if="exprOpen && exprRows.length" class="debug-vars" role="tree" aria-label="求值结果的成员">
      <button
        v-for="row in exprRows" :key="row.key" class="debug-row" role="treeitem" :class="row.state === 'value' ? undefined : 'debug-row-muted'"
        :style="{ paddingLeft: `${12 + row.depth * 14}px` }" :aria-level="row.depth + 1"
        :aria-expanded="row.expandable ? row.expanded : undefined" @click="toggleExprRow(row)"
      >
        <span class="debug-expander"><ChevronDown v-if="row.expandable && row.expanded" :size="iconSize.dense" aria-hidden="true" /><ChevronRight v-else-if="row.expandable" :size="iconSize.dense" aria-hidden="true" /></span>
        <span class="debug-name">{{ row.name }}</span>
        <span class="debug-value">{{ row.value }}</span>
        <span class="debug-type">{{ row.type }}</span>
      </button>
    </div>
    <span v-if="dapState.reason" class="debug-reason">已停止：{{ dapState.reason }} · 线程 {{ dapState.threadId }}</span>
    <span v-else-if="running" class="debug-reason">运行中</span>
    <span v-else class="debug-reason">未启动</span>
    <!-- `exited` is the debuggee's own status, not the session's: the session can
         still be alive afterwards, so this is deliberately not the "已终止" wording. -->
    <span v-if="dapState.exitCode !== null" class="debug-exit" :class="dapState.exitCode === 0 ? 'telemetry' : 'stderr'" :title="exitHint">
      程序已退出 · 退出码 {{ dapState.exitCode }}
    </span>

    <template v-if="dapProgress.length">
      <div class="debug-section-title">进度 <span>· {{ dapProgress.length }}</span></div>
      <div class="debug-progress" role="group" aria-label="适配器进度">
        <div v-for="entry in dapProgress" :key="entry.id" class="debug-progress-row">
          <div class="debug-progress-head">
            <!-- A start can carry a title, a message or neither; the row must never
                 be empty, so the fallback says what it is. -->
            <span class="debug-progress-title">{{ entry.title || entry.message || '正在处理' }}</span>
            <span class="debug-progress-pct">{{ entry.percentage === null ? '进行中' : `${Math.round(entry.percentage)}%` }}</span>
          </div>
          <div
            class="debug-progress-track" :class="{ indeterminate: entry.percentage === null }" role="progressbar"
            :aria-label="entry.title || entry.message || '适配器进度'" :aria-valuemin="0" :aria-valuemax="100"
            :aria-valuenow="entry.percentage === null ? undefined : Math.round(entry.percentage)"
          >
            <div v-if="entry.percentage !== null" class="debug-progress-fill" :style="{ width: progressWidth(entry.percentage) }"></div>
          </div>
          <span v-if="entry.title && entry.message" class="debug-progress-msg">{{ entry.message }}</span>
        </div>
      </div>
    </template>

    <DebugBreakpointsPane ref="breakpointsPane" :active-path="activePath" :root="props.root" :confirm-removal="dataView.confirmBreakpointRemoval === true" :unmute-on-stop="dataView.unmuteOnStop === true" />

    <div class="debug-section-title">线程 <span v-if="threads.length">· {{ threads.length }}</span></div>
    <div class="debug-stack" role="group" aria-label="线程列表">
      <button v-for="thread in threads" :key="thread.id" class="debug-frame" :class="{ active: thread.id === dapState.threadId }" :aria-current="thread.id === dapState.threadId ? 'true' : undefined" :title="`切换到线程 ${thread.name}`" @click="selectThread(thread.id)">
        <span class="debug-frame-name">#{{ thread.id }} {{ thread.name }}</span>
        <span v-if="thread.id === dapState.threadId" class="debug-frame-loc">当前</span>
      </button>
      <div v-if="!threads.length" class="debug-empty">{{ threadHint }}</div>
    </div>

    <div class="debug-section-title">调用堆栈</div>
    <div class="debug-stack" role="group" aria-label="调用堆栈">
      <!-- 「库帧」用适配器自己的 presentationHint 判定（见 src/debugDataView.ts 的 visibleFrames）。 -->
      <div v-for="frame in visibleFrames(frames, dataView.showLibraryFrames === true, selectedFrameIndex)" :key="frame.id" class="debug-frame-wrap">
        <button class="debug-frame" :class="{ active: frames.indexOf(frame) === selectedFrameIndex }"
                @click="selectFrame(frames.indexOf(frame), frame.id); emit('jump', { path: frame.path, line: frame.line })">
          <span class="debug-frame-name">{{ frame.name }}<span v-if="frame.presentationHint === 'subtle'" class="small-muted" title="适配器把这一帧标为库/运行时帧"> · 库</span></span>
          <span class="debug-frame-loc">{{ frame.path ? frame.path.split('/').pop() + ':' : '' }}{{ frame.line }}</span>
        </button>
        <button class="icon-button debug-set" :disabled="busy" title="丢弃帧：回到这一帧重新执行" aria-label="丢弃帧" @click="dropFrame(frame)"><RefreshCw :size="iconSize.dense" /></button>
      </div>
      <div v-if="!visibleFrames(frames, dataView.showLibraryFrames === true, selectedFrameIndex).length" class="debug-empty">{{ frameHint }}</div>
    </div>

    <div class="debug-section-title">
      监视（Watches）
      <span class="debug-watch-note">跨会话保存 · {{ watches.length }}/{{ DEBUG_WATCHES_LIMIT }}</span>
    </div>
    <div class="debug-watches">
      <div v-for="watch in watches" :key="watch.text" class="debug-row">
        <button class="chip-x" title="移除监视" :aria-label="`移除监视 ${watch.text}`" @click="removeWatch(watch.text)"><X :size="iconSize.chip" /></button>
        <span class="debug-name">{{ watch.text }}</span>
        <!-- IDEA Watches 的「Set Value…」：DAP `setExpression`（表达式 + 新值）。 -->
        <template v-if="editing?.kind === 'watch' && editing.key === watch.text">
          <input ref="editInput" v-model="editing.draft" class="debug-input debug-edit-input" :aria-label="`设置 ${watch.text} 的值`" spellcheck="false" @keydown.enter.prevent="commitEdit('watch', watch.text, { expression: watch.text, frameId: selectedFrame?.id ?? 0 })" @keydown.esc.prevent="cancelEdit" />
          <button class="debug-mini" :disabled="setBusy" @click="commitEdit('watch', watch.text, { expression: watch.text, frameId: selectedFrame?.id ?? 0 })">设置</button>
        </template>
        <template v-else>
          <span class="debug-value">{{ watch.value || '—' }}</span>
          <!-- 行内监视（上游 InlineWatch）：画进编辑器当前帧那一行的行尾；再点一次撤掉。 -->
          <button class="icon-button debug-set" :disabled="!dapState.paused || !selectedFrame" :class="{ 'inline-on': inlineWatches.isShown(watch.text) }" :title="inlineWatches.isShown(watch.text) ? `从编辑器第 ${selectedFrame?.line} 行撤下行内监视` : `在编辑器第 ${selectedFrame?.line ?? 0} 行画行内监视`" :aria-label="`行内显示 ${watch.text}`" @click.stop="inlineWatches.toggle(watch.text)"><Eye :size="iconSize.dense" /></button>
          <button class="icon-button debug-set" :disabled="!dapState.paused" :title="`设置 ${watch.text} 的值`" :aria-label="`设置 ${watch.text} 的值`" @click="beginEdit('watch', watch.text, watch.value)"><PenLine :size="iconSize.dense" /></button>
          <button class="icon-button debug-set" :title="`复制 ${watch.text}`" :aria-label="`复制 ${watch.text}`" @click.stop="openCopy({ row: { name: watch.text, value: watch.value }, expression: watch.text, reference: 0, isValue: true, value: watch.value, arrayView: false, canArray: false }, $event)"><Copy :size="iconSize.dense" /></button>
        </template>
      </div>
      <div class="debug-watch-add">
        <input v-model="newWatch" list="debug-completions" class="debug-input" aria-label="新监视表达式" placeholder="监视表达式，回车添加" spellcheck="false" @keydown.enter.prevent="addWatch" />
      </div>
    </div>

    <!-- DAP `exceptionInfo` → IDEA 的 `JavaStackFrame.createExceptionNodes`
         （java/debugger/impl/src/com/intellij/debugger/engine/JavaStackFrame.java:319-331）：
         异常断点命中时把抛出的异常对象当成变量树里的一个节点，**且只在最顶层帧**显示
         （`getUiIndex() != 0` 时那个方法返回空列表）。 -->
    <div v-if="exceptionVisible" class="debug-exception" role="group" aria-label="异常">
      <div class="debug-exception-head">
        <Bug :size="iconSize.dense" />
        <span class="debug-exception-title">{{ exceptionHeadlineText }}</span>
        <span v-if="activeException?.breakMode" class="small-muted">{{ exceptionBreakModeLabel(activeException.breakMode) }}</span>
      </div>
      <div v-for="(cause, index) in exceptionCauses" :key="index" class="debug-exception-cause" :style="{ paddingLeft: `${4 + cause.depth * 12}px` }">
        <span class="debug-name">{{ cause.depth === 0 ? '异常' : `原因 ${cause.depth}` }}</span>
        <span class="debug-value">{{ cause.type }}{{ cause.message ? `: ${cause.message}` : '' }}</span>
        <span v-if="cause.fullTypeName && cause.fullTypeName !== cause.type" class="small-muted">{{ cause.fullTypeName }}</span>
        <pre v-if="cause.stackTrace" class="debug-exception-trace">{{ cause.stackTrace }}</pre>
      </div>
      <!-- `evaluateName` 是适配器给的"能把这个异常对象当表达式求值的名字" —— 有它才能像
           IDEA 的 JavaValue 那样把异常对象展开成字段树。走已有的求值通道，不另造一套。 -->
      <button v-if="exceptionValue" class="debug-mini" :disabled="busy" :title="`求值 ${exceptionValue}`" @click="inspectException">查看异常对象</button>
    </div>

    <div class="debug-section-title">
      变量
      <!-- 按类型分组（上游 `XValueGroup`/`XValueGroupNodeImpl` 的等价物，见 src/debugDataView.ts）。 -->
      <button class="chip-x debug-view-toggle" :class="{ active: groupByType }" :title="groupByType ? '取消按类型分组' : '按类型分组（同一层里类型相同的变量聚成组）'" :aria-pressed="groupByType" aria-label="按类型分组" @click="groupByType = !groupByType"><ListTree :size="iconSize.chip" /></button>
    </div>
    <div class="debug-vars" role="tree" aria-label="变量">
      <div v-for="row in varRows" :key="row.key" class="debug-row-wrap">
        <!-- IDEA 的 XValue.setValue：变量行可以就地改值（DAP `setVariable`，要的是**容器** reference）。 -->
        <div v-if="editing?.kind === 'var' && editing.key === row.key" class="debug-row debug-row-editing" :style="{ paddingLeft: `${12 + row.depth * 14}px` }">
          <span class="debug-name">{{ row.name }} =</span>
          <input ref="editInput" v-model="editing.draft" class="debug-input debug-edit-input" :aria-label="`设置 ${row.name} 的值`" spellcheck="false" @keydown.enter.prevent="commitEdit('var', row.key, { container: row.container, apiName: row.apiName })" @keydown.esc.prevent="cancelEdit" />
          <button class="debug-mini" :disabled="setBusy" @click="commitEdit('var', row.key, { container: row.container, apiName: row.apiName })">设置</button>
        </div>
        <template v-else>
          <button
            class="debug-row" role="treeitem" :class="[row.state === 'value' ? undefined : 'debug-row-muted', row.group ? 'debug-row-group' : undefined]"
            :style="{ paddingLeft: `${12 + row.depth * 14}px` }" :aria-level="row.depth + 1"
            :aria-expanded="row.expandable ? row.expanded : undefined" @click="toggleRow(row)"
          >
            <span class="debug-expander"><ChevronDown v-if="row.expandable && row.expanded" :size="iconSize.dense" aria-hidden="true" /><ChevronRight v-else-if="row.expandable" :size="iconSize.dense" aria-hidden="true" /></span>
            <span class="debug-name">{{ row.name }}</span>
            <span class="debug-value">{{ row.value }}</span>
            <span class="debug-type">{{ row.type }}</span>
          </button>
          <button v-if="row.state === 'value' && row.depth > 0 && !row.group" class="icon-button debug-set" :disabled="!dapState.paused" :title="`设置 ${row.name} 的值`" :aria-label="`设置 ${row.name} 的值`" @click="beginEdit('var', row.key, row.value)"><PenLine :size="iconSize.dense" /></button>
          <button class="icon-button debug-set" :title="`${row.name} 的动作（复制/监视/控制台/按数组显示）`" :aria-label="`${row.name} 的动作`" @click.stop="openCopy(rowMenuTarget(row), $event)"><Copy :size="iconSize.dense" /></button>
        </template>
      </div>
      <div v-if="!varRows.length" class="debug-empty">{{ varsHint }}</div>
    </div>

    <!-- 模块 / 已加载源文件两个清单：拆到 DebugSourceLists.vue（面板贴着机检上限），
         事件（module / loadedSource）只推增量、按需重取整份清单。 -->
    <DebugSourceLists />

    <!-- 调试控制台 + 上游的「暂停输出」开关：拆到 DebugConsolePane.vue（面板贴着机检上限）。 -->
    <DebugConsolePane />

    <!-- 行/变量的动作弹层（上游树右键菜单那一组动作）与求值对话框（多行 + 历史）。 -->
    <DebugRowMenu v-if="copyMenu" :x="copyMenu.x" :y="copyMenu.y" :items="rowActions(copyMenu.target)" @pick="pickRowAction" @close="copyMenu = null" />
    <!-- 「检查」/「与剪贴板比较」两个值浮窗（上游 XInspectAction / XCompareWithClipboardAction）。 -->
    <DebugValueOverlays :overlay="valueOverlay" :options="dataView" :generation="frameGeneration" @close="valueOverlay = null" />
    <DebugEvaluateDialog
      v-if="evaluateOpen" :mode="dataView.evaluationMode ?? 'expression'" :busy="evaluating"
      :results="multilineResults" :history="exprHistory"
      @close="evaluateOpen = false" @run="runMultiline"
      @remove-history="removeHistory" @clear-history="clearHistory"
    />
  </div>
</template>

<style scoped>
.debug-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: auto; font-size: 12px; color: var(--text); }
.debug-config { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.debug-config-buttons { display: flex; gap: var(--space-1); }
.debug-exceptions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.debug-exceptions-title { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
.debug-exception { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text); }
.debug-watches { border-top: 1px solid var(--line); padding: var(--space-1) 0; }
.debug-watch-add { padding: 2px var(--space-3); }
.debug-field { display: flex; align-items: center; gap: var(--space-1); min-width: 0; font-size: 11px; color: var(--muted); }
.debug-field > span { flex-shrink: 0; width: 48px; }
.debug-input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px/1.4 var(--font-mono); }
.debug-input-narrow { flex: 0 0 60px; }
.debug-input:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.debug-toolbar { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.debug-btn { display: inline-flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--elevated); color: var(--text); font-size: 11px; }
.debug-btn:hover:not(:disabled) { background: var(--hover); color: var(--bright); }
.debug-btn:disabled { color: var(--muted); opacity: .5; }
.debug-btn.primary { border-color: var(--accent); color: var(--accent); }
.debug-error { margin: 0; padding: var(--space-1) var(--space-3); color: var(--error); font-size: 11px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.debug-reason { align-self: flex-start; margin: var(--space-2) var(--space-3) 0; padding: 2px var(--space-2); border-radius: var(--radius-pill); background: var(--selected); font-size: 11px; }
.debug-section-title { margin: var(--space-3) var(--space-3) var(--space-1); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: 10px; }
.chip-x { display: inline-flex; border: 0; background: transparent; color: var(--muted); padding: 1px; border-radius: var(--radius-xs); }
.chip-x:hover { color: var(--error); background: var(--hover); }
.debug-stack, .debug-vars { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
/* 变量/监视行：行本身是按钮，改值按钮排在行右侧（不能在按钮里套按钮） */
.debug-row-wrap, .debug-frame-wrap { display: flex; align-items: center; gap: 2px; }
.debug-frame-wrap > .debug-frame { flex: 1; min-width: 0; }
.debug-frame-wrap:hover .debug-set { opacity: 1; }
.debug-row-wrap > .debug-row { flex: 1; min-width: 0; }
.debug-row-wrap .debug-set, .debug-row .debug-set { opacity: 0; transition: opacity var(--dur-1) var(--ease); }
.debug-row-wrap:hover .debug-set, .debug-row:hover .debug-set { opacity: 1; }
/* 行内监视已挂在当前帧那一行：常亮并染成强调色（不吃 hover 才出现的规则）。 */
.debug-row .inline-on { opacity: 1; color: var(--accent); }
.debug-row-editing { gap: var(--space-1); padding-right: var(--space-1); }
.debug-edit-input { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12px; }
.debug-mini { padding: 1px 6px; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--text); font-size: 11px; }
.debug-frame { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); width: 100%; padding: 2px var(--space-3); border: 0; background: transparent; color: var(--text); text-align: left; font: 11px var(--font-mono); }
.debug-frame:hover { background: var(--hover); }
.debug-frame.active { background: var(--selected); }
.debug-frame-loc { color: var(--muted); flex-shrink: 0; }
.debug-row { display: flex; align-items: baseline; gap: var(--space-1); width: 100%; padding: 1px var(--space-3); border: 0; background: transparent; color: var(--text); text-align: left; font: 11px/1.6 var(--font-mono); cursor: default; }
.debug-row:hover { background: var(--hover); }
.debug-row:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.debug-row[aria-expanded] { cursor: pointer; }
.debug-row-muted { color: var(--muted); }
.debug-row-muted .debug-name { color: var(--muted); }
.debug-expander { display: inline-flex; align-items: center; justify-content: center; width: 14px; flex-shrink: 0; color: var(--muted); }
.debug-name { color: var(--syntax-keyword); flex-shrink: 0; }
.debug-value { color: var(--syntax-string); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-type { margin-left: auto; color: var(--muted); flex-shrink: 0; }
.debug-empty { padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; }
/* 警告色/警告底/面板底用真令牌（--warning/--warning-bg/--elevated）：以前的 `--warn` 一族不在
   tokens.css 里，退化成字面量、换主题不跟随。 */
.debug-exception { margin: var(--space-2) var(--space-3) 0; padding: var(--space-2); border: 1px solid var(--line); border-left: 3px solid var(--warning); border-radius: var(--radius-sm); background: var(--warning-bg); }
.debug-exception-head { display: flex; align-items: center; gap: var(--space-1); margin-bottom: var(--space-1); }
.debug-exception-title { font-weight: 600; font-size: 11px; }
.debug-exception-cause { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1); font-size: 11px; }
.debug-exception-trace { flex-basis: 100%; margin: 0 0 var(--space-1); color: var(--muted); font-size: 10px; white-space: pre-wrap; }
.debug-exit { align-self: flex-start; margin: var(--space-1) var(--space-3) 0; padding: 2px var(--space-2); border-radius: var(--radius-pill); background: var(--selected); font-size: 11px; }
.debug-exit.telemetry { color: var(--muted); }
.debug-exit.stderr { color: var(--error); background: var(--error-bg); }
.debug-progress { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: var(--space-1) var(--space-3); display: flex; flex-direction: column; gap: var(--space-1); }
.debug-progress-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); font-size: 11px; }
.debug-progress-title { color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-progress-pct { color: var(--muted); flex-shrink: 0; font: 11px var(--font-mono); }
.debug-progress-msg { color: var(--muted); font-size: 10px; overflow-wrap: anywhere; }
.debug-progress-track { position: relative; height: 4px; border-radius: var(--radius-pill); background: var(--rail); overflow: hidden; }
.debug-progress-fill { height: 100%; background: var(--accent); border-radius: var(--radius-pill); }
/* Indeterminate: the adapter has not said how far along it is, so the bar slides instead of showing a fabricated 0% or 100%. */
.debug-progress-track.indeterminate::after { content: ''; position: absolute; inset: 0 auto 0 0; width: 40%; border-radius: var(--radius-pill); background: var(--accent); animation: debug-progress-slide var(--dur-spin) var(--ease) infinite; }
@keyframes debug-progress-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
@media (prefers-reduced-motion: reduce) { .debug-progress-track.indeterminate::after { animation: none; width: 100%; opacity: .5; } }
.debug-collapse { display: flex; align-items: center; gap: 2px; padding: 0; border: 0; background: transparent; color: var(--muted); font: inherit; text-transform: inherit; letter-spacing: inherit; }
.debug-collapse:hover { color: var(--bright); }
.debug-collapse:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
.debug-collapse .debug-expander { width: 10px; }
.debug-section-title .chip-x:hover { color: var(--bright); }
/* 「按类型分组」的组行：名字是类型，值一列显示条数。 */
.debug-row-group .debug-name { color: var(--muted); font-style: italic; } .debug-view-toggle.active { color: var(--accent); }
.debug-watch-note { margin-left: var(--space-1); color: var(--muted); font-size: 10px; text-transform: none; letter-spacing: 0; }
.debug-hint { margin: 0; color: var(--muted); font-size: 11px; }
.debug-copy-note { margin: 0; padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; }
</style>
