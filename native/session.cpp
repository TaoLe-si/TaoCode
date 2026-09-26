#include "session.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <fstream>
#include <utility>

namespace taocode {
namespace session {
namespace {
namespace fs = std::filesystem;

// Deterministic 64-bit FNV-1a, hex-encoded: the same stable name scheme the local
// history store uses, so one root maps to one session file across restarts.
std::string root_hash(const std::string& value) {
    std::uint64_t hash = 1469598103934665603ULL;
    for (const unsigned char ch : value) { hash ^= ch; hash *= 1099511628211ULL; }
    static constexpr char digits[] = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 15; i >= 0; --i) { out[static_cast<std::size_t>(i)] = digits[hash & 15]; hash >>= 4; }
    return out;
}

constexpr std::size_t max_tabs = 200;
constexpr std::size_t max_path_chars = 1024;
constexpr std::size_t max_draft_chars = 4 * 1024 * 1024;
constexpr std::size_t max_state_bytes = 48 * 1024 * 1024;

[[noreturn]] void reject(const char* code, const std::string& message) {
    throw WorkspaceError(code, message);
}

bool valid_utf8(std::string_view text) {
    return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(),
                               static_cast<int>(text.size()), nullptr, 0) != 0 ||
           text.empty();
}

// The stored paths are workspace-relative like every other bridge payload; a
// session file that escaped that contract must be refused, not partially loaded.
void validate_state(const Json& state) {
    if (!state.is_object() || !state.contains("tabs") || !state.at("tabs").is_array())
        reject("INVALID_SESSION", "会话状态必须是带 tabs 数组的对象。");
    const auto& tabs = state.at("tabs");
    if (tabs.size() > max_tabs)
        reject("INVALID_SESSION", "会话打开的文件过多，最多 200 个。");
    for (const auto& tab : tabs) {
        if (!tab.is_object() || !tab.contains("path") || !tab.at("path").is_string())
            reject("INVALID_SESSION", "每个会话条目都需要 path。");
        const auto& path = tab.at("path").get_ref<const std::string&>();
        if (path.empty() || path.size() > max_path_chars || path.front() == '/' || path.front() == '\\' ||
            path.find(':') != std::string::npos || path.find("..") != std::string::npos ||
            !valid_utf8(path))
            reject("INVALID_SESSION", "会话路径必须是工作区相对路径。");
        if (tab.contains("draft")) {
            if (!tab.at("draft").is_string())
                reject("INVALID_SESSION", "draft 必须是字符串。");
            const auto& draft = tab.at("draft").get_ref<const std::string&>();
            if (draft.size() > max_draft_chars || !valid_utf8(draft))
                reject("INVALID_SESSION", "draft 过大或不是有效的 UTF-8 文本。");
        }
        for (const char* field : {"line", "column", "pane"})
            if (tab.contains(field) && !tab.at(field).is_number())
                reject("INVALID_SESSION", "会话条目的行列/窗格字段必须是数字。");
    }
}

std::wstring api_path(const fs::path& path) {
    const auto native = path.native();
    if (native.starts_with(L"\\\\?\\")) return native;
    if (native.starts_with(L"\\\\")) return L"\\\\?\\UNC\\" + native.substr(2);
    return L"\\\\?\\" + native;
}

}  // namespace

SessionStore::SessionStore(std::filesystem::path directory) : directory_(std::move(directory)) {
    std::error_code error;
    fs::create_directories(directory_, error);  // profile/sessions may already exist
}

fs::path SessionStore::file_for(const std::string& root) const {
    if (root.empty() || root.find('\0') != std::string::npos || !valid_utf8(root))
        reject("INVALID_PATH", "会话需要有效的工作区根路径。");
    return directory_ / (root_hash(root) + ".json");
}

Json SessionStore::save(const std::string& root, const Json& state) {
    validate_state(state);
    const auto payload = state.dump();
    if (payload.size() > max_state_bytes)
        reject("INVALID_SESSION", "会话状态过大。");
    const auto target = file_for(root);
    const auto temporary = directory_ / (root_hash(root) + ".tmp");
    {
        std::ofstream stream(temporary, std::ios::binary | std::ios::trunc);
        if (!stream) reject("IO_ERROR", "无法写入会话临时文件。");
        stream.write(payload.data(), static_cast<std::streamsize>(payload.size()));
        stream.flush();
        if (!stream) reject("IO_ERROR", "写入会话临时文件失败。");
    }
    if (!MoveFileExW(api_path(temporary).c_str(), api_path(target).c_str(),
                     MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        std::error_code ignored;
        fs::remove(temporary, ignored);
        reject("IO_ERROR", "无法保存会话文件。");
    }
    return {{"saved", true}, {"bytes", payload.size()}};
}

Json SessionStore::load(const std::string& root) {
    const auto target = file_for(root);
    std::error_code error;
    if (!fs::is_regular_file(target, error)) return {{"found", false}};
    try {
        std::ifstream stream(target, std::ios::binary);
        if (!stream) return {{"found", false}};
        const Json state = Json::parse(stream);
        validate_state(state);
        return {{"found", true}, {"state", state}};
    } catch (const WorkspaceError&) {
        // A structurally-valid but shape-rejected state must report corrupt, not
        // surface as a programmer-facing exception.
        return {{"found", true}, {"corrupt", true}};
    } catch (const Json::exception&) {
        return {{"found", true}, {"corrupt", true}};
    }
}

Json SessionStore::clear(const std::string& root) {
    const auto target = file_for(root);
    std::error_code error;
    const bool exists = fs::exists(target, error);
    // Nothing on disk means the session is already clear — that is not a failure.
    if (!exists && !error) return {{"cleared", true}, {"removed", false}};
    // `cleared` used to be a hard-coded true: when the session file was locked or
    // unwritable the delete failed, the UI still promised "已清除", and the next
    // start restored drafts the user had been told were gone. Report the truth and
    // hand the Windows error code up so the failure is diagnosable, not swallowed.
    const bool removed = fs::remove(target, error);
    if (!removed) {
        const auto code = error ? static_cast<DWORD>(error.value()) : GetLastError();
        return {{"cleared", false}, {"removed", false}, {"error", code}};
    }
    return {{"cleared", true}, {"removed", true}};
}

}  // namespace session
}  // namespace taocode
