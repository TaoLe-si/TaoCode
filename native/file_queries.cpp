#include "file_queries.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <string>
#include <vector>

#include "workspace.hpp"

namespace taocode {

namespace {

namespace fs = std::filesystem;

/**
 * `file.archiveEntries` 的三条上限。输入是**磁盘上的任意归档**（外部库那一面给的 jar），
 * 大小与条目数都不设上限的话，一条请求就能把桥上的 JSON 撑爆、或者让 bsdtar 跑不完。
 */
constexpr std::size_t kMaxArchiveEntries = 4000;
constexpr std::size_t kMaxArchiveOutput = 4 * 1024 * 1024;
constexpr long long kMaxArchiveBytes = 512LL * 1024 * 1024;
constexpr unsigned long long kArchiveTimeoutMs = 30000ULL;
constexpr DWORD kArchivePollStepMs = 50;

bool archive_extension_ok(const fs::path& path) {
    auto extension = path.extension().wstring();
    for (auto& ch : extension)
        ch = (ch >= L'A' && ch <= L'Z') ? static_cast<wchar_t>(ch + (L'a' - L'A')) : ch;
    return extension == L".jar" || extension == L".zip" || extension == L".war" ||
           extension == L".ear" || extension == L".apk";
}

/** Windows 10 1803 起自带的 bsdtar（与 `library_sources.cpp:56`、`plugins.cpp:250` 同一招）。 */
std::wstring tar_executable() {
    wchar_t buffer[MAX_PATH]{};
    const UINT length = GetWindowsDirectoryW(buffer, MAX_PATH);
    if (length == 0 || length >= MAX_PATH) return L"C:\\Windows\\System32\\tar.exe";
    return std::wstring(buffer, length) + L"\\System32\\tar.exe";
}

/**
 * 一个参数一段的 Win32 引号。**不经过 shell**：命令行只由 `CreateProcessW` 自己按 argv 规则拆，
 * 所以带空格与 `D:\` 盘符的路径原样进参数、不会被二次解释（bsdtar 在 shell 里吃反斜杠盘符的
 * 那个坑就是这么避开的）。路径里有引号或控制字符一律拒 —— 那是要往命令行里塞第二个参数。
 */
bool quote_arg(const std::wstring& value, std::wstring& out) {
    if (value.empty()) return false;
    for (const wchar_t ch : value)
        if (ch == L'"' || ch == L'\r' || ch == L'\n' || ch == L'\t' || ch == L'\0') return false;
    out = L"\"" + value + L"\"";
    return true;
}

struct ChildListing {
    bool started = false;
    bool timed_out = false;
    bool overflowed = false;
    int code = -1;
    std::string text;
};

/** `bsdtar -tf <archive>` 的 stdout（stderr 汇到同一条管道：成功时它是空的，失败时整份清单都不要）。 */
ChildListing run_tar_listing(const std::wstring& archive) {
    ChildListing out;
    std::wstring quoted_tool;
    std::wstring quoted_archive;
    if (!quote_arg(tar_executable(), quoted_tool) || !quote_arg(archive, quoted_archive)) return out;
    const std::wstring command = quoted_tool + L" -tf " + quoted_archive;
    std::vector<wchar_t> mutable_command(command.begin(), command.end());
    mutable_command.push_back(L'\0');

    SECURITY_ATTRIBUTES attributes{};
    attributes.nLength = sizeof(SECURITY_ATTRIBUTES);
    attributes.bInheritHandle = TRUE;
    HANDLE read_handle = nullptr;
    HANDLE write_handle = nullptr;
    if (!CreatePipe(&read_handle, &write_handle, &attributes, 0)) return out;
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    startup.hStdOutput = write_handle;
    startup.hStdError = write_handle;
    startup.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION info{};
    const BOOL created = CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, TRUE,
                                        CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr,
                                        &startup, &info);
    CloseHandle(write_handle);   // 父进程这一半不关，管道永远读不到 EOF
    if (!created) { CloseHandle(read_handle); return out; }
    out.started = true;

