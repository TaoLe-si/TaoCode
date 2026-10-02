<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FlaskConical, Play, RefreshCw, RotateCcw } from 'lucide-vue-next'
import { CircleCheck, CircleX, Minus } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { isDesktop, request, runState, type Entry } from '../bridge'
import { discover, FailedSet, parseResultLine, rerunCommand, type TestResult } from '../testRunner'

// IDEA's Test Runner tool window: a tree of discovered tests, Run / Rerun Failed
// actions, and results that jump to the failing line. Discovery reads the editor
// buffer for the current file and the workspace tree for the project scope.
const props = defineProps<{ activePath: string; fileText: string; root: string; ready: boolean }>()
const emit = defineEmits<{ jump: [target: { path: string; line: number }]; runCommand: [command: string] }>()

interface TestRow { id: string; name: string; path: string; line: number; framework: string }
const tests = ref<TestRow[]>([])
const selected = ref<Set<string>>(new Set())
const results = ref<Map<string, TestResult>>(new Map())
const failed = new FailedSet()
// Busy state is the shared run state — the panel's commands go through the app's
// run pipeline, so a build started anywhere also disables these buttons.
const running = computed(() => runState.running)
const error = ref('')
const lastBase = ref('')

const frameworkOf = (path: string) => /CMakeLists\.txt$/i.test(path) ? 'ctest' : /\.(java|kt)$/i.test(path) ? 'junit' : 'npm'

function addFrom(path: string, text: string) {
  const framework = frameworkOf(path)
  for (const found of discover(path, text))
    tests.value.push({ id: found.id, name: found.name, path, line: found.line, framework })
}
function refreshFile() {
  tests.value = tests.value.filter(row => row.path !== props.activePath)
  if (props.activePath) addFrom(props.activePath, props.fileText)
}
async function refreshProject() {
  error.value = ''
  if (!isDesktop || !props.root) return
  try {
    const entries = await request<Entry[]>('workspace.list', { path: '' })
    const candidates = collectCandidates(entries)
    for (const path of candidates) {
      try {
        const doc = await request<{ content: string }>('file.read', { path })
        addFrom(path, doc.content)
      } catch { /* unreadable file: skip */ }
    }
  } catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
  refreshFile()
}
// A bounded walk: root plus one level down, matching where tests actually live
// (tests/, test/, src/) without scanning the whole tree per keystroke.
function collectCandidates(entries: readonly Entry[], depth = 0): string[] {
  const out: string[] = []
  for (const entry of entries) {
    if (entry.kind === 'file' && /CMakeLists\.txt$|\.(test|spec)\.[cm]?[jt]s$|Test\.(java|kt)$/.test(entry.name)) out.push(entry.path)
    else if (entry.kind === 'directory' && depth < 1 && /^(tests?|src|test)$/i.test(entry.name)) {
      // Deeper listing happens through the per-file read below; the tree itself
      // is the boundary so a huge repo cannot stall the panel.
      void entry
    }
  }
  return out.slice(0, 200)
}
function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  selected.value = next
}
const outcomeOf = (id: string) => results.value.get(id)?.outcome
async function runBase(): Promise<string> {
  const framework = tests.value.find(row => selected.value.has(row.id))?.framework ?? frameworkOf(props.activePath)
  if (framework === 'ctest') return 'ctest --output-on-failure'
  if (framework === 'junit') return 'mvn test'
  return 'npm test'
}
async function runAll() {
  await launch(await runBase())
}
async function runSelected() {
  if (!selected.value.size) { await runAll(); return }
  const rows = tests.value.filter(row => selected.value.has(row.id))
  const framework = rows[0]?.framework ?? 'npm'
  await launch(rerunCommand(framework as 'npm' | 'ctest' | 'junit' | 'pytest', await runBase(), rows.map(row => row.name)))
}
async function rerunFailed() {
  if (!failed.size) { error.value = '没有失败的测试可重跑。'; return }
  await launch(rerunCommand((tests.value[0]?.framework ?? 'npm') as 'npm' | 'ctest' | 'junit' | 'pytest', lastBase.value || await runBase(), failed.names()))
}
// Runs the framework command through the app's run pipeline (emit → startRunWith)
// so the output streams into the shared Run console and the per-test parser; a
// direct run.start here would fork the pipeline and hide the console.
async function launch(base: string) {
  if (!props.ready || running.value) return
  error.value = ''
  lastBase.value = base
  emit('runCommand', base)
}
function ingest(line: string) {
  const result = parseResultLine(line)
  if (!result) return
  results.value = new Map(results.value).set(result.id, result)
  failed.apply(result)
}
function jump(row: TestRow) { emit('jump', { path: row.path, line: row.line }) }
const summary = computed(() => {
  let passed = 0, failedCount = 0, skipped = 0
  for (const result of results.value.values()) {
    if (result.outcome === 'passed') ++passed
    else if (result.outcome === 'failed') ++failedCount
    else ++skipped
  }
  return { passed, failed: failedCount, skipped }
})
defineExpose({ ingest, refreshFile })
watch(() => props.activePath, () => refreshFile())
</script>

