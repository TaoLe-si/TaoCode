#pragma once

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

#include "workspace.hpp"  // Json, WorkspaceError

// 导出文件的落盘通道 —— IDEA `ExportToHTMLManager` 里"把生成的内容写进用户选的目录"那一步。
//
// 对照源码：`platform/lang-impl/src/com/intellij/codeEditor/printing/ExportToHTMLManager.java`
//   · `:317` `progressIndicator.setText(… generating.file.progress …)` —— 逐个文件写；
//   · `:335` `psiFile.getVirtualFile().getNameSequence() + ".html"` —— 输出文件名 = 原名 + `.html`；
//   · `:248/:255` 目录范围时在每个目录下写 `index.html`，并链到子目录的 `index.html`；
//   · `:157/:323` `OPEN_IN_BROWSER` 时把生成的 HTML 交给系统浏览器。
//
// **这不是一条通用写文件通道**，边界是刻意收窄的（理由与 `open_external` 同一条思路：
// 桥上的参数可能来自语言服务器或用户数据）：
//   · 只写**绝对路径**，且扩展名必须在白名单里（`kAllowedExtensions`）；
//   · 父目录必须已存在（不替用户造目录树 —— 保存对话框保证了这一点）；
//   · 拒绝重解析点（与其他写路径一致，避免被符号链接改道）；
//   · 条数与总量上限（见 `write_all`），避免一条请求把磁盘写满。
// 真正"写进工作区"的路径仍然走 `file.write`（那一条有版本校验与本地历史），这里只服务"导出"。
namespace taocode {
namespace export_file {

/** 允许导出的扩展名（小写、带点）。加新格式时**同时**改这里与前端 `src/htmlExport.ts` 的提示。 */
inline constexpr std::string_view kAllowedExtensions[] = {".html", ".htm"};

/** 这条通道一次最多写多少个文件（目录范围导出用；IDEA 用进度条跑任意多个，我们设一个上限并如实报错）。 */
inline constexpr std::size_t kMaxFiles = 2000;

/** 这批内容的总字节上限（64 MiB）。 */
inline constexpr std::size_t kMaxBytes = 64ull * 1024 * 1024;

/** 扩展名是否在白名单内（大小写不敏感；只比较最后一个点之后的部分）。纯函数，可单测。 */
bool allowed_extension(std::string_view name);

/** 一个待写文件：绝对路径 + UTF-8 文本。 */
struct Entry {
    std::string path;
    std::string content;
};

/**
 * 批量写出。任一条不合法就**整体拒绝**（不写一半），返回 `{written, bytes, paths}`。
 */
Json write_all(const std::vector<Entry>& entries);

/**
 * 供 `app.writeExportFiles`：把 `[{path, content}, …]` 直接写出去。
 * 整形（JSON → `Entry`）放在这里而不是 main.cpp —— main.cpp 贴着机检上限，
 * 而且"这条通道收什么形状"本来就属于这个域的边界。
 */
Json write_json(const Json& files);

}  // namespace export_file
}  // namespace taocode
