#include "agent_memory.hpp"

#include "text.hpp"

#include <windows.h>
#include <shlobj.h>

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <fstream>
#include <optional>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace taocode::agent_memory {
namespace fs = std::filesystem;

namespace {
constexpr std::uintmax_t kProjectMemoryPreviewMaxBytes = 5ull * 1024ull * 1024ull;

struct MemoryFile {
    std::string name;
    fs::path path;
    std::string kind;
    std::uintmax_t size{};
    std::int64_t updated_at{};
};

struct MemoryWorkspace {
    std::string id;
    std::string label;
    std::int64_t updated_at{};
    std::vector<MemoryFile> files;
};

bool is_missing(const std::error_code& error) {
    return error == std::errc::no_such_file_or_directory || error == std::errc::not_a_directory;
}

[[noreturn]] void fail_io(const std::string& action, const std::error_code& error) {
    throw WorkspaceError("IO_ERROR", action + ": " + error.message());
}

std::wstring trim(std::wstring value) {
    const auto first = value.find_first_not_of(L" \t\r\n");
    if (first == std::wstring::npos) return {};
    const auto last = value.find_last_not_of(L" \t\r\n");
    return value.substr(first, last - first + 1);
}

std::wstring environment_value(const wchar_t* name) {
    const DWORD needed = GetEnvironmentVariableW(name, nullptr, 0);
    if (needed == 0) return {};
    std::wstring value(needed, L'\0');
    const DWORD written = GetEnvironmentVariableW(name, value.data(), needed);
    if (written == 0 || written >= needed) return {};
    value.resize(written);
    return trim(std::move(value));
}

fs::path profile_home() {
    PWSTR raw = nullptr;
    const HRESULT result = SHGetKnownFolderPath(FOLDERID_Profile, 0, nullptr, &raw);
    if (FAILED(result) || !raw) throw WorkspaceError("MEMORY_HOME_UNAVAILABLE", "无法定位用户目录。");
    fs::path home(raw);
    CoTaskMemFree(raw);
    return home;
}

fs::path configured_data_base(const fs::path& home) {
    const fs::path bootstrap_settings = home / L".zcode" / L"v2" / L"setting.json";
    try {
        std::ifstream input(bootstrap_settings, std::ios::binary);
        if (input) {
            Json settings;
            input >> settings;
            if (settings.is_object() && settings.contains("dataBaseDir") && settings.at("dataBaseDir").is_string()) {
                const auto value = trim(wide(settings.at("dataBaseDir").get<std::string>()));
                if (!value.empty()) return fs::path(value);
            }
        }
    } catch (...) {
    }

    const auto environment_base = environment_value(L"ZCODE_DATA_BASE_DIR");
    if (!environment_base.empty()) return fs::path(environment_base);
    const auto home_environment = environment_value(L"HOME");
    if (!home_environment.empty()) return fs::path(home_environment);
    return home;
}

fs::path projects_root(const fs::path& home) {
    return fs::absolute(configured_data_base(home) / L".zcode" / L"cli" / L"memories" / L"projects").lexically_normal();
}

fs::file_status status_of(const fs::path& path, const std::string& action) {
    std::error_code error;
    const auto status = fs::symlink_status(path, error);
    if (error) {
        if (is_missing(error)) return fs::file_status(fs::file_type::not_found);
        fail_io(action, error);
    }
    return status;
}

bool is_plain_directory(const fs::path& path) {
    return fs::is_directory(status_of(path, "无法读取记忆目录"));
}

bool is_memory_file_name(const std::string& name) {
    if (name == "MEMORY.md") return true;
    return name.size() >= 3 && name.ends_with(".md");
}

bool is_path_segment(const std::string& value) {
    return !value.empty() && value != "." && value != ".." &&
           value.find_first_of("/\\") == std::string::npos &&
           value.find('\0') == std::string::npos;
}

std::string workspace_label(const std::string& id) {
    const auto dash = id.rfind('-');
    if (dash == std::string::npos || id.size() - dash - 1 != 16) return id;
    for (std::size_t index = dash + 1; index < id.size(); ++index) {
        if (!std::isxdigit(static_cast<unsigned char>(id[index]))) return id;
    }
    const auto candidate = id.substr(0, dash);
    const auto first = candidate.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return id;
    const auto last = candidate.find_last_not_of(" \t\r\n");
    return candidate.substr(first, last - first + 1);
}

std::string lower_ascii(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::optional<std::int64_t> modified_at_ms(const fs::path& path) {
    std::error_code error;
    const auto modified = fs::last_write_time(path, error);
    if (error) {
        if (is_missing(error)) return std::nullopt;
        fail_io("无法读取记忆文件更新时间", error);
    }
    const auto system_time = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
        modified - fs::file_time_type::clock::now() + std::chrono::system_clock::now());
    return std::chrono::duration_cast<std::chrono::milliseconds>(system_time.time_since_epoch()).count();
}

void list_files(const fs::path& memory_root, std::vector<MemoryFile>& files) {
    std::error_code error;
    fs::directory_iterator current(memory_root, error), end;
    if (error) {
        if (is_missing(error)) return;
        fail_io("无法读取记忆文件清单", error);
    }

    for (; current != end; current.increment(error)) {
        if (error) {
            if (is_missing(error)) break;
            fail_io("无法读取记忆文件清单", error);
        }
        const auto path = current->path();
        const auto name = utf8(path.filename().native());
        if (!is_memory_file_name(name) || !fs::is_regular_file(status_of(path, "无法读取记忆文件"))) continue;

        std::error_code size_error;
        const auto size = fs::file_size(path, size_error);
        if (size_error) {
            if (is_missing(size_error)) continue;
            fail_io("无法读取记忆文件大小", size_error);
        }
        const auto updated_at = modified_at_ms(path);
        if (!updated_at) continue;

        files.push_back({
            name,
            fs::absolute(path).lexically_normal(),
            name == "MEMORY.md" ? "index" : "item",
            size,
            *updated_at,
        });
    }

    std::sort(files.begin(), files.end(), [](const MemoryFile& left, const MemoryFile& right) {
        if (left.kind != right.kind) return left.kind == "index";
        const auto left_name = lower_ascii(left.name);
        const auto right_name = lower_ascii(right.name);
        return left_name == right_name ? left.name < right.name : left_name < right_name;
    });
}

}  // namespace

