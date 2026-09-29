// 工具窗口的命名布局 —— 从 App.vue 搬出的一域（103 行，13 个依赖）。
//
// 判据：IDEA 的 `ToolWindowDefaultLayoutManager` 管着「命名快照 + 当前生效的名字」，对应
// `WindowMenu › LayoutsGroup` 那一组动作（PlatformActions.xml:641-651）：
//   默认布局 / <每个命名布局> / 恢复当前布局(Shift+F12) / 将更改保存到当前布局 / 另存为新布局…
//   / 重命名… / 删除当前布局。
// 本模块负责**读写活状态**：把当前停靠/顺序/尺寸拍成快照（`captureToolLayout`），把一份快照写回去
// （`applyToolLayout`，尺寸走 `setPanelSize` 所以和拖拽一样被 clamp，顺序走 `saveToolOrder` 所以会落盘）。
// 纯记账（增删改名、名字校验、工厂布局解析）在 src/toolLayout.ts，本模块只做胶水。
// `isLeftToolWindowId` 留在宿主：它是 `id is LeftViewId` 类型守卫，和宿主的 toolAnchors 类型同源。
import { nextTick, ref } from 'vue'
// 顺序表与底部标签表的**唯一来源**（原先在四个文件里各抄了一份、内容还不一致）。
import { BOTTOM_TABS, DEFAULT_TOOL_ANCHORS, DEFAULT_TOOL_ORDER, type BottomTabId } from './toolWindowMeta.ts'
import { FACTORY_LAYOUT_NAME, deleteLayout, emptyLayoutStore, normalizeLayoutStore, normalizeToolLayout, renameLayout, resolveLayout,
         saveLayout, setActiveLayout, type ToolLayout, type ToolLayoutStore, type ToolWindowSide } from './toolLayout'
/** 宿主侧的两个视图 id 联合类型（`typeof leftView.value` / `typeof bottomTab.value`）；
 *  本模块只把它们当字符串用，所以在这里退化成 `string`。 */
type LeftViewId = string
// 底部标签的类型也来自唯一来源（`src/toolWindowMeta.ts`），不再退化成 `string`。

export interface ToolLayoutsDeps {
  notify: (message: string, error?: boolean) => void
  menu: any
  nameDialog: any
  nameInput: any
  explorer: any
  bottom: any
  leftView: any
  bottomTab: any
  panelSizes: Record<string, number>
  /** 每个工具窗口的停靠侧。 */
  toolAnchors: Record<string, string>
  /** 每条磁贴的顺序（`Record<Anchor, ToolWindowId[]>`）。 */
  toolOrder: any
  /** 锚点变更后落盘，不触发移动时的面板显隐副作用。 */
  saveToolAnchors: () => void
  /** 顺序变更后落盘（宿主自有）。 */
  saveToolOrder: () => void
  /** 恢复尺寸走这条通道，所以和用户拖拽一样被 clamp。 */
  setPanelSize: (panel: any, value: number) => void
  /** 宿主提供的类型守卫：`id in toolAnchors`。 */
  isLeftToolWindowId: (id: string) => boolean
}

