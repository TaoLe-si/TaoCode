#include "projects.hpp"

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
#include <cstddef>
#include <cstdio>
#include <initializer_list>
#include <limits>
#include <mutex>
#include <optional>
#include <regex>
#include <set>
#include <string_view>
#include <utility>
#include <vector>

namespace taocode {
namespace {

constexpr std::size_t state_limit = 1024 * 1024;
constexpr std::size_t recent_limit = 30;
// ponytail: one process-wide lock, including different stores; split by state path
// only if configuration I/O contention matters. No cross-process CAS is promised.
std::mutex store_mutex;

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
    case ERROR_FILE_EXISTS:
    case ERROR_ALREADY_EXISTS: code = "ALREADY_EXISTS"; break;
    case ERROR_INVALID_NAME:
    case ERROR_BAD_PATHNAME:
    case ERROR_FILENAME_EXCED_RANGE: code = "INVALID_PATH"; break;
    case ERROR_DIRECTORY: code = "NOT_DIRECTORY"; break;
    default: break;
    }
    fail(code, message + " (Windows error " + std::to_string(error) + ").");
}

template <class Operation>
auto boundary(Operation&& operation) -> decltype(operation()) {
    try {
        return operation();
    } catch (const WorkspaceError&) {
        throw;
    } catch (const fs::filesystem_error&) {
        fail("IO_ERROR", "The project filesystem operation failed.");
    } catch (const Json::exception&) {
        fail("INVALID_ARGUMENT", "Invalid project request.");
    } catch (const std::exception&) {
        fail("INTERNAL_ERROR", "The project operation could not be completed.");
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
    return text.find('\0') == std::string::npos &&
           text.size() <= static_cast<std::size_t>((std::numeric_limits<int>::max)()) &&
           (text.empty() || MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(),
                                                static_cast<int>(text.size()), nullptr, 0) != 0);
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

constexpr std::size_t max_run_configs = 40;
constexpr std::size_t max_bookmarks = 200;
constexpr std::size_t max_todo_patterns = 20;
constexpr std::int64_t max_bookmark_line = 1'000'000;

std::string text_or(const Json& object, const char* key) {
    if (object.is_object() && object.contains(key) && object.at(key).is_string()) return object.at(key).get<std::string>();
    return {};
}

Json editor_defaults_impl() {
    return {{"fontSize", 14}, {"tabSize", 4}, {"wordWrap", false},
            {"lineNumbers", true}, {"restoreLastProject", false}, {"syncOnFocus", true},
            {"autoSave", false}, {"showIndentGuides", true}, {"bracketMatching", true},
            // UISettingsState.editorTabLimit defaults to 30 open tabs per group.
            {"tabLimit", 30},
            // Indent with tabs instead of spaces, render whitespace, reformat on save
            // (IDEA: Editor → Code Style "Use tab character", "Show whitespaces",
            // "Reformat code" in Actions on Save).
            {"useTabCharacter", false}, {"showWhitespaces", false}, {"formatOnSave", false},
            // Delete through the platform recycle bin instead of unlinking the file
            // (IDEA's "Safe delete" fallback); `file.delete` honours it per call, this
            // is just the remembered default.
            {"deleteToTrash", true},
            // IDEA AppearanceConfigurable: ideScale is a percent (100 = default),
            // compactMode shrinks control heights/densities ("UI elements take up
            // less screen space"), fullPathsInWindowHeader shows the project path in
            // the window header instead of just its name.
            {"uiZoomPercent", 100}, {"compactMode", false}, {"fullPathsInWindowHeader", false},
            // AppearanceConfigurable "Tree Views": indent guides + smaller indents
            // (UISettings defaults both to off).
            {"showTreeIndentGuides", false}, {"compactTreeIndents", false},
            // "UI Options": UISettingsState defaults smoothScrolling to ON
            // (UISettingsState.kt:220 `by property(true)`) and showIconsInMenus to on;
            // fullPathsInWindowHeader / dndWithAlt / keepPopups default to off.
            {"smoothScrolling", true}, {"showIconsInMenus", true},
            // "Tool Windows": per-window size off, names under icons off, stripes
            // on — UISettings defaults, in the same order as the dialog.
            {"rememberSizeForEachToolWindow", false}, {"showToolWindowNames", false},
            {"showToolWindowBars", true},
            // "Side-by-side layout on the left" and "Widescreen tool window layout".
            {"leftSideBySide", false}, {"wideScreenSupport", false}, {"rightSideBySide", false},
            {"showToolWindowNumbers", false},
            // "Keep popups open for toggle items" + "Drag-and-drop with Alt pressed
            // only" (both off in UISettings).
            {"keepPopupsForToggles", false}, {"dndWithPressedAltOnly", false},
            // PowerSaveMode: off by default, like IDEA.
            {"powerSaveMode", false},
            // AppearanceConfigurable items with a real consumer: contrast scrollbars,
            // colour-vision filter, and the UI font stack (empty family = system).
            {"useContrastScrollbars", false}, {"colorBlindness", "none"},
            {"uiFontFamily", ""}, {"uiFontSize", 13},
            // Background image (Images.SetBackgroundImage) + presentation mode.
            {"backgroundImagePath", ""}, {"backgroundImageOpacity", 100},
            {"backgroundImageFill", "scale"}, {"backgroundImageKeepRatio", true},
            {"presentationMode", false}, {"presentationModeFontSize", 24},
            // Main menu placement + screen-reader support (IDEA defaults).
            {"mainMenuDisplayMode", "merged"}, {"supportScreenReaders", false}};
}

// The markers IDEA ships: TODO, FIXME and the two conventional warning tags.
Json default_todo_markers() {
    constexpr std::pair<const char*, const char*> markers[]{{"TODO", "待办"}, {"FIXME", "需要修"},
                                                           {"XXX", "警告"}, {"HACK", "临时办法"}};
    Json result = Json::array();
    for (const auto& [pattern, description] : markers)
        result.push_back({{"pattern", pattern}, {"description", description}});
    return result;
}

Json project_defaults() {
    return {{"excludedDirs", Json::array({".git", "node_modules", "build", "dist"})},
            {"runConfigs", Json::array()}, {"bookmarks", Json::array()},
            {"todoPatterns", default_todo_markers()},
            {"java", {{"jdkHome", ""}, {"jdkName", "JavaSE-17"}, {"sourcePaths", Json::array()},
                      {"outputPath", ""}, {"referencedLibraries", Json::array({"lib/**/*.jar"})}}},
            // Built-in templates are listed by the UI and only appear in `overrides`
            // once switched off, so the stored default is an empty pair of lists.
            {"templates", {{"overrides", Json::array()}, {"customs", Json::array()}}},
            // IDEA's FileType association table, reduced to what TaoCode can highlight:
            // extension -> language, e.g. {"conf": "typescript"}. Empty by default.
            {"fileAssociations", Json::object()}};
}

Json empty_document() {
    return {{"recentProjects", Json::array()}, {"settings", editor_defaults_impl()},
            {"lastProject", nullptr}, {"perProject", Json::object()}};
}

// Overlay a stored record onto the defaults, filling any key that is absent or null.
// Recurses into objects so a nested `java: null` from an older file still migrates.
void fill_defaults(Json& base, const Json& stored) {
    if (!stored.is_object()) return;
    for (const auto& entry : stored.items()) {
        const auto value = entry.value();
        if (value.is_null()) continue;
        if (value.is_object() && base.contains(entry.key()) && base[entry.key()].is_object())
            fill_defaults(base[entry.key()], value);
        else
            base[entry.key()] = value;
    }
}

void known_keys(const Json& value, std::initializer_list<std::string_view> keys, const char* code) {
    if (!value.is_object()) fail(code, "Settings/state must be a JSON object.");
    for (auto it = value.begin(); it != value.end(); ++it) {
        if (std::find(keys.begin(), keys.end(), std::string_view(it.key())) == keys.end())
            fail(code, "Unknown field: " + it.key());
    }
}

void validate_editor_patch(const Json& patch) {
    // useTabCharacter / showWhitespaces / formatOnSave were added to the editor
    // defaults; a validator that does not know them makes the settings dialog fail
    // on save, so they belong here too.
    // deleteToTrash is read by file.delete; an unknown key here would make every
    // settings.update fail, so it belongs in the allow-list, not just in the defaults.
    known_keys(patch, {"fontSize", "tabSize", "wordWrap", "lineNumbers", "restoreLastProject", "syncOnFocus",
                   "autoSave", "showIndentGuides", "bracketMatching", "tabLimit",
                   "useTabCharacter", "showWhitespaces", "formatOnSave", "deleteToTrash",
                   "uiZoomPercent", "compactMode", "fullPathsInWindowHeader",
                   "showTreeIndentGuides", "compactTreeIndents",
                   "smoothScrolling", "showIconsInMenus",
                   "rememberSizeForEachToolWindow", "showToolWindowNames", "showToolWindowBars",
                   "leftSideBySide", "wideScreenSupport", "rightSideBySide", "showToolWindowNumbers",
                   "keepPopupsForToggles", "dndWithPressedAltOnly", "powerSaveMode",
                   "useContrastScrollbars", "colorBlindness", "uiFontFamily", "uiFontSize",
                   "backgroundImagePath", "backgroundImageOpacity", "backgroundImageFill",
                   "backgroundImageKeepRatio", "presentationMode", "presentationModeFontSize",
                   "mainMenuDisplayMode", "supportScreenReaders"},
               "INVALID_SETTINGS");
    for (auto it = patch.begin(); it != patch.end(); ++it) {
        const auto& value = it.value();
        if (it.key() == "fontSize") {
            if (!value.is_number_integer() || value < 10 || value > 32)
                fail("INVALID_SETTINGS", "fontSize must be an integer from 10 through 32.");
        } else if (it.key() == "tabSize") {
            if (!value.is_number_integer() || (value != 2 && value != 4 && value != 8))
                fail("INVALID_SETTINGS", "tabSize must be 2, 4 or 8.");
        } else if (it.key() == "tabLimit") {
            // IDEA's TabLimitValidator: at least one open tab, sane upper bound.
            if (!value.is_number_integer() || value < 1 || value > 100)
                fail("INVALID_SETTINGS", "tabLimit must be an integer from 1 through 100.");
        } else if (it.key() == "uiFontSize") {
            if (!value.is_number_integer() || value < 9 || value > 24)
                fail("INVALID_SETTINGS", "uiFontSize must be an integer from 9 through 24.");
        } else if (it.key() == "uiFontFamily") {
            if (!value.is_string() || value.get_ref<const std::string&>().size() > 120)
                fail("INVALID_SETTINGS", "uiFontFamily must be a string of at most 120 bytes.");
        } else if (it.key() == "backgroundImageOpacity") {
            if (!value.is_number_integer() || value < 0 || value > 100)
                fail("INVALID_SETTINGS", "backgroundImageOpacity must be an integer from 0 through 100.");
        } else if (it.key() == "presentationModeFontSize") {
            if (!value.is_number_integer() || value < 12 || value > 72)
                fail("INVALID_SETTINGS", "presentationModeFontSize must be an integer from 12 through 72.");
        } else if (it.key() == "backgroundImagePath") {
            if (!value.is_string() || value.get_ref<const std::string&>().size() > 512)
                fail("INVALID_SETTINGS", "backgroundImagePath must be a string of at most 512 bytes.");
        } else if (it.key() == "mainMenuDisplayMode") {
            const auto mode = value.is_string() ? value.get<std::string>() : std::string();
            if (mode != "hamburger" && mode != "merged" && mode != "separate")
                fail("INVALID_SETTINGS", "mainMenuDisplayMode must be hamburger, merged or separate.");
        } else if (it.key() == "backgroundImageFill") {
            const auto fill = value.is_string() ? value.get<std::string>() : std::string();
            if (fill != "scale" && fill != "tile" && fill != "center")
                fail("INVALID_SETTINGS", "backgroundImageFill must be scale, tile or center.");
        } else if (it.key() == "colorBlindness") {
            const auto mode = value.is_string() ? value.get<std::string>() : std::string();
            if (mode != "none" && mode != "deuteranopia" && mode != "protanopia" && mode != "tritanopia")
                fail("INVALID_SETTINGS", "colorBlindness must be none, deuteranopia, protanopia or tritanopia.");
        } else if (it.key() == "uiZoomPercent") {
            // IdeScaleTransformer: the same bounds IDEA's editable combo enforces.
            if (!value.is_number_integer() || value < 50 || value > 400)
                fail("INVALID_SETTINGS", "uiZoomPercent must be an integer from 50 through 400.");
        } else if (!value.is_boolean()) {
            fail("INVALID_SETTINGS", "Editor flags must be JSON booleans.");
        }
    }
}

// IDEA's TODO index is driven by "pattern -> description" entries that travel with the
// project, so a repository can carry its own markers (REVIEW, OPTIMIZE, ...).
void validate_todo_patterns(const Json& values) {
    if (!values.is_array()) fail("INVALID_SETTINGS", "todoPatterns must be an array.");
    if (values.size() > max_todo_patterns)
        fail("INVALID_SETTINGS", "每个项目的 TODO 模式不能超过 " + std::to_string(max_todo_patterns) + " 条。");
    std::set<std::string> patterns;
    for (const auto& value : values) {
        if (!value.is_object()) fail("INVALID_SETTINGS", "TODO 模式要写成 {pattern, description}。");
        known_keys(value, {"pattern", "description"}, "INVALID_SETTINGS");
        const auto pattern = text_or(value, "pattern"), description = text_or(value, "description");
        if (pattern.empty() || pattern.size() > 200) fail("INVALID_SETTINGS", "TODO 模式不能为空且不超过 200 字节。");
        if (description.empty() || description.size() > 60) fail("INVALID_SETTINGS", "TODO 说明不能为空且不超过 60 字节。");
        if (!valid_utf8(pattern) || !valid_utf8(description)) fail("INVALID_SETTINGS", "TODO 模式必须是 UTF-8 文本。");
        if (pattern.find_first_of("\r\n\u0000") != std::string::npos) fail("INVALID_SETTINGS", "TODO 模式不能换行。");
        if (!patterns.insert(pattern).second) fail("INVALID_SETTINGS", "TODO 模式不能重复：" + pattern);
    }
}

// IDEA's live-template page: built-in templates can be switched off by a stable pattern,
// and the project can carry its own {key, body, description, languages} entries.
void validate_template_settings(const Json& value) {
    if (!value.is_object()) fail("INVALID_SETTINGS", "templates 要是 {overrides, customs} 对象。");
    known_keys(value, {"overrides", "customs"}, "INVALID_SETTINGS");
    static constexpr const char* languages[] = {"java", "cpp", "typescript", "other"};
    if (value.contains("overrides")) {
        const auto& overrides = value.at("overrides");
        if (!overrides.is_array()) fail("INVALID_SETTINGS", "templates.overrides must be an array.");
        if (overrides.size() > 400) fail("INVALID_SETTINGS", "模板开关不能超过 400 条。");
        std::set<std::string> patterns;
        for (const auto& entry : overrides) {
            if (!entry.is_object()) fail("INVALID_SETTINGS", "模板开关要写成 {pattern, disabled}。");
            known_keys(entry, {"pattern", "disabled"}, "INVALID_SETTINGS");
            const auto pattern = text_or(entry, "pattern");
            if (pattern.empty() || pattern.size() > 300 || !valid_utf8(pattern))
                fail("INVALID_SETTINGS", "模板标识不能为空、不能超 300 字节且必须是 UTF-8。");
            if (!entry.contains("disabled") || !entry.at("disabled").is_boolean())
                fail("INVALID_SETTINGS", "模板开关的 disabled 必须是布尔值。");
            if (!patterns.insert(pattern).second) fail("INVALID_SETTINGS", "模板标识不能重复：" + pattern);
        }
    }
    if (!value.contains("customs")) return;
    const auto& customs = value.at("customs");
    if (!customs.is_array()) fail("INVALID_SETTINGS", "templates.customs must be an array.");
    if (customs.size() > 100) fail("INVALID_SETTINGS", "每个项目的自定义模板不能超过 100 个。");
    std::set<std::string> keys;
    static const std::regex key_pattern("[A-Za-z][A-Za-z0-9]*");
    for (const auto& entry : customs) {
        if (!entry.is_object()) fail("INVALID_SETTINGS", "自定义模板要写成 {key, body, description, languages}。");
        known_keys(entry, {"key", "body", "description", "languages"}, "INVALID_SETTINGS");
        const auto key = text_or(entry, "key");
        if (key.empty() || !std::regex_match(key, key_pattern))
            fail("INVALID_SETTINGS", "模板缩写要用字母开头的英文或数字。");
        const auto body = text_or(entry, "body"), description = text_or(entry, "description");
        if (body.empty() || body.size() > 8000) fail("INVALID_SETTINGS", "模板内容不能为空且不超过 8000 字节。");
        if (description.empty() || description.size() > 120) fail("INVALID_SETTINGS", "模板说明不能为空且不超过 120 字节。");
        if (!valid_utf8(key) || !valid_utf8(body) || !valid_utf8(description))
            fail("INVALID_SETTINGS", "自定义模板必须是 UTF-8 文本。");
        if (!entry.contains("languages") || !entry.at("languages").is_array())
            fail("INVALID_SETTINGS", "自定义模板必须带 languages 数组（空数组表示所有语言）。");
        for (const auto& language : entry.at("languages")) {
            if (!language.is_string()) fail("INVALID_SETTINGS", "自定义模板的 languages 只能是字符串。");
            const auto name = language.get<std::string>();
            if (!std::any_of(std::begin(languages), std::end(languages), [&name](const char* option) { return name == option; }))
                fail("INVALID_SETTINGS", "不支持的模板语言：" + name);
        }
        if (!keys.insert(key).second) fail("INVALID_SETTINGS", "模板缩写不能重复：" + key);
    }
}

// IDEA stores the bookmark list — including its 0-9 mnemonics — with the project.
void validate_bookmarks(const Json& values) {
    if (!values.is_array()) fail("INVALID_SETTINGS", "bookmarks must be an array.");
    if (values.size() > max_bookmarks)
        fail("INVALID_SETTINGS", "每个项目的书签不能超过 " + std::to_string(max_bookmarks) + " 个。");
    std::set<std::string> places;
    std::set<int> digits;
    for (const auto& value : values) {
        if (!value.is_object()) fail("INVALID_SETTINGS", "书签要写成 {path, line, mnemonic?}。");
        known_keys(value, {"path", "line", "mnemonic"}, "INVALID_SETTINGS");
        const auto path = text_or(value, "path");
        if (path.empty() || path.size() > 512) fail("INVALID_SETTINGS", "书签路径不能为空且不超过 512 字节。");
        if (!valid_utf8(path) || path.find('\\') != std::string::npos || path.front() == '/')
            fail("INVALID_SETTINGS", "书签路径必须是工作区内的正斜杠相对路径。");
        if (path == ".." || path.starts_with("../") || path.find("/../") != std::string::npos ||
            path.ends_with("/.."))
            fail("INVALID_SETTINGS", "书签路径不能跳出工作区。");
        if (!value.contains("line") || !value.at("line").is_number_integer() ||
            value.at("line") < 1 || value.at("line") > max_bookmark_line)
            fail("INVALID_SETTINGS", "书签行号必须是 1 到 1000000 的整数。");
        if (!places.insert(path + ':' + std::to_string(value.at("line").get<std::int64_t>())).second)
            fail("INVALID_SETTINGS", "同一行只能有一个书签：" + path);
        if (!value.contains("mnemonic")) continue;
        if (!value.at("mnemonic").is_number_integer() || value.at("mnemonic") < 0 || value.at("mnemonic") > 9)
            fail("INVALID_SETTINGS", "书签编号只能是 0 到 9 的整数。");
        if (!digits.insert(value.at("mnemonic").get<int>()).second)
            fail("INVALID_SETTINGS", "同一个编号只能贴在一个书签上。");
    }
}

void validate_java_settings(const Json& value) {
    known_keys(value, {"jdkHome", "jdkName", "sourcePaths", "outputPath", "referencedLibraries"}, "INVALID_SETTINGS");
        if (value.contains("jdkHome")) {
            const auto home = text_or(value, "jdkHome");
            // UNC and drive roots are valid JDK homes; a bare relative path is not.
            if (home.size() > 1024 || !valid_utf8(home) || home.find_first_of("\r\n") != std::string::npos ||
                (!home.empty() && !from_utf8(home).is_absolute())) fail("INVALID_SETTINGS", "JDK home must be an absolute path or empty.");
        }
    if (value.contains("jdkName")) {
        static const std::regex runtime("JavaSE-(1\\.8|9|[1-9][0-9])");
        if (!std::regex_match(text_or(value, "jdkName"), runtime)) fail("INVALID_SETTINGS", "Use a Java execution environment such as JavaSE-17.");
    }
    const auto relative = [](const Json& item, bool glob) {
        if (!item.is_string()) fail("INVALID_SETTINGS", "Java project paths must be strings.");
        const auto path = item.get<std::string>();
        if (path.empty() || path.size() > 512 || !valid_utf8(path) || path.front() == '/' ||
            path.find_first_of("\\\\:<>|\"") != std::string::npos ||
            std::any_of(path.begin(), path.end(), [](unsigned char c) { return c < 32; }) ||
            (!glob && path.find_first_of("*?") != std::string::npos)) fail("INVALID_SETTINGS", "Use a workspace-relative Java path with forward slashes.");
        std::size_t start = 0;
        while (start <= path.size()) {
            const auto end = path.find('/', start);
            const auto part = path.substr(start, end == std::string::npos ? end : end - start);
            // A glob segment such as `**` is not a traversal; only literal `..` is.
            if (part.empty() || part == "..") fail("INVALID_SETTINGS", "Java project paths cannot leave the workspace.");
            if (end == std::string::npos) break;
            start = end + 1;
        }
    };
    for (const char* key : {"sourcePaths", "referencedLibraries"}) if (value.contains(key)) {
        const auto& list = value.at(key);
        if (!list.is_array() || list.size() > 64) fail("INVALID_SETTINGS", "At most 64 Java paths are supported per list.");
        std::set<std::string> seen;
        for (const auto& item : list) {
            relative(item, std::string_view(key) == "referencedLibraries");
            if (!seen.insert(item.get<std::string>()).second) fail("INVALID_SETTINGS", "Java project paths must not repeat.");
        }
    }
    if (value.contains("outputPath")) {
        const auto output = text_or(value, "outputPath");
        if (!output.empty()) relative(value.at("outputPath"), false);
    }
}

// IDEA's file-type association: an extension ("conf") mapped to one of the languages
// TaoCode can highlight. Keys are lowercase bare extensions; values match templates.ts.
void validate_file_associations(const Json& value) {
    if (!value.is_object()) fail("INVALID_SETTINGS", "fileAssociations must be an object.");
    constexpr std::string_view languages[] {"java", "cpp", "typescript", "other"};
    for (auto it = value.begin(); it != value.end(); ++it) {
        const auto& key = it.key();
        if (key.empty() || key.size() > 16 || !std::all_of(key.begin(), key.end(),
                [](char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); }))
            fail("INVALID_SETTINGS", "扩展名键必须是小写字母数字（不含点），最长 16 字符。");
        if (!it.value().is_string()) fail("INVALID_SETTINGS", "文件类型值必须是字符串。");
        const auto& language = it.value().get_ref<const std::string&>();
        if (std::find(std::begin(languages), std::end(languages), language) == std::end(languages))
            fail("INVALID_SETTINGS", "文件类型只能是 java、cpp、typescript 或 other。");
    }
}