Json list_project_memories_for_root(const fs::path& root) {
    const auto root_status = status_of(root, "无法读取 Project Memory 根目录");
    if (root_status.type() == fs::file_type::not_found) return Json::array();
    if (fs::is_symlink(root_status) || !fs::is_directory(root_status)) {
        throw WorkspaceError("INVALID_PATH", "Project Memory 根目录不是普通目录。");
    }

    std::vector<MemoryWorkspace> workspaces;
    std::error_code error;
    fs::directory_iterator current(root, error), end;
    if (error) {
        if (is_missing(error)) return Json::array();
        fail_io("无法读取 Project Memory 工作区", error);
    }

    for (; current != end; current.increment(error)) {
        if (error) {
            if (is_missing(error)) break;
            fail_io("无法读取 Project Memory 工作区", error);
        }
        const auto workspace_root = current->path();
        const auto workspace_status = status_of(workspace_root, "无法读取记忆工作区");
        if (!fs::is_directory(workspace_status) || fs::is_symlink(workspace_status)) continue;

        const auto memory_root = workspace_root / L"memory";
        const auto memory_status = status_of(memory_root, "无法读取记忆目录");
        if (!fs::is_directory(memory_status) || fs::is_symlink(memory_status)) continue;

        std::vector<MemoryFile> files;
        list_files(memory_root, files);
        if (files.empty()) continue;

        std::int64_t updated_at = files.front().updated_at;
        for (const auto& file : files) updated_at = std::max(updated_at, file.updated_at);
        const auto id = utf8(workspace_root.filename().native());
        workspaces.push_back({id, workspace_label(id), updated_at, std::move(files)});
    }

    std::sort(workspaces.begin(), workspaces.end(), [](const MemoryWorkspace& left, const MemoryWorkspace& right) {
        if (left.updated_at != right.updated_at) return left.updated_at > right.updated_at;
        return left.id < right.id;
    });

    Json result = Json::array();
    for (const auto& workspace : workspaces) {
        Json files = Json::array();
        for (const auto& file : workspace.files) {
            files.push_back({
                {"name", file.name},
                {"path", utf8(file.path.native())},
                {"kind", file.kind},
                {"size", file.size},
                {"updatedAt", file.updated_at},
            });
        }
        result.push_back({
            {"id", workspace.id},
            {"label", workspace.label},
            {"updatedAt", workspace.updated_at},
            {"files", std::move(files)},
        });
    }
    return result;
}

bool catalog_contains_file(const Json& catalog, const std::string& workspace_id,
                           const std::string& file_name, std::uintmax_t& size) {
    for (const auto& workspace : catalog) {
        if (workspace.value("id", std::string()) != workspace_id || !workspace.contains("files") ||
            !workspace.at("files").is_array()) continue;
        for (const auto& file : workspace.at("files")) {
            if (file.value("name", std::string()) != file_name) continue;
            size = file.value("size", std::uintmax_t{});
            return true;
        }
    }
    return false;
}

Json list_project_memories() {
    return list_project_memories_for_root(projects_root(profile_home()));
}

Json read_project_memory_file(const std::string& workspace_id, const std::string& file_name) {
    if (!is_path_segment(workspace_id) || !is_path_segment(file_name) || !is_memory_file_name(file_name)) {
        throw WorkspaceError("INVALID_PATH", "Project Memory path is invalid.");
    }
    try {
        (void)wide(workspace_id);
        (void)wide(file_name);
    } catch (...) {
        throw WorkspaceError("INVALID_PATH", "Project Memory path is invalid.");
    }

    const auto root = projects_root(profile_home());
    const auto catalog = list_project_memories_for_root(root);
    std::uintmax_t size = 0;
    if (!catalog_contains_file(catalog, workspace_id, file_name, size)) {
        throw WorkspaceError("MEMORY_FILE_NOT_FOUND", "Project Memory file is not in the current catalog.");
    }
    if (size > kProjectMemoryPreviewMaxBytes) {
        throw WorkspaceError("PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED", "Project Memory file exceeds the 5 MiB preview limit.");
    }

    const auto relative = workspace_id + "/memory/" + file_name;
    const auto file = Workspace::read_from_root(root, relative, "utf-8",
                                                static_cast<std::size_t>(kProjectMemoryPreviewMaxBytes));
    return {{"content", file.at("content")}};
}

}  // namespace taocode::agent_memory
