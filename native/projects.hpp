#pragma once

#include "workspace.hpp"

namespace taocode {

namespace fs = std::filesystem;

// Checks only the parent path, never enumerates it. No destination is reserved.
fs::path project_destination(const fs::path& parent, const std::string& name);

Json java_lsp_settings(const Json& java);

// The editor settings a fresh profile starts with, and the fallback for any key a
// state file written by an older build does not carry. Exported so tests assert
// against the real defaults instead of a copy that drifts.
Json editor_defaults();

// Source: RecentProjectMetaInfo.activationTimestamp — wall-clock seconds since
// the Unix epoch in UTC, mirroring what IDEA stores next to displayName.
std::int64_t utc_now_epoch();

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
    Json forget_many(const std::vector<std::string>& paths); // Mirrors RecentProjectsManagerBase.removePathsFromGroups + removePath fan-out.
    Json update_settings(const Json& patch); // Returns the complete editor settings.
    Json project_settings(const std::string& root);
    Json update_project_settings(const std::string& root, const Json& patch);

private:
    // Reload under the process lock on every operation: no stale per-instance cache,
    // and no in-memory state can be committed before a successful disk replacement.
    fs::path state_file_;
};

} // namespace taocode
