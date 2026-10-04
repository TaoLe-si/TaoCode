// 诊断支持实现（见 diagnostics.hpp 的源码对照）。
#include "diagnostics.hpp"

#include <utility>
#include <vector>
#include "jdk.hpp"
#include "time_format.hpp"
#include "zipstore.hpp"

#include <windows.h>
#include <psapi.h>  // PROCESS_MEMORY_COUNTERS / K32GetProcessMemoryInfo（排障信息要报内存）
#include <shlobj.h>

#include <chrono>
#include <ctime>
#include <fstream>
#include <mutex>
#include <sstream>
#include <system_error>
#include <vector>

namespace taocode {
namespace diagnostics {
namespace {

std::mutex& log_mutex() {
    static std::mutex mutex;
    return mutex;
}

// `idea.log` 的行格式是「时间 级别 - 消息」；这里保持同样的顺序，便于肉眼比对。
std::string timestamp() {
    return format_local_now("%Y-%m-%d %H:%M:%S", 32);
}

void append_line(const std::filesystem::path& file, const std::string& line) {
    std::ofstream out(file, std::ios::app | std::ios::binary);
    if (!out) return;
    out << line << '\n';
    out.flush();  // 崩溃后也要留下痕迹
}

/** 单文件超阈值就轮转成 `.1`（只留一份历史，够定位"上一次启动发生了什么"）。 */
void rotate_if_needed(const std::filesystem::path& file, std::size_t rotate_bytes) {
    std::error_code error;
    const auto size = std::filesystem::file_size(file, error);
    if (error || size < rotate_bytes) return;
    auto previous = file;
    previous += L".1";
    std::filesystem::remove(previous, error);
    std::filesystem::rename(file, previous, error);
}

}  // namespace

std::filesystem::path log_dir(const std::filesystem::path& profile) {
    return profile / L"log";
}

std::filesystem::path log_file(const std::filesystem::path& profile) {
    return log_dir(profile) / L"taocode.log";
}

std::string ui_bundle(const std::filesystem::path& ui_dir) {
    if (ui_dir.empty()) return {};
    std::ifstream in(ui_dir / L"index.html", std::ios::binary);
    if (!in) return {};
    std::stringstream buffer;
    buffer << in.rdbuf();
    const std::string html = buffer.str();
    // 只认**入口**那一个脚本：`<script type="module" …src="…/assets/index-<hash>.js">`。
    // 其它 assets 的引用要晚得多，取到它们会把"哪一版界面"读成一个不相干的文件名。
    const auto entry = html.find("assets/index-");
    if (entry == std::string::npos) return {};
    const auto end = html.find(".js", entry);
    if (end == std::string::npos || end - entry > 64) return {};  // 64 = "assets/index-" + 哈希 + 余量
    return html.substr(entry + 7, end + 3 - entry - 7);           // 去掉前缀 "assets/"
}

void init(const std::filesystem::path& profile, const std::string& version, const std::filesystem::path& ui_dir) {
    if (profile.empty()) return;
    std::lock_guard guard(log_mutex());
    std::error_code error;
    std::filesystem::create_directories(log_dir(profile), error);
    const auto file = log_file(profile);
    rotate_if_needed(file, kLogRotateBytes);
    const auto bundle = ui_bundle(ui_dir);
    append_line(file, timestamp() + " INFO - TaoCode " + version + " 启动" +
                          (bundle.empty() ? "" : "，界面 " + bundle));
}

void event(const std::filesystem::path& profile, const std::string& level, const std::string& message,
           std::size_t rotate_bytes) {
    if (profile.empty() || message.empty()) return;
    std::lock_guard guard(log_mutex());
    std::error_code error;
    std::filesystem::create_directories(log_dir(profile), error);
    const auto file = log_file(profile);
    rotate_if_needed(file, rotate_bytes);
    append_line(file, timestamp() + " " + level + " - " + message);
    // 内部错误账（等级为 ERROR 的那些）—— 状态栏那个「内部错误」组件读它。
    record_internal_error(level, message);
}

namespace {
// 本 session 的内部错误账（理由见头文件）。上限 50 条：状态栏那个计数只需要"有多少"，
// 弹层里的"最近几条"再多也没人看。
constexpr std::size_t kMaxInternalErrors = 50;
std::vector<std::pair<std::string, std::string>>& internal_error_log() {
    static std::vector<std::pair<std::string, std::string>> entries;
    return entries;
}
}  // namespace

void record_internal_error(const std::string& level, const std::string& message) {
    if (level != "ERROR" || message.empty()) return;
    auto& entries = internal_error_log();
    entries.emplace_back(timestamp(), message);
    if (entries.size() > kMaxInternalErrors)
        entries.erase(entries.begin(), entries.begin() + static_cast<std::ptrdiff_t>(entries.size() - kMaxInternalErrors));
}

Json internal_errors() {
    Json latest = Json::array();
    for (const auto& entry : internal_error_log()) latest.push_back({{"time", entry.first}, {"message", entry.second}});
    return {{"count", internal_error_log().size()}, {"latest", std::move(latest)}};
}

void run_step(const std::filesystem::path& profile, const char* name, const std::function<void()>& body) {
    // 先写"开始"：卡住的那一步在日志里就是一条没有配对的行（写在之后的诊断永远抓不到它）。
    event(profile, "INFO", std::string("关闭 · ") + name);
    const auto started = std::chrono::steady_clock::now();
    body();
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
    event(profile, ms >= 500 ? "WARN" : "INFO",
          std::string("关闭 · ") + name + " 用时 " + std::to_string(ms) + "ms");
}

Json paths(const std::filesystem::path& profile) {    const auto file = log_file(profile);
    std::error_code error;
    const bool exists = std::filesystem::exists(file, error);
    const auto size = exists ? static_cast<long long>(std::filesystem::file_size(file, error)) : 0;
    return {{"dir", log_dir(profile).string()},
            {"file", file.string()},
            {"exists", exists},
            {"size", size}};
}

Json special_paths(const std::filesystem::path& profile, const std::filesystem::path& exe_dir) {
    Json list = Json::array();
    const auto add = [&list](const char* id, const char* label, const std::filesystem::path& path) {
        if (path.empty()) return;
        std::error_code error;
        list.push_back({{"id", id}, {"label", label}, {"path", path.string()},
                        {"exists", std::filesystem::exists(path, error)}});
    };

    // IDEA 的 ApplicationSpecialPathsProvider 列的是"用户要找得到的东西"：日志、配置、插件、
    // 程序本体、桌面、临时目录。TaoCode 的插件/配置都在 profile 下（projects.json / sessions/）。
    add("log", "日志", log_dir(profile));
    add("config", "配置与项目", profile);
    add("plugins", "插件", profile / L"plugins");
    add("history", "本地历史", profile / L"history");
    add("bin", "程序目录", exe_dir);
    add("ui", "前端资源", exe_dir.empty() ? std::filesystem::path() : exe_dir / L"ui");

    PWSTR desktop = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Desktop, 0, nullptr, &desktop)) && desktop) {
        add("desktop", "桌面", std::filesystem::path(desktop));
        CoTaskMemFree(desktop);
    }
    PWSTR temp = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &temp)) && temp) {
        add("localAppData", "本地应用数据", std::filesystem::path(temp));
        CoTaskMemFree(temp);
    }
    return list;
}

