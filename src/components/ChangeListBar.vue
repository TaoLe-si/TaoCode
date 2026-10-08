<script setup lang="ts">
// 变更列表那一行（选择器 + 新建/重命名/删除）—— 上游 `ChangesView.Changelists` 动作组
// （`VcsActions.xml:145-158`：`ChangesView.NewChangeList` / `ChangesView.Rename` /
// `ChangesView.RemoveChangeList` / `ChangesView.SetDefault` / `ChangesView.Move`）在面板上的落点。
//
// 从 `SourceControl.vue` 拆出（那个文件贴着 900 行机检上限，见 tests/module-size.test.mjs）；
// 状态与四个动作在 `src/changeListSection.ts`，纯模型在 `src/changeLists.ts`。
// 缺省只有一个「Changes」列表时行为与加这一节之前逐字一致（选择器只有一项）。
import { Plus, Pencil, Trash2 } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { MOVE_TO_ACTIVE_NOTE, type ChangeList } from '../changeLists'

defineProps<{
  /** 列表 + 每个列表里的变更数。 */
  rows: readonly { list: ChangeList; count: number }[]
  /** 当前选中的列表 id。 */
  selected: string
  /** 选中的列表能不能删（只读列表不能）。 */
  removable: boolean
  /** 有没有多个列表（只有一个时不显示那句说明）。 */
  multiple: boolean
  disabled?: boolean
}>()
defineEmits<{ select: [id: string]; create: []; rename: []; remove: [] }>()
</script>

<template>
  <div class="cl-bar" role="group" aria-label="变更列表">
    <select class="cl-select" :value="selected" aria-label="变更列表" :disabled="disabled" @change="$emit('select', ($event.target as HTMLSelectElement).value)">
      <option v-for="row in rows" :key="row.list.id" :value="row.list.id">{{ row.list.name }}（{{ row.count }}）</option>
    </select>
    <button class="icon-button" title="新建变更列表…" aria-label="新建变更列表" :disabled="disabled" @click="$emit('create')"><Plus :size="iconSize.control" /></button>
    <button class="icon-button" title="重命名当前变更列表…" aria-label="重命名变更列表" :disabled="disabled" @click="$emit('rename')"><Pencil :size="iconSize.control" /></button>
    <button class="icon-button" title="删除当前变更列表（其中的变更会移到活动列表）" aria-label="删除变更列表" :disabled="disabled || !removable" @click="$emit('remove')"><Trash2 :size="iconSize.control" /></button>
  </div>
  <p v-if="multiple" class="cl-note" role="status">{{ MOVE_TO_ACTIVE_NOTE }}</p>
</template>

<style scoped>
.cl-bar { display: flex; align-items: center; gap: var(--space-1); padding: 2px var(--space-3) 0; }
.cl-select { flex: 1; min-width: 0; height: var(--ctrl-height-sm); padding: 0 var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px var(--font-ui); }
.cl-note { margin: 2px var(--space-3) 0; color: var(--muted); font-size: 10px; }
</style>