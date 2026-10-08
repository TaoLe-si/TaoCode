// TaoCode MCP 服务端实现 —— stdio JSON-RPC 2.0（MCP stdio 惯例：一行一帧）。
// 协议与工具的映射、闸门语义见 native/mcp_server.hpp 头注释与
// docs/batch-2026-10-06-mcpserver.md。这里**不监听任何网络端口**：输入输出就是 stdin/stdout，
// EOF 即结束；被权限挡住的调用回明确 reason，不静默放行。
#include "mcp_server.hpp"

#include "base64.hpp"
#include "fsops.hpp"       // absolute_path（:126-133 设备命名空间闸）、validate_component、random_suffix、valid_utf8
#include "git.hpp"
#include "projects.hpp"
#include "run_host.hpp"
#include "runner.hpp"
#include "text.hpp"

#include <windows.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>

namespace taocode {
namespace mcp {

namespace {

/// 协议层错误（tools/call 之前的形状问题）：转成 JSON-RPC error object。
/// 工具执行期的失败不走这里 —— 那是 result.isError=true + 文本 reason。
class ProtocolError : public std::runtime_error {
public:
    int code;
    ProtocolError(int code, const std::string& message) : std::runtime_error(message), code(code) {}
};

/// dump 永不因坏 UTF-8 抛（子进程输出/git 文件名可能是任意代码页字节）：非法位替换。
std::string dump(const Json& value) {
    return value.dump(-1, ' ', false, Json::error_handler_t::replace);
}

Json make_response(const Json& id, const Json& result) {
    return {{"jsonrpc", "2.0"}, {"id", id}, {"result", result}};
}

Json make_error(const Json& id, int code, const std::string& message) {
    return {{"jsonrpc", "2.0"}, {"id", id}, {"error", {{"code", code}, {"message", message}}}};
}

Json tool_ok(const std::string& text) {
    return {{"content", Json::array({{{"type", "text"}, {"text", text}}})}, {"isError", false}};
}

Json tool_error(const std::string& reason) {
    return {{"content", Json::array({{{"type", "text"}, {"text", reason}}})}, {"isError", true}};
}

std::string required_string(const Json& args, const char* key) {
    if (!args.contains(key) || !args.at(key).is_string())
        throw ProtocolError(-32602, std::string("Missing string parameter \"") + key + "\"");
    return args.at(key).get<std::string>();
}

Json object_schema(std::vector<std::pair<std::string, std::string>> properties,
                   std::vector<std::string> required) {
    Json json = {{"type", "object"}};
    Json props = Json::object();
    for (const auto& [name, type] : properties)
        props[name] = {{"type", type}, {"description", "see tools/list description"}};
    json["properties"] = std::move(props);
    json["required"] = required;
    json["additionalProperties"] = false;
    return json;
}

/// 权限模型：照抄 src/agent.ts:30 defaultAgentPermissions = { read:'allow', write:'ask',
/// run:'ask', network:'never' }。离屏服务端没有交互式审批人 ⇒ 'ask' 不询问、直接拒，
/// 只有进程级 --allow-write / --allow-run 把对应档升为 'allow'。'never' 档（network）
/// 在本服务里表现为：**根本没有联网工具**，没有可升档的开关。
enum class Tier { read, write, run };

const char* tier_text(Tier tier) {
    switch (tier) {
    case Tier::write: return "write";
    case Tier::run: return "run";
    default: return "read";
    }
}

struct ToolSpec {
    const char* name;
    Tier tier;
    const char* description;
    Json schema;
};

const std::vector<ToolSpec>& tool_specs() {
    // 8 个能力槽位 + ui.probe，落成 10 个工具名（run.output/run.stop 同槽位不同名字，
    // 与宿主桥上的 run.* 一族对齐）。
    static const std::vector<ToolSpec> specs = {
        {"fs.read", Tier::read,
         "Read one workspace text file. Returns {path,content,version,encoding,bom,readOnly}; the "
         "version is the fingerprint fs.write must echo back as expectedVersion.",
         object_schema({{"path", "string"}, {"encoding", "string"}}, {"path"})},
        {"fs.list", Tier::read,
         "Enumerate one workspace directory (default \"\" = root; excluded dirs as in the IDE). "
         "Returns the entry array [{name,path,kind}] directly (same shape the host bridge uses).",
         object_schema({{"path", "string"}}, {})},
        {"fs.write", Tier::write,
         "Write one workspace file (utf-8 by default). Requires the server flag --allow-write; "
         "expectedVersion must match the last fs.read version or the write fails with CONFLICT.",
         object_schema({{"path", "string"}, {"content", "string"}, {"expectedVersion", "string"},
                        {"encoding", "string"}, {"bom", "boolean"}, {"safeWrite", "boolean"}},
                       {"path", "content", "expectedVersion"})},
        {"git.status", Tier::read,
         "git status of the workspace-root repository: {available,head,branches,"
         "changes:[{path,indexStatus,workStatus,staged,untracked,ignored,renameFrom}]}.",
         object_schema({{"ignored", "boolean"}}, {})},
        {"git.diff", Tier::read,
         "git diff of one repository-relative path: {diff}. Optional staged/base/context/whole; "
         "absolute paths, drive letters and '..' are refused before git is touched.",
         object_schema({{"path", "string"}, {"staged", "boolean"}, {"base", "string"},
                        {"context", "integer"}, {"whole", "boolean"}},
                       {"path"})},
        {"project.list", Tier::read,
         "Recent-projects state of the TaoCode host (ProjectStore::state() at "
         "%LOCALAPPDATA%\\TaoCode\\projects.json).",
         Json{{"type", "object"}, {"properties", Json::object()}}},
        {"run.start", Tier::run,
         "Start a run through the host run_host Manager (returns {instance,label,parallel}). "
         "Requires --allow-run. argv-array ONLY: program + args, shell MUST be explicit false; "
         "shell:true, command strings and beforeLaunch chains are refused (they run via cmd.exe).",
         object_schema({{"label", "string"}, {"program", "string"}, {"args", "array"},
                        {"cwd", "string"}, {"env", "array"}, {"allowParallel", "boolean"}},
                       {"program", "args"})},
        {"run.output", Tier::run,
         "Drain pending chain steps, then return one instance's merged stdout+stderr so far: "
         "{instance,running,exitCode,text,dataB64,textIsUtf8}. Requires --allow-run.",
         object_schema({{"instance", "integer"}}, {"instance"})},
        {"run.stop", Tier::run,
         "Stop one instance (or all when instance<=0), job-object semantics. Requires --allow-run.",
         object_schema({{"instance", "integer"}}, {})},
        {"ui.probe", Tier::run,
         "Offscreen-debug front door: runs `node .tools/webview-console.mjs --port "
         "$TAOCODE_DEBUG_PORT ...` against the LIVE TaoCode IDE over its WebView2 CDP port and "
         "returns that JSON report (mounted / exceptions / consoleTail / snapshot). Requires "
         "--allow-run plus TAOCODE_DEBUG_PORT in this server's environment.",
         object_schema({{"script", "string"}, {"noReload", "boolean"}, {"waitMs", "integer"},
                        {"expectMount", "boolean"}},
                       {})},
    };
    return specs;
}

int find_tool(const std::string& name) {
    const auto& specs = tool_specs();
    for (std::size_t i = 0; i != specs.size(); ++i)
        if (specs[i].name == name) return static_cast<int>(i);
    return -1;
}

std::string trunc(std::string text, std::size_t limit = 240) {
    if (text.size() > limit) text = text.substr(0, limit) + "...";
    std::replace(text.begin(), text.end(), '\n', ' ');
    std::replace(text.begin(), text.end(), '\r', ' ');
    return text;
}

/// Windows CRT 的 argv 引号规则 —— 与 native/run_host.cpp:163-176 同一份模式
/// （对照 dap.cpp / IDEA CommandLineUtil:80-94）。这是**结构化参数边界**上的引号，
/// 不是把命令拼给 shell：CreateProcessW 的子进程按同一套规则还原 argv。
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

std::wstring environment_value(const wchar_t* name) {
    const DWORD size = GetEnvironmentVariableW(name, nullptr, 0);
    if (!size) return {};
    std::wstring value(size, L'\0');
    const DWORD length = GetEnvironmentVariableW(name, value.data(), size);
    if (!length) return {};
    value.resize(length);
    return value;
}

/// PATH 里找 node.exe（ui.probe 用）；找到返回绝对路径，找不到返回空串。
std::wstring find_node_exe() {
    const auto path = environment_value(L"PATH");
    std::size_t start = 0;
    while (start <= path.size()) {
        const auto end = path.find(L';', start);
        auto directory = path.substr(start, end == std::wstring::npos ? std::wstring::npos : end - start);
        if (!directory.empty() && directory.back() == L'\\') directory.pop_back();
        if (!directory.empty() && !directory.starts_with(L"\"")) {
            const auto candidate = directory + L"\\node.exe";
            if (GetFileAttributesW(candidate.c_str()) != INVALID_FILE_ATTRIBUTES) return candidate;
        }
        if (end == std::wstring::npos) break;
        start = end + 1;
    }
    return {};
}

/// 仓库相对路径的闸：与 workspace.cpp:307-323 的 parse_relative 同规则（那边未导出），
/// 逐段走 fsops::validate_component（`..`、设备名、非法字符、NTFS 数据流都在这里被拒）。
std::filesystem::path repo_relative(const std::string& text) {
    if (text.find('\0') != std::string::npos || !valid_utf8(text))
        fail("INVALID_PATH", "Path must be UTF-8 text without NUL bytes.");
    if ((!text.empty() && (text.front() == '/' || text.front() == '\\')) ||
        text.find(':') != std::string::npos)
        fail("INVALID_PATH", "Repository-relative paths only: absolute paths, drive letters and streams are refused.");
    std::string portable = text;
    std::replace(portable.begin(), portable.end(), '\\', '/');
    const fs::path input(std::u8string(portable.begin(), portable.end()));
    if (input.has_root_name() || input.has_root_directory() || input.is_absolute())
        fail("INVALID_PATH", "Repository-relative paths only.");
    fs::path result;
    for (const auto& part : input) {
        if (part.empty() || part == L".") continue;
        validate_component(part.native());
        result /= part;
    }
    if (result.empty()) fail("INVALID_PATH", "An empty path is not a repository-relative file.");
    return result;
}

int required_int(const Json& args, const char* key) {
    if (!args.contains(key) || !args.at(key).is_number_integer())
        throw ProtocolError(-32602, std::string("Missing integer parameter \"") + key + "\"");
    return args.at(key).get<int>();
}

}  // namespace

/// 每实例的运行输出缓冲 + 退出码（来自 run_host 的 run.output/run.exit 事件）。
struct RunSnapshot {
    std::string bytes;
    int exit_code = (std::numeric_limits<int>::min)();  // 未收到 run.exit 前的哨兵值
};

class Server::Impl {
public:
    explicit Impl(Options options) : options_(std::move(options)) {
        // 根路径过 native/fsops.hpp:126-133 的 absolute_path 闸：空/相对/NUL/盘符不完整都会抛
        // WorkspaceError；`\\?\`、`\\.\`、`\??\`、`\\??\` 设备与扩展命名空间在这里被拒，
        // 原文 "Device and extended Windows namespaces are not accepted."（fsops.hpp:133）
        // 是保留闸 —— 本层复用而不是重写，一个字都不改它。
        options_.root = absolute_path(options_.root, /*require_absolute=*/true);
        workspace_.open(options_.root);
        runs_ = std::make_unique<run_host::Manager>(
            [this](Json event) { on_run_event(std::move(event)); });
    }

