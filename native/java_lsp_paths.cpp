#include "java_lsp_paths.hpp"

#include <algorithm>
#include <set>

#include "fsops.hpp"
#include "text.hpp"

namespace taocode {

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
 * 导入范围：IDEA 只导入**链接的**子工程（项目 `.idea/gradle.xml` 里 `linkedProjects` 那几个），
 * 而 JDT 的 Buildship 会把工作区根下**所有** Gradle 工程都拉进来同步 —— 在"一个仓库里几十个
 * 子工程"的形状下，这既慢（每次同步 ~75s）又会把无关工程（参考源码副本）的失败堆进日志。
 * 这里按未链接的顶层目录派生 `java.import.exclusions`（键名在随发行那份 JDT 1.44.0 的
 * `Preferences` 常量里核对过：`java.import.exclusions`），语义就是 IDA 的那句"只导入链接的工程"。
 *
 * 没填 `linkedProjects` 时**不排除任何东西**（保持服务器自己的扫描行为，不擅自缩小范围）。
 */
/**
 * 源根：IDEA 的源根是 Gradle 导入算出来的；我们没有可用导入时，就从**磁盘布局**推一把 ——
 * 链接的子工程里真实存在的 `src/main/java`、`src/test/java`、`src`（含资源目录）。
 * 这解决的是"文件不在任何源根里 ⇒ 语言服务连 definitionProvider 都不声明"（真机探针里
 * `lsp.request definition` 回 `available:false` 就是这条），也是"外部的类解析不了"的另一半：
 * 源根 + 类路径（见 default_referenced_libraries）两件都齐了，JDT 才建得出 Java 工程。
 */
std::vector<std::string> default_source_paths(const fs::path& root, const Json& gradle) {
    std::vector<std::string> paths;
    const auto& linked = gradle.contains("linkedProjects") ? gradle.at("linkedProjects") : Json();
    if (!linked.is_array() || linked.empty()) return paths;
    static const char* suffixes[] = {"src/main/java", "src/test/java", "src/main/resources", "src"};
    for (const auto& entry : linked) {
        if (!entry.is_string()) continue;
        const auto project = entry.get<std::string>();
        for (const auto* suffix : suffixes) {
            const auto candidate = root / from_utf8(project) / from_utf8(std::string(suffix));
            std::error_code code;
            if (fs::is_directory(candidate, code) && !code) paths.push_back(project + "/" + suffix);
        }
    }
    return paths;
}

std::vector<std::string> import_exclusions(const fs::path& root, const Json& gradle) {
    std::vector<std::string> exclusions;
    const auto& linked = gradle.contains("linkedProjects") ? gradle.at("linkedProjects") : Json();
    if (!linked.is_array() || linked.empty()) return exclusions;
    std::set<std::string> linked_tops;
    for (const auto& entry : linked) {
        if (!entry.is_string()) continue;
        const auto text = entry.get<std::string>();
        const auto slash = text.find_first_of("/\\");
        linked_tops.insert(slash == std::string::npos ? text : text.substr(0, slash));
    }
    if (linked_tops.empty()) return exclusions;
    std::error_code code;
    for (const auto& item : fs::directory_iterator(root, code)) {
        if (code) break;
        if (!item.is_directory(code) || code) continue;
        const auto name = utf8_path(item.path().filename());
        if (linked_tops.count(name)) continue;
        // 这几类不是工程目录，JDT 本来也不会当 Gradle 工程导入，不写进模式（免得模式表变噪音）。
        if (name == ".git" || name == ".idea" || name == ".gradle" || name == "build" || name == "out") continue;
        exclusions.push_back("**/" + name + "/**");
    }
    std::sort(exclusions.begin(), exclusions.end());
    return exclusions;
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
std::vector<std::string> default_referenced_libraries(const fs::path& root, const Json& gradle) {
    std::vector<std::string> globs;
    // **按链接的子工程派生**（不是按工作区根）：这个仓库的形状是"根目录下一堆子工程，产物在
    // `<子工程>/build/rfg|libs`"。真机诊断抓到过按根判断的版本：`fs::exists(root/"build")` 为假
    // ⇒ 一条都没挂上（日志里"类路径兜底 0 条"）。
    const auto& linked = gradle.contains("linkedProjects") ? gradle.at("linkedProjects") : Json();
    if (!linked.is_array() || linked.empty()) {
        // 没链接信息：退回按工作区根判一次（单体工程仍然可用）。
        std::error_code code;
        if (fs::exists(root / L"build", code) && !code) globs.emplace_back("build/**/*.jar");
        if (fs::exists(root / L"lib", code) && !code) globs.emplace_back("lib/**/*.jar");
        return globs;
    }
    static const char* candidates[] = {
        "build/rfg/**/*.jar",   // ForgeGradle 的 Minecraft/Forge 反混淆产物
        "build/libs/**/*.jar",  // 本工程构建产物
        "build/classes/**",     // 增量编译输出（类目录 JDT 也认）
        "lib/**/*.jar",
        "run/**/*.jar",
    };
    for (const auto& entry : linked) {
        if (!entry.is_string()) continue;
        const auto project = entry.get<std::string>();
        for (const auto* candidate : candidates) {
            const auto parent = root / from_utf8(project) / fs::path(candidate).begin()->wstring();
            std::error_code code;
            if (fs::exists(parent, code) && !code) globs.push_back(project + "/" + candidate);
        }
    }
    return globs;
}

}  // namespace taocode
