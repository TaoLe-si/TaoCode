// Offline self-test for the Local History engine: exercises the on-disk store in a
// throwaway directory and verifies version listing (newest first, deduped), exact
// snapshot round-trips with SHA-256 fingerprints, unified diffs, the per-file version
// cap, independent timelines per path, UTF-8 byte fidelity and reopen persistence.
#include "history.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::WorkspaceError;
using taocode::history::History;
using taocode::history::unified_diff;
using taocode::history::diff_sides;
using taocode::history::diff_sides_from_unified;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

// list() 的契约形状：{entries:[...]}，新→旧。
std::vector<Json> entries(const History& history, const std::string& path) {
    const auto result = history.list(path);
    check(result.contains("entries") && result.at("entries").is_array(), "list must return an entries array");
    return std::vector<Json>(result.at("entries").begin(), result.at("entries").end());
}

std::string newest_id(const History& history, const std::string& path) {
    const auto list = entries(history, path);
    check(!list.empty(), path + " should have at least one version");
    return list.front().at("id").get<std::string>();
}

std::string text(const History& history, const std::string& path, const std::string& id) {
    return history.content(path, id).at("content").get<std::string>();
}

std::size_t count_files(const fs::path& directory) {
    std::size_t total = 0;
    for (const auto& item : fs::recursive_directory_iterator(directory))
        if (item.is_regular_file()) ++total;
    return total;
}

bool has_line(const std::string& diff, const std::string& marker) {
    std::size_t start = 0;
    for (;;) {
        const auto end = diff.find('\n', start);
        const auto line = diff.substr(start, end == std::string::npos ? std::string::npos : end - start);
        if (line == marker) return true;
        if (end == std::string::npos) return false;
        start = end + 1;
    }
}

