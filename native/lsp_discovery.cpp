#include "lsp_discovery.hpp"

#include "jdtls.hpp"

#include <windows.h>

#include <filesystem>

namespace taocode::lsp {
namespace {

namespace fs = std::filesystem;

struct LanguageServers {
    const char* language;
    std::vector<const wchar_t*> candidates;
};

// 官方可执行名。JDT LS 的 Windows 启动器是 `jdtls.bat`/可执行同名，放在 PATH 上时
// 两个名字都认；`.exe` 后缀由 `find_on_path` 统一补。
const std::vector<LanguageServers> known_servers = {
    {"cpp", {L"clangd.exe", L"clangd"}},
    {"c", {L"clangd.exe", L"clangd"}},
    {"java", {L"jdtls.exe", L"jdtls", L"jdtls.bat"}},
    {"python", {L"pyright-langserver.exe", L"pyright-langserver", L"basedpyright.exe", L"basedpyright",
                L"pylsp.exe", L"pylsp"}},
    {"typescript", {L"typescript-language-server.exe", L"typescript-language-server"}},
    {"javascript", {L"typescript-language-server.exe", L"typescript-language-server"}},
    {"go", {L"gopls.exe", L"gopls"}},
    {"rust", {L"rust-analyzer.exe", L"rust-analyzer"}},
};

std::string trim(std::string value) {
    while (!value.empty() && (value.front() == ' ' || value.front() == '\t')) value.erase(value.begin());
    while (!value.empty() && (value.back() == ' ' || value.back() == '\t' || value.back() == '\r')) value.pop_back();
    return value;
}

}  // namespace

/** `%LOCALAPPDATA%`（JDT LS 的缓存与每个工作区的索引数据都放这儿）。 */
std::filesystem::path local_data_root() {
    wchar_t buffer[MAX_PATH] = {};
    const DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer, MAX_PATH);
    if (length == 0 || length >= MAX_PATH) return {};
    return fs::path(std::wstring(buffer, length)) / L"TaoCode";
}

const std::vector<const wchar_t*>& server_candidates(std::string_view language) {
    static const std::vector<const wchar_t*> none;
    for (const auto& entry : known_servers)
        if (language == entry.language) return entry.candidates;
    return none;
}

std::wstring find_on_path(const std::vector<const wchar_t*>& candidates, const std::wstring& path_variable) {
    if (path_variable.empty()) return {};
    // 目录逐个拆开：Windows 的 PATH 用 `;` 分隔，条目里可以有空格（`C:\Program Files\…`）。
    std::wstring remaining = path_variable;
    while (!remaining.empty()) {
        const auto separator = remaining.find(L';');
        auto piece = remaining.substr(0, separator);
        remaining = separator == std::wstring::npos ? std::wstring() : remaining.substr(separator + 1);
        // Windows 自己也会把 PATH 条目两端的空格/制表符去掉，这里照做 ——
        // 否则一个尾部空格就会让整条 PATH 失效（"装了却找不到"最难查的一类）。
        while (!piece.empty() && (piece.front() == L' ' || piece.front() == L'\t')) piece.erase(piece.begin());
        while (!piece.empty() && (piece.back() == L' ' || piece.back() == L'\t' || piece.back() == L'\r')) piece.pop_back();
        if (piece.empty()) continue;
        const fs::path directory(piece);
        for (const auto* name : candidates) {
            std::error_code error;
            const fs::path candidate = directory / name;
            // 目录也可能是文件（PATH 偶尔带空目录项），所以用 is_regular_file 判。
            if (fs::is_regular_file(candidate, error)) return candidate;
        }
    }
    return {};
}

Session::ServerConfig discover_server(std::string_view language, const std::wstring& path_variable) {
    Session::ServerConfig config;
    const auto& candidates = server_candidates(language);
    if (candidates.empty()) return config;
    config.command = find_on_path(candidates, path_variable);
    return config;
}

