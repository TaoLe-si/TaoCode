#include "win_graceful_stop.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <cstddef>
#include <set>

namespace taocode {
namespace graceful_stop {
namespace {

// 本进程此刻有没有控制台。`GetConsoleWindow()` 不能用：控制台没窗口时（本仓子进程就是
// CREATE_NO_WINDOW）它也回 NULL，分不开"没有控制台"与"有控制台但没窗口"。
bool has_console() noexcept {
    const HANDLE handle = CreateFileW(L"CONOUT$", GENERIC_READ | GENERIC_WRITE,
                                      FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                                      OPEN_EXISTING, 0, nullptr);
    if (handle == INVALID_HANDLE_VALUE) return false;
    CloseHandle(handle);
    return true;
}

struct WindowCloseSearch {
    const std::set<unsigned long>* pids = nullptr;
    int closed = 0;
};

BOOL CALLBACK close_window_if_owned(HWND window, LPARAM param) {
    auto* search = reinterpret_cast<WindowCloseSearch*>(param);
    if (!search || !search->pids) return TRUE;
    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    if (pid == 0 || search->pids->count(static_cast<unsigned long>(pid)) == 0) return TRUE;
    // 只关用户看得见的顶层窗口：隐藏的 message-only 窗与工具窗（#32770 之类）不是程序的
    // 主界面，关它们只会打断内部协议。
    if (IsWindowVisible(window) == FALSE) return TRUE;
    if (PostMessageW(window, WM_CLOSE, 0, 0)) ++search->closed;
    return TRUE;
}

}  // namespace

bool send_console_ctrl_c(unsigned long pid) noexcept {
    if (pid == 0) return false;
    if (has_console()) return false;  // AttachConsole 只会 ERROR_ACCESS_DENIED
    if (AttachConsole(static_cast<DWORD>(pid)) == FALSE) return false;
    // 这一记 Ctrl+C 会送到与该控制台相连的**所有**进程 —— 自己也包括在内（本进程刚 attach
    // 上去），所以先让本进程忽略它，投递完再复原。
    SetConsoleCtrlHandler(nullptr, TRUE);
    const BOOL sent = GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0);
    SetConsoleCtrlHandler(nullptr, FALSE);
    FreeConsole();
    return sent == TRUE;
}

int close_top_level_windows(const std::vector<unsigned long>& pids) noexcept {
    std::set<unsigned long> wanted;
    for (const auto pid : pids)
        if (pid != 0) wanted.insert(pid);
    if (wanted.empty()) return 0;
    WindowCloseSearch search{&wanted, 0};
    EnumWindows(&close_window_if_owned, reinterpret_cast<LPARAM>(&search));
    return search.closed;
}

std::vector<unsigned long> job_process_ids(void* job) noexcept {
    std::vector<unsigned long> pids;
    if (!job) return pids;
    // 先按 64 个进程要一次；列表更长时 QueryInformationJobObject 会回 false 并把
    // `returned` 写成需要的字节数，据此再要一次（一次就够：树里几百个进程也放得下）。
    constexpr DWORD kFirstTry = 64;
    std::vector<std::byte> raw(sizeof(JOBOBJECT_BASIC_PROCESS_ID_LIST) +
                               kFirstTry * sizeof(ULONG_PTR));
    DWORD returned = 0;
    if (QueryInformationJobObject(static_cast<HANDLE>(job), JobObjectBasicProcessIdList,
                                  raw.data(), static_cast<DWORD>(raw.size()), &returned) == FALSE) {
        if (returned <= raw.size()) return pids;
        raw.assign(returned, std::byte{});
        if (QueryInformationJobObject(static_cast<HANDLE>(job), JobObjectBasicProcessIdList,
                                      raw.data(), static_cast<DWORD>(raw.size()), &returned) == FALSE)
            return pids;
    }
    const auto* list = reinterpret_cast<const JOBOBJECT_BASIC_PROCESS_ID_LIST*>(raw.data());
    for (DWORD i = 0; i < list->NumberOfProcessIdsInList; ++i)
        pids.push_back(static_cast<unsigned long>(list->ProcessIdList[i]));
    return pids;
}

}  // namespace graceful_stop
}  // namespace taocode
