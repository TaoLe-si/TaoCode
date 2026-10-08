#pragma once

#include <vector>

namespace taocode {
namespace graceful_stop {

// 「优雅停止」的 Windows 侧原件（上游 `KillableProcessHandler` 的 soft kill：
// 第一次按 Stop 只**请求**对方自己退，再按一次才强杀 —— `KillableProcessHandler.java:26-30`
// 的类注释；Windows 那一支是 `WinProcessTerminator.terminateWinProcessGracefully`
// （`platform/platform-util-io/src/com/intellij/execution/process/WinProcessTerminator.kt:23`）
// 走 `LocalProcessService.sendWinProcessCtrlC`，也就是 WinP 的 `WinProcess.sendCtrlC`
// → `AttachConsole` + `GenerateConsoleCtrlEvent`）。
//
// 这里只放三件和 WinAPI 打交道的事，规则（第一次/第二次、发不出去就强杀）在调用方
// （`native/runner.cpp` 的 `Runner::request_graceful_exit` 与 `native/run_host.cpp` 的
// `Manager::stop`），离屏可测的那部分也就靠它们各自的判据钉住。

// 给 `pid` 自己的控制台发一记 CTRL_C_EVENT。做法：AttachConsole(pid) → 让**本进程**忽略
// Ctrl+C（SetConsoleCtrlHandler(NULL, TRUE)）→ GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)
// （0 = 该控制台上的所有进程，也就是子进程那棵树）→ 复原 → FreeConsole()。
//
// 返回 true = 事件**投递出去了**（进程不一定就此退出）。返回 false = 这条宿主没法优雅通知：
//   · 本进程已经挂着控制台（AttachConsole 会 ERROR_ACCESS_DENIED）—— 生产的 TaoCode.exe 是
//     WIN32 子系统、没有控制台走得到；控制台里跑的 ctest/调试宿主走不到；
//   · 目标进程没有控制台（GUI 程序，WinP 的 sendctrlc 在这里也是 ERROR_INVALID_HANDLE(6)，
//     `KillableProcessHandler.java:181-200` 就是为这条回退写的）。
// 两种情况调用方都按上游同一分支处理：退回强杀。
bool send_console_ctrl_c(unsigned long pid) noexcept;
// 给这些进程的**可见顶层窗口** PostMessage(WM_CLOSE)，返回投递成功的窗口数。
// GUI 程序（Swing/Qt/.NET）只有这条路能自己收拾现场；控制台程序这里恒 0（它的控制台窗口属于
// conhost.exe，不在树里）。用 PostMessage 而不是 SendMessage：绝不在调用线程上等对方响应。
int close_top_level_windows(const std::vector<unsigned long>& pids) noexcept;

// Job Object 里此刻的 pid 全表 —— 本仓的 Job Object 就是"要结束的那棵树"的真源
// （`native/runner.cpp:212-218` 用 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 建它），
// 所以这里不必再走一遍 Toolhelp 快照。拿不到就回空表。
std::vector<unsigned long> job_process_ids(void* job) noexcept;

}  // namespace graceful_stop
}  // namespace taocode
