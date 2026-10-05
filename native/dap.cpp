#include "dap.hpp"
#include "dap_shaping.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cctype>
#include <cwchar>
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

// A source path (URI or absolute) -> workspace-relative '/', or the decoded path
// when it lives outside the root.
std::string relative_to(const std::string& source, const std::filesystem::path& root) {
    std::string decoded = decode_source_path(source);
    if (decoded.empty()) return {};
    std::string base = slash_form(u8_path(root.lexically_normal()));
    if (base.size() > 1 && decoded.size() >= base.size() && lower(decoded.substr(0, base.size())) == lower(base)) {
        auto relative = decoded.substr(base.size());
        while (!relative.empty() && relative.front() == '/') relative.erase(relative.begin());
        return relative;
    }
    return decoded;
}

// ------------------------------------------------------------ process help ---

std::wstring widen(const std::string& value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (size <= 0) return {};
    std::wstring out(static_cast<std::size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size);
    return out;
}

std::string narrow(const std::wstring& value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string out(static_cast<std::size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
    return out;
}

// Quotes one command-line token the way CreateProcessW's own parser expects.
std::wstring quote_argument(const std::wstring& value) {
    if (!value.empty() && value.find_first_of(L" \t\"") == std::wstring::npos) return value;
    std::wstring quoted = L"\"";
    for (std::size_t i = 0; i != value.size(); ++i) {
        std::size_t backslashes = 0;
        while (i != value.size() && value[i] == L'\\') { ++backslashes; ++i; }
        if (i == value.size()) { quoted.append(backslashes * 2, L'\\'); break; }
        if (value[i] == L'"') quoted.append(backslashes * 2 + 1, L'\\');
        else quoted.append(backslashes, L'\\');
        quoted.push_back(value[i]);
    }
    quoted.push_back(L'"');
    return quoted;
}

// The parent environment plus the overrides an adapter sent, as the sorted,
// double-NUL-terminated UTF-16 block CreateProcessW wants.
std::wstring environment_block(const Json& overrides) {
    std::vector<std::pair<std::wstring, std::wstring>> entries;
    const wchar_t* inherited = GetEnvironmentStringsW();
    if (inherited) {
        for (const wchar_t* cursor = inherited; *cursor;) {
            const std::wstring entry(cursor);
            cursor += entry.size() + 1;
            const auto equals = entry.find(L'=');
            if (equals == std::wstring::npos || equals == 0) continue;  // the `=C:` oddities
            entries.emplace_back(entry.substr(0, equals), entry.substr(equals + 1));
        }
        FreeEnvironmentStringsW(const_cast<wchar_t*>(inherited));
    }
    if (overrides.is_object())
        for (const auto& [key, value] : overrides.items()) {
            const auto wide_key = widen(key);
            const auto found = std::find_if(entries.begin(), entries.end(), [&wide_key](const auto& entry) {
                return _wcsicmp(entry.first.c_str(), wide_key.c_str()) == 0;
            });
            if (value.is_null()) {  // an explicit null removes the variable
                if (found != entries.end()) entries.erase(found);
                continue;
            }
            const auto wide_value = widen(value.is_string() ? value.get<std::string>() : value.dump());
            if (found != entries.end()) found->second = wide_value;
            else entries.emplace_back(wide_key, wide_value);
        }
    std::sort(entries.begin(), entries.end(), [](const auto& left, const auto& right) {
        return _wcsicmp(left.first.c_str(), right.first.c_str()) < 0;
    });
    std::wstring block;
    for (const auto& [key, value] : entries) block += key + L'=' + value + L'\0';
    block += L'\0';
    return block;
}

// --------------------------------------------------------------- reply wrapping ---
// 响应整形那一族（事件 / 栈帧 / 作用域 / 变量 / 异常 / 断点 / 补全 / 运行到光标处）搬到了
// native/dap_shaping.cpp（2026-10-05，dap.cpp 贴着 1790 行机检上限）。这里留下的是"回信怎么包"：
// 能力位、ok 壳、allThreadsContinuation。
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

// Every mutable byte of a session. The reader thread and the timeout watchdog hold
// one of these, so a Client that is destroyed the moment a session ends can never
// leave a callback running against freed memory.
struct Client::State {
    mutable std::mutex mutex_;               // guards seq_, pending_, breakpoints_, on_event_, stopped_
    std::mutex write_mutex_;                 // guards the stdin pipe + job/process handles
    mutable std::mutex root_mutex_;          // guards root_ (path mapping is const)

    std::int64_t seq_ = 1;
    std::unordered_map<std::int64_t, Pending> pending_;
    std::map<std::string, Json> breakpoints_;   // path -> [{line, condition?, ...}]
    Json exception_filters_ = Json::array();    // remembered setExceptionBreakpoints filters
    // 适配器在 initialize 响应里声明的能力（terminate/restart 要走哪条路由它决定）。
    Json capabilities_ = Json::object();
    std::filesystem::path root_;
    std::string adapter_id_;
    EventCb on_event_;

    void* stdin_write_ = nullptr;  // HANDLE
    void* stdout_read_ = nullptr;  // HANDLE
    void* process_ = nullptr;      // HANDLE
    void* thread_ = nullptr;       // HANDLE (primary thread of the adapter)
    void* job_ = nullptr;          // HANDLE (KILL_ON_JOB_CLOSE)
    std::thread reader_;
    std::thread watchdog_;

    // How this adapter was launched, so a `startDebugging` reverse request can
    // start a sibling session of the same adapter.
    std::wstring adapter_command_;
    std::vector<std::wstring> adapter_arguments_;
    std::filesystem::path adapter_cwd_;
    // Sessions started on the adapter's behalf; torn down with this one.
    std::vector<std::shared_ptr<Client>> nested_;

    std::condition_variable due_;
    std::uint64_t wake_ = 0;   // bumped whenever a deadline is registered, so the
                               // watchdog re-picks the earliest one instead of
                               // sleeping on the stale absolute time
    std::chrono::milliseconds timeout_ = default_request_timeout;
    bool stopped_ = false;   // once set, no callback is delivered any more
    bool tearing_ = false;   // shutdown() has begun (idempotence guard)
    bool watching_ = false;

    std::atomic<bool> running_{false};
    std::atomic<bool> exited_{false};
    std::atomic<bool> debuggee_alive_{false};
    std::atomic<bool> saw_terminated_{false};
    std::atomic<long> exit_code_{-1};
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

Client::Client() : state_(std::make_shared<State>()) {}

Client::~Client() { shutdown(); }

void Client::set_root(std::filesystem::path root) {
    std::lock_guard lock(state_->root_mutex_);
    state_->root_ = std::move(root);
}

std::filesystem::path Client::root() const {
    std::lock_guard lock(state_->root_mutex_);
    return state_->root_;
}

std::string Client::to_uri(const std::string& path) const {
    if (path.rfind("file:", 0) == 0) return path;  // already a URI
    std::string generic;
    {
        std::lock_guard lock(state_->root_mutex_);
        if (path.empty()) generic = u8_path(state_->root_.lexically_normal());
        else if (looks_absolute(path)) generic = slash_form(path);
        else generic = u8_path((state_->root_ / std::filesystem::path(std::u8string(path.begin(), path.end()))).lexically_normal());
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
    std::filesystem::path root;
    {
        std::lock_guard lock(state_->root_mutex_);
        root = state_->root_;
    }
    return relative_to(source, root);
}

std::string Client::to_native(const std::string& path) const {
    if (path.empty()) return path;
    if (path.rfind("file:", 0) == 0) return to_path(path);  // map a URI back to a real path
    if (looks_absolute(path)) return slash_form(path);
    std::lock_guard lock(state_->root_mutex_);
    return u8_path((state_->root_ / std::filesystem::path(std::u8string(path.begin(), path.end()))).lexically_normal());
}

void Client::set_timeout(std::chrono::milliseconds timeout) {
    std::lock_guard lock(state_->mutex_);
    state_->timeout_ = timeout;
}

Client::ReverseHandler& run_in_terminal_hook() {
    static Client::ReverseHandler hook;  // set once, before any session starts
    return hook;
}

Client::ReverseHandler& start_debugging_hook() {
    static Client::ReverseHandler hook;
    return hook;
}

void Client::set_run_in_terminal_handler(ReverseHandler handler) { run_in_terminal_hook() = std::move(handler); }

void Client::set_start_debugging_handler(ReverseHandler handler) { start_debugging_hook() = std::move(handler); }

// The default `runInTerminal`: the command is really launched. "external" gets its
// own console window (the process id is what the adapter waits on), "integrated"
// runs windowless and reports a shell process id, which is what debugpy and the
// js adapters ask for when they want the program inside the IDE's terminal.
Json Client::run_in_terminal_default(const Json& arguments, std::string& error) {
    const bool external = text_of(arguments, "kind") == "external";
    std::wstring line;
    const auto& parts = arguments.contains("args") && arguments.at("args").is_array() ? arguments.at("args") : Json::array();
    for (const auto& part : parts) {
        if (!part.is_string()) continue;
        if (!line.empty()) line += L' ';
        line += quote_argument(widen(part.get<std::string>()));
    }
    if (line.empty()) {
        const auto command = text_of(arguments, "command");
        if (command.empty()) { error = "runInTerminal 没有要执行的命令。"; return Json(nullptr); }
        line = quote_argument(widen(command));
    }

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION info{};
    const auto cwd = text_of(arguments, "cwd");
    const std::wstring wide_cwd = widen(cwd);
    const Json environment = arguments.contains("env") && arguments.at("env").is_object() ? arguments.at("env")
                                                                                          : Json(nullptr);
    std::wstring block = environment_block(environment);
    const DWORD flags = CREATE_NEW_PROCESS_GROUP | (external ? CREATE_NEW_CONSOLE : CREATE_NO_WINDOW) |
                        (block.empty() ? DWORD(0) : CREATE_UNICODE_ENVIRONMENT);
    // No lpApplicationName: the adapter's command has to go through the normal
    // PATH search exactly like a shell would.
    std::vector<wchar_t> mutable_line(line.begin(), line.end());
    mutable_line.push_back(L'\0');
    const BOOL created = CreateProcessW(nullptr, mutable_line.data(), nullptr, nullptr, FALSE, flags,
                                        block.empty() ? nullptr : block.data(),
                                        wide_cwd.empty() ? nullptr : wide_cwd.c_str(), &startup, &info);
    if (!created) {
        error = "无法启动调试适配器请求的进程（Windows 错误 " + std::to_string(GetLastError()) + "）：" +
                narrow(line);
        return Json(nullptr);
    }
    CloseHandle(info.hThread);
    CloseHandle(info.hProcess);  // the child outlives this call; it is not ours to reap
    Json body = Json::object();
    if (external) body["processId"] = static_cast<std::int64_t>(info.dwProcessId);
    else body["shellProcessId"] = static_cast<std::int64_t>(info.dwProcessId);
    return body;
}

// The default `startDebugging`: a genuinely new session of the same adapter, run
// for the configuration the adapter handed back (compound/multi-process launches
// work exactly this way in VS Code). The nested session is torn down with this one.
Json Client::start_debugging_default(State& state, const Json& arguments, std::string& error) {
    std::wstring command;
    std::vector<std::wstring> adapter_arguments;
    std::filesystem::path working_directory;
    std::filesystem::path root;
    std::string adapter_id;
    std::chrono::milliseconds timeout{default_request_timeout};
    {
        std::lock_guard lock(state.mutex_);
        command = state.adapter_command_;
        adapter_arguments = state.adapter_arguments_;
        working_directory = state.adapter_cwd_;
        adapter_id = state.adapter_id_;
        timeout = state.timeout_;
    }
    {
        std::lock_guard lock(state.root_mutex_);
        root = state.root_;
    }
    if (command.empty()) {
        error = "嵌套调试会话需要适配器命令，而当前会话不是由 TaoCode 启动的。";
        return Json(nullptr);
    }
    const Json configuration = arguments.contains("configuration") && arguments.at("configuration").is_object()
                                   ? arguments.at("configuration") : Json::object();
    auto nested = std::make_shared<Client>();
    nested->set_root(root);
    nested->set_timeout(timeout);
    // The adapter asked for a session; its events belong to the same debug UI, so
    // they are forwarded and merely tagged.
    try {
        nested->start(command, adapter_arguments, working_directory, [](Json) {});
    } catch (const std::exception& failure) {
        error = std::string("无法启动嵌套调试会话：") + failure.what();
        return Json(nullptr);
    }
    Json launch_configuration = configuration;
    const auto request = text_of(arguments, "request");
    if (!request.empty()) launch_configuration["request"] = request;
    nested->start_debugging(adapter_id.empty() ? std::string("taocode") : adapter_id, std::move(launch_configuration),
                            [](Json, Json) {});
    {
        std::lock_guard lock(state.mutex_);
        state.nested_.push_back(nested);
    }
    return Json{{"ok", true}};
}

void Client::start(const std::wstring& command, const std::vector<std::wstring>& arguments,
                   const std::filesystem::path& working_directory, EventCb on_event) {
    auto& s = *state_;
    std::lock_guard lock(s.mutex_);
    if (s.running_.load()) throw WorkspaceError("DAP_RUNNING", "调试会话已在进行，请先停止。");
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
    std::wstring line = quote_argument(command);
    for (const auto& argument : arguments) {
        line += L' ';
        line += quote_argument(argument);
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
    const BOOL created = CreateProcessW(nullptr, mutable_line.data(), nullptr, nullptr, TRUE,
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
        // An unconfigured or unassigned job kills nothing; in that case drop it so
        // close_pipes_and_kill() terminates the adapter process directly instead.
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) ||
            !AssignProcessToJobObject(job, info.hProcess)) {
            CloseHandle(job);
            job = nullptr;
        }
    }
    ResumeThread(info.hThread);

    s.stdin_write_ = stdin_write;
    s.stdout_read_ = stdout_read;
    s.process_ = info.hProcess;
    s.thread_ = info.hThread;
    s.job_ = job;
    s.adapter_command_ = command;      // so a nested session can be started later
    s.adapter_arguments_ = arguments;
    s.adapter_cwd_ = working_directory;
    s.on_event_ = std::move(on_event);
    s.adapter_id_.clear();
    s.exited_.store(false);
    s.saw_terminated_.store(false);
    s.debuggee_alive_.store(true);  // until a `terminated` event or the pipe closes
    s.exit_code_.store(-1);
    s.running_.store(true);
    s.stopped_ = false;    // a restart clears the "session over" flag
    s.tearing_ = false;
    s.watching_ = true;
    s.reader_ = std::thread([state = state_] { reader_loop(state); });
    s.watchdog_ = std::thread([state = state_] { watchdog_loop(state); });
}

bool Client::write_frame(State& s, std::string_view frame) {
    std::lock_guard lock(s.write_mutex_);
    auto pipe = static_cast<HANDLE>(s.stdin_write_);
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

void Client::reader_loop(std::shared_ptr<State> state) {
    auto& s = *state;
    std::vector<char> buffer(16384);
    MessageReader stream;
    bool protocol_failure = false;
    auto pipe = static_cast<HANDLE>(s.stdout_read_);
    while (pipe) {
        DWORD got = 0;
        if (!ReadFile(pipe, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr) || got == 0) break;
        try {
            stream.feed({buffer.data(), got});
            for (;;) {
                const auto message = stream.next();
                if (!message) break;
                handle(s, *message);
            }
        } catch (const std::exception&) {
            protocol_failure = true;  // desynchronised: tear down instead of guessing
            break;
        }
    }

    if (protocol_failure) {  // a chatty or broken adapter must not outlive the session
        std::lock_guard lock(s.write_mutex_);
        if (s.job_) TerminateJobObject(static_cast<HANDLE>(s.job_), 1);
        else if (s.process_) TerminateProcess(static_cast<HANDLE>(s.process_), 1);
    }
    auto process = static_cast<HANDLE>(s.process_);
    if (process) {
        WaitForSingleObject(process, protocol_failure ? 5000 : 20000);
        DWORD code = 1;
        if (GetExitCodeProcess(process, &code)) s.exit_code_.store(static_cast<long>(code));
    }
    s.running_.store(false);
    s.debuggee_alive_.store(false);
    s.exited_.store(true);
    fail_pending(s, protocol_failure ? "调试适配器数据流损坏（协议错误），会话已终止。" : "调试适配器已退出，连接关闭。");
    if (!s.saw_terminated_.exchange(true)) {
        // A close marker, so the UI can never stay stuck on "running".
        deliver_event(s, Json{{"event", "terminated"}, {"restartable", false}, {"connectionClosed", true}});
    }
}

// Answers requests whose deadline has passed, so an adapter that accepted a
// request and then hung still costs the UI a bounded wait.
void Client::watchdog_loop(std::shared_ptr<State> state) {
    auto& s = *state;
    std::vector<Pending> expired;
    for (;;) {
        expired.clear();
        std::unique_lock lock(s.mutex_);
        if (!s.watching_) return;
        // Wake on the earliest deadline still outstanding; a new request is always
        // announced, so an earlier one can never be missed.
        auto deadline = std::chrono::steady_clock::time_point::max();
        for (const auto& entry : s.pending_) deadline = std::min(deadline, entry.second.deadline);
        if (deadline == std::chrono::steady_clock::time_point::max()) {
            s.due_.wait(lock, [&s] { return !s.watching_ || !s.pending_.empty(); });
            continue;
        }
        // The wait must also break when a *new* request registered an earlier
        // deadline: notify_all() alone only re-runs the predicate, and would send
        // us back to sleep until the absolute time we picked before.
        const auto ticket = s.wake_;
        s.due_.wait_until(lock, deadline, [&s, ticket] { return !s.watching_ || s.wake_ != ticket; });
        if (!s.watching_) return;
        const auto now = std::chrono::steady_clock::now();
        for (auto entry = s.pending_.begin(); entry != s.pending_.end();) {
            if (entry->second.deadline > now) { ++entry; continue; }
            if (entry->second.handler) expired.push_back(std::move(entry->second));
            entry = s.pending_.erase(entry);
        }
        lock.unlock();
        for (auto& entry : expired) {
            if (!entry.handler) continue;
            entry.handler(Json(nullptr), error_object("DAP_TIMEOUT",
                                                      "调试适配器在超时前没有回答 " + entry.command + " 请求。",
                                                      entry.command));
            entry.handler = nullptr;
        }
        expired.clear();
    }
}

void Client::fail_pending(State& s, std::string_view reason) {
    std::vector<Pending> orphaned;
    {
        std::lock_guard lock(s.mutex_);
        orphaned.reserve(s.pending_.size());
        for (auto& [seq, entry] : s.pending_) orphaned.push_back(std::move(entry));
        s.pending_.clear();
    }
    for (auto& entry : orphaned) {
        if (!entry.handler) continue;
        entry.handler(Json(nullptr), error_object("DAP_CLOSED", std::string(reason) + " 最后请求：" + entry.command, entry.command));
    }
}

void Client::deliver_event(State& s, Json event) {
    if (event.contains("event") && event.at("event").is_string() && event.at("event").get<std::string>() == "terminated") {
        s.saw_terminated_.store(true);
        s.debuggee_alive_.store(false);
    } else if (event.contains("event") && event.at("event").is_string() && event.at("event").get<std::string>() == "started") {
        s.debuggee_alive_.store(true);
    }
    EventCb handler;
    {
        std::lock_guard lock(s.mutex_);
        if (s.stopped_) return;  // the session is over: never call back into a dead UI
        handler = s.on_event_;
    }
    if (handler) handler(std::move(event));  // never under a lock: callbacks may start requests
}

void Client::handle(State& s, const Json& message) {
    {
        std::lock_guard lock(s.mutex_);
        if (s.stopped_) return;  // a response that lands after teardown is dropped
    }
    if (is_response(message)) {
        const auto command = text_of(message, "command");
        const auto key = int_of(message, "request_seq", -1);
        Pending entry;
        {
            std::lock_guard lock(s.mutex_);
            auto pending = s.pending_.end();
            if (key > 0) pending = s.pending_.find(key);
            else {
                // Lenient fallback for adapters omitting request_seq: accept it only
                // when exactly one in-flight request carries the same command, so
                // correlation is never guessed.
                for (auto candidate = s.pending_.begin(); candidate != s.pending_.end(); ++candidate) {
                    if (candidate->second.command != command) continue;
                    if (pending != s.pending_.end()) { pending = s.pending_.end(); break; }
                    pending = candidate;
                }
            }
            if (pending == s.pending_.end()) return;  // stale or unsolicited: drop
            entry = std::move(pending->second);
            s.pending_.erase(pending);
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
            std::filesystem::path root;
            {
                std::lock_guard lock(s.root_mutex_);
                root = s.root_;
            }
            event["path"] = relative_to(event.at("rawPath").get<std::string>(), root);  // rel '/' for the gutter
            event.erase("rawPath");
        }
        deliver_event(s, std::move(event));
        return;
    }
    if (is_adapter_request(message)) answer_adapter_request(s, message);
}

// Adapters may issue reverse requests (runInTerminal, startDebugging, probes,
// evaluate). TaoCode answers them for real instead of hanging the session.
void Client::answer_adapter_request(State& s, const Json& message) {
    const auto key = int_of(message, "seq", -1);
    if (key <= 0) return;
    const auto command = text_of(message, "command");
    const Json arguments = message.contains("arguments") && message.at("arguments").is_object()
                               ? message.at("arguments") : Json::object();

    Json body = Json::object();
    bool success = true;
    std::string failure;
    if (command == "runInTerminal") {
        const auto& hook = run_in_terminal_hook();
        body = hook ? hook(arguments, failure) : run_in_terminal_default(arguments, failure);
        if (!failure.empty()) success = false;
    } else if (command == "startDebugging") {
        const auto& hook = start_debugging_hook();
        body = hook ? hook(arguments, failure) : start_debugging_default(s, arguments, failure);
        if (!failure.empty()) success = false;
    } else {
        success = false;
        failure = "TaoCode 不支持该适配器请求";
    }

    std::int64_t seq = 0;
    {
        std::lock_guard lock(s.mutex_);
        seq = s.seq_++;
    }
    Json reply{{"seq", seq},
               {"type", "response"},
               {"request_seq", key},
               {"command", command},
               {"success", success}};
    if (success) reply["body"] = body.is_null() ? Json::object() : std::move(body);
    else reply["message"] = std::move(failure);
    write_frame(s, encode_message(reply));
}

std::int64_t Client::send(std::string_view command, Json arguments, Reply on_reply) {
    auto& s = *state_;
    Json frame;
    std::int64_t seq = 0;
    {
        std::lock_guard lock(s.mutex_);
        if (!s.running_.load()) {
            if (on_reply) on_reply(Json(nullptr), error_object("DAP_NOT_RUNNING", "调试会话未运行。", command));
            return 0;
        }
        if (s.pending_.size() >= max_pending_requests) {
            // An adapter that never answers cannot grow the map without bound.
            if (on_reply) on_reply(Json(nullptr), error_object("DAP_BUSY", "未回答的调试请求过多。", command));
            return 0;
        }
        seq = s.seq_++;
        if (on_reply)
            s.pending_.emplace(seq, Pending{std::move(on_reply), std::string(command),
                                            std::chrono::steady_clock::now() + s.timeout_});
        frame = make_request(seq, command, std::move(arguments));
        ++s.wake_;
    }
    s.due_.notify_all();  // the watchdog may need to wake for an earlier deadline
    if (write_frame(s, encode_message(frame))) return seq;
    Pending orphaned;
    {
        std::lock_guard lock(s.mutex_);
        auto pending = s.pending_.find(seq);
        if (pending != s.pending_.end()) { orphaned = std::move(pending->second); s.pending_.erase(pending); }
    }
    if (orphaned.handler)
        orphaned.handler(Json(nullptr), error_object("DAP_CLOSED", "无法写入调试适配器管道。", orphaned.command));
    return seq;
}

void Client::request(std::string_view command, Json arguments, Reply on_reply) {
    send(command, std::move(arguments), std::move(on_reply));
}

void Client::initialize(const std::string& adapter_id, Reply on_reply) {
    auto& s = *state_;
    {
        std::lock_guard lock(s.mutex_);
        s.adapter_id_ = adapter_id;
    }
    Json arguments{{"adapterID", adapter_id.empty() ? std::string("taocode") : adapter_id},
                   {"clientID", "taocode"},
                   {"clientName", "TaoCode"},
                   {"linesStartAt1", true},    // DAP is 1-based: the UI must add 1
                   {"columnsStartAt1", true},  // ...for columns too
                   {"pathFormat", "uri"},
                   {"supportsVariableType", true},
                   // Both reverse requests are answered for real now: a command the
                   // adapter wants run in a terminal is launched, and a nested
                   // session really is started.
                   {"supportsRunInTerminalRequest", true},
                   {"supportsProgressReporting", true},
                   {"supportsInvalidatedEvent", false}};
    send("initialize", std::move(arguments),
         [this, handler = std::move(on_reply)](Json capabilities, Json error) {
             if (error.is_null()) {
                 // 能力要记住：terminate/restart 的可用性由 `supportsTerminateRequest` /
                 // `supportsRestartRequest` 决定（见下面的 supports_* / terminate / restart）。
                 {
                     std::lock_guard lock(state_->mutex_);
                     state_->capabilities_ = capabilities.is_object() ? capabilities : Json::object();
                 }
                 // The spec mandates the `initialized` event after a successful
                 // initialize and before launch. It is fire-and-forget.
                 std::int64_t seq = 0;
                 {
                     std::lock_guard lock(state_->mutex_);
                     seq = state_->seq_++;
                 }
                 write_frame(*state_, encode_message(make_event(seq, "initialized", Json::object())));
             }
             if (handler) handler(std::move(capabilities), std::move(error));
         });
}

// Shared launch/attach normalization: type/name defaults, env list→object, and
// workspace-relative paths absolutised for the adapter.
Json normalize_configuration(const Client& client, Json configuration, const char* request) {
    Json arguments = configuration.is_object() ? std::move(configuration) : Json::object();
    const auto type = text_of(arguments, "type");
    if (type.empty()) arguments["type"] = "taocode";
    arguments["request"] = request;
    if (text_of(arguments, "name").empty()) arguments["name"] = "TaoCode";
    for (const auto& key : path_configuration_keys) {
        const auto found = arguments.find(std::string(key));
        if (found != arguments.end() && found->is_string()) *found = client.to_native(found->get<std::string>());
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
    return arguments;
}

void Client::launch(Json configuration, Reply on_reply) {
    std::string kind;
    {
        std::lock_guard lock(state_->mutex_);
        kind = state_->adapter_id_;
    }
    Json arguments = normalize_configuration(*this, std::move(configuration), "launch");
    if (text_of(arguments, "type").empty() || text_of(arguments, "type") == "taocode") arguments["type"] = kind;
    send("launch", std::move(arguments), std::move(on_reply));
}

// `attach` joins an already-running process (IDEA's Attach to Process); the
// configuration carries adapter-specific selectors like processId or pipeName.
void Client::attach(Json configuration, Reply on_reply) {
    std::string kind;
    {
        std::lock_guard lock(state_->mutex_);
        kind = state_->adapter_id_;
    }
    Json arguments = normalize_configuration(*this, std::move(configuration), "attach");
    if (text_of(arguments, "type").empty() || text_of(arguments, "type") == "taocode") arguments["type"] = kind;
    send("attach", std::move(arguments), std::move(on_reply));
}

void Client::set_exception_breakpoints(const Json& filters, Reply on_reply) {
    auto& s = *state_;
    Json list = Json::array();
    if (filters.is_array()) for (const auto& item : filters) if (item.is_string()) list.push_back(item);
    {
        std::lock_guard lock(s.mutex_);
        s.exception_filters_ = list;  // remembered, so a restart re-applies it
    }
    if (!s.running_.load()) {
        if (on_reply) on_reply(Json{{"ok", true}, {"filters", list}, {"deferred", true}}, Json(nullptr));
        return;
    }
    send("setExceptionBreakpoints", Json{{"filters", list}}, wrap_ok(std::move(on_reply)));
}

void Client::threads(Reply on_reply) {
    send("threads", Json::object(),
         shaped(std::move(on_reply), [](const Json& body) {
             Json threads = Json::array();
             if (body.contains("threads") && body.at("threads").is_array())
                 for (const auto& thread : body.at("threads"))
                     threads.push_back({{"id", thread.value("id", 0)}, {"name", thread.value("name", std::string())}});
             return Json{{"threads", std::move(threads)}};
         }));
}

void Client::set_configuration_done(Reply on_reply) {
    send("configurationDone", Json::object(), std::move(on_reply));
}

void Client::set_breakpoints(const std::string& rel_path, const Json& requested, Reply on_reply) {
    const auto key = slash_form(rel_path);
    const Json points = normalize_breakpoints(requested);
    {
        std::lock_guard lock(state_->mutex_);
        if (points.empty()) state_->breakpoints_.erase(key);
        else state_->breakpoints_[key] = points;  // remembered, so a restart re-applies
    }
    if (!state_->running_.load()) {
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


void Client::goto_targets(const std::string& rel_path, long line, long column, Reply on_reply) {
    if (!supports_goto_targets()) {
        on_reply(Json(nullptr), Json{{"code", "DAP_UNSUPPORTED"},
                                     {"message", "适配器未声明 supportsGotoTargetsRequest，不支持运行到光标处。"}});
        return;
    }
    // `source.path` 走与断点同一条路径规则（绝对路径 + sourceReference:0），否则适配器找不到文件。
    Json arguments{{"source", Json{{"path", to_native(slash_form(rel_path))}, {"sourceReference", 0}}},
                   {"line", line}};
    if (column > 0) arguments["column"] = column;
    send("gotoTargets", std::move(arguments),
         shaped(std::move(on_reply), [](const Json& body) { return shape_goto_targets(body); }));
}

void Client::goto_target(long thread_id, long target_id, Reply on_reply) {
    send("goto", Json{{"threadId", thread_id}, {"targetId", target_id}}, wrap_ok(std::move(on_reply)));
}

void Client::restart_frame(long frame_id, Reply on_reply) {
    if (!supports_restart_frame()) {
        on_reply(Json(nullptr), Json{{"code", "DAP_UNSUPPORTED"},
                                     {"message", "适配器未声明 supportsRestartFrame，无法丢弃帧。"}});
        return;
    }
    send("restartFrame", Json{{"frameId", frame_id}}, wrap_ok(std::move(on_reply)));
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

void Client::exception_details(long thread_id, Reply on_reply) {
    send("exceptionInfo", Json{{"threadId", thread_id}},
         shaped(std::move(on_reply), [](const Json& body) { return shape_exception_info(body); }));
}

void Client::completions(const std::string& text, long column, long frame_id, long line, Reply on_reply) {
    if (!supports_completions()) {
        on_reply(Json(nullptr), Json{{"code", "DAP_UNSUPPORTED"},
                                     {"message", "适配器未声明 supportsCompletionsRequest，不支持调试表达式补全。"}});
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
        on_reply(Json(nullptr), Json{{"code", "DAP_UNSUPPORTED"},
                                     {"message", "适配器未声明 supportsBreakpointLocationsRequest，无法预览断点位置。"}});
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

// Waits (bounded) for the reader thread to observe that the adapter is gone. Used
// by disconnect() so the caller can drop the Client without racing a callback.
void Client::wait_for_exit(std::chrono::milliseconds limit) const {
    const auto deadline = std::chrono::steady_clock::now() + limit;
    while (!state_->exited_.load() && std::chrono::steady_clock::now() < deadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
}

void Client::disconnect(bool terminate_debuggee, Reply on_reply) {
    send("disconnect", Json{{"terminateDebuggee", terminate_debuggee}}, wrap_ok(std::move(on_reply)));
    // Wait for the adapter to actually go away, then reclaim it: the caller is
    // allowed to destroy this Client the moment disconnect() returns.
    wait_for_exit(std::chrono::seconds(5));
    shutdown();
}

Json Client::capabilities() const {
    std::lock_guard lock(state_->mutex_);
    return state_->capabilities_;
}

bool Client::supports_terminate() const {
    const auto flags = capabilities();
    return flags.contains("supportsTerminateRequest") && flags.at("supportsTerminateRequest").is_boolean()
               && flags.at("supportsTerminateRequest").get<bool>();
}

bool Client::supports_restart() const {
    const auto flags = capabilities();
    return flags.contains("supportsRestartRequest") && flags.at("supportsRestartRequest").is_boolean()
               && flags.at("supportsRestartRequest").get<bool>();
}

bool Client::supports_goto_targets() const {
    const auto flags = capabilities();
    return flags.contains("supportsGotoTargetsRequest") && flags.at("supportsGotoTargetsRequest").is_boolean()
               && flags.at("supportsGotoTargetsRequest").get<bool>();
}

bool Client::supports_restart_frame() const {
    const auto flags = capabilities();
    return flags.contains("supportsRestartFrame") && flags.at("supportsRestartFrame").is_boolean()
               && flags.at("supportsRestartFrame").get<bool>();
}

// 规范里这个能力位**默认 false**（不是"没声明就当支持"），所以必须显式判真。
bool Client::supports_completions() const {
    const auto flags = capabilities();
    return flags.contains("supportsCompletionsRequest") && flags.at("supportsCompletionsRequest").is_boolean() &&
           flags.at("supportsCompletionsRequest").get<bool>();
}

bool Client::supports_breakpoint_locations() const {
    const auto flags = capabilities();
    return flags.contains("supportsBreakpointLocationsRequest") &&
           flags.at("supportsBreakpointLocationsRequest").is_boolean() &&
           flags.at("supportsBreakpointLocationsRequest").get<bool>();
}

void Client::terminate(Reply on_reply) {
    if (!supports_terminate()) {
        // 没有 terminate 能力的适配器（cpvsdbg 之外的不少实现）只能用 disconnect 收场；
        // `terminateDebuggee: true` 与 terminate 是同一种用户可见结果（目标进程结束）。
        send("disconnect", Json{{"terminateDebuggee", true}}, wrap_ok(std::move(on_reply)));
        return;
    }
    send("terminate", Json::object(), wrap_ok(std::move(on_reply)));
}

void Client::restart(Json arguments, Reply on_reply) {
    if (!supports_restart()) {
        on_reply(Json(nullptr), Json{{"code", "DAP_UNSUPPORTED"},
                                     {"message", "适配器未声明 supportsRestartRequest，无法原地重新运行。"}});
        return;
    }
    send("restart", arguments.is_object() ? std::move(arguments) : Json::object(), wrap_ok(std::move(on_reply)));
}

void Client::start_debugging(const std::string& adapter_id, Json launch_configuration, Reply on_reply) {
    auto startup = std::make_shared<Startup>();
    startup->adapter_id = adapter_id;
    startup->configuration = launch_configuration.is_object() ? std::move(launch_configuration) : Json::object();
    startup->done = std::move(on_reply);
    const bool attach_mode = text_of(startup->configuration, "request") == "attach";
    initialize(adapter_id, [this, startup, attach_mode](Json capabilities, Json error) {
        if (!error.is_null()) { settle(startup, Json(nullptr), std::move(error)); return; }
        startup->capabilities = std::move(capabilities);
        // IDEA's Attach to Process is the same handshake with the `attach` request.
        auto connect = [this, startup](Json, Json error) {
            if (!error.is_null()) { settle(startup, Json(nullptr), std::move(error)); return; }
            apply_remembered_breakpoints(startup);
        };
        if (attach_mode) attach(startup->configuration, connect);
        else launch(startup->configuration, connect);
    });
}

// Installs every remembered breakpoint, then configurationDone once all answers
// are in. One failing file is reported inside `breakpoints` but never aborts.
void Client::apply_remembered_breakpoints(std::shared_ptr<Startup> startup) {
    std::vector<std::pair<std::string, Json>> remembered;
    Json exception_filters = Json::array();
    {
        std::lock_guard lock(state_->mutex_);
        remembered.assign(state_->breakpoints_.begin(), state_->breakpoints_.end());
        exception_filters = state_->exception_filters_;
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
    // Exception breakpoints ride on the same handshake, before configurationDone;
    // a failure is ignored the same way a failing file breakpoint is.
    if (exception_filters.is_array() && !exception_filters.empty())
        set_exception_breakpoints(exception_filters, [startup](Json, Json) {});
    if (remembered.empty()) { advance(); return; }
    for (const auto& [path, lines] : remembered) {
        set_breakpoints(path, lines, [startup, path, advance](Json result, Json error) {
            Json report;
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
    std::lock_guard lock(state_->mutex_);
    Json map = Json::object();
    for (const auto& [path, points] : state_->breakpoints_) map[path] = points;
    return map;
}

void Client::forget_breakpoints(const std::string& rel_path) {
    std::lock_guard lock(state_->mutex_);
    state_->breakpoints_.erase(slash_form(rel_path));
}

void Client::clear_breakpoints() {
    std::lock_guard lock(state_->mutex_);
    state_->breakpoints_.clear();
}

bool Client::running() const { return state_->running_.load(); }

bool Client::exited() const { return state_->exited_.load(); }

long Client::exit_code() const { return state_->exit_code_.load(); }

bool Client::debuggee_alive() const { return state_->debuggee_alive_.load(); }

void Client::close_pipes_and_kill() {
    auto& s = *state_;
    std::lock_guard lock(s.write_mutex_);
    if (s.stdin_write_) {
        CloseHandle(static_cast<HANDLE>(s.stdin_write_));
        s.stdin_write_ = nullptr;
    }
    // Closing our job handle would also reap the tree, but terminate explicitly so
    // the blocked ReadFile returns immediately instead of on handle close.
    if (s.job_) TerminateJobObject(static_cast<HANDLE>(s.job_), 1);
    else if (s.process_) TerminateProcess(static_cast<HANDLE>(s.process_), 1);
}

void Client::shutdown() noexcept {
    auto& s = *state_;
    try {
        bool begun = false;
        std::vector<std::shared_ptr<Client>> nested;
        {
            std::lock_guard lock(s.mutex_);
            begun = s.tearing_;
            s.tearing_ = true;
            s.running_.store(false);
            nested.swap(s.nested_);
        }
        s.due_.notify_all();
        if (begun) {
            // Idempotent: a second call only has to join threads that may still be
            // winding down (the destructor and WM_CLOSE both come through here).
            if (s.watchdog_.joinable() && s.watchdog_.get_id() != std::this_thread::get_id()) s.watchdog_.join();
            if (s.reader_.joinable() && s.reader_.get_id() != std::this_thread::get_id()) s.reader_.join();
            return;
        }
        fail_pending(s, "调试会话已关闭。");
        // Close stdin (adapters exit on EOF) and kill the job, which unblocks the
        // reader thread's pending ReadFile at once.
        close_pipes_and_kill();
        // The reader is joined BEFORE `stopped_` is raised: its last act is the
        // synthetic "connection closed" terminated event, which the UI needs.
        const bool from_reader = s.reader_.joinable() && s.reader_.get_id() == std::this_thread::get_id();
        if (from_reader) {
            std::lock_guard lock(s.mutex_);
            s.stopped_ = true;  // cannot join ourselves: drop every later callback
            s.reader_.detach();
        } else {
            if (s.reader_.joinable()) s.reader_.join();
            std::lock_guard lock(s.mutex_);
            s.stopped_ = true;
        }
        {
            std::lock_guard lock(s.mutex_);
            s.watching_ = false;
        }
        s.due_.notify_all();
        if (s.watchdog_.joinable()) s.watchdog_.join();
        {
            std::lock_guard lock(s.write_mutex_);
            for (auto** handle : {&s.stdout_read_, &s.process_, &s.thread_, &s.job_}) {
                if (*handle) CloseHandle(static_cast<HANDLE>(*handle));
                *handle = nullptr;
            }
        }
        // Sessions this one started for the adapter end with it.
        for (auto& session : nested) if (session) session->shutdown();
    } catch (...) {
        // Teardown is the last resort on the UI thread: it must never throw.
    }
}

}  // namespace dap
}  // namespace taocode
