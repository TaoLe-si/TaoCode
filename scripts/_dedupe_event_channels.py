"""把 main.cpp 里九个逐字相同的事件队列收成 EventChannel（一次性脚本）。

每个替换都带唯一性断言：找不到或找到多处就中止，绝不半途改文件。
"""
import io
import sys

PATH = "native/main.cpp"

with io.open(PATH, encoding="utf-8", newline="") as fh:
    src = fh.read()

edits = []


def sub(old, new, count=1, label=""):
    edits.append((old, new, count, label))


# ---------------------------------------------------------------- include
sub(
    '#include "gradle.hpp"\n#include "history.hpp"\n',
    '#include "gradle.hpp"\n#include "event_channel.hpp"\n',
    label="include event_channel.hpp（顺手去掉重复的 history.hpp）",
)

# ---------------------------------------------------------------- 成员声明
sub(
    "    std::unique_ptr<taocode::lsp::Session> lsp;\n"
    "    std::mutex lsp_mutex;\n"
    "    std::deque<Json> lsp_events;\n",
    "    std::unique_ptr<taocode::lsp::Session> lsp;\n"
    "    taocode::EventChannel lsp_events;\n",
    label="lsp 队列 → EventChannel",
)

sub(
    "    std::unique_ptr<taocode::Runner> runner;\n"
    "    std::mutex run_mutex;\n"
    "    std::deque<Json> run_events;\n",
    "    std::unique_ptr<taocode::Runner> runner;\n"
    "    // run_mutex 仍要留着：它同时守 `run_steps` / `run_pending_continue`（运行前步骤链）。\n"
    "    std::mutex run_mutex;\n"
    "    taocode::EventChannel run_events;\n",
    label="run 队列 → EventChannel",
)

sub(
    "    std::unique_ptr<taocode::dap::Client> dap;\n"
    "    std::mutex dap_mutex;\n"
    "    std::deque<Json> dap_events;\n",
    "    std::unique_ptr<taocode::dap::Client> dap;\n"
    "    taocode::EventChannel dap_events;\n",
    label="dap 队列 → EventChannel",
)

sub(
    "    std::unique_ptr<taocode::terminal::Manager> terminals = std::make_unique<taocode::terminal::Manager>();\n"
    "    std::mutex term_mutex;\n"
    "    std::deque<Json> term_events;\n",
    "    std::unique_ptr<taocode::terminal::Manager> terminals = std::make_unique<taocode::terminal::Manager>();\n"
    "    taocode::EventChannel term_events;\n",
    label="term 队列 → EventChannel",
)

sub(
    "    std::unique_ptr<taocode::gradle::SyncSession> gradle_sync;\n"
    "    std::mutex gradle_mutex;\n"
    "    std::deque<Json> gradle_events;\n",
    "    std::unique_ptr<taocode::gradle::SyncSession> gradle_sync;\n"
    "    taocode::EventChannel gradle_events;\n",
    label="gradle 队列 → EventChannel",
)

sub(
    "    std::unique_ptr<taocode::watcher::Watcher> watcher;\n"
    "    std::mutex watch_mutex;\n"
    "    std::deque<Json> watch_events;\n",
    "    std::unique_ptr<taocode::watcher::Watcher> watcher;\n"
    "    taocode::EventChannel watch_events;\n",
    label="watch 队列 → EventChannel",
)

sub(
    "    std::atomic<bool> search_cancel{false};\n"
    "    std::mutex search_mutex;\n"
    "    std::deque<Json> search_events;\n",
    "    std::atomic<bool> search_cancel{false};\n"
    "    taocode::EventChannel search_events;\n",
    label="search 队列 → EventChannel",
)

sub(
    "    std::mutex git_mutex;\n"
    "    std::deque<Json> git_requests;\n"
    "    std::deque<Json> git_replies;\n",
    "    std::mutex git_mutex;\n"
    "    std::deque<Json> git_requests;\n"
    "    // 回复队列原本没有上限（一条回复对应一次请求，天然有界），所以 limit 传 0。\n"
    "    taocode::EventChannel git_replies;\n",
    label="git 回复队列 → EventChannel",
)

# ---------------------------------------------------------------- 函数体
sub(
    "    void queue_search(Json payload) {\n"
    "        {\n"
    "            std::lock_guard lock(search_mutex);\n"
    "            search_events.push_back(std::move(payload));\n"
    "        }\n"
    "        PostMessageW(window, search_event_message, 0, 0);\n"
    "    }\n",
    "    void queue_search(Json payload) { search_events.push(std::move(payload), window, search_event_message); }\n",
    label="queue_search",
)

