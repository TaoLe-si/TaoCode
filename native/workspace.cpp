#include "workspace.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <bcrypt.h>
#include <shellapi.h>

#include <algorithm>
#include <array>
#include <limits>
#include <string_view>
#include <utility>
#include <vector>

namespace taocode {
namespace {
namespace fs = std::filesystem;
// Hard safety bound for a single text file: large enough to open real source/data
// files smoothly, small enough that a pathological file can never exhaust memory.
constexpr std::size_t max_bytes = 16 * 1024 * 1024;
constexpr std::size_t max_entries = 2000;

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
    } catch (const fs::filesystem_error&) {
        fail("IO_ERROR", "文件系统操作失败，工作区未能完成请求。");
    } catch (const std::exception&) {
        fail("INTERNAL_ERROR", "工作区处理请求时发生内部错误。");
    }
}

class Handle {
public:
    explicit Handle(HANDLE value = INVALID_HANDLE_VALUE) noexcept : value_(value) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept
        : value_(std::exchange(other.value_, INVALID_HANDLE_VALUE)) {}
    Handle& operator=(Handle&& other) noexcept {
        if (this != &other) {
            reset();
            value_ = std::exchange(other.value_, INVALID_HANDLE_VALUE);
        }
        return *this;
    }
    HANDLE get() const noexcept { return value_; }
    explicit operator bool() const noexcept {
        return value_ != INVALID_HANDLE_VALUE && value_ != nullptr;
    }
    void reset() noexcept {
        if (*this) CloseHandle(value_);
        value_ = INVALID_HANDLE_VALUE;
    }
private:
    HANDLE value_;
};

std::string utf8_path(const fs::path& path) {
    const auto text = path.generic_u8string();
    return {reinterpret_cast<const char*>(text.data()), text.size()};
}

bool valid_utf8(const std::string& text) {
    if (text.empty()) return true;
    if (text.size() > static_cast<std::size_t>((std::numeric_limits<int>::max)()))
        return false;
    return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(),
                              static_cast<int>(text.size()), nullptr, 0) != 0;
}

// Text encodings. The bridge only carries UTF-8 JSON, so a non-UTF-8 file is decoded
// to wide text and re-encoded as UTF-8 on the way in, and saved by the inverse path.
// Every conversion is strict: an undecodable byte sequence, or a character the target
// code page cannot represent, is an error — never a '?' written over the user's text.
// The SDK headers do not name the UTF-16 code pages, so their numbers live here.
constexpr uint32_t utf16le_page = 1200, utf16be_page = 1201;

struct Encoding {
    const char* key;     // the token the UI sends back verbatim
    uint32_t page;       // Windows code page; the UTF-16 pair is handled by hand
    const char* bom;     // byte-order mark to write when the caller asks for one
};

const Encoding encoding_list[] = {
    {"utf-8", CP_UTF8, "\xEF\xBB\xBF"},
    {"gbk", 936, ""},
    {"cp1252", 1252, ""},
    {"system", CP_ACP, ""},
    {"utf-16le", utf16le_page, "\xFF\xFE"},
    {"utf-16be", utf16be_page, "\xFE\xFF"},
};

const Encoding& encoding_for(const std::string& key) {
    for (const auto& item : encoding_list)
        if (key == item.key) return item;
    fail("INVALID_ENCODING", "不支持的文件编码：" + key);
}

bool utf16_page(uint32_t page) { return page == utf16le_page || page == utf16be_page; }

std::wstring decode_wide(const char* data, std::size_t size, const Encoding& encoding) {
    const std::string label(encoding.key);
    if (size == 0) return {};
    if (utf16_page(encoding.page)) {
        if (size % 2) fail("ENCODING_MISMATCH", "UTF-16 文本的字节数必须是偶数：" + label);
        std::wstring text;
        text.reserve(size / 2);
        for (std::size_t index = 0; index + 1 < size; index += 2) {
            const auto low = static_cast<unsigned>(static_cast<unsigned char>(data[encoding.page == utf16le_page ? index : index + 1]));
            const auto high = static_cast<unsigned>(static_cast<unsigned char>(data[encoding.page == utf16le_page ? index + 1 : index]));
            text.push_back(static_cast<wchar_t>(low | (high << 8)));
        }
        return text;
    }
    const auto needed = MultiByteToWideChar(encoding.page, MB_ERR_INVALID_CHARS, data, static_cast<int>(size), nullptr, 0);
    if (!needed)
        fail("ENCODING_MISMATCH", "文件内容不是 " + label + " 编码的有效文本。");
    std::wstring text(needed, L'\0');
    MultiByteToWideChar(encoding.page, MB_ERR_INVALID_CHARS, data, static_cast<int>(size), text.data(), needed);
    return text;
}

std::wstring decode_wide(const std::string& bytes, const Encoding& encoding) {
    return decode_wide(bytes.data(), bytes.size(), encoding);
}

std::string encode_bytes(const std::wstring& text, const Encoding& encoding) {
    if (text.empty()) return {};
    if (utf16_page(encoding.page)) {
        std::string bytes;
        bytes.reserve(text.size() * 2);
        for (const auto unit : text) {
            const auto value = static_cast<unsigned>(unit);
            const auto low = static_cast<char>(value & 0xFF), high = static_cast<char>(value >> 8);
            bytes += encoding.page == utf16le_page ? std::string{low, high} : std::string{high, low};
        }
        return bytes;
    }
    const auto needed = WideCharToMultiByte(encoding.page, 0, text.data(), static_cast<int>(text.size()),
                                           nullptr, 0, nullptr, nullptr);
    if (!needed) fail("ENCODING_FAILED", std::string("无法用 ") + encoding.key + " 编码写入文件。");
    std::string bytes(needed, '\0');
    WideCharToMultiByte(encoding.page, 0, text.data(), static_cast<int>(text.size()), bytes.data(), needed, nullptr, nullptr);
    // lpUsedDefaultChar is unreliable across code pages, so verify by decoding the
    // bytes back: a silent substitution changes the text and fails here instead.
    if (decode_wide(bytes, encoding) != text)
        fail("ENCODING_LOSS", std::string("有字符无法用 ") + encoding.key + " 编码表示，文件未保存。");
    return bytes;
}

