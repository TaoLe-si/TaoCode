#include "git_clone.hpp"
#include "projects.hpp"
#include "workspace.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")

#include <algorithm>
#include <array>
#include <cstddef>
#include <cwchar>
#include <limits>
#include <string_view>
#include <utility>
#include <vector>

namespace taocode {
namespace {
namespace fs = std::filesystem;
constexpr std::size_t line_limit = 4096;
constexpr std::size_t tail_limit = 32 * 1024;

[[noreturn]] void fail(const char* code, const std::string& message) {
    throw WorkspaceError(code, message);
}

[[noreturn]] void win_fail(const char* message, DWORD error = GetLastError()) {
    fail("CLONE_FAILED", std::string(message) + "（Windows 错误 " +
         std::to_string(error) + "）。请使用现有的非交互 Git 凭据。");
}

void check_stop(std::stop_token stop) {
    if (stop.stop_requested()) fail("CANCELLED", "Git 克隆已取消，未发布目标目录。");
}

fs::path checked_destination(const fs::path& parent, const std::string& name) {
    try { return project_destination(parent, name); }
    catch (const WorkspaceError& error) {
        // The projects module owns validation and its error codes; keep clone
        // diagnostics Chinese and do not echo potentially sensitive paths.
        throw WorkspaceError(error.code,
            "无法使用克隆目标。请确认父目录存在且没有重解析点、名称合法，并且目标尚不存在。");
    }
}

class Handle {
public:
    explicit Handle(HANDLE value = INVALID_HANDLE_VALUE) noexcept : value_(value) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value_(std::exchange(other.value_, INVALID_HANDLE_VALUE)) {}
    Handle& operator=(Handle&& other) noexcept {
        if (this != &other) {
            reset();
            value_ = std::exchange(other.value_, INVALID_HANDLE_VALUE);
        }
        return *this;
    }
    HANDLE get() const noexcept { return value_; }
    explicit operator bool() const noexcept { return value_ && value_ != INVALID_HANDLE_VALUE; }
    void reset() noexcept {
        if (*this) CloseHandle(value_);
        value_ = INVALID_HANDLE_VALUE;
    }
private:
    HANDLE value_;
};

std::wstring api_path(const fs::path& path) {
    const auto& value = path.native();
    if (value.starts_with(L"\\\\?\\")) return value;
    if (value.starts_with(L"\\\\")) return L"\\\\?\\UNC\\" + value.substr(2);
    return L"\\\\?\\" + value;
}

fs::path plain_path(std::wstring text) {
    if (text.starts_with(L"\\\\?\\UNC\\")) text = L"\\\\" + text.substr(8);
    else if (text.starts_with(L"\\\\?\\")) text.erase(0, 4);
    auto path = fs::path(text).lexically_normal();
    while (path.has_relative_path() && path.filename().empty()) path = path.parent_path();
    return path;
}

bool same_text(std::wstring_view a, std::wstring_view b) {
    return CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(),
                                static_cast<int>(b.size()), TRUE) == CSTR_EQUAL;
}

bool same_path(const fs::path& a, const fs::path& b) {
    return same_text(a.native(), b.native());
}

BY_HANDLE_FILE_INFORMATION info(HANDLE handle) {
    BY_HANDLE_FILE_INFORMATION result{};
    if (!GetFileInformationByHandle(handle, &result)) win_fail("无法核对克隆目录属性");
    return result;
}

fs::path final_path(HANDLE handle) {
    const DWORD size = GetFinalPathNameByHandleW(handle, nullptr, 0, FILE_NAME_NORMALIZED);
    if (!size) win_fail("无法核对克隆目录边界");
    std::wstring buffer(size, L'\0');
    const DWORD count = GetFinalPathNameByHandleW(handle, buffer.data(), size, FILE_NAME_NORMALIZED);
    if (!count || count >= size) win_fail("无法核对克隆目录边界");
    buffer.resize(count);
    return plain_path(std::move(buffer));
}

Handle open_directory(const fs::path& path, bool owned = false) {
    Handle handle(CreateFileW(api_path(path).c_str(), FILE_READ_ATTRIBUTES | (owned ? DELETE : 0),
                             FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                             FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (!handle) win_fail("无法锁定克隆目录");
    const auto attributes = info(handle.get()).dwFileAttributes;
    if (!(attributes & FILE_ATTRIBUTE_DIRECTORY) || (attributes & FILE_ATTRIBUTE_REPARSE_POINT))
        fail("CLONE_FAILED", "克隆目录不是普通目录，或已被重解析点替换。");
    if (!same_path(final_path(handle.get()), path))
        fail("CLONE_FAILED", "克隆目录边界已改变，操作已停止。");
    return handle;
}

// Deny write/delete sharing on every ancestor: a junction cannot be substituted
// between validation, cleanup and publication. Creating children remains possible.
std::vector<Handle> pin_parent(const fs::path& path) {
    if (!path.is_absolute()) fail("CLONE_FAILED", "克隆父目录必须是绝对路径。");
    std::vector<Handle> handles;
    auto cursor = path.root_path();
    const auto relative = path.relative_path();
    auto part = relative.begin();
    if (path.root_name().native().starts_with(L"\\\\")) {
        if (part == relative.end()) fail("CLONE_FAILED", "网络父目录必须指定共享目录。");
        cursor /= *part++;
    }
    handles.push_back(open_directory(cursor));
    for (; part != relative.end(); ++part) {
        if (part->empty()) continue;
        cursor /= *part;
        handles.push_back(open_directory(cursor));
    }
    return handles;
}

std::wstring environment_value(const wchar_t* name) {
    for (unsigned attempt = 0; attempt != 3; ++attempt) {
        const DWORD size = GetEnvironmentVariableW(name, nullptr, 0);
        if (!size) return {};
        std::wstring value(size, L'\0');
        const DWORD count = GetEnvironmentVariableW(name, value.data(), size);
        if (count && count < size) {
            value.resize(count);
            return value;
        }
    }
    return {};
}

bool ascii_letter(char ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

bool digit(char ch) { return ch >= '0' && ch <= '9'; }

[[noreturn]] void invalid_source() {
    fail("INVALID_SOURCE", "仓库地址无效。仅支持无内嵌凭据、查询或片段的 HTTPS、SSH、git@host:path，"
         "以及已存在的本地路径；请使用现有的非交互 Git 凭据。");
}

std::wstring source_text(const std::string& source) {
    if (source.empty() || source.size() > 16384 || source.front() == '-') invalid_source();
    const int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, source.data(),
                                         static_cast<int>(source.size()), nullptr, 0);
    if (!count) invalid_source();
    std::wstring wide(count, L'\0');
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, source.data(),
                            static_cast<int>(source.size()), wide.data(), count)) invalid_source();
    for (wchar_t ch : wide) {
        if (ch <= 31 || (ch >= 127 && ch <= 159) || ch == 0x2028 || ch == 0x2029 ||
            (ch >= 0x202a && ch <= 0x202e) || (ch >= 0x2066 && ch <= 0x2069)) invalid_source();
    }
    return wide;
}

int hex_digit(char ch) {
    if (digit(ch)) return ch - '0';
    if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
    if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
    return -1;
}

void validate_remote_path(std::string_view path) {
    if (path.empty() || path.front() == '-') invalid_source();
    std::string decoded;
    for (std::size_t i = 0; i < path.size(); ++i) {
        char ch = path[i];
        if (ch == '%') {
            if (i + 2 >= path.size()) invalid_source();
            const int a = hex_digit(path[i + 1]), b = hex_digit(path[i + 2]);
            if (a < 0 || b < 0) invalid_source();
            ch = static_cast<char>(a * 16 + b);
            i += 2;
        }
        if (ch == '?' || ch == '#' || ch == '\\' || ch == '"' || ch == '@' || ch == ' ')
            invalid_source();
        decoded.push_back(ch);
    }
    source_text(decoded); // Also rejects percent-encoded controls and invalid UTF-8.
}

void validate_host(std::string_view authority, bool allow_port) {
    if (authority.empty() || authority.front() == '-') invalid_source();
    std::string_view host = authority, port;
    if (authority.front() == '[') {
        const auto close = authority.find(']');
        if (close == std::string_view::npos || close < 2) invalid_source();
        host = authority.substr(1, close - 1);
        for (char ch : host) if (hex_digit(ch) < 0 && ch != ':' && ch != '.') invalid_source();
        const auto suffix = authority.substr(close + 1);
        if (!suffix.empty()) {
            if (!allow_port || suffix.front() != ':') invalid_source();
            port = suffix.substr(1);
            if (port.empty()) invalid_source();
        }
    } else {
        const auto colon = authority.find(':');
        if (colon != std::string_view::npos) {
            if (!allow_port) invalid_source();
            host = authority.substr(0, colon);
            port = authority.substr(colon + 1);
            if (port.empty()) invalid_source();
        }
        if (host.empty()) invalid_source();
        for (char ch : host)
            if (!ascii_letter(ch) && !digit(ch) && ch != '.' && ch != '-') invalid_source();
    }
    if (!port.empty()) {
        unsigned number = 0;
        if (port.size() > 5) invalid_source();
        for (char ch : port) {
            if (!digit(ch)) invalid_source();
            number = number * 10 + static_cast<unsigned>(ch - '0');
        }
        if (!number || number > 65535) invalid_source();
    }
}

std::wstring validate_source(const std::string& source) {
    auto wide = source_text(source);
    std::string lower = source;
    for (char& ch : lower) if (ch >= 'A' && ch <= 'Z') ch += 'a' - 'A';
    const bool https = lower.starts_with("https://");
    const bool ssh = lower.starts_with("ssh://");
    if (https || ssh) {
        const auto start = https ? 8u : 6u;
        const auto slash = source.find('/', start);
        if (slash == std::string::npos || slash + 1 == source.size()) invalid_source();
        std::string_view authority(source.data() + start, slash - start);
        const auto at = authority.find('@');
        if (at != std::string_view::npos) {
            // HTTPS userinfo can be a PAT even without a colon. SSH permits a username only.
            if (https || !at || authority.front() == '-') invalid_source();
            for (char ch : authority.substr(0, at))
                if (!ascii_letter(ch) && !digit(ch) && ch != '_' && ch != '-' && ch != '.')
                    invalid_source();
            authority.remove_prefix(at + 1);
        }
        validate_host(authority, true);
        validate_remote_path(std::string_view(source).substr(slash + 1));
        // Normalize scheme case; Git's transport selection is case-sensitive.
        wide.replace(0, start, https ? L"https://" : L"ssh://");
        return wide;
    }
    if (source.starts_with("git@")) {
        if (source.size() <= 4) invalid_source();
        const auto colon = source[4] == '[' ? source.find(':', source.find(']', 4)) : source.find(':', 4);
        if (colon == std::string::npos) invalid_source();
        validate_host(std::string_view(source).substr(4, colon - 4), false);
        validate_remote_path(std::string_view(source).substr(colon + 1));
        return wide;
    }
    // Reject helpers/unknown schemes before touching the filesystem. Drive-relative
    // paths and device namespaces are not accepted as local repository sources.
    if (source.find("::") != std::string::npos || source.find("://") != std::string::npos ||
        wide.starts_with(L"\\\\?\\") || wide.starts_with(L"\\\\.\\")) invalid_source();
    const auto colon = source.find(':');
    if (colon != std::string::npos &&
        (colon != 1 || !ascii_letter(source[0]) || source.size() < 3 ||
         (source[2] != '/' && source[2] != '\\') || source.find(':', 2) != std::string::npos))
        invalid_source();
    std::error_code error;
    const auto path = fs::canonical(fs::path(wide), error);
    if (error || (!fs::is_directory(path, error) && !fs::is_regular_file(path, error)) || error)
        invalid_source();
    return plain_path(path.native()).generic_wstring();
}

// CommandLineToArgvW/MSVC quoting, including quotes and runs of trailing backslashes.
std::wstring quote_arg(std::wstring_view arg) {
    std::wstring result = L"\"";
    std::size_t slashes = 0;
    for (wchar_t ch : arg) {
        if (ch == L'\\') { ++slashes; continue; }
        result.append(slashes * (ch == L'"' ? 2 : 1), L'\\');
        slashes = 0;
        if (ch == L'"') result.push_back(L'\\');
        result.push_back(ch);
    }
    result.append(slashes * 2, L'\\');
    result.push_back(L'"');
    return result;
}

std::wstring environment_key(const std::wstring& entry) {
    return entry.substr(0, entry.find(L'=', entry.starts_with(L'=') ? 1 : 0));
}

std::vector<wchar_t> child_environment() {
    wchar_t* raw = GetEnvironmentStringsW();
    if (!raw) win_fail("无法创建 Git 子进程环境");
    struct Guard { wchar_t* value; ~Guard() { FreeEnvironmentStringsW(value); } } guard{raw};
    std::vector<std::wstring> entries;
    for (const wchar_t* p = raw; *p; p += std::wcslen(p) + 1) entries.emplace_back(p);
    const auto remove = [&](std::wstring_view key) {
        std::erase_if(entries, [&](const auto& entry) { return same_text(environment_key(entry), key); });
    };
    // Keep HOME, SSH_AUTH_SOCK, credential helpers and global/system Git configuration.
    // Drop repository redirection and tracing only in this child, never in the host.
    for (const auto* key : {L"GIT_DIR", L"GIT_COMMON_DIR", L"GIT_WORK_TREE", L"GIT_INDEX_FILE",
                            L"GIT_OBJECT_DIRECTORY", L"GIT_ALTERNATE_OBJECT_DIRECTORIES",
                            L"GIT_QUARANTINE_PATH", L"GIT_SHALLOW_FILE", L"GIT_CONFIG",
                            L"GIT_SSH", L"GIT_SSH_COMMAND", L"GIT_SSH_VARIANT", L"SSH_ASKPASS"}) remove(key);
    std::erase_if(entries, [](const auto& entry) {
        const auto key = environment_key(entry);
        return (key.size() >= 9 && same_text(std::wstring_view(key).substr(0, 9), L"GIT_TRACE")) ||
               same_text(key, L"GIT_CURL_VERBOSE") || same_text(key, L"GCM_TRACE");
    });
    const auto set = [&](const wchar_t* key, const wchar_t* value) {
        remove(key);
        entries.push_back(std::wstring(key) + L"=" + value);
    };
    set(L"GIT_TERMINAL_PROMPT", L"0");
    set(L"GCM_INTERACTIVE", L"never");
    set(L"LC_ALL", L"C"); // Stable Git phase names; callbacks are translated below.
    set(L"LANGUAGE", L"C");
    set(L"GIT_ASKPASS", L""); // Do not launch GUI askpass; credential helpers remain enabled.
    set(L"SSH_ASKPASS_REQUIRE", L"never");
    // Unlike protocol.allow alone, this also overrides per-protocol user settings
    // when an insteadOf rule rewrites an otherwise valid source to a helper.
    set(L"GIT_ALLOW_PROTOCOL", L"https:ssh:file");
    // Fixed options cannot be injected through the source. OpenSSH still reads the
    // user's keys, agent, known_hosts and ssh config. Unknown host keys fail closed.
    set(L"GIT_SSH_COMMAND", L"ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o NumberOfPasswordPrompts=0");
    set(L"GIT_SSH_VARIANT", L"ssh");
    std::sort(entries.begin(), entries.end(), [](const auto& a, const auto& b) {
        return CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(),
                                    static_cast<int>(b.size()), TRUE) == CSTR_LESS_THAN;
    });
    std::vector<wchar_t> block;
    for (const auto& entry : entries) {
        block.insert(block.end(), entry.begin(), entry.end());
        block.push_back(L'\0');
    }
    block.push_back(L'\0');
    return block;
}

