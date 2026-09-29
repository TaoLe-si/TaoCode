// ---------------------------------------------------------------------------
// A tiny, deterministic Debug Adapter used only by dap_test to exercise the real
// subprocess spawn, the Content-Length framing and the request_seq correlation of
// native/dap.cpp. It is never shipped with the IDE and it deliberately carries its
// OWN framing implementation: two independent encoders agreeing over a pipe is the
// strongest check the base protocol has.
//
// Scripted behaviour (DAP commands): initialize -> capabilities; launch -> an
// `output` then a `stopped`(reason "entry") event; setBreakpoints -> every
// breakpoint verified plus one `breakpoint` event each; configurationDone;
// stackTrace -> two canned frames whose source.path echoes the last breakpoint
// source; scopes; variables; continue/next -> a single `stopped`(reason "pause")
// and then `terminated`; disconnect -> reply and exit. Anything else answers
// success:false so a client bug surfaces instead of hanging.
// ---------------------------------------------------------------------------

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>
#include <string_view>
#include <vector>

using Json = nlohmann::json;

namespace {

constexpr std::size_t max_body_bytes = 32 * 1024 * 1024;

bool header_equals(std::string_view left, std::string_view right) {
    if (left.size() != right.size()) return false;
    for (std::size_t i = 0; i != left.size(); ++i) {
        char a = left[i], b = right[i];
        if (a >= 'A' && a <= 'Z') a = static_cast<char>(a - 'A' + 'a');
        if (b >= 'A' && b <= 'Z') b = static_cast<char>(b - 'A' + 'a');
        if (a != b) return false;
    }
    return true;
}

std::string_view trim_view(std::string_view value) {
    while (!value.empty() && (value.front() == ' ' || value.front() == '\t')) value.remove_prefix(1);
    while (!value.empty() && (value.back() == ' ' || value.back() == '\t')) value.remove_suffix(1);
    return value;
}

// Parses `Content-Length: N\r\n\r\n<body>` out of a growing byte buffer.
class FrameReader {
public:
    void push(std::string_view bytes) { buffer_.append(bytes); }

