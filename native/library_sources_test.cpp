// 「库类型的源码」的判据（native/library_sources.cpp）：全限定名 → `*-sources.jar` 里的 .java。
//
// 这条通道的两端都有真实来源：名字来自 JDT 的 hover（真机实测回 `net.minecraftforge.common.config.Configuration`
// + javadoc），jar 是工程磁盘上真实存在的 `*-sources.jar`。测试用一个自己造的工程夹具
// （`lib/demo-sources.jar` 里放一个包路径下的 .java）把"能不能解出来、解到哪、解出来是不是只读、
// 第二次会不会复用缓存"钉死；解压交给 bsdtar（与 plugins.cpp 同一招）。
#include "library_sources.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

#include "zipstore.hpp"

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::LibrarySource;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

fs::path fresh_root() {
    const auto root = fs::temp_directory_path() / L"taocode-library-sources-test";
    fs::remove_all(root);
    fs::create_directories(root);
    return root;
}

/** 造一个 store 方式的 `lib/demo-sources.jar`（bsdtar 读得懂；引擎不引压缩库）。 */
void install_sources_jar(const fs::path& root) {
    fs::create_directories(root / L"lib");
    const std::string source = "package com.example;\n\npublic class Greeter {\n    public String hello() { return \"hi\"; }\n}\n";
    const std::vector<taocode::zip::MemoryEntry> entries{{"com/example/Greeter.java", source}};
    check(taocode::zip::write_archive(root / L"lib" / L"demo-sources.jar", entries) == 1, "写出 sources jar");
}

std::string read_all(const fs::path& file) {
    std::ifstream stream(file, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
}
}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    run("全限定名从 *-sources.jar 里解出源码，落在缓存目录且是只读", [&] {
        const auto root = fresh_root();
        install_sources_jar(root);
        const auto cache = root / L"cache";
        const auto found = taocode::find_library_source(root, cache, "com.example.Greeter");
        check(found.available, "应当找到：" + found.reason);
        check(found.entry == "com/example/Greeter.java", "条目名按包路径展开，得到 " + found.entry);
        check(found.content.find("public class Greeter") != std::string::npos, "内容要是那个 .java");
        check(found.jar.find("demo-sources.jar") != std::string::npos, "命中的 jar 是 " + found.jar);
        check(found.path.find("cache") != std::string::npos, "解到缓存目录：" + found.path);
        check(read_all(found.path) == found.content, "磁盘上的内容与返回的一致");
        const DWORD attributes = GetFileAttributesW(std::filesystem::path(std::u8string(found.path.begin(), found.path.end())).c_str());
        check(attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_READONLY) != 0,
              "库源码要置只读位（IDEA 的库源码编辑器同样只读）");
    });

    run("第二次查询复用缓存（同一个路径，不再解一遍）", [&] {
        const auto root = fresh_root();
        install_sources_jar(root);
        const auto cache = root / L"cache";
        const auto first = taocode::find_library_source(root, cache, "com.example.Greeter");
        const auto second = taocode::find_library_source(root, cache, "com.example.Greeter");
        check(first.available && second.available, "两次都要命中");
        check(first.path == second.path, "缓存命中：路径不变");
    });

    run("不在 jar 里的名字如实说没找到（不猜、不造空文件）", [&] {
        const auto root = fresh_root();
        install_sources_jar(root);
        const auto missing = taocode::find_library_source(root, L"cache", "com.example.Nope");
        check(!missing.available, "不存在的类不该命中");
        check(missing.reason.find("Greeter") == std::string::npos, "reason 里只报查了什么，不假造结果");
    });

    run("非法全限定名被挡住（输入来自 hover 文本，不能牵着路径走）", [&] {
        const auto root = fresh_root();
        install_sources_jar(root);
        for (const auto* bad : {"", "..", "../../etc/passwd", "com/example/Greeter", "com..Greeter", "1abc.Def", ".Greeter"})
            check(!taocode::find_library_source(root, L"cache", bad).available, std::string("应当拒绝：") + bad);
    });

    run("工程里没有 sources jar 时给出如实的理由", [&] {
        const auto root = fresh_root();
        const auto none = taocode::find_library_source(root, L"cache", "com.example.Greeter");
        check(!none.available && none.reason.find("sources.jar") != std::string::npos, "理由要说清缺什么：" + none.reason);
    });

    run("桥接层的形状：命中带 path/jar/entry/content，未命中只说 available=false", [&] {
        const auto root = fresh_root();
        install_sources_jar(root);
        const Json hit = taocode::library_source_json(taocode::find_library_source(root, L"cache", "com.example.Greeter"));
        check(hit.at("available") == true && hit.contains("path") && hit.contains("jar") && hit.contains("entry") && hit.contains("content"),
              "命中要有四个字段");
        const Json miss = taocode::library_source_json(taocode::find_library_source(root, L"cache", "nope"));
        check(miss.at("available") == false, "未命中 available=false");
    });

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
