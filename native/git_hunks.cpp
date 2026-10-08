// Git 的「按块暂存 / 按块取消暂存」一族（2026-10-08 从 native/git.cpp 整段搬出：那个文件当时
// 982 行、上限 938，只剩 44 行余量）。这一族只做两件事：把 `git diff` 的 unified 文本按 "@@"
// 切成可选的块，再把选中的块拼回一个补丁喂给 `git apply --cached` —— 它不碰分支、标签、暂存
// 条目或追溯视图，与留在 git.cpp 的那些族不共一个职责域。
//
// 搬动时**实现一个字没改**：下面 DiffHunk / split_hunks / diff_hunks / apply_hunks 与 git.cpp
// 里原来的逐字相同（split_hunks 仍待在**本文件的匿名 namespace** 里，没有外部链接 —— 它只服务
// 这两个入口）。文件头多出来的只有 includes 与那排 using：`diff` 声明在 git.hpp，
// run / require_ok 的实现仍然只有 git.cpp 里那一份，声明见 native/git_detail.hpp。

#include "git.hpp"
#include "git_detail.hpp"

#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace taocode {
namespace git {

// 与 git.cpp 顶部同一排：让搬过来的代码保持原样，不必改成 detail::xxx(...)。
using detail::require_ok;
using detail::run;

namespace {
namespace fs = std::filesystem;

struct DiffHunk { int index; std::string header; std::string body; };

// Split a unified diff (as produced by git diff [--cached] -- <path>) into the
// file header plus each "@@" hunk. Header lines are everything before the first @@.
std::pair<std::string, std::vector<DiffHunk>> split_hunks(const std::string& unified) {
    std::string header;
    std::vector<DiffHunk> hunks;
    std::istringstream stream(unified);
    std::string line;
    bool in_header = true;
    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (in_header && line.rfind("@@", 0) == 0) in_header = false;
        if (in_header) { header += line + "\n"; continue; }
        if (line.rfind("@@", 0) == 0) hunks.push_back({static_cast<int>(hunks.size()), line + "\n", ""});
        else if (!hunks.empty()) hunks.back().body += line + "\n";
    }
    return {header, hunks};
}

}  // namespace

Json diff_hunks(const fs::path& repo, const std::string& path, bool staged) {
    const auto unified = diff(repo, path, staged);
    const auto [header, hunks] = split_hunks(unified);
    Json list = Json::array();
    for (const auto& hunk : hunks) {
        int additions = 0, deletions = 0;
        std::istringstream body(hunk.body);
        std::string line;
        while (std::getline(body, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (!line.empty() && line[0] == '+') ++additions;
            else if (!line.empty() && line[0] == '-') ++deletions;
        }
        list.push_back({{"index", hunk.index}, {"header", hunk.header},
                        {"body", hunk.body}, {"additions", additions}, {"deletions", deletions}});
    }
    return {{"hunks", std::move(list)}, {"header", header}};
}

void apply_hunks(const fs::path& repo, const std::string& path, bool staged,
                 const std::vector<int>& hunks, bool reverse) {
    if (hunks.empty()) throw WorkspaceError("INVALID_REQUEST", "没有选择任何改动块。");
    if (hunks.size() > 512) throw WorkspaceError("INVALID_REQUEST", "单次应用的改动块过多。");
    const auto unified = diff(repo, path, staged);
    const auto [header, available] = split_hunks(unified);
    std::string patch = header;
    for (const int wanted : hunks) {
        if (wanted < 0 || static_cast<std::size_t>(wanted) >= available.size())
            throw WorkspaceError("INVALID_REQUEST", "所选改动块不在当前差异中（差异可能已变化，请刷新）。");
        patch += available[static_cast<std::size_t>(wanted)].header + available[static_cast<std::size_t>(wanted)].body;
    }
    // The patch is fed through a file inside .git so it never shows up as an
    // untracked change in the very status this staging is about to affect.
    const auto patch_file = repo / ".git" / "taocode-apply.patch";
    {
        std::ofstream stream(patch_file, std::ios::binary | std::ios::trunc);
        if (!stream) throw WorkspaceError("IO_ERROR", "无法写入补丁临时文件。");
        stream.write(patch.data(), static_cast<std::streamsize>(patch.size()));
        if (!stream) throw WorkspaceError("IO_ERROR", "写入补丁临时文件失败。");
    }
    std::vector<std::wstring> arguments{L"apply", L"--cached", L"--recount"};
    if (reverse) arguments.push_back(L"--reverse");
    arguments.push_back(L".git/taocode-apply.patch");
    const auto result = run(repo, arguments);
    std::error_code ignored;
    fs::remove(patch_file, ignored);
    require_ok(result, reverse ? "按块取消暂存" : "按块暂存");
}

}  // namespace git
}  // namespace taocode
