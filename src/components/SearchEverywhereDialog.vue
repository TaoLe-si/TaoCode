<script setup lang="ts">
// Search Everywhere 对话框：IDEA 263 的新分屏实现（`com.intellij.platform.searchEverywhere`）。
//
// 一个对话框同时搜多个供给者，而不是像改造前那样「随处搜索」和「查找操作」共用一个面板 ——
// 那是本仓的假实现：菜单里有「随处搜索 Shift+Shift」，但它打开的是 Find Action 面板。
//
// 纯逻辑（tab 集合、过滤、排序、循环）在 src/searchEverywhere.ts，可单测；这里只管渲染与按键。
// tab 只渲染有真实供给者的（见该文件头），所以 tab 行不会出现永远空着的一页。
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowRight, Eye, EyeOff, File, Filter, Folder, Search, X } from 'lucide-vue-next'
import SearchEverywherePreview from './SearchEverywherePreview.vue'
import { clampPopupLocation, parsePopupBounds, serializePopupBounds, type PopupBounds } from '../popupBounds'
import {
  SEARCH_EVERYWHERE_LIMIT,
  SEARCH_EVERYWHERE_TABS,
  availableSearchEverywhereTabs,
  cycleSearchEverywhereTab,
  fuzzyTitleFragments,
  moveSearchEverywhereIndex,
  searchEverywhereResults,
  searchEverywhereSourceLabel,
  type SearchEverywhereItem,
  type SearchEverywhereTab,
} from '../searchEverywhere'

import { iconSize } from '../uiIcons'
// 空态文案（上游 `SearchEverywhereEmptyTextProvider` + `SearchEverywhereUI.updateEmptyText`）：
// 按 tab 与"用过哪些搜索选项"给不同提示，规则全在 src/searchEverywhereEmpty.ts（纯函数）。
import { searchEverywhereEmptyText } from '../searchEverywhereEmpty'
// 作用域选择（上游 `ScopeChooserAction`）：候选、过滤、以及"能不能在项目/所有位置间切换"的判据。
import { PROJECT_SCOPE_NAME, filterByScope, scopeChoices } from '../searchEverywhereScope'
// **tab 表定制**（上游 `SeTabsCustomizer`）：本仓没有插件实现它，但有一个真实的定制需求 ——
// 宿主没给 Text 档通道时那一档整档摘掉（上游 `SeTextTab.kt:37-39` 没有 project 时
// `getTextSearchOptions()` 返回 null，那一档就没有筛选器可编辑）。
import { isTypeFilterEnabled, visibleEverywhereTabs, type TabCustomization } from '../searchEverywhereTabs'
// **每一档自己的筛选器**（上游 `SeTargetsFilterEditor`）：作用域按档存档、预览开关按档存档、
// 类型漏斗（`SeTypeVisibilityStateHolder`）。
import {
  FILTER_HEADER_ACTIONS,
  acceptsByHiddenTypes,
  fileTypeNameOf,
  initialTargetsFilter,
  isTypeVisible,
  readPersistedPreview,
  readPersistedScope,
  setTypeVisibility,
  typeVisibilityStates,
  writePersistedPreview,
  writePersistedScope,
  type TypeVisibilityState,
} from '../searchEverywhereFilters'
// **Top Hit 分组**（上游 `TopHitSEContributor`）：点得最多的那几条钉在最前，组名「点击最多」。
import { TOP_HIT_GROUP_NAME, loadUsage, pinTopHits, recordEverywhereUsage, topHitIds, type UsageEntry } from '../searchEverywhereTopHit'
import { TEXT_OPTION_LABELS, type TextSearchOptions } from '../searchEverywhereText'
import type { NamedScopeSetting } from '../settingsModel'
/** 把一段文本按 [start,end) 区间切成普通段与高亮段，模板里直接 v-for 渲染。 */
function highlightParts(text: string, fragments: readonly [number, number][]) {
  if (!fragments.length) return [{ text, hit: false }]
  const parts: { text: string; hit: boolean }[] = []
  let cursor = 0
  for (const [start, end] of fragments) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), hit: false })
    parts.push({ text: text.slice(start, end), hit: true })
    cursor = end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false })
  return parts
}

