#pragma once

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
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
class Client {
public:
    enum class State { fresh, initializing, ready, stopping, stopped, failed };
    using Writer = std::function<void(std::string_view frame)>;
    // `error` is the JSON-RPC error object, or null when the call succeeded.
    using Handler = std::function<void(Json result, Json error)>;
    using Notify = std::function<void(Json params)>;

    explicit Client(Writer writer) : writer_(std::move(writer)) {}

    State state() const { return state_; }
    bool ready() const { return state_ == State::ready; }

    // Lifecycle. `capabilities` and `initialization_options` are placed into the
    // standard initialize params by the caller so the client stays server-agnostic.
    void start(Json initialize_params, Handler on_result);
    void shutdown(Handler on_result);  // shutdown request, then exit notification

    // Synchronisation and feature calls. All require a ready connection.
    void did_open(const std::string& uri, const std::string& language_id, int version, const std::string& text);
    void did_change(const std::string& uri, int version, const std::string& full_text);
    void did_close(const std::string& uri);
    void request(std::string_view method, Json params, Handler on_result);
    void notify(std::string_view method, Json params);

    void on_diagnostics(Notify handler) { diagnostics_ = std::move(handler); }
    void set_configuration(Json settings);

    // Feed one parsed message received from the server.
    void receive(const Json& message);

    // When the host's reader thread bails (server died, protocol error), the host
    // calls this so any request the client is still expecting gets a clear error
    // instead of silently hanging.
    void fail_pending(const std::string& code);

private:
    std::mutex mutex_;
    std::int64_t next_id_ = 1;
    State state_ = State::fresh;
    Writer writer_;
    Notify diagnostics_;
    Json configuration_ = Json::object();
    std::unordered_map<std::int64_t, Handler> pending_;

    void send(const Json& message);
    std::int64_t send_request(std::string_view method, Json params, Handler on_result);
    void respond(const Json& id, Json result, Json error);
};

}  // namespace lsp
}  // namespace taocode
