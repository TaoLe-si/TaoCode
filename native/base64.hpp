#pragma once

#include <string>
#include <string_view>

// Base64（编/解码）—— 从 main.cpp / workspace.cpp / runner.cpp **三份重复实现**合并而来。
//
// 为什么需要它：控制台的字节不是 UTF-8（随代码页变），而 JSON 桥必须是纯 ASCII，
// 所以终端通道与运行输出把字节 base64 编码后传；图片（data URL）也用它。
// 三处各写一份的时候，改一处漏两处是迟早的事（2026-09-27 拆 dialogs.cpp 时正是这么暴露的）。
namespace taocode {

// Console bytes are arbitrary (code pages, not guaranteed UTF-8), so the terminal channel
// carries them base64-encoded to keep the JSON bridge pure ASCII. 从 main.cpp 拆到这里
// （inline）：`native/dialogs.cpp` 读图片也要用同一份编码器，不能各写一份。
/**
 * base64 解码（原来的家是 main.cpp 的全局作用域；2026-09-27 挪进来与编码成对，也让 main.cpp 回到上限内）。
 * `=` 补齐与空白一律跳过（LSP `Content-Length` 之类的载荷里会出现换行）。
 */
inline std::string base64_decode(std::string_view in) {
    const auto value = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '+') return 62;
        if (c == '/') return 63;
        return -1;  // '=' 补齐与零散空白都跳过
    };
    std::string out;
    out.reserve(in.size() / 4 * 3);
    int buffer = 0, bits = 0;
    for (const char c : in) {
        const int v = value(c);
        if (v < 0) continue;
        buffer = (buffer << 6) | v;
        bits += 6;
        if (bits >= 8) { bits -= 8; out.push_back(static_cast<char>((buffer >> bits) & 0xff)); }
    }
    return out;
}

inline std::string base64_encode(std::string_view in) {
    static constexpr char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve((in.size() + 2) / 3 * 4);
    std::size_t i = 0;
    for (; i + 3 <= in.size(); i += 3) {
        const unsigned n = (static_cast<unsigned char>(in[i]) << 16) | (static_cast<unsigned char>(in[i + 1]) << 8) | static_cast<unsigned char>(in[i + 2]);
        out += table[(n >> 18) & 63]; out += table[(n >> 12) & 63]; out += table[(n >> 6) & 63]; out += table[n & 63];
    }
    if (i + 1 == in.size()) {
        const unsigned n = static_cast<unsigned char>(in[i]) << 16;
        out += table[(n >> 18) & 63]; out += table[(n >> 12) & 63]; out += "==";
    } else if (i + 2 == in.size()) {
        const unsigned n = (static_cast<unsigned char>(in[i]) << 16) | (static_cast<unsigned char>(in[i + 1]) << 8);
        out += table[(n >> 18) & 63]; out += table[(n >> 12) & 63]; out += table[(n >> 6) & 63]; out += '=';
    }
    return out;
}

}  // namespace taocode
