// DAP 请求族：**按需重取清单**（loadedSources / modules）、**反向调试**（stepBack /
// reverseContinue）、**内存与反汇编**（readMemory / disassemble）。
//
// 从 native/dap.cpp 拆出来的（2026-09-27：dap.cpp 已登记 1800 行上限，按请求族拆文件，
// 与 lsp_session.cpp 拆 lsp_navigation.cpp/lsp_code_actions.cpp 同一种做法）。
// 这个文件只放"请求 + 整形"，会话/管道/reader 这些机制仍全在 dap.cpp。
//
// 三条共同的协议口径（与 breakpoint_locations / completions 完全一致）：
//   · 每个请求先过能力位；规范里这些位**默认 false**，没声明的适配器回 `DAP_UNSUPPORTED`，
//     调用方据此不渲染入口（而不是发一个适配器答不上来的请求）；
//   · 整形把规范字段拍平，**缺字段不造空值**，可选数值 <= 0 不写键；
//   · 路径统一走 `Client::to_path`（工作区相对 '/'，工作区外原样规范化），与事件/栈帧同一规则。

#include "dap.hpp"

#include <string>
#include <string_view>
#include <utility>

namespace taocode {
namespace dap {
namespace {

// ------------------------------------------------------------ json helpers ---
// 与 dap.cpp 的匿名命名空间同名不冲突（两个 TU 各一份）；这里只取这一族需要的三个。

std::string text_of(const Json& object, const char* key) {
    if (object.is_object() && object.contains(key) && object.at(key).is_string()) return object.at(key).get<std::string>();
    return {};
}

std::int64_t int_of(const Json& object, const char* key, std::int64_t fallback) {
    if (object.is_object() && object.contains(key) && object.at(key).is_number_integer())
        return object.at(key).get<std::int64_t>();
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

// `loadedSources` -> {available, sources:[...]}。**空数组是有意义的答案**（还没有加载任何
// 源文件），与 breakpointLocations 的空数组同一种口径：available 只表示"适配器答了"。
// name/path/sourceReference 三者都缺的条目丢掉 —— 定位不了也显示不了，留着只会是空行。
Json shape_loaded_sources(const Client& client, const Json& body) {
    Json sources = Json::array();
    const Json& envelope = as_object(body);
    if (envelope.contains("sources") && envelope.at("sources").is_array())
        for (const auto& value : envelope.at("sources")) {
            const Json& item = as_object(value);
            Json shaped_item = Json::object();
            const auto name = text_of(item, "name");
            if (!name.empty()) shaped_item["name"] = name;
            const auto path = text_of(item, "path");
            if (!path.empty()) shaped_item["path"] = client.to_path(path);
            const auto reference = int_of(item, "sourceReference", 0);
            if (reference > 0) shaped_item["sourceReference"] = reference;
            const auto origin = text_of(item, "origin");
            if (!origin.empty()) shaped_item["origin"] = origin;
            const auto hint = text_of(item, "presentationHint");
            if (!hint.empty()) shaped_item["presentationHint"] = hint;
            if (shaped_item.empty()) continue;
            sources.push_back(std::move(shaped_item));
        }
    return Json{{"available", true}, {"sources", std::move(sources)}};
}

// `modules` -> {available, modules:[...], totalModules?}。`id`/`name` 是规范必填：
// 缺一个的条目丢弃（没有 id 认不出，没有 name 显示不了）。`totalModules` <= 0 不写键。
Json shape_modules(const Client& client, const Json& body) {
    Json modules = Json::array();
    const Json& envelope = as_object(body);
    if (envelope.contains("modules") && envelope.at("modules").is_array())
        for (const auto& value : envelope.at("modules")) {
            const Json& item = as_object(value);
            if (!item.contains("id") || !(item.at("id").is_number() || item.at("id").is_string())) continue;
            const auto name = text_of(item, "name");
            if (name.empty()) continue;
            Json shaped_item{{"id", item.at("id")}, {"name", name}};
            for (const char* key : {"type", "version", "symbolStatus", "addressRange", "dateTimeStamp"}) {
                const auto text = text_of(item, key);
                if (!text.empty()) shaped_item[key] = text;
            }
            // 路径字段统一映射成工作区相对（工作区外原样规范化），与事件/栈帧同一条规则。
            for (const char* key : {"path", "symbolFilePath"}) {
                const auto text = text_of(item, key);
                if (!text.empty()) shaped_item[key] = client.to_path(text);
            }
            for (const char* key : {"isOptimized", "isUserCode"}) {
                if (item.contains(key) && item.at(key).is_boolean()) shaped_item[key] = item.at(key).get<bool>();
            }
            modules.push_back(std::move(shaped_item));
        }
    Json result{{"available", true}, {"modules", std::move(modules)}};
    const auto total = int_of(envelope, "totalModules", 0);
    if (total > 0) result["totalModules"] = total;
    return result;
}

// `readMemory` -> {available, address?, dataB64?, offset?, unreadableBytes?}。
// `data` 是规范里的 base64 字节（这里改名 dataB64，桥上的二进制载荷统一这个名字）；
// 连 address 都没有说明适配器其实没答上来，回 available:false 而不是造一段空数据。
Json shape_memory(const Json& body) {
    const Json& item = as_object(body);
    const auto address = text_of(item, "address");
    const auto data = text_of(item, "data");
    if (address.empty() && data.empty()) return Json{{"available", false}};
    Json shaped_item{{"available", true}};
    if (!address.empty()) shaped_item["address"] = address;
    if (!data.empty()) shaped_item["dataB64"] = data;
    const auto offset = int_of(item, "offset", 0);
    if (offset > 0) shaped_item["offset"] = offset;
    const auto unreadable = int_of(item, "unreadableBytes", 0);
    if (unreadable > 0) shaped_item["unreadableBytes"] = unreadable;
    return shaped_item;
}

// `disassemble` -> {available, instructions:[...], offset?, unreadableBytes?}。
// 每条指令的 address/instruction 是规范必填；`location.path` 映射成工作区相对路径，
// line/column/endLine/endColumn 在规范里直接挂在 Instruction 上且是 **1 基**（原样透传）。
Json shape_disassemble(const Client& client, const Json& body) {
    Json instructions = Json::array();
    const Json& envelope = as_object(body);
    if (envelope.contains("instructions") && envelope.at("instructions").is_array())
        for (const auto& value : envelope.at("instructions")) {
            const Json& item = as_object(value);
            const auto address = text_of(item, "address");
            const auto instruction = text_of(item, "instruction");
            if (address.empty() || instruction.empty()) continue;
            Json shaped_item{{"address", address}, {"instruction", instruction}};
            const auto bytes = text_of(item, "instructionBytes");
            if (!bytes.empty()) shaped_item["instructionBytes"] = bytes;
            const auto symbol = text_of(item, "symbol");
            if (!symbol.empty()) shaped_item["symbol"] = symbol;
            if (item.contains("location") && item.at("location").is_object()) {
                const auto path = text_of(item.at("location"), "path");
                if (!path.empty()) shaped_item["path"] = client.to_path(path);
            }
            for (const char* key : {"line", "column", "endLine", "endColumn"}) {
                const auto number = int_of(item, key, 0);
                if (number > 0) shaped_item[key] = number;
            }
            instructions.push_back(std::move(shaped_item));
        }
    Json result{{"available", true}, {"instructions", std::move(instructions)}};
    for (const char* key : {"offset", "unreadableBytes"}) {
        const auto number = int_of(envelope, key, 0);
        if (number > 0) result[key] = number;
    }
    return result;
}

}  // namespace

// ------------------------------------------------------------- requests ---

void Client::loaded_sources(Reply on_reply) {
    if (!supports_loaded_sources()) {
        on_reply(Json(nullptr), unsupported("supportsLoadedSourcesRequest", "无法重取已加载源文件清单。"));
        return;
    }
    send("loadedSources", Json::object(),
         shaped(std::move(on_reply), [this](const Json& body) { return shape_loaded_sources(*this, body); }));
}

void Client::modules(long start_module, long module_count, Reply on_reply) {
    if (!supports_modules()) {
        on_reply(Json(nullptr), unsupported("supportsModulesRequest", "无法重取模块清单。"));
        return;
    }
    Json arguments = Json::object();
    // 规范里两个字段都可选：省略 = 从第 0 个模块开始 / 返回全部。写 0 反而会被
    // 适配器当成"要第 0 页的 0 条"（moduleCount 为 0 时规范说的是"全部"，但没必要赌）。
    if (start_module > 0) arguments["startModule"] = start_module;
    if (module_count > 0) arguments["moduleCount"] = module_count;
    send("modules", std::move(arguments),
         shaped(std::move(on_reply), [this](const Json& body) { return shape_modules(*this, body); }));
}

void Client::step_back(long thread_id, Reply on_reply) {
    if (!supports_step_back()) {
        on_reply(Json(nullptr), unsupported("supportsStepBack", "无法反向执行（回退一步）。"));
        return;
    }
    send("stepBack", Json{{"threadId", thread_id}}, wrap_ok(std::move(on_reply)));
}

void Client::reverse_continue(long thread_id, Reply on_reply) {
    if (!supports_step_back()) {
        on_reply(Json(nullptr), unsupported("supportsStepBack", "无法反向继续执行。"));
        return;
    }
    send("reverseContinue", Json{{"threadId", thread_id}}, wrap_ok(std::move(on_reply)));
}

void Client::read_memory(const std::string& memory_reference, long offset, long count, Reply on_reply) {
    if (!supports_read_memory()) {
        on_reply(Json(nullptr), unsupported("supportsReadMemoryRequest", "无法读取内存。"));
        return;
    }
    Json arguments{{"memoryReference", memory_reference}, {"count", count}};
    if (offset > 0) arguments["offset"] = offset;
    send("readMemory", std::move(arguments),
         shaped(std::move(on_reply), [](const Json& body) { return shape_memory(body); }));
}

void Client::disassemble(const std::string& memory_reference, long offset, long instruction_offset,
                         long instruction_count, bool resolve_symbols, Reply on_reply) {
    if (!supports_disassemble()) {
        on_reply(Json(nullptr), unsupported("supportsDisassembleRequest", "无法反汇编。"));
        return;
    }
    Json arguments{{"memoryReference", memory_reference}, {"instructionCount", instruction_count}};
    if (offset > 0) arguments["offset"] = offset;
    if (instruction_offset > 0) arguments["instructionOffset"] = instruction_offset;
    if (resolve_symbols) arguments["resolveSymbols"] = true;
    send("disassemble", std::move(arguments),
         shaped(std::move(on_reply), [this](const Json& body) { return shape_disassemble(*this, body); }));
}

// ---------------------------------------------------------- capabilities ---

// 规范里这几个能力位都**默认 false**（不是"没声明就当支持"），所以必须显式判真。
bool Client::supports_loaded_sources() const {
    const auto flags = capabilities();
    return flags.contains("supportsLoadedSourcesRequest") && flags.at("supportsLoadedSourcesRequest").is_boolean() &&
           flags.at("supportsLoadedSourcesRequest").get<bool>();
}

bool Client::supports_modules() const {
    const auto flags = capabilities();
    return flags.contains("supportsModulesRequest") && flags.at("supportsModulesRequest").is_boolean() &&
           flags.at("supportsModulesRequest").get<bool>();
}

bool Client::supports_step_back() const {
    const auto flags = capabilities();
    return flags.contains("supportsStepBack") && flags.at("supportsStepBack").is_boolean() &&
           flags.at("supportsStepBack").get<bool>();
}

bool Client::supports_read_memory() const {
    const auto flags = capabilities();
    return flags.contains("supportsReadMemoryRequest") && flags.at("supportsReadMemoryRequest").is_boolean() &&
           flags.at("supportsReadMemoryRequest").get<bool>();
}

bool Client::supports_disassemble() const {
    const auto flags = capabilities();
    return flags.contains("supportsDisassembleRequest") && flags.at("supportsDisassembleRequest").is_boolean() &&
           flags.at("supportsDisassembleRequest").get<bool>();
}

}  // namespace dap
}  // namespace taocode
