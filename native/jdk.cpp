// JDK 探测的实现（见 jdk.hpp 的源码对照）。
#include "jdk.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace taocode {
namespace jdk {
namespace {

namespace fs = std::filesystem;

/** 环境变量（宽字符进、UTF-8 出）。没有这个变量时返回空串。 */
std::string environment(const wchar_t* name) {
    const DWORD needed = GetEnvironmentVariableW(name, nullptr, 0);
    if (needed == 0) return {};
    std::wstring buffer(needed, L'\0');
    const DWORD written = GetEnvironmentVariableW(name, buffer.data(), needed);
    if (written == 0 || written >= needed) return {};
    buffer.resize(written);
    // 只需要 ASCII 路径，但路径里可能有中文（`C:\用户\...`）—— 走一次 UTF-8 转换。
    const int size = WideCharToMultiByte(CP_UTF8, 0, buffer.data(), static_cast<int>(buffer.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string out(static_cast<std::size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, buffer.data(), static_cast<int>(buffer.size()), out.data(), size, nullptr, nullptr);
    return out;
}

/** Windows 上可执行文件带 `.exe`（`JdkUtil.getJavaFileName` 的等价物）。 */
const char* executable_name(bool is_jdk_bundle) {
    return is_jdk_bundle ? "javac.exe" : "java.exe";
}

/** `JdkUtil.checkForJdkOrJre`（:154-156）：只看 `bin/<java 名>` 在不在。 */
bool check_for_binary(const fs::path& home, bool is_jdk_bundle) {
    std::error_code error;
    return fs::exists(home / "bin" / executable_name(is_jdk_bundle), error);
}

/** `JdkUtil.isModularRuntime`（:98-100）：模块化运行时（JDK 9+）有 `lib/modules`。 */
bool is_modular_runtime(const fs::path& home) {
    std::error_code error;
    return fs::is_directory(home / "lib" / "modules", error);
}

/** 一行 `k="v"` 取值（release 文件是 `JAVA_VERSION="21.0.11"` 这种形式）。 */
std::string release_property(const fs::path& file, const std::string& key) {
    std::ifstream stream(file, std::ios::binary);
    if (!stream) return {};
    std::string line;
    const std::string prefix = key + "=";
    while (std::getline(stream, line)) {
        if (line.rfind(prefix, 0) != 0) continue;
        std::string value = line.substr(prefix.size());
        while (!value.empty() && (value.back() == '\r' || value.back() == '"' || value.back() == ' ')) value.pop_back();
        const auto start = value.find_first_not_of("\" ");
        if (start != std::string::npos && start > 0) value.erase(0, start);
        return value;
    }
    return {};
}

}  // namespace

bool is_jdk(const fs::path& home) {
    if (home.empty()) return false;
    // `:65-71`：先要有 `bin/javac`，再看是不是完整的 JDK 布局（模块化 / 老式 rt.jar / 自定义 build）。
    if (!check_for_binary(home, true)) return false;
    std::error_code error;
    return is_modular_runtime(home) ||
           fs::exists(home / "jre" / "lib" / "rt.jar", error) ||
           fs::is_directory(home / "classes", error) ||
           fs::exists(home / "jre" / "lib" / "vm.jar", error) ||
           fs::exists((home / ".." / "Classes" / "classes.jar").lexically_normal(), error);
}

std::string read_version(const fs::path& home) {
    const fs::path release = home / "release";
    std::error_code error;
    if (!fs::is_regular_file(release, error)) return {};
    // `JdkVersionDetectorImpl:69`：`JAVA_FULL_VERSION` 优先，其次 `JAVA_VERSION`。
    const std::string full = release_property(release, "JAVA_FULL_VERSION");
    return full.empty() ? release_property(release, "JAVA_VERSION") : full;
}

int feature_version(const std::string& version) {
    if (version.empty()) return 0;
    std::string text = version;
    const std::string lowered = [&text] {
        std::string out = text;
        std::transform(out.begin(), out.end(), out.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        return out;
    }();
    if (const auto at = lowered.find("-ea"); at != std::string::npos) text = text.substr(0, at);
    std::vector<std::string> parts;
    for (std::size_t start = 0; start <= text.size();) {
        const auto dot = text.find('.', start);
        const auto end = dot == std::string::npos ? text.size() : dot;
        parts.push_back(text.substr(start, end - start));
        if (dot == std::string::npos) break;
        start = dot + 1;
    }
    const auto to_number = [](const std::string& part, long& out) {
        if (part.empty()) return false;
        long value = 0;
        for (const char character : part) {
            if (character < '0' || character > '9') return false;
            value = value * 10 + (character - '0');
            if (value > 9999) return false;
        }
        out = value;
        return true;
    };
    long feature = 0;
    if (parts.size() >= 2 && parts[0] == "1") { if (!to_number(parts[1], feature)) return 0; }
    else if (!parts.empty()) { if (!to_number(parts[0], feature)) return 0; }
    return feature > 0 ? static_cast<int>(feature) : 0;
}

std::string suggest_name(const std::string& version) {
    if (version.empty()) return {};
    std::string text = version;
    // EA 版本带 `-ea` 后缀（`JdkUtil.suggestJdkName:55`）
    bool early_access = false;
    const std::string lowered = [&text] {
        std::string out = text;
        std::transform(out.begin(), out.end(), out.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        return out;
    }();
    if (const auto at = lowered.find("-ea"); at != std::string::npos) { early_access = true; text = text.substr(0, at); }
    // `1.8.0_392` → 首段是 1，feature 取第二段；`21.0.11` → feature 取首段。
    long feature = 0;
    std::vector<std::string> parts;
    for (std::size_t start = 0; start <= text.size();) {
        const auto dot = text.find('.', start);
        const auto end = dot == std::string::npos ? text.size() : dot;
        parts.push_back(text.substr(start, end - start));
        if (dot == std::string::npos) break;
        start = dot + 1;
    }
    const auto to_number = [](const std::string& part, long& out) {
        if (part.empty()) return false;
        long value = 0;
        for (const char character : part) {
            if (character < '0' || character > '9') return false;
            value = value * 10 + (character - '0');
            if (value > 9999) return false;
        }
        out = value;
        return true;
    };
    if (parts.size() >= 2 && parts[0] == "1") { if (!to_number(parts[1], feature)) return {}; }
    else if (!parts.empty()) { if (!to_number(parts[0], feature)) return {}; }
    else return {};
    if (feature <= 0) return {};
    std::string name = feature < 9 ? "1." + std::to_string(feature) : std::to_string(feature);
    if (early_access) name += "-ea";
    return name;
}

namespace {

/** `std::filesystem::weakly_canonical` 失败时退回原路径（原始字符串同样能用）。 */
fs::path fallback_canonical(const fs::path& path) {
    std::error_code error;
    const fs::path canonical = fs::weakly_canonical(path, error);
    return canonical.empty() ? path : canonical;
}

/**
 * `JavaHomeFinderBasic.scanFolder`（:238-256）：
 * 命中就收；否则（允许时）只下钻**一层**子目录 —— 安装根目录（`...\Java`）才需要下钻。
 */
void scan_folder(const fs::path& folder, bool include_nested, std::vector<fs::path>& out) {
    std::error_code error;
    if (!fs::is_directory(folder, error)) return;
    if (is_jdk(folder)) { out.push_back(fallback_canonical(folder)); return; }
    if (!include_nested) return;
    fs::directory_iterator iterator(folder, fs::directory_options::skip_permission_denied, error);
    const fs::directory_iterator end;
    for (; iterator != end; iterator.increment(error)) {
        if (error) break;
        if (!iterator->is_directory(error)) continue;
        if (is_jdk(iterator->path())) out.push_back(fallback_canonical(iterator->path()));
    }
}

/** 用 `;` 切 PATH，只取**目录名是 `bin`** 的那些，取父目录（`:147-187`）。 */
void scan_path_entries(std::vector<fs::path>& out) {
    const std::string path = environment(L"PATH");
    if (path.empty()) return;
    for (std::size_t start = 0; start <= path.size();) {
        const auto separator = path.find(';', start);
        const auto end = separator == std::string::npos ? path.size() : separator;
        std::string entry = path.substr(start, end - start);
        while (!entry.empty() && entry.back() == ' ') entry.pop_back();
        if (entry.size() >= 4) {
            const std::string tail = entry.substr(entry.size() - 4);
            std::string lowered = tail;
            std::transform(lowered.begin(), lowered.end(), lowered.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            if (lowered == "\\bin" || lowered == "/bin")
                scan_folder(fs::path(entry).parent_path(), false, out);
        }
        if (separator == std::string::npos) break;
        start = separator + 1;
    }
}

/** `checkDefaultLocations`（:189-221）：Windows 上 Java 装在这么几个根目录下面。 */
void scan_install_roots(std::vector<fs::path>& out) {
    const std::string program_files = environment(L"ProgramFiles");
    const std::string program_files_x86 = environment(L"ProgramFiles(x86)");
    const std::string user_profile = environment(L"USERPROFILE");
    const std::string local_app_data = environment(L"LOCALAPPDATA");
    std::vector<fs::path> roots;
    for (const std::string& base : {program_files, program_files_x86}) {
        if (base.empty()) continue;
        for (const char* vendor : {"Java", "Eclipse Adoptium", "Eclipse Foundation", "Microsoft", "Amazon Corretto",
                                   "Zulu", "BellSoft", "Semeru", "RedHat", "SapMachine", "Temurin", "JetBrains"}) {
            roots.emplace_back(fs::path(base) / vendor);
        }
    }
    if (!local_app_data.empty()) roots.emplace_back(fs::path(local_app_data) / "Programs" / "Eclipse Adoptium");
    // 盘根下的自定义安装（本机就是 `D:\Java21` —— IDEA 的 `JdkInstaller` 也把默认装在这儿）。
    for (const char* drive : {"C:", "D:", "E:"}) {
        for (const char* name : {"Java", "jdk", "JDK", "Java21", "Java17"}) roots.emplace_back(fs::path(drive) / name);
    }
    // `findJavaInstalledByGradle`（:302-305）：Gradle 自己下的 JDK 放在 `~/.gradle/jdks`。
    if (!user_profile.empty()) roots.emplace_back(fs::path(user_profile) / ".gradle" / "jdks");
    for (const fs::path& root : roots) scan_folder(root, true, out);
}

}  // namespace

std::vector<Jdk> find_all() {
    std::vector<fs::path> found;
    // finders 的顺序照 `JavaHomeFinderBasic:59-71`（顺序影响 `TreeSet` 之外的去重时机，
    // 本仓统一在最后去重，所以这里的顺序只影响"哪个先被发现"）。
    scan_install_roots(found);
    scan_path_entries(found);
    // `findInJavaHome`（:142-145）：JAVA_HOME / JDK_HOME 指向的就是 JDK 本身，不递归。
    for (const wchar_t* variable : {L"JAVA_HOME", L"JDK_HOME"})
        scan_folder(fs::path(environment(variable)), false, found);

    // 去重（大小写不敏感的路径比较，Windows 文件系统就是这样）+ 按路径排序（`:113` 的 TreeSet）。
    std::map<std::string, fs::path> unique;
    for (const fs::path& home : found) {
        std::string key = home.string();
        std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        unique.emplace(key, home);
    }
    std::vector<Jdk> jdks;
    jdks.reserve(unique.size());
    for (const auto& [key, home] : unique) {
        Jdk entry;
        entry.home = home.string();
        entry.version = read_version(home);
        entry.name = suggest_name(entry.version);
        jdks.push_back(std::move(entry));
    }
    return jdks;
}

Json to_json(const std::vector<Jdk>& jdks) {
    Json list = Json::array();
    for (const auto& entry : jdks)
        list.push_back({{"home", entry.home}, {"version", entry.version}, {"name", entry.name}});
    return {{"jdks", std::move(list)}};
}

}  // namespace jdk
}  // namespace taocode
