// RunManager frontend domain: stable project settings + session-only temporary producer snapshots.
// Source: RunManagerImpl.kt:589-628 (MRU), :1210-1235 (temporary/makeStable).
import { computed, ref, watch, type Ref } from 'vue'
import { request, runState, type Entry, type ProjectSettings, type RunConfig, type Workspace } from './bridge.ts'
import { errorMessage } from './errors.ts'
import { cloneRunConfig, discoverRunTargets, filesNeedingContent, rememberTemporary, runTargetConfiguration, stableRunConfig,
  type RunTarget, type RuntimeRunConfig } from './runTargets.ts'
import { runtimeOutputPaths } from './projectBuild.ts'
import { applyRunConfigSave, planRunConfigRemoval, runConfigClosure, runConfigReferrers, type RunConfigSaveOrigin } from './runConfigTree.ts'
import { normalizeRunConfigurations } from './runConfigurationSchema.ts'
// 那两个「启动时打开/聚焦运行面板」开关的上游默认（缺键补默认走的也是同一个入口，见 src/runStartupFocus.ts）。
import { ACTIVATE_TOOL_WINDOW_DEFAULT, FOCUS_TOOL_WINDOW_DEFAULT, runStartupFocusFlagsOf } from './runStartupFocus.ts'
import { matchLibraryGlob } from './buildHost.ts'
import { configIndexIn, orderRunConfigNames, rememberRecentConfiguration } from './runToolbar.ts'

export interface RunConfigurationsDeps {
  notify: (message: string, error?: boolean) => void
  workspace: Ref<Workspace | null>
  projectSettings: Ref<ProjectSettings>
  runCommand: Ref<string>
  menu: Ref<any>
  runSelectedConfig: (debug: boolean) => unknown
  isDesktop: boolean
}

