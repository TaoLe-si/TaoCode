#include "projects.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <iterator>
#include <limits>
#include <string_view>
#include <system_error>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::ProjectStore;
using taocode::Workspace;
using taocode::WorkspaceError;
using taocode::create_project;
using taocode::java_lsp_settings;
using taocode::project_destination;
constexpr std::size_t state_limit = 1024 * 1024;

std::string utf8(std::u8string_view value) {
    return {reinterpret_cast<const char*>(value.data()), value.size()};
}

std::string text(const fs::path& path) { return utf8(path.generic_u8string()); }
fs::path path_from(const std::string& value) { return fs::path(std::u8string(value.begin(), value.end())); }

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

template <class Operation>
void expect_error(const std::string& code, Operation&& operation) {
    try {
        operation();
    } catch (const WorkspaceError& error) {
        check(error.code == code, "Expected " + code + ", got " + error.code + ": " + error.what());
        check(*error.what() != '\0', "WorkspaceError must explain its failure");
        return;
    }
    throw std::runtime_error("Expected WorkspaceError: " + code);
}

void put(const fs::path& path, const std::string& bytes) {
    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    check(stream.is_open(), "Cannot create test fixture: " + text(path));
    stream.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    stream.close();
    check(!stream.fail(), "Cannot write test fixture: " + text(path));
}

std::string get(const fs::path& path) {
    std::ifstream stream(path, std::ios::binary);
    check(stream.is_open(), "Cannot read test fixture: " + text(path));
    std::string result{std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>()};
    check(!stream.bad(), "Cannot read fixture bytes");
    return result;
}

std::vector<std::string> names(const fs::path& directory) {
    std::vector<std::string> result;
    for (const auto& entry : fs::directory_iterator(directory)) result.push_back(text(entry.path().filename()));
    std::sort(result.begin(), result.end());
    return result;
}

std::string upper_ascii(std::string value) {
    for (auto& ch : value) {
        if (ch >= 'a' && ch <= 'z') ch = static_cast<char>(ch - 'a' + 'A');
    }
    return value;
}

Json open_result(const fs::path& path) {
    Workspace workspace;
    return workspace.open(path);
}

// The real defaults, not a copy: a mirror drifts the moment a setting is added and
// then every migration assertion fails for no reason.
Json defaults() { return taocode::editor_defaults(); }

Json default_todo_patterns() {
    return Json::array({{{"pattern", "TODO"}, {"description", "待办"}},
                        {{"pattern", "FIXME"}, {"description", "需要修"}},
                        {{"pattern", "XXX"}, {"description", "警告"}},
                        {{"pattern", "HACK"}, {"description", "临时办法"}}});
}

Json empty_templates() {
    return {{"overrides", Json::array()}, {"customs", Json::array()}};
}

Json java_defaults() {
    return {{"jdkHome", ""}, {"jdkName", "JavaSE-17"}, {"sourcePaths", Json::array()},
            {"outputPath", ""}, {"referencedLibraries", Json::array({"lib/**/*.jar"})}};
}

Json exclusions() {
    // Mirrors ProjectStore's per-project defaults, including the stored lists.
    return {{"excludedDirs", Json::array({".git", "node_modules", "build", "dist"})},
            {"runConfigs", Json::array()}, {"bookmarks", Json::array()},
            {"todoPatterns", default_todo_patterns()},
            {"templates", empty_templates()}, {"java", java_defaults()},
            {"fileAssociations", Json::object()}};
}

Json document() {
    return {{"recentProjects", Json::array()}, {"settings", defaults()},
            {"lastProject", nullptr}, {"perProject", Json::object()}};
}

