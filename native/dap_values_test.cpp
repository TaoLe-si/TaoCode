// ---------------------------------------------------------------------------
// Offline end-to-end test for the DAP **取值族**（stackTrace / variables / scopes /
// evaluate）的协议补齐，以及第二批协议请求族（dataBreakpoints / setDataBreakpoints /
// setFunctionBreakpoints / source）。
//
// 为什么单独成文件（2026-10-06 模块化体检）：native/dap_test.cpp 已 1210 行、贴着
// `tests/module-size.test.mjs` 的 1300 行测试上限；本轮补的分页/求值/断点族只做"参数
// 真的发出去 + 回参整形成 UI 认的形状"，与会话/管道/反向请求那批场景不共一个职责域，
// 所以拆成第二个测试可执行文件（`dap_values_test`），与 dap_test 一样起真实的
// dap_fake_adapter.exe 子进程、走真实的 Content-Length 帧与 request_seq 关联。
// ---------------------------------------------------------------------------

#include "dap.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <functional>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::dap::Client;

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

std::wstring adapter_path() {
    auto executable = self_directory() / L"dap_fake_adapter.exe";
    check(fs::exists(executable), "fake adapter binary is missing: " + executable.string());
    return executable.native();
}

fs::path workspace_root() {
    const auto root = self_directory() / L"dap-values-workspace";
    std::error_code ignored;
    fs::create_directories(root, ignored);  // the adapter inherits this as its cwd
    return root;
}

/** 一条异步答复的等待器（与 dap_test.cpp 的同名结构逐字一致）。 */
struct Waiter {
    std::mutex mutex;
    std::condition_variable cv;
    bool done = false;
    Json result;
    Json error;

