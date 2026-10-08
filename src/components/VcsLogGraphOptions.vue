<script setup lang="ts">
// 「图选项」—— 过滤栏的第五个部件，紧跟「路径」。模型与判据全在 `src/vcsLogGraphOptions.ts`
// （菜单结构照 `VcsLogGraphOptionsChooserGroup.getChildren` 的逐行顺序）。
import { computed } from 'vue'
import { ChevronDown, GitBranch } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
// 菜单行的勾选记号 = `AllIcons.Actions.Checked`（`expui/actions/checked.svg`），不是 lucide 的 24 格图。
import { IdeaCheckedIcon } from './icons/toolWindowIcons.ts'
import { LOG_GRAPH_OPTIONS_DESCRIPTION, LOG_GRAPH_OPTIONS_TITLE, logGraphOptionsModel, type LogGraphOptionState } from '../vcsLogGraphOptions'
import type { GitLogSort } from '../bridge'

const props = defineProps<LogGraphOptionState>()
const emit = defineEmits<{ pickSort: [sort: GitLogSort]; toggleFirstParent: []; toggleNoMerges: []; setCollapsed: [value: boolean] }>()
const rows = computed(() => logGraphOptionsModel({
  sort: props.sort, firstParent: props.firstParent, noMerges: props.noMerges,
  collapsed: props.collapsed, canCollapse: props.canCollapse,
}, {
  setSort: sort => emit('pickSort', sort),
  setFirstParent: () => emit('toggleFirstParent'),
  setNoMerges: () => emit('toggleNoMerges'),
  setCollapsed: value => emit('setCollapsed', value),
}))
</script>

<template>
  <details class="filter graph-options">
    <summary class="graph-options-summary" :class="{ applied: sort !== 'date' || firstParent || noMerges }"
      :title="`${LOG_GRAPH_OPTIONS_TITLE}（${LOG_GRAPH_OPTIONS_DESCRIPTION}）`" :aria-label="LOG_GRAPH_OPTIONS_TITLE">
      <GitBranch :size="iconSize.dense" aria-hidden="true" /><ChevronDown :size="iconSize.dense" class="caret" aria-hidden="true" />
    </summary>
    <form class="popup" @submit.prevent>
      <template v-for="row in rows" :key="row.id">
        <span v-if="row.separator" class="group-title" role="presentation">{{ row.title }}</span>
        <button v-else-if="row.command" type="button" class="menu-button row" role="menuitem"
          :disabled="row.disabled" :aria-disabled="row.disabled" :title="row.description" @click="row.run?.()">
          <span class="menu-item-icon" /><span>{{ row.title }}</span>
        </button>
        <button v-else type="button" class="menu-button row" :role="row.kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitemradio'"
          :aria-checked="!!row.on" :title="row.description" @click="row.run?.()">
          <span class="menu-item-icon"><IdeaCheckedIcon v-if="row.on" :size="iconSize.menu" /></span><span>{{ row.title }}</span>
        </button>
      </template>
    </form>
  </details>
</template>

<style scoped>
.filter { flex-shrink: 0; font-size: 11px; }
.graph-options-summary { display: inline-flex; align-items: center; gap: var(--space-1); list-style: none; cursor: pointer; padding: var(--space-1); }
.graph-options-summary::-webkit-details-marker { display: none; }
.caret { flex-shrink: 0; color: var(--muted); }
.graph-options-summary.applied { color: var(--accent); }
.popup { position: absolute; top: 29px; right: 0; z-index: 5; width: max-content; min-width: 200px; display: flex; flex-direction: column; gap: 2px; padding: var(--space-1); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.group-title { padding: var(--space-1) var(--space-2) 2px; color: var(--muted); font-size: 10px; }
.row { display: flex; align-items: center; gap: var(--space-2); width: 100%; justify-content: flex-start; text-align: left; white-space: nowrap; }
</style>
