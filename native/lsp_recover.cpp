// 语言服务线程的恢复。
//
// 为什么需要：`lsp.open` / `lsp.request` / `lsp.stop` 原先都排在 `lsp_worker` **一条**线程上，
// 那条线程一旦卡在一次任务里（2026-09-30 在 13.9k 文件的真工程上实测：握手之后整条线程不再接活，
// `lsp.request status` / `foldingRange` / `lsp.open` 三个请求 30s 全无回包，而同一条 IPC 上的
// `app.memory` 15ms 就回），连"关掉重来"都做不到 —— 用户只能重启应用。
// 这里把卡住的线程收掉并换一条新的；随后由调用方关掉服务器、重配（`reset_lsp_now`）。
#include "lsp_recover.hpp"

#include "lsp_children.hpp"  // 弃养一代时按代号收掉它的服务器进程
#include "workspace.hpp"   // WorkspaceError（回包错误码与别的原生方法一致）

#include <vector>

namespace taocode {
namespace lsp {

void replace_worker(std::unique_ptr<Worker>& worker) {
    // 先收旧线程：stop() 自带"先排空、再取消同步 IO、最后 join"的有界收尾（见 lsp_worker.cpp）。
    if (worker) { worker->stop(); worker.reset(); }
    worker = std::make_unique<Worker>();
}

namespace {

// 弃养表：收不掉的线程（卡在锁上，`CancelSynchronousIo` 无能为力）以及它可能还在用的会话，
// 一律**不析构**。宁可漏一条线程 + 一代会话，也不能让孤儿线程摸到已销毁的对象（use-after-free）。
std::vector<std::unique_ptr<Worker>>& worker_graveyard() {
    static std::vector<std::unique_ptr<Worker>> list;
    return list;
}

std::vector<std::unique_ptr<Session>>& session_graveyard() {
    static std::vector<std::unique_ptr<Session>> list;
    return list;
}

}  // namespace

void recover(std::unique_ptr<Worker>& worker, std::unique_ptr<Session>& session,
             const std::function<void()>& shutdown_and_reconfigure,
             const std::function<void(const std::string&)>& warn) {
    bool abandoned = false;
    if (worker) {
        worker->stop();
        abandoned = worker->abandoned();
        if (abandoned) worker_graveyard().push_back(std::move(worker));
        else worker.reset();
    }
    if (!worker) worker = std::make_unique<Worker>();
    // 线程被弃养时，会话也跟着弃养：孤儿线程可能正拿着 `Session::mutex_`。
    // 这样上面那段"关服务器 + 重配"看到的 `lsp` 已经是空的，`configure_lsp` 会装一代新的。
    // 弃养的 Host 析构永远不会跑，它手里 KILL_ON_JOB_CLOSE 的作业对象也就没人关 —— 所以
    // **必须按代号把这一代起的服务器进程收掉**，否则每恢复一次就多留一台 ~1GB 的 JVM
    // 在后台索引同一个工程（真机实测：两代并存 = 两个 java.exe 一起建索引）。
    if (abandoned && session) {
        children::terminate_generation(session->generation());
        session_graveyard().push_back(std::move(session));
    }
    try { shutdown_and_reconfigure(); }
    catch (const std::exception& failure) { if (warn) warn(std::string("语言服务恢复时重配失败：") + failure.what()); }
}

std::size_t abandoned_count() { return worker_graveyard().size(); }

Json run_inline(const Json& id, const std::function<Json()>& body, const std::function<void(Json)>& reply) {
    Json payload{{"id", id}, {"ok", true}};
    try { payload["result"] = body(); }
    catch (const WorkspaceError& error) { payload["ok"] = false; payload["error"] = {{"code", error.code}, {"message", error.what()}}; }
    catch (const std::exception& failure) { payload["ok"] = false; payload["error"] = {{"code", "NATIVE_ERROR"}, {"message", failure.what()}}; }
    if (reply) reply(std::move(payload));
    return Json{{"ok", true}};
}

}  // namespace lsp
}  // namespace taocode
