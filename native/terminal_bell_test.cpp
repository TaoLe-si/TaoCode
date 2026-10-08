// Self-test for the output-stream bell scanner: which BEL is a real ring and which
// one is just an OSC title ending. Pure bytes, no shell, no ConPTY, no timing — the
// whole point of the module is that a bell must not depend on a mounted front end,
// so the check must not depend on one either. Prints "PASS <n>" per case and exits
// non-zero on the first failing check count.
#include "terminal_bell.hpp"

#include <iostream>
#include <string>
#include <vector>

namespace {

using taocode::terminal::BellScanner;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

// 一块一块喂，返回"哪几块报了响铃"（下标从 0 起）。
std::vector<bool> feed_all(BellScanner& scanner, const std::vector<std::string>& chunks) {
    std::vector<bool> rang;
    for (const auto& chunk : chunks) rang.push_back(scanner.feed(chunk));
    return rang;
}

// 同一条字节流，在每一个可能的位置切成两块，响铃总次数必须与整块喂时一致 ——
// 这是"有状态"那条判据的写法：一个每块都从头解析（或每块查表找 0x07）的实现，
// 会在某个切点上把 OSC 收尾的 BEL 当成响铃，于是这里必红。
std::vector<bool> split_everywhere(const std::string& stream, std::size_t expected) {
    std::vector<bool> first;
    for (std::size_t cut = 1; cut < stream.size(); ++cut) {
        BellScanner scanner;
        const auto result = feed_all(scanner, {stream.substr(0, cut), stream.substr(cut)});
        check(result.size() == 2, "切点 " + std::to_string(cut) + " 少了块");
        const int count = (result[0] ? 1 : 0) + (result[1] ? 1 : 0);
        check(count == static_cast<int>(expected),
              "切点 " + std::to_string(cut) + " 报了 " + std::to_string(count) + " 次，应为 " +
                  std::to_string(expected) + " 次：" + stream);
        if (cut == 1) first = result;
    }
    return first;
}

}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    run("地面上一个 BEL 报一次响铃", [&] {
        BellScanner scanner;
        check(scanner.feed("\a"), "一个裸 BEL 没被认成响铃");
        check(!scanner.feed("继续的文本"), "响铃状态没有落回去，下一块也跟着响了");
    });

    run("一块里三个 BEL 只报一次（一块 = 宿主一次事件）", [&] {
        BellScanner scanner;
        check(scanner.feed("a\ab\ac\a"), "一块里没有 BEL");
        check(!scanner.feed("\x1b]0;t\a"), "同一条流里下一块又报了响铃（不该）");
        BellScanner again;
        check(again.feed("\a\a\a"), "三个 BEL 连着一块也没报");
    });

    run("OSC 标题用 BEL 收尾不算响铃", [&] {
        // 这是本模块存在的全部理由：带标题提示符的 shell 每个提示符都发一条
        // `ESC ] 0 ; 标题 BEL`，按字节找 0x07 的实现会在每次改标题时响一次。
        BellScanner scanner;
        check(!scanner.feed("\x1b]0;C:\\TaoCode\a"), "OSC 的收尾 BEL 被当成响铃");
        check(!scanner.feed("\x1b]2;title\a"), "OSC 2（窗口标题）的收尾 BEL 被当成响铃");
        check(scanner.feed("\a"), "串状态没退回去：之后的真响铃被吞了");
    });

    run("OSC 用 ST（ESC \\）收尾也不算响铃", [&] {
        BellScanner scanner;
        check(!scanner.feed("\x1b]0;title\x1b\\"), "ST 收尾的 OSC 报了响铃");
        check(scanner.feed("done\a"), "ST 之后状态没回地面");
    });

    run("CSI 里的 BEL 不算响铃", [&] {
        BellScanner scanner;
        check(!scanner.feed("\x1b[1\a;m"), "CSI 参数里混进来的 BEL 被当成响铃");
        check(!scanner.feed("\x1b[?2004h"), "普通的 CSI 报了响铃");
        check(scanner.feed("\a"), "CSI 结束后真响铃不响了");
    });

    run("DCS / APC 里的 BEL 只当收尾", [&] {
        BellScanner scanner;
        check(!scanner.feed("\x1bP1$r0q\x1b\\"), "DCS 序列报了响铃");
        check(!scanner.feed("\x1b_x\a"), "APC 里的 BEL 被当成响铃");
        check(scanner.feed("\a"), "APC 之后状态没回地面");
    });

    run("CAN / SUB 中止序列之后 BEL 恢复算响铃", [&] {
        BellScanner scanner;
        check(!scanner.feed("\x1b[1\x18"), "被 CAN 中止的 CSI 报了响铃");
        check(scanner.feed("\a"), "CAN 中止后 BEL 没恢复成响铃");
        BellScanner sub;
        check(!sub.feed("\x1b]0;t\x1a"), "被 SUB 中止的 OSC 报了响铃");
        check(sub.feed("\a"), "SUB 中止后 BEL 没恢复成响铃");
    });

    run("UTF-8 续字节不当控制码（0x80.. 一律是文本）", [&] {
        BellScanner scanner;
        // 0x9B 就是 C1 的 CSI。把它当真控制码的实现，会把后面的 "3;4m" 吃进序列，
        // 于是下面那颗真 BEL 被吞掉 —— 这一条就是这么抓出来的。
        check(!scanner.feed("\xC2\x9B\xE2\x80\xA6\xC2\xBD"), "UTF-8 字节被当成控制码报了响铃");
        check(!scanner.feed("3;4m"), "0x9B 被当成 CSI，这块被吃了（不该有变化，但也不该响）");
        check(scanner.feed("\xC2\xA7" "3;4m\a"), "0x9B 被当成 CSI ⇒ 这颗真 BEL 被吞了");
    });

    run("转义序列的最终字节让状态回地面", [&] {
        BellScanner scanner;
        check(!scanner.feed("\x1bM"), "ESC M（反向换行）报了响铃");
        check(scanner.feed("\a"), "ESC 最终字节之后 BEL 不响了");
        check(!scanner.feed("\x1b"), "单一个 ESC 报了响铃");
        check(!scanner.feed("\x1b]0;a\a"), "ESC 之后接的 OSC 收尾 BEL 被当成响铃");
    });

    run("流在任意位置切成两块，响铃次数不变", [&] {
        // 有状态实现的硬判据：无状态（每块重新解析）在这里必红。
        split_everywhere("dir\a", 1);
        split_everywhere("\x1b]0;title\adir\a", 1);       // 只有结尾那颗真 BEL 算
        split_everywhere("\x1b[?25l\x1b]0;x\a echo\a", 1);  // OSC 收尾不算，结尾那颗算
        split_everywhere("\x1b]0;abc\a\x1b]0;def\a", 0);   // 全程没有真响铃
    });

    run("空块什么都不报", [&] {
        BellScanner scanner;
        check(!scanner.feed("x"), "铺垫没报（应当不报）");
        check(!scanner.feed(""), "空快报了响铃");
    });

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
