<script setup lang="ts">
// 工具窗口齿轮菜单里"属于这个窗口自己"的那一组行（上游 `GearActionGroup.getChildren`，
// `ToolWindowImpl.kt:857-891`）。行、标题、快捷键与可用性全都来自主菜单的动作索引
// （引用表在 src/menus/toolWindowGear.ts），所以这里只是渲染器，不再抄一份文案。
//
// 组行（`ResizeActionGroup` 那种）把成员**摊平**在下面：`.tool-menu` 里的行不支持再开一层浮层
// —— 上游是 `compact="true"` 的组，`DefaultCompactActionGroup` 只设 `HIDE_DISABLED_CHILDREN`
// （`DefaultCompactActionGroup.java:24-28`），成员本来就是平铺在同一条菜单里的，不是子菜单。
//
// 两种行都带一个 14px 的前导槽（`.menu-item-icon`，style.css:126）：勾选行放勾记号，其余行**留空**。
// 留空而不是不放 —— 「速度搜索」「调整工具窗口」「向左拉伸…」这几条没有图标，留空槽它们的字首才和上方
// 带图标的行对齐（上游 ActionGroup 行一律有前导槽）。槽也让「显示菜单图标」关掉时由
// `html[data-menu-icons='off']` 一起收起，与其它菜单面同一条路。
import { Check } from 'lucide-vue-next'
import type { MenuRow } from '../menus/types'
import { iconSize } from '../uiIcons'

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
      <span class="menu-item-icon"><Check v-if="row.checked" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">{{ titleOf(row) }}</span>
    </button>
    <button v-for="child in row.children ?? []" :key="child.id" type="button"
            class="menu-button tool-menu-item is-child" role="menuitem"
            :disabled="child.enabled ? !child.enabled() : false" @click="emit('pick', child)">
      <span class="menu-item-icon"><Check v-if="child.checked" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">{{ titleOf(child) }}</span><kbd v-if="child.keys">{{ child.keys }}</kbd>
    </button>
  </template>
</template>
