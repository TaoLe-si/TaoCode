#include "mcp_client.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include "text.hpp"

#include <algorithm>
#include <chrono>
#include <ctime>
#include <cstdio>
#include <cwctype>
#include <cwchar>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace taocode::mcp_client {
namespace {

using Clock = std::chrono::steady_clock;
constexpr std::size_t kMaxMessageBytes = 16 * 1024 * 1024;
constexpr std::size_t kDefaultTimeoutMs = 30'000;

struct ClientError : std::runtime_error {
    std::string kind;
    ClientError(std::string failure_kind, std::string message)
        : std::runtime_error(std::move(message)), kind(std::move(failure_kind)) {}
};

std::wstring quote_argument(const std::wstring& value) {
    if (!value.empty() && value.find_first_of(L" \t\"") == std::wstring::npos) return value;
    std::wstring quoted = L"\"";
    for (std::size_t i = 0; i != value.size(); ++i) {
        std::size_t slashes = 0;
        while (i != value.size() && value[i] == L'\\') { ++slashes; ++i; }
        if (i == value.size()) { quoted.append(slashes * 2, L'\\'); break; }
        if (value[i] == L'\"') quoted.append(slashes * 2 + 1, L'\\');
        else quoted.append(slashes, L'\\');
        quoted.push_back(value[i]);
    }
    quoted.push_back(L'\"');
    return quoted;
}

HANDLE create_kill_job(HANDLE process) {
    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    if (!job) return nullptr;
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) ||
        !AssignProcessToJobObject(job, process)) {
        CloseHandle(job);
        return nullptr;
    }
    return job;
}

struct CaseInsensitiveLess {
    bool operator()(const std::wstring& left, const std::wstring& right) const {
        return _wcsicmp(left.c_str(), right.c_str()) < 0;
    }
};

bool sanitize_inherited_env_key(const std::wstring& key) {
    std::wstring upper = key;
    std::transform(upper.begin(), upper.end(), upper.begin(), [](wchar_t value) {
        return static_cast<wchar_t>(std::towupper(value));
    });
    static const std::set<std::wstring> exact = {
        L"NODE_ENV", L"ELECTRON_RUN_AS_NODE", L"NODE_NO_WARNINGS",
        L"HTTP_PROXY", L"HTTPS_PROXY", L"ALL_PROXY", L"NO_PROXY",
        L"NODE_EXTRA_CA_CERTS", L"SSL_CERT_FILE", L"SSL_CERT_DIR", L"REQUESTS_CA_BUNDLE",
        L"CURL_CA_BUNDLE", L"GIT_SSL_CAINFO", L"ZCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY",
        L"ZCODE_REMOTE_HTTP_PROXY", L"ZCODE_REMOTE_NO_PROXY", L"ZCODE_CUA_PERMISSION_BROKER_SOCKET",
        L"ZCODE_CUA_PERMISSION_BROKER_TOKEN", L"ZCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER",
        L"ZCODE_CUA_PLUGIN_AUTHORITY", L"ZCODE_MODEL_TELEMETRY_ENABLED",
        L"OTEL_EXPORTER_OTLP_ENDPOINT", L"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        L"OTEL_EXPORTER_OTLP_HEADERS", L"OTEL_EXPORTER_OTLP_TRACES_HEADERS",
        L"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", L"OTEL_EXPORTER_OTLP_METRICS_HEADERS",
        L"OTEL_SERVICE_NAME", L"OTEL_RESOURCE_ATTRIBUTES", L"OTEL_EXPORTER_OTLP_COMPRESSION",
        L"ZCODE_TELEMETRY_DEVICE_MID", L"ZCODE_TELEMETRY_USER_ID",
        L"ZCODE_TELEMETRY_USER_ID_HASH", L"ZCODE_TELEMETRY_USER_SUBJECT_ID",
        L"ZCODE_TELEMETRY_IDENTITY_STATE", L"ZCODE_TELEMETRY_RUNTIME_SURFACE",
        L"ZCODE_TELEMETRY_RUNTIME_DISTRIBUTION",
    };
    if (exact.contains(upper)) return true;

    std::wstring_view package_key;
    if (upper.starts_with(L"NPM_CONFIG_")) package_key = std::wstring_view(upper).substr(11);
    else if (upper.starts_with(L"YARN_")) package_key = std::wstring_view(upper).substr(5);
    else if (upper.starts_with(L"PNPM_")) package_key = std::wstring_view(upper).substr(5);
    else return false;
    static const std::set<std::wstring> package_manager_keys = {
        L"HTTP_PROXY", L"HTTPS_PROXY", L"PROXY", L"ALL_PROXY", L"NO_PROXY", L"CAFILE", L"CA",
    };
    return package_manager_keys.contains(std::wstring(package_key));
}

