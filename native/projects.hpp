#pragma once

#include "workspace.hpp"

namespace taocode {

namespace fs = std::filesystem;

// Checks only the parent path, never enumerates it. No destination is reserved.
fs::path project_destination(const fs::path& parent, const std::string& name);

Json java_lsp_settings(const Json& java);

// Publishes a project template without replacing anything; does not open/record it.
fs::path create_project(const fs::path& parent, const std::string& name,
                        const std::string& kind);

class ProjectStore {
public:
    explicit ProjectStore(fs::path state_file);
    Json state();
    void opened(const Json& workspace);
    void closed();
    Json forget(const std::string& path); // Returns the public state; keeps project files/settings.
    Json update_settings(const Json& patch); // Returns the complete editor settings.
    Json project_settings(const std::string& root);
    Json update_project_settings(const std::string& root, const Json& patch);

private:
    // Reload under the process lock on every operation: no stale per-instance cache,
    // and no in-memory state can be committed before a successful disk replacement.
    fs::path state_file_;
};

} // namespace taocode
