#include "projects.hpp"
#include "settings_schema.hpp"
#include "fsops.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdio>
#include <initializer_list>
#include <limits>
#include <mutex>
#include <optional>
#include <regex>
#include <set>
#include <string_view>
#include <utility>
#include <span>
#include <vector>

namespace taocode {
namespace {

constexpr std::size_t state_limit = 1024 * 1024;
constexpr std::size_t recent_limit = 30;
// ponytail: one process-wide lock, including different stores; split by state path
// only if configuration I/O contention matters. No cross-process CAS is promised.
std::mutex store_mutex;

[[noreturn]] void fail(const char* code, const std::string& message) {
    throw WorkspaceError(code, message);
}

[[noreturn]] void win_error(const std::string& message, DWORD error = GetLastError()) {
    const char* code = "IO_ERROR";
    switch (error) {
    case ERROR_FILE_NOT_FOUND:
    case ERROR_PATH_NOT_FOUND: code = "NOT_FOUND"; break;
    case ERROR_ACCESS_DENIED:
    case ERROR_PRIVILEGE_NOT_HELD: code = "ACCESS_DENIED"; break;
    case ERROR_SHARING_VIOLATION:
    case ERROR_LOCK_VIOLATION: code = "FILE_BUSY"; break;
    case ERROR_FILE_EXISTS:
    case ERROR_ALREADY_EXISTS: code = "ALREADY_EXISTS"; break;
    case ERROR_INVALID_NAME:
    case ERROR_BAD_PATHNAME:
    case ERROR_FILENAME_EXCED_RANGE: code = "INVALID_PATH"; break;
    case ERROR_DIRECTORY: code = "NOT_DIRECTORY"; break;
    default: break;
    }
    fail(code, message + " (Windows error " + std::to_string(error) + ").");
}

template <class Operation>
auto boundary(Operation&& operation) -> decltype(operation()) {
    try {
        return operation();
    } catch (const WorkspaceError&) {
        throw;
    } catch (const fs::filesystem_error&) {
        fail("IO_ERROR", "The project filesystem operation failed.");
    } catch (const Json::exception&) {
        fail("INVALID_ARGUMENT", "Invalid project request.");
    } catch (const std::exception&) {
        fail("INTERNAL_ERROR", "The project operation could not be completed.");
    }
}

class Handle {
public:
    explicit Handle(HANDLE value = INVALID_HANDLE_VALUE) noexcept : value_(value) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept
        : value_(std::exchange(other.value_, INVALID_HANDLE_VALUE)) {}
    Handle& operator=(Handle&& other) noexcept {
        if (this != &other) {
            reset();
            value_ = std::exchange(other.value_, INVALID_HANDLE_VALUE);
        }
        return *this;
    }
    HANDLE get() const noexcept { return value_; }
    explicit operator bool() const noexcept {
        return value_ != INVALID_HANDLE_VALUE && value_ != nullptr;
    }
    void reset() noexcept {
        if (*this) CloseHandle(value_);
        value_ = INVALID_HANDLE_VALUE;
    }
private:
    HANDLE value_;
};


constexpr std::size_t max_run_configs = 40;


bool same_path(const std::string& a, const std::string& b) {
    return equal_name(from_utf8(a).native(), from_utf8(b).native());
}

std::string stored_path(const Json& value) {
    if (!value.is_string()) fail("STATE_CORRUPT", "A stored project path is not a string.");
    return utf8_path(absolute_path(from_utf8(value.get_ref<const std::string&>()), true));
}

bool valid_timestamp(const std::string& value) {
    if (value.size() != 20 || value[4] != '-' || value[7] != '-' || value[10] != 'T' ||
        value[13] != ':' || value[16] != ':' || value[19] != 'Z') return false;
    for (std::size_t i = 0; i != value.size(); ++i) {
        if (i == 4 || i == 7 || i == 10 || i == 13 || i == 16 || i == 19) continue;
        if (value[i] < '0' || value[i] > '9') return false;
    }
    const auto number = [&](std::size_t start, std::size_t length) {
        unsigned result = 0;
        for (std::size_t i = start; i < start + length; ++i) result = result * 10 + value[i] - '0';
        return result;
    };
    const auto year = number(0, 4), month = number(5, 2), day = number(8, 2);
    constexpr unsigned days[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (year < 1601 || month < 1 || month > 12 || day < 1 || number(11, 2) > 23 ||
        number(14, 2) > 59 || number(17, 2) > 59) return false;
    const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    return day <= days[month - 1] + (month == 2 && leap ? 1u : 0u);
}

std::string utc_now() {
    SYSTEMTIME now{};
    GetSystemTime(&now);
    std::array<char, 32> buffer{};
    std::snprintf(buffer.data(), buffer.size(), "%04u-%02u-%02uT%02u:%02u:%02uZ",
                  static_cast<unsigned>(now.wYear), static_cast<unsigned>(now.wMonth),
                  static_cast<unsigned>(now.wDay), static_cast<unsigned>(now.wHour),
                  static_cast<unsigned>(now.wMinute), static_cast<unsigned>(now.wSecond));
    return buffer.data();
}

Json validate_document(Json value) {
    try {
        known_keys(value, {"recentProjects", "settings", "general", "lastProject", "perProject"}, "STATE_CORRUPT");
        // 两级剪枝：文档里的 settings / general 都先丢掉当前版本不认识的键，再走严格校验。
        if (value.contains("settings")) prune_unknown(value["settings"], EDITOR_SETTING_KEYS);
        if (value.contains("general")) prune_unknown(value["general"], GENERAL_SETTING_KEYS);
        if (!value.contains("recentProjects") || !value.at("recentProjects").is_array() ||
            value.at("recentProjects").size() > recent_limit || !value.contains("settings") ||
            !value.contains("lastProject"))
            fail("STATE_CORRUPT", "The saved project state has an invalid schema.");
        validate_editor_patch(value.at("settings"));
        // A file written before a setting existed is not corrupt: the missing keys
        // take their defaults. Unknown keys and wrong types are still refused above.
        // The defaults are hoisted because iterating the items() view of a temporary
        // would leave the iterators dangling.
        const Json fallbacks = editor_defaults_impl();
        for (const auto& entry : fallbacks.items())
            if (!value["settings"].contains(entry.key())) value["settings"][entry.key()] = entry.value();
        std::vector<std::string> paths;
        for (auto& recent : value.at("recentProjects")) {
            known_keys(recent, {"name", "path", "lastOpened", "available", "displayName",
                                "projectName", "activationTimestamp", "branchName"}, "STATE_CORRUPT");
            if (!recent.contains("name") || !recent.at("name").is_string() ||
                recent.at("name").get_ref<const std::string&>().empty() ||
                !valid_utf8(recent.at("name").get_ref<const std::string&>()) ||
                !recent.contains("path") || !recent.contains("lastOpened") ||
                !recent.at("lastOpened").is_string() ||
                !valid_timestamp(recent.at("lastOpened").get_ref<const std::string&>()) ||
                (recent.contains("available") && !recent.at("available").is_boolean()) ||
                (recent.contains("displayName") &&
                 (!recent.at("displayName").is_string() ||
                  !valid_utf8(recent.at("displayName").get_ref<const std::string&>()))) ||
                (recent.contains("projectName") &&
                 (!recent.at("projectName").is_string() ||
                  !valid_utf8(recent.at("projectName").get_ref<const std::string&>()))) ||
                (recent.contains("activationTimestamp") &&
                 (!recent.at("activationTimestamp").is_number_integer() ||
                  recent.at("activationTimestamp").get<int64_t>() < 0)) ||
                (recent.contains("branchName") &&
                 (!recent.at("branchName").is_string() ||
                  !valid_utf8(recent.at("branchName").get_ref<const std::string&>()))))
                fail("STATE_CORRUPT", "A saved recent project is invalid.");
            const auto path = stored_path(recent.at("path"));
            for (const auto& existing : paths) {
                if (same_path(existing, path)) fail("STATE_CORRUPT", "Duplicate saved project paths.");
            }
            paths.push_back(path);
            recent["path"] = path;
            recent.erase("available"); // Availability is never trusted from disk.
        }
        if (!value.at("lastProject").is_null()) value["lastProject"] = stored_path(value.at("lastProject"));
        if (!value.contains("perProject")) value["perProject"] = Json::object();
        if (!value.at("perProject").is_object()) fail("STATE_CORRUPT", "perProject must be a map.");
        Json projects = Json::object();
        std::set<std::wstring, decltype([](const std::wstring& a, const std::wstring& b) {
            return CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(),
                                        static_cast<int>(b.size()), TRUE) == CSTR_LESS_THAN;
        })> keys;
        for (auto it = value.at("perProject").begin(); it != value.at("perProject").end(); ++it) {
            const auto path = stored_path(Json(it.key()));
            if (!keys.insert(from_utf8(path).native()).second)
                fail("STATE_CORRUPT", "Duplicate per-project settings paths.");
            // A key an older file left as null (e.g. before the setting existed) is
            // dropped here so project_settings() fills it from the defaults.
            for (auto field = it.value().begin(); field != it.value().end();)
                field = field.value().is_null() ? it.value().erase(field) : std::next(field);
            validate_project_patch(it.value());
            if (!it.value().contains("excludedDirs")) fail("STATE_CORRUPT", "Incomplete per-project settings.");
            projects[path] = it.value();
        }
        value["perProject"] = std::move(projects);
        return value;
    } catch (const WorkspaceError& error) {
        if (error.code == "STATE_CORRUPT") throw;
        fail("STATE_CORRUPT", "The saved configuration is invalid; the original file was kept.");
    } catch (const Json::exception&) {
        fail("STATE_CORRUPT", "The saved configuration is invalid; the original file was kept.");
    }
}

std::string read_state_bytes(HANDLE handle) {
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(handle, &size)) win_error("Cannot inspect configuration size");
    if (size.QuadPart < 0 || size.QuadPart > static_cast<LONGLONG>(state_limit))
        fail("STATE_CORRUPT", "The configuration exceeds the 1 MiB limit; the original file was kept.");
    std::string result;
    result.reserve(static_cast<std::size_t>(size.QuadPart));
    std::array<char, 65536> buffer{};
    for (;;) {
        DWORD count = 0;
        if (!ReadFile(handle, buffer.data(), static_cast<DWORD>(buffer.size()), &count, nullptr))
            win_error("Cannot read application configuration");
        if (!count) break;
        if (count > state_limit - result.size()) fail("STATE_CORRUPT", "The configuration exceeds 1 MiB.");
        result.append(buffer.data(), count);
    }
    return result;
}

struct LoadedState {
    PinnedDirectory parent;
    Handle original;
    Json document = empty_document();
};

LoadedState load_state(const fs::path& file) {
    LoadedState loaded;
    loaded.parent = pin_directory(file.parent_path(), Missing::allow);
    if (!loaded.parent.exists) return loaded;
    loaded.original = Handle(CreateFileW(api_path(loaded.parent.path / file.filename()).c_str(),
                                        GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr,
                                        OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT |
                                        FILE_FLAG_BACKUP_SEMANTICS, nullptr));
    if (!loaded.original) {
        const auto error = GetLastError();
        if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) return loaded;
        win_error("Cannot open application configuration", error);
    }
    const auto info = file_info(loaded.original.get());
    reject_reparse(info);
    if ((info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || GetFileType(loaded.original.get()) != FILE_TYPE_DISK)
        fail("STATE_CORRUPT", "The configuration is not a regular file; it was not changed.");
    const auto bytes = read_state_bytes(loaded.original.get());
    try {
        // Reject ambiguous duplicate JSON keys and bound parser nesting as well as bytes.
        std::vector<std::set<std::string>> objects;
        const auto callback = [&](int depth, Json::parse_event_t event, Json& parsed) {
            if (depth > 32) fail("STATE_CORRUPT", "Configuration JSON is nested too deeply.");
            if (event == Json::parse_event_t::object_start) objects.emplace_back();
            else if (event == Json::parse_event_t::key) {
                if (objects.empty() || !objects.back().insert(parsed.get<std::string>()).second)
                    fail("STATE_CORRUPT", "Configuration JSON contains a duplicate key.");
            } else if (event == Json::parse_event_t::object_end) objects.pop_back();
            return true;
        };
        loaded.document = validate_document(Json::parse(bytes, callback));
    } catch (const Json::exception&) {
        fail("STATE_CORRUPT", "Cannot parse saved configuration; the original file was kept.");
    }
    return loaded;
}

void save_state(const fs::path& file, LoadedState& loaded, const Json& next) {
    const auto bytes = next.dump(2) + '\n';
    if (bytes.size() > state_limit) fail("STATE_TOO_LARGE", "The configuration would exceed 1 MiB.");
    if (!loaded.parent.exists) loaded.parent = pin_directory(file.parent_path(), Missing::create);
    auto temporary = temporary_object(loaded.parent.path, false);
    write_and_flush(temporary.handle.get(), bytes);
    const bool had_original = static_cast<bool>(loaded.original);
    loaded.original.reset();  // Release our read handle; Windows blocks replace-over-own-handle.
    const auto target = loaded.parent.path / file.filename();
    if (had_original) {
        // A handle-based replace reports both "target held without delete-sharing"
        // and ACL faults as error 5. Take a brief DELETE reservation first so a busy
        // file surfaces as FILE_BUSY instead of collapsing into ACCESS_DENIED.
        Handle reservation(CreateFileW(api_path(target).c_str(), DELETE,
                                       FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                       nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
        if (!reservation) {
            const auto error = GetLastError();
            if (error == ERROR_SHARING_VIOLATION)
                fail("FILE_BUSY", "The configuration is in use by another program; it was not changed.");
            win_error("Cannot replace application configuration", error);
        }
    }
    // A first save must not replace an object which appeared after the initial read.
    rename_handle(temporary.handle.get(), target, had_original);
    temporary.cleanup = false;
    // Nothing that can fail or allocate is done after the atomic replacement.
}

Json public_state(const Json& document) {
    Json result = {{"recentProjects", document.at("recentProjects")},
                   {"settings", document.at("settings")}, {"lastProject", document.at("lastProject")}};
    if (document.contains("general")) result["general"] = document.at("general");
    for (auto& recent : result.at("recentProjects")) {
        std::error_code error;
        auto path = from_utf8(recent.at("path").get<std::string>());
        path.make_preferred();  // Stored paths use portable '/'; the \\?\ API needs '\'.
        recent["available"] = fs::is_directory(fs::path(api_path(path)), error);
    }
    return result;
}

std::string project_key(const std::string& root) {
    return utf8_path(pin_directory(absolute_path(from_utf8(root), true), Missing::allow).path);
}

std::string existing_project_key(const Json& projects, const std::string& root) {
    for (auto it = projects.begin(); it != projects.end(); ++it) {
        if (same_path(it.key(), root)) return it.key();
    }
    return root;
}

} // namespace

// Source: RecentProjectMetaInfo.activationTimestamp / projectName - the meta fields
// surface in the public state so the welcome screen can sort and label without
// re-reading the project directory.
std::int64_t utc_now_epoch() {
    FILETIME file{};
    GetSystemTimeAsFileTime(&file);
    ULARGE_INTEGER ticks{};
    ticks.LowPart = file.dwLowDateTime;
    ticks.HighPart = file.dwHighDateTime;
    return static_cast<std::int64_t>(ticks.QuadPart / 10000000ULL) - 11644473600LL;
}

// Public mirror of the internal defaults (projects.hpp): tests and any future caller
// assert against the real defaults instead of a hand-copied snapshot that drifts.
Json editor_defaults() { return editor_defaults_impl(); }

Json general_defaults() { return general_defaults_impl(); }

Json java_lsp_settings(const Json& java) {
    Json runtimes = Json::array();
    if (!java.at("jdkHome").get_ref<const std::string&>().empty())
        runtimes.push_back({{"name", java.at("jdkName")}, {"path", java.at("jdkHome")}, {"default", true}});
    return {{"java", {{"configuration", {{"runtimes", std::move(runtimes)}}},
                      {"project", {{"sourcePaths", java.at("sourcePaths")}, {"outputPath", java.at("outputPath")},
                                   {"referencedLibraries", java.at("referencedLibraries")}}}}}};
}

fs::path project_destination(const fs::path& parent, const std::string& name) {
    return boundary([&] {
        const auto component = from_utf8(name);
        validate_component(component.native());
        const auto pinned = pin_directory(parent);
        auto result = pinned.path / component;
        require_absent(result);
        return result;
    });
}

fs::path create_project(const fs::path& parent, const std::string& name, const std::string& kind) {
    return boundary([&] {
        if (kind != "empty" && kind != "cpp" && kind != "java" && kind != "spring-boot" &&
            kind != "maven" && kind != "gradle" && kind != "kotlin" && kind != "python" &&
            kind != "node" && kind != "vue" && kind != "react")
            fail("INVALID_TEMPLATE", "The selected project template is not supported.");
        const auto component = from_utf8(name);
        validate_component(component.native());
        auto pinned = pin_directory(parent);
        auto destination = pinned.path / component;
        require_absent(destination);
        auto temporary = temporary_object(pinned.path, true);
        // Children are destroyed before their owned directory on every failure path.
        std::vector<OwnedObject> children;
        std::vector<OwnedObject> directories;
        children.reserve(8);
        directories.reserve(4);
        if (kind == "cpp") {
            constexpr std::string_view cmake =
                "cmake_minimum_required(VERSION 3.20)\n"
                "project(TaoProject LANGUAGES CXX)\n\n"
                "add_executable(app main.cpp)\n"
                "target_compile_features(app PRIVATE cxx_std_20)\n";
            constexpr std::string_view main_cpp =
                "#include <iostream>\n\n"
                "int main() {\n"
                "    std::cout << \"Hello, TaoCode!\\n\";\n"
                "    return 0;\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"CMakeLists.txt"));
            write_and_flush(children.back().handle.get(), cmake);
            children.push_back(new_file(temporary.path / L"main.cpp"));
            write_and_flush(children.back().handle.get(), main_cpp);
        } else if (kind == "java") {
            directories.push_back(new_directory(temporary.path / L"src"));
            constexpr std::string_view main_java =
                "public class Main {\n"
                "    public static void main(String[] args) {\n"
                "        System.out.println(\"Hello, TaoCode!\");\n"
                "    }\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"src" / L"Main.java"));
            write_and_flush(children.back().handle.get(), main_java);
        } else if (kind == "spring-boot") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"java"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"resources"));
            constexpr std::string_view pom_xml =
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"\n"
                "         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n"
                "         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 "
                "http://maven.apache.org/xsd/maven-4.0.0.xsd\">\n"
                "    <modelVersion>4.0.0</modelVersion>\n"
                "    <parent>\n"
                "        <groupId>org.springframework.boot</groupId>\n"
                "        <artifactId>spring-boot-starter-parent</artifactId>\n"
                "        <version>3.2.0</version>\n"
                "    </parent>\n"
                "    <groupId>com.example</groupId>\n"
                "    <artifactId>demo</artifactId>\n"
                "    <version>0.0.1-SNAPSHOT</version>\n"
                "    <dependencies>\n"
                "        <dependency>\n"
                "            <groupId>org.springframework.boot</groupId>\n"
                "            <artifactId>spring-boot-starter-web</artifactId>\n"
                "        </dependency>\n"
                "    </dependencies>\n"
                "</project>\n";
            constexpr std::string_view application_java =
                "package com.example.demo;\n\n"
                "import org.springframework.boot.SpringApplication;\n"
                "import org.springframework.boot.autoconfigure.SpringBootApplication;\n\n"
                "@SpringBootApplication\n"
                "public class DemoApplication {\n"
                "    public static void main(String[] args) {\n"
                "        SpringApplication.run(DemoApplication.class, args);\n"
                "    }\n"
                "}\n";
            constexpr std::string_view application_properties =
                "server.port=8080\n";
            children.push_back(new_file(temporary.path / L"pom.xml"));
            write_and_flush(children.back().handle.get(), pom_xml);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"java" / L"DemoApplication.java"));
            write_and_flush(children.back().handle.get(), application_java);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"resources" / L"application.properties"));
            write_and_flush(children.back().handle.get(), application_properties);
        } else if (kind == "maven") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"java"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test" / L"java"));
            constexpr std::string_view pom_xml =
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"\n"
                "         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n"
                "         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 "
                "http://maven.apache.org/xsd/maven-4.0.0.xsd\">\n"
                "    <modelVersion>4.0.0</modelVersion>\n"
                "    <groupId>com.example</groupId>\n"
                "    <artifactId>demo</artifactId>\n"
                "    <version>1.0-SNAPSHOT</version>\n"
                "    <properties>\n"
                "        <maven.compiler.source>17</maven.compiler.source>\n"
                "        <maven.compiler.target>17</maven.compiler.target>\n"
                "    </properties>\n"
                "</project>\n";
            constexpr std::string_view main_java =
                "package com.example;\n\n"
                "public class Main {\n"
                "    public static void main(String[] args) {\n"
                "        System.out.println(\"Hello, TaoCode!\");\n"
                "    }\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"pom.xml"));
            write_and_flush(children.back().handle.get(), pom_xml);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"java" / L"Main.java"));
            write_and_flush(children.back().handle.get(), main_java);
        } else if (kind == "gradle") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"java"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test" / L"java"));
            constexpr std::string_view build_gradle =
                "plugins {\n"
                "    id 'java'\n"
                "}\n\n"
                "group = 'com.example'\n"
                "version = '1.0-SNAPSHOT'\n\n"
                "java {\n"
                "    sourceCompatibility = JavaVersion.VERSION_17\n"
                "    targetCompatibility = JavaVersion.VERSION_17\n"
                "}\n\n"
                "repositories {\n"
                "    mavenCentral()\n"
                "}\n\n"
                "dependencies {\n"
                "}\n";
            constexpr std::string_view main_java =
                "package com.example;\n\n"
                "public class Main {\n"
                "    public static void main(String[] args) {\n"
                "        System.out.println(\"Hello, TaoCode!\");\n"
                "    }\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"build.gradle"));
            write_and_flush(children.back().handle.get(), build_gradle);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"java" / L"Main.java"));
            write_and_flush(children.back().handle.get(), main_java);
        } else if (kind == "kotlin") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"kotlin"));
            constexpr std::string_view build_gradle_kts =
                "plugins {\n"
                "    kotlin(\"jvm\") version \"1.9.20\"\n"
                "}\n\n"
                "group = \"com.example\"\n"
                "version = \"1.0-SNAPSHOT\"\n\n"
                "repositories {\n"
                "    mavenCentral()\n"
                "}\n\n"
                "dependencies {\n"
                "    implementation(kotlin(\"stdlib\"))\n"
                "}\n";
            constexpr std::string_view main_kt =
                "package com.example\n\n"
                "fun main() {\n"
                "    println(\"Hello, TaoCode!\")\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"build.gradle.kts"));
            write_and_flush(children.back().handle.get(), build_gradle_kts);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"kotlin" / L"Main.kt"));
            write_and_flush(children.back().handle.get(), main_kt);
        } else if (kind == "python") {
            constexpr std::string_view main_py =
                "def main():\n"
                "    print(\"Hello, TaoCode!\")\n\n"
                "if __name__ == \"__main__\":\n"
                "    main()\n";
            constexpr std::string_view requirements_txt =
                "# Add your dependencies here\n"
                "# Example:\n"
                "# requests==2.31.0\n";
            children.push_back(new_file(temporary.path / L"main.py"));
            write_and_flush(children.back().handle.get(), main_py);
            children.push_back(new_file(temporary.path / L"requirements.txt"));
            write_and_flush(children.back().handle.get(), requirements_txt);
        } else if (kind == "node") {
            constexpr std::string_view package_json =
                "{\n"
                "  \"name\": \"demo\",\n"
                "  \"version\": \"1.0.0\",\n"
                "  \"description\": \"\",\n"
                "  \"main\": \"index.js\",\n"
                "  \"scripts\": {\n"
                "    \"start\": \"node index.js\"\n"
                "  },\n"
                "  \"keywords\": [],\n"
                "  \"author\": \"\",\n"
                "  \"license\": \"ISC\"\n"
                "}\n";
            constexpr std::string_view index_js =
                "console.log(\"Hello, TaoCode!\");\n";
            children.push_back(new_file(temporary.path / L"package.json"));
            write_and_flush(children.back().handle.get(), package_json);
            children.push_back(new_file(temporary.path / L"index.js"));
            write_and_flush(children.back().handle.get(), index_js);
        } else if (kind == "vue") {
            directories.push_back(new_directory(temporary.path / L"src"));
            constexpr std::string_view package_json =
                "{\n"
                "  \"name\": \"demo\",\n"
                "  \"version\": \"0.0.0\",\n"
                "  \"type\": \"module\",\n"
                "  \"scripts\": {\n"
                "    \"dev\": \"vite\",\n"
                "    \"build\": \"vite build\",\n"
                "    \"preview\": \"vite preview\"\n"
                "  },\n"
                "  \"dependencies\": {\n"
                "    \"vue\": \"^3.4.0\"\n"
                "  },\n"
                "  \"devDependencies\": {\n"
                "    \"@vitejs/plugin-vue\": \"^5.0.0\",\n"
                "    \"vite\": \"^5.0.0\"\n"
                "  }\n"
                "}\n";
            constexpr std::string_view vite_config_js =
                "import { defineConfig } from 'vite'\n"
                "import vue from '@vitejs/plugin-vue'\n\n"
                "export default defineConfig({\n"
                "  plugins: [vue()],\n"
                "})\n";
            constexpr std::string_view index_html =
                "<!DOCTYPE html>\n"
                "<html lang=\"zh-CN\">\n"
                "<head>\n"
                "    <meta charset=\"UTF-8\">\n"
                "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
                "    <title>Demo App</title>\n"
                "</head>\n"
                "<body>\n"
                "    <div id=\"app\"></div>\n"
                "    <script type=\"module\" src=\"/src/main.js\"></script>\n"
                "</body>\n"
                "</html>\n";
            constexpr std::string_view main_js =
                "import { createApp } from 'vue'\n"
                "import App from './App.vue'\n\n"
                "createApp(App).mount('#app')\n";
            constexpr std::string_view app_vue =
                "<template>\n"
                "  <div>\n"
                "    <h1>Hello, TaoCode!</h1>\n"
                "  </div>\n"
                "</template>\n\n"
                "<script setup>\n"
                "</script>\n\n"
                "<style>\n"
                "#app {\n"
                "  font-family: Avenir, Helvetica, Arial, sans-serif;\n"
                "  text-align: center;\n"
                "  color: #2c3e50;\n"
                "  margin-top: 60px;\n"
                "}\n"
                "</style>\n";
            children.push_back(new_file(temporary.path / L"package.json"));
            write_and_flush(children.back().handle.get(), package_json);
            children.push_back(new_file(temporary.path / L"vite.config.js"));
            write_and_flush(children.back().handle.get(), vite_config_js);
            children.push_back(new_file(temporary.path / L"index.html"));
            write_and_flush(children.back().handle.get(), index_html);
            children.push_back(new_file(temporary.path / L"src" / L"main.js"));
            write_and_flush(children.back().handle.get(), main_js);
            children.push_back(new_file(temporary.path / L"src" / L"App.vue"));
            write_and_flush(children.back().handle.get(), app_vue);
        } else if (kind == "react") {
            directories.push_back(new_directory(temporary.path / L"src"));
            constexpr std::string_view package_json =
                "{\n"
                "  \"name\": \"demo\",\n"
                "  \"version\": \"0.0.0\",\n"
                "  \"type\": \"module\",\n"
                "  \"scripts\": {\n"
                "    \"dev\": \"vite\",\n"
                "    \"build\": \"vite build\",\n"
                "    \"preview\": \"vite preview\"\n"
                "  },\n"
                "  \"dependencies\": {\n"
                "    \"react\": \"^18.2.0\",\n"
                "    \"react-dom\": \"^18.2.0\"\n"
                "  },\n"
                "  \"devDependencies\": {\n"
                "    \"@vitejs/plugin-react\": \"^4.2.0\",\n"
                "    \"vite\": \"^5.0.0\"\n"
                "  }\n"
                "}\n";
            constexpr std::string_view vite_config_js =
                "import { defineConfig } from 'vite'\n"
                "import react from '@vitejs/plugin-react'\n\n"
                "export default defineConfig({\n"
                "  plugins: [react()],\n"
                "})\n";
            constexpr std::string_view index_html =
                "<!DOCTYPE html>\n"
                "<html lang=\"zh-CN\">\n"
                "<head>\n"
                "    <meta charset=\"UTF-8\">\n"
                "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
                "    <title>Demo App</title>\n"
                "</head>\n"
                "<body>\n"
                "    <div id=\"root\"></div>\n"
                "    <script type=\"module\" src=\"/src/main.jsx\"></script>\n"
                "</body>\n"
                "</html>\n";
            constexpr std::string_view main_jsx =
                "import React from 'react'\n"
                "import ReactDOM from 'react-dom/client'\n"
                "import App from './App.jsx'\n\n"
                "ReactDOM.createRoot(document.getElementById('root')).render(\n"
                "  <React.StrictMode>\n"
                "    <App />\n"
                "  </React.StrictMode>,\n"
                ")\n";
            constexpr std::string_view app_jsx =
                "function App() {\n"
                "  return (\n"
                "    <div style={{ textAlign: 'center', marginTop: '60px' }}>\n"
                "      <h1>Hello, TaoCode!</h1>\n"
                "    </div>\n"
                "  )\n"
                "}\n\n"
                "export default App\n";
            children.push_back(new_file(temporary.path / L"package.json"));
            write_and_flush(children.back().handle.get(), package_json);
            children.push_back(new_file(temporary.path / L"vite.config.js"));
            write_and_flush(children.back().handle.get(), vite_config_js);
            children.push_back(new_file(temporary.path / L"index.html"));
            write_and_flush(children.back().handle.get(), index_html);
            children.push_back(new_file(temporary.path / L"src" / L"main.jsx"));
            write_and_flush(children.back().handle.get(), main_jsx);
            children.push_back(new_file(temporary.path / L"src" / L"App.jsx"));
            write_and_flush(children.back().handle.get(), app_jsx);
        }
        // Windows directory publication must not depend on open child handles.
        for (auto& child : children) child.handle.reset();
        for (auto& dir : directories) dir.handle.reset();
        require_absent(destination);
        rename_handle(temporary.handle.get(), destination, false);
        for (auto& child : children) child.cleanup = false;
        for (auto& dir : directories) dir.cleanup = false;
        temporary.cleanup = false;
        return destination;
    });
}

