// DAP 请求族：**取值**（stackTrace / scopes / variables / setVariable / setExpression /
// evaluate / exceptionInfo）、**补全与断点位置**（completions / breakpointLocations）、
// **数据与函数断点**（dataBreakpoints / setDataBreakpoints / setFunctionBreakpoints）、
// **按 sourceReference 取源内容**（source）。
//
// 2026-10-06 从 native/dap.cpp 整段搬出：dap.cpp 贴着机检 1480 行上限，而这一族只做
// "取一个值 / 装一个断点 + 把它整形成 UI 认的形状"，与会话、管道、reader、请求发信
// （仍全在 dap.cpp）不共一个职责域。搬动时实现逐字未改，只在本 TU 自带一份 json helper
// 与 shaped/wrap_ok（与 dap.cpp / dap_inspect.cpp 同一种做法：匿名命名空间各一份，不共享头）。
//
// 本轮同时补齐协议侧的三条缺口（都在本文件）：
//   · `stackTrace` 的 `startFrame`/`levels`、`variables` 的 `start`/`count` 分页；
//   · `evaluate` 的规范字段（`context` 原样透传，回参整形出可展开的 variablesReference）；
//   · `dataBreakpoints`/`setDataBreakpoints`/`setFunctionBreakpoints`/`source` 四条请求
//     （能力位都**默认 false**，未声明回 `DAP_UNSUPPORTED`）。
//
// 三条共同的协议口径（与 dap_inspect.cpp 完全一致）：
//   · 每个请求先过能力位；规范里这些位默认 false，没声明的适配器回 `DAP_UNSUPPORTED`；
//   · 整形把规范字段拍平，**缺字段不造空值**，可选数值 <= 0 不写键；
//   · 路径统一走 `Client::to_path`（工作区相对 '/'，工作区外原样规范化）。

#include "dap.hpp"
#include "dap_shaping.hpp"

#include <algorithm>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>