    std::optional<Json> pop() {
        const auto separator = buffer_.find("\r\n\r\n");
        if (separator == std::string::npos) return std::nullopt;
        std::size_t length = 0;
        bool found = false;
        std::string_view headers{buffer_.data(), separator};
        std::size_t start = 0;
        for (;;) {
            const auto newline = headers.find("\r\n", start);
            const auto end = newline == std::string_view::npos ? headers.size() : newline;
            const auto line = headers.substr(start, end - start);
            if (!line.empty()) {
                const auto colon = line.find(':');
                if (colon != std::string_view::npos && header_equals(trim_view(line.substr(0, colon)), "content-length")) {
                    const auto digits = trim_view(line.substr(colon + 1));
                    length = 0;
                    found = !digits.empty();
                    for (const char ch : digits) {
                        if (ch < '0' || ch > '9') { found = false; break; }
                        length = length * 10 + static_cast<std::size_t>(ch - '0');
                    }
                }
            }
            if (newline == std::string_view::npos) break;
            start = newline + 2;
        }
        if (!found || length == 0 || length > max_body_bytes) {
            buffer_.clear();  // cannot trust the stream any more
            return std::nullopt;
        }
        const std::size_t body_start = separator + 4;
        if (buffer_.size() < body_start + length) return std::nullopt;
        const std::string body = buffer_.substr(body_start, length);
        buffer_.erase(0, body_start + length);
        try {
            Json message = Json::parse(body);
            if (!message.is_object()) return std::nullopt;
            return message;
        } catch (const Json::exception&) {
            return std::nullopt;
        }
    }

private:
    std::string buffer_;
};

std::string encode(const Json& message) {
    const std::string body = message.dump();
    return "Content-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
}

void write_all(HANDLE handle, std::string_view data) {
    const char* cursor = data.data();
    std::size_t remaining = data.size();
    while (remaining) {
        const auto chunk = static_cast<DWORD>(remaining > (std::size_t{1} << 20) ? std::size_t{1} << 20 : remaining);
        DWORD written = 0;
        if (!WriteFile(handle, cursor, chunk, &written, nullptr) || !written) return;
        cursor += written;
        remaining -= written;
    }
}

std::string text(const Json& object, const char* key) {
    if (object.is_object() && object.contains(key) && object.at(key).is_string()) return object.at(key).get<std::string>();
    return {};
}

std::string narrow(const std::wstring& value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string out(static_cast<std::size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
    return out;
}

// file:/// URI of the directory the client made the adapter's cwd, so an event
// can carry a path that really is inside the workspace.
std::string workspace_uri() {
    std::wstring directory(32768, L'\0');
    const auto length = GetCurrentDirectoryW(static_cast<DWORD>(directory.size()), directory.data());
    if (!length) return "file:///";
    directory.resize(length);
    auto path = narrow(directory);
    for (auto& character : path)
        if (character == '\\') character = '/';
    return "file:///" + path;
}

std::int64_t number(const Json& object, const char* key, std::int64_t fallback) {
    if (object.is_object() && object.contains(key) && object.at(key).is_number_integer()) return object.at(key).get<std::int64_t>();
    return fallback;
}

}  // namespace

// One test switch: --extras makes the launch also emit the events the client has
// to reshape for the UI (exited / module / loadedSource / progress*). The two
// reverse requests are asked for through markers in the *launch configuration*
// instead, because a nested session is started with this same command line and
// must not ask for another one.
int main(int argc, char** argv) {
    const std::vector<std::string> switches(argv + 1, argv + argc);
    const bool extras = std::find(switches.begin(), switches.end(), std::string("--extras")) != switches.end();
    // 用来验证客户端的**能力回退**：不支持 terminate 的适配器要走 disconnect{terminateDebuggee:true}，
    // 不支持 restart 的适配器要收到 DAP_UNSUPPORTED 而不是一个它答不上来的请求。
    const bool no_terminate = std::find(switches.begin(), switches.end(), std::string("--no-terminate")) != switches.end();
    const bool no_restart = std::find(switches.begin(), switches.end(), std::string("--no-restart")) != switches.end();
    // Run to Cursor / 丢弃帧的能力开关（验证客户端的门控）。
    const bool no_goto = std::find(switches.begin(), switches.end(), std::string("--no-goto")) != switches.end();
    // 关掉 supportsCompletionsRequest（规范默认 false）：客户端必须本地拒绝调试表达式补全。
    const bool no_completions =
        std::find(switches.begin(), switches.end(), std::string("--no-completions")) != switches.end();
    // 回一个「什么都没有」的 exceptionInfo 响应（description/exceptionId 都空）：
    // 客户端应当回 available:false，而不是给 UI 一张空卡片。
    const bool bare_exception_info =
        std::find(switches.begin(), switches.end(), std::string("--bare-exception-info")) != switches.end();
    // `stopped` 的 reason 用 exception（而不是 pause）：验证客户端只在异常停住时才问 exceptionInfo。
    const bool stop_on_exception =
        std::find(switches.begin(), switches.end(), std::string("--stop-on-exception")) != switches.end();
    // 关掉 supportsBreakpointLocationsRequest：客户端必须回 DAP_UNSUPPORTED，而不是发请求。
    const bool no_breakpoint_locations =
        std::find(switches.begin(), switches.end(), std::string("--no-breakpoint-locations")) != switches.end();
    HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
    HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);

