#include "git.hpp"
#include "git_clone.hpp"
#include "history.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <array>
#include <cctype>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace taocode {
namespace git {
namespace {
namespace fs = std::filesystem;
constexpr std::size_t max_output = 4 * 1024 * 1024;

std::wstring quote(std::wstring_view argument) {
    std::wstring result = L"\"";
    std::size_t slashes = 0;
    for (wchar_t ch : argument) {
        if (ch == L'\\') { ++slashes; continue; }
        if (ch == L'"') { result.append(slashes * 2 + 1, L'\\'); result.push_back(L'"'); slashes = 0; continue; }
        result.append(slashes, L'\\'); slashes = 0;
        result.push_back(ch);
    }
    result.append(slashes * 2, L'\\');
    result.push_back(L'"');
    return result;
}

std::string read_all(HANDLE handle) {
    std::string out;
    std::array<char, 65536> buffer{};
    for (;;) {
        DWORD got = 0;
        if (!ReadFile(handle, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr) || !got) break;
        if (out.size() < max_output) out.append(buffer.data(), got > max_output - out.size() ? max_output - out.size() : got);
    }
    return out;
}

std::wstring utf8_to_wide(std::string_view value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (size <= 0) return {};
    std::wstring out(size, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), out.data(), size);
    return out;
}

struct Result { int code; std::string out; std::string err; };

Result run(const fs::path& repo, std::vector<std::wstring> arguments) {
    const auto git = find_git_executable();
    if (git.empty()) throw WorkspaceError("GIT_MISSING", "未找到 Git，可执行文件不在 PATH 中。");
    std::wstring command = L"\"" + git.native() + L"\" -C \"" + repo.native() + L"\"";
    for (const auto& argument : arguments) command += L" " + quote(argument);
    std::vector<wchar_t> mutable_command(command.begin(), command.end());
    mutable_command.push_back(L'\0');

    SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE stdout_read = nullptr, stdout_write = nullptr, stderr_read = nullptr, stderr_write = nullptr;
    HANDLE null_in = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (!CreatePipe(&stdout_read, &stdout_write, &inheritable, 0) || !CreatePipe(&stderr_read, &stderr_write, &inheritable, 0)) {
        throw WorkspaceError("GIT_PIPE", "无法创建 Git 输出管道");
    }
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = null_in;
    startup.hStdOutput = stdout_write;
    startup.hStdError = stderr_write;
    PROCESS_INFORMATION info{};
    const BOOL created = CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, nullptr, &startup, &info);
    CloseHandle(stdout_write);
    CloseHandle(stderr_write);
    if (null_in != INVALID_HANDLE_VALUE) CloseHandle(null_in);
    if (!created) {
        CloseHandle(stdout_read); CloseHandle(stderr_read);
        throw WorkspaceError("GIT_SPAWN", "无法启动 Git 进程");
    }
    std::string err;
    std::thread stderr_drain([&] { err = read_all(stderr_read); });
    std::string out = read_all(stdout_read);
    stderr_drain.join();
    CloseHandle(stdout_read);
    CloseHandle(stderr_read);
    DWORD code = 1;
    WaitForSingleObject(info.hProcess, INFINITE);
    GetExitCodeProcess(info.hProcess, &code);
    CloseHandle(info.hProcess);
    CloseHandle(info.hThread);
    return {static_cast<int>(code), std::move(out), std::move(err)};
}

std::string trim(std::string value) {
    while (!value.empty() && (value.back() == '\n' || value.back() == '\r' || value.back() == ' ')) value.pop_back();
    std::size_t start = 0;
    while (start < value.size() && value[start] == ' ') ++start;
    return value.substr(start);
}

void require_ok(const Result& result, const std::string& action) {
    if (result.code != 0)
        throw WorkspaceError("GIT_FAILED", action + "失败：" + trim(result.err.empty() ? result.out : result.err));
}

// A caller-supplied revision goes straight onto git's command line, so it has to be a
// ref that actually exists and can never be read as an option.
std::wstring checked_ref(const fs::path& repo, const std::string& base) {
    if (base.empty() || base.size() > 200 || base.front() == '-' || base.find_first_of("\r\n") != std::string::npos)
        throw WorkspaceError("INVALID_REQUEST", "分支名不合法。");
    const auto wide = utf8_to_wide(base);
    const auto check = run(repo, {L"rev-parse", L"--verify", L"--quiet", L"--end-of-options", wide});
    if (check.code != 0) throw WorkspaceError("INVALID_REQUEST", "找不到分支或提交：" + base);
    return wide;
}

std::vector<std::wstring> range_args(const fs::path& repo, const std::string& base) {
    // "git diff HEAD base" reads as "what does that side have that I do not": its files
    // appear as additions, and files only this side has appear as deletions. Comparing
    // tips (not merge bases) is what IDEA's compare view shows.
    return {L"HEAD", checked_ref(repo, base)};
}

}  // namespace

