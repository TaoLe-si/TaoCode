// Offline self-test for `native/settings_editor_keys.hpp` —— 编辑器设置里**非布尔**那几键的校验分支。
//
// 为什么单开一份而不并进 `native/projects_test.cpp`：那份 1298 行，贴着 native 测试的 1300 行
// 机检上限（`tests/module-size.test.mjs`），一行都塞不进去。
//
// 为什么这一族必须**在原生侧**有牙：`src/previewSettings.ts` 只是同一条规则的第二道关卡
// （浏览器预览态没有原生那一侧），桌面端真正的闸是这里 —— 读盘那一条链
// （`project_settings_state.cpp` 的 prune_unknown → validate_editor_patch → 逐键补默认）
// 也走这里。Code Vision 的两个组集合尤其：运行时那张表由编辑器里右键「隐藏这一组」直接写
// （`src/codeLensSettings.ts` 的 `handleCodeVisionExtraAction` 不查白名单），白名单少列一组，
// 那一次右键之后**整本编辑器设置**都会在这里被判 INVALID_SETTINGS —— 存的不是那一组，是全部。
//
// 四个组 id 的出处（逐条在参考树打开过）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/codeVision/settings/PlatformCodeVisionIds.kt:5-7`
//     = `USAGES("references")` / `INHERITORS("inheritors")` / `PROBLEMS("problems")`；
//   · `platform/lsp-impl/src/impl/features/codeLens/LspCodeVisionProvider.kt:20`
//     = `LSP_CODE_VISION_PROVIDER_ID = "LspCodeVisionProvider"`（服务端 lens 全挂这一组）。
// 前端同源的那一份在 `src/codeLensSettings.ts` 的 `CODE_VISION_GROUP_IDS`，判据：
// `tests/code-lens-grouping.test.mjs`。
#include "settings_schema.hpp"

#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

using taocode::Json;
using taocode::WorkspaceError;

int failures = 0;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

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

/** 只带这一键的一份补丁：命中 `validate_editor_added_key` 的那个分支，其余键不参与判定。 */
Json one(const char* key, const Json& value) { return Json{{key, value}}; }

const char* const group_keys[] = {"codeVisionDisabledGroups", "codeVisionEnabledGroups"};
/** 本仓真会渲染出条目的四组（与 `CODE_VISION_GROUP_IDS` 逐字相同）。 */
const char* const known_groups[] = {"LspCodeVisionProvider", "problems", "references", "inheritors"};

} // namespace

