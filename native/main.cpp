#include <windows.h>
#include <psapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <dwmapi.h>
#include <wrl.h>
#include <WebView2.h>
#include <chrono>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <map>
#include <set>
#include <string>
#include <deque>
#include <memory>
#include <mutex>
#include <thread>
#include "workspace.hpp"
#include "projects.hpp"
#include "git_clone.hpp"
#include "git.hpp"
#include "lsp_session.hpp"
#include "runner.hpp"
#include "search.hpp"
#include "dap.hpp"
#include "terminal.hpp"
#include "history.hpp"
#include "session.hpp"
#include "watcher.hpp"
#include "plugins.hpp"
#include "history.hpp"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using taocode::Json;
namespace fs = std::filesystem;

namespace {
constexpr wchar_t app_url[] = L"https://taocode.local/index.html";
constexpr wchar_t app_origin[] = L"https://taocode.local/";
constexpr UINT clone_event_message = WM_APP + 1;
constexpr UINT lsp_event_message = WM_APP + 2;
constexpr UINT run_event_message = WM_APP + 3;
constexpr UINT dap_event_message = WM_APP + 4;
constexpr UINT term_event_message = WM_APP + 5;
constexpr UINT watch_event_message = WM_APP + 6;
constexpr UINT search_event_message = WM_APP + 7;
constexpr UINT git_event_message = WM_APP + 8;
constexpr UINT watch_restart_message = WM_APP + 9;

std::string utf8(const std::wstring& value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (!size) throw std::runtime_error("Invalid UTF-16");
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
    return result;
}
std::wstring wide(const std::string& value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (!size) throw std::runtime_error("Invalid UTF-8");
    std::wstring result(size, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size);
    return result;
}
// Console bytes are arbitrary (code pages, not guaranteed UTF-8), so the terminal
// channel carries them base64-encoded to keep the JSON bridge pure ASCII.
std::string base64_encode(std::string_view in) {
    static constexpr char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve((in.size() + 2) / 3 * 4);
    std::size_t i = 0;
    for (; i + 3 <= in.size(); i += 3) {
        const unsigned n = (static_cast<unsigned char>(in[i]) << 16) | (static_cast<unsigned char>(in[i + 1]) << 8) | static_cast<unsigned char>(in[i + 2]);
        out += table[(n >> 18) & 63]; out += table[(n >> 12) & 63]; out += table[(n >> 6) & 63]; out += table[n & 63];
    }
    if (i + 1 == in.size()) {
        const unsigned n = static_cast<unsigned char>(in[i]) << 16;
        out += table[(n >> 18) & 63]; out += table[(n >> 12) & 63]; out += "==";
    } else if (i + 2 == in.size()) {
        const unsigned n = (static_cast<unsigned char>(in[i]) << 16) | (static_cast<unsigned char>(in[i + 1]) << 8);
        out += table[(n >> 18) & 63]; out += table[(n >> 12) & 63]; out += table[(n >> 6) & 63]; out += '=';
    }
    return out;
}
std::string base64_decode(std::string_view in) {
    const auto value = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '+') return 62;
        if (c == '/') return 63;
        return -1;  // '=' padding and stray whitespace are skipped
    };
    std::string out;
    out.reserve(in.size() / 4 * 3);
    int buffer = 0, bits = 0;
    for (const char c : in) {
        const int v = value(c);
        if (v < 0) continue;
        buffer = (buffer << 6) | v;
        bits += 6;
        if (bits >= 8) { bits -= 8; out.push_back(static_cast<char>((buffer >> bits) & 0xff)); }
    }
    return out;
}
bool trusted(const wchar_t* uri) {
    return uri && std::wstring_view(uri).starts_with(app_origin);
}
// Deterministic 64-bit FNV-1a of the workspace root, hex-encoded, used only as a
// filesystem-safe history folder name. Stable across restarts (unlike std::hash).
std::string store_hash(const std::string& value) {
    std::uint64_t hash = 1469598103934665603ULL;
    for (const unsigned char ch : value) { hash ^= ch; hash *= 1099511628211ULL; }
    static constexpr char digits[] = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 15; i >= 0; --i) { out[static_cast<std::size_t>(i)] = digits[hash & 15]; hash >>= 4; }
    return out;
}
void check(HRESULT result, const char* operation) {
    if (FAILED(result)) throw std::runtime_error(std::string(operation) + " failed (HRESULT " + std::to_string(static_cast<unsigned long>(result)) + ")");
}

struct App {
    HWND window{};
    fs::path ui;
    fs::path profile;
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
    std::mutex clone_mutex;
    std::deque<Json> clone_events;
    std::jthread clone_thread;

    std::unique_ptr<taocode::lsp::Session> lsp;
    std::mutex lsp_mutex;
    std::deque<Json> lsp_events;

    std::unique_ptr<taocode::Runner> runner;
    std::mutex run_mutex;
    std::deque<Json> run_events;

    // IDEA's Run Configuration "Before launch" list: the steps run one after another
    // and a non-zero exit aborts the chain, so a program is never launched against a
    // build that just failed. The pending step lives here until the UI thread has
    // delivered the previous step's exit event.
    struct RunStep {
        std::string label;
        std::string command;
        std::string program;
        std::string cwd;
        std::vector<std::string> args;
        std::vector<std::string> environment;
        bool shell = true;
    };
    std::deque<RunStep> run_steps;
    bool run_pending_continue = false;
    int run_last_code = 0;

    std::unique_ptr<taocode::dap::Client> dap;
    std::mutex dap_mutex;
    std::deque<Json> dap_events;
    Json dap_config;  // optional TaoCode.dap.json: kind -> {command,args,program,cwd}

    std::unique_ptr<taocode::terminal::Manager> terminals = std::make_unique<taocode::terminal::Manager>();
    std::mutex term_mutex;
    std::deque<Json> term_events;
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

