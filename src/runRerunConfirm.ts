// 「不允许并行的配置正在跑 ⇒ 要不要先问一句再停掉它」——上游 `ExecutionManagerImpl.restartRunProfile`
// 里的那道**确认闸**（`platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt:605-646`）。
//
// 判词来源：`docs/inventory/verdict-execution-debug.md` 的 `exec/run-instances` 一族，
// 以及上一批如实登记的缺口（`docs/wiring-requests-2026-10-06-runinst.md` §R4 的 ②、
// 与 `:234` 那句「非并行配置重跑时那几句问话（本仓现在是直接停，不问）」）。
//
// 上游这段逐行（2026-10-06 execui2 每条都自己 `sed -n` 打开核过）：
//   · 闸门本体 `ExecutionManagerImpl.kt:617-618`
//     `runningOfTheSameType = if (configuration != null && !configuration.configuration.isAllowRunningInParallel)
//        getRunningDescriptors(Condition { it.isOfSameType(configuration) })`
//     ⇒ **只有「这条配置不允许并行」时才去数同名在跑的实例**；「哪几格算同一条配置」= `isOfSameType`
//     （同文件 `:1033-1045`，比的是配置对象本身，不是显示名）。
//   · 「哪些算在跑」`ExecutionManagerImpl.kt:962-973` `getRunningDescriptors`：
//     判据是 `processHandler != null && !processHandler.isProcessTerminated`，
//     而 `!isProcessTerminating()` 那半条在同一行里是**注释掉的**（`:968`）
//     ⇒ **已经在结束途中的那格也算在跑**，照样要问。（本仓对应 `RunInstanceRecord.running`
//     —— 它到 `run.exit` 才落下，见 `src/runInstances.ts` 的 `handleRunExit`，同一档。）
//   · 要不要问的条件 `:627-631`：`runningToStop` 非空 **且** `runningOfTheSameType` 非空 **且**
//     （条数 > 1 **或** `contentToReuse == null` **或** 第一条的 id != 要复用那格的 id）。
//     最后一档说的是「要新起的那一格就是要停的那一格本身」⇒ 这时停它不算意外，不问。
//   · 三分支 `:631-637`：配置自己可以通过 `RunConfiguration.restartSingleton(environment)`
//     （`platform/execution/src/com/intellij/execution/configurations/RunConfiguration.java:194-195`，
//     **默认 `ASK_AND_RESTART`**）改成「不问直接停」（`RESTART`）或「什么都不做」（`NO_FURTHER_ACTION`，枚举 `:203`）。
//   · 问答本体 `:1097-1128` `userApprovesStopForSameTypeConfigurations`：
//     开关 `RunManagerConfig.isRestartRequiresConfirmation()`
//     （`platform/execution-impl/src/com/intellij/execution/RunManagerConfig.java:51-53`，
//     读 advanced setting `confirm.rerun.with.termination`，**默认 true**：
//     `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1477`）；关掉时直接放行（`:1099-1101`）。
//     对话框是 `Messages.showOkCancelDialog(...)` **== Messages.OK** 才算答应（`:1121-1128`），
//     带一个「以后不再显示」的 `DoNotAskOption`（`:1104-1118`，勾选文案
//     `platform/platform-api/resources/messages/UIBundle.properties:1`
//     `dialog.options.do.not.show=Do not show this dialog in the future`）。
//   · 三句文案（`platform/execution/resources/messages/ExecutionBundle.properties`）：
//     标题 `:94` `process.is.running.dialog.title=Process ''{0}'' Is Running`；
//     正文 `:212` `rerun.singleton.confirmation.message=''{0}'' is not allowed to run in parallel.\n
//     Would you like to stop {1, choice, 1#the running one|2#{1, number} running instances}?`；
//     确认按钮 `:213` `rerun.confirmation.button.text=Stop and Rerun`；
//     取消按钮 `CommonBundle.getCancelButtonText()`（`platform/ide-core/src/com/intellij/CommonBundle.java:61-63`）
//     = `button.cancel`（`platform/ide-core/resources/messages/CommonBundle.properties:3` `Cancel`）。
//   · 答「取消」⇒ `return`（`:636`）：**整条启动就地结束**——不停旧的、不起新的、不碰面板。
//   · 答应了才走 `:644-646` 那个 `for (descriptor in runningToStop) { putUserData(TERMINATING_FOR_RERUN, true); stopProcess(descriptor) }`。
//
// 与本仓不等价的两处（如实登记，不编控件）：
//   · **`runningIncompatible` 那一档恒空**（`ExecutionManagerImpl.kt:613` → `:949-959`）：它要求运行配置实现
//     `CompatibilityAwareRunProfile.mustBeStoppedToRun(...)`，那是**插件**给的每类型钩子；本仓没有插件贡献点宿主
//     （同族判词第 ① 条），所以「不兼容的别的配置」这个概念在本仓不存在 ⇒ 这条闸只剩「同名在跑」那半边。
//     `restartSingleton()` 的三档同理（`:631-634`）：本仓所有配置都是同一张通用表单，恒走上游默认的
//     `ASK_AND_RESTART` ⇒ 不建模成入参，只在这里写清。
//   · **「以后不再显示」那个复选框没画**：`window.confirm` 只有「确定/取消」两个答案，画不出第三个勾选，
//     而上游那条勾选落的是**应用级** advanced setting（不是每条配置的设置），本仓现在没有能改它的面
//     （设置页与 `native/settings_schema.cpp` 都不在本车道可改面里）。
//     ⇒ 本模块**不新增任何持久化键**（没有生产写入方的存储就是死存储，见 `src/runStartupFocus.ts` 头部
//     那条「两个真源」判决的下场：载体被删）。`confirmationEnabled` 只做成**入参**并带上游默认 `true`，
//     设置页落地时由调用方把那条键传进来即可 ⇒ 要接的线写在 `docs/wiring-requests-2026-10-06-execui2.md` W1。
//
// 本仓落点：`src/runActions.ts` 的 `startRun` 在**动手之前**（`saveAll()` 之前，取消时一个副作用都不留）
// 调 `needsRerunConfirmation` → 要问就用本仓既有的确认通道 `window.confirm`
// （同族先例：`src/vcsActions.ts:64`、`src/helpActions.ts:86`、`src/commitChecks.ts:270-279`
// 那句「上游标题是对话框标题；`window.confirm` 没有标题栏，所以把它放第一行」）。
// 停旧实例那一步本来就在宿主里（`native/run_host.cpp:363-365` 按 label 静默停），
// 所以「问」必须发生在前端发出 `run.start` **之前**——问完再发，答「取消」就根本不发。
// 判据：`tests/run-rerun-confirm.test.mjs`。

