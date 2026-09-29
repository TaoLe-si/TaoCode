#include "git.hpp"
#include "git_log.hpp"
#include "git_clone.hpp"
#include "history.hpp"
#include "time_format.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <array>
#include <atomic>
#include <cctype>
#include <ctime>
#include <fstream>
#include <iterator>
#include <mutex>
#include <set>
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

std::string wide_to_utf8(std::wstring_view value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                                         nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string out(static_cast<std::size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                        out.data(), size, nullptr, nullptr);
    return out;
}

struct Result { int code; std::string out; std::string err; };

// A git command that hangs — a remote that never answers, a credential helper
// waiting on the stdin we deliberately left at NUL — must not pin the worker
// thread forever, and closing the project must be able to stop it. So every child
// runs inside a job object (killing it takes the whole tree: git spawns ssh and
// credential helpers of its own) and gets a bounded wait.
constexpr DWORD default_timeout_ms = 10 * 60 * 1000;  // a large clone/push fits in this
constexpr DWORD kill_wait_ms = 5000;                  // grace for the tree to actually die

// Handles of the child currently running. request_cancel() reads them from the UI
// thread while a worker runs git, so they are published and cleared under this
// mutex, and the kill is issued while holding it: a handle can then never be
// terminated after run() closed it (which would otherwise risk killing whatever
// process later reused that handle value).
std::mutex current_mutex;
HANDLE current_job = nullptr;       // job object of the running child, nullptr if none
HANDLE current_process = nullptr;   // fallback if no job object could be created

void kill_current() {
    std::lock_guard lock(current_mutex);
    if (current_job) TerminateJobObject(current_job, 1);
    else if (current_process) TerminateProcess(current_process, 1);
}

Result run(const fs::path& repo, std::vector<std::wstring> arguments, DWORD timeout_ms = default_timeout_ms) {
    const auto git = find_git_executable();
    if (git.empty()) throw WorkspaceError("GIT_MISSING", "未找到 Git，可执行文件不在 PATH 中。");
    std::wstring command = L"\"" + git.native() + L"\" -C \"" + repo.native() + L"\"";
    for (const auto& argument : arguments) command += L" " + quote(argument);
    std::vector<wchar_t> mutable_command(command.begin(), command.end());
    mutable_command.push_back(L'\0');

    SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE stdout_read = nullptr, stdout_write = nullptr, stderr_read = nullptr, stderr_write = nullptr;
    HANDLE null_in = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    // Created one pair at a time: the old single `||` expression threw with the first
    // pair already open, leaking two handles per failed git call (and one NUL handle).
    if (!CreatePipe(&stdout_read, &stdout_write, &inheritable, 0)) {
        if (null_in != INVALID_HANDLE_VALUE) CloseHandle(null_in);
        throw WorkspaceError("GIT_PIPE", "无法创建 Git 输出管道");
    }
    if (!CreatePipe(&stderr_read, &stderr_write, &inheritable, 0)) {
        CloseHandle(stdout_read);
        CloseHandle(stdout_write);
        if (null_in != INVALID_HANDLE_VALUE) CloseHandle(null_in);
        throw WorkspaceError("GIT_PIPE", "无法创建 Git 输出管道");
    }
    // The child is born suspended so it can be put in a job before it can spawn
    // anything of its own — otherwise a grandchild (ssh, a credential helper) can
    // slip out of the job and survive the kill.
    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    if (job) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
            CloseHandle(job);
            job = nullptr;
        }
    }
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = null_in;
    startup.hStdOutput = stdout_write;
    startup.hStdError = stderr_write;
    PROCESS_INFORMATION info{};
    const BOOL created = CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, TRUE,
                                        CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, nullptr, &startup, &info);
    CloseHandle(stdout_write);
    CloseHandle(stderr_write);
    if (null_in != INVALID_HANDLE_VALUE) CloseHandle(null_in);
    if (!created) {
        CloseHandle(stdout_read); CloseHandle(stderr_read);
        if (job) CloseHandle(job);
        throw WorkspaceError("GIT_SPAWN", "无法启动 Git 进程");
    }
    if (job && !AssignProcessToJobObject(job, info.hProcess)) {  // rare; fall back to the bare process
        CloseHandle(job);
        job = nullptr;
    }
    {
        std::lock_guard lock(current_mutex);
        current_job = job;
        current_process = info.hProcess;
    }
    ResumeThread(info.hThread);

    std::atomic<bool> timed_out{false};
    // The reads below block while the child holds the pipes open, so the timeout has
    // to be armed before them: on expiry this kills the tree, which breaks the pipes
    // and lets run() return instead of hanging in ReadFile forever.
    std::thread watchdog([&] {
        if (WaitForSingleObject(info.hProcess, timeout_ms) == WAIT_TIMEOUT) {
            timed_out.store(true);
            kill_current();
        }
    });
    std::string err;
    std::thread stderr_drain([&] { err = read_all(stderr_read); });
    std::string out = read_all(stdout_read);
    stderr_drain.join();
    watchdog.join();
    CloseHandle(stdout_read);
    CloseHandle(stderr_read);
    DWORD code = 1;
    if (timed_out.load()) WaitForSingleObject(info.hProcess, kill_wait_ms);
    GetExitCodeProcess(info.hProcess, &code);
    CloseHandle(info.hProcess);
    CloseHandle(info.hThread);
    {
        std::lock_guard lock(current_mutex);
        current_job = nullptr;
        current_process = nullptr;
    }
    if (job) CloseHandle(job);
    if (timed_out.load()) {
        const std::string what = arguments.empty() ? std::string() : wide_to_utf8(arguments.front());
        throw WorkspaceError("GIT_TIMEOUT", "git " + what + " 超时（超过 " +
                                                std::to_string(timeout_ms / 60000) + " 分钟），已终止该命令。");
    }
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

