// IDEA 的状态栏组件**注册表**与可见性设置 —— `StatusBarWidgetFactory` 那一层。
//
// 上游三件（都在 `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/widget/`）：
//   · `StatusBarWidgetSettings.kt:20-41`：状态是 `Map<String 工厂 id, Boolean>`，**只存与默认不同的**——
//     `setEnabled` 在新值等于 `isEnabledByDefault` 时把那条**删掉**（`:32-40`）；查询是
//     `state.widgets.get(id) ?: factory.isEnabledByDefault`（`:26-28`）。所以"用户的显式关闭"才是
//     `isExplicitlyDisabled(id)`（`:24`），它只认 `== false` 那条。
//   · `StatusBarWidgetsManager.kt:58-59`：`LinkedHashMap<Factory, Widget>` + `widgetIdMap: Map<id, Factory>`
//     —— 前者是"已创建的组件"，后者是"按 id 反查工厂"（`findWidgetFactory` :139）。
//   · `updateWidget`（:97-131）：三道闸依次开 —— `(isConfigurable && !settings.isEnabled(factory))
//     || !isAvailable || !isAllowedByInternalMode` 就 `disableWidget`，否则建组件并登记。
//     `canBeEnabledOnStatusBar`（:161-167）是右键菜单用的**四合一**判据：
//     `isAvailable && isAllowedByInternalMode && isConfigurable && canBeEnabledOn(statusBar)`。
//
// 上游 `isAllowedByInternalMode = !isInternal || 应用处于内部模式`（:243-245）—— 内部组件（`WriteThread`、
// `SmartModeIndicator`、`IndexesAndVfsFlushIndicator`）只在内部模式出现。本仓没有内部模式，等价物是
// `isInternal` 直接当"不注册"。
//
// 判据（为什么单独成模块）：这一层是"加一个状态栏组件要改 App.vue"这个结构性缺口的答案 ——
// 有了它，新组件只是往 `src/statusWidgets.ts` 的工厂表里加一条；可见性、持久化、右键勾选的过滤
// 全在这里，且不碰 DOM（`tests/status-bar-widgets.test.mjs` 直接跑）。

// 组件**实例**那一层（`src/statusBarLifecycle.ts`）在这里落地：工厂表决定「该不该建」，
// 实例表决定「建了没、卸了没」，两者分开正是上游 `StatusBarWidgetsManager` 存在的理由
// （`LinkedHashMap<Factory, Widget>` + `widgetIdMap`，`StatusBarWidgetsManager.kt:58-59`）。
// 有了实例表，`dispose` 之后「所有更新一律返回」这条保护才有地方生效（`EditorBasedWidget.kt:96-109`）。
import { disposeWidget, installWidget, type StatusBarBinding, type WidgetInstance } from './statusBarLifecycle.ts'

/** 上游 `StatusBarWidgetFactory`（`platform-api/.../StatusBarWidgetFactory.java`）的字段面。 */
export interface StatusBarWidgetFactory {
  /** 上游 `getId()`：与 plugin.xml 的扩展 `id` 一致，**也是持久化可见性用的键**（`:31-34`）。 */
  id: string
  /** 上游 `getDisplayName()`：右键勾选项与"显示/隐藏 <名字>"动作里的名字（`:37-41`）。 */
  displayName: string
  /** 上游 `isEnabledByDefault()`，默认 true（`:112-114`）。 */
  enabledByDefault?: boolean
  /** 上游 `isConfigurable()`，默认 true；false = 用户不能开关（`:122-124`）。 */
  configurable?: boolean
  /** 上游 `isInternal()`，默认 false；true = 只在内部模式出现（`:128-130`）。 */
  internal?: boolean
  /** 上游 `isAvailable(project)`，默认 true（`:68-70`）。 */
  available?: boolean
  /**
   * 上游 `StatusBarEditorBasedWidgetFactory.canBeEnabledOn`（`status/widget/StatusBarEditorBasedWidgetFactory.kt:14-16`）：
   * `getTextEditor(statusBar) != null` —— **没有打开的编辑器时这个组件不能开启**。右键菜单里那一格
   * 会因此禁用（`ToggleWidgetAction.update` 在状态栏位置用 `canBeEnabledOnStatusBar` 决定
   * `isEnabledAndVisible`，`StatusBarWidgetsActionGroup.kt:104-110`）。
   */
  editorBased?: boolean
}

