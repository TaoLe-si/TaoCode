// taocode_mcp.exe —— MCP 服务端的 stdio 入口（batch-2026-10-06-mcpserver）。
//
// 启动形态：`taocode_mcp.exe --root <工作区绝对路径> [--repo-dir <TaoCode 仓库根>]
//            [--profile <宿主 profile>] [--allow-write] [--allow-run]`
// 进程只读 stdin、只写 stdout（JSON-RPC 一行一帧）+ stderr（启动横幅与审计行）。
// **不监听任何网络端口**；stdin EOF 即退出。默认权限档 = src/agent.ts:30 的最保守档
// （read:allow，write/run:ask ⇒ 拒，network:never ⇒ 无联网工具），升档只认显式旗标。
#include "mcp_server.hpp"

#include "text.hpp"        // utf8()：宽字符 argv → UTF-8
#include "workspace.hpp"   // WorkspaceError

#include <windows.h>
#include <shlobj.h>  // SHGetKnownFolderPath / FOLDERID_LocalAppData / CoTaskMemFree

#include <cstdio>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

#include <fcntl.h>
#include <io.h>

namespace fs = std::filesystem;

namespace {

void print_usage() {
    std::fwprintf(stderr,
                  L"taocode_mcp.exe — TaoCode MCP server (stdio JSON-RPC 2.0; no network ports)\n"
                  L"  --root <path>       workspace root (required; absolute drive/UNC, no device namespace)\n"
                  L"  --repo-dir <path>   TaoCode repo holding .tools/webview-console.mjs (default: exe's parent)\n"
                  L"  --profile <path>    host profile with projects.json (default: %%LOCALAPPDATA%%\\TaoCode)\n"
                  L"  --allow-write       raise the 'write' tier from 'ask' (refused) to 'allow' (fs.write)\n"
                  L"  --allow-run         raise the 'run' tier from 'ask' (refused) to 'allow' (run.*, ui.probe)\n"
                  L"  env TAOCODE_DEBUG_PORT=<port>  required by ui.probe (the live IDE's WebView2 CDP port)\n"
                  L"  --echo-argv         print each argv token on its own line and exit (argv-array proof for tests)\n");
}

/// %LOCALAPPDATA%\TaoCode —— 与宿主 main.cpp:1802-1806 同一个 profile 目录、同一个
/// projects.json（ProjectStore 由服务端按次重读，见 native/projects.hpp 的锁语义注释）。
fs::path default_profile() {
    wchar_t* local = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local)) || !local)
        return {};
    fs::path path(local);
    CoTaskMemFree(local);
    return path / L"TaoCode";
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    // --echo-argv：把 argv 逐 token 原样回显（一行一个）。run.start 拿**自身**当 program
    // 用它证明本通道是 argv 数组 spawn：token 不经 cmd.exe，`&`/`>`/空格 原样返回。
    // 带任何其它旗标不影响回显内容 —— 每个 argv[i]（含 i=0）都打出来。
    for (int i = 1; i < argc; ++i) {
        if (std::wstring(argv[i]) != L"--echo-argv") continue;
        for (int j = 0; j < argc; ++j) {
            std::string token = taocode::utf8(argv[j]);
            std::fwrite(token.data(), 1, token.size(), stdout);
            std::fputc('\n', stdout);
        }
        std::fflush(stdout);
        return 0;
    }

    std::wstring root;
    std::wstring repo_dir;
    std::wstring profile;
    taocode::mcp::Options options;
    for (int i = 1; i < argc; ++i) {
        const std::wstring argument(argv[i]);
        const auto value = [&](const wchar_t* usage) {
            if (i + 1 >= argc) {
                std::fwprintf(stderr, L"%s\n", usage);
                exit(2);
            }
            return std::wstring(argv[++i]);
        };
        if (argument == L"--root") root = value(L"--root needs a path");
        else if (argument == L"--repo-dir") repo_dir = value(L"--repo-dir needs a path");
        else if (argument == L"--profile") profile = value(L"--profile needs a path");
        else if (argument == L"--allow-write") options.allow_write = true;
        else if (argument == L"--allow-run") options.allow_run = true;
        else if (argument == L"--help" || argument == L"-h") { print_usage(); return 0; }
        else if (argument == L"--version") { std::puts("taocode_mcp 0.1.0"); return 0; }
        else {
            std::fwprintf(stderr, L"taocode_mcp: unknown argument \"%s\"\n", argument.c_str());
            print_usage();
            return 2;
        }
    }
    if (root.empty()) {
        std::fwprintf(stderr, L"taocode_mcp: --root is required (the workspace to expose)\n");
        print_usage();
        return 2;
    }
    options.root = fs::path(root);
    if (!repo_dir.empty()) {
        options.repo_dir = fs::path(repo_dir);
    } else {
        // 默认取 exe 旁的仓库：构建产物在 <repo>/build 时父目录就是仓库根。
        wchar_t self[MAX_PATH]{};
        if (GetModuleFileNameW(nullptr, self, MAX_PATH)) {
            fs::path exe(self);
            options.repo_dir = exe.parent_path().parent_path();
        }
    }
    options.profile = profile.empty() ? default_profile() : fs::path(profile);
    wchar_t port[16]{};
    if (GetEnvironmentVariableW(L"TAOCODE_DEBUG_PORT", port, 16) && *port)
        options.debug_port = taocode::utf8(std::wstring_view(port, wcsnlen(port, 15)));

    // stderr 审计（任务卡 4）：写/执行类工具调用每次一行；stdout 保持纯 JSON-RPC 帧。
    options.audit = [](const std::string& line) {
        std::fwrite(line.data(), 1, line.size(), stderr);
        std::fputc('\n', stderr);
        std::fflush(stderr);
    };

    std::string banner = "taocode_mcp: stdio JSON-RPC only; no network listeners.";
    banner += options.allow_write ? " write=allow(--allow-write)" : " write=ask->denied";
    banner += options.allow_run ? " run=allow(--allow-run)" : " run=ask->denied";
    banner += options.debug_port.empty() ? " network=never(no UI probe port in env)"
                                         : " ui.probe->127.0.0.1:" + options.debug_port;
    banner += "\n";
    std::fwrite(banner.data(), 1, banner.size(), stderr);

    // 管道里没有 CRLF 翻译，也不让 \n 变 \r\n 破坏对端帧读取（Windows 文本模式默认会转）。
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);

    try {
        taocode::mcp::Server server(std::move(options));
        taocode::mcp::run_stdio(server, std::cin, std::cout);
    } catch (const taocode::WorkspaceError& error) {
        // 起动态（根路径被 absolute_path 闸拒 / 工作区打不开）：错误只走 stderr + 退出码，
        // 不在 stdout 造半成品帧 —— 客户端必须能区分"服务没起来"和"协议应答"。
        std::string message = "taocode_mcp: startup failed: " + error.code + ": " + error.what() + "\n";
        std::fwrite(message.data(), 1, message.size(), stderr);
        return 1;
    } catch (const std::exception& error) {
        std::string message = std::string("taocode_mcp: startup failed: ") + error.what() + "\n";
        std::fwrite(message.data(), 1, message.size(), stderr);
        return 1;
    }
    return 0;
}
