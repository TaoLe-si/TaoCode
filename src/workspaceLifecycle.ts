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
import { computed, nextTick, ref } from 'vue'
import { importFoldState } from './editorFoldingState.ts'
import { restoreCodeVisionSettings } from './codeLensSettings.ts'
// 快速文档两档的读盘点（键名 `showQuickDocOnMouseHover` / `autoUpdateDocumentation`）。
import { docHoverPolicyFromSettings } from './docHoverPolicy.ts'
import { cloneProgress, defaultGeneralSettings, defaultProjectSettings, isDesktop, normalizeEditorSettings, request,
         type AppState, type Entry, type GeneralSettingsState, type PluginList, type ProjectForm, type ProjectSettings, type Workspace } from './bridge.ts'
import type { SyntheticNode } from './components/FileTree.vue'
import { availableJdks } from './buildHost.ts'
import { externalLibraryEntries } from './externalLibraries.ts'
import { fileIconFor, registerFileIconProvider } from './ideViewExtensionPoints.ts'
import { JAVA_SDK_TYPE, SdkTable, createSdk } from './rootsSdkTable.ts'
import { errorMessage } from './errors.ts'
import { normalizeSettingsShape } from './settingsInspector.ts'
import type { Tab } from './editorTab'
import { isProjectTrusted, mergeTrustEntries, needsTrustPrompt, rememberSessionTrust, rememberTrust,
         applyTrustDecision, isProjectLocationOfferedForTrust, trustDecisionPaths,
         sessionTrustEntries, trustBlockReason,
         type ExternalLinkChoice, type TrustChoice, type TrustedPathEntry } from './trustedProjects.ts'
import { installExternalLinkGate, linkDialogIsMounted, openExternalUrl, type ExternalLinkPromptRequest } from './externalLinkLauncher.ts'
import type { AppInfo } from './helpActions.ts'
import { EnvironmentKeyRegistry, createHeadlessEnvironmentService } from './environmentKeys.ts'
import { environmentKeyProvidersFromExtensions } from './environmentKeyProviders.ts'
import { checkRequiredEnvironmentKeysActivity, registerStartupActivity, resetStartupProgress,
         runStartupActivities, type StartupActivityContext } from './startupActivities.ts'
import { registerPreloadingActivity, runPreloadingActivities } from './preloadingActivities.ts'
import { importRunAnythingRecentDirectories } from './runAnythingRecentDirectories.ts'
import { setSystemDateTimeFormats } from './dateTimeFormat.ts'
// 低层打开闸门（上游 `LowLevelProjectOpenProcessor`）：`openWorkspace` 发请求前先判一条路径能不能开。
import { projectOpenDecision } from './projectOpenCheck.ts'

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
  changePlaces: any
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

// ── `com.intellij.fileIconProvider`（上游 `Core.analyzer.xml:31`）的 bundled 两支 ──────
// 外部库与临时文件这两个合成根（上游对应 `PsiBasedFileIconProvider`（`lang.impl.xml:1155`）与
// `ScratchFileServiceImpl$FilePresentation`（`:911`）——本仓没有 `Icon`，给一个图标名串）。
// 第三方按同一 id 挂的 provider 优先级更高（`fileIconFor` 取第一个非空者），于是「原版插件给某个文件
// 换图标」在本仓有落点。合成的两个 `\u0000` 前缀路径不落到磁盘，只在这张表里。
//
// **为什么登记在模块加载时、而不是 `createWorkspaceLifecycle()` 体内**：bundled 贡献必须与宿主
// 的装配解耦 —— 与 `src/customFoldingProviders.ts` / `src/environmentKeyProviders.ts` 同一纪律
// （`extensionPoints.ts` 的注释里逐条登记着「在模块加载时挂成 bundled 贡献」）。原先这两行落在工厂
// 体内（本文件的工厂体不缩进，看不出来），于是**只有真正起过宿主**的进程里才有这两支 —— 判据
// `tests/ep-component-mount.test.mjs` 的「bundled 外部库图标 provider 仍在」因此长期是红的，
// 而真机表现完全正常，属于「靠运行路径侥幸成立」的那一类。
registerFileIconProvider({
  id: 'LibrariesFileIconProvider',
  getIcon: ({ path }) => (path === '\u0000libraries' ? 'libraries' : null),
})
registerFileIconProvider({
  id: 'ScratchFileIconProvider',
  getIcon: ({ path }) => (path === '\u0000scratches' ? 'scratches' : null),
})

