// 线程转储实现（见 thread_dump.hpp 的源码对照）。
//
// 做法：Toolhelp32 线程快照 → 逐个 `OpenThread` + `SuspendThread` + `GetThreadContext`
// → `StackWalk64` 沿栈回溯，每一步用 `SymGetModuleBase64` 把地址归到模块，
// 写成 `模块名+0x偏移`（符号化交给 scripts/symbolize_stack.py，进程内不做符号查找）。
//
// 三条必须守住的边界：
//   · **不挂起当前线程**（挂起自己 = 死锁）；当前线程单独用 `CaptureStackBackTrace` 取。
//   · 每个线程用完立刻 `ResumeThread` + `CloseHandle`，任何一条路径都不许漏（否则被诊断的
//     进程会留下挂起的线程，比不诊断更糟）。用一个小 RAII 卫兵管这件事。
//   · 任何一步失败都只跳过那个线程/那一帧，绝不抛异常 —— 诊断动作不该把进程带崩。

#include "thread_dump.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <dbghelp.h>
#include <tlhelp32.h>
#pragma comment(lib, "dbghelp.lib")

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <fstream>
#include <string>
#include <vector>

namespace taocode {
namespace diagnostics {
namespace {

/** 一个地址写成 `模块名+0x偏移`（与 crash_log.cpp 的 describe_frame 同一口径）。 */
void describe_address(DWORD64 address, char* out, std::size_t size) {
    HMODULE module = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                            reinterpret_cast<LPCWSTR>(static_cast<std::uintptr_t>(address)), &module) ||
        !module) {
        std::snprintf(out, size, "0x%llX", static_cast<unsigned long long>(address));
        return;
    }
    wchar_t path[MAX_PATH]{};
    GetModuleFileNameW(module, path, MAX_PATH);
    const wchar_t* name = std::wcsrchr(path, L'\\');
    name = name ? name + 1 : path;
    char narrow[MAX_PATH]{};
    WideCharToMultiByte(CP_UTF8, 0, name, -1, narrow, sizeof(narrow), nullptr, nullptr);
    const auto offset = address - reinterpret_cast<DWORD64>(module);
    std::snprintf(out, size, "%s+0x%llX", narrow, static_cast<unsigned long long>(offset));
}

/** `SuspendThread` 的配对卫兵：析构时一定恢复并关句柄。 */
struct SuspendedThread {
    HANDLE handle = nullptr;
    bool suspended = false;
    explicit SuspendedThread(HANDLE value) : handle(value) {}
    ~SuspendedThread() {
        if (!handle) return;
        if (suspended) ResumeThread(handle);
        CloseHandle(handle);
    }
    SuspendedThread(const SuspendedThread&) = delete;
    SuspendedThread& operator=(const SuspendedThread&) = delete;
};

/** 沿一个已挂起线程的栈回溯，把每一帧写成一行。返回帧数。 */
int walk_stack(HANDLE thread, const CONTEXT& context, std::string& text, int max_frames) {
    STACKFRAME64 frame{};
    frame.AddrPC.Offset = context.Rip;
    frame.AddrPC.Mode = AddrModeFlat;
    frame.AddrFrame.Offset = context.Rbp;
    frame.AddrFrame.Mode = AddrModeFlat;
    frame.AddrStack.Offset = context.Rsp;
    frame.AddrStack.Mode = AddrModeFlat;
    const auto process = GetCurrentProcess();
    int frames = 0;
    char line[400]{};
    for (int index = 0; index < max_frames; ++index) {
        if (!StackWalk64(IMAGE_FILE_MACHINE_AMD64, process, thread, &frame, const_cast<CONTEXT*>(&context), nullptr,
                         SymFunctionTableAccess64, SymGetModuleBase64, nullptr))
            break;
        if (frame.AddrPC.Offset == 0) break;
        describe_address(frame.AddrPC.Offset, line, sizeof(line));
        text += "  ";
        text += line;
        text += '\n';
        ++frames;
    }
    return frames;
}

}  // namespace

std::string thread_dump() {
    const auto process = GetCurrentProcess();
    const DWORD self = GetCurrentThreadId();
    // `SymInitialize` 幂等（重复调用只是返回真）；失败也继续 —— 那样只有模块名退化成裸地址。
    const bool symbols = SymInitialize(process, nullptr, TRUE) != FALSE;
    std::string text;
    text += "线程转储（TaoCode 进程 " + std::to_string(GetCurrentProcessId()) + "）\n";

    const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snapshot == INVALID_HANDLE_VALUE) {
        text += "（无法枚举线程：Toolhelp 快照失败）\n";
        if (symbols) SymCleanup(process);
        return text;
    }
    THREADENTRY32 entry{};
    entry.dwSize = sizeof(entry);
    int total = 0;
    if (Thread32First(snapshot, &entry)) {
        do {
            if (entry.th32OwnerProcessID != GetCurrentProcessId()) continue;
            ++total;
            text += "Thread " + std::to_string(entry.th32ThreadID) + ":\n";
            if (entry.th32ThreadID == self) {
                // 当前线程不能挂起自己：用 CaptureStackBackTrace 取（与 crash_log 同一条路）。
                void* stack[62]{};
                const auto captured = CaptureStackBackTrace(0, 62, stack, nullptr);
                char line[400]{};
                for (USHORT index = 0; index < captured; ++index) {
                    describe_address(reinterpret_cast<DWORD64>(stack[index]), line, sizeof(line));
                    text += "  ";
                    text += line;
                    text += '\n';
                }
                continue;
            }
            SuspendedThread guard(OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION,
                                             FALSE, entry.th32ThreadID));
            if (!guard.handle) {
                text += "  （无法打开线程）\n";
                continue;
            }
            if (SuspendThread(guard.handle) == static_cast<DWORD>(-1)) {
                text += "  （无法挂起线程）\n";
                continue;
            }
            guard.suspended = true;
            CONTEXT context{};
            context.ContextFlags = CONTEXT_FULL;
            if (!GetThreadContext(guard.handle, &context)) {
                text += "  （无法读取线程上下文）\n";
                continue;
            }
            if (walk_stack(guard.handle, context, text, 62) == 0) text += "  （无帧）\n";
        } while (Thread32Next(snapshot, &entry));
    }
    CloseHandle(snapshot);
    if (symbols) SymCleanup(process);
    text += "共 " + std::to_string(total) + " 个线程。\n";
    return text;
}

ThreadDumpFile write_thread_dump(const std::filesystem::path& profile) {
    const auto body = thread_dump();
    ThreadDumpFile result;
    // 线程数从正文里数（`Thread ` 开头那几行）：正文是唯一真相，不另存一份计数。
    for (std::size_t pos = 0; (pos = body.find("Thread ", pos)) != std::string::npos; pos += 7) ++result.threads;
    if (profile.empty()) return result;
    std::error_code error;
    const auto directory = profile / L"log";
    std::filesystem::create_directories(directory, error);
    SYSTEMTIME now{};
    GetLocalTime(&now);
    char stamp[32]{};
    std::snprintf(stamp, sizeof(stamp), "%04u%02u%02u-%02u%02u%02u", now.wYear, now.wMonth, now.wDay, now.wHour,
                  now.wMinute, now.wSecond);
    const auto file = directory / (std::wstring(L"thread-dump-") + std::wstring(stamp, stamp + std::strlen(stamp)) + L".txt");
    std::ofstream out(file, std::ios::binary | std::ios::trunc);
    if (!out) return result;
    out << body;
    out.flush();
    if (!out) return result;
    result.path = file.string();
    return result;
}

}  // namespace diagnostics
}  // namespace taocode