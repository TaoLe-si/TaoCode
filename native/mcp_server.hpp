#pragma once

// TaoCode MCP 服务端（协议 + 工具层）—— batch-2026-10-06-mcpserver。
//
// 这是给 agent（Qoder）用的**离屏调试通道**：stdio 上的 JSON-RPC 2.0（MCP stdio 惯例，
// 一行一帧），**不开任何网络端口**。工具全部复用宿主已有能力：
//   fs.*        → taocode::Workspace（native/workspace.hpp，路径闸 native/fsops.hpp / workspace.cpp parse_relative）
//   git.*       → taocode::git（native/git.hpp）
//   project.*   → taocode::ProjectStore（native/projects.hpp，%LOCALAPPDATA%\TaoCode\projects.json）
//   run.*       → taocode::run_host::Manager（native/run_host.hpp；argv 数组 spawn，shell 档被本层拒绝）
//   ui.probe    → taocode::Runner 同步跑 `node .tools/webview-console.mjs`（CDP 离屏取证）
//
// 权限闸门照抄 `src/agent.ts:30` 的 defaultAgentPermissions = { read:'allow', write:'ask',
// run:'ask', network:'never' }：离屏服务端**没有交互审批人**，`ask` 档一律拒绝，除非进程带
// `--allow-write` / `--allow-run` 显式把对应档升为 `allow`；`network:'never'` ⇒ 没有任何
// 联网工具。被拒的调用必须回明确 reason（不静默放行），写/执行类调用逐条落审计行。

#include <filesystem>
#include <functional>
#include <iosfwd>
#include <memory>
#include <string>

#include "workspace.hpp"  // Json, Workspace, WorkspaceError

namespace taocode {
namespace mcp {

/// MCP stdio 服务端的可选项（mcp_main.cpp 从 argv/env 组装；测试直接构造）。
struct Options {
    std::filesystem::path root;      // 工作区根（必须绝对路径；过 fsops::absolute_path 的设备命名空间闸）
    std::filesystem::path repo_dir;  // TaoCode 仓库根（定位 .tools/webview-console.mjs）
    std::filesystem::path profile;   // 宿主 profile（projects.json 所在，默认 %LOCALAPPDATA%\TaoCode）
    std::string debug_port;          // TAOCODE_DEBUG_PORT：ui.probe 连的 CDP 端口；空 ⇒ ui.probe 明确拒绝
    bool allow_write = false;        // write 档 ask→allow（fs.write）
    bool allow_run = false;          // run 档 ask→allow（run.* 与 ui.probe）
    /// 审计出口：一条写/执行类调用一行文本（无换行）。main 落 stderr，测试注入捕获。
    std::function<void(const std::string&)> audit;
};

/// 协议面 + 工具集。单线程使用（stdio 循环所在线程）；run_host 的事件来自子进程
/// reader 线程，内部用互斥锁保护输出缓冲。
class Server {
public:
    explicit Server(Options options);
    ~Server();
    Server(const Server&) = delete;
    Server& operator=(const Server&) = delete;

    /// 一行 JSON-RPC 帧进，一行应答帧出；返回空串表示不应答（notification / 已通知的错误）。
    std::string handle_line(const std::string& line);

private:
    class Impl;

    std::unique_ptr<Impl> impl_;
};

/// stdio 帧循环：一行一帧，跳过空行，CRLF 容忍；每条应答后 flush。
/// 输入流 EOF 即正常返回（客户端关管道就是"下线"信号，不监听、不重连）。
void run_stdio(Server& server, std::istream& in, std::ostream& out);

}  // namespace mcp
}  // namespace taocode