bool dispose(HANDLE handle) noexcept {
    FILE_BASIC_INFO basic{};
    if (!GetFileInformationByHandleEx(handle, FileBasicInfo, &basic, sizeof(basic))) return false;
    if (basic.FileAttributes & FILE_ATTRIBUTE_READONLY) {
        basic.FileAttributes &= ~FILE_ATTRIBUTE_READONLY;
        if (!basic.FileAttributes) basic.FileAttributes = FILE_ATTRIBUTE_NORMAL;
        if (!SetFileInformationByHandle(handle, FileBasicInfo, &basic, sizeof(basic))) return false;
    }
    FILE_DISPOSITION_INFO remove{TRUE};
    return SetFileInformationByHandle(handle, FileDispositionInfo, &remove, sizeof(remove)) != FALSE;
}

// Only enumerate directories already held without write/delete sharing. Reparse
// entries themselves are deleted by handle, never followed (including junctions).
bool remove_children(const fs::path& directory) {
    WIN32_FIND_DATAW data{};
    HANDLE search = FindFirstFileW(api_path(directory / L"*").c_str(), &data);
    if (search == INVALID_HANDLE_VALUE) return GetLastError() == ERROR_FILE_NOT_FOUND;
    struct Guard { HANDLE value; ~Guard() { FindClose(value); } } guard{search};
    bool ok = true;
    do {
        const std::wstring_view name(data.cFileName);
        if (name == L"." || name == L"..") continue;
        const auto path = directory / data.cFileName;
        Handle child(CreateFileW(api_path(path).c_str(), DELETE | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES,
                                 FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                 FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
        if (!child) { ok = false; continue; }
        const auto attributes = info(child.get()).dwFileAttributes;
        if ((attributes & FILE_ATTRIBUTE_DIRECTORY) && !(attributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
            if (!same_path(final_path(child.get()), path) || !remove_children(path)) { ok = false; continue; }
        }
        if (!dispose(child.get())) ok = false;
    } while (FindNextFileW(search, &data));
    return GetLastError() == ERROR_NO_MORE_FILES && ok;
}

struct Staging {
    fs::path path;
    Handle handle;
    bool cleaned = false;
    Staging() = default;
    Staging(const Staging&) = delete;
    Staging& operator=(const Staging&) = delete;
    ~Staging() { cleanup(); }

    void create(const fs::path& parent) {
        for (unsigned attempt = 0; attempt != 32; ++attempt) {
            std::array<UCHAR, 16> bytes{};
            if (BCryptGenRandom(nullptr, bytes.data(), static_cast<ULONG>(bytes.size()),
                                BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0)
                fail("CLONE_FAILED", "无法为克隆创建安全的唯一暂存目录。");
            std::wstring suffix;
            for (auto byte : bytes) {
                suffix.push_back(L"0123456789abcdef"[byte >> 4]);
                suffix.push_back(L"0123456789abcdef"[byte & 15]);
            }
            const auto candidate = parent / (L".taocode-clone-" + suffix);
            if (!CreateDirectoryW(api_path(candidate).c_str(), nullptr)) {
                if (GetLastError() == ERROR_ALREADY_EXISTS) continue;
                win_fail("无法创建克隆暂存目录");
            }
            path = candidate;
            handle = open_directory(path, true);
            return;
        }
        fail("CLONE_FAILED", "无法分配唯一的克隆暂存目录。");
    }

    bool cleanup() noexcept {
        if (cleaned || path.empty()) return true;
        // If the initial exclusive open failed, ownership cannot safely be proved.
        if (!handle) return false;
        try {
            if (!remove_children(path) || !dispose(handle.get())) return false;
            handle.reset();
            cleaned = true;
            return true;
        } catch (...) { return false; }
    }
};

struct Child {
    Handle job;
    Handle completion;
    Handle process;
    Handle thread;
    bool assigned = false;
    bool joined = false;

    Child() : job(CreateJobObjectW(nullptr, nullptr)),
              completion(CreateIoCompletionPort(INVALID_HANDLE_VALUE, nullptr, 0, 1)) {
        if (!job || !completion) win_fail("无法创建 Git 进程树管理器");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!SetInformationJobObject(job.get(), JobObjectExtendedLimitInformation, &limits, sizeof(limits)))
            win_fail("无法设置 Git 进程树限制");
        JOBOBJECT_ASSOCIATE_COMPLETION_PORT port{};
        port.CompletionKey = this;
        port.CompletionPort = completion.get();
        if (!SetInformationJobObject(job.get(), JobObjectAssociateCompletionPortInformation, &port, sizeof(port)))
            win_fail("无法监控 Git 进程树");
    }
    Child(const Child&) = delete;
    Child& operator=(const Child&) = delete;
    ~Child() { stop_and_join(); }

    void stop_and_join() noexcept {
        if (!process || joined) return;
        if (assigned) {
            if (!TerminateJobObject(job.get(), ERROR_CANCELLED)) job.reset(); // kill-on-close fallback
        } else {
            TerminateProcess(process.get(), ERROR_CANCELLED); // Still suspended if assignment failed.
        }
        WaitForSingleObject(process.get(), INFINITE);
        if (assigned && job) {
            for (;;) {
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
                if (!QueryInformationJobObject(job.get(), JobObjectBasicAccountingInformation,
                                                &accounting, sizeof(accounting), nullptr)) {
                    job.reset();
                    break;
                }
                if (!accounting.ActiveProcesses) break;
                DWORD message = 0;
                ULONG_PTR key = 0;
                OVERLAPPED* overlapped = nullptr;
                GetQueuedCompletionStatus(completion.get(), &message, &key, &overlapped, 50);
            }
        }
        joined = true;
    }
};

class Output {
public:
    Output(std::stop_token stop, const std::function<void(const std::string&)>& callback)
        : stop_(stop), callback_(callback) {}
    void append(const char* data, std::size_t size) {
        for (std::size_t i = 0; i < size; ++i) {
            if (data[i] == '\r' || data[i] == '\n') flush();
            else if (line_.size() < line_limit) line_.push_back(data[i]);
            else truncated_ = true;
        }
    }
    void flush() {
        if (line_.empty() && !truncated_) return;
        check_stop(stop_);
        const auto safe = status(line_, truncated_);
        line_.clear();
        truncated_ = false;
        if (safe.empty()) return;
        // Never retain arbitrary helper/remote output, URLs, filenames or terminal
        // escapes. A blacklist cannot reliably redact credential-helper secrets.
        if (tail_.size() + safe.size() + 1 > tail_limit) {
            const auto cut = tail_.find('\n', tail_.size() + safe.size() + 1 - tail_limit);
            tail_.erase(0, cut == std::string::npos ? tail_.size() : cut + 1);
        }
        tail_ += safe + '\n';
        if (callback_) {
            try { callback_(safe); }
            catch (...) { fail("CLONE_FAILED", "进度回调处理失败，Git 克隆已停止。"); }
        }
        check_stop(stop_);
    }
    const std::string& tail() const { return tail_; }
private:
    static std::string status(std::string_view line, bool truncated) {
        if (truncated) return "Git 输出行过长，内容已隐藏。";
        if (line.starts_with("Cloning into ")) return "正在克隆 Git 仓库……";
        if (line.starts_with("remote: ")) line.remove_prefix(8);
        struct Phase { std::string_view prefix; const char* label; };
        static constexpr Phase phases[] = {
            {"Enumerating objects:", "枚举对象"}, {"Counting objects:", "统计对象"},
            {"Compressing objects:", "压缩对象"}, {"Receiving objects:", "接收对象"},
            {"Resolving deltas:", "解析差异"}, {"Updating files:", "更新文件"},
            {"Checking out files:", "检出文件"}, {"Filtering content:", "处理文件"}
        };
        for (const auto& phase : phases) {
            if (!line.starts_with(phase.prefix)) continue;
            auto value = line.substr(phase.prefix.size());
            while (!value.empty() && value.front() == ' ') value.remove_prefix(1);
            unsigned percent = 0;
            std::size_t digits = 0;
            while (digits < value.size() && digits < 3 && digit(value[digits])) {
                percent = percent * 10 + static_cast<unsigned>(value[digits++] - '0');
            }
            if (digits && digits < value.size() && value[digits] == '%' && percent <= 100)
                return std::string(phase.label) + "：" + std::to_string(percent) + "%";
            return std::string(phase.label) + "……";
        }
        if (line.find("Authentication failed") != std::string_view::npos ||
            line.find("could not read Username") != std::string_view::npos ||
            line.find("Permission denied") != std::string_view::npos)
            return "Git 身份验证失败，请使用现有的非交互 Git 凭据。";
        if (line.find("Host key verification failed") != std::string_view::npos)
            return "SSH 主机密钥验证失败，请先在 Git 环境中确认可信主机。";
        if (line.starts_with("fatal:") || line.starts_with("error:"))
            return "Git 报告错误（原始输出已隐藏，以防泄露凭据）。";
        if (line.starts_with("warning:")) return "Git 报告警告（原始输出已隐藏）。";
        // Invalid UTF-8 bytes are never copied to callbacks or error messages.
        return {};
    }
    std::stop_token stop_;
    const std::function<void(const std::string&)>& callback_;
    std::string line_;
    std::string tail_;
    bool truncated_ = false;
};

DWORD run_git(const fs::path& executable, const fs::path& cwd,
              const std::vector<std::wstring>& args, std::stop_token stop, Output& output) {
    std::wstring command = quote_arg(executable.native());
    for (const auto& arg : args) command += L" " + quote_arg(arg);
    if (command.size() >= 32767) fail("CLONE_FAILED", "Git 命令或目录路径过长。");
    auto environment = child_environment();
    SECURITY_ATTRIBUTES security{sizeof(security), nullptr, TRUE};
    HANDLE read = nullptr, write = nullptr;
    if (!CreatePipe(&read, &write, &security, 64 * 1024)) win_fail("无法创建 Git 输出管道");
    Handle pipe_read(read), pipe_write(write);
    if (!SetHandleInformation(pipe_read.get(), HANDLE_FLAG_INHERIT, 0)) win_fail("无法保护 Git 输出管道");
    Handle input(CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                            &security, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!input) win_fail("无法关闭 Git 交互输入");

    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
    if (!bytes) win_fail("无法设置 Git 句柄继承边界");
    std::vector<std::byte> storage(bytes);
    auto* attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
    if (!InitializeProcThreadAttributeList(attributes, 1, 0, &bytes)) win_fail("无法设置 Git 句柄继承边界");
    struct Guard {
        LPPROC_THREAD_ATTRIBUTE_LIST value;
        ~Guard() { DeleteProcThreadAttributeList(value); }
    } guard{attributes};
    HANDLE inherited[] = {pipe_write.get(), input.get()};
    if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                   inherited, sizeof(inherited), nullptr, nullptr))
        win_fail("无法限制 Git 继承的句柄");
    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = input.get();
    startup.StartupInfo.hStdOutput = startup.StartupInfo.hStdError = pipe_write.get();
    startup.lpAttributeList = attributes;
    Child child;
    PROCESS_INFORMATION process{};
    check_stop(stop);
    if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE,
                        CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT |
                        EXTENDED_STARTUPINFO_PRESENT, environment.data(), cwd.c_str(),
                        &startup.StartupInfo, &process)) win_fail("无法启动 Git");
    child.process = Handle(process.hProcess);
    child.thread = Handle(process.hThread);
    pipe_write.reset();
    input.reset();
    if (!AssignProcessToJobObject(child.job.get(), child.process.get())) win_fail("无法接管 Git 进程树");
    child.assigned = true;
    check_stop(stop);
    if (ResumeThread(child.thread.get()) == static_cast<DWORD>(-1)) win_fail("无法运行 Git 子进程");
    child.thread.reset();

    bool closed = false;
    const auto drain = [&] {
        bool received = false;
        // Bounded batches guarantee cancellation also during continuous output.
        for (unsigned batch = 0; batch != 16 && !closed; ++batch) {
            check_stop(stop);
            DWORD available = 0;
            if (!PeekNamedPipe(pipe_read.get(), nullptr, 0, nullptr, &available, nullptr)) {
                if (GetLastError() == ERROR_BROKEN_PIPE) { closed = true; break; }
                win_fail("读取 Git 输出管道失败");
            }
            if (!available) break;
            std::array<char, 4096> buffer{};
            DWORD count = 0;
            if (!ReadFile(pipe_read.get(), buffer.data(), (std::min)(available, static_cast<DWORD>(buffer.size())),
                          &count, nullptr)) {
                if (GetLastError() == ERROR_BROKEN_PIPE) { closed = true; break; }
                win_fail("读取 Git 输出失败");
            }
            if (!count) break;
            received = true;
            output.append(buffer.data(), count);
        }
        return received;
    };
    for (;;) {
        check_stop(stop);
        const bool received = drain();
        const DWORD state = WaitForSingleObject(child.process.get(), received ? 0 : 50);
        if (state == WAIT_FAILED) win_fail("等待 Git 进程失败");
        if (state == WAIT_OBJECT_0) break;
    }
    DWORD exit_code = 0;
    if (!GetExitCodeProcess(child.process.get(), &exit_code)) win_fail("无法读取 Git 退出码");
    // Reap any lingering SSH/helper descendants before closing pipes or deleting files.
    child.stop_and_join();
    while (drain()) {}
    output.flush();
    check_stop(stop);
    return exit_code; // A signalled process can legitimately have exit code STILL_ACTIVE (259).
}

