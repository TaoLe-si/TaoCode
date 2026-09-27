// 设置的**持久化与各配置页的保存** —— 从 App.vue 搬出的一域（190 行）。
//
// 判据：这一族（打开设置、保存编辑器/常规/提交信息/项目/模板/TODO 模式/文件类型/VCS 日志/
// 书签视图/作用域/Java 设置）只做一件事 —— 把某个页面的改动 `request('settings.update' …)` 写进去，
// 并把结果回填到对应的状态。外部依赖 18 个，其中绝大多数是**宿主已有的 ref**。
//
// **注入的是 ref 本身**（不是 getter/setter 对）：模块与宿主共享同一个 ref，块内代码一个字都不用改
// （`settingsBusy.value = true` 照旧），出错面最小。这是项目里已验证的"状态模块"模式的变体 ——
// 状态仍然只有一个来源（宿主的 ref），模块只是操作它的地方。
import { ref, type Ref } from 'vue'
import { request, type BookmarksViewState, type Bookmark, type EditorSettings, type Entry,
         type GeneralSettingsState, type JavaProjectSettings, type NamedScopeSetting, type ProjectSettings, type TemplateSettings, type TodoPattern,
         type Workspace } from './bridge'
import type { FileColorSetting } from './fileColors'
import { errorMessage } from './errors'
import { DEFAULT_BOOKMARKS_VIEW } from './bookmarksView'
import type { BuildToolsSettings } from './gradle'
import { COMMIT_MESSAGE_INSPECTION_STORAGE_KEY, resolveInspectionSettings,
         type CommitMessageInspectionSettings } from './commitMessageInspection'

// 设置对话框要跳到哪一节（IDEA 的 Settings 树按 section 定位）。值就是各叶子页的 id。
// 构建工具那两页（`build.tools` / Gradle）也在这里 —— Gradle 工具窗口的齿轮按钮会跳到 Gradle 页。
type SettingsSectionHint = 'preferences.lookFeel' | 'editor' | 'editor.preferences.appearance' | 'editor.preferences.tabs'
  | 'preferences.sourceCode.indents' | 'tools.actionsOnSave' | 'editing.templates' | 'commit' | 'preferences.general'
  | 'build.tools' | 'reference.settingsdialog.project.gradle' | null

/** 设置对话框要跳到哪一节（IDEA 的 Settings 树按 section 定位）。 */
export interface SettingsPersistenceDeps {
  notify: (message: string, error?: boolean) => void
  /** 桌面端才有原生对话框（浏览器预览里要拒绝）。 */
  isDesktop: boolean
  /** 语言服务的启动（保存 Java 设置后要把它交给语言服务）—— 它收的是标签，不是路径。 */
  startLsp: (tab: any) => unknown
  // —— 宿主已有的状态（注入 ref 本身，块内 `.value` 用法保持不变）——
  settingsOpen: Ref<boolean>
  settingsBusy: Ref<boolean>
  settingsError: Ref<string>
  editorSettings: Ref<EditorSettings>
  generalSettings: Ref<GeneralSettingsState>
  projectSettings: Ref<ProjectSettings>
  // `bookmarks` 在宿主里声明得比这一块晚（TDZ），所以只能惰性注入 —— 不能直接传 ref。
  bookmarks: () => Bookmark[]
  setBookmarks: (value: Bookmark[]) => void
  busy: Ref<boolean>
  menu: Ref<string | null>
  /** 打开的标签（保存作用域/书签视图时要读它们的 path）。它是 computed，所以只要只读视图。 */
  allTabs: { readonly value: Array<{ path: string }> }
  bufferEpoch: Ref<number>
  treeVersion: Ref<number>
  // `deps.workspaceEpoch()` 是个 `let` 计数器（不是 ref）。
  workspaceEpoch: () => number
  working: { readonly value: boolean }   // computed
  workspace: Ref<Workspace | null>
}

