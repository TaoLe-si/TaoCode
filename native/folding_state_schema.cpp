// 折叠状态落盘的校验（`ProjectSettings.foldingState`）。
//
// 上游把这份状态写进 workspace 文件：`DocumentFoldingInfo.writeExternal`（:260-295）按文档写
// `<marker from:to date=文件时间戳 ph=占位符 expanded=…>`，`readExternal`（:297-368）读回来时
// **时间戳对不上就丢**（`:333`：文件在磁盘上改过 / 文档还是脏的 ⇒ 不恢复）。
// 本仓存在项目级设置那一段（`projects.json` → `perProject[项目]`），形状是
//     { "<项目内相对路径>": [ { "from": 1, "to": 9, "expanded": false, "signature": "static int one() {" }, … ] }
// 时间戳的替身就是 `signature`（轻签名 = 起点那行的原文，见 src/editorFoldingState.ts）；
// 这里只做**形状与上限**的校验 —— 上限是必须的：整份应用状态有 1 MiB 的硬上限
// （`project_settings_state.cpp` 的 `state_limit`），折叠状态是唯一会随项目规模线性长的字段。
#include "folding_state_schema.hpp"
#include "fsops.hpp"   // valid_utf8（数据校验与路径共用同一份定义）

#include <string>

// 上限：50 个文件 × 每个 40 条。按最坏情况估（路径 512 + 签名 96 + 两个整数 + 键名 ≈ 700 字节/条）
// 也只到 ~1.4 MB 的**理论上限**，所以前端还要按"最近动过的"裁剪到 200 KB 量级（见 src/editorFoldingState.ts
// 的 LIMITS），这里的数字是最后一道闸，不是配额。
namespace taocode {
namespace {

constexpr std::size_t max_files = 50;
constexpr std::size_t max_entries = 40;
constexpr std::size_t max_signature = 96;
constexpr std::size_t max_path = 512;

} // namespace

void validate_folding_state(const Json& value) {
    if (!value.is_object()) fail("INVALID_SETTINGS", "foldingState 必须是「路径 → 折叠条目」的对象。");
    if (value.size() > max_files)
        fail("INVALID_SETTINGS", "foldingState 最多记 " + std::to_string(max_files) + " 个文件。");
    for (auto file = value.begin(); file != value.end(); ++file) {
        const auto& path = file.key();
        if (path.empty() || path.size() > max_path || !valid_utf8(path))
            fail("INVALID_SETTINGS", "foldingState 的键是项目内相对路径（不超过 512 字节的 UTF-8）。");
        // `..` 不许出现：这份状态跟着项目走，路径要留在项目里（与 projects.cpp 对相对路径的规矩一致）。
        if (path.find("..") != std::string::npos)
            fail("INVALID_SETTINGS", "foldingState 的路径不能含 \"..\"。");
        const auto& entries = file.value();
        if (!entries.is_array()) fail("INVALID_SETTINGS", "foldingState 的每一格都是数组。");
        if (entries.size() > max_entries)
            fail("INVALID_SETTINGS", "一个文件最多记 " + std::to_string(max_entries) + " 条折叠。");
        for (const auto& entry : entries) {
            if (!entry.is_object()) fail("INVALID_SETTINGS", "折叠条目要是对象。");
            known_keys(entry, {"from", "to", "expanded", "signature"}, "INVALID_SETTINGS");
            if (!entry.contains("from") || !entry.contains("to") || !entry.contains("expanded"))
                fail("INVALID_SETTINGS", "折叠条目要带 from / to / expanded。");
            const auto& from = entry.at("from");
            const auto& to = entry.at("to");
            // 判 `is_number_integer()` 而不是 `is_number_unsigned()`：同一份 JSON 从文本解析进来是
            // unsigned、在原生里用整数字面量构造出来是 signed（前者是真路径，后者是回归用例），
            // 两者都该收；负数与小数照样拒。
            if (!from.is_number_integer() || !to.is_number_integer()
                || from.get<std::int64_t>() < 0 || to.get<std::int64_t>() < 0
                || from.get<std::int64_t>() >= to.get<std::int64_t>())
                fail("INVALID_SETTINGS", "折叠条目的 from/to 要是非负整数且 from < to。");
            if (!entry.at("expanded").is_boolean()) fail("INVALID_SETTINGS", "折叠条目的 expanded 要是布尔值。");
            if (entry.contains("signature")) {
                const auto& signature = entry.at("signature");
                if (!signature.is_string()) fail("INVALID_SETTINGS", "折叠条目的 signature 要是字符串。");
                const auto& text = signature.get_ref<const std::string&>();
                if (text.size() > max_signature || !valid_utf8(text))
                    fail("INVALID_SETTINGS", "折叠条目的 signature 不超过 96 字节且要是 UTF-8。");
            }
        }
    }
}

} // namespace taocode
