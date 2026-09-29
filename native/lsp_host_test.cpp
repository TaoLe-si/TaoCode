// End-to-end test: launch the fake language server as a real child process over
// inherited stdio pipes and drive a full LSP round-trip through Host + Client.
// This is the only test that exercises OS process spawn and pipe framing.
#include "lsp_host.hpp"

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
#include <thread>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::lsp::Host;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

fs::path self_directory() {
    std::wstring path(32768, L'\0');
    const auto length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    check(length && length < path.size(), "cannot locate the test executable");
    path.resize(length);
    return fs::path(path).parent_path();
}
}  // namespace

int main() {
    int failures = 0;
    int passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try {
            operation();
            ++passed;
            std::cout << "PASS " + name << '\n';
        } catch (const std::exception& error) {
            ++failures;
            std::cerr << "FAIL " << name << ": " << error.what() << '\n';
        }
    };

    run("spawn → initialize → didOpen diagnostics → hover → shutdown", [&] {
        Host host;
        std::mutex mutex;
        std::condition_variable ready;
        bool initialized = false, init_failed = false, got_diagnostics = false, got_hover = false, got_progress = false;
        Json diagnostics, hover_result;
        std::vector<Json> progress;

        host.set_diagnostics([&](Json params) {
            std::lock_guard lock(mutex);
            diagnostics = std::move(params);
            got_diagnostics = true;
            ready.notify_all();
        });
        // `$/progress` 走的是另一个回调：一条通知都不许漏给诊断那一路（也不许被丢掉）。
        host.set_progress([&](Json params) {
            std::lock_guard lock(mutex);
            progress.push_back(std::move(params));
            got_progress = progress.size() >= 3;
            ready.notify_all();
        });

        Host::Spec spec;
        spec.executable = self_directory() / L"lsp_fake_server.exe";
        check(fs::exists(spec.executable), "fake server binary is missing: " + spec.executable.string());

        host.start(spec, {{"clientInfo", {{"name", "lsp-host-test"}, {"version", "0"}}}},
                   [&](Json, Json error) {
                       std::lock_guard lock(mutex);
                       init_failed = !error.is_null();
                       initialized = true;
                       ready.notify_all();
                   });

        const auto wait_for = [&](bool& flag) {
            std::unique_lock lock(mutex);
            return ready.wait_for(lock, std::chrono::seconds(10), [&] { return flag; });
        };

        check(wait_for(initialized), "initialize callback never fired");
        check(!init_failed, "server failed to initialize");
        check(host.alive(), "host should be alive after a successful handshake");

        host.did_open("file:///tmp/Sample.java", "java", 1, "class Sample {}\n");
        check(wait_for(got_diagnostics), "no publishDiagnostics after didOpen");
        check(diagnostics.at("uri") == "file:///tmp/Sample.java", "diagnostics carry the opened uri");
        check(diagnostics.at("diagnostics").size() == 1 && diagnostics.at("diagnostics")[0].at("message") == "fake diagnostic",
              "diagnostic payload survived framing");

        check(wait_for(got_progress), "三拍 `$/progress`（begin/report/end）都要转出来");
        {
            std::lock_guard lock(mutex);
            check(progress.size() >= 3, "progress params collected");
            check(progress[0].at("token") == "fake-index" && progress[0].at("value").at("kind") == "begin",
                  "begin 那一拍要原样转出去");
            check(progress[1].at("value").at("percentage") == 40, "report 里的百分比不能在路上丢掉");
            check(progress[2].at("value").at("kind") == "end", "end 那一拍也要转出去（前端靠它删行）");
        }

        host.request("textDocument/hover", {{"textDocument", {{"uri", "file:///tmp/Sample.java"}}},
                                            {"position", {{"line", 0}, {"character", 6}}}},
                     [&](Json result, Json error) {
                         std::lock_guard lock(mutex);
                         hover_result = error.is_null() ? result : Json(nullptr);
                         got_hover = true;
                         ready.notify_all();
                     });
        check(wait_for(got_hover), "hover response never arrived");
        check(hover_result.at("contents").at("value") == "hover from fake", "hover content round-tripped");

        host.stop();
        check(!host.alive(), "host is not alive after stop");
    });

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
