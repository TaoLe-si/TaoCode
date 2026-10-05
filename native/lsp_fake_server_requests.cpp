// 假 LSP 服务器的请求分派 —— 35 个 method 分支都在这里，单一职责。
// helper 与状态在 lsp_fake_server_support.cpp（见 lsp_fake_server.hpp 的模块说明）。
#include "lsp_fake_server.hpp"

namespace fake_server {

void handle_request(const Flags& flags, const std::string& method, const Json& params, const Json& id) {
    const bool& incremental = flags.incremental;
    const bool& multi_definition = flags.multi_definition;
    const bool& multi_implementation = flags.multi_implementation;
    const bool& no_selection_range = flags.no_selection_range;
    const bool& no_folding_range = flags.no_folding_range;
    const bool& no_resolve = flags.no_resolve;
    const bool& no_pull_diagnostics = flags.no_pull_diagnostics;
    const bool& no_execute_command = flags.no_execute_command;
    const bool& no_file_operations = flags.no_file_operations;
    const bool& no_semantic_tokens = flags.no_semantic_tokens;
    const bool& no_semantic_delta = flags.no_semantic_delta;
    const bool& no_document_link = flags.no_document_link;
    const bool& no_inline_completion = flags.no_inline_completion;
    const bool& no_code_lens = flags.no_code_lens;
    const bool& no_moniker = flags.no_moniker;
    const bool& no_workspace_diagnostics = flags.no_workspace_diagnostics;
        if (method == "initialize") {
            // 客户端能力的**形状**校验：`workspace.fileOperations.*` 在客户端能力里必须是
            // 布尔（lsp4j `FileOperationsWorkspaceCapabilities.getDidCreate() -> Boolean`），
            // 带 filters 的对象只属于服务端能力。真服务器（JDT LS 的 Gson）遇到数组会整条
            // initialize 判成 -32700 并**静默**退化成"服务器起来了但永远不 ready"，
            // 假服务器以前不校验这一点，所以同一个错误能从测试里溜过去。这里让它必红。
            const auto caps = params.value("capabilities", Json::object());
            const auto ws = caps.is_object() ? caps.value("workspace", Json::object()) : Json::object();
            const auto ops = ws.is_object() ? ws.value("fileOperations", Json::object()) : Json::object();
            if (ops.is_object()) {
                for (const char* key : {"didCreate", "didRename", "didDelete", "willCreate", "willRename", "willDelete"}) {
                    if (!ops.contains(key)) continue;
                    if (!ops.at(key).is_boolean()) {
                        std::cerr << "FAKE-SERVER-FAIL client capability workspace.fileOperations." << key
                                  << " must be a boolean (client capabilities carry booleans; the filters "
                                     "object belongs to server capabilities\n";
                        std::exit(3);
                    }
                }
            }
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
                                                      // 支持 completionItem/resolve（客户端据此才敢发这个请求）。
                                                      {"resolveProvider", !no_resolve}}},
                              {"referencesProvider", true},
                              {"renameProvider", {{"prepareProvider", true}}},
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
            capabilities["foldingRangeProvider"] = !no_folding_range;
            // pull 诊断：声明后客户端应当**主动来问**（对应 IDEA 的批处理 Inspection）。
            if (!no_pull_diagnostics) capabilities["diagnosticProvider"] = Json{{"interFileDependencies", false},
                                                                                {"workspaceDiagnostics", !no_workspace_diagnostics}};
            // workspace/executeCommand 由服务器侧声明支持哪些命令 id；声明成 false
            // 表示完全不支持（客户端必须本地拒绝）。
            capabilities["executeCommandProvider"] =
                no_execute_command ? Json(false)
                                   : Json{{"commands", Json::array({"java.action.organizeImports", "fake.echo"})}};
            // 文件操作通知能力：声明哪几种，客户端才允许发哪一种。
            if (!no_file_operations) {
                const Json registration{{"filters", Json::array()}};
                capabilities["workspace"] = Json{{"fileOperations", {{"didCreate", registration},
                                                                     {"didRename", registration},
                                                                     {"didDelete", registration},
                                                                     {"willRename", registration}}}};
            }
            // 语义高亮的 legend 用 LSP 规范里的标准表（客户端声明的也是这张表，
            // 索引必须一一对应 —— 索引错位会让"关键字"显示成"数字"）。
            capabilities["documentLinkProvider"] = no_document_link ? Json(false)
                                                                    : Json{{"resolveProvider", false}};
            capabilities["inlineCompletionProvider"] = !no_inline_completion;
            capabilities["codeLensProvider"] = no_code_lens ? Json(false) : Json{{"resolveProvider", false}};
            capabilities["monikerProvider"] = !no_moniker;
            if (no_semantic_tokens) {
                capabilities["semanticTokensProvider"] = Json(nullptr);
            } else {
                capabilities["semanticTokensProvider"] = Json{
                    {"legend", Json{{"tokenTypes", Json::array({"namespace", "type", "class", "enum", "interface",
                                                                "struct", "typeParameter", "parameter", "variable",
                                                                "property", "enumMember", "event", "function", "method",
                                                                "macro", "keyword", "modifier", "comment", "string",
                                                                "number", "regexp", "operator", "decorator"})},
                                    {"tokenModifiers", Json::array({"declaration", "definition", "readonly", "static",
                                                                    "deprecated", "abstract", "async", "modification",
                                                                    "documentation", "defaultLibrary"})}}},
                    {"requests", Json{{"full", Json{{"delta", !no_semantic_delta}}}}}};
            }
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", {{"capabilities", std::move(capabilities)}}}});
        } else if (method == "shutdown") {
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json(nullptr)}});
        } else if (method == "textDocument/foldingRange") {
            // 两条区间：一条按行（声明了 lineFoldingOnly）、一条带列号 + kind，两种形态都要能过。
            const Json ranges = Json::array({
                {{"startLine", 0}, {"endLine", 9}},
                {{"startLine", 12}, {"endLine", 14}, {"startCharacter", 4}, {"endCharacter", 1}, {"kind", "comment"}}});
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", ranges}});
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
                                     {"documentation", {{"kind", "markdown"}, {"value", marker}}},
                                     // `data` 是服务器在 resolve 时找回条目的凭据，客户端必须原样带回。
                                     {"data", {{"label", label}, {"marker", marker}}}});
            }
            write_message({{"jsonrpc", "2.0"}, {"id", id},
                           {"result", {{"isIncomplete", false}, {"items", std::move(items)}}}});
        } else if (method == "completionItem/resolve") {
            // 客户端必须把原项发回来（含 `data`）：这里用它算文档与"自动导入"式编辑。
            const auto label = params.value("label", std::string());
            const auto marker = params.contains("data") && params.at("data").is_object()
                                    ? params.at("data").value("marker", std::string()) : std::string();
            const Json edits = Json::array({{{"range", range(0, 0, 0, 0)}, {"newText", "import " + label + ";\n"}}});
            write_message({{"jsonrpc", "2.0"}, {"id", id},
                           {"result", {{"label", label},
                                       {"detail", "resolved:" + marker},
                                       {"documentation", {{"kind", "markdown"}, {"value", "docs for " + label}}},
                                       {"additionalTextEdits", edits}}}});
        } else if (method == "textDocument/diagnostic") {
            // 带 `previousResultId` 且与上次相同 → `unchanged`（省一次全量重算）；否则 `full`。
            const auto previous = params.value("previousResultId", std::string());
            if (!previous.empty() && previous == "fake-result-1") {
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", {{"kind", "unchanged"}, {"resultId", previous}}}});
            } else {
                const Json items = Json::array({
                    {{"range", range(1, 2, 1, 5)}, {"severity", 2}, {"message", "pull diagnostic"}, {"source", "fake"}}});
                write_message({{"jsonrpc", "2.0"}, {"id", id},
                               {"result", {{"kind", "full"}, {"resultId", "fake-result-1"}, {"items", items}}}});
            }
        } else if (method == "textDocument/definition") {
            const auto document = opened_uri.empty() ? std::string("file:///fake") : opened_uri;
            const Json first = {{"uri", document},
                                {"range", {{"start", {{"line", 1}, {"character", 0}}}, {"end", {{"line", 1}, {"character", 1}}}}}};
            if (!multi_definition) {
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json::array({first})}});
            } else {
                // `--multi-definition`：第二个目标在同一目录的 Helper.java —— 客户端必须把
                // **两条**都交给「选择声明」弹层（原来只取 locations[0]，第二条永远看不到）。
                const Json second = {{"uri", sibling_of(document, "Helper.java")},
                                     {"range", {{"start", {{"line", 4}, {"character", 8}}}, {"end", {{"line", 4}, {"character", 12}}}}}};
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json::array({first, second})}});
            }
        } else if (method == "textDocument/prepareRename") {
            // 规范里结果有三种形态：Range / {range, placeholder} / null。这里按请求位置区分：
            // character 99 = 此处不能改名（null），其余位置回 {range, placeholder}，两者都能测到。
            const Json point = params.contains("position") && params.at("position").is_object()
                                   ? params.at("position") : Json::object();
            const auto line = point.value("line", 0);
            const auto character = point.value("character", 0);
            if (character == 99) write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", nullptr}});
            else write_message({{"jsonrpc", "2.0"}, {"id", id},
                                {"result", {{"range", range(line, character, line, character + 6)},
                                            {"placeholder", "originalName"}}}});
        } else if (method == "textDocument/rename") {
            // WorkspaceEdit whose `changes` touch TWO documents: the requested file
            // (two edits) and a sibling (one edit), all with 0-based ranges.
            const auto document = requested(params);
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
            const auto document = requested(params);
            const Json point = params.contains("position") && params.at("position").is_object()
                                   ? params.at("position") : Json::object();
            const auto line = point.value("line", 0);
            const auto character = point.value("character", 0);
            const Json refs = Json::array({
                location(document, line, character, line, character + 6),
                location(sibling_of(document, "Helper.java"), 7, 3, 7, 9)});
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", refs}});
        } else if (method == "textDocument/documentSymbol") {
            const auto document = requested(params);
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
            const auto document = requested(params);
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
            const auto document = requested(params);
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
            action["edit"] = {{"changes", {{requested(params), imports}}}};
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", action}});
        } else if (method == "workspace/executeCommand") {
            // The echo makes the two things that matter observable: which command id
            // arrived and how many arguments came with it (an absent `arguments` is
            // NOT an empty array, and the client must not invent one).
            const auto command = params.value("command", std::string());
            // -1 means the `arguments` key was absent, which is different from an
            // empty array: the client must not invent one.
            int argument_count = -1;
            if (params.contains("arguments") && params.at("arguments").is_array())
                argument_count = static_cast<int>(params.at("arguments").size());
            // A real command mutates the workspace by asking the CLIENT to apply an
            // edit. Sending the reverse request BEFORE the reply makes the test
            // deterministic: the client's workspace/applyEdit handler has already
            // written the file by the time the executeCommand promise resolves.
            if (!opened_uri.empty()) {
                const Json edits = Json::array({{{"range", range(0, 0, 0, 0)}, {"newText", "// ran " + command + "\n"}}});
                write_message({{"jsonrpc", "2.0"}, {"id", 90001}, {"method", "workspace/applyEdit"},
                               {"params", {{"edit", {{"changes", {{opened_uri, edits}}}}}}}});
            }
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", {{"executed", command}, {"argc", argument_count}}}});
        } else if (method == "workspace/willRenameFiles") {
            // 结果是 **WorkspaceEdit 本身**（`WorkspaceEdit | null`），不是 `{edit: …}`
            // —— 后者是 `workspace/applyEdit` 的参数形状。客户端搞错就会拿到空编辑。
            // 编辑落在 newUri 上，newText 里回带 oldUri，这样测试能同时看到两个 uri 都到了。
            const Json files = params.contains("files") && params.at("files").is_array()
                                   ? params.at("files") : Json::array();
            Json changes = Json::object();
            for (const auto& file : files) {
                if (!file.is_object()) continue;
                const auto old_uri = file.value("oldUri", std::string());
                const auto new_uri = file.value("newUri", std::string());
                if (new_uri.empty()) continue;
                changes[new_uri] = Json::array({Json{{"range", range(0, 0, 0, 0)},
                                                     {"newText", "// moved from " + old_uri + "\n"}}});
            }
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", {{"changes", changes}}}});
        } else if (method == "textDocument/prepareCallHierarchy") {
            // One CallHierarchyItem whose name echoes the requested 0-based line, so
            // the test can see the position arrived. `uri` is the opened document.
            const auto document = requested(params);
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
            const auto document = requested(params);
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
            const auto document = requested(params);
            const auto inside = method == "textDocument/implementation";
            Json found = Json::array({location(inside ? document : sibling_of(document, "Helper.java"),
                                               inside ? 3 : 9, inside ? 4 : 7, inside ? 3 : 9, inside ? 12 : 14)});
            // `--multi-implementation`：再补一条（同目录的 Helper.java）—— 多目标时客户端要弹
            // 「选择实现」（IDEA 的 Choose Implementation of …，单目标则直接跳），一条测不到。
            if (inside && multi_implementation) {
                found.push_back(location(sibling_of(document, "Helper.java"), 4, 8, 4, 14));
            }
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
        } else if (method == "textDocument/moniker") {
            // 两条：`unique: true` 的（可放心当引用）与 `unique: false` 的（同名可能多个，
            // 客户端要么不用要么提示）；另加一条**没有 identifier** 的 —— 没有标识就没有可复制的东西。
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json::array({
                Json{{"scheme", "taocode"}, {"identifier", "Sample.counter"}, {"unique", true}},
                Json{{"scheme", "taocode"}, {"identifier", "counter"}, {"unique", false}},
                Json{{"scheme", "taocode"}, {"unique", true}}})}});
        } else if (method == "textDocument/codeLens") {
            // 三条，覆盖三种形状：
            //   · title + command + arguments（点击要能转成 executeCommand）
            //   · title + command，**没有** arguments（arguments 是可选的）
            //   · **没有 command**（title 在 command 里，这条既显示不了也点不动 → 客户端必须丢掉）
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json::array({
                Json{{"range", range(1, 4, 1, 12)},
                     {"command", Json{{"title", "3 usages"}, {"command", "showUsages"},
                                      {"arguments", Json::array({requested(params)})}}}},
                Json{{"range", range(3, 0, 3, 6)},
                     {"command", Json{{"title", "1 implementation"}, {"command", "showImplementations"}}}},
                Json{{"range", range(5, 0, 5, 4)}}})}});
        } else if (method == "textDocument/inlineCompletion") {
            // 三项覆盖三种形状：
            //   · `insertText` 是**字符串**（最常见）
            //   · `insertText` 是 `{kind:"plainText", value}`（StringValue 形式）
            //   · `insertText` 是 `{kind:"snippet", ...}` —— 占位符不展开，客户端**必须丢掉**它
            // 另外第一项带 `range`（替换区间），用来验证四个角都被整形出来。
            // 注意：这个文件是 **LSP** 假服务器，helper 与 DAP 假适配器不同名
            // （没有 `number`/`event`，取字段用 nlohmann 的 `.value()`，也没有 output 事件）。
            const auto point = params.contains("position") && params.at("position").is_object()
                                   ? params.at("position") : Json::object();
            const auto request_line = point.value("line", -1);
            Json suggestions = Json::array({
                Json{{"insertText", "countLocal()"},
                     {"filterText", "countLocal"},
                     {"range", range(2, 4, 2, 7)}},
                Json{{"insertText", Json{{"kind", "plainText"}, {"value", " += 1"}}}},
                Json{{"insertText", Json{{"kind", "snippet"}, {"value", "for (${1:i}) ${0}"}}}}});
            // **位置敏感项**：行号 > 0 时多给一条。测试据此证明 position 真的发出去了 ——
            // 比"回声成 output"更硬（那是另一条通道），而且不污染前两项的语义。
            if (request_line > 0)
                suggestions.push_back(Json{{"insertText", "line" + std::to_string(request_line) + "()"}});
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", std::move(suggestions)}});
        } else if (method == "workspace/diagnostic") {
            // 两个文件：第一个永远回 full（带诊断），第二个**有 previousResultIds 就回 unchanged**。
            // 客户端必须把 unchanged 与 full 分开处理 —— 把 unchanged 当成"没诊断"会把
            // 一整批诊断从问题面板里抹掉。
            bool has_previous = false;
            if (params.contains("previousResultIds") && params.at("previousResultIds").is_array() &&
                !params.at("previousResultIds").empty())
                has_previous = true;
            const auto document = opened_uri.empty() ? std::string("file:///fake/Sample.java") : opened_uri;
            Json items = Json::array({
                Json{{"uri", document}, {"version", 1}, {"kind", "full"}, {"resultId", "ws-1"},
                     {"items", Json::array({Json{{"range", range(0, 0, 0, 5)}, {"severity", 1},
                                                 {"message", "workspace diagnostic"}}})}}});
            if (has_previous)
                items.push_back(Json{{"uri", document + ".other"}, {"version", 1}, {"kind", "unchanged"},
                                     {"resultId", "ws-2"}});
            else
                items.push_back(Json{{"uri", document + ".other"}, {"version", 1}, {"kind", "full"},
                                     {"resultId", "ws-2"}, {"items", Json::array()}});
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json{{"items", items}}}});
        } else if (method == "textDocument/documentLink") {
            // 三条链接，覆盖三种形状：
            //   · 有 target + tooltip（注释里的 https 链接）
            //   · 只有 target（不带 tooltip 的普通链接）
            //   · **没有 target**（服务器只给了区间和 tooltip）—— 客户端必须保留它
            //     （能显示 tooltip，只是点不动），丢掉就是把服务器说的东西静默吞了
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", Json::array({
                Json{{"range", range(0, 2, 0, 27)},
                     {"target", "https://example.com/issues/42"},
                     {"tooltip", "打开 issue 42"}},
                Json{{"range", range(1, 4, 1, 20)},
                     {"target", "https://example.com/docs"}},
                Json{{"range", range(2, 0, 2, 8)},
                     {"tooltip", "服务端没给目标"}}})}});
        } else if (method == "textDocument/semanticTokens/full") {
            // 三个 token，形状刻意覆盖解码的三种情况：
            //   [0,0,5,15,0]       第 0 行 offset 0 长度 5，tokenType 15 = keyword
            //   [0,6,3,8,12]       同一行的第二个 token（deltaStartChar 是**相对**上一个的，
            //                      tokenType 8 = variable，修饰符 12 = static(1<<3) | readonly(1<<2)）
            //   [2,4,7,12,0]       换到第 2 行（deltaLine 2），此时 deltaStartChar 是**绝对**列 4，
            //                      tokenType 12 = function
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result",
                {{"resultId", "fake-tokens-1"},
                 {"data", Json::array({0, 0, 5, 15, 0, 0, 6, 3, 8, 12, 2, 4, 7, 12, 0})}}}});
        } else if (method == "textDocument/semanticTokens/full/delta") {
            // `previousResultId` 对得上就回 delta（从第 10 个整数起删 5 个、插入一条新的
            // variable token）；对不上则按规范允许的方式回**整份 data**（"整份替换"）。
            // 两条路客户端都要能处理。
            const auto previous = params.value("previousResultId", std::string());
            if (previous == "fake-tokens-1") {
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result",
                    {{"resultId", "fake-tokens-2"},
                     {"edits", Json::array({Json{{"start", 10}, {"deleteCount", 5},
                                                 {"data", Json::array({2, 4, 9, 8, 0})}}})}}}});
            } else {
                write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result",
                    {{"resultId", "fake-tokens-2"},
                     {"data", Json::array({0, 0, 5, 15, 0, 0, 6, 3, 8, 12, 2, 4, 9, 8, 0})}}}});
            }
        } else if (method == "textDocument/inlayHint") {
            // Two hints: one plain string label, one label-parts array with padding.
            // The first one also carries a `command` (click) and a `tooltip`, so the client's forwarding
            // of those two fields has something to forward: LSP `InlayHint.command` / `InlayHint.tooltip`.
            // 两个提示分成两个具名对象再进数组：MSVC 对「数组字面量里套对象初始化列表」的花括号
            // 配对会报 C3329（它把内层解析成表达式），拆开最好读也最好编译。
            const Json hintOne = Json{
                {"position", Json{{"line", 0}, {"character", 4}}},
                {"label", ": int"},
                {"kind", 1},
                {"command", Json{{"title", "Show type"}, {"command", "editor.action.showType"}}},
                {"tooltip", "推断出的类型"}
            };
            const Json hintTwo = Json{
                {"position", Json{{"line", 1}, {"character", 6}}},
                {"label", Json::array({Json{{"value", "x"}, {"location", Json::object()}}})},
                {"paddingLeft", true},
                {"paddingRight", true},
                {"tooltip", Json{{"kind", "markdown"}, {"value", "**参数名**"}}}
            };
            const Json hints = Json::array({hintOne, hintTwo});
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"result", hints}});
        } else {
            write_message({{"jsonrpc", "2.0"}, {"id", id}, {"error", {{"code", -32601}, {"message", "Method not found"}}}});
        }
}

}  // namespace fake_server
