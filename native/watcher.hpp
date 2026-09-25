#pragma once

#include <atomic>
#include <filesystem>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "workspace.hpp"  // WorkspaceError, Json

namespace taocode {
namespace watcher {

// IDE-03's real file watching: one recursive ReadDirectoryChangesW thread over the
// workspace root. Events are debounced into batches (a save often lands as several
// notifications) and delivered as workspace-relative '/' paths through the caller's
// callback, which runs on the watcher thread and must not block.
class Watcher {
public:
    using Callback = std::function<void(std::vector<std::string> changed)>;

    Watcher() = default;
    ~Watcher();
    Watcher(const Watcher&) = delete;
    Watcher& operator=(const Watcher&) = delete;

    // Starts watching `root`; throwing stops any previous session first. A root that
    // cannot be opened reports WATCH_FAILED instead of silently doing nothing.
    void start(const std::filesystem::path& root, Callback callback);
    void stop() noexcept;
    bool running() const noexcept { return running_.load(); }

private:
    void loop();

    std::filesystem::path root_;
    Callback callback_;
    void* directory_ = nullptr;   // HANDLE
    void* overlapped_ = nullptr;  // OVERLAPPED*
    void* event_ = nullptr;       // HANDLE (completion)
    void* stop_event_ = nullptr;  // HANDLE
    std::thread thread_;
    std::atomic<bool> running_{false};
    std::mutex mutex_;  // guards start/stop transitions
};

}  // namespace watcher
}  // namespace taocode
