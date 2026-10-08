// 文本编解码 + 行分隔符（workspace codec）：编码表、BOM 判定、UTF-16/UTF-32 的手工转换，
// 以及三档行尾（LF/CRLF/CR）的映射、检测与归一。
//
// 2026-10-06（linesep2）从 native/workspace.cpp 整段拆出：补上 UTF-32 两档与第三档行尾 CR
// 之后，`native/workspace.cpp` 会顶穿它登记的 1385 行上限 —— 按登记的规矩「上限只能靠拆来
// 下调，不许无声地往上抬」，拆文件而不是抬数字。这里没有第二份实现，搬家不改语义。
//
// 上游坐标（实读，参考树 intellij-community-master）：
//   · `platform/util/src/com/intellij/util/LineSeparator.java:17-20` —— 枚举三档
//     `LF("\n")` / `CRLF("\r\n")` / `CR("\r")`。
//   · `platform/core-impl/src/com/intellij/openapi/fileEditor/impl/LoadTextUtil.java:801-813`
//     —— `ConvertResult.majorLineSeparator()`：数 CRLF / 孤 CR / LF 三票定行尾。
//   · `platform/util/src/com/intellij/openapi/vfs/CharsetToolkit.java:424-429`
//     —— BOM 判定顺序 UTF-8 → UTF-32BE → UTF-32LE → UTF-16LE → UTF-16BE。
//
// 全 inline；只由 native/workspace.cpp include —— `detail::fail` 的定义（WorkspaceError 的
// 唯一抛出点）在那一个 TU 里，声明见 native/workspace_detail.hpp。
#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <array>
#include <cstdint>
#include <limits>
#include <string>
#include <string_view>

#include "workspace.hpp"         // WorkspaceError
#include "workspace_detail.hpp"  // detail::fail

