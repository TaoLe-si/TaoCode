#pragma once

// ---------------------------------------------------------------------------
// TaoCode native Debug Adapter Protocol (DAP) client.
//
// A debug adapter is a child process (cppvsdbg via OpenDebugAD7.exe, lldb-vscode,
// debugpy, ...) that speaks DAP over its stdin/stdout pipes. The wire form is the
// LSP base framing again — `Content-Length: N\r\n\r\n<N bytes of UTF-8 JSON>` — but
// this file implements its own framing on purpose: the DAP engine must stay
// self-contained and must never link against, include or reuse lsp.cpp.
//
// Message shapes (DAP spec, all three carry a monotonically increasing `seq`):
//   request  (client -> adapter) {seq, type:"request",   command, arguments}
//   response (adapter -> client) {seq, type:"response",  request_seq, success, command, message?, body?}
//   event    (adapter -> client) {seq, type:"event",     event, body?}
// Responses are correlated to requests strictly by `request_seq` == the `seq` we
// assigned when writing that request. Events go to the caller's event callback.
//
// COORDINATES: DAP is 1-based on both axes (linesStartAt1 / columnsStartAt1 are
// announced as true in `initialize`). Every line/column produced by this client
// (breakpoint lines, frame line/column) is therefore 1-BASED and is passed through
// unchanged — unlike the LSP side of this IDE, which is 0-based. The UI must add
// exactly one when indexing a 0-based CodeMirror document.
//
// PATHS: the bridge speaks workspace-relative '/' paths. They are converted to
// `file:///` URIs on the way out (source.path for setBreakpoints) and back to
// workspace-relative '/' on the way in (frame paths), so a debugger and the editor
// always agree. Absolute paths from an adapter (or from the launch configuration)
// are accepted too and simply normalised to '/' separators.
//
// THREADS: one reader thread pumps adapter -> client messages. Every Reply and
// every event callback runs on that thread and must not block; the callbacks are
// never invoked while an internal lock is held, so a callback may safely start
// another request. Writes are serialised under their own mutex.
//
// LIFETIME: every mutable field lives in a shared `State`. The reader thread (and
// the request-timeout watchdog) hold a reference to it, so a Client that is
// destroyed right after `disconnect()` — while a callback is still in flight —
// can never leave those threads touching dead memory. Stopping is idempotent and
// every callback is dropped once the state is stopped.
// ---------------------------------------------------------------------------

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <vector>

#include "workspace.hpp"  // taocode::Json, taocode::WorkspaceError

namespace taocode {
namespace dap {

// A corrupt or hostile adapter advertising an absurd Content-Length must not make
// us reserve unbounded memory; these caps mirror the LSP engine's limits.
inline constexpr std::size_t max_message_bytes = 64 * 1024 * 1024;
inline constexpr std::size_t max_header_bytes = 64 * 1024;

// How long a request may stay unanswered before the client answers its caller
// itself. A hung adapter must never leave a bridge Promise pending forever.
inline constexpr std::chrono::milliseconds default_request_timeout{120000};
// Hard ceiling on in-flight requests: an adapter that never answers cannot grow
// the pending map without bound.
inline constexpr std::size_t max_pending_requests = 4096;

// Incremental reader for the DAP base protocol. Feed raw bytes from the adapter's
// stdout in arbitrary chunks (header split across reads, body split across reads,
// several frames in one read are all fine) and pop whole messages as they become
// available. Throws WorkspaceError("DAP_PROTOCOL", ...) on a malformed frame so
// the caller tears the connection down instead of desynchronising.
class MessageReader {
public:
    void feed(std::string_view bytes);
    // Returns one decoded message, or std::nullopt when more bytes are required.
    std::optional<Json> next();

private:
    std::string buffer_;
};

// Serialise a DAP message into a frame (Content-Length only; the optional
// Content-Type header is omitted, which the protocol allows).
std::string encode_message(const Json& message);

// Message builders. `seq` is assigned by the client, never by the caller.
Json make_request(std::int64_t seq, std::string_view command, Json arguments);
Json make_event(std::int64_t seq, std::string_view event, Json body);

// Classify an inbound message.
bool is_response(const Json& message);
bool is_event(const Json& message);
bool is_adapter_request(const Json& message);

// Launch configuration keys the client rewrites from workspace-relative to
// absolute native paths before sending `launch`.
inline constexpr std::string_view path_configuration_keys[] = {"program", "cwd", "coreDumpPath", "dumpPath",
                                                               "executable", "workingDirectory"};

// Debug session client owning one adapter child process. Not copyable; one live
// session at a time. Every command method tolerates an empty Reply (fire and
// forget: the response is drained and discarded).
struct Startup;  // in-flight `start_debugging` sequence, defined in dap.cpp
class Client {
public:
    // `error` is null on success. On failure it is {code, message, command},
    // ready to be forwarded as the bridge reply's error object.
    using Reply = std::function<void(Json result, Json error)>;
    // Receives the reshaped bridge event: {"event":name, ...contract keys...}.
    using EventCb = std::function<void(Json event)>;
    // Answers an adapter reverse request (`runInTerminal`, `startDebugging`):
    // returns the response body on success, or fills `error` with a reason. The
    // host installs one so the request can reach the terminal layer / its own
    // session; with none installed the client does the work itself.
    using ReverseHandler = std::function<Json(const Json& arguments, std::string& error)>;

