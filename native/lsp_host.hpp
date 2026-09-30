#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
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
// thread decodes the server's stdout and drives a Client; a **writer thread**
// owns the blocking side of the other pipe (`WriteFile` to a server that is not
// reading its stdin blocks; it must never block a caller). All Client access is
// serialised so the reader thread and the caller never race the pending-request
// map. Handlers (hover result, diagnostics) run on the reader thread — callers
// must marshal to their UI thread exactly like the clone events do.
class Host {
public:
    // 写服务器 stdin 单帧阻塞超过 200ms 时的诊断钩子（写线程 id / 毫秒 / 本帧字节数）。
    // 只有写线程会触发它：2026-09-30 之前这个写就发生在调用方线程上（常常是那条唯一的
    // 语言服务线程，抱着 `Session::mutex_`），服务器一不读 stdin（大工程在索引）整条队列
    // 就停摆 —— 界面看到的是"语言服务没响应"，日志里却什么都没有。静态而不是成员：
    // 它只用于诊断，不该参与对象生命周期。
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
    // 这台服务器属于哪一代会话：`start()` 时连同作业对象一起登记，弃养那一代时按号收进程
    // （见 lsp_children.hpp —— 弃养的 Host 析构永远不会跑）。
    void set_generation(long generation) { generation_ = generation; }

    void set_diagnostics(Client::Notify handler);
    // LSP `$/progress` 通知的出口（与诊断同一条读线程回调，见 Client::on_progress）。
    void set_progress(Client::Notify handler);
    // `window/showMessage` 的出口（与进度同一条读线程回调）。
    void set_server_message(Client::Notify handler);
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
    // 出站帧只入队，不写：真正阻塞的 `WriteFile` 交给写线程。调用方（语言服务线程 /
    // 读线程 / IPC 线程）从此不会因为服务器不读 stdin 而停住 —— 这是"status/诊断/补全
    // 一起没响应"的根因修法，见 lsp_host.cpp 里写线程的注释。
    void enqueue_frame(std::string_view frame);
    void write_frame_now(std::string_view frame);  // 只允许写线程调用（可能阻塞）
    void pump_writes();  // 写线程主循环：取出站帧、做那次可能阻塞的写
    // Diagnostics for "server started but never saw initialize": when the env var
    // TAOCODE_LSP_TRACE is set to a file path, every frame we hand the server and
    // every frame we read back is appended there with a byte count. Off (one
    // getenv at construction) unless asked; the trace file is opened once.
    std::mutex trace_mutex_;
    void* trace_ = nullptr;  // std::FILE* when TAOCODE_LSP_TRACE is set

    mutable std::recursive_mutex io_mutex_;  // the pipes only: never held while a callback runs
    long generation_ = 0;                    // 会话代号，见 set_generation
    Client client_;
    std::unique_ptr<Pipe> pipe_;
    std::thread reader_;
    // 出站队列：写线程是它唯一的消费者，生产者可以有多个（帧序即入队序，和以前
    // io_mutex_ 串起来的那条顺序等价）。
    std::mutex outbox_mutex_;
    std::condition_variable outbox_cv_;
    std::deque<std::string> outbox_;
    bool writer_stop_ = false;
    std::thread writer_;
    std::atomic<bool> alive_{false};
};

}  // namespace lsp
}  // namespace taocode
