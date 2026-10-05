// 本地历史的**行级 unified diff 脚本**（切行 → 出脚本 → 渲染 @@ 块）。
//
// 为什么单独成文件（2026-10-05 模块化体检）：history.cpp 贴着机检上限（1050 行，只剩 30 行余量），
// 而 550-667 那一段与「本地历史」这个域没关系 —— 它不碰目录、句柄、版本索引、指纹，只是一段
// 文本到一段文本的算法。留在 history.cpp 里会让"快照落盘"和"diff 怎么算"两个职责混在一个文件。
//
// 注意与 history.cpp 里留下的**并排差异**（tokenize / word_marks / side_rows）是两个算法：
// 那一个按词标出两侧的 [start,length] 字节区间（给并排视图上色），这一个只出 unified 文本。
// 两者共用的只有 Row 与 split_lines，所以只有它们进这个头。
#pragma once

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace taocode::history {

/** unified 脚本的一行。`a` / `b` 是两侧的行号游标（新增行是插入位置，删除行 `b` 停在原地）。 */
struct Row {
    char kind;            // ' ' 上下文，'-' 删除，'+' 新增
    std::string_view text;
    std::size_t a;        // 该行的 a 游标：0 起行号，新增行是插入位置
    std::size_t b;
    std::size_t hunk = 0;   // 增删段不得跨块配对（unified 解析器按 @@ 递增）
};

/** LCS 动态规划预算（方向表约 (a+1)*(b+1) 字节）。超预算时退化为整段替换/整块标红，
 *  输出仍是合法的 diff，但不会为巨型文件分配上百 MB 内存。
 *  两个 diff 算法（这里的 unified 脚本与 history.cpp 里的并排词级标注）共用这一个口径。 */
inline constexpr std::size_t diff_cell_budget = 8'000'000;

/** 去掉行尾的 '\r'（文本是 CRLF 也不该让每一行都多一个字符）。切行与 unified 解析共用这一个。 */
std::string_view trim_cr(std::string_view line);

/** 按 '\n' 切开并去掉每行行尾的 '\r'。 */
std::vector<std::string_view> split_lines(std::string_view text);

/** 两侧行 → 脚本（上下文 / 删除 / 新增，带 a、b 游标与 hunk 号）。 */
std::vector<Row> build_script(const std::vector<std::string_view>& a, const std::vector<std::string_view>& b);

/** 脚本 → unified 文本（含 @@ -a,b +c,d @@ 头与尾部的 '\ No newline' 标记）。 */
std::string render_hunks(const std::vector<Row>& script);

}  // namespace taocode::history
