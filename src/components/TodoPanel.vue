<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, ChevronRight, Eye, FileCode2, Filter, Folder, Group, Layers, ListChecks, LocateFixed, RefreshCw } from 'lucide-vue-next'
import { isDesktop, request, type DocumentData, type GitChange, type GitStatus, type SearchMatch, type SearchResult, type TodoPattern } from '../bridge'
import { buildTodoTree, flattenTodoRows, orderedItems, packageIds, type TodoItem, type TodoNode } from '../todoTree'
import { filterTodoItemsByScope, keepPatternHits, markerMatches, TODO_CHANGE_LIST_SCOPE, todoItemColor, TODO_CURRENT_FILE_SCOPE } from '../todoView'
import { TODO_MAX_DISPLAYED_LINES, todoContinuationLines, todoDisplayText, todoMarkerRegions } from '../todoMultiLine'
import { isSpeedSearchTypeable, speedSearchElement, speedSearchNextInput, type SpeedSearchInputEvent, type SpeedSearchInputState } from '../speedSearch'
import { filterTodoItems, todoFilters } from '../todoFilters'
import { needsTodoIndex } from '../todoExtraPlaces.ts'
import { providerTodoIndexerPaths, providerTodoItems, mergeTodoItems, setTodoIndexerPatterns } from '../todoIndexerEntries.ts'
import { iconSize } from '../uiIcons'

// IDEA's Todo tool window (platform/todo TodoPanel): a vertical toolbar with the
// occurrence walker, the marker filter, auto-scroll from source, expand/collapse, the
// Group By popup and the preview toggle; the tree itself is packages > files > items and
// a click selects (preview) while a double click jumps to source.
const props = defineProps<{ root: string; active: boolean; patterns: TodoPattern[]; source?: { path: string; line: number } | null; scopes?: Array<{ name: string; pattern: string }>; moduleName?: string }>()
const emit = defineEmits<{ open: [payload: { path: string; line: number }] }>()

const items = ref<TodoItem[]>([])
const running = ref(false)
const scanned = ref(false)
const error = ref('')
const showPackages = ref(true)
const flattenPackages = ref(false)
const autoScroll = ref(false)
const showPreview = ref(true)
const groupByOpen = ref(false)
// Empty means IDEA's "<All>" filter; otherwise the marker pattern to keep.
// 一格下拉同时承载 IDEA 的两层过滤（`SetTodoFilterAction` 的过滤器与单条标记）：值带前缀。
const filterValue = ref('')
const filterName = computed(() => filterValue.value.startsWith('filter:') ? filterValue.value.slice('filter:'.length) : '')
const filterPattern = computed(() => filterValue.value.startsWith('pattern:') ? filterValue.value.slice('pattern:'.length) : '')
// IDEA TodoPanel 的作用域过滤器（`TodoPanel` 的 scope 下拉，候选来自 Settings › 作用域）：
// 空 = 「<All>」，否则用命名作用域的模式裁掉范围外的条目。
const scopeName = ref('')
// 多行 TODO（上游 `TodoConfiguration.java:48` `myMultiLine = true`，设置页那一格是
// `TodoConfigurableUI.kt:15-22`）：一条 TODO 的描述可以延续到**下一行的注释**。
// 本仓的扫描是文本正则，续行要把文件内容读出来才能判定，所以它挂在分组方式弹层里，
// 打开时才对条目补续行（默认关 —— 与上游默认值相反是**有意**的：上游有索引，本仓要读文件）。
const multiLine = ref(false)
/** 一次最多补多少个文件的多行（每个文件一次 `file.read`），超出如实写在状态行里。 */
const TODO_MULTILINE_FILE_LIMIT = 64
/** 变更列表作用域的路径集（`git.status` 给的未提交变更，含重命名前身）。 */
const changeListPaths = ref<string[]>([])
const changeListNote = ref('')
/** 多行补全被文件数上限截住时的说明。 */
const multilineNote = ref('')
/** 「额外位置」门挡掉了多少条工作区外的标记（`com.intellij.todoExtraPlaces`，见 `src/todoExtraPlaces.ts`）。 */
const extraPlaceNote = ref('')
/**
 * 速度搜索的当前串（`TodoPanel.java:286` 的 `installTreeSpeedSearch`：打字即选中，不裁剪列表）。
 * `shown` 就是上游"搜索框在场"那一档（`SpeedSearchBase.java:1070` 的 `mySearchPopup != null`）：
 * 本仓没有浮动的输入框，这一位决定下一次输入是**追加**还是**替换**（见 `speedSearchNextInput`）。
 */
