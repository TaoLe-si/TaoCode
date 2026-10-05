// `dap.*`（调试协议一族）的桥接分派 —— 从 `native/main.cpp` 的分派链搬出来。
//
// 为什么单独成文件：main.cpp 贴着机检硬上限（2000 行，tests/module-size.test.mjs），
// 而这一族（30 余个方法）只认识调试会话一件事，天然是一个域。拆法与
// `native/file_queries.cpp` 相同，只是这一族要的宿主面比只读查询多（要起会话、要异步回信）。
//
// 宿主（main.cpp 的 App）实现 `RouteHost` 这张小接口；路由函数只认接口，不认 WebView2、
// 不认事件队列 —— 于是它既能在 main.cpp 之外编译，也不需要一个 App 实例就能读。
#pragma once

#include <functional>
#include <string>

#include "dap.hpp"
#include "workspace.hpp"

namespace taocode {
namespace dap {

/** 路由函数需要宿主提供的全部能力。App 把每个方法都落到它已有的
 *  `require_dap` / `dap_reply` / `stop_dap` / `dap_config` / `current_root` 上。 */
class RouteHost {
public:
    virtual ~RouteHost() = default;
    /** 惰性创建/取回会话客户端（工作区根已设好，反向请求钩子已装）；未打开项目时抛 NOT_OPEN。 */
    virtual Client& route_client() = 0;
    /** exe 旁的 TaoCode.dap.json（kind -> {command,args,request,cwd}），调用时重读一次。 */
    virtual Json route_registry() = 0;
    /** 当前项目根（`dap.start` 的 cwd 兜底）。 */
    virtual std::string route_root() const = 0;
    /** 异步答复：宿主负责搬回 UI 线程（App 的 `dap_reply`）。 */
    virtual void route_reply(Json id, Json result, Json error) = 0;
    /** 收摊（App 的 `stop_dap`）。 */
    virtual void route_stop() noexcept = 0;
    /** 已记住的断点表；没有会话时是空对象（`dap.breakpoints` 不能因此起一个会话）。 */
    virtual Json route_breakpoints() = 0;
    /** 适配器事件的落地回调（App 的 `queue_dap` 那条）。 */
    virtual Client::EventCb route_event_sink() = 0;
};

/** 一次 `dap.*` 分派的结局。`answered_async` 时调用方必须**立刻返回**，答复稍后由
 *  `RouteHost::route_reply` 送出（不能再发一条空 result 把前端的 Promise 提前解掉）。 */
enum class RouteOutcome { unhandled, answered, answered_async };

/** 方法名不以 `dap.` 开头就回 `unhandled`；否则一定回 `answered`/`answered_async`
 *  （同步分支把结果填进 `result`），或抛出 WorkspaceError（与 main.cpp 原分派的错误语义一致）。 */
RouteOutcome dispatch_dap_route(const std::string& method, const Json& params, const Json& id, RouteHost& host,
                                Json& result);

}  // namespace dap
}  // namespace taocode
