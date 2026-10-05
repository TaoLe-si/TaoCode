// Offline self-test for the Gradle host support: a sync really runs a command in the
// project directory, streams its output back, reports the exit code, refuses a second
// concurrent sync and can be cancelled mid-flight.
//
// 识别（"是不是 Gradle 项目"）不在宿主里 —— 那是前端纯函数 `detectGradle` 的职责，
// 由 tests/gradle.test.mjs 覆盖（GradleConstants 的两张表只实现一份，见 gradle.hpp 的说明）。
#include "gradle.hpp"

#include "text.hpp"  // taocode::wide

#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

namespace fs = std::filesystem;
using taocode::WorkspaceError;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

void write_file(const fs::path& file, const std::string& text) {
    fs::create_directories(file.parent_path());
    std::ofstream out(file, std::ios::binary);
    out << text;
}

fs::path temp_root(const std::string& name) {
    const auto base = fs::temp_directory_path() / (L"taocode-gradle-test-" + taocode::wide(name));
    std::error_code error;
    fs::remove_all(base, error);
    fs::create_directories(base, error);
    return base;
}

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

}  // namespace

int main() {
    run("SyncSession 真的在项目目录里跑命令并把退出码回传", [] {
        const auto root = temp_root("sync");
        write_file(root / "build.gradle", "");
        taocode::gradle::SyncSession session;
        check(!session.running(), "未 start 时 running() 应为 false");

        // 回调跑在 runner 的 reader 线程上：里面**不能抛**（抛出去就是 std::terminate），
        // 所以只记录事实，断言全部等回到主线程再做。
        std::mutex mutex;
        std::condition_variable ready;
        std::string output;
        int exit_code = -1;
        bool finished = false;
        bool was_cancelled = true;
        session.start(root, "echo taocode-gradle-sync-probe", {},
                      [&](std::string_view text) { std::lock_guard lock(mutex); output += text; },
                      [&](int code, bool cancelled) {
                          std::lock_guard lock(mutex);
                          exit_code = code;
                          was_cancelled = cancelled;
                          finished = true;
                          ready.notify_all();
                      });
        {
            std::unique_lock lock(mutex);
            ready.wait_for(lock, std::chrono::seconds(30), [&] { return finished; });
        }
        check(finished, "同步应在 30 秒内结束");
        check(exit_code == 0, "echo 的退出码应为 0，实为 " + std::to_string(exit_code));
        check(!was_cancelled, "正常跑完不应被标为取消");
        check(output.find("taocode-gradle-sync-probe") != std::string::npos, "输出应含被回显的探针串，实为 " + output);
        check(!session.running(), "结束后 running() 应回到 false");
    });

    run("同步进行中再 start 抛 BUSY，cancel() 会把它停掉", [] {
        const auto root = temp_root("busy");
        taocode::gradle::SyncSession session;
        std::mutex mutex;
        std::condition_variable ready;
        bool finished = false;
        bool cancelled = false;
        // ping 自带等待：整条命令大约 4 秒，足够观察"进行中"的状态。
        session.start(root, "ping -n 5 127.0.0.1 > nul", {},
                      [](std::string_view) {},
                      [&](int, bool was_cancelled) {
                          std::lock_guard lock(mutex);
                          cancelled = was_cancelled;
                          finished = true;
                          ready.notify_all();
                      });
        for (int attempt = 0; attempt < 200 && !session.running(); ++attempt)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        check(session.running(), "命令应处于运行中");

        bool busy = false;
        try {
            session.start(root, "echo nope", {}, [](std::string_view) {}, [](int, bool) {});
        } catch (const WorkspaceError& error) {
            busy = std::string(error.code) == "BUSY";
        }
        check(busy, "重复 start 应抛 BUSY");

        session.cancel();
        {
            std::unique_lock lock(mutex);
            ready.wait_for(lock, std::chrono::seconds(30), [&] { return finished; });
        }
        check(finished, "取消后 done 回调应被调用");
        check(cancelled, "取消的回调应标 cancelled=true");
    });

    // 回归：`start_sync` 收到的必须是**能活过本函数**的回调。原先它用 `[&emit]` 捕获调用方的
    // 临时 std::function，处理器一返回捕获就悬空 —— 后台线程推第一批输出时 std::bad_function_call
    // → terminate → 进程以 0xC0000409 退出（真机症状：打开带 Gradle 工程的工程一秒内崩，见 HANDOFF）。
    // 这条用例把那个形态原样摆出来：emit 传**临时 lambda**，而它捕获的是 shared_ptr（活得比栈帧长）。
    // ⚠ 它**不是**那条缺陷的守卫：悬空调用是 UB，把捕获改回 `[&emit]` 后本用例照样通过
    // （实测过）。真正的守卫是 tests/native-callback-capture.test.mjs 的源码判据；这条只负责
    // 证明"回调确实活了足够久、事件顺序对"。
    run("临时 emit 回调在 start_sync 返回之后仍然收得到输出与退出事件", [] {
        const auto root = temp_root("outlive");
        write_file(root / "build.gradle", "");
        taocode::gradle::SyncSession session;

        struct Sink {
            std::mutex mutex;
            std::condition_variable ready;
            std::vector<std::string> events;
            std::string data;
            bool exited = false;
        };
        auto sink = std::make_shared<Sink>();

        // 形态与 main.cpp 的 `[this](Json payload) { queue_gradle(...); }` 一致：实参是临时的。
        taocode::gradle::start_sync(
            session, root.string(), {{"root", root.string()}, {"command", "echo outlive-ok"}},
            [sink](taocode::Json event) {
                const auto name = event.value("event", std::string());
                std::lock_guard lock(sink->mutex);
                sink->events.push_back(name);
                if (name == "gradle.output") sink->data += event.value("dataB64", std::string());
                if (name == "gradle.exit") { sink->exited = true; sink->ready.notify_all(); }
            });

        // 到这里 start_sync 已经返回：若回调仍指向调用方的临时对象，下面等到的只会是崩溃。
        std::unique_lock lock(sink->mutex);
        sink->ready.wait_for(lock, std::chrono::seconds(30), [&] { return sink->exited; });
        check(sink->exited, "start_sync 返回后仍要收到 gradle.exit");
        check(!sink->events.empty() && sink->events.front() == "gradle.started", "第一条应是 gradle.started");
        check(!sink->data.empty(), "gradle.output 要真的带上输出（悬挂捕获时这里是空的或直接崩）");
    });

    std::cout << (failures == 0 ? "gradle: all checks passed\n" : "gradle: failures\n");
    return failures == 0 ? 0 : 1;
}