std::vector<wchar_t> merged_environment(const Json& env) {
    std::map<std::wstring, std::wstring, CaseInsensitiveLess> values;
    LPWCH block = GetEnvironmentStringsW();
    if (block) {
        for (const wchar_t* entry = block; *entry; entry += std::wcslen(entry) + 1) {
            const std::wstring item(entry);
            const auto split = item.find(L'=', item.starts_with(L"=") ? 1 : 0);
            if (split == std::wstring::npos) continue;
            const auto key = item.substr(0, split);
            if (sanitize_inherited_env_key(key)) continue;
            values[key] = item.substr(split + 1);
        }
        FreeEnvironmentStringsW(block);
    }
    if (env.is_object()) {
        for (auto it = env.begin(); it != env.end(); ++it) {
            if (!it.value().is_string() || it.key().empty()) continue;
            values[wide(it.key())] = wide(it.value().get<std::string>());
        }
    }
    std::vector<wchar_t> result;
    for (const auto& [key, value] : values) {
        result.insert(result.end(), key.begin(), key.end());
        result.push_back(L'=');
        result.insert(result.end(), value.begin(), value.end());
        result.push_back(L'\0');
    }
    result.push_back(L'\0');
    return result;
}

std::string model_name_part(std::string_view value) {
    std::string result;
    result.reserve(value.size());
    bool previous_underscore = false;
    for (const unsigned char character : value) {
        const bool allowed = (character >= 'a' && character <= 'z') ||
                             (character >= 'A' && character <= 'Z') ||
                             (character >= '0' && character <= '9') ||
                             character == '_' || character == '-';
        const char next = allowed ? static_cast<char>(character) : '_';
        if (next == '_' && previous_underscore) continue;
        result.push_back(next);
        previous_underscore = next == '_';
    }
    return result.empty() ? "unknown" : result;
}

std::string failure_kind(const std::exception& error) {
    if (const auto* client = dynamic_cast<const ClientError*>(&error)) return client->kind;
    return "connection_failed";
}

std::string now_iso_utc() {
    const auto now = std::chrono::system_clock::now();
    const auto milliseconds = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch());
    const auto seconds = std::chrono::system_clock::to_time_t(now);
    std::tm calendar{};
    gmtime_s(&calendar, &seconds);
    char base[24]{};
    std::strftime(base, sizeof(base), "%Y-%m-%dT%H:%M:%S", &calendar);
    char suffix[8]{};
    std::snprintf(suffix, sizeof(suffix), ".%03lldZ", static_cast<long long>(milliseconds.count() % 1000));
    return std::string(base) + suffix;
}

Json failure_status(std::string transport, std::string kind, std::string message) {
    return {{"transport", std::move(transport)}, {"status", "failed"}, {"updatedAt", now_iso_utc()},
            {"toolCount", 0}, {"failureKind", std::move(kind)}, {"error", std::move(message)}};
}

Json connected_status(std::string transport, std::size_t count, const std::string& version) {
    return {{"transport", std::move(transport)}, {"status", "connected"}, {"updatedAt", now_iso_utc()},
            {"toolCount", count},
            {"protocolEra", version == "2024-11-05" ? "legacy" : "modern"}};
}

Json disabled_status(std::string transport) {
    return {{"transport", std::move(transport)}, {"status", "disabled"}, {"updatedAt", now_iso_utc()}, {"toolCount", 0}};
}

}  // namespace

struct Manager::Connection {
    HANDLE stdin_write{};
    HANDLE stdout_read{};
    HANDLE process{};
    HANDLE process_thread{};
    HANDLE job{};
    std::string server_id;
    std::string server_name;
    std::string protocol_version;
    std::size_t timeout_ms{kDefaultTimeoutMs};
    std::uint64_t request_id{};
    std::string read_buffer;
    Json config;
    std::filesystem::path workspace_root;
    std::filesystem::path working_directory;
    std::vector<Json> tools;
    std::atomic<bool>* cancel_flag{};

    ~Connection() { stop(); }

    bool alive() const {
        return process && WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
    }

