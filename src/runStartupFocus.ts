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
//   · 声明 `platform/execution/src/com/intellij/execution/RunnerAndConfigurationSettings.java`
//     `:235`（`setActivateToolWindowBeforeRun`）、`:242`（`isActivateToolWindowBeforeRun`）、
//     `:249`（`setFocusToolWindowBeforeRun`）、`:256`（`isFocusToolWindowBeforeRun`）
//     —— 四个方法都在**每条配置**的接口上。（订正：本文件旧注释写的「`:242`（isActivate…）、`:246`（setter）」
//     里那条 `:246` 打开后是 javadoc 的一行、不是 setter，真身在 `:235`；2026-10-06 execui 逐行核过。）
//   · 默认 `platform/execution-impl/src/com/intellij/execution/impl/RunnerAndConfigurationSettingsImpl.kt:108-109`
//     —— `isActivateToolWindowBeforeRun = true`、`isFocusToolWindowBeforeRun = false`
//     ⇒ **默认「打开面板」为真、「夺焦」为假**，与 `RunContentDescriptor.java:50`
//     （`myActivateToolWindowWhenAdded = true`）、`:52`（`mySelectContentWhenAdded = true`）、
//     `:55`（`myAutoFocusContent = false`）三行默认一致。
//   · 存档属性名 `RunnerAndConfigurationSettingsImpl.kt:61-62`（`activateToolWindowBeforeRun` /
//     `focusToolWindowBeforeRun`），读档 `:243-244`（**缺 `activate` 属性按 true**：`value == null || value.toBoolean()`；
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
// ── 单一真源判决（2026-10-06 execui，主代理记在案的那条架构问题） ─────────────────────────
// 问题：本模块原先自带一份 **localStorage 载体**（`taocode.runStartupFocus`），而这两个开关在上游
// 是**挂在每条运行配置**上的设置项 ⇒ 两边都落就是两个真源，用户在两处改时行为以谁为准说不清。
// 结论：**上游只有一处存放，本仓的存放处是运行配置记录**（`RunConfig` 的两个字段），载体已删除。
// 证据（每条都亲自打开过；两套 UI ≠ 两个源）：
//   · 写字只经由那两个 setter：`RunnerAndConfigurationSettingsImpl.kt:212-222` 是唯一的字段写点。
//   · 老面板取值/回写：`BeforeRunStepsPanel.java:170-171`（建勾）、`:214-217`（reset 读记录）、
//     `:238-243`（`need…` 读勾），回到记录那一步在
//     `ConfigurationSettingsEditorWrapper.java:143-144` `settingsToApply.set…BeforeRun(...)`。
//   · 新 UI 的两个 tag：`BeforeRunFragment.java:28-42`，getter/setter lambda 也是同一对方法 ⇒
//     **两套界面写的是同一个对象**，不是两处存放。
//   · 界面之外还有谁写？全树 grep `setActivateToolWindowBeforeRun`/`setFocusToolWindowBeforeRun`
//     只剩三处，且都是「把别处的值灌进同一条记录」而非另开存储：外部系统任务
//     `ExternalSystemUtil.java:820`（builder 的一次性参数）、ForkedDebuggerThread.java:306、
//     以及测试 `RunConfigurationUsageCollectorTest.java:589`。读侧（`ExecutionManagerImpl.kt:291-292`、
//     `RunConfigurationTypeUsagesCollector.java:219-220`、`ExternalSystemRunnableState.java:391-392`、
//     `ShRunConfigurationProfileState.java:66`、dashboard 的 DTO 转发）都是**从这条记录读**。
//   · 唯一的「兜底链」是模板继承，不是第二个源：`RunnerAndConfigurationSettingsImpl.kt:455-461`
//     `importRunnerAndConfigurationSettings(template)` 把模板记录上的同两个字段拷进新配置 ⇒
//     优先级是 **配置记录 → 模板记录 → 硬默认（true/false）**，三级都从同一个入口
//     （本文件的 `resolveRunStartupFocusFlags`）解析，合并规则只有一处定义。
//     本仓对应：模板那一级在 `src/runConfigTemplates.ts`（`applyTemplate`），面板与 `startRun` 都读
//     `runStartupFocusFlagsOf(config)`；没有任何全局副本。
//   · 原载体**从来没有生产写入方**（`writeRunStartupFocus` 的全部引用只出现在它自己的判据里，
//     生产代码只调过 `readRunStartupFocus` ⇒ 用户从未真的在里面存过值），所以删掉它不丢任何用户设置，
//     也就不需要迁移脚本；这条由 `tests/run-startup-focus.test.mjs` 的「唯一真源」那两条判据钉住
//     （模块里不许再出现 localStorage / `taocode.runStartupFocus`）。
//
// 本仓落点：`src/runActions.ts` 的 `startRun` 用 `runStartupFocusFlagsOf(config)` 取那两个值，
// `activateToolWindow` 决定要不要 `showOutput('run')`（默认 true ⇒ 与接线前逐字相同）；
// 面板的读写在 `src/components/RunConfigurationsDialog.vue`（配置的 Configuration 页 + 类型模板页各一组，
// 与上游「两套 UI、一处存放」同形）。`takeFocus` 的键盘焦点动作面仍在保留文件
// （`src/App.vue:340` 的 `focusToolWindowContent`）⇒ 可照抄的整段在
// `docs/wiring-requests-2026-10-06-execui.md` W1。
// `createNewTab` 本仓恒为真：每个实例由宿主给一个新 id（`native/run_host.cpp` 的并行实例），
// 「已结束标签的复用」在这里没有对应物 ⇒ 只把判定算出来并**在请求里**交给宿主，不在前端假装有复用。

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
 * 那条设置的**唯一读取入口**：`source` 就是运行配置记录本身（`RunConfig`）。
 * 缺键补默认，形状与 `RunnerAndConfigurationSettingsImpl.kt:243-244` 一致：
 * `activate` 缺省为 true、`focus` 缺省为 false；非布尔的脏值退回默认而不是抛、也不判整份存档坏
 * （本仓出过「按字段数量判损坏把用户锁在项目外」的事故，这一条按**逐键**补）。
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

