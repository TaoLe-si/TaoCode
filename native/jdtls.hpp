// JDT LS（Eclipse Java 语言服务器）的**启动规格**。
//
// 为什么单独一个模块：JDT LS 不是"一个可执行文件"——官方发布包解压后是 Equinox 的
// `plugins/` 与 `config/`，要按 README 的命令行用 `java -jar <equinox launcher>`
// 拉起，并把每个工作区的索引数据放在 `-data` 目录里。把这套参数拼出来是**纯逻辑**
// （给定安装目录与 java 可执行文件，产出 Session::ServerConfig），所以可以脱离磁盘测。
//
// 判据全部照 `eclipse.jdt.ls/README.md` 的 "Running the server" 一节：
//   java -Declipse.application=org.eclipse.jdt.ls.core.id1
//        -Dosgi.bundles.defaultStartLevel=4
//        -Dosgi.checkConfiguration=true
//        -Dosgi.sharedConfiguration.area.readOnly=true
//        -Dosgi.configuration.cascaded=true
//        -jar <plugins>/org.eclipse.equinox.launcher_*.jar
//        -configuration <config> -data <workspace>
#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "lsp_session.hpp"

namespace taocode::jdtls {

/** 这个目录像一份 JDT LS 安装吗（有 plugins/、config/ 与 equinox launcher jar）。 */
bool is_install(const std::filesystem::path& directory);

/** 官方发布包里的 `org.eclipse.equinox.launcher_<版本>.jar`（版本号会变，取第一个）。 */
std::filesystem::path launcher_jar(const std::filesystem::path& directory);

/**
 * 真正能用的那份配置目录：包里有 `config/`、`config_win/`、`config_ss_win/` 等好几份，
 * 判据是「有 config.ini **且** bundle 清单里含 org.eclipse.jdt.ls.core」。
 * （`config/` 没有 config.ini；`config_ss_win/` 缺 m2e，起不来。）
 * 认不出返回空路径。
 */
std::filesystem::path configuration_directory(const std::filesystem::path& install);

/**
 * 拼出 JDT LS 的启动规格。
 *
 * @param install  JDT LS 安装目录（解压后的那一份）
 * @param java    启动用的 java 可执行文件（项目 JDK 的 `bin/java.exe`）
 * @param data    该工作区的索引数据目录（`-data`）
 * @return 目录不完整时返回**空的 command** —— 绝不编一个跑不起来的规格。
 */
lsp::Session::ServerConfig launch_spec(const std::filesystem::path& install,
                                       const std::filesystem::path& java,
                                       const std::filesystem::path& data);

/** 每个工作区一份索引数据（IDEA 的 project index）。data_root 缺省用 %LOCALAPPDATA%。 */
std::filesystem::path workspace_data(const std::filesystem::path& data_root, const std::string& workspace_key);

}  // namespace taocode::jdtls
