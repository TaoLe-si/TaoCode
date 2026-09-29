// Offline self-test for the multi-instance run host (IDEA 的 `isAllowRunningInParallel` 语义):
// 实例 id 与事件、同名实例的停止规则、Before launch 链、按实例停止。
#include "run_host.hpp"

#include "base64.hpp"

#include "text.hpp"

#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <functional>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

namespace fs = std::filesystem;
using taocode::Json;
using taocode::WorkspaceError;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

fs::path temp_root() {
    const auto base = fs::temp_directory_path() / L"taocode-run-host-test";
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

void expect_code(const char* code, const std::function<void()>& body) {
    try {
        body();
    } catch (const WorkspaceError& error) {
        check(error.code == code, std::string("期望 ") + code + "，实际 " + error.code);
        return;
    }
    throw std::runtime_error(std::string("没有抛 ") + code);
}

/** 事件收集器：`Manager` 的出口回调可能来自 reader 线程，所以要加锁。 */
struct Collector {
    std::mutex mutex;
    std::condition_variable ready;
    std::vector<Json> events;

    taocode::run_host::Manager::Emit emit() {
        return [this](Json event) {
            {
                std::lock_guard lock(mutex);
                events.push_back(std::move(event));
            }
            ready.notify_all();
        };
    }

    std::vector<Json> of(const std::string& name, int instance = 0) {
        std::lock_guard lock(mutex);
        std::vector<Json> out;
        for (const auto& event : events) {
            if (event.value("event", std::string()) != name) continue;
            if (instance > 0 && event.value("instance", 0) != instance) continue;
            out.push_back(event);
        }
        return out;
    }

    /** 等某个事件出现（最多 20 秒）；返回是否等到。 */
    bool wait_for(const std::string& name, std::size_t count = 1) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(20);
        std::unique_lock lock(mutex);
        while (of_locked(name).size() < count) {
            if (ready.wait_until(lock, deadline) == std::cv_status::timeout) return false;
        }
        return true;
    }

    std::vector<Json> of_locked(const std::string& name) {
        std::vector<Json> out;
        for (const auto& event : events)
            if (event.value("event", std::string()) == name) out.push_back(event);
        return out;
    }
};

/** 把消息循环该做的事做掉：取待推进的实例并推进（测试里没有 UI 线程）。 */
void pump(taocode::run_host::Manager& manager, const fs::path& root) {
    for (const auto& [instance, code] : manager.take_pending()) manager.advance(instance, code, root);
}

Json start_params(const std::string& label, const std::string& command, bool parallel = false) {
    return {{"command", command}, {"label", label}, {"shell", true}, {"allowParallel", parallel}};
}

/**
 * 一个**路径里带空格**的真实可执行文件。
 *
 * 这不是造出来的边角：JDK 装在 `C:\Program Files\Eclipse Adoptium\jdk-…` 时，
 * `javaRunCommand` / `buildPlan` 产出的命令第一个 token 就是带引号的这条路径。
 * 宿主把它交给 `cmd.exe /d /s /c "…"` 时，`/s` 会把**最外层**那对引号剥掉 ——
 * 于是命令变成 `"C:\Program Files\…\java.exe" -version`，开引号没了、闭引号还在，
 * cmd 报 `'""C:\Program' 不是内部或外部命令`，运行直接失败。
 */
fs::path executable_under_path_with_space(const fs::path& root) {
    auto directory = root / L"Program Files" / L"taocode probe";
    std::error_code error;
    fs::create_directories(directory, error);
    const fs::path target = directory / L"probe.exe";
    fs::copy_file(fs::path(std::getenv("SystemRoot")) / L"System32" / L"where.exe", target,
                  fs::copy_options::overwrite_existing, error);
    check(!error, "无法准备带空格路径下的可执行文件：" + error.message());
    return target;
}

std::string output_of(Collector& collector, int instance) {
    std::string output;
    for (const auto& event : collector.of("run.output", instance))
        output += taocode::base64_decode(event.value("dataB64", std::string()));
    return output;
}

}  // namespace

