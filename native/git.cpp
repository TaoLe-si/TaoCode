#include "git.hpp"
#include "git_detail.hpp"
#include "git_log.hpp"
#include "git_clone.hpp"
#include "history.hpp"
// `time_format.hpp` 跟着「提交历史 / 追溯」一族走了（`blame` 的 author-time 格式化），2026-10-06 搬进 native/git_log.cpp。

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <array>
#include <algorithm>
#include <atomic>
#include <cctype>
#include <ctime>
#include <fstream>
#include <iterator>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace taocode {
namespace git {

namespace fs = std::filesystem;

namespace detail {
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

// `Result`（run() 的返回类型）连同 default_timeout_ms 一起搬进了 native/git_detail.hpp ——
// git_worktree.cpp 也要拿同一份，重复定义会让两个 TU 各有一份不同的类型。

// A git command that hangs — a remote that never answers, a credential helper
// waiting on the stdin we deliberately left at NUL — must not pin the worker
// thread forever, and closing the project must be able to stop it. So every child
// runs inside a job object (killing it takes the whole tree: git spawns ssh and
// credential helpers of its own) and gets a bounded wait.
// default_timeout_ms 本身连同它的注释搬进了 native/git_detail.hpp（默认实参只能写一处，
// 而 git_worktree.cpp 也要用），这里只留 kill_wait_ms。
constexpr DWORD kill_wait_ms = 5000;  // grace for the tree to actually die

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

// The default for `timeout_ms` lives in native/git_detail.hpp (default_timeout_ms), so
// that both this file and git_worktree.cpp can call run() with just the arguments.
Result run(const fs::path& repo, std::vector<std::wstring> arguments, DWORD timeout_ms) {
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

// `checked_new_name`（「要新建的 ref」那道闸：不以 '-' 开头、无空格/控制字符）2026-10-08 跟着
// 分支/标签那一族搬进了 native/git_refs.cpp —— 只有那边的 create_branch / tag_create 在用它，
// 所以它落在那边的匿名 namespace 里（没有外部链接），本文件不再需要 `using`。

std::vector<std::wstring> range_args(const fs::path& repo, const std::string& base) {
    // "git diff HEAD base" reads as "what does that side have that I do not": its files
    // appear as additions, and files only this side has appear as deletions. Comparing
    // tips (not merge bases) is what IDEA's compare view shows.
    return {L"HEAD", checked_ref(repo, base)};
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

// 「提交文件…」的 pathspec 比上面那道严一档，因为它决定"这次提交带哪些文件"，写歪了就是少提交。
// 三条新增，全部是实测出来的：
//  · **控制字符**：`checked_path` 原来只挡 CR/LF。JSON 里的 `\u0000` 进得了 std::string，
//    而 argv 到 git 那一头是 C 字符串 ⇒ `a.txt\0--amend` 到了 git 只剩 `a.txt`：请求的路径和
//    git 真正拿到的路径不是同一条。宁可拒掉（同文件 `format_author` 对作者字段就是这道口径）。
//  · **绝对路径**：实测 `git add -- C:/…/c.txt` 这种**仓内**绝对路径能走通、仓外的报
//    `fatal: … is outside repository`（退出码 128）。前者绕过了"pathspec 是仓库相对"这一整条约定
//    （前端去重、目录前缀判定、native 的变更行匹配全按相对路径算），后者把一条本该 INVALID_REQUEST
//    的请求变成 GIT_FAILED 的 git 尾巴。都在这里拒掉。
//  · **反斜杠**：git 的 pathspec 只认 `/`。实测 `git commit --only -- newdir\f.txt` 报
//    `error: pathspec 'newdir\f.txt' did not match any file(s) known to git` —— 一个分隔符写错的
//    请求不会失败在"分隔符"上，而是失败在"没有这个文件"上，那种错误没人看得懂。
//  · **通配与魔术**（2026-10-06 commitpaths 落地 `docs/wiring-requests-2026-10-06-partialcommit.md` W3）：
//    git 的 pathspec 里 `*` `?` `[` 是**通配**、开头的 `:` 与任意位置的 `:(` 是**魔术**，都不是字面量。
//    partialcommit 那批的实测：`git commit --only -m glob -- '*.ts'` 一次提交走掉 `a.ts` **和** `b.ts`
//    两篇，`-- 'foo[1].ts'` 连 `foo1.ts` 一起提交走 ⇒ "只提交选中的路径"会提交得比选中的多，
//    这是这一族最贵的错。上游没有这一档风险，因为它**不发 pathspec**、改的是 index
//    （`plugins/git4idea/backend/src/checkin/GitCheckinEnvironment.kt:393-434` stage +
//    `plugins/git4idea/backend/src/util/GitFileUtils.kt:156-179` add），本仓走的
//    `git commit --only -- <paths>` 这条短路必须自己补闸（同一发命令的 `git add` 也吃 pathspec）。
//    另一条更贴上游的形状是把每条 pathspec 包成 `:(literal)<path>`：那样文件名里真带 `[` 的那一篇
//    也提交得动，但要在**每一发**命令上改，且魔术前缀 `:` 本身仍然得拒（`:(exclude)…` 会把用户
//    选中的那一篇反向排除掉）。这里选"只接受字面量"：一处闸、口径与前端
//    `src/commitChecks.ts` 的 `PATHSPEC_MAGIC_RE` 逐条一致，代价（`[` 在文件名里走不了「提交文件…」）
//    写在 `src/commitScope.ts` 的文件头。
std::wstring checked_pathspec(const std::string& path) {
    const auto wide = checked_path(path);
    for (const char character : path)
        if (static_cast<unsigned char>(character) < 0x20 || character == '\\')
            throw WorkspaceError("INVALID_REQUEST", "提交路径只能是仓库相对的 POSIX 写法。");
    if (path.front() == '/') throw WorkspaceError("INVALID_REQUEST", "提交路径不能是绝对路径。");
    if (path.size() > 1 && path[1] == ':' &&
        ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')))
        throw WorkspaceError("INVALID_REQUEST", "提交路径不能带盘符。");
    // 四档与前端 PATHSPEC_MAGIC_RE = /[*?[]|:\(|^:/ 一字不差：三个通配字符、任意位置的 `:(`、
    // 开头的 `:`。`path.front()` 在这儿是安全的 —— checked_path 已经拒过空串。
    if (path.find_first_of("*?[") != std::string::npos || path.front() == ':' ||
        path.find(":(") != std::string::npos)
        throw WorkspaceError("INVALID_REQUEST", "提交路径只能是字面量，不能含 git 的 pathspec 通配或魔术前缀。");
    return wide;
}

}  // namespace detail

// 上面这一块原来就是匿名命名空间；2026-10-05 拆出「工作树 + 子模块」一族（native/git_worktree.cpp）
// 之后改成 detail，因为那一族要拿到**同一份** run()（job object 与看门狗不能复制到第二个 TU）。
// 其中跨 TU 用的那几个（Result / run / require_ok / utf8_to_wide / split_lines / utf8_path，
// 加上 2026-10-06 拆「提交历史 / 追溯」一族时补的 trim / checked_ref / checked_path / parse_records）
// 声明在 native/git_detail.hpp。下面这排 using 让本文件与拆出去的那几个 TU 里的调用保持原样，
// 不必改成 detail::xxx(...)。2026-10-08 拆「分支 / 标签 / 储藏」一族（native/git_refs.cpp）时
// 只多拆走一个 `checked_new_name` —— 它只被那一族里的 create_branch / tag_create 用到，所以
// 跟着定义一起走（进那边的匿名 namespace），本文件这排 using 不再列它。
using detail::checked_path;
using detail::checked_pathspec;
using detail::checked_ref;
using detail::kill_current;
using detail::max_output;
using detail::parse_records;
using detail::range_args;
using detail::require_ok;
using detail::run;
using detail::trim;
using detail::utf8_path;
using detail::utf8_to_wide;

// Stop the git command that is running right now, if any. Called from the UI thread
// (closing a project or the window) while a worker thread is inside run():
// terminating the job takes git and every process it spawned, which also breaks the
// pipes the reader is parked on, so the worker returns. Non-blocking, and a no-op
// when nothing runs. Deliberately outside the detail namespace above — it is
// declared in git.hpp and must have external linkage.
void request_cancel() { kill_current(); }

bool available() { return !find_git_executable().empty(); }

std::vector<Change> status(const fs::path& repo, bool include_ignored) {
    // `--ignored=matching` 让 git 用 `!!` 记录把被忽略的文件也报出来（IDEA 的「忽略的文件」那一档）。
    std::vector<std::wstring> arguments = {L"status", L"--porcelain=v1", L"-z", L"--untracked-files=all"};
    if (include_ignored) arguments.push_back(L"--ignored=matching");
    const auto result = run(repo, arguments);
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
        change.ignored = (x == '!' && y == '!');
        change.staged = x != ' ' && x != '?' && !change.ignored;
        if (x == 'R' || x == 'C' || y == 'R' || y == 'C') {
            if (index + 1 < records.size()) { change.rename_from = records[index + 1]; ++index; }
        }
        changes.push_back(std::move(change));
    }
    return changes;
}

std::string diff(const fs::path& repo, const std::string& path, bool staged, const std::string& base, int context, bool whole) {
    std::vector<std::wstring> arguments = {L"diff", L"--no-color"};
    if (context > 0) arguments.push_back(L"-U" + std::to_wstring(context));
    // `whole`：工作区对 HEAD（一个 rev 就够了 —— `git diff HEAD` 把暂存与未暂存一起算）。
    if (whole) arguments.push_back(L"HEAD");
    else if (!base.empty()) { const auto range = range_args(repo, base); arguments.insert(arguments.end(), range.begin(), range.end()); }
    else if (staged) arguments.push_back(L"--cached");
    if (!path.empty()) {
        arguments.push_back(L"--");
        arguments.push_back(utf8_to_wide(path));
    }
    const auto result = run(repo, arguments);
    require_ok(result, "生成差异");
    return result.out;
}

Json diff_sides(const fs::path& repo, const std::string& path, bool staged, const std::string& base, int context, bool whole) {
    // The unified text is the single source of truth: parsing it keeps the side-by-side
    // view agreeing with the unified one, and needs no second read of the worktree.
    return history::diff_sides_from_unified(diff(repo, path, staged, base, context, whole));
}

std::string patch(const fs::path& repo, bool include_untracked) {
    std::string text = diff(repo, std::string(), false, std::string(), 0, /*whole=*/true);
    if (!include_untracked) return text;
    // 限定名：`status` 与 `std::filesystem::status` 在这个作用域里重载歧义（C2668）。
    for (const auto& change : taocode::git::status(repo)) {
        if (!change.untracked) continue;
        // `--no-index` 比较两个路径：`/dev/null` 对文件 = "新文件"那一份补丁。
        // **退出码 1 表示"有差异"**（git 的约定），不是失败；其余非零码（读不了、二进制）跳过这个文件。
        const auto result = run(repo, {L"diff", L"--no-color", L"--no-index", L"--", L"/dev/null", utf8_to_wide(change.path)});
        if (result.code != 0 && result.code != 1) continue;
        text += result.out;
    }
    return text;
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

std::vector<BranchTrackInfo> branch_track_infos(const fs::path& repo,
                                                const std::vector<std::string>& local_branches) {
    struct ConfiguredBranch {
        std::optional<std::string> remote;
        std::optional<std::string> merge;
        std::optional<std::string> rebase;
    };

    const auto config = run(repo, {L"config", L"--null", L"--list"});
    if (config.code != 0) return {};

    std::map<std::string, ConfiguredBranch> configured_branches;
    std::vector<std::string> configured_remotes;
    for (std::size_t start = 0; start < config.out.size();) {
        const auto end = config.out.find('\0', start);
        if (end == std::string::npos) break;
        const auto record = config.out.substr(start, end - start);
        start = end + 1;
        const auto separator = record.find('\n');
        if (separator == std::string::npos) continue;
        const auto key = record.substr(0, separator);
        const auto value = record.substr(separator + 1);

        constexpr std::string_view remote_prefix = "remote.";
        constexpr std::string_view remote_url_suffix = ".url";
        if (key.starts_with(remote_prefix) && key.ends_with(remote_url_suffix)) {
            const auto remote_name = key.substr(remote_prefix.size(), key.size() - remote_prefix.size() - remote_url_suffix.size());
            if (!remote_name.empty() && !value.empty() &&
                std::find(configured_remotes.begin(), configured_remotes.end(), remote_name) == configured_remotes.end()) {
                configured_remotes.push_back(remote_name);
            }
            continue;
        }

        constexpr std::string_view branch_prefix = "branch.";
        if (!key.starts_with(branch_prefix)) continue;
        const auto field_separator = key.rfind('.');
        if (field_separator == std::string::npos || field_separator < branch_prefix.size()) continue;
        const auto field = key.substr(field_separator + 1);
        const auto branch_name = key.substr(branch_prefix.size(), field_separator - branch_prefix.size());
        if (branch_name.empty()) continue;
        auto& branch = configured_branches[branch_name];
        if (field == "remote") branch.remote = value;
        else if (field == "merge") branch.merge = value;
        else if (field == "rebase") branch.rebase = value;
    }

    const auto blank = [](const std::string& value) {
        return std::all_of(value.begin(), value.end(), [](unsigned char character) { return std::isspace(character) != 0; });
    };
    const auto strip_refs_prefix = [](std::string value) {
        constexpr std::string_view prefixes[] = {"refs/heads/", "refs/remotes/", "refs/tags/"};
        for (const auto prefix : prefixes)
            if (value.starts_with(prefix)) return value.substr(prefix.size());
        return value;
    };
    std::vector<BranchTrackInfo> result;
    for (const auto& [configured_local_branch, config] : configured_branches) {
        const auto local_branch = strip_refs_prefix(configured_local_branch);
        if (std::find(local_branches.begin(), local_branches.end(), local_branch) == local_branches.end()) continue;
        if (!config.remote || blank(*config.remote) ||
            std::find(configured_remotes.begin(), configured_remotes.end(), *config.remote) == configured_remotes.end()) continue;
        const auto& configured_upstream = config.merge ? config.merge : config.rebase;
        if (!configured_upstream || blank(*configured_upstream)) continue;

        const auto remote_branch = strip_refs_prefix(*configured_upstream);
        if (remote_branch.empty()) continue;
        result.push_back({local_branch, *config.remote, *config.remote + "/" + remote_branch});
    }
    return result;
}

std::optional<bool> is_on_branch(const fs::path& repo) {
    const auto head_ref = run(repo, {L"symbolic-ref", L"--quiet", L"HEAD"});
    if (head_ref.code == 1) return false;
    if (head_ref.code != 0) return std::nullopt;
    if (!trim(head_ref.out).starts_with("refs/heads/")) return false;

    for (const auto* operation : {L"rebase-apply", L"rebase-merge"}) {
        const auto path_result = run(repo, {L"rev-parse", L"--git-path", operation});
        if (path_result.code != 0) return std::nullopt;
        auto marker = fs::u8path(trim(path_result.out));
        if (marker.is_relative()) marker = repo / marker;
        std::error_code error;
        const bool exists = fs::exists(marker, error);
        if (error) return std::nullopt;
        if (exists) return false;
    }
    return true;
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
             const std::string& author_name, const std::string& author_email,
             const std::vector<std::string>& paths) {
    // IDEA's CommitAuthorComponent: the author override is per commit, not per repository.
    const bool override_author = !trim(author_name).empty() || !trim(author_email).empty();
    // 「提交文件…」（上游 `CheckinFiles` = `VcsActions.xml:187` 挂在 `ChangesViewPopupMenu` 第一行 →
    // `CommonCheckinFilesAction.kt:37-53` → `CheckinActionUtil.kt:104-106`、`:121-147` →
    // `getIncludedChanges(...)`（`:153-167`）→ `workflowHandler.setCommitState(...)`：只有被选中的那些变更
    // 进这次提交）。
    // 订正留痕：这一段原来写的是 `CommonCheckinFilesAction.kt:26-78` → `CheckinActionUtil.kt:100-160`
    // 的 `pathsToCommit`，那个函数名不存在（它只是参数名），行号也是抄虚的。
    // 上游真到 git 那一层**不发 `--only`**：`GitCheckinEnvironment.kt:393-434` 先把不属于这次的暂存项
    // 临时退回（`GitResetAddStagingAreaStateManager.kt:30-60`）、把被选项刷进 index
    // （`GitFileUtils.kt:156-179`：删除侧 `git rm --cached -r --ignore-unmatch`、新增侧 `addPathsForce`），
    // 再跑一次**不带 pathspec** 的 `git commit -F`（`GitRepositoryCommitter.kt:77-108`），退出 `use {}`
    // 时恢复（`GitStagingAreaStateManager.kt:24-28`）。本仓取同一 observable 结果的短路路径：
    // `git commit --only -- <paths>` —— 被选项取工作区内容，其余暂存项原地不动（四条实测：
    // `M ` 的另一篇提交后仍是 `M `；`MM` 的一整篇工作区版本进这次提交；`A ` 与 `D ` 不 add 也提交得动；
    // 重命名两朵 pathspec 一起给 ⇒ `R100`）。
    const bool scoped = !paths.empty();
    if (paths.size() > 500) throw WorkspaceError("INVALID_REQUEST", "一次最多提交 500 个所选文件。");
    std::vector<std::wstring> specs;
    specs.reserve(paths.size());
    for (const auto& path : paths) specs.push_back(checked_pathspec(path));
    if (scoped) {
        // 这一发要读变更列表，为的是三件事：只 add 未跟踪的那几条、重命名必须成对、
        // 陌生路径当场拒（上游 `CommonCheckinFilesAction.kt:75-78` 对 `NOT_CHANGED` 直接不启用动作）。
        // 必须写全限定名：`repo` 是 `std::filesystem::path`，按参数查找（ADL）会把
        // `std::filesystem::status(const path&)` 一起摆进候选集，而它与本文件的
        // `git::status(const fs::path&, bool)` 在实参上同样精确匹配 ⇒ MSVC 报 C2668 重载不明确。
        // 本文件其余那一族调用（native/git_worktree.cpp、native/git_log.cpp）都在别的 TU 里、
        // 走 `taocode::git::status(...)`，只有这一发是本文件内的裸名字。
        const auto changes = taocode::git::status(repo);
        std::vector<std::wstring> to_add;
        for (const auto& path : paths) {
            bool matched = false;    // 有变更行对得上 ⇒ 不是陌生路径
            bool untracked = false;  // 这条 pathspec（或它下面的内容）里有 git 还不认识的文件
            const auto prefix = path + '/';
            for (const auto& change : changes) {
                const bool inside = change.path == path || change.path.rfind(prefix, 0) == 0;
                if (!inside && change.rename_from != path) continue;
                matched = true;
                // 目录那一条要能摊得开：`git status --untracked-files=all` 报的是目录下面的每个文件
                // （实测 `?? sub/x.txt` ⇒ 选中 `sub` 时 add 的必须是 `sub` 这一条 pathspec）。
                if (change.untracked) untracked = true;
            }
            if (!matched) throw WorkspaceError("INVALID_REQUEST", "这个路径没有可提交的变更：" + path);
            if (untracked) to_add.push_back(utf8_to_wide(path));
        }
        // 只把**未跟踪**的那几条交给 `git add`（实测 `git add -- <已 mv 走的旧路径>` 会
        // `fatal: pathspec … did not match any files`，退出码 128，`--ignore-errors` 压不住 ⇒
        // 整批 add 会把这次带重命名的提交一枪打死）。
        if (!to_add.empty()) {
            std::vector<std::wstring> add{L"add", L"--"};
            add.insert(add.end(), to_add.begin(), to_add.end());
            require_ok(run(repo, add), "暂存所选文件");
        }
        // 重命名成对：上游一条 `ChangedPath` 同时带 beforePath/afterPath
        // （`GitCheckinEnvironment.kt:403-404` 把两朵路径分别放进 toCommitAdded / toCommitRemoved）。
        // 单边提交实测写出坏历史：只给新路径 ⇒ 提交是 `A e.txt`、HEAD 里的旧路径**还在**（等于复制一份）；
        // 只给旧路径 ⇒ 提交是 `D d.txt`、新内容留在 index 没提交。两朵一起给才是 `R100`。
        for (const auto& change : changes) {
            if (change.rename_from.empty()) continue;
            const bool has_new = std::find(paths.begin(), paths.end(), change.path) != paths.end();
            const bool has_old = std::find(paths.begin(), paths.end(), change.rename_from) != paths.end();
            if (has_new == has_old) continue;
            throw WorkspaceError("INVALID_REQUEST",
                                 "重命名要成对提交：" + change.rename_from + " → " + change.path);
        }
    }
    std::vector<std::wstring> arguments{L"commit"};
    if (amend) arguments.push_back(L"--amend");
    if (scoped) arguments.push_back(L"--only");
    if (signoff) arguments.push_back(L"--signoff");
    if (override_author) arguments.push_back(L"--author=" + format_author(author_name, author_email));
    if (message.empty()) {
        // IDEA's "Amend": re-write the last commit. An empty message keeps the original;
        // 普通提交的信息为空是**请求不合法**（保持原判据：INVALID_REQUEST，而不是让 git 报错）。
        if (!amend) throw WorkspaceError("INVALID_REQUEST", "提交信息不能为空。");
        arguments.push_back(L"--no-edit");
    } else { arguments.push_back(L"-m"); arguments.push_back(utf8_to_wide(message)); }
    if (scoped) { arguments.push_back(L"--"); arguments.insert(arguments.end(), specs.begin(), specs.end()); }
    require_ok(run(repo, arguments), amend ? "修改上次提交" : "提交");
}

Json user(const fs::path& repo) {
    const auto read = [&repo](const std::wstring& key) {
        const auto result = run(repo, {L"config", L"--get", key});
        // `git config --get` exits 1 when the key is simply not set; that is not an error.
        return result.code == 0 ? trim(result.out) : std::string();
    };
    return {{"name", read(L"user.name")}, {"email", read(L"user.email")}};
}

// 「分支 / 标签 / 储藏」一族（checkout、create_branch、delete_branch、stash_list / stash_save /
// stash_pop、tag_list / tag_create / tag_delete）2026-10-08 整段搬进了 native/git_refs.cpp ——
// 那一族只做一件事：ref 本身的增删查改与切换，与留在本文件的 status/diff/commit、远端同步
// （pull/push/fetch/rebase/merge/cherry-pick）不共一个职责域。搬动时**实现一个字没改**：
// 入口声明在 git.hpp，run / require_ok / checked_ref / trim / utf8_to_wide / parse_records 的
// 实现仍然只有本文件这一份（声明见 native/git_detail.hpp）。

namespace detail {
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
}  // namespace detail

// `log` / `authors`（`git log`）与 `blame` / `file_history` / `show_commit`
// （`git blame` / `git log --follow` / `git show`）这一族 2026-10-06 整段搬进了
// native/git_log.cpp —— 它们只做「把提交历史与追溯的只读视图整形出来」这一件事，
// 与留在本文件的工作区/暂存/分支/标签/远端动作不共一个职责域。搬动时**实现一个字没改**；
// 它们要的 run / require_ok / trim / checked_ref / checked_path / split_lines /
// utf8_to_wide / parse_records 仍只有本文件这一份实现，声明见 native/git_detail.hpp。

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

// `stash_list` / `stash_save` / `stash_pop` 与 `create_branch` 2026-10-08 搬进 native/git_refs.cpp
// （连同 checkout / delete_branch / tag_*，原顺序一字未改）。

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

// 「按块暂存 / 按块取消暂存」一族（DiffHunk / split_hunks / diff_hunks / apply_hunks）2026-10-08
// 整段搬进了 native/git_hunks.cpp —— 那一族只把 `git diff` 的 unified 文本按 "@@" 切成可选的
// 块，再把选中的块拼成一个补丁喂给 `git apply --cached`，与留在本文件的分支 / 标签 / 暂存条目 /
// 追溯视图不共一个职责域。搬动时实现一个字没改：`diff` 的声明在 git.hpp，run / require_ok 的
// 实现仍只有本文件这一份（声明见 native/git_detail.hpp）。

namespace detail {

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

std::string utf8_path(const fs::path& path) {
    const auto text = path.generic_u8string();
    return {reinterpret_cast<const char*>(text.data()), text.size()};
}

}  // namespace detail

// `file_history`（`git log --follow --name-status`）与 `show_commit`（`git show`）连同它们
// 文件局部的 `split_fields` 一起，2026-10-06 搬进了 native/git_log.cpp 的「提交历史 / 追溯」一族。

void revert(const fs::path& repo, const std::string& path) {
    if (path.empty()) throw WorkspaceError("INVALID_REQUEST", "要回滚的文件不能为空。");
    // Untracked files have no committed content to roll back to; IDEA's Rollback
    // simply doesn't offer the action for them.
    for (const auto& change : git::status(repo))
        if (change.path == path && change.untracked)
            throw WorkspaceError("INVALID_REQUEST", "该文件未被 Git 跟踪，没有可回滚的版本。");
    require_ok(run(repo, {L"checkout", L"--", utf8_to_wide(path)}), "回滚文件");
}

void revert_commit(const fs::path& repo, const std::string& commit) {
    if (commit.empty()) throw WorkspaceError("INVALID_REQUEST", "要还原的提交不能为空。");
    // `Git.Revert.In.Log`（`intellij.vcs.git.backend.xml:111`，注册进 `Git.Log.ContextMenu`
    // 的 `:403`）：`action.Git.Revert.In.Log.description` = 生成新提交，这会还原在原始
    // 提交中所做的更改 ⇒ `git revert --no-edit <commit>`，不弹编辑器、不改历史。
    require_ok(run(repo, {L"revert", L"--no-edit", checked_ref(repo, commit)}), "还原提交");
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
