// 「文件颜色」的三个开关做成**可搜索的勾选行** —— 上游 `FileColorsOptionsTopHitProvider`。
//
// 上游（`lang-impl/src/com/intellij/ui/tabs/FileColorsOptionsTopHitProvider.java`）返回
// `BooleanOptionDescription` 列表：搜索里打勾/去勾即改设置，且**主开关关闭时只列主开关一行**
// （`:30-33` 的 `if (!enabled.isOptionEnabled()) return singletonList(enabled)`）——
// 子开关这时在界面上不可用，列出来只会让人点了没反应。
// 文案取中文包（`LangBundle.properties:260-262` 对应本仓设置页的同一组中文，见
// `src/components/FileColorsSettingsPage.vue:117-119`）：
//   启用文件颜色 / 在编辑器标签页中使用 / 在项目视图中使用。
//
// 本仓的等价通道是**动作索引**（Find Action / Search Everywhere 的 Actions 档，`src/menuUi.ts`），
// 与状态栏组件的 `widgetToggleRows` 同一形态：只出现在搜索里、不占菜单行；勾选态由 `checked` 提供。
export interface FileColorOptionState {
  enabled: boolean
  forTabs: boolean
  forProjectView: boolean
}

export type FileColorOption = 'enabled' | 'forTabs' | 'forProjectView'

export interface FileColorOptionRow {
  id: string
  title: string
  keywords: string
  option: FileColorOption
  /** 当前勾选态（`BooleanOptionDescription.isOptionEnabled`）。 */
  checked: boolean
  /** 此刻能不能点：主开关关掉后两个子开关就是禁用（上游那支根本不返回它们）。 */
  enabled: boolean
}

/** 上游 `getId()` = `APPEARANCE_ID`：整组挂在外观设置页（本仓的设置搜索分组键）。 */
export const FILE_COLORS_SETTINGS_PAGE = 'reference.settings.ide.settings.file-colors'

export function fileColorOptionRows(state: FileColorOptionState): FileColorOptionRow[] {
  const master: FileColorOptionRow = {
    id: 'fileColors.enabled', title: '启用文件颜色',
    keywords: 'file colors enabled 文件颜色 启用 外观', option: 'enabled', checked: state.enabled, enabled: true,
  }
  // 主开关关 ⇒ 只给主开关（上游 `:30-33`）。
  if (!state.enabled) return [master]
  return [
    master,
    { id: 'fileColors.tabs', title: '在编辑器标签页中使用', keywords: 'file colors editor tabs 文件颜色 标签页', option: 'forTabs', checked: state.forTabs, enabled: true },
    { id: 'fileColors.projectView', title: '在项目视图中使用', keywords: 'file colors project view 文件颜色 项目视图', option: 'forProjectView', checked: state.forProjectView, enabled: true },
  ]
}

/** 勾选行翻到的设置补丁（本仓持久化键见 `src/settingsModel.ts` 的 `EditorSettings`）。 */
export function fileColorOptionPatch(option: FileColorOption, value: boolean): Record<string, boolean> {
  if (option === 'enabled') return { fileColorsEnabled: value }
  if (option === 'forTabs') return { fileColorsForTabs: value }
  return { fileColorsForProjectView: value }
}

/** 动作索引里一条勾选行（形状与 `src/menuUi.ts` 的 `ActionEntry` 结构一致，避免互相 import）。 */
export interface FileColorSearchRow {
  id: string
  title: string
  keywords: string
  group: string
  enabled: () => boolean
  checked: () => boolean
  run: () => void
}

/**
 * 三个开关的**搜索行**：读当前设置（`state`）、点一下写回（`write` 就是设置页那条
 * `saveSettingsPatch` 通道），显形规则照上游（主开关关掉只剩一行）。
 */
export function fileColorSearchRows(state: () => FileColorOptionState, write: (patch: Record<string, boolean>) => void): FileColorSearchRow[] {
  return fileColorOptionRows(state()).map(row => ({
    id: row.id, title: row.title, keywords: row.keywords, group: '外观',
    enabled: () => row.enabled, checked: () => row.checked,
    run: () => write(fileColorOptionPatch(row.option, !row.checked)),
  }))
}
