// `Session::semantic()` 门控之后的「每个 kind 怎么发、怎么整形」那整条 if 链（2026-10-05 从
// native/lsp_session.cpp 整段搬出：那个文件当时 1049 行、上限 1075，只剩 26 行余量）。
// 门控.test.mjs 里给本文件写的职责就是「门控 + 每个 kind 的整形」两件事 —— 现在各住一个文件：
// 门控、文档生命周期、request()/semantic() 两个入口留在 lsp_session.cpp，这一族在这里。
// 它不碰门控、不碰 documents_、不碰宿主生命周期：拿到的 host / uri / args / language_name
// 都是门控放行之后的东西。
//
// 搬动时**实现一个字没改**：下面 594 行（position / relative 两个局部量，连同每个 kind 的
// 注释）与 lsp_session.cpp 里原来的逐字相同，缩进也照原样（成员函数体，4 空格）。
// 唯一变的是外壳 —— 与 dispatch_navigation / dispatch_code_action 同一约定：
//   · 签名多出 host / uri / language_name 三个「门控已经算好」的参数；
//   · 返回 bool：处理了就是 true，false 交回 semantic() 报 LSP_BAD_KIND（链上每个分支都 return，
//     所以走到末尾只可能是没匹配的 kind）；
//   · on_result 按**值**收：这一族里每个分支都 std::move 掉它，按引用收会污染调用方那条。

#include "lsp_session.hpp"
#include "request_trace.hpp"
#include "lsp_support.hpp"

// 工具与整形在 `lsp_support.hpp/.cpp`（原匿名 namespace，2026-09-27 拆出以降低本文件行数）。
using namespace taocode::lsp::detail;

#include <string>
#include <vector>

