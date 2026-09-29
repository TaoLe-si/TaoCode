#include "runner.hpp"
#include "base64.hpp"

#include "workspace.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cstddef>
#include <optional>
#include <string>
#include <vector>

namespace taocode {
namespace {

// A WriteFile on a pipe blocks while the child is not draining it, so the writer
// thread gets this long to let go after its input has been cancelled; past that it
// is detached (its Input is shared and the pipe stays open until the process ends).
constexpr DWORD writer_join_ms = 2000;

std::wstring environment_block(const std::vector<std::wstring>& overrides) {
    // The child inherits the parent's whole block — PATH, SystemRoot, TEMP,
    // USERPROFILE and everything else a compiler or a spawned tool needs — with the
    // run configuration's variables laid over it. Building the block from the
    // overrides alone would leave the child with no PATH and no SystemRoot, which
    // breaks almost every build, so the parent block is always the starting point.
    std::vector<std::wstring> entries;
    const wchar_t* inherited = GetEnvironmentStringsW();
    if (inherited) {
        const wchar_t* cursor = inherited;
        while (*cursor != L'\0') {
            entries.emplace_back(cursor);
            cursor += entries.back().size() + 1;
        }
        FreeEnvironmentStringsW(const_cast<wchar_t*>(inherited));
    }
    for (const auto& entry : overrides) {
        const auto equals = entry.find(L'=');
        if (equals == std::wstring::npos || equals == 0) continue;  // "=::=::\\" style or unusable
        const std::wstring key = entry.substr(0, equals);
        const auto found = std::find_if(entries.begin(), entries.end(),
                                        [&](const std::wstring& existing) {
                                            const auto separator = existing.find(L'=');
                                            return separator != std::wstring::npos &&
                                                   separator == key.size() &&
                                                   _wcsnicmp(existing.c_str(), key.c_str(), key.size()) == 0;
                                        });
        // An override wins over the inherited value with the same (case-insensitive)
        // key, exactly as Windows resolves environment variable names.
        if (found == entries.end()) entries.push_back(entry);
        else *found = entry;
    }
    // CreateProcessW with CREATE_UNICODE_ENVIRONMENT wants the block sorted
    // case-insensitively and terminated by two NULs.
    std::sort(entries.begin(), entries.end(), [](const std::wstring& a, const std::wstring& b) {
        return _wcsicmp(a.c_str(), b.c_str()) < 0;
    });
    std::wstring block;
    for (const auto& entry : entries) block += entry + L'\0';
    block += L'\0';
    return block;
}

// base64_encode 已并入 native/base64.hpp（main.cpp / workspace.cpp / runner.cpp 三份重复实现合并）。

// Decodes the longest prefix of `bytes` that `codepage` can render, reporting in
// `carried` how many trailing bytes belong to an incomplete sequence and must wait
// for the next chunk. Returns nullopt when even a whole-buffer conversion fails.
std::optional<std::string> decode_prefix(const std::string& bytes, const UINT codepage, const bool strict,
                                         std::size_t& carried) {
    carried = 0;
    if (bytes.empty()) return std::string{};
    // A DBCS codepage can end on a lead byte whose trail byte has not arrived yet;
    // converting it here would emit one U+FFFD now and another one later.
    std::size_t drop = 0;
    if (!strict && IsDBCSLeadByteEx(codepage, static_cast<BYTE>(bytes.back()))) drop = 1;
    // 4 bytes is the longest sequence either candidate codepage can have in flight.
    const std::size_t limit = std::min<std::size_t>(bytes.size(), 4);
    for (; drop <= limit; ++drop) {
        const int length = static_cast<int>(bytes.size() - drop);
        const int wide = MultiByteToWideChar(codepage, strict ? MB_ERR_INVALID_CHARS : 0,
                                             bytes.data(), length, nullptr, 0);
        if (wide <= 0) continue;
        std::wstring wide_text(static_cast<std::size_t>(wide), L'\0');
        MultiByteToWideChar(codepage, strict ? MB_ERR_INVALID_CHARS : 0, bytes.data(), length,
                            wide_text.data(), wide);
        const int utf8 = WideCharToMultiByte(CP_UTF8, 0, wide_text.data(), wide, nullptr, 0, nullptr, nullptr);
        if (utf8 <= 0) continue;
        std::string text(static_cast<std::size_t>(utf8), '\0');
        WideCharToMultiByte(CP_UTF8, 0, wide_text.data(), wide, text.data(), utf8, nullptr, nullptr);
        carried = drop;
        return text;
    }
    return std::nullopt;
}

// Turns a stream of child-output bytes into UTF-8 text without ever mangling a
// character that straddles a chunk boundary: the bytes of an incomplete sequence are
// held back and re-decoded together with the next chunk.
class Decoder {
public:
    std::string feed(std::string_view bytes) {
        pending_.append(bytes);
        if (pending_.empty()) return {};
        // Most modern tools print UTF-8 already; those bytes pass through untouched,
        // so nothing downstream has to know which codepage the child used.
        std::size_t carried = 0;
        if (auto text = decode_prefix(pending_, CP_UTF8, true, carried)) {
            pending_.erase(0, pending_.size() - carried);
            return *text;
        }
        // Not UTF-8: cmd.exe, cl.exe and friends write the system ANSI codepage
        // (GBK on a zh-CN box), which is where "错误"/"警告" comes from.
        auto text = decode_prefix(pending_, CP_ACP, false, carried);
        if (text) {
            pending_.erase(0, pending_.size() - carried);
            return *text;
        }
        // Undecodable either way (a binary flood): one replacement character per
        // abandoned run, and never an unbounded pending_ buffer.
        pending_.clear();
        return std::string("\xEF\xBF\xBD");  // U+FFFD
    }

private:
    std::string pending_;
};

}  // namespace

Runner::Runner() = default;

Runner::~Runner() {
    {
        std::lock_guard lock(mutex_);
        if (running_ && job_) TerminateJobObject(job_, 1);
        else if (running_ && process_) TerminateProcess(process_, 1);
    }
    finish_input();  // the writer must let go of the pipe before it is closed
    if (reader_.joinable()) reader_.join();
    if (stdout_read_) CloseHandle(stdout_read_);
    if (process_) CloseHandle(process_);
    if (thread_) CloseHandle(thread_);
    if (job_) CloseHandle(job_);
}

unsigned long Runner::process_id() const {
    if (!process_) return 0;
    return GetProcessId(reinterpret_cast<HANDLE>(process_));
}

void Runner::start(const Spec& spec, Output on_output, Done on_done) {
    std::lock_guard lock(mutex_);
    if (running_) throw WorkspaceError("RUNNING", "已有构建/运行任务在进行中。");
    // A second start() on a Runner whose previous run already finished would assign
    // a fresh std::thread to a joinable one (operator= on joinable thread calls
    // std::terminate) and leak the old pipes/job/process handles. main.cpp builds a
    // new Runner per run, but stay defensive.
    finish_input();
    if (reader_.joinable()) reader_.join();
    if (stdout_read_) CloseHandle(reinterpret_cast<HANDLE>(stdout_read_));
    if (process_) CloseHandle(reinterpret_cast<HANDLE>(process_));
    if (thread_) CloseHandle(reinterpret_cast<HANDLE>(thread_));
    if (job_) CloseHandle(reinterpret_cast<HANDLE>(job_));
    stdout_read_ = nullptr;
    process_ = nullptr;
    thread_ = nullptr;
    job_ = nullptr;
    running_ = false;
    on_output_ = nullptr;
    on_done_ = nullptr;
    on_output_ = std::move(on_output);
    on_done_ = std::move(on_done);

    SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE stdin_read = nullptr, stdin_write = nullptr, stdout_read = nullptr, stdout_write = nullptr;
    if (!CreatePipe(&stdin_read, &stdin_write, &inheritable, 0)) throw WorkspaceError("RUN_SPAWN", "无法创建输入管道");
    if (!CreatePipe(&stdout_read, &stdout_write, &inheritable, 0)) { CloseHandle(stdin_read); CloseHandle(stdin_write); throw WorkspaceError("RUN_SPAWN", "无法创建输出管道"); }

    std::wstring command = L"\"" + spec.command + L"\"";
    for (const auto& argument : spec.arguments) command += L" " + argument;
    std::vector<wchar_t> mutable_command(command.begin(), command.end());
    mutable_command.push_back(L'\0');

    // IDEA's Run Configuration "Environment variables": the child gets the parent
    // block plus these overrides, so a run configuration can set PATH/JAVA_HOME/etc
    // without touching the machine. CREATE_UNICODE_ENVIRONMENT keeps it UTF-16.
    std::wstring environment = environment_block(spec.environment);

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = stdin_read;
    startup.hStdOutput = stdout_write;
    startup.hStdError = stdout_write;  // merge stderr into the single output stream
    PROCESS_INFORMATION info{};
    const auto working = spec.working_directory.empty() ? nullptr : spec.working_directory.c_str();
    const DWORD flags = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED |
                        CREATE_UNICODE_ENVIRONMENT;
    const BOOL created = CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, TRUE,
                                        flags,
                                        environment.data(),
                                        working, &startup, &info);
    CloseHandle(stdin_read);
    CloseHandle(stdout_write);
    if (!created) {
        const auto error = GetLastError();
        CloseHandle(stdin_write);
        CloseHandle(stdout_read);
        throw WorkspaceError("RUN_SPAWN", "无法启动进程（Windows 错误 " + std::to_string(error) + "）");
    }
    // A kill-on-close job guarantees stop() and process exit reap the entire tree
    // (a build spawns compilers), so no orphan keeps the output pipe open.
    job_ = CreateJobObjectW(nullptr, nullptr);
    if (job_) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(job_, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
        AssignProcessToJobObject(job_, info.hProcess);
    }
    ResumeThread(info.hThread);
    stdout_read_ = stdout_read;
    process_ = info.hProcess;
    thread_ = info.hThread;
    running_ = true;
    input_ = std::make_shared<Input>();
    input_->pipe = stdin_write;
    input_->open = true;
    writer_ = std::thread([input = input_] { drain_input(input); });
    reader_ = std::thread([this] { reader_loop(); });
}

