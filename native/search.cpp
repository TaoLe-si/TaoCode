#include "search.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>

#include <cctype>
#include <atomic>
#include <chrono>
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

// Files skipped this scan because their bytes survive neither UTF-8 nor GBK
// decoding. Surfaced in the results so "0 hits" is never presented as the whole
// truth for a scan that could not read everything.
std::atomic<std::size_t> skipped_non_utf8{0};

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

// 替换模板的 `\L…\E`/`\U…\E` 只折叠 ASCII 字母（上游是全 Unicode 映射，差异写在
// RegExReplacementBuilder 那段注释里）。UTF-8 的续字节都 ≥ 0x80，逐字节折叠劈不开序列。
unsigned char ascii_upper(unsigned char c) {
    return (c >= 'a' && c <= 'z') ? static_cast<unsigned char>(c - 32) : c;
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
    if (!valid_utf8(content)) {
        // Not UTF-8: try GBK (CP936) like the workspace layer does, so a GBK
        // workspace is searchable instead of silently reporting "0 hits". Bytes
        // that survive neither decoding are counted as skipped.
        const int gbk = MultiByteToWideChar(936, MB_ERR_INVALID_CHARS, content.data(),
                                            static_cast<int>(content.size()), nullptr, 0);
        if (gbk <= 0) { skipped_non_utf8.fetch_add(1); return std::nullopt; }
        std::wstring wide(static_cast<std::size_t>(gbk), L'\0');
        MultiByteToWideChar(936, MB_ERR_INVALID_CHARS, content.data(),
                            static_cast<int>(content.size()), wide.data(), gbk);
        const int utf8_len = WideCharToMultiByte(CP_UTF8, 0, wide.data(), gbk, nullptr, 0, nullptr, nullptr);
        if (utf8_len <= 0) { skipped_non_utf8.fetch_add(1); return std::nullopt; }
        std::string decoded(static_cast<std::size_t>(utf8_len), '\0');
        WideCharToMultiByte(CP_UTF8, 0, wide.data(), gbk, decoded.data(), utf8_len, nullptr, nullptr);
        return decoded;
    }
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

// Same directory policy as walk(), but it stops at the file and never opens it:
// the scope editor only needs the project's relative path list. Returns false when
// the walk hit max_scanned_files, so a partial list is never passed off as complete.
bool walk_paths(const fs::path& root, std::vector<std::string>& out) {
    std::error_code ec;
    fs::recursive_directory_iterator it(root, fs::directory_options::skip_permission_denied, ec);
    if (ec) fail("NOT_OPEN", "无法读取工作区目录。");
    const fs::recursive_directory_iterator end{};
    std::size_t scanned = 0;
    for (; it != end; it.increment(ec)) {
        if (ec) { ec.clear(); continue; }
        const auto& entry = *it;
        std::error_code leec;
        if (entry.is_symlink(leec)) {  // never follow or list links/junctions
            if (entry.is_directory(leec)) it.disable_recursion_pending();
            continue;
        }
        if (entry.is_directory(leec)) {
            if (excluded_dir_name(utf8_path(entry.path().filename()))) it.disable_recursion_pending();
            continue;
        }
        if (!entry.is_regular_file(leec) || leec) continue;
        if (entry.path().filename().native().starts_with(replace_prefix)) continue;  // our own scratch
        if (++scanned > max_scanned_files) return false;
        const auto rel = utf8_path(fs::relative(entry.path(), root, ec));
        if (ec) { ec.clear(); continue; }
        out.push_back(rel);
    }
    return true;
}

// ── 正则替换模板的展开：上游 `com.intellij.find.impl.RegExReplacementBuilder` ──────────
// 逐条坐标（platform/lang-impl/src/com/intellij/find/impl/RegExReplacementBuilder.java）：
//   · 主循环 `:90-101`（`\` 走转义、`$` 走组引用、其余原样追加）
//   · 转义 `:109-136`（`\n \r \b \t \f \xNNNN \l \u \L \U \E`；认不出的转义**去掉反斜杠**
//     再追加（`:134` 的 default 分支）；`\x` 只在后面那 4 位能被 `Integer.parseInt(s,16)`
//     吃下时才前进（`:119-128` 的 catch 不移动 cursor，那 4 位随后按普通字符走）
//   · 组引用 `:138-181`：`${name}` `:143-161`；`$n` 取**最长的合法组号** `:164-176`；
//     值为 null 的组什么都不追加 `:178-180`
//   · 大小写区域状态机 `:206-247`，产物裁剪 `:183-204`
//   · 组号上界 `:56-61`（越界 ⇒ `No group N`）、`:71`（`validate` **不**校验组名是否真存在，
//     校验模式下 `group(name)` 恒返回空串 `:51-54`）
// 上游入口是 `FindManagerBase.getStringToReplace`（`:284-298`）：正则档**先**展开模板，
// 之后才按需套「保留大小写」；模板非法 ⇒ `MalformedReplacementStringException`（`:305-314`），
// 文案 = `FindBundle.properties:96`「Malformed replacement string: {0}」，标题 `:97`「Replace Error」。
// 之前本仓这条走的是 `std::match_results::format`（ECMAScript 格式化器），与上游差在：
// `$0`（上游 = 整段命中 / format = 字面）、`${name}`（上游认 / format 只认 `$<name>`）、
// `\n` `\t` `\xNNNN` `\L…\E`（上游展开 / format 原样留下）、`$&`（上游**报错** / format 当整段命中）。
//
// UTF-16 与 UTF-8 的两处字面差异（如实记，见报告差异表）：
//   · `\xNNNN` 的那个码点在这里按 UTF-8 编出来（BMP 内与上游同字面）；
//   · `\L…\E`/`\U…\E`/`\l`/`\u` 只折叠 ASCII 字母 —— UTF-8 的续字节都 ≥ 0x80，逐字节折叠
//     不会劈开多字节序列；上游用 `String.toUpperCase(Locale.getDefault())` 做全 Unicode 映射。
struct NamedGroups {
    std::vector<std::pair<std::string, std::size_t>> items;  // 组名 -> 组号（1 基，与 mark_count 同序）
};

// `std::regex` 不暴露「组名 → 编号」的映射（Java 的 Matcher 有注册表），只能自己数括号。
// 规则：`(` 开一个捕获组，除非紧跟 `?`；`(?<name>` 是命名捕获组；`(?=` `(?!` `(?<=` `(?<!`
// `(?:` 不占编号；`(?#…)` 是注释。字符类 `[...]` 里的括号是字面字符，反斜杠吃掉下一字符。
NamedGroups named_groups(std::string_view source) {
    NamedGroups out;
    std::size_t index = 0;
    bool in_class = false;
    for (std::size_t i = 0; i < source.size(); ++i) {
        const char c = source[i];
        if (in_class) {
            if (c == '\\') ++i;
            else if (c == ']') in_class = false;
            continue;
        }
        if (c == '\\') { ++i; continue; }
        if (c == '[') { in_class = true; continue; }
        if (c != '(') continue;
        const bool optional = i + 1 < source.size() && source[i + 1] == '?';
        if (!optional) { ++index; continue; }
        if (i + 2 < source.size() && source[i + 2] == '#') {  // 注释组：整段跳到它的 ')'
            const std::size_t close = source.find(')', i + 3);
            i = close == std::string_view::npos ? source.size() : close;
            continue;
        }
        if (i + 2 < source.size() && source[i + 2] == '<' &&
            i + 3 < source.size() && source[i + 3] != '=' && source[i + 3] != '!') {
            const std::size_t close = source.find('>', i + 3);
            ++index;  // 命名捕获组也要占一个编号（与 mark_count 同序）
            if (close == std::string_view::npos) { i = source.size(); continue; }
            out.items.emplace_back(std::string(source.substr(i + 3, close - i - 3)), index);
            i = close;
            continue;
        }
        // `(?:`、`(?=`、`(?!`、`(?<=`、`(?<!` 都不占编号。
    }
    return out;
}

// 组值的两个来源：真匹配（替换那侧）与只有编号上界（校验那侧，对应 `:49-68` 的 pattern 构造器）。
struct TemplateGroups {
    const std::smatch* match = nullptr;
    std::size_t count = 0;              // `groupCount()`：**不含** 0 号整段
    const NamedGroups* names = nullptr;

    // `:56-61`：越界的组号一律报错；校验模式下值恒为空串。
    std::string group(std::size_t num) const {
        if (num > count) throw std::invalid_argument("No group " + std::to_string(num));
        return match ? (*match)[num].str() : std::string();
    }

    // `:51-54` + `:71`：校验入口（`validate`）按上游是**不**查组名存不存在的。本仓把它提前
    // 查了：MSVC 的 `std::regex` 根本编不出 `(?<name>…)`，名字表永远是空的，等它到写文件时
    // 才炸会留下半批已经改写的文件 —— 而上游点「Replace All」时的**净结果**同样是
    // 「Malformed replacement string: No group with name {x}」且一个字都不写。
    std::string group(const std::string& name) const {
        if (!names) return std::string();
        for (const auto& item : names->items)
            if (item.first == name) return match ? (*match)[item.second].str() : std::string();
        throw std::invalid_argument("No group with name {" + name + "}");
    }
};

struct CaseRegion {
    std::size_t start = 0;
    std::ptrdiff_t end = -1;  // -1 = 一直管到模板末尾（`:218` 的那一支）
    bool upper = false;
};

// 码点写成 UTF-8 字节（上游是 `(char)code` 的单个 UTF-16 code unit；BMP 内两者同字面）。
void append_code_point(std::string& out, unsigned int code) {
    if (code < 0x80) { out += static_cast<char>(code); return; }
    if (code < 0x800) {
        out += static_cast<char>(0xC0 | (code >> 6));
        out += static_cast<char>(0x80 | (code & 0x3F));
        return;
    }
    out += static_cast<char>(0xE0 | (code >> 12));
    out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (code & 0x3F));
}

