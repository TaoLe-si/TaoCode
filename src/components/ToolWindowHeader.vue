<script setup lang="ts">
import { nextTick, computed, ref } from 'vue'
import { Check, Maximize2, Minimize2, MoreVertical, PanelBottom, PanelLeft, PanelRight, X } from 'lucide-vue-next'
import ToolWindowGearRows from './ToolWindowGearRows.vue'
import { headerAction } from '../toolWindowHeader'
import { usePopupAnchor } from '../popupAnchor'
import { toolWindowManager, windowInfo } from '../toolWindowManager.ts'
import { usePopupLayer } from '../popupStack.ts'
import { VIEW_MODE_GROUP_TITLE, viewModeCapabilityFromDom, viewModeRows } from '../toolWindowViewMode.ts'
import type { MenuRow } from '../menus/types'
import { iconSize } from '../uiIcons'

// IDEA's ToolWindowHeader (platform/platform-impl/src/com/intellij/toolWindow/ToolWindowHeader.kt):
// a title bar that renders the tool window title on the left and an action toolbar on the right,
// sends a click into the content, toggles maximize on a double click and hides the window on a
// middle click. TaoCode renders one header per dock; keeping it a single component stops the two
// copies from drifting apart (IDEA has exactly one such class for every tool window).
// 停靠边是**三**个：IDEA 的 `MoveToolWindow` / UIBundle `tool.window.move.to.action.group.name` 给出
// Left / Right / Bottom（`ToolWindowManagerImpl.moveToolWindow` 同样接受 ToolWindowAnchor.BOTTOM）。
// 少了 Bottom 一项，gradle/notifications/vcslog/todo/debug/tests 这些默认不靠左的窗口就没有办法
// 归位 —— 只能停在出厂位置。
const props = defineProps<{
  id: string
  title: string
  anchor: 'left' | 'right' | 'bottom'
  maximized: boolean
  menuOpen: boolean
  /**
   * 齿轮菜单里"属于工具窗口自己"的那几项（引用表见 `src/menus/toolWindowGear.ts`，
   * 由 `menuUi` 按 id 从主菜单动作索引里取，标题与快捷键都不在这里复制）。
   * 上游同一层还有 SpeedSearch / CloseAll / ViewMode / RemoveStripeButton / Help ——
   * 本仓没有能接住的实现，逐条登记在 docs/class-parity-todo.md，不留假控件。
   */
  extraRows: any[]
}>()
const emit = defineEmits<{
  activate: []
  hide: []
  maximize: []
  move: [anchor: 'left' | 'right' | 'bottom']
  menu: [open: boolean]
  pickExtra: [row: any]
}>()
const root = ref<HTMLElement>()
const gear = ref<HTMLElement>()
const menu = ref<HTMLElement>()
// 这张菜单有 12 行（实测 372px 高、246px 宽），比标题栏本身还宽。原先靠 `.tool-menu` 的
// `right: 8px` 贴右边，于是窄侧栏下它的左边缘落到 x = -14.5px，图标与"×"整列被裁掉
// （用户 2026-10-03 截图）。改成 Teleport 到 body + 按实测尺寸夹取视口，口径同
// `src/popupAnchor.ts`；锚点就是齿轮按钮自己（上游 `AbstractPopup` 也是按请求组件定位）。
const { style: menuAt, refresh: refreshMenuAt } = usePopupAnchor(menu, () => {
  const box = gear.value?.getBoundingClientRect()
  return box ? { x: box.left, y: box.bottom } : null
})

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
  const open = !props.menuOpen
  emit('menu', open)
  // 展开后量一次真实高度再决定落在按钮下方还是上方（`placeMenu` 的翻转顺序）。
  if (open) void nextTick(refreshMenuAt)
}
function closeMenu() {
  if (props.menuOpen) emit('menu', false)
}
// 这一层菜单也压进**全局弹层栈**（`src/popupStack.ts`，上游 `PopupDispatcher.java:36-37` 那条全局链）：
// 齿轮菜单与底部标签的「移动到…」是**同一条 ResizeActionGroup 的两种入口**，两层会同时开着
//（先开侧栏齿轮、再右键底部标签）。原先两边各有一条自己的收层路径，于是一次点外面能把两层一起收掉，
// 而 auto-hide 的面板问「焦点进了弹层没有」（`ToolWindowManagerLifecycle.kt:131`）时也答不上来 ——
// **没注册的层等于没有层**。`menuOpen` 是 prop（状态在宿主），这里包一层 computed 喂给栈的 watch。
const menuShown = computed(() => props.menuOpen)
usePopupLayer(menu, menuShown, closeMenu, { cancelOnClickOutside: true })
// --- 视图模式（`TW.ViewModeGroup`）-----------------------------------------------------------
// 上游这一组是 `ToolWindowViewModeAction$Group`（`intellij.platform.ide.impl.actions.xml:479`，
// `popup="true"`），在齿轮组里排在**切换标签形态之后、移动组之前**（`ToolWindowImpl.kt:880-882`）——
// 本仓的头部菜单里"移动组"就是下面那三条「移动到…」，所以这一组正好插在它们前面，相对次序一致。
// 状态读/写走**统一门面** `src/toolWindowManager.ts`（上游 `ToolWindowManager.kt:30` 的
// `getInstance(project)` + `WindowInfo.kt:9-50` 的那份每窗口聚合对象）：
// 一个进程一份窗口状态（安装点在 `src/toolWindowStripes.ts` 的工厂末尾），宿主不必为此加一行。
// 原先这里连读了三份 store 指针（`activeToolWindowLayoutState()` 的 windowTypeState / setViewMode /
// 以及 props 传进来的 anchor+maximized），判词 §B-1 的 `WindowInfo`「缺：每窗口聚合对象」说的就是这种散。
const manager = toolWindowManager()
const viewModeState = () => {
  const info = windowInfo(props.id)
  return info ? { type: info.type, autoHide: info.isAutoHide } : null
}
const viewModeRowsOfWindow = computed<MenuRow[]>(() => {
  if (!windowInfo(props.id)) return []
  return viewModeRows({
    state: viewModeState,
    capability: viewModeCapabilityFromDom(typeof document === 'undefined' ? null : document),
    // `setSelected`（`ToolWindowViewModeAction.java:127-135`）：选中即改 (type, autoHide) 并落盘。
    apply: mode => manager.setViewMode(props.id, mode),
  })
})
function pickViewMode(row: MenuRow) {
  row.run?.()
  focusHeader()
}
// 选完一条就把焦点还给标题栏（键盘上下一步 Esc / 方向键还在头部）。
function pickExtra(row: any) {
  emit('pickExtra', row)
  focusHeader()
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
      ref="gear" type="button" class="icon-button" :aria-expanded="menuOpen" :aria-label="`${title} 选项`"
      title="移动、最大化或隐藏此工具窗口" @click.stop="toggleMenu"
    ><MoreVertical :size="iconSize.control" />
    </button>
    <!-- Teleport 到 body：侧栏/右 dock 面板是 `overflow: hidden`，长在里面的菜单会被裁掉
         （与 ToolWindowGear.vue / ToolWindowAnchorMenu.vue 同一个理由）。 -->
    <Teleport to="body">
    <div v-if="menuOpen" ref="menu" class="tool-menu tool-header-menu" role="menu" :style="menuAt" :aria-label="`${title} 选项`" @click.stop @contextmenu.prevent @keydown.esc.stop.prevent="closeMenu">
      <!-- The item order follows IDEA's ActiveToolwindowGroup (PlatformActions.xml:652-664):
           HideActiveWindow / HideSideWindows / HideBottomWindows / HideAllWindows … MaximizeToolWindow
           … DockToolWindow. TaoCode shows one window per side and its visibility flags are per side,
           so the four hide actions collapse into one operation here — a single 隐藏 entry rather than
           four items that all do the same thing. The text is UIBundle `tool.window.hide.action.name`. -->
      <button type="button" class="menu-button tool-menu-item" role="menuitem" title="隐藏此工具窗口" @click="emit('hide'); focusHeader()">
        <span class="menu-item-icon"><X :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">隐藏</span>
      </button>
      <div class="menu-rule" role="separator" />
      <!-- MaximizeToolWindowAction.java:26/59-62 — Toggleable, so the label flips with the state. -->
      <button
        type="button" class="menu-button tool-menu-item" role="menuitemcheckbox"
        :aria-checked="maximized" :title="maximized ? '恢复工具窗口大小' : '让工具窗口占满整个窗口宽度'"
        @click="emit('maximize'); focusHeader()"
      >
        <span class="menu-item-icon"><Minimize2 v-if="maximized" :size="iconSize.menu" aria-hidden="true" /><Maximize2 v-else :size="iconSize.menu" aria-hidden="true" /></span>
        <span class="menu-item-title">{{ maximized ? '恢复工具窗口大小' : '最大化工具窗口' }}</span>
      </button>
      <div class="menu-rule" role="separator" />
      <!-- `TW.ViewModeGroup`：五个模式里"本仓现在真能兑现的"那几档（浮层容器没接上时「浮动」整行不给，
           「窗口」要第二个原生窗口 ⇒ 永远不给）。单选态用 radio + aria-checked，与上游
           `DumbAwareToggleAction` 在菜单里的形态一致。 -->
      <template v-if="viewModeRowsOfWindow.length">
        <span class="menu-section-label" role="presentation">{{ VIEW_MODE_GROUP_TITLE }}</span>
        <button
          v-for="row in viewModeRowsOfWindow" :key="row.id" type="button" class="menu-button tool-menu-item"
          role="menuitemradio" :aria-checked="row.checked ? row.checked() : false"
          :title="typeof row.title === 'string' ? row.title : undefined" @click="pickViewMode(row)"
        >
          <span class="menu-item-icon"><Check v-if="row.checked?.()" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">{{ row.title }}</span>
        </button>
        <div class="menu-rule" role="separator" />
      </template>
      <button type="button" class="menu-button tool-menu-item" role="menuitem" :disabled="anchor === 'left'" @click="emit('move', 'left'); focusHeader()">
        <span class="menu-item-icon"><PanelLeft :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">移动到左侧</span>
      </button>
      <button type="button" class="menu-button tool-menu-item" role="menuitem" :disabled="anchor === 'right'" @click="emit('move', 'right'); focusHeader()">
        <span class="menu-item-icon"><PanelRight :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">移动到右侧</span>
      </button>
      <button type="button" class="menu-button tool-menu-item" role="menuitem" :disabled="anchor === 'bottom'" @click="emit('move', 'bottom'); focusHeader()">
        <span class="menu-item-icon"><PanelBottom :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">移动到底部</span>
      </button>
      <!-- 工具窗口自己的那一组（上游 GearActionGroup :857-891）：行、标题、快捷键与可用性都取自主菜单
           动作索引；渲染器与底部 dock 的齿轮共用同一个 ToolWindowGearRows，两处不再各抄一份。
           `:tool-window-id="id"` 是上游那一份"按窗口问"的对应物 —— 标题栏的齿轮组本来就是
           按这个头部自己的那个 `ToolWindow` 现取的（`InternalDecoratorImpl.kt:290` 的
           `gearProducer = { toolWindow.createPopupGroup(true) }`），所以注册表那道
           `canCloseContents()` 在这里问的就是**本窗口**（`ToolWindowImpl.kt:647`）。
           段落可见性仍按整张行表判：本窗口这一侧的行表里那些与内容相关的行本来就不出现
           （`contentsScoped` 那一位，侧栏没有可关的内容），摘行只会少不会多，不会有空分隔线。 -->
      <template v-if="extraRows.length">
        <div class="menu-rule" role="separator" />
        <ToolWindowGearRows :tool-window-id="id" :rows="extraRows" @pick="pickExtra" />
      </template>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tool-strip-title { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-strip-heading:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
/* `.tool-menu` 默认是 `position: absolute; top: 100%; right: …` —— 那是给"长在面板里"的形态用的。
   这张已经 Teleport 到 body，位置由 `usePopupAnchor` 按实测尺寸给，必须换成 fixed 并清掉
   `right`，否则内联的 left 与样式表的 right 会把菜单同时拉向两边。 */
.tool-header-menu { position: fixed; top: auto; right: auto; }
</style>
