#pragma once

#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <functional>
#include <vector>

#include "workspace.hpp"  // Json

// Gradle 支持（宿主侧）—— IDEA Gradle 插件里"跑一条命令并把结果推回去"那一段的对应物。
//
// 对照源码（D:\Backup\Downloads\intellij-community-master\intellij-community-master）：
//   · 识别口径 `plugins/gradle/settings/src/util/GradleConstants.java:15-38`
//     （`build.gradle` / `build.gradle.kts` / `settings.gradle(.kts)` / `*.gradle.dcl` / `*.gradle.xdcl`）
//   · 项目定位 `.../service/settings/GradleConfigLocator.java:26-50`：**项目 = 目录**
//     （类注释引用 Gradle 的 `GradleConnector.forProjectDirectory`）
//   · 自动重载 `.../externalSystem/service/settings/ExternalSystemGroupConfigurable.kt:22-58`
//     （per-project，id=`build.tools`，ALL/SELECTIVE/NONE）
//
// **为什么宿主里没有"识别"那一半**：GradleConstants 的两张表（八个精确名字 + 四个后缀）
// 只需要一份实现。前端 `src/gradle.ts` 是纯函数、有单测，识别就放在那里；
// 宿主只提供它拿不到的能力 —— **在项目目录里起一个子进程跑命令并把输出/退出码推回**。
// （曾经两边各写一份，`settings.gradle.dcl` 被同时算进 buildFiles 的重复就是这样漂出来的。）
//
// 为什么走 CLI 而不是 Tooling API：IDEA 用 Tooling API 拿工程模型；TaoCode 的等价通道是
// `gradle --console=plain projects tasks --all`，解析放在前端（可单测）—— 这样"同步"这件事
// 有真实落点，而不是造一个假模型。
namespace taocode {
namespace gradle {

/**
 * 一次同步会话：后台线程跑一条命令，输出块与退出码通过回调送回宿主（宿主再转成 `gradle.*` 事件）。
 * 与"运行控制台"（`taocode::Runner` 的单例通道）分开，所以同步不会占住用户的运行按钮。
 */
class SyncSession {
public:
    using Emit = std::function<void(std::string_view text)>;
    using Done = std::function<void(int exit_code, bool cancelled)>;

    SyncSession();
    ~SyncSession();
    SyncSession(const SyncSession&) = delete;
    SyncSession& operator=(const SyncSession&) = delete;

    /**
     * 起一次同步。重复调用会抛 `WorkspaceError("BUSY")`（对应 IDEA 的"同步进行中"）。
     *
     * `environment` 是 `KEY=VALUE` 形式的额外环境变量 —— 「Gradle JVM」就靠它落地：
     * IDEA 把 `GradleProjectSettings.getGradleJvm()`（默认 `ExternalSystemJdkUtil.USE_PROJECT_JDK`，
     * `GradleProjectSettings.java:60` / `ExternalSystemJdkUtil.java:52`）折成启动 Gradle 时的
     * `JAVA_HOME`，本仓走同一条路（`Runner::Spec.environment`）。
     */
    void start(const std::filesystem::path& root, const std::string& command,
               const std::vector<std::string>& environment, Emit emit, Done done);

    bool running() const;

    /** 请求取消（杀掉 shell 与它启动的子进程树）。 */
    void cancel();

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

/**
 * `gradle.sync` 这一条请求的完整形状：校验参数 → 发 `gradle.started` → 起会话 →
 * 把输出与退出码整成 `gradle.output` / `gradle.exit`。`emit` 是"交给界面一条事件"
 * （宿主那边就是 `queue_gradle`）。
 *
 * 为什么搬进 gradle.cpp：`main.cpp` 的上限被定死在 2000 行（桃 2026-09-28），
 * 新能力一律抽模块 —— 这里连分派体一起抽，`main.cpp` 那一支只剩三行。
 */
Json start_sync(SyncSession& session, const std::string& fallback_root, const Json& params,
                const std::function<void(Json)>& emit);

}  // namespace gradle
}  // namespace taocode
