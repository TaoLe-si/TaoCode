#pragma once

#include <filesystem>
#include <functional>
#include <stop_token>
#include <string>

namespace taocode {

// Searches explicit, absolute PATH entries only; never searches the current directory implicitly.
std::filesystem::path find_git_executable();

// Synchronous worker API. Callbacks run on the calling thread, before publication only.
// Output is deliberately reduced to safe status/percentages, not arbitrary Git/helper text.
// Throws WorkspaceError; the host owns its worker thread and UI event dispatch.
std::filesystem::path clone_repository(
    const std::string& source, const std::filesystem::path& parent,
    const std::string& name, std::stop_token stop,
    const std::function<void(const std::string&)>& progress);

} // namespace taocode
