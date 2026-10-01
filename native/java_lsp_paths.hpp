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

/**
 * 把"已算好的模型"物化成 **Eclipse 工程**（`.project` + `.classpath`），交给 JDT LS 自带的
 * `EclipseProjectImporter` 导入 —— 这是"IDEA 靠已导入的模型离线解析"在本仓的等价物：
 * Gradle 导入在这类工程上跑不完（依赖不在缓存/要联网现做），而 JDT 对**非工程文件**只做语法检查
 * （真机诊断原文 `… is a non-project file, only syntax errors are reported`）。
 *
 * 只在文件**不存在**时写（不覆盖用户自己的 Eclipse 配置），返回实际写的文件数（0 = 跳过）。
 * 源根用工程内相对路径，jar 用绝对路径（`kind="lib"`）。jar 由 glob 前缀目录递归枚举，上限 400 条。
 */
int materialize_eclipse_project(const std::filesystem::path& project_dir,
                               const std::vector<std::string>& source_paths,
                               const std::vector<std::string>& library_globs);

}  // namespace taocode
