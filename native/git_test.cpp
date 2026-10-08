// Integration test for the VCS layer against a real Git repository created in a
// temp directory. Skips (exit 0) if Git is unavailable.
#include "git.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::git::Change;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

void put(const fs::path& path, const std::string& text) {
    std::ofstream file(path, std::ios::binary | std::ios::trunc);
    file << text;
}

std::string text(const fs::path& path) {
    const auto value = path.generic_u8string();
    return {reinterpret_cast<const char*>(value.data()), value.size()};
}

std::string read_text(const fs::path& path) {
    std::ifstream file(path, std::ios::binary);
    return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}

void git(const fs::path& repo, const std::wstring& args) {
    const auto code = _wsystem((L"git -C \"" + repo.native() + L"\" " + args + L" >NUL 2>NUL").c_str());
    if (code != 0) throw std::runtime_error("git " + text(args) + " failed");
}

std::wstring wide_from(const std::string& value) {
    return std::wstring(value.begin(), value.end());
}

// Default branch name (master or main, depending on the installed Git).
std::wstring default_branch(const fs::path& repo) {
    const auto command = L"git -C \"" + repo.native() + L"\" symbolic-ref --short HEAD 2>NUL";
    FILE* pipe = _wpopen(command.c_str(), L"r");
    if (!pipe) return L"master";
    std::string out;
    char buffer[64];
    while (fgets(buffer, sizeof(buffer), pipe)) out += buffer;
    _pclose(pipe);
    while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back();
    return wide_from(out.empty() ? "master" : out);
}
}  // namespace

