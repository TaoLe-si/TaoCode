// Local History engine: an on-disk, Git-independent snapshot store.
// See history.hpp for the store layout and the public contract.
#include "history.hpp"
#include "history_diff.hpp"

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
// 本地历史的落盘/版本索引/指纹留在这一层；行级 unified diff 的两段常数（`diff_cell_budget`
// 动态规划预算与 `diff_context` 的 @@ 上下文行数）连同算法一起搬到了 history_diff.cpp。
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


}  // namespace

// 上游 PersistentChangeListStorage.kt:308-329 findFirstObsoleteBlock 的口径，逐句照搬（含单位）。
// 声明处有每一行对应的上游行号。
std::size_t first_obsolete_index(const std::vector<long long>& time_millis,
                                 long long period_millis, long long interval_millis) {
    long long prev_timestamp = 0;  // :309
    long long length = 0;          // :310
    for (std::size_t index = 0; index < time_millis.size(); ++index) {  // :312-313 从最新往回走
        const long long t = time_millis[index];
        if (prev_timestamp == 0) prev_timestamp = t;  // :315 最新一条以自身为基准，delta 记 0
        const long long delta = prev_timestamp - t;   // :317
        prev_timestamp = t;                            // :318
        length += delta < interval_millis ? delta : 1;  // :321 ≥12h 只累加 1（字面量，单位仍是毫秒）
        if (length >= period_millis) return index;      // :323 首次达标的那条起全过期
    }
    return time_millis.size();  // :328 return 0 —— 没有任何一条过期
}

History::History(std::filesystem::path store_root, std::size_t max_versions_per_file,
                 long long days_to_keep)
    : store_root_(std::move(store_root)), max_versions_(clamp_max_versions(max_versions_per_file)),
      days_to_keep_(days_to_keep > 0 ? days_to_keep : default_days_to_keep) {
    // 缺键/传 0 一律回落到上游默认 5，与 ChangeListImpl.kt:127-136 的 catch 兜底同一口径；
    // 绝不因为「键不在」就判整份设置损坏。
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
            // 过期两档，谁先到谁起作用：先按「已存活的活动时长」（上游 findFirstObsoleteBlock 的口径，
            // period = daysToKeep 天换算毫秒，同 ChangeListImpl.kt:118），再按每个文件的条数封顶。
            // 之前这里只有条数一票到底，时间那一半完全没人做。
            std::vector<long long> stamps;
            stamps.reserve(versions.size());
            for (const auto& version : versions) stamps.push_back(version.millis);
            const auto obsolete = first_obsolete_index(
                stamps, days_to_keep_ * 24LL * 60LL * 60LL * 1000LL, activity_interval_millis);
            while (versions.size() > obsolete) {  // 达标的那条连同更旧的：deleteRecordsUpTo(:300)
                erase_snapshot(directory, versions.back());
                versions.pop_back();
                changed = true;
            }
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


}  // namespace taocode::history