Json collect_logs(const std::filesystem::path& profile) {
    const auto directory = log_dir(profile);
    std::error_code error;
    std::vector<zip::Entry> entries;
    if (std::filesystem::is_directory(directory, error)) {
        for (const auto& item : std::filesystem::directory_iterator(directory, error)) {
            if (!item.is_regular_file(error)) continue;
            const auto name = item.path().filename().string();
            if (name.rfind("taocode-logs-", 0) == 0) continue;  // 不要把以前打的包再打进去
            entries.push_back({name, item.path()});
        }
    }
    const std::string stamp = format_local_now("%Y%m%d-%H%M%S", 32);
    const auto target = directory / ("taocode-logs-" + stamp + ".zip");
    const auto written = zip::write_archive(target, entries);
    event(profile, "INFO", "打包日志 " + std::to_string(written) + " 个文件到 " + target.string());
    return {{"path", target.string()}, {"files", static_cast<long long>(written)}};
}

Json troubleshooting(const std::filesystem::path& profile, const std::filesystem::path& exe_dir,
                     const std::string& version) {
    const auto file = log_file(profile);
    std::error_code error;
    const auto size = std::filesystem::exists(file, error) ? std::filesystem::file_size(file, error) : 0;
    PROCESS_MEMORY_COUNTERS counters{};
    std::uint64_t working = 0, peak = 0, private_bytes = 0;
    if (K32GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters))) {
        working = counters.WorkingSetSize;
        peak = counters.PeakWorkingSetSize;
        private_bytes = counters.PagefileUsage;
    }
    std::ostringstream text;
    text << "TaoCode 排障信息\n";
    text << "版本：" << version << "\n";
    text << "时间：" << timestamp() << "\n";
    text << "平台：Windows " << (sizeof(void*) == 8 ? "x64" : "x86") << "\n";
    text << "进程内存：工作集 " << working / (1024 * 1024) << " MB / 峰值 " << peak / (1024 * 1024)
         << " MB / 提交 " << private_bytes / (1024 * 1024) << " MB\n";
    text << "日志文件：" << file.string() << "（" << size << " 字节）\n";
    text << "配置目录：" << profile.string() << "\n";
    text << "程序目录：" << exe_dir.string() << "\n";
    // IDEA 的排障信息里有 JVM 一节；本仓报"机器上探测到的 JDK"（Java 项目默认 SDK 就是从这批里挑的）。
    const auto jdks = jdk::find_all();
    text << "JDK：" << (jdks.empty() ? "（没有探测到）" : "") << "\n";
    for (const auto& entry : jdks)
        text << "  - " << (entry.version.empty() ? "版本未知" : entry.version) << "：" << entry.home << "\n";
    text << "特殊目录：\n";
    for (const auto& item : special_paths(profile, exe_dir)) {
        text << "  - " << item.at("label").get<std::string>() << "：" << item.at("path").get<std::string>()
             << (item.at("exists").get<bool>() ? "" : "（不存在）") << "\n";
    }
    return {{"text", text.str()}};
}

Json app_info(const std::filesystem::path& profile, const std::string& browser_version, const std::string& version) {
    // 取第一个 JDK 当"当前 JDK"（`find_all()` 已按路径排序，与 IDEA 的 TreeSet 一样稳定）。
    const auto jdks = jdk::find_all();
    Json jdk_value = {{"home", ""}, {"version", ""}};
    if (!jdks.empty()) jdk_value = {{"home", jdks.front().home}, {"version", jdks.front().version}};
    Json counts = Json::array();
    for (const auto& entry : jdks) counts.push_back({{"home", entry.home}, {"version", entry.version}, {"name", entry.name}});
    return {{"version", version},
            {"platform", "Windows"},
            {"arch", sizeof(void*) == 8 ? "x64" : "x86"},
            {"webview2", browser_version},
            {"profile", profile.string()},
            {"jdk", std::move(jdk_value)},
            {"jdks", std::move(counts)}};
}

}  // namespace diagnostics
}  // namespace taocode
