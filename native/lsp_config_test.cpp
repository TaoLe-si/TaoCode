// `TaoCode.lsp.json` 的读取契约（native/lsp_config.cpp 的 read_explicit_servers）。
//
// 为什么要单独测这一条：这个文件是用户**唯一**能自定义语言服务器的入口（命令行、args、cwd、
// initializationOptions 都只在这里能表达），而它此前一个测试都没有 —— 真机取证时正是这里
// 出了岔子：exe 旁的 TaoCode.lsp.json 明明写好了，宿主却拉起了内置的 JDT LS，
// 症状是"definitions 回空、没有任何自定义服务器进程"。契约不锁住，下次还会静默走回内置那一份。
#include "lsp_config.hpp"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::lsp::read_explicit_servers;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

fs::path temp_directory() {
    const auto path = fs::temp_directory_path() / L"taocode-lsp-config-test";
    fs::remove_all(path);
    fs::create_directories(path);
    return path;
}

void write(const fs::path& file, const std::string& text) {
    std::ofstream stream(file, std::ios::binary);
    stream << text;
}
}  // namespace

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    run("一条配置连同 args / cwd / initializationOptions 一起读回来", [&] {
        const auto dir = temp_directory();
        const auto file = dir / L"TaoCode.lsp.json";
        write(file, R"({
  "java": {
    "command": "D:/tools/fake-server.exe",
    "args": ["--multi-definition", "--verbose"],
    "cwd": "D:/work",
    "initializationOptions": {"settings": {"java": {"import": {"gradle": {"enabled": false}}}}}
  }
})");
        const auto servers = read_explicit_servers(file);
        check(servers.size() == 1 && servers.contains("java"), "java 条目没读出来");
        const auto& java = servers.at("java");
        check(java.command == L"D:/tools/fake-server.exe", "command 读错了");
        check(java.arguments.size() == 2 && java.arguments[0] == L"--multi-definition" && java.arguments[1] == L"--verbose",
              "args 读错了");
        check(java.working_directory == fs::path(L"D:/work"), "cwd 读错了");
        check(java.initialization_options.value("settings", Json::object())
                  .value("java", Json::object()).value("import", Json::object())
                  .value("gradle", Json::object()).value("enabled", true) == false,
              "initializationOptions 读错了");
    });

    run("非对象条目（_comment 之类）直接跳过，不炸也不占位", [&] {
        const auto dir = temp_directory();
        const auto file = dir / L"TaoCode.lsp.json";
        write(file, R"({
  "_comment": "临时探针：中文注释也必须能读（文件是 UTF-8）",
  "java": {"command": "D:/tools/fake-server.exe"}
})");
        const auto servers = read_explicit_servers(file);
        check(servers.size() == 1 && servers.contains("java"), "带 _comment 的文件没读出来");
    });

    run("没有 command 的条目丢掉（空 command 会让宿主拉一个空进程）", [&] {
        const auto dir = temp_directory();
        const auto file = dir / L"TaoCode.lsp.json";
        write(file, R"({"go": {"args": ["serve"]}})");
        check(read_explicit_servers(file).empty(), "缺 command 的条目应当被丢掉");
    });

    run("文件不存在 = 没有服务器，不是异常", [&] {
        const auto dir = temp_directory();
        check(read_explicit_servers(dir / L"nope.json").empty(), "不存在的文件应当回空表");
    });

    run("读不懂的文件（坏 JSON）同样回空表，不能让 IDE 起不来", [&] {
        const auto dir = temp_directory();
        const auto file = dir / L"TaoCode.lsp.json";
        write(file, "{ this is not json ");
        check(read_explicit_servers(file).empty(), "坏 JSON 应当回空表");
    });

    // 「只把链接的子工程声明成 workspace folder」——关掉 Gradle 导入时按源根/类路径的第一段派生。
    // 判据的来由见 native/lsp_session.hpp 里 ServerConfig::workspace_folders 的注释（真机：声明
    // 工作区根会让 JDT 把根下每个 `.project` 目录都导进来，2100+ 批诊断把语义请求拖到超时）。
    run("关掉 Gradle 导入时，workspace folder 只声明链接的子工程（第一段目录）", [&] {
        const auto dir = temp_directory();
        write(dir / L"TaoCode.lsp.json", R"({"java": {"command": "java"}})");
        const auto root = dir / L"proj";
        std::filesystem::create_directories(root / L"mod-a" / L"src" / L"main" / L"java");
        std::filesystem::create_directories(root / L"mod-a" / L"build" / L"rfg");
        const taocode::Json settings{{"buildTools", taocode::Json{{"gradle",
            taocode::Json{{"enabled", false}, {"linkedProjects", taocode::Json::array({"mod-a"})}}}}}};
        const auto servers = taocode::lsp::resolve_servers(dir, root.string(), settings);
        check(servers.contains("java"), "没有 java 服务器");
        const auto& folders = servers.at("java").workspace_folders;
        check(folders.size() == 1 && folders.front() == "mod-a", "应当只声明 mod-a，得到 " + std::to_string(folders.size()) + " 条");
    });

    run("Gradle 导入开着时不动 workspace folder（交给 Buildship 自己建工程）", [&] {
        const auto dir = temp_directory();
        write(dir / L"TaoCode.lsp.json", R"({"java": {"command": "java"}})");
        const auto root = dir / L"proj2";
        std::filesystem::create_directories(root / L"mod-a" / L"src" / L"main" / L"java");
        const taocode::Json settings{{"buildTools", taocode::Json{{"gradle",
            taocode::Json{{"enabled", true}, {"linkedProjects", taocode::Json::array({"mod-a"})}}}}}};
        const auto servers = taocode::lsp::resolve_servers(dir, root.string(), settings);
        check(servers.contains("java"), "没有 java 服务器");
        check(servers.at("java").workspace_folders.empty(), "导入开着时不该替换 workspace folder");
    });


    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
