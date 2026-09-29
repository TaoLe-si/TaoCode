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
};

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
