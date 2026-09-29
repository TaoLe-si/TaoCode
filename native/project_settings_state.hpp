#pragma once

#include "fsops.hpp"
#include "settings_schema.hpp"

namespace taocode::project_settings {

inline constexpr std::size_t state_limit = 1024 * 1024;
inline constexpr std::size_t recent_limit = 30;

struct LoadedState {
    PinnedDirectory parent;
    Handle original;
    Json document = empty_document();
};

// Stage and validate the application file before publishing any project XML.
// The commit still may fail (disk/filter/race); the caller must then roll XML back.
struct PreparedState {
    OwnedObject temporary;
    fs::path target;
    bool had_original;
};

LoadedState load_state(const fs::path& file);
PreparedState prepare_state(const fs::path& file, LoadedState& loaded, const Json& next);
void commit_state(PreparedState& prepared);
void save_state(const fs::path& file, LoadedState& loaded, const Json& next);

} // namespace taocode::project_settings
