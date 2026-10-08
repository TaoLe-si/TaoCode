#include "workspace.hpp"
#include "base64.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <bcrypt.h>
#include <shellapi.h>

#include "workspace_detail.hpp"
#include "workspace_codec.hpp"  // 编码表 + BOM + UTF-16/UTF-32 转换 + 三档行尾（2026-10-06 拆出）

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <fstream>
#include <limits>
#include <string_view>
#include <utility>
#include <vector>

namespace taocode {

// 2026-10-05 拆出「递归遍历一棵树并删除/复制它」（native/workspace_tree_ops.cpp）之后，
// 下面这几个跨 TU 用的内部工具从匿名命名空间搬进 `detail`：声明在 native/workspace_detail.hpp，
// 定义仍然只有本文件这一份（Win32 错误码映射复制一份就会漂移）。它们与留在匿名命名空间里的
// 其它 helper 互不影响。
namespace detail {
[[noreturn]] void fail(const char* code, const std::string& message) {
    throw WorkspaceError(code, message);
}

// `error` 的默认值（GetLastError()）搬进了 native/workspace_detail.hpp：默认实参写死在调用点，
// 而 workspace_tree_ops.cpp 里是按一个参数调 win_error 的（那一行原样搬过来，没改成显式传参）。
[[noreturn]] void win_error(const std::string& message, DWORD error) {
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

std::string utf8_path(const std::filesystem::path& path) {
    const auto text = path.generic_u8string();
    return {reinterpret_cast<const char*>(text.data()), text.size()};
}

std::wstring api_path(const std::filesystem::path& path) {
    const auto native = path.native();
    if (native.starts_with(L"\\\\?\\")) return native;
    if (native.starts_with(L"\\\\")) return L"\\\\?\\UNC\\" + native.substr(2);
    return L"\\\\?\\" + native;
}

}  // namespace detail

// 下面这个匿名命名空间原来整个包着本文件；2026-10-05 把「递归遍历一棵树并删除/复制它」拆到
// native/workspace_tree_ops.cpp 之后，跨 TU 用的那几个（fail / win_error / utf8_path /
// api_path，以及那边定义、这边调用的 remove_tree / copy_tree）搬进 `detail`（声明见
// native/workspace_detail.hpp，定义仍然只有各自那一个 TU 里的一份）。下面这排 using 让本文件
// 与拆出去的那个 TU 里的调用保持原样，不必改成 detail::xxx(...)；它必须排在匿名命名空间**之前**，
// 因为匿名命名空间里的 helper 也在调它们。
// 2026-10-08 拆「路径守卫」一族到 native/workspace_paths.cpp 时同理：equal_name /
// validate_component / parse_relative / plain_path / within 的**定义**跟着搬走，这里只多一排
// using（本文件不 include fsops.hpp，而那里面另有一份同名的 taocode:: 名字 —— 两个都进候选集
// 就会是 C2668 重载不明确）。
using detail::api_path;
using detail::copy_tree;
using detail::equal_name;
using detail::fail;
using detail::parse_relative;
using detail::plain_path;
using detail::remove_tree;
using detail::utf8_path;
using detail::validate_component;
using detail::win_error;
using detail::within;

namespace {
namespace fs = std::filesystem;
// Hard safety bound for a single text file: large enough to open real source/data
// files smoothly, small enough that a pathological file can never exhaust memory.
constexpr std::size_t max_bytes = 16 * 1024 * 1024;
constexpr std::size_t max_entries = 2000;

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

void validate_bytes(const std::string& content, const Encoding& encoding) {
    if (content.size() > max_bytes)
        fail("FILE_TOO_LARGE", "文件超过 " + std::to_string(max_bytes / (1024 * 1024)) + " MiB 限制。");
    // A NUL byte means binary data unless the encoding is a UTF-16/UTF-32 family member,
    // where NUL is an ordinary half (or three quarters) of almost every Latin character.
    if (!nul_is_text(encoding.page) && content.find('\0') != std::string::npos)
        fail("BINARY_FILE", "文件含有 NUL 字节，不能作为文本打开或保存。");
}

void validate_content(const std::string& content) {
    if (content.size() > max_bytes)
        fail("FILE_TOO_LARGE", "文件超过 " + std::to_string(max_bytes / (1024 * 1024)) + " MiB 限制。");
    if (content.find('\0') != std::string::npos)
        fail("BINARY_FILE", "文件含有 NUL 字节，不能作为文本打开或保存。");
    if (!valid_utf8(content))
        fail("INVALID_UTF8", "文件不是有效的 UTF-8 文本。");
}

// 「路径文本 → 可信 fs::path」的守卫一族（equal_name / validate_component / parse_relative /
// plain_path / within）2026-10-08 整段搬进了 native/workspace_paths.cpp —— 那一族只做一件事：
// 把不可信的路径字符串规范化成 fs::path，并守住"不出工作区、不碰 Windows 设备名/NTFS 数据流"，
// 与留在本文件的读写、编码、回收站、引用扫描、外部链接不共一个职责域。搬动时**实现一个字没改**：
// 声明见 native/workspace_detail.hpp，定义只剩新文件那一份（上面那排 using 照旧让本文件的调用
// 不必改成 detail::xxx(...)）。

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

std::string workspace_search_ignore_fingerprint(const fs::path& root) {
    try {
        auto file = open_regular(root / L".zcodeignore", root,
                                 FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
        const auto info = file_info(file.get());
        return std::to_string(info.ftLastWriteTime.dwHighDateTime) + ":" +
               std::to_string(info.ftLastWriteTime.dwLowDateTime) + ":" +
               std::to_string(info.nFileSizeHigh) + ":" + std::to_string(info.nFileSizeLow);
    } catch (const std::exception&) {
        return "none";
    }
}

std::string read_bytes(HANDLE handle, std::size_t byte_limit = max_bytes) {
    LARGE_INTEGER length{};
    if (!GetFileSizeEx(handle, &length)) win_error("无法读取文件大小");
    if (length.QuadPart < 0 || length.QuadPart > static_cast<LONGLONG>(byte_limit))
        fail("FILE_TOO_LARGE", "文件超过 " + std::to_string(byte_limit / (1024 * 1024)) + " MiB 限制。");
    std::string content;
    content.reserve(static_cast<std::size_t>(length.QuadPart));
    std::array<char, 65536> buffer{};
    for (;;) {
        const auto remaining = byte_limit - content.size();
        if (remaining == 0) break;
        DWORD count = 0;
        const auto request = static_cast<DWORD>(std::min<std::size_t>(buffer.size(), remaining));
        if (!ReadFile(handle, buffer.data(), request, &count, nullptr))
            win_error("读取文件失败");
        if (!count) break;
        content.append(buffer.data(), count);
    }
    if (!GetFileSizeEx(handle, &length)) win_error("无法读取文件大小");
    if (length.QuadPart < 0 || length.QuadPart > static_cast<LONGLONG>(byte_limit))
        fail("FILE_TOO_LARGE", "文件超过 " + std::to_string(byte_limit / (1024 * 1024)) + " MiB 限制。");
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

// The plain write IDEA falls back to when "safe write" is off (SafeWriteRequestor.java:12-15):
// the target is truncated in place, so a failure in the middle leaves a partial file — the
// exact risk the temporary-file path exists to remove.
void write_directly(const fs::path& target, const std::string& content) {
    Handle handle(CreateFileW(api_path(target).c_str(), GENERIC_WRITE,
                              FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr,
                              TRUNCATE_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!handle) win_error("无法打开文件进行写入");
    std::size_t offset = 0;
    while (offset < content.size()) {
        DWORD written = 0;
        if (!WriteFile(handle.get(), content.data() + offset,
                       static_cast<DWORD>(content.size() - offset), &written, nullptr))
            win_error("写入文件失败");
        if (!written) fail("IO_ERROR", "写入文件时未能继续写入。");
        offset += written;
    }
    if (!FlushFileBuffers(handle.get())) win_error("无法将内容刷新到磁盘");
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

}  // namespace

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

Json Workspace::search_files(const std::function<bool()>& cancelled) {
    return boundary([&]() -> Json {
        constexpr auto cache_ttl = std::chrono::seconds(60);
        fs::path root;
        PinnedDirectory root_pin;
        {
            std::lock_guard lock(mutex_);
            require_open(root_);
            root_pin = pin_directory(root_, root_);
            root = root_pin.path;
        }

        const auto root_key = utf8_path(root);
        const auto ignore_fingerprint = workspace_search_ignore_fingerprint(root);
        const auto now = std::chrono::steady_clock::now();
        std::shared_ptr<const std::vector<SearchFileEntry>> cached_index;
        {
            std::lock_guard lock(mutex_);
            if (search_file_index_ && search_file_index_root_ == root_key &&
                search_file_index_ignore_fingerprint_ == ignore_fingerprint &&
                now - search_file_index_cached_at_ < cache_ttl)
                cached_index = search_file_index_;
        }

        const auto make_reply = [&](const std::vector<SearchFileEntry>& index) {
            Json entries = Json::array();
            std::size_t count = 0;
            for (const auto& entry : index) {
                if ((count++ & 1023U) == 0 && cancelled && cancelled())
                    return Json{{"entries", Json::array()}, {"cancelled", true}};
                entries.push_back({{"path", entry.path},
                                   {"type", entry.directory ? "directory" : "file"}});
            }
            return Json{{"entries", std::move(entries)}, {"cancelled", false}};
        };
        if (cached_index) return make_reply(*cached_index);

        std::vector<fs::path> pending{fs::path{}};
        std::vector<SearchFileEntry> entries;
        bool cancelled_hit = false;
        while (!pending.empty()) {
            if (cancelled && cancelled()) { cancelled_hit = true; break; }
            auto relative = std::move(pending.back());
            pending.pop_back();
            PinnedDirectory directory;
            try {
                directory = pin_directory(root / relative, root);
            } catch (const WorkspaceError& error) {
                if (relative.empty()) throw;
                if (error.code == "REPARSE_POINT" || error.code == "NOT_FOUND" ||
                    error.code == "NOT_DIRECTORY") continue;
                throw;
            }

            WIN32_FIND_DATAW data{};
            const HANDLE search = FindFirstFileW(api_path(directory.path / L"*").c_str(), &data);
            if (search == INVALID_HANDLE_VALUE) {
                const auto error = GetLastError();
                if (error == ERROR_FILE_NOT_FOUND || (!relative.empty() && error == ERROR_PATH_NOT_FOUND)) continue;
                win_error("无法列出工作区目录", error);
            }
            struct FindGuard {
                HANDLE handle;
                ~FindGuard() { FindClose(handle); }
            } guard{search};
            do {
                if (cancelled && cancelled()) { cancelled_hit = true; break; }
                const std::wstring name(data.cFileName);
                if (name == L"." || name == L".." ||
                    (data.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DEVICE)))
                    continue;
                const fs::path child = relative / name;
                const bool is_directory = (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
                if (!is_directory && relative.empty() && name == L".zcodeignore") continue;
                if (!is_directory && name.starts_with(L".taocode-replace-")) continue;
                if (is_directory) pending.push_back(child);
                entries.push_back({utf8_path(child), is_directory});
            } while (FindNextFileW(search, &data));
            if (cancelled_hit) break;
            const auto error = GetLastError();
            if (error != ERROR_NO_MORE_FILES)
                win_error("读取工作区目录失败", error);
        }
        if (cancelled_hit || (cancelled && cancelled()))
            return {{"entries", Json::array()}, {"cancelled", true}};
        std::sort(entries.begin(), entries.end(), [](const auto& left, const auto& right) {
            return left.path < right.path;
        });
        auto index = std::make_shared<const std::vector<SearchFileEntry>>(std::move(entries));
        {
            std::lock_guard lock(mutex_);
            if (root_ == root) {
                search_file_index_ = index;
                search_file_index_root_ = root_key;
                search_file_index_ignore_fingerprint_ = ignore_fingerprint;
                search_file_index_cached_at_ = std::chrono::steady_clock::now();
            }
        }
        return make_reply(*index);
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
        // The UTF-8 vs decode choice, the byte-order mark and the strict UTF-8 check all
        // live in the codec now (native/workspace_codec.hpp) — one copy of the messages
        // and one copy of the rules, whatever the encoding on disk.
        const auto content = decode_document(bytes, chosen, bom_length);
        return {{"path", utf8_path(path)}, {"content", std::move(content)}, {"version", std::move(version)},
                {"encoding", chosen.key}, {"bom", bom_length != 0},
                {"readOnly", (file_info(handle.get()).dwFileAttributes & FILE_ATTRIBUTE_READONLY) != 0}};
    });
}

Json Workspace::read_from_root(const fs::path& root, const std::string& relative,
                               const std::string& encoding, std::size_t byte_limit) {
    return boundary([&]() -> Json {
        if (byte_limit == 0 || byte_limit > max_bytes)
            fail("INVALID_LIMIT", "读取大小限制无效。");
        const auto path = parse_relative(relative);
        if (path.empty()) fail("NOT_FILE", "工作区根目录不是正规文件。");
        const auto pinned_root = pin_directory(root);
        const auto pinned_parent = pin_directory(pinned_root.path / path.parent_path(), pinned_root.path);
        auto handle = open_regular(pinned_parent.path / path.filename(), pinned_root.path);
        auto bytes = read_bytes(handle.get(), byte_limit);
        std::size_t bom_length = 0;
        const auto& chosen = resolve_read(bytes, encoding, bom_length);
        validate_bytes(bytes, chosen);
        const auto content = decode_document(bytes, chosen, bom_length);
        return {{"path", utf8_path(path)}, {"content", content}};
    });
}

// ToggleReadOnlyAttributeAction: SetFileAttributesW on the pinned path. The handle is
// opened with attribute access only — a read-only file must still be toggleable.
// JSON is text, so raw file bytes travel base64-encoded to the renderer. Used only
// by read_binary, which caps the payload before this ever sees a large buffer.
// base64_encode 已并入 native/base64.hpp（三处重复实现合并）。

// Sniffs the leading bytes for the formats TaoCode can render without a plugin.
// Everything else falls back to the hex viewer, which is always correct but never
// pretty; the UI decides from `kind`, not from the extension.
std::string sniff_kind(const std::string& bytes) {
    const auto starts = [&](std::string_view magic) {
        return bytes.size() >= magic.size() && std::string_view(bytes.data(), magic.size()) == magic;
    };
    if (starts("\x89PNG\r\n\x1a\n")) return "png";
    if (starts("\xFF\xD8\xFF")) return "jpeg";
    if (starts("GIF87a") || starts("GIF89a")) return "gif";
    if (bytes.size() > 2 && bytes[0] == 'B' && bytes[1] == 'M') return "bmp";
    if (starts("RIFF") && bytes.size() > 12 && std::string_view(bytes.data() + 8, 4) == "WEBP") return "webp";
    if (bytes.size() > 4 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F') return "riff";
    if (starts("%PDF-")) return "pdf";
    return "binary";
}

Json Workspace::read_binary(const std::string& relative, std::size_t limit) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto path = parse_relative(relative);
        if (path.empty()) fail("NOT_FILE", "工作区根目录不是正规文件。");
        if (limit == 0 || limit > max_bytes) limit = max_bytes;
        auto pinned = pin_directory(root_ / path.parent_path(), root_);
        auto handle = open_regular(pinned.path / path.filename(), root_);
        const auto info = file_info(handle.get());
        reject_reparse(info);
        if (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) fail("NOT_FILE", "目录不能用二进制方式查看。");
        const auto total = (static_cast<std::uint64_t>(info.nFileSizeHigh) << 32) | info.nFileSizeLow;
        const auto take = static_cast<std::size_t>(std::min<std::uint64_t>(total, limit));
        std::string bytes(take, '\0');
        std::size_t offset = 0;
        while (offset < take) {
            DWORD got = 0;
            const auto chunk = static_cast<DWORD>(std::min<std::size_t>(take - offset, 1u << 20));
            if (!ReadFile(handle.get(), bytes.data() + offset, chunk, &got, nullptr) || !got) break;
            offset += got;
        }
        bytes.resize(offset);
        return {{"path", utf8_path(path)}, {"size", total}, {"truncated", total > offset},
                {"bytes", static_cast<std::size_t>(offset)}, {"base64", base64_encode(bytes)},
                {"kind", sniff_kind(bytes)},
                {"readOnly", (info.dwFileAttributes & FILE_ATTRIBUTE_READONLY) != 0}};
    });
}

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

// ConvertToWindows/Unix/MacLineSeparatorsAction: rewrite the file on disk with every line
// ending normalized to `separator` ("crlf" | "lf" | "cr" — the three tiers of
// `LineSeparator.java:17-20`). `content` is the editor buffer as
// it would be saved (its encoding/BOM are supplied by the caller through write(); here
// the payload is UTF-8, matching what a save of that buffer produces). A version check
// rejects any external change first, and a read-only file is refused before touching.
Json Workspace::convert_line_separators(const std::string& relative, const std::string& separator,
                                        const std::string& content, const std::string& expectedVersion) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        // The single tier table: anything other than crlf/lf/cr fails here, before the
        // file is opened, and no tier falls through to a default byte sequence.
        const auto& terminator = line_separator_bytes(separator);
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
        const std::string converted = convert_endings(content, terminator);
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
                      const std::string& expectedVersion, const std::string& encoding, bool bom,
                      bool safe_write) {
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
        // The tier is *counted*, not matched: `LoadTextUtil.java:801-813` weighs CRLF,
        // lone CR and LF against each other, because a classic-Mac buffer contains no
        // "\r\n" at all and the old two-way sniff rewrote all of its line endings to LF.
        const auto separator = detect_separator(content);
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
        // "Use safe write" off: IDEA writes straight into the file (SafeWriteRequestor
        // .java:12-15). The conflict and read-only checks above still run — they guard
        // against losing someone else's work, which is not what this option trades away.
        if (!safe_write) {
            write_directly(target, bytes);
            return result;
        }
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

Json Workspace::write_new(const std::string& relative, const std::string& content) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto path = parse_relative(relative);
        if (path.empty()) fail("INVALID_PATH", "请填写要创建的文件名。");
        validate_content(content);
        const auto& encoding = utf8_encoding();
        const auto bytes = encode_document(convert_endings(content, detect_separator(content)), encoding, false);
        validate_bytes(bytes, encoding);
        auto pinned = pin_directory(root_ / path.parent_path(), root_);
        const auto target = pinned.path / path.filename();
        auto temporary = TemporaryFile::create(pinned.path);
        write_temporary(temporary, bytes);
        if (!MoveFileExW(temporary.name.c_str(), api_path(target).c_str(), MOVEFILE_WRITE_THROUGH)) {
            const auto error = GetLastError();
            if (error == ERROR_FILE_EXISTS || error == ERROR_ALREADY_EXISTS)
                fail("EXISTS", "同名文件已存在。");
            win_error("无法原子创建文件", error);
        }
        temporary.cleanup = false;
        return {{"path", utf8_path(path)}, {"version", fingerprint(bytes)}, {"bytes", bytes.size()},
                {"encoding", encoding.key}, {"bom", false}};
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
        // HINSTANCE is pointer-wide: a cast to int would truncate on x64 and could
        // turn a real failure into a value that reads as success.
        if (reinterpret_cast<std::intptr_t>(instance) <= 32)
            fail("IO_ERROR", "无法打开资源管理器。");
        return {{"path", utf8_path(path)}, {"revealed", true}};
    });
}

Json reveal_absolute(const std::string& absolute) {
    return boundary([&]() -> Json {
        if (absolute.empty() || !valid_utf8(absolute) || absolute.find('\0') != std::string::npos)
            fail("INVALID_PATH", "路径必须是没有 NUL 字节的 UTF-8 文本。");
        const fs::path target = fs::path(std::u8string(absolute.begin(), absolute.end())).lexically_normal();
        if (!target.is_absolute()) fail("INVALID_PATH", "只允许绝对路径。");
        // RevealFileAction.openFile(Path) (:170-174) canonicalizes the path and opens its *parent*
        // directory; a root without a parent does nothing at all, so it is reported instead of
        // silently opening an unrelated folder.
        const fs::path parent = target.parent_path();
        if (parent.empty()) fail("INVALID_PATH", "无法定位该项的父目录。");
        const auto attributes = GetFileAttributesW(api_path(parent).c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES || !(attributes & FILE_ATTRIBUTE_DIRECTORY))
            fail("NOT_FOUND", "父目录不存在，无法显示该项。");
        // RevealFileAction.doOpen (:194-211, Windows branch :273): `explorer /select,"<path>"` both
        // loads the parent directory and highlights the entry. The entry itself may be gone — the
        // welcome list keeps unavailable projects and IDEA still opens their parent.
        std::wstring argument = L"/select,\"" + target.native() + L"\"";
        const auto instance = ShellExecuteW(nullptr, L"open", L"explorer.exe", argument.c_str(), nullptr, SW_SHOWNORMAL);
        if (reinterpret_cast<std::intptr_t>(instance) <= 32)
            fail("IO_ERROR", "无法打开资源管理器。");
        return {{"path", utf8_path(target)}, {"revealed", true}};
    });
}

// 这两个 helper 只服务 `open_external`，放进匿名 namespace —— 它们没有任何外部链接需求，
// 而 `utf8_wide` 这种通用名字放进 `taocode` 命名空间就是等着和别的 TU 撞符号。
namespace {
// UTF-8 -> UTF-16LE。调用点都已用 `valid_utf8` 校验过，所以这里不需要 MB_ERR_INVALID_CHARS
// 的失败判定。**不能**用 `fs::path` 走这条路：`lexically_normal()` 会把 URL 里的 `//` 吃掉。
std::wstring utf8_wide(const std::string& text) {
    if (text.empty()) return {};
    const auto needed = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (needed <= 0) return {};
    std::wstring wide(static_cast<std::size_t>(needed), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), wide.data(), needed);
    return wide;
}

// 协议名按 RFC 3986：`scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`，冒号必须出现。
// **Windows 盘符必须排除**：`C:/x.exe` 完全符合上面的语法，而 `ShellExecuteW(L"open", …)`
// 会把它当程序**执行**掉 —— 这是安全边界上最容易漏的一种输入。
bool has_url_scheme(const std::string& url) {
    const auto colon = url.find(':');
    if (colon == std::string::npos || colon == 0) return false;
    if (!std::isalpha(static_cast<unsigned char>(url.front()))) return false;
    // 单字母 scheme 后面紧跟 `/` 或 `\` → 盘符，不是协议。
    if (colon == 1 && colon + 1 < url.size() && (url[colon + 1] == '/' || url[colon + 1] == '\\'))
        return false;
    for (std::size_t i = 1; i < colon; ++i) {
        const auto character = static_cast<unsigned char>(url[i]);
        if (!std::isalnum(character) && character != '+' && character != '-' && character != '.') return false;
    }
    return true;
}
}  // namespace

