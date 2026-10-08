<script setup lang="ts">
// 标签条右端的「更多」下拉（IDEA `EditorTabsEntryPoint`，`PlatformActions.xml:804-816`）。
// 内容由 `src/tabEntryPointMenu.ts` 按上游顺序给出，这里只管渲染与开关 ——
// 与 `ToolWindowGear.vue` 同一套：Teleport 到 body 用 fixed 定位，点外面/Esc 都收
// （标签条那层是 `overflow: hidden`，弹在里面会被裁掉）。
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import { entryPointHasActions, visibleEntryPointItems, type TabEntryPointItem } from '../tabEntryPoint'
import { usePopupLayer } from '../popupStack.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{ items: TabEntryPointItem[] }>()
const open = ref(false)
const positioned = ref(false)
const at = ref({ left: 0, top: 0 })
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
// 上游 `ActionPanel.update()`：`visible = enabled && visible` —— 不可用的动作**整个不画**；
// 一条可见的都没有时 `getPreferredSize()` 返回 0×0，连按钮都不占位置（`:158-160`）。
const rows = computed(() => visibleEntryPointItems(props.items))
const showButton = computed(() => entryPointHasActions(props.items))
usePopupLayer(menu, open, closeFromPopupStack, { cancelOnClickOutside: true })

function openMenu(focusIndex: number | null = null) {
  if (!rows.value.length) return
  const button = trigger.value
  if (!button) return
  const box = button.getBoundingClientRect()
  at.value = { left: box.right, top: box.bottom + 4 }
  positioned.value = false
  open.value = true
  void nextTick(() => {
    positionMenu()
    if (focusIndex !== null) focusMenuItem(focusIndex)
  })
}
function toggle(event: MouseEvent) {
  if (open.value) { close(); return }
  openMenu(event.detail === 0 ? 0 : null)
}
function positionMenu() {
  const anchor = trigger.value
  const popup = menu.value
  if (!open.value || !anchor || !popup) return
  const anchorBox = anchor.getBoundingClientRect()
  const popupBox = popup.getBoundingClientRect()
  const margin = 8
  const left = Math.max(margin, Math.min(anchorBox.right - popupBox.width, window.innerWidth - popupBox.width - margin))
  const top = Math.max(margin, Math.min(anchorBox.bottom + 4, window.innerHeight - popupBox.height - margin))
  at.value = { left, top }
  positioned.value = true
}
function close() {
  open.value = false
  positioned.value = false
}
function closeFromPopupStack() {
  const restoreFocus = Boolean(menu.value?.contains(document.activeElement))
  close()
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}
function focusMenuItem(index: number) {
  const items = menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
  if (!items?.length) return
  items[(index + items.length) % items.length]?.focus()
}
function onTriggerKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  if (!open.value) {
    openMenu(event.key === 'ArrowDown' ? 0 : rows.value.length - 1)
    return
  }
  focusMenuItem(event.key === 'ArrowDown' ? 0 : rows.value.length - 1)
}
function onMenuKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
  if (!items?.length) return
  event.preventDefault()
  const current = [...items].findIndex(item => item === document.activeElement)
  const next = current < 0 ? 0 : current + (event.key === 'ArrowDown' ? 1 : -1)
  focusMenuItem(next)
}
function pick(item: TabEntryPointItem) {
  close()
  item.run()
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', positionMenu)
}
onUnmounted(() => {
  window.removeEventListener('resize', positionMenu)
})
</script>

<template>
  <div v-if="showButton" class="tab-entry-point">
    <button
      ref="trigger" class="icon-button" :aria-expanded="open" aria-haspopup="menu"
      title="更多标签操作" aria-label="更多标签操作" @click.stop="toggle" @keydown="onTriggerKeydown"
    >
      <MoreHorizontal :size="iconSize.toolbar" />
    </button>
    <Teleport to="body">
      <div
        v-if="open" ref="menu" class="dropdown tab-entry-point-menu" role="menu" aria-label="标签操作"
        :style="{ left: `${at.left}px`, top: `${at.top}px`, visibility: positioned ? 'visible' : 'hidden' }"
        @click.stop @keydown="onMenuKeydown"
      >
        <button
          v-for="item in rows" :key="item.id" class="menu-button tab-entry-point-row" role="menuitem"
          @click="pick(item)"
        >{{ item.label }}</button>
      </div>
    </Teleport>
  </div>
</template>
