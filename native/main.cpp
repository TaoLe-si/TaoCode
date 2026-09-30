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
#include "workspace.hpp"
#include "window_state.hpp"
#include "projects.hpp"
#include "git_clone.hpp"
#include "git.hpp"
#include "lsp_session.hpp"
#include "lsp_recover.hpp"
#include "lsp_worker.hpp"
#include "request_trace.hpp"
#include "lsp_config.hpp"
#include "jdtls.hpp"
#include "runner.hpp"
#include "run_host.hpp"
#include "search.hpp"
#include "dap.hpp"
#include "terminal.hpp"
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
#include "export_file.hpp"
#include "event_channel.hpp"

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
            return taocode::dialogs::select_directory(window, L"选择项目存放目录", params.value("initial", std::string()));
        });
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

    std::unique_ptr<taocode::dap::Client> dap;
    taocode::EventChannel dap_events;
    Json dap_config;  // optional TaoCode.dap.json: kind -> {command,args,program,cwd}

    std::unique_ptr<taocode::terminal::Manager> terminals = std::make_unique<taocode::terminal::Manager>();
    taocode::EventChannel term_events;
    // Last size the UI asked a terminal for. A reverse `runInTerminal` has no size
    // of its own, so a session the adapter opens reuses what the user is looking at
    // instead of a constant.
    int terminal_cols = 120;
    int terminal_rows = 30;
    // Console windows opened on an adapter's behalf (`runInTerminal` with kind
    // "external") outlive the request: the Runner is kept here until it exits.
    std::mutex external_mutex;
    std::vector<std::unique_ptr<taocode::Runner>> external_runners;

    std::unique_ptr<taocode::history::History> history;  // per-project local history, recreated on open
    std::unique_ptr<taocode::session::SessionStore> sessions;  // crash-recovery drafts, per profile
    // Gradle 同步：独立于"运行控制台"的通道（IDEA 的 Gradle 同步也不占运行按钮）。
    std::unique_ptr<taocode::gradle::SyncSession> gradle_sync;
    taocode::EventChannel gradle_events;

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

    // Every git.* command is a child process; they are drained by one worker so a
    // slow push cannot queue up behind — or freeze — the UI thread.
    std::thread git_thread;
    std::atomic<bool> git_busy{false};
    std::mutex git_mutex;
    std::deque<Json> git_requests;
    // 回复队列原本没有上限（一条回复对应一次请求，天然有界），所以 limit 传 0。
    taocode::EventChannel git_replies;

    void queue_search(Json payload) { search_events.push(std::move(payload), window, search_event_message); }

    void queue_gradle(Json payload) { gradle_events.push(std::move(payload), window, gradle_event_message); }

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

    // console flood guard：超过 2048 条时一条一条丢掉最旧的（保持原语义，所以 drop 传 1）。
    void queue_dap(Json payload) { dap_events.push(std::move(payload), window, dap_event_message, 2048, 1); }

    void drain_dap() {
        if (webview) for (const auto& event : dap_events.take()) post_json(event);
    }

    // Replies from the DAP reader thread must not call post_json directly; funnel
    // them through queue_dap so the WebView2 call stays on the UI thread.
    void dap_reply(Json id, Json result, Json error) {
        Json reply{{"id", id}, {"ok", error.is_null()}};
        if (error.is_null()) reply["result"] = std::move(result);
        else reply["error"] = {{"code", error.is_object() && error.contains("code") && error.at("code").is_string()
                                    ? error.at("code").get<std::string>() : std::string("DAP_FAILED")},
                               {"message", error.is_object() && error.contains("message") && error.at("message").is_string()
                                    ? error.at("message").get<std::string>() : std::string("调试请求失败")}};
        queue_dap(std::move(reply));
    }

    // Best-effort adapter registry beside the exe (mirrors configure_lsp): the UI
    // sends only {kind, program, cwd} and the concrete adapter command/args come
    // from the user's own TaoCode.dap.json. Nothing is bundled.
    void load_dap_config() {
        std::ifstream stream(ui.parent_path() / L"TaoCode.dap.json", std::ios::binary);
        if (!stream) { dap_config = Json::object(); return; }
        try { const Json parsed = Json::parse(stream); dap_config = parsed.is_object() ? parsed : Json::object(); }
        catch (const Json::exception&) { dap_config = Json::object(); }
    }

    taocode::dap::Client& require_dap() {
        if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
        if (!dap) {
            load_dap_config();
            dap = std::make_unique<taocode::dap::Client>();
            // The adapter's own reverse requests. Both are process-wide hooks with a
            // working default inside dap.cpp; installing them routes the request to
            // the real terminal layer / a real nested session instead.
            taocode::dap::Client::set_run_in_terminal_handler(
                [this](const Json& args, std::string& error) { return run_in_terminal(args, error); });
            taocode::dap::Client::set_start_debugging_handler(
                [this](const Json& args, std::string& error) { return start_nested_debug(args, error); });
        }
        dap->set_root(fs::path(wide(current_root)));
        return *dap;
    }

    // NOTE: `workspace/applyEdit` is implemented inside taocode::lsp::Session
    // (lsp_session.cpp: apply_document_edits writes through the workspace layer and
    // refuses anything that escapes the root). The host side only has to react to a
    // server-driven write, which is the edit sink wired below.

    // DAP `runInTerminal` (adapter -> host reverse request). kind "integrated" opens
    // a real ConPTY session in the Terminal tool window and types the command into
    // it; kind "external" opens a detached console window. Failures fill `error`
    // instead of throwing, because the answer travels back as a failed response.
    Json run_in_terminal(const Json& args, std::string& error) {
        const auto kind = args.value("kind", std::string("integrated"));
        std::vector<std::string> command_args;
        if (args.contains("args") && args.at("args").is_array())
            for (const auto& item : args.at("args")) if (item.is_string()) command_args.push_back(item.get<std::string>());
        const auto command = args.value("command", std::string());
        if (command.empty()) { error = "runInTerminal 没有要执行的命令。"; return Json::object(); }
        std::wstring directory = wide(current_root);
        const auto cwd = args.value("cwd", std::string());
        if (!cwd.empty()) {
            const fs::path requested(wide(cwd));
            directory = (requested.is_absolute() ? requested : fs::path(wide(current_root)) / requested).native();
        }
        if (kind == "external") {
            taocode::Runner::Spec spec;
            spec.command = L"cmd.exe";
            spec.arguments = {L"/d", L"/s", L"/c", L"start", wide(args.value("title", std::string("TaoCode"))), wide(command)};
            for (const auto& argument : command_args) spec.arguments.push_back(wide(argument));
            spec.working_directory = fs::path(directory);
            auto console = std::make_unique<taocode::Runner>();
            try {
                console->start(spec, [](const taocode::Runner::Chunk&) {}, [](int) {});
            } catch (const taocode::WorkspaceError& failure) {
                error = failure.what();
                return Json::object();
            }
            const auto pid = console->process_id();
            reap_external_runners();
            { std::lock_guard lock(external_mutex); external_runners.push_back(std::move(console)); }
            // `processId` is the one field the adapter can act on: it lets the
            // debuggee's launcher be waited on or killed later.
            return {{"processId", pid}};
        }
        // Integrated: ConPTY has no "run one command" mode, so a real session is
        // opened and the command line is typed into it. Both pid fields of the
        // DAP answer are optional and the shell's own pid is not ours to report,
        // so an empty body means "started" — the UI shows the session by its id.
        std::string line = command;
        for (const auto& argument : command_args) { line += ' '; line += argument; }
        int id = 0;
        try {
            id = terminals->create(terminal_cols, terminal_rows, directory,
                                   [this](int terminal, std::string_view bytes) {
                                       queue_term({{"event", "term.output"}, {"id", terminal}, {"dataB64", base64_encode(bytes)}});
                                   });
        } catch (const taocode::WorkspaceError& failure) {
            error = failure.what();
            return Json::object();
        }
        terminals->write(id, line + "\r\n");
        queue_term({{"event", "term.opened"}, {"id", id}, {"cwd", cwd.empty() ? current_root : cwd}, {"reason", "runInTerminal"}});
        return Json::object();
    }

    // Drops the console windows the adapter asked for once their child is gone, so
    // a long debug session does not accumulate spent Runner objects.
    void reap_external_runners() {
        std::lock_guard lock(external_mutex);
        std::vector<std::unique_ptr<taocode::Runner>> alive;
        alive.reserve(external_runners.size());
        for (auto& console : external_runners) if (console && console->running()) alive.push_back(std::move(console));
        external_runners.swap(alive);
    }

    // DAP `startDebugging` (adapter -> host reverse request): the nested session
    // replaces the current one, exactly like IDEA launching a child process debug
    // from the debug toolbar — one adapter at a time, the previous one reaped.
    Json start_nested_debug(const Json& args, std::string& error) {
        const Json configuration = args.contains("configuration") && args.at("configuration").is_object()
                                       ? args.at("configuration") : Json::object();
        const auto kind = configuration.value("kind", std::string("cppvsdbg"));
        const Json entry = dap_config.is_object() ? dap_config.value(kind, Json::object()) : Json::object();
        auto command = configuration.value("command", std::string());
        if (command.empty()) command = entry.value("command", std::string());
        if (command.empty()) { error = "没有为 kind \"" + kind + "\" 配置调试适配器。"; return Json::object(); }
        std::vector<std::wstring> arguments;
        const Json args_src = configuration.contains("args") ? configuration.at("args") : entry.value("args", Json::array());
        if (args_src.is_array()) for (const auto& item : args_src) if (item.is_string()) arguments.push_back(wide(item.get<std::string>()));
        auto cwd = configuration.value("cwd", std::string());
        if (cwd.empty()) cwd = current_root;
        auto nested = std::make_unique<taocode::dap::Client>();
        nested->set_root(fs::path(wide(current_root)));
        try {
            nested->start(wide(command), arguments, fs::path(wide(cwd)),
                          [this](Json event) { queue_dap({{"event", "dap.event"}, {"payload", std::move(event)}}); });
        } catch (const taocode::WorkspaceError& failure) {
            error = failure.what();
            return Json::object();
        }
        stop_dap();
        dap = std::move(nested);
        Json request_configuration = configuration;
        if (!request_configuration.contains("request"))
            request_configuration["request"] = entry.value("request", std::string("launch"));
        // The reply arrives on the nested adapter's reader thread, which may answer
        // long after this function gives up waiting (its own request timeout is two
        // minutes). The state therefore lives in a shared_ptr the callback keeps
        // alive: capturing stack locals by reference here was a use-after-free that
        // would corrupt the stack the moment a slow adapter answered.
        struct Startup {
            std::atomic<bool> done{false};
            std::atomic<bool> failed{false};
            std::mutex mutex;
            std::string message;
        };
        auto startup = std::make_shared<Startup>();
        dap->start_debugging(kind, std::move(request_configuration), [startup](Json, Json failure) {
            if (!failure.is_null()) {
                std::lock_guard lock(startup->mutex);
                startup->message = failure.value("message", std::string("调试启动失败"));
                startup->failed.store(true);
            }
            startup->done.store(true);
        });
        // A whole initialize -> launch -> setBreakpoints -> configurationDone handshake
        // legitimately takes a while, so the bound is generous; it exists only so a
        // silent adapter cannot wedge the session that asked for the child.
        for (int waited = 0; !startup->done.load() && waited < 3000; ++waited)
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        if (!startup->done.load()) { error = "调试适配器启动超时。"; return Json::object(); }
        if (startup->failed.load()) {
            std::lock_guard lock(startup->mutex);
            error = startup->message.empty() ? std::string("调试启动失败") : startup->message;
            return Json::object();
        }
        return Json::object();
    }

    void stop_dap() noexcept {
        // Graceful first: `disconnect` asks the adapter to end the session, waits at
        // most 5s for it to actually go away and then shuts the pipes down itself, so
        // this is bounded. shutdown() afterwards is idempotent and is what makes the
        // stop deterministic — it closes stdin, kills the job and joins the reader
        // thread (detaching it instead when it is called *from* that thread, which is
        // what a reverse request does). Destroying the client straight after start()
        // used to detach a still-running reader — a use-after-free that surfaced as
        // random crashes right after a detach.
        // 收摊时必须结束被调试进程（默认语义）；「断开但保留进程」是 dap.disconnect 的显式选项。
        if (dap) { dap->disconnect(true, {}); dap->shutdown(); dap.reset(); }
        reap_external_runners();
    }

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
            {"查找线程", [this] { stop_search(); }}, {"语言服务线程", [this] { if (lsp_worker) lsp_worker->stop(); }},
            {"语言服务子进程", [this] { stop_lsp_now(); }}, {"构建/运行进程", [this] { stop_run(); }}, {"调试适配器", [this] { stop_dap(); }},
            {"目录监听", [this] { stop_watcher(); }}, {"git 工作线程", [this] { stop_git(); }}, {"终端", [this] { terminals->kill_all(); }},
            {"Gradle 同步", [this] { if (gradle_sync) gradle_sync->cancel(); }},  // Gradle 也是子进程：实测 1m15s 的同步是**关窗之后**才写完 daemon 日志的，之前没有一步管它
        };
        for (const auto& step : steps) taocode::diagnostics::run_step(profile, step.first, step.second);
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
            // git.* goes to the worker. One request at a time, in order: git itself
            // takes a lock on .git, so running two at once would only fight over it.
            if (!on_worker && method.rfind("git.", 0) == 0 && is_git_method(method)) {
                queue_git_request(request);
                return;  // answered by drain_git once the worker is done
            }
            // 带上 kind：`lsp.request` 的三十来个 kind 共用一条分派表，只记方法名分不出卡在哪一步。
            if (taocode::trace::on() && !on_worker) {
                const auto kind = params.value("kind", std::string());
                traced = method + (kind.empty() ? "" : ":" + kind);
                taocode::trace::begin(profile, traced);
            }
            if (clone_active && (method == "workspace.open" || method == "workspace.close" || method == "project.create" || method == "project.clone" || method == "project.settings.update" || method == "file.create" || method == "file.rename" || method == "file.delete"))
                throw taocode::WorkspaceError("BUSY", "请先等待克隆完成或取消克隆。");
            Json result;
            if (auto it = routes.find(method); it != routes.end()) result = it->second(params);
            else switch (fnv1a(method)) {
            case "app.state"_h: {
                result = projects->state();
                result["gitAvailable"] = !taocode::find_git_executable().empty();
                result["defaultParent"] = default_parent;
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
                projects->closed();
                stop_run();      // a build must not outlive its project
                stop_search();
                stop_git();
                // Breakpoints belong to a project: leaving them behind would make the
                // next debug session stop in files that are no longer open.
                if (dap) dap->clear_breakpoints();
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
                result = projects->update_general(params.at("general"));
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
                    lsp_worker->post([this, java, build_tools] {
                        if (lsp) lsp->set_configuration("java", taocode::java_lsp_settings(java, build_tools, taocode::default_referenced_libraries(current_root, build_tools.value("gradle", Json::object())), taocode::import_exclusions(current_root, build_tools.value("gradle", Json::object())), taocode::default_source_paths(current_root, build_tools.value("gradle", Json::object()))));
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
            case "file.create"_h: {
                const auto created = params.at("path").get<std::string>();
                result = workspace->create(created, params.value("directory", false), params.value("template", std::string()));
                announce_file_change("created", created);
                break;
            }
            case "file.readOnly"_h: {
                result = workspace->set_read_only(params.at("path").get<std::string>(), params.value("readOnly", true));
                break;
            }
            case "file.lineSeparators"_h: {
                result = workspace->convert_line_separators(params.at("path").get<std::string>(), params.at("separator").get<std::string>(), params.at("content").get<std::string>(), params.at("expectedVersion").get<std::string>());
                break;
            }
            case "file.readBinary"_h: {
                result = workspace->read_binary(params.at("path").get<std::string>(),
                    params.value("limit", std::size_t{1024 * 1024}));
                break;
            }
            // Safe delete: "is anything still referring to this?" answered by a real
            // workspace scan (file + line + preview), so the confirm dialog can show
            // the same rows IDEA's Safe Delete dialog would.
            case "file.usages"_h: {
                result = workspace->usages_of(params.at("path").get<std::string>(),
                    params.value("symbol", std::string()));
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
            case "file.reveal"_h: {
                result = workspace->reveal(params.at("path").get<std::string>());
                break;
            }
            // RevealFileAction for absolute paths: the welcome screen has no workspace yet
            // (welcomeScreen/projectActions/RevealProjectDirAction.kt:25-33).
            case "shell.reveal"_h: {
                result = taocode::reveal_absolute(params.at("path").get<std::string>());
                break;
            }
            // LSP `documentLink.target` 与控制台输出里的 URL：交给系统默认处理器打开。
            // `open_external` 会**拒绝没有协议前缀的字符串** —— 那是一个安全边界，见 workspace.cpp。
            case "shell.openUrl"_h: {
                result = taocode::open_external(params.at("url").get<std::string>());
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
            case "git.status"_h: {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                const auto repository = fs::path(wide(current_root));
                if (!taocode::git::available()) { result = {{"available", false}}; }
                else {
                    Json changes = Json::array();
                    for (const auto& change : taocode::git::status(repository))
                        changes.push_back({{"path", change.path}, {"indexStatus", change.index_status}, {"workStatus", change.work_status},
                                           {"staged", change.staged}, {"untracked", change.untracked}, {"renameFrom", change.rename_from}});
                    result = {{"available", true}, {"head", taocode::git::head(repository)},
                              {"branches", taocode::git::branches(repository)}, {"changes", std::move(changes)}};
                        }
                break;
            }
            case "git.diff"_h: {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                // context = diff 的上下文行数（前端从 generalSettings.diffContextLines 传入；0 = git 默认）。
                result = {{"diff", taocode::git::diff(fs::path(wide(current_root)), params.at("path").get<std::string>(),
                                                      params.value("staged", false), params.value("base", std::string()),
                                                      params.value("context", 0))}};
                break;
            }
            case "git.diffSides"_h: case "git.compare"_h: {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                const auto repository = fs::path(wide(current_root));
                if (method == "git.compare") result = taocode::git::compare(repository, params.at("base").get<std::string>());
                else result = taocode::git::diff_sides(repository, params.at("path").get<std::string>(),
                                                       params.value("staged", false), params.value("base", std::string()), params.value("context", 0));
                break;
            }
            case "git.stage"_h: case "git.unstage"_h: {
                const auto repository = fs::path(wide(require_repo_root()));
                const auto path = params.at("path").get<std::string>();
                if (method == "git.stage") taocode::git::stage(repository, path); else taocode::git::unstage(repository, path);
                result = {{"ok", true}};
                break;
            }
            case "git.commit"_h: {
                taocode::git::commit(fs::path(wide(require_repo_root())), params.value("message", std::string()),
                                     params.value("amend", false), params.value("signoff", false),
                                     params.value("author", std::string()), params.value("authorEmail", std::string()));
                result = {{"ok", true}};
                break;
            }
            case "git.checkout"_h: {
                taocode::git::checkout(fs::path(wide(require_repo_root())), params.at("branch").get<std::string>());
                result = {{"ok", true}};
                break;
            }
            case "git.log"_h: {
                result = taocode::git::log(fs::path(wide(require_repo_root())), params.value("path", std::string()), params.value("limit", 100));
                break;
            }
            case "git.commitFileDiff"_h:
            case "git.logFull"_h: case "git.commitDetails"_h: case "git.commitChanges"_h: {
                result = taocode::git::log_request(fs::path(wide(require_repo_root())), method, params);
                break;
            }
            case "git.pull"_h: { taocode::git::pull(fs::path(wide(require_repo_root()))); result = {{"ok", true}}; } break;
            case "git.fetch"_h: { taocode::git::fetch(fs::path(wide(require_repo_root()))); result = {{"ok", true}}; } break;
            case "git.push"_h: { taocode::git::push(fs::path(wide(require_repo_root()))); result = {{"ok", true}}; } break;
            case "git.rebase"_h: { taocode::git::rebase(fs::path(wide(require_repo_root())), params.value("branch", std::string())); result = {{"ok", true}}; } break;
            case "git.cherryPick"_h: { taocode::git::cherry_pick(fs::path(wide(require_repo_root())), params.at("commit").get<std::string>()); result = {{"ok", true}}; } break;
            case "git.stash"_h: {
                result = taocode::git::stash_list(fs::path(wide(require_repo_root())));
                break;
            }
            case "git.stash.save"_h: { taocode::git::stash_save(fs::path(wide(require_repo_root())), params.value("message", std::string())); result = {{"ok", true}}; } break;
            case "git.stash.pop"_h: { taocode::git::stash_pop(fs::path(wide(require_repo_root()))); result = {{"ok", true}}; } break;
            case "git.branch.create"_h: { taocode::git::create_branch(fs::path(wide(require_repo_root())), params.at("name").get<std::string>(), params.value("checkout", false)); result = {{"ok", true}}; } break;
            case "git.branch.delete"_h: { taocode::git::delete_branch(fs::path(wide(require_repo_root())), params.at("name").get<std::string>()); result = {{"ok", true}}; } break;
            case "git.revert"_h: { taocode::git::revert(fs::path(wide(require_repo_root())), params.at("path").get<std::string>()); result = {{"ok", true}}; } break;
            case "git.reset"_h: {
                result = taocode::git::reset(fs::path(wide(require_repo_root())), params.at("target").get<std::string>(), params.value("mode", std::string("mixed")));
                break;
            }
            case "git.merge"_h: { taocode::git::merge(fs::path(wide(require_repo_root())), params.at("branch").get<std::string>()); result = {{"ok", true}}; } break;
            case "git.tags"_h: {
                result = taocode::git::tag_list(fs::path(wide(require_repo_root())));
                break;
            }
            case "git.tag.create"_h: { taocode::git::tag_create(fs::path(wide(require_repo_root())), params.at("name").get<std::string>(), params.value("target", std::string())); result = {{"ok", true}}; } break;
            case "git.tag.delete"_h: { taocode::git::tag_delete(fs::path(wide(require_repo_root())), params.at("name").get<std::string>()); result = {{"ok", true}}; } break;
            case "git.ignore"_h: { taocode::git::ignore_path(fs::path(wide(require_repo_root())), params.at("path").get<std::string>()); result = {{"ok", true}}; } break;
            // IDEA's CommitAuthorComponent reads the repository's configured author; the
            // same values are handed back to `git.commit` when the user overrides them.
            case "git.user"_h: {
                result = taocode::git::user(fs::path(wide(require_repo_root())));
                break;
            }
            // ...and the *authors* completion list comes from the log users (GitCommitOptionsUi.kt:259).
            case "git.authors"_h: {
                result = taocode::git::authors(fs::path(wide(require_repo_root())));
                break;
            }
            case "git.diffHunks"_h: {
                result = taocode::git::diff_hunks(fs::path(wide(require_repo_root())), params.at("path").get<std::string>(), params.value("staged", false));
                break;
            }
            case "git.applyHunks"_h: {
                taocode::git::apply_hunks(fs::path(wide(require_repo_root())), params.at("path").get<std::string>(),
                                          params.value("staged", false), params.at("hunks").get<std::vector<int>>(), params.value("reverse", false));
                result = {{"ok", true}};
                break;
            }
            case "git.aheadBehind"_h: {
                result = taocode::git::ahead_behind(fs::path(wide(require_repo_root())));
                break;
            }
            case "git.blame"_h: {
                result = taocode::git::blame(fs::path(wide(require_repo_root())), params.at("path").get<std::string>());
                break;
            }
            case "git.fileHistory"_h: {
                result = taocode::git::file_history(fs::path(wide(require_repo_root())), params.at("path").get<std::string>(), params.value("limit", 100));
                break;
            }
            case "git.showCommit"_h: {
                result = taocode::git::show_commit(fs::path(wide(require_repo_root())), params.at("revision").get<std::string>());
                break;
            }
            case "git.worktree.list"_h: {
                result = taocode::git::worktree_list(fs::path(wide(require_repo_root())));
                break;
            }
            case "git.worktree.add"_h: {
                const auto repository = fs::path(wide(require_repo_root()));
                taocode::git::worktree_add(repository, params.at("path").get<std::string>(),
                                           params.value("branch", std::string()), params.value("newBranch", false));
                // Return the refreshed list so the UI cannot show a stale tree after a
                // mutation it just performed.
                result = taocode::git::worktree_list(repository);
                break;
            }
            case "git.worktree.remove"_h: {
                const auto repository = fs::path(wide(require_repo_root()));
                taocode::git::worktree_remove(repository, params.at("path").get<std::string>(), params.value("force", false));
                result = taocode::git::worktree_list(repository);
                break;
            }
            case "git.submodules"_h: {
                result = taocode::git::submodule_status(fs::path(wide(require_repo_root())));
                break;
            }
            case "git.submodule.update"_h: {
                const auto repository = fs::path(wide(require_repo_root()));
                taocode::git::submodule_update(repository, params.value("init", true), params.value("recursive", false));
                result = taocode::git::submodule_status(repository);
                break;
            }
            // Cancels the git command running on the worker right now. IDEAs
            // background-task rows carry a cancel button; git commands are the tasks
            // TaoCode runs in the background, so this is that button's backend.
            case "git.cancel"_h: {
                taocode::git::request_cancel();
                result = {{"ok", true}};
                break;
            }
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
                if (search_busy.exchange(true)) throw taocode::WorkspaceError("BUSY", "已有搜索在进行中，请先取消或等待。");
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
            case "dap.start"_h: {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                load_dap_config();
                auto& client = require_dap();
                client.shutdown();  // restart semantics: reap any prior adapter first
                const auto kind = params.value("kind", std::string("cppvsdbg"));
                const Json entry = dap_config.is_object() ? dap_config.value(kind, Json::object()) : Json::object();
                auto command = params.value("command", std::string());
                if (command.empty()) command = entry.value("command", std::string());
                if (command.empty()) throw taocode::WorkspaceError("DAP_NO_ADAPTER", "未找到调试适配器：请在 exe 旁的 TaoCode.dap.json 为 kind \"" + kind + "\" 配置 command。");
                std::vector<std::wstring> arguments;
                const Json args_src = params.contains("args") ? params.at("args") : (entry.contains("args") ? entry.at("args") : Json::array());
                if (args_src.is_array()) for (const auto& item : args_src) if (item.is_string()) arguments.push_back(wide(item.get<std::string>()));
                auto cwd = params.value("cwd", std::string());
                if (cwd.empty()) cwd = entry.value("cwd", std::string());
                if (cwd.empty()) cwd = current_root;
                Json configuration{{"name", "TaoCode"}, {"kind", kind},
                                   {"request", entry.value("request", std::string("launch"))},
                                   {"program", params.value("program", std::string())}, {"cwd", cwd},
                                   {"stopOnEntry", params.value("stopOnEntry", false)}};
                if (params.contains("args")) configuration["args"] = params.at("args");
                if (params.contains("env")) configuration["env"] = params.at("env");
                if (params.contains("configuration") && params.at("configuration").is_object())
                    for (auto& item : params.at("configuration").items()) configuration[item.key()] = item.value();
                const auto id = request["id"];
                client.start(wide(command), arguments, fs::path(wide(cwd)),
                             [this](Json event) { queue_dap({{"event", "dap.event"}, {"payload", std::move(event)}}); });
                client.start_debugging(kind, std::move(configuration), [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
                return;  // async; delivered through drain_dap
            }
            case "dap.setBreakpoints"_h: {
                auto& client = require_dap();
                if (!params.contains("breakpoints") || !params.at("breakpoints").is_array())
                    throw taocode::WorkspaceError("INVALID_REQUEST", "breakpoints 必须是数组（{line, condition?…}）。");
                for (const auto& point : params.at("breakpoints")) {
                    if (!point.is_object() || !point.contains("line") || !point.at("line").is_number_integer())
                        throw taocode::WorkspaceError("INVALID_REQUEST", "断点必须带有整数 line。");
                    }
                const auto id = request["id"];
                client.set_breakpoints(params.at("path").get<std::string>(), params.at("breakpoints"),
                                       [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
                return;
            }
            case "dap.continue"_h: case "dap.pause"_h: case "dap.next"_h: case "dap.stepIn"_h: case "dap.stepOut"_h: {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto thread = static_cast<long>(params.value("threadId", 1));
                const auto id = request["id"];
                const auto cb = [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); };
                if (method == "dap.continue") client.continue_execution(thread, params.value("all", false), cb);
                else if (method == "dap.pause") client.pause(thread, cb);
                else if (method == "dap.next") client.next(thread, cb);
                else if (method == "dap.stepIn") client.step_in(thread, cb);
                else client.step_out(thread, cb);
                return;
            }
            case "dap.stackTrace"_h: case "dap.scopes"_h: case "dap.variables"_h: {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto id = request["id"];
                const auto cb = [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); };
                if (method == "dap.stackTrace") client.stack_trace(static_cast<long>(params.value("threadId", 1)), cb);
                else if (method == "dap.scopes") client.scopes(static_cast<long>(params.value("frameId", 0)), cb);
                else client.variables(static_cast<long>(params.value("reference", 0)), cb);
                return;
            }
            // IDEA 的 XValue.setValue（Variables 树里改值）与 Watches 视图的「Set Value」。
            case "dap.setVariable"_h: case "dap.setExpression"_h: {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto id = request["id"];
                const auto cb = [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); };
                const auto value = params.value("value", std::string());
                if (method == "dap.setVariable") {
                    const auto name = params.value("name", std::string());
                    if (name.empty()) throw taocode::WorkspaceError("INVALID_REQUEST", "setVariable 需要变量名。");
                    client.set_variable(static_cast<long>(params.value("reference", 0)), name, value, cb);
                }
                else {
                    const auto expression = params.value("expression", std::string());
                    if (expression.empty()) throw taocode::WorkspaceError("INVALID_REQUEST", "setExpression 需要表达式。");
                    client.set_expression(expression, value, static_cast<long>(params.value("frameId", 0)), cb);
                }
                return;
            }
            case "dap.evaluate"_h: {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto id = request["id"];
                const auto cb = [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); };
                client.request("evaluate", {{"expression", params.value("expression", std::string())},
                                            {"context", params.value("context", std::string("hover"))},
                                            {"frameId", params.value("frameId", 0)}}, cb);
                return;
            }
            case "dap.breakpoints"_h: { result = {{"breakpoints", dap ? dap->breakpoint_map() : Json::object()}}; } break;
            case "dap.setExceptionBreakpoints"_h: {
                require_dap().set_exception_breakpoints(params.at("filters"), [this, id = request["id"]](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
                return;  // async; delivered through drain_dap
            }
            case "dap.breakpointLocations"_h: {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto path = params.value("path", std::string());
                // 空路径会被 `to_uri("")` 解释成工作区根目录，适配器只能答"没有位置" ——
                // 那不是"这一行不能放断点"，而是调用方忘了传。别让它伪装成前者。
                if (path.empty()) throw taocode::WorkspaceError("INVALID_REQUEST", "断点位置预览需要一个文件路径。");
                const auto id = request["id"];
                client.breakpoint_locations(path, static_cast<long>(params.value("line", 0)),
                                            static_cast<long>(params.value("endLine", 0)),
                                            static_cast<long>(params.value("column", 0)),
                                            static_cast<long>(params.value("endColumn", 0)),
                                            [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
            } break;
            case "dap.completions"_h: {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto text = params.value("text", std::string());
                if (text.empty()) throw taocode::WorkspaceError("INVALID_REQUEST", "补全需要一段表达式文本。");
                const auto id = request["id"];
                // 规范里 `column` 是 **1 基**（"The position within `text` ... (1-based)"），
                // 所以缺省值是"光标在末尾"= length + 1，不是 length。
                client.completions(text, static_cast<long>(params.value("column", text.size() + 1)),
                                   static_cast<long>(params.value("frameId", 0)),
                                   static_cast<long>(params.value("line", 0)),
                                   [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
            } break;
            case "dap.exceptionInfo"_h: {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto id = request["id"];
                const auto cb = [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); };
                client.exception_details(static_cast<long>(params.value("threadId", 1)), cb);
            } break;
            case "dap.threads"_h: {
                require_dap().threads([this, id = request["id"]](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
                return;  // async; delivered through drain_dap
            }
            // IDEA 的「运行到光标处」（Alt+F9）：先 gotoTargets 问目标，再 goto 跳过去。
            case "dap.gotoTargets"_h: {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto id = request["id"];
                client.goto_targets(params.value("path", std::string()), static_cast<long>(params.value("line", 1)),
                                    static_cast<long>(params.value("column", 0)),
                                    [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
                return;
            }
            case "dap.goto"_h: {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto id = request["id"];
                client.goto_target(static_cast<long>(params.value("threadId", 1)),
                                   static_cast<long>(params.value("targetId", 0)),
                                   [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
                return;
            }
            // IDEA Frames 视图的「丢弃帧」。
            case "dap.restartFrame"_h: {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto id = request["id"];
                client.restart_frame(static_cast<long>(params.value("frameId", 0)),
                                     [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
                return;
            }
            // IDEA 的「停止」：先让适配器 terminate（不支持该请求的适配器退化成
            // disconnect{terminateDebuggee:true}），**回调里**再收摊 —— 以前两个方法都只是
            // stop_dap()，等于从不发 DAP 的 terminate/disconnect，目标进程的去留全靠杀 job。
            case "dap.terminate"_h: {
                auto& client = require_dap();
                const auto id = request["id"];
                client.terminate([this, id](Json, Json error) {
                    stop_dap();
                    dap_reply(id, Json{{"ok", true}}, error);
                });
                return;
            }
            // IDEA 的「断开」：`terminate: false` 只断开、留着目标进程继续跑（远程附加的常见诉求）；
            // 缺省 true 与「停止」一致。断开后客户端被丢弃，下一次 start 会拿到全新的适配器。
            case "dap.disconnect"_h: {
                auto& client = require_dap();
                const auto id = request["id"];
                const bool terminate_debuggee = params.value("terminate", true);
                client.disconnect(terminate_debuggee, [this, id](Json, Json error) {
                    stop_dap();
                    dap_reply(id, Json{{"ok", true}}, error);
                });
                return;
            }
            // IDEA 的「重新运行」（Ctrl+F5）：适配器声明了 supportsRestartRequest 就原地重启，
            // 否则回 DAP_UNSUPPORTED，调用方退化成"停止 + 重新启动"。
            case "dap.restart"_h: {
                auto& client = require_dap();
                const auto id = request["id"];
                Json arguments = params.contains("arguments") && params.at("arguments").is_object()
                                     ? params.at("arguments") : Json::object();
                client.restart(std::move(arguments), [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
                return;
            }
            case "term.create"_h: {
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
            // 帮助 › 浏览特殊目录：IDEA `BrowseSpecialPathsAction` 的目录清单。
            case "app.specialPaths"_h: result = taocode::diagnostics::special_paths(profile, ui.parent_path()); break;
            // 帮助 › 收集日志并打包（`CollectZippedLogsAction` → `LogPacker.packLogs`）。
            case "app.collectLogs"_h: result = taocode::diagnostics::collect_logs(profile); break;
            // 帮助 › 诊断工具 › 复制排障信息（`CollectTroubleshootingInformationAction`）。
            case "app.troubleshooting"_h: result = taocode::diagnostics::troubleshooting(profile, ui.parent_path(), taocode::kAppVersion); break;
            // 文件 › 导出/导入设置（`ExportImportGroup`：ExportSettingsAction / ImportSettingsAction / 恢复默认）。
            // 归档是 native/settings_transfer.cpp 打的（一个 zip + 一份 JSON），校验在写盘**之前**做。
            case "app.exportSettings"_h: result = projects->export_settings(fs::path(wide(params.value("path", std::string())))); break;
            case "app.importSettings"_h: result = projects->import_settings(fs::path(wide(params.value("path", std::string())))); break;
            // 只读摘要（不写盘）：UI 要先把这个包里的内容说清楚，用户确认之后才导入。
            case "app.readSettingsArchive"_h: result = taocode::settings_transfer::read_archive_summary(fs::path(wide(params.value("path", std::string())))); break;
            case "app.resetSettings"_h: result = projects->reset_settings(); break;
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
        if (on_worker) queue_git_reply(std::move(reply));
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
            "git.user", "git.authors", "git.diff", "git.diffHunks", "git.diffSides", "git.compare", "git.applyHunks",
            "git.log", "git.logFull", "git.commitDetails", "git.commitChanges", "git.commitFileDiff", "git.showCommit", "git.blame", "git.fileHistory",
            "git.checkout", "git.branch.create", "git.branch.delete", "git.merge",
            "git.revert", "git.reset",
            "git.tags", "git.tag.create", "git.tag.delete", "git.ignore",
            "git.fetch", "git.pull", "git.push", "git.aheadBehind",
            "git.stash", "git.stash.save", "git.stash.pop",
            "git.worktree.list", "git.worktree.add", "git.worktree.remove",
            "git.submodules", "git.submodule.update"};
        return methods.count(method) != 0;
    }

    void queue_git_reply(Json payload) { git_replies.push(std::move(payload), window, git_event_message, 0); }

    void drain_git() {
        if (!webview) return;
        for (const auto& reply : git_replies.take()) post_json(reply);
        // The queue emptied out: tell the UI there is no git work in flight, so the
        // status-bar indicator settles even when the last reply was an error.
        std::size_t queued = 0;
        bool busy = false;
        {
            std::lock_guard lock(git_mutex);
            queued = git_requests.size();
            busy = git_busy.load();
        }
        if (!queued && !busy) post_json(Json{{"event", "git.progress"}, {"queued", 0}, {"running", false}});
    }

    void queue_git_request(const Json& request) {
        bool inherited = false;
        {
            std::lock_guard lock(git_mutex);
            git_requests.push_back(request);
            if (git_busy.load()) inherited = true;  // the running worker will pick this up
            else git_busy.store(true);
        }
        // Never under the lock: publish_git_progress() takes the same mutex.
        publish_git_progress();
        if (inherited) return;
        if (git_thread.joinable()) git_thread.join();
        git_thread = std::thread([this] { git_worker(); });
    }

    // IDEA's status bar shows the queue behind the running git command: "正在获取
    // 变更…（还有 2 个操作）". The counts are real (deque sizes under the lock), so
    // the indicator can never claim work that is not there.
    void publish_git_progress() {
        std::size_t queued = 0;
        bool busy = false;
        {
            std::lock_guard lock(git_mutex);
            queued = git_requests.size();
            busy = git_busy.load();
        }
        Json event{{"event", "git.progress"}, {"queued", queued}, {"running", busy}};
        queue_git_reply(std::move(event));
    }

    // Progress events ride the same WM_APP+8 marshalling as the git replies（就是同一条队列，
    // 前端按有没有 `id` 分辨回复与事件），所以这里直接复用 queue_git_reply。

    void git_worker() {
        for (;;) {
            Json request;
            {
                std::lock_guard lock(git_mutex);
                if (git_requests.empty()) { git_busy.store(false); break; }
                request = std::move(git_requests.front());
                git_requests.pop_front();
            }
            run_request(request, true);
        }
        // Outside the lock, like every other publish.
        publish_git_progress();
    }

    // Closing the project or the window drops queued work and waits for the one
    // command already running. git.cpp bounds every child with a timeout, so this
    // cannot hang on a hung remote — and a half-finished push must not keep running
    // against a workspace the UI has already let go of.
    void stop_git() {
        {
            std::lock_guard lock(git_mutex);
            git_requests.clear();
        }
        taocode::git::request_cancel();
        if (git_thread.joinable()) git_thread.join();
        git_busy.store(false);
        git_replies.take();  // 丢掉还没发出去的回复（窗口/项目已经放开了）
        if (webview) post_json(Json{{"event", "git.progress"}, {"queued", 0}, {"running", false}});
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
            app->drain_git();
            break;
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
            window_class.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
            window_class.lpszClassName = L"TaoCodeWindow";
            check(RegisterClassExW(&window_class) ? S_OK : HRESULT_FROM_WIN32(GetLastError()), "Register window");
            const auto window = CreateWindowExW(0, window_class.lpszClassName, L"欢迎使用 TaoCode", WS_OVERLAPPEDWINDOW,
                CW_USEDEFAULT, CW_USEDEFAULT, 1440, 940, nullptr, nullptr, instance, &app);
            if (!window) throw std::runtime_error("无法创建 TaoCode 窗口");
            // 把窗口交给窗口态模块（全屏要用）—— 见 native/window_state.hpp。
            taocode::register_window(window);
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