    // IDE-03 file watching: one recursive ReadDirectoryChangesW thread per open
    // workspace; batches are debounced natively and forwarded as fs.changed.
    std::unique_ptr<taocode::watcher::Watcher> watcher;
    std::mutex watch_mutex;
    std::deque<Json> watch_events;
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
    std::mutex search_mutex;
    std::deque<Json> search_events;

    // Every git.* command is a child process; they are drained by one worker so a
    // slow push cannot queue up behind — or freeze — the UI thread.
    std::thread git_thread;
    std::atomic<bool> git_busy{false};
    std::mutex git_mutex;
    std::deque<Json> git_requests;
    std::deque<Json> git_replies;

    void queue_search(Json payload) {
        {
            std::lock_guard lock(search_mutex);
            search_events.push_back(std::move(payload));
        }
        PostMessageW(window, search_event_message, 0, 0);
    }

    void drain_search() {
        std::deque<Json> events;
        { std::lock_guard lock(search_mutex); events.swap(search_events); }
        if (webview) for (const auto& event : events) post_json(event);
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

    void queue_watch(Json payload) {
        {
            std::lock_guard lock(watch_mutex);
            watch_events.push_back(std::move(payload));
            if (watch_events.size() > 256) watch_events.pop_front();
        }
        PostMessageW(window, watch_event_message, 0, 0);
    }

    void drain_watch() {
        std::deque<Json> events;
        { std::lock_guard lock(watch_mutex); events.swap(watch_events); }
        if (webview) for (const auto& event : events) post_json(event);
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

    void queue_term(Json payload) {
        {
            std::lock_guard lock(term_mutex);
            term_events.push_back(std::move(payload));
            if (term_events.size() > 8192) term_events.erase(term_events.begin(), term_events.begin() + 2048);  // output flood guard
        }
        PostMessageW(window, term_event_message, 0, 0);
    }

    void drain_term() {
        std::deque<Json> events;
        { std::lock_guard lock(term_mutex); events.swap(term_events); }
        if (webview) for (const auto& event : events) post_json(event);
    }

    void queue_run(Json payload) {
        {
            std::lock_guard lock(run_mutex);
            run_events.push_back(std::move(payload));
            if (run_events.size() > 4096) run_events.erase(run_events.begin(), run_events.begin() + 1024);
        }
        PostMessageW(window, run_event_message, 0, 0);
    }

    void drain_run() {
        std::deque<Json> events;
        { std::lock_guard lock(run_mutex); events.swap(run_events); }
        if (webview) for (const auto& event : events) post_json(event);
        bool more = false;
        int code = 0;
        { std::lock_guard lock(run_mutex); if (run_pending_continue) { more = true; code = run_last_code; run_pending_continue = false; } }
        if (more) advance_run_chain(code);
    }

    // Runs one step of the chain. The label is echoed into the console so a chained
    // run reads as named steps rather than one opaque wall of output.
    void start_run_step(const RunStep& step) {
        if (!step.label.empty()) queue_run({{"event", "run.output"}, {"dataB64", base64_encode("\r\n==> " + step.label + " <==\r\n")}});
        start_run(step.command, step.program, step.args, step.cwd, step.environment, step.shell);
    }

    void begin_run_chain(std::deque<RunStep> steps) {
        { std::lock_guard lock(run_mutex); run_steps = std::move(steps); run_pending_continue = false; run_last_code = 0; }
        if (run_steps.empty()) return;
        const RunStep first = run_steps.front();
        run_steps.pop_front();
        start_run_step(first);
    }

    // Called from the message loop once the previous step's exit has been posted, so
    // the next process is created on the UI thread and never from the reader thread.
    void advance_run_chain(int code) {
        try {
            if (code != 0) {
                const std::size_t skipped = run_steps.size();
                run_steps.clear();
                queue_run({{"event", "run.output"}, {"dataB64", base64_encode("\r\n==> 链已中止：上一步以退出码 " + std::to_string(code)
                                                                  + " 结束，跳过 " + std::to_string(skipped) + " 个后续步骤 <==\r\n")}});
                queue_run({{"event", "run.exit"}, {"code", code}, {"remaining", std::size_t{0}}, {"aborted", true}});
                return;
            }
            if (run_steps.empty()) return;
            const RunStep next = run_steps.front();
            run_steps.pop_front();
            start_run_step(next);
        } catch (const taocode::WorkspaceError& error) {
            run_steps.clear();
            queue_run({{"event", "run.output"}, {"dataB64", base64_encode("\r\n==> 无法启动：" + std::string(error.what()) + " <==\r\n")}});
            queue_run({{"event", "run.exit"}, {"code", -1}, {"remaining", std::size_t{0}}, {"error", error.code}});
        } catch (const std::exception&) {
            run_steps.clear();
            queue_run({{"event", "run.output"}, {"dataB64", base64_encode(std::string("\r\n==> 无法启动后续步骤 <==\r\n"))}});
            queue_run({{"event", "run.exit"}, {"code", -1}, {"remaining", std::size_t{0}}});
        }
    }

    // IDEA's Run Configuration is not just a command line: it carries the program,
    // its arguments, the working directory and environment variables. The frontend
    // sends that whole shape, and this builds the child process from it. A bare
    // `command` string (the older contract, still accepted) runs through cmd.exe.
    void start_run(const std::string& command, const std::string& program, const std::vector<std::string>& args,
                   const std::string& cwd, const std::vector<std::string>& environment, const bool shell) {
        if (runner && runner->running()) throw taocode::WorkspaceError("BUSY", "已有构建/运行任务在进行中，请先停止。");
        runner = std::make_unique<taocode::Runner>();
        taocode::Runner::Spec spec;
        if (shell || program.empty()) {
            if (command.empty()) throw taocode::WorkspaceError("INVALID_REQUEST", "运行命令不能为空。");
            spec.command = L"cmd.exe";
            spec.arguments = {L"/d", L"/s", L"/c", wide(command)};
        } else {
            spec.command = wide(program);
            for (const auto& argument : args) spec.arguments.push_back(wide(argument));
        }
        // Working directory: an absolute path from the configuration wins, then the
        // workspace-relative path against the project root, then the root itself.
        std::wstring directory;
        if (!cwd.empty()) {
            const fs::path requested(wide(cwd));
            directory = requested.is_absolute() || !current_root.empty() ? (requested.is_absolute() ? requested.native() : (fs::path(wide(current_root)) / requested).native()) : requested.native();
        } else if (!current_root.empty()) {
            directory = wide(current_root);
        }
        if (!directory.empty()) spec.working_directory = fs::path(directory);
        for (const auto& entry : environment) if (!entry.empty()) spec.environment.push_back(wide(entry));
        runner->start(spec,
            // Raw bytes, base64-encoded: a build prints in its own code page, and a
            // chunk boundary can split a multi-byte character. The frontend decodes
            // incrementally and flushes on the last step's exit.
            [this](std::string_view chunk) { queue_run({{"event", "run.output"}, {"dataB64", base64_encode(chunk)}}); },
            [this](int code) {
                std::size_t remaining = 0;
                {
                    std::lock_guard lock(run_mutex);
                    remaining = run_steps.size();
                    run_last_code = code;
                    run_pending_continue = true;   // even with nothing left: drain_run clears the flag
                }
                // `remaining` lets the console keep the run open across steps instead of
                // declaring the whole configuration finished after step one.
                queue_run({{"event", "run.exit"}, {"code", code}, {"remaining", remaining}});
            });
    }

    void stop_run() {
        { std::lock_guard lock(run_mutex); run_steps.clear(); run_pending_continue = false; }
        if (runner) runner->stop();
    }

    void queue_dap(Json payload) {
        {
            std::lock_guard lock(dap_mutex);
            dap_events.push_back(std::move(payload));
            while (dap_events.size() > 2048) dap_events.erase(dap_events.begin());  // console flood guard
        }
        PostMessageW(window, dap_event_message, 0, 0);
    }

    void drain_dap() {
        std::deque<Json> events;
        { std::lock_guard lock(dap_mutex); events.swap(dap_events); }
        if (webview) for (const auto& event : events) post_json(event);
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
        if (dap) { dap->disconnect({}); dap->shutdown(); dap.reset(); }
        reap_external_runners();
    }

    std::string require_repo_root() const {
        if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
        return current_root;
    }

    void queue_lsp(Json payload) {
        {
            std::lock_guard lock(lsp_mutex);
            lsp_events.push_back(std::move(payload));
            if (lsp_events.size() > 512) lsp_events.pop_front();
        }
        PostMessageW(window, WM_APP + 2, 0, 0);
    }

    void drain_lsp() {
        std::deque<Json> events;
        { std::lock_guard lock(lsp_mutex); events.swap(lsp_events); }
        if (webview) for (const auto& event : events) post_json(event);
    }

    // Reads an optional "TaoCode.lsp.json" beside the exe mapping language ->
    // {command,args,cwd}. No server is bundled; the IDE only launches what the
    // user has installed and configured, so the boundary stays honest.
    void configure_lsp() {
        if (!lsp)
            lsp = std::make_unique<taocode::lsp::Session>([this](std::string path, Json diagnostics) {
                queue_lsp({{"event", "lsp.diagnostics"}, {"path", path}, {"diagnostics", diagnostics}});
            });
            // A server-driven write (workspace/applyEdit, a quick fix, organize
            // imports) changes the file behind the editor's back: tell the UI to
            // reload that path so the buffer matches disk.
            lsp->set_edit_sink([this](std::string path) {
                queue_lsp({{"event", "lsp.edited"}, {"path", std::move(path)}});
            });
        std::map<std::string, taocode::lsp::Session::ServerConfig> servers;
        std::ifstream stream(ui.parent_path() / L"TaoCode.lsp.json", std::ios::binary);
        if (stream) {
            try {
                for (const auto& [language, entry] : Json::parse(stream).items()) {
                    if (!entry.is_object()) continue;
                    taocode::lsp::Session::ServerConfig config;
                    config.command = wide(entry.value("command", std::string()));
                    if (entry.contains("args") && entry.at("args").is_array())
                        for (const auto& arg : entry.at("args"))
                            if (arg.is_string()) config.arguments.push_back(wide(arg.get<std::string>()));
                    if (entry.contains("cwd") && entry.at("cwd").is_string())
                        config.working_directory = fs::path(wide(entry.at("cwd").get<std::string>()));
                    if (entry.contains("initializationOptions") && entry.at("initializationOptions").is_object())
                        config.initialization_options = entry.at("initializationOptions");
                    if (!config.command.empty()) servers[language] = std::move(config);
                }
            } catch (const Json::exception&) { /* an unreadable config simply means no servers */ }
        }
        if (!current_root.empty() && servers.contains("java"))
            servers.at("java").settings = taocode::java_lsp_settings(projects->project_settings(current_root).at("java"));
        lsp->configure(std::move(servers));
    }

    void stop_lsp() noexcept {
        if (lsp) { lsp->shutdown_all(); lsp.reset(); }
    }

    void reset_lsp(const std::string& root) {
        // Tear down any prior project's language servers before reconfiguring;
        // otherwise hosts and documents from the old root survive under the new root,
        // and URI mappings silently mix two projects.
        if (lsp) lsp->shutdown_all();
        configure_lsp();
        lsp->set_root(root.empty() ? fs::path() : fs::path(wide(root)));
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
        if (!profile.empty()) {
            std::ofstream log(profile / L"native.log", std::ios::app);
            log << message << '\n';
        }
        const auto text = wide(message + "\n\n请确认系统已安装 Microsoft Edge WebView2 Runtime，且 exe 旁有完整 ui 目录。\n日志位于 %LOCALAPPDATA%\\TaoCode\\native.log");
        MessageBoxW(window, text.c_str(), L"TaoCode 启动失败", MB_OK | MB_ICONERROR);
        if (window) DestroyWindow(window);
    }

    // IDEA's project choosers open in GeneralLocalSettings.defaultProjectDirectory when it is
    // set (WelcomeScreenProjectProvider.kt:231, AttachProjectAction.kt:73) and in the OS
    // default otherwise. `SetFolder` has to be handed a folder that exists — combined with
    // FOS_PATHMUSTEXIST a stale path makes the dialog fail to appear at all — so a value that
    // is not a directory is ignored and the dialog simply opens where it normally would.
    static void set_initial_folder(IFileOpenDialog* dialog, const std::string& initial) {
        if (initial.empty()) return;
        const fs::path folder = fs::path(wide(initial));
        std::error_code error;
        if (!fs::is_directory(folder, error)) return;
        ComPtr<IShellItem> item;
        if (FAILED(SHCreateItemFromParsingName(folder.c_str(), nullptr, IID_PPV_ARGS(&item)))) return;
        dialog->SetFolder(item.Get());  // best effort: failing here still opens the dialog
    }

    Json select_directory(const wchar_t* title, const std::string& initial = std::string()) {
        ComPtr<IFileOpenDialog> dialog;
        check(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)), "Create folder picker");
        DWORD options{};
        check(dialog->GetOptions(&options), "Get folder options");
        check(dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR | FOS_DONTADDTORECENT), "Set folder options");
        dialog->SetTitle(title);
        set_initial_folder(dialog.Get(), initial);
        const auto result = dialog->Show(window);
        if (result == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return nullptr;
        check(result, "Open folder picker");
        ComPtr<IShellItem> item;
        check(dialog->GetResult(&item), "Get selected folder");
        PWSTR path{};
        check(item->GetDisplayName(SIGDN_FILESYSPATH, &path), "Get folder path");
        const fs::path selected(path);
        CoTaskMemFree(path);
        return utf8(selected.native());
    }