// A ref the caller is about to CREATE (a branch or a tag). Nothing in the repo can
// vouch for it yet, so rev-parse cannot be used; instead it is held to what git
// itself would accept before it ever reaches a command line: no leading '-' (which
// git would parse as an option, e.g. -f / --hard), no spaces, no control characters.
std::wstring checked_new_name(const std::string& name, const std::string& label) {
    if (name.empty() || name.size() > 200)
        throw WorkspaceError("INVALID_REQUEST", label + "不能为空，且不能超过 200 个字符。");
    if (name.front() == '-')
        throw WorkspaceError("INVALID_REQUEST", label + "不能以 '-' 开头，否则会被 Git 当成命令行选项。");
    for (const char ch : name) {
        const auto value = static_cast<unsigned char>(ch);
        if (ch == ' ' || value < 32 || value == 127)
            throw WorkspaceError("INVALID_REQUEST", label + "不能包含空格或控制字符。");
    }
    const auto wide = utf8_to_wide(name);
    if (wide.empty()) throw WorkspaceError("INVALID_REQUEST", label + "必须是有效的 UTF-8 文本。");
    return wide;
}

std::vector<std::wstring> range_args(const fs::path& repo, const std::string& base) {
    // "git diff HEAD base" reads as "what does that side have that I do not": its files
    // appear as additions, and files only this side has appear as deletions. Comparing
    // tips (not merge bases) is what IDEA's compare view shows.
    return {L"HEAD", checked_ref(repo, base)};
}

}  // namespace

// Stop the git command that is running right now, if any. Called from the UI thread
// (closing a project or the window) while a worker thread is inside run():
// terminating the job takes git and every process it spawned, which also breaks the
// pipes the reader is parked on, so the worker returns. Non-blocking, and a no-op
// when nothing runs. Deliberately outside the anonymous namespace above — it is
// declared in git.hpp and must have external linkage.
void request_cancel() { kill_current(); }

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

