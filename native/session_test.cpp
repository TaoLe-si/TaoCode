// Offline self-test for the crash-recovery session store: one file per project root,
// verbatim state round-trips with drafts, shape validation (paths, sizes, field
// kinds), corrupt-file reporting, clear() on clean exit and per-root isolation.
#include "session.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::WorkspaceError;
using taocode::session::SessionStore;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

void expect_code(const char* code, auto&& operation) {
    try { operation(); }
    catch (const WorkspaceError& error) {
        check(error.code == code, std::string("expected ") + code + ", got " + error.code + " — " + error.what());
        return;
    }
    check(false, std::string("expected ") + code + ", but the call succeeded");
}

Json state_with(const std::string& path, const std::string& draft = "") {
    Json tab{{"path", path}, {"line", 12}, {"column", 4}, {"pane", 0}};
    if (!draft.empty()) tab["draft"] = draft;
    return Json{{"tabs", Json::array({tab})}, {"active", path}, {"orientation", "none"}};
}
}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    const auto store = fs::temp_directory_path() /
                       ("taocode-session-test-" + std::to_string(GetCurrentProcessId()));
    std::error_code ec;
    fs::remove_all(store, ec);
    fs::create_directories(store);
    SessionStore sessions{store / "sessions"};

    run("save and load round-trip a tab with its unsaved draft", [&] {
        sessions.save(R"(D:\proj\a)", state_with("src/Main.java", "unsaved\ndraft\n"));
        const auto loaded = sessions.load(R"(D:\proj\a)");
        check(loaded.at("found").get<bool>() == true, "the session exists");
        const auto& state = loaded.at("state");
        check(state.at("tabs").size() == 1, "one tab restored");
        check(state.at("tabs").at(0).at("path").get<std::string>() == "src/Main.java", "the path round-trips");
        check(state.at("tabs").at(0).at("draft").get<std::string>() == "unsaved\ndraft\n", "the draft round-trips");
        check(state.at("tabs").at(0).at("line").get<int>() == 12, "the caret line round-trips");
    });

    run("a missing session reports found:false and a cleared one too", [&] {
        check(sessions.load(R"(D:\proj\missing)").at("found").get<bool>() == false, "no session for an unknown root");
        sessions.save(R"(D:\proj\b)", state_with("x.txt"));
        check(sessions.clear(R"(D:\proj\b)").at("removed").get<bool>() == true, "clear removes the file");
        check(sessions.load(R"(D:\proj\b)").at("found").get<bool>() == false, "a cleared session no longer loads");
        check(sessions.clear(R"(D:\proj\b)").at("removed").get<bool>() == false, "clearing again is a no-op");
    });

    run("roots are isolated: one root's draft never leaks into another", [&] {
        sessions.save(R"(D:\proj\c1)", state_with("a.txt", "first"));
        sessions.save(R"(D:\proj\c2)", state_with("a.txt", "second"));
        check(sessions.load(R"(D:\proj\c1)").at("state").at("tabs").at(0).at("draft").get<std::string>() == "first", "root one keeps its draft");
        check(sessions.load(R"(D:\proj\c2)").at("state").at("tabs").at(0).at("draft").get<std::string>() == "second", "root two keeps its draft");
    });

    run("invalid states are rejected before anything is written", [&] {
        expect_code("INVALID_SESSION", [&] { sessions.save(R"(D:\proj\d)", Json{{"tabs", "not-an-array"}}); });
        expect_code("INVALID_SESSION", [&] { sessions.save(R"(D:\proj\d)", Json{{"tabs", Json::array({Json{{"line", 1}}})}}); });
        expect_code("INVALID_SESSION", [&] { sessions.save(R"(D:\proj\d)", Json{{"tabs", Json::array({Json{{"path", "/absolute.txt"}}})}}); });
        expect_code("INVALID_SESSION", [&] { sessions.save(R"(D:\proj\d)", Json{{"tabs", Json::array({Json{{"path", "a:b.txt"}}})}}); });
        expect_code("INVALID_SESSION", [&] { sessions.save(R"(D:\proj\d)", Json{{"tabs", Json::array({Json{{"path", "../up.txt"}}})}}); });
        expect_code("INVALID_SESSION", [&] { sessions.save(R"(D:\proj\d)", Json{{"tabs", Json::array({Json{{"path", "ok.txt"}, {"draft", 5}}})}}); });
        check(sessions.load(R"(D:\proj\d)").at("found").get<bool>() == false, "a rejected save leaves no file behind");
    });

    run("a corrupt session file reports corrupt instead of partially applying", [&] {
        sessions.save(R"(D:\proj\e)", state_with("ok.txt"));
        for (const auto& entry : fs::directory_iterator(store / "sessions")) {
            if (entry.path().extension() != ".json") continue;
            std::ofstream broken(entry.path(), std::ios::binary | std::ios::trunc);
            broken << "{ this is not json";
        }
        const auto loaded = sessions.load(R"(D:\proj\e)");
        check(loaded.at("found").get<bool>() == true, "the file is still found");
        check(loaded.at("corrupt").get<bool>() == true, "corrupt content is flagged");
        check(!loaded.contains("state"), "no partial state is returned");
    });

    run("oversized drafts are refused, in-range ones survive", [&] {
        const std::string big(4 * 1024 * 1024 + 1, 'x');
        expect_code("INVALID_SESSION", [&] { sessions.save(R"(D:\proj\f)", state_with("big.txt", big)); });
        const std::string fits(1024 * 1024, 'y');
        sessions.save(R"(D:\proj\f)", state_with("big.txt", fits));
        check(sessions.load(R"(D:\proj\f)").at("state").at("tabs").at(0).at("draft").get_ref<const std::string&>().size() == fits.size(),
              "a 1 MiB draft round-trips");
    });

    fs::remove_all(store, ec);
    std::cout << (failures ? "SESSION TESTS FAILED\n" : "session tests passed\n");
    return failures ? 1 : 0;
}
