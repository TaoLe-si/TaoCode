// 请求边界追踪：把 UI 线程每个桥接请求的"进/出"写进 taocode.log。
//
// 存在的理由（2026-09-28 的真实故障）：打开一个大项目后窗口整片"未响应"，而回复里的
// `durationMs` 永远发不出去 —— 日志里连"卡在哪个方法"都没有。有了 begin/end，
// 最后一条 `begin X` 且没有 `end X` 就是卡点本身。
//
// 开关是环境变量 `TAOCODE_TRACE_REQUESTS`（非空且不为 "0"）。默认关闭，正常日志一行都不多写。
#pragma once

#include <filesystem>
#include <mutex>
#include <string>

namespace taocode {
namespace trace {

/** 开关是否打开（进程内只读一次环境变量）。 */
bool on();

/** 记录"开始处理 <what>"（what = 方法名，LSP 请求再带 :kind）。 */
void begin(const std::filesystem::path& profile, const std::string& what);

/** 启动时告诉追踪模块日志写去哪；未调用时所有追踪退化成空操作。 */
void configure(const std::filesystem::path& profile);

/**
 * 带归属记录的互斥锁包装：等锁超过 500ms 就记一行 WARN，并写出**当前持有者是谁**
 * （线程 id + 获取点函数名 + 已持有多久）。
 *
 * 存在的理由：`Session::mutex_` 被别的线程抱住时，UI 线程只会 park 成"窗口未响应"，
 * 现象里看不到持锁者。`begin/end` 能指出卡在哪个方法，这一层指出是谁把锁占住了。
 * 只在 `configure()` 之后生效；未配置时行为与普通 `std::lock_guard` 一致。
 */
class Lock {
public:
    Lock(std::mutex& mutex, const char* site);
    ~Lock();
    Lock(const Lock&) = delete;
    Lock& operator=(const Lock&) = delete;

private:
    std::mutex* mutex_;
    const char* site_;
};

/** 记录"处理完 <what>，耗时 ms"。 */
void end(const std::filesystem::path& profile, const std::string& what, double ms);

/**
 * 装上「写语言服务 stdin 阻塞 ≥200ms」的告警钩子。
 * 调用方可能正抱着 `Session::mutex_`（`Session::change` 就在锁里写）—— 那时整条 UI 线程
 * 会在别处 park 成"未响应"，现象里看不到任何线索，所以必须把线程 id 记下来。
 */
void install_lsp_slow_write(const std::filesystem::path& profile);

}  // namespace trace
}  // namespace taocode