ProjectStore::ProjectStore(fs::path state_file)
    : state_file_(boundary([&] {
          auto path = absolute_path(std::move(state_file));
          if (path.filename().empty()) fail("INVALID_PATH", "The configuration needs a file name.");
          validate_component(path.filename().native());
          return path;
      })) {}

Json ProjectStore::state() {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        const auto loaded = load_state(state_file_);
        return public_state(loaded.document);
    });
}

void ProjectStore::opened(const Json& workspace) {
    boundary([&] {
        std::lock_guard lock(store_mutex);
        if (!workspace.is_object() || !workspace.contains("name") || !workspace.at("name").is_string() ||
            workspace.at("name").get_ref<const std::string&>().empty() ||
            !valid_utf8(workspace.at("name").get_ref<const std::string&>()) ||
            !workspace.contains("root") || !workspace.at("root").is_string() ||
            !workspace.contains("entries") || !workspace.at("entries").is_array())
            fail("INVALID_ARGUMENT", "opened requires the result of Workspace::open.");
        const auto pinned = pin_directory(absolute_path(from_utf8(workspace.at("root").get<std::string>()), true));
        const auto root = utf8_path(pinned.path);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        // Source: RecentProjectMetaInfo + RecentProjectsManagerBase.addRecentProject
        // sets activationTimestamp and displayName when the project is opened. We
        // stamp both here so the welcome screen can render branch/title without
        // re-reading the .idea directory (and so a future sync with a non-local
        // path - WSL or remote - keeps the cached fields).
        Json activation = Json::object();
        activation["name"] = workspace.at("name");
        activation["path"] = root;
        activation["lastOpened"] = utc_now();
        activation["activationTimestamp"] = static_cast<int64_t>(utc_now_epoch());
        if (workspace.contains("displayName") && workspace.at("displayName").is_string()
            && !workspace.at("displayName").get<std::string>().empty()) {
            activation["displayName"] = workspace.at("displayName");
        }
        if (workspace.contains("projectName") && workspace.at("projectName").is_string()
            && !workspace.at("projectName").get<std::string>().empty()) {
            activation["projectName"] = workspace.at("projectName");
        }
        if (workspace.contains("branch") && workspace.at("branch").is_string()
            && !workspace.at("branch").get<std::string>().empty()) {
            activation["branchName"] = workspace.at("branch");
        }
        Json recents = Json::array({activation});
        for (const auto& recent : next.at("recentProjects")) {
            if (recents.size() < recent_limit && !same_path(recent.at("path").get<std::string>(), root))
                recents.push_back(recent);
        }
        next["recentProjects"] = std::move(recents);
        next["lastProject"] = root;
        save_state(state_file_, loaded, next);
    });
}

