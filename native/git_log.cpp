#include "git_log.hpp"
#include "git.hpp"
#include "history.hpp"
#include <windows.h>

#include <algorithm>
#include <cctype>
#include <regex>
#include <sstream>

namespace taocode::git {
namespace {
namespace fs = std::filesystem;

void invalid(const std::string& message) {
    throw WorkspaceError("INVALID_REQUEST", message);
}

std::string text(const Json& params, const char* key, std::size_t max = 4096) {
    if (!params.contains(key)) return {};
    if (!params.at(key).is_string()) invalid(std::string(key) + " 必须是字符串。");
    auto value = params.at(key).get<std::string>();
    if (value.size() > max || std::any_of(value.begin(), value.end(), [](unsigned char c) { return c < 32 || c == 127; }))
        invalid(std::string(key) + " 过长或包含控制字符。");
    return value;
}

std::vector<std::string> split(const std::string& value, char separator) {
    std::vector<std::string> fields;
    std::size_t start = 0;
    for (std::size_t end; (end = value.find(separator, start)) != std::string::npos; start = end + 1)
        fields.push_back(value.substr(start, end - start));
    if (start < value.size()) fields.push_back(value.substr(start));
    return fields;
}

std::string resolve(const fs::path& repo, const std::string& revision) {
    const auto safe = text(Json{{"revision", revision}}, "revision", 1024);
    if (safe.empty() || safe.front() == '-') invalid("请指定有效提交。");
    auto hash = log_command(repo, {"rev-parse", "--verify", "--end-of-options", safe + "^{commit}"});
    while (!hash.empty() && (hash.back() == '\n' || hash.back() == '\r')) hash.pop_back();
    if ((hash.size() != 40 && hash.size() != 64) ||
        !std::all_of(hash.begin(), hash.end(), [](unsigned char c) { return std::isxdigit(c); }))
        invalid("无法解析提交。");
    return hash;
}

Json parents(const std::string& raw) {
    Json values = Json::array();
    std::istringstream stream(raw);
    for (std::string hash; stream >> hash;) values.push_back(hash);
    return values;
}

Json decorations(const std::string& raw) {
    Json values = Json::array();
    for (auto token : split(raw, ',')) {
        while (!token.empty() && token.front() == ' ') token.erase(token.begin());
        if (token.starts_with("HEAD -> ")) {
            values.push_back({{"name", "HEAD"}, {"type", "head"}});
            token.erase(0, 8);
        }
        std::string type = "local";
        if (token == "HEAD") type = "head";
        if (token.starts_with("tag: ")) { type = "tag"; token.erase(0, 5); }
        if (token.starts_with("refs/heads/")) token.erase(0, 11);
        else if (token.starts_with("refs/remotes/")) { type = "remote"; token.erase(0, 13); }
        else if (token.starts_with("refs/tags/")) { type = "tag"; token.erase(0, 10); }
        if (!token.empty()) values.push_back({{"name", token}, {"type", type}});
    }
    return values;
}

// The log UI's text filter is a pattern, not a literal: `Vcs.Log.EnableFilterByRegexAction`
// picks POSIX ERE (git's `--extended-regexp`) and `Vcs.Log.MatchCaseAction` picks
// `--regexp-ignore-case`. Both default to off (`VcsLogUiPropertiesImpl.TextFilterSettings`
// 的 isRegex/isMatchCase 都是 false），所以出厂行为是「不含正则元字符、忽略大小写」。
// `--author` shares `--fixed-strings` with `--grep`, so a regex text filter would
// otherwise turn the author substring into a pattern. Escape it back to a literal so
// the author filter keeps meaning "contains", whichever text-filter mode is on.
std::string literal_pattern(const std::string& value) {
    static const std::string specials = R"(\.[]()*+?{}|^$/)";
    std::string escaped;
    for (const char ch : value) {
        if (specials.find(ch) != std::string::npos) escaped.push_back('\\');
        escaped.push_back(ch);
    }
    return escaped;
}

void date_filter(std::vector<std::string>& args, const Json& params, const char* key) {
    const auto value = text(params, key, 10);
    if (value.empty()) return;
    if (!std::regex_match(value, std::regex(R"(\d{4}-\d{2}-\d{2})"))) invalid("日期格式必须是 YYYY-MM-DD。");
    const int year = std::stoi(value.substr(0, 4));
    const int month = std::stoi(value.substr(5, 2));
    const int day = std::stoi(value.substr(8, 2));
    const int days[] = {0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month] + (month == 2 && leap))
        invalid("日期无效。");
    // UTC calendar-day bounds, independent of the host's local timezone.
    args.push_back(std::string(key == std::string("since") ? "--since-as-filter=" : "--until=") +
                   value + (key == std::string("since") ? "T00:00:00Z" : "T23:59:59Z"));
}

Json metadata(const fs::path& repo, const std::string& hash) {
    const auto fields = split(log_command(repo, {"show", "-s", "-z", "--no-show-signature", "--encoding=UTF-8",
        "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%P%x00%B", hash, "--"}), '\0');
    if (fields.size() != 10) throw WorkspaceError("GIT_PARSE", "提交元数据格式无效。");
    return {{"revision", fields[0]}, {"hash", fields[0]}, {"shortHash", fields[1]},
            {"author", fields[2]}, {"authorEmail", fields[3]}, {"date", fields[4]},
            {"committer", fields[5]}, {"committerEmail", fields[6]}, {"committerDate", fields[7]},
            {"parents", parents(fields[8])}, {"message", fields[9]}};
}
}  // namespace

