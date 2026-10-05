#pragma once

#include <filesystem>

// 崩溃现场记录（IDEA「内部错误」指示器的原生半边，见 src/internalErrors.ts 的显示规则）。
//
// 为什么需要：0xC0000409 里的 fastfail 码看不出责任方 —— 码 7 是 `abort()/std::terminate`，
// 意味着**某处的未捕获异常**把整个进程带走了。真机实测（2026-10-04，AE2 工作区打开后
// 1 秒内必崩）只有崩溃码、没有栈，等于没有线索。这一层在进程里装 terminate / SIGABRT 钩子，
// 把「谁在什么调用链上 abort」写进 taocode.log，再由 scripts/symbolize_stack.py 用 PDB 还原
// 函数名与行号。
//
// 装在这里（而不是 main.cpp）：main.cpp 贴着 2000 行机检上限，而崩溃日志本来就属于
// diagnostics 这个域；`diagnostics::init()` 已经拿着 profile 路径，顺手装一次即可。
namespace taocode {
namespace diagnostics {

/** 装崩溃钩子（幂等）。profile 用于定位 taocode.log；空路径时只装钩子不写。 */
void install_crash_log(const std::filesystem::path& profile);

/** 供测试/排障直接取调用栈文本（形如 `TaoCode.exe+0x1D1559 <- ...`）。 */
std::string crash_stack_text(unsigned frames = 24);

}  // namespace diagnostics
}  // namespace taocode