sub(
    "    void queue_gradle(Json payload) {\n"
    "        {\n"
    "            std::lock_guard lock(gradle_mutex);\n"
    "            gradle_events.push_back(std::move(payload));\n"
    "            if (gradle_events.size() > 4096) gradle_events.erase(gradle_events.begin(), gradle_events.begin() + 1024);\n"
    "        }\n"
    "        PostMessageW(window, gradle_event_message, 0, 0);\n"
    "    }\n"
    "\n"
    "    void drain_gradle() {\n"
    "        std::deque<Json> events;\n"
    "        { std::lock_guard lock(gradle_mutex); events.swap(gradle_events); }\n"
    "        if (webview) for (const auto& event : events) post_json(event);\n"
    "    }\n",
    "    void queue_gradle(Json payload) { gradle_events.push(std::move(payload), window, gradle_event_message); }\n"
    "\n"
    "    void drain_gradle() {\n"
    "        if (webview) for (const auto& event : gradle_events.take()) post_json(event);\n"
    "    }\n",
    label="queue_gradle / drain_gradle",
)

sub(
    "    void drain_search() {\n"
    "        std::deque<Json> events;\n"
    "        { std::lock_guard lock(search_mutex); events.swap(search_events); }\n"
    "        if (webview) for (const auto& event : events) post_json(event);\n"
    "    }\n",
    "    void drain_search() {\n"
    "        if (webview) for (const auto& event : search_events.take()) post_json(event);\n"
    "    }\n",
    label="drain_search",
)

sub(
    "    void queue_watch(Json payload) {\n"
    "        {\n"
    "            std::lock_guard lock(watch_mutex);\n"
    "            watch_events.push_back(std::move(payload));\n"
    "            if (watch_events.size() > 256) watch_events.pop_front();\n"
    "        }\n"
    "        PostMessageW(window, watch_event_message, 0, 0);\n"
    "    }\n"
    "\n"
    "    void drain_watch() {\n"
    "        std::deque<Json> events;\n"
    "        { std::lock_guard lock(watch_mutex); events.swap(watch_events); }\n"
    "        if (webview) for (const auto& event : events) post_json(event);\n"
    "    }\n",
    "    void queue_watch(Json payload) { watch_events.push(std::move(payload), window, watch_event_message, 256, 1); }\n"
    "\n"
    "    void drain_watch() {\n"
    "        if (webview) for (const auto& event : watch_events.take()) post_json(event);\n"
    "    }\n",
    label="queue_watch / drain_watch",
)

sub(
    "    void queue_term(Json payload) {\n"
    "        {\n"
    "            std::lock_guard lock(term_mutex);\n"
    "            term_events.push_back(std::move(payload));\n"
    "            if (term_events.size() > 8192) term_events.erase(term_events.begin(), term_events.begin() + 2048);  // output flood guard\n"
    "        }\n"
    "        PostMessageW(window, term_event_message, 0, 0);\n"
    "    }\n"
    "\n"
    "    void drain_term() {\n"
    "        std::deque<Json> events;\n"
    "        { std::lock_guard lock(term_mutex); events.swap(term_events); }\n"
    "        if (webview) for (const auto& event : events) post_json(event);\n"
    "    }\n",
    "    // output flood guard：超过 8192 条时丢掉最旧的 2048 条。\n"
    "    void queue_term(Json payload) { term_events.push(std::move(payload), window, term_event_message, 8192, 2048); }\n"
    "\n"
    "    void drain_term() {\n"
    "        if (webview) for (const auto& event : term_events.take()) post_json(event);\n"
    "    }\n",
    label="queue_term / drain_term",
)

sub(
    "    void queue_run(Json payload) {\n"
    "        {\n"
    "            std::lock_guard lock(run_mutex);\n"
    "            run_events.push_back(std::move(payload));\n"
    "            if (run_events.size() > 4096) run_events.erase(run_events.begin(), run_events.begin() + 1024);\n"
    "        }\n"
    "        PostMessageW(window, run_event_message, 0, 0);\n"
    "    }\n"
    "\n"
    "    void drain_run() {\n"
    "        std::deque<Json> events;\n"
    "        { std::lock_guard lock(run_mutex); events.swap(run_events); }\n"
    "        if (webview) for (const auto& event : events) post_json(event);\n",
    "    void queue_run(Json payload) { run_events.push(std::move(payload), window, run_event_message); }\n"
    "\n"
    "    void drain_run() {\n"
    "        if (webview) for (const auto& event : run_events.take()) post_json(event);\n",
    label="queue_run / drain_run",
)