Json log_full(const fs::path& repo, int limit) {
    return log_full(repo, Json{{"limit", limit}});
}

Json log_full(const fs::path& repo, const Json& params) {
    if (!params.is_object()) invalid("日志参数必须是对象。");
    for (const auto* key : {"limit", "offset"}) {
        const auto minimum = key == std::string("offset") ? 0LL : -2147483648LL;
        if (params.contains(key) && (!params.at(key).is_number_integer() ||
            params.at(key) < minimum || params.at(key) > 2147483647)) invalid(std::string(key) + " 整数范围无效。");
    }
    const int requested = params.value("limit", 200);
    const int limit = requested <= 0 ? 200 : std::min(requested, 1000);
    const int offset = params.value("offset", 0);
    // `GraphOptionsUtil` / `VcsLogGraphOptionsChooserGroup.java:62-69`: 排序两档
    // （`graph.sort.standard` = 拓扑序 ⇒ `--topo-order`；`graph.sort.off` = 按提交日期
    // ⇒ git 自己的日期序，不加旗标），「第一个父项」⇒ `--first-parent`。
    // 缺省跟上游 `PermanentGraph.Options.Default = Base(SortType.Normal)` 一致：**不**加
    // `--topo-order`。`noMerges` 是 `VcsLogFilterObject.noMerges()`
    // （`VcsLogFilters.kt:213` = `fromParentCount(maxParents = 1)`）⇒ `--no-merges`。
    for (const auto* key : {"firstParent", "noMerges", "textRegex", "matchCase"})
        if (params.contains(key) && !params.at(key).is_boolean())
            invalid(std::string(key) + " 必须是布尔值。");
    const auto sort = text(params, "sort", 32);
    if (!sort.empty() && sort != "date" && sort != "topological") invalid("sort 只能是 date 或 topological。");
    const auto author = text(params, "author");
    const auto pattern = text(params, "text");
    const bool regex = params.value("textRegex", false);
    const bool match_case = params.value("matchCase", false);
    const bool first_parent = params.value("firstParent", false);
    const bool no_merges = params.value("noMerges", false);
    std::vector<std::string> args = {"--literal-pathspecs", "log", "--no-color", "-z",
        "--encoding=UTF-8", "--no-show-signature", "--decorate=full",
        "--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%P%x00%D",
        "--skip=" + std::to_string(offset), "--max-count=" + std::to_string(limit + 1)};
    if (sort == "topological") args.push_back("--topo-order");
    if (first_parent) args.push_back("--first-parent");
    if (no_merges) args.push_back("--no-merges");
    // `--fixed-strings` 是 `--grep`/`--author` 共用的旗标：正则档下它不能开，所以作者
    // 那一条要自己转义回字面量，作者过滤在任何档位下都还是「包含」。
    if (regex) args.push_back("--extended-regexp");
    else args.push_back("--fixed-strings");
    if (!match_case) args.push_back("--regexp-ignore-case");
    if (!author.empty()) args.push_back("--author=" + (regex ? literal_pattern(author) : author));
    if (!pattern.empty()) args.push_back("--grep=" + pattern);
    date_filter(args, params, "since");
    date_filter(args, params, "until");
    const auto since = text(params, "since"), until = text(params, "until");
    if (!since.empty() && !until.empty() && since > until) invalid("起始日期不能晚于结束日期。");
    if (params.contains("refs") && (!params.at("refs").is_array() || params.at("refs").size() > 100))
        invalid("refs 必须是最多 100 项的字符串数组。");
    if (!params.contains("refs") || params.at("refs").empty()) args.push_back("--all");
    else {
        for (const auto& ref : params.at("refs")) {
            if (!ref.is_string()) invalid("refs 必须是字符串数组。");
            args.push_back(resolve(repo, ref.get<std::string>()));
        }
    }
    args.push_back("--");
    const auto path = text(params, "path");
    if (!path.empty()) {
        if (path.front() == '/' || path.find_first_of(":\\") != std::string::npos)
            invalid("path 必须是使用 / 的仓库相对路径。");
        for (const auto& part : split(path, '/')) if (part == "..") invalid("path 不能逃逸仓库。");
        args.push_back(path);
    }
    const auto fields = split(log_command(repo, args), '\0');
    if (fields.size() % 7 != 0) throw WorkspaceError("GIT_PARSE", "提交列表格式无效。");
    Json commits = Json::array();
    for (std::size_t i = 0; i < fields.size() && commits.size() < static_cast<std::size_t>(limit); i += 7) {
        commits.push_back({{"hash", fields[i]}, {"shortHash", fields[i + 1]}, {"author", fields[i + 2]},
            {"date", fields[i + 3]}, {"subject", fields[i + 4]}, {"parents", parents(fields[i + 5])},
            {"refs", decorations(fields[i + 6])}});
    }
    return {{"commits", std::move(commits)}, {"offset", offset}, {"limit", limit},
            {"hasMore", fields.size() / 7 > static_cast<std::size_t>(limit)}};
}