// The encoding to read with: an explicit choice wins, otherwise a byte-order mark
// decides, otherwise UTF-8 is assumed and enforced.
const Encoding& resolve_read(const std::string& bytes, const std::string& requested, std::size_t& bom_length) {
    bom_length = 0;
    if (requested.empty() || requested == "auto") {
        for (const auto& candidate : encoding_list) {
            const auto size = std::char_traits<char>::length(candidate.bom);
            if (size && bytes.compare(0, size, candidate.bom) == 0) { bom_length = size; return candidate; }
        }
        return encoding_for("utf-8");
    }
    const auto& chosen = encoding_for(requested);
    const auto size = std::char_traits<char>::length(chosen.bom);
    if (size && bytes.compare(0, size, chosen.bom) == 0) bom_length = size;
    return chosen;
}

// What goes to disk: the encoded text, optionally with the encoding's byte-order mark.
std::string encode_document(const std::string& utf8, const Encoding& encoding, bool bom) {
    std::string bytes = encoding.page == CP_UTF8 ? utf8 : encode_bytes(decode_wide(utf8, encoding_for("utf-8")), encoding);
    if (bom) bytes.insert(bytes.begin(), encoding.bom, encoding.bom + std::char_traits<char>::length(encoding.bom));
    return bytes;
}

// ConvertToWindows/UnixLineSeparatorsAction: normalize every line ending to the
// requested separator. CRLF collapses to one break; a lone CR is one too.
std::string convert_endings(const std::string& text, const std::string& separator) {
    std::string out;
    out.reserve(text.size());
    for (std::size_t index = 0; index < text.size(); ++index) {
        const auto character = text[index];
        if (character == '\r') {
            if (index + 1 < text.size() && text[index + 1] == '\n') ++index;
            out += separator;
            continue;
        }
        if (character == '\n') { out += separator; continue; }
        out += character;
    }
    return out;
}

void validate_bytes(const std::string& content, const Encoding& encoding) {
    if (content.size() > max_bytes)
        fail("FILE_TOO_LARGE", "文件超过 " + std::to_string(max_bytes / (1024 * 1024)) + " MiB 限制。");
    // A NUL byte means binary data unless the encoding is a UTF-16 pair, where NUL is
    // an ordinary half of almost every Latin character.
    if (!utf16_page(encoding.page) && content.find('\0') != std::string::npos)
        fail("BINARY_FILE", "文件含有 NUL 字节，不能作为文本打开或保存。");
}

const Encoding& utf8_encoding() { return encoding_for("utf-8"); }

void validate_content(const std::string& content) {
    if (content.size() > max_bytes)
        fail("FILE_TOO_LARGE", "文件超过 " + std::to_string(max_bytes / (1024 * 1024)) + " MiB 限制。");
    if (content.find('\0') != std::string::npos)
        fail("BINARY_FILE", "文件含有 NUL 字节，不能作为文本打开或保存。");
    if (!valid_utf8(content))
        fail("INVALID_UTF8", "文件不是有效的 UTF-8 文本。");
}

bool equal_name(std::wstring_view left, std::wstring_view right) {
    return CompareStringOrdinal(left.data(), static_cast<int>(left.size()),
                                right.data(), static_cast<int>(right.size()), TRUE)
           == CSTR_EQUAL;
}

void validate_component(const std::wstring& name) {
    if (name.empty() || name == L"." || name == L".." ||
        name.back() == L'.' || name.back() == L' ')
        fail("INVALID_PATH", "路径含有不允许的目录或文件名。");
    for (wchar_t ch : name) {
        if (ch < 32 || std::wstring_view(L":<>\"|?*").find(ch) != std::wstring_view::npos)
            fail("INVALID_PATH", "路径含有非法字符或 NTFS 数据流名称。");
    }
    const auto base = std::wstring_view(name).substr(0, name.find(L'.'));
    if (equal_name(base, L"CON") || equal_name(base, L"PRN") ||
        equal_name(base, L"AUX") || equal_name(base, L"NUL") ||
        equal_name(base, L"CONIN$") || equal_name(base, L"CONOUT$"))
        fail("INVALID_PATH", "不允许访问 Windows 设备名称。");
    if (base.size() == 4 &&
        (equal_name(base.substr(0, 3), L"COM") || equal_name(base.substr(0, 3), L"LPT")) &&
        ((base[3] >= L'1' && base[3] <= L'9') || base[3] == L'\u00b9' ||
         base[3] == L'\u00b2' || base[3] == L'\u00b3'))
        fail("INVALID_PATH", "不允许访问 Windows 设备名称。");
}

fs::path parse_relative(const std::string& relative) {
    if (relative.find('\0') != std::string::npos || !valid_utf8(relative))
        fail("INVALID_PATH", "路径必须是没有 NUL 字节的 UTF-8 文本。");
    if ((!relative.empty() && (relative.front() == '/' || relative.front() == '\\')) ||
        relative.find(':') != std::string::npos)
        fail("INVALID_PATH", "只允许工作区相对路径，不允许绝对路径、盘符或数据流。");
    std::string portable = relative;
    std::replace(portable.begin(), portable.end(), '\\', '/');
    const auto input = fs::path(std::u8string(portable.begin(), portable.end()));
    if (input.has_root_name() || input.has_root_directory() || input.is_absolute())
        fail("INVALID_PATH", "只允许工作区相对路径。");
    fs::path result;
    for (const auto& part : input) {
        if (part.empty() || part == L".") continue;
        validate_component(part.native());
        result /= part;
    }
    return result;
}

fs::path plain_path(std::wstring path) {
    if (path.starts_with(L"\\\\?\\UNC\\")) {
        path = L"\\\\" + path.substr(8);
    } else if (path.starts_with(L"\\\\?\\")) {
        if (path.size() < 7 || path[5] != L':' || path[6] != L'\\' ||
            !((path[4] >= L'A' && path[4] <= L'Z') || (path[4] >= L'a' && path[4] <= L'z')))
            fail("INVALID_PATH", "只允许普通盘符路径或 UNC 共享路径，不允许设备命名空间。");
        path.erase(0, 4);
    }
    auto result = fs::path(path).lexically_normal();
    while (result.has_relative_path() && result.filename().empty())
        result = result.parent_path();
    return result;
}

std::wstring api_path(const fs::path& path) {
    const auto native = path.native();
    if (native.starts_with(L"\\\\?\\")) return native;
    if (native.starts_with(L"\\\\")) return L"\\\\?\\UNC\\" + native.substr(2);
    return L"\\\\?\\" + native;
}