    void start(const Json& server, const std::filesystem::path& cwd, std::atomic<bool>* cancellation) {
        if (!server.contains("command") || !server.at("command").is_string() ||
            server.at("command").get<std::string>().empty())
            throw ClientError("config_invalid", "MCP stdio command is empty.");
        server_id = server.at("id").get<std::string>();
        server_name = server.at("name").get<std::string>();
        config = server;
        workspace_root = cwd;
        working_directory = cwd;
        if (server.contains("cwd")) {
            if (!server.at("cwd").is_string()) throw ClientError("config_invalid", "MCP working directory must be a string.");
            const auto configured_cwd = server.at("cwd").get<std::string>();
            if (!configured_cwd.empty()) {
                const std::filesystem::path path(wide(configured_cwd));
                working_directory = path.is_absolute() ? path : cwd / path;
                working_directory = working_directory.lexically_normal();
            }
        }
        cancel_flag = cancellation;
        const auto timeout = server.value("timeoutMs", std::size_t{0});
        timeout_ms = timeout > 0 ? std::min<std::size_t>(timeout, 600'000) : kDefaultTimeoutMs;

        SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
        HANDLE child_stdin = nullptr;
        HANDLE child_stdout = nullptr;
        if (!CreatePipe(&child_stdin, &stdin_write, &inheritable, 1u << 20) ||
            !CreatePipe(&stdout_read, &child_stdout, &inheritable, 1u << 20)) {
            if (child_stdin) CloseHandle(child_stdin);
            if (stdin_write) CloseHandle(stdin_write);
            if (stdout_read) CloseHandle(stdout_read);
            stdin_write = stdout_read = nullptr;
            throw ClientError("process_start_failed", "Unable to create MCP stdio pipes.");
        }
        SetHandleInformation(stdin_write, HANDLE_FLAG_INHERIT, 0);
        SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, 0);

        const auto command = wide(server.at("command").get<std::string>());
        std::wstring line = quote_argument(command);
        if (server.contains("args") && server.at("args").is_array()) {
            for (const auto& arg : server.at("args")) {
                if (!arg.is_string()) continue;
                line += L" " + quote_argument(wide(arg.get<std::string>()));
            }
        }
        std::vector<wchar_t> mutable_command(line.begin(), line.end());
        mutable_command.push_back(L'\0');
        auto environment = merged_environment(server.value("env", Json::object()));

        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdInput = child_stdin;
        startup.hStdOutput = child_stdout;
        startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
        PROCESS_INFORMATION info{};
        const auto cwd_wide = working_directory.native();
        const auto created = CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, TRUE,
                                            CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                                            environment.data(), working_directory.empty() ? nullptr : cwd_wide.c_str(), &startup, &info);
        CloseHandle(child_stdin);
        CloseHandle(child_stdout);
        if (!created) {
            const auto code = GetLastError();
            CloseHandle(stdin_write); CloseHandle(stdout_read);
            stdin_write = stdout_read = nullptr;
            throw ClientError("process_start_failed", "Unable to start MCP server (Windows error " + std::to_string(code) + ").");
        }
        process = info.hProcess;
        process_thread = info.hThread;
        job = create_kill_job(process);
        if (!job) {
            TerminateProcess(process, 1);
            WaitForSingleObject(process, INFINITE);
            close_handles();
            throw ClientError("process_start_failed", "Unable to manage MCP server process lifetime.");
        }
        ResumeThread(process_thread);

        const auto configured_version = server.value("protocolVersion", std::string());
        // ZCode stores "auto" as a form sentinel, not a wire protocol version.  Until
        // the SDK's disposable sibling probe is available here, resolve it to the
        // current modern MCP version instead of sending the sentinel to initialize.
        const std::string requested = configured_version == "legacy" ? "2024-11-05" :
            configured_version.empty() || configured_version == "auto" || configured_version == "2026-07-28"
                ? "2026-07-28" : std::string();
        if (requested.empty()) throw ClientError("config_invalid", "MCP protocol version is not supported.");
        const Json initialized = request("initialize", {
            {"protocolVersion", requested}, {"capabilities", Json::object()},
            {"clientInfo", {{"name", "taocode"}, {"version", "0.1.0"}}},
        });
        if (!initialized.contains("protocolVersion") || !initialized.at("protocolVersion").is_string())
            throw ClientError("protocol_negotiation_failed", "MCP initialize response omitted protocolVersion.");
        protocol_version = initialized.at("protocolVersion").get<std::string>();
        if (protocol_version != requested)
            throw ClientError("protocol_negotiation_failed", "MCP server selected a protocol version different from the configured version.");
        notify("notifications/initialized");

