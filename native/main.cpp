#include <windows.h>
#include <functional>
#include <unordered_map>
#include <psapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <dwmapi.h>
#include <wrl.h>
#include <WebView2.h>
#include <chrono>
#include <cwctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <map>
#include <set>
#include <string>
#include <string_view>
#include <deque>
#include <memory>
#include <mutex>
#include <thread>
#include <stop_token>
#include "workspace.hpp"
#include "workspace_search_file_task.hpp"
#include "window_state.hpp"
#include "projects.hpp"
#include "git_clone.hpp"
#include "git.hpp"
#include "git_routes.hpp"
#include "lsp_session.hpp"
#include "lsp_recover.hpp"
#include "lsp_worker.hpp"
#include "request_trace.hpp"
#include "lsp_config.hpp"
#include "jdtls.hpp"
#include "library_sources.hpp"
#include "file_queries.hpp"
#include "runner.hpp"
#include "run_host.hpp"
#include "search.hpp"
#include "dap.hpp"
#include "dap_routes.hpp"
#include "dap_host.hpp"
#include "terminal.hpp"
#include "trusted_paths.hpp"
#include "history.hpp"
#include "history_store_key.hpp"
#include "session.hpp"
#include "watcher.hpp"
#include "jdk.hpp"
#include "webview_options.hpp"
#include "plugins.hpp"
#include "diagnostics.hpp"
#include "base64.hpp"
#include "text.hpp"
#include "dialogs.hpp"
#include "gradle.hpp"
#include "settings_transfer.hpp"
#include "settings_schema.hpp"
#include "export_file.hpp"
#include "event_channel.hpp"
#include "http_client.hpp"
#include "embedded_browser_profile.hpp"
#include "agent_skills.hpp"
#include "agent_memory.hpp"
#include "mcp_client.hpp"
#include "system_date_format.hpp"

namespace taocode {
// 版本号与 package.json 的 version 一致（`app.info` 与日志启动行都用它）。
inline constexpr char kAppVersion[] = "0.1.0";
}  // namespace taocode

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using taocode::Json;
namespace fs = std::filesystem;

namespace {
// 桥接方法名是 `std::string`，不能直接 `switch`。FNV-1a 在 **编译期** 把 `case "x"_h`
// 变成整数，运行期只算一次被分派的名字。哈希碰撞不会静默走错分支：两个 `case` 得到同一个
// 值就是重复标签，MSVC 直接报 C2196。
constexpr std::uint64_t fnv1a(std::string_view text) {
    std::uint64_t hash = 1469598103934665603ULL;   // FNV offset basis
    for (const char character : text) {
        hash ^= static_cast<std::uint8_t>(character);
        hash *= 1099511628211ULL;                  // FNV prime
    }
    return hash;
}

constexpr std::uint64_t operator""_h(const char* text, std::size_t length) {
    return fnv1a(std::string_view(text, length));
}

constexpr wchar_t app_origin[] = L"https://taocode.local/";
constexpr UINT clone_event_message = WM_APP + 1;
constexpr UINT lsp_event_message = WM_APP + 2;
constexpr UINT run_event_message = WM_APP + 3;
constexpr UINT dap_event_message = WM_APP + 4;
constexpr UINT term_event_message = WM_APP + 5;
constexpr UINT watch_event_message = WM_APP + 6;
constexpr UINT search_event_message = WM_APP + 7;
// UTF-8/UTF-16 与 base64 的实现都在 taocode 命名空间（native/text.hpp、native/base64.hpp）。
using taocode::base64_decode;
using taocode::base64_encode;
using taocode::utf8;
using taocode::wide;

constexpr UINT git_event_message = WM_APP + 8;
constexpr UINT watch_restart_message = WM_APP + 9;
constexpr UINT gradle_event_message = WM_APP + 10;
constexpr UINT agent_model_event_message = WM_APP + 11;
constexpr UINT agent_mcp_event_message = WM_APP + 12;

// utf8 / wide 已并入 native/text.hpp（与 watcher.cpp 的重复实现合并）；
// base64 的编/解码都在 native/base64.hpp（三处重复实现合并成一份）。
bool trusted(const wchar_t* uri) {
    return uri && std::wstring_view(uri).starts_with(app_origin);
}
using taocode::store_hash;
void check(HRESULT result, const char* operation) {
    if (FAILED(result)) throw std::runtime_error(std::string(operation) + " failed (HRESULT " + std::to_string(static_cast<unsigned long>(result)) + ")");
}

struct App {
    HWND window{};
    fs::path ui;
    fs::path profile;
    std::string browser_version;  // WebView2 Runtime 版本（app.info 用）
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> webview;
    std::unique_ptr<taocode::Workspace> workspace = std::make_unique<taocode::Workspace>();
    std::unique_ptr<taocode::ProjectStore> projects;
    taocode::EmbeddedBrowserProfile embedded_browser_profile;
    std::string current_root;
    std::string default_parent;
    bool dirty = false;
    bool clone_active = false;
    bool closing_after_clone = false;
    Json clone_request_id;
    std::chrono::steady_clock::time_point clone_started;
    // 桥接路由表（strangler 迁移：新方法直接注册，旧链逐步清空）。
    // 对应 IDEA 的 ActionManager：method → handler，不再是一条巨型 if-else 链。
    using RouteHandler = std::function<Json(const Json& params)>;
    std::unordered_map<std::string, RouteHandler> routes;
    void register_routes() {
        routes.emplace("dialog.pickDirectory", [this](const Json& params) {
            const auto title = wide(params.value("title", std::string("选择项目存放目录")));
            return taocode::dialogs::select_directory(window, title.c_str(), params.value("initial", std::string()));
        });
        routes.emplace("agent.skills.list", [](const Json& params) {
            return taocode::agent_skills::list(params.value("workspacePath", std::string()));
        });
        routes.emplace("agent.skills.setEnabled", [](const Json& params) {
            return taocode::agent_skills::set_enabled(params.value("workspacePath", std::string()),
                                                       params.at("skillId").get<std::string>(),
                                                       params.value("enabled", true));
        });
        routes.emplace("agent.skills.delete", [](const Json& params) {
            return taocode::agent_skills::delete_skill(params.value("workspacePath", std::string()),
                                                        params.at("skillId").get<std::string>());
        });
        routes.emplace("agent.skills.reveal", [](const Json& params) {
            return taocode::agent_skills::reveal_skill(params.value("workspacePath", std::string()),
                                                        params.at("skillId").get<std::string>());
        });
        routes.emplace("agent.skills.promptContext", [](const Json& params) {
            return taocode::agent_skills::build_prompt_context(params.value("workspacePath", std::string()),
                                                                params.value("prompt", std::string()));
        });
        routes.emplace("agent.memory.list", [](const Json&) {
            return taocode::agent_memory::list_project_memories();
        });
        routes.emplace("agent.memory.read", [](const Json& params) {
            return taocode::agent_memory::read_project_memory_file(
                params.at("workspaceId").get<std::string>(), params.at("fileName").get<std::string>());
        });
        routes.emplace("agent.mcp.configure", [this](const Json& params) {
            const auto root = params.value("workspacePath", current_root);
            return agent_mcp.configure(params.value("settings", Json::object()), fs::path(wide(root)));
        });
        routes.emplace("agent.mcp.status", [this](const Json&) { return agent_mcp.snapshot(); });
        routes.emplace("agent.mcp.call", [this](const Json& params) { return agent_mcp.call(params); });
        routes.emplace("dialog.pickImage", [this](const Json&) { return taocode::dialogs::pick_image(window); });
        routes.emplace("app.readImage", [this](const Json& params) {
            const auto path = params.at("path").get<std::string>();
            if (path.empty()) return Json(nullptr);
            return taocode::dialogs::read_image(fs::path(wide(path)));
        });
    }
    std::mutex clone_mutex;
    std::deque<Json> clone_events;
    std::jthread clone_thread;

    std::unique_ptr<taocode::lsp::Session> lsp;
    // 语言服务独占线程：`lsp` 只在它的线程上被创建/使用/销毁（见 native/lsp_worker.hpp）。
    std::unique_ptr<taocode::lsp::Worker> lsp_worker;
    taocode::EventChannel lsp_events;

    // 运行/构建的**多实例**宿主（IDEA 的 `isAllowRunningInParallel` 语义 + 每实例的 Before launch 链）
    // 都在 native/run_host.cpp；这里只留事件通道与一个指针。
    std::unique_ptr<taocode::run_host::Manager> runs;
    taocode::EventChannel run_events;

    // 调试适配器那一整族（会话生命周期 / 两条反向请求 / TaoCode.dap.json / 事件通道）在
    // native/dap_host.cpp —— main.cpp 贴着 2000 行硬上限，它是 `git.*` 之后第二大的一段。
    // 这里只把宿主面接上：每一项都是本类已有的一行（终端仍是本类的 `terminals`，尺寸也仍由本类记着）。
    std::unique_ptr<taocode::dap_host::Host> dap_host = std::make_unique<taocode::dap_host::Host>(
        taocode::dap_host::Ports{
            .post = [this](const Json& payload) { post_json(payload); },
            .window = [this] { return window; },
            .ui = [this] { return ui; },
            .root = [this] { return current_root; },
            .general_settings = [this] { return general_settings(); },
            .terminals = [this]() -> taocode::terminal::Manager& { return *terminals; },
            .terminal_size = [this] { return std::pair<int, int>{terminal_cols, terminal_rows}; },
            .terminal_event = [this](Json payload) { queue_term(std::move(payload)); },
        },
        dap_event_message);

    std::unique_ptr<taocode::terminal::Manager> terminals = std::make_unique<taocode::terminal::Manager>();
    taocode::EventChannel term_events;
    // Last size the UI asked a terminal for. A reverse `runInTerminal` has no size
    // of its own, so a session the adapter opens reuses what the user is looking at
    // instead of a constant.
    int terminal_cols = 120;
    int terminal_rows = 30;

    std::unique_ptr<taocode::history::History> history;  // per-project local history, recreated on open
    std::unique_ptr<taocode::session::SessionStore> sessions;  // crash-recovery drafts, per profile
    // Gradle 同步：独立于"运行控制台"的通道（IDEA 的 Gradle 同步也不占运行按钮）。
    std::unique_ptr<taocode::gradle::SyncSession> gradle_sync;
    taocode::EventChannel gradle_events;
    taocode::EventChannel agent_model_events;
    std::mutex agent_model_mutex;
    std::thread agent_model_thread;
    std::stop_source agent_model_stop;
    std::uint64_t agent_model_request_id{};
    bool agent_model_active{};

    taocode::mcp_client::Manager agent_mcp;
    std::atomic<bool> agent_mcp_cancel{false};
    std::mutex agent_mcp_mutex;
    std::deque<Json> agent_mcp_requests;
    std::thread agent_mcp_thread;
    bool agent_mcp_busy{};
    taocode::EventChannel agent_mcp_replies;

    // IDE-03 file watching: one recursive ReadDirectoryChangesW thread per open
    // workspace; batches are debounced natively and forwarded as fs.changed.
    std::unique_ptr<taocode::watcher::Watcher> watcher;
    taocode::EventChannel watch_events;
    // Set by the watcher's own thread when it dies; consumed on the UI thread, which
    // is the only place allowed to touch `watcher`.
    std::mutex watch_restart_mutex;
    std::string watch_stop_reason;
    int watch_restarts = 0;
    std::chrono::steady_clock::time_point watch_started;

