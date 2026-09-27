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
import {
  SEARCH_EVERYWHERE_TABS,
  availableSearchEverywhereTabs,
  cycleSearchEverywhereTab,
  moveSearchEverywhereIndex,
  searchEverywhereResults,
  searchEverywhereSourceLabel,
  type SearchEverywhereItem,
  type SearchEverywhereTab,
} from '../searchEverywhere'

const props = defineProps<{
  open: boolean
  items: SearchEverywhereItem[]
  /** 查询词变化时交给宿主：符号供给者要据此异步问语言服务（带防抖，在宿主那边）。 */
  onQuery?: (query: string) => void
}>()
const emit = defineEmits<{ close: [] }>()

const query = ref('')
const tab = ref<SearchEverywhereTab>('all')
const index = ref(0)
const input = ref<HTMLInputElement | null>(null)

const results = computed(() => searchEverywhereResults(props.items, query.value, tab.value))
const tabs = computed(() => availableSearchEverywhereTabs(props.items, query.value)
  .map(id => SEARCH_EVERYWHERE_TABS.find(entry => entry.id === id))
  .filter((entry): entry is (typeof SEARCH_EVERYWHERE_TABS)[number] => Boolean(entry)))

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
function cycle(delta: number) { tab.value = cycleSearchEverywhereTab(tab.value, delta, tabs.value.map(entry => entry.id)) }
function choose(item: SearchEverywhereItem) { emit('close'); item.open() }
function chooseSelected() { const picked = results.value[index.value]; if (picked) choose(picked) }
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette search-everywhere" role="dialog" aria-modal="true" aria-label="随处搜索">
      <div class="palette-input">
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
          @keydown.esc="emit('close')"
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
        <span class="se-hint">Tab 切换 · ↑↓ 选择 · 回车打开</span>
      </div>
      <div class="palette-results" role="listbox" :aria-label="`${results.length} 条结果`">
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
          <span class="se-title">{{ entry.title }}</span>
          <span v-if="entry.subtitle" class="se-subtitle">{{ entry.subtitle }}</span>
          <span class="action-group">{{ searchEverywhereSourceLabel(entry.source) }}</span>
          <ArrowRight :size="14" />
        </button>
        <p v-if="!results.length" class="palette-empty">没有匹配的结果。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.search-everywhere { min-width: 560px; }
.se-tabs { display: flex; align-items: center; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--tc-border, rgba(127, 127, 127, .25)); }
.se-tab { background: none; border: 0; border-radius: 4px; padding: 3px 10px; font: inherit; color: inherit; cursor: pointer; opacity: .7; }
.se-tab:hover { opacity: 1; background: var(--tc-hover, rgba(127, 127, 127, .15)); }
.se-tab.active { opacity: 1; font-weight: 600; box-shadow: inset 0 -2px 0 currentColor; }
.se-hint { margin-left: auto; font-size: 11px; opacity: .55; }
.se-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: none; border: 0; font: inherit; color: inherit; padding: 6px 10px; cursor: pointer; }
.se-row.highlighted { background: var(--tc-hover, rgba(127, 127, 127, .15)); }
.se-title { flex: 0 0 auto; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.se-subtitle { flex: 1 1 auto; min-width: 0; font-size: 12px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
