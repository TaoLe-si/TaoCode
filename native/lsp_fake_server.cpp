// A tiny, deterministic Language Server used only by lsp_host_test to exercise the
// real subprocess + stdio framing + request/notification round-trip. It is never
// shipped with the IDE. Protocol it speaks: initialize/initialized, didOpen pushes
// one diagnostic, hover/definition answer with fixed content, shutdown/exit close.
// The refactor/symbol methods (rename, references, documentSymbol, workspace/symbol)
// answer with canned multi-file WorkspaceEdits, Locations, a hierarchical symbol tree
// (or the legacy flat SymbolInformation[] for a "*Flat*" document) and symbol hits, so
// lsp_semantics_test can assert the client-side shaping offline. The coding-assistance
// methods (signatureHelp, codeAction, formatting, rangeFormatting, implementation,
// typeDefinition, documentHighlight) answer with canned SignatureHelp, a
// (Command|CodeAction)[] mixing an inline edit, a dropped untitled entry and an
// unresolved command-only action (which codeAction/resolve then completes with an
// edit), TextEdit[],
// single Locations and DocumentHighlight[], so lsp_coding_test covers the same ground
// without a toolchain installed. textDocument/completion answers from the text the
// client actually synchronised (the identifier prefix at the requested position), so
// both the document-sync path and the completion shaping are observable end to end.
//
// Switches (both optional):
//   --incremental         advertise TextDocumentSyncKind.Incremental and accept
//                         range-based didChange, so the client's incremental diff is
//                         exercised instead of the full-text fallback.
//   --no-selection-range  advertise selectionRangeProvider:false, so the client's
//                         "this server declined the capability" path is exercised.
#include "lsp.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

using taocode::Json;
using taocode::lsp::MessageReader;

namespace {
void write_message(const Json& message) {
    const auto frame = taocode::lsp::encode_message(message);
    DWORD offset = 0;
    while (offset < frame.size()) {
        DWORD written = 0;
        const auto chunk = static_cast<DWORD>((frame.size() - offset > 1u << 20 ? 1u << 20 : frame.size() - offset));
        if (!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), frame.data() + offset, chunk, &written, nullptr) || !written) return;
        offset += written;
    }
    FlushFileBuffers(GetStdHandle(STD_OUTPUT_HANDLE));
}

// A sibling uri in the same directory as `uri`, so the caller can exercise the
// client's uri -> workspace-relative path mapping on a second file.
std::string sibling_of(const std::string& uri, const std::string& name) {
    const auto slash = uri.find_last_of('/');
    return slash == std::string::npos ? "file:///" + name : uri.substr(0, slash + 1) + name;
}

Json range(int start_line, int start_char, int end_line, int end_char) {
    return {{"start", {{"line", start_line}, {"character", start_char}}},
            {"end", {{"line", end_line}, {"character", end_char}}}};
}

Json location(const std::string& uri, int start_line, int start_char, int end_line, int end_char) {
    return {{"uri", uri}, {"range", range(start_line, start_char, end_line, end_char)}};
}

// One UTF-8 code point's byte length from its lead byte.
std::size_t step_of(unsigned char lead) {
    if (lead >= 0xF0) return 4;
    if (lead >= 0xE0) return 3;
    if (lead >= 0xC0) return 2;
    return 1;
}

// LSP (line, character) -> byte offset, with `character` in UTF-16 code units like
// the protocol says. Clamped to the text, so a stale range cannot crash the server.
std::size_t offset_of(const std::string& text, int line, int character) {
    std::size_t position = 0;
    for (int current = 0; current != line; ++current) {
        const auto newline = text.find('\n', position);
        if (newline == std::string::npos) return text.size();
        position = newline + 1;
    }
    std::size_t index = position, units = 0;
    const auto wanted = character > 0 ? static_cast<std::size_t>(character) : std::size_t(0);
    while (index != text.size() && text[index] != '\n' && units < wanted) {
        const auto step = step_of(static_cast<unsigned char>(text[index]));
        units += step == 4 ? 2 : 1;
        index += step;
    }
    return index;
}

