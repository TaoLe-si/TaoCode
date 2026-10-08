<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, History, Search, SlidersHorizontal, X } from 'lucide-vue-next'
import { isDesktop, request, type NamedScopeSetting, type SearchOptions, type SearchPreviewMatch, type SearchPreviewResult, type SearchReplaceResult } from '../bridge'
import { scopeLookup, scopeMatches, type ScopeContext, type ScopeSet } from '../scopes'
import { iconSize } from '../uiIcons'
// 分块发布（上游 `SearchResults` 的 chunk 流）：累积与认领在 src/searchStream.ts。
import { beginSearchStream, endSearchStream, searchStream } from '../searchStream'
// 结果预览面板（上游 FindPopupPanel 里的 UsagePreviewPanel）：窗口计算与文案在 src/searchPreview.ts。
// `resultLineParts` 是结果列表那一行的行内切分（区间取自宿主报的 column/length，不重新匹配）。
import { PREVIEW_DEBOUNCE_MS, PREVIEW_SELECT_HINT, PREVIEW_TITLE, PREVIEW_UNAVAILABLE, previewHeader, previewLines, previewSegments, previewWindow, resultLineParts as lineParts } from '../searchPreview'
// 替换没做完时的交代语 + 「替换全部」那句确认（纯判定，见 src/searchReplaceOutcome.ts）。
import { incompleteNote, replaceAllConfirmNote } from '../searchReplaceOutcome.ts'
// 结果右键菜单（上游 `FindInFiles.Results.ContextMenu` → 「复制路径/引用…」那一组）。
import { COPY_REFERENCE_GROUP, FIND_COPY_ACTIONS, findResultClipboardText, type FindCopyActionId, type FindResultTarget } from '../copyPathActions'
// 结果面板键盘选择（上游 `FindPopupPanel.java:830,842-856` 的 ScrollingUtil 与 F3 两条）。
import { navTarget, RESULT_ROW_HEIGHT, resultsNavKeyOf, type ResultsNavKey } from '../findResultsNav'
// 最近搜索（上游 `FindInProjectSettingsBase`：find/replace 两张表，上限 300，最新在末尾）。
import { addRecent, formatRecents, mostRecent, parseRecents, RECENTS_STORAGE_KEY, type FindInProjectRecents } from '../findInProjectRecents'
// 作用域下拉的边界（名字失配回落「项目」、坏模式给提示）。
import { resolveScopeSelection, scopeWarningText } from '../findScopeSelection'
import EditorPopupMenu from './EditorPopupMenu.vue'
import { copyToClipboard } from '../clipboard.ts'
// 结构化搜索/替换（上游 `platform/structuralsearch` 的 PSI 模板匹配）的**文本子集**：
// 编译器在 src/structuralSearch.ts，面板侧的装配（编译 → 校验 → 折叠替换串 → 命中复核）在
// src/structuralSearchPanelModel.ts，这里只把它接进既有的搜索/替换通道（正则走原生 search.run/replace）。
import { createStructuralSearchModel } from '../structuralSearchPanelModel'
// 面板级修饰符开关的档与默认值（上游 `MatchOptions` 的 boolean 位）：规则在 src/structuralSearchModifiers.ts。
import { defaultMatcherSwitches } from '../structuralSearchModifiers.ts'
import StructuralSearchFilters from './StructuralSearchFilters.vue'
// 结构化模板的收藏/最近/内置/变量补全（上游 ConfigurationManager、ExistingTemplatesComponent、
// StructuralSearchTemplatesCompletionContributor 的文本子集）：纯规则在 src/structuralSearchConfigs.ts。
import {
  configurationName, loadRecentConfigurations, loadSavedConfigurations,
  pushRecentConfiguration, removeConfiguration, saveConfiguration, variableCompletionValues,
  type StructuralSearchConfig,
} from '../structuralSearchConfigs'
// 模板下拉的三段（内置 / 我的 / 最近）怎么拼住在 src/searchTemplateSections.ts（纯映射，可单测）。
import { templateSectionsOf, type TemplateRow } from '../searchTemplateSections.ts'
// 工程排除目录并入搜索排除（原生扫描只认面板两个过滤框 + 自带默认表，见 src/searchExclusions.ts）。
import { excludedDirsOf, mergeSearchExclude, projectExclusionPatterns } from '../searchExclusions'
import type { ProjectSettings } from '../bridge'

// `scopes` / `moduleName` 来自项目设置：IDEA 的 Find in Path 对话框带一个 ScopeChooserCombo
// （`FindPopupScopeUIImpl.java:59,137`），选中哪个作用域就只在那个范围里找。
const props = defineProps<{ root: string; active: boolean; scopes: NamedScopeSetting[]; moduleName: string }>()
const replaceInput = ref<HTMLInputElement>()
defineExpose({ focusReplace: () => replaceInput.value?.focus() })
// 工程结构里排除的目录（`ProjectSettings.excludedDirs`，编辑面在 ProjectStructurePane）：打开/切换
// 项目时读一次并折成排除模式，搜索参数拼上它 —— 原生扫描只认面板两个过滤框与自带默认表。
const projectExcludedDirs = ref<string[]>([])
watch(() => props.root, async root => {
  projectExcludedDirs.value = []
  if (!root || !isDesktop) return
  try { projectExcludedDirs.value = excludedDirsOf(await request<ProjectSettings>('project.settings.get')) }
  catch { projectExcludedDirs.value = [] }
}, { immediate: true })
// `open` jumps the editor to an occurrence; `replaced` carries the files a replace
// just rewrote, so the shell re-reads them and an open buffer stops showing old text.
const emit = defineEmits<{ open: [payload: { path: string; line: number }]; replaced: [payload: { paths: string[] }] }>()

interface Group { path: string; matches: SearchPreviewMatch[]; start: number; pending: number }

