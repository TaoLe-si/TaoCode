// 项目层原生回归：创建/校验路径、通用与项目设置、最近项目、运行配置、书签、TODO 模式、
// 命名作用域、实时模板、Java 项目设置与 1 MiB 状态上限。
//
// 文件颜色（`.idea` 两层 XML）是另一个模块，回归在 project_file_colors_test.cpp；
// 两边共用的临时根目录、文件读写与断言在 project_test_support.hpp。
#include "project_test_support.hpp"

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::ProjectStore;
using taocode::Workspace;
using taocode::create_project;
using taocode::java_lsp_settings;
using taocode::project_destination;
using taocode::test::check;
using taocode::test::expect_error;
using taocode::test::get;
using taocode::test::names;
using taocode::test::NativeHandle;
using taocode::test::open_result;
using taocode::test::path_from;
using taocode::test::put;
using taocode::test::symlink;
using taocode::test::TempRoot;
using taocode::test::text;
using taocode::test::utf8;
constexpr std::size_t state_limit = 1024 * 1024;

std::string upper_ascii(std::string value) {
    for (auto& ch : value) {
        if (ch >= 'a' && ch <= 'z') ch = static_cast<char>(ch - 'a' + 'A');
    }
    return value;
}

// The real defaults, not a copy: a mirror drifts the moment a setting is added and
// then every migration assertion fails for no reason.
Json defaults() { return taocode::editor_defaults(); }
Json general_defaults() { return taocode::general_defaults(); }

Json default_todo_patterns() {
    // DefaultTodoDefaultPatternProvider.getDefaultPatterns 只发 todo/fixme 两条，正则逐字照抄。
    return Json::array({{{"pattern", "\\btodo\\b.*"}, {"description", "待办"}},
                        {{"pattern", "\\bfixme\\b.*"}, {"description", "需要修"}}});
}

Json empty_templates() {
    return {{"overrides", Json::array()}, {"customs", Json::array()}};
}

Json java_defaults() {
    // jdkName 存 IDEA 的 SDK 显示名（JdkUtil.suggestJdkName：`17`/`1.8`），jdt.ls 的
    // JavaSE-<x> 由 java_lsp_settings 的 normalize_runtime_name 在边界归一。
    return {{"jdkHome", ""}, {"jdkName", "17"}, {"sourcePaths", Json::array()},
            {"outputPath", ""}, {"referencedLibraries", Json::array({"lib/**/*.jar"})}};
}

Json export_to_html_defaults() {
    // IDEA `ExportToHTMLSettings.java:17-23`：三个布尔默认 false、OUTPUT_DIRECTORY 为空、printScope 默认 0。
    return {{"scope", 0}, {"includeSubdirectories", false}, {"printLineNumbers", false},
            {"openInBrowser", false}, {"outputDirectory", ""}};
}

Json build_tools_defaults() {
    // AutoImportProjectTrackerSettings.kt:16-26：无 DefaultAutoReloadTypeProvider 实现 ⇒ 默认 SELECTIVE。
    return {{"autoReloadType", "SELECTIVE"}, {"previousAutoReloadType", "SELECTIVE"},
            {"gradle", {{"useGradleFrom", "wrapper"}, {"gradlePath", ""}, {"gradleUserHome", ""},
                        // 「Gradle JVM」默认 = `ExternalSystemJdkUtil.USE_PROJECT_JDK`。
                        {"gradleJvm", "#USE_PROJECT_JDK"},
                        // 「构建并运行使用」默认交给 Gradle（`GradleProjectSettings.java:40`）。
                        {"delegatedBuild", true}, {"offline", false},
                        // 没链接过任何工程（`GradleSettings.linkedProjectsSettings` 空 ⇒ Gradle 工具窗口不可用）。
                        {"linkedProjects", Json::array()}}}};
}

Json exclusions() {
    // 与 ProjectStore 的 per-project 默认值逐键对齐（含默认列表本身）：
    // 少一个键，整对象比较就会失败，所以这里是 `project_defaults()` 的镜像。
    return {{"excludedDirs", Json::array({".git", "node_modules", "build", "dist"})},
            {"runConfigs", Json::array()}, {"bookmarks", Json::array()},
            {"scopes", Json::array()},
            // 文件颜色（IDEA `com.intellij.ui.tabs` 的 File Colors）：默认空，与 FileColorsModel 的两个空列表一致。
            {"fileColors", Json::array()}, {"localFileColors", Json::array()},
            {"bookmarksView", {{"groupLineBookmarks", true}, {"autoscrollToSource", false},
                               {"autoscrollFromSource", false}}},
            {"vcsLog", {{"showTagNames", true}, {"showRootNames", true}}},
            {"todoPatterns", default_todo_patterns()},
            {"templates", empty_templates()}, {"java", java_defaults()},
            {"fileAssociations", Json::object()},
            {"buildTools", build_tools_defaults()},
            // 导出到 HTML 的设置也是项目级（IDEA ExportToHTMLSettings 存在 workspace.xml 那一侧）。
            {"exportToHtml", export_to_html_defaults()}};
}

Json document() {
    return {{"recentProjects", Json::array()}, {"settings", defaults()},
            {"lastProject", nullptr}, {"perProject", Json::object()}};
}

} // namespace