// The identifier being typed: the trailing [A-Za-z0-9_] run of the line prefix.
std::string prefix_of(const std::string& text, int line, int character) {
    std::size_t position = 0;
    for (int current = 0; current != line; ++current) {
        const auto newline = text.find('\n', position);
        if (newline == std::string::npos) return {};
        position = newline + 1;
    }
    const auto end = offset_of(text, line, character);
    auto start = end;
    while (start != position) {
        const auto previous = start - 1;
        const unsigned char byte = static_cast<unsigned char>(text[previous]);
        const bool identifier = (byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z') ||
                                (byte >= '0' && byte <= '9') || byte == '_';
        if (!identifier) break;
        start = previous;
    }
    return text.substr(start, end - start);
}

// Replaces [start,end) with `text`, the way a TextDocumentEdit is applied. Edits
// arrive back-to-front, so earlier offsets stay valid.
void splice(std::string& document, const Json& span, const std::string& replacement) {
    const auto start_point = span.contains("start") && span.at("start").is_object() ? span.at("start") : Json::object();
    const auto end_point = span.contains("end") && span.at("end").is_object() ? span.at("end") : Json::object();
    const auto number = [](const Json& point, const char* key) {
        return point.contains(key) && point.at(key).is_number_integer() ? point.at(key).get<int>() : 0;
    };
    const auto from = offset_of(document, number(start_point, "line"), number(start_point, "character"));
    auto to = offset_of(document, number(end_point, "line"), number(end_point, "character"));
    if (to < from) to = from;
    if (from > document.size()) return;
    if (to > document.size()) to = document.size();
    document.replace(from, to - from, replacement);
}
}  // namespace

