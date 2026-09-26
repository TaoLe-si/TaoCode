<script setup lang="ts">
import { computed, reactive, ref, watch, nextTick } from 'vue'
import { Bug, ChevronDown, ChevronRight, Pause, Play, StepForward, Square, X, Crosshair } from 'lucide-vue-next'
import {
  dapBreakpoints, dapConsole, dapEvaluate, dapLoadedSources, dapModules, dapProgress, dapScopes, dapSetBreakpoints,
  dapDisconnect, dapLoadBreakpoints, dapSetCurrentLocation, dapStart, dapState, dapStep, dapStackTrace, dapTerminate, dapThreads, dapThreadSignal,
  dapSetExceptionBreakpoints, dapVariables,
  type DapBreakpoint, type DapExceptionFilter, type DapFrame, type DapScope, type DapThread, type DapVariable,
} from '../bridge'

const props = defineProps<{ activePath: string; ready: boolean; evaluateRequest?: { text: string; nonce: number } | null; program?: string; cwd?: string; adapterKind?: string }>()
const emit = defineEmits<{ jump: [target: { path?: string; line: number }] }>()

// These three used to be a second, independent copy of the run configuration: the
// Run tab and the Debug panel could disagree about what is being launched. They now
// come from the current run configuration (App passes them down) and are read-only
// here, with a pointer to where they are edited.
const kind = computed(() => props.adapterKind?.trim() || 'cppvsdbg')
const program = computed(() => props.program?.trim() ?? '')
const cwd = computed(() => props.cwd?.trim() || '.')
const attachId = ref('')
const frames = ref<DapFrame[]>([])
const scopes = ref<DapScope[]>([])
const values = reactive<Record<number, DapVariable[]>>({})   // variablesReference -> children
const open = reactive<Record<string, boolean>>({})
const busy = ref(false)
const error = ref('')
const newBreak = ref<number | null>(null)
const consoleBox = ref<HTMLElement>()
const threads = ref<DapThread[]>([])
// IDEA's breakpoints dialog exception rows: the adapter's filter list plus the
// checked subset, remembered across sessions through the native client.
const exceptionFilters = ref<DapExceptionFilter[]>([])
const exceptionChecked = ref<Set<string>>(new Set())
// IDEA's Watches view: expressions re-evaluated against the current top frame on
// every stop, kept for the whole session.
interface Watch { text: string; value: string }
const watches = ref<Watch[]>([])
const newWatch = ref('')

const activeBreaks = computed(() => (props.activePath ? dapBreakpoints.get(props.activePath) ?? [] : []))
const stopped = computed(() => dapState.running && dapState.paused)
const running = computed(() => dapState.running)
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
// The two collapsible lists below are closed by default: a large program loads
// hundreds of modules and they are noise unless the user goes looking for one.
const modulesOpen = ref(false)
const sourcesOpen = ref(false)
const exitHint = computed(() => dapState.exitCode === null ? ''
  : dapState.exitCode === 0 ? '被调试程序已自行结束，退出码 0。'
    : `被调试程序已自行结束，退出码 ${dapState.exitCode}（非 0 表示异常结束）。`)
// A percentage the adapter reports can be out of range; the bar is clamped instead
// of overflowing its track. `null` means indeterminate and gets no fill at all.
const progressWidth = (percentage: number | null) =>
  percentage === null ? undefined : `${Math.min(100, Math.max(0, percentage))}%`

function rememberFilters(capabilities: Record<string, unknown> | undefined) {
  const raw = capabilities?.exceptionBreakpointFilters
  if (!Array.isArray(raw)) return
  const parsed: DapExceptionFilter[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || typeof (item as DapExceptionFilter).filter !== 'string') continue
    parsed.push(item as DapExceptionFilter)
  }
  exceptionFilters.value = parsed
  const wanted = new Set(exceptionChecked.value)
  for (const filter of parsed) if (filter.default && !exceptionChecked.value.size) wanted.add(filter.filter)
  exceptionChecked.value = wanted
}