const props = defineProps<{
  open: boolean
  items: SearchEverywhereItem[]
  /** 查询词变化时交给宿主：符号供给者要据此异步问语言服务（带防抖，在宿主那边）。 */
  onQuery?: (query: string) => void
  /** 文件来源是否改用 Smith-Waterman 模糊匹配（注册表键 search.everywhere.fuzzy.files.enabled，默认 false）。 */
  fuzzyFiles?: boolean
  /** 命名作用域表（项目设置 `project.scopes`）—— 作用域选择器的候选。 */
  scopes?: NamedScopeSetting[]
  /** 模块名（作用域表达式里 `file[Name]:` 要比对的那个）。 */
  moduleName?: string
  /**
   * Text 档的三个开关（上游 `SeTextSearchOptions`，`SeTextTab.kt:37-43` 从 `FindModel` 取）。
   * 宿主没接上时给 null/undefined ⇒ **Text 档整档不渲染**（没有开关 = 没有这一档的筛选器）。
   */
  textOptions?: TextSearchOptions | null
  /** 开关改动 → 宿主按新开关重扫。 */
  onTextOption?: (key: keyof TextSearchOptions, value: boolean) => void
  /** 切档 → 宿主决定要不要发整工作区扫描（只有 All / Text 两档会发）。 */
  onTab?: (tab: SearchEverywhereTab) => void
  /**
   * 会话历史（上游 `SearchEverywhereManagerImpl.java:423-427` 把 `showHistoryItem(true/false)` 注册成
   * `SearchTextField.SHOW_HISTORY_SHORTCUT`（Alt+Down）/ `ALT_SHOW_HISTORY_SHORTCUT`（Alt+Up））。
   * 规则与存档在 `src/searchEverywhereHistory.ts`，宿主出口 `src/searchEverywhereHost.ts:274/:282`：
   *   · `historyStep(next)` —— Alt+Down/Up 要填进输入框的那个词（`next=true` = 更新的一条）；
   *   · `historyText()` —— 打开弹层时预填最近一条（`:128` 的 `myHistoryIterator.prev()`）。
   * 未接时（undefined）两条键不生效，行为与今天一致。
   */
  historyStep?: (next: boolean) => string
  historyText?: () => string
}>()
const emit = defineEmits<{ close: []; /** 空态里"在文件中查找"的落点（宿主打开工程内搜索）。 */ findInFiles: [] }>()

const query = ref('')
const tab = ref<SearchEverywhereTab>('all')
// 作用域那一档（上游 `ScopeChooserAction`）。默认"项目"（= 不过滤，本仓的文件清单本来就只含
// 工作区内的文件）；用户选命名作用域后只筛**文件与符号**两类供给者（见 searchEverywhereResults）。
// **按 tab 存档**（上游 `SeScopePersistentStorage` 的键是 `SearchEverywhere.PersistedScope.$tabId`，
// `SeTargetsFilterEditor.kt:95`）：Files 档选了「库外」不会带进 Classes 档。
const scopeByTab = ref<Record<string, string>>({})
const previewByTab = ref<Record<string, boolean>>({})
const typeStatesByTab = ref<Record<string, TypeVisibilityState[]>>({})
const index = ref(0)
const input = ref<HTMLInputElement | null>(null)
/** Top Hit 表（`recordEverywhereUsage` 写的那份 localStorage）。打开弹层时读一次。 */
const usage = ref<UsageEntry[]>([])

const scopeOptions = computed(() => scopeChoices(props.scopes ?? []))
/**
 * tab 表定制（`SeTabsCustomizer` 的等价物）。
 * 两件事都是**真数据**：Text 档在没有宿主通道时摘掉；类型漏斗只在真的会长出类型的档开
 * （Actions / Run Configurations / Text 三档的候选里根本没有文件行）。
 */
const tabCustomization = computed<TabCustomization>(() => ({
  hidden: props.textOptions ? {} : { text: true } as Record<string, boolean>,
  typeFilterEnabled: { commands: false, runConfigs: false, text: false },
}))
/** 存档里读回的作用域名（`persistedScopeKey(tabId)`；查不到名字时由 `initialTargetsFilter` 回落）。 */
const persistedScopeName = computed(() => scopeByTab.value[tab.value] ?? readPersistedScope(tab.value) ?? null)
/**
 * 这一档的筛选器初值（上游 `SeTargetsFilterEditor.kt:30-45`）。
 * `typeFilterEnabled` 为假时 `hiddenTypes` 被强制清空 —— 那条注释（关掉了可见筛选器就得把状态归干净）
 * 就是这一行代码存在的理由。
 */
