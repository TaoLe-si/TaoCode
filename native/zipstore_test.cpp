// Offline self-test for the minimal ZIP (store) writer/reader used by «collect logs and zip».
#include "zipstore.hpp"

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::zip::Entry;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

void write_text(const fs::path& path, const std::string& text) {
    fs::create_directories(path.parent_path());
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
}

/**
 * 手工拼一条**本地文件头 + 数据**（不写出 central directory：读取端在遇到
 * `PK\x01\x02`/`PK\x05\x06` 或读尽时停）。要造「本仓读不了的包」只能这么拼 ——
 * 我们的 writer 只会写 store，造不出方法 8。字段偏移按 APPNOTE 的 local header 表：
 * 标志 6、方法 8、压缩后大小 18、名字长 26、extra 长 28。
 */
std::string raw_local_entry(const std::string& name,
                            std::uint16_t method,
                            std::uint16_t flag,
                            const std::string& payload) {
    std::string out;
    auto put16 = [&out](std::uint16_t value) {
        out.push_back(static_cast<char>(value & 0xFF));
        out.push_back(static_cast<char>((value >> 8) & 0xFF));
    };
    auto put32 = [&out, &put16](std::uint32_t value) {
        put16(static_cast<std::uint16_t>(value & 0xFFFF));
        put16(static_cast<std::uint16_t>((value >> 16) & 0xFFFF));
    };
    out.append("PK\x03\x04", 4);
    put16(20);                                  // version needed
    put16(flag);                                // general purpose bit flag
    put16(method);                              // compression method
    put16(0);                                   // last mod time
    put16(19835);                               // last mod date（任意合法值，读取端不看）
    put32(taocode::zip::crc32(payload));        // crc-32
    put32(static_cast<std::uint32_t>(payload.size()));   // compressed size
    put32(static_cast<std::uint32_t>(payload.size()));   // uncompressed size
    put16(static_cast<std::uint16_t>(name.size()));
    put16(0);                                   // extra field length
    out += name;
    out += payload;
    return out;
}

fs::path temp_root() {
    const auto base = fs::temp_directory_path() / L"taocode-zipstore-test";
    std::error_code error;
    fs::remove_all(base, error);
    fs::create_directories(base, error);
    return base;
}

int failures = 0;

void run(const std::string& name, const std::function<void()>& body) {
    try {
        body();
        std::cout << "ok   " << name << '\n';
    } catch (const std::exception& error) {
        ++failures;
        std::cout << "FAIL " << name << ": " << error.what() << '\n';
    }
}
}  // namespace

