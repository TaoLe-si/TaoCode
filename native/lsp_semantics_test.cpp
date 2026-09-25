// Offline self-test for the refactor + symbol semantics added to Session: every new
// kind is driven against the fake language server (real subprocess + stdio framing) so
// the shaping contract is deterministic and needs no installed toolchain. It also
// re-drives hover/definition to prove the new capability did not regress the original
// request path.
//
// The fake server echoes the last didOpen'd uri for a couple of canned answers, so the
// runs below are ordered: single-document assertions come before extra documents open.
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
#include <utility>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::lsp::Session;

constexpr const char* kDoc = "src/示例 Sample.java";      // percent-encoded both ways
constexpr const char* kSibling = "src/Helper.java";       // fake server's second file
constexpr const char* kFlat = "src/Flat.java";            // triggers the legacy flat reply
constexpr const char* kFail = "src/Fail.java";            // triggers a JSON-RPC error
constexpr const char* kEmpty = "src/Empty.java";          // triggers an empty symbol array

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

fs::path self_directory() {
    std::wstring path(32768, L'\0');
    const auto length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    path.resize(length);
    return fs::path(path).parent_path();
}

const Json& group_for(const Json& edits, const std::string& path) {
    for (const auto& group : edits)
        if (group.value("path", std::string()) == path) return group;
    throw std::runtime_error("no edit group for " + path);
}

