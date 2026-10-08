// 分栏与面板尺寸 —— 从 App.vue 搬出的一域（203 行，17 个依赖）。
//
// 判据：这一块是"编辑区与工具窗口各占多大"的唯一出处 ——
//   · 面板尺寸：`panelMax` / `setPanelSize`（IDEA `WindowAction.getPreferredDelta` 与
//     `ide.windowSystem.hScrollChars`/`vScrollChars`，见 src/toolWindowResize.ts）；
//   · 记住每个工具窗口各自的尺寸（IDEA "Remember size for each tool window"，按
//     `<window>:side|bottom` 存 localStorage）；
//   · 分隔条拖拽：`startResize`（面板）/ `startSplitResize`（分栏）两条指针拖拽 +
//     方向键微调（`resizeKey` / `resizeSplitKey`）；
//   · 窗口尺寸变化时重算全部面板（`onWindowResize`）与分栏方向切换（`changeSplitOrientation`）。
// 它们共享同一个 `viewport` 与同一套 clamp，拆开会让每一份都要重新注入对方的尺寸状态。
// 工具窗口的**停靠/隐藏/最大化**在 src/toolWindowActions.ts；这里只管尺寸。
import { reactive, watch } from 'vue'
import { clampPanelSize } from './appearance.ts'
import { RESIZE_CHARS, resizeDirectionEnabled, stretchDelta, type ResizeDirection } from './toolWindowResize.ts'
// 分栏比例的「0 = 没存过」哨兵（上游 `ToolWindowPaneState.getPreferredSplitProportion` 的等价物）。
import { splitSizeOrDefault } from './toolWindowPaneState.ts'

/** 面板尺寸表的键（与 `panelSizes` 同域）。 */
export type Panel = 'explorer' | 'rightDock' | 'trace' | 'output'

export interface PanelResizeDeps {
  editorSettings: any
  panelSizes: Record<Panel, number>
  activity: any
  explorer: any
  leftView: any
  toolAnchors: Record<string, string>
  activeAnchor: { readonly value: string }
  bottom: any
  bottomTab: any
  workspace: any
  zenMode: any
  /** 右 dock 的可见性（左右独立后，两侧宽度互占要算上它）。 */
  rightVisible?: { readonly value: boolean }
  /** 焦点落在哪一侧的侧栏 dock（`dockOf` 只到 'side' 这一层，左右分栏后要再分一层；
   *  缺省时退回 `activeAnchor` —— 与右 dock 独立之前的行为一致）。 */
  focusedSideDock?: () => 'left' | 'right' | null
  /** 正在拖拽（模板据此禁用过渡动画）。 */
  resizing: any
  splitModel: any
  splitSize: any
  splitOrientation: { readonly value: string }
  activeToolWindowDock: () => 'left' | 'right' | 'bottom' | 'side' | null
}

