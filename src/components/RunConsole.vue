<script setup lang="ts">
// 运行控制台的**实例标签 + 进程 + 输出区**（IDEA Run 工具窗口的多个 Content）。
//
// 对照源码（`platform/execution-impl/src/com/intellij/execution/ui/`）：
//   · 每个运行实例在 Run 工具窗口里是一个 **Content**（`RunContentDescriptor`），所以标签数 = 实例数；
//   · 标签上的关闭按钮 = 停止该实例（这里用 `×`，语义是 `run.stop {instance}`）；
//   · 控制台正文沿用原来的渲染：识别出的编译诊断可点击跳转（`jumpToIssue`），
//     连续相同行折叠显示次数（IDEA Console 的折叠规则，`src/consoleFold.ts`）。
//
// 本轮补齐的四块（2026-10-04，判据 tests/run-filters.test.mjs / tests/console-input.test.mjs /
// tests/run-output-pause.test.mjs / tests/coverage-report.test.mjs）：
//   · 超链接与异常过滤器（`src/runHyperlinks.ts` / `src/exceptionFilter.ts`）：一行里**全部**
//     `file:line` 各自可点（上游 MultipleFilesHyperlinkInfo）；异常头显示分类徽标与提示
//     （上游 ExceptionInfo 一族）、栈帧行可复制、连续栈帧可折叠/展开（Java 栈折叠）；
//   · 控制台编码选择（上游 ConsoleEncodingComboBox，`src/consoleEncoding.ts`）：切换
//     `runInstances` 的流式解码器；
//   · 暂停输出 / 继续（上游 PauseOutputAction）：冻结视图，实例缓冲继续累积；
//   · 覆盖率报告（上游 execution/coverage 的"读报告"半边，`src/coverageReport.ts`）：
//     运行结束后在工作区里找 JaCoCo/Kover XML，解析并展示行覆盖汇总与逐文件表。
//
// 「进程」区（2026-10-04 补）：IDEA 的 Stop 结束的是**整棵进程树**
// （`OSProcessHandler.destroyProcess()` → Windows `ProcessTreeKiller`）；本仓由 Runner 的
// Job Object 做到同一件事（native/runner.cpp 的 `TerminateJobObject`），宿主把每个实例的
// pid、后代清单与**监听端口**放在 `run.instances` 里（native/run_host.cpp 的
// `descendant_processes` / `listening_ports`），这里按需重取并显示**带进程名的父子层级**
// 与端口（上游 execution/portsWatcher 的可见等价物）。
//
// 「视图」动作弹层（2026-10-05 补）：上游 Run 工具窗口的 `RunnerLayoutActions` 一族
// （`platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:25-31/78-99`，
// 由 `platform/platform-impl/resources/idea/ExecutionActions.xml:142` 挂上）—— 一个实例就是
// 一个 `Content`，所以这层就是「标签条上那几行」的动作：显示/隐藏标签页标题、关闭视图 /
// 关闭其他视图 / 关闭全部视图 / 关闭全部未固定视图。判定（含「关闭全部未固定」为什么恒不可用）
// 与上游坐标全在 **src/runToolWindowLayout.ts**，这里只渲染与派发。
//
// 本组件只渲染：实例清单、当前实例输出、进程树、覆盖率报告；停止/跳转事件都交给宿主。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, X } from 'lucide-vue-next'
import { request } from '../bridge'
import {
  applyRunInstanceSnapshot, clearRunOutput, closeRunView, runConsoleEncoding, runOutputPaused,
  setInstanceCoverage, setRunConsoleEncoding, setRunOutputPaused, type RunInstanceRecord,
} from '../runInstances.ts'
import {
  readRunTabLabelsHidden, runnerViewActionRows, viewsToClose, writeRunTabLabelsHidden,
  type RunnerViewActionId, type RunViewContent,
} from '../runToolWindowLayout.ts'
import { flattenProcessTree } from '../processTree.ts'
import { classifyJavaException, describeExceptionKind, foldJavaStackFrames, parseStackFrame, stackFrameCopyText, type JavaExceptionInfo } from '../exceptionFilter.ts'
import { splitRunLine, type RunHyperlink, type RunLineSegment } from '../runHyperlinks.ts'
import { CONSOLE_ENCODINGS } from '../consoleEncoding.ts'
import { collectCoverageReportPath, parseJacocoXml, type CoverageSummary } from '../coverageReport.ts'
import { copyToClipboard } from '../clipboard.ts'
import type { RunIssue } from '../buildOutput.ts'
import { iconSize } from '../uiIcons'
import RunningDot from './RunningDot.vue'

