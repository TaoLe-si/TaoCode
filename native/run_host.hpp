#pragma once

#include <deque>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "workspace.hpp"  // Json

// 运行/构建的**多实例**宿主（从 main.cpp 搬出的一域）。
//
// 对照源码（`platform/execution/` 与 `platform/execution-impl/`）：
//   · `RunConfigurationOptions.kt:54-56` `isAllowRunningInParallel`（默认 **false**），
//     UI 文案 `ExecutionBundle.properties:566`「Allow running multiple instances of the application
//     simultaneously」，复选框在 `ConfigurationSettingsEditorPanel.kt:34`（「操作系统」组），
//     **只在模板上可见**（`ConfigurationSettingsEditorWrapper.java:73-74`
//     `setVisible(settings.isTemplate() && factory.getSingletonPolicy().isPolicyConfigurable())`）。
//   · `ExecutionManagerImpl.kt:613-619`：`isAllowRunningInParallel == false` 时，启动前把
//     **同一配置**的已运行实例收出来一起停掉；为 true 则保留（新开一个实例）。
//   · `RunManagerImpl.kt:425`：模板的值会成为该配置的初值（`RunConfigurationBase.java:158` 复制模板）。
//   · 每个实例的 "Before launch" 链是**独立**的（`ExecutionManagerImpl` 按 `ExecutionEnvironment`
//     逐个跑 before-run 步骤），所以链状态必须挂在实例上，而不是进程外的全局变量。
//
// 为什么搬出 main.cpp：① 之前只有一个 `runner`，多实例要改的地方散在 start/stop/drain 三处；
// ② 收敛后"实例 → 事件"的契约（每条 `run.output`/`run.exit` 都带 `instance`）只在一个文件里定义。
namespace taocode {
namespace run_host {

/** 一个 "Before launch" 步骤（IDEA `BeforeRunTask` 的可执行版本）。 */
struct Step {
    std::string label;
    std::string command;
    std::string program;
    std::string cwd;
    std::vector<std::string> args;
    std::vector<std::string> environment;
    bool shell = true;
};

/** 从 `run.start` 的参数里解析一份步骤（`beforeLaunch` 的每一项 + 顶层那一份）。 */
Step step_from(const Json& value);
/** 解析一个 `beforeLaunch` 数组（顺序即执行顺序）。 */
std::deque<Step> chain_from(const Json& params);

class Manager {
public:
    /** 事件出口：拿到一条已经带 `instance` 的 `run.output` / `run.exit` JSON。 */
    using Emit = std::function<void(Json)>;

    explicit Manager(Emit emit);
    ~Manager();
    Manager(const Manager&) = delete;
    Manager& operator=(const Manager&) = delete;

    /**
     * 起一次运行。`params` 就是桥上的 `run.start` 参数。返回 `{instance, label, parallel}`。
     *
     * `allowParallel`（来自配置的 `allowRunningInParallel`）为 false 时，**同名实例先被停掉**
     * （IDEA `ExecutionManagerImpl.kt:613-619`）。
     */
    Json start(const Json& params, const std::filesystem::path& root);

    /** 停掉一个实例；`instance <= 0` 表示全部（IDEA 的 Stop 按钮在单选时停当前、All 时停全部）。 */
    Json stop(int instance);

    /** 给某个实例的 stdin 写一行；实例不存在/已结束返回 false。 */
    bool write_line(int instance, const std::string& line);

    /** 正在运行/刚结束的实例清单（IDEA 的 Run 工具窗口按它开标签）。 */
    Json instances() const;

    /** 还有实例在跑（进度面板与状态栏用它）。 */
    bool any_running() const;

    // —— UI 线程用 ——
    /** 把"上一段结束、该跑下一段"的实例取出来（顺序即入队顺序）。 */
    std::vector<std::pair<int, int>> take_pending();
    /**
     * 推进某个实例的链（在没有后续步骤时只是收尾）。**只在 UI 线程调用** ——
     * 这样下一个子进程永远由消息循环创建，而不是由 reader 线程创建。
     */
    void advance(int instance, int code, const std::filesystem::path& root);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace run_host
}  // namespace taocode
