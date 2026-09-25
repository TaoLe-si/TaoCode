#include "terminal.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cstdlib>
#include <utility>
#include <vector>

namespace taocode::terminal {
namespace {

#ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
#define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE ProcThreadAttributeValue(22, FALSE, TRUE, FALSE)
#endif

// HPCON is a void* in the SDK; the entry points are resolved from kernel32 at run
// time rather than called directly, so a machine without ConPTY degrades into
// TERMINAL_UNAVAILABLE instead of failing to load the executable.
using PseudoConsole = void*;
using CreatePseudoConsoleFn = HRESULT(STDAPICALLTYPE*)(COORD size, HANDLE input, HANDLE output, DWORD flags, PseudoConsole* result);
using ResizePseudoConsoleFn = HRESULT(STDAPICALLTYPE*)(PseudoConsole console, COORD size);
using ClosePseudoConsoleFn = void(STDAPICALLTYPE*)(PseudoConsole console);

struct ConPTY {
    CreatePseudoConsoleFn create = nullptr;
    ResizePseudoConsoleFn resize = nullptr;
    ClosePseudoConsoleFn close = nullptr;
    bool available = false;
};

const ConPTY& conpty() {
    static const ConPTY api = [] {
        ConPTY loaded;
        const HMODULE kernel = GetModuleHandleW(L"kernel32.dll");
        if (kernel) {
            loaded.create = reinterpret_cast<CreatePseudoConsoleFn>(GetProcAddress(kernel, "CreatePseudoConsole"));
            loaded.resize = reinterpret_cast<ResizePseudoConsoleFn>(GetProcAddress(kernel, "ResizePseudoConsole"));
            loaded.close = reinterpret_cast<ClosePseudoConsoleFn>(GetProcAddress(kernel, "ClosePseudoConsole"));
        }
        loaded.available = loaded.create && loaded.resize && loaded.close;
        return loaded;
    }();
    return api;
}

// The shell is whatever the session says it is; a bare name still resolves through
// CreateProcessW's search path, so cmd.exe works when COMSPEC is missing.
std::wstring shell_command_line() {
    std::wstring shell(4096, L'\0');
    const auto length = GetEnvironmentVariableW(L"COMSPEC", shell.data(), static_cast<DWORD>(shell.size()));
    if (length == 0 || length >= shell.size()) shell = L"cmd.exe";
    else shell.resize(length);
    if (shell.empty()) shell = L"cmd.exe";
    return L"\"" + shell + L"\"";
}

void check_size(int cols, int rows) {
    if (cols < 1 || cols > 9999 || rows < 1 || rows > 9999)
        throw WorkspaceError("TERMINAL_SIZE", "终端尺寸超出范围（1-9999）。");
}

constexpr std::size_t max_terminals = 64;
constexpr DWORD reader_handover_ms = 3000;
}  // namespace

struct Manager::Session {
    int id = 0;
    HANDLE input_write = nullptr;   // parent -> pseudo console
    HANDLE output_read = nullptr;   // pseudo console -> parent
    HANDLE process = nullptr;
    HANDLE job = nullptr;           // kill-on-close, so no orphan shell survives
    PseudoConsole console = nullptr;
    std::thread reader;
    std::mutex callback_mutex;      // held while a callback runs; closed flips first
    bool closed = false;
    OutputCb on_output;

    ~Session() {
        if (input_write) CloseHandle(input_write);
        if (output_read) CloseHandle(output_read);
        if (process) CloseHandle(process);
        if (job) CloseHandle(job);
        if (console && conpty().available) conpty().close(console);
    }

    bool alive() const { return process && WaitForSingleObject(process, 0) == WAIT_TIMEOUT; }

    void read_loop() {
        std::vector<char> buffer(16384);
        for (;;) {
            DWORD got = 0;
            if (!ReadFile(output_read, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr) || !got) return;
            const std::lock_guard lock(callback_mutex);
            if (closed || !on_output) continue;
            on_output(id, {buffer.data(), got});  // verbatim console bytes, ANSI intact
        }
    }

