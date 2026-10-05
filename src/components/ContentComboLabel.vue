<script setup lang="ts">
// COMBO 内容形态的下拉标签本体（IDEA `ContentComboLabel.java` + `ComboContentLayout`）。
//
// 上游行为（逐条对到参考树）：
//   · 标签上是**内容的图标 + 名称 + 下拉箭头**（`ContentComboLabel.update()` :82-99
//     的 `updateTextAndIcon(getContent(), true, …)` 与 `myComboIcon`），
//     `myComboIcon` 是新 UI 的 `AllIcons.General.LinkDropTriangle` / 旧 UI 的 `ArrowDown`。
//   · 单击（`handleMouseClick` :69-80，`isToDrawCombo()` 为真时）=
//     `ToolWindowContentUi.toggleContentPopup(myUi, contentManager)`（`:862-875`）：弹一个
//     **内容列表**，选中项是默认项；键盘 Enter/上下也走同一条（`keyPressed` :51-55）。
//   · 无障碍动作名取 `UIManager.getString("ComboBox.togglePopupText")`（`:192`）——
//     本仓用同义的「显示视图列表」；文案的「标签页 / 视图」两档来自
//     `ShowContentAction.update`（`src/toolWindowContentUi.ts` 的 `contentCountLabel`）。
//
// 图标：工具窗口 id 走注册表（`src/toolWindowMeta.ts` 的 `toolIcons`）；引用那几条
// （id 形如 `references:12`）与固定内容各给一个本仓已有的字形 —— 上游是内容自己的图标，
// 这里的对应关系是形态差异，不是新造的状态。
import { computed, nextTick, ref, type Component } from 'vue'
import { Check, ChevronDown, FileCode2, ListTree, Play, SquareTerminal, TriangleAlert, Workflow, X } from 'lucide-vue-next'
import { toolIcons } from '../toolWindowMeta.ts'
import { contentCountLabel, type ToolWindowContentUiType } from '../toolWindowContentUi.ts'
import { usePopupLayer } from '../popupStack.ts'
import { speedSearchMatches, speedSearchStepForKey, stepVisibleIndex } from '../speedSearch.ts'
import { iconSize } from '../uiIcons'
import SpeedSearchBar from './SpeedSearchBar.vue'

export interface ContentComboOption { id: string; label: string }

const props = defineProps<{
  options: ContentComboOption[]
  /** 当前选中的内容 id（含 `references:<n>` 这种复合 id）。 */
  value: string
  /** 形态档：只影响无障碍文案里的「标签页 / 视图」一词。 */
  type?: ToolWindowContentUiType
}>()
const emit = defineEmits<{ (event: 'pick', id: string): void }>()

const open = ref(false)
// 弹层注册进**全局弹层栈**（上游 `PopupDispatcher.java:36-37` 那条挂在 AWT 事件队列上的全局链，
// 本仓由 `src/popupStack.ts` 承接）：
//   · `StackingPopupDispatcherImpl.java:116-164` —— 点外面时自顶向下裁决，落点在**别的**弹层里
//     也要把盖在它上面的这一层关掉（本组件原先只有自己的 backdrop，两层弹层互相看不见）；
//   · `:131`（`ToolWindowManagerLifecycle.kt`）—— auto-hide 的工具窗口在「焦点进了弹层」时不收，
//     这条问的就是 `popupHasFocusWithin`，**没注册的层答不上来**，于是开着内容列表时面板当场收掉。
// 速度搜索：这一层列表**自带**它，不是可选项 ——
// `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SelectContentStep.kt:17`
// `override fun isSpeedSearchEnabled(): Boolean = true`，
// `ListPopupImpl.java:1129` 按这一位把搜索装进弹层（过滤口径复用 `src/speedSearch.ts`，
// 与 `src/popupSteps.ts:108-114` 的 `shouldBeShowing` 同一条规则，不另起一套匹配）。
// 搜索框在这一层是**常驻**的（不像树/书签那样能收 —— 见 `tests/popup-layer-wiring.test.mjs:152` 那条门禁），
// 所以 `speedSearchKeyAction` 的 'accept'（收起搜索框那一支，`SpeedSearchBase.java:964-975`）在这里没有对象可收。
const filter = ref('')
/** 过滤后**可见**的那些行的「原索引」。上游 `ListPopupModel` 同时留着原表与过滤表
 *  （`:44-48` `getOriginalIndex(filteredIndex)`、`:143-150` `refilter()`、`:152-154` `isVisible(value)`）：
 *  没命中的行不是被从数据里删掉，而是**不可见** ⇒ 列表仍然逐条列 `contents` 的每一条
 *  （`ToolWindowContentUi.java:863` 把 `contentManager.getContents()` 全量交给这一步），
 *  命中的那条规则与 `SpeedSearch.shouldBeShowing`（`SpeedSearch.java:53-56`）同源，不另起一套匹配。 */