int main() {
    int passed = 0;
    int failures = 0;
    const auto run = [&](const char* name, auto&& operation) {
        try {
            operation();
            ++passed;
            std::cout << "PASS " << name << '\n';
        } catch (const std::exception& error) {
            ++failures;
            std::cerr << "FAIL " << name << ": " << error.what() << '\n';
        }
    };
    try {
        TempRoot temporary;
        const auto parent = temporary.path / fs::path(u8"中文 父目录");
        fs::create_directory(parent);

        run("UTF-8 destinations and real empty/cpp templates", [&] {
            const auto empty_name = utf8(u8"空白 项目");
            const auto cpp_name = utf8(u8"中文 C++ 项目 (demo)");
            const auto candidate = project_destination(parent / L".", empty_name);
            check(candidate.is_absolute() && !fs::exists(candidate), "Destination must be absolute and uncreated");
            check(text(candidate.filename()) == empty_name, "Destination must retain UTF-8 name");
            check(fs::equivalent(candidate.parent_path(), parent), "Canonical parent must identify original directory");
            const auto empty = create_project(parent, empty_name, "empty");
            check(empty == candidate && fs::is_directory(empty) && fs::is_empty(empty), "Empty template must be truly empty");
            const auto cpp = create_project(parent, cpp_name, "cpp");
            check(fs::is_directory(cpp), "C++ project must be created on disk");
            check(names(cpp) == std::vector<std::string>({"CMakeLists.txt", "main.cpp"}), "Only the two fixed template files may be created");
            check(get(cpp / "CMakeLists.txt") ==
                  "cmake_minimum_required(VERSION 3.20)\n"
                  "project(TaoProject LANGUAGES CXX)\n\n"
                  "add_executable(app main.cpp)\n"
                  "target_compile_features(app PRIVATE cxx_std_20)\n", "Safe, fixed CMake template must not interpolate project name");
            check(get(cpp / "main.cpp") ==
                  "#include <iostream>\n\n"
                  "int main() {\n"
                  "    std::cout << \"Hello, TaoCode!\\n\";\n"
                  "    return 0;\n"
                  "}\n", "C++ template must contain a complete main");
            check(open_result(cpp).at("name") == cpp_name, "Created project must be accepted by Workspace::open");
            const auto before = names(parent);
            expect_error("ALREADY_EXISTS", [&] { project_destination(parent, empty_name); });
            expect_error("ALREADY_EXISTS", [&] { create_project(parent, empty_name, "empty"); });
            expect_error("ALREADY_EXISTS", [&] { create_project(parent, cpp_name, "cpp"); });
            check(names(parent) == before, "No staging artifacts after success or duplicate rejection");
            put(parent / "existing-file", "keep this file");
            expect_error("ALREADY_EXISTS", [&] { project_destination(parent, "existing-file"); });
            expect_error("ALREADY_EXISTS", [&] { create_project(parent, "existing-file", "cpp"); });
            check(get(parent / "existing-file") == "keep this file", "Existing files must never be replaced");
        });

        run("Java projects create the exact source path advertised by the UI", [&] {
            const auto name = utf8(u8"Java 中文项目 (demo)");
            const auto project = create_project(parent, name, "java");
            check(names(project) == std::vector<std::string>({"src"}), "Java template must not create CMake or download build files");
            check(names(project / "src") == std::vector<std::string>({"Main.java"}), "Java source root contains Main.java");
            check(get(project / "src" / "Main.java") ==
                  "public class Main {\n"
                  "    public static void main(String[] args) {\n"
                  "        System.out.println(\"Hello, TaoCode!\");\n"
                  "    }\n"
                  "}\n", "The public class and file name must agree without interpolating project names");
            Workspace workspace;
            workspace.open(project);
            check(workspace.read("src/Main.java").at("content").get<std::string>().find("public class Main") == 0,
                  "The advertised editor path must be readable immediately");
            const auto before = names(parent);
            expect_error("ALREADY_EXISTS", [&] { create_project(parent, name, "java"); });
            check(names(parent) == before, "Duplicate Java creation must not leave staging directories");
        });

        run("invalid names parents namespaces and template kinds", [&] {
            const auto before = names(parent);
            const std::vector<std::string> invalid{
                "", ".", "..", "../escape", "..\\escape", "a/b", "a\\b", "C:relative", "a:stream",
                "a.", "a ", "NUL", "nul.txt", "CON", "con .txt", "CONIN$", "CONOUT$", "PRN",
                "AUX.txt", "COM1", "LPT9.log", utf8(u8"COM¹.txt"), utf8(u8"LPT²"), "a*", "a?",
                "a<", "a>", "a|", "a\"", "a\nb", std::string("a\0b", 3), std::string("\xC0\xAF", 2),
                std::string("a\x7f", 2), std::string(256, 'a')
            };
            for (const auto& name : invalid) {
                expect_error("INVALID_PATH", [&] { project_destination(parent, name); });
                expect_error("INVALID_PATH", [&] { create_project(parent, name, "empty"); });
            }
            expect_error("INVALID_PATH", [&] { project_destination({}, "valid"); });
            expect_error("INVALID_PATH", [&] { project_destination(parent / "..", "valid"); });
            expect_error("INVALID_PATH", [&] { project_destination(fs::path(L"\\\\?\\" + parent.native()), "valid"); });
            expect_error("INVALID_PATH", [&] { project_destination(fs::path(L"\\\\.\\C:\\"), "valid"); });
            expect_error("INVALID_PATH", [&] { project_destination(fs::path(L"\\??\\C:\\"), "valid"); });
            expect_error("INVALID_PATH", [&] { project_destination(fs::path(L"C:relative"), "valid"); });
            expect_error("NOT_FOUND", [&] { create_project(parent / "missing-parent", "valid", "empty"); });
            put(temporary.path / "parent-file", "not a directory");
            expect_error("NOT_DIRECTORY", [&] { project_destination(temporary.path / "parent-file", "valid"); });
            expect_error("INVALID_TEMPLATE", [&] { create_project(parent, "unknown-kind", "definitely-not-a-template"); });
            check(names(parent) == before, "Invalid requests cannot create files or staging directories");
        });

        run("crowded parents do not require Workspace enumeration", [&] {
            const auto crowded = temporary.path / "crowded";
            fs::create_directory(crowded);
            for (int i = 0; i != 2001; ++i) put(crowded / (std::to_string(i) + ".txt"), "");
            const auto expected = project_destination(crowded, "new-project");
            check(create_project(crowded, "new-project", "empty") == expected, "Crowded parent must not stop creation");
        });

        run("update_general mirrors GeneralSettings (ide.general.xml) validation and clamping", [&] {
            const auto file = temporary.path / "general.json";
            ProjectStore store(file);
            const auto defaults = general_defaults();
            check(defaults.at("reopenLastProject") == true && defaults.at("deleteToBin") == true
                  && defaults.at("autoSyncFiles") == true && defaults.at("backgroundSyncFiles") == true
                  && defaults.at("autoSaveFiles") == true && defaults.at("autoSaveIfInactive") == false
                  && defaults.at("isUseSafeWrite") == true && defaults.at("confirmExit") == true
                  && defaults.at("isShowWelcomeScreen") == true && defaults.at("confirmOpenNewProject2").is_null()
                  && defaults.at("processCloseConfirmation") == "ASK" && defaults.at("inactiveTimeout") == 15
                  && defaults.at("defaultProjectDirectory") == "",
                  "GeneralSettingsState data-class defaults (GeneralSettings.kt:227-266)");
            const auto updated = store.update_general({{"confirmExit", false}, {"processCloseConfirmation", "TERMINATE"},
                                                       {"confirmOpenNewProject2", 0}, {"inactiveTimeout", 999}});
            check(updated.at("confirmExit") == false && updated.at("processCloseConfirmation") == "TERMINATE"
                  && updated.at("confirmOpenNewProject2") == 0,
                  "Accepted keys merge onto the defaults");
            check(updated.at("inactiveTimeout") == 300, "inactiveTimeout clamps through SAVE_FILES_AFTER_IDLE_SEC.fit");
            check(updated.at("reopenLastProject") == true, "Untouched keys keep their defaults");
            check(Json::parse(get(file)).at("general") == updated, "General settings must actually reach disk");
            check(ProjectStore(file).update_general(Json({{"confirmOpenNewProject2", Json(nullptr)}})).at("confirmOpenNewProject2").is_null(),
                  "confirmOpenNewProject2 accepts null (OPEN_PROJECT_ASK default)");
            const Json bad[] = {
                {{"unknown", true}},
                {{"confirmExit", "yes"}},
                {{"processCloseConfirmation", "KILL"}},
                {{"confirmOpenNewProject2", 3}},
                {{"inactiveTimeout", "15"}},
                {{"defaultProjectDirectory", std::string(513, 'x')}},
            };
            for (const auto& patch : bad) expect_error("INVALID_SETTINGS", [&] { store.update_general(patch); });
            // A state file without "general" (older build) still loads and gains the key on first save.
            auto legacy = Json::parse(get(file));
            legacy.erase("general");
            put(file, legacy.dump());
            const auto merged = ProjectStore(file).update_general({{"deleteToBin", false}});
            check(merged.at("reopenLastProject") == true && merged.at("deleteToBin") == false,
                  "Missing general state falls back to the data-class defaults");
            legacy["general"] = {{"deleteToBin", false}};
            put(file, legacy.dump());
            const auto sparse = ProjectStore(file).update_general({{"confirmExit", false}});
            auto expected_general = general_defaults();
            expected_general["deleteToBin"] = false;
            expected_general["confirmExit"] = false;
            check(sparse == expected_general,
                  "A sparse legacy general component receives all defaults before a partial update");
        });

        run("defaults reads are side-effect free and first save creates config parents", [&] {
            const auto file = temporary.path / "application" / "nested" / "projects.json";
            const auto project = create_project(temporary.path, "default-project", "empty");
            ProjectStore store(file);
            const auto state = store.state();
            check(state == Json({{"recentProjects", Json::array()}, {"settings", defaults()}, {"lastProject", nullptr}}), "Exact public default state");
            check(store.project_settings(text(project)) == exclusions(), "Default per-project exclusions");
            check(!fs::exists(file.parent_path()), "Reads must not create configuration directories");
            const auto updated = store.update_settings({{"fontSize", 18}});
            check(updated.at("fontSize") == 18 && updated.size() == defaults().size() && !updated.contains("theme"),
                  "Update returns merged editor settings without theme");
            check(Json::parse(get(file)).at("settings") == updated, "Editor settings must actually reach disk");
            check(ProjectStore(file).state().at("settings") == updated, "New instance must load saved settings");
            check(fs::is_empty(project), "Configuration may not be stored in the user project");
        });

        run("recents canonical paths order case dedup persistence close and forget", [&] {
            const auto file = temporary.path / "recents.json";
            ProjectStore store(file);
            const auto a = create_project(temporary.path, utf8(u8"最近 项目 A"), "empty");
            const auto b = create_project(temporary.path, "Recent-B", "empty");
            put(a / "keep.txt", "user data");
            const auto opened_a = open_result(a);
            const auto opened_b = open_result(b);
            store.opened(opened_a);
            store.opened(opened_b);
            const auto root_a = opened_a.at("root").get<std::string>();
            const auto root_b = opened_b.at("root").get<std::string>();
            auto recent = store.state().at("recentProjects");
            check(recent.size() == 2 && recent[0].at("path") == root_b && recent[1].at("path") == root_a, "Most recently opened must be first");
            check(recent[0].contains("activationTimestamp") && recent[0].at("activationTimestamp").is_number_integer()
                  && recent[0].at("activationTimestamp").get<int64_t>() > 0, "RecentProjectMetaInfo.activationTimestamp must be set on open");
            check(!recent[0].contains("displayName") || recent[0].at("displayName").is_string(),
                  "displayName is optional but must be a string when present");
            store.opened(open_result(path_from(upper_ascii(root_a))));
            auto state = store.state();
            recent = state.at("recentProjects");
            check(recent.size() == 2 && fs::equivalent(path_from(recent[0].at("path").get<std::string>()), a), "Windows case variants must deduplicate and move to front");
            for (const auto& item : recent) {
                const auto path = path_from(item.at("path").get<std::string>());
                const auto timestamp = item.at("lastOpened").get<std::string>();
                check(path.is_absolute() && item.at("path").get<std::string>().find('\\') == std::string::npos, "Recent paths must be absolute canonical UTF-8 with portable separators");
                check(timestamp.size() == 20 && timestamp[10] == 'T' && timestamp.back() == 'Z', "lastOpened must be UTC ISO8601");
                check(item.at("available") == true, "Existing projects must be available");
                check(item.contains("activationTimestamp") && item.at("activationTimestamp").is_number_integer(),
                      "Every saved recent must carry activationTimestamp");
            }
            check(ProjectStore(file).state() == state, "Recents must survive reconstruction");
            store.closed();
            check(store.state().at("lastProject").is_null() && store.state().at("recentProjects") == recent, "Close only clears lastProject");
            check(ProjectStore(file).state().at("lastProject").is_null(), "Close must persist");
            store.opened(opened_a);
            const auto forgotten = store.forget(upper_ascii(root_a));
            check(forgotten.at("recentProjects").size() == 1 && forgotten.at("recentProjects")[0].at("path") == root_b, "Forget is case insensitive");
            check(forgotten.at("lastProject").is_null(), "A forgotten last project must not be restored");
            check(get(a / "keep.txt") == "user data" && fs::is_directory(a), "Forget must never delete user files");
            check(ProjectStore(file).state() == forgotten, "Forget must persist");
            fs::remove_all(b);
            check(store.state().at("recentProjects")[0].at("available") == false, "Deleted directories remain recent but unavailable");
            check(ProjectStore(file).state().at("recentProjects")[0].at("available") == false, "Availability must be recomputed when loading");
            check(store.forget(root_b).at("recentProjects").empty(), "Unavailable projects can be forgotten");
        });

        run("forget_many mirrors removePath fan-out under one stateLock", [&] {
            const auto file = temporary.path / "forget-many.json";
            ProjectStore store(file);
            const auto a = create_project(temporary.path, "batch-a", "empty");
            const auto b = create_project(temporary.path, "batch-b", "empty");
            const auto c = create_project(temporary.path, "batch-c", "empty");
            store.opened(open_result(a));
            store.opened(open_result(b));
            store.opened(open_result(c));
            const auto ra = open_result(a).at("root").get<std::string>();
            const auto rb = open_result(b).at("root").get<std::string>();
            const auto rc = open_result(c).at("root").get<std::string>();
            put(a / "keep.txt", "user data");
            put(b / "keep.txt", "user data");
            put(c / "keep.txt", "user data");
            auto initial = store.state().at("recentProjects");
            check(initial.size() == 3, "Three recents before removal");
            const auto result = store.forget_many({ upper_ascii(ra), rb });
            const auto& remaining = result.at("recentProjects");
            check(remaining.size() == 1 && remaining[0].at("path") == rc,
                  "forget_many drops both and keeps the unmentioned entry");
            check(result.at("lastProject").is_string() && fs::equivalent(path_from(result.at("lastProject").get<std::string>()), c), "lastProject survives when not in the removal set");
            check(get(a / "keep.txt") == "user data" && get(b / "keep.txt") == "user data" && get(c / "keep.txt") == "user data", "forget_many never deletes user files");
            check(ProjectStore(file).state().at("recentProjects").size() == 1, "forget_many persists");
            const auto empty = store.forget_many({});
            check(empty.at("recentProjects").size() == 1, "forget_many with an empty set is a no-op");
            const auto case_variant = store.forget_many({ upper_ascii(rc) });
            check(case_variant.at("recentProjects").empty() && case_variant.at("lastProject").is_null(), "forget_many clears lastProject when it is in the removal set");
        });

        run("RecentProjectMetaInfo fields round-trip on disk", [&] {
            const auto file = temporary.path / "meta.json";
            ProjectStore store(file);
            const auto path = create_project(temporary.path, "meta-1", "empty");
            Json opened = open_result(path);
            opened["displayName"] = "Meta One — combined";
            opened["projectName"] = "meta-1-custom";
            opened["branch"] = "feature/MetaInfo";
            store.opened(opened);
            const auto recent = store.state().at("recentProjects").at(0);
            check(recent.at("displayName") == "Meta One — combined", "displayName must persist on open");
            check(recent.at("projectName") == "meta-1-custom", "projectName (customProjectName) must persist");
            check(recent.at("branchName") == "feature/MetaInfo", "branchName must persist");
            check(recent.at("activationTimestamp").get<int64_t>() > 0, "activationTimestamp must be a positive epoch");
            const auto reloaded = ProjectStore(file).state().at("recentProjects").at(0);
            check(reloaded.at("displayName") == "Meta One — combined", "displayName must survive a reload");
            check(reloaded.at("projectName") == "meta-1-custom", "projectName must survive a reload");
            check(reloaded.at("branchName") == "feature/MetaInfo", "branchName must survive a reload");
        });

        run("recents are capped at thirty and invalid opens are transactional", [&] {
            const auto file = temporary.path / "cap.json";
            ProjectStore store(file);
            for (int i = 0; i != 32; ++i) {
                const auto path = create_project(temporary.path, "cap-" + std::to_string(i), "empty");
                store.opened(open_result(path));
            }
            const auto before = store.state();
            const auto& recent = before.at("recentProjects");
            check(recent.size() == 30 && recent[0].at("name") == "cap-31" && recent[29].at("name") == "cap-2", "Only thirty newest projects may remain");
            const auto bytes = get(file);
            expect_error("INVALID_ARGUMENT", [&] { store.opened(Json::object()); });
            auto invalid = open_result(temporary.path / "cap-0");
            invalid["root"] = text(temporary.path / "not-here");
            expect_error("NOT_FOUND", [&] { store.opened(invalid); });
            check(store.state() == before && get(file) == bytes, "Failed open may not change persisted or observed state");
        });

        run("editor and per-project settings persist independently with strict validation", [&] {
            const auto file = temporary.path / "settings.json";
            ProjectStore first(file);
            ProjectStore second(file);
            const auto a = create_project(temporary.path, "settings-a", "empty");
            const auto b = create_project(temporary.path, "settings-b", "empty");
            const auto root_a = open_result(a).at("root").get<std::string>();
            const auto root_b = open_result(b).at("root").get<std::string>();
            first.opened(open_result(a));
            const auto editor = first.update_settings({{"fontSize", 32}, {"tabSize", 8}, {"wordWrap", true},
                                                        {"lineNumbers", false}, {"showIndentGuides", true}, {"tabLimit", 12}});
            check(editor.at("tabLimit") == 12, "tabLimit round-trips through the settings patch");
            check(second.state().at("settings") == editor, "Already-created store instances must not have stale caches");
            const Json custom = {{"excludedDirs", Json::array({".git", utf8(u8"临时 目录"), "out"})},
                                 {"runConfigs", Json::array({{{"name", utf8(u8"构建")}, {"command", "cmake --build build"},
                                                              {"allowRunningInParallel", true}}})},
                                 {"bookmarks", Json::array({{{"path", "src/main.cpp"}, {"line", 7}, {"mnemonic", 2}}})},
                                 {"scopes", Json::array()},
                                 // 文件颜色（IDEA `FileColorsConfigurable`）：整表替换，顺序即优先级。
                                 {"fileColors", Json::array()}, {"localFileColors", Json::array()},
                                 {"bookmarksView", {{"groupLineBookmarks", true}, {"autoscrollToSource", false},
                                                    {"autoscrollFromSource", false}}},
                                 {"vcsLog", {{"showTagNames", true}, {"showRootNames", true}}},
                                 {"todoPatterns", Json::array({{{"pattern", "REVIEW"}, {"description", utf8(u8"待评审")}}})},
                                 {"templates", empty_templates()}, {"java", java_defaults()},
                                 {"fileAssociations", {{"conf", "typescript"}}},
                                 // 构建工具是项目级的（IDEA `build.tools` + Gradle 页），整对象比较要带上它。
                                 {"buildTools", {{"autoReloadType", "SELECTIVE"}, {"previousAutoReloadType", "ALL"},
                                                 {"gradle", {{"useGradleFrom", "path"}, {"gradlePath", "C:/gradle/bin/gradle.bat"},
                                                    {"gradleUserHome", "D:/gradle-home"}, {"gradleJvm", "#USE_PROJECT_JDK"}, {"delegatedBuild", false}, {"offline", true},
                                                    // 没在这份补丁里 ⇒ 按缺键补默认（老项目文件不会因此判损坏）。
                                                    {"linkedProjects", Json::array()}}}}},
                                 {"exportToHtml", {{"scope", 4}, {"includeSubdirectories", true},
                                                   {"printLineNumbers", true}, {"openInBrowser", true},
                                                   {"outputDirectory", "D:/export"}}}};
            check(second.update_project_settings(upper_ascii(root_a), custom) == custom, "Project update must return merged settings");
            check(first.project_settings(root_a) == custom && first.project_settings(root_b) == exclusions(), "Per-project settings must be isolated and case-insensitive");
            first.update_project_settings(root_b, {{"excludedDirs", Json::array()}});
            check(second.project_settings(root_b).at("excludedDirs").empty(), "Empty exclusion arrays are valid");
            check(ProjectStore(file).project_settings(root_a) == custom, "Per-project settings must persist");
            const auto disk = Json::parse(get(file));
            check(disk.at("perProject").size() == 2 && disk.at("settings") == editor, "Application settings remain in the application state file");
            check(fs::exists(a / ".idea" / "workspace.xml") && fs::exists(a / ".idea" / "fileColors.xml") && fs::is_empty(b),
                  "Explicit color patches use IDEA XML; unrelated project settings create no XML");
            check(!first.state().contains("perProject"), "Internal perProject map is not part of public state()");
            const auto before = get(file);
            const auto before_state = first.state();
            const std::vector<Json> bad_editor{
                nullptr, Json::array(), {{"theme", "dark"}}, {{"fontSize", 3}}, {{"fontSize", 41}},
                {{"fontSize", 14.0}}, {{"fontSize", "14"}}, {{"fontSize", true}},
                {{"fontSize", (std::numeric_limits<std::uint64_t>::max)()}},
                {{"tabSize", 3}}, {{"tabSize", 2.0}}, {{"wordWrap", 1}}, {{"lineNumbers", nullptr}},
                {{"showIndentGuides", "true"}}, {{"fontSize", 12}, {"unknown", true}},
                {{"tabLimit", 0}}, {{"tabLimit", 101}}, {{"tabLimit", "30"}}, {{"tabLimit", 8.5}},
                // 面包屑（BreadcrumbsConfigurableUI.kt:44-70）：位置只有上下两个值。
                // 'disabled' 是旧版的第三态，源码里「不显示」是 showBreadcrumbs 单独的开关；
                // 旧文件由前端 normalizeEditorSettings 迁移，补丁里再出现就是无效值。
                {{"breadcrumbsPlacement", "disabled"}}, {{"breadcrumbsPlacement", "left"}},
                {{"breadcrumbsPlacement", 1}}, {{"breadcrumbsPlacement", nullptr}},
                // mapLanguageBreadcrumbs：键必须是已知语言 id，值是布尔。
                {{"breadcrumbsLanguages", Json::array()}}, {{"breadcrumbsLanguages", "java"}},
                {{"breadcrumbsLanguages", {{"kotlin", true}}}},
                {{"breadcrumbsLanguages", {{"java", "yes"}}}},
                {{"breadcrumbsLanguages", {{"java", nullptr}}}},
                {{"showStickyLines", "true"}}, {{"stickyLinesLimit", 11}}, {{"stickyLinesLimit", -1}},
                {{"diffContextLines", 0}}, {{"diffContextLines", 101}}
            };
            for (const auto& patch : bad_editor) expect_error("INVALID_SETTINGS", [&] { first.update_settings(patch); });
            const std::vector<Json> bad_project{
                nullptr, Json::array(), {{"fontSize", 20}}, {{"excludedDirs", ".git"}},
                {{"excludedDirs", Json::array({1})}}, {{"excludedDirs", Json::array({nullptr})}},
                {{"excludedDirs", Json::array({""})}}, {{"excludedDirs", Json::array({"."})}},
                {{"excludedDirs", Json::array({".."})}}, {{"excludedDirs", Json::array({"a/b"})}},
                {{"excludedDirs", Json::array({"a\\b"})}}, {{"excludedDirs", Json::array({"C:\\a"})}},
                {{"excludedDirs", Json::array({"NUL"})}}, {{"excludedDirs", Json::array({"COM1.txt"})}},
                {{"excludedDirs", Json::array({"a."})}}, {{"excludedDirs", Json::array({"a "})}},
                {{"excludedDirs", Json::array({"a:b"})}}, {{"excludedDirs", Json::array({"a*"})}},
                {{"excludedDirs", Json::array({"a\nb"})}},
                {{"excludedDirs", Json::array({std::string("a\0b", 3)})}},
                {{"excludedDirs", Json::array({std::string("\xC0\xAF", 2)})}},
                {{"fileAssociations", Json::array()}}, {{"fileAssociations", "conf"}},
                {{"fileAssociations", {{"conf", "kotlin"}}}}, {{"fileAssociations", {{"conf", 7}}}},
                {{"fileAssociations", {{"Conf", "java"}}}}, {{"fileAssociations", {{"", "java"}}}},
                {{"fileAssociations", {{"a/b", "java"}}}}, {{"fileAssociations", {{std::string(17, 'a'), "java"}}}},
                // 构建工具（IDEA `build.tools`）：三档枚举名是大写，Gradle 三项各有值域。
                {{"buildTools", Json::array()}}, {{"buildTools", "ALL"}},
                {{"buildTools", {{"autoReloadType", "all"}}}}, {{"buildTools", {{"autoReloadType", 1}}}},
                {{"buildTools", {{"autoReloadType", nullptr}}}}, {{"buildTools", {{"autoReloadType", "OFF"}}}},
                {{"buildTools", {{"previousAutoReloadType", "always"}}}}, {{"buildTools", {{"unknown", true}}}},
                {{"buildTools", {{"gradle", "wrapper"}}}},
                {{"buildTools", {{"gradle", {{"useGradleFrom", "remote"}}}}}},
                {{"buildTools", {{"gradle", {{"useGradleFrom", "Wrapper"}}}}}},
                {{"buildTools", {{"gradle", {{"gradlePath", 7}}}}}},
                {{"buildTools", {{"gradle", {{"gradleUserHome", nullptr}}}}}},
                {{"buildTools", {{"gradle", {{"gradlePath", std::string(513, 'a')}}}}}},
                {{"buildTools", {{"gradle", {{"offline", "yes"}}}}}},
                {{"buildTools", {{"gradle", {{"unknown", 1}}}}}},
                // 导出到 HTML（IDEA ExportToHTMLSettings）：范围只允许 0/1/2/4，其余字段各有类型。
                {{"exportToHtml", Json::array()}}, {{"exportToHtml", "file"}},
                // 运行配置的「允许并行运行多个实例」只能是布尔（IDEA RunConfigurationOptions.kt:54-56）。
                {{"runConfigs", Json::array({{{"name", "x"}, {"command", "y"}, {"allowRunningInParallel", "yes"}}})}},
                {{"runConfigs", Json::array({{{"name", "x"}, {"command", "y"}, {"allowRunningInParallel", 1}}})}},
                {{"exportToHtml", {{"scope", 3}}}}, {{"exportToHtml", {{"scope", "1"}}}},
                {{"exportToHtml", {{"scope", nullptr}}}}, {{"exportToHtml", {{"scope", 5}}}},
                {{"exportToHtml", {{"includeSubdirectories", 1}}}},
                {{"exportToHtml", {{"printLineNumbers", "yes"}}}},
                {{"exportToHtml", {{"openInBrowser", 0}}}},
                {{"exportToHtml", {{"outputDirectory", 7}}}},
                {{"exportToHtml", {{"outputDirectory", nullptr}}}},
                {{"exportToHtml", {{"outputDirectory", std::string(513, 'a')}}}},
                {{"exportToHtml", {{"unknown", true}}}}
            };
            for (const auto& patch : bad_project) expect_error("INVALID_SETTINGS", [&] { second.update_project_settings(root_a, patch); });
            expect_error("INVALID_PATH", [&] { first.update_project_settings("relative", custom); });
            check(get(file) == before && first.state() == before_state && first.project_settings(root_a) == custom, "Rejected patches must not pollute any settings");

            // 合法的面包屑补丁必须能存下来（默认位置是「下方」，见 EditorSettingsExternalizable.OptionSet:91）。
            // 这一段必须落在上面的「拒绝的补丁不能污染任何设置」之后：它确实会写盘。
            const auto crumbs = first.update_settings({{"showBreadcrumbs", false}, {"breadcrumbsPlacement", "top"},
                                                       {"breadcrumbsLanguages", {{"java", false}, {"cpp", true}}}});
            check(crumbs.at("breadcrumbsPlacement") == "top" && crumbs.at("breadcrumbsLanguages").at("java") == false,
                  "Breadcrumb flags must round-trip");
            check(first.update_settings({{"breadcrumbsPlacement", "bottom"}}).at("breadcrumbsLanguages").at("cpp") == true,
                  "Patching the placement must not drop the per-language table");
            first.forget(root_a);
            check(second.project_settings(root_a) == custom, "Forgetting a recent project must not discard its settings");
            // 构建工具的局部补丁必须**合并**而不是整块替换（merge_patch）：只改自动重载那一档时，
            // Gradle 的三项要原样留着 —— 否则「关掉自动重载」会把「用哪个 Gradle」一起清掉。
            const auto partial = second.update_project_settings(root_a, {{"buildTools", {{"autoReloadType", "NONE"}, {"previousAutoReloadType", "SELECTIVE"}}}});
            check(partial.at("buildTools").at("autoReloadType") == "NONE", "autoReloadType patch must land");
            check(partial.at("buildTools").at("gradle") == custom.at("buildTools").at("gradle"),
                  "A partial buildTools patch must not drop the Gradle settings");
            check(second.update_project_settings(root_a, {{"buildTools", {{"autoReloadType", "SELECTIVE"}, {"previousAutoReloadType", "ALL"}}}})
                    .at("buildTools") == custom.at("buildTools"),
                  "Restoring the reload type must return the whole buildTools block");
            check(first.update_settings({{"fontSize", 4}, {"tabSize", 2}}).at("fontSize") == 4, "Lower font boundary and tab size two are valid");
            check(first.update_settings({{"tabSize", 4}}).at("tabSize") == 4, "Tab size four is valid");
            ProjectStore isolated(temporary.path / "isolated.json");
            check(isolated.state().at("settings") == defaults() && isolated.project_settings(root_a) == exclusions(), "Application settings are isolated; this project's XML color lists are empty");
        });

        run("failed atomic replacement preserves all old state and removes owned temporaries", [&] {
            const auto directory = temporary.path / "locked-state";
            fs::create_directory(directory);
            const auto file = directory / "projects.json";
            ProjectStore store(file);
            const auto a = create_project(temporary.path, "locked-a", "empty");
            const auto b = create_project(temporary.path, "locked-b", "empty");
            const auto opened_a = open_result(a);
            const auto opened_b = open_result(b);
            const auto root = opened_a.at("root").get<std::string>();
            store.opened(opened_a);
            store.update_project_settings(root, {{"excludedDirs", Json::array({"private"})}});
            const auto old_state = store.state();
            const auto old_settings = store.project_settings(root);
            const auto old_bytes = get(file);
            const auto old_names = names(directory);
            {
                NativeHandle blocker{CreateFileW(file.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                                                  nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr)};
                check(blocker.value != INVALID_HANDLE_VALUE, "Cannot create delete-sharing blocker");
                expect_error("FILE_BUSY", [&] { store.opened(opened_b); });
                expect_error("FILE_BUSY", [&] { store.closed(); });
                expect_error("FILE_BUSY", [&] { store.forget(root); });
                expect_error("FILE_BUSY", [&] { store.update_settings({{"fontSize", 18}}); });
                expect_error("FILE_BUSY", [&] { store.update_project_settings(root, {{"excludedDirs", Json::array()}}); });
                check(get(file) == old_bytes && store.state() == old_state && store.project_settings(root) == old_settings,
                      "All failed saves must retain the old file and observable in-memory state");
                const auto now_names = names(directory);
                std::string dump;
                for (const auto& name : now_names) if (std::find(old_names.begin(), old_names.end(), name) == old_names.end()) dump += " [+" + name + "]";
                for (const auto& name : old_names) if (std::find(now_names.begin(), now_names.end(), name) == now_names.end()) dump += " [-" + name + "]";
                check(now_names == old_names, "Failed saves must clean up their own temporary files" + dump);
            }
            store.opened(opened_b);
            check(store.state().at("lastProject") == opened_b.at("root"), "Store must remain usable after failed replacement");
        });

        run("corrupt configuration is reported and never silently overwritten", [&] {
            const auto file = temporary.path / "corrupt.json";
            const auto project = create_project(temporary.path, "corrupt-project", "empty");
            const auto opened = open_result(project);
            const auto root = opened.at("root").get<std::string>();
            ProjectStore store(file);
            store.opened(opened);
            const auto valid = Json::parse(get(file));
            std::vector<std::string> bad{"", "{", "[]", "{}", "null", "{\"settings\":{},\"settings\":{}}", std::string("\xFF", 1)};
            // 注意：**未知键不再算损坏** —— 那是升级路径（旧版本写过、新版本删掉的键）而不是脏数据，
            // 对齐 IDEA 的 XmlSerializer（忽略未知标签）。它现在被断言在“legacy 键被剪掉”那条用例里。
            auto invalid = valid;
            invalid["settings"]["fontSize"] = 14.5;
            bad.push_back(invalid.dump());
            invalid = valid;
            invalid["recentProjects"][0]["path"] = "../outside";
            bad.push_back(invalid.dump());
            invalid = valid;
            invalid["recentProjects"][0]["lastOpened"] = "2025-02-30T00:00:00Z";
            bad.push_back(invalid.dump());
            invalid = valid;
            invalid["recentProjects"].push_back(invalid["recentProjects"][0]);
            bad.push_back(invalid.dump());
            invalid = valid;
            invalid["lastProject"] = 123;
            bad.push_back(invalid.dump());
            invalid = valid;
            invalid["perProject"][root] = {{"excludedDirs", Json::array({"../escape"})}};
            bad.push_back(invalid.dump());
            bad.push_back(std::string(state_limit + 1, ' '));
            bad.push_back(std::string(40, '[') + "0" + std::string(40, ']'));
            for (const auto& bytes : bad) {
                put(file, bytes);
                expect_error("STATE_CORRUPT", [&] { store.state(); });
                expect_error("STATE_CORRUPT", [&] { store.opened(opened); });
                expect_error("STATE_CORRUPT", [&] { store.closed(); });
                expect_error("STATE_CORRUPT", [&] { store.forget(root); });
                expect_error("STATE_CORRUPT", [&] { store.update_settings({{"fontSize", 16}}); });
                expect_error("STATE_CORRUPT", [&] { store.project_settings(root); });
                expect_error("STATE_CORRUPT", [&] { store.update_project_settings(root, {{"excludedDirs", Json::array()}}); });
                check(get(file) == bytes, "Every corrupt original must be preserved byte-for-byte");
            }
            put(file, valid.dump());
            check(store.state().at("lastProject") == root, "Explicitly repairing the file must make it usable again");
        });

        // The real failure this guards against: a settings.json written by an earlier
        // build lacks keys added later, which must not lock the user out of every
        // project operation.
        run("settings from an older build are migrated instead of rejected", [&] {
            const auto file = temporary.path / "legacy-settings.json";
            Json legacy = document();
            legacy["settings"].erase("syncOnFocus");
            legacy["settings"].erase("tabLimit");
            put(file, legacy.dump());
            ProjectStore store(file);
            check(store.state().at("settings") == defaults(), "the absent key takes its default");
            check(get(file) == legacy.dump(), "a read must not rewrite the user's file");
            const auto created = create_project(temporary.path, "legacy-project", "empty");
            store.opened(open_result(created));
            check(store.state().at("recentProjects").size() == 1, "writing after a migrated read still works");
            // 反方向的情形：文件里带着**当前版本已经删掉的键**（真事：`syncOnFocus` /
            // `deleteToTrash` / `restoreLastProject` / `autoSave` 都在搬去 GeneralSettings 时删过）。
            // 读盘必须照样成功并把这些键剪掉，否则升级一次就会让用户看到
            // "The saved configuration is invalid; the original file was kept." ——
            // IDEA 的 XmlSerializer 对未知标签是忽略，不是报错。
            Json outdated = document();
            outdated["settings"]["theme"] = "dark";          // 曾经的编辑器键，现在不认识了
            outdated["settings"]["syncOnFocus"] = true;
            outdated["settings"]["deleteToTrash"] = true;
            outdated["settings"]["autoSave"] = true;
            outdated["settings"]["restoreLastProject"] = true;
            outdated["general"] = {{"legacyKeyFromAnOlderBuild", 1}};
            put(file, outdated.dump());
            ProjectStore upgraded(file);
            check(upgraded.state().at("settings") == defaults(), "被删掉的键被剪掉，其余取默认值");
            check(!upgraded.state().at("settings").contains("syncOnFocus"), "剪枝后不再出现该键");
            check(upgraded.state().at("general").contains("legacyKeyFromAnOlderBuild") == false,
                  "general 里的未知键同样被剪掉");
            check(get(file) == outdated.dump(), "剪枝发生在内存里，不重写用户的文件");
            Json broken = document();
            broken["settings"]["fontSize"] = "14";
            put(file, broken.dump());
            expect_error("STATE_CORRUPT", [&] { ProjectStore(file).state(); });
        });

        run("run configurations are stored with the project that owns them", [&] {
            // Same cap as projects.cpp; the store owns the number, the test repeats it.
            constexpr std::size_t config_limit = 40;
            const auto file = temporary.path / "run-configs.json";
            ProjectStore store(file);
            const auto a = create_project(temporary.path, "configs-a", "empty");
            const auto b = create_project(temporary.path, "configs-b", "empty");
            const auto root_a = open_result(a).at("root").get<std::string>();
            const auto root_b = open_result(b).at("root").get<std::string>();
            store.opened(open_result(a));
            const Json configs = Json::array({{{"name", utf8(u8"构建")}, {"command", "cmake --build build"}},
                                              {{"name", "test"}, {"command", "ctest"}, {"type", "debug"}}});
            check(store.update_project_settings(root_a, {{"runConfigs", configs}}).at("runConfigs") == configs,                  "Run configurations must round-trip with their own text");
            check(store.project_settings(root_b).at("runConfigs").empty(),
                  "A second project must not inherit another project's commands");
            // 文件夹（IDEA RunConfigurable 的 FOLDER 节点）随配置一起存下来。
            const Json grouped = Json::array({{{"name", "fmt"}, {"command", "clang-format -i src/x.cpp"}, {"folder", utf8(u8"格式化")}}});
            check(store.update_project_settings(root_a, {{"runConfigs", grouped}}).at("runConfigs") == grouped,
                  "A run configuration keeps its folder");
            store.update_project_settings(root_a, {{"runConfigs", configs}});
            store.update_project_settings(root_a, {{"excludedDirs", Json::array({"out"})}});
            check(store.project_settings(root_a).at("runConfigs") == configs,
                  "Patching exclusions must not drop the run configurations");
            check(ProjectStore(file).project_settings(root_a).at("runConfigs") == configs,
                  "Run configurations live in the one application state file");
            const std::vector<Json> rejected{
                {{"runConfigs", nullptr}},
                {{"runConfigs", Json::object()}},
                {{"runConfigs", Json::array({Json::object()})}},
                {{"runConfigs", Json::array({{{"name", "build"}}})}},
                {{"runConfigs", Json::array({{{"command", "cmake"}}})}},
                {{"runConfigs", Json::array({{{"name", ""}, {"command", "cmake"}}})}},
                {{"runConfigs", Json::array({{{"name", "build"}, {"command", ""}}})}},
                {{"runConfigs", Json::array({{{"name", "build"}, {"command", "cmake"}, {"kind", "shell"}}})}},
                {{"runConfigs", Json::array({{{"name", "build"}, {"command", "cmake"}, {"type", "terminal"}}})}},
                // folder 对应 RunConfigurable 的文件夹节点：≤80 字节、单行、UTF-8。
                {{"runConfigs", Json::array({{{"name", "build"}, {"command", "cmake"}, {"folder", 7}}})}},
                {{"runConfigs", Json::array({{{"name", "build"}, {"command", "cmake"}, {"folder", std::string(81, 'f')}}})}},
                {{"runConfigs", Json::array({{{"name", "build"}, {"command", "cmake"}, {"folder", "a\nb"}}})}},
                {{"runConfigs", Json::array({{{"name", "build"}, {"command", "cmake"}, {"folder", std::string("\xC0\xAF", 2)}}})}},
                {{"runConfigs", Json::array({{{"name", "build"}, {"command", "cmake"}, {"type", 3}}})}},
                {{"runConfigs", Json::array({{{"name", 5}, {"command", "cmake"}}})}},
                {{"runConfigs", Json::array({{{"name", "build"}, {"command", "cmake"}},
                                             {{"name", "build"}, {"command", "ctest"}}})}},
                {{"runConfigs", Json::array({{{"name", std::string(81, 'n')}, {"command", "cmake"}}})}},
                {{"runConfigs", Json::array({{{"name", "build"}, {"command", std::string(4097, 'c')}}})}},
                {{"runConfigs", Json::array({{{"name", "build"}, {"command", std::string("\xC0\xAF", 2)}}})}},
            };
            for (const auto& patch : rejected)
                expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root_a, patch); });
            Json too_many = Json::array();
            for (std::size_t i = 0; i != config_limit + 1; ++i)
                too_many.push_back({{"name", "config-" + std::to_string(i)}, {"command", "cmake"}});
            expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root_a, {{"runConfigs", too_many}}); });
            too_many.erase(config_limit);
            check(store.update_project_settings(root_a, {{"runConfigs", too_many}}).at("runConfigs").size() == config_limit,
                  "The largest accepted list must be usable");
            check(store.state().at("recentProjects").size() == 1 && store.project_settings(root_b).at("runConfigs").empty(),
                  "Rejected writes must leave the rest of the state intact");
            Json legacy = Json::parse(get(file));
            const std::string stored_key = legacy.at("perProject").begin().key();
            legacy["perProject"][stored_key] = {{"excludedDirs", Json::array({".git"})}};
            put(file, legacy.dump());
            ProjectStore migrated(file);
            check(migrated.project_settings(root_a).at("runConfigs").empty(),
                  "a project record written before run configurations existed takes the default");
            check(migrated.project_settings(root_a).at("fileAssociations").is_object(),
                  "the file-association map migrates as an empty object for old records");
            check(migrated.update_project_settings(root_a, {{"runConfigs", configs}}).at("runConfigs") == configs,
                  "the migrated record stays writable");
        });

        run("bookmarks and their mnemonics stay with the project", [&] {
            const auto file = temporary.path / "bookmarks.json";
            ProjectStore store(file);
            const auto a = create_project(temporary.path, "marks-a", "empty");
            const auto b = create_project(temporary.path, "marks-b", "empty");
            const auto root_a = open_result(a).at("root").get<std::string>();
            const auto root_b = open_result(b).at("root").get<std::string>();
            store.opened(open_result(a));
            const Json marks = Json::array({
                {{"path", "src/main.cpp"}, {"line", 12}},
                {{"path", utf8(u8"源文件/核心.cpp")}, {"line", 3}, {"mnemonic", 0}},
                {{"path", "src/app.vue"}, {"line", 88}, {"mnemonic", 9}}});
            check(store.update_project_settings(root_a, {{"bookmarks", marks}}).at("bookmarks") == marks,
                  "Bookmarks must round-trip with their digits");
            check(store.project_settings(root_b).at("bookmarks").empty(),
                  "A second project must keep its own bookmark list");
            store.update_project_settings(root_a, {{"runConfigs", Json::array({{{"name", "build"}, {"command", "cmake"}}})}});
            check(store.project_settings(root_a).at("bookmarks") == marks,
                  "Patching a different key must not lose the bookmarks");
            const std::vector<Json> rejected{
                {{"bookmarks", nullptr}},
                {{"bookmarks", Json::object()}},
                {{"bookmarks", Json::array({Json::object()})}},
                {{"bookmarks", Json::array({{{"line", 3}}})}},
                {{"bookmarks", Json::array({{{"path", ""}, {"line", 3}}})}},
                {{"bookmarks", Json::array({{{"path", "/abs/x.cpp"}, {"line", 3}}})}},
                {{"bookmarks", Json::array({{{"path", "src\\x.cpp"}, {"line", 3}}})}},
                {{"bookmarks", Json::array({{{"path", "../out.cpp"}, {"line", 3}}})}},
                {{"bookmarks", Json::array({{{"path", "a/../b.cpp"}, {"line", 3}}})}},
                {{"bookmarks", Json::array({{{"path", "src/x.cpp"}}})}},
                {{"bookmarks", Json::array({{{"path", "src/x.cpp"}, {"line", 0}}})}},
                {{"bookmarks", Json::array({{{"path", "src/x.cpp"}, {"line", 1000001}}})}},
                {{"bookmarks", Json::array({{{"path", "src/x.cpp"}, {"line", "3"}}})}},
                {{"bookmarks", Json::array({{{"path", "src/x.cpp"}, {"line", 3}, {"mnemonic", 10}}})}},
                {{"bookmarks", Json::array({{{"path", "src/x.cpp"}, {"line", 3}, {"mnemonic", -1}}})}},
                {{"bookmarks", Json::array({{{"path", "src/x.cpp"}, {"line", 3}, {"mnemonic", 3}, {"note", "x"}}})}},
                {{"bookmarks", Json::array({{{"path", "src/x.cpp"}, {"line", 3}, {"mnemonic", 2}},
                                            {{"path", "src/y.cpp"}, {"line", 4}, {"mnemonic", 2}}})}},
                {{"bookmarks", Json::array({{{"path", "src/x.cpp"}, {"line", 3}},
                                            {{"path", "src/x.cpp"}, {"line", 3}}})}},
                {{"bookmarks", Json::array({{{"path", std::string("\xC0\xAF", 2)}, {"line", 3}}})}},
                // bookmarksView（IDEA BookmarksViewState）：只接受三个有落点的布尔开关。
                {{"bookmarksView", Json::array()}}, {{"bookmarksView", "on"}},
                {{"bookmarksView", {{"groupLineBookmarks", "true"}}}},
                {{"bookmarksView", {{"groupLineBookmarks", 1}}}},
                {{"bookmarksView", {{"showPreview", true}}}},
                {{"bookmarksView", {{"askBeforeDeletingLists", true}}}},
            };
            for (const auto& patch : rejected)
                expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root_a, patch); });
            check(store.project_settings(root_a).at("bookmarks") == marks,
                  "Rejected bookmark writes must change nothing");
            // 正向：三个开关能存下来，并与默认值合并
            check(store.update_project_settings(root_a, {{"bookmarksView", {{"groupLineBookmarks", false}}}})
                      .at("bookmarksView").at("groupLineBookmarks") == false,
                  "A bookmarks-view toggle must round-trip");
            check(store.project_settings(root_a).at("bookmarksView").at("autoscrollToSource") == false,
                  "The other toggles keep their defaults");
            Json too_many = Json::array();
            for (std::size_t i = 0; i != 201; ++i) too_many.push_back({{"path", "src/x.cpp"}, {"line", i + 1}});
            expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root_a, {{"bookmarks", too_many}}); });
            too_many.erase(200);
            check(store.update_project_settings(root_a, {{"bookmarks", too_many}}).at("bookmarks").size() == 200,
                  "The largest accepted list must be usable");
            Json legacy = Json::parse(get(file));
            const std::string key = legacy.at("perProject").begin().key();
            legacy["perProject"][key] = {{"excludedDirs", Json::array({".git"})}, {"runConfigs", Json::array()},
                                         {"bookmarks", Json::array()}, {"todoPatterns", default_todo_patterns()}};
            put(file, legacy.dump());
            check(ProjectStore(file).project_settings(root_a).at("bookmarks").empty(),
                  "a project record written before bookmarks existed takes the default");
            check(ProjectStore(file).update_project_settings(root_a, {{"bookmarks", marks}}).at("bookmarks") == marks,
                  "the migrated record accepts the new key");
        });

        run("TODO markers belong to the project and migrate when absent", [&] {
            const auto file = temporary.path / "todo-patterns.json";
            ProjectStore store(file);
            const auto a = create_project(temporary.path, "todo-a", "empty");
            const auto b = create_project(temporary.path, "todo-b", "empty");
            const auto root_a = open_result(a).at("root").get<std::string>();
            const auto root_b = open_result(b).at("root").get<std::string>();
            store.opened(open_result(a));
            check(store.project_settings(root_a).at("todoPatterns") == default_todo_patterns(),
                  "A new project starts from the built-in markers");
            const Json custom = Json::array({{{"pattern", "REVIEW"}, {"description", utf8(u8"待评审")}},
                                             {{"pattern", "OPTIMIZE"}, {"description", "optimize"}}});
            check(store.update_project_settings(root_a, {{"todoPatterns", custom}}).at("todoPatterns") == custom,
                  "Project markers must round-trip with their descriptions");
            check(store.project_settings(root_b).at("todoPatterns") == default_todo_patterns(),
                  "Another project keeps its own marker list");
            store.update_project_settings(root_a, {{"bookmarks", Json::array({{{"path", "x.cpp"}, {"line", 1}}})}});
            check(store.project_settings(root_a).at("todoPatterns") == custom,
                  "Patching bookmarks must not reset the markers");
            const std::vector<Json> rejected{
                {{"todoPatterns", nullptr}},
                {{"todoPatterns", Json::object()}},
                {{"todoPatterns", Json::array({Json::object()})}},
                {{"todoPatterns", Json::array({{{"pattern", "TODO"}}})}},
                {{"todoPatterns", Json::array({{{"description", "x"}}})}},
                {{"todoPatterns", Json::array({{{"pattern", ""}, {"description", "x"}}})}},
                {{"todoPatterns", Json::array({{{"pattern", "TODO"}, {"description", ""}}})}},
                {{"todoPatterns", Json::array({{{"pattern", "TODO\nFIXME"}, {"description", "x"}}})}},
                {{"todoPatterns", Json::array({{{"pattern", std::string(201, 'T')}, {"description", "x"}}})}},
                {{"todoPatterns", Json::array({{{"pattern", "TODO"}, {"description", std::string(61, 'd')}}})}},
                {{"todoPatterns", Json::array({{{"pattern", "TODO"}, {"description", std::string("\xC0\xAF", 2)}}})}},
                {{"todoPatterns", Json::array({{{"pattern", "TODO"}, {"description", "a"}},
                                              {{"pattern", "TODO"}, {"description", "b"}}})}},
            };
            for (const auto& patch : rejected)
                expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root_a, patch); });
            Json many = Json::array();
            for (std::size_t i = 0; i != 21; ++i)
                many.push_back({{"pattern", "MARKER" + std::to_string(i)}, {"description", "d"}});
            expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root_a, {{"todoPatterns", many}}); });
            many.erase(20);
            check(store.update_project_settings(root_a, {{"todoPatterns", many}}).at("todoPatterns").size() == 20,
                  "The largest accepted list must be usable");
            Json legacy = Json::parse(get(file));
            const std::string key = legacy.at("perProject").begin().key();
            legacy["perProject"][key] = {{"excludedDirs", Json::array({".git"})},
                                         {"runConfigs", Json::array()}, {"bookmarks", Json::array()},
                                         {"todoPatterns", default_todo_patterns()}};
            put(file, legacy.dump());
            check(ProjectStore(file).project_settings(root_a).at("todoPatterns") == default_todo_patterns(),
                  "a project record written before TODO markers existed takes the defaults");
            check(ProjectStore(file).update_project_settings(root_a, {{"todoPatterns", custom}}).at("todoPatterns") == custom,
                  "the migrated record accepts the new key");
        });

        // 命名作用域（IDEA project.scopes + NamedScopesHolder.writeScope/readScope）。
        run("named scopes keep their order, their shared flag, and migrate when absent", [&] {
            const auto file = temporary.path / "scopes.json";
            ProjectStore store(file);
            const auto a = create_project(temporary.path, "scopes-a", "empty");
            const auto b = create_project(temporary.path, "scopes-b", "empty");
            const auto root_a = open_result(a).at("root").get<std::string>();
            const auto root_b = open_result(b).at("root").get<std::string>();
            store.opened(open_result(a));
            check(store.project_settings(root_a).at("scopes").empty(),
                  "A new project has no scopes (NamedScope.EMPTY_ARRAY)");

            const Json scopes = Json::array({
                {{"name", "Sources"}, {"pattern", "file:src//*"}, {"shared", false}},
                {{"name", "Headers"}, {"pattern", "file:**/*.h"}, {"shared", true}},
            });
            check(store.update_project_settings(root_a, {{"scopes", scopes}}).at("scopes") == scopes,
                  "Scopes must round-trip name, pattern and shared flag");
            check(store.project_settings(root_a).at("scopes").at(0).at("name") == "Sources",
                  "The stored array keeps the order myOrder has to preserve");
            check(store.project_settings(root_b).at("scopes").empty(), "Another project keeps its own scope list");
            store.update_project_settings(root_a, {{"bookmarks", Json::array()}});
            check(store.project_settings(root_a).at("scopes") == scopes, "Patching another key must not reset scopes");

            // 模式**语法**非法也要能存下来：readScope 捕获 ParsingException 后落到 InvalidPackageSet。
            const Json broken = Json::array({{{"name", "Broken"}, {"pattern", "file:*.cpp && file:*.h"}, {"shared", false}}});
            check(store.update_project_settings(root_a, {{"scopes", broken}}).at("scopes") == broken,
                  "An unparsable pattern is stored, exactly like InvalidPackageSet");
            // 空模式是合法的空作用域（NamedScopesHolder.java:129 写的是 setAttribute(PATTERN_ATT, "")）。
            const Json empty_pattern = Json::array({{{"name", "Blank"}, {"pattern", ""}, {"shared", false}}});
            check(store.update_project_settings(root_a, {{"scopes", empty_pattern}}).at("scopes") == empty_pattern,
                  "An empty pattern is the empty scope, not an error");
            store.update_project_settings(root_a, {{"scopes", scopes}});

            const std::vector<Json> rejected{
                {{"scopes", nullptr}},
                {{"scopes", Json::object()}},
                {{"scopes", Json::array({Json::object()})}},
                {{"scopes", Json::array({{{"pattern", "file:a"}, {"shared", false}}})}},
                {{"scopes", Json::array({{{"name", ""}, {"pattern", "file:a"}, {"shared", false}}})}},
                {{"scopes", Json::array({{{"name", std::string(81, 'n')}, {"pattern", "file:a"}, {"shared", false}}})}},
                {{"scopes", Json::array({{{"name", "a\nb"}, {"pattern", "file:a"}, {"shared", false}}})}},
                {{"scopes", Json::array({{{"name", std::string("\xC0\xAF", 2)}, {"pattern", "file:a"}, {"shared", false}}})}},
                {{"scopes", Json::array({{{"name", "Big"}, {"pattern", std::string(1025, 'p')}, {"shared", false}}})}},
                {{"scopes", Json::array({{{"name", "Bad"}, {"pattern", std::string("\xC0\xAF", 2)}, {"shared", false}}})}},
                {{"scopes", Json::array({{{"name", 7}, {"pattern", "file:a"}, {"shared", false}}})}},
                {{"scopes", Json::array({{{"name", "NoFlag"}, {"pattern", "file:a"}}})}},
                {{"scopes", Json::array({{{"name", "Flag"}, {"pattern", "file:a"}, {"shared", "yes"}}})}},
                {{"scopes", Json::array({{{"name", "Extra"}, {"pattern", "file:a"}, {"shared", false}, {"owner", "x"}}})}},
                {{"scopes", Json::array({{{"name", "Same"}, {"pattern", "file:a"}, {"shared", false}},
                                        {{"name", "Same"}, {"pattern", "file:b"}, {"shared", true}}})}},
            };
            for (const auto& patch : rejected)
                expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root_a, patch); });
            check(store.project_settings(root_a).at("scopes") == scopes, "Rejected scope writes must change nothing");

            Json many = Json::array();
            for (std::size_t i = 0; i != 65; ++i)
                many.push_back({{"name", "scope-" + std::to_string(i)}, {"pattern", "file:*." + std::to_string(i)}, {"shared", false}});
            expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root_a, {{"scopes", many}}); });
            many.erase(64);
            check(store.update_project_settings(root_a, {{"scopes", many}}).at("scopes").size() == 64,
                  "The largest accepted scope list must be usable");

            Json legacy = Json::parse(get(file));
            const std::string key = legacy.at("perProject").begin().key();
            legacy["perProject"][key] = {{"excludedDirs", Json::array({".git"})}, {"runConfigs", Json::array()},
                                         {"bookmarks", Json::array()}, {"todoPatterns", default_todo_patterns()}};
            put(file, legacy.dump());
            check(ProjectStore(file).project_settings(root_a).at("scopes").empty(),
                  "a project record written before scopes existed takes the empty default");
            check(ProjectStore(file).update_project_settings(root_a, {{"scopes", scopes}}).at("scopes") == scopes,
                  "the migrated record accepts the new key");
        });

        run("live template switches and customs are validated per project", [&] {
            const auto file = temporary.path / "templates.json";
            ProjectStore store(file);
            const auto a = create_project(temporary.path, "templates-a", "empty");
            const auto b = create_project(temporary.path, "templates-b", "empty");
            const auto root_a = open_result(a).at("root").get<std::string>();
            const auto root_b = open_result(b).at("root").get<std::string>();
            store.opened(open_result(a));
            check(store.project_settings(root_a).at("templates") == empty_templates(),
                  "A new project starts with every built-in switched on and no customs");
            const Json settings = {
                {"overrides", Json::array({{{"pattern", "sout:"}, {"disabled", true}},
                                           {{"pattern", "postfix:var:java"}, {"disabled", false}}})},
                {"customs", Json::array({{{"key", "logger"}, {"body", "log($END$);"},
                                          {"description", utf8(u8"打日志")}, {"languages", Json::array({"typescript"})}},
                                         {{"key", "anywhere"}, {"body", "// $END$"},
                                          {"description", "note"}, {"languages", Json::array()}}})}};
            check(store.update_project_settings(root_a, {{"templates", settings}}).at("templates") == settings,
                  "Switches and custom templates round-trip untouched");
            check(store.project_settings(root_b).at("templates") == empty_templates(),
                  "Another project keeps its own template page");
            store.update_project_settings(root_a, {{"bookmarks", Json::array()}});
            check(store.project_settings(root_a).at("templates") == settings,
                  "Patching bookmarks must not reset the templates");
            const std::vector<Json> rejected{
                {{"templates", nullptr}},
                {{"templates", Json::array()}},
                {{"templates", {{"unknown", Json::array()}}}},
                {{"templates", {{"overrides", Json::object()}}}},
                {{"templates", {{"overrides", Json::array({Json::object()})}}}},
                {{"templates", {{"overrides", Json::array({{{"pattern", "sout:"}}})}}}},
                {{"templates", {{"overrides", Json::array({{{"pattern", ""}, {"disabled", true}}})}}}},
                {{"templates", {{"overrides", Json::array({{{"pattern", "sout:"}, {"disabled", "yes"}}})}}}},
                {{"templates", {{"overrides", Json::array({{{"pattern", "a"}, {"disabled", true}},
                                                          {{"pattern", "a"}, {"disabled", false}}})}}}},
                {{"templates", {{"customs", Json::object()}}}},
                {{"templates", {{"customs", Json::array({{{"key", "9bad"}, {"body", "x"},
                                                          {"description", "d"}, {"languages", Json::array()}}})}}}},
                {{"templates", {{"customs", Json::array({{{"key", "ok"}, {"body", ""},
                                                          {"description", "d"}, {"languages", Json::array()}}})}}}},
                {{"templates", {{"customs", Json::array({{{"key", "ok"}, {"body", std::string(8001, 'b')},
                                                          {"description", "d"}, {"languages", Json::array()}}})}}}},
                {{"templates", {{"customs", Json::array({{{"key", "ok"}, {"body", "b"},
                                                          {"description", ""}, {"languages", Json::array()}}})}}}},
                {{"templates", {{"customs", Json::array({{{"key", "ok"}, {"body", "b"},
                                                          {"description", "d"}}})}}}},
                {{"templates", {{"customs", Json::array({{{"key", "ok"}, {"body", "b"}, {"description", "d"},
                                                          {"languages", Json::array({"cobol"})}}})}}}},
                {{"templates", {{"customs", Json::array({{{"key", "dup"}, {"body", "b"}, {"description", "d"},
                                                          {"languages", Json::array()}},
                                                         {{"key", "dup"}, {"body", "c"}, {"description", "d"},
                                                          {"languages", Json::array()}}})}}}},
            };
            for (const auto& patch : rejected)
                expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root_a, patch); });
            check(store.project_settings(root_a).at("templates") == settings,
                  "Rejected template writes must change nothing");
            Json legacy = Json::parse(get(file));
            const std::string key = legacy.at("perProject").begin().key();
            legacy["perProject"][key] = {{"excludedDirs", Json::array({".git"})}, {"runConfigs", Json::array()},
                                         {"bookmarks", Json::array()}, {"todoPatterns", default_todo_patterns()}};
            put(file, legacy.dump());
            check(ProjectStore(file).project_settings(root_a).at("templates") == empty_templates(),
                  "a project record written before templates existed takes the default");
            check(ProjectStore(file).update_project_settings(root_a, {{"templates", settings}}).at("templates") == settings,
                  "the migrated record accepts the new key");
            legacy["perProject"][key] = {{"excludedDirs", Json::array({".git"})}, {"templates", Json::object()}};
            put(file, legacy.dump());
            check(ProjectStore(file).project_settings(root_a).at("templates") == empty_templates(),
                  "partial nested settings receive defaults when read");
            const auto updated = ProjectStore(file).update_project_settings(root_a, {{"bookmarks", Json::array()}});
            check(updated.at("templates") == empty_templates() && updated.contains("runConfigs") && updated.contains("todoPatterns"),
                  "an unrelated patch also returns a complete migrated record");
            const auto partial = ProjectStore(file).update_project_settings(root_a, {{"templates", {{"customs", settings.at("customs")}}}});
            check(partial.at("templates").at("overrides").empty() && partial.at("templates").at("customs") == settings.at("customs"),
                  "nested partial patches preserve the other template list");
        });

    run("Java project settings persist, migrate, and reach JDT LS shape", [&] {
            const auto file = temporary.path / "java-settings.json";
            ProjectStore store(file);
            const auto root = open_result(create_project(temporary.path, "java-settings", "empty")).at("root").get<std::string>();
            check(store.project_settings(root).at("java") == java_defaults(), "a Java setting written after templates existed takes the default");
            const Json java = {{"jdkHome", "C:\\Program Files\\Java\\jdk-21"}, {"jdkName", "JavaSE-21"},
                               {"sourcePaths", Json::array({"src", "test/src"})}, {"outputPath", "out"},
                               {"referencedLibraries", Json::array({"lib/**/*.jar", "vendor/specific.jar"})}};
            check(store.update_project_settings(root, {{"java", java}}).at("java") == java, "Java configuration round-trips");
            const auto lsp = java_lsp_settings(store.project_settings(root).at("java"), Json::object());
            check(lsp.at("java").at("configuration").at("runtimes")[0].at("name") == "JavaSE-21" &&
                      lsp.at("java").at("configuration").at("runtimes")[0].at("path") == "C:\\Program Files\\Java\\jdk-21" &&
                      lsp.at("java").at("project").at("sourcePaths") == java.at("sourcePaths") &&
                      lsp.at("java").at("project").at("referencedLibraries") == java.at("referencedLibraries"),
                  "JDT receives the documented setting keys");
            const std::vector<Json> rejected{{nullptr}, Json::array(), {{"unknown", ""}}, {{"jdkName", "bogus%%"}},
                                             {{"jdkHome", "relative/jdk"}}, {{"sourcePaths", "../outside"}},
                                             {{"sourcePaths", "src"}}, {{"sourcePaths", Json::array({"../escape"})}},
                                             {{"sourcePaths", Json::array({"src/../escape"})}},
                                             {{"referencedLibraries", Json::array({"**/.."}) }}, {{"outputPath", "out/../dist"}}};
            for (const auto& value : rejected) expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root, {{"java", value}}); });
            check(store.project_settings(root).at("java") == java, "Rejected Java writes change nothing");
            Json legacy = Json::parse(get(file));
            legacy["perProject"][legacy.at("perProject").begin().key()]["java"] = nullptr;
            put(file, legacy.dump());
            check(ProjectStore(file).project_settings(root).at("java") == java_defaults(), "null nested Java settings are migrated");
            // 合成语言服务器配置时拿到的不一定是"完整"的 java 段。缺字段必须是"这一项没有"，
            // 而不是抛 JSON 异常 —— 后者会在启动语言服务器的那一刻把 IDE 打崩（曾经如此）。
            const auto partial = java_lsp_settings({{"jdkHome", "C:\\jdk-17"}}, Json::object());
            check(partial.at("java").at("configuration").at("runtimes")[0].at("name") == "JavaSE-17",
                  "缺 jdkName 时用默认的 JavaSE-17，而不是抛异常");
            check(partial.at("java").at("project").at("sourcePaths").is_array() &&
                      partial.at("java").at("project").at("outputPath") == "",
                  "缺 sourcePaths/outputPath 时给空值");
            const auto bare = java_lsp_settings(Json::object(), Json::object());
            check(bare.at("java").at("configuration").at("runtimes").empty(),
                  "没有 JDK 时 runtimes 为空（不编一个运行时装进去）");
            // 「构建工具 › Gradle」必须一起进服务器：JDT LS 用 Buildship 自己跑一次 Gradle 同步，
            // 拿不到「Gradle JVM」时它会用**自己那个 JRE**去起守护进程 —— 老 Gradle（6.8.3 只到
            // Java 15）在 JRE 21 上直接失败，工程模型永远建不起来（表现就是没有补全、没有语义着色）。
            // 键名按实际在跑的那份服务器核对：org.eclipse.jdt.ls.core_1.44.0.jar 的 Preferences.class。
            const Json build_tools{{"gradle", {{"useGradleFrom", "wrapper"}, {"gradlePath", ""},
                                               {"gradleUserHome", ""}, {"gradleJvm", "#USE_PROJECT_JDK"},
                                               {"offline", false}, {"delegatedBuild", true}}}};
            const auto wrapped = java_lsp_settings({{"jdkHome", "C:\\jdk-8"}}, build_tools);
            const auto& import_gradle = wrapped.at("java").at("import").at("gradle");
            check(import_gradle.at("wrapper").at("enabled") == true &&
                      import_gradle.at("java").at("home") == "C:\\jdk-8" &&
                      !import_gradle.contains("home") && !import_gradle.contains("user") &&
                      !import_gradle.contains("offline"),
                  "默认档：走 wrapper、Gradle JVM = 项目 JDK，没填的项一律不发");
            const auto local = java_lsp_settings({{"jdkHome", "C:\\jdk-8"}},
                Json{{"gradle", {{"useGradleFrom", "path"}, {"gradlePath", "D:\\gradle-8.7"},
                                 {"gradleUserHome", "D:\\gradle-home"}, {"gradleJvm", "C:\\jdk-17"},
                                 {"offline", true}}}});
            const auto& local_gradle = local.at("java").at("import").at("gradle");
            check(local_gradle.at("wrapper").at("enabled") == false &&
                      local_gradle.at("home") == "D:\\gradle-8.7" &&
                      local_gradle.at("user").at("home") == "D:\\gradle-home" &&
                      local_gradle.at("java").at("home") == "C:\\jdk-17" &&
                      local_gradle.at("offline").at("enabled") == true,
                  "指定路径/用户主目录/显式 JVM/离线都要转成服务器认的键");
            const auto no_build_tools = java_lsp_settings(Json::object(), Json::object());
            check(no_build_tools.at("java").at("import").at("gradle").at("wrapper").at("enabled") == true &&
                      !no_build_tools.at("java").at("import").at("gradle").contains("java"),
                  "没有 buildTools 时保持服务器默认（走 wrapper），且不编一个 Gradle JVM");
        });

        run("inclusive 1 MiB read limit and bounded writes", [&] {
            const auto file = temporary.path / "limits.json";
            auto bytes = document().dump();
            bytes.resize(state_limit, ' ');
            put(file, bytes);
            ProjectStore store(file);
            check(store.state().at("settings") == defaults() && get(file) == bytes, "Exactly 1 MiB must be readable without rewriting");
            const auto project = create_project(temporary.path, "limit-project", "empty");
            Json oversized = Json::array();
            for (unsigned i = 0; i != 5000; ++i) oversized.push_back(std::to_string(i) + std::string(240, 'x'));
            expect_error("STATE_TOO_LARGE", [&] { store.update_project_settings(text(project), {{"excludedDirs", oversized}}); });
            check(get(file) == bytes && store.project_settings(text(project)) == exclusions(), "Oversized output must not change disk or settings");
        });

        run("symlinks and reparse ancestors cannot redirect creation or configuration", [&] {
            const auto outside = temporary.path / "outside";
            fs::create_directory(outside);
            fs::create_directory(outside / "nested");
            const auto link = temporary.path / "directory-link";
            if (symlink(link, outside, true)) {
                expect_error("REPARSE_POINT", [&] { project_destination(link, "escape"); });
                expect_error("REPARSE_POINT", [&] { project_destination(link / "nested", "escape"); });
                expect_error("REPARSE_POINT", [&] { create_project(link / "nested", "escape", "cpp"); });
                expect_error("ALREADY_EXISTS", [&] { create_project(temporary.path, "directory-link", "empty"); });
                ProjectStore redirected(link / "projects.json");
                expect_error("REPARSE_POINT", [&] { redirected.state(); });
                expect_error("REPARSE_POINT", [&] { redirected.update_settings({{"fontSize", 16}}); });
                ProjectStore plain(temporary.path / "plain-state.json");
                expect_error("REPARSE_POINT", [&] { plain.project_settings(text(link / "nested")); });
                check(!fs::exists(outside / "nested" / "escape") && !fs::exists(outside / "projects.json"), "No writes may escape through ancestor links");
                fs::remove(link);
            }
            const auto dangling = temporary.path / "dangling";
            if (symlink(dangling, outside / "missing", true)) {
                expect_error("ALREADY_EXISTS", [&] { project_destination(temporary.path, "dangling"); });
                expect_error("ALREADY_EXISTS", [&] { create_project(temporary.path, "dangling", "empty"); });
                fs::remove(dangling);
            }
            const auto original = outside / "original.json";
            put(original, document().dump());
            const auto file_link = temporary.path / "linked-state.json";
            if (symlink(file_link, original, false)) {
                const auto before = get(original);
                ProjectStore linked(file_link);
                expect_error("REPARSE_POINT", [&] { linked.state(); });
                expect_error("REPARSE_POINT", [&] { linked.update_settings({{"fontSize", 16}}); });
                check(get(original) == before, "Configuration file symlink target must not change");
                fs::remove(file_link);
            }
        });
    } catch (const std::exception& error) {
        ++failures;
        std::cerr << "FAIL setup: " << error.what() << '\n';
    }
    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