void publish(HANDLE repo, const fs::path& target) {
    // The DOS-namespace parser reads FileName until a NUL even though FileNameLength
    // is authoritative, so reserve a trailing NUL; otherwise stray heap bytes leak into
    // the published name (mis-publish) or trip ERROR_INVALID_NAME.
    const auto destination = api_path(target);
    const auto name_bytes = destination.size() * sizeof(wchar_t);
    const auto bytes = offsetof(FILE_RENAME_INFO, FileName) + name_bytes;
    if (bytes > (std::numeric_limits<DWORD>::max)() - sizeof(wchar_t)) fail("CLONE_FAILED", "目标目录路径过长。");
    std::vector<std::byte> buffer(bytes + sizeof(wchar_t));
    auto* rename = reinterpret_cast<FILE_RENAME_INFO*>(buffer.data());
    rename->ReplaceIfExists = FALSE;
    rename->RootDirectory = nullptr;
    rename->FileNameLength = static_cast<DWORD>(name_bytes);
    std::copy(destination.begin(), destination.end(), rename->FileName);
    if (!SetFileInformationByHandle(repo, FileRenameInfo, rename, static_cast<DWORD>(buffer.size())))
        win_fail("无法发布克隆目录，目标可能已存在");
}

} // namespace

fs::path find_git_executable() {
    try {
        const auto path = environment_value(L"PATH");
        std::size_t begin = 0;
        while (begin <= path.size()) {
            const auto end = path.find(L';', begin);
            auto entry = path.substr(begin, end == std::wstring::npos ? end : end - begin);
            const auto first = entry.find_first_not_of(L" \t");
            if (first != std::wstring::npos) {
                entry = entry.substr(first, entry.find_last_not_of(L" \t") - first + 1);
                if (entry.size() >= 2 && entry.front() == L'"' && entry.back() == L'"')
                    entry = entry.substr(1, entry.size() - 2);
                const fs::path directory(entry);
                if (directory.is_absolute()) {
                    std::error_code error;
                    const auto candidate = fs::canonical(directory / L"git.exe", error);
                    if (!error && fs::is_regular_file(candidate, error) && !error)
                        return plain_path(candidate.native());
                }
            }
            if (end == std::wstring::npos) break;
            begin = end + 1;
        }
    } catch (...) { /* Discovery is explicitly non-throwing on unavailable Git. */ }
    return {};
}

