// 主工具栏的**键盘焦点** —— IDEA `FocusMainToolbarAction` + `MainToolbarFocusSupport` 的等价物。
//
// 上游两件（都在 `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/`）：
//   · `FocusMainToolbarAction.kt:11-26`：把焦点移到工具栏的第一个条目；**焦点已经在工具栏里就不动**
//     （`SwingUtilities.isDescendingFrom(focusOwner, toolbar)` ⇒ return）。动作 id `FocusMainToolbar`
//     （`intellij.platform.ide.impl.actions.xml:721`），文案 `ActionsBundle.properties:79-80`
//     （"Focus Main Toolbar" / "Move focus to the first item in the main toolbar"；
//     中文包 = 聚焦主工具栏 / 将焦点移至主工具栏中的第一个条目）。它和 `FocusStatusBar` 一样是
//     **顶层 `<reference>`**（`PlatformActions.xml:1364/1366`）—— 不占菜单行，所以本仓把它挂进
//     「查找操作」的动作索引（与 `window.focusStatusBar` 同一处，见 `src/menuUi.ts`）。
//   · `MainToolbarFocusSupport.kt`：
//     · `:51-61 focusFirstItem()`：取「可聚焦且可用」的第一个条目，**焦点在外时**记下当前焦点以便回来；
//     · `:66-70 getFocusableAndEnabledItems()` = `isFocusable && isToolbarFocusableType()` 再滤掉
//       "没显示"和"被禁用"；`:243-248 isToolbarFocusableType()` = 按钮/组合按钮/分裂按钮，**不含菜单**；
//     · `:87-101 restoreFocusToPreviousComponent()`：先回记下的那个（还在显示且可用才回），
//       否则 `toolWindowManager.activateEditorComponent()`（回编辑器）；
//     · `:216-224`：把 **←/→ 加进遍历键**（LEFT = backward、RIGHT = forward），
//       `:206-213` 的遍历策略在走到头时先落到标题栏的菜单按钮，再回环到第一个。
//     `focusFirstItem` 里那句"焦点在工具栏外面才记"（`:55-58`）就是"从编辑器进来、Esc 回编辑器"，
//     而"从工具栏内部再按一次不改记忆"—— 本仓照抄这条守卫。
//
// 纯逻辑在这里，DOM 入口 `focusMainToolbar()` / `restoreFocusFromMainToolbar()` 也在这里
// （与 `src/statusBarNav.ts` + `src/notifications.ts` 的分工一致：判据可单测，DOM 只做转发）。
import { reactive } from 'vue'
import { focusActiveEditor } from './editorFocus.ts'

/** 上游 `isToolbarFocusableType()`（`:243-248`）在 DOM 里的对应物：可交互控件，**不含菜单项**。 */
const TOOLBAR_ITEM_SELECTOR = 'button, select, input, textarea, [tabindex]:not([tabindex="-1"])'
/** 弹层里的行不算工具栏条目（上游 `mainToolbarComponents` 用 `expandAndFilter { it !is ActionMenu }` 排掉菜单）。 */
const TOOLBAR_POPUP_SELECTOR = '[role="menu"], .dropdown, .menu-button'

/** 一个候选条目（DOM 侧填 hidden/disabled，纯判据只认这两个布尔）。 */
export interface ToolbarItemState {
  hidden: boolean
  disabled: boolean
}

/**
 * `getFocusableAndEnabledItems()`（`:66-70`）：没显示或不可用的条目**不参与**
 * （上游是先 `isFocusable && isToolbarFocusableType()` 再滤 `isShowing && isEnabled`）。
 */
export function focusableToolbarItems<T extends ToolbarItemState>(items: readonly T[]): T[] {
  return items.filter(item => !item.hidden && !item.disabled)
}

/**
 * `FocusMainToolbarAction.actionPerformed` 的守卫（`:15-21`）：焦点已经在工具栏里就**什么都不做**
 * （别把用户在工具栏内部的选择挪走）。返回 `null` = 不动作，返回下标 = 该聚焦哪个。
 */
export function shouldFocusFirstToolbarItem(inside: boolean, count: number): number | null {
  if (inside) return null
  return count > 0 ? 0 : null
}

/**
 * `restoreFocusToPreviousComponent()`（`:87-101`）的两支：记下的那个还在显示且可用 ⇒ 回它；
 * 否则回编辑器（上游 `toolWindowManager.activateEditorComponent()`；编辑器也拿不到焦点时才清焦点）。
 */
export function resolveToolbarRestoreTarget(hasSaved: boolean, usable: boolean): 'saved' | 'editor' {
  return hasSaved && usable ? 'saved' : 'editor'
}

/**
 * `←/→` 在工具栏条目间移动（上游把这两键加进遍历键，`:216-224`；走到头由遍历策略回环，
 * `:206-213`）。本仓没有"标题栏菜单按钮"这一档可落，所以**直接回环**（登记在 `docs/source-todo.md` §14）。
 * 返回 `null` = 只有一条（或没有），没什么可移的。
 */
export function nextToolbarItemIndex(current: number, count: number, step: 1 | -1): number | null {
  if (count <= 1 || current < 0) return null
  return (current + step + count) % count
}

