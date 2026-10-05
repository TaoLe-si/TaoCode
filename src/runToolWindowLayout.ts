// Run 工具窗口的**视图动作族**（上游 `RunnerLayoutActions` 组）。
//
// 上游坐标（`platform/execution-impl/`）：
//   · 动作登记 `resources/intellij.platform.execution.impl.actions.xml:25-31`（六个 `Runner.*` id）
//     + `:78-99` 的组结构（`Runner.ToggleTabLabels` → `Runner.Layout`（RestoreLayout）→
//     `Runner.View.Close.Group`（CloseView / CloseOtherViews / CloseAllViews / CloseAllUnpinnedViews）
//     → `Runner.Focus`）。整组在 `platform/platform-impl/resources/idea/ExecutionActions.xml:142`
//     被 Run 工具窗口引用。
//   · 判定与执行 `ui/layout/actions/`：
//     `CloseViewsActionBase.java:17-20`（update 里 `setEnabledAndVisible(isEnabled(...))` —— 不可用就**隐藏**）、
//     `:23-31`（actionPerformed 逐个 `closeable && isAccepted` 移除）、`:26`（那个 `closeable` 条件）、
//     `:32-38`（isEnabled = 有没有一个会被关掉）；
//     `CloseViewAction.java:58-60`（`content.length == 1 && content[0].isCloseable()`）；
//     `CloseOtherViewsAction.java:27-29`（`isAccepted` = `c != selected`）；
//     `CloseAllViewsAction.java:27-33`（可关的**多于一个**才可用）；
//     `CloseAllUnpinnedViewsAction.java:27-32`（**一个 pinned 都没有就直接 false**）、`:35-37`（`isAccepted` = `!isPinned()`）；
//     `ToggleShowTabLabelsAction.java:22-29`（非调试器工具条 place 且有 RunnerContentUi 才可见）、`:31-44`。
//   · 状态落点 `ui/layout/impl/RunnerLayout.java:295`（`General.isTabLabelsHidden = true`，**默认隐藏**）、
//     `:284-290` 读写、`RunnerLayoutSettings.java:18-21`（存 `runner.layout.xml`，`RoamingType.DISABLED`）。
//     消费面 `ui/layout/impl/GridImpl.java:163-171`：隐藏时只有**一个**内容的格子才隐标签，
//     显示时按整个格子数 —— 即"隐藏标签"只影响多内容格子。
//
// 本仓对应物：`src/components/RunConsole.vue` 的一条扁平实例标签条，一个实例 = 一个上游
// `Content`（`RunContentDescriptor`，`RunContentManagerImpl` 每个实例开一个）。所以：
//   · `Content.isCloseable()` ⇒ 宿主还停得掉这个实例（`run.stop {instance}`，native/run_host.cpp:413-428）；
//     关掉它就是「停这个实例 + 摘掉这个标签」（上游 `isToDisposeRemovedContent` 默认 true →
//     `RunnerContentUi.java:1678-1680` → dispose 连带 `RunContentDescriptor.java:91-93` 注册的
//     `ExecutionConsole`，进程随之结束）。
//   · `Content.isPinned()` ⇒ 恒 false：`ContentImpl.java:36-37` 两字段默认 false 且 `setPinned`
//     只在 `isPinnable()` 时生效（`:218-224`），而 `execution-impl` 全树没有对运行视图调过
//     `setPinnable`/`setPinned`。所以 `Runner.CloseAllUnpinnedViews` 按上游**恒不可用**
//     （`CloseAllUnpinnedViewsAction.java:22-29`）—— 这里如实渲染成禁用条目并写明原因，
//     既不省略（那会看不出上游有这条）也不假装能用。
//   · "隐藏标签页标题"落在标签文字上：标题不画，只留状态点与退出码徽标（`GridImpl.java:163-171`
//     的多内容格子语义），本仓没有上游那种每内容图标，所以状态点就是剩下的一切。
//
// 纯函数（无 Vue、无 DOM、无桥），判据 tests/runner-view-actions.test.mjs。

export type RunnerViewActionId =
  | 'Runner.ToggleTabLabels'
  | 'Runner.CloseView'
  | 'Runner.CloseOtherViews'
  | 'Runner.CloseAllViews'
  | 'Runner.CloseAllUnpinnedViews'