int main() {
    const auto root = temp_root();

    run("CRC-32 用 IEEE 802.3 多项式（\"123456789\" = 0xCBF43926）", [] {
        check(taocode::zip::crc32("123456789") == 0xCBF43926u, "CRC-32 已知值不匹配");
        check(taocode::zip::crc32("") == 0u, "空串的 CRC 应为 0");
    });

    run("写两个文本条目并能原样读回", [&] {
        write_text(root / L"a.txt", "hello 日志");
        write_text(root / L"nested" / L"b.log", "second line\n");
        const auto archive = root / L"pack.zip";
        const auto written = taocode::zip::write_archive(archive, {
            {"a.txt", root / L"a.txt"},
            {"nested/b.log", root / L"nested" / L"b.log"},
        });
        check(written == 2, "条目数不对");
        check(fs::exists(archive), "zip 没有生成");
        const auto entries = taocode::zip::read_archive(archive);
        check(entries.size() == 2, "读回的条目数不对");
        check(entries[0].first == "a.txt" && entries[0].second == "hello 日志", "第一个条目内容不对");
        check(entries[1].first == "nested/b.log" && entries[1].second == "second line\n", "第二个条目内容不对");
    });

    run("二进制内容（含 \\0 与 0xFF）也能往返", [&] {
        const std::string bytes("\x00\x01\xFF\x00tail", 9);
        write_text(root / L"raw.bin", bytes);
        const auto archive = root / L"binary.zip";
        taocode::zip::write_archive(archive, {{"raw.bin", root / L"raw.bin"}});
        const auto entries = taocode::zip::read_archive(archive);
        check(entries.size() == 1 && entries[0].second == bytes, "二进制内容没有原样往返");
    });

    run("空条目列表也能写出结构合法的 zip（0 条目）", [&] {
        const auto archive = root / L"empty.zip";
        check(taocode::zip::write_archive(archive, std::vector<taocode::zip::Entry>{}) == 0, "空列表应写 0 个条目");
        check(taocode::zip::read_archive(archive).empty(), "空 zip 读出来应是空的");
        // 空包没有任何 local header / central entry，第一个（也是唯一）记录就是结尾记录
        // `PK\x05\x06`（end of central directory）。三种签名都是合法的 ZIP 起始。
        std::ifstream in(archive, std::ios::binary);
        char signature[4] = {};
        in.read(signature, 4);
        const std::string head(signature, 4);
        check(head == std::string("PK\x05\x06", 4), "空 zip 的起始记录不是结尾记录");
        check(fs::file_size(archive) == 22, "空 zip 应该正好是 22 字节的结尾记录");
    });

    run("来源文件不存在时抛错（不生成半截 zip）", [&] {
        bool thrown = false;
        try {
            taocode::zip::write_archive(root / L"missing.zip", {{"nope.txt", root / L"nope.txt"}});
        } catch (const std::exception&) { thrown = true; }
        check(thrown, "缺文件竟然没报错");
    });

    run("不是 store 的条目要**说清读不了**，不能吐压缩字节当内容", [&] {
        // 现场反推：外部工具（IDEA 导出、7-Zip、Windows「发送到压缩文件夹」）打的包条目是
        // deflate（方法 8）。旧实现跳过 method 字段原样拷贝 compressed size 个字节，调用方
        // （settings_transfer::read_archive）于是报「归档里的设置不是合法的 JSON」——
        // 真原因被盖掉了。现在必须在读到数据之前就拒，并且说出方法号。
        const auto archive = root / L"deflate.zip";
        write_text(archive, raw_local_entry("taocode-settings.json", 8, 0x0800, "\x78\x9c\xab\x00fake-deflate-bytes"));
        bool thrown = false;
        std::string message;
        try {
            const auto entries = taocode::zip::read_archive(archive);
            check(entries.empty(), "deflate 条目竟被当成内容读出来了，而且还能是空的");
        } catch (const std::exception& error) {
            thrown = true;
            message = error.what();
        }
        check(thrown, "deflate 包没有抛错");
        check(message.find("压缩方法 8") != std::string::npos, "抛的是别的错，没说出方法号：" + message);
    });

    run("加密条目与流式大小条目各自抛错（本地头里的 0 大小不能当真）", [&] {
        // bit 0 = 加密：内容与名字都是密文，读出来只会是垃圾。
        const auto encrypted = root / L"encrypted.zip";
        write_text(encrypted, raw_local_entry("secret.json", 0, 0x0001, "ciphertext"));
        bool thrown = false;
        std::string message;
        try { taocode::zip::read_archive(encrypted); }
        catch (const std::exception& error) { thrown = true; message = error.what(); }
        check(thrown && message.find("加密") != std::string::npos, "加密条目没有明确拒掉：" + message);

        // bit 3 = 大小写在数据之后的 data descriptor：本地头的两个大小字段是 0。
        // 旧实现会把「0 字节内容」当成条目读出来（名单里有、正文是空的），
        // 于是导入设置时报「不是合法的 JSON」而不是「这个包读不了」。
        const auto streamed = root / L"streamed.zip";
        write_text(streamed, raw_local_entry("taocode-settings.json", 0, 0x0008, ""));
        thrown = false;
        try { taocode::zip::read_archive(streamed); }
        catch (const std::exception& error) { thrown = true; message = error.what(); }
        check(thrown && message.find("流式") != std::string::npos, "流式大小的条目没有明确拒掉：" + message);
    });

    run("store 条目带 UTF-8 名字标志（0x0800）照旧读得出（别把标志位一刀切拒了）", [&] {
        const auto archive = root / L"utf8-flag.zip";
        write_text(archive, raw_local_entry("a.txt", 0, 0x0800, "plain store payload"));
        const auto entries = taocode::zip::read_archive(archive);
        check(entries.size() == 1 && entries[0].first == "a.txt"
                  && entries[0].second == "plain store payload",
              "带 UTF-8 名字标志的 store 条目被误拒了");
    });

    std::error_code cleanup;
    fs::remove_all(root, cleanup);
    std::cout << (failures ? "ZIPSTORE TESTS FAILED\n" : "zipstore tests passed\n");
    return failures ? 1 : 0;
}