int main() {
    if (!taocode::git::available()) { std::cout << "SKIP git (not installed)\n"; return 0; }
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    const auto root = fs::temp_directory_path() / ("taocode-git-test-" + std::to_string(GetCurrentProcessId()));
    std::error_code ec;
    fs::remove_all(root, ec);
    fs::create_directories(root);

    try {
        git(root, L"init -q");
        git(root, L"config user.email test@example.com");
        git(root, L"config user.name Test");
        git(root, L"config core.autocrlf false");  // keep LF bytes exactly as written
        git(root, L"config commit.gpgsign false");
        put(root / "a.txt", "hello\n");
        git(root, L"add a.txt");
        git(root, L"commit -q -m init");
    } catch (const std::exception& error) {
        std::cerr << "SETUP FAIL: " << error.what() << '\n';
        fs::remove_all(root, ec);
        return 1;
    }

    // 部分提交那一族用**自己的**临时仓库：目录名带进程号（同机并发不撞），用例之间只按文件名字分
    // 区间，不靠先后顺序也不靠时序 —— 上面那个共享仓库留过一次脏文件，把后面那条"提交完工作区要
    // 干净"的全局判据挡红过（见 git_test.cpp 里 unstage 那条的收尾注释），所以这一族不再蹭它。
    const auto scope = fs::temp_directory_path() / ("taocode-git-scope-" + std::to_string(GetCurrentProcessId()));
    fs::remove_all(scope, ec);
    fs::create_directories(scope);
    bool scope_ready = true;
    try {
        git(scope, L"init -q");
        git(scope, L"config user.email test@example.com");
        git(scope, L"config user.name Test");
        git(scope, L"config core.autocrlf false");  // keep LF bytes exactly as written
        git(scope, L"config commit.gpgsign false");
        put(scope / "sc-keep.txt", "keep one\n");
        put(scope / "sc-pick.txt", "pick one\n");
        put(scope / "sc-pair.txt", "pair content that stays long enough for git to call it a rename\n");
        git(scope, L"add -A");
        git(scope, L"commit -q -m sc-base");
    } catch (const std::exception& error) {
        std::cerr << "SCOPE SETUP FAIL: " << error.what() << '\n';
        scope_ready = false;
    }

    run("clean tree has no changes and reports a branch", [&] {
        const auto changes = taocode::git::status(root);
        check(changes.empty(), "expected clean tree");
        check(!taocode::git::head(root).empty(), "head branch should be readable");
        check(!taocode::git::branches(root).empty(), "branches should list");
    });

    run("detects modified and untracked files", [&] {
        put(root / "a.txt", "hello world\n");
        put(root / "b.txt", "brand new\n");
        const auto changes = taocode::git::status(root);
        const auto find = [&](const std::string& path) {
            for (const auto& change : changes) if (change.path == path) return &change;
            return static_cast<const Change*>(nullptr);
        };
        const auto* a = find("a.txt");
        const auto* b = find("b.txt");
        check(a && a->work_status == "M" && !a->staged, "a.txt should be an unstaged modification");
        check(b && b->untracked, "b.txt should be untracked");
    });

    // 「忽略的文件」（IDEA `ChangesView.ShowIgnored`）：默认不列，开着时用 `!!` 记录列出来。
    run("ignored files only show when asked for", [&] {
        put(root / ".gitignore", "ignored.txt\n");
        put(root / "ignored.txt", "not tracked on purpose\n");
        const auto hidden = taocode::git::status(root);
        for (const auto& change : hidden) check(change.path != "ignored.txt", "默认不列忽略的文件");
        const auto shown = taocode::git::status(root, true);
        const Change* hit = nullptr;
        for (const auto& change : shown) if (change.path == "ignored.txt") hit = &change;
        check(hit && hit->ignored, "开着时忽略的文件要列出来，并标成 ignored");
        check(hit && !hit->staged && !hit->untracked, "忽略的文件既不是已暂存也不是未跟踪");
        check(hit && hit->index_status == "!" && hit->work_status == "!", "porcelain 的 `!!` 记录要如实带出来");
        // 收尾：这个用例建的 .gitignore 与文件要清掉，否则后面那条 `ignore_path appends once and only once`
        // 会看见一个非空 .gitignore（共享同一个临时仓库，用例之间不许留脏东西）。
        std::error_code cleanup;
        fs::remove(root / ".gitignore", cleanup);
        fs::remove(root / "ignored.txt", cleanup);
    });

    // 补丁（IDEA `CreatePatchFromChangesAction` 的输入）：`git diff HEAD` + 未跟踪文件按"新文件"接上；
    // 忽略的文件不进补丁（git 的 diff 不认它，`--no-index` 那一路也跳过它 —— 它没出现在 status 里）。
    run("the patch carries tracked changes and untracked files as new files", [&] {
        put(root / "patch-new.txt", "brand new\n");
        put(root / "a.txt", "hello world\nmore\n");
        const auto text = taocode::git::patch(root, true);
        check(text.find("diff --git a/a.txt b/a.txt") != std::string::npos, "已跟踪的改动要在补丁里");
        check(text.find("diff --git a/patch-new.txt b/patch-new.txt") != std::string::npos, "未跟踪的文件也要在补丁里");
        check(text.find("new file mode") != std::string::npos, "未跟踪的那一份要标成新文件");
        check(text.find("--- /dev/null") != std::string::npos, "新文件的旧侧是 /dev/null");
        check(text.find("+brand new") != std::string::npos, "内容要带上");
        check(taocode::git::patch(root, false).find("patch-new.txt") == std::string::npos, "关掉时不含未跟踪文件");
        // 收尾：a.txt 恢复成本用例之前的样子（下一条 `diff shows the modification` 拿它当夹具，
        // 共享同一个临时仓库，用例之间不许留脏东西），未跟踪的那个文件也删掉。
        std::error_code cleanup;
        fs::remove(root / "patch-new.txt", cleanup);
        put(root / "a.txt", "hello world" + std::string(1, char(10)));
    });

    run("diff shows the modification", [&] {
        const auto diff = taocode::git::diff(root, "a.txt", false);
        check(diff.find("hello world") != std::string::npos, "diff should include the new line");
        // The side-by-side view is derived from that same text, so it must agree.
        const auto sides = taocode::git::diff_sides(root, "a.txt", false);
        const auto& rows = sides.at("rows");
        check(rows.size() == 1 && rows[0].at("kind") == "change",
              "one changed line on both sides, got " + rows.dump() + " from " + diff);
        check(rows[0].at("left").at("text") == "hello" && rows[0].at("right").at("text") == "hello world",
              "the paired texts match the two revisions");
        check(rows[0].at("left").at("no") == 1 && rows[0].at("right").at("no") == 1, "1-based line numbers");
        const auto right = rows[0].at("rightMarks")[0];
        check(rows[0].at("rightMarks").size() == 1 &&
                  rows[0].at("right").at("text").get<std::string>().substr(right[0].get<std::size_t>(), right[1].get<std::size_t>()) == "world",
              "the word mark covers only the added word: " + rows[0].dump());
        // An untracked file has no diff at all, which the viewer reports as empty.
        check(taocode::git::diff_sides(root, "b.txt", false).at("rows").empty(),
              "an untracked file yields no rows because git emits no diff for it");
    });

    run("stage then commit moves changes out of status", [&] {
        taocode::git::stage(root, "b.txt");
        auto staged = taocode::git::status(root);
        const auto* b = [&] { for (const auto& c : staged) if (c.path == "b.txt") return &c; return static_cast<const Change*>(nullptr); }();
        check(b && b->staged, "b.txt should be staged after add");
        taocode::git::stage(root, "a.txt");
        taocode::git::commit(root, "update a and add b");
        const auto after = taocode::git::status(root);
        check(after.empty(), "tree should be clean after commit");
    });

    run("unstage returns a staged file to the working tree", [&] {
        put(root / "a.txt", "again\n");
        taocode::git::stage(root, "a.txt");
        taocode::git::unstage(root, "a.txt");
        const auto changes = taocode::git::status(root);
        const auto* a = [&] { for (const auto& c : changes) if (c.path == "a.txt") return &c; return static_cast<const Change*>(nullptr); }();
        check(a && !a->staged && a->work_status == "M", "a.txt should be unstaged but still modified");
        // 收尾：上面那条判据要的形状就是「index 未改、工作区已改」= porcelain 的 `(X YM)`，
        // 而空 paths 的那一发 `git commit` 只提交暂存区（`native/git.cpp:460` `scoped = !paths.empty()`，
        // 走到 `git commit -m` 不带 `--only`），所以这种脏文件谁都清不掉，只能回滚。
        // 共享同一个临时仓库，用例之间不许留脏东西 —— 它一路留到后面 `commit with a path subset`
        // 那条收尾的全局干净判据上，把它挡红（2026-10-06 的原生回归）。
        taocode::git::revert(root, "a.txt");
    });

    run("checkout creates and switches a branch", [&] {
        git(root, L"checkout -q -b feature");
        check(taocode::git::head(root) == "feature", "head should be feature after checkout -b");
        const auto branches = taocode::git::branches(root);
        bool has_feature = false;
        for (const auto& name : branches) if (name == "feature") has_feature = true;
        check(has_feature, "branches should include feature");
    });

    run("pull runs plain 'git pull' (not --ff-only) so diverged branches still merge", [&] {
        // TaoCode's pull is IDEA's default (merge), not ff-only. ff-only is a
        // separate action. A plain `git pull` without a configured upstream throws,
        // so we just verify the call goes through and that the source no longer
        // passes --ff-only.
        bool caught = false;
        try { taocode::git::pull(root); }
        catch (const taocode::WorkspaceError& error) {
            caught = error.code == "GIT_FAILED";
        }
        check(caught, "pull runs (and fails because the test repo has no upstream, exactly like plain `git pull`)");
    });

    run("log lists commits for the repo and for a file", [&] {
        const auto repo_log = taocode::git::log(root, "", 50);
        check(!repo_log.at("commits").empty(), "repo history has commits");
        check(repo_log.at("commits")[0].at("hash").get<std::string>().size() == 40, "full sha is 40 hex chars");
        const auto file_log = taocode::git::log(root, "a.txt", 50);
        check(!file_log.at("commits").empty(), "a.txt history has commits");
    });

    run("stash saves and restores uncommitted changes", [&] {
        put(root / "a.txt", "stashed-content\n");
        check(!taocode::git::status(root).empty(), "working tree is dirty before stash");
        taocode::git::stash_save(root, "wip");
        bool still_dirty = false;
        for (const auto& change : taocode::git::status(root)) if (change.path == "a.txt") still_dirty = true;
        check(!still_dirty, "stash set a.txt aside");
        check(!taocode::git::stash_list(root).at("entries").empty(), "stash list has an entry");
        taocode::git::stash_pop(root);
        bool restored = false;
        for (const auto& change : taocode::git::status(root)) if (change.path == "a.txt") restored = true;
        check(restored, "stash pop brought the change back");
        // 收尾：pop 回来的正是那份**未暂存**改动（又是 `(X YM)`，`git stash pop` 默认不还原 index），
        // 与上一条用例同理，谁也提交不掉它 ⇒ 当场回滚，别让它漂到后面的用例。
        taocode::git::revert(root, "a.txt");
    });

    // 按 ref 取回**非栈顶**那一条（搁架面板任意一行的「取出」）：`git stash pop stash@{n}`。
    // 收尾把两条都弹掉，别让储藏漂到后面的用例。
    run("stash_pop takes an explicit stash@{n} ref (non-top entry)", [&] {
        put(root / "a.txt", "older-wip\n");
        taocode::git::stash_save(root, "older");
        put(root / "a.txt", "newer-wip\n");
        taocode::git::stash_save(root, "newer");
        const auto entries = taocode::git::stash_list(root).at("entries");
        check(entries.size() >= 2, "two stashes on the stack");
        check(entries[0].at("ref").get<std::string>() == "stash@{0}", "list is stack order (top first)");
        // 取回**第二条**（older）：证明按 ref 取回的正是那一条，而不是栈顶。
        taocode::git::stash_pop(root, "stash@{1}");
        check(read_text(root / "a.txt") == "older-wip\n", "popped the older stash by its ref");
        taocode::git::revert(root, "a.txt");
        // 剩下栈顶（newer）还在，继续按 ref 弹掉，收尾干净。
        taocode::git::stash_pop(root, "stash@{0}");
        check(read_text(root / "a.txt") == "newer-wip\n", "popped the remaining stash by its ref");
        taocode::git::revert(root, "a.txt");
        check(taocode::git::stash_list(root).at("entries").empty(), "both stashes consumed");
    });

    run("create_branch and merge integrate a topic branch", [&] {
        const auto base = taocode::git::head(root);
        check(!base.empty() && base[0] != '(', "current head is a named branch, got: " + base);
        taocode::git::create_branch(root, "taocode-topic", true);
        put(root / "topic.txt", "topic\n");
        taocode::git::stage(root, "topic.txt");
        taocode::git::commit(root, "topic work");
        taocode::git::checkout(root, base);
        taocode::git::merge(root, "taocode-topic");
        check(fs::exists(root / "topic.txt"), "merge brought topic.txt into the base branch");
    });

    run("compare lists and diffs what another branch adds", [&] {
        const auto base = taocode::git::head(root);
        taocode::git::create_branch(root, "taocode-compare", true);
        put(root / "cmp.txt", "first line\nsecond line\n");
        taocode::git::stage(root, "cmp.txt");
        taocode::git::commit(root, "add cmp.txt");
        taocode::git::checkout(root, base);
        const auto listed = taocode::git::compare(root, "taocode-compare");
        const auto& files = listed.at("files");
        check(files.size() == 1, "the branch's single new file is listed, got " + std::to_string(files.size()));
        check(files[0].at("path").get<std::string>() == "cmp.txt", "the compared file");
        check(files[0].at("status").get<std::string>() == "A", "it is reported as added");
        check(listed.at("base").get<std::string>() == "taocode-compare", "the revision is echoed back for the header");
        const auto text = taocode::git::diff(root, "cmp.txt", false, "taocode-compare");
        check(text.find("+first line") != std::string::npos, "the diff shows the branch's content as additions");
        const auto sides = taocode::git::diff_sides(root, "cmp.txt", false, "taocode-compare");
        check(sides.at("rows").size() >= 2, "the aligned rows come from the same text");
        check(sides.at("rows")[0].at("kind").get<std::string>() == "insert", "the first row is an insertion");
        bool rejected = false;
        try { taocode::git::compare(root, "no/such-branch"); }
        catch (const taocode::WorkspaceError& error) { rejected = error.code == "INVALID_REQUEST"; }
        check(rejected, "an unknown revision is a bad request, not a git crash");
        rejected = false;
        try { taocode::git::compare(root, "--output=../pwned"); }
        catch (const taocode::WorkspaceError& error) { rejected = error.code == "INVALID_REQUEST"; }
        check(rejected, "an option-looking revision never reaches git");
        check(!fs::exists(root / ".." / "pwned"), "the rejected revision wrote nothing outside the repo");
        taocode::git::checkout(root, base);
    });

    run("amend rewrites the last commit, with or without a new message", [&] {
        put(root / "amend1.txt", "one\n");
        taocode::git::stage(root, "amend1.txt");
        taocode::git::commit(root, "keep this subject");
        const auto before = taocode::git::log(root, "", 10).at("commits");
        put(root / "amend2.txt", "two\n");
        taocode::git::stage(root, "amend2.txt");
        taocode::git::commit(root, "", true);  // empty message on an amend keeps it
        const auto kept = taocode::git::log(root, "", 10).at("commits");
        check(kept.size() == before.size(), "amending does not add a commit");
        check(kept[0].at("subject").get<std::string>() == "keep this subject", "the original subject survived");
        const auto touched = taocode::git::log(root, "amend2.txt", 10).at("commits");
        check(touched.size() == 1, "the amended commit is what introduced amend2.txt");
        check(touched[0].at("subject").get<std::string>() == "keep this subject", "the new file rode along with it");
        taocode::git::commit(root, "rewritten subject", true);
        const auto after = taocode::git::log(root, "", 10).at("commits");
        check(after[0].at("subject").get<std::string>() == "rewritten subject", "amend can replace the message");
        check(after.size() == before.size(), "still the same number of commits");
        check(taocode::git::log(root, "amend2.txt", 10).at("commits")[0].at("subject").get<std::string>() == "rewritten subject",
              "and the file stays inside that same rewritten commit");
        bool rejected = false;
        try { taocode::git::commit(root, "", false); }
        catch (const taocode::WorkspaceError& error) { rejected = error.code == "INVALID_REQUEST"; }
        check(rejected, "a plain commit still needs a message");
    });

    // 「提交文件…」（R1 的那半条通道）：只把选中的那些路径带进这次提交。
    // 上游 = CommonCheckinFilesAction.kt:26-78 → CheckinActionUtil.kt:100-160（pathsToCommit
    // → getIncludedChanges → workflowHandler.setCommitState(...)），本仓落到
    // `git commit --only -- <paths>`（native/git.cpp 的 commit(..., paths)）。
    run("commit with a path subset commits only the selected files", [&] {
        put(root / "scope-a.txt", "a one\n");
        put(root / "scope-b.txt", "b one\n");
        taocode::git::stage(root, "scope-a.txt");
        taocode::git::stage(root, "scope-b.txt");
        put(root / "scope-a.txt", "a two\n");  // 被选项再改一次：--only 取工作区那一份
        taocode::git::commit(root, "scoped: only a", false, false, "", "", {"scope-a.txt"});
        const auto after = taocode::git::status(root);
        const auto* b = [&] { for (const auto& c : after) if (c.path == "scope-b.txt") return &c; return static_cast<const Change*>(nullptr); }();
        check(b != nullptr && b->staged, "另一个已暂存的文件不跟着走，仍留在暂存区");
        const auto* a = [&] { for (const auto& c : after) if (c.path == "scope-a.txt") return &c; return static_cast<const Change*>(nullptr); }();
        check(a == nullptr, "被选中的那个文件整个从变更列表里消失");
        const auto touched = taocode::git::log(root, "scope-a.txt", 5).at("commits");
        check(!touched.empty() && touched[0].at("subject").get<std::string>() == "scoped: only a",
              "那次提交的内容就是被选项的工作区版本");
        // 未跟踪的被选项：git 不认陌生 pathspec（实测 error: pathspec '…' did not match any
        // file(s) known to git），而上游那一支把 untracked 也当新文件纳入 ⇒ 先 add 再 --only。
        put(root / "scope-c.txt", "brand new\n");
        taocode::git::commit(root, "scoped: new file", false, false, "", "", {"scope-c.txt"});
        const auto added = taocode::git::log(root, "scope-c.txt", 5).at("commits");
        check(added.size() == 1 && added[0].at("subject").get<std::string>() == "scoped: new file",
              "未跟踪的被选项也能提交进去");
        // pathspec 走的是用户给的路径，非法的必须在交给 git 之前被挡住（与 file_history 同一个 checked_path）。
        bool escaped = false;
        try { taocode::git::commit(root, "escapes", false, false, "", "", {"../outside.txt"}); }
        catch (const taocode::WorkspaceError& error) { escaped = error.code == "INVALID_REQUEST"; }
        check(escaped, "路径不能越出仓库");
        bool injected = false;
        try { taocode::git::commit(root, "option", false, false, "", "", {"--help"}); }
        catch (const taocode::WorkspaceError& error) { injected = error.code == "INVALID_REQUEST"; }
        check(injected, "路径永远不会被读成命令行选项");
        // 一批 pathspec 的**条数**上限由 `native/git.cpp:461`（`paths.size() > 500` ⇒ INVALID_REQUEST）把住：
        // `git add -- <paths>` 与 `git commit --only -- <paths>` 都把整批路径拼进**一发**命令行，
        // 所以超限的那一发必须在**调 git 之前**就被拦下。真放到 git 那一层，这些不存在的 pathspec 会让
        // `git add` 以 GIT_FAILED 失败 ⇒ 断言错误码是 INVALID_REQUEST 本身就等于"git 没被调用"。
        const auto tip_before_limit = taocode::git::log(root, "", 1).at("commits")[0].at("hash").get<std::string>();
        std::vector<std::string> too_many;
        for (int i = 0; i < 501; ++i) too_many.push_back("scope-p" + std::to_string(i) + ".txt");
        bool over_limit = false;
        std::string limit_reason;
        try { taocode::git::commit(root, "over the limit", false, false, "", "", too_many); }
        catch (const taocode::WorkspaceError& error) { over_limit = error.code == "INVALID_REQUEST"; limit_reason = error.what(); }
        check(over_limit, "一次最多 500 个所选文件（超限必须在调 git 之前就被拦下）");
        check(limit_reason.find("500") != std::string::npos, "拒因要说清上限是多少，got: " + limit_reason);
        check(taocode::git::log(root, "", 1).at("commits")[0].at("hash").get<std::string>() == tip_before_limit,
              "被拦下的那一发既没调 git 也没生成提交");
        // 收尾前先确认「确实还有没提交的东西」：少了这一句，下面那句 rest.empty() 会在
        // "收尾的 commit 其实什么也没提交" 时假绿（空 paths 的 commit 只吃 index，scope-b 是唯一那一发）。
        check(!taocode::git::status(root).empty(), "空 paths 这一发之前确实还有没提交的东西");
        // 收尾：把留在暂存区的那一份提交掉，后面的用例需要一个干净的 index。
        taocode::git::commit(root, "scoped: the rest");
        // 失败信息带上"还剩哪几个文件、porcelain 的 XY 是什么"：这一档 check 的是**整个**工作区，
        // 前面那几条只按名字看 scope-a / scope-b，所以别处留下的脏文件也只能在这里才看得见。
        const auto rest = taocode::git::status(root);
        std::string left;
        for (const auto& change : rest)
            left += " " + change.path + "(X" + change.index_status + "Y" + change.work_status +
                    (change.untracked ? " untracked" : "") + (change.staged ? " staged" : "") + ")";
        check(rest.empty(), "工作区重新干净，还剩:" + left);
    });

    // ── 部分提交（「提交文件…」，上游 `CheckinFiles` = `VcsActions.xml:187`）的端到端判据 ──
    // 这四条跑在**上面那个专用临时仓库**里：只建一次、每条用自己的文件名，不共享 `root`、不靠时序。
    const auto scoped_commit = [&](const std::string& message, const std::vector<std::string>& paths) {
        taocode::git::commit(scope, message, false, false, "", "", paths);
    };
    const auto find_change = [](const std::vector<Change>& changes, const std::string& path) {
        for (const auto& change : changes) if (change.path == path) return &change;
        return static_cast<const Change*>(nullptr);
    };

    // 判据本体：**选择子集 ⇒ 只提交子集**。两篇都已暂存、其中一篇还带一半未暂存的改动，
    // 只提交被选的那一篇 ⇒ HEAD 里只有它，没被选的那一篇仍原样留在暂存区（一条不丢）。
    run("partial commit: only the selected subset lands, the other stays staged", [&] {
        check(scope_ready, "专用临时仓库没建起来，这一族判据全部作废");
        put(scope / "sc-keep.txt", "keep two\n");
        put(scope / "sc-pick.txt", "pick two\n");
        git(scope, L"add -A");                        // 两篇都已暂存
        put(scope / "sc-pick.txt", "pick three\n");   // 被选的这篇再改一次 ⇒ MM（暂存 + 未暂存混着）
        const auto before = taocode::git::status(scope);
        const auto* keep_before = find_change(before, "sc-keep.txt");
        const auto* pick_before = find_change(before, "sc-pick.txt");
        check(keep_before && keep_before->staged, "前提：sc-keep.txt 已暂存");
        check(pick_before && pick_before->staged && pick_before->work_status == "M",
              "前提：sc-pick.txt 是 MM（暂存一半、工作区还有一半）");
        scoped_commit("sc: only pick", {"sc-pick.txt"});
        const auto patch = taocode::git::show_commit(scope, "HEAD").at("patch").get<std::string>();
        check(patch.find("sc-pick.txt") != std::string::npos, "这次提交里有被选的那一篇，got: " + patch);
        check(patch.find("sc-keep.txt") == std::string::npos, "这次提交里没有没被选的那一篇");
        // 混用暂存/未暂存那一档的实测口径：--only 取**工作区内容**，所以被选这篇的两半一起进去
        // （与上游一致：上游把被选项的当前内容 addPathsForce 进 index，`GitFileUtils.kt:171-178`）。
        check(patch.find("pick three") != std::string::npos,
              "被选那一篇连没暂存的那一半一起提交（工作区内容才是提交内容），got: " + patch);
        const auto after = taocode::git::status(scope);
        const auto* keep = find_change(after, "sc-keep.txt");
        check(keep != nullptr && keep->staged && keep->index_status == "M",
              "没被选的那一篇仍留在暂存区，一条不动");
        check(find_change(after, "sc-pick.txt") == nullptr, "被选那一篇提交完整个从变更列表里消失");
        const auto kept_log = taocode::git::log(scope, "sc-keep.txt", 5).at("commits");
        check(!kept_log.empty() && kept_log[0].at("subject").get<std::string>() == "sc-base",
              "反向验证：没被选的那一篇最近一次提交还是 sc-base（不是这次），got: " + kept_log.dump());
    });

    // 未跟踪的被选项：git 不认陌生 pathspec（实测 `error: pathspec '…' did not match any file(s)
    // known to git`）⇒ native 只对**未跟踪的那几条** add；同时"只提交子集"要连未跟踪的一起成立 ——
    // 另一篇未跟踪的文件不能顺手被 add 进来。
    run("partial commit: an untracked selection is added without dragging the other one in", [&] {
        check(scope_ready, "专用临时仓库没建起来");
        put(scope / "sc-new.txt", "brand new\n");
        put(scope / "sc-other.txt", "other new\n");
        scoped_commit("sc: new only", {"sc-new.txt"});
        const auto patch = taocode::git::show_commit(scope, "HEAD").at("patch").get<std::string>();
        check(patch.find("sc-new.txt") != std::string::npos && patch.find("new file mode") != std::string::npos,
              "未跟踪的被选项作为新文件进这次提交，got: " + patch);
        check(patch.find("sc-other.txt") == std::string::npos, "另一篇未跟踪的文件没被顺手带进去");
        const auto after = taocode::git::status(scope);
        const auto* other = find_change(after, "sc-other.txt");
        check(other && other->untracked && !other->staged, "另一篇仍然是未跟踪（也没被 add 过）");
    });

    // 重命名**必须成对**：上游一条 `ChangedPath` 同时带 beforePath/afterPath
    // （`GitCheckinEnvironment.kt:403-404`）。单边提交实测写出坏历史（只给新路径 ⇒ `A` + HEAD 里旧路径
    // 还在；只给旧路径 ⇒ `D` + 新内容留在 index）。这里还要顺带证明"旧路径交给 git 但不 add"是可行的：
    // 实测 `git add -- <已 mv 走的旧路径>` 直接 fatal 128，`--ignore-errors` 压不住。
    run("partial commit: a rename goes as a pair or not at all", [&] {
        check(scope_ready, "专用临时仓库没建起来");
        git(scope, L"mv sc-pair.txt sc-renamed.txt");
        bool one_sided = false;
        std::string reason;
        try { scoped_commit("sc: rename new side only", {"sc-renamed.txt"}); }
        catch (const taocode::WorkspaceError& error) {
            one_sided = std::string(error.code) == "INVALID_REQUEST";
            reason = error.what();
        }
        check(one_sided, "只给新路径的重命名必须被拒（否则写出\"新增一份 + 旧的还留在 HEAD\"的坏历史）");
        check(reason.find("成对") != std::string::npos, "拒因要说清是成对问题，got: " + reason);
        // 反向验证：旧路径那一侧单独给也要被拒（两种单边都是坏历史）。
        bool old_only = false;
        try { scoped_commit("sc: rename old side only", {"sc-pair.txt"}); }
        catch (const taocode::WorkspaceError& error) { old_only = std::string(error.code) == "INVALID_REQUEST"; }
        check(old_only, "只给旧路径的重命名同样要被拒");
        // 两朵一起给 ⇒ 一次真正的重命名（上游那条 ChangedPath 的等价结果），而且不需要 add 旧路径。
        scoped_commit("sc: renamed", {"sc-renamed.txt", "sc-pair.txt"});
        const auto patch = taocode::git::show_commit(scope, "HEAD").at("patch").get<std::string>();
        check(patch.find("sc-renamed.txt") != std::string::npos, "重命名的新路径在这次提交里，got: " + patch);
        check(patch.find("new file mode") == std::string::npos,
              "这次提交不是\"新增一份副本\"：没有 new file mode，got: " + patch);
        const auto tree = taocode::git::status(scope);
        check(find_change(tree, "sc-pair.txt") == nullptr && find_change(tree, "sc-renamed.txt") == nullptr,
              "两朵路径提交完都从变更列表里消失");
        const auto old_log = taocode::git::log(scope, "sc-pair.txt", 5).at("commits");
        check(!old_log.empty() && old_log[0].at("subject").get<std::string>() == "sc: renamed",
              "旧路径的历史跟着这次重命名走到底（HEAD 里它已经不在了），got: " + old_log.dump());
    });

    // pathspec 那一面：落在 `--` 之后所以读不成选项，但"必须是仓库相对的写法"要有人管。
    // 上面那六条形状都是实测出来的口径（详见 native/git.cpp 的 checked_pathspec 注释）；
    // 下面另两批是 2026-10-06 commitpaths 补的：通配/魔术那五档（W3）与两条上限的边界（W4）。
    run("partial commit: pathspec must be a repo-relative POSIX path", [&] {
        check(scope_ready, "专用临时仓库没建起来");
        const std::vector<std::pair<std::string, std::string>> rejected = {
            {"../sc-escape.txt", "越出仓库"},
            {"--sc-option.txt", "读成命令行选项"},
            {"C:/taocode/outside.txt", "仓外绝对路径"},
            {"sc\\windows.txt", "反斜杠分隔符（git 的 pathspec 不认，实测只会报\"没有这个文件\"）"},
            // NUL 不能写成字面量里的 \u0000：std::string 从 const char* 构造时会在第一个 NUL 处截断，
            // 那条 case 就悄悄变成"sc-nul"。这里显式拼长度。
            {std::string("sc-nul") + '\0' + ".txt", "控制字符（到 git 那一头 argv 会被截断）"},
            {"sc-unknown.txt", "没有可提交的变更（上游 `NOT_CHANGED` 那一档动作直接不启用）"},
        };
        for (const auto& [path, label] : rejected) {
            const auto tip_before = taocode::git::log(scope, "", 1).at("commits")[0].at("hash").get<std::string>();
            bool refused = false;
            std::string code;
            try { scoped_commit("sc: must not run", {path}); }
            catch (const taocode::WorkspaceError& error) { refused = true; code = error.code; }
            check(refused, "非法 pathspec 要挡下来：" + label);
            check(code == "INVALID_REQUEST", "挡下来的是 INVALID_REQUEST 而不是让 git 撞死：" + label + "，got: " + code);
            check(taocode::git::log(scope, "", 1).at("commits")[0].at("hash").get<std::string>() == tip_before,
                  "被拒的那一发既没调 git 也没生成提交：" + label);
        }
        // 一条 pathspec 被拒时**到底是哪一道闸**拒的：返回 (错误码, 错误消息)，没拒就返回空对。
        // 为什么必须钉消息而不是只钉"被拒了"—— 本文件 `commit()` 的下面还有一道兜底：它拿 pathspec 与
        // 变更行**按字面**比（`change.path == path || change.path.startswith(path + '/')`），
        // 通配 `*.ts` 比不中任何一行 ⇒ **就算把 checked_pathspec 的通配/魔术闸整个摘掉，这一发照样抛
        // INVALID_REQUEST**。2026-10-06 commitpaths 反向验证实测：只查 `refused` 时摘闸仍然 Passed
        // （假绿），加了下面这三档（消息里要有新闸的标记、且不许漂到兜底那句）才会红。
        const std::string fallback = "这个路径没有可提交的变更";
        const auto refuse = [&](const std::vector<std::string>& paths) -> std::pair<std::string, std::string> {
            try { scoped_commit("sc: must not run", paths); }
            catch (const taocode::WorkspaceError& error) { return {error.code, error.what()}; }
            return {};
        };
        const auto head_untouched = [&](const std::string& tip_before, const std::string& label) {
            check(taocode::git::log(scope, "", 1).at("commits")[0].at("hash").get<std::string>() == tip_before,
                  "被拒的那一发既没调 git 也没生成提交：" + label);
        };
        // 通配与魔术（2026-10-06 commitpaths 落地 W3）：五档与前端 src/commitChecks.ts 的
        // PATHSPEC_MAGIC_RE = /[*?[]|:\(|^:/ 逐条同源。实测依据来自 partialcommit 那批的临时仓：
        // `git commit --only -- '*.ts'` 一次提交走两篇、`-- 'foo[1].ts'` 连 `foo1.ts` 一起提交走
        // ⇒ "只提交选中的路径"会提交得比选中的多，这是这一族最贵的错；上游不发 pathspec（改的是 index），
        // 所以这道闸只能本仓自己补。前端那道挡的是面板这条路，挡不住宿主直接递进来的同一份形状。
        for (const auto& [path, label] : std::vector<std::pair<std::string, std::string>>{
                 {"*.ts", "通配星号"},
                 {"a?.ts", "通配问号"},
                 {"sc-bracket[1].ts", "字符类"},
                 {":(exclude)sc-ok.txt", "pathspec 魔术：把选中的那一篇反向排除掉"},
                 {":!sc-ok.txt", "魔术前缀的简写（开头的 `:` 就是魔术，不是文件名）"}}) {
            const auto tip_before = taocode::git::log(scope, "", 1).at("commits")[0].at("hash").get<std::string>();
            const auto [code, message] = refuse({path});
            check(code == "INVALID_REQUEST", "通配/魔术 pathspec 要挡下来：" + label + "，got: " + code);
            check(message.find("pathspec") != std::string::npos,
                  "拒它的是 checked_pathspec 的**通配/魔术**那一道：" + label + "，got: " + message);
            check(message.find(fallback) == std::string::npos,
                  "不许漂到\"没有可提交的变更\"那道兜底上（摘掉新闸就是这一条先红）：" + label);
            head_untouched(tip_before, label);
        }
        // 两条**上限**（2026-10-06 commitpaths W4）：闸一直在（native/git.cpp 的 `path.size() > 512`
        // 与 `paths.size() > 500`），但此前没有任何一条用例打到它们 ⇒ 只证明得"前后端数字一样"，
        // 证明不了"native 真按这个数拒"。两条都在调 git 之前拒，HEAD 一动不动。
        const auto tip = taocode::git::log(scope, "", 1).at("commits")[0].at("hash").get<std::string>();
        const auto [long_code, long_message] = refuse({std::string(513, 'a') + ".ts"});
        check(long_code == "INVALID_REQUEST", "单条 pathspec 超过 512 字节要拒，got: " + long_code);
        check(long_message.find(fallback) == std::string::npos,
              "超长那一发拒在**长度**那道闸上，不是兜底那句：" + long_message);
        // 数的是**字节**不是字符：171 个汉字 = 513 字节（UTF-8 每字 3 字节，源文件按 /utf-8 编），
        // 按字符数才是 171 —— 前端 utf8ByteLength 同一口径，判据在 tests/commit-scope.test.mjs。
        // 这一句钉在这儿，免得后来人把两边一起改回按字符数。
        std::string wide_cjk;
        for (int i = 0; i < 171; ++i) wide_cjk += "\xE4\xB8\xAD";  // U+4E2D「中」
        check(wide_cjk.size() == 513, "这条用例自己得先是 513 字节，got: " + std::to_string(wide_cjk.size()));
        const auto [cjk_code, cjk_message] = refuse({wide_cjk});
        check(cjk_code == "INVALID_REQUEST", "513 **字节**的中文路径同样要拒（按字符数算它是 171，会被放行），got: " + cjk_code);
        check(cjk_message.find(fallback) == std::string::npos, "中文超长那一发也不许漂到兜底那句");
        // 条数上限的**边界**：501 条撞"条数"那一档（消息里有 500），500 条不撞 ——
        // 两边用的都是不存在的文件，所以 500 那一发必然落进兜底那句，两档因此可分辨。
        std::vector<std::string> too_many;
        for (int i = 0; i < 501; ++i) too_many.push_back("sc-many-" + std::to_string(i) + ".ts");
        const auto [many_code, many_message] = refuse(too_many);
        check(many_code == "INVALID_REQUEST", "501 条 pathspec 要拒（与前端 MAX_COMMIT_PATHS = 500 同一个数），got: " + many_code);
        check(many_message.find("500") != std::string::npos,
              "拒的是**条数**那一档而不是兜底那句，got: " + many_message);
        too_many.pop_back();  // 500 条 = 上限内
        const auto [at_limit_code, at_limit_message] = refuse(too_many);
        check(at_limit_code == "INVALID_REQUEST", "500 条那一发仍然要拒（文件不存在），got: " + at_limit_code);
        check(at_limit_message.find("500") == std::string::npos,
              "但拒它的不是条数那一档（否则上面那条可以是\"谁都拒\"），got: " + at_limit_message);
        check(at_limit_message.find(fallback) != std::string::npos,
              "500 条正好在上限内，一路走到\"没有可提交的变更\"那道兜底，got: " + at_limit_message);
        check(taocode::git::log(scope, "", 1).at("commits")[0].at("hash").get<std::string>() == tip,
              "这些上限/通配用例都没生成提交");
        // 反向对照：同一个仓库里一条**合法**的相对 pathspec 照样提交得动（否则上面那些可以是"谁都拒"）。
        put(scope / "sc-ok.txt", "ok\n");
        scoped_commit("sc: ok", {"sc-ok.txt"});
        check(taocode::git::show_commit(scope, "HEAD").at("patch").get<std::string>().find("sc-ok.txt")
                  != std::string::npos, "合法路径照常提交");
    });

    run("git.user reads the repository author and can be overridden for one commit", [&] {        const auto configured = taocode::git::user(root);
        check(configured.at("name").get<std::string>() == "Test", "user.name comes from the repository config");
        check(configured.at("email").get<std::string>() == "test@example.com", "user.email comes from the repository config");

        put(root / "author.txt", "pairing\n");
        taocode::git::stage(root, "author.txt");
        // IDEA's CommitAuthorComponent editor: the override applies to this commit only.
        taocode::git::commit(root, "pair programming", false, false, "Guest", "guest@example.com");
        const auto overridden = taocode::git::blame(root, "author.txt").at("lines");
        check(!overridden.empty(), "the overridden commit produced lines");
        check(overridden[0].at("author").get<std::string>() == "Guest", "the override is the author of the new commit");
        check(taocode::git::user(root).at("name").get<std::string>() == "Test", "the repository config is untouched");

        // A malformed override must be refused rather than handed to git.
        put(root / "author2.txt", "no email\n");
        taocode::git::stage(root, "author2.txt");
        bool rejected = false;
        try { taocode::git::commit(root, "no email", false, false, "Nameless", ""); }
        catch (const taocode::WorkspaceError& error) { rejected = error.code == "INVALID_REQUEST"; }
        check(rejected, "an author override without an email is refused");
        bool injected = false;
        try { taocode::git::commit(root, "newline", false, false, "Bad\nName", "bad@example.com"); }
        catch (const taocode::WorkspaceError& error) { injected = error.code == "INVALID_REQUEST"; }
        check(injected, "an author override cannot smuggle control characters");
        // The rejected commits left author2.txt staged; the rebase/cherry-pick tests
        // below need a clean index, so undo that here.
        taocode::git::unstage(root, "author2.txt");
        fs::remove(root / "author2.txt");
    });

    run("git.authors lists each log user once for the commit-author completion", [&] {
        // Copy the array out first: `.at()` on the temporary would leave the range-for
        // iterating a destroyed Json.
        const auto listed = taocode::git::authors(root).at("authors");
        std::vector<std::string> entries;
        for (const auto& entry : listed) entries.push_back(entry.get<std::string>());
        check(entries.size() == 2, "two distinct authors so far, not one per commit");
        check(std::find(entries.begin(), entries.end(), "Test <test@example.com>") != entries.end(),
              "the configured repository author is offered");
        check(std::find(entries.begin(), entries.end(), "Guest <guest@example.com>") != entries.end(),
              "the one-commit override from the case above is offered as well");
        check(std::count_if(entries.begin(), entries.end(),
                            [](const std::string& value) { return value.find("guest@example.com") != std::string::npos; }) == 1,
              "the same person with a differently cased e-mail is still one entry");
    });

    run("ahead_behind reports unavailable without an upstream", [&] {
        check(taocode::git::ahead_behind(root).at("available").get<bool>() == false, "no upstream configured");
    });

    run("blame annotates each committed line with author and short sha", [&] {
        const auto blamed = taocode::git::blame(root, "topic.txt");
        const auto& lines = blamed.at("lines");
        check(!lines.empty(), "blame produced lines");
        check(lines[0].at("line").get<int>() == 1, "blame lines are 1-based");
        check(lines[0].at("hash").get<std::string>().size() == 8, "blame reports the short sha");
        check(lines[0].at("author").get<std::string>() == "Test", "blame reports the commit author");
        // The annotation column also shows the commit date, and the tooltip needs the
        // mail + summary (IDEA's FileAnnotation); all three come out of --line-porcelain.
        const auto& date = lines[0].at("date").get<std::string>();
        check(date.size() == 10 && date[4] == '-' && date[7] == '-', "blame reports a YYYY-MM-DD date");
        check(lines[0].at("email").get<std::string>().find('@') != std::string::npos, "blame reports the author mail");
        check(!lines[0].at("summary").get<std::string>().empty(), "blame reports the commit summary");
    });

    run("tags list, create at a target and delete", [&] {
        check(taocode::git::tag_list(root).at("tags").empty(), "a fresh repo has no tags");
        taocode::git::tag_create(root, "v1.0", "");
        put(root / "tagged.txt", "tagged\n");
        git(root, L"add tagged.txt");
        git(root, L"commit -q -m tagged");
        taocode::git::tag_create(root, "v1.1", "HEAD");
        const auto tags = taocode::git::tag_list(root).at("tags");
        check(tags.size() == 2, "both tags are listed");
        check(tags[0].get<std::string>() == "v1.0" && tags[1].get<std::string>() == "v1.1", "tags keep order");
        taocode::git::tag_delete(root, "v1.0");
        check(taocode::git::tag_list(root).at("tags").size() == 1, "delete removes the tag");
        try {
            taocode::git::tag_create(root, "", "");
            check(false, "an empty tag name must be rejected");
        } catch (const taocode::WorkspaceError& error) {
            check(std::string(error.code) == "INVALID_REQUEST", "tag validation error code");
        }
    });

    run("cherry_pick applies a commit from another branch", [&] {
        const auto trunk = default_branch(root);
        git(root, L"checkout -q -b cherry-src");
        put(root / "cherry.txt", "picked\n");
        git(root, L"add cherry.txt");
        git(root, L"commit -q -m cherry-source");
        const auto hash = taocode::git::log(root, "cherry.txt", 1).at("commits")[0].at("hash").get<std::string>();
        git(root, L"checkout -q " + trunk);
        taocode::git::cherry_pick(root, hash);
        const auto picked = taocode::git::log(root, "cherry.txt", 1);
        check(picked.at("commits").size() == 1, "the cherry-picked file exists on this branch");
        git(root, L"branch -D cherry-src");
    });

    run("rebase replays commits on top of another branch", [&] {
        const auto trunk = default_branch(root);
        // 清场：把别处可能留下的改动收进一个提交，好让后面的 checkout / rebase 站在干净的树上。
        // 注释原话是 "no-op when clean"，但 `git commit` 在干净树上返回 1（nothing to commit），
        // 本文件的 `git()` 辅助函数把任何非零退出都当失败抛出来 ⇒ 之前它只有在"树上确实有脏东西"时
        // 才走得过去（一路靠上面用例漏下的 a.txt 蒙对）。先查 status，才让"clean 时什么都不做"成立。
        if (!taocode::git::status(root).empty()) {
            git(root, L"add -A");
            git(root, L"commit -q -m pre-rebase");
        }
        git(root, L"checkout -q -b rebase-base");
        put(root / "rebase.txt", "base\n");
        git(root, L"add rebase.txt");
        git(root, L"commit -q -m rebase-base");
        const auto base = taocode::git::log(root, "", 1).at("commits")[0].at("hash").get<std::string>();
        git(root, L"checkout -q " + trunk);
        put(root / "after.txt", "after\n");
        git(root, L"add after.txt");
        git(root, L"commit -q -m after-base");
        taocode::git::rebase(root, "rebase-base");
        const auto commits = taocode::git::log(root, "", 2).at("commits");
        check(commits.size() == 2, "two commits after the rebase");
        check(commits[1].at("hash").get<std::string>() == base, "the replayed commit sits on top of the base");
        git(root, L"branch -D rebase-base");
    });

    run("delete_branch removes a merged branch and refuses the current one", [&] {
        git(root, L"branch -q to-delete");
        taocode::git::delete_branch(root, "to-delete");
        const auto branches = taocode::git::branches(root);
        check(std::find(branches.begin(), branches.end(), "to-delete") == branches.end(), "branch is gone");
        const auto head = taocode::git::head(root);
        bool refused = false;
        try { taocode::git::delete_branch(root, head); }
        catch (const taocode::WorkspaceError&) { refused = true; }
        check(refused, "git refuses deleting the checked-out branch");
    });

    run("ignore_path appends once and only once", [&] {
        taocode::git::ignore_path(root, "build-output");
        taocode::git::ignore_path(root, "build-output");
        const auto ignored = read_text(root / ".gitignore");
        check(ignored == "build-output\n", "one line, no duplicate: got " + ignored);
        // The new entry takes effect: the ignored path no longer shows as untracked.
        put(root / "build-output", "x");
        for (const auto& change : taocode::git::status(root))
            check(change.path != "build-output", ".gitignore hides the entry");
    });

    run("revert discards working-tree changes but refuses untracked files", [&] {
        put(root / "revert-me.txt", "committed\n");
        git(root, L"add revert-me.txt");
        git(root, L"commit -q -m revert-base");
        put(root / "revert-me.txt", "changed\n");
        taocode::git::revert(root, "revert-me.txt");
        check(read_text(root / "revert-me.txt") == "committed\n", "rollback restores the committed content");
        // Untracked files have nothing to roll back to; IDEA hides the action and
        // the backend refuses rather than deleting the file.
        put(root / "fresh.txt", "new\n");
        bool refused = false;
        try { taocode::git::revert(root, "fresh.txt"); }
        catch (const taocode::WorkspaceError& error) { refused = error.code == std::string("INVALID_REQUEST"); }
        check(refused, "an untracked path must be refused, not deleted");
        check(read_text(root / "fresh.txt") == "new\n", "the untracked file survives");
    });

    run("reset moves HEAD with soft/mixed/hard semantics", [&] {
        put(root / "reset.txt", "v1\n");
        git(root, L"add reset.txt");
        git(root, L"commit -q -m reset-v1");
        const auto base = taocode::git::log(root, "reset.txt", 1).at("commits")[0].at("hash").get<std::string>();
        put(root / "reset.txt", "v2\n");
        git(root, L"add reset.txt");
        git(root, L"commit -q -m reset-v2");
        const auto tip = taocode::git::log(root, "reset.txt", 1).at("commits")[0].at("hash").get<std::string>();
        check(base != tip, "two distinct commits exist");

        // hard: the working tree goes back to v1 and the commit is gone.
        const auto hard = taocode::git::reset(root, base, "hard");
        check(hard.at("mode").get<std::string>() == "hard", "reset reports the mode");
        check(read_text(root / "reset.txt") == "v1\n", "hard reset restores the old content");
        bool tip_gone = true;
        for (const auto& entry : taocode::git::log(root, "reset.txt", 5).at("commits"))
            if (entry.at("hash").get<std::string>() == tip) tip_gone = false;
        check(tip_gone, "hard reset removes the tip commit from history");

        // soft: HEAD moves but the changes stay staged.
        put(root / "reset.txt", "v2\n");
        git(root, L"add reset.txt");
        git(root, L"commit -q -m reset-v2-again");
        put(root / "reset.txt", "v3\n");
        git(root, L"add reset.txt");
        const auto soft = taocode::git::reset(root, "HEAD~1", "soft");
        check(soft.at("mode").get<std::string>() == "soft", "soft reports its mode");
        bool staged_after_soft = false;
        for (const auto& change : taocode::git::status(root))
            if (change.path == "reset.txt" && change.staged) staged_after_soft = true;
        check(staged_after_soft, "soft keeps the changes staged");
        taocode::git::reset(root, "HEAD", "hard");  // settle back to a clean tree
    });

    run("hunks split, stage partially and unstage partially", [&] {
        put(root / "hunks.txt", "one\n");
        git(root, L"add hunks.txt");
        git(root, L"commit -q -m hunks-base");
        put(root / "hunks.txt", "one\nTWO\n");
        const auto parts = taocode::git::diff_hunks(root, "hunks.txt", false);
        const auto& hunks = parts.at("hunks");
        check(hunks.size() == 1, "a single added line is one hunk");
        check(hunks[0].at("additions").get<int>() == 1, "the hunk counts one addition");
        taocode::git::apply_hunks(root, "hunks.txt", false, {0}, false);
        bool staged_seen = false;
        for (const auto& change : taocode::git::status(root))
            if (change.path == "hunks.txt" && change.staged) staged_seen = true;
        check(staged_seen, "the selected hunk moved to the index");
        const auto staged_parts = taocode::git::diff_hunks(root, "hunks.txt", true);
        check(staged_parts.at("hunks").size() == 1, "the staged side has the hunk");
        taocode::git::apply_hunks(root, "hunks.txt", true, {0}, true);
        bool still_staged = false;
        for (const auto& change : taocode::git::status(root))
            if (change.path == "hunks.txt" && change.staged) still_staged = true;
        check(!still_staged, "the reverse apply unstaged the hunk");
        try {
            taocode::git::apply_hunks(root, "hunks.txt", false, {99}, false);
            check(false, "an out-of-range hunk index must be rejected");
        } catch (const taocode::WorkspaceError& error) {
            check(std::string(error.code) == "INVALID_REQUEST", "hunk range validation error code");
        }
    });

    // 两个临时仓库都要收掉：`scope` 是这一族（部分提交）自己建的，带进程号，不留给下一次跑测。
    fs::remove_all(scope, ec);
    fs::remove_all(root, ec);
    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