/** 控制台里的一行（已由宿主折叠/识别过：见 `src/consoleFold.ts` 与 `src/buildOutput.ts`）。 */
export interface RunConsoleLine {
  text: string
  /** 连续相同行合并后的条数（`consoleFold.ts`）。 */
  count?: number
  /** 识别出的编译诊断（可点击跳转）；没有就是 null。 */
  issue?: RunIssue | null
  /** 行内的全部文件位置（`src/runHyperlinks.ts` 扫描；可以是 0 个）。 */
  links?: readonly RunHyperlink[]
}

const props = defineProps<{
  instances: readonly RunInstanceRecord[]
  /** 当前选中的实例 id（0 = 还没有实例）。 */
  active: number
  lines: readonly RunConsoleLine[]
  isDesktop: boolean
}>()
const emit = defineEmits<{
  select: [instance: number]
  stop: [instance: number]
  jump: [issue: RunIssue]
}>()

/** 标签标题：配置名，没有名字就用「运行 N」（N = 起跑顺序）。 */
function title(instance: RunInstanceRecord, index: number): string {
  return instance.label || `运行 ${index + 1}`
}

/** 标签右侧的状态：在跑是实心点，结束显示退出码。 */
function exitLabel(instance: RunInstanceRecord): string {
  return instance.running || instance.exit === null ? '' : `exit ${instance.exit}`
}

const anyRunning = computed(() => props.instances.some(instance => instance.running))
const activeRecord = computed(() => props.instances.find(instance => instance.id === props.active))

/** 某个实例的后代行（前序 + 缩进层级）；宿主快照每 2 秒刷新，这里只做纯整形。 */
function treeRows(instance: RunInstanceRecord) {
  return flattenProcessTree(instance.pid, instance.tree)
}

// ── 输出行 → 显示行：栈帧折叠 + 片段切片 + 异常分类（纯函数都在 src/exceptionFilter.ts 与
//    src/runHyperlinks.ts，这里只组装） ───────────────────────────────────────────────
interface DisplayLine {
  text: string
  count?: number
  issue?: RunIssue | null
  links: readonly RunHyperlink[]
  segments: RunLineSegment[]
  exception: JavaExceptionInfo | null
  frame: boolean
  foldedFrames?: number
}

/** 栈帧展开按钮（上游 Java 控制台折叠的展开）：默认折叠，点「栈帧」展开全部。 */
const stackExpanded = ref(false)
const displayLines = computed<DisplayLine[]>(() => {
  const folded = foldJavaStackFrames(props.lines.map(line => ({ ...line, text: line.text })), stackExpanded.value)
  return folded.map(line => {
    const links = line.links ?? []
    const text = line.text
    return {
      text,
      count: line.count,
      issue: line.issue ?? null,
      links,
      segments: splitRunLine(text, links),
      exception: classifyJavaException(text),
      frame: parseStackFrame(text) !== null,
      ...(line.foldedFrames !== undefined ? { foldedFrames: line.foldedFrames } : {}),
    }
  })
})

function jumpLink(link: RunHyperlink) {
  emit('jump', { path: link.path, line: link.line, column: link.column })
}
function copyLine(line: DisplayLine) {
  void copyToClipboard(stackFrameCopyText(line.text))
}

// ── 控制台编码（上游 ConsoleEncodingComboBox） ────────────────────────────────────
function onEncodingChange(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  setRunConsoleEncoding(id)
}

