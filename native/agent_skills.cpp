#include "agent_skills.hpp"

#include "file_queries.hpp"
#include "text.hpp"

#include <windows.h>
#include <bcrypt.h>
#include <shlobj.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <fstream>
#include <iterator>
#include <mutex>
#include <optional>
#include <set>
#include <string_view>
#include <sstream>
#include <system_error>
#include <vector>
#include <unordered_map>

namespace taocode::agent_skills {
namespace fs = std::filesystem;

namespace {

constexpr char kProvider[] = "glm";
constexpr std::size_t kMaxDepth = 8;
constexpr std::size_t kMaxDescriptionLength = 1024;
constexpr std::array<std::string_view, 12> kExcludedDirectories{
    "node_modules", "dist", "build", "out", "target", "vendor", "coverage",
    ".cache", ".next", ".turbo", ".venv", "__pycache__"};
std::mutex config_mutex;

std::string trim(std::string value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = value.find_last_not_of(" \t\r\n");
    return value.substr(first, last - first + 1);
}

std::string lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::size_t utf16_length(const std::string& value) {
    std::size_t length = 0;
    for (const unsigned char byte : value) {
        if ((byte & 0xC0) == 0x80) continue;
        length += (byte & 0xF8) == 0xF0 ? 2 : 1;
    }
    return length;
}

fs::path user_home() {
    PWSTR raw = nullptr;
    const HRESULT result = SHGetKnownFolderPath(FOLDERID_Profile, 0, nullptr, &raw);
    if (FAILED(result) || !raw) throw WorkspaceError("SKILL_HOME_UNAVAILABLE", "无法定位用户目录。");
    fs::path home(raw);
    CoTaskMemFree(raw);
    return home;
}

fs::path path_from_utf8(const std::string& value) { return fs::path(wide(value)); }
std::string path_to_utf8(const fs::path& value) { return utf8(value.native()); }

std::string path_key(const fs::path& path) {
    std::string result = path_to_utf8(path);
    std::replace(result.begin(), result.end(), '\\', '/');
    while (result.size() > 1 && result.back() == '/') result.pop_back();
    return lower(std::move(result));
}

std::string config_path_key(std::string value) {
    std::replace(value.begin(), value.end(), '\\', '/');
    return value;
}

bool path_within(const fs::path& root, const fs::path& candidate) {
    const std::string root_key = path_key(root);
    const std::string candidate_key = path_key(candidate);
    if (candidate_key == root_key) return true;
    return candidate_key.size() > root_key.size() &&
           candidate_key.compare(0, root_key.size(), root_key) == 0 &&
           candidate_key[root_key.size()] == '/';
}

bool excluded_directory(const std::string& name) {
    if (std::find(kExcludedDirectories.begin(), kExcludedDirectories.end(), name) != kExcludedDirectories.end())
        return true;
    return !name.empty() && name.front() == '.' && name != ".system";
}

struct Root {
    fs::path path;
    std::string scope;
    std::string plugin_name;
    std::string plugin_id;
};

std::vector<fs::path> workspace_bases(const fs::path& workspace) {
    if (workspace.empty()) return {};
    std::vector<fs::path> path_to_root;
    fs::path current = fs::absolute(workspace).lexically_normal();
    fs::path worktree;
    for (fs::path probe = current; !probe.empty(); probe = probe.parent_path()) {
        std::error_code error;
        if (fs::exists(probe / L".git", error) && !error) {
            worktree = probe;
            break;
        }
        const fs::path parent = probe.parent_path();
        if (parent == probe) break;
    }
    if (worktree.empty()) return {current};
    while (true) {
        path_to_root.push_back(current);
        if (current == worktree || current.parent_path() == current) break;
        current = current.parent_path();
    }
    return path_to_root;
}

std::vector<std::string> string_array(const Json& value) {
    std::vector<std::string> result;
    if (value.is_string()) return {value.get<std::string>()};
    if (!value.is_array()) return result;
    for (const auto& item : value) if (item.is_string()) result.push_back(item.get<std::string>());
    return result;
}

fs::path resolve_user_config_path(const std::string& value) {
    if (value.starts_with("~/")) return user_home() / path_from_utf8(value.substr(2));
    fs::path path = path_from_utf8(value);
    return path.is_absolute() ? path : fs::absolute(path);
}

fs::path plugin_storage_root(const Json& config) {
    std::string storage_dir;
    if (config.contains("storage") && config.at("storage").is_object() &&
        config.at("storage").contains("dir") && config.at("storage").at("dir").is_string()) {
        storage_dir = trim(config.at("storage").at("dir").get<std::string>());
    }
    fs::path root = resolve_user_config_path(storage_dir.empty() ? "~/.zcode" : storage_dir);
    if (root.filename() != L"cli") root /= L"cli";
    return root / L"plugins";
}

struct PluginCandidate { fs::path root; std::string marketplace; bool default_enabled = false; };

std::vector<PluginCandidate> plugin_candidates(const Json& config) {
    std::vector<PluginCandidate> result;
    const Json plugins = config.contains("plugins") && config.at("plugins").is_object()
        ? config.at("plugins") : Json::object();
    if (plugins.contains("enabled") && plugins.at("enabled").is_boolean() && !plugins.at("enabled").get<bool>())
        return result;
    for (const auto& directory : string_array(plugins.value("dirs", Json{}))) {
        if (!trim(directory).empty()) result.push_back({resolve_user_config_path(trim(directory)), "inline", true});
    }

    constexpr std::string_view official_marketplace = "zcode-plugins-official";
    const fs::path storage = plugin_storage_root(config);
    const fs::path cache = storage / L"cache" / path_from_utf8(std::string(official_marketplace));
    std::error_code error;
    if (fs::is_directory(cache, error) && !error) {
        std::vector<fs::path> plugin_dirs;
        for (fs::directory_iterator it(cache, fs::directory_options::skip_permission_denied, error), end;
             !error && it != end; it.increment(error)) {
            if (it->is_directory(error) && !error) plugin_dirs.push_back(it->path());
            error.clear();
        }
        std::sort(plugin_dirs.begin(), plugin_dirs.end(), [](const fs::path& left, const fs::path& right) {
            return path_key(left) < path_key(right);
        });
        for (const auto& plugin_dir : plugin_dirs) {
            std::vector<fs::path> versions;
            for (fs::directory_iterator it(plugin_dir, fs::directory_options::skip_permission_denied, error), end;
                 !error && it != end; it.increment(error)) {
                if (it->is_directory(error) && !error) versions.push_back(it->path());
                error.clear();
            }
            std::sort(versions.begin(), versions.end(), [](const fs::path& left, const fs::path& right) {
                return path_key(left) < path_key(right);
            });
            for (const auto& version : versions) result.push_back({version, std::string(official_marketplace), false});
        }
        error.clear();
    }

    std::ifstream installed_stream(storage / L"installed_plugins.json", std::ios::binary);
    if (installed_stream) {
        try {
            const Json installed = Json::parse(installed_stream);
            if (installed.is_object() && installed.contains("plugins") && installed.at("plugins").is_array()) {
                for (const auto& item : installed.at("plugins")) {
                    if (!item.is_object()) continue;
                    const std::string id = item.value("id", std::string());
                    const std::string marketplace = item.value("marketplace", std::string());
                    const std::string install_path = item.value("installPath", std::string());
                    const fs::path root = path_from_utf8(install_path);
                    if (!trim(id).empty() && !trim(marketplace).empty() && root.is_absolute())
                        result.push_back({root, marketplace, false});
                }
            }
        } catch (...) {}
    }
    return result;
}

struct PluginManifest {
    std::string name;
    Json skills;
    bool has_skills = false;
};

std::optional<PluginManifest> read_plugin_manifest(const fs::path& root) {
    const std::array<fs::path, 3> manifests{
        root / L".zcode-plugin" / L"plugin.json",
        root / L".claude-plugin" / L"plugin.json",
        root / L".codex-plugin" / L"plugin.json"};
    for (const auto& path : manifests) {
        std::ifstream stream(path, std::ios::binary);
        if (!stream) continue;
        try {
            const Json parsed = Json::parse(stream);
            if (!parsed.is_object() || !parsed.contains("name") || !parsed.at("name").is_string()) return std::nullopt;
            const std::string name = trim(parsed.at("name").get<std::string>());
            if (name.empty() || name.size() > 128 ||
                !std::all_of(name.begin(), name.end(), [](unsigned char ch) {
                    return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '.' || ch == '_' || ch == '-';
                }) || !((name.front() >= 'a' && name.front() <= 'z') || (name.front() >= '0' && name.front() <= '9')))
                return std::nullopt;
            return PluginManifest{name, parsed.value("skills", Json{}), parsed.contains("skills")};
        } catch (...) { return std::nullopt; }
    }
    return std::nullopt;
}

std::vector<fs::path> plugin_skill_roots(const fs::path& plugin_root, const PluginManifest& manifest) {
    std::vector<fs::path> result;
    for (const auto& raw : string_array(manifest.skills)) {
        const fs::path relative = path_from_utf8(raw);
        if (relative.is_absolute()) continue;
        const fs::path candidate = (plugin_root / relative).lexically_normal();
        const fs::path inside = candidate.lexically_relative(plugin_root.lexically_normal());
        if (!inside.empty() && *inside.begin() == L"..") continue;
        result.push_back(candidate);
    }
    if (result.empty() && !manifest.has_skills) {
        const fs::path default_root = plugin_root / L"skills";
        std::error_code error;
        if (fs::exists(default_root, error) && !error) result.push_back(default_root);
    }
    return result;
}

std::vector<Root> roots_for(const std::string& workspace_path, const Json& config) {
    std::vector<Root> roots;
    if (!workspace_path.empty()) {
        for (const auto& base : workspace_bases(path_from_utf8(workspace_path))) {
            roots.push_back({base / L".zcode" / L"skills", "workspace", {}, {}});
            roots.push_back({base / L".agents" / L"skills", "workspace", {}, {}});
        }
    }
    const auto home = user_home();
    roots.push_back({home / L".zcode" / L"skills", "user", {}, {}});
    roots.push_back({home / L".agents" / L"skills", "user", {}, {}});

    constexpr std::string_view official_marketplace = "zcode-plugins-official";
    const std::set<std::string> default_enabled_official{
        "browser-use@zcode-plugins-official", "image-search@zcode-plugins-official", "documents@zcode-plugins-official",
        "pdf@zcode-plugins-official", "presentations@zcode-plugins-official", "spreadsheets@zcode-plugins-official",
        "node-repl-host@zcode-plugins-official", "skill-creator@zcode-plugins-official", "plugin-creator@zcode-plugins-official",
        "zcode-guide@zcode-plugins-official"};
    const Json plugin_config = config.contains("plugins") && config.at("plugins").is_object()
        ? config.at("plugins") : Json::object();
    std::set<std::string> seen_plugin_ids;
    for (const auto& candidate : plugin_candidates(config)) {
        const auto manifest = read_plugin_manifest(candidate.root);
        if (!manifest) continue;
        const std::string plugin_id = manifest->name + "@" + candidate.marketplace;
        if (!seen_plugin_ids.insert(plugin_id).second) continue;
        if (candidate.marketplace == official_marketplace && plugin_config.contains("suppressedBuiltins") &&
            plugin_config.at("suppressedBuiltins").is_array() &&
            std::find(plugin_config.at("suppressedBuiltins").begin(), plugin_config.at("suppressedBuiltins").end(), plugin_id) !=
                plugin_config.at("suppressedBuiltins").end()) continue;
        bool enabled = candidate.default_enabled || default_enabled_official.contains(plugin_id);
        if (plugin_config.contains("enabledPlugins") && plugin_config.at("enabledPlugins").is_object() &&
            plugin_config.at("enabledPlugins").contains(plugin_id) && plugin_config.at("enabledPlugins").at(plugin_id).is_boolean())
            enabled = plugin_config.at("enabledPlugins").at(plugin_id).get<bool>();
        if (!enabled) continue;
        for (const auto& root : plugin_skill_roots(candidate.root, *manifest))
            roots.push_back({root, "plugin", manifest->name, plugin_id});
    }

    std::set<std::string> seen;
    std::vector<Root> unique;
    for (auto& root : roots) {
        std::error_code error;
        const auto canonical = fs::weakly_canonical(root.path, error);
        const auto key = path_key(error ? root.path : canonical);
        if (seen.insert(key).second) unique.push_back(std::move(root));
    }
    return unique;
}

std::vector<fs::path> skill_files_in(const fs::path& root, Json& diagnostics) {
    std::vector<fs::path> files;
    std::error_code error;
    if (!fs::is_directory(root, error) || error) return files;

    struct Pending { fs::path path; std::size_t depth; };
    std::vector<Pending> pending{{root, 0}};
    std::set<std::string> visited_links;
    while (!pending.empty()) {
        Pending current = std::move(pending.back());
        pending.pop_back();
        fs::directory_iterator iterator(current.path, fs::directory_options::skip_permission_denied, error);
        if (error) {
            diagnostics.push_back({{"code", "skill_scan_failed"}, {"severity", "warning"},
                                   {"message", error.message()}, {"path", path_to_utf8(current.path)}});
            error.clear();
            continue;
        }
        std::vector<fs::path> children;
        for (const auto& entry : iterator) {
            const auto name = path_to_utf8(entry.path().filename());
            if (name == "SKILL.md") {
                const auto status = entry.status(error);
                if (!error && !fs::is_directory(status)) files.push_back(entry.path());
                error.clear();
                continue;
            }
            if (excluded_directory(name) || current.depth >= kMaxDepth) continue;
            const auto link_status = entry.symlink_status(error);
            if (error) { error.clear(); continue; }
            if (fs::is_directory(link_status)) {
                children.push_back(entry.path());
            } else if (fs::is_symlink(link_status)) {
                const auto target_status = entry.status(error);
                if (error || !fs::is_directory(target_status)) { error.clear(); continue; }
                const auto canonical = fs::weakly_canonical(entry.path(), error);
                error.clear();
                const auto key = path_key(canonical.empty() ? entry.path() : canonical);
                if (visited_links.insert(key).second) children.push_back(entry.path());
            }
        }
        std::sort(children.begin(), children.end(), [](const fs::path& left, const fs::path& right) {
            return path_key(left) > path_key(right);
        });
        for (auto& child : children) pending.push_back({std::move(child), current.depth + 1});
    }
    std::sort(files.begin(), files.end(), [](const fs::path& left, const fs::path& right) {
        return path_key(left) < path_key(right);
    });
    return files;
}

std::string unquote_yaml(std::string value) {
    value = trim(std::move(value));
    if (value.size() >= 2 && value.front() == '"' && value.back() == '"') {
        value = value.substr(1, value.size() - 2);
        std::string decoded;
        decoded.reserve(value.size());
        for (std::size_t i = 0; i < value.size(); ++i) {
            if (value[i] == '\\' && i + 1 < value.size()) {
                const char next = value[++i];
                switch (next) {
                    case 'n': decoded.push_back('\n'); break;
                    case 'r': decoded.push_back('\r'); break;
                    case 't': decoded.push_back('\t'); break;
                    default: decoded.push_back(next); break;
                }
            } else decoded.push_back(value[i]);
        }
        return decoded;
    }
    if (value.size() >= 2 && value.front() == '\'' && value.back() == '\'') {
        value = value.substr(1, value.size() - 2);
        std::string decoded;
        for (std::size_t i = 0; i < value.size(); ++i) {
            decoded.push_back(value[i]);
            if (value[i] == '\'' && i + 1 < value.size() && value[i + 1] == '\'') ++i;
        }
        return decoded;
    }
    return value;
}

struct Frontmatter { std::string name; std::string description; };

Frontmatter read_frontmatter(const std::string& markdown, const std::string& fallback_name) {
    std::string normalized;
    normalized.reserve(markdown.size());
    for (std::size_t i = 0; i < markdown.size(); ++i) {
        if (markdown[i] == '\r') {
            if (i + 1 < markdown.size() && markdown[i + 1] == '\n') ++i;
            normalized.push_back('\n');
        } else normalized.push_back(markdown[i]);
    }
    if (!normalized.starts_with("---\n")) return {fallback_name, {}};
    const auto close = normalized.find("\n---\n", 4);
    const auto close_at_end = normalized.size() >= 4 && normalized.compare(normalized.size() - 4, 4, "\n---") == 0;
    if (close == std::string::npos && !close_at_end) return {fallback_name, {}};
    const auto metadata_end = close == std::string::npos ? normalized.size() - 4 : close;

    Frontmatter result;
    result.name = fallback_name;
    std::vector<std::string> lines;
    std::istringstream input(normalized.substr(4, metadata_end - 4));
    std::string line;
    while (std::getline(input, line)) lines.push_back(line);
    for (std::size_t index = 0; index < lines.size(); ++index) {
        line = lines[index];
        if (line.empty() || line.front() == ' ' || line.front() == '\t' || line.front() == '#') continue;
        const auto colon = line.find(':');
        if (colon == std::string::npos) continue;
        const std::string key = trim(line.substr(0, colon));
        std::string value = trim(line.substr(colon + 1));
        if (key == "name") {
            const auto parsed = unquote_yaml(std::move(value));
            if (!parsed.empty()) result.name = parsed;
        } else if (key == "description") {
            if (value == "|" || value == "|-" || value == "|+") {
                std::vector<std::string> block;
                while (index + 1 < lines.size() && !lines[index + 1].empty() &&
                       (lines[index + 1].front() == ' ' || lines[index + 1].front() == '\t')) {
                    line = lines[++index];
                    const auto first = line.find_first_not_of(" \t");
                    block.push_back(line.substr(std::min<std::size_t>(2, first == std::string::npos ? 0 : first)));
                }
                for (std::size_t i = 0; i < block.size(); ++i) {
                    if (i) result.description.push_back('\n');
                    result.description += block[i];
                }
            } else if (value == ">" || value == ">-" || value == ">+") {
                std::vector<std::string> block;
                while (index + 1 < lines.size() && !lines[index + 1].empty() &&
                       (lines[index + 1].front() == ' ' || lines[index + 1].front() == '\t')) {
                    line = lines[++index];
                    const auto first = line.find_first_not_of(" \t");
                    block.push_back(line.substr(std::min<std::size_t>(2, first == std::string::npos ? 0 : first)));
                }
                for (const auto& part : block) {
                    if (!result.description.empty()) result.description.push_back(' ');
                    result.description += part;
                }
            } else result.description = unquote_yaml(std::move(value));
        }
    }
    return result;
}

std::string read_body(const std::string& markdown) {
    std::string normalized;
    normalized.reserve(markdown.size());
    for (std::size_t i = 0; i < markdown.size(); ++i) {
        if (markdown[i] == '\r') {
            if (i + 1 < markdown.size() && markdown[i + 1] == '\n') ++i;
            normalized.push_back('\n');
        } else normalized.push_back(markdown[i]);
    }
    if (!normalized.starts_with("---\n")) return trim(std::move(normalized));
    const auto close = normalized.find("\n---\n", 4);
    if (close != std::string::npos) return trim(normalized.substr(close + 5));
    if (normalized.size() >= 4 && normalized.compare(normalized.size() - 4, 4, "\n---") == 0) return {};
    return trim(std::move(normalized));
}

Json read_metadata(const fs::path& skill_file) {
    std::ifstream stream(skill_file.parent_path() / L"_meta.json", std::ios::binary);
    if (!stream) return Json::object();
    try {
        const auto raw = Json::parse(stream, nullptr, false);
        if (!raw.is_object()) return Json::object();
        Json result = Json::object();
        for (const auto* key : {"slug", "version", "ownerId"}) {
            if (raw.contains(key) && raw.at(key).is_string() && !raw.at(key).get<std::string>().empty())
                result[key] = raw.at(key);
        }
        if (raw.contains("publishedAt") && raw.at("publishedAt").is_number()) result["publishedAt"] = raw.at("publishedAt");
        return result;
    } catch (...) { return Json::object(); }
}

std::string sha256_prefix(const std::string& value) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    DWORD object_length = 0, result_length = 0;
    std::vector<UCHAR> object;
    std::array<UCHAR, 32> digest{};
    auto close = [&] {
        if (hash) BCryptDestroyHash(hash);
        if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
    };
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0 ||
        BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&object_length),
                          sizeof(object_length), &result_length, 0) < 0) {
        close(); throw WorkspaceError("SKILL_HASH_FAILED", "技能路径无法生成标识。");
    }
    object.resize(object_length);
    if (BCryptCreateHash(algorithm, &hash, object.data(), object_length, nullptr, 0, 0) < 0 ||
        BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())),
                       static_cast<ULONG>(value.size()), 0) < 0 ||
        BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) < 0) {
        close(); throw WorkspaceError("SKILL_HASH_FAILED", "技能路径无法生成标识。");
    }
    close();
    constexpr char hex[] = "0123456789abcdef";
    std::string result;
    for (std::size_t i = 0; i < 6; ++i) {
        result.push_back(hex[digest[i] >> 4]);
        result.push_back(hex[digest[i] & 0x0f]);
    }
    return result;
}

