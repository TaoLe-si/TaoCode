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
import { DEFAULT_DATE_TIME_FORMAT_SETTINGS, type SystemDateTimeFormats } from './dateTimeFormat.ts'

// IDEA's Run Configuration: a program with arguments, a working directory, an
// environment block and an optional "before launch" task chain. `type` picks the
// runner (shell through cmd.exe vs a direct executable).
export interface RunConfig {
  name: string
  // JAR 配置类型（上游 `java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurationType.java:19-23`
  // 的 `super("JarApplication", ExecutionBundle.message("jar.application.configuration.name"), …)`；
  // 文案 `platform/execution/resources/messages/ExecutionBundle.properties:55` = "JAR Application"；
  // 表单四格 `java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurable.java:47-49/73/81`）。
  // 本仓的规范名/标签/字段/入口判据/执行参数都在 `src/jarRun.ts`（`:50-63`、`:103-111`、`:291-343`）。
  // ⚠️ 加类型只动**一份**清单：`src/runConfigurationSchema.ts:30` 的 `RUN_CONFIG_TYPE_FAMILY_IDS`（家族），
  //   并给两张按家族穷尽的表补键 —— `src/runConfigTree.ts:22` 的 `RUN_CONFIG_TYPE_FAMILY_LABELS`、
  //   `src/runConfigEditors.ts:112` 的 `RUN_CONFIG_TYPE_FAMILY_EDITORS`（少键直接 TS2741）。
  //   UI 与落盘读的是**投影后的** `RUN_CONFIG_TYPE_IDS`（= 家族 − `RUN_CONFIG_TYPE_IDS_HOST_PENDING`），
  //   所以联合、宿主白名单（`native/settings_schema.cpp:1011-1012`）与该 pending 必须**同一次**动，
  //   否则就是「建得出、存不下去」那个老形状。判据 `tests/run-config-types.test.mjs`
  //   （四份清单同步 / 第五处同源 / 家族=已接+pending / gate 与宿主两处同步）。
  type?: 'shell' | 'application' | 'debug' | 'compound' | 'jar'
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
  /**
   * 「启动时打开运行/调试工具窗口」= 上游 `isActivateToolWindowBeforeRun`。
   * 判词表里那条 `Runner.FocusOnStartup` 的**用户可见半边**（另一半见 `focusToolWindowBeforeRun`）。
   *
   * 为什么这两个开关**挂在这条记录上**而不是全局设置（2026-10-06 execui 判决，逐行打开过上游）：
   *   · 声明 `platform/execution/src/com/intellij/execution/RunnerAndConfigurationSettings.java:235`
   *     （setActivate）/ `:242`（isActivate）/ `:249`（setFocus）/ `:256`（isFocus）——
   *     四个方法都在**每条配置**的接口上，不在任何 application/project 级设置类上；
   *   · 存的地方只有一处：`platform/execution-impl/src/com/intellij/execution/impl/RunnerAndConfigurationSettingsImpl.kt`
   *     的属性名 `:61-62`、字段 `:108-109`、setter `:212-222`、读档 `:243-244`、写档 `:317-321`
   *     （**只在非默认时落盘**）；
   *   · 界面上两套 UI 写的都是**同一个对象**：老面板
   *     `platform/execution-impl/src/com/intellij/execution/impl/BeforeRunStepsPanel.java:170-171`（建勾）、
   *     `:214-217`（`reset` 读）、`:238-243`（`need…` 取值），落回记录在
   *     `platform/execution-impl/src/com/intellij/execution/impl/ConfigurationSettingsEditorWrapper.java:143-144`
   *     （`settingsToApply.set…BeforeRun(...)`）；新 UI 的两个 tag
   *     `platform/execution-impl/src/com/intellij/execution/ui/BeforeRunFragment.java:28-42`
   *     的 getter/setter  lambda 也是 `settings.isActivateToolWindowBeforeRun()` /
   *     `settings.setActivateToolWindowBeforeRun(value)` ⇒ **没有第二处存放**。
   *   · 唯一的「兜底链」不是第二个源，而是**模板继承**：同文件 `:455-461`
   *     `importRunnerAndConfigurationSettings(template)` 把模板记录上的同三个字段拷进新配置
   *     （`isEditBeforeRun` / activate / focus）⇒ 本仓由 `src/runConfigTemplates.ts` 承接那一步。
   * 默认 `true`（`:108`）；缺键的补法照同文件 `:243`（缺 `activate` 属性按 **true**：`value == null || value.toBoolean()`）。
   */
  activateToolWindowBeforeRun?: boolean
  /**
   * 「启动时把焦点移到运行/调试工具窗口」= 上游 `isFocusToolWindowBeforeRun`
   * （声明 `RunnerAndConfigurationSettings.java:249`/`:256`，存
   * `RunnerAndConfigurationSettingsImpl.kt:109`/`:218-222`/`:244`/`:320-321`）。
   * 默认 **false**（`:109`；注意接口 javadoc `:254` 写的是「it's default value」说 true，
   * **实现那行才是准的** ⇒ 本仓按 `:109` 取 false）。
   * 消费链：`ExecutionManagerImpl.kt:291-292` 合成 descriptor 的两个 flag，
   * `RunContentManagerImpl.kt:439-441`（`isActivateToolWindowWhenAdded` 为假就整个 return）、
   * `:450-457`（`focus = isAutoFocusContent`，但整个 IDE 没有焦点所有者时强制补真）、`:458`。
   * 判定本体在 `src/runStartupFocus.ts`，读的就是本字段与上一条。
   */
  focusToolWindowBeforeRun?: boolean
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
export interface ProjectSettings { /** 折叠状态（IDEA 的 workspace 文件那一段；键是项目内相对路径）。 */ foldingState?: Record<string, FoldSnapshot[]>; excludedDirs: string[]; runConfigs: RunConfig[]; bookmarks: Bookmark[]; bookmarkLists?: BookmarkListSetting[]; bookmarksView?: BookmarksViewState; todoPatterns: TodoPattern[]; templates: TemplateSettings; java: JavaProjectSettings; fileAssociations: Record<string, string>; /** IDEA `FormatOnSaveOptions`，Project Service / WORKSPACE_FILE。缺省保留旧全局存档迁移信号。 */ formatOnSave?: boolean; /** VCS Log 的 UI 开关（IDEA VcsLogApplicationSettings 的 SHOW_TAG_NAMES / SHOW_ROOT_NAMES）。 */ vcsLog?: { showTagNames: boolean; showRootNames: boolean }; /** 命名作用域（IDEA project.scopes）。 */ scopes?: NamedScopeSetting[]; /** 文件颜色（IDEA `com.intellij.ui.tabs` 的 File Colors）：作用域名 + 颜色名，数组顺序即优先级。 */ fileColors?: FileColorSetting[]; localFileColors: FileColorSetting[]; /** 构建工具（IDEA `build.tools` 组：外部系统自动重载 + Gradle 项目设置），**项目级**。 */ buildTools?: BuildToolsSettings; exportToHtml?: ExportToHtmlSettings }
export interface ProjectForm { parent: string; name: string; template: 'empty' | 'cpp' | 'java' | 'spring-boot' | 'maven' | 'gradle' | 'kotlin' | 'python' | 'node' | 'vue' | 'react'; source: string }
export interface AppState {
  recentProjects: RecentProject[]; settings: EditorSettings; general?: GeneralSettingsState; lastProject: string | null; gitAvailable: boolean; defaultParent: string
  /** Transient OS date/time patterns returned by `app.state`; never persisted as a user preference. */
  systemDateTimeFormats?: SystemDateTimeFormats | null
}
// Source: platform/ide-core/src/com/intellij/ide/GeneralSettings.kt:227-266
// (GeneralSettingsState) — the application-level PersistentStateComponent stored
// in ide.general.xml that GeneralSettingsConfigurable.kt binds its panel to.
// Field names mirror the Kotlin data class; confirmOpenNewProject2 stays
// null-able exactly as in the source (null means "ask", OPEN_PROJECT_ASK).
export type ProcessCloseConfirmation = 'ASK' | 'TERMINATE' | 'DISCONNECT'
export interface GeneralSettingsState {
  defaultProjectDirectory: string
  embeddedBrowserAllowInsecureCertificates: boolean
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
  // DateTimeFormatManager's application-level state, stored with TaoCode's global settings.
  overrideSystemDateFormat: boolean
  dateFormatPattern: string
  use24HourTime: boolean
  prettyFormattingAllowed: boolean
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
  // StackTraceFoldingSettings：栈帧折叠开关与阈值（上游默认 true / 8）。
  foldJavaStackTrace: boolean; foldJavaStackTraceGreaterThan: number
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
  embeddedBrowserAllowInsecureCertificates: false,
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
  ...DEFAULT_DATE_TIME_FORMAT_SETTINGS,
  // 音频提示（无障碍）：mode 三档（audio.cues.mode.auto/on/off，AudioCuesSettings.kt:75-79），
  // 本仓默认 off（上游默认 AUTO —— 差异见 GeneralSettingsState.audioCuesMode 的注释）；
  // 逐 cue 停用表默认空 = 六个 cue 全开（同上游 disabledCues 的空 Set 默认）。
  audioCuesMode: 'off',
  audioCuesDisabled: [],
  autoShowProcessPopup: false,
  fuzzyFileSearch: false,
  foldConsoleLines: [],
  foldExceptions: [],
  foldJavaStackTrace: true,
  foldJavaStackTraceGreaterThan: 8,
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
export const defaultEditorSettings: EditorSettings = { collapseImports: true, collapseCustomRegions: false, fontSize: 14, tabSize: 4, wordWrap: false, lineNumbers: true, showIndentGuides: true, bracketMatching: true, tabLimit: 30, tabsInOneRow: true, hideTabsIfNeeded: true, sortBookmarks: false, useTabCharacter: false, showWhitespaces: false, formatOnSave: false, uiZoomPercent: 100, compactMode: false, fullPathsInWindowHeader: false, showTreeIndentGuides: false, compactTreeIndents: false, smoothScrolling: true, showIconsInMenus: true, rememberSizeForEachToolWindow: false, showToolWindowNames: false, showToolWindowBars: true, leftSideBySide: false, wideScreenSupport: false, rightSideBySide: false, showToolWindowNumbers: false, keepPopupsForToggles: false, dndWithPressedAltOnly: false, powerSaveMode: false, useContrastScrollbars: false, colorBlindness: 'none', uiFontFamily: '', uiFontSize: 13, backgroundImagePath: '', backgroundImageOpacity: 100, backgroundImageFill: 'scale', backgroundImageKeepRatio: true, presentationMode: false, presentationModeFontSize: 24, mainMenuDisplayMode: 'hamburger', differentiateProjects: false, expandNodesWithSingleClick: false, maximizeEditorOnTabDoubleClick: true, pinnedTabsInSeparateRow: false, showBreadcrumbs: true, showStatusBar: true, rightMargin: true, breadcrumbsPlacement: 'bottom', breadcrumbsLanguages: {}, showMembersInNavigationBar: true, showDiagnostics: true, showErrorStripe: true, reformatOnPaste: 'indentEachLine', bidiTextDirection: 'contentBased', showGutterIcons: true , showStickyLines: true, stickyLinesLimit: 5, diffContextLines: 3, fileColorsEnabled: true, fileColorsForTabs: true, fileColorsForProjectView: true, lineNumeration: 'absolute', showTypeInlayHints: true, showParameterInlayHints: true, showOtherInlayHints: true, stripTrailingSpaces: 'Changed', ensureNewLineAtEof: false, keepTrailingSpacesOnCaretLine: true, autoInsertPairQuote: true, closeCommentOnEnter: true, insertBraceOnEnter: true, codeVisionEnabled: true, codeVisionDisabledGroups: [], codeVisionEnabledGroups: [], codeVisionVisibleEntries: 5, showQuickDocOnMouseHover: true, autoUpdateDocumentation: true, wheelFontChangeEnabled: false, terminalBaseFontSize: 13 }
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
  showTypeInlayHints: boolean; showParameterInlayHints: boolean; showOtherInlayHints: boolean;
  // ---------------------------------------------------------------- 保存时的两条 pass（IDEA Settings ▸ Editor ▸ General）
  // 控件在 EditorOptionsPanel.kt（`platform/lang-impl/src/com/intellij/application/options/editor/EditorOptionsPanel.kt`）：
  //   `cdStripTrailingSpacesEnabled` :156-157（文案键 `combobox.strip.trailing.spaces.on.save`）、
  //   `cdEnsureBlankLineBeforeCheckBox` :147-149（`editor.options.line.feed`）、
  //   `cdKeepTrailingSpacesOnCaretLine` :153-155（`editor.settings.keep.trailing.spaces.on.caret.line`）。
  // 字段与默认值在 `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java`：
  //   :73 `STRIP_TRAILING_SPACES = STRIP_TRAILING_SPACES_CHANGED`、:74 `IS_ENSURE_NEWLINE_AT_EOF = false`、
  //   :142 `KEEP_TRAILING_SPACE_ON_CARET_LINE = true`；三档字面值 :216-218（`None` / `Changed` / `Whole`）。
  // 执行体：`src/editorSaveTransforms.ts` 的 `saveTrimOptionsFromSettings`（读这三条）+ `applySaveTextTransforms`。
  /** `EditorSettingsExternalizable.java:73` + `:216-218`：默认 `Changed` = 只清本次改动过的行。 */
  stripTrailingSpaces: 'None' | 'Changed' | 'Whole';
  /** `EditorSettingsExternalizable.java:74`（`IS_ENSURE_NEWLINE_AT_EOF`，默认 **false**）。 */
  ensureNewLineAtEof: boolean;
  /** `EditorSettingsExternalizable.java:142`（`KEEP_TRAILING_SPACE_ON_CARET_LINE`，默认 **true**）。 */
  keepTrailingSpacesOnCaretLine: boolean;
  // 注：**不落** `REMOVE_TRAILING_BLANK_LINES`（同文件 :75，默认 false）—— 本仓的执行体还没有那一条，
  // 落了就是一格没有消费链路的假控件（接线请求 docs/wiring-requests-2026-10-06-saveops.md ② 同此判断）。
  // ---------------------------------------------------------------- 回车与引号的三个开关（IDEA CodeInsightSettings）
  // 同一个设置类（`platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java`）里
  // `reformatOnPaste` 已经在上面那一段落了，这三条与它同族：
  //   :140 `AUTOINSERT_PAIR_QUOTE = true`（引号成对插入；`QuoteHandler.java:10-20` 的类注释就写明了
  //        这个开关，执行体 `src/editorTyping.ts:120` 的 `smartQuotes`，挂载点 `src/components/CodeEditor.vue:968`）；
  //   :132 `CLOSE_COMMENT_ON_ENTER = true`（块注释没闭合时回车补闭尾，执行体
  //        `src/editorEnterBlockComment.ts:176-178` 的第 4 个参数，现按默认 true 走）；
  //   :130 `INSERT_BRACE_ON_ENTER = true`（回车补未配对的收尾大括号，执行体
  //        `src/enterHandlers.ts:180` 的 `enterAfterUnmatchedBrace`，调用点 `:281`）。
  /** `CodeInsightSettings.java:140`：键入引号时自动补上收尾的那一个。 */
  autoInsertPairQuote: boolean;
  /** `CodeInsightSettings.java:132`：块注释未闭合时回车补上收尾的那个标记（`editorEnterBlockComment` 的第 4 个参数）。 */
  closeCommentOnEnter: boolean;
  /** `CodeInsightSettings.java:130`：回车补未配对的大括号收尾。 */
  insertBraceOnEnter: boolean;
  // ---------------------------------------------------------------- Code Vision（IDEA Settings ▸ Editor ▸ Code Vision）
  // 上游 `platform/lang-api/src/com/intellij/codeInsight/codeVision/settings/CodeVisionSettings.kt` 的 `State`：
  //   :36 `isEnabled = true`（总闸 `codeVisionEnabled`，:55-60）、
  //   :38-39 `visibleMetricsAboveDeclarationCount / visibleMetricsNextToDeclarationCount = 5`（每行可见条数）、
  //   :45 `disabledCodeVisionProviderIds`、:50 `enabledCodeVisionProviderIds` —— **两个集合都只装"与出厂相反"的那一半**。
  // 设置页文案：`platform/lang-impl/resources/messages/CodeVisionBundle.properties:2`（页名 `Code Vision`）、
  //   `:3`（`Enable Code Vision`）、`:5`（`Visible metrics {0}:`）；分组名 `settings.hints.new.group.code.vision`
  //   见 `platform/ide-core/resources/messages/ApplicationBundle.properties:725-726`。
  // 本仓的 provider 只有两组（`src/codeLensSettings.ts:48-50`）：`LspCodeVisionProvider` 与 `problems`；
  // 运行时真值表在 `src/codeLensSettings.ts` 的 `codeVisionSettings`，进出口是
  // `restoreCodeVisionSettings(patch)`（:171）与 `codeVisionSettingsPatch()`（:179），设置页在
  // `src/components/CodeVisionSettingsPage.vue` 把两侧接起来。
  /** `CodeVisionSettings.kt:36/55-60`：Code Vision 总闸，默认开。 */
  codeVisionEnabled: boolean;
  /** `CodeVisionSettings.kt:45`：被关掉的那一组 provider（组 id 数组，出厂为空）。 */
  codeVisionDisabledGroups: string[];
  /** `CodeVisionSettings.kt:50`：被单独打开的那一组（出厂关着的 provider 才进这里；本仓两组出厂都开 ⇒ 默认为空）。 */
  codeVisionEnabledGroups: string[];
  /** `CodeVisionSettings.kt:38-39`：一个锚点行最多画几条（出厂 5，与 `src/codeLens.ts:127` 同一个数）。 */
  codeVisionVisibleEntries: number;
  // ---------------------------------------------------------------- 快速文档的两档（IDEA「在鼠标移动时显示」/「选区更改时自动刷新文档」）
  // 键名与默认档由 `src/docHoverPolicy.ts:47/54-57` 的 `DOC_HOVER_SETTING_KEYS` 定死（登记请求
  // `docs/wiring-requests-2026-10-06-bucket3a.md` 的 R4），本批逐字取用，不另起名字。
  // 上游：`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76`
  // （`SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT = true`；设置行是同目录 `EditorOptionsPanel.kt:150-152` 的
  // `cdShowQuickDocOnMouseMove`）与 `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationToolWindowManager.kt:55`
  // （注册表属性 `documentation.auto.update`，默认 true）。
  // 运行时真值与执行体在 `src/docHoverPolicy.ts`（`docHoverPolicy` 被 `src/quickDocHost.ts:327` 与
  // `src/docHoverContent.ts:24` 读），进出口是 `docHoverPolicyFromSettings()` / `docHoverPolicyPatch()`。
  /** `EditorSettingsExternalizable.java:76`，默认 **true**：鼠标停在符号上就弹文档。 */
  showQuickDocOnMouseHover: boolean;
  /** 注册表属性 `documentation.auto.update`（`DocumentationToolWindowManager.kt:55`），默认 **true**。 */
  autoUpdateDocumentation: boolean;
  // ---------------------------------------------------------------- 终端字号的两把（本批新增，接线请求 R-1）
  // 上游真源本轮逐行打开过：`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:124`
  // = `    public boolean IS_WHEEL_FONTCHANGE_ENABLED = false;`（getter 同文件 :1043、setter :1047-1051）。
  // 那一格在「编辑器 › 常规」的 Mouse control 组：控件 `EditorOptionsPanel.kt:91-94`（`enableWheelFontChange`）、
  // 挂点同文件 :216（`chkEnableWheelFontSizeChange = checkBox(enableWheelFontChange)`），组名 :214 用
  // `group.advanced.mouse.usages`（`ApplicationBundle.properties:395` = Mouse Control），
  // 文案 `ApplicationBundle.properties:396` = `Change font size with Ctrl+Mouse Wheel in:`（macOS 变体 :397）。
  /**
   * 上游字段 `IS_WHEEL_FONTCHANGE_ENABLED`（`EditorSettingsExternalizable.java:124`），默认 **false**。
   * 上游消费门 `platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:382`
   * = `if (EditorSettingsExternalizable.getInstance().isWheelFontChangeEnabled() && EditorUtil.isChangeFontSize(e))`
   * （:383 新字号 = 当前 - wheelRotation、:384 界内才写、:387 `return` ⇒ 缩放时不再滚缓冲区）。
   * 本仓唯一消费点：`src/components/TerminalPanel.vue:115` 的 `wheelFontZoomEnabled` →
   * `src/terminalFontSize.ts:79` 的 `terminalWheelZoomApplies(event, wheelEnabled)`；
   * 关着时那次滚动照常滚终端缓冲区（就是上游那个 && 的前半个条件）。设置行在
   * 「编辑器 › 常规」（`src/components/SettingsDialog.vue` 的 `data-page="editor"` 那页）。
   * 还有一把 `IS_WHEEL_FONTCHANGE_PERSISTENT`（同文件 `:125`，同样默认 false）管「缩放要不要写回设置」，
   * 本仓的缩放是会话内临时的（`TerminalFontSizeProvider.kt:16-18` 的 "Sets temporary font size without
   * changing the size in the settings"）⇒ **不落**那把。
   */
  wheelFontChangeEnabled: boolean;
  /**
   * 终端基准字号，整数 4..40（界 = `platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-13`
   * 的 `getMinEditorFontSize()` = `scale(4)` 与 `:15-17` 的 `getMaxEditorFontSize()` = `ide.editor.max.font.size` 默认 40；
   * 与 `JBTerminalPanel.java:384` 用的是同一对边界）。
   * 上游**没有**这一格的原样：那一档住在配色方案的 consoleFontSize 里
   * （`platform/execution-impl/src/com/intellij/terminal/TerminalUiSettingsManager.kt:123-132` 的
   * `detectFontSize()` / `resetFontSize()` 现算 ⇒ 临时缩放不写设置）。本仓没有可编辑配色方案 ⇒
   * 落成一格显式设置，缺省 13 = 本仓内置 `TERMINAL_BASE_FONT_SIZE`（`src/terminalFontSize.ts:47`）。
   * **这是本仓架构映射，不是上游那一格的原样。**
   * 消费点 `src/components/TerminalPanel.vue:121` 的 `baseFontSize`（越界的值它也不采纳）。
   */
  terminalBaseFontSize: number
}