    Client();
    ~Client();
    Client(const Client&) = delete;
    Client& operator=(const Client&) = delete;

    // Workspace root used for the relative path <-> file:/// URI mapping. Must be
    // set before breakpoints or stack traces are exchanged; empty means "pass
    // paths through unmodified".
    void set_root(std::filesystem::path root);
    std::filesystem::path root() const;

    // --- reverse request hooks ---------------------------------------------
    // Optional wiring for the host. Both are process-wide (an adapter may ask at
    // any time) and both have a real default, so nothing is ever unanswered.
    static void set_run_in_terminal_handler(ReverseHandler handler);
    static void set_start_debugging_handler(ReverseHandler handler);

    // How long a request waits before it is answered with a TIMEOUT error.
    void set_timeout(std::chrono::milliseconds timeout);

    // --- lifecycle ---------------------------------------------------------
    // Spawn the adapter (CreateProcessW, redirected stdin/stdout, its own Job
    // Object with KILL_ON_JOB_CLOSE so a debugger can never be orphaned) and
    // start pumping its stdout. Throws WorkspaceError("DAP_SPAWN", ...) when the
    // process cannot be created. `on_event` may be empty.
    void start(const std::wstring& command, const std::vector<std::wstring>& arguments,
               const std::filesystem::path& working_directory, EventCb on_event);
    // Close stdin, kill the job (adapter + any debuggee it spawned), join the
    // reader thread, reclaim every handle. Safe to call twice and from a callback.
    void shutdown() noexcept;
    bool running() const;              // adapter pipe is live
    bool exited() const;              // reader saw EOF / the process was reaped
    long exit_code() const;           // valid once exited()
    bool debuggee_alive() const;      // false after a `terminated` event

    // --- path mapping (public for tests and for bridge-side reshaping) -----
    std::string to_uri(const std::string& path) const;   // rel '/' -> file:/// URI
    std::string to_path(const std::string& source) const;  // file:/// URI or abs path -> rel '/'
    std::string to_native(const std::string& path) const;  // rel '/' -> absolute '/' path

