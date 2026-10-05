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
#include <algorithm>
#include <iostream>
#include <string>
#include <vector>

#include "zipstore.hpp"

#include "file_queries.hpp"
#include "workspace.hpp"
#include "workspace_detail.hpp"

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

/** 造一个带**目录条目**的 `lib/demo.jar`（尾斜杠那种，`-tf` 会原样列出来）。 */
void install_listing_jar(const fs::path& root) {
    fs::create_directories(root / L"lib");
    const std::vector<taocode::zip::MemoryEntry> entries{
        {"META-INF/", ""},
        {"META-INF/MANIFEST.MF", "Manifest-Version: 1.0"},
        {"com/", ""},
        {"com/example/", ""},
        {"com/example/Greeter.class", "CAFEBABE"},
        {"com/example/Greeter.java", "package com.example;"},
    };
    check(taocode::zip::write_archive(root / L"lib" / L"demo.jar", entries) == entries.size(), "写出 demo.jar");
}

/** 走桥的那条分派：`file.archiveEntries` 归 native/file_queries.cpp 认领。 */
Json ask_archive_entries(const std::string& path) {
    taocode::Workspace workspace;
    const Json params{{"path", path}};
    Json result;
    const bool claimed = taocode::dispatch_file_query("file.archiveEntries", params, workspace, result);
    check(claimed, "分派器应当认领 file.archiveEntries");
    return result;
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

    run("宿主通道：bsdtar -tf 列出归档条目，路径恒用斜杠", [&] {
        const auto root = fresh_root();
        install_listing_jar(root);
        const auto answer = ask_archive_entries(taocode::detail::utf8_path(root / L"lib" / L"demo.jar"));
        check(answer.at("available") == true, "应当列出条目：" + answer.value("reason", std::string()));
        check(answer.at("truncated") == false, "六个条目不至于截断");
        const auto lines = answer.at("lines").get<std::vector<std::string>>();
        check(lines.size() == 6, "六个条目，实得 " + std::to_string(lines.size()));
        const auto has = [&](const std::string& want) {
            return std::find(lines.begin(), lines.end(), want) != lines.end();
        };
        check(has("com/example/Greeter.class"), "类条目要在");
        check(has("com/example/Greeter.java"), "源码条目要在");
        check(has("META-INF/MANIFEST.MF"), "清单条目要在");
        check(has("com/example/"), "目录条目带尾斜杠（是不是目录交给呈现层判，同一份规则只有一份）");
        for (const auto& line : lines) {
            check(line.find('\\') == std::string::npos, "档案内路径不出现反斜杠：" + line);
            check(line.rfind("./", 0) != 0, "去掉 ./ 前缀：" + line);
            check(!line.empty(), "不交空行");
        }
        check(answer.at("archive").get<std::string>().find("demo.jar") != std::string::npos, "回显是哪个归档");
    });

    run("拿不到就如实说拿不到：不给 lines 字段（前端据此整块不渲染）", [&] {
        const auto root = fresh_root();
        install_listing_jar(root);
        std::ofstream(root / L"lib" / L"notes.txt") << "not an archive";
        for (const auto* bad : {"", "lib/demo.jar", "C:/no/such/dir/none.jar"})
            check(ask_archive_entries(bad).at("available") == false, std::string("应当拿不到：") + bad);
        const auto wrong_type = ask_archive_entries(taocode::detail::utf8_path(root / L"lib" / L"notes.txt"));
        check(wrong_type.at("available") == false, "非归档扩展名要拒");
        check(!wrong_type.contains("lines"), "拒的时候不能带 lines —— 否则前端会把空清单当真实数据画出来");
        check(!wrong_type.value("reason", std::string()).empty(), "要说清为什么拿不到");
    });

    run("未知方法不归这条分派表管（按整名匹配，不能前缀命中）", [&] {
        taocode::Workspace workspace;
        Json result;
        check(!taocode::dispatch_file_query("file.archiveEntriesTypo", Json{{"path", "x.jar"}}, workspace, result),
              "只认 file.archiveEntries 这一个名字");
    });

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
