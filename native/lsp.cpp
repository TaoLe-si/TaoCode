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
// text edits and are skipped — the client only writes files it is given edits for.
std::map<std::string, DocumentEdit> collect_document_edits(const Json& edit) {
    std::map<std::string, DocumentEdit> documents;
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
            if (!change.is_object() || !change.contains("edits")) continue;
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
void Client::answer_apply_edit(const Json& id, const Json& params) {
    const auto edit = params.is_object() && params.contains("edit") ? params.at("edit") : Json(nullptr);
    if (!edit.is_object()) {
        respond(id, Json(nullptr), Json{{"code", -32602}, {"message", "workspace/applyEdit needs an edit object"}});
        return;
    }
    if (!editor_) {
        respond(id, Json{{"applied", false},
                         {"failureReason", "no workspace editor is attached to this language server"},
                         {"error", {{"code", "APPLY_EDIT_FAILED"}, {"message", "no workspace editor is attached"}}}},
                Json(nullptr));
        return;
    }
    const auto documents = collect_document_edits(edit);
    if (documents.empty()) {
        // An edit with no TextEdit at all (a pure create/rename/delete) is applied
        // by definition: there is nothing to splice into an existing document.
        respond(id, Json{{"applied", true}}, Json(nullptr));
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

void Client::start(Json initialize_params, Handler on_result) {
    if (state_ != State::fresh) protocol_error("start called on a non-fresh client");
    state_ = State::initializing;
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
        if (message.at("method") != "textDocument/publishDiagnostics") return;
        Notify handler;
        {
            std::lock_guard lock(mutex_);
            handler = diagnostics_;
        }
        if (handler) handler(message.contains("params") ? message.at("params") : Json(nullptr));
        return;
    }
    if (is_server_request(message)) {
        if ((!message.at("id").is_number_integer() && !message.at("id").is_string()) || !message.at("method").is_string()) return;
        const auto& id = message.at("id");
        const auto method = message.at("method").get<std::string>();
        if (method == "window/workDoneProgress/create" || method == "client/registerCapability" ||
            method == "client/unregisterCapability")
            respond(id, Json(nullptr), Json(nullptr));
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
        else
            respond(id, Json(nullptr), Json{{"code", -32601}, {"message", "Method not found"}});
    }
}

}  // namespace lsp
}  // namespace taocode
