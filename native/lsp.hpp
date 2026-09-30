#pragma once

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>

#include "workspace.hpp"  // Json, WorkspaceError

namespace taocode {
namespace lsp {

// Upper bound on a single framed message body. A corrupt or hostile server that
// advertises an absurd Content-Length must not make us reserve unbounded memory.
inline constexpr std::size_t max_message_bytes = 64 * 1024 * 1024;
// Bound on the header block before a `\r\n\r\n` is seen; guards against a stream
// of header bytes that never terminates.
inline constexpr std::size_t max_header_bytes = 64 * 1024;

// TextDocumentSyncKind, as the server advertises it in
// ServerCapabilities.textDocumentSync. The client honours it: with `incremental`
// a didChange carries a range instead of the whole document.
enum class SyncKind { none = 0, full = 1, incremental = 2 };

// How long a request may stay unanswered before the client gives up and answers
// its caller itself. A hung language server must never leave a bridge Promise
// pending forever, so every request carries a deadline.
inline constexpr std::chrono::milliseconds default_request_timeout{60000};
// Hard ceiling on the number of requests a client tracks at once: a server that
// never answers cannot grow the pending map without bound.
inline constexpr std::size_t max_pending_requests = 4096;

// Incremental reader for the LSP base protocol (header block terminated by
// CRLF CRLF, then exactly Content-Length bytes of UTF-8 JSON). Feed raw bytes
// from the server's stdout in arbitrary chunks; pop whole messages as they
// become available. Throws WorkspaceError("LSP_PROTOCOL", ...) on a malformed
// frame so the caller can tear the connection down rather than desynchronise.
class MessageReader {
public:
    void feed(std::string_view bytes);
    // Returns one decoded message, or std::nullopt when more bytes are required.
    std::optional<Json> next();

private:
    std::string buffer_;
};

// Serialise a JSON-RPC message into an LSP frame (Content-Length only; the
// optional Content-Type header is intentionally omitted, which the spec allows).
std::string encode_message(const Json& message);

// JSON-RPC 2.0 builders used by the client request/notification layer.
Json make_request(std::int64_t id, std::string_view method, Json params);
Json make_notification(std::string_view method, Json params);

// Classify a message received from the peer.
bool is_response(const Json& message);
bool is_server_request(const Json& message);
bool is_notification(const Json& message);

// Transport-agnostic LSP client: it turns API calls into framed JSON-RPC writes
// and turns parsed server messages into callbacks. The subprocess host feeds it
// bytes and drains its writes, so this state machine is testable with a scripted
// peer and does not depend on a real language server being installed.
//
// LOCKING: `mutex_` guards the client's own bookkeeping only. Nothing is written
// to the peer and no caller callback is invoked while it is held, so a callback
// may freely re-enter the client (or the Session that owns it) without deadlock.
class Client {
public:
    enum class State { fresh, initializing, ready, stopping, stopped, failed };
    using Writer = std::function<void(std::string_view frame)>;
    // `error` is the JSON-RPC error object, or null when the call succeeded.
    using Handler = std::function<void(Json result, Json error)>;
    using Notify = std::function<void(Json params)>;
    // Applies one document's TextEdit[] to the file the uri names. The edits are
    // already sorted back-to-front, so they can be spliced in order without
    // invalidating each other's offsets. `version` is the document version the
    // server saw, or -1 when it did not send one. Returns std::nullopt on success
    // and a human-readable reason on failure (the reply carries it verbatim).
    using DocumentEditor = std::function<std::optional<std::string>(const std::string& uri, const Json& edits, int version)>;

    explicit Client(Writer writer) : writer_(std::move(writer)) {}
    ~Client();

    State state() const { return state_; }
    bool ready() const { return state_ == State::ready; }

    // Lifecycle. `capabilities` and `initialization_options` are placed into the
    // standard initialize params by the caller so the client stays server-agnostic.
    void start(Json initialize_params, Handler on_result);
    void shutdown(Handler on_result);  // shutdown request, then exit notification