Json open_external(const std::string& url) {
    return boundary([&]() -> Json {
        if (url.empty() || !valid_utf8(url) || url.find('\0') != std::string::npos)
            fail("INVALID_PATH", "链接必须是没有 NUL 字节的 UTF-8 文本。");
        // **这是安全边界，不是格式检查**：`ShellExecuteW(L"open", …)` 对 `"calc.exe"`、
        // `"C:\tools\x.exe"` 这类没有协议前缀的字符串会直接执行它。而 `url` 可能来自语言服务器
        // （LSP `documentLink.target` 完全由服务器给），放行就是给了服务器一个任意命令执行的入口。
        // 所以只接受带合法协议名的绝对 URL，其余一律拒绝。
        if (!has_url_scheme(url)) fail("INVALID_PATH", "只允许带协议的绝对链接（例如 https://…）。");
        const auto instance = ShellExecuteW(nullptr, L"open", utf8_wide(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        if (reinterpret_cast<std::intptr_t>(instance) <= 32) fail("IO_ERROR", "无法打开该链接。");
        return {{"url", url}, {"opened", true}};
    });
}

Json Workspace::remove(const std::string& relative, bool to_trash) {
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
        // IDEA deletes through the platform trash when the OS offers one; Windows
        // Explorer's "Delete" is undoable, so the same is true here. SHFileOperation
        // restores the original name in the recycle bin (FOF_WANTNUKEWARNING is not
        // set, so a file too large for the bin is reported instead of silently purged).
        if (to_trash) {
            if (attr & FILE_ATTRIBUTE_READONLY &&
                !SetFileAttributesW(api_path(target).c_str(), attr & ~FILE_ATTRIBUTE_READONLY))
                fail("IO_ERROR", "无法解除只读属性，未移入回收站（Windows 错误 " +
                                     std::to_string(GetLastError()) + "）：" + utf8_path(target));
            auto native = target.native();
            native.push_back(L'\0');  // SHFileOperationW wants a double-NUL terminated list
            native.push_back(L'\0');
            SHFILEOPSTRUCTW operation{};
            operation.wFunc = FO_DELETE;
            operation.pFrom = native.c_str();
            operation.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT;
            const int status = SHFileOperationW(&operation);
            if (status != 0 || operation.fAnyOperationsAborted)
                fail("IO_ERROR", "无法把该项移入回收站（Windows 状态 " + std::to_string(status) + "），可改用永久删除。");
            return {{"path", utf8_path(path)}, {"deleted", true}, {"trash", true}};
        }
        if (attr & FILE_ATTRIBUTE_DIRECTORY) {
            // IDEA's $Delete removes a populated tree after the "and all of its
            // contents?" confirmation — everything under the selection goes.
            std::size_t budget = 200000;
            remove_tree(target, root_, budget);
            if (!RemoveDirectoryW(api_path(target).c_str()))
                win_error("无法删除目录");
        } else {
            if (attr & FILE_ATTRIBUTE_READONLY &&
                !SetFileAttributesW(api_path(target).c_str(), attr & ~FILE_ATTRIBUTE_READONLY))
                fail("IO_ERROR", "无法解除只读属性，删除已中止（Windows 错误 " +
                                     std::to_string(GetLastError()) + "）：" + utf8_path(target));
            if (!DeleteFileW(api_path(target).c_str())) win_error("无法删除文件");
        }
        return {{"path", utf8_path(path)}, {"deleted", true}, {"trash", false}};
    });
}

