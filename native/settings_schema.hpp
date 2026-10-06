// 设置模式层（SettingsSchema）：编辑器/系统设置的键表、补丁校验、未知键剪枝与默认值。
// 对应 IDEA 各 Configurable 的校验与默认值层。从 projects.cpp 拆出（桃 2026-09-26：模块化）。
#pragma once

#include "workspace.hpp"
#include <windows.h>
#include <limits>

namespace taocode {

// 键表白名单（唯一一份：UI 补丁的严格校验与读盘剪枝共用）。inline constexpr：
// extern constexpr 数组跨 TU 是不完整类型，无法构造 std::span（踩过：C2664/C2665）。
inline constexpr std::string_view EDITOR_SETTING_KEYS[] = {
    "fontSize", "tabSize", "wordWrap", "lineNumbers", "showIndentGuides", "bracketMatching", "lineNumeration",
    "tabLimit", "tabsInOneRow", "hideTabsIfNeeded", "sortBookmarks", "useTabCharacter", "showWhitespaces", "formatOnSave", "uiZoomPercent",
    // 代码折叠（CodeFoldingSettings.java:7-11，@Storage("editor.xml")）：只登记本仓有消费者的两个
    // （COLLAPSE_IMPORTS / COLLAPSE_CUSTOM_FOLDING_REGIONS）。默认值在 settings_schema.cpp 里。
    "collapseImports", "collapseCustomRegions",
    "compactMode", "fullPathsInWindowHeader", "showTreeIndentGuides", "compactTreeIndents",
    "smoothScrolling", "showIconsInMenus", "rememberSizeForEachToolWindow", "showToolWindowNames",
    "showToolWindowBars", "leftSideBySide", "wideScreenSupport", "rightSideBySide",
    "showToolWindowNumbers", "keepPopupsForToggles", "dndWithPressedAltOnly", "powerSaveMode",
    "useContrastScrollbars", "colorBlindness", "uiFontFamily", "uiFontSize", "backgroundImagePath",
    "backgroundImageOpacity", "backgroundImageFill", "backgroundImageKeepRatio",
    "presentationMode", "presentationModeFontSize", "mainMenuDisplayMode",
    // AppearanceConfigurable cdDifferentiateProjects / cdExpandNodesWithSingleClick
    // (UISettingsState.differentiateProjects / :141 expandNodesWithSingleClick).
    "differentiateProjects", "expandNodesWithSingleClick",
    // editor.maximize.on.double.click（intellij.platform.ide.impl.xml:1511）。
    "maximizeEditorOnTabDoubleClick",
    "pinnedTabsInSeparateRow",
    // BreadcrumbsConfigurable (`editor.breadcrumbs`, platform-impl/.../breadcrumbs/
    // BreadcrumbsConfigurable.java:24 + BreadcrumbsConfigurableUI.kt:44-70) 三项：
    // 显示开关（isBreadcrumbsShown）、位置（isBreadcrumbsAbove，只有上/下）、
    // 按语言开关（mapLanguageBreadcrumbs，只存被显式配置过的语言）。
    "showBreadcrumbs", "breadcrumbsPlacement", "breadcrumbsLanguages", "showMembersInNavigationBar",
    // Editor | Error highlighting（`Errors` configurable + ErrorOptionsProvider 扩展点）：
    // TaoCode 的等价物是 LSP 诊断的显示开关。
    "showDiagnostics", "showErrorStripe",
    // CodeInsightSettings.REFORMAT_ON_PASTE（analysis-impl/.../codeInsight/CodeInsightSettings.java:143-148，
    // @Storage("editor.xml") 所以归编辑器设置；默认 INDENT_EACH_LINE）。设置行见
    // EditorSmartKeysConfigurable.kt:185-197（编辑器 › 常规 › 智能键）。
    "reformatOnPaste",
    // EditorSettingsExternalizable.BIDI_TEXT_DIRECTION（ide-core-impl/.../editor/ex/EditorSettingsExternalizable.java:137，
    // 默认 CONTENT_BASED；枚举见同目录 BidiTextDirection.java:21-23）。无设置页行，只有
    // ViewMenu 末尾的「文本方向」子菜单（platform-impl/resources/idea/PlatformActions.xml:591-595）。
    "bidiTextDirection",
    // EditorSettingsExternalizable.java:87 `ARE_GUTTER_ICONS_SHOWN = true`（默认开）。
    // 关掉后 gutter 不再画行内标记图标（标记本身仍在）。
    "showGutterIcons",
    // FileColorManagerImpl.java:75-106: all switches default true.
    // Both local and shared color lists are project-owned (FileColorModelStorageManager.kt:27-38).
    "fileColorsEnabled", "fileColorsForTabs", "fileColorsForProjectView",
    // 下面五个键前端早就认（src/bridge.ts:1123 的 settings.update 编辑器档 + src/settingsModel.ts:149
    // 的 defaultEditorSettings），但本白名单漏了它们。漏一个键不是"少存一项"那么轻：
    // `validate_editor_patch` 第一行就是 `known_keys(patch, EDITOR_SETTING_KEYS)`，而前端每次保存发的是
    // **整个** editorSettings 对象（src/App.vue:676 `{ ...editorSettings.value, ...patch }`），
    // 于是整次 settings.update 会被拒；更狠的是 `prune_unknown`（native/project_settings_state.cpp:41）
    // 把它们从 projects.json 里剪掉，前端拿回的对象里 `showStatusBar` 直接是 undefined ——
    // 状态栏（src/App.vue:2316 的 v-if）整条不渲染。判据见 tests/settings-keys-parity.test.mjs。
    //
    // showStatusBar：UISettingsState.kt:113 `var showStatusBar: Boolean by property(true)`；
    //   唯一的消费点是 ProjectFrameHelper.kt:329 `statusBar.isVisible = uiSettings.showStatusBar &&
    //   !uiSettings.presentationMode`（注意上游还串了 presentationMode，本仓的 v-if 只判前半个条件）。
    "showStatusBar",
    // rightMargin：EditorSettingsExternalizable.java:83 `public boolean IS_RIGHT_MARGIN_SHOWN = true;`，
    //   属性名见同文件 :1221 `PROP_IS_RIGHT_MARGIN_SHOWN = "isRightMarginShown"`。设置行是
    //   EditorAppearanceConfigurable.kt:48 myCbRightMargin（编辑器 › 外观 › 右边距）。
    "rightMargin",
    // showStickyLines / stickyLinesLimit：EditorSettingsExternalizable.java:93 `SHOW_STICKY_LINES = true`、
    //   :94 `STICKY_LINES_LIMIT = 5`；属性名 :1231 "showStickyLines" / :1233 "stickyLinesLimit"，
    //   读出口 :508 areStickyLinesShown() 与 :546 getStickyLineLimit()。设置行见
    //   StickyLinesConfigurable.kt:7-20。
    "showStickyLines", "stickyLinesLimit",
    // diffContextLines：`diff.base`（DiffSettingsConfigurable.kt:30-58）的 settings.context.lines。
    //   它在 general 键表里也有一份（settings_schema.cpp:154），但**唯一写它的是编辑器设置页**
    //   （SettingsDialog.vue:1133 `v-model.number="settings.diffContextLines"` 绑的是编辑器那本账），
    //   唯一的读口也是编辑器那本账（toolViewContext.ts:123 `editorSettings.value.diffContextLines`
    //   → SourceControl.vue:553-554 拼 `git diff -U<n>`）。所以权威副本在编辑器档，
    //   general 那份留着是为了不破坏已存盘的旧 state，不是因为它在用。
    "diffContextLines",
    // InlaySettingsConfigurable（`inlay.hints`，intellij.platform.lang.impl.xml:935-941
    // `parentId="editor" id="inlay.hints"`）：上游按 provider 逐个勾（InlayProviderSettingsModel.isEnabled，
    // platform/lang-api/.../settings/InlayProviderSettingsModel.kt:26），本仓唯一的 provider 是 LSP 的
    // textDocument/inlayHint，按它的 kind 分三档（1 = Type，2 = Parameter，其余归第三档）。
    // 键名与分组的唯一定义处是 src/inlayHints.ts 的 INLAY_HINT_SETTING_KEYS。
    "showTypeInlayHints", "showParameterInlayHints", "showOtherInlayHints",
    // 保存时的两条 pass（IDEA Settings ▸ Editor ▸ General，控件在 EditorOptionsPanel.kt:147-157；
    // 字段与默认值 EditorSettingsExternalizable.java:73-74,142，三档字面值 :216-218）。
    // 消费方 src/editorSaveTransforms.ts 的 saveTrimOptionsFromSettings。
    "stripTrailingSpaces", "ensureNewLineAtEof", "keepTrailingSpacesOnCaretLine",
    // 回车与引号的三个开关（CodeInsightSettings.java:130/132/140，默认全 true）；与上面
    // reformatOnPaste 同一个设置类。消费方 src/enterHandlers.ts 与 src/editorTyping.ts 的 smartQuotes。
    "autoInsertPairQuote", "closeCommentOnEnter", "insertBraceOnEnter",
    // Code Vision（CodeVisionSettings.kt 的 State：:36 isEnabled、:38-39 可见条数 5、
    // :45/:50 两个「只装与出厂相反那一半」的集合）。组 id 只有两个，见 src/codeLensSettings.ts:48-50。
    "codeVisionEnabled", "codeVisionDisabledGroups", "codeVisionEnabledGroups", "codeVisionVisibleEntries",
    // 快速文档两档（EditorSettingsExternalizable.java:76 默认 true；DocumentationToolWindowManager.kt:55
    // 的 `documentation.auto.update` 默认 true）。键名由 src/docHoverPolicy.ts 的 DOC_HOVER_SETTING_KEYS 定死。
    "showQuickDocOnMouseHover", "autoUpdateDocumentation",
};

inline constexpr std::string_view GENERAL_SETTING_KEYS[] = {
    "defaultProjectDirectory", "reopenLastProject", "deleteToBin", "autoSyncFiles",
    "backgroundSyncFiles", "autoSaveFiles", "autoSaveIfInactive", "isUseSafeWrite", "confirmExit",
    "isShowWelcomeScreen", "confirmOpenNewProject2", "processCloseConfirmation", "inactiveTimeout",
    "supportScreenReaders", "autoShowProcessPopup",
    // 音频提示（无障碍）：IDEA `AudioCuesSettings.kt:17` 的 @State(name="AudioCues")，默认 off。
    // `audioCuesMode` 三档（AudioCuesSettings.kt:75-79 的 AUTO/ON/OFF）；`audioCuesDisabled`
    // 是 `AudioCuesSettingsState.disabledCues`（:69-72）的数组形态（存的是六个 cue 的 id）。
    "audioCuesMode", "audioCuesDisabled",
    // ConsoleConfigurable (`Console`, lang-impl/.../execution/console/ConsoleConfigurable.java:43-73)：
    // 控制台行折叠规则 —— 要折叠的行 + 不折叠的例外两个列表。
    "foldConsoleLines", "foldExceptions",
    // DiffSettingsConfigurable（`diff.base`，diff-impl/.../DiffSettingsConfigurable.kt:31 `settings.context.lines`）：
    // diff 的上下文行数。
    "diffContextLines",
    // StickyLinesConfigurable（`editor.stickyLines`，platform-impl/.../stickyLines/configurable/）：
    // 粘性作用域行（显示当前所在方法/类的首行）+ 最多显示几层。
    "showStickyLines", "stickyLinesLimit",
    // ToolConfigurable（`preferences.externalTools`，lang-impl/.../tools/ToolConfigurable.java）：
    // 外部工具 —— 应用级的命令收藏。条目形状 = 上游 `Tool` 的 bean（Tool.java:56-78）：
    // name/command 必填，description/group/enabled/useConsole/showConsoleOnStdOut/showConsoleOnStdErr/
    // synchronizeAfterExecution/workingDirectory/outputFilters 可选（2026-10-06 放开，校验在
    // settings_schema.cpp 的 externalTools 那一支）；program/parameters 合成 command 一条存。
    "externalTools",
    // SeFuzzyFileSearchProviderFactory.kt:28-31：注册表键 `search.everywhere.fuzzy.files.enabled`
    // 默认 false。同 autoShowProcessPopup 的处理 —— 上游只有注册表键、没有设置页入口，
    // TaoCode 没有注册表对话框，所以把它升格为持久化开关。
    "fuzzyFileSearch",
    // XDebuggerDataViewSettings（xdebugger-impl/.../settings/XDebuggerDataViewSettings.java）：
    // 调试器 Variables 视图的两格 —— 隐藏 null 值、命名变量按名排序；
    // 另有 showValuesInline（编辑器行内值）与 showLibraryStackFrames（堆栈里的库帧）。
    // XDebuggerGeneralSettings.java：confirmBreakpointRemoval / unmuteOnStop / evaluationDialogMode
    // （EXPRESSION | CODE_FRAGMENT，字符串两档）。
    "debuggerHideNullValues", "debuggerSortByName", "debuggerShowValuesInline",
    "debuggerShowLibraryFrames", "debuggerConfirmBreakpointRemoval", "debuggerUnmuteOnStop",
    "debuggerEvaluationMode",
    // 受信任项目清单（IDEA `TrustedPaths`，platform-impl/.../ide/impl/TrustedPaths.kt:34-40 的
    // `@State(name = "Trusted.Paths")` + `Map<String, Boolean>`）：显式信任/显式不信任的路径。
    // 判据与执行门在 native/trusted_paths.cpp，前端纯逻辑在 src/trustedProjects.ts。
    "trustedPaths"
};



void known_keys(const Json& value, std::span<const std::string_view> keys, const char* code);
void known_keys(const Json& value, std::initializer_list<std::string_view> keys, const char* code);

// 读盘剪枝：旧版本写过、新版本已删的键**不能让文件变成损坏**（IDEA 的 XmlSerializer 忽略未知标签）。
std::vector<std::string> prune_unknown(Json& object, std::span<const std::string_view> keys);

void validate_editor_patch(const Json& patch);
void validate_general_patch(const Json& patch);
void validate_todo_patterns(const Json& values);
void validate_template_settings(const Json& value);
void validate_bookmarks(const Json& values);
void validate_java_settings(const Json& value);
void validate_file_associations(const Json& value);
// 命名作用域（IDEA `project.scopes`）：形状校验，不校验模式语法（源码允许存下解析不了的模式）。
void validate_scopes(const Json& value);
void validate_file_colors(const Json& value);
// 构建工具（IDEA `build.tools` 组：外部系统的自动重载 + Gradle 项目设置）。
// **项目级**：`ExternalSystemGroupConfigurable` 是 `BackedByPersistentState` 的 projectConfigurable，
// `GradleSettings` 的存储是 `.idea/gradle.xml`（GradleSettings.java:30-31），
// 「离线模式」也在它里面（:118-131），「用哪个 Gradle」在 `GradleProjectSettings`（同文件，per linked project）。
void validate_build_tools(const Json& value);
// 导出到 HTML 的设置（IDEA `ExportToHTMLSettings`，`@Storage(StoragePathMacros.WORKSPACE_FILE)` ⇒ **项目级**）。
// 字段与默认值取自 `ExportToHTMLSettings.java:17-19`（PRINT_LINE_NUMBERS / OPEN_IN_BROWSER / OUTPUT_DIRECTORY）
// 与 `:21-23`（printScope / isIncludeSubdirectories）；范围值取 `PrintSettings.java:82-84`
// （PRINT_FILE=1 / PRINT_SELECTED_TEXT=2 / PRINT_DIRECTORY=4）。
void validate_export_to_html(const Json& value);
void validate_project_patch(const Json& patch);

// `valid_utf8` 是文件原语（fsops.hpp），路径转换与这里共用同一份定义。

std::string text_or(const Json& object, const char* key);

Json editor_defaults_impl();
Json general_defaults_impl();
Json default_todo_markers();
Json project_defaults();
Json empty_document();
void fill_defaults(Json& base, const Json& stored);

} // namespace taocode
