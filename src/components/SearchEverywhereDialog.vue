<script setup lang="ts">
// Search Everywhere 对话框：IDEA 263 的新分屏实现（`com.intellij.platform.searchEverywhere`）。
//
// 一个对话框同时搜多个供给者，而不是像改造前那样「随处搜索」和「查找操作」共用一个面板 ——
// 那是本仓的假实现：菜单里有「随处搜索 Shift+Shift」，但它打开的是 Find Action 面板。
//
// 纯逻辑（tab 集合、过滤、排序、循环）在 src/searchEverywhere.ts，可单测；这里只管渲染与按键。
// tab 只渲染有真实供给者的（见该文件头），所以 tab 行不会出现永远空着的一页。
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowRight, Search, X } from 'lucide-vue-next'
import SearchEverywherePreview from './SearchEverywherePreview.vue'
import { clampPopupLocation, parsePopupBounds, serializePopupBounds, type PopupBounds } from '../popupBounds'
import {
  SEARCH_EVERYWHERE_LIMIT,
  SEARCH_EVERYWHERE_TABS,
  cycleSearchEverywhereTab,
  fuzzyTitleFragments,
  moveSearchEverywhereIndex,
  searchEverywhereResults,
  searchEverywhereSourceLabel,
  type SearchEverywhereItem,
  type SearchEverywhereTab,
} from '../searchEverywhere'

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
}>()
const emit = defineEmits<{ close: [] }>()

const query = ref('')
const tab = ref<SearchEverywhereTab>('all')
const index = ref(0)
const input = ref<HTMLInputElement | null>(null)

const results = computed(() => searchEverywhereResults(props.items, query.value, tab.value, SEARCH_EVERYWHERE_LIMIT, props.fuzzyFiles))
// 每行的模糊命中高亮区间（上游 SeFuzzyFileSearchItem 的 withPresentableTextMatchedRanges）。
const fragmentCache = computed(() => results.value.map(item => fuzzyTitleFragments(item, query.value, props.fuzzyFiles)))
// SePopupContentPane 的 tab model 不依赖当前查询结果；零结果也保留切换入口。
const tabs = SEARCH_EVERYWHERE_TABS
const selected = computed(() => results.value[index.value])
const showPreview = ref(true)
// SePopupContentPane.createSplitter: vertical=true, default proportion .33, persisted key.
const splitRatio = ref(0.33)
const splitContainer = ref<HTMLElement | null>(null)
const PREVIEW_KEY = 'taocode.searchEverywhere.preview'
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
  showPreview.value = localStorage.getItem(PREVIEW_KEY) !== 'false'
  const saved = localStorage.getItem(SPLIT_KEY)
  if (saved !== null && Number.isFinite(Number(saved))) splitRatio.value = clampSplit(Number(saved))
} catch { /* Storage unavailable: session-only preferences. */ }
watch(showPreview, value => {
  try { localStorage.setItem(PREVIEW_KEY, String(value)) } catch { /* Session-only. */ }
})
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
// 查询词交给宿主（符号供给者要用它去问语言服务）。
watch(query, value => props.onQuery?.(value))
watch(() => props.open, async open => {
  if (!open) { props.onQuery?.(''); return }
  query.value = ''
  tab.value = 'all'
  index.value = 0
  await nextTick()
  input.value?.focus()
})

function move(delta: number) { index.value = moveSearchEverywhereIndex(index.value, results.value.length, delta) }
function cycle(delta: number) { tab.value = cycleSearchEverywhereTab(tab.value, delta, tabs.map(entry => entry.id)) }
function choose(item: SearchEverywhereItem) { emit('close'); item.open() }
function chooseSelected() { const picked = results.value[index.value]; if (picked) choose(picked) }
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <section ref="popupEl" class="command-palette search-everywhere" :class="{ 'with-preview': showPreview && selected?.preview, 'is-placed': placed }" :style="popupStyle" role="dialog" aria-modal="true" aria-label="随处搜索" @keydown.esc.stop="emit('close')" @pointerup="storeBounds">
      <div class="palette-input se-drag-handle" @pointerdown="startMove" @pointermove="movePopup" @pointerup="stopMove" @pointercancel="stopMove" @lostpointercapture="stopMove">
        <Search :size="18" />
        <input
          ref="input"
          v-model="query"
          placeholder="随处搜索…（文件、类、动作、运行配置）"
          aria-label="随处搜索"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.tab.prevent="cycle($event.shiftKey ? -1 : 1)"
          @keydown.enter.prevent="chooseSelected()"
        />
        <button class="icon-button" aria-label="关闭随处搜索" @click="emit('close')"><X :size="16" /></button>
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
        <button class="se-tab" :aria-pressed="showPreview" @click="showPreview = !showPreview">预览</button>
        <span class="se-hint">Tab 切换 · ↑↓ 选择 · 回车打开</span>
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
          <span class="action-group">{{ searchEverywhereSourceLabel(entry.source) }}</span>
          <ArrowRight :size="14" />
        </button>
        <p v-if="!results.length" class="palette-empty">没有匹配的结果。</p>
      </div>
      <div v-if="showPreview && selected?.preview" class="se-splitter" role="separator" tabindex="0" aria-label="调整搜索结果与预览高度" aria-orientation="horizontal" :aria-valuenow="Math.round(splitRatio * 100)" :aria-valuemin="20" :aria-valuemax="80"
        @pointerdown="startSplit" @pointermove="moveSplit" @pointerup="stopSplit" @pointercancel="stopSplit" @lostpointercapture="stopSplit" @keydown="splitKey" />
      <SearchEverywherePreview v-if="showPreview && selected?.preview" :item="selected" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.search-everywhere { min-width: 0; width: min(720px, calc(100vw - 32px)); }
/* 记过尺寸/位置之后浮层用固定定位贴回去（上游 `AbstractPopup` 的 stored size/location 分支）。 */
.search-everywhere.is-placed { position: fixed; }
.se-drag-handle { cursor: default; touch-action: none; }
.search-everywhere.with-preview { width: min(1120px, calc(100vw - 32px)); }
.se-content { display: grid; min-height: 0; max-height: min(60vh, 600px); overflow: hidden; }
.with-preview .se-content { grid-template-rows: minmax(0, var(--se-ratio)) 5px minmax(0, 1fr); height: min(60vh, 600px); }
.se-splitter { background: var(--line, rgba(127,127,127,.25)); cursor: row-resize; touch-action: none; }
.se-splitter:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.palette-results { min-width: 0; overflow: auto; }
@media (max-width: 700px) { .se-hint { display: none; } .se-tabs { flex-wrap: wrap; } }
/* `--tc-border` / `--tc-hover` 不是 tokens.css 里的名字：这两个弹层一直退化成中性灰 rgba，
   深色主题下 hover 几乎看不见。改回真令牌 --line / --hover。 */
.se-tabs { display: flex; align-items: center; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--line); }
.se-tab { background: none; border: 0; border-radius: 4px; padding: 3px 10px; font: inherit; color: inherit; cursor: pointer; opacity: .7; }
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