const filter = computed(() => initialTargetsFilter({
  tabId: tab.value,
  scopesInfo: scopeOptions.value.length > 1
    ? { selectedScopeId: PROJECT_SCOPE_NAME, everywhereScopeId: PROJECT_SCOPE_NAME, scopeNames: scopeOptions.value.map(choice => choice.name) }
    : null,
  typeVisibilityStates: typeStatesByTab.value[tab.value] ?? [],
  hasPreviewAction: true,
  persistScopeIfAvailable: true,
  typeFilterEnabled: isTypeFilterEnabled(tab.value, tabCustomization.value),
  persistedScopeName: persistedScopeName.value,
}))
const scopeName = computed({
  get: () => filter.value.scopeId ?? PROJECT_SCOPE_NAME,
  set: (name: string) => {
    scopeByTab.value = { ...scopeByTab.value, [tab.value]: name }
    writePersistedScope(tab.value, name)
  },
})
const activeScope = computed(() => scopeOptions.value.find(choice => choice.name === scopeName.value) ?? scopeOptions.value[0]!)
// `filterByScope`：表达式为 null（项目档）时原样放行；坏表达式也放行（列表来自设置页的校验）。
const scopePredicate = computed(() => {
  const expression = activeScope.value?.expression ?? null
  if (expression === null) return () => true
  const allowed = new Set(filterByScope(props.items, item => item.fuzzyPath ?? item.path ?? item.title, expression, { moduleName: props.moduleName }).map(item => item.id))
  return (item: SearchEverywhereItem) => allowed.has(item.id)
})
/** 先算**没有过类型漏斗**的那一批：漏斗的候选类型要从这一批里长出来。 */
const untyped = computed(() => searchEverywhereResults(
  props.items, query.value, tab.value, SEARCH_EVERYWHERE_LIMIT, props.fuzzyFiles, scopePredicate.value,
))
/** 这一批里真实出现的文件类型（上游 `SeFilesProvider.getAllFileTypes()`，`:74`）。 */
const presentTypes = computed(() => [...new Set(
  untyped.value.filter(item => item.source === 'project').map(item => fileTypeNameOf(item.fuzzyPath ?? item.title)),
)])
/** 漏斗的表 = 已存的勾选状态 + 这一批新长出来的类型（新出现的默认开着）。 */
const typeStates = computed(() => typeVisibilityStates(presentTypes.value, typeStatesByTab.value[tab.value] ?? []))
const hiddenTypes = computed(() => filter.value.hiddenTypes)
/** Top Hit 的钉选集合（上游 `getElementPriority() = 15000`：不重打分，只是钉到最前）。 */
const topIds = computed(() => topHitIds(untyped.value, usage.value, query.value))
/** 类型漏斗作用在这一批上（黑名单：`hiddenTypes` 里的那些不进列表），再把 Top Hit 钉到最前。 */
const results = computed(() => pinTopHits(
  untyped.value.filter(item => item.source !== 'project' || acceptsByHiddenTypes(hiddenTypes.value, fileTypeNameOf(item.fuzzyPath ?? item.title))),
  topIds.value,
))
function toggleType(name: string, value: boolean) {
  typeStatesByTab.value = { ...typeStatesByTab.value, [tab.value]: setTypeVisibility(typeStates.value, name, value) }
}
/** 类型漏斗面板的开合（面板里勾完不用关：连着关几种类型是常态）。 */
const funnelOpen = ref(false)
/**
 * 三个开关的按钮字面（与「在文件中查找」面板同一套写法，`src/components/SearchPanel.vue:639-641`）。
 * 文案本身取 `TEXT_OPTION_LABELS`（title/aria-label 都用它），这里只是格子里那两个字。
 */
const OPTION_GLYPHS: Record<keyof TextSearchOptions, string> = { caseSensitive: 'Aa', wholeWords: '词', regex: '.*' }