    // Find-in-Files: one worker thread per search. The request returns immediately and
    // the result is delivered from the message loop, so a 100k-file walk cannot freeze
    // the window; `search_cancel` is polled between files.
    std::thread search_thread;
    std::atomic<bool> search_busy{false};
    std::atomic<bool> search_cancel{false};
    taocode::EventChannel search_events;
    taocode::WorkspaceSearchFileTask workspace_file_search;

    // Every git.* command is a child process; its request queue, reply channel and the one worker
    // thread live in native/git_routes.cpp so a slow push cannot queue up behind — or freeze — the
    // UI thread. 这条通道是唯一一个在 App 里就地建起来、由本文件只读引用的成员：它的析构
    // （native/git_routes.cpp 的 `~Worker`）只做"丢队列 + 等住当前那条命令"，不碰本文件的任何
    // 东西，所以放在这里不需要额外的收尾顺序（真正会发事件的收尾仍是 `close_children` 的
    // 「git 工作线程」那一步）。
    std::unique_ptr<taocode::git_routes::Worker> git_host = std::make_unique<taocode::git_routes::Worker>(
        [this](const Json& request) { run_request(request, true); },  // 工作线程上真正干活的那一步
        [this] { return window; },                                   // 窗口在 App 构造之后才建，所以晚绑定
        [this](Json payload) { post_json(payload); },                // UI 线程上发回 WebView2
        git_event_message);

    void queue_search(Json payload) { search_events.push(std::move(payload), window, search_event_message); }

    void queue_gradle(Json payload) { gradle_events.push(std::move(payload), window, gradle_event_message); }

    void queue_agent_model(Json payload) { agent_model_events.push(std::move(payload), window, agent_model_event_message, 0); }

    void queue_agent_mcp_reply(Json payload) { agent_mcp_replies.push(std::move(payload), window, agent_mcp_event_message, 0); }

    void drain_agent_mcp() {
        if (webview) for (const auto& event : agent_mcp_replies.take()) post_json(event);
    }

    void queue_agent_mcp_request(const Json& request) {
        bool launch = false;
        {
            std::lock_guard lock(agent_mcp_mutex);
            agent_mcp_requests.push_back(request);
            if (!agent_mcp_busy) { agent_mcp_busy = true; launch = true; }
        }
        if (!launch) return;
        if (agent_mcp_thread.joinable()) agent_mcp_thread.join();
        agent_mcp_cancel.store(false);
        agent_mcp.set_cancel_flag(&agent_mcp_cancel);
        agent_mcp_thread = std::thread([this] {
            for (;;) {
                Json queued;
                {
                    std::lock_guard lock(agent_mcp_mutex);
                    if (agent_mcp_requests.empty()) { agent_mcp_busy = false; break; }
                    queued = std::move(agent_mcp_requests.front());
                    agent_mcp_requests.pop_front();
                }
                run_request(queued, true);
            }
        });
    }

    void stop_agent_mcp() noexcept {
        {
            std::lock_guard lock(agent_mcp_mutex);
            agent_mcp_requests.clear();
        }
        agent_mcp_cancel.store(true);
        if (agent_mcp_thread.joinable()) {
            CancelSynchronousIo(agent_mcp_thread.native_handle());
            agent_mcp_thread.join();
        }
        agent_mcp_busy = false;
        agent_mcp.stop_all();
        agent_mcp_replies.take();
    }

    void drain_agent_model() {
        if (webview) for (const auto& event : agent_model_events.take()) post_json(event);
    }

    bool stop_agent_model(std::uint64_t request_id = 0, bool wait = true) {
        bool stopped = false;
        {
            std::lock_guard lock(agent_model_mutex);
            if (agent_model_active && request_id && request_id != agent_model_request_id) return false;
            if (agent_model_active) { agent_model_stop.request_stop(); stopped = true; }
        }
        if (!wait) return stopped;
        if (agent_model_thread.joinable()) agent_model_thread.join();
        {
            std::lock_guard lock(agent_model_mutex);
            agent_model_active = false;
            agent_model_request_id = 0;
        }
        return stopped;
    }

    void start_agent_model(const Json& request) {
        {
            std::lock_guard lock(agent_model_mutex);
            if (agent_model_active) throw taocode::WorkspaceError("BUSY", "模型请求仍在运行。");
        }
        if (agent_model_thread.joinable()) agent_model_thread.join();
        const auto request_id = request.at("id").get<std::uint64_t>();
        const auto params = request.at("params");
        taocode::HttpRequest http;
        http.url = params.at("url").get<std::string>();
        http.body = params.at("body").get<std::string>();
        http.limit = params.value("limit", std::size_t{0});
        http.timeout_ms = params.value("timeoutMs", std::size_t{0});
        const auto& headers = params.at("headers");
        if (!headers.is_object()) throw taocode::WorkspaceError("INVALID_REQUEST", "HTTP 请求头必须是对象。");
        for (auto it = headers.begin(); it != headers.end(); ++it) {
            if (!it.value().is_string()) throw taocode::WorkspaceError("INVALID_REQUEST", "HTTP 请求头的值必须是字符串。");
            http.headers.emplace(it.key(), it.value().get<std::string>());
        }
        std::lock_guard lock(agent_model_mutex);
        if (agent_model_active) throw taocode::WorkspaceError("BUSY", "模型请求仍在运行。");
        agent_model_stop = std::stop_source{};
        const auto token = agent_model_stop.get_token();
        agent_model_active = true;
        agent_model_request_id = request_id;
        agent_model_thread = std::thread([this, request_id, http = std::move(http), token]() mutable {
            Json reply{{"id", request_id}, {"ok", false}};
            try {
                auto result = taocode::http_post_stream(http, [this, request_id](std::string_view chunk) {
                    queue_agent_model(Json{{"event", "agent.model.chunk"}, {"id", request_id},
                                           {"chunkB64", taocode::base64_encode(chunk)}});
                }, token);
                reply["ok"] = true;
                reply["result"] = std::move(result);
            } catch (const taocode::WorkspaceError& error) {
                reply["error"] = {{"code", error.code}, {"message", error.what()}};
            } catch (const std::exception&) {
                reply["error"] = {{"code", "NATIVE_ERROR"}, {"message", "模型 HTTP 请求失败。"}};
            }
            queue_agent_model(std::move(reply));
            std::lock_guard done_lock(agent_model_mutex);
            agent_model_active = false;
        });
    }

    void drain_gradle() {
        if (webview) for (const auto& event : gradle_events.take()) post_json(event);
    }

    void drain_search() {
        if (webview) for (const auto& event : search_events.take()) post_json(event);
    }

    void stop_search() {
        search_cancel.store(true);
        if (search_thread.joinable()) {
            // The walk polls the flag between files, so this returns promptly; waiting
            // here is what makes "close the project" safe while a search is in flight.
            search_thread.join();
        }
        search_busy.store(false);
    }

    void queue_watch(Json payload) { watch_events.push(std::move(payload), window, watch_event_message, 256, 1); }

    void drain_watch() {
        if (webview) for (const auto& event : watch_events.take()) post_json(event);
    }

    void start_watcher() {
        if (current_root.empty()) return;
        watch_restarts = 0;  // the budget belongs to this watcher, not the session
        watcher = std::make_unique<taocode::watcher::Watcher>();
        // A watcher that dies on its own used to do so in silence: the root was
        // renamed away, or ReadDirectoryChangesW failed, and the file tree simply
        // stopped refreshing with nothing anywhere saying so. The reason is now
        // reported and a genuine failure restarts the watch.
        watcher->on_stopped([this](std::string reason) {
            {
                std::lock_guard lock(watch_restart_mutex);
                watch_stop_reason = std::move(reason);
            }
            PostMessageW(window, watch_restart_message, 0, 0);  // must not touch the watcher from its own thread
        });
        try {
            // `paths` stays a string array so existing consumers keep working;
            // `changes` carries the action and, for a rename, the previous path. The
            // elements come from watcher::to_json so the wire shape has one owner.
            watcher->start(fs::path(wide(current_root)), [this](std::vector<taocode::watcher::Change> changed) {
                Json paths = Json::array();
                Json changes = Json::array();
                for (const auto& change : changed) {
                    paths.push_back(change.path);
                    changes.push_back(change);
                }
                queue_watch({{"event", "fs.changed"}, {"paths", std::move(paths)}, {"changes", std::move(changes)}});
            });
            watch_started = std::chrono::steady_clock::now();
        } catch (const taocode::WorkspaceError& error) {
            watcher.reset();  // watching is an enhancement, never a blocker
            // But silence would hide a tree that never refreshes: the death notice
            // already has a UI path (fs.watchStopped -> 文件监听已停止 notice).
            queue_watch({{"event", "fs.watchStopped"}, {"reason", error.code == "WATCH_FAILED" ? std::string("无法监听该目录（权限或网络盘）") : error.what()}, {"restarting", false}});
        }
    }

    // Runs on the UI thread. `监听已停止` is the reason for a deliberate stop, so it
    // is the one case that must not be retried; every other reason means the watch
    // died on its own and the file tree would otherwise go stale forever.
    void handle_watch_stopped() {
        std::string reason;
        { std::lock_guard lock(watch_restart_mutex); reason.swap(watch_stop_reason); }
        if (reason.empty() || reason == "监听已停止" || current_root.empty()) return;
        // A watch that lived a while earned a fresh budget; one that dies over and
        // over is a directory we cannot watch, and retrying would just spin.
        const auto now = std::chrono::steady_clock::now();
        if (now - watch_started > std::chrono::seconds(60)) watch_restarts = 0;
        if (watch_restarts >= 5) {
            queue_watch({{"event", "fs.watchStopped"}, {"reason", reason}, {"restarting", false}});
            return;
        }
        ++watch_restarts;
        stop_watcher();
        start_watcher();
        queue_watch({{"event", "fs.watchStopped"}, {"reason", reason}, {"restarting", true}, {"attempt", watch_restarts}});
    }

    void stop_watcher() noexcept {
        if (watcher) { watcher->stop(); watcher.reset(); }
    }

    // output flood guard：超过 8192 条时丢掉最旧的 2048 条。
    void queue_term(Json payload) { term_events.push(std::move(payload), window, term_event_message, 8192, 2048); }

    void drain_term() {
        if (webview) for (const auto& event : term_events.take()) post_json(event);
    }

    void queue_run(Json payload) { run_events.push(std::move(payload), window, run_event_message); }

    void drain_run() {
        if (webview) for (const auto& event : run_events.take()) post_json(event);
        // 链的推进在 UI 线程做（下一个子进程由消息循环创建，而不是由 reader 线程创建）。
        for (const auto& [instance, code] : runs->take_pending())
            runs->advance(instance, code, current_root.empty() ? fs::path() : fs::path(wide(current_root)));
    }

    void stop_run() { runs->stop(0); }

    // 调试适配器的整族（会话生命周期 / 两条反向请求 / TaoCode.dap.json / 事件通道）都在
    // native/dap_host.cpp —— main.cpp 贴着机检上限，它是 `git.*` 之后第二大的一段。
    // 下面两行只是宿主面：`stop_dap` 的调用点在 `close_children` 与 `workspace.close`。
    void drain_dap() {
        if (webview) dap_host->drain();
    }

    void stop_dap() noexcept { dap_host->stop(); }

    // 应用级设置里的 `general` 段（受信任清单就在里面）。每次现读：设置可能刚被前端改过，
    // 执行侧的判定必须用最新一份（`ProjectStore` 每次操作都在进程锁下重读状态文件）。
    Json general_settings() {
        Json state = projects->state();
        if (state.is_object() && state.contains("general") && state.at("general").is_object()) return state.at("general");
        return Json::object();
    }