void validate_project_patch(const Json& patch) {
    known_keys(patch, {"excludedDirs", "runConfigs", "bookmarks", "todoPatterns", "templates", "java",
                       "fileAssociations"},
               "INVALID_SETTINGS");
    if (patch.contains("fileAssociations")) validate_file_associations(patch.at("fileAssociations"));
    if (patch.contains("java")) validate_java_settings(patch.at("java"));
    if (patch.contains("excludedDirs")) {
        if (!patch.at("excludedDirs").is_array()) fail("INVALID_SETTINGS", "excludedDirs must be an array.");
        for (const auto& value : patch.at("excludedDirs")) {
            if (!value.is_string() || !valid_utf8(value.get_ref<const std::string&>()))
                fail("INVALID_SETTINGS", "excludedDirs must contain ordinary UTF-8 directory names.");
            validate_component(from_utf8(value.get_ref<const std::string&>()).native(), "INVALID_SETTINGS");
        }
    }
    // Run configurations live with the project, the way IDEA keeps them in
    // .idea/runConfigurations, so opening a project on another machine does not
    // inherit an unrelated command list.
    if (patch.contains("runConfigs")) {
        const auto& values = patch.at("runConfigs");
        if (!values.is_array()) fail("INVALID_SETTINGS", "runConfigs must be an array.");
        if (values.size() > max_run_configs)
            fail("INVALID_SETTINGS", "每个项目的运行配置不能超过 " + std::to_string(max_run_configs) + " 个。");
        std::set<std::string> names;
        for (const auto& value : values) {
            // A run configuration carries the whole shape (program, arguments, working
            // directory, environment, before-launch steps); dropping any of it on save
            // is what made the dialog feel decorative.
            if (!value.is_object()) fail("INVALID_SETTINGS", "runConfigs 的每一项都要是 {name, command[, type]}。");
            known_keys(value, {"name", "command", "type", "program", "args", "cwd", "env", "beforeLaunch", "adapter"},
                       "INVALID_SETTINGS");
            if (value.contains("type") && !value.at("type").is_string()) fail("INVALID_SETTINGS", "运行配置类型必须是字符串。");
            if (value.contains("adapter")) {
                if (!value.at("adapter").is_string() || value.at("adapter").get_ref<const std::string&>().size() > 64)
                    fail("INVALID_SETTINGS", "运行配置的调试适配器名要是不超过 64 字节的字符串。");
            }
            if (value.contains("type")) {
                const auto type = value.at("type").get<std::string>();
                if (type != "shell" && type != "application" && type != "debug")
                    fail("INVALID_SETTINGS", "运行配置类型只能是 shell、application 或 debug。");
            }
            const auto name = text_or(value, "name"), command = text_or(value, "command");
            if (name.empty() || name.size() > 80) fail("INVALID_SETTINGS", "运行配置名不能为空且不超过 80 字节。");
            if (command.empty() || command.size() > 4096) fail("INVALID_SETTINGS", "运行命令不能为空且不超过 4096 字节。");
            if (!valid_utf8(name) || !valid_utf8(command)) fail("INVALID_SETTINGS", "运行配置必须是 UTF-8 文本。");
            const auto optional_text = [&](const char* key, std::size_t limit) {
                if (!value.contains(key)) return std::string();
                if (!value.at(key).is_string()) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 必须是字符串。");
                const auto text = value.at(key).get<std::string>();
                if (text.size() > limit) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 过长。");
                if (!valid_utf8(text)) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 必须是 UTF-8 文本。");
                return text;
            };
            optional_text("program", 1024);
            optional_text("cwd", 1024);
            const auto string_list = [&](const char* key, std::size_t limit, std::size_t item_limit) {
                if (!value.contains(key)) return;
                if (!value.at(key).is_array()) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 必须是数组。");
                if (value.at(key).size() > limit) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 条目过多。");
                for (const auto& item : value.at(key)) {
                    if (!item.is_string()) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 只能是字符串。");
                    const auto text = item.get<std::string>();
                    if (text.size() > item_limit) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 条目过长。");
                    if (!valid_utf8(text)) fail("INVALID_SETTINGS", std::string("运行配置的 ") + key + " 必须是 UTF-8 文本。");
                }
            };
            string_list("args", 256, 1024);
            string_list("env", 256, 1024);
            if (value.contains("beforeLaunch")) {
                if (!value.at("beforeLaunch").is_array()) fail("INVALID_SETTINGS", "运行配置的 beforeLaunch 必须是数组。");
                if (value.at("beforeLaunch").size() > 16) fail("INVALID_SETTINGS", "运行前步骤最多 16 个。");
                for (const auto& step : value.at("beforeLaunch")) {
                    if (!step.is_object()) fail("INVALID_SETTINGS", "运行前步骤要写成 {name, command}。");
                    known_keys(step, {"name", "command"}, "INVALID_SETTINGS");
                    const auto step_name = text_or(step, "name"), step_command = text_or(step, "command");
                    if (step_name.empty() || step_name.size() > 80) fail("INVALID_SETTINGS", "运行前步骤名不能为空且不超过 80 字节。");
                    if (step_command.empty() || step_command.size() > 4096) fail("INVALID_SETTINGS", "运行前步骤命令不能为空。");
                    if (!valid_utf8(step_name) || !valid_utf8(step_command)) fail("INVALID_SETTINGS", "运行前步骤必须是 UTF-8 文本。");
                }
            }
            if (!names.insert(name).second) fail("INVALID_SETTINGS", "运行配置名不能重复：" + name);
        }
    }
    if (patch.contains("bookmarks")) validate_bookmarks(patch.at("bookmarks"));
    if (patch.contains("todoPatterns")) validate_todo_patterns(patch.at("todoPatterns"));
    if (patch.contains("templates")) validate_template_settings(patch.at("templates"));
}

