#include "lsp_session.hpp"
#include "request_trace.hpp"
#include "lsp_support.hpp"

// 工具与整形在 `lsp_support.hpp/.cpp`（原匿名 namespace，2026-09-27 拆出以降低本文件行数）。
using namespace taocode::lsp::detail;

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace taocode {
namespace lsp {

Session::~Session() { shutdown_all(); }

std::string Session::language_for(const std::string& path) {
    const auto extension = extension_of(path);
    if (extension == "java") return "java";
    if (extension == "kt" || extension == "kts") return "kotlin";
    if (extension == "c") return "c";
    if (extension == "cpp" || extension == "cc" || extension == "cxx" || extension == "h" || extension == "hpp" || extension == "hh") return "cpp";
    if (extension == "ts") return "typescript";
    if (extension == "tsx") return "typescriptreact";
    if (extension == "js" || extension == "mjs" || extension == "cjs") return "javascript";
    if (extension == "jsx") return "javascriptreact";
    if (extension == "json") return "json";
    if (extension == "vue") return "vue";
    if (extension == "html") return "html";
    if (extension == "css") return "css";
    if (extension == "rs") return "rust";
    if (extension == "go") return "go";
    if (extension == "py") return "python";
    return extension;
}

std::string Session::to_uri(const std::string& path) const {
    const auto absolute = root_ / std::filesystem::path(std::u8string(path.begin(), path.end()));
    std::string generic = u8_path(absolute);
    // Windows: "C:/dir/file" -> "file:///C%3A/dir/file"; keep the drive colon percent-free.
    std::string encoded = percent_encode(generic);
    const std::string drive_colon = "%3A";
    for (std::size_t pos = encoded.find(drive_colon); pos != std::string::npos; pos = encoded.find(drive_colon, pos)) {
        encoded.replace(pos, drive_colon.size(), ":");
        pos += 1;
    }
    if (encoded.size() >= 1 && encoded[0] == '/') return "file://" + encoded;  // UNC or rooted
    return "file:///" + encoded;
}

std::string Session::to_path(const std::string& uri) const {
    return uri_to_relative(uri, root_);
}


Json Session::open(const std::string& path, const std::string& text) {
    const auto language = language_for(path);
    // A host whose initialize handshake failed can never become ready (the client is past
    // `fresh`), so a retry has to replace it. The doomed host is stopped with mutex_ released
    // — Host::stop() joins its reader thread, and that thread's callbacks take mutex_.
    std::unique_ptr<Host> doomed;
    bool retry = false;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        retry = has_server(language) && startup_errors_.count(language) != 0;
        const auto failed = hosts_.find(language);
        if (retry && failed != hosts_.end()) { doomed = std::move(failed->second); hosts_.erase(failed); }
    }
    if (doomed) { doomed->stop(); announce_progress_reset(language); }  // 换掉一台 = 它那批进度不会再有 `end`，界面不能留一条永远在转的行
    if (retry) {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        // Only now, with the reader joined: a late callback cannot resurrect the failure we clear.
        startup_errors_.erase(language);
        ready_.erase(language);
        capabilities_.erase(language);
        for (auto& [open_path, doc] : documents_)
            if (doc.language == language) doc.opened = false;
    }
    taocode::trace::Lock lock(mutex_, __FUNCSIG__);
    if (!has_server(language)) return language_status(language);
    Document& doc = documents_[path];
    doc.language = language;
    doc.uri = to_uri(path);
    doc.version = 1;
    doc.text = text;
    doc.opened = false;
    try {
        Host& host = ensure(language);
        if (ready_.count(language) && ready_[language]) { host.did_open(doc.uri, language, doc.version, text); doc.opened = true; }
    } catch (const WorkspaceError& error) {
        startup_errors_[language] = invalid(error.code, error.what());
    }
    return language_status(language);
}

void Session::change(const std::string& path, const std::string& text) {
    taocode::trace::Lock lock(mutex_, __FUNCSIG__);
    const auto document = documents_.find(path);
    if (document == documents_.end()) return;
    document->second.text = text;
    ++document->second.version;
    const auto host = hosts_.find(document->second.language);
    if (host != hosts_.end() && document->second.opened)
        host->second->did_change(document->second.uri, document->second.version, text);
}

void Session::close(const std::string& path) {
    Host* host = nullptr;
    std::string uri;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        const auto document = documents_.find(path);
        if (document == documents_.end()) return;
        uri = document->second.uri;
        const auto found = hosts_.find(document->second.language);
        if (found != hosts_.end() && document->second.opened) {
            host = found->second.get();
            document->second.opened = false;
        }
    }
    // Inform the server the document is closed (LSP lifecycle); not doing so leaves
    // stale diagnostics on JDT/TS after a tab closes. Then drop local state.
    if (host) host->did_close(uri);
    taocode::trace::Lock lock(mutex_, __FUNCSIG__);
    documents_.erase(path);
    pending_actions_.erase(path);
}

