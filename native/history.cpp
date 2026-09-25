// Local History engine: an on-disk, Git-independent snapshot store.
// See history.hpp for the store layout and the public contract.
#include "history.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <limits>
#include <optional>
#include <string_view>
#include <utility>
#include <vector>

namespace taocode::history {
namespace {
namespace fs = std::filesystem;

// 与工作区一致的文本上限：快照只会保存已经通过 file.write 校验的内容。
constexpr std::size_t max_bytes = 16 * 1024 * 1024;
constexpr std::size_t max_reason_bytes = 64;
constexpr std::size_t max_id_length = 64;
constexpr std::size_t max_index_versions = 512;  // 读取损坏索引时的硬上限，也是版本数上限
constexpr std::size_t sha256_hex_length = 64;
// LCS 动态规划预算（方向表约 (a+1)*(b+1) 字节）。超预算时退化为整段替换，
// 输出仍是合法的 unified diff，但不会为巨型文件分配上百 MB 内存。
constexpr std::size_t diff_cell_budget = 8'000'000;
constexpr std::size_t diff_context = 3;
constexpr const wchar_t* index_name = L"index.json";

[[noreturn]] void fail(const char* code, const std::string& message) {
    throw WorkspaceError(code, message);
}

[[noreturn]] void win_error(const std::string& message, DWORD error = GetLastError()) {
    const char* code = "IO_ERROR";
    switch (error) {
    case ERROR_FILE_NOT_FOUND:
    case ERROR_PATH_NOT_FOUND: code = "NOT_FOUND"; break;
    case ERROR_ACCESS_DENIED:
    case ERROR_PRIVILEGE_NOT_HELD: code = "ACCESS_DENIED"; break;
    case ERROR_SHARING_VIOLATION:
    case ERROR_LOCK_VIOLATION: code = "FILE_BUSY"; break;
    case ERROR_INVALID_NAME:
    case ERROR_BAD_PATHNAME:
    case ERROR_FILENAME_EXCED_RANGE: code = "INVALID_PATH"; break;
    case ERROR_DIRECTORY: code = "NOT_DIRECTORY"; break;
    default: break;
    }
    fail(code, message + "（Windows 错误 " + std::to_string(error) + "）");
}

template <class Operation>
auto boundary(Operation&& operation) -> decltype(operation()) {
    try {
        return operation();
    } catch (const WorkspaceError&) {
        throw;
    } catch (const Json::exception&) {
        fail("HISTORY_CORRUPT", "本地历史索引无法解析，请重新保存该文件。");
    } catch (const fs::filesystem_error&) {
        fail("IO_ERROR", "本地历史存储发生文件系统错误。");
    } catch (const std::exception&) {
        fail("INTERNAL_ERROR", "本地历史处理请求时发生内部错误。");
    }
}

class Handle {
public:
    explicit Handle(HANDLE value = nullptr) noexcept : value_(value) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value_(std::exchange(other.value_, nullptr)) {}
    Handle& operator=(Handle&& other) noexcept {
        if (this != &other) {
            reset();
            value_ = std::exchange(other.value_, nullptr);
        }
        return *this;
    }
    HANDLE get() const noexcept { return value_; }
    explicit operator bool() const noexcept { return value_ != nullptr && value_ != INVALID_HANDLE_VALUE; }
    void reset() noexcept {
        if (*this) CloseHandle(value_);
        value_ = nullptr;
    }
private:
    HANDLE value_ = nullptr;
};

bool valid_utf8(const std::string& text) {
    if (text.empty()) return true;
    if (text.size() > static_cast<std::size_t>((std::numeric_limits<int>::max)())) return false;
    return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(),
                               static_cast<int>(text.size()), nullptr, 0) != 0;
}

void validate_content(const std::string& content) {
    if (content.size() > max_bytes)
        fail("FILE_TOO_LARGE", "本地历史快照超过 16 MiB 限制。");
    if (content.find('\0') != std::string::npos)
        fail("BINARY_FILE", "内容含有 NUL 字节，不能作为本地历史保存。");
    if (!valid_utf8(content))
        fail("INVALID_UTF8", "内容不是有效的 UTF-8 文本。");
}

std::wstring api_path(const fs::path& path) {
    const auto native = path.native();
    if (native.starts_with(L"\\\\?\\")) return native;
    if (native.starts_with(L"\\\\")) return L"\\\\?\\UNC\\" + native.substr(2);
    return L"\\\\?\\" + native;
}

std::wstring wide_key(const std::string& ascii) {
    return std::wstring(ascii.begin(), ascii.end());  // 只用于十六进制与数字标识
}

bool equal_name(std::wstring_view left, std::wstring_view right) {
    return CompareStringOrdinal(left.data(), static_cast<int>(left.size()),
                                right.data(), static_cast<int>(right.size()), TRUE) == CSTR_EQUAL;
}

fs::path plain_path(std::wstring path) {
    if (path.starts_with(L"\\\\?\\UNC\\")) {
        path = L"\\\\" + path.substr(8);
    } else if (path.starts_with(L"\\\\?\\")) {
        if (path.size() < 7 || path[4] == L'?' || path[5] != L':')
            fail("INVALID_PATH", "本地历史只允许普通盘符或 UNC 路径，不允许设备命名空间。");
        path.erase(0, 4);
    }
    auto result = fs::path(std::move(path)).lexically_normal();
    while (result.has_relative_path() && result.filename().empty()) result = result.parent_path();
    return result;
}

// `path` 位于（或等于）`root` 之内。
bool within(const fs::path& path, const fs::path& root) {
    auto actual = path.begin();
    for (auto expected = root.begin(); expected != root.end(); ++expected, ++actual) {
        if (actual == path.end() || !equal_name(actual->native(), expected->native())) return false;
    }
    return true;
}

void check_within(HANDLE handle, const fs::path& root) {
    const DWORD size = GetFinalPathNameByHandleW(handle, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (!size) win_error("无法核对历史文件路径");
    std::wstring name(size, L'\0');
    const DWORD length = GetFinalPathNameByHandleW(handle, name.data(), size,
                                                   FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (!length) win_error("无法核对历史文件路径");
    if (length >= size) fail("IO_ERROR", "核对历史文件路径时路径发生了变化。");
    name.resize(length);
    if (!within(plain_path(std::move(name)), root))
        fail("PATH_ESCAPE", "历史文件不在存储根目录内，已拒绝访问。");
}

std::string hex(const UCHAR* bytes, std::size_t count) {
    constexpr char digits[] = "0123456789abcdef";
    std::string result(count * 2, '0');
    for (std::size_t i = 0; i < count; ++i) {
        result[2 * i] = digits[bytes[i] >> 4];
        result[2 * i + 1] = digits[bytes[i] & 15];
    }
    return result;
}

void crypto_check(NTSTATUS status) {
    if (status < 0) fail("CRYPTO_ERROR", "Windows 加密服务无法完成历史指纹计算。");
}

std::string fingerprint(std::string_view content) {
    struct State {
        BCRYPT_ALG_HANDLE algorithm = nullptr;
        BCRYPT_HASH_HANDLE hash = nullptr;
        std::vector<UCHAR> object;
        ~State() {
            if (hash) BCryptDestroyHash(hash);
            if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
        }
    } state;
    crypto_check(BCryptOpenAlgorithmProvider(&state.algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0));
    DWORD size = 0;
    DWORD returned = 0;
    crypto_check(BCryptGetProperty(state.algorithm, BCRYPT_OBJECT_LENGTH,
                                   reinterpret_cast<PUCHAR>(&size), sizeof(size), &returned, 0));
    state.object.resize(size);
    crypto_check(BCryptCreateHash(state.algorithm, &state.hash, state.object.data(), size, nullptr, 0, 0));
    if (!content.empty())
        crypto_check(BCryptHashData(state.hash,
                                    reinterpret_cast<PUCHAR>(const_cast<char*>(content.data())),
                                    static_cast<ULONG>(content.size()), 0));
    std::array<UCHAR, 32> digest{};
    crypto_check(BCryptFinishHash(state.hash, digest.data(), static_cast<ULONG>(digest.size()), 0));
    return hex(digest.data(), digest.size());
}

// ---- 路径映射与时间 -------------------------------------------------------------

// 工作区相对路径 -> 规范化的 '/' 路径文本（保留原大小写用于展示）。
std::string normalize_relative(const std::string& relative) {
    if (relative.find('\0') != std::string::npos || !valid_utf8(relative))
        fail("INVALID_PATH", "路径必须是没有 NUL 字节的 UTF-8 文本。");
    if (!relative.empty() && (relative.front() == '/' || relative.front() == '\\'))
        fail("INVALID_PATH", "本地历史只接受工作区相对路径。");
    if (relative.find(':') != std::string::npos)
        fail("INVALID_PATH", "本地历史不接受盘符或 NTFS 数据流名称。");
    std::string portable = relative;
    std::replace(portable.begin(), portable.end(), '\\', '/');
    std::vector<std::string> parts;
    std::size_t start = 0;
    for (;;) {
        auto end = portable.find('/', start);
        const bool last = end == std::string::npos;
        if (last) end = portable.size();
        auto part = portable.substr(start, end - start);
        if (!part.empty() && part != ".") {
            if (part == "..") fail("INVALID_PATH", "本地历史不接受上级目录跳转。");
            if (part.size() > 255) fail("INVALID_PATH", "路径中含过长的目录或文件名。");
            if (part.find_first_of("<>\"|?") != std::string::npos)
                fail("INVALID_PATH", "路径中含 Windows 非法字符。");
            parts.push_back(std::move(part));
        }
        if (last) break;
        start = end + 1;
    }
    if (parts.empty()) fail("INVALID_PATH", "本地历史需要一个明确的文件路径。");
    std::string result;
    for (const auto& part : parts) {
        if (!result.empty()) result += '/';
        result += part;
    }
    if (result.size() > 2048) fail("INVALID_PATH", "文件路径过长。");
    return result;
}

std::string path_key(const std::string& path) {
    std::string folded = path;
    std::transform(folded.begin(), folded.end(), folded.begin(),
                   [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
    return fingerprint(folded);  // NTFS 大小写不敏感：同一文件必须落到同一条时间线
}

fs::path file_directory(const fs::path& root, const std::string& path) {
    return root / L"files" / fs::path(wide_key(path_key(path)));
}

// 快照文件名即 id：'<epochMillis>-<seq>'，因此 stem == 完整文件名，无扩展名歧义。
bool valid_id(std::string_view id) {
    if (id.empty() || id.size() > max_id_length) return false;
    std::size_t dashes = 0;
    std::size_t digits = 0;
    for (const char ch : id) {
        if (ch == '-') { ++dashes; continue; }
        if (ch < '0' || ch > '9') return false;
        ++digits;
    }
    return dashes == 1 && digits >= 2 && digits < max_id_length;
}

std::string sanitize_reason(std::string_view reason) {
    std::string text;
    for (const char ch : reason) {
        const auto byte = static_cast<unsigned char>(ch);
        if (byte >= 0x20 && byte != 0x7f) text.push_back(ch);
    }
    if (!valid_utf8(text)) fail("INVALID_REQUEST", "本地历史原因必须是有效的 UTF-8 文本。");
    if (text.empty()) return "save";
    if (text.size() <= max_reason_bytes) return text;
    // 截断不得切碎 UTF-8 码点：末尾不完整的序列整段丢弃。
    std::string cut = text.substr(0, max_reason_bytes);
    std::size_t end = cut.size();
    while (end > 0 && (static_cast<unsigned char>(cut[end - 1]) & 0xC0) == 0x80) --end;
    if (end > 0) {
        const auto lead = static_cast<unsigned char>(cut[end - 1]);
        const std::size_t need = lead < 0x80 ? 1 : (lead & 0xE0) == 0xC0 ? 2
                              : (lead & 0xF0) == 0xE0 ? 3 : 4;
        if (cut.size() - (end - 1) < need) cut.erase(end - 1);
    }
    return cut;
}

long long now_millis() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch()).count();
}

std::string iso8601(long long millis) {
    if (millis <= 0) return {};
    const std::time_t seconds = static_cast<std::time_t>(millis / 1000);
    std::tm parts{};
    if (gmtime_s(&parts, &seconds) != 0) return {};
    char buffer[40];
    std::snprintf(buffer, sizeof(buffer), "%04d-%02d-%02dT%02d:%02d:%02d.%03lldZ",
                  parts.tm_year + 1900, parts.tm_mon + 1, parts.tm_mday, parts.tm_hour,
                  parts.tm_min, parts.tm_sec, static_cast<long long>(millis % 1000));
    return buffer;
}

// ---- 落盘 IO --------------------------------------------------------------------

void create_one(const fs::path& directory) {
    if (CreateDirectoryW(api_path(directory).c_str(), nullptr)) return;
    // A pre-existing directory — including a drive root like \\?\C:\, which answers
    // ERROR_ACCESS_DENIED rather than ALREADY_EXISTS — is success: nothing to create.
    const auto attributes = GetFileAttributesW(api_path(directory).c_str());
    if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY)) {
        if (attributes & FILE_ATTRIBUTE_REPARSE_POINT)
            fail("REPARSE_POINT", "本地历史目录含有符号链接或重解析点，已拒绝访问。");
        return;
    }
    win_error("无法创建本地历史目录");
}

void create_tree(const fs::path& directory) {
    auto cursor = directory.root_path();
    if (cursor.empty()) fail("INVALID_PATH", "本地历史存储根目录必须是绝对路径。");
    create_one(cursor);
    for (const auto& part : directory.relative_path()) {
        if (part.empty()) continue;
        cursor /= part;
        create_one(cursor);
    }
}

std::optional<Handle> open_read(const fs::path& path, const fs::path& root) {
    Handle handle(CreateFileW(api_path(path).c_str(), GENERIC_READ,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                              OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (!handle) {
        const auto error = GetLastError();
        if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND || error == ERROR_NO_MORE_FILES)
            return std::nullopt;
        win_error("无法打开历史文件", error);
    }
    BY_HANDLE_FILE_INFORMATION info{};
    if (!GetFileInformationByHandle(handle.get(), &info)) win_error("无法读取历史文件属性");
    if (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
        fail("REPARSE_POINT", "历史文件是重解析点，已拒绝读取。");
    if ((info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_DEVICE)) ||
        GetFileType(handle.get()) != FILE_TYPE_DISK)
        fail("NOT_FILE", "历史条目不是正规文件。");
    check_within(handle.get(), root);
    return handle;
}

std::optional<std::string> read_history_file(const fs::path& path, const fs::path& root) {
    auto handle = open_read(path, root);
    if (!handle) return std::nullopt;
    LARGE_INTEGER length{};
    if (!GetFileSizeEx(handle->get(), &length)) win_error("无法读取历史文件大小");
    if (length.QuadPart < 0 || static_cast<std::size_t>(length.QuadPart) > max_bytes)
        fail("FILE_TOO_LARGE", "历史文件超过 16 MiB 限制。");
    std::string content;
    content.reserve(static_cast<std::size_t>(length.QuadPart));
    std::array<char, 65536> buffer{};
    for (;;) {
        DWORD got = 0;
        if (!ReadFile(handle->get(), buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr))
            win_error("读取历史文件失败");
        if (!got) break;
        content.append(buffer.data(), got);
        if (content.size() > max_bytes) fail("FILE_TOO_LARGE", "历史文件超过 16 MiB 限制。");
    }
    return content;
}

bool is_regular_file(const fs::path& path, const fs::path& root) {
    const auto attributes = GetFileAttributesW(api_path(path).c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES) return false;
    if (attributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) return false;
    return within(plain_path(path.native()), root);
}

void write_all(HANDLE handle, std::string_view content, const char* what) {
    std::size_t offset = 0;
    while (offset < content.size()) {
        DWORD written = 0;
        if (!WriteFile(handle, const_cast<char*>(content.data()) + offset,
                       static_cast<DWORD>(content.size() - offset), &written, nullptr))
            win_error(std::string("写入") + what + "失败");
        if (!written) fail("IO_ERROR", std::string("写入") + what + "时未能继续写入。");
        offset += written;
    }
    if (!FlushFileBuffers(handle)) win_error(std::string("无法将") + what + "刷新到磁盘");
}

// 快照是只写一次的不可变文件；名字已存在即失败，由调用方推进序号。
bool write_snapshot_new(const fs::path& path, std::string_view content, const fs::path& root) {
    Handle handle(CreateFileW(api_path(path).c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr,
                              CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!handle) {
        const auto error = GetLastError();
        if (error == ERROR_FILE_EXISTS || error == ERROR_ALREADY_EXISTS) return false;
        win_error("无法创建历史快照", error);
    }
    check_within(handle.get(), root);
    write_all(handle.get(), content, "历史快照");
    return true;
}

// 索引整体重写：同目录临时文件 + 原子替换，读者永远看不到半截 JSON。
void write_index_atomic(const fs::path& directory, std::string_view payload, const fs::path& root) {
    static unsigned long long revision = 0;
    const auto target = directory / index_name;
    const auto existing = GetFileAttributesW(api_path(target).c_str());
    if (existing != INVALID_FILE_ATTRIBUTES && (existing & FILE_ATTRIBUTE_REPARSE_POINT))
        fail("REPARSE_POINT", "历史索引是重解析点，已拒绝写入。");
    const auto temp = directory / (std::wstring(index_name) + L"." +
                                   std::to_wstring(GetCurrentProcessId()) + L"-" +
                                   std::to_wstring(++revision) + L".tmp");
    {
        Handle handle(CreateFileW(api_path(temp).c_str(), GENERIC_WRITE, 0, nullptr,
                                  CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr));
        if (!handle) win_error("无法创建历史索引临时文件");
        check_within(handle.get(), root);
        write_all(handle.get(), payload, "历史索引");
    }
    if (!MoveFileExW(api_path(temp).c_str(), api_path(target).c_str(),
                     MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        const auto error = GetLastError();
        DeleteFileW(api_path(temp).c_str());
        win_error("无法更新历史索引", error);
    }
}

// ---- 版本索引 -------------------------------------------------------------------

struct Version {
    std::string id;
    long long millis = 0;
    unsigned long long seq = 0;
    std::size_t bytes = 0;
    std::string reason;
    std::string sha;
    std::string time;
};

std::string text_at(const Json& item, const char* key, std::string fallback) {
    return item.contains(key) && item.at(key).is_string() ? item.at(key).get<std::string>() : std::move(fallback);
}

long long millis_at(const Json& item, const char* key) {
    return item.contains(key) && item.at(key).is_number_integer() ? item.at(key).get<long long>() : 0;
}

unsigned long long count_at(const Json& item, const char* key) {
    return item.contains(key) && item.at(key).is_number_unsigned() ? item.at(key).get<unsigned long long>() : 0;
}

//  newest first; 缺失或损坏的条目直接忽略。
std::vector<Version> load_index(const fs::path& directory, const fs::path& root) {
    std::vector<Version> versions;
    const auto raw = read_history_file(directory / index_name, root);
    if (!raw) return versions;
    const Json parsed = Json::parse(*raw, nullptr, false);
    if (parsed.is_discarded() || !parsed.is_object() ||
        !parsed.contains("versions") || !parsed.at("versions").is_array())
        return versions;  // 损坏的索引等同于没有历史：下一次 record 会整体重写它
    for (const auto& item : parsed.at("versions")) {
        if (!item.is_object()) continue;
        Version version;
        version.id = text_at(item, "id", {});
        version.sha = text_at(item, "sha", {});
        if (!valid_id(version.id) || version.sha.size() != sha256_hex_length) continue;
        version.reason = text_at(item, "reason", "save");
        version.time = text_at(item, "time", {});
        version.millis = millis_at(item, "millis");
        version.seq = count_at(item, "seq");
        version.bytes = static_cast<std::size_t>(count_at(item, "bytes"));
        versions.push_back(std::move(version));
        if (versions.size() >= max_index_versions) break;
    }
    return versions;
}

void save_index(const fs::path& directory, const fs::path& root, const std::string& path,
                std::size_t max_versions, const std::vector<Version>& versions) {
    Json list = Json::array();
    for (const auto& version : versions) {
        list.push_back({{"id", version.id}, {"millis", version.millis}, {"seq", version.seq},
                        {"bytes", version.bytes}, {"reason", version.reason},
                        {"sha", version.sha}, {"time", version.time}});
    }
    const Json payload{{"path", path}, {"maxVersions", max_versions}, {"versions", std::move(list)}};
    write_index_atomic(directory, payload.dump(1), root);
}

Json entry_of(const Version& version) {
    return {{"id", version.id}, {"reason", version.reason}, {"bytes", version.bytes},
            {"timeMillis", version.millis}, {"time", version.time}};
}

fs::path snapshot_path(const fs::path& directory, const Version& version) {
    return directory / fs::path(wide_key(version.id));
}

void erase_snapshot(const fs::path& directory, const Version& version) {
    if (DeleteFileW(api_path(snapshot_path(directory, version)).c_str())) return;
    const auto error = GetLastError();
    if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND && error != ERROR_ACCESS_DENIED)
        win_error("无法删除过期的历史快照", error);
}

// 丢弃快照文件已被外部清理的条目，保持索引与磁盘一致。
void drop_orphans(const fs::path& directory, const fs::path& root, std::vector<Version>& versions) {
    std::vector<Version> kept;
    kept.reserve(versions.size());
    for (auto& version : versions) {
        if (!is_regular_file(snapshot_path(directory, version), root)) continue;
        kept.push_back(std::move(version));
    }
    versions.swap(kept);
}

std::size_t clamp_max_versions(std::size_t requested) {
    if (requested == 0) fail("INVALID_SETTINGS", "本地历史每个文件至少需要保留 1 个版本。");
    return requested > max_index_versions ? max_index_versions : requested;
}

// 定位一个版本并读回它的字节（含 SHA-256 完整性校验）。
Version take_version(const fs::path& root, const fs::path& directory, const std::string& path,
                     const std::string& id, std::string& content) {
    if (!valid_id(id)) fail("NOT_FOUND", "本地历史版本标识无效：\"" + id + "\"。");
    for (const auto& version : load_index(directory, root)) {
        if (version.id != id) continue;
        const auto raw = read_history_file(snapshot_path(directory, version), root);
        if (!raw) fail("NOT_FOUND", "本地历史快照已丢失：" + path + " @" + id + "。");
        content = *raw;
        if (fingerprint(content) != version.sha)
            fail("HISTORY_CORRUPT", "本地历史快照校验失败：" + path + " @" + id + "。");
        return version;
    }
    fail("NOT_FOUND", "该文件没有此本地历史版本：" + path + " @" + id + "。");
}

// ---- 行级 unified diff ------------------------------------------------------------

std::string_view trim_cr(std::string_view line) {
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
    return line;
}

std::vector<std::string_view> split_lines(std::string_view text) {
    std::vector<std::string_view> lines;
    std::size_t start = 0;
    for (;;) {
        const auto end = text.find('\n', start);
        if (end == std::string_view::npos) {
            if (start < text.size()) lines.push_back(trim_cr(text.substr(start)));
            return lines;
        }
        lines.push_back(trim_cr(text.substr(start, end - start)));
        start = end + 1;
    }
}

struct Row {
    char kind;            // ' ' 上下文，'-' 删除，'+' 新增
    std::string_view text;
    std::size_t a;        // 该行的 a 游标：0 起行号，新增行是插入位置
    std::size_t b;
    std::size_t hunk = 0;   // 增删段不得跨块配对（unified 解析器按 @@ 递增）
};

// 标准 LCS 回溯；先剥离公共前后缀，让常见编辑只对小窗口做动态规划。
std::vector<Row> build_script(const std::vector<std::string_view>& a,
                              const std::vector<std::string_view>& b) {
    std::size_t head = 0;
    while (head < a.size() && head < b.size() && a[head] == b[head]) ++head;
    std::size_t tail = 0;
    while (tail + head < a.size() && tail + head < b.size() &&
           a[a.size() - 1 - tail] == b[b.size() - 1 - tail]) ++tail;
    const std::size_t n = a.size() - head - tail;
    const std::size_t m = b.size() - head - tail;

    std::vector<Row> script;
    script.reserve(a.size() + 1);
    for (std::size_t i = 0; i < head; ++i) script.push_back({' ', a[i], i, i});

    const bool feasible = n == 0 || m == 0 || n + 1 <= diff_cell_budget / (m + 1);
    std::vector<std::uint8_t> direction;
    if (feasible) {
        direction.assign((n + 1) * (m + 1), 0);
        std::vector<std::uint32_t> next(m + 1, 0);
        std::vector<std::uint32_t> current(m + 1, 0);
        for (std::size_t i = n; i-- > 0;) {
            current[m] = 0;
            for (std::size_t j = m; j-- > 0;) {
                std::uint8_t move = 0;
                std::uint32_t length = 0;
                if (a[head + i] == b[head + j]) { move = 1; length = next[j + 1] + 1; }
                else if (next[j] >= current[j + 1]) { move = 2; length = next[j]; }
                else { move = 3; length = current[j + 1]; }
                direction[i * (m + 1) + j] = move;
                current[j] = length;
            }
            next.swap(current);
        }
    }
    // 超预算时 move 恒为 2：先删空 a 的中间段，再整体插入 b 的中间段。
    std::size_t i = 0;
    std::size_t j = 0;
    while (i < n && j < m) {
        const auto move = feasible ? direction[i * (m + 1) + j] : std::uint8_t{2};
        if (move == 1) { script.push_back({' ', a[head + i], head + i, head + j}); ++i; ++j; }
        else if (move == 2) { script.push_back({'-', a[head + i], head + i, head + j}); ++i; }
        else { script.push_back({'+', b[head + j], head + i, head + j}); ++j; }
    }
    while (i < n) { script.push_back({'-', a[head + i], head + i, head + j}); ++i; }
    while (j < m) { script.push_back({'+', b[head + j], head + i, head + j}); ++j; }
    for (std::size_t k = 0; k < tail; ++k) {
        const std::size_t ai = a.size() - tail + k;
        const std::size_t bi = b.size() - tail + k;
        script.push_back({' ', a[ai], ai, bi});
    }
    return script;
}

std::string render_hunks(const std::vector<Row>& script) {
    std::vector<char> keep(script.size(), 0);
    for (std::size_t index = 0; index < script.size(); ++index) {
        if (script[index].kind == ' ') continue;
        const std::size_t from = index > diff_context ? index - diff_context : 0;
        const std::size_t to = index + diff_context < script.size() ? index + diff_context : script.size() - 1;
        for (std::size_t k = from; k <= to; ++k) keep[k] = 1;
    }
    std::string out;
    std::size_t index = 0;
    while (index < script.size()) {
        if (!keep[index]) { ++index; continue; }
        const std::size_t begin = index;
        while (index < script.size() && keep[index]) ++index;
        std::size_t a_count = 0;
        std::size_t b_count = 0;
        for (std::size_t k = begin; k < index; ++k) {
            if (script[k].kind != '+') ++a_count;
            if (script[k].kind != '-') ++b_count;
        }
        // 纯新增/纯删除的块按 git 惯例报告“插入发生在哪一行之后”。
        const std::size_t a_start = a_count ? script[begin].a + 1 : script[begin].a;
        const std::size_t b_start = b_count ? script[begin].b + 1 : script[begin].b;
        char header[96];
        std::snprintf(header, sizeof(header), "@@ -%zu,%zu +%zu,%zu @@\n",
                      a_start, a_count, b_start, b_count);
        out += header;
        for (std::size_t k = begin; k < index; ++k) {
            out.push_back(script[k].kind);
            out.append(script[k].text);
            out.push_back('\n');
        }
    }
    return out;
}

}  // namespace

History::History(std::filesystem::path store_root, std::size_t max_versions_per_file)
    : store_root_(std::move(store_root)), max_versions_(clamp_max_versions(max_versions_per_file)) {
    if (store_root_.empty() || !store_root_.is_absolute() ||
        store_root_.native().find(L'\0') != std::wstring::npos)
        throw WorkspaceError("INVALID_PATH", "本地历史存储根目录必须是绝对路径。");
    // Materialise the store first with normal parsing (which resolves any 8.3 short
    // prefix like C:\Users\ADMINI~1), then read back the real path. Under the \\?\
    // namespace Windows does NOT resolve short names, so we must store the long form
    // now or every later create/open would collide with a protected ancestor.
    std::error_code ec;
    std::filesystem::create_directories(store_root_, ec);
    if (HANDLE probe = CreateFileW(store_root_.c_str(), FILE_READ_ATTRIBUTES,
                                   FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                   OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
        probe != INVALID_HANDLE_VALUE) {
        wchar_t buffer[32768];
        const DWORD length = GetFinalPathNameByHandleW(probe, buffer, 32768, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
        CloseHandle(probe);
        if (length > 0 && length < 32768) store_root_ = plain_path(std::wstring(buffer, length));
    }
    store_root_ = plain_path(store_root_.native());
}

void History::record(const std::string& rel_path, const std::string& content, const std::string& reason) {
    boundary([&] {
        std::lock_guard lock(mutex_);
        const auto path = normalize_relative(rel_path);
        validate_content(content);
        const auto sha = fingerprint(content);
        const auto label = sanitize_reason(reason);
        const auto directory = file_directory(store_root_, path);
        auto versions = load_index(directory, store_root_);
        drop_orphans(directory, store_root_, versions);
        auto trim = [&] {
            bool changed = false;
            while (versions.size() > max_versions_) {  // 丢弃最旧的快照，维持每个文件的上限
                erase_snapshot(directory, versions.back());
                versions.pop_back();
                changed = true;
            }
            return changed;
        };
        if (!versions.empty() && versions.front().sha == sha) {
            if (trim()) save_index(directory, store_root_, path, max_versions_, versions);
            return;  // 幂等：与最新版本内容一致，不写新快照
        }
        create_tree(directory);
        long long millis = now_millis();
        unsigned long long seq = 0;
        if (!versions.empty() && millis <= versions.front().millis) {
            millis = versions.front().millis;      // 同一毫秒或时钟回拨时用序号保持单调
            seq = versions.front().seq + 1;
        }
        Version version;
        version.millis = millis;
        for (int attempt = 0; attempt < 64 && version.id.empty(); ++attempt) {
            version.seq = seq;
            version.id = std::to_string(millis) + "-" + std::to_string(seq);
            if (!write_snapshot_new(directory / fs::path(wide_key(version.id)), content, store_root_)) {
                version.id.clear();
                ++seq;  // 名字已被占用：推进序号重试，绝不覆盖既有历史
            }
        }
        if (version.id.empty()) fail("IO_ERROR", "无法为历史快照分配唯一名称。");
        version.bytes = content.size();
        version.reason = label;
        version.sha = sha;
        version.time = iso8601(millis);
        versions.insert(versions.begin(), version);
        trim();
        save_index(directory, store_root_, path, max_versions_, versions);
    });
}

Json History::list(const std::string& rel_path) const {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        const auto path = normalize_relative(rel_path);
        const auto directory = file_directory(store_root_, path);
        Json entries = Json::array();
        for (const auto& version : load_index(directory, store_root_)) {
            if (!is_regular_file(snapshot_path(directory, version), store_root_)) continue;
            entries.push_back(entry_of(version));
        }
        return {{"entries", std::move(entries)}};
    });
}

Json History::content(const std::string& rel_path, const std::string& id) const {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        const auto path = normalize_relative(rel_path);
        std::string snapshot;
        const auto version = take_version(store_root_, file_directory(store_root_, path), path, id, snapshot);
        validate_content(snapshot);
        return {{"content", std::move(snapshot)}, {"version", version.sha}};
    });
}

