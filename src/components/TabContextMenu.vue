<script setup lang="ts">
// 编辑器标签右键菜单（IDEA `EditorTabPopupMenu`）。
//
// 从 App.vue 的模板里整块搬出来（那个文件贴着 2737 行的机检上限，而这一块 44 行全是行数据与
// 点击处理，属于"宿主只留一行调用"的那一类）。宿主经 `ctx` 注入依赖 —— 与 `ToolWindowView.vue`
// 同一套做法：菜单里出现的每个宿主函数都在 `ctx` 里现取，组件自己**不持有任何编辑器状态**。
//
// 行序照上游（`PlatformActions.xml:907-915` 的 EditorTabPopupMenu + 挂在它上面的
// `popup@ExpandableBookmarkContextMenu`，见下面注释）。
//
// **第一百零九批**在这一块里补上了 `CopyReferencePopupGroup`（「复制路径/引用…」）：
// 上游 `:1280` 的 `<add-to-group group-id="EditorTabPopupMenu" anchor="after" relative-to-action="CopyPaths"/>`
// 就是把它插在「复制路径」之后 —— 也就是本文件里 `复制路径` 那一行后面。
// 四行的文案与文本口径在 `src/copyPathActions.ts`（与编辑菜单、查找结果右键同一个模块）。
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AnchoredMenu from './AnchoredMenu.vue'
import { usePopupLayer } from '../popupStack.ts'
import { COPY_REFERENCE_GROUP, FIND_COPY_ACTIONS, findResultClipboardText, type FindCopyActionId } from '../copyPathActions'
import { SOURCE_ROOT_PATH_LABEL, sourceRootPathText } from '../copyPathActions'
import { sourceRootFor } from '../projectFileIndex'
import { nextMenuIndex } from '../menuKeyboard'

const props = defineProps<{ ctx: any; path: string; pane: number; x: number; y: number }>()
const emit = defineEmits<{ close: [] }>()

/** 复制那一组：上游是子菜单（`popup="true"`），本仓的浮层里就地展开（与 `EditorPopupMenu` 同一种交互）。 */
const copyOpen = ref(false)
const close = () => emit('close')
// 这一层原先只靠 App.vue 的 backdrop 收（`@click="tabMenu = null"`），**不在**全局弹层栈上 ⇒
// 栈按 `StackingPopupDispatcherImpl.java:181-193` 把 Esc 交给"栈顶那一层"时看不见它（Esc 对它无效），
// 而 `:116-164` 点外面的裁决也只认注册过的层。注册之后：Esc 收这一层并吃掉按键，
// `popupHasFocusWithin`（`ToolWindowManagerLifecycle.kt:131` 那条判据）也才答得出「焦点进了标签菜单」。
const menu = ref<{ box?: HTMLElement | null } | null>(null)
const box = computed(() => menu.value?.box ?? null)
/** 宿主用 `v-if` 控制挂载（`App.vue:2501`），所以挂载即在显示 —— 与 `ToolWindowAnchorMenu.vue:31` 同一档。 */
const shown = ref(true)
usePopupLayer(box, shown, close, { cancelOnClickOutside: true })
// 键盘与焦点：这张菜单在上游就是一个 `JPopupMenu`（`TabLabel.kt:463-491` 用
// `JBPopupMenu.showByEvent` 显示它，`JBPopupMenu.java:203-205` 里就是 `menu.show(...)`），
// 键鼠口径来自 Swing 的弹层菜单：
//   · 显示时弹层成为"选中路径"的根 ⇒ 键盘归弹层（`JPopupMenu.java:798-806` 的
//     `setSelectedPath([this])`），关闭时焦点还给激活前的组件（`BasicPopupMenuUI.java:1006-1040`
//     的 `MenuKeyboardHelper`：`removeItems()` 把 `lastFocused` 收回去）；
//   · ↑↓ 在 Java 键表里是 `selectPrevious`/`selectNext`（`BasicLookAndFeel.java:1139-1152`）；
//     还没有选中行时选第一条/最后一条**可用**行（`BasicPopupMenuUI.java:567-580` 的 `selectItem`），
//     行走表跳过不可用的行（同文件 `:702-730` 的 `nextEnabledChild`/`previousEnabledChild`；
//     IDEA 树上没有人设 `MenuItem.disabledAreNavigable`，所以禁用行不在行走表里）；
//   · Enter / Space 是 `return`，只对**已经选中**的那一行生效（`:457-485` 的 `doReturn`，
//     路径里只有弹层本身时什么都不做）；
//   · Esc 是 `cancel`（键表同一行），本仓由全局弹层栈接（注册见上），不在这里重写一遍。
// 本仓的等价物就是真实 DOM 焦点：这一句是键盘通路的前提（右键落点是不可聚焦的标签 div，
// 不把焦点接进来，按键就落在 body 上，整张菜单键盘够不着）。
// 行走表与 `TabEntryPoint.vue:76-84` 同一套写法（`document.activeElement` 定位当前行），
// 环绕那一步复用 `src/menuKeyboard.ts` 的 `nextMenuIndex`（编辑器右键浮层用的同一份纯逻辑）。
const returnFocus = ref<HTMLElement | null>(null)
/** 可走的行：`:disabled` 的按钮不在焦点顺序里，也不进行走表（与 `nextEnabledChild` 同一条）。 */
function walkableRows(): HTMLElement[] {
  return [...(box.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
}
function moveActive(step: number) {
  const list = walkableRows()
  const current = document.activeElement
  const index = nextMenuIndex(list.length, list.findIndex(row => row === current), step)
  list[index]?.focus()
}
function onKeydown(event: KeyboardEvent) {
  // 只认 ↑↓（`selectPrevious`/`selectNext`），与 `EditorPopupMenu.vue:57-58` 同一种写法：
  // Enter/Space 由原生 `<button>` 翻成 click，Esc 归全局弹层栈 —— 三条各只有一个所有者。
  if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); return }
  if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); return }
}
onMounted(() => {
  // 打开前的焦点持有者（上游的 `lastFocused`）：关闭时还给它。
  returnFocus.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  void nextTick(() => box.value?.focus())
})
onBeforeUnmount(() => {
  const active = document.activeElement
  const inside = active instanceof HTMLElement && box.value?.contains(active) === true
  // 只在焦点还在菜单里、或被摘掉后掉回 body 时还原 —— 动作自己把焦点挪走（如打开设置对话框）就不抢。
  if (!inside && active !== null && active !== document.body) return
  if (returnFocus.value?.isConnected) returnFocus.value.focus()
})
const copyRows = computed(() => FIND_COPY_ACTIONS.map(action => ({ id: action.id, title: action.label })))
/** 这一行标签对应的位置：行号取该标签记住的光标行（没有编辑器时按第 1 行 —— 上游没有 editor 就没有这一条）。 */
function copyTarget() {
  return { path: props.path, line: props.ctx.tabLine(props.path) }
}
function pickCopy(id: FindCopyActionId) {
  const root = props.ctx.workspaceRoot()
  props.ctx.copy(findResultClipboardText(id, copyTarget(), root))
  close()
}
/**
 * 「来自源根的路径」（上游 `CopySourceRootPathProvider`）：按当前标签的文件现算源根，
 * 算不出（`getSourceRootForFile` 返 null）就不出这一行 —— 上游 `?: return null` 也是这个行为。
 * 源根的取法见 `src/projectFileIndex.ts`（配置优先，渲染层拿不到设置时按目录约定）。
 */
