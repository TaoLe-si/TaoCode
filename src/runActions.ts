// 运行 / 构建 / 调试 / 外部工具 —— 从 App.vue 搬出的一域（165 行，18 个依赖）。
//
// 判据：这是一条完整的「启动链路」—— `runStartParams` 把当前运行配置整形成 `run.start` 的参数，
// `runToExit` 把事件流变成可等待的退出码（IDEA 的 Before launch 语义），`startRun` / `startBuild` /
// `runExternalTool` 都走同一条链路，`stopRun` / `stopAnyProcess` 负责收尾。调试走 DAP，
// 但选哪条配置、要不要先跑 before-launch，和运行是同一套判断，所以不拆开。
// IDEA 对应物：Run/Debug 工具窗口 + Build 菜单（CompileDirty / Compile）+ tools.externalTools。
import { computed, watch, type Ref } from 'vue'
import { activeRunInstance, beginRun, dapStart, dapState, endRun, request, runState, runInstanceList, type DocumentData, type GitAheadBehind,
         type JavaProjectSettings, type ProjectSettings, type RunConfig, type RunStartParams, type Workspace } from './bridge'
import { errorMessage } from './errors'
import { availableJdks, buildRequestOf, collectBuildInputs, javaDefaults } from './buildHost.ts'
import { buildPlan, javacArgFilePath, runtimeOutputPaths } from './projectBuild.ts'
import { hasMainMethod, javaExecutable, javaRunArgs, javaRunCommand, mainClassFor } from './javaRun.ts'
import type { GradleDetection } from './gradle.ts'
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
}

