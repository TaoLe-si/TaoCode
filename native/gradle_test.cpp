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
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>

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

    std::cout << (failures == 0 ? "gradle: all checks passed\n" : "gradle: failures\n");
    return failures == 0 ? 0 : 1;
}
