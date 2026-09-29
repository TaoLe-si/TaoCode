// JDK 探测的自测：JDK/JRE 判定（`JdkUtil.checkForJdk`）、版本读取（`JdkVersionDetectorImpl`）、
// 建议名（`JdkUtil.suggestJdkName`），以及 `find_all()` 的自洽性（找到的每个都必须是真 JDK）。
#include "jdk.hpp"

#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

namespace fs = std::filesystem;
using taocode::jdk::Jdk;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

/** 一个干净的临时目录（每次都要重新造，因为判定就是看目录结构）。 */
fs::path scratch(const std::string& name) {
    const fs::path base = fs::temp_directory_path() / L"taocode-jdk-test" / name;
    std::error_code error;
    fs::remove_all(base, error);
    fs::create_directories(base, error);
    return base;
}

void touch(const fs::path& file) {
    std::error_code error;
    fs::create_directories(file.parent_path(), error);
    std::ofstream out(file, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("写不了 " + file.string());
    out << "stub";
}

/** 造一个模块化 JDK（`bin/javac.exe` + `lib/modules`，JDK 9+ 的真实布局）。 */
fs::path make_jdk(const fs::path& home, const std::string& release = {}) {
    touch(home / "bin" / "javac.exe");
    std::error_code error;
    fs::create_directories(home / "lib" / "modules", error);
    if (!release.empty()) {
        std::ofstream out(home / "release", std::ios::binary | std::ios::trunc);
        out << release;
    }
    return home;
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
    using namespace taocode::jdk;

    run("没有 bin/javac 的目录不是 JDK", [] {
        const fs::path root = scratch("empty");
        check(!is_jdk(root), "空目录不该被当成 JDK");
        check(!is_jdk(root / "nope"), "不存在的目录不该被当成 JDK");
        check(!is_jdk({}), "空路径不该被当成 JDK");
    });

    run("只有 bin/java 的是 JRE，不是 JDK", [] {
        const fs::path root = scratch("jre-only");
        touch(root / "bin" / "java.exe");
        std::error_code error;
        fs::create_directories(root / "lib" / "modules", error);
        check(!is_jdk(root), "没有 javac 的运行时不算 JDK");
    });

    run("bin/javac + lib/modules 就是 JDK（JdkUtil.isModularRuntime）", [] {
        const fs::path root = make_jdk(scratch("modern"));
        check(is_jdk(root), "模块化 JDK 应当被认出来");
    });

    run("老式布局（jre/lib/rt.jar）也认", [] {
        const fs::path root = scratch("legacy");
        touch(root / "bin" / "javac.exe");
        touch(root / "jre" / "lib" / "rt.jar");
        check(is_jdk(root), "带 rt.jar 的老 JDK 应当被认出来");
    });

    run("版本从 release 文件读，JAVA_FULL_VERSION 优先", [] {
        const fs::path modern = make_jdk(scratch("release"), "JAVA_VERSION=\"21.0.11\"\n");
        check(read_version(modern) == "21.0.11", "应当读出版本号（并剥掉引号）");
        const fs::path full = make_jdk(scratch("release-full"), "JAVA_VERSION=\"17.0.2\"\nJAVA_FULL_VERSION=\"17.0.2+8\"\n");
        check(read_version(full) == "17.0.2+8", "JAVA_FULL_VERSION 应当优先");
        const fs::path none = make_jdk(scratch("release-none"));
        check(read_version(none).empty(), "没有 release 文件时应当是空串（而不是猜一个版本）");
    });

    run("建议名照 JdkUtil.suggestJdkName（feature < 9 写成 1.x，EA 带后缀）", [] {
        check(suggest_name("21.0.11") == "21", "21.0.11 → 21");
        check(suggest_name("1.8.0_392") == "1.8", "1.8.0_392 → 1.8");
        check(suggest_name("17.0.2-ea") == "17-ea", "EA 版本要带后缀");
        check(suggest_name("9") == "9", "单段版本号也要认");
        check(suggest_name("abc").empty(), "解析不出数字时返回空串");
        check(suggest_name("").empty(), "空版本返回空串");
    });

    run("find_all 找到的每个条目都必须是真 JDK，且字段自洽", [] {
        const auto jdks = find_all();
        for (const Jdk& entry : jdks) {
            check(!entry.home.empty(), "home 不能为空");
            check(is_jdk(entry.home), "find_all 收进来的目录必须通过 is_jdk：" + entry.home);
            check(!entry.version.empty() || entry.name.empty(), "没有版本就不该有建议名");
        }
        // 同一台机器上不该出现重复路径
        for (std::size_t index = 0; index < jdks.size(); ++index)
            for (std::size_t other = index + 1; other < jdks.size(); ++other)
                check(jdks[index].home != jdks[other].home, "探测结果不该有重复路径");
        std::cout << "     （这台机器上探测到 " << jdks.size() << " 个 JDK）\n";
    });

    run("to_json 的形状固定（前端按 home/version/name 读）", [] {
        const auto json = to_json({Jdk{"C:\\jdk-21", "21.0.11", "21"}});
        check(json.at("jdks").size() == 1, "应当有一条");
        check(json.at("jdks").at(0).at("home").get<std::string>() == "C:\\jdk-21", "home 没输出");
        check(json.at("jdks").at(0).at("name").get<std::string>() == "21", "name 没输出");
        check(to_json({}).at("jdks").empty(), "空列表也应当是数组");
    });

    if (failures) {
        std::cout << failures << " 个用例失败\n";
        return 1;
    }
    std::cout << "全部通过\n";
    return 0;
}
