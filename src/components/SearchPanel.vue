<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-vue-next'
import { isDesktop, request, type SearchMatch, type SearchOptions, type SearchReplaceResult, type SearchResult } from '../bridge'

const props = defineProps<{ root: string; active: boolean }>()
const emit = defineEmits<{ open: [payload: { path: string; line: number }] }>()

interface Part { text: string; hit: boolean }
interface Group { path: string; matches: SearchMatch[] }

const query = ref('')
const replacement = ref('')
const include = ref('')
const exclude = ref('')
const regex = ref(false)
const caseSensitive = ref(false)
const wholeWord = ref(false)
const filtersOpen = ref(false)
const matches = ref<SearchMatch[]>([])
const fileCount = ref(0)
const truncated = ref(false)
const running = ref(false)
const searched = ref(false)
const error = ref('')
const note = ref('')
const collapsed = reactive(new Set<string>())

const groups = computed<Group[]>(() => {
  const ordered: Group[] = []
  const index = new Map<string, Group>()
  for (const match of matches.value) {
    const found = index.get(match.path)
    if (found) { found.matches.push(match); continue }
    const group: Group = { path: match.path, matches: [match] }
    index.set(match.path, group)
    ordered.push(group)
  }
  return ordered
})

const total = computed(() => matches.value.length)
const canSubmit = computed(() => isDesktop && Boolean(props.root) && !running.value && query.value.length > 0)

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
function apply(result: SearchResult) {
  matches.value = Array.isArray(result.matches) ? result.matches : []
  fileCount.value = result.fileCount ?? 0
  truncated.value = result.truncated === true
  searched.value = true
}
async function runSearch() {
  if (!canSubmit.value) return
  running.value = true
  error.value = ''
  note.value = ''
  try { apply(await request<SearchResult>('search.run', params())) }
  catch (caught) { error.value = errorText(caught) }
  finally { running.value = false }
}
async function runReplace() {
  if (!canSubmit.value) return
  running.value = true
  error.value = ''
  note.value = ''
  try {
    const result = await request<SearchReplaceResult>('search.replace', { ...params(), replacement: replacement.value })
    note.value = `已替换 ${result.replacements ?? 0} 处，涉及 ${result.files ?? 0} 个文件。`
    apply(await request<SearchResult>('search.run', params()))
  } catch (caught) { error.value = errorText(caught) }
  finally { running.value = false }
}
function reset() {
  query.value = ''
  replacement.value = ''
  matches.value = []
  fileCount.value = 0
  truncated.value = false
  searched.value = false
  error.value = ''
  note.value = ''
  collapsed.clear()
}
function toggleGroup(path: string) {
  if (collapsed.has(path)) collapsed.delete(path)
  else collapsed.add(path)
}
function openMatch(match: SearchMatch) { emit('open', { path: match.path, line: match.line }) }
function parts(match: SearchMatch): Part[] {
  const line = match.preview ?? ''
  const start = Math.min(Math.max(0, (match.column || 1) - 1), line.length)
  const end = Math.min(Math.max(start, start + Math.max(0, match.length || 0)), line.length)
  const list: Part[] = []
  if (start > 0) list.push({ text: line.slice(0, start), hit: false })
  list.push({ text: line.slice(start, end), hit: true })
  if (end < line.length) list.push({ text: line.slice(end), hit: false })
  return list
}

watch(() => props.active, active => { if (active && query.value.length > 0 && !running.value) void runSearch() })
</script>