Json History::diff(const std::string& rel_path, const std::string& id,
                   const std::string& current_content) const {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        const auto path = normalize_relative(rel_path);
        std::string snapshot;
        const auto version = take_version(store_root_, file_directory(store_root_, path), path, id, snapshot);
        validate_content(current_content);
        std::string out = "--- " + path + " @" + id + "（本地历史 " + version.reason + " " + version.time + "）\n";
        out += "+++ " + path + "（当前内容）\n";
        out += unified_diff(snapshot, current_content);
        return {{"diff", std::move(out)}};
    });
}

Json History::side_diff(const std::string& rel_path, const std::string& id,
                        const std::string& current_content) const {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        const auto path = normalize_relative(rel_path);
        std::string snapshot;
        const auto version = take_version(store_root_, file_directory(store_root_, path), path, id, snapshot);
        validate_content(current_content);
        // Both texts are in hand, so the rows come straight from the LCS script.
        Json result = diff_sides(snapshot, current_content);
        result["header"] = "本地历史 " + id + "（" + version.reason + " " + version.time + "）→ 当前内容";
        return result;
    });
}

std::string unified_diff(std::string_view before, std::string_view after) {
    return render_hunks(build_script(split_lines(before), split_lines(after)));
}

// ---- 并排差异 ---------------------------------------------------------------------

