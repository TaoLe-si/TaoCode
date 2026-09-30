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
import { importFoldState } from './editorFoldingState'
import { cloneProgress, defaultGeneralSettings, defaultProjectSettings, isDesktop, normalizeEditorSettings, request,
         type AppState, type Entry, type PluginList, type ProjectForm, type ProjectSettings, type Workspace } from './bridge'
import type { SyntheticNode } from './components/FileTree.vue'
import { errorMessage } from './errors'
import type { Tab } from './editorTab'

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
async function refreshAppState() {
  const state = await request<AppState>('app.state')
  recentProjects.value = state.recentProjects
  // 老版本把「不显示面包屑」编码进 breadcrumbsPlacement（三值），源码里位置只有上下两个值；
  // 在读盘这一处迁移回 showBreadcrumbs + placement，避免旧值在下次保存时被原生校验拒绝。
  editorSettings.value = normalizeEditorSettings(state.settings)
  generalSettings.value = state.general ? { ...defaultGeneralSettings, ...state.general } : { ...defaultGeneralSettings }
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
  await refreshSyntheticNodes()
  void offerSessionRestore()
}
// IDEA's Project view keeps two synthetic nodes below the module (ProjectFileNodeImpl):
// "External Libraries" and "Scratches and Consoles". TaoCode has no SDK index, so the
// libraries node lists the configured JAR globs as leaf entries; scratches is the real
// scratch/ folder. Both stay empty when the folder/globs do not exist.
const syntheticNodes = ref<SyntheticNode[]>([])
async function refreshSyntheticNodes() {
  // IDEA's Project view "External Libraries" shows glob strings as leaves (they
  // do not exist on disk to expand), so the synthetic rows must report kind:'file'
  // to stop FileTree from recursively listing them. The "Scratches and Consoles"
  // list under the scratch/ folder keeps the real entries; the leading "scratch/"
  // prefix is added by workspace.list itself, not here.
  const nodes: SyntheticNode[] = [{ path: '\u0000libraries', label: '外部库', icon: 'libraries', entries: [] }]
  for (const glob of projectSettings.value.java.referencedLibraries)
    nodes[0]!.entries.push({ name: glob, path: `\u0000lib:${glob}`, kind: 'file' })
  try {
    const scratches = await request<Entry[]>('workspace.list', { path: 'scratch' })
    nodes.push({ path: '\u0000scratches', label: '临时文件与控制台', icon: 'scratches', entries: scratches.map(item => ({ ...item, path: item.path })) })
  } catch { /* scratch/ may not exist yet */ }
  syntheticNodes.value = nodes
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
  return {
    refreshAppState, refreshRecent, bootstrap, confirmLeave, answerLeave, activateWorkspace,
    syntheticNodes, refreshSyntheticNodes, openWorkspace, closeWorkspace, forgetProject, forgetProjects,
    defaultProjectParent, beginProject, browseParent, submitProject, cancelProject,
  }
}
