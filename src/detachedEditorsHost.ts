// 独立编辑器窗口的**宿主状态**（上游 `DockableEditorTabbedContainer` 的窗口表那一半）——
// 纯规则在 `src/editorWindows.ts`，这里只做「把规则的结果落到响应式状态 + 调那几个注入的回调」。
//
// 与 `src/shelfHost.ts` 同一拆分口径：规则可单测、宿主可装配。宿主是
// `src/explorerActions.ts`（它本来就持有 `groups` 与标签条的「更多」下拉，见那里 `createTabEntryPoint`），
// 渲染面（浮层组件 + App.vue 的挂载点）归 UI lane —— 见报告里的接线请求。
//
// 生命周期与上游一致：摘出 = 源标签从栏里去掉、进 `detached` 表；关掉浮层 = 按原栏/原下标放回
// （`FileEditorManagerKeys.CLOSING_TO_REOPEN` 的语义）。`ordinal` 递增让多个浮层错开摆放
// （上游新 frame 也是错开的）。
import { ref, type Ref } from 'vue'
import {
  canDetachEditor, clampDetachedGeometry, detachTab, detachedPathFromUrl, detachedWindowCapability,
  detachedWindowFeatures, detachedWindowUrl, reattachTab, type DetachedEditor, type DetachedWindowCapability,
} from './editorWindows.ts'

export interface DetachedEditorsDeps {
  /** 编辑器栏表（宿主自持；摘出/放回都改它）。 */
  groups: { 0: { tabs: Array<{ path: string }>; activePath: string }; 1: { tabs: Array<{ path: string }>; activePath: string } } | any
  /** 关掉浮层后要恢复的焦点栏（可选）。 */
  focusPane?: (pane: number) => void
  /** 当前页面 URL（浏览器档拼新窗口地址用；缺省取 `location.href`）。 */
  baseUrl?: () => string
  /** 桌面端判定（WebView2 宿主里 `window.open` 会被宿主取消，见 `editorWindows.ts` 文件头）。 */
  isDesktop: boolean
  /** 注入的 `window`（无 DOM 时 undefined）。 */
  win?: () => { open?: (url?: string, target?: string, features?: string) => unknown } | null
  /** 视口尺寸（浮层几何夹取用；无 DOM 时 undefined）。 */
  viewport?: () => { width: number; height: number } | null
  /** 一句提示（浮层开不了时如实说原因）。 */
  notify: (message: string, error?: boolean) => void
}

export interface DetachedEditors {
  /** 当前浮层里的编辑器（渲染面按它画）。 */
  detached: Ref<DetachedEditor[]>
  capability: () => DetachedWindowCapability
  /** 这一档现在能不能兑现（不能就不渲染那一行 —— 不放假控件）。 */
  available: () => boolean
  /** `EditSourceInNewWindowAction` 的等价物：把某个标签摘成浮层/独立窗口。 */
  detach: (pane: number, path: string) => boolean
  /** 关掉一个浮层：标签放回原栏原下标。 */
  close: (path: string) => boolean
  /** 浮层被拖动/缩放之后夹进视口。 */
  move: (path: string, geometry: { x: number; y: number; width: number; height: number }) => void
  /** 当前页面是不是"独立窗口"（新窗口启动时判一次，决定只渲染那一个编辑器）。 */
  detachedPathFromLocation: (search: string) => string | null
}

export function createDetachedEditors(deps: DetachedEditorsDeps): DetachedEditors {
  const detached = ref<DetachedEditor[]>([])
  let ordinal = 0

  const capability = (): DetachedWindowCapability => detachedWindowCapability({
    doc: typeof document === 'undefined' ? null : document,
    isDesktop: deps.isDesktop,
    win: deps.win?.() ?? (typeof window === 'undefined' ? null : window),
  })

  const available = () => canDetachEditor(capability())

  /** 栏表里某一栏的标签路径（`groups` 是宿主的响应式对象，读当前值）。 */
  const panePaths = (): string[][] => [0, 1].map(pane => (deps.groups?.[pane]?.tabs ?? []).map((tab: { path: string }) => tab.path))

  function detach(pane: number, path: string): boolean {
    if (!path) { deps.notify('没有要摘出的文件。', true); return false }
    if (detached.value.some(item => item.path === path)) return false   // 已经在浮层里：no-op（上游复用已开的窗口）
    const plan = detachTab(panePaths(), path, pane, deps.viewport?.() ?? null, ordinal)
    if (plan.reason || !plan.detached) { deps.notify(plan.reason ?? '摘不出这个标签。', true); return false }
    // 浏览器档优先开真窗口（同源 + `?detached=`，localStorage 天然共享）；开不出来再退浮层。
    if (capability().browserWindowSupported && !capability().overlayHostPresent) {
      const opened = deps.win?.()?.open?.(
        detachedWindowUrl(deps.baseUrl?.() ?? (typeof location === 'undefined' ? '' : location.href), path),
        '_blank', detachedWindowFeatures(plan.detached))
      if (!opened) { deps.notify('浏览器拦下了新窗口，已改为在窗口内浮出编辑器。', true) }
    }
    // 源标签从栏里去掉（上游 `CLOSING_TO_REOPEN` 后 `openFileInNewWindow` 的可见结果）。
    const source = deps.groups?.[plan.detached.pane]
    if (source) {
      const index = source.tabs.findIndex((tab: { path: string }) => tab.path === path)
      if (index >= 0) source.tabs.splice(index, 1)
      source.activePath = source.tabs[Math.min(index, source.tabs.length - 1)]?.path ?? ''
    }
    ordinal += 1
    detached.value = [...detached.value, plan.detached]
    return true
  }

  function close(path: string): boolean {
    const index = detached.value.findIndex(item => item.path === path)
    if (index < 0) return false
    const item = detached.value[index]!
    const restored = reattachTab(panePaths(), item)
    const target = deps.groups?.[item.pane]
    if (target) {
      // 用 `reattachTab` 算出来的那一栏覆盖回去（它处理了"原位下标夹取"）。
      const wanted = restored[item.pane] ?? []
      target.tabs = wanted.map((candidate: string) => target.tabs.find((tab: { path: string }) => tab.path === candidate) ?? { path: candidate })
      target.activePath = path
    }
    detached.value = detached.value.filter(item => item.path !== path)
    deps.focusPane?.(item.pane)
    return true
  }

  function move(path: string, geometry: { x: number; y: number; width: number; height: number }): void {
    const clamped = clampDetachedGeometry(geometry, deps.viewport?.() ?? null)
    detached.value = detached.value.map(item => item.path === path ? { ...item, ...clamped } : item)
  }

  return {
    detached, capability, available, detach, close, move,
    detachedPathFromLocation: (search: string) => detachedPathFromUrl(search),
  }
}