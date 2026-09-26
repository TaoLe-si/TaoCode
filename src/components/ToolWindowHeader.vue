<script setup lang="ts">
import { ref } from 'vue'
import { Maximize2, Minimize2, MoreVertical, PanelLeft, PanelRight, X } from 'lucide-vue-next'
import { headerAction } from '../toolWindowHeader'

// IDEA's ToolWindowHeader (platform/platform-impl/src/com/intellij/toolWindow/ToolWindowHeader.kt):
// a title bar that renders the tool window title on the left and an action toolbar on the right,
// sends a click into the content, toggles maximize on a double click and hides the window on a
// middle click. TaoCode renders one header per dock; keeping it a single component stops the two
// copies from drifting apart (IDEA has exactly one such class for every tool window).
const props = defineProps<{
  id: string
  title: string
  anchor: 'left' | 'right'
  maximized: boolean
  menuOpen: boolean
}>()
const emit = defineEmits<{
  activate: []
  hide: []
  maximize: []
  move: [anchor: 'left' | 'right']
  menu: [open: boolean]
}>()
const root = ref<HTMLElement>()

// ToolWindowHeader.kt:212-256 — the gesture table lives in `src/toolWindowHeader.ts` so it can be
// tested without a DOM; `shift+left` is a close click too (UIUtil.java:1843-1846), which is the only
// reason the plain click handler needs the modifier.
function onClick(event: MouseEvent) {
  const action = headerAction({ kind: 'click', button: event.button, shiftKey: event.shiftKey })
  if (action === 'hide') { emit('hide'); return }
  if (action === 'activate') emit('activate')
}
// ToolWindowHeader.kt:242-248 — the DoubleClickListener toggles maximize, i.e. the same thing the
// `MaximizeToolWindow` action does (MaximizeToolWindowAction.java:36).
function onDoubleClick() {
  if (headerAction({ kind: 'dblclick' }) === 'maximize') emit('maximize')
}
// ToolWindowHeader.kt:219-226 — middle click or shift+left click hides the window. The `mousedown`
// half only suppresses the browser's middle-click autoscroll; the release is what acts, exactly like
// IDEA acting on `MOUSE_RELEASED` (:214).
function onMouseDown(event: MouseEvent) {
  if (event.button !== 1) return
  event.preventDefault()
}
function onAuxClick(event: MouseEvent) {
  if (headerAction({ kind: 'aux', button: event.button }) !== 'hide') return
  event.preventDefault()
  emit('hide')
}
// ToolWindowHeader.kt:215-217 + :345-368 — the gear (`ShowOptionsAction`) shows the tool window's own
// group, so a right click anywhere on the header opens the same menu the gear does.
function toggleMenu() {
  if (headerAction({ kind: 'contextmenu' }) !== 'menu') return
  emit('menu', !props.menuOpen)
}
function closeMenu() {
  if (props.menuOpen) emit('menu', false)
}
function focusHeader() {
  root.value?.focus()
}
</script>

<template>
  <div
    ref="root" class="tool-strip-heading" :data-tool-header="id" :class="{ 'menu-open': menuOpen }" tabindex="-1"
    :aria-label="`${title} 工具窗口标题栏`" @click="onClick" @dblclick="onDoubleClick"
    @mousedown="onMouseDown" @auxclick="onAuxClick" @contextmenu.prevent="toggleMenu" @keydown.esc.stop="closeMenu"
  >
    <span class="tool-strip-title">{{ title }}</span>
    <button
      type="button" class="icon-button" :aria-expanded="menuOpen" :aria-label="`${title} 选项`"
      title="移动、最大化或隐藏此工具窗口" @click.stop="toggleMenu"
    ><MoreVertical :size="14" />
    </button>
    <div v-if="menuOpen" class="tool-menu" role="menu" :aria-label="`${title} 选项`" @click.stop @contextmenu.prevent>
      <!-- The item order follows IDEA's ActiveToolwindowGroup (PlatformActions.xml:652-664):
           HideActiveWindow / HideSideWindows / HideBottomWindows / HideAllWindows … MaximizeToolWindow
           … DockToolWindow. TaoCode shows one window per side and its visibility flags are per side,
           so the four hide actions collapse into one operation here — a single 隐藏 entry rather than
           four items that all do the same thing. The text is UIBundle `tool.window.hide.action.name`. -->
      <button type="button" class="menu-button tool-menu-item" role="menuitem" title="隐藏此工具窗口" @click="emit('hide'); focusHeader()">
        <X :size="13" aria-hidden="true" />隐藏
      </button>
      <div class="menu-rule" role="separator" />
      <!-- MaximizeToolWindowAction.java:26/59-62 — Toggleable, so the label flips with the state. -->
      <button
        type="button" class="menu-button tool-menu-item" role="menuitemcheckbox"
        :aria-checked="maximized" :title="maximized ? '恢复工具窗口大小' : '让工具窗口占满整个窗口宽度'"
        @click="emit('maximize'); focusHeader()"
      >
        <Minimize2 v-if="maximized" :size="13" aria-hidden="true" />
        <Maximize2 v-else :size="13" aria-hidden="true" />
        {{ maximized ? '恢复工具窗口大小' : '最大化工具窗口' }}
      </button>
      <div class="menu-rule" role="separator" />
      <button type="button" class="menu-button tool-menu-item" role="menuitem" :disabled="anchor === 'left'" @click="emit('move', 'left'); focusHeader()">
        <PanelLeft :size="13" aria-hidden="true" />移动到左侧
      </button>
      <button type="button" class="menu-button tool-menu-item" role="menuitem" :disabled="anchor === 'right'" @click="emit('move', 'right'); focusHeader()">
        <PanelRight :size="13" aria-hidden="true" />移动到右侧
      </button>
    </div>
  </div>
</template>

<style scoped>
.tool-strip-title { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-strip-heading:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