// ── 覆盖率报告（上游 execution/coverage 的"读报告"半边） ────────────────────────────
const coverageBusy = ref(false)
const coverageNote = ref('')
/** 逐文件表默认展示多少行（报告可能几百个文件；再多给一句「还有 N 个」）。 */
const COVERAGE_ROWS = 30
const coverageVisibleFiles = computed(() => activeRecord.value?.coverage?.files.slice(0, COVERAGE_ROWS) ?? [])
const coverageExtraFiles = computed(() => Math.max(0, (activeRecord.value?.coverage?.files.length ?? 0) - COVERAGE_ROWS))

async function loadCoverage(instanceId = props.active) {
  if (!instanceId || !props.isDesktop) return
  coverageBusy.value = true
  coverageNote.value = ''
  try {
    const listing = await request<{ files?: string[] }>('workspace.files')
    const report = collectCoverageReportPath(listing?.files ?? [])
    if (!report) {
      setInstanceCoverage(instanceId, null)
      coverageNote.value = '工作区里没有覆盖率报告：找过 build/reports/jacoco、target/site/jacoco、build/reports/kover 与 coverage/*.xml（Gradle/Maven 跑过 JaCoCo/Kover 后才会生成）。'
      return
    }
    const doc = await request<{ content: string }>('file.read', { path: report })
    const summary: CoverageSummary = parseJacocoXml(doc.content ?? '', report)
    setInstanceCoverage(instanceId, summary)
  } catch (error) {
    coverageNote.value = error instanceof Error ? error.message : String(error)
  } finally {
    coverageBusy.value = false
  }
}
// 运行结束的那一刻自动尝试读一次报告（测试任务会在退出前写好报告文件）。
watch(anyRunning, (running, wasRunning) => {
  if (wasRunning && !running) void loadCoverage()
})

// —— 视图动作族（上游 `RunnerLayoutActions`，判定与坐标全在 src/runToolWindowLayout.ts）——
// 一个实例 = 一个上游 Content，所以「视图」就是标签条上那几行。
function viewStorage(): Storage | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined
}
/** `RunnerLayout.General.isTabLabelsHidden`（RunnerLayout.java:295 默认 true）。 */
const tabLabelsHidden = ref(readRunTabLabelsHidden(viewStorage()))
function toggleTabLabels() {
  tabLabelsHidden.value = !tabLabelsHidden.value
  writeRunTabLabelsHidden(viewStorage(), tabLabelsHidden.value)
}
const viewContents = computed<RunViewContent[]>(() => props.instances.map(instance => ({ id: instance.id, closeable: true })))
const viewRows = computed(() => runnerViewActionRows(viewContents.value, props.active || null))
/**
 * 关闭一个视图：先让宿主停进程（与标签上的 × 同一件事），再把标签摘掉。
 * 上游 `CloseViewAction.perform` → `removeContent(content, true)` 就是这个次序的效果。
 */
function closeView(id: number) {
  emit('stop', id)
  closeRunView(id)
}
function runViewAction(id: RunnerViewActionId) {
  if (id === 'Runner.ToggleTabLabels') { toggleTabLabels(); return }
  for (const target of viewsToClose(id, viewContents.value, props.active || null)) closeView(target)
}

// 「进程」区：展开时按需重取宿主快照（只有宿主知道 pid/进程树/端口），在跑时每 2 秒刷新。
const processOpen = ref(false)
const processNote = ref('')
let processTimer: number | undefined
async function refreshProcesses() {
  if (!props.isDesktop) return
  try {
    const result = await request<unknown[]>('run.instances')
    applyRunInstanceSnapshot(Array.isArray(result) ? result : [])
    processNote.value = ''
  } catch (error) { processNote.value = error instanceof Error ? error.message : String(error) }
}
function toggleProcesses() {
  processOpen.value = !processOpen.value
  if (processOpen.value) void refreshProcesses()
}
// 只在有实例在跑时轮询；停止后 pid 不会变，不需要继续问。
watch(anyRunning, running => {
  if (processTimer !== undefined) { clearInterval(processTimer); processTimer = undefined }
  if (running) processTimer = window.setInterval(() => { if (processOpen.value) void refreshProcesses() }, 2000)
})
onMounted(() => { if (props.instances.length) void refreshProcesses() })
onBeforeUnmount(() => { if (processTimer !== undefined) clearInterval(processTimer) })
</script>