    const unsigned long long deadline = GetTickCount64() + kArchiveTimeoutMs;
    for (;;) {
        DWORD available = 0;
        if (!PeekNamedPipe(read_handle, nullptr, 0, nullptr, &available, nullptr)) break;
        if (available > 0) {
            char buffer[8192];
            DWORD got = 0;
            if (!ReadFile(read_handle, buffer, sizeof(buffer), &got, nullptr) || got == 0) break;
            out.text.append(buffer, got);
            if (out.text.size() >= kMaxArchiveOutput) { out.overflowed = true; break; }
            continue;
        }
        if (WaitForSingleObject(info.hProcess, kArchivePollStepMs) == WAIT_TIMEOUT) {
            if (GetTickCount64() > deadline) { TerminateProcess(info.hProcess, 1); out.timed_out = true; break; }
            continue;
        }
        if (!PeekNamedPipe(read_handle, nullptr, 0, nullptr, &available, nullptr) || available == 0) break;
    }
    if (out.overflowed || out.timed_out) TerminateProcess(info.hProcess, 1);
    DWORD exit_code = 1;
    GetExitCodeProcess(info.hProcess, &exit_code);
    out.code = static_cast<int>(exit_code);
    CloseHandle(info.hProcess);
    CloseHandle(info.hThread);
    CloseHandle(read_handle);
    return out;
}

/** `-tf` 的文本 → 档案内路径清单：分隔符一律 `/`，去掉 `./` 前缀，条目数封顶。 */
std::vector<std::string> split_listing(const std::string& text, bool& truncated) {
    std::vector<std::string> lines;
    std::size_t start = 0;
    while (start < text.size()) {
        const std::size_t end = text.find('\n', start);
        const bool last = end == std::string::npos;
        auto line = text.substr(start, (last ? text.size() : end) - start);
        start = last ? text.size() : end + 1;
        if (!line.empty() && line.back() == '\r') line.pop_back();
        std::replace(line.begin(), line.end(), '\\', '/');
        while (line.rfind("./", 0) == 0) line.erase(0, 2);
        if (line.empty()) continue;
        if (lines.size() >= kMaxArchiveEntries) { truncated = true; break; }
        lines.push_back(std::move(line));
    }
    return lines;
}

/**
 * `file.archiveEntries` 的答复。上游那一面是 `ArchiveFileSystem`（`jar://` 把归档当一个目录）：
 * `platform/ide-core/src/com/intellij/openapi/vfs/JarFileSystem.java:10-12` 的协议与 `!/` 分隔符、
 * `platform/analysis-api/src/com/intellij/openapi/vfs/newvfs/ArchiveFileSystem.java:92` 的
 * `composeRootPath`（`"/x/y.jar" -> "/x/y.jar!/"`）。**只有条目名**，内容不读 ——
 * 上游 `ArchiveFileSystem.java:99-100` 一类写操作是直接抛「归档不支持修改」的，这里同样只给清单。
 *
 * 入参是**绝对路径**（与 `shell.reveal` 用的 `reveal_absolute` 同一档口径：本通道不在
 * `Workspace` 的相对路径沙箱里，工作区根由前端拼）。因此这里自己守住：必须存在、必须是归档、
 * 大小封顶，且**只列条目名**，不读内容、不落盘。
 */
Json archive_entries(const Json& params) {
    const auto raw = params.value("path", std::string());
    Json answer{{"available", false}};
    answer["archive"] = [&raw] { auto copy = raw; std::replace(copy.begin(), copy.end(), '\\', '/'); return copy; }();
    if (raw.empty()) { answer["reason"] = "没给归档路径。"; return answer; }
    std::error_code code;
    const fs::path archive = fs::u8path(raw);
    if (!archive.is_absolute()) { answer["reason"] = "要给归档的绝对路径。"; return answer; }
    if (!archive_extension_ok(archive)) {
        answer["reason"] = "不是可列出的归档类型（.jar/.zip/.war/.ear/.apk）。";
        return answer;
    }
    if (!fs::is_regular_file(archive, code) || code) { answer["reason"] = "读不到这个归档（不存在或不是普通文件）。"; return answer; }
    const auto size = static_cast<long long>(fs::file_size(archive, code));
    if (code) { answer["reason"] = "读不到这个归档的大小。"; return answer; }
    if (size == 0) { answer["reason"] = "归档是空文件。"; return answer; }
    if (size > kMaxArchiveBytes) { answer["reason"] = "归档超过 512 MiB 上限，不列条目。"; return answer; }

    const auto listing = run_tar_listing(archive.native());
    if (!listing.started) { answer["reason"] = "起不了 bsdtar（系统里找不到 System32\\tar.exe）。"; return answer; }
    if (listing.timed_out) { answer["reason"] = "列条目超时（30 秒）。"; return answer; }
    if (listing.code != 0) {
        answer["reason"] = "列不出条目（bsdtar 退出码 " + std::to_string(listing.code) + "）。";
        return answer;
    }
    bool truncated = listing.overflowed;
    answer["available"] = true;
    answer["lines"] = split_listing(listing.text, truncated);
    answer["truncated"] = truncated;
    return answer;
}

}  // namespace

bool dispatch_file_query(const std::string& method, const Json& params, Workspace& workspace, Json& result) {
    // 按名字比较就够：这一组只有八条，而且**故意不并进 main.cpp 的哈希分派表**（那张表是
    // `Method` union 的机检锚点，见 docs/native-dispatch.md；这里少一条 case 就少一次对齐成本）。
    const auto text = [&params](const char* key) { return params.at(key).get<std::string>(); };
    if (method == "file.readOnly") {
        result = workspace.set_read_only(text("path"), params.value("readOnly", true));
        return true;
    }
    if (method == "file.lineSeparators") {
        result = workspace.convert_line_separators(text("path"), text("separator"), text("content"), text("expectedVersion"));
        return true;
    }
    if (method == "file.readBinary") {
        result = workspace.read_binary(text("path"), params.value("limit", std::size_t{1024 * 1024}));
        return true;
    }
    // Safe delete: "is anything still referring to this?" answered by a real
    // workspace scan (file + line + preview), so the confirm dialog can show
    // the same rows IDEA's Safe Delete dialog would.
    if (method == "file.usages") {
        result = workspace.usages_of(text("path"), params.value("symbol", std::string()));
        return true;
    }
    if (method == "file.reveal") {
        result = workspace.reveal(text("path"));
        return true;
    }
    // RevealFileAction for absolute paths: the welcome screen has no workspace yet
    // (welcomeScreen/projectActions/RevealProjectDirAction.kt:25-33).
    if (method == "shell.reveal") {
        result = reveal_absolute(text("path"));
        return true;
    }
    // 归档条目清单（上游 `ArchiveFileSystem` 的 `jar://…!/`：归档当一个目录）。
    // 走这一族而不是 `Workspace` 的那五条：外部库的 jar 路径要绝对路径，而 main.cpp 有 2000 行
    // 硬上限、加不了 case（见 docs/batch-2026-10-06-bucket15j.md 的落点说明）。
    if (method == "file.archiveEntries") {
        result = archive_entries(params);
        return true;
    }
    // LSP `documentLink.target` 与控制台输出里的 URL：交给系统默认处理器打开。
    // `open_external` 会**拒绝没有协议前缀的字符串** —— 那是一个安全边界，见 workspace.cpp。
    if (method == "shell.openUrl") {
        result = open_external(text("url"));
        return true;
    }
    return false;
}

}  // namespace taocode