    // NOTE: `workspace/applyEdit` is implemented inside taocode::lsp::Session
    // (lsp_session.cpp: apply_document_edits writes through the workspace layer and
    // refuses anything that escapes the root). The host side only has to react to a
    // server-driven write, which is the edit sink wired below.


    std::string require_repo_root() const {
        if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
        return current_root;
    }

    void queue_lsp(Json payload) { lsp_events.push(std::move(payload), window, lsp_event_message, 512, 1); }

    void drain_lsp() {
        if (webview) for (const auto& event : lsp_events.take()) post_json(event);
    }

    // Reads an optional "TaoCode.lsp.json" beside the exe mapping language ->
    // {command,args,cwd}, then falls back to **discovering** the servers the user has
    // installed (clangd / jdtls / gopls … on PATH) and to the bundled JDT LS. No server
    // is bundled for the other languages, so the boundary stays honest — but
    // "installed" has to be enough: IDEA ships Java support with the IDE, and making
    // the user hand-write a config file for a server they just installed is not the
    // same thing. The file still wins: it is the only place where arguments, cwd and
    // initializationOptions can be expressed. 合成逻辑在 native/lsp_config.cpp。
    // 把一段语言服务活儿投到 LSP 线程，并按请求编号把结果回给界面。
    // 回包走 `queue_lsp`（与 `lsp.request` 同一条通道），前端的 `pending` 按 id 认领，
    // 所以调用契约不变，只是不再在 UI 线程上等语言服务（见 native/lsp_worker.hpp）。
    // 投递型的处理器在 `return` 前补一行 end：否则日志里留下的是"begin 了没有 end"，
    // 那正是死锁的形状（2026-09-28 就是靠这条形状定位的），会把下一个排查的人带偏。
    static void trace_posted(const std::string& traced, const std::filesystem::path& profile, const char* how) {
        if (!traced.empty()) taocode::trace::begin(profile, "end " + traced + " (" + how + ")");
    }

    void post_lsp(const Json& id, std::function<Json()> body) {
        lsp_worker->post([this, id, body = std::move(body)] {
            Json payload{{"id", id}, {"ok", true}};
            try {
                payload["result"] = body();
            } catch (const taocode::WorkspaceError& error) {
                payload["ok"] = false;
                payload["error"] = {{"code", error.code}, {"message", error.what()}};
            } catch (const std::exception& failure) {
                payload["ok"] = false;
                payload["error"] = {{"code", "NATIVE_ERROR"}, {"message", failure.what()}};
            }
            queue_lsp(std::move(payload));
        });
    }

    void configure_lsp() {
        if (!lsp) {
            lsp = std::make_unique<taocode::lsp::Session>([this](std::string path, Json diagnostics) {
                queue_lsp({{"event", "lsp.diagnostics"}, {"path", path}, {"diagnostics", diagnostics}});
            });
            // A server-driven write (workspace/applyEdit, a quick fix, organize
            // imports) changes the file behind the editor's back: tell the UI to
            // reload that path so the buffer matches disk.
            lsp->set_edit_sink([this](std::string path) {
                queue_lsp({{"event", "lsp.edited"}, {"path", std::move(path)}});
            });
            lsp->set_progress_sink([this](Json payload) { queue_lsp(std::move(payload)); });  // `$/progress`：IDEA 把它做成状态栏那条带百分比的后台任务（LspServerNotificationsHandlerImpl.kt:257-328）
            // 读线程的回调要发东西时，交回这条线程做（见 lsp_session.hpp 的 set_owner_post）。
            lsp->set_owner_post([worker = lsp_worker.get()](std::function<void()> job) { worker->post(std::move(job)); });
        }
        // 没打开项目时没有索引目录，Java 那一份会被跳过（见 resolve_servers）。
        const Json project_settings = current_root.empty() ? Json() : projects->project_settings(current_root);
        lsp->configure(taocode::lsp::resolve_servers(ui.parent_path(), current_root, project_settings));
    }

    // 下面三个是"投递版"：UI 线程只排队，真正的活儿在 LSP 线程上做。
    void stop_lsp() noexcept {
        if (lsp_worker) { lsp_worker->post([this] { stop_lsp_now(); }); return; }
        stop_lsp_now();   // 线程还没起来（启动早期就失败）时直接收
    }

    // 只在 LSP 线程（或线程已 join 的收尾期）调用。
    void stop_lsp_now() noexcept {
        if (lsp) { lsp->shutdown_all(); lsp.reset(); }
    }

    // 关窗口收尾链：顺序照旧，但每步**先写"开始"再写"用时"** —— 卡住的那一步在日志里就是一条没有配对的行（2026-09-29 三次会话都只有启动行）。
    void close_children() {
        const std::pair<const char*, std::function<void()>> steps[] = {
            {"模型请求", [this] { stop_agent_model(); }}, {"查找线程", [this] { workspace_file_search.stop(); stop_search(); }}, {"语言服务线程", [this] { if (lsp_worker) lsp_worker->stop(); }},
            {"语言服务子进程", [this] { stop_lsp_now(); }}, {"构建/运行进程", [this] { stop_run(); }}, {"调试适配器", [this] { stop_dap(); }},
            {"目录监听", [this] { stop_watcher(); }}, {"git 工作线程", [this] { git_host->stop_git(); }}, {"MCP 工作线程", [this] { stop_agent_mcp(); }}, {"终端", [this] { terminals->kill_all(); }},
            {"Gradle 同步", [this] { if (gradle_sync) gradle_sync->cancel(); }},  // Gradle 也是子进程：实测 1m15s 的同步是**关窗之后**才写完 daemon 日志的，之前没有一步管它
        };
        for (const auto& step : steps) taocode::diagnostics::run_step(profile, step.first, step.second);
        taocode::diagnostics::run_step(profile, "内置浏览器", [this] { embedded_browser_profile.close(); });
    }
    // 文件在工作区里被创建/改名/删除之后告诉语言服务器。对应 IDEA 的 VFS 事件 +
    // `RefactoringEventListener`：IDE 自己动了磁盘，服务器的索引必须跟上，否则改完名
    // 它还在按旧路径解析（跳转、go-to-definition 会指向不存在的文件）。
    // 只在操作**真的成功之后**调用 —— 失败的操作不该告诉服务器"这个文件换名字了"。
    void announce_file_change(const char* kind, const std::string& path, const std::string& previous = std::string()) {
        if (path.empty()) return;
        const std::string name = kind;
        lsp_worker->post([this, name, path, previous] {
            if (!lsp) return;
            lsp->announce_file_operations(name.c_str(), std::vector<taocode::lsp::Session::FileOperation>{{path, previous}});
        });
    }

    void reset_lsp(const std::string& root) {
        lsp_worker->post([this, root] { reset_lsp_now(root); });
    }

    void reset_lsp_now(const std::string& root) {
        // Tear down any prior project's language servers before reconfiguring;
        // otherwise hosts and documents from the old root survive under the new root,
        // and URI mappings silently mix two projects.
        if (lsp) lsp->shutdown_all();
        configure_lsp();
        lsp->set_root(root.empty() ? fs::path() : fs::path(wide(root))); if (lsp) { std::vector<fs::path> linked; const auto linked_json = projects->project_settings(root).value("buildTools", Json::object()).value("gradle", Json::object()).value("linkedProjects", Json::array()); for (const auto& item : linked_json) if (item.is_string() && !item.get<std::string>().empty()) linked.push_back(fs::path(wide(root)) / fs::path(wide(item.get<std::string>()))); lsp->set_extra_roots(std::move(linked)); }
    }

    void set_theme(bool dark) {
        const BOOL enabled = dark;
        // Best effort: a Windows build that does not know attribute 20 simply keeps its
        // default title bar, which is cosmetic only.
        DwmSetWindowAttribute(window, 20, &enabled, sizeof(enabled));
        ComPtr<ICoreWebView2Controller2> background;
        if (SUCCEEDED(controller.As(&background))) {
            const COREWEBVIEW2_COLOR color = dark ? COREWEBVIEW2_COLOR{255, 23, 29, 39} : COREWEBVIEW2_COLOR{255, 255, 255, 255};
            background->put_DefaultBackgroundColor(color);
        }
        ComPtr<ICoreWebView2_13> core;
        ComPtr<ICoreWebView2Profile> web_profile;
        ComPtr<ICoreWebView2Profile2> appearance;
        if (SUCCEEDED(webview.As(&core)) && SUCCEEDED(core->get_Profile(&web_profile)) && SUCCEEDED(web_profile.As(&appearance)))
            appearance->put_PreferredColorScheme(dark ? COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK : COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT);
    }

    void failure(const std::string& message) {
        taocode::diagnostics::event(profile, "ERROR", message);
        const auto text = wide(message + "\n\n请确认系统已安装 Microsoft Edge WebView2 Runtime，且 exe 旁有完整 ui 目录。\n日志位于 " +
                                taocode::diagnostics::log_file(profile).string());
        MessageBoxW(window, text.c_str(), L"TaoCode 启动失败", MB_OK | MB_ICONERROR);
        if (window) DestroyWindow(window);
    }

    // 文件夹选择器与图片读取在 native/dialogs.cpp（拆出去后 main.cpp 回到机检上限内）。

    Json open_project(const fs::path& path) {
        stop_agent_model();
        workspace_file_search.stop();
        const auto settings = projects->project_settings(utf8(path.native()));
        auto candidate = std::make_unique<taocode::Workspace>();
        auto result = candidate->open(path, settings.at("excludedDirs").get<std::vector<std::string>>());
        projects->opened(result);
        current_root = result.at("root").get<std::string>();
        workspace = std::move(candidate);
        reset_lsp(current_root);
        try {
            const auto store = profile / L"history" / wide(store_hash(current_root));
            std::error_code ec;
            fs::create_directories(store, ec);
            history = std::make_unique<taocode::history::History>(store);
        } catch (...) { history.reset(); }
        // workspace.open doubles as a project switch: stop A's build and Find-in-
        // Files first, or a queued before-launch step would run against B's root.
        stop_run();
        stop_search();
        start_watcher();
        // IDEA's "Always show full path in window header": the title shows the
        // project root instead of just the folder name, so two same-named projects
        // are told apart on the taskbar.
        // IDEA's "Always show full path in window header": the title shows the
        // project root instead of just the folder name.
        Json state = Json::object();
        {
            Json loaded = projects->state();
            if (loaded.is_object() && loaded.contains("settings")) state = loaded.at("settings");
        }
        const bool full_path = state.contains("fullPathsInWindowHeader")
                                   && state.at("fullPathsInWindowHeader").is_boolean()
                                   && state.at("fullPathsInWindowHeader").get<bool>();
        const std::string heading = full_path ? current_root : result.at("name").get<std::string>();
        SetWindowTextW(window, wide(heading + " — TaoCode").c_str());
        return result;
    }

    void post_json(const Json& value) {
        if (!webview) return;  // a reply that races window teardown is simply dropped
        const auto text = wide(value.dump(-1, ' ', false, Json::error_handler_t::replace));
        if (FAILED(webview->PostWebMessageAsJson(text.c_str())))
            OutputDebugStringW(L"TaoCode: PostWebMessageAsJson failed (WebView is shutting down).\n");
    }

    void queue_clone(Json event) {
        {
            std::lock_guard lock(clone_mutex);
            if (clone_events.size() >= 256 && event.at("kind") == "progress") clone_events.back() = std::move(event);
            else clone_events.push_back(std::move(event));
        }
        PostMessageW(window, clone_event_message, 0, 0);
    }

