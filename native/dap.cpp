#include "dap.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cctype>
#include <utility>

namespace taocode {
namespace dap {
namespace {

// ---------------------------------------------------------------- framing ---

void protocol_error(const std::string& detail) {
    throw WorkspaceError("DAP_PROTOCOL", "Debug adapter protocol error: " + detail);
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

// Strictly decimal, non-negative, non-empty and exception free: a malformed
// header must never let std::invalid_argument escape the reader thread.
bool parse_length(std::string_view text, std::size_t& out) {
    text = trim(text);
    if (text.empty() || text.size() > 16) return false;
    std::size_t value = 0;
    for (const char ch : text) {
        if (ch < '0' || ch > '9') return false;
        value = value * 10 + static_cast<std::size_t>(ch - '0');
    }
    out = value;
    return true;
}

// ------------------------------------------------------------ json helpers ---

std::string text_of(const Json& object, const char* key) {
    if (object.is_object() && object.contains(key) && object.at(key).is_string()) return object.at(key).get<std::string>();
    return {};
}

std::int64_t int_of(const Json& object, const char* key, std::int64_t fallback) {
    if (object.is_object() && object.contains(key) && object.at(key).is_number_integer()) return object.at(key).get<std::int64_t>();
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

std::string message_type(const Json& message) {
    if (!message.is_object() || !message.contains("type") || !message.at("type").is_string()) return {};
    return message.at("type").get<std::string>();
}

Json error_object(std::string code, std::string message, std::string_view command) {
    Json error{{"code", std::move(code)}, {"message", std::move(message)}};
    if (!command.empty()) error["command"] = std::string(command);
    return error;
}

Json failure_from(const Json& response, const std::string& command) {
    auto message = text_of(response, "message");
    if (message.empty()) message = text_of(as_object(response.value("body", Json::object())), "error");
    if (message.empty()) message = "调试适配器拒绝了 " + command + " 请求。";
    return error_object("DAP_FAILED", message, command);
}

// ------------------------------------------------------------------- paths ---

std::string lower(std::string value) {
    for (auto& ch : value) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    return value;
}

// Percent-encode every byte that is neither unreserved nor a path delimiter we
// keep, so Windows drive letters, spaces and CJK names become valid file URIs.
std::string percent_encode(const std::string& bytes) {
    static constexpr char hex[] = "0123456789ABCDEF";
    std::string out;
    for (const unsigned char ch : bytes) {
        const bool keep = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') ||
                          ch == '-' || ch == '.' || ch == '_' || ch == '~' || ch == '/' || ch == ':';
        if (keep) out.push_back(static_cast<char>(ch));
        else { out.push_back('%'); out.push_back(hex[ch >> 4]); out.push_back(hex[ch & 0x0F]); }
    }
    return out;
}

std::string percent_decode(const std::string& value) {
    auto digit = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    std::string out;
    for (std::size_t i = 0; i < value.size(); ++i) {
        if (value[i] == '%' && i + 2 < value.size()) {
            const int high = digit(value[i + 1]), low = digit(value[i + 2]);
            if (high >= 0 && low >= 0) { out.push_back(static_cast<char>((high << 4) | low)); i += 2; continue; }
        }
        out.push_back(value[i]);
    }
    return out;
}

std::string u8_path(const std::filesystem::path& path) {
    const auto generic = path.generic_u8string();
    return {reinterpret_cast<const char*>(generic.data()), generic.size()};
}

std::string slash_form(std::string value) {
    std::replace(value.begin(), value.end(), '\\', '/');
    while (value.size() > 1 && value.ends_with('/')) value.pop_back();
    return value;
}

bool looks_absolute(std::string_view value) {
    if (value.starts_with("/") || value.starts_with("\\\\")) return true;
    return value.size() >= 3 && std::isalpha(static_cast<unsigned char>(value[0])) != 0 && value[1] == ':' &&
           (value[2] == '/' || value[2] == '\\');
}

bool looks_like_drive(std::string_view value) {
    return value.size() >= 2 && std::isalpha(static_cast<unsigned char>(value[0])) != 0 && value[1] == ':';
}

// Strips a `file:` scheme, percent-decodes and returns '/'-separated text. A plain
// filesystem path is normalised but otherwise untouched: adapters answer with
// whichever form the client announced in `initialize`.
std::string decode_source_path(std::string_view value) {
    std::string text{value};
    bool triple_slash = false;
    if (text.rfind("file:///", 0) == 0) { text = text.substr(8); triple_slash = true; }
    else if (text.rfind("file://", 0) == 0) text = text.substr(7);  // file://host/share/x
    else if (text.rfind("file:", 0) == 0) text = text.substr(5);
    text = percent_decode(text);
    // `file:///mnt/c/x` is a rooted POSIX path; `file:///C%3A/x` is a Windows
    // drive, and the encoded colon only reveals itself after decoding.
    if (triple_slash && !text.empty() && !looks_like_drive(text)) text = "/" + text;
    return slash_form(text);
}

// -------------------------------------------------------------- reshaping ---

Json shape_event(const std::string& name, const Json& body) {
    Json event{{"event", name}};
    const Json& source = as_object(body);
    if (name == "stopped") {
        // {event:"stopped", reason, threadId, text?}
        event["reason"] = text_of(source, "reason");
        event["threadId"] = int_of(source, "threadId", 0);
        const auto text = text_of(source, "text");
        if (!text.empty()) event["text"] = text;
    } else if (name == "output") {
        // {event:"output", category, text} — DAP names the field `output`.
        auto category = text_of(source, "category");
        if (category.empty()) category = "console";
        auto text = text_of(source, "output");
        if (text.empty()) text = text_of(source, "text");
        event["category"] = std::move(category);
        event["text"] = std::move(text);
    } else if (name == "breakpoint") {
        // {event:"breakpoint", verified, line?, path?}
        const Json& point =
            source.contains("breakpoint") && source.at("breakpoint").is_object() ? source.at("breakpoint") : source;
        event["verified"] = bool_of(point, "verified", false);
        if (point.contains("line") && point.at("line").is_number_integer()) event["line"] = point.at("line").get<std::int64_t>();
        const auto path = text_of(point, "path");
        if (!path.empty() && int_of(point, "sourceReference", 0) == 0) event["rawPath"] = path;
    } else if (name == "terminated") {
        // {event:"terminated", restartable?}
        if (source.contains("restartable")) event["restartable"] = bool_of(source, "restartable", false);
    } else {
        // Everything else (continued, thread, module, capability, invalidated,
        // progressUpdate, loadedSources, memory, exited, ...) forwards the raw body
        // so the UI can still react to adapter-specific events.
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
            scopes.push_back({{"name", text_of(item, "name")},
                              {"reference", reference},
                              {"variablesReference", reference},
                              {"expensive", bool_of(item, "expensive", false)}});
        }
    return Json{{"scopes", std::move(scopes)}};
}

Json shape_variables(const Json& body) {
    Json variables = Json::array();
    const Json& envelope = as_object(body);
    if (envelope.contains("variables") && envelope.at("variables").is_array())
        for (const Json& value : envelope.at("variables")) {
            const Json& item = as_object(value);
            const auto reference = int_of(item, "variablesReference", 0);
            Json shaped{{"name", text_of(item, "name")},
                        {"value", text_of(item, "value")},
                        {"reference", reference},
                        {"named", reference > 0 || int_of(item, "namedVariables", 0) > 0}};
            const auto type = text_of(item, "type");
            if (!type.empty()) shaped["type"] = type;
            const auto evaluate_as = text_of(item, "evaluateName");
            if (!evaluate_as.empty()) shaped["evaluateName"] = evaluate_as;
            variables.push_back(std::move(shaped));
        }
    return Json{{"variables", std::move(variables)}};
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

Client::Reply wrap_ok(Client::Reply handler) {
    if (!handler) return {};
    return [handler = std::move(handler)](Json body, Json error) {
        if (!error.is_null()) { handler(Json(nullptr), std::move(error)); return; }
        Json result{{"ok", true}};
        const Json& envelope = as_object(body);
        if (envelope.contains("allThreadsContinuation")) result["allThreadsContinuation"] = envelope.at("allThreadsContinuation");
        handler(std::move(result), Json(nullptr));
    };
}

Client::Reply shaped(Client::Reply handler, std::function<Json(const Json&)> reshape) {
    if (!handler) return {};
    return [handler = std::move(handler), reshape = std::move(reshape)](Json body, Json error) {
        if (!error.is_null()) { handler(Json(nullptr), std::move(error)); return; }
        handler(reshape(body), Json(nullptr));
    };
}

// ------------------------------------------------------------- startup flow ---

}  // namespace

// Context of one `start_debugging` sequence. It lives in the DAP replies that are
// still registered as pending, so it outlives any single response.
struct Startup {
    std::mutex lock;
    std::string adapter_id;
    Json configuration = Json::object();
    Json capabilities = Json::object();
    Json reports = Json::array();
    std::size_t remaining = 0;
    bool settled = false;
    Client::Reply done;
};

namespace {

// Runs the caller's callback exactly once, whoever finishes the sequence first.
void settle(std::shared_ptr<Startup> startup, Json result, Json error) {
    if (!startup) return;
    Client::Reply handler;
    {
        std::lock_guard lock(startup->lock);
        if (startup->settled) return;
        startup->settled = true;
        handler = std::move(startup->done);
    }
    if (handler) handler(std::move(result), std::move(error));
}

Json success_payload(std::shared_ptr<Startup> startup) {
    std::lock_guard lock(startup->lock);
    return Json{{"ok", true}, {"capabilities", startup->capabilities}, {"breakpoints", startup->reports}};
}

}  // namespace

// ------------------------------------------------------------------- reader ---

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
                if (!parse_length(line.substr(colon + 1), content_length)) protocol_error("invalid content-length value");
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
    if (!message.is_object()) protocol_error("body is not a JSON object");
    return message;
}

std::string encode_message(const Json& message) {
    const std::string body = message.dump();
    return "Content-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
}

Json make_request(std::int64_t seq, std::string_view command, Json arguments) {
    return Json{{"seq", seq},
                {"type", "request"},
                {"command", std::string(command)},
                {"arguments", arguments.is_null() ? Json::object() : std::move(arguments)}};
}

Json make_event(std::int64_t seq, std::string_view event, Json body) {
    return Json{{"seq", seq},
                {"type", "event"},
                {"event", std::string(event)},
                {"body", body.is_null() ? Json::object() : std::move(body)}};
}

bool is_response(const Json& message) { return message_type(message) == "response"; }
bool is_event(const Json& message) { return message_type(message) == "event"; }
bool is_adapter_request(const Json& message) { return message_type(message) == "request"; }

// ------------------------------------------------------------------ client ---

Client::Client() = default;

Client::~Client() { shutdown(); }

void Client::set_root(std::filesystem::path root) {
    std::lock_guard lock(root_mutex_);
    root_ = std::move(root);
}

std::filesystem::path Client::root() const {
    std::lock_guard lock(root_mutex_);
    return root_;
}

std::string Client::to_uri(const std::string& path) const {
    if (path.rfind("file:", 0) == 0) return path;  // already a URI
    std::string generic;
    {
        std::lock_guard lock(root_mutex_);
        if (path.empty()) generic = u8_path(root_.lexically_normal());
        else if (looks_absolute(path)) generic = slash_form(path);
        else generic = u8_path((root_ / std::filesystem::path(std::u8string(path.begin(), path.end()))).lexically_normal());
    }
    if (generic.empty()) return {};
    // "C:/dir/file" -> "file:///C:/dir/file": the drive colon stays readable and
    // everything else (spaces, CJK, '#', '?') is percent-escaped.
    std::string encoded = percent_encode(generic);
    const std::string encoded_colon = "%3A";
    for (std::size_t pos = encoded.find(encoded_colon); pos != std::string::npos; pos = encoded.find(encoded_colon, pos + 1)) {
        encoded.replace(pos, encoded_colon.size(), ":");
        pos += 1;
    }
    if (encoded.starts_with("/")) return "file://" + encoded;  // UNC or POSIX root
    return "file:///" + encoded;
}

std::string Client::to_path(const std::string& source) const {
    std::string decoded = decode_source_path(source);
    if (decoded.empty()) return {};
    std::string root;
    {
        std::lock_guard lock(root_mutex_);
        root = u8_path(root_.lexically_normal());
    }
    root = slash_form(root);
    if (root.size() > 1 && decoded.size() >= root.size() && lower(decoded.substr(0, root.size())) == lower(root)) {
        auto relative = decoded.substr(root.size());
        while (!relative.empty() && relative.front() == '/') relative.erase(relative.begin());
        return relative;
    }
    return decoded;
}

std::string Client::to_native(const std::string& path) const {
    if (path.empty()) return path;
    if (path.rfind("file:", 0) == 0) return to_path(path);  // map a URI back to a real path
    if (looks_absolute(path)) return slash_form(path);
    std::lock_guard lock(root_mutex_);
    return u8_path((root_ / std::filesystem::path(std::u8string(path.begin(), path.end()))).lexically_normal());
}

void Client::start(const std::wstring& command, const std::vector<std::wstring>& arguments,
                   const std::filesystem::path& working_directory, EventCb on_event) {
    std::lock_guard lock(mutex_);
    if (running_.load()) throw WorkspaceError("DAP_RUNNING", "调试会话已在进行，请先停止。");
    if (command.empty()) throw WorkspaceError("DAP_SPAWN", "缺少调试适配器可执行文件。");

    SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE stdin_read = nullptr, stdin_write = nullptr, stdout_read = nullptr, stdout_write = nullptr;
    if (!CreatePipe(&stdin_read, &stdin_write, &inheritable, 0)) throw WorkspaceError("DAP_SPAWN", "无法创建调试适配器输入管道");
    if (!CreatePipe(&stdout_read, &stdout_write, &inheritable, 0)) {
        CloseHandle(stdin_read);
        CloseHandle(stdin_write);
        throw WorkspaceError("DAP_SPAWN", "无法创建调试适配器输出管道");
    }

    // Quoted executable path plus quoted-when-needed arguments: an adapter living
    // under "C:\Program Files\..." has to survive CreateProcessW's own parsing.
    std::wstring line = L"\"" + command + L"\"";
    for (const auto& argument : arguments) {
        line += L' ';
        line += argument.find_first_of(L" \t") == std::wstring::npos ? argument : L"\"" + argument + L"\"";
    }
    std::vector<wchar_t> mutable_line(line.begin(), line.end());
    mutable_line.push_back(L'\0');

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = stdin_read;
    startup.hStdOutput = stdout_write;
    // Deliberately NOT stdout_write: folding stderr into the DAP pipe would corrupt
    // the framing the first time an adapter logs a warning.
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION info{};
    const auto working = working_directory.empty() ? nullptr : working_directory.c_str();
    const BOOL created = CreateProcessW(command.c_str(), mutable_line.data(), nullptr, nullptr, TRUE,
                                        CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED, nullptr, working,
                                        &startup, &info);
    CloseHandle(stdin_read);
    CloseHandle(stdout_write);
    if (!created) {
        const auto error = GetLastError();
        CloseHandle(stdin_write);
        CloseHandle(stdout_read);
        throw WorkspaceError("DAP_SPAWN", "无法启动调试适配器（Windows 错误 " + std::to_string(error) + "）");
    }

    // Kill-on-close reclaims the debugger *and* the debuggee it spawned: an
    // orphaned adapter holding a stopped process (or a console window) is the
    // classic leak for this kind of integration.
    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    if (job) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
        AssignProcessToJobObject(job, info.hProcess);
    }
    ResumeThread(info.hThread);

    {
        std::lock_guard write_lock(write_mutex_);
        stdin_write_ = stdin_write;
        stdout_read_ = stdout_read;
        process_ = info.hProcess;
        thread_ = info.hThread;
        job_ = job;
    }
    on_event_ = std::move(on_event);
    adapter_id_.clear();
    exited_.store(false);
    saw_terminated_.store(false);
    debuggee_alive_.store(true);  // until a `terminated` event or the pipe closes
    exit_code_.store(-1);
    running_.store(true);
    reader_ = std::thread([this] { reader_loop(); });
}

bool Client::write_frame(std::string_view frame) {
    std::lock_guard lock(write_mutex_);
    auto pipe = static_cast<HANDLE>(stdin_write_);
    if (!pipe || pipe == INVALID_HANDLE_VALUE) return false;
    const char* data = frame.data();
    std::size_t remaining = frame.size();
    while (remaining) {
        const auto chunk = static_cast<DWORD>(std::min<std::size_t>(remaining, static_cast<std::size_t>(1) << 20));
        DWORD written = 0;
        if (!WriteFile(pipe, data, chunk, &written, nullptr) || !written) return false;
        data += written;
        remaining -= written;
    }
    return true;
}

void Client::reader_loop() {
    std::vector<char> buffer(16384);
    MessageReader stream;
    bool protocol_failure = false;
    auto pipe = static_cast<HANDLE>(stdout_read_);
    while (pipe) {
        DWORD got = 0;
        if (!ReadFile(pipe, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr) || got == 0) break;
        try {
            stream.feed({buffer.data(), got});
            for (;;) {
                const auto message = stream.next();
                if (!message) break;
                handle(*message);
            }
        } catch (const std::exception&) {
            protocol_failure = true;  // desynchronised: tear down instead of guessing
            break;
        }
    }

    if (protocol_failure) {  // a chatty or broken adapter must not outlive the session
        std::lock_guard lock(write_mutex_);
        if (job_) TerminateJobObject(static_cast<HANDLE>(job_), 1);
        else if (process_) TerminateProcess(static_cast<HANDLE>(process_), 1);
    }
    auto process = static_cast<HANDLE>(process_);
    if (process) {
        WaitForSingleObject(process, protocol_failure ? 5000 : 20000);
        DWORD code = 1;
        if (GetExitCodeProcess(process, &code)) exit_code_.store(static_cast<long>(code));
    }
    running_.store(false);
    debuggee_alive_.store(false);
    exited_.store(true);
    fail_pending(protocol_failure ? "调试适配器数据流损坏（协议错误），会话已终止。" : "调试适配器已退出，连接关闭。");
    if (!saw_terminated_.exchange(true)) {
        // A close marker, so the UI can never stay stuck on "running".
        deliver_event({{"event", "terminated"}, {"restartable", false}, {"connectionClosed", true}});
    }
}

void Client::fail_pending(std::string_view reason) {
    std::vector<Pending> orphaned;
    {
        std::lock_guard lock(mutex_);
        orphaned.reserve(pending_.size());
        for (auto& [seq, entry] : pending_) orphaned.push_back(std::move(entry));
        pending_.clear();
    }
    for (auto& entry : orphaned) {
        if (!entry.handler) continue;
        entry.handler(Json(nullptr), error_object("DAP_CLOSED", std::string(reason) + " 最后请求：" + entry.command, entry.command));
    }
}

void Client::deliver_event(Json event) {
    if (event.contains("event") && event.at("event").is_string() && event.at("event").get<std::string>() == "terminated") {
        saw_terminated_.store(true);
        debuggee_alive_.store(false);
    } else if (event.contains("event") && event.at("event").is_string() && event.at("event").get<std::string>() == "started") {
        debuggee_alive_.store(true);
    }
    EventCb handler;
    {
        std::lock_guard lock(mutex_);
        handler = on_event_;
    }
    if (handler) handler(std::move(event));  // never under a lock: callbacks may start requests
}

void Client::handle(const Json& message) {
    if (is_response(message)) {
        const auto command = text_of(message, "command");
        const auto key = int_of(message, "request_seq", -1);
        Pending entry;
        {
            std::lock_guard lock(mutex_);
            auto pending = pending_.end();
            if (key > 0) pending = pending_.find(key);
            else {
                // Lenient fallback for adapters omitting request_seq: accept it only
                // when exactly one in-flight request carries the same command, so
                // correlation is never guessed.
                for (auto candidate = pending_.begin(); candidate != pending_.end(); ++candidate) {
                    if (candidate->second.command != command) continue;
                    if (pending != pending_.end()) { pending = pending_.end(); break; }
                    pending = candidate;
                }
            }
            if (pending == pending_.end()) return;  // stale or unsolicited: drop
            entry = std::move(pending->second);
            pending_.erase(pending);
        }
        if (!entry.handler) return;
        // `success` is mandatory per spec; a few adapters omit it on success.
        const bool success = message.contains("success") ? bool_of(message, "success", false) : true;
        if (!success) { entry.handler(Json(nullptr), failure_from(message, command)); return; }
        Json body = message.contains("body") ? message.at("body") : Json::object();
        if (!body.is_object()) body = Json::object();
        entry.handler(std::move(body), Json(nullptr));
        return;
    }
    if (is_event(message)) {
        const auto name = text_of(message, "event");
        if (name.empty()) return;
        auto event = shape_event(name, message.contains("body") ? message.at("body") : Json::object());
        if (event.contains("rawPath")) {
            event["path"] = to_path(event.at("rawPath").get<std::string>());  // rel '/' for the gutter
            event.erase("rawPath");
        }
        deliver_event(std::move(event));
        return;
    }
    if (is_adapter_request(message)) answer_adapter_request(message);
}

// Adapters may issue reverse requests (runInTerminal, startDebugging, probes,
// evaluate). TaoCode answers instead of hanging the session forever.
void Client::answer_adapter_request(const Json& message) {
    const auto key = int_of(message, "seq", -1);
    if (key <= 0) return;
    std::int64_t seq = 0;
    {
        std::lock_guard lock(mutex_);
        seq = seq_++;
    }
    Json reply{{"seq", seq},
               {"type", "response"},
               {"request_seq", key},
               {"command", text_of(message, "command")},
               {"success", false},
               {"message", "TaoCode 不支持该适配器请求"}};
    write_frame(encode_message(reply));
}

std::int64_t Client::send(std::string_view command, Json arguments, Reply on_reply) {
    Json frame;
    std::int64_t seq = 0;
    {
        std::lock_guard lock(mutex_);
        if (!running_.load()) {
            if (on_reply) on_reply(Json(nullptr), error_object("DAP_NOT_RUNNING", "调试会话未运行。", command));
            return 0;
        }
        seq = seq_++;
        if (on_reply) pending_.emplace(seq, Pending{std::move(on_reply), std::string(command)});
        frame = make_request(seq, command, std::move(arguments));
    }
    if (write_frame(encode_message(frame))) return seq;
    Pending orphaned;
    {
        std::lock_guard lock(mutex_);
        auto pending = pending_.find(seq);
        if (pending != pending_.end()) { orphaned = std::move(pending->second); pending_.erase(pending); }
    }
    if (orphaned.handler)
        orphaned.handler(Json(nullptr), error_object("DAP_CLOSED", "无法写入调试适配器管道。", orphaned.command));
    return seq;
}

void Client::request(std::string_view command, Json arguments, Reply on_reply) {
    send(command, std::move(arguments), std::move(on_reply));
}

void Client::initialize(const std::string& adapter_id, Reply on_reply) {
    {
        std::lock_guard lock(mutex_);
        adapter_id_ = adapter_id;
    }
    Json arguments{{"adapterID", adapter_id.empty() ? std::string("taocode") : adapter_id},
                   {"clientID", "taocode"},
                   {"clientName", "TaoCode"},
                   {"linesStartAt1", true},    // DAP is 1-based: the UI must add 1
                   {"columnsStartAt1", true},  // ...for columns too
                   {"pathFormat", "uri"},
                   {"supportsVariableType", true},
                   {"supportsRunInTerminalRequest", false},
                   {"supportsProgressReporting", false},
                   {"supportsInvalidatedEvent", false}};
    send("initialize", std::move(arguments),
         [this, handler = std::move(on_reply)](Json capabilities, Json error) {
             if (error.is_null()) {
                 // The spec mandates the `initialized` event after a successful
                 // initialize and before launch. It is fire-and-forget.
                 std::int64_t seq = 0;
                 {
                     std::lock_guard lock(mutex_);
                     seq = seq_++;
                 }
                 write_frame(encode_message(make_event(seq, "initialized", Json::object())));
             }
             if (handler) handler(std::move(capabilities), std::move(error));
         });
}

void Client::launch(Json configuration, Reply on_reply) {
    Json arguments = configuration.is_object() ? configuration : Json::object();
    std::string kind;
    {
        std::lock_guard lock(mutex_);
        kind = adapter_id_;
    }
    const auto type = text_of(arguments, "type");
    if (type.empty()) arguments["type"] = kind;
    arguments["request"] = "launch";
    if (text_of(arguments, "name").empty()) arguments["name"] = "TaoCode";
    // The bridge speaks workspace-relative; the adapter needs real paths.
    for (const auto& key : path_configuration_keys) {
        const auto found = arguments.find(std::string(key));
        if (found != arguments.end() && found->is_string()) *found = to_native(found->get<std::string>());
    }
    // `env` is accepted as an object or as ["KEY=value", ...] from the bridge.
    if (arguments.contains("env") && arguments.at("env").is_array()) {
        Json env = Json::object();
        for (const auto& entry : arguments.at("env")) {
            if (!entry.is_string()) continue;
            const auto text = entry.get<std::string>();
            const auto equals = text.find('=');
            if (equals == std::string::npos) continue;
            env[text.substr(0, equals)] = text.substr(equals + 1);
        }
        arguments["env"] = std::move(env);
    }
    send("launch", std::move(arguments), std::move(on_reply));
}

void Client::set_configuration_done(Reply on_reply) {
    send("configurationDone", Json::object(), std::move(on_reply));
}

void Client::set_breakpoints(const std::string& rel_path, const Json& requested, Reply on_reply) {
    const auto key = slash_form(rel_path);
    const Json points = normalize_breakpoints(requested);
    {
        std::lock_guard lock(mutex_);
        if (points.empty()) breakpoints_.erase(key);
        else breakpoints_[key] = points;  // remembered, so a restart re-applies
    }
    if (!running_.load()) {
        // No live adapter yet: the lines are stored and will be installed by the
        // next `start_debugging`. `deferred` tells the bridge why nothing is verified.
        if (on_reply)
            on_reply(Json{{"ok", true}, {"path", key}, {"verifiedLines", Json::array()}, {"deferred", true}}, Json(nullptr));
        return;
    }
    Json arguments{{"source", Json{{"path", to_uri(key)}, {"sourceReference", 0}}}, {"breakpoints", points}};
    request("setBreakpoints", std::move(arguments),
            [handler = std::move(on_reply), key, lines = requested_lines(points)](Json body, Json error) {
                if (!handler) return;
                if (!error.is_null()) { handler(Json(nullptr), std::move(error)); return; }
                handler(Json{{"ok", true}, {"path", key}, {"verifiedLines", verified_lines(body, lines)},
                             {"messages", breakpoint_messages(body)}}, Json(nullptr));
            });
}

void Client::continue_execution(long thread_id, bool all, Reply on_reply) {
    // Omitting threadId resumes every thread; that is how `all` is expressed.
    Json arguments = Json::object();
    if (!all) arguments["threadId"] = thread_id;
    send("continue", std::move(arguments), wrap_ok(std::move(on_reply)));
}

void Client::pause(long thread_id, Reply on_reply) {
    send("pause", Json{{"threadId", thread_id}}, wrap_ok(std::move(on_reply)));
}

void Client::next(long thread_id, Reply on_reply) {
    send("next", Json{{"threadId", thread_id}}, wrap_ok(std::move(on_reply)));
}

void Client::step_in(long thread_id, Reply on_reply) {
    send("stepIn", Json{{"threadId", thread_id}}, wrap_ok(std::move(on_reply)));
}

void Client::step_out(long thread_id, Reply on_reply) {
    send("stepOut", Json{{"threadId", thread_id}}, wrap_ok(std::move(on_reply)));
}

void Client::stack_trace(long thread_id, Reply on_reply) {
    send("stackTrace", Json{{"threadId", thread_id}},
         shaped(std::move(on_reply), [this](const Json& body) { return shape_frames(*this, body); }));
}

void Client::scopes(long frame_id, Reply on_reply) {
    send("scopes", Json{{"frameId", frame_id}}, shaped(std::move(on_reply), [](const Json& body) { return shape_scopes(body); }));
}

void Client::variables(long variables_reference, Reply on_reply) {
    send("variables", Json{{"variablesReference", variables_reference}},
         shaped(std::move(on_reply), [](const Json& body) { return shape_variables(body); }));
}

void Client::disconnect(Reply on_reply) {
    send("disconnect", Json{{"terminateDebuggee", true}}, wrap_ok(std::move(on_reply)));
}

void Client::start_debugging(const std::string& adapter_id, Json launch_configuration, Reply on_reply) {
    auto startup = std::make_shared<Startup>();
    startup->adapter_id = adapter_id;
    startup->configuration = launch_configuration.is_object() ? std::move(launch_configuration) : Json::object();
    startup->done = std::move(on_reply);
    initialize(adapter_id, [this, startup](Json capabilities, Json error) {
        if (!error.is_null()) { settle(startup, Json(nullptr), std::move(error)); return; }
        startup->capabilities = std::move(capabilities);
        launch(startup->configuration, [this, startup](Json, Json error) {
            if (!error.is_null()) { settle(startup, Json(nullptr), std::move(error)); return; }
            apply_remembered_breakpoints(startup);
        });
    });
}

// Installs every remembered breakpoint, then configurationDone once all answers
// are in. One failing file is reported inside `breakpoints` but never aborts.
void Client::apply_remembered_breakpoints(std::shared_ptr<Startup> startup) {
    std::vector<std::pair<std::string, Json>> remembered;
    {
        std::lock_guard lock(mutex_);
        remembered.assign(breakpoints_.begin(), breakpoints_.end());
    }
    {
        std::lock_guard lock(startup->lock);
        startup->remaining = remembered.size();
    }
    auto advance = [this, startup] {
        bool last = false;
        {
            std::lock_guard lock(startup->lock);
            if (startup->remaining > 0) --startup->remaining;
            last = startup->remaining == 0;
        }
        if (!last) return;
        set_configuration_done([this, startup](Json, Json error) {
            if (!error.is_null()) { settle(startup, Json(nullptr), std::move(error)); return; }
            settle(startup, success_payload(startup), Json(nullptr));
        });
    };
    if (remembered.empty()) { advance(); return; }
    for (const auto& [path, lines] : remembered) {
        set_breakpoints(path, lines, [startup, path, advance](Json result, Json error) {            Json report;
            if (error.is_null()) report = std::move(result);
            else report = Json{{"path", path}, {"error", error.contains("message") ? error.at("message") : error}};
            {
                std::lock_guard lock(startup->lock);
                startup->reports.push_back(std::move(report));
            }
            advance();  // outside the lock: it re-enters startup->lock
        });
    }
}

Json Client::breakpoint_map() const {
    std::lock_guard lock(mutex_);
    Json map = Json::object();
    for (const auto& [path, points] : breakpoints_) map[path] = points;
    return map;
}

void Client::forget_breakpoints(const std::string& rel_path) {
    std::lock_guard lock(mutex_);
    breakpoints_.erase(slash_form(rel_path));
}

void Client::clear_breakpoints() {
    std::lock_guard lock(mutex_);
    breakpoints_.clear();
}

bool Client::running() const { return running_.load(); }

bool Client::exited() const { return exited_.load(); }

long Client::exit_code() const { return exit_code_.load(); }

bool Client::debuggee_alive() const { return debuggee_alive_.load(); }

void Client::close_pipes_and_kill() {
    std::lock_guard lock(write_mutex_);
    if (stdin_write_) {
        CloseHandle(static_cast<HANDLE>(stdin_write_));
        stdin_write_ = nullptr;
    }
    // Closing our job handle would also reap the tree, but terminate explicitly so
    // the blocked ReadFile returns immediately instead of on handle close.
    if (job_) TerminateJobObject(static_cast<HANDLE>(job_), 1);
    else if (process_) TerminateProcess(static_cast<HANDLE>(process_), 1);
}

void Client::shutdown() noexcept {
    try {
        {
            std::lock_guard lock(mutex_);
            running_.store(false);
        }
        // Close stdin (adapters exit on EOF) and kill the job, which unblocks the
        // reader thread's pending ReadFile at once.
        close_pipes_and_kill();
        if (reader_.joinable()) {
            if (reader_.get_id() == std::this_thread::get_id()) reader_.detach();  // called from a callback
            else reader_.join();
        }
        {
            std::lock_guard lock(write_mutex_);
            for (auto** handle : {&stdout_read_, &process_, &thread_, &job_}) {
                if (*handle) CloseHandle(static_cast<HANDLE>(*handle));
                *handle = nullptr;
            }
        }
        std::lock_guard lock(mutex_);
        pending_.clear();  // breakpoints stay remembered: a restart re-applies them
    } catch (...) {
        // Teardown is the last resort on the UI thread: it must never throw.
    }
}

}  // namespace dap
}  // namespace taocode