const speed = ref<SpeedSearchInputState>({ pattern: '', shown: false })
const speedQuery = computed(() => speed.value.pattern)
const expanded = reactive(new Set<string>())
const selected = ref<{ path: string; line: number } | null>(null)
const preview = ref<{ path: string; line: number; lines: string[]; start: number } | null>(null)
const previewError = ref('')

// 标记名与颜色来自**命中的那条模式**（规则在 src/todoView.ts：模式按上游原样当正则用，
// 大小写按每条模式自己的 `caseSensitive`；坏正则退化为字面量包含而不是每行抛异常）。
// `kind` 由扫描末尾的 `keepPatternHits` 填好（上游两段式：粗筛 + 每条模式自己定夺）。
const itemColor = (preview: string) => todoItemColor(preview, props.patterns)

const scoped = computed(() => filterTodoItemsByScope(items.value, scopeName.value, props.scopes ?? [], props.moduleName ?? '',
  props.source?.path ?? '', changeListPaths.value))
// 命名过滤器（`TodoFilter`）优先；直接选单条标记时退回原来的逐条匹配。
const filtered = computed(() => {
  if (filterName.value) return filterTodoItems(scoped.value, filterName.value, todoFilters.value, props.patterns)
  if (!filterPattern.value) return scoped.value
  // 选中一条标记做过滤时用**那条模式自己的** caseSensitive（此前省略第三参 ⇒ 永远按不区分大小写，
  // 勾了「区分大小写」的标记照样把反面大小写的行留下来）。
  const chosen = props.patterns.find(pattern => pattern.pattern === filterPattern.value)
  return scoped.value.filter(item => markerMatches(item.text, filterPattern.value, chosen?.caseSensitive))
})
const tree = computed(() => buildTodoTree(filtered.value, { showPackages: showPackages.value, flattenPackages: flattenPackages.value }))
const rows = computed(() => flattenTodoRows(tree.value, expanded))
const occurrences = computed(() => orderedItems(tree.value))
// 每行的显示形状（多行条目 = 主行 + 最多 10 条续行 + 「更多」标记，`MultiLineTodoRenderer.java:16,76`）。
const displayRows = computed(() => rows.value.map(row => ({
  row, display: row.item ? todoDisplayText(row.item.text, row.item.additional ?? []) : null,
})))

/** 预览行里标记词的位置（`TodoHighlightVisitor.java:96-107` 在本仓的可见面：只着色预览）。 */
function markerSegments(line: string): Array<{ text: string; mark: boolean }> {
  const regions = todoMarkerRegions(line, props.patterns)
  if (!regions.length) return [{ text: line, mark: false }]
  const parts: Array<{ text: string; mark: boolean }> = []
  let cursor = 0
  for (const region of regions) {
    if (region.start < cursor) continue
    if (region.start > cursor) parts.push({ text: line.slice(cursor, region.start), mark: false })
    parts.push({ text: line.slice(region.start, region.start + region.length), mark: true })
    cursor = region.start + region.length
  }
  if (cursor < line.length) parts.push({ text: line.slice(cursor), mark: false })
  return parts
}

// A scan is one workspace walk, so its generation guard is what keeps a slow scan of
// the previous project from overwriting the tree of the project now open.
let scanToken = 0
/**
 * 第三方索引器（`com.intellij.todoIndexer`，`src/todoIndexerEntries.ts`）补的条目。
 * 只为**有第三方索引器认领**的那些路径各读一次文件（`providerTodoIndexerPaths` 恒空 ⇒ 一次读盘都不发）。
 * 读不到的文件保持单行显示，不谎报（与多行 TODO 那条链同一容错口径）。
 */
