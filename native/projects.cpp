#include "projects.hpp"
#include "project_file_colors.hpp"
#include "project_settings_state.hpp"
#include "settings_transfer.hpp"
#include "settings_schema.hpp"
#include "fsops.hpp"
#include "jdk.hpp"
#include "text.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdio>
#include <initializer_list>
#include <limits>
#include <mutex>
#include <optional>
#include <regex>
#include <set>
#include <string_view>
#include <utility>
#include <span>
#include <vector>

namespace taocode {
namespace {

using project_settings::load_state;
using project_settings::save_state;
using project_settings::recent_limit;
// ponytail: one process-wide lock, including different stores; split by state path
// only if configuration I/O contention matters. No cross-process CAS is promised.
std::mutex store_mutex;


template <class Operation>
auto boundary(Operation&& operation) -> decltype(operation()) {
    try {
        return operation();
    } catch (const WorkspaceError&) {
        throw;
    } catch (const fs::filesystem_error&) {
        fail("IO_ERROR", "The project filesystem operation failed.");
    } catch (const Json::exception&) {
        fail("INVALID_ARGUMENT", "Invalid project request.");
    } catch (const std::exception&) {
        fail("INTERNAL_ERROR", "The project operation could not be completed.");
    }
}



constexpr std::size_t max_run_configs = 40;


bool same_path(const std::string& a, const std::string& b) {
    return equal_name(from_utf8(a).native(), from_utf8(b).native());
}

std::string utc_now() {
    SYSTEMTIME now{};
    GetSystemTime(&now);
    std::array<char, 32> buffer{};
    std::snprintf(buffer.data(), buffer.size(), "%04u-%02u-%02uT%02u:%02u:%02uZ",
                  static_cast<unsigned>(now.wYear), static_cast<unsigned>(now.wMonth),
                  static_cast<unsigned>(now.wDay), static_cast<unsigned>(now.wHour),
                  static_cast<unsigned>(now.wMinute), static_cast<unsigned>(now.wSecond));
    return buffer.data();
}

Json public_state(const Json& document) {
    Json result = {{"recentProjects", document.at("recentProjects")},
                   {"settings", document.at("settings")}, {"lastProject", document.at("lastProject")}};
    if (document.contains("general")) result["general"] = document.at("general");
    for (auto& recent : result.at("recentProjects")) {
        std::error_code error;
        auto path = from_utf8(recent.at("path").get<std::string>());
        path.make_preferred();  // Stored paths use portable '/'; the \\?\ API needs '\'.
        recent["available"] = fs::is_directory(fs::path(api_path(path)), error);
    }
    return result;
}

std::string project_key(const std::string& root) {
    return utf8_path(pin_directory(absolute_path(from_utf8(root), true), Missing::allow).path);
}

std::string existing_project_key(const Json& projects, const std::string& root) {
    for (auto it = projects.begin(); it != projects.end(); ++it) {
        if (same_path(it.key(), root)) return it.key();
    }
    return root;
}

} // namespace

// Source: RecentProjectMetaInfo.activationTimestamp / projectName - the meta fields
// surface in the public state so the welcome screen can sort and label without
// re-reading the project directory.
std::int64_t utc_now_epoch() {
    FILETIME file{};
    GetSystemTimeAsFileTime(&file);
    ULARGE_INTEGER ticks{};
    ticks.LowPart = file.dwLowDateTime;
    ticks.HighPart = file.dwHighDateTime;
    return static_cast<std::int64_t>(ticks.QuadPart / 10000000ULL) - 11644473600LL;
}

// Public mirror of the internal defaults (projects.hpp): tests and any future caller
// assert against the real defaults instead of a hand-copied snapshot that drifts.
Json editor_defaults() { return editor_defaults_impl(); }

Json general_defaults() { return general_defaults_impl(); }

namespace {
// JDT LS `java.configuration.runtimes[].name` 只认 `JavaSE-1.8` / `JavaSE-11` / `JavaSE-17`…
// 这类形式；探测层给过显示名（`17` / `1.8` / `21-ea`）。这里统一归一 —— 归不出 feature
// 就保持原值（校验层已经拦过非法形式，这里只是把历史数据救回来）。
std::string normalize_runtime_name(const std::string& name, const std::string& jdk_home) {
    if (name.rfind("JavaSE-", 0) == 0) return name;
    const std::string version = jdk_home.empty() ? name : jdk::read_version(std::filesystem::path(wide(jdk_home)));
    const int feature = jdk::feature_version(version.empty() ? name : version);
    if (feature <= 0) return name;
    return feature == 8 ? "JavaSE-1.8" : "JavaSE-" + std::to_string(feature);
}
}  // namespace

namespace {
/**
 * 「Gradle JVM」→ 真正的主目录。与 src/gradle.ts 的 `gradleEnvironment` 是同一条规则：
 * `#USE_PROJECT_JDK`（`ExternalSystemJdkUtil.java:52`，也是 `GradleProjectSettings.java:60`
 * 构造时赋的值）或没填 ⇒ 用项目 JDK；填了就用填的那个。
 */
std::string gradle_java_home(const Json& gradle, const std::string& project_jdk_home) {
    const auto chosen = gradle.value("gradleJvm", std::string());
    if (chosen.empty() || chosen == "#USE_PROJECT_JDK") return project_jdk_home;
    return chosen;
}
}  // namespace

/** 用户的 `referencedLibraries` 在前、磁盘派生兜底在后（去重，保持顺序）。 */
Json library_list(const Json& java, const std::vector<std::string>& extra) {
    Json list = Json::array();
    std::set<std::string> seen;
    const auto push = [&list, &seen](const std::string& entry) {
        if (entry.empty() || !seen.insert(entry).second) return;
        list.push_back(entry);
    };
    if (const auto& declared = java.value("referencedLibraries", Json::array()); declared.is_array())
        for (const auto& entry : declared) if (entry.is_string()) push(entry.get<std::string>());
    for (const auto& entry : extra) push(entry);
    return list;
}

/**
 * 没有 Gradle 导入时，用**磁盘上已有的 jar** 兜底当外部类路径 —— 这是"IDEA 能解析外部、我们不能"的
 * 直接修法：IDEA 靠**已经导入过的模型**（模块依赖 = 一堆 jar 路径），我们这边 JDT LS 每次都要重跑
 * Gradle 导入，而那个导入在这些工程上根本跑不完（1.7.10 的 forge 不在 `~/.gradle/caches` 里，
 * 1.16.5 那条是 `mapped_snapshot` 变体、要联网现做）。这些 jar 磁盘上其实都有：
 * `build/rfg/*.jar`（ForgeGradle 反混淆后的 Minecraft/Forge）、`build/libs/*.jar`、`lib/**`。
 *
 * 只回**真实存在**的目录对应的 glob（JDT 的 `referencedLibraries` 收相对工作区的 glob），
 * 免得给语言服务挂一堆指不到东西的模式。
 */
std::vector<std::string> default_referenced_libraries(const fs::path& root) {
    static const char* candidates[] = {
        "build/rfg/**/*.jar",       // ForgeGradle 的 Minecraft/Forge 反混淆产物
        "build/libs/**/*.jar",      // 本工程构建产物
        "build/classes/**",         // 增量编译输出（类目录 JDT 也认）
        "lib/**/*.jar",             // 传统 lib 目录
        "run/**/*.jar",
    };
    std::vector<std::string> globs;
    for (const auto* candidate : candidates) {
        const auto parent = root / fs::path(candidate).begin()->wstring();
        std::error_code code;
        if (fs::exists(parent, code) && !code) globs.emplace_back(candidate);
    }
    // 子工程各有一份 build/rfg（本工程的形状是多子工程仓库）：给一层通配。
    std::error_code code;
    if (fs::exists(root / L"build", code) && !code) globs.emplace_back("**/build/rfg/*.jar");
    return globs;
}

Json java_lsp_settings(const Json& java, const Json& build_tools, const std::vector<std::string>& extra_libraries) {
    // 一律用 `value` 而不是 `at`：这段的调用方是 LSP 配置合成，拿到的是**任意**经过校验的
    // `java` 段，而不是"刚写出来的那一份"。缺字段时 `at` 会抛 JSON 异常 —— 那会在启动语言
    // 服务器的那一刻把 IDE 打崩；缺字段的合理语义是"这一项没有"，不是"整件事失败"。
    Json runtimes = Json::array();
    const auto jdk_home = java.value("jdkHome", std::string());
    if (!jdk_home.empty())
        runtimes.push_back({{"name", normalize_runtime_name(java.value("jdkName", std::string("17")), jdk_home)},
                            {"path", jdk_home}, {"default", true}});
    // 「构建工具 › Gradle」那一栏必须**同时**送到语言服务手里：JDT LS 用 Buildship 自己跑一次
    // Gradle 同步来建工程模型，而它默认拿**自己那个 JRE** 去起 Gradle 守护进程（实测 1.44.0 跑在
    // JRE 21 上）。老 Gradle（6.8.3 只支持到 Java 15）在那个 JVM 上直接起不来 ⇒ 同步从未完成 ⇒
    // 文件不在任何源根里 ⇒ 没有语义补全、没有语义着色。键名按**实际在跑的那份服务器**核对过
    // （org.eclipse.jdt.ls.core_1.44.0.jar 的 Preferences.class 常量池）。
    const auto gradle = build_tools.value("gradle", Json::object());
    Json gradle_import{{"wrapper", {{"enabled", gradle.value("useGradleFrom", std::string("wrapper")) == "wrapper"}}}};
    const auto gradle_path = gradle.value("gradlePath", std::string());
    if (gradle.value("useGradleFrom", std::string("wrapper")) == "path" && !gradle_path.empty())
        gradle_import["home"] = gradle_path;
    const auto gradle_user_home = gradle.value("gradleUserHome", std::string());
    if (!gradle_user_home.empty()) gradle_import["user"] = {{"home", gradle_user_home}};
    if (gradle.value("offline", false)) gradle_import["offline"] = {{"enabled", true}};
    // 外部类路径：用户填的 + 磁盘上真实存在的构建产物（见 default_referenced_libraries 的注释）。
    const auto java_home = gradle_java_home(gradle, jdk_home);
    if (!java_home.empty()) gradle_import["java"] = {{"home", java_home}};
    return {{"java", {{"configuration", {{"runtimes", std::move(runtimes)}}},
                      {"import", {{"gradle", std::move(gradle_import)}}},
                      {"project", {{"sourcePaths", java.value("sourcePaths", Json::array())},
                                   {"outputPath", java.value("outputPath", std::string())},
                                   // 用户的显式列表在前，磁盘派生兜底在后（同一份数组，JDT 全收）。
                                   {"referencedLibraries", library_list(java, extra_libraries)}}}}}};
}

fs::path project_destination(const fs::path& parent, const std::string& name) {
    return boundary([&] {
        const auto component = from_utf8(name);
        validate_component(component.native());
        const auto pinned = pin_directory(parent);
        auto result = pinned.path / component;
        require_absent(result);
        return result;
    });
}

fs::path create_project(const fs::path& parent, const std::string& name, const std::string& kind) {
    return boundary([&] {
        if (kind != "empty" && kind != "cpp" && kind != "java" && kind != "spring-boot" &&
            kind != "maven" && kind != "gradle" && kind != "kotlin" && kind != "python" &&
            kind != "node" && kind != "vue" && kind != "react")
            fail("INVALID_TEMPLATE", "The selected project template is not supported.");
        const auto component = from_utf8(name);
        validate_component(component.native());
        auto pinned = pin_directory(parent);
        auto destination = pinned.path / component;
        require_absent(destination);
        auto temporary = temporary_object(pinned.path, true);
        // Children are destroyed before their owned directory on every failure path.
        std::vector<OwnedObject> children;
        std::vector<OwnedObject> directories;
        children.reserve(8);
        directories.reserve(4);
        if (kind == "cpp") {
            constexpr std::string_view cmake =
                "cmake_minimum_required(VERSION 3.20)\n"
                "project(TaoProject LANGUAGES CXX)\n\n"
                "add_executable(app main.cpp)\n"
                "target_compile_features(app PRIVATE cxx_std_20)\n";
            constexpr std::string_view main_cpp =
                "#include <iostream>\n\n"
                "int main() {\n"
                "    std::cout << \"Hello, TaoCode!\\n\";\n"
                "    return 0;\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"CMakeLists.txt"));
            write_and_flush(children.back().handle.get(), cmake);
            children.push_back(new_file(temporary.path / L"main.cpp"));
            write_and_flush(children.back().handle.get(), main_cpp);
        } else if (kind == "java") {
            directories.push_back(new_directory(temporary.path / L"src"));
            constexpr std::string_view main_java =
                "public class Main {\n"
                "    public static void main(String[] args) {\n"
                "        System.out.println(\"Hello, TaoCode!\");\n"
                "    }\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"src" / L"Main.java"));
            write_and_flush(children.back().handle.get(), main_java);
        } else if (kind == "spring-boot") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"java"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"resources"));
            constexpr std::string_view pom_xml =
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"\n"
                "         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n"
                "         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 "
                "http://maven.apache.org/xsd/maven-4.0.0.xsd\">\n"
                "    <modelVersion>4.0.0</modelVersion>\n"
                "    <parent>\n"
                "        <groupId>org.springframework.boot</groupId>\n"
                "        <artifactId>spring-boot-starter-parent</artifactId>\n"
                "        <version>3.2.0</version>\n"
                "    </parent>\n"
                "    <groupId>com.example</groupId>\n"
                "    <artifactId>demo</artifactId>\n"
                "    <version>0.0.1-SNAPSHOT</version>\n"
                "    <dependencies>\n"
                "        <dependency>\n"
                "            <groupId>org.springframework.boot</groupId>\n"
                "            <artifactId>spring-boot-starter-web</artifactId>\n"
                "        </dependency>\n"
                "    </dependencies>\n"
                "</project>\n";
            constexpr std::string_view application_java =
                "package com.example.demo;\n\n"
                "import org.springframework.boot.SpringApplication;\n"
                "import org.springframework.boot.autoconfigure.SpringBootApplication;\n\n"
                "@SpringBootApplication\n"
                "public class DemoApplication {\n"
                "    public static void main(String[] args) {\n"
                "        SpringApplication.run(DemoApplication.class, args);\n"
                "    }\n"
                "}\n";
            constexpr std::string_view application_properties =
                "server.port=8080\n";
            children.push_back(new_file(temporary.path / L"pom.xml"));
            write_and_flush(children.back().handle.get(), pom_xml);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"java" / L"DemoApplication.java"));
            write_and_flush(children.back().handle.get(), application_java);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"resources" / L"application.properties"));
            write_and_flush(children.back().handle.get(), application_properties);
        } else if (kind == "maven") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"java"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test" / L"java"));
            constexpr std::string_view pom_xml =
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"\n"
                "         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n"
                "         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 "
                "http://maven.apache.org/xsd/maven-4.0.0.xsd\">\n"
                "    <modelVersion>4.0.0</modelVersion>\n"
                "    <groupId>com.example</groupId>\n"
                "    <artifactId>demo</artifactId>\n"
                "    <version>1.0-SNAPSHOT</version>\n"
                "    <properties>\n"
                "        <maven.compiler.source>17</maven.compiler.source>\n"
                "        <maven.compiler.target>17</maven.compiler.target>\n"
                "    </properties>\n"
                "</project>\n";
            constexpr std::string_view main_java =
                "package com.example;\n\n"
                "public class Main {\n"
                "    public static void main(String[] args) {\n"
                "        System.out.println(\"Hello, TaoCode!\");\n"
                "    }\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"pom.xml"));
            write_and_flush(children.back().handle.get(), pom_xml);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"java" / L"Main.java"));
            write_and_flush(children.back().handle.get(), main_java);
        } else if (kind == "gradle") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"java"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test" / L"java"));
            constexpr std::string_view build_gradle =
                "plugins {\n"
                "    id 'java'\n"
                "}\n\n"
                "group = 'com.example'\n"
                "version = '1.0-SNAPSHOT'\n\n"
                "java {\n"
                "    sourceCompatibility = JavaVersion.VERSION_17\n"
                "    targetCompatibility = JavaVersion.VERSION_17\n"
                "}\n\n"
                "repositories {\n"
                "    mavenCentral()\n"
                "}\n\n"
                "dependencies {\n"
                "}\n";
            constexpr std::string_view main_java =
                "package com.example;\n\n"
                "public class Main {\n"
                "    public static void main(String[] args) {\n"
                "        System.out.println(\"Hello, TaoCode!\");\n"
                "    }\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"build.gradle"));
            write_and_flush(children.back().handle.get(), build_gradle);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"java" / L"Main.java"));
            write_and_flush(children.back().handle.get(), main_java);
        } else if (kind == "kotlin") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"kotlin"));
            constexpr std::string_view build_gradle_kts =
                "plugins {\n"
                "    kotlin(\"jvm\") version \"1.9.20\"\n"
                "}\n\n"
                "group = \"com.example\"\n"
                "version = \"1.0-SNAPSHOT\"\n\n"
                "repositories {\n"
                "    mavenCentral()\n"
                "}\n\n"
                "dependencies {\n"
                "    implementation(kotlin(\"stdlib\"))\n"
                "}\n";
            constexpr std::string_view main_kt =
                "package com.example\n\n"
                "fun main() {\n"
                "    println(\"Hello, TaoCode!\")\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"build.gradle.kts"));
            write_and_flush(children.back().handle.get(), build_gradle_kts);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"kotlin" / L"Main.kt"));
            write_and_flush(children.back().handle.get(), main_kt);
        } else if (kind == "python") {
            constexpr std::string_view main_py =
                "def main():\n"
                "    print(\"Hello, TaoCode!\")\n\n"
                "if __name__ == \"__main__\":\n"
                "    main()\n";
            constexpr std::string_view requirements_txt =
                "# Add your dependencies here\n"
                "# Example:\n"
                "# requests==2.31.0\n";
            children.push_back(new_file(temporary.path / L"main.py"));
            write_and_flush(children.back().handle.get(), main_py);
            children.push_back(new_file(temporary.path / L"requirements.txt"));
            write_and_flush(children.back().handle.get(), requirements_txt);
        } else if (kind == "node") {
            constexpr std::string_view package_json =
                "{\n"
                "  \"name\": \"demo\",\n"
                "  \"version\": \"1.0.0\",\n"
                "  \"description\": \"\",\n"
                "  \"main\": \"index.js\",\n"
                "  \"scripts\": {\n"
                "    \"start\": \"node index.js\"\n"
                "  },\n"
                "  \"keywords\": [],\n"
                "  \"author\": \"\",\n"
                "  \"license\": \"ISC\"\n"
                "}\n";
            constexpr std::string_view index_js =
                "console.log(\"Hello, TaoCode!\");\n";
            children.push_back(new_file(temporary.path / L"package.json"));
            write_and_flush(children.back().handle.get(), package_json);
            children.push_back(new_file(temporary.path / L"index.js"));
            write_and_flush(children.back().handle.get(), index_js);
        } else if (kind == "vue") {
            directories.push_back(new_directory(temporary.path / L"src"));
            constexpr std::string_view package_json =
                "{\n"
                "  \"name\": \"demo\",\n"
                "  \"version\": \"0.0.0\",\n"
                "  \"type\": \"module\",\n"
                "  \"scripts\": {\n"
                "    \"dev\": \"vite\",\n"
                "    \"build\": \"vite build\",\n"
                "    \"preview\": \"vite preview\"\n"
                "  },\n"
                "  \"dependencies\": {\n"
                "    \"vue\": \"^3.4.0\"\n"
                "  },\n"
                "  \"devDependencies\": {\n"
                "    \"@vitejs/plugin-vue\": \"^5.0.0\",\n"
                "    \"vite\": \"^5.0.0\"\n"
                "  }\n"
                "}\n";
            constexpr std::string_view vite_config_js =
                "import { defineConfig } from 'vite'\n"
                "import vue from '@vitejs/plugin-vue'\n\n"
                "export default defineConfig({\n"
                "  plugins: [vue()],\n"
                "})\n";
            constexpr std::string_view index_html =
                "<!DOCTYPE html>\n"
                "<html lang=\"zh-CN\">\n"
                "<head>\n"
                "    <meta charset=\"UTF-8\">\n"
                "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
                "    <title>Demo App</title>\n"
                "</head>\n"
                "<body>\n"
                "    <div id=\"app\"></div>\n"
                "    <script type=\"module\" src=\"/src/main.js\"></script>\n"
                "</body>\n"
                "</html>\n";
            constexpr std::string_view main_js =
                "import { createApp } from 'vue'\n"
                "import App from './App.vue'\n\n"
                "createApp(App).mount('#app')\n";
            constexpr std::string_view app_vue =
                "<template>\n"
                "  <div>\n"
                "    <h1>Hello, TaoCode!</h1>\n"
                "  </div>\n"
                "</template>\n\n"
                "<script setup>\n"
                "</script>\n\n"
                "<style>\n"
                "#app {\n"
                "  font-family: Avenir, Helvetica, Arial, sans-serif;\n"
                "  text-align: center;\n"
                "  color: #2c3e50;\n"
                "  margin-top: 60px;\n"
                "}\n"
                "</style>\n";
            children.push_back(new_file(temporary.path / L"package.json"));
            write_and_flush(children.back().handle.get(), package_json);
            children.push_back(new_file(temporary.path / L"vite.config.js"));
            write_and_flush(children.back().handle.get(), vite_config_js);
            children.push_back(new_file(temporary.path / L"index.html"));
            write_and_flush(children.back().handle.get(), index_html);
            children.push_back(new_file(temporary.path / L"src" / L"main.js"));
            write_and_flush(children.back().handle.get(), main_js);
            children.push_back(new_file(temporary.path / L"src" / L"App.vue"));
            write_and_flush(children.back().handle.get(), app_vue);
        } else if (kind == "react") {
            directories.push_back(new_directory(temporary.path / L"src"));
            constexpr std::string_view package_json =
                "{\n"
                "  \"name\": \"demo\",\n"
                "  \"version\": \"0.0.0\",\n"
                "  \"type\": \"module\",\n"
                "  \"scripts\": {\n"
                "    \"dev\": \"vite\",\n"
                "    \"build\": \"vite build\",\n"
                "    \"preview\": \"vite preview\"\n"
                "  },\n"
                "  \"dependencies\": {\n"
                "    \"react\": \"^18.2.0\",\n"
                "    \"react-dom\": \"^18.2.0\"\n"
                "  },\n"
                "  \"devDependencies\": {\n"
                "    \"@vitejs/plugin-react\": \"^4.2.0\",\n"
                "    \"vite\": \"^5.0.0\"\n"
                "  }\n"
                "}\n";
            constexpr std::string_view vite_config_js =
                "import { defineConfig } from 'vite'\n"
                "import react from '@vitejs/plugin-react'\n\n"
                "export default defineConfig({\n"
                "  plugins: [react()],\n"
                "})\n";
            constexpr std::string_view index_html =
                "<!DOCTYPE html>\n"
                "<html lang=\"zh-CN\">\n"
                "<head>\n"
                "    <meta charset=\"UTF-8\">\n"
                "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
                "    <title>Demo App</title>\n"
                "</head>\n"
                "<body>\n"
                "    <div id=\"root\"></div>\n"
                "    <script type=\"module\" src=\"/src/main.jsx\"></script>\n"
                "</body>\n"
                "</html>\n";
            constexpr std::string_view main_jsx =
                "import React from 'react'\n"
                "import ReactDOM from 'react-dom/client'\n"
                "import App from './App.jsx'\n\n"
                "ReactDOM.createRoot(document.getElementById('root')).render(\n"
                "  <React.StrictMode>\n"
                "    <App />\n"
                "  </React.StrictMode>,\n"
                ")\n";
            constexpr std::string_view app_jsx =
                "function App() {\n"
                "  return (\n"
                "    <div style={{ textAlign: 'center', marginTop: '60px' }}>\n"
                "      <h1>Hello, TaoCode!</h1>\n"
                "    </div>\n"
                "  )\n"
                "}\n\n"
                "export default App\n";
            children.push_back(new_file(temporary.path / L"package.json"));
            write_and_flush(children.back().handle.get(), package_json);
            children.push_back(new_file(temporary.path / L"vite.config.js"));
            write_and_flush(children.back().handle.get(), vite_config_js);
            children.push_back(new_file(temporary.path / L"index.html"));
            write_and_flush(children.back().handle.get(), index_html);
            children.push_back(new_file(temporary.path / L"src" / L"main.jsx"));
            write_and_flush(children.back().handle.get(), main_jsx);
            children.push_back(new_file(temporary.path / L"src" / L"App.jsx"));
            write_and_flush(children.back().handle.get(), app_jsx);
        }
        // Windows directory publication must not depend on open child handles.
        for (auto& child : children) child.handle.reset();
        for (auto& dir : directories) dir.handle.reset();
        require_absent(destination);
        rename_handle(temporary.handle.get(), destination, false);
        for (auto& child : children) child.cleanup = false;
        for (auto& dir : directories) dir.cleanup = false;
        temporary.cleanup = false;
        return destination;
    });
}