void Session::request(const std::string& kind, const std::string& path, int line, int character, ResultHandler on_result) {
    Host* host = nullptr;
    std::string uri;
    Json declined;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        const auto document = documents_.find(path);
        if (document == documents_.end()) declined = invalid("LSP_CLOSED", "document is not open");
        else {
            const auto found = hosts_.find(document->second.language);
            if (found == hosts_.end()) declined = invalid("LSP_UNAVAILABLE", "no language server");
            // A server that explicitly declined the provider gets a clear error
            // instead of a request it will only refuse.
            else if (const auto missing = unsupported(document->second.language, kind)) declined = Json(*missing);
            else {
                host = found->second.get();
                uri = document->second.uri;
            }
        }
    }
    // Every early answer is delivered outside the lock: a handler is allowed to
    // come straight back into the session.
    if (!declined.is_null()) { on_result(Json(nullptr), std::move(declined)); return; }
    const auto position = Json{{"line", line}, {"character", character}};
    if (kind == "hover") {
        host->request("textDocument/hover", {{"textDocument", text_document(uri)}, {"position", position}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                if (!result.is_object() || !result.contains("contents") || result.at("contents").is_null())
                    on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"contents", hover_text(result.at("contents"))}}, Json(nullptr));
            });
    } else if (kind == "definition" || kind == "declaration") {
        if (dispatch_navigation(kind, uri, *host, position, on_result)) return;
    } else if (kind == "completion") {
        host->request("textDocument/completion", {{"textDocument", text_document(uri)},
            {"position", position}, {"context", {{"triggerKind", 1}}}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json items = Json::array();
                const Json* source = nullptr;
                if (result.is_array()) source = &result;
                else if (result.is_object() && result.contains("items")) source = &result.at("items");
                if (source) {
                    for (const auto& item : *source) {
                        if (!item.is_object() || !item.contains("label")) continue;
                        Json entry{{"label", item.at("label")}, {"kind", completion_kind(item.value("kind", 1))}};
                        if (item.contains("detail") && item.at("detail").is_string()) entry["detail"] = item.at("detail");
                        if (item.contains("insertText") && item.at("insertText").is_string()) entry["apply"] = item.at("insertText");
                        // 有些服务器不等 resolve 就给了文档，能省一次往返。
                        if (item.contains("documentation")) entry["documentation"] = hover_text(item.at("documentation"));
                        // `raw` 是**服务器给的原始项**：`completionItem/resolve` 要求把它原样发回去
                        // （服务器靠里面的 `data` 找回条目）。与层级项用的是同一套做法。
                        entry["raw"] = item;
                        items.push_back(std::move(entry));
                    }
                }
                on_result({{"available", true}, {"items", std::move(items)}}, Json(nullptr));
            });
    } else {
        // 不是位置型 kind：转交 `semantic()` 的统一分派，而不是直接判死。
        // 两个入口各有自己的 kind 表，`request` 只管 hover/completion/definition；
        // **谁在谁的表里未知时转交给对方，是唯一不会漏的做法** —— 直接报 LSP_BAD_KIND
        // 会让「加进了 A 表但调用方走 B 入口」变成一个只在运行时才暴露的空功能
        // （已经发生过：completionItemResolve / diagnostic / prepareRename / foldingRange
        // 四个 kind 曾经打到这里，前端各自的 catch 又把错误吃掉了）。
        semantic(kind, path, line, character, Json::object(), std::move(on_result));
    }
}

