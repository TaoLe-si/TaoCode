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
    "fontSize", "tabSize", "wordWrap", "lineNumbers", "showIndentGuides", "bracketMatching",
    "tabLimit", "tabsInOneRow", "useTabCharacter", "showWhitespaces", "formatOnSave", "uiZoomPercent",
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
    "showBreadcrumbs", "breadcrumbsPlacement", "breadcrumbsLanguages",
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
};

inline constexpr std::string_view GENERAL_SETTING_KEYS[] = {
    "defaultProjectDirectory", "reopenLastProject", "deleteToBin", "autoSyncFiles",
    "backgroundSyncFiles", "autoSaveFiles", "autoSaveIfInactive", "isUseSafeWrite", "confirmExit",
    "isShowWelcomeScreen", "confirmOpenNewProject2", "processCloseConfirmation", "inactiveTimeout",
    "supportScreenReaders", "autoShowProcessPopup",
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
    // 外部工具 —— 应用级的命令收藏（名称 + 命令），可从菜单直接运行。
    "externalTools"
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
