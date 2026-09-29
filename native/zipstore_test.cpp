// Offline self-test for the minimal ZIP (store) writer/reader used by «collect logs and zip».
#include "zipstore.hpp"

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

    std::error_code cleanup;
    fs::remove_all(root, cleanup);
    std::cout << (failures ? "ZIPSTORE TESTS FAILED\n" : "zipstore tests passed\n");
    return failures ? 1 : 0;
}