void Session::set_configuration(const std::string& language, Json settings) {
    Host* host = nullptr;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        const auto config = config_.find(language);
        if (config == config_.end()) return;
        config->second.settings = settings;
        const auto found = hosts_.find(language);
        if (found != hosts_.end()) host = found->second.get();
    }
    if (host) host->set_configuration(std::move(settings));
}

// 文件操作通知。只有**声明了**对应 `workspace.fileOperations.<其一>` 的服务器才收得到 ——
// 对没声明的服务器发这些是协议噪音，而对声明了的服务器不发会让它的索引与磁盘不一致。
void Session::announce_file_operations(const std::string& kind, const std::vector<FileOperation>& files) {
    if (files.empty()) return;
    const char* capability = kind == "created" ? "didCreate" : kind == "renamed" ? "didRename"
                                                                                 : "didDelete";
    const char* method = kind == "created" ? "workspace/didCreateFiles"
                                            : kind == "renamed" ? "workspace/didRenameFiles"
                                                                : "workspace/didDeleteFiles";
    // 目标服务器在锁内挑好，发送在锁外做：一个通知的触发点可能正是某个回调里，
    // 而回调是 reader 线程带着 io_mutex_ 进来的。
    std::vector<Host*> targets;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        for (auto& [language, host] : hosts_) {
            const auto ready = ready_.find(language);
            if (ready == ready_.end() || !ready->second) continue;
            if (!file_operation_supported(language, capability)) continue;
            targets.push_back(host.get());
        }
    }
    if (targets.empty()) return;
    Json entries = Json::array();
    for (const auto& file : files) {
        if (file.path.empty()) continue;
        if (kind == "renamed") {
            if (file.previous.empty()) continue;
            entries.push_back({{"oldUri", to_uri(file.previous)}, {"newUri", to_uri(file.path)}});
        } else {
            entries.push_back({{"uri", to_uri(file.path)}});
        }
    }
    if (entries.empty()) return;
    const Json params{{"files", std::move(entries)}};
    for (Host* host : targets) host->notify(method, params);
}

