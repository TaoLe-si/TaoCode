#include "event_channel.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace taocode {

void EventChannel::push(Json payload, void* window, unsigned message, std::size_t limit, std::size_t drop) {
    {
        std::lock_guard lock(mutex_);
        events_.push_back(std::move(payload));
        if (limit != 0 && events_.size() > limit) {
            const std::size_t count = drop != 0 ? drop : limit / 4;
            // 至少丢 1 条，否则 `limit < 4` 时（例如 watch 的 256 传 drop=1 之外的用法）会空转。
            events_.erase(events_.begin(), events_.begin() + static_cast<std::ptrdiff_t>(count == 0 ? 1 : count));
        }
    }
    if (window) PostMessageW(static_cast<HWND>(window), message, 0, 0);
}

std::deque<Json> EventChannel::take() {
    std::lock_guard lock(mutex_);
    // swap 而不是 `std::move`：成员留下一个**空的** deque，下一次 push 不必依赖 moved-from 的语义。
    std::deque<Json> out;
    out.swap(events_);
    return out;
}

std::size_t EventChannel::size() const {
    std::lock_guard lock(mutex_);
    return events_.size();
}

}  // namespace taocode
