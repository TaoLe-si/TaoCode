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
#include <functional>
#include <map>
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
// 一个清单能声明的文件类型条数上限（上游没有这一档，但 `<fileType>` 是会进注册表的入口点）。
constexpr std::size_t max_file_types = 50;
// 一条关联属性（分号分隔）的长度上限。
constexpr std::size_t max_associations = 500;
// 一个清单能声明的依赖条数上限 —— 防一个手写/生成的清单把依赖图撑成无限大。
constexpr std::size_t max_dependencies = 32;
// 插件包解压后的上限。这不是"防大插件"，是防**一个包把插件目录灌满**：
// 一个 200 MB 的包解开可能是几十 GB（压缩炸弹），而插件目录是要被 `list()` 全量扫的。
constexpr std::size_t max_package_entries = 5000;
constexpr unsigned long long max_package_bytes = 128ull * 1024 * 1024;
constexpr DWORD package_timeout_ms = 60000;

const std::set<std::string> known_languages = {"java", "cpp", "typescript", "other"};

/** 剪掉首尾 ASCII 空白 —— 清单是人手写的，" name " 与 "name" 必须同义（否则空名字的
 *  兜底、命令 id 的去重、长度上限都会因为几个空格而判错）。 */
std::string trimmed(const std::string& value) {
    const auto space = [](char character) {
        return character == ' ' || character == '\t' || character == '\r' || character == '\n';
    };
    std::size_t begin = 0;
    std::size_t end = value.size();
    while (begin < end && space(value[begin])) ++begin;
    while (end > begin && space(value[end - 1])) --end;
    return value.substr(begin, end - begin);
}

std::string text_or(const Json& value, const char* key, std::size_t limit) {
    if (!value.contains(key) || !value.at(key).is_string()) return {};
    const auto text = trimmed(value.at(key).get<std::string>());
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
    std::set<std::string> seen;
    for (const auto& value : values) {
        if (!value.is_object() || commands.size() >= max_commands) continue;
        Command command;
        command.id = text_or(value, "id", 80);
        command.title = text_or(value, "title", 120);
        command.action = text_or(value, "action", 80);
        if (value.contains("group")) command.group = text_or(value, "group", 40);
        if (command.group.empty()) command.group = "插件";
        // 空白值（`"title": "   "`）与缺字段同样处理：`text_or` 已剪过首尾空白，这里只认空串。
        if (command.id.empty() || command.title.empty() || command.action.empty()) continue;
        // 行 id 是 `plugin.<插件 id>.<命令 id>`，同一个插件里重复的命令 id 会让菜单/命令面板
        // 出现两行同 id 的条目（Vue 的 key 也会撞）。重复的取第一条，后一条丢掉。
        if (!seen.insert(command.id).second) continue;
        commands.push_back(std::move(command));
    }
    return commands;
}

/**
 * 清单里的依赖声明：`depends`（必需）/ `optionalDepends`（可选）都取字符串数组。
 * 非法 id、空串与自己（`self`）都丢掉 —— 一个指向自己的依赖会立刻死循环；
 * 重复 id 取第一条；条数上限 `max_dependencies`。
 * 读不出来的形状（不是数组 / 元素不是字符串）与「没写」同义，不报错：
 * 依赖是清单的附加声明，不该因为一个手滑的 `"depends": "a"` 就让整个插件变成坏清单。
 */
std::vector<std::string> read_dependencies(const Json& document, const char* key, const std::string& self) {
    std::vector<std::string> result;
    if (!document.contains(key) || !document.at(key).is_array()) return result;
    std::set<std::string> seen;
    for (const auto& value : document.at(key)) {
        if (!value.is_string() || result.size() >= max_dependencies) continue;
        const std::string id = trimmed(value.get<std::string>());
        if (!valid_id(id) || id == self) continue;
        if (seen.insert(id).second) result.push_back(id);
    }
    return result;
}

/** 把 id 列表拼成一句人话（`a、b`）；空列表给空串。 */
std::string joined(const std::vector<std::string>& values) {
    std::string text;
    for (const auto& value : values) {
        if (!text.empty()) text += "、";
        text += value;
    }
    return text;
}

std::vector<Template> read_templates(const Json& contributes) {
    std::vector<Template> templates;
    if (!contributes.contains("templates")) return templates;
    const auto& values = contributes.at("templates");
    if (!values.is_array()) return templates;
    std::set<std::string> seen;
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
            // 同一个 key 在模板列表里只能展开到一个模板（用户模板也是这么遮蔽内建的）：
            // 重复 key 取第一条，否则 `effectiveTemplates` 的遮蔽关系会随清单顺序漂移。
            if (!seen.insert(entry.key).second) continue;
            templates.push_back(std::move(entry));
        }
    }
    return templates;
}