// `Integer.parseInt(s, 16)`（`RegExReplacementBuilder.java:122`）的形状：可带一个 +/-，
// 之后**必须全是**十六进制数字，否则抛（`0x12` 这种带 x 的也抛 —— Java 不认前缀）。
// JS 的 `Number.parseInt` 会跳过空白、认 `0x` 前缀，所以不能直接拿来用。
bool parse_int_radix16(std::string_view text, int& out) {
    std::size_t i = 0;
    bool negative = false;
    if (i < text.size() && (text[i] == '+' || text[i] == '-')) { negative = text[i] == '-'; ++i; }
    if (i >= text.size()) return false;
    long value = 0;
    for (; i < text.size(); ++i) {
        const char c = text[i];
        const int digit = (c >= '0' && c <= '9') ? c - '0'
                        : (c >= 'a' && c <= 'f') ? c - 'a' + 10
                        : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : -1;
        if (digit < 0) return false;
        value = value * 16 + digit;
    }
    out = static_cast<int>(negative ? -value : value);
    return true;
}

// 展开模板（上游 `createReplacement:87-101` + 它调用的那五个私有方法）。
std::string build_replacement(const TemplateGroups& groups, const std::string& tmpl) {
    std::size_t cursor = 0;
    std::string out;
    std::vector<CaseRegion> regions;

    // `:214-233` startConversionForRegion
    const auto start_region = [&](bool upper) {
        const std::size_t at = out.size();
        if (regions.empty()) { regions.push_back({at, -1, upper}); return; }
        auto& last = regions.back();
        if (last.start == at) { last.end = -1; last.upper = upper; return; }
        if (last.end == -1) {
            if (last.upper == upper) return;
            last.end = static_cast<std::ptrdiff_t>(at);
        }
        regions.push_back({at, -1, upper});
    };
    // `:206-212` startConversionForCharacter
    const auto start_character = [&](bool upper) {
        const std::size_t at = out.size();
        if (regions.empty() || (regions.back().end >= 0 &&
                                static_cast<std::size_t>(regions.back().end) <= at))
            regions.push_back({at, static_cast<std::ptrdiff_t>(at + 1), upper});
    };
    // `:235-247` resetConversionState
    const auto reset_state = [&]() {
        if (regions.empty()) return;
        const std::size_t at = out.size();
        auto& last = regions.back();
        if (last.start >= at) regions.pop_back();
        else if (last.end == -1) last.end = static_cast<std::ptrdiff_t>(at);
    };
    // `:109-136` processEscapedChar
    const auto escaped = [&]() {
        if (cursor >= tmpl.size()) throw std::invalid_argument("character to be escaped is missing");
        const char next = tmpl[cursor++];
        switch (next) {
            case 'n': out += '\n'; return;
            case 'r': out += '\r'; return;
            case 'b': out += '\b'; return;
            case 't': out += '\t'; return;
            case 'f': out += '\f'; return;
            case 'x': {
                if (cursor + 4 <= tmpl.size()) {
                    int code = 0;
                    if (parse_int_radix16(std::string_view(tmpl).substr(cursor, 4), code)) {
                        cursor += 4;
                        append_code_point(out, static_cast<unsigned int>(static_cast<unsigned short>(code)));
                    }
                }
                return;
            }
            case 'l': start_character(false); return;
            case 'u': start_character(true); return;
            case 'L': start_region(false); return;
            case 'U': start_region(true); return;
            case 'E': reset_state(); return;
            default: out += next; return;  // `:134`：认不出的转义**去掉反斜杠**
        }
    };
    // `:138-181` processGroupValue
    const auto group_value = [&]() {
        if (cursor >= tmpl.size())
            throw std::invalid_argument("Illegal group reference: group index is missing");
        const char next = tmpl[cursor++];
        if (next == '{') {
            std::string name;
            while (cursor < tmpl.size()) {
                const char c = tmpl[cursor];
                const bool latin = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
                const bool digit = c >= '0' && c <= '9';
                if (!latin && !digit) break;
                name += c;
                ++cursor;
            }
            if (name.empty()) throw std::invalid_argument("named capturing group has 0 length name");
            if (cursor >= tmpl.size() || tmpl[cursor] != '}')
                throw std::invalid_argument("named capturing group is missing trailing '}'");
            if (name[0] >= '0' && name[0] <= '9')
                throw std::invalid_argument("capturing group name {" + name + "} starts with digit character");
            ++cursor;
            out += groups.group(name);
            return;
        }
        const int ref = next - '0';
        if (ref < 0 || ref > 9) throw std::invalid_argument("Illegal group reference");
        int number = ref;
        // 最长合法组号：多读一位后若超过组数就停（`:167-175`）。
        while (cursor < tmpl.size()) {
            const int digit = tmpl[cursor] - '0';
            if (digit < 0 || digit > 9) break;
            const int candidate = number * 10 + digit;
            if (static_cast<std::size_t>(candidate) > groups.count) break;
            number = candidate;
            ++cursor;
        }
        out += groups.group(static_cast<std::size_t>(number));
    };

    while (cursor < tmpl.size()) {
        const char c = tmpl[cursor++];
        if (c == '\\') escaped();
        else if (c == '$') group_value();
        else out += c;
    }

    // `:183-204` generateResult
    if (regions.empty()) return out;
    auto& last = regions.back();
    if (last.end < 0 || static_cast<std::size_t>(last.end) > out.size())
        last.end = static_cast<std::ptrdiff_t>(out.size());
    std::string result;
    std::size_t at = 0;
    for (const auto& region : regions) {
        result += out.substr(at, region.start - at);
        std::string piece = out.substr(region.start, static_cast<std::size_t>(region.end) - region.start);
        for (char& c : piece)
            c = region.upper ? static_cast<char>(ascii_upper(static_cast<unsigned char>(c)))
                             : static_cast<char>(ascii_lower(static_cast<unsigned char>(c)));
        result += piece;
        at = static_cast<std::size_t>(region.end);
    }
    result += out.substr(at);
    return result;
}