    // Returns true when the reader had to be detached, i.e. this session object and
    // the handle its read is parked on must stay alive.
    bool close() {
        { const std::lock_guard lock(callback_mutex); closed = true; }
        // Flipping closed under the mutex guarantees no callback starts after here.
        if (job) TerminateJobObject(job, 1);  // the shell plus every program it spawned
        else if (process) TerminateProcess(process, 1);
        if (input_write) { CloseHandle(input_write); input_write = nullptr; }
        if (process) WaitForSingleObject(process, reader_handover_ms);
        // Releasing the pseudo console breaks the output pipe, which is what turns
        // a reader parked inside ReadFile into a finished thread.
        if (console) { conpty().close(console); console = nullptr; }
        if (!reader.joinable()) return false;
        if (WaitForSingleObject(reader.native_handle(), reader_handover_ms) == WAIT_OBJECT_0) {
            reader.join();
            return false;
        }
        output_read = nullptr;  // still owned by the parked read
        reader.detach();
        return true;
    }
};

int Manager::create(int cols, int rows, OutputCb on_output) {
    return create(cols, rows, std::wstring(), std::move(on_output));
}

int Manager::create(int cols, int rows, std::wstring working_directory, OutputCb on_output) {
    if (!conpty().available)
        throw WorkspaceError("TERMINAL_UNAVAILABLE", "此系统不支持 Windows 伪控制台（需要 Windows 10 1809 以上）。");
    check_size(cols, rows);

    std::unique_ptr<Session> session = std::make_unique<Session>();
    std::unique_lock lock(mutex_);
    if (sessions_.size() >= max_terminals) throw WorkspaceError("TERMINAL_LIMIT", "同时打开的终端已达上限。");
    session->id = next_id_++;
    session->on_output = std::move(on_output);

    SECURITY_ATTRIBUTES shared{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE input_read = nullptr, output_write = nullptr;
    if (!CreatePipe(&input_read, &session->input_write, &shared, 65536))
        throw WorkspaceError("TERMINAL_SPAWN", "无法创建终端输入管道。");
    if (!CreatePipe(&session->output_read, &output_write, &shared, 65536)) {
        CloseHandle(input_read);
        throw WorkspaceError("TERMINAL_SPAWN", "无法创建终端输出管道。");
    }
    const COORD size{static_cast<SHORT>(cols), static_cast<SHORT>(rows)};
    const HRESULT made = conpty().create(size, input_read, output_write, 0, &session->console);
    // The pseudo console has taken both ends, so the parent's copies go away now:
    // holding one open keeps the output pipe from ever reporting end-of-file.
    CloseHandle(input_read);
    CloseHandle(output_write);
    if (FAILED(made)) {
        session->console = nullptr;
        throw WorkspaceError("TERMINAL_SPAWN", "无法创建伪控制台（HRESULT " + std::to_string(static_cast<unsigned long>(made)) + "）。");
    }

    std::wstring command_line = shell_command_line();
    std::vector<wchar_t> mutable_command(command_line.begin(), command_line.end());
    mutable_command.push_back(L'\0');

    LPPROC_THREAD_ATTRIBUTE_LIST attributes = nullptr;
    SIZE_T attribute_size = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attribute_size);
    if (attribute_size) attributes = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(std::malloc(attribute_size));
    BOOL attached = FALSE;
    if (attributes && InitializeProcThreadAttributeList(attributes, 1, 0, &attribute_size))
        attached = UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                                            session->console, sizeof(session->console), nullptr, nullptr);
    if (!attached) {
        if (attributes) DeleteProcThreadAttributeList(attributes);
        std::free(attributes);
        throw WorkspaceError("TERMINAL_SPAWN", "无法为终端进程附加伪控制台。");
    }

    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(STARTUPINFOEXW);
    // Empty standard handles are the part that makes a pseudo console behave here.
    // Without STARTF_USESTDHANDLES the child inherits *our* std handles and then
    // writes around the pseudo console — visible in the host's own console (or log)
    // instead of arriving here. With them cleared the shell binds its stdio to the
    // pseudo console it is attached to, exactly as it does when launched from a
    // windowed process that has no std handles at all.
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.lpAttributeList = attributes;
    PROCESS_INFORMATION info{};
    const wchar_t* directory = working_directory.empty() ? nullptr : working_directory.c_str();
    const BOOL spawned = CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, FALSE,
                                       EXTENDED_STARTUPINFO_PRESENT, nullptr, directory,
                                       &startup.StartupInfo, &info);
    DeleteProcThreadAttributeList(attributes);
    std::free(attributes);
    if (!spawned) {
        const auto error = GetLastError();
        throw WorkspaceError("TERMINAL_SPAWN", "无法启动终端 shell（Windows 错误 " + std::to_string(error) + "）");
    }

    session->job = CreateJobObjectW(nullptr, nullptr);
    if (session->job) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(session->job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
        AssignProcessToJobObject(session->job, info.hProcess);  // the proven pattern from Runner
    }
    CloseHandle(info.hThread);
    session->process = info.hProcess;
    session->reader = std::thread([pointer = session.get()] { pointer->read_loop(); });

    const int id = session->id;
    sessions_.emplace(id, std::move(session));
    return id;
}