export function createToolLayouts(deps: ToolLayoutsDeps) {
  const { notify, menu, nameDialog, nameInput, explorer, bottom, leftView, bottomTab, panelSizes, toolAnchors,
          toolOrder, saveToolAnchors, saveToolOrder, setPanelSize, isLeftToolWindowId } = deps
const LAYOUT_STORAGE_KEY = 'taocode.toolWindowLayouts'
// 这两张表**不再在这里定义**：顺序表与底部标签表的唯一来源是 `src/toolWindowMeta.ts`
// （原先四处各抄一份且内容不一致，改一处漏三处 —— 见那边的注释）。
/**
 * `getFactoryDefaultLayoutCopy()` (`ToolWindowDefaultLayoutManager.kt:64`): the layout that always
 * answers to the empty name. The dock is visible in it (IDEA's factory default shows the project
 * tool window) even though a *fresh* session may start with it collapsed on a narrow window.
 */
function factoryToolLayout(): ToolLayout {
  return {
    explorer: true,
    bottom: false,
    view: 'files',
    tab: 'output',
    anchors: { ...DEFAULT_TOOL_ANCHORS },
    order: { left: [...DEFAULT_TOOL_ORDER.left], right: [...DEFAULT_TOOL_ORDER.right], bottom: [...DEFAULT_TOOL_ORDER.bottom] },
    sizes: { explorer: 240, trace: 300, output: 180 },
  }
}
const toolLayoutStore = ref<ToolLayoutStore>(loadToolLayoutStore())
function loadToolLayoutStore(): ToolLayoutStore {
  try { return normalizeLayoutStore(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? 'null')) }
  catch { return emptyLayoutStore() }
}
function persistToolLayouts() {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(toolLayoutStore.value)) } catch { /* storage unavailable: session-only */ }
}
function captureToolLayout(): ToolLayout {
  const anchors: Record<string, ToolWindowSide> = {}
  for (const id of Object.keys(toolAnchors) as LeftViewId[]) {
    const side = toolAnchors[id]
    if (side === 'left' || side === 'right' || side === 'bottom') anchors[id] = side
  }
  return {
    explorer: explorer.value,
    bottom: bottom.value,
    view: leftView.value,
    tab: bottomTab.value,
    anchors,
    order: { left: [...toolOrder.value.left], right: [...toolOrder.value.right], bottom: [...toolOrder.value.bottom] },
    sizes: { ...panelSizes },
  }
}
/** `ToolWindowManagerEx.setLayout` — write a snapshot back, ignoring ids that no longer exist. */
function applyToolLayout(layout: ToolLayout) {
  layout = normalizeToolLayout(layout, factoryToolLayout())
  explorer.value = layout.explorer
  bottom.value = layout.bottom
  if (isLeftToolWindowId(layout.view)) leftView.value = layout.view
  for (const id of Object.keys(toolAnchors) as LeftViewId[]) {
    const side = layout.anchors[id]
    if (side === 'left' || side === 'right' || side === 'bottom') toolAnchors[id] = side
  }
  if (BOTTOM_TABS.includes(layout.tab as BottomTabId) ||
      (isLeftToolWindowId(layout.tab) && toolAnchors[layout.tab] === 'bottom')) bottomTab.value = layout.tab
  for (const side of ['left', 'right', 'bottom'] as const) {
    const list = [...new Set(layout.order[side] ?? [])].filter(id => isLeftToolWindowId(id) && toolAnchors[id] === side)
    // 新增窗口以及旧快照漏掉的窗口，都补到它自己的停靠边，保证入口仍可到达。
    const rest = (Object.keys(toolAnchors) as LeftViewId[]).filter(id => toolAnchors[id] === side && !list.includes(id))
    toolOrder.value[side] = [...list, ...rest]
  }
  saveToolAnchors()
  saveToolOrder()
  for (const panel of ['explorer', 'trace', 'output'] as const) {
    const size = layout.sizes[panel]
    if (typeof size === 'number' && size > 0) setPanelSize(panel, size)
  }
}
/** `activeLayoutName = name` + `setLayout(getLayoutCopy())` (`CustomLayoutsActionGroup` Apply). */
function applyNamedToolLayout(name: string) {
  toolLayoutStore.value = setActiveLayout(toolLayoutStore.value, name)
  persistToolLayouts()
  applyToolLayout(resolveLayout(toolLayoutStore.value, factoryToolLayout()))
}
/** `RestoreFactoryDefaultLayoutAction.kt:29-35` — also the 「默认布局」 row's toggle. */
function useFactoryToolLayout() { applyNamedToolLayout(FACTORY_LAYOUT_NAME) }
/** `RestoreDefaultLayoutAction.java:41-47`, bound to Shift+F12 (`$default.xml:864-866`). */
function restoreCurrentToolLayout() {
  applyToolLayout(resolveLayout(toolLayoutStore.value, factoryToolLayout()))
}
/** `StoreNamedLayoutAction.kt:22-25` ("Save Changes in Current Layout"). */
function storeCurrentToolLayout() {
  const name = toolLayoutStore.value.active
  toolLayoutStore.value = saveLayout(toolLayoutStore.value, name, captureToolLayout())
  persistToolLayouts()
  notify(`布局「${name}」已保存。`)
}
function openLayoutNameDialog(mode: 'newLayout' | 'renameLayout') {
  menu.value = null
  nameDialog.value = { mode, dir: '', value: mode === 'renameLayout' ? toolLayoutStore.value.active : '' }
  void nextTick(() => { nameInput.value?.focus(); if (mode === 'renameLayout') nameInput.value?.select() })
}
/** `DeleteNamedLayoutAction` — the active layout cannot be deleted, so the row is hidden for it. */
function deleteCurrentToolLayout() {
  const name = toolLayoutStore.value.active
  const next = deleteLayout(toolLayoutStore.value, name)
  if (next === toolLayoutStore.value) return
  toolLayoutStore.value = next
  persistToolLayouts()
  // 删掉布局后当前布局**立刻**切换，用户看得见 —— 按「只有无法直接感知的操作才提示」
  // 这里不该再弹一句"已删除"。
}
  return {
    LAYOUT_STORAGE_KEY, DEFAULT_TOOL_ORDER, BOTTOM_TABS, factoryToolLayout, toolLayoutStore, loadToolLayoutStore,
    persistToolLayouts, captureToolLayout, applyToolLayout, applyNamedToolLayout, useFactoryToolLayout,
    restoreCurrentToolLayout, storeCurrentToolLayout, openLayoutNameDialog, deleteCurrentToolLayout,
  }
}