/**
 * 读**某条运行配置**上的那两个开关（= 上游 `RunnerAndConfigurationSettings.isActivateToolWindowBeforeRun()`
 * / `isFocusToolWindowBeforeRun()`，`RunnerAndConfigurationSettings.java:242`/`:256`）。
 *
 * 命名成单独一个入口是为了让「设置住在哪」在调用点上看得出来：参数是**配置记录**，
 * 不是任何全局载体。传 undefined（还没选中配置 / 自动发现的临时目标）⇒ 上游默认。
 */
export function runStartupFocusFlagsOf(config: unknown): RunStartupFocusFlags {
  return resolveRunStartupFocusFlags(config)
}

/**
 * 写那两个开关（= 上游 `setActivateToolWindowBeforeRun(value)` / `setFocusToolWindowBeforeRun(value)`，
 * `RunnerAndConfigurationSettings.java:235`/`:249`，实现
 * `RunnerAndConfigurationSettingsImpl.kt:212-222`）。
 *
 * **与上游同一条落盘规则**：只把**非默认**的值留在记录里
 * （`RunnerAndConfigurationSettingsImpl.kt:317-321` —— `if (!isActivateToolWindowBeforeRun) setAttribute(…, "false")` /
 * `if (isFocusToolWindowBeforeRun) setAttribute(…, "true")`），
 * 所以「用户又勾回默认」不会让配置记录越写越大，也不会留下一条与「从没设过」行为不同的键。
 * 返回**新对象**（不改入参）：调用方是面板的保存路径，Vue 侧要的是换引用而不是原地改。
 */
export function withRunStartupFocusFlags<C extends Partial<RunStartupFocusFlags>>(config: C, flags: RunStartupFocusFlags): C {
  const next: Record<string, unknown> = { ...config }
  if (flags.activateToolWindowBeforeRun !== ACTIVATE_TOOL_WINDOW_DEFAULT) next.activateToolWindowBeforeRun = flags.activateToolWindowBeforeRun
  else delete next.activateToolWindowBeforeRun
  if (flags.focusToolWindowBeforeRun !== FOCUS_TOOL_WINDOW_DEFAULT) next.focusToolWindowBeforeRun = flags.focusToolWindowBeforeRun
  else delete next.focusToolWindowBeforeRun
  return next as C
}