/**
 * `contributes.fileTypes` —— 上游 `com.intellij.fileType` EP 的一个 `<fileType>` 标签
 * （`FileTypeBean.java`：`name` 是 `@RequiredElement` :93；两种用法见 :26-43）。
 * native 只把关**形状、长度与重名**，分号拆分与匹配器构造留给前端那一份
 * （`parseFileTypeBean`，`src/fileTypeRegistry.ts:217`），免得规则漂成两套。
 * 语言只认编辑器知道的四种（与 `read_templates` 同一张 `known_languages` 表）。
 */
std::vector<FileTypeContribution> read_file_types(const Json& contributes) {
    std::vector<FileTypeContribution> result;
    if (!contributes.contains("fileTypes")) return result;
    const auto& values = contributes.at("fileTypes");
    if (!values.is_array()) return result;
    std::set<std::string> seen;
    for (const auto& value : values) {
        if (!value.is_object() || result.size() >= max_file_types) continue;
        FileTypeContribution entry;
        entry.name = text_or(value, "name", 80);
        // 上游 `name` 缺了就是坏标签（`PluginException`）；本仓整条丢掉，不留一个空名字的类型。
        if (entry.name.empty()) continue;
        entry.implementation_class = text_or(value, "implementationClass", 200);
        entry.field_name = text_or(value, "fieldName", 60);
        entry.language = text_or(value, "language", 40);
        if (!entry.language.empty() && !known_languages.contains(entry.language)) entry.language.clear();
        entry.extensions = text_or(value, "extensions", max_associations);
        entry.file_names = text_or(value, "fileNames", max_associations);
        entry.patterns = text_or(value, "patterns", max_associations);
        entry.file_names_case_insensitive = text_or(value, "fileNamesCaseInsensitive", max_associations);
        entry.hash_bangs = text_or(value, "hashBangs", max_associations);
        // 一条什么关联都没声明的标签在这里不收：上游会给它一张空匹配器表，
        // 本仓的设置页上就多出一行既判不出文件又抢不走的插件类型。
        if (entry.extensions.empty() && entry.file_names.empty() && entry.patterns.empty() &&
            entry.file_names_case_insensitive.empty() && entry.hash_bangs.empty()) continue;
        // 重名：上游是「两个类型用同一个 name 是错误」（`FileTypeBean.java:49-54`）。
        // native 先收第一条、按大小写不敏感判重（`FileTypeManagerImpl.java:1499-1501` 那种
        // equalsIgnoreCase 的口径），后面的整条丢掉；前端还会跨插件再核一次。
        std::string folded = entry.name;
        for (char& character : folded) if (character >= 'A' && character <= 'Z') character += 32;
        if (!seen.insert(folded).second) continue;
        result.push_back(std::move(entry));
    }
    return result;
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

/**
 * 必需依赖图上的强连通分量（Tarjan）。只收**非平凡**分量（≥ 2 个插件）：依赖不能指向自己
 * （`read_dependencies` 已经把 `self` 丢掉），所以剩下的每个分量都是一个真循环。
 *
 * 边只连到「装着且清单读得出来」的依赖：坏清单的插件自己已经是无效的，把它拉进环里只会
 * 把「依赖缺失」和「成环」两个原因搅在一起（上游也是先解析清单再谈成环的）。
 *
 * 循环是**不可修复**的缺陷 —— 与缺依赖（装上就好）、依赖停用（启用就好）都不同，
 * 它只能改清单。所以 `list()` 把它单独记一格 `dependency_cycle`，`set_enabled` 直接拒绝启用。
 * 上游依据：`PluginManagerStateService.kt:175-202` + `CoreBundle.properties:32`。
 */
std::vector<std::vector<std::string>> dependency_cycles(const std::map<std::string, const Plugin*>& by_id) {
    std::map<std::string, std::vector<std::string>> adjacency;
    for (const auto& entry : by_id) {
        for (const auto& dependency : entry.second->depends) {
            const auto found = by_id.find(dependency);
            if (found == by_id.end() || !found->second->error.empty()) continue;
            adjacency[entry.first].push_back(dependency);
        }
    }
    std::map<std::string, int> index, low;
    std::vector<std::string> stack;
    std::set<std::string> on_stack;
    std::vector<std::vector<std::string>> cycles;
    int counter = 0;
    std::function<void(const std::string&)> strong_connect = [&](const std::string& node) {
        index[node] = counter;
        low[node] = counter;
        ++counter;
        stack.push_back(node);
        on_stack.insert(node);
        for (const auto& next : adjacency[node]) {
            if (!index.count(next)) {
                strong_connect(next);
                low[node] = std::min(low[node], low[next]);
            } else if (on_stack.count(next)) {
                low[node] = std::min(low[node], index[next]);
            }
        }
        if (low[node] != index[node]) return;
        std::vector<std::string> component;
        for (;;) {
            const std::string member = stack.back();
            stack.pop_back();
            on_stack.erase(member);
            component.push_back(member);
            if (member == node) break;
        }
        if (component.size() > 1) {
            std::sort(component.begin(), component.end());
            cycles.push_back(std::move(component));
        }
    };
    for (const auto& entry : by_id)
        if (!index.count(entry.first)) strong_connect(entry.first);
    return cycles;
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
        Json file_types = Json::array();
        for (const auto& entry : plugin.file_types)
            file_types.push_back({{"name", entry.name}, {"language", entry.language},
                                  {"extensions", entry.extensions}, {"fileNames", entry.file_names},
                                  {"patterns", entry.patterns},
                                  {"fileNamesCaseInsensitive", entry.file_names_case_insensitive},
                                  {"hashBangs", entry.hash_bangs},
                                  {"implementationClass", entry.implementation_class},
                                  {"fieldName", entry.field_name}});
        Json value{{"id", plugin.id}, {"name", plugin.name}, {"version", plugin.version},
                   {"description", plugin.description}, {"category", plugin.category},
                   {"vendor", plugin.vendor},
                   {"path", plugin.path}, {"enabled", plugin.enabled},
                   {"depends", plugin.depends}, {"optionalDepends", plugin.optional_depends},
                   {"missingDependencies", plugin.missing_dependencies},
                   {"disabledDependencies", plugin.disabled_dependencies},
                   {"requiredBy", plugin.required_by},
                   {"commands", std::move(commands)}, {"templates", std::move(templates)},
                   {"fileTypes", std::move(file_types)}};
        if (!plugin.error.empty()) value["error"] = plugin.error;
        if (!plugin.broken.empty()) value["broken"] = plugin.broken;
        if (!plugin.dependency_cycle.empty()) value["dependencyCycle"] = plugin.dependency_cycle;
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
            // 厂商：上游 `<vendor>` 元素（`PluginXmlConst.kt:36`）。长度上限取名称那一档（120），
            // 因为它和 `name` 一样是**给人读的一行字**，不是标识符；超长与没写同义（前端不渲染那一行）。
            plugin.vendor = text_or(document, "vendor", 120);
            if (plugin.name.empty()) plugin.name = plugin.id;
            plugin.depends = read_dependencies(document, "depends", plugin.id);
            plugin.optional_depends = read_dependencies(document, "optionalDepends", plugin.id);
            if (document.contains("contributes") && document.at("contributes").is_object()) {
                plugin.commands = read_commands(document.at("contributes"));
                plugin.templates = read_templates(document.at("contributes"));
                plugin.file_types = read_file_types(document.at("contributes"));
            }
        } catch (const Json::exception&) {
            plugin.error = "plugin.json 不是合法 JSON";
            plugin.name = plugin.id;
        }
        result.push_back(std::move(plugin));
    }
    std::sort(result.begin(), result.end(), [](const Plugin& a, const Plugin& b) { return a.id < b.id; });
    // 依赖解析放在整个目录扫完之后：依赖可能排在引用者后面（列表已按 id 排序），
    // 边读边判会把「装着但排在后面」误报成缺装。
    std::map<std::string, const Plugin*> by_id;
    for (const auto& plugin : result) by_id[plugin.id] = &plugin;
    std::map<std::string, std::vector<std::string>> cycle_of;
    for (const auto& component : dependency_cycles(by_id))
        for (const auto& id : component) cycle_of[id] = component;
    for (auto& plugin : result) {
        for (const auto& dependency : plugin.depends) {
            const auto found = by_id.find(dependency);
            // 清单坏得读不出来的依赖与「没装」同罪：它不会被加载，引用者自然起不来。
            if (found == by_id.end() || !found->second->error.empty())
                plugin.missing_dependencies.push_back(dependency);
            else if (!found->second->enabled)
                plugin.disabled_dependencies.push_back(dependency);
        }
        for (const auto& other : result)
            if (std::find(other.depends.begin(), other.depends.end(), plugin.id) != other.depends.end())
                plugin.required_by.push_back(other.id);
        // broken 只对**启用着的**插件有意义：停用的插件不是「加载失败」，它就是被停用了
        // （连带停用的依赖者不该被标成坏插件）。两种原因同时存在时并列写出。
        if (plugin.enabled && !plugin.missing_dependencies.empty()) {
            plugin.broken = "缺少依赖插件：" + joined(plugin.missing_dependencies);
            if (!plugin.disabled_dependencies.empty())
                plugin.broken += "；依赖的插件已停用：" + joined(plugin.disabled_dependencies);
        } else if (plugin.enabled && !plugin.disabled_dependencies.empty()) {
            plugin.broken = "依赖的插件已停用：" + joined(plugin.disabled_dependencies);
        }
        // 成环与前两个原因并列写出（上游 `preparePluginErrors` 的 `globalErrors` 也是把
        // 环错误单列一条，不与逐插件原因混在一起）。
        plugin.dependency_cycle = cycle_of[plugin.id];
        if (plugin.enabled && !plugin.dependency_cycle.empty()) {
            if (!plugin.broken.empty()) plugin.broken += "；";
            plugin.broken += "必需依赖形成循环：" + joined(plugin.dependency_cycle);
        }
    }
    return result;
}