    void begin_clone(const Json& id, const Json& params) {
        const auto source = params.at("source").get<std::string>();
        const auto parent = fs::path(wide(params.at("parent").get<std::string>()));
        const auto name = params.at("name").get<std::string>();
        projects->state();
        clone_request_id = id;
        clone_started = std::chrono::steady_clock::now();
        clone_active = true;
        try {
            clone_thread = std::jthread([this, source, parent, name](std::stop_token stop) {
                try {
                    const auto path = taocode::clone_repository(source, parent, name, stop, [this](const std::string& line) {
                        queue_clone({{"kind", "progress"}, {"message", line}});
                    });
                    queue_clone({{"kind", "done"}, {"path", utf8(path.native())}});
                } catch (const taocode::WorkspaceError& error) {
                    queue_clone({{"kind", "done"}, {"error", {{"code", error.code}, {"message", error.what()}}}});
                } catch (const std::exception&) {
                    queue_clone({{"kind", "done"}, {"error", {{"code", "CLONE_FAILED"}, {"message", "克隆进程发生错误，未打开项目。"}}}});
                }
            });
        } catch (...) { clone_active = false; throw; }
    }

    void drain_clone() {
        std::deque<Json> events;
        { std::lock_guard lock(clone_mutex); events.swap(clone_events); }
        for (const auto& event : events) {
            if (event.at("kind") == "progress") {
                post_json({{"id", clone_request_id}, {"event", "clone.progress"}, {"message", event.at("message")}});
                continue;
            }
            clone_thread.join();
            clone_active = false;
            Json reply = {{"id", clone_request_id}, {"ok", false}};
            if (event.contains("error")) reply["error"] = event.at("error");
            else {
                const auto path = event.at("path").get<std::string>();
                try {
                    reply["result"] = closing_after_clone ? Json(nullptr) : open_project(fs::path(wide(path)));
                    reply["ok"] = true;
                } catch (const taocode::WorkspaceError& error) {
                    reply["error"] = {{"code", error.code}, {"message", "克隆已完成，目录保留在 " + path + "，但打开失败：" + error.what()}};
                } catch (const std::exception&) {
                    reply["error"] = {{"code", "OPEN_FAILED"}, {"message", "克隆已完成，目录保留在 " + path + "，但打开失败。"}};
                }
            }
            reply["durationMs"] = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - clone_started).count();
            post_json(reply);
            if (closing_after_clone) PostMessageW(window, WM_CLOSE, 0, 0);
        }
    }

    void message(ICoreWebView2WebMessageReceivedEventArgs* args) {
        PWSTR source{};
        if (FAILED(args->get_Source(&source))) return;
        const bool allowed = trusted(source);
        CoTaskMemFree(source);
        if (!allowed) return;
        PWSTR raw{};
        if (FAILED(args->get_WebMessageAsJson(&raw))) return;
        std::wstring text(raw);
        CoTaskMemFree(raw);
        if (text.size() > 16 * 1024 * 1024) return;
        try {
            run_request(Json::parse(utf8(text)), false);
        } catch (const Json::exception&) {
            // Unparseable: there is no id to answer, so drop it instead of crashing.
        }
    }