    std::string handle(const std::string& line) {
        Json request;
        try {
            request = Json::parse(line);
        } catch (const std::exception& error) {
            return dump(make_error(Json(), -32700,
                                   std::string("Parse error: not a valid JSON-RPC frame: ") + error.what()));
        }
        if (!request.is_object())
            return dump(make_error(Json(), -32600, "Invalid request: expected a JSON-RPC object."));
        const Json id = request.contains("id") ? request.at("id") : Json();
        if (!request.contains("method") || !request.at("method").is_string()) {
            if (id.is_null()) return {};  // 无 id 又无 method：既不是请求也不是可答的 notification，丢帧不静默造假
            return dump(make_error(id, -32600, "Invalid request: missing string \"method\"."));
        }
        const auto method = request.at("method").get<std::string>();
        const bool is_notification = id.is_null();
        Json params = request.contains("params") ? request.at("params") : Json::object();
        try {
            if (method == "initialize") return dump(make_response(id, on_initialize(params)));
            if (method == "ping") return dump(make_response(id, Json::object()));
            if (method == "tools/list") return dump(make_response(id, on_tools_list()));
            if (method == "tools/call") {
                if (is_notification) return {};  // tools/call 是请求；带不上 id 的按 notification 丢弃（不应答）
                return dump(make_response(id, on_tool_call(params)));
            }
            if (method == "notifications/initialized") return {};  // 握手通知：按 MCP 不应答
            if (method.rfind("notifications/", 0) == 0) return {};
            if (is_notification) return {};      // JSON-RPC：未知 notification 无应答
            return dump(make_error(id, -32601, "Method not found: " + method));
        } catch (const ProtocolError& error) {
            if (is_notification) return {};
            return dump(make_error(id, error.code, error.what()));
        } catch (const WorkspaceError& error) {
            if (is_notification) return {};
            return dump(make_error(id, -32603, "Internal error " + error.code + ": " + error.what()));
        } catch (const std::exception& error) {
            if (is_notification) return {};
            return dump(make_error(id, -32603, std::string("Internal error: ") + error.what()));
        }
    }

private:
    Options options_;
    Workspace workspace_;
    std::unique_ptr<run_host::Manager> runs_;
    std::mutex outputs_mutex_;
    std::map<int, RunSnapshot> outputs_;
    int last_instance_ = 0;