const query = ref('')
const replacement = ref('')
const include = ref('')
const exclude = ref('')
// 结构化模式读的那两个档的初始值取自上游 `MatchOptions` 的默认值（`MATCHER_SWITCHES`）：两者上游默认都是
// false —— `MatchOptions.java:58-63` 的构造器没给 `caseSensitiveMatch` 赋过值，`wholeWordsOnly` 只有 `regexw`
// 会置它（`StringToConstraintsTransformer.java:427-429`）。「正则表达式」按钮属另一族，不从这张表取。
const regex = ref(false)
const caseSensitive = ref(defaultMatcherSwitches().caseSensitive)
const wholeWord = ref(defaultMatcherSwitches().wholeWords)
// 结构化模板模式（`$Var$` 变量）：与「正则」互斥 —— 模板自己编译成正则，那个开关在打开时被清掉，
// 免得出现"看起来生效、实际被忽略"的假状态。「全词」**不清掉**：它作为整模板档的修饰符写进每个变量的
// `wholeWordsOnly`（`plugin/ui/filters/FilterPanel.java:291,339`），生效点是 `compileStructuralPattern`
// 的第二参数；宿主那一侧仍传 false，免得同一件事做两遍（宿主再包一次 `\b` 会把 `get$x$` 误杀）。
const structural = ref(false)
// 结构化模板的收藏与最近使用（上游 `ConfigurationManager`，最近上限 30）。
const savedTemplates = ref(loadSavedConfigurations())
const recentTemplates = ref(loadRecentConfigurations())
const templateOpen = ref(false)
// 模板里的 `$Var$` 变量补全候选（上游 `StructuralSearchTemplatesCompletionContributor`）：
// 用原生 datalist 挂到搜索框上（先例：DebugPanel 的 DAP 补全）。
const variableCandidates = computed(() => (structural.value ? variableCompletionValues(query.value) : []))
const templateSections = computed(() => templateSectionsOf(savedTemplates.value, recentTemplates.value))
const filtersOpen = ref(false)
// '' = 「项目」（IDEA 的默认范围，不限定）。
const scopeName = ref('')
const matches = ref<SearchPreviewMatch[]>([])
const fileCount = ref(0)
const truncated = ref(false)
const running = ref(false)
const replacing = ref(false)
const searched = ref(false)
const error = ref('')
const note = ref('')
const collapsed = reactive(new Set<string>())
// IDEA's Replace in Files ticks every occurrence by default; "skip" unticks one and
// keeps it unticked across a refresh, so a reviewed occurrence never comes back.
const selected = reactive(new Set<string>())
const skipped = reactive(new Set<string>())
const confirmAll = ref(false)
const cursor = ref(-1)
const listRef = ref<HTMLDivElement>()
// 最近搜索（上游 `FindInProjectSettingsBase`）：find / replace 两张表各 300 上限、最新在末尾；
// 打开面板时用 `getMostRecentFindString()` 预填（`FindPopupPanel.java:1237`），执行一次查找/替换后追加
// （`FindManagerImpl.changeGlobalSettings`，`:116-125`）。落盘键与 `taocode.findHistory` 同族。
const recents = reactive<FindInProjectRecents>({ finds: [], replaces: [] })
const historyOpen = ref<'find' | 'replace' | null>(null)
try {
  const loaded = parseRecents(localStorage.getItem(RECENTS_STORAGE_KEY))
  recents.finds = loaded.finds
  recents.replaces = loaded.replaces
} catch { /* 读不到就当空表 */ }
function persistRecents() {
  try { localStorage.setItem(RECENTS_STORAGE_KEY, formatRecents(recents)) } catch { /* 存不下不影响本次会话 */ }
}
function rememberRecent(kind: 'find' | 'replace', value: string) {
  const text = value.trim()
  if (!text) return
  const key = kind === 'find' ? 'finds' : 'replaces'
  recents[key] = addRecent(recents[key], text)
  persistRecents()
}
/** 下拉里的顺序：最新在最前（上游那几处 list 都是倒着填进组合框的）。 */
function recentRows(list: readonly string[]): string[] { return [...list].reverse() }
function pickRecent(kind: 'find' | 'replace', value: string) {
  historyOpen.value = null
  if (kind === 'find') query.value = value
  else replacement.value = value
}
// ── 结构化模板的收藏/最近/内置（规则在 src/structuralSearchConfigs.ts）──────────────
function currentStructuralConfig(): StructuralSearchConfig {
  return {
    name: configurationName(query.value),
    query: query.value,
    replacement: replacement.value,
    structural: structural.value,
    caseSensitive: caseSensitive.value,
    wholeWord: wholeWord.value,
    regex: regex.value,
    scope: scopeName.value,
    created: Date.now(),
  }
}
/** 应用一份模板/收藏：结构化模式打开，「正则」互斥地关掉（与 `$` 按钮同一口径）；
 *  「全词」保持用户当前状态 —— 它在结构化模式下是**真的有生效点**的那一档。 */
function applyTemplate(template: TemplateRow) {
  templateOpen.value = false
  query.value = template.query
  replacement.value = template.replacement
  structural.value = true
  regex.value = false
}
/** 保存当前模板（同名覆盖；名字默认取模板前 40 字符，可在提示框里改）。 */
function saveCurrentTemplate() {
  templateOpen.value = false
  const name = window.prompt('模板名称', configurationName(query.value))?.trim()
  if (!name) return
  savedTemplates.value = saveConfiguration({ ...currentStructuralConfig(), name })
  note.value = `已保存模板「${name}」，可从「模板」下拉里再次选用。`
}
function deleteTemplate(name: string) {
  savedTemplates.value = removeConfiguration(name)
  recentTemplates.value = loadRecentConfigurations()
}
/** 每次结构化搜索记一条最近（上游 `ConfigurationManager.addHistoryConfiguration` 在搜索时调用）。 */
function rememberStructuralSearch() {
  if (!structural.value || !query.value.trim()) return
  recentTemplates.value = pushRecentConfiguration(currentStructuralConfig())
}
// 结果右键菜单：位置 + 点在哪一条上（上游右键菜单里只有「复制路径/引用…」这一组）。
const resultMenu = ref<{ x: number; y: number; target: FindResultTarget } | null>(null)
const resultMenuRows = computed(() => [{
  id: 'copyReference',
  title: COPY_REFERENCE_GROUP,
  children: FIND_COPY_ACTIONS.map(action => ({ id: action.id, title: action.label })),
}])
function openResultMenu(event: MouseEvent, match: SearchPreviewMatch) {
  resultMenu.value = { x: event.clientX, y: event.clientY, target: { path: match.path, line: match.line } }
}
/** 选了一条复制动作：写系统剪贴板 + 进剪贴板环（`src/clipboard.ts` 的规矩）。上游这几个动作是**静默**的。 */
function pickResultMenu(row: { id: string }) {
  const menu = resultMenu.value
  resultMenu.value = null
  if (!menu) return
  void copyToClipboard(findResultClipboardText(row.id as FindCopyActionId, menu.target, props.root))
}
// 预览面板状态：`key` 是"这次预览对应哪一个命中"，用来丢掉迟到的答复（同 bridge 里那两个世代计数器）。
const preview = reactive({
  key: '',
  path: '',
  line: 1,
  total: 0,
  lines: [] as string[],
  window: previewWindow(0, 1),
  status: 'idle' as 'idle' | 'loading' | 'ready' | 'empty',
})
/** 文件内容按路径缓存：同一次搜索里走过多处命中时不重复读盘（上游那个预览编辑器也是复用的）。 */
const previewCache = new Map<string, string[]>()
let previewSeq = 0
let previewTimer: ReturnType<typeof setTimeout> | undefined
// 本次搜索的 streamId：宿主在每一块里回带它，认不回来的块丢掉（见 src/searchStream.ts）。
let streamSeq = 0
/** 流里已经收到的命中数（面板顶上的"搜索中 · 已找到 N 条"读它）。 */
const streamedCount = computed(() => (searchStream.done ? 0 : searchStream.matches.length))
/** 流式期间**边收边显示**：上面的 matches 只在最终答复时落定，这里给的是已到达的那部分。 */
const liveMatches = computed(() => {
  if (searchStream.done) return matches.value
  const live = narrow(searchStream.matches)
  return live.length ? live : matches.value
})

