// 本地历史的**并排差异**：把同一条行级脚本（`history_diff.hpp` 的 `Row`）折叠成
// 左右对齐的行，并给 change 行标出词级差异的字节区间，供并排视图上色。
//
// 为什么单独成文件（2026-10-06 模块化体检）：这一段（tokenize / word_marks / side_rows /
// diff_sides_from_unified，约 210 行）与 history.cpp 的「快照落盘 / 版本索引 / 指纹」不共职责 ——
// 它不碰目录、句柄、版本索引，只吃 Row 与 split_lines，是一个独立的算法域。
// 与 history_diff.cpp 的分工：那一个把脚本渲染成 unified 文本，这一个把脚本摊成并排行，
// 两者只共用 Row / split_lines / diff_cell_budget（都在 history_diff.hpp）。
#pragma once

#include <string>
#include <vector>

#include "history_diff.hpp"     // Row / split_lines / diff_cell_budget
#include "workspace.hpp"        // taocode::Json

namespace taocode::history {

/** 行脚本 → 左右对齐的并排差异。
 *  {rows:[{kind:'equal'|'insert'|'delete'|'change', left:{no,text}?, right:{no,text}?,
 *          leftMarks?:[[start,len]], rightMarks?:[[start,len]]}], truncated:bool}
 *  行号 1 起；change 行带词级差异区间（字节偏移）。 */
Json side_rows(const std::vector<Row>& script);

/** 同上，但输入是 git diff 的 unified 文本：把它还原成同样的行脚本，Git 侧因此不需要
 *  再读工作区文件（避免重复处理长路径/前缀），也不会与 unified 视图给出两种答案。 */
Json diff_sides_from_unified(const std::string& text);

}  // namespace taocode::history