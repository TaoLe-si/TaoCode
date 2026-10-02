<script setup lang="ts">
// 标签条右端的「更多」下拉（IDEA `EditorTabsEntryPoint`，`PlatformActions.xml:804-816`）。
// 内容由 `src/tabEntryPointMenu.ts` 按上游顺序给出，这里只管渲染与开关 ——
// 与 `ToolWindowGear.vue` 同一套：Teleport 到 body 用 fixed 定位，点外面/Esc 都收
// （标签条那层是 `overflow: hidden`，弹在里面会被裁掉）。
import { computed, onUnmounted, ref } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import { entryPointHasActions, visibleEntryPointItems, type TabEntryPointItem } from '../tabEntryPoint'
import { iconSize } from '../uiIcons'

const props = defineProps<{ items: TabEntryPointItem[] }>()
const open = ref(false)
const at = ref({ left: 0, top: 0 })
// 上游 `ActionPanel.update()`：`visible = enabled && visible` —— 不可用的动作**整个不画**；
// 一条可见的都没有时 `getPreferredSize()` 返回 0×0，连按钮都不占位置（`:158-160`）。
const rows = computed(() => visibleEntryPointItems(props.items))
const showButton = computed(() => entryPointHasActions(props.items))

function toggle(event: MouseEvent) {
  if (open.value) { open.value = false; return }
  if (!rows.value.length) return
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  // 往下长（这一条在标签条右端，下方是编辑器，空间足够）。
  at.value = { left: Math.max(8, box.right - 220), top: box.bottom + 4 }
  open.value = true
}
function pick(item: TabEntryPointItem) {
  open.value = false
  item.run()
}
function onPointerDown(event: PointerEvent) {
  if (open.value && !(event.target as Element).closest('.tab-entry-point-menu')) open.value = false
}
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') open.value = false }
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown)
}
onUnmounted(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="showButton" class="tab-entry-point">
    <button
      class="icon-button" :aria-expanded="open" aria-haspopup="menu"
      title="更多标签操作" aria-label="更多标签操作" @click.stop="toggle"
    >
      <MoreHorizontal :size="iconSize.toolbar" />
    </button>
    <Teleport to="body">
      <div
        v-if="open" class="dropdown tab-entry-point-menu" role="menu" aria-label="标签操作"
        :style="{ left: `${at.left}px`, top: `${at.top}px` }" @click.stop
      >
        <button
          v-for="item in rows" :key="item.id" class="menu-button tab-entry-point-row" role="menuitem"
          @click="pick(item)"
        >{{ item.label }}</button>
      </div>
    </Teleport>
  </div>
</template>