<template>
  <div class="fs-panel">
    <div class="fs-heading">
      <span><Search :size="13" />全局搜索</span>
      <div class="heading-actions">
        <button class="icon-button" :title="filtersOpen ? '收起筛选' : '筛选'" aria-label="切换文件筛选" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen"><SlidersHorizontal :size="14" /></button>
        <button class="icon-button" title="清空" aria-label="清空搜索" :disabled="!query && !replacement && !total" @click="reset"><X :size="14" /></button>
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
        <button class="icon-button" title="搜索 (Enter)" aria-label="搜索" :disabled="!canSubmit" @click="runSearch"><Search :size="14" /></button>
      </div>
      <div v-if="filtersOpen" class="fs-filters">
        <label class="fs-filter"><span>包含</span><input v-model="include" type="text" placeholder="*.cpp 或 src/**" aria-label="仅搜索这些文件" spellcheck="false" /></label>
        <label class="fs-filter"><span>排除</span><input v-model="exclude" type="text" placeholder="build/**" aria-label="排除这些文件" spellcheck="false" /></label>
      </div>
      <div class="fs-row">
        <input v-model="replacement" class="fs-input" type="text" placeholder="替换为" aria-label="替换内容" spellcheck="false" @keydown.enter.ctrl.prevent="runReplace" />
        <button class="fs-replace" :disabled="!canSubmit" title="替换全部（Ctrl+Enter）" @click="runReplace">全部替换</button>
      </div>
    </div>

    <p v-if="!isDesktop" class="fs-warn">浏览器预览不能全局搜索，请在桌面端使用。</p>
    <p v-else-if="!root" class="fs-warn">尚未打开项目。</p>
    <p v-if="error" class="fs-error">{{ error }}</p>
    <p v-if="note" class="fs-note">{{ note }}</p>
    <div v-if="searched && !running" class="fs-status">
      <span>共 {{ total }} 处 / {{ fileCount }} 个文件</span>
      <span v-if="truncated" class="fs-truncated">结果已截断</span>
    </div>

    <div class="fs-scroll">
      <div v-if="running" class="fs-empty">正在搜索…</div>
      <template v-else-if="groups.length">
        <section v-for="group in groups" :key="group.path" class="fs-group">
          <button class="fs-file" :aria-expanded="!collapsed.has(group.path)" :title="group.path" @click="toggleGroup(group.path)">
            <ChevronRight v-if="collapsed.has(group.path)" :size="13" />
            <ChevronDown v-else :size="13" />
            <span class="fs-file-path">{{ group.path }}</span>
            <span class="fs-file-count">{{ group.matches.length }}</span>
          </button>
          <div v-if="!collapsed.has(group.path)" class="fs-matches">
            <button v-for="(match, index) in group.matches" :key="`${match.line}:${match.column}:${index}`" class="fs-match" :title="`${group.path}:${match.line}:${match.column}`" @click="openMatch(match)">
              <span class="fs-pos">{{ match.line }}:{{ match.column }}</span>
              <span class="fs-line"><span v-for="(part, partIndex) in parts(match)" :key="partIndex" :class="{ 'fs-hit': part.hit }">{{ part.text }}</span></span>
            </button>
          </div>
        </section>
      </template>
      <div v-else-if="searched" class="fs-empty">没有匹配的结果。</div>
      <div v-else class="fs-empty">输入关键词后按 Enter 搜索；筛选与替换仅影响匹配到的文本。</div>
    </div>
  </div>
</template>

<style scoped>
.fs-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
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
.fs-truncated { color: var(--error); }
.fs-scroll { flex: 1; min-height: 0; overflow: auto; padding-bottom: var(--space-2); }
.fs-empty { padding: var(--space-4) var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.fs-group { min-width: 0; }
.fs-file { display: flex; align-items: center; gap: var(--space-1); width: 100%; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2) 2px var(--space-1); border: 0; background: transparent; color: var(--secondary); text-align: left; }
.fs-file:hover { background: var(--hover); }
.fs-file > svg { flex-shrink: 0; color: var(--muted); }
.fs-file-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11px/1.6 var(--font-mono); color: var(--text); }
.fs-file-count { flex-shrink: 0; margin-left: auto; color: var(--muted); font-size: 10px; }
.fs-matches { display: flex; flex-direction: column; padding: 0 0 var(--space-1); }
.fs-match { display: flex; align-items: flex-start; gap: var(--space-2); width: 100%; padding: 2px var(--space-2) 2px var(--space-5); border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.fs-match:hover { background: var(--hover); }
.fs-pos { flex-shrink: 0; min-width: 46px; text-align: right; color: var(--muted); font: 10px/1.7 var(--font-mono); }
.fs-line { min-width: 0; overflow: hidden; white-space: pre; text-overflow: ellipsis; color: var(--secondary); font: 11px/1.7 var(--font-mono); }
.fs-hit { color: var(--bright); background: var(--selected); border-radius: 2px; }
</style>