void Runner::reader_loop() {
    std::vector<char> buffer(16384);
    Decoder decoder;
    for (;;) {
        DWORD got = 0;
        if (!ReadFile(stdout_read_, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr) || !got) break;
        if (!on_output_) continue;
        const std::string_view bytes(buffer.data(), got);
        const std::string encoded = base64_encode(bytes);
        const std::string text = decoder.feed(bytes);
        on_output_(Chunk{bytes, encoded, text});
    }
    DWORD code = 1;
    if (process_) {
        WaitForSingleObject(process_, INFINITE);
        GetExitCodeProcess(process_, &code);
    }
    // The child is gone, so no queued input can ever be delivered: stop accepting
    // it and release a writer that is parked inside WriteFile.
    close_input();
    running_ = false;
    if (on_done_) on_done_(static_cast<int>(code));
}

void Runner::drain_input(const std::shared_ptr<Input>& input) {
    bool broken = false;
    while (!broken) {
        std::string line;
        {
            std::unique_lock lock(input->mutex);
            input->ready.wait(lock, [&input] { return !input->queue.empty() || !input->open; });
            // Input closed: whatever is still queued is written first, so a line
            // typed just before the child exited is never dropped.
            if (input->queue.empty()) break;
            line = std::move(input->queue.front());
            input->queue.pop_front();
        }
        std::size_t offset = 0;
        while (offset < line.size()) {
            DWORD written = 0;
            if (!WriteFile(input->pipe, line.data() + offset, static_cast<DWORD>(line.size() - offset),
                           &written, nullptr) || !written) {
                const std::lock_guard lock(input->mutex);
                input->queue.clear();  // the pipe is broken; nothing more can be sent
                broken = true;
                break;
            }
            offset += written;
        }
    }
    // This thread owns the write end, so it is also the one that closes it: nothing
    // else can be writing by now, and the child sees the end of its stdin.
    const std::lock_guard lock(input->mutex);
    if (input->pipe) { CloseHandle(input->pipe); input->pipe = nullptr; }
}

