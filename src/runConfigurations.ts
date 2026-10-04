// 运行 / 调试配置 —— 从 App.vue 搬出的一域（153 行，6 个依赖）。
//
// 判据：IDEA 的 `RunManager` 把「配置是什么」（类型/程序/参数/工作目录/环境/启动前步骤/文件夹）
// 和「配置怎么被挑出来并落盘」（选择、草稿、保存、删除、Alt+Shift+F10 选择弹窗）放在同一个
// `RunConfigurationsDialog` 里；两半共享同一批草稿 ref（`runConfigProgram` / `runConfigArgs`…），
// 拆开就会变成两个模块互相读对方的 ref。所以这里一起收：**配置的整形与持久化**。
// 真正的启动动作在 src/runActions.ts（消费 `currentRunConfig()`）。
import { computed, ref, watch, type Ref } from 'vue'
import { request, runState, type Entry, type ProjectSettings, type RunConfig, type Workspace } from './bridge'
import { errorMessage } from './errors'
import { discoverRunTargets, filesNeedingContent, type RunTarget } from './runTargets.ts'
import { javaOutputPath } from './projectBuild.ts'
import { matchLibraryGlob } from './buildHost.ts'

export interface RunConfigurationsDeps {
  notify: (message: string, error?: boolean) => void
  workspace: Ref<Workspace | null>
  projectSettings: Ref<ProjectSettings>
  /** 控制台里手输的当前命令（宿主更早的阶段就要读写，所以留在宿主）。 */
  runCommand: Ref<string>
  menu: Ref<any>
  /** 由运行动作模块提供 —— 必须惰性调用。 */
  runSelectedConfig: (debug: boolean) => unknown
  /** 自动发现可运行目标要读文件（浏览器预览没有文件系统）。 */
  isDesktop: boolean
}

