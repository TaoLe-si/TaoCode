#pragma once

// native/git.cpp 内部工具的**共享声明**。2026-10-05 把「工作树 + 子模块」一族整段搬进
// native/git_worktree.cpp 之后，那一族要跑 git 命令（run / require_ok）、要整形 porcelain
// 输出（split_lines）、要把用户输入变成安全的宽字符参数（utf8_to_wide）—— 它们必须拿到
// git.cpp 里的**同一份实现**（run 带着 job object 与看门狗，绝不能复制一份到别的 TU）。
//
// 所以这里只有**声明**：定义全部留在 native/git.cpp 的 `taocode::git::detail` 里，命名沿用
// lsp_support.hpp 的 detail 惯例。**不要在这个头文件里写实现。**
//
// 2026-10-06 又按同样的手法搬了第二族：`git log` / `git show` / `git blame` 那一族只读视图
// （log / authors / blame / file_history / show_commit）整段搬进 native/git_log.cpp，于是下面
// 这四个同样**只搬声明**（trim / checked_ref / checked_path / parse_records）—— 实现仍然只有
// git.cpp 那一份：checked_ref 要跑 run()，parse_records 要跑 split_unit，复制进第二个 TU 就是
// 两条会各自漂移的实现，正是本文件开头那句话禁止的事。

#include "workspace.hpp"  // Json（parse_records 的返回类型；git.hpp 走的是同一条包含）
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

// —— 以下四条是 2026-10-06 拆「提交历史 / 追溯」一族（native/git_log.cpp）时补的声明，
//    逐条连同它们原有的注释留在 git.cpp 里，这里只列形状。

// 吃掉尾部的 \n / \r / 空格，再去掉行首空格（porcelain 输出的每一行都要它）。
std::string trim(std::string value);
// 调用方给的 revision：必须是仓库里真存在的 ref，且永远不可能被读成命令行选项。
std::wstring checked_ref(const std::filesystem::path& repo, const std::string& base);
// 用户给的路径 spec：它落在 git 命令行的 `--` 之后，所以只要求待在仓库内。
std::wstring checked_path(const std::string& path);
// 「提交文件…」的 pathspec：在上面那五道之上再加"必须是仓库相对的 POSIX 写法"。
// 2026-10-06 partialcommit 新加的，只挂在 commit() 那一发上（`file_history` 那一条仍用宽的那道）。
std::wstring checked_pathspec(const std::string& path);
// 把 `%H\x1f%h\x1f…` 那种 0x1F 分隔、一行一条的记录切成的 [{字段…}, …]。
Json parse_records(const std::string& output);

}  // namespace taocode::git::detail