    // IDEA's "Background Image..." action (Images.SetBackgroundImage): pick an image
    // file and hand its bytes to the UI as a data URL. Only real image extensions are
    // accepted and the file is size-capped, so this cannot be used as a general
    // "read any file" channel.
    static bool image_mime_for(const fs::path& path, std::string& mime) {
        auto extension = path.extension().wstring();
        for (auto& ch : extension) ch = static_cast<wchar_t>(std::towlower(ch));
        if (extension == L".png") mime = "image/png";
        else if (extension == L".jpg" || extension == L".jpeg") mime = "image/jpeg";
        else if (extension == L".gif") mime = "image/gif";
        else if (extension == L".webp") mime = "image/webp";
        else if (extension == L".bmp") mime = "image/bmp";
        else if (extension == L".svg") mime = "image/svg+xml";
        else return false;
        return true;
    }

    Json read_image(const fs::path& path) {
        std::string mime;
        if (!image_mime_for(path, mime))
            throw taocode::WorkspaceError("INVALID_IMAGE", "只支持 PNG / JPEG / GIF / WebP / BMP / SVG 图片。");
        std::error_code ec;
        const auto size = fs::file_size(path, ec);
        if (ec) throw taocode::WorkspaceError("IO_ERROR", "无法读取该图片文件。");
        if (size == 0 || size > 16ull * 1024 * 1024)
            throw taocode::WorkspaceError("INVALID_IMAGE", "图片必须大于 0 且不超过 16 MiB。");
        std::ifstream stream(path, std::ios::binary);
        if (!stream) throw taocode::WorkspaceError("IO_ERROR", "无法打开该图片文件。");
        const std::string bytes{std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>()};
        return {{"path", utf8(path.native())}, {"mime", mime}, {"bytes", static_cast<std::int64_t>(bytes.size())},
                {"dataUrl", "data:" + mime + ";base64," + base64_encode(bytes)}};
    }

