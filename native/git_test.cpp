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

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

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

void git(const fs::path& repo, const std::wstring& args) {
    const auto code = _wsystem((L"git -C \"" + repo.native() + L"\" " + args + L" >NUL 2>NUL").c_str());
    if (code != 0) throw std::runtime_error("git " + text(args) + " failed");
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
    });

    run("checkout creates and switches a branch", [&] {
        git(root, L"checkout -q -b feature");
        check(taocode::git::head(root) == "feature", "head should be feature after checkout -b");
        const auto branches = taocode::git::branches(root);
        bool has_feature = false;
        for (const auto& name : branches) if (name == "feature") has_feature = true;
        check(has_feature, "branches should include feature");
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
    });

    fs::remove_all(root, ec);
    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
