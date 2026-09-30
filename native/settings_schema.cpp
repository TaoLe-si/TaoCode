// 设置模式层：键表、校验、未知键剪枝、默认值 —— 对应 IDEA 各 Configurable 的
// 校验与默认值（SettingsSchema）。从 projects.cpp 拆出（桃 2026-09-26：模块化）。
#include "settings_schema.hpp"
#include "folding_state_schema.hpp"
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
// 书签行原文（锚）的上限：前端按 1024 个字符截断，UTF-8 下最多 4 KiB —— 两边口径一致。
constexpr std::size_t max_bookmark_text = 4096;
// 作用域条数上限：状态文件本身有 1 MiB 上限，模式最长 1024 字节，64 条远不会触顶，
// 同时挡住「无限追加」的写法。IDEA 自己没有条数上限。
constexpr std::size_t max_scopes = 64;

}} // namespace

namespace taocode {

namespace {
// TaoCode 能高亮/索引的语言集合，与 templates.ts / fileAssociations 用的是同一份。
constexpr std::string_view editor_languages[]{"java", "cpp", "typescript", "other"};
}  // namespace

// 「语言 id -> 布尔」表：只存被显式配置过的语言，没进表=默认（源码 mapLanguageBreadcrumbs
// 的语义，EditorSettingsExternalizable.java:146-152 + isBreadcrumbsShownFor :459-466）。
void validate_language_flags(const Json& value, const char* name) {
    if (!value.is_object()) fail("INVALID_SETTINGS", std::string(name) + " must be an object of language flags.");
    if (value.size() > 32) fail("INVALID_SETTINGS", std::string(name) + " 的条目过多。");
    for (auto it = value.begin(); it != value.end(); ++it) {
        const auto id = it.key();
        if (std::find(std::begin(editor_languages), std::end(editor_languages), std::string_view(id)) == std::end(editor_languages))
            fail("INVALID_SETTINGS", std::string(name) + " 里有未知语言：" + id);
        if (!it.value().is_boolean())
            fail("INVALID_SETTINGS", std::string(name) + " 的值必须是布尔值。");
    }
}

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
            // 上下限抄 IDEA `EditorFontsConstants`（`getMinEditorFontSize()` = scale(4)、
            // `getMaxEditorFontSize()` = scale(registry `ide.editor.max.font.size`，默认 40)）。
            if (!value.is_number_integer() || value < 4 || value > 40)
                fail("INVALID_SETTINGS", "fontSize must be an integer from 4 through 40.");
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
        } else if (it.key() == "breadcrumbsPlacement") {
            // EditorSettingsExternalizable.isBreadcrumbsAbove()（`EditorSettingsExternalizable.java:420-430`）：
            // 位置只有「上 / 下」两种，默认 SHOW_BREADCRUMBS_ABOVE = false（即下方，:91）。
            // 是否显示由 showBreadcrumbs 单独管（isBreadcrumbsShown，:439-453）—— 两个开关各存各的，
            // 关掉显示不会丢掉位置记忆。
            const auto mode = value.is_string() ? value.get<std::string>() : std::string();
            if (mode != "top" && mode != "bottom")
                fail("INVALID_SETTINGS", "breadcrumbsPlacement must be top or bottom.");
            // 早期版本把「不显示」也编码进这里（三值）。升级路径必须仍有出路：
            // 旧文件里的 'disabled' 由前端 `normalizeEditorSettings` 迁移，而不是在这里悄悄接受。
        } else if (it.key() == "showBreadcrumbs") {
            if (!value.is_boolean()) fail("INVALID_SETTINGS", "showBreadcrumbs must be a boolean.");
        } else if (it.key() == "breadcrumbsLanguages") {
            // EditorSettingsExternalizable 的 mapLanguageBreadcrumbs（:146-152）：**只存被显式配置过的
            // 语言**，没进表的就是默认显示（isBreadcrumbsShownFor :459-466）。键必须是已知语言 id。
            validate_language_flags(value, "breadcrumbsLanguages");
        } else if (it.key() == "reformatOnPaste") {
            // CodeInsightSettings.java:143-148 的四个取值（NO_REFORMAT / INDENT_BLOCK / INDENT_EACH_LINE /
            // REFORMAT_BLOCK），下拉顺序同 EditorSmartKeysConfigurable.kt:186-188。
            const auto mode = value.is_string() ? value.get<std::string>() : std::string();
            if (mode != "none" && mode != "indentBlock" && mode != "indentEachLine" && mode != "reformatBlock")
                fail("INVALID_SETTINGS", "reformatOnPaste must be none, indentBlock, indentEachLine or reformatBlock.");
        } else if (it.key() == "bidiTextDirection") {
            // BidiTextDirection.java:21-23 只有这三个值。
            const auto direction = value.is_string() ? value.get<std::string>() : std::string();
            if (direction != "contentBased" && direction != "ltr" && direction != "rtl")
                fail("INVALID_SETTINGS", "bidiTextDirection must be contentBased, ltr or rtl.");
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
                // Console 行折叠规则（默认空：不折叠任何内容）。
                {"autoShowProcessPopup", false},
                {"foldConsoleLines", Json::array()}, {"foldExceptions", Json::array()},
                // git 默认 3 行上下文；IDEA 的 settings.context.lines 默认值同为 3。
                {"diffContextLines", 3},
                // IDEA 2023+ 默认显示粘性行；一次最多 3 层作用域。
                {"showStickyLines", true}, {"stickyLinesLimit", 3},
                // 默认没有任何外部工具。
                {"externalTools", Json::array()}};
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
        } else if (it.key() == "stickyLinesLimit") {
            if (!value.is_number_integer() || value.get<int>() < 0 || value.get<int>() > 10)
                fail("INVALID_SETTINGS", "stickyLinesLimit must be an integer between 0 and 10.");
        } else if (it.key() == "diffContextLines") {
            if (!value.is_number_integer() || value.get<int>() < 1 || value.get<int>() > 100)
                fail("INVALID_SETTINGS", "diffContextLines must be an integer between 1 and 100.");
        } else if (it.key() == "inactiveTimeout") {
            // UINumericRange.fit (UINumericRange.java:21-23) clamps instead of failing.
            if (!value.is_number_integer())
                fail("INVALID_SETTINGS", "inactiveTimeout must be an integer.");
        } else if (it.key() == "externalTools") {
            // 外部工具：{name, command} 数组（上限 32 条，各字段长度受限）。
            if (!value.is_array() || value.size() > 32)
                fail("INVALID_SETTINGS", "externalTools must be an array of at most 32 entries.");
            for (const auto& entry : value) {
                if (!entry.is_object()) fail("INVALID_SETTINGS", "each external tool must be an object.");
                known_keys(entry, {"name", "command"}, "INVALID_SETTINGS");
                const auto name = text_or(entry, "name"), command = text_or(entry, "command");
                if (name.empty() || name.size() > 80) fail("INVALID_SETTINGS", "external tool name must be 1..80 bytes.");
                if (command.empty() || command.size() > 1000) fail("INVALID_SETTINGS", "external tool command must be 1..1000 bytes.");
            }
        } else if (it.key() == "foldConsoleLines" || it.key() == "foldExceptions") {
            // ConsoleConfigurable 的两个折叠列表：字符串数组（上限 64 条，每条 ≤200 字节）。
            if (!value.is_array() || value.size() > 64)
                fail("INVALID_SETTINGS", "fold rules must be an array of at most 64 strings.");
            for (const auto& entry : value)
                if (!entry.is_string() || entry.get_ref<const std::string&>().size() > 200)
                    fail("INVALID_SETTINGS", "a fold rule must be a string of at most 200 bytes.");
        } else if (!value.is_boolean()) {
            fail("INVALID_SETTINGS", "General flags must be JSON booleans.");
        }
    }
}