/** 浏览器的 `document.activeElement` 没有"null"这一档：焦点不在任何元素上时它是 body/html。 */
function isDocumentRoot(element: Element | null): boolean {
  return element === null || element === document.body || element === document.documentElement
}

/** 焦点是不是落在工具栏里（上游 `isFocusInsideToolbar()`，`:207-212`）。 */
export function focusInsideToolbar(active: Element | null, toolbar: Element | null): boolean {
  return Boolean(active && toolbar && toolbar.contains(active))
}

/** 建模块时（或宿主注入时）拿到的"工具栏根元素 + 回编辑器的入口"。 */
export interface MainToolbarFocusHost {
  toolbar: () => HTMLElement | null
  /** 回编辑器（上游 `activateEditorComponent()` 的等价物）：成功返回 true。 */
  focusEditor: () => boolean
}

/**
 * 工具栏条目的 DOM 收集 —— 与 `src/notifications.ts` 的 `statusWidgets()` 同一个形状：
 * 把 DOM 事实（隐藏/禁用）收成纯判据吃得下的状态。
 */
export function toolbarItemElements(root: ParentNode): HTMLElement[] {
  const candidates = [...root.querySelectorAll<HTMLElement>(TOOLBAR_ITEM_SELECTOR)]
    .filter(element => !element.closest(TOOLBAR_POPUP_SELECTOR))
    .map(element => ({
      element,
      hidden: element.offsetParent === null,
      disabled: element instanceof HTMLButtonElement || element instanceof HTMLSelectElement
        || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.disabled : false,
    }))
  return focusableToolbarItems(candidates).map(entry => entry.element)
}

/**
 * 现成的宿主：工具栏在 DOM 里是单例（`MainToolbar.vue` 的根 `.topbar-toolbar`），
 * 所以不必从 App.vue 注入 —— 与 `src/notifications.ts` 取编辑器那处同一路子。
 * 编辑器那条选择器也抄它（回焦点时用）。
 */
export const mainToolbarFocusHost: MainToolbarFocusHost = {
  toolbar: () => document.querySelector<HTMLElement>('.topbar-toolbar'),
  // 回编辑器走共用助手：`.editor-stage .cm-content` 可能有多个（分屏/会话恢复），
  // 隐藏的那个 focus() 是无声失败的 —— 见 src/editorFocus.ts 的文件头。
  focusEditor: () => focusActiveEditor(),
}

/** 进入工具栏前记下的焦点（`restoreFocusTargetRef`，`:51-61`）。 */
const toolbarFocusBefore = reactive<{ element: HTMLElement | null }>({ element: null })

export function resetMainToolbarFocusState() { toolbarFocusBefore.element = null }

/** `FocusMainToolbar` 动作：焦点已在工具栏里就不动；否则记下当前焦点并聚焦第一个条目。 */
export function focusMainToolbar(host: MainToolbarFocusHost): void {
  const toolbar = host.toolbar()
  if (!toolbar) return
  const items = toolbarItemElements(toolbar)
  const active = document.activeElement as HTMLElement | null
  // 上游的 `isFocusInsideToolbar()` 把**标题栏**也算进去（`:207-212`：工具栏或它的
  // `ToolbarFrameHeader`）—— 本仓标题栏是 `.topbar`（菜单与工具栏同一行），所以焦点在菜单里也不动。
  const inside = focusInsideToolbar(active, toolbar.closest('.topbar') ?? toolbar)
  if (shouldFocusFirstToolbarItem(inside, items.length) === null) return
  // 上游那句 `isFocusOutsideToolbar = focusOwner != null && !isDescendingFrom(focusOwner, …)`
  // （`:55-58`）：**没有焦点主**时不记 —— 本仓的对应物是"焦点在 body/html 上"（浏览器里永远有个
  // activeElement，没有"null"这一档）。记了它反而会让 Esc 回到一个什么都没聚焦的元素上。
  if (!inside && !isDocumentRoot(active)) toolbarFocusBefore.element = active
  items[0]?.focus()
}

/** `Esc`（上游注册在工具栏上的那条自定义快捷键）：回记下的那个，拿不回来就回编辑器。 */
export function restoreFocusFromMainToolbar(host: MainToolbarFocusHost): void {
  const saved = toolbarFocusBefore.element
  toolbarFocusBefore.element = null
  const usable = Boolean(saved?.isConnected && !(saved as HTMLButtonElement).disabled)
  if (resolveToolbarRestoreTarget(Boolean(saved), usable) === 'saved' && saved) { saved.focus(); return }
  host.focusEditor()
}

/** `←/→`：在条目间移动（本仓直接回环，见 `nextToolbarItemIndex` 的说明）。 */
export function moveToolbarFocus(host: MainToolbarFocusHost, step: 1 | -1): void {
  const toolbar = host.toolbar()
  if (!toolbar) return
  const items = toolbarItemElements(toolbar)
  const active = document.activeElement as HTMLElement | null
  const index = active ? items.indexOf(active) : -1
  if (index < 0) return
  const next = nextToolbarItemIndex(index, items.length, step)
  if (next !== null) items[next]?.focus()
}