        try {
            Json page_params = Json::object();
            std::set<std::string> seen_cursors;
            for (;;) {
                const auto result = request("tools/list", page_params);
                if (!result.contains("tools") || !result.at("tools").is_array())
                    throw ClientError("tool_list_failed", "MCP tools/list response is invalid.");
                for (const auto& tool : result.at("tools")) {
                    if (!tool.is_object()) continue;
                    const auto raw_name = tool.contains("name") && tool.at("name").is_string()
                        ? tool.at("name").get<std::string>() : std::string("unknown");
                    const std::string name = "mcp__" + model_name_part(server_name) + "__" + model_name_part(raw_name);
                    Json schema = tool.value("inputSchema", Json());
                    if (!schema.is_object()) {
                        schema = Json::object({{"type", "object"}, {"properties", Json::object()}, {"additionalProperties", true}});
                    } else {
                        if (!schema.contains("properties") || !schema.at("properties").is_object()) schema["properties"] = Json::object();
                        schema["type"] = "object";
                    }
                    const std::string description = tool.contains("description") && tool.at("description").is_string()
                        ? tool.at("description").get<std::string>() : std::string();
                    Json descriptor{{"serverId", server_id}, {"serverName", server_name}, {"toolName", raw_name},
                                    {"name", name}, {"description", description}, {"inputSchema", std::move(schema)}};
                    if (tool.contains("outputSchema") && tool.at("outputSchema").is_object()) descriptor["outputSchema"] = tool.at("outputSchema");
                    if (tool.contains("annotations") && tool.at("annotations").is_object()) {
                        const auto& raw = tool.at("annotations");
                        Json annotations = Json::object();
                        for (const char* key : {"readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"}) {
                            if (raw.contains(key) && raw.at(key).is_boolean()) annotations[key] = raw.at(key);
                        }
                        descriptor["annotations"] = std::move(annotations);
                    }
                    tools.push_back(std::move(descriptor));
                }
                if (!result.contains("nextCursor")) break;
                if (!result.at("nextCursor").is_string())
                    throw ClientError("tool_list_failed", "MCP tools/list cursor is invalid.");
                const auto cursor = result.at("nextCursor").get<std::string>();
                if (cursor.empty()) break;
                if (!seen_cursors.insert(cursor).second)
                    throw ClientError("tool_list_failed", "MCP tools/list repeated a cursor.");
                page_params = {{"cursor", cursor}};
            }
        } catch (const ClientError& error) {
            if (error.kind == "tool_list_failed") throw;
            throw;
        }
    }

    void close_handles() noexcept {
        for (HANDLE* handle : {&stdin_write, &stdout_read, &process_thread, &process, &job}) {
            if (*handle) { CloseHandle(*handle); *handle = nullptr; }
        }
    }

    void stop() noexcept {
        if (stdin_write) { CloseHandle(stdin_write); stdin_write = nullptr; }
        if (process) {
            if (WaitForSingleObject(process, 2000) == WAIT_TIMEOUT) {
                if (job) TerminateJobObject(job, 0);
                else TerminateProcess(process, 0);
                WaitForSingleObject(process, 2000);
            }
        }
        if (stdout_read) { CloseHandle(stdout_read); stdout_read = nullptr; }
        if (process_thread) { CloseHandle(process_thread); process_thread = nullptr; }
        if (process) { CloseHandle(process); process = nullptr; }
        if (job) { CloseHandle(job); job = nullptr; }
    }

    void write_line(const Json& message) {
        if (!alive() || !stdin_write) throw ClientError("unexpected_disconnect", "MCP server is not running.");
        std::string bytes = message.dump();
        if (bytes.size() > kMaxMessageBytes) throw ClientError("protocol_error", "MCP request exceeds the message limit.");
        bytes.push_back('\n');
        const char* cursor = bytes.data();
        std::size_t remaining = bytes.size();
        while (remaining) {
            DWORD written = 0;
            const DWORD request_size = static_cast<DWORD>(std::min<std::size_t>(remaining, 1u << 20));
            if (!WriteFile(stdin_write, cursor, request_size, &written, nullptr) || written == 0)
                throw ClientError("unexpected_disconnect", "Unable to write to MCP server.");
            cursor += written;
            remaining -= written;
        }
    }

    std::string read_line() {
        const auto deadline = Clock::now() + std::chrono::milliseconds(timeout_ms);
        for (;;) {
            if (cancel_flag && cancel_flag->load()) throw ClientError("connection_failed", "MCP request cancelled.");
            const auto newline = read_buffer.find('\n');
            if (newline != std::string::npos) {
                std::string line = read_buffer.substr(0, newline);
                read_buffer.erase(0, newline + 1);
                if (!line.empty() && line.back() == '\r') line.pop_back();
                return line;
            }
            if (read_buffer.size() > kMaxMessageBytes)
                throw ClientError("protocol_error", "MCP response exceeds the message limit.");
            DWORD available = 0;
            if (!PeekNamedPipe(stdout_read, nullptr, 0, nullptr, &available, nullptr))
                throw ClientError("unexpected_disconnect", "MCP server output pipe closed.");
            if (available) {
                char buffer[65536];
                DWORD read = 0;
                const DWORD amount = std::min<DWORD>(available, sizeof(buffer));
                if (!ReadFile(stdout_read, buffer, amount, &read, nullptr) || read == 0)
                    throw ClientError("unexpected_disconnect", "MCP server output pipe closed.");
                read_buffer.append(buffer, read);
                continue;
            }
            if (!alive()) throw ClientError("unexpected_disconnect", "MCP server exited before responding.");
            if (Clock::now() >= deadline) throw ClientError("connection_timeout", "MCP request timed out.");
            Sleep(10);
        }
    }

    Json request(std::string_view method, Json params) {
        const auto id = ++request_id;
        write_line({{"jsonrpc", "2.0"}, {"id", id}, {"method", method}, {"params", std::move(params)}});
        for (;;) {
            const auto line = read_line();
            if (line.empty()) continue;
            Json response;
            try { response = Json::parse(line); }
            catch (const Json::exception&) { throw ClientError("protocol_error", "MCP server returned invalid JSON."); }
            if (!response.is_object() || !response.contains("id") || response.at("id") != id) continue;
            if (response.contains("error")) {
                const auto error = response.at("error");
                const auto kind = method == "initialize" ? "protocol_negotiation_failed" :
                    method == "tools/list" ? "tool_list_failed" : "protocol_error";
                throw ClientError(kind,
                                  error.is_object() ? error.value("message", std::string("MCP request failed.")) : "MCP request failed.");
            }
            if (!response.contains("result") || !response.at("result").is_object())
                throw ClientError("protocol_error", "MCP server returned an invalid result.");
            return response.at("result");
        }
    }

    void notify(std::string_view method) {
        write_line({{"jsonrpc", "2.0"}, {"method", method}});
    }

    Json call(std::string_view name, const Json& arguments) {
        return request("tools/call", {{"name", name}, {"arguments", arguments}});
    }
};