async function start() {
  error.value = ''
  if (!program.value.trim()) { error.value = '请填写要调试的程序路径。'; return }
  try {
    const result = await dapStart({ command: '', args: [], kind: kind.value.trim() || 'cppvsdbg', program: program.value.trim(), cwd: cwd.value.trim() || '.', stopOnEntry: false })
    rememberFilters(result.capabilities)
    if (exceptionChecked.value.size) await dapSetExceptionBreakpoints([...exceptionChecked.value]).catch(() => undefined)
    await refreshStack()
  } catch (caught) { error.value = message(caught) }
}
// IDEA's Attach to Process: no program of our own, the adapter joins a running one
// via its selector (processId for cppvsdbg/lldb-dap, pipeName for others).
async function attach() {
  error.value = ''
  const selector = attachId.value.trim()
  if (!selector) { error.value = '请填写要附加的进程 PID 或管道名。'; return }
  const numeric = /^\d+$/.test(selector)
  try {
    const configuration = numeric ? { processId: Number(selector) } : { pipeName: selector }
    const result = await dapStart({ command: '', args: [], kind: kind.value.trim() || 'cppvsdbg', program: '', cwd: cwd.value.trim() || '.', stopOnEntry: false, configuration: { request: 'attach', ...configuration } })
    rememberFilters(result.capabilities)
    if (exceptionChecked.value.size) await dapSetExceptionBreakpoints([...exceptionChecked.value]).catch(() => undefined)
    await refreshStack()
  } catch (caught) { error.value = message(caught) }
}
async function toggleExceptionFilter(filter: string) {
  const next = new Set(exceptionChecked.value)
  if (next.has(filter)) next.delete(filter); else next.add(filter)
  exceptionChecked.value = next
  try { await dapSetExceptionBreakpoints([...next]) }
  catch (caught) { error.value = message(caught) }
}
async function step(action: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut') {
  error.value = ''; busy.value = true
  try { await dapStep(action); if (action !== 'pause') await refreshStack() }
  catch (caught) { error.value = message(caught) }
  finally { busy.value = false }
}
async function stop() { busy.value = true; try { await dapTerminate(); frames.value = []; scopes.value = []; threads.value = [] } finally { busy.value = false } }
// IDEA's Disconnect (as opposed to Stop): the adapter detaches first, which matters
// for an attached process that must stay alive after the debugger leaves.
async function disconnect() {
  busy.value = true
  try {
    await dapDisconnect()
    frames.value = []; scopes.value = []; threads.value = []
  } catch (caught) { error.value = message(caught) }
  finally { busy.value = false }
}
// The gutter mirrors the adapter's own breakpoint list whenever a session becomes
// live, so a session started elsewhere still shows its breakpoints here.
watch(() => dapState.running, running => { if (running) void dapLoadBreakpoints().catch(() => undefined) }, { immediate: true })
// The thread list is refetched on the adapter's own `thread` events (a thread can
// start or exit between two stops, which is why this is not only driven by stops).
async function refreshThreads() {
  if (!dapState.running) { threads.value = []; return }
  try { threads.value = (await dapThreads()).threads }
  catch (caught) { error.value = message(caught); threads.value = [] }
}
async function refreshStack() {
  if (!dapState.running) { frames.value = []; dapSetCurrentLocation(null); return }
  try {
    void refreshThreads()
    frames.value = (await dapStackTrace()).frames
    const top = frames.value[0]
    if (top) dapSetCurrentLocation({ path: top.path ?? props.activePath, line: top.line }); else dapSetCurrentLocation(null)
    await refreshScopes(frames.value[0]?.id)
    await refreshWatches()
  } catch (caught) { error.value = message(caught); frames.value = []; dapSetCurrentLocation(null) }
}
// Switching threads is the IDEA Threads dropdown's primary action; we just ask the
// adapter for the chosen thread's frames and reuse the same stack UI.
async function selectThread(id: number) {
  error.value = ''
  if (!dapState.running) return
  try {
    frames.value = (await dapStackTrace(id)).frames
    const top = frames.value[0]
    if (top) dapSetCurrentLocation({ path: top.path ?? props.activePath, line: top.line }); else dapSetCurrentLocation(null)
    await refreshScopes(frames.value[0]?.id)
  } catch (caught) { error.value = message(caught) }
}
async function refreshScopes(frameId?: number) {
  scopes.value = []
  for (const key of Object.keys(values)) delete values[Number(key)]
  if (frameId === undefined) return
  try {
    scopes.value = (await dapScopes(frameId)).scopes
    for (const scope of scopes.value) if (!scope.expensive) await loadScope(scope.reference)
  } catch (caught) { error.value = message(caught) }
}
async function loadScope(reference: number) {
  try { values[reference] = (await dapVariables(reference)).variables }
  catch (caught) { values[reference] = []; error.value = message(caught) }
}
// Variables are a tree of arbitrary depth: a scope holds variables, and any variable
// with a `variablesReference` opens another level. Rows are flattened here so the
// view can walk as deep as the adapter answers.
interface VarRow {
  key: string
  name: string
  value: string
  type: string
  depth: number
  expandable: boolean
  expanded: boolean
  reference: number
  state: 'value' | 'empty' | 'unloaded'
}
const MAX_DEPTH = 12
function walk(reference: number, depth: number, prefix: string, rows: VarRow[], seen: number[]) {
  const children = values[reference]
  if (!children) {
    rows.push({ key: `${prefix}?`, name: '读取中…', value: '', type: '', depth, expandable: false, expanded: false, reference, state: 'unloaded' })
    return
  }
  if (!children.length) {
    rows.push({ key: `${prefix}-`, name: '空', value: '', type: '', depth, expandable: false, expanded: false, reference, state: 'empty' })
    return
  }
  // A self-referential object would otherwise recurse forever on expansion.
  if (seen.includes(reference) || depth > MAX_DEPTH) {
    rows.push({ key: `${prefix}=`, name: depth > MAX_DEPTH ? '层级过深，已停止展开' : '（循环引用）', value: '', type: '', depth, expandable: false, expanded: false, reference, state: 'empty' })
    return
  }
  children.forEach((child, index) => {
    const key = `${prefix}${index}`
    const expandable = child.reference > 0
    const expanded = expandable && open[key] === true
    rows.push({
      key, name: child.named === false ? `[${index}]` : child.name, value: child.value, type: child.type ?? '',
      depth, expandable, expanded, reference: child.reference, state: 'value',
    })
    if (expanded) walk(child.reference, depth + 1, `${key}-`, rows, [...seen, reference])
  })
}
const varRows = computed<VarRow[]>(() => {
  const rows: VarRow[] = []
  scopes.value.forEach((scope, index) => {
    const key = `s${index}`
    const expanded = open[key] === true
    rows.push({ key, name: scope.name, value: '', type: scope.expensive ? '按需' : '', depth: 0, expandable: true, expanded, reference: scope.reference, state: 'value' })
    if (expanded) walk(scope.reference, 1, `${key}-`, rows, [scope.reference])
  })
  return rows
})
// A row is toggled by its path, not its reference: the same reference can appear at
// several places and each of them must remember its own state.
function toggleRow(row: VarRow) {
  if (!row.expandable) return
  open[row.key] = !open[row.key]
  if (open[row.key] && values[row.reference] === undefined) void loadScope(row.reference)
}
async function syncBreak(points: DapBreakpoint[]) {
  if (!props.activePath) return
  error.value = ''
  const sorted = [...points].sort((a, b) => a.line - b.line)
  try {
    const result = await dapSetBreakpoints(props.activePath, sorted)
    if (sorted.length && !result.deferred && result.verifiedLines.length !== sorted.length) error.value = '部分断点未被调试器验证。'
    // The adapter explains what it could not bind (an invalid condition, a moved
    // line); surface the first note instead of swallowing it.
    const note = result.messages?.[0]
    if (note) error.value = `第 ${note.line} 行断点：${note.message}`
  }
  catch (caught) { error.value = message(caught) }
}
function addBreakpoint() {
  const line = newBreak.value
  if (!props.activePath || !line || line < 1 || activeBreaks.value.some(point => point.line === line)) return
  void syncBreak([...activeBreaks.value, { line }])
  newBreak.value = null
}
// IDEA edits a condition from the gutter popup; the panel is the equivalent here.
function setCondition(line: number, condition: string) {
  const trimmed = condition.trim()
  void syncBreak(activeBreaks.value.map(point => point.line === line ? { ...point, condition: trimmed || undefined } : point))
}
function message(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }

