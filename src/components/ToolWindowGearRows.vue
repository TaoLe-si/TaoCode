<script setup lang="ts">
// 工具窗口齿轮菜单里"属于这个窗口自己"的那一组行（上游 `GearActionGroup.getChildren`，
// `ToolWindowImpl.kt:857-891`）。行、标题、快捷键与可用性全都来自主菜单的动作索引
// （引用表在 src/menus/toolWindowGear.ts），所以这里只是渲染器，不再抄一份文案。
//
// 组行（`ResizeActionGroup` 那种）把成员**摊平**在下面：`.tool-menu` 里的行不支持再开一层浮层
// —— 上游是 `compact="true"` 的组，`DefaultCompactActionGroup` 只设 `HIDE_DISABLED_CHILDREN`
// （`DefaultCompactActionGroup.java:24-28`），成员本来就是平铺在同一条菜单里的，不是子菜单。
import type { MenuRow } from '../menus/types'

const props = defineProps<{ rows: MenuRow[] }>()
const emit = defineEmits<{ pick: [row: MenuRow] }>()

function titleOf(row: MenuRow): string {
  return typeof row.title === 'function' ? row.title() : row.title ?? row.id
}
</script>

<template>
  <template v-for="row in props.rows" :key="row.id">
    <button type="button" class="menu-button tool-menu-item" role="menuitem"
            :disabled="row.enabled ? !row.enabled() : false" @click="emit('pick', row)">
      {{ titleOf(row) }}
    </button>
    <button v-for="child in row.children ?? []" :key="child.id" type="button"
            class="menu-button tool-menu-item is-child" role="menuitem"
            :disabled="child.enabled ? !child.enabled() : false" @click="emit('pick', child)">
      {{ titleOf(child) }}<kbd v-if="child.keys">{{ child.keys }}</kbd>
    </button>
  </template>
</template>