struct Skill {
    std::string id;
    std::string name;
    std::string description;
    std::string path;
    std::string source_path;
    std::string scope;
    std::string plugin_name;
    std::string plugin_id;
    bool enabled = true;
    Json metadata = Json::object();
    std::string body;
};

Json read_cli_config() {
    const fs::path config_path = user_home() / L".zcode" / L"cli" / L"config.json";
    std::ifstream stream(config_path, std::ios::binary);
    if (!stream) return Json::object();
    try {
        Json config = Json::parse(stream);
        return config.is_object() ? config : Json::object();
    } catch (...) { return Json::object(); }
}

std::unordered_map<std::string, bool> enabled_map(const Json& config) {
    std::unordered_map<std::string, bool> result;
    if (!config.contains("skills") || !config.at("skills").is_object()) return result;
    for (auto it = config.at("skills").begin(); it != config.at("skills").end(); ++it) {
        if (it.value().is_object() && it.value().contains("enable") && it.value().at("enable").is_boolean())
            result[config_path_key(it.key())] = it.value().at("enable").get<bool>();
    }
    return result;
}

void write_cli_config(Json& config) {
    const fs::path config_path = user_home() / L".zcode" / L"cli" / L"config.json";
    fs::create_directories(config_path.parent_path());
    const fs::path temporary = config_path.wstring() + L".taocode-tmp";
    {
        std::ofstream stream(temporary, std::ios::binary | std::ios::trunc);
        if (!stream) throw WorkspaceError("SKILL_CONFIG_WRITE_FAILED", "无法写入技能配置。");
        stream << config.dump(2) << '\n';
        stream.flush();
        if (!stream) {
            stream.close();
            std::error_code ignored;
            fs::remove(temporary, ignored);
            throw WorkspaceError("SKILL_CONFIG_WRITE_FAILED", "无法写入技能配置。");
        }
    }
    if (!MoveFileExW(temporary.c_str(), config_path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        std::error_code ignored;
        fs::remove(temporary, ignored);
        throw WorkspaceError("SKILL_CONFIG_WRITE_FAILED", "无法保存技能配置。");
    }
}

std::vector<Skill> discover(const std::string& workspace_path, Json& diagnostics) {
    const Json config = read_cli_config();
    const auto roots = roots_for(workspace_path, config);
    std::vector<Skill> skills;
    std::set<std::string> seen_paths;
    std::set<std::string> zcode_user_names;
    const auto enabled = enabled_map(config);
    for (const auto& root : roots) {
        if (root.scope == "user" && path_key(root.path).ends_with("/.zcode/skills")) {
            for (const auto& skill_file : skill_files_in(root.path, diagnostics)) {
                std::ifstream stream(skill_file, std::ios::binary);
                if (!stream) continue;
                const std::string folder = path_to_utf8(skill_file.parent_path().filename());
                zcode_user_names.insert(lower(read_frontmatter(std::string(std::istreambuf_iterator<char>(stream), {}), folder).name));
            }
        }
    }
    for (const auto& root : roots) {
        for (const auto& source : skill_files_in(root.path, diagnostics)) {
            std::error_code error;
            const fs::path canonical = fs::canonical(source, error);
            const fs::path stable = error ? fs::absolute(source).lexically_normal() : canonical;
            const std::string canonical_key = path_key(stable);
            if (!seen_paths.insert(canonical_key).second) continue;
            std::ifstream stream(source, std::ios::binary);
            if (!stream) {
                diagnostics.push_back({{"code", "skill_read_failed"}, {"severity", "warning"},
                                       {"message", "读取 SKILL.md 失败"}, {"path", path_to_utf8(source)}});
                continue;
            }
            const std::string markdown(std::istreambuf_iterator<char>(stream), {});
            const std::string folder = path_to_utf8(source.parent_path().filename());
            const auto frontmatter = read_frontmatter(markdown, folder);
            if (root.scope == "user" && path_key(root.path).ends_with("/.agents/skills") &&
                zcode_user_names.contains(lower(frontmatter.name))) continue;
            if (utf16_length(frontmatter.description) > kMaxDescriptionLength) {
                diagnostics.push_back({{"code", "skill_description_too_long"}, {"severity", "error"},
                                       {"message", "Skill description is too long (>1024): " + frontmatter.name},
                                       {"path", path_to_utf8(source)}, {"skillName", frontmatter.name}});
                continue;
            }

            Skill skill;
            skill.name = frontmatter.name.empty() ? folder : frontmatter.name;
            skill.description = frontmatter.description;
            skill.path = path_to_utf8(stable);
            skill.source_path = path_to_utf8(source);
            skill.scope = root.scope;
            skill.plugin_name = root.plugin_name;
            skill.plugin_id = root.plugin_id;
            skill.id = std::string(kProvider) + ":" + skill.scope + ":" + skill.name + ":" + sha256_prefix(skill.path);
            skill.metadata = read_metadata(source);
            const auto state = enabled.find(config_path_key(skill.path));
            skill.enabled = state == enabled.end() ? true : state->second;
            skill.body = read_body(markdown);
            skills.push_back(std::move(skill));
        }
    }
    std::sort(skills.begin(), skills.end(), [](const Skill& left, const Skill& right) {
        if (left.name != right.name) return left.name < right.name;
        if (left.scope != right.scope) return left.scope < right.scope;
        return left.path < right.path;
    });
    return skills;
}

Json skill_json(const Skill& skill) {
    Json result{{"id", skill.id}, {"name", skill.name}, {"description", skill.description},
                {"body", skill.body}, {"path", skill.path}, {"sourcePath", skill.source_path},
                {"scope", skill.scope}, {"enabled", skill.enabled}};
    if (!skill.plugin_name.empty()) result["pluginName"] = skill.plugin_name;
    if (!skill.plugin_id.empty()) result["pluginId"] = skill.plugin_id;
    if (!skill.metadata.empty()) result["metadata"] = skill.metadata;
    return result;
}

Skill find_skill(const std::string& workspace_path, const std::string& id) {
    Json diagnostics = Json::array();
    for (const auto& skill : discover(workspace_path, diagnostics)) if (skill.id == id) return skill;
    throw WorkspaceError("SKILL_NOT_FOUND", "技能未找到。");
}

std::string escape_xml(const std::string& value) {
    std::string result;
    result.reserve(value.size());
    for (const char ch : value) {
        switch (ch) {
            case '&': result += "&amp;"; break;
            case '"': result += "&quot;"; break;
            case '<': result += "&lt;"; break;
            case '>': result += "&gt;"; break;
            default: result.push_back(ch); break;
        }
    }
    return result;
}

std::set<std::string> mentioned_skill_names(const std::string& prompt) {
    std::set<std::string> names;
    const auto is_skill_character = [](unsigned char ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    };
    for (std::size_t index = 0; index < prompt.size(); ++index) {
        if (prompt[index] != '$' || index + 1 >= prompt.size() ||
            !is_skill_character(static_cast<unsigned char>(prompt[index + 1]))) continue;
        std::size_t end = index + 2;
        while (end < prompt.size()) {
            if (is_skill_character(static_cast<unsigned char>(prompt[end]))) {
                ++end;
                continue;
            }
            if (prompt[end] == '-' && end + 1 < prompt.size() &&
                is_skill_character(static_cast<unsigned char>(prompt[end + 1]))) {
                end += 2;
                continue;
            }
            break;
        }
        names.insert(prompt.substr(index + 1, end - index - 1));
    }
    return names;
}

fs::path checked_delete_path(const std::string& workspace_path, const Skill& skill) {
    if (skill.scope != "workspace" && skill.scope != "user")
        throw WorkspaceError("SKILL_DELETE_FORBIDDEN", "该技能不可删除。");
    const fs::path entry = path_from_utf8(skill.source_path).parent_path();
    std::error_code error;
    const fs::path canonical_parent = fs::canonical(entry.parent_path(), error);
    if (error) throw WorkspaceError("SKILL_DELETE_FORBIDDEN", "该技能不可删除。");
    bool contained = false;
    for (const auto& root : roots_for(workspace_path, read_cli_config())) {
        const fs::path canonical_root = fs::weakly_canonical(root.path, error);
        error.clear();
        if (path_within(canonical_root, canonical_parent)) { contained = true; break; }
    }
    if (!contained) throw WorkspaceError("SKILL_DELETE_FORBIDDEN", "该技能不可删除。");
    return canonical_parent / entry.filename();
}

}  // namespace