    Json select_image() {
        ComPtr<IFileOpenDialog> dialog;
        check(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)), "Create image picker");
        DWORD options{};
        check(dialog->GetOptions(&options), "Get image options");
        check(dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_NOCHANGEDIR | FOS_DONTADDTORECENT), "Set image options");
        const COMDLG_FILTERSPEC filters[]{{L"图片", L"*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.svg"}};
        check(dialog->SetFileTypes(1, filters), "Set image filters");
        dialog->SetTitle(L"选择背景图像");
        const auto result = dialog->Show(window);
        if (result == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return nullptr;
        check(result, "Open image picker");
        ComPtr<IShellItem> item;
        check(dialog->GetResult(&item), "Get selected image");
        PWSTR path{};
        check(item->GetDisplayName(SIGDN_FILESYSPATH, &path), "Get image path");
        const fs::path selected(path);
        CoTaskMemFree(path);
        return read_image(selected);
    }

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
        const auto start = std::chrono::steady_clock::now();
        Json reply = {{"id", 0}, {"ok", false}};
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
            if (clone_active && (method == "workspace.open" || method == "workspace.close" || method == "project.create" || method == "project.clone" || method == "project.settings.update" || method == "file.create" || method == "file.rename" || method == "file.delete"))
                throw taocode::WorkspaceError("BUSY", "请先等待克隆完成或取消克隆。");
            Json result;
            if (method == "app.state") {
                result = projects->state();
                result["gitAvailable"] = !taocode::find_git_executable().empty();
                result["defaultParent"] = default_parent;
            } else if (method == "dialog.pickDirectory") result = select_directory(L"选择项目存放目录", params.value("initial", std::string()));
            else if (method == "dialog.pickImage") result = select_image();
            // Restores a previously chosen background image after a restart: the path
            // was persisted in settings, the bytes are re-read here.
            else if (method == "app.readImage") {
                const auto path = params.at("path").get<std::string>();
                if (path.empty()) result = Json(nullptr);
                else result = read_image(fs::path(wide(path)));
            }
            else if (method == "workspace.open") {
                const auto path = params.contains("path") ? params.at("path") : select_directory(L"打开 TaoCode 工作区", params.value("initial", std::string()));
                result = path.is_null() ? Json(nullptr) : open_project(fs::path(wide(path.get<std::string>())));
            } else if (method == "workspace.close") {
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
                result = {{"closed", true}};
            } else if (method == "project.create") {
                projects->state();
                const auto path = taocode::create_project(fs::path(wide(params.at("parent").get<std::string>())), params.at("name").get<std::string>(), params.at("template").get<std::string>());
                try { result = open_project(path); }
                catch (const std::exception& error) { throw taocode::WorkspaceError("OPEN_FAILED", "项目已创建在 " + utf8(path.native()) + "，但打开失败：" + error.what()); }
            } else if (method == "project.clone") { begin_clone(request["id"], params); return; }
            else if (method == "project.clone.cancel") { result = {{"requested", clone_active && clone_thread.request_stop()}}; }
            else if (method == "projects.forget") result = projects->forget(params.at("path").get<std::string>());
            else if (method == "projects.forgetMany") {
                std::vector<std::string> paths;
                for (const auto& entry : params.at("paths")) paths.push_back(entry.get<std::string>());
                result = projects->forget_many(paths);
            }
            else if (method == "settings.general.update") {
                // GeneralSettings (ide.general.xml): the System Settings page's backing state.
                result = projects->update_general(params.at("general"));
            } else if (method == "settings.update") {
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
            }
            else if (method == "project.settings.get" || method == "project.settings.update") {
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
                if (params.contains("java") && lsp)
                    lsp->set_configuration("java", taocode::java_lsp_settings(result.at("settings").at("java")));
            } else if (method == "workspace.list") result = workspace->list(params.at("path").get<std::string>());
            else if (method == "file.read") result = workspace->read(params.at("path").get<std::string>(), params.value("encoding", std::string("auto")));
            else if (method == "file.write") {
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
            }
            else if (method == "file.create") result = workspace->create(params.at("path").get<std::string>(), params.value("directory", false), params.value("template", std::string()));
            else if (method == "file.readOnly") result = workspace->set_read_only(params.at("path").get<std::string>(), params.value("readOnly", true));
            else if (method == "file.lineSeparators") result = workspace->convert_line_separators(params.at("path").get<std::string>(), params.at("separator").get<std::string>(), params.at("content").get<std::string>(), params.at("expectedVersion").get<std::string>());
            else if (method == "file.readBinary") result = workspace->read_binary(params.at("path").get<std::string>(),
                                                                                  params.value("limit", std::size_t{1024 * 1024}));
            // Safe delete: "is anything still referring to this?" answered by a real
            // workspace scan (file + line + preview), so the confirm dialog can show
            // the same rows IDEA's Safe Delete dialog would.
            else if (method == "file.usages") result = workspace->usages_of(params.at("path").get<std::string>(),
                                                                            params.value("symbol", std::string()));
            else if (method == "file.rename") result = workspace->rename(params.at("from").get<std::string>(), params.at("to").get<std::string>());
            else if (method == "file.delete") result = workspace->remove(params.at("path").get<std::string>(), params.value("trash", false));
            else if (method == "file.copy") result = workspace->copy(params.at("from").get<std::string>(), params.at("to").get<std::string>());
            else if (method == "file.reveal") result = workspace->reveal(params.at("path").get<std::string>());
            // RevealFileAction for absolute paths: the welcome screen has no workspace yet
            // (welcomeScreen/projectActions/RevealProjectDirAction.kt:25-33).
            else if (method == "shell.reveal") result = taocode::reveal_absolute(params.at("path").get<std::string>());
            else if (method == "session.save") {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                result = sessions->save(current_root, params.at("state"));
            } else if (method == "session.load") {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                result = sessions->load(current_root);
            } else if (method == "session.clear") {
                if (!current_root.empty()) result = sessions->clear(current_root);
                else result = {{"cleared", true}, {"removed", false}};
            }
            else if (method == "lsp.open") {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                const auto path = params.at("path").get<std::string>();
                const auto language = taocode::lsp::Session::language_for(path);
                if (lsp) {
                    result = lsp->open(path, params.value("text", std::string()));
                } else {
                    result = {{"running", false}, {"language", language}};
                }
                // "No server configured for this language" is not the same state as
                // "server is starting": the status bar must not claim indexing is
                // pending for a plain text file (IDEA only shows the indicator when
                // the project is actually in dumb mode).
                result["configured"] = lsp ? lsp->has_server(language) : false;
            }
            else if (method == "lsp.change") {
                if (!lsp) throw taocode::WorkspaceError("LSP_UNAVAILABLE", "语言服务未就绪。");
                lsp->change(params.at("path").get<std::string>(), params.value("text", std::string()));
                result = {{"ok", true}};
            }
            else if (method == "lsp.close") {
                if (lsp) lsp->close(params.at("path").get<std::string>());
                result = {{"ok", true}};
            }
            else if (method == "lsp.stop") { stop_lsp(); result = {{"ok", true}}; }
            else if (method == "lsp.request") {
                if (!lsp) throw taocode::WorkspaceError("LSP_UNAVAILABLE", "语言服务未就绪。");
                const auto id = request["id"];
                const auto kind = params.value("kind", std::string());
                const auto path = params.value("path", std::string());
                const auto lsp_reply = [this, id](Json response, Json error) {
                    Json payload = {{"id", id}, {"ok", error.is_null()}};
                    if (error.is_null()) payload["result"] = std::move(response);
                    else payload["error"] = {{"code", "LSP_FAILED"},
                        {"message", error.is_object() && error.contains("message") && error.at("message").is_string()
                                    ? error.at("message").get<std::string>() : std::string("语言服务请求失败")}};
                    queue_lsp(std::move(payload));
                };
                if (kind == "rename" || kind == "references" || kind == "documentSymbol" || kind == "workspaceSymbol") {
                    Json semantic_args{{"newName", params.value("newName", std::string())},
                              {"query", params.value("query", std::string())}};
                    lsp->semantic(kind, path, params.value("line", 0), params.value("character", 0), semantic_args, lsp_reply);
                }
                else if (kind == "signatureHelp" || kind == "codeAction" || kind == "codeActionResolve" ||
                         kind == "formatting" ||
                         kind == "rangeFormatting" || kind == "implementation" || kind == "typeDefinition" ||
                         kind == "documentHighlight" || kind == "selectionRange" || kind == "inlayHint" ||
                         kind == "prepareCallHierarchy" || kind == "callHierarchyIncoming" ||
                         kind == "callHierarchyOutgoing" || kind == "prepareTypeHierarchy" ||
                         kind == "typeHierarchySupertypes" || kind == "typeHierarchySubtypes") {
                    Json semantic_args = Json::object();
                    for (const char* key : {"triggerKind", "tabSize", "insertSpaces", "range", "diagnostics", "index", "item"})
                        if (params.contains(key)) semantic_args[key] = params.at(key);
                    lsp->semantic(kind, path, params.value("line", 0), params.value("character", 0), semantic_args, lsp_reply);
                }
                else
                    lsp->request(kind, path, params.value("line", 0), params.value("character", 0), lsp_reply);
                return;  // asynchronous; delivered by drain_lsp
            }
            else if (method == "run.start") {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                const auto string_list = [&params](const char* key) {
                    std::vector<std::string> values;
                    if (params.contains(key) && params.at(key).is_array())
                        for (const auto& item : params.at(key))
                            if (item.is_string()) values.push_back(item.get<std::string>());
                    return values;
                };
                RunStep main;
                main.command = params.value("command", std::string());
                main.program = params.value("program", std::string());
                main.cwd = params.value("cwd", std::string());
                main.shell = params.value("shell", true);
                main.args = string_list("args");
                main.environment = string_list("env");
                for (const auto& entry : main.environment)
                    if (entry.empty() || entry.front() == '=' || entry.find('=') == std::string::npos)
                        throw taocode::WorkspaceError("INVALID_REQUEST", "环境变量要写成 KEY=VALUE。");
                if (main.command.empty() && main.program.empty())
                    throw taocode::WorkspaceError("INVALID_REQUEST", "运行配置需要命令或可执行程序。");

                // IDEA's "Before launch" steps run first, in order, and abort the whole
                // configuration if one fails — otherwise the program would start against
                // whatever the previous build left behind.
                std::deque<RunStep> steps;
                if (params.contains("beforeLaunch") && params.at("beforeLaunch").is_array()) {
                    for (const auto& item : params.at("beforeLaunch")) {
                        if (!item.is_object()) continue;
                        RunStep step;
                        step.command = item.value("command", std::string());
                        step.label = item.value("name", std::string());
                        if (step.command.empty()) continue;
                        step.cwd = main.cwd;               // before-launch inherits the configuration's directory
                        step.environment = main.environment;
                        step.shell = true;                 // before-launch entries are shell command lines
                        steps.push_back(std::move(step));
                    }
                }
                main.label = params.value("label", std::string());
                steps.push_back(std::move(main));
                const std::size_t step_count = steps.size();
                begin_run_chain(std::move(steps));
                result = {{"started", true}, {"steps", step_count}};
            }
            else if (method == "run.write") {
                if (!runner || !runner->running()) throw taocode::WorkspaceError("NOT_RUNNING", "没有正在运行的任务。");
                runner->write_line(params.value("line", std::string()));
                result = {{"ok", true}};
            }
            else if (method == "run.stop") { stop_run(); result = {{"ok", true}}; }
            else if (method == "git.status") {
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
            }
            else if (method == "git.diff") {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                result = {{"diff", taocode::git::diff(fs::path(wide(current_root)), params.at("path").get<std::string>(),
                                                      params.value("staged", false), params.value("base", std::string()))}};
            }
            else if (method == "git.diffSides" || method == "git.compare") {
                if (current_root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
                const auto repository = fs::path(wide(current_root));
                if (method == "git.compare") result = taocode::git::compare(repository, params.at("base").get<std::string>());
                else result = taocode::git::diff_sides(repository, params.at("path").get<std::string>(),
                                                       params.value("staged", false), params.value("base", std::string()));
            }
            else if (method == "git.stage" || method == "git.unstage") {
                const auto repository = fs::path(wide(require_repo_root()));
                const auto path = params.at("path").get<std::string>();
                if (method == "git.stage") taocode::git::stage(repository, path); else taocode::git::unstage(repository, path);
                result = {{"ok", true}};
            }
            else if (method == "git.commit") {
                taocode::git::commit(fs::path(wide(require_repo_root())), params.value("message", std::string()),
                                     params.value("amend", false), params.value("signoff", false),
                                     params.value("author", std::string()), params.value("authorEmail", std::string()));
                result = {{"ok", true}};
            }
            else if (method == "git.checkout") {
                taocode::git::checkout(fs::path(wide(require_repo_root())), params.at("branch").get<std::string>());
                result = {{"ok", true}};
            }
            else if (method == "git.log") result = taocode::git::log(fs::path(wide(require_repo_root())), params.value("path", std::string()), params.value("limit", 100));
            else if (method == "git.logFull") result = taocode::git::log_full(fs::path(wide(require_repo_root())), params.value("limit", 200));
            else if (method == "git.pull") { taocode::git::pull(fs::path(wide(require_repo_root()))); result = {{"ok", true}}; }
            else if (method == "git.fetch") { taocode::git::fetch(fs::path(wide(require_repo_root()))); result = {{"ok", true}}; }
            else if (method == "git.push") { taocode::git::push(fs::path(wide(require_repo_root()))); result = {{"ok", true}}; }
            else if (method == "git.rebase") { taocode::git::rebase(fs::path(wide(require_repo_root())), params.value("branch", std::string())); result = {{"ok", true}}; }
            else if (method == "git.cherryPick") { taocode::git::cherry_pick(fs::path(wide(require_repo_root())), params.at("commit").get<std::string>()); result = {{"ok", true}}; }
            else if (method == "git.stash") result = taocode::git::stash_list(fs::path(wide(require_repo_root())));
            else if (method == "git.stash.save") { taocode::git::stash_save(fs::path(wide(require_repo_root())), params.value("message", std::string())); result = {{"ok", true}}; }
            else if (method == "git.stash.pop") { taocode::git::stash_pop(fs::path(wide(require_repo_root()))); result = {{"ok", true}}; }
            else if (method == "git.branch.create") { taocode::git::create_branch(fs::path(wide(require_repo_root())), params.at("name").get<std::string>(), params.value("checkout", false)); result = {{"ok", true}}; }
            else if (method == "git.branch.delete") { taocode::git::delete_branch(fs::path(wide(require_repo_root())), params.at("name").get<std::string>()); result = {{"ok", true}}; }
            else if (method == "git.revert") { taocode::git::revert(fs::path(wide(require_repo_root())), params.at("path").get<std::string>()); result = {{"ok", true}}; }
            else if (method == "git.reset") result = taocode::git::reset(fs::path(wide(require_repo_root())), params.at("target").get<std::string>(), params.value("mode", std::string("mixed")));
            else if (method == "git.merge") { taocode::git::merge(fs::path(wide(require_repo_root())), params.at("branch").get<std::string>()); result = {{"ok", true}}; }
            else if (method == "git.tags") result = taocode::git::tag_list(fs::path(wide(require_repo_root())));
            else if (method == "git.tag.create") { taocode::git::tag_create(fs::path(wide(require_repo_root())), params.at("name").get<std::string>(), params.value("target", std::string())); result = {{"ok", true}}; }
            else if (method == "git.tag.delete") { taocode::git::tag_delete(fs::path(wide(require_repo_root())), params.at("name").get<std::string>()); result = {{"ok", true}}; }
            else if (method == "git.ignore") { taocode::git::ignore_path(fs::path(wide(require_repo_root())), params.at("path").get<std::string>()); result = {{"ok", true}}; }
            // IDEA's CommitAuthorComponent reads the repository's configured author; the
            // same values are handed back to `git.commit` when the user overrides them.
            else if (method == "git.user") result = taocode::git::user(fs::path(wide(require_repo_root())));
            // ...and the *authors* completion list comes from the log users (GitCommitOptionsUi.kt:259).
            else if (method == "git.authors") result = taocode::git::authors(fs::path(wide(require_repo_root())));
            else if (method == "git.diffHunks") result = taocode::git::diff_hunks(fs::path(wide(require_repo_root())), params.at("path").get<std::string>(), params.value("staged", false));
            else if (method == "git.applyHunks") {
                taocode::git::apply_hunks(fs::path(wide(require_repo_root())), params.at("path").get<std::string>(),
                                          params.value("staged", false), params.at("hunks").get<std::vector<int>>(), params.value("reverse", false));
                result = {{"ok", true}};
            }
            else if (method == "git.aheadBehind") result = taocode::git::ahead_behind(fs::path(wide(require_repo_root())));
            else if (method == "git.blame") result = taocode::git::blame(fs::path(wide(require_repo_root())), params.at("path").get<std::string>());
            else if (method == "git.fileHistory") result = taocode::git::file_history(fs::path(wide(require_repo_root())), params.at("path").get<std::string>(), params.value("limit", 100));
            else if (method == "git.showCommit") result = taocode::git::show_commit(fs::path(wide(require_repo_root())), params.at("revision").get<std::string>());
            else if (method == "git.worktree.list") result = taocode::git::worktree_list(fs::path(wide(require_repo_root())));
            else if (method == "git.worktree.add") {
                const auto repository = fs::path(wide(require_repo_root()));
                taocode::git::worktree_add(repository, params.at("path").get<std::string>(),
                                           params.value("branch", std::string()), params.value("newBranch", false));
                // Return the refreshed list so the UI cannot show a stale tree after a
                // mutation it just performed.
                result = taocode::git::worktree_list(repository);
            } else if (method == "git.worktree.remove") {
                const auto repository = fs::path(wide(require_repo_root()));
                taocode::git::worktree_remove(repository, params.at("path").get<std::string>(), params.value("force", false));
                result = taocode::git::worktree_list(repository);
            }             else if (method == "git.submodules") result = taocode::git::submodule_status(fs::path(wide(require_repo_root())));
            else if (method == "git.submodule.update") {
                const auto repository = fs::path(wide(require_repo_root()));
                taocode::git::submodule_update(repository, params.value("init", true), params.value("recursive", false));
                result = taocode::git::submodule_status(repository);
            }
            // Cancels the git command running on the worker right now. IDEAs
            // background-task rows carry a cancel button; git commands are the tasks
            // TaoCode runs in the background, so this is that button's backend.
            else if (method == "git.cancel") {
                taocode::git::request_cancel();
                result = {{"ok", true}};
            }
            else if (method == "search.cancel") { search_cancel.store(true); result = {{"ok", true}}; }
            // Find in Files walks up to 100k files, which is far too long to hold the
            // UI thread: it runs on its own thread and answers through the message
            // loop, and `search.cancel` abandons a walk nobody is waiting for any more.
            else if (method == "search.run" || method == "search.replace" || method == "search.preview" || method == "search.replaceSelected") {
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
                        if (kind == "search.run") payload["result"] = taocode::search::run(repository, options);
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
            else if (method == "dap.start") {
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
            else if (method == "dap.setBreakpoints") {
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
            else if (method == "dap.continue" || method == "dap.pause" || method == "dap.next" ||
                     method == "dap.stepIn" || method == "dap.stepOut") {
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
            else if (method == "dap.stackTrace" || method == "dap.scopes" || method == "dap.variables") {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto id = request["id"];
                const auto cb = [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); };
                if (method == "dap.stackTrace") client.stack_trace(static_cast<long>(params.value("threadId", 1)), cb);
                else if (method == "dap.scopes") client.scopes(static_cast<long>(params.value("frameId", 0)), cb);
                else client.variables(static_cast<long>(params.value("reference", 0)), cb);
                return;
            }
            else if (method == "dap.evaluate") {
                auto& client = require_dap();
                if (!client.running()) throw taocode::WorkspaceError("DAP_NOT_RUNNING", "调试会话未运行。");
                const auto id = request["id"];
                const auto cb = [this, id](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); };
                client.request("evaluate", {{"expression", params.value("expression", std::string())},
                                            {"context", params.value("context", std::string("hover"))},
                                            {"frameId", params.value("frameId", 0)}}, cb);
                return;
            }
            else if (method == "dap.breakpoints") { result = {{"breakpoints", dap ? dap->breakpoint_map() : Json::object()}}; }
            else if (method == "dap.setExceptionBreakpoints") {
                require_dap().set_exception_breakpoints(params.at("filters"), [this, id = request["id"]](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
                return;  // async; delivered through drain_dap
            }
            else if (method == "dap.threads") {
                require_dap().threads([this, id = request["id"]](Json r, Json e) { dap_reply(id, std::move(r), std::move(e)); });
                return;  // async; delivered through drain_dap
            }
            else if (method == "dap.terminate") { stop_dap(); result = {{"ok", true}}; }
            // Disconnect ends the session; the client is dropped so the next start
            // gets a fresh adapter instead of one whose pipes are already closed.
            else if (method == "dap.disconnect") { stop_dap(); result = {{"ok", true}}; }
            else if (method == "term.create") {
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
            }
            else if (method == "term.write") { terminals->write(params.at("id").get<int>(), base64_decode(params.value("dataB64", std::string()))); result = {{"ok", true}}; }
            else if (method == "term.resize") {
                terminal_cols = params.value("cols", terminal_cols);
                terminal_rows = params.value("rows", terminal_rows);
                terminals->resize(params.at("id").get<int>(), terminal_cols, terminal_rows);
                result = {{"ok", true}};
            }
            else if (method == "term.kill") { terminals->kill(params.at("id").get<int>()); result = {{"ok", true}}; }
            // IDEA's terminal tool window keeps a session list so a shell that exited
            // still shows its state; `ids()` was already there, only unreachable.
            else if (method == "term.list") {
                Json list = Json::array();
                for (const int id : terminals->ids())
                    list.push_back({{"id", id}, {"running", terminals->running(id)}});
                result = {{"terminals", std::move(list)}};
            }
            else if (method == "history.list" || method == "history.content" || method == "history.diff" || method == "history.diffSides") {
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
            else if (method == "plugin.list" || method == "plugin.setEnabled") {
                const fs::path directory = profile / L"plugins";
                if (method == "plugin.list") {
                    fs::create_directories(directory);
                    result = taocode::plugins::to_json(taocode::plugins::list(directory));
                } else {
                    taocode::plugins::set_enabled(directory, params.at("id").get<std::string>(), params.value("enabled", true));
                    result = taocode::plugins::to_json(taocode::plugins::list(directory));
                }
            }
            // IDEA's MemoryUsagePanel reads the JVM heap; the host reports its own
            // process memory instead, which is the real equivalent here.
            else if (method == "app.memory") {
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
            }
            else if (method == "app.quit") { PostMessageW(window, WM_CLOSE, 0, 0); result = {{"closing", true}}; }
            else throw taocode::WorkspaceError("UNKNOWN_METHOD", "该原生方法未开放");
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
            "git.log", "git.logFull", "git.showCommit", "git.blame", "git.fileHistory",
            "git.checkout", "git.branch.create", "git.branch.delete", "git.merge",
            "git.revert", "git.reset",
            "git.tags", "git.tag.create", "git.tag.delete", "git.ignore",
            "git.fetch", "git.pull", "git.push", "git.aheadBehind",
            "git.stash", "git.stash.save", "git.stash.pop",
            "git.worktree.list", "git.worktree.add", "git.worktree.remove",
            "git.submodules", "git.submodule.update"};
        return methods.count(method) != 0;
    }

    void queue_git_reply(Json payload) {
        {
            std::lock_guard lock(git_mutex);
            git_replies.push_back(std::move(payload));
        }
        PostMessageW(window, git_event_message, 0, 0);
    }

    void drain_git() {
        std::deque<Json> replies;
        { std::lock_guard lock(git_mutex); replies.swap(git_replies); }
        if (!webview) return;
        for (const auto& reply : replies) post_json(reply);
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
        queue_git_reply_event(std::move(event));
    }

    // Progress events ride the same WM_APP+8 marshalling as the git replies; this is
    // not a reply, so it goes out as a separate message the bridge fronts as an event.
    void queue_git_reply_event(Json payload) {
        {
            std::lock_guard lock(git_mutex);
            git_replies.push_back(std::move(payload));
        }
        PostMessageW(window, git_event_message, 0, 0);
    }

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
        std::deque<Json> dropped;
        { std::lock_guard lock(git_mutex); dropped.swap(git_replies); }
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
        check(webview->Navigate(app_url), "Load UI");
    }

    void start() {
        const auto result = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), nullptr,
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([this](HRESULT status, ICoreWebView2Environment* environment) -> HRESULT {
                if (FAILED(status) || !environment) { failure("无法初始化 WebView2 环境"); return S_OK; }
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
            app->stop_search();  // join the Find-in-Files thread before teardown
            app->stop_lsp();  // reap language-server children before teardown
            app->stop_run();  // kill any running build/process tree
            app->stop_dap();  // never orphan a debug adapter or its debuggee
            app->stop_watcher();  // join the directory-watcher thread
            app->stop_git();      // join the git worker; no child outlives the window
            app->terminals->kill_all();  // no shell outlives the window
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