/** `widgets.get(id) ?: factory.isEnabledByDefault`（`StatusBarWidgetSettings.kt:26-28`）。 */
export function widgetEnabled(overrides: Readonly<Record<string, boolean>>, factory: StatusBarWidgetFactory): boolean {
  const stored = Object.prototype.hasOwnProperty.call(overrides, factory.id) ? overrides[factory.id] : undefined
  return typeof stored === 'boolean' ? stored : factory.enabledByDefault !== false
}

/**
 * `setEnabled`（`StatusBarWidgetSettings.kt:32-40`）：新值等于默认就把这条**删掉**（不是存一个等于默认的
 * 值）—— 这样"改回默认"与"从没动过"在存档里是同一个状态。
 */
export function withWidgetEnabled(overrides: Readonly<Record<string, boolean>>, factory: StatusBarWidgetFactory, value: boolean): Record<string, boolean> {
  const next = { ...overrides }
  if (widgetEnabled({}, factory) === value) delete next[factory.id]
  else next[factory.id] = value
  return next
}

/** `isExplicitlyDisabled`（`:24`）——只认显式存下来的 `false`。 */
export function explicitlyDisabled(overrides: Readonly<Record<string, boolean>>, id: string): boolean {
  return overrides[id] === false
}

/** `isAllowedByInternalMode`（`StatusBarWidgetsManager.kt:243-245`）。本仓没有内部模式，一律放行非内部组件。 */
function allowedByInternalMode(factory: StatusBarWidgetFactory): boolean {
  return factory.internal !== true
}

/** 工厂该不该建组件（`updateWidget` :98-100 的三道闸）。 */
export function shouldCreateWidget(factory: StatusBarWidgetFactory, overrides: Readonly<Record<string, boolean>>): boolean {
  if (factory.configurable !== false && !widgetEnabled(overrides, factory)) return false
  if (factory.available === false) return false
  if (!allowedByInternalMode(factory)) return false
  return true
}

/**
 * `StatusBarActionManager.getActionsFor`（`StatusBarWidgetsActionGroup.kt:191-196`）只给 `isConfigurable`
 * 的工厂出勾选项 —— 组件自己不可开关的（上游 `FatalErrorWidgetFactory`）不该出现在右键菜单里。
 * `ToggleWidgetAction.update` 还会再按 `canBeEnabledOnStatusBar`（四合一）决定该项**能不能点**
 * （`StatusBarWidgetsActionGroup.kt:104-110`）：本仓只兑现其中一条有真宿主的分支 ——
 * editor-based 工厂在没有打开的编辑器时不可开启（`getTextEditor(statusBar) != null`）。
 */
export function configurableFactories<T extends StatusBarWidgetFactory>(factories: readonly T[]): T[] {
  return factories.filter(factory => factory.configurable !== false && allowedByInternalMode(factory))
}

/**
 * 右键勾选项此刻是否可点 —— 上游 `canBeEnabledOnStatusBar`（`StatusBarWidgetsManager.kt:161-167`）
 * 的第三、四条里本仓能兑现的那部分：`canBeEnabledOn(statusBar)`。对 editor-based 工厂就是
 * 「有打开的编辑器」；其余组件一律可点（`canBeEnabledOn` 默认 true）。
 */
export function widgetToggleEnabled(factory: StatusBarWidgetFactory, hasEditor: boolean): boolean {
  return allowedByInternalMode(factory) && (factory.editorBased !== true || hasEditor)
}

