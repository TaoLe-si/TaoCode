// 自动发现的回归：装了语言服务器就应该被找到，没装就不该编一个命令出来。
#include "lsp_discovery.hpp"

#include <windows.h>

#include <filesystem>
#include <functional>
#include <fstream>
#include <map>
#include <iostream>
#include <string>

namespace {

namespace fs = std::filesystem;
using taocode::lsp::discover_server;
using taocode::lsp::find_on_path;
using taocode::lsp::server_candidates;

int failures = 0;

void check(bool condition, const std::string& message) {
    if (condition) return;
    ++failures;
    std::cout << "FAIL " << message << '\n';
}

void run(const std::string& name, const std::function<void()>& body) {
    const int before = failures;
    try { body(); } catch (const std::exception& error) { ++failures; std::cout << "FAIL " << name << ": " << error.what() << '\n'; }
    if (failures == before) std::cout << "ok   " << name << '\n';
}

/** `%SystemRoot%\System32`（不硬编码盘符：这台机器的 Windows 未必装在 C:）。 */
fs::path system_directory() {
    wchar_t buffer[MAX_PATH] = {};
    const DWORD length = GetEnvironmentVariableW(L"SystemRoot", buffer, MAX_PATH);
    if (length == 0 || length >= MAX_PATH) return fs::path(L"C:\\Windows");
    return fs::path(std::wstring(buffer, length)) / L"System32";
}

/** 在一个带空格的临时目录里放一个真的可执行文件（cmd.exe 的副本），当作"装好的服务器"。 */
fs::path install_fake_server(const fs::path& root, const wchar_t* name) {
    auto directory = root / L"Program Files" / L"taocode servers";
    std::error_code error;
    fs::create_directories(directory, error);
    const fs::path target = directory / name;
    fs::copy_file(system_directory() / L"cmd.exe", target,
                  fs::copy_options::overwrite_existing, error);
    check(!error, "无法准备假的服务器可执行文件：" + error.message());
    return target;
}

std::string to_utf8(const std::wstring& value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<std::size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
    return out;
}

fs::path temp_root() {
    const auto base = fs::temp_directory_path() / L"taocode-lsp-discovery-test";
    std::error_code error;
    fs::remove_all(base, error);
    fs::create_directories(base, error);
    return base;
}

/**
 * 造一份**结构与官方包一致**的 JDT LS 安装（`plugins/` + `config_win/`）。
 *
 * bundle 名必须带版本后缀：每份 config.ini 都有一行
 * `eclipse.application=org.eclipse.jdt.ls.core.id1`，只找子串的话坏配置也会被认成好的。
 * 平台 fragment 照本机架构给，m2e 必须有 —— 这两条都是实测结论（详见 `native/jdtls.cpp`）。
 */
fs::path make_jdtls_install(const fs::path& install) {
    std::error_code error;
    fs::create_directories(install / L"plugins", error);
    std::ofstream(install / L"plugins" / L"org.eclipse.equinox.launcher_1.6.900.v20240613-2009.jar",
                  std::ios::binary) << "jar";
    // 通用 config/ 故意不放 config.ini（官方包就是这样：用它当配置会 exit 13）。
    fs::create_directories(install / L"config", error);
    fs::create_directories(install / L"config_win", error);
    std::ofstream(install / L"config_win" / L"config.ini")
        << "eclipse.application=org.eclipse.jdt.ls.core.id1\n"
           "osgi.bundles=reference\\:file\\:org.eclipse.jdt.ls.core_1.44.0.jar@4\\:start,"
           "reference\\:file\\:org.eclipse.m2e.core_2.6.0.jar@4,"
           "reference\\:file\\:org.eclipse.equinox.launcher.win32.win32.x86_64_1.2.1100.jar@4\n";
    return install;
}

/** IDE 自带的 JRE（`scripts/fetch-jre.ps1` 的产物就是这个形状：`jre\bin\java.exe`）。 */
fs::path install_fake_jre(const fs::path& executable_directory) {
    const auto java = executable_directory / L"jre" / L"bin" / L"java.exe";
    std::error_code error;
    fs::create_directories(java.parent_path(), error);
    fs::copy_file(system_directory() / L"cmd.exe", java, fs::copy_options::overwrite_existing, error);
    check(!error, "无法准备假的 java 可执行文件：" + error.message());
    return java;
}

/** 把 `%LOCALAPPDATA%` 指到临时目录，免得这台机器上真实的缓存目录影响判据。 */
void isolate_local_app_data(const fs::path& directory) {
    std::error_code error;
    fs::create_directories(directory, error);
    SetEnvironmentVariableW(L"LOCALAPPDATA", directory.c_str());
}

std::wstring read_variable(const wchar_t* name) {
    wchar_t buffer[32768] = {};
    const DWORD length = GetEnvironmentVariableW(name, buffer, 32768);
    if (length == 0 || length >= 32768) return {};
    return std::wstring(buffer, length);
}

void write_variable(const wchar_t* name, const std::wstring& value) {
    SetEnvironmentVariableW(name, value.c_str());
}

}  // namespace

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    run("装了 clangd 就能被找到（PATH 里的目录可以带空格）", [] {
        const auto root = temp_root();
        const auto installed = install_fake_server(root, L"clangd.exe");
        const auto directory = installed.parent_path().wstring();
        const auto config = discover_server("cpp", directory);
        check(!config.command.empty(), "PATH 里有 clangd.exe 却没发现");
        check(config.command == installed.wstring(), "发现的是别的文件：" + to_utf8(config.command));
    });

    run("java 的候选是 jdtls，装了就能被找到", [] {
        const auto root = temp_root();
        const auto installed = install_fake_server(root, L"jdtls.exe");
        const auto config = discover_server("java", installed.parent_path().wstring());
        check(!config.command.empty(), "PATH 里有 jdtls.exe 却没发现");
        check(config.command == installed.wstring(), "发现的是别的文件：" + to_utf8(config.command));
    });

    run("没装就返回空命令（绝不编一个不存在的可执行文件）", [] {
        const auto root = temp_root();
        const auto config = discover_server("java", root.wstring());
        check(config.command.empty(), "空目录里不该发现服务器，得到：" + to_utf8(config.command));
    });

    run("PATH 为空时同样返回空", [] {
        check(discover_server("java", L"").command.empty(), "空 PATH 不该发现服务器");
    });

    run("未知语言没有候选（不会误配）", [] {
        check(server_candidates("cobol").empty(), "不该给未知语言编候选");
        check(discover_server("cobol", L"C:\\Windows\\System32").command.empty(),
              "未知语言不该被配上任何服务器");
    });

    run("候选表覆盖各语言，且用的是官方可执行名", [] {
        check(!server_candidates("cpp").empty(), "C++ 应该有 clangd");
        check(!server_candidates("python").empty(), "Python 应该有服务器");
        check(!server_candidates("go").empty(), "Go 应该有 gopls");
        check(!server_candidates("rust").empty(), "Rust 应该有 rust-analyzer");
        check(!server_candidates("typescript").empty(), "TypeScript 应该有 typescript-language-server");
        const auto& java = server_candidates("java");
        bool has_jdtls = false;
        for (const auto* candidate : java) has_jdtls = has_jdtls || std::wstring(candidate).find(L"jdtls") != std::wstring::npos;
        check(has_jdtls, "Java 的候选里必须有 jdtls");
    });

    run("PATH 里的空目录项与多余空白不影响查找", [] {
        const auto root = temp_root();
        const auto installed = install_fake_server(root, L"gopls.exe");
        const auto noisy = L" ;  " + installed.parent_path().wstring() + L" ;C:\\Windows\\System32";
        const auto config = discover_server("go", noisy);
        check(config.command == installed.wstring(), "带空白与空项的 PATH 也要能找到：" + to_utf8(config.command));
    });

    run("find_on_path 直接用候选列表", [] {
        const auto root = temp_root();
        const auto installed = install_fake_server(root, L"rust-analyzer.exe");
        const auto found = find_on_path({L"rust-analyzer.exe"}, installed.parent_path().wstring());
        check(found == installed.wstring(), "候选列表查找失败：" + to_utf8(found));
        check(find_on_path({L"不存在的.exe"}, installed.parent_path().wstring()).empty(), "不存在的候选必须返回空");
    });

    run("merge_discovered 把装好的并进配置，且不覆盖已配的语言", [] {
        const auto root = temp_root();
        const auto installed = install_fake_server(root, L"gopls.exe");
        // 临时把 PATH 指到那个目录（测完还原）。
        wchar_t saved[32768] = {};
        const DWORD saved_length = GetEnvironmentVariableW(L"PATH", saved, 32768);
        const std::wstring previous = saved_length > 0 && saved_length < 32768 ? std::wstring(saved, saved_length)
                                                                            : std::wstring();
        SetEnvironmentVariableW(L"PATH", installed.parent_path().c_str());

        // 显式配置优先：TaoCode.lsp.json 里配的不能被自动发现顶掉。
        std::map<std::string, taocode::lsp::Session::ServerConfig> servers;
        taocode::lsp::Session::ServerConfig configured;
        configured.command = L"D:\\tools\\my-own-gopls.exe";
        servers.emplace("go", configured);
        taocode::lsp::merge_discovered(servers);
        check(servers.at("go").command == configured.command,
              "TaoCode.lsp.json 里显式配的 go 服务器不能被自动发现覆盖");

        // 没有显式配置时，PATH 上的那台就应当被并进来（上面刚把 PATH 指过去了）。
        std::map<std::string, taocode::lsp::Session::ServerConfig> empty;
        taocode::lsp::merge_discovered(empty);
        check(empty.contains("go") && empty.at("go").command == installed.wstring(),
              "没显式配置时，PATH 上的 gopls 应当被并进来");

        // Java **必须**留给 discover_java：随发行的 JDT LS 是一份 Equinox 安装，
        // 优先级高于 PATH 上的同名可执行文件。若这里先把 PATH 上的 jdtls 并进来，
        // `servers.contains("java")` 立刻为真，宿主就会跳过"先找随发行那一份"——
        // 内置 Java 支持就是这样失效的。
        check(!empty.contains("java"), "merge_discovered 不该替 Java 做决定（会顶掉随发行的那一份）");

        SetEnvironmentVariableW(L"PATH", previous.c_str());
    });

    run("discover_java：随发行的 JDT LS 优先于 PATH 上的同名可执行文件", [] {
        const auto root = temp_root();
        // PATH 上放一个同名可执行文件；exe 旁边放一份**结构完整**的 JDT LS 与自带 JRE。
        const auto on_path = install_fake_server(root / L"path", L"jdtls.exe");
        const auto exe_dir = root / L"app";
        const auto install = make_jdtls_install(exe_dir / L"jdtls");
        const auto bundled_java = install_fake_jre(exe_dir);
        // 这台机器上真实的 %LOCALAPPDATA%\TaoCode 会干扰第 2 步，测试期间指到空目录。
        const auto saved_local = read_variable(L"LOCALAPPDATA");
        const auto saved_path = read_variable(L"PATH");
        isolate_local_app_data(root / L"local-app-data");
        write_variable(L"PATH", on_path.parent_path().wstring());

        const auto spec = taocode::lsp::discover_java({}, exe_dir, root / L"data");
        // 随发行那份是"用 JVM 拉起一份安装"，命令是 IDE 自带的 java 而**不是** PATH 上那个 exe。
        check(!spec.command.empty(), "exe 旁边装了 JDT LS 却没被用上");
        check(spec.command == bundled_java.wstring(),
              "内置那份应当用自带的 JRE 拉起（与项目 Java 版本无关）：" + to_utf8(spec.command));
        check(spec.command.find(L"jdtls.exe") == std::wstring::npos,
              "不该退到 PATH 上的 jdtls.exe（内置那份应当优先）：" + to_utf8(spec.command));
        check(spec.arguments.size() > 5, "内置那份要按 Equinox 参数表拉起，不是裸跑一个 exe");
        check(!install.empty(), "夹具应当真的建出目录");

        // 什么都没有时，PATH 上那台才该被用上。
        const auto bare = taocode::lsp::discover_java({}, root / L"empty-app", root / L"data2");
        check(bare.command == on_path.wstring(), "没有内置、没有缓存时应当退到 PATH 上的 jdtls");

        write_variable(L"PATH", saved_path);
        write_variable(L"LOCALAPPDATA", saved_local);
    });

    std::cout << (failures == 0 ? "lsp_discovery: all checks passed\n" : "lsp_discovery: failures\n");
    return failures == 0 ? 0 : 1;
}
