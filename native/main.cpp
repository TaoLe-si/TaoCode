#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <dwmapi.h>
#include <wrl.h>
#include <WebView2.h>
#include <chrono>
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

    std::unique_ptr<taocode::dap::Client> dap;
    std::mutex dap_mutex;
    std::deque<Json> dap_events;
    Json dap_config;  // optional TaoCode.dap.json: kind -> {command,args,program,cwd}

    std::unique_ptr<taocode::terminal::Manager> terminals = std::make_unique<taocode::terminal::Manager>();
    std::mutex term_mutex;
    std::deque<Json> term_events;

    std::unique_ptr<taocode::history::History> history;  // per-project local history, recreated on open
    std::unique_ptr<taocode::session::SessionStore> sessions;  // crash-recovery drafts, per profile

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
    }

    void start_run(const std::string& line) {
        if (line.empty()) throw taocode::WorkspaceError("INVALID_REQUEST", "运行命令不能为空。");
        if (runner && runner->running()) throw taocode::WorkspaceError("BUSY", "已有构建/运行任务在进行中，请先停止。");
        runner = std::make_unique<taocode::Runner>();
        taocode::Runner::Spec spec;
        spec.command = L"cmd.exe";
        spec.arguments = {L"/d", L"/s", L"/c", wide(line)};
        if (!current_root.empty()) spec.working_directory = fs::path(wide(current_root));
        runner->start(spec,
            [this](std::string_view chunk) { queue_run({{"event", "run.output"}, {"chunk", Json(std::string(chunk))}}); },
            [this](int code) { queue_run({{"event", "run.exit"}, {"code", code}}); });
    }

    void stop_run() {
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
        if (!dap) { load_dap_config(); dap = std::make_unique<taocode::dap::Client>(); }
        dap->set_root(fs::path(wide(current_root)));
        return *dap;
    }

    void stop_dap() noexcept { if (dap) { dap->shutdown(); dap.reset(); } }

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
        configure_lsp();
        lsp->set_root(root.empty() ? fs::path() : fs::path(wide(root)));
    }

    void set_theme(bool dark) {
        const BOOL enabled = dark;
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

    Json select_directory(const wchar_t* title) {
        ComPtr<IFileOpenDialog> dialog;
        check(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)), "Create folder picker");
        DWORD options{};
        check(dialog->GetOptions(&options), "Get folder options");
        check(dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR | FOS_DONTADDTORECENT), "Set folder options");
        dialog->SetTitle(title);
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
        const auto title = wide(result.at("name").get<std::string>() + " — TaoCode");
        SetWindowTextW(window, title.c_str());
        return result;
    }

    void post_json(const Json& value) {
        const auto text = wide(value.dump(-1, ' ', false, Json::error_handler_t::replace));
        webview->PostWebMessageAsJson(text.c_str());
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
        const auto start = std::chrono::steady_clock::now();
        Json reply = {{"id", 0}, {"ok", false}};
        try {
            const Json request = Json::parse(utf8(text));
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
            if (clone_active && (method == "workspace.open" || method == "workspace.close" || method == "project.create" || method == "project.clone" || method == "project.settings.update" || method == "file.create" || method == "file.rename" || method == "file.delete"))
                throw taocode::WorkspaceError("BUSY", "请先等待克隆完成或取消克隆。");
            Json result;
            if (method == "app.state") {
                result = projects->state();
                result["gitAvailable"] = !taocode::find_git_executable().empty();
                result["defaultParent"] = default_parent;
            } else if (method == "dialog.pickDirectory") result = select_directory(L"选择项目存放目录");
            else if (method == "workspace.open") {
                const auto path = params.contains("path") ? params.at("path") : select_directory(L"打开 TaoCode 工作区");
                result = path.is_null() ? Json(nullptr) : open_project(fs::path(wide(path.get<std::string>())));
            } else if (method == "workspace.close") {
                projects->closed();
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
            else if (method == "settings.update") result = projects->update_settings(params.at("settings"));
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
                                          params.value("encoding", std::string("utf-8")), params.value("bom", false));
                if (history) { try { history->record(path, content, "save"); } catch (const taocode::WorkspaceError&) { /* history is best-effort; never blocks a save */ } }
            }
            else if (method == "file.create") result = workspace->create(params.at("path").get<std::string>(), params.value("directory", false), params.value("template", std::string()));
            else if (method == "file.readOnly") result = workspace->set_read_only(params.at("path").get<std::string>(), params.value("readOnly", true));
            else if (method == "file.lineSeparators") result = workspace->convert_line_separators(params.at("path").get<std::string>(), params.at("separator").get<std::string>(), params.at("content").get<std::string>(), params.at("expectedVersion").get<std::string>());
            else if (method == "file.rename") result = workspace->rename(params.at("from").get<std::string>(), params.at("to").get<std::string>());
            else if (method == "file.delete") result = workspace->remove(params.at("path").get<std::string>());
            else if (method == "file.copy") result = workspace->copy(params.at("from").get<std::string>(), params.at("to").get<std::string>());
            else if (method == "file.reveal") result = workspace->reveal(params.at("path").get<std::string>());
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
                result = lsp ? lsp->open(params.at("path").get<std::string>(), params.value("text", std::string()))
                             : Json{{"running", false}, {"language", taocode::lsp::Session::language_for(params.at("path").get<std::string>())}};
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
                start_run(params.value("command", std::string()));
                result = {{"started", true}};
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
                                     params.value("amend", false));
                result = {{"ok", true}};
            }
            else if (method == "git.checkout") {
                taocode::git::checkout(fs::path(wide(require_repo_root())), params.at("branch").get<std::string>());
                result = {{"ok", true}};
            }
            else if (method == "git.log") result = taocode::git::log(fs::path(wide(require_repo_root())), params.value("path", std::string()), params.value("limit", 100));
            else if (method == "git.logFull") result = taocode::git::log_full(fs::path(wide(require_repo_root())), params.value("limit", 200));
            else if (method == "git.pull") { taocode::git::pull(fs::path(wide(require_repo_root()))); result = {{"ok", true}}; }
            else if (method == "git.push") { taocode::git::push(fs::path(wide(require_repo_root()))); result = {{"ok", true}}; }
            else if (method == "git.stash") result = taocode::git::stash_list(fs::path(wide(require_repo_root())));
            else if (method == "git.stash.save") { taocode::git::stash_save(fs::path(wide(require_repo_root())), params.value("message", std::string())); result = {{"ok", true}}; }
            else if (method == "git.stash.pop") { taocode::git::stash_pop(fs::path(wide(require_repo_root()))); result = {{"ok", true}}; }
            else if (method == "git.branch.create") { taocode::git::create_branch(fs::path(wide(require_repo_root())), params.at("name").get<std::string>(), params.value("checkout", false)); result = {{"ok", true}}; }
            else if (method == "git.merge") { taocode::git::merge(fs::path(wide(require_repo_root())), params.at("branch").get<std::string>()); result = {{"ok", true}}; }
            else if (method == "git.aheadBehind") result = taocode::git::ahead_behind(fs::path(wide(require_repo_root())));
            else if (method == "git.blame") result = taocode::git::blame(fs::path(wide(require_repo_root())), params.at("path").get<std::string>());
            else if (method == "search.run" || method == "search.replace") {
                const auto repository = fs::path(wide(require_repo_root()));
                taocode::search::Options options;
                options.query = params.value("query", std::string());
                options.regex = params.value("regex", false);
                options.case_sensitive = params.value("caseSensitive", true);
                options.whole_word = params.value("wholeWord", false);
                options.include = taocode::search::parse_patterns(params.value("include", std::string()));
                options.exclude = taocode::search::parse_patterns(params.value("exclude", std::string()));
                if (method == "search.run") result = taocode::search::run(repository, options);
                else {
                    options.replacement = params.value("replacement", std::string());
                    result = taocode::search::replace(repository, options);
                }
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
            else if (method == "dap.terminate") { stop_dap(); result = {{"ok", true}}; }
            else if (method == "dap.disconnect") { if (dap) { dap->disconnect({}); dap->shutdown(); } result = {{"ok", true}}; }
            else if (method == "term.create") {
                result = {{"id", terminals->create(params.value("cols", 80), params.value("rows", 24),
                                                   current_root.empty() ? std::wstring() : wide(current_root),
                                                   [this](int id, std::string_view bytes) {
                                                       queue_term({{"event", "term.output"}, {"id", id}, {"dataB64", base64_encode(bytes)}});
                                                   })}};
            }
            else if (method == "term.write") { terminals->write(params.at("id").get<int>(), base64_decode(params.value("dataB64", std::string()))); result = {{"ok", true}}; }
            else if (method == "term.resize") { terminals->resize(params.at("id").get<int>(), params.value("cols", 80), params.value("rows", 24)); result = {{"ok", true}}; }
            else if (method == "term.kill") { terminals->kill(params.at("id").get<int>()); result = {{"ok", true}}; }
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
        post_json(reply);
    }

    void configure() {
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
            try { message(args); } catch (...) {}
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
        case WM_CLOSE:
            if (!app->closing_after_clone && app->dirty && MessageBoxW(window, L"有未保存的修改。确定放弃修改并关闭？", L"TaoCode", MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2) != IDYES) return 0;
            if (app->clone_active) {
                if (!app->closing_after_clone && MessageBoxW(window, L"克隆仍在进行，确定取消克隆并退出？", L"TaoCode", MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) != IDYES) return 0;
                app->closing_after_clone = true;
                app->clone_thread.request_stop();
                return 0;
            }
            app->stop_lsp();  // reap language-server children before teardown
            app->stop_run();  // kill any running build/process tree
            app->stop_dap();  // never orphan a debug adapter or its debuggee
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