Json editor_defaults_impl() {
    return {{"fontSize", 14}, {"tabSize", 4}, {"wordWrap", false},
            {"lineNumbers", true},
            {"showIndentGuides", true}, {"bracketMatching", true},
            // EditorSettingsExternalizable.OptionSet:91-92 —— SHOW_BREADCRUMBS = true、
            // SHOW_BREADCRUMBS_ABOVE = false（即默认显示在**下方**）。按语言的表默认空
            //（未配置 = 显示，:459-466）。
            {"showBreadcrumbs", true}, {"breadcrumbsPlacement", "bottom"}, {"breadcrumbsLanguages", Json::object()},
            // IDEA 默认两者都开（错误高亮与 stripe 标记）。
            {"showDiagnostics", true}, {"showErrorStripe", true},
            // CodeInsightSettings.java:144 `REFORMAT_ON_PASTE = INDENT_EACH_LINE`。
            {"reformatOnPaste", "indentEachLine"},
            // EditorSettingsExternalizable.java:137 `BIDI_TEXT_DIRECTION = BidiTextDirection.CONTENT_BASED`。
            {"bidiTextDirection", "contentBased"},
            // EditorSettingsExternalizable.java:87 默认 true。
            {"showGutterIcons", true},
            // FileColorManagerImpl.java:75-106: all three switches default true.
            {"fileColorsEnabled", true}, {"fileColorsForTabs", true}, {"fileColorsForProjectView", true},
            // UISettingsState.editorTabLimit defaults to 30 open tabs per group.
            {"tabLimit", 30},
            // UISettingsState.kt:123 `scrollTabLayoutInEditor` 默认 **true** ⇒ 标签排成一行；
            // 关掉才走 WrapMultiRowLayout（JBTabsImpl.kt:766-773 + EditorTabbedContainer.kt:582-584）。
            {"tabsInOneRow", true},
            // Indent with tabs instead of spaces, render whitespace, reformat on save
            // (IDEA: Editor → Code Style "Use tab character", "Show whitespaces",
            // "Reformat code" in Actions on Save).
            {"useTabCharacter", false}, {"showWhitespaces", false}, {"formatOnSave", false},
            // 代码折叠（CodeFoldingSettings.java:7-11）：COLLAPSE_IMPORTS 默认 true、
            // COLLAPSE_CUSTOM_FOLDING_REGIONS 默认 false。另外三个（文件头/方法体/文档注释）只有
            // 语言侧 FoldingBuilder 读，本仓不渲染也不落盘（见 src/editorFoldingSettings.ts）。
            {"collapseImports", true}, {"collapseCustomRegions", false},
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
            // UISettingsState.kt:207：默认 UNDER_HAMBURGER_BUTTON（UISettings.kt:863 那条 separate 是**迁移**分支，不是默认）。
            {"mainMenuDisplayMode", "hamburger"},
            // UISettingsState defaults: both AppearanceConfigurable extras ship off.
            {"differentiateProjects", false},
            {"expandNodesWithSingleClick", false},  // UISettingsState.kt:141
            // 高级设置 `editor.maximize.on.double.click`（intellij.platform.ide.impl.xml:1511 default="true"）。
            {"maximizeEditorOnTabDoubleClick", true},
            // UISettingsState.kt:127 showPinnedTabsInASeparateRow（默认 false）。
            {"pinnedTabsInSeparateRow", false}};
}

