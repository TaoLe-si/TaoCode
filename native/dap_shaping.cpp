// DAP 响应的形状整形（见 dap_shaping.hpp 的说明）。会话/管道/reader 机制仍在 native/dap.cpp。
//
// 2026-10-05 从 native/dap.cpp 整段搬出（dap.cpp 贴着 1790 行机检上限，只剩 3 行余量）。
// 搬动时**实现一个字没改**：下面 317 行与 dap.cpp 里原来的逐字相同，只把三个 json helper
// （text_of / int_of / bool_of / as_object）按 dap_inspect.cpp 的同一做法在本 TU 内自带一份
// —— 匿名命名空间，两个 TU 各一份互不干扰，也不用为四个 1 行的取字段函数开一个共享头。

#include "dap_shaping.hpp"

#include <algorithm>
#include <cstdint>
#include <string>
#include <utility>

namespace taocode {
namespace dap {
namespace {

// ---------------------------------------------------------------- json helpers ---
// 与 dap.cpp / dap_inspect.cpp 的同名 helper 逐字一致（各 TU 自带一份，不共享）。

std::string text_of(const Json& object, const char* key) {
    if (object.is_object() && object.contains(key) && object.at(key).is_string()) return object.at(key).get<std::string>();
    return {};
}

std::int64_t int_of(const Json& object, const char* key, std::int64_t fallback) {
    if (object.is_object() && object.contains(key) && object.at(key).is_number_integer())
        return object.at(key).get<std::int64_t>();
    return fallback;
}

bool bool_of(const Json& object, const char* key, bool fallback) {
    if (object.is_object() && object.contains(key) && object.at(key).is_boolean()) return object.at(key).get<bool>();
    return fallback;
}

const Json& as_object(const Json& value) {
    static const Json empty = Json::object();
    return value.is_object() ? value : empty;
}

}  // namespace

// shape_exception_details 仍是本 TU 私有的：它只被 shape_exception_info 用（递归自嵌套），
// 所以不往头里露。其它十一个整形函数是 dap.cpp 那一层要调的，所以都进了头。

Json shape_event(const std::string& name, const Json& body) {
    Json event{{"event", name}};
    const Json& source = as_object(body);
    if (name == "stopped") {
        // {event:"stopped", reason, threadId, text?, allThreadsStopped?, preserveFocusHint?,
        //  hitBreakpointIds?}。后三个是规范里的可选字段，UI 用得上：
        //   · allThreadsStopped 决定"全部线程都停了吗"（多线程视图据此标灰）；
        //   · preserveFocusHint 是适配器请求"别抢焦点"（命中日志断点时）；
        //   · hitBreakpointIds 直接给出命中的断点 id，不用再猜是哪一条。
        event["reason"] = text_of(source, "reason");
        event["threadId"] = int_of(source, "threadId", 0);
        const auto text = text_of(source, "text");
        if (!text.empty()) event["text"] = text;
        if (source.contains("allThreadsStopped") && source.at("allThreadsStopped").is_boolean())
            event["allThreadsStopped"] = source.at("allThreadsStopped");
        if (source.contains("preserveFocusHint") && source.at("preserveFocusHint").is_boolean())
            event["preserveFocusHint"] = source.at("preserveFocusHint");
        if (source.contains("hitBreakpointIds") && source.at("hitBreakpointIds").is_array())
            event["hitBreakpointIds"] = source.at("hitBreakpointIds");
    } else if (name == "continued") {
        // {event:"continued", threadId?, allThreadsContinued?, preserveFocusHint?}。
        // 规范里 `continued` 的 threadId 是**可选**的（省略 = 全部线程恢复），
        // 前端 `DapEvent` 读的就是顶层 `threadId`，所以这里把它抬到顶层（原来只丢进 body）。
        const auto thread = int_of(source, "threadId", 0);
        if (thread > 0) event["threadId"] = thread;
        if (source.contains("allThreadsContinued") && source.at("allThreadsContinued").is_boolean())
            event["allThreadsContinued"] = source.at("allThreadsContinued");
        if (source.contains("preserveFocusHint") && source.at("preserveFocusHint").is_boolean())
            event["preserveFocusHint"] = source.at("preserveFocusHint");
        event["body"] = source;
    } else if (name == "thread") {
        // {event:"thread", reason:"started"|"exited", threadId}。前端同时读顶层与 body，
        // 这里两个都写（顶层是给 `applyDapThread` 的直读路径，body 保留适配器原样）。
        event["reason"] = text_of(source, "reason");
        const auto thread = int_of(source, "threadId", 0);
        if (thread > 0) event["threadId"] = thread;
        event["body"] = source;
    } else if (name == "output") {
        // {event:"output", category, text} — DAP names the field `output`.
        // `source`/`line`/`column`（规范可选）让控制台能把一条输出变成可跳转的位置
        // （编译错误的 `file:line` 链接，见 src/runIssues.ts 的同一种做法）。
        auto category = text_of(source, "category");
        if (category.empty()) category = "console";
        auto text = text_of(source, "output");
        if (text.empty()) text = text_of(source, "text");
        event["category"] = std::move(category);
        event["text"] = std::move(text);
        if (source.contains("source") && source.at("source").is_object()) {
            const auto path = text_of(source.at("source"), "path");
            if (!path.empty()) event["rawPath"] = path;  // 统一在 handle() 里映射成工作区相对路径
        }
        const auto group = text_of(source, "group");
        if (!group.empty()) event["group"] = group;
        for (const char* key : {"line", "column"}) {
            const auto number = int_of(source, key, 0);
            if (number > 0) event[key] = number;
        }
    } else if (name == "breakpoint") {
        // {event:"breakpoint", verified, line?, path?, id?}
        const Json& point =
            source.contains("breakpoint") && source.at("breakpoint").is_object() ? source.at("breakpoint") : source;
        // DAP's optional Breakpoint id: it is how an adapter says *which* breakpoint
        // moved (or was set outside the IDE), so the UI must not have to guess.
        if (point.contains("id") && (point.at("id").is_number() || point.at("id").is_string()))
            event["id"] = point.at("id");
        event["verified"] = bool_of(point, "verified", false);
        if (point.contains("line") && point.at("line").is_number_integer()) event["line"] = point.at("line").get<std::int64_t>();
        const auto path = text_of(point, "path");
        if (!path.empty() && int_of(point, "sourceReference", 0) == 0) event["rawPath"] = path;
    } else if (name == "terminated") {
        // {event:"terminated", restartable?}
        if (source.contains("restartable")) event["restartable"] = bool_of(source, "restartable", false);
    } else if (name == "exited") {
        // {event:"exited", exitCode} — the debuggee's own exit status, which the
        // debugger console shows instead of a bare "session ended".
        event["exitCode"] = int_of(source, "exitCode", 0);
    } else if (name == "module") {
        // {event:"module", reason, module:{id, name}, path?}
        const Json& module = source.contains("module") && source.at("module").is_object() ? source.at("module") : source;
        event["reason"] = text_of(source, "reason");
        Json shaped{{"id", int_of(module, "id", 0)}, {"name", text_of(module, "name")}};
        const auto type = text_of(module, "type");
        if (!type.empty()) shaped["type"] = type;
        if (int_of(module, "sourceReference", 0) != 0) shaped["sourceReference"] = int_of(module, "sourceReference", 0);
        event["module"] = std::move(shaped);
        const auto path = text_of(module, "path");
        if (!path.empty()) event["rawPath"] = path;
    } else if (name == "loadedSource") {
        // {event:"loadedSource", reason, source:{name, sourceReference}, path?}
        const Json& loaded = source.contains("source") && source.at("source").is_object() ? source.at("source") : source;
        event["reason"] = text_of(source, "reason");
        Json shaped{{"name", text_of(loaded, "name")}, {"sourceReference", int_of(loaded, "sourceReference", 0)}};
        event["source"] = std::move(shaped);
        const auto path = text_of(loaded, "path");
        if (!path.empty()) event["rawPath"] = path;
    } else if (name == "progressStart" || name == "progressUpdate" || name == "progressEnd") {
        // {event:"progress", phase, progressId, title?, message?, percentage?} —
        // the three DAP progress events collapse into the one shape the UI polls.
        event["event"] = "progress";
        event["phase"] = name == "progressStart" ? "start" : name == "progressUpdate" ? "update" : "end";
        event["progressId"] = text_of(source, "progressId");
        const auto title = text_of(source, "title");
        if (!title.empty()) event["title"] = title;
        const auto message = text_of(source, "message");
        if (!message.empty()) event["message"] = message;
        if (source.contains("percentage") && source.at("percentage").is_number())
            event["percentage"] = source.at("percentage");
    } else {
        // Everything else (continued, thread, capability, invalidated,
        // loadedSources, memory, ...) forwards the raw body so the UI can still
        // react to adapter-specific events.
        event["body"] = source;
    }
    return event;
}

Json shape_frames(const Client& client, const Json& body) {
    Json frames = Json::array();
    const Json& envelope = as_object(body);
    if (!envelope.contains("stackFrames") || !envelope.at("stackFrames").is_array())
        return Json{{"frames", std::move(frames)}, {"totalFrames", 0}};
    for (const Json& frame : envelope.at("stackFrames")) {
        const Json& item = as_object(frame);
        Json shaped{{"id", int_of(item, "id", 0)},
                    {"name", text_of(item, "name")},
                    {"line", int_of(item, "line", 0)},       // 1-based, straight from DAP
                    {"column", int_of(item, "column", 0)}};  // 1-based, straight from DAP
        // Copy, not a reference: `value()` returns a prvalue that would otherwise
        // die before `path` is read.
        const Json source = item.contains("source") && item.at("source").is_object() ? item.at("source") : Json::object();
        auto path = text_of(source, "path");
        if (path.empty()) path = text_of(item, "path");
        if (!path.empty()) {
            shaped["path"] = client.to_path(path);
            const auto name = text_of(source, "name");
            if (!name.empty()) shaped["sourceName"] = name;
            const auto reference = int_of(source, "sourceReference", 0);
            if (reference != 0) shaped["sourceReference"] = reference;
        }
        if (item.contains("presentationHint") && item.at("presentationHint").is_string())
            shaped["presentationHint"] = item.at("presentationHint");
        frames.push_back(std::move(shaped));
    }
    // Some adapters under-report totalFrames; never claim fewer than we deliver.
    const auto count = static_cast<std::int64_t>(frames.size());
    const auto total = std::max(count, int_of(envelope, "totalFrames", count));
    return Json{{"frames", std::move(frames)}, {"totalFrames", total}};
}

Json shape_scopes(const Json& body) {
    Json scopes = Json::array();
    const Json& envelope = as_object(body);
    if (envelope.contains("scopes") && envelope.at("scopes").is_array())
        for (const Json& scope : envelope.at("scopes")) {
            const Json& item = as_object(scope);
            const auto reference = int_of(item, "variablesReference", 0);
            Json shaped{{"name", text_of(item, "name")},
                        {"reference", reference},
                        {"variablesReference", reference},
                        {"expensive", bool_of(item, "expensive", false)}};
            // `namedVariables`/`indexedVariables`（规范可选）：作用域里有多少具名/下标子项 ——
            // UI 据此决定要不要分页取（大数组一次拉几千条会把桥堵住）。缺字段不写键。
            for (const char* key : {"namedVariables", "indexedVariables"}) {
                if (item.contains(key) && item.at(key).is_number_integer()) shaped[key] = item.at(key);
            }
            scopes.push_back(std::move(shaped));
        }
    return Json{{"scopes", std::move(scopes)}};
}

// 一条变量的公共形状：`shape_variables` / `shape_set_variable` / `shape_evaluate` 三个
// 消费点必须逐字段一致（前端用同一套渲染），所以只在这里写一次。
// `namedVariables`/`indexedVariables`（规范可选）是分页依据：适配器靠它们说"这个引用下
// 还有多少个具名/下标子项"，UI 据此决定要不要发 `variables{start,count}` 取下一页。
namespace {
Json shape_one_variable(const Json& value) {
    const Json& item = as_object(value);
    const auto reference = int_of(item, "variablesReference", 0);
    Json shaped{{"name", text_of(item, "name")},
                {"value", text_of(item, "value")},
                {"reference", reference},
                {"variablesReference", reference},
                {"named", reference > 0 || int_of(item, "namedVariables", 0) > 0}};
    const auto type = text_of(item, "type");
    if (!type.empty()) shaped["type"] = type;
    const auto evaluate_as = text_of(item, "evaluateName");
    if (!evaluate_as.empty()) shaped["evaluateName"] = evaluate_as;
    for (const char* key : {"namedVariables", "indexedVariables"}) {
        if (item.contains(key) && item.at(key).is_number_integer()) shaped[key] = item.at(key);
    }
    return shaped;
}
}  // namespace

Json shape_variables(const Json& body) {
    Json variables = Json::array();
    const Json& envelope = as_object(body);
    if (envelope.contains("variables") && envelope.at("variables").is_array())
        for (const Json& value : envelope.at("variables")) variables.push_back(shape_one_variable(value));
    return Json{{"variables", std::move(variables)}};
}

// `evaluate` -> {result, type?, reference, variablesReference, named, namedVariables?, indexedVariables?}。
// 规范里 `result` 是必填；`variablesReference` 是"这个结果能不能展开"的句柄。
// 前端已有的 `DapEvaluateResult`（src/bridge.ts）读 `result`/`type`/`variablesReference`，
// 这里保留这三个键，同时补上变量那一套的 `reference`/`named`，让展开结果能直接用
// `dap.variables` 的渲染与分页。
Json shape_evaluate(const Json& body) {
    const Json& item = as_object(body);
    const auto reference = int_of(item, "variablesReference", 0);
    Json shaped{{"result", text_of(item, "result")},
                {"reference", reference},
                {"variablesReference", reference},
                {"named", reference > 0 || int_of(item, "namedVariables", 0) > 0}};
    const auto type = text_of(item, "type");
    if (!type.empty()) shaped["type"] = type;
    for (const char* key : {"namedVariables", "indexedVariables"}) {
        if (item.contains(key) && item.at(key).is_number_integer()) shaped[key] = item.at(key);
    }
    return shaped;
}

// `setVariable` / `setExpression` / `evaluate` 的响应都是"一条变量的新值"（规范里
// setVariable/setExpression 没有 `variables` 数组，evaluate 是 result 字符串），
// 字段与 shape_variables 里的一条保持一致，前端才能用同一套渲染。
Json shape_set_variable(const Json& body) { return shape_one_variable(body); }

// `exceptionInfo` 的可选 details。`innerException` 是 cause 链，规范允许递归嵌套，
// 所以这个整形函数本身是递归的 —— 深度由适配器决定，这里只保证每一层的形状一致
// （缺字段就不写键，前端拿不到键就不会渲染空行）。
// 唯一不往 dap_shaping.hpp 里露的一个：它只被下面的 shape_exception_info 用（连同自递归），
// 所以留在匿名命名空间里，外部连符号都看不见。
namespace {
Json shape_exception_details(const Json& details) {
    const Json& item = as_object(details);
    Json shaped = Json::object();
    for (const char* key : {"message", "typeName", "fullTypeName", "evaluateName", "stackTrace"}) {
        const auto value = text_of(item, key);
        if (!value.empty()) shaped[key] = value;
    }
    if (item.contains("innerException") && item.at("innerException").is_array()) {
        Json inner = Json::array();
        for (const auto& nested : item.at("innerException")) inner.push_back(shape_exception_details(nested));
        if (!inner.empty()) shaped["innerException"] = std::move(inner);
    }
    return shaped;
}
}  // namespace

// `exceptionInfo` -> {available, exceptionId, description, breakMode, details?}。
// `description` 与 `exceptionId` 是规范里的必填项：两者都空说明适配器其实没答上来
// （或这个线程根本没有异常），这时回 available:false，而不是让 UI 显示一张空卡片。
Json shape_exception_info(const Json& body) {
    const Json& item = as_object(body);
    const auto exception_id = text_of(item, "exceptionId");
    const auto description = text_of(item, "description");
    if (exception_id.empty() && description.empty()) return Json{{"available", false}};
    Json shaped{{"available", true},
                {"exceptionId", exception_id},
                {"description", description},
                {"breakMode", text_of(item, "breakMode")}};
    if (item.contains("details") && item.at("details").is_object()) {
        const auto details = shape_exception_details(item.at("details"));
        if (!details.empty()) shaped["details"] = details;
    }
    return shaped;
}

// `breakpointLocations` -> {available, locations:[{line, column?, endLine?, endColumn?}]}。
// **空数组是有意义的答案**（IDEA 的 "Cannot find appropriate breakpoint type"），所以
// `available` 只表示"适配器答了"，"这一行能不能放"由 locations 是否为空表达 ——
// 把空数组当成错误上报，UI 就没法区分"这行没有可执行代码"和"请求失败了"。
// 可选字段 <= 0 时不写键：规范里它们是可选的，写个 0 会让人以为"第 0 列"。
Json shape_breakpoint_locations(const Json& body) {
    Json locations = Json::array();
    const Json& envelope = as_object(body);
    if (envelope.contains("breakpoints") && envelope.at("breakpoints").is_array())
        for (const auto& point : envelope.at("breakpoints")) {
            const Json& item = as_object(point);
            Json shaped{{"line", int_of(item, "line", 0)}};
            for (const char* key : {"column", "endLine", "endColumn"}) {
                const auto value = int_of(item, key, 0);
                if (value > 0) shaped[key] = value;
            }
            locations.push_back(std::move(shaped));
        }
    return Json{{"available", true}, {"locations", std::move(locations)}};
}

// `completions` -> {available, items:[{label, text?, type?, start?, length?}]}。
// `start`/`length` 是**在请求文本里的替换区间**（规范里可选）：给了它，客户端才知道插入补全项时
// 该替换哪一段；没给就按"整段替换"处理。所以这两个键要么一起出要么都不出 —— 只给一个是畸形，
// 前端按"整段替换"降级比按一个误导性的 start 去切字符串安全。
Json shape_completions(const Json& body) {
    Json items = Json::array();
    const Json& envelope = as_object(body);
    if (envelope.contains("targets") && envelope.at("targets").is_array())
        for (const auto& entry : envelope.at("targets")) {
            const Json& item = as_object(entry);
            const auto label = text_of(item, "label");
            if (label.empty()) continue;   // 没有 label 的项在 UI 里无法显示，也选不中
            Json shaped{{"label", label}};
            const auto insert = text_of(item, "text");
            if (!insert.empty()) shaped["text"] = insert;
            const auto type = text_of(item, "type");
            if (!type.empty()) shaped["type"] = type;
            const auto start = int_of(item, "start", -1);
            const auto length = int_of(item, "length", -1);
            if (start >= 0 && length > 0) { shaped["start"] = start; shaped["length"] = length; }
            items.push_back(std::move(shaped));
        }
    if (items.empty()) return Json{{"available", false}};
    return Json{{"available", true}, {"items", std::move(items)}};
}

// The adapter is authoritative about *verification*, and the line it reports (a
// breakpoint may slide to the next real statement) is what the gutter must show.
Json verified_lines(const Json& body, const std::vector<int>& requested) {
    Json lines = Json::array();
    const Json& envelope = as_object(body);
    if (!envelope.contains("breakpoints") || !envelope.at("breakpoints").is_array()) return lines;
    const Json& points = envelope.at("breakpoints");
    for (std::size_t index = 0; index != points.size(); ++index) {
        const Json& item = as_object(points[index]);
        if (!bool_of(item, "verified", false)) continue;
        const auto fallback = index < requested.size() ? static_cast<std::int64_t>(requested[index]) : 0;
        lines.push_back(int_of(item, "line", fallback));
    }
    return lines;
}

// Keep only what DAP understands: a 1-based line, plus whichever of the optional
// attributes the user actually filled in. An empty `condition` is sent as "no
// condition" by omitting it — adapters treat "" and absent differently.
Json normalize_breakpoints(const Json& requested) {
    Json points = Json::array();
    if (!requested.is_array()) return points;
    for (const auto& item : requested) {
        const Json& entry = as_object(item);
        const auto line = int_of(entry, "line", 0);
        if (line < 1) continue;
        Json point{{"line", line}};
        for (const char* key : {"condition", "hitCondition", "logMessage"}) {
            const auto value = text_of(entry, key);
            if (!value.empty()) point[key] = value;
        }
        points.push_back(std::move(point));
    }
    return points;
}

std::vector<int> requested_lines(const Json& points) {
    std::vector<int> lines;
    if (!points.is_array()) return lines;
    for (const auto& item : points) lines.push_back(static_cast<int>(int_of(as_object(item), "line", 0)));
    return lines;
}

// Breakpoints the adapter answered with an explanation for (an invalid condition, a
// moved line). The UI shows these next to the marker, like IDEA's gutter popup.
Json breakpoint_messages(const Json& body) {
    Json notes = Json::array();
    const Json& envelope = as_object(body);
    if (!envelope.contains("breakpoints") || !envelope.at("breakpoints").is_array()) return notes;
    for (const auto& item : envelope.at("breakpoints")) {
        const Json& point = as_object(item);
        const auto message = text_of(point, "message");
        if (message.empty()) continue;
        notes.push_back(Json{{"line", int_of(point, "line", 0)}, {"message", message}});
    }
    return notes;
}

Json shape_goto_targets(const Json& body) {
    Json targets = Json::array();
    const Json& envelope = as_object(body);
    if (envelope.contains("targets") && envelope.at("targets").is_array())
        for (const Json& value : envelope.at("targets")) {
            const Json& item = as_object(value);
            if (!item.contains("id") || !item.at("id").is_number_integer()) continue;
            const auto line = int_of(item, "line", 0);
            Json shaped{{"id", item.at("id")}, {"line", line}, {"label", text_of(item, "label")}};
            if (item.contains("column")) shaped["column"] = int_of(item, "column", 0);
            // 适配器给的 endLine/endColumn 用不上（IDEA 也只用行），但保留它的存在便于前端提示。
            if (item.contains("endLine")) shaped["endLine"] = int_of(item, "endLine", 0);
            targets.push_back(std::move(shaped));
        }
    return Json{{"targets", std::move(targets)}};
}

}  // namespace dap
}  // namespace taocode