bool within(const fs::path& path, const fs::path& root) {
    auto actual = path.begin();
    for (auto expected = root.begin(); expected != root.end(); ++expected, ++actual) {
        if (actual == path.end() || !equal_name(actual->native(), expected->native()))
            return false;
    }
    return true;
}

BY_HANDLE_FILE_INFORMATION file_info(HANDLE handle) {
    BY_HANDLE_FILE_INFORMATION result{};
    if (!GetFileInformationByHandle(handle, &result))
        win_error("无法读取文件属性");
    return result;
}

bool same_file(const BY_HANDLE_FILE_INFORMATION& a, const BY_HANDLE_FILE_INFORMATION& b) noexcept {
    return a.dwVolumeSerialNumber == b.dwVolumeSerialNumber &&
           a.nFileIndexHigh == b.nFileIndexHigh && a.nFileIndexLow == b.nFileIndexLow;
}

void reject_reparse(const BY_HANDLE_FILE_INFORMATION& info) {
    if (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
        fail("REPARSE_POINT", "不允许访问符号链接、联接点或其他重解析点。");
}

fs::path final_path(HANDLE handle) {
    DWORD size = GetFinalPathNameByHandleW(handle, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (!size) win_error("无法核对最终文件路径");
    std::wstring name(size, L'\0');
    const DWORD length = GetFinalPathNameByHandleW(handle, name.data(), size,
                                                  FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (!length) win_error("无法核对最终文件路径");
    if (length >= size) fail("IO_ERROR", "核对文件路径时路径发生变化。");
    name.resize(length);
    return plain_path(std::move(name));
}

fs::path checked_final_path(HANDLE handle, const fs::path& requested, const fs::path& root) {
    const auto actual = final_path(handle);
    const auto canonical = plain_path(fs::canonical(fs::path(api_path(requested))).native());
    if (!within(actual, canonical) || !within(canonical, actual) ||
        (!root.empty() && (!within(actual, root) || !within(canonical, root))))
        fail("PATH_ESCAPE", "最终路径不在工作区内，或文件路径已经改变。");
    return actual;
}

struct PinnedDirectory {
    fs::path path;
    std::vector<Handle> handles;
};

PinnedDirectory pin_directory(const fs::path& directory, const fs::path& boundary_root = {}) {
    PinnedDirectory pinned;
    auto cursor = directory.root_path();
    if (!directory.is_absolute() || cursor.empty())
        fail("INVALID_PATH", "工作区根目录必须是有效的绝对路径。");
    const auto root_name = directory.root_name().native();
    const bool unc = root_name.starts_with(L"\\\\");
    if ((!unc && (root_name.size() != 2 || root_name[1] != L':' ||
                  !((root_name[0] >= L'A' && root_name[0] <= L'Z') ||
                    (root_name[0] >= L'a' && root_name[0] <= L'z')))) ||
        (unc && (root_name == L"\\\\?" || root_name == L"\\\\.")))
        fail("INVALID_PATH", "不允许访问 Windows 设备路径。");

    auto pin = [&] {
        Handle handle(CreateFileW(api_path(cursor).c_str(), FILE_READ_ATTRIBUTES,
                                 FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                 FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
        if (!handle) win_error("无法访问工作区目录");
        const auto info = file_info(handle.get());
        reject_reparse(info);
        if (!(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY))
            fail("NOT_DIRECTORY", "请求的路径不是目录。");
        pinned.handles.push_back(std::move(handle));
    };

    const auto remainder = directory.relative_path();
    auto component = remainder.begin();
    if (unc) {
        if (component == remainder.end())
            fail("INVALID_PATH", "网络工作区必须指定共享目录。");
        validate_component(component->native());
        cursor /= *component++;
    }
    pin();
    for (; component != remainder.end(); ++component) {
        if (component->empty()) continue;
        validate_component(component->native());
        cursor /= *component;
        pin();
    }
    pinned.path = checked_final_path(pinned.handles.back().get(), directory, boundary_root);
    return pinned;
}

void require_open(const fs::path& root) {
    if (root.empty()) fail("NOT_OPEN", "请先打开一个工作区。");
}

std::vector<std::wstring> directory_exclusions(const std::vector<std::string>& names) {
    if (names.size() > 64) fail("INVALID_SETTINGS", "最多允许 64 个排除目录名。");
    std::vector<std::wstring> result;
    for (const auto& name : names) {
        if (!valid_utf8(name) || name.find_first_of("/\\") != std::string::npos)
            fail("INVALID_SETTINGS", "排除项必须是单独的 UTF-8 目录名。");
        auto value = fs::path(std::u8string(name.begin(), name.end())).native();
        validate_component(value);
        result.push_back(std::move(value));
    }
    return result;
}

bool ignored_directory(const std::wstring& name, const std::vector<std::wstring>& excluded) {
    return std::any_of(excluded.begin(), excluded.end(), [&](const auto& entry) { return equal_name(name, entry); });
}

Json enumerate(const fs::path& directory, const fs::path& relative, const std::vector<std::wstring>& excluded) {
    struct Entry { std::string name; std::string path; bool directory; };
    std::vector<Entry> entries;
    WIN32_FIND_DATAW data{};
    const HANDLE search = FindFirstFileW(api_path(directory / L"*").c_str(), &data);
    if (search == INVALID_HANDLE_VALUE) {
        const auto error = GetLastError();
        if (error == ERROR_FILE_NOT_FOUND) return Json::array();
        win_error("无法列出工作区目录", error);
    }
    struct FindGuard {
        HANDLE handle;
        ~FindGuard() { FindClose(handle); }
    } guard{search};
    do {
        const std::wstring name(data.cFileName);
        if (name == L"." || name == L".." ||
            (data.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DEVICE)))
            continue;
        const bool is_directory = (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
        if (is_directory && ignored_directory(name, excluded)) continue;
        if (entries.size() == max_entries)
            fail("TOO_MANY_ENTRIES", "目录包含超过 2000 个可显示项目，请打开更小的目录。");
        entries.push_back({utf8_path(fs::path(name)), utf8_path(relative / name), is_directory});
    } while (FindNextFileW(search, &data));
    const auto error = GetLastError();
    if (error != ERROR_NO_MORE_FILES) win_error("读取目录列表失败", error);
    std::sort(entries.begin(), entries.end(), [](const Entry& a, const Entry& b) {
        if (a.directory != b.directory) return a.directory;
        return a.name < b.name;
    });
    Json result = Json::array();
    for (const auto& entry : entries)
        result.push_back({{"name", entry.name}, {"path", entry.path},
                          {"kind", entry.directory ? "directory" : "file"}});
    return result;
}

Handle open_regular(const fs::path& path, const fs::path& root, DWORD sharing = FILE_SHARE_READ) {
    Handle handle(CreateFileW(api_path(path).c_str(), GENERIC_READ, sharing, nullptr,
                             OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
                             nullptr));
    if (!handle) win_error("无法打开文件");
    const auto info = file_info(handle.get());
    reject_reparse(info);
    if ((info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_DEVICE)) ||
        GetFileType(handle.get()) != FILE_TYPE_DISK)
        fail("NOT_FILE", "只允许读取或保存已存在的正规文件。");
    checked_final_path(handle.get(), path, root);
    return handle;
}

std::string read_bytes(HANDLE handle) {
    LARGE_INTEGER length{};
    if (!GetFileSizeEx(handle, &length)) win_error("无法读取文件大小");
    if (length.QuadPart < 0 || length.QuadPart > static_cast<LONGLONG>(max_bytes))
        fail("FILE_TOO_LARGE", "文件超过 " + std::to_string(max_bytes / (1024 * 1024)) + " MiB 限制。");
    std::string content;
    content.reserve(static_cast<std::size_t>(length.QuadPart));
    std::array<char, 65536> buffer{};
    for (;;) {
        DWORD count = 0;
        if (!ReadFile(handle, buffer.data(), static_cast<DWORD>(buffer.size()), &count, nullptr))
            win_error("读取文件失败");
        if (!count) break;
        if (count > max_bytes - content.size())
            fail("FILE_TOO_LARGE", "文件超过 " + std::to_string(max_bytes / (1024 * 1024)) + " MiB 限制。");
        content.append(buffer.data(), count);
    }
    return content;
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
    if (status < 0) fail("CRYPTO_ERROR", "Windows 加密服务无法完成文件指纹计算或安全随机数生成。");
}

std::string fingerprint(const std::string& content) {
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

struct TemporaryFile {
    fs::path path;
    std::wstring name;
    Handle handle;
    BY_HANDLE_FILE_INFORMATION identity{};
    bool cleanup = true;

    TemporaryFile() = default;
    TemporaryFile(const TemporaryFile&) = delete;
    TemporaryFile& operator=(const TemporaryFile&) = delete;
    TemporaryFile(TemporaryFile&& other) noexcept
        : path(std::move(other.path)), name(std::move(other.name)), handle(std::move(other.handle)),
          identity(other.identity), cleanup(std::exchange(other.cleanup, false)) {}
    ~TemporaryFile() {
        if (!cleanup) return;
        if (handle) {
            FILE_DISPOSITION_INFO disposition{TRUE};
            SetFileInformationByHandle(handle.get(), FileDispositionInfo, &disposition, sizeof(disposition));
        } else if (!name.empty()) {
            Handle owned(CreateFileW(name.c_str(), DELETE | FILE_READ_ATTRIBUTES,
                                     FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                     OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
            BY_HANDLE_FILE_INFORMATION current{};
            if (owned && GetFileInformationByHandle(owned.get(), &current) && same_file(current, identity)) {
                FILE_DISPOSITION_INFO disposition{TRUE};
                SetFileInformationByHandle(owned.get(), FileDispositionInfo, &disposition, sizeof(disposition));
            }
        }
    }

    static TemporaryFile create(const fs::path& parent) {
        TemporaryFile file;
        for (int attempt = 0; attempt < 16; ++attempt) {
            std::array<UCHAR, 16> random{};
            crypto_check(BCryptGenRandom(nullptr, random.data(), static_cast<ULONG>(random.size()),
                                        BCRYPT_USE_SYSTEM_PREFERRED_RNG));
            file.path = parent / (".taocode-save-" + hex(random.data(), random.size()) + ".tmp");
            file.name = api_path(file.path);
            file.handle = Handle(CreateFileW(file.name.c_str(), GENERIC_WRITE | DELETE | FILE_READ_ATTRIBUTES,
                                            0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
            if (file.handle) {
                file.identity = file_info(file.handle.get());
                return file;
            }
            const auto error = GetLastError();
            file.name.clear();
            if (error != ERROR_FILE_EXISTS && error != ERROR_ALREADY_EXISTS)
                win_error("无法在原目录创建保存临时文件", error);
        }
        fail("IO_ERROR", "无法分配唯一的保存临时文件名。");
    }
};

void write_temporary(TemporaryFile& temporary, const std::string& content) {
    std::size_t offset = 0;
    while (offset < content.size()) {
        DWORD written = 0;
        if (!WriteFile(temporary.handle.get(), content.data() + offset,
                       static_cast<DWORD>(content.size() - offset), &written, nullptr))
            win_error("写入保存临时文件失败");
        if (!written) fail("IO_ERROR", "写入保存临时文件时未能继续写入。");
        offset += written;
    }
    if (!FlushFileBuffers(temporary.handle.get())) win_error("无法将保存内容刷新到磁盘");
    temporary.handle.reset();
}

bool has_identity(const TemporaryFile& file, const BY_HANDLE_FILE_INFORMATION& expected) {
    Handle handle(CreateFileW(file.name.c_str(), FILE_READ_ATTRIBUTES,
                             FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                             OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    BY_HANDLE_FILE_INFORMATION info{};
    return handle && GetFileInformationByHandle(handle.get(), &info) && same_file(info, expected);
}

// ReplaceFileW refuses a read-only destination, so a save that got this far clears
// the bit first (the UI only reaches write after unlocking). False = could not clear.
bool clear_read_only_bit(const fs::path& target) {
    const auto attributes = GetFileAttributesW(api_path(target).c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES) return false;
    if ((attributes & FILE_ATTRIBUTE_READONLY) == 0) return true;
    return SetFileAttributesW(api_path(target).c_str(), attributes & ~FILE_ATTRIBUTE_READONLY) != 0;
}

void replace_safely(const fs::path& target, TemporaryFile& replacement, TemporaryFile& backup,
                    const BY_HANDLE_FILE_INFORMATION& original) {
    const auto destination = api_path(target);
    if (ReplaceFileW(destination.c_str(), replacement.name.c_str(), backup.name.c_str(), 0, nullptr, nullptr)) {
        backup.identity = original;
        return;
    }
    const auto error = GetLastError();
    // ReplaceFileW 的部分失败会把原文件移至备份名；不能删除唯一的原件。
    const bool original_in_backup = has_identity(backup, original);
    if (original_in_backup || error == ERROR_UNABLE_TO_MOVE_REPLACEMENT_2) {
        backup.cleanup = false;
        if (!original_in_backup ||
            !MoveFileExW(backup.name.c_str(), destination.c_str(), MOVEFILE_WRITE_THROUGH))
            fail("SAVE_RECOVERY_REQUIRED", "替换失败，原文件的恢复备份保留在：" + utf8_path(backup.path));
    }
    win_error("安全替换文件失败，未保存新内容", error);
}

} // namespace

WorkspaceError::WorkspaceError(std::string code, std::string message)
    : std::runtime_error(std::move(message)), code(std::move(code)) {}

Json Workspace::open(const std::filesystem::path& root, const std::vector<std::string>& excluded) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        auto names = directory_exclusions(excluded);
        if (root.empty() || root.native().find(L'\0') != std::wstring::npos)
            fail("INVALID_PATH", "工作区根目录不能为空或含有 NUL 字符。");
        auto candidate = plain_path(fs::absolute(plain_path(root.native())).native());
        auto pinned = pin_directory(candidate);
        candidate = pinned.path;
        auto name = candidate.filename();
        if (name.empty()) name = candidate.root_name();
        Json result = {{"name", utf8_path(name)}, {"root", utf8_path(candidate)},
                       {"entries", enumerate(candidate, {}, names)}};
        root_.swap(candidate);
        excluded_.swap(names);
        return result;
    });
}

Json Workspace::list(const std::string& relative) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto path = parse_relative(relative);
        auto pinned = pin_directory(root_ / path, root_);
        return enumerate(pinned.path, path, excluded_);
    });
}

Json Workspace::read(const std::string& relative, const std::string& encoding) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto path = parse_relative(relative);
        if (path.empty()) fail("NOT_FILE", "工作区根目录不是正规文件。");
        auto pinned = pin_directory(root_ / path.parent_path(), root_);
        auto handle = open_regular(pinned.path / path.filename(), root_);
        auto bytes = read_bytes(handle.get());
        std::size_t bom_length = 0;
        const auto& chosen = resolve_read(bytes, encoding, bom_length);
        validate_bytes(bytes, chosen);
        // The version fingerprints the bytes actually on disk, BOM included, so an
        // external edit is still detected whatever encoding the buffer is shown in.
        auto version = fingerprint(bytes);
        std::string content;
        if (chosen.page == CP_UTF8) {
            bytes.erase(0, bom_length);  // UTF-8 travels unchanged: no decode copy
            if (!valid_utf8(bytes))
                fail("INVALID_UTF8", "文件不是有效的 UTF-8 文本；若是中文旧文件，请用 GBK 编码重新打开。");
            content = std::move(bytes);
        } else {
            content = encode_bytes(decode_wide(bytes.data() + bom_length, bytes.size() - bom_length, chosen),
                                   utf8_encoding());
        }
        return {{"path", utf8_path(path)}, {"content", std::move(content)}, {"version", std::move(version)},
                {"encoding", chosen.key}, {"bom", bom_length != 0},
                {"readOnly", (file_info(handle.get()).dwFileAttributes & FILE_ATTRIBUTE_READONLY) != 0}};
    });
}

// ToggleReadOnlyAttributeAction: SetFileAttributesW on the pinned path. The handle is
// opened with attribute access only — a read-only file must still be toggleable.
Json Workspace::set_read_only(const std::string& relative, bool read_only) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto path = parse_relative(relative);
        if (path.empty()) fail("NOT_FILE", "工作区根目录不是正规文件。");
        const auto pinned = pin_directory(root_ / path.parent_path(), root_);
        const auto target = pinned.path / path.filename();
        Handle guard(CreateFileW(api_path(target).c_str(), FILE_READ_ATTRIBUTES,
                                 FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                 OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
        if (!guard) win_error("无法打开文件");
        const auto info = file_info(guard.get());
        reject_reparse(info);
        if ((info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_DEVICE)) ||
            GetFileType(guard.get()) != FILE_TYPE_DISK)
            fail("NOT_FILE", "只能修改工作区内普通文件的只读属性。");
        checked_final_path(guard.get(), target, root_);
        const auto current = GetFileAttributesW(api_path(target).c_str());
        if (current == INVALID_FILE_ATTRIBUTES) {
            const auto error = GetLastError();
            if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) fail("NOT_FOUND", "找不到该文件。");
            win_error("无法读取文件属性", error);
        }
        auto next = current;
        if (read_only) next |= FILE_ATTRIBUTE_READONLY;
        else next &= ~FILE_ATTRIBUTE_READONLY;
        if (next != current && !SetFileAttributesW(api_path(target).c_str(), next))
            win_error("无法修改只读属性", GetLastError());
        return {{"path", utf8_path(path)}, {"readOnly", (next & FILE_ATTRIBUTE_READONLY) != 0}};
    });
}