export function createRunConfigurations(deps: RunConfigurationsDeps) {
  const { notify, workspace, projectSettings, runCommand, menu, runSelectedConfig } = deps
  const temporaryConfigs = ref<RuntimeRunConfig[]>([])
  const stableConfigs = computed(() => projectSettings.value.runConfigs)
  const runConfigs = computed<RuntimeRunConfig[]>(() => [...stableConfigs.value,
    ...temporaryConfigs.value.filter(config => !stableConfigs.value.some(stable => stable.name === config.name))])
  const runConfigName = ref('')
  const autoTargets = ref<RunTarget[]>([])
  const autoOnlyTargets = computed(() => autoTargets.value.filter(target => !runConfigs.value.some(config => config.name === target.name)))
  const allRunConfigNames = computed(() => [...runConfigs.value.map(config => config.name), ...autoOnlyTargets.value.map(target => target.name)])
  let discoveredRunRoot = ''
  let epoch = 0
  const current = (root: string, generation: number) => workspace.value?.root === root && epoch === generation

  async function discoverRunTargetsForProject(): Promise<void> {
    const selected = workspace.value
    const generation = epoch
    if (!selected || !deps.isDesktop || discoveredRunRoot === selected.root) return
    discoveredRunRoot = selected.root
    try {
      const files = (await request<{ files: string[] }>('workspace.files')).files
      if (!current(selected.root, generation)) return
      const contents: Record<string, string> = {}
      for (const path of filesNeedingContent(files)) {
        if (!current(selected.root, generation)) return
        try { contents[path] = (await request<{ content: string }>('file.read', { path })).content }
        catch { /* Unreadable producer inputs are not targets. */ }
      }
      if (!current(selected.root, generation)) return
      const java = projectSettings.value.java
      const classpath = files.filter(path => /\.jar$/i.test(path)
        && (java.referencedLibraries ?? []).some(pattern => matchLibraryGlob(pattern, path)))
      autoTargets.value = discoverRunTargets({ files, contents, java: {
        jdkHome: java.jdkHome ?? '', classpath,
        outputPaths: runtimeOutputPaths({
          layout: { gradle: files.some(path => /^(?:build|settings)\.gradle(?:\.kts|\.dcl|\.xdcl)?$/.test(path)),
            maven: files.includes('pom.xml'), cmake: files.includes('CMakeLists.txt'), java: true },
          gradleDelegated: projectSettings.value.buildTools?.gradle.delegatedBuild,
          outputPath: java.outputPath, projectName: selected.name ?? '',
        }),
      } })
      if (!runConfigName.value && autoTargets.value.length) selectRunConfig(autoTargets.value[0]!.name)
    } catch { if (current(selected.root, generation)) discoveredRunRoot = '' }
  }

  const runWidgetTitle = computed(() => runState.running ? '停止运行 (Ctrl+F2)' : `运行 ${runConfigName.value || '所选配置'} (Shift+F10)`)
  const configChooser = ref<{ debug: boolean } | null>(null)
  const configIndex = ref(0)
  // 运行 widget 的「最近配置」（RunManagerImpl.kt:589-628 的 MRU）：选择器把最近用过的排前面。
  const recentConfigNames = ref<string[]>([])
  const orderedRunConfigNames = computed(() => orderRunConfigNames(allRunConfigNames.value, recentConfigNames.value))
  function openConfigChooser(debug = false) {
    if (!allRunConfigNames.value.length) { notify('这个项目里没有发现可运行的目标：打开一个含 main 方法的源文件，或新建配置。', true); return }
    configIndex.value = configIndexIn(orderedRunConfigNames.value, runConfigName.value)
    configChooser.value = { debug }
  }
  function moveConfig(delta: number) {
    const count = orderedRunConfigNames.value.length
    if (count) configIndex.value = (configIndex.value + delta + count) % count
  }
  function applyConfigChoice(config: string | Pick<RunConfig, 'name'>) {
    const debug = configChooser.value?.debug ?? false
    configChooser.value = null
    pickConfig(typeof config === 'string' ? config : config.name)
    void runSelectedConfig(debug)
  }

  const runConfigType = ref<NonNullable<RunConfig['type']>>('shell')
  const runConfigMembers = ref<string[]>([])
  const runConfigProgram = ref('')
  const runConfigDebugAdapter = ref('cppvsdbg')
  const runConfigArgs = ref('')
  const originalArgs = ref<string[]>([])
  const runConfigCwd = ref('')
  const runConfigEnv = ref('')
  const originalEnv = ref<string[]>([])
  const runConfigBefore = ref<Array<{ name: string; command: string }>>([])
  const runConfigFolder = ref('')
  const runConfigParallel = ref(false)
  // 「启动时打开运行面板」/「启动时把焦点移到运行面板」——这两个值的**存放处是配置记录本身**
  // （上游 `RunnerAndConfigurationSettings.java:242`/`:256`，判据 tests/run-startup-focus.test.mjs 的「唯一真源」两条）。
  // 这里带着它们走一遍草稿：可编辑的那格在运行配置对话框（`src/components/RunConfigurationsDialog.vue`，
  // 对应上游 Before launch 那两格），但内联草稿也会整份重建记录 ⇒ 不在这里 passthrough 就等于
  // 「从内联面板存一次就把用户的开关悄悄清回默认」，那是第二个 bug，不是第二处真源。
  const runConfigActivateToolWindow = ref(ACTIVATE_TOOL_WINDOW_DEFAULT)
  const runConfigFocusToolWindow = ref(FOCUS_TOOL_WINDOW_DEFAULT)
  const selectedMetadata = ref<Pick<RuntimeRunConfig, 'temporary' | 'sourceTarget'>>({})
  const runConfigEditorOpen = ref(false)
  const runConfigDebug = ref(false)
  const runConfigsOpen = ref(false)
  const breakpointsOpen = ref(false)
  function linesToArray(text: string): string[] { return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean) }
  function arrayToLines(values: string[] | undefined): string { return (values ?? []).join('\n') }
  function argumentValues(): string[] {
    // Keep untouched structured argv exactly, including empty/whitespace args; the console editor is one argv per line.
    return runConfigArgs.value === arrayToLines(originalArgs.value) ? [...originalArgs.value]
      : runConfigArgs.value ? runConfigArgs.value.split(/\r?\n/) : []
  }
  function currentRunConfig(): RuntimeRunConfig {
    return {
      name: runConfigName.value.trim(), type: runConfigType.value, command: runCommand.value,
      program: runConfigProgram.value, args: argumentValues(), cwd: runConfigCwd.value,
      adapter: runConfigDebugAdapter.value, env: runConfigEnv.value === arrayToLines(originalEnv.value)
        ? [...originalEnv.value] : runConfigEnv.value.split(/\r?\n/).filter(line => line.trim()),
      beforeLaunch: runConfigBefore.value.map(step => ({ ...step })),
      folder: runConfigFolder.value.trim(), allowRunningInParallel: runConfigParallel.value,
      // 只把**非默认**值写进记录（上游写档 `RunnerAndConfigurationSettingsImpl.kt:317-321` 同一条规则），
      // 所以「从没动过开关」的配置记录形状与改造前逐字相同。
      ...(runConfigActivateToolWindow.value !== ACTIVATE_TOOL_WINDOW_DEFAULT
        ? { activateToolWindowBeforeRun: runConfigActivateToolWindow.value } : {}),
      ...(runConfigFocusToolWindow.value !== FOCUS_TOOL_WINDOW_DEFAULT
        ? { focusToolWindowBeforeRun: runConfigFocusToolWindow.value } : {}),
      ...(runConfigType.value === 'compound' ? { configurations: [...runConfigMembers.value] } : {}),
      ...(selectedMetadata.value.temporary ? { temporary: true } : {}),
      ...(selectedMetadata.value.sourceTarget ? { sourceTarget: { ...selectedMetadata.value.sourceTarget } } : {}),
    }
  }
  function load(config?: RuntimeRunConfig) {
    runConfigName.value = config?.name ?? ''
    runConfigType.value = config?.type ?? 'shell'
    runCommand.value = config?.command ?? ''
    runConfigProgram.value = config?.program ?? ''
    originalArgs.value = [...(config?.args ?? [])]
    runConfigArgs.value = arrayToLines(originalArgs.value)
    runConfigCwd.value = config?.cwd ?? ''
    runConfigEnv.value = arrayToLines(config?.env)
    runConfigBefore.value = (config?.beforeLaunch ?? []).map(step => ({ ...step }))
    runConfigFolder.value = config?.folder ?? ''
    runConfigParallel.value = config?.allowRunningInParallel === true
    // 读档语义照上游两行（`RunnerAndConfigurationSettingsImpl.kt:243-244`）：
    // 记录里缺 `activate` 键 ⇒ **true**、缺 `focus` 键 ⇒ false，缺键不是坏记录。
    runConfigActivateToolWindow.value = runStartupFocusFlagsOf(config).activateToolWindowBeforeRun
    runConfigFocusToolWindow.value = runStartupFocusFlagsOf(config).focusToolWindowBeforeRun
    runConfigDebugAdapter.value = config?.adapter || (config?.sourceTarget?.kind === 'java' ? 'java' : config?.sourceTarget?.kind === 'python' ? 'debugpy' : 'cppvsdbg')
    runConfigDebug.value = runConfigType.value === 'debug'
    selectedMetadata.value = config?.temporary ? { temporary: true, sourceTarget: config.sourceTarget } : {}
  }
  function selectRunConfig(name?: string) {
    const wanted = name ?? runConfigName.value
    const existing = runConfigs.value.find(config => config.name === wanted)
    const target = autoOnlyTargets.value.find(target => target.name === wanted)
    const config = existing ?? (target ? runTargetConfiguration(target) : runConfigs.value[0])
    if (config?.temporary) temporaryConfigs.value = rememberTemporary(temporaryConfigs.value, config)
    load(config)
  }
  function pickConfig(name: string) {
    recentConfigNames.value = rememberRecentConfiguration(recentConfigNames.value, name)
    selectRunConfig(name)
  }
  function loadRunConfigDraft(name: string) { selectRunConfig(name) }
  function addBeforeLaunchStep() { runConfigBefore.value = [...runConfigBefore.value, { name: '', command: '' }] }
  function removeBeforeLaunchStep(index: number) { runConfigBefore.value = runConfigBefore.value.filter((_, i) => i !== index) }
  const runConfigDraft = computed<RuntimeRunConfig>(() => currentRunConfig())

  async function persistRunConfigs(configs: RunConfig[], message: string): Promise<boolean> {
    const root = workspace.value?.root
    const generation = epoch
    if (!root) { notify('请先打开项目：运行配置随项目保存。', true); return false }
    try {
      // Session metadata never crosses the native known_keys validator.
      const saved = await request<{ settings: ProjectSettings; entries: Entry[] }>('project.settings.update',
        { runConfigs: configs.filter(config => !(config as RuntimeRunConfig).temporary).map(stableRunConfig) })
      if (!current(root, generation)) return false
      projectSettings.value = saved.settings
      workspace.value!.entries = saved.entries
      selectRunConfig()
      notify(message)
      return true
    } catch (error) { if (current(root, generation)) notify(errorMessage(error), true); return false }
  }
  async function saveRunConfigFromDialog(config: RunConfig, origin?: RunConfigSaveOrigin) {
    const stable = stableRunConfig(config)
    // 就地改名 / 副本插位 / 复合成员引用回写这三件事的规则（含与上游的差异）写在
    // `src/runConfigTree.ts` 的 `applyRunConfigSave`，判据 tests/run-config-rename.test.mjs。
    const { configs, renamed, previous } = applyRunConfigSave(stableConfigs.value, stable, origin)
    if (!await persistRunConfigs(configs, renamed
      ? `已重命名运行配置「${previous}」为「${stable.name}」`
      : `已保存运行配置「${stable.name}」`)) return
    // 临时那一份：改名的话旧名那条也要一起摘掉，否则它会以旧名字继续挂在树里。
    temporaryConfigs.value = temporaryConfigs.value.filter(entry => entry.name !== stable.name && entry.name !== previous)
    loadRunConfigDraft(stable.name)
  }
  async function removeRunConfigFromDialog(name: string) {
    if (!stableConfigs.value.some(config => config.name === name)) {
      temporaryConfigs.value = temporaryConfigs.value.filter(config => config.name !== name)
      selectRunConfig(); return
    }
    await persistRunConfigs(stableConfigs.value.filter(config => config.name !== name), `已删除运行配置「${name}」`)
  }
  function openRunConfigurations() { runConfigsOpen.value = true; menu.value = null }
  function openBreakpoints() { breakpointsOpen.value = true; menu.value = null }
  watch(runConfigDebug, debug => { if (debug) runConfigType.value = 'debug'; else if (runConfigType.value === 'debug') runConfigType.value = 'shell' })
  watch(runConfigType, type => { runConfigDebug.value = type === 'debug' })
  function saveConfig() {
    const config = currentRunConfig()
    if (!config.name) { notify('请填写配置名。', true); return }
    if (!config.command && !config.program) { notify('请填写命令或可执行程序。', true); return }
    for (const entry of config.env ?? [])
      if (!entry.includes('=') || entry.startsWith('=')) { notify(`环境变量要写成 KEY=VALUE：「${entry}」不合法。`, true); return }
    void saveRunConfigFromDialog(config)
  }
  function removeConfig() { void removeRunConfigFromDialog(runConfigName.value) }

  // Register only after the draft refs/functions exist: an immediate producer result may select a config.
  watch(() => workspace.value?.root ?? '', () => {
    ++epoch; discoveredRunRoot = ''; temporaryConfigs.value = []; autoTargets.value = []
    configChooser.value = null; configIndex.value = 0; load(stableConfigs.value[0])
    void discoverRunTargetsForProject()
  }, { immediate: true, flush: 'sync' })

  return {
    autoTargets, autoOnlyTargets, allRunConfigNames, orderedRunConfigNames, recentConfigNames, temporaryConfigs, runConfigs, runConfigName, runWidgetTitle,
    configChooser, configIndex, openConfigChooser, moveConfig, applyConfigChoice, runConfigType, runConfigProgram,
    runConfigDebugAdapter, runConfigArgs, runConfigCwd, runConfigEnv, runConfigBefore, runConfigFolder,
    runConfigEditorOpen, runConfigDebug, runConfigsOpen, runConfigDraft, loadRunConfigDraft, saveRunConfigFromDialog,
    openRunConfigurations, breakpointsOpen, openBreakpoints, linesToArray, arrayToLines, currentRunConfig,
    selectRunConfig, pickConfig, persistRunConfigs, addBeforeLaunchStep, removeBeforeLaunchStep,
    removeRunConfigFromDialog, saveConfig, removeConfig, discoverRunTargetsForProject,
  }
}