    std::int64_t outgoing_seq = 1;
    const auto send = [&](const Json& message) { write_all(output, encode(message)); };
    const auto respond = [&](std::int64_t request_seq, const std::string& command, Json body) {
        send(Json{{"seq", outgoing_seq++},
                  {"type", "response"},
                  {"request_seq", request_seq},
                  {"command", command},
                  {"success", true},
                  {"body", body.is_null() ? Json::object() : std::move(body)}});
    };
    const auto refuse = [&](std::int64_t request_seq, const std::string& command, std::string message) {
        send(Json{{"seq", outgoing_seq++},
                  {"type", "response"},
                  {"request_seq", request_seq},
                  {"command", command},
                  {"success", false},
                  {"message", std::move(message)}});
    };
    const auto event = [&](const std::string& name, Json body) {
        send(Json{{"seq", outgoing_seq++}, {"type", "event"}, {"event", name}, {"body", body.is_null() ? Json::object() : std::move(body)}});
    };

    std::string breakpoint_source;  // source.path echoed back in stack frames
    std::vector<std::int64_t> breakpoint_lines;
    std::vector<std::string> exception_filters;  // last setExceptionBreakpoints body
    int control_steps = 0;
    // `variables` with reference 555 is answered only after the *next* request has
    // been, so the client sees responses out of order and must correlate strictly
    // by request_seq.
    std::vector<Json> held_replies;
    const auto flush_held = [&]() {
        for (const auto& reply : held_replies) send(reply);
        held_replies.clear();
    };