Manager::Manager() = default;
Manager::~Manager() { stop_all(); }

Json Manager::configure(const Json& settings, const std::filesystem::path& working_directory) {
    if (!settings.is_object() || !settings.contains("servers") || !settings.at("servers").is_array())
        throw WorkspaceError("MCP_CONFIG_INVALID", "MCP settings must contain a servers array.");

    std::set<std::string> desired_ids;
    std::set<std::string> desired_names;
    std::map<std::string, Json> next_statuses;
    Json next_tools = Json::array();
    for (const auto& server : settings.at("servers")) {
        if (!server.is_object()) continue;
        const std::string id = server.value("id", std::string());
        const std::string name = server.value("name", id);
        const std::string transport = server.value("transport", std::string("stdio"));
        const bool enabled = server.value("enabled", true);
        if (id.empty()) continue;
        if (desired_ids.contains(id) || desired_names.contains(name)) {
            if (!desired_names.contains(name))
                next_statuses[name] = failure_status(transport, "config_invalid", "Duplicate MCP server id.");
            continue;
        }
        desired_ids.insert(id);
        desired_names.insert(name);

        if (!enabled) {
            auto existing = connections_.find(id);
            if (existing != connections_.end()) { existing->second->stop(); connections_.erase(existing); }
            next_statuses[name] = disabled_status(transport);
            continue;
        }
        if (transport != "stdio") {
            auto existing = connections_.find(id);
            if (existing != connections_.end()) { existing->second->stop(); connections_.erase(existing); }
            next_statuses[name] = failure_status(transport, "runtime_unavailable", "");
            continue;
        }

        auto existing = connections_.find(id);
        if (existing != connections_.end() && existing->second->config == server &&
            existing->second->workspace_root == working_directory && existing->second->alive()) {
            for (const auto& tool : existing->second->tools) next_tools.push_back(tool);
            next_statuses[name] = connected_status(transport, existing->second->tools.size(), existing->second->protocol_version);
            continue;
        }
        if (existing != connections_.end()) { existing->second->stop(); connections_.erase(existing); }

        auto connection = std::make_unique<Connection>();
        try {
            connection->start(server, working_directory, cancel_flag_);
            for (const auto& tool : connection->tools) next_tools.push_back(tool);
            next_statuses[name] = connected_status(transport, connection->tools.size(), connection->protocol_version);
            connections_[id] = std::move(connection);
        } catch (const std::exception& error) {
            next_statuses[name] = failure_status(transport, failure_kind(error), error.what());
        }
    }

    for (auto it = connections_.begin(); it != connections_.end();) {
        if (!desired_ids.contains(it->first)) {
            it->second->stop();
            it = connections_.erase(it);
        } else ++it;
    }
    statuses_ = std::move(next_statuses);
    tools_ = std::move(next_tools);
    return snapshot_unchecked();
}

