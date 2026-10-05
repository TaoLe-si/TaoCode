// 标签页的拖放 —— 从 App.vue 搬出的一域（95 行，3 个依赖）。
//
// 判据：IDEA 把标签拖放分成两件事，但它们是同一次拖拽的**两条下落路径**，共享同一个"正在拖什么"
// 状态（`dragTab`），所以合成一域：
//   · 落在**标签条**上 → 在组内重排 / 换组（IDEA `TabsUtil.reorder`、`dropTabOnGroup`）；
//   · 落在**编辑区**边缘 → 按落点的梯形区域分屏（`TabsUtil.java:54-111`，落点判定在
//     src/tabDragSplit.ts，本模块只负责给预览和落盘）。
// `onStageDragLeave` 的存在是因为子元素会冒泡 dragleave，否则预览会闪。
// 标签条的**单行布局**（谁被挤到"…"里）是另一个域：src/tabStripLayout.ts + App.vue 里的测量循环。
import { ref } from 'vue'
import { acceptDrop, beginDrag, dropActionForEvent } from './dndModel.ts'
import { dropTabOnGroup, swapGroups, type Pane, type SplitModel } from './editorGroups.ts'
import { dropSideFor, dropSidePutsNewGroupFirst, splitOrientationForSide, updateBoundsWithDropSide, type DropSide } from './tabDragSplit.ts'
import type { EditorSettings } from './bridge'
import type { Tab } from './editorTab'

export interface TabDragDropDeps {
  editorSettings: { readonly value: EditorSettings }
  /** 两个分栏组（宿主自持的编辑器模型）。 */
  groups: any
  splitModel: SplitModel<any>
  /** 由分栏动作提供 —— 必须惰性调用。 */
  splitTabOut: (tab: Tab, orientation: 'horizontal' | 'vertical') => void
}

export function createTabDragDrop(deps: TabDragDropDeps) {
  const { editorSettings, groups, splitModel, splitTabOut } = deps
// IDEA's tab drag & drop: the strip itself is the drop target (reorder before the
// tab under the pointer); dropping on the other group's strip moves the tab there.
const dragTab = ref<{ pane: Pane; path: string } | null>(null)
function onTabDragStart(pane: Pane, tab: Tab, event: DragEvent) {
  // IDEA "Drag-and-drop with Alt pressed only": without Alt the drag never starts,
  // so a slip of the mouse cannot reorder tabs.
  if (editorSettings.value.dndWithPressedAltOnly && !event.altKey) {
    event.preventDefault()
    return
  }
  dragTab.value = { pane, path: tab.path }
  // 统一 DnD 模型（`src/dndModel.ts`）：标签拖拽只允许 MOVE（上游 `TabsUtil.reorder`），
  // 载荷是路径文本 —— 写 effectAllowed 与 setData 的规则都在模型里，不再各处手写。
  beginDrag(event, { text: tab.path, action: 'move' })
}
function onTabDragOver(pane: Pane, event: DragEvent) {
  if (!dragTab.value) return
  acceptDrop(event, dropActionForEvent(event) ?? 'move')
}
// IDEA's drag-to-split (TabsUtil.java:54-111): a tab dropped on the editor *area* near an
// edge splits it, and the side is decided by which trapezoid the pointer sits in. The
// preview is the half of the area the dropped file will take.
const tabDropSide = ref<{ pane: Pane; side: DropSide; bounds: { x: number; y: number; width: number; height: number } } | null>(null)
function onStageDragOver(pane: Pane, event: DragEvent) {
  if (!dragTab.value) return
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  acceptDrop(event, dropActionForEvent(event) ?? 'move')
  const box = target.getBoundingClientRect()
  const bounds = { x: 0, y: 0, width: box.width, height: box.height }
  const side = dropSideFor({ x: event.clientX - box.left, y: event.clientY - box.top }, bounds)
  if (!side) { tabDropSide.value = null; return }
  tabDropSide.value = { pane, side, bounds: updateBoundsWithDropSide(bounds, side) }
}
function onStageDragLeave(event: DragEvent) {
  // Only when the pointer really left the stage: dragging over a child fires dragleave on
  // the parent as well, which would flicker the preview away.
  const target = event.currentTarget as HTMLElement | null
  const next = event.relatedTarget as Node | null
  if (target && next && target.contains(next)) return
  tabDropSide.value = null
}
function onStageDrop(pane: Pane, event: DragEvent) {
  const dragged = dragTab.value
  const preview = tabDropSide.value
  dragTab.value = null
  tabDropSide.value = null
  if (!dragged) return
  event.preventDefault()
  const tab = groups[dragged.pane].tabs.find((item: any) => item.path === dragged.path)
  if (!tab) return
  const side: DropSide = preview && preview.pane === pane ? preview.side : 'CENTER'
  const orientation = splitOrientationForSide(side)
  if (!orientation) {
    // The centre is a plain move into this group, which is what the strip drop does too.
    if (dragged.pane === pane) return
    dropTabOnGroup(splitModel, (item: Tab) => item.path, dragged.pane, tab, pane)
    return
  }
  // splitTabOutIn acts on the focused group, so point it at the group the tab came from.
  splitModel.focused = dragged.pane
  splitTabOut(tab, orientation)
  // IDEA puts the dragged file in the new group; LEFT / TOP ask for that group to come
  // first, which the fixed pane order cannot express, so the two groups are exchanged.
  const landedInFirst = groups[0].tabs.some((item: any) => item.path === tab.path)
  if (dropSidePutsNewGroupFirst(side)) {
    if (!landedInFirst) swapGroups(splitModel)
  } else if (landedInFirst) {
    swapGroups(splitModel)
  }
  splitModel.focused = groups[0].tabs.some((item: any) => item.path === tab.path) ? 0 : 1
}
function endTabDrag() { dragTab.value = null; tabDropSide.value = null }
function onTabDrop(pane: Pane, path: string, event: DragEvent) {
  const dragged = dragTab.value
  dragTab.value = null
  if (!dragged) return
  event.preventDefault()
  const tab = groups[dragged.pane].tabs.find((item: any) => item.path === dragged.path)
  if (!tab) return
  if (dragged.pane === pane && dragged.path === path) return
  dropTabOnGroup(splitModel, (tab: Tab) => tab.path, dragged.pane, tab, pane, path)
}
// Dropping on the strip's empty tail (or the pane body) appends at the group's end.
function onTabStripDrop(pane: Pane, event: DragEvent) {
  if (event.defaultPrevented) return  // a tab row already handled this drop
  const dragged = dragTab.value
  dragTab.value = null
  if (!dragged) return
  event.preventDefault()
  const tab = groups[dragged.pane].tabs.find((item: any) => item.path === dragged.path)
  if (!tab) return
  dropTabOnGroup(splitModel, (tab: Tab) => tab.path, dragged.pane, tab, pane)
}
  return {
    dragTab, tabDropSide, onTabDragStart, onTabDragOver, onStageDragOver, onStageDragLeave, onStageDrop,
    endTabDrag, onTabDrop, onTabStripDrop,
  }
}
