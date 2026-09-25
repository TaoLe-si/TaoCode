<script setup lang="ts">
import { computed, reactive, ref, watch, nextTick } from 'vue'
import { Bug, ChevronDown, ChevronRight, Pause, Play, StepForward, Square, X, Crosshair } from 'lucide-vue-next'
import {
  dapBreakpoints, dapConsole, dapEvaluate, dapScopes, dapSetBreakpoints, dapSetCurrentLocation, dapStart, dapState, dapStep,
  dapStackTrace, dapTerminate, dapThreads, dapSetExceptionBreakpoints, dapVariables,
  type DapBreakpoint, type DapExceptionFilter, type DapFrame, type DapScope, type DapThread, type DapVariable,
} from '../bridge'

const props = defineProps<{ activePath: string; ready: boolean; evaluateRequest?: { text: string; nonce: number } | null }>()
const emit = defineEmits<{ jump: [target: { path?: string; line: number }] }>()

const kind = ref('lldb-dap')
const program = ref('')
const cwd = ref('.')
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
async function refreshStack() {
  if (!dapState.running) { frames.value = []; dapSetCurrentLocation(null); return }
  try {
    void dapThreads().then(result => { threads.value = result.threads }).catch(caught => { error.value = message(caught); threads.value = [] })
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
function toggleScope(index: number, scope: DapScope) {
  const key = `s${index}`
  open[key] = !open[key]
  if (open[key] && !values[scope.reference]) void loadScope(scope.reference)
}
function toggleVar(reference: number) { open[`v${reference}`] = !open[`v${reference}`]; if (open[`v${reference}`]) void loadScope(reference) }
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
async function runEvaluate() {
  const text = expr.value.trim()
  if (!text) { exprResult.value = ''; return }
  if (!stopped.value) { exprResult.value = '需要先停在断点上才能求值。'; return }
  try {
    const result = await dapEvaluate(text, 'watch', frames.value[0]?.id ?? 0)
    exprResult.value = `${text} = ${result.result}${result.type ? ` : ${result.type}` : ''}`
  } catch (caught) { exprResult.value = caught instanceof Error ? caught.message : String(caught) }
}
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
      <label class="debug-field"><span>kind</span><input v-model="kind" class="debug-input" aria-label="调试适配器 kind" placeholder="cppvsdbg" spellcheck="false" /></label>
      <label class="debug-field"><span>program</span><input v-model="program" class="debug-input" aria-label="被调试程序" placeholder="build/Demo.exe 或绝对路径" spellcheck="false" /></label>
      <label class="debug-field"><span>cwd</span><input v-model="cwd" class="debug-input" aria-label="工作目录" placeholder="." spellcheck="false" /></label>
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
    </div>

    <p v-if="error" class="debug-error">{{ error }}</p>
    <div class="debug-evaluate">
      <input v-model="expr" class="debug-input" aria-label="调试表达式" placeholder="表达式，回车求值（编辑器里 Alt+F8 取选区）" spellcheck="false" @keydown.enter.prevent="runEvaluate" />
      <button class="debug-btn" :disabled="!stopped || busy" title="求值 (Alt+F8)" @click="runEvaluate">求值</button>
    </div>
    <p v-if="exprResult" class="debug-eval-result">{{ exprResult }}</p>
    <span v-if="dapState.reason" class="debug-reason">已停止：{{ dapState.reason }} · 线程 {{ dapState.threadId }}</span>
    <span v-else-if="running" class="debug-reason">运行中</span>

    <div class="debug-section-title">断点 · {{ activePath ? activePath.split('/').pop() : '（无当前文件）' }}</div>
    <div class="debug-breaks">
      <label class="debug-field"><span>行</span><input v-model.number="newBreak" type="number" min="1" class="debug-input debug-input-narrow" aria-label="断点行号（1 起）" @keydown.enter.prevent="addBreakpoint" /></label>
      <button class="debug-btn" :disabled="!activePath || !newBreak" @click="addBreakpoint">添加</button>
      <span v-if="!activeBreaks.length" class="debug-empty-inline">无</span>
      <span v-for="point in activeBreaks" :key="point.line" class="debug-break-chip">
        {{ point.line }}<span v-if="point.condition" class="debug-break-cond" :title="`条件：${point.condition}`">?</span>
        <button class="chip-x" :aria-label="`移除断点 ${point.line}`" @click="syncBreak(activeBreaks.filter(other => other.line !== point.line))"><X :size="10" /></button>
        <input class="debug-break-condition" type="text" :value="point.condition ?? ''" :aria-label="`第 ${point.line} 行断点条件`" placeholder="条件" spellcheck="false" @keydown.enter.prevent="setCondition(point.line, ($event.target as HTMLInputElement).value)" @change="setCondition(point.line, ($event.target as HTMLInputElement).value)" />
      </span>
    </div>

    <div class="debug-section-title">线程 <span v-if="threads.length">· {{ threads.length }}</span></div>
    <div class="debug-stack">
      <button v-for="thread in threads" :key="thread.id" class="debug-frame" :class="{ active: thread.id === dapState.threadId }" :title="`切换到线程 ${thread.name}`" @click="selectThread(thread.id)">
        <span class="debug-frame-name">#{{ thread.id }} {{ thread.name }}</span>
        <span v-if="thread.id === dapState.threadId" class="debug-frame-loc">当前</span>
      </button>
      <div v-if="!threads.length" class="debug-empty">停止时在此显示线程列表。</div>
    </div>

    <div class="debug-section-title">调用堆栈</div>
    <div class="debug-stack">
      <button v-for="(frame, index) in frames" :key="frame.id" class="debug-frame" :class="{ active: index === 0 }"
              @click="refreshScopes(frame.id); emit('jump', { path: frame.path, line: frame.line })">
        <span class="debug-frame-name">{{ frame.name }}</span>
        <span class="debug-frame-loc">{{ frame.path ? frame.path.split('/').pop() + ':' : '' }}{{ frame.line }}</span>
      </button>
      <div v-if="!frames.length" class="debug-empty">停止时在此显示调用堆栈。</div>
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
    <div class="debug-vars">
      <template v-for="(scope, index) in scopes" :key="`scope-${scope.name}`">
        <div class="debug-row" @click="toggleScope(index, scope)">
          <span class="debug-expander">{{ open[`s${index}`] ? '▾' : '▸' }}</span>
          <span class="debug-name">{{ scope.name }}</span>
          <span class="debug-type">{{ scope.expensive ? '按需' : '' }}</span>
        </div>
        <template v-if="open[`s${index}`]">
          <template v-for="item in values[scope.reference] ?? []" :key="`${scope.name}-${item.name}`">
            <div class="debug-row debug-depth-1" @click="item.reference ? toggleVar(item.reference) : undefined">
              <span class="debug-expander">{{ item.reference ? (open[`v${item.reference}`] ? '▾' : '▸') : '' }}</span>
              <span class="debug-name">{{ item.name }}</span>
              <span class="debug-value">{{ item.value }}</span>
              <span class="debug-type">{{ item.type }}</span>
            </div>
            <div v-if="item.reference && open[`v${item.reference}`]" v-for="child in values[item.reference] ?? []" :key="`${item.name}-${child.name}`" class="debug-row debug-depth-2">
              <span class="debug-expander" />
              <span class="debug-name">{{ child.name }}</span>
              <span class="debug-value">{{ child.value }}</span>
              <span class="debug-type">{{ child.type }}</span>
            </div>
          </template>
          <div v-if="!(values[scope.reference] ?? []).length" class="debug-row debug-depth-1"><span class="debug-type">空</span></div>
        </template>
      </template>
      <div v-if="!scopes.length" class="debug-empty">停止时在此显示作用域与变量。</div>
    </div>

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
.debug-row { display: flex; align-items: baseline; gap: var(--space-1); padding: 1px var(--space-3); font: 11px/1.6 var(--font-mono); cursor: default; }
.debug-row:hover { background: var(--hover); }
.debug-depth-1 { padding-left: 24px; }
.debug-depth-2 { padding-left: 40px; }
.debug-expander { width: 10px; flex-shrink: 0; color: var(--muted); }
.debug-name { color: var(--syntax-keyword); flex-shrink: 0; }
.debug-value { color: var(--syntax-string); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-type { margin-left: auto; color: var(--muted); flex-shrink: 0; }
.debug-console { border-bottom: 1px solid var(--line); padding: var(--space-1) var(--space-3); min-height: 72px; max-height: 220px; overflow: auto; white-space: pre-wrap; font: 11px/1.6 var(--font-mono); }
.debug-console-line { display: block; overflow-wrap: anywhere; }
.debug-console-line.stderr { color: var(--error); }
.debug-console-line.telemetry { color: var(--muted); }
.debug-empty { padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; }
</style>
