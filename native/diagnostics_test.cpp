// Offline self-test for the diagnostics support: log file location, append format,
// rotation, paths() shape and the special-path list (IDEA ShowLogAction /
// BrowseSpecialPathsAction 的对应物).
#include "diagnostics.hpp"
#include "thread_dump.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

std::string read_all(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream out;
    out << in.rdbuf();
    return out.str();
}

std::vector<std::string> read_lines(const fs::path& file) {
    std::vector<std::string> lines;
    std::istringstream in(read_all(file));
    std::string line;
    while (std::getline(in, line)) if (!line.empty()) lines.push_back(line);
    return lines;
}

fs::path temp_root() {
    const auto base = fs::temp_directory_path() / L"taocode-diagnostics-test";
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
    const auto root = temp_root();
    const auto profile = root / L"profile";

    run("日志目录与文件都在 profile/log 下（IDEA 的 PathManager.getLogDir）", [&] {
        check(taocode::diagnostics::log_dir(profile) == profile / L"log", "日志目录不对");
        check(taocode::diagnostics::log_file(profile) == profile / L"log" / L"taocode.log", "日志文件名不对");
    });

    run("init 建目录并写下启动版本行；重复调用是追加", [&] {
        taocode::diagnostics::init(profile, "9.9.9");
        const auto file = taocode::diagnostics::log_file(profile);
        check(fs::exists(file), "init 之后日志文件不存在");
        const auto lines = read_lines(file);
        check(lines.size() == 1, "首次 init 应该只有一行");
        check(lines[0].find("TaoCode 9.9.9 启动") != std::string::npos, "启动行里没有版本号");
        check(lines[0].find("INFO") != std::string::npos, "启动行没有级别");
        taocode::diagnostics::init(profile, "9.9.9");
        check(read_lines(file).size() == 2, "再次 init 应该是追加一行");
    });

    run("ui_bundle 取的是 index.html **真正引用**的入口脚本名", [&] {
        const auto ui = root / L"ui";
        std::error_code ec;
        fs::create_directories(ui, ec);
        {
            std::ofstream out(ui / L"index.html", std::ios::binary);
            out << R"(<link rel="modulepreload" href="./assets/CodeEditor-CsxALhMv.js">
<script type="module" crossorigin src="./assets/index-ChCw-SJa.js"></script>)";
        }
        // 前面的 CodeEditor 那条必须被跳过 —— 读成它就把"哪一版界面"答错了。
        check(taocode::diagnostics::ui_bundle(ui) == "index-ChCw-SJa.js", "入口脚本名不对");
    });

    run("ui_bundle 读不到时返回空串，不编一个哈希出来", [&] {
        const auto empty_dir = root / L"no-ui";
        std::error_code ec;
        fs::create_directories(empty_dir, ec);
        {
            std::ofstream out(empty_dir / L"index.html", std::ios::binary);
            out << "<!doctype html><title>TaoCode</title>";  // 没有入口脚本
        }
        check(taocode::diagnostics::ui_bundle(empty_dir).empty(), "index.html 里没有入口脚本却返回了名字");
        check(taocode::diagnostics::ui_bundle(root / L"missing").empty(), "目录不存在时应为空");
        check(taocode::diagnostics::ui_bundle({}).empty(), "空目录参数应为空");
        {
            std::ofstream out(empty_dir / L"index.html", std::ios::binary);
            out << "src=\"assets/index-" + std::string(300, 'x');  // 没有 ".js" 收尾的畸形引用
        }
        check(taocode::diagnostics::ui_bundle(empty_dir).empty(), "畸形引用被当成了包名");
    });

    run("启动行带上界面包名（原生层没改时 exe 时间戳不动，只有这行能判定新旧）", [&] {
        const auto profile = root / L"profile-stamp";
        const auto ui = root / L"ui";  // 上一个用例里已经写好 index.html
        taocode::diagnostics::init(profile, "9.9.9", ui);
        const auto line = read_lines(taocode::diagnostics::log_file(profile)).at(0);
        check(line.find("界面 index-ChCw-SJa.js") != std::string::npos, "启动行没有包名：" + line);
        const auto bare = root / L"profile-bare";
        taocode::diagnostics::init(bare, "9.9.9");  // 不传 ui 目录：只有版本，不留空的"界面"字样
        check(read_lines(taocode::diagnostics::log_file(bare)).at(0).find("界面") == std::string::npos,
              "没有 ui 目录也写了包名");
    });

    run("event 的行格式是 `时间 级别 - 消息`（对齐 idea.log）", [&] {
        taocode::diagnostics::event(profile, "ERROR", "打开工作区失败");
        const auto lines = read_lines(taocode::diagnostics::log_file(profile));
        const auto& line = lines.back();
        check(line.find(" ERROR - 打开工作区失败") != std::string::npos, "行格式不对：" + line);
        // 时间戳形如 2026-09-27 16:40:30
        check(line.size() > 19 && line[4] == '-' && line[13] == ':', "行首不是时间戳：" + line);
    });

    run("空消息 / 空 profile 不写日志（不制造噪声行）", [&] {
        const auto before = read_lines(taocode::diagnostics::log_file(profile)).size();
        taocode::diagnostics::event(profile, "INFO", "");
        taocode::diagnostics::event(fs::path(), "INFO", "没有 profile");
        check(read_lines(taocode::diagnostics::log_file(profile)).size() == before, "空输入却写了日志");
    });

    run("超过阈值自动轮转成 .1，旧历史被覆盖", [&] {
        taocode::diagnostics::event(profile, "INFO", "第一次轮转前的最后一行", 64);
        const auto file = taocode::diagnostics::log_file(profile);
        check(fs::exists(file), "轮转后新文件不存在");
        auto previous = file;
        previous += L".1";
        check(fs::exists(previous), "轮转后没有 .1 历史文件");
        // `.1` 里是**轮转前**的旧内容（首次 init 写的启动行），新文件只剩这次写入的一行
        const auto history = read_all(previous);
        check(history.find("TaoCode 9.9.9 启动") != std::string::npos, ".1 里不是上一轮的内容");
        check(read_lines(file).size() == 1, "轮转后新文件应只有一行");
        check(read_all(file).find("第一次轮转前的最后一行") != std::string::npos, "新文件里没有刚写入的那一行");
        // 再轮转一次：`.1` 换成"上一轮"的内容，而**更早**的内容被丢掉（历史只留一份，不堆积）
        taocode::diagnostics::event(profile, "INFO", "第二次", 1);
        const auto second_history = read_all(previous);
        check(second_history.find("第一次轮转前的最后一行") != std::string::npos, ".1 没有换成上一轮的内容");
        check(second_history.find("TaoCode 9.9.9 启动") == std::string::npos, "更早的历史没有丢弃，.1 在堆积");
        check(read_all(file).find("第二次") != std::string::npos, "新文件里没有最后写入的那一行");
    });

    run("paths() 给出 dir/file/exists/size 四要素", [&] {
        const auto info = taocode::diagnostics::paths(profile);
        check(info.at("dir").get<std::string>() == (profile / L"log").string(), "dir 不对");
        check(info.at("file").get<std::string>() == taocode::diagnostics::log_file(profile).string(), "file 不对");
        check(info.at("exists").get<bool>(), "日志文件明明存在");
        check(info.at("size").get<long long>() > 0, "size 应该是正数");
    });

    run("special_paths() 列出日志/配置/插件/历史/程序目录，且都带 exists", [&] {
        const auto list = taocode::diagnostics::special_paths(profile, root / L"bin");
        check(list.is_array() && list.size() >= 5, "特殊目录太少");
        std::vector<std::string> ids;
        for (const auto& entry : list) {
            ids.push_back(entry.at("id").get<std::string>());
            check(entry.contains("label") && entry.contains("path") && entry.contains("exists"), "条目字段不全");
        }
        const auto has = [&ids](const char* id) {
            return std::find(ids.begin(), ids.end(), id) != ids.end();
        };
        check(has("log"), "缺少日志目录");
        check(has("config"), "缺少配置目录");
        check(has("plugins"), "缺少插件目录");
        check(has("bin"), "缺少程序目录");
        check(has("desktop"), "缺少桌面目录");
    });

    run("collect_logs 把日志打包成 zip，且不把以前的包再打进去", [&] {
        taocode::diagnostics::event(profile, "INFO", "打包前的一行");
        const auto first = taocode::diagnostics::collect_logs(profile);
        const auto archive = fs::path(first.at("path").get<std::string>());
        check(fs::exists(archive), "zip 没有生成");
        check(first.at("files").get<long long>() >= 1, "至少应打包日志文件本身");
        // 再打一次：上一次的 zip 必须被跳过，否则每打一次包大小就翻倍
        const auto second = taocode::diagnostics::collect_logs(profile);
        check(second.at("files").get<long long>() == first.at("files").get<long long>(),
              "旧 zip 被打进了新包");
    });

    run("日志级别：set_log_level 过滤更低级别；非法名被拒；持久化可读回", [&] {
        const auto level_profile = root / L"profile-level";
        taocode::diagnostics::init(level_profile, "9.9.9");
        // 默认级别是 INFO：DEBUG 不落盘。
        check(taocode::diagnostics::log_level(level_profile) == "INFO", "默认级别应当是 INFO");
        const auto file = taocode::diagnostics::log_file(level_profile);
        const auto before = read_lines(file).size();
        taocode::diagnostics::event(level_profile, "DEBUG", "打开开关前的细节");
        check(read_lines(file).size() == before, "INFO 级别下 DEBUG 不该落盘");
        // 切到 DEBUG 之后落盘；WARN/ERROR 也落。
        check(taocode::diagnostics::set_log_level(level_profile, "debug"), "小写的 debug 应当被接受");
        check(taocode::diagnostics::log_level(level_profile) == "DEBUG", "级别应当持久化并可读回");
        taocode::diagnostics::event(level_profile, "DEBUG", "打开开关后的细节");
        check(read_all(file).find("打开开关后的细节") != std::string::npos, "DEBUG 级别下应当落盘");
        // 切到 ERROR：INFO/WARN 都不落，ERROR 仍落（内部错误账也要记）。
        check(taocode::diagnostics::set_log_level(level_profile, "ERROR"), "切到 ERROR");
        const auto before_error = read_lines(file).size();
        taocode::diagnostics::event(level_profile, "INFO", "不该写");
        taocode::diagnostics::event(level_profile, "WARN", "也不该写");
        check(read_lines(file).size() == before_error, "ERROR 级别下 INFO/WARN 都不该落盘");
        taocode::diagnostics::event(level_profile, "ERROR", "该写");
        check(read_all(file).find("该写") != std::string::npos, "ERROR 级别下 ERROR 应当落盘");
        // 非法级别名被拒，且不覆盖已存的值。
        check(!taocode::diagnostics::set_log_level(level_profile, "TRACE"), "认不出的级别名应当被拒");
        check(taocode::diagnostics::log_level(level_profile) == "ERROR", "被拒的写入不该改动已存级别");
        // 新 profile 重新 init 会读回上次存的级别。
        const auto reread = root / L"profile-level2";
        taocode::diagnostics::set_log_level(reread, "DEBUG");
        taocode::diagnostics::init(reread, "9.9.9");
        check(taocode::diagnostics::log_level(reread) == "DEBUG", "init 应当读回持久化的级别");
        taocode::diagnostics::set_log_level(reread, "INFO");  // 收尾：别把全局级别留在 DEBUG
    });

    run("低内存检查：返回可用/总量/工作集/占用率，low 是布尔", [&] {
        const auto info = taocode::diagnostics::low_memory();
        check(info.contains("low") && info.at("low").is_boolean(), "low 是布尔");
        check(info.at("availableMb").is_number_unsigned() && info.at("totalMb").is_number_unsigned(),
              "可用/总量应当是数字");
        check(info.at("workingSetMb").is_number_unsigned() && info.at("loadPercent").is_number_unsigned(),
              "工作集/占用率应当是数字");
        check(info.at("totalMb").get<std::uint64_t>() > 0, "本机总物理内存应当 > 0");
        check(info.at("workingSetMb").get<std::uint64_t>() > 0, "当前进程工作集应当 > 0");
        check(info.at("thresholdMb").get<std::uint64_t>() == taocode::diagnostics::kLowMemoryAvailableMb,
              "默认阈值应当与常量一致");
        // 把阈值抬到不可能达到的高度：必然判 low（系统可用内存不可能有 10 亿 MB）。
        const auto forced = taocode::diagnostics::low_memory(1000000000ULL, 1000000000ULL);
        check(forced.at("low").get<bool>(), "阈值抬高后应当判 low");
    });

    run("线程转储：抓到当前线程的栈（含 TaoCode 模块帧），写文件带线程数", [&] {
        const auto text = taocode::diagnostics::thread_dump();
        check(text.find("线程转储") != std::string::npos, "转储标题缺失");
        check(text.find("Thread ") != std::string::npos, "至少要列出当前线程");
        check(text.find("共 ") != std::string::npos, "要有线程计数收尾");
        // 当前线程至少有一帧，且帧地址来自本模块（测试 exe 也是模块名+偏移）。
        check(text.find("+0x") != std::string::npos, "帧应当写成 模块名+0x偏移");
        const auto written = taocode::diagnostics::write_thread_dump(profile);
        check(written.threads >= 1, "写文件时线程数应当 >= 1");
        check(!written.path.empty(), "应当写出一个转储文件");
        const auto body = read_all(fs::path(written.path));
        check(body.find("线程转储") != std::string::npos, "文件里应当是转储正文");
        // 空 profile：不写文件，但仍抓到线程（不抛）。
        const auto bare = taocode::diagnostics::write_thread_dump(fs::path());
        check(bare.path.empty() && bare.threads >= 1, "空 profile 不写文件但仍报线程数");
    });

    run("troubleshooting 文本含版本 / 平台 / 内存 / 日志路径 / 目录清单", [&] {
        const auto info = taocode::diagnostics::troubleshooting(profile, root / L"bin", "9.9.9");
        const auto text = info.at("text").get<std::string>();
        check(text.find("9.9.9") != std::string::npos, "没有版本号");
        check(text.find("Windows") != std::string::npos, "没有平台");
        check(text.find("进程内存") != std::string::npos, "没有内存信息");
        check(text.find(taocode::diagnostics::log_file(profile).string()) != std::string::npos, "没有日志路径");
        check(text.find("配置目录") != std::string::npos && text.find("特殊目录") != std::string::npos,
              "没有目录清单");
        // 本轮补的三节：低内存 / 日志级别 / 线程转储。
        check(text.find("内存：") != std::string::npos, "没有低内存一节");
        check(text.find("日志级别：") != std::string::npos, "没有日志级别一行");
        check(info.contains("lowMemory") && info.at("lowMemory").at("low").is_boolean(), "没有结构化 lowMemory");
        check(info.at("logLevel").is_string(), "没有结构化 logLevel");
        check(info.contains("threadDump") && info.at("threadDump").at("threads").get<int>() >= 1,
              "没有结构化 threadDump");
    });

    std::error_code cleanup;
    fs::remove_all(root, cleanup);
    std::cout << (failures ? "DIAGNOSTICS TESTS FAILED\n" : "diagnostics tests passed\n");
    return failures ? 1 : 0;
}
