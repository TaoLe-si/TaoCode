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
#include <string_view>
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

// 2026-10-08 「路径守卫」一族从 native/workspace.cpp 搬进 native/workspace_paths.cpp 后，
// 这里只补声明：定义只剩新文件那一份（设备名 / NTFS 数据流拒法复制一份就会漂移）。
// 大小写不敏感的序数比较（Windows 的目录名比较口径，CompareStringOrdinal）。
bool equal_name(std::wstring_view left, std::wstring_view right);
// 单个路径分量必须是普通 Windows 名字：拒绝 . / .. / 尾部点或空格 / 控制字符与 NTFS 设备名。
void validate_component(const std::wstring& name);
// 调用方给的**工作区相对**路径 → fs::path：拒绝对路径、盘符、数据流、`..` 与非法字符。
std::filesystem::path parse_relative(const std::string& relative);
// 去掉 `\\?\` / `\\?\UNC\` 前缀并归一化（只接受普通盘符路径或 UNC 共享）。
std::filesystem::path plain_path(std::wstring path);
// path 是否落在 root 之下（逐段比分量，不解析符号链接）。
bool within(const std::filesystem::path& path, const std::filesystem::path& root);

}  // namespace taocode::detail