// ConvertToWindows/UnixLineSeparatorsAction: rewrite the file on disk with every line
// ending normalized to `separator` ("crlf" | "lf"). `content` is the editor buffer as
// it would be saved (its encoding/BOM are supplied by the caller through write(); here
// the payload is UTF-8, matching what a save of that buffer produces). A version check
// rejects any external change first, and a read-only file is refused before touching.
Json Workspace::convert_line_separators(const std::string& relative, const std::string& separator,
                                        const std::string& content, const std::string& expectedVersion) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        if (separator != "crlf" && separator != "lf")
            fail("INVALID_SETTINGS", "行分隔符只能是 crlf 或 lf。");
        validate_content(content);
        const auto path = parse_relative(relative);
        if (path.empty()) fail("NOT_FILE", "工作区根目录不是正规文件。");
        auto pinned = pin_directory(root_ / path.parent_path(), root_);
        const auto target = pinned.path / path.filename();
        {
            const auto attributes = GetFileAttributesW(api_path(target).c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES) win_error("无法读取文件属性");
            if ((attributes & FILE_ATTRIBUTE_READONLY) != 0)
                fail("READ_ONLY", "文件是只读的；先取消只读属性再转换行分隔符。");
        }
        auto original = open_regular(target, root_);
        const auto current = read_bytes(original.get());
        if (fingerprint(current) != expectedVersion) {
            original.reset();
            fail("CONFLICT", "文件已被外部修改，请重新读取后再转换行分隔符。");
        }
        // The stored bytes must not be binary or oversized; reuse the read guard.
        std::size_t bom_length = 0;
        validate_bytes(current, resolve_read(current, "auto", bom_length));
        original.reset();  // ReplaceFileW cannot touch a file this handle still holds open.
        const std::string converted = convert_endings(content, separator == "crlf" ? "\r\n" : "\n");
        const auto payload = encode_document(converted, utf8_encoding(), false);
        validate_bytes(payload, utf8_encoding());
        if (payload == current)
            return Json{{"path", utf8_path(path)}, {"version", expectedVersion}, {"bytes", payload.size()}, {"changed", false}};
        auto temporary = TemporaryFile::create(pinned.path);
        write_temporary(temporary, payload);
        auto backup = TemporaryFile::create(pinned.path);
        backup.handle.reset();
        Handle verification;
        BY_HANDLE_FILE_INFORMATION original_identity{};
        try {
            verification = open_regular(target, root_, FILE_SHARE_READ | FILE_SHARE_DELETE);
            const auto again = read_bytes(verification.get());
            if (fingerprint(again) != expectedVersion)
                fail("CONFLICT", "转换前检测到文件已被外部修改，请重新读取。");
            original_identity = file_info(verification.get());
        } catch (const WorkspaceError& error) {
            if (error.code == "NOT_FOUND" || error.code == "NOT_FILE" ||
                error.code == "FILE_TOO_LARGE" || error.code == "FILE_BUSY")
                fail("CONFLICT", "转换前文件已改变或正在被其他程序写入，请重新读取。");
            throw;
        }
        replace_safely(target, temporary, backup, original_identity);
        return Json{{"path", utf8_path(path)}, {"version", fingerprint(payload)}, {"bytes", payload.size()}, {"changed", true}};
    });
}