bool available() { return !find_git_executable().empty(); }

std::vector<Change> status(const fs::path& repo) {
    const auto result = run(repo, {L"status", L"--porcelain=v1", L"-z", L"--untracked-files=all"});
    require_ok(result, "读取状态");
    std::vector<Change> changes;
    // Records are NUL-separated: "XY path"; a rename/copy inserts an extra "from" record.
    std::size_t position = 0;
    std::vector<std::string> records;
    while (position <= result.out.size()) {
        const auto end = result.out.find('\0', position);
        if (end == std::string::npos) break;
        records.push_back(result.out.substr(position, end - position));
        position = end + 1;
    }
    for (std::size_t index = 0; index < records.size(); ++index) {
        const std::string& record = records[index];
        if (record.size() < 4) continue;
        const char x = record[0], y = record[1];
        Change change;
        change.path = record.substr(3);
        change.index_status = std::string(1, x);
        change.work_status = std::string(1, y);
        change.untracked = (x == '?' && y == '?');
        change.staged = x != ' ' && x != '?';
        if (x == 'R' || x == 'C' || y == 'R' || y == 'C') {
            if (index + 1 < records.size()) { change.rename_from = records[index + 1]; ++index; }
        }
        changes.push_back(std::move(change));
    }
    return changes;
}

std::string diff(const fs::path& repo, const std::string& path, bool staged, const std::string& base) {
    std::vector<std::wstring> arguments = {L"diff", L"--no-color"};
    if (!base.empty()) { const auto range = range_args(repo, base); arguments.insert(arguments.end(), range.begin(), range.end()); }
    else if (staged) arguments.push_back(L"--cached");
    if (!path.empty()) {
        arguments.push_back(L"--");
        arguments.push_back(utf8_to_wide(path));
    }
    const auto result = run(repo, arguments);
    require_ok(result, "生成差异");
    return result.out;
}

Json diff_sides(const fs::path& repo, const std::string& path, bool staged, const std::string& base) {
    // The unified text is the single source of truth: parsing it keeps the side-by-side
    // view agreeing with the unified one, and needs no second read of the worktree.
    return history::diff_sides_from_unified(diff(repo, path, staged, base));
}

