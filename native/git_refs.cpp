// Git 的「分支 / 标签 / 储藏」一族（2026-10-08 从 native/git.cpp 整段搬出：那个文件当时 915 行、
// 上限 938，余量 23 行）。这一族只做一件事：**ref 本身的增删查改与切换** —— 切分支（checkout）、
// 新建/删除分支、列出/新建/删除标签、`git stash` 三条（list / push / pop）；它们都是"把一条 ref
// 挪到某个状态"，不读变更列表、不整形 diff、不碰工作树与子模块，与留在 git.cpp 的
// status/diff/commit、远端同步（pull/push/fetch/rebase/merge/cherry-pick）不共一个职责域。
//
// 搬动时**实现一个字没改**：下面九个入口与 git.cpp 里原来的逐字相同；`checked_new_name`
// 也一起搬来（它只服务 create_branch / tag_create 这两个入口，所以落进**本文件的匿名 namespace**，
// 没有外部链接，规则与 git_worktree.cpp 的 check_worktree_path 一致）。文件头多出来的只有
// includes 与那排 using：run / require_ok / checked_ref / trim / utf8_to_wide / parse_records
// 的实现仍然只有 git.cpp 里那一份，声明见 native/git_detail.hpp。

#include "git.hpp"
#include "git_detail.hpp"

#include <filesystem>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace taocode {
namespace git {

// 与 git.cpp 顶部同一排：让搬过来的代码保持原样，不必改成 detail::xxx(...)。
using detail::checked_ref;
using detail::parse_records;
using detail::require_ok;
using detail::run;
using detail::trim;
using detail::utf8_to_wide;

namespace {
namespace fs = std::filesystem;

// A ref the caller is about to CREATE (a branch or a tag). Nothing in the repo can
// vouch for it yet, so rev-parse cannot be used; instead it is held to what git
// itself would accept before it ever reaches a command line: no leading '-' (which
// git would parse as an option, e.g. -f / --hard), no spaces, no control characters.
std::wstring checked_new_name(const std::string& name, const std::string& label) {
    if (name.empty() || name.size() > 200)
        throw WorkspaceError("INVALID_REQUEST", label + "不能为空，且不能超过 200 个字符。");
    if (name.front() == '-')
        throw WorkspaceError("INVALID_REQUEST", label + "不能以 '-' 开头，否则会被 Git 当成命令行选项。");
    for (const char ch : name) {
        const auto value = static_cast<unsigned char>(ch);
        if (ch == ' ' || value < 32 || value == 127)
            throw WorkspaceError("INVALID_REQUEST", label + "不能包含空格或控制字符。");
    }
    const auto wide = utf8_to_wide(name);
    if (wide.empty()) throw WorkspaceError("INVALID_REQUEST", label + "必须是有效的 UTF-8 文本。");
    return wide;
}

}  // namespace

void checkout(const fs::path& repo, const std::string& branch) {
    if (branch.empty()) throw WorkspaceError("INVALID_REQUEST", "要切换的分支不能为空。");
    // checked_ref: the name is a ref that must exist, and it can never start with
    // '-', which git would otherwise read as an option (`git checkout --hard …`).
    require_ok(run(repo, {L"checkout", checked_ref(repo, branch)}), "切换分支");
}

Json stash_list(const fs::path& repo) {
    const auto result = run(repo, {L"stash", L"list", L"--pretty=%gd\x1f%s"});
    require_ok(result, "读取储藏");
    Json entries = Json::array();
    for (const auto& record : parse_records(result.out)) {
        if (record.empty()) continue;
        entries.push_back({{"ref", record[0]}, {"message", record.size() > 1 ? record[1].get<std::string>() : std::string()}});
    }
    return {{"entries", std::move(entries)}};
}

void stash_save(const fs::path& repo, const std::string& message) {
    if (message.empty()) require_ok(run(repo, {L"stash", L"push"}), "储藏更改");
    else require_ok(run(repo, {L"stash", L"push", L"-m", utf8_to_wide(message)}), "储藏更改");
}

void stash_pop(const fs::path& repo, const std::string& ref) {
    // 空 ref = 栈顶那一档（原来的行为，一字未改）。给了 ref 就按 `stash@{n}` 取回：
    // `checked_ref` 先 rev-parse --verify 它**确实存在**、且不以 '-' 开头（否则会被 git
    // 当成选项），与 checkout/cherry-pick 同一条守卫。非栈顶取回不会动上面那些储藏。
    if (ref.empty()) { require_ok(run(repo, {L"stash", L"pop"}), "弹出储藏"); return; }
    require_ok(run(repo, {L"stash", L"pop", checked_ref(repo, ref)}), "弹出储藏");
}

void create_branch(const fs::path& repo, const std::string& name, bool checkout_now) {
    // The branch does not exist yet, so it cannot be resolved with rev-parse; it is
    // still a name landing on git's command line and gets the same option/control
    // character rejection an existing ref would.
    const auto wide = checked_new_name(name, "分支名");
    if (checkout_now) require_ok(run(repo, {L"checkout", L"-b", wide}), "新建分支");
    else require_ok(run(repo, {L"branch", wide}), "新建分支");
}

void delete_branch(const fs::path& repo, const std::string& name) {
    if (name.empty()) throw WorkspaceError("INVALID_REQUEST", "要删除的分支不能为空。");
    require_ok(run(repo, {L"branch", L"-D", checked_ref(repo, name)}), "删除分支");
}

Json tag_list(const fs::path& repo) {
    const auto result = run(repo, {L"tag", L"--list"});
    require_ok(result, "读取标签");
    Json tags = Json::array();
    std::istringstream stream(result.out);
    std::string name;
    while (std::getline(stream, name)) {
        if (!name.empty() && name.back() == '\r') name.pop_back();
        if (!name.empty()) tags.push_back(name);
    }
    return {{"tags", std::move(tags)}};
}

void tag_create(const fs::path& repo, const std::string& name, const std::string& target) {
    // The tag is new (checked_new_name), the optional target is an existing ref.
    std::vector<std::wstring> arguments{L"tag", checked_new_name(name, "标签名")};
    if (!target.empty()) arguments.push_back(checked_ref(repo, target));
    require_ok(run(repo, arguments), "新建标签");
}

void tag_delete(const fs::path& repo, const std::string& name) {
    if (name.empty()) throw WorkspaceError("INVALID_REQUEST", "要删除的标签不能为空。");
    // The tag has to exist to be deleted, so checked_ref is the right guard here.
    require_ok(run(repo, {L"tag", L"-d", checked_ref(repo, name)}), "删除标签");
}

}  // namespace git
}  // namespace taocode