namespace taocode {

inline bool valid_utf8(const std::string& text) {
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
// The UTF-32 pair is NOT reachable through MultiByteToWideChar (no Windows code page
// converts a 32-bit unit to UTF-16 surrogates), so those two numbers are sentinels that
// only select the by-hand path, exactly like the UTF-16 pair already does.
constexpr uint32_t utf16le_page = 1200, utf16be_page = 1201;
constexpr uint32_t utf32le_page = 120000, utf32be_page = 120001;

struct Encoding {
    const char* key;          // the token the UI sends back verbatim
    uint32_t page;            // Windows code page; the UTF-16/UTF-32 pairs are handled by hand
    std::string_view bom;     // byte-order mark to write when the caller asks for one
                              // (length-carrying: the UTF-32BE mark starts with a NUL,
                              //  so strlen() would report it as 0 bytes long)
};

// The list order IS the BOM sniffing order, and it is load-bearing: a UTF-32LE mark
// (FF FE 00 00) begins with the UTF-16LE mark (FF FE), so the UTF-32 pair must be tried
// before it. That is upstream's order too — CharsetToolkit.guessFromBOM tests UTF-8,
// UTF-32BE, UTF-32LE, UTF-16LE, UTF-16BE
// (platform/util/src/com/intellij/openapi/vfs/CharsetToolkit.java:424-429).
inline const Encoding encoding_list[] = {
    {"utf-8", CP_UTF8, std::string_view{"\xEF\xBB\xBF", 3}},
    {"gbk", 936, {}},
    {"cp1252", 1252, {}},
    {"system", CP_ACP, {}},
    {"utf-32be", utf32be_page, std::string_view{"\x00\x00\xFE\xFF", 4}},
    {"utf-32le", utf32le_page, std::string_view{"\xFF\xFE\x00\x00", 4}},
    {"utf-16le", utf16le_page, std::string_view{"\xFF\xFE", 2}},
    {"utf-16be", utf16be_page, std::string_view{"\xFE\xFF", 2}},
};

inline const Encoding& encoding_for(const std::string& key) {
    for (const auto& item : encoding_list)
        if (key == item.key) return item;
    detail::fail("INVALID_ENCODING", "不支持的文件编码：" + key);
}

inline const Encoding& utf8_encoding() { return encoding_for("utf-8"); }

inline bool utf16_page(uint32_t page) { return page == utf16le_page || page == utf16be_page; }
inline bool utf32_page(uint32_t page) { return page == utf32le_page || page == utf32be_page; }

// The 16- and 32-bit families carry almost every Latin character with NUL bytes, so a
// NUL is ordinary text for them; for every other code page it means binary.
inline bool nul_is_text(uint32_t page) { return utf16_page(page) || utf32_page(page); }

inline std::wstring decode_wide(const char* data, std::size_t size, const Encoding& encoding) {
    const std::string label(encoding.key);
    if (size == 0) return {};
    if (utf32_page(encoding.page)) {
        // Strict, like the UTF-16 pair: a short tail or a value that is not a Unicode
        // scalar (past U+10FFFF, or a surrogate code point, which UTF-32 forbids) is an
        // error rather than a silently mangled character.
        if (size % 4) detail::fail("ENCODING_MISMATCH", "UTF-32 文本的字节数必须是 4 的倍数：" + label);
        const bool little = encoding.page == utf32le_page;
        std::wstring text;
        text.reserve(size / 4);
        for (std::size_t index = 0; index + 3 < size; index += 4) {
            const auto byte = [&](std::size_t position) {
                return static_cast<unsigned>(static_cast<unsigned char>(data[little ? index + position : index + 3 - position]));
            };
            const auto point = byte(0) | (byte(1) << 8) | (byte(2) << 16) | (byte(3) << 24);
            if (point > 0x10FFFF || (point >= 0xD800 && point <= 0xDFFF))
                detail::fail("ENCODING_MISMATCH", label + " 含有不是有效 Unicode 码位的值，文件不能作为文本打开。");
            if (point <= 0xFFFF) {
                text.push_back(static_cast<wchar_t>(point));
            } else {
                const auto tail = point - 0x10000;
                text.push_back(static_cast<wchar_t>(0xD800 + (tail >> 10)));
                text.push_back(static_cast<wchar_t>(0xDC00 + (tail & 0x3FF)));
            }
        }
        return text;
    }
    if (utf16_page(encoding.page)) {
        if (size % 2) detail::fail("ENCODING_MISMATCH", "UTF-16 文本的字节数必须是偶数：" + label);
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
        detail::fail("ENCODING_MISMATCH", "文件内容不是 " + label + " 编码的有效文本。");
    std::wstring text(needed, L'\0');
    MultiByteToWideChar(encoding.page, MB_ERR_INVALID_CHARS, data, static_cast<int>(size), text.data(), needed);
    return text;
}

inline std::wstring decode_wide(const std::string& bytes, const Encoding& encoding) {
    return decode_wide(bytes.data(), bytes.size(), encoding);
}

inline std::string encode_bytes(const std::wstring& text, const Encoding& encoding) {
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
    if (utf32_page(encoding.page)) {
        // UTF-32 stores one scalar per 4-byte unit, so a surrogate pair collapses back to
        // its code point and an unpaired surrogate has no representation at all: refuse
        // rather than write a surrogate value that no reader would accept as text.
        const bool little = encoding.page == utf32le_page;
        std::string bytes;
        bytes.reserve(text.size() * 4);
        for (std::size_t index = 0; index < text.size(); ++index) {
            const auto high_unit = static_cast<unsigned>(text[index]);
            auto point = high_unit;
            if (high_unit >= 0xD800 && high_unit <= 0xDBFF) {
                if (index + 1 >= text.size())
                    detail::fail("ENCODING_LOSS", std::string("有孤立代理项无法用 ") + encoding.key + " 编码表示，文件未保存。");
                const auto low_unit = static_cast<unsigned>(text[index + 1]);
                if (low_unit < 0xDC00 || low_unit > 0xDFFF)
                    detail::fail("ENCODING_LOSS", std::string("有孤立代理项无法用 ") + encoding.key + " 编码表示，文件未保存。");
                point = 0x10000 + ((high_unit - 0xD800) << 10) + (low_unit - 0xDC00);
                ++index;
            } else if (high_unit >= 0xDC00 && high_unit <= 0xDFFF) {
                detail::fail("ENCODING_LOSS", std::string("有孤立代理项无法用 ") + encoding.key + " 编码表示，文件未保存。");
            }
            std::array<char, 4> unit = {
                static_cast<char>(point & 0xFF), static_cast<char>((point >> 8) & 0xFF),
                static_cast<char>((point >> 16) & 0xFF), static_cast<char>((point >> 24) & 0xFF)};
            if (little) bytes.append(unit.data(), unit.size());
            else for (auto reverse = unit.rbegin(); reverse != unit.rend(); ++reverse) bytes.push_back(*reverse);
        }
        return bytes;
    }
    const auto needed = WideCharToMultiByte(encoding.page, 0, text.data(), static_cast<int>(text.size()),
                                           nullptr, 0, nullptr, nullptr);
    if (!needed) detail::fail("ENCODING_FAILED", std::string("无法用 ") + encoding.key + " 编码写入文件。");
    std::string bytes(needed, '\0');
    WideCharToMultiByte(encoding.page, 0, text.data(), static_cast<int>(text.size()), bytes.data(), needed, nullptr, nullptr);
    // lpUsedDefaultChar is unreliable across code pages, so verify by decoding the
    // bytes back: a silent substitution changes the text and fails here instead.
    if (decode_wide(bytes, encoding) != text)
        detail::fail("ENCODING_LOSS", std::string("有字符无法用 ") + encoding.key + " 编码表示，文件未保存。");
    return bytes;
}

// The encoding to read with: an explicit choice wins, otherwise a byte-order mark
// decides, otherwise UTF-8 is assumed and enforced.
inline const Encoding& resolve_read(const std::string& bytes, const std::string& requested, std::size_t& bom_length) {
    bom_length = 0;
    if (requested.empty() || requested == "auto") {
        for (const auto& candidate : encoding_list) {
            const auto size = candidate.bom.size();  // encoding_list order decides UTF-32 vs UTF-16
            if (size && bytes.compare(0, size, candidate.bom) == 0) { bom_length = size; return candidate; }
        }
        return encoding_for("utf-8");
    }
    const auto& chosen = encoding_for(requested);
    const auto size = chosen.bom.size();
    if (size && bytes.compare(0, size, chosen.bom) == 0) bom_length = size;
    return chosen;
}

// What goes to disk: the encoded text, optionally with the encoding's byte-order mark.
inline std::string encode_document(const std::string& utf8, const Encoding& encoding, bool bom) {
    std::string bytes = encoding.page == CP_UTF8 ? utf8 : encode_bytes(decode_wide(utf8, encoding_for("utf-8")), encoding);
    if (bom) bytes.insert(bytes.begin(), encoding.bom.begin(), encoding.bom.end());
    return bytes;
}

// What reaches the editor: the bytes after the byte-order mark, as UTF-8. The caller has
// already run validate_bytes() on the whole file, so the size cap is not re-checked here.
// The version the caller fingerprints is the raw bytes, BOM included — that stays a
// read/write concern, not a codec one.
inline std::string decode_document(const std::string& bytes, const Encoding& encoding, std::size_t bom_length) {
    if (encoding.page == CP_UTF8) {
        std::string content = bytes.substr(bom_length);  // UTF-8 travels unchanged: no decode copy
        if (!valid_utf8(content))
            detail::fail("INVALID_UTF8", "文件不是有效的 UTF-8 文本；若是中文旧文件，请用 GBK 编码重新打开。");
        return content;
    }
    return encode_bytes(decode_wide(bytes.data() + bom_length, bytes.size() - bom_length, encoding), utf8_encoding());
}

// The three tiers IDEA knows: `LineSeparator.java:17-20` is the enum `LF("\n")`,
// `CRLF("\r\n")`, `CR("\r")`, and the classic-Mac entry is a real action, not a dead
// branch — `PlatformActions.xml:405-408` lists ConvertToWindows/Unix/Mac in the
// ChangeLineSeparators group, and `ConvertToMacLineSeparatorsAction.java:14` passes
// `LineSeparator.CR`. The UI sends the lowercase token; it maps to bytes here and nowhere
// else, so no tier can be swallowed by a silent default any more.
inline const std::string& line_separator_bytes(const std::string& token) {
    static const std::string crlf = "\r\n", lf = "\n", cr = "\r";
    if (token == "crlf") return crlf;
    if (token == "lf") return lf;
    if (token == "cr") return cr;
    detail::fail("INVALID_SETTINGS", "行分隔符只能是 crlf、lf 或 cr。");
}

// The separator a save has to reproduce, counted the way the loader counts it:
// `LoadTextUtil.java:801-813` (`ConvertResult.majorLineSeparator`) compares the three
// tallies — CRLF wins only over both others, then a lone CR beats LF, then LF. Sniffing
// for "\r\n" alone (the previous shape) reported every CR file as LF and rewrote the
// whole file on the next save.
inline std::string detect_separator(const std::string& text) {
    std::size_t cr = 0, lf = 0, crlf = 0;
    for (std::size_t index = 0; index < text.size(); ++index) {
        if (text[index] == '\r') {
            if (index + 1 < text.size() && text[index + 1] == '\n') { ++index; ++crlf; }
            else ++cr;
            continue;
        }
        if (text[index] == '\n') ++lf;
    }
    if (crlf > cr && crlf > lf) return "\r\n";
    if (cr > lf) return "\r";
    // LF_count > 0, or the buffer carries no line break at all — in that case
    // convert_endings() below is the identity, so the choice never reaches the bytes.
    return "\n";
}

// ConvertToWindows/Unix/MacLineSeparatorsAction: normalize every line ending to the
// requested separator. CRLF collapses to one break; a lone CR is one too.
inline std::string convert_endings(const std::string& text, const std::string& separator) {
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

} // namespace taocode
