<script setup lang="ts">
// 编辑器右键浮层（IDEA `EditorPopupMenu` 的那张弹出菜单）。
//
// 只负责渲染：行数据、顺序、可用性都在 `src/menus/editorPopupMenu.ts`（按 id 引用现有菜单行）
// 与 `src/menuUi.ts`（取行 + 执行）里。这里不写任何标题或快捷键 —— 复制一份就是第二份真相。
//
// 交互与项目树右键菜单同一套（容器 class 也复用 `.tree-menu`）：点外面 / Esc 关闭，
// `popup="true"` 的组是一个可展开的子段（上游是嵌套 popup，本仓浮层里用行内展开，
// 因为再开一层浮层就得自己处理层叠与焦点）。
import { onMounted, onUnmounted, ref } from 'vue'
import { Check } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'

const props = defineProps<{ rows: any[]; x: number; y: number; label?: string }>()
const emit = defineEmits<{ (event: 'pick', row: any): void; (event: 'close'): void }>()

const open = ref<string | null>(null)
function toggle(id: string) { open.value = open.value === id ? null : id }
function rowEnabled(row: any): boolean { return row.enabled ? row.enabled() : true }
function onPointerDown(event: PointerEvent) { if (!(event.target as Element).closest('.editor-popup-menu')) emit('close') }
function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') emit('close') }
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
  <div class="tree-menu editor-popup-menu" role="menu" :aria-label="label ?? '编辑器'" :style="{ left: `${x}px`, top: `${y}px` }" @contextmenu.prevent @pointerdown.stop>
    <template v-for="row in rows" :key="row.id">
      <div v-if="row.rule" class="menu-rule" />
      <template v-else-if="row.children">
        <button type="button" class="has-sub" role="menuitem" :aria-expanded="open === row.id" @click="toggle(row.id)">{{ row.title }}</button>
        <template v-if="open === row.id">
          <button v-for="child in row.children" :key="child.id" type="button" class="sub-item" role="menuitem"
                  :disabled="!rowEnabled(child)" @click="emit('pick', child)">
            {{ typeof child.title === 'function' ? child.title() : child.title }}<kbd v-if="child.keys">{{ child.keys }}</kbd>
          </button>
        </template>
      </template>
      <button v-else type="button" role="menuitem" :class="{ 'is-checked': row.checked?.() }" :aria-checked="row.checked ? row.checked() : undefined" :disabled="!rowEnabled(row)" @click="emit('pick', row)">
        <span v-if="row.checked" class="menu-check" aria-hidden="true"><Check :size="iconSize.menu" /></span>{{ typeof row.title === 'function' ? row.title() : row.title }}<kbd v-if="row.keys">{{ row.keys }}</kbd>
      </button>
    </template>
  </div>
</template>