    // —— MCP handshake 必需面 ——

    Json on_initialize(const Json& params) {
        if (!params.is_object())
            throw ProtocolError(-32602, "initialize params must be an object.");
        const auto requested = params.value("protocolVersion", std::string());
        // 协商：认得的版本原样回，认不出的回我们实现的最新版（MCP initialize 语义）。
        static const std::vector<std::string> supported = {"2024-11-05", "2025-03-26", "2025-06-18"};
        const std::string negotiated =
            std::find(supported.begin(), supported.end(), requested) != supported.end() ? requested
                                                                                         : "2025-06-18";
        return {{"protocolVersion", negotiated},
                {"capabilities", {{"tools", Json::object()}}},
                {"serverInfo", {{"name", "taocode"}, {"version", "0.1.0"},
                                {"title", "TaoCode IDE (offscreen debug bridge)"}}}};
    }

    Json on_tools_list() {
        Json tools = Json::array();
        for (const auto& spec : tool_specs())
            tools.push_back({{"name", spec.name},
                             {"description", spec.description + std::string(" [permission tier: ") +
                                                 tier_text(spec.tier) + "]"},
                             {"inputSchema", spec.schema}});
        return {{"tools", std::move(tools)}};
    }

    // —— 工具分派 + 闸门 + 审计 ——

