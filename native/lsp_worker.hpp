// 语言服务独占的一条线程。
//
// 为什么要有它（2026-09-28 实测的死锁）：`Session`/`Host` 的调用会阻塞 —— 起子进程、写 stdin
// 管道、等 initialize 回应。这些调用原先跑在 UI 线程上，并各自抱着 `Session::mutex_` 与
// `Host::io_mutex_`；一旦某条回调路径（读线程上的 initialize-ready 回调 → 补发 didOpen）与
// UI 侧的取锁顺序相反，就是死锁，现象为整个窗口"未响应"、CPU 归零。
//
// 单线程拥有 Session 之后：所有语言服务调用天然串行，UI 线程只投递、只等回包，
// 不再存在"界面线程抱着锁等 I/O"这种状态。IDEA 也是同一个形状 —— 语言服务的工作在后台线程，
// UI 从不阻塞在它上面。
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <functional>
#include <mutex>
#include <thread>

namespace taocode {
namespace lsp {

class Worker {
public:
    Worker();
    ~Worker();
    Worker(const Worker&) = delete;
    Worker& operator=(const Worker&) = delete;

    /** 投递一个任务。已 stop() 之后就地执行 —— 收尾期的任务不能被静默丢掉。 */
    void post(std::function<void()> job);

    /**
     * 跑完已排队的任务再退出；之后调用方可以独占被保护的会话对象。
     *
     * 这条调用**必须有界**：任务里可能是一次阻塞式 `WriteFile`（服务器正忙、没在读 stdin，
     * 管道满），那样 join 永远回不来，现象就是"点关闭后窗口未响应"。所以先等一小段
     * （`kDrainWaitMs`），没退就把这条线程卡住的同步 IO 取消掉（`CancelSynchronousIo`，
     * 与 native/watcher.cpp 的 `CancelIoEx` 同一思路），再收它。
     */
    /** 见 .cpp 的说明。 */
    void stop() noexcept;

    /**
     * 收尾时那条线程**没能收掉**（卡在锁上，`CancelSynchronousIo` 取消不了）⇒ 它被 detach 了，
     * `this` 与它保护的东西还在被它用着，**调用方不能销毁这个 Worker**（见 lsp_recover.cpp 的弃养表）。
     */
    bool abandoned() const noexcept { return abandoned_; }

    /** 排队中的任务数（诊断与测试用）。 */
    std::size_t queued() const;

    /** 第一次有界等待的长度（毫秒），测试与说明都引用它。 */
    static constexpr int kDrainWaitMs = 2000;
    static constexpr int kJoinWaitMs = 3000;

private:
    void loop();

    mutable std::mutex mutex_;
    std::condition_variable ready_;
    std::condition_variable done_;
    std::deque<std::function<void()>> queue_;
    std::thread thread_;
    bool abandoned_ = false;
    bool stopping_ = false;
    bool finished_ = false;
    /** loop() 自己复制出来的线程句柄，供 `CancelSynchronousIo` 用（std::thread 拿不到 HANDLE）。 */
    std::atomic<void*> thread_handle_{nullptr};
};

}  // namespace lsp
}  // namespace taocode
