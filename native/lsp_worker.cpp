// 语言服务线程的实现（见 lsp_worker.hpp 的说明）。
#include "lsp_worker.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <chrono>
#include <utility>

namespace taocode {
namespace lsp {

Worker::Worker() : thread_([this] { loop(); }) {}

Worker::~Worker() { stop(); }

void Worker::post(std::function<void()> job) {
    if (!job) return;
    {
        std::lock_guard lock(mutex_);
        if (!stopping_) {
            queue_.push_back(std::move(job));
            ready_.notify_one();
            return;
        }
    }
    // 已经 stop()：就地跑完，别把收尾期的通知（例如最后一次文件变更）静默吞掉。
    job();
}

void Worker::stop() noexcept {
    {
        std::lock_guard lock(mutex_);
        if (stopping_) return;
        stopping_ = true;
    }
    ready_.notify_all();
    // 任务里可能反过来调 stop()（服务器自己退出时清理），那时不能自己 join 自己。
    if (!thread_.joinable() || thread_.get_id() == std::this_thread::get_id()) return;
    const auto joined = [this] {
        std::unique_lock lock(mutex_);
        return done_.wait_for(lock, std::chrono::milliseconds(kDrainWaitMs), [this] { return finished_; });
    };
    if (joined()) { thread_.join(); return; }
    // 到这儿还没退 = 任务正堵在一次同步 I/O 上（最典型：往一个不再读 stdin 的服务器写数据）。
    // 取消它，让那次 WriteFile 以 ERROR_OPERATION_ABORTED 返回；任务本身随后收尾。
    // 与 native/watcher.cpp 的 stop() 同一形状：先给退出信号，再取消挂住的 I/O，最后收线程。
    if (const auto handle = thread_handle_.load()) CancelSynchronousIo(static_cast<HANDLE>(handle));
    // 取消之后剩下的等待都是有界的（请求超时、进程回收各自带时限），所以这里可以安心 join。
    thread_.join();
}

std::size_t Worker::queued() const {
    std::lock_guard lock(mutex_);
    return queue_.size();
}

void Worker::loop() {
    // std::thread 不给 HANDLE；DuplicateHandle 一份自己（只在本线程退出前用于取消同步 IO）。
    HANDLE self = nullptr;
    DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(), &self, 0, FALSE, DUPLICATE_SAME_ACCESS);
    thread_handle_.store(self);
    for (;;) {
        std::function<void()> job;
        {
            std::unique_lock lock(mutex_);
            ready_.wait(lock, [this] { return stopping_ || !queue_.empty(); });
            if (queue_.empty()) {
                if (stopping_) break;   // 排队的活儿先干完，再退
                continue;
            }
            job = std::move(queue_.front());
            queue_.pop_front();
        }
        try {
            job();
        } catch (...) {
            // 一个任务炸了不能带走线程：线程一死，后面每个 lsp.* 都会永远等不到回包，
            // 那比丢一次结果糟得多。异常本来就该在任务里被转成回包，这里只是兜底。
        }
    }
    {
        std::lock_guard lock(mutex_);
        finished_ = true;
    }
    done_.notify_all();
    thread_handle_.store(nullptr);
    if (self) CloseHandle(self);
}

}  // namespace lsp
}  // namespace taocode
