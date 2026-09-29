// Gradle 支持（前端状态域）—— IDEA Gradle 插件的「自动配置 / 同步 / 工具窗口」在 TaoCode 的对应物。
//
// 职责边界：
//   · 检测：`gradle.detect`（宿主扫目录）+ 读 wrapper 的 `distributionUrl`（`file.read`）→ `GradleDetection`。
//   · 同步：拼命令（`src/gradle.ts` 的 `gradleCommand`）→ `gradle.sync`；输出/退出码由
//     `bridge.gradleSync` 承接（宿主用独立的 `gradle.*` 事件通道推，不占运行控制台）。
//   · 解析：同步成功后把输出解析成项目树与任务树（`parseGradleProjects` / `parseGradleTasks`）。
//   · 依赖树：**展开时才加载**（对应 IDEA 的 `Dependencies` 节点是懒构建的），跑 `gradle dependencies`。
//   · 自动重新加载：构建脚本变化时按 `build.tools` 的三档语义决定要不要重同步。
//   · 工具窗口的三个动作：OpenConfig（打开构建脚本）/ RefreshProject（同步）/ CreateRunConfiguration。
//
// 纯逻辑（检测规则/命令/解析/三档语义）在 `src/gradle.ts`，这一层只管状态与通道。
import { computed, ref, watch, type Ref } from 'vue'
import { gradleFinishedNoticeOf, gradleRunningNoticeOf, type NotifyProgress } from './progressNotices.ts'
import { gradleSync, request, type Entry, type ProjectSettings, type Workspace } from './bridge.ts'
import { errorMessage } from './errors.ts'
import {
  DEFAULT_BUILD_TOOLS, EMPTY_GRADLE_SYNC, GRADLE_DEPENDENCIES_TASK, canLinkGradleProject, detectGradle,
  dependenciesByProject, gradleCommand, gradleConfigFile, gradleEnvironment, gradleFailure, gradleProjectDirectory,
  isGradleBuildScript, parseGradleDependencies, parseGradleProjects, parseGradleTasks, shouldAutoReload, tasksByGroup,
  type AutoReloadType, type BuildToolsGradleSettings, type BuildToolsSettings, type GradleDependencyScope,
  type GradleDetection, type GradleSyncResult, type GradleTaskNode,
} from './gradle.ts'

export interface GradleHostDeps {
  isDesktop: boolean
  workspace: Ref<Workspace | null>
  projectSettings: Ref<ProjectSettings>
  /** 通知（可带动作按钮，形状与 src/notices.ts 的 NoticeAction 一致）。 */
  notify: (message: string, error?: boolean, onClick?: () => void, detail?: string[], displayId?: string,
           actions?: { label: string; run: () => void }[]) => void
  /** 把一条命令丢进运行控制台（复用外部工具那条通道：`run.start` + 打开输出面板）。 */
  runInConsole: (command: string, label: string) => unknown
  /** 某个工作区相对路径此刻是否开在编辑器里（用来判断"这次改动是不是 IDE 内做的"）。 */
  isOpenInEditor: (path: string) => boolean
  /** 切到设置页（Gradle 面板上的「设置」按钮）。参数就是 IDEA 的 configurable id。 */
  openSettings: (section: 'build.tools' | 'reference.settingsdialog.project.gradle') => unknown
  /**
   * 在工作区里打开一个文件（`ExternalSystem.OpenConfig` 的落点：打开该工程的构建脚本）。
   * 路径是工作区相对路径。
   */
  openFile: (path: string) => unknown
  /**
   * 把一个 Gradle 任务存成运行配置（Task 右键里的 `ExternalSystem.CreateRunConfiguration`，
   * 也就是 `CreateAction`：把当前节点变成一个运行配置）。
   */
  addRunConfiguration: (name: string, command: string) => unknown
  /** 进度写进右下角的消息窗口（同一 displayId 就地刷新；见 src/progressNotices.ts）。 */
  notifyProgress: NotifyProgress
  /**
   * 落盘 Gradle 的工程级设置（这里只用到 `linkedProjects`）。
   * IDEA 把链接列表写进 `.idea/gradle.xml`（`GradleSettings.java:30-31` 的 `@Storage("gradle.xml")`），
   * TaoCode 的同等作用域是"项目级设置"，所以走同一条 `project.settings.update` 通道。
   */
  saveGradleSettings: (patch: BuildToolsGradleSettings) => Promise<unknown>
}

