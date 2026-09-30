// 语言服务线程的恢复。
//
// 为什么需要：`lsp.open` / `lsp.request` / `lsp.stop` 原先都排在 `lsp_worker` **一条**线程上，
// 那条线程一旦卡在一次任务里（2026-09-30 在 13.9k 文件的真工程上实测：握手之后整条线程不再接活，
// `lsp.request status` / `foldingRange` / `lsp.open` 三个请求 30s 全无回包，而同一条 IPC 上的
// `app.memory` 15ms 就回），连"关掉重来"都做不到 —— 用户只能重启应用。
// 这里把卡住的线程收掉并换一条新的；随后由调用方关掉服务器、重配（`reset_lsp_now`）。
#include "lsp_recover.hpp"

#include "workspace.hpp"   // WorkspaceError（回包错误码与别的原生方法一致）

namespace taocode {
namespace lsp {

void replace_worker(std::unique_ptr<Worker>& worker) {
    // 先收旧线程：stop() 自带"先排空、再取消同步 IO、最后 join"的有界收尾（见 lsp_worker.cpp）。
    if (worker) { worker->stop(); worker.reset(); }
    worker = std::make_unique<Worker>();
}

void recover(std::unique_ptr<Worker>& worker, const std::function<void()>& shutdown_and_reconfigure,
             const std::function<void(const std::string&)>& warn) {
    replace_worker(worker);
    try { shutdown_and_reconfigure(); }
    catch (const std::exception& failure) { if (warn) warn(std::string("语言服务恢复时重配失败：") + failure.what()); }
}

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
