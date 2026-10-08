// 文件菜单（FileMenu，PlatformActions.xml:376-445 的 TaoCode 对应物）。
// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入，签名窄化到本菜单实际用法。
import type { MenuRow } from './types'

export interface FileMenuContext {
  workspace: { value: unknown }
  working: { value: boolean }
  dirty: { value: boolean }
  // Tab 类型随拆分第三批提为命名类型后收紧；此处仅布尔判断与透传。
  active: { value: any }
  activePath: { value: string }
  allTabs: { value: unknown[] }
  // 拆分第三批把 Tab/面板类型提为命名类型后收紧。
  groups: any
  focusedPane: { value: any }
  closedTabsPerPane: any
  recentProjects: { value: unknown[] }
  isDesktop: boolean
  hasEditor: () => boolean
  beginProject: (mode: any) => unknown
  openWorkspace: (arg?: any) => unknown
  openManageRecents: () => void
  closeWorkspace: () => unknown
  saveAll: () => unknown
  createScratch: () => unknown
  closeTab: (tab: any) => unknown
  reopenClosedTab: () => unknown
  closeAllTabsIn: (pane: any) => unknown
  closeOtherTabsIn: (pane: any, tab: any) => unknown
  openEncoding: () => void
  toggleReadOnly: (path: any) => unknown
  convertLineSeparators: (sep: any) => unknown
  openBinary: (path: any) => unknown
  openPlugins: () => unknown
  openSettings: (arg?: any) => unknown
  /** 「文件 › 项目结构…」：打开独立对话框（IDEA ShowStructureSettingsAction）。 */
  openProjectStructure: () => void
  quitApp: () => unknown
  forceReloadFromDisk: () => unknown
  notify: (message: string, error?: boolean) => void
  /** `ExportImportGroup`（PlatformActions.xml:419-424）三项。 */
  importSettings: () => unknown
  exportSettings: () => unknown
  restoreDefaultSettings: () => unknown
  /** `PrintExportGroup`（:430-436）里 `FileExportGroup` 的 `ExportToHTML`。 */
  exportToHtml: () => unknown
  /** `PowerSaveGroup`（:437-440）的 `TogglePowerSave` —— 与状态栏那颗省电模式芯片是同一个动作。 */
  togglePowerSave: () => unknown
  powerSaveMode: { value: boolean }
}

  export function createFileMenuRows(ctx: FileMenuContext): MenuRow[] {
  const rows: MenuRow[] = [
    { id: 'project.new', title: '新建项目…', keywords: 'new create project 新建', enabled: () => !ctx.working.value, run: () => ctx.beginProject('create') },
    { id: 'project.open', title: '打开项目…', keywords: 'open project 打开', enabled: () => !ctx.working.value, run: () => void ctx.openWorkspace() },
    { id: 'project.clone', title: '克隆仓库…', keywords: 'clone checkout vcs 克隆', enabled: () => !ctx.working.value, run: () => ctx.beginProject('clone') },
    { id: 'project.recentSection', section: '最近项目' },
    { id: 'project.recentList', recent: true },
    // ManageRecentProjectsAction.java (PlatformActions.xml:386): opens a JBPopup
    // with the filtered recent-projects tree and a search field; the popup also
    // delegates to RemoveSelectedProjectsAction for the same Delete / multi-select
    // behaviour the welcome screen exposes. TaoCode mirrors this with a focused
    // modal dialog that reuses the welcome-screen list, so the user can manage
    // recents without leaving the current project.
    { id: 'project.manageRecent', title: '管理最近项目…', keywords: 'manage recent projects popup dialog 管理最近项目', enabled: () => ctx.recentProjects.value.length > 0 && !ctx.working.value, run: () => ctx.openManageRecents() },
    { id: 'project.close', title: '关闭项目，返回欢迎页', keywords: 'close project 关闭', enabled: () => !ctx.working.value, run: () => void ctx.closeWorkspace() },
    { id: 'file.rule1', rule: true },
    // IDEA's FileMenu carries exactly one save action (SaveAll, Ctrl+S).
    { id: 'file.saveAll', title: '全部保存', keys: 'Ctrl S', keywords: 'save all write 保存', enabled: () => ctx.dirty.value && !ctx.working.value, run: () => void ctx.saveAll() },
    { id: 'file.scratch', title: '新建临时文件', keys: 'Ctrl Alt Shift Insert', keywords: 'scratch temp buffer 临时文件', enabled: () => Boolean(ctx.workspace.value) && !ctx.working.value, run: () => void ctx.createScratch() },
    { id: 'file.closeTab', title: '关闭当前文件', keywords: 'close tab editor 关闭标签', enabled: () => Boolean(ctx.active.value) && !ctx.working.value, run: () => { const tab = ctx.active.value; if (tab) void ctx.closeTab(tab) } },
    { id: 'file.reopenClosedTab', title: '重新打开已关闭的标签页', keywords: 'reopen closed tab restore editor 恢复关闭标签', enabled: () => ctx.closedTabsPerPane[ctx.focusedPane.value].length > 0, run: () => void ctx.reopenClosedTab() },
    { id: 'file.closeAllTabs', title: '关闭所有文件', keywords: 'close all tabs editors 全部关闭', enabled: () => ctx.allTabs.value.length > 0 && !ctx.working.value, run: () => { void ctx.closeAllTabsIn(ctx.focusedPane.value) } },
    { id: 'file.closeOthers', title: '关闭其他文件', keywords: 'close other tabs 关闭其他', enabled: () => Boolean(ctx.active.value) && ctx.groups[ctx.focusedPane.value].tabs.length > 1, run: () => { const tab = ctx.active.value; if (tab) void ctx.closeOtherTabsIn(ctx.focusedPane.value, tab) } },
    { id: 'file.rule2', rule: true },
    // FileMenu › FilePropertiesGroup —— **子菜单**（`<group id="FilePropertiesGroup" popup="true">`，
    // PlatformActions.xml:400-412），子项顺序：ChangeFileEncodingAction · AssociateWithFileType ·
    // ToggleReadOnlyAttribute · 以及**再嵌一层**的 ChangeLineSeparators（:405 自己也是 popup="true"）。
    // TaoCode 没有独立的“关联文件类型”菜单行（它在标签页右键菜单里），所以这里不放。
    { id: 'file.properties', title: '文件属性', keywords: 'file properties encoding read only line separators 文件属性 编码 只读 行分隔符', children: [
      { id: 'file.encoding', title: '文件编码…', keywords: 'encoding charset gbk utf16 bom 编码', enabled: ctx.hasEditor, run: () => ctx.openEncoding() },
      { id: 'file.toggleReadOnly', title: '切换只读属性', keywords: 'read only writable lock attribute 只读 可写', enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.toggleReadOnly(ctx.activePath.value) },
      { id: 'file.lineSeparators', title: '行分隔符', keywords: 'line separators crlf lf cr mac 行尾 分隔符', children: [
        { id: 'file.lineSeparatorWindows', title: '转换为 Windows (CRLF) 行尾', keywords: 'convert windows line separators crlf 行尾 换行', enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.convertLineSeparators('crlf') },
        { id: 'file.lineSeparatorUnix', title: '转换为 Unix and macOS (LF) 行尾', keywords: 'convert unix macos line separators lf 行尾 换行', enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.convertLineSeparators('lf') },
        { id: 'file.lineSeparatorMac', title: '转换为 Classic Mac OS (CR) 行尾', keywords: 'convert mac classic mac os line separators cr 行尾 换行', enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.convertLineSeparators('cr') },
      ] },
    ] },
    { id: 'file.openBinary', title: '以二进制/十六进制方式打开', keywords: 'binary hex image 二进制 十六进制 图片', enabled: () => ctx.isDesktop && Boolean(ctx.activePath.value || ctx.workspace.value), run: () => { const path = ctx.activePath.value; if (path) void ctx.openBinary(path); else ctx.notify('请先选中一个文件。', true) } },
    { id: 'plugin.manage', title: '插件…', keywords: 'plugin extension 插件 扩展', enabled: () => ctx.isDesktop, run: () => void ctx.openPlugins() },
    { id: 'file.rule3', rule: true },
    { id: 'app.settings', title: '设置…', keys: 'Ctrl Alt S', keywords: 'settings preferences config keymap 设置', enabled: () => !ctx.working.value, run: () => void ctx.openSettings() },
    // IDEA 的「项目结构…」紧跟「设置」之后：JavaActions.xml:46
    // `<add-to-group group-id="FileMainSettingsGroup" anchor="after" relative-to-action="ShowSettings"/>`。
    { id: 'file.projectStructure', title: '项目结构…', keys: 'Ctrl Alt Shift S', keywords: 'project structure modules libraries sdk 项目结构 模块 库', enabled: () => Boolean(ctx.workspace.value) && !ctx.working.value, run: () => ctx.openProjectStructure() },
    // 从磁盘全部重新加载 (Ctrl+Alt+Y) 紧邻 全部保存（`$default.xml` 的 ForceRefresh）。
    { id: 'file.reloadFromDisk', title: '从磁盘全部重新加载', keys: 'Ctrl Alt Y', keywords: 'reload from disk synchronize 从磁盘重新加载 刷新', enabled: () => Boolean(ctx.workspace.value) && ctx.isDesktop, run: () => void ctx.forceReloadFromDisk() },
    // PlatformActions.xml:419-424 的 `ExportImportGroup`（popup）：导入设置 · 导出设置 · 分隔 · 恢复默认设置。
    { id: 'file.exportImport', title: '导入/导出设置', keywords: 'import export settings zip backup 导入 导出 设置 备份', children: [
      { id: 'file.importSettings', title: '导入设置…', keywords: 'import settings zip 导入设置 恢复', enabled: () => ctx.isDesktop && !ctx.working.value, run: () => void ctx.importSettings() },
      { id: 'file.exportSettings', title: '导出设置…', keywords: 'export settings zip backup 导出设置 备份', enabled: () => ctx.isDesktop && !ctx.working.value, run: () => void ctx.exportSettings() },
      { id: 'file.exportImportRule', rule: true },
      { id: 'file.restoreDefaultSettings', title: '恢复默认设置', keywords: 'restore default settings reset 恢复默认 重置', enabled: () => ctx.isDesktop && !ctx.working.value, run: () => void ctx.restoreDefaultSettings() },
    ] },
    // PlatformActions.xml:430-436 的 `PrintExportGroup`：分隔 + `FileExportGroup`（popup，含 ExportToHTML）
    // + `Print`。`Print` 需要 Win32 打印能力（PrintDlg + 打印 DC + 分页），宿主能力未补，登记待办，不渲染假行。
    { id: 'file.exportGroup', title: '导出', keywords: 'export html print 导出 打印 html', children: [
      { id: 'file.exportToHtml', title: '导出到 HTML…', keywords: 'export html 导出 html 静态页面', enabled: () => ctx.isDesktop && !ctx.working.value, run: () => void ctx.exportToHtml() },
    ] },
    // PlatformActions.xml:437-440 的 `PowerSaveGroup`（分隔 + TogglePowerSave）。
    { id: 'file.powerSaveRule', rule: true },
    { id: 'file.togglePowerSave', title: ctx.powerSaveMode.value ? '退出省电模式' : '进入省电模式', keywords: 'power save mode 省电模式 节能', enabled: () => ctx.isDesktop, run: () => void ctx.togglePowerSave() },
    { id: 'app.quit', title: '退出', keywords: 'exit quit 关闭程序 退出', enabled: () => !ctx.working.value, run: () => { void ctx.quitApp() } },
  ]
  return rows
}