    Json on_tool_call(const Json& params) {
        if (!params.is_object() || !params.contains("name") || !params.at("name").is_string())
            throw ProtocolError(-32602, "tools/call requires params.name (string).");
        const auto name = params.at("name").get<std::string>();
        const int index = find_tool(name);
        if (index < 0) throw ProtocolError(-32602, "Unknown tool: " + name);
        Json args = params.contains("arguments") ? params.at("arguments") : Json::object();
        if (!args.is_object())
            throw ProtocolError(-32602, "tools/call params.arguments must be an object.");
        const Tier tier = tool_specs()[index].tier;
        const bool granted = tier == Tier::read || (tier == Tier::write ? options_.allow_write
                                                                        : options_.allow_run);
        if (!granted) {
            // 'ask' 档（src/agent.ts:30 write/run 的默认）在无审批人的离屏通道 = 拒，
            // 且 reason 必须说清楚怎么升档 —— 不静默放行，也不静默丢弃。
            const std::string reason =
                std::string("PERMISSION_DENIED: the '") + tier_text(tier) +
                "' permission tier is 'ask' by default (src/agent.ts defaultAgentPermissions) and "
                "this stdio server has no interactive approver, so the call is refused. "
                "Grant it explicitly by starting taocode_mcp.exe with --allow-" +
                std::string(tier_text(tier)) + ".";
            audit(name, digest(name, args), "denied:PERMISSION_DENIED(tier=" + std::string(tier_text(tier)) + ")");
            return tool_error(reason);
        }
        try {
            const auto payload = invoke(name, args);
            if (tier != Tier::read) audit(name, digest(name, args), "allowed");
            return tool_ok(dump(payload));
        } catch (const ProtocolError&) {
            if (tier != Tier::read) audit(name, digest(name, args), "failed:-32602");
            throw;  // 形状错走 JSON-RPC error，不是工具失败
        } catch (const WorkspaceError& error) {
            if (tier != Tier::read) audit(name, digest(name, args), "failed:" + error.code);
            return tool_error(error.code + ": " + error.what());
        } catch (const std::exception& error) {
            if (tier != Tier::read) audit(name, digest(name, args), "failed:UNEXPECTED");
            return tool_error(std::string("TOOL_FAILED: ") + error.what());
        }
    }

