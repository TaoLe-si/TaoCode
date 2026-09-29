#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "workspace.hpp"

namespace taocode {
namespace plugins {

// One command a plugin publishes. `action` must name an action TaoCode already has
// (an id from the frontend action registry): plugins contribute entry points, never
// executable code — loading third-party script into the host would be a sandbox
// escape, not a feature.
struct Command {
    std::string id;
    std::string title;
    std::string action;
    std::string group = "插件";
};

// A live template the plugin ships, validated exactly like a project custom template.
struct Template {
    std::string key;
    std::string body;
    std::string description;
    std::vector<std::string> languages;
};

struct Plugin {
    std::string id;
    std::string name;
    std::string version;
    std::string description;
    // IDEA 的 `IdeaPluginDescriptor.getDisplayCategory()`：分组用（`InstalledPluginsTab` 按它
    // 分桶，缺省归入 "Other Tools"）。空串表示没写，分组由前端兜底。
    std::string category;
    std::string path;      // absolute directory
    bool enabled = true;
    std::string error;     // set when the manifest could not be read/validated
    std::vector<Command> commands;
    std::vector<Template> templates;
};

// Scans the profile's plugins directory. A directory without a readable manifest is
// reported with `error` instead of being dropped, so a broken plugin is visible.
std::vector<Plugin> list(const std::filesystem::path& directory);

// IDEA PluginsConfigurable › "Install Plugin from Disk"。两种源：
//   · 插件包（`.zip` / `.jar`）—— 解压后取包内清单，包内允许一层顶层目录；
//   · 目录（本仓扩展点的原生形态）—— 必须直接含 plugin.json。
// 落点是 <plugins>/<id>/，id 优先取清单里的 `id`，否则由源名折成（小写、非法字符变 `-`）。
// 已存在则拒绝（不覆盖）。整个过程先落到临时目录再改名：中途失败不会留下半个插件。
void install(const std::filesystem::path& directory, const std::filesystem::path& source);

// IDEA 的 Uninstall：删除 <plugins>/<id>（含 .disabled 标记与全部内容）。
void uninstall(const std::filesystem::path& directory, const std::string& id);

// Enable/disable by writing (or removing) a `.disabled` marker next to the manifest.
// The id is a directory name, so it is validated before it ever reaches the path.
void set_enabled(const std::filesystem::path& directory, const std::string& id, bool enabled);

Json to_json(const std::vector<Plugin>& plugins);

}  // namespace plugins
}  // namespace taocode
