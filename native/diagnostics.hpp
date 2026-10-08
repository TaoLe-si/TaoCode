#pragma once

#include <cstddef>
#include <filesystem>
#include <functional>
#include <string>

#include "workspace.hpp"  // Json

// 诊断支持（日志文件 + 特殊目录 + 排障信息）—— IDEA `com.intellij.diagnostic` 那一套的对应物。
//
// 对照源码（D:\Backup\Downloads\intellij-community-master\intellij-community-master）：
//   · 日志位置 `LogDirectoryProvider` / `PathManager.getLogDir()`（`idea.log` 落在 log 目录）
//   · 「显示日志」`platform/platform-impl/src/com/intellij/ide/actions/ShowLogAction.java:33-40`
//       `showLog()`：能定位文件就 `RevealFileAction.openFile(LoggerFactory.getLogFilePath())`，
//       否则退回 `openDirectory(PathManager.getLogDir())`
//   · 「浏览特殊目录」`platform/platform-impl/src/com/intellij/diagnostic/specialPaths/BrowseSpecialPathsAction.kt`
//       + `ApplicationSpecialPathsProvider.kt`（应用级的系统/配置/日志/插件/桌面等目录清单）
namespace taocode {
namespace diagnostics {

/** 日志目录（`<profile>/log`，profile = `%LOCALAPPDATA%\TaoCode`）。 */
std::filesystem::path log_dir(const std::filesystem::path& profile);

/** 日志文件（`<profile>/log/taocode.log`）。 */
std::filesystem::path log_file(const std::filesystem::path& profile);

/** 默认轮转阈值：单文件超过它就改名成 `taocode.log.1`（只留一份历史）。 */
inline constexpr std::size_t kLogRotateBytes = 5u * 1024u * 1024u;

/**
 * 建目录并写一行启动记录（版本 + **实际加载的那份前端包**）。失败时静默返回 —— 日志本身不该把启动拖垮。
 * 幂等：每次调用都会追加一行 "start"。
 */
void init(const std::filesystem::path& profile, const std::string& version,
          const std::filesystem::path& ui_dir = {});

/**
 * 从 `<ui_dir>/index.html` 里取入口脚本文件名（Vite 的内容哈希，形如 `index-ChCw-SJa.js`）。
 * 存在的理由：exe 只在原生层改动时才重链，所以"它的时间戳"证明不了界面是哪一版；
 * 这一串是页面**真正引用**的文件名，能直接判定"看到的是旧包还是新包"。读不到返回空串。
 */
std::string ui_bundle(const std::filesystem::path& ui_dir);

/** 追加一行 `时间 级别 消息`（对应 idea.log 的行格式）。 */
void event(const std::filesystem::path& profile, const std::string& level, const std::string& message,
           std::size_t rotate_bytes = kLogRotateBytes);

/**
 * 跑一个收尾步骤并**先写"开始"再写"用时"**。
 *
 * 存在的理由（2026-09-29 实测）：点关闭后窗口"未响应"，日志里只有启动行、没有退出行 ——
 * 说明卡在收尾链里，但看不出是哪一步。上次排查这类问题时所有诊断都写在动作**之后**，
 * 于是"永远不返回的那一步"恰好什么都不留。这条把顺序反过来：卡住的步骤在日志里
 * 就是一条没有配对的「关闭 · X」。超过 500ms 的按 WARN 记。
 */
void run_step(const std::filesystem::path& profile, const char* name, const std::function<void()>& body);

/** 供 `app.logPaths`：`{ dir, file, exists, size }`。 */
Json paths(const std::filesystem::path& profile);

/**
 * 本 session 的**内部错误账**（IDEA `FatalErrorWidgetFactory` → `IdeMessagePanel` 那个计数）：
 * 每次 `event(..., "ERROR", ...)` 记一条，保留最近 N 条。
 *
 * 为什么不直接读日志文件：日志是跨 session 追加的，读它会把上次启动的错误也算进"本次"。
 * 进程内计数才是"这一轮 IDE 出过几次内部错误"的准确答案（上游 `MessagePool` 也是进程内的）。
 */
Json internal_errors();

/** `event()` 内部调用：把 ERROR 级的消息记进账本（等级不是 ERROR 时是空操作）。 */
void record_internal_error(const std::string& level, const std::string& message);


/**
 * 供 `BrowseSpecialPaths`：`[{ id, label, path }]`。
 * `exe_dir` 是程序所在目录（TaoCode 的安装目录）；`ui_dir` 是前端资源目录，缺省时用 `<exe_dir>/ui`。
 */
Json special_paths(const std::filesystem::path& profile, const std::filesystem::path& exe_dir);

/**
 * 供 `CollectZippedLogs`：把日志目录下的文件打包成 `<log>/taocode-logs-<时间戳>.zip`
 * （IDEA `LogPacker.packLogs` 的对应物），返回 `{ path, files }`。
 */
Json collect_logs(const std::filesystem::path& profile);

/**
 * 供 `CollectTroubleshootingInformation`：一段可直接粘贴的排障文本
 * （版本 / 时间 / 平台 / 进程内存 / 日志位置 / 特殊目录 / 机器上的 JDK）。
 */
Json troubleshooting(const std::filesystem::path& profile, const std::filesystem::path& exe_dir,
                     const std::string& version);

/**
 * 供「帮助 › 关于」（`AboutAction`）：版本 / 平台 / WebView2 / 配置目录，外加机器上探测到的 JDK。
 *
 * JDK 这一项不是装饰：IDEA 的 About 与排障信息里都有 JVM 一节（`CollectTroubleshootingInformationAction`），
 * 而本仓前端要拿它当 **Java 项目的默认 SDK**（「IDEA 打开默认就有」的落点）——
 * 先把 About 的那一行补上，见 `native/jdk.hpp` 的 `find_all()`。
 */
Json app_info(const std::filesystem::path& profile, const std::string& browser_version, const std::string& version);

/**
 * **低内存检查**（IDEA `LowMemoryNotifier` / `EditMemorySettingsDialog` 的宿主侧对应物）。
 *
 * 上游那个是 JVM 堆的：`LowMemoryNotifier` 在 `MemoryUsage` 超过 `-Xmx` 的某个比例时弹通知，
 * 用户可以调大堆上限。本仓没有可调的 JVM 堆（宿主是 C++ + WebView2），等价物是
 * **进程工作集 + 系统可用物理内存**：两者都偏低时提示用户（内存芯片的 `app.memory` 只报数字，
 * 这条报"要不要当回事"）。
 *
 * 判据（阈值都是常量，可被 `app.lowMemory` 的参数覆盖）：
 *   · `low` = 系统可用物理内存 < `kLowMemoryAvailableMb`（默认 512 MiB）
 *             或 进程工作集 > `kLowMemoryWorkingSetMb`（默认 2048 MiB）；
 *   · 返回 `{low, availableMb, totalMb, workingSetMb, loadPercent, thresholdMb}`，
 *     `loadPercent` 是系统物理内存占用百分比（上游 `MemoryUsage` 的等价面）。
 */
Json low_memory(std::uint64_t available_threshold_mb = 512, std::uint64_t working_set_threshold_mb = 2048);

/** 低内存阈值常量（`low_memory()` 的默认值，供 UI/判据引用同一份数字）。 */
inline constexpr std::uint64_t kLowMemoryAvailableMb = 512;
inline constexpr std::uint64_t kLowMemoryWorkingSetMb = 2048;

/**
 * **日志级别配置**（IDEA `LogLevelConfigurationManager` / `LogCategory` 的对应物）。
 *
 * 上游可以给每个 category 单独设级别（DEBUG/INFO/WARN/ERROR），并写进
 * `<config>/options/idea.log.level`。本仓的 `event()` 收一个级别字符串，但**没有过滤**：
 * 这次补上"读/写一个全局最低级别 + `event()` 按它过滤"这一层（category 级留作后续）。
 *
 * 级别表就是四个名字（大小写不敏感）：`DEBUG` < `INFO` < `WARN` < `ERROR`；
 * 比最低级别更低的那些 `event()` 不落盘（`DEBUG` 用于打开诊断开关后的细节日志）。
 * 设置持久化在 `<profile>/log-level.txt`（一行级别名），读不到就用默认 `INFO`。
 */
std::string log_level(const std::filesystem::path& profile);
/** 写最低日志级别；非法级别名返回 false 且不落盘（不把设置写成一个认不出的值）。 */
bool set_log_level(const std::filesystem::path& profile, const std::string& level);

}  // namespace diagnostics
}  // namespace taocode
