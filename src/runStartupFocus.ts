// 「启动一个运行实例时，要不要把面板打开 / 把键盘焦点移进去 / 要不要新建标签」的**纯判定**。
//
// 先记一件事：派单给的三条上游坐标里，有两条按原样指不到东西（逐条打开过）——
//   · `platform/execution/impl/src/com/intellij/execution/ui/RunContentManager.java` ⇒ 参考树里没有
//     `platform/execution/impl/` 这个目录。接口真身在
//     `platform/execution/src/com/intellij/execution/ui/RunContentManager.java:23`（`showRunContent`
//     声明在 `:64-66`、`getReuseContent` 在 `:58-59`），实现类是
//     `platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt:70`。
//   · `RunnerSettings` 里**没有**这个开关：`platform/execution/src/com/intellij/execution/configurations/RunnerSettings.java:20`
//     整份文件就是 `public interface RunnerSettings extends JDOMExternalizable {}`，一个字段都没有。
//   · `BeforeRunTaskDescriptor.java` 在参考树里不存在（按文件名搜只得到
//     `platform/execution/src/com/intellij/execution/BeforeRunTask.java`、`BeforeRunTaskProvider.java`、
//     `platform/execution-impl/src/com/intellij/execution/impl/BeforeRunTaskAwareConfiguration.java`、
//     `platform/execution-impl/src/com/intellij/execution/impl/BeforeRunTaskHelper.kt`）。
//   · `platform/execution/ex-ui-resources/…/ui/Bundle.properties` 也不存在；文案真身是
//     `platform/execution/resources/messages/ExecutionBundle.properties`（见下）。
//   · `platform/execution/src/com/intellij/execution/runners/ExecutionUtil.java`（322 行）里没有任何
//     与本条相关的判定（全文 `focus`/`activat` 只命中 `:167` 的一条超链接事件）。
//
// 「Runner.FocusOnStartup」到底是什么（与本仓既有判词同一条 id，逐行核过）：
//   · 登记 `platform/lang-api/resources/intellij.platform.lang.actions.xml:3`
//     （`<action id="Runner.FocusOnStartup" class="com.intellij.execution.ui.actions.FocusOnStartAction"/>`），
//     引用进 `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:93`
//     （`Runner.View.Popup` › `Runner.Focus` 组）。
//   · 本体 `platform/lang-api/src/com/intellij/execution/ui/actions/FocusOnStartAction.java:21-24`
//     只是 `super(LayoutViewOptions.STARTUP)`；条件常量 `startup` 在
//     `platform/execution/src/com/intellij/execution/ui/layout/LayoutViewOptions.java:11`。
//   · 行为 `platform/lang-api/src/com/intellij/execution/ui/actions/AbstractFocusOnAction.java:20-26`：
//     `final boolean visible = content.length == 1;` —— **恰好选中一个视图时才显示**（本仓旧判词
//     把这条写反成了「`content.length == 1` 时整条不显示」，见 `src/runToolWindowLayout.ts` 的订正）；
//     `:28-30` 读勾（`getOptions().isToFocus(content[0], myCondition)`）、`:32-36` 写勾
//     （`setToFocus(toFocus ? null : content[0], myCondition)`，再点一次就取消标记）。
//   ⇒ 它是**多视图布局里给某一个 Content 打的「UI 首次显示时聚焦它」标记**，作用在
//     `platform/execution-impl/src/com/intellij/execution/ui/layout/impl/RunnerLayout.java`：
//     `:248-250` `isToFocus` = 存的那个 id 等不等、`:252-254` `setToFocus` 写
//     `myGeneral.focusOnCondition`、`:264-267` `getToFocus` 先查用户勾的、再退到
//     `:256-258` 的 `setDefaultToFocus`、`:292-296` `General.focusOnCondition` 是**空 map**
//     ⇒ **默认没有任何 Content 被标**，也就是默认不夺焦。
//   · 消费点 `platform/execution-impl/src/com/intellij/execution/ui/layout/impl/RunnerContentUi.java`
//     `:1813-1833`（`addNotify` 里只在**这份 UI 第一次被挂上**时排一次 `attractOnStartup()`）、
//     `:1858-1866`（`attractByCondition(LayoutViewOptions.STARTUP, false)`）、
//     `:1880-1889`（`processAttraction(myLayoutSettings.getToFocus(condition), …)`，
//     第一行就是 `if (contentId == null) return;` ⇒ 没标就等于什么都不做）。
//     默认聚焦策略 `platform/execution/src/com/intellij/execution/ui/layout/LayoutStateDefaults.java:24-26`
//     （`FocusOnce`，见 `RunnerLayout.java:269-272`）。
//   ⇒ 本仓运行视图是**一条扁平实例标签**，没有 `RunnerLayoutUi` 的 Content 格可标 ⇒ 这条 id 仍然
//     不渲染（登记在 `src/runToolWindowLayout.ts` 的 `RUNNER_VIEW_ACTIONS_NOT_PORTED`）。
//
// 而**用户真正感知到的**「启动运行实例时把焦点移到运行面板」不是那条 id，是运行配置上的两个开关
// （上游 `Before launch` 面板的两格，文案在
//  `platform/execution/resources/messages/ExecutionBundle.properties:175-176`
//  「Open run/debug tool window when started」/「Focus run/debug tool window when started」，
//  另有 `:347-348` 「Activate tool window」/「Focus tool window」是 Run/Debug 配置页上的同义标签）：
//   · 声明 `platform/execution/src/com/intellij/execution/RunnerAndConfigurationSettings.java:242`
//     （`isActivateToolWindowBeforeRun`）、`:246`（setter）、`:256`（`isFocusToolWindowBeforeRun`）。
//   · 默认 `platform/execution-impl/src/com/intellij/execution/impl/RunnerAndConfigurationSettingsImpl.kt:108-109`
//     —— `isActivateToolWindowBeforeRun = true`、`isFocusToolWindowBeforeRun = false`
//     ⇒ **默认「打开面板」为真、「夺焦」为假**，与 `RunContentDescriptor.java:50`
//     （`myActivateToolWindowWhenAdded = true`）、`:52`（`mySelectContentWhenAdded = true`）、
//     `:55`（`myAutoFocusContent = false`）三行默认一致。
//   · 存档属性名 `RunnerAndConfigurationSettingsImpl.kt:61-62`（`activateToolWindowBeforeRun` /
//     `focusToolWindowBeforeRun`），读档 `:242-244`（**缺 `activate` 属性按 true**：`value == null || value.toBoolean()`；
//     缺 `focus` 属性按 false：`getAttributeBooleanValue`），写档 `:317-321`（只在非默认时落盘）。
//     本仓的 `resolveRunStartupFocusFlags()` 就是照这两行读档语义写的：旧存档缺键补上游默认，不按字段数量判损坏。
//   · 落到 descriptor：`platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt:290-293`
//     `isActivateToolWindowWhenAdded = activate || focus`、`isAutoFocusContent = focus`。
//   · 执行：`platform/execution-impl/src/com/intellij/execution/ui/RunContentManagerImpl.kt`
//     `:432-435`（选中：`isSelectContentWhenAdded ||` 复用来的标签本来就选中 ⇒ `setSelectedContent`）、
//     `:439-441`（`if (!isActivateToolWindowWhenAdded) return;` ⇒ 连面板都不碰，更谈不上夺焦）、
//     `:450-457`（`focus = isAutoFocusContent`；**但若此刻整个 IDE 没有焦点所有者**
//     ——`KeyboardFocusManager…focusOwner == null`，即焦点原本就在被我们换掉的这块视图里——
//     **则强制 focus = true**，「没有焦点所有者毫无用处」是上游注释原话）、
//     `:458`（`activate(callback, focus, focus)`）。
//   · 标签新建还是复用：`:296` 调 `chooseReuseContentForDescriptor(…)`，判定体 `:788-826`
//     （stage 一 `isContentReuseProhibited` ⇒ 直接不复用；stage 二 从 descriptor 自己的 attachedContent 拿；
//     stage 三 按名字挑），**总闸门**在 `:814` 与 `:854-856`
//     `canReuseContent = !isPinned && isTerminated && !(executionId 相同 && executionId != 0)`
//     ⇒ **还在跑的实例绝不会被复用**（`:862-867` `createNewContent` 另开一个标签），
//     已结束、未固定、且不是同一次执行的标签才被拿来改挂。
//     复用时 `:96-110` `copyContentAndBehavior` 只搬 `isActivateToolWindowWhenAdded`
//     （还要 `isReuseToolWindowActivation` 为真，`:102-104`）和 `isSelectContentWhenAdded`（`:108`）
//     —— **`isAutoFocusContent` 不在搬运清单里** ⇒ 夺焦与否只看设置，与「有没有已有标签」无关。
//     这就是判据第三档「设置开但实例已有」的上游答案。
//
// 本仓落点：`src/runActions.ts` 的 `startRun` 用 `activateToolWindow` 决定要不要 `showOutput('run')`
// （默认 true ⇒ 与接线前逐字相同）。`takeFocus` / `selectView` 的动作面在保留文件
// （`src/App.vue` 的 `focusToolWindowContent`、`src/components/RunConsole.vue` 的标签切换）里，
// 本代理改不到 ⇒ 可照抄的整段替换代码写在 `docs/wiring-requests-2026-10-06-exec2.md` W1/W2。
// `createNewTab` 本仓恒为真：每个实例由宿主给一个新 id（`native/run_host.cpp` 的并行实例），
// 「已结束标签的复用」在这里没有对应物 ⇒ 只把判定算出来并**在请求里**交给宿主，不在前端假装有复用。