// NamedScopesHolder.getScope 的等价物（解析在 src/findScopeSelection.ts）：名字查不到 ⇒ 回落「项目」；
// 找到但模式解析不了 ⇒ InvalidPackageSet（按源码语义恒不匹配，宁可 0 命中也不悄悄退回"全项目"），
// 错误消息留给下面那行提示。
const scopeResolution = computed(() => resolveScopeSelection(scopeName.value, props.scopes))
const scopeSet = computed<ScopeSet | null>(() => scopeResolution.value.set)
const scopeWarning = computed(() => (scopeName.value ? scopeWarningText(scopeResolution.value) : ''))
// 作用域被删/改名后下拉不能停在旧名字上（`NamedScopesHolder.getScope` 查不到 ⇒ 空选择 = 项目）。
watch(scopeResolution, resolution => { if (resolution.name !== scopeName.value) scopeName.value = resolution.name })
const scopeContext = computed<ScopeContext>(() => ({ moduleName: props.moduleName, lookup: scopeLookup(props.scopes) }))
const busy = computed(() => running.value || replacing.value)
// 结构化模板的编译/校验/替换串折叠/命中复核全部在 src/structuralSearchPanelModel.ts。
// 编译失败就**不搜**（宁可报错，也不把 `$x$` 当成字面文本发出去 —— 那会让用户以为"没有匹配"）。
// 逐变量替换定义那张表由模型持有（`structuralModel.definitions`），编辑面在 StructuralSearchFilters。
const structuralModel = createStructuralSearchModel({ enabled: structural, template: query, replacement, caseSensitive, wholeWord, regexMode: regex })
const structuralError = computed(() => structuralModel.error.value)
const activeQuery = computed(() => structuralModel.activeQuery.value)
const activeReplacement = computed(() => structuralModel.activeReplacement.value)
const total = computed(() => matches.value.length)
const pendingCount = computed(() => matches.value.filter(pending).length)
const canSearch = computed(() => isDesktop && Boolean(props.root) && query.value.length > 0 && !structuralError.value)
const showed = computed(() => Boolean(replacement.value))

const groups = computed<Group[]>(() => {
  const ordered: Group[] = []
  const index = new Map<string, Group>()
  let offset = 0
  for (const match of liveMatches.value) {
    let group = index.get(match.path)
    if (!group) {
      group = { path: match.path, matches: [], start: offset, pending: 0 }
      index.set(match.path, group)
      ordered.push(group)
    }
    group.matches.push(match)
    ++offset
    if (pending(match)) ++group.pending
  }
  return ordered
})
const flat = computed(() => groups.value.flatMap(group => group.matches))

function keyOf(match: SearchPreviewMatch) { return `${match.path}:${match.line}:${match.column}` }
function pending(match: SearchPreviewMatch) {
  // 流式阶段还没对账（`selected` 是上一次搜索留下的），不拿它当"将替换"。
  if (!searchStream.done) return false
  return selected.has(keyOf(match)) && !skipped.has(keyOf(match))
}
function params() {
  return {
    query: activeQuery.value,
    regex: structural.value ? true : regex.value,
    caseSensitive: caseSensitive.value,
    wholeWord: structural.value ? false : wholeWord.value,
    include: include.value.trim(),
    // 工程排除目录折成的模式与用户写的排除规则并成一个字符串（原生 `parse_patterns` 按逗号/空白切）。
    exclude: mergeSearchExclude(exclude.value.trim(), projectExclusionPatterns(projectExcludedDirs.value)),
  } satisfies SearchOptions
}
function errorText(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }

// Two generation counters: a search may supersede a search, and a replace a replace,
// but a replace must never invalidate the refresh it starts afterwards. Whichever
// request loses the race drops its reply instead of overwriting fresher results.
let searchToken = 0
let replaceToken = 0
function fetchPreview() {
  // streamId 让每一块能认回是哪一次搜索（并发/被取代时尤其重要）。
  return request<SearchPreviewResult>('search.preview', { ...params(), replacement: activeReplacement.value, streamId: streamSeq })
}
// 作用域在**结果**上求值。原生扫描只吃一个 include 列表，无法同时表达
// 「作用域 ∩ 文件掩码」的交集，所以掩码走原生、作用域在这里精确过滤。
function narrow(list: SearchPreviewMatch[]): SearchPreviewMatch[] {
  // 先按 `路径:行:列` 去重并做修饰符/匹配范围的命中后复核（上游 `DuplicateFilteringResultSink`
  // + `MatchPredicate` 那两层的文本等价物），再套作用域：作用域管"哪些文件"，复核管"哪一处"。
  const verified = structuralModel.refine(list, match => ({ path: match.path, line: match.line, column: match.column, text: match.preview }))
  const scope = scopeSet.value
  if (!scope) return verified
  return verified.filter(match => scopeMatches(scope, match.path, false, scopeContext.value))
}
function applyResult(result: SearchPreviewResult) {
  endSearchStream()
  const incoming = Array.isArray(result.matches) ? result.matches : []
  matches.value = narrow(incoming)
  // 原生的 fileCount 是「整次扫描命中过的文件数」；作用域过滤之后必须自己重算，
  // 否则会把范围外的文件也算进来。
  fileCount.value = scopeSet.value ? new Set(matches.value.map(match => match.path)).size : (result.fileCount ?? 0)
  truncated.value = result.truncated === true
  // GBK 等编码现在会被尝试解码，但仍有无法识别的文件时必须明说，而不是把
  // "0 命中"当成完整答案。
  const undecodable = Math.max(0, Math.trunc((result as { skippedNonUtf8?: number }).skippedNonUtf8 ?? 0))
  if (undecodable > 0 && matches.value.length === 0) {
    note.value = `有 ${undecodable} 个文件因编码无法识别未参与搜索；结果可能不完整。`
  }
  searched.value = true
  selected.clear()
  for (const match of matches.value) if (!skipped.has(keyOf(match))) selected.add(keyOf(match))
  cursor.value = -1
  schedulePreview()
}
async function refresh() {
  rememberRecent('find', query.value)
  beginSearchStream(++streamSeq)
  const token = ++searchToken
  try {
    const result = await fetchPreview()
    if (token !== searchToken) return
    applyResult(result)
  } catch (caught) { if (token === searchToken) error.value = errorText(caught) }
}
async function runSearch() {
  if (!canSearch.value) return
  rememberRecent('find', query.value)
  rememberStructuralSearch()
  beginSearchStream(++streamSeq)
  const token = ++searchToken
  running.value = true
  error.value = ''
  note.value = ''
  confirmAll.value = false
  try {
    const result = await fetchPreview()
    if (token !== searchToken) return
    applyResult(result)
    // Focus the list so Enter / Shift+Enter walk the occurrences right away.
    await nextTick()
    listRef.value?.focus()
  } catch (caught) { if (token === searchToken) error.value = errorText(caught) }
  finally { if (token === searchToken) running.value = false }
}
// The native scan is one synchronous walk, so cancelling abandons the reply rather
// than interrupting the walk: the counter makes the in-flight result unreachable.
async function cancelSearch() {
  if (!busy.value) return
  ++searchToken
  ++replaceToken
  endSearchStream()
  running.value = false
  replacing.value = false
  note.value = '已放弃本次操作，下面仍是上一次的结果。'
  // The token above only makes the answer stale — the native walk kept reading files
  // until it hit 100k. `search.cancel` actually stops it.
  try { await request('search.cancel') }
  catch (caught) { error.value = errorText(caught) }
}
/**
 * 替换前的那道门 = 上游挂在**替换字段**上的 ValidationInfo（`FindPopupPanel.java:1547-1552`：
 * `RegExReplacementBuilder.validate(pattern, getStringToReplace())` 抛 ⇒ 动作不执行）。
 * 规则都在模型里（`src/structuralSearchPanelModel.ts` 的 `replaceGuard`），这里只负责"挡住 + 说一句"；
 * 宿主那一侧还有同一趟校验兜底（`native/search.cpp` 的 `validate_replacement`），
 * 先在这里拒是为了不让半批文件先被改写。
 */