ProjectStore::ProjectStore(fs::path state_file)
    : state_file_(boundary([&] {
          auto path = absolute_path(std::move(state_file));
          if (path.filename().empty()) fail("INVALID_PATH", "The configuration needs a file name.");
          validate_component(path.filename().native());
          return path;
      })) {}

Json ProjectStore::state() {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        const auto loaded = load_state(state_file_);
        return public_state(loaded.document);
    });
}

void ProjectStore::opened(const Json& workspace) {
    boundary([&] {
        std::lock_guard lock(store_mutex);
        if (!workspace.is_object() || !workspace.contains("name") || !workspace.at("name").is_string() ||
            workspace.at("name").get_ref<const std::string&>().empty() ||
            !valid_utf8(workspace.at("name").get_ref<const std::string&>()) ||
            !workspace.contains("root") || !workspace.at("root").is_string() ||
            !workspace.contains("entries") || !workspace.at("entries").is_array())
            fail("INVALID_ARGUMENT", "opened requires the result of Workspace::open.");
        const auto pinned = pin_directory(absolute_path(from_utf8(workspace.at("root").get<std::string>()), true));
        const auto root = utf8_path(pinned.path);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        // Source: RecentProjectMetaInfo + RecentProjectsManagerBase.addRecentProject
        // sets activationTimestamp and displayName when the project is opened. We
        // stamp both here so the welcome screen can render branch/title without
        // re-reading the .idea directory (and so a future sync with a non-local
        // path - WSL or remote - keeps the cached fields).
        Json activation = Json::object();
        activation["name"] = workspace.at("name");
        activation["path"] = root;
        activation["lastOpened"] = utc_now();
        activation["activationTimestamp"] = static_cast<int64_t>(utc_now_epoch());
        if (workspace.contains("displayName") && workspace.at("displayName").is_string()
            && !workspace.at("displayName").get<std::string>().empty()) {
            activation["displayName"] = workspace.at("displayName");
        }
        if (workspace.contains("projectName") && workspace.at("projectName").is_string()
            && !workspace.at("projectName").get<std::string>().empty()) {
            activation["projectName"] = workspace.at("projectName");
        }
        if (workspace.contains("branch") && workspace.at("branch").is_string()
            && !workspace.at("branch").get<std::string>().empty()) {
            activation["branchName"] = workspace.at("branch");
        }
        Json recents = Json::array({activation});
        for (const auto& recent : next.at("recentProjects")) {
            if (recents.size() < recent_limit && !same_path(recent.at("path").get<std::string>(), root))
                recents.push_back(recent);
        }
        next["recentProjects"] = std::move(recents);
        next["lastProject"] = root;
        save_state(state_file_, loaded, next);
    });
}