import type { StorageLike } from './runToolWindowLayout.ts'

/** 上游 `RunnerAndConfigurationSettingsImpl.kt:108`：`isActivateToolWindowBeforeRun = true`。 */
export const ACTIVATE_TOOL_WINDOW_DEFAULT = true
/** 上游 `RunnerAndConfigurationSettingsImpl.kt:109`：`isFocusToolWindowBeforeRun = false`。 */
export const FOCUS_TOOL_WINDOW_DEFAULT = false

/** 运行面板此刻已有的一个视图（上游的一个 `Content`）。 */
export interface RunStartupView {
  /** 进程还在跑（上游 `RunContentManagerImpl.kt:113-116` `isTerminated` 的反面）。 */
  running: boolean
  /** `Content.isPinned()`；本仓运行视图恒 false（见 `src/runToolWindowLayout.ts` 文件头）。 */
  pinned?: boolean
  /** 它就是当前选中的那个标签（`RunContentManagerImpl.kt:432-435` 的后半个条件）。 */
  selected?: boolean
  /** 已经是**这一次执行**自己的标签（`canReuseContent` 里 `executionId` 相同那一条，`:854-856`）。 */
  sameExecution?: boolean
}

export interface RunStartupFocusInput {
  /** 设置值「启动时打开运行面板」（上游 `isActivateToolWindowBeforeRun`）。 */
  activateToolWindowBeforeRun: boolean
  /** 设置值「启动时把焦点移到运行面板」（上游 `isFocusToolWindowBeforeRun`）。 */
  focusToolWindowBeforeRun: boolean
  /** 当前是否已有这个实例的活动页；没有就传 null。 */
  existingView: RunStartupView | null
  /** `RunContentDescriptor.java:52` 的 `mySelectContentWhenAdded`，上游默认 true。 */
  selectContentWhenAdded?: boolean
  /** `RunContentManagerImpl.kt:451-457`：整个应用此刻没有焦点所有者。 */
  focusOwnerMissing?: boolean
}

