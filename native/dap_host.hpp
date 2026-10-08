// `dap.*` 的**宿主侧**：调试适配器客户端的生命周期、适配器注册表（exe 旁的 TaoCode.dap.json）、
// 两条反向请求（`runInTerminal` / `startDebugging`）的落点，以及事件通道（适配器线程 → UI 线程）。
//
// 实现在 native/dap_host.cpp —— 2026-10-08 从 native/main.cpp 搬出（那边贴着
// tests/module-size.test.mjs 的 2000 行硬上限，而这一族是 `git.*` 之后第二大的一段）。
//
// 分工只看三件事：
//   · 方法名分派在 native/dap_routes.cpp（它只认 `dap::RouteHost` 这张接口）；
//   · 协议编解码与子进程在 native/dap.cpp；
//   · 本文件只做"宿主这一侧"：什么时候建/收会话、适配器的反向请求落到哪个真实终端、
//     注册表从哪个文件读、事件怎么挤回 UI 线程。
//
// 搬走的是**实现体**：`dap.*` 的 case 标签一个都没动（tests/routing-parity.test.mjs 数方法名的
// 机检锚点），只是 `App` 从"自己实现 RouteHost"换成"由本类实现"。
#pragma once

#include <windows.h>

#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include "dap.hpp"
#include "dap_routes.hpp"
#include "event_channel.hpp"
#include "workspace.hpp"  // taocode::Json

namespace taocode {

class Runner;

namespace terminal {
class Manager;
}

namespace dap_host {

// 宿主（main.cpp 的 App）必须提供的全部宿主面。每一项都对应 App 已有的一行（一个成员或一个
// 方法），本类不因此多出一份状态：终端仍是 App 的 `terminals`，尺寸仍由 App 记着。
struct Ports {
    std::function<void(Json)> post;                      // App::post_json（WebView 不在时自己丢弃）
    std::function<HWND()> window;                        // 这条通道的 marshal 目标；窗口在 App 构造之后才建 ⇒ 晚绑定
    std::function<std::filesystem::path()> ui;           // App::ui —— TaoCode.dap.json 在它的父目录（exe 旁）
    std::function<std::string()> root;                   // App::current_root
    std::function<Json()> general_settings;              // App::general_settings（未信任门控要读的 general 段）
    std::function<terminal::Manager&()> terminals;       // App::terminals（真实终端会话的落点）
    std::function<std::pair<int, int>()> terminal_size;  // App 记着的那对 cols/rows（适配器开的终端用用户当前尺寸）
    std::function<void(Json)> terminal_event;            // App::queue_term（term.output / term.opened）
};

// 宿主侧的调试通道。`event_message` 是这条通道的 marshal 消息（`WM_APP + N`，由宿主的消息表给出，
// 与 native/git_routes.cpp 的 Worker 同一约定）。
class Host final : public dap::RouteHost {
public:
    Host(Ports ports, unsigned event_message);
    ~Host();
    Host(const Host&) = delete;
    Host& operator=(const Host&) = delete;

    // 适配器事件入队（可在适配器线程上调用），由 `drain` 在 UI 线程上发出。
    void queue_event(Json payload);
    void drain();
    // 收摊（＝ main.cpp 原来的 `stop_dap`）：先礼后兵地断开适配器，再回收它要的控制台窗口。
    void stop() noexcept;
    // `workspace.close` 那一步：断点属于项目，换项目前必须丢掉（否则下一次调试会停在已经关掉的文件里）。
    void clear_breakpoints();

    // ---- dap::RouteHost ----
    dap::Client& route_client() override;
    Json route_registry() override;
    std::string route_root() const override;
    void route_reply(Json id, Json result, Json error) override;
    void route_stop() noexcept override;
    Json route_breakpoints() override;
    dap::Client::EventCb route_event_sink() override;

private:
    // 惰性创建/取回会话客户端（工作区根已设好，反向请求钩子已装）；未打开项目时抛 NOT_OPEN。
    dap::Client& require_client();
    void load_registry();
    Json run_in_terminal(const Json& args, std::string& error);
    void reap_external_runners();
    Json start_nested_debug(const Json& args, std::string& error);

    Ports ports_;
    unsigned event_message_ = 0;
    std::unique_ptr<dap::Client> client_;
    Json registry_;  // optional TaoCode.dap.json: kind -> {command,args,program,cwd}
    EventChannel events_;
    // 适配器让宿主开的控制台窗口（`runInTerminal` kind "external"）比那条请求活得久：
    // 子进程退出前，Runner 一直留在这里（见 reap_external_runners）。
    std::mutex external_mutex_;
    std::vector<std::unique_ptr<Runner>> external_runners_;
};

}  // namespace dap_host
}  // namespace taocode
