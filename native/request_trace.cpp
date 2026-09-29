// 请求边界追踪实现（见 request_trace.hpp 的说明）。
#include "request_trace.hpp"

#include "diagnostics.hpp"
#include "lsp_host.hpp"

#include <windows.h>

#include <chrono>
#include <cstdlib>
#include <cctype>
#include <map>
#include <string>
#include <thread>

namespace taocode {
namespace trace {
namespace {

std::filesystem::path& sink() { static std::filesystem::path profile; return profile; }

struct Holder {
    unsigned long thread = 0;
    const char* site = "";
    std::chrono::steady_clock::time_point since{};
};

std::mutex& registry_mutex() { static std::mutex mutex; return mutex; }
std::map<std::mutex*, Holder>& holders() { static std::map<std::mutex*, Holder> map; return map; }

// lambda 里的 __FUNCSIG__ 形如
// `void __cdecl taocode::lsp::Session::semantic(...)::<lambda_1>::operator()(void)`：
// 只留"哪个函数 + 第几个 lambda"，日志要的是这个，不是整条签名。
std::string shorten(const char* signature) {
    std::string text(signature);
    const auto owner = text.find("Session::");
    if (owner != std::string::npos) text = text.substr(owner + 9);
    const auto open = text.find('(');
    if (open != std::string::npos) text = text.substr(0, open);
    const auto rest = signature + std::string::npos;  // 只在下面找 lambda 编号
    (void)rest;
    const std::string full(signature);
    const auto lambda = full.find("<lambda_");
    if (lambda != std::string::npos) {
        std::string digits;
        for (auto it = full.begin() + lambda + 8; it != full.end() && std::isdigit(static_cast<unsigned char>(*it)); ++it) digits.push_back(*it);
        if (!digits.empty()) text += "#lambda" + digits;
    }
    return text;
}

std::string describe(const Holder& holder) {
    const auto held = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - holder.since).count();
    return "线程 " + std::to_string(holder.thread) + " 在 " + shorten(holder.site) + " 已持有 " + std::to_string(held) + "ms";
}

}  // namespace

bool on() {
    static const bool enabled = [] {
        char buffer[8]{};
        return GetEnvironmentVariableA("TAOCODE_TRACE_REQUESTS", buffer, sizeof(buffer)) > 0 && std::string(buffer) != "0";
    }();
    return enabled;
}

void configure(const std::filesystem::path& profile) { sink() = profile; }

Lock::Lock(std::mutex& mutex, const char* site) : mutex_(&mutex), site_(site) {
    // 没 configure() 过就是普通 lock_guard：一次 try_lock 成功、零额外状态。
    if (sink().empty()) { mutex.lock(); return; }
    const auto began = std::chrono::steady_clock::now();
    long long next_report = 500;
    for (;;) {
        if (mutex_->try_lock()) break;
        const auto waited = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - began).count();
        if (waited >= next_report) {
            std::string who;
            {
                std::lock_guard guard(registry_mutex());
                const auto found = holders().find(mutex_);
                if (found != holders().end()) who = "，" + describe(found->second);
            }
            diagnostics::event(sink(), "WARN", "等锁 " + shorten(site) + " 已 " + std::to_string(waited) +
                "ms（线程 " + std::to_string(GetCurrentThreadId()) + "）" + who);
            next_report += 2000;   // 之后每 2s 一次，不至于刷屏
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    {
        std::lock_guard guard(registry_mutex());
        holders()[mutex_] = Holder{ GetCurrentThreadId(), site_, std::chrono::steady_clock::now() };
    }
}

Lock::~Lock() {
    if (sink().empty()) { mutex_->unlock(); return; }
    {
        std::lock_guard guard(registry_mutex());
        const auto found = holders().find(mutex_);
        if (found != holders().end() && found->second.thread == GetCurrentThreadId()) holders().erase(found);
    }
    mutex_->unlock();
}

void begin(const std::filesystem::path& profile, const std::string& what) {
    diagnostics::event(profile, "TRACE", "begin " + what);
}

void end(const std::filesystem::path& profile, const std::string& what, double ms) {
    diagnostics::event(profile, "TRACE", "end " + what + " " + std::to_string(static_cast<long long>(ms)) + "ms");
}

void install_lsp_slow_write(const std::filesystem::path& profile) {
    lsp::Host::slow_write_hook = [profile](unsigned long thread, unsigned long ms, unsigned long bytes) {
        diagnostics::event(profile, "WARN", "写语言服务 stdin 阻塞 " + std::to_string(ms) + "ms（线程 " + std::to_string(thread) +
            "，本帧 " + std::to_string(bytes) + " 字节）");
    };
}

}  // namespace trace
}  // namespace taocode