    Json invoke(const std::string& name, const Json& args) {
        if (name == "fs.read")
            return workspace_.read(required_string(args, "path"),
                                   args.value("encoding", std::string("auto")));
        if (name == "fs.list") {
            if (args.contains("path") && !args.at("path").is_string())
                throw ProtocolError(-32602, "fs.list path must be a string.");
            return workspace_.list(args.value("path", std::string()));
        }
        if (name == "fs.write") {
            const auto path = required_string(args, "path");
            const auto content = required_string(args, "content");
            // expectedVersion 强制必填（不带就不猜）：乐观并发闸在 Workspace::write 内。
            const auto expected = required_string(args, "expectedVersion");
            return workspace_.write(path, content, expected,
                                    args.value("encoding", std::string("utf-8")),
                                    args.value("bom", false), args.value("safeWrite", true));
        }
        if (name == "git.status") return git_status(args);
        if (name == "git.diff") return git_diff(args);
        if (name == "project.list") {
            ProjectStore store(options_.profile / "projects.json");
            return store.state();
        }
        if (name == "run.start") return run_start(args);
        if (name == "run.output") return run_output(args);
        if (name == "run.stop") return run_stop(args);
        if (name == "ui.probe") return ui_probe(args);
        throw ProtocolError(-32602, "Unknown tool: " + name);
    }

    // —— 具体工具（整形与 native/main.cpp 的桥分派一致，复用现成函数）——

    Json git_status(const Json& args) {
        const auto repository = options_.root;
        if (!git::available()) return {{"available", false}};
        Json changes = Json::array();
        for (const auto& change : git::status(repository, args.value("ignored", false)))
            changes.push_back({{"path", change.path}, {"indexStatus", change.index_status},
                               {"workStatus", change.work_status}, {"staged", change.staged},
                               {"untracked", change.untracked}, {"ignored", change.ignored},
                               {"renameFrom", change.rename_from}});
        return {{"available", true},
                {"head", git::head(repository)},
                {"branches", git::branches(repository)},
                {"changes", std::move(changes)}};
    }

    Json git_diff(const Json& args) {
        const auto path = repo_relative(required_string(args, "path"));
        // git::diff 需要 '/' 分隔的仓库相对 POSIX 路径（native/git.cpp 的 pathspec 闸同理）。
        const auto posix = utf8_path(path);
        int context = 0;
        if (args.contains("context")) {
            if (!args.at("context").is_number_integer())
                throw ProtocolError(-32602, "git.diff context must be an integer.");
            context = args.at("context").get<int>();
        }
        return {{"diff", git::diff(options_.root, posix, args.value("staged", false),
                                   args.value("base", std::string()), context,
                                   args.value("whole", false))}};
    }