const rows = computed(() => {
  const query = filter.value.trim()
  const visible: number[] = []
  props.options.forEach((option, index) => {
    if (!query || speedSearchMatches(query, option.label)) visible.push(index)
  })
  return visible
})
const menu = ref<HTMLElement | null>(null)
//   · **Esc 两段式**（`SpeedSearch.java:77-81` 在前、`AbstractPopup.java:3003-3010` 在后）：
//     压着过滤串时第一次 Esc 只清空过滤串、列表不关；第二次才收掉这一层。这两步都吃掉按键
//     （`e.consume()`），所以页面里别的 Esc 链（backdrop、标题栏菜单）不会在同一次按键里跟着执行。
usePopupLayer(menu, open, () => { open.value = false }, {
  cancelOnClickOutside: true,
  holdingFilter: () => filter.value !== '',
  resetFilter: () => { filter.value = '' },
})
/** 键盘高亮：**原索引**（打开时从当前项开始，上游 `setDefaultOptionIndex(selectedIndex)`，
 *  `ToolWindowContentUi.java:865-867`）。用原索引而不是「过滤后第几行」，是因为 `rows` 本身就是
 *  原索引表（`ListPopupModel.java:44-48` 那条映射），高亮才不会在过滤串变化时跳行。 */
const active = ref(0)
const selectedIndex = computed(() => Math.max(0, props.options.findIndex(option => option.id === props.value)))
const selected = computed(() => props.options.find(option => option.id === props.value) ?? props.options[0])
const FIXED_ICONS: Record<string, Component> = { output: Workflow, run: Play, problems: TriangleAlert, hierarchy: ListTree, terminal: SquareTerminal }
function iconOf(id: string): Component | null {
  if (FIXED_ICONS[id]) return FIXED_ICONS[id]!
  if (id.startsWith('references:')) return FileCode2
  return (toolIcons as Record<string, Component | undefined>)[id] ?? null
}
function toggle() {
  open.value = !open.value
  if (!open.value) return
  // 每次打开都是新的一层弹层（上游每次 `createListPopup(step)` 现建，`ToolWindowContentUi.java:862-870`），
  // 所以过滤串不带过来；高亮从当前项开始，焦点交给过滤串的输入框
  //（与 `src/components/ToolWindowGear.vue:47` 同一个手法）。
  filter.value = ''
  active.value = selectedIndex.value
  void nextTick(() => menu.value?.querySelector('input')?.focus())
}
function pick(id: string) { open.value = false; emit('pick', id) }
/** 打了字之后高亮必须还落在**可见**的那一行上：当前行被过滤掉时跳到第一条可见行
 *  （`ListPopupModel.java:143-150` 的 refilter；一条都没命中时不选，`ListPopupImpl.java:505`）。 */