void ProjectStore::closed() {
    boundary([&] {
        std::lock_guard lock(store_mutex);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        next["lastProject"] = nullptr;
        save_state(state_file_, loaded, next);
    });
}

Json ProjectStore::forget(const std::string& path) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        // Forgetting also works when the directory is gone, inaccessible or now a link.
        const auto key = utf8_path(absolute_path(from_utf8(path), true));
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        Json recents = Json::array();
        for (const auto& recent : next.at("recentProjects")) {
            if (!same_path(recent.at("path").get<std::string>(), key)) recents.push_back(recent);
        }
        next["recentProjects"] = std::move(recents);
        if (next.at("lastProject").is_string() && same_path(next.at("lastProject").get<std::string>(), key))
            next["lastProject"] = nullptr;
        auto result = public_state(next);
        save_state(state_file_, loaded, next);
        return result;
    });
}

// Source: RecentProjectsManagerBase.removePath (line 270-279) plus
// removePathsFromGroups (line 288-301). The IDE calls removePath once per path
// under one stateLock and fires fireChangeEvent() at the end; we replicate that
// by computing the removal set up front, applying the diff in a single state
// mutation, and returning the public state once. The path on disk is never
// touched — IDE's removePath also never deletes the directory.
Json ProjectStore::forget_many(const std::vector<std::string>& paths) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        // Canonicalise each input to its preferred form before comparing, then
        // match with the same_path predicate used by ProjectStore::forget so a
        // Windows drive-letter or casing variant still drops the right entry.
        std::vector<std::string> keys;
        keys.reserve(paths.size());
        for (const auto& path : paths) {
            if (path.empty()) continue;
            try {
                keys.push_back(utf8_path(absolute_path(from_utf8(path), true)));
            } catch (const WorkspaceError&) {
                // Bad path -> skip; the singular forget() fails the whole call,
                // but the batch call has to tolerate one bad entry.
            }
        }
        auto matches_any = [&](const std::string& candidate) {
            for (const auto& key : keys) if (same_path(candidate, key)) return true;
            return false;
        };
        if (keys.empty()) {
            return public_state(next);
        }
        Json recents = Json::array();
        for (const auto& recent : next.at("recentProjects")) {
            if (!matches_any(recent.at("path").get<std::string>())) recents.push_back(recent);
        }
        next["recentProjects"] = std::move(recents);
        if (next.at("lastProject").is_string()
            && matches_any(next.at("lastProject").get<std::string>())) {
            next["lastProject"] = nullptr;
        }
        auto result = public_state(next);
        save_state(state_file_, loaded, next);
        return result;
    });
}