void Runner::write_line(const std::string& line) {
    std::shared_ptr<Input> input;
    { const std::lock_guard lock(input_mutex_); input = input_; }
    if (!input) return;
    std::string data = line + "\n";
    {
        const std::lock_guard lock(input->mutex);
        if (!input->open) return;  // the child is gone; typing is fire-and-forget
        input->queue.push_back(std::move(data));
    }
    input->ready.notify_one();
}

void Runner::close_input() noexcept {
    std::shared_ptr<Input> input;
    { const std::lock_guard lock(input_mutex_); input = input_; }
    if (!input) return;
    void* pipe = nullptr;
    {
        const std::lock_guard lock(input->mutex);
        if (!input->open) return;
        input->open = false;
        pipe = input->pipe;
    }
    input->ready.notify_all();
    // A queued write may be blocked inside WriteFile on a child that is not reading.
    // CancelSynchronousIo releases that thread's pending call and CancelIoEx covers
    // the same write on the pipe itself; both are best effort and never fatal.
    if (pipe) CancelIoEx(pipe, nullptr);
    HANDLE writer = nullptr;
    { const std::lock_guard lock(input_mutex_); writer = writer_.joinable() ? writer_.native_handle() : nullptr; }
    if (writer) CancelSynchronousIo(writer);
}

void Runner::finish_input() noexcept {
    close_input();
    std::thread writer;
    { const std::lock_guard lock(input_mutex_); writer = std::move(writer_); }
    if (!writer.joinable()) return;
    if (WaitForSingleObject(writer.native_handle(), writer_join_ms) == WAIT_OBJECT_0) writer.join();
    else writer.detach();  // the shared Input keeps the detached writer safe
}

void Runner::stop() noexcept {
    std::lock_guard lock(mutex_);
    if (!running_) return;
    if (job_) TerminateJobObject(job_, 1);  // kills the process and all descendants
    else if (process_) TerminateProcess(process_, 1);
    // The UI thread must never sit inside WriteFile: the queue is abandoned here and
    // the writer thread releases the pipe once it unwinds.
    close_input();
}

}  // namespace taocode
