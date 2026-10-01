// 文件与系统侧的**只读查询**分派 —— 从 `native/main.cpp` 的分派链搬出来。
//
// 为什么单独成文件：main.cpp 贴着机检硬上限（2000 行，tests/module-size.test.mjs），
// 这一组方法既不碰项目列表、也不碰事件队列，只调 `Workspace` 上已有的一问一答，
// 天然是一个域。分派器返回 `true` 表示"这一条归我"，`result` 已经填好。
//
// 与 `file.write` / `file.create` 这些**会改磁盘**的方法刻意分开：那些要跟
// `announce_file_change`（语言服务的 didCreate/didRename/didDelete 通知）和本地历史打配合，
// 属于 main.cpp 那条"写一次、广播一次"的链；这里全是"读一次、答一次"。
#pragma once

#include <string>

#include "workspace.hpp"  // Json

namespace taocode {

class Workspace;

/** `file.readOnly` / `file.lineSeparators` / `file.readBinary` / `file.usages` / `file.reveal`
 *  / `shell.reveal` / `shell.openUrl` 的实现在这里（`native/file_queries.cpp`）。 */
bool dispatch_file_query(const std::string& method, const Json& params, Workspace& workspace, Json& result);

}  // namespace taocode
