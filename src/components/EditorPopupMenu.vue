<script setup lang="ts">
// 编辑器右键浮层（IDEA `EditorPopupMenu` 的那张弹出菜单）。
//
// 只负责渲染：行数据、顺序、可用性都在 `src/menus/editorPopupMenu.ts`（按 id 引用现有菜单行）
// 与 `src/menuUi.ts`（取行 + 执行）里。这里不写任何标题或快捷键 —— 复制一份就是第二份真相。
//
// 交互与项目树右键菜单同一套（容器 class 也复用 `.tree-menu`）：点外面 / Esc 关闭，
// `popup="true"` 的组是一个可展开的子段（上游是嵌套 popup，本仓浮层里用行内展开，
// 因为再开一层浮层就得自己处理层叠与焦点）。
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Check } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { usePopupAnchor } from '../popupAnchor'
import { nextMenuIndex, rowActivatable, visibleMenuRows } from '../menuKeyboard'

const props = defineProps<{ rows: any[]; x: number; y: number; label?: string }>()
const emit = defineEmits<{ (event: 'pick', row: any): void; (event: 'close'): void }>()

const box = ref<HTMLElement>()
// 位置交给 `usePopupAnchor` 按**实测尺寸**夹取（口径见 src/popupAnchor.ts）：这张菜单的行数不定，
// 展开子段后还会再长一截。原来 `left/top` 直接照抄坐标，于是 11 行的菜单（实测 419px 高）
// 从光标一路铺到窗口下沿以外，最后几行落进下边栏底下 —— 看着像"下边栏把菜单挡住了"。
const { style: anchor, refresh } = usePopupAnchor(box, () => ({ x: props.x, y: props.y }))

const open = ref<string | null>(null)
// 键盘导航（上游 Swing 菜单的 MenuSelectionManager）：↑↓ 走行、Enter 执行、→ 展开子段 / ← 收起。
// 活动项用 id 记（行表随 enabled() 重算，用下标会指错）。
const activeId = ref<string | null>(null)
function activeIndex(): number {
  const rows = visibleMenuRows(props.rows, open.value)
  const index = rows.findIndex(row => row.id === activeId.value)
  return index
}
function moveActive(step: number) {
  const rows = visibleMenuRows(props.rows, open.value)
  const index = nextMenuIndex(rows.length, activeIndex(), step)
  activeId.value = index >= 0 ? rows[index]!.id : null
}
function activateActive() {
  const rows = visibleMenuRows(props.rows, open.value)
  const row = rows.find(entry => entry.id === activeId.value)
  if (!row) return
  if (row.children) { toggle(row.id); return }
  if (rowActivatable(row)) emit('pick', row)
}
function toggle(id: string) {
  open.value = open.value === id ? null : id
  // 子段是就地展开的（上游是嵌套 popup），高度变了要重新夹一次。
  if (open.value) void nextTick(refresh)
}
function rowEnabled(row: any): boolean { return row.enabled ? row.enabled() : true }
function onPointerDown(event: PointerEvent) { if (!(event.target as Element).closest('.editor-popup-menu')) emit('close') }
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { emit('close'); return }
  if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); return }
  if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); return }
  if (event.key === 'ArrowRight') {
    const row = visibleMenuRows(props.rows, open.value).find(entry => entry.id === activeId.value)
    if (row?.children) { event.preventDefault(); if (open.value !== row.id) toggle(row.id) }
    return
  }
  if (event.key === 'ArrowLeft') {
    if (open.value) { event.preventDefault(); open.value = null; return }
    if (activeId.value) { event.preventDefault(); activeId.value = null }
    return
  }
  if (event.key === 'Enter') {
    // 没走过键盘（无活动项）时不抢 Enter —— 编辑器里它还是换行。
    if (activeIndex() < 0) return
    event.preventDefault(); activateActive()
  }
}
onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="box" class="tree-menu editor-popup-menu" role="menu" :aria-label="label ?? '编辑器'" :style="anchor" @contextmenu.prevent @pointerdown.stop>
    <template v-for="row in rows" :key="row.id">
      <div v-if="row.rule" class="menu-rule" />
      <template v-else-if="row.children">
        <button type="button" class="has-sub" :class="{ 'is-active': activeId === row.id }" role="menuitem" :aria-expanded="open === row.id" @mouseenter="activeId = row.id" @click="toggle(row.id)">{{ row.title }}</button>
        <template v-if="open === row.id">
          <button v-for="child in row.children" :key="child.id" type="button" class="sub-item" :class="{ 'is-active': activeId === child.id }" role="menuitem"
                  :disabled="!rowEnabled(child)" @mouseenter="activeId = child.id" @click="emit('pick', child)">
            {{ typeof child.title === 'function' ? child.title() : child.title }}<kbd v-if="child.keys">{{ child.keys }}</kbd>
          </button>
        </template>
      </template>
      <button v-else type="button" role="menuitem" :class="{ 'is-checked': row.checked?.(), 'is-active': activeId === row.id }" :aria-checked="row.checked ? row.checked() : undefined" :disabled="!rowEnabled(row)" @mouseenter="activeId = row.id" @click="emit('pick', row)">
        <span v-if="row.checked" class="menu-check" aria-hidden="true"><Check :size="iconSize.menu" /></span>{{ typeof row.title === 'function' ? row.title() : row.title }}<kbd v-if="row.keys">{{ row.keys }}</kbd>
      </button>
    </template>
  </div>
</template>