namespace {
// The forward declarations of both functions live in the anonymous namespace opened at
// the top of this file, so the definitions have to be in that same namespace: an
// anonymous namespace injects its members into the enclosing one, and a second entity
// with an identical signature at `taocode` scope would make every later call ambiguous
// (MSVC C2668). Re-opening the unnamed namespace here refers to the same one.
//
// Source: platform/ide-core/src/com/intellij/ide/GeneralSettings.kt:227-266
// (GeneralSettingsState defaults) — TaoCode stores the same application-level
// component under the "general" key of its state document (IDEA writes
// ide.general.xml). Missing keys take the data-class defaults, like IDEA's
// noStateLoaded() -> loadState(GeneralSettingsState()).
}  // namespace

Json ProjectStore::update_general(const Json& patch) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        validate_general_patch(patch);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        if (!next.contains("general") || !next.at("general").is_object())
            next["general"] = general_defaults_impl();
        next["general"].update(patch);
        // GeneralSettings.inactiveTimeout getter/setter runs the value through
        // SAVE_FILES_AFTER_IDLE_SEC.fit (GeneralSettings.kt:193-202).
        auto& timeout = next.at("general").at("inactiveTimeout");
        timeout = std::max(1, std::min(300, timeout.get<int>()));
        auto result = next.at("general");
        save_state(state_file_, loaded, next);
        return result;
    });
}

