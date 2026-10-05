// 「让语言服务看到外部类路径与源根」这一条线的原生回归（native/java_lsp_paths.cpp）。
//
// 判据分三档，与真机三次探针的结论一一对应：
//   ① 物化出来的 `.classpath` 里真的有源根条目与 lib 条目 —— 否则 JDT 对**非工程文件**只做语法检查
//      （真机诊断原文 `… is a non-project file, only syntax errors are reported`），外部类一律解析不了；
//   ② 单模块工程（没填 `linkedProjects`）也物化，而且 lib 条目不为空 —— 这一档是本文件新加的：
//      以前只有"链接了子工程"才有物化，而根工程的 glob 本来就没有 `<工程名>/` 前缀，
//      那条 `continue` 会把所有 lib 条目丢光；
//   ③ workspace folder = 建了工程的那几个目录，不是"源根/类路径的第一段" —— 单模块工程的类路径兜底
//      是根相对的（`build/libs/**/*.jar`），按第一段派生会得到 `build`，LSP 的 `rootUri` 整个指到
//      `build/`，工程自己的 `src/**` 反而落在工作区之外。
//
// 上游依据（IDEA 那一侧，形状对照）：
//   platform/projectModel-api/src/com/intellij/openapi/roots/OrderRootType.java:34（CLASSES）/ :44（SOURCES）
//   platform/projectModel-api/src/com/intellij/openapi/roots/ModuleRootModificationUtil.java:36-38（内容根）
//   platform/projectModel-api/src/com/intellij/openapi/roots/ContentEntry.java:63（内容根下的 SourceFolder）
#include "project_test_support.hpp"

#include "java_lsp_paths.hpp"

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::java_lsp_model;
using taocode::test::check;
using taocode::test::get;
using taocode::test::put;
using taocode::test::Report;
using taocode::test::TempRoot;
using taocode::test::text;

/** 一个链接了 `mod-a` 的多子工程工作区：AE2 那种形状（根下堆着别的工程 + 产物在子工程里）。 */
void build_multi_project(const fs::path& root) {
    fs::create_directories(root / "mod-a" / "src" / "main" / "java");
    fs::create_directories(root / "mod-a" / "src" / "test" / "java");
    fs::create_directories(root / "mod-a" / "build" / "rfg");
    fs::create_directories(root / "mod-a" / "lib");
    fs::create_directories(root / "refs" / "sub");
    put(root / "mod-a" / "build" / "rfg" / "recompiled_minecraft-1.7.10.jar", "x");
    put(root / "mod-a" / "build" / "rfg" / "srg_patched_minecraft-sources.jar", "x");
    put(root / "mod-a" / "lib" / "helper.jar", "x");
}

Json linked_gradle(bool importing) {
    return {{"enabled", importing}, {"linkedProjects", Json::array({"mod-a"})}};
}

