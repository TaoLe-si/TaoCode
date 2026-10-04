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
import { computed, ref } from 'vue'
import AnchoredMenu from './AnchoredMenu.vue'
import { COPY_REFERENCE_GROUP, FIND_COPY_ACTIONS, findResultClipboardText, type FindCopyActionId } from '../copyPathActions'

const props = defineProps<{ ctx: any; path: string; pane: number; x: number; y: number }>()
const emit = defineEmits<{ close: [] }>()

/** 复制那一组：上游是子菜单（`popup="true"`），本仓的浮层里就地展开（与 `EditorPopupMenu` 同一种交互）。 */
const copyOpen = ref(false)
const close = () => emit('close')
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
</script>

<template>
  <AnchoredMenu :x="x" :y="y" @pointerdown.stop>
    <!-- IDEA's EditorTabPopupMenu order: Close group | Copy Paths | split rows | Pin / Keep / Configure；
         书签那三条（ToggleBookmark / EditBookmark / AddAnotherBookmark 的相对顺序）来自挂在
         `EditorTabPopupMenu` 上的 `popup@ExpandableBookmarkContextMenu`
         （platform/bookmarks/resources/intellij.platform.bookmarks.xml:222-227）。 -->
    <button @click="ctx.bookmarkFile(path); close()">{{ ctx.fileBookmarkLabel(path) }}</button>
    <button v-if="ctx.fileBookmarkLabel(path) === '删除书签'" @click="ctx.editBookmarkAt(path); close()">编辑描述</button>
    <button v-if="ctx.fileBookmarkLabel(path) === '删除书签'" @click="ctx.addFileBookmarkToAnotherList(path); close()">添加另一书签…</button>
    <div class="menu-rule" />
    <button @click="ctx.closeTabIn(pane, path); close()">关闭</button>
    <button :disabled="!ctx.canCloseOthers(pane, path)" @click="ctx.closeOtherTabsIn(pane, path); close()">关闭其他标签页</button>
    <button :disabled="!ctx.canCloseRight(pane, path)" @click="ctx.closeTabsToRightIn(pane, path); close()">关闭右侧标签页</button>
    <button :disabled="!ctx.canCloseLeft(pane, path)" @click="ctx.closeTabsToLeftIn(pane, path); close()">关闭左侧标签页</button>
    <button :disabled="!ctx.canCloseUnpinned(pane, path)" @click="ctx.closeUnpinnedTabsIn(pane); close()">关闭所有未固定标签页</button>
    <button @click="ctx.closeAllTabsIn(pane); close()">全部关闭</button>
    <div class="menu-rule" />
    <button @click="ctx.copyPathOfTab(path); close()">复制路径</button>
    <!-- `CopyReferencePopupGroup`（上游 :1280 插在 CopyPaths 之后）。 -->
    <button class="has-sub" role="menuitem" :aria-expanded="copyOpen" @click="copyOpen = !copyOpen">{{ COPY_REFERENCE_GROUP }}</button>
    <template v-if="copyOpen">
      <button v-for="row in copyRows" :key="row.id" class="sub-item" role="menuitem" @click="pickCopy(row.id)">{{ row.title }}</button>
    </template>
    <button v-if="ctx.isDesktop" @click="ctx.toggleReadOnly(path); close()">切换只读属性</button>
    <!-- AssociateWithFileTypeAction + FilePropertiesGroup rows for this tab. -->
    <template v-if="ctx.hasWorkspace()">
      <button v-for="[choice, label] in ctx.languageChoices" :key="`filetype-${choice}`" @click="ctx.associateFileType(path, choice)">关联文件类型：{{ label }}</button>
      <button @click="ctx.associateFileType(path, 'auto')">恢复按扩展名识别</button>
    </template>
    <!-- FilePropertiesGroup > ChangeLineSeparators acts on the selected tab. -->
    <template v-if="ctx.isDesktop && ctx.hasTab(path)">
      <button @click="ctx.convertLineSeparators('crlf', path)">转换为 Windows (CRLF) 行尾</button>
      <button @click="ctx.convertLineSeparators('lf', path)">转换为 Unix and macOS (LF) 行尾</button>
    </template>
    <div class="menu-rule" />
    <!-- IDEA EditorTabPopupMenu (PlatformActions.xml:907-915) alternates
         Split Right / Split-and-Move Right / Split Down / Split-and-Move
         Down, then the opposite-group pair and the unsplit pair. -->
    <button @click="ctx.splitFromTabMenu(pane, path, 'horizontal')">向右拆分（Split Right）</button>
    <button @click="ctx.moveTabToSide(pane, path, 'horizontal')">拆分并移动到右侧（Split and Move Right）</button>
    <button @click="ctx.splitFromTabMenu(pane, path, 'vertical')">向下拆分（Split Down）</button>
    <button @click="ctx.moveTabToSide(pane, path, 'vertical')">拆分并移动到下方（Split and Move Down）</button>
    <button @click="ctx.moveTabToSide(pane, path, ctx.splitOrientation() === 'vertical' ? 'vertical' : 'horizontal')">移动到另一侧编辑器组</button>
    <button @click="ctx.openInOppositeGroup(path); close()">在另一侧编辑器组中打开</button>
    <button :disabled="ctx.splitOrientation() === 'none'" @click="ctx.changeSplitOrientation(); close()">更改拆分方向</button>
    <button :disabled="ctx.splitOrientation() === 'none'" @click="ctx.unsplit(); close()">取消拆分</button>
    <button :disabled="ctx.splitOrientation() === 'none'" @click="ctx.unsplitAll(); close()">取消所有拆分</button>
    <div class="menu-rule" />
    <button @click="ctx.togglePinTab(pane, path); close()">{{ ctx.pinned(path) ? '取消固定' : '固定标签页' }}</button>
    <button :disabled="!ctx.isPreview(path)" @click="ctx.keepTabOpen(path); close()">保持打开</button>
    <button @click="close(); ctx.openTabSettings()">配置编辑器标签页…</button>
  </AnchoredMenu>
</template>
