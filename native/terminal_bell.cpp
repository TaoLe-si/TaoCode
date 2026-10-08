#include "terminal_bell.hpp"

namespace taocode::terminal {
namespace {

constexpr unsigned char bel = 0x07;    // BEL：地面上是响铃，串序列里是收尾符
constexpr unsigned char esc = 0x1b;    // ESC：引入转义序列
constexpr unsigned char can = 0x18;    // CAN：中止正在攒的序列
constexpr unsigned char sub = 0x1a;    // SUB：同上

// C0 控制字节：0x00..0x1F（除 ESC/CAN/SUB 外按各自序列的规则处理）。
// 0x80 以上全部当文本 —— 见头文件里 UTF-8 那一段。
inline bool is_final(unsigned char code) { return code >= 0x40 && code <= 0x7e; }
inline bool is_intermediate(unsigned char code) { return code >= 0x20 && code <= 0x2f; }

}  // namespace

bool BellScanner::feed(std::string_view bytes) {
    bool rang = false;
    for (const char raw : bytes) {
        const auto code = static_cast<unsigned char>(raw);
        if (code >= 0x80) continue;  // UTF-8 的首/续字节：不是控制码，也不改状态
        switch (state_) {
            case State::ground:
                if (code == bel) rang = true;  // 唯一的响铃来源
                else if (code == esc) state_ = State::escape;
                break;

            case State::escape:
                if (code == '[') state_ = State::csi;
                else if (code == ']' || code == 'P' || code == '_' || code == 'X' || code == '^')
                    state_ = State::quoted;  // OSC / DCS / APC / SOS / PM：BEL 或 ESC \ 才收尾
                else if (code == can || code == sub) state_ = State::ground;
                else if (code == esc) { /* 连着的两个 ESC：后一个才是引入符，状态不动 */ }
                else if (is_intermediate(code)) { /* 仍在等最终字节，状态不动 */ }
                else state_ = State::ground;   // 最终字节（含 ESC \ 的 '\\'）或垃圾字节：序列结束
                break;

            case State::csi:
                if (is_final(code)) state_ = State::ground;
                else if (code == esc) state_ = State::escape;
                else if (code == can || code == sub) state_ = State::ground;
                else { /* 参数字节 0x30..0x3F、中间字节、以及序列里混进来的 C0（含 BEL）：继续等最终字节 */ }
                break;

            case State::quoted:
                if (code == bel) state_ = State::ground;  // OSC 用 BEL 收尾：**不是**响铃
                else if (code == esc) state_ = State::escape;  // 多半是 ESC \ (ST)，交给 escape 判定
                else if (code == can || code == sub) state_ = State::ground;  // 中止：否则一条截断的 OSC 会把之后的响铃全吞掉
                else { /* 串内容：任何字节都不算响铃 */ }
                break;
        }
    }
    return rang;
}

}  // namespace taocode::terminal