/** Run 工具窗口里的一个视图 = 一个运行实例（上游的一个 `Content`）。 */
export interface RunViewContent {
  id: number
  /** `Content.isCloseable()`：能不能关（宿主还停得掉这个实例就是 true）。 */
  closeable: boolean
  /**
   * `Content.isPinned()`。见文件头：本仓恒 false，字段留着是为了让上游那条
   * 「有 pinned 才可用」的判定**可测**，而不是靠注释声明。
   */
  pinned?: boolean
}

export interface RunnerViewActionRow {
  id: RunnerViewActionId
  label: string
  enabled: boolean
  /** `enabled === false` 时给 UI 的一句话原因（上游直接隐藏，本仓留可见禁用行 + 原因）。 */
  reason?: string
}

/** 文案取自动作类名（XML 里没有 `text` 属性，ActionManager 由类名 camelCase 拆出）。 */
export const RUNNER_VIEW_ACTION_LABELS: Record<RunnerViewActionId, string> = {
  'Runner.ToggleTabLabels': '显示标签页标题',
  'Runner.CloseView': '关闭视图',
  'Runner.CloseOtherViews': '关闭其他视图',
  'Runner.CloseAllViews': '关闭全部视图',
  'Runner.CloseAllUnpinnedViews': '关闭全部未固定视图',
}

/** 渲染顺序 = `RunnerLayoutActions` 组里的顺序（actions.xml:78-87，RestoreLayout 段见下）。 */
export const RUNNER_VIEW_ACTION_ORDER: readonly RunnerViewActionId[] = [
  'Runner.ToggleTabLabels',
  'Runner.CloseView',
  'Runner.CloseOtherViews',
  'Runner.CloseAllViews',
  'Runner.CloseAllUnpinnedViews',
]

const NO_PINNED_REASON = '运行视图在上游永远不是「固定」的（Content 默认 pinned=false，'
  + 'execution-impl 不对运行视图调 setPinnable），所以这条永远不适用。'

/**
 * `CloseViewsActionBase.isEnabled`（`:32-38`）的通用形：有没有一个 content 会
 * 同时满足 `closeable` 与 `isAccepted`。
 */
function anyAccepted(contents: readonly RunViewContent[], isAccepted: (c: RunViewContent) => boolean): boolean {
  return contents.some(content => content.closeable && isAccepted(content))
}

/**
 * 弹层里那几行的启用判定。`selected` 是当前选中的视图 id（`null` = 没有选中）。
 *
 * `Runner.ToggleTabLabels` 恒可用：`ToggleShowTabLabelsAction.update`（`:19-24`）只要求
 * 「不在调试器工具条 place 且有 RunnerContentUi」—— 本弹层就在 Run 工具窗口里，两个条件都成立。
 */
export function runnerViewActionRows(
  contents: readonly RunViewContent[], selected: number | null,
): RunnerViewActionRow[] {
  const closeable = contents.filter(content => content.closeable)
  const isSelected = (c: RunViewContent) => c.id === selected
  const anyPinned = contents.some(content => content.pinned === true)
  const enabledBy: Record<RunnerViewActionId, boolean> = {
    'Runner.ToggleTabLabels': true,
    // CloseViewAction.java:58-60 —— 恰好选中一个，且它可关。
    'Runner.CloseView': selected !== null && closeable.some(isSelected),
    // CloseOtherViewsAction.java:27-29 + CloseViewsActionBase.java:32-38。
    'Runner.CloseOtherViews': anyAccepted(contents, c => c.id !== selected),
    // CloseAllViewsAction.java:27-33 —— 可关的多于一个。
    'Runner.CloseAllViews': closeable.length > 1,
    // CloseAllUnpinnedViewsAction.java:27-32 —— 一个 pinned 都没有就直接 false。
    'Runner.CloseAllUnpinnedViews': anyPinned && anyAccepted(contents, c => c.pinned !== true),
  }
  return RUNNER_VIEW_ACTION_ORDER.map(id => {
    const enabled = enabledBy[id]
    return {
      id,
      label: RUNNER_VIEW_ACTION_LABELS[id],
      enabled,
      ...(enabled || id !== 'Runner.CloseAllUnpinnedViews' ? {} : { reason: NO_PINNED_REASON }),
    }
  })
}

/**
 * 这条动作要关掉哪些视图 id（`CloseViewsActionBase.actionPerformed` `:23-31` 的纯形：
 * 逐个 `closeable && isAccepted` 移除）。调用方负责真的去停进程与摘标签。
 * `Runner.ToggleTabLabels` 不关任何视图。
 */
