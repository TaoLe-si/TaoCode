// 行级 unified diff 脚本（见 history_diff.hpp 的说明）。
//
// 2026-10-05 从 native/history.cpp 整段搬出（那边贴着 1050 行机检上限）。
// 搬动时**实现一个字没改**：下面 117 行与 history.cpp 里原来的逐字相同。

#include "history_diff.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace taocode::history {

// ---- 行级 unified diff ------------------------------------------------------------

std::string_view trim_cr(std::string_view line) {
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
    return line;
}

std::vector<std::string_view> split_lines(std::string_view text) {
    std::vector<std::string_view> lines;
    std::size_t start = 0;
    for (;;) {
        const auto end = text.find('\n', start);
        if (end == std::string_view::npos) {
            if (start < text.size()) lines.push_back(trim_cr(text.substr(start)));
            return lines;
        }
        lines.push_back(trim_cr(text.substr(start, end - start)));
        start = end + 1;
    }
}

// @@ 块前后各留几行上下文（从 history.cpp 的匿名命名空间逐字搬来：它只被下面的 render_hunks 用）。
constexpr std::size_t diff_context = 3;

// 标准 LCS 回溯；先剥离公共前后缀，让常见编辑只对小窗口做动态规划。
std::vector<Row> build_script(const std::vector<std::string_view>& a,
                              const std::vector<std::string_view>& b) {
    std::size_t head = 0;
    while (head < a.size() && head < b.size() && a[head] == b[head]) ++head;
    std::size_t tail = 0;
    while (tail + head < a.size() && tail + head < b.size() &&
           a[a.size() - 1 - tail] == b[b.size() - 1 - tail]) ++tail;
    const std::size_t n = a.size() - head - tail;
    const std::size_t m = b.size() - head - tail;

    std::vector<Row> script;
    script.reserve(a.size() + 1);
    for (std::size_t i = 0; i < head; ++i) script.push_back({' ', a[i], i, i});

    const bool feasible = n == 0 || m == 0 || n + 1 <= diff_cell_budget / (m + 1);
    std::vector<std::uint8_t> direction;
    if (feasible) {
        direction.assign((n + 1) * (m + 1), 0);
        std::vector<std::uint32_t> next(m + 1, 0);
        std::vector<std::uint32_t> current(m + 1, 0);
        for (std::size_t i = n; i-- > 0;) {
            current[m] = 0;
            for (std::size_t j = m; j-- > 0;) {
                std::uint8_t move = 0;
                std::uint32_t length = 0;
                if (a[head + i] == b[head + j]) { move = 1; length = next[j + 1] + 1; }
                else if (next[j] >= current[j + 1]) { move = 2; length = next[j]; }
                else { move = 3; length = current[j + 1]; }
                direction[i * (m + 1) + j] = move;
                current[j] = length;
            }
            next.swap(current);
        }
    }
    // 超预算时 move 恒为 2：先删空 a 的中间段，再整体插入 b 的中间段。
    std::size_t i = 0;
    std::size_t j = 0;
    while (i < n && j < m) {
        const auto move = feasible ? direction[i * (m + 1) + j] : std::uint8_t{2};
        if (move == 1) { script.push_back({' ', a[head + i], head + i, head + j}); ++i; ++j; }
        else if (move == 2) { script.push_back({'-', a[head + i], head + i, head + j}); ++i; }
        else { script.push_back({'+', b[head + j], head + i, head + j}); ++j; }
    }
    while (i < n) { script.push_back({'-', a[head + i], head + i, head + j}); ++i; }
    while (j < m) { script.push_back({'+', b[head + j], head + i, head + j}); ++j; }
    for (std::size_t k = 0; k < tail; ++k) {
        const std::size_t ai = a.size() - tail + k;
        const std::size_t bi = b.size() - tail + k;
        script.push_back({' ', a[ai], ai, bi});
    }
    return script;
}

std::string render_hunks(const std::vector<Row>& script) {
    std::vector<char> keep(script.size(), 0);
    for (std::size_t index = 0; index < script.size(); ++index) {
        if (script[index].kind == ' ') continue;
        const std::size_t from = index > diff_context ? index - diff_context : 0;
        const std::size_t to = index + diff_context < script.size() ? index + diff_context : script.size() - 1;
        for (std::size_t k = from; k <= to; ++k) keep[k] = 1;
    }
    std::string out;
    std::size_t index = 0;
    while (index < script.size()) {
        if (!keep[index]) { ++index; continue; }
        const std::size_t begin = index;
        while (index < script.size() && keep[index]) ++index;
        std::size_t a_count = 0;
        std::size_t b_count = 0;
        for (std::size_t k = begin; k < index; ++k) {
            if (script[k].kind != '+') ++a_count;
            if (script[k].kind != '-') ++b_count;
        }
        // 纯新增/纯删除的块按 git 惯例报告“插入发生在哪一行之后”。
        const std::size_t a_start = a_count ? script[begin].a + 1 : script[begin].a;
        const std::size_t b_start = b_count ? script[begin].b + 1 : script[begin].b;
        char header[96];
        std::snprintf(header, sizeof(header), "@@ -%zu,%zu +%zu,%zu @@\n",
                      a_start, a_count, b_start, b_count);
        out += header;
        for (std::size_t k = begin; k < index; ++k) {
            out.push_back(script[k].kind);
            out.append(script[k].text);
            out.push_back('\n');
        }
    }
    return out;
}

}  // namespace taocode::history