    // Synchronisation and feature calls. All require a ready connection.
    void did_open(const std::string& uri, const std::string& language_id, int version, const std::string& text);
    // Sends a full-text change or — when the server asked for incremental sync —
    // the smallest range that turns the previous text into `full_text`.
    void did_change(const std::string& uri, int version, const std::string& full_text);
    void did_close(const std::string& uri);
    // Returns the request id the server will answer with, so a caller can `cancel()`
    // a request that a newer one supersedes.
    std::int64_t request(std::string_view method, Json params, Handler on_result);
    void notify(std::string_view method, Json params);

    void on_diagnostics(Notify handler) { diagnostics_ = std::move(handler); }
    // LSP `$/progress`（begin/report/end）—— 上游把它变成一条带百分比的后台任务，
    // 见 `LspServerNotificationsHandlerImpl.notifyProgress`（platform/lsp-impl/src/impl/
    // LspServerNotificationsHandlerImpl.kt:257-328）。
    void on_progress(Notify handler) { progress_ = std::move(handler); }
    // LSP `window/showMessage`（`:1` 错误 / `:2` 警告 / `:3` 信息 / `:4` 日志）—— jdt.ls 用它报
    // "Gradle 导入失败"这类整条工程级的问题。以前直接丢掉，界面上就表现为"外部的类解析不了、
    // 又不知道为什么"。
    void on_server_message(Notify handler) { server_message_ = std::move(handler); }
    void set_configuration(Json settings);

    // Feed one parsed message received from the server.
    void receive(const Json& message);

    // When the host's reader thread bails (server died, protocol error), the host
    // calls this so any request the client is still expecting gets a clear error
    // instead of silently hanging.
    void fail_pending(const std::string& code);

    // --- wiring the client to the rest of the IDE ---------------------------
    // Installs the real workspace writer used by `workspace/applyEdit`. Without
    // one the client reports the edit as not applied instead of pretending.
    void set_document_editor(DocumentEditor editor) { editor_ = std::move(editor); }
    // Tells the client which sync kind the server announced, so didChange matches
    // the server's own declaration instead of guessing.
    void set_sync_kind(SyncKind kind) { sync_kind_ = kind; }
    SyncKind sync_kind() const { return sync_kind_; }
    void set_timeout(std::chrono::milliseconds timeout);
    std::chrono::milliseconds timeout() const;
    // Cancels an outstanding request: sends `$/cancelRequest`, drops the pending
    // entry and answers the caller with a CANCELLED error. Returns false when the
    // id is unknown (already answered, cancelled or timed out).
    bool cancel(std::int64_t id);

private:
    struct Pending {
        Handler handler;
        std::chrono::steady_clock::time_point deadline;
    };

    mutable std::mutex mutex_;
    std::condition_variable due_;
    std::uint64_t wake_ = 0;   // bumped when a deadline is registered, so the
                               // watchdog re-picks the earliest one instead of
                               // sleeping on a stale absolute time
    std::int64_t next_id_ = 1;
    State state_ = State::fresh;
    Writer writer_;
    Notify diagnostics_;
    Notify progress_;
    Notify server_message_;
    Json configuration_ = Json::object();
    std::unordered_map<std::int64_t, Pending> pending_;
    std::unordered_map<std::string, std::string> synced_;  // uri -> last text sent
    DocumentEditor editor_;
    SyncKind sync_kind_ = SyncKind::full;
    std::chrono::milliseconds timeout_ = default_request_timeout;
    std::thread watchdog_;
    bool watching_ = false;

    void send(const Json& message);
    std::int64_t send_request(std::string_view method, Json params, Handler on_result);
    void respond(const Json& id, Json result, Json error);
    void answer_apply_edit(const Json& id, const Json& params);
    void watchdog_loop();
    void wake_watchdog(std::unique_lock<std::mutex>& lock);
};

}  // namespace lsp
}  // namespace taocode
