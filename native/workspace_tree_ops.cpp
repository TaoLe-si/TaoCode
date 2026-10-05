// 「递归遍历一棵树并删除/复制它」（2026-10-05 从 native/workspace.cpp 整段搬出：那个文件当时
// 1435 行、上限 1480，只剩 45 行余量）。这两个函数只认三件事：Win32 的目录枚举、重解析点
// 拒绝、条目预算 —— 它们不读文件内容、不管编码、不碰 Workspace 的状态机。
// `Workspace::copy` 与 `Workspace::remove` 留在 workspace.cpp 调用它们。
//
// 搬动时**实现一个字没改**：下面 87 行（remove_tree / copy_tree，连同两段注释）与 workspace.cpp
// 里原来的逐字相同。唯一多出来的是文件头 —— detail 的那排 using（api_path / utf8_path /
// fail / win_error 的实现仍然只有 workspace.cpp 里那一份，声明见 native/workspace_detail.hpp；
// 错误码映射复制一份就会漂移）。

#include "workspace.hpp"
#include "workspace_detail.hpp"

#include <string>
#include <string_view>
#include <vector>

namespace taocode {
namespace detail {
namespace fs = std::filesystem;

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
            // A file whose read-only bit cannot be cleared would fail DeleteFileW
            // with a misleading "access denied"; report the real reason instead.
            if (data.dwFileAttributes & FILE_ATTRIBUTE_READONLY &&
                !SetFileAttributesW(api_path(child).c_str(), data.dwFileAttributes & ~FILE_ATTRIBUTE_READONLY))
                fail("IO_ERROR", "无法解除只读属性，删除已中止（Windows 错误 " +
                                     std::to_string(GetLastError()) + "）：" + utf8_path(child));
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
    // The copy is promised writable (workspace.hpp): if the bit cannot be cleared,
    // the caller must hear about it instead of getting a "copied: true" that is
    // read-only on disk.
    if (attributes & FILE_ATTRIBUTE_READONLY &&
        !SetFileAttributesW(api_path(target).c_str(), attributes & ~FILE_ATTRIBUTE_READONLY))
        fail("IO_ERROR", "副本仍带只读属性，无法清除（Windows 错误 " + std::to_string(GetLastError()) +
                             "）：" + utf8_path(target));
}

// 与 workspace.cpp 顶部同一排 using 的另一半：搬过来的代码保持原样，不必改成 detail::xxx(...)。
using detail::api_path;
using detail::fail;
using detail::utf8_path;
using detail::win_error;

}  // namespace detail

}  // namespace taocode
