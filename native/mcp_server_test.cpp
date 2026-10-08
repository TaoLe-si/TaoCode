// native/mcp_server_test.cpp —— TaoCode MCP 服务端的离线自测（ctest 第 39 条：mcp_server_stdio）。
//
// 判据（每一条都可失败，来源=任务卡 5 的验收清单）：
//   1. 握手：initialize 回 protocolVersion/capabilities.tools/serverInfo；notifications/initialized 不应答；ping 回空对象。
//   2. tools/list：恰好 10 个工具名、每个带 inputSchema 与权限档标注。
//   3. 一次只读调用：fs.read 成功且 version 可供 fs.write。
//   4. 权限挡住的写：无 --allow-write 时 fs.write ⇒ PERMISSION_DENIED 且 reason 指名 --allow-write；
//      升档后错版本 ⇒ CONFLICT（不静默覆盖）、对版本 ⇒ 落盘成功；写/执行类调用逐条落审计（denied/allowed 都在）。
//   5. 路径校验被拒：`..` 逃逸、盘符绝对路径、设备命名空间前缀（\\?\、\\.\、\??\）、Windows 设备名。
//      根路径另过 fsops.hpp:133 保留闸 —— "Device and extended Windows namespaces are not accepted." 原文必须出现。
//   6. run 参数数组化不被 shell 解释：run.start 拒 shell:true/command/beforeLaunch（SHELL_FORBIDDEN）；
//      以 **taocode_mcp.exe 自身 --echo-argv** 为 program 起一次真进程，含空格/`&`/`"` 的 argv token
//      必须原样回显 —— 若这条通道走 cmd.exe，`&` 会被当命令分隔符执行、带空格 token 会被拆碎。
//   7. ui.probe：run 档未升 ⇒ 拒；升档但环境无 TAOCODE_DEBUG_PORT ⇒ CONFIG 拒（不猜端口）。
//   8. JSON-RPC 错误形状：-32700/-32600/-32601/-32602；未知 notification 无应答；run_stdio 一行一帧 + CRLF 容忍。
// argv[1]（由 CMake 传 $<TARGET_FILE:taocode_mcp>）= 被测 exe 路径，用于第 6 条的真实 spawn。
#include "mcp_server.hpp"

#include "git.hpp"      // git::available()：git.status 判据按"本机有没有 git"分叉
#include "text.hpp"     // wide()/utf8()

#include <windows.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;
using taocode::Json;
using taocode::mcp::Options;
using taocode::mcp::Server;

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
    std::cout << (ok ? "ok   " : "FAIL ") << what << "\n";
    if (!ok) ++failures;
}

std::string parseable(Json& out, const std::string& text, const char* what) {
    try {
        out = Json::parse(text);
        return {};
    } catch (const std::exception& error) {
        return std::string(what) + " is not JSON: " + error.what();
    }
}

/// 一帧进（返回空串 = 不应答）。
std::string round_trip(Server& server, const Json& frame) {
    return server.handle_line(frame.dump());
}

Json call(Server& server, int id, const std::string& method, const Json& params) {
    const auto line = round_trip(server, {{"jsonrpc", "2.0"}, {"id", id}, {"method", method},
                                          {"params", params}});
    return Json::parse(line);  // 解析失败=测试崩在这里，形状本身就是判据
}

struct ToolResult {
    bool is_error = false;
    std::string text;
    Json payload;
    bool protocol_error = false;
    int error_code = 0;
};

ToolResult tool_call(Server& server, int id, const std::string& name, const Json& arguments) {
    ToolResult result;
    const auto response = call(server, id, "tools/call",
                               {{"name", name}, {"arguments", arguments}});
    if (response.contains("error")) {
        result.protocol_error = true;
        result.error_code = response["error"].value("code", 0);
        result.text = response["error"].value("message", std::string());
        return result;
    }
    const auto& payload = response.at("result");
    result.is_error = payload.value("isError", false);
    result.text = payload.at("content").at(0).at("text").get<std::string>();
    if (!result.is_error) {
        try {
            result.payload = Json::parse(result.text);
        } catch (...) {
            check(false, "tools/call " + name + " success payload must be JSON: " + result.text);
        }
    }
    return result;
}