    // One bridge request, from parse to reply. `on_worker` is true when this runs on
    // the git worker thread: every git.* call spawns a child process that can block
    // for minutes (a credential prompt on push, a hung remote on fetch) and running
    // those on the WebView2 message thread froze the whole window with no way out.
    // The worker may not touch the WebView2 control either, so its reply is
    // marshalled back to the UI thread by queue_git_reply / drain_git.
    void run_request(const Json& request, bool on_worker) {
        if (routes.empty()) register_routes();
        const auto start = std::chrono::steady_clock::now();
        Json reply = {{"id", 0}, {"ok", false}};
        std::string traced;  // 声明在 try 外面：异常路径也要能写出 "end <method>"
        try {
            if (!request.is_object()) throw taocode::WorkspaceError("INVALID_REQUEST", "请求必须为 JSON 对象");
            if (request.value("type", std::string()) == "documentState") {
                dirty = request.at("dirty").get<bool>();
                return;
            }
            if (request.value("type", std::string()) == "appearance") {
                const auto theme = request.at("theme").get<std::string>();
                if (theme != "light" && theme != "dark") throw taocode::WorkspaceError("INVALID_REQUEST", "未知主题");
                set_theme(theme == "dark");
                return;
            }
            if (!request.contains("id") || !request["id"].is_number_unsigned()) throw taocode::WorkspaceError("INVALID_REQUEST", "请求缺少有效编号");
            reply["id"] = request["id"];
            const auto method = request.at("method").get<std::string>();
            const auto& params = request.at("params");
            if (!params.is_object()) throw taocode::WorkspaceError("INVALID_REQUEST", "参数必须为 JSON 对象");
            Json result;
            if (!on_worker && method.rfind("agent.mcp.", 0) == 0) {
                queue_agent_mcp_request(request);
                return;
            }
            // git.* goes to the worker. One request at a time, in order: git itself
            // takes a lock on .git, so running two at once would only fight over it.
            if (!on_worker && method.rfind("git.", 0) == 0 && is_git_method(method)) {
                git_host->queue_git_request(request);
                return;  // answered by drain_git once the worker is done
            }
            // 带上 kind：`lsp.request` 的三十来个 kind 共用一条分派表，只记方法名分不出卡在哪一步。
            if (taocode::trace::on() && !on_worker) {
                const auto kind = params.value("kind", std::string());
                traced = method + (kind.empty() ? "" : ":" + kind);
                taocode::trace::begin(profile, traced);
            }
            if (clone_active && (method == "workspace.open" || method == "workspace.close" || method == "project.create" || method == "project.clone" || method == "project.settings.update" || method == "file.create" || method == "file.writeNew" || method == "file.rename" || method == "file.delete"))
                throw taocode::WorkspaceError("BUSY", "请先等待克隆完成或取消克隆。");
            // `dap.*` 一族（含 loadedSources/modules 的按需重取、反向调试、内存/反汇编）在
            // native/dap_routes.cpp —— main.cpp 贴着 2000 行硬上限，新能力一律抽模块
            // （与 native/file_queries.cpp 同一种拆法；异步答复已由宿主回调送出，这里直接 return）。
            const auto dap_route = taocode::dap::dispatch_dap_route(method, params, request["id"], *dap_host, result);
            if (dap_route == taocode::dap::RouteOutcome::answered_async) return;
            if (dap_route != taocode::dap::RouteOutcome::unhandled) {}  // result 已由 dap 路由填好
            else if (auto it = routes.find(method); it != routes.end()) result = it->second(params);
            // 文件/系统侧的只读查询（七条）在 native/file_queries.cpp —— main.cpp 贴着 2000 行上限。
            else if (workspace && taocode::dispatch_file_query(method, params, *workspace, result)) {}
            else switch (fnv1a(method)) {
            // 这三条原先写成上面那串 `if (method == …)`：routing-parity 门禁只认带 `_h` 的 case 标签
            // 与 `routes.emplace(…)` 两种形状，写成 if 会让门禁把「前端能发、原生真处理」误报成
            // UNKNOWN_METHOD 风险。搬进 switch 语义不变 —— 三条都不在 clone_active 的禁用表里，
            // 也都不是 git.* / dap.* / agent.mcp.* 前缀；`agent.model.cancel` 原来手写的那段回包
            // 与 switch 尾部统一回包逐字段相同（ok/result/durationMs），因此改走统一路径。
            case "browser.data.clear"_h: {
                const auto mode = params.at("mode").get<std::string>();
                if (mode != "cache" && mode != "all")
                    throw taocode::WorkspaceError("INVALID_REQUEST", "未知的浏览器数据清理模式。");
                const HWND reply_window = window;
                const Json request_id = request["id"];
                embedded_browser_profile.clear_data(mode.c_str(), [reply_window, request_id, start](bool success) {
                    if (!IsWindow(reply_window)) return;
                    auto* target = reinterpret_cast<App*>(GetWindowLongPtrW(reply_window, GWLP_USERDATA));
                    if (!target) return;
                    target->post_json({{"id", request_id}, {"ok", true}, {"result", {{"success", success}}},
                                       {"durationMs", std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count()}});
                });
                return;  // 答复由 clear_data 的回调送出
            }
            case "agent.model.stream"_h: { start_agent_model(request); return; }
            case "agent.model.cancel"_h: { result = {{"stopped", stop_agent_model(params.value("streamId", std::uint64_t{0}), false)}}; break; }
            case "app.state"_h: {
                result = projects->state();
                result["gitAvailable"] = !taocode::find_git_executable().empty();
                result["defaultParent"] = default_parent;
                result["systemDateTimeFormats"] = taocode::system_date_time_formats();
                break;
            }
            case "workspace.open"_h: {
                const Json path = params.contains("path") ? params.at("path") : Json(taocode::dialogs::select_directory(window, L"打开 TaoCode 工作区", params.value("initial", std::string())));
                result = path.is_null() ? Json(nullptr) : open_project(fs::path(wide(path.get<std::string>())));
                if (!result.is_null() && result.contains("root"))
                    taocode::diagnostics::event(profile, "INFO", "打开工作区 " + result.at("root").get<std::string>());
                break;
            }
            case "workspace.close"_h: {
                stop_agent_model();
                workspace_file_search.stop();
                projects->closed();
                stop_run();      // a build must not outlive its project
                stop_search();
                git_host->stop_git();
                // Breakpoints belong to a project: leaving them behind would make the
                // next debug session stop in files that are no longer open.
                dap_host->clear_breakpoints();
                stop_watcher();
                stop_lsp();
                stop_dap();
                terminals->kill_all();
                history.reset();
                workspace = std::make_unique<taocode::Workspace>();
                current_root.clear();
                SetWindowTextW(window, L"欢迎使用 TaoCode");
                if (!current_root.empty()) taocode::diagnostics::event(profile, "INFO", "关闭工作区 " + current_root);
                result = {{"closed", true}};
                break;
            }
            case "project.create"_h: {
                projects->state();
                const auto path = taocode::create_project(fs::path(wide(params.at("parent").get<std::string>())), params.at("name").get<std::string>(), params.at("template").get<std::string>());
                try { result = open_project(path); }
                catch (const std::exception& error) { throw taocode::WorkspaceError("OPEN_FAILED", "项目已创建在 " + utf8(path.native()) + "，但打开失败：" + error.what()); }
                break;
            }
            // 早退的分支不需要 `break;`：`return` 已经离开这个函数（留着就是死代码）。
            case "project.clone"_h: { begin_clone(request["id"], params); return; }
            case "project.clone.cancel"_h: { result = {{"requested", clone_active && clone_thread.request_stop()}}; } break;
            case "projects.forget"_h: {
                result = projects->forget(params.at("path").get<std::string>());
                break;
            }
            case "projects.forgetMany"_h: {
                std::vector<std::string> paths;
                for (const auto& entry : params.at("paths")) paths.push_back(entry.get<std::string>());
                result = projects->forget_many(paths);
                break;
            }
            case "settings.general.update"_h: {
                // GeneralSettings (ide.general.xml): the System Settings page's backing state.
                const auto& patch = params.at("general");
                taocode::validate_general_patch(patch);
                if (patch.contains("embeddedBrowserAllowInsecureCertificates") &&
                    !embedded_browser_profile.set_allow_insecure_certificates(
                        patch.at("embeddedBrowserAllowInsecureCertificates").get<bool>()))
                    throw taocode::WorkspaceError("BROWSER_PROFILE_NOT_READY", "内置浏览器尚未就绪。");
                result = projects->update_general(patch);
                break;
            }
            case "settings.update"_h: {
                result = projects->update_settings(params.at("settings"));
                // "Always show full path in window header" applies live, like every
                // other appearance change in IDEA's dialog.
                if (!current_root.empty()) {
                    const bool full_path = result.is_object() && result.contains("fullPathsInWindowHeader")
                                               && result.at("fullPathsInWindowHeader").is_boolean()
                                               && result.at("fullPathsInWindowHeader").get<bool>();
                    const auto stored_name = projects->state();
                    const std::string name = stored_name.is_object() && stored_name.contains("recentProjects") && stored_name.at("recentProjects").is_array() && !stored_name.at("recentProjects").empty()
                                                 ? stored_name.at("recentProjects").back().value("name", std::string()) : std::string();
                    const std::string heading = full_path ? current_root : name;
                    if (!heading.empty()) SetWindowTextW(window, wide(heading + " — TaoCode").c_str());
                }
                break;
            }
            case "project.settings.get"_h: case "project.settings.update"_h: {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                if (method == "project.settings.get") result = projects->project_settings(current_root);
                else if (params.contains("excludedDirs")) {
                    // Only a new exclusion set changes the tree, so only then is the
                    // workspace handle rebuilt (terminals and LSP sessions stay alive
                    // when just a run configuration is saved).
                    auto candidate = std::make_unique<taocode::Workspace>();
                    const auto opened = candidate->open(fs::path(wide(current_root)), params.at("excludedDirs").get<std::vector<std::string>>());
                    const auto settings = projects->update_project_settings(current_root, params);
                    workspace = std::move(candidate);
                    result = {{"settings", settings}, {"entries", opened.at("entries")}};
                } else {
                    result = {{"settings", projects->update_project_settings(current_root, params)},
                              {"entries", workspace->list("")}};
                        }
                if (params.contains("java") || params.contains("buildTools")) {
                    // 两栏都要带上：`java` 给 JDK 与源根，`buildTools.gradle` 给「Gradle JVM」——
                    // JDT LS 用它去起 Gradle 同步（缺了它，老 Gradle 在服务器的 JRE 21 上起不来）。
                    const auto java = result.at("settings").value("java", Json::object());
                    const auto build_tools = result.at("settings").value("buildTools", Json::object());
                    // 根目录**按值**带走：`current_root` 是 UI 线程写的，在这里读是数据竞争
                    // （换项目与改设置并发时会拿错根，把别处的 jar 物化成 Eclipse 工程）。
                    const auto root = current_root;
                    lsp_worker->post([this, root, java, build_tools] {
                        // 走同一个 java_lsp_model：把「关掉 Gradle 导入」这个开关在设置页上翻过来时，
                        // Eclipse 工程（`.project`/`.classpath`）也得当场物化出来 —— 那是"解析外部"
                        // 真正落地的东西（workspace folder 属于 initialize 参数，要重开会话，见
                        // src/components/GradleSettingsPage.vue 里那一行提示）。
                        if (lsp) lsp->set_configuration("java", taocode::java_lsp_model(fs::path(wide(root)), java, build_tools).settings);
                    });
                }
                break;
            }
            case "workspace.list"_h: {
                result = workspace->list(params.at("path").get<std::string>());
                break;
            }
            case "file.read"_h: {
                result = workspace->read(params.at("path").get<std::string>(), params.value("encoding", std::string("auto")));
                break;
            }
            case "file.write"_h: {
                const auto path = params.at("path").get<std::string>();
                const auto content = params.at("content").get<std::string>();
                result = workspace->write(path, content, params.at("expectedVersion").get<std::string>(),
                                          params.value("encoding", std::string("utf-8")), params.value("bom", false),
                                          params.value("safeWrite", true));
                if (history) {
                    try { history->record(path, content, "save"); }
                    catch (const taocode::WorkspaceError& error) {
                        // History is best-effort and never blocks a save, but silence
                        // would hide a gap in the restore timeline the panel exists for.
                        queue_watch({{"event", "history.note"}, {"path", path}, {"message", std::string(error.what())}});
                    }
                }
                break;
            }
            case "file.writeNew"_h: {
                result = workspace->write_new(params.at("path").get<std::string>(),
                                              params.at("content").get<std::string>());
                break;
            }
            case "file.create"_h: {
                const auto created = params.at("path").get<std::string>();
                result = workspace->create(created, params.value("directory", false), params.value("template", std::string()));
                announce_file_change("created", created);
                break;
            }
            // 「库类型的源码」：JDT 对库类型不给 definition 位置（见 native/library_sources.hpp），
            // 这一条由客户端从工程里的 *-sources.jar 取 `a.b.C` 对应的 .java。
            case "file.librarySource"_h: {
                result = taocode::library_source_json(taocode::find_library_source(
                    fs::path(wide(current_root)), profile / L"library-sources", params.at("qualifier").get<std::string>()));
                break;
            }
            case "file.rename"_h: {
                const auto from = params.at("from").get<std::string>();
                const auto to = params.at("to").get<std::string>();
                result = workspace->rename(from, to);
                announce_file_change("renamed", to, from);
                break;
            }
            case "file.delete"_h: {
                const auto removed = params.at("path").get<std::string>();
                result = workspace->remove(removed, params.value("trash", false));
                announce_file_change("deleted", removed);
                break;
            }
            case "file.copy"_h: {
                result = workspace->copy(params.at("from").get<std::string>(), params.at("to").get<std::string>());
                break;
            }
            case "session.save"_h: {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                result = sessions->save(current_root, params.at("state"));
                break;
            }
            case "session.load"_h: {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                result = sessions->load(current_root);
                break;
            }
            case "session.clear"_h: {
                if (!current_root.empty()) result = sessions->clear(current_root);
                else result = {{"cleared", true}, {"removed", false}};
                break;
            }
            // 五个 lsp.* 一律只投递：UI 线程不再进 Session —— 那里要起子进程、写 stdin 管道、
            // 等 initialize 回应，任何一次阻塞都会把整个窗口拖成"未响应"（见 native/lsp_worker.hpp）。
            // 回包走 `queue_lsp` 这条通道，前端 `pending` 按 id 认领，所以调用契约不变。
            case "lsp.open"_h: {
                const auto id = request["id"];
                post_lsp(id, [this, params] {
                    if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                    const auto path = params.at("path").get<std::string>();
                    const auto language = taocode::lsp::Session::language_for(path);
                    if (!lsp) return Json{{"running", false}, {"language", language}, {"configured", false}};
                    Json opened = lsp->open(path, params.value("text", std::string()));
                    // "没配到服务器"与"服务器正在起"不是一回事：状态栏不能给纯文本文件谎报"正在索引"
                    // （IDEA 只在真正的 dumb mode 下显示该指示器）。
                    opened["configured"] = lsp->has_server(language);
                    return opened;
                });
                trace_posted(traced, profile, "posted");
                return;
            }
            case "lsp.change"_h: {
                const auto id = request["id"];
                post_lsp(id, [this, params] {
                    if (!lsp) throw taocode::WorkspaceError("LSP_UNAVAILABLE", "语言服务未就绪。");
                    lsp->change(params.at("path").get<std::string>(), params.value("text", std::string()));
                    return Json{{"ok", true}};
                });
                trace_posted(traced, profile, "posted");
                return;
            }
            case "lsp.close"_h: {
                const auto id = request["id"];
                post_lsp(id, [this, params] {
                    if (lsp) lsp->close(params.at("path").get<std::string>());
                    return Json{{"ok", true}};
                });
                trace_posted(traced, profile, "posted");
                return;
            }
            // 取消一条语言服务进度：回发 LSP 的 `window/workDoneProgress/cancel`（上游
            // LspServerNotificationsHandlerImpl.kt:286-292 —— 只有服务器声明过 cancellable 才发）。
            case "lsp.cancelProgress"_h: {
                const auto id = request["id"];
                post_lsp(id, [this, params] {
                    if (lsp) lsp->cancel_progress(params.value("language", std::string()), params.value("token", std::string()));
                    return Json{{"ok", true}};
                });
                trace_posted(traced, profile, "posted");
                return;
            }
            case "lsp.stop"_h: {
                const auto id = request["id"];
                taocode::lsp::run_inline(id, [this] { taocode::lsp::recover(lsp_worker, lsp, [this] { stop_lsp_now(); reset_lsp_now(current_root); }, [this](const std::string& why) { taocode::diagnostics::event(profile, "WARN", why); }); return Json{{"ok", true}}; }, [this](Json payload) { queue_lsp(std::move(payload)); });   // 就地跑（不排队）：卡死时也要能恢复，见 native/lsp_recover.cpp
                trace_posted(traced, profile, "inline"); return;
            }
            case "lsp.request"_h: {
                const auto id = request["id"];
                // 回包由 lsp_reply 在服务器答完时发，所以这里只投活儿，不走 post_lsp（否则会抢发第二个 id）。
                lsp_worker->post([this, id, params] {
                    const auto kind = params.value("kind", std::string());
                    const auto path = params.value("path", std::string());
                    const auto lsp_reply = [this, id](Json response, Json error) {
                        queue_lsp(taocode::lsp::lsp_reply_payload(id, std::move(response), std::move(error)));
                    };
                    if (!lsp) {
                        lsp_reply(Json(nullptr), Json{{"code", "LSP_UNAVAILABLE"}, {"message", "语言服务未就绪。"}});
                        return;
                    }
                    // 路由只有这一个入口：semantic 与 request 互为兜底，两张表覆盖全部 kind，这里不许再抄一份清单。
                    lsp->semantic(kind, path, params.value("line", 0), params.value("character", 0),
                        taocode::lsp::forward_arguments(params), lsp_reply);
                });
                trace_posted(traced, profile, "posted");
                return;  // asynchronous; delivered by drain_lsp
            }
            case "run.start"_h: {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                // 未信任项目的硬边界：构建 / 运行 / 外部工具 / 复合配置全走这一条。
                taocode::trusted::require_trusted(general_settings(), current_root, "构建 / 运行");
                // 参数解析、Before launch 链、多实例与 `isAllowRunningInParallel` 语义都在
                // native/run_host.cpp —— 这一层只把结果（实例 id）回给前端。
                result = runs->start(params, fs::path(wide(current_root)));
                break;
            }
            case "run.write"_h: {
                const auto instance = params.value("instance", 0);
                if (!runs->write_line(instance, params.value("line", std::string())))
                    throw taocode::WorkspaceError("NOT_RUNNING", "没有正在运行的任务。");
                result = {{"ok", true}};
                break;
            }
            // `instance` 为 0/缺省 = 停全部（IDEA 的 Stop All）；给 id 就只停那一个。
            case "run.stop"_h: result = runs->stop(params.value("instance", 0)); break;
            // IDEA 的 Run 工具窗口按"正在运行的实例"开标签，所以这条清单是它的输入。
            case "run.instances"_h: result = runs->instances(); break;
            // `git.*` 一族的**实现体**（连同那条工作线程）在 native/git_routes.cpp：main.cpp 贴着
            // tests/module-size.test.mjs 的 2000 行上限，而这一族是它里面最大的一段。`case` 标签留在
            // 原处一个都没动 —— 那是 tests/routing-parity.test.mjs 数方法名的机检锚点，所以那边按
            // "一个方法名一个同名函数"拆，不另开第二张分派表（方法名清单只此一份）。
            // 还没打开项目时 `require_repo_root()` 先抛 NOT_OPEN，那个检查仍留在分派这一层。
            case "git.status"_h: { result = taocode::git_routes::status(require_repo_root(), params); break; }
            case "git.diff"_h: { result = taocode::git_routes::diff(require_repo_root(), params); break; }
            case "git.patch"_h: { result = taocode::git_routes::patch(require_repo_root(), params); break; }
            case "git.diffSides"_h: case "git.compare"_h: { result = taocode::git_routes::diff_sides(require_repo_root(), method, params); break; }
            case "git.stage"_h: case "git.unstage"_h: { result = taocode::git_routes::stage(require_repo_root(), method, params); break; }
            case "git.commit"_h: { result = taocode::git_routes::commit(require_repo_root(), params); break; }
            case "git.checkout"_h: { result = taocode::git_routes::checkout(require_repo_root(), params); break; }
            case "git.log"_h: { result = taocode::git_routes::log(require_repo_root(), params); break; }
            case "git.commitFileDiff"_h:
            case "git.logFull"_h: case "git.commitDetails"_h: case "git.commitChanges"_h: { result = taocode::git_routes::log_request(require_repo_root(), method, params); break; }
            case "git.pull"_h: { result = taocode::git_routes::pull(require_repo_root()); } break;
            case "git.fetch"_h: { result = taocode::git_routes::fetch(require_repo_root()); } break;
            case "git.push"_h: { result = taocode::git_routes::push(require_repo_root()); } break;
            case "git.rebase"_h: { result = taocode::git_routes::rebase(require_repo_root(), params); } break;
            case "git.cherryPick"_h: { result = taocode::git_routes::cherry_pick(require_repo_root(), params); } break;
            case "git.stash"_h: { result = taocode::git_routes::stash(require_repo_root()); break; }
            case "git.stash.save"_h: { result = taocode::git_routes::stash_save(require_repo_root(), params); } break;
            // 空 `ref` = 栈顶（原行为）；带 `stash@{n}` = 按序号取回某一条（搁架面板任意一行）。
            case "git.stash.pop"_h: { result = taocode::git_routes::stash_pop(require_repo_root(), params); } break;
            case "git.branch.create"_h: { result = taocode::git_routes::create_branch(require_repo_root(), params); } break;
            case "git.branch.delete"_h: { result = taocode::git_routes::delete_branch(require_repo_root(), params); } break;
            case "git.revert"_h: { result = taocode::git_routes::revert(require_repo_root(), params); } break;
            case "git.revertCommit"_h: { result = taocode::git_routes::revert_commit(require_repo_root(), params); } break;
            case "git.reset"_h: { result = taocode::git_routes::reset(require_repo_root(), params); break; }
            case "git.merge"_h: { result = taocode::git_routes::merge(require_repo_root(), params); } break;
            case "git.tags"_h: { result = taocode::git_routes::tags(require_repo_root()); break; }
            case "git.tag.create"_h: { result = taocode::git_routes::tag_create(require_repo_root(), params); } break;
            case "git.tag.delete"_h: { result = taocode::git_routes::tag_delete(require_repo_root(), params); } break;
            case "git.ignore"_h: { result = taocode::git_routes::ignore(require_repo_root(), params); } break;
            // IDEA's CommitAuthorComponent reads the repository's configured author; the
            // same values are handed back to `git.commit` when the user overrides them.
            case "git.user"_h: { result = taocode::git_routes::user(require_repo_root()); break; }
            // ...and the *authors* completion list comes from the log users (GitCommitOptionsUi.kt:259).
            case "git.authors"_h: { result = taocode::git_routes::authors(require_repo_root()); break; }
            case "git.diffHunks"_h: { result = taocode::git_routes::diff_hunks(require_repo_root(), params); break; }
            case "git.applyHunks"_h: { result = taocode::git_routes::apply_hunks(require_repo_root(), params); break; }
            case "git.aheadBehind"_h: { result = taocode::git_routes::ahead_behind(require_repo_root()); break; }
            case "git.blame"_h: { result = taocode::git_routes::blame(require_repo_root(), params); break; }
            case "git.fileHistory"_h: { result = taocode::git_routes::file_history(require_repo_root(), params); break; }
            case "git.showCommit"_h: { result = taocode::git_routes::show_commit(require_repo_root(), params); break; }
            case "git.worktree.list"_h: { result = taocode::git_routes::worktree_list(require_repo_root()); break; }
            case "git.worktree.add"_h: { result = taocode::git_routes::worktree_add(require_repo_root(), params); break; }
            case "git.worktree.remove"_h: { result = taocode::git_routes::worktree_remove(require_repo_root(), params); break; }
            case "git.submodules"_h: { result = taocode::git_routes::submodules(require_repo_root()); break; }
            case "git.submodule.update"_h: { result = taocode::git_routes::submodule_update(require_repo_root(), params); break; }
            // Cancels the git command running on the worker right now. IDEAs
            // background-task rows carry a cancel button; git commands are the tasks
            // TaoCode runs in the background, so this is that button's backend.
            case "git.cancel"_h: { result = taocode::git_routes::cancel(); break; }
            case "workspace.searchFiles"_h: { workspace_file_search.start(*workspace, request.at("id"), [this](Json reply) { queue_search(std::move(reply)); }); return; }
            case "workspace.searchFiles.cancel"_h: { result = {{"requested", workspace_file_search.cancel()}}; break; }
            case "search.cancel"_h: { search_cancel.store(true); result = {{"ok", true}}; } break;
            // Find in Files walks up to 100k files, which is far too long to hold the
            // UI thread: it runs on its own thread and answers through the message
            // loop, and `search.cancel` abandons a walk nobody is waiting for any more.
            // `workspace.files` is the same walk without the text search — the scope
            // editor needs the whole project listing, which is equally unbounded.
            case "workspace.files"_h: case "search.run"_h: case "search.replace"_h: case "search.preview"_h: case "search.replaceSelected"_h: {
                const auto repository = fs::path(wide(require_repo_root()));
                taocode::search::Options options;
                options.query = params.value("query", std::string());
                options.regex = params.value("regex", false);
                options.case_sensitive = params.value("caseSensitive", true);
                options.whole_word = params.value("wholeWord", false);
                options.include = taocode::search::parse_patterns(params.value("include", std::string()));
                options.exclude = taocode::search::parse_patterns(params.value("exclude", std::string()));
                options.replacement = params.value("replacement", std::string());
                options.cancelled = [this] { return search_cancel.load(); };
                // 分块发布（上游 `SearchResults` 的 chunk 流）：`search.preview` 一边扫一边把
                // 已经攒够的那几块推给前端，慢搜索也能先看到命中。**只有这条镜像请求会分块**——
                // 替换那几条要的是"整份结果"（勾选/取消勾选都按完整清单对齐），分块只会把它们
                // 拉成两半。`streamId` 由前端给，用来把块认回是哪一次搜索的（并发时尤其重要）。
                if (method == "search.preview") {
                    const auto stream_id = params.value("streamId", std::int64_t{0});
                    options.on_chunk = [this, stream_id](const Json& chunk, std::size_t files) {
                        queue_search(taocode::search::chunk_event(stream_id, chunk, files));
                    };
                }
                std::vector<taocode::search::Selection> selections;
                if (method == "search.replaceSelected") {
                    if (params.contains("matches") && params.at("matches").is_array())
                        for (const auto& item : params.at("matches")) {
                            if (!item.is_object()) continue;
                            taocode::search::Selection selection;
                            selection.path = item.value("path", std::string());
                            selection.line = item.value("line", std::int64_t{0});
                            selection.column = item.value("column", std::int64_t{0});
                            if (!selection.path.empty() && selection.line > 0 && selection.column > 0)
                                selections.push_back(std::move(selection));
                            }
                    if (selections.empty()) throw taocode::WorkspaceError("INVALID_REQUEST", "没有勾选任何要替换的匹配。");
                }
                // 上一次还在跑：**取消并等它收手**，再起新的一次。上游的 Find 是"重按就重启搜索"，
                // 报 BUSY 让用户先去点取消是另一种交互（而且本仓那个取消按钮在结果区里，未必在眼前）。
                // 旧线程的答复照旧推给前端，由那边的世代计数丢掉（`src/components/SearchPanel.vue` 的
                // `searchToken`：迟到的答复不许覆盖更新的结果）。
                if (search_busy.load()) stop_search();
                search_busy.store(true);
                search_cancel.store(false);
                if (search_thread.joinable()) search_thread.join();
                const auto id = request["id"];
                const auto started = std::chrono::steady_clock::now();
                const auto kind = method;
                search_thread = std::thread([this, repository, options, selections, kind, id, started]() noexcept {
                    Json payload{{"id", id}, {"ok", false}};
                    try {
                        if (kind == "workspace.files") payload["result"] = taocode::search::list_files(repository);
                        else if (kind == "search.run") payload["result"] = taocode::search::run(repository, options);
                        else if (kind == "search.preview") payload["result"] = taocode::search::preview(repository, options);
                        else if (kind == "search.replaceSelected") payload["result"] = taocode::search::replace_selected(repository, options, selections);
                        else payload["result"] = taocode::search::replace(repository, options);
                        payload["ok"] = true;
                    } catch (const taocode::WorkspaceError& error) {
                        payload["error"] = {{"code", error.code}, {"message", error.what()}};
                    } catch (const std::exception&) {
                        payload["error"] = {{"code", "SEARCH_FAILED"}, {"message", "搜索失败，请缩小范围后重试。"}};
                    }
                    payload["durationMs"] = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
                    search_busy.store(false);
                    queue_search(std::move(payload));
                });
                return;  // asynchronous; delivered by drain_search
            }
            case "term.create"_h: {
                // 未信任项目的硬边界：终端会执行磁盘上的任何东西（上游把终端归在执行侧门控里）。
                taocode::trusted::require_trusted(general_settings(), current_root, "打开终端");
                // The cwd defaults to the workspace root when the caller omits it
                // (IDEA's "Open Terminal Here" needs a per-directory cwd).
                std::wstring cwd;
                if (params.contains("cwd") && params.at("cwd").is_string() && !params.at("cwd").get<std::string>().empty())
                    cwd = wide(params.at("cwd").get<std::string>());
                else if (!current_root.empty()) cwd = wide(current_root);
                // Remembered so a terminal a debug adapter opens (runInTerminal)
                // comes up at the size the user is actually working at.
                terminal_cols = params.value("cols", terminal_cols);
                terminal_rows = params.value("rows", terminal_rows);
                result = {{"id", terminals->create(terminal_cols, terminal_rows, cwd,
                                                   [this](int id, std::string_view bytes) {
                                                       queue_term({{"event", "term.output"}, {"id", id}, {"dataB64", base64_encode(bytes)}});
                                                   })}};
                break;
            }
            case "term.write"_h: { terminals->write(params.at("id").get<int>(), base64_decode(params.value("dataB64", std::string()))); result = {{"ok", true}}; } break;
            case "term.resize"_h: {
                terminal_cols = params.value("cols", terminal_cols);
                terminal_rows = params.value("rows", terminal_rows);
                terminals->resize(params.at("id").get<int>(), terminal_cols, terminal_rows);
                result = {{"ok", true}};
                break;
            }
            case "term.kill"_h: { terminals->kill(params.at("id").get<int>()); result = {{"ok", true}}; } break;
            // IDEA's terminal tool window keeps a session list so a shell that exited
            // still shows its state; `ids()` was already there, only unreachable.
            case "term.list"_h: {
                Json list = Json::array();
                for (const int id : terminals->ids())
                    list.push_back({{"id", id}, {"running", terminals->running(id)}});
                result = {{"terminals", std::move(list)}};
                break;
            }
            case "history.list"_h: case "history.content"_h: case "history.diff"_h: case "history.diffSides"_h: {
                if (!history) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                const auto path = params.at("path").get<std::string>();
                if (method == "history.list") result = history->list(path);
                else if (method == "history.content") result = history->content(path, params.at("id").get<std::string>());
                else {
                    // The snapshot is compared against the decoded buffer text, so a
                    // GBK file diffs as characters rather than as mojibake bytes.
                    const auto current = workspace->read(path).at("content").get<std::string>();
                    const auto id = params.at("id").get<std::string>();
                    result = method == "history.diff" ? history->diff(path, id, current)
                                                      : history->side_diff(path, id, current);
                                                }
                                            }
            // Plugin extension points: plugins live under the profile and only publish
            // command/template metadata, so "installing" one is a directory copy.
            case "plugin.list"_h: case "plugin.setEnabled"_h: case "plugin.install"_h: case "plugin.uninstall"_h: {
                const fs::path directory = profile / L"plugins";
                if (method == "plugin.list") {
                    fs::create_directories(directory);
                    result = taocode::plugins::to_json(taocode::plugins::list(directory));
                } else if (method == "plugin.install") {
                    // IDEA PluginsConfigurable › Install Plugin from Disk：源目录 → <plugins>/<id>。
                    taocode::plugins::install(directory, fs::path(params.at("source").get<std::string>()));
                    result = taocode::plugins::to_json(taocode::plugins::list(directory));
                } else if (method == "plugin.uninstall") {
                    taocode::plugins::uninstall(directory, params.at("id").get<std::string>());
                    result = taocode::plugins::to_json(taocode::plugins::list(directory));
                } else {
                    taocode::plugins::set_enabled(directory, params.at("id").get<std::string>(), params.value("enabled", true));
                    result = taocode::plugins::to_json(taocode::plugins::list(directory));
                }
                break;
            }
            // IDEA's MemoryUsagePanel reads the JVM heap; the host reports its own
            // process memory instead, which is the real equivalent here.
            case "app.memory"_h: {
                PROCESS_MEMORY_COUNTERS counters{};
                std::uint64_t working = 0, peak = 0, private_bytes = 0;
                if (K32GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters))) {
                    working = counters.WorkingSetSize;
                    peak = counters.PeakWorkingSetSize;
                    private_bytes = counters.PagefileUsage;
                }
                result = {{"workingSetMb", working / (1024 * 1024)},
                          {"peakWorkingSetMb", peak / (1024 * 1024)},
                          {"privateMb", private_bytes / (1024 * 1024)},
                          {"available", working != 0}};
                break;
            }
            // 帮助 › 关于：版本 / 平台 / WebView2 / 关键目录 / 机器上的 JDK（IDEA AboutAction 的等价信息）。
            // 实现在 native/diagnostics.cpp（那里顺带报出 JDK 列表，探测规则见 native/jdk.hpp）。
            case "app.info"_h: result = taocode::diagnostics::app_info(profile, browser_version, taocode::kAppVersion); break;
            // 机器上可用的 JDK（IDEA `JavaHomeFinderBasic.findExistingJdkEntries`）——
            // Java / Gradle 项目打开时用它当默认 SDK 与 Gradle JVM（「IDEA 打开默认就有」的来源）。
            case "app.jdks"_h: result = taocode::jdk::to_json(taocode::jdk::find_all()); break;
            // 帮助 › 显示日志：日志文件与目录（`ShowLogAction.showLog` 的落点）。
            case "app.logPaths"_h: result = taocode::diagnostics::paths(profile); break;
            // 内部错误账（状态栏「内部错误」组件读它）：进程内的计数，不读日志文件（那会把上次启动的算进来）。
            case "app.internalErrors"_h: result = taocode::diagnostics::internal_errors(); break;
            // 帮助 › 浏览特殊目录：IDEA `BrowseSpecialPathsAction` 的目录清单。
            case "app.specialPaths"_h: result = taocode::diagnostics::special_paths(profile, ui.parent_path()); break;
            // 帮助 › 收集日志并打包（`CollectZippedLogsAction` → `LogPacker.packLogs`）。
            case "app.collectLogs"_h: result = taocode::diagnostics::collect_logs(profile); break;
            // 帮助 › 诊断工具 › 复制排障信息（`CollectTroubleshootingInformationAction`）。
            case "app.troubleshooting"_h: result = taocode::diagnostics::troubleshooting(profile, ui.parent_path(), taocode::kAppVersion); break;
            // 文件 › 导出/导入设置（`ExportImportGroup`：ExportSettingsAction / ImportSettingsAction / 恢复默认）。
            // 归档是 native/settings_transfer.cpp 打的（一个 zip + 一份 JSON），校验在写盘**之前**做。
            case "app.exportSettings"_h: result = projects->export_settings(fs::path(wide(params.value("path", std::string())))); break;
            case "app.importSettings"_h: {
                result = projects->import_settings(fs::path(wide(params.value("path", std::string()))));
                const auto imported_general = result.value("general", Json::object());
                embedded_browser_profile.set_allow_insecure_certificates(
                    imported_general.value("embeddedBrowserAllowInsecureCertificates", false));
                break;
            }
            // 只读摘要（不写盘）：UI 要先把这个包里的内容说清楚，用户确认之后才导入。
            case "app.readSettingsArchive"_h: result = taocode::settings_transfer::read_archive_summary(fs::path(wide(params.value("path", std::string())))); break;
            case "app.resetSettings"_h: {
                result = projects->reset_settings();
                embedded_browser_profile.set_allow_insecure_certificates(false);
                break;
            }
            // 通用文件对话框（IDEA `FileChooser`）：导入设置要用"打开文件"，导出要用"保存文件"。
            case "dialog.pickFile"_h: result = taocode::dialogs::pick_file(window, L"选择文件", params.value("filters", std::string()), params.value("initial", std::string())); break;
            case "dialog.saveFile"_h: result = taocode::dialogs::save_file(window, L"保存文件", params.value("filters", std::string()), params.value("name", std::string())); break;
            // 导出（IDEA `ExportToHTMLManager` 落盘那一步）：只写 .html/.htm 的绝对路径，边界见 export_file.hpp。
            // 整形（JSON → Entry）在 export_file.cpp 里 —— main.cpp 贴着机检上限。
            case "app.writeExportFiles"_h: result = taocode::export_file::write_json(params.at("files")); break;
            // 同步：跑一条 Gradle 命令（wrapper 优先，命令行与"是不是 Gradle 项目"都由前端 src/gradle.ts
            // 判断 —— GradleConstants 的两张表只实现一份）；输出与退出码走 `gradle.output`/`gradle.exit` 事件。
            case "gradle.sync"_h: {  // 分派体在 native/gradle.cpp 的 start_sync（上限固定 2000 行，新能力一律抽模块）
                if (!gradle_sync) throw taocode::WorkspaceError("NOT_READY", "Gradle 通道尚未初始化。");
                result = taocode::gradle::start_sync(*gradle_sync, current_root, params,
                    [this](Json payload) { queue_gradle(std::move(payload)); });
                break;
            }
            case "gradle.cancel"_h: {
                if (gradle_sync) gradle_sync->cancel();
                result = {{"cancelled", true}};
                break;
            }
            case "gradle.state"_h: {
                result = {{"running", gradle_sync && gradle_sync->running()}};
                break;
            }
            case "app.quit"_h: { PostMessageW(window, WM_CLOSE, 0, 0); result = {{"closing", true}}; } break;
            // IDEA 的 ToggleFullScreen（View → Appearance → ToggleFullScreenGroup）：实现全在
            // `native/window_state.cpp`（宿主能力），这里一行转发就够。
            case "app.setFullScreen"_h: result = taocode::set_full_screen(params.value("fullScreen", true)); break;
            case "app.fullScreen"_h: result = taocode::full_screen_state(); break;
            // HTTP GET 通道（`native/http_client.cpp`，WinHTTP）—— 前端 `index.html` 的 CSP 是
            // `connect-src 'self' ws://127.0.0.1:5173`，WebView 里 `fetch("https://…")` 被直接拦掉，
            // 所以「打开 http(s) 只读文件」「取远程插件清单」这类取数只能由宿主代做。
            // 这里一行转发；协议白名单/大小上限/超时/参数校验都在 http_get 内部（抛 WorkspaceError）。
            case "http.get"_h: {
                taocode::HttpRequest request_params;
                request_params.url = params.at("url").get<std::string>();
                request_params.limit = params.value("limit", std::size_t{0});
                request_params.timeout_ms = params.value("timeoutMs", std::size_t{0});
                result = taocode::http_get(request_params);
                break;
            }
            case "http.post"_h: {
                taocode::HttpRequest request_params;
                request_params.url = params.at("url").get<std::string>();
                request_params.body = params.at("body").get<std::string>();
                request_params.limit = params.value("limit", std::size_t{0});
                request_params.timeout_ms = params.value("timeoutMs", std::size_t{0});
                const auto& headers = params.at("headers");
                if (!headers.is_object())
                    throw taocode::WorkspaceError("INVALID_REQUEST", "HTTP 请求头必须是对象。");
                for (auto it = headers.begin(); it != headers.end(); ++it) {
                    if (!it.value().is_string())
                        throw taocode::WorkspaceError("INVALID_REQUEST", "HTTP 请求头的值必须是字符串。");
                    request_params.headers.emplace(it.key(), it.value().get<std::string>());
                }
                result = taocode::http_post(request_params);
                break;
            }
            default:
                throw taocode::WorkspaceError("UNKNOWN_METHOD", "该原生方法未开放");
            }
            reply["ok"] = true;
            reply["result"] = std::move(result);
        } catch (const taocode::WorkspaceError& error) {
            reply["error"] = {{"code", error.code}, {"message", error.what()}};
        } catch (const Json::exception&) {
            reply["error"] = {{"code", "INVALID_REQUEST"}, {"message", "JSON 请求或参数格式不正确"}};
        } catch (const std::exception&) {
            reply["error"] = {{"code", "NATIVE_ERROR"}, {"message", "原生操作失败，请检查工作区是否可访问"}};
        }
        reply["durationMs"] = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
        if (!traced.empty()) taocode::trace::end(profile, traced, reply["durationMs"].get<double>());
        if (on_worker) {
            const auto method = request.value("method", std::string());
            if (method.rfind("agent.mcp.", 0) == 0) queue_agent_mcp_reply(std::move(reply));
            else git_host->queue_git_reply(std::move(reply));
        }
        else post_json(reply);
    }

    // Bridge methods that spawn git and must therefore never sit on the UI thread.
    // Kept as an explicit list so a future `git.somethingUI` cannot be swept along.
    static bool is_git_method(const std::string& method) {
        // Kept in sync with the `method == "git.*"` branches below and with the
        // frontend's Method union (src/bridge.ts). A name here that no branch
        // handles would be answered as UNKNOWN_METHOD off the UI thread.
        static const std::set<std::string> methods = {
            "git.status", "git.stage", "git.unstage", "git.commit", "git.rebase", "git.cherryPick",
            "git.user", "git.authors", "git.diff", "git.patch", "git.diffHunks", "git.diffSides", "git.compare", "git.applyHunks",
            "git.log", "git.logFull", "git.commitDetails", "git.commitChanges", "git.commitFileDiff", "git.showCommit", "git.blame", "git.fileHistory",
            "git.checkout", "git.branch.create", "git.branch.delete", "git.merge",
            "git.revert", "git.revertCommit", "git.reset",
            "git.tags", "git.tag.create", "git.tag.delete", "git.ignore",
            "git.fetch", "git.pull", "git.push", "git.aheadBehind",
            "git.stash", "git.stash.save", "git.stash.pop",
            "git.worktree.list", "git.worktree.add", "git.worktree.remove",
            "git.submodules", "git.submodule.update"};
        return methods.count(method) != 0;
    }

    void configure() {
        // A shell that exits on its own must release its slot: without this the 64
        // terminal sessions are eventually all dead-but-held and no new one can spawn.
        terminals->on_exit([this](int id, int code) { queue_term({{"event", "term.exit"}, {"id", id}, {"code", code}}); });
        check(controller->get_CoreWebView2(&webview), "Get WebView");
        ComPtr<ICoreWebView2_3> mapping;
        check(webview.As(&mapping), "Query local asset mapping");
        check(mapping->SetVirtualHostNameToFolderMapping(L"taocode.local", ui.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY), "Map local UI");
        ComPtr<ICoreWebView2Settings> settings;
        check(webview->get_Settings(&settings), "Get WebView settings");
        settings->put_AreDefaultContextMenusEnabled(FALSE);
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_IsZoomControlEnabled(FALSE);
        ComPtr<ICoreWebView2Settings3> settings3;
        if (SUCCEEDED(settings.As(&settings3))) settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
        EventRegistrationToken token{};
        check(webview->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>([this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
            // message() answers every failure itself; this outer guard only catches
            // the unexpected (allocation failure, a bug in a dispatch branch), and it
            // must not swallow it silently: the UI gets an error reply instead of a
            // request that never comes back.
            try {
                message(args);
            } catch (const std::exception& failure) {
                post_json({{"id", 0}, {"ok", false},
                           {"error", {{"code", "NATIVE_CRASH"}, {"message", std::string("原生处理请求时发生异常：") + failure.what()}}}});
            } catch (...) {
                post_json({{"id", 0}, {"ok", false},
                           {"error", {{"code", "NATIVE_CRASH"}, {"message", "原生处理请求时发生未知异常。"}}}});
            }
            return S_OK;
        }).Get(), &token), "Attach bridge");
        check(webview->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
            PWSTR uri{};
            if (SUCCEEDED(args->get_Uri(&uri))) { if (!trusted(uri)) args->put_Cancel(TRUE); CoTaskMemFree(uri); }
            else args->put_Cancel(TRUE);
            return S_OK;
        }).Get(), &token), "Restrict navigation");
        check(webview->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>([](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            args->put_Handled(TRUE);
            return S_OK;
        }).Get(), &token), "Restrict popups");
        check(webview->add_PermissionRequested(Callback<ICoreWebView2PermissionRequestedEventHandler>([](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) -> HRESULT {
            args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);
            return S_OK;
        }).Get(), &token), "Restrict browser permissions");
        check(webview->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>([this](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
            BOOL success{};
            args->get_IsSuccess(&success);
            if (!success) failure("本地界面加载失败");
            else if (GetForegroundWindow() == window) controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            return S_OK;
        }).Get(), &token), "Attach load status");
        check(webview->add_ProcessFailed(Callback<ICoreWebView2ProcessFailedEventHandler>([this](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*) -> HRESULT {
            MessageBoxW(window, L"WebView2 进程异常，未保存内容可能无法恢复。请关闭并重新打开 TaoCode。", L"TaoCode", MB_OK | MB_ICONERROR);
            return S_OK;
        }).Get(), &token), "Attach process status");
        RECT bounds{};
        GetClientRect(window, &bounds);
        controller->put_Bounds(bounds);
        check(webview->Navigate(taocode::ui_url(ui).c_str()), "Load UI");   // ui_url 破缓存：见 webview_options.hpp
    }

    void start() {
        // 第三个参数是环境选项：传了它才能关掉 WebView2 对 `ui` 目录的 HTTP 缓存，
        // 否则重建前端后重启看到的还是旧页面（见 native/webview_options.hpp 的说明）。
        const auto environment_options = taocode::webview_environment_options();
        const auto result = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), environment_options.Get(),
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([this](HRESULT status, ICoreWebView2Environment* environment) -> HRESULT {
                if (FAILED(status) || !environment) { failure("无法初始化 WebView2 环境"); return S_OK; }
                LPWSTR version = nullptr;
                if (SUCCEEDED(environment->get_BrowserVersionString(&version)) && version) {
                    browser_version = utf8(version);
                    CoTaskMemFree(version);
                }
                const auto create = environment->CreateCoreWebView2Controller(window,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([this](HRESULT created, ICoreWebView2Controller* result) -> HRESULT {
                        if (FAILED(created) || !result) { failure("无法创建 WebView2 窗口"); return S_OK; }
                        controller = result;
                        try { configure(); } catch (const std::exception& error) { failure(error.what()); }
                        return S_OK;
                    }).Get());
                if (FAILED(create)) failure("WebView2 控制器初始化失败");
                return S_OK;
            }).Get());
        if (FAILED(result)) failure("无法加载 WebView2 Runtime");
    }
};

LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    auto* app = reinterpret_cast<App*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        app = static_cast<App*>(reinterpret_cast<CREATESTRUCTW*>(lparam)->lpCreateParams);
        app->window = window;
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(app));
    }
    if (app) {
        switch (message) {
        case WM_SETFOCUS:
            if (app->controller) app->controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            return 0;
        case WM_SIZE:
            if (app->controller) { RECT bounds{}; GetClientRect(window, &bounds); app->controller->put_Bounds(bounds); }
            return 0;
        case WM_GETMINMAXINFO: {
            const auto dpi = GetDpiForWindow(window);
            auto* info = reinterpret_cast<MINMAXINFO*>(lparam);
            info->ptMinTrackSize = {MulDiv(920, dpi ? dpi : 96, 96), MulDiv(640, dpi ? dpi : 96, 96)};
            return 0;
        }
        case WM_DPICHANGED: {
            const auto* rect = reinterpret_cast<RECT*>(lparam);
            SetWindowPos(window, nullptr, rect->left, rect->top, rect->right - rect->left, rect->bottom - rect->top, SWP_NOZORDER | SWP_NOACTIVATE);
            return 0;
        }
        case clone_event_message:
            app->drain_clone();
            return 0;
        case lsp_event_message:
            app->drain_lsp();
            return 0;
        case run_event_message:
            app->drain_run();
            return 0;
        case dap_event_message:
            app->drain_dap();
            return 0;
        case term_event_message:
            app->drain_term();
            return 0;
        case watch_event_message:
            app->drain_watch();
            return 0;
        case gradle_event_message:
            app->drain_gradle();
            break;

        case search_event_message:
            app->drain_search();
            break;
        case git_event_message:
            app->git_host->drain_git();
            break;
        case agent_model_event_message:
            app->drain_agent_model();
            return 0;
        case agent_mcp_event_message:
            app->drain_agent_mcp();
            return 0;
        case watch_restart_message:
            app->handle_watch_stopped();
            break;
        case WM_CLOSE:
            if (!app->closing_after_clone && app->dirty && MessageBoxW(window, L"有未保存的修改。确定放弃修改并关闭？", L"TaoCode", MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2) != IDYES) return 0;
            if (app->clone_active) {
                if (!app->closing_after_clone && MessageBoxW(window, L"克隆仍在进行，确定取消克隆并退出？", L"TaoCode", MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) != IDYES) return 0;
                app->closing_after_clone = true;
                app->clone_thread.request_stop();
                return 0;
            }
            app->close_children();  // 每步都记"开始/用时"，卡住的那一步会在日志里露出来
            taocode::diagnostics::event(app->profile, "INFO", "退出 TaoCode");
            if (app->controller) app->controller->Close();
            DestroyWindow(window);
            return 0;
        case WM_DESTROY: PostQuitMessage(0); return 0;
        }
    }
    return DefWindowProcW(window, message, wparam, lparam);
}
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show) {
    const auto com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(com)) return 1;
    int exit_code = 0;
    {
        App app;
        try {
            wchar_t executable[32768]{};
            const auto length = GetModuleFileNameW(nullptr, executable, 32768);
            if (!length || length >= 32768) throw std::runtime_error("无法定位 TaoCode 可执行文件");
            app.ui = fs::path(executable).parent_path() / L"ui";
            PWSTR local{};
            check(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local), "Locate application data");
            app.profile = fs::path(local) / L"TaoCode";
            CoTaskMemFree(local);
            fs::create_directories(app.profile);
            app.projects = std::make_unique<taocode::ProjectStore>(app.profile / L"projects.json");
            app.sessions = std::make_unique<taocode::session::SessionStore>(app.profile / L"sessions");
            // 日志初始化（IDEA 的 PathManager.getLogDir + idea.log）：后续关键事件都往这里写。
            taocode::diagnostics::init(app.profile, taocode::kAppVersion, app.ui);
            taocode::trace::configure(app.profile);   // 锁归属追踪的落点（见 native/request_trace.hpp）
            taocode::trace::install_lsp_slow_write(app.profile);
            app.gradle_sync = std::make_unique<taocode::gradle::SyncSession>();
            // 运行宿主的事件出口就是 `queue_run`（线程安全：内部是 EventChannel）。
            // 语言服务线程要在任何 lsp.* 之前起来（前端一连上就会 open 文档）。
            app.lsp_worker = std::make_unique<taocode::lsp::Worker>();
            app.runs = std::make_unique<taocode::run_host::Manager>([&app](Json event) { app.queue_run(std::move(event)); });
            PWSTR documents{};
            if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Documents, 0, nullptr, &documents))) {
                app.default_parent = utf8(documents);
                CoTaskMemFree(documents);
            }
            if (!fs::exists(app.ui / L"index.html")) throw std::runtime_error("缺少 ui/index.html，请保留可执行文件旁的完整 ui 目录");
            WNDCLASSEXW window_class{sizeof(WNDCLASSEXW)};
            window_class.lpfnWndProc = window_proc;
            window_class.hInstance = instance;
            window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
            // 窗口类图标必须取**自己 PE 里的那份**（native/app-icon.rc 的 IDI_TAOCODE），
            // 不能用系统默认 IDI_APPLICATION —— 否则标题栏/任务栏显示的是通用 Windows 图标，
            // 与资源管理器里 exe 的图标（同一份资源）对不上。第一参 hInstance 而非 nullptr：
            // LoadIconW(nullptr, …) 只认系统 IDI_* 号段。hIconSm 也显式给上：不设的话 Windows
            // 把大图标缩到 16 格，小档（16px）那档是生成器独立重采样的，缩放大图会糊。
            window_class.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
            window_class.hIconSm = LoadIconW(instance, MAKEINTRESOURCEW(1));
            window_class.lpszClassName = L"TaoCodeWindow";
            check(RegisterClassExW(&window_class) ? S_OK : HRESULT_FROM_WIN32(GetLastError()), "Register window");
            const auto window = CreateWindowExW(0, window_class.lpszClassName, L"欢迎使用 TaoCode", WS_OVERLAPPEDWINDOW,
                CW_USEDEFAULT, CW_USEDEFAULT, 1440, 940, nullptr, nullptr, instance, &app);
            if (!window) throw std::runtime_error("无法创建 TaoCode 窗口");
            // 把窗口交给窗口态模块（全屏要用）—— 见 native/window_state.hpp。
            taocode::register_window(window);
            const auto initial_state = app.projects->state();
            const auto general = initial_state.value("general", Json::object());
            app.embedded_browser_profile.start(
                window, app.profile.parent_path() / L"TaoCode-embedded-browser",
                general.value("embeddedBrowserAllowInsecureCertificates", false));
            ShowWindow(window, show);
            app.start();
            MSG message{};
            BOOL result{};
            while ((result = GetMessageW(&message, nullptr, 0, 0)) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
            exit_code = result < 0 ? 1 : static_cast<int>(message.wParam);
        } catch (const std::exception& error) { app.failure(error.what()); exit_code = 1; }
    }
    CoUninitialize();
    return exit_code;
}
