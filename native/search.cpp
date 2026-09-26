#include "search.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <cctype>
#include <atomic>
#include <functional>
#include <fstream>
#include <iterator>
#include <limits>
#include <map>
#include <set>
#include <optional>
#include <regex>
#include <string_view>
#include <system_error>
#include <utility>

namespace taocode::search {
namespace {
namespace fs = std::filesystem;

// A single text file larger than this is skipped (a build artifact, a bundled
// blob, a lock file). Small enough that a whole-workspace scan stays responsive
// and a file never threatens memory, large enough for real source/data files.
constexpr std::size_t max_file_bytes = 8 * 1024 * 1024;
constexpr std::size_t max_matches = 5000;        // hard ceiling on returned hits
constexpr std::size_t max_scanned_files = 100000;  // ceiling on the walk itself
constexpr std::size_t max_preview_bytes = 1024;  // long lines are clipped here
constexpr std::size_t max_globs = 64;

const std::vector<std::string> default_excluded_dirs = {
    ".git", ".svn", ".hg", ".bzr", "node_modules", "bower_components",
    "build", "dist", "out", "bin", "obj", "target", ".next", ".nuxt",
    ".cache", "__pycache__", ".venv", "venv", ".idea", ".vs", ".gradle"};

[[noreturn]] void fail(const char* code, const std::string& message) {
    throw WorkspaceError(code, message);
}

std::string utf8_path(const fs::path& path) {
    const auto text = path.generic_u8string();
    return {reinterpret_cast<const char*>(text.data()), text.size()};
}

// Extend the path into the \\?\ namespace so ReplaceFileW tolerates long paths,
// mirroring the workspace save path. Native form already carries backslashes.
std::wstring api_path(const fs::path& path) {
    const auto native = path.native();
    if (native.starts_with(L"\\\\?\\")) return native;
    if (native.starts_with(L"\\\\")) return L"\\\\?\\UNC\\" + native.substr(2);
    return L"\\\\?\\" + native;
}

bool valid_utf8(std::string_view text) {
    if (text.empty()) return true;
    if (text.size() > static_cast<std::size_t>((std::numeric_limits<int>::max)())) return false;
    return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(),
                               static_cast<int>(text.size()), nullptr, 0) != 0;
}

// Count UTF-8 code points in [begin, end): every byte that is not a continuation
// byte (0b10xxxxxx) starts a code point. For all BMP text this equals the JS
// string index the frontend slices `preview` with, so highlights line up.
std::size_t code_points(std::string_view text, std::size_t begin, std::size_t end) {
    std::size_t count = 0;
    for (std::size_t i = begin; i < end; ++i)
        if ((static_cast<unsigned char>(text[i]) & 0xC0) != 0x80) ++count;
    return count;
}

std::string clip_preview(std::string_view line) {
    if (line.size() <= max_preview_bytes) return std::string(line);
    std::size_t end = max_preview_bytes;
    // Never cut in the middle of a multi-byte code point: back the boundary off
    // to the lead byte of the code point that straddles it.
    while (end > 0 && (static_cast<unsigned char>(line[end]) & 0xC0) == 0x80) --end;
    return std::string(line.substr(0, end));
}

bool is_word_byte(unsigned char c) {
    return c == '_' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

unsigned char ascii_lower(unsigned char c) {
    return (c >= 'A' && c <= 'Z') ? static_cast<unsigned char>(c + 32) : c;
}

// A match may only sit on an ASCII word boundary (\b in the regex engine).
bool on_word_boundary(std::string_view text, std::size_t pos, std::size_t len) {
    if (pos > 0 && is_word_byte(static_cast<unsigned char>(text[pos - 1]))) return false;
    const std::size_t end = pos + len;
    if (end < text.size() && is_word_byte(static_cast<unsigned char>(text[end]))) return false;
    return true;
}

std::size_t find_literal(std::string_view hay, std::string_view needle, bool caseless, std::size_t from) {
    if (needle.empty() || needle.size() > hay.size()) return std::string_view::npos;
    if (!caseless) return hay.find(needle, from);
    for (std::size_t i = from; i + needle.size() <= hay.size(); ++i) {
        std::size_t j = 0;
        for (; j < needle.size(); ++j)
            if (ascii_lower(static_cast<unsigned char>(hay[i + j])) !=
                ascii_lower(static_cast<unsigned char>(needle[j]))) break;
        if (j == needle.size()) return i;
    }
    return std::string_view::npos;
}

// Enumerate every non-empty match in ascending byte order. `emit` receives the
// byte span plus the regex sub-match (null for literal search) and returns false
// to abort early. Whole-word matches that straddle a word character are skipped.
template <class Emit>
bool for_each_match(const std::string& text, const Options& opt, const std::regex* pattern, Emit&& emit) {
    if (text.empty()) return true;
    if (opt.regex) {
        if (!pattern) return true;
        const std::sregex_iterator end{};
        for (auto it = std::sregex_iterator(text.begin(), text.end(), *pattern); it != end; ++it) {
            const std::smatch& match = *it;
            const std::size_t len = static_cast<std::size_t>(match.length(0));
            if (!len) continue;
            const std::size_t pos = static_cast<std::size_t>(match.position(0));
            if (opt.whole_word && !on_word_boundary(text, pos, len)) continue;
            if (!emit(pos, len, &match)) return false;
        }
        return true;
    }
    if (opt.query.empty()) return true;
    const std::string_view view{text};
    const std::string_view needle{opt.query};
    std::size_t from = 0;
    for (;;) {
        const std::size_t pos = find_literal(view, needle, !opt.case_sensitive, from);
        if (pos == std::string_view::npos) break;
        from = pos + needle.size();
        if (opt.whole_word && !on_word_boundary(text, pos, needle.size())) continue;
        if (!emit(pos, needle.size(), nullptr)) return false;
    }
    return true;
}

// Translate a single glob into an ECMAScript regex body. '/' separates segments;
// '**/' spans any number of segments, '**' spans anything, '*'/'?' stay within a
// segment. Every other metacharacter is escaped so the glob is the only syntax.
std::string glob_body(std::string_view glob) {
    std::string out;
    for (std::size_t i = 0; i < glob.size();) {
        const char c = glob[i];
        if (c == '*') {
            if (i + 1 < glob.size() && glob[i + 1] == '*') {
                if (i + 2 < glob.size() && glob[i + 2] == '/') { out += "(?:[^/]*/)*"; i += 3; }
                else { out += ".*"; i += 2; }
            } else { out += "[^/]*"; ++i; }
            continue;
        }
        if (c == '?') { out += "[^/]"; ++i; continue; }
        if (std::string_view(".^$|()[]{}+\\").find(c) != std::string_view::npos) out += '\\';
        out += c;
        ++i;
    }
    return out;
}

struct Glob {
    std::string source;  // raw pattern, decides whether to test the basename
    std::regex matcher;  // full-match (regex_match) over path or basename
    bool by_name = false;
};

std::vector<Glob> compile_globs(const std::vector<std::string>& patterns, const char* label) {
    if (patterns.size() > max_globs)
        fail("INVALID_QUERY", std::string(label) + " 最多允许 64 个模式。");
    std::vector<Glob> result;
    for (const auto& pattern : patterns) {
        if (pattern.empty()) continue;
        Glob glob;
        glob.source = pattern;
        glob.by_name = pattern.find('/') == std::string::npos;
        try {
            glob.matcher = std::regex(glob_body(pattern), std::regex::ECMAScript | std::regex::icase);
        } catch (const std::regex_error&) {
            fail("INVALID_QUERY", std::string(label) + " 含有无效模式：" + pattern);
        }
        result.push_back(std::move(glob));
    }
    return result;
}

bool any_glob(const std::vector<Glob>& globs, const std::string& path, const std::string& name) {
    for (const auto& glob : globs) {
        const std::string& target = glob.by_name ? name : path;
        if (std::regex_match(target, glob.matcher)) return true;
    }
    return false;
}

bool excluded_dir_name(const std::string& name) {
    for (const auto& entry : default_excluded_dirs)
        if (name == entry) return true;
    return false;
}

std::optional<std::string> read_text_file(const fs::path& path) {
    std::error_code ec;
    const auto size = fs::file_size(path, ec);
    if (ec || size > max_file_bytes) return std::nullopt;  // unreadable, empty-dirs or too big
    std::ifstream stream(path, std::ios::binary);
    if (!stream) return std::nullopt;
    std::string content(static_cast<std::size_t>(size), '\0');
    if (!content.empty()) {
        stream.read(content.data(), static_cast<std::streamsize>(size));
        if (static_cast<std::size_t>(stream.gcount()) != content.size()) return std::nullopt;
    }
    if (content.find('\0') != std::string::npos) return std::nullopt;  // binary
    if (!valid_utf8(content)) return std::nullopt;
    return content;
}

std::regex build_query_pattern(const Options& opt) {
    std::regex::flag_type flags = std::regex::ECMAScript;
    if (!opt.case_sensitive) flags |= std::regex::icase;
    try {
        return std::regex(opt.query, flags);
    } catch (const std::regex_error&) {
        fail("INVALID_QUERY", "正则表达式无效。");
    }
}

struct Scan {
    std::vector<Glob> include;
    std::vector<Glob> exclude;
    std::regex pattern;
    bool has_pattern = false;
    std::function<bool()> cancelled;
    // Set by walk() when it stopped because `cancelled()` returned true, so the
    // caller can report "abandoned" instead of "finished but truncated".
    bool cancelled_hit = false;
};

// Prefix used for replacement scratch files; also skipped by walk() so a temp
// left behind by a crash is never searched or replaced.
constexpr std::wstring_view replace_prefix = L".taocode-replace-";

// Replace a file's contents durably: write a sibling temp, flush it to disk, then
// swap it over the target with ReplaceFileW. The original is only ever lost if
// the swap itself succeeds, so a full disk or a locked target cannot destroy it.
void write_atomically(const fs::path& target, const std::string& content) {
    static std::atomic<unsigned> counter{0};
    std::wstring name(replace_prefix);
    name += std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(++counter) + L".tmp";
    const fs::path temp = target.parent_path() / name;
    {
        std::ofstream out(temp, std::ios::binary | std::ios::trunc);
        if (!out) { std::error_code e; fs::remove(temp, e); fail("IO_ERROR", "无法创建替换临时文件：" + utf8_path(temp)); }
        out.write(content.data(), static_cast<std::streamsize>(content.size()));
        out.flush();
        if (!out) { out.close(); std::error_code e; fs::remove(temp, e); fail("IO_ERROR", "写入替换临时文件失败：" + utf8_path(temp)); }
    }
    if (!ReplaceFileW(api_path(target).c_str(), api_path(temp).c_str(), nullptr,
                      REPLACEFILE_IGNORE_MERGE_ERRORS, nullptr, nullptr)) {
        const DWORD error = GetLastError();
        std::error_code e; fs::remove(temp, e);
        if (error == ERROR_SHARING_VIOLATION || error == ERROR_LOCK_VIOLATION)
            fail("FILE_BUSY", "文件正被其他程序占用，未替换：" + utf8_path(target));
        fail("IO_ERROR", "替换文件失败（Windows 错误 " + std::to_string(error) + "）：" + utf8_path(target));
    }
}

// Walk the workspace, invoking `visit` for every in-scope text file with its
// absolute path, workspace-relative '/' path and contents. Returns false when
// the walk was cut short by the scanned-file ceiling.
template <class Visit>
bool walk(const fs::path& root, Scan& scan, Visit&& visit) {
    std::error_code ec;
    fs::recursive_directory_iterator it(root, fs::directory_options::skip_permission_denied, ec);
    if (ec) fail("NOT_OPEN", "无法读取工作区目录。");
    const fs::recursive_directory_iterator end{};
    std::size_t scanned = 0;
    for (; it != end; it.increment(ec)) {
        if (ec) { ec.clear(); continue; }
        const auto& entry = *it;
        std::error_code leec;
        if (entry.is_symlink(leec)) {  // never follow or read links/junctions
            if (entry.is_directory(leec)) it.disable_recursion_pending();
            continue;
        }
        if (entry.is_directory(leec)) {
            if (excluded_dir_name(utf8_path(entry.path().filename()))) it.disable_recursion_pending();
            continue;
        }
        if (scan.cancelled && scan.cancelled()) { scan.cancelled_hit = true; return false; }
        if (!entry.is_regular_file(leec) || leec) continue;
        if (entry.path().filename().native().starts_with(replace_prefix)) continue;  // our own scratch
        if (++scanned > max_scanned_files) return false;
        const auto rel = utf8_path(fs::relative(entry.path(), root, ec));
        if (ec) { ec.clear(); continue; }
        const auto name = utf8_path(entry.path().filename());
        if ((!scan.include.empty() && !any_glob(scan.include, rel, name)) ||
            any_glob(scan.exclude, rel, name)) continue;
        auto content = read_text_file(entry.path());
        if (!content) continue;
        visit(entry.path(), rel, *content);
    }
    return true;
}

}  // namespace

std::vector<std::string> parse_patterns(const std::string& text) {
    std::vector<std::string> result;
    std::string current;
    for (char c : text) {
        if (c == ',' || c == ';' || std::isspace(static_cast<unsigned char>(c))) {
            if (!current.empty()) { result.push_back(current); current.clear(); }
        } else {
            current += c;
        }
    }
    if (!current.empty()) result.push_back(current);
    return result;
}

Json run(const fs::path& root, const Options& options) {
    if (root.empty()) fail("NOT_OPEN", "请先打开一个工作区。");
    if (!options.regex && options.query.empty())
        return {{"matches", Json::array()}, {"truncated", false}, {"fileCount", 0}};
    Scan scan{compile_globs(options.include, "包含"), compile_globs(options.exclude, "排除"),
              options.regex ? build_query_pattern(options) : std::regex{}, options.regex, options.cancelled};

    Json matches = Json::array();
    std::size_t files = 0;
    bool truncated = false;
    const bool complete = walk(root, scan, [&](const fs::path&, const std::string& rel, const std::string& content) {
        const std::size_t before = matches.size();
        std::size_t line = 1, line_start = 0, cursor = 0;
        for_each_match(content, options, scan.has_pattern ? &scan.pattern : nullptr,
            [&](std::size_t pos, std::size_t len, const std::smatch*) {
                for (; cursor < pos; ++cursor)
                    if (content[cursor] == '\n') { ++line; line_start = cursor + 1; }
                std::size_t line_end = content.find('\n', line_start);
                if (line_end == std::string::npos) line_end = content.size();
                if (line_end > line_start && content[line_end - 1] == '\r') --line_end;
                matches.push_back({
                    {"path", rel},
                    {"line", line},
                    {"column", static_cast<std::int64_t>(code_points(content, line_start, pos) + 1)},
                    {"preview", clip_preview(std::string_view(content).substr(line_start, line_end - line_start))},
                    {"length", static_cast<std::int64_t>(code_points(content, pos, pos + len))},
                });
                return matches.size() < max_matches;
            });
        if (matches.size() >= max_matches) truncated = true;
        if (matches.size() > before) ++files;
    });
    if (scan.cancelled_hit) return {{"matches", Json::array()}, {"truncated", true}, {"fileCount", 0}, {"cancelled", true}};
    // walk() returns false both when it abandoned (handled above) and when it hit
    // max_scanned_files; the ceiling path must be reported too, otherwise the UI
    // presents a partial result as the whole answer.
    if (!complete) truncated = true;
    return {{"matches", std::move(matches)}, {"truncated", truncated}, {"fileCount", files}};
}

Json replace(const fs::path& root, const Options& options) {
    if (root.empty()) fail("NOT_OPEN", "请先打开一个工作区。");
    if (!options.regex && options.query.empty())
        return {{"files", 0}, {"replacements", 0}};
    Scan scan{compile_globs(options.include, "包含"), compile_globs(options.exclude, "排除"),
              options.regex ? build_query_pattern(options) : std::regex{}, options.regex, options.cancelled};

    std::size_t files = 0, replacements = 0;
    bool truncated = false;
    const bool complete = walk(root, scan, [&](const fs::path& path, const std::string&, const std::string& content) {
        std::string result;
        result.reserve(content.size());
        std::size_t last = 0, hits = 0;
        for_each_match(content, options, scan.has_pattern ? &scan.pattern : nullptr,
            [&](std::size_t pos, std::size_t len, const std::smatch* match) {
                result.append(content, last, pos - last);
                if (match) result += match->format(options.replacement);
                else result += options.replacement;
                last = pos + len;
                ++hits;
                return true;
            });
        if (!hits || result == content) return;
        result.append(content, last, std::string::npos);
        write_atomically(path, result);   // never truncates the original on failure
        ++files;
        replacements += hits;
    });
    if (scan.cancelled_hit) return {{"files", files}, {"replacements", replacements}, {"truncated", true}, {"cancelled", true}};
    // A walk cut short by max_scanned_files leaves files below the ceiling
    // untouched: the rewrite is partial, so it must not come back as complete.
    if (!complete) truncated = true;
    return {{"files", files}, {"replacements", replacements}, {"truncated", truncated}};
}

// The text a single occurrence becomes: regex replacement applies $1/$& through
// std::match_results::format (the same ECMAScript substitution IDEA's dialog does),
// a literal search substitutes the plain string.
std::string substitution_text(const Options& options, const std::string& content,
                              std::size_t pos, std::size_t len, const std::smatch* match) {
    if (match) {
        try { return match->format(options.replacement); }
        catch (const std::regex_error&) { return options.replacement; }
    }
    (void)content; (void)pos; (void)len;
    return options.replacement;
}

Json preview(const fs::path& root, const Options& options) {
    if (root.empty()) fail("NOT_OPEN", "请先打开一个工作区。");
    if (!options.regex && options.query.empty())
        return {{"matches", Json::array()}, {"truncated", false}, {"fileCount", 0}};
    Scan scan{compile_globs(options.include, "包含"), compile_globs(options.exclude, "排除"),
              options.regex ? build_query_pattern(options) : std::regex{}, options.regex, options.cancelled};

    Json matches = Json::array();
    std::size_t files = 0;
    bool truncated = false;
    const bool complete = walk(root, scan, [&](const fs::path&, const std::string& rel, const std::string& content) {
        const std::size_t before = matches.size();
        std::size_t line = 1, line_start = 0, cursor = 0;
        for_each_match(content, options, scan.has_pattern ? &scan.pattern : nullptr,
            [&](std::size_t pos, std::size_t len, const std::smatch* match) {
                for (; cursor < pos; ++cursor)
                    if (content[cursor] == '\n') { ++line; line_start = cursor + 1; }
                std::size_t line_end = content.find('\n', line_start);
                if (line_end == std::string::npos) line_end = content.size();
                if (line_end > line_start && content[line_end - 1] == '\r') --line_end;
                const std::string line_text = content.substr(line_start, line_end - line_start);
                const std::string inserted = substitution_text(options, content, pos, len, match);
                matches.push_back({
                    {"path", rel},
                    {"line", line},
                    {"column", static_cast<std::int64_t>(code_points(content, line_start, pos) + 1)},
                    {"length", static_cast<std::int64_t>(code_points(content, pos, pos + len))},
                    {"before", content.substr(pos, len)},
                    {"after", clip_preview(line_text.substr(0, pos - line_start) + inserted +
                                           line_text.substr(pos - line_start + len))},
                    {"preview", clip_preview(std::string_view(line_text))},
                });
                return matches.size() < max_matches;
            });
        if (matches.size() >= max_matches) truncated = true;
        if (matches.size() > before) ++files;
    });
    if (scan.cancelled_hit) return {{"matches", Json::array()}, {"truncated", true}, {"fileCount", 0}, {"cancelled", true}};
    if (!complete) truncated = true;
    return {{"matches", std::move(matches)}, {"truncated", truncated}, {"fileCount", files}};
}

Json replace_selected(const fs::path& root, const Options& options, const std::vector<Selection>& selections) {
    if (root.empty()) fail("NOT_OPEN", "请先打开一个工作区。");
    if (!options.regex && options.query.empty())
        return {{"files", 0}, {"replacements", 0}, {"truncated", false}, {"skippedFiles", 0}};
    if (selections.empty()) return {{"files", 0}, {"replacements", 0}, {"truncated", false}, {"skippedFiles", 0}};
    if (selections.size() > max_matches)
        fail("INVALID_REQUEST", "一次最多替换 5000 处。");
    Scan scan{compile_globs(options.include, "包含"), compile_globs(options.exclude, "排除"),
              options.regex ? build_query_pattern(options) : std::regex{}, options.regex, options.cancelled};

    // Only the files that actually carry a selection are opened, and a file is
    // written once, with every ticked occurrence applied in ascending order.
    std::map<std::string, std::set<std::pair<std::int64_t, std::int64_t>>> wanted;
    for (const auto& selection : selections) {
        if (selection.path.empty() || selection.line < 1 || selection.column < 1) continue;
        wanted[selection.path].insert({selection.line, selection.column});
    }
    std::size_t files = 0, replacements = 0;
    bool truncated = false;
    // Every wanted file the walk actually reached. A walk cut short by
    // max_scanned_files never opens the files past the ceiling, so the difference
    // between this and `wanted` is the set of ticked files that were silently
    // left alone — reported as skippedFiles instead of a clean "0 replacements".
    std::set<std::string> visited;
    const bool complete = walk(root, scan, [&](const fs::path& path, const std::string& rel, const std::string& content) {
        const auto chosen = wanted.find(rel);
        if (chosen == wanted.end()) return;
        visited.insert(rel);
        std::string result;
        result.reserve(content.size());
        std::size_t last = 0, hits = 0;
        std::size_t line = 1, line_start = 0, cursor = 0;
        for_each_match(content, options, scan.has_pattern ? &scan.pattern : nullptr,
            [&](std::size_t pos, std::size_t len, const std::smatch* match) {
                for (; cursor < pos; ++cursor)
                    if (content[cursor] == '\n') { ++line; line_start = cursor + 1; }
                const auto column = static_cast<std::int64_t>(code_points(content, line_start, pos) + 1);
                if (!chosen->second.contains({static_cast<std::int64_t>(line), column})) return true;
                result.append(content, last, pos - last);
                result += substitution_text(options, content, pos, len, match);
                last = pos + len;
                ++hits;
                return true;
            });
        if (!hits) return;
        result.append(content, last, std::string::npos);
        if (result == content) return;
        write_atomically(path, result);
        ++files;
        replacements += hits;
    });
    if (scan.cancelled_hit) return {{"files", files}, {"replacements", replacements}, {"truncated", true}, {"cancelled", true}};
    if (!complete) truncated = true;
    std::size_t skipped = 0;
    for (const auto& entry : wanted)
        if (!visited.contains(entry.first)) ++skipped;
    return {{"files", files}, {"replacements", replacements}, {"truncated", truncated}, {"skippedFiles", skipped}};
}

}  // namespace taocode::search
