<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, CircleCheck, CircleX, Clock, Crosshair, Eye, FileCode2, FileDown, FileInput, FileOutput, FlaskConical, GitBranch,
         FolderTree, FolderUp, ListChecks, ListOrdered, LocateFixed, Minus, Play, RefreshCw, RotateCcw, Search, Tags, Timer, ArrowDownAZ } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { beginRun, isDesktop, request, runOutput, runState, type Entry } from '../bridge'
import { discover, rerunCommand, type DiscoveredTest, type TestFramework, type TestResult } from '../testRunner'
import { TestResultFeed, type AssertionView } from '../assertionView'
import { DEFAULT_TEST_TREE_SORT, SHOW_INLINE_STATISTICS_DESCRIPTION, SHOW_INLINE_STATISTICS_NAME, SORT_ALPHABETICALLY_DESCRIPTION,
         SORT_ALPHABETICALLY_NAME, SORT_BY_DECLARATION_ORDER_DESCRIPTION, SORT_BY_DECLARATION_ORDER_NAME, SORT_BY_DURATION_DESCRIPTION,
         SORT_BY_DURATION_NAME, SUITES_ALWAYS_ON_TOP_DESCRIPTION, SUITES_ALWAYS_ON_TOP_NAME, sortTestTree,
         testNodeDurationText, testNodeDurationTooltip,
         withTestTreeSort, TestTreeBuilder, TestTreeExpander, type TestTreeSortKey, type TestTreeSortOptions, type TestTreeNode } from '../testTree'
import { NEXT_FAILED_TEST_NAME, PREVIOUS_FAILED_TEST_NAME, autoScrollTarget, nextFailedTest, occurrenceInfo, previousFailedTest,
         NAVIGATE_WITH_SINGLE_CLICK_DESCRIPTION, NAVIGATE_WITH_SINGLE_CLICK_NAME, SCROLL_TO_RUNNING_TEST_DESCRIPTION,
         SCROLL_TO_RUNNING_TEST_NAME, TRACK_RUNNING_TEST_DESCRIPTION, TRACK_RUNNING_TEST_NAME, runningTestNode } from '../testNavigation'
import { formatTestResults } from '../testResultsXml'
import { TEST_RESULTS_EXPORT_KEY, EXPORT_DIALOG_TITLE, exportTargetPath, loadTestResultsExportSettings, saveTestResultsExportSettings,
         testResultsHtmlReport } from '../testResultsExport'
import TestResultsExportDialog from './TestResultsExportDialog.vue'
import { AUTO_TEST_DELAY_KEY, AUTO_TEST_TOGGLE_NAME, AutoTestManager, createAutoTestWatcher, readAutoTestDelay } from '../autoTest'
import { classNamesOf, filterDiscovered, packagePattern, parseTagExpression, parseTestPattern, tagFilter, testPatternSelector, validateTestPattern } from '../junitPatterns'
import { TESTNG_FRAMEWORK_NAME, frameworkOfSource } from '../testng'
import { ParameterCollector, type Parameter } from '../junitParameters'
import { filterTestOutput, rerunCommandWithOptions, type TestOutputLink, type TestOutputSegment } from '../testFilters'
import { copyToClipboard } from '../clipboard'
import { IMPORT_HISTORY_GROUP_NAME, IMPORT_TESTS_CHOOSER_TITLE, IMPORT_TESTS_DESCRIPTION, IMPORT_TESTS_NAME, importTestResults, importedEventLines,
         importedFailedNames, importedHistorySize, importedSessionList, historyPresentableText, recordImportedSession } from '../testImport'
import { DEFAULT_OPEN_FAILURE_LINE, OPEN_FAILURE_LINE_DESCRIPTION, OPEN_FAILURE_LINE_NAME,
         failureLocation, firstTestLocation, resolveFrameFile, testIndexOf } from '../testLocator'
import { DEFAULT_DISPLAY_FILTER, DEFAULT_RERUN_FAILURE_FILTER, INCLUDE_NON_STARTED_NAME, SHOW_IGNORED_DESCRIPTION, SHOW_IGNORED_NAME,
         SHOW_PASSED_DESCRIPTION, SHOW_PASSED_NAME, filterTestTree, rerunFailureNames, toggleDisplayFilter,
         type RerunCandidate, type TestDisplayFilter } from '../testResultFilter'
import { formatTestEvent } from '../testEventChannel'
import { isAncestor, relativePath } from '../vcsFileUtil'
import { FIND_AFFECTED_TESTS_TEXT, affectedTestFiles, affectedTestPaths, affectedTestsNote } from '../affectedTests'

// IDEA 的测试工具窗口（`platform/testRunner`）：发现出来的测试树、运行 / 重跑失败、
// 按 suite 折叠的结果树、树排序（字母 / 声明顺序 / 耗时）与行内耗时统计、
// 上一个 / 下一个失败、导出结果 XML、改动后自动重跑。
// 每一块的落点与上游对照写在各模块头（src/testTree.ts、src/testNavigation.ts、
// src/testResultsXml.ts、src/autoTest.ts、src/junitPatterns.ts、src/junitFilters…）。
const props = defineProps<{ activePath: string; fileText: string; root: string; ready: boolean }>()
const emit = defineEmits<{ jump: [target: { path: string; line: number }] }>()

interface TestRow extends DiscoveredTest { path: string; framework: string }
const tests = ref<TestRow[]>([])
const selected = ref<Set<string>>(new Set())
const results = ref<Map<string, TestResult>>(new Map())
// 结果与失败详情由喂入器收（src/assertionView.ts）：结果行进结果表、失败行之后的
// 普通输出行进该失败的详情，断言视图从详情里抽 expected/actual。
const feed = new TestResultFeed()
const failed = feed.failed
const feedVersion = ref(0)
const selectedFailureId = ref<string | null>(null)
// 结果树（上游 TestTreeView）与它的展开状态（上游 TestTreeExpander）：与喂入器平行，
// 同一份输出块各喂一次 —— 通道管结果状态机，树管层级，两者不互相覆盖。
const treeBuilder = new TestTreeBuilder()
const expander = new TestTreeExpander()
const parameters = new ParameterCollector()
// Busy state is the shared run state — the panel's commands go through the app's
// run pipeline, so a build started anywhere also disables these buttons.
const running = computed(() => runState.running)
const error = ref('')
const note = ref('')
const lastBase = ref('')

// 框架判定：TestNG 与 JUnit 都走 `mvn test`，但发现器与注解表不同（见 src/testng.ts）。
// 这里按源码注解选（TestNG 有全限定名可判，优先），文件路径只作没有注解时的兜底。
function frameworkOf(path: string, text = ''): string {
  if (/CMakeLists\.txt$/i.test(path)) return 'ctest'
  if (/\.(java|kt)$/i.test(path)) return frameworkOfSource(text) === TESTNG_FRAMEWORK_NAME ? 'testng' : 'junit'
  return 'npm'
}

