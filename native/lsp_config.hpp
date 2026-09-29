// 「这台机器上该用哪些语言服务器」——把 `TaoCode.lsp.json`、PATH 自动发现与内置
// JDT LS 三条来源合成一张表。
//
// 为什么单独一个模块：这段逻辑原本长在 `native/main.cpp` 的 WebView2 宿主里，而它与
// WebView2 毫无关系（输入只有"exe 在哪个目录、开着哪个项目、项目的 Java 设置"），
// 却让宿主文件越过了模块行数上限。搬到这儿之后它是**纯逻辑**，可以脱离窗口测。
//
// 三类来源，优先级从高到低：
//   1. `TaoCode.lsp.json`（exe 旁边）——唯一能表达 args / cwd / initializationOptions 的地方
//   2. PATH 自动发现——「装了就用」，不给用户加一道手写配置的门槛
//   3. 内置 JDT LS（exe 旁边的 `jdtls\`）——IDEA 是把 Java 支持打包进 IDE 的
#pragma once

#include <filesystem>
#include <map>
#include <string>

#include "lsp_session.hpp"
#include "workspace.hpp"

namespace taocode::lsp {

/** `TaoCode.lsp.json` 里的条目：key 是语言 id，值是 `Session::ServerConfig`。 */
std::map<std::string, Session::ServerConfig> read_explicit_servers(const std::filesystem::path& file);

/**
 * 合成这张表。
 *
 * @param executable_directory  exe 所在目录（找 `TaoCode.lsp.json` 与 `jdtls\`）
 * @param project_root          当前项目根；空串表示没打开项目（此时没有索引目录，Java 那一份会跳过）
 * @param project_settings 项目级设置（用到 `java` 段与 `buildTools.gradle` 段）；**null 表示没打开项目**。
 *                         Java 服务器就绪后会拿它去喂 `settings.java`（JDK、源根、Gradle 运行设置）。
 */
std::map<std::string, Session::ServerConfig> resolve_servers(
    const std::filesystem::path& executable_directory,
    const std::string& project_root,
    const Json& project_settings);

}  // namespace taocode::lsp