    void finish(Json value, Json failure) {
        {
            std::lock_guard lock(mutex);
            result = std::move(value);
            error = std::move(failure);
            done = true;
        }
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

/** 收集到的 DAP 事件（与 dap_test.cpp 的同名结构逐字一致）。 */
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
};

bool is_event(const Json& event, const std::string& name) {
    return event.is_object() && event.contains("event") && event.at("event").is_string() &&
           event.at("event").get<std::string>() == name;
}

// 适配器把收到的请求参数回声成一条 output（规范响应里没有那些字段），测试据此证明参数
// 真的发出去了。
std::function<bool(const Json&)> is_output_containing(std::string fragment) {
    return [fragment = std::move(fragment)](const Json& event) {
        return is_event(event, "output") && event.contains("text") && event.at("text").is_string() &&
               event.at("text").get<std::string>().find(fragment) != std::string::npos;
    };
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

// ---------------------------------------------------------------- scenarios ---

// DAP 分页与求值：`stackTrace{startFrame,levels}` / `variables{start,count}` 的分页字段
// 必须真的发出去（<= 0 时**不发键**），`scopes` 的 namedVariables/indexedVariables 要透出，
// `evaluate` 走规范字段并整形成可展开的形状（`reference`/`named` 与前端在用的
// `variablesReference` 同时在）。
void scenario_pagination_and_evaluate() {
    const auto root = workspace_root();
    Recorder recorder;
    Client client;
    client.set_root(root);
    client.start(adapter_path(), {}, root, [&recorder](Json event) { recorder.push(std::move(event)); });
    Waiter started;
    client.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"}}, started.reply());
    check(started.await_for() && started.ok(), "dap.start failed: " + started.failure_text());

    // 分页形式的 stackTrace：两个字段都发出去。
    Waiter paged;
    client.stack_trace(1, 1, 1, paged.reply());
    check(paged.await_for() && paged.ok(), "paged stackTrace failed: " + paged.failure_text());
    check(number_at(paged.result, "totalFrames") == 2, "totalFrames is the adapter's total, not this page's size");
    check(paged.result.at("frames").size() == 2, "the scripted adapter always answers two frames");
    Json heard;
    check(recorder.wait_for(is_output_containing("stackTrace startFrame=1 levels=1"), 10, &heard),
          "startFrame/levels must reach the adapter when positive");

    // 默认形式：两个分页键都不发（省略 = 全部），所以回声是 -1。
    Waiter whole;
    client.stack_trace(1, whole.reply());
    check(whole.await_for() && whole.ok(), "plain stackTrace failed: " + whole.failure_text());
    check(recorder.wait_for(is_output_containing("stackTrace startFrame=-1 levels=-1"), 10, &heard),
          "an unpaged stackTrace must omit startFrame and levels");

    // scopes 的 namedVariables/indexedVariables 要整形出来（分页依据）。
    Waiter scopes;
    client.scopes(1000, scopes.reply());
    check(scopes.await_for() && scopes.ok(), "scopes failed: " + scopes.failure_text());
    const auto& scope_list = scopes.result.at("scopes");
    check(scope_list.is_array() && scope_list.size() == 2, "two scripted scopes");
    check(number_at(scope_list[0], "namedVariables") == 2, "namedVariables must survive shaping");
    check(number_at(scope_list[0], "indexedVariables") == 0, "indexedVariables must survive shaping");
    check(number_at(scope_list[1], "namedVariables") == 1 && !scope_list[1].contains("indexedVariables"),
          "absent namedVariables/indexedVariables must not be invented");

    // 分页形式的 variables。
    Waiter page;
    client.variables(2000, 1, 1, page.reply());
    check(page.await_for() && page.ok(), "paged variables failed: " + page.failure_text());
    check(recorder.wait_for(is_output_containing("variables ref=2000 start=1 count=1"), 10, &heard),
          "start/count must reach the adapter when positive");
    // 默认形式：两个键都不发。
    Waiter all;
    client.variables(2000, all.reply());
    check(all.await_for() && all.ok(), "plain variables failed: " + all.failure_text());
    check(recorder.wait_for(is_output_containing("variables ref=2000 start=-1 count=-1"), 10, &heard),
          "an unpaged variables request must omit start and count");

    // evaluate 走规范字段：context/frameId 原样到达，回参整形成可展开的形状。
    Waiter evaluated;
    client.evaluate("counter + 1", "watch", 1000, evaluated.reply());
    check(evaluated.await_for() && evaluated.ok(), "evaluate failed: " + evaluated.failure_text());
    check(string_at(evaluated.result, "result") == "counter + 1 => 42 [watch@1000]",
          "expression, context and frameId round-tripped, got: " + string_at(evaluated.result, "result"));
    check(string_at(evaluated.result, "type") == "int", "evaluate keeps the adapter's type");
    check(number_at(evaluated.result, "reference") == 0 && number_at(evaluated.result, "variablesReference") == 0,
          "a non-expandable result carries reference 0 under both names");
    check(flag_at(evaluated.result, "named") == false, "reference 0 means it is not expandable");

    // context 缺省时不发该键（空串会被适配器当成一个具体的上下文名）。
    Waiter no_context;
    client.evaluate("plain", "", 0, no_context.reply());
    check(no_context.await_for() && no_context.ok(), "evaluate without context failed: " + no_context.failure_text());
    check(string_at(no_context.result, "result") == "plain => 42 [@-1]",
          "an omitted context/frameId must not be sent, got: " + string_at(no_context.result, "result"));
    client.shutdown();
}

// 协议侧补齐的第二批：数据断点 / 函数断点 / source。
// 能力位（规范默认 false）都声明时请求真的发出去、整形落地；关掉时本地回 DAP_UNSUPPORTED。
void scenario_data_function_breakpoints_and_source() {
    const auto root = workspace_root();
    Recorder recorder;
    Client client;
    client.set_root(root);
    client.start(adapter_path(), {}, root, [&recorder](Json event) { recorder.push(std::move(event)); });
    Waiter started;
    client.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"}}, started.reply());
    check(started.await_for() && started.ok(), "dap.start failed: " + started.failure_text());
    check(client.supports_data_breakpoints() && client.supports_function_breakpoints() && client.supports_source(),
          "the fake advertises all three second-batch capabilities");

    // dataBreakpoints：缺 dataId 的条目被丢掉（规范必填），其余字段落地。
    Waiter listed;
    client.data_breakpoints(listed.reply());
    check(listed.await_for() && listed.ok(), "dataBreakpoints failed: " + listed.failure_text());
    check(flag_at(listed.result, "available"), "the adapter answered");
    const auto& points = listed.result.at("breakpoints");
    check(points.is_array() && points.size() == 2,
          "the item without a dataId must be dropped, got " + std::to_string(points.size()));
    check(string_at(points[0], "dataId") == "counter" && string_at(points[0], "accessType") == "write" &&
              string_at(points[0], "label") == "counter (write)",
          "dataId/accessType/label survive");
    check(points[0].at("id").is_string() && string_at(points[0], "id") == "watch-1", "the adapter id survives");
    check(!points[1].contains("accessType") && !points[1].contains("description"),
          "absent optional fields must not be invented");

    // setDataBreakpoints：非法 accessType 与缺 dataId 的请求项在本地就被丢掉。
    Waiter installed;
    client.set_data_breakpoints(Json::array({Json{{"dataId", "counter"}, {"accessType", "write"}, {"condition", "x > 1"}},
                                             Json{{"dataId", "flags"}, {"accessType", "bogus"}},
                                             Json{{"accessType", "read"}}}),
                                installed.reply());
    check(installed.await_for() && installed.ok(), "setDataBreakpoints failed: " + installed.failure_text());
    check(installed.result.at("breakpoints").size() == 2, "the two items without a dataId are dropped");
    check(flag_at(installed.result.at("breakpoints")[0], "verified"), "the adapter verified the data breakpoint");
    Json heard;
    check(recorder.wait_for(is_output_containing("setDataBreakpoints counter/write flags/"), 10, &heard),
          "the invalid accessType must be dropped before the request, got: " + heard.dump());

    // setFunctionBreakpoints：按函数名停住（IDEA 的方法断点）；缺 name 的请求项被丢掉。
    Waiter functions;
    client.set_function_breakpoints(Json::array({Json{{"name", "main"}, {"condition", "argc > 1"}},
                                                 Json{{"condition", "no name"}}}),
                                    functions.reply());
    check(functions.await_for() && functions.ok(), "setFunctionBreakpoints failed: " + functions.failure_text());
    check(functions.result.at("breakpoints").size() == 1, "the item without a name is dropped");
    check(string_at(functions.result.at("breakpoints")[0], "name") == "main", "the function name survives");
    check(number_at(functions.result.at("breakpoints")[0], "line") == 12, "the adapter's line survives");
    check(recorder.wait_for(is_output_containing("setFunctionBreakpoints main"), 10, &heard),
          "the function name must reach the adapter");

    // source：按 sourceReference 取适配器动态生成的源（没有真实文件路径的那一类）。
    Waiter generated;
    client.source(7, "", generated.reply());
    check(generated.await_for() && generated.ok(), "source failed: " + generated.failure_text());
    check(flag_at(generated.result, "available"), "content came back");
    check(string_at(generated.result, "content").find("generated source for 7") != std::string::npos,
          "the reference round-tripped: " + string_at(generated.result, "content"));
    check(string_at(generated.result, "mimeType") == "text/x-c", "mimeType survives");
    check(recorder.wait_for(is_output_containing("source ref=7 path="), 10, &heard),
          "the sourceReference must reach the adapter");
    client.shutdown();

    // 三个能力位都不声明：本地回 DAP_UNSUPPORTED，一个请求都不发。
    Client gated;
    gated.set_root(root);
    gated.start(adapter_path(),
                {L"--no-data-breakpoints", L"--no-function-breakpoints", L"--no-source"}, root, [](Json) {});
    Waiter gated_start;
    gated.start_debugging("fake-adapter", Json{{"program", "dap/main.cpp"}}, gated_start.reply());
    check(gated_start.await_for() && gated_start.ok(), "gated dap.start failed: " + gated_start.failure_text());
    check(!gated.supports_data_breakpoints() && !gated.supports_function_breakpoints() && !gated.supports_source(),
          "the fake was told to advertise none of the three second-batch capabilities");
    const auto expect_unsupported = [](const std::string& what, Waiter& waiter) {
        check(waiter.await_for(), "an unsupported " + what + " must answer instead of hanging");
        check(!waiter.ok(), "an unsupported " + what + " is not a success");
        check(string_at(waiter.error, "code") == "DAP_UNSUPPORTED",
              what + " needs the DAP_UNSUPPORTED code, got: " + string_at(waiter.error, "code"));
    };
    Waiter no_data;
    gated.data_breakpoints(no_data.reply());
    expect_unsupported("dataBreakpoints", no_data);
    Waiter no_set_data;
    gated.set_data_breakpoints(Json::array({Json{{"dataId", "x"}}}), no_set_data.reply());
    expect_unsupported("setDataBreakpoints", no_set_data);
    Waiter no_functions;
    gated.set_function_breakpoints(Json::array({Json{{"name", "main"}}}), no_functions.reply());
    expect_unsupported("setFunctionBreakpoints", no_functions);
    Waiter no_source;
    gated.source(7, "", no_source.reply());
    expect_unsupported("source", no_source);
    gated.shutdown();
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

    run("stackTrace/variables paginate, scopes expose counts and evaluate shapes a value",
        scenario_pagination_and_evaluate);
    run("data breakpoints, function breakpoints and source round-trip (and gate)",
        scenario_data_function_breakpoints_and_source);

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}