/** 空态（没有结果且查询词非空时才有；查询词为空时上游也不显示，见那个模块的头注释）。 */
const emptyText = computed(() => (results.value.length ? null : searchEverywhereEmptyText(
  tab.value, query.value,
  // **订正 2026-10-06（桶 9b）**：上一版这里恒传 `{}`（"本仓 SE 的输入框没有这三档开关"）。
  // Text 档接上宿主之后有了：`SeTextTab.kt:37-43` 的三个开关就是 `props.textOptions`，
  // 空态里「使用的搜索选项：」那一行据此才真的会出现（上游 `TextSearchContributor:282-300`）。
  props.textOptions && (tab.value === 'text' || tab.value === 'all') ? props.textOptions : {},
)))

// 每行的命中区间：文件档取 Smith-Waterman 的下标，Text 档取宿主给的 column+length
// （上游文本搜索随命中一起交出的 `MyRange`）。
const fragmentCache = computed(() => results.value.map(entry =>
  entry.source === 'text' ? entry.hitRanges ?? [] : fuzzyTitleFragments(entry, query.value, props.fuzzyFiles)))
// SePopupContentPane 的 tab model 不依赖当前查询结果；零结果也保留切换入口。
// 表本身过一遍 `SeTabsCustomizer` 的等价物（改名/摘档/按 priority 降序）。
const tabs = computed(() => visibleEverywhereTabs(SEARCH_EVERYWHERE_TABS, tabCustomization.value))
const selected = computed(() => results.value[index.value])
// SePopupContentPane.createSplitter: vertical=true, default proportion .33, persisted key.
const splitRatio = ref(0.33)
const splitContainer = ref<HTMLElement | null>(null)
/** 旧的全局预览键：只用来给"这一档还没存过"时当默认值，不再往里写。 */
const PREVIEW_KEY = 'taocode.searchEverywhere.preview'
/** `readPersistedPreview` 的 fallback（上游 PreviewAction 的状态挂在**每一档**的 filter 上）。 */
const legacyPreviewDefault = (() => {
  try { return localStorage.getItem(PREVIEW_KEY) !== 'false' } catch { return true }
})()
const showPreview = computed({
  get: () => previewByTab.value[tab.value] ?? readPersistedPreview(tab.value, legacyPreviewDefault),
  set: (on: boolean) => {
    previewByTab.value = { ...previewByTab.value, [tab.value]: on }
    writePersistedPreview(tab.value, on)
  },
})
const SPLIT_KEY = 'taocode.searchEverywhere.splitRatio'
// 浮层的尺寸与位置记忆（上游 `AbstractPopup.setDimensionServiceKey(project, "search.everywhere.popup", true)`
// —— `SearchEverywhereManagerImpl.java:147`，第三参 `true` = 连位置一起记
// （`PopupChooserBuilder.java:284-287` 的 `setUseDimensionServiceForXYLocation`）。
// 读不到存档就用自己的首选尺寸（`:184-188` 的 `getStoredSize()` 为 null 分支）。
const BOUNDS_KEY = 'taocode.searchEverywhere.bounds'
const popupEl = ref<HTMLElement | null>(null)
const stored = ref<PopupBounds | null>(null)
try {
  stored.value = parsePopupBounds(localStorage.getItem(BOUNDS_KEY),
    { width: window.innerWidth, height: window.innerHeight })
} catch { /* Storage unavailable: 本次会话用默认尺寸 */ }
/** 记下的位置可用（夹回视口后仍在屏幕内）时才贴过去，否则继续用居中的默认布局。 */
const placed = computed(() => Boolean(stored.value && clampPopupLocation(stored.value, { width: window.innerWidth, height: window.innerHeight })))
const popupStyle = computed(() => {
  const at = stored.value ? clampPopupLocation(stored.value, { width: window.innerWidth, height: window.innerHeight }) : null
  return {
    ...(stored.value ? { width: `${stored.value.width}px`, height: `${stored.value.height}px` } : {}),
    ...(at ? { left: `${at.x}px`, top: `${at.y}px`, margin: '0' } : {}),
  }
})
/** `AbstractPopup.storeDimensionSize()`（:2314-2318）：尺寸/位置变了就写回。 */
function storeBounds() {
  const box = popupEl.value?.getBoundingClientRect()
  if (!box) return
  try { localStorage.setItem(BOUNDS_KEY, serializePopupBounds({ width: box.width, height: box.height, x: box.left, y: box.top })) }
  catch { /* Session-only. */ }
}
// 拖动标题行移动浮层（上游 `setMovable(true)`）。
let dragFrom: { x: number; y: number; left: number; top: number } | null = null
function startMove(event: PointerEvent) {
  if (event.button !== 0) return
  const box = popupEl.value?.getBoundingClientRect()
  if (!box) return
  dragFrom = { x: event.clientX, y: event.clientY, left: box.left, top: box.top }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function movePopup(event: PointerEvent) {
  if (!dragFrom) return
  const box = popupEl.value?.getBoundingClientRect()
  if (!box) return
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const at = clampPopupLocation(
    { width: box.width, height: box.height, x: dragFrom.left + (event.clientX - dragFrom.x), y: dragFrom.top + (event.clientY - dragFrom.y) },
    viewport)
  if (at) stored.value = { width: box.width, height: box.height, x: at.x, y: at.y }
}
function stopMove() { if (!dragFrom) return; dragFrom = null; storeBounds() }
function clampSplit(value: number) { return Math.max(0.2, Math.min(0.8, value)) }
try {
  const saved = localStorage.getItem(SPLIT_KEY)
  if (saved !== null && Number.isFinite(Number(saved))) splitRatio.value = clampSplit(Number(saved))
} catch { /* Storage unavailable: session-only preferences. */ }
// 预览开关的存档挪到了 `searchEverywhereFilters.ts`（按 tab 一个键，
// `SearchEverywhere.Preview.$tabId`）， setter 里直接写，不再需要 watch。
function saveSplit() {
  try { localStorage.setItem(SPLIT_KEY, String(splitRatio.value)) } catch { /* Session-only. */ }
}
let dragPointer: number | null = null
function startSplit(event: PointerEvent) {
  if (event.button !== 0) return
  dragPointer = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}
function moveSplit(event: PointerEvent) {
  if (dragPointer !== event.pointerId) return
  const bounds = splitContainer.value?.getBoundingClientRect()
  if (bounds?.height) splitRatio.value = clampSplit((event.clientY - bounds.top) / bounds.height)
}
function stopSplit() { if (dragPointer !== null) { dragPointer = null; saveSplit() } }
function splitKey(event: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  splitRatio.value = event.key === 'Home' ? 0.2 : event.key === 'End' ? 0.8 : clampSplit(splitRatio.value + (event.key === 'ArrowUp' ? -0.02 : 0.02))
  saveSplit()
}
const resultList = ref<HTMLElement | null>(null)
watch(results, (next, previous) => {
  const id = previous[index.value]?.id
  const retained = next.findIndex(item => item.id === id)
  index.value = retained >= 0 ? retained : Math.min(index.value, Math.max(0, next.length - 1))
}, { flush: 'sync' })
watch([index, results], async () => {
  await nextTick()
  resultList.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
})

// 换了查询或 tab 就回到第一项 —— 否则选中项会停在一个已经不存在的下标上。
watch([query, tab], () => { index.value = 0 })
// tab 变了要通知宿主：Text 档的整工作区扫描只在 All / Text 两档发（其余档连请求都不该打）。
// 换档同时关掉类型漏斗的面板 —— 表是每档自己的，留着会对着另一档勾错。
watch(tab, value => { funnelOpen.value = false; props.onTab?.(value) })
// 查询词交给宿主（符号供给者要用它去问语言服务）。
watch(query, value => props.onQuery?.(value))
watch(() => props.open, async open => {
  if (!open) { props.onQuery?.(''); return }
  // 打开时预填最近一条历史（`SearchEverywhereManagerImpl.java:128` 的 `myHistoryIterator.prev()`，
  // 出口 `src/searchEverywhereHost.ts:282`）。没历史时给空串 ⇒ 输入框仍是空的。
  query.value = props.historyText?.() ?? ''
  tab.value = 'all'
  index.value = 0
  // 每次打开重读"点得最多"表（上一次会话里记的用量要在这一次生效）。
  usage.value = loadUsage()
  // 档内的筛选状态回到各自存档（`persistedScopeKey(tabId)` / `SearchEverywhere.Preview.$tabId`）。
  scopeByTab.value = {}
  previewByTab.value = {}
  await nextTick()
  input.value?.focus()
  props.onTab?.(tab.value)
})

function move(delta: number) { index.value = moveSearchEverywhereIndex(index.value, results.value.length, delta) }
/**
 * `Alt+Down` / `Alt+Up`（上游 `SearchTextField.SHOW_HISTORY_SHORTCUT` / `ALT_SHOW_HISTORY_SHORTCUT`，
 * `SearchEverywhereManagerImpl.java:423-427` 的 `showHistoryItem(true/false)` → `:465-472` 把取到的词
 * `setText` 进搜索框并 `selectAll`）：把宿主的 `searchHistoryStep(next)` 结果写回输入框并全选。
 * 未接宿主（`historyStep` 未给）时整条不动。
 */
function applyHistoryStep(next: boolean) {
  const text = props.historyStep?.(next)
  if (text === undefined) return
  query.value = text
  void nextTick(() => input.value?.select())
}
/**
 * 能切过去的档 = **在 tab 表里**（过了 `SeTabsCustomizer`）且**有结果**的那几档。
 * 只看结果不看定制表会把用户送进一个 tab 行上根本不存在的一档；
 * 只看定制表不看结果就是老版本"Tab 键切到永远空着的档"的那个坑。
 */
const availableTabs = computed(() => {
  const visible = new Set(tabs.value.map(entry => entry.id))
  return availableSearchEverywhereTabs(props.items, query.value, props.fuzzyFiles).filter(id => visible.has(id))
})
function cycle(delta: number) { tab.value = cycleSearchEverywhereTab(tab.value, delta, availableTabs.value) }
/**
 * 选中一条：先记一次用量（上游 `TopHitSEContributor` 的候选就来自这份表），再交给供给者打开。
 * `recordEverywhereUsage` 只写 localStorage，写不进（隐私模式）不影响这一次打开。
 */
function choose(item: SearchEverywhereItem) {
  usage.value = recordEverywhereUsage({ id: item.id, title: item.title, source: item.source })
  emit('close')
  void item.open(query.value)
}
function chooseSelected() { const picked = results.value[index.value]; if (picked) choose(picked) }
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <section ref="popupEl" class="command-palette search-everywhere" :class="{ 'with-preview': showPreview && selected?.preview, 'is-placed': placed }" :style="popupStyle" role="dialog" aria-modal="true" aria-label="随处搜索" @keydown.esc.stop="emit('close')" @pointerup="storeBounds">
      <div class="palette-input se-drag-handle" @pointerdown="startMove" @pointermove="movePopup" @pointerup="stopMove" @pointercancel="stopMove" @lostpointercapture="stopMove">
        <Search :size="iconSize.action" />
        <input
          ref="input"
          v-model="query"
          placeholder="随处搜索…（文件、类、动作、运行配置）"
          aria-label="随处搜索"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.tab.prevent="cycle($event.shiftKey ? -1 : 1)"
          @keydown.enter.prevent="chooseSelected()"
          @keydown.alt.down.prevent="applyHistoryStep(true)"
          @keydown.alt.up.prevent="applyHistoryStep(false)"
        />
        <button class="icon-button" aria-label="关闭随处搜索" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <div class="se-tabs" role="tablist">
        <button
          v-for="entry in tabs"
          :key="entry.id"
          class="se-tab"
          role="tab"
          :aria-selected="entry.id === tab"
          :class="{ active: entry.id === tab }"
          @click="tab = entry.id"
        >{{ entry.label }}</button>
        <!-- 每档自己的头部动作，**顺序按上游**：`getHeaderActions() = [作用域, 预览, 类型]`
             （`SeTargetsFilterEditor.kt:72-74`）。三格都是真控件：作用域只在有可选项时出现、
             预览切这一档的预览、类型漏斗只在当前这批结果真的长出类型时才出现。 -->
        <template v-for="action in FILTER_HEADER_ACTIONS" :key="action">
          <select
            v-if="action === 'scope' && scopeOptions.length > 1"
            v-model="scopeName"
            class="se-scope"
            aria-label="作用域"
          >
            <option v-for="choice in scopeOptions" :key="choice.name" :value="choice.name">{{ choice.name }}</option>
          </select>
          <button
            v-else-if="action === 'preview'"
            class="se-tab se-tab-icon"
            :aria-pressed="showPreview"
            :aria-label="showPreview ? '关闭预览' : '打开预览'"
            @click="showPreview = !showPreview"
          ><Eye v-if="showPreview" :size="iconSize.control" /><EyeOff v-else :size="iconSize.control" /></button>
          <div v-else-if="action === 'type' && typeStates.length" class="se-funnel">
            <button
              class="se-tab se-tab-icon"
              :aria-expanded="funnelOpen"
              aria-label="按类型筛选结果"
              @click="funnelOpen = !funnelOpen"
            ><Filter :size="iconSize.control" /></button>
            <div v-if="funnelOpen" class="se-funnel-panel" role="group" aria-label="类型">
              <label v-for="state in typeStates" :key="state.name" class="se-funnel-row">
                <input type="checkbox" :checked="isTypeVisible(typeStates, state.name)" @change="toggleType(state.name, ($event.target as HTMLInputElement).checked)" />
                <File v-if="state.icon === 'File'" :size="iconSize.inline" aria-hidden="true" />
                <Folder v-else-if="state.icon === 'Folder'" :size="iconSize.inline" aria-hidden="true" />
                <span>{{ state.name }}</span>
              </label>
            </div>
          </div>
        </template>
        <!-- Text 档的三个开关（上游 `SeTextTab.kt:37-43` 从 `FindModel` 取的那三个布尔）。
             宿主没给开关（非桌面宿主 / 没工作区）时整行不渲染。 -->
        <span v-if="props.textOptions && (tab === 'text' || tab === 'all')" class="se-text-options">
          <button
            v-for="(label, key) in TEXT_OPTION_LABELS"
            :key="key"
            class="se-text-toggle"
            :class="{ on: props.textOptions[key] }"
            :aria-label="label"
            :aria-pressed="props.textOptions[key]"
            @click="props.onTextOption?.(key as keyof TextSearchOptions, !props.textOptions[key])"
          >{{ OPTION_GLYPHS[key] }}</button>
        </span>
      </div>
      <div ref="splitContainer" class="se-content" :style="{ '--se-ratio': `${splitRatio * 100}%` }">
      <div ref="resultList" class="palette-results" role="listbox" :aria-label="`${results.length} 条结果`">
        <button
          v-for="(entry, position) in results"
          :key="entry.id"
          class="se-row"
          role="option"
          :aria-selected="position === index"
          :class="{ highlighted: position === index }"
          @click="choose(entry)"
          @pointerenter="index = position"
        >
          <span class="se-title"><template v-for="(part, partIndex) in highlightParts(entry.title, fragmentCache[position] ?? [])" :key="partIndex"><mark v-if="part.hit" class="se-hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
          <span v-if="entry.subtitle" class="se-subtitle">{{ entry.subtitle }}</span>
          <!-- 被 Top Hit 钉住的行显示组名「点击最多」（上游 `TopHitSEContributor.getGroupName()`，
               中文包 `IdeBundle.properties:2313`），其余显示供给者名。 -->
          <span class="action-group">{{ topIds.has(entry.id) ? TOP_HIT_GROUP_NAME : searchEverywhereSourceLabel(entry.source) }}</span>
          <ArrowRight aria-hidden="true" :size="iconSize.control" />
        </button>
        <!-- 空态：上游按 tab 与用过的选项给不同文案（`SearchEverywhereUI.java:1926-2011`），
             并给一条去工程内查找的出路。 -->
        <div v-if="emptyText" class="palette-empty se-empty">
          <p v-if="emptyText.primary">{{ emptyText.primary }}</p>
          <p v-if="emptyText.usedOptions" class="se-empty-options">{{ emptyText.usedOptions }}</p>
          <button v-if="emptyText.action" class="se-empty-action" type="button" @click="emit('findInFiles')">
            {{ emptyText.action.label }}<template v-if="emptyText.action.shortcut"> ({{ emptyText.action.shortcut }})</template>
          </button>
        </div>
      </div>
      <div v-if="showPreview && selected?.preview" class="se-splitter" role="separator" tabindex="0" aria-label="调整搜索结果与预览高度" aria-orientation="horizontal" :aria-valuenow="Math.round(splitRatio * 100)" :aria-valuemin="20" :aria-valuemax="80"
        @pointerdown="startSplit" @pointermove="moveSplit" @pointerup="stopSplit" @pointercancel="stopSplit" @lostpointercapture="stopSplit" @keydown="splitKey" />
      <SearchEverywherePreview v-if="showPreview && selected?.preview" :item="selected" />
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 空态（上游 `StatusText` 的几段 append）：主行 + 可选的"用过的选项" + 一条可点的出路。 */
.se-empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); }
.se-empty-options { white-space: pre-line; color: var(--muted); }
.se-empty-action { padding: 0; border: 0; background: transparent; color: var(--accent); cursor: pointer; text-align: left; }
.se-empty-action:hover { text-decoration: underline; }
.search-everywhere { min-width: 0; width: min(720px, calc(100vw - 32px)); }
/* 记过尺寸/位置之后浮层用固定定位贴回去（上游 `AbstractPopup` 的 stored size/location 分支）。 */
.search-everywhere.is-placed { position: fixed; }
.se-drag-handle { cursor: default; touch-action: none; }
.search-everywhere.with-preview { width: min(1120px, calc(100vw - 32px)); }
.se-content { display: grid; min-height: 0; max-height: min(60vh, 600px); overflow: hidden; }
.with-preview .se-content { grid-template-rows: minmax(0, var(--se-ratio)) 5px minmax(0, 1fr); height: min(60vh, 600px); }
.se-splitter { background: var(--line, rgba(127,127,127,.25)); cursor: row-resize; touch-action: none; }
.se-splitter:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.palette-results { min-width: 0; overflow: auto; }
@media (max-width: 700px) { .se-hint { display: none; } .se-tabs { flex-wrap: wrap; } }
/* `--tc-border` / `--tc-hover` 不是 tokens.css 里的名字：这两个弹层一直退化成中性灰 rgba，
   深色主题下 hover 几乎看不见。改回真令牌 --line / --hover。 */
