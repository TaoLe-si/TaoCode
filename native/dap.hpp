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
    // DAP `gotoTargets`（IDEA 的 Run to Cursor，Alt+F9）：问适配器"这一行能停在哪儿"。
    // Reply result: {targets:[{id, label, line?, column?}]}。
    void goto_targets(const std::string& rel_path, long line, long column, Reply on_reply);
    // DAP `goto`：跳到 gotoTargets 给出的目标 —— 「运行到光标处」的第二步。
    void goto_target(long thread_id, long target_id, Reply on_reply);
    // DAP `restartFrame`（IDEA Frames 视图的「丢弃帧」）：回滚到该帧重新执行。
    void restart_frame(long frame_id, Reply on_reply);
    // DAP `breakpointLocations`（规范 "Breakpoint Locations Request"）—— IDEA 的
    // `XLineBreakpointType.canPutAt(file, line, project)`
    // （`platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/XLineBreakpointType.java:50-52`，
    // 默认返回 false；挑选逻辑见 `XDebuggerUtilImpl.java:111-121`：`canPutAt` 为真且 priority
    // 最高的类型胜出，**一个都没有就拒绝放断点**并报 "Cannot find appropriate breakpoint type"，
    // 布尔版 `canPutBreakpointAt` 在 `:134-136`）。
    // 规范里由能力位 `supportsBreakpointLocationsRequest` 门控，**默认 false**；没声明的适配器
    // 回 `DAP_UNSUPPORTED`，调用方据此保持旧行为（不因为服务器不支持就把功能禁掉）。
    // `end_line`/`column`/`end_column` 都按规范可选：<= 0 表示不发该字段。
    // Reply result: {available, locations:[{line, column?, endLine?, endColumn?}]}，
    // **空数组是有意义的答案**（= IDEA 的 "没有可放置位置"），不是错误。
    void breakpoint_locations(const std::string& rel_path, long line, long end_line, long column, long end_column,
                              Reply on_reply);
    // DAP `completions`（规范 "Completions Request"）：调试表达式输入框的补全。
    //
    // **IDEA 侧没有平台级对应类**（这点查过源码，不要照抄一个看起来像的名字）：
    // `XDebuggerEvaluator`（`platform/xdebugger-api/src/com/intellij/xdebugger/evaluation/XDebuggerEvaluator.java:25`）
    // 只有 `evaluate`，没有补全方法；debugger 域也没有注册 `CompletionContributor`。
    // 真实链路是「**调试上下文的可见符号** + 语言的通用补全」：Java/JDI 侧由
    // `StackFrameProxyImpl.visibleVariables()` 提供可见变量（被
    // `java/debugger/impl/src/com/intellij/debugger/engine/ContextUtil.java:91` 使用），
    // 补全本身走语言插件那套。对 DAP 来说这件事被收进协议：适配器自己知道可见符号，
    // 所以客户端只要发 `completions`。
    //
    // 由能力位 `supportsCompletionsRequest` 门控（**规范默认 false**），未声明回 `DAP_UNSUPPORTED`。
    // Reply result: {available, items:[{label, text?, type?, start?, length?}]}。
    void completions(const std::string& text, long column, long frame_id, long line, Reply on_reply);
    // DAP `loadedSources`（规范 "Loaded Sources Request"）：按需重取"适配器已加载的源文件"清单。
    // **事件通道已经收 `loadedSource` 事件**（增量），这里补的是主动拉取整份清单的请求通道 ——
    // 规范里 `loadedSource` 事件不带 id 也没有 list 语义，UI 想重同步只能再问一次。
    // **IDEA 侧没有对应类**（`grep -rln "LoadedSources\|loadedSources" platform/xdebugger-*/` 零命中），
    // 属协议侧补齐。能力位 `supportsLoadedSourcesRequest`，未声明回 `DAP_UNSUPPORTED`。
    // Reply result: {available, sources:[{name?, path?(工作区相对), sourceReference?, origin?, presentationHint?}]}，
    // **空数组是有意义的答案**（这个会话还没加载任何源文件）。
    void loaded_sources(Reply on_reply);
    // DAP `modules`（规范 "Modules Request"）：按需重取模块清单（事件 `module` 只推增量）。
    // `start_module` <= 0 与 `module_count` <= 0 都**不发**该字段（规范：省略 = 从第 0 个开始 /
    // 返回全部）。**IDEA 侧没有对应类**，属协议侧补齐。能力位 `supportsModulesRequest`。
    // Reply result: {available, modules:[{id, name, path?, type?, version?, symbolStatus?, addressRange?, ...}],
    // totalModules?}；`id`/`name` 是规范必填，缺一个的条目丢弃（既认不出也显示不了）。
    void modules(long start_module, long module_count, Reply on_reply);
    // DAP `stepBack` / `reverseContinue`（反向调试）：回退一步 / 反向继续执行。
    // 两者共用能力位 `supportsStepBack`（**规范默认 false**），未声明回 `DAP_UNSUPPORTED` ——
    // 反向执行是 GDB/LLDB 一类后端的能力，普通适配器答不上来。
    // **IDEA 侧没有对应类**（`find . -iname "*StepBack*"` 零命中），属协议侧补齐。
    void step_back(long thread_id, Reply on_reply);
    void reverse_continue(long thread_id, Reply on_reply);
    // DAP `readMemory`（规范 "Read Memory Request"）：按 `memoryReference` 读一段内存。
    // 能力位 `supportsReadMemoryRequest`（**规范默认 false**），未声明回 `DAP_UNSUPPORTED`。
    // `offset` <= 0 不发该字段（规范默认 0）。
    // Reply result: {available, address?, dataB64?, offset?, unreadableBytes?} —— 字节经 base64
    // 过桥（`data` 原样改名 `dataB64`），十六进制/ASCII 的渲染只在前端一份实现。
    void read_memory(const std::string& memory_reference, long offset, long count, Reply on_reply);
    // DAP `disassemble`（规范 "Disassemble Request"）：反汇编一段指令。
    // 能力位 `supportsDisassembleRequest`（**规范默认 false**），未声明回 `DAP_UNSUPPORTED`。
    // `offset`/`instruction_offset` <= 0 与 `resolve_symbols=false` 都不发对应字段。
    // Reply result: {available, instructions:[{address, instruction, instructionBytes?, symbol?, path?, line?, column?}],
    // offset?, unreadableBytes?}；`address`/`instruction` 是规范必填，缺一个的条目丢弃。
    void disassemble(const std::string& memory_reference, long offset, long instruction_offset, long instruction_count,
                     bool resolve_symbols, Reply on_reply);
    void pause(long thread_id, Reply on_reply);
    void next(long thread_id, Reply on_reply);
    void step_in(long thread_id, Reply on_reply);
    void step_out(long thread_id, Reply on_reply);
    // Reply result: {frames:[{id, name, line, column, path}], totalFrames}.
    void stack_trace(long thread_id, Reply on_reply);
    // DAP `stackTrace` 的**分页**形式（规范 "Stack Trace Request" 的 `startFrame`/`levels`）。
    // 规范里两个字段都可选，所以 <= 0 时**不发该键**（省略 = 从第 0 帧起 / 返回全部）——
    // 发 0 会被适配器当成"第 0 帧"这个具体值，与"不指定"是两回事。
    // Reply result 与上面同形（totalFrames 仍是适配器报的总数，不是本页的条数）。
    void stack_trace(long thread_id, long start_frame, long levels, Reply on_reply);
    // Reply result: {scopes:[{name, reference, variablesReference, expensive, namedVariables?, indexedVariables?}]}.
    void scopes(long frame_id, Reply on_reply);
    // Reply result: {variables:[{name, value, type?, reference, named, namedVariables?, indexedVariables?}]}.
    void variables(long variables_reference, Reply on_reply);
    // DAP `variables` 的**分页**形式（规范 "Variables Request" 的 `start`/`count`）：
    // 大容器（数组/集合）一次只取一页，`start`/`count` <= 0 时**不发该键**。
    // Reply result 与上面同形。
    void variables(long variables_reference, long start, long count, Reply on_reply);
    // DAP `evaluate`（规范 "Evaluate Request"）：求值表达式 —— IDEA 的 Evaluate Expression /
    // hover 检查。`context` 取规范里的 `watch`/`repl`/`hover`/`variables`/`clipboard`；
    // `frame_id` <= 0 时**不发该键**（省略 = 全局上下文）。走整形，字段与 `variables` 一条
    // 保持一致（`reference`/`named`/`namedVariables`/`indexedVariables`），并保留前端在用的
    // `variablesReference` 键，这样 UI 能用同一套渲染。
    void evaluate(const std::string& expression, const std::string& context, long frame_id, Reply on_reply);
    // DAP `dataBreakpoints`（规范 "Data Breakpoints Request"）：列出适配器支持的数据断点
    // （变量/内存位置发生变化时停住）。IDEA 的对应物是 `JavaFieldBreakpointType` 的字段观察点
    // （`java/debugger/impl/src/com/intellij/debugger/ui/breakpoints/JavaFieldBreakpointType.java`）。
    // 能力位 `supportsDataBreakpoints`（**规范默认 false**），未声明回 `DAP_UNSUPPORTED`。
    // Reply result: {available, breakpoints:[{id?, dataId, accessType?, label, description?}]}，
    // **空数组是有意义的答案**（这个会话没有可观察的数据位置）。
    void data_breakpoints(Reply on_reply);
    // DAP `setDataBreakpoints`（能力位 `supportsDataBreakpoints`）：装/清数据断点。
    // `requested` 是 [{dataId, accessType?, condition?, hitCondition?}]；dataId 空的条目丢弃
    // （适配器认不出）。Reply result: {breakpoints:[{verified, id?, message?, dataId?, ...}]}。
    void set_data_breakpoints(const Json& requested, Reply on_reply);
    // DAP `setFunctionBreakpoints`（规范 "Set Function Breakpoints Request"）：按**函数名**停住 ——
    // IDEA 的 `JavaMethodBreakpointType`（方法断点）。能力位 `supportsFunctionBreakpoints`
    // （**规范默认 false**），未声明回 `DAP_UNSUPPORTED`。
    // `requested` 是 [{name, condition?, hitCondition?}]；name 空的条目丢弃。
    // Reply result: {breakpoints:[{verified, id?, line?, message?, name?}]}。
    void set_function_breakpoints(const Json& requested, Reply on_reply);
    // DAP `source`（规范 "Source Request"，能力位 `supportsSourceRequest`）：按
    // `sourceReference` 取源内容 —— 适配器动态生成的源（没有真实文件路径）只能这样取，
    // 是 `file.read` 在调试侧的等价物。能力位未声明回 `DAP_UNSUPPORTED`。
    // Reply result: {available, content?, mimeType?}。
    void source(long source_reference, const std::string& path, Reply on_reply);
    // DAP `setVariable`（规范 "Set Variable Request"）：改一个变量的值。
    void set_variable(long variables_reference, const std::string& name, const std::string& value, Reply on_reply);
    // DAP `setExpression`（规范 "Set Expression Request"）：给一个表达式赋值 —— IDEA 的
    // Watches 视图里「Set Value」走的就是它；`frame_id` 可选（0 = 不传）。
    void set_expression(const std::string& expression, const std::string& value, long frame_id, Reply on_reply);
    // DAP `exceptionInfo`（规范 "Exception Info Request"）：异常断点命中时问适配器"停在什么
    // 异常上"。IDEA 的对应物是 `JavaStackFrame.createExceptionNodes`
    // （`java/debugger/impl/src/com/intellij/debugger/engine/JavaStackFrame.java:319-331`）：
    // 异常停住时把抛出的异常对象作为一个变量节点插进 Variables 树，**且只在最顶层帧**
    // （`myDescriptor.getUiIndex() != 0` 时直接返回空列表）。那半条规则属于 UI 的展示逻辑，
    // 不在这里 —— 原生只负责把适配器的回答整形。
    // 规范**没有**对应的能力位（适配器不会声明 supportsExceptionInfo），所以不做能力门控：
    // 由调用方在 `stopped` 的 `reason` 是 `exception` 时发。
    // Reply result: {available, exceptionId, description, breakMode, details?}，
    // `details` = {message?, typeName?, fullTypeName?, evaluateName?, stackTrace?, innerException?[]}，
    // `innerException` 按 cause 链递归。
    void exception_details(long thread_id, Reply on_reply);
    // Ends the session: asks the adapter to disconnect and then waits for its
    // reader thread to actually exit, so a caller that drops the Client right
    // afterwards can never race a callback still running.
    // `terminate_debuggee` 是 DAP `disconnect` 的那个字段：true = 连被调试进程一起结束
    // （IDEA 的「停止」），false = 只断开、让目标进程继续跑（IDEA 的「断开」，远程附加常用的那条）。
    void disconnect(bool terminate_debuggee, Reply on_reply);

    // 适配器在 `initialize` 响应里声明的能力（只读快照，UI 线程可安全读取）。
    Json capabilities() const;
    // `supportsTerminateRequest` / `supportsRestartRequest`：决定 terminate/restart 走哪条路。
    bool supports_terminate() const;
    bool supports_restart() const;
    // `supportsGotoTargetsRequest` / `supportsRestartFrame`：Run to Cursor 与「丢弃帧」的可用性。
    bool supports_goto_targets() const;
    bool supports_restart_frame() const;
    // `supportsBreakpointLocationsRequest`（**默认 false**）：能否问"这一行哪些列可以放断点"。
    bool supports_breakpoint_locations() const;
    // `supportsCompletionsRequest`（**默认 false**）：调试表达式补全的可用性。
    bool supports_completions() const;
    // 按需重取清单的可用性：`supportsLoadedSourcesRequest` / `supportsModulesRequest`。
    bool supports_loaded_sources() const;
    bool supports_modules() const;
    // `supportsStepBack`（**默认 false**）：反向调试（stepBack / reverseContinue）的可用性。
    bool supports_step_back() const;
    // `supportsReadMemoryRequest` / `supportsDisassembleRequest`（**默认 false**）。
    bool supports_read_memory() const;
    bool supports_disassemble() const;
    // `supportsDataBreakpoints` / `supportsFunctionBreakpoints` / `supportsSourceRequest`
    // （**三个都默认 false**）：数据断点 / 方法（函数）断点 / 按 sourceReference 取源内容。
    bool supports_data_breakpoints() const;
    bool supports_function_breakpoints() const;
    bool supports_source() const;
    // DAP `terminate`（IDEA 的「停止」）：适配器支持就发规范请求，否则退化成
    // `disconnect{terminateDebuggee: true}` —— 两条路都是"把目标进程结束掉"。
    // 无论哪条路，调用方仍应在回调里 `shutdown()` 收摊。
    void terminate(Reply on_reply);
    // DAP `restart`（IDEA 的「重新运行」，Ctrl+F5）：**只有**适配器声明 `supportsRestartRequest`
    // 才发；否则回 DAP_UNSUPPORTED，调用方据此退化成"停止 + 重新启动"。
    void restart(Json arguments, Reply on_reply);

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