fs::path clone_repository(const std::string& source, const fs::path& parent,
                          const std::string& name, std::stop_token stop,
                          const std::function<void(const std::string&)>& progress) {
    // Declare pins before staging: cleanup must happen while all ancestors are pinned.
    std::vector<Handle> pins;
    Staging staging;
    try {
        check_stop(stop);
        const auto validated_source = validate_source(source);
        auto target = checked_destination(parent, name);
        const auto destination_parent = target.parent_path();
        pins = pin_parent(destination_parent);
        if (!same_path(target, checked_destination(destination_parent, name)))
            fail("CLONE_FAILED", "目标目录边界已改变。");
        const auto git = find_git_executable();
        if (git.empty()) fail("GIT_NOT_FOUND", "未在系统 PATH 中找到 git.exe，请先安装或配置 Git。");
        check_stop(stop);
        staging.create(destination_parent);
        const auto empty = staging.path / L"empty";
        if (!CreateDirectoryW(api_path(empty).c_str(), nullptr)) win_fail("无法创建空 Git 模板目录");
        auto empty_pin = open_directory(empty);
        const auto repo = staging.path / L"repo";
        Output output(stop, progress);
        const std::vector<std::wstring> args = {
            L"-c", L"protocol.allow=never",
            L"-c", L"protocol.https.allow=always",
            L"-c", L"protocol.ssh.allow=always",
            L"-c", L"protocol.file.allow=always",
            L"-c", L"protocol.ext.allow=never",
            L"-c", L"protocol.http.allow=never",
            L"-c", L"http.followRedirects=false", // HTTPS must not redirect to plaintext HTTP.
            L"-c", L"core.hooksPath=" + empty.generic_wstring(),
            L"-c", L"core.askPass=",
            L"-c", L"core.fsmonitor=false",
            L"-c", L"submodule.recurse=false",
            L"-c", L"fetch.recurseSubmodules=false",
            L"-c", L"maintenance.auto=false",
            L"-c", L"gc.auto=0",
            L"clone", L"--progress", L"--no-recurse-submodules", L"--no-hardlinks",
            L"--template=" + empty.generic_wstring(), L"--", validated_source, repo.generic_wstring()
        };
        // Windows holds the current directory open without delete sharing. Use
        // empty, not the staging root whose ownership handle requests DELETE.
        const DWORD exit_code = run_git(git, empty, args, stop, output);
        if (exit_code != 0)
            fail("CLONE_FAILED", "Git 克隆失败（Git 退出码：" + std::to_string(exit_code) +
                 "）。请使用现有的非交互 Git 凭据。\n" + output.tail());
        check_stop(stop);
        auto repo_pin = open_directory(repo, true);
        if (!same_path(target, checked_destination(destination_parent, name)) ||
            !same_path(final_path(pins.back().get()), destination_parent) ||
            !same_path(final_path(staging.handle.get()), staging.path))
            fail("CLONE_FAILED", "发布前目录边界检查失败，未发布目标目录。");
        empty_pin.reset();
        check_stop(stop);
        publish(repo_pin.get(), target); // Atomic, no replacement. This is the commit point.
        // No throwing operations/callbacks/cancellation checks after publication.
        repo_pin.reset();
        staging.cleanup();
        return target;
    } catch (const WorkspaceError& error) {
        if (!staging.cleanup())
            throw WorkspaceError(error.code, std::string(error.what()) +
                                 "\n自有暂存目录清理未完成；为保护外部文件，未追踪任何重解析点。");
        throw;
    } catch (...) {
        const bool cleaned = staging.cleanup();
        fail("CLONE_FAILED", cleaned ? "Git 克隆处理失败，未发布目标目录。请使用现有的非交互 Git 凭据。"
             : "Git 克隆处理失败，自有暂存目录清理未完成。请使用现有的非交互 Git 凭据。");
    }
}

} // namespace taocode