export function createRunActions(deps: RunActionsDeps) {
  const { notify, isDesktop, workspace, active, runCommand, runConfigProgram, runConfigName, runConfigs,
          projectSettings, currentRunConfig, showOutput, explorer, leftView, runInput, saveAll, lastRunParams,
          gradleDetection, saveJavaSettings } = deps
// The whole configuration is sent, not just the command: program/args/cwd/env and
// the before-launch steps are what make a run configuration a configuration.
function runStartParams(label?: string): RunStartParams {
  const config = currentRunConfig()
  const params: RunStartParams = { command: config.command }
  if (config.program) params.program = config.program
  if (config.args?.length) params.args = config.args
  if (config.cwd) params.cwd = config.cwd
  if (config.env?.length) params.env = config.env
  params.shell = config.type !== 'application'
  if (label) params.label = label
  return params
}
// Run one command to completion and hand back its exit code. run.output/run.exit
// arrive as events; this watcher is what turns that stream into an awaitable so
// before-launch tasks can gate the real run (IDEA's Before launch semantics).
function runToExit(params: RunStartParams): Promise<number> {
  return new Promise(resolve => {
    beginRun()
    const stop = watch(() => runState.exit, code => {
      if (code === null || code === undefined) return
      stop()
      resolve(code)
    })
    void request('run.start', { ...params })
      .catch(() => { stop(); resolve(-1) })
  })
}
async function startRun() {
  if (!runCommand.value.trim() && !runConfigProgram.value.trim()) { notify('请输入要运行的命令或可执行程序。', true); return }
  if (!await saveAll()) { notify('请先保存修改再运行。', true); return }
  showOutput('run')
  // 「Before launch」的整条链现在由**宿主**跑（native/run_host.cpp）：前端只把 beforeLaunch 一起发过去，
  // 这样链是**一个实例**、退出一致、并且每个实例有自己的链状态（原来前端逐条跑，多实例会互相踩）。
  //
  // 「已有任务在运行」不再是前端的一道闸：IDEA 由 `ExecutionManagerImpl.kt:613-619` 按配置决定 ——
  // `isAllowRunningInParallel` 为假时停掉同名实例，为真时并存。宿主照这条规则做（见 run_host.hpp）。
  const config = currentRunConfig()
  const params: RunStartParams = { ...runStartParams(), allowParallel: config.allowRunningInParallel === true }
  lastRunParams.value = params
  beginRun()
  try {
    const started = await request<{ instance: number }>('run.start', { ...params })
    if (started?.instance) beginRun(started.instance)
  } catch (error) { endRun(); notify(`无法启动：${errorMessage(error)}`, true) }
}
// IDEA's Run/Debug act on the selected configuration. A debug-type config hands its
// command line to the DAP session: first token is the program, the rest are arguments.
async function runSelectedConfig(debug: boolean) {
  if (!workspace.value || !isDesktop) { notify('桌面端才能运行或调试配置。', true); return }
  const name = runConfigName.value
  const found = runConfigs.value.find(config => config.name === name)
  // 没有选中配置时**从上下文生成**（IDEA 的 `RunConfigurationProducer`：
  // `AbstractApplicationConfigurationProducer.java:50-66` 从当前文件的类/main 方法生成配置，
  // `:74` 只把主类名记进配置）—— 所以这里回退到同一条上下文链路，
  // 而不是弹一句"请选择一个运行配置"把用户挡在门外。
  if (!found) { await runContextConfiguration(debug); return }
  if (debug && found.type !== 'debug') { notify(`配置「${name}」不是调试类型；在运行配置里勾选“调试”后才会交给 DAP。`, true); return }
  if (!debug && found.type === 'debug') { notify(`配置「${name}」是调试类型；用 Shift+F9 调试它。`, true); return }
  if (!debug) { void startRun(); return }
  // A debug configuration carries its program/args/cwd/adapter as structured
  // fields (IDEA's ApplicationConfiguration); tokenizing `command` again would
  // break on paths with spaces and drop the configured environment.
  const program = found.program?.trim() || found.command.trim().split(/\s+/)[0] || ''
  if (!program) { notify('调试配置没有可执行程序。', true); return }
  const args = found.args ?? found.command.trim().split(/\s+/).slice(1)
  // IDEA runs "Build" before a debug launch too; a configured beforeLaunch chain
  // gates the adapter the same way it gates a normal run.
  for (const step of found.beforeLaunch ?? []) {
    const code = await runToExit({ command: step.command, shell: true })
    if (code !== 0) { notify(`启动前步骤「${step.name || step.command}」失败（退出码 ${code}），已中止调试。`, true); return }
  }
  explorer.value = true
  leftView.value = 'debug'
  try {
    await dapStart({ command: '', args, kind: found.adapter?.trim() || debugKindFor(program), program, cwd: found.cwd || '.', stopOnEntry: false, env: envArrayToObject(found.env) })
    notify(`已在调试 ${program}`)
  } catch (error) { notify(`无法启动调试：${errorMessage(error)}`, true) }
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
async function runJavaContext(path: string, debug: boolean) {
  let text = ''
  try { text = (await request<DocumentData>('file.read', { path })).content }
  catch (error) { notify(`读不到 ${path}：${errorMessage(error)}`, true); return }
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
      try { await request('file.write', { path: javacArgFilePath(), content: build_plan.argFile }) }
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
    try { await request('file.write', { path: javacArgFilePath(), content: plan.argFile }) }
    catch (error) { notify(`无法写入编译参数文件：${errorMessage(error)}`, true); return }
  }
  beginRun()
  showOutput('run')
  // 如实说出这次走的是哪条路（"到底跑的是什么"不该让用户猜）。
  notify(plan.reason)
  // 构建不运行程序，所以应用那几项不传；before-launch 步骤本身也是构建步骤，不复跑。
  const params: RunStartParams = { command: plan.command, shell: true, label: plan.label, cwd: root }
  try {
    const started = await request<{ instance: number }>('run.start', { ...params })
    if (started?.instance) beginRun(started.instance)
  } catch (error) { endRun(); notify(`无法启动构建：${errorMessage(error)}`, true) }
}
// IDEA 的外部工具（preferences.externalTools）：应用级命令收藏，运行时走与构建相同的 run.start 通道。
async function runExternalTool(command: string, name: string) {
  if (!workspace.value || !isDesktop) { notify('桌面端才能运行外部工具。', true); return }
  beginRun()
  showOutput('run')
  try {
    const started = await request<{ instance: number }>('run.start', { command, label: name, cwd: workspace.value.root })
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
  // 写进**当前实例**的 stdin（多实例时不能写错人）。
  try { await request('run.write', { line, instance: activeRunInstance.value }) } catch { /* 进程可能刚结束 */ }
}
  return {
    runStartParams, runToExit, startRun, runSelectedConfig, envArrayToObject, debugKindFor,
    runContextConfiguration, startBuild, runExternalTool, stopRun, debugButtonTitle, stopAnyProcess,
    sendRunInput,
  }
}