const sourceRootRow = computed(() => {
  const text = sourceRootPathText(copyTarget(), sourceRootFor(props.path))
  return text === null ? null : { title: SOURCE_ROOT_PATH_LABEL, text }
})
function pickSourceRootCopy(text: string) {
  props.ctx.copy(text)
  close()
}
</script>

<template>
  <AnchoredMenu ref="menu" :x="x" :y="y" role="menu" aria-label="标签页操作" tabindex="-1" @keydown="onKeydown" @pointerdown.stop>
    <!-- IDEA's EditorTabPopupMenu order: Close group | Copy Paths | split rows | Pin / Keep / Configure；
         书签那三条（ToggleBookmark / EditBookmark / AddAnotherBookmark 的相对顺序）来自挂在
         `EditorTabPopupMenu` 上的 `popup@ExpandableBookmarkContextMenu`
         （platform/bookmarks/resources/intellij.platform.bookmarks.xml:222-227）。 -->
    <button v-if="ctx.fileBookmarkLabel(path) === '删除书签'" role="menuitem" @click="ctx.addFileBookmarkToAnotherList(path); close()">添加另一书签…</button>
    <button v-if="ctx.fileBookmarkLabel(path) === '删除书签'" role="menuitem" @click="ctx.editBookmarkAt(path); close()">编辑描述</button>
    <button role="menuitem" @click="ctx.bookmarkFile(path); close()">{{ ctx.fileBookmarkLabel(path) }}</button>
    <div class="menu-rule" role="separator" />
    <button role="menuitem" @click="ctx.closeTabIn(pane, path); close()">关闭</button>
    <button role="menuitem" :disabled="!ctx.canCloseOthers(pane, path)" :aria-disabled="!ctx.canCloseOthers(pane, path)" @click="ctx.closeOtherTabsIn(pane, path); close()">关闭其他标签页</button>
    <button role="menuitem" :disabled="!ctx.canCloseRight(pane, path)" :aria-disabled="!ctx.canCloseRight(pane, path)" @click="ctx.closeTabsToRightIn(pane, path); close()">关闭右侧标签页</button>
    <button role="menuitem" :disabled="!ctx.canCloseLeft(pane, path)" :aria-disabled="!ctx.canCloseLeft(pane, path)" @click="ctx.closeTabsToLeftIn(pane, path); close()">关闭左侧标签页</button>
    <button role="menuitem" :disabled="!ctx.canCloseUnpinned(pane, path)" :aria-disabled="!ctx.canCloseUnpinned(pane, path)" @click="ctx.closeUnpinnedTabsIn(pane); close()">关闭所有未固定标签页</button>
    <button role="menuitem" @click="ctx.closeAllTabsIn(pane); close()">全部关闭</button>
    <div class="menu-rule" role="separator" />
    <button role="menuitem" @click="ctx.copyPathOfTab(path); close()">复制路径</button>
    <!-- `CopyReferencePopupGroup`（上游 :1280 插在 CopyPaths 之后）。`popup="true"` 的子段在
         ARIA 里就是 `aria-haspopup="menu"` + 真实展开态；展开后子行就地接在父行之后（同一张菜单）。 -->
    <button role="menuitem" class="has-sub" aria-haspopup="menu" :aria-expanded="copyOpen" @click="copyOpen = !copyOpen">{{ COPY_REFERENCE_GROUP }}</button>
    <template v-if="copyOpen">
      <button v-for="row in copyRows" :key="row.id" class="sub-item" role="menuitem" @click="pickCopy(row.id)">{{ row.title }}</button>
      <button v-if="sourceRootRow" class="sub-item" role="menuitem" @click="pickSourceRootCopy(sourceRootRow.text)">{{ sourceRootRow.title }}</button>
    </template>
    <button role="menuitem" v-if="ctx.isDesktop" @click="ctx.toggleReadOnly(path); close()">切换只读属性</button>
    <!-- AssociateWithFileTypeAction + FilePropertiesGroup rows for this tab. -->
    <template v-if="ctx.hasWorkspace()">
      <button role="menuitem" v-for="[choice, label] in ctx.languageChoices" :key="`filetype-${choice}`" @click="ctx.associateFileType(path, choice)">关联文件类型：{{ label }}</button>
      <button role="menuitem" @click="ctx.associateFileType(path, 'auto')">恢复按扩展名识别</button>
    </template>
    <!-- FilePropertiesGroup > ChangeLineSeparators acts on the selected tab. -->
    <template v-if="ctx.isDesktop && ctx.hasTab(path)">
      <button role="menuitem" @click="ctx.convertLineSeparators('crlf', path)">转换为 Windows (CRLF) 行尾</button>
      <button role="menuitem" @click="ctx.convertLineSeparators('lf', path)">转换为 Unix and macOS (LF) 行尾</button>
    </template>
    <div class="menu-rule" role="separator" />
    <!-- IDEA EditorTabPopupMenu (PlatformActions.xml:907-915) alternates
         Split Right / Split-and-Move Right / Split Down / Split-and-Move
         Down, then the opposite-group pair and the unsplit pair. -->
    <button role="menuitem" @click="ctx.splitFromTabMenu(pane, path, 'horizontal')">向右拆分（Split Right）</button>
    <button role="menuitem" @click="ctx.moveTabToSide(pane, path, 'horizontal')">拆分并移动到右侧（Split and Move Right）</button>
    <button role="menuitem" @click="ctx.splitFromTabMenu(pane, path, 'vertical')">向下拆分（Split Down）</button>
    <button role="menuitem" @click="ctx.moveTabToSide(pane, path, 'vertical')">拆分并移动到下方（Split and Move Down）</button>
    <button role="menuitem" @click="ctx.moveTabToSide(pane, path, ctx.splitOrientation() === 'vertical' ? 'vertical' : 'horizontal')">移动到另一侧编辑器组</button>
    <button role="menuitem" @click="ctx.openInOppositeGroup(path); close()">在另一侧编辑器组中打开</button>
    <button role="menuitem" :disabled="ctx.splitOrientation() === 'none'" :aria-disabled="ctx.splitOrientation() === 'none'" @click="ctx.changeSplitOrientation(); close()">更改拆分方向</button>
    <button role="menuitem" :disabled="ctx.splitOrientation() === 'none'" :aria-disabled="ctx.splitOrientation() === 'none'" @click="ctx.unsplit(); close()">取消拆分</button>
    <button role="menuitem" :disabled="ctx.splitOrientation() === 'none'" :aria-disabled="ctx.splitOrientation() === 'none'" @click="ctx.unsplitAll(); close()">取消所有拆分</button>
    <div class="menu-rule" role="separator" />
    <button role="menuitem" @click="ctx.togglePinTab(pane, path); close()">{{ ctx.pinned(path) ? '取消固定' : '固定标签页' }}</button>
    <button role="menuitem" :disabled="!ctx.isPreview(path)" :aria-disabled="!ctx.isPreview(path)" @click="ctx.keepTabOpen(path); close()">保持打开</button>
    <button role="menuitem" @click="close(); ctx.openTabSettings()">配置编辑器标签页…</button>
  </AnchoredMenu>
</template>
