#pragma once

#include <filesystem>
#include <functional>
#include <string>
#include <vector>

#include "workspace.hpp"

namespace taocode::search {

// One Find-in-Files request. `query` is a literal substring, or an ECMAScript
// regular expression when `regex` is set. `include`/`exclude` are already split
// glob patterns (e.g. "*.cpp", "src/**"); an empty include means "all files".
struct Options {
    std::string query;
    std::string replacement;
    bool regex = false;
    bool case_sensitive = true;
    bool whole_word = false;
    std::vector<std::string> include;
    std::vector<std::string> exclude;
    // Polled between files so a long Find-in-Files can be abandoned. A search that
    // cannot be cancelled freezes the whole host: the request runs on its own thread
    // but the UI would still be waiting on a result nobody wants any more.
    std::function<bool()> cancelled;
    /*
     * 分块发布：每攒够一块就把**这一块**的命中交出去（`matches` 是按顺序的一段，
     * `file_count` 是到此刻为止命中过的文件数）。空 = 不分块（老的一次性返回）。
     *
     * 上游 `SearchResults` 就是这么做的 —— `CHUNK_TIME_BUDGET_MS = 50`，
     * "每搜到一块就先发出去，慢搜索也能先看到命中"（`SearchResults.java:87`、`:256-306`）。
     * 本仓的不同只在预算的计量：上游按**持有读锁的时长**切块，本仓的一次扫描没有读锁，
     * 所以按"距上一块的墙钟时间 + 条数"两条中先到的那条切。
     */
    std::function<void(const Json& matches, std::size_t file_count)> on_chunk;
    int chunk_budget_ms = 50;
    std::size_t chunk_max_matches = 200;
};

/*
 * 把一块命中包成 `search.chunk` 事件体（宿主 main.cpp 的 search.preview 分支推给前端）。
 * 形状与 payload 一起放在这里而不是 main.cpp：main.cpp 贴着 2000 行硬上限，
 * 而"这一块长什么样"本来就属于搜索这件事（收块的地方见 src/searchStream.ts）。
 */
Json chunk_event(std::int64_t stream_id, const Json& matches, std::size_t file_count);

// Splits a user filter box ("*.cpp, src/** build/**") on commas/whitespace.
std::vector<std::string> parse_patterns(const std::string& text);

// Every project file as a workspace-relative '/'-separated path, sorted. Used by the
// scope editor: its package tree and its "Scope contains N of total M files" counter
// (ScopeEditorPanel.java:796) both read the same listing. Returns `{ files, truncated }`
// where `truncated` is true when the walk hit max_scanned_files, so a partial list is
// never presented as the whole project.
Json list_files(const std::filesystem::path& root);

// Returns { matches: [{path,line,column,preview,length}], truncated, fileCount }
// with workspace-relative '/'-separated paths and 1-based line/column. `truncated`
// is true when the walk hit max_scanned_files or max_results, so the visible
// matches are not the full set.
Json run(const std::filesystem::path& root, const Options& options);

// Returns { files, replacements, truncated } after rewriting every matching file
// in place; `truncated` mirrors the run truncation so a partial rewrite is
// reported instead of silently reported as complete.
Json replace(const std::filesystem::path& root, const Options& options);

// IDEA's "Replace in Files" shows a preview tree where every occurrence can be
// ticked or skipped before anything is written. Same matches as run(), plus the
// exact matched text (`before`) and the line as it will look afterwards (`after`),
// so the UI never has to re-implement regex substitution (and gets $1 right).
Json preview(const std::filesystem::path& root, const Options& options);

// One occurrence the user ticked in the preview: workspace-relative path plus the
// 1-based line and the 1-based column run() reports.
struct Selection {
    std::string path;
    std::int64_t line = 0;
    std::int64_t column = 0;
};

// Rewrites only the selected occurrences. Everything else in those files — and
// every other file — is left byte-identical, which is what makes a preview
// honest: what the dialog showed is exactly what lands on disk.
// Returns { files, replacements, truncated, skippedFiles }: `truncated` is true
// when the walk hit max_scanned_files (or was cancelled, which also sets
// `cancelled`), and `skippedFiles` counts the ticked files the walk never reached,
// so "0 replacements" can never pass for success while files were skipped.
Json replace_selected(const std::filesystem::path& root, const Options& options,
                      const std::vector<Selection>& selections);

}  // namespace taocode::search
