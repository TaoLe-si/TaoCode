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
// 「正在运行」清单（2026-10-06 补，判据 tests/run-instances.test.mjs 的那五条新用例）：上游
// `ShowLiveRunConfigurations`（`platform/execution-impl/src/com/intellij/execution/actions/ShowRunningListAction.java:55-191`，
// 登记在 `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:17`、
// 挂在 `platform/platform-impl/resources/idea/ExecutionActions.xml:102`）—— 弹层列出**此刻在跑的实例**，
// 点一行 = `toFrontRunContent`（只把那个视图切到前面）。行数据、可用性门与三句文案都在 **src/runInstances.ts**。
//
// 控制台超链接（2026-10-06 第二轮补，判据 tests/console-hyperlinks.test.mjs）：**src/consoleHyperlinks.ts**
//   —— 上游的 URL 过滤器不只挂在终端，它同时是控制台的默认过滤器之一
//   （`platform/execution-impl/resources/intellij.platform.execution.impl.xml:63` 的 consoleFilterProvider），
//   构建控制台还显式再挂一次（`BuildOutputService.java:131`）。所以一行输出里的 `https://…` 在上游可点。
//   浏览器命中走宿主的 `shell.openUrl`（上游 `OpenUrlHyperlinkInfo.java:69-72` 的 navigate），
//   `file:` 命中走面板现成的 jump 通道（上游 `UrlFilter.java:89-92` 的先试文件那一支）；
//   判定规则复用 `src/terminalHyperlinks.ts`，这里不重算。单击即跳、且两类链接同一个样式
//   （`EditorHyperlinkSupport.java:113-130` 与 `:425`）。
//
// 本组件只渲染：实例清单、当前实例输出、进程树、覆盖率报告；停止/跳转事件都交给宿主。
//
// ANSI 色码（2026-10-06 第三轮补，判据 tests/console-ansi.test.mjs）：上游的运行/构建输出走
// **彩色**处理器（`JavaCommandLineStateUtil.java:17-21` → `ColoredProcessHandler`），
// 带色码的输出一行行是有色的；本仓宿主回传原始字节，所以解码在 **src/consoleAnsi.ts**
// （`AnsiEscapeDecoder`/`AnsiTerminalEmulator`/`AnsiStreamingLexer` 的等价物），
// 行样式在 `src/runIssues.ts` 就挂在每行的 `chunks` 上，这里只按片段写内联样式；
// 调色板复用终端那一套（`src/terminalColors.ts`），并跟着主题切换重算。
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, X } from 'lucide-vue-next'
import { request } from '../bridge'
import { openExternalUrl } from '../externalLinkLauncher.ts'
import {
  applyRunInstanceSnapshot, beginRun, clearRunOutput, closeRunView, runConsoleEncoding, runInterpreterCommand,
  runInstanceRows, runningListEnabled, runningListRows, RUNNING_LIST_LABELS, runOutputPaused, runOutputPausedState,
  setRunConsoleEncoding, setRunOutputPaused, STOP_LABELS,
  type RunInstanceRecord, type RunInstanceRow,
} from '../runInstances.ts'
import { interpreterAvailable, interpreterCommand } from '../consoleExecute.ts'
import {
  readRunTabLabelsHidden, runnerViewActionRows, viewsToClose, writeRunTabLabelsHidden,
  type RunnerViewActionId, type RunViewContent,
} from '../runToolWindowLayout.ts'
import { flattenProcessTree } from '../processTree.ts'
import { classifyJavaException, describeExceptionKind, foldJavaStackFrames, parseStackFrame, stackFrameCopyText, type JavaExceptionInfo } from '../exceptionFilter.ts'
import { splitRunLine, type RunHyperlink } from '../runHyperlinks.ts'
import { consoleLinkAction, consoleLinkMenuItems, consoleSegments, type ConsoleLinkMenuItem, type ConsoleSegment, type ConsoleUrlLink } from '../consoleHyperlinks.ts'
import { consoleAnsiCss, consoleAnsiStyleAt, type ConsoleAnsiChunk } from '../consoleAnsi.ts'
import { resolveTerminalThemeName, terminalPalette, type TerminalColorPalette } from '../terminalColors.ts'
import { CONSOLE_ENCODINGS } from '../consoleEncoding.ts'
import { consoleScrollToEndPosition, consoleViewAtBottom } from '../consoleScroll.ts'
import { copyToClipboard } from '../clipboard.ts'
import { postProcessConsoleActions, type ConsoleActionLike } from '../executionExtensionPoints.ts'
import type { RunIssue } from '../buildOutput.ts'
import { iconSize } from '../uiIcons'
import RunningDot from './RunningDot.vue'
import AnchoredMenu from './AnchoredMenu.vue'
// 覆盖率报告展示面（四档聚合 + 三格式）。整块从本组件搬进 CoverageReportPane.vue ——
// 它把"读报告半边"（位置识别 → 解析 → 展示）自持，本组件只在合适时机喊它 load()。
import CoverageReportPane from './CoverageReportPane.vue'

/** 控制台里的一行（已由宿主折叠/识别过：见 `src/consoleFold.ts` 与 `src/buildOutput.ts`）。 */
export interface RunConsoleLine {
  text: string
  /** 连续相同行合并后的条数（`consoleFold.ts`）。 */
  count?: number
  /** 识别出的编译诊断（可点击跳转）；没有就是 null。 */
  issue?: RunIssue | null
  /** 行内的全部文件位置（`src/runHyperlinks.ts` 扫描；可以是 0 个）。 */
  links?: readonly RunHyperlink[]
  /**
   * 这一行的 ANSI 样式片段（`src/consoleAnsi.ts` 解出来的，`text` 已是剥掉转义的可见文本）。
   * **没有样式时这个字段缺席** ⇒ 渲染路径与带色输出之前逐字相同。
   */
  chunks?: readonly ConsoleAnsiChunk[]
}

const props = defineProps<{
  instances: readonly RunInstanceRecord[]
  /** 当前选中的实例 id（0 = 还没有实例）。 */
  active: number
  lines: readonly RunConsoleLine[]
  isDesktop: boolean
  foldJavaStackTrace: boolean
  foldJavaStackTraceGreaterThan: number
  /**
   * 按 ANSI 色号（0–15）的用户自定义前景，与终端面板同一份（宿主传 `general.terminalAnsiColors`）。
   * 键是 JSON 里的字符串形态（`'3'`）；上游 `JBTerminalSchemeColorPalette.kt:23-25` 每取一个色号都回
   * 配色方案要 `ColoredOutputTypeRegistryImpl.getAnsiColorKey(index)`（`:24`），坏值由
   * `src/terminalColors.ts:70-72` 的 `pickColor` 丢弃 ⇒ 缺这一格就是不覆盖，行为与改造前一致。
   */
  ansiOverrides?: Record<string, string> | null
}>()
const emit = defineEmits<{
  select: [instance: number]
  stop: [instance: number]
  jump: [issue: RunIssue]
  foldLine: [rule: string]
}>()