Json commit_details(const fs::path& repo, const std::string& revision) {
    const auto hash = resolve(repo, revision);
    auto details = metadata(repo, hash);
    Json branches = Json::array();
    const auto raw = log_command(repo, {"for-each-ref", "--contains=" + hash, "--format=%(refname)",
                                        "refs/heads/", "refs/remotes/"});
    for (auto branch : split(raw, '\n')) {
        if (!branch.empty() && branch.back() == '\r') branch.pop_back();
        if (!branch.empty()) branches.push_back(branch);
    }
    details["containingBranches"] = std::move(branches);
    return details;
}

Json commit_changes(const fs::path& repo, const std::string& revision) {
    const auto hash = resolve(repo, revision);
    const auto details = metadata(repo, hash);
    const auto commit_parents = details.at("parents");
    auto bases = commit_parents;
    if (bases.empty()) bases.push_back("");
    Json comparisons = Json::array();
    for (const auto& base : bases) {
        const auto parent = base.get<std::string>();
        std::vector<std::string> args = {"diff-tree", "--no-commit-id", "--name-status", "-z", "-r",
                                        "--no-ext-diff", "--no-textconv", "--find-renames"};
        if (parent.empty()) args.push_back("--root");
        else args.push_back(parent);
        args.push_back(hash);
        args.push_back("--");
        const auto fields = split(log_command(repo, args), '\0');
        Json files = Json::array();
        for (std::size_t i = 0; i < fields.size();) {
            const auto status = fields[i++];
            if (status.empty() || i >= fields.size()) throw WorkspaceError("GIT_PARSE", "文件变更格式无效。");
            std::string before = fields[i++], after = before;
            if (status.front() == 'R' || status.front() == 'C') {
                if (i >= fields.size()) throw WorkspaceError("GIT_PARSE", "重命名变更格式无效。");
                after = fields[i++];
            }
            if (status.front() == 'A') before.clear();
            if (status.front() == 'D') after.clear();
            files.push_back({{"status", status}, {"path", after.empty() ? before : after},
                {"beforePath", before}, {"afterPath", after}, {"revision", hash},
                {"beforeRevision", before.empty() ? "" : parent}, {"afterRevision", after.empty() ? "" : hash}});
        }
        comparisons.push_back({{"parent", parent}, {"revision", hash}, {"files", std::move(files)}});
    }
    return {{"revision", hash}, {"parents", commit_parents}, {"comparisons", std::move(comparisons)}};
}

