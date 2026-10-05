// 运行/构建的多实例宿主，见 run_host.hpp 的源码对照。
// GetExtendedTcpTable 的 IPv6 结构体（MIB_TCP6TABLE_OWNER_PID，shared/tcpmib.h）只在
// NTDDI_VERSION >= NTDDI_VISTA 时声明；显式抬到 Vista，Windows 10 宿主上没有副作用。
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif
#ifndef NTDDI_VERSION
#define NTDDI_VERSION 0x06010000
#endif
#include "run_host.hpp"

#include <mutex>
#include <stdexcept>

#include "base64.hpp"
#include "runner.hpp"
#include "text.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
// winsock2 必须在 windows.h 之前（否则 winsock.h 先被windows.h 拉进来，两端冲突）。
#include <winsock2.h>
#include <windows.h>
#include <iphlpapi.h>
#include <tcpmib.h>  // MIB_TCPTABLE_OWNER_PID / MIB_TCP6TABLE_OWNER_PID（iphlpapi.h 不总是拉它）
#include <tlhelp32.h>

#include <algorithm>
#include <cstdint>
#include <set>
#include <utility>

namespace taocode {
namespace run_host {
namespace {

namespace fs = std::filesystem;

void fail(const char* code, const std::string& message) { throw WorkspaceError(code, message); }

// **进程树**（`run.instances` 的 `children` / `tree` 字段）：IDEA 的 Stop 走
// `OSProcessHandler.destroyProcess()`，Windows 上由 `ProcessTreeKiller` 结束整棵树；
// 本仓 Runner 用 Job Object 达到同一效果（stop 即杀树），这些函数把「树里有哪些进程」
// 变成可见数据 —— Run 控制台据此显示每个实例的进程树（父子层级 + 进程名）。
// Toolhelp 快照按父 pid 建表，再从实例根进程 DFS 出全部后代（O(进程数)）。
struct ProcessEntry {
    std::int64_t pid = 0;
    std::int64_t parent = 0;
    std::string name;
};

/** 一次 Toolhelp 快照：pid → (父 pid, 可执行文件名)。名字转不成 UTF-8 时留空。 */
std::map<std::uint32_t, std::pair<std::uint32_t, std::string>> process_snapshot() {
    std::map<std::uint32_t, std::pair<std::uint32_t, std::string>> out;
    const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return out;
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    if (Process32FirstW(snapshot, &entry)) {
        do {
            std::string name;
            try { name = utf8(entry.szExeFile); }
            catch (const std::exception&) { name.clear(); }
            out[entry.th32ProcessID] = {entry.th32ParentProcessID, std::move(name)};
        } while (Process32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);
    return out;
}

/** 根 pid 的全部后代（前序：先父后子，兄弟按 pid 升序），每条带父 pid 与进程名。 */
std::vector<ProcessEntry> descendant_processes(unsigned long root) {
    std::vector<ProcessEntry> out;
    if (root == 0) return out;
    const auto snapshot = process_snapshot();
    std::map<std::uint32_t, std::vector<std::uint32_t>> children;
    for (const auto& [pid, info] : snapshot)
        if (info.first != 0) children[info.first].push_back(pid);
    std::set<std::uint32_t> seen;
    seen.insert(static_cast<std::uint32_t>(root));
    std::vector<std::uint32_t> stack{static_cast<std::uint32_t>(root)};
    while (!stack.empty()) {
        const std::uint32_t current = stack.back();
        stack.pop_back();
        const auto found = children.find(current);
        if (found == children.end()) continue;
        const auto& kids = found->second;
        // 栈是后进先出：倒着压，弹出时才是 pid 升序。
        for (auto it = kids.rbegin(); it != kids.rend(); ++it) {
            if (!seen.insert(*it).second) continue;
            const auto info = snapshot.find(*it);
            if (info == snapshot.end()) continue;
            out.push_back({static_cast<std::int64_t>(*it), static_cast<std::int64_t>(current),
                           info->second.second});
            stack.push_back(*it);
        }
    }
    return out;
}

/** TCP 表里的端口是**网络字节序**（低 16 位）；这里手工换字节，不引入 ws2_32 依赖。 */
std::uint16_t host_port(DWORD raw) {
    const auto value = static_cast<std::uint16_t>(raw & 0xFFFF);
    return static_cast<std::uint16_t>((value >> 8) | (value << 8));
}

/**
 * IPv6 表的结构体。SDK 的 `MIB_TCP6TABLE_OWNER_PID`（shared/tcpmib.h）整块受
 * `WINAPI_FAMILY_PARTITION` 保护，在部分工具链组合下不可见；这里按 tcpmib.h:203-223 的
 * 公开布局就地声明（只读快照，字段一一对应），避免为一个枚举函数引入 SDK 可见性差异。
 */
struct Tcp6RowOwnerPid {
    UCHAR local_address[16];
    DWORD local_scope;
    DWORD local_port;
    UCHAR remote_address[16];
    DWORD remote_scope;
    DWORD remote_port;
    DWORD state;
    DWORD pid;
};
struct Tcp6TableOwnerPid {
    DWORD count;
    Tcp6RowOwnerPid rows[1];
};

/**
 * 当前系统上处于 LISTEN 状态的 TCP 端口（IPv4+IPv6），带持有进程的 pid。
 *
 * 这一层只做 WinAPI 枚举（`GetExtendedTcpTable(TCP_TABLE_OWNER_PID_LISTENER)`，
 * 来自 iphlpapi）；「哪些端口属于某个实例」的过滤在 `ports_of` 里，纯函数、可离线测。
 * 枚举失败（表被并发修改等）返回空表 —— 端口只是补充信息，不该让 run.instances 失败。
 */
std::vector<ListeningPort> listening_tcp_ports() {
    std::vector<ListeningPort> out;
    const auto collect = [&out](ULONG family, TCP_TABLE_CLASS table_class, bool v6) {
        DWORD size = 0;
        if (GetExtendedTcpTable(nullptr, &size, FALSE, family, table_class, 0) != ERROR_INSUFFICIENT_BUFFER) return;
        std::vector<unsigned char> buffer(size);
        if (GetExtendedTcpTable(buffer.data(), &size, FALSE, family, table_class, 0) != NO_ERROR) return;
        if (v6) {
            const auto* table = reinterpret_cast<const Tcp6TableOwnerPid*>(buffer.data());
            for (DWORD i = 0; i < table->count; ++i) {
                const auto& row = table->rows[i];
                out.push_back({row.pid, host_port(row.local_port)});
            }
        } else {
            const auto* table = reinterpret_cast<const MIB_TCPTABLE_OWNER_PID*>(buffer.data());
            for (DWORD i = 0; i < table->dwNumEntries; ++i) {
                const auto& row = table->table[i];
                out.push_back({row.dwOwningPid, host_port(row.dwLocalPort)});
            }
        }
    };
    collect(AF_INET, TCP_TABLE_OWNER_PID_LISTENER, false);
    collect(AF_INET6, TCP_TABLE_OWNER_PID_LISTENER, true);
    return out;
}

// Runner accepts command-line fragments, not argv. Match native/dap.cpp's
// CRT quoting at this structured-argument boundary (IDEA CommandLineUtil:80-94).
std::wstring quote_argument(const std::wstring& value) {
    if (!value.empty() && value.find_first_of(L" \t\"") == std::wstring::npos) return value;
    std::wstring quoted = L"\"";
    for (std::size_t i = 0; i != value.size(); ++i) {
        std::size_t backslashes = 0;
        while (i != value.size() && value[i] == L'\\') { ++backslashes; ++i; }
        if (i == value.size()) { quoted.append(backslashes * 2, L'\\'); break; }
        if (value[i] == L'"') quoted.append(backslashes * 2 + 1, L'\\');
        else quoted.append(backslashes, L'\\');
        quoted.push_back(value[i]);
    }
    quoted.push_back(L'"');
    return quoted;
}

std::vector<std::string> string_list(const Json& value) {
    std::vector<std::string> out;
    if (!value.is_array()) return out;
    for (const auto& item : value) if (item.is_string()) out.push_back(item.get<std::string>());
    return out;
}

}  // namespace

std::vector<std::int64_t> ports_of(const std::vector<std::uint32_t>& pids,
                                   const std::vector<ListeningPort>& listeners) {
    const std::set<std::uint32_t> wanted(pids.begin(), pids.end());
    std::set<std::uint16_t> ports;
    for (const auto& listener : listeners)
        if (wanted.count(listener.pid)) ports.insert(listener.port);
    std::vector<std::int64_t> out;
    out.reserve(ports.size());
    for (const auto port : ports) out.push_back(static_cast<std::int64_t>(port));
    return out;
}

Step step_from(const Json& value) {
    Step step;
    step.command = value.value("command", std::string());
    step.program = value.value("program", std::string());
    step.cwd = value.value("cwd", std::string());
    // 主步骤用 `label`，`beforeLaunch` 的每一项用 `name`（前端形状就是这两个键）。
    step.label = value.value("label", value.value("name", std::string()));
    if (value.contains("args")) step.args = string_list(value.at("args"));
    if (value.contains("env")) step.environment = string_list(value.at("env"));
    step.shell = value.value("shell", true);
    return step;
}

std::deque<Step> chain_from(const Json& params) {
    std::deque<Step> steps;
    if (params.contains("beforeLaunch") && params.at("beforeLaunch").is_array())
        for (const auto& item : params.at("beforeLaunch")) steps.push_back(step_from(item));
    return steps;
}

struct Manager::Impl {
    struct Instance {
        int id = 0;
        std::string label;
        std::unique_ptr<Runner> runner;
        std::deque<Step> steps;      // 还没跑的后续步骤（本实例自己的链）
        bool pending = false;        // 上一段结束、等 UI 线程推进
        int last_code = 0;
        bool running = false;
        bool started = false;
    };