// 一次替换要用的模板上下文：编译好的组数与组名表（每个请求算一次，不逐命中重算）。
struct TemplateContext {
    bool active = false;             // 只有正则档才展开（上游 `getStringToReplace:289-291`）
    std::size_t count = 0;
    NamedGroups names;
};

TemplateContext make_template_context(const Options& options, const std::regex& pattern) {
    TemplateContext ctx;
    if (!options.regex) return ctx;
    ctx.active = true;
    ctx.count = pattern.mark_count();       // 上游 `:65` 的 `pattern.matcher("").groupCount()`
    ctx.names = named_groups(options.query);
    return ctx;
}

// 上游 `RegExReplacementBuilder.validate:76-78` —— 「Replace All」按钮按下前的那道校验
// （`FindPopupPanel.java:1548`）。本仓在真正动笔**之前**跑同一趟，免得半批文件已经改写
// 才发现模板非法（校验模式的组值恒为空串，且**不**校验组名，见 `:51-54`、`:71`）。
void validate_replacement(const TemplateContext& ctx, const std::string& tmpl) {
    if (!ctx.active || tmpl.empty()) return;
    try {
        build_replacement(TemplateGroups{nullptr, ctx.count, &ctx.names}, tmpl);
    } catch (const std::exception& e) {
        // `FindBundle.properties:96`「Malformed replacement string: {0}」，标题 `:97`「Replace Error」。
        fail("INVALID_REQUEST", std::string("替换字符串格式非法：") + e.what());
    }
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
    skipped_non_utf8.store(0);
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
    return {{"matches", std::move(matches)}, {"truncated", truncated}, {"fileCount", files},
            {"skippedNonUtf8", skipped_non_utf8.load()}};
}