async function providerItemsFor(paths: readonly string[]): Promise<Array<{ path: string; line: number; text: string; kind: string }>> {
  const targets = providerTodoIndexerPaths(paths)
  if (!targets.length) return []
  const out: Array<{ path: string; line: number; text: string; kind: string }> = []
  for (const path of targets) {
    try {
      const doc = await request<DocumentData>('file.read', { path })
      out.push(...providerTodoItems(path, doc.content, props.patterns))
    } catch { /* 读不到的文件不补条目，不谎报 */ }
  }
  return out
}
async function scan() {
  if (!isDesktop || !props.root || running.value) return
  const token = ++scanToken
  running.value = true
  error.value = ''
  // 把当前项目的模式表灌给 bundled 索引器（`PlainTextTodoIndexer` 读的是全局 TodoConfiguration，
  // 本仓的模式是项目级的 —— 见 `src/todoIndexerEntries.ts` 的 `setTodoIndexerPatterns`）。
  setTodoIndexerPatterns(props.patterns)
  try {
    // 粗筛：一趟 `search.run` 只有一个全局 `caseSensitive`，所以按**不区分大小写**取超集，
    // 末尾再交给 `keepPatternHits` 按每条模式自己的档位定夺（上游同形：索引只做粗筛计数
    // `IndexPatternSearcher.java:66-74`，命中由每条 `IndexPattern` 的 `Pattern.find()` 决定 `:239-247`）。
    // 模式**原样**拼进查询，不再包 `\b(...)`：上游 `IndexPattern.java:80-89` 就是把用户写的串
    // 直接 `Pattern.compile`；而且提交前 TODO 检查那条链（`src/todoScan.ts` → `SourceControl.vue:487`）
    // 本来就是原样直送，包了就成了同一个模式在两处说两种话。表空 ⇒ 不发扫描、什么都不留。
    const markers = props.patterns.map(pattern => pattern.pattern.trim()).filter(Boolean).join('|')
    const result = markers
      ? await request<SearchResult>('search.run', { query: markers, regex: true, caseSensitive: false, wholeWord: false, include: '', exclude: '' })
      : null
    if (token !== scanToken) return
    // 「额外位置」这一道门（上游 `TodoIndexers.needsTodoIndex`）：结果必须落在工作区内容根里，
    // 否则要有一条 `com.intellij.todoExtraPlaces` 的 checker 认领它（出厂的 ScratchTodoExtraPlaces
    // 认 scratch 临时文件 —— 见 `src/todoExtraPlaces.ts`）。挡掉多少如实写在状态行里。
    const hits = (result?.matches ?? []).map((match: SearchMatch) => ({
      path: match.path, line: match.line, column: match.column, text: match.preview.trim(),
    }))
    const indexed = hits.filter(hit => needsTodoIndex(hit.path, props.root))
    extraPlaceNote.value = hits.length > indexed.length
      ? `已忽略 ${hits.length - indexed.length} 条工作区外的标记（未被任何额外位置检查器认领）。` : ''
    // `com.intellij.todoIndexer` 那条 EP：第三方按 id 挂的索引器给这个文件补条目（`map(FileContent)`
    // 的同名方法面，见 `src/todoIndexerEntries.ts`）。**只在真的有第三方索引器时**才为文件读一次盘
    // （bundled 那支与 `search.run` 同一份模式表，不并进来 ⇒ 没有第三方时本仓既有行为一字不变）。
    const providerItems = await providerItemsFor(indexed.map(hit => hit.path))
    if (token !== scanToken) return
    items.value = mergeTodoItems(keepPatternHits(indexed, props.patterns), providerItems)
    scanned.value = true
    // A fresh scan replaces the tree, so start from IDEA's fully-expanded view.
    expanded.clear()
    for (const id of packageIds(tree.value)) expanded.add(id)
    if (multiLine.value) await applyMultiline(token)
  } catch (caught) { if (token === scanToken) error.value = caught instanceof Error ? caught.message : String(caught) }
  finally { if (token === scanToken) running.value = false }
}

// 多行 TODO 的补全：续行必须看文件里标记行的下一行是什么，所以逐文件 `file.read`
// （上游用的是 TODO 索引，本仓没有；这就是 `src/todoMultiLine.ts` 文件头写明的差距）。
// 条目按路径分组，一次读一个文件，读到的续行写回该文件里每条 TODO 的 `additional`。
async function applyMultiline(token: number) {
  const paths = [...new Set(items.value.filter(item => item.kind).map(item => item.path))]
  const limited = paths.slice(0, TODO_MULTILINE_FILE_LIMIT)
  multilineNote.value = paths.length > limited.length
    ? `多行 TODO 只补了前 ${limited.length} 个文件（共 ${paths.length} 个）。` : ''
  for (const path of limited) {
    try {
      const doc = await request<DocumentData>('file.read', { path })
      if (token !== scanToken) return
      const lines = doc.content.split(/\r?\n/)
      for (const item of items.value) {
        if (item.path !== path) continue
        // `SearchMatch.column` 是**桥接口径的 1 基码点列**（native/search.cpp:698 `code_points(content,
        // line_start, pos) + 1`，`SearchPanel.vue:736` 也是直接把它当"行列"显示），
        // 而上游续行判定比的是匹配**起始偏移**（0 基，`IndexPatternSearcher.java:285-287`）⇒ 这里换算一次。
        // 不换算的后果（2026-10-06 todo2 读盘核出）：标记列只有一个空格的续行写法被整段丢掉。
        item.additional = todoContinuationLines(lines, item.line, (item.column ?? 1) - 1, props.patterns)
      }
    } catch { /* 读不到的文件保持单行显示，不谎报 */ }
  }
  // items 的字段是被就地补的，重排一次引用才能让 computed 的树跟着变。
  items.value = [...items.value]
}