struct TempRoot {
    fs::path path;
    TempRoot() {
        const auto prefix = "taocode-projects-test-" + std::to_string(GetCurrentProcessId()) + "-" +
                            std::to_string(GetTickCount64()) + "-";
        for (unsigned attempt = 0; attempt != 100; ++attempt) {
            auto candidate = fs::temp_directory_path() / (prefix + std::to_string(attempt));
            std::error_code error;
            if (fs::create_directory(candidate, error)) {
                // Canonicalize using GetFinalPathNameByHandleW to match production code.
                HANDLE handle = CreateFileW(candidate.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ,
                                           nullptr, OPEN_EXISTING,
                                           FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
                if (handle != INVALID_HANDLE_VALUE) {
                    const DWORD size = GetFinalPathNameByHandleW(handle, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
                    if (size > 0) {
                        std::vector<wchar_t> buffer(size);
                        const DWORD length = GetFinalPathNameByHandleW(handle, buffer.data(), size,
                                                                      FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
                        if (length > 0 && length < size) {
                            std::wstring text(buffer.data(), length);
                            if (text.starts_with(L"\\\\?\\")) text.erase(0, 4);
                            for (auto& ch : text) if (ch == L'/') ch = L'\\';
                            while (text.size() > 3 && text.back() == L'\\') text.pop_back();
                            candidate = fs::path(text);
                        }
                    }
                    CloseHandle(handle);
                }
                path.swap(candidate);
                return;
            }
            if (error && error != std::errc::file_exists)
                throw std::runtime_error("Cannot create isolated temporary root: " + error.message());
        }
        throw std::runtime_error("Cannot allocate a temporary test directory");
    }
    ~TempRoot() {
        std::error_code error;
        fs::remove_all(path, error);
        if (error) std::cerr << "Cleanup failed for " << text(path) << ": " << error.message() << '\n';
    }
    TempRoot(const TempRoot&) = delete;
    TempRoot& operator=(const TempRoot&) = delete;
};

struct NativeHandle {
    HANDLE value;
    ~NativeHandle() { if (value != INVALID_HANDLE_VALUE) CloseHandle(value); }
};

bool symlink(const fs::path& link, const fs::path& target, bool directory) {
    const DWORD flags = directory ? SYMBOLIC_LINK_FLAG_DIRECTORY : 0;
    if (CreateSymbolicLinkW(link.c_str(), target.c_str(), flags | 0x2)) return true;
    auto error = GetLastError();
    if (error == ERROR_INVALID_PARAMETER) {
        if (CreateSymbolicLinkW(link.c_str(), target.c_str(), flags)) return true;
        error = GetLastError();
    }
    std::cout << "SKIP symlink " << text(link.filename()) << " (Windows error " << error << ")\n";
    return false;
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
                                                        {"lineNumbers", false}, {"restoreLastProject", true}, {"tabLimit", 12}});
            check(editor.at("tabLimit") == 12, "tabLimit round-trips through the settings patch");
            check(second.state().at("settings") == editor, "Already-created store instances must not have stale caches");
            const Json custom = {{"excludedDirs", Json::array({".git", utf8(u8"临时 目录"), "out"})},
                                 {"runConfigs", Json::array({{{"name", utf8(u8"构建")}, {"command", "cmake --build build"}}})},
                                 {"bookmarks", Json::array({{{"path", "src/main.cpp"}, {"line", 7}, {"mnemonic", 2}}})},
                                 {"todoPatterns", Json::array({{{"pattern", "REVIEW"}, {"description", utf8(u8"待评审")}}})},
                                 {"templates", empty_templates()}, {"java", java_defaults()},
                                 {"fileAssociations", {{"conf", "typescript"}}}};
            check(second.update_project_settings(upper_ascii(root_a), custom) == custom, "Project update must return merged settings");
            check(first.project_settings(root_a) == custom && first.project_settings(root_b) == exclusions(), "Per-project settings must be isolated and case-insensitive");
            first.update_project_settings(root_b, {{"excludedDirs", Json::array()}});
            check(second.project_settings(root_b).at("excludedDirs").empty(), "Empty exclusion arrays are valid");
            check(ProjectStore(file).project_settings(root_a) == custom, "Per-project settings must persist");
            const auto disk = Json::parse(get(file));
            check(disk.at("perProject").size() == 2 && disk.at("settings") == editor, "All settings belong in the one application state file");
            check(fs::is_empty(a) && fs::is_empty(b), "Do not create configuration inside user projects");
            check(!first.state().contains("perProject"), "Internal perProject map is not part of public state()");
            const auto before = get(file);
            const auto before_state = first.state();
            const std::vector<Json> bad_editor{
                nullptr, Json::array(), {{"theme", "dark"}}, {{"fontSize", 9}}, {{"fontSize", 33}},
                {{"fontSize", 14.0}}, {{"fontSize", "14"}}, {{"fontSize", true}},
                {{"fontSize", (std::numeric_limits<std::uint64_t>::max)()}},
                {{"tabSize", 3}}, {{"tabSize", 2.0}}, {{"wordWrap", 1}}, {{"lineNumbers", nullptr}},
                {{"restoreLastProject", "true"}}, {{"fontSize", 12}, {"unknown", true}},
                {{"tabLimit", 0}}, {{"tabLimit", 101}}, {{"tabLimit", "30"}}, {{"tabLimit", 8.5}}
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
                {{"fileAssociations", {{"a/b", "java"}}}}, {{"fileAssociations", {{std::string(17, 'a'), "java"}}}}
            };
            for (const auto& patch : bad_project) expect_error("INVALID_SETTINGS", [&] { second.update_project_settings(root_a, patch); });
            expect_error("INVALID_PATH", [&] { first.update_project_settings("relative", custom); });
            check(get(file) == before && first.state() == before_state && first.project_settings(root_a) == custom, "Rejected patches must not pollute any settings");
            first.forget(root_a);
            check(second.project_settings(root_a) == custom, "Forgetting a recent project must not discard its settings");
            check(first.update_settings({{"fontSize", 10}, {"tabSize", 2}}).at("fontSize") == 10, "Lower font boundary and tab size two are valid");
            check(first.update_settings({{"tabSize", 4}}).at("tabSize") == 4, "Tab size four is valid");
            ProjectStore isolated(temporary.path / "isolated.json");
            check(isolated.state().at("settings") == defaults() && isolated.project_settings(root_a) == exclusions(), "Different state files must remain isolated");
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
            auto invalid = valid;
            invalid["settings"]["theme"] = "dark";
            bad.push_back(invalid.dump());
            invalid = valid;
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
            };
            for (const auto& patch : rejected)
                expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root_a, patch); });
            check(store.project_settings(root_a).at("bookmarks") == marks,
                  "Rejected bookmark writes must change nothing");
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
            const auto lsp = java_lsp_settings(store.project_settings(root).at("java"));
            check(lsp.at("java").at("configuration").at("runtimes")[0].at("name") == "JavaSE-21" &&
                      lsp.at("java").at("configuration").at("runtimes")[0].at("path") == "C:\\Program Files\\Java\\jdk-21" &&
                      lsp.at("java").at("project").at("sourcePaths") == java.at("sourcePaths") &&
                      lsp.at("java").at("project").at("referencedLibraries") == java.at("referencedLibraries"),
                  "JDT receives the documented setting keys");
            const std::vector<Json> rejected{{nullptr}, Json::array(), {{"unknown", ""}}, {{"jdkName", "17"}},
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
