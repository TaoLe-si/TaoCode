#include "plugins.hpp"

#include <algorithm>
#include <fstream>
#include <set>
#include <string>

namespace taocode {
namespace plugins {
namespace {
namespace fs = std::filesystem;

constexpr std::size_t max_plugins = 200;
constexpr std::size_t max_commands = 100;
constexpr std::size_t max_templates = 100;

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
                   {"description", plugin.description}, {"path", plugin.path},
                   {"enabled", plugin.enabled}, {"commands", std::move(commands)},
                   {"templates", std::move(templates)}};
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

}  // namespace plugins
}  // namespace taocode
