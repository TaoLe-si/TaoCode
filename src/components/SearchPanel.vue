<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-vue-next'
import { isDesktop, request, type NamedScopeSetting, type SearchOptions, type SearchPreviewMatch, type SearchPreviewResult, type SearchReplaceResult } from '../bridge'
import { compileScopeText, scopeLookup, scopeMatches, type ScopeContext, type ScopeSet } from '../scopes'
import { iconSize } from '../uiIcons'
// 分块发布（上游 `SearchResults` 的 chunk 流）：累积与认领在 src/searchStream.ts。
import { beginSearchStream, endSearchStream, searchStream } from '../searchStream'
// 结果预览面板（上游 FindPopupPanel 里的 UsagePreviewPanel）：窗口计算与文案在 src/searchPreview.ts。
import { PREVIEW_DEBOUNCE_MS, PREVIEW_SELECT_HINT, PREVIEW_TITLE, PREVIEW_UNAVAILABLE, previewHeader, previewLines, previewWindow } from '../searchPreview'
// 结果右键菜单（上游 `FindInFiles.Results.ContextMenu` → 「复制路径/引用…」那一组）。
import { COPY_REFERENCE_GROUP, FIND_COPY_ACTIONS, findResultClipboardText, type FindCopyActionId, type FindResultTarget } from '../copyPathActions'
import EditorPopupMenu from './EditorPopupMenu.vue'
import { copyToClipboard } from '../clipboard.ts'

// `scopes` / `moduleName` 来自项目设置：IDEA 的 Find in Path 对话框带一个 ScopeChooserCombo
// （`FindPopupScopeUIImpl.java:59,137`），选中哪个作用域就只在那个范围里找。
const props = defineProps<{ root: string; active: boolean; scopes: NamedScopeSetting[]; moduleName: string }>()
const replaceInput = ref<HTMLInputElement>()
defineExpose({ focusReplace: () => replaceInput.value?.focus() })
// `open` jumps the editor to an occurrence; `replaced` carries the files a replace
// just rewrote, so the shell re-reads them and an open buffer stops showing old text.
const emit = defineEmits<{ open: [payload: { path: string; line: number }]; replaced: [payload: { paths: string[] }] }>()

interface Part { text: string; hit: boolean }
interface Group { path: string; matches: SearchPreviewMatch[]; start: number; pending: number }

const query = ref('')
const replacement = ref('')
const include = ref('')
const exclude = ref('')
const regex = ref(false)
const caseSensitive = ref(false)
const wholeWord = ref(false)
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