// 变更列表作用域（`ChangeListTodosPanel.java:70-81` 跟的是默认变更列表）：本仓的变更集
// 就是 `git.status` 的未提交改动；非仓库 / Git 失败时给空集并写清原因（不静默变成「全部」）。
let changeToken = 0
async function loadChangeList() {
  if (scopeName.value !== TODO_CHANGE_LIST_SCOPE || !isDesktop) return
  const token = ++changeToken
  changeListNote.value = ''
  try {
    const status = await request<GitStatus>('git.status')
    if (token !== changeToken) return
    const changes = (status.changes ?? []) as Array<Pick<GitChange, 'path' | 'renameFrom'>>
    const paths = [...new Set(changes.flatMap(change => [change.path, change.renameFrom].filter(Boolean) as string[]))]
    changeListPaths.value = paths
    if (!paths.length) changeListNote.value = '当前没有未提交的变更，变更列表作用域下不会有任务。'
  } catch (caught) {
    if (token !== changeToken) return
    changeListPaths.value = []
    changeListNote.value = `拿不到变更列表：${caught instanceof Error ? caught.message : String(caught)}`
  }
}
watch(scopeName, name => {
  if (name === TODO_CHANGE_LIST_SCOPE) void loadChangeList()
  else { changeListPaths.value = []; changeListNote.value = '' }
})
watch(multiLine, on => { if (on && scanned.value) void applyMultiline(scanToken); else if (!on) { for (const item of items.value) item.additional = []; items.value = [...items.value] } })

// 速度搜索（`TodoPanel.java:286` 的 `installTreeSpeedSearch`）：打字不裁剪列表，而是
// **选中**下一个匹配的可见行（`SpeedSearchBase.java:679` 的 selectElement），命中的是
// 可见行的文本 —— 包/文件节点也行，条目也行。
const speedLabels = computed(() => rows.value.map(row => row.item ? row.item.text : row.node.label))
/** 串的每一次变化都走同一台状态机（`speedSearchNextInput`），本面板不再自己拼 `+= / slice(0,-1)`。 */
function applySpeedEvent(event: SpeedSearchInputEvent) {
  speed.value = speedSearchNextInput(speed.value, event)
}
function onTreeKeydown(event: KeyboardEvent) {
  if (event.altKey) return
  // Ctrl/Meta + Backspace = **退到上一个空白分隔符**（`SpeedSearch.java:63-70`；快捷键在
  // `SpeedSearchBase.java:259` 注册，非 mac 是 `control BACK_SPACE`）。原来这一档被上面那句
  // `if (event.ctrlKey || event.metaKey) return` 整条挡住，压根到不了退到词首那支。
  if (event.key === 'Backspace' && (event.ctrlKey || event.metaKey)) {
    if (!speed.value.pattern) return
    applySpeedEvent({ kind: 'deleteWord' })
    jumpToSpeedHit()
    event.preventDefault()
    return
  }
  if (event.ctrlKey || event.metaKey) return
  if (event.key === 'Escape') { applySpeedEvent({ kind: 'escape' }); return }
  if (event.key === 'Backspace') {
    // 空串上的退格也要吞掉（`SpeedSearchBase.java:960-962`），只是不改串（`SpeedSearch.java:47-51`）；
    // 非空时上游同样把这一键吃掉（`:999-1001`），所以下面是无条件 preventDefault。
    applySpeedEvent({ kind: 'backspace' })
    jumpToSpeedHit()
    event.preventDefault()
    return
  }
  // 能打进速度搜索的字符：字母数字，或 `PUNCTUATION_MARKS`（`SpeedSearch.java:25`）里的标点，
  // 但**空白一律不行**（树/表那一支 `SpeedSearchBase.java:587` 没有"已经在搜就放行"的例外）。
  // 原来是 `event.key.length === 1 && !/^\s$/.test(event.key)`：`(` `)` 这类不在标点表里的也能打进串，
  // 而除 ASCII 空格以外的空白（制表符）照样放行 —— 两处都与上游不符。
  if (event.key.length === 1 && isSpeedSearchTypeable(event.key, null)) {
    applySpeedEvent({ kind: 'type', character: event.key })
    jumpToSpeedHit()
    event.preventDefault()
    return
  }
  if (event.key === 'Enter' && selected.value) {
    // 上游回车是"收起搜索框"（`SpeedSearchBase.java:965-975`），非 sticky 时旧串不留存
    // （`:1059-1061`）⇒ 下一次输入**替换**而不是接着追加。原来是打开条目后串还留在原地。
    applySpeedEvent({ kind: 'hide' })
    open(selected.value)
    event.preventDefault()
  }
}
function jumpToSpeedHit() {
  // 打字定位走 `findElement`（`SpeedSearchBase.java:519-537`）：从**当前选中行（含它自己）**
  // 往后扫、走完再回绕。原来固定用 `firstSpeedSearchHit`（永远从第 0 行重扫），
  // 光标停在第 3 行、第 1 行也命中时，每敲一个字符高亮就被甩回头部。
  const current = rows.value.findIndex(row => row.item && row.item.path === selected.value?.path && row.item.line === selected.value?.line)
  const hit = speedSearchElement(speedLabels.value, speed.value.pattern, current)
  if (hit < 0) return
  const row = rows.value[hit]!
  if (row.item) revealOccurrence({ path: row.item.path, line: row.item.line })
}

