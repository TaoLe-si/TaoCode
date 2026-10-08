<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { Search } from 'lucide-vue-next'
import { ChevronDown } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import type { GitLogQuery, GitLogSort } from '../bridge'
import VcsLogTextFilterSettings from './VcsLogTextFilterSettings.vue'
import VcsLogGraphOptions from './VcsLogGraphOptions.vue'
import { graphOptionsQuery, graphOptionsState } from '../vcsLogGraphOptions'
import { textFilterSettingsQuery, textFilterSettingsState } from '../vcsLogTextFilterSettings'
// `collapsed` / `canCollapse` 是**视图态**（上游的折叠记在图上、不进 UI 属性，也不进过滤条件），
// 所以它不在 `query` 里，由日志面板传进来、再往回报。
const props = defineProps<{ query: GitLogQuery; collapsed?: boolean; canCollapse?: boolean }>()
const emit = defineEmits<{ apply: [query: GitLogQuery]; setCollapsed: [value: boolean] }>()
const draft = reactive({ text: '', refs: '', author: '', since: '', until: '', path: '' })
watch(() => props.query, q => Object.assign(draft, { text: q.text ?? '', refs: (q.refs ?? []).join('\n'), author: q.author ?? '', since: q.since ?? '', until: q.until ?? '', path: q.path ?? '' }), { immediate: true })
const controls = [{ key: 'refs', label: '分支' }, { key: 'author', label: '用户' }, { key: 'date', label: '日期' }, { key: 'path', label: '路径' }] as const
type Filter = typeof controls[number]['key'] | 'text'
// 上游 `VcsLogClassicFilterUi.createActionGroup()`（`:149-150`）的顺序是
// 分支 → 用户 → 日期 → 路径 → **图选项**；文本框在它们之前（`:88-90`），紧挨着的那条
// 内联工具条是「文本筛选器设置」（`Vcs.Log.TextFilterSettings` = 正则表达式 / 区分大小写）。
// 换档立刻重查（`TextFilterModel` 的 PropertiesChangeListener，`TextFilterModel.kt:28-38`）。
const textSettings = computed(() => textFilterSettingsState(props.query))
const graphState = computed(() => graphOptionsState(props.query))
function applyOptions(patch: Partial<GitLogQuery>) { emit('apply', { ...props.query, ...patch }) }
function setTextRegex(value: boolean) { applyOptions(textFilterSettingsQuery({ ...textSettings.value, textRegex: value })) }
function setMatchCase(value: boolean) { applyOptions(textFilterSettingsQuery({ ...textSettings.value, matchCase: value })) }
function setSort(sort: GitLogSort) { applyOptions(graphOptionsQuery({ ...graphState.value, sort })) }
function setFirstParent(firstParent: boolean) { applyOptions(graphOptionsQuery({ ...graphState.value, firstParent })) }
function setNoMerges(noMerges: boolean) { applyOptions(graphOptionsQuery({ ...graphState.value, noMerges })) }
let openPanel: HTMLDetailsElement | null = null
function toggled(event: Event) {
  const panel = event.target as HTMLDetailsElement
  if (panel.open) {
    if (openPanel && openPanel !== panel) openPanel.open = false
    openPanel = panel
  } else if (openPanel === panel) openPanel = null
}
function outside(event: PointerEvent) {
  if (openPanel && !openPanel.contains(event.target as Node)) openPanel.open = false
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !openPanel) return
  const panel = openPanel
  panel.open = false
  panel.querySelector<HTMLElement>('summary')?.focus()
  event.preventDefault()
}
onMounted(() => { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) })
function apply(key: Filter, event?: Event, clear = false) {
  const patch = key === 'refs' ? { refs: clear ? [] : draft.refs.split('\n').map(s => s.trim()).filter(Boolean) }
    : key === 'date' ? { since: clear ? '' : draft.since, until: clear ? '' : draft.until }
    : { [key]: clear ? '' : draft[key] }
  emit('apply', { ...props.query, ...patch })
  const panel = (event?.target as HTMLElement | undefined)?.closest('details')
  if (panel) panel.open = false
}
</script>
<template>

  <!-- Components: text first; ClassicFilterUi (`VcsLogClassicFilterUi.kt:149-150`):
       branch, user, date, structure, **graph**. The text field carries the inline
       `Vcs.Log.TextFilterSettings` toolbar (regex / match case). -->
  <form class="text-filter" @submit.prevent="apply('text')"><Search :size="iconSize.dense" /><input class="vcslog-filters-control" v-model="draft.text" aria-label="提交消息（回车过滤）" :placeholder="textSettings.textRegex ? '搜索提交消息（正则）' : '搜索提交消息'" /></form>
  <VcsLogTextFilterSettings :regex="textSettings.textRegex" :match-case="textSettings.matchCase" @toggle-regex="setTextRegex" @toggle-match-case="setMatchCase" />
  <details v-for="control in controls" :key="control.key" class="filter" @toggle="toggled">
    <summary class="vcslog-filters-summary" :class="{ applied: control.key === 'date' ? query.since || query.until : control.key === 'refs' ? query.refs?.length : query[control.key] }">{{ control.label }}<ChevronDown :size="iconSize.dense" class="filter-caret" aria-hidden="true" /></summary>
    <form class="popup" @submit.prevent="apply(control.key, $event)">
      <label v-if="control.key === 'refs'">分支 / 标签 / 哈希<textarea class="vcslog-filters-control" v-model="draft.refs" rows="3" placeholder="每行一个引用；留空为所有分支" /></label>
      <label v-else-if="control.key === 'author'">用户<input class="vcslog-filters-control" v-model="draft.author" placeholder="作者子串" /></label>
      <template v-else-if="control.key === 'date'"><label>起始日期（UTC）<input class="vcslog-filters-control" v-model="draft.since" type="date" /></label><label>截止日期（UTC）<input class="vcslog-filters-control" v-model="draft.until" type="date" /></label></template>
      <label v-else>路径<input class="vcslog-filters-control" v-model="draft.path" placeholder="仓库相对路径，使用 /" /></label>
      <div class="actions"><button class="vcslog-filters-button" type="button" @click="apply(control.key, $event, true)">清除</button><button class="vcslog-filters-button" type="submit">应用</button></div>
    </form>
  </details>
  <VcsLogGraphOptions v-bind="graphState" :collapsed="collapsed" :can-collapse="canCollapse" @pick-sort="setSort" @toggle-first-parent="setFirstParent(!graphState.firstParent)" @toggle-no-merges="setNoMerges(!graphState.noMerges)" @set-collapsed="emit('setCollapsed', $event)" />