fs::path temp_case_root(const char* tag) {
    static int counter = 0;
    const auto path = fs::temp_directory_path() /
                      (L"taocode-mcp-test-" + taocode::wide(tag) + L"-" +
                       std::to_wstring(::GetCurrentProcessId()) + L"-" + std::to_wstring(++counter));
    fs::remove_all(path);
    fs::create_directories(path);
    return path;
}

void write_file(const fs::path& path, const std::string& bytes) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
}

std::string read_file(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

const char* kHelloContent = "Hello MCP\n";

}  // namespace

int main(int argc, char** argv) {
    std::cout << std::unitbuf;  // 每行即刷：崩溃时已跑的判据行不会烂在缓冲区里
    try {
    std::string self_exe;
    if (argc > 1) {
        self_exe = argv[1];
        std::replace(self_exe.begin(), self_exe.end(), '/', '\\');  // CreateProcessW 稳妥形态
    }
    std::vector<fs::path> case_roots;

    // ————— 服务端 A：默认档（read:allow，write/run:ask ⇒ 拒） —————
    {
        const auto workspace = temp_case_root("wsA");
        case_roots.push_back(workspace);
        write_file(workspace / "hello.txt", kHelloContent);
        fs::create_directories(workspace / "sub");
        write_file(workspace / "sub" / "note.txt", "note");

        Options options;
        options.root = workspace;
        options.repo_dir = workspace;
        options.profile = temp_case_root("profileA");
        case_roots.push_back(options.profile);
        std::vector<std::string> audit_log;
        options.audit = [&](const std::string& line) { audit_log.push_back(line); };
        Server server(std::move(options));

        // 1) 握手面
        auto initialize = call(server, 1, "initialize",
                               {{"protocolVersion", "2025-06-18"},
                                {"capabilities", Json::object()},
                                {"clientInfo", {{"name", "qoder-test"}, {"version", "1"}}}});
        check(initialize.contains("result"), "initialize returns a result");
        const auto& init = initialize.at("result");
        check(init.value("protocolVersion", std::string()) == "2025-06-18",
              "initialize echoes the supported protocolVersion");
        check(init.contains("capabilities") && init["capabilities"].contains("tools"),
              "initialize advertises capabilities.tools");
        check(init.value("serverInfo", Json::object()).value("name", std::string()) == "taocode",
              "initialize serverInfo.name = taocode");
        // 认不出的版本回我们实现的最新版（协商语义）
        auto odd = call(server, 2, "initialize", {{"protocolVersion", "1999-01-01"}});
        check(odd["result"].value("protocolVersion", std::string()) == "2025-06-18",
              "unknown protocolVersion negotiates down to the server's latest");
        check(round_trip(server, {{"jsonrpc", "2.0"}, {"method", "notifications/initialized"}}).empty(),
              "notifications/initialized gets no response (MCP)");
        check(round_trip(server, {{"jsonrpc", "2.0"}, {"method", "notifications/cancelled"}}).empty(),
              "unknown notification gets no response (JSON-RPC)");
        auto ping = call(server, 3, "ping", Json::object());
        check(ping.contains("result") && ping["result"].is_object(), "ping answers an empty result object");
        check(ping.value("id", Json()) == Json(3), "ping response carries the request id back");

        // 2) tools/list：8 槽 + ui.probe 的 10 个工具名
        auto listed = call(server, 4, "tools/list", Json::object());
        const auto& tools = listed["result"]["tools"];
        static const std::vector<std::string> expected_names = {
            "fs.read", "fs.list", "fs.write", "git.status", "git.diff",
            "project.list", "run.start", "run.output", "run.stop", "ui.probe"};
        check(tools.size() == expected_names.size(), "tools/list carries exactly the 8-slot set + ui.probe");
        for (std::size_t i = 0; i != expected_names.size(); ++i) {
            const bool found = tools.size() > i &&
                               tools[i].value("name", std::string()) == expected_names[i];
            if (!found) check(false, "tools/list name at index " + std::to_string(i));
        }
        bool shaped = tools.size() == expected_names.size();
        for (const auto& tool : tools)
            shaped = shaped && tool.contains("inputSchema") && tool.contains("description") &&
                     tool["description"].get<std::string>().find("permission tier:") != std::string::npos;
        check(shaped, "every tool has name/description(tier-marked)/inputSchema");

        // 3) 一次只读调用（read:'allow' 默认放行）
        auto read = tool_call(server, 5, "fs.read", {{"path", "hello.txt"}});
        check(!read.is_error && read.payload.value("content", std::string()) == kHelloContent,
              "fs.read returns the file content on the default allow tier");
        const auto version = read.payload.value("version", std::string());
        check(!version.empty(), "fs.read carries the version fingerprint");
        auto listed_dir = tool_call(server, 6, "fs.list", {{"path", ""}});
        bool has_hello = false;
        if (!listed_dir.is_error && listed_dir.payload.is_array())
            for (const auto& entry : listed_dir.payload)
                if (entry.is_object() && entry.value("name", std::string()) == "hello.txt") has_hello = true;
        check(!listed_dir.is_error && has_hello, "fs.list returns the root entry array containing hello.txt");

        // 4) 被权限挡住的写（默认 ask ⇒ 拒 + 指名升档旗标；不许静默放行）
        auto denied = tool_call(server, 7, "fs.write",
                                {{"path", "hello.txt"}, {"content", "evil"}, {"expectedVersion", version}});
        check(denied.is_error && denied.text.find("PERMISSION_DENIED") != std::string::npos &&
                  denied.text.find("--allow-write") != std::string::npos,
              "fs.write without --allow-write is refused with an explicit reason");
        check(read_file(workspace / "hello.txt") == kHelloContent,
              "the refused write truly did not touch the file");
        auto denied_run = tool_call(server, 8, "run.start",
                                    {{"program", "cmd.exe"}, {"args", Json::array()}, {"shell", false}});
        check(denied_run.is_error && denied_run.text.find("--allow-run") != std::string::npos,
              "run.start without --allow-run is refused with an explicit reason");
        auto denied_probe = tool_call(server, 9, "ui.probe", Json::object());
        check(denied_probe.is_error && denied_probe.text.find("PERMISSION_DENIED") != std::string::npos,
              "ui.probe is on the run tier and refused by default");
        bool audited_denies = false;
        for (const auto& line : audit_log)
            if (line.find("tool=fs.write") != std::string::npos &&
                line.find("verdict=denied:PERMISSION_DENIED") != std::string::npos) audited_denies = true;
        check(audited_denies && audit_log.size() >= 3, "every denied write/run call left an audit line");

        // 5) 路径校验：全部以 INVALID_PATH 拒绝（isError 通道），且不触碰磁盘
        struct PathCase { const char* path; const char* what; };
        const PathCase cases[] = {
            {"../escape.txt", "dot-dot escape"},
            {"sub/../../escape.txt", "embedded dot-dot traversal"},
            {"C:/Windows/win.ini", "drive-letter absolute path"},
            {"C:\\Windows\\win.ini", "drive-letter absolute path (backslash form)"},
            {"D:x", "drive-relative path"},
            {"\\\\?\\C:\\Windows\\x", "extended namespace prefix \\\\?\\"},
            {"\\\\.\\PhysicalDrive0", "device namespace prefix \\\\.\\"},
            {"\\??\\nul", "DOS device prefix \\??\\"},
            {"NUL.txt", "Windows reserved device name"},
            {"sub/../hello.txt", "middle dot-dot even when it lands inside"},
            {":stream.txt", "NTFS stream-ish name"},
        };
        int id = 20;
        for (const auto& entry : cases) {
            auto rejected = tool_call(server, id++, "fs.read", {{"path", entry.path}});
            check(rejected.is_error && rejected.text.find("INVALID_PATH") != std::string::npos,
                  std::string("fs.read rejects ") + entry.what + " (" + entry.path + ")");
            auto rejected_write = tool_call(server, id++, "fs.list", {{"path", entry.path}});
            check(rejected_write.is_error && rejected_write.text.find("INVALID_PATH") != std::string::npos,
                  std::string("fs.list rejects ") + entry.what);
        }
        auto git_diff_escape = tool_call(server, id++, "git.diff", {{"path", "../x.txt"}});
        check(git_diff_escape.is_error && git_diff_escape.text.find("INVALID_PATH") != std::string::npos,
              "git.diff rejects an escaping path before touching git");

        // 8) JSON-RPC 错误形状（**原始行**直喂 handle_line：走 round_trip 会被 Json 隐式转成合法字符串帧）
        auto parse_error = Json::parse(server.handle_line("not-json{"));
        check(parse_error["error"].value("code", 0) == -32700, "a broken frame answers -32700");
        auto no_method = Json::parse(round_trip(server, {{"jsonrpc", "2.0"}, {"id", 7}}));
        check(no_method["error"].value("code", 0) == -32600, "a frame without method answers -32600");
        auto unknown = call(server, 8, "does/not/exist", Json::object());
        check(unknown["error"].value("code", 0) == -32601, "an unknown method answers -32601");
        auto no_name = call(server, 9, "tools/call", {{"arguments", Json::object()}});
        check(no_name["error"].value("code", 0) == -32602, "tools/call without name answers -32602");
        auto bad_tool = tool_call(server, 10, "fs.delete-everything", Json::object());
        check(bad_tool.protocol_error && bad_tool.error_code == -32602, "an unknown tool answers -32602");
        auto bad_arguments = call(server, 11, "tools/call",
                                  {{"name", "fs.read"}, {"arguments", "not-an-object"}});
        check(bad_arguments["error"].value("code", 0) == -32602,
              "tools/call arguments must be an object (-32602)");

        // git.status：临时目录不是仓库 ⇒ 要么明确报 git 不可用（available:false），要么以 reason 失败；不许假成功
        auto status = tool_call(server, 12, "git.status", Json::object());
        const bool honest = taocode::git::available()
                                ? (status.is_error && !status.text.empty())
                                : (!status.is_error && status.payload.value("available", true) == false);
        check(honest, std::string("git.status on a non-repo reports honestly (git available=") +
                          (taocode::git::available() ? "yes" : "no") + ", isError=" +
                          (status.is_error ? "yes" : "no") + ")");
    }

    // ————— 服务端 B：--allow-write 升档后的写路径（乐观并发 + 审计 allowed） —————
    {
        const auto workspace = temp_case_root("wsB");
        case_roots.push_back(workspace);
        write_file(workspace / "hello.txt", kHelloContent);
        std::vector<std::string> audit_log;
        Options options;
        options.root = workspace;
        options.repo_dir = workspace;
        options.profile = temp_case_root("profileB");
        case_roots.push_back(options.profile);
        options.allow_write = true;
        options.audit = [&](const std::string& line) { audit_log.push_back(line); };
        Server server(std::move(options));

        auto read = tool_call(server, 1, "fs.read", {{"path", "hello.txt"}});
        const auto version = read.payload.value("version", std::string());
        auto stale = tool_call(server, 2, "fs.write",
                               {{"path", "hello.txt"}, {"content", "stale attempt\n"}, {"expectedVersion", "wrong"}});
        check(stale.is_error && stale.text.find("CONFLICT") != std::string::npos,
              "fs.write with a wrong expectedVersion fails with CONFLICT (never silently overwrites)");
        check(read_file(workspace / "hello.txt") == kHelloContent, "the CONFLICTed write left the file untouched");
        auto good = tool_call(server, 3, "fs.write",
                              {{"path", "hello.txt"}, {"content", "written by mcp\n"}, {"expectedVersion", version}});
        check(!good.is_error && read_file(workspace / "hello.txt") == "written by mcp\n",
              "fs.write with the read version lands on disk under --allow-write");
        bool audited_allow = false;
        for (const auto& line : audit_log)
            if (line.find("tool=fs.write") != std::string::npos &&
                line.find("verdict=allowed") != std::string::npos) audited_allow = true;
        check(audited_allow, "the granted write left an audit line with verdict=allowed");
        bool audited_fail = false;
        for (const auto& line : audit_log)
            if (line.find("verdict=failed:CONFLICT") != std::string::npos) audited_fail = true;
        check(audited_fail, "the CONFLICTed write is audited as failed:CONFLICT, not silently swallowed");
        auto missing_version = tool_call(server, 4, "fs.write", {{"path", "hello.txt"}, {"content", "x"}});
        check(missing_version.protocol_error && missing_version.error_code == -32602,
              "fs.write demands expectedVersion explicitly (-32602 when absent)");
        // project.list：profile 目录下是全新的 projects.json ⇒ 默认公开状态（读档放行）
        auto projects = tool_call(server, 5, "project.list", Json::object());
        check(!projects.is_error && projects.payload.is_object(),
              "project.list answers the ProjectStore state as JSON");
    }

    // ————— 服务端 C：--allow-run 升档；argv 数组化 + SHELL_FORBIDDEN + ui.probe CONFIG 闸 —————
    {
        const auto workspace = temp_case_root("wsC");
        case_roots.push_back(workspace);
        Options options;
        options.root = workspace;
        options.repo_dir = workspace;
        options.profile = temp_case_root("profileC");
        case_roots.push_back(options.profile);
        options.allow_run = true;  // debug_port 故意留空：ui.probe 必须 CONFIG 拒，而不是猜端口
        std::vector<std::string> audit_log;
        options.audit = [&](const std::string& line) { audit_log.push_back(line); };
        Server server(std::move(options));

        auto shell = tool_call(server, 1, "run.start",
                               {{"program", "node.exe"}, {"args", Json::array()}, {"shell", true}});
        check(shell.is_error && shell.text.find("SHELL_FORBIDDEN") != std::string::npos,
              "run.start refuses shell:true even under --allow-run (no shell interpretation on this channel)");
        auto command = tool_call(server, 2, "run.start", {{"command", "dir /s"}, {"args", Json::array()}});
        check(command.is_error && command.text.find("SHELL_FORBIDDEN") != std::string::npos,
              "run.start refuses command strings");
        auto chain = tool_call(server, 3, "run.start",
                               {{"program", "node.exe"}, {"args", Json::array()},
                                {"beforeLaunch", Json::array({Json::object()})}});
        check(chain.is_error && chain.text.find("SHELL_FORBIDDEN") != std::string::npos,
              "run.start refuses beforeLaunch (run_host.cpp:373 forces it onto cmd.exe)");
        auto no_args_field = tool_call(server, 4, "run.start", {{"program", "node.exe"}});
        check(no_args_field.protocol_error && no_args_field.error_code == -32602,
              "run.start demands an args array (-32602 when absent)");

        auto probe = tool_call(server, 5, "ui.probe", Json::object());
        check(probe.is_error && probe.text.find("TAOCODE_DEBUG_PORT") != std::string::npos,
              "ui.probe without TAOCODE_DEBUG_PORT in env is refused with a CONFIG reason (no guessed port)");

        // argv 数组化的**正向**证据：起自身的 --echo-argv，token 原样回来。
        // 若通道走 cmd.exe：`&` 会被当命令分隔执行、`keep two words` 会被拆成多个 argv、
        // 引号会被剥/转义出花样。回显逐行相等才可能通过。
        if (self_exe.empty()) {
            std::cout << "NOTE no taocode_mcp.exe path was passed (ctest passes $<TARGET_FILE:taocode_mcp>); "
                         "skipping the live spawn section\n";
        } else {
            const Json echo_tokens = Json::array({"--echo-argv", "keep two words", "amp&less&gt", "quote\"inside"});
            auto start = tool_call(server, 6, "run.start",
                                   {{"label", "echo-argv"}, {"program", self_exe}, {"args", echo_tokens}});
            check(!start.is_error && start.payload.value("instance", 0) > 0,
                  "run.start with program+argv returns a positive instance id");
            const int instance = start.payload.value("instance", 0);
            std::string text;
            bool exited = false;
            for (int attempt = 0; attempt < 75 && !exited; ++attempt) {
                auto output = tool_call(server, 100 + attempt, "run.output", {{"instance", instance}});
                if (!output.is_error && output.payload.contains("text")) {
                    text = output.payload.value("text", std::string());
                    exited = !output.payload.value("running", true) &&
                             output.payload.contains("exitCode") && !output.payload.at("exitCode").is_null();
                }
                if (!exited) std::this_thread::sleep_for(std::chrono::milliseconds(200));
            }
            check(exited, "the echo-argv run reached an exit state");
            check(text.find("keep two words") != std::string::npos, "argv token with spaces survives verbatim");
            check(text.find("amp&less&gt") != std::string::npos,
                  "argv token containing & survives verbatim (cmd.exe would have executed it as a separator)");
            check(text.find("quote\"inside") != std::string::npos, "argv token containing a quote survives verbatim");
            check(!text.empty() && text.find("--echo-argv") != std::string::npos,
                  "the echo mode itself was received as the first argument");
            auto stopped = tool_call(server, 200, "run.stop", {{"instance", instance}});
            check(!stopped.is_error && stopped.payload.value("stopped", 0) == 1,
                  "run.stop stops exactly the requested instance");
            bool audited_run = false;
            for (const auto& line : audit_log)
                if (line.find("tool=run.start") != std::string::npos &&
                    line.find("verdict=allowed") != std::string::npos) audited_run = true;
            check(audited_run, "the granted run.start left an audit line");
        }
    }

    // ————— 根路径的 fsops 保留闸（fsops.hpp:126-158，:133 那句原文不许变） —————
    {
        struct RootCase { const wchar_t* root; const char* needle; const char* what; };
        const RootCase cases[] = {
            {L"\\\\?\\D:\\somewhere", "Device and extended Windows namespaces are not accepted.",
             "extended namespace \\\\?\\ root"},
            {L"\\\\.\\PhysicalDrive0", "Device and extended Windows namespaces are not accepted.",
             "device namespace \\\\.\\ root"},
            {L"\\??\\nul", "Device and extended Windows namespaces are not accepted.",
             "DOS device prefix \\??\\ root"},
            {L"D:x", "complete drive/UNC path", "drive-relative root"},
        };
        for (const auto& entry : cases) {
            Options options;
            options.root = fs::path(entry.root);
            options.profile = fs::temp_directory_path();
            std::string caught_code;
            std::string caught_message;
            try {
                Server server(std::move(options));
                check(false, std::string("construction must fail for ") + entry.what);
            } catch (const taocode::WorkspaceError& error) {
                caught_code = error.code;
                caught_message = error.what();
            } catch (const std::exception& error) {
                caught_message = error.what();
            }
            check(caught_code == "INVALID_PATH" &&
                      caught_message.find(entry.needle) != std::string::npos,
                  std::string("absolute_path gate rejects ") + entry.what +
                      " (seen: " + caught_code + " / " + caught_message.substr(0, 80) + ")");
        }
    }

    // ————— run_stdio：真"管道喂帧" —— 一行一帧、空行跳过、CRLF 容忍、EOF 收束 —————
    {
        const auto workspace = temp_case_root("wsD");
        case_roots.push_back(workspace);
        write_file(workspace / "hello.txt", kHelloContent);
        Options options;
        options.root = workspace;
        options.repo_dir = workspace;
        options.profile = temp_case_root("profileD");
        case_roots.push_back(options.profile);
        Server server(std::move(options));
        std::ostringstream input;
        input << R"({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"pipe","version":"1"}}})" << "\r\n";
        input << "\n";  // 空行不是帧
        input << R"({"jsonrpc":"2.0","method":"notifications/initialized"})" << "\n";
        input << R"({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fs.read","arguments":{"path":"hello.txt"}}})" << "\n";
        input << R"({"jsonrpc":"2.0","id":"string-id","method":"ping"})" << "\n";
        std::istringstream feed(input.str());
        std::ostringstream answered;
        taocode::mcp::run_stdio(server, feed, answered);
        std::istringstream stream(answered.str());
        std::vector<std::string> lines;
        std::string line;
        while (std::getline(stream, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (!line.empty()) lines.push_back(line);
        }
        check(lines.size() == 3, "run_stdio answers exactly the three requests (notification silent, blank skipped)");
        bool frames_valid = lines.size() == 3;
        for (const auto& frame : lines) {
            Json parsed;
            frames_valid = frames_valid && parseable(parsed, frame, "frame").empty() && parsed.is_object() &&
                           parsed.contains("jsonrpc") && parsed["jsonrpc"] == "2.0";
        }
        check(frames_valid, "every output line is a standalone JSON-RPC 2.0 object");
        if (lines.size() == 3) {
            Json last;
            parseable(last, lines[2], "last");
            check(last.value("id", Json()) == Json("string-id"), "string ids round-trip through the pipe");
            Json read_response;
            parseable(read_response, lines[1], "read");
            check(read_response.contains("result") &&
                      read_response["result"]["content"][0]["text"].get<std::string>().find("Hello MCP") !=
                          std::string::npos,
                  "the piped fs.read frame answered with the file content");
        }
    }

    for (const auto& path : case_roots) {
        std::error_code ignored;
        fs::remove_all(path, ignored);
    }
    std::cout << (failures ? "MCP SERVER TEST FAILED: " : "MCP SERVER TEST PASSED: ") << failures
              << " failing judgement(s)\n";
    return failures ? 1 : 0;
    } catch (const std::exception& fatal) {
        // 判据本身应当吃掉可预期错误；跑到这里 = 测试框架层崩溃，ctest 必须红而不是静默。
        std::cout << "UNCAUGHT EXCEPTION (test cannot judge): " << fatal.what() << "\n";
        return 2;
    }
}
