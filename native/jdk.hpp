#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "workspace.hpp"  // Json

// 机器上**已安装的 JDK** —— IDEA `JavaHomeFinderBasic` 的对应物。
//
// 为什么需要它（桃 2026-09-27：「gradle 等配置，IDEA 打开默认都是有的」）：
// IDEA 打开一个 Java / Gradle 项目时不需要你先去设置里填 JDK ——
// `ProjectJdkTable` 里已经有机器上的 JDK 列表，项目用它当默认 SDK、Gradle 用它当 Gradle JVM。
// TaoCode 的 `JavaProjectSettings.jdkHome` 默认是空串，于是 LSP（jdtls）拿不到运行时、
// javac 也不知道用哪个编译器 —— 这就是"打开即不可用"的根因。
//
// 逐条对照的源码：
//   · `platform/lang-impl/src/com/intellij/openapi/projectRoots/impl/JavaHomeFinderBasic.java`
//       `:59-71` finders 的**顺序**：默认安装目录 → PATH → JAVA_HOME → 用户指定路径 →
//                SDKMAN → asdf → **Gradle（`~/.gradle/jdks`）** → mise → jabba → 内嵌 JRE；
//       `:112-128` `findExistingJdks()` 逐个调 finder，用 `TreeSet` 去重并**按路径排序**；
//       `:142-145` `findInJavaHome()`：读 `JAVA_HOME`，`scanAll(path, false)` —— **不递归子目录**；
//       `:147-187` `findInPATH()`：只取 PATH 里**目录名为 `bin`** 的条目，用它的**父目录**去扫；
//       `:189-221` `checkDefaultLocations()`：安装根目录 + 已登记的 JDK 目录；
//       `:238-256` `scanFolder()`：先 `JdkUtil.checkForJdk(folder)`，命中就收；否则（允许时）
//                       只下钻**一层**子目录（`includeNestDirs`）。
//   · `platform/lang-core/src/com/intellij/openapi/projectRoots/JdkUtil.java`
//       `:64-72` `checkForJdk()` = `bin/javac*` 存在 **且**（`lib/modules`（模块化 JRE/JDK）
//                或 `jre/lib/rt.jar` / `classes/` / `jre/lib/vm.jar` / `../Classes/classes.jar`）；
//       `:154-156` `checkForJdkOrJre()` = 只看 `bin/<java 名>` 在不在；
//       `:50-57` `suggestJdkName()`：feature < 9 写成 `1.<feature>`，EA 版本带 `-ea` 后缀。
//   · `jps/model-impl/src/org/jetbrains/jps/model/java/impl/JdkVersionDetectorImpl.java:54-69`
//       版本从 `<home>/release` 文件读：`JAVA_FULL_VERSION` 优先，其次 `JAVA_VERSION`。
//
// 探测是**只读**的（只看目录与一个文本文件），不执行 `java -version`：那要起进程，
// 打开项目时做十几次太慢（IDEA 也是读 release 文件）。
namespace taocode {
namespace jdk {

struct Jdk {
    std::string home;     // 绝对路径
    std::string version;  // `release` 里的 JAVA_VERSION，读不到就是空串
    std::string name;     // 建议显示名（`21` / `1.8` / `17-ea`），版本读不到时为空
};

/** `JdkUtil.checkForJdk`（:64-72）：这个目录是不是一个可用的 JDK。 */
bool is_jdk(const std::filesystem::path& home);

/** `JdkVersionDetectorImpl`（:54-69）：从 `<home>/release` 读版本，读不到返回空串。 */
std::string read_version(const std::filesystem::path& home);

/**
 * 版本串的 **feature 号**（`1.8.0_392` → 8，`21.0.11-ea` → 21），解析不了返回 0。
 * `suggest_name` 给显示名，而 `java_lsp_settings` 把 jdkName 归一成 `JavaSE-<x>`
 * 需要这个数（8 写作 JavaSE-1.8）。
 */
int feature_version(const std::string& version);

/** `JdkUtil.suggestJdkName`（:50-57）。版本无法解析时返回空串。 */
std::string suggest_name(const std::string& version);


/**
 * 探测机器上的全部 JDK（顺序照 `JavaHomeFinderBasic:59-71`），去重后**按路径排序**。
 * 结果只依赖环境变量与文件系统，不跑任何子进程。
 */
std::vector<Jdk> find_all();

Json to_json(const std::vector<Jdk>& jdks);

}  // namespace jdk
}  // namespace taocode
