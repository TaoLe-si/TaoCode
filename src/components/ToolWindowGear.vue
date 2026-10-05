<script setup lang="ts">
// 工具窗口的齿轮按钮 + 那一份弹出菜单（上游 `ToolWindowHeader.kt:119` 的 `ShowOptionsAction`，
// 弹层内容 = `GearActionGroup`，`ToolWindowImpl.kt:801-817`、`:857-891`）。
//
// 为什么要单独一个组件：IDEA 给侧栏标题栏和底部 dock 的齿轮是**同一份内容**，本仓却只有侧栏那个
// 头有齿轮 —— 底部 dock 的内容动作（关闭所有标签页 / 标签形态）因此只能从主菜单进。
// 这里把"齿轮 + 内容组"抽出来两处共用；侧栏头部自己的那几条（隐藏 / 最大化 / 移动到…）
// 仍留在 `ToolWindowHeader.vue`，因为它们属于那个 DOM 的标题栏工具条。
//
// 弹层 Teleport 到 body 并用 fixed 定位：底部 dock 的 `.output-panel` 是 `overflow: hidden`，
// 长在里面的菜单会被裁掉（与 `ToolWindowAnchorMenu.vue` 同一个理由）。
// 开合照 `PopupState.forPopupMenu()` 的行为：点外面与 Esc 都收（`ToolWindowHeader.kt:345-368`）。
// 这两条现在交给**全局弹层栈**（`src/popupStack.ts`，上游 `PopupDispatcher.java:36-37` 那条
// 挂在 AWT 事件队列上的全局链）：本组件原先自己在 `window` 上挂一份捕获阶段的 `pointerdown`
// 再加一份 `keydown`，于是同一次点击有**两个**全局所有者 —— 与 `ToolWindowAnchorMenu.vue` 同一处病，
// 同一个修法（判据 `tests/popup-layer-wiring.test.mjs`）。栈上的裁决是
// `StackingPopupDispatcherImpl.java:116-164`（自顶向下：落点在某层内就停），
// Esc 走 `:181-193` + `SpeedSearch.java:77-81` 的两段式。
import { nextTick, ref } from 'vue'
import { MoreVertical } from 'lucide-vue-next'
import ToolWindowGearRows from './ToolWindowGearRows.vue'
import type { MenuRow } from '../menus/types'
import { usePopupLayer } from '../popupStack.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{ rows: MenuRow[]; label?: string }>()
const emit = defineEmits<{ pick: [row: MenuRow] }>()
const open = ref(false)
const at = ref({ left: 0, bottom: 0 })

function toggle(event: MouseEvent) {
  if (open.value) { open.value = false; return }
  if (!props.rows.length) return
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  // 贴着按钮往上长（`top: 100%` 那一套是给侧栏往下长用的；底部 dock 往下没空间）。
  at.value = { left: Math.max(8, box.right - 0), bottom: window.innerHeight - box.top + 6 }
  open.value = true
}
// 这一层的 DOM 根节点（栈要量矩形、判「焦点进了弹层」——`popupHasFocusWithin`，
// `ToolWindowManagerLifecycle.kt:131` 的本仓等价物：auto-hide 的窗口在菜单开着时不收面板）。
const menu = ref<HTMLElement | null>(null)
usePopupLayer(menu, open, () => { open.value = false }, { cancelOnClickOutside: true })
function pick(row: MenuRow) {
  open.value = false
  // 关掉之后要把焦点还给齿轮本身，键盘用户才能接着 Esc/回车（上游的 popup 关闭时也把焦点还回触发组件）。
  void nextTick(() => document.querySelector<HTMLElement>('.tool-gear > button')?.focus())
  emit('pick', row)
}
</script>

<template>
  <span v-if="rows.length" class="tool-gear">
    <button type="button" class="icon-button" :aria-expanded="open" :aria-label="label ?? '工具窗口选项'"
            :title="label ?? '工具窗口选项'" @click.stop="toggle($event)"><MoreVertical :size="iconSize.control" /></button>
  </span>
  <Teleport v-if="open" to="body">
    <div ref="menu" class="tool-menu tool-gear-menu" role="menu" :aria-label="label ?? '工具窗口选项'"
         :style="{ left: `${at.left}px`, bottom: `${at.bottom}px` }" @contextmenu.prevent>
      <ToolWindowGearRows :rows="rows" @pick="pick" />
    </div>
  </Teleport>
</template>

<style scoped>
.tool-gear { display: inline-flex; position: relative; }
</style>