function nodeKey(node: TodoNode) { return node.id }
function togglePackage(node: TodoNode) {
  if (node.kind !== 'package') return
  if (expanded.has(node.id)) expanded.delete(node.id)
  else expanded.add(node.id)
}
function expandAll() { for (const id of packageIds(tree.value)) expanded.add(id) }
function collapseAll() { expanded.clear() }

let selectToken = 0
// Read on every selection: a cached copy could show text the editor has since changed.
async function select(occurrence: { path: string; line: number }) {
  selected.value = occurrence
  if (!showPreview.value || !isDesktop) return
  const token = ++selectToken
  try {
    const doc = await request<DocumentData>('file.read', { path: occurrence.path })
    if (token !== selectToken) return
    const lines = doc.content.split(/\r?\n/)
    const index = Math.min(Math.max(occurrence.line - 1, 0), lines.length - 1)
    const start = Math.max(0, index - 2)
    previewError.value = ''
    preview.value = { path: occurrence.path, line: occurrence.line, lines: lines.slice(start, index + 3), start }
  } catch (caught) {
    if (token !== selectToken) return
    preview.value = null
    previewError.value = `无法预览 ${occurrence.path}：${caught instanceof Error ? caught.message : String(caught)}`
  }
}
function open(occurrence: { path: string; line: number }) { emit('open', occurrence) }
function step(direction: 1 | -1) {
  const list = occurrences.value
  if (!list.length) return
  const at = selected.value ? list.findIndex(entry => entry.path === selected.value?.path && entry.line === selected.value?.line) : -1
  const next = list[(at + direction + list.length) % list.length]
  void revealOccurrence(next)
}
// IDEA's auto-scroll-from-source: the tree follows the caret instead of the reverse.
function revealOccurrence(occurrence: { path: string; line: number } | null) {
  if (!occurrence) return
  const ancestors = treeAncestors(tree.value, occurrence.path)
  for (const id of ancestors) expanded.add(id)
  void select(occurrence)
}
function treeAncestors(nodes: TodoNode[], path: string, trail: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === 'file' && node.path === path) return trail
    if (node.kind === 'package') {
      const found = treeAncestors(node.children, path, [...trail, node.id])
      if (found.length) return found
    }
  }
  return []
}
// immediate: the panel mounts already active (the Todo tool window is only created
// when its view is selected), so without this the very first open never scanned.
watch(() => props.active, active => { if (active && !scanned.value) void scan() }, { immediate: true })
// Switching projects changes every path in the index: invalidate the scan in flight,
// drop the old tree (and the preview that belongs to it) and rescan.
watch(() => props.root, root => {
  ++scanToken
  items.value = []
  scanned.value = false
  running.value = false
  error.value = ''
  selected.value = null
  preview.value = null
  previewError.value = ''
  if (root && isDesktop) void scan()
})
// Editing the marker list in Settings changes what the index means, so refresh it.
watch(() => props.patterns, () => { if (scanned.value) void scan() }, { deep: true })
// IDEA's auto-scroll: the tree follows the caret. Keyed on "path:line" so a keystroke
// inside the same line does not re-read the file.
watch(() => autoScroll.value && props.source ? `${props.source.path}:${props.source.line}` : '', key => {
  if (!key || !props.source) return
  const occurrence = { path: props.source.path, line: props.source.line }
  if (selected.value?.path === occurrence.path && selected.value?.line === occurrence.line) return
  revealOccurrence(occurrence)
})
</script>

