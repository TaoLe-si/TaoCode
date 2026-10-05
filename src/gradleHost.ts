// Frontend Gradle domain: linked build directories own models; one native CLI channel is queued.
// Source: ExternalProjectsViewImpl/ProjectNode, GradleSettings.linkedProjectsSettings,
// ExternalSystemViewDefaultContributor (Tasks/Dependencies), GradleWarmupConfigurator.linkRootProject.
import { computed, ref, watch, type Ref } from 'vue'
import { gradleFinishedNoticeOf, gradleRunningNoticeOf, type NotifyProgress } from './progressNotices.ts'
import { gradleSync, request, type Entry, type ProjectSettings, type Workspace } from './bridge.ts'
import { errorMessage } from './errors.ts'
import {
  DEFAULT_BUILD_TOOLS, EMPTY_GRADLE_SYNC, GRADLE_BUILD_FILE_SUFFIXES, GRADLE_DEPENDENCIES_TASK, GRADLE_WRAPPER_PROPERTIES,
  canLinkGradleProject, dependenciesByProject, gradleCommand, gradleConfigFile, gradleDirectoryTask,
  gradleEnvironment, gradleFailure, gradleProjectDirectory, detectGradle, isGradleBuildScript,
  gradleTaskProjectDisplayName, gradleTaskShortName,
  parseGradleDependencies, parseGradleProjects, parseGradleTasks, shouldAutoReload, tasksByGroup,
  type AutoReloadType, type BuildToolsGradleSettings, type BuildToolsSettings, type GradleDependencyScope,
  type GradleDetection, type GradleLinkedProject, type GradleSyncResult, type GradleTaskNode,
} from './gradle.ts'
import {
  createExternalProjectRegistry, externalProjectDependencyGroups, externalProjectInfoOf,
  externalProjectTaskGroups, GRADLE_SYSTEM,
} from './externalSystemModel.ts'
import { gradleSyncTasks, ignoredExternalProjects } from './externalSystemViewOptions.ts'
import { loadTasksActivation, tasksForPhase } from './externalProjectModel.ts'
import { generateExternalSystemTaskName } from './externalSystemTask.ts'
// 重名去重的候选序（上游 `service/project/nameGenerator/` 四个类，见那边的文件头）：
// 本仓没有 Module 对象图，所以这条链落在**用户可见的标识**上 —— 控制台标签与运行配置名。
import { chooseModuleName, moduleNameCandidates, moduleNamePathParts } from './externalSystemNameGenerator.ts'
import { createAutoImportNotifier } from './autoImportNotifications.ts'
import { backgroundTaskQueue } from './backgroundTasks.ts'
// 自动导入 API 层（上游 external-system-api 的 `autoimport`/`autolink`，见 esa/autoimport 判词）：
// tracker 按 (系统 id, 工程绝对路径) 登记 `ExternalSystemProjectAware`，构建脚本改动经它决定
// 「自动重载 / 出通知」，重载开始/结束驱动 `ExternalSystemProjectListener`；未链接工程的
// 链接/解除经 `ExternalSystemUnlinkedProjectAware` 登记表暴露（本仓没有插件 EP 宿主，
// 登记项由这里直接构造）。
import {
  createExternalSystemProjectTracker, createUnlinkedProjectRegistry, normalizeProjectPath, projectIdOf,
  type AutoImportModificationType, type ExternalRefreshStatus,
} from './externalSystemAutoImport.ts'
// 「自动链接未链接工程」的项目级开关（上游 `ExternalSystemUnlinkedProjectSettings.isEnabledAutoLink`，
// 默认 true、项目级持久，见 `src/externalSystemAutoLink.ts` 的坐标）—— 替掉下面的常量门控。
import { isAutoLinkEnabled } from './externalSystemAutoLink.ts'
// 设置文件**内容 CRC** 比对（上游 `AutoImportProjectSettingsFilesTracker` 的 oldCRC/新 CRC）：
// 「保存了但内容没变」不算改动，坐标与取数口径见 `src/externalSystemSettingsCrc.ts`。
import { calculateSettingsFilesCrc } from './externalSystemSettingsCrc.ts'
// 外部系统工程数据的**跨会话存储**（上游 `ExternalProjectsDataStorage.java:129-184` 的 load /
// `:231-261` 的 update / `:212-229` 的 doSave）：模型层在 `src/externalSystemDataStorage.ts`，
// 这里的消费点 = 打开工程时先拿上次会话的结构灌进面板（同步还没跑完就有一棵树），
// 每次导入成功后把模型写回存储。
import {
  createExternalProjectsDataStorage, restoredDependencies, restoredProjects, restoredTasks,
} from './externalSystemDataStorage.ts'

export interface GradleHostDeps {
  isDesktop: boolean
  workspace: Ref<Workspace | null>
  projectSettings: Ref<ProjectSettings>
  notify: (message: string, error?: boolean, onClick?: () => void, detail?: string[], displayId?: string,
           actions?: { label: string; run: () => void }[]) => void
  runInConsole: (command: string, label: string) => unknown
  isOpenInEditor: (path: string) => boolean
  openSettings: (section: 'build.tools' | 'reference.settingsdialog.project.gradle') => unknown
  openFile: (path: string) => unknown
  addRunConfiguration: (name: string, command: string) => unknown
  notifyProgress: NotifyProgress
  saveGradleSettings: (patch: BuildToolsGradleSettings) => Promise<unknown>
}

/** 同步任务串的**默认值**（实际值见 `src/gradleTaskActivations.ts` 的 `gradleSyncTasks()`：面板的
 *  「显示继承任务」开关决定末尾是 `--all` 还是不带）。 */
