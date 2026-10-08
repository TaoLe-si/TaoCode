#pragma once

#include <filesystem>
#include <string>

// **线程转储**（IDEA `com.intellij.diagnostic.ThreadDumpService` / `PreciseEventWatcher` 的对应物）。
//
// 上游那份是 JVM 侧的：`ThreadDumpService.dump()` 走 `ThreadMXBean` / `Thread.getAllStackTraces()`
// 拿到每个线程的栈，用来诊断"界面卡住时到底卡在哪个线程"。本仓是 C++ 事件循环 + WebView2，
// 没有 JVM 的线程模型可问 —— 等价物是 Win32 的 `Toolhelp32` 线程快照 + `StackWalk64`
// （dbghelp）：挂起每个线程、取 CONTEXT、沿栈回溯到模块名+偏移。
//
// 为什么单独成文件（2026-10-06）：`native/crash_log.cpp` 管的是"崩溃那一刻的现场"（terminate/
// SEH 钩子 + minidump），本文件管的是"进程还活着时按需抓一份全部线程的栈" —— 两者共用
// dbghelp 但触发时机与用途完全不同（一个是崩溃路径、一个是可以随时调用的诊断动作），
// 所以拆成两个文件、一个职责一个。
namespace taocode {
namespace diagnostics {

/**
 * 抓一份当前进程的**全部线程**的调用栈，返回可直接粘贴的文本
 * （形如 `Thread 1234 (0x4D2):\n  TaoCode.exe+0x1D1559\n  ...`）。
 *
 * 符号化只到 `模块名+偏移`（与 `crash_stack_text` 同一口径）：函数名/行号交给
 * `scripts/symbolize_stack.py` 用 PDB 还原，进程内不做符号查找（避免拖住被诊断的进程）。
 * 拿不到 dbghelp 时退化成"线程 id + 起始地址"，绝不抛异常 —— 诊断本身不该把进程带崩。
 */
std::string thread_dump();

/** 同 `thread_dump()`，但写进 `<profile>/thread-dump-<时间戳>.txt`，返回 `{path, threads}`。
 *  profile 为空或写不出来时 `path` 为空、`threads` 仍是真实抓到的线程数。 */
struct ThreadDumpFile {
    std::string path;
    int threads = 0;
};
ThreadDumpFile write_thread_dump(const std::filesystem::path& profile);

}  // namespace diagnostics
}  // namespace taocode