#include "lsp.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

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

std::int64_t Client::send_request(std::string_view method, Json params, Handler on_result) {
    const std::int64_t id = next_id_++;
    pending_.emplace(id, std::move(on_result));
    send(make_request(id, method, std::move(params)));
    return id;
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
    notify("textDocument/didOpen", {{"textDocument", {{"uri", uri}, {"languageId", language_id}, {"version", version}, {"text", text}}}});
}

void Client::did_change(const std::string& uri, int version, const std::string& full_text) {
    notify("textDocument/didChange", {{"textDocument", {{"uri", uri}, {"version", version}}},
                                      {"contentChanges", Json::array({{{"text", full_text}}})}});
}

void Client::did_close(const std::string& uri) {
    notify("textDocument/didClose", {{"textDocument", {{"uri", uri}}}});
}

void Client::request(std::string_view method, Json params, Handler on_result) {
    send_request(method, std::move(params), std::move(on_result));
}

void Client::set_configuration(Json settings) {
    configuration_ = std::move(settings);
    if (ready()) notify("workspace/didChangeConfiguration", {{"settings", configuration_}});
}

void Client::receive(const Json& message) {
    if (is_response(message)) {
        if (!message.at("id").is_number_integer()) return;  // we only issue integer ids
        const auto id = message.at("id").get<std::int64_t>();
        const auto pending = pending_.find(id);
        if (pending == pending_.end()) return;
        Handler handler = std::move(pending->second);
        pending_.erase(pending);
        Json error = message.contains("error") ? message.at("error") : Json(nullptr);
        Json result = message.contains("result") ? message.at("result") : Json(nullptr);
        handler(std::move(result), std::move(error));
        return;
    }
    if (is_notification(message)) {
        if (message.at("method") == "textDocument/publishDiagnostics" && diagnostics_)
            diagnostics_(message.contains("params") ? message.at("params") : Json(nullptr));
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
            respond(id, Json{{"applied", false}}, Json(nullptr));
        else
            respond(id, Json(nullptr), Json{{"code", -32601}, {"message", "Method not found"}});
    }
}

}  // namespace lsp
}  // namespace taocode