watch(() => dapState.paused, paused => { if (paused) void refreshStack() }, { immediate: true })
watch(() => dapState.running, live => { if (!live) { frames.value = []; scopes.value = []; threads.value = [] } })
// A `thread` event means the adapter's list changed; the panel only ever shows the
// adapter's answer, so it refetches instead of guessing at the delta.
watch(() => dapThreadSignal.version, () => void refreshThreads())
// IDEA's Watches: every stop re-evaluates the list against the new top frame.
async function refreshWatches() {
  if (!stopped.value) return
  const frame = frames.value[0]?.id ?? 0
  for (const watch of watches.value) {
    try {
      const result = await dapEvaluate(watch.text, 'watch', frame)
      watch.value = `${result.result}${result.type ? ` : ${result.type}` : ''}`
    } catch (caught) { watch.value = caught instanceof Error ? caught.message : String(caught) }
  }
}
function addWatch() {
  const text = newWatch.value.trim()
  if (!text || watches.value.some(watch => watch.text === text)) return
  watches.value.push({ text, value: '' })
  newWatch.value = ''
  void refreshWatches()
}
function removeWatch(text: string) { watches.value = watches.value.filter(watch => watch.text !== text) }
// IDEA's Evaluate Expression (Alt+F8): the editor hands over the selection, the panel
// runs it against the frame the debugger is stopped in.
const expr = ref('')
const exprResult = ref('')
// An adapter answers `evaluate` with a `variablesReference` when the value is a
// structure: keep it (and its children) so the result can be browsed like a watch.
const exprReference = ref(0)
const exprOpen = ref(true)
const exprRows = computed<VarRow[]>(() => {
  if (!exprReference.value) return []
  const rows: VarRow[] = []
  walk(exprReference.value, 1, 'eval-', rows, [exprReference.value])
  return rows
})
async function runEvaluate() {
  const text = expr.value.trim()
  if (!text) { exprResult.value = ''; exprReference.value = 0; return }
  if (!stopped.value) { exprResult.value = '需要先停在断点上才能求值。'; exprReference.value = 0; return }
  try {
    const result = await dapEvaluate(text, 'watch', frames.value[0]?.id ?? 0)
    exprResult.value = `${text} = ${result.result}${result.type ? ` : ${result.type}` : ''}`
    exprReference.value = result.variablesReference ?? 0
    exprOpen.value = true
    // Dereference immediately so the tree has something to expand into.
    if (exprReference.value > 0 && values[exprReference.value] === undefined) await loadScope(exprReference.value)
  } catch (caught) { exprResult.value = caught instanceof Error ? caught.message : String(caught); exprReference.value = 0 }
}
function toggleExprRow(row: VarRow) { toggleRow(row) }
watch(() => props.evaluateRequest?.nonce, () => {
  const request = props.evaluateRequest
  if (!request) return
  expr.value = request.text
  void runEvaluate()
})
watch(() => dapConsole.length, async () => { await nextTick(); if (consoleBox.value) consoleBox.value.scrollTop = consoleBox.value.scrollHeight })
</script>

