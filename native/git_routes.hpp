// `git.*` 的宿主侧：那条把 git 挪出 UI 线程的**工作线程**，以及每条命令的**入参解析 / 回参整形**。
//
// 实现在 native/git_routes.cpp。命令本体一律在 native/git.cpp（子进程、超时、看门狗、porcelain
// 解析都归它），克隆在 native/git_clone.cpp —— 本文件不碰 git 的机制。
#pragma once

#include <windows.h>

#include <atomic>
#include <cstddef>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>

#include "event_channel.hpp"
#include "workspace.hpp"  // Json

namespace taocode {
namespace git_routes {

// `git.*` 的宿主侧。每个方法名一个函数（名字与 main.cpp 的 `case "git.x"_h:` 一一对应），
// 外加那条工作线程。
//
// 为什么要有那条线程：每条 git.* 都是一个子进程，一次 push 可能卡在凭据提示上几分钟；
// 放在 WebView2 的消息线程上会把整个窗口冻住且没有出路。工作线程不能碰 WebView2 控件，
// 所以它的回复由 `drain_git`（UI 线程）经 `EventChannel` 换出来再发。
class Worker {
public:
    // `run` 在工作线程上跑一条请求（`App::run_request(request, true)`）；
    // `window` 晚绑定 —— 窗口在 App 构造之后才建，只有入队/发消息时才取；
    // `message` 是这条通道的 marshal 消息（`WM_APP + N`，由宿主的消息表给出）；
    // `post` 在 UI 线程上把回复与进度事件发回 WebView2（WebView 已经不在时它自己丢弃）。
    Worker(std::function<void(const Json&)> run, std::function<HWND()> window,
           std::function<void(Json)> post, unsigned message);
    ~Worker();
    Worker(const Worker&) = delete;
    Worker& operator=(const Worker&) = delete;

    void queue_git_request(const Json& request);
    void queue_git_reply(Json payload);
    void drain_git();
    void stop_git();

private:
    void publish_git_progress();
    void git_worker();

    std::function<void(const Json&)> run_;
    std::function<HWND()> window_;
    std::function<void(Json)> post_;
    unsigned message_ = 0;
    std::mutex mutex_;
    std::deque<Json> requests_;
    std::atomic<bool> busy_{false};
    std::thread thread_;
    EventChannel replies_;
};

// 一个方法名一个函数。这里**不**再开一张按方法名分派的表：方法名清单是
// tests/routing-parity.test.mjs 的机检锚点（数的是 main.cpp 里的 `case "git.x"_h:`），
// 再抄一份清单就一定会漂移。
//
// `root` 由调用点的 `App::require_repo_root()` 给出（还没打开项目时它先抛 NOT_OPEN，
// 那个检查留在分派那一层）；`cancel` 没有 root —— 它必须在"没打开项目"时也生效。
Json status(const std::string& root, const Json& params);
Json diff(const std::string& root, const Json& params);
Json patch(const std::string& root, const Json& params);
Json diff_sides(const std::string& root, const std::string& method, const Json& params);   // git.diffSides / git.compare
Json stage(const std::string& root, const std::string& method, const Json& params);        // git.stage / git.unstage
Json commit(const std::string& root, const Json& params);
Json checkout(const std::string& root, const Json& params);
Json log(const std::string& root, const Json& params);
Json log_request(const std::string& root, const std::string& method, const Json& params);  // git.logFull 那四条
Json pull(const std::string& root);
Json fetch(const std::string& root);
Json push(const std::string& root);
Json rebase(const std::string& root, const Json& params);
Json cherry_pick(const std::string& root, const Json& params);
Json stash(const std::string& root);
Json stash_save(const std::string& root, const Json& params);
Json stash_pop(const std::string& root, const Json& params);
Json create_branch(const std::string& root, const Json& params);
Json delete_branch(const std::string& root, const Json& params);
Json revert(const std::string& root, const Json& params);
Json revert_commit(const std::string& root, const Json& params);
Json reset(const std::string& root, const Json& params);
Json merge(const std::string& root, const Json& params);
Json tags(const std::string& root);
Json tag_create(const std::string& root, const Json& params);
Json tag_delete(const std::string& root, const Json& params);
Json ignore(const std::string& root, const Json& params);
Json user(const std::string& root);
Json authors(const std::string& root);
Json diff_hunks(const std::string& root, const Json& params);
Json apply_hunks(const std::string& root, const Json& params);
Json ahead_behind(const std::string& root);
Json blame(const std::string& root, const Json& params);
Json file_history(const std::string& root, const Json& params);
Json show_commit(const std::string& root, const Json& params);
Json worktree_list(const std::string& root);
Json worktree_add(const std::string& root, const Json& params);
Json worktree_remove(const std::string& root, const Json& params);
Json submodules(const std::string& root);
Json submodule_update(const std::string& root, const Json& params);
Json cancel();

}  // namespace git_routes
}  // namespace taocode
