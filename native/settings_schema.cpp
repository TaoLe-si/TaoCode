// 设置模式层（**应用级**）：键表（在 settings_schema.hpp）、editor/general 的校验与默认值、
// 未知键剪枝与补默认值 —— 对应 IDEA 各 Configurable 的校验与默认值（SettingsSchema）。
// 从 projects.cpp 拆出（桃 2026-09-26：模块化）。
// 2026-10-08 lane pf-lifecycle：**项目/工作区级**那一半（todoPatterns / templates / bookmarks /
// bookmarkLists / java / fileAssociations / scopes / fileColors / buildTools / exportToHtml /
// runConfigs / foldingState 的默认值与补丁校验）整族搬进 native/settings_project_schema.cpp ——
// 那个文件一族把本文件顶到 1119 行、撞上 native 的 1100 行机检上限；按「应用级 vs 项目级」拆，
// 上限不抬。`text_or` / `known_keys` / `prune_unknown` / `fill_defaults` 仍是两边共用的一份实现。
#include "settings_schema.hpp"
#include "settings_editor_keys.hpp"
#include "fsops.hpp"
#include "trusted_paths.hpp"

#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <regex>
#include <set>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>

namespace taocode {

// `validate_language_flags` / `editor_languages` / 新增键的校验分支都在 settings_editor_keys.hpp
// （本文件贴着 native 的 1100 行机检上限，新增 10 把键压不下 —— 拆头文件，不抬上限）。
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
        } else if (it.key() == "lineNumeration") {
            // EditorSettingsExternalizable.LINE_NUMERATION（EditorSettings.java:264 的 LineNumerationType）
            // 只有绝对/相对/混合三档，默认 ABSOLUTE（EditorSettingsExternalizable.java:53）。
            const auto mode = value.is_string() ? value.get<std::string>() : std::string();
            if (mode != "absolute" && mode != "relative" && mode != "hybrid")
                fail("INVALID_SETTINGS", "lineNumeration must be absolute, relative or hybrid.");
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
        } else if (it.key() == "stickyLinesLimit") {
            // 与 general 档的同名键同一套界（:179）：0..10 层，0 = 完全不叠。
            if (!value.is_number_integer() || value.get<int>() < 0 || value.get<int>() > 10)
                fail("INVALID_SETTINGS", "stickyLinesLimit must be an integer between 0 and 10.");
        } else if (it.key() == "diffContextLines") {
            // 与 general 档的同名键同一套界（:182）：1..100 行。
            if (!value.is_number_integer() || value.get<int>() < 1 || value.get<int>() > 100)
                fail("INVALID_SETTINGS", "diffContextLines must be an integer between 1 and 100.");
        } else if (validate_editor_added_key(it.key(), value)) {
            // 本批新增的**非布尔**键在 settings_editor_keys.hpp 里校验；走到这里就是已经判过。
        } else if (!value.is_boolean()) {
            fail("INVALID_SETTINGS", "Editor flags must be JSON booleans.");
        }
    }
}

