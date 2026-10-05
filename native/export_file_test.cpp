// Offline self-test for the export write channel (IDEA ExportToHTMLManager 的落盘那一步):
// 扩展名白名单、绝对路径、父目录必须存在、以及真的把内容写出去。
#include "export_file.hpp"

#include "text.hpp"

#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

namespace fs = std::filesystem;
using taocode::Json;
using taocode::WorkspaceError;
using taocode::export_file::Entry;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

fs::path temp_root() {
    const auto base = fs::temp_directory_path() / L"taocode-export-file-test";
    std::error_code error;
    fs::remove_all(base, error);
    fs::create_directories(base, error);
    return base;
}

std::string read_all(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
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

void expect_code(const char* code, const std::function<void()>& body) {
    try {
        body();
    } catch (const WorkspaceError& error) {
        check(error.code == code, std::string("期望 ") + code + "，实际 " + error.code);
        return;
    }
    throw std::runtime_error(std::string("没有抛 ") + code);
}

}  // namespace

int main() {
    run("扩展名白名单：只有 .html/.htm/.txt（大小写不敏感）", [] {
        check(taocode::export_file::allowed_extension("index.html"), "index.html 应放行");
        check(taocode::export_file::allowed_extension("Main.CPP.HTML"), "大写也要放行");
        check(taocode::export_file::allowed_extension("a.htm"), ".htm 也要放行");
        // .txt：错误树/消息视图的文本导出（IDEA Messages 窗口的 Export to text file）。
        check(taocode::export_file::allowed_extension("error-report-20261004-1530.txt"), ".txt 也要放行");
        check(taocode::export_file::allowed_extension("REPORT.TXT"), ".txt 大写也放行");
        check(!taocode::export_file::allowed_extension("main.cpp.html.bak"), "末段不是白名单就不放行");
        check(!taocode::export_file::allowed_extension("notes.md"), "只有白名单里的那几种扩展名");
        check(!taocode::export_file::allowed_extension("main.cpp"), "源码本身不能走这条通道");
        check(!taocode::export_file::allowed_extension("index"), "没有扩展名不放行");
        check(!taocode::export_file::allowed_extension(""), "空名字不放行");
    });

    run("写出一批文件（内容原样往返）", [] {
        const auto root = temp_root();
        const auto first = root / "index.html";
        const auto second = root / "src" / "main.cpp.html";
        fs::create_directories(second.parent_path());
        const auto result = taocode::export_file::write_all({
            {taocode::utf8(first.native()), "<html>甲</html>\n"},
            {taocode::utf8(second.native()), "<html>乙</html>\n"},
        });
        check(result.at("written") == 2, "写了两个");
        check(result.at("paths").size() == 2, "回传两个路径");
        check(read_all(first) == "<html>甲</html>\n", "第一个文件内容要对（UTF-8）");
        check(read_all(second) == "<html>乙</html>\n", "第二个文件内容要对");
        check(result.at("bytes").get<std::int64_t>() > 0, "字节数要大于 0");
    });

    run("非法输入整体拒绝，一个字都不写", [] {
        const auto root = temp_root();
        const auto good = root / "good.html";
        // 写之前先放一个已存在的文件，确认失败时它没被覆盖
        std::ofstream(good, std::ios::binary) << "旧内容";
        // ① 非绝对路径
        expect_code("INVALID_PATH", [&] { taocode::export_file::write_all({{"relative.html", "x"}}); });
        // ② 扩展名不在白名单
        expect_code("INVALID_EXTENSION", [&] { taocode::export_file::write_all({{taocode::utf8(good.native()), "x"}, {taocode::utf8((root / "x.js").native()), "y"}}); });
        // ③ 父目录不存在
        expect_code("NOT_FOUND", [&] { taocode::export_file::write_all({{taocode::utf8((root / "nope" / "a.html").native()), "x"}}); });
        // ④ 目标是目录
        expect_code("INVALID_PATH", [&] { taocode::export_file::write_all({{taocode::utf8(root.native()), "x"}}); });
        // ⑤ 空路径 / 空批次
        expect_code("INVALID_PATH", [&] { taocode::export_file::write_all({{"", "x"}}); });
        expect_code("INVALID_ARGUMENT", [&] { taocode::export_file::write_all({}); });
        check(read_all(good) == "旧内容", "被拒绝的批次不能改动任何已有文件");
    });

    run("上限：条数与总量", [] {
        const auto root = temp_root();
        std::vector<Entry> many;
        for (std::size_t index = 0; index <= taocode::export_file::kMaxFiles; ++index)
            many.push_back({taocode::utf8((root / (std::to_string(index) + ".html")).native()), "x"});
        expect_code("TOO_MANY_FILES", [&] { taocode::export_file::write_all(many); });
        // 单条就超过总量上限
        Entry huge{taocode::utf8((root / "huge.html").native()), std::string(taocode::export_file::kMaxBytes + 1, 'x')};
        expect_code("TOO_LARGE", [&] { taocode::export_file::write_all({huge}); });
        check(!fs::exists(root / "0.html"), "超限的批次也不能写出去");
    });

    std::cout << (failures == 0 ? "export_file: all checks passed\n" : "export_file: failures\n");
    return failures == 0 ? 0 : 1;
}