export interface RunStartupFocusDecision {
  /** 要不要把运行面板打开（上游 `isActivateToolWindowWhenAdded`）。 */
  activateToolWindow: boolean
  /** 要不要把键盘焦点移进面板（上游 `activate(…, focus, focus)` 的那个 focus）。 */
  takeFocus: boolean
  /** 要不要把这一格的标签切到选中（上游 `setSelectedContent`）。 */
  selectView: boolean
  /** 要不要新建标签；false = 复用已有那一格。 */
  createNewTab: boolean
}

/** 上游 `canReuseContent`（`RunContentManagerImpl.kt:854-856`）的正面表述。 */
function canReuseView(view: RunStartupView): boolean {
  return !view.pinned && !view.running && !view.sameExecution
}

/**
 * 唯一的判定入口：输入「两个设置值 + 已有视图的形状」，输出「夺焦 / 打开 / 选中 / 新建」。
 * 没有副作用、不读存储、不认识 Vue —— 组件与宿主只负责照着这四个布尔动。
 */
export function decideRunStartupFocus(input: RunStartupFocusInput): RunStartupFocusDecision {
  const selectWhenAdded = input.selectContentWhenAdded !== false
  // ExecutionManagerImpl.kt:291 —— 「打开」是「聚焦」的超集：只想夺焦也想打开。
  const activate = input.activateToolWindowBeforeRun || input.focusToolWindowBeforeRun
  const createNewTab = input.existingView === null || !canReuseView(input.existingView)
  return {
    activateToolWindow: activate,
    // RunContentManagerImpl.kt:450-457 —— 没走到 `activate(…)` 之前那个 return（`:439-441`）就谈不上夺焦，
    // 所以 focusOwner 缺失这一档要挂在 activate 之下；除此之外只看设置，与「有没有已有标签」无关。
    takeFocus: activate && (input.focusToolWindowBeforeRun || input.focusOwnerMissing === true),
    // RunContentManagerImpl.kt:432-435 —— 本来就在选中它时，即使 flag 没开也要再选一次。
    selectView: selectWhenAdded || input.existingView?.selected === true,
    createNewTab,
  }
}

