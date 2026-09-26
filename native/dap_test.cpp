// ---------------------------------------------------------------------------
// Offline end-to-end test for the native DAP client. It launches
// dap_fake_adapter.exe (built next to this test) as a real child process over
// inherited stdio pipes, so it is the only test that exercises OS spawn, the
// Content-Length framing and the request_seq correlation of native/dap.cpp.
// Nothing here needs a real debugger installed, and nothing here touches the
// shared build directory or the network.
// ---------------------------------------------------------------------------

#include "dap.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <tlhelp32.h>

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <functional>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::WorkspaceError;
using taocode::dap::Client;
using taocode::dap::encode_message;
using taocode::dap::make_request;
using taocode::dap::MessageReader;

using Clock = std::chrono::steady_clock;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

fs::path self_directory() {
    std::wstring path(32768, L'\0');
    const auto length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    check(length && length < path.size(), "cannot locate the test executable");
    path.resize(length);
    return fs::path(path).parent_path();
}

std::string to_utf8(const std::wstring& value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
    return result;
}

std::wstring adapter_path() {
    auto executable = self_directory() / L"dap_fake_adapter.exe";
    check(fs::exists(executable), "fake adapter binary is missing: " + executable.string());
    return executable.native();
}

// How many dap_fake_adapter.exe processes are alive: a working Job-Object kill
// leaves zero, an orphaned debugger leaves one.
int live_adapters() {
    const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return -1;
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    int count = 0;
    if (Process32FirstW(snapshot, &entry)) {
        do {
            if (std::wstring_view(entry.szExeFile) == L"dap_fake_adapter.exe") ++count;
        } while (Process32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);
    return count;
}

// One-shot latch for a DAP reply (replies always arrive on the reader thread).
struct Waiter {
    std::mutex mutex;
    std::condition_variable cv;
    bool done = false;
    Json result, error;

    void finish(Json reply, Json failure) {
        std::lock_guard lock(mutex);
        result = std::move(reply);
        error = std::move(failure);
        done = true;
        cv.notify_all();
    }
    bool await_for(int seconds = 25) {
        std::unique_lock lock(mutex);
        return cv.wait_for(lock, std::chrono::seconds(seconds), [this] { return done; });
    }
    bool ok() const { return error.is_null(); }
    std::string failure_text() const {
        if (error.is_null()) return "none";
        return error.is_object() && error.contains("message") ? error.at("message").get<std::string>() : error.dump();
    }
    Client::Reply reply() { return [this](Json value, Json failure) { finish(std::move(value), std::move(failure)); }; }
};

// Collected DAP events, with a predicate-based wait because events are async.
struct Recorder {
    mutable std::mutex mutex;
    std::condition_variable cv;
    std::vector<Json> events;

    void push(Json event) {
        std::lock_guard lock(mutex);
        events.push_back(std::move(event));
        cv.notify_all();
    }
    bool wait_for(const std::function<bool(const Json&)>& predicate, int seconds, Json* found) {
        const auto deadline = Clock::now() + std::chrono::seconds(seconds);
        std::unique_lock lock(mutex);
        for (;;) {
            for (const auto& event : events)
                if (predicate(event)) {
                    if (found) *found = event;
                    return true;
                }
            const auto left = deadline - Clock::now();
            if (left <= std::chrono::milliseconds::zero()) return false;
            cv.wait_for(lock, left);
        }
    }
    int count(const std::function<bool(const Json&)>& predicate) const {
        std::lock_guard lock(mutex);
        int total = 0;
        for (const auto& event : events)
            if (predicate(event)) ++total;
        return total;
    }
};

bool is_event(const Json& event, const std::string& name) {
    return event.is_object() && event.contains("event") && event.at("event").is_string() &&
           event.at("event").get<std::string>() == name;
}

void expect_event(Recorder& recorder, const std::function<bool(const Json&)>& predicate, const std::string& what, Json* found) {
    check(recorder.wait_for(predicate, 25, found), "timed out waiting for " + what);
}

std::string string_at(const Json& object, const char* key) {
    check(object.is_object() && object.contains(key) && object.at(key).is_string(),
          std::string("missing string field ") + key + " in " + object.dump());
    return object.at(key).get<std::string>();
}

std::int64_t number_at(const Json& object, const char* key) {
    check(object.is_object() && object.contains(key) && object.at(key).is_number_integer(),
          std::string("missing integer field ") + key + " in " + object.dump());
    return object.at(key).get<std::int64_t>();
}

bool flag_at(const Json& object, const char* key) {
    check(object.is_object() && object.contains(key) && object.at(key).is_boolean(),
          std::string("missing boolean field ") + key + " in " + object.dump());
    return object.at(key).get<bool>();
}

fs::path workspace_root() {
    const auto root = self_directory() / L"dap-workspace";
    std::error_code ignored;
    fs::create_directories(root, ignored);  // the adapter inherits this as its cwd
    return root;
}

// ---------------------------------------------------------------- scenarios ---

// Drives the documented bridge contract against the scripted adapter, in the exact
// order the main agent UI will use.
void scenario_full_session() {
    const auto root = workspace_root();
    Recorder recorder;
    Client client;
    client.set_root(root);

    // (0) Breakpoints set before a session exists are remembered, not lost.
    Waiter deferred;
    client.set_breakpoints("dap/main.cpp", Json::array({Json{{"line", 5}}, Json{{"line", 7}}}), deferred.reply());
    check(deferred.await_for(), "setBreakpoints before start never replied");
    check(deferred.ok(), "setBreakpoints before start failed: " + deferred.failure_text());
    check(flag_at(deferred.result, "deferred"), "an offline setBreakpoints must report deferred=true");
    check(deferred.result.at("verifiedLines").empty(), "nothing can be verified while offline");

    client.start(adapter_path(), {}, root, [&recorder](Json event) { recorder.push(std::move(event)); });
    check(client.running(), "adapter should be running right after start");

    // (1) initialize -> launch -> setBreakpoints -> configurationDone.
    Waiter started;
    client.start_debugging("fake-adapter", Json{{"kind", "fake-adapter"},
                                                {"program", "dap/main.cpp"},
                                                {"cwd", "."},
                                                {"stopOnEntry", true},
                                                {"env", Json::array({"FAKE=1"})}},
                           started.reply());
    check(started.await_for(), "dap.start sequence never replied");
    check(started.ok(), "dap.start sequence failed: " + started.failure_text());
    check(flag_at(started.result, "ok") == true, "dap.start must report ok:true");
    check(started.result.contains("capabilities") && started.result.at("capabilities").contains("supportsConfigurationDoneRequest"),
          "adapter capabilities must be forwarded");
    const auto& reports = started.result.at("breakpoints");
    check(reports.is_array() && reports.size() == 1, "the remembered breakpoint file must be re-applied during start");
    const auto applied = reports[0].at("verifiedLines");
    check(applied.size() == 2 && applied[0].get<int>() == 5 && applied[1].get<int>() == 7,
          "start must report the verified lines: " + reports[0].dump());
    check(string_at(reports[0], "path") == "dap/main.cpp", "the breakpoint report must carry the relative path");

    // (3) Events: output (the DAP output field maps to text) and the entry
    // stopped event carrying the thread id every later request needs.
    Json output;
    expect_event(recorder, [](const Json& e) { return is_event(e, "output") && e.contains("text"); }, "output event", &output);
    check(string_at(output, "category") == "console", "output events carry their category");
    check(output.at("text").get<std::string>().find("dap/main.cpp") != std::string::npos,
          "launch arguments must reach the adapter: " + output.at("text").get<std::string>());
    Json entry;
    expect_event(recorder, [](const Json& e) { return is_event(e, "stopped"); }, "stopped event", &entry);
    check(string_at(entry, "reason") == "entry", "the scripted adapter stops with reason=entry");
    const auto thread_id = number_at(entry, "threadId");
    check(thread_id == 1, "stopped must expose threadId for the follow-up requests");
    check(!entry.contains("description"), "unrequested body fields must not leak into the contract");

    // (2) A live setBreakpoints answer carries the verified 1-based lines.
    Waiter installed;
    client.set_breakpoints("dap/main.cpp", Json::array({Json{{"line", 5}}, Json{{"line", 7}}, Json{{"line", 9}}}), installed.reply());
    check(installed.await_for(), "no setBreakpoints response");
    check(installed.ok(), "setBreakpoints failed: " + installed.failure_text());
    const auto& verified = installed.result.at("verifiedLines");
    check(verified.is_array() && verified.size() == 3 && verified[2].get<int>() == 9,
          "verifiedLines must list the verified 1-based lines: " + installed.result.dump());
    check(string_at(installed.result, "path") == "dap/main.cpp", "the reply echoes the relative path");
    Json breakpoint_event;
    expect_event(recorder,
                 [](const Json& e) { return is_event(e, "breakpoint") && e.contains("line") && e.at("line").get<int>() == 9; },
                 "breakpoint event for line 9", &breakpoint_event);
    check(flag_at(breakpoint_event, "verified"), "the scripted adapter verifies breakpoints");
    check(string_at(breakpoint_event, "path") == "dap/main.cpp", "breakpoint events map source.path back to a relative path");
    // DAP's optional Breakpoint id is forwarded, so the UI can tell which breakpoint
    // an adapter moved instead of guessing from the line number.
    check(number_at(breakpoint_event, "id") == 91, "breakpoint events carry the adapter's breakpoint id, got: " + breakpoint_event.dump());

    // (4) Stack frames keep the 1-based DAP line/column, and source.path becomes a
    // workspace-relative path (paths outside the root stay absolute).
    Waiter stack;
    client.stack_trace(static_cast<long>(thread_id), stack.reply());
    check(stack.await_for(), "no stackTrace response");
    check(stack.ok(), "stackTrace failed: " + stack.failure_text());
    const auto& frames = stack.result.at("frames");
    check(frames.is_array() && frames.size() >= 1, "stackTrace must return at least one frame");
    check(number_at(frames[0], "id") == 1000, "frame id preserved");
    check(string_at(frames[0], "name") == "fake_main", "frame name preserved");
    check(number_at(frames[0], "line") == 5 && number_at(frames[0], "column") == 1, "frame line/column stay 1-based (DAP)");
    check(string_at(frames[0], "path") == "dap/main.cpp", "frame path must be workspace-relative");
    check(string_at(frames[1], "path") == "C:/Windows/entry.cpp", "paths outside the workspace pass through normalised");
    check(number_at(stack.result, "totalFrames") >= 2, "totalFrames reported");

    // Scopes and variables.
    Waiter scope;
    client.scopes(static_cast<long>(number_at(frames[0], "id")), scope.reply());
    check(scope.await_for(), "no scopes response");
    check(scope.ok(), "scopes failed: " + scope.failure_text());
    const auto& scopes = scope.result.at("scopes");
    check(scopes.size() == 2, "two scripted scopes");
    check(string_at(scopes[0], "name") == "Local", "scope name");
    const auto local_reference = number_at(scopes[0], "reference");
    check(local_reference == number_at(scopes[0], "variablesReference"), "reference and variablesReference must agree");
    check(flag_at(scopes[1], "expensive"), "the expensive flag survives");

    Waiter vars;
    client.variables(static_cast<long>(local_reference), vars.reply());
    check(vars.await_for(), "no variables response");
    check(vars.ok(), "variables failed: " + vars.failure_text());
    const auto& variables = vars.result.at("variables");
    check(variables.size() == 2, "two scripted locals");
    check(string_at(variables[0], "name") == "counter" && string_at(variables[0], "value") == "7", "variable name/value survive");
    check(string_at(variables[0], "type") == "int", "variable type survives");
    check(number_at(variables[0], "reference") == 0, "a scalar has no child reference");
    check(flag_at(variables[1], "named") && number_at(variables[1], "reference") == 4000,
          "an expandable variable reports its child reference");

    // `evaluate` through the generic request escape hatch: the arguments must reach
    // the adapter verbatim, and the raw body comes back untouched.
    Waiter evaluated;
    client.request("evaluate", Json{{"expression", "counter + 1"}, {"context", "hover"}, {"frameId", number_at(frames[0], "id")}},
                   evaluated.reply());
    check(evaluated.await_for(), "no evaluate response");
    check(evaluated.ok(), "evaluate failed: " + evaluated.failure_text());
    check(string_at(evaluated.result, "result") == "counter + 1 => 42 [hover@1000]",
          "expression, context and frameId round-tripped, got: " + string_at(evaluated.result, "result"));
    check(string_at(evaluated.result, "type") == "int" && number_at(evaluated.result, "variablesReference") == 0,
          "the adapter body survives untouched");

    Waiter children;
    client.variables(4000, children.reply());
    check(children.await_for(), "no nested variables response");
    check(children.result.at("variables").size() == 1 && string_at(children.result.at("variables")[0], "name") == "child",
          "nested variables resolve");

    // Execution control: the reply answers immediately, the state change is an event.
    Waiter resumed;
    client.continue_execution(static_cast<long>(thread_id), false, resumed.reply());
    check(resumed.await_for(), "no continue response");
    check(resumed.ok() && flag_at(resumed.result, "ok"), "continue must answer ok:true: " + resumed.failure_text());
    Json pause_event;
    expect_event(recorder,
                 [](const Json& e) { return is_event(e, "stopped") && e.contains("reason") && e.at("reason").get<std::string>() == "pause"; },
                 "stopped(reason=pause) after continue", &pause_event);
    check(number_at(pause_event, "threadId") == 1, "the second stop still names its thread");
    Json continued;
    expect_event(recorder, [](const Json& e) { return is_event(e, "continued"); }, "continued event (raw body passthrough)", &continued);
    check(continued.at("body").contains("allThreadsContinued"), "unknown events forward their raw body");

    // The scripted adapter terminates the session on the second step command.
    Waiter stepped;
    client.next(static_cast<long>(thread_id), stepped.reply());
    check(stepped.await_for(), "no next response");
    Json terminated;
    expect_event(recorder, [](const Json& e) { return is_event(e, "terminated"); }, "terminated event", &terminated);
    check(flag_at(terminated, "restartable") == false, "restartable flag survives");
    check(!client.debuggee_alive(), "the debuggee is gone after a terminated event");

    // (6a) The adapter exits by itself: the reader notices, so no waiter hangs and
    // the close marker is not duplicated behind a real terminated event.
    for (int attempt = 0; attempt < 250 && !client.exited(); ++attempt) std::this_thread::sleep_for(std::chrono::milliseconds(20));
    check(client.exited(), "the client must notice the adapter process exiting");
    check(!client.running(), "running() must be false once the adapter is gone");
    check(client.exit_code() == 0, "a clean adapter exit records code 0, got " + std::to_string(client.exit_code()));
    check(recorder.count([](const Json& e) { return is_event(e, "terminated"); }) == 1,
          "a real terminated event must not be followed by a synthetic one");
}

// (6b) shutdown() must reap the debugger through the Job Object, commands issued
// afterwards must fail fast, and the same client must be reusable for a restart.
void scenario_shutdown_reaps_the_adapter() {
    const auto root = workspace_root();
    Recorder recorder;
    Client client;
    client.set_root(root);
    client.start(adapter_path(), {L"--stdio"}, root, [&recorder](Json event) { recorder.push(std::move(event)); });

    Waiter started;
    client.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"}, {"cwd", "."}}, started.reply());
    check(started.await_for(), "dap.start never replied");
    check(started.ok(), "dap.start failed: " + started.failure_text());

    Waiter installed;
    client.set_breakpoints("dap/main.cpp", Json::array({Json{{"line", 42}}}), installed.reply());
    check(installed.await_for() && installed.ok(), "live setBreakpoints failed: " + installed.failure_text());
    check(installed.result.at("verifiedLines").size() == 1 && installed.result.at("verifiedLines")[0].get<int>() == 42,
          "the scripted adapter verifies line 42");

    client.shutdown();
    check(!client.running(), "the session must not be running after shutdown");
    check(client.exited(), "shutdown must join the reader thread and reap the adapter");
    check(client.exit_code() >= 0, "an exit code must be recorded once the adapter is reaped");
    Json closed;
    expect_event(recorder,
                 [](const Json& e) { return is_event(e, "terminated") && e.contains("connectionClosed"); },
                 "a synthetic terminated marker after shutdown", &closed);
    check(flag_at(closed, "connectionClosed"), "the close marker is tagged so the UI can tell it apart");

    bool answered = false, rejected = false;
    Waiter after;
    client.stack_trace(1, [&answered, &rejected, &after](Json, Json error) {
        answered = !after.done;
        rejected = !error.is_null() && error.contains("code") && error.at("code").get<std::string>() == "DAP_NOT_RUNNING";
        after.finish(Json(nullptr), std::move(error));
    });
    check(after.await_for(5), "a command on a stopped session must answer, not hang");
    check(answered && rejected, "a command on a stopped session must be rejected with DAP_NOT_RUNNING");

    client.shutdown();  // teardown runs on WM_CLOSE and in the destructor: both must be idempotent
    check(!client.running(), "double shutdown must stay stopped");

    for (int attempt = 0; attempt < 100 && live_adapters() != 0; ++attempt) std::this_thread::sleep_for(std::chrono::milliseconds(50));
    check(live_adapters() == 0, "no dap_fake_adapter.exe may survive shutdown: the job kill must reap the tree");

    // Restart with the same client object: the remembered breakpoints come back.
    client.start(adapter_path(), {}, root, [&recorder](Json event) { recorder.push(std::move(event)); });
    check(client.running(), "the client must be reusable after a restart");
    Waiter again;
    client.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"}}, again.reply());
    check(again.await_for(), "a restarted session never finished");
    check(again.ok(), "restart failed: " + again.failure_text());
    const auto& reports = again.result.at("breakpoints");
    check(reports.is_array() && reports.size() == 1 && reports[0].at("verifiedLines").size() == 1 &&
              reports[0].at("verifiedLines")[0].get<int>() == 42,
          "the remembered breakpoint set must be re-applied on restart: " + reports.dump());
    check(client.breakpoint_map().at("dap/main.cpp").size() == 1, "the remembered table survives a restart");
    client.shutdown();
}

// Responses are matched by request_seq even when the adapter answers out of order:
// it deliberately holds one reply back until the next request has been answered.
// (6c) Conditional breakpoints. Its own adapter process, because the scripted
// adapter derives the fake stack from the last setBreakpoints it saw.
void scenario_conditional_breakpoints() {
    const auto root = workspace_root();
    Recorder recorder;
    Client client;
    client.set_root(root);
    client.start(adapter_path(), {L"--stdio"}, root, [&recorder](Json event) { recorder.push(std::move(event)); });
    Waiter started;
    client.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"}, {"cwd", "."}}, started.reply());
    check(started.await_for() && started.ok(), "dap.start failed: " + started.failure_text());

    Waiter installed;
    client.set_breakpoints("dap/cond.cpp",
                           Json::array({Json{{"line", 3}, {"condition", "i == 2"}},
                                        Json{{"line", 4}, {"condition", ""}},
                                        Json{{"line", 0}, {"condition", "never"}},
                                        Json{{"condition", "no line"}}}),
                           installed.reply());
    check(installed.await_for(), "no setBreakpoints response");
    check(installed.ok(), "conditional setBreakpoints failed: " + installed.failure_text());
    check(installed.result.at("verifiedLines").size() == 2,
          "only the two valid lines are sent: " + installed.result.dump());
    const auto& notes = installed.result.at("messages");
    check(notes.is_array() && notes.size() == 1 && notes[0].at("line").get<int>() == 3 &&
              string_at(notes[0], "message") == "cond:i == 2",
          "the condition reached the adapter, got: " + notes.dump());
    const auto remembered = client.breakpoint_map();
    const auto& stored = remembered.at("dap/cond.cpp");
    check(stored.size() == 2 && string_at(stored[0], "condition") == "i == 2",
          "conditions are remembered for a restart: " + stored.dump());
    check(!stored[1].contains("condition"), "an empty condition is dropped, not sent as \"\"");
    client.shutdown();
}

void scenario_out_of_order_correlation() {
    const auto root = workspace_root();
    Recorder recorder;
    Client client;
    client.set_root(root);
    client.start(adapter_path(), {}, root, [&recorder](Json event) { recorder.push(std::move(event)); });

    Waiter started;
    client.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"}}, started.reply());
    check(started.await_for(), "dap.start never replied");
    check(started.ok(), "dap.start failed: " + started.failure_text());

    Waiter held;         // variables(555): answered LAST
    Waiter overtakes;    // scopes(1000): answered FIRST
    client.variables(555, held.reply());
    client.scopes(1000, overtakes.reply());
    check(overtakes.await_for(), "the overtaking reply must still arrive");
    check(overtakes.ok() && overtakes.result.contains("scopes"), "the scopes reply must carry scopes");
    check(held.await_for(), "the held-back reply must be correlated by request_seq");
    check(held.ok() && held.result.contains("variables"), "the variables reply must carry variables");
    check(string_at(held.result.at("variables")[0], "name") == "held", "the late reply belongs to the late request");

    // An unsupported command surfaces as a failure, never as a hang.
    Waiter unknown;
    client.request("taocode/notACommand", Json::object(), unknown.reply());
    check(unknown.await_for(), "an unsupported command must answer");
    check(!unknown.ok(), "an unsupported command must fail");
    check(unknown.error.contains("command") && unknown.error.at("command").get<std::string>() == "taocode/notACommand",
          "the error must name the failing command: " + unknown.error.dump());
    check(!string_at(unknown.error, "message").empty(), "the adapter message text must be forwarded");
    check(client.running(), "a refused command must not tear the session down");
    client.shutdown();
}

// Framing and path mapping that need no process at all.
void scenario_framing_and_paths() {
    // A frame split one byte at a time (header and body) must still decode.
    const Json request = make_request(7, "setBreakpoints", Json{{"source", Json{{"path", "file:///C:/a b/main.cpp"}}}});
    const auto frame = encode_message(request);
    check(frame.rfind("Content-Length: ", 0) == 0, "encode must emit a Content-Length header");
    check(frame.find("\r\n\r\n") != std::string::npos, "encode must terminate the header block");
    const auto expected = request.dump();
    check(frame == "Content-Length: " + std::to_string(expected.size()) + "\r\n\r\n" + expected,
          "the header must count body bytes exactly");
    MessageReader byte_by_byte;
    for (const char ch : frame) byte_by_byte.feed(std::string_view(&ch, 1));
    const auto decoded = byte_by_byte.next();
    check(decoded.has_value(), "a byte-at-a-time frame must decode");
    check(decoded->at("seq").get<std::int64_t>() == 7, "seq survives framing");
    check(decoded->at("type").get<std::string>() == "request", "type survives framing");
    check((*decoded)["arguments"]["source"]["path"].get<std::string>() == "file:///C:/a b/main.cpp", "body survives framing");
    check(!byte_by_byte.next().has_value(), "no phantom message after one frame");

    // Two frames in a single feed plus a trailing partial frame.
    MessageReader batched;
    const auto next_frame = encode_message(make_request(8, "continue", Json::object()));
    batched.feed(frame + next_frame + next_frame.substr(0, 12));
    const auto first_message = batched.next();
    const auto second_message = batched.next();
    check(first_message.has_value() && second_message.has_value(), "both complete frames must pop");
    check(second_message->at("command").get<std::string>() == "continue", "the second frame decodes independently");
    check(!batched.next().has_value(), "a partial frame must stay buffered");

    // Malformed headers are protocol errors, never a crash or a silent desync.
    const auto protocol_code = [](const std::string& bytes) -> std::string {
        try {
            MessageReader reader;
            reader.feed(bytes);
            (void)reader.next();
        } catch (const WorkspaceError& error) {
            return error.code;
        }
        return "none";
    };
    check(protocol_code("Content-Length: 4\r\n\r\nnope") == "DAP_PROTOCOL", "a corrupt body must raise DAP_PROTOCOL");
    check(protocol_code("Content-Length: zero\r\n\r\n{}") == "DAP_PROTOCOL", "a non-numeric length must be rejected");
    check(protocol_code("Content-Length: 2\r\nContent-Length: 3\r\n\r\n{}") == "DAP_PROTOCOL", "a duplicate length must be rejected");
    check(protocol_code("Content-Mine: 2\r\n\r\n{}") == "DAP_PROTOCOL", "a missing length must be rejected");
    check(protocol_code("Content-Length: 0\r\n\r\n") == "DAP_PROTOCOL", "a zero length must be rejected");
    check(protocol_code("Content-Length: 999999999999\r\n\r\n") == "DAP_PROTOCOL", "an over-long body must be refused up front");
    check(protocol_code("Content-Length: 2\r\n\r\n{}") == "none", "a well-formed frame must not throw");

    // Path mapping: workspace-relative to file:/// URI, both directions.
    // A backslash is spelled char(92) so this source stays escape-free.
    const auto backslashed = [](std::string value) {
        std::replace(value.begin(), value.end(), '/', char{92});
        return value;
    };
    Client client;
    client.set_root(fs::path(L"C:/Users/dev/My Project"));
    const auto uri = client.to_uri("dap/main.cpp");
    check(uri == "file:///C:/Users/dev/My%20Project/dap/main.cpp", "unexpected uri: " + uri);
    check(client.to_uri(uri) == uri, "an existing uri must pass through");
    check(client.to_path(uri) == "dap/main.cpp", "round-trip must return the relative path");
    check(client.to_path("file:///C%3A/Users/dev/My%20Project/dap/main.cpp") == "dap/main.cpp", "percent-encoded drive colons decode");
    check(client.to_path(backslashed("C:/Users/dev/My Project/dap/other.cpp")) == "dap/other.cpp", "plain windows paths normalise");
    check(client.to_path("file:///C:/Other/place.cpp") == "C:/Other/place.cpp", "outside the workspace stays absolute");
    check(client.to_native("dap/main.cpp") == "C:/Users/dev/My Project/dap/main.cpp", "launch paths are absolutised: " + client.to_native("dap/main.cpp"));
    check(client.to_native("./sub/../dap/x.cpp") == "C:/Users/dev/My Project/dap/x.cpp", "launch paths are normalised");
    check(client.to_native(backslashed("C:/x/y.exe")) == "C:/x/y.exe", "absolute launch paths only normalise separators");
    check(client.to_uri("") == "file:///C:/Users/dev/My%20Project", "the empty path is the root");
    check(!to_utf8(adapter_path()).empty(), "the fake adapter is locatable beside the test");
}

// IDEA's Attach to Process: the same handshake with the `attach` request; the
// scripted adapter answers with its "attaching to <selector>" output event.
void scenario_attach_and_exception_filters() {
    const auto root = workspace_root();
    Recorder recorder;
    Client client;
    client.set_root(root);

    // Exception filters chosen before the session are remembered and re-applied by
    // start (same rule as line breakpoints).
    Waiter deferred_filters;
    client.set_exception_breakpoints(Json::array({"all"}), deferred_filters.reply());
    check(deferred_filters.await_for(), "setExceptionBreakpoints before start never replied");
    check(flag_at(deferred_filters.result, "deferred"), "offline exception filters must report deferred=true");

    client.start(adapter_path(), {}, root, [&recorder](Json event) { recorder.push(std::move(event)); });
    Waiter attached;
    client.start_debugging("fake-adapter", Json{{"request", "attach"}, {"processId", 4242}},
                           attached.reply());
    check(attached.await_for(), "attach sequence never replied");
    check(attached.ok(), "attach sequence failed: " + attached.failure_text());
    Json output;
    expect_event(recorder, [](const Json& e) { return is_event(e, "output"); }, "attach output event", &output);
    check(output.at("text").get<std::string>().find("4242") != std::string::npos,
          "attach must forward the process selector: " + output.at("text").get<std::string>());
    Json stopped;
    expect_event(recorder, [](const Json& e) { return is_event(e, "stopped"); }, "attach stopped event", &stopped);

    // The thread list the debugger's Threads view shows.
    Waiter threads;
    client.threads(threads.reply());
    check(threads.await_for(), "threads never replied");
    check(threads.ok(), "threads failed: " + threads.failure_text());
    const auto& list = threads.result.at("threads");
    check(list.is_array() && list.size() == 2, "threads must list the scripted pair: " + threads.result.dump());
    check(number_at(list[0], "id") == 1, "thread ids preserved");

    client.shutdown();
}

// A hung adapter must not hang the bridge: every request carries a deadline and
// is answered with DAP_TIMEOUT when it expires, and the pending entry is dropped
// so a reply that eventually arrives cannot resurrect it.
void scenario_request_timeout() {
    const auto root = workspace_root();
    Recorder recorder;
    Client client;
    client.set_root(root);
    client.start(adapter_path(), {}, root, [&recorder](Json event) { recorder.push(std::move(event)); });
    Waiter started;
    client.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"}}, started.reply());
    check(started.await_for(), "dap.start never replied");
    check(started.ok(), "dap.start failed: " + started.failure_text());

    client.set_timeout(std::chrono::milliseconds(500));
    // variables(555) is deliberately held back until the *next* request, so on its
    // own it is never answered — exactly the hung-adapter case.
    const auto sent_at = Clock::now();
    Waiter held;
    client.variables(555, held.reply());
    check(held.await_for(25), "a request the adapter never answers must still be answered");
    check(!held.ok(), "the timeout must surface as an error, not an empty success");
    check(held.error.value("code", std::string()) == "DAP_TIMEOUT",
          "the error names the timeout, got: " + held.failure_text());
    check(Clock::now() - sent_at < std::chrono::seconds(20), "and it arrives when the deadline expires");

    // The session survives: the next request flushes the adapter's held reply,
    // which must be dropped (its caller is long gone) instead of mis-delivered.
    Waiter follow;
    client.scopes(1000, follow.reply());
    check(follow.await_for(), "the session must still work after a timeout");
    check(follow.ok() && follow.result.contains("scopes"), "scopes answered normally: " + follow.failure_text());
    client.shutdown();
}

// The events an adapter sends around the edges of a session have to arrive in the
// shape the debug UI consumes: a real exit code, a module and a source mapped back
// to workspace-relative paths, and one progress sequence with its own id.
void scenario_event_shaping() {
    const auto root = workspace_root();
    Recorder recorder;
    Client client;
    client.set_root(root);
    client.start(adapter_path(), {L"--extras"}, root, [&recorder](Json event) { recorder.push(std::move(event)); });
    Waiter started;
    client.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"}}, started.reply());
    check(started.await_for(), "dap.start never replied");
    check(started.ok(), "dap.start failed: " + started.failure_text());

    Json exited;
    expect_event(recorder, [](const Json& event) { return is_event(event, "exited"); }, "the exited event", &exited);
    check(number_at(exited, "exitCode") == 3, "exited carries the debuggee's real exit code");

    Json module;
    expect_event(recorder, [](const Json& event) { return is_event(event, "module"); }, "the module event", &module);
    check(number_at(module.at("module"), "id") == 7, "module keeps the adapter's module id");
    check(string_at(module.at("module"), "name") == "fake.dll", "module keeps the module name");
    check(string_at(module, "path") == "fake.dll",
          "the module path is workspace-relative, got: " + string_at(module, "path"));

    Json loaded;
    expect_event(recorder, [](const Json& event) { return is_event(event, "loadedSource"); }, "the loadedSource event",
                 &loaded);
    check(string_at(loaded.at("source"), "name") == "main.cpp", "loadedSource keeps the source name");
    check(string_at(loaded, "path") == "dap/main.cpp",
          "the loadedSource path is workspace-relative, got: " + string_at(loaded, "path"));

    // progressStart / progressUpdate / progressEnd: three DAP events, one shape.
    Json begin;
    expect_event(recorder,
                 [](const Json& event) {
                     return is_event(event, "progress") && event.value("phase", std::string()) == "start";
                 },
                 "the progress start", &begin);
    check(string_at(begin, "progressId") == "load", "progress carries its id");
    check(string_at(begin, "title") == "Loading", "progress carries its title");
    check(number_at(begin, "percentage") == 0, "progress start carries a percentage");

    Json update;
    expect_event(recorder,
                 [](const Json& event) {
                     return is_event(event, "progress") && event.value("phase", std::string()) == "update" &&
                            event.value("percentage", 0) == 50;
                 },
                 "the progress update", &update);
    check(string_at(update, "message") == "halfway", "progress update carries its message");

    Json end;
    expect_event(recorder,
                 [](const Json& event) {
                     return is_event(event, "progress") && event.value("phase", std::string()) == "end";
                 },
                 "the progress end", &end);
    check(string_at(end, "progressId") == "load", "progress end still names the same id");

    client.shutdown();
}

// An adapter's reverse requests are real work, not `success:false`: runInTerminal
// launches the command and hands back a live process id, startDebugging starts a
// second session. Both answers are echoed by the adapter as console output.
void scenario_reverse_requests() {
    const auto root = workspace_root();
    Recorder recorder;
    Client client;
    client.set_root(root);
    client.start(adapter_path(), {}, root, [&recorder](Json event) { recorder.push(std::move(event)); });
    Waiter started;
    client.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"},
                                                {"__reverseTerminal", true},
                                                {"__reverseNested", true}},
                           started.reply());
    check(started.await_for(), "dap.start never replied");
    check(started.ok(), "dap.start failed: " + started.failure_text());

    Json terminal_output;
    expect_event(recorder,
                 [](const Json& event) {
                     return is_event(event, "output") && event.value("text", std::string()).find("runInTerminal answered") != std::string::npos;
                 },
                 "the adapter's echo of the runInTerminal answer", &terminal_output);
    const auto echo = string_at(terminal_output, "text");
    check(echo.find("success=true") != std::string::npos, "runInTerminal must be answered successfully, got: " + echo);
    const auto at = echo.find("shellProcessId=");
    check(at != std::string::npos, "runInTerminal must answer with a real process id, got: " + echo);
    check(std::stoll(echo.substr(at + 15)) > 0, "the process id must be a live one, got: " + echo);

    Json nested_output;
    expect_event(recorder,
                 [](const Json& event) {
                     return is_event(event, "output") && event.value("text", std::string()).find("startDebugging answered") != std::string::npos;
                 },
                 "the adapter's echo of the startDebugging answer", &nested_output);
    check(string_at(nested_output, "text").find("success=true") != std::string::npos,
          "startDebugging must be answered successfully, got: " + string_at(nested_output, "text"));

    // A host hook — what main.cpp installs to route "integrated" into the IDE's own
    // terminal — has to win over the built-in launcher.
    Client::set_run_in_terminal_handler([](const Json&, std::string&) { return Json{{"shellProcessId", 4242}}; });
    Waiter again;
    client.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"}, {"__reverseTerminal", true}}, again.reply());
    check(again.await_for(), "the second dap.start never replied");
    check(again.ok(), "the second dap.start failed: " + again.failure_text());
    Json hooked;
    expect_event(recorder,
                 [](const Json& event) {
                     return is_event(event, "output") &&
                            event.value("text", std::string()).find("shellProcessId=4242") != std::string::npos;
                 },
                 "the answer the host hook produced", &hooked);
    Client::set_run_in_terminal_handler(Client::ReverseHandler{});  // back to the default

    // The nested session is a real adapter process owned by this one: tearing the
    // parent down has to take it with it.
    client.shutdown();
    check(client.exited(), "the session is over after shutdown");
    check(live_adapters() == 0, "no adapter process may outlive the session, found " + std::to_string(live_adapters()));
}

