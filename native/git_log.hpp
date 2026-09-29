#pragma once

#include "workspace.hpp"
#include <filesystem>
#include <string>
#include <vector>

namespace taocode::git {
// Internal adapter to the shared, cancellable Git process runner. Throws on failure
// or output truncation; arguments are individually quoted, never passed to a shell.
std::string log_command(const std::filesystem::path& repo, const std::vector<std::string>& args);

// logFull: limit (default 200, capped 1000), offset (default 0), refs: string[],
// author/text: literal case-sensitive substrings, since/until: YYYY-MM-DD,
// path: literal repository-relative file/directory. Empty filters are ignored.
// refs selects the union of reachable histories; absent/empty refs means --all.
Json log_full(const std::filesystem::path& repo, const Json& params);
Json commit_details(const std::filesystem::path& repo, const std::string& revision);
Json commit_changes(const std::filesystem::path& repo, const std::string& revision);
// Exact immutable blob comparison; empty revision/path pair represents absence.
// status: text | binary | tooLarge | unsupported; patch/sides only for text.
Json commit_file_diff(const std::filesystem::path& repo, const Json& params);
Json log_request(const std::filesystem::path& repo, const std::string& method, const Json& params);
}  // namespace taocode::git