Json ProjectStore::update_settings(const Json& patch) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        validate_editor_patch(patch);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        next["settings"].update(patch);
        auto result = next.at("settings");
        save_state(state_file_, loaded, next);
        return result;
    });
}

Json ProjectStore::project_settings(const std::string& root) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        const auto key = project_key(root);
        const auto loaded = load_state(state_file_);
        const auto& projects = loaded.document.at("perProject");
        const auto found = projects.find(existing_project_key(projects, key));
        // A project saved before a setting existed (or storing it as null) reads back
        // with the defaults for the missing keys, recursively.
        Json result = project_defaults();
        if (found != projects.end()) fill_defaults(result, *found);
        read_project_file_colors(from_utf8(key), result);
        return result;
    });
}

Json ProjectStore::export_settings(const fs::path& file) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        return settings_transfer::export_archive(load_state(state_file_).document, file);
    });
}

Json ProjectStore::import_settings(const fs::path& file) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        const auto imported = settings_transfer::read_archive(file);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        // 只换这三段：**最近项目列表与 lastProject 保持不动**（IDEA 的导入同样不碰最近的工程）。
        for (const char* section : {"settings", "general", "perProject"})
            if (imported.contains(section)) next[section] = imported.at(section);
        save_state(state_file_, loaded, next);
        return public_state(next);
    });
}