Json compare(const fs::path& repo, const std::string& base) {
    const auto range = range_args(repo, base);
    const auto result = run(repo, {L"diff", L"--name-status", range[0], range[1]});
    require_ok(result, "比较分支");
    Json files = Json::array();
    std::size_t start = 0;
    while (start < result.out.size()) {
        const auto end = result.out.find('\n', start);
        const auto line = result.out.substr(start, end == std::string::npos ? std::string::npos : end - start);
        const auto tab = line.find('\t');
        if (tab != std::string::npos) {
            // R/C records carry two paths; the destination is the one worth opening.
            const auto paths = line.substr(tab + 1);
            const auto second = paths.find('\t');
            Json file{{"status", line.substr(0, tab)},
                      {"path", trim(second == std::string::npos ? paths : paths.substr(second + 1))}};
            if (!file.at("path").get_ref<const std::string&>().empty()) files.push_back(std::move(file));
        }
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return {{"files", std::move(files)}, {"base", base}};
}

std::string head(const fs::path& repo) {
    auto result = run(repo, {L"rev-parse", L"--abbrev-ref", L"HEAD"});
    if (result.code != 0) return {};
    auto name = trim(result.out);
    if (name == "HEAD") {  // detached
        const auto hash = run(repo, {L"rev-parse", L"--short", L"HEAD"});
        return hash.code == 0 ? "(分离于 " + trim(hash.out) + ")" : std::string();
    }
    return name;
}

std::vector<std::string> branches(const fs::path& repo) {
    const auto result = run(repo, {L"branch", L"--format=%(refname:short)"});
    require_ok(result, "读取分支");
    std::vector<std::string> names;
    std::size_t start = 0;
    while (start < result.out.size()) {
        const auto end = result.out.find('\n', start);
        auto line = trim(result.out.substr(start, end == std::string::npos ? std::string::npos : end - start));
        if (!line.empty()) names.push_back(line);
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return names;
}

void stage(const fs::path& repo, const std::string& path) {
    require_ok(run(repo, {L"add", L"--", utf8_to_wide(path)}), "暂存");
}

void unstage(const fs::path& repo, const std::string& path) {
    require_ok(run(repo, {L"reset", L"-q", L"--", utf8_to_wide(path)}), "取消暂存");
}

void commit(const fs::path& repo, const std::string& message, bool amend) {
    if (amend) {
        // IDEA's "Amend": re-write the last commit. An empty message keeps the original.
        std::vector<std::wstring> arguments{L"commit", L"--amend"};
        if (message.empty()) arguments.push_back(L"--no-edit");
        else { arguments.push_back(L"-m"); arguments.push_back(utf8_to_wide(message)); }
        require_ok(run(repo, arguments), "修改上次提交");
        return;
    }
    if (message.empty()) throw WorkspaceError("INVALID_REQUEST", "提交信息不能为空。");
    require_ok(run(repo, {L"commit", L"-m", utf8_to_wide(message)}), "提交");
}

void checkout(const fs::path& repo, const std::string& branch) {
    require_ok(run(repo, {L"checkout", utf8_to_wide(branch)}), "切换分支");
}

namespace {
// Split a single record on the 0x1F unit separator git was asked to emit.
std::vector<std::string> split_unit(const std::string& line) {
    std::vector<std::string> fields;
    std::size_t position = 0;
    while (true) {
        const auto separator = line.find('\x1f', position);
        if (separator == std::string::npos) { fields.push_back(line.substr(position)); break; }
        fields.push_back(line.substr(position, separator - position));
        position = separator + 1;
    }
    return fields;
}

Json parse_records(const std::string& output) {
    Json records = Json::array();
    std::size_t start = 0;
    while (start < output.size()) {
        auto end = output.find('\n', start);
        if (end == std::string::npos) end = output.size();
        const auto line = output.substr(start, end - start);
        start = end + 1;
        if (!line.empty()) records.push_back(split_unit(line));
    }
    return records;
}
}  // namespace

Json log(const fs::path& repo, const std::string& path, int limit) {
    const int count = limit <= 0 ? 50 : (limit > 500 ? 500 : limit);
    std::vector<std::wstring> args = {L"log", L"--date=iso-strict", L"--pretty=%H\x1f%h\x1f%an\x1f%ad\x1f%s", L"-n", utf8_to_wide(std::to_string(count))};
    if (!path.empty()) { args.push_back(L"--"); args.push_back(utf8_to_wide(path)); }
    const auto result = run(repo, args);
    require_ok(result, "读取历史");
    Json commits = Json::array();
    for (const auto& record : parse_records(result.out)) {
        if (record.size() < 5) continue;
        commits.push_back({{"hash", record[0]}, {"shortHash", record[1]}, {"author", record[2]}, {"date", record[3]}, {"subject", record[4]}});
    }
    return {{"commits", std::move(commits)}};
}

Json log_full(const fs::path& repo, int limit) {
    const int count = limit <= 0 ? 200 : (limit > 1000 ? 1000 : limit);
    // %P = parent hashes (space-separated), %d = ref names like " (HEAD -> main, origin/main)"
    std::vector<std::wstring> args = {L"log", L"--date=iso-strict",
        L"--pretty=%H\x1f%h\x1f%an\x1f%ad\x1f%s\x1f%P\x1f%d",
        L"--decorate=full", L"-n", utf8_to_wide(std::to_string(count))};
    const auto result = run(repo, args);
    require_ok(result, "读取提交历史");
    Json commits = Json::array();
    for (const auto& record : parse_records(result.out)) {
        if (record.size() < 7) continue;
        Json parents = Json::array();
        const std::string parents_raw = record[5].get<std::string>();
        if (!parents_raw.empty()) {
            std::istringstream stream(parents_raw);
            std::string token;
            while (stream >> token) parents.push_back(std::move(token));
        }
        Json refs = Json::array();
        // %d output: " (HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0)"
        const std::string raw = record[6].get<std::string>();
        std::size_t start = raw.find('(');
        if (start != std::string::npos) {
            auto end = raw.rfind(')');
            if (end > start) {
                std::istringstream stream(raw.substr(start + 1, end - start - 1));
                std::string token;
                while (std::getline(stream, token, ',')) {
                    while (!token.empty() && token.front() == ' ') token.erase(token.begin());
                    while (!token.empty() && token.back() == ' ') token.pop_back();
                    if (token.empty()) continue;
                    // Strip refs/heads/, refs/remotes/, refs/tags/ prefixes for display.
                    std::string display = token;
                    bool is_tag = false;
                    if (display.starts_with("HEAD -> ") || display.starts_with("HEAD->")) continue;
                    if (display.starts_with("tag: ")) { display = display.substr(5); is_tag = true; }
                    const std::string_view heads = "refs/heads/";
                    const std::string_view remotes = "refs/remotes/";
                    const std::string_view tags = "refs/tags/";
                    if (!is_tag && display.starts_with(heads)) display = display.substr(heads.size());
                    else if (!is_tag && display.starts_with(remotes)) display = display.substr(remotes.size());
                    else if (is_tag && display.starts_with(tags)) display = display.substr(tags.size());
                    refs.push_back({{"name", display}, {"type", is_tag ? "tag" : (token.find("refs/remotes/") != std::string::npos ? "remote" : std::string("local"))}});
                }
            }
        }
        commits.push_back({{"hash", record[0]}, {"shortHash", record[1]}, {"author", record[2]},
                           {"date", record[3]}, {"subject", record[4]},
                           {"parents", std::move(parents)}, {"refs", std::move(refs)}});
    }
    return {{"commits", std::move(commits)}};
}

void pull(const fs::path& repo) { require_ok(run(repo, {L"pull", L"--ff-only"}), "拉取"); }
void push(const fs::path& repo) { require_ok(run(repo, {L"push"}), "推送"); }

Json stash_list(const fs::path& repo) {
    const auto result = run(repo, {L"stash", L"list", L"--pretty=%gd\x1f%s"});
    require_ok(result, "读取储藏");
    Json entries = Json::array();
    for (const auto& record : parse_records(result.out)) {
        if (record.empty()) continue;
        entries.push_back({{"ref", record[0]}, {"message", record.size() > 1 ? record[1].get<std::string>() : std::string()}});
    }
    return {{"entries", std::move(entries)}};
}

void stash_save(const fs::path& repo, const std::string& message) {
    if (message.empty()) require_ok(run(repo, {L"stash", L"push"}), "储藏更改");
    else require_ok(run(repo, {L"stash", L"push", L"-m", utf8_to_wide(message)}), "储藏更改");
}

void stash_pop(const fs::path& repo) { require_ok(run(repo, {L"stash", L"pop"}), "弹出储藏"); }

void create_branch(const fs::path& repo, const std::string& name, bool checkout_now) {
    if (name.empty()) throw WorkspaceError("INVALID_REQUEST", "分支名不能为空。");
    if (checkout_now) require_ok(run(repo, {L"checkout", L"-b", utf8_to_wide(name)}), "新建分支");
    else require_ok(run(repo, {L"branch", utf8_to_wide(name)}), "新建分支");
}

void merge(const fs::path& repo, const std::string& branch) {
    if (branch.empty()) throw WorkspaceError("INVALID_REQUEST", "要合并的分支不能为空。");
    require_ok(run(repo, {L"merge", utf8_to_wide(branch)}), "合并");
}

Json ahead_behind(const fs::path& repo) {
    const auto result = run(repo, {L"rev-list", L"--left-right", L"--count", L"@{u}...HEAD"});
    if (result.code != 0) return {{"available", false}, {"ahead", 0}, {"behind", 0}};
    const auto counts = trim(result.out);
    const auto tab = counts.find('\t');
    const long behind = tab == std::string::npos ? 0 : std::stol(counts.substr(0, tab));
    const long ahead = tab == std::string::npos ? 0 : std::stol(counts.substr(tab + 1));
    return {{"available", true}, {"ahead", ahead}, {"behind", behind}};
}

// --line-porcelain repeats every field per annotated line, so a single forward
// scan yields a {line, hash, author, content} record for each source line.
Json blame(const fs::path& repo, const std::string& path) {
    if (path.empty()) throw WorkspaceError("INVALID_REQUEST", "追溯需要一个文件路径。");
    const auto result = run(repo, {L"blame", L"--line-porcelain", L"--", utf8_to_wide(path)});
    require_ok(result, "读取追溯");
    Json lines = Json::array();
    std::string hash;
    std::string author;
    int final_line = 0;
    std::size_t start = 0;
    while (start <= result.out.size()) {
        auto newline = result.out.find('\n', start);
        if (newline == std::string::npos) newline = result.out.size();
        const auto line = result.out.substr(start, newline - start);
        if (newline == result.out.size()) { start = result.out.size() + 1; }  // final line, no trailing newline
        else start = newline + 1;
        if (line.empty()) continue;
        if (line[0] == '\t') {
            lines.push_back({{"line", final_line}, {"hash", hash.size() >= 8 ? hash.substr(0, 8) : hash}, {"author", author}, {"content", line.substr(1)}});
            continue;
        }
        const bool header = line.size() >= 41 && std::isxdigit(static_cast<unsigned char>(line[0])) &&
                            std::isxdigit(static_cast<unsigned char>(line[39])) && line[40] == ' ';
        if (header) {
            hash = line.substr(0, 40);
            std::istringstream stream(line);
            std::string token;
            int origin = 0, final_ = 0, count = 0;
            if (stream >> token >> origin >> final_ >> count) final_line = final_;
            continue;
        }
        if (line.rfind("author ", 0) == 0) { author = line.substr(7); continue; }
    }
    return {{"lines", std::move(lines)}};
}

}  // namespace git
}  // namespace taocode
