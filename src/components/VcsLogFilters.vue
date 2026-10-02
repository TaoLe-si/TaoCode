<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { Search } from 'lucide-vue-next'
import { ChevronDown } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import type { GitLogQuery } from '../bridge'
const props = defineProps<{ query: GitLogQuery }>()
const emit = defineEmits<{ apply: [query: GitLogQuery] }>()
const draft = reactive({ text: '', refs: '', author: '', since: '', until: '', path: '' })
watch(() => props.query, q => Object.assign(draft, { text: q.text ?? '', refs: (q.refs ?? []).join('\n'), author: q.author ?? '', since: q.since ?? '', until: q.until ?? '', path: q.path ?? '' }), { immediate: true })
const controls = [{ key: 'refs', label: '分支' }, { key: 'author', label: '用户' }, { key: 'date', label: '日期' }, { key: 'path', label: '路径' }] as const
type Filter = typeof controls[number]['key'] | 'text'
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

  <!-- Components: text first; ClassicFilterUi: branch, user, date, structure, graph. Graph filter has no backend contract. -->
  <form class="text-filter" @submit.prevent="apply('text')"><Search :size="iconSize.dense" /><input v-model="draft.text" aria-label="提交消息（区分大小写，回车过滤）" placeholder="搜索提交消息" /></form>
  <details v-for="control in controls" :key="control.key" class="filter" @toggle="toggled">
    <summary :class="{ applied: control.key === 'date' ? query.since || query.until : control.key === 'refs' ? query.refs?.length : query[control.key] }">{{ control.label }}<ChevronDown :size="iconSize.dense" class="filter-caret" aria-hidden="true" /></summary>
    <form class="popup" @submit.prevent="apply(control.key, $event)">
      <label v-if="control.key === 'refs'">分支 / 标签 / 哈希<textarea v-model="draft.refs" rows="3" placeholder="每行一个引用；留空为所有分支" /></label>
      <label v-else-if="control.key === 'author'">用户<input v-model="draft.author" placeholder="区分大小写的作者子串" /></label>
      <template v-else-if="control.key === 'date'"><label>起始日期（UTC）<input v-model="draft.since" type="date" /></label><label>截止日期（UTC）<input v-model="draft.until" type="date" /></label></template>
      <label v-else>路径<input v-model="draft.path" placeholder="仓库相对路径，使用 /" /></label>
      <div class="actions"><button type="button" @click="apply(control.key, $event, true)">清除</button><button type="submit">应用</button></div>
    </form>
  </details>
</template>
<style scoped>
.text-filter { display: flex; align-items: center; flex: 1; min-width: 50px; gap: 4px; color: var(--muted); }
input, textarea { min-width: 0; padding: 2px 4px; min-height: 22px; background: var(--editor); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-xs); font: 11px/1.5 var(--font-ui); }
.text-filter input { flex: 1; width: 100%; }
.filter { flex-shrink: 0; font-size: 11px; }
button { background: var(--editor); color: var(--text); border: 1px solid var(--line); padding: 3px 8px; font-size: 11px; }
/* 折叠箭头（第八十五批由 ▾ 文本字形换成 lucide ChevronDown）用 `margin-left: auto`
   推到右端 —— 这也正好接上原生 disclosure 三角被 `list-style: none` 去掉之后空出来的那一侧。 */
summary { display: inline-flex; align-items: center; gap: var(--space-1); list-style: none; cursor: pointer; padding: 4px; }
.filter-caret { margin-left: auto; flex-shrink: 0; color: var(--muted); }
summary.applied { color: var(--accent); }
.popup { position: absolute; top: 29px; right: 0; z-index: 5; width: min(280px, calc(100vw - 40px)); padding: 12px; border: 1px solid var(--line); background: var(--panel); box-shadow: 0 4px 16px #0004; }
.popup label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.actions { display: flex; justify-content: space-between; }
button { background: var(--editor); color: var(--text); border: 1px solid var(--line); padding: 3px 8px; font-size: 11px; }
</style>
