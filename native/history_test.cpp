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
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::WorkspaceError;
using taocode::history::History;
using taocode::history::first_obsolete_index;
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

// 把某个项目库里 index.json 的时间戳整体往回推，用来伪造「存活了多久」——快照文件名取自 id、
// 与 millis 无关，所以只改 millis 不会让任何孤儿出现（drop_orphans 仍然全认得）。
// newest 保持它原来的时间戳（引擎以最新一条为基准，见 first_obsolete_index），往旧每条退 step。
void backdate_index(const fs::path& project_root, long long step_millis) {
    bool touched = false;
    for (const auto& item : fs::recursive_directory_iterator(project_root)) {
        if (!item.is_regular_file() || item.path().filename() != L"index.json") continue;
        std::ifstream in(item.path(), std::ios::binary);
        const std::string raw{std::istreambuf_iterator<char>{in}, std::istreambuf_iterator<char>{}};
        Json parsed = Json::parse(raw, nullptr, false);
        if (parsed.is_discarded() || !parsed.contains("versions") || !parsed.at("versions").is_array())
            throw std::runtime_error("backdate_index: index.json 读不出 versions");
        auto& versions = parsed["versions"];
        const long long newest = versions.front().at("millis").get<long long>();
        for (std::size_t index = 0; index < versions.size(); ++index)
            versions[index]["millis"] = newest - static_cast<long long>(index) * step_millis;
        std::ofstream out(item.path(), std::ios::binary | std::ios::trunc);
        out << parsed.dump(1);
        touched = true;
    }
    if (!touched) throw std::runtime_error("backdate_index: 库里没有 index.json");
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

    run("first_obsolete_index：间隔 <12h 累加真实毫秒，累计达标那条起过期", [&] {
        // period=1000、interval=100，delta 全是 50（<interval）⇒ length 到第 i 条为 50*i。
        // 50*20=1000 首次 >=period ⇒ 下标 20 起（连同更旧的）过期。
        std::vector<long long> stamps;
        for (std::size_t index = 0; index < 30; ++index)
            stamps.push_back(1000000LL - static_cast<long long>(index) * 50LL);
        const auto obsolete = first_obsolete_index(stamps, 1000, 100);
        check(obsolete == 20, "50ms x20 恰好累到 period，期望下标 20，实得 " + std::to_string(obsolete));
    });

    run("first_obsolete_index：>=12h 的空档只累加 1（字面量），跨度再长也不过期", [&] {
        // 同样是 30 条、真实跨度 5800ms 远超 period=1000，但每条 delta=200 >= interval=100
        // ⇒ 按上游 :321 的 else 分支只 +1，累计 29 < 1000 ⇒ 一条都不该过期。
        // 这条判据专杀「拿墙钟差算天数」的写法：按墙钟这里早该全清了。
        std::vector<long long> stamps;
        for (std::size_t index = 0; index < 30; ++index)
            stamps.push_back(1000000LL - static_cast<long long>(index) * 200LL);
        const auto obsolete = first_obsolete_index(stamps, 1000, 100);
        check(obsolete == stamps.size(),
              "空档全 >=interval 时没有任何一条过期，实得下标 " + std::to_string(obsolete));
    });

    run("first_obsolete_index 的边界是 >= 不是 >；基准是最新一条而不是墙钟", [&] {
        std::vector<long long> exact{4000, 3750, 3500, 3250, 3000, 2750};  // delta 250，interval 1000 内
        // length 到第 4 条正好 = 1000：用 >= 切在下标 4，用 > 会切在下标 5。
        check(first_obsolete_index(exact, 1000, 1000) == 4,
              "length 恰等于 period 的那条就切（>=）：期望 4，实得 " +
                  std::to_string(first_obsolete_index(exact, 1000, 1000)));
        check(first_obsolete_index(exact, 1001, 1000) == 5,
              "period 多 1 毫秒就晚一条才切（证明算术是累加 delta，不是取整天数）");
        // 单条：最新一条自身 delta 记 0（:315），所以绝不能把自己判过期。
        check(first_obsolete_index({500}, 1, 1) == 1, "只有一条历史时不许自我清空");
        check(first_obsolete_index({}, 1000, 100) == 0, "空历史返回 0，等价于没有任何过期项");
    });

    run("按天过期真的落盘：days_to_keep=1 时 6h 一档的历史被切到 5 条", [&] {
        const auto root = store / "project-expire";
        History aged{root, History::default_max_versions_per_file, 1};  // period = 24h
        check(aged.days_to_keep() == 1, "构造参数必须真的带上");
        const std::string path = "aging/old.txt";
        for (int index = 0; index < 6; ++index)
            aged.record(path, "line " + std::to_string(index) + "\n", "save");
        check(entries(aged, path).size() == 6, "回填前 6 条都在");
        // 往回造时间：新→旧每条比前一条早 6h（<12h ⇒ 按真实毫秒累计）。
        backdate_index(root, 6LL * 60LL * 60LL * 1000LL);
        aged.record(path, "line 6\n", "save");  // 这一次活动触发裁剪
        const auto list = entries(aged, path);
        // 新那条 delta≈0，随后每条 +6h：6h*4=24h 才达标 ⇒ 下标 5 起过期 ⇒ 留 5 条。
        check(list.size() == 5, "期望按天过期后留 5 条，实得 " + std::to_string(list.size()));
        check(count_files(root) == 5 + 1, "过期快照是从盘上删掉的，不是在列表里藏起来：5 张 + 1 份索引");
        check(text(aged, path, list.front().at("id").get<std::string>()) == "line 6\n", "最新一条留下");
        check(text(aged, path, list.back().at("id").get<std::string>()) == "line 2\n",
              "切掉的是最旧的「line 0/line 1」，边界落在刚好满一天的那条");
    });

    run("空档 >=12h 不计龄：同样 days_to_keep=1，跨夜 39 小时的历史一条不删（上游那条 else 1）", [&] {
        const auto root = store / "project-idle";
        History aged{root, History::default_max_versions_per_file, 1};
        const std::string path = "idle/old.txt";
        for (int index = 0; index < 4; ++index)
            aged.record(path, "line " + std::to_string(index) + "\n", "save");
        backdate_index(root, 13LL * 60LL * 60LL * 1000LL);  // 每条相隔 13h，真实跨度 39h > 24h
        aged.record(path, "line 4\n", "save");
        const auto list = entries(aged, path);
        // 按墙钟早该清空；按上游口径每条只 +1 ⇒ 一条都不许删。
        check(list.size() == 5, "跨夜空档不计龄，期望 5 条全留，实得 " + std::to_string(list.size()));
        check(count_files(root) == 5 + 1, "盘上也一条没少");
    });

    run("同一份 6h 一档的历史在默认 5 天下不过期（对照组，证明删与不删是天数决定的）", [&] {
        const auto root = store / "project-keep";
        History aged{root};
        check(History::default_days_to_keep == 5, "上游默认 5 天写在模块里（xml:133 / ChangeListImpl.kt:20）");
        check(aged.days_to_keep() == History::default_days_to_keep, "不传就是 5 天");
        const std::string path = "aging/old.txt";
        for (int index = 0; index < 6; ++index)
            aged.record(path, "line " + std::to_string(index) + "\n", "save");
        backdate_index(root, 6LL * 60LL * 60LL * 1000LL);
        aged.record(path, "line 6\n", "save");
        check(entries(aged, path).size() == 7,
              "5 天 = 432000000ms，活动时长才 36h，什么都不该删，实得 " +
                  std::to_string(entries(aged, path).size()));
        // 缺值/传 0 一律回落上游默认，绝不判整份设置损坏。
        check(History{root.parent_path() / "project-zero", 50, 0}.days_to_keep() == 5,
              "days_to_keep=0 回落上游默认 5，不是报错也不是 0 天全清");
        check(History{root.parent_path() / "project-neg", 50, -3}.days_to_keep() == 5,
              "负数同样回落默认");
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