/** 同步时一次跑两个 Gradle 的"信息任务"（IDEA 走 Tooling API 拿整个模型，CLI 只能这样一次拿全）。 */
export const GRADLE_SYNC_TASKS = 'projects tasks --all'

/** `gradle/wrapper/gradle-wrapper.properties`（GradleConstants.GRADLE_WRAPPER_PROPERTIES_FILE_NAME）。 */
const WRAPPER_PROPERTIES = 'gradle/wrapper/gradle-wrapper.properties'

/** Gradle 工具窗口要的全部 ctx 字段（`ToolWindowViewContext` 里 `gradle*` 那一段）。 */
export interface GradleViewContext {
  gradleDetection: GradleDetection | null
  gradleDetectionError: string
  gradleResult: GradleSyncResult
  gradleMessage: string
  gradleTaskGroups: Array<{ group: string; tasks: GradleTaskNode[] }>
  gradleDependencies: GradleDependencyScope[]
  gradleDependencyGroups: Array<{ project: string; scopes: GradleDependencyScope[] }>
  gradleAutoReload: AutoReloadType
  /** 已链接的 Gradle 工程目录（`''` = 工作区根）。 */
  gradleLinkedProjects: string[]
  onGradleDetect: () => void
  onGradleUnlinkProject: () => void
  onGradleSync: () => void
  onGradleCancel: () => void
  onGradleRunTask: (task: string) => void
  onGradleRefreshProject: () => void
  onGradleLoadDependencies: () => void
  onGradleOpenConfig: () => void
  onGradleSaveRunConfig: (task: string) => void
  onGradleOpenSettings: (section: 'build.tools' | 'reference.settingsdialog.project.gradle') => void
}

/**
 * 把 Gradle 状态域接成工具窗口的 ctx 片段。
 *
 * 为什么单独一个函数：宿主（App.vue）那一层只该"展开"一次（`...gradleViewContext(...)`），
 * 而不是把十几个字段一个个抄一遍 —— 抄一遍就是一处漂移点。返回的对象结构与
 * `ToolWindowViewContext` 的 gradle 段一致，所以可以直接展开进 ctx 字面量。
 */
export function gradleViewContext(
  host: ReturnType<typeof createGradleHost>,
  deps: { projectSettings: Ref<ProjectSettings>; openSettings: GradleHostDeps['openSettings'] },
): GradleViewContext {
  const buildTools = () => (deps.projectSettings.value.buildTools ?? DEFAULT_BUILD_TOOLS).autoReloadType
  return {
    gradleDetection: host.detection.value,
    gradleDetectionError: host.detectionError.value,
    gradleResult: host.result.value,
    gradleMessage: host.message.value,
    gradleTaskGroups: host.taskGroups.value,
    gradleDependencies: host.dependencies.value,
    gradleDependencyGroups: host.dependencyGroups.value,
    gradleAutoReload: buildTools(),
    gradleLinkedProjects: [...host.linkedProjects.value],
    onGradleDetect: () => { void host.detect() },
    onGradleUnlinkProject: () => { void host.unlinkProject() },
    onGradleSync: () => { void host.sync() },
    onGradleCancel: () => { void host.cancel() },
    onGradleRunTask: task => { void host.runTask(task) },
    onGradleRefreshProject: () => { void host.refreshProject() },
    onGradleLoadDependencies: () => { void host.loadDependencies() },
    onGradleOpenConfig: () => host.openConfig(),
    onGradleSaveRunConfig: task => { void host.saveTaskAsRunConfig(task) },
    onGradleOpenSettings: section => { void deps.openSettings(section) },
  }
}