function blockedByReplaceGuard(): boolean {
  const guard = structuralModel.replaceGuard.value
  if (!guard) return false
  error.value = guard
  return true
}
async function replaceOccurrences(list: SearchPreviewMatch[]) {
  if (!list.length || !canSearch.value || busy.value) return
  // 替换串在这个查询下畸形 ⇒ 一处都不动（模板本身的语法错由 `canSearch` 那一头挡）。
  if (blockedByReplaceGuard()) return
  rememberRecent('replace', replacement.value)
  const token = ++replaceToken
  const keys = new Set(list.map(keyOf))
  const paths = [...new Set(list.map(match => match.path))]
  replacing.value = true
  error.value = ''
  note.value = ''
  try {
    const result = await request<SearchReplaceResult>('search.replaceSelected', {
      ...params(),
      replacement: activeReplacement.value,
      matches: list.map(match => ({ path: match.path, line: match.line, column: match.column })),
    })
    if (token !== replaceToken) return
    const done = result.replacements ?? 0
    if (!done) { note.value = '没有匹配被替换（这些文件可能已被其他程序改动）。'; return }
    for (const key of keys) skipped.delete(key)
    matches.value = matches.value.filter(match => !keys.has(keyOf(match)))
    const warning = incompleteNote(result)
    note.value = `已替换 ${done} 处，涉及 ${result.files ?? 0} 个文件。`
    if (warning) error.value = warning
    emit('replaced', { paths })
    // A rewrite moves byte offsets, so the only honest follow-up is a fresh preview.
    void refresh()
  } catch (caught) { if (token === replaceToken) error.value = errorText(caught) }
  finally { if (token === replaceToken) replacing.value = false }
}
function replaceSelected() { void replaceOccurrences(matches.value.filter(pending)) }
// A replace the walk could not finish is not a success: `skippedFiles` is the number
// of ticked files the 100k-file ceiling cut off before they were ever read, so the
// old "已替换 N 处" line alone would have been a lie. 判定在 src/searchReplaceOutcome.ts。
function replaceFile(group: Group) { void replaceOccurrences(group.matches.filter(pending)) }
function replaceOne(match: SearchPreviewMatch) { void replaceOccurrences([match]) }
function skipOne(match: SearchPreviewMatch) { const key = keyOf(match); skipped.add(key); selected.delete(key) }
function toggle(match: SearchPreviewMatch) {
  const key = keyOf(match)
  if (pending(match)) { selected.delete(key); return }
  skipped.delete(key)
  selected.add(key)
}
// Disk-wide replace (IDEA's "Replace All"): this rewrites every match in the
// workspace, including ones a truncated result never showed, so it needs a confirm.
async function replaceAllOnDisk() {
  if (!canSearch.value || busy.value) return
  if (blockedByReplaceGuard()) return
  rememberRecent('replace', replacement.value)
  // 选了范围时，原生 `search.replace` 的 include 只能写一个列表，表达不了
  // 「作用域 ∩ 文件掩码」。与其冒着改写范围外文件的风险，不如明确只替换本次
  // 作用域内**已列出**的那些处 —— 用户看得见它们，而且每一处都在范围内。
  if (scopeSet.value) {
    if (!confirmAll.value) {
      confirmAll.value = true
      note.value = replaceAllConfirmNote({ listed: matches.value.length, files: fileCount.value, query: query.value, replacement: replacement.value, truncated: truncated.value, scope: scopeName.value })
      return
    }
    confirmAll.value = false
    await replaceOccurrences(matches.value)
    return
  }
  if (!confirmAll.value) {
    confirmAll.value = true
    note.value = replaceAllConfirmNote({ listed: matches.value.length, files: fileCount.value, query: query.value, replacement: replacement.value, truncated: truncated.value, scope: '' })
    return
  }
  const token = ++replaceToken
  const paths = [...new Set(matches.value.map(match => match.path))]
  replacing.value = true
  error.value = ''
  confirmAll.value = false
  try {
    const result = await request<SearchReplaceResult>('search.replace', { ...params(), replacement: activeReplacement.value })
    if (token !== replaceToken) return
    const warning = incompleteNote(result)
    note.value = `已替换 ${result.replacements ?? 0} 处，涉及 ${result.files ?? 0} 个文件。`
    if (warning) error.value = warning
    emit('replaced', { paths })
    void refresh()
  } catch (caught) { if (token === replaceToken) error.value = errorText(caught) }
  finally { if (token === replaceToken) replacing.value = false }
}
// Drop the tree but keep the query: a project switch re-runs the same search, while
// the clear button (X) empties everything.
function clearResults() {
  ++searchToken
  ++replaceToken
  matches.value = []
  fileCount.value = 0
  truncated.value = false
  searched.value = false
  running.value = false
  replacing.value = false
  error.value = ''
  note.value = ''
  confirmAll.value = false
  cursor.value = -1
  collapsed.clear()
  selected.clear()
  skipped.clear()
}
function reset() {
  clearResults()
  query.value = ''
  replacement.value = ''
  // 定义表跟着模板走：换了模板还留着旧定义，会出现"定义指向模板里不存在的变量"那种假错误。
  structuralModel.definitions.value = []
}
function toggleGroup(path: string) {
  if (collapsed.has(path)) collapsed.delete(path)
  else collapsed.add(path)
}
function openMatch(match: SearchPreviewMatch, index?: number) {
  if (index !== undefined) cursor.value = index
  emit('open', { path: match.path, line: match.line })
}
/**
 * 当前预览对象：光标所在那一条；还没走过（`cursor < 0`）时取第一条 —— 上游搜完也会选中第一行。
 */
const previewMatch = computed<SearchPreviewMatch | null>(() => {
  const list = liveMatches.value
  if (!list.length) return null
  return list[cursor.value >= 0 ? cursor.value : 0] ?? null
})
/** 载入预览内容（去抖 50ms，上游 FindPopupPanel.java:868-872）。 */
function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => { void loadPreview() }, PREVIEW_DEBOUNCE_MS)
}
async function loadPreview() {
  const match = previewMatch.value
  if (!match) {
    preview.key = ''
    preview.status = 'idle'
    return
  }
  const key = `${match.path}:${match.line}`
  if (key === preview.key && preview.status === 'ready') return
  const seq = ++previewSeq
  preview.key = key
  preview.path = match.path
  preview.line = match.line
  const cached = previewCache.get(match.path)
  if (!cached) preview.status = 'loading'
  try {
    const lines = cached ?? (await request<{ content: string }>('file.read', { path: match.path })).content.split('\n')
    if (seq !== previewSeq) return  // 迟到的答复丢掉（用户已经走到下一条了）
    previewCache.set(match.path, lines)
    if (!lines.length) { preview.status = 'empty'; preview.lines = []; return }
    preview.total = lines.length
    preview.window = previewWindow(lines.length, match.line)
    preview.lines = previewLines(lines.join('\n'), preview.window)
    preview.status = 'ready'
  } catch {
    if (seq !== previewSeq) return
    preview.status = 'empty'   // 读不到内容（文件被删/编码坏）→ 上游那句「所选条目没有预览」
    preview.lines = []
  }
}
watch(previewMatch, () => { schedulePreview() })
/**
 * 预览行的命中高亮（上游 `UsagePreviewPanel.kt:503-546` 给命中区间加 `SEARCH_RESULT_ATTRIBUTES`）；
 * 匹配语义与本次搜索**同一套**：结构化模板时 `activeQuery` 已经是编译后的正则，所以三档选项照它给。
 */
function previewSegmentsOf(text: string) {
  return previewSegments(text, activeQuery.value, {
    caseSensitive: caseSensitive.value,
    wholeWords: structural.value ? false : wholeWord.value,
    regex: structural.value ? true : regex.value,
    inSelection: false,
  })
}