<template>
  <div class="debug-panel">
    <div class="panel-heading"><span><Bug :size="14" />调试</span></div>

    <div class="debug-config">
      <p class="debug-field"><span>kind</span><strong>{{ kind }}</strong></p>
      <p class="debug-field"><span>program</span><strong>{{ program || '（未填写）' }}</strong></p>
      <p class="debug-field"><span>cwd</span><strong>{{ cwd }}</strong></p>
      <p class="debug-hint">这些值来自「运行」面板的当前配置，改配置即生效（避免两处各存一份）。</p>
      <div class="debug-config-buttons">
        <button class="debug-btn primary" :disabled="!ready || busy || running" title="启动调试会话（command 取自 TaoCode.dap.json 对应 kind）" @click="start"><Bug :size="13" />启动</button>
        <!-- IDEA's Attach to Process: the same handshake with the `attach` request. -->
        <button class="debug-btn" :disabled="!ready || busy || running" title="附加到正在运行的进程（进程 PID 或管道名）" @click="attach"><Crosshair :size="13" />附加</button>
      </div>
      <label class="debug-field"><span>附加到</span><input v-model="attachId" class="debug-input" aria-label="要附加的进程 PID 或管道名" placeholder="PID（如 4242）或 pipeName" spellcheck="false" @keydown.enter.prevent="attach" /></label>
    </div>

    <div v-if="exceptionFilters.length" class="debug-exceptions">
      <span class="debug-exceptions-title">异常断点</span>
      <label v-for="filter in exceptionFilters" :key="filter.filter" class="debug-exception" :title="filter.description">
        <input type="checkbox" :checked="exceptionChecked.has(filter.filter)" @change="toggleExceptionFilter(filter.filter)" />
        {{ filter.label ?? filter.filter }}
      </label>
    </div>

    <div class="debug-toolbar">
      <button class="debug-btn" :disabled="!stopped || busy" title="继续 (F9)" @click="step('continue')"><Play :size="13" />继续</button>
      <button class="debug-btn" :disabled="!running || stopped || busy" title="暂停" @click="step('pause')"><Pause :size="13" /></button>
      <button class="debug-btn" :disabled="!stopped || busy" title="单步跳过 (F8)" @click="step('next')"><StepForward :size="13" /></button>
      <button class="debug-btn" :disabled="!stopped || busy" title="单步进入 (F7)" @click="step('stepIn')"><ChevronDown :size="13" /></button>
      <button class="debug-btn" :disabled="!stopped || busy" title="单步跳出 (Shift+F8)" @click="step('stepOut')"><ChevronRight :size="13" /></button>
      <button class="debug-btn" :disabled="!running || busy" title="停止" @click="stop"><Square :size="13" /></button>
      <button class="debug-btn" :disabled="!running || busy" title="断开调试器（保留被调试进程）" @click="disconnect"><X :size="13" /></button>
    </div>

    <p v-if="error" class="debug-error">{{ error }}</p>
    <div class="debug-evaluate">
      <input v-model="expr" class="debug-input" aria-label="调试表达式" placeholder="表达式，回车求值（编辑器里 Alt+F8 取选区）" spellcheck="false" @keydown.enter.prevent="runEvaluate" />
      <button class="debug-btn" :disabled="!stopped || busy" title="求值 (Alt+F8)" @click="runEvaluate">求值</button>
    </div>
    <p v-if="exprResult" class="debug-eval-result">{{ exprResult }}</p>
    <div v-if="exprOpen && exprRows.length" class="debug-vars" role="tree" aria-label="求值结果的成员">
      <button
        v-for="row in exprRows" :key="row.key" class="debug-row" role="treeitem" :class="row.state === 'value' ? undefined : 'debug-row-muted'"
        :style="{ paddingLeft: `${12 + row.depth * 14}px` }" :aria-level="row.depth + 1"
        :aria-expanded="row.expandable ? row.expanded : undefined" @click="toggleExprRow(row)"
      >
        <span class="debug-expander">{{ row.expandable ? (row.expanded ? '▾' : '▸') : '' }}</span>
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

    <div class="debug-section-title">断点 · {{ activePath ? activePath.split('/').pop() : '（无当前文件）' }}</div>
    <div class="debug-breaks">
      <label class="debug-field"><span>行</span><input v-model.number="newBreak" type="number" min="1" class="debug-input debug-input-narrow" aria-label="断点行号（1 起）" @keydown.enter.prevent="addBreakpoint" /></label>
      <button class="debug-btn" :disabled="!activePath || !newBreak" @click="addBreakpoint">添加</button>
      <span v-if="!activeBreaks.length" class="debug-empty-inline">无</span>
      <span v-for="point in activeBreaks" :key="point.line" class="debug-break-chip" :class="{ unverified: point.verified === false }"
            :title="point.verified === false ? `第 ${point.line} 行：调试器未验证（可能被移到别的行）` : undefined">
        {{ point.line }}<span v-if="point.condition" class="debug-break-cond" :title="`条件：${point.condition}`">?</span>
        <button class="chip-x" :aria-label="`移除断点 ${point.line}`" @click="syncBreak(activeBreaks.filter(other => other.line !== point.line))"><X :size="10" /></button>
        <input class="debug-break-condition" type="text" :value="point.condition ?? ''" :aria-label="`第 ${point.line} 行断点条件`" placeholder="条件" spellcheck="false" @keydown.enter.prevent="setCondition(point.line, ($event.target as HTMLInputElement).value)" @change="setCondition(point.line, ($event.target as HTMLInputElement).value)" />
      </span>
    </div>

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
      <button v-for="(frame, index) in frames" :key="frame.id" class="debug-frame" :class="{ active: index === 0 }"
              @click="refreshScopes(frame.id); emit('jump', { path: frame.path, line: frame.line })">
        <span class="debug-frame-name">{{ frame.name }}</span>
        <span class="debug-frame-loc">{{ frame.path ? frame.path.split('/').pop() + ':' : '' }}{{ frame.line }}</span>
      </button>
      <div v-if="!frames.length" class="debug-empty">{{ frameHint }}</div>
    </div>

    <div class="debug-section-title">监视（Watches）</div>
    <div class="debug-watches">
      <div v-for="watch in watches" :key="watch.text" class="debug-row">
        <button class="chip-x" :aria-label="`移除监视 ${watch.text}`" @click="removeWatch(watch.text)"><X :size="10" /></button>
        <span class="debug-name">{{ watch.text }}</span>
        <span class="debug-value">{{ watch.value || '—' }}</span>
      </div>
      <div class="debug-watch-add">
        <input v-model="newWatch" class="debug-input" aria-label="新监视表达式" placeholder="监视表达式，回车添加" spellcheck="false" @keydown.enter.prevent="addWatch" />
      </div>
    </div>

    <div class="debug-section-title">变量</div>
    <div class="debug-vars" role="tree" aria-label="变量">
      <button
        v-for="row in varRows" :key="row.key" class="debug-row" role="treeitem" :class="row.state === 'value' ? undefined : 'debug-row-muted'"
        :style="{ paddingLeft: `${12 + row.depth * 14}px` }" :aria-level="row.depth + 1"
        :aria-expanded="row.expandable ? row.expanded : undefined" @click="toggleRow(row)"
      >
        <span class="debug-expander">{{ row.expandable ? (row.expanded ? '▾' : '▸') : '' }}</span>
        <span class="debug-name">{{ row.name }}</span>
        <span class="debug-value">{{ row.value }}</span>
        <span class="debug-type">{{ row.type }}</span>
      </button>
      <div v-if="!varRows.length" class="debug-empty">{{ varsHint }}</div>
    </div>

    <template v-if="dapModules.length">
      <div class="debug-section-title">
        <button class="debug-collapse" :aria-expanded="modulesOpen" @click="modulesOpen = !modulesOpen">
          <span class="debug-expander">{{ modulesOpen ? '▾' : '▸' }}</span>模块 · {{ dapModules.length }}
        </button>
      </div>
      <div v-if="modulesOpen" class="debug-list" role="list" aria-label="已加载模块" tabindex="0">
        <div v-for="item in dapModules" :key="item.id" class="debug-list-row" role="listitem">
          <span class="debug-name">{{ item.name || `#${item.id}` }}</span>
          <span v-if="item.type" class="debug-type">{{ item.type }}</span>
          <span class="debug-list-path">{{ item.path ?? (item.sourceReference ? `sourceReference ${item.sourceReference}` : '') }}</span>
        </div>
      </div>
    </template>

    <template v-if="dapLoadedSources.length">
      <div class="debug-section-title">
        <button class="debug-collapse" :aria-expanded="sourcesOpen" @click="sourcesOpen = !sourcesOpen">
          <span class="debug-expander">{{ sourcesOpen ? '▾' : '▸' }}</span>已加载源文件 · {{ dapLoadedSources.length }}
        </button>
      </div>
      <div v-if="sourcesOpen" class="debug-list" role="list" aria-label="已加载源文件" tabindex="0">
        <div v-for="item in dapLoadedSources" :key="item.key" class="debug-list-row" role="listitem">
          <span class="debug-name">{{ item.name || '（无名）' }}</span>
          <span class="debug-list-path">{{ item.path ?? (item.sourceReference ? `sourceReference ${item.sourceReference}` : '') }}</span>
        </div>
      </div>
    </template>

    <div class="debug-section-title">调试控制台</div>
    <div ref="consoleBox" class="debug-console" aria-label="调试器输出">
      <span v-for="(entry, index) in dapConsole" :key="index" class="debug-console-line" :class="entry.category">{{ entry.text }}</span>
      <span v-if="!dapConsole.length" class="debug-console-line telemetry">调试器输出与程序 stdout/stderr 会显示在这里。</span>
    </div>
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
.debug-breaks { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); padding: 0 var(--space-3); }
.debug-break-chip { display: inline-flex; align-items: center; gap: 2px; padding: 1px var(--space-1) 1px var(--space-2); border-radius: var(--radius-pill); background: var(--elevated); border: 1px solid var(--line-strong); font: 11px var(--font-mono); }
.chip-x { display: inline-flex; border: 0; background: transparent; color: var(--muted); padding: 1px; border-radius: var(--radius-xs); }
.chip-x:hover { color: var(--error); background: var(--hover); }
.debug-empty-inline { color: var(--muted); font-size: 11px; }
.debug-stack, .debug-vars { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
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
.debug-expander { width: 10px; flex-shrink: 0; color: var(--muted); }
.debug-name { color: var(--syntax-keyword); flex-shrink: 0; }
.debug-value { color: var(--syntax-string); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-type { margin-left: auto; color: var(--muted); flex-shrink: 0; }
.debug-console { border-bottom: 1px solid var(--line); padding: var(--space-1) var(--space-3); min-height: 72px; max-height: 220px; overflow: auto; white-space: pre-wrap; font: 11px/1.6 var(--font-mono); }
.debug-console-line { display: block; overflow-wrap: anywhere; }
.debug-console-line.stderr { color: var(--error); }
.debug-console-line.telemetry { color: var(--muted); }
.debug-empty { padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; }
/* `exited` is the debuggee's status, so it sits beside the session state rather
   than replacing it: a non-zero code and a live session can both be true. */
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
/* Indeterminate: the adapter has not said how far along it is, so the bar slides
   instead of showing a fabricated 0% or 100%. */
.debug-progress-track.indeterminate::after { content: ''; position: absolute; inset: 0 auto 0 0; width: 40%; border-radius: var(--radius-pill); background: var(--accent); animation: debug-progress-slide 1.1s ease-in-out infinite; }
@keyframes debug-progress-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
@media (prefers-reduced-motion: reduce) { .debug-progress-track.indeterminate::after { animation: none; width: 100%; opacity: .5; } }
.debug-collapse { display: flex; align-items: center; gap: 2px; padding: 0; border: 0; background: transparent; color: var(--muted); font: inherit; text-transform: inherit; letter-spacing: inherit; }
.debug-collapse:hover { color: var(--bright); }
.debug-collapse:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
.debug-collapse .debug-expander { width: 10px; }
/* A program loads hundreds of these: the list scrolls inside its own box so the
   rest of the panel stays reachable. */
.debug-list { max-height: 160px; overflow: auto; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.debug-list:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.debug-list-row { display: flex; align-items: baseline; gap: var(--space-2); padding: 1px var(--space-3); font: 11px/1.6 var(--font-mono); }
.debug-list-row:hover { background: var(--hover); }
.debug-list-path { margin-left: auto; color: var(--muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-break-chip.unverified { border-style: dashed; color: var(--muted); }
</style>