sub(
    "    void queue_dap(Json payload) {\n"
    "        {\n"
    "            std::lock_guard lock(dap_mutex);\n"
    "            dap_events.push_back(std::move(payload));\n"
    "            while (dap_events.size() > 2048) dap_events.erase(dap_events.begin());  // console flood guard\n"
    "        }\n"
    "        PostMessageW(window, dap_event_message, 0, 0);\n"
    "    }\n"
    "\n"
    "    void drain_dap() {\n"
    "        std::deque<Json> events;\n"
    "        { std::lock_guard lock(dap_mutex); events.swap(dap_events); }\n"
    "        if (webview) for (const auto& event : events) post_json(event);\n"
    "    }\n",
    "    // console flood guard：超过 2048 条时一条一条丢掉最旧的（保持原语义，所以 drop 传 1）。\n"
    "    void queue_dap(Json payload) { dap_events.push(std::move(payload), window, dap_event_message, 2048, 1); }\n"
    "\n"
    "    void drain_dap() {\n"
    "        if (webview) for (const auto& event : dap_events.take()) post_json(event);\n"
    "    }\n",
    label="queue_dap / drain_dap",
)

sub(
    "    void queue_lsp(Json payload) {\n"
    "        {\n"
    "            std::lock_guard lock(lsp_mutex);\n"
    "            lsp_events.push_back(std::move(payload));\n"
    "            if (lsp_events.size() > 512) lsp_events.pop_front();\n"
    "        }\n"
    "        PostMessageW(window, WM_APP + 2, 0, 0);\n"
    "    }\n"
    "\n"
    "    void drain_lsp() {\n"
    "        std::deque<Json> events;\n"
    "        { std::lock_guard lock(lsp_mutex); events.swap(lsp_events); }\n"
    "        if (webview) for (const auto& event : events) post_json(event);\n"
    "    }\n",
    "    void queue_lsp(Json payload) { lsp_events.push(std::move(payload), window, lsp_event_message, 512, 1); }\n"
    "\n"
    "    void drain_lsp() {\n"
    "        if (webview) for (const auto& event : lsp_events.take()) post_json(event);\n"
    "    }\n",
    label="queue_lsp / drain_lsp",
)

sub(
    "    void queue_git_reply(Json payload) {\n"
    "        {\n"
    "            std::lock_guard lock(git_mutex);\n"
    "            git_replies.push_back(std::move(payload));\n"
    "        }\n"
    "        PostMessageW(window, git_event_message, 0, 0);\n"
    "    }\n"
    "\n"
    "    void drain_git() {\n"
    "        std::deque<Json> replies;\n"
    "        { std::lock_guard lock(git_mutex); replies.swap(git_replies); }\n"
    "        if (!webview) return;\n"
    "        for (const auto& reply : replies) post_json(reply);\n",
    "    void queue_git_reply(Json payload) { git_replies.push(std::move(payload), window, git_event_message, 0); }\n"
    "\n"
    "    void drain_git() {\n"
    "        if (!webview) return;\n"
    "        for (const auto& reply : git_replies.take()) post_json(reply);\n",
    label="queue_git_reply / drain_git",
)

sub(
    "    // Progress events ride the same WM_APP+8 marshalling as the git replies; this is\n"
    "    // not a reply, so it goes out as a separate message the bridge fronts as an event.\n"
    "    void queue_git_reply_event(Json payload) {\n"
    "        {\n"
    "            std::lock_guard lock(git_mutex);\n"
    "            git_replies.push_back(std::move(payload));\n"
    "        }\n"
    "        PostMessageW(window, git_event_message, 0, 0);\n"
    "    }\n"
    "\n",
    "    // Progress events ride the same WM_APP+8 marshalling as the git replies（就是同一条队列，\n"
    "    // 前端按有没有 `id` 分辨回复与事件），所以这里直接复用 queue_git_reply。\n\n",
    label="删掉 queue_git_reply_event（与 queue_git_reply 逐字相同）",
)

sub(
    "        queue_git_reply_event(std::move(event));\n",
    "        queue_git_reply(std::move(event));\n",
    label="publish_git_progress 改用 queue_git_reply",
)

sub(
    "        std::deque<Json> dropped;\n"
    "        { std::lock_guard lock(git_mutex); dropped.swap(git_replies); }\n",
    "        git_replies.take();  // 丢掉还没发出去的回复（窗口/项目已经放开了）\n",
    label="stop_git 清空回复队列",
)

# ---------------------------------------------------------------- 应用
for old, new, count, label in edits:
    found = src.count(old)
    if found != count:
        sys.stderr.write("ABORT [%s]: 期望匹配 %d 处，实际 %d 处\n" % (label, count, found))
        sys.exit(1)
    src = src.replace(old, new, count)
    print("ok  %s" % label)

with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
    fh.write(src)

print("done, lines =", src.count("\n") + 1)