bool same_path(const std::string& a, const std::string& b) {
    return equal_name(from_utf8(a).native(), from_utf8(b).native());
}

std::string stored_path(const Json& value) {
    if (!value.is_string()) fail("STATE_CORRUPT", "A stored project path is not a string.");
    return utf8_path(absolute_path(from_utf8(value.get_ref<const std::string&>()), true));
}

bool valid_timestamp(const std::string& value) {
    if (value.size() != 20 || value[4] != '-' || value[7] != '-' || value[10] != 'T' ||
        value[13] != ':' || value[16] != ':' || value[19] != 'Z') return false;
    for (std::size_t i = 0; i != value.size(); ++i) {
        if (i == 4 || i == 7 || i == 10 || i == 13 || i == 16 || i == 19) continue;
        if (value[i] < '0' || value[i] > '9') return false;
    }
    const auto number = [&](std::size_t start, std::size_t length) {
        unsigned result = 0;
        for (std::size_t i = start; i < start + length; ++i) result = result * 10 + value[i] - '0';
        return result;
    };
    const auto year = number(0, 4), month = number(5, 2), day = number(8, 2);
    constexpr unsigned days[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (year < 1601 || month < 1 || month > 12 || day < 1 || number(11, 2) > 23 ||
        number(14, 2) > 59 || number(17, 2) > 59) return false;
    const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    return day <= days[month - 1] + (month == 2 && leap ? 1u : 0u);
}

std::string utc_now() {
    SYSTEMTIME now{};
    GetSystemTime(&now);
    std::array<char, 32> buffer{};
    std::snprintf(buffer.data(), buffer.size(), "%04u-%02u-%02uT%02u:%02u:%02uZ",
                  static_cast<unsigned>(now.wYear), static_cast<unsigned>(now.wMonth),
                  static_cast<unsigned>(now.wDay), static_cast<unsigned>(now.wHour),
                  static_cast<unsigned>(now.wMinute), static_cast<unsigned>(now.wSecond));
    return buffer.data();
}

Json validate_document(Json value) {
    try {
        known_keys(value, {"recentProjects", "settings", "lastProject", "perProject"}, "STATE_CORRUPT");
        if (!value.contains("recentProjects") || !value.at("recentProjects").is_array() ||
            value.at("recentProjects").size() > recent_limit || !value.contains("settings") ||
            !value.contains("lastProject"))
            fail("STATE_CORRUPT", "The saved project state has an invalid schema.");
        validate_editor_patch(value.at("settings"));
        // A file written before a setting existed is not corrupt: the missing keys
        // take their defaults. Unknown keys and wrong types are still refused above.
        // The defaults are hoisted because iterating the items() view of a temporary
        // would leave the iterators dangling.
        const Json fallbacks = editor_defaults_impl();
        for (const auto& entry : fallbacks.items())
            if (!value["settings"].contains(entry.key())) value["settings"][entry.key()] = entry.value();
        std::vector<std::string> paths;
        for (auto& recent : value.at("recentProjects")) {
            known_keys(recent, {"name", "path", "lastOpened", "available"}, "STATE_CORRUPT");
            if (!recent.contains("name") || !recent.at("name").is_string() ||
                recent.at("name").get_ref<const std::string&>().empty() ||
                !valid_utf8(recent.at("name").get_ref<const std::string&>()) ||
                !recent.contains("path") || !recent.contains("lastOpened") ||
                !recent.at("lastOpened").is_string() ||
                !valid_timestamp(recent.at("lastOpened").get_ref<const std::string&>()) ||
                (recent.contains("available") && !recent.at("available").is_boolean()))
                fail("STATE_CORRUPT", "A saved recent project is invalid.");
            const auto path = stored_path(recent.at("path"));
            for (const auto& existing : paths) {
                if (same_path(existing, path)) fail("STATE_CORRUPT", "Duplicate saved project paths.");
            }
            paths.push_back(path);
            recent["path"] = path;
            recent.erase("available"); // Availability is never trusted from disk.
        }
        if (!value.at("lastProject").is_null()) value["lastProject"] = stored_path(value.at("lastProject"));
        if (!value.contains("perProject")) value["perProject"] = Json::object();
        if (!value.at("perProject").is_object()) fail("STATE_CORRUPT", "perProject must be a map.");
        Json projects = Json::object();
        std::set<std::wstring, decltype([](const std::wstring& a, const std::wstring& b) {
            return CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(),
                                        static_cast<int>(b.size()), TRUE) == CSTR_LESS_THAN;
        })> keys;
        for (auto it = value.at("perProject").begin(); it != value.at("perProject").end(); ++it) {
            const auto path = stored_path(Json(it.key()));
            if (!keys.insert(from_utf8(path).native()).second)
                fail("STATE_CORRUPT", "Duplicate per-project settings paths.");
            // A key an older file left as null (e.g. before the setting existed) is
            // dropped here so project_settings() fills it from the defaults.
            for (auto field = it.value().begin(); field != it.value().end();)
                field = field.value().is_null() ? it.value().erase(field) : std::next(field);
            validate_project_patch(it.value());
            if (!it.value().contains("excludedDirs")) fail("STATE_CORRUPT", "Incomplete per-project settings.");
            projects[path] = it.value();
        }
        value["perProject"] = std::move(projects);
        return value;
    } catch (const WorkspaceError& error) {
        if (error.code == "STATE_CORRUPT") throw;
        fail("STATE_CORRUPT", "The saved configuration is invalid; the original file was kept.");
    } catch (const Json::exception&) {
        fail("STATE_CORRUPT", "The saved configuration is invalid; the original file was kept.");
    }
}