namespace {

constexpr std::size_t max_side_rows = 20000;   // 行数上限，超出即截断而不是无限分配

// 词法切分：字母数字下划线 / 空白 / 其它单字符，各自成一个 token，并记录字节偏移。
std::vector<std::pair<std::size_t, std::string_view>> tokenize(std::string_view line) {
    std::vector<std::pair<std::size_t, std::string_view>> tokens;
    std::size_t index = 0;
    while (index < line.size()) {
        const unsigned char ch = static_cast<unsigned char>(line[index]);
        const bool word = std::isalnum(ch) || ch == '_';
        const bool space = ch == ' ' || ch == '\t';
        std::size_t end = index + 1;
        if (word || space) {
            while (end < line.size()) {
                const unsigned char next = static_cast<unsigned char>(line[end]);
                const bool next_word = std::isalnum(next) || next == '_';
                const bool next_space = next == ' ' || next == '\t';
                if (word ? !next_word : !next_space) break;
                ++end;
            }
        }
        tokens.emplace_back(index, line.substr(index, end - index));
        index = end;
    }
    return tokens;
}

// 两行之间的词级差异：把不同的 token 段合并成 [起点, 长度] 区间，左右各一份。
void word_marks(std::string_view left, std::string_view right, Json& left_out, Json& right_out) {
    const auto a = tokenize(left);
    const auto b = tokenize(right);
    const std::size_t n = a.size();
    const std::size_t m = b.size();
    if (n == 0 && m == 0) return;
    const bool feasible = n == 0 || m == 0 || n + 1 <= diff_cell_budget / (m + 1);
    std::vector<std::uint8_t> direction;
    if (feasible) {
        direction.assign((n + 1) * (m + 1), 0);
        std::vector<std::uint32_t> next(m + 1, 0);
        std::vector<std::uint32_t> current(m + 1, 0);
        for (std::size_t i = n; i-- > 0;) {
            for (std::size_t j = m; j-- > 0;) {
                std::uint8_t move = 0;
                std::uint32_t length = 0;
                if (a[i].second == b[j].second) { move = 1; length = next[j + 1] + 1; }
                else if (next[j] >= current[j + 1]) { move = 2; length = next[j]; }
                else { move = 3; length = current[j + 1]; }
                direction[i * (m + 1) + j] = move;
                current[j] = length;
            }
            next.swap(current);
        }
    }
    // 收集差异 token 的下标段，再换算成字节区间。
    std::vector<std::pair<std::size_t, std::size_t>> a_runs, b_runs;   // [first, last)
    std::size_t i = 0;
    std::size_t j = 0;
    auto flush = [](std::vector<std::pair<std::size_t, std::size_t>>& runs, std::size_t& begin, std::size_t& end) {
        if (begin == std::string_view::npos) return;
        runs.emplace_back(begin, end);
        begin = std::string_view::npos;
    };
    std::size_t a_begin = std::string_view::npos, a_end = 0;
    std::size_t b_begin = std::string_view::npos, b_end = 0;
    while (i < n && j < m) {
        const auto move = feasible ? direction[i * (m + 1) + j] : std::uint8_t{0};
        if (move == 1) {
            flush(a_runs, a_begin, a_end);
            flush(b_runs, b_begin, b_end);
            ++i; ++j;
        } else if (move == 2) {
            if (a_begin == std::string_view::npos) a_begin = i;
            a_end = i + 1;
            ++i;
        } else {
            if (b_begin == std::string_view::npos) b_begin = j;
            b_end = j + 1;
            ++j;
        }
    }
    if (i < n) { if (a_begin == std::string_view::npos) a_begin = i; a_end = n; }
    if (j < m) { if (b_begin == std::string_view::npos) b_begin = j; b_end = m; }
    flush(a_runs, a_begin, a_end);
    flush(b_runs, b_begin, b_end);
    auto emit = [&](const std::vector<std::pair<std::size_t, std::size_t>>& runs,
                    const std::vector<std::pair<std::size_t, std::string_view>>& tokens,
                    std::string_view text, Json& out) {
        auto blank = [](std::string_view token) {
            return !token.empty() && (token.front() == ' ' || token.front() == '\t');
        };
        for (const auto& [first, last] : runs) {
            if (first >= tokens.size() || last > tokens.size() || last <= first) continue;
            // 只含空白的首/尾 token 从标记里去掉，"hello"→"hello world" 只圈住新增的
            // 词；整段都是空白（纯缩进改动）时保持原样，否则用户看不到改动。
            std::size_t begin = first, stop = last;
            while (begin + 1 < stop && blank(tokens[begin].second)) ++begin;
            while (stop - 1 > begin && blank(tokens[stop - 1].second)) --stop;
            const auto start = tokens[begin].first;
            const auto end = tokens[stop - 1].first + tokens[stop - 1].second.size();
            if (end > text.size()) continue;
            out.push_back(Json::array({start, end - start}));
        }
    };
    emit(a_runs, a, left, left_out);
    emit(b_runs, b, right, right_out);
}

Json side(std::size_t line_1based, std::string_view text) {
    return Json{{"no", line_1based}, {"text", std::string(text)}};
}

}  // namespace

