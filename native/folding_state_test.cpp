// 折叠状态落盘的校验（`foldingState`）的原生回归。
//
// 为什么单独一个可执行文件：校验规则是「形状 + 上限」（整份应用状态有 1 MiB 硬上限，折叠状态是唯一
// 会随项目规模线性长的字段），与项目设置本体的规则不是同一件事；混进 projects_test.cpp 只会让两边都变长。
// 夹具在 project_test_support.hpp（只用到 check/expect_error/Report）。
#include "project_test_support.hpp"
#include "folding_state_schema.hpp"

namespace {

using namespace taocode;
using taocode::test::expect_error;
using taocode::test::Report;

Json entry(Json::object_t fields) { return Json(std::move(fields)); }

Json valid_state() {
    return Json(Json::object_t{
        {"src/Main.java", Json::array({
            entry({{"from", 3}, {"to", 9}, {"expanded", false}, {"signature", "static int one() {"}}),
            entry({{"from", 20}, {"to", 24}, {"expanded", true}}),
        })},
        {"README.md", Json::array()},
    });
}

} // namespace

int main() {
    Report report;
    const auto run = [&](const char* name, auto&& operation) { report.run(name, std::forward<decltype(operation)>(operation)); };

    run("accepts a well-formed folding state", [&] {
        taocode::validate_folding_state(valid_state());
        taocode::validate_folding_state(Json(Json::object_t{}));   // 空表也合法（没折过任何东西）
    });

    run("rejects non-objects and non-array entries", [&] {
        for (const auto& bad : {Json(Json::array()), Json("x"), Json(7), Json(nullptr)}) {
            expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(bad); });
        }
        expect_error("INVALID_SETTINGS", [&] {
            taocode::validate_folding_state(Json(Json::object_t{{"src/Main.java", Json(7)}}));
        });
    });

    run("entry shape: from/to/expanded required, from < to, unsigned", [&] {
        const auto with_entry = [](Json one) { return Json(Json::object_t{{"a.java", Json::array({std::move(one)})}}); };
        // 缺字段
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_entry(entry({{"from", 1}, {"to", 2}}))); });
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_entry(entry({{"from", 1}, {"expanded", false}}))); });
        // from >= to
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_entry(entry({{"from", 5}, {"to", 5}, {"expanded", false}}))); });
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_entry(entry({{"from", 9}, {"to", 2}, {"expanded", false}}))); });
        // 负数（unsigned 之外）
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_entry(entry({{"from", -1}, {"to", 2}, {"expanded", false}}))); });
        // expanded 不是布尔
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_entry(entry({{"from", 1}, {"to", 2}, {"expanded", "no"}}))); });
        // 多余的键
        expect_error("INVALID_SETTINGS", [&] {
            taocode::validate_folding_state(with_entry(entry({{"from", 1}, {"to", 2}, {"expanded", false}, {"extra", 1}})));
        });
    });

    run("signature is optional but bounded and UTF-8", [&] {
        const auto with_signature = [](std::string signature) {
            return Json(Json::object_t{{"a.java", Json::array({entry({{"from", 1}, {"to", 2}, {"expanded", false}, {"signature", signature}})})}});
        };
        taocode::validate_folding_state(with_signature("x"));
        taocode::validate_folding_state(with_signature(""));   // 空签名合法（恢复时匹配不上任何块而已）
        taocode::validate_folding_state(with_signature(std::string(96, 'x')));   // 正好到上限
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_signature(std::string(97, 'x'))); });
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_signature("\xFF\xFE")); });
    });

    run("paths stay inside the project and within bounds", [&] {
        const auto with_path = [](std::string path) {
            return Json(Json::object_t{{path, Json::array()}});
        };
        taocode::validate_folding_state(with_path("src/deep/Main.java"));
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_path("")); });
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_path(std::string(513, 'a'))); });
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_path("../outside.java")); });
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(with_path("src/\xFF\xFE.java")); });
    });

    run("caps: 50 files, 40 entries each", [&] {
        Json many_files(Json::object_t{});
        for (int i = 0; i < 50; ++i) many_files["f" + std::to_string(i) + ".java"] = Json::array();
        taocode::validate_folding_state(many_files);
        many_files["one-more.java"] = Json::array();
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(many_files); });

        Json many_entries(Json::array());
        for (int i = 0; i < 40; ++i) many_entries.push_back(entry({{"from", i * 2}, {"to", i * 2 + 1}, {"expanded", false}}));
        taocode::validate_folding_state(Json(Json::object_t{{"a.java", many_entries}}));
        many_entries.push_back(entry({{"from", 100}, {"to", 101}, {"expanded", false}}));
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_folding_state(Json(Json::object_t{{"a.java", many_entries}})); });
    });

    run("the project patch accepts foldingState and still rejects unknown keys", [&] {
        Json patch(Json::object_t{{"excludedDirs", Json::array()}, {"foldingState", valid_state()}});
        taocode::validate_project_patch(patch);
        Json broken(Json::object_t{{"excludedDirs", Json::array()}, {"foldingState", Json(7)}});
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_project_patch(broken); });
        Json unknown(Json::object_t{{"excludedDirs", Json::array()}, {"foldState", Json(Json::object_t{})}});
        expect_error("INVALID_SETTINGS", [&] { taocode::validate_project_patch(unknown); });
    });

    return report.summary();
}
