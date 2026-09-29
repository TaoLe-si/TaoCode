// 语言服务线程的离线自测（见 native/lsp_worker.hpp）。
//
// 盯的是这次"窗口未响应"真正依赖的三条性质：串行、排干再退、投出去的活儿不会被静默丢掉。
// 任何一条破了，症状都是"界面点语言服务没反应"，而现象里没有栈可看，只能靠用例钉住。
#include "lsp_worker.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <atomic>
#include <chrono>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

int failures = 0;

void run(const std::string& name, const std::function<void()>& body) {
    try {
        body();
        std::cout << "ok   " << name << '\n';
    } catch (const std::exception& error) {
        ++failures;
        std::cout << "FAIL " << name << ": " << error.what() << '\n';
    } catch (...) {
        ++failures;
        std::cout << "FAIL " << name << ": 未知异常\n";
    }
}

bool wait_until(const std::function<bool()>& predicate, int rounds = 200) {
    for (int i = 0; i < rounds; ++i) {
        if (predicate()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    return false;
}

std::vector<int> order;
std::mutex order_mutex;

void records_in_posted_order() {
    taocode::lsp::Worker worker;
    {
        std::lock_guard lock(order_mutex);
        order.clear();
    }
    for (int i = 0; i < 50; ++i) worker.post([i] { std::lock_guard lock(order_mutex); order.push_back(i); });
    worker.stop();
    std::lock_guard lock(order_mutex);
    check(order.size() == 50, "丢了任务：只跑了 " + std::to_string(order.size()) + " 个");
    for (std::size_t i = 0; i < order.size(); ++i)
        check(order[i] == static_cast<int>(i), "第 " + std::to_string(i) + " 个任务不是按投递顺序跑的");
}

// 单线程拥有会话的全部意义：任意两个任务不会重叠。重叠过一次，`Session::mutex_` 的锁序问题就会回来。
void jobs_never_overlap() {
    taocode::lsp::Worker worker;
    std::atomic<int> running{0};
    std::atomic<int> peaked{0};
    for (int i = 0; i < 20; ++i) {
        worker.post([&running, &peaked] {
            const int now = ++running;
            int previous = peaked.load();
            while (now > previous && !peaked.compare_exchange_weak(previous, now)) {}
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
            --running;
        });
    }
    worker.stop();
    check(peaked.load() == 1, "有任务同时在跑（峰值 " + std::to_string(peaked.load()) + "），语言服务线程不再独占");
}

void stop_drains_the_queue() {
    taocode::lsp::Worker worker;
    std::atomic<int> done{0};
    for (int i = 0; i < 30; ++i) worker.post([&done] { std::this_thread::sleep_for(std::chrono::milliseconds(1)); ++done; });
    worker.stop();
    check(done.load() == 30, "stop() 没有先排干队列：只完成 " + std::to_string(done.load()) + " 个");
}

// 收尾期的投递（最后一次文件变更通知之类）不能被丢掉 —— 丢掉的表现是服务器索引停在旧路径。
void post_after_stop_runs_inline() {
    taocode::lsp::Worker worker;
    worker.stop();
    std::atomic<int> done{0};
    worker.post([&done] { ++done; });
    check(done.load() == 1, "stop() 之后投的任务被静默丢掉了");
}

// 任务炸了不能带走线程：线程一死，之后每个 lsp.* 都永远等不到回包（比丢一次结果严重得多）。
void a_throwing_job_does_not_kill_the_worker() {
    taocode::lsp::Worker worker;
    std::atomic<int> after{0};
    worker.post([] { throw std::runtime_error("boom"); });
    worker.post([&after] { ++after; });
    check(wait_until([&after] { return after.load() == 1; }), "一个任务抛异常之后，后面的任务不再被处理");
    worker.stop();
}

void queued_reports_the_backlog() {
    taocode::lsp::Worker worker;
    std::atomic<bool> gate{false};
    worker.post([&gate] { while (!gate.load()) std::this_thread::sleep_for(std::chrono::milliseconds(1)); });
    for (int i = 0; i < 5; ++i) worker.post([] {});
    check(wait_until([&worker] { return worker.queued() >= 4; }), "queued() 读不到积压（队列长度没被维护）");
    gate = true;
    worker.stop();
    check(worker.queued() == 0, "退干净之后 queued() 还不是 0");
}

// 关闭时最坏的那一步：任务堵在一次**没人读的管道写**上（服务器正忙、不读 stdin，管道满）。
// 无界 join 的 stop() 在这里就永远回不来 —— 现象正是"点关闭后窗口未响应"（2026-09-29 实测）。
// 这条用例同时钉两件事：① stop() 在有限时间内返回；② 让它返回的是 CancelSynchronousIo
// （WriteFile 以 ERROR_OPERATION_ABORTED 回来），不是"碰巧写完了"。
void stop_cancels_a_job_parked_in_a_blocking_write() {
    SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE read_side = nullptr;
    HANDLE write_side = nullptr;
    check(CreatePipe(&read_side, &write_side, &attributes, 0), "CreatePipe 失败，用例本身没搭起来");
    taocode::lsp::Worker worker;
    std::atomic<bool> started{false};
    std::atomic<bool> aborted{false};
    std::atomic<DWORD> error{0};
    worker.post([&] {
        // 一次性写远超管道缓冲的数据，且没人读 → WriteFile 必然挂在这里。
        std::vector<char> payload(8u << 20, 'x');
        started = true;
        DWORD written = 0;
        const bool ok = WriteFile(write_side, payload.data(), static_cast<DWORD>(payload.size()), &written, nullptr);
        error = GetLastError();
        aborted = !ok && error == ERROR_OPERATION_ABORTED;
    });
    check(wait_until([&started] { return started.load(); }, 2000), "任务没起来，测不到阻塞写");
    std::this_thread::sleep_for(std::chrono::milliseconds(50));  // 让它确实堵进 WriteFile
    const auto began = std::chrono::steady_clock::now();
    worker.stop();
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - began).count();
    check(aborted.load(), "写没有被取消（错误码 " + std::to_string(error.load()) + "）—— stop() 只是碰巧等到它跑完");
    check(ms < 15000, "stop() 花了 " + std::to_string(ms) + "ms，收尾仍然可能被一次堵住的写拖成长时间未响应");
    CloseHandle(read_side);
    CloseHandle(write_side);
}

}  // namespace

int main() {
    run("任务按投递顺序、一个接一个地跑", records_in_posted_order);
    run("任意两个任务不重叠（线程独占会话）", jobs_never_overlap);
    run("stop() 先把排队的活儿跑完再退", stop_drains_the_queue);
    run("stop() 之后投递就地执行，不静默丢", post_after_stop_runs_inline);
    run("任务抛异常不会带走线程", a_throwing_job_does_not_kill_the_worker);
    run("queued() 报得出积压，退干净后归零", queued_reports_the_backlog);
    run("任务堵在没人读的管道写上，stop() 取消它并有界返回", stop_cancels_a_job_parked_in_a_blocking_write);
    if (failures) {
        std::cout << failures << " test(s) failed\n";
        return 1;
    }
    std::cout << "lsp worker tests passed\n";
    return 0;
}
