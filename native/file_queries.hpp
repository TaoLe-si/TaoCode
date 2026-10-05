// 文件与系统侧的**只读查询**分派 —— 从 `native/main.cpp` 的分派链搬出来。
//
// 为什么单独成文件：main.cpp 贴着机检硬上限（2000 行，tests/module-size.test.mjs），
// 这一组方法既不碰项目列表、也不碰事件队列，天然是一个域。分派器返回 `true` 表示"这一条归我"，
// `result` 已经填好。
//
// 五条走 `Workspace` 上已有的一问一答（相对路径、工作区沙箱内），两条是**本文件自己的自由函数**：
// `shell.reveal` 用 `reveal_absolute`（绝对路径），`file.archiveEntries` 用 `archive_entries`
// （绝对路径 + 只列归档条目名）。后一条为什么落在这里而不是 `native/library_sources.cpp`：
// library_sources 编在 `taocode_lsp` 里，而 `taocode_workspace` 在它的**下一层**（CMakeLists.txt:30-41），
// 从本文件调过去会让只链 `taocode_workspace` 的 `workspace_test`（:111）链接失败 —— CMakeLists 是保留文件。
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
 *  / `shell.reveal` / `shell.openUrl` / `file.archiveEntries` 的实现在这里（`native/file_queries.cpp`）。
 *
 * `file.archiveEntries` 的答复形状：`{available, archive, lines:[…条目路径（恒用 /）…], truncated}`；
 * 拿不到时是 `{available:false, archive, reason}` —— 没有 `lines` 字段，前端据此整块不渲染。 */
bool dispatch_file_query(const std::string& method, const Json& params, Workspace& workspace, Json& result);

}  // namespace taocode