std::string diff(const fs::path& repo, const std::string& path, bool staged, const std::string& base, int context) {
    std::vector<std::wstring> arguments = {L"diff", L"--no-color"};
    if (context > 0) arguments.push_back(L"-U" + std::to_wstring(context));
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

Json diff_sides(const fs::path& repo, const std::string& path, bool staged, const std::string& base, int context) {
    // The unified text is the single source of truth: parsing it keeps the side-by-side
    // view agreeing with the unified one, and needs no second read of the worktree.
    return history::diff_sides_from_unified(diff(repo, path, staged, base, context));
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

namespace {
// `git commit --author=` takes "Name <email>" (or a bare "<email>"), and the value is a
// single argv entry so nothing is re-parsed by a shell. It still has to be well formed:
// git rejects a missing email, and a control character would be written into the commit
// object verbatim.
std::wstring format_author(const std::string& name, const std::string& email) {
    const auto trimmed_email = trim(email);
    if (trimmed_email.empty()) throw WorkspaceError("INVALID_REQUEST", "指定提交作者时必须同时填写邮箱。");
    for (const auto* field : {&name, &email}) {
        for (const char character : *field) {
            if (static_cast<unsigned char>(character) < 0x20) {
                throw WorkspaceError("INVALID_REQUEST", "提交作者不能包含控制字符。");
            }
        }
    }
    const auto trimmed_name = trim(name);
    return utf8_to_wide(trimmed_name.empty() ? "<" + trimmed_email + ">" : trimmed_name + " <" + trimmed_email + ">");
}
}  // namespace

void commit(const fs::path& repo, const std::string& message, bool amend, bool signoff,
            const std::string& author_name, const std::string& author_email) {
    // IDEA's CommitAuthorComponent: the author override is per commit, not per repository.
    const bool override_author = !trim(author_name).empty() || !trim(author_email).empty();
    if (amend) {
        // IDEA's "Amend": re-write the last commit. An empty message keeps the original.
        std::vector<std::wstring> arguments{L"commit", L"--amend"};
        if (signoff) arguments.push_back(L"--signoff");
        if (override_author) arguments.push_back(L"--author=" + format_author(author_name, author_email));
        if (message.empty()) arguments.push_back(L"--no-edit");
        else { arguments.push_back(L"-m"); arguments.push_back(utf8_to_wide(message)); }
        require_ok(run(repo, arguments), "修改上次提交");
        return;
    }
    if (message.empty()) throw WorkspaceError("INVALID_REQUEST", "提交信息不能为空。");
    std::vector<std::wstring> arguments{L"commit", L"-m", utf8_to_wide(message)};
    if (signoff) arguments.push_back(L"--signoff");
    if (override_author) arguments.push_back(L"--author=" + format_author(author_name, author_email));
    require_ok(run(repo, arguments), "提交");
}

Json user(const fs::path& repo) {
    const auto read = [&repo](const std::wstring& key) {
        const auto result = run(repo, {L"config", L"--get", key});
        // `git config --get` exits 1 when the key is simply not set; that is not an error.
        return result.code == 0 ? trim(result.out) : std::string();
    };
    return {{"name", read(L"user.name")}, {"email", read(L"user.email")}};
}

void checkout(const fs::path& repo, const std::string& branch) {
    if (branch.empty()) throw WorkspaceError("INVALID_REQUEST", "要切换的分支不能为空。");
    // checked_ref: the name is a ref that must exist, and it can never start with
    // '-', which git would otherwise read as an option (`git checkout --hard …`).
    require_ok(run(repo, {L"checkout", checked_ref(repo, branch)}), "切换分支");
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

Json authors(const fs::path& repo) {
    // IDEA's registry holds the users the log index has seen (VcsUserRegistryImpl.kt:84-92),
    // so every reachable commit counts, not just the ones on HEAD.
    const auto result = run(repo, {L"log", L"--all", L"--pretty=%an\x1f%ae"});
    // A repository without commits has no log; `git log` errors there, and GitUserRegistry
    // swallows the same failure (GitUserRegistry.java:60-68 -> LOG.warn + null).
    if (result.code != 0) return {{"authors", Json::array()}};
    Json list = Json::array();
    std::set<std::string> seen;
    for (const auto& record : parse_records(result.out)) {
        if (record.size() < 2) continue;
        const auto name = trim(record[0].get<std::string>());
        const auto email = trim(record[1].get<std::string>());
        if (name.empty() && email.empty()) continue;
        // Two users are equal when name and e-mail match, and createUser stores the e-mail
        // lower-cased (VcsUserImpl.kt:9, VcsUserUtil.java:91-93).
        std::string folded_email = email;
        for (char& character : folded_email) character = static_cast<char>(std::tolower(static_cast<unsigned char>(character)));
        if (!seen.insert(name + "\x1f" + folded_email).second) continue;
        // VcsUserUtil.getString: the name, else the e-mail, else "Name <email>".
        list.push_back(name.empty() ? email : (email.empty() ? name : name + " <" + email + ">"));
    }
    return {{"authors", std::move(list)}};
}

std::string log_command(const fs::path& repo, const std::vector<std::string>& arguments) {
    std::vector<std::wstring> args;
    for (const auto& argument : arguments) {
        const auto value = utf8_to_wide(argument);
        if (argument.find('\0') != std::string::npos || (!argument.empty() && value.empty()))
            throw WorkspaceError("INVALID_REQUEST", "Git 参数必须是有效的 UTF-8 文本且不能包含 NUL。");
        args.push_back(value);
    }
    const auto result = run(repo, args);
    require_ok(result, "读取 Git 日志");
    if (result.out.size() >= max_output)
        throw WorkspaceError("GIT_OUTPUT_LIMIT", "Git 输出超过大小限制，请缩小查询范围。");
    return result.out;
}

// IDEA's Git.Pull defaults to merge (not --ff-only); ff-only is an opt-in variant
// reachable through a separate action. Plain `git pull` here matches what happens
// when the user just clicks Pull.
void pull(const fs::path& repo) { require_ok(run(repo, {L"pull"}), "拉取"); }
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
    // The branch does not exist yet, so it cannot be resolved with rev-parse; it is
    // still a name landing on git's command line and gets the same option/control
    // character rejection an existing ref would.
    const auto wide = checked_new_name(name, "分支名");
    if (checkout_now) require_ok(run(repo, {L"checkout", L"-b", wide}), "新建分支");
    else require_ok(run(repo, {L"branch", wide}), "新建分支");
}

void merge(const fs::path& repo, const std::string& branch) {
    if (branch.empty()) throw WorkspaceError("INVALID_REQUEST", "要合并的分支不能为空。");
    require_ok(run(repo, {L"merge", checked_ref(repo, branch)}), "合并");
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
// The annotation column also needs the commit date / mail / summary (IDEA's
// `FileAnnotation.getDate()` / `getAuthor()` / tooltip), so those are captured too.
Json blame(const fs::path& repo, const std::string& path) {
    if (path.empty()) throw WorkspaceError("INVALID_REQUEST", "追溯需要一个文件路径。");
    const auto result = run(repo, {L"blame", L"--line-porcelain", L"--", utf8_to_wide(path)});
    require_ok(result, "读取追溯");
    Json lines = Json::array();
    std::string hash;
    std::string author;
    std::string mail;
    std::string date;
    std::string summary;
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
            lines.push_back({{"line", final_line}, {"hash", hash.size() >= 8 ? hash.substr(0, 8) : hash},
                {"author", author}, {"email", mail}, {"date", date}, {"summary", summary}, {"content", line.substr(1)}});
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
        if (line.rfind("author-mail ", 0) == 0) {
            // porcelain wraps the address in angle brackets: <someone@example.com>
            std::string value = line.substr(12);
            if (value.size() >= 2 && value.front() == '<' && value.back() == '>') value = value.substr(1, value.size() - 2);
            mail = value;
            continue;
        }
        if (line.rfind("author-time ", 0) == 0) {
            // `author-time` 是 epoch 秒；注解列显示的是日期（IDEA 的注解列给的就是日期）。
            try { date = format_local_time(std::stoll(line.substr(12)), "%Y-%m-%d", 16); } catch (...) { date.clear(); }
            continue;
        }
        if (line.rfind("summary ", 0) == 0) { summary = line.substr(8); continue; }
    }
    return {{"lines", std::move(lines)}};
}

void fetch(const fs::path& repo) { require_ok(run(repo, {L"fetch", L"--all", L"--prune"}), "获取"); }

void rebase(const fs::path& repo, const std::string& branch) {
    if (branch.empty()) require_ok(run(repo, {L"rebase"}), "变基");
    // checked_ref: "-f" / "--onto" and friends must never be read as options.
    else require_ok(run(repo, {L"rebase", checked_ref(repo, branch)}), "变基");
}

void cherry_pick(const fs::path& repo, const std::string& commit) {
    if (commit.empty()) throw WorkspaceError("INVALID_REQUEST", "要摘取的提交不能为空。");
    require_ok(run(repo, {L"cherry-pick", checked_ref(repo, commit)}), "摘取提交");
}

void delete_branch(const fs::path& repo, const std::string& name) {
    if (name.empty()) throw WorkspaceError("INVALID_REQUEST", "要删除的分支不能为空。");
    require_ok(run(repo, {L"branch", L"-D", checked_ref(repo, name)}), "删除分支");
}

Json tag_list(const fs::path& repo) {
    const auto result = run(repo, {L"tag", L"--list"});
    require_ok(result, "读取标签");
    Json tags = Json::array();
    std::istringstream stream(result.out);
    std::string name;
    while (std::getline(stream, name)) {
        if (!name.empty() && name.back() == '\r') name.pop_back();
        if (!name.empty()) tags.push_back(name);
    }
    return {{"tags", std::move(tags)}};
}

void tag_create(const fs::path& repo, const std::string& name, const std::string& target) {
    // The tag is new (checked_new_name), the optional target is an existing ref.
    std::vector<std::wstring> arguments{L"tag", checked_new_name(name, "标签名")};
    if (!target.empty()) arguments.push_back(checked_ref(repo, target));
    require_ok(run(repo, arguments), "新建标签");
}

void tag_delete(const fs::path& repo, const std::string& name) {
    if (name.empty()) throw WorkspaceError("INVALID_REQUEST", "要删除的标签不能为空。");
    // The tag has to exist to be deleted, so checked_ref is the right guard here.
    require_ok(run(repo, {L"tag", L"-d", checked_ref(repo, name)}), "删除标签");
}

void ignore_path(const fs::path& repo, const std::string& path) {
    if (path.empty() || path.find('\n') != std::string::npos || path.find('\r') != std::string::npos)
        throw WorkspaceError("INVALID_REQUEST", "要忽略的路径无效。");
    const auto ignore = repo / ".gitignore";
    std::string existing;
    {
        std::ifstream stream(ignore, std::ios::binary);
        if (stream) existing = std::string(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
    }
    for (std::size_t start = 0, end; start < existing.size(); start = end + 1) {
        end = existing.find('\n', start);
        const auto line = existing.substr(start, (end == std::string::npos ? existing.size() : end) - start);
        const auto comparable = !line.empty() && line.back() == '\r' ? line.substr(0, line.size() - 1) : line;
        if (comparable == path) return;  // already ignored
        if (end == std::string::npos) break;
    }
    std::ofstream stream(ignore, std::ios::binary | std::ios::app);
    if (!stream) throw WorkspaceError("IO_ERROR", "无法写入 .gitignore。");
    if (!existing.empty() && existing.back() != '\n') stream << '\n';
    stream << path << '\n';
}

namespace {

struct DiffHunk { int index; std::string header; std::string body; };

// Split a unified diff (as produced by git diff [--cached] -- <path>) into the
// file header plus each "@@" hunk. Header lines are everything before the first @@.
std::pair<std::string, std::vector<DiffHunk>> split_hunks(const std::string& unified) {
    std::string header;
    std::vector<DiffHunk> hunks;
    std::istringstream stream(unified);
    std::string line;
    bool in_header = true;
    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (in_header && line.rfind("@@", 0) == 0) in_header = false;
        if (in_header) { header += line + "\n"; continue; }
        if (line.rfind("@@", 0) == 0) hunks.push_back({static_cast<int>(hunks.size()), line + "\n", ""});
        else if (!hunks.empty()) hunks.back().body += line + "\n";
    }
    return {header, hunks};
}

}  // namespace

Json diff_hunks(const fs::path& repo, const std::string& path, bool staged) {
    const auto unified = diff(repo, path, staged);
    const auto [header, hunks] = split_hunks(unified);
    Json list = Json::array();
    for (const auto& hunk : hunks) {
        int additions = 0, deletions = 0;
        std::istringstream body(hunk.body);
        std::string line;
        while (std::getline(body, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (!line.empty() && line[0] == '+') ++additions;
            else if (!line.empty() && line[0] == '-') ++deletions;
        }
        list.push_back({{"index", hunk.index}, {"header", hunk.header},
                        {"body", hunk.body}, {"additions", additions}, {"deletions", deletions}});
    }
    return {{"hunks", std::move(list)}, {"header", header}};
}

void apply_hunks(const fs::path& repo, const std::string& path, bool staged,
                 const std::vector<int>& hunks, bool reverse) {
    if (hunks.empty()) throw WorkspaceError("INVALID_REQUEST", "没有选择任何改动块。");
    if (hunks.size() > 512) throw WorkspaceError("INVALID_REQUEST", "单次应用的改动块过多。");
    const auto unified = diff(repo, path, staged);
    const auto [header, available] = split_hunks(unified);
    std::string patch = header;
    for (const int wanted : hunks) {
        if (wanted < 0 || static_cast<std::size_t>(wanted) >= available.size())
            throw WorkspaceError("INVALID_REQUEST", "所选改动块不在当前差异中（差异可能已变化，请刷新）。");
        patch += available[static_cast<std::size_t>(wanted)].header + available[static_cast<std::size_t>(wanted)].body;
    }
    // The patch is fed through a file inside .git so it never shows up as an
    // untracked change in the very status this staging is about to affect.
    const auto patch_file = repo / ".git" / "taocode-apply.patch";
    {
        std::ofstream stream(patch_file, std::ios::binary | std::ios::trunc);
        if (!stream) throw WorkspaceError("IO_ERROR", "无法写入补丁临时文件。");
        stream.write(patch.data(), static_cast<std::streamsize>(patch.size()));
        if (!stream) throw WorkspaceError("IO_ERROR", "写入补丁临时文件失败。");
    }
    std::vector<std::wstring> arguments{L"apply", L"--cached", L"--recount"};
    if (reverse) arguments.push_back(L"--reverse");
    arguments.push_back(L".git/taocode-apply.patch");
    const auto result = run(repo, arguments);
    std::error_code ignored;
    fs::remove(patch_file, ignored);
    require_ok(result, reverse ? "按块取消暂存" : "按块暂存");
}

namespace {

std::vector<std::string> split_lines(const std::string& text) {
    std::vector<std::string> lines;
    std::size_t start = 0;
    while (start < text.size()) {
        auto end = text.find('\n', start);
        if (end == std::string::npos) end = text.size();
        auto line = text.substr(start, end - start);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        lines.push_back(std::move(line));
        start = end + 1;
    }
    return lines;
}

// Same 0x1F-separated record format log() asks git for.
std::vector<std::string> split_fields(const std::string& line) {
    std::vector<std::string> fields;
    std::size_t position = 0;
    for (;;) {
        const auto separator = line.find('\x1f', position);
        if (separator == std::string::npos) { fields.push_back(line.substr(position)); break; }
        fields.push_back(line.substr(position, separator - position));
        position = separator + 1;
    }
    return fields;
}

std::string utf8_path(const fs::path& path) {
    const auto text = path.generic_u8string();
    return {reinterpret_cast<const char*>(text.data()), text.size()};
}

// A path spec is user-controlled and lands on git's command line after "--", so it
// only has to stay inside the repository: no traversal, no newline, no option.
std::wstring checked_path(const std::string& path) {
    if (path.empty() || path.size() > 512 || path.front() == '-' ||
        path.find('\n') != std::string::npos || path.find('\r') != std::string::npos ||
        path.find("..") != std::string::npos)
        throw WorkspaceError("INVALID_REQUEST", "文件路径不合法。");
    return utf8_to_wide(path);
}

// A worktree destination: an absolute path outside the current repo (git refuses a
// nested worktree) with no characters that would confuse the command line.
void check_worktree_path(const fs::path& repo, const std::string& path) {
    if (path.empty() || path.size() > 512 || path.front() == '-' ||
        path.find_first_of("\r\n") != std::string::npos)
        throw WorkspaceError("INVALID_REQUEST", "工作树路径不合法。");
    const fs::path target(path);
    if (!target.is_absolute()) throw WorkspaceError("INVALID_REQUEST", "工作树路径必须是绝对路径。");
    std::error_code ec;
    const auto canonical_repo = fs::weakly_canonical(repo, ec);
    const auto canonical_target = fs::weakly_canonical(target, ec);
    if (!canonical_target.empty() && !canonical_repo.empty() &&
        canonical_target.native().starts_with(canonical_repo.native()))
        throw WorkspaceError("INVALID_REQUEST", "工作树不能放在当前仓库目录内。");
}

}  // namespace

Json file_history(const fs::path& repo, const std::string& path, int limit) {
    const int count = limit <= 0 ? 100 : (limit > 500 ? 500 : limit);
    const auto target = checked_path(path);
    // --follow keeps the log going across renames; --name-status reports what the
    // commit did to the file so the UI can mark the rename commits.
    std::vector<std::wstring> args = {L"log", L"--follow", L"--date=iso-strict", L"--name-status",
        L"--pretty=%H\x1f%h\x1f%an\x1f%ad\x1f%s", L"-n", utf8_to_wide(std::to_string(count)), L"--", target};
    const auto result = run(repo, args);
    require_ok(result, "读取文件历史");
    Json commits = Json::array();
    std::string pending;
    std::vector<std::string> pending_paths;
    for (const auto& line : split_lines(result.out)) {
        if (line.find('\x1f') != std::string::npos) {
            if (!pending.empty()) {
                const auto record = split_fields(pending);
                if (record.size() >= 5)
                    commits.push_back({{"hash", record[0]}, {"shortHash", record[1]}, {"author", record[2]},
                                       {"date", record[3]}, {"subject", record[4]},
                                       {"paths", pending_paths}});
            }
            pending = line;
            pending_paths.clear();
            continue;
        }
        if (line.empty()) continue;
        // "M\tpath", "R100\told\tnew", "A\tpath"…
        const auto tab = line.find('\t');
        if (tab == std::string::npos) continue;
        const std::string status = line.substr(0, tab);
        const std::string rest = line.substr(tab + 1);
        if (status.rfind('R', 0) == 0 || status.rfind('C', 0) == 0) {
            const auto second = rest.find('\t');
            if (second != std::string::npos)
                pending_paths.push_back(rest.substr(second + 1) + " (← " + rest.substr(0, second) + ")");
            else pending_paths.push_back(rest);
        } else pending_paths.push_back(rest);
    }
    if (!pending.empty()) {
        const auto record = split_fields(pending);
        if (record.size() >= 5)
            commits.push_back({{"hash", record[0]}, {"shortHash", record[1]}, {"author", record[2]},
                               {"date", record[3]}, {"subject", record[4]}, {"paths", pending_paths}});
    }
    return {{"path", path}, {"commits", std::move(commits)}};
}

Json show_commit(const fs::path& repo, const std::string& revision) {
    if (revision.empty()) throw WorkspaceError("INVALID_REQUEST", "请指定提交。");
    const auto rev = checked_ref(repo, revision);
    std::vector<std::wstring> args = {L"show", L"--format=", L"--no-color", L"--date=iso-strict",
                                      L"-m", L"--first-parent", rev};
    const auto result = run(repo, args);
    require_ok(result, "读取提交内容");
    const std::string patch = result.out;
    return {{"revision", revision}, {"patch", patch}, {"sides", history::diff_sides_from_unified(patch)}};
}

Json worktree_list(const fs::path& repo) {
    const auto result = run(repo, {L"worktree", L"list", L"--porcelain"});
    require_ok(result, "读取工作树列表");
    Json list = Json::array();
    Json current = Json::object();
    for (const auto& line : split_lines(result.out)) {
        if (line.empty()) {
            if (!current.empty()) { list.push_back(std::move(current)); current = Json::object(); }
            continue;
        }
        if (line.rfind("worktree ", 0) == 0) current["path"] = utf8_path(line.substr(9));
        else if (line.rfind("HEAD ", 0) == 0) current["head"] = line.substr(5);
        else if (line.rfind("branch ", 0) == 0) current["branch"] = line.substr(7);
        else if (line == "bare") current["bare"] = true;
        else if (line == "detached") current["detached"] = true;
        else if (line == "locked") current["locked"] = true;
        else if (line == "prunable") current["prunable"] = true;
    }
    if (!current.empty()) list.push_back(std::move(current));
    for (auto& entry : list) {
        if (!entry.contains("branch")) entry["branch"] = entry.value("detached", false) ? "detached" : "";
        if (!entry.contains("bare")) entry["bare"] = false;
        if (!entry.contains("locked")) entry["locked"] = false;
        if (!entry.contains("prunable")) entry["prunable"] = false;
    }
    return {{"worktrees", std::move(list)}};
}

void worktree_add(const fs::path& repo, const std::string& path, const std::string& branch, bool new_branch) {
    check_worktree_path(repo, path);
    std::vector<std::wstring> args = {L"worktree", L"add"};
    if (!branch.empty()) {
        if (branch.size() > 200 || branch.front() == '-' || branch.find_first_of("\r\n ") != std::string::npos)
            throw WorkspaceError("INVALID_REQUEST", "分支名不合法。");
        if (new_branch) args.push_back(L"-b");
        args.push_back(utf8_to_wide(branch));
    }
    args.push_back(utf8_to_wide(path));
    const auto result = run(repo, args);
    require_ok(result, "添加工作树");
}

void worktree_remove(const fs::path& repo, const std::string& path, bool force) {
    if (path.empty() || path.size() > 512 || path.front() == '-' || path.find_first_of("\r\n") != std::string::npos)
        throw WorkspaceError("INVALID_REQUEST", "工作树路径不合法。");
    std::vector<std::wstring> args = {L"worktree", L"remove"};
    if (force) args.push_back(L"--force");
    args.push_back(utf8_to_wide(path));
    const auto result = run(repo, args);
    require_ok(result, "移除工作树");
}

Json submodule_status(const fs::path& repo) {
    const auto result = run(repo, {L"submodule", L"status"});
    require_ok(result, "读取子模块状态");
    Json list = Json::array();
    for (const auto& raw : split_lines(result.out)) {
        if (raw.size() < 2) continue;
        const char status = raw[0];
        std::string rest = raw.substr(1);
        while (!rest.empty() && rest.front() == ' ') rest.erase(rest.begin());
        const auto space = rest.find(' ');
        const std::string commit = space == std::string::npos ? rest : rest.substr(0, space);
        std::string path = space == std::string::npos ? std::string() : rest.substr(space + 1);
        std::string describe;
        const auto paren = path.find(" (");
        if (paren != std::string::npos && path.back() == ')') {
            describe = path.substr(paren + 2, path.size() - paren - 3);
            path = path.substr(0, paren);
        }
        list.push_back({{"status", std::string(1, status)}, {"commit", commit},
                        {"path", path}, {"describe", describe}});
    }
    return {{"submodules", std::move(list)}};
}

void submodule_update(const fs::path& repo, bool init, bool recursive) {
    std::vector<std::wstring> args = {L"submodule", L"update"};
    if (init) args.push_back(L"--init");
    if (recursive) args.push_back(L"--recursive");
    const auto result = run(repo, args);
    require_ok(result, "更新子模块");
}

void revert(const fs::path& repo, const std::string& path) {
    if (path.empty()) throw WorkspaceError("INVALID_REQUEST", "要回滚的文件不能为空。");
    // Untracked files have no committed content to roll back to; IDEA's Rollback
    // simply doesn't offer the action for them.
    for (const auto& change : git::status(repo))
        if (change.path == path && change.untracked)
            throw WorkspaceError("INVALID_REQUEST", "该文件未被 Git 跟踪，没有可回滚的版本。");
    require_ok(run(repo, {L"checkout", L"--", utf8_to_wide(path)}), "回滚文件");
}

Json reset(const fs::path& repo, const std::string& target, const std::string& mode) {
    if (target.empty()) throw WorkspaceError("INVALID_REQUEST", "要重置到的提交不能为空。");
    if (mode != "soft" && mode != "mixed" && mode != "hard")
        throw WorkspaceError("INVALID_REQUEST", "重置模式只能是 soft、mixed 或 hard。");
    require_ok(run(repo, {L"reset", L"--" + std::wstring(mode.begin(), mode.end()), utf8_to_wide(target)}), "重置分支");
    return {{"head", head(repo)}, {"mode", mode}, {"target", target}};
}

}  // namespace git
}  // namespace taocode