Json Manager::snapshot_unchecked() {
    for (auto& [id, connection] : connections_) {
        if (connection->alive()) continue;
        const auto found = statuses_.find(connection->server_name);
        if (found != statuses_.end()) {
            found->second["status"] = "disconnected";
            found->second["updatedAt"] = now_iso_utc();
            found->second["toolCount"] = 0;
            found->second["failureKind"] = "unexpected_disconnect";
            found->second["error"] = "MCP server exited.";
        }
        connection->stop();
        connection.reset();
    }
    for (auto it = connections_.begin(); it != connections_.end();) {
        if (!it->second) it = connections_.erase(it);
        else ++it;
    }
    Json statuses = Json::object();
    for (const auto& [name, status] : statuses_) statuses[name] = status;
    Json tools = Json::array();
    for (const auto& tool : tools_) {
        const auto found = connections_.find(tool.at("serverId").get<std::string>());
        if (found != connections_.end() && found->second && found->second->alive()) tools.push_back(tool);
    }
    return {{"statuses", std::move(statuses)}, {"tools", std::move(tools)}};
}

Json Manager::snapshot() { return snapshot_unchecked(); }

Json Manager::call(const Json& params) {
    if (!params.is_object() || !params.contains("serverId") || !params.at("serverId").is_string() ||
        !params.contains("toolName") || !params.at("toolName").is_string())
        throw WorkspaceError("MCP_INVALID_CALL", "MCP call requires serverId and toolName.");
    const auto id = params.at("serverId").get<std::string>();
    const auto name = params.at("toolName").get<std::string>();
    const auto found = connections_.find(id);
    if (found == connections_.end() || !found->second->alive()) {
        snapshot_unchecked();
        throw WorkspaceError("MCP_SERVER_UNAVAILABLE", "MCP server is not connected.");
    }
    const auto descriptor = std::find_if(found->second->tools.begin(), found->second->tools.end(),
        [&](const Json& tool) { return tool.value("toolName", std::string()) == name; });
    if (descriptor == found->second->tools.end())
        throw WorkspaceError("MCP_TOOL_NOT_FOUND", "MCP tool is not available.");
    const Json arguments = params.value("arguments", Json::object());
    if (!arguments.is_object()) throw WorkspaceError("MCP_INVALID_CALL", "MCP tool arguments must be an object.");
    try {
        auto result = found->second->call(name, arguments);
        return result;
    } catch (const ClientError& error) {
        if (error.kind == "unexpected_disconnect") {
            const auto status = statuses_.find(found->second->server_name);
            if (status != statuses_.end()) {
                status->second["status"] = "disconnected";
                status->second["updatedAt"] = now_iso_utc();
                status->second["failureKind"] = error.kind;
                status->second["error"] = error.what();
                status->second["toolCount"] = 0;
            }
            found->second->stop();
            connections_.erase(found);
            tools_ = snapshot_unchecked().value("tools", Json::array());
        }
        throw WorkspaceError("MCP_TOOL_CALL_FAILED", error.what());
    }
}

void Manager::stop_all() noexcept {
    for (auto& [_, connection] : connections_) if (connection) connection->stop();
    connections_.clear();
    tools_ = Json::array();
}

}  // namespace taocode::mcp_client