/** 旧存档（`taocode.hiddenStatusWidgets` 的隐藏键数组）→ 新的 id→覆盖 映射。 */
export function migrateHiddenKeys(hidden: unknown): Record<string, boolean> {
  const overrides: Record<string, boolean> = {}
  if (!Array.isArray(hidden)) return overrides
  for (const key of hidden) if (typeof key === 'string') overrides[key] = false
  return overrides
}

// ── 组件实例表（`StatusBarWidgetsManager.updateWidget` 的可移植核心）──────────────────────

/** 状态栏此刻的宿主状态（`StatusBarBinding` 的**活**来源；本仓单窗口，所以按 getter 给）。 */
export interface StatusBarWidgetHost {
  /** 这条状态栏属于哪个窗口 —— 装错窗口要抛错（`EditorBasedWidget.kt:111-113` 的 assert）。 */
  windowId: string
  editorId: () => string | null
  filePath: () => string | null
  editorShowing: () => boolean
}

export interface StatusBarWidgetInstances {
  /** 已建组件的实例表（`LinkedHashMap<Factory, Widget>` 的可移植子集，键用工厂 id）。 */
  instance: (id: string) => WidgetInstance | null
  /** 此刻**活着的**实例 id（已 dispose 的不算）。 */
  liveIds: () => string[]
  /**
   * `updateWidget()`（`:97-131`）的一拍：按 `shouldCreateWidget` 的三道闸逐个建或卸。
   * 返回这一拍**真的动了**的那些 id（建起来的 / 卸掉的），调用方据此决定要不要重渲染。
   */
  sync: (factories: readonly StatusBarWidgetFactory[], overrides: Readonly<Record<string, boolean>>) => { installed: string[]; disposed: string[] }
  /** 卸掉全部（关工作区 / 换项目时）。 */
  disposeAll: () => string[]
}

export function createStatusBarWidgetInstances(host: StatusBarWidgetHost): StatusBarWidgetInstances {
  const instances = new Map<string, WidgetInstance>()
  // **活状态栏**，不是安装那一刻的快照：上游 `EditorBasedWidget.myStatusBar`（`EditorBasedWidget.kt:59`）
  // 存的是那条 `StatusBar` **对象本身**，`isOurEditor`（`:97`）与 `getSelectedFile()`（`:103-108`，
  // 内部走 `StatusBarUtil.getCurrentFileEditor(myStatusBar)`）每次调用都从它身上现取当前编辑器。
  // 存成快照的话，「先没有编辑器时装上、之后编辑器被打开」的组件会永远判不出是自己的编辑器 ——
  // 菜单那一侧的 `widgetToggleEnabled` 已经跟着编辑器变灰/变亮，实例这一侧必须跟着活。
  const statusBar: StatusBarBinding = {
    windowId: host.windowId,
    get editorId() { return host.editorId() },
    get filePath() { return host.filePath() },
    get editorShowing() { return host.editorShowing() },
  }
  return {
    instance: id => instances.get(id) ?? null,
    liveIds: () => [...instances.values()].filter(instance => !instance.isDisposed).map(instance => instance.factory.id),
    sync(factories, overrides) {
      const installed: string[] = []
      const disposed: string[] = []
      for (const factory of factories) {
        const current = instances.get(factory.id)
        if (shouldCreateWidget(factory, overrides)) {
          // 已经在跑就**不重装**：上游 `updateWidget` 复用已登记的组件，重装会把它的状态清掉。
          if (current && !current.isDisposed) continue
          instances.set(factory.id, installWidget(factory, statusBar, host.windowId))
          installed.push(factory.id)
        } else if (current && !current.isDisposed) {
          instances.set(factory.id, disposeWidget(current))
          disposed.push(factory.id)
        }
      }
      return { installed, disposed }
    },
    disposeAll() {
      const disposed: string[] = []
      for (const [id, instance] of instances) {
        if (instance.isDisposed) continue
        instances.set(id, disposeWidget(instance))
        disposed.push(id)
      }
      return disposed
    },
  }
}