// Enter / Shift+Enter 走一圈（回绕，本仓既有）；Home/End/PageUp/PageDown/Up/Down 与 F3/Shift+F3
// 照上游（`FindPopupPanel.java:830,842-856`：到端不动、翻页步长 = 可见行数 - 1），语义在
// src/findResultsNav.ts，这里只负责滚动与展开被折叠的文件。
function visibleRows(): number {
  return Math.max(1, Math.floor((listRef.value?.clientHeight ?? 0) / RESULT_ROW_HEIGHT))
}
async function moveTo(index: number) {
  const list = flat.value
  if (!list.length) return
  cursor.value = index
  collapsed.delete(list[index]!.path)
  await nextTick()
  listRef.value?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
}
async function move(delta: number) {
  const list = flat.value
  if (!list.length) return
  const next = cursor.value < 0 ? (delta > 0 ? 0 : list.length - 1) : (cursor.value + delta + list.length) % list.length
  await moveTo(next)
}
function stepResults(key: ResultsNavKey) {
  const next = navTarget(key, cursor.value, flat.value.length, visibleRows())
  if (next !== null) void moveTo(next)
}
function onPanelKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  // Inside a field Enter submits; on a row it opens that occurrence.
  if (target?.closest('input, textarea, select, button, [contenteditable]')) return
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void move(event.shiftKey ? -1 : 1); return }
  const key = resultsNavKeyOf(event)
  if (!key) return
  event.preventDefault()
  stepResults(key)
}
// 搜索框 / 替换框上的键：上游把 FindNext / FindPrevious 也注册在这两个组件与按钮上
// （`FindPopupPanel.java:842-856`），最近搜索下拉与 `SearchTextArea` 的历史同一形态（Alt+Down）。
function onFieldKeydown(event: KeyboardEvent, kind: 'find' | 'replace') {
  if (event.key === 'ArrowDown' && event.altKey) { event.preventDefault(); historyOpen.value = historyOpen.value === kind ? null : kind; return }
  if (event.key === 'Escape' && historyOpen.value) { historyOpen.value = null; return }
  if (event.key === 'F3') { event.preventDefault(); stepResults(event.shiftKey ? 'FindPrevious' : 'FindNext') }
}

watch(() => props.active, active => {
  if (!active) return
  // 打开面板预填最近一次（`FindPopupPanel.java:1237`：模型里没有查询词就用 `getMostRecentFindString()`）：
  // 只在字段为空时填，且**不**因为这次预填自动执行搜索（那是用户按 Enter 的事）。
  let prefilled = false
  if (!query.value) { const recent = mostRecent(recents.finds); if (recent) { query.value = recent; prefilled = true } }
  if (!replacement.value) { const recent = mostRecent(recents.replaces); if (recent) replacement.value = recent }
  if (prefilled) return
  if (query.value.length > 0 && !searched.value && !busy.value) void runSearch()
})
// 换范围（或作用域定义被改过）之后，已列出的结果就不再成立：重新搜一遍而不是
// 就地过滤旧结果 —— 旧结果本来就没覆盖新范围里的文件。
watch(scopeSet, () => { if (searched.value && query.value.length > 0 && !busy.value) void refresh() })
// A project switch invalidates every stored path, so drop the old tree and the
// review marks with it instead of offering to replace files of the old project.
watch(() => props.root, () => { if (searched.value || matches.value.length) clearResults() })
</script>