Json Workspace::write(const std::string& relative, const std::string& content,
                      const std::string& expectedVersion, const std::string& encoding, bool bom) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto path = parse_relative(relative);
        if (path.empty()) fail("NOT_FILE", "工作区根目录不是正规文件。");
        validate_content(content);
        const auto& chosen = encoding.empty() || encoding == "auto" ? utf8_encoding() : encoding_for(encoding);
        // The document's line endings are a buffer property (CodeMirror keeps LF in
        // memory and joins with EditorState.lineSeparator), so the bytes written must
        // carry them too — otherwise saving a CRLF file silently converts it to LF.
        const std::string separator = content.find("\r\n") != std::string::npos ? "\r\n" : "\n";
        const auto bytes = encode_document(convert_endings(content, separator), chosen, bom);
        validate_bytes(bytes, chosen);
        auto pinned = pin_directory(root_ / path.parent_path(), root_);
        const auto target = pinned.path / path.filename();
        {
            auto original = open_regular(target, root_);
            const auto current = read_bytes(original.get());
            if (fingerprint(current) != expectedVersion)
                fail("CONFLICT", "文件已被外部修改，请重新读取后再保存。");
            validate_bytes(current, chosen);
            // ReplaceFileW refuses a read-only destination with ERROR_ACCESS_DENIED;
            // IDEA likewise only lets you save a locked file after unlocking it.
            original.reset();
            if (!clear_read_only_bit(target))
                fail("READ_ONLY", "文件是只读的且无法解除锁定；先取消只读属性再保存。");
        }
        Json result = {{"version", fingerprint(bytes)}, {"bytes", bytes.size()},
                       {"encoding", chosen.key}, {"bom", bom}};
        auto temporary = TemporaryFile::create(pinned.path);
        write_temporary(temporary, bytes);
        auto backup = TemporaryFile::create(pinned.path);
        backup.handle.reset();

        Handle verification;
        BY_HANDLE_FILE_INFORMATION original_identity{};
        try {
            verification = open_regular(target, root_, FILE_SHARE_READ | FILE_SHARE_DELETE);
            const auto current = read_bytes(verification.get());
            if (fingerprint(current) != expectedVersion)
                fail("CONFLICT", "保存前检测到文件已被外部修改，请重新读取。");
            validate_bytes(current, chosen);
            original_identity = file_info(verification.get());
        } catch (const WorkspaceError& error) {
            if (error.code == "NOT_FOUND" || error.code == "NOT_FILE" ||
                error.code == "FILE_TOO_LARGE" || error.code == "FILE_BUSY")
                fail("CONFLICT", "保存前文件已改变或正在被其他程序写入，请重新读取。");
            throw;
        }
        // 同实例串行且替换前复核内容；不承诺跨进程的原子比较并交换。
        replace_safely(target, temporary, backup, original_identity);
        return result;
    });
}