<template>
  <div class="todo-panel">
    <div class="panel-heading">
      <span><ListChecks :size="iconSize.control" />任务 (TODO)</span>
      <div class="heading-actions"><span class="heading-count">{{ filtered.length }}</span><button class="icon-button" title="重新扫描" aria-label="重新扫描" :disabled="!root || running" @click="scan"><RefreshCw :size="iconSize.control" /></button></div>
    </div>
    <div class="todo-body">
      <div class="todo-toolbar" role="toolbar" aria-orientation="vertical" aria-label="任务视图工具栏">
        <button class="icon-button" title="上一个出现位置" aria-label="上一个出现位置" :disabled="!occurrences.length" @click="step(-1)"><ArrowUp :size="iconSize.control" /></button>
        <button class="icon-button" title="下一个出现位置" aria-label="下一个出现位置" :disabled="!occurrences.length" @click="step(1)"><ArrowDown :size="iconSize.control" /></button>
        <label class="todo-filter-button" title="按标记或过滤器过滤" :aria-label="`当前过滤：${filterName || filterPattern || '全部'}`">
          <Filter :size="iconSize.control" />
          <select v-model="filterValue" aria-label="标记过滤"><option value="">全部</option><optgroup v-if="todoFilters.length" label="过滤器"><option v-for="filter in todoFilters" :key="filter.name" :value="`filter:${filter.name}`">{{ filter.name }}</option></optgroup><optgroup label="标记"><option v-for="pattern in patterns" :key="pattern.pattern" :value="`pattern:${pattern.pattern}`">{{ pattern.description || pattern.pattern }}</option></optgroup></select>
        </label>
        <label class="todo-filter-button" title="按作用域过滤" :aria-label="`当前作用域：${scopeName || '全部'}`">
          <Layers :size="iconSize.control" />
          <select v-model="scopeName" aria-label="作用域过滤"><option value="">全部作用域</option><option :value="TODO_CURRENT_FILE_SCOPE">当前文件</option><option :value="TODO_CHANGE_LIST_SCOPE">变更列表</option><option v-for="scope in scopes" :key="scope.name" :value="scope.name">{{ scope.name }}</option></select>
        </label>
        <button class="icon-button" :class="{ toggled: autoScroll }" :aria-pressed="autoScroll" title="自动滚动到源码位置" aria-label="自动滚动到源码位置" @click="autoScroll = !autoScroll"><LocateFixed :size="iconSize.control" /></button>
        <button class="icon-button" title="展开全部" aria-label="展开全部" @click="expandAll"><ChevronsDown :size="iconSize.control" /></button>
        <button class="icon-button" title="折叠全部" aria-label="折叠全部" @click="collapseAll"><ChevronsUp :size="iconSize.control" /></button>
        <div class="todo-groupby">
          <button class="icon-button" :class="{ toggled: groupByOpen }" aria-haspopup="true" :aria-expanded="groupByOpen" title="分组方式" aria-label="分组方式" @click="groupByOpen = !groupByOpen"><Group :size="iconSize.control" /></button>
          <div v-if="groupByOpen" class="groupby-popup" role="group" aria-label="分组方式">
            <label><input v-model="showPackages" type="checkbox" /><span>按包（目录）分组</span></label>
            <label :class="{ disabled: !showPackages }"><input v-model="flattenPackages" type="checkbox" :disabled="!showPackages" /><span>扁平化包</span></label>
            <label><input v-model="multiLine" type="checkbox" /><span>多行任务</span></label>
          </div>
        </div>
        <button class="icon-button" :class="{ toggled: showPreview }" :aria-pressed="showPreview" title="预览" aria-label="预览" @click="showPreview = !showPreview"><Eye :size="iconSize.control" /></button>
      </div>
      <div class="todo-stack">
        <p v-if="!isDesktop" class="todo-note">浏览器预览不能扫描工作区，请在桌面端使用。</p>
        <template v-else>
          <p v-if="error" class="todo-error">{{ error }}</p>
          <p v-if="!root" class="todo-note">尚未打开项目。</p>
        </template>
        <p v-if="multilineNote" class="todo-note" aria-live="polite">{{ multilineNote }}</p>
        <p v-if="extraPlaceNote" class="todo-note" aria-live="polite">{{ extraPlaceNote }}</p>
        <p v-if="changeListNote" class="todo-note" aria-live="polite">{{ changeListNote }}</p>
        <div class="todo-scroll" role="tree" aria-label="任务列表" tabindex="0"
             @click="groupByOpen = false" @keydown="onTreeKeydown">
          <p v-if="speedQuery" class="todo-speed" aria-live="polite">搜索：{{ speedQuery }}</p>
          <div v-if="running" class="todo-empty">扫描中…</div>
          <template v-else-if="displayRows.length">
            <template v-for="(cell, index) in displayRows" :key="`${nodeKey(cell.row.node)}:${cell.row.item ? cell.row.item.line : 'node'}:${index}`">
              <button
                v-if="cell.row.item" class="todo-node todo-row" role="treeitem"
                :class="{ selected: selected?.path === cell.row.item.path && selected?.line === cell.row.item.line }"
                :style="{ paddingLeft: `${6 + cell.row.depth * 14}px` }"
                :aria-selected="selected?.path === cell.row.item.path && selected?.line === cell.row.item.line"
                :title="`${cell.row.item.path}:${cell.row.item.line}`"
                @click="select(cell.row.item)" @dblclick="open(cell.row.item)" @keydown.enter.prevent="open(cell.row.item)"
              >
                <span v-if="cell.row.item.kind" class="todo-color-dot" :style="{ background: itemColor(cell.row.item.text) }" aria-hidden="true"></span>
                <span v-if="cell.row.item.kind" class="todo-kind">{{ cell.row.item.kind }}</span>
                <span class="todo-text">
                  <span class="todo-head">{{ cell.display?.head }}</span>
                  <span v-for="(extra, extraIndex) in cell.display?.lines ?? []" :key="`${cell.row.item.line}:${extraIndex}`" class="todo-extra">{{ extra }}</span>
                  <span v-if="cell.display?.more" class="todo-more">（还有更多行）</span>
                </span>
                <span class="todo-pos">{{ cell.row.item.line }}</span>
              </button>
              <button
                v-else-if="cell.row.node.kind === 'package'" class="todo-node package" role="group"
                :style="{ paddingLeft: `${6 + cell.row.depth * 14}px` }" :aria-expanded="cell.row.expanded"
                @click="togglePackage(cell.row.node)" @keydown.enter.prevent="togglePackage(cell.row.node)"
              >
                <ChevronRight aria-hidden="true" :size="iconSize.dense" class="tree-chevron" :class="{ expanded: cell.row.expanded }" /><Folder aria-hidden="true" :size="iconSize.dense" class="folder-icon" /><span class="todo-node-label">{{ cell.row.node.label }}</span>
              </button>
              <div v-else class="todo-node file" :style="{ paddingLeft: `${6 + (cell.row.depth + 1) * 14}px` }">
                <FileCode2 :size="iconSize.dense" /><span class="todo-node-label">{{ cell.row.node.label }}</span><span class="todo-node-count">{{ cell.row.node.items.length }}</span>
              </div>
            </template>
          </template>
          <div v-else-if="scanned" class="todo-empty">{{ items.length ? '没有符合当前过滤标记的任务。' : '没有找到标记。到 设置 › 编辑器 › TODO 里增减 TODO 模式。' }}</div>
          <div v-else class="todo-empty">打开项目后自动扫描注释中的 TODO / FIXME 等标记。</div>
        </div>
        <p v-if="showPreview && previewError" class="todo-error">{{ previewError }}</p>
        <section v-if="showPreview && preview" class="todo-preview" aria-label="预览">
          <div class="preview-head">{{ preview.path }}</div>
          <pre class="preview-lines"><span
            v-for="(line, index) in preview.lines"
            :key="preview.start + index"
            class="preview-line"
            :class="{ current: preview.start + index + 1 === preview.line }"
          >{{ preview.start + index + 1 }}  <span
            v-for="(part, partIndex) in markerSegments(line)"
            :key="`${preview.start + index}:${partIndex}`"
            :class="{ marked: part.mark }"
            :style="part.mark ? { color: itemColor(line) } : undefined"
          >{{ part.text }}</span></span></pre>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.todo-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; background: var(--editor); color: var(--text); }
