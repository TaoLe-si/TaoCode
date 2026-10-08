// 运行 / 构建 / 调试 / 外部工具 —— 从 App.vue 搬出的一域（165 行，18 个依赖）。
//
// 判据：这是一条完整的「启动链路」—— `runStartParams` 把当前运行配置整形成 `run.start` 的参数，
// `runToExit` 把事件流变成可等待的退出码（IDEA 的 Before launch 语义），`startRun` / `startBuild` /
// `runExternalTool` 都走同一条链路，`stopRun` / `stopAnyProcess` 负责收尾。调试走 DAP，
// 但选哪条配置、要不要先跑 before-launch，和运行是同一套判断，所以不拆开。
// IDEA 对应物：Run/Debug 工具窗口 + Build 菜单（CompileDirty / Compile）+ tools.externalTools。
import { computed, watch, type Ref } from 'vue'
import { activeRunInstance, beginRun, dapStart, dapState, endRun, request, runState, runInstanceList, type DocumentData, type GitAheadBehind,
         type JavaProjectSettings, type ProjectSettings, type RunConfig, type RunStartParams, type Workspace } from './bridge.ts'
import { errorMessage } from './errors.ts'
import { availableJdks, buildRequestOf, collectBuildInputs, javaDefaults } from './buildHost.ts'
import {
  LOCAL_TARGET_ID, activeExecutionTarget, applyTargetToTemplateProgram, listExecutionTargets,
  readActiveExecutionTargetId, targetById, type ExecutionTarget,
} from './executionTargets.ts'
import { loadTargetEnvironments } from './targetEnvironments.ts'
import { expandPathMacros, pathMacroTable, resolveModuleWorkingDir } from './pathMacros.ts'
import { buildPlan, compileFilesPlan, javacArgFilePath, runtimeOutputPaths } from './projectBuild.ts'
import { GRADLE_RUN_DEFAULTS, gradleCommand, gradleDirectoryTask, gradleTaskProjectDisplayName, gradleTaskShortName } from './gradle.ts'
import { loadTasksActivation, tasksForPhase, type TaskPhase } from './externalProjectModel.ts'
import { generateExternalSystemTaskName } from './externalSystemTask.ts'
import { afterBuildPhase, runActivatedAfterBuild, type ActivatedTaskStep } from './externalSystemAfterBuild.ts'
import { expandKnownToolMacros, unknownToolMacros } from './toolMacros.ts'
import { readClipboardText } from './clipboard.ts'
import { attachInputHistory, createCommandHistory } from './consoleInputHistory.ts'
// `markRunInstanceStopping` 不在 `src/bridge.ts` 的再导出清单里（那份文件是保留文件），
// 所以这里直接引真身 —— 与桥接层引的是同一个模块实例，状态不会分家。
// `runInstances` 同一条理由：确认闸要看的是**全部记录**（含「视图已关但进程还在结束途中」的那些），
// 而 `runInstanceList()` 会把 `closed` 的滤掉 ⇒ 只能读原始表，不能读那份清单。
import { markRunInstanceStopping, runInstances, runInterpreterCommand, setRunInstanceExecutor } from './runInstances.ts'
import { executionEnvironmentOf, executionListeners } from './executionListeners.ts'
// 「启动运行实例时打开/聚焦运行面板」的判定（纯函数，判据 tests/run-startup-focus.test.mjs）。
// 那两个开关读的是**这条运行配置记录**（上游 `RunnerAndConfigurationSettings.java:242/:256`），不是任何全局副本。
import { decideRunStartupFocus, runStartupFocusFlagsOf } from './runStartupFocus.ts'
// 「这条配置不允许并行、而它正在跑」时的那句确认（上游 ExecutionManagerImpl.kt:605-646，
// 判据 tests/run-rerun-confirm.test.mjs）。停旧实例的动作在宿主里（native/run_host.cpp:363-365 静默停），
// 所以这句必须问在发出 `run.start` **之前**。
import { needsRerunConfirmation, rerunConfirmationQuestion, runningSameConfigIds } from './runRerunConfirm.ts'
import { hasMainMethod, javaExecutable, javaRunArgs, javaRunCommand, mainClassFor } from './javaRun.ts'
import { isJarRunConfig, jarRunConfigParams } from './jarRun.ts'
import type { GradleDetection } from './gradle.ts'
import { parseRunArguments } from './runConfigTree.ts'; import { runCompound } from './runCompound.ts'
import type { RuntimeRunConfig } from './runTargets.ts'
import { DEBUG_EXECUTOR_ID, RUN_EXECUTOR_ID, resolveRunner } from './programRunners.ts'
import {
  DEBUG_TOOL_WINDOW_ID, executorById, executorStartActionText, resolveExecutor, toolWindowForExecutor,
  type ExecutorContribution,
} from './executors.ts'
import { runnerIdFor } from './programRunners.ts'
import {
  applyCommandLineToParams, commandLineOf, patchRunCommandLine,
} from './runConfigurationExtensions.ts'
import { beforeRunTasksFor, notifyBeforeRunDelegates, produceRunConfigurationFromContext, type ProducedRunConfiguration } from './executionExtensionPoints.ts'
import type { Tab } from './editorTab'

export interface RunActionsDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  workspace: Ref<Workspace | null>
  active: { readonly value: Tab | undefined }
  /** 控制台里手输的命令（宿主更早的阶段就要读写，所以留在宿主）。 */
  runCommand: Ref<string>
  runConfigProgram: Ref<string>
  runConfigName: Ref<string>
  runConfigs: { readonly value: RunConfig[] }
  projectSettings: Ref<ProjectSettings>
  /** 把「草稿态」的运行配置整形成一条完整配置（宿主更早的阶段就要用）。 */
  currentRunConfig: () => RunConfig
  showOutput: (id: 'run') => void
  /** 调试要把左栏切到 Debug 视图。 */
  explorer: Ref<boolean>
  leftView: Ref<any>
  runInput: Ref<HTMLInputElement | undefined>
  /** 启动前必须落盘，所以它是骨架里的函数 —— 必须惰性调用。 */
  saveAll: () => Promise<boolean>
  /** 「上次运行的参数」宿主是 `let`（运行菜单与外观动作也要读），用 getter/setter 共享同一份。 */
  lastRunParams: { value: RunStartParams | null }
  /** Gradle 检测结果 —— 「构建项目」要按项目类型分派（见 src/projectBuild.ts）。 */
  gradleDetection: { readonly value: GradleDetection | null }
  /** 写回项目设置（自动填 JDK / 编译输出目录时用）。 */
  saveJavaSettings: (java: JavaProjectSettings) => Promise<unknown>
  /**
   * 受信任项目门控（IDEA `TrustedProjects`，本仓判据在 src/trustedProjects.ts）：
   * 返回 `null` = 放行；字符串 = 未信任项目的可见原因，直接提示并中止本条动作。
   * 宿主 native/main.cpp 的 run.start 还有一道硬边界（前端被绕开也执行不了）。
   */
  trustBlock: (action: string) => string | null
}

