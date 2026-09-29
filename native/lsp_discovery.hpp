// 语言服务器的**自动发现**。
//
// 为什么需要它：TaoCode 不内置任何语言服务器二进制（IDEA 把语言支持做成插件随 IDE 分发，
// 这里做不到），但「装了还得让用户手写 TaoCode.lsp.json」不是 IDEA 的行为 —— IDEA 里
// Java 支持是开箱即用的。对用户来说合理的等价物是：**装了就用**。
//
// 判据：只认**真实存在**的可执行文件，按 `PATH` 顺序找，用的是每种服务器官方文档里
// 那个可执行名（clangd / jdtls / gopls …）。找不到就返回空 —— 绝不猜一个不存在的命令，
// 那会在启动时以「进程创建失败」的形式报给用户，比「没有配置」更难排查。
//
// `TaoCode.lsp.json` 仍然是**覆盖**：那里的条目优先于自动发现（要指定参数、cwd、
// initializationOptions 时只有配置文件能表达）。
#pragma once

#include <filesystem>
#include <map>
#include <string>
#include <string_view>
#include <vector>

#include "lsp_session.hpp"

namespace taocode::lsp {

/** 每种语言按官方名字列出候选可执行文件（第一个存在的就用）。 */
const std::vector<const wchar_t*>& server_candidates(std::string_view language);

/**
 * 在 `path_variable`（默认读进程自己的 PATH）里逐个目录找候选可执行文件。
 * 目录之间用 `;` 分隔（Windows），条目两端的空白要吃掉。
 * 找到就返回绝对路径，找不到返回空串。**不检查文件是否可执行** —— Windows 上
 * `.exe` 才是可执行形态，用 `PATHEXT` 判断反而会在自定义扩展名上出错。
 */
std::wstring find_on_path(const std::vector<const wchar_t*>& candidates, const std::wstring& path_variable);

/** 便捷入口：按语言发现一台服务器；没有就返回空的 command。 */
Session::ServerConfig discover_server(std::string_view language, const std::wstring& path_variable);

/**
 * 把 PATH 上**装好的**服务器并进 `servers`：已经配好的语言不覆盖（`TaoCode.lsp.json`
 * 是显式配置，优先），没配过的语言才去找，找不到就不加。
 * 宿主只在启动时调一次，所以路径从进程环境读。
 */
void merge_discovered(std::map<std::string, Session::ServerConfig>& servers);

/**
 * Java 专用的那条路：JDT LS 不是单个可执行文件，而是解压后的 Equinox 安装目录，
 * 要用**一个 JVM** 拉起（`native/jdtls.cpp` 负责拼规格）。
 *
 * 跑 JDT LS 的 JVM 与**项目的 Java 版本无关**——IDEA 就是这么做的：它用自带的
 * JetBrains Runtime 跑 IDE 与 Java 插件，项目 SDK 只负责编译与运行用户代码。所以取件
 * 顺序是：IDE 自带的 JRE（`scripts/fetch-jre.ps1` 放在 exe 旁边）→ 项目 JDK → PATH 上的
 * `java`。只要有第一个，项目是 8 / 11 / 17 / 21 / 25 都能有代码提示。
 *
 * 安装目录按顺序找：exe 旁边的 `jdtls\`（随发行分发）、`%LOCALAPPDATA%\TaoCode\jdtls`
 * （缓存），以及 PATH 上的 `jdtls` / `jdtls.bat`（开发者自己装的）。
 *
 * @param java_executable  回退用的 java（项目 JDK 的 `bin\java.exe`；IDE 自带 JRE 存在时不用它）
 * @param executable_directory  exe 所在目录（找随发行的那一份）
 * @param data_directory   这个工作区的索引数据目录（`-data`）
 */
Session::ServerConfig discover_java(const std::filesystem::path& java_executable,
                                    const std::filesystem::path& executable_directory,
                                    const std::filesystem::path& data_directory);


/** `%LOCALAPPDATA%\TaoCode`（缓存与索引数据的根）。取不到时返回空路径。 */
std::filesystem::path local_data_root();

}  // namespace taocode::lsp