namespace {
constexpr std::size_t file_diff_limit = 1024 * 1024;

struct DiffBlob {
    std::string revision, path, object, content;
    std::string mode;
    std::size_t size = 0;
    bool unsupported = false;
};

DiffBlob diff_blob(const fs::path& repo, const Json& params, const char* revision_key, const char* path_key) {
    if (!params.contains(revision_key) || !params.contains(path_key)) invalid("必须指定 diff 两侧的版本和路径。");
    DiffBlob blob;
    blob.revision = text(params, revision_key, 64);
    blob.path = text(params, path_key);
    if (blob.revision.empty() != blob.path.empty()) invalid("空侧的 revision 和 path 必须同时为空。");
    if (blob.revision.empty()) return blob;
    if ((blob.revision.size() != 40 && blob.revision.size() != 64) ||
        !std::all_of(blob.revision.begin(), blob.revision.end(), [](unsigned char c) { return std::isxdigit(c); }))
        invalid("diff revision 必须是完整提交 hash，不能使用 HEAD、分支或缩写。");
    if (blob.path.front() == '/' || blob.path.back() == '/' || blob.path.find_first_of(":\\") != std::string::npos ||
        blob.path.find("//") != std::string::npos) invalid("diff path 必须是规范的仓库相对文件路径。");
    for (const auto& part : split(blob.path, '/'))
        if (part == "." || part == "..") invalid("diff path 不能包含 . 或 ..。");
    blob.revision = resolve(repo, blob.revision);
    const auto entries = split(log_command(repo, {"--literal-pathspecs", "ls-tree", "-z", blob.revision, "--", blob.path}), '\0');
    bool found = false;
    for (const auto& entry : entries) {
        const auto tab = entry.find('\t');
        if (tab == std::string::npos || entry.substr(tab + 1) != blob.path) continue;
        std::string type;
        std::istringstream header(entry.substr(0, tab));
        header >> blob.mode >> type >> blob.object;
        if (blob.object.empty()) throw WorkspaceError("GIT_PARSE", "文件对象格式无效。");
        found = true;
        blob.unsupported = type != "blob";
        break;
    }
    if (!found) invalid("指定提交中不存在文件：" + blob.path);
    if (blob.unsupported) return blob;
    const auto raw_size = log_command(repo, {"cat-file", "-s", blob.object});
    blob.size = static_cast<std::size_t>(std::stoull(raw_size));
    return blob;
}

bool binary_content(const std::string& content) {
    // Never pass NUL or non-UTF-8 bytes to JSON/the text renderer.
    return content.find('\0') != std::string::npos || (!content.empty() &&
        MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, content.data(), static_cast<int>(content.size()), nullptr, 0) == 0);
}
}  // namespace

Json commit_file_diff(const fs::path& repo, const Json& params) {
    if (!params.is_object()) invalid("diff 参数必须是对象。");
    auto before = diff_blob(repo, params, "beforeRevision", "beforePath");
    auto after = diff_blob(repo, params, "afterRevision", "afterPath");
    if (before.revision.empty() && after.revision.empty()) invalid("diff 两侧不能同时为空。");
    Json result{{"beforeRevision", before.revision}, {"beforePath", before.path},
                {"afterRevision", after.revision}, {"afterPath", after.path},
                {"beforeMode", before.mode}, {"afterMode", after.mode},
                {"beforeSize", before.size}, {"afterSize", after.size}, {"maxBytes", file_diff_limit},
                {"status", "text"}, {"patch", ""}, {"sides", nullptr}};
    if (before.unsupported || after.unsupported) {
        result["status"] = "unsupported"; // Trees and gitlinks are not text files.
        return result;
    }
    if (before.size > file_diff_limit || after.size > file_diff_limit) {
        result["status"] = "tooLarge";
        return result;
    }
    if (!before.object.empty()) before.content = log_command(repo, {"cat-file", "blob", before.object});
    if (!after.object.empty()) after.content = log_command(repo, {"cat-file", "blob", after.object});
    if (binary_content(before.content) || binary_content(after.content)) {
        result["status"] = "binary";
        return result;
    }
    // Bound line-oriented allocation as well as raw bytes before building the LCS.
    if (std::count(before.content.begin(), before.content.end(), '\n') >= 20000 ||
        std::count(after.content.begin(), after.content.end(), '\n') >= 20000) {
        result["status"] = "tooLarge";
        return result;
    }
    // Immutable blobs, not HEAD/the index/the working tree; each side may have a
    // different path. The existing bounded LCS renderer also handles empty sides.
    const auto patch = history::unified_diff(before.content, after.content);
    result["patch"] = patch;
    result["sides"] = history::diff_sides_from_unified(patch);
    result["status"] = result["sides"].value("truncated", false) ? "tooLarge" : "text";
    if (result["status"] == "tooLarge") {
        result["patch"] = "";
        result["sides"] = nullptr;
    }
    return result;
}

Json log_request(const fs::path& repo, const std::string& method, const Json& params) {
    if (method == "git.commitFileDiff") return commit_file_diff(repo, params);
    if (method == "git.logFull") return log_full(repo, params);
    const auto revision = text(params, "revision", 1024);
    if (method == "git.commitDetails") return commit_details(repo, revision);
    return commit_changes(repo, revision);
}
}  // namespace taocode::git
