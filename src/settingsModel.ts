// 设置的**形状与默认值**（IDEA 各 `*Configurable` 存在 editor.xml / ide.general.xml / workspace.xml / .idea 里的那几段）。
//
// 从 src/bridge.ts 搬出（2026-09-27）：桥接那一层的职责是「方法名清单 + 宿主事件 + 请求封装」，
// 而项目设置的字段会随着每个设置页的移植不断增长 —— 混在一起会让两边都变难读，而且 bridge.ts
// 早就贴着机检上限。类型与默认值放这里，调用方仍然从 `src/bridge.ts` 取（那边有 `export ... from`），
// 所以既有 import 一行都不用改。
import type { Bookmark } from './bookmarks'
import type { FoldSnapshot } from './editorFoldingState'
import type { TemplateSettings } from './templates'
import type { LineNumeration } from './editorLineNumbers.ts'
import { DEFAULT_BUILD_TOOLS, type BuildToolsSettings } from './gradle.ts'
import type { TrustedPathEntry } from './trustedProjects.ts'

// IDEA's Run Configuration: a program with arguments, a working directory, an
// environment block and an optional "before launch" task chain. `type` picks the
// runner (shell through cmd.exe vs a direct executable).
export interface RunConfig {
  name: string
  // ⚠️ 这里**故意不加** `'jar'`：上游的 JAR 配置类型（`JarApplicationConfigurationType.java:19-22`，
  // 本仓的规范名 `src/jarRun.ts:50` 的 `JAR_APPLICATION_TYPE_ID = 'JarApplication'`）要落地，三张表得一起加 ——
  //   · 本联合（`RunConfig['type']`）；
  //   · `RUN_CONFIG_EDITORS`（`src/runConfigEditors.ts:90`）—— 它是 `Record<NonNullable<RunConfig['type']>, …>`，
  //     只改联合会让这张表少一个键、直接编译不过（2026-10-05 实测：`runConfigEditors.ts:90` TS2741）；
  //   · `RUN_CONFIG_TYPES`（`src/runConfigTree.ts:16`）—— 否则左树不出类型节点。
  // 表补齐后表单才会按 `JAR_FORM_FIELDS`（`jarRun.ts:103`）渲染。
  type?: 'shell' | 'application' | 'debug' | 'compound'
  configurations?: string[]
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
  /**
   * 标记在 TODO 工具窗口里显示的颜色（`#RRGGBB`）。IDEA 的颜色来自颜色方案的
   * `TodoAttributes.getColor()`（`TodoPattern.getColor()` 从 scheme 取）；本仓没有色板页，
   * 等价物是每条模式自带一个颜色，缺省时工具窗口用 `TODO_COLOR_FALLBACK` 的中性色。
   */
  color?: string
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
  /**
   * AudioCuesConfigurable（`ide.audiocues`，注册行 intellij.platform.ide.impl.xml:971-976
   * `groupId="appearance" groupWeight="140" id="ide.audiocues"`）的 mode 档。
   * 值域三档 `auto` / `on` / `off` = 上游 `AudioCuesMode`（`AudioCuesSettings.kt:75-79`），
   * 消费判定 `AudioCuesMode.isOn`（`:85-89`，AUTO → 屏幕阅读器是否开着）—— 本仓的探针是
   * 「支持屏幕阅读器」设置（`src/audioCues.ts:71-75` 的 `isAudioCueModeOn`）。
   * **默认仍是 off**（不是上游的 `AUTO`）：AUTO 在默认配置下（`supportScreenReaders=false`）
   * 判定结果与 off 相同，但显式 off 不依赖探针的取值，差异记在这里而不是藏在别处。
   */
  audioCuesMode?: 'auto' | 'on' | 'off'
  /**
   * `AudioCuesSettingsState.disabledCues`（`AudioCuesSettings.kt:69-72`，`Set<String>`）：
   * 逐 cue 停用的 id 表。存数组（与 IDEA 的 Set 同序无关，读出口 `disabledCueIds` 容忍坏值）。
   * 消费点 `src/audioCueHost.ts` 的 `cueAllowed`（`isCueEnabled`，`audioCues.ts:86-91`）。
   */
  audioCuesDisabled: string[]
  autoShowProcessPopup: boolean          // ide.windowSystem.autoShowProcessPopup (registry.properties:209-210，默认 false)
  // search.everywhere.fuzzy.files.enabled（SeFuzzyFileSearchProviderFactory.kt:28-31，默认 false）：
  // 打开后「随处搜索」的文件来源改用 Smith-Waterman 本地对齐（src/fuzzyMatch.ts）。
  fuzzyFileSearch: boolean
  // ConsoleConfigurable（`Console`）：控制台行折叠规则 —— 要折叠的行 + 不折叠的例外（各为字符串列表）。
  foldConsoleLines: string[]; foldExceptions: string[]
  // ToolConfigurable（`preferences.externalTools`）：应用级的外部命令收藏（名称 + 命令）。
  externalTools: Array<{ name: string; command: string }>
  // XDebuggerDataViewSettings（调试器的数据视图，IDEA 存 xdebugger.xml）：本仓把它随 general
  // 落盘（与 ConsoleConfigurable 的折叠规则同一策略 —— 都是没有独立存储层时的应用级开关）。
  //   · debuggerHideNullValues —— 值为 null 的变量/数组元素不显示；
  //   · debuggerSortByName —— 命名变量按名字排序（数组元素保持索引序）；
  //   · debuggerShowValuesInline —— `XDebuggerDataViewSettings.showValuesInline`（上游默认 true）：
  //     在编辑器执行行行尾渲染当前帧的变量值（消费者 src/debugInlineValues.ts → src/editorDebugLine.ts）。
  //     本仓的渲染是子集（见 src/debugInlineValues.ts 文件头），默认 **false**（不冒充上游默认值）；
  //   · debuggerShowLibraryFrames —— `isShowLibraryStackFrames`（上游默认 false）：调用堆栈里是否
  //     显示适配器标为 `presentationHint: 'subtle'` 的库帧（src/debugDataView.ts 的 visibleFrames）。
  // XDebuggerGeneralSettings（xdebugger-impl/.../settings/XDebuggerGeneralSettings.java）：
  //   · debuggerConfirmBreakpointRemoval —— `isConfirmBreakpointRemoval`（默认 false）：移除断点前确认；
  //   · debuggerUnmuteOnStop —— `isUnmuteOnStop`（默认 false）：会话停在断点时自动取消断点静音
  //     （上游 XDebugSessionBreakpointManager.unmuteOnStop，消费点 src/debugBreakpointMute.ts）；
  //   · debuggerEvaluationMode —— `getEvaluationDialogMode`（`EvaluationMode.EXPRESSION | CODE_FRAGMENT`，
  //     默认 EXPRESSION）：求值对话框是单行表达式还是代码片段编辑器（src/components/DebugEvaluateDialog.vue）。
  debuggerHideNullValues: boolean; debuggerSortByName: boolean; debuggerShowValuesInline: boolean
  debuggerShowLibraryFrames: boolean; debuggerConfirmBreakpointRemoval: boolean
  debuggerUnmuteOnStop: boolean; debuggerEvaluationMode: 'expression' | 'codeFragment'
  // 受信任项目清单（IDEA `TrustedPaths`，应用级 `trusted-paths.xml` 的 `Map<Path, Boolean>`）：
  // 本仓落成 `{path, trusted}` 数组（路径归一后存放；trusted=false 表示「以后不再问 + 不信任」）。
  // 判据与执行门：src/trustedProjects.ts（前端）+ native/trusted_paths.cpp（硬边界）。
  trustedPaths: TrustedPathEntry[]
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
  // 音频提示（无障碍）：mode 三档（audio.cues.mode.auto/on/off，AudioCuesSettings.kt:75-79），
  // 本仓默认 off（上游默认 AUTO —— 差异见 GeneralSettingsState.audioCuesMode 的注释）；
  // 逐 cue 停用表默认空 = 六个 cue 全开（同上游 disabledCues 的空 Set 默认）。
  audioCuesMode: 'off',
  audioCuesDisabled: [],
  autoShowProcessPopup: false,
  fuzzyFileSearch: false,
  foldConsoleLines: [],
  foldExceptions: [],
  externalTools: [],
  // XDebuggerDataViewSettings 的两格：默认都不开（IDEA 的默认值也是显示 null、不排序）。
  debuggerHideNullValues: false,
  debuggerSortByName: false,
  // 行内值：上游 showValuesInline 默认 true，但本仓渲染是子集（只到当前帧第一个作用域），
  // 所以默认 false，让用户显式打开（差异写在 src/debugInlineValues.ts 文件头）。
  debuggerShowValuesInline: false,
  // 库帧（presentationHint=subtle）默认不显示（上游 isShowLibraryStackFrames 默认 false）。
  debuggerShowLibraryFrames: false,
  // 移断点确认、停在断点自动取消静音：上游默认都关。
  debuggerConfirmBreakpointRemoval: false,
  debuggerUnmuteOnStop: false,
  // 求值对话框默认表达式模式（上游 XDebuggerGeneralSettings 的 EXPRESSION）。
  debuggerEvaluationMode: 'expression',
  // 受信任清单默认空 = 陌生目录第一次打开都要问（上游 `TrustedPaths.State` 默认空 map）。
  trustedPaths: [],
}
export const defaultEditorSettings: EditorSettings = { collapseImports: true, collapseCustomRegions: false, fontSize: 14, tabSize: 4, wordWrap: false, lineNumbers: true, showIndentGuides: true, bracketMatching: true, tabLimit: 30, tabsInOneRow: true, hideTabsIfNeeded: true, sortBookmarks: false, useTabCharacter: false, showWhitespaces: false, formatOnSave: false, uiZoomPercent: 100, compactMode: false, fullPathsInWindowHeader: false, showTreeIndentGuides: false, compactTreeIndents: false, smoothScrolling: true, showIconsInMenus: true, rememberSizeForEachToolWindow: false, showToolWindowNames: false, showToolWindowBars: true, leftSideBySide: false, wideScreenSupport: false, rightSideBySide: false, showToolWindowNumbers: false, keepPopupsForToggles: false, dndWithPressedAltOnly: false, powerSaveMode: false, useContrastScrollbars: false, colorBlindness: 'none', uiFontFamily: '', uiFontSize: 13, backgroundImagePath: '', backgroundImageOpacity: 100, backgroundImageFill: 'scale', backgroundImageKeepRatio: true, presentationMode: false, presentationModeFontSize: 24, mainMenuDisplayMode: 'hamburger', differentiateProjects: false, expandNodesWithSingleClick: false, maximizeEditorOnTabDoubleClick: true, pinnedTabsInSeparateRow: false, showBreadcrumbs: true, showStatusBar: true, rightMargin: true, breadcrumbsPlacement: 'bottom', breadcrumbsLanguages: {}, showMembersInNavigationBar: true, showDiagnostics: true, showErrorStripe: true, reformatOnPaste: 'indentEachLine', bidiTextDirection: 'contentBased', showGutterIcons: true , showStickyLines: true, stickyLinesLimit: 5, diffContextLines: 3, fileColorsEnabled: true, fileColorsForTabs: true, fileColorsForProjectView: true, lineNumeration: 'absolute', showTypeInlayHints: true, showParameterInlayHints: true, showOtherInlayHints: true }
export const defaultProjectSettings: ProjectSettings = {
  excludedDirs: ['.git', 'node_modules', 'build', 'dist'],
  runConfigs: [],
  bookmarks: [],
  // DefaultTodoDefaultPatternProvider.getDefaultPatterns 只有两条，正则逐字照抄。
  // 颜色对默认色板的 TodoAttributes：TODO 蓝、FIXME 红（本仓存 `#RRGGBB`）。
  todoPatterns: [
    { pattern: '\\btodo\\b.*', description: '待办', color: '#4a86e8' },
    { pattern: '\\bfixme\\b.*', description: '需要修', color: '#e5484d' },
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
export interface EditorSettings { collapseImports: boolean; collapseCustomRegions: boolean; fontSize: number; tabSize: number; wordWrap: boolean; lineNumbers: boolean; showIndentGuides: boolean; bracketMatching: boolean; /** IDEA `EditorSettingsExternalizable.LINE_NUMERATION`（`EditorSettings.LineNumerationType`，默认 ABSOLUTE）：绝对/相对/混合行号，转换器在 `src/editorLineNumbers.ts`。 */ lineNumeration: LineNumeration; tabLimit: number; /** IDEA「显示一行」（`UISettings.scrollTabLayoutInEditor`）：true = 单行裁切 + 「…」，false = 多行换行不裁切。 */ tabsInOneRow: boolean;
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
  // IDEA `UISettings.showMembersInNavigationBar`（`UISettingsState.kt:121` 默认 **true**）：
  // 关掉后面包屑/导航栏只到类型那一层，不再列出成员（`JavaBreadcrumbsInfoProvider.java:125`
  // `return !UISettings.getInstance().getShowMembersInNavigationBar()`；`JavaNavBarExtension.java:103/107`
  // 把 `PsiClass` 的成员从导航栏里滤掉）。上游那个切换动作 `ViewNavigationBarMembersAction.java:20`
  // 只在**旧 UI** 出现（`setEnabledAndVisible(!isNewUI)`），本仓没有新旧 UI 之分，所以设置项常驻。
  showMembersInNavigationBar: boolean;
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
  /**
   * InlaySettingsConfigurable（`inlay.hints`，注册行 `intellij.platform.lang.impl.xml:935-941`：
   * `<projectConfigurable provider="…InlaySettingsConfigurableProvider" id="inlay.hints"
   * parentId="editor" key="settings.hints" …/>`）—— 上游是**按 provider**（`InlayProviderSettingsModel.isEnabled`，
   * `platform/lang-api/.../settings/InlayProviderSettingsModel.kt:26`）逐个勾的清单树。
   * 本仓的 provider 只有一个：LSP 的 `textDocument/inlayHint`；它的 `kind` 分三档
   * （LSP 规范：1 = Type，2 = Parameter；其余归第三档），于是三把键对三档。
   * 键名与分组见 `src/inlayHints.ts` 的 `INLAY_HINT_SETTING_KEYS`，消费点是
   * `src/editorInlayHints.ts` 的 `createInlayHints`（按 `shouldShowInlayHint` 过滤）。
   * 默认全开（上游 `InlayHintsSettings.hintsEnabled` 出厂为真，见 `InlayProviderSettingsModel.isEnabled`）。
   */
  showTypeInlayHints: boolean; showParameterInlayHints: boolean; showOtherInlayHints: boolean
}
