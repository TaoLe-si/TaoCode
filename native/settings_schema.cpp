// 设置模式层：键表、校验、未知键剪枝、默认值 —— 对应 IDEA 各 Configurable 的
// 校验与默认值（SettingsSchema）。从 projects.cpp 拆出（桃 2026-09-26：模块化）。
#include "settings_schema.hpp"
#include "fsops.hpp"

#include <algorithm>
#include <regex>
#include <set>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>

namespace taocode {
namespace {

constexpr std::size_t max_todo_patterns = 20;
constexpr std::size_t max_run_configs = 40;

}} // namespace

namespace taocode {

void validate_editor_patch(const Json& patch) {
    // useTabCharacter / showWhitespaces / formatOnSave were added to the editor
    // defaults; a validator that does not know them makes the settings dialog fail
    // on save, so they belong here too.
    // An unknown key here would make every
    // settings.update fail, so it belongs in the allow-list, not just in the defaults.
    known_keys(patch, EDITOR_SETTING_KEYS, "INVALID_SETTINGS");
    for (auto it = patch.begin(); it != patch.end(); ++it) {
        const auto& value = it.value();
        if (it.key() == "fontSize") {
            if (!value.is_number_integer() || value < 10 || value > 32)
                fail("INVALID_SETTINGS", "fontSize must be an integer from 10 through 32.");
        } else if (it.key() == "tabSize") {
            if (!value.is_number_integer() || (value != 2 && value != 4 && value != 8))
                fail("INVALID_SETTINGS", "tabSize must be 2, 4 or 8.");
        } else if (it.key() == "tabLimit") {
            // IDEA's TabLimitValidator: at least one open tab, sane upper bound.
            if (!value.is_number_integer() || value < 1 || value > 100)
                fail("INVALID_SETTINGS", "tabLimit must be an integer from 1 through 100.");
        } else if (it.key() == "uiFontSize") {
            if (!value.is_number_integer() || value < 9 || value > 24)
                fail("INVALID_SETTINGS", "uiFontSize must be an integer from 9 through 24.");
        } else if (it.key() == "uiFontFamily") {
            if (!value.is_string() || value.get_ref<const std::string&>().size() > 120)
                fail("INVALID_SETTINGS", "uiFontFamily must be a string of at most 120 bytes.");
        } else if (it.key() == "backgroundImageOpacity") {
            if (!value.is_number_integer() || value < 0 || value > 100)
                fail("INVALID_SETTINGS", "backgroundImageOpacity must be an integer from 0 through 100.");
        } else if (it.key() == "presentationModeFontSize") {
            if (!value.is_number_integer() || value < 12 || value > 72)
                fail("INVALID_SETTINGS", "presentationModeFontSize must be an integer from 12 through 72.");
        } else if (it.key() == "backgroundImagePath") {
            if (!value.is_string() || value.get_ref<const std::string&>().size() > 512)
                fail("INVALID_SETTINGS", "backgroundImagePath must be a string of at most 512 bytes.");
        } else if (it.key() == "mainMenuDisplayMode") {
            const auto mode = value.is_string() ? value.get<std::string>() : std::string();
            if (mode != "hamburger" && mode != "merged" && mode != "separate")
                fail("INVALID_SETTINGS", "mainMenuDisplayMode must be hamburger, merged or separate.");
        } else if (it.key() == "backgroundImageFill") {
            const auto fill = value.is_string() ? value.get<std::string>() : std::string();
            if (fill != "scale" && fill != "tile" && fill != "center")
                fail("INVALID_SETTINGS", "backgroundImageFill must be scale, tile or center.");
        } else if (it.key() == "colorBlindness") {
            const auto mode = value.is_string() ? value.get<std::string>() : std::string();
            if (mode != "none" && mode != "deuteranopia" && mode != "protanopia" && mode != "tritanopia")
                fail("INVALID_SETTINGS", "colorBlindness must be none, deuteranopia, protanopia or tritanopia.");
        } else if (it.key() == "uiZoomPercent") {
            // IdeScaleTransformer: the same bounds IDEA's editable combo enforces.
            if (!value.is_number_integer() || value < 50 || value > 400)
                fail("INVALID_SETTINGS", "uiZoomPercent must be an integer from 50 through 400.");
        } else if (!value.is_boolean()) {
            fail("INVALID_SETTINGS", "Editor flags must be JSON booleans.");
        }
    }
}

Json general_defaults_impl() {
    return Json{{"defaultProjectDirectory", Json("")},
                {"reopenLastProject", true}, {"deleteToBin", true},
                {"autoSyncFiles", true}, {"backgroundSyncFiles", true},
                {"autoSaveFiles", true}, {"autoSaveIfInactive", false},
                {"isUseSafeWrite", true}, {"confirmExit", true},
                {"isShowWelcomeScreen", true},
                {"confirmOpenNewProject2", Json(nullptr)},  // GeneralSettings.defaultConfirmNewProject() == OPEN_PROJECT_ASK
                {"processCloseConfirmation", "ASK"},
                {"inactiveTimeout", 15},
                {"supportScreenReaders", false},  // GeneralSettingsState.supportScreenReaders (kt:265)
                // IDEA 用注册表键 ide.windowSystem.autoShowProcessPopup（registry.properties:209-210，
                // 默认 false），在 InfoAndProgressPanel.kt:319-321 读一次：有进程开始跑时是否自动
                // 弹出进度面板。全量移植时把它升格为持久化设置（TaoCode 没有注册表对话框）。
                {"autoShowProcessPopup", false}};
}

void validate_general_patch(const Json& patch) {
    known_keys(patch, GENERAL_SETTING_KEYS, "INVALID_SETTINGS");
    for (auto it = patch.begin(); it != patch.end(); ++it) {
        const auto& value = it.value();
        if (it.key() == "defaultProjectDirectory") {
            if (!value.is_string() || value.get_ref<const std::string&>().size() > 512)
                fail("INVALID_SETTINGS", "defaultProjectDirectory must be a string of at most 512 bytes.");
        } else if (it.key() == "confirmOpenNewProject2") {
            // GeneralSettings.OPEN_PROJECT_ASK/NEW_WINDOW/SAME_WINDOW/SAME_WINDOW_ATTACH.
            if (!(value.is_null() || (value.is_number_integer() && (value == -1 || value == 0 || value == 1 || value == 2))))
                fail("INVALID_SETTINGS", "confirmOpenNewProject2 must be null, -1, 0, 1 or 2.");
        } else if (it.key() == "processCloseConfirmation") {
            const auto mode = value.is_string() ? value.get<std::string>() : std::string();
            if (mode != "ASK" && mode != "TERMINATE" && mode != "DISCONNECT")
                fail("INVALID_SETTINGS", "processCloseConfirmation must be ASK, TERMINATE or DISCONNECT.");
        } else if (it.key() == "inactiveTimeout") {
            // UINumericRange.fit (UINumericRange.java:21-23) clamps instead of failing.
            if (!value.is_number_integer())
                fail("INVALID_SETTINGS", "inactiveTimeout must be an integer.");
        } else if (!value.is_boolean()) {
            fail("INVALID_SETTINGS", "General flags must be JSON booleans.");
        }
    }
}

Json editor_defaults_impl() {
    return {{"fontSize", 14}, {"tabSize", 4}, {"wordWrap", false},
            {"lineNumbers", true},
            {"showIndentGuides", true}, {"bracketMatching", true},
            // UISettingsState.editorTabLimit defaults to 30 open tabs per group.
            {"tabLimit", 30},
            // Indent with tabs instead of spaces, render whitespace, reformat on save
            // (IDEA: Editor → Code Style "Use tab character", "Show whitespaces",
            // "Reformat code" in Actions on Save).
            {"useTabCharacter", false}, {"showWhitespaces", false}, {"formatOnSave", false},
            // Delete through the platform recycle bin instead of unlinking the file
            // (IDEA's "Safe delete" fallback); `file.delete` honours it per call, this
            // is just the remembered default.
            // IDEA AppearanceConfigurable: ideScale is a percent (100 = default),
            // compactMode shrinks control heights/densities ("UI elements take up
            // less screen space"), fullPathsInWindowHeader shows the project path in
            // the window header instead of just its name.
            {"uiZoomPercent", 100}, {"compactMode", false}, {"fullPathsInWindowHeader", false},
            // AppearanceConfigurable "Tree Views": indent guides + smaller indents
            // (UISettings defaults both to off).
            {"showTreeIndentGuides", false}, {"compactTreeIndents", false},
            // "UI Options": UISettingsState defaults smoothScrolling to ON
            // (UISettingsState.kt:220 `by property(true)`) and showIconsInMenus to on;
            // fullPathsInWindowHeader / dndWithAlt / keepPopups default to off.
            {"smoothScrolling", true}, {"showIconsInMenus", true},
            // "Tool Windows": per-window size off, names under icons off, stripes
            // on — UISettings defaults, in the same order as the dialog.
            {"rememberSizeForEachToolWindow", false}, {"showToolWindowNames", false},
            {"showToolWindowBars", true},
            // "Side-by-side layout on the left" and "Widescreen tool window layout".
            {"leftSideBySide", false}, {"wideScreenSupport", false}, {"rightSideBySide", false},
            {"showToolWindowNumbers", false},
            // "Keep popups open for toggle items" + "Drag-and-drop with Alt pressed
            // only" (both off in UISettings).
            {"keepPopupsForToggles", false}, {"dndWithPressedAltOnly", false},
            // PowerSaveMode: off by default, like IDEA.
            {"powerSaveMode", false},
            // AppearanceConfigurable items with a real consumer: contrast scrollbars,
            // colour-vision filter, and the UI font stack (empty family = system).
            {"useContrastScrollbars", false}, {"colorBlindness", "none"},
            {"uiFontFamily", ""}, {"uiFontSize", 13},
            // Background image (Images.SetBackgroundImage) + presentation mode.
            {"backgroundImagePath", ""}, {"backgroundImageOpacity", 100},
            {"backgroundImageFill", "scale"}, {"backgroundImageKeepRatio", true},
            {"presentationMode", false}, {"presentationModeFontSize", 24},
            // Main menu placement + screen-reader support (IDEA defaults).
            {"mainMenuDisplayMode", "merged"},
            // UISettingsState defaults: both AppearanceConfigurable extras ship off.
            {"differentiateProjects", false},
            {"expandNodesWithSingleClick", false}};  // UISettingsState.kt:141
}

// The markers IDEA ships: TODO, FIXME and the two conventional warning tags.
Json default_todo_markers() {
    constexpr std::pair<const char*, const char*> markers[]{{"TODO", "待办"}, {"FIXME", "需要修"},
                                                           {"XXX", "警告"}, {"HACK", "临时办法"}};
    Json result = Json::array();
    for (const auto& [pattern, description] : markers)
        result.push_back({{"pattern", pattern}, {"description", description}});
    return result;
}

Json project_defaults() {
    return {{"excludedDirs", Json::array({".git", "node_modules", "build", "dist"})},
            {"runConfigs", Json::array()}, {"bookmarks", Json::array()},
            {"todoPatterns", default_todo_markers()},
            {"java", {{"jdkHome", ""}, {"jdkName", "JavaSE-17"}, {"sourcePaths", Json::array()},
                      {"outputPath", ""}, {"referencedLibraries", Json::array({"lib/**/*.jar"})}}},
            // Built-in templates are listed by the UI and only appear in `overrides`
            // once switched off, so the stored default is an empty pair of lists.
            {"templates", {{"overrides", Json::array()}, {"customs", Json::array()}}},
            // IDEA's FileType association table, reduced to what TaoCode can highlight:
            // extension -> language, e.g. {"conf": "typescript"}. Empty by default.
            {"fileAssociations", Json::object()}};
}

Json empty_document() {
    return {{"recentProjects", Json::array()}, {"settings", editor_defaults_impl()},
            {"lastProject", nullptr}, {"perProject", Json::object()}};
}

// Overlay a stored record onto the defaults, filling any key that is absent or null.
// Recurses into objects so a nested `java: null` from an older file still migrates.
void fill_defaults(Json& base, const Json& stored) {
    if (!stored.is_object()) return;
    for (const auto& entry : stored.items()) {
        const auto value = entry.value();
        if (value.is_null()) continue;
        if (value.is_object() && base.contains(entry.key()) && base[entry.key()].is_object())
            fill_defaults(base[entry.key()], value);
        else
            base[entry.key()] = value;
    }
}

void known_keys(const Json& value, std::span<const std::string_view> keys, const char* code) {
    if (!value.is_object()) fail(code, "Settings/state must be a JSON object.");
    for (auto it = value.begin(); it != value.end(); ++it) {
        if (std::find(keys.begin(), keys.end(), std::string_view(it.key())) == keys.end())
            fail(code, "Unknown field: " + it.key());
    }
}

// 就地写 `{"a","b"}` 的调用点走这个重载：括号列表在这条表达式里是安全的。
void known_keys(const Json& value, std::initializer_list<std::string_view> keys, const char* code) {
    known_keys(value, std::span<const std::string_view>(keys.begin(), keys.size()), code);
}

// 读盘和收补丁是两件事：IDEA 的 XmlSerializer 会忽略未知标签，`noStateLoaded()` 再补默认值，
// 所以**旧版本写过、新版本已经删掉的键不能让整个文件变成"损坏"**。这里按允许集剪掉未知键，
// 返回 discarded 让调用方决定要不要提示；严格校验仍然只用于 UI 传来的补丁。
std::vector<std::string> prune_unknown(Json& object, std::span<const std::string_view> keys) {
    std::vector<std::string> discarded;
    if (!object.is_object()) return discarded;
    // 先把未知键收集出来，再按键删除：nlohmann::json 的 `erase(iterator)` 只对**数组**有效，
    // 对 object 用它属于未定义行为（真出现过 SEGFAULT，被 ctest 的 projects_lifecycle 抓到）。
    for (auto it = object.begin(); it != object.end(); ++it) {
        if (std::find(keys.begin(), keys.end(), std::string_view(it.key())) == keys.end())
            discarded.push_back(it.key());
    }
    for (const auto& key : discarded) object.erase(key);
    return discarded;
}

void validate_general_patch(const Json& patch);
Json general_defaults_impl();

// 唯一一份键表：UI 补丁的严格校验与读盘的剪枝共用，避免两处漂移。
// 注意用 `constexpr` 数组而不是「按值返回 std::initializer_list」——后者的底层数组是临时对象，
// 在 return 语句结束时就被销毁，调用方拿到的是悬垂列表（真踩过：报假"Unknown field"并 SEGFAULT）。





// —— 项目级设置的补丁校验（todo 模式 / 实时模板 / 书签 / Java / 文件关联）——

std::string text_or(const Json& object, const char* key) {
    if (object.is_object() && object.contains(key) && object.at(key).is_string()) return object.at(key).get<std::string>();
    return {};
}


// IDEA's TODO index is driven by "pattern -> description" entries that travel with the
// project, so a repository can carry its own markers (REVIEW, OPTIMIZE, ...).
void validate_todo_patterns(const Json& values) {
    if (!values.is_array()) fail("INVALID_SETTINGS", "todoPatterns must be an array.");
    if (values.size() > max_todo_patterns)
        fail("INVALID_SETTINGS", "每个项目的 TODO 模式不能超过 " + std::to_string(max_todo_patterns) + " 条。");
    std::set<std::string> patterns;
    for (const auto& value : values) {
        if (!value.is_object()) fail("INVALID_SETTINGS", "TODO 模式要写成 {pattern, description}。");
        known_keys(value, {"pattern", "description"}, "INVALID_SETTINGS");
        const auto pattern = text_or(value, "pattern"), description = text_or(value, "description");
        if (pattern.empty() || pattern.size() > 200) fail("INVALID_SETTINGS", "TODO 模式不能为空且不超过 200 字节。");
        if (description.empty() || description.size() > 60) fail("INVALID_SETTINGS", "TODO 说明不能为空且不超过 60 字节。");
        if (!valid_utf8(pattern) || !valid_utf8(description)) fail("INVALID_SETTINGS", "TODO 模式必须是 UTF-8 文本。");
        if (pattern.find_first_of("\r\n\u0000") != std::string::npos) fail("INVALID_SETTINGS", "TODO 模式不能换行。");
        if (!patterns.insert(pattern).second) fail("INVALID_SETTINGS", "TODO 模式不能重复：" + pattern);
    }
}

// IDEA's live-template page: built-in templates can be switched off by a stable pattern,
// and the project can carry its own {key, body, description, languages} entries.
void validate_template_settings(const Json& value) {
    if (!value.is_object()) fail("INVALID_SETTINGS", "templates 要是 {overrides, customs} 对象。");
    known_keys(value, {"overrides", "customs"}, "INVALID_SETTINGS");
    static constexpr const char* languages[] = {"java", "cpp", "typescript", "other"};
    if (value.contains("overrides")) {
        const auto& overrides = value.at("overrides");
        if (!overrides.is_array()) fail("INVALID_SETTINGS", "templates.overrides must be an array.");
        if (overrides.size() > 400) fail("INVALID_SETTINGS", "模板开关不能超过 400 条。");
        std::set<std::string> patterns;
        for (const auto& entry : overrides) {
            if (!entry.is_object()) fail("INVALID_SETTINGS", "模板开关要写成 {pattern, disabled}。");
            known_keys(entry, {"pattern", "disabled"}, "INVALID_SETTINGS");
            const auto pattern = text_or(entry, "pattern");
            if (pattern.empty() || pattern.size() > 300 || !valid_utf8(pattern))
                fail("INVALID_SETTINGS", "模板标识不能为空、不能超 300 字节且必须是 UTF-8。");
            if (!entry.contains("disabled") || !entry.at("disabled").is_boolean())
                fail("INVALID_SETTINGS", "模板开关的 disabled 必须是布尔值。");
            if (!patterns.insert(pattern).second) fail("INVALID_SETTINGS", "模板标识不能重复：" + pattern);
        }
    }
    if (!value.contains("customs")) return;
    const auto& customs = value.at("customs");
    if (!customs.is_array()) fail("INVALID_SETTINGS", "templates.customs must be an array.");
    if (customs.size() > 100) fail("INVALID_SETTINGS", "每个项目的自定义模板不能超过 100 个。");
    std::set<std::string> keys;
    static const std::regex key_pattern("[A-Za-z][A-Za-z0-9]*");
    for (const auto& entry : customs) {
        if (!entry.is_object()) fail("INVALID_SETTINGS", "自定义模板要写成 {key, body, description, languages}。");
        known_keys(entry, {"key", "body", "description", "languages"}, "INVALID_SETTINGS");
        const auto key = text_or(entry, "key");
        if (key.empty() || !std::regex_match(key, key_pattern))
            fail("INVALID_SETTINGS", "模板缩写要用字母开头的英文或数字。");
        const auto body = text_or(entry, "body"), description = text_or(entry, "description");
        if (body.empty() || body.size() > 8000) fail("INVALID_SETTINGS", "模板内容不能为空且不超过 8000 字节。");
        if (description.empty() || description.size() > 120) fail("INVALID_SETTINGS", "模板说明不能为空且不超过 120 字节。");
        if (!valid_utf8(key) || !valid_utf8(body) || !valid_utf8(description))
            fail("INVALID_SETTINGS", "自定义模板必须是 UTF-8 文本。");
        if (!entry.contains("languages") || !entry.at("languages").is_array())
            fail("INVALID_SETTINGS", "自定义模板必须带 languages 数组（空数组表示所有语言）。");
        for (const auto& language : entry.at("languages")) {
            if (!language.is_string()) fail("INVALID_SETTINGS", "自定义模板的 languages 只能是字符串。");
            const auto name = language.get<std::string>();
            if (!std::any_of(std::begin(languages), std::end(languages), [&name](const char* option) { return name == option; }))
                fail("INVALID_SETTINGS", "不支持的模板语言：" + name);
        }
        if (!keys.insert(key).second) fail("INVALID_SETTINGS", "模板缩写不能重复：" + key);
    }
}

// IDEA stores the bookmark list — including its 0-9 mnemonics — with the project.
void validate_bookmarks(const Json& values) {
    if (!values.is_array()) fail("INVALID_SETTINGS", "bookmarks must be an array.");
    if (values.size() > max_bookmarks)
        fail("INVALID_SETTINGS", "每个项目的书签不能超过 " + std::to_string(max_bookmarks) + " 个。");
    std::set<std::string> places;
    std::set<int> digits;
    for (const auto& value : values) {
        if (!value.is_object()) fail("INVALID_SETTINGS", "书签要写成 {path, line, mnemonic?}。");
        known_keys(value, {"path", "line", "mnemonic"}, "INVALID_SETTINGS");
        const auto path = text_or(value, "path");
        if (path.empty() || path.size() > 512) fail("INVALID_SETTINGS", "书签路径不能为空且不超过 512 字节。");
        if (!valid_utf8(path) || path.find('\\') != std::string::npos || path.front() == '/')
            fail("INVALID_SETTINGS", "书签路径必须是工作区内的正斜杠相对路径。");
        if (path == ".." || path.starts_with("../") || path.find("/../") != std::string::npos ||
            path.ends_with("/.."))
            fail("INVALID_SETTINGS", "书签路径不能跳出工作区。");
        if (!value.contains("line") || !value.at("line").is_number_integer() ||
            value.at("line") < 1 || value.at("line") > max_bookmark_line)
            fail("INVALID_SETTINGS", "书签行号必须是 1 到 1000000 的整数。");
        if (!places.insert(path + ':' + std::to_string(value.at("line").get<std::int64_t>())).second)
            fail("INVALID_SETTINGS", "同一行只能有一个书签：" + path);
        if (!value.contains("mnemonic")) continue;
        if (!value.at("mnemonic").is_number_integer() || value.at("mnemonic") < 0 || value.at("mnemonic") > 9)
            fail("INVALID_SETTINGS", "书签编号只能是 0 到 9 的整数。");
        if (!digits.insert(value.at("mnemonic").get<int>()).second)
            fail("INVALID_SETTINGS", "同一个编号只能贴在一个书签上。");
    }
}

void validate_java_settings(const Json& value) {
    known_keys(value, {"jdkHome", "jdkName", "sourcePaths", "outputPath", "referencedLibraries"}, "INVALID_SETTINGS");
        if (value.contains("jdkHome")) {
            const auto home = text_or(value, "jdkHome");
            // UNC and drive roots are valid JDK homes; a bare relative path is not.
            if (home.size() > 1024 || !valid_utf8(home) || home.find_first_of("\r\n") != std::string::npos ||
                (!home.empty() && !from_utf8(home).is_absolute())) fail("INVALID_SETTINGS", "JDK home must be an absolute path or empty.");
        }
    if (value.contains("jdkName")) {
        static const std::regex runtime("JavaSE-(1\\.8|9|[1-9][0-9])");
        if (!std::regex_match(text_or(value, "jdkName"), runtime)) fail("INVALID_SETTINGS", "Use a Java execution environment such as JavaSE-17.");
    }
    const auto relative = [](const Json& item, bool glob) {
        if (!item.is_string()) fail("INVALID_SETTINGS", "Java project paths must be strings.");
        const auto path = item.get<std::string>();
        if (path.empty() || path.size() > 512 || !valid_utf8(path) || path.front() == '/' ||
            path.find_first_of("\\\\:<>|\"") != std::string::npos ||
            std::any_of(path.begin(), path.end(), [](unsigned char c) { return c < 32; }) ||
            (!glob && path.find_first_of("*?") != std::string::npos)) fail("INVALID_SETTINGS", "Use a workspace-relative Java path with forward slashes.");
        std::size_t start = 0;
        while (start <= path.size()) {
            const auto end = path.find('/', start);
            const auto part = path.substr(start, end == std::string::npos ? end : end - start);
            // A glob segment such as `**` is not a traversal; only literal `..` is.
            if (part.empty() || part == "..") fail("INVALID_SETTINGS", "Java project paths cannot leave the workspace.");
            if (end == std::string::npos) break;
            start = end + 1;
        }
    };
    for (const char* key : {"sourcePaths", "referencedLibraries"}) if (value.contains(key)) {
        const auto& list = value.at(key);
        if (!list.is_array() || list.size() > 64) fail("INVALID_SETTINGS", "At most 64 Java paths are supported per list.");
        std::set<std::string> seen;
        for (const auto& item : list) {
            relative(item, std::string_view(key) == "referencedLibraries");
            if (!seen.insert(item.get<std::string>()).second) fail("INVALID_SETTINGS", "Java project paths must not repeat.");
        }
    }
    if (value.contains("outputPath")) {
        const auto output = text_or(value, "outputPath");
        if (!output.empty()) relative(value.at("outputPath"), false);
    }
}

// IDEA's file-type association: an extension ("conf") mapped to one of the languages
// TaoCode can highlight. Keys are lowercase bare extensions; values match templates.ts.
void validate_file_associations(const Json& value) {
    if (!value.is_object()) fail("INVALID_SETTINGS", "fileAssociations must be an object.");
    constexpr std::string_view languages[] {"java", "cpp", "typescript", "other"};
    for (auto it = value.begin(); it != value.end(); ++it) {
        const auto& key = it.key();
        if (key.empty() || key.size() > 16 || !std::all_of(key.begin(), key.end(),
                [](char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); }))
            fail("INVALID_SETTINGS", "扩展名键必须是小写字母数字（不含点），最长 16 字符。");
        if (!it.value().is_string()) fail("INVALID_SETTINGS", "文件类型值必须是字符串。");
        const auto& language = it.value().get_ref<const std::string&>();
        if (std::find(std::begin(languages), std::end(languages), language) == std::end(languages))
            fail("INVALID_SETTINGS", "文件类型只能是 java、cpp、typescript 或 other。");
    }
}