    Json run_start(const Json& args) {
        // 本通道只接受 argv 数组：run_host 的 shell 档走 cmd.exe
        // （native/run_host.cpp:247-252），beforeLaunch 每一项被强制拉回 shell 档
        // （native/run_host.cpp:373）—— 两者都在最保守档被拒，不解释任何命令字符串。
        if (args.contains("command"))
            fail("SHELL_FORBIDDEN",
                       "run.start refuses command strings: they would run through cmd.exe. "
                       "Pass program + args (argv array) with shell implicitly false.");
        if (args.contains("beforeLaunch"))
            fail("SHELL_FORBIDDEN",
                       "run.start refuses beforeLaunch chains: run_host.cpp:373 forces every "
                       "before-launch step onto the cmd.exe shell path. Start one run per call instead.");
        if (args.contains("shell") && args.at("shell") != false)
            fail("SHELL_FORBIDDEN",
                       "run.start requires shell:false — argv-array spawning only.");
        const auto program = required_string(args, "program");
        if (program.empty())
            fail("INVALID_REQUEST", "run.start program must be a non-empty string.");
        if (!args.contains("args") || !args.at("args").is_array())
            throw ProtocolError(-32602, "run.start args must be an array of strings.");
        Json argv = Json::array();
        for (const auto& item : args.at("args")) {
            if (!item.is_string())
                throw ProtocolError(-32602, "run.start args must contain only strings.");
            argv.push_back(item);
        }
        Json params = {{"label", args.value("label", std::string())},
                       {"program", program},
                       {"args", argv},
                       {"shell", false},
                       {"allowParallel", args.value("allowParallel", false)}};
        if (args.contains("cwd")) params["cwd"] = required_string(args, "cwd");
        if (args.contains("env")) {
            if (!args.at("env").is_array())
                throw ProtocolError(-32602, "run.start env must be an array of KEY=VALUE strings.");
            params["env"] = args.at("env");
        }
        const auto result = runs_->start(params, options_.root);
        last_instance_ = result.at("instance").get<int>();
        {
            std::lock_guard lock(outputs_mutex_);
            outputs_[last_instance_];  // 预置空缓冲：即使没有任何输出也要能查到这个实例
        }
        return result;
    }

    void pump_pending() {
        // Manager 的链推进在主宿主里由 UI 定时器做（main.cpp:311-312）；离屏循环里
        // 这一层就是那个"UI 线程"：每次工具调用前把已结束的步骤收干净。
        for (;;) {
            const auto pending = runs_->take_pending();
            if (pending.empty()) break;
            for (const auto& [instance, code] : pending) runs_->advance(instance, code, options_.root);
        }
    }

    Json run_output(const Json& args) {
        int instance;
        if (args.contains("instance")) {
            if (!args.at("instance").is_number_integer())
                throw ProtocolError(-32602, "run.output instance must be an integer.");
            instance = args.at("instance").get<int>();
        } else if (last_instance_ != 0) {
            instance = last_instance_;
        } else {
            fail("NOT_FOUND", "run.output: no instance started on this channel yet.");
        }
        pump_pending();
        const auto live = runs_->instances();
        bool running = false;
        for (const auto& entry : live)
            if (entry.is_object() && entry.value("id", -1) == instance) running = entry.value("running", false);
        std::string bytes;
        int exit_code;
        {
            std::lock_guard lock(outputs_mutex_);
            const auto found = outputs_.find(instance);
            if (found == outputs_.end())
                fail("NOT_FOUND", "run.output: instance " + std::to_string(instance) +
                                            " was not started through this channel.");
            bytes = found->second.bytes;
            exit_code = found->second.exit_code;
        }
        const bool valid = valid_utf8(bytes);
        return {{"instance", instance},
                {"running", running},
                {"exitCode", exit_code == (std::numeric_limits<int>::min)() ? Json() : Json(exit_code)},
                {"textIsUtf8", valid},
                {"text", valid ? bytes : std::string()},
                {"dataB64", base64_encode(bytes)}};
    }

    Json run_stop(const Json& args) {
        int instance = 0;
        if (args.contains("instance")) {
            if (!args.at("instance").is_number_integer())
                throw ProtocolError(-32602, "run.stop instance must be an integer.");
            instance = args.at("instance").get<int>();
        }
        const auto result = runs_->stop(instance);
        pump_pending();
        return result;
    }

