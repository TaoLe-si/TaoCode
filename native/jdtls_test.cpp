// JDT LS 启动规格的回归：参数必须与官方 README 一致，坏安装必须被拒。
#include "jdtls.hpp"

#include <windows.h>

#include <filesystem>
#include <functional>
#include <fstream>
#include <iostream>
#include <string>

namespace {

namespace fs = std::filesystem;
using taocode::jdtls::configuration_directory;
using taocode::jdtls::is_install;
using taocode::jdtls::launch_spec;
using taocode::jdtls::launcher_jar;
using taocode::jdtls::workspace_data;

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

fs::path temp_root() {
    const auto base = fs::temp_directory_path() / L"taocode-jdtls-test";
    std::error_code error;
    fs::remove_all(base, error);
    fs::create_directories(base, error);
    return base;
}

/**
 * 造一份**结构与官方包一致**的安装。
 *
 * 三处都照实测到的真实数据，不是照名字编：
 *   · `config/`            没有 config.ini（官方包就是这样）
 *   · `config_ss_win/`     有 jdt.ls.core 与平台 fragment、**没有 m2e** → 实测 exit 13
 *   · `config_win/`        有 jdt.ls.core、m2e 与 win32 fragment → 实测能握手
 * bundle 名必须带版本后缀（`org.eclipse.jdt.ls.core_1.44.0.jar`）：每份 config.ini 都有一行
 * `eclipse.application=org.eclipse.jdt.ls.core.id1`，只看子串的话坏配置也会被当成好的。
 */
fs::path make_install(const fs::path& root, bool usable_config = true, bool with_launcher = true) {
    const auto install = root / L"jdtls";
    std::error_code error;
    fs::create_directories(install / L"plugins", error);
    if (with_launcher) {
        std::ofstream(install / L"plugins" / L"org.eclipse.equinox.launcher_1.6.900.v20240613-2009.jar", std::ios::binary) << "jar";
    }
    // 通用 config/ 故意**不放** config.ini —— 用它当配置会 "Unable to acquire application service"。
    fs::create_directories(install / L"config", error);
    // standalone 那份：平台对、没有 m2e。实测里它必崩（NoClassDefFoundError: ProblemSeverity），
    // 所以判据必须能把「有没有 m2e」读出来，而不能只看有没有 jdt.ls.core。
    // `usable_config=false` 时连它也不含本体 —— 那份用例要的是"全安装都没人声明能当服务器"。
    fs::create_directories(install / L"config_ss_win", error);
    std::ofstream(install / L"config_ss_win" / L"config.ini")
        << "eclipse.application=org.eclipse.jdt.ls.core.id1\n"
           "osgi.bundles=reference\\:file\\:"
        << (usable_config ? "org.eclipse.jdt.ls.core_1.44.0.jar@4\\:start," : "com.google.gson_2.11.0.jar@4,")
        << "reference\\:file\\:org.eclipse.equinox.launcher.win32.win32.x86_64_1.2.1100.jar@4\n";
    const auto complete = install / (usable_config ? L"config_win" : L"config_broken");
    fs::create_directories(complete, error);
    std::ofstream(complete / L"config.ini")
        << (usable_config
                // 完整那份：语言服务器本体 + m2e + 本机平台的 launcher fragment。
                ? "eclipse.application=org.eclipse.jdt.ls.core.id1\n"
                  "osgi.bundles=reference\\:file\\:org.eclipse.jdt.ls.core_1.44.0.jar@4\\:start,"
                  "reference\\:file\\:org.eclipse.m2e.core_2.6.0.jar@4,"
                  "reference\\:file\\:org.eclipse.equinox.launcher.win32.win32.x86_64_1.2.1100.jar@4\n"
                  "osgi.bundles.defaultStartLevel=4\n"
                // 缺了语言服务器本体的那份：只有 gson —— 起不来，只能报看不懂的错。
                : "eclipse.application=org.eclipse.jdt.ls.core.id1\n"
                  "osgi.bundles=reference\\:file\\:com.google.gson_2.11.0.jar@4,"
                  "reference\\:file\\:org.eclipse.equinox.launcher.win32.win32.x86_64_1.2.1100.jar@4\n"
                  "osgi.bundles.defaultStartLevel=4\n");
    return install;
}

std::string joined(const std::vector<std::wstring>& parts) {
    std::string out;
    for (const auto& part : parts) {
        if (!out.empty()) out += ' ';
        const int size = WideCharToMultiByte(CP_UTF8, 0, part.data(), static_cast<int>(part.size()), nullptr, 0, nullptr, nullptr);
        std::string piece(static_cast<std::size_t>(size), '\0');
        WideCharToMultiByte(CP_UTF8, 0, part.data(), static_cast<int>(part.size()), piece.data(), size, nullptr, nullptr);
        out += piece;
    }
    return out;
}

bool has_argument(const std::vector<std::wstring>& arguments, const std::wstring& value) {
    for (const auto& argument : arguments) if (argument == value) return true;
    return false;
}

}  // namespace

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    run("认得出官方包的目录结构（launcher + 真正带语言服务器本体的配置）", [] {
        const auto install = make_install(temp_root());
        check(is_install(install), "结构完整的安装应当被认出来");
        check(launcher_jar(install).filename() == L"org.eclipse.equinox.launcher_1.6.900.v20240613-2009.jar",
              "launcher jar 找错了");
        // 三份 config 里：config/ 没有 config.ini；config_ss_win 有本体但**没有 m2e**
        // （实测 exit 13）；只有 config_win 既有本体又有 m2e。判据要挑出它。
        check(configuration_directory(install).filename() == L"config_win",
              "应当选中既有语言服务器本体又有 m2e 的那份配置");
    });

    run("缺 launcher 或整包都没有语言服务器本体就不算安装（不会拿它去启动）", [] {
        const auto root = temp_root();
        check(!is_install(make_install(root / L"a", true, false)), "没有 launcher jar 不算安装");
        check(!is_install(make_install(root / L"b", false, true)),
              "全包都没有 org.eclipse.jdt.ls.core_ 本体时不算安装（起不来，只会报看不懂的错）");
        check(!is_install(root / L"根本没有这个目录"), "不存在的目录不算安装");
        check(!is_install({}), "空路径不算安装");
    });

    run("启动规格逐字照官方 bin/jdtls.py（共享只读配置区 + 可写写入区）", [] {
        // 注意：temp_root() 会清空并重建自己的基目录，所以这里只能调一次 —— 否则
        // 第二个调用会把刚建好的安装删掉，变成"在空目录上断言参数表"。
        const auto root = temp_root();
        const auto install = make_install(root);
        const auto data = root / L"ws";
        const auto spec = launch_spec(install, L"C:\\jdk\\bin\\java.exe", data);
        check(spec.command == L"C:\\jdk\\bin\\java.exe", "启动器必须是给定的 java");
        const auto line = joined(spec.arguments);
        check(line.find("-Declipse.application=org.eclipse.jdt.ls.core.id1") != std::string::npos,
              "缺 application 系统属性：" + line);
        check(line.find("-Declipse.product=org.eclipse.jdt.ls.core.product") != std::string::npos,
              "缺 product（官方显式给，不然 Equinox 要靠 application id 反推）");
        check(line.find("-Dosgi.bundles.defaultStartLevel=4") != std::string::npos, "缺 defaultStartLevel");
        check(line.find("-Dosgi.checkConfiguration=true") != std::string::npos, "缺 checkConfiguration");
        check(line.find("-Dosgi.sharedConfiguration.area.readOnly=true") != std::string::npos, "缺只读共享配置区");
        check(line.find("-Dosgi.configuration.cascaded=true") != std::string::npos, "缺 cascaded");
        check(line.find("--add-modules=ALL-SYSTEM") != std::string::npos, "缺 --add-modules（JDK 17+ 强封装）");
        check(line.find("--add-opens java.base/java.lang=ALL-UNNAMED") != std::string::npos, "缺 --add-opens");
        check(has_argument(spec.arguments, L"-jar"), "缺 -jar");
        check(has_argument(spec.arguments, L"-data"), "缺 -data");
        // 共享配置区必须指到那份真能用的配置，且**只读**。
        check(line.find(joined({L"-Dosgi.sharedConfiguration.area=" + (install / L"config_win").wstring()})) != std::string::npos,
              "共享配置区没有指向 config_win：" + line);
        // 写入区不能在安装目录里 —— 发布版装到只读位置就崩。必须落在数据目录旁边。
        const auto writable = data.parent_path() / L"configuration" / data.filename();
        check(line.find(joined({L"-Dosgi.configuration.area=" + writable.wstring()})) != std::string::npos,
              "写入区必须落在可写的数据目录下，而不是安装目录：" + line);
        check(line.find("-configuration") == std::string::npos,
              "不能用 -configuration（它会把写入区钉在安装目录里）：" + line);
        // -jar 之后才是 Equinox 的参数，顺序不能反（-data 在最后）。
        const auto jar = std::find(spec.arguments.begin(), spec.arguments.end(), L"-jar");
        const auto data_arg = std::find(spec.arguments.begin(), spec.arguments.end(), L"-data");
        check(jar < data_arg, "Equinox 参数顺序错了：" + line);
    });

    run("没有 java 可执行文件就不给规格（不会去启动一个空的命令）", [] {
        const auto install = make_install(temp_root());
        check(launch_spec(install, {}, L"C:\\data").command.empty(), "没有 JDK 时不该产出启动规格");
        check(launch_spec(temp_root() / L"不存在", L"C:\\jdk\\bin\\java.exe", L"C:\\data").command.empty(),
              "坏安装不该产出启动规格");
    });

    run("每个工作区一份索引数据，工作区那层目录名里没有非法字符", [] {
        const auto data = workspace_data(L"C:\\Users\\me\\AppData\\Local\\TaoCode", "D:\\work\\my project");
        // 要禁的是**工作区那层**的名字：`C:` 里的冒号是盘符，本来就有。
        const auto leaf = data.filename().wstring();
        check(data.parent_path().filename() == L"jdtls-workspace", "索引数据放在专用目录下");
        check(leaf.find(L":") == std::wstring::npos, "工作区目录名里不能出现冒号：" + joined({ leaf }));
        check(leaf.find(L" ") == std::wstring::npos, "工作区目录名里不能出现空格：" + joined({ leaf }));
        check(leaf.find(L"\\") == std::wstring::npos, "工作区目录名里不能出现分隔符");
        check(workspace_data(L"C:\\root", "a") != workspace_data(L"C:\\root", "b"),
              "不同工作区必须用不同的索引目录");
        check(workspace_data(L"C:\\root", "a") == workspace_data(L"C:\\root", "a"), "同一工作区要稳定");
    });

    std::cout << (failures == 0 ? "jdtls: all checks passed\n" : "jdtls: failures\n");
    return failures == 0 ? 0 : 1;
}
