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

}  // namespace

Watcher::~Watcher() { stop(); }

void Watcher::start(const std::filesystem::path& root, Callback callback) {
    stop();
    std::lock_guard lock(mutex_);
    root_ = root;
    callback_ = std::move(callback);
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
        if (!running_.load() && !thread_.joinable()) return;
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

// The pump: one pending ReadDirectoryChangesW at a time; each completion folds its
// paths into the pending batch. The batch flushes after a quiet period (or the
// max delay) so a single logical change produces one callback.
void Watcher::loop() {
    std::vector<char> buffer(buffer_bytes);
    auto* overlapped = reinterpret_cast<OVERLAPPED*>(HeapAlloc(GetProcessHeap(), 0, sizeof(OVERLAPPED)));
    overlapped_ = overlapped;
    std::vector<std::string> pending;
    auto last_change = std::chrono::steady_clock::now();
    bool pending_read = false;

    const auto flush = [&] {
        if (pending.empty()) return;
        std::vector<std::string> batch;
        batch.swap(pending);
        if (callback_) callback_(std::move(batch));
    };

    while (running_.load()) {
        const HANDLE handles[] = {event_, stop_event_};
        if (!pending_read) {
            std::memset(overlapped, 0, sizeof(OVERLAPPED));
            ResetEvent(event_);
            overlapped->hEvent = event_;
            const DWORD filter = FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME |
                                 FILE_NOTIFY_CHANGE_ATTRIBUTES | FILE_NOTIFY_CHANGE_SIZE |
                                 FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_SECURITY;
            if (!ReadDirectoryChangesW(directory_, buffer.data(), static_cast<DWORD>(buffer.size()),
                                       TRUE, filter, nullptr, overlapped, nullptr)) {
                break;  // root vanished or handle closed: the watcher ends quietly
            }
            pending_read = true;
            continue;
        }
        // While a batch is open, wake at the quiet period so it flushes on time;
        // with nothing pending the read blocks until the next change.
        const DWORD timeout = pending.empty() ? INFINITE : static_cast<DWORD>(debounce.count());
        const DWORD waited = WaitForMultipleObjects(2, handles, FALSE, timeout);
        if (waited == WAIT_OBJECT_0 + 1) break;  // stop requested
        if (waited == WAIT_FAILED) break;
        DWORD transferred = 0;
        if (!GetOverlappedResult(directory_, overlapped, &transferred, FALSE)) {
            if (GetLastError() == ERROR_IO_INCOMPLETE) {
                // Timed out waiting for more changes: the quiet period has passed.
                flush();
                continue;
            }
            break;
        }
        ResetEvent(event_);
        pending_read = false;
        if (transferred == 0) {
            // Overflow: too many changes at once. An empty batch is the caller's
            // "refresh everything" marker.
            pending.clear();
            if (callback_) callback_({});
            continue;
        }
        auto* record = reinterpret_cast<FILE_NOTIFY_INFORMATION*>(buffer.data());
        for (;;) {
            const std::wstring wide_name(record->FileName, record->FileNameLength / sizeof(wchar_t));
            std::string path = utf8(wide_name);
            for (auto& ch : path) if (ch == '\\') ch = '/';
            if (!path.empty() && std::find(pending.begin(), pending.end(), path) == pending.end())
                pending.push_back(path);
            if (record->NextEntryOffset == 0) break;
            record = reinterpret_cast<FILE_NOTIFY_INFORMATION*>(
                reinterpret_cast<char*>(record) + record->NextEntryOffset);
        }
        last_change = std::chrono::steady_clock::now();
        if (std::chrono::steady_clock::now() - last_change > max_batch_delay) flush();
    }
    flush();
    if (pending_read) { DWORD ignored = 0; GetOverlappedResult(directory_, overlapped, &ignored, FALSE); }
    HeapFree(GetProcessHeap(), 0, overlapped_);
    overlapped_ = nullptr;
}

}  // namespace watcher
}  // namespace taocode
