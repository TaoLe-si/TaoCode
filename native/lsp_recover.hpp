// 语言服务线程的**恢复**（见 .cpp 的说明）。
#pragma once

#include "lsp_session.hpp"
#include "lsp_worker.hpp"
#include "workspace.hpp"   // Json / WorkspaceError

#include <functional>
#include <memory>

namespace taocode {
namespace lsp {

/**
 * 收掉一条可能卡死的语言服务线程，换一条干净的。
 * 有界：`Worker::stop()` 先排空（kDrainWaitMs）、再 `CancelSynchronousIo` 掉挂住的 I/O、最后 join。
 */
void replace_worker(std::unique_ptr<Worker>& worker);

/**
 * 语言服务恢复的整段动作：换线程 → 关服务器并重配（`shutdown_and_reconfigure`）→ 失败只记一条 WARN。
 * 由调用方在 **IPC 线程**上跑（不排队），所以两个回调都必须有界。
 */
void recover(std::unique_ptr<Worker>& worker, std::unique_ptr<Session>& session,
             const std::function<void()>& shutdown_and_reconfigure,
             const std::function<void(const std::string&)>& warn);

/** 弃养表里的条数（自测与诊断用）：卡死收不掉的线程与它们的会话都留在里面，宁可漏不可析构。 */
std::size_t abandoned_count();

/** 跑一段必须"队列卡死也能生效"的处理器，并就地回包（回包出口由 `reply` 提供）。 */
Json run_inline(const Json& id, const std::function<Json()>& body, const std::function<void(Json)>& reply);

}  // namespace lsp
}  // namespace taocode