<template>
  <div class="fs-panel">
    <div class="fs-heading">
      <span><Search :size="iconSize.menu" />全局搜索</span>
      <div class="heading-actions">
          <button class="icon-button" aria-label="切换文件筛选" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen"><SlidersHorizontal :size="iconSize.control" /></button>
          <button class="icon-button" aria-label="清空搜索" :disabled="!query && !replacement && !total" @click="reset"><X :size="iconSize.control" /></button>
      </div>
    </div>

    <div class="fs-form">
      <div class="fs-row">
        <div class="fs-input-wrap">
          <input v-model="query" class="fs-input" type="text" placeholder="搜索全部文件" aria-label="搜索内容" spellcheck="false" :list="structural ? 'ssr-variable-completions' : undefined" @keydown.enter.prevent="runSearch" @keydown="onFieldKeydown($event, 'find')" />
          <!-- 结构化模板的变量补全候选（原生 datalist，先例：DebugPanel 的 DAP 补全）。 -->
          <datalist v-if="structural" id="ssr-variable-completions">
            <option v-for="value in variableCandidates" :key="value" :value="value" />
          </datalist>
          <!-- 最近搜索下拉（上游 `SearchTextArea` 的历史；Alt+Down 打开，`FindPopupPanel.java:1237` 的预填用同一张表）。 -->
          <button v-if="recents.finds.length" class="icon-button fs-history-toggle" type="button" aria-label="搜索历史记录" :aria-expanded="historyOpen === 'find'" @click="historyOpen = historyOpen === 'find' ? null : 'find'"><History :size="iconSize.control" /></button>
          <div v-if="historyOpen === 'find'" class="find-history" role="listbox" aria-label="搜索历史记录">
            <button v-for="row in recentRows(recents.finds)" :key="row" class="menu-button find-history-row" role="option" :aria-selected="false" @click="pickRecent('find', row)">{{ row }}</button>
          </div>
        </div>
        <div class="fs-toggles">
          <button class="fs-toggle" :class="{ on: caseSensitive }" aria-label="区分大小写" :aria-pressed="caseSensitive" @click="caseSensitive = !caseSensitive">Aa</button>
          <button class="fs-toggle" :class="{ on: regex }" aria-label="正则表达式" :aria-pressed="regex" @click="regex = !regex">.*</button>
          <button class="fs-toggle" :class="{ on: wholeWord }" aria-label="全词匹配" :aria-pressed="wholeWord" @click="wholeWord = !wholeWord">词</button>
          <!-- 结构化搜索/替换（上游 `SearchStructurallyAction`/`ReplaceStructurallyAction`）：
               本仓没有 PSI，落点是 src/structuralSearch.ts 的文本子集编译器。 -->
          <button class="fs-toggle" :class="{ on: structural }" aria-label="结构化模板" :aria-pressed="structural" @click="structural = !structural; if (structural) regex = false">$</button>
          <!-- 模板下拉（上游 ExistingTemplatesComponent 的模板树 + ConfigurationManager 的收藏）：
               内置/我的/最近三段，点一行填进搜索与替换框；「存为模板」走提示框取名。 -->
          <div class="fs-template-wrap">
            <button class="fs-toggle" :class="{ on: templateOpen }" aria-label="模板库" :aria-expanded="templateOpen" @click="templateOpen = !templateOpen">模板</button>
            <div v-if="templateOpen" class="fs-template-menu">
              <template v-for="section in templateSections" :key="section.title">
                <p class="fs-template-head"><span>{{ section.title }}</span><span class="fs-template-count">{{ section.items.length }}</span></p>
                <p v-if="!section.items.length" class="fs-template-empty">（空）</p>
                <div v-for="item in section.items" :key="`${section.title}:${item.name}`" class="fs-template-row">
                  <button class="fs-template-pick" @click="applyTemplate(item)">
                    <strong>{{ item.name }}</strong><span class="fs-template-query">{{ item.query }}</span>
                  </button>
                  <button v-if="item.saved" class="fs-template-remove" aria-label="删除模板" @click="deleteTemplate(item.name)"><X :size="iconSize.control" /></button>
                </div>
              </template>
              <button class="fs-template-save" :disabled="!query.trim()" @click="saveCurrentTemplate">存为模板…</button>
            </div>
          </div>
        </div>
        <button class="icon-button" aria-label="搜索" :disabled="!canSearch || replacing" @click="runSearch"><Search :size="iconSize.control" /></button>
      </div>
      <div v-if="filtersOpen" class="fs-filters">
        <label class="fs-filter"><span>包含</span><input v-model="include" type="text" placeholder="*.cpp 或 src/**" aria-label="仅搜索这些文件" spellcheck="false" /></label>
        <label class="fs-filter"><span>排除</span><input v-model="exclude" type="text" placeholder="build/**" aria-label="排除这些文件" spellcheck="false" /></label>
        <!-- IDEA Find in Path 的范围下拉（ScopeChooserCombo）：项目 + 命名作用域。 -->
        <label class="fs-filter"><span>范围</span><select v-model="scopeName" aria-label="搜索范围"><option value="">项目</option><option v-for="entry in scopes" :key="entry.name" :value="entry.name">{{ entry.name }}</option></select></label>
      </div>
      <div class="fs-row">
        <div class="fs-input-wrap">
          <input ref="replaceInput" v-model="replacement" class="fs-input" type="text" placeholder="替换为" aria-label="替换内容" spellcheck="false" @keydown.enter.ctrl.prevent="replaceAllOnDisk" @keydown="onFieldKeydown($event, 'replace')" />
          <button v-if="recents.replaces.length" class="icon-button fs-history-toggle" type="button" aria-label="替换历史记录" :aria-expanded="historyOpen === 'replace'" @click="historyOpen = historyOpen === 'replace' ? null : 'replace'"><History :size="iconSize.control" /></button>
          <div v-if="historyOpen === 'replace'" class="find-history" role="listbox" aria-label="替换历史记录">
            <button v-for="row in recentRows(recents.replaces)" :key="row" class="menu-button find-history-row" role="option" :aria-selected="false" @click="pickRecent('replace', row)">{{ row }}</button>
          </div>
        </div>
        <button class="fs-replace" :class="{ 'fs-confirm': confirmAll }" :disabled="!canSearch || busy" @click="replaceAllOnDisk">{{ confirmAll ? '确认全部替换' : '全部替换' }}</button>
      </div>
    </div>

    <p v-if="!isDesktop" class="fs-warn">浏览器预览不能全局搜索，请在桌面端使用。</p>
    <p v-else-if="!root" class="fs-warn">尚未打开项目。</p>
    <!-- 修饰符面板（上游 `plugin/ui/filters/FilterPanel`+`FilterTable` 的文本层等价物）：
         模板编不动时不画（错误已经摆在下一行，别再叠一层能改却改不出结果的控件）。 -->
    <StructuralSearchFilters v-if="structural && !structuralError" :template="query" :scope="structuralModel.scope.value" :definitions="structuralModel.definitions.value" :replaceable="Boolean(replacement)" @update:template="query = $event" @update:scope="structuralModel.scope.value = $event" @update:definitions="structuralModel.definitions.value = $event" />
    <p v-if="structuralError" class="fs-error">{{ structuralError }}</p>
    <!-- 命中后复核的口径要说清：被修饰符/匹配范围剔除的是哪些、有多少是复核不上（宿主与 JS 文法差异）。 -->
    <p v-if="structuralModel.note.value" class="fs-note">{{ structuralModel.note.value }}</p>
    <!-- 作用域模式的边界（上游 InvalidPackageSet 的等价物）：坏模式要明说为什么是 0 命中。 -->
    <p v-if="scopeWarning" class="fs-warn">{{ scopeWarning }}</p>
    <p v-if="error" class="fs-error">{{ error }}</p>
    <p v-if="note" class="fs-note">{{ note }}</p>
    <div v-if="searched || running" class="fs-status">
      <!-- 搜索中就把**已经到达的那几块**报出来（上游 `SearchResults` 的 publish：慢搜索也能先看到命中）。 -->
      <span>{{ replacing ? '正在替换…' : running ? `正在搜索…已找到 ${streamedCount} 条 / ${searchStream.fileCount} 个文件` : `共 ${total} 处 / ${fileCount} 个文件` }}{{ !busy && pendingCount !== total ? `，已选中 ${pendingCount} 处` : '' }}{{ scopeName ? `，范围：${scopeName}` : '' }}</span>
      <span class="fs-status-right">
        <span v-if="truncated" class="fs-truncated" title="结果已截断，替换只覆盖列出的匹配">结果已截断</span>
        <button v-if="busy" class="fs-cancel" @click="cancelSearch">取消</button>
      </span>
    </div>
    <div v-if="searched && total" class="fs-actions">
      <button class="fs-action" :disabled="!pendingCount || busy" @click="replaceSelected">替换选中（{{ pendingCount }}）</button>
    </div>

    <div ref="listRef" class="fs-scroll" tabindex="-1" aria-label="搜索结果" @keydown="onPanelKeydown">
      <!-- 空态看的是**已到达的**命中数，不是最终总数：否则流式期间这一支赢，块到了也画不出来。 -->
      <div v-if="running && !liveMatches.length" class="fs-empty">正在搜索…</div>
      <template v-else-if="groups.length">
        <section v-for="group in groups" :key="group.path" class="fs-group">
          <div class="fs-group-head">
            <button class="fs-file" :aria-expanded="!collapsed.has(group.path)" :title="group.path" @click="toggleGroup(group.path)">
              <ChevronRight aria-hidden="true" v-if="collapsed.has(group.path)" :size="iconSize.menu" />
              <ChevronDown aria-hidden="true" v-else :size="iconSize.menu" />
              <span class="fs-file-path">{{ group.path }}</span>
              <span class="fs-file-count">{{ group.matches.length }}</span>
            </button>
            <button class="fs-file-replace" :disabled="!group.pending || busy" :title="`替换 ${group.path} 中已勾选的 ${group.pending} 处`" @click="replaceFile(group)">替换本文件</button>
          </div>
          <div v-if="!collapsed.has(group.path)" class="fs-matches">
            <div
              v-for="(match, index) in group.matches" :key="keyOf(match)" class="fs-match"
              :class="{ current: group.start + index === cursor, skipped: skipped.has(keyOf(match)) }"
              :data-index="group.start + index"
              @contextmenu.prevent="openResultMenu($event, match)"
            >
              <div class="fs-match-main">
                <input class="fs-check" type="checkbox" :checked="pending(match)" :disabled="busy" :aria-label="`替换 ${group.path} 第 ${match.line} 行第 ${match.column} 列`" @change="toggle(match)" />
                <button class="fs-match-line" :title="`${group.path}:${match.line}:${match.column}`" @click="openMatch(match, group.start + index)">
                  <span class="fs-pos">{{ match.line }}:{{ match.column }}</span>
                  <span class="fs-line"><span v-for="(part, partIndex) in lineParts(match.preview, match.column, match.length)" :key="partIndex" :class="{ 'fs-hit': part.hit }">{{ part.text }}</span></span>
                </button>
                <div class="fs-match-actions">
                  <button class="fs-mini" :disabled="busy" @click="replaceOne(match)">替换</button>
                  <button class="fs-mini" :disabled="busy" @click="skipOne(match)">跳过</button>
                </div>
              </div>
              <div v-if="showed && match.after !== match.preview" class="fs-after">
                <span class="fs-after-mark" aria-hidden="true">→</span>
                <span class="fs-line">{{ match.after }}</span>
              </div>
            </div>
          </div>
        </section>
      </template>
      <div v-else-if="searched" class="fs-empty">没有匹配的结果。</div>
      <div v-else class="fs-empty"></div>
    </div>

    <!-- 预览面板（上游 `FindPopupPanel` 的 `UsagePreviewPanel` + `myUsagePreviewTitle`）：
         标题是"文件名 + 行位置"，正文是命中行上下若干行，命中行与行内命中都高亮
         （行内高亮 = `UsagePreviewPanel.kt:503-546` 的 EXACT_RANGE 标记，见 `previewSegments`）。 -->
    <div class="fs-preview" role="region" :aria-label="PREVIEW_TITLE" :data-preview-status="preview.status">
      <div class="fs-preview-head">
        <span class="fs-preview-title">{{ PREVIEW_TITLE }}</span>
        <template v-if="preview.status === 'ready'">
          <span class="fs-preview-name" :title="preview.path">{{ previewHeader(preview.path, preview.line, preview.total).name }}</span>
          <span class="fs-preview-detail">{{ previewHeader(preview.path, preview.line, preview.total).detail }}<template v-if="preview.window.truncated">（已省略窗口外的内容）</template></span>
        </template>
      </div>
      <div class="fs-preview-body">
        <p v-if="preview.status === 'idle'" class="fs-empty">{{ PREVIEW_SELECT_HINT }}</p>
        <p v-else-if="preview.status === 'loading'" class="fs-empty">正在载入预览…</p>
        <p v-else-if="preview.status === 'empty'" class="fs-empty">{{ PREVIEW_UNAVAILABLE }}</p>
        <pre v-else class="fs-preview-text"><span
          v-for="(text, index) in preview.lines" :key="index"
          class="fs-preview-line" :class="{ current: index === preview.window.matchIndex }"
        ><template v-for="(segment, at) in previewSegmentsOf(text)" :key="at"><mark v-if="segment.hit" class="fs-preview-hit">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></span></pre>
      </div>
    </div>

    <!-- 结果右键菜单（上游 `FindInFiles.Results.ContextMenu`）。渲染复用编辑器那张浮层：
         它的文件头写的就是"只负责渲染"，行数据与执行都在这边（`src/findResultActions.ts`）。
         **外面那层 `.tree-menu-backdrop` 是必需的**（与 App.vue 里每一张同类菜单一样）：
         浮层自己是 `z-index: auto`，没有这层 40 号背景时会**被别的浮层背景盖住**——
         真机取证时正是这样：菜单画出来了，但鼠标点到的是盖在它上面的另一个浮层的背景，
         `elementFromPoint` 返回的是结果列里的一个 span（合成 click 却能生效，所以第一轮没看出来）。 -->
    <div v-if="resultMenu" class="tree-menu-backdrop" @pointerdown="resultMenu = null" @contextmenu.prevent="resultMenu = null">
      <EditorPopupMenu
        :rows="resultMenuRows" :x="resultMenu.x" :y="resultMenu.y" label="复制路径/引用"
        @pick="pickResultMenu" @close="resultMenu = null"
      />
    </div>
  </div>
