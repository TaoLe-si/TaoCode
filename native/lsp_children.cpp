#include "lsp_children.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <atomic>
#include <mutex>
#include <vector>

namespace taocode {
namespace lsp {
namespace children {
namespace {

struct Entry {
    long generation = 0;
    HANDLE job = nullptr;
    HANDLE process = nullptr;
};

// 登记表只存句柄值，不碰任何 Host/Session 成员 —— 见头文件里"为什么能绕过弃养禁令"。
std::mutex& registry_mutex() {
    static std::mutex mutex;
    return mutex;
}

std::vector<Entry>& registry() {
    static std::vector<Entry> entries;
    return entries;
}

}  // namespace

long next_generation() {
    static std::atomic<long> counter{0};
    return ++counter;
}

void register_child(long generation, void* job, void* process) {
    std::lock_guard lock(registry_mutex());
    registry().push_back({generation, static_cast<HANDLE>(job), static_cast<HANDLE>(process)});
}

void unregister_child(void* job) {
    const auto handle = static_cast<HANDLE>(job);
    std::lock_guard lock(registry_mutex());
    auto& entries = registry();
    for (auto entry = entries.begin(); entry != entries.end(); ++entry)
        if (entry->job == handle) { entries.erase(entry); return; }
}

void terminate_generation(long generation) {
    std::vector<Entry> doomed;
    {
        std::lock_guard lock(registry_mutex());
        auto& entries = registry();
        for (auto entry = entries.begin(); entry != entries.end();) {
            if (entry->generation == generation) {
                doomed.push_back(*entry);
                entry = entries.erase(entry);
            } else {
                ++entry;
            }
        }
    }
    // 系统调用放在锁外：注销（Host::stop）随时可能从别的线程进来，登记表不该被它挡住。
    for (const auto& entry : doomed) {
        if (entry.job) TerminateJobObject(entry.job, 0);        // 整棵树（jdtls 可能自己再起子进程）
        else if (entry.process) TerminateProcess(entry.process, 0);
    }
}

std::size_t registered_count() {
    std::lock_guard lock(registry_mutex());
    return registry().size();
}

}  // namespace children
}  // namespace lsp
}  // namespace taocode