// Safe Delete needs "is anything still referring to this?". The file layer cannot
// ask a language server, so it answers the question it can answer honestly: a
// WORKSPACE-WIDE text scan for the identifier, reported with file/line/preview so
// the UI shows the same rows Find Usages would. It is not a language query — no
// PSI, no scope resolution, no false confidence — and `scope: "workspace"` in the
// reply says so out loud, because a reference to a file about to be deleted can sit
// in any directory (a build script, a manifest, an import) and must not be missed.
// `relative` is the file the caller is about to delete: it names the subject and is
// echoed back, it does not narrow the scan.
constexpr std::size_t max_usage_file_bytes = 8 * 1024 * 1024;  // skip build artifacts
constexpr std::size_t max_usage_files = 20000;                 // ceiling on the walk
constexpr std::size_t usage_sniff_bytes = 8192;                // head read to detect binaries
Json Workspace::usages_of(const std::string& relative, const std::string& symbol, std::size_t limit) {
    return boundary([&]() -> Json {
        std::lock_guard lock(mutex_);
        require_open(root_);
        const auto path = parse_relative(relative);
        if (path.empty()) fail("INVALID_PATH", "请指定工作区内的文件。");
        if (symbol.empty()) fail("INVALID_REQUEST", "请输入要检查的符号名。");
        Json hits = Json::array();
        std::size_t scanned = 0;
        bool ceiling = false;  // the walk stopped on max_usage_files, not on the tree
        std::error_code ec;
        for (fs::recursive_directory_iterator it(root_, fs::directory_options::skip_permission_denied, ec), end; it != end; it.increment(ec)) {
            if (hits.size() >= limit) break;
            if (scanned >= max_usage_files) { ceiling = true; break; }
            const auto& entry = *it;
            const auto relative_path = fs::relative(entry.path(), root_, ec).generic_string();
            if (relative_path.empty() || relative_path == ".") continue;
            // Decode the UTF-8 relative path explicitly: path(const char*) would go
            // through the local code page and mangle non-ASCII directory names.
            const auto decoded = fs::path(std::u8string(relative_path.begin(), relative_path.end()));
            if (std::find(excluded_.begin(), excluded_.end(), decoded.filename().wstring()) != excluded_.end()) {
                it.disable_recursion_pending();
                continue;
            }
            if (entry.is_directory(ec)) continue;
            if (entry.is_symlink(ec)) continue;
            std::error_code size_error;
            const auto size = fs::file_size(entry.path(), size_error);
            if (size_error || size > max_usage_file_bytes) continue;  // artifact/blob: not text
            std::ifstream stream(entry.path(), std::ios::binary);
            if (!stream) continue;
            // Sniff the head for a NUL byte before reading: a .dll or a .png in the
            // workspace is never a text usage, and getline would walk all of it.
            std::array<char, usage_sniff_bytes> head{};
            stream.read(head.data(), static_cast<std::streamsize>(head.size()));
            const auto sniffed = static_cast<std::size_t>(stream.gcount());
            if (std::find(head.data(), head.data() + sniffed, '\0') != head.data() + sniffed) continue;
            stream.clear();
            stream.seekg(0, std::ios::beg);
            ++scanned;
            std::string line;
            std::size_t number = 0;
            while (std::getline(stream, line) && hits.size() < limit) {
                ++number;
                const auto at = line.find(symbol);
                if (at == std::string::npos) continue;
                std::string preview = line;
                if (preview.size() > 240) preview = preview.substr(0, 240);
                for (auto& ch : preview) if (ch == '\r') ch = ' ';
                hits.push_back({{"path", relative_path}, {"line", number}, {"column", at + 1}, {"preview", preview}});
            }
        }
        // `scope` states what this actually is; `truncated` now also covers the
        // walk ceiling, so a cut-short scan is never presented as the whole answer.
        return {{"path", utf8_path(path)}, {"symbol", symbol}, {"scanned", scanned},
                {"scope", "workspace"}, {"kind", "text"},
                {"truncated", hits.size() >= limit || ceiling},
                {"hits", std::move(hits)}};
    });
}

bool Workspace::is_open() const {
    return boundary([&] {
        std::lock_guard lock(mutex_);
        return !root_.empty();
    });
}

} // namespace taocode