int main(int argc, char** argv) {
    const std::vector<std::string> switches(argv + 1, argv + argc);
    const bool incremental = std::find(switches.begin(), switches.end(), std::string("--incremental")) != switches.end();
    const bool no_selection_range =
        std::find(switches.begin(), switches.end(), std::string("--no-selection-range")) != switches.end();
    // --hang=<method>: that method is accepted and never answered, so the client's
    // request deadline is the only thing that can end the wait.
    std::string hang;
    for (const auto& option : switches)
        if (option.rfind("--hang=", 0) == 0) hang = option.substr(7);
    MessageReader reader;
    std::vector<char> buffer(16384);
    std::string opened_uri;
    std::string document_text;
    bool saw_source_paths = false;
    for (;;) {
        DWORD available = 0;
        if (!PeekNamedPipe(GetStdHandle(STD_INPUT_HANDLE), nullptr, 0, nullptr, &available, nullptr)) break;
        if (!available) { Sleep(2); continue; }
        DWORD got = 0;
        const auto want = static_cast<DWORD>(available > buffer.size() ? buffer.size() : available);
        if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), buffer.data(), want, &got, nullptr) || !got) break;
        reader.feed({buffer.data(), got});
        while (const auto message = reader.next()) {
            const Json& inbound = *message;
            if (!inbound.contains("method") || !inbound.contains("id")) {
                if (inbound.value("method", std::string()) == "exit") return 0;
                const auto notification = inbound.value("method", std::string());
                const Json params = inbound.contains("params") && inbound.at("params").is_object()
                                        ? inbound.at("params") : Json::object();
                if (notification == "textDocument/didOpen") {
                    opened_uri = params.at("textDocument").at("uri").get<std::string>();
                    document_text = params.at("textDocument").value("text", std::string());
                    write_message(Json{{"jsonrpc", "2.0"}, {"method", "textDocument/publishDiagnostics"}, {"params",
                        {{"uri", opened_uri}, {"diagnostics", Json::array({
                            {{"range", {{"start", {{"line", 0}, {"character", 0}}}, {"end", {{"line", 0}, {"character", 5}}}}},
                             {"severity", 1}, {"message", "fake diagnostic"}}})}}}});
                } else if (notification == "textDocument/didChange") {
                    // Both wire forms: a full-text change replaces the buffer, a
                    // range change is spliced into it. Keeping the text is what lets
                    // completion below answer from what the client really sent.
                    opened_uri = params.at("textDocument").value("uri", opened_uri);
                    const auto& changes = params.contains("contentChanges") && params.at("contentChanges").is_array()
                                              ? params.at("contentChanges") : Json::array();
                    for (const auto& change : changes) {
                        if (!change.is_object()) continue;
                        if (change.contains("range") && change.at("range").is_object())
                            splice(document_text, change.at("range"), change.value("text", std::string()));
                        else if (!incremental)
                            document_text = change.value("text", std::string());
                        // In incremental mode a bare {text} change is not a valid
                        // Incremental sync, so it is dropped: a client that promised
                        // ranges but sent the whole document shows up as stale text
                        // in the completion answer instead of passing silently.
                    }
                } else if (notification == "textDocument/didClose") {
                    document_text.clear();
                }
                continue;
            }
            const auto method = inbound.at("method").get<std::string>();
            if (!hang.empty() && method == hang) continue;  // deliberately never answered
            const auto id = inbound.at("id");
            const Json params = inbound.contains("params") && inbound.at("params").is_object()
                                    ? inbound.at("params") : Json::object();
            // The document the request names, falling back to the last didOpen.
            const auto requested = [&] {
                const auto doc = params.contains("textDocument") && params.at("textDocument").is_object()
                                     ? params.at("textDocument").value("uri", std::string()) : std::string();
                return doc.empty() ? (opened_uri.empty() ? std::string("file:///fake/Sample.java") : opened_uri) : doc;
            };
            if (method == "initialize") {
                const auto initialization = params.value("initializationOptions", Json::object());
                const auto settings = initialization.is_object() ? initialization.value("settings", Json::object()) : Json::object();
                const auto java = settings.is_object() ? settings.value("java", Json::object()) : Json::object();
                const auto project = java.is_object() ? java.value("project", Json::object()) : Json::object();
                saw_source_paths = project.is_object() && project.contains("sourcePaths");
                // A real server advertises what it implements: the client is entitled
                // to refuse a request whose capability is missing, and the session
                // layer's graceful-degradation path is driven by these values.
                Json capabilities{{"hoverProvider", true}, {"definitionProvider", true},
                                  {"textDocumentSync", incremental ? 2 : 1},
                                  {"completionProvider", {{"triggerCharacters", Json::array({"."})},
                                                          {"resolveProvider", false}}},
                                  {"referencesProvider", true},
                                  {"renameProvider", {{"prepareProvider", false}}},
                                  {"documentSymbolProvider", true},
                                  {"workspaceSymbolProvider", true},
                                  {"signatureHelpProvider", {{"triggerCharacters", Json::array({"(", ","})}}},
                                  {"codeActionProvider", {{"resolveProvider", true}}},
                                  {"documentFormattingProvider", true},
                                  {"documentRangeFormattingProvider", true},
                                  {"implementationProvider", true},
                                  {"typeDefinitionProvider", true},
                                  {"documentHighlightProvider", true},
                                  {"callHierarchyProvider", true},
                                  {"typeHierarchyProvider", true},
                                  {"inlayHintProvider", true}};
                capabilities["selectionRangeProvider"] = !no_selection_range;
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", {{"capabilities", std::move(capabilities)}}}});
            } else if (method == "shutdown") {
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json(nullptr)}});
            } else if (method == "textDocument/hover") {
                const auto contents = saw_source_paths ? std::string("hover with Java settings") : std::string("hover from fake");
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", {{"contents", {{"kind", "markdown"}, {"value", contents}}}}}});
            } else if (method == "textDocument/completion") {
                // Items derived from the synchronised document: the identifier being
                // typed at the requested position filters a canned dictionary, and
                // `detail` echoes that prefix plus the position, so a test can prove
                // both the sync path and the request position arrived intact.
                const Json point = params.contains("position") && params.at("position").is_object()
                                       ? params.at("position") : Json::object();
                const auto line = point.value("line", 0);
                const auto character = point.value("character", 0);
                const auto prefix = prefix_of(document_text, line, character);
                const std::string marker = "prefix:" + prefix + "@" + std::to_string(line) + ":" +
                                           std::to_string(character);
                static const std::vector<std::pair<std::string, int>> dictionary{
                    {"counter", 5}, {"count", 6},  {"Sample", 7}, {"String", 7},
                    {"System", 7},  {"sort", 2},   {"println", 2}};
                Json items = Json::array();
                for (const auto& [label, kind] : dictionary) {
                    if (!prefix.empty() && label.rfind(prefix, 0) != 0) continue;
                    items.push_back(Json{{"label", label},
                                         {"kind", kind},
                                         {"detail", marker},
                                         {"insertText", label},
                                         {"documentation", {{"kind", "markdown"}, {"value", marker}}}});
                }
                write_message({{"jsonrpc", "2.0"}, {"id", id},
                               {"result", {{"isIncomplete", false}, {"items", std::move(items)}}}});
            } else if (method == "textDocument/definition") {
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json::array({
                    {{"uri", opened_uri.empty() ? std::string("file:///fake") : opened_uri},
                     {"range", {{"start", {{"line", 1}, {"character", 0}}}, {"end", {{"line", 1}, {"character", 1}}}}}}})}});
            } else if (method == "textDocument/rename") {
                // WorkspaceEdit whose `changes` touch TWO documents: the requested file
                // (two edits) and a sibling (one edit), all with 0-based ranges.
                const auto document = requested();
                const auto fresh = params.value("newName", std::string("unnamed"));
                const Json own = Json::array({
                    {{"range", range(0, 6, 0, 12)}, {"newText", fresh}},
                    {{"range", range(2, 4, 2, 10)}, {"newText", "run"}}});
                const Json sibling = Json::array({{{"range", range(4, 2, 4, 8)}, {"newText", fresh + "()"}}});
                const Json changes = {{document, own}, {sibling_of(document, "Helper.java"), sibling}};
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", {{"changes", changes}}}});
            } else if (method == "textDocument/references") {
                // Location[]: the first entry echoes the requested 0-based position so the
                // client's position plumbing is observable, the second lives in a sibling.
                const auto document = requested();
                const Json point = params.contains("position") && params.at("position").is_object()
                                       ? params.at("position") : Json::object();
                const auto line = point.value("line", 0);
                const auto character = point.value("character", 0);
                const Json refs = Json::array({
                    location(document, line, character, line, character + 6),
                    location(sibling_of(document, "Helper.java"), 7, 3, 7, 9)});
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", refs}});
            } else if (method == "textDocument/documentSymbol") {
                const auto document = requested();
                if (document.find("Fail") != std::string::npos) {
                    write_message({{"jsonrpc", "2.0"}, {"id", id},
                                   {"error", {{"code", -32001}, {"message", "fake server refuses this document"}}}});
                } else {
                    Json symbols = Json::array();  // a "*Empty*" document answers with no symbols at all
                    if (document.find("Flat") != std::string::npos) {
                        // Legacy flat form: SymbolInformation[] carrying `location` instead of
                        // range/selectionRange, so both wire shapes get tested.
                        symbols = Json::array({
                            {{"name", "FlatClass"}, {"kind", 5}, {"containerName", "demo"},
                             {"location", location(document, 0, 6, 0, 15)}},
                            {{"name", "flatMethod"}, {"kind", 6},
                             {"location", location(sibling_of(document, "Helper.java"), 3, 2, 3, 12)}}});
                    } else if (document.find("Empty") == std::string::npos) {
                        // Hierarchical DocumentSymbol[], three levels deep, so depth-first
                        // flattening order is unambiguous: Sample, counter, run, total, Helper.
                        symbols = Json::array({
                            {{"name", "Sample"}, {"kind", 5}, {"detail", "class Sample"},
                             {"range", range(0, 0, 9, 1)}, {"selectionRange", range(0, 6, 0, 12)},
                             {"children", Json::array({
                                 {{"name", "counter"}, {"kind", 5}, {"detail", "int"},
                                  {"range", range(1, 4, 1, 24)}, {"selectionRange", range(1, 16, 1, 23)}},
                                 {{"name", "run"}, {"kind", 6}, {"detail", "void run()"},
                                  {"range", range(3, 4, 8, 5)}, {"selectionRange", range(3, 10, 3, 13)},
                                  {"children", Json::array({
                                      {{"name", "total"}, {"kind", 13},
                                       {"range", range(4, 8, 4, 20)}, {"selectionRange", range(4, 13, 4, 18)}}})}},
                             })}},
                            {{"name", "Helper"}, {"kind", 5}, {"detail", "class Helper"},
                             {"range", range(11, 0, 14, 1)}, {"selectionRange", range(11, 6, 11, 12)}}});
                    }
                    write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", symbols}});
                }
            } else if (method == "workspace/symbol") {
                // SymbolInformation[] whose first name echoes `query` (proving the param
                // was sent) and whose locations point at two different files.
                const auto document = requested();
                const auto query = params.value("query", std::string("symbol"));
                const Json symbols = Json::array({
                    {{"name", query}, {"kind", 5}, {"location", location(document, 0, 6, 0, 12)}},
                    {{"name", "helperMethod"}, {"kind", 6},
                     {"location", location(sibling_of(document, "Helper.java"), 12, 4, 12, 16)}}});
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", symbols}});
            } else if (method == "textDocument/signatureHelp") {
                // Two signatures of two parameters each. The first spells its
                // parameter labels out, the second uses the [start,end] tuple form
                // that indexes into the signature label, and the documentation
                // echoes the requested column so the client's position plumbing is
                // observable. activeSignature/activeParameter are non-zero so a
                // client that assumed "first" would be caught.
                const Json point = params.contains("position") && params.at("position").is_object()
                                       ? params.at("position") : Json::object();
                const auto character = point.value("character", 0);
                const Json signatures = Json::array({
                    {{"label", "run(int total, String name)"},
                     {"documentation", {{"kind", "markdown"}, {"value", "runs at column " + std::to_string(character)}}},
                     {"parameters", Json::array({{{"label", "int total"}}, {{"label", "String name"}}})}},
                    {{"label", "Sample(int total, int count)"},
                     {"parameters", Json::array({{{"label", Json::array({7, 16})}}, {{"label", Json::array({18, 27})}}})}}});
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result",
                    {{"signatures", signatures}, {"activeSignature", 1}, {"activeParameter", 1}}}});
            } else if (method == "textDocument/codeAction") {
                // (Command|CodeAction)[] for the requested range: the first entry is a
                // quickfix WITH an inline WorkspaceEdit of two TextEdits, the second is
                // an unresolved source action with NO edit (the client must still list
                // it, with edits:[]). The first newText echoes the range start line and
                // the diagnostic count so both request params are observable.
                const auto document = requested();
                const auto span = params.contains("range") && params.at("range").is_object() ? params.at("range")
                                                                                             : Json::object();
                const auto first = span.contains("start") && span.at("start").is_object() ? span.at("start") : Json::object();
                const auto range_line = first.value("line", -1);
                int diagnostics = -1;
                if (params.contains("context") && params.at("context").is_object() &&
                    params.at("context").contains("diagnostics") && params.at("context").at("diagnostics").is_array())
                    diagnostics = static_cast<int>(params.at("context").at("diagnostics").size());
                const Json own = Json::array({
                    {{"range", range(1, 0, 1, 4)}, {"newText", "L" + std::to_string(range_line) + "D" + std::to_string(diagnostics)}},
                    {{"range", range(5, 2, 5, 6)}, {"newText", "fix"}}});
                const Json changes = {{document, own}};
                const Json actions = Json::array({
                    {{"title", "Fix it"}, {"kind", "quickfix"}, {"isPreferred", true}, {"diagnostics", Json::array({Json::object()})}, {"edit", {{"changes", changes}}}},
                    // Untitled, so the client must drop it — the `index` it hands out
                    // therefore does NOT match the server array position, which is what
                    // codeAction/resolve below has to survive.
                    {{"kind", "refactor"}, {"command", {{"title", "invisible"}, {"command", "skip.me"}}}},
                    {{"title", "Organize imports"}, {"kind", "source.organizeImports"},
                     {"command", {{"title", "Organize imports"}, {"command", "java.action.organizeImports"}}}}});
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", actions}});
            } else if (method == "codeAction/resolve") {
                // Params are the whole CodeAction the client stored; reply with the same
                // object plus the edit it promised. The newText echoes the command so the
                // test proves the action round-tripped untouched.
                Json action = params.is_object() ? params : Json::object();
                const auto command = action.contains("command") && action.at("command").is_object()
                                         ? action.at("command").value("command", std::string()) : std::string();
                const Json imports = Json::array({
                    {{"range", range(0, 0, 0, 0)}, {"newText", "import java.util.List; // " + command}}});
                action["edit"] = {{"changes", {{requested(), imports}}}};
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", action}});
            } else if (method == "textDocument/prepareCallHierarchy") {
                // One CallHierarchyItem whose name echoes the requested 0-based line, so
                // the test can see the position arrived. `uri` is the opened document.
                const auto document = requested();
                const auto point = params.contains("position") && params.at("position").is_object()
                                       ? params.at("position") : Json::object();
                const auto line = point.value("line", -1);
                const Json item = {{"name", "run#" + std::to_string(line)}, {"kind", 6}, {"uri", document},
                                   {"detail", "Sample"}, {"range", range(line, 0, line, 9)},
                                   {"selectionRange", range(line, 4, line, 7)}};
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json::array({item})}});
            } else if (method == "callHierarchy/incomingCalls" || method == "callHierarchy/outgoingCalls") {
                // Params are the item the client stored; the callee/caller names echo its
                // `name`, which proves the prepared item round-tripped untouched.
                const auto item = params.contains("item") && params.at("item").is_object()
                                      ? params.at("item") : Json::object();
                const auto name = item.value("name", std::string("unnamed"));
                const auto uri = item.value("uri", opened_uri.empty() ? std::string("file:///fake/Sample.java") : opened_uri);
                if (method == "callHierarchy/incomingCalls") {
                    const Json calls = Json::array({
                        {{"from", {{"name", "callerA"}, {"kind", 6}, {"uri", uri},
                                   {"range", range(10, 0, 10, 9)}, {"selectionRange", range(10, 4, 10, 8)}}},
                         {"fromRanges", Json::array({range(3, 2, 3, 9)})}},
                        {{"from", {{"name", "callerB"}, {"kind", 6}, {"uri", sibling_of(uri, "Helper.java")},
                                   {"range", range(1, 0, 1, 6)}, {"selectionRange", range(1, 0, 1, 6)}}},
                         {"fromRanges", Json::array({range(7, 1, 7, 5)})}}});
                    write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", calls}});
                } else {
                    const Json calls = Json::array({
                        {{"to", {{"name", "callee of " + name}, {"kind", 6}, {"uri", uri},
                                 {"range", range(20, 0, 20, 9)}, {"selectionRange", range(20, 3, 20, 8)}}},
                         {"fromRanges", Json::array({range(4, 3, 4, 10)})}}});
                    write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", calls}});
                }
            } else if (method == "textDocument/prepareTypeHierarchy") {
                // Same item shape as the call hierarchy, named after the requested line.
                const auto document = requested();
                const auto point = params.contains("position") && params.at("position").is_object()
                                       ? params.at("position") : Json::object();
                const auto line = point.value("line", -1);
                const Json item = {{"name", "Sample#" + std::to_string(line)}, {"kind", 5}, {"uri", document},
                                   {"range", range(line, 0, line, 9)}, {"selectionRange", range(line, 6, line, 12)}};
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json::array({item})}});
            } else if (method == "typeHierarchy/supertypes" || method == "typeHierarchy/subtypes") {
                // A plain TypeHierarchyItem[]; the names echo the received item, so the
                // test proves the client sent the prepared item back untouched.
                const auto item = params.contains("item") && params.at("item").is_object()
                                      ? params.at("item") : Json::object();
                const auto name = item.value("name", std::string("unnamed"));
                const auto uri = item.value("uri", opened_uri.empty() ? std::string("file:///fake/Sample.java") : opened_uri);
                const auto other = sibling_of(uri, "Helper.java");
                const Json types = method == "typeHierarchy/supertypes"
                    ? Json::array({{{"name", "base of " + name}, {"kind", 5}, {"uri", other},
                                    {"range", range(0, 0, 9, 1)}, {"selectionRange", range(0, 6, 0, 12)}}})
                    : Json::array({{{"name", "implA of " + name}, {"kind", 5}, {"uri", uri},
                                    {"range", range(11, 0, 14, 1)}, {"selectionRange", range(11, 6, 11, 11)}},
                                   {{"name", "implB"}, {"kind", 5}}});   // no uri/selectionRange at all
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", types}});
            } else if (method == "textDocument/formatting" || method == "textDocument/rangeFormatting") {
                // TextEdit[] for the one opened document. The first edit inserts the
                // server's view of FormattingOptions.tabSize spaces (proving `options`
                // arrived), the second names the range start line, which is -1 for a
                // whole-document formatting request because no range is sent.
                const auto options = params.contains("options") && params.at("options").is_object() ? params.at("options")
                                                                                                    : Json::object();
                const auto tab_size = options.value("tabSize", -1);
                const auto spaces = options.contains("insertSpaces") && options.at("insertSpaces").is_boolean()
                                        ? options.at("insertSpaces").get<bool>() : false;
                const auto span = params.contains("range") && params.at("range").is_object() ? params.at("range") : Json::object();
                const auto first = span.contains("start") && span.at("start").is_object() ? span.at("start") : Json::object();
                const std::size_t indent = spaces && tab_size > 0 && tab_size < 32 ? static_cast<std::size_t>(tab_size) : 0;
                const Json edits = Json::array({
                    {{"range", range(0, 0, 0, 0)}, {"newText", std::string(indent, ' ')}},
                    {{"range", range(1, 0, 1, 0)}, {"newText", "// r" + std::to_string(first.value("line", -1))}}});
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", edits}});
            } else if (method == "textDocument/implementation" || method == "textDocument/typeDefinition") {
                // One Location each: implementations stay in the requested file, the
                // declared type lives in the sibling, so both mapping paths are covered.
                const auto document = requested();
                const auto inside = method == "textDocument/implementation";
                const Json found = Json::array({location(inside ? document : sibling_of(document, "Helper.java"),
                                                         inside ? 3 : 9, inside ? 4 : 7, inside ? 3 : 9, inside ? 12 : 14)});
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", found}});
            } else if (method == "textDocument/documentHighlight") {
                // DocumentHighlight[]: one read, one write, both derived from the
                // requested position so the ranges are anchored on the caret line.
                const Json point = params.contains("position") && params.at("position").is_object()
                                       ? params.at("position") : Json::object();
                const auto line = point.value("line", 0);
                const Json spans = Json::array({
                    {{"range", range(line, 2, line, 8)}, {"kind", 2}},
                    {{"range", range(line + 1, 4, line + 1, 10)}, {"kind", 3}}});
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", spans}});
            } else if (method == "textDocument/selectionRange") {
                // A SelectionRange chain (innermost -> outermost via parent).
                const Json point = params.contains("positions") && params.at("positions").is_array() && !params.at("positions").empty()
                                       && params.at("positions")[0].is_object() ? params.at("positions")[0] : Json::object();
                const auto line = point.value("line", 0);
                const Json outermost = {{"range", range(line - 1 >= 0 ? line - 1 : 0, 0, line + 1, 0)}};
                const Json middle = {{"range", range(line, 0, line, 20)}, {"parent", outermost}};
                const Json inner = {{"range", range(line, 2, line, 8)}, {"parent", middle}};
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json::array({inner})}});
            } else if (method == "textDocument/inlayHint") {
                // Two hints: one plain string label, one label-parts array with padding.
                const Json hints = Json::array({
                    {{"position", {{"line", 0}, {"character", 4}}}, {"label", ": int"}, {"kind", 1}},
                    {{"position", {{"line", 1}, {"character", 6}}},
                     {"label", Json::array({{{"value", "x"}, {"location", Json::object()}}})},
                     {"paddingLeft", true}, {"paddingRight", true}}});
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", hints}});
            } else {
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"error", {{"code", -32601}, {"message", "Method not found"}}}});
            }
        }
    }
    return 0;
}