Json side_rows(const std::vector<Row>& script) {
    Json rows = Json::array();
    bool truncated = false;
    std::size_t index = 0;
    while (index < script.size()) {
        if (rows.size() >= max_side_rows) { truncated = true; break; }
        if (script[index].kind == ' ') {
            const auto& row = script[index];
            rows.push_back(Json{{"kind", "equal"},
                                {"left", side(row.a + 1, row.text)},
                                {"right", side(row.b + 1, row.text)}});
            ++index;
            continue;
        }
        // 一段连续的增删：按顺序配对成 change 行，多出来的仍是纯删/纯增。
        std::size_t scan = index;
        // 只在同一块内配对：跨块的删除与新增毫无关系，配到一起会同时给出
        // 错误的行号和错误的对照。
        while (scan < script.size() && script[scan].kind != ' ' && script[scan].hunk == script[index].hunk) ++scan;
        std::vector<const Row*> dels, adds;
        for (std::size_t k = index; k < scan; ++k)
            (script[k].kind == '-' ? dels : adds).push_back(&script[k]);
        const std::size_t pairs = std::min(dels.size(), adds.size());
        for (std::size_t k = 0; k < pairs; ++k) {
            if (rows.size() >= max_side_rows) { truncated = true; break; }
            Json left_marks = Json::array(), right_marks = Json::array();
            word_marks(dels[k]->text, adds[k]->text, left_marks, right_marks);
            Json row{{"kind", "change"},
                     {"left", side(dels[k]->a + 1, dels[k]->text)},
                     {"right", side(adds[k]->b + 1, adds[k]->text)}};
            if (!left_marks.empty()) row["leftMarks"] = std::move(left_marks);
            if (!right_marks.empty()) row["rightMarks"] = std::move(right_marks);
            rows.push_back(std::move(row));
        }
        for (std::size_t k = pairs; k < dels.size(); ++k) {
            if (rows.size() >= max_side_rows) { truncated = true; break; }
            rows.push_back(Json{{"kind", "delete"}, {"left", side(dels[k]->a + 1, dels[k]->text)}});
        }
        for (std::size_t k = pairs; k < adds.size(); ++k) {
            if (rows.size() >= max_side_rows) { truncated = true; break; }
            rows.push_back(Json{{"kind", "insert"}, {"right", side(adds[k]->b + 1, adds[k]->text)}});
        }
        index = scan;
    }
    return Json{{"rows", std::move(rows)}, {"truncated", truncated}};
}

