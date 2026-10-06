// 编辑器设置里**新增那几键**的校验，加上「语言 id -> 布尔」那张表 —— 从 `native/settings_schema.cpp` 搬出（2026-10-06）。
//
// 为什么单独开一个头文件：`settings_schema.cpp` 现在 1099 行，贴着 native 的 1100 行机检上限
// （`tests/module-size.test.mjs` 钉死，只许拆不许升），而这一批要落 10 把键（保存时两条 pass、
// 回车与引号的三个开关、Code Vision 的四把）。把校验分支与 `validate_language_flags` 搬进来，
// `.cpp` 里只留一个调用点。**头文件不进 `CMakeLists.txt`**（那里只列 .cpp），所以这次拆模块
// 不需要动那个保留文件。
//
// 与旧存档的关系（本仓真出过把用户锁在项目外的事故）：读盘那一条链是
// `project_settings_state.cpp:39-49` —— `prune_unknown` 剪掉未知键（**不判损坏**）→
// `validate_editor_patch` 严格校验剩下的键 → 按 `editor_defaults_impl()` **逐键补默认**。
// 所以新增键只要 ① 在白名单里、② 在默认值表里、③ 不是布尔时这里有分支，旧存档一律读得回来；
// 缺 ③ 的话旧存档**不会**坏（它没有这些键），但新存档存进去后再读就被"必须是布尔"那条兜底判坏。
#pragma once

#include "fsops.hpp"      // fail(code, message)
#include "workspace.hpp"  // Json

#include <algorithm>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace taocode {

// TaoCode 能高亮/索引的语言集合，与 templates.ts / fileAssociations 用的是同一份。
inline constexpr std::string_view editor_languages[]{"java", "cpp", "typescript", "other"};

// 「语言 id -> 布尔」表：只存被显式配置过的语言，没进表=默认（源码 mapLanguageBreadcrumbs
// 的语义，EditorSettingsExternalizable.java:146-152 + isBreadcrumbsShownFor :459-466）。
inline void validate_language_flags(const Json& value, const char* name) {
    if (!value.is_object()) fail("INVALID_SETTINGS", std::string(name) + " must be an object of language flags.");
    if (value.size() > 32) fail("INVALID_SETTINGS", std::string(name) + " 的条目过多。");
    for (auto it = value.begin(); it != value.end(); ++it) {
        const auto id = it.key();
        if (std::find(std::begin(editor_languages), std::end(editor_languages), std::string_view(id)) == std::end(editor_languages))
            fail("INVALID_SETTINGS", std::string(name) + " 里有未知语言：" + id);
        if (!it.value().is_boolean())
            fail("INVALID_SETTINGS", std::string(name) + " 的值必须是布尔值。");
    }
}

// 本批新增、且**不是布尔**的那几把编辑器键。命中就校验并返回 true；没命中返回 false，
// 由调用方 `validate_editor_patch` 末尾那条"Editor flags must be JSON booleans"兜底接手
// （新增的 7 把布尔键正是走那条兜底，不需要在这里加分支）。
inline bool validate_editor_added_key(const std::string& key, const Json& value) {
    // stripTrailingSpaces：三档字面值照抄上游常量（EditorSettingsExternalizable.java:216-218 =
    // "None" / "Changed" / "Whole"，默认 :73 的 Changed）。消费方 src/editorSaveTransforms.ts。
    if (key == "stripTrailingSpaces") {
        const auto mode = value.is_string() ? value.get<std::string>() : std::string();
        if (mode != "None" && mode != "Changed" && mode != "Whole")
            fail("INVALID_SETTINGS", "stripTrailingSpaces must be None, Changed or Whole.");
        return true;
    }
    // codeVisionVisibleEntries：出厂 5（CodeVisionSettings.kt:38-39 的两个 visibleMetrics*Count），
    // 界 1..10 = 上游那一格自己的 spinner 范围（CodeVisionGlobalSettingsProvider.kt:43 的 `spinner(1..10, 1)`）。
    if (key == "codeVisionVisibleEntries") {
        if (!value.is_number_integer() || value.get<int>() < 1 || value.get<int>() > 10)
            fail("INVALID_SETTINGS", "codeVisionVisibleEntries must be an integer from 1 through 10.");
        return true;
    }
    // Code Vision 的两个组集合（CodeVisionSettings.kt:45 `disabledCodeVisionProviderIds` 与 :50
    // `enabledCodeVisionProviderIds`）：**只装与出厂相反的那一半**，空数组是正常默认态。
    // 条目必须是本仓已知的组 id（两组，src/codeLensSettings.ts:48-50）；上限 8 只是挡住无限追加。
    if (key == "codeVisionDisabledGroups" || key == "codeVisionEnabledGroups") {
        if (!value.is_array() || value.size() > 8)
            fail("INVALID_SETTINGS", key + " must be an array of at most 8 Code Vision group ids.");
        for (const auto& entry : value) {
            if (!entry.is_string()) fail("INVALID_SETTINGS", key + " 的条目必须是组 id 字符串。");
            const auto id = entry.get<std::string>();
            if (id != "LspCodeVisionProvider" && id != "problems")
                fail("INVALID_SETTINGS", "Unknown Code Vision group: " + id);
        }
        return true;
    }
    return false;
}

} // namespace taocode
