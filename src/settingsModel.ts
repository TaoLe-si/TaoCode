// 设置的**形状与默认值**（IDEA 各 `*Configurable` 存在 editor.xml / ide.general.xml / workspace.xml / .idea 里的那几段）。
//
// 从 src/bridge.ts 搬出（2026-09-27）：桥接那一层的职责是「方法名清单 + 宿主事件 + 请求封装」，
// 而项目设置的字段会随着每个设置页的移植不断增长 —— 混在一起会让两边都变难读，而且 bridge.ts
// 早就贴着机检上限。类型与默认值放这里，调用方仍然从 `src/bridge.ts` 取（那边有 `export ... from`），
// 所以既有 import 一行都不用改。
import type { Bookmark } from './bookmarks'
import type { FoldSnapshot } from './editorFoldingState'
import type { TemplateSettings } from './templates'
import { DEFAULT_BUILD_TOOLS, type BuildToolsSettings } from './gradle.ts'

// IDEA's Run Configuration: a program with arguments, a working directory, an
// environment block and an optional "before launch" task chain. `type` picks the
// runner (shell through cmd.exe vs a direct executable).
export interface RunConfig {
  name: string
  type?: 'shell' | 'application' | 'debug'
  command: string
  program?: string
  args?: string[]
  cwd?: string
  env?: string[]
  // Before-launch build steps, run in order; a non-zero exit aborts the run
  // (IDEA's "Before launch: Build" gate).
  beforeLaunch?: Array<{ name: string; command: string }>
  // The debug adapter key from TaoCode.dap.json. IDEA keeps it in the run
  // configuration's Debugger tab; the Debug panel reads the same field instead of
  // keeping a second, editable copy of the launch settings.
  adapter?: string
  // Left-tree folder (IDEA's `RunConfigurableNodeKind.FOLDER`, RunConfigurable.kt:180 —
  // the userObject of a folder node is its name). Absent/empty means "directly under the
  // configuration type node".
  folder?: string
  /**
   * 「Allow running multiple instances of the application simultaneously」——
   * IDEA `RunConfigurationOptions.isAllowRunningInParallel`（`:54-56`，默认 **false**）。
   * 关闭时再启动同一配置会**先停掉上一个实例**；打开则两个并存（宿主 native/run_host.cpp 的规则）。
   */
  allowRunningInParallel?: boolean
}
export interface RunStartParams { command?: string; program?: string; args?: string[]; cwd?: string; env?: string[]; shell?: boolean; label?: string; beforeLaunch?: Array<{ name: string; command: string }>; /** 配置的 `allowRunningInParallel`：false 时宿主会先停掉同名实例（IDEA ExecutionManagerImpl.kt:613-619）。 */ allowParallel?: boolean }
// IDEA's TODO index is driven by a list of "pattern -> description" entries, stored
// with the project so a repository carries its own markers.
export interface TodoPattern {
  pattern: string
  description: string
  /** IDEA TodoPattern.isCaseSensitive()：默认 false（不区分大小写）。 */
  caseSensitive?: boolean
}
export interface JavaProjectSettings { jdkHome: string; jdkName: string; sourcePaths: string[]; outputPath: string; referencedLibraries: string[] }
// jdkName 存 IDEA 的 SDK 显示名（`17`/`1.8`，JdkUtil.suggestJdkName），jdt.ls 的 JavaSE-x 只在原生 runtimes 边界归一。
export const defaultJavaProjectSettings: JavaProjectSettings = { jdkHome: '', jdkName: '17', sourcePaths: [], outputPath: '', referencedLibraries: ['lib/**/*.jar'] }
// 命名作用域（IDEA `project.scopes`）。IDEA 把它拆成两个持有者存：本地作用域在 workspace.xml 的
// `NamedScopeManager`、共享作用域在 .idea 的 `DependencyValidationManager`（NamedScopesHolder.java:125-165，
// 每条只有 name/pattern）。TaoCode 用一条数组保存，`shared` 表示归属哪个持有者；
// 数组下标即 `ScopeChooserConfigurableState.myOrder` 要保住的顺序。
export interface NamedScopeSetting { name: string; pattern: string; shared: boolean }
// 文件颜色（IDEA `com.intellij.ui.tabs`）：`FileColorConfiguration` 只有 scopeName + colorID，
// 数组顺序即优先级（`FileColorsModel.findConfigurationWithScopeFilter:247-260` 首个命中就返回）。
export type { FileColorSetting } from './fileColors.ts'
import type { FileColorSetting } from './fileColors.ts'
// 书签工具窗口的视图状态（IDEA `BookmarksViewState`）：只收录有真实落点的四个开关
// （`rewriteBookmarkType` 的落点是"改贴已占用的助记键时是否还问"，见 bookmarkActions）。
export interface BookmarksViewState { groupLineBookmarks: boolean; rewriteBookmarkType: boolean; askBeforeDeletingLists: boolean; autoscrollToSource: boolean; autoscrollFromSource: boolean }
/**
 * 导出到 HTML 的设置（IDEA `ExportToHTMLSettings`，`:14-15`
 * `@State(name = "ExportToHTMLSettings", storages = @Storage(StoragePathMacros.WORKSPACE_FILE))` ⇒ **项目级**）。
 *   · `scope` —— `PrintSettings.java:82-84` 的 `PRINT_FILE=1` / `PRINT_SELECTED_TEXT=2` / `PRINT_DIRECTORY=4`；
 *     `0` = 还没选过（IDEA 那个字段的默认值就是 0），对话框按当前上下文决定初值；
 *   · `printLineNumbers` / `openInBrowser` / `outputDirectory` —— `ExportToHTMLSettings.java:17-19`；
 *   · `includeSubdirectories` —— `:22-23`（只在「当前目录」范围下有意义，UI 也只在那一档可用）。
 */
