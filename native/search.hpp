#pragma once

#include <filesystem>
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
};

// Splits a user filter box ("*.cpp, src/** build/**") on commas/whitespace.
std::vector<std::string> parse_patterns(const std::string& text);

// Returns { matches: [{path,line,column,preview,length}], truncated, fileCount }
// with workspace-relative '/'-separated paths and 1-based line/column.
Json run(const std::filesystem::path& root, const Options& options);

// Searches files; `truncated` is true when the walk hit max_scanned_files or
// max_results, so the visible matches are not the full set.
Json run(const std::filesystem::path& root, const Options& options);

// Returns { files, replacements, truncated } after rewriting every matching file
// in place; `truncated` mirrors the run truncation so a partial rewrite is
// reported instead of silently reported as complete.
Json replace(const std::filesystem::path& root, const Options& options);

}  // namespace taocode::search
