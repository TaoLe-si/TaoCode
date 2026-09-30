// 弃养一代会话时必须把它起的服务器进程整棵收掉。
// 真机现象（2026-09-30，13.9k 文件的 Java 工程）：语言服务线程卡死 → 恢复换了一代 → 机器上
// 多留一台 ~1GB 的 java.exe 在后台索引同一个工程。原因是弃养的 Host 析构永远不跑，它手里
// KILL_ON_JOB_CLOSE 的作业对象没人关。这里用一个真实子进程验证按代号回收确实发生，
// 并且**只**收掉那一代（新的一代必须活着）。
#include "lsp_children.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <iostream>
#include <string>

namespace {

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

struct Child {
    HANDLE process = nullptr;
    HANDLE job = nullptr;
};

// 起一个活得够久的真实进程（ping 自己 30 次 ≈ 30s），放进 kill-on-close 作业对象里 ——
// 与 Host::start 起服务器的方式一致。
Child spawn_long_lived() {
    SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE stdin_read = nullptr, stdin_write = nullptr, stdout_read = nullptr, stdout_write = nullptr;
    if (!CreatePipe(&stdin_read, &stdin_write, &attributes, 0)) throw std::runtime_error("CreatePipe 失败");
    if (!CreatePipe(&stdout_read, &stdout_write, &attributes, 0)) throw std::runtime_error("CreatePipe 失败");

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = stdin_read;
    startup.hStdOutput = stdout_write;
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION info{};
    std::wstring command = L"cmd.exe /c ping -n 30 127.0.0.1 > nul";
    const BOOL created = CreateProcessW(nullptr, command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, nullptr,
                                        &startup, &info);
    CloseHandle(stdin_read);
    CloseHandle(stdout_write);
    CloseHandle(stdin_write);
    CloseHandle(stdout_read);
    check(created != FALSE, "CreateProcessW 起不了测试子进程（用例本身没搭起来）");

    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    check(job != nullptr, "CreateJobObjectW 失败");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) != FALSE,
          "SetInformationJobObject 失败");
    check(AssignProcessToJobObject(job, info.hProcess) != FALSE, "AssignProcessToJobObject 失败");
    CloseHandle(info.hThread);
    return {info.hProcess, job};
}

}  // namespace

int main() {
    int failures = 0;
    int passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try {
            operation();
            ++passed;
            std::cout << "PASS " + name << '\n';
        } catch (const std::exception& error) {
            ++failures;
            std::cerr << "FAIL " << name << ": " << error.what() << '\n';
        }
    };

    run("按代号回收：老一代的服务器被收掉，新的一代不受影响", [&] {
        const long old_generation = taocode::lsp::children::next_generation();
        const long new_generation = taocode::lsp::children::next_generation();
        check(old_generation != new_generation, "代号必须唯一");

        const auto doomed = spawn_long_lived();
        const auto survivor = spawn_long_lived();
        taocode::lsp::children::register_child(old_generation, doomed.job, doomed.process);
        taocode::lsp::children::register_child(new_generation, survivor.job, survivor.process);
        check(taocode::lsp::children::registered_count() == 2, "两台都该登记上");

        taocode::lsp::children::terminate_generation(old_generation);
        check(WaitForSingleObject(doomed.process, 5000) == WAIT_OBJECT_0, "老一代的进程应当被收掉");
        check(WaitForSingleObject(survivor.process, 200) == WAIT_TIMEOUT, "新的一代不许被误收");
        check(taocode::lsp::children::registered_count() == 1, "回收过的一代要从登记表摘掉");

        // 正常收尾的那条路：注销之后再按代号回收，不该重复收（句柄值可能已被系统复用）。
        taocode::lsp::children::unregister_child(survivor.job);
        check(taocode::lsp::children::registered_count() == 0, "注销之后登记表要空");
        taocode::lsp::children::terminate_generation(new_generation);
        check(WaitForSingleObject(survivor.process, 200) == WAIT_TIMEOUT, "注销过的进程不该再被回收碰到");

        TerminateJobObject(survivor.job, 0);
        WaitForSingleObject(survivor.process, 5000);
        CloseHandle(survivor.process);
        CloseHandle(survivor.job);
        CloseHandle(doomed.process);
        CloseHandle(doomed.job);
    });

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