    Emit emit;
    mutable std::mutex mutex;
    // shared_ptr：`start`/`advance` 需要在**锁外**创建子进程（见下面关于死锁的注释），
    // 那时实例必须仍然活着；`stop` 的擦除也只发生在 UI 线程。
    std::map<int, std::shared_ptr<Instance>> instances;
    std::vector<std::pair<int, int>> pending;  // (instance, last_code)
    int next_id = 1;

    explicit Impl(Emit sink) : emit(std::move(sink)) {}

    void post(Json payload) { emit(std::move(payload)); }

    /** 建子进程（UI 线程调用；`advance` 也只在 UI 线程）。 */
    void spawn(Instance& instance, const Step& step, const fs::path& root) {
        auto runner = std::make_unique<Runner>();
        Runner::Spec spec;
        if (step.shell || step.program.empty()) {
            if (step.command.empty()) fail("INVALID_REQUEST", "运行命令不能为空。");
            spec.command = L"cmd.exe";
            // /s strips one outer quote pair. Keep the JDK executable's own
            // quotes intact when it lives under e.g. C:\Program Files.
            spec.arguments = {L"/d", L"/s", L"/c", L"\"" + wide(step.command) + L"\""};
        } else {
            spec.command = wide(step.program);
            for (const auto& argument : step.args) spec.arguments.push_back(quote_argument(wide(argument)));
        }
        // 工作目录：配置里的绝对路径优先，其次按项目根解释相对路径，最后退回项目根。
        if (!step.cwd.empty()) {
            const fs::path requested(wide(step.cwd));
            if (requested.is_absolute()) spec.working_directory = requested;
            else if (!root.empty()) spec.working_directory = root / requested;
        } else if (!root.empty()) {
            spec.working_directory = root;
        }
        for (const auto& entry : step.environment) if (!entry.empty()) spec.environment.push_back(wide(entry));

        const int id = instance.id;
        // 先标"在跑"再启动：极短的进程可能在 `start` 返回前就把退出回调跑完，
        // 那时回调会把 `running` 置 false，顺序反了就会留下一个假的"运行中"。
        instance.runner = std::move(runner);
        instance.running = true;
        instance.started = true;
        instance.runner->start(spec,
            // 原始字节走 base64：子进程用自己的代码页打印，而且分块边界可能切开一个多字节字符。
            [this, id](std::string_view chunk) { post({{"event", "run.output"}, {"instance", id}, {"dataB64", base64_encode(chunk)}}); },
            [this, id](int code) {
                std::size_t remaining = 0;
                {
                    std::lock_guard lock(mutex);
                    const auto found = instances.find(id);
                    if (found != instances.end()) {
                        remaining = found->second->steps.size();
                        found->second->last_code = code;
                        found->second->pending = true;   // 即使没有后续步骤也要过一遍（drain 会清标志）
                        if (remaining == 0) found->second->running = false;
                    }
                    pending.emplace_back(id, code);
                }
                // `remaining` 让控制台把整条配置保持"运行中"直到最后一步退出。
                post({{"event", "run.exit"}, {"instance", id}, {"code", code}, {"remaining", remaining}});
            });
    }