Json Workspace::create(const std::string& relative, bool directory, const std::string& template_kind) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto path = parse_relative(relative);
        if (path.empty()) fail("INVALID_PATH", "请填写要创建的文件或目录名。");
        const auto pinned = pin_directory(root_ / path.parent_path(), root_);
        const auto target = pinned.path / path.filename();
        if (directory) {
            if (!CreateDirectoryW(api_path(target).c_str(), nullptr)) {
                const auto error = GetLastError();
                if (error == ERROR_ALREADY_EXISTS) fail("EXISTS", "同名目录已存在。");
                win_error("无法创建目录", error);
            }
        } else {
            Handle handle(CreateFileW(api_path(target).c_str(), GENERIC_WRITE, 0, nullptr,
                                      CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
            if (!handle) {
                const auto error = GetLastError();
                if (error == ERROR_FILE_EXISTS || error == ERROR_ALREADY_EXISTS) fail("EXISTS", "同名文件已存在。");
                win_error("无法创建文件", error);
            }
            if (!template_kind.empty()) {
                const auto filename = path.filename().string();
                const auto dot = filename.find_last_of('.');
                const auto base_name = dot == std::string::npos ? filename : filename.substr(0, dot);
                std::string content;
                if (template_kind == "java-class") {
                    content = "public class " + base_name + " {\n"
                              "    \n"
                              "}\n";
                } else if (template_kind == "java-interface") {
                    content = "public interface " + base_name + " {\n"
                              "    \n"
                              "}\n";
                } else if (template_kind == "java-enum") {
                    content = "public enum " + base_name + " {\n"
                              "    \n"
                              "}\n";
                } else if (template_kind == "java-record") {
                    content = "public record " + base_name + "() {\n"
                              "    \n"
                              "}\n";
                } else if (template_kind == "java-annotation") {
                    content = "import java.lang.annotation.*;\n\n"
                              "@Retention(RetentionPolicy.RUNTIME)\n"
                              "@Target(ElementType.TYPE)\n"
                              "public @interface " + base_name + " {\n"
                              "    \n"
                              "}\n";
                } else if (template_kind == "kotlin-class") {
                    content = "class " + base_name + " {\n"
                              "    \n"
                              "}\n";
                } else if (template_kind == "kotlin-object") {
                    content = "object " + base_name + " {\n"
                              "    \n"
                              "}\n";
                } else if (template_kind == "kotlin-interface") {
                    content = "interface " + base_name + " {\n"
                              "    \n"
                              "}\n";
                } else if (template_kind == "kotlin-data") {
                    content = "data class " + base_name + "(\n"
                              "    \n"
                              ")\n";
                } else if (template_kind == "typescript-class") {
                    content = "export class " + base_name + " {\n"
                              "    \n"
                              "}\n";
                } else if (template_kind == "typescript-interface") {
                    content = "export interface " + base_name + " {\n"
                              "    \n"
                              "}\n";
                } else if (template_kind == "typescript-enum") {
                    content = "export enum " + base_name + " {\n"
                              "    \n"
                              "}\n";
                } else if (template_kind == "vue-component") {
                    content = "<template>\n"
                              "  <div>\n"
                              "    \n"
                              "  </div>\n"
                              "</template>\n\n"
                              "<script setup lang=\"ts\">\n"
                              "</script>\n\n"
                              "<style scoped>\n"
                              "</style>\n";
                } else if (template_kind == "react-component") {
                    content = "export function " + base_name + "() {\n"
                              "  return (\n"
                              "    <div>\n"
                              "      \n"
                              "    </div>\n"
                              "  )\n"
                              "}\n";
                } else if (template_kind == "html-file") {
                    content = "<!DOCTYPE html>\n"
                              "<html lang=\"zh-CN\">\n"
                              "<head>\n"
                              "    <meta charset=\"UTF-8\">\n"
                              "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
                              "    <title>" + base_name + "</title>\n"
                              "</head>\n"
                              "<body>\n"
                              "    \n"
                              "</body>\n"
                              "</html>\n";
                } else if (template_kind == "markdown-file") {
                    content = "# " + base_name + "\n\n";
                }
                if (!content.empty()) {
                    std::size_t offset = 0;
                    while (offset < content.size()) {
                        DWORD written = 0;
                        if (!WriteFile(handle.get(), content.data() + offset,
                                       static_cast<DWORD>(content.size() - offset), &written, nullptr))
                            win_error("写入文件模板内容失败");
                        if (!written) fail("IO_ERROR", "写入文件模板内容时未能继续写入。");
                        offset += written;
                    }
                }
            }
        }
        return {{"path", utf8_path(path)}, {"directory", directory}};
    });
}