/**
 * 标签那一行的**唯一**数据源 = `src/runInstances.ts` 的行模型（`runInstanceRows`）。
 * 组件原先自己算名字（`runInstanceDisplayName(instance, index)` 里那个 `index` 是**本列表**的下标）与
 * 退出码，于是同一条实例在标签条、在「正在运行」清单里可能叫两个名字（上游两处读的是同一个
 * `descriptor.getDisplayName()`：`ShowRunningListAction.java:144-158` 与标签条
 * `RunContentManagerImpl.kt:312`）⇒ 名字、存活、退出码、可停性、pid 描述全部改成从行模型投影，
 * 判据见 tests/run-instance-rows.test.mjs（行模型）与本文件那条「同一个实例只有一个名字」的断言。
 */
const rowsById = computed(() => new Map(runInstanceRows(props.active).map(row => [row.id, row])))
/** 取某一格的行数据；宿主还没建记录时（理论不发生）退回空行 ⇒ 只画状态点，不编名字。 */
function rowOf(id: number): RunInstanceRow | undefined {
  return rowsById.value.get(id)
}
/** 标签/进程区那几处都要念同一个名字（上游 `descriptor.getDisplayName()`）。 */
function title(id: number): string {
  return rowOf(id)?.title ?? ''
}

const anyRunning = computed(() => props.instances.some(instance => instance.running))
const activeRecord = computed(() => props.instances.find(instance => instance.id === props.active))

/**
 * 控制台算不算暂停（暂停按钮的按下态与提示行）。
 * 走 `runOutputPausedState()`：EP `com.intellij.execution.consolePauseStateProvider` 的贡献
 * （内建那条就是运行控制台自己的暂停位）+ 本仓的 `runOutputPaused`。
 * 无插件时 = `runOutputPaused`，按钮与提示行与接线前逐字一致。
 */
const consolePaused = computed(() => runOutputPausedState())

/** 某个实例的后代行（前序 + 缩进层级）；宿主快照每 2 秒刷新，这里只做纯整形。 */
function treeRows(instance: RunInstanceRecord) {
  return flattenProcessTree(instance.pid, instance.tree)
}

// ── ANSI 上色用的调色板 ────────────────────────────────────────────────────────────
// 与终端面板同一个来源（`src/terminalColors.ts`：16 色表 + 0..255 色号 + 「属性缺席退回默认」），
// 默认前景/背景取当前主题的 `--text`/`--editor`。上游的 palette 是从当前配色方案**现取**的
// （`platform/execution-impl/src/com/intellij/terminal/JBTerminalSchemeColorPalette.kt:12-26`），
// 所以这里也跟着主题走：切主题立刻重算，不必等下一条输出。
const consoleTheme = ref(resolveTerminalThemeName(typeof document === 'undefined' ? null : document.documentElement.dataset.theme))
let consoleThemeObserver: MutationObserver | undefined
function readConsoleTheme(): void {
  if (typeof document === 'undefined') return
  consoleTheme.value = resolveTerminalThemeName(document.documentElement.dataset.theme)
}
const consolePalette = computed<TerminalColorPalette>(() => {
  if (typeof document === 'undefined') return terminalPalette(consoleTheme.value, undefined, undefined, props.ansiOverrides ?? undefined)
  const root = getComputedStyle(document.documentElement)
  return terminalPalette(consoleTheme.value, root.getPropertyValue('--text').trim(), root.getPropertyValue('--editor').trim(), props.ansiOverrides ?? undefined)
})
onMounted(() => {
  if (typeof document === 'undefined') return
  readConsoleTheme()
  consoleThemeObserver = new MutationObserver(() => readConsoleTheme())
  consoleThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})
onBeforeUnmount(() => { consoleThemeObserver?.disconnect(); consoleThemeObserver = undefined })

// ── 输出行 → 显示行：ANSI 片段 + 栈帧折叠 + 片段切片 + 异常分类（纯函数都在 src/consoleAnsi.ts、
//    src/exceptionFilter.ts 与 src/runHyperlinks.ts，这里只组装） ─────────────────────
/** 可渲染片段 = 一个链接片段（或纯文本段）加上它起点处生效的 ANSI 样式。 */
interface RenderedSegment extends ConsoleSegment {
  style: Record<string, string>
}

interface DisplayLine {
  text: string
  count?: number
  issue?: RunIssue | null
  links: readonly RunHyperlink[]
  segments: ConsoleSegment[]
  /** 这一行的 ANSI 样式片段（没有样式时是空表）。 */
  chunks: readonly ConsoleAnsiChunk[]
  /** `segments` 逐段按**片段起点**取到的样式（见 `src/consoleAnsi.ts` 文件头那条不等价）。 */
  pieces: RenderedSegment[]
  /** 行首（偏移 0）生效的样式：整行没有片段时是空表 ⇒ 不写任何内联样式。 */
  leadingStyle: Record<string, string>
  /** 这一行有没有**任何**可点片段（文件位置或 URL）；没有才走 issue / 纯文本那两条旧分支。 */
  hyperlinked: boolean
  exception: JavaExceptionInfo | null
  frame: boolean
  foldedFrames?: number
  foldedStartIndex?: number
}

/** 配置启用时默认折叠；可点单个占位帧展开该段，「栈帧」按钮展开/折叠全部。 */
const stackExpanded = ref(false)
const expandedStackSegments = ref<ReadonlySet<number>>(new Set())
watch(() => props.active, () => { expandedStackSegments.value = new Set() })
const displayLines = computed<DisplayLine[]>(() => {
  const keep = Math.max(0, props.foldJavaStackTraceGreaterThan)
  const folded = foldJavaStackFrames(
    props.lines.map(line => ({ ...line, text: line.text })),
    stackExpanded.value || !props.foldJavaStackTrace,
    keep,
    expandedStackSegments.value,
  )
  const palette = consolePalette.value
  return folded.map(line => {
    const isFoldPlaceholder = line.foldedFrames !== undefined
    const links = isFoldPlaceholder ? [] : line.links ?? []
    const text = line.text
    const chunks = isFoldPlaceholder ? [] : line.chunks ?? []
    const segments = consoleSegments(text, splitRunLine(text, links), props.isDesktop)
    // 一个片段一种样式，取**片段起点**处生效的那一档（上游是逐字符的属性层，本仓切片渲染一格一样式，
    // 与 consoleHyperlinks 里「重叠区间取一个」同一条口径）。
    let offset = 0
    const pieces: RenderedSegment[] = segments.map(segment => {
      const at = consoleAnsiStyleAt(chunks, offset)
      offset += segment.text.length
      return { ...segment, style: at === null ? {} : consoleAnsiCss(at, palette) }
    })
    const head = consoleAnsiStyleAt(chunks, 0)
    return {
      text,
      count: isFoldPlaceholder ? undefined : line.count,
      issue: isFoldPlaceholder ? null : line.issue ?? null,
      links,
      segments,
      chunks,
      pieces,
      leadingStyle: head === null ? {} : consoleAnsiCss(head, palette),
      hyperlinked: segments.some(segment => Boolean(segment.link || segment.url)),
      exception: isFoldPlaceholder ? null : classifyJavaException(text),
      frame: !isFoldPlaceholder && parseStackFrame(text) !== null,
      ...(line.foldedFrames !== undefined ? { foldedFrames: line.foldedFrames } : {}),
      ...(line.foldedStartIndex !== undefined ? { foldedStartIndex: line.foldedStartIndex } : {}),
    }
  })
})