export interface ExportToHtmlSettings {
  scope: 0 | 1 | 2 | 4
  includeSubdirectories: boolean
  printLineNumbers: boolean
  openInBrowser: boolean
  outputDirectory: string
}

export const defaultExportToHtmlSettings: ExportToHtmlSettings = {
  scope: 0, includeSubdirectories: false, printLineNumbers: false, openInBrowser: false, outputDirectory: '',
}
// 命名书签列表（上游 `ManagerState.groups` 里的**非默认**那一部分；默认列表就是历史字段 `bookmarks`）。
export interface BookmarkListSetting { name: string; isDefault: boolean; bookmarks: Bookmark[] }
export interface ProjectSettings { /** 折叠状态（IDEA 的 workspace 文件那一段；键是项目内相对路径）。 */ foldingState?: Record<string, FoldSnapshot[]>; excludedDirs: string[]; runConfigs: RunConfig[]; bookmarks: Bookmark[]; bookmarkLists?: BookmarkListSetting[]; bookmarksView?: BookmarksViewState; todoPatterns: TodoPattern[]; templates: TemplateSettings; java: JavaProjectSettings; fileAssociations: Record<string, string>; /** VCS Log 的 UI 开关（IDEA VcsLogApplicationSettings 的 SHOW_TAG_NAMES / SHOW_ROOT_NAMES）。 */ vcsLog?: { showTagNames: boolean; showRootNames: boolean }; /** 命名作用域（IDEA project.scopes）。 */ scopes?: NamedScopeSetting[]; /** 文件颜色（IDEA `com.intellij.ui.tabs` 的 File Colors）：作用域名 + 颜色名，数组顺序即优先级。 */ fileColors?: FileColorSetting[]; localFileColors: FileColorSetting[]; /** 构建工具（IDEA `build.tools` 组：外部系统自动重载 + Gradle 项目设置），**项目级**。 */ buildTools?: BuildToolsSettings; exportToHtml?: ExportToHtmlSettings }
export interface ProjectForm { parent: string; name: string; template: 'empty' | 'cpp' | 'java' | 'spring-boot' | 'maven' | 'gradle' | 'kotlin' | 'python' | 'node' | 'vue' | 'react'; source: string }
export interface AppState { recentProjects: RecentProject[]; settings: EditorSettings; general?: GeneralSettingsState; lastProject: string | null; gitAvailable: boolean; defaultParent: string }
// Source: platform/ide-core/src/com/intellij/ide/GeneralSettings.kt:227-266
// (GeneralSettingsState) — the application-level PersistentStateComponent stored
// in ide.general.xml that GeneralSettingsConfigurable.kt binds its panel to.
// Field names mirror the Kotlin data class; confirmOpenNewProject2 stays
// null-able exactly as in the source (null means "ask", OPEN_PROJECT_ASK).
export type ProcessCloseConfirmation = 'ASK' | 'TERMINATE' | 'DISCONNECT'
export interface GeneralSettingsState {
  defaultProjectDirectory: string
  reopenLastProject: boolean
  deleteToBin: boolean
  autoSyncFiles: boolean
  backgroundSyncFiles: boolean
  autoSaveFiles: boolean
  autoSaveIfInactive: boolean
  isUseSafeWrite: boolean
  confirmExit: boolean
  isShowWelcomeScreen: boolean
  confirmOpenNewProject2: number | null  // OPEN_PROJECT_ASK=-1 / NEW_WINDOW=0 / SAME_WINDOW=1 / ATTACH=2
  processCloseConfirmation: ProcessCloseConfirmation
  inactiveTimeout: number                // SAVE_FILES_AFTER_IDLE_SEC = UINumericRange(15, 1, 300)
  supportScreenReaders: boolean          // GeneralSettingsState.supportScreenReaders (kt:265), getter :179-186
  autoShowProcessPopup: boolean          // ide.windowSystem.autoShowProcessPopup (registry.properties:209-210，默认 false)
  // search.everywhere.fuzzy.files.enabled（SeFuzzyFileSearchProviderFactory.kt:28-31，默认 false）：
  // 打开后「随处搜索」的文件来源改用 Smith-Waterman 本地对齐（src/fuzzyMatch.ts）。
  fuzzyFileSearch: boolean
  // ConsoleConfigurable（`Console`）：控制台行折叠规则 —— 要折叠的行 + 不折叠的例外（各为字符串列表）。
  foldConsoleLines: string[]; foldExceptions: string[]
  // ToolConfigurable（`preferences.externalTools`）：应用级的外部命令收藏（名称 + 命令）。
  externalTools: Array<{ name: string; command: string }>
  // StickyLinesConfigurable（`editor.stickyLines`）：粘性作用域行开关与层数上限。
}
// 注：`build.tools` **不在应用级** —— 它是 projectConfigurable（ExternalSystemGroupConfigurable.kt:22-26）。
// TaoCode 早先把「自动重新加载」做成应用级布尔，那是错作用域 + 错元数，现已归 `ProjectSettings.buildTools`。
// Defaults are the Kotlin data-class defaults (GeneralSettings.kt:230-265):
// reopenLastProject/deleteToBin/autoSyncFiles/backgroundSyncFiles/autoSaveFiles/
// isUseSafeWrite/confirmExit/isShowWelcomeScreen true; autoSaveIfInactive and
// supportScreenReaders false
// with inactiveTimeout 15; confirmOpenNewProject2 null (ask);
// processCloseConfirmation 'ASK'.
export const defaultGeneralSettings: GeneralSettingsState = {
  defaultProjectDirectory: '',
  reopenLastProject: true,
  deleteToBin: true,
  autoSyncFiles: true,
  backgroundSyncFiles: true,
  autoSaveFiles: true,
  autoSaveIfInactive: false,
  isUseSafeWrite: true,
  confirmExit: true,
  isShowWelcomeScreen: true,
  confirmOpenNewProject2: null,
  processCloseConfirmation: 'ASK',
  inactiveTimeout: 15,
  supportScreenReaders: false,
  autoShowProcessPopup: false,
  fuzzyFileSearch: false,
  foldConsoleLines: [],
  foldExceptions: [],
  externalTools: [],
}
export const defaultEditorSettings: EditorSettings = { collapseImports: true, collapseCustomRegions: false, fontSize: 14, tabSize: 4, wordWrap: false, lineNumbers: true, showIndentGuides: true, bracketMatching: true, tabLimit: 30, tabsInOneRow: true, hideTabsIfNeeded: true, sortBookmarks: false, useTabCharacter: false, showWhitespaces: false, formatOnSave: false, uiZoomPercent: 100, compactMode: false, fullPathsInWindowHeader: false, showTreeIndentGuides: false, compactTreeIndents: false, smoothScrolling: true, showIconsInMenus: true, rememberSizeForEachToolWindow: false, showToolWindowNames: false, showToolWindowBars: true, leftSideBySide: false, wideScreenSupport: false, rightSideBySide: false, showToolWindowNumbers: false, keepPopupsForToggles: false, dndWithPressedAltOnly: false, powerSaveMode: false, useContrastScrollbars: false, colorBlindness: 'none', uiFontFamily: '', uiFontSize: 13, backgroundImagePath: '', backgroundImageOpacity: 100, backgroundImageFill: 'scale', backgroundImageKeepRatio: true, presentationMode: false, presentationModeFontSize: 24, mainMenuDisplayMode: 'hamburger', differentiateProjects: false, expandNodesWithSingleClick: false, maximizeEditorOnTabDoubleClick: true, pinnedTabsInSeparateRow: false, showBreadcrumbs: true, showStatusBar: true, rightMargin: true, breadcrumbsPlacement: 'bottom', breadcrumbsLanguages: {}, showDiagnostics: true, showErrorStripe: true, reformatOnPaste: 'indentEachLine', bidiTextDirection: 'contentBased', showGutterIcons: true , showStickyLines: true, stickyLinesLimit: 3, diffContextLines: 3, fileColorsEnabled: true, fileColorsForTabs: true, fileColorsForProjectView: true }
export const defaultProjectSettings: ProjectSettings = {
  excludedDirs: ['.git', 'node_modules', 'build', 'dist'],
  runConfigs: [],
  bookmarks: [],
  // DefaultTodoDefaultPatternProvider.getDefaultPatterns 只有两条，正则逐字照抄。
  todoPatterns: [
    { pattern: '\\btodo\\b.*', description: '待办' },
    { pattern: '\\bfixme\\b.*', description: '需要修' },
  ],
  templates: { overrides: [], customs: [] },
  java: structuredClone(defaultJavaProjectSettings),
  fileAssociations: {},
  // NamedScope.EMPTY_ARRAY: a fresh project has no scopes.
  scopes: [], fileColors: [], localFileColors: [],
  // BookmarksViewState 的默认值（platform/bookmarks/.../BookmarksViewState.kt:23-29）。
  bookmarksView: { groupLineBookmarks: true, rewriteBookmarkType: false, askBeforeDeletingLists: true, autoscrollToSource: false, autoscrollFromSource: false },
  bookmarkLists: [],
  // 构建工具（IDEA 设置「构建、执行、部署 › 构建工具」）。**项目级**：IDEA 的
  // `ExternalSystemGroupConfigurable` 是 projectConfigurable，`GradleSettings` 存 `.idea/gradle.xml`。
  buildTools: structuredClone(DEFAULT_BUILD_TOOLS),
  // 导出到 HTML（IDEA ExportToHTMLSettings 的字段默认值：三个布尔 false、目录为空、范围未选）。
  exportToHtml: { ...defaultExportToHtmlSettings },
}

