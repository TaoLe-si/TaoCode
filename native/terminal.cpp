#include "terminal.hpp"
#include "terminal_bell.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <atomic>
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
// How long the reader waits for the shell after the pseudo console reached
// end-of-file; a shell that lingers is terminated with the rest of its job.
constexpr DWORD exit_wait_ms = 3000;
constexpr DWORD writer_join_ms = 2000;
// Grace period for the read that is in flight when the shell dies, so its last
// bytes still make it to the front end.
constexpr DWORD last_output_ms = 100;
std::atomic<unsigned long long> pipe_serial{0};

// The output pipe needs an overlapped read end: ConPTY keeps its side open until
// the pseudo console itself is closed, so end-of-file never tells us the shell
// exited. With an overlapped pipe the reader thread can wait on the pipe *and* on
// the shell process at the same time. CreatePipe cannot make one, hence a named
// pipe (the server end is ours to read, the client end goes to the pseudo console).
void create_output_pipe(HANDLE* read_end, HANDLE* write_end, const SECURITY_ATTRIBUTES& security) {
    *read_end = nullptr;
    *write_end = nullptr;
    const auto serial = ++pipe_serial;
    std::wstring name = L"\\\\.\\pipe\\taocode-conpty-";
    name += std::to_wstring(GetCurrentProcessId());
    name += L"-";
    name += std::to_wstring(serial);
    const HANDLE server = CreateNamedPipeW(name.c_str(),
                                           PIPE_ACCESS_INBOUND | FILE_FLAG_OVERLAPPED,
                                           PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                                           1, 65536, 65536, 0, const_cast<SECURITY_ATTRIBUTES*>(&security));
    if (server == INVALID_HANDLE_VALUE) throw WorkspaceError("TERMINAL_SPAWN", "无法创建终端输出管道。");
    const HANDLE client = CreateFileW(name.c_str(), GENERIC_WRITE, 0,
                                      const_cast<SECURITY_ATTRIBUTES*>(&security), OPEN_EXISTING,
                                      FILE_ATTRIBUTE_NORMAL, nullptr);
    if (client == INVALID_HANDLE_VALUE) {
        CloseHandle(server);
        throw WorkspaceError("TERMINAL_SPAWN", "无法创建终端输出管道。");
    }
    *read_end = server;
    *write_end = client;
}
}  // namespace

struct Manager::Session {
    int id = 0;
    Manager* owner = nullptr;
    HANDLE output_read = nullptr;   // pseudo console -> parent
    HANDLE process = nullptr;
    HANDLE job = nullptr;           // kill-on-close, so no orphan shell survives
    PseudoConsole console = nullptr;
    std::shared_ptr<Input> input;   // queued keystrokes + the input pipe they go to
    std::thread reader;
    std::thread writer;
    std::mutex callback_mutex;      // held while a callback runs; closed flips first
    bool closed = false;
    std::atomic<bool> exited{false};
    OutputCb on_output;
    BellScanner bell_scanner;       // reader thread only, so it needs no lock

    ~Session() {
        close_input();
        finish_writer();
        if (output_read) CloseHandle(output_read);
        if (process) CloseHandle(process);
        if (job) CloseHandle(job);
        if (console && conpty().available) conpty().close(console);
    }

    bool alive() const { return process && !exited.load() && WaitForSingleObject(process, 0) == WAIT_TIMEOUT; }

    // Stop accepting keystrokes and release a writer that is parked inside WriteFile
    // because the shell is not draining its input.
    void close_input() noexcept {
        if (!input) return;
        void* pipe = nullptr;
        {
            const std::lock_guard lock(input->mutex);
            if (!input->open) return;
            input->open = false;
            pipe = input->pipe;
        }
        input->ready.notify_all();
        if (pipe) CancelIoEx(pipe, nullptr);
        if (writer.joinable()) CancelSynchronousIo(writer.native_handle());
    }

    void finish_writer() noexcept {
        close_input();
        if (!writer.joinable()) return;
        if (WaitForSingleObject(writer.native_handle(), writer_join_ms) == WAIT_OBJECT_0) writer.join();
        else writer.detach();  // the shared Input keeps the detached writer safe
    }

    void emit(const char* bytes, DWORD size) {
        // A bell is observed, never consumed: the scanner only looks at the chunk this
        // thread is about to hand on, and the bytes go out verbatim either way.
        const bool rang = bell_scanner.feed({bytes, size});
        {
            const std::lock_guard lock(callback_mutex);
            if (closed || !on_output) return;
            on_output(id, {bytes, size});  // verbatim console bytes, ANSI intact
        }
        // Same lock order as report_exit(): manager mutex first, then this session's
        // callback mutex, and the callback runs after both are released.
        if (rang) report_bell();
    }

