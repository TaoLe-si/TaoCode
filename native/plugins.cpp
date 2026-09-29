#include "plugins.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <set>
#include <string>
#include <vector>

namespace taocode {
namespace plugins {
namespace {
namespace fs = std::filesystem;

constexpr std::size_t max_plugins = 200;
constexpr std::size_t max_commands = 100;
constexpr std::size_t max_templates = 100;
// 插件包解压后的上限。这不是"防大插件"，是防**一个包把插件目录灌满**：
// 一个 200 MB 的包解开可能是几十 GB（压缩炸弹），而插件目录是要被 `list()` 全量扫的。
constexpr std::size_t max_package_entries = 5000;
constexpr unsigned long long max_package_bytes = 128ull * 1024 * 1024;
constexpr DWORD package_timeout_ms = 60000;

const std::set<std::string> known_languages = {"java", "cpp", "typescript", "other"};

std::string text_or(const Json& value, const char* key, std::size_t limit) {
    if (!value.contains(key) || !value.at(key).is_string()) return {};
    const auto text = value.at(key).get<std::string>();
    return text.size() > limit ? std::string() : text;
}

// A plugin id becomes a directory name; keep it to the characters a safe name uses.
bool valid_id(const std::string& id) {
    if (id.empty() || id.size() > 64) return false;
    for (const char character : id) {
        const bool ok = (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') ||
                        character == '-' || character == '_' || character == '.';
        if (!ok) return false;
    }
    return id != "." && id != "..";
}

std::vector<Command> read_commands(const Json& contributes) {
    std::vector<Command> commands;
    if (!contributes.contains("commands")) return commands;
    const auto& values = contributes.at("commands");
    if (!values.is_array()) return commands;
    for (const auto& value : values) {
        if (!value.is_object() || commands.size() >= max_commands) continue;
        Command command;
        command.id = text_or(value, "id", 80);
        command.title = text_or(value, "title", 120);
        command.action = text_or(value, "action", 80);
        if (value.contains("group")) command.group = text_or(value, "group", 40);
        if (command.group.empty()) command.group = "插件";
        if (command.id.empty() || command.title.empty() || command.action.empty()) continue;
        commands.push_back(std::move(command));
    }
    return commands;
}

std::vector<Template> read_templates(const Json& contributes) {
    std::vector<Template> templates;
    if (!contributes.contains("templates")) return templates;
    const auto& values = contributes.at("templates");
    if (!values.is_array()) return templates;
    for (const auto& value : values) {
        if (!value.is_object() || templates.size() >= max_templates) continue;
        Template entry;
        entry.key = text_or(value, "key", 40);
        entry.body = text_or(value, "body", 8000);
        entry.description = text_or(value, "description", 120);
        if (!entry.key.empty() && entry.key[0] >= 'A' && entry.key[0] <= 'Z' &&
            std::all_of(entry.key.begin(), entry.key.end(), [](char c) {
                return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
            }) && !entry.body.empty() && !entry.description.empty()) {
            if (value.contains("languages") && value.at("languages").is_array())
                for (const auto& language : value.at("languages"))
                    if (language.is_string() && known_languages.contains(language.get<std::string>()))
                        entry.languages.push_back(language.get<std::string>());
            if (entry.languages.empty()) entry.languages.push_back("other");
            templates.push_back(std::move(entry));
        }
    }
    return templates;
}

// ---- 安装：id 推导、插件包解压、解压后的边界校验 ------------------------------

/**
 * 包名/目录名 → 合法 id：小写、非法字符折成 `-`、去掉首尾与连续的 `-`。
 * 本仓的约定是"目录名 = 插件 id"，所以非法名字要折成合法的（`My Plugin.zip` → `my-plugin`），
 * 而不是直接拒绝 —— 拒绝只会让用户对着一个下载下来的包无从下手。折不出东西才报错。
 */
std::string sanitize_id(const std::string& name) {
    std::string folded;
    for (const char character : name) {
        const char lowered = static_cast<char>(std::tolower(static_cast<unsigned char>(character)));
        const bool ok = (lowered >= 'a' && lowered <= 'z') || (lowered >= '0' && lowered <= '9') ||
                        lowered == '-' || lowered == '_' || lowered == '.';
        folded.push_back(ok ? lowered : '-');
    }
    std::string clean;
    for (const char character : folded) {
        if (character == '-' && !clean.empty() && clean.back() == '-') continue;
        clean.push_back(character);
    }
    while (!clean.empty() && (clean.front() == '-' || clean.front() == '.')) clean.erase(clean.begin());
    while (!clean.empty() && (clean.back() == '-' || clean.back() == '.')) clean.pop_back();
    return valid_id(clean) ? clean : std::string();
}

/** 清单里的可选 `id`：决定装到哪个目录名（`plugin.json` 优先于源名）。非法就当作没写。 */
std::string manifest_id(const fs::path& manifest) {
    std::ifstream stream(manifest, std::ios::binary);
    if (!stream) return {};
    try {
        const Json document = Json::parse(stream);
        if (!document.is_object()) return {};
        const std::string id = text_or(document, "id", 64);
        return valid_id(id) ? id : std::string();
    } catch (const Json::exception&) {
        return {};
    }
}

/** 按 CreateProcessW 自己的解析规则给参数加引号。 */
std::wstring quote_argument(const std::wstring& value) {
    std::wstring out = L"\"";
    for (const wchar_t character : value) {
        if (character == L'"') out.push_back(L'\\');
        out.push_back(character);
    }
    out.push_back(L'"');
    return out;
}

/** Windows 10 1803 起自带的 bsdtar：zip 里的 deflate 交给它，原生层不用引压缩库。 */
std::wstring tar_executable() {
    wchar_t buffer[MAX_PATH]{};
    const UINT length = GetWindowsDirectoryW(buffer, MAX_PATH);
    if (length == 0 || length >= MAX_PATH) return L"C:\\Windows\\System32\\tar.exe";
    return std::wstring(buffer, length) + L"\\System32\\tar.exe";
}

/** 跑一条命令行并等它结束（输出丢进 NUL，免得污染宿主控制台）。返回退出码，起不来返回 -1。 */
int run_tool(const std::wstring& command) {
    std::vector<wchar_t> mutable_command(command.begin(), command.end());
    mutable_command.push_back(L'\0');
    SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE sink = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &inheritable,
                              OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    const bool redirected = sink != INVALID_HANDLE_VALUE;
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    if (redirected) {
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdInput = sink;
        startup.hStdOutput = sink;
        startup.hStdError = sink;
    }
    PROCESS_INFORMATION info{};
    const BOOL created = CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, redirected,
                                        CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr,
                                        &startup, &info);
    if (redirected) CloseHandle(sink);
    if (!created) return -1;
    int code = 1;
    if (WaitForSingleObject(info.hProcess, package_timeout_ms) == WAIT_TIMEOUT) {
        TerminateProcess(info.hProcess, 1);
        WaitForSingleObject(info.hProcess, 5000);
        code = 2;
    } else {
        DWORD exit_code = 1;
        GetExitCodeProcess(info.hProcess, &exit_code);
        code = static_cast<int>(exit_code);
    }
    CloseHandle(info.hProcess);
    CloseHandle(info.hThread);
    return code;
}

/** 解压后的边界校验：全部落在 root 之内（防 zip-slip），且条目数与总体积有上限。 */
bool audit_tree(const fs::path& root, std::string& problem) {
    std::error_code ec;
    const fs::path base = fs::weakly_canonical(root, ec);
    if (base.empty()) {
        problem = "无法确认解压目录";
        return false;
    }
    std::size_t entries = 0;
    unsigned long long bytes = 0;
    const fs::recursive_directory_iterator end;
    for (fs::recursive_directory_iterator current(root, fs::directory_options::skip_permission_denied, ec);
         current != end; current.increment(ec)) {
        if (ec) break;
        if (current->is_directory(ec) || !current->is_regular_file(ec)) continue;
        const fs::path target = fs::weakly_canonical(current->path(), ec);
        const fs::path relative = target.lexically_relative(base);
        // `lexically_relative` 在目标不在 base 之下时会以 `..` 开头 —— 那就是越界的条目。
        if (relative.empty() || relative.native().rfind(L"..", 0) == 0) {
            problem = "插件包里有指向包外的条目，已中止安装。";
            return false;
        }
        if (++entries > max_package_entries) {
            problem = "插件包文件数超过上限（" + std::to_string(max_package_entries) + "）。";
            return false;
        }
        bytes += static_cast<unsigned long long>(current->file_size(ec));
        if (bytes > max_package_bytes) {
            problem = "插件包解压后超过 128 MB。";
            return false;
        }
    }
    return true;
}

/** 包内清单的位置：根，或**唯一一层**顶层目录里（`my-plugin-1.0/plugin.json` 这种打包方式）。 */
fs::path package_root(const fs::path& staging) {
    std::error_code ec;
    if (fs::exists(staging / "plugin.json", ec)) return staging;
    fs::path only;
    std::size_t directories = 0;
    for (const auto& entry : fs::directory_iterator(staging, fs::directory_options::skip_permission_denied, ec)) {
        if (!entry.is_directory(ec)) continue;
        // macOS 压出来的 `__MACOSX` 是元数据，不该挡住"唯一顶层目录"的判断。
        if (entry.path().filename() == "__MACOSX") continue;
        ++directories;
        only = entry.path();
    }
    if (directories == 1 && fs::exists(only / "plugin.json", ec)) return only;
    return {};
}

/**
 * 解压插件包到 `staging`（清理由调用方负责），返回包内清单所在目录。
 * 失败抛 `WorkspaceError`：装不上要能说清为什么，而不是留一个空目录让人猜。
 */
fs::path unpack_package(const fs::path& package, const fs::path& staging) {
    const std::wstring tar = tar_executable();
    std::error_code ec;
    if (!fs::exists(fs::path(tar), ec))
        throw WorkspaceError("NO_UNPACKER", "系统里找不到 tar.exe（Windows 10 1803 起自带），无法解开插件包。");
    fs::create_directories(staging, ec);
    const std::wstring command = quote_argument(tar) + L" -xf " + quote_argument(package.native()) +
                                 L" -C " + quote_argument(staging.native());
    if (run_tool(command) != 0)
        throw WorkspaceError("UNPACK_FAILED", "插件包解压失败（可能不是合法的 zip / jar）。");
    std::string problem;
    if (!audit_tree(staging, problem)) throw WorkspaceError("UNPACK_FAILED", problem);
    const fs::path root = package_root(staging);
    if (root.empty())
        throw WorkspaceError("INVALID_PLUGIN",
                             "插件包里找不到 plugin.json（清单要直接在包根，或包内只有一个顶层目录）。");
    return root;
}

}  // namespace

Json to_json(const std::vector<Plugin>& plugins) {
    Json list = Json::array();
    for (const auto& plugin : plugins) {
        Json commands = Json::array();
        for (const auto& command : plugin.commands)
            commands.push_back({{"id", command.id}, {"title", command.title},
                                {"action", command.action}, {"group", command.group}});
        Json templates = Json::array();
        for (const auto& entry : plugin.templates)
            templates.push_back({{"key", entry.key}, {"body", entry.body},
                                 {"description", entry.description}, {"languages", entry.languages}});
        Json value{{"id", plugin.id}, {"name", plugin.name}, {"version", plugin.version},
                   {"description", plugin.description}, {"category", plugin.category},
                   {"path", plugin.path}, {"enabled", plugin.enabled},
                   {"commands", std::move(commands)}, {"templates", std::move(templates)}};
        if (!plugin.error.empty()) value["error"] = plugin.error;
        list.push_back(std::move(value));
    }
    return {{"plugins", std::move(list)}};
}

std::vector<Plugin> list(const fs::path& directory) {
    std::vector<Plugin> result;
    std::error_code ec;
    // A missing plugins directory is not an error: there simply is nothing
    // installed. (The old code created it after the `!exists` early return, so the
    // create_directories call could never run.)
    if (!fs::exists(directory, ec)) return result;
    for (const auto& entry : fs::directory_iterator(directory, fs::directory_options::skip_permission_denied, ec)) {
        if (result.size() >= max_plugins) break;
        if (!entry.is_directory(ec)) continue;
        Plugin plugin;
        plugin.id = entry.path().filename().string();
        plugin.path = entry.path().string();
        plugin.enabled = !fs::exists(entry.path() / ".disabled", ec);
        const auto manifest = entry.path() / "plugin.json";
        std::ifstream stream(manifest, std::ios::binary);
        if (!stream) { plugin.error = "缺少 plugin.json"; plugin.name = plugin.id; result.push_back(std::move(plugin)); continue; }
        try {
            const Json document = Json::parse(stream);
            if (!document.is_object()) { plugin.error = "plugin.json 不是对象"; plugin.name = plugin.id; result.push_back(std::move(plugin)); continue; }
            plugin.name = text_or(document, "name", 120);
            plugin.version = text_or(document, "version", 40);
            plugin.description = text_or(document, "description", 400);
            plugin.category = text_or(document, "category", 40);
            if (plugin.name.empty()) plugin.name = plugin.id;
            if (document.contains("contributes") && document.at("contributes").is_object()) {
                plugin.commands = read_commands(document.at("contributes"));
                plugin.templates = read_templates(document.at("contributes"));
            }
        } catch (const Json::exception&) {
            plugin.error = "plugin.json 不是合法 JSON";
            plugin.name = plugin.id;
        }
        result.push_back(std::move(plugin));
    }
    std::sort(result.begin(), result.end(), [](const Plugin& a, const Plugin& b) { return a.id < b.id; });
    return result;
}

void set_enabled(const fs::path& directory, const std::string& id, bool enabled) {
    if (!valid_id(id)) throw WorkspaceError("INVALID_REQUEST", "插件 id 只能是小写字母、数字、- _ . 且不超过 64 字符。");
    const fs::path target = directory / id;
    std::error_code ec;
    if (!fs::exists(target, ec) || !fs::is_directory(target, ec))
        throw WorkspaceError("NOT_FOUND", "找不到插件目录：" + id);
    const fs::path marker = target / ".disabled";
    if (enabled) {
        if (fs::exists(marker, ec) && !fs::remove(marker, ec))
            throw WorkspaceError("IO_ERROR", "无法启用插件（删除 .disabled 失败）。");
        return;
    }
    if (fs::exists(marker, ec)) return;
    std::ofstream stream(marker, std::ios::binary | std::ios::trunc);
    if (!stream) throw WorkspaceError("IO_ERROR", "无法停用插件（写入 .disabled 失败）。");
    stream << "disabled\n";
}

void install(const fs::path& directory, const fs::path& source) {
    std::error_code ec;
    const char* const missing = "请选择一个插件包（.zip / .jar）或包含 plugin.json 的目录。";
    if (source.empty() || !fs::exists(source, ec)) throw WorkspaceError("NOT_FOUND", missing);
    const bool packaged = fs::is_regular_file(source, ec);
    if (!packaged && !fs::is_directory(source, ec)) throw WorkspaceError("NOT_FOUND", missing);

    fs::create_directories(directory, ec);

    // 解压落在插件目录内部：与目标同盘（rename 才快且原子），失败也一并清理。
    fs::path staging;
    fs::path root = source;
    if (packaged) {
        const std::string stem = sanitize_id(source.stem().string());
        staging = directory / ("." + (stem.empty() ? std::string("package") : stem) + ".unpack");
        if (fs::exists(staging, ec)) fs::remove_all(staging, ec);
    }
    const auto sweep = [&staging]() {
        if (staging.empty()) return;
        std::error_code cleanup;
        fs::remove_all(staging, cleanup);
    };

    try {
        if (packaged) root = unpack_package(source, staging);
        const fs::path manifest = root / "plugin.json";
        if (!fs::exists(manifest, ec) || !fs::is_regular_file(manifest, ec))
            throw WorkspaceError("INVALID_PLUGIN", packaged ? "插件包里找不到 plugin.json。"
                                                           : "所选目录里没有 plugin.json，不是合法的插件目录。");
        // id 来源：清单的 `id` → 源名折成合法 id。容器名（包名/目录名）只是兜底。
        std::string id = manifest_id(manifest);
        if (id.empty()) id = sanitize_id(packaged ? source.stem().string() : source.filename().string());
        if (id.empty())
            throw WorkspaceError("INVALID_PLUGIN",
                                 "无法从名字推导插件 id —— 请在 plugin.json 里写 \"id\"（小写字母、数字、- _ .）。");
        const fs::path target = directory / id;
        if (fs::exists(target, ec))
            throw WorkspaceError("ALREADY_EXISTS", "已经安装了同名插件：" + id + "。请先卸载它，或改 plugin.json 里的 id。");
        // 先复制到临时目录再改名：中途失败不会留下半个插件。
        const fs::path temporary = directory / (".installing-" + id);
        if (fs::exists(temporary, ec)) fs::remove_all(temporary, ec);
        fs::copy(root, temporary, fs::copy_options::recursive | fs::copy_options::copy_symlinks, ec);
        if (ec) throw WorkspaceError("IO_ERROR", "复制插件文件失败：" + ec.message());
        fs::rename(temporary, target, ec);
        if (ec) {
            std::error_code cleanup;
            fs::remove_all(temporary, cleanup);
            throw WorkspaceError("IO_ERROR", "无法把插件放到插件目录：" + ec.message());
        }
    } catch (...) {
        sweep();
        throw;
    }
    sweep();
}

void uninstall(const fs::path& directory, const std::string& id) {
    if (!valid_id(id))
        throw WorkspaceError("INVALID_REQUEST", "插件 id 只能是小写字母、数字、- _ . 且不超过 64 个字符。");
    const fs::path target = directory / id;
    std::error_code ec;
    if (!fs::exists(target, ec) || !fs::is_directory(target, ec))
        throw WorkspaceError("NOT_FOUND", "找不到插件目录：" + id);
    fs::remove_all(target, ec);
    if (ec) throw WorkspaceError("IO_ERROR", "卸载失败（可能有文件被占用）：" + ec.message());
}

}  // namespace plugins
}  // namespace taocode
