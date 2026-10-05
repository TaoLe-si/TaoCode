// 从**磁盘布局**派生 JDT 的类路径 / 源根 / 导入排除 —— "IDEA 能解析外部、我们不能"那一条线的修法。
//
// 背景（真机取证）：IDEA 用**已经导入过的模型**（模块依赖 = 一串 jar 路径，离线查询）；
// 我们的 JDT LS 每次都要重跑 Buildship 的 Gradle 导入，而这类工程在离线/代理不通时跑不完
// （1.7.10 的 forge 不在 `~/.gradle/caches`；1.16.5 那条是 `mapped_snapshot` 变体要联网现做），
// 导入还会把根目录下**所有** Gradle 工程都拉进来同步（每次 ~75s、逐个失败）。
// 于是改由客户端自己算：链接的子工程里**真实存在**的构建产物当类路径（`build/rfg` 与 `build/libs` 下的 jar 等）、
// 真实存在的 `src/main/java` 等当源根，未链接的顶层目录进 `java.import.exclusions`。
//
// 这三个函数都是从 `native/projects.cpp` 抽出来的（那边贴着 950 行上限）：它们只碰文件系统与
// 设置 JSON，与"项目列表 / 最近项目"那一域无关。`library_list` 是把用户填的列表与本模块派生的
// 兜底合成一份（用户在前、去重），`java_lsp_settings` 用它。
#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "workspace.hpp"  // Json

namespace taocode {

/** 用户填的列表在前、派生兜底在后、去重（源根与类路径同一条口径）。 */
Json merged_string_list(const Json& declared, const std::vector<std::string>& extra);
Json library_list(const Json& java, const std::vector<std::string>& extra);
/** 类路径兜底：链接子工程里存在的 `build/rfg`、`build/libs`、`build/classes`、`lib`、`run` 下的 jar。 */
std::vector<std::string> default_referenced_libraries(const std::filesystem::path& root, const Json& gradle);
/** 未链接的顶层目录 → `java.import.exclusions`（"只导入链接的子工程"）。 */
std::vector<std::string> import_exclusions(const std::filesystem::path& root, const Json& gradle);
/** 链接子工程里存在的源根（`src/main/java`、`src/test/java`、`src/main/resources`、`src`）。 */
std::vector<std::string> default_source_paths(const std::filesystem::path& root, const Json& gradle);

/** 没填 `linkedProjects`（单模块工程）时**工作区根自己**的源根，工作区相对。 */
std::vector<std::string> root_source_paths(const std::filesystem::path& root);
/** 已链接的子工程目录（工作区相对，原样保留 `linkedProjects` 的写法）；没链接时为空。 */
std::vector<std::string> linked_project_dirs(const Json& gradle);

/**
 * 把"已算好的模型"物化成 **Eclipse 工程**（`.project` + `.classpath`），交给 JDT LS 自带的
 * `EclipseProjectImporter` 导入 —— 这是"IDEA 靠已导入的模型离线解析"在本仓的等价物：
 * Gradle 导入在这类工程上跑不完（依赖不在缓存/要联网现做），而 JDT 对**非工程文件**只做语法检查
 * （真机诊断原文 `… is a non-project file, only syntax errors are reported`）。
 *
 * 只在文件**不存在**时写（不覆盖用户自己的 Eclipse 配置），返回实际写的文件数（0 = 跳过）。
 * 源根用工程内相对路径，jar 用绝对路径（`kind="lib"`）。jar 由 glob 前缀目录递归枚举，上限 400 条。
 * `source_paths` / `library_globs` 收**工作区相对**的条目（`<子工程>/src/main/java`、
 * 以 `<子工程>/build/rfg` 之类目录为前缀的 jar 模式）；带 `<工程名>/` 前缀的剥掉后当工程内相对用，
 * 不带的（工程就是工作区根）原样用。
 * 已知限制：`linkedProjects` 写成嵌套路径（`group/mod-a`）时前缀按目录名对不上，jar 条目会落空。
 */
int materialize_eclipse_project(const std::filesystem::path& project_dir,
                               const std::vector<std::string>& source_paths,
                               const std::vector<std::string>& library_globs);

/**
 * 关掉 Gradle 导入时为**该建工程的每个目录**物化 Eclipse 工程：已链接的子工程各一个；
 * 一个都没链接（单模块工程）时就是**工作区根自己** —— 否则 JDT 眼里根目录不是工程，
 * `src/**` 里的文件永远是"non-project file"。返回写出的文件数。
 */
int materialize_eclipse_projects(const std::filesystem::path& root, const Json& gradle);

/**
 * 「让语言服务看到外部」这一个问题的**唯一入口**（启动与设置变更两条路共用，见 native/lsp_config.cpp
 * 与 native/main.cpp 的 `project.settings.update`）：算类路径/源根/导入排除，顺带物化 Eclipse 工程。
 */
struct JavaLspModel {
    /** 下发给 `java` 服务器的 `settings`（`java.project.sourcePaths` / `referencedLibraries` / …）。 */
    Json settings;
    /** 要物化、也要声明成 LSP **workspace folder** 的目录（工作区相对）；空 = 用工作区根。 */
    std::vector<std::string> project_dirs;
    /** 物化出来的 Eclipse 工程文件数（诊断日志用）。 */
    int files = 0;
};
JavaLspModel java_lsp_model(const std::filesystem::path& root, const Json& java, const Json& build_tools);

}  // namespace taocode