</template>

<style scoped>
/* 停靠区被压矮时（真机取证：底部停靠 147px）整个面板改为可滚动 —— 否则结果区会被挤成一条缝。 */
.fs-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: auto; background: var(--editor); color: var(--text); }
/* 预览面板贴在结果列表下面（上游是一个 0.33 的 splitter，比例可拖；本仓先给固定高度，
   15 行上下 —— `UsagePreviewPanel` 那边的最小高度也是 15 行）。 */
.fs-preview { flex: 0 0 auto; display: flex; flex-direction: column; min-height: 96px; max-height: 40%; border-top: 1px solid var(--line-strong); background: var(--panel); }
.fs-preview-head { display: flex; align-items: center; gap: var(--space-2); min-width: 0; min-height: var(--panel-heading-h); padding: 0 var(--space-3); border-bottom: 1px solid var(--line-strong); background: var(--rail); font-size: 11px; }
.fs-preview-title { flex-shrink: 0; color: var(--secondary); font-weight: 600; }
.fs-preview-name { min-width: 0; overflow: hidden; color: var(--bright); font: 11px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.fs-preview-detail { flex-shrink: 0; margin-left: auto; color: var(--muted); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; }
.fs-preview-body { flex: 1 1 auto; min-height: 90px; overflow: auto; background: var(--editor); }
.fs-preview-text { margin: 0; padding: 0 var(--space-3) var(--space-2); background: var(--editor); font: 12px/1.6 var(--font-mono); color: var(--text); white-space: pre; }
.fs-preview-line { display: block; }
.fs-preview-line.current { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); color: var(--bright); }
/* 行内命中（上游给命中区间加 SEARCH_RESULT_ATTRIBUTES）：`<mark>` 的浏览器默认底色要盖掉，
   底色取"选中"档，与整行的 current 档分开，两层同时出现时也读得出命中在哪一段。 */