export interface RecentProject {
  name: string;
  path: string;
  lastOpened: string;
  available: boolean;
  // Source: RecentProjectMetaInfo.displayName (RecentProjectsManagerBase.kt:99-101).
  // Falls back to the directory name when missing; RecentProjectListActionProvider
  // builds `projectNameToDisplay` from it.
  displayName?: string;
  // Source: RecentProjectMetaInfo.customProjectName (RecentProjectsManagerBase.kt:108-110)
  // — cached .idea/.name to avoid I/O on non-local paths.
  projectName?: string;
  // Source: RecentProjectMetaInfo.activationTimestamp — epoch seconds used by
  // RecentProjectListActionProvider to sort the recent projects pop-up.
  activationTimestamp?: number;
  // Source: RecentProjectsBranchesProvider.getCurrentBranch — populated by the
  // welcome screen when a branch is known, otherwise undefined.
  branchName?: string;
}

// uiZoomPercent / compactMode / fullPathsInWindowHeader mirror IDEA's
// AppearanceConfigurable (IdeScaleTransformer bounds 50-400, compact mode, full
// paths in the window header). They are appearance state but ride the same
// settings.update channel as the editor flags, so one save covers both pages.
// 「编辑器 › 代码折叠」里本仓有消费者的两格（上游 CodeFoldingSettings 的五个见 src/editorFoldingSettings.ts）
export interface EditorSettings { collapseImports: boolean; collapseCustomRegions: boolean; fontSize: number; tabSize: number; wordWrap: boolean; lineNumbers: boolean; showIndentGuides: boolean; bracketMatching: boolean; tabLimit: number; /** IDEA「显示一行」（`UISettings.scrollTabLayoutInEditor`）：true = 单行裁切 + 「…」，false = 多行换行不裁切。 */ tabsInOneRow: boolean;
  /**
   * `UISettings.sortBookmarks`（`UISettingsState.kt:249`，默认 **false**）：书签列表按
   * **位置**（路径 + 行号）排还是按**加入顺序**排。默认 false = 加入顺序，与上游一致。
   */ sortBookmarks: boolean;
  /**
   * `UISettings.hideTabsIfNeeded`（`UISettingsState.kt:125`，默认 **true**）：单行且放不下时怎么办 ——
   * true = 滚动标签页面板（`ScrollableMultiRowLayout`），false = 挤压标签页（`CompressibleMultiRowLayout`）。
   * 只在 `tabsInOneRow` 为真时有意义（设置页那一组单选的下级）。
   */ hideTabsIfNeeded: boolean; useTabCharacter: boolean; showWhitespaces: boolean; formatOnSave: boolean; uiZoomPercent: number; compactMode: boolean; fullPathsInWindowHeader: boolean;
  // IDEA AppearanceConfigurable 'Tree Views' group: indent guides and smaller
  // tree indents; FileTree renders both.
  showTreeIndentGuides: boolean; compactTreeIndents: boolean;
  // BreadcrumbsConfigurable（`editor.breadcrumbs`，BreadcrumbsConfigurableUI.kt:44-70）三项：
  //   显示开关 = EditorSettingsExternalizable.isBreadcrumbsShown（:439-453）
  //   位置     = isBreadcrumbsAbove（:420-430）—— 只有「上 / 下」，默认下方（OptionSet:91）
  //   按语言开关 = mapLanguageBreadcrumbs（:146-152）—— **只存被显式配置过的语言**，
  //                没进表就是显示（isBreadcrumbsShownFor :459-466）
  showBreadcrumbs: boolean
  // IDEA 的 UISettings.showStatusBar / EditorSettings.IS_RIGHT_MARGIN_SHOWN —— 专注模式要批量切换它们
  // （ToggleDistractionFreeModeAction.applyAndSave:96/108），所以它们必须是**真实存在的设置**。
  showStatusBar: boolean; rightMargin: boolean; breadcrumbsPlacement: 'top' | 'bottom';
  breadcrumbsLanguages: Record<string, boolean>;
  // Error highlighting（`Errors`）：LSP 诊断的显示开关（波浪线 / 滚动条错误标记）。
  showDiagnostics: boolean; showErrorStripe: boolean;
  // 粘贴时的缩进/重新格式化（IDEA `CodeInsightSettings.REFORMAT_ON_PASTE`，`CodeInsightSettings.java:144`
  // 默认 INDENT_EACH_LINE；该设置同样持久化在 `editor.xml`，所以归 editorSettings）。
  // 取值见 src/pasteOptions.ts；消费点是编辑器粘贴通道。
  reformatOnPaste: 'none' | 'indentBlock' | 'indentEachLine' | 'reformatBlock';
  // 行内装订线图标（IDEA `EditorSettingsExternalizable.ARE_GUTTER_ICONS_SHOWN`，
  // `EditorSettingsExternalizable.java:87` 默认 true）。开关动作 `EditorToggleShowGutterIcons`
  // （`intellij.platform.ide.impl.actions.xml:415`），设置页 `editor.preferences.gutterIcons`。
  showGutterIcons: boolean;
  // FileColorManagerImpl.java:75-106: all switches true.
  // FileColorModelStorageManager.kt:27-38: both color lists belong to the project, not editor settings.
  fileColorsEnabled: boolean; fileColorsForTabs: boolean; fileColorsForProjectView: boolean;
  // 双向文本方向（IDEA `EditorSettingsExternalizable.BIDI_TEXT_DIRECTION`，`EditorSettingsExternalizable.java:137`
  // 默认 CONTENT_BASED；枚举只有三个值，见 `BidiTextDirection.java:21-23`）。
  // 它不是设置页里的行，而是「视图 › 文本方向」子菜单的三个 ToggleAction（PlatformActions.xml:591-595）。
  bidiTextDirection: 'contentBased' | 'ltr' | 'rtl';
  // IDEA 'UI Options' group: smooth scrolling (scroll-behavior on the whole UI)
  // and icons in menu items (the leading icon column of menu rows).
  smoothScrolling: boolean; showIconsInMenus: boolean;
  // IDEA 'Tool Windows' group: remember a size per tool window instead of one
  // shared stripe size, draw the tool window name under its stripe icon, and hide
  // the stripes entirely (UISettings.hideToolStripes / showToolWindowsNames /
  // rememberSizeForEachToolWindow). Defaults follow IDEA: names off, bars shown,
  // per-window size off.
  rememberSizeForEachToolWindow: boolean; showToolWindowNames: boolean; showToolWindowBars: boolean;
  // IDEA "Side-by-side layout on the left" (UISettings.leftHorizontalSplit) shows the
  // project view under the active left tool window; "Widescreen tool window layout"
  // (wideScreenSupport) maximizes vertical tool windows by limiting the height of
  // the bottom one. Both default off, as in IDEA.
  leftSideBySide: boolean; wideScreenSupport: boolean;
  // The same option for the right stripe (UISettings.rightHorizontalSplit).
  rightSideBySide: boolean;
  // IDEA "Show tool window numbers" (UISettings.showToolWindowsNumbers): the stripe
  // buttons carry Alt+1..9 mnemonics and those shortcuts focus the window.
  showToolWindowNumbers: boolean;
  // IDEA "Keep popups open for toggle items" (keepPopupsForToggles): a menu stays
  // open while you flip checkable rows; "Drag-and-drop with Alt pressed only"
  // (dndWithPressedAltOnly) requires Alt to start a tab drag.
  keepPopupsForToggles: boolean; dndWithPressedAltOnly: boolean;
  // IDEA PowerSaveMode (core-api PowerSaveMode.java): while it is on the IDE stops
  // code insight and background work. TaoCode turns off language-service requests
  // and the background polls; the status-bar widget toggles it.
  powerSaveMode: boolean;
  // AppearanceConfigurable, the three items that do have a real consumer here:
  //  - useContrastScrollbars (UISettings) -> high-contrast scrollbars in CSS
  //  - colorBlindness -> an SVG feColorMatrix filter on the root element
  //  - uiFontFamily / uiFontSize -> the UI font stack (editor font is separate)
  useContrastScrollbars: boolean;
  colorBlindness: 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia';
  uiFontFamily: string; uiFontSize: number;
  // IDEA Images.SetBackgroundImage: the spec IDEA stores is
  // "path,opacity,fillType,anchor,keepRatio"; TaoCode keeps the same knobs as
  // separate fields and re-reads the file through app.readImage on startup.
  backgroundImagePath: string; backgroundImageOpacity: number;
  backgroundImageFill: 'scale' | 'tile' | 'center'; backgroundImageKeepRatio: boolean;
  // IDEA presentation mode (UISettingsState.presentationMode + presentationModeFontSize).
  presentationMode: boolean; presentationModeFontSize: number;
  // IDEA UISettingsState.mainMenuDisplayMode: UNDER_HAMBURGER_BUTTON /
  // MERGED_WITH_MAIN_TOOLBAR / SEPARATE_TOOLBAR -> the three top-bar layouts.
  mainMenuDisplayMode: 'hamburger' | 'merged' | 'separate';
  // IDEA UISettingsState.differentiateProjects: tint the main toolbar with a
  // per-project colour so projects are distinguishable at a glance
  // (AppearanceConfigurable cdDifferentiateProjects + its comment).
  differentiateProjects: boolean;
  // IDEA UISettingsState.expandNodesWithSingleClick (UISettingsState.kt:141,
  // default false): when off, project-view directories expand on double click and
  // single click only selects (FileTree honours both modes).
  expandNodesWithSingleClick: boolean;
  // IDEA 高级设置 `editor.maximize.on.double.click`（`intellij.platform.ide.impl.xml:1511`，默认 **true**）：
  // 双击编辑器标签时执行「隐藏全部工具窗口 / 恢复窗口」。同组另一条
  // `editor.maximize.in.splits.on.double.click`（`:1512`，默认 false）在 TaoCode 没有对应形态
  // （本仓的"最大化编辑器"是整体布局动作，不是"编辑器内分屏最大化"那一档），所以只落前一条。
  maximizeEditorOnTabDoubleClick: boolean;
  // IDEA 设置页「在单独一行中显示固定标签」(`showPinnedTabsInASeparateRow`，
  // `UISettingsState.kt:127` 默认 false；文案 `ApplicationBundle.properties:324`)。
  // 上游还要**同时**打开高级设置 `editor.keep.pinned.tabs.on.left`(默认 true)才生效
  // （`TabLayout.showPinnedTabsSeparately():75-78`）—— 本仓那条高级设置没有消费者，
  // 所以这里按"设置页开关"这一档落，恒成立的那半不另造一个开关。
  pinnedTabsInSeparateRow: boolean;
  /** StickyLinesConfigurable：粘性作用域行开关与层数上限（IDEA editor.stickyLines）。 */
  showStickyLines: boolean
  stickyLinesLimit: number
  /** DiffSettingsConfigurable：统一 diff 的上下文行数（IDEA diff settings.context.lines）。 */
  diffContextLines: number
}