export const GRADLE_SYNC_TASKS = 'projects tasks --all'
export interface GradleViewContext {
  gradleDetection: GradleDetection | null
  gradleDetectionError: string
  gradleResult: GradleSyncResult
  gradleMessage: string
  gradleTaskGroups: Array<{ group: string; tasks: GradleTaskNode[] }>
  gradleDependencies: GradleDependencyScope[]
  gradleDependencyGroups: Array<{ project: string; scopes: GradleDependencyScope[] }>
  gradleAutoReload: AutoReloadType
  gradleLinkedProjects: string[]
  onGradleDetect: () => void
  onGradleUnlinkProject: (directory?: string) => void
  onGradleSync: () => void
  onGradleCancel: () => void
  onGradleRunTask: (task: string, directory?: string) => void
  onGradleRefreshProject: (directory?: string) => void
  onGradleLoadDependencies: (directory?: string) => void
  onGradleOpenConfig: (directory?: string) => void
  onGradleSaveRunConfig: (task: string, directory?: string) => void
  onGradleOpenSettings: (section: 'build.tools' | 'reference.settingsdialog.project.gradle') => void
}

export function gradleViewContext(
  host: ReturnType<typeof createGradleHost>,
  deps: { projectSettings: Ref<ProjectSettings>; openSettings: GradleHostDeps['openSettings'] },
): GradleViewContext {
  return {
    gradleDetection: host.detection.value, gradleDetectionError: host.detectionError.value,
    gradleResult: host.result.value, gradleMessage: host.message.value,
    gradleTaskGroups: host.taskGroups.value, gradleDependencies: host.dependencies.value,
    gradleDependencyGroups: host.dependencyGroups.value,
    gradleAutoReload: (deps.projectSettings.value.buildTools ?? DEFAULT_BUILD_TOOLS).autoReloadType,
    gradleLinkedProjects: [...host.linkedProjects.value],
    onGradleDetect: () => { void host.detect() },
    onGradleUnlinkProject: directory => { void host.unlinkProject(directory) },
    onGradleSync: () => { void host.sync() },
    onGradleCancel: () => { void host.cancel() },
    onGradleRunTask: (task, directory) => { void host.runTask(task, directory) },
    onGradleRefreshProject: directory => { void host.refreshProject(directory) },
    onGradleLoadDependencies: directory => { void host.loadDependencies(directory) },
    onGradleOpenConfig: directory => host.openConfig(directory),
    onGradleSaveRunConfig: (task, directory) => { void host.saveTaskAsRunConfig(task, directory) },
    onGradleOpenSettings: section => { void deps.openSettings(section) },
  }
}

type JobKind = 'sync' | 'dependencies'
interface Job { directory: string; root: string; epoch: number; kind: JobKind; done: () => void; cancelled?: boolean }
interface ActiveJob { job: Job; command: string; startedAt: number; cancelled: boolean; discard: boolean; accepted: boolean }

