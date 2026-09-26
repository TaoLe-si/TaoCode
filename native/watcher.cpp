#include "watcher.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <chrono>
#include <cstring>

namespace taocode {
namespace watcher {
namespace {

// One notification buffer per read; a overflow sets FILE_NOTIFY flags and is
// reported as a full-refresh batch (empty path list means "everything").
constexpr std::size_t buffer_bytes = 64 * 1024;
constexpr auto debounce = std::chrono::milliseconds(300);
constexpr auto max_batch_delay = std::chrono::milliseconds(1200);

std::string utf8(std::wstring_view value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
                                         static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string out(size, '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
                        out.data(), size, nullptr, nullptr);
    return out;
}

bool same_ignore_case(std::string_view a, std::string_view b) noexcept {
    if (a.size() != b.size()) return false;
    for (std::size_t i = 0; i < a.size(); ++i) {
        const auto left = static_cast<unsigned char>(a[i]);
        const auto right = static_cast<unsigned char>(b[i]);
        if (left == right) continue;
        if (left >= 'A' && left <= 'Z' && left + 32 == right) continue;
        if (right >= 'A' && right <= 'Z' && right + 32 == left) continue;
        return false;
    }
    return true;
}

}  // namespace

const char* name(const Action action) noexcept {
    switch (action) {
        case Action::added: return "added";
        case Action::removed: return "removed";
        case Action::renamed: return "renamed";
        case Action::modified: break;
    }
    return "modified";
}

void to_json(Json& json, const Change& change) {
    json = Json{{"path", change.path}, {"action", name(change.action)}};
    if (!change.old_path.empty()) json["oldPath"] = change.old_path;
}

bool is_ignored(const std::string_view path) noexcept {
    if (path.empty()) return true;
    // Any path segment that is a generated/tool-private directory kills the whole
    // path, so nothing below build/ or node_modules/ ever reaches the UI.
    std::size_t start = 0;
    for (;;) {
        const auto slash = path.find('/', start);
        const auto segment = path.substr(start, slash == std::string_view::npos ? std::string_view::npos : slash - start);
        for (const auto& ignored : kIgnoredDirectories)
            if (same_ignore_case(segment, ignored)) return true;
        if (slash == std::string_view::npos) break;
        start = slash + 1;
    }
    // Cheap `*.ext` filter on the file name (log/temp/object noise).
    const auto last_slash = path.rfind('/');
    const auto file = path.substr(last_slash == std::string_view::npos ? 0 : last_slash + 1);
    for (const auto& suffix : kIgnoredSuffixes) {
        if (file.size() < suffix.size()) continue;
        if (same_ignore_case(file.substr(file.size() - suffix.size()), suffix)) return true;
    }
    return false;
}

namespace {

// One change per path per batch. The first action wins (a file that is created and
// then written in the same burst is still "added", which is what a tree needs), but
// a removal or a rename always overrides it: that is what the path ends up being.
void fold(std::vector<Change>& pending, Change change) {
    const auto found = std::find_if(pending.begin(), pending.end(),
                                    [&](const Change& existing) { return existing.path == change.path; });
    if (found == pending.end()) {
        pending.push_back(std::move(change));
        return;
    }
    const bool decisive = change.action == Action::removed || change.action == Action::renamed;
    const bool settled = found->action == Action::removed || found->action == Action::renamed;
    if (decisive) *found = std::move(change);
    else if (!settled) {
        change.action = found->action;
        *found = std::move(change);
    }
}

}  // namespace

Watcher::~Watcher() { stop(); }

void Watcher::start(const std::filesystem::path& root, Callback callback) {
    stop();
    std::lock_guard lock(mutex_);
    root_ = root;
    callback_ = std::move(callback);
    stop_reason_.clear();  // the reason belongs to the session that just ended
    const auto handle = CreateFileW(root_.c_str(), FILE_LIST_DIRECTORY,
                                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                    OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED, nullptr);
    if (handle == INVALID_HANDLE_VALUE)
        throw WorkspaceError("WATCH_FAILED", "无法监听工作区目录的变化。");
    directory_ = handle;
    event_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);     // manual-reset: completion
    stop_event_ = CreateEventW(nullptr, TRUE, FALSE, nullptr); // manual-reset: shutdown
    running_.store(true);
    thread_ = std::thread([this] { loop(); });
}

void Watcher::stop() noexcept {
    std::thread joinable;
    {
        std::lock_guard lock(mutex_);
        running_.store(false);
        if (stop_event_) SetEvent(stop_event_);
        if (directory_) CancelIoEx(directory_, nullptr);
        if (event_) SetEvent(event_);
        joinable = std::move(thread_);
    }
    if (joinable.joinable()) joinable.join();
    std::lock_guard lock(mutex_);
    if (directory_) { CloseHandle(directory_); directory_ = nullptr; }
    if (event_) { CloseHandle(event_); event_ = nullptr; }
    if (stop_event_) { CloseHandle(stop_event_); stop_event_ = nullptr; }
}

void Watcher::on_stopped(StoppedCb callback) {
    const std::lock_guard lock(mutex_);
    on_stopped_ = std::move(callback);
}

std::string Watcher::stop_reason() const {
    const std::lock_guard lock(mutex_);
    if (running_.load()) return {};
    return stop_reason_;
}

// Every way out of the pump — stop requested, root deleted, a failed read, a
// throwing callback — ends here, and each one says why. Without that, a watcher
// whose root was renamed away dies in silence and the file tree never refreshes
// again while the UI still believes it is being watched.
void Watcher::loop() {
    std::string reason;
    try {
        reason = pump();
    } catch (...) {
        // A throwing callback (or an allocation failure) ends this watch instead of
        // taking the process down; it is still an unexpected stop, not a clean one.
        reason = "监听线程异常退出";
    }
    if (reason.empty()) reason = "监听已停止";
    StoppedCb callback;
    {
        const std::lock_guard lock(mutex_);
        stop_reason_ = reason;       // recorded before running_ flips, so a reader
        running_.store(false);       // never sees "stopped" without a reason
        callback = on_stopped_;
    }
    if (callback) callback(std::move(reason));  // outside every lock, watcher thread
}

// The pump: one pending ReadDirectoryChangesW at a time; each completion folds its
// paths into the pending batch. The batch flushes after a quiet period (or the
// max delay) so a single logical change produces one callback. Returns why it left
// the loop; "监听已停止" means stop() asked for it, anything else is a death.
std::string Watcher::pump() {
    std::vector<char> buffer(buffer_bytes);
    OVERLAPPED overlapped{};
    std::vector<Change> pending;
    std::string renamed_from;  // an OLD_NAME waiting for the NEW_NAME that follows it
    auto batch_started = std::chrono::steady_clock::now();
    bool pending_read = false;

    const auto flush = [&] {
        if (pending.empty()) return;
        std::vector<Change> batch;
        batch.swap(pending);
        if (callback_) callback_(std::move(batch));
    };

    std::string reason;  // why the loop ended; empty means "stop() asked for it"
    while (running_.load()) {
        const HANDLE handles[] = {event_, stop_event_};
        if (!pending_read) {
            std::memset(&overlapped, 0, sizeof(OVERLAPPED));
            ResetEvent(event_);
            overlapped.hEvent = event_;
            const DWORD filter = FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME |
                                 FILE_NOTIFY_CHANGE_ATTRIBUTES | FILE_NOTIFY_CHANGE_SIZE |
                                 FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_SECURITY;
            if (!ReadDirectoryChangesW(directory_, buffer.data(), static_cast<DWORD>(buffer.size()),
                                       TRUE, filter, nullptr, &overlapped, nullptr)) {
                reason = "ReadDirectoryChangesW 失败";  // the handle is gone: root deleted
                break;
            }
            pending_read = true;
            continue;
        }
        // While a batch is open, wake at the quiet period so it flushes on time;
        // with nothing pending the read blocks until the next change.
        const DWORD timeout = pending.empty() ? INFINITE : static_cast<DWORD>(debounce.count());
        const DWORD waited = WaitForMultipleObjects(2, handles, FALSE, timeout);
        if (waited == WAIT_OBJECT_0 + 1) break;  // stop requested: the clean reason
        if (waited == WAIT_FAILED) { reason = "工作目录已不存在"; break; }
        DWORD transferred = 0;
        if (!GetOverlappedResult(directory_, &overlapped, &transferred, FALSE)) {
            if (GetLastError() == ERROR_IO_INCOMPLETE) {
                // Timed out waiting for more changes: the quiet period has passed,
                // so the batch goes out now — the last change is never dropped.
                flush();
                batch_started = std::chrono::steady_clock::now();
                continue;
            }
            // The usual cause is the root being deleted or renamed away mid-read.
            reason = "工作目录已不存在";
            break;
        }
        ResetEvent(event_);
        pending_read = false;
        if (transferred == 0) {
            // Overflow: too many changes at once. An empty batch is the caller's
            // "refresh everything" marker.
            pending.clear();
            renamed_from.clear();
            if (callback_) callback_({});
            continue;
        }
        auto* record = reinterpret_cast<FILE_NOTIFY_INFORMATION*>(buffer.data());
        const bool batch_starts_here = pending.empty();
        for (;;) {
            const std::wstring wide_name(record->FileName, record->FileNameLength / sizeof(wchar_t));
            std::string path = utf8(wide_name);
            for (auto& ch : path) if (ch == '\\') ch = '/';
            if (!path.empty()) {
                switch (record->Action) {
                    case FILE_ACTION_ADDED:
                        if (!is_ignored(path)) fold(pending, {path, Action::added, {}});
                        break;
                    case FILE_ACTION_REMOVED:
                        if (!is_ignored(path)) fold(pending, {path, Action::removed, {}});
                        break;
                    case FILE_ACTION_RENAMED_OLD_NAME:
                        // Kept until the new name arrives; an ignored source means
                        // the pair is really just an addition of the new path.
                        renamed_from = is_ignored(path) ? std::string() : path;
                        break;
                    case FILE_ACTION_RENAMED_NEW_NAME:
                        if (!renamed_from.empty()) {
                            // A rename into (or inside) an ignored directory reads
                            // as the disappearance of the old path.
                            if (is_ignored(path)) fold(pending, {renamed_from, Action::removed, {}});
                            else fold(pending, {path, Action::renamed, renamed_from});
                            renamed_from.clear();
                        } else if (!is_ignored(path)) {
                            fold(pending, {path, Action::added, {}});
                        }
                        break;
                    default:
                        if (!is_ignored(path)) fold(pending, {path, Action::modified, {}});
                        break;
                }
            }
            if (record->NextEntryOffset == 0) break;
            record = reinterpret_cast<FILE_NOTIFY_INFORMATION*>(
                reinterpret_cast<char*>(record) + record->NextEntryOffset);
        }
        // A rename pair can straddle two buffers; an old name that never found its
        // new one is a removal of the old path.
        if (!renamed_from.empty()) {
            fold(pending, {renamed_from, Action::removed, {}});
            renamed_from.clear();
        }
        // A batch is allowed max_batch_delay from its first change, however many
        // changes keep arriving inside the debounce window after that.
        if (batch_starts_here) batch_started = std::chrono::steady_clock::now();
        // A single batch must not sit forever: the max_batch_delay ceiling flushes
        // even if more changes keep arriving inside the debounce window.
        if (!pending.empty() && std::chrono::steady_clock::now() - batch_started > max_batch_delay) {
            flush();
            batch_started = std::chrono::steady_clock::now();
        }
    }
    flush();
    if (pending_read) { DWORD ignored = 0; GetOverlappedResult(directory_, &overlapped, &ignored, FALSE); }
    return reason;
}

}  // namespace watcher
}  // namespace taocode