void Session::semantic(const std::string& kind, const std::string& path, int line, int character, const Json& args,
                       ResultHandler on_result) {
    if (kind == "status") { on_result(status(path), Json(nullptr)); return; }
    Host* host = nullptr;
    std::string uri;
    // 有些能力是**嵌套**在 provider 里的（例如 `renameProvider.prepareProvider`），
    // 顶层的 `unsupported()` 查不到，所以这里把命中的语言带出来供分支自己再判一次。
    std::string language_name;
    Json declined;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        if (kind == "workspaceSymbol" || kind == "willRenameFiles" || kind == "workspaceDiagnostic") {
            // Server-wide query / file operation / whole-project inspection: no OPEN document
            // is required (a rename target is usually not open, and a whole-project
            // inspection names no file at all). Use the language implied by `path` when the
            // caller knows one, else any configured/running server.
            auto language = language_for(path);
            if (language.empty()) {
                if (!hosts_.empty()) language = hosts_.begin()->first;
                else if (!config_.empty()) language = config_.begin()->first;
            }
            const auto found = hosts_.find(language);
            if (found != hosts_.end()) host = found->second.get();
            else if (!language.empty() && config_.count(language) != 0) {
                try {
                    host = &ensure(language);
                } catch (const WorkspaceError& error) {
                    declined = invalid(error.code, error.what());
                }
            }
            language_name = language;
            if (declined.is_null() && !host) declined = invalid("LSP_UNAVAILABLE", "no language server");
            if (declined.is_null())
                if (const auto missing = unsupported(language, kind)) declined = Json(*missing);
        } else {
            const auto document = documents_.find(path);
            if (document == documents_.end()) declined = invalid("LSP_CLOSED", "document is not open");
            else {
                const auto found = hosts_.find(document->second.language);
                if (found == hosts_.end()) declined = invalid("LSP_UNAVAILABLE", "no language server");
                else if (const auto missing = unsupported(document->second.language, kind)) declined = Json(*missing);
                else {
                    host = found->second.get();
                    uri = document->second.uri;
                    language_name = document->second.language;
                }
            }
        }
    }
    if (!declined.is_null()) { on_result(Json(nullptr), std::move(declined)); return; }

    // 位置型的三个 kind 住在 `request()` 里（见那边的注释）：从本入口进来时转交过去。
    // 转交是**闭合环**：`request()` 对不认识的 kind 转回这里，两张表合起来覆盖全部 kind，
    // 从哪个入口进来都能到达。上面的门控已经放行，`request()` 会重新走一遍同样的门控，
    // 结果一致（同一份 capabilities_），所以这里不需要把 uri/host 传下去。
    if (kind == "hover" || kind == "completion" || kind == "definition") {
        request(kind, path, line, character, std::move(on_result));
        return;
    }

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
    on_result(Json(nullptr), invalid("LSP_BAD_KIND", "unknown semantic kind"));
}

// An error when the server explicitly declined the provider `kind` needs, so the
// UI is told why nothing came back instead of getting an empty success-shaped
// result. A server that said nothing at all (or whose handshake has not landed)
// is still asked: plenty of real servers implement more than they advertise.
// `renameProvider` 可以是 `true`（只支持 rename）或 `{prepareProvider: true}`（还支持 prepareRename）。
// 这个嵌套标志不在 `provider_for()` 的顶层表里，所以单独判一次。
// `completionProvider` 可以是 `true`（只有补全）或 `{resolveProvider: true}`（还能 resolve）。
// 与 `renameProvider.prepareProvider` 同类，属于嵌套能力，单独判一次。
// The workspace handle behind server-driven edits. Opened on first use and then
// kept, so a burst of quick fixes pays the (one-off) tree walk only once. A
// shared handle: switching the root replaces it, but an edit already in flight on
// a reader thread keeps its own reference alive.
std::shared_ptr<Workspace> Session::editor_workspace(const std::filesystem::path& root) {
    std::lock_guard lock(edit_mutex_);
    if (!editor_ || editor_root_ != root) {
        auto candidate = std::make_shared<Workspace>();
        candidate->open(root);
        editor_ = std::move(candidate);
        editor_root_ = root;
    }
    return editor_;
}