/**
 * 交给运行配置扩展的配置面（上游 `RunConfigurationBase` 的可移植视图）。用宽接口而不是 `RunConfig`，
 * 是因为上下文生成的临时配置（`RunTargets` 那两条链路）不是完整的 `RunConfig`，但同样要过扩展那条路。
 */
interface ExtensionConfigLike {
  name: string
  type?: string
  command: string
  program?: string
  args?: readonly string[]
  cwd?: string
  env?: readonly string[]
}

export function createRunActions(deps: RunActionsDeps) {
  const { notify, isDesktop, workspace, active, runCommand, runConfigProgram, runConfigName, runConfigs,
          projectSettings, currentRunConfig, showOutput, explorer, leftView, runInput, saveAll, lastRunParams,
          gradleDetection, saveJavaSettings, trustBlock } = deps
  /** 未信任项目：任何执行入口在动手之前先问一句，拦住时把原因说给用户听。 */
  function blocked(action: string): boolean {
    const reason = trustBlock(action)
    if (!reason) return false
    notify(reason, true)
    return true
  }
  /**
   * 执行器那一档的判定（上游 `Executor.isApplicable(Project)` / `isSupportedOnTarget()`：
   * 前者为假时上游**隐藏动作**，后者决定这条执行器能不能跑在运行目标上）。判定与文案都在
   * `src/executors.ts` 的 `ExecutorRegistry.resolve`；内建 Run/Debug 两条恒放行 ⇒ 只内建时
   * 行为与之前逐字一致。第三方按 `com.intellij.executor` 覆盖/新增执行器后，这里就是它的真实消费点。
   */
  function selectExecutor(id: string) {
    return resolveExecutor(id, {
      root: workspace.value?.root ?? null,
      name: workspace.value?.name ?? null,
      // 活动目标不是本机目标时，`isSupportedOnTarget()` 才有意义（上游 `RunOnTargetPanel` 那条链路）。
      onTarget: readActiveExecutionTargetId() !== LOCAL_TARGET_ID,
    })
  }
  /**
   * 打开这条执行器的工具窗口（上游 `Executor.getToolWindowId()` 的真实消费点：`ToolWindowId.RUN`
   * 进运行工具窗口、`ToolWindowId.DEBUG` 进调试工具窗口）。内建两条与之前那两条硬编码路径
   * （运行 `showOutput('run')` / 调试 `explorer=true; leftView='debug'`）逐字一致。
   */
  function showExecutorToolWindow(executor: ExecutorContribution | undefined): void {
    if (toolWindowForExecutor(executor) === DEBUG_TOOL_WINDOW_ID) {
      explorer.value = true
      leftView.value = 'debug'
      return
    }
    showOutput('run')
  }
  /** 扩展看到的配置面（快照；上游 `RunConfigurationExtension` 收 `RunConfigurationBase`）。 */
  function extensionConfigOf(config: ExtensionConfigLike) {
    return {
      name: config.name, type: config.type, command: config.command, program: config.program,
      args: config.args, cwd: config.cwd, env: config.env,
    }
  }
  /**
   * 调试那条通道的补丁位（上游 `RunConfigurationExtension.patchCommandLine` 在起进程前改
   * `GeneralCommandLine`；调试的适配器命令行同样是那条线的一份）。返回改过的 program/args/env，
   * 或一句「为什么这次调试被取消」。
   */
  function patchDebugLaunch(config: ExtensionConfigLike, executorId: string, program: string, args: readonly string[], env: readonly string[] | undefined, cwd: string) {
    const cmdLine = commandLineOf({ command: '', program, args, cwd, env, shell: false })
    const patch = patchRunCommandLine(extensionConfigOf(config), cmdLine, {
      runnerId: runnerIdFor(executorId, config), executorId,
    })
    if (patch.error) return { error: patch.error, program, args: [...args], env: [...(env ?? [])], cwd }
    return { error: null, program: cmdLine.program ?? program, args: cmdLine.args, env: cmdLine.env, cwd: cmdLine.cwd ?? cwd }
  }
// 控制台输入历史（上游 CommandHistory + HistoryKeyListener，见 src/consoleInputHistory.ts）：
// stdin 输入框在 App.vue（本批冻结），所以这里在 runInput 元素出现时挂监听 —— 上下键翻历史，
// 回车发送时 push。这是「不碰冻结文件也能接进真实链路」的挂点。
const inputHistory = createCommandHistory()
let detachInputHistory: (() => void) | undefined
watch(runInput, element => {
  detachInputHistory?.()
  detachInputHistory = element ? attachInputHistory(element, inputHistory) : undefined
}, { immediate: true })
// The whole configuration is sent, not just the command: program/args/cwd/env and
// the before-launch steps are what make a run configuration a configuration.
function runStartParams(label?: string, config: RunConfig = currentRunConfig()): RunStartParams {
  const launchConfig = expandRunConfigMacros(config)
  const params: RunStartParams = { command: launchConfig.command }
  if (launchConfig.program) params.program = launchConfig.program
  if (launchConfig.args?.length) params.args = launchConfig.args
  if (launchConfig.cwd) params.cwd = launchConfig.cwd
  if (launchConfig.env?.length) params.env = launchConfig.env
  // JAR 与 application 同一档：program + argv 直接起进程，不再过一次 shell（路径里的空格会被切坏）。
  params.shell = launchConfig.type !== 'application' && launchConfig.type !== 'jar'
  if (isJarRunConfig(launchConfig)) {
    // JAR 折算成 `java -jar <路径> …` 的 argv（VM 参数 → -jar 路径 → 程序参数，与 `jarRunArgs` 同形）；
    // 缺 JAR 路径 / 既没填 Java 可执行文件也没有项目 JDK ⇒ 抛错，不起一条空命令行。
    // 「留空退到项目 JDK」= 上游 `JarApplicationCommandLineState.java:20-21` 的 `createProjectJdk(project, jreHome)`。
    const launch = jarRunConfigParams(launchConfig, { jdkHome: projectSettings.value.java.jdkHome ?? '' })
    params.program = launch.program
    params.args = launch.args
  }
  if (label || config.name) params.label = label || config.name
  if (config.beforeLaunch?.length) params.beforeLaunch = config.beforeLaunch.map(step => ({ ...step }))
  params.allowParallel = config.allowRunningInParallel === true
  return params
}
function expandRunConfigMacros(config: RunConfig): RunConfig {
  const project = workspace.value
  const table = pathMacroTable({ projectDir: project?.root, projectName: project?.name ?? undefined })
  const expand = (value: string) => expandPathMacros(value, table)
  const expanded: RunConfig = { ...config, command: expand(config.command) }
  if (config.program !== undefined) expanded.program = expand(config.program)
  if (config.args) expanded.args = config.args.map(expand)
  if (config.cwd !== undefined) {
    const workingDirectory = expand(config.cwd).split('%MODULE_WORKING_DIR%').join('$MODULE_WORKING_DIR$')
    expanded.cwd = resolveModuleWorkingDir(workingDirectory, undefined, project?.root)
  }
  if (config.env) expanded.env = config.env.map(line => {
    const index = line.indexOf('=')
    return index < 1 ? line : `${line.slice(0, index + 1)}${expand(line.slice(index + 1))}`
  })
  return expanded
}
/**
 * 工具栏上选的**活动执行目标**（`ExecutionTargetsToolbarGroup` → `ExecutionTargets`，
 * `ExecutionTargetComboBoxAction.kt:162-164` 的 `setActiveTarget`）落到启动参数上：
 * 目标挂的运行时与配置现有程序同形态时，把它换成该运行时的可执行文件
 * （`applyTargetToTemplateProgram` 的同一口径 —— 上游「换目标 = 换运行时」）。
 * 本机目标或形态不匹配时**不动**（上游对不匹配的配置也不换，返回空对象）。
 * 目标清单要读 `app.jdks`（异步），所以这一步是异步的，挂在真正发起 `run.start` 之前。
 */
async function applyActiveRunTarget(params: RunStartParams, config: RunConfig): Promise<void> {
  const target = await activeRunTarget(config)
  if (!target) return
  const program = applyTargetToTemplateProgram(config, target).program
  if (!program) return
  params.program = program
  params.command = ''
}
/** 活动目标（`ExecutionTargetManager.getActiveTarget`）：本机目标返回 undefined（=不换）。 */
async function activeRunTarget(config?: RunConfig): Promise<ExecutionTarget | undefined> {
  const id = readActiveExecutionTargetId()
  if (id === LOCAL_TARGET_ID) return undefined
  const targets = listExecutionTargets(await availableJdks(), {
    custom: loadTargetEnvironments(typeof localStorage === 'undefined' ? undefined : localStorage, workspace.value?.root ?? '').targets,
    // EP 贡献的目标（`com.intellij.executionTargetProvider` / `com.intellij.executionTargetType`）
    // 拿到的工作区/配置面 —— 上游 `getTargets(project, runConfiguration)` 的两格。
    project: { root: workspace.value?.root ?? null, name: workspace.value?.name ?? null },
    profile: config ? { name: config.name, type: config.type, program: config.program, command: config.command } : undefined,
  })
  const target = targetById(targets, id)
  return target && target.kind !== 'local' ? target : undefined
}
// Run one command to completion and hand back its exit code. run.output/run.exit
// arrive as events; this watcher is what turns that stream into an awaitable so
// before-launch tasks can gate the real run (IDEA's Before launch semantics).
/** 等宿主报某个运行实例退出并给退出码（`run.exit` 事件流 → 可等待的退出码）。 */
function runExitCode(instance: number): Promise<number> {
  const outcome = () => {
    const entry = runInstanceList().find(item => item.id === instance)
    return entry && !entry.running ? entry.exit : null
  }
  const already = outcome()
  if (already !== null) return Promise.resolve(already)
  return new Promise<number>(resolve => { const stop = watch(outcome, code => { if (code !== null) { stop(); resolve(code) } }) })
}
async function runToExit(params: RunStartParams): Promise<number> {
  if (blocked('构建 / 运行')) return -1
  try {
    const started = await request<{ instance: number }>('run.start', { ...params })
    if (!started?.instance) return -1
    beginRun(started.instance)
    // runState.exit mirrors the selected tab; it is not ownership of this before-launch/build process.
    return await runExitCode(started.instance)
  } catch { return -1 }
}
/** 跑一条激活任务（构建前折进前置链、构建后走独立链路，共用这一份命令生成）。 */
async function runActivatedStep(step: ActivatedTaskStep): Promise<boolean> {
  const exit = await runToExit({ command: step.command, shell: true, label: step.name, cwd: workspace.value?.root })
  return exit === 0
}
// 外部系统任务的**阶段激活**执行点（上游 `ExternalSystemTaskActivator.Phase`）：
// 用户在 Gradle 面板把任务勾到某个阶段后，对应时机由这里触发 —— 落成运行配置链的前置步骤
// （`ExternalSystemBeforeRunTask` 的等价物；宿主 native/run_host.cpp 已支持 beforeLaunch 链）。
// 「运行前」接在运行/调试前，「编译前 / 重建前」接在构建前；同步前/同步后在 `src/gradleHost.ts`。
// 默认激活表为空 ⇒ 对既有行为零影响；只在 Gradle 工程上生效。
/** 读激活表：某阶段第一个有任务的外部工程（表按链接目录分键，取第一份命中的）。 */
function activationTasksFor(phase: TaskPhase): Array<{ task: string; directory: string }> {
  const root = workspace.value?.root
  if (!root || typeof localStorage === 'undefined') return []
  for (const [directory, state] of Object.entries(loadTasksActivation(localStorage, root))) {
    const tasks = tasksForPhase(state, phase)
    if (tasks.length) return tasks.map(task => ({ task, directory }))
  }
  return []
}

/** 激活任务 → 运行链的前置步骤（`ExternalSystemBeforeRunTask` 的等价物）。 */
function activatedSteps(phase: TaskPhase): ActivatedTaskStep[] {
  const detection = gradleDetection.value
  if (!detection?.isGradle) return []
  const settings = projectSettings.value.buildTools?.gradle ?? GRADLE_RUN_DEFAULTS
  return activationTasksFor(phase).map(({ task, directory }) => ({
    name: generateExternalSystemTaskName({ projectName: gradleTaskProjectDisplayName(task, directory), taskNames: [gradleTaskShortName(task)] }),
    command: gradleCommand(detection, settings, gradleDirectoryTask(task, directory)),
  }))
}

function activatedBeforeRunSteps(): ActivatedTaskStep[] { return activatedSteps('beforeRun') }
function activatedBuildSteps(rebuild: boolean): ActivatedTaskStep[] {
  return activatedSteps(rebuild ? 'beforeRebuild' : 'beforeCompile')
}
/** 构建后那一档（上游 `Phase.AFTER_REBUILD`/`AFTER_COMPILE`，与 before 三档共用同一张激活表）。 */
function activatedAfterBuildSteps(rebuild: boolean): ActivatedTaskStep[] { return activatedSteps(afterBuildPhase(rebuild)) }
async function startRun(config: RunConfig = currentRunConfig(), executorId: string = RUN_EXECUTOR_ID) {
  if (blocked('构建 / 运行')) return null
  const root = workspace.value?.root
  if (!config.command.trim() && !config.program?.trim()) { notify('请输入要运行的命令或可执行程序。', true); return }
  // 执行器（上游 `com.intellij.executor` 的 `Executor.EXECUTOR_EXTENSION_NAME` + `ExecutorRegistry`）：
  // 这条运行走的是哪条执行器由注册表说了算 —— 没注册 ⇒ 挡住并说明；`isApplicable` 为假 ⇒ 与上游
  // 隐藏动作同档，这里给一句可见原因。内建 Run 恒放行 ⇒ 只内建时行为与之前逐字一致。
  const selection = selectExecutor(executorId)
  if (!selection.executor) { notify(selection.reason, true); return null }
  const executor = selection.executor
  // 上游 `ExecutionManagerImpl.kt:627-637`：这条配置**不允许并行**而同名实例还在跑时，先问一句
  // 「要停止正在运行的那一个吗？」，答「取消」就 `return` —— **不停旧的、不起新的、连面板都不碰**（`:636`）。
  // 本仓原来没有这一句：宿主在 `run.start` 里按 label 静默停掉同名实例（native/run_host.cpp:363-365），
  // 于是用户按一下就把自己正在跑的长任务杀了。这句问必须放在**任何副作用之前**：
  // `saveAll()` 会写用户的文件，答「取消」时不该已经写掉了 ⇒ 排在它前面。
  // `confirmationEnabled` 那条应用级开关本仓还没有能改它的面 ⇒ 恒走上游默认 true（见 src/runRerunConfirm.ts 头部）。
  const runningSame = runningSameConfigIds([...runInstances.values()], config.name)
  if (needsRerunConfirmation({ allowRunningInParallel: config.allowRunningInParallel === true, runningIds: runningSame })) {
    if (!window.confirm(rerunConfirmationQuestion(config.name, runningSame.length))) return null
  }
  if (!await saveAll()) { notify('请先保存修改再运行。', true); return }
  if (workspace.value?.root !== root) return
  // 「启动时打开运行面板」= 上游**这条运行配置**上的那两个开关（`RunnerAndConfigurationSettingsImpl.kt:108-109`
  // 默认 activate=true / focus=false，`ExecutionManagerImpl.kt:290-293` 合成 descriptor 的
  // `isActivateToolWindowWhenAdded`，`RunContentManagerImpl.kt:439-441` 为假就根本不碰面板）。
  // 判定本身在 `src/runStartupFocus.ts`（纯函数）；这里的 `existingView` 按下面的 label 规则
  // （`params.label = label || config.name`）找同名配置还没被关掉的那一格。
  // 四个输出里本文件可做的事是「打开面板」；`takeFocus` 要调 App.vue 的 `focusToolWindowContent`
  // （保留文件 ⇒ docs/wiring-requests-2026-10-06-execui.md W1）。默认值是 true ⇒ 接线前后面板照常打开。
  const sameName = runInstanceList().find(instance => instance.label === config.name)
  const startup = decideRunStartupFocus({
    // 那两个开关读的是**这条配置**（上游 `RunnerAndConfigurationSettings.java:242`/`:256`，
    // 每条配置一份；缺键按 `RunnerAndConfigurationSettingsImpl.kt:108-109` 补 true/false）。
    // 本仓没有第二份存放：曾经那个 localStorage 载体已删（判决与证据在 `src/runStartupFocus.ts` 头部）。
    ...runStartupFocusFlagsOf(config),
    existingView: sameName ? { running: sameName.running, selected: sameName.id === activeRunInstance.value } : null,
  })
  if (startup.activateToolWindow) showExecutorToolWindow(executor)
  // 「Before launch」的整条链现在由**宿主**跑（native/run_host.cpp）：前端只把 beforeLaunch 一起发过去，
  // 这样链是**一个实例**、退出一致、并且每个实例有自己的链状态（原来前端逐条跑，多实例会互相踩）。
  //
  // 「已有任务在运行」不再是前端的一道闸：IDEA 由 `ExecutionManagerImpl.kt:613-619` 按配置决定 ——
  // `isAllowRunningInParallel` 为假时停掉同名实例，为真时并存。宿主照这条规则做（见 run_host.hpp）。
  const params: RunStartParams = runStartParams(undefined, config)
  const activated = activatedBeforeRunSteps()
  if (activated.length) params.beforeLaunch = [...(params.beforeLaunch ?? []), ...activated]
  // 插件贡献的启动前任务（上游 `com.intellij.stepsBeforeRunProvider` 的 `BeforeRunTaskProvider`）：
  // 内建没有 bundled 贡献 ⇒ 无插件时这里是空数组（行为与之前逐字相同）；第三方按同一 EP id 挂进来
  // 即并入同一条 `beforeLaunch` 链（与内建激活任务同口径：`name` + `command`）。
  const pluginTasks = beforeRunTasksFor({
    name: config.name, type: config.type, command: config.command, program: config.program, cwd: config.cwd,
  })
  if (pluginTasks.length) params.beforeLaunch = [...(params.beforeLaunch ?? []), ...pluginTasks.map(task => ({ name: task.name, command: task.command }))]
  // 启动前代理（上游 `com.intellij.runConfigurationBeforeRunProviderDelegate` 的 `beforeRun(env)`）：
  // 上游在启动前任务**之前**把环境交给代理；本仓同样排在 beforeLaunch 链之前。无代理时为空循环。
  notifyBeforeRunDelegates({ configName: config.name, executorId: executor.getId() })
  await applyActiveRunTarget(params, config)
  // 运行配置扩展（上游 `com.intellij.runConfigurationExtension` 的 `patchCommandLine`）：
  // 上游在 ProgramRunner 真的起进程之前，把**同一个** `GeneralCommandLine` 交给全部扩展
  // （Coverage 插 agent、DevKit 加 VM 参数、Gradle 改 classpath…）。本仓同一位置、同一动作；
  // 没有扩展时这里是空循环 ⇒ 行为与之前逐字相同。扩展抛错 = 上游的 `ExecutionException`
  // ⇒ **取消这次执行**（不走到 run.start，也不留下半次启动）。
  const patch = patchRunCommandLine(extensionConfigOf(config), commandLineOf(params), {
    runnerId: runnerIdFor(executor.getId(), config), executorId: executor.getId(),
  })
  if (patch.error) { notify(patch.error, true); return null }
  applyCommandLineToParams(patch.cmdLine, params)
  lastRunParams.value = params
  // 解释器那一档（上游 `ConsoleExecuteActionHandler.myUseProcessStdIn == false`）：这条配置的
  // 可执行程序就是解释器（本仓没有 per-config `GeneralCommandLine`，差异见 src/consoleExecute.ts）。
  // RunConsole 据此在会话结束后仍给出「解释器」输入行；shell 配置没有可执行程序 ⇒ 空串、不显示。
  runInterpreterCommand.value = (params.program ?? '').trim()
  // ExecutionListener 主题（上游 `ExecutionManagerImpl.kt:327/335/338/384` 的四条发信点）。
  // env 从这条配置拼；实例 id 要等 `run.start` 回包才知道，所以 Started 那一条在 runInstances 里发。
  const runEnv = executionEnvironmentOf(0, config.name, executor.getId(), config.type, root)
  executionListeners.processStartScheduled(runEnv)
  executionListeners.processStarting(runEnv)
  beginRun()
  try {
    const started = await request<{ instance: number }>('run.start', { ...params })
    if (started?.instance) {
      setRunInstanceExecutor(started.instance, executor.getId(), config.type)
      beginRun(started.instance)
    }
    return started?.instance ?? null
  } catch (error) {
    executionListeners.processNotStarted(runEnv, errorMessage(error))
    notify(`无法启动：${errorMessage(error)}`, true)
    return null
  }
}
// IDEA's Run/Debug act on the selected configuration. A debug-type config hands its
// command line to the DAP session: first token is the program, the rest are arguments.
async function runSelectedConfig(debug: boolean) {
  if (!workspace.value || !isDesktop) { notify('桌面端才能运行或调试配置。', true); return }
  if (blocked(debug ? '调试' : '运行')) return
  const name = runConfigName.value
  const selected = currentRunConfig() as RuntimeRunConfig
  const found = runConfigs.value.find(config => config.name === name) ?? (selected.name === name && (selected.command || selected.program || selected.type === 'compound') ? selected : undefined)
  // 没有选中配置时**从上下文生成**（IDEA 的 `RunConfigurationProducer`：
  // `AbstractApplicationConfigurationProducer.java:50-66` 从当前文件的类/main 方法生成配置，
  // `:74` 只把主类名记进配置）—— 所以这里回退到同一条上下文链路，
  // 而不是弹一句"请选择一个运行配置"把用户挡在门外。
  if (!found) { await runContextConfiguration(debug); return }
  if (found.type === 'compound') { await runCompoundConfiguration(found, debug); return }
  const metadata = found as RuntimeRunConfig
  if (metadata.temporary && metadata.sourceTarget?.kind === 'java') {
    await runJavaContext(metadata.sourceTarget.source, debug, found)
    return
  }
  if (debug && found.type !== 'debug' && !metadata.temporary) { notify(`配置「${name}」不是调试类型；在运行配置里勾选“调试”后才会交给 DAP。`, true); return }
  if (!debug && found.type === 'debug') { notify(`配置「${name}」是调试类型；用 Shift+F9 调试它。`, true); return }
  // 运行器调度（上游 `ProgramRunner.getRunner` / `RunnerRegistry`）：两条内建 runner 的 canRun
  // 与上面两条通知逐字一致，规则在 `src/programRunners.ts`（判据 tests/run-program-runner.test.mjs）。
  // 复合配置与临时 Java 配置在上面已各自分流，所以这里只判类型。
  const executorId = debug ? DEBUG_EXECUTOR_ID : RUN_EXECUTOR_ID
  // 执行器必须已在 `com.intellij.executor` EP 里（上游 `Executor.EXECUTOR_EXTENSION_NAME`）：
  // 内建 Run/Debug 在 `src/executors.ts` 作为 bundled 贡献登记 ⇒ 这里是恒真的护栏；
  // 第三方把内建那条注销掉时会如实挡住，而不是在 runner 表里找不到理由。
  if (!executorById(executorId)) { notify(`执行器「${executorId}」没有注册，无法启动。`, true); return }
  // 注册表解析（上游 `ExecutorRegistry.getExecutorById` + `Executor.isApplicable(Project)` +
  // `Executor.isSupportedOnTarget()`）：三条门的判定与文案在 `src/executors.ts` 的 `resolve`。
  const selection = selectExecutor(executorId)
  if (!selection.executor) { notify(selection.reason, true); return }
  const executor = selection.executor
  const resolved = resolveRunner(executorId, found)
  if (!resolved.runner) { notify(resolved.reason, true); return }
  if (!debug) { await startRun(found, executor.getId()); return }
  // A debug configuration carries its program/args/cwd/adapter as structured
  // fields (IDEA's ApplicationConfiguration); tokenizing `command` again would
  // break on paths with spaces and drop the configured environment.
  const root = workspace.value.root
  const launchConfig = expandRunConfigMacros(found)
  const commandArgs = parseRunArguments(launchConfig.command)
  const program = launchConfig.program?.trim() || commandArgs[0] || ''
  if (!program) { notify('调试配置没有可执行程序。', true); return }
  if (!await saveAll() || workspace.value?.root !== root) return
  const args = launchConfig.args ?? commandArgs.slice(1)
  // IDEA runs "Build" before a debug launch too; a configured beforeLaunch chain
  // gates the adapter the same way it gates a normal run.
  // 插件贡献的启动前任务同样要先跑（与普通运行同一条 `com.intellij.stepsBeforeRunProvider` 口径）。
  const debugPluginTasks = beforeRunTasksFor({
    name: found.name, type: found.type, command: found.command, program: found.program, cwd: found.cwd,
  }).map(task => ({ name: task.name, command: task.command }))
  for (const step of [...(found.beforeLaunch ?? []), ...debugPluginTasks]) {
    const code = await runToExit({ command: step.command, shell: true, cwd: launchConfig.cwd || root, env: launchConfig.env })
    if (workspace.value?.root !== root) return
    if (code !== 0) { notify(`启动前步骤「${step.name || step.command}」失败（退出码 ${code}），已中止调试。`, true); return }
  }
  // 工具窗口由**这条执行器**决定（上游 `Executor.getToolWindowId()`：`ToolWindowId.RUN` 进运行
  // 工具窗口、`ToolWindowId.DEBUG` 进调试工具窗口）—— 内建 Debug 与之前那两行硬编码等价，
  // 第三方执行器（如 Profile/Coverage 一类的同族贡献）则按它自报的窗口落位。
  showExecutorToolWindow(executor)
  // 调试命令行也过一遍运行配置扩展（上游 `patchCommandLine` 对调试的那条通道同样生效：
  // 适配器就是子进程，插 agent/加 VM 参数的语义一样）。扩展抛错 = 取消这次调试。
  const launch = patchDebugLaunch(found, executor.getId(), program, args, launchConfig.env, launchConfig.cwd || root)
  if (launch.error) { notify(launch.error, true); return }
  try {
    await dapStart({ command: '', args: launch.args, kind: found.adapter?.trim() || debugKindFor(launch.program), program: launch.program, cwd: launch.cwd, stopOnEntry: false, env: envArrayToObject(launch.env) })
    // 启动文案取执行器的 `getStartActionText(configurationName)`（上游 `DefaultDebugExecutor` 覆写后
    // 就是 `Debug '配置名'`）—— 内建之外由插件决定这行字。
    notify(`${executorStartActionText(executor, found.name)} —— ${launch.program}`)
  } catch (error) { notify(`无法启动调试：${errorMessage(error)}`, true) }
}
async function runCompoundConfiguration(config: RunConfig, debug: boolean): Promise<void> {
  if (debug) { notify('复合配置调试需要多调试会话；当前 DAP 通道只支持一个会话，未启动任何成员。', true); return }
  // 顺序、整组预检与"只回滚自己启动的实例"都在 src/runCompound.ts（纯逻辑，有判据）；
  // 这里只负责把宿主的两件事交给它：启动一个成员、停一个实例。
  const root = workspace.value?.root
  const outcome = await runCompound(config, runConfigs.value, {
    start: async member => (workspace.value?.root === root ? (await startRun(member)) ?? null : null),
    stop: async instance => { await request('run.stop', { instance }) },
  })
  if (outcome.failed) notify(outcome.failed, true)
}

// The bridge accepts env as an object or ["KEY=value"]; the config stores lines.
function envArrayToObject(lines?: string[]): Record<string, string> | undefined {
  if (!lines?.length) return undefined
  const out: Record<string, string> = {}
  for (const line of lines) {
    const eq = line.indexOf('=')
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return Object.keys(out).length ? out : undefined
}
// The DAP kind selects the adapter entry from TaoCode.dap.json; guessing cppvsdbg
// for a Java or Python program would launch the wrong debugger.
function debugKindFor(program: string): string {
  const lower = program.toLowerCase()
  if (/\.jar$/.test(lower) || /(^|[\\/])(java|javaw)(\.exe)?$/.test(lower) || lower === 'java' || lower === 'javaw') return 'java'
  if (/\.py$/.test(lower) || lower === 'python' || lower === 'python3') return 'debugpy'
  if (/\.dll$/.test(lower)) return 'cppvsdbg'
  return 'cppvsdbg'
}
// RunClass ("run the configuration belonging to the context"): TaoCode's context is
// the active file; a same-named `<basename>.exe` next to the configured output dir
// is what the CMake templates produce, so that is the candidate.
async function runContextConfiguration(debug: boolean) {
  const tab = active.value
  if (!tab || !workspace.value || !isDesktop) { notify('请先打开一个文件。', true); return }
  if (blocked(debug ? '调试' : '运行')) return
  // **插件贡献的运行配置生产者**（上游 `com.intellij.runConfigurationProducer` 的
  // `RunConfigurationProducer.createConfigurationFromContext` / `setupConfigurationFromContext`）：
  // 上游在动作里先问一遍全部生产者（`RunConfigurationProducer.getProducers` 按 `order` 排），
  // 认下就用它产出的配置。本仓此前只有内置那两条启发式（Java 主类 / C++ 同名产物），
  // 插件挂进来的生产者**没有消费点** —— 这里补上：插件认下即用它的配置，认不下才落到内置启发式。
  // 判据 tests/execution-extension-points.test.mjs（注册后 `produceRunConfigurationFromContext` 能取到）。
  const produced = produceRunConfigurationFromContext(
    { path: tab.path, text: '', root: workspace.value?.root ?? null },
    // 第二格是「项目」面：`com.intellij.runConfigurationProducerSuppressor` 的 `shouldSuppress` 要看它
    // （上游 `RunConfigurationProducerService.isIgnored(producer, project)` 同一件事）。
    { root: workspace.value?.root ?? null, name: workspace.value?.name ?? null },
  )
  if (produced) { await runProducedConfiguration(produced, debug, tab.path); return }
  // Java 走 `ApplicationConfiguration` 那条路（主类全限定名 + classpath，`java -cp … <主类>`）——
  // 下面的"找同名 .exe"是 C++/CMake 的产物形态，对 Java 完全不适用（JetBrains:
  // `AbstractApplicationConfigurationProducer.java:50-74` 取类名，`:74` 记的是全限定名）。
  if (/\.java$/i.test(tab.path)) { await runJavaContext(tab.path, debug); return }
  const base = tab.path.split('/').pop() ?? ''
  const stem = base.replace(/\.[^.]+$/, '')
  const output = projectSettings.value.java.outputPath || 'build'
  const candidates = [`${output}/${stem}.exe`, `${output}/${stem}`, `build/${stem}.exe`]
  for (const candidate of candidates) {
    try {
      await request<DocumentData>('file.read', { path: candidate })
    } catch { continue }
    if (debug) {
      // 执行器门与运行路径同一条（注销掉 Debug 那条执行器时如实挡住，而不是绕过去启动）。
      const debugSelection = selectExecutor(DEBUG_EXECUTOR_ID)
      if (!debugSelection.executor) { notify(debugSelection.reason, true); return }
      showExecutorToolWindow(debugSelection.executor)
      // 调试上下文产物同样过运行配置扩展（同一条 `patchCommandLine` 口径）。
      const launch = patchDebugLaunch(
        { name: `${stem} (上下文)`, type: 'debug', command: '' }, DEBUG_EXECUTOR_ID, candidate, [], undefined, '.',
      )
      if (launch.error) { notify(launch.error, true); return }
      try {
        await dapStart({ command: '', args: launch.args, kind: debugKindFor(launch.program), program: launch.program, cwd: launch.cwd, stopOnEntry: false })
        notify(`${executorStartActionText(debugSelection.executor, stem)} —— ${launch.program}`)
      } catch (error) { notify(`无法启动调试：${errorMessage(error)}`, true) }
    } else {
      runCommand.value = candidate
      await startRun()
    }
    return
  }
  notify(`找不到与 ${base} 对应的可执行文件（查过 ${candidates.join('、')}）。`, true)
}
/**
 * 跑一条**插件生产者**产出的配置（上游 `RunConfigurationProducer` 的产出物交给
 * `ProgramRunner` 起进程那一步）。形状与本仓 `RunConfig` 对齐，所以折成一条临时 `RunConfig`
 * 后走**同一条** `startRun`（执行器门 / 启动前链 / 运行配置扩展 / ExecutionListener 全都在里面）。
 * 调试那条通道本仓只服务 `ApplicationConfiguration`（Java 主类），插件产出的调试配置没有对应的
 * 适配器描述 ⇒ 如实提示「已生成配置，但调试通道不支持」，而不是假装启动了。
 */
async function runProducedConfiguration(produced: ProducedRunConfiguration, debug: boolean, sourcePath: string): Promise<void> {
  const name = produced.name || sourcePath.split('/').pop() || '上下文配置'
  if (debug) {
    notify(`插件为「${name}」生成了运行配置；调试通道当前只服务 Java 主类配置，请用运行。`)
    return
  }
  const config = currentRunConfig()
  const temporary: RuntimeRunConfig = {
    ...config,
    name, type: (produced.type as RunConfig['type']) ?? config.type,
    command: produced.command, program: produced.program, args: produced.args ? [...produced.args] : undefined,
    cwd: produced.cwd, temporary: true,
  }
  await startRun(temporary, RUN_EXECUTOR_ID)
}
/**
 * 运行/调试一个 Java 文件所在的**主类**（IDEA 的 `ApplicationConfiguration`）。
 *
 * 与 IDEA 一致的取舍：类里没有 `main` 时也照样启动 —— 配置里记的就是这个类，
 * 让 JVM 去报 `no main method`，而不是在这里替用户改主意；但会先提示一句。
 */
// file.write is a compare-and-swap save (expectedVersion must match what is on disk) and
// file.create refuses an existing file, so the javac @argfile needs create-then-overwrite.
async function writeArgFile(content: string) {
  const path = javacArgFilePath()
  try { await request('file.create', { path }) }
  catch (error) { if (!(error instanceof Error && /已存在|EXISTS/.test(error.message + String((error as { code?: string }).code ?? '')))) throw error }
  const current = await request<DocumentData>('file.read', { path })
  await request('file.write', { path, content, expectedVersion: current.version, safeWrite: false })
}
async function runJavaContext(path: string, debug: boolean, selected?: RunConfig) {
  if (blocked(debug ? '调试' : '运行')) return
  const launchRoot = workspace.value?.root
  if (!await saveAll() || workspace.value?.root !== launchRoot) return
  let text = ''
  try { text = (await request<DocumentData>('file.read', { path })).content }
  catch (error) { notify(`读不到 ${path}：${errorMessage(error)}`, true); return }
  if (workspace.value?.root !== launchRoot) return
  const mainClass = mainClassFor(text, path)
  if (!mainClass) { notify('这个文件里没有可运行的主类。', true); return }
  const root = workspace.value?.root ?? '.'
  // 输出目录与类路径和"构建"用的是同一份（javac 编到哪，java 就从哪读）。
  const inputs = await collectBuildInputs({ workspace, projectSettings, gradleDetection })
  const plan_request = buildRequestOf(inputs, { workspace, projectSettings, gradleDetection, fallbackCommand: () => runCommand.value }, false)
  // **产物目录跟着构建工具走**（`runtimeOutputPaths`：Gradle 是 `build/classes/java/main` 等、
  // Maven 是 `target/classes`，只有 javac 才是 `out/production/<名字>`）—— 见该函数的注释：
  // 一律用 JPS 那个约定会让 Gradle/Maven 项目"构建成功、运行却找不到主类"。
  const outputPaths = runtimeOutputPaths(plan_request)
  // **先构建再运行** —— IDEA 的运行配置默认带 `Before launch: Build`（`BuildBeforeRunTaskProvider`，
  // 见 `RunConfigurationBase.getBeforeRunTasks` 的默认链）。不先编译就 `java -cp …`，
  // 必然报"找不到主类"（2026-09-27 桃实测到的就是这一条）。
  const build_plan = buildPlan(plan_request)
  if (build_plan.command && (build_plan.kind === 'javac' || build_plan.kind === 'gradle' || build_plan.kind === 'maven')) {
    if (build_plan.argFile) {
      try { await writeArgFile(build_plan.argFile) }
      catch (error) { notify(`无法写入编译参数文件：${errorMessage(error)}`, true); return }
    }
    notify(build_plan.reason)
    const code = await runToExit({ command: build_plan.command, shell: true, cwd: root })
    if (code !== 0) { notify(`${build_plan.label}失败（退出码 ${code}），已中止运行。构建输出见运行窗口。`, true); return }
  }
  if (!hasMainMethod(text))
    notify(`「${mainClass}」里没有 public static void main —— JVM 会直接报错；先补上 main 方法。`)
  if (debug) {
    const debugSelection = selectExecutor(DEBUG_EXECUTOR_ID)
    if (!debugSelection.executor) { notify(debugSelection.reason, true); return }
    showExecutorToolWindow(debugSelection.executor)
    // 上下文生成的 Java 配置同样过运行配置扩展（`patchCommandLine` 在适配器起进程之前）。
    const launch = patchDebugLaunch(
      { name: mainClass, type: 'application', command: '', program: javaExecutable(plan_request.jdkHome) },
      DEBUG_EXECUTOR_ID, javaExecutable(plan_request.jdkHome), javaRunArgs(mainClass, outputPaths, inputs.classpath), undefined, root,
    )
    if (launch.error) { notify(launch.error, true); return }
    try {
      await dapStart({ command: '', args: launch.args, kind: 'java',
                       program: launch.program, cwd: launch.cwd, stopOnEntry: false })
      notify(`${executorStartActionText(debugSelection.executor, mainClass)} —— ${launch.program}`)
    } catch (error) { notify(`无法启动调试：${errorMessage(error)}`, true) }
    return
  }
  runCommand.value = javaRunCommand({ mainClass, outputPaths, classpath: inputs.classpath, jdkHome: plan_request.jdkHome })
  await startRun()
}
// 「IDEA 打开默认就有」：项目一打开就把探测到的 JDK 与默认编译输出写回项目设置（**只填空值**，
// 用户填过的一律不动）。IDEA 那边是 `ProjectJdkTable` 里的 SDK 在打开项目时就成了默认 SDK。
// 探测结果来自 `app.jdks`（native/jdk.cpp 的 `find_all()`，等价 `JavaHomeFinderBasic`）。
watch(() => workspace.value?.root ?? '', () => {
  void (async () => {
    const current = workspace.value
    if (!current || !isDesktop) return
    try {
      const detected = (await availableJdks())[0] ?? null
      const patch = javaDefaults(projectSettings.value.java, detected, current.name ?? '')
      if (patch) await saveJavaSettings({ ...projectSettings.value.java, ...patch })
    } catch { /* 自动配置失败不该拦住打开项目 */ }
  })()
}, { immediate: true })
// IDEA 的 Build 菜单：CompileDirty（Build Project, Ctrl+F9）与 Compile（Rebuild, Ctrl+Shift+F9）
// 都走 `ProjectTaskManager`，由各 `ProjectTaskRunner` **按项目类型**认领 ——
// Gradle 项目跑 Gradle 任务、Maven 跑 Maven 阶段、纯 Java 走 JPS（本仓 = javac）。
// 折算规则全在 `src/projectBuild.ts`（有单测）；这里只负责收集输入、落 argfile、发起进程。
// 旧实现是「控制台命令，没有就写死 cmake 的 CMake 构建命令」—— 打开 Gradle/Java 项目按 Ctrl+F9
// 会去跑 cmake，这正是桃 2026-09-27 指出的那处「逻辑错误」。
async function startBuild(rebuild: boolean, filesOnly = false) {
  if (!workspace.value || !isDesktop) { notify('桌面端才能构建项目。', true); return }
  if (blocked('构建')) return
  if (!await saveAll()) { notify('请先保存修改再构建。', true); return }
  const root = workspace.value.root
  let plan
  try {
    const inputs = await collectBuildInputs({ workspace, projectSettings, gradleDetection })
    const request = buildRequestOf(inputs, { workspace, projectSettings, gradleDetection, fallbackCommand: () => runCommand.value }, rebuild)
    // 「编译当前文件」（上游 `CompileAction.java:56-59` 的 `compile(files)`）：只编活动标签那个 .java。
    const activeFile = active.value?.path
    plan = filesOnly && activeFile ? compileFilesPlan(request, [activeFile]) : buildPlan(request)
  } catch (error) { notify(`无法确定构建方式：${errorMessage(error)}`, true); return }
  if (!plan.command) { notify(plan.reason, true); return }
  // javac 的源文件清单走 `@argfile`（源文件多时命令行会超 Windows 的长度上限）。
  if (plan.argFile) {
    try { await writeArgFile(plan.argFile) }
    catch (error) { notify(`无法写入编译参数文件：${errorMessage(error)}`, true); return }
  }
  beginRun()
  showOutput('run')
  // 如实说出这次走的是哪条路（"到底跑的是什么"不该让用户猜）。
  notify(plan.reason)
  // 构建不运行程序，所以应用那几项不传；before-launch 步骤本身也是构建步骤，不复跑。
  const params: RunStartParams = { command: plan.command, shell: true, label: plan.label, cwd: root }
  // 编译前/重建前激活的外部系统任务（上游 `Phase.BEFORE_COMPILE`/`BEFORE_REBUILD`）：
  // 折进构建的前置步骤链（失败即中止本次构建）。AFTER_COMPILE/AFTER_REBUILD 挂在下面 ——
  // 本仓「构建结束」唯一能观察到的信号是这次运行实例退出（同一对 `run.start` + `run.exit` 调用）。
  const buildPhases = plan.kind === 'gradle' ? activatedBuildSteps(rebuild) : []
  if (buildPhases.length) params.beforeLaunch = buildPhases
  try {
    const started = await request<{ instance: number }>('run.start', { ...params })
    if (started?.instance) beginRun(started.instance)
    // 构建后阶段（上游 `ProjectTaskManagerListener.afterRun` → `projectTasksAfterRun`，
    // `ExternalSystemTaskActivator.doExecuteBuildPhaseTriggers` 的 after 分支）：只在构建**成功**
    // （退出码 0）时跑，串行、首个失败即停 —— 判定与失败文案都在 `src/externalSystemAfterBuild.ts`。
    // 不 await：构建早已返回，after 任务是它自己的链路。
    const afterPhases = plan.kind === 'gradle' && started?.instance ? activatedAfterBuildSteps(rebuild) : []
    if (afterPhases.length) void runActivatedAfterBuild(runExitCode(started.instance), afterPhases, { runStep: runActivatedStep, notify })
  } catch (error) { endRun(); notify(`无法启动构建：${errorMessage(error)}`, true) }
}
// IDEA 的外部工具（preferences.externalTools）：应用级命令收藏，运行时走与构建相同的 run.start 通道。
// 命令行里的宏在**这里**展开（上游 `ToolRunProfile` 调 `ToolManagerImpl` 的宏替换）：
// `$FilePath$`/`$FileDir$`/`$SelectedText$`/`$ClipboardContent$`/`$LineNumber$` 一族见 src/toolMacros.ts。
// 宏上下文来自当前标签（工作区相对路径 + 光标行列）、工作区根/项目名与系统剪贴板；
// 选区文本拿不到（选区在 CodeEditor 里、只发给 App.vue，本批该文件冻结）⇒ `$SelectedText$` 展开成空，
// 这是如实的行为而不是假装有值。
async function runExternalTool(command: string, name: string, cwd?: string | null) {
  if (!workspace.value || !isDesktop) { notify('桌面端才能运行外部工具。', true); return }
  if (blocked(`外部工具「${name}」`)) return
  const tab = active.value
  // 只在命令里出现**已知宏名**时展开：这条通道同时承载 Gradle 任务/控制台命令（App 的 runInConsole
  // 映射到本函数），不能对任意命令做文本替换（规则与理由见 src/toolMacros.ts 的 expandKnownToolMacros）。
  const expanded = expandKnownToolMacros(command, {
    filePath: tab?.path ?? '',
    projectRoot: workspace.value.root,
    projectName: workspace.value.name ?? '',
    selectedText: '',
    clipboardContent: await readClipboardText(),
    line: tab?.line,
    column: tab?.column,
  })
  // 宏名写错时用户要看得见（上游未知宏原样保留；这里额外提示一句，免得命令里带着 `$FlePath$` 去执行）。
  const unknown = unknownToolMacros(command)
  if (unknown.length) notify(`外部工具「${name}」里有未知宏：${unknown.map(macro => `$${macro}$`).join('、')}（按原文传给命令）。`)
  beginRun()
  showOutput('run')
  try {
    // cwd：调用方给了执行上下文的目录就用它（Run Anything 的那格上下文由 `runAnythingContext.ts` 算，
    // 属桶 9b），没给就退回工作区根。上游那一档的对应文件在本 checkout 里按
    // `platform/execution-impl/src/com/intellij/execution/runAnything/` 搜不到 ⇒ 无法核实，不引坐标。
    const started = await request<{ instance: number }>('run.start', { command: expanded, label: name, cwd: cwd?.trim() || workspace.value.root })
    if (started?.instance) beginRun(started.instance)
  } catch (error) { endRun(); notify(`无法启动外部工具「${name}」：${errorMessage(error)}`, true) }
}
// 停止**当前实例**（IDEA 的 Stop 按钮作用在选中的那个 Content 上）；没有选中就停全部。
//
// 两段式（上游 `KillableProcessHandler.java:26-30` 的类注释：「第一次按 Stop 优雅、之后再按才强杀」）：
// **第一次**请求宿主只做**优雅停止** —— `native/win_graceful_stop.cpp` 给子进程自己的控制台发
// Ctrl+C、给树里可见的顶层窗口发 WM_CLOSE（Windows 那一支与上游
// `WinProcessTerminator.terminateWinProcessGracefully` 同一手段）；进程还在跑时实例留在清单里、
// 这一格停在「正在结束」，用户**再按一次**才走 Job Object 强杀（宿主按实例记 `stop_requested`，
// 见 native/run_host.cpp 的 `Manager::stop`）。所以这里不做「请求过了就禁掉」的假象：再按一次
// 真的会再发一条同样的 `run.stop {instance}`，宿主的第二次请求就是强杀。
async function stopRun() {
  const instance = activeRunInstance.value
  // 请求一发出就把这一格标成「正在结束」：上游读的是 `ProcessHandler.isProcessTerminating()`
  // 这个内存字段（`StopProcessAction.java:68-76`），本仓宿主在请求时也置位（随快照回传
  // `stopping`），这里先记是为了不等下一次快照就把「正在运行」清单的图标换成 kill。
  if (instance) markRunInstanceStopping(instance)
  try { await request('run.stop', instance ? { instance } : {}) }
  catch (error) { notify(errorMessage(error), true) }
}
// IDEA 主工具栏的 Debug / Stop（MainToolbar 的 Run 工具组）。dapState 由原生推送；
// 停止要同时覆盖「运行/构建」与「调试会话」两条通道 —— 只停一条会留下另一端在跑。
const debugButtonTitle = computed(() => `调试 (Shift+F9)${isDesktop ? '' : ' · 仅桌面端'}`)
async function stopAnyProcess() {
  try {
    if (dapState.running) await request('dap.terminate')
    if (!runState.running) return
    // 上游 `StopAction` 全局位置有一条**单选**分支（`StopAction.java:132-140`）：可停的只有一个时
    // `ExecutionManagerImpl.stopProcess(descriptor)` 停的就是那一个（走 ProcessHandler 的优雅那一档），
    // 多个才弹 popup / 走「停止全部」。本仓那张弹层是 `src/runStopAction.ts` 的 chooser，
    // 工具栏这个按钮不弹 ⇒ 照单选那一支：一个在跑就停**它**（再按一次才强杀），
    // 多个才发不带实例的 `run.stop`（停止全部 = 每棵树的 Job Object 直接结束）。
    const stoppable = [...runInstances.values()].filter(instance => instance.running)
    const only = stoppable.length === 1 ? stoppable[0] : null
    if (only) {
      markRunInstanceStopping(only.id)
      await request('run.stop', { instance: only.id })
    } else {
      await request('run.stop')
    }
  } catch (error) { notify(errorMessage(error), true) }
}
async function sendRunInput() {
  const line = runInput.value?.value ?? ''
  if (runInput.value) runInput.value.value = ''
  if (!runState.running) { notify('没有正在运行的任务。', true); return }
  // 记进历史（上游 HistoryKeyListener 对新条目的处理：游标重置、未完成命令清空）。
  inputHistory.push(line)
  // 写进**当前实例**的 stdin（多实例时不能写错人）。
  try { await request('run.write', { line, instance: activeRunInstance.value }) } catch { /* 进程可能刚结束 */ }
}
  return {
    runStartParams, runToExit, startRun, runSelectedConfig, envArrayToObject, debugKindFor,
    runContextConfiguration, startBuild, runExternalTool, stopRun, debugButtonTitle, stopAnyProcess,
    sendRunInput,
  }
}