function expandStackSegment(startIndex: number) {
  expandedStackSegments.value = new Set([...expandedStackSegments.value, startIndex])
}

function toggleStackExpansion() {
  if (stackExpanded.value) expandedStackSegments.value = new Set()
  stackExpanded.value = !stackExpanded.value
}

function jumpLink(link: RunHyperlink) {
  emit('jump', { path: link.path, line: link.line, column: link.column })
}
/** 宿主打不开某个地址时的那一句（与 `coverageNote`、`processNote` 同一个模式：只在真出错时出现）。 */
const consoleNote = ref('')
/**
 * 控制台里一条 URL 命中的落点（两条出口，判定都在 `src/consoleHyperlinks.ts`）：
 * `file:` 那一支复用面板现成的 jump 通道，其余走本仓那**一条** URL 出口
 * （上游 `OpenUrlHyperlinkInfo.java:69-72` 的 `navigate` = `BrowserLauncher.browse`，
 * 「未信任项目里先问那一句」就长在 browse 里 —— `src/externalLinkLauncher.ts` 的模块注释）。
 * 点不开的命中根本不会被画成链接，所以这里没有第三条分支。
 */
function activateConsoleUrl(link: ConsoleUrlLink) {
  consoleNote.value = ''
  const action = consoleLinkAction(link)
  if (action.channel === 'jump') { emit('jump', action.payload); return }
  void openConsoleUrl(action.payload)
}
async function openConsoleUrl(url: string) {
  try { await openExternalUrl(url) }
  catch (error) { consoleNote.value = error instanceof Error ? `${error.name}: ${error.message}` : `打不开 ${url}。` }
}
/**
 * 链接的右键菜单（上游那张 `HyperlinkWithPopupMenuInfo` 的 ActionGroup）：只有真的右键点到一条
 * URL 命中时才出现，条目全部由 `consoleLinkMenuItems` 判定（两格都有真实落点，没有 disabled 的假行）。
 * 外壳复用本仓已有的 `AnchoredMenu.vue`（终端面板的粘贴历史菜单用的是同一个）。
 */
const linkMenu = ref<{ x: number; y: number; link: ConsoleUrlLink } | null>(null)
const foldMenu = ref<{ x: number; y: number; rule: string } | null>(null)
function consoleLineForNode(node: Node | null): Element | null {
  if (!node) return null
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest('.run-line') ?? null
}
function openFoldMenu(line: DisplayLine, event: MouseEvent) {
  if (line.foldedFrames !== undefined) return
  const currentLine = event.currentTarget instanceof Element ? event.currentTarget : null
  if (!currentLine) return
  const selection = window.getSelection()
  let rule = line.text
  if (selection && !selection.isCollapsed) {
    const anchorLine = consoleLineForNode(selection.anchorNode)
    const focusLine = consoleLineForNode(selection.focusNode)
    if (anchorLine || focusLine) {
      if (anchorLine !== currentLine || focusLine !== currentLine) return
      rule = selection.toString()
    }
  }
  rule = rule.trim()
  if (!rule) return
  event.preventDefault()
  event.stopPropagation()
  linkMenu.value = null
  foldMenu.value = { x: event.clientX, y: event.clientY, rule }
}
function addFoldRule() {
  const rule = foldMenu.value?.rule
  foldMenu.value = null
  if (rule) emit('foldLine', rule)
}
function openLinkMenu(link: ConsoleUrlLink, event: MouseEvent) {
  foldMenu.value = null
  linkMenu.value = { x: event.clientX, y: event.clientY, link }
}
function runLinkMenuItem(item: ConsoleLinkMenuItem) {
  const link = linkMenu.value?.link
  linkMenu.value = null
  if (!link) return
  if (item.id === 'copy') { void copyToClipboard(link.href); return }
  activateConsoleUrl(link)
}
function copyLine(line: DisplayLine) {
  void copyToClipboard(stackFrameCopyText(line.text))
}

// ── 控制台编码（上游 ConsoleEncodingComboBox） ────────────────────────────────────
function onEncodingChange(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  setRunConsoleEncoding(id)
}

// ── 解释器那一档（上游 `ConsoleExecuteActionHandler.myUseProcessStdIn == false`） ──────────
// 会话结束后仍能试一行命令：起一个解释器子进程（`<解释器> -c '<命令>'`）跑它，输出进本实例控制台。
// 判定与命令拼装在 `src/consoleExecute.ts`（判据 tests/console-execute.test.mjs）。
const interpreterProgram = computed(() => runInterpreterCommand.value)
const interpreterLine = ref('')
const interpreterBusy = ref(false)
const interpreterNote = ref('')
async function runInterpreter() {
  const command = interpreterCommand(interpreterProgram.value, interpreterLine.value)
  if (!command) return
  interpreterBusy.value = true
  interpreterNote.value = ''
  try {
    const started = await request<{ instance: number }>('run.start', { command, shell: true, label: `解释器：${interpreterProgram.value}` })
    if (started?.instance) beginRun(started.instance)
    interpreterLine.value = ''
    interpreterNote.value = `已在实例 ${started?.instance ?? '?'} 执行：${command}`
  } catch (caught) { interpreterNote.value = caught instanceof Error ? caught.message : String(caught) }
  finally { interpreterBusy.value = false }
}