bool mentions(const std::string& haystack, const std::string& needle) {
    return haystack.find(needle) != std::string::npos;
}
}  // namespace

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    Report report;

    report.run("链接了子工程：Eclipse 工程落在子工程目录里，源根与 jar 都在", [&] {
        TempRoot temp;
        const auto root = temp.path / L"workspace";
        fs::create_directories(root);
        build_multi_project(root);
        const auto model = java_lsp_model(root, Json::object(), {{"gradle", linked_gradle(false)}});
        check(model.files == 2, "第一次要写 .project 与 .classpath 两个文件，得到 " + std::to_string(model.files));
        const auto classpath = get(root / "mod-a" / ".classpath");
        check(mentions(classpath, "kind=\"src\" path=\"src/main/java\""), "源根要落成工程内相对路径：" + classpath);
        check(mentions(classpath, "recompiled_minecraft-1.7.10.jar"), "jar 要落成 lib 条目：" + classpath);
        check(mentions(classpath, "sourcepath="), "源码 jar 要配成 sourcepath：" + classpath);
        check(mentions(classpath, "JRE_CONTAINER"), "JRE 容器要有");
        check(!fs::exists(root / ".classpath"), "没链接的根目录不该被物化");
        check(mentions(get(root / "mod-a" / ".project"), "<name>mod-a</name>"), "工程名取目录名");
        // 已有配置不覆盖（不覆盖用户自己的 Eclipse 工程描述）。
        check(java_lsp_model(root, Json::object(), {{"gradle", linked_gradle(false)}}).files == 0,
              "第二次不该再写");
    });

    report.run("单模块工程：工作区根自己就是那个工程（源根 + lib 都要有）", [&] {
        TempRoot temp;
        const auto root = temp.path / L"single";
        fs::create_directories(root / L"src" / L"main" / L"java");
        fs::create_directories(root / L"build" / L"libs");
        fs::create_directories(root / L"build" / L"classes");
        put(root / L"build" / L"libs" / L"single-1.0.jar", "x");
        const auto model = java_lsp_model(root, Json::object(), {{"gradle", {{"enabled", false}}}});
        check(model.files == 2, "根目录要给 .project 与 .classpath，得到 " + std::to_string(model.files));
        const auto classpath = get(root / ".classpath");
        check(mentions(classpath, "kind=\"src\" path=\"src/main/java\""), "源根要落成工程内相对路径：" + classpath);
        check(mentions(classpath, "single-1.0.jar"), "根工程的 jar 也要落成 lib 条目（根相对 glob）：" + classpath);
        check(model.project_dirs.empty(), "工程就是根时不要声明 workspace folder（保持默认的根）");
    });

    report.run("单模块工程的 workspace folder 不该被派生成 build/", [&] {
        TempRoot temp;
        const auto root = temp.path / L"single2";
        fs::create_directories(root / L"src" / L"main" / L"java");
        fs::create_directories(root / L"build" / L"libs");
        const auto model = java_lsp_model(root, Json::object(), {{"gradle", {{"enabled", false}}}});
        check(model.project_dirs.empty(), "没有链接的子工程 ⇒ 声明零个（原来按第一段会得到 build）");
        const auto& libraries = model.settings.at("java").at("project").at("referencedLibraries");
        // `build/libs` 存在就只回它那一条：`build/classes`、`lib`、`run` 都不在这张夹具里。
        check(libraries.is_array() && libraries.size() == 1, "只回真实存在的目录，得到 " +
              std::to_string(libraries.size()) + " 条");
        check(libraries[0].get<std::string>() == "build/libs/**/*.jar",
              "根工程的类路径兜底要走同一张表：" + libraries[0].dump());
    });

    report.run("导入开着时不动磁盘，也不声明 workspace folder（交给 Buildship）", [&] {
        TempRoot temp;
        const auto root = temp.path / L"multi";
        fs::create_directories(root);
        build_multi_project(root);
        const auto model = java_lsp_model(root, Json::object(), {{"gradle", linked_gradle(true)}});
        check(model.files == 0, "导入开着时不物化");
        check(!fs::exists(root / "mod-a" / ".project"), "导入开着时不写 .project");
        check(model.project_dirs.empty(), "导入开着时不收窄 workspace folder");
        const auto& gradle = model.settings.at("java").at("import").at("gradle");
        check(gradle.at("enabled") == true, "java.import.gradle.enabled 仍然是开");
        // 导入开着时才发 java.import.exclusions（"只导入链接的子工程"）。
        check(model.settings.at("java").at("import").contains("exclusions"), "导入开着时要有 exclusions");
    });

    report.run("关掉导入时不下发 exclusions（它会挡住 JDT 自己的扫描）", [&] {
        TempRoot temp;
        const auto root = temp.path / L"multi2";
        fs::create_directories(root);
        build_multi_project(root);
        const auto model = java_lsp_model(root, Json::object(), {{"gradle", linked_gradle(false)}});
        check(!model.settings.at("java").at("import").contains("exclusions"), "关导入时不该有 exclusions");
        check(model.project_dirs == std::vector<std::string>{"mod-a"}, "workspace folder = 建了工程的目录");
        const auto& source_paths = model.settings.at("java").at("project").at("sourcePaths");
        // 夹具里建了 `mod-a/src/main/java` 与 `mod-a/src/test/java`，`src` 本身也跟着存在 ⇒ 3 条。
        check(source_paths.is_array() && source_paths.size() == 3, "源根三条都要下发，得到 " +
              std::to_string(source_paths.size()) + " 条：" + source_paths.dump());
        check(mentions(source_paths[0].get<std::string>(), "mod-a/src/main/java"), "源根是子工程相对：" +
              source_paths[0].dump());
    });

    report.run("磁盘上没有产物与源根时不硬造（指不到东西的模式不进）", [&] {
        TempRoot temp;
        const auto root = temp.path / L"bare";
        fs::create_directories(root);
        fs::create_directories(root / L"mod-a");
        const auto model = java_lsp_model(root, Json::object(), {{"gradle", linked_gradle(false)}});
        const auto& libraries = model.settings.at("java").at("project").at("referencedLibraries");
        check(libraries.is_array() && libraries.empty(), "空的子工程不该带出任何类路径模式");
        check(model.settings.at("java").at("project").at("sourcePaths").is_array() &&
                  model.settings.at("java").at("project").at("sourcePaths").empty(),
              "空的子工程不该带出源根");
        // 空的子工程仍然要建工程（否则它的文件是"non-project file"）——但**工作区根**没有源根也没有
        // jar 时不能建：那不是个 Java 工程，不该在人家目录里丢两个 Eclipse 文件。
        TempRoot single;
        const auto plain = single.path / L"plain";
        fs::create_directories(plain / L"docs");
        check(java_lsp_model(plain, Json::object(), {{"gradle", {{"enabled", false}}}}).files == 0,
              "既没源根也没 jar 的目录不该被物化");
        check(!fs::exists(plain / ".classpath"), "不该写出 .classpath");
    });

    report.run("linkedProjects 指向工作区之外时不写（写只能落在工作区内）", [&] {
        TempRoot temp;
        const auto root = temp.path / L"escape";
        fs::create_directories(root);
        fs::create_directories(temp.path / L"outside" / L"mod-a" / L"src" / L"main" / L"java");
        const Json escaping{{"enabled", false}, {"linkedProjects", Json::array({"../outside/mod-a"})}};
        check(java_lsp_model(root, Json::object(), {{"gradle", escaping}}).files == 0,
              "工作区之外的目录不该被物化");
        check(!fs::exists(temp.path / L"outside" / L"mod-a" / L".project"), "不该在根之外留下 .project");
    });

    return report.summary();
}