/** 上游 `intellij.platform.ide.impl.xml:1477` 的 `default="true"` ⇒ 默认**要**问。 */
export const RERUN_CONFIRMATION_DEFAULT = true

/** 三句文案 + 那颗勾选：`ExecutionBundle.properties:94/:212/:213`、`CommonBundle.properties:3`、`UIBundle.properties:1`。 */
export const RERUN_CONFIRM_LABELS = {
  /** `process.is.running.dialog.title`（`:94`）——上游这是**对话框标题**。 */
  title: (name: string) => `进程『${name}』正在运行`,
  /** `rerun.singleton.confirmation.message`（`:212`），`{1,choice}` 的两档：1 = 「那一个」，>1 = 「N 个」。 */
  message: (name: string, count: number) =>
    `『${name}』不允许并行运行。\n要停止${count === 1 ? '正在运行的那一个' : `这 ${count} 个正在运行的实例`}吗？`,
  /** `rerun.confirmation.button.text`（`:213`）= `Stop and Rerun`。 */
  stopAndRerun: '停止并重新运行',
  /** `CommonBundle.getCancelButtonText()` = `button.cancel` = `Cancel`。 */
  cancel: '取消',
  /** `dialog.options.do.not.show`（`UIBundle.properties:1`）；本仓现在画不出这一格（见文件头）。 */
  doNotAsk: '以后不再显示此对话框',
} as const

/**
 * 给 `window.confirm` 的那一句：标题行 + 正文 + 两个按钮的对应关系。
 * `commitChecks.ts:275` 同一条做法（浏览器确认框没有标题栏 ⇒ 标题写在第一行），
 * 而**两颗按钮的语义必须写出来**，否则用户看到的是「确定/取消」，不知道「确定」= 停掉正在跑的那条。
 */