    // --- requests (one per DAP command) ----------------------------------
    // `initialize` with TaoCode's capabilities, then — only after the adapter
    // acknowledges — the mandatory `initialized` event. Reply result: the
    // adapter's capabilities body.
    void initialize(const std::string& adapter_id, Reply on_reply);
    // `launch`. The configuration is sent as the request arguments verbatim,
    // except that path_configuration_keys are absolutised and type/request/name
    // defaults are filled in.
    void launch(Json configuration, Reply on_reply);
    // `attach`: the same handshake for an already-running process (IDEA's Attach
    // to Process); selectors like processId/pipeName pass through untouched.
    void attach(Json configuration, Reply on_reply);
    // `setExceptionBreakpoints`. The chosen filters are remembered and re-applied
    // by the next start; with no live adapter the call only stores them.
    void set_exception_breakpoints(const Json& filters, Reply on_reply);
    // `threads`: {threads:[{id, name}]} for the debugger's thread list.
    void threads(Reply on_reply);
    void set_configuration_done(Reply on_reply);
    // `setBreakpoints`. `requested` is [{line, condition?, hitCondition?, logMessage?}]
    // with 1-based lines; the valid subset is remembered (so a restart re-applies it,
    // conditions included) and, when a session is live, installed. Reply result:
    // {ok, verifiedLines:[1-based int], path, deferred?}.
    void set_breakpoints(const std::string& rel_path, const Json& requested, Reply on_reply);
    void continue_execution(long thread_id, bool all, Reply on_reply);
    void pause(long thread_id, Reply on_reply);
    void next(long thread_id, Reply on_reply);
    void step_in(long thread_id, Reply on_reply);
    void step_out(long thread_id, Reply on_reply);
    // Reply result: {frames:[{id, name, line, column, path}], totalFrames}.
    void stack_trace(long thread_id, Reply on_reply);
    // Reply result: {scopes:[{name, reference, variablesReference, expensive}]}.
    void scopes(long frame_id, Reply on_reply);
    // Reply result: {variables:[{name, value, type?, reference, named}]}.
    void variables(long variables_reference, Reply on_reply);
    // Ends the session: asks the adapter to disconnect and then waits for its
    // reader thread to actually exit, so a caller that drops the Client right
    // afterwards can never race a callback still running.
    void disconnect(Reply on_reply);

    // Escape hatch for adapter-specific commands (`evaluate`, `source`,
    // `readMemory`, ...). The raw success body is handed to the Reply untouched.
    void request(std::string_view command, Json arguments, Reply on_reply);

    // Full startup sequence behind `dap.start`: initialize -> (initialized event)
    // -> launch -> setBreakpoints for every remembered file -> configurationDone.
    // Reply result on success: {ok:true, capabilities, breakpoints:[{path,
    // verifiedLines}]}. A setBreakpoints failure is reported inside `breakpoints`
    // but does not abort the session; initialize/launch/configurationDone
    // failures do, and surface as the Reply's error.
    void start_debugging(const std::string& adapter_id, Json launch_configuration, Reply on_reply);

    // Remembered breakpoints, keyed by workspace-relative '/' path, values are
    // 1-based lines. Used by `dap.start` and by the UI to repaint the gutter.
    Json breakpoint_map() const;
    void forget_breakpoints(const std::string& rel_path);
    void clear_breakpoints();

private:
    struct State;  // all mutable session state; shared with the reader thread
    struct Pending {
        Reply handler;
        std::string command;
        std::chrono::steady_clock::time_point deadline;
    };

    static void reader_loop(std::shared_ptr<State> state);
    static void watchdog_loop(std::shared_ptr<State> state);
    static void handle(State& state, const Json& message);
    static void deliver_event(State& state, Json event);
    static void answer_adapter_request(State& state, const Json& message);
    static void fail_pending(State& state, std::string_view reason);
    static bool write_frame(State& state, std::string_view frame);
    // Real defaults for the two reverse requests, used when the host installed no
    // hook: the command is launched, and a nested adapter session is started.
    static Json run_in_terminal_default(const Json& arguments, std::string& error);
    static Json start_debugging_default(State& state, const Json& arguments, std::string& error);
    void close_pipes_and_kill();
    void apply_remembered_breakpoints(std::shared_ptr<Startup> startup);
    std::int64_t send(std::string_view command, Json arguments, Reply on_reply);
    void wait_for_exit(std::chrono::milliseconds limit) const;

    std::shared_ptr<State> state_;
};

}  // namespace dap
}  // namespace taocode
