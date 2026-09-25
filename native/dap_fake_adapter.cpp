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

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
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

std::int64_t number(const Json& object, const char* key, std::int64_t fallback) {
    if (object.is_object() && object.contains(key) && object.at(key).is_number_integer()) return object.at(key).get<std::int64_t>();
    return fallback;
}

}  // namespace

int main() {
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
            if (type != "request") continue;  // client events (`initialized`) are not answered
            const auto command = text(message, "command");
            const auto seq = number(message, "seq", 0);
            Json arguments = message.contains("arguments") && message.at("arguments").is_object() ? message.at("arguments")
                                                                                                    : Json::object();

            if (command == "initialize") {
                respond(seq, command, Json{{"supportsConfigurationDoneRequest", true},
                                           {"supportsTerminateRequest", true},
                                           {"supportsConditionalBreakpoints", false},
                                           {"supportsVariableType", true},
                                           {"supportsEvaluateForHovers", false},
                                           {"supportsSetVariable", false},
                                           {"exceptionBreakpointFilters", Json::array()}});
            } else if (command == "launch") {
                respond(seq, command, Json::object());
                event("output", Json{{"category", "console"},
                                      {"output", "fake-adapter: launching " + text(arguments, "program") + " (" + text(arguments, "type") + ")"}});
                event("output", Json{{"category", "stderr"}, {"output", "fake-adapter: warning, this adapter is scripted\n"}});
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
                    event("breakpoint", Json{{"reason", "changed"},
                                             {"breakpoint", Json{{"verified", true}, {"line", line}, {"path", breakpoint_source}}}});
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
            } else if (command == "continue" || command == "next" || command == "stepIn" || command == "stepOut") {
                respond(seq, command, command == "continue" ? Json{{"allThreadsContinuation", true}} : Json::object());
                event("continued", Json{{"threadId", number(arguments, "threadId", 1)}, {"allThreadsContinued", true}});
                ++control_steps;
                if (control_steps == 1) event("stopped", Json{{"reason", "pause"}, {"threadId", 1}, {"allThreadsStopped", true}});
                else {
                    event("terminated", Json{{"restartable", false}});
                    return 0;  // the session is over; let the pipes close
                }
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
