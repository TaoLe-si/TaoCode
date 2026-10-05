// 工作区 / 项目的生命周期 —— 从 App.vue 搬出的一域（197 行，41 个依赖）。
//
// 判据：IDEA 把「打开/关闭一个 Project」和「最近项目列表」放在 `ProjectManager` +
// `RecentProjectsManagerBase` 里，TaoCode 的对应物就是这一条链路：
//   读应用状态（`refreshAppState`）→ 打开工作区（`openWorkspace`）→ 装配新工作区
//   （`activateWorkspace`：换根目录、清面板、重读项目设置、重建合成节点）
//   → 关闭（`closeWorkspace`）→ 最近项目增删（`forgetProjects`）→ 新建/克隆项目
//   （`beginProject` / `submitProject` / `cancelProject`）。
// 它们共享 `confirmLeave`（离开前的未保存确认）与同一批 `appError` / `busy` 状态，是一个闭环。
// 注意：`openFile`（编辑器骨架）、会话恢复（src/sessionSnapshot.ts）各自属于别的域。
import { ref } from 'vue'
import { importFoldState } from './editorFoldingState.ts'
import { cloneProgress, defaultGeneralSettings, defaultProjectSettings, isDesktop, normalizeEditorSettings, request,
         type AppState, type Entry, type GeneralSettingsState, type PluginList, type ProjectForm, type ProjectSettings, type Workspace } from './bridge.ts'
import type { SyntheticNode } from './components/FileTree.vue'
import { availableJdks } from './buildHost.ts'
import { externalLibraryEntries } from './externalLibraries.ts'
import { JAVA_SDK_TYPE, SdkTable, createSdk } from './rootsSdkTable.ts'
import { errorMessage } from './errors.ts'
import { normalizeSettingsShape } from './settingsInspector.ts'
import type { Tab } from './editorTab'
import { isProjectTrusted, mergeTrustEntries, needsTrustPrompt, rememberTrust, trustBlockReason,
         type TrustChoice, type TrustedPathEntry } from './trustedProjects.ts'
import { EnvironmentKeyRegistry, createHeadlessEnvironmentService } from './environmentKeys.ts'
import { checkRequiredEnvironmentKeysActivity, registerStartupActivity, resetStartupProgress,
         runStartupActivities, type StartupActivityContext } from './startupActivities.ts'
import { registerPreloadingActivity, runPreloadingActivities } from './preloadingActivities.ts'

/** 未保存修改的离开选择（IDEA `SaveDocumentsChoice`）。宿主也用它标注提示框，所以导出。 */
export type LeaveChoice = 'save' | 'discard' | 'cancel'

/** 工作区代次：宿主是 `let`（别的域也自增它），通过 getter/setter 共享同一份。 */
export interface EpochHolder { value: number }

export interface WorkspaceLifecycleDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  recentProjects: any
  editorSettings: any
  generalSettings: any
  gitAvailable: any
  defaultParent: any
  appError: any
  loading: any
  pluginList: any
  busy: any
  working: { readonly value: boolean }
  leavePrompt: any
  allTabs: { readonly value: Tab[] }
  save: (tab?: Tab) => Promise<boolean>
  resetLsp: () => void
  resetHierarchy: () => void
  workspace: any
  workspaceEpoch: EpochHolder
  closeAllPanes: () => void
  navBack: any
  navForward: any
  treeVersion: any
  places: any
  projectSettings: any
  bookmarks: any
  runConfigName: any
  selectRunConfig: (name?: string) => void
  /** 书签模块提供的项目设置写入（`useProjectSettings`）。 */
  useProjectSettings: (settings: ProjectSettings) => void
  offerSessionRestore: () => unknown
  menu: any
  palette: any
  notice: any
  binaryView: any
  projectError: any
  projectForm: any
  projectMode: any
  projectBusy: any
  cancelling: any
  /** 新建 Java 模板项目后自动开一个文件（编辑器骨架提供）。 */
  openFile: (path: string, internal?: boolean) => unknown
}