    // Hands one bell to the host (which turns it into a term.bell event). A terminal
    // that was killed mid-chunk stays silent, same rule as the exit report.
    void report_bell() {
        Manager* manager = owner;
        if (!manager) return;
        BellCb callback;
        {
            const std::lock_guard lock(manager->mutex_);
            const std::lock_guard guard(callback_mutex);
            if (closed) return;
            callback = manager->on_bell_;
        }
        if (callback) callback(id);
    }

    // One read at a time, parked on both the pipe and the shell process: whichever
    // fires first decides the next step, so an exited shell is noticed immediately
    // instead of when the pseudo console happens to be closed.
    void read_loop() {
        std::vector<char> buffer(16384);
        const HANDLE completed = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (!completed) return;
        OVERLAPPED overlapped{};
        overlapped.hEvent = completed;
        bool pending = false;
        for (;;) {
            if (!pending) {
                ResetEvent(completed);
                const BOOL started = ReadFile(output_read, buffer.data(), static_cast<DWORD>(buffer.size()),
                                              nullptr, &overlapped);
                if (!started && GetLastError() != ERROR_IO_PENDING) break;
                pending = true;
            }
            const HANDLE handles[] = {completed, process};
            const DWORD waited = WaitForMultipleObjects(2, handles, FALSE, INFINITE);
            if (waited == WAIT_OBJECT_0 + 1) {
                // The shell is gone. The read that is already in flight still owes
                // us whatever the shell wrote last, so give it a moment.
                if (WaitForSingleObject(completed, last_output_ms) == WAIT_OBJECT_0) {
                    DWORD got = 0;
                    if (GetOverlappedResult(output_read, &overlapped, &got, TRUE) && got) emit(buffer.data(), got);
                    pending = false;
                }
                break;
            }
            if (waited != WAIT_OBJECT_0) break;  // read failed or wait failed
            DWORD got = 0;
            if (!GetOverlappedResult(output_read, &overlapped, &got, TRUE)) break;
            pending = false;
            if (got == 0) break;  // the pseudo console closed the pipe: end of file
            emit(buffer.data(), got);
        }
        if (pending) {
            CancelIo(output_read);
            DWORD ignored = 0;
            GetOverlappedResult(output_read, &overlapped, &ignored, TRUE);
        }
        CloseHandle(completed);
    }

    // The whole life of the reader thread: stream the shell's output, then report
    // that it exited so the id stops being listed and its slot can be reused.
    void pump() {
        read_loop();
        const int code = exit_code();
        report_exit(code);
    }

    // The pseudo console reaching end-of-file is how a ConPTY session reports that
    // its last attached client is gone; the shell itself can still be winding down
    // (or, if it spawned something that outlived it, still be alive).
    int exit_code() const {
        if (!process) return 0;
        if (WaitForSingleObject(process, exit_wait_ms) != WAIT_OBJECT_0) {
            if (job) TerminateJobObject(job, 1);
            if (WaitForSingleObject(process, exit_wait_ms) != WAIT_OBJECT_0) return -1;
        }
        DWORD code = 0;
        if (!GetExitCodeProcess(process, &code) || code == STILL_ACTIVE) return -1;
        return static_cast<int>(code);
    }

    // Hands this session over to the manager's zombie list (so ids() and running()
    // stop reporting it) and publishes the exit; a deliberate kill stays silent.
    void report_exit(int code) {
        exited.store(true);
        Manager* manager = owner;
        if (!manager) return;
        ExitCb callback;
        {
            const std::lock_guard lock(manager->mutex_);
            const std::lock_guard guard(callback_mutex);
            if (closed) return;  // killed on purpose: no exit event
            const auto found = manager->sessions_.find(id);
            if (found == manager->sessions_.end()) return;  // already taken
            manager->zombies_.push_back(std::move(found->second));
            manager->sessions_.erase(found);
            callback = manager->on_exit_;
        }
        if (callback) callback(id, code);
    }

