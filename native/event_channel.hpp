#pragma once

#include <cstddef>
#include <deque>
#include <mutex>
#include <utility>

#include "workspace.hpp"  // Json

// 后台线程 → UI 线程的事件队列。
//
// 主机的模式是：每个后台域（clone / lsp / run / dap / term / watch / search / git / gradle）各有一个
// `WM_APP + N` 消息与一个队列 —— 后台线程入队后 `PostMessage`，UI 线程收到消息就把整批换出来发给前端。
// 这套逻辑在九个域里**逐字相同**（加锁、限长、PostMessage、swap）。2026-09-27 拆 Gradle 时实测
// main.cpp 因此超了机检上限（2170 > 2110），于是把它收成一个类：每个域只剩一条成员声明 + 两行转发。
//
// 线程安全：`push` 可从任意线程调用；`take` / `size` 只在 UI 线程调用（`take` 换出整批，锁的作用域最小）。
namespace taocode {

class EventChannel {
public:
    /**
     * 入队并唤醒 UI 线程。`window` 是 HWND（用 `void*` 以免头文件引 windows.h），
     * `message` 是该域的 `WM_APP + N`。
     *
     * 限长语义与原每个域里逐字相同的那几行一致：
     *   · `limit == 0` → **不限长**（git 回复队列原本就没有上限）；
     *   · 超过 `limit` 时丢掉最旧的 `drop` 条，`drop == 0` 时取 `limit / 4`
     *     （run / gradle 是 4096 丢 1024 = 1/4；term 是 8192 丢 2048 = 1/4；
     *      watch 256 丢 1、lsp 512 丢 1、dap 2048 丢 1 需要显式传 `drop`）。
     */
    void push(Json payload, void* window, unsigned message, std::size_t limit = 4096, std::size_t drop = 0);

    /** UI 线程取走当前全部事件（为空时返回空 deque）。 */
    std::deque<Json> take();

    /** 当前积压数量（只给 UI 线程的"还有多少在飞"用，例如 git.progress）。 */
    std::size_t size() const;

private:
    mutable std::mutex mutex_;
    std::deque<Json> events_;
};

}  // namespace taocode
