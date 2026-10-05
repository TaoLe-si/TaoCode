// Git 的「工作树 + 子模块」一族（2026-10-05 从 native/git.cpp 整段搬出：git.cpp 当时 1000 行、
// 上限 1016，只剩 16 行余量）。这一族在 IDEA 里是两个独立节点（Git: Worktrees / Git:
// Submodules），只做两件事：跑 `git worktree *` / `git submodule *`，把它们的 porcelain / 状态
// 输出整形出来。分支、标签、暂存、追溯、文件历史那些留在 git.cpp。
//
// 搬动时**实现一个字没改**：下面 worktree_list / worktree_add / worktree_remove /
// submodule_status / submodule_update 与 git.cpp 里原来的逐字相同，check_worktree_path 也一样。
// 唯一多出来的是文件头 —— detail 的那排 using（run / require_ok / utf8_to_wide / split_lines /
// utf8_path 的实现仍然只有 git.cpp 里那一份，声明见 native/git_detail.hpp；job object 与看门狗
// 绝不能复制到第二个 TU）。

#include "git.hpp"
#include "git_detail.hpp"

#include <filesystem>
#include <string>
#include <vector>

namespace taocode {
namespace git {

// 与 git.cpp 顶部同一排：让搬过来的代码保持原样，不必改成 detail::xxx(...)。
using detail::require_ok;
using detail::run;
using detail::split_lines;
using detail::utf8_path;
using detail::utf8_to_wide;

namespace {
namespace fs = std::filesystem;

// A worktree destination: an absolute path outside the current repo (git refuses a
// nested worktree) with no characters that would confuse the command line.
void check_worktree_path(const fs::path& repo, const std::string& path) {
    if (path.empty() || path.size() > 512 || path.front() == '-' ||
        path.find_first_of("\r\n") != std::string::npos)
        throw WorkspaceError("INVALID_REQUEST", "工作树路径不合法。");
    const fs::path target(path);
    if (!target.is_absolute()) throw WorkspaceError("INVALID_REQUEST", "工作树路径必须是绝对路径。");
    std::error_code ec;
    const auto canonical_repo = fs::weakly_canonical(repo, ec);
    const auto canonical_target = fs::weakly_canonical(target, ec);
    if (!canonical_target.empty() && !canonical_repo.empty() &&
        canonical_target.native().starts_with(canonical_repo.native()))
        throw WorkspaceError("INVALID_REQUEST", "工作树不能放在当前仓库目录内。");
}

}  // namespace

Json worktree_list(const fs::path& repo) {
    const auto result = run(repo, {L"worktree", L"list", L"--porcelain"});
    require_ok(result, "读取工作树列表");
    Json list = Json::array();
    Json current = Json::object();
    for (const auto& line : split_lines(result.out)) {
        if (line.empty()) {
            if (!current.empty()) { list.push_back(std::move(current)); current = Json::object(); }
            continue;
        }
        if (line.rfind("worktree ", 0) == 0) current["path"] = utf8_path(line.substr(9));
        else if (line.rfind("HEAD ", 0) == 0) current["head"] = line.substr(5);
        else if (line.rfind("branch ", 0) == 0) current["branch"] = line.substr(7);
        else if (line == "bare") current["bare"] = true;
        else if (line == "detached") current["detached"] = true;
        else if (line == "locked") current["locked"] = true;
        else if (line == "prunable") current["prunable"] = true;
    }
    if (!current.empty()) list.push_back(std::move(current));
    for (auto& entry : list) {
        if (!entry.contains("branch")) entry["branch"] = entry.value("detached", false) ? "detached" : "";
        if (!entry.contains("bare")) entry["bare"] = false;
        if (!entry.contains("locked")) entry["locked"] = false;
        if (!entry.contains("prunable")) entry["prunable"] = false;
    }
    return {{"worktrees", std::move(list)}};
}

void worktree_add(const fs::path& repo, const std::string& path, const std::string& branch, bool new_branch) {
    check_worktree_path(repo, path);
    std::vector<std::wstring> args = {L"worktree", L"add"};
    if (!branch.empty()) {
        if (branch.size() > 200 || branch.front() == '-' || branch.find_first_of("\r\n ") != std::string::npos)
            throw WorkspaceError("INVALID_REQUEST", "分支名不合法。");
        if (new_branch) args.push_back(L"-b");
        args.push_back(utf8_to_wide(branch));
    }
    args.push_back(utf8_to_wide(path));
    const auto result = run(repo, args);
    require_ok(result, "添加工作树");
}

void worktree_remove(const fs::path& repo, const std::string& path, bool force) {
    if (path.empty() || path.size() > 512 || path.front() == '-' || path.find_first_of("\r\n") != std::string::npos)
        throw WorkspaceError("INVALID_REQUEST", "工作树路径不合法。");
    std::vector<std::wstring> args = {L"worktree", L"remove"};
    if (force) args.push_back(L"--force");
    args.push_back(utf8_to_wide(path));
    const auto result = run(repo, args);
    require_ok(result, "移除工作树");
}

Json submodule_status(const fs::path& repo) {
    const auto result = run(repo, {L"submodule", L"status"});
    require_ok(result, "读取子模块状态");
    Json list = Json::array();
    for (const auto& raw : split_lines(result.out)) {
        if (raw.size() < 2) continue;
        const char status = raw[0];
        std::string rest = raw.substr(1);
        while (!rest.empty() && rest.front() == ' ') rest.erase(rest.begin());
        const auto space = rest.find(' ');
        const std::string commit = space == std::string::npos ? rest : rest.substr(0, space);
        std::string path = space == std::string::npos ? std::string() : rest.substr(space + 1);
        std::string describe;
        const auto paren = path.find(" (");
        if (paren != std::string::npos && path.back() == ')') {
            describe = path.substr(paren + 2, path.size() - paren - 3);
            path = path.substr(0, paren);
        }
        list.push_back({{"status", std::string(1, status)}, {"commit", commit},
                        {"path", path}, {"describe", describe}});
    }
    return {{"submodules", std::move(list)}};
}

void submodule_update(const fs::path& repo, bool init, bool recursive) {
    std::vector<std::wstring> args = {L"submodule", L"update"};
    if (init) args.push_back(L"--init");
    if (recursive) args.push_back(L"--recursive");
    const auto result = run(repo, args);
    require_ok(result, "更新子模块");
}

}  // namespace git
}  // namespace taocode