/** 读进程的 PATH（超长/取不到就当空 —— 那样只是发现不到，不会把配置弄坏）。 */
std::wstring path_variable() {
    wchar_t buffer[32768] = {};
    const DWORD length = GetEnvironmentVariableW(L"PATH", buffer, 32768);
    if (length == 0 || length >= 32768) return {};
    return std::wstring(buffer, length);
}

void merge_discovered(std::map<std::string, Session::ServerConfig>& servers) {
    const std::wstring path_value = path_variable();
    for (const auto& entry : known_servers) {
        const std::string language = entry.language;
        if (servers.contains(language)) continue;
        // Java 不在这里并：它不是"PATH 上的一个可执行文件"这么简单 —— 随发行的 JDT LS 是
        // 一份 Equinox 安装，要用 JVM 拉起，而且**优先级高于** PATH 上那个同名可执行文件。
        // 若在这里把 PATH 上的 jdtls.exe 并进来，`servers.contains("java")` 会立刻为真，
        // 后面那段「先找随发行的那一份」就被跳过了 —— 那正是内置 Java 支持失效的方式。
        // Java 的路在 `discover_java`（随发行 → 缓存目录 → PATH）。
        if (language == "java") continue;
        auto discovered = discover_server(language, path_value);
        if (!discovered.command.empty()) servers.emplace(language, std::move(discovered));
    }
}

namespace {

/**
 * 跑 JDT LS 的 JVM：**IDE 自带的 JRE 优先**，其次调用方给的项目 JDK，最后才是 PATH 上的 java。
 *
 * JDT LS 对它自己运行的 JVM 有硬要求（1.44 需要 JavaSE 21），而项目可以是 8/11/17/21/25。
 * 把两者绑在一起的结果就是「项目 JDK 低于 21 就没有代码提示」——IDEA 从不这样：它用自带的
 * JetBrains Runtime 跑 Java 插件，项目 SDK 只管编译与运行用户代码。这里是同一件事。
 *
 * 最后那步 PATH 上的 java 不能省：没有它，「exe 旁边没带 JRE、项目也没配 JDK」就会连
 * 随发行的那份 JDT LS 都拉不起来 —— 那是"装好了却没有提示"里最难查的一种。
 */
std::filesystem::path runtime_java(const std::filesystem::path& executable_directory,
                                   const std::filesystem::path& project_java,
                                   const std::wstring& path_value) {
    std::error_code error;
    const std::filesystem::path bundled = executable_directory / L"jre" / L"bin" / L"java.exe";
    if (fs::is_regular_file(bundled, error)) return bundled;
    if (!project_java.empty() && fs::is_regular_file(project_java, error)) return project_java;
    const std::wstring on_path = find_on_path({L"java.exe", L"java"}, path_value);
    return on_path.empty() ? std::filesystem::path() : std::filesystem::path(on_path);
}

}  // namespace

Session::ServerConfig discover_java(const std::filesystem::path& java_executable,
                                    const std::filesystem::path& executable_directory,
                                    const std::filesystem::path& data_directory) {
    const std::wstring path_value = path_variable();
    const auto java = runtime_java(executable_directory, java_executable, path_value);
    // 1) 随 IDE 分发的那一份（exe 旁边的 jdtls\）——「内置 Java 支持」指的就是它。
    //    优先于 PATH 上的同名可执行文件：内置那份版本是被钉过的，行为可预期。
    const fs::path bundled = executable_directory / L"jdtls";
    if (jdtls::is_install(bundled)) {
        auto spec = jdtls::launch_spec(bundled, java, data_directory);
        if (!spec.command.empty()) return spec;
    }
    // 2) 用户缓存目录（同一台机器上的多个安装共用一份）
    const fs::path cached = local_data_root() / L"jdtls";
    if (jdtls::is_install(cached)) {
        auto spec = jdtls::launch_spec(cached, java, data_directory);
        if (!spec.command.empty()) return spec;
    }
    // 3) 开发者自己装在 PATH 上的 jdtls —— 那种情况它就是一个普通可执行文件。
    return discover_server("java", path_value);
}

}  // namespace taocode::lsp
