// Integration test for the Find-in-Files engine against a small temp workspace:
// verifies literal/regex search, case and whole-word modes, glob filters,
// 1-based line/column with UTF-8 code-point alignment, binary + excluded-dir
// skipping, and in-place replacement.
#include "search.hpp"

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
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::search::Options;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

void put(const fs::path& path, const std::string& bytes) {
    fs::create_directories(path.parent_path());
    std::ofstream file(path, std::ios::binary | std::ios::trunc);
    file.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
}

std::string grab(const fs::path& path) {
    std::ifstream file(path, std::ios::binary);
    return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}

const taocode::Json* find(const taocode::Json& result, const std::string& path, int line) {
    for (const auto& item : result.at("matches"))
        if (item.at("path").get<std::string>() == path && item.at("line").get<int>() == line)
            return &item;
    return nullptr;
}
}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    const auto root = fs::temp_directory_path() / ("taocode-search-test-" + std::to_string(GetCurrentProcessId()));
    std::error_code ec;
    fs::remove_all(root, ec);
    fs::create_directories(root);
    // A tree with plain text, nested text, a symlink-avoiding excluded dir, a
    // version-control dir and a binary file, all seeded with the token "alpha".
    put(root / "note.txt", "alpha\nbeta alpha\nbetabox\n");
    put(root / "deep" / "inner.txt", "x alpha y\n");
    put(root / "cjk.txt", "\xE6\xB1\x89\xE5\xAD\x97 alpha \xE5\xAD\x97\n");  // 汉字 alpha 字
    put(root / "node_modules" / "lib.txt", "alpha node_modules\n");
    put(root / ".git" / "cfg.txt", "alpha git\n");
    put(root / "data.bin", std::string("\x00""alpha\x00""", 7));

    auto literal = [](std::string query) { Options o; o.query = std::move(query); o.case_sensitive = true; return o; };

    run("literal search reports 1-based line/column across files", [&] {
        const auto result = taocode::search::run(root, literal("alpha"));
        check(result.at("fileCount").get<int>() == 3, "expected note, deep/inner and cjk to match, got " + std::to_string(result.at("fileCount").get<int>()));
        check(result.at("truncated").get<bool>() == false, "should not be truncated");
        check(result.at("matches").size() == 4, "expected 4 alpha hits, got " + std::to_string(result.at("matches").size()));
        const auto* first = find(result, "note.txt", 1);
        check(first && first->at("column").get<int>() == 1 && first->at("length").get<int>() == 5, "note.txt line1 alpha at col1 len5");
        check(first && first->at("preview").get<std::string>() == "alpha", "preview should be the whole line");
        const auto* second = find(result, "note.txt", 2);
        check(second && second->at("column").get<int>() == 6, "beta ALPHA -> alpha at col6");
    });

    run("UTF-8 columns count code points, not bytes", [&] {
        const auto result = taocode::search::run(root, literal("alpha"));
        const auto* cjk = find(result, "cjk.txt", 1);
        // "汉字 alpha" — JS slices the preview with UTF-16 indices; col must be 4.
        check(cjk && cjk->at("column").get<int>() == 4, "two CJK chars + space put alpha at col4");
    });

    run("excluded directories and binary files are never searched", [&] {
        const auto result = taocode::search::run(root, literal("alpha"));
        for (const auto& item : result.at("matches")) {
            const auto path = item.at("path").get<std::string>();
            check(path.find("node_modules") == std::string::npos, "must not search node_modules");
            check(path.find(".git") == std::string::npos, "must not search .git");
            check(path.find(".bin") == std::string::npos, "must not search binary files");
        }
    });

    run("whole-word mode rejects embedded matches", [&] {
        auto options = literal("beta");
        const auto loose = taocode::search::run(root, options);
        check(loose.at("matches").size() == 2, "beta appears in 'beta alpha' and 'betabox'");
        options.whole_word = true;
        const auto strict = taocode::search::run(root, options);
        check(strict.at("matches").size() == 1, "whole-word beta should skip betabox");
        check(strict.at("matches")[0].at("preview").get<std::string>() == "beta alpha", "only the standalone beta remains");
    });

    run("case-insensitive search matches GAMMA", [&] {
        put(root / "case.txt", "GAMMA gamma\n");
        Options upper; upper.query = "gamma"; upper.case_sensitive = true;
        check(taocode::search::run(root, upper).at("matches").size() == 1, "case-sensitive gamma finds one");
        Options any; any.query = "gamma"; any.case_sensitive = false;
        check(taocode::search::run(root, any).at("matches").size() == 2, "case-insensitive gamma finds two");
        fs::remove(root / "case.txt", ec);
    });

    // 分块发布（上游 `SearchResults` 的 chunk 流）：`preview()` 一边扫一边把攒够的那几块交出来，
    // 块加起来必须**等于**一次性结果，否则"边搜边看"看到的和最终结果对不上。
    run("preview publishes chunks that add up to the full result", [&] {
        Options options = literal("alpha");
        options.chunk_max_matches = 1;  // 每条一块，验证切块本身而不是时间预算
        options.chunk_budget_ms = 0;
        std::vector<taocode::Json> chunks;
        std::size_t last_files = 0;
        options.on_chunk = [&](const taocode::Json& matches, std::size_t files) {
            chunks.push_back(matches);
            last_files = files;
        };
        const auto full = taocode::search::preview(root, options);
        check(!chunks.empty(), "expected at least one chunk");
        std::size_t total = 0;
        for (const auto& chunk : chunks) {
            check(chunk.is_array() && !chunk.empty(), "every chunk carries matches");
            total += chunk.size();
        }
        check(total == full.at("matches").size(),
              "chunks (" + std::to_string(total) + ") must add up to the full result (" +
              std::to_string(full.at("matches").size()) + ")");
        // 块内的每一条与最终结果同形（path/line/column/preview 都在）。
        for (const auto& item : chunks.front()) {
            check(item.contains("path") && item.contains("line") && item.contains("column") && item.contains("preview"),
                  "chunk entries keep the final shape");
        }
        check(last_files > 0, "the last chunk reports how many files matched so far");
        const auto event = taocode::search::chunk_event(7, chunks.front(), last_files);
        check(event.at("event").get<std::string>() == "search.chunk" && event.at("streamId").get<int>() == 7 &&
              event.at("done").get<bool>() == false, "chunk_event carries the event name, stream id and done flag");
    });

    run("without on_chunk nothing is published (one-shot path stays one-shot)", [&] {
        const auto result = taocode::search::preview(root, literal("alpha"));
        check(result.at("matches").size() == 4, "the one-shot result is unchanged");
    });

    run("regex search honours groups and invalid patterns error", [&] {
        Options options; options.query = "(alpha) (\\w+)"; options.regex = true; options.case_sensitive = true;
        const auto result = taocode::search::run(root, options);
        const auto* hit = find(result, "deep/inner.txt", 1);
        check(hit != nullptr, "'alpha y' in inner.txt should match '(alpha) (\\w+)'");
        check(hit && hit->at("column").get<int>() == 3, "the match starts at col3");
        check(hit && hit->at("length").get<int>() == 7, "'alpha y' spans 7 characters");
        check(!find(result, "note.txt", 1), "a bare trailing 'alpha' has no following word to pair with");
        Options broken; broken.query = "(unclosed"; broken.regex = true;
        bool threw = false;
        try { taocode::search::run(root, broken); } catch (const taocode::WorkspaceError& e) { threw = e.code == "INVALID_QUERY"; }
        check(threw, "an invalid regex must surface as INVALID_QUERY");
    });

    run("include and exclude globs narrow the scan", [&] {
        Options only_dir; only_dir.query = "alpha"; only_dir.case_sensitive = true; only_dir.include = {taocode::search::parse_patterns("deep/**")[0]};
        const auto nested = taocode::search::run(root, only_dir);
        check(nested.at("fileCount").get<int>() == 1 && find(nested, "deep/inner.txt", 1), "'deep/**' matches only the nested file");

        Options by_name; by_name.query = "alpha"; by_name.case_sensitive = true; by_name.include = {"inner.txt"};
        check(taocode::search::run(root, by_name).at("fileCount").get<int>() == 1, "a bare filename glob matches by basename");

        Options not_note; not_note.query = "alpha"; not_note.case_sensitive = true; not_note.exclude = {"note.txt", "cjk.txt"};
        const auto excluded = taocode::search::run(root, not_note);
        check(find(excluded, "deep/inner.txt", 1) && !find(excluded, "note.txt", 1), "exclude drops note and cjk");
    });

    run("whole-word literal replace edits only standalone matches", [&] {
        Options options; options.query = "beta"; options.replacement = "B"; options.case_sensitive = true;
        options.whole_word = true; options.include = {"note.txt"};
        const auto result = taocode::search::replace(root, options);
        check(result.at("replacements").get<int>() == 1, "one standalone beta replaced");
        check(result.at("files").get<int>() == 1, "one file changed");
        check(result.contains("truncated") && result.at("truncated").get<bool>() == false, "a tiny scan is not truncated");
        check(grab(root / "note.txt") == "alpha\nB alpha\nbetabox\n", "betabox must be left intact");
    });

    run("regex replace expands $n from capture groups", [&] {
        put(root / "re.txt", "foo1bar foo2baz\n");
        Options options; options.query = "foo(\\d)"; options.replacement = "x$1"; options.regex = true; options.include = {"re.txt"};
        const auto result = taocode::search::replace(root, options);
        check(result.at("replacements").get<int>() == 2, "two numeric captures replaced");
        check(grab(root / "re.txt") == "x1bar x2baz\n", "$1 should splice the captured digit");
        fs::remove(root / "re.txt", ec);
    });

    run("empty query is a no-op, not an error", [&] {
        Options options;  // query empty, regex off
        const auto result = taocode::search::run(root, options);
        check(result.at("matches").empty() && result.at("fileCount").get<int>() == 0, "no query -> no matches");
    });

    // 作用域编辑器（IDEA FileTreeModelBuilder + ScopeEditorPanel 的「包含 N / 共 M」）用的清单：
    // 与大写扫描同一套目录排除策略，但不读内容、不做二进制判定，并且排序稳定。
    run("list_files returns the whole sorted project listing", [&] {
        const auto result = taocode::search::list_files(root);
        check(result.at("truncated").get<bool>() == false, "a small tree is never truncated");
        std::vector<std::string> files;
        for (const auto& item : result.at("files")) files.push_back(item.get<std::string>());
        const std::vector<std::string> expected{"cjk.txt", "data.bin", "deep/inner.txt", "note.txt"};
        check(files == expected, "expected cjk.txt data.bin deep/inner.txt note.txt in order");
        for (const auto& path : files)
            check(path.find("node_modules") == std::string::npos && path.find(".git") == std::string::npos,
                  "excluded directories are not listed: " + path);
    });

    run("list_files refuses an unopened workspace", [&] {
        bool refused = false;
        try { taocode::search::list_files(fs::path{}); }
        catch (const taocode::WorkspaceError&) { refused = true; }
        check(refused, "an empty workspace root must be rejected, not listed");
    });

    fs::remove_all(root, ec);
    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