    FrameReader reader;
    std::vector<char> buffer(8192);
    for (;;) {
        DWORD got = 0;
        // Blocking read: the client closes stdin when it tears the session down,
        // which shows up here as a failed/empty read and exits the adapter.
        if (!ReadFile(input, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr) || got == 0) return 0;
        reader.push({buffer.data(), got});
        for (;;) {
            const auto inbound = reader.pop();
            if (!inbound) break;
            const Json& message = *inbound;
            const auto type = text(message, "type");
            if (type == "response") {
                // The answer to one of our own reverse requests. It is echoed as
                // console output so the client test can assert the host really
                // answered (and that runInTerminal carries a real process id).
                const auto answered = text(message, "command");
                const bool ok = message.contains("success") && message.at("success").is_boolean()
                                    ? message.at("success").get<bool>() : false;
                std::string detail;
                if (message.contains("body") && message.at("body").is_object()) {
                    const Json& body = message.at("body");
                    if (body.contains("shellProcessId")) detail = " shellProcessId=" + std::to_string(number(body, "shellProcessId", 0));
                    else if (body.contains("processId")) detail = " processId=" + std::to_string(number(body, "processId", 0));
                    else detail = " body=" + body.dump();
                }
                event("output", Json{{"category", "console"},
                                     {"output", "fake-adapter: " + answered + " answered success=" + (ok ? "true" : "false") + detail}});
                continue;
            }
            if (type != "request") continue;  // client events (`initialized`) are not answered
            const auto command = text(message, "command");
            const auto seq = number(message, "seq", 0);
            Json arguments = message.contains("arguments") && message.at("arguments").is_object() ? message.at("arguments")
                                                                                                    : Json::object();

            if (command == "initialize") {
                respond(seq, command, Json{{"supportsConfigurationDoneRequest", true},
                                           {"supportsTerminateRequest", !no_terminate},
                                           {"supportsRestartRequest", !no_restart},
                                           {"supportsGotoTargetsRequest", !no_goto},
                                           {"supportsRestartFrame", !no_goto},
                                           // 规范里 supportsBreakpointLocationsRequest 默认 false，
                                           // 所以默认声明为真，另有开关把它关掉测降级。
                                           {"supportsBreakpointLocationsRequest", !no_breakpoint_locations},
                                           {"supportsConditionalBreakpoints", false},
                                           {"supportsVariableType", true},
                                           {"supportsEvaluateForHovers", false},
                                           // 这个假适配器实现了 setVariable/setExpression，能力位要如实声明。
                                           {"supportsSetVariable", true},
                                           {"supportsCompletionsRequest", !no_completions},
                                           {"exceptionBreakpointFilters", Json::array({
                                               Json{{"filter", "all"}, {"label", "All Exceptions"}},
                                               Json{{"filter", "uncaught"}, {"label", "Uncaught Exceptions"}},
                                           })}});
            } else if (command == "attach") {
                // Same scripted flow as launch, echoing the selector it received.
                respond(seq, command, Json::object());
                std::string target = "unknown";
                if (arguments.contains("processId")) target = arguments.at("processId").dump();
                else if (arguments.contains("pipeName")) target = text(arguments, "pipeName");
                event("output", Json{{"category", "console"}, {"output", "fake-adapter: attaching to " + target}});
                event("stopped", Json{{"reason", "entry"}, {"threadId", 1}, {"allThreadsStopped", true}, {"description", "attached"}});
            } else if (command == "setExceptionBreakpoints") {
                exception_filters.clear();
                if (arguments.contains("filters") && arguments.at("filters").is_array())
                    for (const auto& filter : arguments.at("filters"))
                        if (filter.is_string()) exception_filters.push_back(filter.get<std::string>());
                respond(seq, command, Json::object());
            } else if (command == "launch") {
                respond(seq, command, Json::object());
                event("output", Json{{"category", "console"},
                                      {"output", "fake-adapter: launching " + text(arguments, "program") + " (" + text(arguments, "type") + ")"}});
                event("output", Json{{"category", "stderr"}, {"output", "fake-adapter: warning, this adapter is scripted\n"}});
                if (extras) {
                    // The event shapes the client has to reshape for the UI: a real
                    // exit code, a loaded module, a loaded source and one progress
                    // sequence (start -> update -> end).
                    const auto base = workspace_uri();
                    event("module", Json{{"reason", "new"},
                                         {"module", Json{{"id", 7}, {"name", "fake.dll"}, {"path", base + "/fake.dll"}}}});
                    event("loadedSource", Json{{"reason", "new"},
                                               {"source", Json{{"name", "main.cpp"}, {"path", base + "/dap/main.cpp"}}}});
                    event("progressStart", Json{{"progressId", "load"}, {"title", "Loading"}, {"message", "reading symbols"}, {"percentage", 0}});
                    event("progressUpdate", Json{{"progressId", "load"}, {"message", "halfway"}, {"percentage", 50}});
                    event("progressEnd", Json{{"progressId", "load"}, {"message", "done"}});
                    event("exited", Json{{"exitCode", 3}});
                }
                if (arguments.contains("__reverseTerminal")) {
                    // A reverse request: the host must really run something and hand
                    // back a process id. What it answers is echoed as an `output`
                    // event, so the client test can assert on the real pid.
                    send(Json{{"seq", outgoing_seq++},
                              {"type", "request"},
                              {"command", "runInTerminal"},
                              {"arguments", Json{{"kind", "integrated"},
                                                 {"cwd", "."},
                                                 {"args", Json::array({"cmd", "/c", "exit 0"})}}}});
                }
                if (arguments.contains("__reverseNested")) {
                    // A reverse request for a second session. The nested
                    // configuration carries no marker, so the child adapter will not
                    // ask for another one.
                    send(Json{{"seq", outgoing_seq++},
                              {"type", "request"},
                              {"command", "startDebugging"},
                              {"arguments", Json{{"request", "launch"},
                                                 {"configuration", Json{{"program", "dap/nested.cpp"}}}}}});
                }
                event("stopped", Json{{"reason", "entry"}, {"threadId", 1}, {"allThreadsStopped", true}, {"description", "stopped at entry"}});
            } else if (command == "setBreakpoints") {
                const Json& source = arguments.contains("source") && arguments.at("source").is_object() ? arguments.at("source") : Json::object();
                breakpoint_source = text(source, "path");
                breakpoint_lines.clear();
                Json points = Json::array();
                if (arguments.contains("breakpoints") && arguments.at("breakpoints").is_array())
                    for (const auto& point : arguments.at("breakpoints")) {
                        const auto line = number(point, "line", 0);
                        breakpoint_lines.push_back(line);
                        Json entry{{"verified", true}, {"line", line}, {"column", 1}};
                        // Echo the condition back so the client test can prove it reached
                        // the adapter rather than being remembered locally only.
                        const auto condition = text(point, "condition");
                        if (!condition.empty()) entry["message"] = "cond:" + condition;
                        points.push_back(std::move(entry));
                    }
                respond(seq, command, Json{{"breakpoints", points}});
                for (const auto line : breakpoint_lines)
                    // DAP's optional Breakpoint id: an adapter uses it to name the
                    // one breakpoint an event is about.
                    event("breakpoint", Json{{"reason", "changed"},
                                             {"breakpoint", Json{{"id", line * 10 + 1},
                                                                 {"verified", true},
                                                                 {"line", line},
                                                                 {"path", breakpoint_source}}}});
            } else if (command == "configurationDone") {
                respond(seq, command, Json::object());
            } else if (command == "stackTrace") {
                const auto path = breakpoint_source.empty() ? std::string("file:///C:/TaoCode/unknown.cpp") : breakpoint_source;
                const auto line = breakpoint_lines.empty() ? std::int64_t(4) : breakpoint_lines.front();
                Json frames = Json::array();
                frames.push_back(Json{{"id", 1000},
                                      {"name", "fake_main"},
                                      {"line", line},
                                      {"column", 1},
                                      {"source", Json{{"name", "main.cpp"}, {"path", path}, {"sourceReference", 0}}}});
                frames.push_back(Json{{"id", 1001},
                                      {"name", "fake_entry"},
                                      {"line", 1},
                                      {"column", 1},
                                      {"source", Json{{"name", "entry.cpp"}, {"path", "file:///C:/Windows/entry.cpp"}, {"sourceReference", 0}}}});
                respond(seq, command, Json{{"stackFrames", frames}, {"totalFrames", 2}});
            } else if (command == "scopes") {
                Json local{{"name", "Local"}, {"variablesReference", 2000}, {"expensive", false}, {"namedVariables", 2}};
                Json statics{{"name", "Statics"}, {"variablesReference", 3000}, {"expensive", true}};
                respond(seq, command, Json{{"scopes", Json::array({local, statics})}});
            } else if (command == "evaluate") {
                // Echo the expression, context and frame so the client test can prove the
                // arguments were sent as-is (DAP body: {result, variablesReference, type}).
                const auto expression = arguments.value("expression", std::string());
                const auto context = arguments.value("context", std::string());
                const auto frame = number(arguments, "frameId", -1);
                respond(seq, command, Json{{"result", expression + " => 42 [" + context + "@" + std::to_string(frame) + "]"},
                                           {"variablesReference", 0}, {"type", "int"}});
            } else if (command == "variables") {
                const auto reference = number(arguments, "variablesReference", 0);
                Json values = Json::array();
                if (reference == 2000) {
                    values.push_back(Json{{"name", "counter"}, {"value", "7"}, {"type", "int"}, {"variablesReference", 0}, {"evaluateName", "counter"}});
                    values.push_back(Json{{"name", "message"}, {"value", "\"hello\""}, {"type", "const char *"}, {"variablesReference", 4000},
                                          {"evaluateName", "message"}, {"namedVariables", 1}});
                } else if (reference == 3000) {
                    values.push_back(Json{{"name", "argv"}, {"value", "0x00007ff6deadbeef"}, {"type", "char **"}, {"variablesReference", 0}});
                } else if (reference == 555) {
                    // Deliberately late: the response for THIS request is held until a
                    // later request has already been answered.
                    held_replies.push_back(Json{{"seq", outgoing_seq++},
                                                {"type", "response"},
                                                {"request_seq", seq},
                                                {"command", command},
                                                {"success", true},
                                                {"body", Json{{"variables", Json::array({Json{{"name", "held"}, {"value", "1"}, {"variablesReference", 0}}})}}}});
                    continue;
                } else {
                    values.push_back(Json{{"name", "child"}, {"value", "1"}, {"type", "int"}, {"variablesReference", 0}});
                }
                respond(seq, command, Json{{"variables", values}});
            } else if (command == "setVariable") {
                // Echo the container reference, name and new value so the client test can
                // prove all three were sent as-is (DAP "Set Variable Response" is one variable).
                const auto reference = number(arguments, "variablesReference", 0);
                const auto name = arguments.value("name", std::string());
                const auto value = arguments.value("value", std::string());
                respond(seq, command, Json{{"value", name + "=" + value + " @" + std::to_string(reference)},
                                           {"type", "int"}, {"variablesReference", 0}});
            } else if (command == "setExpression") {
                // `frameId` is optional in the spec, so the fake reports -1 when it is absent.
                const auto expression = arguments.value("expression", std::string());
                const auto value = arguments.value("value", std::string());
                const auto frame = number(arguments, "frameId", -1);
                respond(seq, command, Json{{"value", expression + " := " + value + " [" + std::to_string(frame) + "]"},
                                           {"type", "int"}, {"variablesReference", 0}, {"namedVariables", 0}});
            } else if (command == "exceptionInfo") {
                // 响应里没有 threadId 字段（规范没有），所以把收到的值回声成一条 output，
                // 客户端测试据此证明参数发出去了。
                event("output", Json{{"category", "console"},
                                     {"output", "fake-adapter: exceptionInfo threadId=" +
                                                    std::to_string(number(arguments, "threadId", 0))}});
                // 形状覆盖规范里的全部字段，含 `innerException` 的 cause 链（两层），
                // 客户端整形必须逐层落地 —— 少一层就是 UI 上看不到根因。
                if (bare_exception_info) {
                    respond(seq, command, Json{{"exceptionId", ""}, {"description", ""}, {"breakMode", "always"}});
                } else {
                    respond(seq, command, Json{{"exceptionId", "java.lang.IllegalStateException"},
                                               {"description", "IllegalStateException: boom"},
                                               {"breakMode", "always"},
                                               {"details", Json{{"message", "boom"},
                                                                {"typeName", "IllegalStateException"},
                                                                {"fullTypeName", "java.lang.IllegalStateException"},
                                                                {"evaluateName", "this.cause"},
                                                                {"stackTrace", "at Sample.run(Sample.java:3)"},
                                                                {"innerException", Json::array({Json{
                                                                    {"message", "disk full"},
                                                                    {"typeName", "IOException"},
                                                                    {"fullTypeName", "java.io.IOException"}}})}}}});
                }
            } else if (command == "completions") {
                // 三种形状都覆盖：带 start/length 的（可精确替换一段）、只有 label 的（整段替换）、
                // 以及一个**没有 label** 的项（客户端必须丢掉它 —— UI 里无法显示也选不中）。
                const auto text_value = arguments.value("text", std::string());
                const auto frame = number(arguments, "frameId", -1);
                event("output", Json{{"category", "console"},
                                     {"output", "fake-adapter: completions text=" + text_value +
                                                    " column=" + std::to_string(number(arguments, "column", -1)) +
                                                    " frameId=" + std::to_string(frame)}});
                respond(seq, command, Json{{"targets", Json::array({
                    Json{{"label", "counter"}, {"text", "counter"}, {"type", "variable"}, {"start", 0}, {"length", 7}},
                    Json{{"label", "countLocal"}, {"type", "field"}},
                    Json{{"type", "orphan"}}})}});
            } else if (command == "continue" || command == "next" || command == "stepIn" || command == "stepOut") {
                respond(seq, command, command == "continue" ? Json{{"allThreadsContinuation", true}} : Json::object());
                event("continued", Json{{"threadId", number(arguments, "threadId", 1)}, {"allThreadsContinued", true}});
                ++control_steps;
                if (control_steps == 1) {
                    // pause 事件的形状保持原样（不加 description 键），只有
                    // `--stop-on-exception` 时才多一个描述 —— 否则会悄悄改变既有用例的输入。
                    Json stopped{{"reason", stop_on_exception ? "exception" : "pause"},
                                 {"threadId", 1}, {"allThreadsStopped", true}};
                    if (stop_on_exception) stopped["description"] = "IllegalStateException: boom";
                    event("stopped", stopped);
                }
                else {
                    event("terminated", Json{{"restartable", false}});
                    return 0;  // the session is over; let the pipes close
                }
            } else if (command == "breakpointLocations") {
                // 把请求里的 line/endLine/column/endColumn 原样带回（客户端测试据此证明四个字段
                // 都发出去了），并且**行号是奇数就回空数组** —— 空数组是"这一行没有可放置位置"
                // （IDEA 的 "Cannot find appropriate breakpoint type"），必须与"请求失败"区分开。
                const Json source = arguments.contains("source") && arguments.at("source").is_object()
                                        ? arguments.at("source") : Json::object();
                const auto source_path = text(source, "path");
                event("output", Json{{"category", "console"},
                                     {"output", "fake-adapter: breakpointLocations " + source_path}});
                // 没有 source 就没法回答"哪个文件的这一行"。直接失败，而不是回一个空的位置列表
                // 让客户端误以为"这一行不能放断点"。
                if (source_path.empty()) {
                    refuse(seq, command, "breakpointLocations needs a source path");
                } else if (number(arguments, "line", 0) % 2 != 0) {
                    respond(seq, command, Json{{"breakpoints", Json::array()}});
                } else {
                    const auto line = number(arguments, "line", 0);
                    Json spots = Json::array();
                    Json first{{"line", line}};
                    if (arguments.contains("column")) first["column"] = number(arguments, "column", 0);
                    spots.push_back(std::move(first));
                    // 第二个位置带上 endLine/endColumn：可选的"范围"形式也要能整形出来。
                    Json span{{"line", line}};
                    if (arguments.contains("endLine")) span["endLine"] = number(arguments, "endLine", 0);
                    if (arguments.contains("endColumn")) span["endColumn"] = number(arguments, "endColumn", 0);
                    spots.push_back(std::move(span));
                    respond(seq, command, Json{{"breakpoints", std::move(spots)}});
                }
            } else if (command == "gotoTargets") {
                // 把请求里的行号原样带回（客户端测试据此证明行号与 source 路径都发出去了）。
                const auto line = number(arguments, "line", 0);
                const auto path = arguments.contains("source") && arguments.at("source").is_object()
                                      ? arguments.at("source").value("path", std::string()) : std::string();
                respond(seq, command, Json{{"targets", Json::array({Json{{"id", 7},
                                                                       {"label", "line " + std::to_string(line)},
                                                                       {"line", line},
                                                                       {"column", 1},
                                                                       {"endLine", line},
                                                                       {"path", path}}})}});
            } else if (command == "goto" || command == "restartFrame") {
                respond(seq, command, Json::object());
            } else if (command == "terminate" || command == "restart") {
                // 两条都是"收到就答"，客户端测试据此证明请求真的发出去了。
                respond(seq, command, Json::object());
            } else if (command == "pause") {
                respond(seq, command, Json::object());
            } else if (command == "threads") {
                Json first{{"id", 1}, {"name", "fake thread 1"}};
                Json second{{"id", 2}, {"name", "fake thread 2"}};
                respond(seq, command, Json{{"threads", Json::array({first, second})}});
            } else if (command == "disconnect") {
                respond(seq, command, Json::object());
                return 0;
            } else {
                refuse(seq, command, "fake-adapter: unsupported command '" + command + "'");
            }
            flush_held();  // any reply held back for the previous request goes last
        }
    }
}
