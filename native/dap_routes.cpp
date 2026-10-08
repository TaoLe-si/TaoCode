// `dap.*` 分派体 —— 见 dap_routes.hpp 的模块说明（为什么拆、宿主面是什么）。
//
// 语义与拆出前 main.cpp 的各 case 逐条一致：校验放在这一层（参数坏了回 INVALID_REQUEST，
// 会话没起来回 DAP_NOT_RUNNING），能力门控与整形在 dap.cpp / dap_inspect.cpp 里。

#include "dap_routes.hpp"

#include <cstdint>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#include "text.hpp"  // wide()：桥上的 UTF-8 命令/参数 → CreateProcessW 的 UTF-16

namespace taocode {
namespace dap {
namespace {

namespace fs = std::filesystem;

/** 一条异步答复的回调：把 (result, error) 交回宿主搬去 UI 线程。捕获的是宿主引用 ——
 *  宿主（App）比适配器进程活得久，回调最迟在会话收摊时被丢弃。 */
Client::Reply answer_to(RouteHost& host, const Json& id) {
    return [&host, id](Json result, Json error) { host.route_reply(id, std::move(result), std::move(error)); };
}

long long_of(const Json& params, const char* key, std::int64_t fallback) {
    return static_cast<long>(params.value(key, fallback));
}

}  // namespace

RouteOutcome dispatch_dap_route(const std::string& method, const Json& params, const Json& id, RouteHost& host,
                               Json& result) {
    if (method.rfind("dap.", 0) != 0) return RouteOutcome::unhandled;

    // --- 会话生命周期 ---------------------------------------------------------

    // `dap.start`：唯一的"先收摊再起新会话"入口（重启语义）。
    if (method == "dap.start") {
        if (host.route_root().empty()) throw WorkspaceError("NOT_OPEN", "请先打开项目。");
        auto& session = host.route_client();
        session.shutdown();  // restart semantics: reap any prior adapter first
        const auto kind = params.value("kind", std::string("cppvsdbg"));
        const Json registry = host.route_registry();
        const Json entry = registry.is_object() ? registry.value(kind, Json::object()) : Json::object();
        auto command = params.value("command", std::string());
        if (command.empty()) command = entry.value("command", std::string());
        if (command.empty())
            throw WorkspaceError("DAP_NO_ADAPTER",
                                 "未找到调试适配器：请在 exe 旁的 TaoCode.dap.json 为 kind \"" + kind +
                                     "\" 配置 command。");
        std::vector<std::wstring> arguments;
        const Json args_src = params.contains("args") ? params.at("args")
                                                      : (entry.contains("args") ? entry.at("args") : Json::array());
        if (args_src.is_array())
            for (const auto& item : args_src)
                if (item.is_string()) arguments.push_back(wide(item.get<std::string>()));
        auto cwd = params.value("cwd", std::string());
        if (cwd.empty()) cwd = entry.value("cwd", std::string());
        if (cwd.empty()) cwd = host.route_root();
        Json configuration{{"name", "TaoCode"},
                           {"kind", kind},
                           {"request", entry.value("request", std::string("launch"))},
                           {"program", params.value("program", std::string())},
                           {"cwd", cwd},
                           {"stopOnEntry", params.value("stopOnEntry", false)}};
        if (params.contains("args")) configuration["args"] = params.at("args");
        if (params.contains("env")) configuration["env"] = params.at("env");
        if (params.contains("configuration") && params.at("configuration").is_object())
            for (auto& item : params.at("configuration").items()) configuration[item.key()] = item.value();
        session.start(wide(command), arguments, fs::path(wide(cwd)), host.route_event_sink());
        session.start_debugging(kind, std::move(configuration), answer_to(host, id));
        return RouteOutcome::answered_async;  // async; delivered through the host's reply sink
    }

    // IDEA 的「停止」与「断开」：回调里再收摊（disconnect 会等适配器真的走掉）。
    if (method == "dap.terminate") {
        host.route_client().terminate([&host, id](Json, Json error) {
            host.route_stop();
            host.route_reply(id, Json{{"ok", true}}, std::move(error));
        });
        return RouteOutcome::answered_async;
    }
    if (method == "dap.disconnect") {
        auto& session = host.route_client();
        const bool terminate_debuggee = params.value("terminate", true);
        session.disconnect(terminate_debuggee, [&host, id](Json, Json error) {
            host.route_stop();
            host.route_reply(id, Json{{"ok", true}}, std::move(error));
        });
        return RouteOutcome::answered_async;
    }
    // IDEA 的「重新运行」（Ctrl+F5）：适配器声明了 supportsRestartRequest 才原地重启，
    // 否则回 DAP_UNSUPPORTED，调用方退化成"停止 + 重新启动"。
    if (method == "dap.restart") {
        Json arguments = params.contains("arguments") && params.at("arguments").is_object() ? params.at("arguments")
                                                                                            : Json::object();
        host.route_client().restart(std::move(arguments), answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    if (method == "dap.breakpoints") {
        result = Json{{"breakpoints", host.route_breakpoints()}};
        return RouteOutcome::answered;
    }

    // --- 断点 ----------------------------------------------------------------

    if (method == "dap.setBreakpoints") {
        auto& session = host.route_client();
        if (!params.contains("breakpoints") || !params.at("breakpoints").is_array())
            throw WorkspaceError("INVALID_REQUEST", "breakpoints 必须是数组（{line, condition?…}）。");
        for (const auto& point : params.at("breakpoints")) {
            if (!point.is_object() || !point.contains("line") || !point.at("line").is_number_integer())
                throw WorkspaceError("INVALID_REQUEST", "断点必须带有整数 line。");
        }
        session.set_breakpoints(params.at("path").get<std::string>(), params.at("breakpoints"), answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    if (method == "dap.setExceptionBreakpoints") {
        host.route_client().set_exception_breakpoints(params.at("filters"), answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    if (method == "dap.breakpointLocations") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        const auto path = params.value("path", std::string());
        // 空路径会被 `to_uri("")` 解释成工作区根目录，适配器只能答"没有位置" ——
        // 那不是"这一行不能放断点"，而是调用方忘了传。别让它伪装成前者。
        if (path.empty()) throw WorkspaceError("INVALID_REQUEST", "断点位置预览需要一个文件路径。");
        session.breakpoint_locations(path, long_of(params, "line", 0), long_of(params, "endLine", 0),
                                     long_of(params, "column", 0), long_of(params, "endColumn", 0),
                                     answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    // DAP `dataBreakpoints`（IDEA 的字段观察点候选清单）：能力门控与整形都在 `Client::data_breakpoints`
    // （native/dap_values.cpp），没声明 `supportsDataBreakpoints` 时回 DAP_UNSUPPORTED —— 调用方据此
    // 不渲染入口，而不是把"没有候选"当成结论。
    if (method == "dap.dataBreakpoints") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        session.data_breakpoints(answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    // DAP `setDataBreakpoints`（IDEA `JavaFieldBreakpointType` 的字段观察点）：装/清数据断点。
    // 请求项的 dataId 必填，空条目在 `normalize_data_breakpoints` 里被丢掉（与规范一致）。
    if (method == "dap.setDataBreakpoints") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        const Json requested = params.contains("breakpoints") && params.at("breakpoints").is_array()
                                   ? params.at("breakpoints")
                                   : Json::array();
        session.set_data_breakpoints(requested, answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    // DAP `setFunctionBreakpoints`（IDEA 的 `JavaMethodBreakpointType`，按**函数名**停住）：
    // 能力位 `supportsFunctionBreakpoints` 默认 false，未声明回 DAP_UNSUPPORTED。
    if (method == "dap.setFunctionBreakpoints") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        const Json requested = params.contains("breakpoints") && params.at("breakpoints").is_array()
                                   ? params.at("breakpoints")
                                   : Json::array();
        session.set_function_breakpoints(requested, answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    // DAP `source`（IDEA 的「下载源代码」/适配器动态生成的源）：按 `sourceReference` 取内容，
    // 是 `file.read` 在调试侧的等价物。规范里 sourceReference 与 source 二者至少给一个。
    if (method == "dap.source") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        const auto reference = long_of(params, "sourceReference", 0);
        const auto path = params.value("path", std::string());
        if (reference <= 0 && path.empty())
            throw WorkspaceError("INVALID_REQUEST", "取源内容需要 sourceReference 或 path 之一。");
        session.source(reference, path, answer_to(host, id));
        return RouteOutcome::answered_async;
    }

    // --- 执行控制 -------------------------------------------------------------

    if (method == "dap.continue" || method == "dap.pause" || method == "dap.next" || method == "dap.stepIn" ||
        method == "dap.stepOut" || method == "dap.stepBack" || method == "dap.reverseContinue") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        const auto thread = long_of(params, "threadId", 1);
        const auto cb = answer_to(host, id);
        if (method == "dap.continue") session.continue_execution(thread, params.value("all", false), cb);
        else if (method == "dap.pause") session.pause(thread, cb);
        else if (method == "dap.next") session.next(thread, cb);
        else if (method == "dap.stepIn") session.step_in(thread, cb);
        else if (method == "dap.stepOut") session.step_out(thread, cb);
        else if (method == "dap.stepBack") session.step_back(thread, cb);
        else session.reverse_continue(thread, cb);
        return RouteOutcome::answered_async;
    }
    // IDEA 的「运行到光标处」（Alt+F9）：先 gotoTargets 问目标，再 goto 跳过去。
    if (method == "dap.gotoTargets") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        session.goto_targets(params.value("path", std::string()), long_of(params, "line", 1),
                             long_of(params, "column", 0), answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    if (method == "dap.goto") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        session.goto_target(long_of(params, "threadId", 1), long_of(params, "targetId", 0), answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    // IDEA Frames 视图的「丢弃帧」。
    if (method == "dap.restartFrame") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        session.restart_frame(long_of(params, "frameId", 0), answer_to(host, id));
        return RouteOutcome::answered_async;
    }

    // --- 栈 / 变量 / 求值 ------------------------------------------------------

    if (method == "dap.stackTrace" || method == "dap.scopes" || method == "dap.variables") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        const auto cb = answer_to(host, id);
        if (method == "dap.stackTrace")
            // `startFrame`/`levels` 是 DAP 的分页字段（规范里都可选，<= 0 = 不指定）。
            session.stack_trace(long_of(params, "threadId", 1), long_of(params, "startFrame", 0),
                                long_of(params, "levels", 0), cb);
        else if (method == "dap.scopes") session.scopes(long_of(params, "frameId", 0), cb);
        else
            // `start`/`count` 是 DAP `variables` 的分页字段（大数组一次只取一页）。
            session.variables(long_of(params, "reference", 0), long_of(params, "start", 0),
                              long_of(params, "count", 0), cb);
        return RouteOutcome::answered_async;
    }
    // IDEA 的 XValue.setValue（Variables 树里改值）与 Watches 视图的「Set Value」。
    if (method == "dap.setVariable" || method == "dap.setExpression") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        const auto cb = answer_to(host, id);
        const auto value = params.value("value", std::string());
        if (method == "dap.setVariable") {
            const auto name = params.value("name", std::string());
            if (name.empty()) throw WorkspaceError("INVALID_REQUEST", "setVariable 需要变量名。");
            session.set_variable(long_of(params, "reference", 0), name, value, cb);
        } else {
            const auto expression = params.value("expression", std::string());
            if (expression.empty()) throw WorkspaceError("INVALID_REQUEST", "setExpression 需要表达式。");
            session.set_expression(expression, value, long_of(params, "frameId", 0), cb);
        }
        return RouteOutcome::answered_async;
    }
    if (method == "dap.evaluate") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        // 走 `Client::evaluate`（dap_values.cpp）：`context` 原样透传（规范里的 watch/repl/hover/
        // variables/clipboard），回参整形出可展开的 `reference`/`variablesReference` 与
        // `namedVariables`/`indexedVariables`，前端才能用 `dap.variables` 那套继续展开。
        session.evaluate(params.value("expression", std::string()), params.value("context", std::string("hover")),
                         long_of(params, "frameId", 0), answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    if (method == "dap.exceptionInfo") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        session.exception_details(long_of(params, "threadId", 1), answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    if (method == "dap.completions") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        const auto text = params.value("text", std::string());
        if (text.empty()) throw WorkspaceError("INVALID_REQUEST", "补全需要一段表达式文本。");
        // 规范里 `column` 是 **1 基**（"The position within `text` ... (1-based)"），
        // 所以缺省值是"光标在末尾"= length + 1，不是 length。
        session.completions(text, static_cast<long>(params.value("column", text.size() + 1)),
                            long_of(params, "frameId", 0), long_of(params, "line", 0), answer_to(host, id));
        return RouteOutcome::answered_async;
    }

    // --- 线程 / 清单重取 / 内存 ------------------------------------------------

    if (method == "dap.threads") {
        host.route_client().threads(answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    // 事件通道只推增量（loadedSource/module 事件）；这两条是"按需重取整份清单"的主动通道。
    if (method == "dap.loadedSources") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        session.loaded_sources(answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    if (method == "dap.modules") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        session.modules(long_of(params, "startModule", 0), long_of(params, "moduleCount", 0), answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    if (method == "dap.readMemory") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        const auto reference = params.value("memoryReference", std::string());
        if (reference.empty()) throw WorkspaceError("INVALID_REQUEST", "读取内存需要一个 memoryReference。");
        const auto count = long_of(params, "count", 0);
        if (count <= 0) throw WorkspaceError("INVALID_REQUEST", "读取内存需要一个正整数的 count。");
        session.read_memory(reference, long_of(params, "offset", 0), count, answer_to(host, id));
        return RouteOutcome::answered_async;
    }
    if (method == "dap.disassemble") {
        auto& session = host.route_client();
        if (!session.running()) throw WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
        const auto reference = params.value("memoryReference", std::string());
        if (reference.empty()) throw WorkspaceError("INVALID_REQUEST", "反汇编需要一个 memoryReference。");
        const auto instruction_count = long_of(params, "instructionCount", 0);
        if (instruction_count <= 0) throw WorkspaceError("INVALID_REQUEST", "反汇编需要一个正整数的 instructionCount。");
        session.disassemble(reference, long_of(params, "offset", 0), long_of(params, "instructionOffset", 0),
                            instruction_count, params.value("resolveSymbols", false), answer_to(host, id));
        return RouteOutcome::answered_async;
    }

    // 以 `dap.` 开头却不认识：与 main.cpp 的 default 同一种错误。
    throw WorkspaceError("UNKNOWN_METHOD", "该原生方法未开放");
}

}  // namespace dap
}  // namespace taocode
