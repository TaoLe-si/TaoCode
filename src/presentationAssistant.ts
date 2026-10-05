// 演示助手 —— 上游 `platform/platform-impl/src/com/intellij/platform/ide/impl/presentationAssistant/`
// 一族（`PresentationAssistant` + `ShortcutPresenter` + `ActionInfoPanel` + `MacKeyStrokePresentation`/
// `WinKeyStrokePresentation` + `TogglePresentationAssistantAction`）。
//
// 上游行为：开关打开后，每次用快捷键触发动作都会弹一块浮层，写着**动作名 + 键位**（`ShortcutPresenter.
// showActionInfo(ActionData(id, project, text))`），`PresentationAssistantState.showActionDescriptions`
// 默认 false、`popupDuration` 默认 4000ms、位置默认底部居中；`TogglePresentationAssistantAction`
// 可在「查找操作」里切换。
//
// 本仓的落法（如实降级）：浮层换成**状态栏中间那段文字**（`src/statusBarText.ts` 已经是
// `StatusBar.Info.set` 的通道，App.vue 已经绑定 `statusText`，不需要新开 UI 挂点），键位显示照
// `WinKeyStrokePresentation`/`MacKeyStrokePresentation`（Mac 用 `MacKeymapUtil` 的符号：
// ⌘ ⇧ ⌥ ⌃）。开关默认 off（同上游），在帮助菜单里切换并持久化到 localStorage。
//
// 没做的：真正的浮动面板（尺寸/对齐/主题/替代键位方案那套设置项）、`KeymapKind` 的替代键位显示。

import { setStatusText } from './statusBarText.ts'

/** 状态栏里这条文字的 requestor 名（`StatusBar.Info.set` 的 requestor 口径）。 */
export const PRESENTATION_ASSISTANT_REQUESTOR = 'presentation-assistant'
/** 上游 `PresentationAssistantState.showActionDescriptions` 的默认值（关）。 */
export const PRESENTATION_ASSISTANT_DEFAULT_ENABLED = false
/** 上游 `PresentationAssistantState.popupDuration` 的默认值。 */
export const PRESENTATION_ASSISTANT_DURATION_MS = 4000
const STORAGE_KEY = 'taocode.presentationAssistant'

export type PresentationPlatform = 'mac' | 'other'

export interface ShortcutPresentation {
  actionId: string
  /** 动作名（上游 `ActionData.text`）。 */
  title: string
  /** 键位显示（Win：`Ctrl+Shift+V`；Mac：`⌘⇧V`）。 */
  shortcut: string
}

/** Mac 键位符号（`MacKeymapUtil` 的常量：⌘ ⇧ ⌥ ⌃ ⌫）。 */
const MAC_SYMBOLS: Record<string, string> = { ctrl: '⌘', control: '⌘', meta: '⌘', cmd: '⌘', command: '⌘', shift: '⇧', alt: '⌥', option: '⌥' }
const MAC_KEY_NAMES: Record<string, string> = { backspace: '⌫', delete: '⌦', insert: '⌤', enter: '↩', escape: '⎋', tab: '⇥', space: '␣' }

/**
 * Windows/Linux 的键位显示（`WinKeyStrokePresentation`）：`Ctrl Shift V` → `Ctrl+Shift+V`。
 * 已经是 `+` 分隔的写法原样通过（键名统一大写，`F12`/`Insert` 这类保持原样）。
 */
export function windowsKeystroke(display: string): string {
  return display.trim().split(/[\s+]+/).filter(Boolean).map((part, index, parts) =>
    index === parts.length - 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
  ).join('+')
}

/** Mac 的键位显示（`MacKeyStrokePresentation` + `MacKeymapUtil`）：修饰键换成符号、不加 `+`。 */
export function macKeystroke(display: string): string {
  const parts = display.trim().split(/[\s+]+/).filter(Boolean)
  let out = ''
  parts.forEach((part, index) => {
    const lower = part.toLowerCase()
    if (index < parts.length - 1 && MAC_SYMBOLS[lower]) { out += MAC_SYMBOLS[lower]; return }
    out += MAC_KEY_NAMES[lower] ?? (index === parts.length - 1 ? part.toUpperCase() : MAC_SYMBOLS[lower] ?? part)
  })
  return out
}

export function keystrokePresentation(display: string, platform: PresentationPlatform): string {
  return platform === 'mac' ? macKeystroke(display) : windowsKeystroke(display)
}

/** 从运行环境判断平台（`navigator.platform` 在浏览器里总在；Node 下退回 other）。 */
export function detectPresentationPlatform(): PresentationPlatform {
  const platform = typeof navigator !== 'undefined' ? `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}` : ''
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? 'mac' : 'other'
}

/** 一条键位 → 一条浮层文字（上游 `ShortcutPresenter` 的渲染模型）。 */
export function presentationForAction(
  binding: { id: string; label: string; display: string }, platform: PresentationPlatform = detectPresentationPlatform(),
): ShortcutPresentation {
  return { actionId: binding.id, title: binding.label, shortcut: keystrokePresentation(binding.display, platform) }
}

/** 浮层文字：上游 `ActionInfoPanel` 是键位在上、动作名在下；状态栏一行里用两个空格分隔。 */
export function presentationText(presentation: ShortcutPresentation): string {
  return `${presentation.shortcut}  ${presentation.title}`
}

// ——— 开关（上游 `PresentationAssistantState` + `toggle/updatePresenter`）———

let enabled = PRESENTATION_ASSISTANT_DEFAULT_ENABLED
try {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) enabled = stored === 'true'
  }
} catch { /* 存储不可用（隐私模式/Node）：用默认值，不阻断 */ }

let clearTimer: ReturnType<typeof setTimeout> | null = null

function persist(): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false') } catch { /* 同上 */ }
}

export function presentationAssistantEnabled(): boolean { return enabled }

/** 上游 `TogglePresentationAssistantAction`：切开关；关掉时立即收起当前提示。 */
export function togglePresentationAssistant(): boolean {
  return setPresentationAssistantEnabled(!enabled)
}

export function setPresentationAssistantEnabled(next: boolean): boolean {
  enabled = next
  persist()
  if (!enabled) clearPresentation()
  return enabled
}

/** 收起提示（`StatusPanel` 的 requestor 规则保证只清我们自己那一条）。 */
export function clearPresentation(): void {
  if (clearTimer !== null) { clearTimeout(clearTimer); clearTimer = null }
  setStatusText(null, PRESENTATION_ASSISTANT_REQUESTOR)
}

/**
 * 显示一条快捷键提示（上游 `ShortcutPresenter.showActionInfo`）。开关关闭时什么都不做并返回 null。
 * `durationMs` 到点自动收起 —— 效果同上游浮层的 `popupDuration`。
 */
export function presentShortcut(
  binding: { id: string; label: string; display: string },
  options: { platform?: PresentationPlatform; durationMs?: number } = {},
): ShortcutPresentation | null {
  if (!enabled) return null
  if (!binding.display) return null
  const presentation = presentationForAction(binding, options.platform ?? detectPresentationPlatform())
  setStatusText(presentationText(presentation), PRESENTATION_ASSISTANT_REQUESTOR)
  if (clearTimer !== null) clearTimeout(clearTimer)
  clearTimer = setTimeout(() => { clearTimer = null; clearPresentation() }, options.durationMs ?? PRESENTATION_ASSISTANT_DURATION_MS)
  return presentation
}
