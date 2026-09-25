#include "runner.hpp"

#include "workspace.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <vector>

namespace taocode {

Runner::Runner() = default;

Runner::~Runner() {
    {
        std::lock_guard lock(mutex_);
        if (running_ && job_) TerminateJobObject(job_, 1);
        else if (running_ && process_) TerminateProcess(process_, 1);
        if (stdin_write_) { CloseHandle(stdin_write_); stdin_write_ = nullptr; }
    }
    if (reader_.joinable()) reader_.join();
    if (stdout_read_) CloseHandle(stdout_read_);
    if (process_) CloseHandle(process_);
    if (thread_) CloseHandle(thread_);
    if (job_) CloseHandle(job_);
}

void Runner::start(const Spec& spec, Output on_output, Done on_done) {
    std::lock_guard lock(mutex_);
    if (running_) throw WorkspaceError("RUNNING", "已有构建/运行任务在进行中。");
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

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = stdin_read;
    startup.hStdOutput = stdout_write;
    startup.hStdError = stdout_write;  // merge stderr into the single output stream
    PROCESS_INFORMATION info{};
    const auto working = spec.working_directory.empty() ? nullptr : spec.working_directory.c_str();
    const BOOL created = CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, TRUE,
                                        CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED, nullptr, working, &startup, &info);
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
    stdin_write_ = stdin_write;
    stdout_read_ = stdout_read;
    process_ = info.hProcess;
    thread_ = info.hThread;
    running_ = true;
    reader_ = std::thread([this] { reader_loop(); });
}

void Runner::reader_loop() {
    std::vector<char> buffer(16384);
    for (;;) {
        DWORD got = 0;
        if (!ReadFile(stdout_read_, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr) || !got) break;
        if (on_output_) on_output_({buffer.data(), got});
    }
    DWORD code = 1;
    if (process_) {
        WaitForSingleObject(process_, INFINITE);
        GetExitCodeProcess(process_, &code);
    }
    running_ = false;
    if (on_done_) on_done_(static_cast<int>(code));
}

void Runner::write_line(const std::string& line) {
    std::lock_guard lock(mutex_);
    if (!stdin_write_ || !running_) return;
    const std::string data = line + "\n";
    std::size_t offset = 0;
    while (offset < data.size()) {
        DWORD written = 0;
        if (!WriteFile(stdin_write_, data.data() + offset, static_cast<DWORD>(data.size() - offset), &written, nullptr) || !written)
            return;
        offset += written;
    }
}

void Runner::stop() noexcept {
    std::lock_guard lock(mutex_);
    if (!running_) return;
    if (stdin_write_) { CloseHandle(stdin_write_); stdin_write_ = nullptr; }
    if (job_) TerminateJobObject(job_, 1);  // kills the process and all descendants
    else if (process_) TerminateProcess(process_, 1);
}

}  // namespace taocode
