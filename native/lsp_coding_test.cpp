// Offline self-test for the coding-assistance kinds added to Session: signatureHelp,
// codeAction, codeActionResolve, formatting, rangeFormatting, implementation,
// typeDefinition and documentHighlight are driven against the fake language server
// (real subprocess +
// stdio framing), so the shaping contract is deterministic and needs no installed
// toolchain. rename / references / documentSymbol and the original hover / definition
// path are re-driven here as well to prove the additive change did not regress them.
//
// Positions are LSP-native (0-based) and every path in a shaped result must come back
// workspace-relative with '/' separators, including the CJK + space document below.
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

constexpr const char* kDoc = "src/示例 Sample.java";   // percent-encoded both ways
constexpr const char* kSibling = "src/Helper.java";    // fake server's second file

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

const Json& action_for(const Json& actions, const std::string& title) {
    for (const auto& action : actions)
        if (action.value("title", std::string()) == title) return action;
    throw std::runtime_error("no action titled " + title);
}

// An LSP range in wire form, 0-based like every coordinate in this test.
Json span(int start_line, int start_char, int end_line, int end_char) {
    return Json{{"start", {{"line", start_line}, {"character", start_char}}},
                {"end", {{"line", end_line}, {"character", end_char}}}};
}

std::string describe(const Json& value) {
    return value.is_null() ? "null" : value.dump();
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

    // Waits for one async semantic() callback and hands back the shaped result,
    // throwing if the server reported an error for that kind.
    const auto ask = [&](const std::string& kind, int line, int character, const Json& args) {
        bool done = false;
        Json result, error;
        session.semantic(kind, kDoc, line, character, args, [&](Json payload, Json failure) {
            std::lock_guard lock(mutex);
            result = std::move(payload);
            error = std::move(failure);
            done = true;
            cv.notify_all();
        });
        check(wait_for(done), kind + ": callback never fired");
        if (!error.is_null()) throw std::runtime_error(kind + ": " + describe(error));
        return result;
    };

    run("session opens the document the coding-assistance queries run against", [&] {
        check(session.open(kDoc, "class Sample {\n    int counter;\n}\n").at("running") == true, "java server starts");
        check(wait_for(diagnostics_arrived), "no diagnostics after deferred didOpen");
    });

    run("hover, definition and completion still work through the original request path", [&] {
        bool done = false;
        Json payload, failure;
        const auto reply = [&](Json result, Json error) {
            std::lock_guard lock(mutex);
            payload = std::move(result);
            failure = std::move(error);
            done = true;
            cv.notify_all();
        };
        session.request("hover", kDoc, 0, 6, reply);
        check(wait_for(done), "hover never replied");
        check(failure.is_null() && payload.at("available") == true && payload.at("contents") == "hover from fake",
              "hover unchanged");
        done = false;
        session.request("definition", kDoc, 1, 0, reply);
        check(wait_for(done), "definition never replied");
        check(failure.is_null() && payload.at("available") == true && payload.at("locations")[0].at("path") == kDoc,
              "definition unchanged");
        done = false;
        session.request("completion", kDoc, 2, 4, reply);
        check(wait_for(done), "completion never replied");
        check(failure.is_null(), "completion failed: " + describe(failure));
        check(payload.at("available") == true, "completion is available");
        // Line 2 is "}" so there is no identifier being typed: the whole canned
        // dictionary comes back.
        check(payload.at("items").size() == 7, "all seven items, got " + std::to_string(payload.at("items").size()));
    });

    run("completion is filtered by the identifier at the requested position", [&] {
        bool done = false;
        Json payload, failure;
        session.request("completion", kDoc, 1, 11, [&](Json result, Json error) {
            std::lock_guard lock(mutex);
            payload = std::move(result);
            failure = std::move(error);
            done = true;
            cv.notify_all();
        });
        check(wait_for(done), "completion never replied");
        check(failure.is_null(), "completion failed: " + describe(failure));
        const auto& items = payload.at("items");
        // Line 1 is "    int counter;", so character 11 sits inside "cou".
        check(items.size() == 2, "prefix 'cou' keeps two items, got " + std::to_string(items.size()));
        check(items[0].at("label") == "counter" && items[1].at("label") == "count",
              "the surviving labels, got " + describe(items));
        check(items[0].at("kind") == "field" && items[1].at("kind") == "variable",
              "numeric completion kinds become the contract's names");
        check(items[0].at("apply") == "counter", "insertText becomes apply");
        check(items[0].at("detail") == "prefix:cou@1:11",
              "the position and the prefix reached the server: " + describe(items[0].at("detail")));
    });

    run("signatureHelp shapes signatures, parameters and the active indices", [&] {
        const auto result = ask("signatureHelp", 3, 17, Json{{"triggerKind", 2}});
        check(result.at("available") == true, "signature help is available");
        const auto& signatures = result.at("signatures");
        check(signatures.is_array() && signatures.size() >= 2, "at least two signatures, got " + std::to_string(signatures.size()));
        check(result.at("activeSignature") == 1 && result.at("activeParameter") == 1,
              "active indices carried through instead of defaulting to zero");

        const auto& first = signatures[0];
        check(first.at("label") == "run(int total, String name)", "signature label");
        check(first.at("documentation") == "runs at column 17",
              "the requested character reached the server and came back, got: " + describe(first.at("documentation")));
        const auto& named = first.at("parameters");
        check(named.size() == 2 && named[0].at("label") == "int total" && named[1].at("label") == "String name",
              "string parameter labels");

        const auto& second = signatures[1];
        check(!second.contains("documentation"), "a missing documentation key is not invented");
        const auto& sliced = second.at("parameters");
        check(sliced.size() == 2 && sliced[0].at("label") == "int total" && sliced[1].at("label") == "int count",
              "[start,end] label tuples resolved against the signature label");
    });

    run("codeAction flattens an inline WorkspaceEdit and still lists an unresolved one", [&] {
        const Json args{{"range", span(3, 1, 6, 9)},
                        {"diagnostics", Json::array({
                            Json{{"range", span(3, 1, 3, 9)}, {"severity", 1}, {"message", "first"}},
                            Json{{"range", span(4, 0, 4, 7)}, {"severity", 2}, {"message", "second"}}})}};
        const auto result = ask("codeAction", 3, 1, args);
        check(result.at("available") == true, "actions are available");
        const auto& actions = result.at("actions");
        check(actions.is_array() && actions.size() == 2, "two actions, got " + std::to_string(actions.size()));

        const auto& quickfix = action_for(actions, "Fix it");
        check(quickfix.at("index") == 0, "index 0 = first LISTED action");
        check(quickfix.at("resolvable") == false, "an inline edit needs no resolve");
        check(quickfix.at("kind") == "quickfix", "kind carried through");
        check(quickfix.at("preferred") == true, "isPreferred surfaced for IDEA's quick-fix filter");
        check(quickfix.at("linkedDiagnostics") == true, "a diagnostics backlink is flagged");
        check(!action_for(actions, "Organize imports").contains("preferred") &&
                  !action_for(actions, "Organize imports").contains("linkedDiagnostics"),
              "an action without either marker gets neither flag");
        const auto& edits = quickfix.at("edits");
        check(edits.is_array() && edits.size() == 1, "one file group in the inline edit");
        const auto& own = group_for(edits, kDoc);
        check(own.at("path") == kDoc, "the edit uri mapped back to the opened workspace-relative path");
        const auto& text = own.at("textEdits");
        check(text.size() == 2, "two text edits inline, got " + std::to_string(text.size()));
        check(text[0].at("text") == "L3D2", "the requested range and both diagnostics reached the server, got: " +
                                                describe(text[0].at("text")));
        check(text[0].at("startLine") == 1 && text[0].at("startChar") == 0 && text[0].at("endLine") == 1 &&
                  text[0].at("endChar") == 4, "first text edit range (0-based)");
        check(text[1].at("text") == "fix" && text[1].at("startLine") == 5 && text[1].at("startChar") == 2 &&
                  text[1].at("endChar") == 6, "second text edit");

        const auto& lazily = action_for(actions, "Organize imports");
        check(lazily.at("index") == 1 && lazily.at("kind") == "source.organizeImports",
              "the unresolved action is listed at the next index, past the dropped untitled one");
        check(lazily.at("edits").is_array() && lazily.at("edits").empty(), "no inline edit means edits:[]");
        check(lazily.at("resolvable") == true, "a command-only action is flagged resolvable");
    });

    run("codeAction without range or diagnostics degrades to the caret and an empty context", [&] {
        const auto result = ask("codeAction", 5, 2, Json::object());
        const auto& quickfix = action_for(result.at("actions"), "Fix it");
        const auto& text = group_for(quickfix.at("edits"), kDoc).at("textEdits");
        check(text[0].at("text") == "L5D0", "zero-width range at the caret, empty diagnostics: " + describe(text[0].at("text")));
    });

    run("codeActionResolve fills a command-only action through codeAction/resolve", [&] {
        const auto result = ask("codeActionResolve", 3, 1, Json{{"index", 1}});
        check(result.at("available") == true, "the resolved action carries edits");
        const auto& edits = result.at("edits");
        check(edits.is_array() && edits.size() == 1, "one file group, got " + std::to_string(edits.size()));
        const auto& text = group_for(edits, kDoc).at("textEdits");
        check(text.size() == 1 && text[0].at("startLine") == 0 && text[0].at("endChar") == 0,
              "the import edit is anchored at 0:0");
        // The echoed command proves the stored object — index 2 of the server array,
        // index 1 of the shaped list — is what came back.
        check(text[0].at("text") == "import java.util.List; // java.action.organizeImports",
              "resolve round-tripped the action, got: " + describe(text[0].at("text")));
    });

    run("codeActionResolve passes an already-inline action straight through", [&] {
        const auto result = ask("codeActionResolve", 3, 1, Json{{"index", 0}});
        const auto& text = group_for(result.at("edits"), kDoc).at("textEdits");
        check(result.at("available") == true && text.size() == 2 && text[1].at("text") == "fix",
              "index 0's stored edit is returned without another request");
    });

    run("codeActionResolve rejects an index the last reply never listed", [&] {
        bool failed = false;
        bool done = false;
        session.semantic("codeActionResolve", kDoc, 3, 1, Json{{"index", 9}}, [&](Json, Json failure) {
            std::lock_guard lock(mutex);
            failed = !failure.is_null();
            done = true;
            cv.notify_all();
        });
        check(wait_for(done), "the stale index answered synchronously");
        check(failed, "index 9 of a two-action list must be reported as an error, not silently empty");
    });

    run("prepareCallHierarchy shapes the item and keeps the raw echo", [&] {
        const auto result = ask("prepareCallHierarchy", 4, 6, Json::object());
        check(result.at("available") == true, "the position has a callable item");
        const auto& items = result.at("items");
        check(items.is_array() && items.size() == 1, "one item, got " + std::to_string(items.size()));
        const auto& item = items[0];
        check(item.at("name").get<std::string>() == "run#4", "the requested line reached the server: " + describe(item.at("name")));
        check(item.at("kind") == 6 && item.at("detail") == "Sample", "kind and detail carried through");
        check(item.at("path") == kDoc, "the item uri mapped back to the workspace-relative path");
        check(item.at("line") == 4 && item.at("character") == 4, "selectionRange start is 0-based");
        check(item.at("raw").is_object() && item.at("raw").at("uri").is_string(), "the untouched item rides along for resolve");
    });

    run("callHierarchyIncoming lists callers with their call sites", [&] {
        const Json args{{"item", ask("prepareCallHierarchy", 4, 6, Json::object()).at("items")[0]}};
        const auto result = ask("callHierarchyIncoming", 4, 6, args);
        const auto& calls = result.at("calls");
        check(calls.is_array() && calls.size() == 2, "two callers, got " + std::to_string(calls.size()));
        check(calls[0].at("name") == "callerA" && calls[0].at("path") == kDoc, "the first caller stays in this file");
        check(calls[0].at("line") == 10 && calls[0].at("character") == 4, "caller declaration position");
        check(calls[0].at("callLine") == 3 && calls[0].at("callChar") == 2, "fromRanges start marks the call site");
        check(calls[1].at("path") == kSibling, "the second caller lives in the sibling file");
        check(calls[1].at("callLine") == 7, "its own call range");
    });

    run("callHierarchyOutgoing echoes the prepared item", [&] {
        const Json args{{"item", ask("prepareCallHierarchy", 5, 6, Json::object()).at("items")[0]}};
        const auto result = ask("callHierarchyOutgoing", 5, 6, args);
        const auto& calls = result.at("calls");
        check(calls.is_array() && calls.size() == 1, "one callee, got " + std::to_string(calls.size()));
        // The server names the callee after the item it received, so this fails if the
        // shaped entry (or the wrong line) went out instead of the raw item.
        check(calls[0].at("name").get<std::string>() == "callee of run#5", "the raw item round-tripped: " + describe(calls[0].at("name")));
        check(calls[0].at("callLine") == 4 && calls[0].at("callChar") == 3, "the call site inside the caller");
    });

    run("hierarchy expands unopened sibling nodes through the originating document", [&] {
        const auto root = ask("prepareCallHierarchy", 4, 6, Json::object()).at("items")[0];
        const auto caller = ask("callHierarchyIncoming", 4, 6, Json{{"item", root}}).at("calls")[1];
        check(caller.contains("raw") && caller.at("raw").at("uri").is_string(), "child nodes must retain their server URI");
        const auto child = ask("callHierarchyOutgoing", 0, 0, Json{{"item", caller}}).at("calls")[0];
        check(child.at("name") == "callee of callerB" && child.at("path") == kSibling,
              "the sibling item, not the originating document URI, reaches the server");
        const auto type = ask("prepareTypeHierarchy", 4, 8, Json::object()).at("items")[0];
        const auto parent = ask("typeHierarchySupertypes", 0, 0, Json{{"item", type}}).at("items")[0];
        const auto grandparent = ask("typeHierarchySupertypes", 0, 0, Json{{"item", parent}}).at("items")[0];
        check(grandparent.at("name") == "base of base of Sample#4" && grandparent.at("path") == kSibling,
              "type hierarchy preserves the original server item at every depth");
    });

    run("call hierarchy kinds reject a missing item", [&] {
        bool failed = false;
        session.semantic("callHierarchyIncoming", kDoc, 4, 6, Json::object(),
                         [&](Json, Json error) { failed = !error.is_null(); });
        check(failed, "incoming calls without an item are an error, not an empty list");
    });

    run("prepareTypeHierarchy and its two directions share the item shape", [&] {
        const auto prepared = ask("prepareTypeHierarchy", 4, 8, Json::object());
        const auto& items = prepared.at("items");
        check(items.is_array() && items.size() == 1, "one type at the position");
        check(items[0].at("name").get<std::string>() == "Sample#4", "the line reached the server: " + describe(items[0].at("name")));
        check(items[0].at("kind") == 5 && items[0].at("path") == kDoc, "class kind and workspace-relative path");
        check(items[0].at("line") == 4 && items[0].at("character") == 6, "selectionRange start");

        const auto supertypes = ask("typeHierarchySupertypes", 4, 8, Json{{"item", items[0]}});
        const auto& parents = supertypes.at("items");
        check(parents.size() == 1 && parents[0].at("name").get<std::string>() == "base of Sample#4",
              "the prepared item round-tripped: " + describe(parents[0].at("name")));
        check(parents[0].at("path") == kSibling, "the supertype lives in the sibling file");

        const auto subtypes = ask("typeHierarchySubtypes", 4, 8, Json{{"item", items[0]}});
        const auto& children = subtypes.at("items");
        check(children.size() == 2, "two subtypes, got " + std::to_string(children.size()));
        check(children[0].at("path") == kDoc && children[0].at("line") == 11, "the first child keeps uri and position");
        // An item with no uri/selectionRange must not invent a path or a line.
        check(children[1].at("name") == "implB" && !children[1].contains("path") && !children[1].contains("line"),
              "missing uri and selectionRange stay absent");
    });

    run("formatting returns one file group with the opened path", [&] {
        const auto result = ask("formatting", 0, 0, Json{{"tabSize", 2}, {"insertSpaces", true}});
        check(result.at("available") == true, "formatting produced edits");
        const auto& edits = result.at("edits");
        check(edits.is_array() && edits.size() == 1, "exactly one file group, got " + std::to_string(edits.size()));
        const auto& own = group_for(edits, kDoc);
        check(own.at("path") == kDoc, "the group names the opened document, not a uri");
        const auto& text = own.at("textEdits");
        check(text.size() == 2, "two text edits, got " + std::to_string(text.size()));
        check(text[0].at("text") == "  ", "the requested tabSize arrived, got: " + describe(text[0].at("text")));
        check(text[0].at("startLine") == 0 && text[0].at("startChar") == 0 && text[0].at("endLine") == 0 &&
                  text[0].at("endChar") == 0, "zero-width insert at the line start");
        check(text[1].at("text") == "// r-1", "a whole-document request carries no range");
    });

    run("formatting defaults to four spaces when the UI sends no options", [&] {
        const auto result = ask("formatting", 0, 0, Json::object());
        check(group_for(result.at("edits"), kDoc).at("textEdits")[0].at("text") == "    ", "tabSize defaults to 4");
    });

    run("rangeFormatting sends the selection range", [&] {
        const auto result = ask("rangeFormatting", 0, 0, Json{{"range", span(2, 0, 4, 3)}, {"tabSize", 8}, {"insertSpaces", true}});
        const auto& text = group_for(result.at("edits"), kDoc).at("textEdits");
        check(text.size() == 2, "two range edits");
        check(text[0].at("text") == std::string(8, ' '), "tabSize 8 honoured, got: " + describe(text[0].at("text")));
        check(text[1].at("text") == "// r2", "the range start line reached the server");
    });

    run("implementation and typeDefinition shape refs like references", [&] {
        const auto implementations = ask("implementation", 3, 4, Json::object());
        check(implementations.at("available") == true, "implementations are available");
        const auto& refs = implementations.at("refs");
        check(refs.is_array() && refs.size() == 1, "one implementation, got " + std::to_string(refs.size()));
        check(refs[0].at("path") == kDoc && refs[0].at("line") == 3 && refs[0].at("character") == 4,
              "the in-file location mapped to the relative path");

        const auto types = ask("typeDefinition", 3, 4, Json::object());
        const auto& type_refs = types.at("refs");
        check(types.at("available") == true && type_refs.size() == 1, "one declared type");
        check(type_refs[0].at("path") == kSibling && type_refs[0].at("line") == 9 && type_refs[0].at("character") == 7,
              "the cross-file location mapped to a workspace-relative path");
    });

    run("documentHighlight returns 0-based ranges with kinds", [&] {
        const auto result = ask("documentHighlight", 4, 6, Json::object());
        check(result.at("available") == true, "highlights are available");
        const auto& highlights = result.at("highlights");
        check(highlights.is_array() && highlights.size() == 2, "two highlights, got " + std::to_string(highlights.size()));
        check(highlights[0].at("kind") == 2, "kind 2 = read");
        check(highlights[0].at("startLine") == 4 && highlights[0].at("startChar") == 2 &&
                  highlights[0].at("endLine") == 4 && highlights[0].at("endChar") == 8,
              "the read range is anchored on the requested line");
        check(highlights[1].at("kind") == 3, "kind 3 = write");
        check(highlights[1].at("startLine") == 5 && highlights[1].at("startChar") == 4 &&
                  highlights[1].at("endLine") == 5 && highlights[1].at("endChar") == 10, "the write range");
    });

    run("selectionRange flattens the parent chain innermost to outermost", [&] {
        const auto result = ask("selectionRange", 4, 6, Json::object());
        check(result.at("available") == true, "ranges are available");
        const auto& ranges = result.at("ranges");
        check(ranges.size() == 3, "three nested ranges, got " + std::to_string(ranges.size()));
        check(ranges[0].at("startLine") == 4 && ranges[0].at("startChar") == 2 &&
                  ranges[0].at("endChar") == 8, "innermost is the token range");
        // each subsequent range must enclose the previous one
        for (std::size_t i = 1; i < ranges.size(); ++i) {
            const auto& inner = ranges[i - 1];
            const auto& outer = ranges[i];
            check(std::make_pair(outer.at("startLine").get<int>(), outer.at("startChar").get<int>()) <=
                      std::make_pair(inner.at("startLine").get<int>(), inner.at("startChar").get<int>()) &&
                  std::make_pair(outer.at("endLine").get<int>(), outer.at("endChar").get<int>()) >=
                      std::make_pair(inner.at("endLine").get<int>(), inner.at("endChar").get<int>()),
                  "ranges widen outward");
        }
        check(ranges[2].at("startLine") == 3 && ranges[2].at("endLine") == 5, "outermost spans neighbour lines");
    });

    run("inlayHint shapes string and label-part hints with padding", [&] {
        const auto result = ask("inlayHint", 0, 0, Json::object());
        check(result.at("available") == true, "hints are available");
        const auto& hints = result.at("hints");
        check(hints.size() == 2, "two hints, got " + std::to_string(hints.size()));
        check(hints[0].at("label").get<std::string>() == ": int", "string label passes through");
        check(hints[0].at("line") == 0 && hints[0].at("character") == 4, "0-based hint position");
        check(hints[1].at("label").get<std::string>() == "x", "label parts are concatenated");
        check(hints[1].value("paddingLeft", false) == true, "padding flag survives");
    });

    run("rename, references and documentSymbol are unregressed", [&] {
        const auto renamed = ask("rename", 0, 6, Json{{"newName", "renamedName"}});
        check(renamed.at("available") == true && renamed.at("edits").size() == 2, "still a two-file WorkspaceEdit");
        check(group_for(renamed.at("edits"), kDoc).at("textEdits")[0].at("text") == "renamedName", "newName round-trips");
        check(group_for(renamed.at("edits"), kSibling).at("textEdits")[0].at("text") == "renamedName()", "sibling edit");

        const auto referenced = ask("references", 6, 3, Json::object());
        const auto& refs = referenced.at("refs");
        check(refs.size() == 2 && refs[0].at("path") == kDoc && refs[0].at("line") == 6 && refs[0].at("character") == 3,
              "the requested position still round-trips (0-based)");
        check(refs[1].at("path") == kSibling && refs[1].at("line") == 7, "the sibling reference");

        const auto symbols = ask("documentSymbol", 0, 0, Json::object());
        const auto& list = symbols.at("symbols");
        check(list.is_array() && list.size() == 5, "five hierarchical symbols, got " + std::to_string(list.size()));
        check(list[0].at("name") == "Sample" && list[0].at("startChar") == 6 && list[0].at("endLine") == 9,
              "selectionRange start and range end still flatten");
    });

    run("the new kinds reject a closed document and an unknown kind", [&] {
        for (const char* kind : {"signatureHelp", "codeAction", "codeActionResolve", "formatting", "rangeFormatting",
                                 "implementation", "typeDefinition", "documentHighlight", "prepareCallHierarchy",
                                 "callHierarchyIncoming", "callHierarchyOutgoing", "prepareTypeHierarchy",
                                 "typeHierarchySupertypes", "typeHierarchySubtypes", "selectionRange", "inlayHint"}) {
            Json closed_error;
            session.semantic(kind, "never/opened.java", 0, 0, Json::object(),
                             [&](Json, Json error) { closed_error = std::move(error); });
            check(!closed_error.is_null() && closed_error.value("code", std::string()) == "LSP_CLOSED",
                  std::string(kind) + " rejects a document that was never opened");
        }
        Json kind_error;
        session.semantic("retype", kDoc, 0, 0, Json::object(), [&](Json, Json error) { kind_error = std::move(error); });
        check(!kind_error.is_null() && kind_error.value("code", std::string()) == "LSP_BAD_KIND", "unknown kind rejected");
    });

    // A second session whose server advertises TextDocumentSyncKind.Incremental: it
    // only accepts range changes, so a client that kept sending whole documents
    // leaves the server with a stale buffer — visible as the wrong prefix.
    run("didChange sends a range when the server declares incremental sync", [&] {
        std::mutex local_mutex;
        std::condition_variable local_cv;
        bool local_diagnostics = false;
        Session incremental_session([&](std::string, Json) {
            std::lock_guard lock(local_mutex);
            local_diagnostics = true;
            local_cv.notify_all();
        });
        incremental_session.set_root(fs::path(L"C:\\Users\\dev\\My Project"));
        Session::ServerConfig config;
        config.command = (self_directory() / L"lsp_fake_server.exe").native();
        config.arguments.push_back(L"--incremental");
        std::map<std::string, Session::ServerConfig> servers;
        servers["java"] = config;
        incremental_session.configure(std::move(servers));
        check(incremental_session.open(kDoc, "class Sample {\n    int counter;\n}\n").at("running") == true,
              "the incremental server starts");
        {
            std::unique_lock lock(local_mutex);
            check(local_cv.wait_for(lock, std::chrono::seconds(15), [&] { return local_diagnostics; }),
                  "no diagnostics after deferred didOpen");
        }
        incremental_session.change(kDoc, "class Sample {\n    int Sample;\n}\n");
        bool done = false;
        Json payload, failure;
        incremental_session.request("completion", kDoc, 1, 11, [&](Json result, Json error) {
            std::lock_guard lock(local_mutex);
            payload = std::move(result);
            failure = std::move(error);
            done = true;
            local_cv.notify_all();
        });
        {
            std::unique_lock lock(local_mutex);
            check(local_cv.wait_for(lock, std::chrono::seconds(15), [&] { return done; }), "completion never replied");
        }
        check(failure.is_null(), "completion failed: " + describe(failure));
        const auto& items = payload.at("items");
        check(items.size() == 1 && items[0].at("label") == "Sample",
              "the server's buffer really saw the incremental change, got " + describe(items));
        check(items[0].at("detail") == "prefix:Sam@1:11",
              "the prefix comes from the synchronised text: " + describe(items[0].at("detail")));
        incremental_session.shutdown_all();
    });

    // A server that explicitly declined a provider must be reported, not answered
    // with an empty result the UI would read as "nothing to show".
    run("a capability the server declined is an error, not an empty success", [&] {
        std::mutex local_mutex;
        std::condition_variable local_cv;
        bool local_diagnostics = false;
        Session declined_session([&](std::string, Json) {
            std::lock_guard lock(local_mutex);
            local_diagnostics = true;
            local_cv.notify_all();
        });
        declined_session.set_root(fs::path(L"C:\\Users\\dev\\My Project"));
        Session::ServerConfig config;
        config.command = (self_directory() / L"lsp_fake_server.exe").native();
        config.arguments.push_back(L"--no-selection-range");
        std::map<std::string, Session::ServerConfig> servers;
        servers["java"] = config;
        declined_session.configure(std::move(servers));
        check(declined_session.open(kDoc, "class Sample {\n    int counter;\n}\n").at("running") == true,
              "the server without selection ranges starts");
        {
            std::unique_lock lock(local_mutex);
            check(local_cv.wait_for(lock, std::chrono::seconds(15), [&] { return local_diagnostics; }),
                  "no diagnostics after deferred didOpen");
        }
        const auto ask_local = [&](const std::string& kind) {
            bool done = false;
            Json payload, failure;
            declined_session.semantic(kind, kDoc, 4, 6, Json::object(), [&](Json result, Json error) {
                std::lock_guard lock(local_mutex);
                payload = std::move(result);
                failure = std::move(error);
                done = true;
                local_cv.notify_all();
            });
            std::unique_lock lock(local_mutex);
            check(local_cv.wait_for(lock, std::chrono::seconds(15), [&] { return done; }), kind + " never replied");
            return std::make_pair(payload, failure);
        };
        const auto [declined_payload, declined_failure] = ask_local("selectionRange");
        check(!declined_failure.is_null() && declined_failure.value("code", std::string()) == "LSP_UNSUPPORTED",
              "a declined selectionRangeProvider is reported: " + describe(declined_failure));
        check(declined_payload.is_null(), "and no success-shaped result is handed back");
        const auto [hints, hints_failure] = ask_local("inlayHint");
        check(hints_failure.is_null() && hints.at("available") == true,
              "a capability the same server did advertise still works: " + describe(hints_failure));
        declined_session.shutdown_all();
    });

    session.shutdown_all();
    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