Json Workspace::rename(const std::string& from, const std::string& to) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto source = parse_relative(from);
        const auto destination = parse_relative(to);
        if (source.empty() || destination.empty()) fail("INVALID_PATH", "重命名需要一个明确的源和目标。");
        if (source == destination) return {{"path", utf8_path(destination)}, {"renamed", false}};
        const auto source_full = root_ / source;
        if (GetFileAttributesW(api_path(source_full).c_str()) == INVALID_FILE_ATTRIBUTES)
            fail("NOT_FOUND", "要重命名的项目不存在。");
        const auto pinned = pin_directory(root_ / destination.parent_path(), root_);
        const auto target_full = pinned.path / destination.filename();
        if (GetFileAttributesW(api_path(target_full).c_str()) != INVALID_FILE_ATTRIBUTES)
            fail("EXISTS", "目标名称已存在。");
        if (!MoveFileExW(api_path(source_full).c_str(), api_path(target_full).c_str(), 0))
            win_error("重命名失败");
        return {{"path", utf8_path(destination)}, {"renamed", true}};
    });
}

namespace {

// Recursive remove for IDEA's $Delete on a populated directory: the tree is walked
// with the same FindFirstFileW enumeration the listing uses, refusing reparse
// points and bounded so a pathological tree can never loop the caller. Excluded
// names (node_modules, .git) are NOT pruned — IDEA's delete removes everything
// under the selection; exclusions only affect listing and indexing.
void remove_tree(const fs::path& directory, const fs::path& root, std::size_t& budget) {
    WIN32_FIND_DATAW data{};
    const HANDLE search = FindFirstFileW(api_path(directory / L"*").c_str(), &data);
    if (search == INVALID_HANDLE_VALUE) {
        const auto error = GetLastError();
        if (error != ERROR_FILE_NOT_FOUND && error != ERROR_NO_MORE_FILES)
            win_error("无法枚举要删除的目录", error);
        return;
    }
    struct FindGuard { HANDLE handle; ~FindGuard() { FindClose(handle); } } guard{search};
    std::vector<fs::path> nested;
    do {
        const std::wstring_view name(data.cFileName);
        if (name == L"." || name == L"..") continue;
        const auto child = directory / data.cFileName;
        if (data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
            fail("REPARSE_POINT", "不允许删除重解析点。");
        if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) nested.push_back(child);
        else {
            if (budget-- == 0) fail("TOO_MANY_FILES", "目录内容过多，删除已中止。");
            if (data.dwFileAttributes & FILE_ATTRIBUTE_READONLY)
                SetFileAttributesW(api_path(child).c_str(), data.dwFileAttributes & ~FILE_ATTRIBUTE_READONLY);
            if (!DeleteFileW(api_path(child).c_str())) win_error("无法删除文件");
        }
    } while (FindNextFileW(search, &data));
    for (const auto& child : nested) {
        if (budget-- == 0) fail("TOO_MANY_FILES", "目录内容过多，删除已中止。");
        remove_tree(child, root, budget);
        if (!RemoveDirectoryW(api_path(child).c_str())) win_error("无法删除目录");
    }
}

// Recursive copy for the project-view Paste: content-identical copy of a file or
// tree. CopyFileW preserves attributes, so the read-only bit is cleared afterwards
// — IDEA's pasted copies stay editable.
void copy_tree(const fs::path& source, const fs::path& target, const fs::path& root,
               std::size_t& budget) {
    const auto attributes = GetFileAttributesW(api_path(source).c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES) win_error("无法读取要复制的项目属性");
    if (attributes & FILE_ATTRIBUTE_REPARSE_POINT)
        fail("REPARSE_POINT", "不允许复制符号链接或联接点。");
    if (attributes & FILE_ATTRIBUTE_DIRECTORY) {
        if (!CreateDirectoryW(api_path(target).c_str(), nullptr)) {
            const auto error = GetLastError();
            if (error == ERROR_ALREADY_EXISTS) fail("EXISTS", "同名目录已存在。");
            win_error("无法创建复制目标目录", error);
        }
        WIN32_FIND_DATAW data{};
        const HANDLE search = FindFirstFileW(api_path(source / L"*").c_str(), &data);
        if (search == INVALID_HANDLE_VALUE) {
            const auto error = GetLastError();
            if (error != ERROR_FILE_NOT_FOUND && error != ERROR_NO_MORE_FILES)
                win_error("无法枚举要复制的目录", error);
            return;
        }
        struct FindGuard { HANDLE handle; ~FindGuard() { FindClose(handle); } } guard{search};
        do {
            const std::wstring_view name(data.cFileName);
            if (name == L"." || name == L"..") continue;
            if (budget-- == 0) fail("TOO_MANY_FILES", "复制内容过多，操作已中止。");
            copy_tree(source / name, target / name, root, budget);
        } while (FindNextFileW(search, &data));
        return;
    }
    if (budget-- == 0) fail("TOO_MANY_FILES", "复制内容过多，操作已中止。");
    if (!CopyFileW(api_path(source).c_str(), api_path(target).c_str(), TRUE)) {
        const auto error = GetLastError();
        if (error == ERROR_FILE_EXISTS || error == ERROR_ALREADY_EXISTS) fail("EXISTS", "同名文件已存在。");
        win_error("无法复制文件", error);
    }
    if (attributes & FILE_ATTRIBUTE_READONLY)
        SetFileAttributesW(api_path(target).c_str(), attributes & ~FILE_ATTRIBUTE_READONLY);
}

}  // namespace