// `workspace/applyEdit`, one document. `edits` arrive already sorted back to
// front, so splicing them in order can never invalidate a later edit's offsets.
std::optional<std::string> Session::apply_document_edits(const std::string& uri, const Json& edits, int version) {
    std::filesystem::path root;
    std::string text;
    bool tracked = false;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        root = root_;
        const auto document = documents_.find(uri_to_relative(uri, root_));
        if (document != documents_.end()) {
            // The server's view of an open document is the text we last synced, not
            // whatever is on disk; edits computed against it land on that text.
            if (version >= 0 && version != document->second.version)
                return "the document changed since the server read it (version " + std::to_string(version) +
                       " vs " + std::to_string(document->second.version) + ")";
            text = document->second.text;
            tracked = true;
        }
    }
    const auto relative = uri_to_relative(uri, root);
    // Reject anything the workspace layer would refuse: no absolute paths, no
    // drive letters, no `..`, so a hostile or buggy server cannot write outside.
    if (escapes_root(relative)) return "the edit targets " + uri + ", which is outside the workspace root";
    if (root.empty()) return "no workspace root is open, so the edit cannot be applied";

    Json current;
    try {
        current = editor_workspace(root)->read(relative, "utf-8");
    } catch (const WorkspaceError& error) {
        return std::string("cannot read ") + relative + ": " + error.what();
    } catch (const std::exception& error) {
        return std::string("cannot read ") + relative + ": " + error.what();
    }
    if (!tracked) text = current.value("content", std::string());
    if (!current.contains("version") || !current.at("version").is_string())
        return std::string("cannot read ") + relative;

    std::size_t cursor = text.size();  // edits are back-to-front: walk once, from the end
    for (const auto& edit : edits) {
        if (!edit.is_object() || !edit.contains("range") || !edit.at("range").is_object()) continue;
        const auto& range = edit.at("range");
        const auto start = range.contains("start") && range.at("start").is_object() ? range.at("start") : Json::object();
        const auto end = range.contains("end") && range.at("end").is_object() ? range.at("end") : Json::object();
        const auto line_at = [](const Json& point, const char* key) {
            return point.contains(key) && point.at(key).is_number_integer() ? point.at(key).get<int>() : 0;
        };
        const auto from = offset_of(text, line_at(start, "line"), line_at(start, "character"));
        auto to = offset_of(text, line_at(end, "line"), line_at(end, "character"));
        if (to < from) to = from;
        if (from > text.size()) continue;
        if (to > text.size()) to = text.size();
        if (from > cursor) continue;  // out of order or overlapping: skip rather than corrupt
        const auto replacement = edit.contains("newText") && edit.at("newText").is_string()
                                     ? edit.at("newText").get<std::string>() : std::string();
        text.replace(from, to - from, replacement);
        cursor = from;
    }

    try {
        editor_workspace(root)->write(relative, text, current.at("version").get<std::string>(),
                                      current.value("encoding", std::string("utf-8")),
                                      current.value("bom", false));
    } catch (const WorkspaceError& error) {
        return std::string("cannot write ") + relative + ": " + error.what();
    } catch (const std::exception& error) {
        return std::string("cannot write ") + relative + ": " + error.what();
    }
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        const auto document = documents_.find(relative);
        if (document != documents_.end()) {
            document->second.text = text;   // keep the server's view and the file in step
            ++document->second.version;
        }
    }
    EditSink sink;
    {
        std::lock_guard lock(edit_mutex_);
        sink = on_edit_;
    }
    if (sink) sink(relative);
    return std::nullopt;
}

void Session::shutdown_all() noexcept {
    // The reader thread of a live host calls back into this session (diagnostics,
    // the deferred didOpen, code-action bookkeeping), and Host::stop() joins that
    // thread. Joining while holding mutex_ therefore deadlocks every single time,
    // so the hosts are moved out under the lock and stopped with it released.
    std::vector<std::unique_ptr<Host>> doomed;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        doomed.reserve(hosts_.size());
        for (auto& [language, host] : hosts_) doomed.push_back(std::move(host));
        hosts_.clear();
        documents_.clear();
        pending_actions_.clear();
        ready_.clear();
        capabilities_.clear();
    }
    announce_progress_reset();  // 停机先收进度（上游 cancelAllProgress，:331-339）
    for (auto& host : doomed) {
        if (!host) continue;
        try {
            host->request("shutdown", Json(nullptr), [](Json, Json) {});
        } catch (...) {
            // A host that cannot even take the request is stopped below anyway.
        }
        host->stop();  // joins the reader thread; mutex_ is NOT held here
    }
    // initialize failure callbacks may have run while stop joined the readers.
    taocode::trace::Lock lock(mutex_, __FUNCSIG__);
    startup_errors_.clear();
}

}  // namespace lsp
}  // namespace taocode