void set_enabled(const fs::path& directory, const std::string& id, bool enabled) {
    if (!valid_id(id)) throw WorkspaceError("INVALID_REQUEST", "插件 id 只能是小写字母、数字、- _ . 且不超过 64 字符。");
    const fs::path target = directory / id;
    std::error_code ec;
    if (!fs::exists(target, ec) || !fs::is_directory(target, ec))
        throw WorkspaceError("NOT_FOUND", "找不到插件目录：" + id);

    const std::vector<Plugin> plugins = list(directory);
    std::map<std::string, const Plugin*> by_id;
    for (const auto& plugin : plugins) by_id[plugin.id] = &plugin;
    if (by_id.find(id) == by_id.end()) throw WorkspaceError("NOT_FOUND", "找不到插件目录：" + id);

    const auto write_marker = [&](const std::string& plugin_id, bool want_enabled) {
        const fs::path marker = directory / plugin_id / ".disabled";
        std::error_code marker_error;
        if (want_enabled) {
            if (fs::exists(marker, marker_error) && !fs::remove(marker, marker_error))
                throw WorkspaceError("IO_ERROR", "无法启用插件 " + plugin_id + "（删除 .disabled 失败）。");
            return;
        }
        if (fs::exists(marker, marker_error)) return;
        std::ofstream stream(marker, std::ios::binary | std::ios::trunc);
        if (!stream) throw WorkspaceError("IO_ERROR", "无法停用插件 " + plugin_id + "（写入 .disabled 失败）。");
        stream << "disabled\n";
    };

    if (enabled) {
        // 启用前先递归启用**必需的**依赖（可选依赖不动）：依赖缺失就拒绝启用，
        // 否则用户会得到一个「看着已启用、实际加载不了」的插件。
        std::set<std::string> visited;
        std::vector<std::string> missing;
        std::function<void(const std::string&)> resolve = [&](const std::string& current) {
            if (!visited.insert(current).second) return;
            const auto entry = by_id.find(current);
            if (entry == by_id.end()) return;
            for (const auto& dependency : entry->second->depends) {
                const auto found = by_id.find(dependency);
                if (found == by_id.end() || !found->second->error.empty()) {
                    missing.push_back(dependency);
                    continue;
                }
                resolve(dependency);
                write_marker(dependency, true);
            }
        };
        resolve(id);
        if (!missing.empty())
            throw WorkspaceError("DEPENDENCY_MISSING",
                                 "无法启用 " + id + "：缺少依赖插件 " + joined(missing) + "（先安装它）。");
        // 成环的插件启不了：上游把环上的插件判为不可加载（`PluginManagerStateService.kt:175-202`），
        // 这里是同一口径 —— 放行只会得到一个「看着已启用、实际加载不了」的状态。
        for (const auto& component : dependency_cycles(by_id))
            if (std::find(component.begin(), component.end(), id) != component.end())
                throw WorkspaceError("DEPENDENCY_CYCLE",
                                     "无法启用 " + id + "：必需依赖形成循环 " + joined(component) +
                                         "（环上的插件都启不了，请改清单里的 depends）。");
        write_marker(id, true);
        return;
    }

    // 停用：把依赖它的**已启用**插件一并停用（递归）。不这么做，那些插件会停在
    // 「必需依赖已停用」的坏状态里 —— `list()` 会把它们标成 broken。
    std::set<std::string> affected{id};
    bool grew = true;
    while (grew) {
        grew = false;
        for (const auto& plugin : plugins) {
            if (affected.count(plugin.id) || !plugin.enabled) continue;
            for (const auto& dependency : plugin.depends)
                if (affected.count(dependency)) { affected.insert(plugin.id); grew = true; break; }
        }
    }
    for (const auto& plugin_id : affected) write_marker(plugin_id, false);
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
