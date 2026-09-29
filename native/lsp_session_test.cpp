// Validates the LSP session layer end-to-end over a real child process (the fake
// server) plus the pure workspace-relative <-> file:// <-> provider-shape mapping.
#include "lsp_session.hpp"

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
#include <mutex>
#include <string>

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