function onFilterInput(value: string) {
  filter.value = value
  if (!rows.value.includes(active.value)) active.value = rows.value[0] ?? 0
}
function onKeydown(event: KeyboardEvent) {
  if (!open.value) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle() }
    return
  }
  if (event.key === 'Escape') {
    // 两段式的第一段：压着过滤串时只清串、列表不关（`SpeedSearch.java:77-81`）。
    // 全局弹层栈在**捕获阶段**就做掉这一步并把按键吃掉，正常走不到这里；
    // 留着它是没有全局链时（SSR / 单测夹具）的同一判据回退。
    if (filter.value) { event.preventDefault(); filter.value = ''; return }
    event.preventDefault(); open.value = false; return
  }
  // 这一层列表**吃掉** ↑ ↓ Home End 四个键：上游把「是不是这四个」与「这四个各自去哪」写成两个函数
  // —— `SpeedSearchBase.java:1030-1032` 的 isUpDownHomeEnd（就是这四个键名）判闸门、`:982-984` 就
  // consume，`:684-691` 过了闸门才走 `:695-706` 的 findTargetElement 定目标。这里同形：闸门点名四个键，
  // 目标仍由 `speedSearchStepForKey`（`src/speedSearch.ts:112-118`）给，索引算术由
  // `stepVisibleIndex`（`:133-141`）给 —— 各一处真源，不互相重算。
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const step = speedSearchStepForKey(event.key)
    if (step) active.value = stepVisibleIndex(rows.value, active.value, step.kind)
    return
  }
  // 一条都没命中时 Enter 不选任何东西（`ListPopupImpl.java:505`：压着过滤串且模型为空 ⇒ return false）。
  if (event.key === 'Enter') {
    const option = rows.value.includes(active.value) ? props.options[active.value] : undefined
    if (option) { event.preventDefault(); pick(option.id) }
  }
}
</script>

<template>
  <div class="content-combo" @keydown="onKeydown">
    <button type="button" class="output-content-select content-combo-toggle" :aria-expanded="open" aria-haspopup="listbox"
            :aria-label="`显示${contentCountLabel(type ?? 'combo')}列表`" :title="selected?.label"
            @click="toggle" @keydown.esc.stop="open = false">
      <component :is="iconOf(selected?.id ?? '')" v-if="iconOf(selected?.id ?? '')" :size="iconSize.inline" aria-hidden="true" />
      <span class="content-combo-label">{{ selected?.label ?? '' }}</span>
      <ChevronDown :size="iconSize.dense" aria-hidden="true" />
    </button>
    <div v-if="open" class="content-combo-backdrop" @click="open = false" @contextmenu.prevent="open = false" />
    <div v-if="open" ref="menu" class="content-combo-menu" role="listbox" :aria-label="`${contentCountLabel(type ?? 'combo')}列表`">
      <!-- 速度搜索的输入框（`SelectContentStep.kt:17` 给这一层开了它；上游那只是浮在列表上的
           一个小输入框 `SpeedSearchPatternField`，本仓用现成的 `SpeedSearchBar.vue`）。
           按键不在这里另接一条：事件照 DOM 冒泡给根节点上那一个 `onKeydown`，
           一个按键只有一个所有者（与弹层栈那条全局链同一套理由）。 -->
      <SpeedSearchBar :open="true" :query="filter" @input="onFilterInput" />
      <button v-for="(option, index) in options" v-show="rows.includes(index)" :key="option.id" type="button" class="menu-button content-combo-row"
              role="option" :aria-selected="option.id === value" :class="{ 'is-active': index === active }"
              @mouseenter="active = index" @click="pick(option.id)">
        <span class="menu-item-icon"><Check v-if="option.id === value" :size="iconSize.menu" aria-hidden="true" /><component v-else :is="iconOf(option.id)" :size="iconSize.menu" aria-hidden="true" /></span>
        <span>{{ option.label }}</span>
      </button>
      <p v-if="!options.length" class="content-combo-empty"><X :size="iconSize.dense" aria-hidden="true" /> 没有内容。</p>
    </div>
  </div>
</template>