.se-tabs { display: flex; align-items: center; gap: var(--space-1); padding: 6px 10px; border-bottom: 1px solid var(--line); position: relative; }
.se-tab-icon { display: inline-flex; align-items: center; justify-content: center; padding: 0; width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); }
.se-tab-icon svg { flex-shrink: 0; }
/* 类型漏斗（上游 `getFilterTypesAction` 那格）：面板贴着那一格往下长，不占列表高度。 */
.se-funnel { position: relative; display: inline-flex; }
.se-funnel-panel { position: absolute; top: 100%; right: 0; z-index: 1; display: flex; flex-direction: column; gap: var(--space-1); min-width: 120px; padding: var(--space-1) var(--space-2); background: var(--popup-background); color: var(--popup-foreground); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--popup-shadow); }
.se-funnel-row { display: flex; align-items: center; gap: var(--space-1); font-size: 11px; }
.se-text-options { display: inline-flex; align-items: center; gap: 2px; margin-left: var(--space-1); }
.se-text-toggle { padding: 0 var(--space-1); height: var(--ctrl-height-sm); color: var(--muted); background: transparent; border: 1px solid var(--line); border-radius: var(--radius-xs); font: 11px var(--font-mono); cursor: pointer; }
.se-text-toggle.on { color: var(--text); border-color: var(--accent); background: var(--hover); }
.se-scope { height: var(--ctrl-height-sm); padding: 0 var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px var(--font-ui); }
.se-tab { background: none; border: 0; border-radius: var(--radius-sm); padding: 3px 10px; font: inherit; color: inherit; cursor: pointer; opacity: .7; transition: opacity var(--dur-1) var(--ease), background-color var(--dur-1) var(--ease); }
.se-tab:hover { opacity: 1; background: var(--hover); }
.se-tab.active { opacity: 1; font-weight: 600; box-shadow: inset 0 -2px 0 currentColor; }
.se-hint { margin-left: auto; font-size: 11px; opacity: .55; }
.se-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: none; border: 0; font: inherit; color: inherit; padding: 6px 10px; cursor: pointer; }
.se-row.highlighted { background: var(--hover); }
.se-title { flex: 0 0 auto; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 模糊命中的字符（上游 presentation 的 matched ranges）：只换底色，不改字重，行高不变。 */
.se-hit { background: var(--accent-soft, rgba(70, 130, 255, .28)); color: inherit; border-radius: 2px; padding: 0; }
.se-subtitle { flex: 1 1 auto; min-width: 0; font-size: 12px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