<template>
  <div class="run-console">
    <!-- 实例标签条：IDEA 的 Run 工具窗口就是按实例开 Content 的。
         单个实例时不占地方（不渲染标签条），保持面板干净。 -->
    <div v-if="instances.length > 1" class="run-tabs" role="tablist" aria-label="运行实例">
      <div v-for="(instance, index) in instances" :key="instance.id" class="run-tab" :class="{ selected: instance.id === active }">
        <button role="tab" :aria-selected="instance.id === active" :title="`${title(instance, index)}${instance.running ? '（正在运行）' : ''}`" @click="emit('select', instance.id)">
          <!-- `RunnerLayout.General.isTabLabelsHidden`（上游默认隐藏）：标题不画，只留状态点与退出码。 -->
          <span v-if="!tabLabelsHidden" class="run-tab-title">{{ title(instance, index) }}</span>
          <RunningDot v-if="instance.running" />
          <span v-if="exitLabel(instance)" class="run-tab-badge">{{ exitLabel(instance) }}</span>
        </button>
        <button v-if="instance.running" class="run-tab-close" :aria-label="`停止 ${title(instance, index)}`" :title="`停止 ${title(instance, index)}`" @click="closeView(instance.id)"><X :size="iconSize.inline" /></button>
      </div>
    </div>
    <!-- 「进程」区：宿主 run.instances 的 pid / 进程树 / 监听端口。停止按 Job Object 语义结束
         整棵树（native/runner.cpp），这里让"会结束哪些进程、开了哪些端口"可见。 -->
    <div v-if="instances.length" class="run-processes">
      <button type="button" class="run-process-toggle" :aria-expanded="processOpen" @click="toggleProcesses">
        <ChevronRight v-if="!processOpen" :size="iconSize.dense" aria-hidden="true" /><ChevronDown v-else :size="iconSize.dense" aria-hidden="true" />进程
      </button>
      <!-- 控制台工具条动作：暂停输出（上游 PauseOutputAction；只冻结视图，缓冲继续累积） -->
      <button type="button" class="run-action" :aria-label="runOutputPaused ? '继续输出' : '暂停输出'" :title="runOutputPaused ? '继续输出（缓冲里暂停期间的内容会补上）' : '暂停输出（视图冻结，输出继续累积）'" @click="setRunOutputPaused(!runOutputPaused)">
        {{ runOutputPaused ? '继续' : '暂停' }}
      </button>
      <!-- 栈帧折叠开关（Java 栈折叠；见 src/exceptionFilter.ts 的 foldJavaStackFrames） -->
      <button type="button" class="run-action" :aria-expanded="stackExpanded" :aria-label="stackExpanded ? '折叠栈帧' : '展开栈帧'" :title="stackExpanded ? '折叠连续栈帧' : '展开全部栈帧'" @click="stackExpanded = !stackExpanded">栈帧</button>
      <!-- 控制台编码（上游 ConsoleEncodingComboBox）：决定输出字节用哪套字符集解码 -->
      <label class="run-encoding" title="控制台输出编码（子进程按自己的代码页打印）">
        <span>编码</span>
        <select :value="runConsoleEncoding" aria-label="控制台编码" @change="onEncodingChange">
          <option v-for="encoding in CONSOLE_ENCODINGS" :key="encoding.id" :value="encoding.id">{{ encoding.label }}</option>
        </select>
      </label>
      <!-- 控制台自己的工具条动作：Clear All（上游 `ClearConsoleAction`）。只清当前实例。 -->
      <button type="button" class="run-clear" title="清空控制台输出（当前实例）" aria-label="清空控制台输出" @click="clearRunOutput()">清空</button>
      <!-- 视图动作族（上游 `RunnerLayoutActions`；ExecutionActions.xml:142 挂在 Run 工具窗口上）。
           判定与上游坐标在 src/runToolWindowLayout.ts；禁用的条目照本仓老路子「可见但点不动 + 写明原因」。 -->
      <div v-if="instances.length" class="run-views">
        <button type="button" class="run-action" aria-haspopup="menu" aria-label="视图动作">视图</button>
        <div class="run-views-menu" role="menu" aria-label="视图动作">
          <button
            v-for="row in viewRows"
            :key="row.id"
            type="button"
            role="menuitem"
            :aria-pressed="row.id === 'Runner.ToggleTabLabels' ? !tabLabelsHidden : undefined"
            :disabled="!row.enabled"
            :title="row.reason ?? row.label"
            @click="runViewAction(row.id)"
          >{{ row.label }}</button>
        </div>
      </div>
      <template v-if="processOpen">
        <div v-for="(instance, index) in instances" :key="instance.id" class="run-process-instance">
          <span class="run-process-row">
            <span class="run-process-label">{{ title(instance, index) }}</span>
            <template v-if="instance.pid">PID {{ instance.pid }}<span v-if="instance.children.length" class="run-process-children" :title="`子进程 PID：${instance.children.join(', ')}`">+{{ instance.children.length }} 个子进程</span></template>
            <span v-else class="run-process-none">{{ instance.running ? '正在取进程信息…' : '已结束' }}</span>
            <!-- 监听端口（宿主 IpHelper 快照；上游 execution/portsWatcher 的可见等价物） -->
            <span v-if="instance.ports.length" class="run-process-ports" :title="`监听端口：${instance.ports.join(', ')}`">端口 {{ instance.ports.join(', ') }}</span>
          </span>
          <!-- 进程树：根进程下面按父子层级缩进，带进程名（停止会结束这整棵树）。 -->
          <ul v-if="treeRows(instance).length" class="run-process-tree" :aria-label="`${title(instance, index)} 的进程树`">
            <li v-for="row in treeRows(instance)" :key="row.pid" :style="{ paddingLeft: `${row.depth * 12}px` }" :title="`PID ${row.pid}（父进程 ${row.parent}）`">
              <span class="run-process-name">{{ row.name }}</span>
              <span class="run-process-pid">PID {{ row.pid }}</span>
            </li>
          </ul>
        </div>
        <span v-if="processNote" class="run-process-note" role="status">{{ processNote }}</span>
      </template>
    </div>
    <p v-if="runOutputPaused" class="run-paused-hint" role="status">输出已暂停：视图冻结，实例缓冲继续累积；点「继续」补齐暂停期间的内容。</p>
    <!-- 覆盖率报告（上游 execution/coverage 的读报告半边）：运行结束后自动尝试，可手动重读。 -->
    <div v-if="activeRecord && (activeRecord.coverage || coverageNote || coverageBusy)" class="run-coverage">
      <div class="run-coverage-head">
        <span class="run-coverage-title">覆盖率</span>
        <span v-if="activeRecord.coverage" class="run-coverage-total" :title="activeRecord.coverage.reportPath">
          行覆盖 {{ activeRecord.coverage.percent }}%（{{ activeRecord.coverage.coveredLines }} / {{ activeRecord.coverage.coveredLines + activeRecord.coverage.missedLines }} 行）
        </span>
        <span v-if="activeRecord.coverage" class="run-coverage-path" :title="activeRecord.coverage.reportPath">{{ activeRecord.coverage.reportPath }}</span>
        <button type="button" class="run-action" :disabled="coverageBusy" aria-label="读取覆盖率报告" @click="loadCoverage()">{{ coverageBusy ? '读取中…' : '重读报告' }}</button>
      </div>
      <ul v-if="coverageVisibleFiles.length" class="run-coverage-files" aria-label="逐文件行覆盖">
        <li v-for="file in coverageVisibleFiles" :key="file.path" :title="file.path">
          <span class="run-coverage-file">{{ file.path }}</span>
          <span class="run-coverage-pct">{{ file.percent }}%</span>
          <span class="run-coverage-counts">{{ file.coveredLines }}/{{ file.coveredLines + file.missedLines }}</span>
        </li>
      </ul>
      <p v-if="coverageExtraFiles" class="run-coverage-more">还有 {{ coverageExtraFiles }} 个文件未列出。</p>
      <p v-if="coverageNote" class="run-coverage-note" role="status">{{ coverageNote }}</p>
    </div>
    <!-- IDEA's build console: recognised compiler diagnostics are clickable and
         jump to the offending line instead of being read as plain text. -->
    <div class="run-log" aria-label="运行输出">
      <template v-if="displayLines.length">
        <div v-for="(line, index) in displayLines" :key="index" class="run-line" :class="{ 'run-issue': line.issue }" :title="line.links.length > 1 ? line.links.map(link => `${link.path}:${link.line}`).join('\n') : undefined">
          <template v-if="line.links.length">
            <template v-for="(segment, segmentIndex) in line.segments" :key="segmentIndex">
              <button v-if="segment.link" class="run-issue-link" :title="`跳转到 ${segment.link.path}:${segment.link.line}`" @click="jumpLink(segment.link)">{{ segment.text }}</button>
              <span v-else>{{ segment.text }}</span>
            </template>
          </template>
          <button v-else-if="line.issue" class="run-issue-link" :title="`跳转到 ${line.issue.path}:${line.issue.line}`" @click="emit('jump', line.issue)">{{ line.text }}</button>
          <span v-else>{{ line.text }}</span>
          <!-- 折叠掉的栈帧数（Java 栈折叠；「栈帧」按钮展开） -->
          <span v-if="line.foldedFrames" class="run-fold-frames" :title="`已折叠 ${line.foldedFrames} 行栈帧（点工具条的「栈帧」展开）`">… 其余 {{ line.foldedFrames }} 行栈帧</span>
          <!-- 异常分类徽标（上游 ExceptionInfo 一族）：NPE/越界/转换… + JEP 358 提示 -->
          <span v-if="line.exception" class="run-exception-badge" :title="[line.exception.className, line.exception.message, line.exception.hint].filter(Boolean).join(' — ')">{{ describeExceptionKind(line.exception.kind) }}</span>
          <span v-if="line.exception && line.exception.hint" class="run-exception-hint">{{ line.exception.hint }}</span>
          <button v-if="line.exception || line.frame" class="run-line-copy" :aria-label="line.frame ? '复制栈帧' : '复制异常行'" :title="line.frame ? '复制栈帧' : '复制异常行'" @click="copyLine(line)">复制</button>
          <!-- 折叠计数（IDEA Console 的折叠行显示重复次数） -->
          <span v-if="line.count && line.count > 1" class="run-fold-count" :title="`合并了 ${line.count} 条相同行`">×{{ line.count }}</span>
        </div>
      </template>
      <p v-else class="run-placeholder">{{ isDesktop ? '点击“运行”在项目根目录执行命令；输出与退出码会实时显示。' : '浏览器预览不能运行命令，请在桌面端使用。' }}</p>
    </div>
    <p v-if="anyRunning && instances.length > 1" class="run-hint">每个实例一个标签；`×` 只关那一个（停它的进程并摘掉标签，工具栏的「停止」只停当前实例、不摘标签）。</p>
  </div>
