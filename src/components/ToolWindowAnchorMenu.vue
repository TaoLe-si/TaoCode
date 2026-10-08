<script setup lang="ts">
// 底部 dock 标签的「移动到…」菜单。三条与 ToolWindowHeader 里那三条同源：
// UIBundle `tool.window.move.to.action.group.name` 给出 Left / Right / Bottom 三个方向
// （`ToolWindowManagerImpl.moveToolWindow` 同样只接受这三个锚点）。
// 存在的理由：窗口沉到底部后左栏不再渲染它的标题栏，标题栏上那个菜单就够不着了 ——
// 没有这个入口，「移动到底部」是单向的。
import { ref, watch } from 'vue'
import { PanelBottom, PanelLeft, PanelRight } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { usePopupAnchor } from '../popupAnchor'
import { usePopupLayer } from '../popupStack.ts'

const props = defineProps<{ anchor: string; x: number; y: number }>()
const emit = defineEmits<{ (event: 'move', side: 'left' | 'right' | 'bottom'): void; (event: 'close'): void }>()

const sides = [
  { side: 'left' as const, label: '移动到左侧', icon: PanelLeft },
  { side: 'right' as const, label: '移动到右侧', icon: PanelRight },
  { side: 'bottom' as const, label: '移动到底部', icon: PanelBottom },
]
// 点外面 / Esc 都收在这条**全局弹层栈**上，而不是本组件自己挂 window 监听：
// 上游 `PopupDispatcher.java:36-37` 就是把 MOUSE_PRESSED 与按键分发挂在同一条全局链上，
// `StackingPopupDispatcherImpl.java:116-164` 决定"落点在哪层 ⇒ 只关它上面那几层"，
// `:181-193` 决定"Esc 只给栈顶"。组件各挂一份监听的话，两层弹层会互相抢同一次点击。
//
// 挂进栈还有一条实际收益：`src/toolWindowStripes.ts` 的自动隐藏要问
// 「焦点是不是进了弹层」（`ToolWindowManagerLifecycle.kt:131` 的 `getParentBalloonFor`，
// 本仓 `popupHasFocusWithin`）—— 只有**注册过**的层才答得上来。没注册的菜单就等于
// "焦点没在弹层里"，于是右键开着这个菜单时，autoHide 的窗口当场收掉。
const box = ref<HTMLElement>()
const { style: menuAt, refresh: refreshMenuAt } = usePopupAnchor(box, () => ({ x: props.x, y: props.y }))
watch(() => [props.x, props.y], refreshMenuAt)
/** 宿主用 `v-if` 控制挂载，所以挂载即在显示 —— 这一位只用来喂栈的 push/pop（`:49-74`）。 */
const shown = ref(true)
usePopupLayer(box, shown, () => emit('close'), { cancelOnClickOutside: true })
</script>

<template>
  <div ref="box" class="tool-menu tool-anchor-menu" role="menu" aria-label="移动到" :style="menuAt" @contextmenu.prevent>
    <button v-for="item in sides" :key="item.side" type="button" class="menu-button tool-menu-item" role="menuitem"
            :disabled="anchor === item.side" @click="emit('move', item.side)">
      <!-- 同一个 14px 图标槽（`.menu-item-icon`），与齿轮弹层里 `ToolWindowHeader.vue` 的
           移动到左/右/底三行对齐 —— 两个弹层是同一条 ResizeActionGroup 的两种入口。 -->
      <span class="menu-item-icon"><component :is="item.icon" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">{{ item.label }}</span>
    </button>
  </div>
</template>