// DefaultTodoDefaultPatternProvider.getDefaultPatterns 只发 todo/fixme 两条（已核对源码），
// 正则也逐字照抄（`\btodo\b.*` / `\bfixme\b.*`，大小写不敏感）。
Json default_todo_markers() {
    Json result = Json::array();
    for (const auto& [pattern, description] : {std::pair<const char*, const char*>{"\\btodo\\b.*", "待办"},
                                                              {"\\bfixme\\b.*", "需要修"}})
        result.push_back({{"pattern", pattern}, {"description", description}});
    return result;
}

Json project_defaults() {
    return {{"excludedDirs", Json::array({".git", "node_modules", "build", "dist"})},
            {"runConfigs", Json::array()}, {"bookmarks", Json::array()},
            // 命名作用域（IDEA `ScopeChooserConfigurable`）：默认一个都没有，
            // 与 `NamedScopesHolder.myScopes = NamedScope.EMPTY_ARRAY` 一致。
            {"scopes", Json::array()},
            // Shared/project configurations start empty (FileColorsModel.java:40).
            // Upstream predefined local colors require scope providers; do not invent path-based defaults here.
            {"fileColors", Json::array()}, {"localFileColors", Json::array()},
            // 书签工具窗口的视图状态（IDEA `BookmarksViewState`，workspace.xml，默认值见 :23-29）。
            {"bookmarksView", {{"groupLineBookmarks", true}, {"autoscrollToSource", false},
                               {"autoscrollFromSource", false}}},
            // VCS Log 的 UI 开关（IDEA `VcsLogApplicationSettings` 的 SHOW_TAG_NAMES / SHOW_ROOT_NAMES）。
            {"vcsLog", {{"showTagNames", true}, {"showRootNames", true}}},
            {"todoPatterns", default_todo_markers()},
            // jdkName 存 IDEA 的 SDK 显示名（JdkUtil.suggestJdkName:50-57 产出 `17` / `1.8` / `21-ea`），
            // 不是 jdt.ls runtimes 的 `JavaSE-<x>` —— 那种形式只在 java_lsp_settings 的边界归一。
            {"java", {{"jdkHome", ""}, {"jdkName", "17"}, {"sourcePaths", Json::array()},
                      {"outputPath", ""}, {"referencedLibraries", Json::array({"lib/**/*.jar"})}}},
            // Built-in templates are listed by the UI and only appear in `overrides`
            // once switched off, so the stored default is an empty pair of lists.
            {"templates", {{"overrides", Json::array()}, {"customs", Json::array()}}},
            // IDEA's FileType association table, reduced to what TaoCode can highlight:
            // extension -> language, e.g. {"conf": "typescript"}. Empty by default.
            {"fileAssociations", Json::object()},
            // 构建工具（IDEA 设置里「构建、执行、部署 › 构建工具」这一组）。**项目级**：
            //   · autoReloadType —— `ExternalSystemGroupConfigurable.kt:29-56`（id=`build.tools`，
            //     三档 ALL/SELECTIVE/NONE）；`ExternalSystemProjectTrackerSettings` 的默认值是 ALL。
            //   · previousAutoReloadType —— 选 NONE 时把上一次的选择记在
            //     `settings.build.tools.auto.reload`（同文件 `PREVIOUS_KEY`）。
            //   · gradle —— `GradleConfigurable` 的三项：distributionType（用哪个 Gradle）在
            //     `GradleProjectSettings`，serviceDirectoryPath（Gradle 用户主目录）在
            //     `GradleLocalSettings.getGradleUserHome()`（GradleSettings.java:113-115），
            //     offlineMode 在 `GradleSettings.MyState`（:118-131）。三者都在项目级存储里。
            // 导出到 HTML（IDEA `ExportToHTMLSettings`，存 workspace.xml ⇒ 项目级）。
            // `scope: 0` = 还没选过（IDEA 的 MyState 里 printScope 默认 0，对话框按上下文决定初值）。
            {"exportToHtml", {{"scope", 0}, {"includeSubdirectories", false},
                              {"printLineNumbers", false}, {"openInBrowser", false}, {"outputDirectory", ""}}},
            // AutoImportProjectTrackerSettings.kt:16-26：autoReloadType 走 getDefaultAutoReloadType()，
            // 全树没有注册 DefaultAutoReloadTypeProvider 扩展实现 ⇒ 默认 SELECTIVE（不是 ALL）。
            {"buildTools", {{"autoReloadType", "SELECTIVE"}, {"previousAutoReloadType", "SELECTIVE"},
                            {"gradle", {{"useGradleFrom", "wrapper"}, {"gradlePath", ""},
                                        {"gradleUserHome", ""}, {"gradleJvm", "#USE_PROJECT_JDK"},
                                        {"delegatedBuild", true}, {"offline", false},
                                        // 已链接的 Gradle 工程目录（`GradleSettings.linkedProjectsSettings`）。
                                        // 缺键按"补默认"处理（老 projects.json 里没有这一项就是"没链接过"）。
                                        {"linkedProjects", Json::array()}}}}}};
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
        // caseSensitive 对应 IDEA TodoPattern.isCaseSensitive()（模式表每行的"区分大小写"列）。
        known_keys(value, {"pattern", "description", "caseSensitive"}, "INVALID_SETTINGS");
        const auto pattern = text_or(value, "pattern"), description = text_or(value, "description");
        if (pattern.empty() || pattern.size() > 200) fail("INVALID_SETTINGS", "TODO 模式不能为空且不超过 200 字节。");
        if (description.empty() || description.size() > 60) fail("INVALID_SETTINGS", "TODO 说明不能为空且不超过 60 字节。");
        if (value.contains("caseSensitive") && !value.at("caseSensitive").is_boolean())
            fail("INVALID_SETTINGS", "caseSensitive 必须是布尔值。");
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
        if (!value.is_object()) fail("INVALID_SETTINGS", "书签要写成 {path, line, mnemonic?, text?, description?}。");
        known_keys(value, {"path", "line", "mnemonic", "text", "description"}, "INVALID_SETTINGS");
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
        // `text` = 那一行的原文，是编辑后对账的**锚**（前端 `reconcileBookmarks` 靠它判断
        // "原文回到同一行就放回"，见 src/bookmarks.ts）。上游把它持久化成
        // `<bookmark description="…">`（`BookmarkManager.writeExternal:329-333`，只写非空值）——
        // 大工程里的长行可以很长，所以上限给 4 KiB 字节；前端按 1024 个字符截断后存，
        // 两边的口径必须一致（1024 字符 UTF-8 最多 4 KiB）。
        // 行原文 `text`（本仓的锚）与自定义描述 `description`（选中文字再按 F11 时记下的那段文本，
        // 上游 2026.2 `ToggleBookmarkAction.addSingleBookmark:88-93` → `group.setDescription`；
        // 持久化成 `<bookmark description>`，`BookmarkManager.writeExternal:329-333`）同一条口径。
        for (const char* field : {"text", "description"}) {
            if (!value.contains(field)) continue;
            const auto label = std::string(field) == "text" ? "行原文" : "描述";
            if (!value.at(field).is_string())
                fail("INVALID_SETTINGS", std::string("书签的") + label + "必须是字符串。");
            const auto field_text = value.at(field).get<std::string>();
            if (field_text.size() > max_bookmark_text || !valid_utf8(field_text))
                fail("INVALID_SETTINGS", std::string("书签的") + label + "不能超过 4096 字节且必须是 UTF-8。");
        }
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
        // IDEA 的 SDK 名由 JdkUtil.suggestJdkName 产出：`1.<feature>`（8 及以下）或 `<feature>`
        // （9 起），可带 `-ea` 后缀。历史文件里的 `JavaSE-<x>` 也放行（读盘不判损坏，
        // java_lsp_settings 会按需归一）。
        static const std::regex idea_name("1\\.[1-8]|[1-9][0-9](-ea)?|JavaSE-1\\.8|JavaSE-(9|[1-9][0-9])");
        if (!std::regex_match(text_or(value, "jdkName"), idea_name)) fail("INVALID_SETTINGS", "JDK name must look like JdkUtil.suggestJdkName output (17 / 1.8 / 21-ea).");
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

// 命名作用域（IDEA `project.scopes`）。IDEA 把本地作用域存在 workspace.xml 的
// `NamedScopeManager`、共享作用域存在 `.idea` 下的 `DependencyValidationManager`
// （`NamedScopesHolder.java:125-165` 的 writeScope/readScope）：每条只有 name 与 pattern。
// TaeCode 用一条数组保存两者，多一个 `shared` 区分持有者；数组顺序就是
// `ScopeChooserConfigurableState.myOrder`（:524-528）要保住的那个顺序。
//
// 校验只针对**形状**：IDEA 允许存下任何解析不了的模式（`readScope` 捕获 ParsingException
// 之后落到 InvalidPackageSet），所以这里绝不因为模式语法不合法而拒绝保存。
void validate_scopes(const Json& value) {
    if (!value.is_array()) fail("INVALID_SETTINGS", "scopes 必须是数组。");
    if (value.size() > max_scopes)
        fail("INVALID_SETTINGS", "每个项目最多保存 " + std::to_string(max_scopes) + " 个作用域。");
    std::set<std::string> names;
    for (const auto& entry : value) {
        if (!entry.is_object()) fail("INVALID_SETTINGS", "每个作用域要写成 {name, pattern, shared}。");
        known_keys(entry, {"name", "pattern", "shared"}, "INVALID_SETTINGS");
        if (!entry.contains("name") || !entry.at("name").is_string())
            fail("INVALID_SETTINGS", "作用域名必须是字符串。");
        if (!entry.contains("pattern") || !entry.at("pattern").is_string())
            fail("INVALID_SETTINGS", "作用域模式必须是字符串。");
        const auto name = entry.at("name").get<std::string>();
        const auto pattern = entry.at("pattern").get<std::string>();
        if (name.empty() || name.size() > 80)
            fail("INVALID_SETTINGS", "作用域名不能为空且不超过 80 字节。");
        if (!valid_utf8(name) || name.find_first_of("\r\n\t") != std::string::npos)
            fail("INVALID_SETTINGS", "作用域名必须是单行 UTF-8 文本。");
        if (pattern.size() > 1024)
            fail("INVALID_SETTINGS", "作用域模式不能超过 1024 字节。");
        if (!valid_utf8(pattern))
            fail("INVALID_SETTINGS", "作用域模式必须是 UTF-8 文本。");
        // ScopeConfigurable 的明细页里有「Share through VCS」复选框（:49,103-108），
        // 它决定这条落在本地持有者还是共享持有者（:91-95）。
        if (!entry.contains("shared") || !entry.at("shared").is_boolean())
            fail("INVALID_SETTINGS", "作用域的 shared 必须是布尔值。");
        if (!names.insert(name).second)
            fail("INVALID_SETTINGS", "作用域名不能重复：" + name);
    }
}

// FileColorManagerImpl.getColor + ColorHexUtil.java:28-35: named colors or RGB/RGBA hex.
// Scope ownership is independent of color ownership; both lists share this validator.
// Preserve unresolved scopes; local rules are project-owned (WORKSPACE_FILE), not global editor settings.
void validate_file_colors(const Json& value) {
    if (!value.is_array()) fail("INVALID_SETTINGS", "fileColors 必须是数组。");
    if (value.size() > max_scopes)
        fail("INVALID_SETTINGS", "每个项目最多保存 " + std::to_string(max_scopes) + " 条文件颜色。");
    const std::set<std::string> palette = {"Blue", "Green", "Orange", "Rose", "Violet", "Yellow", "Gray"};
    std::set<std::string> scopes;
    for (const auto& entry : value) {
        if (!entry.is_object()) fail("INVALID_SETTINGS", "每条文件颜色要写成 {scope, color}。");
        known_keys(entry, {"scope", "color"}, "INVALID_SETTINGS");
        if (!entry.contains("scope") || !entry.at("scope").is_string())
            fail("INVALID_SETTINGS", "文件颜色的作用域名必须是字符串。");
        if (!entry.contains("color") || !entry.at("color").is_string())
            fail("INVALID_SETTINGS", "文件颜色的颜色名必须是字符串。");
        const auto scope = entry.at("scope").get<std::string>();
        const auto color = entry.at("color").get<std::string>();
        if (scope.empty() || scope.size() > 80)
            fail("INVALID_SETTINGS", "作用域名不能为空且不超过 80 字节。");
        if (!valid_utf8(scope) || scope.find_first_of("\r\n\t") != std::string::npos)
            fail("INVALID_SETTINGS", "作用域名必须是单行 UTF-8 文本。");
        if (!palette.count(color) && !std::regex_match(color, std::regex("(#|0x)?([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})")))
            fail("INVALID_SETTINGS", "颜色必须为七个具名色之一或 RGB/RGBA 十六进制（3/4/6/8 位，可带 # 或 0x）。");
        // 同名只留一条：重复会让「首个命中」依赖数组顺序里哪一条在前，语义不清。
        if (!scopes.insert(scope).second)
            fail("INVALID_SETTINGS", "同一个作用域名只能配一种颜色：" + scope);
    }
}

void validate_build_tools(const Json& value) {
    if (!value.is_object()) fail("INVALID_SETTINGS", "buildTools 必须是对象。");
    known_keys(value, {"autoReloadType", "previousAutoReloadType", "gradle"}, "INVALID_SETTINGS");
    // `ExternalSystemProjectTrackerSettings.AutoReloadType` 的三个值（枚举名大写，存盘同形）。
    const auto reload_type = [&value](const char* key) {
        if (!value.contains(key)) return;
        const auto& field = value.at(key);
        const auto text = field.is_string() ? field.get<std::string>() : std::string();
        if (text != "ALL" && text != "SELECTIVE" && text != "NONE")
            fail("INVALID_SETTINGS", std::string(key) + " 只能是 ALL / SELECTIVE / NONE。");
    };
    reload_type("autoReloadType");
    reload_type("previousAutoReloadType");
    if (!value.contains("gradle")) return;
    const auto& gradle = value.at("gradle");
    if (!gradle.is_object()) fail("INVALID_SETTINGS", "buildTools.gradle 必须是对象。");
    known_keys(gradle, {"useGradleFrom", "gradlePath", "gradleUserHome", "gradleJvm", "delegatedBuild", "offline",
                        "linkedProjects"}, "INVALID_SETTINGS");
    if (gradle.contains("useGradleFrom")) {
        const auto& field = gradle.at("useGradleFrom");
        // `DistributionType`：默认/包装器 → wrapper；本机 → local；指定路径 → path。
        const auto text = field.is_string() ? field.get<std::string>() : std::string();
        if (text != "wrapper" && text != "local" && text != "path")
            fail("INVALID_SETTINGS", "useGradleFrom 只能是 wrapper / local / path。");
    }
    // 「Gradle JVM」（`GradleProjectSettings.getGradleJvm()`）：要么是 `#USE_PROJECT_JDK`
    // （`ExternalSystemJdkUtil.java:52` —— 用项目 JDK，默认值），要么是一个 JDK 主目录。
    for (const auto key : {"gradlePath", "gradleUserHome", "gradleJvm"}) {
        if (!gradle.contains(key)) continue;
        const auto& field = gradle.at(key);
        if (!field.is_string() || !valid_utf8(field.get_ref<const std::string&>()) || field.get_ref<const std::string&>().size() > 512)
            fail("INVALID_SETTINGS", std::string(key) + " 必须是 512 字节以内的 UTF-8 路径字符串。");
    }
    // 「构建并运行使用」（`GradleProjectSettings.getDelegatedBuild()`，默认 true）。
    for (const auto key : {"delegatedBuild", "offline"}) {
        if (gradle.contains(key) && !gradle.at(key).is_boolean())
            fail("INVALID_SETTINGS", std::string("buildTools.gradle.") + key + " 必须是布尔值。");
    }
    // 已链接的 Gradle 工程目录：工作区**相对**目录（`''` = 工作区根，就是自动链接那一档）。
    // 与 `java.sourcePaths` 同一口径：绝对路径、盘符、`..` 段一律拒 —— 一次坏写入就能把
    // 同步的当前工作目录带到项目外面。
    if (!gradle.contains("linkedProjects")) return;
    const auto& linked = gradle.at("linkedProjects");
    if (!linked.is_array() || linked.size() > 32) fail("INVALID_SETTINGS", "linkedProjects 必须是不超过 32 项的数组。");
    for (const auto& item : linked) {
        if (!item.is_string()) fail("INVALID_SETTINGS", "linkedProjects 的每一项都必须是字符串路径。");
        const auto text = item.get<std::string>();
        // 口径与书签路径一致（同文件 validate_bookmarks）：正斜杠、不出工作区、不带盘符。
        if (text.size() > 512 || !valid_utf8(text) || text.find('\\') != std::string::npos ||
            text.find_first_of("\r\n") != std::string::npos || text.find(':') != std::string::npos ||
            (!text.empty() && text.front() == '/'))
            fail("INVALID_SETTINGS", "linkedProjects 必须是工作区内的正斜杠相对目录：" + text);
        if (text == ".." || text.starts_with("../") || text.find("/../") != std::string::npos ||
            text.ends_with("/.."))
            fail("INVALID_SETTINGS", "linkedProjects 不能跳出工作区：" + text);
    }
}

void validate_export_to_html(const Json& value) {
    if (!value.is_object()) fail("INVALID_SETTINGS", "exportToHtml 必须是对象。");
    known_keys(value, {"scope", "includeSubdirectories", "printLineNumbers", "openInBrowser", "outputDirectory"},
               "INVALID_SETTINGS");
    if (value.contains("scope")) {
        // `PrintSettings.PRINT_FILE/PRINT_SELECTED_TEXT/PRINT_DIRECTORY`（1/2/4）+ 0 = 未选。
        const auto& scope = value.at("scope");
        if (!scope.is_number_integer()) fail("INVALID_SETTINGS", "exportToHtml.scope 必须是整数。");
        const auto number = scope.get<std::int64_t>();
        if (number != 0 && number != 1 && number != 2 && number != 4)
            fail("INVALID_SETTINGS", "exportToHtml.scope 只能是 0 / 1 / 2 / 4（未选 / 当前文件 / 选中文本 / 当前目录）。");
    }
    for (const auto key : {"includeSubdirectories", "printLineNumbers", "openInBrowser"})
        if (value.contains(key) && !value.at(key).is_boolean())
            fail("INVALID_SETTINGS", std::string("exportToHtml.") + key + " 必须是布尔值。");
    if (value.contains("outputDirectory")) {
        const auto& field = value.at("outputDirectory");
        if (!field.is_string() || !valid_utf8(field.get_ref<const std::string&>()) ||
            field.get_ref<const std::string&>().size() > 512)
            fail("INVALID_SETTINGS", "exportToHtml.outputDirectory 必须是 512 字节以内的 UTF-8 路径字符串。");
    }
}

void validate_project_patch(const Json& patch) {
    known_keys(patch, {"excludedDirs", "runConfigs", "bookmarks", "todoPatterns", "templates", "java",
                       "fileAssociations", "vcsLog", "scopes", "fileColors", "localFileColors", "bookmarksView", "buildTools", "exportToHtml",
                       "foldingState"},
               "INVALID_SETTINGS");
    // 折叠状态（IDEA 的 workspace 文件那一段）：形状与上限在 native/folding_state_schema.cpp。
    if (patch.contains("foldingState")) validate_folding_state(patch.at("foldingState"));
    if (patch.contains("buildTools")) validate_build_tools(patch.at("buildTools"));
    if (patch.contains("exportToHtml")) validate_export_to_html(patch.at("exportToHtml"));
    if (patch.contains("scopes")) validate_scopes(patch.at("scopes"));
    for (const auto* key : {"localFileColors", "fileColors"}) if (patch.contains(key)) validate_file_colors(patch.at(key));
    if (patch.contains("bookmarksView")) {
        // 只收录有真实落点的三个开关（IDEA 还有 askBeforeDeletingLists / showPreview /
        // rewriteBookmarkType，本仓没有对应概念，故不接受它们 —— 免得存下一个没人读的值）。
        const auto& view = patch.at("bookmarksView");
        if (!view.is_object()) fail("INVALID_SETTINGS", "bookmarksView 必须是对象。");
        known_keys(view, {"groupLineBookmarks", "autoscrollToSource", "autoscrollFromSource"}, "INVALID_SETTINGS");
        for (auto it = view.begin(); it != view.end(); ++it)
            if (!it.value().is_boolean()) fail("INVALID_SETTINGS", "bookmarksView 的值必须是布尔值。");
    }
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
            // `folder` 对应 IDEA RunConfigurable 树里的文件夹节点（`RunConfigurableNodeKind.FOLDER`，
            // RunConfigurable.kt:180 用 String 当 userObject），空串/缺省表示放在类型节点下。
            // `allowRunningInParallel` = IDEA `RunConfigurationOptions.isAllowRunningInParallel`
            // （`:54-56`，默认 false）：「允许并行运行多个实例」。
            known_keys(value, {"name", "command", "type", "program", "args", "cwd", "env", "beforeLaunch", "adapter", "folder",
                               "allowRunningInParallel"},
                       "INVALID_SETTINGS");
            if (value.contains("allowRunningInParallel") && !value.at("allowRunningInParallel").is_boolean())
                fail("INVALID_SETTINGS", "运行配置的 allowRunningInParallel 必须是布尔值。");
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
            // 文件夹名：非空时最多 80 字节、单行（树的节点标签一行显示）。
            if (value.contains("folder")) {
                if (!value.at("folder").is_string()) fail("INVALID_SETTINGS", "运行配置的 folder 必须是字符串。");
                const auto folder = value.at("folder").get<std::string>();
                if (folder.size() > 80) fail("INVALID_SETTINGS", "运行配置的文件夹名不能超过 80 字节。");
                if (!valid_utf8(folder) || folder.find_first_of("\r\n\t") != std::string::npos)
                    fail("INVALID_SETTINGS", "运行配置的文件夹名必须是单行 UTF-8 文本。");
            }
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