// NamedScopesHolder.getScope 的等价物：名字查不到时返回 null（不限定）。
// 找到但模式解析不了的条目**不返回 null** —— 它就是一个 InvalidPackageSet，
// 按源码语义恒不匹配（宁可显示 0 命中，也不能悄悄退回"全项目"）。
const scopeSet = computed<ScopeSet | null>(() => {
  const entry = props.scopes.find(item => item.name === scopeName.value)
  return entry ? compileScopeText(entry.pattern).set : null
})
const scopeContext = computed<ScopeContext>(() => ({ moduleName: props.moduleName, lookup: scopeLookup(props.scopes) }))
const busy = computed(() => running.value || replacing.value)
const total = computed(() => matches.value.length)
const pendingCount = computed(() => matches.value.filter(pending).length)
const canSearch = computed(() => isDesktop && Boolean(props.root) && query.value.length > 0)
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
    query: query.value,
    regex: regex.value,
    caseSensitive: caseSensitive.value,
    wholeWord: wholeWord.value,
    include: include.value.trim(),
    exclude: exclude.value.trim(),
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
  return request<SearchPreviewResult>('search.preview', { ...params(), replacement: replacement.value, streamId: streamSeq })
}
// 作用域在**结果**上求值。原生扫描只吃一个 include 列表，无法同时表达
// 「作用域 ∩ 文件掩码」的交集，所以掩码走原生、作用域在这里精确过滤。
function narrow(list: SearchPreviewMatch[]): SearchPreviewMatch[] {
  const scope = scopeSet.value
  if (!scope) return list
  return list.filter(match => scopeMatches(scope, match.path, false, scopeContext.value))
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
async function replaceOccurrences(list: SearchPreviewMatch[]) {
  if (!list.length || !canSearch.value || busy.value) return
  const token = ++replaceToken
  const keys = new Set(list.map(keyOf))
  const paths = [...new Set(list.map(match => match.path))]
  replacing.value = true
  error.value = ''
  note.value = ''
  try {
    const result = await request<SearchReplaceResult>('search.replaceSelected', {
      ...params(),
      replacement: replacement.value,
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
// A replace the walk could not finish is not a success. `skippedFiles` is the number
// of ticked files the 100k-file ceiling cut off before they were ever read, so the
// old "已替换 N 处" line alone would have been a lie.
function incompleteNote(result: SearchReplaceResult): string {
  const skipped = Math.max(0, Math.trunc(result.skippedFiles ?? 0))
  const undecodable = Math.max(0, Math.trunc(result.skippedNonUtf8 ?? 0))
  const reasons: string[] = []
  if (skipped > 0) reasons.push(`有 ${skipped} 个勾选的文件因扫描上限未被处理`)
  else if (result.truncated === true) reasons.push('扫描被截断，可能还有未列出的匹配')
  if (undecodable > 0) reasons.push(`${undecodable} 个文件的编码无法识别，未参与搜索/替换`)
  if (!reasons.length) return ''
  return `⚠ 替换不完整：${reasons.join('；')}。请检查相关文件后重做。`
}
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
  // 选了范围时，原生 `search.replace` 的 include 只能写一个列表，表达不了
  // 「作用域 ∩ 文件掩码」。与其冒着改写范围外文件的风险，不如明确只替换本次
  // 作用域内**已列出**的那些处 —— 用户看得见它们，而且每一处都在范围内。
  if (scopeSet.value) {
    if (!confirmAll.value) {
      confirmAll.value = true
      note.value = `将替换作用域“${scopeName.value}”内已列出的 ${matches.value.length} 处；范围限定下不会改写未列出的文件。再次点击“全部替换”确认。`
      return
    }
    confirmAll.value = false
    await replaceOccurrences(matches.value)
    return
  }
  if (!confirmAll.value) {
    confirmAll.value = true
    note.value = `将替换工作区内全部匹配${truncated.value ? '（含未列出的部分）' : ''}。再次点击“全部替换”确认。`
    return
  }
  const token = ++replaceToken
  const paths = [...new Set(matches.value.map(match => match.path))]
  replacing.value = true
  error.value = ''
  confirmAll.value = false
  try {
    const result = await request<SearchReplaceResult>('search.replace', { ...params(), replacement: replacement.value })
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

// Enter / Shift+Enter walk the occurrences (IDEA's Find in Files). Navigation
// expands a collapsed file instead of skipping past it.
async function move(delta: number) {
  const list = flat.value
  if (!list.length) return
  const next = cursor.value < 0 ? (delta > 0 ? 0 : list.length - 1) : (cursor.value + delta + list.length) % list.length
  cursor.value = next
  collapsed.delete(list[next]!.path)
  await nextTick()
  listRef.value?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
}
function onPanelKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return
  const target = event.target as HTMLElement | null
  // Inside a field Enter submits; on a row it opens that occurrence.
  if (target?.closest('input, textarea, select, button, [contenteditable]')) return
  event.preventDefault()
  void move(event.shiftKey ? -1 : 1)
}
function parts(match: SearchPreviewMatch): Part[] {
  const line = match.preview ?? ''
  const start = Math.min(Math.max(0, (match.column || 1) - 1), line.length)
  const end = Math.min(Math.max(start, start + Math.max(0, match.length || 0)), line.length)
  const list: Part[] = []
  if (start > 0) list.push({ text: line.slice(0, start), hit: false })
  list.push({ text: line.slice(start, end), hit: true })
  if (end < line.length) list.push({ text: line.slice(end), hit: false })
  return list
}

watch(() => props.active, active => { if (active && query.value.length > 0 && !searched.value && !busy.value) void runSearch() })
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
        <button class="icon-button" :title="filtersOpen ? '收起筛选' : '筛选'" aria-label="切换文件筛选" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen"><SlidersHorizontal :size="iconSize.control" /></button>
        <button class="icon-button" title="清空" aria-label="清空搜索" :disabled="!query && !replacement && !total" @click="reset"><X :size="iconSize.control" /></button>
      </div>
    </div>

    <div class="fs-form">
      <div class="fs-row">
        <input v-model="query" class="fs-input" type="text" placeholder="搜索全部文件" aria-label="搜索内容" spellcheck="false" @keydown.enter.prevent="runSearch" />
        <div class="fs-toggles">
          <button class="fs-toggle" :class="{ on: caseSensitive }" title="区分大小写" aria-label="区分大小写" :aria-pressed="caseSensitive" @click="caseSensitive = !caseSensitive">Aa</button>
          <button class="fs-toggle" :class="{ on: regex }" title="正则表达式" aria-label="正则表达式" :aria-pressed="regex" @click="regex = !regex">.*</button>
          <button class="fs-toggle" :class="{ on: wholeWord }" title="全词匹配" aria-label="全词匹配" :aria-pressed="wholeWord" @click="wholeWord = !wholeWord">词</button>
        </div>
        <button class="icon-button" title="搜索 (Enter)" aria-label="搜索" :disabled="!canSearch || replacing" @click="runSearch"><Search :size="iconSize.control" /></button>
      </div>
      <div v-if="filtersOpen" class="fs-filters">
        <label class="fs-filter"><span>包含</span><input v-model="include" type="text" placeholder="*.cpp 或 src/**" aria-label="仅搜索这些文件" spellcheck="false" /></label>
        <label class="fs-filter"><span>排除</span><input v-model="exclude" type="text" placeholder="build/**" aria-label="排除这些文件" spellcheck="false" /></label>
        <!-- IDEA Find in Path 的范围下拉（ScopeChooserCombo）：项目 + 命名作用域。 -->
        <label class="fs-filter"><span>范围</span><select v-model="scopeName" aria-label="搜索范围"><option value="">项目</option><option v-for="entry in scopes" :key="entry.name" :value="entry.name">{{ entry.name }}</option></select></label>
      </div>
      <div class="fs-row">
        <input ref="replaceInput" v-model="replacement" class="fs-input" type="text" placeholder="替换为" aria-label="替换内容" spellcheck="false" @keydown.enter.ctrl.prevent="replaceAllOnDisk" />
        <button class="fs-replace" :class="{ 'fs-confirm': confirmAll }" :disabled="!canSearch || busy" :title="confirmAll ? '再次点击以确认替换工作区内全部匹配' : '替换工作区内全部匹配（Ctrl+Enter）'" @click="replaceAllOnDisk">{{ confirmAll ? '确认全部替换' : '全部替换' }}</button>
      </div>
    </div>

    <p v-if="!isDesktop" class="fs-warn">浏览器预览不能全局搜索，请在桌面端使用。</p>
    <p v-else-if="!root" class="fs-warn">尚未打开项目。</p>
    <p v-if="error" class="fs-error">{{ error }}</p>
    <p v-if="note" class="fs-note">{{ note }}</p>
    <div v-if="searched || running" class="fs-status">
      <!-- 搜索中就把**已经到达的那几块**报出来（上游 `SearchResults` 的 publish：慢搜索也能先看到命中）。 -->
      <span>{{ replacing ? '正在替换…' : running ? `正在搜索…已找到 ${streamedCount} 条 / ${searchStream.fileCount} 个文件` : `共 ${total} 处 / ${fileCount} 个文件` }}{{ !busy && pendingCount !== total ? `，已选中 ${pendingCount} 处` : '' }}{{ scopeName ? `，范围：${scopeName}` : '' }}</span>
      <span class="fs-status-right">
        <span v-if="truncated" class="fs-truncated" title="结果已截断，替换只覆盖列出的匹配">结果已截断</span>
        <button v-if="busy" class="fs-cancel" title="放弃本次搜索/替换" @click="cancelSearch">取消</button>
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
              <ChevronRight v-if="collapsed.has(group.path)" :size="iconSize.menu" />
              <ChevronDown v-else :size="iconSize.menu" />
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
                  <span class="fs-line"><span v-for="(part, partIndex) in parts(match)" :key="partIndex" :class="{ 'fs-hit': part.hit }">{{ part.text }}</span></span>
                </button>
                <div class="fs-match-actions">
                  <button class="fs-mini" :disabled="busy" title="替换这一处" @click="replaceOne(match)">替换</button>
                  <button class="fs-mini" :disabled="busy" title="跳过这一处（不替换）" @click="skipOne(match)">跳过</button>
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
      <div v-else class="fs-empty">输入关键词后按 Enter 搜索；Enter / Shift+Enter 在结果间移动，勾选后逐条替换。</div>
    </div>

    <!-- 预览面板（上游 `FindPopupPanel` 的 `UsagePreviewPanel` + `myUsagePreviewTitle`）：
         标题是"文件名 + 行位置"，正文是命中行上下若干行，命中行高亮。 -->
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
        >{{ text }}
</span></pre>
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
.fs-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: auto; }
/* 预览面板贴在结果列表下面（上游是一个 0.33 的 splitter，比例可拖；本仓先给固定高度，
   15 行上下 —— `UsagePreviewPanel` 那边的最小高度也是 15 行）。 */
.fs-preview { flex: 0 0 auto; display: flex; flex-direction: column; min-height: 96px; max-height: 40%; border-top: 1px solid var(--line-strong); background: var(--panel); }
.fs-preview-head { display: flex; align-items: center; gap: var(--space-2); padding: 2px var(--space-2); min-height: var(--ctrl-height-sm); font-size: 11px; }
.fs-preview-title { color: var(--muted); }
.fs-preview-name { color: var(--text); font-family: var(--font-mono); }
.fs-preview-detail { color: var(--muted); font-variant-numeric: tabular-nums; }
.fs-preview-body { flex: 1 1 auto; min-height: 90px; overflow: auto; }
.fs-preview-text { margin: 0; padding: 0 var(--space-2) var(--space-2); background: var(--editor); font: 12px/1.6 var(--font-mono); color: var(--text); white-space: pre; }
.fs-preview-line { display: block; }
.fs-preview-line.current { background: var(--accent-soft); color: var(--bright); }
.fs-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); height: var(--tab-h); min-height: var(--tab-h); padding: 0 var(--space-1) 0 var(--space-3); border-bottom: 1px solid var(--line); color: var(--secondary); font-size: 11px; }
.fs-heading > span { display: inline-flex; align-items: center; gap: var(--space-2); }
.fs-heading > span > svg { flex-shrink: 0; color: var(--muted); }
.fs-form { display: flex; flex-direction: column; gap: var(--space-1); flex-shrink: 0; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.fs-row { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
.fs-input { flex: 1; min-width: 0; min-height: 26px; padding: 3px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 12px/1.5 var(--font-mono); }
.fs-input::placeholder { color: var(--muted); font-family: var(--font-ui); }
.fs-input:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.fs-toggles { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.fs-toggle { width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); padding: 0; border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--muted); font: 11px/1 var(--font-mono); }
.fs-toggle:hover { background: var(--hover); color: var(--bright); }
.fs-toggle.on { color: var(--accent); background: var(--selected); border-color: var(--line-strong); }
.fs-replace { flex-shrink: 0; min-height: 26px; padding: 3px var(--space-2); color: var(--secondary); background: var(--elevated); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 11px; }
.fs-replace:hover:not(:disabled) { background: var(--hover); color: var(--bright); }
.fs-replace:disabled { color: var(--muted); opacity: .55; }
.fs-replace.fs-confirm { color: var(--on-accent); background: var(--error); border-color: var(--error); }
.fs-filters { display: flex; flex-direction: column; gap: var(--space-1); }
.fs-filter { display: flex; align-items: center; gap: var(--space-2); min-width: 0; font-size: 11px; color: var(--muted); }
.fs-filter > span { flex-shrink: 0; width: 28px; }
.fs-filter input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-xs); font: 11px/1.5 var(--font-mono); }
.fs-filter input::placeholder { color: var(--muted); font-family: var(--font-ui); }
.fs-warn, .fs-error, .fs-note { margin: 0; padding: var(--space-2) var(--space-3); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.fs-warn { color: var(--secondary); background: var(--rail); border-bottom: 1px solid var(--line); }
.fs-error { color: var(--error); background: var(--panel); border-bottom: 1px solid var(--line); }
.fs-note { color: var(--secondary); background: var(--panel); border-bottom: 1px solid var(--line); }
.fs-status { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-shrink: 0; padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; border-bottom: 1px solid var(--line); }
.fs-status-right { display: inline-flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
.fs-truncated { color: var(--error); }
.fs-cancel { padding: 1px var(--space-2); color: var(--secondary); background: transparent; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 10px; }
.fs-cancel:hover { background: var(--hover); color: var(--bright); }
.fs-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); flex-shrink: 0; padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.fs-action { min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--secondary); background: var(--elevated); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 11px; }
.fs-action:hover:not(:disabled) { background: var(--hover); color: var(--bright); }
.fs-action:disabled { color: var(--muted); opacity: .55; }
/* 结果区保底高度（真机量到过 8px：内容 58 万像素高、列表只有一条缝）—— 面板放不下时
   由 .fs-panel 滚动，而不是把列表压没（上游的 Find 工具窗也是结果区占满剩余高度）。 */
.fs-scroll { flex: 1 1 auto; min-height: 96px; overflow: auto; padding-bottom: var(--space-2); }
.fs-scroll:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.fs-empty { padding: var(--space-4) var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.fs-group { min-width: 0; }
.fs-group-head { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
.fs-file { display: flex; align-items: center; gap: var(--space-1); flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2) 2px var(--space-1); border: 0; background: transparent; color: var(--secondary); text-align: left; }
.fs-file:hover { background: var(--hover); }
.fs-file > svg { flex-shrink: 0; color: var(--muted); }
.fs-file-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11px/1.6 var(--font-mono); color: var(--text); }
.fs-file-count { flex-shrink: 0; margin-left: auto; color: var(--muted); font-size: 10px; }
.fs-file-replace { flex-shrink: 0; margin-right: var(--space-2); padding: 1px var(--space-2); color: var(--secondary); background: transparent; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font-size: 10px; }
.fs-file-replace:hover:not(:disabled) { background: var(--hover); color: var(--bright); }
.fs-file-replace:disabled { color: var(--muted); opacity: .5; }
.fs-matches { display: flex; flex-direction: column; padding: 0 0 var(--space-1); }
.fs-match { display: flex; flex-direction: column; min-width: 0; padding: 1px var(--space-2) 1px var(--space-3); transition: background-color var(--dur-1) var(--ease); }
.fs-match:hover { background: var(--hover); }
.fs-match.current { background: var(--selected); }
.fs-match.skipped { opacity: .5; }
.fs-match.skipped .fs-line { text-decoration: line-through; }
.fs-match-main { display: flex; align-items: flex-start; gap: var(--space-1); min-width: 0; }
.fs-check { flex-shrink: 0; margin: 3px 0 0; accent-color: var(--accent); }
.fs-match-line { display: flex; align-items: flex-start; gap: var(--space-2); flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.fs-match-actions { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }
.fs-mini { padding: 0 var(--space-1); color: var(--muted); background: transparent; border: 1px solid transparent; border-radius: var(--radius-xs); font-size: 10px; }
.fs-mini:hover:not(:disabled) { background: var(--elevated); border-color: var(--line-strong); color: var(--bright); }
.fs-mini:disabled { opacity: .45; }
.fs-pos { flex-shrink: 0; min-width: 46px; text-align: right; color: var(--muted); font: 10px/1.7 var(--font-mono); }
.fs-line { min-width: 0; overflow: hidden; white-space: pre; text-overflow: ellipsis; color: var(--secondary); font: 11px/1.7 var(--font-mono); }
.fs-hit { color: var(--bright); background: var(--selected); border-radius: 2px; }
.fs-after { display: flex; align-items: flex-start; gap: var(--space-1); padding: 0 0 1px 62px; }
.fs-after-mark { flex-shrink: 0; color: var(--success); font: 10px/1.7 var(--font-mono); }
.fs-after .fs-line { color: var(--success); }
</style>