// ── 覆盖率报告（上游 execution/coverage 的"读报告"半边） ────────────────────────────
// 展示面整个在 `CoverageReportPane.vue`（四档聚合 + 三格式分发），本组件只负责**挂它**与
// **喊它重读**：运行结束的那一刻自动读一次（测试任务会在退出前写好报告文件），
// 切换当前实例时也读一次（否则面板还停在上一条实例的报告上）。
const coveragePane = ref<InstanceType<typeof CoverageReportPane> | null>(null)
watch([anyRunning, () => props.active], ([running, active], [wasRunning, prevActive]) => {
  if (wasRunning && !running) void coveragePane.value?.load()
  else if (active !== prevActive && active) void coveragePane.value?.load()
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
 * 两个工具条下拉的展开态（上游 `ActionButton` 的 popup）。
 *
 * 为什么要显式状态而不是只靠 CSS `:hover`：这两颗按钮带 `aria-haspopup="menu"`，
 * 键盘用户与触屏用户点它时**必须**有反应 —— 纯 `:hover` 的菜单他们永远打不开
 * （原先就是这个问题：点了什么都不发生）。`open` 类同时给 CSS 一个显式展开的钩子，
 * 悬停展开那条路径保留（鼠标用户习惯不变）。
 */
const viewsOpen = ref(false)
const liveOpen = ref(false)
function toggleViewsMenu() {
  if (!viewsOpen.value) liveOpen.value = false
  viewsOpen.value = !viewsOpen.value
}
function toggleLiveMenu() {
  if (!canShowRunningList.value) return
  if (!liveOpen.value) viewsOpen.value = false
  liveOpen.value = !liveOpen.value
}
/** 点别处 / 按 Esc 收起（与宿主其它弹层同一套；Esc 另在按钮的 keydown 上接了一层）。 */
function closeRunMenus(event: PointerEvent) {
  if (event.target instanceof Element && event.target.closest('.run-views')) return
  viewsOpen.value = false
  liveOpen.value = false
  actionsOpen.value = false
}
function closeFoldMenuOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !foldMenu.value) return
  event.preventDefault()
  event.stopPropagation()
  foldMenu.value = null
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', closeRunMenus)
  window.addEventListener('keydown', closeFoldMenuOnEscape)
}
onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointerdown', closeRunMenus)
    window.removeEventListener('keydown', closeFoldMenuOnEscape)
  }
})
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

// ── 插件贡献的控制台动作（上游 `com.intellij.consoleActionsPostProcessor`） ──────────────
// 上游 `ConsoleViewImpl.createConsoleActions()` / `TerminalExecutionConsole.createConsoleActions()`
// 先造默认动作（`ScrollToTheEndAction` / `ClearAction`），再把整个数组交给
// `ConsoleActionsPostProcessor.EP_NAME.getExtensionList()` 逐条 `postProcess` —— 插件因此能给
// 运行控制台**加动作**（`ConsoleActionsPostProcessor.java:39`）。本仓的工具条动作原先写死在模板里，
// 插件无处可挂；这里补上同一条链：默认动作 = 本仓工具条上真实存在的两条（滚动到末尾 / 清空），
// 后处理链的产出里**超出默认集**的那些就是插件加的动作，渲染成一颗下拉（与「视图」同形）。
const BUILTIN_CONSOLE_ACTIONS: readonly ConsoleActionLike[] = [
  { id: 'ScrollToTheEnd', title: '滚动到末尾' },
  { id: 'ClearAll', title: '清空' },
]
const pluginConsoleActions = computed(() => {
  const builtinIds = new Set(BUILTIN_CONSOLE_ACTIONS.map(action => action.id))
  return postProcessConsoleActions(BUILTIN_CONSOLE_ACTIONS).filter(action => !builtinIds.has(action.id))
})
const actionsOpen = ref(false)
function toggleActionsMenu() {
  if (!actionsOpen.value) { viewsOpen.value = false; liveOpen.value = false }
  actionsOpen.value = !actionsOpen.value
}
function runConsoleAction(action: ConsoleActionLike) {
  actionsOpen.value = false
  try { action.perform?.() } catch { /* 一条坏动作不该把工具条打掉（上游 AnAction 抛错由平台记日志） */ }
}