int main() {
    run("Code Vision 的四个组 id 全部放行（少一个 = 右键隐藏那一组之后整个设置存不下去）", [] {
        for (const auto* key : group_keys)
            for (const auto* group : known_groups)
                taocode::validate_editor_patch(one(key, Json::array({group})));
        // 四组一起关（数组上限之内、顺序不限）也要过。
        taocode::validate_editor_patch(one("codeVisionDisabledGroups",
            Json::array({known_groups[0], known_groups[1], known_groups[2], known_groups[3]})));
        // 空数组是正常默认态（上游那两个 TreeSet 只装"与出厂相反"的那一半，出厂都开 ⇒ 空）。
        for (const auto* key : group_keys) taocode::validate_editor_patch(one(key, Json::array()));
    });

    run("未知组 / 非字符串条目 / 不是数组 / 超过 8 条，一律 INVALID_SETTINGS", [] {
        for (const auto* key : group_keys) {
            // 上游真实的 provider id（`JavaReferencesCodeVisionProvider.kt:17` 的 "java.references"）
            // 本仓不产出这一组 ⇒ 照旧拒：放开白名单不等于取消白名单。
            expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one(key, Json::array({"java.references"}))); });
            expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one(key, Json::array({1}))); });
            expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one(key, Json::array({nullptr}))); });
            expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one(key, std::string("problems"))); });
            expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one(key, Json::object())); });
            expect_code("INVALID_SETTINGS", [&] {
                taocode::validate_editor_patch(one(key, Json::array({"a", "b", "c", "d", "e", "f", "g", "h", "problems"})));
            });
        }
    });

    run("codeVisionVisibleEntries 的界 1..10（上游 spinner(1..10, 1)），出厂 5", [] {
        for (const int value : {1, 5, 10}) taocode::validate_editor_patch(one("codeVisionVisibleEntries", value));
        for (const int value : {0, -1, 11, 100})
            expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one("codeVisionVisibleEntries", value)); });
        expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one("codeVisionVisibleEntries", 2.5)); });
        expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one("codeVisionVisibleEntries", std::string("5"))); });
        expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one("codeVisionVisibleEntries", true)); });
    });

    run("总闸与两组集合互不干扰：布尔键走布尔那条，组集合走集合那条", [] {
        taocode::validate_editor_patch(Json{{"codeVisionEnabled", false},
                                            {"codeVisionDisabledGroups", Json::array({"references"})}});
        expect_code("INVALID_SETTINGS", [&] {
            taocode::validate_editor_patch(Json{{"codeVisionEnabled", std::string("false")},
                                                {"codeVisionDisabledGroups", Json::array({"references"})}});
        });
    });

    run("stripTrailingSpaces 的三档字面值（EditorSettingsExternalizable.java:216-218）没被这次改动带歪", [] {
        for (const auto* mode : {"None", "Changed", "Whole"})
            taocode::validate_editor_patch(one("stripTrailingSpaces", std::string(mode)));
        expect_code("INVALID_SETTINGS", [] { taocode::validate_editor_patch(one("stripTrailingSpaces", std::string("modified"))); });
    });

    // 2026-10-08 lane lp-editor：参数提示的排除清单（`ParameterHintsSettingsPanel.kt:18-22` 那个入口，
    // 键名唯一定义处 src/inlayHints.ts 的 INLAY_HINT_EXCLUDE_LIST_SETTING_KEY）。
    run("parameterHintExcludeList：空数组与正常清单放行，形状坏的一律 INVALID_SETTINGS", [] {
        // 出厂档是空数组（native 默认值与前端 defaultEditorSettings 都是 []）。
        taocode::validate_editor_patch(one("parameterHintExcludeList", Json::array()));
        taocode::validate_editor_patch(one("parameterHintExcludeList", Json::array({"println", "log*", "*Args*", "(key)"})));
        // 上限 32 条（与前端 previewSettings.ts 那条同形；32 放行、33 拒）。
        Json many = Json::array();
        for (int index = 0; index < 32; ++index) many.push_back("p" + std::to_string(index));
        taocode::validate_editor_patch(one("parameterHintExcludeList", many));
        many.push_back("p32");
        expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one("parameterHintExcludeList", many)); });
        // 形状坏的四档：不是数组 / 非字符串条目 / 空条目 / 单条超 200 字节。
        expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one("parameterHintExcludeList", std::string("println"))); });
        expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one("parameterHintExcludeList", Json::array({1}))); });
        expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one("parameterHintExcludeList", Json::array({""}))); });
        expect_code("INVALID_SETTINGS", [&] { taocode::validate_editor_patch(one("parameterHintExcludeList", Json::array({std::string(201, 'x')}))); });
        // 编译不了的模式（三个星号 / 星号在中间）**不算形状坏**：上游对坏模式的口径是静默作废
        // （ParameterHintExcludeListService.kt:96 的 mapNotNull），盘上一条坏行不该让整份存档判坏。
        taocode::validate_editor_patch(one("parameterHintExcludeList", Json::array({"a*b*c", "mid*star*here*more"})));
    });

    std::cout << (failures == 0 ? "settings_editor_keys: all checks passed\n"
                                : "settings_editor_keys: " + std::to_string(failures) + " check(s) failed\n");
    return failures == 0 ? 0 : 1;
}
