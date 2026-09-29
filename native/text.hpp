#pragma once

#include <windows.h>

#include <stdexcept>
#include <string>
#include <string_view>

// UTF-8 ↔ UTF-16 转换 —— 从 main.cpp / watcher.cpp（以及 dialogs.cpp 需要的那份）合并成一份。
//
// 为什么需要：Win32 的宽字符 API 用 UTF-16，而 JSON 桥与文件内容都是 UTF-8；
// 每个用到宽字符的模块都手写一遍这两段转换，就是 2026-09-27 拆 dialogs.cpp 时暴露出的重复
// （当时 main.cpp 有一份、watcher.cpp 有一份，第三处又要新增）。
//
// 失败语义：非法编码**抛异常**（`std::runtime_error`），不静默返回空串 —— 静默会让"路径变成了空"
// 这类问题跑到很远的地方才发作。watcher.cpp 原先返回空串，改用这里之后行为是"抛"，
// 而它的调用点都在 try/catch 内（目录监听线程），因此更早暴露问题而不是更晚。
namespace taocode {

inline std::string utf8(std::wstring_view value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
                                        static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) throw std::runtime_error("Invalid UTF-16");
    std::string result(static_cast<std::size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
                        result.data(), size, nullptr, nullptr);
    return result;
}

inline std::wstring wide(std::string_view value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                                         static_cast<int>(value.size()), nullptr, 0);
    if (size <= 0) throw std::runtime_error("Invalid UTF-8");
    std::wstring result(static_cast<std::size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
                        result.data(), size);
    return result;
}

}  // namespace taocode