Json list(const std::string& workspace_path) {
    Json diagnostics = Json::array();
    const auto skills = discover(workspace_path, diagnostics);
    Json items = Json::array();
    for (const auto& skill : skills) items.push_back(skill_json(skill));
    return {{"skills", std::move(items)}, {"capability", {{"userScopeAvailable", true}}},
            {"diagnostics", std::move(diagnostics)}};
}

Json set_enabled(const std::string& workspace_path, const std::string& skill_id, bool enabled) {
    std::lock_guard lock(config_mutex);
    const auto skill = find_skill(workspace_path, skill_id);
    Json config = read_cli_config();
    if (!config.contains("skills") || !config.at("skills").is_object()) config["skills"] = Json::object();
    std::string key = skill.path;
    std::replace(key.begin(), key.end(), '\\', '/');
    if (enabled) config["skills"].erase(key);
    else config["skills"][key] = {{"enable", false}};
    if (config["skills"].empty()) config.erase("skills");
    write_cli_config(config);
    return list(workspace_path);
}

Json delete_skill(const std::string& workspace_path, const std::string& skill_id) {
    const auto skill = find_skill(workspace_path, skill_id);
    const auto target = checked_delete_path(workspace_path, skill);
    std::error_code error;
    const auto status = fs::symlink_status(target, error);
    if (error || !fs::exists(status)) throw WorkspaceError("SKILL_NOT_FOUND", "技能未找到。");
    if (fs::is_symlink(status)) fs::remove(target, error);
    else fs::remove_all(target, error);
    if (error) throw WorkspaceError("SKILL_DELETE_FAILED", "技能目录删除失败。");
    return list(workspace_path);
}