Json diff_sides(std::string_view before, std::string_view after) {
    return side_rows(build_script(split_lines(before), split_lines(after)));
}

// 把 git diff 的 unified 文本还原成同样的行脚本，这样并排视图不需要再去读工作区
// 文件（也就不用重复处理长路径与前缀）。只支持 git 自己产出的 -U3 文本。
Json diff_sides_from_unified(const std::string& input) {
    // A string_view over the caller's buffer: using std::string::substr here would
    // create a temporary per line and leave the view dangling.
    const std::string_view text{input};
    std::vector<Row> script;
    std::size_t a_line = 0;
    std::size_t b_line = 0;
    std::size_t hunk = 0;
    std::size_t start = 0;
    while (start < text.size()) {
        auto end = text.find('\n', start);
        if (end == std::string_view::npos) end = text.size();
        std::string_view line = trim_cr(text.substr(start, end - start));
        start = end + 1;
        if (line.starts_with("@@ -")) {
            // "@@ -a,c +b,d @@"：a/b 是 1 起的行号，而脚本里的游标是 0 起，所以减一；
            // 纯增/纯删的起始号是 0，此时游标就是 0。
            const auto plus = line.find(" +");
            const auto read = [](std::string_view part, std::size_t offset) {
                std::size_t index = offset;
                while (index < part.size() && std::isdigit(static_cast<unsigned char>(part[index]))) ++index;
                return index == offset ? std::size_t{0} : std::stoul(std::string(part.substr(offset, index - offset)));
            };
            const auto zero = [](std::size_t one_based) { return one_based == 0 ? std::size_t{0} : one_based - 1; };
            a_line = zero(read(line, 4));
            b_line = plus == std::string_view::npos ? 0 : zero(read(line, plus + 2));
            ++hunk;
            continue;
        }
        // 文件头（diff --git / --- / +++ / index / 模式行）与 "\ No newline" 标记
        // 都不是内容；前者不含前导空格，后者以 '\' 开头且必须跳过。
        if (line.empty() || line.front() == '\\' || line.starts_with("diff --git ") ||
            line.starts_with("index ") || line.starts_with("--- ") || line.starts_with("+++ ") ||
            line.starts_with("new file") || line.starts_with("deleted file") ||
            line.starts_with("similarity ") || line.starts_with("rename ") ||
            line.starts_with("Binary files ") || line.starts_with("old mode") || line.starts_with("new mode"))
            continue;
        const char marker = line.front();
        const std::string_view body = (marker == ' ' || marker == '+' || marker == '-') ? line.substr(1) : line;
        if (marker == '+') script.push_back({'+', body, a_line, b_line++, hunk});
        else if (marker == '-') script.push_back({'-', body, a_line++, b_line, hunk});
        else if (marker == ' ') script.push_back({' ', body, a_line++, b_line++, hunk});
    }
    return side_rows(script);
}

}  // namespace taocode::history