/** 解析后的两个设置值（永远两个都是布尔，缺键补上游默认）。 */
export interface RunStartupFocusFlags {
  activateToolWindowBeforeRun: boolean
  focusToolWindowBeforeRun: boolean
}

/**
 * 缺键补默认，形状与 `RunnerAndConfigurationSettingsImpl.kt:242-244` 一致：
 * `activate` 缺省为 true、`focus` 缺省为 false；非布尔的脏值退回默认而不是抛、也不判整份存档坏。
 */
export function resolveRunStartupFocusFlags(source: unknown): RunStartupFocusFlags {
  const raw = source && typeof source === 'object' && !Array.isArray(source)
    ? source as Record<string, unknown>
    : {}
  const pick = (key: string, fallback: boolean): boolean =>
    typeof raw[key] === 'boolean' ? raw[key] as boolean : fallback
  return {
    activateToolWindowBeforeRun: pick('activateToolWindowBeforeRun', ACTIVATE_TOOL_WINDOW_DEFAULT),
    focusToolWindowBeforeRun: pick('focusToolWindowBeforeRun', FOCUS_TOOL_WINDOW_DEFAULT),
  }
}

/** 与 `src/runToolWindowLayout.ts` 的 `taocode.runnerLayout` 同一套本地载体（设置页在保留文件里，见请求 W2）。 */
export const RUN_STARTUP_FOCUS_KEY = 'taocode.runStartupFocus'

/** 本仓惯例的存储载体（`src/consoleEncoding.ts:61-70` 同款：不传就退到 `localStorage`，取不到就当没有）。 */
function focusStore(store: StorageLike | undefined): StorageLike | undefined {
  if (store) return store
  try { return typeof localStorage !== 'undefined' ? localStorage : undefined } catch { return undefined }
}

/** 读回两个开关；没有记录、存储坏了、记录坏了都退回上游默认。 */
export function readRunStartupFocus(store?: StorageLike): RunStartupFocusFlags {
  try {
    const raw = focusStore(store)?.getItem(RUN_STARTUP_FOCUS_KEY)
    if (raw === null || raw === undefined) return resolveRunStartupFocusFlags(undefined)
    return resolveRunStartupFocusFlags(JSON.parse(raw) as unknown)
  } catch {
    return resolveRunStartupFocusFlags(undefined)
  }
}

/** 写回（只在非默认时落键，学 `RunnerAndConfigurationSettingsImpl.kt:317-321`，旧存档不会被越写越大）。 */
export function writeRunStartupFocus(store: StorageLike | undefined, flags: RunStartupFocusFlags): void {
  const stored: Partial<RunStartupFocusFlags> = {}
  if (flags.activateToolWindowBeforeRun !== ACTIVATE_TOOL_WINDOW_DEFAULT) {
    stored.activateToolWindowBeforeRun = flags.activateToolWindowBeforeRun
  }
  if (flags.focusToolWindowBeforeRun !== FOCUS_TOOL_WINDOW_DEFAULT) {
    stored.focusToolWindowBeforeRun = flags.focusToolWindowBeforeRun
  }
  try { focusStore(store)?.setItem(RUN_STARTUP_FOCUS_KEY, JSON.stringify(stored)) } catch { /* 存储不可用只影响持久化 */ }
}