    // Returns true when the reader had to be detached, i.e. this session object and
    // the handle its read is parked on must stay alive.
    bool close() {
        { const std::lock_guard lock(callback_mutex); closed = true; }
        // Flipping closed under the mutex guarantees no callback starts after here.
        if (job) TerminateJobObject(job, 1);  // the shell plus every program it spawned
        else if (process) TerminateProcess(process, 1);
        close_input();
        finish_writer();
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
    reap_zombies();  // shells that exited earlier are destroyed before the limit check

    std::unique_ptr<Session> session = std::make_unique<Session>();
    std::unique_lock lock(mutex_);
    if (sessions_.size() >= max_terminals) throw WorkspaceError("TERMINAL_LIMIT", "同时打开的终端已达上限。");
    session->id = next_id_++;
    session->on_output = std::move(on_output);

    SECURITY_ATTRIBUTES shared{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE input_read = nullptr, input_write = nullptr, output_write = nullptr;
    if (!CreatePipe(&input_read, &input_write, &shared, 65536))
        throw WorkspaceError("TERMINAL_SPAWN", "无法创建终端输入管道。");
    create_output_pipe(&session->output_read, &output_write, shared);
    // The writer thread starts as soon as the pipe exists: it owns the write end
    // from here on, so every later failure path closes it exactly once (in the
    // writer, after close_input() lets it go).
    session->input = std::make_shared<Input>();
    session->input->pipe = input_write;
    session->input->open = true;
    session->writer = std::thread([input = session->input] { drain_input(input); });
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
    // Published before the threads start, so a shell that exits immediately still
    // finds itself in the map and gets reclaimed instead of being orphaned.
    const int id = session->id;
    Session* pointer = session.get();
    sessions_.emplace(id, std::move(session));
    pointer->owner = this;
    pointer->reader = std::thread([pointer] { pointer->pump(); });
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

// A shell that exited on its own has already left sessions_ (so its slot is free);
// its Session only survives until its reader thread unwinds, which is what this
// waits for outside the lock.
void Manager::reap_zombies() {
    std::vector<std::unique_ptr<Session>> dead;
    {
        const std::lock_guard lock(mutex_);
        dead.swap(zombies_);
    }
    for (auto& session : dead) reap(std::move(session));
}

void Manager::drain_input(const std::shared_ptr<Input>& input) {
    bool broken = false;
    while (!broken) {
        std::string chunk;
        {
            std::unique_lock lock(input->mutex);
            input->ready.wait(lock, [&input] { return !input->queue.empty() || !input->open; });
            // Input closed: what is still queued is written first, so keystrokes
            // typed just before the shell exited are never dropped.
            if (input->queue.empty()) break;
            chunk = std::move(input->queue.front());
            input->queue.pop_front();
        }
        std::size_t offset = 0;
        while (offset < chunk.size()) {
            DWORD written = 0;
            const auto step = static_cast<DWORD>(std::min<std::size_t>(chunk.size() - offset, 4096));
            if (!WriteFile(input->pipe, chunk.data() + offset, step, &written, nullptr) || !written) {
                const std::lock_guard lock(input->mutex);
                input->queue.clear();  // the pipe is broken; nothing more can be sent
                broken = true;
                break;
            }
            offset += written;
        }
    }
    const std::lock_guard lock(input->mutex);
    if (input->pipe) { CloseHandle(input->pipe); input->pipe = nullptr; }
}

void Manager::write(int id, std::string_view bytes) {
    if (bytes.empty()) return;
    std::shared_ptr<Input> input;
    {
        const std::lock_guard lock(mutex_);
        const auto found = sessions_.find(id);
        if (found == sessions_.end()) throw WorkspaceError("TERMINAL_GONE", "终端已关闭。");
        input = found->second->input;
    }
    if (!input) return;
    {
        const std::lock_guard lock(input->mutex);
        if (!input->open) return;  // the shell already exited; typing is fire-and-forget
        input->queue.emplace_back(bytes);
    }
    input->ready.notify_one();
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
    reap_zombies();
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

void Manager::on_exit(ExitCb callback) {
    const std::lock_guard lock(mutex_);
    on_exit_ = std::move(callback);
}

void Manager::on_bell(BellCb callback) {
    const std::lock_guard lock(mutex_);
    on_bell_ = std::move(callback);
}

void Manager::kill_all() {
    reap_zombies();
    std::vector<std::unique_ptr<Session>> pending;
    {
        const std::lock_guard lock(mutex_);
        for (auto& entry : sessions_) if (entry.second) pending.push_back(std::move(entry.second));
        sessions_.clear();
    }
    for (auto& session : pending) reap(std::move(session));
    reap_zombies();
}

Manager::Manager() = default;

Manager::~Manager() {
    kill_all();
}

}  // namespace taocode::terminal