export function createWorkspaceLifecycle(deps: WorkspaceLifecycleDeps) {
  const { notify, isDesktop, recentProjects, editorSettings, generalSettings, gitAvailable, defaultParent, appError,
          loading, pluginList, busy, working, leavePrompt, allTabs, save, resetLsp, resetHierarchy, workspace,
          workspaceEpoch, closeAllPanes, navBack, navForward, treeVersion, places, projectSettings, bookmarks,
          runConfigName, selectRunConfig, useProjectSettings, offerSessionRestore, menu, palette, notice, binaryView,
          projectError, projectForm, projectMode, projectBusy, cancelling, openFile } = deps
// 受信任项目（IDEA `TrustedProjects` + `TrustedPaths`，落点见 src/trustedProjects.ts）：
// 打开陌生目录先问一次「信任 / 安全模式 / 取消」；勾了「以后不再询问」才写进应用级设置，
// 没勾的答案只活在本次会话（`sessionTrust`，关了应用就忘）。判定与门控文案都是纯函数。
const trustPrompt = ref<{ root: string; name: string } | null>(null)
let trustResolver: ((choice: TrustChoice, remember: boolean) => void) | null = null
const sessionTrust = ref<TrustedPathEntry[]>([])
function trustEntries(): TrustedPathEntry[] {
  return mergeTrustEntries(generalSettings.value?.trustedPaths, sessionTrust.value)
}
/** 执行入口问一句：`null` = 放行；字符串 = 拦住并用它提示（喂给 src/runActions.ts 的 `trustBlock`）。 */
function projectTrustBlock(action: string): string | null {
  return trustBlockReason(action, workspace.value?.root, trustEntries(), workspace.value?.name)
}
async function saveTrustedPaths(entries: TrustedPathEntry[]) {
  const previous = generalSettings.value
  generalSettings.value = { ...previous, trustedPaths: entries }
  try {
    generalSettings.value = await request<GeneralSettingsState>('settings.general.update', { general: generalSettings.value })
  } catch (error) {
    generalSettings.value = previous
    notify(`信任清单没有保存成功：${errorMessage(error)}`, true)
  }
}
/** 打开已就位的工作区之前问一次；`false` = 用户取消，调用方负责关掉刚打开的工作区。 */
async function confirmTrust(result: Workspace): Promise<boolean> {
  const root = result.root
  if (!isDesktop || !root) return true
  const entries = trustEntries()
  if (!needsTrustPrompt(root, entries)) {
    if (!isProjectTrusted(root, entries))
      notify(`已用安全模式打开 ${result.name || root}：未信任的项目不能构建、运行、调试或开终端。`)
    return true
  }
  if (trustPrompt.value) return true
  const [choice, remember] = await new Promise<[TrustChoice, boolean]>(resolve => {
    trustResolver = (nextChoice, nextRemember) => resolve([nextChoice, nextRemember])
    trustPrompt.value = { root, name: result.name || root }
  })
  trustPrompt.value = null
  trustResolver = null
  if (choice === 'cancel') return false
  if (remember) await saveTrustedPaths(rememberTrust(entries, root, choice === 'trust'))
  else sessionTrust.value = rememberTrust(sessionTrust.value, root, choice === 'trust')
  if (choice === 'distrust')
    notify(`已用安全模式打开 ${result.name || root}：构建、运行、调试与终端已禁用。`, true)
  return true
}
function resolveTrustPrompt(choice: TrustChoice, remember: boolean) { trustResolver?.(choice, remember) }
async function refreshAppState() {
  const state = await request<AppState>('app.state')
  recentProjects.value = state.recentProjects
  // 老版本把「不显示面包屑」编码进 breadcrumbsPlacement（三值），源码里位置只有上下两个值；
  // 在读盘这一处迁移回 showBreadcrumbs + placement，避免旧值在下次保存时被原生校验拒绝。
  editorSettings.value = normalizeEditorSettings(state.settings)
  // 与 editorSettings 同一处收口：旧版本留下的未知键、手改坏的类型不进内存（见 src/settingsInspector.ts）。
  generalSettings.value = normalizeSettingsShape(defaultGeneralSettings, state.general).value
  gitAvailable.value = state.gitAvailable
  defaultParent.value = state.defaultParent
  appError.value = ''
  return state
}
async function refreshRecent() {
  if (working.value) return
  busy.value = true
  try { await refreshAppState() }
  catch (error) { appError.value = errorMessage(error) }
  finally { busy.value = false }
}
// 启动活动的错误出口（上游 `StartupManagerImpl.runOldActivity` 记日志后继续；本仓按可见方式提示）。
function startupActivityContext(): StartupActivityContext {
  return { onError: (activity, error) => notify(`启动活动「${activity.id}」失败：${errorMessage(error)}`, true) }
}
async function bootstrap() {
  try {
    const state = await refreshAppState()
    loading.value = false
    // The welcome page shows the installed-plugin count next to its nav entry, so
    // the list is read once at startup; openPlugins() refreshes it afterwards.
    if (isDesktop) {
      try { pluginList.value = (await request<PluginList>('plugin.list')).plugins }
      catch { pluginList.value = [] }
    }
    // `configuration` 阶段的启动活动（上游 `StartupManagerImpl` 在项目打开前跑这一档）：
    // 目前只有 headless 环境的必需键检查（`CheckKeysStartupActivity`），没有注册键时是空跑。
    await runStartupActivities('configuration', startupActivityContext())
    // 预加载活动（上游 `PreloadingActivity`）：不阻塞加载，失败只记 Console。
    void runPreloadingActivities((activity, error) => { console.warn(`[preload] ${activity.id}`, error) })
    if (generalSettings.value.reopenLastProject && state.lastProject) await openWorkspace(state.lastProject)
  } catch (error) { appError.value = errorMessage(error) }
  finally { loading.value = false }
}
async function confirmLeave(title: string, scope = allTabs.value.filter(tab => tab.dirty)): Promise<boolean> {
  if (!scope.length) return true
  if (leavePrompt.value) return false
  const choice = await new Promise<LeaveChoice>(resolve => { leavePrompt.value = { title, paths: scope.map(tab => tab.path), resolve } })
  if (choice === 'cancel') return false
  if (choice === 'discard') return true
  for (const tab of scope) if (!await save(tab)) return false
  return true
}
function answerLeave(choice: LeaveChoice) {
  const prompt = leavePrompt.value
  leavePrompt.value = null
  prompt?.resolve(choice)
}
async function activateWorkspace(result: Workspace) {
  resetLsp()
  resetHierarchy()
  resetStartupProgress()
  workspaceEpoch.value++
  workspace.value = result
  closeAllPanes()
  navBack.value = []
  navForward.value = []
  treeVersion.value++
  places.value = []
  useProjectSettings(structuredClone(defaultProjectSettings))
  try {
    const loaded = await request<ProjectSettings>('project.settings.get')
    useProjectSettings(loaded)
    // 折叠状态跟着项目走（上游存在项目的 workspace 文件里）：读回来的那份灌进会话内存档，
    // 没有就清空（换项目时不能把上一个项目的折叠状态带过来）。
    importFoldState(loaded?.foldingState)
    await refreshAppState()
    selectRunConfig()
  } catch (error) { notify(`项目已打开，但读取设置失败：${errorMessage(error)}`, true) }
  // 项目级启动活动：`projectOpened` 先跑（同步类），再 `postStartup`（合成节点/会话恢复）。
  // token = 本次工作区（换项目就是新 token，活动重新跑一遍）；跑完 postStartup 才算
  // 「startup-activities 结束」（上游 `StartupActivityTracker`）。
  const startupToken = { workspace: result.root, epoch: workspaceEpoch.value }
  await runStartupActivities('projectOpened', startupActivityContext(), startupToken)
  await runStartupActivities('postStartup', startupActivityContext(), startupToken)
}
// IDEA's Project view keeps two synthetic nodes below the module: "External Libraries"
// and "Scratches and Consoles". 上游是 `ExternalLibrariesNode`
// (`platform/lang-impl/.../nodes/ExternalLibrariesNode.java:49`，由
// `ProjectViewProjectNode.java:89` 无条件挂上) 与 scratch 目录。
//
// 外部库的行由 `src/externalLibraries.ts` 算：把 `referencedLibraries` 的 glob 真的展开成
// 磁盘上存在的 jar，再加一行项目 SDK —— 口径与为什么这么排都写在那儿。scratches 仍然是
// 真实的 scratch/ 文件夹。
const syntheticNodes = ref<SyntheticNode[]>([])
/**
 * 本会话的 SDK 表（`ProjectJdkTable` 的等价物，`src/rootsSdkTable.ts`）。
 * 上游那张表是进程级单例（`ProjectJdkTable.java:28-30`），本仓跟着工作区会话重建 ——
 * 换项目时 `clear()` 后重新 `preconfigure`，避免上一个项目的 SDK 串过来。
 */
const sdkTable = new SdkTable()
async function refreshSyntheticNodes() {
  // 容器节点本身**无条件存在**，即使一行子节点都没有（上游 `getChildren()` 返空列表就完事，
  // 没有空状态占位；`ProjectViewPaneTest.kt:47-56` 就是这么断言的）。
  const libraries: SyntheticNode = { path: '\u0000libraries', label: '外部库', icon: 'libraries', entries: [] }
  try {
    const [files, jdk] = await Promise.all([
      request<{ files: string[] }>('workspace.files').then(result => result.files, () => [] as string[]),
      projectJdkForTree(),
    ])
    // jar 与 SDK 都是**叶子**：它们不对应工作区里的真实路径（`\u0000` 前缀就是"不落到磁盘"），
    // 所以必须报 kind:'file'，否则 FileTree 会去 workspace.list 展开一个不存在的目录。
    libraries.entries = externalLibraryEntries({
      files, patterns: projectSettings.value.java.referencedLibraries, jdk,
    })
  } catch { /* 老宿主没有 workspace.files：容器留着，只是空的 */ }
  const nodes: SyntheticNode[] = [libraries]
  try {
    const scratches = await request<Entry[]>('workspace.list', { path: 'scratch' })
    nodes.push({ path: '\u0000scratches', label: '临时文件与控制台', icon: 'scratches', entries: scratches.map(item => ({ ...item, path: item.path })) })
  } catch { /* scratch/ may not exist yet */ }
  syntheticNodes.value = nodes
}
/**
 * 树里显示的 SDK：口径与构建那条链一致（配置优先，否则用机器上探测到的），见 `src/buildHost.ts`。
 *
 * 这里顺带把探测结果灌进 `SdkTable`（`src/rootsSdkTable.ts`，`ProjectJdkTable` 的等价物）——
 * pm/roots ① 的缺口是「没有 SDK 对象与多 SDK 选择，只有 java 设置里的一个字符串」。
 * `preconfigure` 的语义照上游 `ProjectJdkTable.java:88-92`（「if none are configured」
 * 才自动探测），本表每个会话重建一次，所以进表的是本轮探测到的全部 SDK；
 * `ensureJdkForHome` 再把项目设置里那个 `jdkHome` 字符串接回同一张表
 * （上游没有这个方法，它是本仓把「配置面」与「实体面」缝合起来的那一步）。
 */
async function projectJdkForTree(): Promise<{ name: string; version: string; home: string } | null> {
  const configured = projectSettings.value.java.jdkHome?.trim() ?? ''
  const detected = await availableJdks()
  sdkTable.clear()
  sdkTable.preconfigure(detected.map(entry => createSdk(entry.name, JAVA_SDK_TYPE, entry.home, entry.version)))
  if (configured) {
    // 表里没有这个家目录就登记一条（名字取末段、版本留空 —— 探测不到就不编）。
    const sdk = sdkTable.ensureJdkForHome(configured)
    if (sdk) return { name: sdk.name, version: sdk.versionString, home: sdk.homePath }
    return { home: configured, version: '', name: '' }
  }
  // 没配就沿用宿主探测顺序的第一个（`native/jdk.cpp` 的 `find_all` 按路径排序，
  // 与上游 `JavaHomeFinderBasic` 的 TreeSet 同口径）。**刻意不用**
  // `findMostRecentSdkOfType` —— 那会按版本改掉「用哪个 JDK」，是行为变更不是接线。
  const first = sdkTable.getAllJdks()[0]
  return first ? { name: first.name, version: first.versionString, home: first.homePath } : null
}
async function openWorkspace(path?: string) {
  menu.value = null
  if (working.value || !await confirmLeave('切换项目')) return
  busy.value = true
  try {
    // The folder picker opens in the configured default project directory when there is one
    // and the host's suggestion otherwise (see defaultProjectParent()).
    const result = await request<Workspace | null>('workspace.open', path ? { path } : { initial: defaultProjectParent() })
    if (!result) return
    // 取消 = 不打开：宿主已经就位（语言服务也起了），所以要把刚打开的工作区关回去，
    // 否则欢迎页背后挂着一个用户拒绝了的项目（上游的 CANCEL 也是"不打开/不链接"）。
    if (!await confirmTrust(result)) { await request('workspace.close'); await refreshAppState(); return }
    await activateWorkspace(result)
    notify(isDesktop ? `已打开 ${result.root}` : '已打开内存示例；保存不会写入磁盘。')
  } catch (error) { appError.value = errorMessage(error); notify(errorMessage(error), true) }
  finally { busy.value = false }
}
async function closeWorkspace() {
  menu.value = null
  if (working.value || !await confirmLeave('关闭项目并返回欢迎页')) return
  busy.value = true
  try {
    // The user settled every dirty buffer on the way out (save or discard), so the
    // crash-recovery session must not survive as a phantom prompt. Cleared before
    // workspace.close empties the native root.
    if (isDesktop) void request('session.clear').catch(() => undefined)
    await request('workspace.close')
    resetLsp()
    resetHierarchy()
    resetStartupProgress()
    workspaceEpoch.value++
    workspace.value = null
    closeAllPanes()
    importFoldState(undefined)   // 关项目：折叠状态跟着项目走，别带进下一个
    projectSettings.value = structuredClone(defaultProjectSettings)
    bookmarks.value = []
    places.value = []
    runConfigName.value = ''
    binaryView.value = null
    palette.value = false
    notice.value = ''
    await refreshAppState()
  } catch (error) { notify(errorMessage(error), true) }
  finally { busy.value = false }
}
async function forgetProject(path: string) {
  return forgetProjects([path])
}
// Source: RecentProjectsManagerBase.removePath + removePathsFromGroups
// (platform-impl/.../RecentProjectsManagerBase.kt:270-301). IDEA fires one
// fireChangeEvent() per call; RemoveSelectedProjectsAction drives a batch call
// here, and the bridge wraps the loop into a single state mutation.
async function forgetProjects(paths: string[]) {
  if (working.value || paths.length === 0) return
  busy.value = true
  try {
    const state = await request<AppState>('projects.forgetMany', { paths })
    recentProjects.value = state.recentProjects
    notify(paths.length === 1
      ? '已从最近项目列表移除，磁盘文件未删除。'
      : `已从最近项目列表移除 ${paths.length} 项，磁盘文件未删除。`)
  } catch (error) { appError.value = errorMessage(error) }
  finally { busy.value = false }
}
// IDEA's "Default project directory" is a *local* preference (GeneralSettings.kt:223-225 and
// GeneralLocalSettings.kt:60-63, which is why the settings page calls it 默认项目目录) used by
// the welcome screen and the attach dialog when a project has to be placed somewhere new —
// WelcomeScreenProjectProvider.kt:231, AttachProjectAction.kt:73. It overrides the directory
// the host suggests (the OS documents folder, `defaultParent` from app.state), so an empty
// setting keeps today's behaviour.
function defaultProjectParent(): string {
  return generalSettings.value.defaultProjectDirectory.trim() || defaultParent.value
}
async function beginProject(mode: 'create' | 'clone') {
  menu.value = null
  if (working.value || !await confirmLeave(mode === 'create' ? '创建并打开新项目' : '克隆并打开项目')) return
  projectError.value = ''
  cloneProgress.splice(0)
  projectForm.value = { parent: defaultProjectParent(), name: 'untitled', template: 'empty', source: '' }
  projectMode.value = mode
}
async function browseParent() {
  if (busy.value || projectBusy.value) return
  busy.value = true
  try {
    // Re-open the picker where the form currently points (and in the configured default
    // project directory when the form is still empty).
    const start = projectForm.value.parent.trim() || defaultProjectParent()
    const path = await request<string | null>('dialog.pickDirectory', { initial: start })
    if (path) projectForm.value.parent = path
  } catch (error) { projectError.value = errorMessage(error) }
  finally { busy.value = false }
}
async function submitProject() {
  if (projectBusy.value || busy.value || !projectMode.value) return
  if (!isDesktop) { projectError.value = '请在桌面端创建或克隆项目，浏览器不访问磁盘。'; return }
  const mode = projectMode.value
  const form = { ...projectForm.value }
  projectBusy.value = true
  projectError.value = ''
  try {
    const result = await request<Workspace>(mode === 'create' ? 'project.create' : 'project.clone', form)
    // 克隆来的内容是外部的，按陌生项目问一次；新建项目是用户自己让 TaoCode 造的，
    // 上游 `CreateProjectTest` 断言新建项目默认就是受信任的 —— 直接记进清单。
    if (mode === 'clone' && !await confirmTrust(result)) { await request('workspace.close'); await refreshAppState(); return }
    if (mode === 'create' && isDesktop) await saveTrustedPaths(rememberTrust(trustEntries(), result.root, true))
    await activateWorkspace(result)
    projectMode.value = null
    notify(`${mode === 'create' ? '已创建' : '已克隆'}并打开 ${result.root}`)
    if (mode === 'create' && form.template === 'java') await openFile('src/Main.java', true)
  } catch (error) {
    // 失败必须看得见：`errorMessage` 对非 Error 值只会给出 `undefined` / `[object Object]`，
    // 那种情况下对话框里什么都不显示 —— 用户看到的就是"点了没反应"，最难排查（2026-09-27 桃报过）。
    const reason = errorMessage(error)
    projectError.value = reason && reason !== 'undefined' && reason !== '[object Object]'
      ? reason
      : `创建${mode === 'create' ? '' : '并克隆'}项目失败：宿主没有返回具体原因。请用「帮助 › 显示日志」看后台记录。`
  }
  finally { projectBusy.value = false; cancelling.value = false }
}
async function cancelProject() {
  if (!projectBusy.value) { projectMode.value = null; return }
  if (projectMode.value !== 'clone' || cancelling.value) return
  cancelling.value = true
  try { await request('project.clone.cancel') }
  catch (error) { projectError.value = errorMessage(error); cancelling.value = false }
}
// 内置启动活动（上游的 EP 贡献者在本仓没有宿主，这里是显式注册的三条）：
//   · `configuration`：headless 必需键检查（`CheckKeysStartupActivity`，没有注册键时是空跑）；
//   · `postStartup`：合成节点（外部库/临时文件）与会话恢复询问 —— 原先是在 `activateWorkspace`
//     里直接调的两行，现在按启动序列跑（顺序、每个活动一次、失败互不打断）。
const environmentKeys = new EnvironmentKeyRegistry()
registerStartupActivity(checkRequiredEnvironmentKeysActivity({
  headless: () => !isDesktop,
  service: createHeadlessEnvironmentService({ registry: environmentKeys,
    warn: message => { console.warn(`[environment] ${message}`) } }),
  providers: [],   // 本仓还没有键提供方（EnvironmentKeyProvider EP）：真实工程里由插件/宿主贡献
  report: message => { notify(`缺少必需的环境键：\n${message}`, true) },
}))
registerStartupActivity({ id: 'taocode.refreshSyntheticNodes', phase: 'postStartup', run: () => refreshSyntheticNodes() })
registerStartupActivity({ id: 'taocode.offerSessionRestore', phase: 'postStartup', run: () => { void offerSessionRestore() } })
// 预加载活动（上游 `PreloadingActivity`）：启动时把 JDK 探测热起来（`availableJdks` 一次会话探一次，
// 首次交互/项目树/构建都用它，别让第一下点开等探测）。失败由 `runPreloadingActivities` 隔离。
registerPreloadingActivity({ id: 'taocode.warmJdkCache', preload: () => { void availableJdks() } })
  return {
    refreshAppState, refreshRecent, bootstrap, confirmLeave, answerLeave, activateWorkspace,
    syntheticNodes, refreshSyntheticNodes, openWorkspace, closeWorkspace, forgetProject, forgetProjects,
    defaultProjectParent, beginProject, browseParent, submitProject, cancelProject,
    trustPrompt, resolveTrustPrompt, projectTrustBlock,
  }
}
