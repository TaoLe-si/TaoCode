// Offline self-test for EventChannel: the "background thread -> UI thread" queue that the nine
// host domains (clone/lsp/run/dap/term/watch/search/git/gradle) used to duplicate verbatim.
//
// It checks the three things the per-domain copies actually did — order, bounded length with
// drop-oldest, and the PostMessage wake-up — so collapsing them into one class cannot silently
// change the flood-guard behaviour of a domain.
#include "event_channel.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <deque>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using taocode::EventChannel;
using taocode::Json;

constexpr UINT kTestMessage = WM_APP + 40;
constexpr wchar_t kClassName[] = L"TaoCodeEventChannelTest";

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

Json event(int index) { return Json{{"n", index}}; }

int number_of(const Json& value) { return value.at("n").get<int>(); }

int failures = 0;

void run(const std::string& name, const std::function<void()>& body) {
    try {
        body();
        std::cout << "ok   " << name << '\n';
    } catch (const std::exception& error) {
        ++failures;
        std::cout << "FAIL " << name << ": " << error.what() << '\n';
    }
}

/** 一个 message-only 窗口，用来验证 push() 真的往 UI 线程投了一条消息。 */
HWND create_message_window() {
    WNDCLASSW window_class{};
    window_class.lpfnWndProc = DefWindowProcW;
    window_class.hInstance = GetModuleHandleW(nullptr);
    window_class.lpszClassName = kClassName;
    RegisterClassW(&window_class);  // 重复注册返回 0，无害
    return CreateWindowExW(0, kClassName, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr,
                           window_class.hInstance, nullptr);
}

}  // namespace

int main() {
    run("空队列 take() 返回空且不吞消息", [] {
        EventChannel channel;
        check(channel.take().empty(), "空队列应返回空 deque");
        check(channel.size() == 0, "空队列 size() 应为 0");
    });

    run("入队顺序与 take() 的整批换出一致", [] {
        EventChannel channel;
        for (int index = 0; index < 3; ++index) channel.push(event(index), nullptr, kTestMessage);
        check(channel.size() == 3, "size() 应反映积压数量");
        const auto events = channel.take();
        check(events.size() == 3, "应换出 3 条");
        for (int index = 0; index < 3; ++index) check(number_of(events[static_cast<std::size_t>(index)]) == index, "顺序应为 FIFO");
        check(channel.take().empty(), "换出后队列应为空");
    });

    run("超限时按 limit/4 丢最旧的（run / gradle / term 的语义）", [] {
        EventChannel channel;
        for (int index = 0; index < 9; ++index) channel.push(event(index), nullptr, kTestMessage, 8);
        check(channel.size() == 7, "9 条超过 8 → 丢掉最旧 8/4=2 条，剩 7");
        const auto events = channel.take();
        check(number_of(events.front()) == 2, "被丢掉的是最旧的两条（n=0,1）");
    });

    run("显式 drop 支持 watch / lsp / dap 的「一条一条丢」", [] {
        EventChannel channel;
        for (int index = 0; index < 9; ++index) channel.push(event(index), nullptr, kTestMessage, 8, 1);
        check(channel.size() == 8, "drop=1 时每超一次只丢一条");
        const auto events = channel.take();
        check(number_of(events.front()) == 1, "丢掉的只有 n=0");
    });

    run("limit 为 0 表示不限长（git 回复队列原本没有上限）", [] {
        EventChannel channel;
        for (int index = 0; index < 5000; ++index) channel.push(event(index), nullptr, kTestMessage, 0);
        check(channel.size() == 5000, "limit=0 不应丢任何事件");
        check(number_of(channel.take().front()) == 0, "第一条仍是最早入队的");
    });

    run("push() 真的向窗口投递了唤醒消息", [] {
        const HWND window = create_message_window();
        check(window != nullptr, "创建 message-only 窗口失败");
        EventChannel channel;
        channel.push(event(1), reinterpret_cast<void*>(window), kTestMessage);
        MSG message{};
        bool delivered = false;
        while (PeekMessageW(&message, window, kTestMessage, kTestMessage, PM_REMOVE)) delivered = true;
        DestroyWindow(window);
        check(delivered, "UI 线程应收到该域的消息");
        check(channel.take().size() == 1, "消息投递与入队应当是两件互不影响的事");
    });

    std::cout << (failures == 0 ? "event_channel: all checks passed\n" : "event_channel: failures\n");
    return failures == 0 ? 0 : 1;
}
