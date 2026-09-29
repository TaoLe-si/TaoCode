// 语言服务进度的两条回程（见 lsp_session.hpp 的 `cancel_progress` 声明）。
// 从 lsp_session.cpp 抽出来：那个文件贴着机检上限（1075 行），而"进度"本身就是一个独立的职责域 ——
// 它只往服务器发通知、只读 host 表，不参与任何一次请求-回包。
#include "lsp_session.hpp"
#include "request_trace.hpp"

#include <string>
#include <vector>

namespace taocode {
namespace lsp {

// 用户在进度行上点了「取消」。LSP 的回程是一条**通知**：`window/workDoneProgress/cancel`
// （参数就是当初那个 token）。上游同一件事在 `LspServerNotificationsHandlerImpl.kt:286-292` ——
// 只有服务器在 begin 里声明了 `cancellable: true` 且它还活着时才发，对已经 shutdown 的服务器不发。
// 挑目标在锁内、发送在锁外（与 `announce_file_operations` 一条纪律：回调可能正带着 io_mutex_ 进来）。
// 上游在服务器停机时把在跑的进度整条收掉（`cancelAllProgress()`，
// LspServerNotificationsHandlerImpl.kt:331-339 —— 注释原话："so its background progresses don't
// keep running"），否则界面上留的是一条永远在转的行。这里按语言各报一次 reset：
// 进度表是前端持有的，宿主这一侧只知道"这些服务器的话不会再来了"。
void Session::announce_progress_reset(const std::string& language) {
    if (!on_progress_ || language.empty()) return;
    on_progress_({{"event", "lsp.progressReset"}, {"language", language}});
}

void Session::announce_progress_reset() {
    std::vector<std::string> languages;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        for (const auto& [language, host] : hosts_) languages.push_back(language);
    }
    for (const auto& language : languages) announce_progress_reset(language);
}

void Session::cancel_progress(const std::string& language, const std::string& token) {
    if (token.empty()) return;
    Host* host = nullptr;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        const auto found = hosts_.find(language);
        if (found == hosts_.end()) return;
        const auto ready = ready_.find(language);
        if (ready == ready_.end() || !ready->second) return;
        host = found->second.get();
    }
    host->notify("window/workDoneProgress/cancel", {{"token", token}});
}

}  // namespace lsp
}  // namespace taocode
