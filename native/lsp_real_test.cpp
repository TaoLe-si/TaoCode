// Opt-in proof that the whole C++ stack (Session -> Host -> CreateProcess ->
// Content-Length framing -> real LSP server) works against a genuine third-party
// language server. It SKIPS (exit 0) unless TAOCODE_LSP_REAL=1 so the committed
// suite stays hermetic. To run locally:
//   set TAOCODE_LSP_REAL=1
//   set TAOCODE_LSP_CMD=node
//   set TAOCODE_LSP_ARGS=<abs>\typescript-language-server\lib\cli.mjs;--stdio
//   set TAOCODE_LSP_ROOT=<a directory whose node_modules contains typescript>
//   set TAOCODE_LSP_LANG=typescript
//   set TAOCODE_LSP_FILE=RealLspCheck.ts
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
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::lsp::Session;

std::string env(const char* name, const std::string& fallback = {}) {
    const char* value = std::getenv(name);
    return value && *value ? std::string(value) : fallback;
}
std::vector<std::wstring> split_args(const std::string& raw) {
    std::vector<std::wstring> parts;
    std::string current;
    for (char ch : raw) {
        if (ch == ';') { if (!current.empty()) parts.push_back(fs::path(current).native()); current.clear(); }
        else current.push_back(ch);
    }
    if (!current.empty()) parts.push_back(fs::path(current).native());
    return parts;
}
}  // namespace

int main() {
    if (env("TAOCODE_LSP_REAL") != "1") {
        std::cout << "SKIP lsp_real_test (set TAOCODE_LSP_REAL=1 to run against a real server)\n";
        return 0;
    }
    const std::string command = env("TAOCODE_LSP_CMD");
    const std::string language = env("TAOCODE_LSP_LANG", "typescript");
    const std::string filename = env("TAOCODE_LSP_FILE", "RealLspCheck.ts");
    if (command.empty()) { std::cerr << "FAIL TAOCODE_LSP_CMD is required\n"; return 1; }

    std::mutex mutex;
    std::condition_variable cv;
    bool got_diagnostics = false, got_hover = false;
    Json diagnostics, hover_payload;
    Session session([&](std::string, Json params) {
        std::lock_guard lock(mutex);
        diagnostics = std::move(params);
        got_diagnostics = true;
        cv.notify_all();
    });
    session.set_root(fs::path(env("TAOCODE_LSP_ROOT", ".")));
    Session::ServerConfig config;
    config.command = fs::path(command).native();
    config.arguments = split_args(env("TAOCODE_LSP_ARGS"));
    std::map<std::string, Session::ServerConfig> servers;
    servers[language] = config;
    session.configure(std::move(servers));

    // A deliberate type error, phrased for the language under test.
    const std::string source = language == "java"
        ? "public class RealLspCheck {\n    int value = \"not an int\";\n}\n"
        : "export const value: number = \"definitely not a number\";\nexport const other = value + 1;\n";
    const auto opened = session.open(filename, source);
    if (opened.value("running", false) != true) { std::cerr << "FAIL server did not start\n"; return 1; }

    const auto wait_for = [&](bool& flag, int seconds) {
        std::unique_lock lock(mutex);
        return cv.wait_for(lock, std::chrono::seconds(seconds), [&] { return flag; });
    };
    if (!wait_for(got_diagnostics, 150)) { std::cerr << "FAIL no diagnostics from real server within 150s\n"; return 1; }
    const bool found = !diagnostics.empty();
    std::cout << (found ? "PASS" : "FAIL") << " real server (" << language << ") published " << diagnostics.size()
              << " diagnostic(s); first: " << (diagnostics.empty() ? std::string("(none)") : diagnostics[0].value("message", std::string())) << '\n';

    session.request("hover", filename, 0, 20, [&](Json result, Json) {
        std::lock_guard lock(mutex);
        hover_payload = result;
        got_hover = true;
        cv.notify_all();
    });
    if (wait_for(got_hover, 20))
        std::cout << "PASS hover answered: " << (hover_payload.contains("contents") ? hover_payload.at("contents").dump() : std::string("(none)")) << '\n';
    else
        std::cerr << "INFO hover did not answer in time\n";

    session.shutdown_all();
    return found ? 0 : 1;
}