export function createRunConfigurations(deps: RunConfigurationsDeps) {
  const { notify, workspace, projectSettings, runCommand, menu, runSelectedConfig } = deps
const runConfigs = computed<RunConfig[]>(() => projectSettings.value.runConfigs)
const runConfigName = ref('')

// ---- 从上下文发现的可运行目标（IDEA `RunConfigurationProducer` 的项目级那一半）----
// 候选**不落盘**：IDEA 的 Producer 生成的同样是临时配置，只有"存储为项目文件"才写
// `.idea/runConfigurations`；这里也只把它们挂在选择器上，`projectSettings.runConfigs` 一个字不动。
const autoTargets = ref<RunTarget[]>([])
let discoveredRunRoot = ''
/** 自动候选（与用户配置重名时以用户配置为准）。 */
const autoOnlyTargets = computed(() => autoTargets.value.filter(target => !runConfigs.value.some(config => config.name === target.name)))
/** 选择器与 Alt+Shift+F10 下拉能选的全部名字：用户配置在前，自动发现的在后。 */
const allRunConfigNames = computed(() => [...runConfigs.value.map(config => config.name), ...autoOnlyTargets.value.map(target => target.name)])
function autoTargetFor(name: string) { return autoOnlyTargets.value.find(target => target.name === name) }

/**
 * 打开项目时扫一遍工作区，把能跑的东西列成候选 —— 这样 ▶ 一按就有东西可跑，
 * 而不是弹"请选择一个运行配置"（2026-09-27 桃报的正是这一条）。
 * 只读**可能含入口**的那几十个文件（`filesNeedingContent`），不做全量读取。
 */
async function discoverRunTargetsForProject(): Promise<void> {
  const current = workspace.value
  if (!current || !deps.isDesktop) { autoTargets.value = []; discoveredRunRoot = ''; return }
  if (discoveredRunRoot === current.root) return
  discoveredRunRoot = current.root
  autoTargets.value = []
  try {
    const files = (await request<{ files: string[] }>('workspace.files')).files
    const contents: Record<string, string> = {}
    for (const path of filesNeedingContent(files)) {
      try { contents[path] = (await request<{ content: string }>('file.read', { path })).content }
      catch { /* 二进制/不可读的直接跳过 */ }
    }
    const java = projectSettings.value.java
    const classpath = files.filter(path => /\.jar$/i.test(path)
      && (java.referencedLibraries ?? []).some(pattern => matchLibraryGlob(pattern, path)))
    autoTargets.value = discoverRunTargets({
      files, contents,
      java: {
        jdkHome: java.jdkHome ?? '',
        outputPaths: [javaOutputPath({ outputPath: java.outputPath, projectName: current.name ?? '' })],
        classpath,
      },
    })
    if (!runConfigName.value && autoTargets.value.length) selectRunConfig(autoTargets.value[0]!.name)
  } catch { /* 发现失败不该拦住打开项目 */ }
}
watch(() => workspace.value?.root ?? '', () => { void discoverRunTargetsForProject() }, { immediate: true })
// The header Run widget's tooltip: what pressing it will do right now.
const runWidgetTitle = computed(() => runState.running
  ? '停止运行 (Ctrl+F2)'
  : `运行 ${runConfigName.value || '所选配置'} (Shift+F10)`)
// IDEA's Alt+Shift+F10 "Choose Run Configuration" popup: pick the config to run or
// debug without hunting through the Run tab's select.
const configChooser = ref<{ debug: boolean } | null>(null)
const configIndex = ref(0)
function openConfigChooser(debug = false) {
  // IDEA 的下拉里既有**已有配置**，也有 Producer 从上下文生成的候选；本仓把两者合并展示。
  if (!allRunConfigNames.value.length) { notify('这个项目里没有发现可运行的目标：打开一个含 main 方法的源文件，或在“运行”面板里新建配置。', true); return }
  configIndex.value = Math.max(0, allRunConfigNames.value.findIndex(name => name === runConfigName.value))
  configChooser.value = { debug }
}
function moveConfig(delta: number) {
  const count = allRunConfigNames.value.length
  if (!count) return
  configIndex.value = (configIndex.value + delta + count) % count
}
function applyConfigChoice(config: RunConfig) {
  const debug = configChooser.value?.debug ?? false
  configChooser.value = null
  pickConfig(config.name)
  if (debug) void runSelectedConfig(true); else void runSelectedConfig(false)
}
// The rest of the IDEA run-configuration shape: program, arguments, working
// directory, environment and the before-launch steps. Only `command` used to be
// editable, which made the other four fields decorative — they were persisted but
// never sent and never shown.
const runConfigType = ref<'shell' | 'application' | 'debug'>('shell')
const runConfigProgram = ref('')
const runConfigDebugAdapter = ref('cppvsdbg')
const runConfigArgs = ref('')
const runConfigCwd = ref('')
const runConfigEnv = ref('')
const runConfigBefore = ref<Array<{ name: string; command: string }>>([])
// 左树文件夹（IDEA RunConfigurable 的 FOLDER 节点）：空串=直接在类型节点下。
const runConfigFolder = ref('')
const runConfigEditorOpen = ref(false)
// One argument / one KEY=VALUE per line: a textarea is what IDEA uses for both, and
// it keeps shell-quoting out of the persisted shape.
function linesToArray(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}
function arrayToLines(values: string[] | undefined): string { return (values ?? []).join('\n') }
function currentRunConfig(): RunConfig {
  return {
    name: runConfigName.value.trim(),
    type: runConfigType.value,
    command: runCommand.value.trim(),
    ...(runConfigProgram.value.trim() ? { program: runConfigProgram.value.trim() } : {}),
    ...(linesToArray(runConfigArgs.value).length ? { args: linesToArray(runConfigArgs.value) } : {}),
    ...(runConfigCwd.value.trim() ? { cwd: runConfigCwd.value.trim() } : {}),
    ...(runConfigType.value === 'debug' ? { adapter: runConfigDebugAdapter.value.trim() || 'cppvsdbg' } : {}),
    ...(linesToArray(runConfigEnv.value).length ? { env: linesToArray(runConfigEnv.value) } : {}),
    ...(runConfigBefore.value.filter(step => step.command.trim()).length
      ? { beforeLaunch: runConfigBefore.value.filter(step => step.command.trim()).map(step => ({ name: step.name, command: step.command })) }
      : {}),
    ...(runConfigFolder.value.trim() ? { folder: runConfigFolder.value.trim() } : {}),
  }
}
function addBeforeLaunchStep() { runConfigBefore.value = [...runConfigBefore.value, { name: '', command: '' }] }
function removeBeforeLaunchStep(index: number) { runConfigBefore.value = runConfigBefore.value.filter((_, i) => i !== index) }
function selectRunConfig(name?: string) {
  const wanted = name ?? runConfigName.value
  const target = autoTargetFor(wanted)
  if (target) {
    // 自动候选不落盘：把它的结构化字段放进草稿，跑完就走（IDEA 的临时配置同样如此）。
    runConfigName.value = target.name
    runConfigType.value = target.program ? 'application' : 'shell'
    runCommand.value = target.command
    runConfigProgram.value = target.program ?? ''
    runConfigArgs.value = arrayToLines(target.args)  // one argv per line (linesToArray reads it back)
    runConfigCwd.value = ''
    runConfigEnv.value = ''
    runConfigBefore.value = []
    runConfigDebug.value = false
    return
  }
  const found = runConfigs.value.find(config => config.name === wanted) ?? runConfigs.value[0]
  runConfigName.value = found?.name ?? ''
  if (found?.adapter) runConfigDebugAdapter.value = found.adapter
  if (!found) { runConfigType.value = 'shell'; runConfigProgram.value = ''; runConfigArgs.value = ''; runConfigCwd.value = ''; runConfigEnv.value = ''; runConfigBefore.value = []; runCommand.value = ''; runConfigDebug.value = false; return }
  runCommand.value = found.command
  runConfigType.value = found.type ?? 'shell'
  runConfigDebug.value = runConfigType.value === 'debug'
  runConfigProgram.value = found.program ?? ''
  runConfigArgs.value = arrayToLines(found.args)
  runConfigCwd.value = found.cwd ?? ''
  runConfigEnv.value = arrayToLines(found.env)
  runConfigBefore.value = (found.beforeLaunch ?? []).map(step => ({ name: step.name, command: step.command }))
  runConfigFolder.value = found.folder ?? ''
}
function pickConfig(name: string) { runConfigName.value = name; selectRunConfig(name) }
async function persistRunConfigs(configs: RunConfig[], message: string) {
  if (!workspace.value) { notify('请先打开项目：运行配置随项目保存。', true); return }
  try {
    const result = await request<{ settings: ProjectSettings; entries: Entry[] }>('project.settings.update', { runConfigs: configs })
    projectSettings.value = result.settings
    workspace.value.entries = result.entries
    selectRunConfig()
    notify(message)
  } catch (error) { notify(errorMessage(error), true) }
}
const runConfigDebug = ref(false)
// IDEA RunConfigurationsDialog：独立的运行/调试配置对话框（左侧列表 + 右侧表单）。
// 草稿由现有编辑状态合成，保存走同一条 persistRunConfigs 链路（不另开持久化路径）。
const runConfigsOpen = ref(false)
/** 「查看断点…」对话框（上游 `BreakpointsDialog`，主从详情面板唯一的消费者）。 */
const breakpointsOpen = ref(false)
const runConfigDraft = computed<RunConfig>(() => ({
  name: runConfigName.value,
  type: runConfigType.value,
  command: runCommand.value,
  program: runConfigProgram.value,
  args: runConfigArgs.value.split(/\s+/).filter(Boolean),
  cwd: runConfigCwd.value,
  env: runConfigEnv.value.split('\n').map(line => line.trim()).filter(Boolean),
  beforeLaunch: runConfigBefore.value.map(step => ({ ...step })),
  ...(runConfigFolder.value.trim() ? { folder: runConfigFolder.value.trim() } : {}),
}))
function loadRunConfigDraft(name: string) {
  const found = runConfigs.value.find(config => config.name === name)
  if (!found) return
  runConfigName.value = found.name
  runConfigType.value = found.type ?? 'shell'
  runCommand.value = found.command ?? ''
  runConfigProgram.value = found.program ?? ''
  runConfigArgs.value = arrayToLines(found.args)
  runConfigCwd.value = found.cwd ?? ''
  runConfigEnv.value = arrayToLines(found.env)
  runConfigBefore.value = (found.beforeLaunch ?? []).map(step => ({ name: step.name, command: step.command }))
  runConfigFolder.value = found.folder ?? ''
}
async function saveRunConfigFromDialog(config: RunConfig) {
  const next = [...runConfigs.value]
  const index = next.findIndex(item => item.name === config.name)
  if (index >= 0) next[index] = config
  else next.push(config)
  await persistRunConfigs(next, `已保存运行配置「${config.name}」`)
  // 保存后把草稿状态对齐到刚存下的那条，否则下一次 currentRunConfig() 会丢掉文件夹与适配器。
  runConfigFolder.value = config.folder ?? ''
  if (config.adapter) runConfigDebugAdapter.value = config.adapter
  loadRunConfigDraft(config.name)
}
function openRunConfigurations() { runConfigsOpen.value = true; menu.value = null }
// 「查看断点…」（Ctrl+Shift+F8）—— 上游 `ViewBreakpointsAction` → `BreakpointsDialog`。
// 断点表在宿主（`src/bridge.ts` 的 `dapBreakpoints`），这里只开对话框。
function openBreakpoints() { breakpointsOpen.value = true; menu.value = null }
async function removeRunConfigFromDialog(name: string) {
  await persistRunConfigs(runConfigs.value.filter(config => config.name !== name), `已删除运行配置「${name}」`)
}
// The debug checkbox and the type selector are one setting; keep them in sync in
// both directions so "调试（DAP）" and type=debug never disagree.
watch(runConfigDebug, debug => { if (debug) runConfigType.value = 'debug'; else if (runConfigType.value === 'debug') runConfigType.value = 'shell' })
watch(runConfigType, type => { runConfigDebug.value = type === 'debug' })
function saveConfig() {
  const name = runConfigName.value.trim()
  if (!name) { notify('请填写配置名。', true); return }
  if (!runCommand.value.trim() && !runConfigProgram.value.trim()) { notify('请填写命令或可执行程序。', true); return }
  for (const entry of linesToArray(runConfigEnv.value))
    if (!entry.includes('=') || entry.startsWith('=')) { notify(`环境变量要写成 KEY=VALUE：「${entry}」不合法。`, true); return }
  const next = currentRunConfig()
  const configs = runConfigs.value.map(config => config.name === name ? next : config)
  if (!configs.some(config => config.name === name)) configs.push(next)
  void persistRunConfigs(configs, `已保存运行配置「${name}」`)
}
function removeConfig() {
  const name = runConfigName.value
  void persistRunConfigs(runConfigs.value.filter(config => config.name !== name), `已删除运行配置「${name}」`)
}
  return {
    autoTargets, autoOnlyTargets, allRunConfigNames,
    runConfigs, runConfigName, runWidgetTitle, configChooser, configIndex, openConfigChooser, moveConfig,
    applyConfigChoice, runConfigType, runConfigProgram, runConfigDebugAdapter, runConfigArgs, runConfigCwd,
    runConfigEnv, runConfigBefore, runConfigFolder, runConfigEditorOpen, runConfigDebug, runConfigsOpen,
    runConfigDraft, loadRunConfigDraft, saveRunConfigFromDialog, openRunConfigurations, breakpointsOpen, openBreakpoints,
    linesToArray, arrayToLines, currentRunConfig, selectRunConfig, pickConfig, persistRunConfigs,
    addBeforeLaunchStep, removeBeforeLaunchStep, removeRunConfigFromDialog, saveConfig, removeConfig,
  }
}
