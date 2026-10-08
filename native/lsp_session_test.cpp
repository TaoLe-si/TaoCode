// Validates the LSP session layer end-to-end over a real child process (the fake
// server) plus the pure workspace-relative <-> file:// <-> provider-shape mapping.
#include "lsp_session.hpp"
// 整批整形（`shape_publish_params`）在这里判：它在 lsp_support 那一层，宿主事件的正确形状由它定。
#include "lsp_support.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <iostream>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::lsp::Session;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

fs::path self_directory() {
    std::wstring path(32768, L'\0');
    const auto length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    path.resize(length);
    return fs::path(path).parent_path();
}
}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    run("language_for maps extensions", [&] {
        check(Session::language_for("src/Main.java") == "java", "java");
        check(Session::language_for("a/b/c.CPP") == "cpp", "cpp case-insensitive");
        check(Session::language_for("App.tsx") == "typescriptreact", "tsx");
        check(Session::language_for("no-extension") == "", "no extension");
    });

    run("path <-> file URI round-trips through the workspace root", [&] {
        Session session([](std::string, Json) {});
        session.set_root(fs::path(L"C:\\Users\\dev\\My Project"));
        // has_server false means open() short-circuits, so probe mapping via open on a
        // configured-but-absent language is not possible; instead assert via public open
        // result language and a definition round-trip below (integration test).
        const auto result = session.open("src/中文 File.java", "class A {}");
        check(result.at("running") == false, "no server configured yet");
        check(result.at("language") == "java", "language detected");
        check(result.at("configured") == false && result.at("ready") == false, "missing Java server is explicit");
    });

    run("a spawn failure preserves its error instead of a silent running=false", [&] {
        Session session([](std::string, Json) {});
        session.set_root(fs::path(L"C:\\ws"));
        Session::ServerConfig config;
        config.command = (self_directory() / L"missing-taocode-java-server.exe").native();
        session.configure({{"java", config}});
        const auto opened = session.open("Main.java", "class Main {}");
        check(opened.at("running") == false && opened.at("ready") == false, "spawn failure cannot look ready");
        check(opened.at("configured") == true, "failed executable is distinct from no configuration");
        check(opened.at("error").at("code") == "LSP_SPAWN", "preserve spawn failure code");
        check(!opened.at("error").at("message").get<std::string>().empty(), "preserve Windows spawn reason");
        // Reopening after the user fixed the configuration must not replay the
        // stale failure: the error is cleared and the launch is attempted again.
        session.configure({});
        Session::ServerConfig fixed;
        fixed.command = (self_directory() / L"lsp_fake_server.exe").native();
        session.configure({{"java", fixed}});
        const auto retried = session.open("Main.java", "class Main {}");
        check(retried.at("running") == true, "a fixed configuration starts the server: " + retried.dump());
        check(!retried.contains("error"), "the previous failure is not replayed");
        session.shutdown_all();
    });

    run("a failed initialize stays diagnosable through the status route", [&] {
        Session session([](std::string, Json) {});
        session.set_root(fs::path(L"C:\\ws"));
        Session::ServerConfig config;
        config.command = (self_directory() / L"lsp_fake_server.exe").native();
        config.arguments = {L"--hang=initialize"};
        session.configure({{"java", config}});
        session.set_timeout(std::chrono::milliseconds(100));
        const auto opened = session.open("Main.java", "class Main {}");
        check(opened.at("running") == true && opened.at("ready") == false, "spawned is not initialized");
        Json status;
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
        do {
            session.semantic("status", "Main.java", 0, 0, Json::object(), [&](Json value, Json error) {
                check(error.is_null(), "status must be queryable after initialization fails");
                status = std::move(value);
            });
            if (status.contains("error")) break;
            Sleep(10);
        } while (std::chrono::steady_clock::now() < deadline);
        check(status.at("running") == false && status.at("ready") == false, "failed handshake does not enable completion");
        check(status.at("error").at("message") == "TIMEOUT", "initialize timeout reaches the frontend");
        // Same retry contract as a spawn failure: the dead client is replaced,
        // not reused, and the failure is not reported twice.
        session.set_timeout(std::chrono::seconds(10));
        Session::ServerConfig fixed;
        fixed.command = (self_directory() / L"lsp_fake_server.exe").native();
        session.configure({{"java", fixed}});
        const auto retried = session.open("Main.java", "class Main {}");
        check(retried.at("running") == true, "the retry starts a fresh client: " + retried.dump());
        check(!retried.contains("error"), "the initialize failure is not replayed");
        session.shutdown_all();
        check(!session.status("Main.java").contains("error"), "shutdown clears startup errors");
    });

    run("session drives a real server: open->diagnostics->hover->definition", [&] {
        std::mutex mutex;
        std::condition_variable cv;
        bool got_diagnostics = false, got_hover = false, got_definition = false;
        std::string diag_path;
        Json diag_payload, hover_payload, definition_payload;

        Session session([&](std::string path, Json diagnostics) {
            std::lock_guard lock(mutex);
            diag_path = std::move(path);
            diag_payload = std::move(diagnostics);
            got_diagnostics = true;
            cv.notify_all();
        });
        session.set_root(fs::path(L"C:\\ws"));
        Session::ServerConfig config;
        config.command = (self_directory() / L"lsp_fake_server.exe").native();
        config.settings = {{"java", {{"project", {{"sourcePaths", Json::array({"configured/src"})}}}}}};
        std::map<std::string, Session::ServerConfig> servers;
        servers["java"] = config;
        session.configure(std::move(servers));

        const auto opened = session.open("src/Sample.java", "class Sample {}\n");
        check(opened.at("running") == true, "java server should start");
        check(opened.at("language") == "java", "language is java");

        const auto wait_for = [&](bool& flag) {
            std::unique_lock lock(mutex);
            return cv.wait_for(lock, std::chrono::seconds(10), [&] { return flag; });
        };

        check(wait_for(got_diagnostics), "no diagnostics after deferred didOpen");
        check(session.status("src/Sample.java").at("ready") == true, "only a successful handshake enables completion");
        check(diag_path == "src/Sample.java", "diagnostics path is workspace-relative: " + diag_path);
        check(diag_payload.is_array() && diag_payload.size() == 1 && diag_payload[0].at("message") == "fake diagnostic",
              "diagnostic payload mapped");

        session.request("hover", "src/Sample.java", 0, 6, [&](Json result, Json) {
            std::lock_guard lock(mutex);
            hover_payload = result;
            got_hover = true;
            cv.notify_all();
        });
        check(wait_for(got_hover), "no hover result");
        check(hover_payload.at("available") == true && hover_payload.at("contents") == "hover with Java settings",
              "initialize carried the project's JDT settings");

        session.request("definition", "src/Sample.java", 1, 0, [&](Json result, Json) {
            std::lock_guard lock(mutex);
            definition_payload = result;
            got_definition = true;
            cv.notify_all();
        });
        check(wait_for(got_definition), "no definition result");
        check(definition_payload.at("available") == true &&
                  definition_payload.at("locations")[0].at("path") == "src/Sample.java",
              "definition location mapped back to relative path");

        session.request("hover", "missing.txt", 0, 0, [&](Json, Json error) {
            check(!error.is_null(), "closed/unknown document is rejected");
        });

        session.shutdown_all();
    });

    // `PublishDiagnosticsParams.version` 的整批整形。三条边界都要有真的判据：
    // ① 空 version（服务器没声明）必须是 null —— 前端 `acceptsPublishedVersion()` 拿 null 才走
    //    「照收」那条分支（上游 `LspPublishDiagnosticsCache.kt:57` 的 `declaredVersion != null`），
    //    塌成 0/-1 就会把没版本的说成「第 0 版」，从此逢版本≠0 就拒；
    // ② 0 是合法的版本号（LSP 里 version 是任意整数），不能被当成「没声明」；
    // ③ 递减/陈旧的批次原样透传：宿主一丢，闸门就没数据可拒（拒收那一步在显示缓存那一侧）。
    run("整批 version 的整形：没声明=null、0=合法号、认不出的形状=没声明、递减=照原样交", [&] {
        using taocode::lsp::detail::shape_publish_params;
        const Json no_version{{"uri", "file:///a.java"}, {"diagnostics", Json::array()}};
        const auto absent = shape_publish_params(no_version);
        check(absent.version.is_null(), "缺 version 要当「没声明」，实得 " + absent.version.dump());
        check(absent.items.is_array() && absent.items.empty(), "缺 diagnostics 当空批次而不是丢事件");

        const Json version_zero{{"uri", "file:///a.java"}, {"version", 0}, {"diagnostics", Json::array({
            {{"range", {{"start", {{"line", 1}, {"character", 2}}}, {"end", {{"line", 1}, {"character", 3}}}}},
             {"message", "v0"}}})}};
        const auto first = shape_publish_params(version_zero);
        check(!first.version.is_null() && first.version.get<int>() == 0,
              "第 0 版不能被塌成「没声明」，实得 " + first.version.dump());
        check(first.items.size() == 1 && first.items[0].at("message") == "v0", "条目仍按原规矩整形");

        const std::vector<Json> malformed{
            Json{{"version", "3"}},                       // 字符串号：不猜
            Json{{"version", 3.5}},                       // 小数：协议说的是 integer
            Json{{"version", nullptr}},                   // 显式 null
            Json::object(),                               // 整条没有这个键
            Json(nullptr),                                // params 根本不是对象（坏输入不许抛）
        };
        for (const auto& bad : malformed)
            check(shape_publish_params(bad).version.is_null(),
                  "认不出的 version 形状一律当没声明: " + bad.dump());

        const auto newer = shape_publish_params(Json{{"uri", "file:///a.java"}, {"version", 7}, {"diagnostics", Json::array()}});
        const auto older = shape_publish_params(Json{{"uri", "file:///a.java"}, {"version", 3}, {"diagnostics", Json::array()}});
        check(newer.version.get<int>() == 7 && older.version.get<int>() == 3,
              "陈旧的那一条也得带着自己的号出去，否则闸门没数据可拒");
    });

    // `Diagnostic.relatedInformation` 的透传（上游 `LspDiagnosticAndLazyQuickFixes.kt:42` 原样保留）：
    // 给了 uri→工作区相对路径的折法就折成宿主形状 `{path,line,character,message}`（前端
    // `src/problems.ts` 的 `relatedFrom` 消费、面板列「相关位置」一节）；折不出路径的条目丢弃
    // （猜错位置比少列一行更糟）；没给折法时整格不写（老调用点与单测得到的形状逐字不变）。
    run("relatedInformation 折成宿主形状：有折法才带、折不出路径就丢、没折法整格不写", [&] {
        using taocode::lsp::detail::shape_publish_params;
        const Json params{{"uri", "file:///a.java"}, {"diagnostics", Json::array({
            {{"range", {{"start", {{"line", 0}, {"character", 0}}}, {"end", {{"line", 0}, {"character", 1}}}}},
             {"message", "unused"},
             {"relatedInformation", Json::array({
                 {{"location", {{"uri", "file:///a.java"},
                                {"range", {{"start", {{"line", 4}, {"character", 8}}}}}}},
                  {"message", "declared here"}},
                 {{"location", {{"uri", "file:///out/of/root.java"},
                                {"range", {{"start", {{"line", 1}, {"character", 0}}}}}}},
                  {"message", "elsewhere"}},
             })}},
        })}};
        const auto fold = [](const std::string& uri) -> std::string {
            return uri == "file:///a.java" ? std::string("a.java") : std::string();
        };
        const auto shaped = shape_publish_params(params, fold);
        check(shaped.items.size() == 1, "一条诊断照旧出");
        const auto& entry = shaped.items[0];
        check(entry.contains("relatedInformation"), "有折法时要带 relatedInformation");
        check(entry.at("relatedInformation").size() == 1, "折不出路径的那条要丢");
        const auto& rel = entry.at("relatedInformation")[0];
        check(rel.at("path") == "a.java" && rel.at("line") == 4 && rel.at("character") == 8 &&
              rel.at("message") == "declared here", "折成 {path,line,character,message}: " + rel.dump());
        check(!shape_publish_params(params).items[0].contains("relatedInformation"),
              "没给折法时整格不写（老形状不变）");
    });

    // 同一条推送**只走一条 sink**：注册了带版本的那条就不再走旧的两参那条（否则宿主会收到
    // 两个 `lsp.diagnostics` 事件、表被来回覆盖）。这一条也顺带证明旧路径没被改坏 ——
    // 没注册新 sink 的宿主（今天的 main.cpp）行为逐字不变。
    run("version 从真的帧里走到宿主手上：注册了新 sink 就只走它，且空版本批次给 null", [&] {
        std::mutex mutex;
        std::condition_variable cv;
        std::vector<Json> versions, batches;
        std::string last_path;
        int plain_calls = 0;

        Session session([&](std::string path, Json) {
            std::lock_guard lock(mutex);
            last_path = std::move(path);
            ++plain_calls;
            cv.notify_all();
        });
        session.set_versioned_diagnostics_sink([&](std::string path, Json diagnostics, Json version) {
            std::lock_guard lock(mutex);
            last_path = std::move(path);
            batches.push_back(std::move(diagnostics));
            versions.push_back(std::move(version));
            cv.notify_all();
        });
        session.set_root(fs::path(L"C:\\ws"));
        Session::ServerConfig config;
        config.command = (self_directory() / L"lsp_fake_server.exe").native();
        std::map<std::string, Session::ServerConfig> servers;
        servers["java"] = config;
        session.configure(std::move(servers));

        const auto opened = session.open("src/Sample.java", "class Sample {}\n");
        check(opened.at("running") == true, "java server should start");

        const auto wait_events = [&](std::size_t want) {
            std::unique_lock lock(mutex);
            return cv.wait_for(lock, std::chrono::seconds(20), [&] { return versions.size() >= want; });
        };
        check(wait_events(1), "didOpen 之后没收到带版本的诊断");
        // Session 打开文档时报的是第 1 版（lsp_session.cpp 的 `doc.version = 1`），
        // 假服务器按真实服务器的规矩回显同一个号 ⇒ 这一条断的是「键名、类型、整条链路」。
        check(!versions[0].is_null() && versions[0].is_number_integer() && versions[0].get<int>() == 1,
              "整批的 version 要原样到宿主手上，实得 " + versions[0].dump());
        check(batches[0].size() == 1 && batches[0][0].at("message") == "fake diagnostic",
              "改道之后条目一个都不能少");
        check(last_path == "src/Sample.java", "path 仍是工作区相对路径: " + last_path);
        check(plain_calls == 0, "注册了带版本的 sink 就不该再走旧那条（一条推送 = 一个事件）");

        // 空 version 的那一条：文件操作触发的推送不带版本（假服务器就没写那个键），
        // 宿主必须交 null 而不是猜一个号 —— 前端据此走「照收」那条分支。
        session.announce_file_operations("created", std::vector<Session::FileOperation>{{"src/Extra.java", ""}});
        check(wait_events(2), "文件操作的推送没到");
        check(versions[1].is_null(), "服务器没发版本的批次必须是 null，实得 " + versions[1].dump());
        check(batches[1].size() == 1 && batches[1][0].at("message").get<std::string>().find("workspace/didCreateFiles") != std::string::npos,
              "第二条推送确实是文件操作那一条: " + batches[1].dump());

        session.shutdown_all();
    });

    // 服务器**主动发起**的三条请求走完一整条链：子进程发请求 → Client 回包 → Session 把它整形
    // 成一条 `lsp.message` 事件 → 前端的 progress 出口收得到 registrations / token 的本体。
    // 只测 Client 层的话，宿主那段整形（`native/lsp_host_bootstrap.cpp` 的 `set_server_message`）
    // 少透传一个键也不会有任何测试变红 —— 而界面那一头拿不到条目本体就只能"收下不记账"，
    // 正是本轮要补掉的那类静默缺陷。
    run("三条服务器主动请求各自有回包，并且内容真的转到了事件里", [&] {
        std::mutex mutex;
        std::condition_variable cv;
        std::vector<Json> messages;

        Session session([](std::string, Json) {});
        session.set_progress_sink([&](Json payload) {
            std::lock_guard lock(mutex);
            if (payload.is_object() && payload.value("event", std::string()) == "lsp.message")
                messages.push_back(std::move(payload));
            cv.notify_all();
        });
        session.set_root(fs::path(L"C:\\ws"));
        Session::ServerConfig config;
        config.command = (self_directory() / L"lsp_fake_server.exe").native();
        config.arguments = {L"--server-requests"};
        std::map<std::string, Session::ServerConfig> servers;
        servers["java"] = config;
        session.configure(std::move(servers));

        const auto opened = session.open("Src.java", "class Src {}\n");
        check(opened.at("running") == true, "fake server starts: " + opened.dump());

        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
        std::unique_lock lock(mutex);
        const auto has_method = [&] {
            for (const auto& message : messages)
                if (message.value("method", std::string()) == "client/unregisterCapability") return true;
            return false;
        };
        while (!has_method() && std::chrono::steady_clock::now() < deadline)
            cv.wait_for(lock, std::chrono::milliseconds(200));
        const auto found = messages;
        lock.unlock();

        const auto find_by = [&](const std::string& method) {
            for (const auto& message : found)
                if (message.value("method", std::string()) == method) return message;
            return Json(nullptr);
        };
        const auto registered = find_by("client/registerCapability");
        check(!registered.is_null(), "client/registerCapability 的内容转到了事件里（没转 = 收下不记账）");
        check(registered.contains("registrations") && registered.at("registrations").is_array() &&
                  registered.at("registrations").size() == 1 &&
                  registered.at("registrations")[0].at("id") == "dyn-diagnostic" &&
                  registered.at("registrations")[0].at("method") == "textDocument/diagnostic",
              "registrations 原样带出来（前端按它登记 id→method 并作废那一族缓存）");
        const auto created = find_by("window/workDoneProgress/create");
        check(!created.is_null() && created.contains("token") && created.at("token") == "import-token",
              "token 带得出来，整数与字符串两种 ProgressToken 同理");
        const auto unregistered = find_by("client/unregisterCapability");
        check(!unregistered.is_null() && unregistered.contains("unregisterations") &&
                  unregistered.at("unregisterations").size() == 1,
              "注销的那一批也带得出来（前端据此把登记着的那一项摘掉）");
        check(created.value("language", std::string()) == "java", "事件带着是哪一台服务器说的");
        session.shutdown_all();
    });

    // A server that accepts a request and then never answers it must cost the UI a
    // bounded wait: the request is failed with TIMEOUT and dropped from the pending
    // map, so the session keeps working.
    run("a request the server never answers times out instead of hanging", [&] {
        std::mutex timed_mutex;
        std::condition_variable timed_cv;
        bool got_hover = false, got_definition = false;
        Json hover_error, definition_payload;

        Session session([](std::string, Json) {});
        session.set_root(fs::path(L"C:\\ws"));
        Session::ServerConfig config;
        config.command = (self_directory() / L"lsp_fake_server.exe").native();
        config.arguments = {L"--hang=textDocument/hover"};
        std::map<std::string, Session::ServerConfig> servers;
        servers["java"] = config;
        session.configure(std::move(servers));
        session.set_timeout(std::chrono::milliseconds(400));

        const auto opened = session.open("src/Hang.java", "class Hang {}\n");
        check(opened.at("running") == true, "the hung server should still start");

        const auto wait_for = [&](bool& flag) {
            std::unique_lock lock(timed_mutex);
            return timed_cv.wait_for(lock, std::chrono::seconds(15), [&] { return flag; });
        };
        const auto sent_at = std::chrono::steady_clock::now();
        session.request("hover", "src/Hang.java", 0, 6, [&](Json, Json error) {
            std::lock_guard lock(timed_mutex);
            hover_error = std::move(error);
            got_hover = true;
            timed_cv.notify_all();
        });
        check(wait_for(got_hover), "a request the server never answers must still be answered");
        check(!hover_error.is_null(), "the timeout must surface as an error, not an empty success");
        check(hover_error.value("message", std::string()) == "TIMEOUT",
              "the error names the timeout, got: " + hover_error.dump());
        check(std::chrono::steady_clock::now() - sent_at < std::chrono::seconds(10),
              "and it arrives when the deadline expires");

        // The session survives: another request on the same server still round-trips.
        session.request("definition", "src/Hang.java", 1, 0, [&](Json result, Json) {
            std::lock_guard lock(timed_mutex);
            definition_payload = std::move(result);
            got_definition = true;
            timed_cv.notify_all();
        });
        check(wait_for(got_definition), "the session must still work after a timeout");
        check(definition_payload.value("available", false) == true, "definition answered normally");

        session.shutdown_all();
    });

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