void ProjectStore::closed() {
    boundary([&] {
        std::lock_guard lock(store_mutex);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        next["lastProject"] = nullptr;
        save_state(state_file_, loaded, next);
    });
}

Json ProjectStore::forget(const std::string& path) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        // Forgetting also works when the directory is gone, inaccessible or now a link.
        const auto key = utf8_path(absolute_path(from_utf8(path), true));
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        Json recents = Json::array();
        for (const auto& recent : next.at("recentProjects")) {
            if (!same_path(recent.at("path").get<std::string>(), key)) recents.push_back(recent);
        }
        next["recentProjects"] = std::move(recents);
        if (next.at("lastProject").is_string() && same_path(next.at("lastProject").get<std::string>(), key))
            next["lastProject"] = nullptr;
        auto result = public_state(next);
        save_state(state_file_, loaded, next);
        return result;
    });
}

// Source: RecentProjectsManagerBase.removePath (line 270-279) plus
// removePathsFromGroups (line 288-301). The IDE calls removePath once per path
// under one stateLock and fires fireChangeEvent() at the end; we replicate that
// by computing the removal set up front, applying the diff in a single state
// mutation, and returning the public state once. The path on disk is never
// touched — IDE's removePath also never deletes the directory.
Json ProjectStore::forget_many(const std::vector<std::string>& paths) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        // Canonicalise each input to its preferred form before comparing, then
        // match with the same_path predicate used by ProjectStore::forget so a
        // Windows drive-letter or casing variant still drops the right entry.
        std::vector<std::string> keys;
        keys.reserve(paths.size());
        for (const auto& path : paths) {
            if (path.empty()) continue;
            try {
                keys.push_back(utf8_path(absolute_path(from_utf8(path), true)));
            } catch (const WorkspaceError&) {
                // Bad path -> skip; the singular forget() fails the whole call,
                // but the batch call has to tolerate one bad entry.
            }
        }
        auto matches_any = [&](const std::string& candidate) {
            for (const auto& key : keys) if (same_path(candidate, key)) return true;
            return false;
        };
        if (keys.empty()) {
            return public_state(next);
        }
        Json recents = Json::array();
        for (const auto& recent : next.at("recentProjects")) {
            if (!matches_any(recent.at("path").get<std::string>())) recents.push_back(recent);
        }
        next["recentProjects"] = std::move(recents);
        if (next.at("lastProject").is_string()
            && matches_any(next.at("lastProject").get<std::string>())) {
            next["lastProject"] = nullptr;
        }
        auto result = public_state(next);
        save_state(state_file_, loaded, next);
        return result;
    });
}

