#pragma once

#include <atomic>
#include <filesystem>
#include <functional>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "workspace.hpp"  // WorkspaceError, Json

namespace taocode {
namespace watcher {

// What actually happened to a path, straight from ReadDirectoryChangesW. The UI
// needs it: a rename is "delete + create" only if you throw the action away.
enum class Action { added, removed, modified, renamed };

const char* name(Action action) noexcept;  // "added" | "removed" | "modified" | "renamed"

struct Change {
    std::string path;       // workspace-relative, '/'-joined
    Action action = Action::modified;
    std::string old_path;   // previous name; set only for Action::renamed
};

// JSON shape (this is what `fs.changed` carries):
//   {"path": "src/main.cpp", "action": "modified"}
//   {"path": "src/new.cpp", "action": "renamed", "oldPath": "src/old.cpp"}
void to_json(Json& json, const Change& change);

// Directory names that never reach the UI, matched against every segment of the
// reported path. They are generated, huge, or private to a tool: a save inside one
// of them can fire thousands of notifications (node_modules alone is often 100k
// files) and would drown the workspace tree.
inline constexpr std::string_view kIgnoredDirectories[] = {
    ".git", ".svn", ".hg", ".vs", ".idea", ".vscode", ".cache", ".next", ".nuxt", ".svelte-kit",
    "node_modules", "bower_components", "vendor", "build", "dist", "out", "bin", "obj", "target",
    "coverage", "__pycache__", ".pytest_cache", ".gradle", ".mypy_cache", "CMakeFiles"
};

// Cheap `*.ext` half of the filter: log/temp/object noise that no editor cares about.
inline constexpr std::string_view kIgnoredSuffixes[] = {
    ".log", ".tmp", ".temp", ".swp", ".swo", ".bak", ".pyc", ".pyo", ".class", ".o", ".d", ".ilk", ".tlog"
};

// True when a workspace-relative '/'-joined path must not be reported.
bool is_ignored(std::string_view path) noexcept;

// IDE-03's real file watching: one recursive ReadDirectoryChangesW thread over the
// workspace root. Events are debounced into batches (a save often lands as several
// notifications) and delivered as workspace-relative '/' paths with their action
// through the caller's callback, which runs on the watcher thread and must not
// block. running() tells the truth: it flips to false as soon as the thread leaves
// its loop, including when the root disappears under us.
class Watcher {
public:
    using Callback = std::function<void(std::vector<Change> changed)>;
    // Why a watch ended. It fires whenever the watch thread leaves its loop — a
    // requested stop as well as a root that was deleted or renamed underneath us —
    // because a watcher that dies silently leaves a file tree that never refreshes
    // again. Called on the watcher thread, never under a lock, and never with an
    // empty reason; nullptr clears it.
    using StoppedCb = std::function<void(std::string reason)>;

    Watcher() = default;
    ~Watcher();
    Watcher(const Watcher&) = delete;
    Watcher& operator=(const Watcher&) = delete;

    // Starts watching `root`; throwing stops any previous session first. A root that
    // cannot be opened reports WATCH_FAILED instead of silently doing nothing.
    void start(const std::filesystem::path& root, Callback callback);
    void stop() noexcept;
    bool running() const noexcept { return running_.load(); }
    void on_stopped(StoppedCb callback);  // nullptr clears it
    // Why the last watch ended: empty while one is running (or none ever started),
    // otherwise "监听已停止" for a requested stop and a failure reason otherwise, so
    // the caller can tell "stopped on purpose" (do not restart) from "died" (restart).
    std::string stop_reason() const;

private:
    void loop();            // thread body: records the reason on every exit path
    std::string pump();     // returns the reason its loop ended with

    std::filesystem::path root_;
    Callback callback_;
    void* directory_ = nullptr;   // HANDLE
    void* event_ = nullptr;       // HANDLE (completion)
    void* stop_event_ = nullptr;  // HANDLE
    std::thread thread_;
    std::atomic<bool> running_{false};
    mutable std::mutex mutex_;  // guards start/stop transitions and stop_reason_
    StoppedCb on_stopped_;
    std::string stop_reason_;
};

}  // namespace watcher
}  // namespace taocode