Json general_defaults_impl() {
    return Json{{"defaultProjectDirectory", Json("")},
                {"reopenLastProject", true}, {"deleteToBin", true},
                {"embeddedBrowserAllowInsecureCertificates", false},
                {"autoSyncFiles", true}, {"backgroundSyncFiles", true},
                {"autoSaveFiles", true}, {"autoSaveIfInactive", false},
                {"isUseSafeWrite", true}, {"confirmExit", true},
                {"isShowWelcomeScreen", true},
                {"confirmOpenNewProject2", Json(nullptr)},  // GeneralSettings.defaultConfirmNewProject() == OPEN_PROJECT_ASK
                {"processCloseConfirmation", "ASK"},
                {"inactiveTimeout", 15},
                {"supportScreenReaders", false},  // GeneralSettingsState.supportScreenReaders (kt:265)
                {"overrideSystemDateFormat", false}, {"dateFormatPattern", "dd MMM yyyy"},
                {"use24HourTime", true}, {"prettyFormattingAllowed", true},
                // 音频提示（无障碍）：`AudioCuesSettings.kt:17`，默认 off（用户主动打开才响；
                // 上游默认是 AUTO，差异记在 src/settingsModel.ts 的字段注释里）。
                // 逐 cue 停用表默认空 = 六个 cue 全开（同上游 disabledCues 的空 Set 默认）。
                {"audioCuesMode", "off"}, {"audioCuesDisabled", Json::array()},
                // IDEA 用注册表键 ide.windowSystem.autoShowProcessPopup（registry.properties:209-210，
                // 默认 false），在 InfoAndProgressPanel.kt:319-321 读一次：有进程开始跑时是否自动
                // 弹出进度面板。全量移植时把它升格为持久化设置（TaoCode 没有注册表对话框）。
                // Console 行折叠规则（默认空：不折叠任何内容）。
                {"autoShowProcessPopup", false},
                {"foldConsoleLines", Json::array()}, {"foldExceptions", Json::array()},
                {"foldJavaStackTrace", true}, {"foldJavaStackTraceGreaterThan", 8},
                // git 默认 3 行上下文；IDEA 的 settings.context.lines 默认值同为 3。
                {"diffContextLines", 3},
                // EditorSettingsExternalizable.java:93-94.
                {"showStickyLines", true}, {"stickyLinesLimit", 5},
                // 默认没有任何外部工具。
                {"externalTools", Json::array()},
                // SeFuzzyFileSearchProviderFactory.kt:28-31：`Registry.is("search.everywhere.fuzzy.files.enabled", false)`
                // —— 随处的文件供给者默认不走 Smith-Waterman，所以默认 false（勾上后才启用）。
                {"fuzzyFileSearch", false},
                // XDebuggerDataViewSettings：两格默认关（与 IDEA 默认一致：显示 null、不排序）。
                {"debuggerHideNullValues", false}, {"debuggerSortByName", false},
                // XDebuggerDataViewSettings.showValuesInline 上游默认 true，但本仓的行内值渲染是子集
                // （只到当前帧第一个作用域，见 src/debugInlineValues.ts 文件头），默认 false。
                {"debuggerShowValuesInline", false},
                // XDebuggerDataViewSettings.isShowLibraryStackFrames / XDebuggerGeneralSettings
                // 的 confirmBreakpointRemoval / unmuteOnStop：上游默认都 false。
                {"debuggerShowLibraryFrames", false}, {"debuggerConfirmBreakpointRemoval", false},
                {"debuggerUnmuteOnStop", false},
                // XDebuggerGeneralSettings.getEvaluationDialogMode：上游默认 EXPRESSION；两档
                // expression（单行表达式）/ codeFragment（代码片段编辑器）。
                {"debuggerEvaluationMode", "expression"},
                // 受信任项目清单：默认空 = 任何陌生目录第一次打开都要问（`TrustedPaths.State`
                // 的 `trustedPaths` 默认空 map，`TrustedPaths.kt:41-44`）。
                {"trustedPaths", Json::array()}};
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
        } else if (it.key() == "audioCuesMode") {
            // AudioCuesMode 三档（AudioCuesSettings.kt:75-79：auto / on / off）。
            // 消费判定 isOn（:85-89）：AUTO 看屏幕阅读器、ON 恒真、OFF 恒假。
            if (!value.is_string() || (value.get<std::string>() != "auto" && value.get<std::string>() != "on"
                                       && value.get<std::string>() != "off"))
                fail("INVALID_SETTINGS", "audioCuesMode must be auto, on or off.");
        } else if (it.key() == "audioCuesDisabled") {
            // AudioCuesSettingsState.disabledCues（AudioCuesSettings.kt:69-72）的数组形态：
            // 六个 cue 的 id（IdeAudioCues.kt:13-39）。上限取 6 —— 未知 id 在这里就拒，
            // 不让坏值流到「逐 cue 停用」的判定里（那层只做集合判断，不校验 id）。
            static constexpr std::string_view cue_ids[] = {
                "error.line", "error.caret", "warning.line", "warning.caret", "folded.line", "folded.caret"};
            if (!value.is_array() || value.size() > sizeof(cue_ids) / sizeof(cue_ids[0]))
                fail("INVALID_SETTINGS", "audioCuesDisabled must be an array of at most 6 cue ids.");
            for (const auto& entry : value) {
                if (!entry.is_string() || std::find(std::begin(cue_ids), std::end(cue_ids), std::string_view(entry.get_ref<const std::string&>()))
                        == std::end(cue_ids))
                    fail("INVALID_SETTINGS", "audioCuesDisabled 里有未知的 cue id。");
            }
        } else if (it.key() == "trustedPaths") {
            // 受信任项目清单（IDEA `TrustedPaths.State.trustedPaths: Map<Path, Boolean>` 的数组形态）：
            // 每条 `{path, trusted}`；路径 1024 字节内、单行 UTF-8；同一路径只留一条 —— 重复会让
            // 「最近祖先」的胜负依赖数组顺序（`trusted_paths.cpp` 取最长祖先）。
            if (!value.is_array() || value.size() > 256)
                fail("INVALID_SETTINGS", "trustedPaths must be an array of at most 256 entries.");
            std::set<std::string> seen;
            for (const auto& entry : value) {
                if (!entry.is_object()) fail("INVALID_SETTINGS", "trustedPaths 的每一项都要是 {path, trusted}。");
                known_keys(entry, {"path", "trusted"}, "INVALID_SETTINGS");
                const auto path = text_or(entry, "path");
                if (path.empty() || path.size() > 1024 || !valid_utf8(path) || path.find_first_of("\r\n") != std::string::npos)
                    fail("INVALID_SETTINGS", "trustedPaths 的路径不能为空、不超过 1024 字节且必须是单行 UTF-8 文本。");
                if (!entry.contains("trusted") || !entry.at("trusted").is_boolean())
                    fail("INVALID_SETTINGS", "trustedPaths 的 trusted 必须是布尔值。");
                if (!seen.insert(trusted::normalize_path(path)).second)
                    fail("INVALID_SETTINGS", "trustedPaths 不能有重复路径：" + path);
            }
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
        } else if (it.key() == "dateFormatPattern") {
            if (!value.is_string())
                fail("INVALID_SETTINGS", "dateFormatPattern must be a string.");
        } else if (it.key() == "externalTools") {
            // 外部工具：上游 `Tool` 的 bean 形状（platform/lang-impl/src/com/intellij/tools/Tool.java:56-78，
            // 编辑面 platform/lang-impl/src/com/intellij/tools/ToolEditorDialog.java:100-121 的 getData、
            // :137-158 的 setData）。2026-10-06 按 docs/wiring-requests-2026-10-06-bucket15.md W2 放开：
            // 原先白名单只有 {"name","command"} ⇒ 其余字段存不进宿主设置、只能落 localStorage。
            // name/command 仍必填，32 条上限与两条长度限制照旧；**新放的键一律可选** —— 旧存档少键
            // 不许判损坏（缺省由 src/externalToolsRecords.ts 的 withToolDetailDefaults 补）。
            // 不放开两组：`program`/`parameters`（Tool.java:75-76，本仓合成一条 command，拆开就是两份真源）；
            // 四个 `shownIn*`（Tool.java:62-65，上游注明 "effectively not used anymore, see IDEA-190856"）。
            if (!value.is_array() || value.size() > 32)
                fail("INVALID_SETTINGS", "externalTools must be an array of at most 32 entries.");
            for (const auto& entry : value) {
                if (!entry.is_object()) fail("INVALID_SETTINGS", "each external tool must be an object.");
                known_keys(entry, {"name", "command", "description", "group", "enabled", "useConsole",
                                   "showConsoleOnStdOut", "showConsoleOnStdErr", "synchronizeAfterExecution",
                                   "workingDirectory", "outputFilters"}, "INVALID_SETTINGS");
                const auto name = text_or(entry, "name"), command = text_or(entry, "command");
                if (name.empty() || name.size() > 80) fail("INVALID_SETTINGS", "external tool name must be 1..80 bytes.");
                if (command.empty() || command.size() > 1000) fail("INVALID_SETTINGS", "external tool command must be 1..1000 bytes.");
                // 可选文本字段：给了就要是字符串（长度上限是本仓的存储护栏，不是上游约束）。
                for (const auto* key : {"description", "group", "workingDirectory"}) {
                    if (entry.contains(key) && !entry.at(key).is_string())
                        fail("INVALID_SETTINGS", std::string("external tool ") + key + " must be a string.");
                    if (entry.contains(key) && entry.at(key).get_ref<const std::string&>().size() > 1000)
                        fail("INVALID_SETTINGS", std::string("external tool ") + key + " must be at most 1000 bytes.");
                }
                for (const auto* key : {"enabled", "useConsole", "showConsoleOnStdOut", "showConsoleOnStdErr",
                                        "synchronizeAfterExecution"}) {
                    if (entry.contains(key) && !entry.at(key).is_boolean())
                        fail("INVALID_SETTINGS", std::string("external tool ") + key + " must be a boolean.");
                }
                // outputFilters = 上游 `FilterInfo[]`（Tool.java:78）的正则本体：ToolEditorDialog.java:118
                // 就是 `new FilterInfo(s, "", "")`，只填正则那一段 ⇒ 这里只收 1..200 字节的字符串。
                if (entry.contains("outputFilters") && (!entry.at("outputFilters").is_array() || entry.at("outputFilters").size() > 16))
                    fail("INVALID_SETTINGS", "external tool outputFilters must be an array of at most 16 entries.");
                if (entry.contains("outputFilters") && entry.at("outputFilters").is_array())
                    for (const auto& item : entry.at("outputFilters"))
                        if (!item.is_string() || item.get_ref<const std::string&>().empty() || item.get_ref<const std::string&>().size() > 200)
                            fail("INVALID_SETTINGS", "external tool outputFilters items must be 1..200 byte strings.");
            }
        } else if (it.key() == "debuggerEvaluationMode") {
            // EvaluationMode.EXPRESSION | CODE_FRAGMENT 两档（求值对话框是单行还是代码片段编辑器）。
            if (!value.is_string() || (value.get<std::string>() != "expression" && value.get<std::string>() != "codeFragment"))
                fail("INVALID_SETTINGS", "debuggerEvaluationMode must be expression or codeFragment.");
        } else if (it.key() == "foldConsoleLines" || it.key() == "foldExceptions") {
            // ConsoleConfigurable 的两个折叠列表：字符串数组（上限 64 条，每条 ≤200 字节）。
            if (!value.is_array() || value.size() > 64)
                fail("INVALID_SETTINGS", "fold rules must be an array of at most 64 strings.");
            for (const auto& entry : value)
                if (!entry.is_string() || entry.get_ref<const std::string&>().size() > 200)
                    fail("INVALID_SETTINGS", "a fold rule must be a string of at most 200 bytes.");
        } else if (it.key() == "foldJavaStackTraceGreaterThan") {
            if (!value.is_number_integer())
                fail("INVALID_SETTINGS", "foldJavaStackTraceGreaterThan must be an integer between 0 and 2147483647.");
            if (value.is_number_unsigned()) {
                if (value.get<std::uint64_t>() > 2147483647ULL)
                    fail("INVALID_SETTINGS", "foldJavaStackTraceGreaterThan must be an integer between 0 and 2147483647.");
            } else if (value.get<std::int64_t>() < 0 || value.get<std::int64_t>() > 2147483647LL) {
                fail("INVALID_SETTINGS", "foldJavaStackTraceGreaterThan must be an integer between 0 and 2147483647.");
            }
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
            // UISettingsState.kt:121 `showMembersInNavigationBar` 默认 true。
            {"showMembersInNavigationBar", true},
            // IDEA 默认两者都开（错误高亮与 stripe 标记）。
            {"showDiagnostics", true}, {"showErrorStripe", true},
            // CodeInsightSettings.java:144 `REFORMAT_ON_PASTE = INDENT_EACH_LINE`。
            {"reformatOnPaste", "indentEachLine"},
            // EditorSettingsExternalizable.java:137 `BIDI_TEXT_DIRECTION = BidiTextDirection.CONTENT_BASED`。
            {"bidiTextDirection", "contentBased"},
            // EditorSettingsExternalizable.java:53 `DEFAULT_LINE_NUMERATION = LineNumerationType.ABSOLUTE`
            // （EditorAppearanceConfigurable.kt:118-124 的下拉框：绝对/相对/混合）。
            {"lineNumeration", "absolute"},
            // EditorSettingsExternalizable.java:87 默认 true。
            {"showGutterIcons", true},
            // FileColorManagerImpl.java:75-106: all three switches default true.
            {"fileColorsEnabled", true}, {"fileColorsForTabs", true}, {"fileColorsForProjectView", true},
            // InlaySettingsConfigurable（`inlay.hints`，intellij.platform.lang.impl.xml:935-941）：
            // 上游 `InlayProviderSettingsModel.isEnabled` 出厂为真（platform/lang-api/.../InlayProviderSettingsModel.kt:26），
            // 本仓按 LSP `kind` 分的三档默认也全开（键名见 src/inlayHints.ts 的 INLAY_HINT_SETTING_KEYS）。
            {"showTypeInlayHints", true}, {"showParameterInlayHints", true}, {"showOtherInlayHints", true},
            // UISettingsState.editorTabLimit defaults to 30 open tabs per group.
            {"tabLimit", 30},
            // UISettingsState.kt:123 `scrollTabLayoutInEditor` 默认 **true** ⇒ 标签排成一行；
            // 关掉才走 WrapMultiRowLayout（JBTabsImpl.kt:766-773 + EditorTabbedContainer.kt:582-584）。
            {"tabsInOneRow", true},
            // UISettingsState.kt:125 `hideTabsIfNeeded by property(true)` —— 默认滚动而非挤压。
            {"hideTabsIfNeeded", true},
            // UISettingsState.kt:249 `sortBookmarks by property(false)` —— 默认按加入顺序，不是按位置。
            {"sortBookmarks", false},
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
            {"pinnedTabsInSeparateRow", false},
            // 这五个键以前**只在前端**存在（src/settingsModel.ts:149），native 的白名单里漏了它们，
            // 于是 prune_unknown（project_settings_state.cpp:41）把它们从 projects.json 剪掉，
            // 前端拿回的 editorSettings 里 showStatusBar 是 undefined —— 状态栏整条不渲染
            // （src/App.vue:2316 的 v-if）。白名单补在 settings_schema.hpp:53 之后，注释里有逐条出处。
            // UISettingsState.kt:113 `var showStatusBar: Boolean by property(true)`。
            {"showStatusBar", true},
            // EditorSettingsExternalizable.java:83 `IS_RIGHT_MARGIN_SHOWN = true`。
            {"rightMargin", true},
            // EditorSettingsExternalizable.java:93-94 `SHOW_STICKY_LINES = true` / `STICKY_LINES_LIMIT = 5`。
            {"showStickyLines", true}, {"stickyLinesLimit", 5},
            // diff.base 的 settings.context.lines（DiffSettingsConfigurable.kt:30-58），默认与 git 一致。
            {"diffContextLines", 3},
            // 保存时的两条 pass（IDEA Settings ▸ Editor ▸ General，控件 EditorOptionsPanel.kt:147-157）。
            // 上游默认逐条：STRIP=Changed（EditorSettingsExternalizable.java:73，三档字面值 :216-218）、
            // IS_ENSURE_NEWLINE_AT_EOF=false（:74）、KEEP_TRAILING_SPACE_ON_CARET_LINE=true（:142）。
            // 消费方 src/editorSaveTransforms.ts。**不落** REMOVE_TRAILING_BLANK_LINES（:75，没有执行体）。
            {"stripTrailingSpaces", "Changed"}, {"ensureNewLineAtEof", false}, {"keepTrailingSpacesOnCaretLine", true},
            // 回车与引号的三个开关（CodeInsightSettings.java:140/:132/:130，默认全 true），
            // 设置行在编辑器 › 智能键（EditorSmartKeysConfigurable.kt:49-51/:69-72/:74-76）。
            {"autoInsertPairQuote", true}, {"closeCommentOnEnter", true}, {"insertBraceOnEnter", true},
            // Code Vision（CodeVisionSettings.kt 的 State：:36 isEnabled=true、:45/:50 两个"只装与
            // 出厂相反那一半"的集合（出厂都空）、:38-39 每行可见条数 5）。组 id 见 src/codeLensSettings.ts:48-50。
            {"codeVisionEnabled", true}, {"codeVisionDisabledGroups", Json::array()},
            {"codeVisionEnabledGroups", Json::array()}, {"codeVisionVisibleEntries", 5},
            // 快速文档两档，上游默认都是开（:76 与 DocumentationToolWindowManager.kt:55）。
            {"showQuickDocOnMouseHover", true}, {"autoUpdateDocumentation", true}, {"wheelFontChangeEnabled", false}, {"terminalBaseFontSize", 13}};  // 终端字号两把：总闸 false = EditorSettingsExternalizable.java:124 的 IS_WHEEL_FONTCHANGE_ENABLED（门 JBTerminalPanel.java:382），基准 13 = 本仓内置档 src/terminalFontSize.ts:47（界 4..40 = EditorFontsConstants.java:11-17）。逐条出处见 settings_schema.hpp 的 EDITOR_SETTING_KEYS 尾部。
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

} // namespace taocode
