#pragma once

#include <atomic>
#include <chrono>
#include <filesystem>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "lsp.hpp"

namespace taocode {
namespace lsp {

// Owns one language-server child process and its two stdio pipes. A reader
// thread decodes the server's stdout and drives a Client; all Client access is
// serialised so the reader thread and the caller never race the pending-request
// map. Handlers (hover result, diagnostics) run on the reader thread — callers
// must marshal to their UI thread exactly like the clone events do.
class Host {
public:
    // 写服务器 stdin 单帧阻塞超过 200ms 时的诊断钩子（线程 id / 毫秒 / 本帧字节数）。
    // 存在的理由：调用方可能正抱着 `Session::mutex_`（`Session::change` 就在锁里写），
    // 那时服务器一旦不读 stdin（大项目在索引），整条 UI 线程会在别的地方 park 成"未响应"，
    // 现象里看不到任何线索。静态而不是成员：它只用于诊断，不该参与对象生命周期。
    static inline std::function<void(unsigned long, unsigned long, unsigned long)> slow_write_hook;

    struct Spec {
        std::filesystem::path executable;
        std::vector<std::wstring> arguments;
        std::filesystem::path working_directory;
    };
    using Ready = Client::Handler;

    Host();
    ~Host();
    Host(const Host&) = delete;
    Host& operator=(const Host&) = delete;

    // Spawns the server and runs the initialize handshake. `on_ready` fires once
    // with the server capabilities (or an error) on the reader thread.
    void start(const Spec& spec, Json initialize_params, Ready on_ready);
    void stop() noexcept;
    bool alive() const { return alive_; }

    void set_diagnostics(Client::Notify handler);
    // LSP `$/progress` 通知的出口（与诊断同一条读线程回调，见 Client::on_progress）。
    void set_progress(Client::Notify handler);
    void set_configuration(Json settings);
    // Wiring used by the session layer: the workspace writer behind
    // `workspace/applyEdit` and the sync kind the server announced.
    void set_document_editor(Client::DocumentEditor editor);
    void set_sync_kind(SyncKind kind);
    // How long a request may stay unanswered before the client fails it itself.
    void set_timeout(std::chrono::milliseconds timeout);
    void did_open(std::string uri, std::string language_id, int version, std::string text);
    void did_change(std::string uri, int version, std::string full_text);
    void did_close(std::string uri);
    // Sends a request and returns the id the server will answer with.
    std::int64_t request(std::string_view method, Json params, Client::Handler on_result);
    // A one-way notification (workspace/didCreateFiles, didChangeConfiguration…).
    // Silently dropped when the server is not running, like every other call here.
    void notify(std::string_view method, Json params);

private:
    struct Pipe;
    // Caret-driven requests: a newer one supersedes the older, which is cancelled
    // instead of holding a pending slot until the 60s deadline. Guarded by its own
    // leaf mutex so a cancellation never happens while io_mutex_ is held.
    static bool is_superseding(std::string_view method);
    std::mutex inflight_mutex_;
    std::map<std::string, std::int64_t> in_flight_;
    void write_frame(std::string_view frame);  // caller holds io_mutex_
    // Diagnostics for "server started but never saw initialize": when the env var
    // TAOCODE_LSP_TRACE is set to a file path, every frame we hand the server and
    // every frame we read back is appended there with a byte count. Off (one
    // getenv at construction) unless asked; the trace file is opened once.
    std::mutex trace_mutex_;
    void* trace_ = nullptr;  // std::FILE* when TAOCODE_LSP_TRACE is set

    mutable std::recursive_mutex io_mutex_;  // the pipes only: never held while a callback runs
    Client client_;
    std::unique_ptr<Pipe> pipe_;
    std::thread reader_;
    std::atomic<bool> alive_{false};
};

}  // namespace lsp
}  // namespace taocode
