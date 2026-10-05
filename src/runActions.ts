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
import { buildPlan, javacArgFilePath, runtimeOutputPaths } from './projectBuild.ts'
import { GRADLE_RUN_DEFAULTS, gradleCommand, gradleDirectoryTask, gradleTaskProjectDisplayName, gradleTaskShortName } from './gradle.ts'
import { loadTasksActivation, tasksForPhase, type TaskPhase } from './externalProjectModel.ts'
import { generateExternalSystemTaskName } from './externalSystemTask.ts'
import { afterBuildPhase, runActivatedAfterBuild, type ActivatedTaskStep } from './externalSystemAfterBuild.ts'
import { expandKnownToolMacros, unknownToolMacros } from './toolMacros.ts'
import { readClipboardText } from './clipboard.ts'
import { attachInputHistory, createCommandHistory } from './consoleInputHistory.ts'
import { hasMainMethod, javaExecutable, javaRunArgs, javaRunCommand, mainClassFor } from './javaRun.ts'
import type { GradleDetection } from './gradle.ts'
import { parseRunArguments } from './runConfigTree.ts'; import { runCompound } from './runCompound.ts'
import type { RuntimeRunConfig } from './runTargets.ts'
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
  const params: RunStartParams = { command: config.command }
  if (config.program) params.program = config.program
  if (config.args?.length) params.args = config.args
  if (config.cwd) params.cwd = config.cwd
  if (config.env?.length) params.env = config.env
  params.shell = config.type !== 'application'
  if (label || config.name) params.label = label || config.name
  if (config.beforeLaunch?.length) params.beforeLaunch = config.beforeLaunch.map(step => ({ ...step }))
  params.allowParallel = config.allowRunningInParallel === true
  return params
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
  const target = await activeRunTarget()
  if (!target) return
  const program = applyTargetToTemplateProgram(config, target).program
  if (!program) return
  params.program = program
  params.command = ''
}
/** 活动目标（`ExecutionTargetManager.getActiveTarget`）：本机目标返回 undefined（=不换）。 */
async function activeRunTarget(): Promise<ExecutionTarget | undefined> {
  const id = readActiveExecutionTargetId()
  if (id === LOCAL_TARGET_ID) return undefined
  const targets = listExecutionTargets(await availableJdks(), {
    custom: loadTargetEnvironments(typeof localStorage === 'undefined' ? undefined : localStorage, workspace.value?.root ?? '').targets,
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
async function startRun(config: RunConfig = currentRunConfig()) {
  if (blocked('构建 / 运行')) return null
  const root = workspace.value?.root
  if (!config.command.trim() && !config.program?.trim()) { notify('请输入要运行的命令或可执行程序。', true); return }
  if (!await saveAll()) { notify('请先保存修改再运行。', true); return }
  if (workspace.value?.root !== root) return
  showOutput('run')
  // 「Before launch」的整条链现在由**宿主**跑（native/run_host.cpp）：前端只把 beforeLaunch 一起发过去，
  // 这样链是**一个实例**、退出一致、并且每个实例有自己的链状态（原来前端逐条跑，多实例会互相踩）。
  //
  // 「已有任务在运行」不再是前端的一道闸：IDEA 由 `ExecutionManagerImpl.kt:613-619` 按配置决定 ——
  // `isAllowRunningInParallel` 为假时停掉同名实例，为真时并存。宿主照这条规则做（见 run_host.hpp）。
  const params: RunStartParams = runStartParams(undefined, config)
  const activated = activatedBeforeRunSteps()
  if (activated.length) params.beforeLaunch = [...(params.beforeLaunch ?? []), ...activated]
  await applyActiveRunTarget(params, config)
  lastRunParams.value = params
  beginRun()
  try {
    const started = await request<{ instance: number }>('run.start', { ...params })
    if (started?.instance) beginRun(started.instance)
    return started?.instance ?? null
  } catch (error) { notify(`无法启动：${errorMessage(error)}`, true); return null }
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
  if (!debug) { await startRun(found); return }
  // A debug configuration carries its program/args/cwd/adapter as structured
  // fields (IDEA's ApplicationConfiguration); tokenizing `command` again would
  // break on paths with spaces and drop the configured environment.
  const root = workspace.value.root
  const commandArgs = parseRunArguments(found.command)
  const program = found.program?.trim() || commandArgs[0] || ''
  if (!program) { notify('调试配置没有可执行程序。', true); return }
  if (!await saveAll() || workspace.value?.root !== root) return
  const args = found.args ?? commandArgs.slice(1)
  // IDEA runs "Build" before a debug launch too; a configured beforeLaunch chain
  // gates the adapter the same way it gates a normal run.
  for (const step of found.beforeLaunch ?? []) {
    const code = await runToExit({ command: step.command, shell: true, cwd: found.cwd || root, env: found.env })
    if (workspace.value?.root !== root) return
    if (code !== 0) { notify(`启动前步骤「${step.name || step.command}」失败（退出码 ${code}），已中止调试。`, true); return }
  }
  explorer.value = true
  leftView.value = 'debug'
  try {
    await dapStart({ command: '', args, kind: found.adapter?.trim() || debugKindFor(program), program, cwd: found.cwd || '.', stopOnEntry: false, env: envArrayToObject(found.env) })
    notify(`已在调试 ${program}`)
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
      explorer.value = true
      leftView.value = 'debug'
      try { await dapStart({ command: '', args: [], kind: debugKindFor(candidate), program: candidate, cwd: '.', stopOnEntry: false }); notify(`已在调试 ${candidate}`) }
      catch (error) { notify(`无法启动调试：${errorMessage(error)}`, true) }
    } else {
      runCommand.value = candidate
      await startRun()
    }
    return
  }
  notify(`找不到与 ${base} 对应的可执行文件（查过 ${candidates.join('、')}）。`, true)
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
    explorer.value = true
    leftView.value = 'debug'
    try {
      await dapStart({ command: '', args: javaRunArgs(mainClass, outputPaths, inputs.classpath), kind: 'java',
                       program: javaExecutable(plan_request.jdkHome), cwd: root, stopOnEntry: false })
      notify(`已在调试 ${mainClass}`)
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
async function startBuild(rebuild: boolean) {
  if (!workspace.value || !isDesktop) { notify('桌面端才能构建项目。', true); return }
  if (blocked('构建')) return
  if (!await saveAll()) { notify('请先保存修改再构建。', true); return }
  const root = workspace.value.root
  let plan
  try {
    const inputs = await collectBuildInputs({ workspace, projectSettings, gradleDetection })
    plan = buildPlan(buildRequestOf(inputs, { workspace, projectSettings, gradleDetection, fallbackCommand: () => runCommand.value }, rebuild))
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
async function runExternalTool(command: string, name: string, cwd?: string) {
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
async function stopRun() {
  try { await request('run.stop', activeRunInstance.value ? { instance: activeRunInstance.value } : {}) }
  catch (error) { notify(errorMessage(error), true) }
}
// IDEA 主工具栏的 Debug / Stop（MainToolbar 的 Run 工具组）。dapState 由原生推送；
// 停止要同时覆盖「运行/构建」与「调试会话」两条通道 —— 只停一条会留下另一端在跑。
const debugButtonTitle = computed(() => `调试 (Shift+F9)${isDesktop ? '' : ' · 仅桌面端'}`)
async function stopAnyProcess() {
  try {
    if (dapState.running) await request('dap.terminate')
    if (runState.running) await request('run.stop')
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