Json Workspace::copy(const std::string& from, const std::string& to) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto source = parse_relative(from);
        const auto destination = parse_relative(to);
        if (source.empty() || destination.empty()) fail("INVALID_PATH", "复制需要一个明确的源和目标。");
        if (source == destination) return {{"path", utf8_path(destination)}, {"copied", false}};
        const auto source_full = root_ / source;
        if (GetFileAttributesW(api_path(source_full).c_str()) == INVALID_FILE_ATTRIBUTES)
            fail("NOT_FOUND", "要复制的项目不存在。");
        const auto pinned = pin_directory(root_ / destination.parent_path(), root_);
        const auto target_full = pinned.path / destination.filename();
        if (GetFileAttributesW(api_path(target_full).c_str()) != INVALID_FILE_ATTRIBUTES)
            fail("EXISTS", "目标名称已存在。");
        std::size_t budget = 20000;
        copy_tree(source_full, target_full, root_, budget);
        return {{"path", utf8_path(destination)}, {"copied", true}};
    });
}

// RevealInAction: Explorer with the entry selected. The path is re-resolved through
// the same guards as read, so a reparse point or an escaping path never reaches the
// shell.
Json Workspace::reveal(const std::string& relative) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto path = parse_relative(relative);
        const fs::path target = path.empty() ? root_ : root_ / path;
        const auto attributes = GetFileAttributesW(api_path(target).c_str());
        if (path.empty()) {
            if (attributes == INVALID_FILE_ATTRIBUTES) fail("NOT_FOUND", "工作区目录不存在。");
        } else if (attributes == INVALID_FILE_ATTRIBUTES || attributes & FILE_ATTRIBUTE_REPARSE_POINT) {
            fail("NOT_FOUND", "要显示的项目不存在。");
        }
        std::wstring argument = L"/select,\"" + target.native() + L"\"";
        const auto instance = ShellExecuteW(nullptr, L"open", L"explorer.exe", argument.c_str(), nullptr, SW_SHOWNORMAL);
        if (reinterpret_cast<int>(instance) <= 32)
            fail("IO_ERROR", "无法打开资源管理器。");
        return {{"path", utf8_path(path)}, {"revealed", true}};
    });
}

Json Workspace::remove(const std::string& relative) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto path = parse_relative(relative);
        if (path.empty()) fail("INVALID_PATH", "不能删除工作区根目录。");
        const auto pinned = pin_directory(root_ / path.parent_path(), root_);
        const auto target = pinned.path / path.filename();
        const auto attr = GetFileAttributesW(api_path(target).c_str());
        if (attr == INVALID_FILE_ATTRIBUTES) fail("NOT_FOUND", "要删除的项目不存在。");
        if (attr & FILE_ATTRIBUTE_REPARSE_POINT) fail("REPARSE_POINT", "不允许删除重解析点。");
        if (attr & FILE_ATTRIBUTE_DIRECTORY) {
            // IDEA's $Delete removes a populated tree after the "and all of its
            // contents?" confirmation — everything under the selection goes.
            std::size_t budget = 200000;
            remove_tree(target, root_, budget);
            if (!RemoveDirectoryW(api_path(target).c_str()))
                win_error("无法删除目录");
        } else {
            if (attr & FILE_ATTRIBUTE_READONLY)
                SetFileAttributesW(api_path(target).c_str(), attr & ~FILE_ATTRIBUTE_READONLY);
            if (!DeleteFileW(api_path(target).c_str())) win_error("无法删除文件");
        }
        return {{"path", utf8_path(path)}, {"deleted", true}};
    });
}

bool Workspace::is_open() const {
    return boundary([&] {
        std::lock_guard lock(mutex_);
        return !root_.empty();
    });
}

} // namespace taocode