.todo-body { display: flex; flex: 1; min-width: 0; min-height: 0; }
.todo-toolbar { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; padding: var(--space-1) 2px; border-right: 1px solid var(--line-strong); background: var(--rail); }
.todo-toolbar .icon-button.toggled { color: var(--accent); background: var(--accent-soft); }
.todo-filter-button { position: relative; display: grid; place-items: center; width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); border-radius: var(--radius-xs); color: var(--secondary); cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.todo-filter-button:hover { background: var(--hover); color: var(--bright); }
.todo-filter-button:focus-within { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.todo-filter-button select { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: inherit; }
.todo-groupby { position: relative; }
.groupby-popup { position: absolute; left: 26px; top: 0; z-index: 5; display: flex; flex-direction: column; gap: 2px; min-width: 148px; padding: var(--space-1) var(--space-2); background: var(--elevated); color: var(--popup-foreground); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--popup-shadow); }
.groupby-popup label { display: flex; align-items: center; gap: var(--space-2); min-height: var(--menu-row-height); font-size: 12px; color: var(--text); }
.groupby-popup label.disabled { color: var(--muted); }
.groupby-popup input { width: var(--icon-size-checkbox); height: var(--icon-size-checkbox); accent-color: var(--accent); }
.todo-stack { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; background: var(--editor); }
.todo-note, .todo-error { margin: 0; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.todo-note { color: var(--secondary); background: var(--rail); }
.todo-error { border-left: 2px solid var(--error); background: var(--error-bg); color: var(--error); }
.todo-scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: var(--space-1) 0 var(--space-2); }
.todo-node { display: flex; align-items: center; gap: var(--space-1); width: 100%; min-height: var(--tree-row-h); border: 0; background: transparent; color: var(--text); text-align: left; font: 12px/1.4 var(--font-ui); }
.todo-node.package, .todo-node.file { padding-top: 0; padding-right: var(--space-2); padding-bottom: 0; color: var(--secondary); }
.todo-node.file > svg { color: var(--accent); }
.todo-row { gap: var(--space-2); padding-top: 2px; padding-right: var(--space-3); padding-bottom: 2px; color: var(--text); cursor: pointer; }
.todo-row:hover, .todo-node:hover { background: var(--hover); }
.todo-row.selected { background: var(--selected); box-shadow: inset 2px 0 0 var(--accent); color: var(--bright); }
.todo-row:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.todo-node-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo-node-count { margin-left: auto; color: var(--muted); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; }
.todo-kind { flex-shrink: 0; color: var(--warning); font-size: 10px; font-weight: 600; }
/* 颜色方案列（IDEA TodoPanel 的标记颜色）：模式自带的 #RRGGBB，缺省中性色。 */
.todo-color-dot { flex-shrink: 0; width: 8px; height: 8px; border-radius: 50%; }
.todo-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px/1.45 var(--font-mono); }
/* 多行任务（`MultiLineTodoRenderer.java:16,64-76` 的等价形状）：主行在上、续行逐行跟在下面，
   超过 10 行只给一行「更多」提示，和上游的 myMoreLabel 一样不硬塞。 */