const Json& symbol_for(const Json& symbols, const std::string& name) {
    for (const auto& symbol : symbols)
        if (symbol.value("name", std::string()) == name) return symbol;
    throw std::runtime_error("no symbol named " + name);
}
}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    std::mutex mutex;
    std::condition_variable cv;
    bool diagnostics_arrived = false;
    Session session([&](std::string, Json) {
        std::lock_guard lock(mutex);
        diagnostics_arrived = true;
        cv.notify_all();
    });
    session.set_root(fs::path(L"C:\\Users\\dev\\My Project"));
    Session::ServerConfig config;
    config.command = (self_directory() / L"lsp_fake_server.exe").native();
    std::map<std::string, Session::ServerConfig> servers;
    servers["java"] = config;
    session.configure(std::move(servers));

    const auto wait_for = [&](bool& flag) {
        std::unique_lock lock(mutex);
        return cv.wait_for(lock, std::chrono::seconds(15), [&] { return flag; });
    };

    // Waits for one async callback and hands back {result, error}.
    const auto round_trip = [&](auto&& invoke) {
        bool done = false;
        Json result, error;
        invoke([&](Json payload, Json failure) {
            std::lock_guard lock(mutex);
            result = std::move(payload);
            error = std::move(failure);
            done = true;
            cv.notify_all();
        });
        check(wait_for(done), "callback never fired");
        return std::make_pair(result, error);
    };

    run("session opens the document the semantic queries run against", [&] {
        check(session.open(kDoc, "class Sample {\n    int counter;\n}\n").at("running") == true, "java server starts");
        check(wait_for(diagnostics_arrived), "no diagnostics after deferred didOpen");
    });

    run("hover and definition still work through the original request path", [&] {
        const auto hover = round_trip([&](Session::ResultHandler handler) {
            session.request("hover", kDoc, 0, 6, std::move(handler));
        });
        check(hover.second.is_null() && hover.first.at("available") == true &&
                  hover.first.at("contents") == "hover from fake", "hover unchanged");
        const auto definition = round_trip([&](Session::ResultHandler handler) {
            session.request("definition", kDoc, 1, 0, std::move(handler));
        });
        check(definition.second.is_null() && definition.first.at("available") == true &&
                  definition.first.at("locations")[0].at("path") == kDoc, "definition unchanged");
    });

    run("rename flattens a multi-file WorkspaceEdit", [&] {
        const auto [result, error] = round_trip([&](Session::ResultHandler handler) {
            session.semantic("rename", kDoc, 0, 6, Json{{"newName", "renamedName"}}, std::move(handler));
        });
        check(error.is_null(), "rename reported an error");
        check(result.at("available") == true, "rename is available");
        const auto& edits = result.at("edits");
        check(edits.is_array() && edits.size() == 2, "two file groups, got " + std::to_string(edits.size()));

        const auto& own = group_for(edits, kDoc);
        check(own.at("path") == kDoc, "the opened file keeps its workspace-relative '/' path");
        const auto& own_edits = own.at("textEdits");
        check(own_edits.size() == 2, "two text edits in the opened file");
        check(own_edits[0].at("text") == "renamedName", "newName reached the server and came back");
        check(own_edits[0].at("startLine") == 0 && own_edits[0].at("startChar") == 6 &&
                  own_edits[0].at("endLine") == 0 && own_edits[0].at("endChar") == 12,
              "first text edit range (0-based)");
        check(own_edits[1].at("text") == "run" && own_edits[1].at("startLine") == 2 &&
                  own_edits[1].at("endChar") == 10, "second text edit");

        const auto& other = group_for(edits, kSibling);
        check(other.at("path") == kSibling, "the sibling uri mapped to a workspace-relative path");
        const auto& other_edits = other.at("textEdits");
        check(other_edits.size() == 1 && other_edits[0].at("text") == "renamedName()" &&
                  other_edits[0].at("startLine") == 4 && other_edits[0].at("startChar") == 2 &&
                  other_edits[0].at("endLine") == 4 && other_edits[0].at("endChar") == 8,
              "sibling text edit rewritten from the newName");
    });

    run("references returns 0-based locations in every file", [&] {
        const auto [result, error] = round_trip([&](Session::ResultHandler handler) {
            session.semantic("references", kDoc, 6, 3, Json::object(), std::move(handler));
        });
        check(error.is_null(), "references reported an error");
        check(result.at("available") == true, "references are available");
        const auto& refs = result.at("refs");
        check(refs.is_array() && refs.size() == 2, "two references, got " + std::to_string(refs.size()));
        check(refs[0].at("path") == kDoc && refs[0].at("line") == 6 && refs[0].at("character") == 3,
              "the requested position round-trips unchanged (0-based)");
        check(refs[1].at("path") == kSibling && refs[1].at("line") == 7 && refs[1].at("character") == 3,
              "the cross-file reference is relative to the workspace root");
    });

    run("documentSymbol flattens the tree depth-first", [&] {
        const auto [result, error] = round_trip([&](Session::ResultHandler handler) {
            session.semantic("documentSymbol", kDoc, 0, 0, Json::object(), std::move(handler));
        });
        check(error.is_null(), "documentSymbol reported an error");
        check(result.at("available") == true, "symbols are available");
        const auto& symbols = result.at("symbols");
        check(symbols.is_array() && symbols.size() == 5, "five flattened symbols, got " + std::to_string(symbols.size()));
        const std::string order = [&] {
            std::string names;
            for (const auto& symbol : symbols) names += symbol.value("name", std::string()) + " ";
            return names;
        }();
        check(order == "Sample counter run total Helper ", "depth-first order, got: " + order);

        const auto& sample = symbols[0];
        check(sample.at("kind") == 5 && sample.at("detail") == "class Sample", "kind + detail carried over");
        check(sample.at("startLine") == 0 && sample.at("startChar") == 6, "start comes from selectionRange");
        check(sample.at("endLine") == 9 && sample.at("endChar") == 1, "end comes from range");
        const auto& total = symbol_for(symbols, "total");
        check(total.at("startLine") == 4 && total.at("startChar") == 13 && total.at("endLine") == 4 &&
                  total.at("endChar") == 20, "the third-level child is present");
        check(total.value("detail", std::string("?")) == "", "a missing detail becomes an empty string");
        check(symbol_for(symbols, "Helper").at("startLine") == 11, "the second root symbol follows the subtree");
    });

    run("workspaceSymbol needs no document and maps location uris", [&] {
        const auto [result, error] = round_trip([&](Session::ResultHandler handler) {
            session.semantic("workspaceSymbol", "", 0, 0, Json{{"query", "Sample"}}, std::move(handler));
        });
        check(error.is_null(), "workspaceSymbol reported an error");
        check(result.at("available") == true, "workspace symbols are available");
        const auto& symbols = result.at("symbols");
        check(symbols.is_array() && symbols.size() == 2, "two workspace symbols");
        check(symbols[0].at("name") == "Sample", "the query reached the server");
        check(symbols[0].at("kind") == 5 && symbols[0].at("path") == kDoc && symbols[0].at("line") == 0 &&
                  symbols[0].at("character") == 6, "first hit resolved to a relative path");
        check(symbols[1].at("name") == "helperMethod" && symbols[1].at("path") == kSibling &&
                  symbols[1].at("line") == 12 && symbols[1].at("character") == 4, "second hit resolved");
    });

    run("documentSymbol also accepts the legacy flat SymbolInformation[]", [&] {
        check(session.open(kFlat, "class FlatClass {}\n").at("running") == true, "second document opens");
        const auto [result, error] = round_trip([&](Session::ResultHandler handler) {
            session.semantic("documentSymbol", kFlat, 0, 0, Json::object(), std::move(handler));
        });
        check(error.is_null(), "flat documentSymbol reported an error");
        const auto& symbols = result.at("symbols");
        check(result.at("available") == true && symbols.size() == 2, "two flat symbols");
        check(symbols[0].at("name") == "FlatClass" && symbols[0].at("kind") == 5, "name + kind mapped");
        check(symbols[0].at("startLine") == 0 && symbols[0].at("startChar") == 6 &&
                  symbols[0].at("endLine") == 0 && symbols[0].at("endChar") == 15,
              "start/end come from location.range");
        check(symbols[1].at("name") == "flatMethod" && symbols[1].at("startLine") == 3 &&
                  symbols[1].at("endChar") == 12, "second flat symbol");
    });

    run("a server error is delivered through the same callback", [&] {
        check(session.open(kFail, "class Fail {}\n").at("running") == true, "error document opens");
        const auto [result, error] = round_trip([&](Session::ResultHandler handler) {
            session.semantic("documentSymbol", kFail, 0, 0, Json::object(), std::move(handler));
        });
        check(!error.is_null(), "the JSON-RPC error reaches the caller");
        check(result.is_null(), "no shaped result accompanies an error");
        check(error.value("message", std::string()) == "fake server refuses this document",
              "the server message survives");
    });

    run("an empty symbol reply becomes available:false", [&] {
        check(session.open(kEmpty, "class Empty {}\n").at("running") == true, "empty document opens");
        const auto [result, error] = round_trip([&](Session::ResultHandler handler) {
            session.semantic("documentSymbol", kEmpty, 0, 0, Json::object(), std::move(handler));
        });
        check(error.is_null(), "an empty reply is not an error");
        check(result.at("available") == false, "no symbols is reported as unavailable");
    });

    run("semantic rejects a closed document and an unknown kind", [&] {
        Json closed_error;
        session.semantic("rename", "never/opened.java", 0, 0, Json{{"newName", "x"}},
                         [&](Json, Json error) { closed_error = std::move(error); });
        check(!closed_error.is_null() && closed_error.value("code", std::string()) == "LSP_CLOSED",
              "a document that was never opened is rejected");

        Json kind_error;
        session.semantic("retype", kDoc, 0, 0, Json::object(), [&](Json, Json error) { kind_error = std::move(error); });
        check(!kind_error.is_null() && kind_error.value("code", std::string()) == "LSP_BAD_KIND", "unknown kind rejected");
    });

    session.shutdown_all();
    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