int main() {
    // 无缓冲：测试若卡住，要能立刻看出卡在哪一条（有缓冲时被 kill 就什么都看不到）。
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    run("起一个实例：事件都带 instance id", [] {
        const auto root = temp_root();
        Collector collector;
        taocode::run_host::Manager manager(collector.emit());
        const auto started = manager.start(start_params("演示", "echo taocode-run-probe"), root);
        const int instance = started.at("instance").get<int>();
        check(instance > 0, "要分配一个正整数实例 id");
        check(started.at("label").get<std::string>() == "演示", "回传标签");
        check(started.at("parallel") == false, "默认不允许并行");
        check(manager.any_running(), "刚起就应该在跑");
        check(collector.wait_for("run.exit"), "要收到 run.exit");
        check(collector.of("run.started").size() == 1, "要有一条 run.started");
        for (const auto& event : collector.of("run.output"))
            check(event.at("instance").get<int>() == instance, "输出事件必须带 instance");
        const auto exits = collector.of("run.exit");
        check(exits.size() == 1 && exits[0].at("instance").get<int>() == instance, "exit 带 instance");
        check(exits[0].at("code") == 0, "echo 退出码 0");
        // 结束之后 instances() 里还留着它（IDEA 的 Run 工具窗口也保留已结束的标签）
        check(manager.instances().size() == 1, "实例清单里有一条");
        check(manager.instances()[0].at("running") == false, "它已经不在跑了");
    });

    run("同名 + 不允许并行：先停掉前一个（ExecutionManagerImpl.kt:613-619）", [] {
        const auto root = temp_root();
        Collector collector;
        taocode::run_host::Manager manager(collector.emit());
        const int first = manager.start(start_params("同一个配置", "ping -n 6 127.0.0.1 > nul"), root).at("instance").get<int>();
        for (int attempt = 0; attempt < 200 && !manager.any_running(); ++attempt)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        check(manager.any_running(), "第一个实例应该在跑");
        const int second = manager.start(start_params("同一个配置", "echo 第二个"), root).at("instance").get<int>();
        check(second != first, "要有两个不同的实例 id");
        // 第一个被停掉：它的 exit 带 aborted
        bool aborted = false;
        for (const auto& event : collector.of("run.exit", first)) if (event.value("aborted", false)) aborted = true;
        check(aborted, "前一个实例应当被中止（aborted=true）");
        check(collector.wait_for("run.exit"), "第二个实例也要收尾");
    });

    run("同名 + 允许并行：两个都在（每实例独立）", [] {
        const auto root = temp_root();
        Collector collector;
        taocode::run_host::Manager manager(collector.emit());
        const int first = manager.start(start_params("并行", "ping -n 4 127.0.0.1 > nul", true), root).at("instance").get<int>();
        for (int attempt = 0; attempt < 200 && !manager.any_running(); ++attempt)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        const int second = manager.start(start_params("并行", "ping -n 6 127.0.0.1 > nul", true), root).at("instance").get<int>();
        check(first != second, "两个不同实例");
        check(manager.instances().size() == 2, "两个实例都在清单里");
        check(manager.any_running(), "仍然在跑");
        manager.stop(0);
        check(!manager.any_running(), "stop(0) 之后都不在跑");
    });

    run("Before launch 链：先跑前置步骤，退出码非 0 时中止并跳过后续", [] {
        const auto root = temp_root();
        Collector collector;
        taocode::run_host::Manager manager(collector.emit());
        auto params = start_params("带前置", "echo 主步骤");
        params["beforeLaunch"] = Json::array({Json{{"name", "构建"}, {"command", "echo 构建中"}},
                                             Json{{"name", "失败的一步"}, {"command", "exit /b 7"}},
                                             Json{{"name", "不该跑到"}, {"command", "echo 到不了"}}});
        const int instance = manager.start(params, root).at("instance").get<int>();
        // 没有 UI 线程，所以自己把链往前推
        for (int attempt = 0; attempt < 400; ++attempt) {
            pump(manager, root);
            if (!manager.any_running() && !collector.of("run.exit", instance).empty()) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        pump(manager, root);
        // 输出是 base64 的原始字节（子进程用自己的代码页），要解码之后再看。
        std::string output;
        for (const auto& event : collector.of("run.output", instance))
            output += taocode::base64_decode(event.value("dataB64", std::string()));
        const auto exits = collector.of("run.exit", instance);
        check(!exits.empty(), "链跑完了要有 exit");
        bool aborted = false;
        for (const auto& event : exits) if (event.value("aborted", false)) aborted = true;
        check(aborted, "失败的一步要中止整条链");
        check(output.find("==> 构建 <==") != std::string::npos, "前置步骤的名字要回显到控制台");
        check(output.find("构建中") != std::string::npos, "第一步真的跑了");
        check(output.find("链已中止") != std::string::npos, "中止要说明原因与跳过的步数");
        check(output.find("到不了") == std::string::npos, "第三步不该被执行（链已中止）");
    });

    run("按实例停止：stop(id) 只停那一个", [] {
        const auto root = temp_root();
        Collector collector;
        taocode::run_host::Manager manager(collector.emit());
        const int first = manager.start(start_params("A", "ping -n 8 127.0.0.1 > nul", true), root).at("instance").get<int>();
        const int second = manager.start(start_params("B", "ping -n 8 127.0.0.1 > nul", true), root).at("instance").get<int>();
        for (int attempt = 0; attempt < 200 && manager.instances().size() < 2; ++attempt)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        const auto stopped = manager.stop(first);
        check(stopped.at("stopped") == 1, "只停了一个");
        check(manager.instances().size() == 1, "另一个还在清单里");
        check(manager.instances()[0].at("id").get<int>() == second, "留在清单里的是第二个");
        manager.stop(0);
    });

    run("write_line 给不存在的实例返回 false（不抛）", [] {
        const auto root = temp_root();
        Collector collector;
        taocode::run_host::Manager manager(collector.emit());
        check(!manager.write_line(4242, "x"), "未知实例应返回 false");
    });

    run("非法的运行参数被拒（命令为空 / 环境变量格式）", [] {
        const auto root = temp_root();
        Collector collector;
        taocode::run_host::Manager manager(collector.emit());
        expect_code("INVALID_REQUEST", [&] { manager.start({{"label", "空"}}, root); });
        expect_code("INVALID_REQUEST", [&] { manager.start({{"command", "echo x"}, {"env", Json::array({"NO_EQUALS"})}}, root); });
        check(manager.instances().empty(), "非法请求不该留下实例");
    });

    run("可执行文件路径带空格时也要能跑起来（JDK 装在 C:\\Program Files 的情形）", [] {
        const auto root = temp_root();
        const auto probe = executable_under_path_with_space(root);
        Collector collector;
        taocode::run_host::Manager manager(collector.emit());
        // 与 javaRunCommand 产出的一模一样：可执行文件带引号 + 普通参数（以非引号结尾，
        // 就像 `java -cp "…" Main` 以主类名结尾）。where.exe 只可能来自这个副本 ——
        // 它在 PATH 上没有同名文件，输出里出现 cmd.exe 就说明这个副本真的跑起来了。
        const auto quoted = "\"" + probe.string() + "\"";
        const int instance = manager.start(start_params("带空格", quoted + " cmd.exe"), root)
                                .at("instance").get<int>();
        for (int attempt = 0; attempt < 600; ++attempt) {
            pump(manager, root);
            if (!collector.of("run.exit", instance).empty()) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        // 输出与 exit 是两条独立的事件流：exit 先到时子进程可能还在冲管道，排空再断言。
        for (int attempt = 0; attempt < 50; ++attempt) {
            pump(manager, root);
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        const auto exits = collector.of("run.exit", instance);
        check(!exits.empty(), "命令要跑完并回报退出码");
        const auto code = exits[0].at("code").get<int>();
        check(code == 0, "退出码 " + std::to_string(code) + "，输出：\n" + output_of(collector, instance));
        check(output_of(collector, instance).find("cmd.exe") != std::string::npos,
              "这个副本应当跑起来并找到 cmd.exe，实际输出：\n" + output_of(collector, instance));
    });

    std::cout << (failures == 0 ? "run_host: all checks passed\n" : "run_host: failures\n");
    return failures == 0 ? 0 : 1;
}