    /**
     * 停一个实例。**Runner 被摘出来交给调用方在锁外销毁** —— 这是必须的：
     * `~Runner` 会 join 读线程，而读线程的 done 回调要拿本类这把锁；在持锁时销毁就是死锁
     * （2026-09-27 实测：`stop(0)` 在析构里挂住，整个测试进程卡死）。
     */
    void stop_instance(Instance& instance, bool announce, std::vector<std::unique_ptr<Runner>>& retired) {
        instance.steps.clear();
        instance.pending = false;
        if (instance.runner) {
            instance.runner->stop();
            retired.push_back(std::move(instance.runner));
        }
        if (instance.running) {
            instance.running = false;
            if (announce)
                post({{"event", "run.exit"}, {"instance", instance.id}, {"code", -1}, {"remaining", std::size_t{0}}, {"aborted", true}});
        }
    }

    void advance(Instance& instance, int code, const fs::path& root) {
        if (code != 0) {
            const std::size_t skipped = instance.steps.size();
            instance.steps.clear();
            instance.running = false;
            post({{"event", "run.output"}, {"instance", instance.id},
                  {"dataB64", base64_encode("\r\n==> 链已中止：上一步以退出码 " + std::to_string(code)
                                            + " 结束，跳过 " + std::to_string(skipped) + " 个后续步骤 <==\r\n")}});
            post({{"event", "run.exit"}, {"instance", instance.id}, {"code", code},
                  {"remaining", std::size_t{0}}, {"aborted", true}});
            return;
        }
        if (instance.steps.empty()) { instance.running = false; return; }
        const Step next = instance.steps.front();
        instance.steps.pop_front();
        if (!next.label.empty())
            post({{"event", "run.output"}, {"instance", instance.id},
                  {"dataB64", base64_encode("\r\n==> " + next.label + " <==\r\n")}});
        try {
            spawn(instance, next, root);
        } catch (const WorkspaceError& error) {
            instance.steps.clear();
            instance.running = false;
            post({{"event", "run.output"}, {"instance", instance.id},
                  {"dataB64", base64_encode("\r\n==> 无法启动：" + std::string(error.what()) + " <==\r\n")}});
            post({{"event", "run.exit"}, {"instance", instance.id}, {"code", -1},
                  {"remaining", std::size_t{0}}, {"error", error.code}});
        } catch (const std::exception&) {
            instance.steps.clear();
            instance.running = false;
            post({{"event", "run.output"}, {"instance", instance.id},
                  {"dataB64", base64_encode(std::string("\r\n==> 无法启动后续步骤 <==\r\n"))}});
            post({{"event", "run.exit"}, {"instance", instance.id}, {"code", -1}, {"remaining", std::size_t{0}}});
        }
    }
};

Manager::Manager(Emit emit) : impl_(std::make_unique<Impl>(std::move(emit))) {}
Manager::~Manager() { stop(0); }

Json Manager::start(const Json& params, const std::filesystem::path& root) {
    // 锁的作用域到此为止：`retired` 的析构（~Runner join 读线程）与 `spawn`（创建子进程）
    // **都不能在持锁时做** —— 读线程的 done 回调要拿这把锁（见 stop_instance 的注释）。
    std::vector<std::unique_ptr<Runner>> retired;
    std::shared_ptr<Impl::Instance> instance;
    Step first;
    int id = 0;
    {
        std::lock_guard lock(impl_->mutex);
        const auto label = params.value("label", std::string());
        const bool allow_parallel = params.value("allowParallel", false);
        // 同名且不允许并行 ⇒ 先停掉（`ExecutionManagerImpl.kt:613-619`）。
        if (!allow_parallel && !label.empty())
            for (auto& [existing_id, existing] : impl_->instances)
                if (existing->label == label) impl_->stop_instance(*existing, true, retired);

        // "Before launch" 的每一项都**继承主步骤的工作目录与环境**（IDEA 的 BeforeRunTask 就是这样构造的），
        // 而且它们是**命令串**（跑在 shell 里）。整条链 = [beforeLaunch…, 主步骤]。
        std::deque<Step> chain = chain_from(params);
        Step main = step_from(params);
        for (auto& step : chain) {
            step.cwd = main.cwd;
            step.environment = main.environment;
            step.shell = true;
        }
        for (const auto& entry : main.environment)
            if (entry.empty() || entry.front() == '=' || entry.find('=') == std::string::npos)
                fail("INVALID_REQUEST", "环境变量要写成 KEY=VALUE。");
        if (main.command.empty() && main.program.empty())
            fail("INVALID_REQUEST", "运行配置需要命令或可执行程序。");

        chain.push_back(main);
        first = chain.front();
        chain.pop_front();
        instance = std::make_shared<Impl::Instance>();
        instance->id = impl_->next_id++;
        instance->label = label;
        instance->steps = std::move(chain);
        id = instance->id;
        impl_->instances[id] = instance;
        // Unnamed builds also need an active console and a terminal exit state.
        impl_->post({{"event", "run.started"}, {"instance", id}, {"label", instance->label}});
        if (!first.label.empty())
            impl_->post({{"event", "run.output"}, {"instance", id},
                         {"dataB64", base64_encode("\r\n==> " + first.label + " <==\r\n")}});
    }
    retired.clear();  // 锁外销毁：~Runner 会 join 读线程

    try {
        impl_->spawn(*instance, first, root);
    } catch (...) {
        std::lock_guard lock(impl_->mutex);
        impl_->instances.erase(id);
        impl_->post({{"event", "run.exit"}, {"instance", id}, {"code", -1},
                     {"remaining", std::size_t{0}}, {"aborted", true}});
        throw;
    }
    return {{"instance", id}, {"label", instance->label}, {"parallel", params.value("allowParallel", false)}};
}

Json Manager::stop(int instance) {
    std::vector<std::unique_ptr<Runner>> retired;
    std::size_t stopped = 0;
    {
        std::lock_guard lock(impl_->mutex);
        for (auto& [id, existing] : impl_->instances) {
            if (instance > 0 && id != instance) continue;
            impl_->stop_instance(*existing, true, retired);
            ++stopped;
        }
        if (instance > 0) impl_->instances.erase(instance);
        else impl_->instances.clear();
    }
    retired.clear();  // 锁外销毁（这一句是必须的，见 stop_instance 的注释）
    return {{"stopped", static_cast<std::int64_t>(stopped)}};
}

bool Manager::write_line(int instance, const std::string& line) {
    std::lock_guard lock(impl_->mutex);
    const auto found = impl_->instances.find(instance);
    if (found == impl_->instances.end() || !found->second->runner) return false;
    if (!found->second->runner->running()) return false;
    found->second->runner->write_line(line);
    return true;
}

Json Manager::instances() const {
    std::lock_guard lock(impl_->mutex);
    // 一次 IP Helper 快照喂给所有实例；端口只是补充信息（拿不到就空表）。
    const auto listeners = listening_tcp_ports();
    Json list = Json::array();
    for (const auto& [id, instance] : impl_->instances) {
        // pid = 该实例当前子进程的 OS pid（没在跑/已回收就是 0）；children = 它下面活着的后代 pid，
        // tree = 同一批后代的结构（`{pid, parent, name}`，前序：先父后子）—— 前端据此画出
        // 带进程名的父子层级。停止按 Job Object 语义杀整棵树（runner.cpp:342 TerminateJobObject），
        // 这份清单让「到底杀了谁」可见，而不是只给一个「已停止」。
        const unsigned long pid = instance->runner ? instance->runner->process_id() : 0;
        const auto descendants = descendant_processes(pid);
        Json children = Json::array();
        Json tree = Json::array();
        std::vector<std::uint32_t> tree_pids;
        if (pid != 0) tree_pids.push_back(static_cast<std::uint32_t>(pid));
        for (const auto& entry : descendants) {
            children.push_back(entry.pid);
            tree_pids.push_back(static_cast<std::uint32_t>(entry.pid));
            tree.push_back({{"pid", entry.pid}, {"parent", entry.parent}, {"name", entry.name}});
        }
        Json ports = Json::array();
        for (const auto port : ports_of(tree_pids, listeners)) ports.push_back(port);
        list.push_back({{"id", id}, {"label", instance->label}, {"running", instance->running},
                        {"pid", static_cast<std::int64_t>(pid)}, {"children", std::move(children)},
                        {"tree", std::move(tree)}, {"ports", std::move(ports)}});
    }
    return list;
}

bool Manager::any_running() const {
    std::lock_guard lock(impl_->mutex);
    for (const auto& [id, instance] : impl_->instances) if (instance->running) return true;
    return false;
}

void Manager::advance(int instance, int code, const std::filesystem::path& root) {
    std::lock_guard lock(impl_->mutex);
    const auto found = impl_->instances.find(instance);
    if (found == impl_->instances.end()) return;
    impl_->advance(*found->second, code, root);
}

std::vector<std::pair<int, int>> Manager::take_pending() {
    std::lock_guard lock(impl_->mutex);
    std::vector<std::pair<int, int>> out;
    while (!impl_->pending.empty()) {
        auto item = impl_->pending.front();
        impl_->pending.erase(impl_->pending.begin());
        const auto found = impl_->instances.find(item.first);
        if (found == impl_->instances.end() || !found->second->pending) continue;
        found->second->pending = false;
        out.push_back(item);
    }
    return out;
}

}  // namespace run_host
}  // namespace taocode
