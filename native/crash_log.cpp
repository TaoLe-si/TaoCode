#include "crash_log.hpp"

#include <windows.h>

#include <dbghelp.h>
#pragma comment(lib, "dbghelp.lib")

#include <csignal>
#include <cstring>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cwchar>
#include <exception>
#include <string>
#include <typeinfo>

namespace taocode {
namespace diagnostics {
namespace {

std::filesystem::path g_profile;
bool g_installed = false;

/** 崩溃处理器里不能用 ofstream/互斥锁（异步信号不安全），这里只用 Win32 文件 API。 */
void append_raw(const char* text, std::size_t size) noexcept {
    if (g_profile.empty() || !text || !size) return;
    const auto file = g_profile / L"log" / L"taocode.log";
    HANDLE handle = CreateFileW(file.wstring().c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                               OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) return;
    DWORD written = 0;
    WriteFile(handle, text, static_cast<DWORD>(size), &written, nullptr);
    CloseHandle(handle);
}

std::string timestamp_now() {
    SYSTEMTIME time{};
    GetLocalTime(&time);
    char text[32]{};
    std::snprintf(text, sizeof(text), "%04u-%02u-%02u %02u:%02u:%02u", time.wYear, time.wMonth, time.wDay, time.wHour,
                  time.wMinute, time.wSecond);
    return text;
}

/** 一个地址写成 `模块名+0x偏移`（符号化交给 scripts/symbolize_stack.py，需要 PDB）。 */
void describe_frame(void* address, char* out, std::size_t size) {
    HMODULE module = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                            reinterpret_cast<LPCWSTR>(address), &module) || !module) {
        std::snprintf(out, size, "0x%p", address);
        return;
    }
    wchar_t path[MAX_PATH]{};
    GetModuleFileNameW(module, path, MAX_PATH);
    const wchar_t* name = std::wcsrchr(path, L'\\');
    name = name ? name + 1 : path;
    char narrow[MAX_PATH]{};
    WideCharToMultiByte(CP_UTF8, 0, name, -1, narrow, sizeof(narrow), nullptr, nullptr);
    const auto offset = reinterpret_cast<std::uintptr_t>(address) - reinterpret_cast<std::uintptr_t>(module);
    std::snprintf(out, size, "%s+0x%llX", narrow, static_cast<unsigned long long>(offset));
}

/**
 * 抓一份自己的 minidump：在**栈还完整**的时候拍下来。
 * 为什么不用进程内取栈：实测 abort 路径上 CaptureStackBackTrace 拿到 0 帧（CRT 的报告路径换了栈），
 * 而 minidump 带的是崩溃线程真实的 CONTEXT 与整段栈 —— 离线用 scripts/dump_fault.py + PDB 还原调用链。
 * 文件名固定（只留最后一份），写不出来也不影响后面的日志行。
 */
void write_self_dump() noexcept {
    if (g_profile.empty()) return;
    const auto file = g_profile / L"crash.dmp";
    HANDLE handle = CreateFileW(file.wstring().c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                                FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) return;
    const auto process = GetCurrentProcess();
    MiniDumpWriteDump(process, GetProcessId(process), handle, MiniDumpWithThreadInfo, nullptr, nullptr, nullptr);
    CloseHandle(handle);
}

/** 崩溃处理器里只做"取栈 + 拼字符串"，不做符号化。 */
void write_crash(const char* reason, const std::string& detail) noexcept {
    write_self_dump();
    char body[4096]{};
    std::snprintf(body, sizeof(body), "%s ERROR - 崩溃 · %s%s%s（栈：%s）\n", timestamp_now().c_str(), reason,
                  detail.empty() ? "" : "：", detail.c_str(), crash_stack_text().c_str());
    append_raw(body, std::strlen(body));
}

/** `std::terminate` 的落点：未捕获异常走这条（fastfail 码 7 的真身）。 */
void on_terminate() noexcept {
    std::string detail;
    if (const auto current = std::current_exception()) {
        try {
            std::rethrow_exception(current);
        } catch (const std::exception& error) {
            detail = std::string(typeid(error).name()) + " " + error.what();
        } catch (...) {
            detail = "非 std::exception 类型";
        }
    }
    write_crash("std::terminate（未捕获异常）", detail);
    std::abort();
}

/** 有人直接 `abort()`（断言失败、CRT 内部检查）时也留一条。 */
void on_abort(int) {
    write_crash("SIGABRT（abort 或断言）", {});
    std::signal(SIGABRT, SIG_DFL);
    std::raise(SIGABRT);
}

/** 访问违例等 SEH 异常：不走 terminate，但同样需要线索。 */
LONG WINAPI on_unhandled(EXCEPTION_POINTERS* info) {
    char detail[160]{};
    if (info && info->ExceptionRecord)
        std::snprintf(detail, sizeof(detail), "异常码 0x%08lX 地址 0x%p", info->ExceptionRecord->ExceptionCode,
                      info->ExceptionRecord->ExceptionAddress);
    write_crash("未处理的结构化异常", detail);
    return EXCEPTION_CONTINUE_SEARCH;  // 继续交给 WER，崩溃现场不吞
}

}  // namespace

std::string crash_stack_text(unsigned frames) {
    if (!frames) frames = 1;
    if (frames > 62) frames = 62;
    void* stack[62]{};
    const auto captured = CaptureStackBackTrace(0, frames, stack, nullptr);
    std::string text;
    char frame[400]{};
    for (USHORT i = 0; i < captured; ++i) {
        describe_frame(stack[i], frame, sizeof(frame));
        if (!text.empty()) text += " <- ";
        text += frame;
    }
    return text;
}

void install_crash_log(const std::filesystem::path& profile) {
    if (!profile.empty()) g_profile = profile;
    if (g_installed) return;
    g_installed = true;
    std::set_terminate(on_terminate);
    std::signal(SIGABRT, on_abort);
    SetUnhandledExceptionFilter(on_unhandled);
}

}  // namespace diagnostics
}  // namespace taocode