std::string read_state_bytes(HANDLE handle) {
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(handle, &size)) win_error("Cannot inspect configuration size");
    if (size.QuadPart < 0 || size.QuadPart > static_cast<LONGLONG>(state_limit))
        fail("STATE_CORRUPT", "The configuration exceeds the 1 MiB limit; the original file was kept.");
    std::string result;
    result.reserve(static_cast<std::size_t>(size.QuadPart));
    std::array<char, 65536> buffer{};
    for (;;) {
        DWORD count = 0;
        if (!ReadFile(handle, buffer.data(), static_cast<DWORD>(buffer.size()), &count, nullptr))
            win_error("Cannot read application configuration");
        if (!count) break;
        if (count > state_limit - result.size()) fail("STATE_CORRUPT", "The configuration exceeds 1 MiB.");
        result.append(buffer.data(), count);
    }
    return result;
}

struct LoadedState {
    PinnedDirectory parent;
    Handle original;
    Json document = empty_document();
};

LoadedState load_state(const fs::path& file) {
    LoadedState loaded;
    loaded.parent = pin_directory(file.parent_path(), Missing::allow);
    if (!loaded.parent.exists) return loaded;
    loaded.original = Handle(CreateFileW(api_path(loaded.parent.path / file.filename()).c_str(),
                                        GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr,
                                        OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT |
                                        FILE_FLAG_BACKUP_SEMANTICS, nullptr));
    if (!loaded.original) {
        const auto error = GetLastError();
        if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) return loaded;
        win_error("Cannot open application configuration", error);
    }
    const auto info = file_info(loaded.original.get());
    reject_reparse(info);
    if ((info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || GetFileType(loaded.original.get()) != FILE_TYPE_DISK)
        fail("STATE_CORRUPT", "The configuration is not a regular file; it was not changed.");
    const auto bytes = read_state_bytes(loaded.original.get());
    try {
        // Reject ambiguous duplicate JSON keys and bound parser nesting as well as bytes.
        std::vector<std::set<std::string>> objects;
        const auto callback = [&](int depth, Json::parse_event_t event, Json& parsed) {
            if (depth > 32) fail("STATE_CORRUPT", "Configuration JSON is nested too deeply.");
            if (event == Json::parse_event_t::object_start) objects.emplace_back();
            else if (event == Json::parse_event_t::key) {
                if (objects.empty() || !objects.back().insert(parsed.get<std::string>()).second)
                    fail("STATE_CORRUPT", "Configuration JSON contains a duplicate key.");
            } else if (event == Json::parse_event_t::object_end) objects.pop_back();
            return true;
        };
        loaded.document = validate_document(Json::parse(bytes, callback));
    } catch (const Json::exception&) {
        fail("STATE_CORRUPT", "Cannot parse saved configuration; the original file was kept.");
    }
    return loaded;
}

