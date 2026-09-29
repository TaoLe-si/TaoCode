#include "jdtls.hpp"

#include <windows.h>

#include <fstream>
#include <iterator>

namespace taocode::jdtls {
namespace {

namespace fs = std::filesystem;

std::wstring to_wide(const std::string& value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
    std::wstring out(static_cast<std::size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size);
    return out;
}

/** 读 config.ini 用不到宽字符，但比较平台 fragment 时两边得同一种编码。 */
std::string to_utf8(const std::wstring& value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<std::size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
    return out;
}

std::string read_file(const fs::path& path) {
    std::ifstream ini(path, std::ios::binary);
    if (!ini) return {};
    return std::string((std::istreambuf_iterator<char>(ini)), std::istreambuf_iterator<char>());
}

/**
 * 本机该用哪个 Equinox 平台 fragment，例如 Windows 上的
 * `org.eclipse.equinox.launcher.win32.win32.x86_64`。
 *
 * 为什么不用目录名（`config_win`）判平台：包里有 11 份 `config*`，名字里的 `_win` / `_linux`
 * 只是命名习惯。实测过 —— 在 Windows 上用 `-configuration config_linux` **照样能握手成功**，
 * 所以「名字对不对」既挡不住错的、也证明不了对的。而 config.ini 里那行
 * `osgi.bundles=…org.eclipse.equinox.launcher.win32.win32.x86_64_…` 是**数据**，
 * 它才是这份配置声明的平台。
 */
std::wstring platform_launcher_fragment() {
#if defined(_WIN32)
#if defined(_M_ARM64)
    return L"org.eclipse.equinox.launcher.win32.win32.aarch64";
#else
    return L"org.eclipse.equinox.launcher.win32.win32.x86_64";
#endif
#elif defined(__APPLE__)
#if defined(__aarch64__) || defined(__arm64__)
    return L"org.eclipse.equinox.launcher.cocoa.macosx.aarch64";
#else
    return L"org.eclipse.equinox.launcher.cocoa.macosx.x86_64";
#endif
#elif defined(__linux__)
#if defined(__aarch64__)
    return L"org.eclipse.equinox.launcher.gtk.linux.aarch64";
#else
    return L"org.eclipse.equinox.launcher.gtk.linux.x86_64";
#endif
#else
    return {};  // 认不出平台时只按「起得起来」判，不瞎猜平台
#endif
}

}  // namespace

std::filesystem::path configuration_directory(const std::filesystem::path& install) {
    // 官方包里有 `config/`、`config_win/`、`config_ss_win/` … 共 11 份。逐份**实测**过
    // （真实 JRE 21 拉起 JDT LS 1.44，逐份 `initialize`）：
    //   · `config/`           没有 config.ini → exit 13，"Unable to acquire application service"
    //   · `config_ss_win/`    有 jdt.ls.core、**没有 m2e** → exit 13，
    //                         NoClassDefFoundError: org.eclipse.m2e.core.internal.preferences.ProblemSeverity
    //   · `config_linux/`     在 Windows 上**能**起来 → 所以平台不能靠目录名猜
    //   · `config_win/`       起得来，且是唯一同时满足「平台对 + 有 m2e」的那份
    //
    // 判据必须看 `osgi.bundles` 里的**bundle 名**，不能只找 `org.eclipse.jdt.ls.core` 这个子串：
    // 每份 config.ini 都有一行 `eclipse.application=org.eclipse.jdt.ls.core.id1`，光看子串的话
    // 「只有 gson、没有语言服务器」的坏配置也会被判成可用，然后以 exit 13 收场。
    // Equinox 的 bundle 文件名是 `<符号名>_<版本>.jar`，所以带下划线的
    // `org.eclipse.jdt.ls.core_` 才是"本体在里面"的证据。
    constexpr std::string_view server_bundle = "org.eclipse.jdt.ls.core_";  // 语言服务器本体
    constexpr std::string_view maven_bundle = "org.eclipse.m2e.core_";      // 1.44 启动期硬引用
    const std::string platform = to_utf8(platform_launcher_fragment());
    // m2e 的权重比平台高 —— 这是**实测结论**，不是偏好：缺 m2e 是硬失败（exit 13），
    // 平台 fragment 不匹配反而能跑起来。权重这样排，config_win 缺席时会退到
    // config_linux（能跑）而不是 config_ss_win（必崩）。将来 JDT LS 不再依赖 m2e 时，
    // 所有配置的 m2e 分都一样，平台分自然接手 —— 判据不会"过严"。
    int best_score = -1;
    fs::path best;
    std::error_code error;
    for (const auto& entry : fs::directory_iterator(install, error)) {
        if (!entry.is_directory(error)) continue;
        const std::string text = read_file(entry.path() / L"config.ini");
        if (text.empty()) continue;
        if (text.find(server_bundle) == std::string::npos) continue;
        int score = 0;
        if (text.find(maven_bundle) != std::string::npos) score += 2;
        if (!platform.empty() && text.find(platform) != std::string::npos) score += 1;
        const auto name = entry.path().filename().wstring();
        // 同分时取名字字典序小的那份 —— 目录枚举顺序在不同文件系统上不一样，
        // 不留一个"看运气"的选择。
        if (score > best_score || (score == best_score && name < best.filename().wstring())) {
            best_score = score;
            best = entry.path();
        }
    }
    return best;
}

std::filesystem::path launcher_jar(const std::filesystem::path& directory) {
    std::error_code error;
    const auto plugins = directory / L"plugins";
    if (!fs::is_directory(plugins, error)) return {};
    // 版本号随发布变（org.eclipse.equinox.launcher_1.6.900.v20240213-1949.jar），
    // 所以按前缀找而不是钉死文件名 —— 换版本时不需要改代码。
    fs::path found;
    for (const auto& entry : fs::directory_iterator(plugins, error)) {
        const auto name = entry.path().filename().wstring();
        if (name.rfind(L"org.eclipse.equinox.launcher_", 0) != 0) continue;
        if (entry.path().extension() != L".jar") continue;
        // 目录里可能有多个（不同版本残留），取字典序最大的那个，与最新发布一致。
        if (found.empty() || name > found.filename().wstring()) found = entry.path();
    }
    return found;
}

bool is_install(const std::filesystem::path& directory) {
    if (directory.empty()) return false;
    std::error_code error;
    if (!fs::is_directory(directory, error)) return false;
    // 判据是「这套安装能起得来」：有 launcher jar，且有一份带 config.ini 的配置。
    if (launcher_jar(directory).empty()) return false;
    return !configuration_directory(directory).empty();
}

lsp::Session::ServerConfig launch_spec(const std::filesystem::path& install,
                                       const std::filesystem::path& java,
                                       const std::filesystem::path& data) {
    lsp::Session::ServerConfig config;
    const auto launcher = launcher_jar(install);
    const auto configuration = configuration_directory(install);
    if (launcher.empty() || configuration.empty() || java.empty()) return config;
    config.command = java.wstring();
    // Equinox 的**写入区**。官方启动器不带它，于是写入区落回安装目录里那份 config
    // （实测 `config/` 被写进 .log，`config_linux/` 被解出上百个 `.cp/*.jar`）。
    // 发布版装到 Program Files 这类只读位置时那就是硬失败，所以显式指到用户目录下、
    // 与该项目索引数据同级。实测：Equinox 连目录都能自己建；这里再建一次只是"能建就更稳"。
    const auto writable = data.parent_path() / L"configuration" / data.filename();
    if (!data.empty()) {
        std::error_code ignored;
        fs::create_directories(writable, ignored);
    }
    // 参数表**逐字照官方包自带的 `bin/jdtls.py`**（`exec_args`），不是照 README 的片段。
    // 差别都在实测里出现过：
    //   · `-Dosgi.sharedConfiguration.area=<config>` + `cascaded=true`（只读共享区），
    //     而不是 `-configuration <config>`（那会把写入区也钉在安装目录里，见上）。
    //   · 缺 `-Declipse.product` 时 Equinox 只能靠 application id 反推 product；官方显式给。
    //   · `--add-modules=ALL-SYSTEM` / `--add-opens=java.base/*` 在 JDK 17+ 是必需的：
    //     强封装会拦住 Equinox 对 `java.base` 内部包的反射。
    config.arguments = {
        L"-Declipse.application=org.eclipse.jdt.ls.core.id1",
        L"-Dosgi.bundles.defaultStartLevel=4",
        L"-Declipse.product=org.eclipse.jdt.ls.core.product",
        L"-Dosgi.checkConfiguration=true",
        L"-Dosgi.sharedConfiguration.area=" + configuration.wstring(),
        L"-Dosgi.sharedConfiguration.area.readOnly=true",
        L"-Dosgi.configuration.cascaded=true",
        L"-Dosgi.configuration.area=" + writable.wstring(),
        L"-Xms1G",
        L"--add-modules=ALL-SYSTEM",
        L"--add-opens", L"java.base/java.util=ALL-UNNAMED",
        L"--add-opens", L"java.base/java.lang=ALL-UNNAMED",
        L"-jar", launcher.wstring(),
        L"-data", data.wstring(),
    };
    return config;
}

std::filesystem::path workspace_data(const std::filesystem::path& data_root, const std::string& workspace_key) {
    // 每个项目一份索引（IDEA 的 per-project index）。路径里不能出现文件系统不允许的字符，
    // 所以用键的十六进制而不是原样拼接 —— 项目路径里的 `:` 在 Windows 上是致命的。
    static const char* digits = "0123456789abcdef";
    std::string hashed;
    hashed.reserve(workspace_key.size() * 2);
    for (const char ch : workspace_key) {
        const auto byte = static_cast<unsigned char>(ch);
        hashed.push_back(digits[byte >> 4]);
        hashed.push_back(digits[byte & 0x0F]);
    }
    return data_root / L"jdtls-workspace" / to_wide(hashed);
}


}  // namespace taocode::jdtls