.todo-text { display: flex; flex-direction: column; align-items: flex-start; }
.todo-head, .todo-extra, .todo-more { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo-extra, .todo-more { color: var(--muted); font-size: 11px; }
/* 速度搜索的当前串（`SpeedSearchBase` 那个浮动搜索框在本仓就是一行状态文字）。 */
.todo-speed { margin: 0; padding: var(--space-2) var(--space-3); color: var(--secondary); background: var(--rail); border-bottom: 1px solid var(--line-strong); font: 11px var(--font-mono); }
.todo-scroll:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
/* 预览里标记词的上色（`TodoHighlightVisitor.java:96-107`）：颜色来自模式表，不写死。 */
.preview-line .marked { font-weight: 600; background: var(--selected); }
.todo-pos { flex-shrink: 0; color: var(--muted); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; }
.tree-chevron { flex-shrink: 0; transition: transform var(--dur-1) var(--ease); }
.tree-chevron.expanded { transform: rotate(90deg); }
.folder-icon { flex-shrink: 0; color: var(--accent); }
.todo-empty { margin: var(--space-2) var(--space-3); padding: var(--space-2) var(--space-3); border-left: 2px solid var(--line-strong); color: var(--secondary); font-size: 12px; line-height: 1.6; }
.todo-preview { flex-shrink: 0; max-height: 40%; overflow: auto; border-top: 1px solid var(--line-strong); background: var(--panel); }
.preview-head { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line-strong); background: var(--rail); color: var(--secondary); font: 11px var(--font-mono); }
.preview-lines { margin: 0; padding: var(--space-2) var(--space-3); font: 11px/1.6 var(--font-mono); color: var(--secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.preview-line { display: block; }
.preview-line.current { color: var(--bright); background: var(--selected); box-shadow: inset 2px 0 0 var(--accent); }
</style>
