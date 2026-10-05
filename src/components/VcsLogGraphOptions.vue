<script setup lang="ts">
// 「图选项」—— 过滤栏的第五个部件，紧跟「路径」。模型与判据全在 `src/vcsLogGraphOptions.ts`
// （菜单结构照 `VcsLogGraphOptionsChooserGroup.getChildren` 的逐行顺序）。
import { computed } from 'vue'
import { Check, ChevronDown, GitBranch } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { LOG_GRAPH_OPTIONS_DESCRIPTION, LOG_GRAPH_OPTIONS_TITLE, logGraphOptionsModel, type LogGraphOptionState } from '../vcsLogGraphOptions'
import type { GitLogSort } from '../bridge'

const props = defineProps<LogGraphOptionState>()
const emit = defineEmits<{ pickSort: [sort: GitLogSort]; toggleFirstParent: []; toggleNoMerges: [] }>()
const rows = computed(() => logGraphOptionsModel(props, {
  setSort: sort => emit('pickSort', sort),
  setFirstParent: () => emit('toggleFirstParent'),
  setNoMerges: () => emit('toggleNoMerges'),
}))
</script>

<template>
  <details class="filter graph-options">
    <summary :class="{ applied: sort !== 'date' || firstParent || noMerges }"
      :title="`${LOG_GRAPH_OPTIONS_TITLE}（${LOG_GRAPH_OPTIONS_DESCRIPTION}）`" :aria-label="LOG_GRAPH_OPTIONS_TITLE">
      <GitBranch :size="iconSize.dense" aria-hidden="true" /><ChevronDown :size="iconSize.dense" class="caret" aria-hidden="true" />
    </summary>
    <form class="popup" @submit.prevent>
      <template v-for="row in rows" :key="row.id">
        <span v-if="row.separator" class="group-title" role="presentation">{{ row.title }}</span>
        <button v-else type="button" class="menu-button row" :role="row.kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitemradio'"
          :aria-checked="!!row.on" :title="row.description" @click="row.run?.()">
          <span class="menu-item-icon"><Check v-if="row.on" :size="iconSize.menu" /></span><span>{{ row.title }}</span>
        </button>
      </template>
    </form>
  </details>
</template>

<style scoped>
.filter { flex-shrink: 0; font-size: 11px; }
summary { display: inline-flex; align-items: center; gap: var(--space-1); list-style: none; cursor: pointer; padding: 4px; }
summary::-webkit-details-marker { display: none; }
.caret { flex-shrink: 0; color: var(--muted); }
summary.applied { color: var(--accent); }
.popup { position: absolute; top: 29px; right: 0; z-index: 5; width: max-content; min-width: 200px; display: flex; flex-direction: column; gap: 2px; padding: 4px; border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.group-title { padding: 4px var(--space-2) 2px; color: var(--muted); font-size: 10px; }
.row { display: flex; align-items: center; gap: var(--space-2); width: 100%; justify-content: flex-start; text-align: left; white-space: nowrap; }
</style>