    void on_run_event(Json event) {
        // run_host 的出口回调：reader 线程直连这里，只碰 outputs_（锁内），不再外发。
        if (!event.is_object() || !event.contains("event")) return;
        const auto kind = event.at("event").get<std::string>();
        if (kind != "run.output" && kind != "run.exit") return;
        if (!event.contains("instance") || !event.at("instance").is_number_integer()) return;
        const int instance = event.at("instance").get<int>();
        std::lock_guard lock(outputs_mutex_);
        auto& slot = outputs_[instance];
        if (kind == "run.output" && event.contains("dataB64") && event.at("dataB64").is_string())
            slot.bytes += base64_decode(event.at("dataB64").get<std::string>());
        if (kind == "run.exit" && event.contains("code") && event.at("code").is_number_integer())
            slot.exit_code = event.at("code").get<int>();
    }

    // —— ui.probe：离屏调试的正门（node .tools/webview-console.mjs，见该文件头注释）——

    Json ui_probe(const Json& args) {
        if (options_.debug_port.empty())
            fail("CONFIG",
                       "ui.probe needs TAOCODE_DEBUG_PORT in the taocode_mcp.exe environment "
                       "(see native/webview_options.hpp:59); refusing to guess a port.");
        if (options_.debug_port.find_first_not_of("0123456789") != std::string::npos ||
            options_.debug_port.size() > 5)
            fail("CONFIG", "TAOCODE_DEBUG_PORT must be a numeric port; got: " + options_.debug_port);
        const auto tool = options_.repo_dir / ".tools" / "webview-console.mjs";
        std::error_code ec;
        if (!std::filesystem::exists(tool, ec))
            fail("CONFIG", "ui.probe cannot find the console tool under --repo-dir: " +
                                     utf8_path(tool));
        const auto node = find_node_exe();
        if (node.empty())
            fail("CONFIG", "ui.probe runs node (.mjs console tool) but node.exe is not on PATH.");
        int wait_ms = 7000;
        if (args.contains("waitMs")) {
            if (!args.at("waitMs").is_number_integer())
                throw ProtocolError(-32602, "ui.probe waitMs must be an integer.");
            wait_ms = std::clamp(args.at("waitMs").get<int>(), 500, 60000);
        }
        const bool no_reload = args.value("noReload", false);
        const bool expect_mount = args.value("expectMount", true);
        std::vector<std::wstring> argv;
        argv.push_back(wide(utf8_path(tool)));
        argv.push_back(L"--port");
        argv.push_back(wide(options_.debug_port));
        argv.push_back(L"--wait");
        argv.push_back(std::to_wstring(wait_ms));
        if (no_reload) argv.push_back(L"--no-reload");
        if (expect_mount) argv.push_back(L"--expect-mount");
        std::filesystem::path script_file;
        if (args.contains("script")) {
            // 走 --file 而不是 --eval：命令行双层转义会把 JS 吃掉（webview-console.mjs:23 的
            // 注释同理）；这里是纯 argv，不经 shell。
            const auto script = required_string(args, "script");
            script_file = std::filesystem::temp_directory_path() /
                          (L"taocode-probe-" + wide(random_suffix()) + L".js");
            std::ofstream out(script_file, std::ios::binary | std::ios::trunc);
            if (!out)
                fail("IO_ERROR", "ui.probe cannot write the temporary --file under " +
                                           utf8_path(std::filesystem::temp_directory_path()));
            out.write(script.data(), static_cast<std::streamsize>(script.size()));
            out.close();
            argv.push_back(L"--file");
            argv.push_back(script_file.native());
        }
        // 尽力删临时 --file；任何出口（含抛错）都删，绝不把 JS 留在仓库里。
        struct FileCleanup {
            const std::filesystem::path* file;
            ~FileCleanup() {
                if (!file->empty()) {
                    std::error_code drop;
                    std::filesystem::remove(*file, drop);
                }
            }
        } file_cleanup{&script_file};
        // 状态变量声明在 Runner **之前**：Reader 线程的回调引用它们，异常展开时
        // Runner 的析构（join）必须发生在这些对象销毁之前。
        std::mutex wait_mutex;
        std::condition_variable wait_cv;
        std::string collected;
        bool finished = false;
        int exit_code = -1;
        Runner runner;
        Runner::Spec spec;
        spec.command = quote_argument(node);
        for (const auto& argument : argv) spec.arguments.push_back(quote_argument(argument));
        spec.working_directory = options_.repo_dir;
        runner.start(
            spec,
            [&collected](const Runner::Chunk& chunk) { collected.append(chunk.bytes); },
            [&](int code) {
                std::lock_guard lock(wait_mutex);
                exit_code = code;
                finished = true;
                wait_cv.notify_all();
            });
        const bool settled = [&] {
            std::unique_lock lock(wait_mutex);
            return wait_cv.wait_for(lock, std::chrono::milliseconds(wait_ms + 45000),
                                    [&] { return finished; });
        }();
        if (!settled) {
            runner.stop();
            std::unique_lock lock(wait_mutex);
            if (!wait_cv.wait_for(lock, std::chrono::seconds(5), [&] { return finished; }))
                fail("TIMEOUT",
                     "ui.probe timed out even after killing node; is the IDE running with "
                     "TAOCODE_DEBUG_PORT and reachable on 127.0.0.1:" + options_.debug_port + "?");
        }
        Json result = {{"tool", "webview-console.mjs"}, {"exitCode", exit_code}};
        const bool valid = valid_utf8(collected);
        if (valid) {
            try {
                result["report"] = Json::parse(collected);
            } catch (...) {
                result["report"] = nullptr;  // node 正常时回的就是单个 JSON；解析不了就只给 raw
            }
            result["raw"] = collected;
        } else {
            result["report"] = nullptr;
            result["rawB64"] = base64_encode(collected);
        }
        return result;
    }