namespace taocode {
namespace dap {
namespace {

// ------------------------------------------------------------ json helpers ---
// 与 dap.cpp / dap_inspect.cpp 的同名 helper 逐字一致（各 TU 自带一份，不共享）。

// `\\` -> `/` 并把末尾多余的 `/` 收掉：与 dap.cpp 的同名函数逐字一致（各 TU 一份，
// 因为它在 dap.cpp 的匿名命名空间里，不共享头也不导出符号）。
std::string slash_form(std::string value) {
    std::replace(value.begin(), value.end(), '\\', '/');
    while (value.size() > 1 && value.ends_with('/')) value.pop_back();
    return value;
}

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

Client::Reply shaped(Client::Reply handler, std::function<Json(const Json&)> reshape) {
    if (!handler) return {};
    return [handler = std::move(handler), reshape = std::move(reshape)](Json body, Json error) {
        if (!error.is_null()) { handler(Json(nullptr), std::move(error)); return; }
        handler(reshape(body), Json(nullptr));
    };
}

Client::Reply wrap_ok(Client::Reply handler) {
    if (!handler) return {};
    return [handler = std::move(handler)](Json body, Json error) {
        if (!error.is_null()) { handler(Json(nullptr), std::move(error)); return; }
        Json result{{"ok", true}};
        const Json& envelope = as_object(body);
        if (envelope.contains("allThreadsContinued")) result["allThreadsContinued"] = envelope.at("allThreadsContinued");
        handler(std::move(result), Json(nullptr));
    };
}

Json unsupported(std::string_view capability, std::string_view what) {
    return Json{{"code", "DAP_UNSUPPORTED"},
                {"message", "适配器未声明 " + std::string(capability) + "，" + std::string(what)}};
}

// ------------------------------------------------------------- reshaping ---

// `dataBreakpoints` -> {available, breakpoints:[{id?, dataId, accessType?, label, description?}]}。
// `dataId` 是规范必填（没有它就装不上这个断点），`label` 是显示用的；两者缺一即丢弃。
// **空数组是有意义的答案**（这个会话没有可观察的数据位置），与 breakpointLocations 同一种口径。
Json shape_data_breakpoints(const Json& body) {
    Json points = Json::array();
    const Json& envelope = as_object(body);
    if (envelope.contains("breakpoints") && envelope.at("breakpoints").is_array())
        for (const auto& value : envelope.at("breakpoints")) {
            const Json& item = as_object(value);
            const auto data_id = text_of(item, "dataId");
            const auto label = text_of(item, "label");
            if (data_id.empty() || label.empty()) continue;
            Json shaped_item{{"dataId", data_id}, {"label", label}};
            const auto access = text_of(item, "accessType");
            if (!access.empty()) shaped_item["accessType"] = access;
            const auto description = text_of(item, "description");
            if (!description.empty()) shaped_item["description"] = description;
            if (item.contains("id") && (item.at("id").is_number() || item.at("id").is_string()))
                shaped_item["id"] = item.at("id");
            points.push_back(std::move(shaped_item));
        }
    return Json{{"available", true}, {"breakpoints", std::move(points)}};
}

// 一条已装断点的公共形状（setDataBreakpoints / setFunctionBreakpoints 的响应条目）：
// `verified` 是规范必填（适配器认不认这个断点），id/line/message 是可选的回执。
Json shape_installed_breakpoint(const Json& value) {
    const Json& item = as_object(value);
    Json shaped_item{{"verified", bool_of(item, "verified", false)}};
    if (item.contains("id") && (item.at("id").is_number() || item.at("id").is_string())) shaped_item["id"] = item.at("id");
    const auto line = int_of(item, "line", 0);
    if (line > 0) shaped_item["line"] = line;
    const auto column = int_of(item, "column", 0);
    if (column > 0) shaped_item["column"] = column;
    for (const char* key : {"message", "name", "dataId"}) {
        const auto text = text_of(item, key);
        if (!text.empty()) shaped_item[key] = text;
    }
    return shaped_item;
}

// `setDataBreakpoints` / `setFunctionBreakpoints` -> {breakpoints:[...]}。
Json shape_breakpoint_list(const Json& body) {
    Json points = Json::array();
    const Json& envelope = as_object(body);
    if (envelope.contains("breakpoints") && envelope.at("breakpoints").is_array())
        for (const auto& value : envelope.at("breakpoints")) points.push_back(shape_installed_breakpoint(value));
    return Json{{"breakpoints", std::move(points)}};
}

// `source` -> {available, content?, mimeType?}。`content` 空 = 适配器没给内容（不是"空文件"），
// 回 available:false 而不是让 UI 显示一张空白页。
Json shape_source(const Json& body) {
    const Json& item = as_object(body);
    const auto content = text_of(item, "content");
    if (content.empty()) return Json{{"available", false}};
    Json shaped_item{{"available", true}, {"content", content}};
    const auto mime = text_of(item, "mimeType");
    if (!mime.empty()) shaped_item["mimeType"] = mime;
    return shaped_item;
}

// 只留 DAP 认的字段：dataId/name 必填，可选条件与访问类型缺了就不写键。
// `accessType` 规范里只允许 read/write/readWrite，别的值当"没填"丢掉（发一个非法枚举
// 会让整个 setDataBreakpoints 失败，而不是只忽略那一条）。
Json normalize_data_breakpoints(const Json& requested) {
    Json points = Json::array();
    if (!requested.is_array()) return points;
    for (const auto& value : requested) {
        const Json& item = as_object(value);
        const auto data_id = text_of(item, "dataId");
        if (data_id.empty()) continue;
        Json point{{"dataId", data_id}};
        const auto access = text_of(item, "accessType");
        if (access == "read" || access == "write" || access == "readWrite") point["accessType"] = access;
        for (const char* key : {"condition", "hitCondition"}) {
            const auto text = text_of(item, key);
            if (!text.empty()) point[key] = text;
        }
        points.push_back(std::move(point));
    }
    return points;
}

Json normalize_function_breakpoints(const Json& requested) {
    Json points = Json::array();
    if (!requested.is_array()) return points;
    for (const auto& value : requested) {
        const Json& item = as_object(value);
        const auto name = text_of(item, "name");
        if (name.empty()) continue;
        Json point{{"name", name}};
        for (const char* key : {"condition", "hitCondition"}) {
            const auto text = text_of(item, key);
            if (!text.empty()) point[key] = text;
        }
        points.push_back(std::move(point));
    }
    return points;
}

}  // namespace

// ------------------------------------------------------------- requests ---

void Client::stack_trace(long thread_id, Reply on_reply) {
    stack_trace(thread_id, 0, 0, std::move(on_reply));
}

void Client::stack_trace(long thread_id, long start_frame, long levels, Reply on_reply) {
    Json arguments{{"threadId", thread_id}};
    // 规范里 startFrame/levels 都可选：省略 = 从第 0 帧起 / 返回全部。写 0 会被适配器
    // 当成"第 0 帧"这个具体值（levels 为 0 更是"要 0 条"），与"不指定"是两回事。
    if (start_frame > 0) arguments["startFrame"] = start_frame;
    if (levels > 0) arguments["levels"] = levels;
    send("stackTrace", std::move(arguments),
         shaped(std::move(on_reply), [this](const Json& body) { return shape_frames(*this, body); }));
}

void Client::scopes(long frame_id, Reply on_reply) {
    send("scopes", Json{{"frameId", frame_id}}, shaped(std::move(on_reply), [](const Json& body) { return shape_scopes(body); }));
}

void Client::variables(long variables_reference, Reply on_reply) {
    variables(variables_reference, 0, 0, std::move(on_reply));
}

void Client::variables(long variables_reference, long start, long count, Reply on_reply) {
    Json arguments{{"variablesReference", variables_reference}};
    // `start`/`count` <= 0 不发：省略 = 从第 0 项起 / 返回全部（规范 "Variables Request"）。
    if (start > 0) arguments["start"] = start;
    if (count > 0) arguments["count"] = count;
    send("variables", std::move(arguments),
         shaped(std::move(on_reply), [](const Json& body) { return shape_variables(body); }));
}

void Client::set_variable(long variables_reference, const std::string& name, const std::string& value, Reply on_reply) {
    send("setVariable", Json{{"variablesReference", variables_reference}, {"name", name}, {"value", value}},
         shaped(std::move(on_reply), [](const Json& body) { return shape_set_variable(body); }));
}

void Client::set_expression(const std::string& expression, const std::string& value, long frame_id, Reply on_reply) {
    Json arguments{{"expression", expression}, {"value", value}};
    // frameId 在规范里是可选的：0 表示不指定栈帧（全局表达式）。
    if (frame_id > 0) arguments["frameId"] = frame_id;
    send("setExpression", std::move(arguments),
         shaped(std::move(on_reply), [](const Json& body) { return shape_set_variable(body); }));
}

void Client::evaluate(const std::string& expression, const std::string& context, long frame_id, Reply on_reply) {
    Json arguments{{"expression", expression}};
    // `context` 规范默认 `repl`，但空串会被适配器当成一个**具体的上下文名**，所以缺省时不发。
    if (!context.empty()) arguments["context"] = context;
    if (frame_id > 0) arguments["frameId"] = frame_id;
    send("evaluate", std::move(arguments),
         shaped(std::move(on_reply), [](const Json& body) { return shape_evaluate(body); }));
}

void Client::exception_details(long thread_id, Reply on_reply) {
    send("exceptionInfo", Json{{"threadId", thread_id}},
         shaped(std::move(on_reply), [](const Json& body) { return shape_exception_info(body); }));
}

void Client::completions(const std::string& text, long column, long frame_id, long line, Reply on_reply) {
    if (!supports_completions()) {
        on_reply(Json(nullptr), unsupported("supportsCompletionsRequest", "不支持调试表达式补全。"));
        return;
    }
    Json arguments{{"text", text}, {"column", column}};
    // `frameId` 与 `line` 都是可选：没有它们时**不发**这两个键（发 0 会被适配器当成
    // "第 0 帧 / 第 0 行"，那是另一个上下文，补出来的符号可能完全不对）。
    if (frame_id > 0) arguments["frameId"] = frame_id;
    if (line > 0) arguments["line"] = line;
    send("completions", std::move(arguments),
         shaped(std::move(on_reply), [](const Json& body) { return shape_completions(body); }));
}

void Client::breakpoint_locations(const std::string& rel_path, long line, long end_line, long column,
                                 long end_column, Reply on_reply) {
    if (!supports_breakpoint_locations()) {
        on_reply(Json(nullptr), unsupported("supportsBreakpointLocationsRequest", "无法预览断点位置。"));
        return;
    }
    const auto key = slash_form(rel_path);
    // `source.path` 取与 `setBreakpoints` 同一条规则（URI + sourceReference:0）：同一行上
    // "能不能放断点"和"放上去"必须按同一个文件解释，两条路径规则不一致会让适配器对不上。
    // （注：`goto_targets` 用的是 native 路径，两种形式目前并存 —— 见 docs/enum-lsp-dap.md 的待核项。）
    Json arguments{{"source", Json{{"path", to_uri(key)}, {"sourceReference", 0}}}, {"line", line}};
    if (end_line > 0) arguments["endLine"] = end_line;
    if (column > 0) arguments["column"] = column;
    if (end_column > 0) arguments["endColumn"] = end_column;
    send("breakpointLocations", std::move(arguments),
         shaped(std::move(on_reply), [](const Json& body) { return shape_breakpoint_locations(body); }));
}

// `dataBreakpoints`：问"这个会话里哪些数据位置可以被观察"（字段观察点的候选清单）。
void Client::data_breakpoints(Reply on_reply) {
    if (!supports_data_breakpoints()) {
        on_reply(Json(nullptr), unsupported("supportsDataBreakpoints", "无法列出数据断点。"));
        return;
    }
    send("dataBreakpoints", Json::object(),
         shaped(std::move(on_reply), [](const Json& body) { return shape_data_breakpoints(body); }));
}

void Client::set_data_breakpoints(const Json& requested, Reply on_reply) {
    if (!supports_data_breakpoints()) {
        on_reply(Json(nullptr), unsupported("supportsDataBreakpoints", "无法设置数据断点。"));
        return;
    }
    send("setDataBreakpoints", Json{{"breakpoints", normalize_data_breakpoints(requested)}},
         shaped(std::move(on_reply), [](const Json& body) { return shape_breakpoint_list(body); }));
}

void Client::set_function_breakpoints(const Json& requested, Reply on_reply) {
    if (!supports_function_breakpoints()) {
        on_reply(Json(nullptr), unsupported("supportsFunctionBreakpoints", "无法设置函数断点。"));
        return;
    }
    send("setFunctionBreakpoints", Json{{"breakpoints", normalize_function_breakpoints(requested)}},
         shaped(std::move(on_reply), [](const Json& body) { return shape_breakpoint_list(body); }));
}

void Client::source(long source_reference, const std::string& path, Reply on_reply) {
    if (!supports_source()) {
        on_reply(Json(nullptr), unsupported("supportsSourceRequest", "无法按 sourceReference 取源内容。"));
        return;
    }
    Json arguments = Json::object();
    // 规范里 sourceReference 与 source 二者**至少给一个**：给了引用优先按引用取，
    // 只有路径时按路径取（适配器据此返回它自己那份内容）。
    if (source_reference > 0) arguments["sourceReference"] = source_reference;
    if (!path.empty()) arguments["source"] = Json{{"path", to_native(slash_form(path))}, {"sourceReference", 0}};
    send("source", std::move(arguments),
         shaped(std::move(on_reply), [](const Json& body) { return shape_source(body); }));
}

// ---------------------------------------------------------- capabilities ---

// 规范里这三个能力位都**默认 false**（不是"没声明就当支持"），所以必须显式判真。
bool Client::supports_data_breakpoints() const {
    const auto flags = capabilities();
    return flags.contains("supportsDataBreakpoints") && flags.at("supportsDataBreakpoints").is_boolean() &&
           flags.at("supportsDataBreakpoints").get<bool>();
}

bool Client::supports_function_breakpoints() const {
    const auto flags = capabilities();
    return flags.contains("supportsFunctionBreakpoints") && flags.at("supportsFunctionBreakpoints").is_boolean() &&
           flags.at("supportsFunctionBreakpoints").get<bool>();
}

bool Client::supports_source() const {
    const auto flags = capabilities();
    return flags.contains("supportsSourceRequest") && flags.at("supportsSourceRequest").is_boolean() &&
           flags.at("supportsSourceRequest").get<bool>();
}

}  // namespace dap
}  // namespace taocode