export function viewsToClose(
  id: RunnerViewActionId, contents: readonly RunViewContent[], selected: number | null,
): number[] {
  const closeable = contents.filter(content => content.closeable)
  switch (id) {
    case 'Runner.CloseView':
      return selected !== null && closeable.some(content => content.id === selected) ? [selected] : []
    case 'Runner.CloseOtherViews':
      return closeable.filter(content => content.id !== selected).map(content => content.id)
    case 'Runner.CloseAllViews':
      return closeable.map(content => content.id)
    case 'Runner.CloseAllUnpinnedViews':
      return closeable.filter(content => content.pinned !== true).map(content => content.id)
    case 'Runner.ToggleTabLabels':
      return []
  }
}

/**
 * 登记但**不渲染**的那几条，附上游坐标与原因（不放假控件：没有可作用的状态就不给按钮）。
 * 导出成常量是为了让「为什么不渲染」可被门禁核对，而不是只写在注释里。
 */
export const RUNNER_VIEW_ACTIONS_NOT_PORTED = [
  {
    id: 'Runner.RestoreLayout',
    reason: '`RestoreLayoutAction.java:25-30` → `RunnerContentUi.restoreLayout()` `:1491-1526`：'
      + '把全部 Content 按默认 tab 顺序重新加回去（`myLayoutSettings.resetToDefault()`）。'
      + '本仓标签条是扁平的，没有可移动的视图格、没有 `CustomContentLayoutSettings`，'
      + '所以它没有任何可恢复的状态 —— 渲染出来只能是一个点了没反应的按钮。',
  },
  {
    id: 'MinimizeView',
    reason: '`MinimizeViewAction` 没有登记成 `Runner.*` id（类上标着 @ComponentNotRegistered），'
      + '唯一调用点是 `RunnerContentUi.java:408-409` 的**标签关闭键**分支：'
      + '`CloseViewAction.isEnabled(contents)` 为假时才轮到最小化。运行视图都可关，'
      + '该分支在 Run 工具窗口里不可达，另加 `!tab.isDefault()` 的限制（`MinimizeViewAction.java:28-45`）。',
  },
  {
    id: 'Runner.FocusOnStartup',
    reason: '`FocusOnStartAction.java:21-24` 只是 `AbstractFocusOnAction(LayoutViewOptions.STARTUP)`，'
      + '登记在 `platform/lang-api/resources/intellij.platform.lang.actions.xml:3`。'
      + '它做的事（`AbstractFocusOnAction.java:20-26` 与 `:33-36`）是在**多视图布局**里给某个 Content 打一个'
      + '「启动时聚焦」的标记：`getRunnerLayoutUi().getOptions().setToFocus(content, STARTUP)`，'
      + '而且 `content.length == 1` 时整条不显示。本仓的 Run 工具窗口是**一条扁平实例标签**'
      + '（`src/components/RunConsole.vue`，见本文件头部），没有 `RunnerLayoutUi` 也没有可切换的视图格，'
      + '「启动时聚焦哪一个布局」没有对象可标 —— 与 `Runner.RestoreLayout` 同一条架构性卡点，'
      + '`RunnerLayoutSettings`/`CustomContentLayoutSettings` 那个布局设置页也一并落不了地。',
  },
] as const

// —— 「隐藏标签页标题」的持久化（`RunnerLayout.General.isTabLabelsHidden`） ——

export const RUNNER_LAYOUT_KEY = 'taocode.runnerLayout'

/** `RunnerLayout.java:295`：`isTabLabelsHidden = true`，**默认隐藏**。 */
export const TAB_LABELS_HIDDEN_DEFAULT = true

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 读回设置；没有记录或记录坏了都用上游默认（隐藏）。 */
export function readRunTabLabelsHidden(store: StorageLike | undefined): boolean {
  try {
    const raw = store?.getItem(RUNNER_LAYOUT_KEY)
    if (raw === null || raw === undefined) return TAB_LABELS_HIDDEN_DEFAULT
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return TAB_LABELS_HIDDEN_DEFAULT
    const value = (parsed as { tabLabelsHidden?: unknown }).tabLabelsHidden
    return typeof value === 'boolean' ? value : TAB_LABELS_HIDDEN_DEFAULT
  } catch {
    return TAB_LABELS_HIDDEN_DEFAULT
  }
}

export function writeRunTabLabelsHidden(store: StorageLike | undefined, hidden: boolean): void {
  try { store?.setItem(RUNNER_LAYOUT_KEY, JSON.stringify({ tabLabelsHidden: hidden })) } catch { /* 存储不可用只影响持久化 */ }
}
