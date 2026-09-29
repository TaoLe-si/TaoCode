#pragma once

#include "workspace.hpp"
#include <functional>

namespace taocode {

// XML is authoritative whenever the layer's file exists, even without its component.
// Legacy JSON is a fallback only for an absent file. Reads never migrate/write.
void read_project_file_colors(const std::filesystem::path& root, Json& settings);
// Parse and stage both XML layers before publishing either; implicit migration
// only fills absent files. save_application must be a prepared atomic commit:
// it may throw before publication, but must not throw after committing JSON.
// On failure, restore exact original XML bytes (or remove newly created layers).
// A rollback failure keeps recovery copies and reports PROJECT_SETTINGS_PARTIAL_WRITE.
// This is not a crash-atomic multi-file transaction or a cross-process CAS.
void save_project_settings_layers(const std::filesystem::path& root, const Json& legacy,
                                  const Json& patch, const std::function<void()>& save_application);

} // namespace taocode