export function rerunConfirmationQuestion(name: string, count: number): string {
  return `${RERUN_CONFIRM_LABELS.title(name)}\n\n${RERUN_CONFIRM_LABELS.message(name, count)}`
    + `\n\n（确定 = ${RERUN_CONFIRM_LABELS.stopAndRerun}；取消 = 什么都不动，正在运行的那条继续跑。）`
}

/** 一条在跑的实例里本模块要看的三列（`RunInstanceRecord` 结构上就满足）。 */
export interface RunningInstanceLike {
  id: number
  label: string
  running: boolean
}

/**
 * 「同一条配置此刻还在跑的那几格」= 上游 `getRunningDescriptors(isOfSameType(configuration))`
 * （`ExecutionManagerImpl.kt:617-618` + `:962-973`）。
 *
 * 本仓的「同一条」按**配置的显示名**算：宿主停的就是按 label 配对的（`native/run_host.cpp:363-365`
 * `existing->label == label`），而 label 就是 `params.label = config.name`
 * （`src/runActions.ts` 的 `runStartParams`）⇒ 前端的判定与宿主的行为必须同一把尺子，
 * 否则会问一档宿主不停、或不停却问。上游比的是配置对象身份（`isOfSameType`），
 * 本仓配置按名字唯一（`src/runConfigurationSchema.ts` 的「运行配置名不能重复」）⇒ 等价。
 *
 * 顺序按 id 升序 = 起跑顺序（与 `runInstanceList()` 同一口径），上游那条 `first()` 取的就是这个序。
 * `running` 为假的不进（已退出的那格上游早就不在 running 表里了）；
 * 「点了关闭视图但进程还在结束途中」的**进**（`closed` 不影响，`running` 才是判据，
 * 与上游 `:968` 把 `!isProcessTerminating()` 注释掉同一档）。
 */
export function runningSameConfigIds(instances: readonly RunningInstanceLike[], configName: string): number[] {
  return instances.filter(instance => instance.running && instance.label === configName)
    .map(instance => instance.id)
    .sort((left, right) => left - right)
}

export interface RerunConfirmInput {
  /** 这条配置允不允许并行（上游 `RunConfiguration.isAllowRunningInParallel`，默认 false，`RunConfigurationOptions.kt:56`）。 */
  allowRunningInParallel: boolean
  /** `runningSameConfigIds()` 的结果（起跑顺序）。 */
  runningIds: readonly number[]
  /**
   * 上游 `environment.contentToReuse`（`:616`）。本仓**同名格的复用还没接**（判定在
   * `src/runInstances.ts` 的 `chooseReuseInstance`，挂载方案见 docs/wiring-requests-2026-10-06-runinst.md R3）
   * ⇒ 生产路径恒 `null`，也就是恒满足「要问」；接上之后这一档才有意义：新实例要占的那一格
   * 恰好就是准备停的那一格时，上游不问（`:630` 第三个条件）。
   */
  contentToReuseId?: number | null
  /** 那条应用级开关（`RunManagerConfig.java:51-53`）；缺省 = 上游默认 true。 */
  confirmationEnabled?: boolean
}

/**
 * 要不要问这一句（`:627-631` 的那个复合条件，`runningIncompatible` 那半边本仓恒空，见文件头）。
 * 四个条件**逐条可反证**，判据 `tests/run-rerun-confirm.test.mjs` 里每一条都配一个「不该问」的形状：
 *   ① 允许并行 ⇒ 一律不问（两条并排跑是用户要的）；
 *   ② 没有同名在跑 ⇒ 不问；
 *   ③ 开关被用户关掉 ⇒ 不问（上游 `:1099-1101` 直接 return true）；
 *   ④ 只有一格、且要复用的就是它 ⇒ 不问（`:630` 后半条）。
 */
export function needsRerunConfirmation(input: RerunConfirmInput): boolean {
  if (input.allowRunningInParallel) return false
  if (input.runningIds.length === 0) return false
  if (input.confirmationEnabled === false) return false
  const contentToReuse = input.contentToReuseId ?? null
  if (contentToReuse !== null && input.runningIds.length === 1 && input.runningIds[0] === contentToReuse) return false
  return true
}