Json reveal_skill(const std::string& workspace_path, const std::string& skill_id) {
    const auto skill = find_skill(workspace_path, skill_id);
    return reveal_absolute(skill.path);
}

Json build_prompt_context(const std::string& workspace_path, const std::string& prompt) {
    const auto mentioned = mentioned_skill_names(prompt);
    if (mentioned.empty()) return {{"prompt", prompt}, {"activatedSkillNames", Json::array()}};

    Json diagnostics = Json::array();
    const auto skills = discover(workspace_path, diagnostics);
    std::vector<const Skill*> activated;
    for (const auto& skill : skills) {
        if (skill.enabled && mentioned.contains(skill.name)) activated.push_back(&skill);
    }
    if (activated.empty()) return {{"prompt", prompt}, {"activatedSkillNames", Json::array()}};

    std::string block = "<available_skills>";
    Json names = Json::array();
    for (const auto* skill : activated) {
        names.push_back(skill->name);
        block += "\n<activated_skill name=\"" + escape_xml(skill->name) + "\" path=\"" +
                 escape_xml(skill->path) + "\">\n" + skill->body + "\n</activated_skill>";
    }
    block += "\n</available_skills>";
    return {{"prompt", prompt + "\n\n" + block}, {"activatedSkillNames", std::move(names)}};
}

}  // namespace taocode::agent_skills
