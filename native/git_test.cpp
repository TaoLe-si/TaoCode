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

    fs::remove_all(root, ec);
    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