void expects_code(History& history, const std::string& path, const std::string& content,
                  const char* code) {
    try {
        history.record(path, content, "save");
    } catch (const WorkspaceError& error) {
        check(error.code == code, std::string("expected ") + code + ", got " + error.code +
              " — " + error.what());
        return;
    }
    check(false, std::string("expected ") + code + ", but record() succeeded");
}
}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    const auto store = fs::temp_directory_path() /
                       ("taocode-history-test-" + std::to_string(GetCurrentProcessId()));
    std::error_code ec;
    fs::remove_all(store, ec);
    fs::create_directories(store);
    History history{store / "project-a"};
    const std::string file = "src/demo.txt";
    const std::string v1 = "alpha\nbeta\ndelta\n";
    const std::string v2 = "alpha\nbeta\ndelta\nepsilon\n";
    const std::string v3 = "alpha\ngamma\ndelta\n";

    run("three saves list newest first and a repeated save is a no-op", [&] {
        history.record(file, v1, "save");
        history.record(file, v2, "save");
        history.record(file, v3, "revert");
        auto list = entries(history, file);
        check(list.size() == 3, "expected 3 versions, got " + std::to_string(list.size()));
        check(text(history, file, list.at(0).at("id").get<std::string>()) == v3, "newest must be v3");
        check(text(history, file, list.at(1).at("id").get<std::string>()) == v2, "second newest must be v2");
        check(text(history, file, list.at(2).at("id").get<std::string>()) == v1, "oldest must be v1");
        check(list.at(0).at("reason").get<std::string>() == "revert", "newest reason should be revert");
        check(list.at(2).at("reason").get<std::string>() == "save", "oldest reason should be save");
        check(list.at(0).at("bytes").get<std::size_t>() == v3.size(), "bytes reports the snapshot size");
        check(list.at(0).at("timeMillis").get<long long>() > 1600000000000LL, "timeMillis is epoch milliseconds");
        const auto shown = list.at(0).at("time").get<std::string>();
        check(shown.size() == 24 && shown.back() == 'Z' && shown[10] == 'T',
              "time is an ISO-8601 UTC string, got " + shown);
        check(list.at(0).at("id").get<std::string>() != list.at(1).at("id").get<std::string>(),
              "ids are unique");
        for (std::size_t index = 1; index < list.size(); ++index)
            check(list.at(index - 1).at("timeMillis").get<long long>() >=
                      list.at(index).at("timeMillis").get<long long>(),
                  "the list must be newest first");
        history.record(file, v3, "save");  // 同一内容：不得新增版本
        check(entries(history, file).size() == 3, "a no-op save must not add a version, got " +
                  std::to_string(entries(history, file).size()));
        history.record(file, v1, "external");  // 回退到旧内容仍是新版本
        const auto after = entries(history, file);
        check(after.size() == 4, "reverting to older content records a new version");
        check(after.front().at("reason").get<std::string>() == "external", "the reason round-trips");
        check(text(history, file, after.front().at("id").get<std::string>()) == v1, "the newest is v1 again");
    });

    run("content returns each exact prior text with a real SHA-256 fingerprint", [&] {
        // NIST 已知向量 sha256("abc")：证明 version 就是标准 SHA-256 十六进制。
        history.record("hash.txt", "abc", "save");
        const auto hash = history.content("hash.txt", newest_id(history, "hash.txt"));
        check(hash.at("version").get<std::string>() ==
                  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
              "version must be the SHA-256 hex of the snapshot bytes, got " + hash.at("version").get<std::string>());
        check(hash.at("content").get<std::string>() == "abc", "content round-trips");
        // 独立时间线，确定性地验证「最新在前」与逐字节回读。
        const std::string dupe = "dupe.txt";
        history.record(dupe, "A\n", "save");
        history.record(dupe, "B\n", "save");
        history.record(dupe, "A\n", "save");  // 回到旧内容：与最新 B 不同，记为新版本
        const auto list = entries(history, dupe);
        check(list.size() == 3, "A,B,A keeps three versions, got " + std::to_string(list.size()));
        const std::vector<std::string> expected{"A\n", "B\n", "A\n"};  // newest first
        for (std::size_t index = 0; index < list.size(); ++index) {
            const auto id = list.at(index).at("id").get<std::string>();
            check(history.content(dupe, id).at("content").get<std::string>() == expected[index],
                  "version " + id + " is byte-exact");
            check(history.content(dupe, id).at("version").get<std::string>().size() == 64,
                  "a fingerprint is 64 hex chars");
        }
        check(list.at(0).at("id").get<std::string>() != list.at(2).at("id").get<std::string>(),
              "two snapshots of the same text stay distinct versions");
    });

    run("diff renders -/+ lines with an @@ hunk header", [&] {
        const auto list = entries(history, file);
        std::string oldest;  // 最旧的 v1（列表末尾方向）
        for (const auto& entry : list) {
            const auto id = entry.at("id").get<std::string>();
            if (text(history, file, id) == v1) oldest = id;
        }
        check(!oldest.empty(), "v1 must still be reachable");
        const auto diff = history.diff(file, oldest, v3).at("diff").get<std::string>();
        check(diff.find("@@") != std::string::npos, "a hunk header is required, got:\n" + diff);
        check(has_line(diff, "-beta"), "beta must be reported as removed");
        check(has_line(diff, "+gamma"), "gamma must be reported as added");
        check(has_line(diff, " alpha"), "unchanged lines stay as context");
        check(has_line(diff, " delta"), "trailing context is preserved");
        const auto same = history.diff(file, oldest, v1).at("diff").get<std::string>();
        check(same.find("@@") == std::string::npos, "identical content produces no hunk");
        bool threw = false;
        try { history.diff(file, "1234567890-0", v3); }
        catch (const WorkspaceError& error) { threw = error.code == "NOT_FOUND"; }
        check(threw, "an unknown id must surface as NOT_FOUND");
    });

    run("the store clamps to max_versions_per_file and drops the oldest snapshots", [&] {
        History capped{store / "project-cap"};
        const std::string noisy = "notes/noisy.txt";
        for (int index = 0; index < 60; ++index)
            capped.record(noisy, "line " + std::to_string(index) + "\n", "save");
        const auto list = entries(capped, noisy);
        check(list.size() == capped.max_versions_per_file(),
              "expected the cap " + std::to_string(capped.max_versions_per_file()) +
              ", got " + std::to_string(list.size()));
        check(capped.max_versions_per_file() == History::default_max_versions_per_file,
              "the default cap is 50 versions per file");
        check(text(capped, noisy, list.front().at("id").get<std::string>()) == "line 59\n",
              "the newest version survives");
        check(text(capped, noisy, list.back().at("id").get<std::string>()) == "line 10\n",
              "the ten oldest versions are gone");
        // 上限是真的删了盘上的快照，不是只在列表里藏起来。
        check(count_files(store / "project-cap") == capped.max_versions_per_file() + 1,
              "on disk: 50 snapshots plus one index.json");
        History reopened{store / "project-cap"};
        check(reopened.list(noisy).at("entries").size() == capped.max_versions_per_file(),
              "a fresh History over the same store sees the same clamped timeline");
        check(text(reopened, noisy, newest_id(reopened, noisy)) == "line 59\n",
              "and can read the newest snapshot back");
        reopened.record(noisy, "line 59\n", "save");  // 跨实例去重依然生效
        check(reopened.list(noisy).at("entries").size() == capped.max_versions_per_file(),
              "a duplicate save through a new instance is still a no-op");
    });

    run("each relative path keeps an independent timeline", [&] {
        History other{store / "project-b"};
        other.record("docs/a.md", "left one\n", "save");
        other.record("docs/a.md", "left two\n", "save");
        other.record("docs/b.md", "right one\n", "save");
        check(entries(other, "docs/a.md").size() == 2, "a.md has two versions");
        check(entries(other, "docs/b.md").size() == 1, "b.md has one version");
        check(text(other, "docs/a.md", newest_id(other, "docs/a.md")) == "left two\n", "a.md newest");
        check(text(other, "docs/b.md", newest_id(other, "docs/b.md")) == "right one\n", "b.md newest");
        check(other.list("docs/c.md").at("entries").empty(), "an untouched path lists nothing");
        // 大小写不同的同一 NTFS 路径必须落到同一条时间线，而不是各存一份。
        other.record("docs/A.MD", "left three\n", "save");
        check(entries(other, "docs/a.md").size() == 3, "case-insensitive paths share one timeline");
        check(text(other, "docs/a.md", newest_id(other, "docs/a.md")) == "left three\n",
              "the newest version is visible either way");
        check(entries(history, "docs/a.md").empty(), "a second store root is fully isolated");
        // 同名的不同目录也是不同时间线。
        other.record("src/a.md", "unrelated\n", "save");
        check(entries(other, "src/a.md").size() == 1, "src/a.md is its own timeline");
        check(entries(other, "docs/a.md").size() == 3, "and does not touch docs/a.md");
    });

    run("UTF-8 content round-trips byte-exact", [&] {
        const std::string cjk = "标题\n汉字 alpha 字\n日本語 🎉 emoji\n";
        const std::string path = "中文/文件.txt";
        history.record(path, cjk, "save");
        const auto id = newest_id(history, path);
        const auto back = history.content(path, id).at("content").get<std::string>();
        check(back.size() == cjk.size(), "byte length must match, got " + std::to_string(back.size()));
        check(back == cjk, "UTF-8 text must round-trip unchanged");
        history.record("crlf.txt", "alpha\r\nbeta\r\n", "save");
        check(text(history, "crlf.txt", newest_id(history, "crlf.txt")) == "alpha\r\nbeta\r\n",
              "CRLF bytes are stored verbatim");
        const auto diff = history.diff(path, id, "标题\n汉字 changed 字\n日本語 🎉 emoji\n替换\n")
                              .at("diff").get<std::string>();
        check(diff.find("@@") != std::string::npos, "CJK diffs still get hunk headers");
        check(has_line(diff, "+汉字 changed 字"), "the changed CJK line appears in the diff");
        check(diff.find("标题") != std::string::npos, "unchanged CJK lines remain context");
        const auto crlf = history.diff("crlf.txt", newest_id(history, "crlf.txt"), "alpha\r\nBETA\r\n")
                                 .at("diff").get<std::string>();
        check(crlf.find('\r') == std::string::npos, "the diff view normalises CRLF for readability");
        check(has_line(crlf, "-beta") && has_line(crlf, "+BETA"), "CRLF content still diffs line-wise");
    });

    run("invalid content and paths are rejected, unknown ids report NOT_FOUND", [&] {
        expects_code(history, "bad.txt", std::string("nul\0byte", 8), "BINARY_FILE");
        expects_code(history, "bad.txt", std::string("\xFF\xFE not utf8", 11), "INVALID_UTF8");
        expects_code(history, "C:/windows/system32/cmd.exe", "x", "INVALID_PATH");
        expects_code(history, "../escape.txt", "x", "INVALID_PATH");
        expects_code(history, "", "x", "INVALID_PATH");
        expects_code(history, "a/../b.txt", "x", "INVALID_PATH");
        history.record("ok.txt", "fine\n", "save");
        check(entries(history, "ok.txt").size() == 1, "a normal path is accepted");
        check(entries(history, "./ok.txt").size() == 1, "'.' components normalise away");
        bool threw = false;
        try { history.content("ok.txt", "..\\evil"); }
        catch (const WorkspaceError& error) { threw = error.code == "NOT_FOUND"; }
        check(threw, "a malformed id must be NOT_FOUND, never a path traversal");
        threw = false;
        try { history.content("missing/deep.txt", "1234567890-0"); }
        catch (const WorkspaceError& error) { threw = error.code == "NOT_FOUND"; }
        check(threw, "an untracked path has no versions at all");
    });

    run("unified_diff is a pure line diff with three context lines", [&] {
        check(unified_diff("", "").empty(), "no content, no hunk");
        check(unified_diff("same\n", "same\n").empty(), "identical text produces no hunk");
        std::string before;
        std::string after;
        for (int index = 1; index <= 10; ++index) before += "l" + std::to_string(index) + "\n";
        for (int index = 1; index <= 10; ++index) after += (index == 5 ? "X" : "l" + std::to_string(index)) + "\n";
        const auto diff = unified_diff(before, after);
        check(diff == "@@ -2,7 +2,7 @@\n l2\n l3\n l4\n-l5\n+X\n l6\n l7\n l8\n",
              "expected exactly three context lines around one change, got:\n" + diff);
        check(unified_diff("a\n", "") == "@@ -1,1 +0,0 @@\n-a\n", "a pure deletion reports -1,1 +0,0");
        check(unified_diff("", "b\n") == "@@ -0,0 +1,1 @@\n+b\n", "a pure insertion reports -0,0 +1,1");
        const auto tail = unified_diff("head\nxxx\n", "head\nyyy\n");
        check(has_line(tail, "-xxx") && has_line(tail, "+yyy"), "a trimmed common prefix keeps the hunk honest");
        // 多处改动应产生多个块，且互不重叠。
        std::string long_a;
        std::string long_b;
        for (int index = 1; index <= 30; ++index) {
            long_a += "line " + std::to_string(index) + "\n";
            long_b += "line " + std::to_string(index) + (index == 3 || index == 25 ? "!" : "") + "\n";
        }
        int hunks = 0;
        const auto whole = unified_diff(long_a, long_b);
        // Count hunk headers by their leading "@@ -" (the trailing " @@" would
        // otherwise be counted a second time per hunk).
        for (std::size_t at = 0; (at = whole.find("@@ -", at)) != std::string::npos; at += 4)
            ++hunks;
        check(hunks == 2, "two distant changes render as two hunks, got " + std::to_string(hunks));
    });

    run("diff_sides_from_unified reads git's own diff format", [&] {
        const auto parsed = diff_sides_from_unified(
            "diff --git a/a.txt b/a.txt\n"
            "index ce01362..3b18e51 100644\n"
            "--- a/a.txt\n"
            "+++ b/a.txt\n"
            "@@ -1 +1 @@\n"
            "-hello\n"
            "+hello world\n");
        const auto& rows = parsed.at("rows");
        check(rows.size() == 1 && rows[0].at("kind") == "change" && rows[0].at("left").at("no") == 1 &&
                  rows[0].at("right").at("no") == 1,
              "headers are skipped and the hunk cursor is read: " + rows.dump());

        // Context, a second hunk, and the "\ No newline" marker.
        const auto two = diff_sides_from_unified(
            "--- a\n+++ b\n@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+added\n\\ No newline at end of file\n"
            "@@ -10,1 +11,1 @@\n-x\n+y\n");
        const auto& pairs = two.at("rows");
        check(pairs.size() == 4, "equal, change, insert, change, got " + pairs.dump());
        check(pairs[0].at("kind") == "equal" && pairs[0].at("left").at("no") == 1, "context row keeps both numbers");
        check(pairs[1].at("kind") == "change" && pairs[2].at("kind") == "insert" &&
                  !pairs[2].contains("left"), "an unpaired addition is an insert row: " + pairs.dump());
        check(pairs[3].at("left").at("no") == 10 && pairs[3].at("right").at("no") == 11,
              "the second hunk header re-seeds both cursors");
        check(diff_sides_from_unified("").at("rows").empty(), "no text, no rows");
    });

    run("diff_sides pairs edits into aligned rows with word marks", [&] {
        const auto equal = diff_sides("", "");
        check(equal.at("rows").empty() && equal.at("truncated") == false, "identical empty text has no rows");
        const auto same = diff_sides("a\nb\n", "a\nb\n");
        check(same.at("rows").size() == 2, "two equal rows, got " + std::to_string(same.at("rows").size()));
        check(same.at("rows")[0].at("kind") == "equal" && same.at("rows")[0].at("left").at("no") == 1 &&
                  same.at("rows")[0].at("right").at("no") == 1, "equal rows carry both 1-based numbers");

        const auto inserted = diff_sides("a\nc\n", "a\nb\nc\n");
        const auto& rows = inserted.at("rows");
        check(rows.size() == 3, "equal, insert, equal, got " + std::to_string(rows.size()));
        check(rows[1].at("kind") == "insert" && !rows[1].contains("left"), "a lone insertion has no left cell");
        check(rows[1].at("right").at("no") == 2 && rows[1].at("right").at("text") == "b", "insertion numbering");
        check(rows[2].at("left").at("no") == 2 && rows[2].at("right").at("no") == 3,
              "the row after an insertion shifts only the right number");

        const auto removed = diff_sides("a\nb\nc\n", "a\nc\n");
        check(removed.at("rows")[1].at("kind") == "delete" && !removed.at("rows")[1].contains("right"),
              "a lone deletion has no right cell");

        const auto changed = diff_sides("int value = 1;\n", "int value = 42;\n");
        const auto& row = changed.at("rows")[0];
        check(row.at("kind") == "change", "one delete plus one add become a change row");
        check(row.at("leftMarks").size() == 1 && row.at("rightMarks").size() == 1,
              "exactly one differing word on each side: " + row.dump());
        const auto left = row.at("leftMarks")[0];
        const auto right = row.at("rightMarks")[0];
        check(row.at("left").at("text").get<std::string>().substr(left[0].get<std::size_t>(), left[1].get<std::size_t>()) == "1",
              "the left mark covers the old number");
        check(row.at("right").at("text").get<std::string>().substr(right[0].get<std::size_t>(), right[1].get<std::size_t>()) == "42",
              "the right mark covers the new number");

        // Adjacent differing tokens merge into one range instead of one per token.
        const auto merged = diff_sides("x = alpha_beta + 1;\n", "x = gamma_delta + 2;\n");
        check(merged.at("rows")[0].at("rightMarks").size() == 2,
              "two separated word groups, not four tokens: " + merged.at("rows")[0].dump());

        // A huge rewrite stays bounded and reports truncation.
        std::string big_a, big_b;
        for (int index = 0; index < 25000; ++index) { big_a += "line " + std::to_string(index) + "\n"; big_b += "other " + std::to_string(index) + "\n"; }
        const auto big = diff_sides(big_a, big_b);
        check(big.at("truncated") == true, "a huge rewrite reports truncation instead of growing forever");
        check(big.at("rows").size() <= 20000, "the row count stays at the cap, got " + std::to_string(big.at("rows").size()));
    });

    run("side_diff aligns a snapshot against the current buffer", [&] {
        History store_history(store, 10);
        store_history.record("side.txt", "one\ntwo\nthree\n", "save");
        const auto entries = store_history.list("side.txt").at("entries");
        check(entries.size() == 1, "one snapshot recorded");
        const auto id = entries[0].at("id").get<std::string>();
        const auto result = store_history.side_diff("side.txt", id, "one\n2\nthree\nextra\n");
        const auto& rows = result.at("rows");
        check(rows.size() == 4, "equal, change, equal, insert, got " + rows.dump());
        check(rows[0].at("kind") == "equal" && rows[1].at("kind") == "change" &&
                  rows[2].at("kind") == "equal" && rows[3].at("kind") == "insert", "row kinds");
        check(rows[2].at("left").at("no") == 3 && rows[2].at("right").at("no") == 3,
              "a trailing insertion must not shift the context numbering");
        check(result.at("header").get<std::string>().find(id.substr(0, 8)) != std::string::npos,
              "the header names the snapshot id: " + result.at("header").get<std::string>());
        bool missing = false;
        try { store_history.side_diff("side.txt", "deadbeef", "anything\n"); }
        catch (const WorkspaceError& error) { missing = error.code == "NOT_FOUND"; }
        check(missing, "an unknown snapshot id is NOT_FOUND, not an empty diff");
    });

    fs::remove_all(store, ec);
    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