export function createPanelResize(deps: PanelResizeDeps) {
  const { editorSettings, panelSizes, activity, explorer, leftView, toolAnchors, activeAnchor, bottom, bottomTab, workspace,
          zenMode, resizing, splitModel, splitSize, splitOrientation, activeToolWindowDock } = deps
  /** 拖拽收尾函数（指针抬起/取消时调用）；同时只可能有一个拖拽在跑。 */
  let resizeCleanup: (() => void) | undefined
  /** 拖拽结束时由生命周期钩子调用，保证组件卸载不会留下监听器。 */
  function cancelResize() { resizeCleanup?.() }
const viewport = reactive({ width: window.innerWidth, height: window.innerHeight })
type Panel = keyof typeof panelSizes
function editorStageSize(axis: 'x' | 'y') {
  const stage = document.querySelector<HTMLElement>('.editor-groups')
  if (!stage) return axis === 'x' ? viewport.width : viewport.height
  const rect = stage.getBoundingClientRect()
  return axis === 'x' ? rect.width : rect.height
}
// The split divider sizes the secondary pane (0 = 50/50 until first dragged).
function setSplitSize(value: number) {
  const max = Math.max(200, editorStageSize(splitOrientation.value === 'vertical' ? 'y' : 'x') - 200)
  splitSize.value = clampPanelSize(value, 160, max)
}
function panelMax(panel: Panel) {
  // IDEA "Widescreen tool window layout": maximizes the height of the vertical tool
  // windows by limiting how tall the bottom (horizontal) one may grow — 40% of the
  // window instead of everything but 300px.
  if (panel === 'output') {
    const limit = editorSettings.value.wideScreenSupport
      ? Math.round(viewport.height * 0.4)
      : viewport.height - 300
    return Math.max(120, limit)
  }
  // 另一侧的占位：拖左 dock 时右 dock 也占宽，反之亦然（两侧现在各自独立）。
  const other = panel === 'explorer'
    ? (activity.value && viewport.width >= 1000 ? panelSizes.trace : 0) + (deps.rightVisible?.value ? panelSizes.rightDock : 0)
    : panel === 'rightDock' ? (explorer.value ? panelSizes.explorer : 0) : (explorer.value ? panelSizes.explorer : 0)
  return Math.min(520, viewport.width - other - 340)
}
function setPanelSize(panel: Panel, value: number) {
  const size = clampPanelSize(value, panel === 'output' ? 100 : 180, panelMax(panel))
  panelSizes[panel] = size
  // IDEA "Remember size for each tool window": with it on, dragging the dock edge
  // resizes the tool window you are looking at, not the shared stripe.
  if (editorSettings.value.rememberSizeForEachToolWindow && panel !== 'trace' && panel !== 'rightDock') {
    const key = panel === 'output' ? `${bottomTab.value}:bottom` : `${leftView.value}:side`
    toolSizes[key] = size
    saveToolSizes()
  }
}
// Per-tool-window sizes, keyed "<window>:side" / "<window>:bottom".
const toolSizes = reactive<Record<string, number>>({})
try {
  const saved = JSON.parse(localStorage.getItem('taocode.toolSizes') ?? '{}') as Record<string, number>
  for (const [key, value] of Object.entries(saved)) if (typeof value === 'number' && value >= 100 && value <= 900) toolSizes[key] = Math.round(value)
} catch { /* corrupted state: fall back to the shared size */ }
function saveToolSizes() {
  try { localStorage.setItem('taocode.toolSizes', JSON.stringify(toolSizes)) } catch { /* storage unavailable: session-only */ }
}
// Apply the remembered size whenever the shown tool window (or its anchor) changes.
watch([leftView, () => toolAnchors[leftView.value]], ([view, anchor]) => {
  if (!editorSettings.value.rememberSizeForEachToolWindow || anchor === 'bottom') return
  const stored = toolSizes[`${view}:side`]
  if (typeof stored === 'number') panelSizes.explorer = clampPanelSize(stored, 180, panelMax('explorer'))
})
watch(bottomTab, view => {
  if (!editorSettings.value.rememberSizeForEachToolWindow) return
  const stored = toolSizes[`${view}:bottom`]
  if (typeof stored === 'number') panelSizes.output = clampPanelSize(stored, 100, panelMax('output'))
})
function resizeKey(event: KeyboardEvent, panel: Panel, side?: 'left' | 'right') {
  // A modified arrow belongs to the window-level shortcuts (Ctrl+Alt+Shift+arrows resize the active
  // tool window); without this the separator would also move while the chord fired.
  if (event.altKey || event.ctrlKey || event.metaKey) return
  // 方向同 startResize：由分隔条自己声明哪一侧（右 dock 独立后 activeAnchor 不再可靠）。
  const right = panel === 'trace' || (panel === 'explorer' && (side ? side === 'right' : activeAnchor.value === 'right'))
  const previous = panel === 'output' ? 'ArrowDown' : right ? 'ArrowRight' : 'ArrowLeft'
  const next = panel === 'output' ? 'ArrowUp' : right ? 'ArrowLeft' : 'ArrowRight'
  if (event.key !== previous && event.key !== next) return
  event.preventDefault()
  setPanelSize(panel, panelSizes[panel] + (event.key === next ? 16 : -16))
}
/**
 * `ResizeToolWindowAction.update` (`:93-118`): the action acts on the active tool window
 * (`getToolWindow` `:83-87` = the window the action was invoked on, else the last active one), and
 * it hides itself the moment an *editor* holds the focus (`:52-56` `isActiveEditorPresented`), or
 * the window is unavailable / invisible (`:67-80`). `focusedDock()` answers both: a dock only
 * answers when it is the one with focus, and the editor answers when neither is.
 */
function resizeTarget(): { panel: Panel; anchor: 'left' | 'right' | 'bottom' } | null {
  if (!workspace.value || zenMode.value) return null
  const dock = activeToolWindowDock()
  if (!dock) return null
  if (dock === 'bottom') return bottom.value ? { panel: 'output', anchor: 'bottom' } : null
  // 左右两条 dock 各有自己的一格宽度（panelSizes.explorer / rightDock）：焦点在哪一侧就调哪一侧。
  // `activeAnchor` 只回答「左栏 leftView 的锚点」，右 dock 开着时它仍是 'left' ⇒ 不再当判据，
  // 只在宿主没给 focusedSideDock 时兜底。
  const side = deps.focusedSideDock ? deps.focusedSideDock() : (activeAnchor.value === 'right' ? 'right' : 'left')
  if (side === 'right') return deps.rightVisible?.value ? { panel: 'rightDock', anchor: 'right' } : null
  return explorer.value ? { panel: 'explorer', anchor: 'left' } : null
}
/** The active tool window when `direction` is one of the two the anchor enables, else nothing. */
function resizeTargetFor(direction: ResizeDirection): { panel: Panel; anchor: 'left' | 'right' | 'bottom' } | null {
  const target = resizeTarget()
  return target && resizeDirectionEnabled(target.anchor, direction) ? target : null
}
/**
 * `WindowAction.getPreferredDelta()` (`:113-118`) is the preferred size of a `JLabel("W")` — the UI
 * font's own metrics — multiplied by the registry's `ide.windowSystem.hScrollChars` /
 * `vScrollChars` (`:96-98`; both 5, `registry.properties:205-208`). So the step is measured from the
 * font the chrome actually renders with instead of being a hard-coded pixel count, and it follows
 * the 界面字体 setting for free.
 */
let resizeProbe: HTMLSpanElement | null = null
function resizeStep(horizontal: boolean): number {
  if (!resizeProbe || !resizeProbe.isConnected) {
    resizeProbe = document.createElement('span')
    resizeProbe.textContent = 'W'
    resizeProbe.setAttribute('aria-hidden', 'true')
    resizeProbe.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;white-space:pre'
    document.body.appendChild(resizeProbe)
  }
  const font = getComputedStyle(document.body)
  resizeProbe.style.fontFamily = font.fontFamily
  resizeProbe.style.fontSize = font.fontSize
  resizeProbe.style.fontWeight = font.fontWeight
  resizeProbe.style.lineHeight = font.lineHeight
  const box = resizeProbe.getBoundingClientRect()
  return Math.max(1, Math.round((horizontal ? box.width : box.height) * RESIZE_CHARS))
}
/** `ResizeToolWindowAction.actionPerformed` -> `stretch` (`:107-121`), through the shared clamp. */
function stretchToolWindow(direction: ResizeDirection) {
  const target = resizeTargetFor(direction)
  if (!target) return
  const horizontal = direction === 'left' || direction === 'right'
  setPanelSize(target.panel, panelSizes[target.panel] + stretchDelta(target.anchor, direction, resizeStep(horizontal)))
}
function resizeSplitKey(event: KeyboardEvent) {
  // Same guard as `resizeKey`: a chord-carrying arrow is the window-level shortcut's, not the
  // separator's.
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const vertical = splitOrientation.value === 'vertical'
  const shrink = vertical ? 'ArrowDown' : 'ArrowRight'
  const grow = vertical ? 'ArrowUp' : 'ArrowLeft'
  if (event.key !== shrink && event.key !== grow) return
  event.preventDefault()
  // 「0 = 没存过」的哨兵与上游同一语义（见 toolWindowPaneState.ts 的文件头）。
  const halfSize = Math.round(editorStageSize(vertical ? 'y' : 'x') / 2)
  splitSize.value = splitSizeOrDefault(splitSize.value, halfSize)
  setSplitSize(splitSize.value + (event.key === grow ? 16 : -16))
}
function startSplitResize(event: PointerEvent) {
  if (event.button !== 0) return
  resizeCleanup?.()
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  const vertical = splitOrientation.value === 'vertical'
  const halfSize = Math.round(editorStageSize(vertical ? 'y' : 'x') / 2)
  splitSize.value = splitSizeOrDefault(splitSize.value, halfSize)
  const origin = vertical ? event.clientY : event.clientX
  const size = splitSize.value
  const move = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return
    // The secondary pane is right (horizontal) or below (vertical); the divider moving away from
    // it grows the pane, which is `origin - position` on both axes.
    const position = vertical ? next.clientY : next.clientX
    setSplitSize(size + origin - position)
  }
  const stop = () => {
    target.removeEventListener('pointermove', move)
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) target.removeEventListener(type, stop as EventListener)
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
    resizing.value = false
    resizeCleanup = undefined
  }
  target.focus()
  target.setPointerCapture(event.pointerId)
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', stop)
  target.addEventListener('pointercancel', stop)
  target.addEventListener('lostpointercapture', stop)
  resizing.value = true
  resizeCleanup = stop
}
/**
 * `side` 由**分隔条自己**声明它是哪一侧的（左/右 dock 现在各自独立，`activeAnchor` 只回答
 * "当前激活视图的锚点"，右 dock 开着时它仍可能是 `'left'` ⇒ 方向会反）。
 * 不给时退回旧的 `activeAnchor` 判断（键盘那条路仍走它）。
 */