    // —— 审计 ——

    std::string digest(const std::string& name, const Json& args) {
        // 参数摘要：只列定位信息，不落完整内容（fs.write 的正文可能几十 KB，也不进日志）。
        Json picked = Json::object();
        static const std::map<std::string, std::vector<std::string>> keys = {
            {"fs.write", {"path", "expectedVersion"}},
            {"run.start", {"label", "program", "cwd"}},
            {"run.output", {"instance"}},
            {"run.stop", {"instance"}},
            {"ui.probe", {"noReload", "waitMs", "expectMount"}},
        };
        const auto found = keys.find(name);
        if (found != keys.end())
            for (const auto& key : found->second)
                if (args.contains(key)) picked[key] = args.at(key);
        if (name == "fs.write" && args.contains("content") && args.at("content").is_string())
            picked["contentBytes"] = args.at("content").get<std::string>().size();
        if (name == "run.start" && args.contains("args") && args.at("args").is_array())
            picked["argc"] = args.at("args").size();
        if (name == "ui.probe" && args.contains("script") && args.at("script").is_string())
            picked["scriptBytes"] = args.at("script").get<std::string>().size();
        return trunc(dump(picked));
    }

    void audit(const std::string& tool, const std::string& args_digest, const std::string& verdict) {
        if (!options_.audit) return;
        SYSTEMTIME now{};
        GetLocalTime(&now);
        char stamp[32];
        std::snprintf(stamp, sizeof(stamp), "%04d-%02d-%02dT%02d:%02d:%02d", now.wYear, now.wMonth,
                      now.wDay, now.wHour, now.wMinute, now.wSecond);
        options_.audit(std::string("[taocode-mcp audit] ts=") + stamp + " tool=" + tool +
                       " args=\"" + args_digest + "\" verdict=" + verdict);
    }
};

Server::Server(Options options) : impl_(std::make_unique<Impl>(std::move(options))) {}
Server::~Server() = default;

std::string Server::handle_line(const std::string& line) { return impl_->handle(line); }

void run_stdio(Server& server, std::istream& in, std::ostream& out) {
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();  // CRLF 容忍
        if (line.empty()) continue;                                 // 空行不是帧
        const auto response = server.handle_line(line);
        if (!response.empty()) {
            out << response << "\n";
            out.flush();  // stdio 帧协议：一条应答一条写完，别攒在缓冲区里
        }
    }
}

}  // namespace mcp
}  // namespace taocode
