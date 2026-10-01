#include "library_sources.hpp"

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
#include <sstream>
#include <vector>

#include "fsops.hpp"
#include "text.hpp"

namespace taocode {

namespace {

namespace fs = std::filesystem;

/** 一个 jar 里的条目数/文件大小上限：输入来自 hover 文本，不能让它牵着走。 */
constexpr std::size_t kMaxJars = 400;
constexpr std::size_t kMaxSourceBytes = 2 * 1024 * 1024;
constexpr std::size_t kMaxQualifierLength = 400;

/** 全限定名：`a.b.C`（每段是标识符，段数 ≥2）。`$` 允许（嵌套类按 `Outer$Inner.java` 找）。 */
bool valid_qualifier(const std::string& qualifier) {
    if (qualifier.empty() || qualifier.size() > kMaxQualifierLength) return false;
    if (qualifier.find('.') == std::string::npos) return false;
    std::size_t segments = 1;
    bool at_start = true;
    for (const char ch : qualifier) {
        if (ch == '.') {
            if (at_start) return false;
            at_start = true;
            ++segments;
            continue;
        }
        const auto byte = static_cast<unsigned char>(ch);
        if (at_start) {
            if (!(std::isalpha(byte) || ch == '_' || ch == '$')) return false;
            at_start = false;
            continue;
        }
        if (!(std::isalnum(byte) || ch == '_' || ch == '$')) return false;
    }
    return !at_start && segments >= 2;
}

/** Windows 10 1803 起自带的 bsdtar（与 plugins.cpp:146 同一招）。 */
std::wstring tar_executable() {
    wchar_t buffer[MAX_PATH]{};
    const UINT length = GetWindowsDirectoryW(buffer, MAX_PATH);
    if (length == 0 || length >= MAX_PATH) return L"C:\\Windows\\System32\\tar.exe";
    return std::wstring(buffer, length) + L"\\System32\\tar.exe";
}

std::wstring quote(const std::wstring& value) {
    std::wstring out = L"\"";
    for (const wchar_t ch : value) out.push_back(ch);
    out.push_back(L'"');
    return out;
}

int run_tool(const std::wstring& command) {
    std::vector<wchar_t> mutable_command(command.begin(), command.end());
    mutable_command.push_back(L'\0');
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION info{};
    const BOOL created = CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, FALSE,
                                        CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr,
                                        &startup, &info);
    if (!created) return -1;
    int code = 1;
    if (WaitForSingleObject(info.hProcess, 30000) == WAIT_TIMEOUT) {
        TerminateProcess(info.hProcess, 1);
        code = 2;
    } else {
        DWORD exit_code = 1;
        GetExitCodeProcess(info.hProcess, &exit_code);
        code = static_cast<int>(exit_code);
    }
    CloseHandle(info.hProcess);
    CloseHandle(info.hThread);
    return code;
}

/** 递归收集 root 下所有 `*-sources.jar`（排序、有上限）。 */
void collect_source_jars(const fs::path& root, std::vector<fs::path>& out, int depth = 0) {
    if (depth > 6 || out.size() >= kMaxJars) return;   // 深度上限：AE2 那种布局最多到 <子工程>/build/rfg
    std::error_code code;
    for (fs::directory_iterator it(root, code), end; it != end && !code; it.increment(code)) {
        if (out.size() >= kMaxJars) return;
        const auto& path = it->path();
        const auto name = path.filename().string();
        if (it->is_directory(code)) {
            // 跳过明显不是库的目录（.git 之类），其余照走 —— 产物在 build/rfg 这类目录里。
            if (name == ".git" || name == ".idea" || name == ".gradle" || name == "node_modules") continue;
            collect_source_jars(path, out, depth + 1);
            continue;
        }
        if (!it->is_regular_file(code)) continue;
        if (path.extension() != L".jar") continue;
        if (name.find("-sources") == std::string::npos) continue;
        out.push_back(path);
    }
}

bool read_text(const fs::path& file, std::string& out) {
    std::error_code code;
    const auto size = static_cast<std::size_t>(fs::file_size(file, code));
    if (code || size == 0 || size > kMaxSourceBytes) return false;
    std::ifstream stream(file, std::ios::binary);
    if (!stream) return false;
    out.assign(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
    return !out.empty();
}

void mark_read_only(const fs::path& file) {
    const DWORD attributes = GetFileAttributesW(file.c_str());
    if (attributes != INVALID_FILE_ATTRIBUTES)
        SetFileAttributesW(file.c_str(), attributes | FILE_ATTRIBUTE_READONLY);
}

}  // namespace

LibrarySource find_library_source(const fs::path& root, const fs::path& cache_root, const std::string& qualifier) {
    LibrarySource source;
    if (!valid_qualifier(qualifier)) {
        source.reason = "不是合法的全限定名";
        return source;
    }
    std::error_code code;
    if (!fs::is_directory(root, code) || code) {
        source.reason = "工作区不可用";
        return source;
    }
    std::string entry = qualifier;
    std::replace(entry.begin(), entry.end(), '.', '/');
    entry += ".java";

    std::vector<fs::path> jars;
    collect_source_jars(root, jars);
    if (jars.empty()) {
        source.reason = "工程里没有 *-sources.jar";
        return source;
    }
    std::sort(jars.begin(), jars.end());
    for (const auto& jar : jars) {
        const auto cached = cache_root / jar.stem() / fs::path(std::u8string(entry.begin(), entry.end()));
        std::string content;
        if (fs::is_regular_file(cached, code) && !code && read_text(cached, content)) {
            source.available = true;
            source.path = utf8_path(cached);
            source.jar = utf8_path(jar);
            source.entry = entry;
            source.content = std::move(content);
            return source;
        }
        std::error_code make_code;
        const auto directory = cached.parent_path();
        if (!fs::is_directory(directory, make_code)) {
            if (!fs::create_directories(directory, make_code) && make_code) continue;
        }
        // `tar -xf <jar> -C <缓存目录>/<jar 名> <条目>`：条目名原样落到该 jar 自己的缓存子目录里
        // （保留包路径）—— 每个 jar 一个子目录，同名的类不会互相覆盖。
        const std::wstring command = quote(tar_executable()) + L" -xf " + quote(jar.wstring()) + L" -C " +
                                     quote((cache_root / jar.stem()).wstring()) + L" " +
                                     quote(fs::path(std::u8string(entry.begin(), entry.end())).wstring());
        if (run_tool(command) == 0 && read_text(cached, content)) {
            mark_read_only(cached);
            source.available = true;
            source.path = utf8_path(cached);
            source.jar = utf8_path(jar);
            source.entry = entry;
            source.content = std::move(content);
            return source;
        }
    }
    source.reason = "在 " + std::to_string(jars.size()) + " 个 *-sources.jar 里没找到 " + entry;
    return source;
}

Json library_source_json(const LibrarySource& source) {
    if (!source.available) {
        Json answer{{"available", false}};
        if (!source.reason.empty()) answer["reason"] = source.reason;
        return answer;
    }
    return {{"available", true}, {"path", source.path}, {"jar", source.jar}, {"entry", source.entry},
            {"content", source.content}};
}

}  // namespace taocode
