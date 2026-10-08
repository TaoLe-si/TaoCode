// 本地历史的并排差异实现。声明与「为什么单独成文件」见 history_sides.hpp。
#include "history_sides.hpp"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <string_view>
#include <utility>
#include <vector>

namespace taocode::history {
namespace {

constexpr std::size_t max_side_rows = 20000;   // 行数上限，超出即截断而不是无限分配

// 词法切分：字母数字下划线 / 空白 / 其它单字符，各自成一个 token，并记录字节偏移。
std::vector<std::pair<std::size_t, std::string_view>> tokenize(std::string_view line) {
    std::vector<std::pair<std::size_t, std::string_view>> tokens;
    std::size_t index = 0;
    while (index < line.size()) {
        const unsigned char ch = static_cast<unsigned char>(line[index]);
        const bool word = std::isalnum(ch) || ch == '_';
        const bool space = ch == ' ' || ch == '\t';
        std::size_t end = index + 1;
        if (word || space) {
            while (end < line.size()) {
                const unsigned char next = static_cast<unsigned char>(line[end]);
                const bool next_word = std::isalnum(next) || next == '_';
                const bool next_space = next == ' ' || next == '\t';
                if (word ? !next_word : !next_space) break;
                ++end;
            }
        }
        tokens.emplace_back(index, line.substr(index, end - index));
        index = end;
    }
    return tokens;
}

// 两行之间的词级差异：把不同的 token 段合并成 [起点, 长度] 区间，左右各一份。
void word_marks(std::string_view left, std::string_view right, Json& left_out, Json& right_out) {
    const auto a = tokenize(left);
    const auto b = tokenize(right);
    const std::size_t n = a.size();
    const std::size_t m = b.size();
    if (n == 0 && m == 0) return;
    const bool feasible = n == 0 || m == 0 || n + 1 <= diff_cell_budget / (m + 1);
    std::vector<std::uint8_t> direction;
    if (feasible) {
        direction.assign((n + 1) * (m + 1), 0);
        std::vector<std::uint32_t> next(m + 1, 0);
        std::vector<std::uint32_t> current(m + 1, 0);
        for (std::size_t i = n; i-- > 0;) {
            for (std::size_t j = m; j-- > 0;) {
                std::uint8_t move = 0;
                std::uint32_t length = 0;
                if (a[i].second == b[j].second) { move = 1; length = next[j + 1] + 1; }
                else if (next[j] >= current[j + 1]) { move = 2; length = next[j]; }
                else { move = 3; length = current[j + 1]; }
                direction[i * (m + 1) + j] = move;
                current[j] = length;
            }
            next.swap(current);
        }
    }
    // 收集差异 token 的下标段，再换算成字节区间。
    std::vector<std::pair<std::size_t, std::size_t>> a_runs, b_runs;   // [first, last)
    std::size_t i = 0;
    std::size_t j = 0;
    auto flush = [](std::vector<std::pair<std::size_t, std::size_t>>& runs, std::size_t& begin, std::size_t& end) {
        if (begin == std::string_view::npos) return;
        runs.emplace_back(begin, end);
        begin = std::string_view::npos;
    };
    std::size_t a_begin = std::string_view::npos, a_end = 0;
    std::size_t b_begin = std::string_view::npos, b_end = 0;
    while (i < n && j < m) {
        const auto move = feasible ? direction[i * (m + 1) + j] : std::uint8_t{0};
        if (move == 1) {
            flush(a_runs, a_begin, a_end);
            flush(b_runs, b_begin, b_end);
            ++i; ++j;
        } else if (move == 2) {
            if (a_begin == std::string_view::npos) a_begin = i;
            a_end = i + 1;
            ++i;
        } else {
            if (b_begin == std::string_view::npos) b_begin = j;
            b_end = j + 1;
            ++j;
        }
    }
    if (i < n) { if (a_begin == std::string_view::npos) a_begin = i; a_end = n; }
    if (j < m) { if (b_begin == std::string_view::npos) b_begin = j; b_end = m; }
    flush(a_runs, a_begin, a_end);
    flush(b_runs, b_begin, b_end);
    auto emit = [&](const std::vector<std::pair<std::size_t, std::size_t>>& runs,
                    const std::vector<std::pair<std::size_t, std::string_view>>& tokens,
                    std::string_view text, Json& out) {
        auto blank = [](std::string_view token) {
            return !token.empty() && (token.front() == ' ' || token.front() == '\t');
        };
        for (const auto& [first, last] : runs) {
            if (first >= tokens.size() || last > tokens.size() || last <= first) continue;
            // 只含空白的首/尾 token 从标记里去掉，"hello"→"hello world" 只圈住新增的
            // 词；整段都是空白（纯缩进改动）时保持原样，否则用户看不到改动。
            std::size_t begin = first, stop = last;
            while (begin + 1 < stop && blank(tokens[begin].second)) ++begin;
            while (stop - 1 > begin && blank(tokens[stop - 1].second)) --stop;
            const auto start = tokens[begin].first;
            const auto end = tokens[stop - 1].first + tokens[stop - 1].second.size();
            if (end > text.size()) continue;
            out.push_back(Json::array({start, end - start}));
        }
    };
    emit(a_runs, a, left, left_out);
    emit(b_runs, b, right, right_out);
}

Json side(std::size_t line_1based, std::string_view text) {
    return Json{{"no", line_1based}, {"text", std::string(text)}};
}

}  // namespace

Json side_rows(const std::vector<Row>& script) {
    Json rows = Json::array();
    bool truncated = false;
    std::size_t index = 0;
    while (index < script.size()) {
        if (rows.size() >= max_side_rows) { truncated = true; break; }
        if (script[index].kind == ' ') {
            const auto& row = script[index];
            rows.push_back(Json{{"kind", "equal"},
                                {"left", side(row.a + 1, row.text)},
                                {"right", side(row.b + 1, row.text)}});
            ++index;
            continue;
        }
        // 一段连续的增删：按顺序配对成 change 行，多出来的仍是纯删/纯增。
        std::size_t scan = index;
        // 只在同一块内配对：跨块的删除与新增毫无关系，配到一起会同时给出
        // 错误的行号和错误的对照。
        while (scan < script.size() && script[scan].kind != ' ' && script[scan].hunk == script[index].hunk) ++scan;
        std::vector<const Row*> dels, adds;
        for (std::size_t k = index; k < scan; ++k)
            (script[k].kind == '-' ? dels : adds).push_back(&script[k]);
        const std::size_t pairs = std::min(dels.size(), adds.size());
        for (std::size_t k = 0; k < pairs; ++k) {
            if (rows.size() >= max_side_rows) { truncated = true; break; }
            Json left_marks = Json::array(), right_marks = Json::array();
            word_marks(dels[k]->text, adds[k]->text, left_marks, right_marks);
            Json row{{"kind", "change"},
                     {"left", side(dels[k]->a + 1, dels[k]->text)},
                     {"right", side(adds[k]->b + 1, adds[k]->text)}};
            if (!left_marks.empty()) row["leftMarks"] = std::move(left_marks);
            if (!right_marks.empty()) row["rightMarks"] = std::move(right_marks);
            rows.push_back(std::move(row));
        }
        for (std::size_t k = pairs; k < dels.size(); ++k) {
            if (rows.size() >= max_side_rows) { truncated = true; break; }
            rows.push_back(Json{{"kind", "delete"}, {"left", side(dels[k]->a + 1, dels[k]->text)}});
        }
        for (std::size_t k = pairs; k < adds.size(); ++k) {
            if (rows.size() >= max_side_rows) { truncated = true; break; }
            rows.push_back(Json{{"kind", "insert"}, {"right", side(adds[k]->b + 1, adds[k]->text)}});
        }
        index = scan;
    }
    return Json{{"rows", std::move(rows)}, {"truncated", truncated}};
}

Json diff_sides(std::string_view before, std::string_view after) {
    return side_rows(build_script(split_lines(before), split_lines(after)));
}

// 把 git diff 的 unified 文本还原成同样的行脚本，这样并排视图不需要再去读工作区
// 文件（也就不用重复处理长路径与前缀）。只支持 git 自己产出的 -U3 文本。
Json diff_sides_from_unified(const std::string& input) {
    // A string_view over the caller's buffer: using std::string::substr here would
    // create a temporary per line and leave the view dangling.
    const std::string_view text{input};
    std::vector<Row> script;
    std::size_t a_line = 0;
    std::size_t b_line = 0;
    std::size_t hunk = 0;
    std::size_t start = 0;
    while (start < text.size()) {
        auto end = text.find('\n', start);
        if (end == std::string_view::npos) end = text.size();
        std::string_view line = trim_cr(text.substr(start, end - start));
        start = end + 1;
        if (line.starts_with("@@ -")) {
            // "@@ -a,c +b,d @@"：a/b 是 1 起的行号，而脚本里的游标是 0 起，所以减一；
            // 纯增/纯删的起始号是 0，此时游标就是 0。
            const auto plus = line.find(" +");
            const auto read = [](std::string_view part, std::size_t offset) {
                std::size_t index = offset;
                while (index < part.size() && std::isdigit(static_cast<unsigned char>(part[index]))) ++index;
                return index == offset ? std::size_t{0} : std::stoul(std::string(part.substr(offset, index - offset)));
            };
            const auto zero = [](std::size_t one_based) { return one_based == 0 ? std::size_t{0} : one_based - 1; };
            a_line = zero(read(line, 4));
            b_line = plus == std::string_view::npos ? 0 : zero(read(line, plus + 2));
            ++hunk;
            continue;
        }
        // 文件头（diff --git / --- / +++ / index / 模式行）与 "\ No newline" 标记
        // 都不是内容；前者不含前导空格，后者以 '\' 开头且必须跳过。
        if (line.empty() || line.front() == '\\' || line.starts_with("diff --git ") ||
            line.starts_with("index ") || line.starts_with("--- ") || line.starts_with("+++ ") ||
            line.starts_with("new file") || line.starts_with("deleted file") ||
            line.starts_with("similarity ") || line.starts_with("rename ") ||
            line.starts_with("Binary files ") || line.starts_with("old mode") || line.starts_with("new mode"))
            continue;
        const char marker = line.front();
        const std::string_view body = (marker == ' ' || marker == '+' || marker == '-') ? line.substr(1) : line;
        if (marker == '+') script.push_back({'+', body, a_line, b_line++, hunk});
        else if (marker == '-') script.push_back({'-', body, a_line++, b_line, hunk});
        else if (marker == ' ') script.push_back({' ', body, a_line++, b_line++, hunk});
    }
    return side_rows(script);
}

}  // namespace taocode::history