Json ProjectStore::reset_settings() {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        auto loaded = load_state(state_file_);
        auto next = empty_document();
        // 恢复默认同样保留最近项目（`RestoreDefaultSettingsAction` 复位的是设置，不是最近列表）。
        next["recentProjects"] = loaded.document.value("recentProjects", Json::array());
        next["lastProject"] = loaded.document.value("lastProject", Json(nullptr));
        save_state(state_file_, loaded, next);
        return public_state(next);
    });
}

Json ProjectStore::update_project_settings(const std::string& root, const Json& patch) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        validate_project_patch(patch);
        const auto key = project_key(root);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        auto& projects = next["perProject"];
        const auto existing = existing_project_key(projects, key);
        auto result = project_defaults();
        const Json legacy = projects.contains(existing) ? projects.at(existing) : Json::object();
        fill_defaults(result, legacy);
        read_project_file_colors(from_utf8(key), result);
        result.merge_patch(patch);
        projects.erase(existing);
        projects[key] = result;
        // File colors now belong to IDEA XML, not an application JSON shadow copy.
        projects[key].erase("localFileColors");
        projects[key].erase("fileColors");
        auto prepared = project_settings::prepare_state(state_file_, loaded, next);
        save_project_settings_layers(from_utf8(key), legacy, patch,
                                     [&] { project_settings::commit_state(prepared); });
        return result;
    });
}

} // namespace taocode