.fs-preview-hit { background: var(--selected); color: var(--bright); border-bottom: 1px solid var(--accent); }
.fs-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); height: var(--panel-heading-h); min-height: var(--panel-heading-h); padding: 0 var(--space-1) 0 var(--space-3); border-bottom: 1px solid var(--line-strong); background: var(--panel); color: var(--bright); font-size: 11px; font-weight: 600; }
.fs-heading > span { display: inline-flex; align-items: center; gap: var(--space-2); }
.fs-heading > span > svg { flex-shrink: 0; color: var(--muted); }
.fs-form { display: flex; flex-direction: column; gap: var(--space-2); flex-shrink: 0; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line-strong); background: var(--rail); }
.fs-row { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
/* 最近搜索下拉：浮层样式复用全局 `.find-history`（src/style.css:506），这一层只负责定位。 */
.fs-input-wrap { position: relative; display: flex; align-items: center; flex: 1; min-width: 0; }
.fs-input-wrap .fs-input { flex: 1; }
.fs-history-toggle { flex-shrink: 0; margin-left: 2px; }
.fs-input { flex: 1; min-width: 0; min-height: var(--ctrl-height); padding: 3px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px/1.5 var(--font-mono); }
.fs-input::placeholder { color: var(--muted); font-family: var(--font-ui); }
.fs-input:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.fs-input-wrap :deep(.find-history) { top: calc(var(--ctrl-height) + 2px); }
.fs-toggles { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.fs-toggle { width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); padding: 0; border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--muted); font: 11px/1 var(--font-mono); }
.fs-toggle:hover { background: var(--hover); color: var(--bright); }
.fs-toggle.on { color: var(--accent); background: var(--accent-soft); border-color: var(--accent); }
.fs-toggle:focus-visible, .fs-history-toggle:focus-visible, .fs-template-pick:focus-visible, .fs-template-remove:focus-visible, .fs-template-save:focus-visible, .fs-replace:focus-visible, .fs-filter input:focus-visible, .fs-filter select:focus-visible, .fs-file:focus-visible, .fs-file-replace:focus-visible, .fs-cancel:focus-visible, .fs-action:focus-visible, .fs-match-line:focus-visible, .fs-mini:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
/* 模板库下拉（内置 / 我的 / 最近）：浮层挂在「模板」按钮下方，样式与最近搜索下拉同族。 */
.fs-template-wrap { position: relative; }
.fs-template-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 40; width: 280px; max-height: 320px; overflow: auto; padding: var(--space-1) 0; background: var(--elevated); color: var(--popup-foreground); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--popup-shadow); }
.fs-template-head { display: flex; justify-content: space-between; margin: 0; padding: var(--space-2) var(--space-2) var(--space-1); border-top: 1px solid var(--line); color: var(--secondary); font-size: 10px; font-weight: 600; }
.fs-template-count { color: var(--muted); }
.fs-template-empty { margin: 0; padding: 0 var(--space-2) var(--space-1); color: var(--muted); font-size: 11px; }
.fs-template-row { display: flex; align-items: center; }
.fs-template-pick { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; flex: 1; min-width: 0; min-height: var(--menu-row-height); padding: var(--space-1) var(--space-2); border: 0; background: transparent; color: var(--text); text-align: left; font-size: 12px; }
.fs-template-pick:hover { background: var(--hover); }
.fs-template-pick strong { color: var(--bright); font-weight: 600; }
.fs-template-query { max-width: 100%; color: var(--muted); font-family: var(--font-mono); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-template-remove { flex-shrink: 0; padding: 0 var(--space-1); border: 0; background: transparent; color: var(--muted); font-size: 12px; }
.fs-template-remove:hover { color: var(--error); }
.fs-template-save { display: block; width: calc(100% - var(--space-2) * 2); min-height: var(--ctrl-height-sm); margin: var(--space-1) var(--space-2) 0; padding: 0 var(--space-2); color: var(--accent); background: transparent; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 11px; }
.fs-template-save:disabled { color: var(--muted); opacity: .55; }
.fs-replace { flex-shrink: 0; min-height: var(--ctrl-height); padding: 0 var(--space-2); color: var(--secondary); background: var(--panel); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 11px; }
.fs-replace:hover:not(:disabled) { background: var(--hover); color: var(--bright); }
.fs-replace:disabled { color: var(--muted); opacity: .55; }
.fs-replace.fs-confirm { color: var(--on-accent); background: var(--error); border-color: var(--error); }
.fs-replace.fs-confirm:hover:not(:disabled) { color: var(--on-accent); background: var(--error); border-color: var(--error); }
.fs-filters { display: flex; flex-direction: column; gap: var(--space-1); }
.fs-filter { display: flex; align-items: center; gap: var(--space-2); min-width: 0; font-size: 11px; color: var(--secondary); }
.fs-filter > span { flex-shrink: 0; width: 28px; }
.fs-filter input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-xs); font: 11px/1.5 var(--font-mono); }
.fs-filter input::placeholder { color: var(--muted); font-family: var(--font-ui); }
.fs-warn, .fs-error, .fs-note { margin: 0; padding: var(--space-2) var(--space-3); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.fs-warn { border-left: 2px solid var(--warning); color: var(--warning); background: var(--warning-bg); }
.fs-error { border-left: 2px solid var(--error); color: var(--error); background: var(--error-bg); }
.fs-note { border-left: 2px solid var(--accent); color: var(--secondary); background: var(--accent-soft); }
.fs-status { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-shrink: 0; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line-strong); background: var(--panel); color: var(--secondary); font-size: 11px; }
.fs-status-right { display: inline-flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
.fs-truncated { color: var(--error); }
.fs-cancel { min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); color: var(--secondary); background: transparent; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 11px; }
.fs-cancel:hover { background: var(--hover); color: var(--bright); }
.fs-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); flex-shrink: 0; padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line-strong); background: var(--panel); }
.fs-action { min-height: var(--ctrl-height-sm); padding: 0 var(--space-2); color: var(--secondary); background: var(--elevated); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 11px; }
.fs-action:hover:not(:disabled) { background: var(--hover); color: var(--bright); }
.fs-action:disabled { color: var(--muted); opacity: .55; }
/* 结果区保底高度（真机量到过 8px：内容 58 万像素高、列表只有一条缝）—— 面板放不下时
   由 .fs-panel 滚动，而不是把列表压没（上游的 Find 工具窗也是结果区占满剩余高度）。 */
.fs-scroll { flex: 1 1 auto; min-height: 96px; overflow: auto; padding-bottom: var(--space-2); }
.fs-scroll:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.fs-empty { margin: var(--space-2) var(--space-3); padding: var(--space-2) var(--space-3); border-left: 2px solid var(--line-strong); color: var(--secondary); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.fs-scroll > .fs-empty:empty { display: none; }
.fs-preview-body > .fs-empty { margin: 0; padding: var(--space-3); border-left: 0; color: var(--muted); }
.fs-group { min-width: 0; }
.fs-group-head { display: flex; align-items: center; gap: var(--space-1); min-width: 0; border-bottom: 1px solid var(--line); background: var(--panel); }
.fs-file { display: flex; align-items: center; gap: var(--space-1); flex: 1; min-width: 0; min-height: var(--tree-row-h); padding: 0 var(--space-2); border: 0; background: transparent; color: var(--secondary); text-align: left; }
.fs-file:hover { background: var(--hover); }
.fs-file > svg { flex-shrink: 0; color: var(--muted); }
.fs-file-path { min-width: 0; overflow: hidden; color: var(--bright); text-overflow: ellipsis; white-space: nowrap; font: 11px/1.5 var(--font-mono); }
.fs-file-count { flex-shrink: 0; margin-left: auto; color: var(--secondary); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; }
.fs-file-replace { flex-shrink: 0; min-height: var(--ctrl-height-sm); margin-right: var(--space-2); padding: 0 var(--space-2); color: var(--secondary); background: transparent; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 10px; }
.fs-file-replace:hover:not(:disabled) { background: var(--hover); color: var(--bright); }
.fs-file-replace:disabled { color: var(--muted); opacity: .5; }
.fs-matches { display: flex; flex-direction: column; padding: 0 0 var(--space-1); }
.fs-match { display: flex; flex-direction: column; min-width: 0; padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); transition: background-color var(--dur-1) var(--ease); }
.fs-match:hover { background: var(--hover); }
.fs-match.current { background: var(--selected); box-shadow: inset 2px 0 0 var(--accent); }
.fs-match.skipped { opacity: .5; }
.fs-match.skipped .fs-line { text-decoration: line-through; }
.fs-match-main { display: flex; align-items: flex-start; gap: var(--space-1); min-width: 0; }
.fs-check { flex-shrink: 0; width: var(--icon-size-checkbox); height: var(--icon-size-checkbox); margin: 3px 0 0; accent-color: var(--accent); }
.fs-match-line { display: flex; align-items: flex-start; gap: var(--space-2); flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.fs-match-actions { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }
.fs-mini { padding: 0 var(--space-1); color: var(--muted); background: transparent; border: 1px solid transparent; border-radius: var(--radius-xs); font-size: 10px; }
.fs-mini:hover:not(:disabled) { background: var(--elevated); border-color: var(--line-strong); color: var(--bright); }
.fs-mini:disabled { opacity: .45; }
.fs-pos { flex-shrink: 0; min-width: 46px; text-align: right; color: var(--muted); font: 10px/1.6 var(--font-mono); font-variant-numeric: tabular-nums; }
.fs-line { min-width: 0; overflow: hidden; white-space: pre; text-overflow: ellipsis; color: var(--secondary); font: 11px/1.6 var(--font-mono); }
.fs-hit { color: var(--bright); background: var(--selected); border-bottom: 1px solid var(--accent); }
.fs-after { display: flex; align-items: flex-start; gap: var(--space-1); padding: 0 0 1px 62px; }
.fs-after-mark { flex-shrink: 0; color: var(--success); font: 10px/1.7 var(--font-mono); }
.fs-after .fs-line { color: var(--success); }
</style>
