// Offline self-test for settings export/import (IDEA ExportImportGroup 的对应物):
// 归档往返、坏归档在**写盘之前**被拒、以及"导入不带最近项目"。
#include "settings_transfer.hpp"

#include "settings_schema.hpp"
#include "text.hpp"
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
using taocode::Json;
using taocode::WorkspaceError;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

fs::path temp_root() {
    const auto base = fs::temp_directory_path() / L"taocode-settings-transfer-test";
    std::error_code error;
    fs::remove_all(base, error);
    fs::create_directories(base, error);
    return base;
}

/** 按任意内容造一个归档，用来测"坏包"的分支。 */
fs::path archive_with(const fs::path& file, const std::string& entry, const std::string& body) {
    taocode::zip::write_archive(file, std::vector<taocode::zip::MemoryEntry>{{entry, body}});
    return file;
}

/** 一份"像真的"应用状态：三段都有内容。 */
Json sample_document() {
    Json document = taocode::empty_document();
    document["settings"]["fontSize"] = 17;
    document["settings"]["uiFontFamily"] = "Inter";
    document["general"]["deleteToBin"] = false;
    document["general"]["inactiveTimeout"] = 42;
    document["recentProjects"] = Json::array({{{"name", "不该被导出"}, {"path", "C:/x"}, {"lastOpened", "2026-01-01"}}});
    document["perProject"] = Json::object({{"C:/projects/demo", {{"excludedDirs", Json::array({"out"})}}}});
    return document;
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
    run("导出 → 导入 往返：三段设置都回来了", [] {
        const auto root = temp_root();
        const auto archive = root / "settings.zip";
        const auto exported = taocode::settings_transfer::export_archive(sample_document(), archive);
        check(fs::is_regular_file(archive), "归档要真的写到磁盘");
        check(exported.at("path").get<std::string>() == taocode::utf8(archive.native()), "返回导出路径");
        check(exported.at("entry").get<std::string>() == taocode::settings_transfer::kEntryName, "条目名固定");
        check(exported.at("bytes").get<std::int64_t>() > 0, "字节数要大于 0");
        check(exported.at("components").size() == 3, "带走三段：settings / general / perProject");

        const auto imported = taocode::settings_transfer::read_archive(archive);
        check(imported.at("settings").at("fontSize") == 17, "编辑器设置要回来");
        check(imported.at("settings").at("uiFontFamily").get<std::string>() == "Inter", "字符串设置也要回来");
        check(imported.at("general").at("deleteToBin") == false, "常规设置要回来（布尔）");
        check(imported.at("general").at("inactiveTimeout") == 42, "数值设置要回来");
        check(imported.at("perProject").size() == 1, "项目级设置要回来");
        check(imported.at("projects") == 1, "projects 计数给人看");
        check(!imported.contains("recentProjects"), "归档里**没有**最近项目 —— 导入不该动它");
    });

    run("归档缺的键由默认值补齐，不认识的键被剪掉", [] {
        const auto root = temp_root();
        const auto archive = root / "partial.zip";
        // 只给一个键，且塞一个不认识的键
        const auto payload = Json{{"format", taocode::settings_transfer::kFormat},
                                  {"version", 1},
                                  {"document", {{"settings", {{"fontSize", 21}, {"notAKey", true}}}}}}.dump();
        archive_with(archive, taocode::settings_transfer::kEntryName, payload);
        const auto imported = taocode::settings_transfer::read_archive(archive);
        check(imported.at("settings").at("fontSize") == 21, "给出的键要生效");
        check(!imported.at("settings").contains("notAKey"), "不认识的键要被剪掉");
        check(imported.at("settings").contains("tabSize"), "段内缺的键由该段的默认值补齐");
        // **没给的段不出现在结果里** ⇒ 导入时那一段保持不动（IDEA 的导入也只换包里有的组件）。
        check(!imported.contains("general") && !imported.contains("perProject"), "没给的段不带出来");
        check(imported.at("projects") == 0, "没有项目段时计数是 0");
        // 一个段都没有的归档 = 没什么可导入的
        const auto nothing = archive_with(root / "nothing.zip", taocode::settings_transfer::kEntryName,
                                         Json{{"format", taocode::settings_transfer::kFormat}, {"version", 1},
                                              {"document", Json::object()}}.dump());
        try {
            taocode::settings_transfer::read_archive(nothing);
            throw std::runtime_error("空归档没有被拒");
        } catch (const WorkspaceError& error) {
            check(error.code == "INVALID_SETTINGS_ARCHIVE", "空归档要报 INVALID_SETTINGS_ARCHIVE");
        }
    });

    run("坏归档在写盘之前被拒", [] {
        const auto root = temp_root();
        // ① 不是 zip
        const auto plain = root / "plain.zip";
        std::ofstream(plain, std::ios::binary) << "这不是 zip";
        expect_code("INVALID_SETTINGS_ARCHIVE", [&] { taocode::settings_transfer::read_archive(plain); });
        // ② 没有那个条目
        const auto foreign = archive_with(root / "foreign.zip", "other.json", "{}");
        expect_code("INVALID_SETTINGS_ARCHIVE", [&] { taocode::settings_transfer::read_archive(foreign); });
        // ③ 条目内容不是 JSON
        const auto broken = archive_with(root / "broken.zip", taocode::settings_transfer::kEntryName, "not json");
        expect_code("INVALID_SETTINGS_ARCHIVE", [&] { taocode::settings_transfer::read_archive(broken); });
        // ④ 缺 format 标记
        const auto unmarked = archive_with(root / "unmarked.zip", taocode::settings_transfer::kEntryName,
                                          Json{{"document", Json::object()}}.dump());
        expect_code("INVALID_SETTINGS_ARCHIVE", [&] { taocode::settings_transfer::read_archive(unmarked); });
        // ⑤ 版本比当前新
        const auto future = archive_with(root / "future.zip", taocode::settings_transfer::kEntryName,
                                        Json{{"format", taocode::settings_transfer::kFormat},
                                             {"version", taocode::settings_transfer::kVersion + 1},
                                             {"document", Json::object()}}.dump());
        expect_code("INVALID_SETTINGS_ARCHIVE", [&] { taocode::settings_transfer::read_archive(future); });
        // ⑥ document 不是对象
        const auto shallow = archive_with(root / "shallow.zip", taocode::settings_transfer::kEntryName,
                                         Json{{"format", taocode::settings_transfer::kFormat}, {"document", 7}}.dump());
        expect_code("INVALID_SETTINGS_ARCHIVE", [&] { taocode::settings_transfer::read_archive(shallow); });
        // ⑦ **内容非法**：段里的键值不合法 ⇒ 必须在写盘前被校验器挡下
        const auto invalid = archive_with(root / "invalid.zip", taocode::settings_transfer::kEntryName,
                                         Json{{"format", taocode::settings_transfer::kFormat},
                                              {"version", 1},
                                              {"document", {{"settings", {{"fontSize", 999}}}}}}.dump());
        expect_code("INVALID_SETTINGS", [&] { taocode::settings_transfer::read_archive(invalid); });
        // ⑧ 项目段里的补丁非法
        const auto bad_project = archive_with(root / "bad-project.zip", taocode::settings_transfer::kEntryName,
                                             Json{{"format", taocode::settings_transfer::kFormat},
                                                  {"version", 1},
                                                  {"document", {{"perProject", {{"C:/x", {{"excludedDirs", Json::array({"a/b"})}}}}}}}}.dump());
        expect_code("INVALID_SETTINGS", [&] { taocode::settings_transfer::read_archive(bad_project); });
        // ⑨ 空路径
        expect_code("INVALID_PATH", [&] { taocode::settings_transfer::read_archive(fs::path()); });
        expect_code("INVALID_PATH", [&] { taocode::settings_transfer::export_archive(sample_document(), fs::path()); });
        expect_code("NOT_FOUND", [&] { taocode::settings_transfer::read_archive(root / "none.zip"); });
    });

    run("归档是人能认出来的：zip 里有且只有那一个 JSON 条目", [] {
        const auto root = temp_root();
        const auto archive = root / "settings.zip";
        taocode::settings_transfer::export_archive(sample_document(), archive);
        const auto entries = taocode::zip::read_archive(archive);
        check(entries.size() == 1, "只有一个条目");
        check(entries[0].first == taocode::settings_transfer::kEntryName, "条目名固定");
        const auto parsed = Json::parse(entries[0].second);
        check(parsed.at("format").get<std::string>() == taocode::settings_transfer::kFormat, "format 标记在");
        check(parsed.at("exportedAt").get<std::string>().size() >= 16, "写了导出时间（用户能分辨新旧包）");
        check(parsed.at("document").at("settings").at("fontSize") == 17, "内容与文档一致");
    });

    std::cout << (failures == 0 ? "settings_transfer: all checks passed\n" : "settings_transfer: failures\n");
    return failures == 0 ? 0 : 1;
}
