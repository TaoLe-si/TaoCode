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
    "tabLimit", "useTabCharacter", "showWhitespaces", "formatOnSave", "uiZoomPercent",
    "compactMode", "fullPathsInWindowHeader", "showTreeIndentGuides", "compactTreeIndents",
    "smoothScrolling", "showIconsInMenus", "rememberSizeForEachToolWindow", "showToolWindowNames",
    "showToolWindowBars", "leftSideBySide", "wideScreenSupport", "rightSideBySide",
    "showToolWindowNumbers", "keepPopupsForToggles", "dndWithPressedAltOnly", "powerSaveMode",
    "useContrastScrollbars", "colorBlindness", "uiFontFamily", "uiFontSize", "backgroundImagePath",
    "backgroundImageOpacity", "backgroundImageFill", "backgroundImageKeepRatio",
    "presentationMode", "presentationModeFontSize", "mainMenuDisplayMode",
    // AppearanceConfigurable cdDifferentiateProjects / cdExpandNodesWithSingleClick
    // (UISettingsState.differentiateProjects / :141 expandNodesWithSingleClick).
    "differentiateProjects", "expandNodesWithSingleClick"
};

inline constexpr std::string_view GENERAL_SETTING_KEYS[] = {
    "defaultProjectDirectory", "reopenLastProject", "deleteToBin", "autoSyncFiles",
    "backgroundSyncFiles", "autoSaveFiles", "autoSaveIfInactive", "isUseSafeWrite", "confirmExit",
    "isShowWelcomeScreen", "confirmOpenNewProject2", "processCloseConfirmation", "inactiveTimeout",
    "supportScreenReaders", "autoShowProcessPopup"
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
void validate_project_patch(const Json& patch);
inline bool valid_utf8(const std::string& text) {
    return text.find('\0') == std::string::npos &&
           text.size() <= static_cast<std::size_t>((std::numeric_limits<int>::max)()) &&
           (text.empty() || MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(),
                                                static_cast<int>(text.size()), nullptr, 0) != 0);
}

std::string text_or(const Json& object, const char* key);

Json editor_defaults_impl();
Json general_defaults_impl();
Json default_todo_markers();
Json project_defaults();
Json empty_document();
void fill_defaults(Json& base, const Json& stored);

} // namespace taocode
