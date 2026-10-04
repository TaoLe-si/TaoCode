// 状态栏组件的**实例生命周期**（上游 `EditorBasedWidget` + `StatusBarUtil` 的那一半）。
//
// 上游把"工厂"与"组件实例"分成两层（这是 `StatusBarWidgetsManager` 存在的理由）：
//   · `StatusBarWidgetFactory`（`platform-api/.../StatusBarWidgetFactory.java`）—— 元数据；
//   · `StatusBarWidget` 实例 —— 装到某一条状态栏上（`install(statusBar)`），
//     卸载时 `dispose()` 并**置 `isDisposed`**，之后所有更新一律返回（`EditorBasedWidget.kt:96-109`）。
//
// 本仓的 `src/statusBarWidgets.ts` 只有工厂那一层（纯逻辑 + 持久化）。这一层补的是实例那半边：
//
//   · `install` / `dispose` / `isDisposed`（`EditorBasedWidget.kt:96-109`）；
//   · `install` 时断言"装到属于自己那条状态栏上"（`:97-99` 的 `assert(statusBar.project == null
//     || statusBar.project == project)`）—— 本仓单窗口单状态栏，等价物就是"窗口 id 对得上"；
//   · `isOurEditor(editor)`（`:57-64`）：这个编辑器是不是**本状态栏正在显示的那一个**。
//     上游的三条：非空、`component.isShowing`、且属于本状态栏（`StatusBarUtil.getStatusBar(component)
//     === statusBar`，`StatusBarUtil.kt:27-37` 沿组件树上溯找 `IdeFrame`）。
//     本仓没有 `IdeFrame`，等价物是"这个编辑器属于当前窗口"—— 用 `windowId` 表达同一件事。
//   · `getSelectedFile()`（`:91-95`）：`getCurrentFileEditor(statusBar)` 的文件。
//
// **为什么要单独一层**：这类"更新跑在已经卸载的组件上"的缺陷只有真机能碰到（编辑器关掉后
// 还有一次异步回包要写状态栏）。把生命周期显式建出来，`isDisposed` 才是一个能写判据的状态，
// 而不是靠"调用方自觉"。
import type { StatusBarWidgetFactory } from './statusBarWidgets.ts'

/** 上游 `StatusBar.currentEditor` 的等价物：这条状态栏此刻在显示哪个编辑器/文件。 */
export interface StatusBarBinding {
  /** 这条状态栏属于哪个窗口（上游 `StatusBar.getProject()` 的那一层断言用的身份）。 */
  windowId: string
  /** 此刻显示的编辑器 id（没有打开的文本编辑器时为 null）。 */
  editorId: string | null
  /** 此刻显示的文件路径（`getSelectedFile()`）。 */
  filePath: string | null
  /** 该编辑器此刻是否可见（上游 `UIUtil.isShowing(editor.component)` / `isShowing`）。 */
  editorShowing: boolean
}

export interface WidgetInstance {
  readonly factory: StatusBarWidgetFactory
  /** 装在哪条状态栏上（`install(statusBar)` 的参数，卸载后置 null）。 */
  statusBar: StatusBarBinding | null
  /** `EditorBasedWidget.isDisposed`：一旦 dispose，所有更新都应当被挡掉。 */
  readonly isDisposed: boolean
}

/** 上游 `install` 的断言：不许把某个窗口的组件装到另一个窗口的状态栏上。 */
export class StatusBarMismatchError extends Error {
  constructor(message: string) { super(message); this.name = 'StatusBarMismatchError' }
}

/**
 * `install(statusBar)`（`EditorBasedWidget.kt:96-102`）：登记所属状态栏；已 dispose 的实例拒绝重装。
 * 装到不属于自己的窗口上时**抛错**而不是静默接受 —— 上游那里是一条 `assert`，
 * 静默接受会让 `isOurEditor` 后面全都判错，缺陷会跑到很远的地方才显形。
 */
export function installWidget(factory: StatusBarWidgetFactory, statusBar: StatusBarBinding, windowId: string): WidgetInstance {
  if (windowId !== statusBar.windowId) {
    throw new StatusBarMismatchError(`不能把窗口 ${windowId} 的状态栏组件装到窗口 ${statusBar.windowId} 上`)
  }
  return { factory, statusBar, isDisposed: false }
}

/** `dispose()`（`EditorBasedWidget.kt:104-108`）：置位并断开与状态栏的关联。 */
export function disposeWidget(instance: WidgetInstance): WidgetInstance {
  return { factory: instance.factory, statusBar: null, isDisposed: true }
}

/**
 * `isOurEditor(editor)`（`EditorBasedWidget.kt:57-64`）：
 * 非空 + 可见 + 属于本状态栏。本仓把"属于本状态栏"折成 `editorId` 相等。
 */
export function isOurEditor(instance: WidgetInstance, editorId: string | null, statusBar?: StatusBarBinding): boolean {
  if (instance.isDisposed || !instance.statusBar) return false
  const bar = statusBar ?? instance.statusBar
  return editorId !== null && editorId === bar.editorId && bar.editorShowing
}

/**
 * `getSelectedFile()`（`EditorBasedWidget.kt:91-95`）：这条状态栏此刻显示的文件。
 * 已卸载的实例返回 null（上游那里 `myStatusBar` 已经置空，取不到 file editor）。
 */
export function selectedFile(instance: WidgetInstance, statusBar?: StatusBarBinding): string | null {
  if (instance.isDisposed) return null
  return (statusBar ?? instance.statusBar)?.filePath ?? null
}

/**
 * 更新前的一道闸：编辑器的选中项变了、或文件换了时，只有**还活着、且这次更新说的是本状态栏
 * 正在显示的那个编辑器**才放行。这是把 `isDisposed` 与 `isOurEditor` 合起来用的那一步 ——
 * 上游每个 `EditorBasedWidget` 子类在 `selectionChanged`/`fileEdited` 里都先过这一关
 * （如 `PositionPanel.selectionChanged` 与 `EncodingPanel` 的 `updateForSelection`）。
 */
export function shouldUpdateForEditor(instance: WidgetInstance, editorId: string | null, statusBar?: StatusBarBinding): boolean {
  return !instance.isDisposed && isOurEditor(instance, editorId, statusBar)
}

/**
 * 上游 `StatusBarEditorBasedWidgetFactory.canBeEnabledOn`（`StatusBarEditorBasedWidgetFactory.kt:14-16`）：
 * `getTextEditor(statusBar) != null` —— 有文本编辑器时这个组件才能开。
 * 本仓的对应判据（`src/statusBarWidgets.ts` 的 `widgetToggleEnabled` 用的是同一个概念的布尔版；
 * 这里给出"从状态栏绑定取"的那一半，供调用方拿到权威值）。
 */
export function canEnableOn(statusBar: StatusBarBinding | null): boolean {
  return statusBar !== null && statusBar.editorId !== null && statusBar.editorShowing
}