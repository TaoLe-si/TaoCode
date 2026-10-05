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

    // 「每个 kind 怎么发、怎么整形」那整条 if 链在 native/lsp_session_kinds.cpp（2026-10-05 整段
    // 搬出，594 行）。它自己答掉「没有分支认领」这一种情况（LSP_BAD_KIND），所以这里没有返回值。
    dispatch_semantic_kind(kind, path, line, character, args, host, uri, language_name, on_result);
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