<template>
  <div class="testrun-panel">
    <div class="panel-heading">
      <span><FlaskConical :size="iconSize.control" />测试</span>
      <div class="heading-actions">
        <span v-if="summary.passed || summary.failed || summary.skipped" class="heading-count">
          {{ summary.passed }} 过 / {{ summary.failed }} 败<template v-if="summary.skipped"> / {{ summary.skipped }} 跳</template>
        </span>
        <button class="icon-button" title="重新发现测试" aria-label="重新发现测试" @click="refreshProject"><RefreshCw :size="iconSize.control" /></button>
      </div>
    </div>
    <div class="testrun-toolbar">
      <button class="subtle-button" :disabled="running || !tests.length" title="运行全部（IDEA: Rerun All）" @click="runAll"><Play :size="iconSize.menu" />全部</button>
      <button class="subtle-button" :disabled="running || !selected.size" title="只跑勾选的测试" @click="runSelected"><Play :size="iconSize.menu" />所选</button>
      <button class="subtle-button" :disabled="running || !failed.size" title="只重跑失败的测试（IDEA: Rerun Failed）" @click="rerunFailed"><RotateCcw :size="iconSize.menu" />失败 ({{ failed.size }})</button>
    </div>
    <p v-if="error" class="testrun-error">{{ error }}</p>
    <div class="testrun-list" role="list">
      <p v-if="!tests.length" class="testrun-empty">当前文件与根目录没有发现测试（支持 ctest / node:test / JUnit）。</p>
      <div v-for="row in tests" :key="row.id" class="testrun-row" role="listitem">
        <input type="checkbox" :checked="selected.has(row.id)" :aria-label="`选择 ${row.name}`" @change="toggle(row.id)" />
        <button class="testrun-name" :title="`${row.path}:${row.line}`" @click="jump(row)">{{ row.name }}</button>
        <span class="testrun-meta">{{ row.framework }}</span>
        <span class="testrun-outcome" :class="outcomeOf(row.id)"><CircleCheck v-if="outcomeOf(row.id) === 'passed'" :size="iconSize.menu" aria-hidden="true" /><CircleX v-else-if="outcomeOf(row.id) === 'failed'" :size="iconSize.menu" aria-hidden="true" /><Minus v-else-if="outcomeOf(row.id) === 'skipped'" :size="iconSize.menu" aria-hidden="true" /></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.testrun-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.testrun-toolbar { display: flex; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.testrun-error { margin: 0; padding: var(--space-1) var(--space-3); color: var(--error); font-size: 11px; }
.testrun-list { flex: 1; min-height: 0; overflow: auto; }
.testrun-row { display: flex; align-items: center; gap: var(--space-2); padding: 2px var(--space-3); font-size: 12px; }
.testrun-row:hover { background: var(--hover); }
.testrun-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; background: none; border: 0; color: var(--text); font-size: 12px; }
.testrun-meta { color: var(--muted); font-size: 10px; }
/* 通过/失败/跳过的记号（第八十五批由 ✗ 文本字形换成 lucide CircleX/CircleCheck/CircleMinus）。
   槽位改成 inline-flex 居中盒，否则 svg 会按基线排在 14px 盒的下面。 */
.testrun-outcome { display: inline-flex; align-items: center; justify-content: center; width: 14px; flex-shrink: 0; }
.testrun-outcome.passed { color: var(--success); }
.testrun-outcome.failed { color: var(--error); }
.testrun-outcome.skipped { color: var(--muted); }
.testrun-empty { margin: 0; padding: var(--space-4) var(--space-3); color: var(--muted); font-size: 12px; line-height: 1.7; }
</style>