</template>
<style scoped>
.text-filter { display: flex; align-items: center; flex: 1; min-width: 50px; gap: var(--space-1); color: var(--muted); }
.vcslog-filters-control { min-width: 0; padding: 2px var(--space-1); min-height: var(--ctrl-height-sm); background: var(--editor); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-xs); font: 11px/1.5 var(--font-ui); }
.text-filter input { flex: 1; width: 100%; }
.filter { flex-shrink: 0; font-size: 11px; }
.vcslog-filters-button { background: var(--editor); color: var(--text); border: 1px solid var(--line); padding: 3px var(--space-2); font-size: 11px; }
/* 折叠箭头（第八十五批由 ▾ 文本字形换成 lucide ChevronDown）用 `margin-left: auto`
   推到右端 —— 这也正好接上原生 disclosure 三角被 `list-style: none` 去掉之后空出来的那一侧。 */
.vcslog-filters-summary { display: inline-flex; align-items: center; gap: var(--space-1); list-style: none; cursor: pointer; padding: var(--space-1); }
.filter-caret { margin-left: auto; flex-shrink: 0; color: var(--muted); }
.vcslog-filters-summary.applied { color: var(--accent); }
.popup { position: absolute; top: 29px; right: 0; z-index: 5; width: min(280px, calc(100vw - 40px)); padding: var(--space-3); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.popup label { display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-2); }
.actions { display: flex; justify-content: space-between; }
.vcslog-filters-button { background: var(--editor); color: var(--text); border: 1px solid var(--line); padding: 3px var(--space-2); font-size: 11px; }
</style>
