// 文件/路径操作原语（fsops）：UTF-8 转换、路径校验、Pin、创建/写入/替换。
// 从 projects.cpp 拆出（桃 2026-09-26：模块化）。全 inline，各模块 include 自取。
#pragma once

#include "workspace.hpp"

#include <windows.h>

#include <bcrypt.h>
#include <filesystem>

namespace fs = std::filesystem;
#include <string_view>

namespace taocode {

[[noreturn]] inline void fail(const char* code, const std::string& message) {
    throw WorkspaceError(code, message);
}

std::string utf8_path(const fs::path& path) {
    const auto text = path.generic_u8string();
    return {reinterpret_cast<const char*>(text.data()), text.size()};
}


fs::path from_utf8(const std::string& text) {
    if (!valid_utf8(text)) fail("INVALID_PATH", "Paths must be UTF-8 without NUL bytes.");
    return fs::path(std::u8string(text.begin(), text.end()));
}

bool equal_name(std::wstring_view left, std::wstring_view right) {
    return CompareStringOrdinal(left.data(), static_cast<int>(left.size()), right.data(),
                                static_cast<int>(right.size()), TRUE) == CSTR_EQUAL;
}

void validate_component(const std::wstring& name, const char* code = "INVALID_PATH") {
    if (name.empty() || name.size() > 255 || name == L"." || name == L".." ||
        name.back() == L'.' || name.back() == L' ')
        fail(code, "A directory name must be a single ordinary Windows name.");
    for (wchar_t ch : name) {
        if (ch < 32 || (ch >= 127 && ch <= 159) ||
            std::wstring_view(L"/\\:<>\"|?*").find(ch) != std::wstring_view::npos)
            fail(code, "Paths, control characters and Windows special characters are not allowed here.");
    }
    if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, name.data(),
                             static_cast<int>(name.size()), nullptr, 0, nullptr, nullptr))
        fail(code, "A directory name must contain valid Unicode.");
    auto base = std::wstring_view(name).substr(0, name.find(L'.'));
    while (!base.empty() && base.back() == L' ') base.remove_suffix(1);
    if (equal_name(base, L"CON") || equal_name(base, L"PRN") || equal_name(base, L"AUX") ||
        equal_name(base, L"NUL") || equal_name(base, L"CONIN$") ||
        equal_name(base, L"CONOUT$") || equal_name(base, L"CLOCK$"))
        fail(code, "Windows device names are not allowed.");
    if (base.size() == 4 &&
        (equal_name(base.substr(0, 3), L"COM") || equal_name(base.substr(0, 3), L"LPT")) &&
        ((base[3] >= L'1' && base[3] <= L'9') || base[3] == L'\u00b9' ||
         base[3] == L'\u00b2' || base[3] == L'\u00b3'))
        fail(code, "Windows device names are not allowed.");
}

fs::path absolute_path(fs::path path, bool require_absolute = false) {
    if (path.empty() || path.native().find(L'\0') != std::wstring::npos)
        fail("INVALID_PATH", "A path cannot be empty or contain NUL characters.");
    path.make_preferred();
    const auto& text = path.native();
    if (text.starts_with(L"\\\\?\\") || text.starts_with(L"\\\\.\\") ||
        text.starts_with(L"\\??\\") || text.starts_with(L"\\\\??\\"))
        fail("INVALID_PATH", "Device and extended Windows namespaces are not accepted.");
    if ((require_absolute && !path.is_absolute()) ||
        (path.has_root_name() && !path.has_root_directory()) ||
        (path.has_root_directory() && !path.has_root_name()))
        fail("INVALID_PATH", "Use a complete drive/UNC path, not a drive-relative path.");
    // Validate before normalization: never erase a reparse/.. traversal.
    for (const auto& part : path.relative_path()) {
        if (!part.empty() && part != L".") validate_component(part.native());
    }
    path = fs::absolute(path).lexically_normal();
    path.make_preferred();
    while (path.has_relative_path() && path.filename().empty()) path = path.parent_path();
    const auto root = path.root_name().native();
    const bool unc = root.starts_with(L"\\\\");
    if (!path.is_absolute() ||
        (!unc && (root.size() != 2 || root[1] != L':' ||
                  !((root[0] >= L'A' && root[0] <= L'Z') ||
                    (root[0] >= L'a' && root[0] <= L'z')))))
        fail("INVALID_PATH", "Only ordinary drive paths and UNC shares are supported.");
    if (unc) {
        validate_component(root.substr(2));
        if (path.relative_path().empty()) fail("INVALID_PATH", "A UNC path needs a share name.");
    }
    for (const auto& part : path.relative_path()) validate_component(part.native());
    return path;
}

