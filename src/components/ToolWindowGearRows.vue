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
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import type { MenuRow } from '../menus/types'
import { gearRowsForWindow } from '../menus/toolWindowGear.ts'
import { iconSize } from '../uiIcons'

// `toolWindowId` = 这一组行当前挂在**哪个工具窗口**上。上游的齿轮组不是宿主统一算好再发两边的：
// `InternalDecoratorImpl.kt:290` 给每个标题栏的是 `gearProducer = { toolWindow.createPopupGroup(true) }`，
// 取的就是这个头部自己那一份 `ToolWindow`（`ToolWindowHeader.kt:68` 的构造参数），
// 于是 `CloseAllAction.update`（`TabbedContentAction.java:145-149`）问的也是**这个窗口**的
// `canCloseContents()`（`ContentManagerImpl.java:472-475` 的第一道闸）。本仓的行表由 `src/menuUi.ts`
// 统一算 ⇒ 这一位要由调用方补：标题栏给的就是自己的 `id`，底部那一格要宿主给选中的内容 id。
// 没给 = 答不出 ⇒ 行表原样（不替窗口猜一个值，判据 `tests/tool-window-gear-identity.test.mjs`）。
const props = defineProps<{ rows: MenuRow[]; toolWindowId?: string }>()
const emit = defineEmits<{ pick: [row: MenuRow] }>()

const shownRows = computed(() => gearRowsForWindow(props.rows, props.toolWindowId))

function titleOf(row: MenuRow): string {
  return typeof row.title === 'function' ? row.title() : row.title ?? row.id
}
</script>

<template>
  <template v-for="row in shownRows" :key="row.id">
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