void validate_project_patch(const Json& patch) {
    known_keys(patch, {"excludedDirs", "runConfigs", "bookmarks", "todoPatterns", "templates", "java",
                       "fileAssociations"},
               "INVALID_SETTINGS");
    if (patch.contains("fileAssociations")) validate_file_associations(patch.at("fileAssociations"));
    if (patch.contains("java")) validate_java_settings(patch.at("java"));
    if (patch.contains("excludedDirs")) {
        if (!patch.at("excludedDirs").is_array()) fail("INVALID_SETTINGS", "excludedDirs must be an array.");
        for (const auto& value : patch.at("excludedDirs")) {
            if (!value.is_string() || !valid_utf8(value.get_ref<const std::string&>()))
                fail("INVALID_SETTINGS", "excludedDirs must contain ordinary UTF-8 directory names.");
            validate_component(from_utf8(value.get_ref<const std::string&>()).native(), "INVALID_SETTINGS");
        }
    }
    // Run configurations live with the project, the way IDEA keeps them in
    // .idea/runConfigurations, so opening a project on another machine does not
    // inherit an unrelated command list.
    if (patch.contains("runConfigs")) {
        const auto& values = patch.at("runConfigs");
        if (!values.is_array()) fail("INVALID_SETTINGS", "runConfigs must be an array.");
        if (values.size() > max_run_configs)
            fail("INVALID_SETTINGS", "每个项目的运行配置不能超过 " + std::to_string(max_run_configs) + " 个。");
        std::set<std::string> names;
        for (const auto& value : values) {
            // A run configuration carries the whole shape (program, arguments, working
            // directory, environment, before-launch steps); dropping any of it on save
            // is what made the dialog feel decorative.
            if (!value.is_object()) fail("INVALID_SETTINGS", "runConfigs 的每一项都要是 {name, command[, type]}。");
            known_keys(value, {"name", "command", "type", "program", "args", "cwd", "env", "beforeLaunch", "adapter"},
                       "INVALID_SETTINGS");
            if (value.contains("type") && !value.at("type").is_string()) fail("INVALID_SETTINGS", "运行配置类型必须是字符串。");
            if (value.contains("adapter")) {
                if (!value.at("adapter").is_string() || value.at("adapter").get_ref<const std::string&>().size() > 64)
                    fail("INVALID_SETTINGS", "运行配置的调试适配器名要是不超过 64 字节的字符串。");
            }
            if (value.contains("type")) {
                const auto type = value.at("type").get<std::string>();
                if (type != "shell" && type != "application" && type != "debug")
                    fail("INVALID_SETTINGS", "运行配置类型只能是 shell、application 或 debug。");
            }
            const auto name = text_or(value, "name"), command = text_or(value, "command");
            if (name.empty() || name.size() > 80) fail("INVALID_SETTINGS", "运行配置名不能为空且不超过 80 字节。");
            if (command.empty() || command.size() > 4096) fail("INVALID_SETTINGS", "运行命令不能为空且不超过 4096 字节。");
            if (!valid_utf8(name) || !valid_utf8(command)) fail("INVALID_SETTINGS", "运行配置必须是 UTF-8 文本。");
            const auto optional_text = [&](const char* key, std::size_t limit) {
                if (!value.contains(key)) return std::string();
                if (!value.at(key).is_string()) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 必须是字符串。");
                const auto text = value.at(key).get<std::string>();
                if (text.size() > limit) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 过长。");
                if (!valid_utf8(text)) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 必须是 UTF-8 文本。");
                return text;
            };
            optional_text("program", 1024);
            optional_text("cwd", 1024);
            const auto string_list = [&](const char* key, std::size_t limit, std::size_t item_limit) {
                if (!value.contains(key)) return;
                if (!value.at(key).is_array()) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 必须是数组。");
                if (value.at(key).size() > limit) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 条目过多。");
                for (const auto& item : value.at(key)) {
                    if (!item.is_string()) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 只能是字符串。");
                    const auto text = item.get<std::string>();
                    if (text.size() > item_limit) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 条目过长。");
                    if (!valid_utf8(text)) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 必须是 UTF-8 文本。");
                }
            };
            string_list("args", 256, 1024);
            string_list("env", 256, 1024);
            if (value.contains("beforeLaunch")) {
                if (!value.at("beforeLaunch").is_array()) fail("INVALID_SETTINGS", "运行配置的 beforeLaunch 必须是数组。");
                if (value.at("beforeLaunch").size() > 16) fail("INVALID_SETTINGS", "运行前步骤最多 16 个。");
                for (const auto& step : value.at("beforeLaunch")) {
                    if (!step.is_object()) fail("INVALID_SETTINGS", "运行前步骤要写成 {name, command}。");
                    known_keys(step, {"name", "command"}, "INVALID_SETTINGS");
                    const auto step_name = text_or(step, "name"), step_command = text_or(step, "command");
                    if (step_name.empty() || step_name.size() > 80) fail("INVALID_SETTINGS", "运行前步骤名不能为空且不超过 80 字节。");
                    if (step_command.empty() || step_command.size() > 4096) fail("INVALID_SETTINGS", "运行前步骤命令不能为空。");
                    if (!valid_utf8(step_name) || !valid_utf8(step_command)) fail("INVALID_SETTINGS", "运行前步骤必须是 UTF-8 文本。");
                }
            }
            if (!names.insert(name).second) fail("INVALID_SETTINGS", "运行配置名不能重复：" + name);
        }
    }
    if (patch.contains("bookmarks")) validate_bookmarks(patch.at("bookmarks"));
    if (patch.contains("todoPatterns")) validate_todo_patterns(patch.at("todoPatterns"));
    if (patch.contains("templates")) validate_template_settings(patch.at("templates"));
}

} // namespace taocode
