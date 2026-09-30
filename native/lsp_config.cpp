#include "lsp_config.hpp"

#include <fstream>
#include <utility>

#include "jdtls.hpp"
#include "lsp_discovery.hpp"
#include "projects.hpp"
#include "text.hpp"

namespace taocode::lsp {

std::map<std::string, Session::ServerConfig> read_explicit_servers(const std::filesystem::path& file) {
    std::map<std::string, Session::ServerConfig> servers;
    std::ifstream stream(file, std::ios::binary);
    if (!stream) return servers;
    try {
        for (const auto& [language, entry] : Json::parse(stream).items()) {
            if (!entry.is_object()) continue;
            Session::ServerConfig config;
            config.command = wide(entry.value("command", std::string()));
            if (entry.contains("args") && entry.at("args").is_array())
                for (const auto& arg : entry.at("args"))
                    if (arg.is_string()) config.arguments.push_back(wide(arg.get<std::string>()));
            if (entry.contains("cwd") && entry.at("cwd").is_string())
                config.working_directory = std::filesystem::path(wide(entry.at("cwd").get<std::string>()));
            if (entry.contains("initializationOptions") && entry.at("initializationOptions").is_object())
                config.initialization_options = entry.at("initializationOptions");
            if (!config.command.empty()) servers[language] = std::move(config);
        }
    } catch (const Json::exception&) {
        // 读不懂的配置文件就是"没有服务器" —— 不能因此让 IDE 起不来。
    }
    return servers;
}

std::map<std::string, Session::ServerConfig> resolve_servers(
    const std::filesystem::path& executable_directory,
    const std::string& project_root,
    const Json& project_settings) {
    const Json settings = project_settings.is_object() ? project_settings : Json::object();
    const Json java = settings.value("java", Json::object());
    auto servers = read_explicit_servers(executable_directory / L"TaoCode.lsp.json");
    // 配置文件里没提到的语言按 PATH 自动发现（`TaoCode.lsp.json` 里的条目不覆盖）。
    merge_discovered(servers);
    // Java 单独一路：JDT LS 随发行放在 exe 旁边（Equinox 安装），用**IDE 自带的 JRE**
    // 拉起，与项目 Java 版本无关 —— 这就是 IDEA「装完就有 Java 支持」的等价物。
    // 项目 JDK 只是回退项，所以**不能**要求它先配好：没配 JDK 的项目照样要有代码提示
    // （IDEA 里 Java 支持也从不等项目 SDK）。没打开项目时没有索引目录，才跳过。
    if (!project_root.empty() && !servers.contains("java")) {
        // 完全内置方案（2026-09-28 用户拍板）：随发行的那份 JDT LS + 随发行的 JRE 21，
        // 与项目 JDK 解耦 —— 项目 JDK 只通过 java_lsp_settings 的 runtimes 参与编译，
        // 这正是 IDEA「装完就有 Java 支持」的等价物，JDK 8 项目同样有完整补全。
        const auto java_home = java.value("jdkHome", std::string());
        const std::filesystem::path project_java =
            java_home.empty() ? std::filesystem::path() : std::filesystem::path(wide(java_home)) / L"bin" / L"java.exe";
        const auto data = jdtls::workspace_data(local_data_root(), project_root);
        auto spec = discover_java(project_java, executable_directory, data);
        if (!spec.command.empty()) servers.emplace("java", std::move(spec));
    }
    if (!project_root.empty() && servers.contains("java"))
        servers.at("java").settings = java_lsp_settings(java, settings.value("buildTools", Json::object()), default_referenced_libraries(project_root),
            import_exclusions(project_root, settings.value("buildTools", Json::object()).value("gradle", Json::object())),
            default_source_paths(project_root, settings.value("buildTools", Json::object()).value("gradle", Json::object())));
    return servers;
}

}  // namespace taocode::lsp