function startResize(event: PointerEvent, panel: Panel, side?: 'left' | 'right') {
  if (event.button !== 0) return
  resizeCleanup?.()
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  const origin = panel === 'output' ? event.clientY : event.clientX
  const size = panelSizes[panel]
  // 左 dock：向右拖变宽（+1）；右 dock / 活动条 / 底部：方向相反（-1）。
  const sign = panel === 'output' ? -1 : (side ? (side === 'left' ? 1 : -1) : (activeAnchor.value !== 'right' ? 1 : -1))
  const move = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return
    const position = panel === 'output' ? next.clientY : next.clientX
    setPanelSize(panel, size + (position - origin) * sign)
  }
  const stop = () => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', stop)
    target.removeEventListener('pointercancel', stop)
    target.removeEventListener('lostpointercapture', stop)
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
    resizing.value = false
    resizeCleanup = undefined
  }
  target.focus()
  target.setPointerCapture(event.pointerId)
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', stop)
  target.addEventListener('pointercancel', stop)
  target.addEventListener('lostpointercapture', stop)
  resizing.value = true
  resizeCleanup = stop
}
function onWindowResize() {
  viewport.width = window.innerWidth
  viewport.height = window.innerHeight
  for (const panel of ['explorer', 'rightDock', 'trace', 'output'] as const) setPanelSize(panel, panelSizes[panel])
  if (splitSize.value) setSplitSize(splitSize.value)
}
// IDEA's editor-layout menu: Unsplit / Unsplit All / Split Right / Split Down act on
// the selected tab; Move/Clone to Opposite Group shuffle tabs between panes.
// SplitterAction.ChangeOrientation: rotate the divider between left/right and
// up/down without touching either group's tabs.
function changeSplitOrientation() {
  if (splitModel.orientation === 'none') return
  splitModel.orientation = splitModel.orientation === 'horizontal' ? 'vertical' : 'horizontal'
  splitSize.value = 0
}
  return {
    viewport, editorStageSize, setSplitSize, panelMax, setPanelSize, toolSizes, saveToolSizes, resizeKey,
    resizeTarget, resizeTargetFor, resizeStep, stretchToolWindow, resizeSplitKey, startSplitResize, startResize,
    onWindowResize, changeSplitOrientation, cancelResize,
  }
}
