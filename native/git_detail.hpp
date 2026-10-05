#pragma once

// native/git.cpp 内部工具的**共享声明**。2026-10-05 把「工作树 + 子模块」一族整段搬进
// native/git_worktree.cpp 之后，那一族要跑 git 命令（run / require_ok）、要整形 porcelain
// 输出（split_lines）、要把用户输入变成安全的宽字符参数（utf8_to_wide）—— 它们必须拿到
// git.cpp 里的**同一份实现**（run 带着 job object 与看门狗，绝不能复制一份到别的 TU）。
//
// 所以这里只有**声明**：定义全部留在 native/git.cpp 的 `taocode::git::detail` 里，命名沿用
// lsp_support.hpp 的 detail 惯例。**不要在这个头文件里写实现。**

#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace taocode::git::detail {

// 看门狗上限（连同原来的注释从 git.cpp 搬来）。它必须待在头文件里：默认实参在一个作用域里
// 只能写一次，而本文件与 git_worktree.cpp 两边调用 run() 都要这个默认值。
// 这里不引 windows.h —— DWORD 在 Windows 上就是 unsigned long（LP64/LLP64 都是 32 位）。
constexpr unsigned long default_timeout_ms = 10 * 60 * 1000;

struct Result { int code; std::string out; std::string err; };

// 跑一条 git 命令并收齐 stdout/stderr；抛 WorkspaceError（GIT_MISSING / GIT_PIPE /
// GIT_SPAWN / GIT_TIMEOUT）。job object + 看门狗的实现在 git.cpp，不在别处。
Result run(const std::filesystem::path& repo, std::vector<std::wstring> arguments,
           unsigned long timeout_ms = default_timeout_ms);

void require_ok(const Result& result, const std::string& action);
std::wstring utf8_to_wide(std::string_view value);
// 按行切开并吃掉 CRLF 的行尾（`git worktree list --porcelain` / `git submodule status` 都在用）。
std::vector<std::string> split_lines(const std::string& text);
// std::filesystem 的 u8string() 产物是 char8_t，转回 std::string 用它（不引 <charconv>）。
std::string utf8_path(const std::filesystem::path& path);

}  // namespace taocode::git::detail