export function createWorkspaceLifecycle(deps: WorkspaceLifecycleDeps) {
  const { notify, isDesktop, recentProjects, editorSettings, generalSettings, gitAvailable, defaultParent, appError,
          loading, pluginList, busy, working, leavePrompt, allTabs, save, resetLsp, resetHierarchy, workspace,
          workspaceEpoch, closeAllPanes, navBack, navForward, treeVersion, places, changePlaces, projectSettings, bookmarks,
          runConfigName, selectRunConfig, useProjectSettings, offerSessionRestore, menu, palette, notice, binaryView,
          projectError, projectForm, projectMode, projectBusy, cancelling, openFile } = deps
// 受信任项目（IDEA `TrustedProjects` + `TrustedPaths`，落点见 src/trustedProjects.ts）：
// 打开陌生目录先问一次「信任 / 安全模式 / 取消」；勾了「以后不再询问」才写进应用级设置，
// 没勾的答案只活在本次会话（关了应用就忘）。判定与门控文案都是纯函数。
//
// 会话级那一档**只有一份**，就是 `src/trustedProjects.ts` 里的 `sessionTrustedLocations`
// （宿主原先自留一个 `sessionTrust` ref，与模块那份是两处：对话框答「这次信任」在设置页看不见，
// 设置页改会话项也不影响执行侧门禁）。上游本来就只有一份 per 存储：确认框与设置页都走
// `TrustedPaths.getInstance()`（`platform/platform-impl/src/com/intellij/ide/impl/TrustedPaths.kt:25-28`），
// 设置页那张表是**两个存储并起来**的（`platform/platform-impl/src/com/intellij/ide/impl/TrustedHostsConfigurable.kt:66-71`）、
// 应用时按差集各回各家（同文件 `:80-89`）⇒ 本仓读写同一份模块级数组，行为与那两行等价。
const trustPrompt = ref<{ root: string; name: string } | null>(null)
let trustResolver: ((choice: TrustChoice, remember: boolean, trustAll: boolean) => void) | null = null
/**
 * IDE 自己的配置目录（`app.info` 的 `profile`，见 `src/helpActions.ts:23` 与
 * `native/diagnostics.cpp:81-88` 的 init(profile)）：trust-all 那一条门禁的输入
 * （`platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjects.kt:103-107`
 * —— 项目在配置目录里时**不提供**「信任这个位置」，理由同文件 `:98-102`：镜像项目共用父目录）。
 * 取不到（浏览器预览、`app.info` 失败）就是 null ⇒ 那一格不画：宁缺一格，不给假的一格。
 */
const trustConfigDir = ref<string | null>(null)
/** 勾选框可给性：本宿主接得住第三个回值（这一行就是「接得住」）+ 这一项允许被提供。 */
const trustCanTrustAll = computed(() =>
  Boolean(trustConfigDir.value) && isProjectLocationOfferedForTrust(trustPrompt.value?.root ?? '', trustConfigDir.value))
/** 门禁吃的清单 = 持久那一份 + 会话那一份（会话那份的真源在 `trustedProjects`）。 */
function trustEntries(): TrustedPathEntry[] {
  return mergeTrustEntries(generalSettings.value?.trustedPaths, sessionTrustEntries())
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
  const [choice, remember, trustAll] = await new Promise<[TrustChoice, boolean, boolean]>(resolve => {
    trustResolver = (nextChoice, nextRemember, nextTrustAll) => resolve([nextChoice, nextRemember, nextTrustAll])
    trustPrompt.value = { root, name: result.name || root }
  })
  trustPrompt.value = null
  trustResolver = null
  if (choice === 'cancel') return false
  // 勾了「以后不再询问」才落库；落哪几条路径由 `trustDecisionPaths` 判（`TrustedProjectsDialog.kt:64-73`
  // 的逐行等价物：答「信任并打开」记项目根，勾了 trust-all 且父目录不在配置目录里才**多记父目录**；
  // 答「安全模式」记 false 且不吃 trust-all；取消在上面那行就已经 return 了，什么都不记 = `:95`）。
  if (remember) await saveTrustedPaths(applyTrustDecision(entries, trustDecisionPaths(choice, root, trustAll, trustConfigDir.value)))
  else rememberSessionTrust(root, choice === 'trust')
  if (choice === 'distrust')
    notify(`已用安全模式打开 ${result.name || root}：构建、运行、调试与终端已禁用。`, true)
  return true
}
function resolveTrustPrompt(choice: TrustChoice, remember: boolean, trustAll: boolean) { trustResolver?.(choice, remember, trustAll) }
// ── 打开外部链接前的那一句（接线请求 welcome2 的 R2：上游 `browse()` 里那句 `canBrowse`）──
//
// 本仓的 URL 出口有五条（`src/App.vue` 的编辑器文档链接与「导出 HTML 后在浏览器里看」、
// 终端 Ctrl+单击、运行控制台的 URL 命中、快速文档「在浏览器里看」）。上游只有一个
// `BrowserLauncher.browse`，判定就长在它里面（`BrowserLauncherAppless.kt:99`）⇒ 这里把
// **门禁装进那条唯一的出口**（`src/externalLinkLauncher.ts`），五个调用点各自只交出一条 URL：
// 三个不在保留文件里的调用点本轮已经改完（TerminalPanel / RunConsole / quickDocHost），
// `src/App.vue` 那两处只剩把 `request('shell.openUrl', …)` 换成 `openExternalUrl(…)`（见接线请求）。
//
// 弹框复用 `TrustedProjectDialog.vue` 的 `mode="link"` 那一档（组件早就备着）。
/** 弹框那一刻要显示的那一份（根与名字在问的时候钉住，渲染时不再回头看 `workspace`）。 */
type LinkPromptState = { url: string; root: string; name: string; resolve: (choice: ExternalLinkChoice) => void }
const linkPrompt = ref<LinkPromptState | null>(null)
/**
 * 弹那三颗按钮并等回答。两条如实的分支：
 *   · 已经挂着一句 ⇒ **不叠第二扇模态**（上游 `canBrowse` 用的就是模态框，
 *     `BrowserLauncherImpl.kt:75-81`），后到的那句按「取消」答（`:85`：其它答案 = 不开）；
 *   · 宿主还没把 `mode="link"` 那颗框挂进模板（接线请求 welcome3 的 W1 第 4 条还没落）⇒
 *     不能让 Promise 永远 pending（那样终端/控制台/快速文档里的链接点了什么都没发生，
 *     比接线前更糟）：等一拍让 Vue 挂载，没人挂就收掉状态、按「打开」放行并**说一句为什么没弹框**。
 */
async function askExternalLink(prompt: ExternalLinkPromptRequest): Promise<ExternalLinkChoice> {
  if (linkPrompt.value) return 'cancel'
  let answer: ((choice: ExternalLinkChoice) => void) | null = null
  const pending = new Promise<ExternalLinkChoice>(resolve => {
    answer = resolve
    linkPrompt.value = { url: prompt.url, root: workspace.value?.root ?? '', name: workspace.value?.name ?? '', resolve }
  })
  await nextTick()
  if (!linkDialogIsMounted()) {
    linkPrompt.value = null
    // `answer` 是在 Promise 执行体里被赋上的：TS 的控制流看不见那一手（会把它钉成 `null`），
    // 所以这里按声明的那一型取回来再放行。
    const settle = answer as ((choice: ExternalLinkChoice) => void) | null
    settle?.('open')
    notify('这一句「在浏览器里打开之前先问一次」还没有挂进界面（宿主欠一颗 mode="link" 的框），本次直接打开。', true)
    return 'open'
  }
  return pending
}
function resolveLinkPrompt(choice: ExternalLinkChoice) {
  const pending = linkPrompt.value
  linkPrompt.value = null
  pending?.resolve(choice)
}
// 装配即安装：这一域建出来那一刻，五条 URL 出口就都带着判定（`entries`/`save` 用的就是本域那两份，
// 所以宿主不再需要自己传 —— 剩下的那一行只是把 `mode="link"` 那颗框挂进模板）。
installExternalLinkGate({
  root: () => workspace.value?.root,
  entries: () => trustEntries(),
  ask: askExternalLink,
  save: entries => { void saveTrustedPaths(entries) },
})
async function refreshAppState() {
  const state = await request<AppState>('app.state')
  setSystemDateTimeFormats(state.systemDateTimeFormats)
  recentProjects.value = state.recentProjects
  // 老版本把「不显示面包屑」编码进 breadcrumbsPlacement（三值），源码里位置只有上下两个值；
  // 在读盘这一处迁移回 showBreadcrumbs + placement，避免旧值在下次保存时被原生校验拒绝。
  editorSettings.value = normalizeEditorSettings(state.settings)
  // Code Vision 的四把键灌进运行时真值表（`src/codeLensSettings.ts`）：上游那份是应用级
  // `PersistentStateComponent`（CodeVisionSettings.kt:14 的 `@State(name = "CodeVisionSettings", storages = [Storage("editor.xml")])`），
  // 读盘即生效；本仓渲染侧只认那张运行时表（`src/codeLensExtension.ts` 的 `buildDecorations`）。
  // 旧存档缺键由原生侧补默认（native/settings_schema.cpp:414-417），所以这里**不许**按字段数量判损坏。
  restoreCodeVisionSettings({
    codeVisionEnabled: editorSettings.value.codeVisionEnabled,
    disabledGroups: editorSettings.value.codeVisionDisabledGroups,
    enabledGroups: editorSettings.value.codeVisionEnabledGroups,
    codeVisionVisibleEntries: editorSettings.value.codeVisionVisibleEntries,
  })
  // 快速文档那两档同样在读盘这一拍折回运行时真值（`src/docHoverPolicy.ts` 的 `docHoverPolicy` 单例
  // = 上游 `EditorSettingsExternalizable` 那份应用级单例的等价物，两个消费方直接读它：
  // 「在鼠标移动时显示」→ `src/docHoverContent.ts:162` 的 `shouldShowDocOnHover()`；
  // 「选区更改时自动刷新文档」→ `src/quickDocHost.ts:232` 的 `shouldAutoUpdateDoc()`）。
  // 为什么必须在这里，而不是等设置页打开：这两把键**早就登记在** `EditorSettings` 与
  // `native/settings_schema.cpp:419` 的默认值表里（旧存档缺键由原生逐键补默认，不按字段数量判损坏），
  // 但读链以前**断在这里** —— 磁盘值从来没人灌进那张运行时表，于是"存得下、读不回"：
  // 用户在弹层齿轮上关掉自动更新（或手改 projects.json）之后，运行时永远按出厂的"开"走。
  // 订正留痕（2026-10-06 codevision2）：`docHoverPolicy.ts:50-52` 原来写「登记与否不影响本模块 …
  // 登记请求在 docs/wiring-requests-2026-10-06-bucket3.md 的 S1」—— 键其实早就登记了（S1 已落地），
  // 缺的一直是这一行调用。
  docHoverPolicyFromSettings(editorSettings.value)
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
      // trust-all 那一格的前提：IDE 自己的配置目录（上游 `TrustedProjects.kt:103-107` 要拿它排除
      // 「项目就在配置目录里」那一种）。`app.info` 的 `profile` 就是那一个目录（`native/diagnostics.cpp`
      // 的 init(profile) 与 `app_info` 用的同一份）。读不到就留 null ⇒ 那一格不画。
      void request<AppInfo>('app.info')
        .then(info => { trustConfigDir.value = info.profile })
        .catch(() => { trustConfigDir.value = null })
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
async function activateWorkspace(result: Workspace, formatOnSaveFallback = editorSettings.value.formatOnSave) {
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
  changePlaces.value = []
  // 最近目录缓存跟着项目走（上游那份是项目级服务，`RunAnythingContextRecentDirectoryCache.kt:13-14`）：
  // 换项目那一刻先清空，读回来的那份再灌进去 —— 中间失败（下面那个 try 报错）也不会把上一个项目的目录串过来。
  importRunAnythingRecentDirectories(undefined, '')
  useProjectSettings(structuredClone(defaultProjectSettings))
  try {
    let loaded = await request<ProjectSettings>('project.settings.get')
    if (loaded.formatOnSave === undefined) {
      const migrated = await request<{ settings: ProjectSettings }>('project.settings.update', {
        formatOnSave: formatOnSaveFallback,
      })
      loaded = migrated.settings
    }
    useProjectSettings(loaded)
    // 折叠状态跟着项目走（上游存在项目的 workspace 文件里）：读回来的那份灌进会话内存档，
    // 没有就清空（换项目时不能把上一个项目的折叠状态带过来）。
    importFoldState(loaded?.foldingState)
    // Run Anything「最近目录」同一处收口：键缺 = 老存档 = 空表（补默认，不判损坏），
    // 第二个实参是上游开目录选择器时给的起始目录（`RunAnythingChooseContextAction.kt:138` 的 `guessProjectDir()`）。
    importRunAnythingRecentDirectories(loaded, result.root)
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
/** 两支 bundled `fileIconProvider`（外部库 / scratch 合成根）的登记在**模块加载时**，见文件里那段注释。 */
/** 合成根那一行的图标：先问 EP（第三方可能换掉），认不出两个合成图标名就退回内建那一档。 */
function syntheticIcon(path: string, fallback: 'libraries' | 'scratches'): 'libraries' | 'scratches' {
  const icon = fileIconFor({ path, isDirectory: true })
  return icon === 'libraries' || icon === 'scratches' ? icon : fallback
}
/**
 * 本会话的 SDK 表（`ProjectJdkTable` 的等价物，`src/rootsSdkTable.ts`）。
 * 上游那张表是进程级单例（`ProjectJdkTable.java:28-30`），本仓跟着工作区会话重建 ——
 * 换项目时 `clear()` 后重新 `preconfigure`，避免上一个项目的 SDK 串过来。
 */
const sdkTable = new SdkTable()
async function refreshSyntheticNodes() {
  // 容器节点本身**无条件存在**，即使一行子节点都没有（上游 `getChildren()` 返空列表就完事，
  // 没有空状态占位；`ProjectViewPaneTest.kt:47-56` 就是这么断言的）。
  const libraries: SyntheticNode = { path: '\u0000libraries', label: '外部库', icon: syntheticIcon('\u0000libraries', 'libraries'), entries: [] }
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
    nodes.push({ path: '\u0000scratches', label: '临时文件与控制台', icon: syntheticIcon('\u0000scratches', 'scratches'), entries: scratches.map(item => ({ ...item, path: item.path })) })
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
  // 低层打开闸门（上游 `LowLevelProjectOpenProcessor.beforeProjectOpened`，规则在
  // `src/projectOpenCheck.ts`）：给定了路径就先判它是不是一条可打开的项目目录 ——
  // `cancel` 时不发请求，把原因直接说给用户（此前是宿主拒绝后回一句原始错误）。
  if (path) {
    const decision = projectOpenDecision({ path })
    if (decision.result === 'cancel') { notify(decision.message ?? '这个路径不能作为项目打开。', true); return }
  }
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
    notify(isDesktop ? `已打开 ${result.root}` : `已打开 ${result.name}`)
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
    importRunAnythingRecentDirectories(undefined)   // 同上：Run Anything 的最近目录也是项目级那一份
    projectSettings.value = structuredClone(defaultProjectSettings)
    bookmarks.value = []
    places.value = []
    changePlaces.value = []
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
    await activateWorkspace(result, mode === 'create' ? false : editorSettings.value.formatOnSave)
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
// 提供方来自 EP（上游 `PluginEnvironmentKeyProvider`/`JvmEnvironmentKeyProvider` 按 bundled 贡献挂在
// `com.intellij.environmentKeyProvider` 上，见 src/environmentKeyProviders.ts）；第三方按同一 EP id 挂的
// 提供方也在这里被收编 ⇒ 登记在册之后 headless 存根与 `isRegistered` 才看得见那些键。
// 内置两条都没有必需键 ⇒ 不改变下面的缺失检查行为。
const environmentKeyProviders = environmentKeyProvidersFromExtensions()
for (const provider of environmentKeyProviders) environmentKeys.register(provider)
registerStartupActivity(checkRequiredEnvironmentKeysActivity({
  headless: () => !isDesktop,
  service: createHeadlessEnvironmentService({ registry: environmentKeys,
    warn: message => { console.warn(`[environment] ${message}`) } }),
  providers: environmentKeyProviders,   // EP 上的全部提供方（bundled 两条 + 第三方贡献）
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
    // 信任这一族：`trustEntries`/`saveTrustedPaths` 是宿主那几条 URL 出口的依赖（welcome2 R2 的前置、
    // trust4 的 T1），`linkPrompt`/`resolveLinkPrompt` 挂 `mode="link"` 那颗框，
    // `openExternalUrl` 从这一域**转出去**（门禁就装在本域，宿主因此不必再 import 那个模块）。
    trustPrompt, resolveTrustPrompt, projectTrustBlock, trustEntries, saveTrustedPaths,
    trustConfigDir, trustCanTrustAll, linkPrompt, resolveLinkPrompt, openExternalUrl,
  }
}