export function createGradleHost(deps: GradleHostDeps) {
  const detection = ref<GradleDetection | null>(null)
  /** 检测失败的原因（例如没有打开项目）；空 = 没出错。 */
  const detectionError = ref('')
  const result = ref<GradleSyncResult>({ ...EMPTY_GRADLE_SYNC })
  /** 细节：解析失败/取消的提示语（正常同步后为空）。 */
  const message = ref('')
  const taskGroups = computed(() => tasksByGroup(result.value.tasks))
  /**
   * 依赖树（IDEA 的 `Dependencies` 节点）：**空数组 = 还没加载**，UI 展开时调 `loadDependencies()`。
   * 一次同步会作废它（IDEA 同步后整棵树重建）。
   */
  const dependencies = ref<GradleDependencyScope[]>([])
  const dependencyGroups = computed(() => dependenciesByProject(dependencies.value))
  /** 上一次运行的是哪条命令 —— 退出时要按它选解析器（`gradleSync` 只有一条通道）。 */
  const runningKind = ref<'sync' | 'dependencies'>('sync')
  const buildTools = computed<BuildToolsSettings>(() => deps.projectSettings.value.buildTools ?? DEFAULT_BUILD_TOOLS)
  /** 已链接的 Gradle 工程目录（工作区相对路径；`''` = 工作区根）。 */
  const linkedProjects = computed(() => buildTools.value.gradle.linkedProjects ?? [])
  /**
   * 当前按哪个目录检测/同步。
   * ponytail: 只取**第一个**链接目录 —— TaoCode 的 Gradle 工具窗口是单工程形状（一份项目树 +
   * 一份任务表，`gradle.sync` 也只有一条一次跑一级的通道）。IDEA 的 `GradleSettings` 可以挂 N 个
   * `linkedProjectSettings` 并把每个都画成独立根节点；走到那一步要先给 GradleProjectNode /
   * GradleTaskNode 带上所属工程再改工具窗口的分组。上限：多工程链接时只同步第一个（列表里能看到全部）。
   */
  const projectDirectory = computed(() => linkedProjects.value[0] ?? '')
  /**
   * Gradle 工具窗口有没有 —— `AbstractExternalSystemToolWindowFactory.java:32-34`
   * `shouldBeAvailable = !getLinkedProjectsSettings().isEmpty()`：**有链接的工程**才可用，
   * 而不是"根目录看起来像 Gradle"。
   */
  const available = computed(() => linkedProjects.value.length > 0)

  /** 把目录内条目的"工作区相对路径"折回"目录相对路径"（`detectGradle` 与 wrapper 读取都按目录算）。 */
  const withinDirectory = (path: string) => (projectDirectory.value ? path.slice(projectDirectory.value.length + 1) : path)
  /** 目录相对 → 工作区相对。 */
  const fromDirectory = (path: string) => (projectDirectory.value ? `${projectDirectory.value}/${path}` : path)

  /**
   * 检测当前链接的 Gradle 工程（IDEA：`GradleWarmupConfigurator.linkRootProject` 只在**根目录**
   * 找 `build.gradle(.kts)`，`:118-128`；子目录里的工程由用户显式链接，见 `linkProject`）。
   *
   * 检测规则**只有一份**：`src/gradle.ts` 的纯函数 `detectGradle`（可单测）。
   * 这里只负责凑它的两个输入 —— 该目录的条目名（`workspace.list`）与 wrapper 文件的内容
   * （`file.read`）。宿主因此没有第二份 GradleConstants 表：native/gradle.cpp 只管跑命令。
   */
  async function detect(): Promise<GradleDetection | null> {
    const workspace = deps.workspace.value
    if (!workspace) { detection.value = null; detectionError.value = ''; return null }
    detectionError.value = ''
    try {
      const entries = await request<Entry[]>('workspace.list', { path: projectDirectory.value })
      const names = entries.map(entry => withinDirectory(entry.path))
      let wrapperProperties: string | null = null
      try {
        const file = await request<{ content: string }>('file.read', { path: fromDirectory(WRAPPER_PROPERTIES) })
        wrapperProperties = file.content
        // 读得到就说明这个文件存在 —— `detectGradle` 用名字判定 hasWrapper。
        names.push(WRAPPER_PROPERTIES)
      } catch { wrapperProperties = null }
      const info = detectGradle(names, wrapperProperties)
      detection.value = info
      return info
    } catch (error) {
      detection.value = null
      detectionError.value = errorMessage(error)
      return null
    }
  }

  /**
   * 「链接 Gradle 项目」（`Gradle.ImportExternalProject` → `ImportProjectFromScriptAction`）：
   * 拿构建脚本所在的**目录**去链接并同步（`actionPerformed` 里就是
   * `linkAndSyncGradleProject(project, virtualFile.parent.path)`）。
   * 可见性判据在 `canLinkGradleProject`（同一个文件的 `isVisible`），这里再查一次是防陈旧菜单。
   */
  async function linkProject(path: string): Promise<void> {
    if (!canLinkGradleProject(path, linkedProjects.value)) return
    const directory = gradleProjectDirectory(path)
    // 进度文案照上游那条：`gradle.linking.project=Linking Gradle Project`
    // （plugins/gradle/resources/messages/GradleBundle.properties:363）。
    deps.notify(directory ? `正在链接 Gradle 项目：${directory}` : '正在链接 Gradle 项目：项目根目录')
    // ponytail: 换链接 = 替换而不是追加（工具窗口是单工程形状，见 projectDirectory 的说明）。
    await persistLinked([directory])
    await detect()
    await sync()
  }

  /** 取消链接：回到"没有链接的工程"，工具窗口随之不可用（同 `shouldBeAvailable`）。 */
  async function unlinkProject(): Promise<void> {
    await persistLinked([])
    detection.value = null
    result.value = { ...EMPTY_GRADLE_SYNC }
    message.value = ''
  }

  async function persistLinked(dirs: string[]): Promise<void> {
    try {
      await deps.saveGradleSettings({ ...buildTools.value.gradle, linkedProjects: dirs })
    } catch (error) {
      deps.notify(`无法保存 Gradle 链接设置：${errorMessage(error)}`, true)
    }
  }

  /**
   * 跑一条 Gradle 命令（`sync` 与 `loadDependencies` 共用一条通道 —— 宿主的 SyncSession 同时只跑一条，
   * 这也与 IDEA 一致：一次只有一个 Gradle 调用）。
   */
  async function runCommand(task: string, kind: 'sync' | 'dependencies', what: string): Promise<void> {
    if (!deps.isDesktop) { deps.notify('浏览器预览不能运行 Gradle 同步，请在桌面端使用。', true); return }
    const workspace = deps.workspace.value
    if (!workspace) { deps.notify('请先打开一个项目。', true); return }
    if (gradleSync.running) { deps.notify('已有 Gradle 任务在进行中。', true); return }
    const current = detection.value ?? await detect()
    if (!current) { deps.notify(detectionError.value || '无法检测这个项目的 Gradle 配置。', true); return }
    const command = gradleCommand(current, buildTools.value.gradle, task)
    message.value = ''
    runningKind.value = kind
    // 「Gradle JVM」→ `JAVA_HOME`（IDEA 的 `GradleProjectSettings.getGradleJvm`）。
    const env = gradleEnvironment(buildTools.value.gradle, deps.projectSettings.value.java?.jdkHome ?? '')
    try {
      // Gradle 的当前工作目录 = **链接的那个工程目录**（IDEA 用 Tooling API 的
      // `forProjectDirectory(File)`，同样是目录而不是工作区根 —— 见 GradleConfigLocator 的类注释）。
      const directory = projectDirectory.value
      const root = directory ? `${workspace.root}/${directory}` : workspace.root
      await request('gradle.sync', { root, command, ...(env.length ? { env } : {}) })
      deps.notify(`已开始${what}：${command}`)
      // 消息窗口里立刻有这一行：`gradle.started` 事件与它是同一拍到的事，不用再等输出。
      deps.notifyProgress(gradleRunningNoticeOf(gradleSync.startedAt, gradleSync.output, command, Date.now()))
    } catch (error) {
      runningKind.value = 'sync'
      deps.notify(`无法启动${what}：${errorMessage(error)}`, true)
    }
  }

  /**
   * 失败通知自带的那几个动作按钮。上游的 Gradle 通知组就是 `displayType="STICKY_BALLOON"`
   * （`plugins/gradle/plugin-resources/intellij.gradle.xml:309`，组名 = `GradleBundle.properties:320`
   * `notification.group.gradle=Gradle`），而同一条通知是可以带按钮的：
   * `GradleBundle.properties:343-345` 的 Migrate / Ignore / Learn more，LSP 侧同形状在
   * `LspServerNotificationsHandlerImpl.kt:443-454`（addAction 里 `notification.expire()`）。
   * 「Learn more」那类要打开文档 URL，本仓没有对应的本地文档，就不放假链接。
   */
  function notifyFailure(label: string, error: string): void {
    deps.notify(`${label}失败：${error}`, true, undefined, undefined, undefined, [
      { label: '重新同步', run: () => { void sync() } },
      { label: '打开构建脚本', run: () => openConfig() },
      { label: '构建工具设置', run: () => { void deps.openSettings('build.tools') } },
    ])
  }

  /** IDEA 的「同步 Gradle 项目」`ExternalSystem.RefreshAllProjects`：把工程模型/任务列表刷新回来。 */
  async function sync(): Promise<void> { await runCommand(GRADLE_SYNC_TASKS, 'sync', '同步 Gradle 项目') }

  /**
   * `ExternalSystem.RefreshProject`（在某个工程节点上同步）：本仓只有单工作区，所以就是同一件事。
   */
  async function refreshProject(): Promise<void> { await sync() }

  /**
   * 加载依赖树（IDEA 的 `Dependencies` 节点在展开时才构建，见 `ExternalSystemViewDefaultContributor
   * .java:245-253` 的 `doBuildChildren`）。已经加载过就不重复跑 —— 要刷新得先同步。
   */
  async function loadDependencies(): Promise<void> {
    if (dependencies.value.length || gradleSync.running) return
    await runCommand(GRADLE_DEPENDENCIES_TASK, 'dependencies', '加载依赖')
  }

  /**
   * `ExternalSystem.OpenConfig`（`OpenExternalConfigAction`）：打开**这个工程的外部系统配置文件**。
   * 源码里走的是 `ExternalSystemNodeAction.getExternalConfig:76-92` —— 拿链接工程的**目录**，
   * 交给 `ExternalSystemConfigLocator.adjust()` 解析；Gradle 的实现是 `GradleConfigLocator.adjust`
   * （`GradleConfigLocator.java:26-50`），也就是 `build.gradle → build.gradle.kts → 任一 *.gradle`。
   * 本仓的 `detectGradle` 用的就是同一条规则，所以这里直接取检测结果里的第一个脚本。
   */
  function openConfig(): void {
    const file = gradleConfigFile(detection.value)
    if (!file) { deps.notify('没有找到可打开的 Gradle 构建脚本。', true); return }
    void deps.openFile(fromDirectory(file))
  }

  /** Task 右键的 `ExternalSystem.CreateRunConfiguration`（= `CreateAction`）：把任务存成运行配置。 */
  async function saveTaskAsRunConfig(task: string): Promise<void> {
    const workspace = deps.workspace.value
    if (!workspace) { deps.notify('请先打开一个项目。', true); return }
    const current = detection.value ?? await detect()
    if (!current) { deps.notify(detectionError.value || '无法检测这个项目的 Gradle 配置。', true); return }
    deps.addRunConfiguration(`Gradle · ${task}`, gradleCommand(current, buildTools.value.gradle, task))
  }

  async function cancel(): Promise<void> {
    try { await request('gradle.cancel') } catch (error) { deps.notify(errorMessage(error), true) }
  }

  /** 双击任务树里的任务 = IDEA 的 `GradleRunConfiguration`（这里复用运行控制台通道）。 */
  async function runTask(task: string): Promise<void> {
    const workspace = deps.workspace.value
    if (!workspace) { deps.notify('请先打开一个项目。', true); return }
    const current = detection.value ?? await detect()
    if (!current) { deps.notify(detectionError.value || '无法检测这个项目的 Gradle 配置。', true); return }
    deps.runInConsole(gradleCommand(current, buildTools.value.gradle, task), `Gradle · ${task}`)
  }

  /**
   * 构建脚本变化时按 `build.tools` 的三档决定要不要重同步
   * （`ExternalSystemProjectTrackerSettings.AutoReloadType`，见 src/gradle.ts）。
   *
   * @param paths 文件监听给出的工作区相对路径；**空数组表示这一批溢出了**（改动太多，宿主不再逐个列出）。
   *        溢出时不能凭空说"构建脚本变了" —— 那就重新检测一次，拿脚本清单与上次比对，
   *        真的变了才算变了（这比"溢出就同步"诚实，也比"溢出就什么都不做"有用）。
   * @param afterVcsUpdate VCS 更新（拉取/切换/变基/合并）触发的重载，见 `onVcsUpdated`。
   */
  async function onBuildFilesChanged(paths: readonly string[], afterVcsUpdate = false): Promise<boolean> {
    let scripts = paths.filter(isGradleBuildScript)
    if (!afterVcsUpdate && !paths.length) {
      const before = detection.value
      const after = await detect()
      if (!after || !before) return false
      const changed = after.buildFiles.join('\u0000') !== before.buildFiles.join('\u0000')
      if (!changed) return false
      scripts = [...after.buildFiles]
    }
    if (!afterVcsUpdate && !scripts.length) return false
    const type = buildTools.value.autoReloadType
    // TaoCode 的外部改动只从文件监听来；"IDE 内的编辑"＝这个脚本此刻正开在编辑器里
    // （IDEA 的 SELECTIVE 正是要区分这一点：VCS 更新必然重载，IDE 内的编辑不重载）。
    const outsideIde = scripts.length > 0 && scripts.some(path => !deps.isOpenInEditor(path))
    const changedBuildFile = scripts.length > 0
    if (!shouldAutoReload(type, { changedBuildFile, changedOutsideIde: outsideIde, afterVcsUpdate })) {
      if (changedBuildFile) deps.notify('检测到构建脚本改动，但「构建工具 › 自动重新加载项目」当前不会重载；可手动同步 Gradle 项目。')
      return false
    }
    await sync()
    return true
  }

  /** IDEA 的 `ExternalSystemProjectTracker`：VCS 更新后（拉取/切换/变基/合并）重同步。 */
  function onVcsUpdated(): void { void onBuildFilesChanged([], true) }

  // 跑的时候输出每来一批就刷一次那一行（"在动"就是这里看得见的）。
  watch(() => gradleSync.output.length, () => {
    if (!gradleSync.running) return
    deps.notifyProgress(gradleRunningNoticeOf(gradleSync.startedAt, gradleSync.output, gradleSync.command, Date.now()))
  })

  // 同步结束（gradleSync.at 变化 + 不再运行）就把输出解析成项目树/任务树。
  watch(() => gradleSync.at, () => {
    if (gradleSync.running || !gradleSync.at) return
    const output = gradleSync.output
    const failure = gradleFailure(output)
    const error = failure || (gradleSync.cancelled ? '已取消。' : gradleSync.exit === 0 ? '' : `Gradle 退出码 ${gradleSync.exit}`)
    if (runningKind.value === 'dependencies') {
      runningKind.value = 'sync'
      dependencies.value = error ? [] : parseGradleDependencies(output)
      message.value = error || `已加载依赖：${dependencies.value.length} 个配置。`
      deps.notifyProgress(gradleFinishedNoticeOf(error, elapsedSeconds(), '依赖加载'))
      if (error) notifyFailure('依赖加载', error)
      return
    }
    result.value = {
      projects: parseGradleProjects(output),
      tasks: parseGradleTasks(output),
      command: gradleSync.command,
      error,
      at: gradleSync.at,
    }
    // 一次同步 = 工程模型重建 ⇒ 之前加载的依赖树作废（IDEA 同步后整棵树是重建立的）。
    dependencies.value = []
    if (result.value.error) message.value = result.value.error
    else message.value = `已同步：${result.value.projects.length} 个项目、${result.value.tasks.length} 个任务。`
    if (result.value.error) notifyFailure('Gradle 同步', result.value.error)
    // 同一行从"进度"收成"结论"（displayId 相同，列表里位置不动）。
    deps.notifyProgress(gradleFinishedNoticeOf(result.value.error, elapsedSeconds()))
  })
  /** 本次同步跑了多少秒（结束行上的"用时"）。 */
  function elapsedSeconds(): number {
    return gradleSync.startedAt ? Math.max(0, Math.round((gradleSync.at - gradleSync.startedAt) / 1000)) : 0
  }

  // 换项目就重新检测并**自动同步一次**（IDEA 打开项目时会链接外部系统并拉一次工程模型 ——
  // 桃 2026-09-27 的原话「IDEA 本身会自动配置」）。
  //
  // 注意第一次同步**不受 `autoReloadType` 约束**：`AutoReloadType.NONE` 的文档明确写了
  // "turns off all auto-reloads, **except those explicitly requested by
  // `ExternalSystemProjectTracker.scheduleProjectRefresh`**"（ExternalSystemProjectTrackerSettings.kt:23-26），
  // 项目打开时的这次链接就属于那一类。`shouldAutoReload` 管的是**后续的构建脚本改动**。
  watch(() => deps.workspace.value?.root ?? '', () => {
    detection.value = null
    result.value = { ...EMPTY_GRADLE_SYNC }
    message.value = ''
    void (async () => {
      // 根目录有构建脚本 ⇒ 像 IDEA 那样**自动链接根工程**并同步一次
      // （`GradleWarmupConfigurator.kt:100-128`：先 `linkGradleHintProjects`，再 `linkRootProject`，
      // 后者只看根目录的 `build.gradle(.kts)`）。子目录里的工程**不自动**链接 —— 那是用户的
      // 「链接 Gradle 项目」动作（`linkProject`），与 IDEA 一致。
      const info = await detect()
      if (info?.isGradle && !linkedProjects.value.length) await persistLinked([''])
      if (info?.isGradle && deps.isDesktop) await sync()
    })()
  }, { immediate: true })

  return {
    detection, detectionError, result, message, taskGroups, buildTools, available,
    linkedProjects, projectDirectory,
    dependencies, dependencyGroups, reloading: computed(() => gradleSync.running),
    detect, sync, refreshProject, loadDependencies, openConfig, saveTaskAsRunConfig,
    cancel, runTask, linkProject, unlinkProject, onBuildFilesChanged, onVcsUpdated,
  }
}