</template>

<style scoped>
.run-console { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.run-tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px 4px 0; border-bottom: 1px solid var(--line); }
.run-tab { display: inline-flex; align-items: center; border: 1px solid transparent; border-bottom: 0; border-radius: var(--radius-xs) var(--radius-xs) 0 0; }
.run-tab.selected { border-color: var(--line); background: var(--panel); }
/* `display: inline-flex` 是补的 —— 这是 `<button>`，UA 默认 inline-block，align-items / gap 全都失效
   （同款陷阱见 src/style.css:135 的说明与第八十四批的记录）。不补的话 RunningDot 会按基线
   沉到 11px 的标题文字下面，而不是与它居中对齐。gap 收在这里，.run-tab-badge 的 margin-left 就多余了。 */
.run-tab > button { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; color: var(--muted); font-size: 11px; cursor: pointer; }
.run-tab.selected > button { color: var(--bright); }
.run-tab-title { padding: 3px 6px; }
.run-tab-badge { font-size: 10px; opacity: .8; }
.run-tab-close { padding: 3px 4px; line-height: 0; }
/* 「进程」区：一行 PID + 子进程计数 + 监听端口（宿主 run.instances），停止即结束整棵树。 */
.run-processes { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); padding: 2px var(--space-3); border-bottom: 1px solid var(--line); font-size: 10px; color: var(--muted); }
.run-process-toggle { display: inline-flex; align-items: center; gap: 2px; border: 0; padding: 0; background: transparent; color: var(--muted); font-size: 10px; cursor: pointer; }
.run-process-toggle:hover { color: var(--bright); }
.run-process-row { display: inline-flex; align-items: center; gap: 4px; }
/* 每个实例一块：根进程一行，下面是缩进的后代树（名字 + PID）。 */
.run-process-instance { flex-basis: 100%; display: flex; flex-direction: column; }
.run-process-tree { margin: 1px 0 0; padding: 0; list-style: none; }
.run-process-tree li { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.run-process-name { color: var(--text); }
.run-process-pid { opacity: .7; }
.run-process-label { color: var(--text); }
.run-process-none { color: var(--muted); opacity: .8; }
.run-process-note { flex-basis: 100%; margin: 0; color: var(--error); }
.run-process-ports { color: var(--accent); }
/* 控制台工具条动作（暂停/栈帧/编码/清空）。 */
.run-action, .run-clear { border: 0; padding: 0 2px; background: transparent; color: var(--muted); font-size: 10px; cursor: pointer; }
.run-action:hover, .run-clear:hover { color: var(--bright); }
.run-action:disabled { opacity: .5; cursor: default; }
.run-encoding { display: inline-flex; align-items: center; gap: 2px; }
.run-encoding select { border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--editor); color: var(--text); font-size: 10px; padding: 0 2px; }
.run-clear { margin-left: auto; }
/* 视图动作弹层：hover / focus-within 展开（同 src/components/RunConfigurationsDialog.vue 的 .rc-add）。 */
.run-views { position: relative; display: inline-flex; }
.run-views-menu { position: absolute; right: 0; top: 100%; z-index: 20; display: none; flex-direction: column; min-width: 150px; padding: 2px; border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); }
.run-views:hover .run-views-menu, .run-views:focus-within .run-views-menu { display: flex; }
.run-views-menu button { text-align: left; }
.run-views-menu button:disabled { color: var(--muted); opacity: .6; }
.run-paused-hint { margin: 0; padding: 2px var(--space-3); color: var(--warning, var(--muted)); font-size: 10px; border-bottom: 1px solid var(--line); }
/* 覆盖率报告区（读报告半边）：一行汇总 + 逐文件表。 */
.run-coverage { border-bottom: 1px solid var(--line); padding: var(--space-1) var(--space-3); font-size: 10px; color: var(--muted); max-height: 180px; overflow: auto; }
.run-coverage-head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.run-coverage-title { color: var(--bright); font-weight: 600; }
.run-coverage-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; opacity: .8; }
.run-coverage-files { margin: 2px 0 0; padding: 0; list-style: none; }
.run-coverage-files li { display: flex; gap: var(--space-3); }
.run-coverage-file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.run-coverage-pct { width: 44px; text-align: right; }
.run-coverage-counts { width: 64px; text-align: right; opacity: .75; }
.run-coverage-more, .run-coverage-note { margin: 2px 0 0; }
.run-log { flex: 1; min-height: 0; overflow: auto; padding: var(--space-2) var(--space-3); font: 12px/1.6 var(--font-mono); }
.run-line { white-space: pre-wrap; overflow-wrap: anywhere; }
.run-issue-link { border: 0; padding: 0; background: transparent; color: var(--accent); font: inherit; text-align: left; cursor: pointer; text-decoration: underline dotted; }
.run-fold-count { margin-left: var(--space-2); color: var(--muted); font-size: 10px; }
.run-fold-frames { margin-left: var(--space-2); color: var(--muted); font-size: 10px; }
.run-exception-badge { margin-left: var(--space-2); padding: 0 4px; border-radius: var(--radius-xs); background: var(--hover); color: var(--error); font-size: 10px; }
.run-exception-hint { margin-left: var(--space-2); color: var(--muted); font-size: 10px; }
.run-line-copy { margin-left: var(--space-2); border: 0; padding: 0 2px; background: transparent; color: var(--muted); font-size: 10px; cursor: pointer; }
.run-line-copy:hover { color: var(--bright); }
.run-placeholder { color: var(--muted); font-size: 11px; }
.run-hint { margin: 0; padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 10px; border-top: 1px solid var(--line); }
</style>
