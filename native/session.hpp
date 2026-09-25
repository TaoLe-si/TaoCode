#pragma once

#include <filesystem>
#include <string>

#include "workspace.hpp"  // WorkspaceError, Json

namespace taocode {
namespace session {

// Crash-recovery sessions, modeled on IDEA's workspace.xml FileEditorManager state
// (open editors per split group, selections, split layout) plus the unsaved drafts
// a hard kill would otherwise lose. One JSON file per project root under the
// profile's sessions/ directory, written atomically; `clear` removes it on a clean
// close so the next start only prompts after a real crash or an abandoned exit.
class SessionStore {
public:
    explicit SessionStore(std::filesystem::path directory);

    // `state` is persisted verbatim after shape validation: an object with a
    // `tabs` array (path + optional draft + caret) and layout fields.
    Json save(const std::string& root, const Json& state);
    Json load(const std::string& root);
    Json clear(const std::string& root);

private:
    std::filesystem::path file_for(const std::string& root) const;
    std::filesystem::path directory_;
};

}  // namespace session
}  // namespace taocode
