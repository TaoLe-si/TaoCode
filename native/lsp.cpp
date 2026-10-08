#include "lsp.hpp"

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace taocode {
namespace lsp {
namespace {

void protocol_error(const std::string& detail) {
    throw WorkspaceError("LSP_PROTOCOL", "Language server protocol error: " + detail);
}

std::string_view trim(std::string_view value) {
    while (!value.empty() && (value.front() == ' ' || value.front() == '\t')) value.remove_prefix(1);
    while (!value.empty() && (value.back() == ' ' || value.back() == '\t')) value.remove_suffix(1);
    return value;
}

bool equal_ignore_case(std::string_view left, std::string_view right) {
    if (left.size() != right.size()) return false;
    for (std::size_t i = 0; i != left.size(); ++i) {
        char a = left[i], b = right[i];
        if (a >= 'A' && a <= 'Z') a = static_cast<char>(a - 'A' + 'a');
        if (b >= 'A' && b <= 'Z') b = static_cast<char>(b - 'A' + 'a');
        if (a != b) return false;
    }
    return true;
}

// Parse a strictly decimal, non-negative, non-empty integer without exceptions so
// a malformed header cannot throw std::invalid_argument out of the reader.
bool parse_length(std::string_view text, std::size_t& out) {
    text = trim(text);
    if (text.empty() || text.size() > 16) return false;
    std::size_t value = 0;
    for (char ch : text) {
        if (ch < '0' || ch > '9') return false;
        value = value * 10 + static_cast<std::size_t>(ch - '0');
    }
    out = value;
    return true;
}

// LSP positions are UTF-16 code units, not bytes. Counting them costs a byte scan
// over the prefix only, so didChange stays honest on non-ASCII lines instead of
// silently shifting every column after a CJK identifier.
std::size_t utf16_units(const std::string& text, std::size_t limit) {
    std::size_t units = 0;
    for (std::size_t i = 0; i != limit; ++i) {
        const auto byte = static_cast<unsigned char>(text[i]);
        if (byte >= 0x80 && byte < 0xC0) continue;        // UTF-8 continuation
        if (byte >= 0xF0) ++units;                        // a surrogate pair
        ++units;
    }
    return units;
}

// Byte offset -> {line, character}, 0-based, with `character` in UTF-16 units.
Json position_at(const std::string& text, std::size_t offset) {
    std::size_t line = 0, line_start = 0;
    for (std::size_t i = 0; i != offset && i != text.size(); ++i)
        if (text[i] == '\n') { ++line; line_start = i + 1; }
    return Json{{"line", line}, {"character", utf16_units(text.substr(line_start, offset - line_start), offset - line_start)}};
}

// The one TextEdit that turns `before` into `after`, expressed as a range to
// replace: the common prefix and suffix are kept, so typing at the caret sends a
// couple of characters instead of the whole file (TextDocumentSyncKind.Incremental).
Json incremental_change(const std::string& before, const std::string& after) {
    const std::size_t common = std::min(before.size(), after.size());
    std::size_t prefix = 0;
    while (prefix != common && before[prefix] == after[prefix]) ++prefix;
    std::size_t suffix = 0;
    while (suffix != common - prefix && before[before.size() - 1 - suffix] == after[after.size() - 1 - suffix]) ++suffix;
    const std::size_t start = prefix;
    const std::size_t end = before.size() - suffix;
    return Json{{"range", {{"start", position_at(before, start)}, {"end", position_at(before, end)}}},
                {"text", after.substr(start, after.size() - suffix - start)}};
}

int edit_line(const Json& edit, const char* corner) {
    if (!edit.is_object() || !edit.contains("range") || !edit.at("range").is_object()) return 0;
    const auto& range = edit.at("range");
    if (!range.contains(corner) || !range.at(corner).is_object()) return 0;
    const auto& point = range.at(corner);
    return point.contains("line") && point.at("line").is_number_integer() ? point.at("line").get<int>() : 0;
}

int edit_character(const Json& edit, const char* corner) {
    if (!edit.is_object() || !edit.contains("range") || !edit.at("range").is_object()) return 0;
    const auto& range = edit.at("range");
    if (!range.contains(corner) || !range.at(corner).is_object()) return 0;
    const auto& point = range.at(corner);
    return point.contains("character") && point.at("character").is_number_integer() ? point.at("character").get<int>() : 0;
}

// One document's share of a WorkspaceEdit: the edits to splice plus the version
// the server saw (from OptionalVersionedTextDocumentIdentifier), -1 when absent.
struct DocumentEdit {
    Json edits = Json::array();
    int version = -1;
};

// WorkspaceEdit -> uri -> {TextEdit[], version}. Both wire forms are accepted:
// `changes` (uri -> TextEdit[]) and `documentChanges` (TextDocumentEdit with
// textDocument.uri/version + edits). Create/rename/delete file operations carry no
// text edits: they are counted into `skipped_operations` instead of being silently
// dropped, because `workspace/applyEdit`'s answer must say what really happened
// (see Client::answer_apply_edit).
std::map<std::string, DocumentEdit> collect_document_edits(const Json& edit, std::size_t& skipped_operations) {
    std::map<std::string, DocumentEdit> documents;
    skipped_operations = 0;
    if (!edit.is_object()) return documents;
    const auto push = [&documents](const std::string& uri, const Json& edits, int version) {
        if (uri.empty() || !edits.is_array()) return;
        auto& document = documents[uri];
        for (const auto& item : edits)
            if (item.is_object() && item.contains("range")) document.edits.push_back(item);
        if (version >= 0) document.version = version;
    };
    if (edit.contains("changes") && edit.at("changes").is_object())
        for (const auto& entry : edit.at("changes").items()) push(entry.key(), entry.value(), -1);
    if (edit.contains("documentChanges") && edit.at("documentChanges").is_array())
        for (const auto& change : edit.at("documentChanges")) {
            if (!change.is_object()) { ++skipped_operations; continue; }
            // 没有 `edits` 的那一支就是 create/rename/delete（`CreateFile`/`RenameFile`/`DeleteFile`
            // 三个 ResourceOperation，形状是 `{kind, uri[, newUri]}` / `{kind, edits?}` 里没有 edits）。
            // 本客户端只会往已经在的文件里落 TextEdit，不做文件的增/改名/删 —— 这一条必须**计数**，
            // 不能一句 continue 混过去：客户端能力表里写着 `resourceOperations: [create, rename, delete]`
            // （`native/lsp_host_bootstrap.cpp` 的 workspaceEdit 段），回给服务器的 `applied`
            // 却把没做过的事算成做过 = 比回一个 -32601 更难查的错。
            if (!change.contains("edits")) { ++skipped_operations; continue; }
            const auto& identifier = change.contains("textDocument") && change.at("textDocument").is_object()
                                         ? change.at("textDocument") : Json::object();
            const auto uri = identifier.contains("uri") && identifier.at("uri").is_string()
                                 ? identifier.at("uri").get<std::string>() : std::string();
            const int version = identifier.contains("version") && identifier.at("version").is_number_integer()
                                    ? identifier.at("version").get<int>() : -1;
            push(uri, change.at("edits"), version);
        }
    // Back-to-front: splicing from the end keeps every earlier offset valid.
    for (auto& [uri, document] : documents)
        std::sort(document.edits.begin(), document.edits.end(), [](const Json& left, const Json& right) {
            const auto line = std::make_pair(edit_line(left, "start"), edit_character(left, "start"));
            const auto other = std::make_pair(edit_line(right, "start"), edit_character(right, "start"));
            if (line != other) return line > other;
            return std::make_pair(edit_line(left, "end"), edit_character(left, "end")) >
                   std::make_pair(edit_line(right, "end"), edit_character(right, "end"));
        });
    return documents;
}

// 服务器**主动**发来的、不在「我们发过请求」的配对里的方法，本客户端怎么认、怎么答。
// 上游逐条（`platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt`）：
//   · `:396-404` `logMessage` —— 写进语言服务日志（`LanguageServiceLogger`/Services 控制台），
//     只有 Error/Warning 才另外弹一条通知；通知与日志是两种处置，所以前端要分得清这两条。
//   · `:385-390` `showMessage` —— 日志 + 通知，都只带消息本身。
//   · `:377-383` `showMessageRequest` —— logInfo 里连 `actions` 的标题一起写（`msg: a, b`），
//     通知带按钮，返回值是用户点的那一项（没点就 null）。
//   · `:341-368` 五条 `workspace/…/refresh` —— 每条都 `completedFuture(null)`（协议的返回类型是 void），
//     并让对应的缓存作废/重取（`LspClientImpl.kt:223-265`、`LspHighlightingCacheRegistry.kt:46-56`）。
//     `refreshInlineValues`（`:360`）在上游就是**什么也不做**只答 null，这里一并列进来。
//   · 服务器**主动发起**的另外几条请求（不是通知，客户端必须回包）也在本文件里答：
//     `client/registerCapability`/`client/unregisterCapability`（上游 `:119-123`/`:125-128`，
//     两条都 `completedFuture(null)`，上游还把它们记进 `LspDynamicCapabilities`（`:117`））、
//     `window/workDoneProgress/create`（上游 `:255` 一行 `completedFuture(null)`）、
//     `workspace/configuration`（上游 `:249-253`，按 items 逐条回值）、
//     `workspace/applyEdit`（上游 `:84-117`，回的是**真实**的 applied）、
//     `workspace/workspaceFolders`（上游 `:241-247`，回每个根一份 `WorkspaceFolder(uri, name)`）。
//     这六条在客户端能力表里都声明了支持（`native/lsp_host_bootstrap.cpp:272-280`）⇒ 一条都不许不回。
//   · `workspace/documentContent/refresh` 不在这张表里：那是动态文档内容
//     （`:369-374` 的 `dynamicFiles.refreshContent`），本仓没有那一层 ⇒ 照旧答 MethodNotFound，
//     与「声明与实发一致」那条纪律同口径（不为做不到的事回一个"支持"）。
bool is_refresh_request(const std::string& method) {
    static constexpr std::string_view names[] = {
        "workspace/semanticTokens/refresh", "workspace/codeLens/refresh", "workspace/inlayHint/refresh",
        "workspace/diagnostic/refresh", "workspace/inlineValue/refresh",
    };
    for (const auto name : names) {
        if (method == name) return true;
    }
    return false;
}

// 参数是 LSP 原本的形状（`{type,message}` / `{message,actions}` / refresh 的无参），
// 只补一个 `method` 键，让同一条出口的另一头分得清这是哪一种（宿主 `lsp_host_bootstrap.cpp` 原样转给界面）。
Json tag_server_message(Json params, std::string_view method) {
    if (!params.is_object()) params = Json::object();
    params["method"] = std::string(method);
    return params;
}

// `client/registerCapability` 的 `RegistrationParams.registrations` 与
// `client/unregisterCapability` 的 `UnregistrationParams.unregisterations`：
// 两条的形状只差一个键名，条目形状同为 LSP 的 `{id: string, method: string, registerOptions?: any}`
// （3.17 协议里前两个都是必填）。
//
// 为什么整包一起拒（而不是"能认几条认几条"）：`id` 是这一批登记的**撤销把手**，
// 半包登记会让服务器下一条 `client/unregisterCapability` 撤不掉它当初注册的那一条，
// 于是客户端留着一份服务器已经认为不存在的能力 —— 比直接回一个 InvalidParams 更难查。
// `failure` 只在返回 false 时有值，写的是**这一条为什么不算合法**（回包带的就是这个）。
bool collect_registrations(const Json& params, const char* key,
                           std::vector<std::pair<std::string, std::string>>& out, std::string& failure) {
    if (!params.is_object()) {
        failure = std::string(key) + ": parameters must be an object";
        return false;
    }
    if (!params.contains(key)) return true;  // 键整个缺省 = 一批都没有，合法的空批（回 null，不记任何东西）
    const auto& list = params.at(key);
    if (!list.is_array()) {
        failure = std::string("client/…capability: ") + key + " must be an array";
        return false;
    }
    for (const auto& entry : list) {
        if (!entry.is_object()) {
            failure = std::string(key) + ": each entry needs an id and a method";
            return false;
        }
        if (!entry.contains("id") || !entry.at("id").is_string()) {
            failure = std::string(key) + ": registration id must be a string (it is the handle unregisterCapability uses)";
            return false;
        }
        if (!entry.contains("method") || !entry.at("method").is_string()) {
            failure = std::string(key) + ": registration method must be a string";
            return false;
        }
        out.emplace_back(entry.at("id").get<std::string>(), entry.at("method").get<std::string>());
    }
    return true;
}

}  // namespace

void MessageReader::feed(std::string_view bytes) { buffer_.append(bytes); }

std::optional<Json> MessageReader::next() {
    const auto separator = buffer_.find("\r\n\r\n");
    if (separator == std::string::npos) {
        if (buffer_.size() > max_header_bytes) protocol_error("header block is not terminated");
        return std::nullopt;
    }
    std::size_t content_length = 0;
    bool have_length = false;
    std::string_view headers{buffer_.data(), separator};
    std::size_t line_start = 0;
    for (;;) {
        const auto newline = headers.find("\r\n", line_start);
        const auto line_end = newline == std::string_view::npos ? headers.size() : newline;
        const auto line = headers.substr(line_start, line_end - line_start);
        if (!line.empty()) {
            const auto colon = line.find(':');
            if (colon == std::string_view::npos) protocol_error("malformed header line");
            if (equal_ignore_case(trim(line.substr(0, colon)), "content-length")) {
                if (have_length) protocol_error("duplicate content-length header");
                if (!parse_length(line.substr(colon + 1), content_length))
                    protocol_error("invalid content-length value");
                have_length = true;
            }
        }
        if (newline == std::string_view::npos) break;
        line_start = newline + 2;
    }
    if (!have_length) protocol_error("missing content-length header");
    if (content_length == 0) protocol_error("content-length must be positive");
    if (content_length > max_message_bytes) protocol_error("content-length exceeds the message limit");
    const std::size_t body_start = separator + 4;
    if (buffer_.size() < body_start + content_length) return std::nullopt;
    const std::string body = buffer_.substr(body_start, content_length);
    buffer_.erase(0, body_start + content_length);
    Json message;
    try {
        message = Json::parse(body);
    } catch (const Json::exception&) {
        protocol_error("body is not valid JSON");
    }
    return message;
}

std::string encode_message(const Json& message) {
    const std::string body = message.dump();
    return "Content-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
}

Json make_request(std::int64_t id, std::string_view method, Json params) {
    return {{"jsonrpc", "2.0"}, {"id", id}, {"method", std::string(method)}, {"params", std::move(params)}};
}

Json make_notification(std::string_view method, Json params) {
    return {{"jsonrpc", "2.0"}, {"method", std::string(method)}, {"params", std::move(params)}};
}

bool is_response(const Json& message) {
    return message.is_object() && message.contains("id") &&
           (message.contains("result") || message.contains("error"));
}

bool is_server_request(const Json& message) {
    return message.is_object() && message.contains("id") && message.contains("method");
}

bool is_notification(const Json& message) {
    return message.is_object() && message.contains("method") && !message.contains("id");
}

void Client::send(const Json& message) { writer_(encode_message(message)); }

void Client::respond(const Json& id, Json result, Json error) {
    Json response{{"jsonrpc", "2.0"}, {"id", id}};
    if (error.is_null())
        response["result"] = std::move(result);
    else
        response["error"] = std::move(error);
    send(response);
}

Client::~Client() {
    // Any request still outstanding gets its answer before the watchdog stops, so
    // tearing a host down can never strand a caller.
    fail_pending("LSP_CLOSED");
    {
        std::lock_guard lock(mutex_);
        watching_ = false;
    }
    due_.notify_all();
    if (watchdog_.joinable()) watchdog_.join();
}

void Client::set_timeout(std::chrono::milliseconds timeout) {
    std::lock_guard lock(mutex_);
    timeout_ = timeout;
}

std::chrono::milliseconds Client::timeout() const {
    std::lock_guard lock(mutex_);
    return timeout_;
}

// Wakes the watchdog after a new deadline was registered. `lock` must already
// hold mutex_; it is released for the duration of the notify so the watchdog can
// take the lock without waiting for the caller to finish its own work.
void Client::wake_watchdog(std::unique_lock<std::mutex>& lock) {
    lock.unlock();
    due_.notify_all();
    lock.lock();
}

std::int64_t Client::send_request(std::string_view method, Json params, Handler on_result) {
    std::int64_t id = 0;
    std::unique_lock lock(mutex_);
    if (pending_.size() >= max_pending_requests) {  // a server that never answers cannot grow the map
        Handler rejected = std::move(on_result);
        lock.unlock();
        if (rejected) rejected(Json(nullptr), Json{{"code", -32001}, {"message", "LSP_BUSY"}});
        return 0;
    }
    id = next_id_++;
    pending_.emplace(id, Pending{std::move(on_result), std::chrono::steady_clock::now() + timeout_});
    ++wake_;
    // The watchdog sleeps until the earliest deadline, so a new (possibly earlier)
    // one has to wake it. It is started lazily: a client that never issues a
    // request pays no thread.
    if (!watchdog_.joinable()) {
        watching_ = true;
        watchdog_ = std::thread([this] { watchdog_loop(); });
    }
    wake_watchdog(lock);
    lock.unlock();
    send(make_request(id, method, std::move(params)));
    return id;
}

// Answers requests whose deadline has passed. Runs on its own thread so a server
// that accepted the request and then hung still gets a bounded wait in the UI.
void Client::watchdog_loop() {
    std::vector<Handler> expired;
    for (;;) {
        expired.clear();
        std::unique_lock lock(mutex_);
        if (!watching_) return;
        auto deadline = std::chrono::steady_clock::time_point::max();
        for (const auto& [id, entry] : pending_) deadline = std::min(deadline, entry.deadline);
        if (deadline == std::chrono::steady_clock::time_point::max()) {
            due_.wait(lock, [this] { return !watching_ || !pending_.empty(); });
            continue;
        }
        // The wait must also break when a *new* request registered an earlier
        // deadline: notify_all() alone only re-runs the predicate, and would put
        // us back to sleep until the absolute time picked before.
        const auto ticket = wake_;
        if (due_.wait_until(lock, deadline, [this, ticket] { return !watching_ || wake_ != ticket; })) {
            if (!watching_) return;  // told to stop
        }
        const auto now = std::chrono::steady_clock::now();
        for (auto entry = pending_.begin(); entry != pending_.end();) {
            if (entry->second.deadline > now) { ++entry; continue; }
            if (entry->second.handler) expired.push_back(std::move(entry->second.handler));
            entry = pending_.erase(entry);
        }
        lock.unlock();
        for (auto& handler : expired)
            handler(Json(nullptr), Json{{"code", -32000}, {"message", "TIMEOUT"}});
        expired.clear();
    }
}

bool Client::cancel(std::int64_t id) {
    Handler dropped;
    {
        std::lock_guard lock(mutex_);
        const auto pending = pending_.find(id);
        if (pending == pending_.end()) return false;
        dropped = std::move(pending->second.handler);
        pending_.erase(pending);
    }
    send(make_notification("$/cancelRequest", Json{{"id", id}}));
    if (dropped) dropped(Json(nullptr), Json{{"code", -32800}, {"message", "CANCELLED"}});
    return true;
}

void Client::fail_pending(const std::string& code) {
    std::vector<Handler> orphaned;
    {
        std::lock_guard lock(mutex_);
        orphaned.reserve(pending_.size());
        for (auto& [id, entry] : pending_) {
            if (entry.handler) orphaned.push_back(std::move(entry.handler));
        }
        pending_.clear();
    }
    Json error{{"code", -32001}, {"message", code}};
    for (auto& handler : orphaned) handler(Json(nullptr), error);
}

// `workspace/applyEdit`: the server asks the IDE to write a WorkspaceEdit (quick
// fix, organize imports, a rename the server computed). The edits are grouped per
// document, sorted back-to-front and handed to the installed editor, which owns
// the file writes; the reply carries the real outcome.
//
// 「真实结果」是这一支的全部要点（上游同一形状：`LspServerNotificationsHandlerImpl.kt:94-117`
// —— applier 建不出来 / 写失败时那个 `finally` 支补的就是 `ApplyWorkspaceEditResponse(false)`）：
//   · 一份编辑里有任何一条 create/rename/delete ⇒ **一条都不写**，直接 `applied:false` + 理由。
//     先写完文本编辑再回 false 会留下「一半落盘、一半没落」的状态，服务器按 `applied:false`
//     以为整份没做，界面里却已经改过了；拒在写之前是唯一可解释的形状。
//     （声明侧那三样 `resourceOperations` 怎么补真，写在 docs/wiring-requests-2026-10-06-lspmsg.md 的 R10。）
//   · 一份完全不含任何动作的编辑（`{}` / `changes:{}`）按定义就是已应用：没有东西要写，也没有失败。
void Client::answer_apply_edit(const Json& id, const Json& params) {
    const auto edit = params.is_object() && params.contains("edit") ? params.at("edit") : Json(nullptr);
    if (!edit.is_object()) {
        respond(id, Json(nullptr), Json{{"code", -32602}, {"message", "workspace/applyEdit needs an edit object"}});
        return;
    }
    std::size_t skipped = 0;
    const auto documents = collect_document_edits(edit, skipped);
    if (skipped > 0) {
        respond(id, Json{{"applied", false},
                         {"failureReason", "this client applies TextEdit only: " + std::to_string(skipped) +
                                           " create/rename/delete resource operation(s) were not applied, so nothing was written"},
                         {"error", {{"code", "APPLY_EDIT_FAILED"},
                                    {"message", "resource operations are not supported by this client"}}}},
                Json(nullptr));
        return;
    }
    if (documents.empty()) {
        // An edit with no operation at all is applied by definition: there is nothing to write.
        respond(id, Json{{"applied", true}}, Json(nullptr));
        return;
    }
    if (!editor_) {
        respond(id, Json{{"applied", false},
                         {"failureReason", "no workspace editor is attached to this language server"},
                         {"error", {{"code", "APPLY_EDIT_FAILED"}, {"message", "no workspace editor is attached"}}}},
                Json(nullptr));
        return;
    }
    for (const auto& [uri, document] : documents) {
        if (document.edits.empty()) continue;
        if (const auto failure = editor_(uri, document.edits, document.version)) {
            respond(id, Json{{"applied", false},
                             {"failureReason", *failure},
                             {"error", {{"code", "APPLY_EDIT_FAILED"}, {"message", *failure}}}},
                    Json(nullptr));
            return;
        }
    }
    respond(id, Json{{"applied", true}}, Json(nullptr));
}

// `workspace/workspaceFolders`：能力在 initialize 里已经声明了（宿主那份客户端能力表的
// `workspace.workspaceFolders: true`，见 `lsp_host_bootstrap.cpp`），于是服务器**有权**来问这一份表。
// 上游同一条：`platform/lsp/src/api/Lsp4jClient.kt:71-72` 转给处置器，
// `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:241-247` 把项目的每个根映射成
// `WorkspaceFolder(uri, name)`，项目没了回 emptyList。协议的返回类型是 `WorkspaceFolder[] | null`，
// `null` 那一支留给"客户端没有文件夹"这一种（我们没在 initialize 里发过那份表时就是它）。
//
// 这一支是本轮补的**真缺陷**：以前分派表里没有它 ⇒ 落到 :592 的兜底回 -32601
// —— 声明了能力却不认得这条请求，服务器问到的是"不认得"，只能按"客户端不支持"继续，
// 于是它给多根工作区算的那些结果（源根、依赖范围）会静默按单根走。
void Client::answer_workspace_folders(const Json& id) {
    Json folders = nullptr;
    {
        std::lock_guard lock(mutex_);
        folders = workspace_folders_;
    }
    respond(id, std::move(folders), Json(nullptr));
}

// `client/registerCapability`：协议返回 void ⇒ 客户端唯一"合法"的答复是回 null（收下）。
// 上游做得更多一点：`LspServerNotificationsHandlerImpl.kt:119-123` 把每条 registration 存进
// `LspDynamicCapabilities`（`:117` 的 `capabilityToInfo.putValue(registration.method, …)`），
// 再 `restartHighlightingIfNeeded(...)`（`:130-182`）让受影响的那几族结果重取。
// 本仓这一层：形状校验 + 原样转给界面（记账与作废缓存都在 `src/lspServerMessages.ts`，
// 那里才是"谁看得见这件事"的那一头）+ 回包。
//
// 次序是**先答再转**：转出走的是宿主那条事件回调，它万一抛（前端没装出口 / JSON 形状意外），
// 也不能把这条回包一起带走 —— 服务器那条 future 等不到答复就会把它后面所有的请求排在同一条
// 等待上，界面看到的"语言服务卡住"就是这么来的。
void Client::answer_register_capability(const Json& id, const Json& params) {
    std::vector<std::pair<std::string, std::string>> registrations;
    std::string failure;
    if (!collect_registrations(params, "registrations", registrations, failure)) {
        respond(id, Json(nullptr), Json{{"code", -32602}, {"message", failure}});
        return;
    }
    respond(id, Json(nullptr), Json(nullptr));
    forward_server_request(params, "client/registerCapability");
}

// `client/unregisterCapability`：同一形状，键名是 `unregisterations`（上游 `:125-128`，
// 它按 `unregistration.method` 找到那一族再把那个 id 摘掉）。撤一个本端没登记过的 id 不算错
// —— 服务器可以在自己那侧已经忘掉它之后又撤一次，所以这里**照旧回 null**，
// 由界面那一头的日志如实写"其中 N 项本端没有登记过"。
void Client::answer_unregister_capability(const Json& id, const Json& params) {
    std::vector<std::pair<std::string, std::string>> unregistrations;
    std::string failure;
    if (!collect_registrations(params, "unregisterations", unregistrations, failure)) {
        respond(id, Json(nullptr), Json{{"code", -32602}, {"message", failure}});
        return;
    }
    respond(id, Json(nullptr), Json(nullptr));
    forward_server_request(params, "client/unregisterCapability");
}

// `window/workDoneProgress/create`：协议返回 void，上游就是一行
// `override fun createProgress(params: WorkDoneProgressCreateParams) = completedFuture(null)`
// （`LspServerNotificationsHandlerImpl.kt:255`）—— 同意，不做别的事，真正的行是之后那条
// `$/progress` 的 begin 才建的（`:266-314`）。
// 但 `token` 是这条参数的**必填**字段（`WorkDoneProgressCreateParams { token: ProgressToken }`，
// ProgressToken = integer | string）：没有 token 的"申请"服务器自己 later 也发不出对应的 `$/progress`，
// 所以缺字段就当 InvalidParams 明着拒（回包照样给出去，不留挂着的那条），并把原样参数转出去留一行。
void Client::answer_create_progress(const Json& id, const Json& params) {
    const bool has_token = params.is_object() && params.contains("token") &&
                           (params.at("token").is_string() || params.at("token").is_number_integer());
    respond(id, Json(nullptr), has_token ? Json(nullptr)
                                         : Json{{"code", -32602},
                                                {"message", "window/workDoneProgress/create needs a string or integer token"}});
    forward_server_request(params, "window/workDoneProgress/create");
}

// 服务器请求的原样参数（补 `method`）交给界面那一条出口。没装出口（离线自测 / 服务器停了之后）
// 就什么都不做 —— 回包已经在调用它的那一行先给出去了，协议这一头不受影响。
void Client::forward_server_request(const Json& params, std::string_view method) {
    Notify sink;
    {
        std::lock_guard lock(mutex_);
        sink = server_message_;
    }
    if (!sink) return;
    sink(tag_server_message(params, method));
}

void Client::start(Json initialize_params, Handler on_result) {
    if (state_ != State::fresh) protocol_error("start called on a non-fresh client");
    state_ = State::initializing;
    // 记住我们**告诉过**服务器的工作区文件夹，之后它用 `workspace/workspaceFolders` 来问时回同一份。
    // 在 `state_ = initializing` 之后、发请求之前就取：initialize 的回包一到，服务器随时可以问。
    {
        std::lock_guard lock(mutex_);
        workspace_folders_ = initialize_params.is_object() && initialize_params.contains("workspaceFolders")
                                 ? initialize_params.at("workspaceFolders") : Json(nullptr);
    }
    send_request("initialize", std::move(initialize_params), [this, handler = std::move(on_result)](Json result, Json error) {
        if (!error.is_null()) {
            state_ = State::failed;
            handler(std::move(result), std::move(error));
            return;
        }
        state_ = State::ready;
        notify("initialized", Json::object());
        if (!configuration_.empty()) notify("workspace/didChangeConfiguration", {{"settings", configuration_}});
        handler(std::move(result), Json(nullptr));
    });
}

void Client::shutdown(Handler on_result) {
    if (state_ == State::stopped || state_ == State::stopping) return;
    state_ = State::stopping;
    send_request("shutdown", Json(nullptr), [this, handler = std::move(on_result)](Json result, Json error) {
        notify("exit", Json(nullptr));
        state_ = State::stopped;
        handler(std::move(result), std::move(error));
    });
}

void Client::notify(std::string_view method, Json params) { send(make_notification(method, std::move(params))); }

void Client::did_open(const std::string& uri, const std::string& language_id, int version, const std::string& text) {
    synced_[uri] = text;  // the baseline the next didChange diffs against
    notify("textDocument/didOpen", {{"textDocument", {{"uri", uri}, {"languageId", language_id}, {"version", version}, {"text", text}}}});
}

void Client::did_change(const std::string& uri, int version, const std::string& full_text) {
    Json changes = Json::array();
    if (sync_kind_ == SyncKind::incremental) {
        const auto previous = synced_.find(uri);
        // Only a known baseline can be diffed; the first change after a didOpen we
        // did not see (or a server restart) still carries the whole document.
        if (previous != synced_.end() && full_text != previous->second)
            changes.push_back(incremental_change(previous->second, full_text));
    }
    if (changes.empty()) changes.push_back(Json{{"text", full_text}});
    synced_[uri] = full_text;
    notify("textDocument/didChange", {{"textDocument", {{"uri", uri}, {"version", version}}},
                                      {"contentChanges", std::move(changes)}});
}

void Client::did_close(const std::string& uri) {
    synced_.erase(uri);
    notify("textDocument/didClose", {{"textDocument", {{"uri", uri}}}});
}

std::int64_t Client::request(std::string_view method, Json params, Handler on_result) {
    return send_request(method, std::move(params), std::move(on_result));
}

void Client::set_configuration(Json settings) {
    configuration_ = std::move(settings);
    if (ready()) notify("workspace/didChangeConfiguration", {{"settings", configuration_}});
}

void Client::receive(const Json& message) {
    if (is_response(message)) {
        if (!message.at("id").is_number_integer()) return;  // we only issue integer ids
        const auto id = message.at("id").get<std::int64_t>();
        Handler handler;
        {
            std::lock_guard lock(mutex_);
            const auto pending = pending_.find(id);
            if (pending == pending_.end()) return;
            handler = std::move(pending->second.handler);
            pending_.erase(pending);
        }
        Json error = message.contains("error") ? message.at("error") : Json(nullptr);
        Json result = message.contains("result") ? message.at("result") : Json(nullptr);
        handler(std::move(result), std::move(error));
        return;
    }
    if (is_notification(message)) {
        const auto& method = message.at("method");
        if (!method.is_string()) return;
        const auto name = method.get<std::string>();
        Notify handler;
        if (name == "textDocument/publishDiagnostics") {
            std::lock_guard lock(mutex_);
            handler = diagnostics_;
        }
        // LSP `$/progress`（`window/workDoneProgress/create` 之后服务器发的那条）—— 上游
        // `LspServerNotificationsHandlerImpl.notifyProgress`（:257-328）把它变成一条带百分比的
        // 后台任务；本仓同样交出去，不再像以前那样直接丢弃。
        else if (name == "$/progress") {
            std::lock_guard lock(mutex_);
            handler = progress_;
        }
        // 服务器自己要说的整条消息（不是进度）：原样交给宿主去显示。
        else if (name == "window/showMessage") {
            std::lock_guard lock(mutex_);
            handler = server_message_;
        }
        // `window/logMessage`：服务器的日志行。上游把它写进「语言服务」日志、只有 Error/Warning
        // 才另外弹通知（`LspServerNotificationsHandlerImpl.kt:396-404`），所以这条**必须**与
        // `window/showMessage` 分得开 —— 一起丢掉就等于 jdt.ls 的自述整条看不见。
        else if (name == "window/logMessage") {
            std::lock_guard lock(mutex_);
            handler = server_message_;
        }
        if (!handler) return;
        // 交给同一条出口的这几条都带一个 `method`：参数形状一样（`{type,message}`），
        // 但界面要按上游的两种处置分开（showMessage 必弹 / logMessage 只进日志）。
        Json payload = message.contains("params") ? message.at("params") : Json(nullptr);
        if (name == "window/showMessage" || name == "window/logMessage") payload = tag_server_message(std::move(payload), name);
        handler(std::move(payload));
        return;
    }
    if (is_server_request(message)) {
        if ((!message.at("id").is_number_integer() && !message.at("id").is_string()) || !message.at("method").is_string()) return;
        const auto& id = message.at("id");
        const auto method = message.at("method").get<std::string>();
        // 服务器**主动发起**的那六条请求，逐条都有回包（本轮之前少了 workspace/workspaceFolders 那一支，
        // 它掉进下面的 -32601 兜底 —— 而这份客户端能力表里 `workspace.workspaceFolders` 是 true）。
        if (method == "window/workDoneProgress/create")
            answer_create_progress(id, message.value("params", Json(nullptr)));
        else if (method == "client/registerCapability")
            answer_register_capability(id, message.value("params", Json(nullptr)));
        else if (method == "client/unregisterCapability")
            answer_unregister_capability(id, message.value("params", Json(nullptr)));
        else if (method == "workspace/workspaceFolders")
            answer_workspace_folders(id);
        else if (method == "workspace/configuration") {
            const auto params = message.value("params", Json::object());
            if (!params.is_object() || !params.contains("items") || !params.at("items").is_array()) {
                respond(id, Json(nullptr), {{"code", -32602}, {"message", "Configuration items must be an array"}});
                return;
            }
            Json values = Json::array();
            for (const auto& item : params.at("items")) {
                if (!item.is_object() || (item.contains("section") && !item.at("section").is_string())) {
                    respond(id, Json(nullptr), {{"code", -32602}, {"message", "Invalid configuration section"}});
                    return;
                }
                const auto section = item.value("section", std::string());
                const Json* value = &configuration_;
                std::size_t start = 0;
                while (start < section.size() && value) {
                    const auto dot = section.find('.', start);
                    const auto key = section.substr(start, dot == std::string::npos ? dot : dot - start);
                    value = value->is_object() && value->contains(key) ? &value->at(key) : nullptr;
                    if (dot == std::string::npos) break;
                    start = dot + 1;
                }
                values.push_back(value ? *value : Json(nullptr));
            }
            respond(id, std::move(values), Json(nullptr));
        }
        else if (method == "workspace/applyEdit")
            answer_apply_edit(id, message.value("params", Json(nullptr)));
        // 服务器主动要求「你手里那份结果过期了」（`workspace/…/refresh`，协议返回 void）与
        // 「问用户一句话」（`window/showMessageRequest`，返回 MessageActionItem 或 null）。
        // 上游逐条：`LspServerNotificationsHandlerImpl.kt:341-368`（refresh 一族全部
        // `completedFuture(null)`，并让对应缓存作废重取：`LspClientImpl.kt:223-265`）、
        // `:377-383`（showMessageRequest 先把消息与 `actions` 的标题写进日志，再弹带按钮的通知）。
        // 本仓按同一顺序做两件事，但**回包在前**（与上面那三条一样的理由：转出那头的回调万一抛，
        // 不能把回包一起带走，服务器会一直等）：先答回包，再交给同一条 `server_message_` 出口（带 `method`，
        // 前端的处置见 `src/lspServerMessages.ts`：refresh ⇒ 清掉前端那一族缓存，下一次读自然重取）：
        //   · refresh 答 null = 收到了；
        //   · showMessageRequest 答 null = 用户没有点任何一项（协议允许 `MessageActionItem | null`，
        //     上游把气球关掉也是这个值）。通知面现在只显示消息本身、还没有那一排按钮，
        //     按钮那半写在 docs/wiring-requests-2026-10-06-lsp.md 里要接线。
        else if (method == "window/showMessageRequest" || is_refresh_request(method)) {
            respond(id, Json(nullptr), Json(nullptr));
            forward_server_request(message.value("params", Json(nullptr)), method);
        }
        else
            respond(id, Json(nullptr), Json{{"code", -32601}, {"message", "Method not found"}});
    }
}

}  // namespace lsp
}  // namespace taocode
