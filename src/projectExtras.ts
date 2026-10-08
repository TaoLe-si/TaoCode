// 仓库/项目的**附属面板**：插件、Git 工作树、子模块、单文件历史 —— 从 App.vue 搬出的一域。
//
// 判据：这四块**各自持有自己的状态**（open/busy/数据 ref），彼此不依赖，也不被 App 的其它逻辑读
// （只有模板渲染 + 菜单动作调用）。外部依赖实测只有 2 个（`notify` 与 `workspace`），所以 ctx 很小。
import { ref, watch } from 'vue'
import { request, type GitFileHistory, type GitShowCommit, type GitSubmodule, type GitSubmodules,
         type GitWorktree, type GitWorktrees, type PluginInfo, type PluginList, type Workspace } from './bridge.ts'
import { errorMessage } from './errors.ts'
import { applyPluginFileTypes } from './fileTypePluginBeans.ts'
import { chooseWithDescriptor, singleDirDescriptor, singleFileDescriptor, withExtensionFilter, withTitle,
         type FileChooserHost } from './fileChooserDescriptor.ts'

export interface ProjectExtrasDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  /** 当前工作区（惰性读，模块不持有 App 的 ref 本身）。 */
  workspace: () => Workspace | null
}

export function createProjectExtras(deps: ProjectExtrasDeps) {
  const isDesktop = deps.isDesktop
  const pluginOpen = ref(false)
  const pluginBusy = ref(false)
  const pluginList = ref<PluginInfo[]>([])
  // 插件贡献的**文件类型**跟着「插件集合」走，不跟着「插件页开着没开」走。上游就是这条口径：
  // `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:130` 让注册表
  // 自己实现 `ExtensionPointListener<FileTypeBean>` —— `:280-291` 的 `extensionAdded` 在 EP 被加进来时当场
  // 建匹配器并发 `fireFileTypesChanged`，`:294-300` 的 `extensionRemoved` 在插件不再加载时把它收回，
  // 两头都不经过设置页（`EP_NAME` 是 `:132` 的 `com.intellij.fileType`）。
  // 本仓原先只有 `src/components/PluginDialog.vue` 在它自己的 `watch` 里灌这张表，于是「重启后还没打开过
  // 插件页」的那段时间里，插件声明的扩展名 / 文件名 / shebang 一律认不出来 —— 而
  // `src/workspaceLifecycle.ts` 的 bootstrap 明明已经把列表读进同一个 ref 了。现在列表**任何一次**变化都重算：
  // 启动那一次、以及启用 / 停用 / 安装 / 卸载 / 刷新。
  // `applyPluginFileTypes` 自己幂等（同一份清单连调两次不重复认领，判据 `tests/ext-plugin-file-types.test.mjs`
  // 的「幂等」那条），所以插件页那一份 `watch` 照旧留着 —— 它要的是那份**报告**（被拒的声明要说人话）。
  watch(pluginList, plugins => { applyPluginFileTypes(plugins) }, { immediate: true, flush: 'sync' })
  // 文件/目录选择走描述件（`src/fileChooserDescriptor.ts`，上游 `FileChooserDescriptor` 的宿主侧子集）：
  // 描述件决定宿主方法与过滤串，选完再复核扩展名，避免用户在「所有文件」里手选一个非插件包。
  const chooserHost: FileChooserHost = {
    pickFile: params => request<string | null>('dialog.pickFile', params),
    pickDirectory: params => request<string | null>('dialog.pickDirectory', params),
  }
  const pluginArchiveDescriptor = withTitle(withExtensionFilter(singleFileDescriptor(), '插件包', ['zip', 'jar']), '选择插件包')
  const pluginDirectoryDescriptor = withTitle(singleDirDescriptor(), '选择插件目录')
  // 正在安装的条目（安装源的名字）。解压完才解析出 plugin.json，所以这期间只有名字；
  // 对话框把它们渲染在"正在安装"组里（对照 IDEA 的 `MyPluginModel.installingPlugins`）。
  const installingPlugins = ref<string[]>([])
  // 「打开插件页并定位到这个插件」（上游 `PluginManagerConfigurableService.java:14-15` 的
  // `showPluginConfigurableAndEnable` 在本仓的等价入口；接收侧的定位动作在
  // `src/components/PluginDialog.vue` 的 `focusPlugin` prop 上，这里只负责把 id 递进去）。
  const pluginFocusId = ref('')
  async function openPluginsAndSelect(id: string) {
    pluginFocusId.value = id
    await openPlugins()
  }
  async function openPlugins() {
    if (!isDesktop) { deps.notify('浏览器预览不能读取本机插件目录，请在桌面端使用。', true); return }
    pluginBusy.value = true
    try { pluginList.value = (await request<PluginList>('plugin.list')).plugins; pluginOpen.value = true }
    catch (error) { deps.notify(errorMessage(error), true) }
    finally { pluginBusy.value = false }
  }
  // 组件按 id 触发（列表项可能被搜索/筛选隐藏），这里按 id 找到插件后走同一路径。
  async function togglePluginById(id: string, enabled: boolean) {
    const plugin = pluginList.value.find(item => item.id === id)
    if (plugin) await togglePlugin({ ...plugin, enabled: !enabled })
  }
  /** 安装的公共尾巴：装的过程中把源名挂进"正在安装"组，装完刷新列表。 */
  async function runPluginInstall(source: string, label: string) {
    pluginBusy.value = true
    installingPlugins.value = [label]
    try {
      pluginList.value = (await request<PluginList>('plugin.install', { source })).plugins
      deps.notify('插件已安装。启用后它贡献的命令、模板与文件类型会立即生效。')
      pluginOpen.value = true
    } finally { installingPlugins.value = []; pluginBusy.value = false }
  }
  function sourceName(source: string) {
    return source.split(/[\\/]/).filter(Boolean).pop() ?? source
  }
  // IDEA PluginsConfigurable › Install Plugin from Disk：选一个插件包（.zip/.jar）装进插件目录。
  // 包内可以带一层顶层目录（常见的 `my-plugin-1.0/plugin.json` 打包方式）。
  async function installPlugin() {
    if (!isDesktop) { deps.notify('浏览器预览不能安装本机插件。', true); return }
    try {
      const source = await chooseWithDescriptor(chooserHost, pluginArchiveDescriptor)
      if (!source) return
      await runPluginInstall(source, sourceName(source))
    } catch (error) { deps.notify(errorMessage(error), true) }
  }
  // 本仓的扩展点本身是"含 plugin.json 的目录"，所以目录也能直接装（IDEA 那边只有插件包）。
  async function installPluginDirectory() {
    if (!isDesktop) { deps.notify('浏览器预览不能安装本机插件。', true); return }
    try {
      const source = await chooseWithDescriptor(chooserHost, pluginDirectoryDescriptor)
      if (!source) return
      await runPluginInstall(source, sourceName(source))
    } catch (error) { deps.notify(errorMessage(error), true) }
  }
  // 组级「全部启用/全部禁用」（IDEA `ComparablePluginsGroup.setEnabledState`）。
  // 逐个走同一条 `plugin.setEnabled`，每个响应都是最新的全量列表，取最后一个即可。
  async function setPluginsEnabled(ids: string[], enabled: boolean) {
    if (!ids.length) return
    pluginBusy.value = true
    try {
      for (const id of ids) pluginList.value = (await request<PluginList>('plugin.setEnabled', { id, enabled })).plugins
      deps.notify(enabled ? `已启用 ${ids.length} 个插件。` : `已停用 ${ids.length} 个插件。`)
    } catch (error) { deps.notify(errorMessage(error), true) }
    finally { pluginBusy.value = false }
  }
  // IDEA 的 Uninstall：删除插件目录（组件里已做二次确认）。
  async function uninstallPlugin(id: string) {
    try {
      pluginBusy.value = true
      try { pluginList.value = (await request<PluginList>('plugin.uninstall', { id })).plugins }
      finally { pluginBusy.value = false }
      deps.notify(`已卸载插件「${id}」`)
    } catch (error) { deps.notify(errorMessage(error), true) }
  }
  async function refreshPlugins() {
    pluginBusy.value = true
    try { pluginList.value = (await request<PluginList>('plugin.list')).plugins }
    catch (error) { deps.notify(errorMessage(error), true) }
    finally { pluginBusy.value = false }
  }
  async function togglePlugin(plugin: PluginInfo) {
    try {
      const result = await request<PluginList>('plugin.setEnabled', { id: plugin.id, enabled: !plugin.enabled })
      pluginList.value = result.plugins
      deps.notify(`${plugin.enabled ? '已停用' : '已启用'}插件「${plugin.name || plugin.id}」`)
    } catch (error) { deps.notify(errorMessage(error), true) }
  }
  // VCS-01/03: worktrees and submodules are two Git views the 源代码管理 tool window
  // does not cover, so they get their own dialogs.
  const worktreeOpen = ref(false)
  const worktreeBusy = ref(false)
  const worktrees = ref<GitWorktree[]>([])
  const worktreePath = ref('')
  const worktreeBranch = ref('')
  const worktreeNewBranch = ref(false)
  async function openWorktrees() {
    if (!deps.workspace() || !isDesktop) { deps.notify('请先打开一个 Git 项目。', true); return }
    worktreeBusy.value = true
    try { worktrees.value = (await request<GitWorktrees>('git.worktree.list')).worktrees; worktreeOpen.value = true }
    catch (error) { deps.notify(errorMessage(error), true) }
    finally { worktreeBusy.value = false }
  }
  async function addWorktree() {
    const path = worktreePath.value.trim()
    if (!path) { deps.notify('请填写工作树路径。', true); return }
    worktreeBusy.value = true
    try {
      const result = await request<GitWorktrees>('git.worktree.add', { path, branch: worktreeBranch.value.trim(), newBranch: worktreeNewBranch.value })
      worktrees.value = result.worktrees
      worktreePath.value = ''; worktreeBranch.value = ''
      deps.notify('已添加工作树。')
    } catch (error) { deps.notify(errorMessage(error), true) }
    finally { worktreeBusy.value = false }
  }
  async function removeWorktree(path: string) {
    worktreeBusy.value = true
    try { worktrees.value = (await request<GitWorktrees>('git.worktree.remove', { path })).worktrees; deps.notify('已移除工作树。') }
    catch (error) { deps.notify(errorMessage(error), true) }
    finally { worktreeBusy.value = false }
  }
  const submoduleOpen = ref(false)
  const submoduleBusy = ref(false)
  const submodules = ref<GitSubmodule[]>([])
  async function openSubmodules() {
    if (!deps.workspace() || !isDesktop) { deps.notify('请先打开一个 Git 项目。', true); return }
    submoduleBusy.value = true
    try { submodules.value = (await request<GitSubmodules>('git.submodules')).submodules; submoduleOpen.value = true }
    catch (error) { deps.notify(errorMessage(error), true) }
    finally { submoduleBusy.value = false }
  }
  async function updateSubmodules() {
    submoduleBusy.value = true
    try { submodules.value = (await request<GitSubmodules>('git.submodule.update')).submodules; deps.notify('已更新子模块。') }
    catch (error) { deps.notify(errorMessage(error), true) }
    finally { submoduleBusy.value = false }
  }
  // VCS-01 "Show History for File": `--follow` keeps the log going across renames, and
  // picking a commit shows what that commit actually changed.
  const fileHistoryOpen = ref(false)
  const fileHistoryBusy = ref(false)
  const fileHistory = ref<GitFileHistory | null>(null)
  const fileHistoryCommit = ref<GitShowCommit | null>(null)
  const fileHistorySelected = ref('')
  async function showFileHistory(path: string) {
    if (!isDesktop) { deps.notify('浏览器预览不能读取 Git 历史，请在桌面端使用。', true); return }
    fileHistoryBusy.value = true
    fileHistoryCommit.value = null
    fileHistorySelected.value = ''
    try { fileHistory.value = await request<GitFileHistory>('git.fileHistory', { path }); fileHistoryOpen.value = true }
    catch (error) { deps.notify(errorMessage(error), true) }
    finally { fileHistoryBusy.value = false }
  }
  async function showCommit(revision: string) {
    fileHistoryBusy.value = true
    fileHistorySelected.value = revision
    try { fileHistoryCommit.value = await request<GitShowCommit>('git.showCommit', { revision }) }
    catch (error) { deps.notify(errorMessage(error), true) }
    finally { fileHistoryBusy.value = false }
  }

  return {
    pluginOpen, pluginBusy, pluginList, installingPlugins, pluginFocusId, openPlugins, openPluginsAndSelect,
    togglePluginById, installPlugin, installPluginDirectory,
    setPluginsEnabled, uninstallPlugin, refreshPlugins, togglePlugin,
    worktreeOpen, worktreeBusy, worktrees, worktreePath, worktreeBranch, worktreeNewBranch, openWorktrees, addWorktree, removeWorktree,
    submoduleOpen, submoduleBusy, submodules, openSubmodules, updateSubmodules,
    fileHistoryOpen, fileHistoryBusy, fileHistory, fileHistoryCommit, fileHistorySelected, showFileHistory, showCommit,
  }
}
