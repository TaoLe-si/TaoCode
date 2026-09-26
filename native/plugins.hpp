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
    std::string path;      // absolute directory
    bool enabled = true;
    std::string error;     // set when the manifest could not be read/validated
    std::vector<Command> commands;
    std::vector<Template> templates;
};

// Scans the profile's plugins directory. A directory without a readable manifest is
// reported with `error` instead of being dropped, so a broken plugin is visible.
std::vector<Plugin> list(const std::filesystem::path& directory);

// Enable/disable by writing (or removing) a `.disabled` marker next to the manifest.
// The id is a directory name, so it is validated before it ever reaches the path.
void set_enabled(const std::filesystem::path& directory, const std::string& id, bool enabled);

Json to_json(const std::vector<Plugin>& plugins);

}  // namespace plugins
}  // namespace taocode