std::unique_ptr<Manager::Session> Manager::take(int id) {
    const std::lock_guard lock(mutex_);
    const auto found = sessions_.find(id);
    if (found == sessions_.end()) return nullptr;
    auto session = std::move(found->second);
    sessions_.erase(found);
    return session;
}

void Manager::reap(std::unique_ptr<Session> session) {
    if (!session) return;
    if (session->close()) session.release();  // leaked on purpose, see Session::close
}

void Manager::write(int id, std::string_view bytes) {
    if (bytes.empty()) return;
    const std::lock_guard lock(mutex_);
    const auto found = sessions_.find(id);
    if (found == sessions_.end()) throw WorkspaceError("TERMINAL_GONE", "终端已关闭。");
    Session& session = *found->second;
    if (!session.input_write) return;  // the shell already exited; typing is fire-and-forget
    while (!bytes.empty()) {
        DWORD written = 0;
        const auto chunk = static_cast<DWORD>(std::min<std::size_t>(bytes.size(), 4096));
        if (!WriteFile(session.input_write, bytes.data(), chunk, &written, nullptr) || !written) return;
        bytes.remove_prefix(written);
    }
}

void Manager::resize(int id, int cols, int rows) {
    check_size(cols, rows);
    const std::lock_guard lock(mutex_);
    const auto found = sessions_.find(id);
    if (found == sessions_.end()) throw WorkspaceError("TERMINAL_GONE", "终端已关闭。");
    if (found->second->console)
        conpty().resize(found->second->console, {static_cast<SHORT>(cols), static_cast<SHORT>(rows)});
    // A rejected resize is transient (the shell is mid-redraw); the next one wins.
}

void Manager::kill(int id) {
    reap(take(id));
}

bool Manager::running(int id) const {
    const std::lock_guard lock(mutex_);
    const auto found = sessions_.find(id);
    return found != sessions_.end() && found->second && found->second->alive();
}

std::vector<int> Manager::ids() const {
    const std::lock_guard lock(mutex_);
    std::vector<int> ids;
    ids.reserve(sessions_.size());
    for (const auto& entry : sessions_) ids.push_back(entry.first);
    return ids;
}

void Manager::kill_all() {
    std::vector<std::unique_ptr<Session>> pending;
    {
        const std::lock_guard lock(mutex_);
        for (auto& entry : sessions_) if (entry.second) pending.push_back(std::move(entry.second));
        sessions_.clear();
    }
    for (auto& session : pending) reap(std::move(session));
}

Manager::Manager() = default;

Manager::~Manager() {
    kill_all();
}

}  // namespace taocode::terminal