void save_state(const fs::path& file, LoadedState& loaded, const Json& next) {
    const auto bytes = next.dump(2) + '\n';
    if (bytes.size() > state_limit) fail("STATE_TOO_LARGE", "The configuration would exceed 1 MiB.");
    if (!loaded.parent.exists) loaded.parent = pin_directory(file.parent_path(), Missing::create);
    auto temporary = temporary_object(loaded.parent.path, false);
    write_and_flush(temporary.handle.get(), bytes);
    const bool had_original = static_cast<bool>(loaded.original);
    loaded.original.reset();  // Release our read handle; Windows blocks replace-over-own-handle.
    const auto target = loaded.parent.path / file.filename();
    if (had_original) {
        // A handle-based replace reports both "target held without delete-sharing"
        // and ACL faults as error 5. Take a brief DELETE reservation first so a busy
        // file surfaces as FILE_BUSY instead of collapsing into ACCESS_DENIED.
        Handle reservation(CreateFileW(api_path(target).c_str(), DELETE,
                                       FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                       nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
        if (!reservation) {
            const auto error = GetLastError();
            if (error == ERROR_SHARING_VIOLATION)
                fail("FILE_BUSY", "The configuration is in use by another program; it was not changed.");
            win_error("Cannot replace application configuration", error);
        }
    }
    // A first save must not replace an object which appeared after the initial read.
    rename_handle(temporary.handle.get(), target, had_original);
    temporary.cleanup = false;
    // Nothing that can fail or allocate is done after the atomic replacement.
}

Json public_state(const Json& document) {
    Json result = {{"recentProjects", document.at("recentProjects")},
                   {"settings", document.at("settings")}, {"lastProject", document.at("lastProject")}};
    for (auto& recent : result.at("recentProjects")) {
        std::error_code error;
        auto path = from_utf8(recent.at("path").get<std::string>());
        path.make_preferred();  // Stored paths use portable '/'; the \\?\ API needs '\'.
        recent["available"] = fs::is_directory(fs::path(api_path(path)), error);
    }
    return result;
}

std::string project_key(const std::string& root) {
    return utf8_path(pin_directory(absolute_path(from_utf8(root), true), Missing::allow).path);
}

std::string existing_project_key(const Json& projects, const std::string& root) {
    for (auto it = projects.begin(); it != projects.end(); ++it) {
        if (same_path(it.key(), root)) return it.key();
    }
    return root;
}

} // namespace

// Public mirror of the internal defaults (projects.hpp): tests and any future caller
// assert against the real defaults instead of a hand-copied snapshot that drifts.
Json editor_defaults() { return editor_defaults_impl(); }

Json java_lsp_settings(const Json& java) {
    Json runtimes = Json::array();
    if (!java.at("jdkHome").get_ref<const std::string&>().empty())
        runtimes.push_back({{"name", java.at("jdkName")}, {"path", java.at("jdkHome")}, {"default", true}});
    return {{"java", {{"configuration", {{"runtimes", std::move(runtimes)}}},
                      {"project", {{"sourcePaths", java.at("sourcePaths")}, {"outputPath", java.at("outputPath")},
                                   {"referencedLibraries", java.at("referencedLibraries")}}}}}};
}

fs::path project_destination(const fs::path& parent, const std::string& name) {
    return boundary([&] {
        const auto component = from_utf8(name);
        validate_component(component.native());
        const auto pinned = pin_directory(parent);
        auto result = pinned.path / component;
        require_absent(result);
        return result;
    });
}

fs::path create_project(const fs::path& parent, const std::string& name, const std::string& kind) {
    return boundary([&] {
        if (kind != "empty" && kind != "cpp" && kind != "java" && kind != "spring-boot" &&
            kind != "maven" && kind != "gradle" && kind != "kotlin" && kind != "python" &&
            kind != "node" && kind != "vue" && kind != "react")
            fail("INVALID_TEMPLATE", "The selected project template is not supported.");
        const auto component = from_utf8(name);
        validate_component(component.native());
        auto pinned = pin_directory(parent);
        auto destination = pinned.path / component;
        require_absent(destination);
        auto temporary = temporary_object(pinned.path, true);
        // Children are destroyed before their owned directory on every failure path.
        std::vector<OwnedObject> children;
        std::vector<OwnedObject> directories;
        children.reserve(8);
        directories.reserve(4);
        if (kind == "cpp") {
            constexpr std::string_view cmake =
                "cmake_minimum_required(VERSION 3.20)\n"
                "project(TaoProject LANGUAGES CXX)\n\n"
                "add_executable(app main.cpp)\n"
                "target_compile_features(app PRIVATE cxx_std_20)\n";
            constexpr std::string_view main_cpp =
                "#include <iostream>\n\n"
                "int main() {\n"
                "    std::cout << \"Hello, TaoCode!\\n\";\n"
                "    return 0;\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"CMakeLists.txt"));
            write_and_flush(children.back().handle.get(), cmake);
            children.push_back(new_file(temporary.path / L"main.cpp"));
            write_and_flush(children.back().handle.get(), main_cpp);
        } else if (kind == "java") {
            directories.push_back(new_directory(temporary.path / L"src"));
            constexpr std::string_view main_java =
                "public class Main {\n"
                "    public static void main(String[] args) {\n"
                "        System.out.println(\"Hello, TaoCode!\");\n"
                "    }\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"src" / L"Main.java"));
            write_and_flush(children.back().handle.get(), main_java);
        } else if (kind == "spring-boot") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"java"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"resources"));
            constexpr std::string_view pom_xml =
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"\n"
                "         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n"
                "         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 "
                "http://maven.apache.org/xsd/maven-4.0.0.xsd\">\n"
                "    <modelVersion>4.0.0</modelVersion>\n"
                "    <parent>\n"
                "        <groupId>org.springframework.boot</groupId>\n"
                "        <artifactId>spring-boot-starter-parent</artifactId>\n"
                "        <version>3.2.0</version>\n"
                "    </parent>\n"
                "    <groupId>com.example</groupId>\n"
                "    <artifactId>demo</artifactId>\n"
                "    <version>0.0.1-SNAPSHOT</version>\n"
                "    <dependencies>\n"
                "        <dependency>\n"
                "            <groupId>org.springframework.boot</groupId>\n"
                "            <artifactId>spring-boot-starter-web</artifactId>\n"
                "        </dependency>\n"
                "    </dependencies>\n"
                "</project>\n";
            constexpr std::string_view application_java =
                "package com.example.demo;\n\n"
                "import org.springframework.boot.SpringApplication;\n"
                "import org.springframework.boot.autoconfigure.SpringBootApplication;\n\n"
                "@SpringBootApplication\n"
                "public class DemoApplication {\n"
                "    public static void main(String[] args) {\n"
                "        SpringApplication.run(DemoApplication.class, args);\n"
                "    }\n"
                "}\n";
            constexpr std::string_view application_properties =
                "server.port=8080\n";
            children.push_back(new_file(temporary.path / L"pom.xml"));
            write_and_flush(children.back().handle.get(), pom_xml);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"java" / L"DemoApplication.java"));
            write_and_flush(children.back().handle.get(), application_java);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"resources" / L"application.properties"));
            write_and_flush(children.back().handle.get(), application_properties);
        } else if (kind == "maven") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"java"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test" / L"java"));
            constexpr std::string_view pom_xml =
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"\n"
                "         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n"
                "         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 "
                "http://maven.apache.org/xsd/maven-4.0.0.xsd\">\n"
                "    <modelVersion>4.0.0</modelVersion>\n"
                "    <groupId>com.example</groupId>\n"
                "    <artifactId>demo</artifactId>\n"
                "    <version>1.0-SNAPSHOT</version>\n"
                "    <properties>\n"
                "        <maven.compiler.source>17</maven.compiler.source>\n"
                "        <maven.compiler.target>17</maven.compiler.target>\n"
                "    </properties>\n"
                "</project>\n";
            constexpr std::string_view main_java =
                "package com.example;\n\n"
                "public class Main {\n"
                "    public static void main(String[] args) {\n"
                "        System.out.println(\"Hello, TaoCode!\");\n"
                "    }\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"pom.xml"));
            write_and_flush(children.back().handle.get(), pom_xml);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"java" / L"Main.java"));
            write_and_flush(children.back().handle.get(), main_java);
        } else if (kind == "gradle") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"java"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test"));
            directories.push_back(new_directory(temporary.path / L"src" / L"test" / L"java"));
            constexpr std::string_view build_gradle =
                "plugins {\n"
                "    id 'java'\n"
                "}\n\n"
                "group = 'com.example'\n"
                "version = '1.0-SNAPSHOT'\n\n"
                "java {\n"
                "    sourceCompatibility = JavaVersion.VERSION_17\n"
                "    targetCompatibility = JavaVersion.VERSION_17\n"
                "}\n\n"
                "repositories {\n"
                "    mavenCentral()\n"
                "}\n\n"
                "dependencies {\n"
                "}\n";
            constexpr std::string_view main_java =
                "package com.example;\n\n"
                "public class Main {\n"
                "    public static void main(String[] args) {\n"
                "        System.out.println(\"Hello, TaoCode!\");\n"
                "    }\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"build.gradle"));
            write_and_flush(children.back().handle.get(), build_gradle);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"java" / L"Main.java"));
            write_and_flush(children.back().handle.get(), main_java);
        } else if (kind == "kotlin") {
            directories.push_back(new_directory(temporary.path / L"src"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main"));
            directories.push_back(new_directory(temporary.path / L"src" / L"main" / L"kotlin"));
            constexpr std::string_view build_gradle_kts =
                "plugins {\n"
                "    kotlin(\"jvm\") version \"1.9.20\"\n"
                "}\n\n"
                "group = \"com.example\"\n"
                "version = \"1.0-SNAPSHOT\"\n\n"
                "repositories {\n"
                "    mavenCentral()\n"
                "}\n\n"
                "dependencies {\n"
                "    implementation(kotlin(\"stdlib\"))\n"
                "}\n";
            constexpr std::string_view main_kt =
                "package com.example\n\n"
                "fun main() {\n"
                "    println(\"Hello, TaoCode!\")\n"
                "}\n";
            children.push_back(new_file(temporary.path / L"build.gradle.kts"));
            write_and_flush(children.back().handle.get(), build_gradle_kts);
            children.push_back(new_file(temporary.path / L"src" / L"main" / L"kotlin" / L"Main.kt"));
            write_and_flush(children.back().handle.get(), main_kt);
        } else if (kind == "python") {
            constexpr std::string_view main_py =
                "def main():\n"
                "    print(\"Hello, TaoCode!\")\n\n"
                "if __name__ == \"__main__\":\n"
                "    main()\n";
            constexpr std::string_view requirements_txt =
                "# Add your dependencies here\n"
                "# Example:\n"
                "# requests==2.31.0\n";
            children.push_back(new_file(temporary.path / L"main.py"));
            write_and_flush(children.back().handle.get(), main_py);
            children.push_back(new_file(temporary.path / L"requirements.txt"));
            write_and_flush(children.back().handle.get(), requirements_txt);
        } else if (kind == "node") {
            constexpr std::string_view package_json =
                "{\n"
                "  \"name\": \"demo\",\n"
                "  \"version\": \"1.0.0\",\n"
                "  \"description\": \"\",\n"
                "  \"main\": \"index.js\",\n"
                "  \"scripts\": {\n"
                "    \"start\": \"node index.js\"\n"
                "  },\n"
                "  \"keywords\": [],\n"
                "  \"author\": \"\",\n"
                "  \"license\": \"ISC\"\n"
                "}\n";
            constexpr std::string_view index_js =
                "console.log(\"Hello, TaoCode!\");\n";
            children.push_back(new_file(temporary.path / L"package.json"));
            write_and_flush(children.back().handle.get(), package_json);
            children.push_back(new_file(temporary.path / L"index.js"));
            write_and_flush(children.back().handle.get(), index_js);
        } else if (kind == "vue") {
            directories.push_back(new_directory(temporary.path / L"src"));
            constexpr std::string_view package_json =
                "{\n"
                "  \"name\": \"demo\",\n"
                "  \"version\": \"0.0.0\",\n"
                "  \"type\": \"module\",\n"
                "  \"scripts\": {\n"
                "    \"dev\": \"vite\",\n"
                "    \"build\": \"vite build\",\n"
                "    \"preview\": \"vite preview\"\n"
                "  },\n"
                "  \"dependencies\": {\n"
                "    \"vue\": \"^3.4.0\"\n"
                "  },\n"
                "  \"devDependencies\": {\n"
                "    \"@vitejs/plugin-vue\": \"^5.0.0\",\n"
                "    \"vite\": \"^5.0.0\"\n"
                "  }\n"
                "}\n";
            constexpr std::string_view vite_config_js =
                "import { defineConfig } from 'vite'\n"
                "import vue from '@vitejs/plugin-vue'\n\n"
                "export default defineConfig({\n"
                "  plugins: [vue()],\n"
                "})\n";
            constexpr std::string_view index_html =
                "<!DOCTYPE html>\n"
                "<html lang=\"zh-CN\">\n"
                "<head>\n"
                "    <meta charset=\"UTF-8\">\n"
                "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
                "    <title>Demo App</title>\n"
                "</head>\n"
                "<body>\n"
                "    <div id=\"app\"></div>\n"
                "    <script type=\"module\" src=\"/src/main.js\"></script>\n"
                "</body>\n"
                "</html>\n";
            constexpr std::string_view main_js =
                "import { createApp } from 'vue'\n"
                "import App from './App.vue'\n\n"
                "createApp(App).mount('#app')\n";
            constexpr std::string_view app_vue =
                "<template>\n"
                "  <div>\n"
                "    <h1>Hello, TaoCode!</h1>\n"
                "  </div>\n"
                "</template>\n\n"
                "<script setup>\n"
                "</script>\n\n"
                "<style>\n"
                "#app {\n"
                "  font-family: Avenir, Helvetica, Arial, sans-serif;\n"
                "  text-align: center;\n"
                "  color: #2c3e50;\n"
                "  margin-top: 60px;\n"
                "}\n"
                "</style>\n";
            children.push_back(new_file(temporary.path / L"package.json"));
            write_and_flush(children.back().handle.get(), package_json);
            children.push_back(new_file(temporary.path / L"vite.config.js"));
            write_and_flush(children.back().handle.get(), vite_config_js);
            children.push_back(new_file(temporary.path / L"index.html"));
            write_and_flush(children.back().handle.get(), index_html);
            children.push_back(new_file(temporary.path / L"src" / L"main.js"));
            write_and_flush(children.back().handle.get(), main_js);
            children.push_back(new_file(temporary.path / L"src" / L"App.vue"));
            write_and_flush(children.back().handle.get(), app_vue);
        } else if (kind == "react") {
            directories.push_back(new_directory(temporary.path / L"src"));
            constexpr std::string_view package_json =
                "{\n"
                "  \"name\": \"demo\",\n"
                "  \"version\": \"0.0.0\",\n"
                "  \"type\": \"module\",\n"
                "  \"scripts\": {\n"
                "    \"dev\": \"vite\",\n"
                "    \"build\": \"vite build\",\n"
                "    \"preview\": \"vite preview\"\n"
                "  },\n"
                "  \"dependencies\": {\n"
                "    \"react\": \"^18.2.0\",\n"
                "    \"react-dom\": \"^18.2.0\"\n"
                "  },\n"
                "  \"devDependencies\": {\n"
                "    \"@vitejs/plugin-react\": \"^4.2.0\",\n"
                "    \"vite\": \"^5.0.0\"\n"
                "  }\n"
                "}\n";
            constexpr std::string_view vite_config_js =
                "import { defineConfig } from 'vite'\n"
                "import react from '@vitejs/plugin-react'\n\n"
                "export default defineConfig({\n"
                "  plugins: [react()],\n"
                "})\n";
            constexpr std::string_view index_html =
                "<!DOCTYPE html>\n"
                "<html lang=\"zh-CN\">\n"
                "<head>\n"
                "    <meta charset=\"UTF-8\">\n"
                "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
                "    <title>Demo App</title>\n"
                "</head>\n"
                "<body>\n"
                "    <div id=\"root\"></div>\n"
                "    <script type=\"module\" src=\"/src/main.jsx\"></script>\n"
                "</body>\n"
                "</html>\n";
            constexpr std::string_view main_jsx =
                "import React from 'react'\n"
                "import ReactDOM from 'react-dom/client'\n"
                "import App from './App.jsx'\n\n"
                "ReactDOM.createRoot(document.getElementById('root')).render(\n"
                "  <React.StrictMode>\n"
                "    <App />\n"
                "  </React.StrictMode>,\n"
                ")\n";
            constexpr std::string_view app_jsx =
                "function App() {\n"
                "  return (\n"
                "    <div style={{ textAlign: 'center', marginTop: '60px' }}>\n"
                "      <h1>Hello, TaoCode!</h1>\n"
                "    </div>\n"
                "  )\n"
                "}\n\n"
                "export default App\n";
            children.push_back(new_file(temporary.path / L"package.json"));
            write_and_flush(children.back().handle.get(), package_json);
            children.push_back(new_file(temporary.path / L"vite.config.js"));
            write_and_flush(children.back().handle.get(), vite_config_js);
            children.push_back(new_file(temporary.path / L"index.html"));
            write_and_flush(children.back().handle.get(), index_html);
            children.push_back(new_file(temporary.path / L"src" / L"main.jsx"));
            write_and_flush(children.back().handle.get(), main_jsx);
            children.push_back(new_file(temporary.path / L"src" / L"App.jsx"));
            write_and_flush(children.back().handle.get(), app_jsx);
        }
        // Windows directory publication must not depend on open child handles.
        for (auto& child : children) child.handle.reset();
        for (auto& dir : directories) dir.handle.reset();
        require_absent(destination);
        rename_handle(temporary.handle.get(), destination, false);
        for (auto& child : children) child.cleanup = false;
        for (auto& dir : directories) dir.cleanup = false;
        temporary.cleanup = false;
        return destination;
    });
}