namespace {
// The forward declarations of both functions live in the anonymous namespace opened at
// the top of this file, so the definitions have to be in that same namespace: an
// anonymous namespace injects its members into the enclosing one, and a second entity
// with an identical signature at `taocode` scope would make every later call ambiguous
// (MSVC C2668). Re-opening the unnamed namespace here refers to the same one.
//
// Source: platform/ide-core/src/com/intellij/ide/GeneralSettings.kt:227-266
// (GeneralSettingsState defaults) — TaoCode stores the same application-level
// component under the "general" key of its state document (IDEA writes
// ide.general.xml). Missing keys take the data-class defaults, like IDEA's
// noStateLoaded() -> loadState(GeneralSettingsState()).
}  // namespace

Json ProjectStore::update_general(const Json& patch) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        validate_general_patch(patch);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        if (!next.contains("general") || !next.at("general").is_object())
            next["general"] = general_defaults_impl();
        next["general"].update(patch);
        // GeneralSettings.inactiveTimeout getter/setter runs the value through
        // SAVE_FILES_AFTER_IDLE_SEC.fit (GeneralSettings.kt:193-202).
        auto& timeout = next.at("general").at("inactiveTimeout");
        timeout = std::max(1, std::min(300, timeout.get<int>()));
        auto result = next.at("general");
        save_state(state_file_, loaded, next);
        return result;
    });
}

Json ProjectStore::update_settings(const Json& patch) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        validate_editor_patch(patch);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        next["settings"].update(patch);
        auto result = next.at("settings");
        save_state(state_file_, loaded, next);
        return result;
    });
}

Json ProjectStore::project_settings(const std::string& root) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        const auto key = project_key(root);
        const auto loaded = load_state(state_file_);
        const auto& projects = loaded.document.at("perProject");
        const auto found = projects.find(existing_project_key(projects, key));
        // A project saved before a setting existed (or storing it as null) reads back
        // with the defaults for the missing keys, recursively.
        Json result = project_defaults();
        if (found != projects.end()) fill_defaults(result, *found);
        return result;
    });
}

Json ProjectStore::update_project_settings(const std::string& root, const Json& patch) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        validate_project_patch(patch);
        const auto key = project_key(root);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        auto& projects = next["perProject"];
        const auto existing = existing_project_key(projects, key);
        auto result = project_defaults();
        if (projects.contains(existing)) fill_defaults(result, projects.at(existing));
        result.merge_patch(patch);
        projects.erase(existing);
        projects[key] = result;
        save_state(state_file_, loaded, next);
        return result;
    });
}

} // namespace taocode
