// 「路径文本 → 可信 fs::path」的守卫一族（equal_name / validate_component / parse_relative /
// plain_path / within）—— 2026-10-08 从 native/workspace.cpp 整段搬出：那个文件当时 1400 行，
// 上限 1385（机检口径 = split('\n') 计数 1401 > 1385），只剩 16 行余量。这一族只做一件事：
// 把不可信的路径字符串规范化成 fs::path，并守住"不出工作区、不碰 Windows 设备名/NTFS 数据流"。
// 它不读文件内容、不碰句柄、不管编码与 Workspace 的状态机。
//
// 搬动时**实现一个字没改**：下面五个函数与 workspace.cpp 里原来的逐字相同（workspace.cpp
// 里只留下各处调用与一段指回这里的注释）。`fail` 与 `valid_utf8` 的实现仍然只有各自那一份 ——
// fail 的声明在 native/workspace_detail.hpp（定义在 workspace.cpp），valid_utf8 在
// native/workspace_codec.hpp。

#include "workspace_detail.hpp"
#include "workspace_codec.hpp"  // valid_utf8

#include <algorithm>
#include <string>
#include <string_view>

namespace taocode {
namespace detail {
namespace fs = std::filesystem;

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

bool within(const fs::path& path, const fs::path& root) {
    auto actual = path.begin();
    for (auto expected = root.begin(); expected != root.end(); ++expected, ++actual) {
        if (actual == path.end() || !equal_name(actual->native(), expected->native()))
            return false;
    }
    return true;
}

}  // namespace detail
}  // namespace taocode