// disconnect() waits for the reader thread, so dropping the Client the moment it
// returns can never leave a callback running against destroyed state.
void scenario_disconnect_then_destroy() {
    const auto root = workspace_root();
    int events = 0;
    {
        Client client;
        client.set_root(root);
        client.start(adapter_path(), {}, root, [&events](Json) { ++events; });
        Waiter started;
        client.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"}}, started.reply());
        check(started.await_for() && started.ok(), "dap.start failed: " + started.failure_text());
        Waiter closed;
        client.disconnect(closed.reply());
        check(closed.await_for(5), "disconnect must answer");
        check(client.exited(), "disconnect waits for the adapter to be gone");
    }
    // Reaching this line is the assertion: no use-after-free, no hang.
    check(true, "the client was destroyed immediately after disconnect");
}

}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try {
            operation();
            ++passed;
            std::cout << "PASS " << name << '\n';
        } catch (const std::exception& error) {
            ++failures;
            std::cerr << "FAIL " << name << ": " << error.what() << '\n';
        }
    };

    run("framing, malformed headers and path mapping", scenario_framing_and_paths);
    run("dap.start -> events -> breakpoints -> stack -> scopes -> variables -> control", scenario_full_session);
    run("out-of-order responses correlate by request_seq", scenario_out_of_order_correlation);
    run("shutdown reaps the adapter and the client is reusable", scenario_shutdown_reaps_the_adapter);
    run("conditional breakpoints normalize, reach the adapter and are remembered", scenario_conditional_breakpoints);
    run("attach handshake, remembered exception filters and the thread list", scenario_attach_and_exception_filters);
    run("a request the adapter never answers times out instead of hanging", scenario_request_timeout);
    run("exited / module / loadedSource / progress arrive in the UI's own shape", scenario_event_shaping);
    run("runInTerminal and startDebugging are answered for real", scenario_reverse_requests);
    run("disconnect waits for the reader thread, so the client can be dropped", scenario_disconnect_then_destroy);

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