// ── 「正在运行」清单（上游 `ShowLiveRunConfigurations` / `ShowRunningListAction`） ──────────
// 规则与上游坐标都在 src/runInstances.ts 的 runningListRows 上（判定不在组件里重写一遍）。
// 位置与本仓不同的一处：上游那条在 IDE 主菜单 Run 里（`idea/ExecutionActions.xml:102`，
// `:88` 打开的 `RunMenu` 组）；本仓菜单项要经 `src/actionRegistry.ts` + `App.vue`（保留文件）才有派发链路
// ⇒ 先挂在控制台工具条上（同一件可见的事），要照上游位置见接线请求 T2。
// 这一格存在的理由不是重复标签条：上游 `RunnerLayout.java:295` 的标签标题默认就是隐藏的
// （本仓同一个默认，见上面 tabLabelsHidden），多个实例时标签只剩状态点 ——
// 清单是唯一能把「在跑的是哪几个、叫什么」一次说清的可见面。
const runningRows = computed(() => runningListRows(props.active || null))
const canShowRunningList = computed(() => runningListEnabled(runningRows.value))
/** 点一行 = 上游 `toFrontRunContent(executor, descriptor)`（`:110-111`）：只把那个视图切到前面。 */
function pickRunningRow(id: number) {
  emit('select', id)
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

// ── 滚动到末尾 / 随输出贴底跟随（上游 ScrollToTheEndToolbarAction 与 ConsoleViewImpl 的 stick-to-end；
//    贴底判定与回底落点都是纯函数，在 src/consoleScroll.ts，这里只做 DOM 副作用） ──────────────
const logEl = ref<HTMLElement | null>(null)
/** 视图此刻是否贴着底部（决定新输出要不要自动跟到底）。上游用 caret/ScrollBar，本仓用视口位置（差异见模块头）。 */
const stickToEnd = ref(true)
/** 用户滚动 ⇒ 重新判定是否贴底：离底即停跟（`updateStickToEndState:481-487` 的等价）。 */
function onLogScroll() { const el = logEl.value; if (el) stickToEnd.value = consoleViewAtBottom(el) }
/** 工具条「滚动到末尾」：一次点击滚到底并重新贴底（上游非 ToggleAction，就是 `EditorUtil.scrollToTheEnd`）。 */
function scrollLogToEnd() { const el = logEl.value; if (!el) return; el.scrollTop = consoleScrollToEndPosition(el); stickToEnd.value = true }
// 渲染行数变化 ⇒ 只有正贴着底才跟下去（`flushDeferredTextImpl:666-668`）；切换实例 ⇒ 默认落到那条的最新末尾
// （本仓多条实例共用**一个**输出节点，切过去显示它的尾部是共用节点的必然差异，见 batch 文档 §1 档 B）。
watch([() => props.active, () => displayLines.value.length], async ([active, count], [prevActive, prevCount]) => {
  if (active !== prevActive) stickToEnd.value = true
  if (!stickToEnd.value) return
  if (active === prevActive && count === prevCount) return
  await nextTick()
  const el = logEl.value
  if (el && stickToEnd.value) el.scrollTop = consoleScrollToEndPosition(el)
})
</script>

<template>
  <div class="run-console">
    <!-- 实例标签条：IDEA 的 Run 工具窗口就是按实例开 Content 的。
         单个实例时不占地方（不渲染标签条），保持面板干净。 -->
    <div v-if="instances.length > 1" class="run-tabs" role="tablist" aria-label="运行实例">
      <div v-for="instance in instances" :key="instance.id" class="run-tab" :class="{ selected: instance.id === active, dimmed: rowOf(instance.id)?.dimmed }">
        <!-- 标题 = 行模型给的那一个（与「正在运行」清单同一个）；`title` 的后半段是上游
             `content.description`（`process.id.tooltip`，ExecutionBundle.properties:204），
             只在进程活着时有（RunContentManagerImpl.kt:369-376 设、:402 清）⇒ 同名实例就靠这句分辨，
             上游没有 `#2` 那种序号。 -->
        <button role="tab" :aria-selected="instance.id === active"
                :title="[title(instance.id), rowOf(instance.id)?.tabDescription ?? ''].filter(Boolean).join(' — ')"
                @click="emit('select', instance.id)">
          <!-- `RunnerLayout.General.isTabLabelsHidden`（上游默认隐藏）：标题不画，只留状态点与退出码。 -->
          <span v-if="!tabLabelsHidden" class="run-tab-title">{{ title(instance.id) }}</span>
          <!-- 在跑 ⇒ live 角标（:361-366）；结束 ⇒ 上游换成透明图标（:401）⇒ 这里画退出码 + `.dimmed`。 -->
          <RunningDot v-if="rowOf(instance.id)?.live" />
          <span v-if="rowOf(instance.id)?.exitText" class="run-tab-badge">{{ rowOf(instance.id)?.exitText }}</span>
        </button>
        <!-- 这一格的可停性读 `stoppable`（StopAction.java:310-315 的 canBeStopped）：
             「已发停止请求、进程还在结束途中」时**仍然点得动**，语义换成 Kill process（:106-110）——
             旧写法是 `v-if="instance.running"`，那一档里按钮直接消失，用户没法再点一次硬杀。 -->
        <button v-if="rowOf(instance.id)?.stoppable" class="run-tab-close" :class="{ killing: rowOf(instance.id)?.kill }"
                :aria-label="`${rowOf(instance.id)?.kill ? STOP_LABELS.kill : STOP_LABELS.base} ${title(instance.id)}`"
                :title="`${rowOf(instance.id)?.kill ? STOP_LABELS.kill : STOP_LABELS.base} ${title(instance.id)}`"
                @click="closeView(instance.id)"><X :size="iconSize.inline" /></button>
      </div>
    </div>
    <!-- 「进程」区：宿主 run.instances 的 pid / 进程树 / 监听端口。停止按 Job Object 语义结束
         整棵树（native/runner.cpp），这里让"会结束哪些进程、开了哪些端口"可见。 -->
    <div v-if="instances.length" class="run-processes">
      <button type="button" class="run-process-toggle" :aria-expanded="processOpen" @click="toggleProcesses">
        <ChevronRight v-if="!processOpen" :size="iconSize.dense" aria-hidden="true" /><ChevronDown v-else :size="iconSize.dense" aria-hidden="true" />进程
      </button>
      <!-- 控制台工具条动作：暂停输出（上游 PauseOutputAction；只冻结视图，缓冲继续累积） -->
      <button type="button" class="run-action" :aria-pressed="consolePaused" :aria-label="consolePaused ? '继续输出' : '暂停输出'" :title="consolePaused ? '继续输出（缓冲里暂停期间的内容会补上）' : '暂停输出（视图冻结，输出继续累积）'" @click="setRunOutputPaused(!runOutputPaused)">
        {{ consolePaused ? '继续' : '暂停' }}
      </button>
      <!-- 栈帧折叠开关（Java 栈折叠；见 src/exceptionFilter.ts 的 foldJavaStackFrames） -->
      <button v-if="foldJavaStackTrace" type="button" class="run-action" :aria-expanded="stackExpanded" :aria-label="stackExpanded ? '折叠栈帧' : '展开栈帧'" :title="stackExpanded ? '折叠连续栈帧' : '展开全部栈帧'" @click="toggleStackExpansion">栈帧</button>
      <!-- 滚动到末尾（上游 ScrollToTheEndToolbarAction：ConsoleViewImpl.kt:1360-1361/:1367；类本体
           ScrollToTheEndToolbarAction.java:17-39，普通 AnAction 非 ToggleAction；文案键 ActionsBundle.properties:205
           `Scroll to End`）。一次点击把输出滚到末尾并重新贴底。呈现差异如实登记：上游是图标（Scroll_down），
           本栏一水儿文字按钮（暂停/栈帧/清空）⇒ 用文字；中文措辞无法核实（zh 本地化包不在参考树里），按英文原文直译。 -->
      <button type="button" class="run-action" aria-label="滚动到末尾" title="滚动到输出末尾（跟随最新输出）" @click="scrollLogToEnd">滚动到末尾</button>
      <!-- 控制台编码（上游 ConsoleEncodingComboBox）：决定输出字节用哪套字符集解码 -->
      <label class="run-encoding" title="控制台输出编码（子进程按自己的代码页打印）">
        <span>编码</span>
        <select :value="runConsoleEncoding" aria-label="控制台编码" @change="onEncodingChange">
          <option v-for="encoding in CONSOLE_ENCODINGS" :key="encoding.id" :value="encoding.id">{{ encoding.label }}</option>
        </select>
      </label>
      <!-- 控制台自己的工具条动作：Clear All（上游 `ClearConsoleAction`）。只清当前实例。 -->
      <button type="button" class="run-clear" title="清空控制台输出（当前实例）" aria-label="清空控制台输出" @click="clearRunOutput()">清空</button>
      <!-- 插件贡献的控制台动作（上游 `ConsoleActionsPostProcessor.postProcess` 加到
           `createConsoleActions()` 返回值里的那些，见 `ConsoleActionsPostProcessor.java:39` 与
           `TerminalExecutionConsole.java:493-496`）。没有插件贡献时这一格整个不渲染 ⇒ 工具条与之前逐字相同。 -->
      <div v-if="pluginConsoleActions.length" class="run-views run-plugin-actions" :class="{ open: actionsOpen }">
        <button
          type="button" class="run-action" :aria-expanded="actionsOpen" aria-haspopup="menu" aria-label="插件动作"
          @click.stop="toggleActionsMenu()" @keydown.esc.stop="actionsOpen = false"
        >动作</button>
        <div v-if="actionsOpen" class="run-views-menu" role="menu" aria-label="插件动作">
          <button
            v-for="action in pluginConsoleActions"
            :key="action.id"
            type="button"
            role="menuitem"
            :title="action.title"
            @click="runConsoleAction(action)"
          >{{ action.title }}</button>
        </div>
      </div>
      <!-- 视图动作族（上游 `RunnerLayoutActions`；ExecutionActions.xml:142 挂在 Run 工具窗口上）。
           判定与上游坐标在 src/runToolWindowLayout.ts；禁用的条目照本仓老路子「可见但点不动 + 写明原因」。
           按钮是上游那种 `ActionButton`：**点开**（不是只有悬停）—— 原先只写了 CSS 的 `:hover`，
           于是带 `aria-haspopup` 的按钮点下去什么都不发生（键盘与触屏都用不了）。 -->
      <div v-if="instances.length" class="run-views" :class="{ open: viewsOpen }">
        <button
          type="button" class="run-action" :aria-expanded="viewsOpen" aria-haspopup="menu" aria-label="视图动作"
          @click.stop="toggleViewsMenu()" @keydown.esc.stop="viewsOpen = false"
        >视图</button>
        <div v-if="viewsOpen" class="run-views-menu" role="menu" aria-label="视图动作">
          <button
            v-for="row in viewRows"
            :key="row.id"
            type="button"
            role="menuitem"
            :aria-pressed="row.id === 'Runner.ToggleTabLabels' ? !tabLabelsHidden : undefined"
            :disabled="!row.enabled"
            :title="row.reason ?? row.label"
            @click="viewsOpen = false; runViewAction(row.id)"
          >{{ row.label }}</button>
        </div>
      </div>
      <div v-if="instances.length" class="run-views run-live" :class="{ open: liveOpen }">
        <button
          type="button" class="run-action" :disabled="!canShowRunningList" :aria-expanded="liveOpen" aria-haspopup="menu"
          :aria-label="RUNNING_LIST_LABELS.action" :title="canShowRunningList ? RUNNING_LIST_LABELS.hint : RUNNING_LIST_LABELS.disabled"
          @click.stop="toggleLiveMenu()" @keydown.esc.stop="liveOpen = false"
        >{{ RUNNING_LIST_LABELS.action }}</button>
        <div v-if="liveOpen" class="run-views-menu run-live-menu" role="menu" :aria-label="RUNNING_LIST_LABELS.title">
          <p class="run-live-caption">{{ RUNNING_LIST_LABELS.title }}</p>
          <button v-for="row in runningRows" :key="row.id" type="button" role="menuitem" :aria-current="row.active ? 'true' : undefined" :title="row.icon === 'kill' ? `${row.name}（正在结束）` : row.name" @click="liveOpen = false; pickRunningRow(row.id)">
            <RunningDot v-if="row.icon === 'run'" /><X aria-hidden="true" v-else :size="iconSize.inline" /><span>{{ row.name }}</span>
          </button>
          <p v-if="!runningRows.length" class="run-live-empty">{{ RUNNING_LIST_LABELS.empty }}</p>
          <p v-else class="run-live-hint">{{ RUNNING_LIST_LABELS.hint }}</p>
        </div>
      </div>
      <template v-if="processOpen">
        <div v-for="instance in instances" :key="instance.id" class="run-process-instance">
          <span class="run-process-row">
            <span class="run-process-label">{{ title(instance.id) }}</span>
            <template v-if="instance.pid">PID {{ instance.pid }}<span v-if="instance.children.length" class="run-process-children" :title="`子进程 PID：${instance.children.join(', ')}`">+{{ instance.children.length }} 个子进程</span></template>
            <span v-else class="run-process-none">{{ instance.running ? '正在取进程信息…' : (rowOf(instance.id)?.statusText ?? '已结束') }}</span>
            <!-- 监听端口（宿主 IpHelper 快照；上游 execution/portsWatcher 的可见等价物） -->
            <span v-if="instance.ports.length" class="run-process-ports" :title="`监听端口：${instance.ports.join(', ')}`">端口 {{ instance.ports.join(', ') }}</span>
          </span>
          <!-- 进程树：根进程下面按父子层级缩进，带进程名（停止会结束这整棵树）。 -->
          <ul v-if="treeRows(instance).length" class="run-process-tree" :aria-label="`${title(instance.id)} 的进程树`">
            <li v-for="row in treeRows(instance)" :key="row.pid" :style="{ paddingLeft: `${row.depth * 12}px` }" :title="`PID ${row.pid}（父进程 ${row.parent}）`">
              <span class="run-process-name">{{ row.name }}</span>
              <span class="run-process-pid">PID {{ row.pid }}</span>
            </li>
          </ul>
        </div>
        <span v-if="processNote" class="run-process-note" role="status">{{ processNote }}</span>
      </template>
    </div>
    <p v-if="consolePaused" class="run-paused-hint" role="status">输出已暂停：视图冻结（缓冲继续累积，继续时补齐）。</p>
    <!-- 覆盖率报告（上游 execution/coverage 的读报告半边）：展示面整个在 CoverageReportPane.vue
         （四档聚合 + 三格式分发）。运行结束的那一刻由上面的 watch 喊它 load()，也可手动重读。 -->
    <CoverageReportPane v-if="activeRecord" ref="coveragePane" :instance="activeRecord.id" :ready="isDesktop" />
    <p v-if="consoleNote" class="run-console-note" role="status">{{ consoleNote }}</p>
    <!-- IDEA's build console: recognised compiler diagnostics are clickable and
         jump to the offending line instead of being read as plain text. -->
    <div class="run-log" ref="logEl" aria-label="运行输出" @scroll.passive="onLogScroll">
      <template v-if="displayLines.length">
        <div v-for="(line, index) in displayLines" :key="index" class="run-line" :class="{ 'run-issue': line.issue, 'run-fold-frames': line.foldedFrames !== undefined }" :title="line.links.length > 1 ? line.links.map(link => `${link.path}:${link.line}`).join('\n') : undefined" @contextmenu="openFoldMenu(line, $event)">
          <template v-if="line.hyperlinked">
            <template v-for="(segment, segmentIndex) in line.pieces" :key="segmentIndex">
              <button v-if="segment.link" class="run-issue-link" :style="segment.style" :title="`跳转到 ${segment.link.path}:${segment.link.line}`" @click="jumpLink(segment.link)">{{ segment.text }}</button>
              <!-- 上游给控制台里两类链接挂的是同一个 HYPERLINK 样式（EditorHyperlinkSupport.java:425），所以这里复用同一个 class。 -->
              <button v-else-if="segment.url" class="run-issue-link" :style="segment.style" :title="segment.url.tooltip" @click="activateConsoleUrl(segment.url)" @contextmenu.prevent.stop="openLinkMenu(segment.url, $event)">{{ segment.text }}</button>
              <span v-else :style="segment.style">{{ segment.text }}</span>
            </template>
          </template>
          <button v-else-if="line.issue" class="run-issue-link" :style="line.leadingStyle" :title="`跳转到 ${line.issue.path}:${line.issue.line}`" @click="emit('jump', line.issue)">{{ line.text }}</button>
          <!-- 带 ANSI 样式的一行：逐片段上色（上游 ConsoleViewImpl 是按属性段追加文本，
               `AnsiEscapeDecoder.java:99-105` 每段带着自己的属性往下走）。 -->
          <template v-else-if="line.chunks.length">
            <span v-for="(chunk, chunkIndex) in line.chunks" :key="chunkIndex" :style="consoleAnsiCss(chunk.style, consolePalette)">{{ chunk.text }}</span>
          </template>
          <button v-else-if="line.foldedStartIndex !== undefined" type="button" class="run-fold-placeholder" @click.stop="expandStackSegment(line.foldedStartIndex)">{{ line.text }}</button>
          <span v-else>{{ line.text }}</span>
          <!-- 异常分类徽标（上游 ExceptionInfo 一族）：NPE/越界/转换… + JEP 358 提示 -->
          <span v-if="line.exception" class="run-exception-badge" :title="[line.exception.className, line.exception.message, line.exception.hint].filter(Boolean).join(' — ')">{{ describeExceptionKind(line.exception.kind) }}</span>
          <span v-if="line.exception && line.exception.hint" class="run-exception-hint">{{ line.exception.hint }}</span>
          <button v-if="line.exception || line.frame" class="run-line-copy" :aria-label="line.frame ? '复制栈帧' : '复制异常行'" :title="line.frame ? '复制栈帧' : '复制异常行'" @click="copyLine(line)">复制</button>
          <!-- 折叠计数（IDEA Console 的折叠行显示重复次数） -->
          <span v-if="line.count && line.count > 1" class="run-fold-count" :title="`合并了 ${line.count} 条相同行`">×{{ line.count }}</span>
        </div>
      </template>
    </div>
    <!-- 解释器那一档（上游 `ConsoleExecuteActionHandler.myUseProcessStdIn == false`）：
         会话结束后仍能试命令 —— 起一个解释器子进程跑一行并把输出回填到本实例的控制台。
         判定/命令拼装在 `src/consoleExecute.ts`；没有解释器命令（shell 配置）就不显示这一行。 -->
    <div v-if="interpreterAvailable(interpreterProgram)" class="run-interpreter" role="group" aria-label="解释器">
      <span class="run-interpreter-prompt" :title="`解释器：${interpreterProgram}`">&gt;&gt;&gt;</span>
      <input v-model="interpreterLine" class="run-interpreter-input" :disabled="interpreterBusy"
        :placeholder="`用 ${interpreterProgram} 执行一行（会话已结束也能试）`" aria-label="解释器输入" spellcheck="false"
        @keydown.enter.prevent="runInterpreter" />
      <button class="run-action" :disabled="interpreterBusy || !interpreterLine.trim()" @click="runInterpreter">{{ interpreterBusy ? '执行中…' : '执行' }}</button>
    </div>
    <p v-if="interpreterNote" class="run-interpreter-note" role="status">{{ interpreterNote }}</p>
    <div v-if="foldMenu" class="run-fold-menu-backdrop" @pointerdown.self="foldMenu = null" @contextmenu.prevent="foldMenu = null">
      <AnchoredMenu :x="foldMenu.x" :y="foldMenu.y" role="menu" aria-label="运行输出">
        <button type="button" class="run-fold-menu-row" role="menuitem" @click="addFoldRule">折叠类似的行</button>
      </AnchoredMenu>
    </div>
    <!-- 链接的右键菜单（上游 HyperlinkWithPopupMenuInfo 那张 ActionGroup 的等价物）：
         条目判定在 src/consoleHyperlinks.ts 的 consoleLinkMenuItems，这里只渲染与派发。 -->
    <div v-if="linkMenu" class="run-link-menu-backdrop" @pointerdown="linkMenu = null" @contextmenu.prevent="linkMenu = null">
      <AnchoredMenu :x="linkMenu.x" :y="linkMenu.y">
        <button v-for="item in consoleLinkMenuItems(linkMenu.link)" :key="item.id" class="run-link-menu-row" :title="item.description" @click="runLinkMenuItem(item)">{{ item.label }}</button>
      </AnchoredMenu>
    </div>
  </div>
</template>

<style scoped>
.run-console { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.run-tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px var(--space-1) 0; border-bottom: 1px solid var(--line); }
.run-tab { display: inline-flex; align-items: center; border: 1px solid transparent; border-bottom: 0; border-radius: var(--radius-xs) var(--radius-xs) 0 0; }
.run-tab.selected { border-color: var(--line); background: var(--panel); }
/* `display: inline-flex` 是补的 —— 这是 `<button>`，UA 默认 inline-block，align-items / gap 全都失效
   （同款陷阱见 src/style.css:135 的说明与第八十四批的记录）。不补的话 RunningDot 会按基线
   沉到 11px 的标题文字下面，而不是与它居中对齐。gap 收在这里，.run-tab-badge 的 margin-left 就多余了。 */
.run-tab > button { display: inline-flex; align-items: center; gap: var(--space-1); border: 0; background: transparent; color: var(--muted); font-size: 11px; cursor: pointer; }
.run-tab.selected > button { color: var(--bright); }
.run-tab-title { padding: 3px 6px; }
.run-tab-badge { font-size: 10px; opacity: .8; }
.run-tab-close { padding: 3px var(--space-1); line-height: 0; }
/* 结束的实例：上游把 content.icon 换成透明图标（RunContentManagerImpl.kt:401）⇒ 这里降不透明度，
   状态与颜色都不改（没有新动效，只是把「这一格已经跑完了」画出来）。 */
.run-tab.dimmed > button { opacity: .6; }
/* 正在结束途中那一格点下去是 **Kill process**（StopAction.java:106-110 + ExecutionBundle.properties:203），
   不是普通的停止 ⇒ 用既有 --error 令牌标出来。 */
.run-tab-close.killing { color: var(--error); }
/* 「进程」区：一行 PID + 子进程计数 + 监听端口（宿主 run.instances），停止即结束整棵树。 */
.run-processes { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); padding: 2px var(--space-3); border-bottom: 1px solid var(--line); background: var(--panel); font-size: 10px; color: var(--muted); }
.run-process-toggle { display: inline-flex; align-items: center; gap: var(--space-1); min-height: var(--ctrl-height-sm); border: 0; border-radius: var(--radius-xs); padding: 0 var(--space-1); background: transparent; color: var(--secondary); font-size: 11px; cursor: pointer; }
.run-process-toggle:hover { background: var(--hover); color: var(--bright); }
.run-process-row { display: inline-flex; align-items: center; gap: var(--space-1); }
/* 每个实例一块：根进程一行，下面是缩进的后代树（名字 + PID）。 */
.run-process-instance { flex-basis: 100%; display: flex; flex-direction: column; }
.run-process-tree { margin: 1px 0 0; padding: 0; list-style: none; }
.run-process-tree li { display: flex; align-items: center; gap: var(--space-1); color: var(--muted); }
.run-process-name { color: var(--text); }
.run-process-pid { opacity: .7; }
.run-process-label { color: var(--text); }
.run-process-none { color: var(--muted); opacity: .8; }
.run-process-note { flex-basis: 100%; margin: 0; color: var(--error); }
.run-process-ports { color: var(--accent); }
/* 控制台工具条动作（暂停/栈帧/编码/清空）。 */
.run-action, .run-clear { min-height: var(--ctrl-height-sm); border: 0; border-radius: var(--radius-xs); padding: 0 var(--space-1); background: transparent; color: var(--secondary); font-size: 11px; cursor: pointer; }
.run-action:hover:not(:disabled), .run-clear:hover { background: var(--hover); color: var(--bright); }
.run-action:disabled { opacity: .5; cursor: default; }
.run-encoding { display: inline-flex; align-items: center; gap: 2px; }
.run-encoding select { height: var(--ctrl-height-sm); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--editor); color: var(--text); font-size: 11px; padding: 0 var(--space-1); }
.run-clear { margin-left: auto; }
/* 视图动作弹层：hover / focus-within 展开（同 src/components/RunConfigurationsDialog.vue 的 .rc-add）。 */
.run-views { position: relative; display: inline-flex; }
.run-views-menu { position: absolute; right: 0; top: 100%; z-index: 20; display: none; flex-direction: column; min-width: 168px; padding: var(--space-1); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.run-views:hover .run-views-menu, .run-views:focus-within .run-views-menu, .run-views.open .run-views-menu { display: flex; }
.run-views-menu button { display: flex; align-items: center; gap: var(--space-2); min-height: var(--menu-row-height); border: 0; border-radius: var(--radius-xs); padding: var(--space-1) var(--space-2); background: transparent; color: var(--popup-foreground); font: 12px var(--font-ui); text-align: left; }
.run-views-menu button:hover:not(:disabled), .run-views-menu button[aria-current='true']:not(:disabled), .run-views-menu button[aria-pressed='true']:not(:disabled) { background: var(--hover); color: var(--bright); }
.run-views-menu button:disabled { color: var(--muted); opacity: .6; }
/* 「正在运行」清单：一条实例一行（图标 + 显示名）。
   `display: inline-flex` 是必须的 —— `<button>` 的 UA 默认是 inline-block，不补这行 gap/align-items 全失效
   （同款坑见上面 .run-tab > button 的注释）。空态那一句是上游 ShowRunningListAction.java:162-165 的
   `show.running.list.balloon.nothing`：清单打开后所有实例都停了就会走到这一格。 */
.run-live-menu button { display: flex; align-items: center; gap: var(--space-1); width: 100%; }
.run-live-caption, .run-live-empty, .run-live-hint { margin: 0; padding: var(--space-1) var(--space-2); color: var(--muted); font-size: 11px; line-height: 1.4; }
.run-live-caption { color: var(--bright); }
.run-paused-hint { margin: 0; padding: 2px var(--space-3); color: var(--warning, var(--muted)); font-size: 10px; border-bottom: 1px solid var(--line); }
/* 宿主打不开某个链接时的那一句（只在真出错时出现）。 */
.run-console-note { margin: 0; padding: 2px var(--space-3); color: var(--error); font-size: 10px; border-bottom: 1px solid var(--line); }
/* 链接的右键菜单：外壳样式是 AnchoredMenu 的 `.tree-menu`（全局那一份），行样式与终端面板的
   `.terminal-menu-row` 同规格（同一套令牌，不自加动效）。 */
.run-link-menu-backdrop { position: fixed; inset: 0; z-index: 30; }
.run-link-menu-row { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); border: 0; background: transparent; color: var(--text); font: 12px var(--font-mono); text-align: left; white-space: nowrap; overflow: hidden; cursor: pointer; }
.run-link-menu-row:hover { background: var(--hover); }
.run-fold-menu-backdrop { position: fixed; inset: 0; z-index: 30; }
.run-fold-menu-row { display: flex; align-items: center; width: 100%; min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); border: 0; background: transparent; color: var(--text); font: 12px var(--font-ui); text-align: left; white-space: nowrap; cursor: pointer; }
.run-fold-menu-row:hover { background: var(--hover); }
.run-log { flex: 1; min-height: 0; overflow: auto; padding: var(--space-2) var(--space-4); background: var(--editor); color: var(--secondary); font: 12px/1.6 var(--font-mono); }
.run-line { white-space: pre-wrap; overflow-wrap: anywhere; }
.run-issue-link { border: 0; padding: 0; background: transparent; color: var(--accent); font: inherit; text-align: left; cursor: pointer; text-decoration: underline dotted; }
.run-fold-count { margin-left: var(--space-2); color: var(--muted); font-size: 10px; }
.run-fold-frames { color: var(--muted); }
.run-fold-placeholder { border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.run-exception-badge { margin-left: var(--space-2); padding: 0 var(--space-1); border-radius: var(--radius-xs); background: var(--hover); color: var(--error); font-size: 10px; }
.run-exception-hint { margin-left: var(--space-2); color: var(--muted); font-size: 10px; }
.run-line-copy { margin-left: var(--space-2); border: 0; padding: 0 2px; background: transparent; color: var(--muted); font-size: 10px; cursor: pointer; }
.run-line-copy:hover { color: var(--bright); }
.run-interpreter { display: flex; align-items: center; gap: var(--space-1); padding: 2px var(--space-3); border-top: 1px solid var(--line); }
.run-interpreter-prompt { color: var(--accent); font-family: var(--font-mono); font-size: 11px; }
.run-interpreter-input { flex: 1; min-width: 0; height: var(--ctrl-height-sm); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--text); font: 12px/1.4 var(--font-mono); padding: 0 var(--space-2); }
.run-interpreter-note { margin: 0; padding: 2px var(--space-3); color: var(--muted); font-size: 10px; }
</style>
