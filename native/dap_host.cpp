// `dap.*` 宿主侧（边界说明见 native/dap_host.hpp）。
//
// 2026-10-08 从 native/main.cpp 的 `App` 逐字搬出：函数体、注释、错误码与文案都没改，
// 只做了这三类改名 ——
//   · 成员换成 Host 的成员：`dap` → `client_`、`dap_config` → `registry_`、
//     `dap_events` → `events_`、`external_runners` / `external_mutex` 各加一个下划线；
//   · `current_root` / `general_settings()` / `terminals` / `queue_term` / `post_json` 换成 Ports 的对应项
//     （它们仍是 App 的那一份实现，这里只是引用）；
//   · 方法名 `stop_dap` → `stop`、`queue_dap` → `queue_event`、`drain_dap` → `drain`、
//     `dap_reply` → `route_reply`（RouteHost 的接口名）。
#include "dap_host.hpp"

#include <atomic>
#include <chrono>
#include <fstream>
#include <memory>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "base64.hpp"
#include "runner.hpp"
#include "terminal.hpp"
#include "text.hpp"
#include "trusted_paths.hpp"

namespace taocode {
namespace dap_host {

namespace fs = std::filesystem;

Host::Host(Ports ports, unsigned event_message)
    : ports_(std::move(ports)), event_message_(event_message) {}

// 析构只做成员回收（客户端、事件队列、适配器要的控制台窗口），**不**额外发事件也不额外断开：
// 收尾链（main.cpp `close_children` 的「调试适配器」那一步）已经调过 stop()。
Host::~Host() = default;

// console flood guard：超过 2048 条时一条一条丢掉最旧的（保持原语义，所以 drop 传 1）。
void Host::queue_event(Json payload) {
    events_.push(std::move(payload), ports_.window(), event_message_, 2048, 1);
}

// "WebView 在不在"的判断留在宿主那一层（main.cpp 的 `drain_dap` 仍是 `if (webview) ...`），
// 这里只管把整批事件换出来发出去。
void Host::drain() {
    for (const auto& event : events_.take()) ports_.post(event);
}

// Graceful first: `disconnect` asks the adapter to end the session, waits at
// most 5s for it to actually go away and then shuts the pipes down itself, so
// this is bounded. shutdown() afterwards is idempotent and is what makes the
// stop deterministic — it closes stdin, kills the job and joins the reader
// thread (detaching it instead when it is called *from* that thread, which is
// what a reverse request does). Destroying the client straight after start()
// used to detach a still-running reader — a use-after-free that surfaced as
// random crashes right after a detach.
// 收摊时必须结束被调试进程（默认语义）；「断开但保留进程」是 dap.disconnect 的显式选项。
void Host::stop() noexcept {
    if (client_) { client_->disconnect(true, {}); client_->shutdown(); client_.reset(); }
    reap_external_runners();
}

// 断点属于项目：`workspace.close` 那一步丢的是一整个项目的断点（没有会话时什么也不用做）。
void Host::clear_breakpoints() {
    if (client_) client_->clear_breakpoints();
}

// Replies from the DAP reader thread must not call post_json directly; funnel
// them through the event channel so the WebView2 call stays on the UI thread.
void Host::route_reply(Json id, Json result, Json error) {
    Json payload{{"id", id}, {"ok", error.is_null()}};
    if (error.is_null()) payload["result"] = std::move(result);
    else payload["error"] = {{"code", error.is_object() && error.contains("code") && error.at("code").is_string()
                                  ? error.at("code").get<std::string>() : std::string("DAP_FAILED")},
                             {"message", error.is_object() && error.contains("message") && error.at("message").is_string()
                                  ? error.at("message").get<std::string>() : std::string("调试请求失败")}};
    queue_event(std::move(payload));
}

// `dap.*` 一族的分派体在 native/dap_routes.cpp（main.cpp 贴着 2000 行硬上限）——
// 下面这几个 route_* 就是把路由函数要的宿主面接上，逻辑仍是原来 App 的那几个方法。
dap::Client& Host::route_client() { return require_client(); }

dap::Client& Host::require_client() {
    const auto root = ports_.root();
    if (root.empty()) throw taocode::WorkspaceError("NOT_OPEN", "请先打开项目。");
    // 调试会真的执行目标程序，所以未信任项目在这里就被拦住（上游对执行侧的统一做法）。
    taocode::trusted::require_trusted(ports_.general_settings(), root, "调试");
    if (!client_) {
        load_registry();
        client_ = std::make_unique<dap::Client>();
        // The adapter's own reverse requests. Both are process-wide hooks with a
        // working default inside dap.cpp; installing them routes the request to
        // the real terminal layer / a real nested session instead.
        dap::Client::set_run_in_terminal_handler(
            [this](const Json& args, std::string& error) { return run_in_terminal(args, error); });
        dap::Client::set_start_debugging_handler(
            [this](const Json& args, std::string& error) { return start_nested_debug(args, error); });
    }
    client_->set_root(fs::path(wide(root)));
    return *client_;
}

// Best-effort adapter registry beside the exe (mirrors configure_lsp): the UI
// sends only {kind, program, cwd} and the concrete adapter command/args come
// from the user's own TaoCode.dap.json. Nothing is bundled.
void Host::load_registry() {
    std::ifstream stream(ports_.ui().parent_path() / L"TaoCode.dap.json", std::ios::binary);
    if (!stream) { registry_ = Json::object(); return; }
    try { const Json parsed = Json::parse(stream); registry_ = parsed.is_object() ? parsed : Json::object(); }
    catch (const Json::exception&) { registry_ = Json::object(); }
}

Json Host::route_registry() {
    load_registry();
    return registry_;
}

std::string Host::route_root() const { return ports_.root(); }

void Host::route_stop() noexcept { stop(); }

// 已记住的断点表；没有会话时是空对象（`dap.breakpoints` 不能因此起一个会话）。
Json Host::route_breakpoints() { return client_ ? client_->breakpoint_map() : Json::object(); }

taocode::dap::Client::EventCb Host::route_event_sink() {
    return [this](Json event) { queue_event({{"event", "dap.event"}, {"payload", std::move(event)}}); };
}

// DAP `runInTerminal` (adapter -> host reverse request). kind "integrated" opens
// a real ConPTY session in the Terminal tool window and types the command into
// it; kind "external" opens a detached console window. Failures fill `error`
// instead of throwing, because the answer travels back as a failed response.
Json Host::run_in_terminal(const Json& args, std::string& error) {
    const auto kind = args.value("kind", std::string("integrated"));
    std::vector<std::string> command_args;
    if (args.contains("args") && args.at("args").is_array())
        for (const auto& item : args.at("args")) if (item.is_string()) command_args.push_back(item.get<std::string>());
    const auto command = args.value("command", std::string());
    if (command.empty()) { error = "runInTerminal 没有要执行的命令。"; return Json::object(); }
    const auto root = ports_.root();
    std::wstring directory = wide(root);
    const auto cwd = args.value("cwd", std::string());
    if (!cwd.empty()) {
        const fs::path requested(wide(cwd));
        directory = (requested.is_absolute() ? requested : fs::path(wide(root)) / requested).native();
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
        { std::lock_guard lock(external_mutex_); external_runners_.push_back(std::move(console)); }
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
    const auto size = ports_.terminal_size();
    int id = 0;
    try {
        id = ports_.terminals().create(size.first, size.second, directory,
                                       [this](int terminal, std::string_view bytes) {
                                           ports_.terminal_event({{"event", "term.output"}, {"id", terminal}, {"dataB64", base64_encode(bytes)}});
                                       });
    } catch (const taocode::WorkspaceError& failure) {
        error = failure.what();
        return Json::object();
    }
    ports_.terminals().write(id, line + "\r\n");
    ports_.terminal_event({{"event", "term.opened"}, {"id", id}, {"cwd", cwd.empty() ? root : cwd}, {"reason", "runInTerminal"}});
    return Json::object();
}

// Drops the console windows the adapter asked for once their child is gone, so
// a long debug session does not accumulate spent Runner objects.
void Host::reap_external_runners() {
    std::lock_guard lock(external_mutex_);
    std::vector<std::unique_ptr<taocode::Runner>> alive;
    alive.reserve(external_runners_.size());
    for (auto& console : external_runners_) if (console && console->running()) alive.push_back(std::move(console));
    external_runners_.swap(alive);
}

// DAP `startDebugging` (adapter -> host reverse request): the nested session
// replaces the current one, exactly like IDEA launching a child process debug
// from the debug toolbar — one adapter at a time, the previous one reaped.
Json Host::start_nested_debug(const Json& args, std::string& error) {
    const Json configuration = args.contains("configuration") && args.at("configuration").is_object()
                                   ? args.at("configuration") : Json::object();
    const auto kind = configuration.value("kind", std::string("cppvsdbg"));
    const Json entry = registry_.is_object() ? registry_.value(kind, Json::object()) : Json::object();
    auto command = configuration.value("command", std::string());
    if (command.empty()) command = entry.value("command", std::string());
    if (command.empty()) { error = "没有为 kind \"" + kind + "\" 配置调试适配器。"; return Json::object(); }
    std::vector<std::wstring> arguments;
    const Json args_src = configuration.contains("args") ? configuration.at("args") : entry.value("args", Json::array());
    if (args_src.is_array()) for (const auto& item : args_src) if (item.is_string()) arguments.push_back(wide(item.get<std::string>()));
    auto cwd = configuration.value("cwd", std::string());
    if (cwd.empty()) cwd = ports_.root();
    auto nested = std::make_unique<dap::Client>();
    nested->set_root(fs::path(wide(ports_.root())));
    try {
        nested->start(wide(command), arguments, fs::path(wide(cwd)),
                      [this](Json event) { queue_event({{"event", "dap.event"}, {"payload", std::move(event)}}); });
    } catch (const taocode::WorkspaceError& failure) {
        error = failure.what();
        return Json::object();
    }
    stop();
    client_ = std::move(nested);
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
    client_->start_debugging(kind, std::move(request_configuration), [startup](Json, Json failure) {
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

}  // namespace dap_host
}  // namespace taocode