export function createSettingsPersistence(deps: SettingsPersistenceDeps) {
  const isDesktop = deps.isDesktop
  const { settingsOpen, settingsBusy, settingsError, editorSettings, generalSettings,
          projectSettings, bookmarks, busy, menu, allTabs, bufferEpoch, treeVersion, working,
          workspace } = deps
  const settingsSectionHint = ref<SettingsSectionHint>(null)
  async function openSettings(section?: SettingsSectionHint) {
    settingsSectionHint.value = section ?? null
    menu.value = null
    if (working.value) return
    settingsError.value = ''
    settingsOpen.value = true
    if (workspace.value) {
      settingsBusy.value = true
      try { projectSettings.value = await request<ProjectSettings>('project.settings.get') }
      catch (error) { settingsError.value = errorMessage(error) }
      finally { settingsBusy.value = false }
    }
  }
  // `close` is false for the dialog's 应用 (Apply) button: IDEA's Apply commits the changes and
  // keeps the dialog open, only OK closes it (SettingsDialog.java's OK/Apply triple).
  async function saveSettings(settings: EditorSettings, close = true) {
    if (settingsBusy.value) return
    settingsBusy.value = true
    settingsError.value = ''
    try {
      editorSettings.value = await request<EditorSettings>('settings.update', { settings })
      if (close) settingsOpen.value = false
      deps.notify(isDesktop ? '编辑器设置已保存并生效。' : '编辑器设置已应用于当前预览会话。')
    } catch (error) { settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
  // Source: GeneralSettingsConfigurable.kt — the System Settings page saves through the
  // same Settings dialog Apply/OK flow as the editor page.
  async function saveGeneralSettings(settings: GeneralSettingsState, close = true) {
    if (settingsBusy.value) return
    settingsBusy.value = true
    settingsError.value = ''
    try {
      generalSettings.value = await request<GeneralSettingsState>('settings.general.update', { general: settings })
      if (close) settingsOpen.value = false
      deps.notify(isDesktop ? '系统设置已保存并生效。' : '系统设置已应用于当前预览会话。')
    } catch (error) { settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
  // IDEA's commit-message inspections live in Settings › Version Control › Commit
  // (CommitDialogConfigurable.kt:66-77) and are stored per project in vcs.xml; the values are
  // project-agnostic here, so they persist next to the other `taocode.*` front-end keys.
  const commitMessageSettings = ref<CommitMessageInspectionSettings>(readCommitMessageSettings())
  function readCommitMessageSettings(): CommitMessageInspectionSettings {
    try { return resolveInspectionSettings(JSON.parse(localStorage.getItem(COMMIT_MESSAGE_INSPECTION_STORAGE_KEY) ?? 'null')) }
    catch { return resolveInspectionSettings(null) }
  }
  function saveCommitMessageSettings(next: CommitMessageInspectionSettings, close = true) {
    commitMessageSettings.value = resolveInspectionSettings(next)
    try { localStorage.setItem(COMMIT_MESSAGE_INSPECTION_STORAGE_KEY, JSON.stringify(commitMessageSettings.value)) }
    catch { /* storage unavailable: session-only */ }
    if (close) settingsOpen.value = false
    deps.notify('提交信息检查设置已保存。')
  }
  // 项目结构（排除目录）——TODO 模式与 VCS 日志已各自独立成页，不再从这里一起发。
  async function saveProjectSettings(patch: { excludedDirs: string[] }) {
    if (settingsBusy.value || !workspace.value) return
    settingsBusy.value = true
    settingsError.value = ''
    try {
      const result = await request<{ settings: ProjectSettings; entries: Entry[] }>('project.settings.update', patch)
      projectSettings.value = result.settings
      workspace.value.entries = result.entries
      treeVersion.value++
      settingsOpen.value = false
      deps.notify('项目设置已更新；已打开文件不会关闭。')
    } catch (error) { settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
  async function saveTemplateSettings(templates: TemplateSettings) {
    if (!workspace.value || settingsBusy.value) return
    const epoch = deps.workspaceEpoch()
    settingsBusy.value = true
    settingsError.value = ''
    try {
      const result = await request<{ settings: ProjectSettings }>('project.settings.update', { templates })
      if (epoch !== deps.workspaceEpoch()) return
      projectSettings.value = { ...projectSettings.value, templates: result.settings.templates }
      deps.notify('实时模板设置已保存。')
    } catch (error) { if (epoch === deps.workspaceEpoch()) settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
  // TODO 模式表（IDEA `preferences.toDoOptions`）：整表替换。TODO 工具窗口、提交前检查与搜索
  // 都从 projectSettings.todoPatterns 读，所以保存后只需要把新的设置写回去。
  async function saveTodoPatterns(patterns: TodoPattern[]) {
    if (!workspace.value || settingsBusy.value) return
    const epoch = deps.workspaceEpoch()
    settingsBusy.value = true
    settingsError.value = ''
    try {
      const result = await request<{ settings: ProjectSettings }>('project.settings.update', { todoPatterns: patterns })
      if (epoch !== deps.workspaceEpoch()) return
      projectSettings.value = { ...projectSettings.value, todoPatterns: result.settings.todoPatterns }
      deps.notify('TODO 模式已保存。')
    } catch (error) { if (epoch === deps.workspaceEpoch()) settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
  // 文件类型关联（IDEA `preferences.fileTypes`）：整表替换。与右键菜单里的「关联文件类型」写同一份数据，
  // 所以保存后要把受影响扩展名的缓冲区重新挂语言（语法与语言服务器都按扩展名选）。
  async function saveFileAssociations(associations: Record<string, string>) {
    if (!workspace.value || settingsBusy.value) return
    const epoch = deps.workspaceEpoch()
    const before = projectSettings.value.fileAssociations ?? {}
    settingsBusy.value = true
    settingsError.value = ''
    try {
      const result = await request<{ settings: ProjectSettings }>('project.settings.update', { fileAssociations: associations })
      if (epoch !== deps.workspaceEpoch()) return
      projectSettings.value = { ...projectSettings.value, fileAssociations: result.settings.fileAssociations }
      const changed = new Set([...Object.keys(before), ...Object.keys(result.settings.fileAssociations)]
        .filter(extension => before[extension] !== result.settings.fileAssociations[extension]))
      for (const tab of allTabs.value)
        if (changed.has(tab.path.slice(tab.path.lastIndexOf('.') + 1).toLowerCase())) void deps.startLsp(tab)
      bufferEpoch.value++
      deps.notify('文件类型关联已保存。')
    } catch (error) { if (epoch === deps.workspaceEpoch()) settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
  // VCS 日志的显示开关（IDEA `vcs.log`）：只影响日志图，不动历史数据。
  async function saveVcsLog(log: { showTagNames: boolean; showRootNames: boolean }) {
    if (!workspace.value || settingsBusy.value) return
    const epoch = deps.workspaceEpoch()
    settingsBusy.value = true
    settingsError.value = ''
    try {
      const result = await request<{ settings: ProjectSettings }>('project.settings.update', { vcsLog: log })
      if (epoch !== deps.workspaceEpoch()) return
      projectSettings.value = { ...projectSettings.value, vcsLog: result.settings.vcsLog }
      deps.notify('VCS 日志设置已保存。')
    } catch (error) { if (epoch === deps.workspaceEpoch()) settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
  // 构建工具（IDEA 设置「构建、执行、部署 › 构建工具」+ 其下的 Gradle 页）。**项目级**：
  // IDEA 的 `ExternalSystemGroupConfigurable` 是 projectConfigurable（id=`build.tools`），
  // Gradle 那几项在 `GradleSettings`（`.idea/gradle.xml`）—— 所以这里走 `project.settings.update`。
  async function saveBuildTools(patch: Partial<BuildToolsSettings>) {
    if (!workspace.value || settingsBusy.value) return
    const epoch = deps.workspaceEpoch()
    settingsBusy.value = true
    settingsError.value = ''
    try {
      const result = await request<{ settings: ProjectSettings }>('project.settings.update', { buildTools: patch })
      if (epoch !== deps.workspaceEpoch()) return
      projectSettings.value = { ...projectSettings.value, buildTools: result.settings.buildTools }
      deps.notify('构建工具设置已保存。')
    } catch (error) { if (epoch === deps.workspaceEpoch()) settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
  // 书签工具窗口的视图状态（IDEA `BookmarksViewState`，per-project）：与 projectSettings.vcsLog 同一模式，
  // 只把被改的那个开关合并回去。
  async function saveBookmarksView(patch: Partial<BookmarksViewState>) {
    if (!workspace.value || settingsBusy.value) return
    const epoch = deps.workspaceEpoch()
    const next = { ...(projectSettings.value.bookmarksView ?? DEFAULT_BOOKMARKS_VIEW), ...patch }
    try {
      const result = await request<{ settings: ProjectSettings }>('project.settings.update', { bookmarksView: next })
      if (epoch !== deps.workspaceEpoch()) return
      projectSettings.value = { ...projectSettings.value, bookmarksView: result.settings.bookmarksView }
    } catch (error) { if (epoch === deps.workspaceEpoch()) deps.notify(errorMessage(error), true) }
  }
  // 文件颜色（IDEA `com.intellij.ui.tabs` 的 File Colors）：整表替换。改完立刻生效，
  // 标签页上的色块是从 `fileColors` 现算的（没有缓存要清），所以不需要额外刷新。
  async function saveFileColors(fileColors: FileColorSetting[]) {
    if (!workspace.value || settingsBusy.value) return
    const epoch = deps.workspaceEpoch()
    settingsBusy.value = true
    settingsError.value = ''
    try {
      const result = await request<{ settings: ProjectSettings }>('project.settings.update', { fileColors })
      if (epoch !== deps.workspaceEpoch()) return
      projectSettings.value = { ...projectSettings.value, fileColors: result.settings.fileColors }
      deps.notify('文件颜色已保存。')
    } catch (error) { if (epoch !== deps.workspaceEpoch()) settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
  // 命名作用域（IDEA project.scopes）：整表替换。作用域只影响查询范围，不动文件树，
  // 所以保存后不关对话框，也不重建树 —— 与 IDEA apply() 里只有 refreshProject() 一致。
  async function saveScopes(scopes: NamedScopeSetting[]) {
    if (!workspace.value || settingsBusy.value) return
    const epoch = deps.workspaceEpoch()
    settingsBusy.value = true
    settingsError.value = ''
    try {
      const result = await request<{ settings: ProjectSettings }>('project.settings.update', { scopes })
      if (epoch !== deps.workspaceEpoch()) return
      projectSettings.value = { ...projectSettings.value, scopes: result.settings.scopes }
      deps.notify('作用域已保存。')
    } catch (error) { if (epoch === deps.workspaceEpoch()) settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
  async function saveJavaSettings(java: JavaProjectSettings) {
    if (!workspace.value || settingsBusy.value) return
    const epoch = deps.workspaceEpoch()
    settingsBusy.value = true
    settingsError.value = ''
    try {
      const result = await request<{ settings: ProjectSettings }>('project.settings.update', { java })
      if (epoch !== deps.workspaceEpoch()) return
      projectSettings.value = result.settings
      deps.setBookmarks([...result.settings.bookmarks])
      deps.notify('Java 项目设置已保存并交给语言服务。')
    } catch (error) { if (epoch === deps.workspaceEpoch()) settingsError.value = errorMessage(error) }
    finally { settingsBusy.value = false }
  }
  // The Project Structure pane's Edit/Browse buttons: pick a directory with the native
  // dialog and write it straight into the stored Java settings.
  async function browseStructureDir(field: 'jdkHome' | 'outputPath') {
    if (busy.value || settingsBusy.value || !isDesktop) return
    busy.value = true
    try {
      const start = projectSettings.value.java[field] ?? ''
      const path = await request<string | null>('dialog.pickDirectory', { initial: start })
      if (path && workspace.value) await saveJavaSettings({ ...projectSettings.value.java, [field]: path })
    } catch (error) { deps.notify(errorMessage(error), true) }
    finally { busy.value = false }
  }

  return {
    settingsSectionHint, commitMessageSettings, openSettings, saveSettings, saveGeneralSettings, readCommitMessageSettings, saveCommitMessageSettings,
    saveProjectSettings, saveTemplateSettings, saveTodoPatterns, saveFileAssociations, saveVcsLog, saveBookmarksView,
    saveBuildTools,
    saveScopes, saveFileColors, saveJavaSettings, browseStructureDir,
  }
}