export function createGradleHost(deps: GradleHostDeps) {
  const buildTools = computed<BuildToolsSettings>(() => deps.projectSettings.value.buildTools ?? DEFAULT_BUILD_TOOLS)
  const linkedProjects = computed(() => [...new Set(buildTools.value.gradle.linkedProjects ?? [])])
  const projectDirectory = computed(() => linkedProjects.value[0] ?? '')
  const available = computed(() => linkedProjects.value.length > 0)
  const projects = ref<GradleLinkedProject[]>([])
  const busy = ref(false)
  const message = ref('')
  // 外部系统工程模型（上游 `ExternalProjectsDataStorage`）：每次导入登记一份 ExternalProjectInfo，
  // 工具窗口的任务/依赖分组从模型读出。version 让模型登记也能触发 computed 重算（registry 是普通 Map）。
  const externalProjects = createExternalProjectRegistry()
  const externalVersion = ref(0)
  // —— 跨会话的工程数据（上游 `ExternalProjectsDataStorage`）——
  // 存储面按工作区根分键落 localStorage（宿主 `file.write` 只写工作区内路径，缓存目录在工作区外，
  // 所以本仓用 localStorage；理由与 `src/externalSystemDataStorage.ts` 文件头一致）。
  const dataStorage = createExternalProjectsDataStorage()
  const storageStore = () => (typeof localStorage === 'undefined' ? null : localStorage)
  let cacheLoadedFor: string | null = null
  /** 上次导入**没成功**的那几个工程（`lastImportTimestamp != lastSuccessfulImportTimestamp`，`:158-160`）。 */
  const staleCacheDirectories = new Set<string>()
  let epoch = 0
  let active: ActiveJob | null = null
  let pumping = false
  let executing: Job | null = null
  const queue: Job[] = []
  const modelFor = (directory: string) => projects.value.find(project => project.directory === directory)
  const current = (root: string, generation: number) => deps.workspace.value?.root === root && epoch === generation
  /**
   * 某工程某阶段已激活的任务（`ExternalSystemTaskActivator.Phase`；表由面板写、这里读）。
   * 表按工作区根分键存在 localStorage（`src/externalProjectModel.ts`），键是链接目录。
   * 这是把「任务激活」从纯状态变成**真实执行**的消费点：同步链上跑 beforeSync/afterSync，
   * 构建/运行链在 `src/runActions.ts`（beforeCompile/beforeRebuild/beforeRun）。
   */
  function activationTasks(root: string, directory: string, phase: 'beforeSync' | 'afterSync'): readonly string[] {
    if (typeof localStorage === 'undefined') return []
    const map = loadTasksActivation(localStorage, root)
    const state = map[(directory ?? '').replace(/\\/g, '/').replace(/\/+$/, '')]
    return state ? tasksForPhase(state, phase) : []
  }
  const fromDirectory = (directory: string, path: string) => directory ? `${directory}/${path}` : path
  const detection = computed(() => modelFor(projectDirectory.value)?.detection ?? null)
  const detectionError = computed(() => modelFor(projectDirectory.value)?.detectionError ?? '')
  // Keep the existing result prop as the single view boundary; build roots carry independent namespaces.
  const result = computed<GradleSyncResult>(() => ({
    ...(modelFor(projectDirectory.value)?.result ?? EMPTY_GRADLE_SYNC),
    linkedProjects: projects.value, workspaceRoot: deps.workspace.value?.root ?? '', busy: busy.value,
    at: Math.max(0, ...projects.value.map(project => project.result.at)),
  }))
  const taskGroups = computed(() => {
    void externalVersion.value
    const info = externalProjectInfoFor(projectDirectory.value)
    // 模型缺席（尚未导入）时回退到原始纯函数；两者输出同形，渲染不变。
    return info ? externalProjectTaskGroups(info) : tasksByGroup(result.value.tasks)
  })
  const dependencies = computed(() => modelFor(projectDirectory.value)?.dependencies ?? [])
  const dependencyGroups = computed(() => {
    void externalVersion.value
    const info = externalProjectInfoFor(projectDirectory.value)
    return info ? externalProjectDependencyGroups(info) : dependenciesByProject(dependencies.value)
  })
  // 外部系统的「项目结构已更改」通知（`AutoImportProjectTracker.kt:220-223` 的 notificationNotify 分支
  // 加 `AutoImportProjectNotificationAware`/`ProjectRefreshAction`/`HideProjectRefreshAction`）：
  // 自动重载没跑而构建脚本已改时挂一条带「同步更改 / 隐藏此通知」的通知；
  // 点「同步更改」= 上游 `scheduleProjectRefresh` 的显式重载，走后台任务队列（连点排一条）。
  const autoImport = createAutoImportNotifier({
    notify: (message, error, onClick, detail, displayId, actions) =>
      deps.notify(message, error, onClick, detail, displayId, actions),
    reload: () => {
      void backgroundTaskQueue.run({
        title: '同步 Gradle 项目更改',
        onCancel: () => { void cancel() },
        run: async () => { await sync() },
      })
    },
  })

  /** 链接目录 → 绝对路径（模型按绝对路径登记，与上游 `ExternalProjectInfo.externalProjectPath` 同口径）。 */
  function externalProjectPathOf(directory: string): string {
    const root = deps.workspace.value?.root ?? ''
    return directory ? `${root}/${directory}` : root
  }
  function externalProjectInfoFor(directory: string) {
    return externalProjects.getExternalProjectInfo(GRADLE_SYSTEM, externalProjectPathOf(directory))
  }
  /** 外部绝对路径 → 本仓的链接目录（`externalProjectPathOf` 的反向）。认不出返回 null。 */
  function directoryOfExternalPath(path: string): string | null {
    const root = deps.workspace.value?.root ?? ''
    if (!root) return null
    const normalized = path.replace(/\\/g, '/')
    if (normalized === root) return ''
    return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : null
  }
  /**
   * 打开工程时先把**上次会话的结构**灌进面板（上游 `ExternalProjectsDataStorage.load`，`:129-184`：
   * 缓存里的 `ExternalProjectInfo` 直接喂视图，等真导入完成再换新的）。
   * 校验不过的那条不恢复（`:203-209` 的 `validate` + `:152-167` 的 markDirty 在本仓退成
   * 「这条不要 + 标脏」）；上次导入失败的仍恢复，但面板上写明结构可能已过期。
   */
  function restoreFromCache(): void {
    const root = deps.workspace.value?.root ?? ''
    if (!root) return
    if (cacheLoadedFor !== root) {
      const { restored, invalid } = dataStorage.load(storageStore(), root)
      cacheLoadedFor = root
      staleCacheDirectories.clear()
      for (const info of invalid) {
        const directory = directoryOfExternalPath(info.externalProjectPath)
        if (directory !== null) staleCacheDirectories.add(directory)
      }
      // 失效条目的处理上游是 markDirty + 重导入；本仓这里把它剔出内存清单，
      // 下一次 `updateModels` 就不会再拿它当结构。
      for (const info of restored.filter(item => !dataStorage.validate(item))) dataStorage.remove(info.systemId.id, info.externalProjectPath)
    }
    for (const info of dataStorage.list(GRADLE_SYSTEM.id)) {
      const directory = directoryOfExternalPath(info.externalProjectPath)
      if (directory === null || !linkedProjects.value.includes(directory)) continue
      const project = modelFor(directory)
      if (!project || project.result.at || project.result.projects.length) continue // 已经同步过，别拿旧结构盖
      project.result = { ...project.result, projects: restoredProjects(info), tasks: restoredTasks(info) }
      project.dependencies = restoredDependencies(info)
      project.message = staleCacheDirectories.has(directory)
        ? '上次会话的结构；上次导入没有成功，结构可能已过期'
        : '上次会话的结构，同步后刷新'
      // 任务/依赖分组优先读登记表（`taskGroups` / `dependencyGroups` 那两条），所以缓存也要登记进去。
      externalProjects.setExternalProjectInfo(info)
    }
    if (projects.value.some(project => project.result.projects.length)) ++externalVersion.value
  }
  function registerExternalProject(directory: string, importedAt: number, error: string, model: GradleLinkedProject): void {
    const info = externalProjectInfoOf({
      systemId: GRADLE_SYSTEM, projectPath: externalProjectPathOf(directory), importedAt,
      projects: model.result.projects, tasks: model.result.tasks, dependencies: model.dependencies,
      ...(error ? { error, previous: externalProjectInfoFor(directory) } : {}),
    })
    externalProjects.setExternalProjectInfo(info)
    ++externalVersion.value
    // 每次导入都写回跨会话存储（上游 `update` + `doSave` 的「真变过才排一次保存」，`:318-322`）。
    dataStorage.update(info)
    const root = deps.workspace.value?.root ?? ''
    if (root && dataStorage.hasChanges()) dataStorage.save(storageStore(), root)
  }

  // —— 自动导入 API 层（`esa/autoimport` 族）——
  // 上游 `ExternalSystemProjectTracker.getInstance(project)`：本仓每个宿主一个实例，按
  // (系统 id, 工程绝对路径) 登记。登记项的 `settingsFiles` 是检测到的构建/设置脚本，
  // `reloadProject` 就是本域排一次同步 —— 上游由构建系统回调，本仓由 Gradle 域自己当那个系统。
  const autoImportTracker = createExternalSystemProjectTracker({
    autoReloadType: () => buildTools.value.autoReloadType,
  })
  /** 未链接工程登记表（`autolink` 族）：本仓只有 Gradle 一个登记项，由域内直接构造。 */
  const unlinkedProjects = createUnlinkedProjectRegistry()
  unlinkedProjects.register({
    systemId: GRADLE_SYSTEM.id,
    buildFileExtensions: () => GRADLE_BUILD_FILE_SUFFIXES,
    isBuildFile: path => isGradleBuildScript(path),
    isLinkedProject: (projectState, externalProjectPath) => {
      const path = normalizeProjectPath(externalProjectPath)
      const directory = isGradleBuildScript(path) ? gradleProjectDirectory(path) : path
      return projectState.linkedProjects.includes(directory)
    },
    linkAndLoadProject: externalProjectPath => { void linkProject(externalProjectPath) },
    unlinkProject: externalProjectPath => { void unlinkProject(normalizeProjectPath(externalProjectPath)) },
    subscribe: () => { /* 本仓没有插件订阅者；监听表由 tracker 的 subscribe 承担 */ },
  })
  /** 链接目录变化时同步登记/摘除 tracker 里的工程（`register` 语义：换 aware 不丢监听器）。 */
  function trackLinkedProjects(): void {
    const tracked = new Set<string>()
    for (const directory of linkedProjects.value) {
      const id = projectIdOf(GRADLE_SYSTEM.id, externalProjectPathOf(directory))
      tracked.add(id.externalProjectPath)
      autoImportTracker.register({
        projectId: id,
        settingsFiles: () => {
          const detection = modelFor(directory)?.detection
          return [...(detection?.buildFiles ?? []), ...(detection?.settingsFiles ?? [])].map(path => externalProjectPathOf(fromDirectory(directory, path)))
        },
        reloadProject: () => { void sync(directory) },
      })
      autoImportTracker.activate(id)
    }
    for (const id of autoImportTracker.registeredProjects())
      if (id.systemId === GRADLE_SYSTEM.id && !tracked.has(id.externalProjectPath)) autoImportTracker.remove(id)
  }

  function updateModels() {
    projects.value = linkedProjects.value.map(directory => modelFor(directory) ?? {
      directory, detection: null, detectionError: '', result: { ...EMPTY_GRADLE_SYNC },
      dependencies: [], dependenciesLoaded: false, message: '',
    })
    for (let index = queue.length - 1; index >= 0; index--)
      if (!linkedProjects.value.includes(queue[index]!.directory)) queue.splice(index, 1)[0]!.done()
    if (active && !linkedProjects.value.includes(active.job.directory)) {
      active.discard = true
      active.cancelled = true
      if (active.accepted) void cancelNative()
    }
  }

  async function detectDirectory(directory: string): Promise<GradleDetection | null> {
    const workspace = deps.workspace.value
    const generation = epoch
    if (!workspace) return null
    const model = modelFor(directory)
    try {
      const entries = await request<Entry[]>('workspace.list', { path: directory })
      if (!current(workspace.root, generation)) return null
      const names = entries.map(entry => directory ? entry.path.slice(directory.length + 1) : entry.path)
      let properties: string | null = null
      try {
        properties = (await request<{ content: string }>('file.read', { path: fromDirectory(directory, GRADLE_WRAPPER_PROPERTIES) })).content
        names.push(GRADLE_WRAPPER_PROPERTIES)
      } catch { /* No wrapper is a legitimate local Gradle build. */ }
      if (!current(workspace.root, generation)) return null
      const info = detectGradle(names, properties)
      if (model && modelFor(directory) === model) { model.detection = info; model.detectionError = '' }
      return info
    } catch (error) {
      if (current(workspace.root, generation) && model && modelFor(directory) === model) {
        model.detection = null
        model.detectionError = errorMessage(error)
      }
      return null
    }
  }

  /** Refresh detection for every linked directory, not just the first one. */
  async function detect(directory?: string): Promise<GradleDetection | null> {
    if (directory !== undefined) return detectDirectory(directory)
    const dirs = linkedProjects.value.length ? [...linkedProjects.value] : ['']
    const infos = await Promise.all(dirs.map(detectDirectory))
    return infos[0] ?? null
  }

  async function persistLinked(dirs: string[]): Promise<boolean> {
    const root = deps.workspace.value?.root
    const generation = epoch
    if (!root) return false
    try {
      await deps.saveGradleSettings({ ...buildTools.value.gradle, linkedProjects: dirs })
      return current(root, generation)
    } catch (error) {
      if (current(root, generation)) deps.notify(`无法保存 Gradle 链接设置：${errorMessage(error)}`, true)
      return false
    }
  }

  async function linkProject(path: string): Promise<void> {
    if (!canLinkGradleProject(path, linkedProjects.value)) return
    const directory = gradleProjectDirectory(path)
    deps.notify(directory ? `正在链接 Gradle 项目：${directory}` : '正在链接 Gradle 项目：项目根目录')
    if (!await persistLinked([...linkedProjects.value, directory])) return
    updateModels()
    await sync(directory)
  }

  /** Detach just the selected build; the other linked roots and their models survive. */
  async function unlinkProject(directory = projectDirectory.value): Promise<void> {
    if (!linkedProjects.value.includes(directory)) return
    if (await persistLinked(linkedProjects.value.filter(dir => dir !== directory))) updateModels()
  }

  function notifyFailure(directory: string, label: string, error: string): void {
    deps.notify(`${directory || '根项目'} · ${label}失败：${error}`, true, undefined, undefined, undefined, [
      { label: '重新同步', run: () => { void sync(directory) } },
      { label: '打开构建脚本', run: () => openConfig(directory) },
      { label: '构建工具设置', run: () => { void deps.openSettings('build.tools') } },
    ])
  }

  async function cancelNative(): Promise<void> {
    try { await request('gradle.cancel') }
    catch (error) { if (active && !active.discard) deps.notify(errorMessage(error), true) }
  }

  async function execute(job: Job): Promise<void> {
    const model = modelFor(job.directory)
    const info = await detectDirectory(job.directory)
    if (job.cancelled || !model || modelFor(job.directory) !== model || !current(job.root, job.epoch)) return
    if (!info?.isGradle) {
      model.message = model.detectionError || '这个目录里没有找到 Gradle 构建脚本。'
      model.result = { ...model.result, error: model.message }
      return
    }
    // 同步阶段的任务激活（上游 `ExternalSystemTaskActivator.Phase.BEFORE_SYNC`）：
    // 激活的任务拼在同一个 Gradle 调用里、排在 `projects tasks` 之前 —— CLI 下等价于
    // 「先跑这些任务再出工程模型」，且不引入第二条进程/竞态。任务串来自 `gradleSyncTasks()`
    // （面板的「显示继承任务」开关：开 = `projects tasks --all`，关 = `projects tasks`）。
    const beforeSync = job.kind === 'sync' ? activationTasks(job.root, job.directory, 'beforeSync') : []
    const task = job.kind === 'sync'
      ? [...beforeSync, gradleSyncTasks()].join(' ')
      : GRADLE_DEPENDENCIES_TASK
    const command = gradleCommand(info, buildTools.value.gradle, task)
    const owner: ActiveJob = { job, command, startedAt: 0, cancelled: false, discard: false, accepted: false }
    active = owner
    // 重载生命周期（上游 `ExternalSystemProjectListener.onProjectReloadStart/Finish`）：
    // 登记项的监听器在这两处被驱动；in-flight 期间设置文件事件按上游默认被忽略
    // （`isIgnoredSettingsFileEvent` 的 JUST_STARTED/IN_PROGRESS 分支）。
    const trackedId = projectIdOf(GRADLE_SYSTEM.id, externalProjectPathOf(job.directory))
    let reloadOutcome: ExternalRefreshStatus = 'CANCEL'
    if (job.kind === 'sync') autoImportTracker.beginReload(trackedId)
    const env = gradleEnvironment(buildTools.value.gradle, deps.projectSettings.value.java?.jdkHome ?? '')
    let finished = false
    let complete!: () => void
    const exit = new Promise<void>(resolve => { complete = resolve })
    // Install before sending: a fast process can emit started/output/exit before its request reply.
    // flush:sync observes starts even when the entire event batch shares one Vue render tick.
    const stop = watch(() => [gradleSync.running, gradleSync.command, gradleSync.startedAt, gradleSync.exit, gradleSync.at], () => {
      if (gradleSync.running && gradleSync.command === command) owner.startedAt = gradleSync.startedAt
      if (!owner.startedAt || gradleSync.running || gradleSync.exit === null || finished) return
      if (gradleSync.startedAt !== owner.startedAt || gradleSync.command !== command) return
      finished = true
      complete()
    }, { flush: 'sync' })
    try {
      const directory = job.directory
      const workspace = { root: job.root }
      const root = directory ? `${workspace.root}/${directory}` : workspace.root
      await request('gradle.sync', { root, command, ...(env.length ? { env } : {}) })
      owner.accepted = true
      if (owner.cancelled && !finished) await cancelNative()
      await exit
      if (owner.discard || !current(job.root, job.epoch) || modelFor(job.directory) !== model) return
      const output = gradleSync.output
      const error = owner.cancelled || gradleSync.cancelled ? '已取消。'
        : gradleFailure(output) || (gradleSync.exit === 0 ? '' : `Gradle 退出码 ${gradleSync.exit}`)
      reloadOutcome = owner.cancelled || gradleSync.cancelled ? 'CANCEL' : error ? 'FAILURE' : 'SUCCESS'
      if (job.kind === 'dependencies') {
        model.dependencies = error ? [] : parseGradleDependencies(output)
        model.dependenciesLoaded = !error
        model.message = error || `已加载依赖：${model.dependencies.length} 个配置。`
      } else {
        model.result = {
          projects: error ? model.result.projects : parseGradleProjects(output),
          tasks: error ? model.result.tasks : parseGradleTasks(output), command, error, at: gradleSync.at,
        }
        model.dependencies = []
        model.dependenciesLoaded = false
        model.message = error || `已同步：${model.result.projects.length} 个项目、${model.result.tasks.length} 个任务。`
      }
      // 导入完成 → 登记外部系统工程模型（失败导入保留上次成功的结构与时间戳）。
      registerExternalProject(job.directory, gradleSync.at, error, model)
      message.value = `${job.directory || '根项目'} · ${model.message}`
      // 同步后激活的任务（上游 `Phase.AFTER_SYNC`）：同步**成功**后依次跑；失败/取消不跑
      // （与上游只在导入成功后才触发同步后任务一致）。走与手工任务同一条 run 控制台通道。
      if (job.kind === 'sync' && !error && !owner.cancelled && !gradleSync.cancelled) {
        for (const activated of activationTasks(job.root, job.directory, 'afterSync')) {
          const activatedCommand = gradleCommand(info, buildTools.value.gradle, gradleDirectoryTask(activated, job.directory))
          deps.runInConsole(activatedCommand, generateExternalSystemTaskName({
            projectName: uniqueProjectDisplayName(activated, job.directory), taskNames: [gradleTaskShortName(activated)], executionName: undefined,
          }))
        }
      }
      if (error && !owner.cancelled && !gradleSync.cancelled) notifyFailure(job.directory, job.kind === 'sync' ? 'Gradle 同步' : '依赖加载', error)
      deps.notifyProgress(gradleFinishedNoticeOf(error, Math.max(0, Math.round((gradleSync.at - owner.startedAt) / 1000)), job.kind === 'dependencies' ? '依赖加载' : undefined))
    } catch (error) {
      reloadOutcome = 'FAILURE'
      if (current(job.root, job.epoch) && modelFor(job.directory) === model) {
        model.message = `无法启动：${errorMessage(error)}`
        model.result = { ...model.result, error: model.message }
        message.value = model.message
        deps.notify(model.message, true)
      }
    } finally {
      if (job.kind === 'sync') autoImportTracker.finishReload(trackedId, reloadOutcome)
      stop()
      if (active === owner) active = null
    }
  }

  async function pump(): Promise<void> {
    if (pumping || gradleSync.running) return
    pumping = true
    busy.value = true
    try {
      while (queue.length && !gradleSync.running) {
        const job = queue.shift()!
        executing = job
        try { if (current(job.root, job.epoch)) await execute(job) }
        finally { executing = null; job.done() }
      }
    } finally {
      pumping = false
      busy.value = queue.length > 0
    }
  }

  async function enqueue(kind: JobKind, directory?: string): Promise<void> {
    if (!deps.isDesktop) { deps.notify('浏览器预览不能运行 Gradle 同步，请在桌面端使用。', true); return }
    const root = deps.workspace.value?.root
    if (!root) { deps.notify('请先打开一个项目。', true); return }
    const dirs = directory === undefined ? [...linkedProjects.value] : [directory]
    // 被忽略的工程不刷新（上游 `IgnoreExternalProjectAction`：忽略后 `ExternalProjectRefresh` 不再跑它，
    // 直到用户「取消忽略」）。面板仍会把行画出来（收起），见 `visibleExternalProjects`。
    const ignored = ignoredExternalProjects.value
    const jobs = dirs.filter(dir => linkedProjects.value.includes(dir))
      .filter(dir => !ignored.includes(externalProjectPathOf(dir)))
      .filter(dir => {
      if (kind === 'dependencies' && modelFor(dir)?.dependenciesLoaded) return false
      return !queue.some(job => job.directory === dir && job.kind === kind && job.epoch === epoch)
        && !(active?.job.directory === dir && active.job.kind === kind && active.job.epoch === epoch)
    }).map(dir => new Promise<void>(done => { queue.push({ directory: dir, root, epoch, kind, done }) }))
    busy.value = queue.length > 0 || pumping
    void pump()
    await Promise.all(jobs)
  }

  async function sync(directory?: string): Promise<void> {
    // 重载已排上 ⇒ 撤下待同步通知（`AutoImportProjectTracker.kt:224-228` 的 notificationExpire 分支）。
    // `.id`：通知表按系统 id 字符串记账（`autoImportNotifications.ts`），`GRADLE_SYSTEM` 是模型身份对象。
    autoImport.expire(GRADLE_SYSTEM.id)
    await enqueue('sync', directory)
  }
  async function refreshProject(directory = projectDirectory.value): Promise<void> { await sync(directory) }
  async function loadDependencies(directory?: string): Promise<void> { await enqueue('dependencies', directory) }

  function openConfig(directory = projectDirectory.value): void {
    const file = gradleConfigFile(modelFor(directory)?.detection ?? null)
    if (!file) { deps.notify('没有找到可打开的 Gradle 构建脚本。', true); return }
    void deps.openFile(fromDirectory(directory, file))
  }

  /** Scope both wrapper executable and -p to the linked build when using the run console's root cwd. */
  async function taskCommand(task: string, directory: string): Promise<string | null> {
    const root = deps.workspace.value?.root
    const generation = epoch
    if (!root || !linkedProjects.value.includes(directory)) return null
    const info = modelFor(directory)?.detection ?? await detectDirectory(directory)
    if (!info?.isGradle || !current(root, generation)) return null
    const scoped = { ...info, wrapperScripts: [] }
    const command = gradleCommand(scoped, buildTools.value.gradle, gradleDirectoryTask(task, directory))
    if (buildTools.value.gradle.useGradleFrom !== 'wrapper' || !directory) return gradleCommand(info, buildTools.value.gradle, gradleDirectoryTask(task, directory))
    if (info.wrapperScripts.includes('gradlew.bat')) return command.replace(/^gradle /, `"${directory}/gradlew.bat" `)
    if (info.wrapperScripts.includes('gradlew')) return command.replace(/^gradle /, `"./${directory}/gradlew" `)
    return command
  }

  /**
   * 一个任务在**本工作区里唯一**的工程显示名。
   *
   * 上游那段是给 Module 起名（`AbstractIdeModifiableModelsProvider.java:125-135`：
   * 按候选序取第一个没被占用的名字），本仓没有 Module 对象图 ⇒ 同一个问题出现在
   * 用户能看见的那一层：链接了两个构建、两边都有 `:app:build` 时，控制台标签与
   * 「保存为运行配置」的名字会撞成 `app [build]`。候选序照上游：
   * 原名 → 逐段加父目录前缀（最多三段）→ `~1…~5`。
   * 分隔符取 `-`：上游那条按 `projectSettings.isUseQualifiedModuleNames()` 在 `.` 与 `-` 之间切
   * （`IdeModelsProviderImpl.java:107-110`），本仓的 Gradle 设置里**没有**这个开关
   * （`BuildToolsGradleSettings` 没这一栏），所以不猜、按非限定名那一档固定 `-`。
   */
  function uniqueProjectDisplayName(task: string, directory: string): string {
    const base = gradleTaskProjectDisplayName(task, directory)
    const taken = new Set(linkedProjects.value
      .filter(other => other !== directory)
      .map(other => gradleTaskProjectDisplayName(task, other)))
    if (!taken.has(base)) return base
    const candidates = moduleNameCandidates({
      name: base,
      pathParts: moduleNamePathParts(directory),
      delimiter: '-',
    })
    return chooseModuleName(candidates, taken) ?? base
  }

  /**
   * 任务的运行配置名（上游 `AbstractExternalSystemTaskConfigurationType.generateName`：
   * `工程名 [任务短名]`，例如 `:app:build` → `app [build]`）。控制台标签与「创建运行配置」
   * 用同一个名字 —— 上游控制台标题就是运行配置名（`ExternalSystemTaskLocation`）。
   */
  function taskRunName(task: string, directory: string): string {
    return generateExternalSystemTaskName({
      projectName: uniqueProjectDisplayName(task, directory),
      taskNames: [gradleTaskShortName(task)],
    })
  }
  async function runTask(task: string, directory = projectDirectory.value): Promise<void> {
    const command = await taskCommand(task, directory)
    if (command) deps.runInConsole(command, taskRunName(task, directory))
  }
  async function saveTaskAsRunConfig(task: string, directory = projectDirectory.value): Promise<void> {
    const command = await taskCommand(task, directory)
    if (command) deps.addRunConfiguration(taskRunName(task, directory), command)
  }

  async function cancel(): Promise<void> {
    queue.splice(0).forEach(job => job.done())
    if (executing) executing.cancelled = true
    if (!active) { busy.value = pumping; return }
    active.cancelled = true
    // If cancel races the request acknowledgement, execute() sends it once the host accepts.
    if (active.accepted) await cancelNative()
  }

  // ── 设置文件内容 CRC（上游 `AutoImportProjectSettingsFilesTracker`）──
  // 上游 `SettingsFilesStatus`（`AutoImportProjectSettingsFilesTracker.kt:264-285`）的 updated
  // **只收两表交集里 CRC 不同**的，所以「保存了但内容没变」的构建脚本不触发自动导入判定；
  // 算不出 CRC 的文件压根不进表（`calculateSettingsFilesCRC`，`:56-66`）。
  // 表按工作区根存 localStorage（上游那份是项目级 `@State`），换工程随 `autoImport.reset()` 一起清。
  let settingsCrc = new Map<string, number>()
  let settingsCrcRoot: string | null = null
  const settingsCrcKey = (root: string) => `taocode.externalSystem.settingsCrc.${root.replace(/\\/g, '/')}`
  function resetSettingsCrc(): void { settingsCrc = new Map(); settingsCrcRoot = null }
  /** 当前工程的那张表；换过工程就按新根从存储读回（`settingsCrcRoot` 为 null 表示还没读）。 */
  function settingsCrcFor(root: string): Map<string, number> {
    if (settingsCrcRoot === root) return settingsCrc
    settingsCrc = new Map()
    settingsCrcRoot = root
    if (typeof localStorage === 'undefined' || !root) return settingsCrc
    try {
      const parsed = JSON.parse(localStorage.getItem(settingsCrcKey(root)) ?? 'null') as Record<string, unknown> | null
      for (const [path, crc] of Object.entries(parsed ?? {}))
        if (typeof crc === 'number' && Number.isFinite(crc)) settingsCrc.set(path, crc)
    } catch { /* 存储不可用/脏值：本会话按「没见过该文件」走，与上游首次见到同一处理 */ }
    return settingsCrc
  }
  function saveSettingsCrc(root: string): void {
    if (typeof localStorage === 'undefined' || !root) return
    try { localStorage.setItem(settingsCrcKey(root), JSON.stringify(Object.fromEntries(settingsCrc))) }
    catch { /* 存不进去只影响跨会话命中，当前会话内照常比对 */ }
  }
  /** CRC 的取数通道：`file.read` 收的是**工作区相对路径**（`Workspace::read` 走
   *  `parse_relative` + 工作区边界校验），所以读用相对路径、存表用绝对路径（tracker 侧的口径）。 */
  async function readSettingsText(relative: string): Promise<string | null> {
    try { return (await request<{ content: string }>('file.read', { path: relative })).content }
    catch { return null }
  }

  async function onBuildFilesChanged(paths: readonly string[], afterVcsUpdate = false): Promise<boolean> {
    const root = deps.workspace.value?.root
    const generation = epoch
    let scripts = paths.filter(isGradleBuildScript).filter(path => linkedProjects.value.some(dir => !dir || path.startsWith(`${dir}/`)))
    if (!afterVcsUpdate && !paths.length) {
      const before = projects.value.map(project => [project.directory, project.detection?.buildFiles.join('\u0000')])
      await detect()
      if (!root || !current(root, generation)) return false
      scripts = projects.value.flatMap(project => before.find(([dir]) => dir === project.directory)?.[1] !== project.detection?.buildFiles.join('\u0000')
        ? (project.detection?.buildFiles ?? []).map(path => fromDirectory(project.directory, path)) : [])
    }
    const type = buildTools.value.autoReloadType
    // 决策经自动导入 API（上游 `ExternalSystemProjectTracker.markDirty`/`markDirtyInternal` 的
    // `isDisabledAutoReload` 矩阵，见 `autoReloadDecision`）：EXTERNAL/UNKNOWN → ALL/SELECTIVE 重载、
    // NONE 出通知；INTERNAL/HIDDEN → 只有 ALL 重载，其余出通知或只记脏。
    const modification: AutoImportModificationType = afterVcsUpdate || scripts.some(path => !deps.isOpenInEditor(path)) ? 'EXTERNAL' : 'INTERNAL'
    let reload = false
    let notify = false
    for (const directory of linkedProjects.value) {
      const own = scripts.filter(script => directory === '' || script.startsWith(`${directory}/`))
      if (!own.length) continue
      const id = projectIdOf(GRADLE_SYSTEM.id, externalProjectPathOf(directory))
      // 内容 CRC 过滤（上游口径，见上）：CRC 与上次相同 ⇒ 只是被保存、内容没变，不进 tracker。
      // 读不到内容的脚本（CRC 缺席）照旧送进 tracker —— 宁可不判定，不假装没改动。
      const crcTable = settingsCrcFor(root ?? '')
      const fresh = await calculateSettingsFilesCrc(own, readSettingsText)
      let seenCrc = false
      for (const script of own) {
        const path = externalProjectPathOf(script)
        const crc = fresh.get(script)
        if (crc !== undefined) {
          seenCrc = true
          if (crcTable.get(path) === crc) continue
          crcTable.set(path, crc)
        } else crcTable.delete(path)
        const decision = autoImportTracker.settingsFileChanged(id, path, 'UPDATE', modification)
        if (decision === 'reload') reload = true
        else if (decision === 'notify') notify = true
      }
      if (seenCrc) saveSettingsCrc(root ?? '')
    }
    // VCS 更新这一次没有逐文件的修改类型可用：用 gradle.ts 的三档适配器（与 tracker 的
    // autoReloadDecision 同口径）判——SELECTIVE 的「VCS 更新」那一条在这里接上。
    if (afterVcsUpdate && shouldAutoReload(type, { afterVcsUpdate })) reload = true
    if (reload) {
      await sync()
      return true
    }
    // 自动重载被禁用（NONE，或 SELECTIVE 下只有 IDE 内改动）时上游**不是静默跳过**：
    // 项目停在待同步状态并挂一条通知让用户显式点「同步更改」（AutoImportProjectTracker.kt:220-223）。
    // 只有真的改到构建/设置脚本才挂（`AutoImportProjectSettingsFilesTracker` 的判据）。
    if (notify) autoImport.invalidate(GRADLE_SYSTEM.id, GRADLE_SYSTEM.readableName)
    return false
  }
  function onVcsUpdated(): void { void onBuildFilesChanged([], true) }

  watch(() => gradleSync.output.length, () => {
    if (!active || active.discard || !gradleSync.running || gradleSync.command !== active.command) return
    deps.notifyProgress(gradleRunningNoticeOf(gradleSync.startedAt, gradleSync.output, gradleSync.command, Date.now()))
  })
  // A foreign operation may occupy the single channel; it never becomes one of our models.
  watch(() => gradleSync.running, running => { if (!running) void pump() })
  watch(linkedProjects, () => { updateModels(); trackLinkedProjects() }, { flush: 'sync' })
  watch(() => deps.workspace.value?.root ?? '', () => {
    ++epoch
    queue.splice(0).forEach(job => job.done())
    if (active) { active.discard = true; active.cancelled = true; if (active.accepted) void cancelNative() }
    projects.value = []
    message.value = ''
    // 登记表是**项目级**的（上游 ExternalProjectsDataStorage 随项目存）：换工作区要清空。
    externalProjects.clear()
    ++externalVersion.value
    // 待同步通知同样随项目走（上游通知挂在 project 的 notificationAware 上）。
    autoImport.reset()
    // CRC 表同理：换工程后上一张表不再可信，清掉（下次用到时按新根从 localStorage 读回）。
    resetSettingsCrc()
    // 跨会话的工程数据也按根分键：换根要重新 load 一次（`restoreFromCache` 里按根缓存加载状态）。
    cacheLoadedFor = null
    staleCacheDirectories.clear()
    updateModels()
    trackLinkedProjects()
    restoreFromCache()
    const root = deps.workspace.value?.root
    const generation = epoch
    if (!root) return
    void (async () => {
      const info = await detect()
      if (!current(root, generation)) return
      // Opening a project is an explicit scheduleProjectRefresh, independent of autoReloadType.NONE.
      // GradleWarmupConfigurator.kt:118-128 only auto-links the root; nested builds require Link Project.
      if (info?.isGradle && !linkedProjects.value.length) {
        // 自动链接的总开关是 `ExternalSystemUnlinkedProjectSettings.isEnabledAutoLink`
        // （上游 `UnlinkedProjectSettings.kt:9-23`，默认 true、**项目级持久**；唯一消费者是
        // `UnlinkedProjectStartupActivity.kt:51-54` 门控 `loadProjectIfSingleUnlinkedProjectFound`）。
        // 存储面在 `src/externalSystemAutoLink.ts`（上游没有设置页，所以本仓也不画控件）。
        const autoLink = isAutoLinkEnabled(typeof localStorage === 'undefined' ? null : localStorage, root)
        if (!autoLink) return
        if (!unlinkedProjects.shouldShowUnlinkedNotification(GRADLE_SYSTEM.id, autoLink)) return
        if (!await persistLinked([''])) return
        updateModels()
        trackLinkedProjects()
      }
      if (linkedProjects.value.length && deps.isDesktop) await sync()
    })()
  }, { immediate: true, flush: 'sync' })

  return {
    detection, detectionError, result, message, taskGroups, buildTools, available, linkedProjects, projectDirectory,
    projects, dependencies, dependencyGroups, reloading: busy,
    detect, sync, refreshProject, loadDependencies, openConfig, saveTaskAsRunConfig, cancel, runTask,
    linkProject, unlinkProject, onBuildFilesChanged, onVcsUpdated,
  }
}