// The whole project file list, workspace-relative and '/'-separated. IDEA's scope
// editor walks the content root for two things: the package tree it lets you
// include/exclude from (`ProjectPatternProvider.createTreeModel` ->
// `FileTreeModelBuilder`) and the "Scope contains N of total M files" counter
// (`ScopeEditorPanel.java:796`). Both need the same list, so it comes from one walk.
Json list_files(const fs::path& root) {
    if (root.empty()) fail("NOT_OPEN", "请先打开一个工作区。");
    std::vector<std::string> files;
    const bool complete = walk_paths(root, files);
    std::sort(files.begin(), files.end());
    return {{"files", std::move(files)}, {"truncated", !complete}};
}

Json replace(const fs::path& root, const Options& options) {
    if (root.empty()) fail("NOT_OPEN", "请先打开一个工作区。");
    if (!options.regex && options.query.empty())
        return {{"files", 0}, {"replacements", 0}, {"skippedNonUtf8", 0}};
    Scan scan{compile_globs(options.include, "包含"), compile_globs(options.exclude, "排除"),
              options.regex ? build_query_pattern(options) : std::regex{}, options.regex, options.cancelled};
    skipped_non_utf8.store(0);
    // 动笔之前先校验模板（上游 `FindPopupPanel.java:1548` 的那道 validate）：
    // 半批文件已经改写、才发现模板里写着 `$9`，是上游不会有的事故。
    const TemplateContext tmpl = make_template_context(options, scan.pattern);
    validate_replacement(tmpl, options.replacement);

    std::size_t files = 0, replacements = 0;
    bool truncated = false;
    const bool complete = walk(root, scan, [&](const fs::path& path, const std::string&, const std::string& content) {
        std::string result;
        result.reserve(content.size());
        std::size_t last = 0, hits = 0;
        for_each_match(content, options, scan.has_pattern ? &scan.pattern : nullptr,
            [&](std::size_t pos, std::size_t len, const std::smatch* match) {
                result.append(content, last, pos - last);
                if (match) result += build_replacement(TemplateGroups{match, tmpl.count, &tmpl.names},
                                                       options.replacement);
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
    return {{"files", files}, {"replacements", replacements}, {"truncated", truncated},
            {"skippedNonUtf8", skipped_non_utf8.load()}};
}

// The text a single occurrence becomes: the regex path expands the template with the
// same state machine IDEA runs (`RegExReplacementBuilder`, see the block above), a
// literal search substitutes the plain string. A malformed template is **not** an error
// here: the preview line still has to render while the user is typing it, and the write
// paths (`replace` / `replace_selected`) refuse to start on it after
// `validate_replacement` — which is exactly upstream's split (live preview vs. the
// `FindPopupPanel.java:1548` validation on the Replace button).
static std::string substitution_text(const Options& options, const TemplateContext& tmpl,
                                     const std::string& content, std::size_t pos, std::size_t len,
                                     const std::smatch* match) {
    if (match && tmpl.active) {
        try { return build_replacement(TemplateGroups{match, tmpl.count, &tmpl.names}, options.replacement); }
        catch (const std::exception&) { return options.replacement; }
    }
    (void)content; (void)pos; (void)len;
    return options.replacement;
}

Json chunk_event(std::int64_t stream_id, const Json& matches, std::size_t file_count) {
    return {{"event", "search.chunk"},
            {"streamId", stream_id},
            {"matches", matches},
            {"fileCount", static_cast<std::int64_t>(file_count)},
            {"done", false}};
}

Json preview(const fs::path& root, const Options& options) {
    if (root.empty()) fail("NOT_OPEN", "请先打开一个工作区。");
    if (!options.regex && options.query.empty())
        return {{"matches", Json::array()}, {"truncated", false}, {"fileCount", 0}};
    Scan scan{compile_globs(options.include, "包含"), compile_globs(options.exclude, "排除"),
              options.regex ? build_query_pattern(options) : std::regex{}, options.regex, options.cancelled};

    // 「长什么样」与「落盘落什么」必须是同一份展开，所以预览也走这台机器
    // （模板非法时它照旧退回原样，见 substitution_text 的注释）。
    const TemplateContext tmpl = make_template_context(options, scan.pattern);
    Json matches = Json::array();
    std::size_t files = 0;
    bool truncated = false;
    // 分块发布（见 Options::on_chunk）：`pending` 是还没交出去的那一段。
    Json pending = Json::array();
    auto last_flush = std::chrono::steady_clock::now();
    const auto flush = [&]() {
        if (!options.on_chunk || pending.empty()) return;
        options.on_chunk(pending, files);
        pending = Json::array();
        last_flush = std::chrono::steady_clock::now();
    };
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
                const std::string inserted = substitution_text(options, tmpl, content, pos, len, match);
                matches.push_back({
                    {"path", rel},
                    {"line", line},
                    {"column", static_cast<std::int64_t>(code_points(content, line_start, pos) + 1)},
                    {"length", static_cast<std::int64_t>(code_points(content, pos, pos + len))},
                    {"before", content.substr(pos, len)},
                    // A regex may match across newlines (LF, [\s\S]): len can then
                    // reach past this line's end, so the tail index is clamped —
                    // the preview shows the first line of the substitution.
                    {"after", clip_preview(line_text.substr(0, pos - line_start) + inserted +
                                           line_text.substr(std::min(pos - line_start + len, line_text.size())))},
                    {"preview", clip_preview(std::string_view(line_text))},
                });
                if (options.on_chunk) {
                    pending.push_back(matches.back());
                    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::steady_clock::now() - last_flush).count();
                    if (pending.size() >= options.chunk_max_matches || elapsed >= options.chunk_budget_ms) flush();
                }
                return matches.size() < max_matches;
            });
        if (matches.size() >= max_matches) truncated = true;
        if (matches.size() > before) ++files;
    });
    flush();  // 最后一段（不足一块的那些）也要交出去
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

    // 与 replace() 同一道前置校验：勾选好的那一批不许改到一半才发现模板非法。
    const TemplateContext tmpl = make_template_context(options, scan.pattern);
    validate_replacement(tmpl, options.replacement);

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
                result += substitution_text(options, tmpl, content, pos, len, match);
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
