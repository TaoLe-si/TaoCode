// 窗口态（全屏）的实现 —— 见 window_state.hpp 的模块说明（含 IDEA 依据与全屏语义）。
#include "window_state.hpp"

#include "workspace.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace taocode {
namespace {

HWND g_window = nullptr;
bool g_full_screen = false;
// 进入全屏前的样式与矩形。退出时要**原样恢复** —— 不恢复用户就丢了窗口大小与位置。
LONG_PTR g_saved_style = 0;
RECT g_saved_rect{};

void require_window() {
    if (!g_window) throw WorkspaceError("NO_WINDOW", "窗口尚未创建，无法切换全屏。");
}

}  // namespace

void register_window(void* window) {
    g_window = static_cast<HWND>(window);
    // 换了窗口就等于回到窗口态：旧的全屏状态与保存的样式不再有意义。
    g_full_screen = false;
    g_saved_style = 0;
}

Json set_full_screen(bool full_screen) {
    require_window();
    if (full_screen == g_full_screen) return {{"fullScreen", g_full_screen}, {"changed", false}};

    if (full_screen) {
        g_saved_style = GetWindowLongPtrW(g_window, GWL_STYLE);
        if (!GetWindowRect(g_window, &g_saved_rect))
            throw WorkspaceError("IO_ERROR", "无法读取窗口位置。");
        // `WS_OVERLAPPEDWINDOW` 的装饰位全去掉；`WS_POPUP` 不是必须的，去掉装饰就够。
        SetWindowLongPtrW(g_window, GWL_STYLE,
                          g_saved_style & ~(WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU));
        MONITORINFO monitor{};
        monitor.cbSize = sizeof(monitor);
        if (!GetMonitorInfoW(MonitorFromWindow(g_window, MONITOR_DEFAULTTONEAREST), &monitor))
            throw WorkspaceError("IO_ERROR", "无法读取显示器信息。");
        // `rcMonitor` = 整个显示器（含任务栏区域）；`rcWork` 会留下任务栏，那不是全屏。
        const auto& area = monitor.rcMonitor;
        // `SWP_FRAMECHANGED` 是必须的：不重算非客户区，去掉的边框不会立刻生效。
        if (!SetWindowPos(g_window, HWND_TOP, area.left, area.top, area.right - area.left,
                          area.bottom - area.top, SWP_NOZORDER | SWP_FRAMECHANGED))
            throw WorkspaceError("IO_ERROR", "无法把窗口切到全屏。");
    } else {
        if (g_saved_style != 0) SetWindowLongPtrW(g_window, GWL_STYLE, g_saved_style);
        SetWindowPos(g_window, nullptr, g_saved_rect.left, g_saved_rect.top,
                     g_saved_rect.right - g_saved_rect.left, g_saved_rect.bottom - g_saved_rect.top,
                     SWP_NOZORDER | SWP_FRAMECHANGED);
    }
    g_full_screen = full_screen;
    // 读取真实状态返回，而不是回显入参 —— SetWindowPos 可能失败（上面已抛），成功时两者一致，
    // 但读一次让"状态"这件事只有一个来源。
    return {{"fullScreen", g_full_screen}, {"changed", true}};
}

Json full_screen_state() {
    return {{"fullScreen", g_full_screen}};
}

}  // namespace taocode