namespace taocode {
namespace lsp {

// 返回 void 而不是 bool（与 dispatch_navigation / dispatch_code_action 不同）：链上每个分支
// 原本就是 `return;`，改成 `return true;` 就不是逐字搬运了。所以「没有分支认领」这一种情况
// 由本函数自己答掉（末尾那句 LSP_BAD_KIND），semantic() 那边只剩一次调用。
void Session::dispatch_semantic_kind(const std::string& kind, const std::string& path, int line, int character,
                                     const Json& args, Host* host, const std::string& uri,
                                     const std::string& language_name, ResultHandler on_result) {
    const auto position = Json{{"line", line}, {"character", character}};
    const auto relative = [this](const std::string& target) { return to_path(target); };
    // 改名前先问服务器：它可能回一个 WorkspaceEdit，把别处指向这个文件的 import 一起改掉
    // （IDEA 的 `RenameFileProcessor` + "搜索引用"那一步）。这不是 provider 门控的能力，而是
    // `workspace.fileOperations.willRename`；没声明的服务器回 `{available:false}`（不是错误），
    // 调用方直接跳过"更新引用"，改名本身照做。
    if (kind == "willRenameFiles") {
        const auto new_path = string_at(args, "newPath");
        if (new_path.empty()) {
            on_result(Json(nullptr), invalid("INVALID_REQUEST", "the new path is missing"));
            return;
        }
        bool supported = false;
        {
            taocode::trace::Lock lock(mutex_, __FUNCSIG__);
            supported = file_operation_supported(language_name, "willRename");
        }
        if (!supported) { on_result({{"available", false}}, Json(nullptr)); return; }
        const Json params{{"files", Json::array({Json{{"oldUri", to_uri(path)}, {"newUri", to_uri(new_path)}}})}};
        host->request("workspace/willRenameFiles", params,
            [on_result = std::move(on_result), relative](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                // `workspace/willRenameFiles` returns the WorkspaceEdit ITSELF (`WorkspaceEdit | null`,
                // 不是 `{edit: …}` —— 那是 `workspace/applyEdit` 的参数形状）。null / {} / 没有
                // TextEdit 的空编辑都表示"没有要改的引用"。
                const auto edits = result.is_object() ? edit_groups(result, relative) : Json::array();
                if (edits.empty()) { on_result({{"available", false}}, Json(nullptr)); return; }
                on_result({{"available", true}, {"edits", std::move(edits)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "rename") {
        host->request("textDocument/rename", {{"textDocument", text_document(uri)}, {"position", position},
            {"newName", string_at(args, "newName")}},
            [on_result = std::move(on_result), to_path = relative](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                const auto groups = edit_groups(result, to_path);
                if (groups.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"edits", std::move(groups)}}, Json(nullptr));
            });
        return;
    }
    // LSP `textDocument/prepareRename`（规范 "Prepare Rename Request"）：结果有三种形态 ——
    // `Range`（这个位置可以改名，范围就是标识符）、`{range, placeholder}`（可改名且给出占位名）、
    // `null`（此处不能改名）。IDEA 的 RenameProcessor 同样先校验再打开对话框。
    if (kind == "prepareRename") {
        // 规范把 prepareRename 的可用性放在 `renameProvider.prepareProvider` 里；服务器没开就不发，
        // 前端据此"跳过预校验、按老路重命名"（supported=false），而不是把它当成"此处不能改名"。
        if (!prepare_rename_supported(language_name)) {
            on_result({{"available", false}, {"supported", false}}, Json(nullptr));
            return;
        }
        host->request("textDocument/prepareRename", {{"textDocument", text_document(uri)}, {"position", position}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                if (result.is_null()) { on_result({{"available", false}, {"supported", true}}, Json(nullptr)); return; }
                Json span = result;
                std::string placeholder;
                if (result.is_object()) {
                    if (result.contains("range") && result.at("range").is_object()) span = result.at("range");
                    placeholder = string_at(result, "placeholder");
                }
                if (!span.is_object()) { on_result({{"available", false}, {"supported", true}}, Json(nullptr)); return; }
                const auto start = range_corner(span, "start");
                const auto end = range_corner(span, "end");
                Json payload{{"available", true}, {"supported", true},
                             {"startLine", int_at(start, "line")}, {"startChar", int_at(start, "character")},
                             {"endLine", int_at(end, "line")}, {"endChar", int_at(end, "character")}};
                if (!placeholder.empty()) payload["placeholder"] = placeholder;
                on_result(std::move(payload), Json(nullptr));
            });
        return;
    }
    if (kind == "references") {
        host->request("textDocument/references", {{"textDocument", text_document(uri)}, {"position", position},
            {"context", {{"includeDeclaration", true}}}},
            [on_result = std::move(on_result), to_path = relative](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                const auto refs = ref_entries(result, to_path);
                if (refs.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"refs", std::move(refs)}}, Json(nullptr));
            });
        return;
    }
    // Go-to-implementations and go-to-type: a Location[] answered exactly like
    // references, so the UI reuses the same reference-list panel.
    if (kind == "implementation" || kind == "typeDefinition") {
        host->request(kind == "implementation" ? "textDocument/implementation" : "textDocument/typeDefinition",
            {{"textDocument", text_document(uri)}, {"position", position}},
            [on_result = std::move(on_result), to_path = relative](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                const auto refs = ref_entries(result, to_path);
                if (refs.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"refs", std::move(refs)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "documentSymbol") {
        host->request("textDocument/documentSymbol", {{"textDocument", text_document(uri)}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json symbols = Json::array();
                const Json nodes = result.is_array() ? result : Json::array({result});
                collect_symbols(nodes, symbols);
                if (symbols.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"symbols", std::move(symbols)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "workspaceSymbol") {
        host->request("workspace/symbol", {{"query", string_at(args, "query")}},
            [this, on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json symbols = Json::array();
                if (result.is_array())
                    for (const auto& item : result) {
                        // URI-only WorkspaceSymbol needs workspaceSymbol/resolve, which
                        // is not implemented here. Never invent a (0, 0) range for it.
                        if (!item.is_object() || !item.contains("location") || !item.at("location").is_object()) continue;
                        const auto& location = item.at("location");
                        if (!location.contains("uri") || !location.at("uri").is_string()) continue;
                        if (!location.contains("range") || !location.at("range").is_object()) continue;
                        const auto& range = location.at("range");
                        if (!range.contains("start") || !range.at("start").is_object()) continue;
                        const auto& start = range.at("start");
                        if (!start.contains("line") || !start.at("line").is_number_integer() ||
                            !start.contains("character") || !start.at("character").is_number_integer()) continue;
                        Json symbol = {{"name", string_at(item, "name")}, {"kind", int_at(item, "kind")},
                                       {"path", to_path(location.at("uri").get<std::string>())},
                                       {"line", int_at(start, "line")}, {"character", int_at(start, "character")}};
                        if (range.contains("end") && range.at("end").is_object()) {
                            const auto& end = range.at("end");
                            if (end.contains("line") && end.at("line").is_number_integer() &&
                                end.contains("character") && end.at("character").is_number_integer()) {
                                symbol["endLine"] = int_at(end, "line");
                                symbol["endCharacter"] = int_at(end, "character");
                            }
                        }
                        symbols.push_back(std::move(symbol));
                    }
                if (symbols.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"symbols", std::move(symbols)}}, Json(nullptr));
            });
        return;
    }
    // Signature help: the caret alone is enough, but the UI may say which trigger
    // asked for it (1 invoked, 2 typed a character, 3 content change).
    if (kind == "signatureHelp") {
        host->request("textDocument/signatureHelp", {{"textDocument", text_document(uri)}, {"position", position},
            {"context", {{"triggerKind", int_or(args, "triggerKind", 1)}}}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                on_result(signature_shape(result), Json(nullptr));
            });
        return;
    }
    // 代码操作这一族（codeAction / codeActionResolve / executeCommand）在 native/lsp_code_actions.cpp，
    // 本函数只做转交（门控已在上面做完）。**传左值**：kind 不属于这一族时处理器必须还是完整的。
    if (dispatch_code_action(kind, path, *host, uri, args, line, character, on_result)) return;
    // Call hierarchy: prepare answers with the item(s) at the position, and the
    // incoming/outgoing requests must echo one of those items straight back.
    if (kind == "prepareCallHierarchy" || kind == "prepareTypeHierarchy") {
        host->request(kind == "prepareCallHierarchy" ? "textDocument/prepareCallHierarchy" : "textDocument/prepareTypeHierarchy",
            {{"textDocument", text_document(uri)}, {"position", position}},
            [on_result = std::move(on_result), to_path = relative](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                const auto items = hier_items(result, to_path);
                if (items.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"items", std::move(items)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "callHierarchyIncoming" || kind == "callHierarchyOutgoing" ||
        kind == "typeHierarchySupertypes" || kind == "typeHierarchySubtypes") {
        if (!args.contains("item")) { on_result(Json(nullptr), invalid("INVALID_REQUEST", "the hierarchy item is missing")); return; }
        const Json& handed = args.at("item");
        // Accept either the shaped entry (whose `raw` is the server object) or a raw
        // item, so the UI never has to guess which layer produced it.
        const Json item = handed.is_object() && handed.contains("raw") && handed.at("raw").is_object()
                              ? handed.at("raw") : handed;
        const std::string method = kind == "callHierarchyIncoming" ? "callHierarchy/incomingCalls"
                                   : kind == "callHierarchyOutgoing" ? "callHierarchy/outgoingCalls"
                                   : kind == "typeHierarchySupertypes" ? "typeHierarchy/supertypes"
                                                                       : "typeHierarchy/subtypes";
        const bool calls = kind.rfind("callHierarchy", 0) == 0;
        const char* item_key = kind == "callHierarchyIncoming" ? "from" : "to";
        host->request(method, {{"item", item}},
            [on_result = std::move(on_result), to_path = relative, calls, item_key](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                // Call requests wrap each node with its call-site ranges; the type
                // hierarchy answers with a plain item array.
                const Json entries = calls ? call_entries(result, to_path, item_key) : hier_items(result, to_path);
                if (entries.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {calls ? "calls" : "items", std::move(entries)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "formatting" || kind == "rangeFormatting") {
        const auto options = format_options(args);
        Json params{{"textDocument", text_document(uri)}, {"options", options}};
        if (kind == "rangeFormatting") params["range"] = argument_range(args, line, character);
        host->request(kind == "formatting" ? "textDocument/formatting" : "textDocument/rangeFormatting",
            std::move(params),
            [on_result = std::move(on_result), to_path = relative, uri](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                on_result(format_shape(result, to_path(uri)), Json(nullptr));
            });
        return;
    }
    if (kind == "documentHighlight") {
        host->request("textDocument/documentHighlight", {{"textDocument", text_document(uri)}, {"position", position}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                on_result(highlight_shape(result), Json(nullptr));
            });
        return;
    }
    // Selection ranges: walk the innermost SelectionRange's parent chain into an
    // ordered innermost->outermost list, so the UI can grow/shrink a selection.
    // LSP `textDocument/foldingRange`：服务器给的折叠区间（0 基行号）。声明了 `lineFoldingOnly`，
    // 所以按行的区间是常态，但三列式（带 startCharacter/endCharacter）也要照收。
    if (kind == "foldingRange") {
        host->request("textDocument/foldingRange", {{"textDocument", text_document(uri)}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json ranges = Json::array();
                if (result.is_array())
                    for (const auto& item : result) {
                        if (!item.is_object()) continue;
                        const auto start_line = int_at(item, "startLine");
                        const auto end_line = int_at(item, "endLine");
                        if (end_line <= start_line) continue;   // 单行区间没有可折叠内容
                        Json shaped{{"startLine", start_line}, {"endLine", end_line}};
                        if (item.contains("startCharacter")) shaped["startChar"] = int_at(item, "startCharacter");
                        if (item.contains("endCharacter")) shaped["endChar"] = int_at(item, "endCharacter");
                        const auto kind = string_at(item, "kind");
                        if (!kind.empty()) shaped["kind"] = kind;
                        ranges.push_back(std::move(shaped));
                    }
                if (ranges.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"ranges", std::move(ranges)}}, Json(nullptr));
            });
        return;
    }
    // LSP `textDocument/semanticTokens/*` —— IDEA 的 daemon 着色路径（见 `initialize` 里的长注释）。
    // `previousResultId` 有值**且**服务器声明了 `requests.full.delta` 时走 `/full/delta`，
    // 否则整份重取。
    //
    // `data` 是**压缩的整数数组**（每 5 个一组：deltaLine / deltaStartChar / length /
    // tokenType / tokenModifiers），这里**原样透传**：解码规则（相对位置、多行 token、
    // 修饰符位掩码）只在前端实现一份 —— 两端各解一次必然漂移，而且出错时很难看出是哪一端。

    // LSP `textDocument/inlineCompletion` —— IDEA 的**行内补全**
    // （`InlineCompletionProvider.getSuggestion`，见 initialize 里记的路径与行号）：
    // 光标处给一段"幽灵文本"，按 Tab 接受。
    //
    // `triggerKind`：1 = 自动（打字/停顿），2 = 显式（用户主动要），3 = 上一个建议被拒后重试。
    // 只整形 `insertText` 是**字符串或 plainText** 的项：`{kind: "snippet", value}` 里的
    // `${1:foo}` 占位符我们不展开，直接插进去会把占位符当字面量写进代码 —— 那是错的，
    // 所以这类项**丢弃**（宁可少给一个建议，不可插入一段错代码）。
    // LSP `textDocument/moniker` —— 符号标识。用户可见落点是 IDEA 的 **Copy Reference**
    // （`CopyReferenceAction`，见 initialize 里记的路径与行号）：把当前位置的符号标识复制到剪贴板。
    //
    // `unique` 要**如实带出去**：`true` 表示标识在整个方案里唯一（可以放心当引用），
    // `false` 表示同名符号可能有多个 —— 客户端要么不用、要么提示，不能假装它唯一。
    if (kind == "moniker") {
        host->request("textDocument/moniker", {{"textDocument", text_document(uri)}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json monikers = Json::array();
                if (result.is_array())
                    for (const auto& entry : result) {
                        if (!entry.is_object()) continue;
                        const auto identifier = string_at(entry, "identifier");
                        if (identifier.empty()) continue;   // 没有标识就没有可复制的东西
                        Json shaped{{"identifier", identifier}};
                        const auto scheme = string_at(entry, "scheme");
                        if (!scheme.empty()) shaped["scheme"] = scheme;
                        if (entry.contains("unique") && entry.at("unique").is_boolean())
                            shaped["unique"] = entry.at("unique");
                        monikers.push_back(std::move(shaped));
                    }
                if (monikers.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"monikers", std::move(monikers)}}, Json(nullptr));
            });
        return;
    }
    // LSP `textDocument/codeLens` —— IDEA 的 Code Vision（"N 个用法"/"N 个实现"这类行上方提示）。
    // 条目里的 `command` 由**点击**触发，客户端把它转成 `workspace/executeCommand` —— 复用既有链路，
    // 不再造一套"CodeLens 自己的动作"。依据：`CodeVisionProvider`（`platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionProvider.kt:25`）、
    // 产生条目 `computeForEditor`（`:62`）、点击 `handleClick`（`:76`）。
    //
    // 没有 `command` 的条目**丢弃**：规范里 title 在 command 里，没有它既显示不出文字、也点不动 ——
    // 留着就是一个空的行上方元素。（不声明 `resolveProvider`，所以服务器本该直接给 command。）
    if (kind == "codeLens") {
        host->request("textDocument/codeLens", {{"textDocument", text_document(uri)}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json items = Json::array();
                if (result.is_array())
                    for (const auto& entry : result) {
                        if (!entry.is_object()) continue;
                        if (!entry.contains("command") || !entry.at("command").is_object()) continue;
                        const auto& command = entry.at("command");
                        const auto title = string_at(command, "title");
                        const auto name = string_at(command, "command");
                        if (title.empty() || name.empty()) continue;
                        Json shaped{{"title", title}, {"command", name}};
                        if (command.contains("arguments") && command.at("arguments").is_array())
                            shaped["arguments"] = command.at("arguments");
                        if (entry.contains("range") && entry.at("range").is_object()) {
                            const auto& span = entry.at("range");
                            const auto from = range_corner(span, "start");
                            const auto to = range_corner(span, "end");
                            shaped["range"] = Json{{"startLine", int_at(from, "line")},
                                                   {"startChar", int_at(from, "character")},
                                                   {"endLine", int_at(to, "line")},
                                                   {"endChar", int_at(to, "character")}};
                        }
                        items.push_back(std::move(shaped));
                    }
                if (items.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"items", std::move(items)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "inlineCompletion") {
        Json arguments{{"textDocument", text_document(uri)}, {"position", position},
                       {"context", {{"triggerKind", int_or(args, "triggerKind", 1)}}}};
        host->request("textDocument/inlineCompletion", std::move(arguments),
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                // 规范允许 `null`（没有建议）与 `InlineCompletionList | InlineCompletionItem[]` 三种形状。
                const Json* source = nullptr;
                if (result.is_array()) source = &result;
                else if (result.is_object() && result.contains("items") && result.at("items").is_array())
                    source = &result.at("items");
                Json items = Json::array();
                if (source)
                    for (const auto& entry : *source) {
                        if (!entry.is_object()) continue;
                        Json shaped = Json::object();
                        const auto& insert = entry.contains("insertText") ? entry.at("insertText") : Json(nullptr);
                        if (insert.is_string()) shaped["insertText"] = insert;
                        else if (insert.is_object() && string_at(insert, "kind") == "plainText" &&
                                 insert.contains("value") && insert.at("value").is_string())
                            shaped["insertText"] = insert.at("value");
                        else continue;   // snippet（或畸形）：见上面的注释
                        const auto filter = string_at(entry, "filterText");
                        if (!filter.empty()) shaped["filterText"] = filter;
                        if (entry.contains("range") && entry.at("range").is_object()) {
                            const auto& span = entry.at("range");
                            const auto from = range_corner(span, "start");
                            const auto to = range_corner(span, "end");
                            shaped["range"] = Json{{"startLine", int_at(from, "line")},
                                                   {"startChar", int_at(from, "character")},
                                                   {"endLine", int_at(to, "line")},
                                                   {"endChar", int_at(to, "character")}};
                        }
                        items.push_back(std::move(shaped));
                    }
                if (items.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"items", std::move(items)}}, Json(nullptr));
            });
        return;
    }
    // LSP `workspace/diagnostic` —— IDEA 的**整工程批处理 Inspection**（"检查代码"）：
    // 一次问出所有文件的诊断，而不是逐个文件拉。与 `textDocument/diagnostic` 共用同一个
    // `diagnosticProvider`，但**额外要求它声明 `workspaceDiagnostics: true`** ——
    // 没声明就发，服务器只能拒。
    //
    // `previousResultIds` 是逐文件的 `{uri, value}` 列表：服务器可以对没变的文件回
    // `kind: "unchanged"`。所以整形必须把 `unchanged` 与 `full` 分开带出去 ——
    // 把 unchanged 当成"这个文件没诊断"会把一整批诊断从问题面板里抹掉。
    if (kind == "workspaceDiagnostic") {
        // 顶层的 `unsupported()` 只查 `diagnosticProvider` 存不存在（或是否被显式声明成
        // false/null），**查不到 `workspaceDiagnostics` 这个字段** —— 所以这里必须再判一次。
        // 服务器的 provider 对象存在、但 `workspaceDiagnostics: false` 时，发出去只会被拒。
        if (!workspace_diagnostic_supported(language_name)) {
            on_result(Json(nullptr), invalid("LSP_UNSUPPORTED",
                                             "服务器未声明 diagnosticProvider.workspaceDiagnostics，不支持整工程拉取诊断。"));
            return;
        }
        Json previous = Json::array();
        if (args.contains("previousResultIds") && args.at("previousResultIds").is_array())
            for (const auto& entry : args.at("previousResultIds")) {
                if (!entry.is_object()) continue;
                const auto file_path = string_at(entry, "path");
                const auto value = string_at(entry, "value");
                if (file_path.empty() || value.empty()) continue;
                previous.push_back({{"uri", to_uri(file_path)}, {"value", value}});
            }
        Json arguments = Json::object();
        if (!previous.empty()) arguments["previousResultIds"] = std::move(previous);
        host->request("workspace/diagnostic", std::move(arguments),
            [on_result = std::move(on_result), relative](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                if (!result.is_object()) { on_result({{"available", false}}, Json(nullptr)); return; }
                Json reports = Json::array();
                if (result.contains("items") && result.at("items").is_array())
                    for (const auto& item : result.at("items")) {
                        if (!item.is_object()) continue;
                        const auto uri = string_at(item, "uri");
                        if (uri.empty()) continue;
                        const auto report_kind = string_at(item, "kind");
                        Json shaped{{"path", relative(uri)},
                                    {"kind", report_kind.empty() ? std::string("full") : report_kind}};
                        const auto result_id = string_at(item, "resultId");
                        if (!result_id.empty()) shaped["resultId"] = result_id;
                        // `unchanged` 的报告**没有** items（规范如此），所以这里不补空数组 ——
                        // "这个文件没诊断"与"沿用上一份"是两件事。
                        if (shaped.at("kind").get<std::string>() == "full")
                            shaped["diagnostics"] = item.contains("items")
                                                        ? shape_diagnostics(item.at("items")) : Json::array();
                        reports.push_back(std::move(shaped));
                    }
                on_result({{"available", true}, {"items", std::move(reports)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "semanticTokens") {
        const auto previous = string_at(args, "previousResultId");
        const bool delta = !previous.empty() && semantic_delta_supported(language_name);
        // legend 在开锁前取（semantic_legend 读 capabilities_），并随 payload 带出去：
        // `data` 的索引按**服务端**那张表编，前端必须用同一张表解码。
        Json legend;
        {
            taocode::trace::Lock lock(mutex_, __FUNCSIG__);
            legend = semantic_legend(language_name);
        }
        Json arguments{{"textDocument", text_document(uri)}};
        if (delta) arguments["previousResultId"] = previous;
        host->request(delta ? "textDocument/semanticTokens/full/delta" : "textDocument/semanticTokens/full",
            std::move(arguments),
            [on_result = std::move(on_result), delta, legend](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                if (!result.is_object()) { on_result({{"available", false}}, Json(nullptr)); return; }
                Json payload{{"available", true}, {"kind", delta ? "delta" : "full"}};
                if (!legend.is_null()) payload["legend"] = legend;
                const auto result_id = string_at(result, "resultId");
                if (!result_id.empty()) payload["resultId"] = result_id;
                if (delta) {
                    // 一个 `edits: []` 的 delta 是合法的（规范化之后内容没变），前端据此什么都不做；
                    // 所以空数组也要如实带出去，不能当成"没答上来"回 available:false。
                    Json edits = Json::array();
                    if (result.contains("edits") && result.at("edits").is_array())
                        for (const auto& edit : result.at("edits")) {
                            if (!edit.is_object() || !edit.contains("data") || !edit.at("data").is_array()) continue;
                            edits.push_back({{"start", int_at(edit, "start")},
                                             {"deleteCount", int_at(edit, "deleteCount")},
                                             {"data", edit.at("data")}});
                        }
                    payload["edits"] = std::move(edits);
                }
                // `SemanticTokensDelta` 是一个**联合**：`{edits}` 或 `{data}`（后者表示"整份替换"）。
                // 只认 edits 会漏掉一整种合法回答，所以 data 与 kind 无关地透传。
                if (result.contains("data") && result.at("data").is_array()) payload["data"] = result.at("data");
                else if (!delta) payload["data"] = Json::array();
                on_result(std::move(payload), Json(nullptr));
            });
        return;
    }
    // LSP `textDocument/documentLink`：文档里的可点击区间。IDEA 侧对应的用户可见行为是
    // Ctrl+Click 跳转（`GotoDeclarationHandler`）与"点一下导航"（`HyperlinkInfo.navigate`）。
    //
    // 整形保留**没有 `target` 的链接**：`resolveProvider: false` 下服务器一般会给 target，
    // 但真给了没 target 的项时，它至少还有 tooltip 和区间 —— 直接丢掉等于把服务器说的东西
    // 悄悄吞了。能不能点由前端按 target 是否为空决定。
    if (kind == "documentLink") {
        host->request("textDocument/documentLink", {{"textDocument", text_document(uri)}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json links = Json::array();
                if (result.is_array())
                    for (const auto& entry : result) {
                        if (!entry.is_object()) continue;
                        // `documentLink` 把 range 直接放在项上（不像 definition 那样包在 `location` 里），
                        // 取不到它就说明这条没用。
                        if (!entry.contains("range") || !entry.at("range").is_object()) continue;
                        const auto& span = entry.at("range");
                        const auto from = range_corner(span, "start");
                        const auto to = range_corner(span, "end");
                        Json link{{"startLine", int_at(from, "line")}, {"startChar", int_at(from, "character")},
                                  {"endLine", int_at(to, "line")}, {"endChar", int_at(to, "character")}};
                        const auto target = string_at(entry, "target");
                        if (!target.empty()) link["target"] = target;
                        const auto tooltip = string_at(entry, "tooltip");
                        if (!tooltip.empty()) link["tooltip"] = tooltip;
                        links.push_back(std::move(link));
                    }
                if (links.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"links", std::move(links)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "selectionRange") {
        host->request("textDocument/selectionRange", {{"textDocument", text_document(uri)}, {"positions", Json::array({position})}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json ranges = Json::array();
                const Json* node = nullptr;
                if (result.is_array() && !result.empty()) node = &result.front();
                else if (result.is_object()) node = &result;
                int guard = 0;
                while (node && node->is_object() && node->contains("range") && node->at("range").is_object() && guard++ < 128) {
                    const auto& span = node->at("range");
                    const auto start = range_corner(span, "start");
                    const auto end = range_corner(span, "end");
                    ranges.push_back({{"startLine", int_at(start, "line")}, {"startChar", int_at(start, "character")},
                                      {"endLine", int_at(end, "line")}, {"endChar", int_at(end, "character")}});
                    node = (node->contains("parent") && node->at("parent").is_object()) ? &node->at("parent") : nullptr;
                }
                if (ranges.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"ranges", std::move(ranges)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "inlayHint") {
        const Json viewport{{"start", {{"line", 0}, {"character", 0}}}, {"end", {{"line", 1000000}, {"character", 0}}}};
        host->request("textDocument/inlayHint", {{"textDocument", text_document(uri)}, {"range", viewport}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json hints = Json::array();
                if (result.is_array()) for (const auto& item : result) {
                    if (!item.is_object() || !item.contains("position") || !item.at("position").is_object()) continue;
                    std::string label;
                    if (item.contains("label")) {
                        const auto& raw = item.at("label");
                        if (raw.is_string()) label = raw.get<std::string>();
                        else if (raw.is_array()) for (const auto& part : raw) if (part.is_object()) label += string_at(part, "value");
                    }
                    if (label.empty()) continue;
                    const auto& pos = item.at("position");
                    Json hint{{"line", int_at(pos, "line")}, {"character", int_at(pos, "character")}, {"label", label}};
                    if (bool_at(item, "paddingLeft", false)) hint["paddingLeft"] = true;
                    if (bool_at(item, "paddingRight", false)) hint["paddingRight"] = true;
                    if (item.contains("kind") && item.at("kind").is_number_integer()) hint["kind"] = item.at("kind");
                    // `InlayHint.command`（点击时执行）与 `InlayHint.tooltip`（悬停说明）也**原样转发**。
                    // 上游对应物是 declarative 那套 sink 的同一对参数：
                    // `InlayTreeSink.addPresentation(position, payloads, tooltip, hintFormat, builder)`
                    // （platform/lang-api/src/com/intellij/codeInsight/hints/declarative/InlayTreeSink.kt:27-31，
                    // tooltip 是 `String?`、payloads 是点击动作）—— 没有它们，前端只能画出**只读**灰字。
                    // 转发前先校验命令名非空（点了没法执行的名字等于没给），参数必须是数组（过桥要 JSON 化）。
                    if (item.contains("command") && item.at("command").is_object()) {
                        const auto& raw = item.at("command");
                        const auto name = string_at(raw, "command");
                        if (!name.empty()) {
                            Json shaped_command{{"command", name}};
                            if (raw.contains("arguments") && raw.at("arguments").is_array())
                                shaped_command["arguments"] = raw.at("arguments");
                            hint["command"] = std::move(shaped_command);
                        }
                    }
                    // `tooltip` 有两种形状：字符串，或 MarkupContent（`{kind, value}`）—— 取 value。
                    if (item.contains("tooltip")) {
                        const auto& raw = item.at("tooltip");
                        std::string text;
                        if (raw.is_string()) text = raw.get<std::string>();
                        else if (raw.is_object()) text = string_at(raw, "value");
                        if (!text.empty()) hint["tooltip"] = std::move(text);
                    }
                    hints.push_back(std::move(hint));
                }
                on_result(Json{{"available", !hints.empty()}, {"hints", std::move(hints)}}, Json(nullptr));
            });
        return;
    }
    // LSP `completionItem/resolve`（IDEA 的 CompletionResultSet 懒解析）：把选中的补全项原样发回，
    // 服务器补齐 `documentation` / `detail` / `additionalTextEdits`（典型用途：接受这一项时自动加 import）。
    if (kind == "completionItemResolve") {
        // 与 `renameProvider.prepareProvider` 同类：`completionProvider.resolveProvider` 是嵌套能力，
        // 服务器没开就不发，前端据此照用项里已有的信息（supported=false）。
        if (!completion_resolve_supported(language_name)) {
            on_result({{"available", false}, {"supported", false}}, Json(nullptr));
            return;
        }
        if (!args.contains("raw") || !args.at("raw").is_object()) {
            on_result(Json(nullptr), invalid("LSP_BAD_ARGS", "completionItemResolve needs the raw item"));
            return;
        }
        host->request("completionItem/resolve", args.at("raw"),
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                if (!result.is_object()) { on_result({{"available", false}, {"supported", true}}, Json(nullptr)); return; }
                Json payload{{"available", true}, {"supported", true}, {"raw", result}};
                if (result.contains("detail") && result.at("detail").is_string()) payload["detail"] = result.at("detail");
                if (result.contains("documentation")) payload["documentation"] = hover_text(result.at("documentation"));
                if (result.contains("insertText") && result.at("insertText").is_string()) payload["apply"] = result.at("insertText");
                // `additionalTextEdits` 是"接受这一项时要一并做的编辑"，形状与格式化返回的同一套（`text_edits`）。
                if (result.contains("additionalTextEdits")) {
                    auto edits = text_edits(result.at("additionalTextEdits"));
                    if (!edits.empty()) payload["additionalTextEdits"] = std::move(edits);
                }
                on_result(std::move(payload), Json(nullptr));
            });
        return;
    }
    // LSP `textDocument/diagnostic`（pull 模型，IDEA 的批处理 Inspection）：`previousResultId` 让
    // 服务器可以回答 `unchanged`，省一次全量重算；`full` 的 items 走**与推送同一套整形**。
    if (kind == "diagnostic") {
        Json arguments{{"textDocument", text_document(uri)}};
        const auto previous = string_at(args, "previousResultId");
        if (!previous.empty()) arguments["previousResultId"] = previous;
        host->request("textDocument/diagnostic", std::move(arguments),
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                if (!result.is_object()) { on_result({{"available", false}, {"supported", true}}, Json(nullptr)); return; }
                const auto result_kind = string_at(result, "kind");
                Json payload{{"available", true}, {"supported", true},
                             {"kind", result_kind.empty() ? std::string("full") : result_kind}};
                const auto result_id = string_at(result, "resultId");
                if (!result_id.empty()) payload["resultId"] = result_id;
                if (payload.at("kind").get<std::string>() == "full")
                    payload["items"] = result.contains("items") ? shape_diagnostics(result.at("items")) : Json::array();
                on_result(std::move(payload), Json(nullptr));
            });
        return;
    }
    // 链上每个分支都 return，走到这里只可能是没有分支认领这个 kind。
    on_result(Json(nullptr), invalid("LSP_BAD_KIND", "unknown semantic kind"));
}

}  // namespace lsp
}  // namespace taocode