std::wstring api_path(const fs::path& path) {
    const auto& text = path.native();
    return text.starts_with(L"\\\\") ? L"\\\\?\\UNC\\" + text.substr(2) : L"\\\\?\\" + text;
}

BY_HANDLE_FILE_INFORMATION file_info(HANDLE handle) {
    BY_HANDLE_FILE_INFORMATION info{};
    if (!GetFileInformationByHandle(handle, &info)) win_error("Cannot inspect filesystem object");
    return info;
}

void reject_reparse(const BY_HANDLE_FILE_INFORMATION& info) {
    if (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
        fail("REPARSE_POINT", "Symbolic links, junctions and other reparse points are not allowed.");
    if (info.dwFileAttributes & FILE_ATTRIBUTE_DEVICE)
        fail("INVALID_PATH", "Device objects are not allowed.");
}

fs::path final_path(HANDLE handle) {
    const DWORD size = GetFinalPathNameByHandleW(handle, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (!size) win_error("Cannot resolve canonical path");
    std::wstring text(size, L'\0');
    const DWORD length = GetFinalPathNameByHandleW(handle, text.data(), size,
                                                  FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (!length) win_error("Cannot resolve canonical path");
    if (length >= size) fail("IO_ERROR", "The canonical path changed while being resolved.");
    text.resize(length);
    if (text.starts_with(L"\\\\?\\UNC\\")) text = L"\\\\" + text.substr(8);
    else if (text.starts_with(L"\\\\?\\")) text.erase(0, 4);
    return absolute_path(fs::path(text), true);
}

enum class Missing { reject, allow, create };
struct PinnedDirectory {
    fs::path path;
    std::vector<Handle> handles;
    bool exists = true;
};

PinnedDirectory pin_directory(const fs::path& input, Missing missing = Missing::reject) {
    const auto directory = absolute_path(input);
    PinnedDirectory result;
    result.path = directory.root_path();
    const auto remainder = directory.relative_path();
    auto part = remainder.begin();
    if (directory.root_name().native().starts_with(L"\\\\")) result.path /= *part++;
    const auto pin = [&](bool root) {
        if (!result.exists) return;
        auto name = api_path(result.path);
        Handle handle(CreateFileW(name.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ, nullptr,
                                  OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS |
                                  FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
        if (!handle) {
            const auto error = GetLastError();
            if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND)
                win_error("Cannot access directory", error);
            if (root || missing == Missing::reject) win_error("Directory does not exist", error);
            if (missing == Missing::allow) {
                result.exists = false;
                return;
            }
            if (!CreateDirectoryW(name.c_str(), nullptr) && GetLastError() != ERROR_ALREADY_EXISTS)
                win_error("Cannot create application configuration directory");
            handle = Handle(CreateFileW(name.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ, nullptr,
                                         OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS |
                                         FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
            if (!handle) win_error("Cannot access application configuration directory");
        }
        const auto info = file_info(handle.get());
        reject_reparse(info);
        if (!(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY))
            fail("NOT_DIRECTORY", "The requested parent is not a directory.");
        result.path = final_path(handle.get());
        result.handles.push_back(std::move(handle));
    };
    pin(true);
    for (; part != remainder.end(); ++part) {
        result.path /= *part;
        pin(false);
    }
    return result;
}

void require_absent(const fs::path& path) {
    const auto name = api_path(path);
    if (GetFileAttributesW(name.c_str()) != INVALID_FILE_ATTRIBUTES)
        fail("ALREADY_EXISTS", "An object already exists at the project destination.");
    const auto error = GetLastError();
    if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND)
        win_error("Cannot check project destination", error);
    // OPEN_REPARSE_POINT also detects dangling links without following their target.
    Handle object(CreateFileW(name.c_str(), FILE_READ_ATTRIBUTES,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                              OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT |
                              FILE_FLAG_BACKUP_SEMANTICS, nullptr));
    if (object) fail("ALREADY_EXISTS", "An object already exists at the project destination.");
    const auto open_error = GetLastError();
    if (open_error != ERROR_FILE_NOT_FOUND && open_error != ERROR_PATH_NOT_FOUND)
        win_error("Cannot check project destination", open_error);
}

std::string random_suffix() {
    std::array<UCHAR, 16> bytes{};
    if (BCryptGenRandom(nullptr, bytes.data(), static_cast<ULONG>(bytes.size()),
                        BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0)
        fail("IO_ERROR", "Cannot generate a secure temporary name.");
    constexpr char digits[] = "0123456789abcdef";
    std::string result(bytes.size() * 2, '0');
    for (std::size_t i = 0; i < bytes.size(); ++i) {
        result[2 * i] = digits[bytes[i] >> 4];
        result[2 * i + 1] = digits[bytes[i] & 15];
    }
    return result;
}

struct OwnedObject {
    fs::path path;
    Handle handle;
    BY_HANDLE_FILE_INFORMATION identity{};
    bool cleanup = true;

    OwnedObject() = default;
    OwnedObject(const OwnedObject&) = delete;
    OwnedObject& operator=(const OwnedObject&) = delete;
    OwnedObject(OwnedObject&& other) noexcept
        : path(std::move(other.path)), handle(std::move(other.handle)), identity(other.identity),
          cleanup(std::exchange(other.cleanup, false)) {}
    ~OwnedObject() {
        if (!cleanup) return;
        if (handle) {
            FILE_DISPOSITION_INFO disposition{TRUE};
            if (SetFileInformationByHandle(handle.get(), FileDispositionInfo, &disposition, sizeof(disposition))) return;
            // Delete-on-close can still be refused (a filter driver, a file someone
            // marked read-only after the fact). Fall back to an explicit delete once
            // our handle is gone, so a failed save never strands a temporary file.
            const auto owned = path;
            handle.reset();
            // DeleteFileW does not throw; the return value is deliberately ignored
            // because this is the last-resort cleanup of an already-failed save.
            DeleteFileW(api_path(owned).c_str());
            return;
        }
        // Never recursively remove a path which another process could have replaced.
        try {
            Handle current(CreateFileW(api_path(path).c_str(), DELETE | FILE_READ_ATTRIBUTES,
                                       FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                       OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS |
                                       FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
            BY_HANDLE_FILE_INFORMATION info{};
            if (current && GetFileInformationByHandle(current.get(), &info) &&
                info.dwVolumeSerialNumber == identity.dwVolumeSerialNumber &&
                info.nFileIndexHigh == identity.nFileIndexHigh && info.nFileIndexLow == identity.nFileIndexLow) {
                FILE_DISPOSITION_INFO disposition{TRUE};
                SetFileInformationByHandle(current.get(), FileDispositionInfo, &disposition, sizeof(disposition));
            }
        } catch (...) {
            // Best-effort cleanup must not mask the original failure.
        }
    }
};

OwnedObject new_file(const fs::path& path) {
    OwnedObject result;
    result.path = path;
    result.handle = Handle(CreateFileW(api_path(path).c_str(), GENERIC_WRITE | DELETE | FILE_READ_ATTRIBUTES,
                                       0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!result.handle) {
        result.cleanup = false;
        win_error("Cannot create project/configuration file");
    }
    result.identity = file_info(result.handle.get());
    return result;
}

OwnedObject new_directory(const fs::path& path) {
    if (!CreateDirectoryW(api_path(path).c_str(), nullptr)) win_error("Cannot create project directory");
    OwnedObject result;
    result.path = path;
    // Do not remove an unverified object if someone interferes between create/open.
    result.cleanup = false;
    result.handle = Handle(CreateFileW(api_path(path).c_str(), DELETE | FILE_READ_ATTRIBUTES,
                                       FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                       FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (!result.handle) win_error("Cannot pin project directory");
    result.identity = file_info(result.handle.get());
    reject_reparse(result.identity);
    if (!(result.identity.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY))
        fail("NOT_DIRECTORY", "The project directory changed unexpectedly.");
    result.cleanup = true;
    return result;
}

OwnedObject temporary_object(const fs::path& parent, bool directory) {
    for (int attempt = 0; attempt < 16; ++attempt) {
        const auto path = parent / (".taocode-project-" + random_suffix() + ".tmp");
        try { return directory ? new_directory(path) : new_file(path); }
        catch (const WorkspaceError& error) { if (error.code != "ALREADY_EXISTS") throw; }
    }
    fail("IO_ERROR", "Cannot allocate a unique temporary name.");
}

void write_and_flush(HANDLE handle, std::string_view bytes) {
    std::size_t offset = 0;
    while (offset != bytes.size()) {
        DWORD written = 0;
        if (!WriteFile(handle, bytes.data() + offset, static_cast<DWORD>(bytes.size() - offset),
                       &written, nullptr))
            win_error("Cannot write temporary file");
        if (!written) fail("IO_ERROR", "Writing the temporary file made no progress.");
        offset += written;
    }
    if (!FlushFileBuffers(handle)) win_error("Cannot flush temporary file to disk");
}

void rename_handle(HANDLE source, const fs::path& target, bool replace) {
    // SetFileInformationByHandle(FileRenameInfo) hands FileName to the DOS-namespace
    // parser, which reads until a NUL even though FileNameLength is authoritative.
    // Reserve a trailing NUL so it cannot read past the buffer (which otherwise
    // yields run-dependent garbage suffixes or ERROR_INVALID_NAME on stray bytes).
    const auto name = api_path(target);
    const auto name_bytes = name.size() * sizeof(wchar_t);
    const auto bytes = offsetof(FILE_RENAME_INFO, FileName) + name_bytes;
    if (bytes > (std::numeric_limits<DWORD>::max)() - sizeof(wchar_t))
        fail("INVALID_PATH", "The target path is too long.");
    std::vector<unsigned char> buffer(bytes + sizeof(wchar_t), 0);  // +NUL, zero-initialised
    auto* info = reinterpret_cast<FILE_RENAME_INFO*>(buffer.data());
    info->ReplaceIfExists = replace ? TRUE : FALSE;
    info->RootDirectory = nullptr;
    info->FileNameLength = static_cast<DWORD>(name_bytes);
    std::copy(name.begin(), name.end(), info->FileName);
    // Same-volume handle-based rename: no source-name race, no copy fallback, and
    // no ReplaceFileW multi-step backup failure which could strand the original.
    if (!SetFileInformationByHandle(source, FileRenameInfo, info, static_cast<DWORD>(buffer.size()))) {
        const auto error = GetLastError();
        if (!replace) require_absent(target);
        win_error("Cannot atomically publish project/configuration", error);
    }
}

constexpr std::size_t max_bookmarks = 200;
constexpr std::int64_t max_bookmark_line = 1'000'000;

} // namespace taocode