ProjectStore::ProjectStore(fs::path state_file)
    : state_file_(boundary([&] {
          auto path = absolute_path(std::move(state_file));
          if (path.filename().empty()) fail("INVALID_PATH", "The configuration needs a file name.");
          validate_component(path.filename().native());
          return path;
      })) {}

Json ProjectStore::state() {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        const auto loaded = load_state(state_file_);
        return public_state(loaded.document);
    });
}

void ProjectStore::opened(const Json& workspace) {
    boundary([&] {
        std::lock_guard lock(store_mutex);
        if (!workspace.is_object() || !workspace.contains("name") || !workspace.at("name").is_string() ||
            workspace.at("name").get_ref<const std::string&>().empty() ||
            !valid_utf8(workspace.at("name").get_ref<const std::string&>()) ||
            !workspace.contains("root") || !workspace.at("root").is_string() ||
            !workspace.contains("entries") || !workspace.at("entries").is_array())
            fail("INVALID_ARGUMENT", "opened requires the result of Workspace::open.");
        const auto pinned = pin_directory(absolute_path(from_utf8(workspace.at("root").get<std::string>()), true));
        const auto root = utf8_path(pinned.path);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        Json recents = Json::array({{{"name", workspace.at("name")}, {"path", root}, {"lastOpened", utc_now()}}});
        for (const auto& recent : next.at("recentProjects")) {
            if (recents.size() < recent_limit && !same_path(recent.at("path").get<std::string>(), root))
                recents.push_back(recent);
        }
        next["recentProjects"] = std::move(recents);
        next["lastProject"] = root;
        save_state(state_file_, loaded, next);
    });
}

