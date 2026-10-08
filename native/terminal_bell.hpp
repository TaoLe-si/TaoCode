#pragma once

#include <string_view>

namespace taocode::terminal {

/**
 * 输出流里的**响铃**（BEL, 0x07）探测器：有状态，逐字节，只观察不改流。
 *
 * 为什么宿主需要它（而不是"让 xterm 去听"）：
 *   · `runInTerminal` 那些终端**根本没有前端 xterm**（`native/main.cpp:446` 的 `term.opened`
 *     带 `reason: "runInTerminal"`，构建/调试开出来的窗格没有面板订着），
 *     上游那条响铃在这里等于永远没人报；
 *   · 订阅者挂载前的输出是先缓冲的（`src/terminalEvents.ts` 的 256 块），
 *     那些字节要等面板挂载才喂给 xterm ⇒ 响铃会在**事情过去之后**才响。
 *     宿主侧探测发生在读线程里，与有没有订阅者无关。
 *
 * 为什么必须**有状态**（不是 `bytes.find('\a')`）：BEL 在 VT 里同时是 **OSC 串的结束符**
 * （`ESC ] 0 ; 标题 BEL`，xterm.js 也认这个收尾）。按字节找会把每一次改标题都当成响铃
 * —— 带标题提示符的 shell 每出一个提示符就响一次，是个假阳性得没边的实现。
 * 串状态（OSC / DCS / APC / SOS / PM）里的 BEL 一律只当收尾，不当响铃。
 *
 * 为什么不用 `uint8_t` 而是 `char`：流是**不透明字节**（`terminal.hpp` 文件头：宿主不解码，
 * UTF-8 由前端负责），0x07 在 UTF-8 里只可能是独立控制字节 —— 续字节是 0x80..0xBF、
 * 首字节 0xC2..，都够不到 0x07 ⇒ 按字节扫是安全的。也因此 **0x80..0xFF 一律当文本**：
 * 把 C1 控制码（0x9B=CSI、0x9D=OSC）当真会把 UTF-8 续字节读成转义序列。
 *
 * 用法：一块调用一次 `feed`，返回"这一块里至少有一个真响铃"（一块最多报一次：
 * 一块 = 宿主一次事件，避免一个 16KB 块里塞进的十个 BEL 变成十次通知）。
 * 线程约束：只有那一台终端的读线程调用，状态不需要加锁（与 `on_output` 同一线程）。
 */
class BellScanner {
public:
    /** 吃一块原样转发的输出字节；这块里出现过至少一个真响铃就返回 true。 */
    bool feed(std::string_view bytes);

private:
    enum class State {
        ground,   // 正常文本
        escape,   // 刚吃到 ESC，还没定序型
        csi,      // ESC [ …：直到最终字节 0x40..0x7E 才结束
        quoted,   // ESC ] / P / _ / X / ^ …：串序列，BEL 或 ESC \ 收尾
    };

    State state_ = State::ground;
};

}  // namespace taocode::terminal
