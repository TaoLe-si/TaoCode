#pragma once

// native/workspace.cpp 内部工具的**共享声明**。2026-10-05 把「递归遍历一棵树并删除/复制它」
// 整段搬进 native/workspace_tree_ops.cpp 之后，那两个函数要拿到 workspace.cpp 里的**同一份**
// `api_path`（\\?\ 前缀规范化）、`utf8_path`、`fail` 与 `win_error`（Win32 错误码 → WorkspaceError
// 的那套映射）—— 复制一份到第二个 TU 就会漂移，尤其是错误码映射。
//
// 所以这里只有**声明**：定义全部留在 native/workspace.cpp 的 `taocode::detail` 里（唯一的一份），
// 命名沿用 lsp_support.hpp 的 detail 惯例。**不要在这个头文件里写实现。**
//
// windows.h 是为了 `win_error` 的默认实参 `GetLastError()`：默认实参写死在**调用点**，而
// workspace_tree_ops.cpp 里是按一个参数调它的（那一行是原样搬过来的，不能改成显式传 GetLastError()）。
// 这里的两个宏与 native/workspace.cpp 顶部的写法一致。

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <filesystem>
#include <string>
#include <vector>

#include "workspace.hpp"  // WorkspaceError

namespace taocode::detail {

[[noreturn]] void fail(const char* code, const std::string& message);
// Win32 错误码 → WorkspaceError code 的那套映射（NOT_FOUND / ACCESS_DENIED / FILE_BUSY …），
// 消息里带上原始错误码。`error` 省略时取 GetLastError()。
[[noreturn]] void win_error(const std::string& message, DWORD error = GetLastError());

std::string utf8_path(const std::filesystem::path& path);
// Win32 API 需要的 \\?\ 前缀（长路径 + UNC）。
std::wstring api_path(const std::filesystem::path& path);

// Recursive remove for IDEA's $Delete on a populated directory: the tree is walked
// with the same FindFirstFileW enumeration the listing uses, refusing reparse
// points and bounded so a pathological tree can never loop the caller. Excluded
// names (node_modules, .git) are NOT pruned — IDEA's delete removes everything
// under the selection; exclusions only affect listing and indexing.
void remove_tree(const std::filesystem::path& directory, const std::filesystem::path& root, std::size_t& budget);

// Recursive copy for the project-view Paste: content-identical copy of a file or
// tree. CopyFileW preserves attributes, so the read-only bit is cleared afterwards
// — IDEA's pasted copies stay editable.
void copy_tree(const std::filesystem::path& source, const std::filesystem::path& target,
               const std::filesystem::path& root, std::size_t& budget);

}  // namespace taocode::detail