function addFrom(path: string, text: string) {
  const framework = frameworkOf(path, text)
  for (const found of discover(path, text))
    tests.value.push({ ...found, path, framework })
}
function refreshFile() {
  tests.value = tests.value.filter(row => row.path !== props.activePath)
  if (props.activePath) addFrom(props.activePath, props.fileText)
}
// 变更列表受影响的测试（上游 `TestsByChanges` + `AffectedTestsInChangeListPainter`）：
// 变更来自宿主 `git.status`，关联规则在 `src/affectedTests.ts`（文件级命名关系，见该模块头）。
async function selectAffectedTests() {
  error.value = ''; note.value = ''
  if (!isDesktop) { error.value = '浏览器预览里读不到 git 变更。'; return }
  try {
    const status = await request<{ changes?: Array<{ path: string; indexStatus?: string; workStatus?: string; untracked?: boolean }> }>('git.status')
    const changes = status.changes ?? []
    const entries = tests.value.map(row => ({ path: row.path, kind: 'file' as const }))
    const hits = affectedTestFiles(changes, entries)
    note.value = affectedTestsNote(changes, hits)
    const paths = new Set(affectedTestPaths(hits))
    if (paths.size) {
      selected.value = new Set(tests.value.filter(row => paths.has(row.path)).map(row => row.id))
      scopeText.value = ''
    }
  } catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
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

// --- 运行范围：模式 / 包或目录 / tag（上游 TestsPattern / AllInPackage / AllInDirectory / TestTags）
const patternText = ref('')
const tagText = ref('')
// 上游的「包内全部测试」与「目录内全部测试」是两个生产者
// （`AbstractAllInPackageConfigurationProducer.java:24-51` 存包名、
// `AbstractAllInDirectoryConfigurationProducer.java` 收目录内的类）。本仓按输入形状分流：
// 含 `/` 或 `\` 就按**目录**前缀裁发现结果，否则按**包**限定名前缀裁。
const scopeText = ref('')
const scopeIsDirectory = computed(() => /[\\/]/.test(scopeText.value.trim()))
function withinScope(row: TestRow): boolean {
  const text = scopeText.value.trim()
  if (!text) return true
  if (scopeIsDirectory.value) {
    const directory = text.replace(/\\/g, '/').replace(/\/+$/, '')
    return row.path === directory || row.path.startsWith(`${directory}/`)
  }
  return row.suite === text || row.suite.startsWith(`${text}.`)
}
const patternProblem = computed(() => {
  const pattern = parseTestPattern(patternText.value)
  return pattern ? validateTestPattern(pattern, classNamesOf(tests.value)) : null
})
const tagExpression = computed(() => parseTagExpression(tagText.value))
/** 模式 + 范围过滤后的已发现测试（面板的即时效果，也是「所选」按钮的候选集）。 */
const visibleTests = computed(() => filterDiscovered(patternText.value.split(',').map(part => part.trim()).filter(Boolean), tests.value).filter(withinScope))
const selectedRows = computed(() => visibleTests.value.filter(row => selected.value.has(row.id)))
/** 面板底部那行「将要跑的命令」（上游是运行配置的 Pattern 字段，这里是它的即时回显）。 */
const scopeSelector = computed(() => {
  const text = scopeText.value.trim()
  if (!text) return testPatternSelector(patternText.value.split(',').map(p => p.trim()).filter(Boolean))
  // 范围内解析到的类就是上游交出去的东西；一条都没发现时退回包名通配
  // （`TestsPattern.getFilters:120-122` 的「类解析不出来就把模式原样交给运行器」同一条退路）。
  const classes = [...new Set(visibleTests.value.map(row => row.suite))].sort()
  return classes.length ? testPatternSelector(classes) : (scopeIsDirectory.value ? '' : packagePattern(text))
})
const tagHint = computed(() => { const filter = tagFilter(tagExpression.value); return filter && !tagExpression.value.error ? filter : '' })

async function runBase(): Promise<string> {
  const framework = visibleTests.value.find(row => selected.value.has(row.id))?.framework ?? frameworkOf(props.activePath)
  if (framework === 'ctest') return 'ctest --output-on-failure'
  if (framework === 'junit' || framework === 'testng') return 'mvn test'
  return 'npm test'
}
/** 模式与 tag 落到命令上（上游把 pattern 原样当过滤器，`TestsPattern.getFilters`）。 */
async function scopedBase(): Promise<string> {
  const base = await runBase()
  const framework = visibleTests.value.find(row => selected.value.has(row.id))?.framework ?? frameworkOf(props.activePath)
  if (framework !== 'junit' && framework !== 'testng') return base
  const selector = scopeSelector.value || tagHint.value
  return selector ? `${base} -Dtest=${selector}` : base
}
async function runAll() {
  // 范围填了却什么也没选中时**明说**，不退回去跑全部（静默扩大范围比不跑更糟）。
  if (scopeText.value.trim() && !scopeSelector.value) {
    error.value = scopeIsDirectory.value
      ? `目录「${scopeText.value.trim()}」里没有发现测试：本仓的目录范围靠发现索引，合成不出运行器侧的类列表。`
      : `包「${scopeText.value.trim()}」里没有发现测试。`
    return
  }
  await launch(await scopedBase())
}
async function runSelected() {
  if (!selectedRows.value.length) { await runAll(); return }
  const framework = (selectedRows.value[0]?.framework ?? 'npm') as TestFramework
  await launch(rerunCommand(framework, await scopedBase(), selectedRows.value.map(row => row.name)))
}
// --- 「重跑失败项」的重跑集（上游 `AbstractRerunFailedTestsAction.getFailuresFilter:131-141`）------
// 上游判的是 `model.getRoot().getAllTests()`（`:111`）：上一次运行**报过的**节点（suite 也在池里，
// 所以 `JavaRerunFailedTestsAction.java:22-30` 那条 `and(LEAF)` 才有意义 —— LEAF = 「孩子数为 0」）。
// 默认档（`TestConsoleProperties.java:58 includeNonStarted=true`）把「非通过」一起算进来，本仓的
// 两支取数处：`notFinished()`（报了 testStarted 却没结束事件）+ `notStartedSuites()`
// （只报了 suiteStarted、既没长出测试也还没闭合的类 —— 属性名里 "Non-Started" 的正身）。
// 开关的用户可见性：上游 `JUnitConsoleProperties.java:50` 把它加进 gear 组，
// 文案 `ExecutionBundle.properties:157`。
const rerunFilter = ref({ ...DEFAULT_RERUN_FAILURE_FILTER })
/** 有结果的那批（passed / failed / skipped）。测试节点在本仓的树里永远没有孩子。 */
const toCandidate = (result: TestResult): RerunCandidate => ({ name: result.name, kind: 'test', outcome: result.outcome, childCount: 0 })
/** 报了开始却没跑完的那批：上游的 NOT_PASSED 里 interrupted / 未开始那一档。 */
const toPendingCandidate = (entry: { id: string; name: string }): RerunCandidate => ({ name: entry.name, kind: 'test', outcome: null, childCount: 0 })
/** 压根没跑起来的类：上游 `SMTestProxy.java:238-240` 的 isLeaf 判孩子数，所以它是**叶子**（childCount: 0）。 */
const toNeverStartedCandidate = (entry: { id: string; name: string; path: string }): RerunCandidate =>
  ({ name: entry.name, kind: 'suite', outcome: null, childCount: 0 })
const rerunNames = computed<string[]>(() => {
  void feedVersion.value
  const done = [...results.value.values()].map(toCandidate)
  const stuck = treeBuilder.notFinished().map(toPendingCandidate)
  const neverStarted = treeBuilder.notStartedSuites().map(toNeverStartedCandidate)
  return rerunFailureNames([...done, ...stuck, ...neverStarted], rerunFilter.value)
})
function toggleRerunFilter(): void {
  rerunFilter.value = { ...rerunFilter.value, includeNonStarted: !rerunFilter.value.includeNonStarted }
}
async function rerunFailed() {
  if (!rerunNames.value.length) { error.value = '没有失败的测试可重跑。'; return }
  await launch(rerunCommand((visibleTests.value[0]?.framework ?? 'npm') as TestFramework, lastBase.value || await scopedBase(), rerunNames.value))
}
/**
 * 真跑：走宿主 `run.start` + `beginRun`（与 `src/runActions.ts` 的 `runToExit` 同一对调用），
 * 输出流进共享的运行缓冲（`runOutput`），本面板的喂入器与结果树都从那里来。
 */
async function launch(command: string) {
  if (!props.ready || running.value) return
  error.value = ''
  note.value = ''
  lastBase.value = command
  try {
    const started = await request<{ instance: number }>('run.start', { command, shell: true, label: '测试' })
    if (started?.instance) beginRun(started.instance)
  } catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
}
function ingest(chunk: string) {
  // 块交给 feedChunk：结构化事件行（`##taocode[...]`，smRunner 等价通道）优先，文本解析回退。
  const produced = feed.feedChunk(chunk)
  treeBuilder.feed(chunk)
  for (const line of chunk.split('\n')) parameters.feed(line)
  feedVersion.value++
  if (produced.length) results.value = new Map(feed.results)
}
// 失败断言的并排视图：选中的失败，没有选中就跟着最近一条失败走（IDEA 的失败详情
// 也是跟随当前选中的结果节点）。
const failureView = computed<{ id: string; name: string; view: AssertionView } | null>(() => {
  void feedVersion.value
  const id = selectedFailureId.value ?? feed.latestFailedId()
  const result = id ? results.value.get(id) : undefined
  if (!id || !result || result.outcome !== 'failed') return null
  return { id, name: result.name, view: feed.view(id) }
})
// 运行输出是宿主的累积数组（runInstances.runOutput）。逐**块**消费：数组缩短（上一次运行被
// 清掉）时重置，喂入过的下标不再重放，失败详情因此每条只属于它自己那次运行。块交给喂入器
// 切行（结构化事件行被 flush 截断时它会缓存残段，见 src/assertionView.ts 的 feedChunk）。
let ingestedChunks = 0
watch(() => runOutput.length, length => {
  if (length < ingestedChunks) {
    ingestedChunks = 0
    feed.reset(); treeBuilder.reset(); parameters.reset(); expander.clear()
    results.value = new Map(); selectedFailureId.value = null
  }
  for (; ingestedChunks < length; ++ingestedChunks) ingest(runOutput[ingestedChunks] ?? '')
}, { immediate: true })

// --- 结果树（上游 TestTreeView）---------------------------------------------
const tree = computed<TestTreeNode[]>(() => {
  void feedVersion.value
  const located = new Map(tests.value.map(row => [row.id, { path: row.path, line: row.line }]))
  return treeBuilder.build(results.value, located)
})
// 显示过滤器（上游 `TestFrameworkActions.installFilterAction`：开关变了重算可见性，
// 不重跑测试）。默认档取上游对 **Java 运行** 的那一套：两条都不隐藏
// （`JavaTestFrameworkRunnableState.java:322` 把 `HIDE_PASSED_TESTS` 设成 false，
//   `TestConsoleProperties.java:51` 的 `HIDE_IGNORED_TEST` 本来默认就是 false）。
const displayFilter = ref<TestDisplayFilter>({ ...DEFAULT_DISPLAY_FILTER })
// 排序与行内统计（上游 `TestConsoleProperties.java:45-48/57` 的四个开关 + `:57` 的默认显示时长）：
// 三个排序键互斥（`ToolbarPanel.java:84-95/98-110/306-334`），耗时排序只在没在跑时生效
// （`TestFrameworkRunningModel.java:44`、`SMTestRunnerResultsForm.java:310-312`）。
const sortOptions = ref<TestTreeSortOptions>({ ...DEFAULT_TEST_TREE_SORT })
const showInlineStatistics = ref(true)
// 「现在」只在新输出到达时重算（`feedVersion` 是喂入计数）—— 上游的运行中时长也是**画的那一刻**
// 减开始时间戳（`JavaSMTRunnerTestTreeView.java:69` 的 `System.currentTimeMillis()`），
// 而重画由事件驱动（同文件 `:35-46` 的属性监听里 `redrawStatusLabel()`），本仓没有定时器。
const renderNow = computed(() => { void feedVersion.value; return Date.now() })
/** 行右侧那一格的文本与 tooltip（wall time / 运行中实时时长 / 孩子之和，见 `src/testTree.ts` 的呈现一节）。 */
const durationOf = (node: TestTreeNode) => testNodeDurationText(node, renderNow.value)
// 模块侧的 null 是上游的 `@Nullable`（不画这一格）；DOM 侧 `title` 只认 undefined ⇒ 在组件边界换掉。
const durationHint = (node: TestTreeNode) => testNodeDurationTooltip(node) ?? undefined
const sortedTree = computed(() => sortTestTree(tree.value, sortOptions.value, running.value))
/** 三个排序键各自对应的开关名（互斥由 `withTestTreeSort` 保证）。 */
const SORT_FLAG_OF: Record<TestTreeSortKey, keyof TestTreeSortOptions> = {
  alphabetically: 'sortAlphabetically',
  duration: 'sortByDuration',
  declaration: 'sortByDeclarationOrder',
}
function chooseSort(key: TestTreeSortKey): void {
  sortOptions.value = withTestTreeSort(sortOptions.value, sortOptions.value[SORT_FLAG_OF[key]] ? null : key)
}
const shownTree = computed(() => filterTestTree(sortedTree.value, displayFilter.value))
const expandable = computed(() => expander.canExpand(shownTree.value))
/** 还没跑过的已发现测试也进列表（上游的「没有结果的测试」在树上只是没有状态）。 */
const pendingTests = computed(() => visibleTests.value.filter(row => !results.value.has(row.id)))
const outcomeOf = (id: string) => results.value.get(id)?.outcome
function expandAll() { expander.expandAll(shownTree.value); feedVersion.value++ }
function collapseAll() { expander.collapseAll(shownTree.value); feedVersion.value++ }
function isExpanded(node: TestTreeNode) { return node.children.length === 0 || expander.isExpanded(node.id) }
function toggleNode(node: TestTreeNode) { expander.toggle(node.id); feedVersion.value++ }
function selectNode(node: TestTreeNode) {
  if (node.kind === 'test' && node.outcome === 'failed') selectedFailureId.value = node.id
  if (node.kind === 'suite') toggleNode(node)
}
const selectedNodeId = computed(() => failureView.value?.id ?? null)
/** 参数化 / 动态用例挂在它所属的测试下（上游 JUnitParameterCollector 的节点）。 */
const parametersOf = (node: TestTreeNode) => node.kind === 'test' ? parameters.parametersFor(node.location) : []
// 源码位置走**定位器链**（上游 `SMTestLocator` / `GradleTestLocator.kt:29-33` 的等价物，
// `src/testLocator.ts`）：先按本仓通道的 `file:line` 认，认不出再解 `java:suite://` /
// `java:test://` URL —— 后者是导入的 ant/JUnit XML 给出的位置，光解 `file:line` 时那些节点跳不了。
const testIndex = computed(() => testIndexOf(tests.value.map(row => ({ suite: row.suite, name: row.name, path: row.path, line: row.line }))))
const sourceOf = (node: TestTreeNode) => {
  const hit = firstTestLocation(node.location, testIndex.value)
  return hit ? { path: hit.path, line: hit.line } : null
}
/** 「Open Source at Exception」（上游 `TestConsoleProperties.java:54` 的 `openFailureLine`，默认 true；
 *  开关本体在 `ToolbarPanel.java:187-189`，文案在 `ExecutionBundle.properties:166-167`）。 */
const openFailureLine = ref(DEFAULT_OPEN_FAILURE_LINE)
/** 结果树里测试节点的全路径去掉尾段就是它那一层的类名（`TestTreeBuilder.build()` 同一裁法）。 */
const classNameOf = (node: TestTreeNode): string => {
  const dot = node.path.lastIndexOf('.')
  return dot < 0 ? node.path : node.path.slice(0, dot)
}
/**
 * 导航落点（上游 `SMTestProxy.java:406-421` 的 `getDescriptor`）：失败的叶子**先**问它自己那条栈里
 * 「本类本方法」的那一帧（`JavaAwareTestConsoleProperties.java:84-87` 的注释
 * "//navigate to the first stack trace"），认不出才退声明位置（同文件的 `location.getNavigatable()`）。
 * tooltip 仍报声明位置（上游 `BaseTestProxyNodeDescriptor` 用的是 locationHint）⇒ 这条只长在跳转上。
 */
const navigateTarget = (node: TestTreeNode) => {
  const frame = node.kind === 'test' && node.outcome === 'failed'
    ? failureLocation(feed.detailLines(node.id), classNameOf(node), node.name, testIndex.value, openFailureLine.value)
    : null
  if (frame) return { path: frame.path, line: frame.line }
  return sourceOf(node)
}
/**
 * 失败详情里一条 `file:line` 的落点：裸文件名（栈帧里的 `MathTest.java`）先落到发现索引里的
 * 真实路径；认不出就**不跳**，把原因写在状态行里（上游 `JavaTestLocator` 解析不出来给空表，
 * 本仓不造一条打不开的路径）。
 */
function jumpDetailLink(link: TestOutputLink) {
  const target = resolveFrameFile(link.path, link.line, testIndex.value)
  if (!target) { note.value = `栈帧里的「${link.path}:${link.line}」不在发现结果里，打不开。`; return }
  emit('jump', { path: target.path, line: target.line })
}

// --- 失败导航（上游 FailedTestsNavigator）------------------------------------
// 走的是**看得见**的那棵树（排过序、滤过的），与上游 navigator 在展示模型上数「第 N 个」一致。
function stepFailure(direction: 1 | -1) {
  const target = direction === 1 ? nextFailedTest(shownTree.value, selectedNodeId.value) : previousFailedTest(shownTree.value, selectedNodeId.value)
  if (!target) { note.value = '没有更多失败的测试。'; return }
  note.value = `${direction === 1 ? NEXT_FAILED_TEST_NAME : PREVIOUS_FAILED_TEST_NAME}：第 ${target.number} / ${target.count} 个`
  selectedFailureId.value = target.id
  const node = flatten(shownTree.value).find(item => item.id === target.id)
  if (node) for (const ancestor of ancestorsOf(node)) expander.toggle(ancestor.id)
}
function flatten(nodes: readonly TestTreeNode[]): TestTreeNode[] {
  const out: TestTreeNode[] = []
  for (const node of nodes) { out.push(node); out.push(...flatten(node.children)) }
  return out
}
function ancestorsOf(node: TestTreeNode): TestTreeNode[] {
  const out: TestTreeNode[] = []
  for (const candidate of flatten(shownTree.value)) if (node.path.startsWith(`${candidate.path}.`)) out.push(candidate)
  return out.sort((a, b) => a.depth - b.depth)
}
function jump(node: TestTreeNode) {
  const target = navigateTarget(node)
  if (target) emit('jump', target)
}
const summary = computed(() => {
  let passed = 0, failedCount = 0, skipped = 0
  for (const result of results.value.values()) {
    if (result.outcome === 'passed') ++passed
    else if (result.outcome === 'failed') ++failedCount
    else ++skipped
  }
  return { passed, failed: failedCount, skipped }
})

// --- 导出结果（上游 TestResultsXmlFormatter + ExportTestResultsAction/Form）----
// XML 档进剪贴板（`.xml` 不在宿主写盘白名单里，见 src/testResultsExport.ts 模块头）；
// HTML 档走保存对话框 + `app.writeExportFiles`（与问题面板/用法视图同一条通道）。
const exportStorage = typeof localStorage === 'undefined' ? null : localStorage
function exportDetails(): Map<string, { text?: string; expected?: string | null; actual?: string | null }> {
  const details = new Map<string, { text?: string; expected?: string | null; actual?: string | null }>()
  for (const [id, result] of results.value) {
    if (result.outcome !== 'failed') continue
    const view = feed.view(id)
    details.set(id, { text: feed.detailLines(id).join('\n'), expected: view.expected, actual: view.actual })
  }
  return details
}
async function exportXml() {
  const xml = formatTestResults(tree.value, { runName: lastBase.value || '测试', details: exportDetails(), productName: 'TaoCode',
                                               timestamp: new Date().toISOString() })
  try { await copyToClipboard(xml); note.value = `已把 ${xml.length} 字节的测试结果 XML 复制到剪贴板。` }
  catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
}
// 「导出测试结果…」对话框（上游 ExportTestResultsAction.actionPerformed 的对话框那一步）。
const exportOpen = ref(false)
const exportBusy = ref(false)
const exportPicked = ref('')
const exportSettings = ref(loadTestResultsExportSettings(exportStorage?.getItem(TEST_RESULTS_EXPORT_KEY) ?? null))
function openExportDialog() { if (results.value.size) exportOpen.value = true }
async function browseExportFolder(initial: string) {
  const picked = await request<string | null>('dialog.pickDirectory', { title: '选择测试结果输出目录', initial })
  if (picked) exportPicked.value = picked
}
async function saveExport(draft: { format: 'xml' | 'html'; fileName: string; folder: string; openResults: boolean }) {
  exportBusy.value = true
  error.value = ''; note.value = ''
  try {
    exportSettings.value = { outputFolder: draft.folder, openResultsInEditor: draft.openResults, format: draft.format }
    saveTestResultsExportSettings(exportStorage ?? undefined, exportSettings.value)
    if (draft.format === 'xml') { await exportXml(); exportOpen.value = false; return }
    const path = exportTargetPath(draft.folder, draft.fileName)
    const content = testResultsHtmlReport(tree.value, { runName: lastBase.value || '测试', details: exportDetails(), productName: 'TaoCode', timestamp: new Date().toISOString() })
    await request('app.writeExportFiles', { files: [{ path, content }] })
    note.value = `已导出测试结果：${path}`
    if (draft.openResults) await request('shell.openUrl', { url: path }).catch(() => undefined)
    exportOpen.value = false
  } catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
  finally { exportBusy.value = false }
}

// --- 导入历史测试结果（上游 `sm/runner/history/` 一族）------------------------
// 上游 `ImportTestsFromFileAction.java:19-38` 打开文件选择框（标题取
// `SmRunnerBundle.properties:40`），把 XML 交给 `findHandler` 认出的 content handler
// 还原成事件；本仓同一件事由 `src/testImport.ts` 的 `importTestResults` 做，事件再经
// `formatTestEvent` 转成通道行**当一次运行的输出**喂进来 —— 结果表、结果树、断言视图、
// 定位器全都复用现成的那条链路（与上游 `ImportedToGeneralTestEventsConverter`
// 继承输出转换器的关系一致：同一份处理器，两种来源）。
const importStorage = typeof localStorage === 'undefined' ? null : localStorage
const importedHistory = ref<string[]>(importedSessionList(importStorage, importedHistorySize(null)))
// 导入会话里失败的用例名（上游 `ImportedTestRunnableState` 给导入结果挂「重跑失败的」）。
const importedFailures = ref<string[]>([])
const baseNameOf = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
async function importTestsFromFile(fileName?: string) {
  error.value = ''
  note.value = ''
  const target = fileName ?? await chooseTestResultFile()
  if (!target) return
  try {
    const read = await request<{ content: string }>('file.read', { path: target })
    const imported = importTestResults(read.content)
    // 认不出格式/结构不合法 ⇒ 只报原因，不产出结果（上游非 XML 文件走
    // `Messages.showWarningDialog`，标题 `SmRunnerBundle.properties:39` = Failed to Parse {0}）。
    if (imported.error) { error.value = `Failed to Parse ${baseNameOf(target)}：${imported.error}`; return }
    ingest(importedEventLines(imported.events, formatTestEvent).join('\n'))
    importedFailures.value = importedFailedNames(imported.events)
    importedHistory.value = recordImportedSession(importStorage, target, importedHistorySize(null))
    note.value = `已导入 ${baseNameOf(target)}（${imported.format} 格式，${imported.events.length} 个事件${importedFailures.value.length ? `，${importedFailures.value.length} 个失败可重跑` : ''}）。`
  } catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
}
/** 重跑导入会话里失败的用例（上游 `ImportedTestRunnableState.java:67-78` 的 rerun action）：
 *  失败名交给同一份 `rerunCommand` 拼进命令，与本仓自己跑出来的失败重跑同一条链路。 */
async function rerunImportedFailures() {
  if (!importedFailures.value.length) return
  const base = lastBase.value || await scopedBase()
  await launch(rerunCommand((visibleTests.value[0]?.framework ?? 'npm') as TestFramework, base, importedFailures.value))
}
/**
 * 系统文件选择框（宿主 `dialog.pickFile`）。宿主读文件只认**工作区内**的相对路径
 * （`native/workspace.cpp` 的 `Workspace::read` 先 `parse_relative`，再由 `boundary` 拦越界），
 * 所以选到项目外时如实说明并放弃，与 `src/patchApplyHost.ts:119-124` 同一处置。
 */
async function chooseTestResultFile(): Promise<string | null> {
  if (!isDesktop) { error.value = '浏览器预览里打不开系统文件对话框，请在桌面端使用。'; return null }
  const chosen = await request<{ path?: string | null } | string | null>('dialog.pickFile',
    { title: IMPORT_TESTS_CHOOSER_TITLE, filters: '测试结果 XML|*.xml|所有文件|*.*', initial: props.root })
  const absolute = typeof chosen === 'string' ? chosen : chosen?.path ?? null
  if (!absolute) return null
  if (!props.root || !isAncestor(props.root, absolute, false)) {
    error.value = `测试结果文件在项目外（${absolute}）：宿主只能读取工作区内的文件。`
    return null
  }
  return relativePath(props.root, absolute)
}

// --- 失败详情上的过滤器（上游 GradleReRunBuildFilter / Filter 一族）-----------
const detailSegments = computed<TestOutputSegment[]>(() => {
  void feedVersion.value
  if (!failureView.value) return []
  return filterTestOutput(feed.detailLines(failureView.value.id), props.root)
})
async function rerunWithOption(option: string) {
  await launch(rerunCommandWithOptions(lastBase.value || await runBase(), [option]))
}

// --- 自动测试（上游 ToggleAutoTestAction / AbstractAutoTestManager）----------
const autoTest = new AutoTestManager(typeof localStorage === 'undefined' ? null : localStorage, false)
const autoDelay = ref(autoTest.getDelay())
const watcher = createAutoTestWatcher({
  delayMs: autoDelay.value,
  run: () => { void runAll() },
  isRunning: () => running.value,
  onTerminated: run => { void nextTick(() => run()) },
})
function toggleAutoTest() {
  autoTest.setEnabled(!autoTest.isEnabled())
  if (!autoTest.isEnabled()) watcher.cancel()
  note.value = autoTest.isEnabled() ? `${AUTO_TEST_TOGGLE_NAME}：改动后 ${autoDelay.value} ms 重跑。` : ''
}
function setAutoDelay(value: number) {
  autoDelay.value = autoTest.setDelay(value, () => watcher.cancel())
  autoDelay.value = readAutoTestDelay(typeof localStorage === 'undefined' ? null : localStorage)
  AUTO_TEST_DELAY_KEY  // 上游的存储键，测试用同一份
  if (autoTest.isEnabled()) void nextTick(() => watcher.trigger())
}
watch(() => props.fileText, () => { if (autoTest.isEnabled()) watcher.trigger() })

// --- 跟随运行中的测试（上游 ScrollToRunningTestAction / TRACK_RUNNING_TEST）----
// `TestConsoleProperties.java:50` 的 `trackRunningTest` 默认 true、`:53` 的
// `scrollToSource` 默认 false，本仓用同一对默认值。跟踪开着时「滚动到运行中的测试」
// 才可见（`ScrollToRunningTestAction.java:28-33`：`tracked` 才 visible，且只有真在跑才 enabled）。
const trackRunning = ref(true)
const scrollToSource = ref(false)
const listRef = ref<HTMLElement | null>(null)
const runningNode = computed(() => runningTestNode(tree.value))
/** 把某个结果节点露出来：先把祖先 suite 展开（折叠时行根本不在 DOM 里），再滚到那一行。 */
function focusNode(node: TestTreeNode) {
  for (const ancestor of ancestorsOf(node)) if (!expander.isExpanded(ancestor.id)) expander.toggle(ancestor.id)
  feedVersion.value++
  void nextTick(() => {
    const row = listRef.value?.querySelector(`[data-node-id="${node.id.replace(/"/g, '\\"')}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  })
}
/** 动作本体（`ScrollToRunningTestAction.actionPerformed` = `model.scrollToRunningTest()`）。 */
function scrollToRunningTest() {
  const node = runningNode.value
  if (!node) { note.value = `${SCROLL_TO_RUNNING_TEST_NAME}：现在没有在跑的测试。`; return }
  focusNode(node)
}
// 运行中换了测试就跟着走：树里滚到那一行；「Navigate with Single Click」开着时
// 再把源码打开（位置解析走定位器链，导入的 XML 里的 URL 位置同样跟得上）。
watch(() => runningNode.value?.id ?? null, (id, previous) => {
  if (!id || id === previous || !trackRunning.value) return
  focusNode(runningNode.value!)
  const target = autoScrollTarget(tree.value, scrollToSource.value, location => {
    const hit = firstTestLocation(location, testIndex.value)
    return hit ? { path: hit.path, line: hit.line } : null
  })
  if (target) emit('jump', target)
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
        <button class="icon-button" :disabled="!expandable" :title="expandable ? '' : '没有可展开的测试套件'" aria-label="展开全部" @click="expandAll"><ChevronsUpDown :size="iconSize.control" /></button>
        <button class="icon-button" :disabled="!expandable" :title="expandable ? '' : '没有可折叠的测试套件'" aria-label="折叠全部" @click="collapseAll"><ChevronsDownUp :size="iconSize.control" /></button>
        <button class="icon-button" :disabled="!results.size" aria-label="导出测试结果 XML" @click="exportXml"><FileDown :size="iconSize.control" /></button>
        <button class="icon-button" :disabled="!results.size" aria-label="导出测试结果到文件" @click="openExportDialog"><FileOutput :size="iconSize.control" /></button>
        <button class="icon-button" :title="`${IMPORT_TESTS_NAME}：${IMPORT_TESTS_DESCRIPTION}`" :aria-label="IMPORT_TESTS_NAME" @click="importTestsFromFile()"><FileInput :size="iconSize.control" /></button>
        <button class="icon-button" :class="{ active: autoTest.isEnabled() }" :aria-pressed="autoTest.isEnabled()"
          title="改动后延迟重跑" aria-label="自动测试" @click="toggleAutoTest"><RefreshCw :size="iconSize.control" /></button>
        <button class="icon-button" aria-label="重新发现测试" @click="refreshProject"><RefreshCw :size="iconSize.control" /></button>
        <button class="icon-button" :disabled="!tests.length" title="按 git 本地更改" :aria-label="FIND_AFFECTED_TESTS_TEXT" @click="selectAffectedTests"><GitBranch :size="iconSize.control" /></button>
      </div>
    </div>
    <div class="testrun-toolbar">
      <button class="subtle-button" :disabled="running || !visibleTests.length" @click="runAll"><Play aria-hidden="true" :size="iconSize.menu" />全部</button>
      <button class="subtle-button" :disabled="running || !selectedRows.length" title="只跑勾选的测试" @click="runSelected"><Play aria-hidden="true" :size="iconSize.menu" />所选</button>
      <button class="subtle-button" :disabled="running || !rerunNames.length"
        :title="rerunFilter.includeNonStarted ? '重跑失败的、没跑完的与没跑起来的' : '只重跑失败的测试'" @click="rerunFailed"><RotateCcw aria-hidden="true" :size="iconSize.menu" />失败 ({{ rerunNames.length }})</button>
      <button class="icon-button" :disabled="!failed.size" :aria-label="PREVIOUS_FAILED_TEST_NAME" @click="stepFailure(-1)"><ChevronUp :size="iconSize.control" /></button>
      <button class="icon-button" :disabled="!failed.size" :aria-label="NEXT_FAILED_TEST_NAME" @click="stepFailure(1)"><ChevronDown :size="iconSize.control" /></button>
      <!-- 显示过滤器（上游 ToolbarPanel.java:58-66 的两个 inverted 开关）。 -->
      <button class="icon-button" :class="{ active: displayFilter.showPassed }" :aria-pressed="displayFilter.showPassed"
        :title="`${SHOW_PASSED_NAME}：${SHOW_PASSED_DESCRIPTION}`" :aria-label="SHOW_PASSED_NAME" @click="displayFilter = toggleDisplayFilter(displayFilter, 'showPassed')"><CircleCheck :size="iconSize.control" /></button>
      <button class="icon-button" :class="{ active: displayFilter.showIgnored }" :aria-pressed="displayFilter.showIgnored"
        :title="`${SHOW_IGNORED_NAME}：${SHOW_IGNORED_DESCRIPTION}`" :aria-label="SHOW_IGNORED_NAME" @click="displayFilter = toggleDisplayFilter(displayFilter, 'showIgnored')"><Minus :size="iconSize.control" /></button>
      <!-- 重跑集的那条属性开关（上游 `JUnitConsoleProperties.java:50` 把它加进 gear 组，
           文案 `ExecutionBundle.properties:157`；本仓的工具栏是平铺的，与既有的显示过滤器同排）。 -->
      <button class="icon-button" :class="{ active: rerunFilter.includeNonStarted }" :aria-pressed="rerunFilter.includeNonStarted"
        :aria-label="INCLUDE_NON_STARTED_NAME" @click="toggleRerunFilter"><ListChecks :size="iconSize.control" /></button>
      <!-- Open Source at Exception（上游 `ToolbarPanel.java:187-189` 的 gear 组开关，
           文案 `ExecutionBundle.properties:166-167`）：开着时失败节点的跳转落到抛异常那一行。 -->
      <button class="icon-button" :class="{ active: openFailureLine }" :aria-pressed="openFailureLine"
        :title="`${OPEN_FAILURE_LINE_NAME}：${OPEN_FAILURE_LINE_DESCRIPTION}`" :aria-label="OPEN_FAILURE_LINE_NAME" @click="openFailureLine = !openFailureLine"><Crosshair :size="iconSize.control" /></button>
      <!-- 排序（上游 ToolbarPanel.java:82-114 的 sortGroup：字母 / 声明顺序 / 耗时 三选一 + 套件置顶）。
           上游新 UI 把这组收进「Sorting Options」弹层（ExecutionBundle.properties:144），本面板沿用自己的
           平铺开关形状（与既有的显示过滤器、跟踪开关同一排）。 -->
      <button class="icon-button" :class="{ active: sortOptions.sortAlphabetically }" :aria-pressed="sortOptions.sortAlphabetically"
        :title="`${SORT_ALPHABETICALLY_NAME}：${SORT_ALPHABETICALLY_DESCRIPTION}`" :aria-label="SORT_ALPHABETICALLY_NAME" @click="chooseSort('alphabetically')"><ArrowDownAZ :size="iconSize.control" /></button>
      <button class="icon-button" :class="{ active: sortOptions.sortByDeclarationOrder }" :aria-pressed="sortOptions.sortByDeclarationOrder"
        :title="`${SORT_BY_DECLARATION_ORDER_NAME}：${SORT_BY_DECLARATION_ORDER_DESCRIPTION}`" :aria-label="SORT_BY_DECLARATION_ORDER_NAME" @click="chooseSort('declaration')"><ListOrdered :size="iconSize.control" /></button>
      <button class="icon-button" :class="{ active: sortOptions.sortByDuration }" :aria-pressed="sortOptions.sortByDuration"
        :title="`${SORT_BY_DURATION_NAME}：${SORT_BY_DURATION_DESCRIPTION}`" :aria-label="SORT_BY_DURATION_NAME" @click="chooseSort('duration')"><Timer :size="iconSize.control" /></button>
      <button class="icon-button" :class="{ active: sortOptions.suitesAlwaysOnTop }" :aria-pressed="sortOptions.suitesAlwaysOnTop"
        :title="`${SUITES_ALWAYS_ON_TOP_NAME}：${SUITES_ALWAYS_ON_TOP_DESCRIPTION}`" :aria-label="SUITES_ALWAYS_ON_TOP_NAME"
        @click="sortOptions = { ...sortOptions, suitesAlwaysOnTop: !sortOptions.suitesAlwaysOnTop }"><FolderUp :size="iconSize.control" /></button>
      <!-- 跟随运行中的测试（上游 ToolbarPanel.java:162-164 的 Track Running Test /
           ScrollToTestSourceAction.java:28-29 的 Navigate with Single Click，
           以及开着跟踪时才可见的 ScrollToRunningTestAction）。 -->
      <button class="icon-button" :class="{ active: trackRunning }" :aria-pressed="trackRunning"
        :title="`${TRACK_RUNNING_TEST_NAME}：${TRACK_RUNNING_TEST_DESCRIPTION}`" :aria-label="TRACK_RUNNING_TEST_NAME" @click="trackRunning = !trackRunning"><Eye :size="iconSize.control" /></button>
      <!-- 行内统计：节点名右侧的耗时（上游 ToolbarPanel.java:165-167 的 SHOW_INLINE_STATISTICS，默认开）。 -->
      <button class="icon-button" :class="{ active: showInlineStatistics }" :aria-pressed="showInlineStatistics"
        :title="`${SHOW_INLINE_STATISTICS_NAME}：${SHOW_INLINE_STATISTICS_DESCRIPTION}`" :aria-label="SHOW_INLINE_STATISTICS_NAME" @click="showInlineStatistics = !showInlineStatistics"><Clock :size="iconSize.control" /></button>
      <button class="icon-button" :class="{ active: scrollToSource }" :aria-pressed="scrollToSource"
        :title="`${NAVIGATE_WITH_SINGLE_CLICK_NAME}：${NAVIGATE_WITH_SINGLE_CLICK_DESCRIPTION}`" :aria-label="NAVIGATE_WITH_SINGLE_CLICK_NAME" @click="scrollToSource = !scrollToSource"><FileCode2 :size="iconSize.control" /></button>
      <button v-if="trackRunning" class="icon-button" :disabled="!runningNode"
        :title="`${SCROLL_TO_RUNNING_TEST_NAME}：${SCROLL_TO_RUNNING_TEST_DESCRIPTION}`" :aria-label="SCROLL_TO_RUNNING_TEST_NAME" @click="scrollToRunningTest"><LocateFixed :size="iconSize.control" /></button>
    </div>
    <!-- 测试历史（上游 ImportTestsGroup.java:24-31 的弹层：最近导入的会话，新的在前）。 -->
    <div v-if="importedHistory.length || importedFailures.length" class="testrun-history" role="group" :aria-label="IMPORT_HISTORY_GROUP_NAME">
      <span class="testrun-history-head">{{ IMPORT_HISTORY_GROUP_NAME }}</span>
      <button v-for="entry in importedHistory" :key="entry" class="testrun-history-item"
        :title="`重新导入 ${entry}`" @click="importTestsFromFile(entry)">{{ historyPresentableText(entry) }}</button>
      <!-- 导入会话里失败的用例照样能重跑（上游 ImportedTestRunnableState 给导入结果挂 rerun action）。 -->
      <button v-if="importedFailures.length" class="subtle-button" :disabled="running" :title="`重跑导入会话里失败的 ${importedFailures.length} 个用例`" @click="rerunImportedFailures"><RotateCcw aria-hidden="true" :size="iconSize.menu" />重跑导入的失败 ({{ importedFailures.length }})</button>
    </div>
    <!-- 运行范围：模式（TestsPattern）与 tag（TestTags）。填了就只跑范围内的。 -->
    <div class="testrun-scope">
      <label class="testrun-field"><Search :size="iconSize.menu" aria-hidden="true" /><input v-model="patternText"
        placeholder="模式：com.foo.MathTest 或 MathTest,adds" aria-label="测试模式" /></label>
      <!-- 包 / 目录范围（上游 AbstractAllInPackageConfigurationProducer / AbstractAllInDirectoryConfigurationProducer）。 -->
      <label class="testrun-field"><FolderTree :size="iconSize.menu" aria-hidden="true" /><input v-model="scopeText"
        placeholder="包 com.foo 或目录 src/test/java" aria-label="包或目录范围" /></label>
      <label class="testrun-field"><Tags :size="iconSize.menu" aria-hidden="true" /><input v-model="tagText"
        placeholder="tag：fast &amp; !slow" aria-label="测试 tag" /></label>
    </div>
    <p v-if="patternProblem || tagExpression.error" class="testrun-error">{{ patternProblem ?? tagExpression.error }}</p>
    <p v-else-if="scopeSelector || tagHint" class="testrun-scope-note">运行范围：<code>{{ scopeSelector || tagHint }}</code></p>
    <!-- 失败详情：断言视图（预期/实际并排）+ 过滤器给出的可点链接。 -->
    <div v-if="failureView" class="testrun-assert" role="region" :aria-label="`失败详情：${failureView.name}`">
      <p class="testrun-assert-head"><CircleX :size="iconSize.menu" aria-hidden="true" />{{ failureView.name }}</p>
      <div v-if="failureView.view.expected !== null || failureView.view.actual !== null" class="testrun-assert-panes">
        <div class="testrun-assert-pane"><span>预期</span><pre>{{ failureView.view.expected ?? '（未给出）' }}</pre></div>
        <div class="testrun-assert-pane"><span>实际</span><pre>{{ failureView.view.actual ?? '（未给出）' }}</pre></div>
      </div>
      <pre v-if="detailSegments.length" class="testrun-assert-text"><template v-for="(segment, index) in detailSegments" :key="index"><span v-if="segment.kind !== 'link'" :class="{ 'testrun-exception': segment.kind === 'exception' }">{{ segment.text }}</span><button
        v-else-if="segment.link.kind === 'rerun'" class="testrun-link" :title="`带上 ${segment.link.option} 重新运行`"
        @click="rerunWithOption(segment.link.option)">{{ segment.text }}</button><button
        v-else-if="segment.link.kind === 'file'" class="testrun-link" :title="`跳到 ${segment.link.path}:${segment.link.line}`"
        @click="jumpDetailLink(segment.link)">{{ segment.text }}</button></template></pre>
      <pre v-else class="testrun-assert-text">{{ failureView.view.text || '（没有更多输出）' }}</pre>
    </div>
    <p v-if="error" class="testrun-error">{{ error }}</p>
    <p v-else-if="note" class="testrun-note">{{ note }}</p>
    <!-- 结果树：suite 可折叠，测试行给源码位置、参数化用例与通过/失败/跳过记号。 -->
    <div ref="listRef" class="testrun-list" role="tree" :aria-label="'测试结果'">
      <p v-if="!shownTree.length && !pendingTests.length" class="testrun-empty">当前文件与根目录没有发现测试（支持 ctest / node:test / JUnit）。</p>
      <template v-for="node in shownTree" :key="node.id">
        <div class="testrun-row" role="treeitem" :data-node-id="node.id" :aria-expanded="node.kind === 'suite' ? isExpanded(node) : undefined"
          :class="[node.kind, { selected: selectedNodeId === node.id }]" :style="{ paddingLeft: `${node.depth * 12 + 4}px` }"
          @dblclick="jump(node)">
          <button v-if="node.kind === 'suite'" class="testrun-chevron" :aria-label="isExpanded(node) ? `折叠 ${node.name}` : `展开 ${node.name}`"
            :title="isExpanded(node) ? `折叠 ${node.name}` : `展开 ${node.name}`"
            @click="toggleNode(node)"><ChevronDown v-if="isExpanded(node)" :size="iconSize.dense" aria-hidden="true" /><ChevronRight v-else :size="iconSize.dense" aria-hidden="true" /></button>
          <input v-else type="checkbox" :checked="selected.has(node.id)" :aria-label="`选择 ${node.name}`" @change="toggle(node.id)" />
          <button class="testrun-name" :title="sourceOf(node)?.path ? `${sourceOf(node)!.path}:${sourceOf(node)!.line}` : node.path" @click="selectNode(node)">{{ node.name }}</button>
          <span v-if="node.kind === 'suite'" class="testrun-meta">{{ node.counts.passed }}/{{ node.counts.total }}</span>
          <!-- 行内统计（上游 TestTreeRenderer.java:79-87 把 getDurationString 画在名字右侧）。
               文本与 tooltip 走 src/testTree.ts 的呈现档：跑完的 suite 画 wall time、还在跑的画已到整秒的
               实时时长、其余画自己的时长/孩子之和（JavaSMTRunnerTestTreeView.java:56-86）；
               「Overall time / Sum time」两行只有行右半侧才有（同文件 :133-147 ⇒ 本仓挂在右侧那一格的 title 上）。
               本仓的 durationMs 是 number（没有时长就是 0），0 不显示 —— 免得报一个假的「0 ms」。 -->
          <span v-if="showInlineStatistics && durationOf(node)" class="testrun-meta" :title="durationHint(node)">{{ durationOf(node) }}</span>
          <span v-if="node.running" class="testrun-meta">运行中</span>
          <span class="testrun-outcome" :class="node.outcome"><CircleCheck v-if="node.outcome === 'passed'" :size="iconSize.menu" aria-hidden="true" /><CircleX v-else-if="node.outcome === 'failed'" :size="iconSize.menu" aria-hidden="true" /><Minus v-else-if="node.outcome === 'skipped'" :size="iconSize.menu" aria-hidden="true" /></span>
        </div>
        <div v-if="node.kind === 'test' && isExpanded(node) && parametersOf(node).length" class="testrun-params" role="group" :aria-label="`${node.name} 的参数化用例`">
          <span v-for="parameter in parametersOf(node)" :key="parameter.displayName" class="testrun-param">{{ parameter.displayName }}</span>
        </div>
      </template>
      <div v-for="row in pendingTests" :key="row.id" class="testrun-row" role="treeitem" :style="{ paddingLeft: '4px' }">
        <input type="checkbox" :checked="selected.has(row.id)" :aria-label="`选择 ${row.name}`" @change="toggle(row.id)" />
        <button class="testrun-name" :title="`${row.path}:${row.line}`" @click="jump({ ...row, kind: 'test', depth: 0, path: row.name, parent: null, children: [], outcome: null, counts: { passed: 0, failed: 0, skipped: 0, total: 0 }, durationMs: 0, location: `${row.path}:${row.line}`, running: false, startTimeMillis: null, endTimeMillis: null })">{{ row.name }}</button>
        <span class="testrun-meta">{{ row.framework }}</span>
        <span class="testrun-outcome"></span>
      </div>
    </div>
    <TestResultsExportDialog v-if="exportOpen" :settings="exportSettings" :run-name="lastBase || '测试'"
      :picked-directory="exportPicked" :busy="exportBusy"
      @save="saveExport" @browse="browseExportFolder" @close="exportOpen = false" />
  </div>
</template>

<style scoped>
.testrun-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; background: var(--panel); }
.testrun-panel > .panel-heading { background: var(--panel); border-bottom-color: var(--line-strong); }
.testrun-panel .heading-count { color: var(--secondary); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.testrun-toolbar { display: flex; flex-wrap: wrap; gap: var(--space-1); align-items: center; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line-strong); background: var(--rail); }
.testrun-history { display: flex; flex-wrap: wrap; gap: var(--space-1); align-items: center; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); background: var(--panel); }
/* 开关型的图标按钮（自动测试 / 跟随运行中测试 / 单击导航源码）要有视觉的按下态，
   否则只剩 aria-pressed 读得到。全局 .icon-button 没有 .active 规则。 */
.testrun-panel .icon-button.active { background: var(--accent-soft); color: var(--accent); }
.testrun-history-head { color: var(--secondary); font-size: 11px; font-weight: 600; }
.testrun-history-item { max-width: 100%; overflow: hidden; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-xs); background: transparent; color: var(--text); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.testrun-history-item:hover { border-color: var(--line-strong); background: var(--hover); }
.testrun-scope { display: flex; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line-strong); background: var(--panel); }
.testrun-field { display: flex; align-items: center; gap: var(--space-1); flex: 1; min-width: 0; color: var(--muted); }
.testrun-field input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--text); font: 12px/1.5 var(--font-ui); }
.testrun-field input:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.testrun-scope-note, .testrun-note { margin: 0; padding: var(--space-1) var(--space-3); border-left: 2px solid var(--accent); background: var(--panel); color: var(--secondary); font-size: 11px; overflow-wrap: anywhere; }
.testrun-scope-note code { font-family: var(--font-mono); color: var(--text); }
.testrun-error { margin: 0; padding: var(--space-2) var(--space-3); border-left: 2px solid var(--error); background: var(--error-bg); color: var(--error); font-size: 12px; overflow-wrap: anywhere; }
.testrun-list { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding-bottom: var(--space-2); border-top: 1px solid var(--line-strong); background: var(--editor); }
.testrun-row { display: flex; align-items: center; gap: var(--space-2); min-height: var(--ctrl-height-sm); padding-top: var(--space-1); padding-right: var(--space-3); padding-bottom: var(--space-1); font-size: 12px; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.testrun-row:hover { background: var(--hover); }
.testrun-row.selected { background: var(--selected); box-shadow: inset 2px 0 0 var(--accent); }
.testrun-row.suite { border-bottom: 1px solid var(--line-strong); background: var(--panel); color: var(--bright); font-weight: 650; }
.testrun-row.suite:hover { background: var(--hover); }
.testrun-row.suite .testrun-meta { color: var(--secondary); font-variant-numeric: tabular-nums; }
.testrun-row input[type="checkbox"] { flex-shrink: 0; accent-color: var(--accent); }
.testrun-chevron { display: inline-flex; align-items: center; justify-content: center; width: 14px; padding: 0; flex-shrink: 0; background: none; border: 0; color: var(--muted); }
.testrun-chevron svg { flex-shrink: 0; }
/* 失败详情的断言并排（宽度不够时上下堆叠；长值横向滚动，不换行撑破面板）。 */
.testrun-assert { padding: var(--space-2) var(--space-3); border-top: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); background: var(--panel); font-size: 11px; }
.testrun-assert-head { display: flex; align-items: center; gap: var(--space-1); margin: 0 0 var(--space-2); color: var(--error); font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
.testrun-assert-panes { display: flex; gap: var(--space-2); }
.testrun-assert-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.testrun-assert-pane > span { color: var(--secondary); font-size: 11px; font-weight: 600; }
.testrun-assert-pane pre, .testrun-assert-text { margin: 0; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--editor); color: var(--text); overflow: auto; max-height: 120px; white-space: pre-wrap; word-break: break-all; font: 11px/1.6 var(--font-mono); }
.testrun-assert-text { max-height: 160px; }
.testrun-exception { color: var(--error); }
.testrun-link { padding: 0; background: none; border: 0; color: var(--accent); font-family: var(--font-mono); font-size: inherit; text-decoration: underline; cursor: pointer; }
.testrun-link:hover { color: var(--accent-hover); }
.testrun-params { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: 0 var(--space-3) 2px var(--space-5); }
.testrun-param { padding: 0 var(--space-1); border-left: 1px solid var(--line-strong); color: var(--secondary); font: 10px var(--font-mono); }
.testrun-name { flex: 1; min-width: 0; overflow: hidden; padding: 0 var(--space-1); border: 0; border-radius: var(--radius-xs); background: none; color: var(--text); font-size: 12px; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.testrun-name:hover { color: var(--accent); }
.testrun-meta { color: var(--muted); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 通过/失败/跳过的记号（第八十五批由 ✗ 文本字形换成 lucide CircleX/CircleCheck/CircleMinus）。
   槽位改成 inline-flex 居中盒，否则 svg 会按基线排在 14px 盒的下面。 */
.testrun-outcome { display: inline-flex; align-items: center; justify-content: center; width: 14px; flex-shrink: 0; }
.testrun-outcome.passed { color: var(--success); }
.testrun-outcome.failed { color: var(--error); }
.testrun-outcome.skipped { color: var(--muted); }
.testrun-empty { margin: 0; padding: var(--space-4) var(--space-3); border-left: 2px solid var(--line-strong); background: var(--panel); color: var(--secondary); font-size: 12px; line-height: 1.7; }
@media (max-width: 560px) {
  .testrun-scope { display: grid; grid-template-columns: minmax(0, 1fr); }
  .testrun-assert-panes { flex-direction: column; }
}
</style>