void ProjectStore::closed() {
    boundary([&] {
        std::lock_guard lock(store_mutex);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        next["lastProject"] = nullptr;
        save_state(state_file_, loaded, next);
    });
}

Json ProjectStore::forget(const std::string& path) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        // Forgetting also works when the directory is gone, inaccessible or now a link.
        const auto key = utf8_path(absolute_path(from_utf8(path), true));
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        Json recents = Json::array();
        for (const auto& recent : next.at("recentProjects")) {
            if (!same_path(recent.at("path").get<std::string>(), key)) recents.push_back(recent);
        }
        next["recentProjects"] = std::move(recents);
        if (next.at("lastProject").is_string() && same_path(next.at("lastProject").get<std::string>(), key))
            next["lastProject"] = nullptr;
        auto result = public_state(next);
        save_state(state_file_, loaded, next);
        return result;
    });
}

Json ProjectStore::update_settings(const Json& patch) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        validate_editor_patch(patch);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        next["settings"].update(patch);
        auto result = next.at("settings");
        save_state(state_file_, loaded, next);
        return result;
    });
}

Json ProjectStore::project_settings(const std::string& root) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        const auto key = project_key(root);
        const auto loaded = load_state(state_file_);
        const auto& projects = loaded.document.at("perProject");
        const auto found = projects.find(existing_project_key(projects, key));
        // A project saved before a setting existed (or storing it as null) reads back
        // with the defaults for the missing keys, recursively.
        Json result = project_defaults();
        if (found != projects.end()) fill_defaults(result, *found);
        return result;
    });
}

Json ProjectStore::update_project_settings(const std::string& root, const Json& patch) {
    return boundary([&] {
        std::lock_guard lock(store_mutex);
        validate_project_patch(patch);
        const auto key = project_key(root);
        auto loaded = load_state(state_file_);
        auto next = loaded.document;
        auto& projects = next["perProject"];
        const auto existing = existing_project_key(projects, key);
        auto result = project_defaults();
        if (projects.contains(existing)) fill_defaults(result, projects.at(existing));
        result.merge_patch(patch);
        projects.erase(existing);
        projects[key] = result;
        save_state(state_file_, loaded, next);
        return result;
    });
}

} // namespace taocode
