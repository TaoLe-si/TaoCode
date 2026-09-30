// 语言服务器子进程按「会话代号」登记与收尾。
//
// 为什么需要独立一层：语言服务线程一旦卡在锁上（见 lsp_recover.cpp）就收不掉，只能连同它那代
// 会话一起弃养。弃养意味着 `Session`/`Host` 的析构永远不会跑，而 `Host` 手里那个
// KILL_ON_JOB_CLOSE 作业对象只有**句柄关闭**时才会收进程 —— 于是每恢复一次，机器上就多留一台
// ~1GB 的 JVM 在后台索引同一个大工程（2026-09-30 真机实测：两代并存 = 两个 java.exe）。
// 登记表绕开"弃养的对象不能碰"这条禁令：它只存句柄值，不碰任何会话对象，也不需要
// `Session::mutex_`（弃养时那把锁可能正被孤儿线程握着）。
#pragma once

#include <cstddef>

namespace taocode {
namespace lsp {
namespace children {

// 领一个会话代号。Session 构造时领号，弃养时按号收进程。
long next_generation();

// 登记/注销一台服务器进程。job 可以为空（作业对象建不起来时 Host 会退化成
// TerminateProcess）；process 是 CreateProcessW 给的那支句柄，登记表只读不关。
void register_child(long generation, void* job, void* process);
void unregister_child(void* job);

// 把这一代留下的服务器进程整棵收掉，并从登记表里摘除。收不掉的（进程已死、句柄已关）
// 一律当作已完成 —— 这是清理路径，不该抛。
void terminate_generation(long generation);

// 登记表现在有几台（自测用）。
std::size_t registered_count();

}  // namespace children
}  // namespace lsp
}  // namespace taocode
