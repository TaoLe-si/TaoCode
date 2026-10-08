// 起一个语言服务器：拼 initialize 参数、装好三个回调、把已在编辑的文档补发 didOpen。
// 从 lsp_session.cpp 抽出来（它一个函数就占了 228 行）。
#include "lsp_session.hpp"
#include "request_trace.hpp"
#include "lsp_support.hpp"

#include <cstdint>
#include <filesystem>
#include <string>
#include <tuple>
#include <vector>

using namespace taocode::lsp::detail;

namespace taocode {
namespace lsp {

std::string uri_to_relative(const std::string& uri, const std::filesystem::path& root) {
    std::string tail = uri;
    const std::string scheme = "file:///";
    if (tail.rfind(scheme, 0) == 0) tail = tail.substr(scheme.size());
    else if (tail.rfind("file://", 0) == 0) tail = tail.substr(7);
    auto decoded = percent_decode(tail);
    const std::string base = u8_path(root);
    if (base.size() > 1 && decoded.size() >= base.size() && lower(decoded.substr(0, base.size())) == lower(base)) {
        auto relative = decoded.substr(base.size());
        while (!relative.empty() && (relative.front() == '/' || relative.front() == '\\')) relative.erase(relative.begin());
        return relative;
    }
    return decoded;
}


Host& Session::ensure(const std::string& language) {
    const auto existing = hosts_.find(language);
    if (existing != hosts_.end()) return *existing->second;
    const auto config = config_.find(language);
    if (config == config_.end()) throw WorkspaceError("LSP_UNAVAILABLE", "no server configured for " + language);

    auto host = std::make_unique<Host>();
    // 这台服务器属于这一代会话：它登记自己，弃养这一代时按号收进程（见 lsp_children.hpp）。
    host->set_generation(generation_);
    // The root is snapshotted when the host is created and never changes while it
    // lives (reset_lsp shuts every host down before set_root), so the reader-thread
    // callback below can map URIs without touching mutable Session state.
    const auto root_snapshot = root_;
    host->set_diagnostics([this, root_snapshot](Json params) {
        if (!params.is_object()) return;
        const auto uri = string_at(params, "uri");
        if (uri.empty()) return;
        // This runs on the Host reader thread with Host::io_mutex_ held. It must not
        // take Session::mutex_ (Session->Host is the other lock order) and it must
        // never throw: a malformed payload escaping here would terminate the process.
        const std::string path = uri_to_relative(uri, root_snapshot);
        // 整批的 `version` 与条目一起交出去：它是 `PublishDiagnosticsParams` 上的兄弟字段，
        // `shape_diagnostics` 那一层（条目数组）结构上拿不到 —— 之前正是这一行把它丢掉的。
        // 这里**不**按版本拒收：上游的分工是客户端传输原样转发、显示缓存那一侧按
        // 「已发布 vs 当前文档」比版本再丢（`LspPublishDiagnosticsCache.kt:56-66`，本仓对应
        // `src/lspHighlightingCache.ts` 的 `acceptsPublishedVersion()`）。所以递减/乱序的批次
        // 也照样透传，让那道闸拿到真的号去拒；宿主自己丢就等于把闸门重新饿死。
        const PublishedBatch batch = shape_publish_params(params, [root_snapshot](const std::string& target) {
            return uri_to_relative(target, root_snapshot);
        });
        if (on_diagnostics_versioned_) on_diagnostics_versioned_(path, batch.items, batch.version);
        else if (on_diagnostics_) on_diagnostics_(path, std::move(batch.items));
    });

    // LSP `$/progress` → 一条带百分比的后台任务（上游 LspServerNotificationsHandlerImpl.kt:257-328：
    // begin 里的 title/message/percentage 就是任务文本、细节与 fraction，report 只更新缺省的字段，
    // end 让这条任务消失）。整型/字符串两种 token 都要能当键用（协议的 ProgressToken 是联合类型）。
    host->set_progress([this, language](Json params) {
        if (!on_progress_ || !params.is_object()) return;
        const auto value = params.value("value", Json::object());
        if (!value.is_object()) return;
        const auto& raw_token = params.contains("token") ? params.at("token") : Json();
        std::string token;
        if (raw_token.is_string()) token = raw_token.get<std::string>();
        else if (raw_token.is_number_integer()) token = std::to_string(raw_token.get<std::int64_t>());
        // 与 diagnostics 同一条纪律：这是读线程上的回调，不碰 `Session::mutex_`，也不抛。
        if (token.empty()) return;
        on_progress_({{"event", "lsp.progress"},
                      {"language", language},
                      {"token", std::move(token)},
                      {"kind", string_at(value, "kind")},
                      {"title", string_at(value, "title")},
                      {"message", string_at(value, "message")},
                      {"percentage", value.contains("percentage") && value.at("percentage").is_number()
                                         ? value.at("percentage").get<int>() : -1},
                      {"cancellable", value.value("cancellable", false)}});
    });

    // 服务器**主动**发来的那几种消息与请求都走这一条出口：`window/showMessage` 与 `window/logMessage`
    // 是通知，`window/showMessageRequest`、`workspace/…/refresh` 与本轮补上的三条动态注册/进度申请
    // （`client/registerCapability`、`client/unregisterCapability`、`window/workDoneProgress/create`）
    // 是请求 —— 客户端已在参数里补了 `method`（见 native/lsp.cpp 的 tag_server_message），
    // 请求的回包在 native 那一头就地给（这几条协议返回的都是 void），这里只负责让界面看得见内容。
    // 走的是同一条 progress 出口（前端按 `event` 分派、再按 `method` 分处置），上游对这几条的处置也各不相同：
    // `LspServerNotificationsHandlerImpl.kt:341-368`（refresh）、`:377-383`（showMessageRequest）、
    // `:385-391`（showMessage）、`:393-405`（logMessage 只进日志，Error/Warning 才弹）、
    // `:119-123`/`:125-128`（动态注册记账）、`:255`（同意进度申请）。
    host->set_server_message([this, language](Json params) {
        if (!on_progress_ || !params.is_object()) return;
        const auto text = string_at(params, "message");
        const auto method = string_at(params, "method");
        // refresh 那一族没有消息正文（参数是 null 或省略），但事件必须转出去：前端要据此作废缓存。
        if (text.empty() && method.empty()) return;
        Json payload{{"event", "lsp.message"},
                     {"language", language},
                     {"severity", params.contains("type") && params.at("type").is_number() ? params.at("type").get<int>() : 3},
                     {"message", text},
                     {"method", method}};
        // `window/showMessageRequest` 的按钮标题（协议的 `actions: MessageActionItem[]`）原样带上，
        // 由前端决定怎么显示（上游是通知上的那一排按钮；本仓的按钮还没接线，见请求文档）。
        if (params.contains("actions") && params.at("actions").is_array()) payload["actions"] = params.at("actions");
        // 服务器**主动发起**的那三条请求（`client/registerCapability`、`client/unregisterCapability`、
        // `window/workDoneProgress/create`）的参数形状不是 `{type,message}`，而是 `registrations` /
        // `unregisterations` / `token`。回包由 `native/lsp.cpp` 就地给（协议返回的都是 void），
        // 但**内容不能丢**：动态注册要在这里记账、并按注册的方法作废那一族缓存
        // （上游 `LspServerNotificationsHandlerImpl.kt:119-123` + `:130-182` 做的正是这两件事），
        // 丢了就又是「声明了 dynamicRegistration、服务器注册完客户端一无所知」。
        for (const char* key : {"registrations", "unregisterations", "token"})
            if (params.contains(key)) payload[key] = params.at(key);
        on_progress_(std::move(payload));
    });

    Host::Spec spec;
    spec.executable = config->second.command;
    spec.arguments = config->second.arguments;
    spec.working_directory = config->second.working_directory;
    const auto declared = config->second.workspace_folders;   // 空 = 用工作区根（见 ServerConfig 的注释）
    const auto root_uri = declared.empty() ? (root_.empty() ? Json(nullptr) : Json(to_uri("")))
                                          : Json(to_uri(declared.front()));
    auto initialization = config->second.initialization_options;
    initialization["settings"] = config->second.settings;
    host->set_configuration(config->second.settings);
    host->set_timeout(timeout_);
    const auto root_name = root_.filename().generic_u8string();
    Json folders = Json::array();
    if (!declared.empty()) {
        for (const auto& relative : declared) {
            const auto name = std::filesystem::path(relative).filename().generic_u8string();
            folders.push_back({{"uri", to_uri(relative)}, {"name", std::string(name.begin(), name.end())}});
        }
    } else if (!root_.empty()) folders.push_back({{"uri", root_uri}, {"name", std::string(root_name.begin(), root_name.end())}});
    // 链接的子工程目录也算工作区文件夹（见 set_extra_roots 的注释）：JDT 只在这些文件夹里
    // 建"不可见 / 非托管"工程，源根落在文件夹之外就成了"non-project file"。
    for (const auto& extra : extra_roots_) {
        if (extra.empty()) continue;
        const auto name = extra.filename().generic_u8string();
        folders.push_back({{"uri", to_uri(u8_path(extra).substr(root_.empty() ? 0 : u8_path(root_).size()))},
                           {"name", std::string(name.begin(), name.end())}});
    }
    Json params{
        {"initializationOptions", std::move(initialization)},
        {"workspaceFolders", folders.empty() ? Json(nullptr) : folders},
        {"clientInfo", {{"name", "TaoCode"}, {"version", "0.1"}}},
        {"rootUri", root_uri},
        {"capabilities", {
            {"textDocument", {
                {"hover", {{"contentFormat", Json::array({"markdown", "plaintext"})}}},
                {"definition", Json::object()},
                // Completion: the item kinds the UI renders，以及 resolve 能补齐的三样东西。
                // `resolveSupport.properties` 声明后，服务器可以只发 label/kind，文档与
                // `additionalTextEdits`（"自动导入"那类编辑）由 `completionItem/resolve` 按需补 —— 
                // 客户端**只在选中某项时**发这个请求（对应 IDEA 的 CompletionResultSet 懒解析）。
                {"completion", {{"completionItem", {{"snippetSupport", false},
                                                    {"commitCharactersSupport", false},
                                                    {"documentationFormat", Json::array({"markdown", "plaintext"})},
                                                    {"deprecatedSupport", false},
                                                    {"insertReplaceSupport", false},
                                                    {"resolveSupport", {{"properties", Json::array({"documentation", "detail",
                                                                                                    "additionalTextEdits"})}}}}},
                                {"completionItemKind", {{"valueSet", Json::array({1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
                                                                                 12, 13, 14, 15, 16, 17, 18, 19, 20,
                                                                                 21, 22, 23, 24, 25})}}},
                                {"contextSupport", true}}},
                // tagSupport：声明客户端认得 DiagnosticTag 1/2（Unnecessary / Deprecated），服务器
                // 才会在推送里带上 tags。能力表要与实际处理一致 —— 下面 `shape_diagnostics` 确实把
                // tags 透传了；pull 那侧早就声明了同一组（见下面 `diagnostic.tagSupport`）。
                // versionSupport 本轮由 false 翻成 true：`false` 是对服务器说「我不看 params.version」，
                // 于是它有权不发，前端那道按版本拒收的闸（`src/lspHighlightingCache.ts`
                // 的 `acceptsPublishedVersion()`，上游 `LspPublishDiagnosticsCache.kt:56-66`）
                // 就永远拿不到数据。现在 `shape_publish_params` 真的把它取出来、
                // `VersionedDiagnosticsSink` 真的把它交出去了，声明才与处理一致。
                {"publishDiagnostics", {{"relatedInformation", true}, {"versionSupport", true},
                                        {"dataSupport", true},
                                        {"tagSupport", {{"valueSet", Json::array({1, 2})}}}}},
                // Refactor + symbol capabilities: declaring hierarchical symbol
                // support is what makes real servers answer DocumentSymbol[]
                // instead of the legacy flat SymbolInformation[].
                {"references", Json::object()},
                // `prepareSupport: true` 表示客户端会发 `textDocument/prepareRename`（LSP 规范的
                // RenameClientCapabilities）—— 声明与实际发出的请求必须一致，所以这里和下面的
                // prepareRename 分支是一对，改一个必须改另一个。
                {"rename", {{"prepareSupport", true}, {"changesAnnotationSupport", Json::object()}}},
                {"documentSymbol", {{"hierarchicalDocumentSymbolSupport", true}}},
                // Coding assistance. `resolveSupport` IS declared now: an action that
                // arrives with only a command is fetched again through
                // codeAction/resolve (see the codeActionResolve kind below).
                {"signatureHelp", {{"contextSupport", true},
                                   {"signatureInformation", {
                                       {"documentationFormat", Json::array({"markdown", "plaintext"})},
                                       {"parameterInformation", {{"labelSupport", true}}}}}}},
                {"codeAction", {{"codeActionLiteralSupport", {{"codeActionKind", {{"valueSet", Json::array({
                    "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite",
                    "source", "source.organizeImports", "source.fixAll"})}}}}},
                    {"isPreferredSupport", true}, {"dataSupport", true},
                    {"resolveSupport", {{"properties", Json::array({"edit", "command"})}}}}},
                {"formatting", Json::object()},
                {"rangeFormatting", Json::object()},
                {"implementation", Json::object()},
                {"typeDefinition", Json::object()},
                {"documentHighlight", Json::object()},
                {"callHierarchy", Json::object()},
                {"typeHierarchy", Json::object()},
                // Inlay hints and selection ranges are requested below, so they are
                // declared here: a server is entitled to refuse a request whose
                // capability the client never announced. `resolveSupport` is omitted
                // on purpose — inlayHint/resolve is not implemented.
                {"inlayHint", {{"dynamicRegistration", true}}},
                {"selectionRange", {{"dynamicRegistration", true}}},
                // LSP `textDocument/moniker` —— 符号的**稳定标识**（跨仓库/跨工具认同同一个符号）。
                // IDEA 侧最接近的用户可见功能是 **Copy Reference**：`CopyReferenceAction`
                // （`platform/lang-impl/src/com/intellij/ide/actions/CopyReferenceAction.java:41`），
                // 复制走 `actionPerformed`（`:104`），要复制的标识由 `getQualifiedName`（`:128`）给出 ——
                // 所以这里把 moniker 的 `identifier` 当成"引用字符串"的来源。
                {"moniker", {{"dynamicRegistration", false}}},
                // LSP `textDocument/codeLens` —— IDEA 的 **Code Vision**：
                // 接口 `platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionProvider.kt:25`，
                // 产生条目是 `computeForEditor`（`:62`，返回 `List<Pair<TextRange, CodeVisionEntry>>`），
                // 点击行为是 `handleClick`（`:76`），可用性是 `isAvailableFor`（`:35`）。
                // **不声明 `resolveProvider`**：声明了就会收到不带 `command` 的 CodeLens，
                // 那就必须再实现一条 `codeLens/resolve` 链路（和 documentLink 同样的取舍）。
                {"codeLens", {{"dynamicRegistration", false}}},
                // LSP `textDocument/inlineCompletion` —— IDEA 的**行内补全**：
                // 接口 `platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/InlineCompletionProvider.kt:44`，
                // 产生建议是 `getSuggestion`（`:82`），该不该触发是 `isEnabled(event)`（`:94`），
                // 接受/插入由 `platform/inline-completion/shared/src/InlineCompletionHandlerImpl.kt` 处理。
                // 这里只声明"我支持接收行内补全"——**不声明 `insertTextMode` 等服务端能力**，
                // 因为 `snippet` 形式的占位符我们并不展开（见整形处的丢弃逻辑）。
                {"inlineCompletion", {{"dynamicRegistration", false}}},
                // LSP `textDocument/documentLink` —— IDEA 侧的可点击区间：
                // 编辑器里 Ctrl+Click 跳到目标的扩展点是 `GotoDeclarationHandler`
                // （platform/analysis-api/src/com/intellij/codeInsight/navigation/actions/GotoDeclarationHandler.java），
                // "点一下导航"的抽象是 `HyperlinkInfo.navigate`
                // （platform/core-api/src/com/intellij/execution/filters/HyperlinkInfo.kt:17-20），
                // 外部 URL 由 `BrowserUtil.browse` / `OpenUrlHyperlinkInfo` 打开。
                // **`resolveProvider: false`**：声明了 resolve 就会收到不带 `target` 的 link，
                // 那就必须再实现一条 `documentLink/resolve` 链路。这里如实声明不支持，
                // 服务器据此会直接把 `target` 一起给它。
                {"documentLink", {{"resolveProvider", false}}},
                // LSP `textDocument/semanticTokens/*` —— IDEA 的 daemon 着色路径：
                // `HighlightVisitor.visit`（platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/HighlightVisitor.java:17,36）
                // + `Annotator.annotate`（platform/analysis-api/src/com/intellij/lang/annotation/Annotator.java:22,36）
                // 产出 `HighlightInfo`，颜色由 `TextAttributesKey` 决定
                // （`DefaultLanguageHighlighterColors`：`:14` KEYWORD、`:29` LOCAL_VARIABLE、
                //  `:30` REASSIGNED_LOCAL_VARIABLE、`:33` FUNCTION_DECLARATION、`:35` PARAMETER、
                //  `:41` INSTANCE_FIELD、`:43` STATIC_FIELD —— 注意 IDEA 把 `static` 这种
                //  "修饰符"表达成**另一个 key**，与 LSP 的 tokenModifiers 位掩码是两种建模）。
                // 只声明 `full`（含 `delta`）与 legend：`range` 不声明 —— 声明了就得实现，
                // 而按视口取一段的做法对一个整文件重着色的编辑器没有收益。
                {"semanticTokens", {{"dynamicRegistration", false},
                                    {"requests", {{"range", false}, {"full", {{"delta", true}}}}},
                                    {"tokenTypes", Json::array({"namespace", "type", "class", "enum", "interface",
                                                                "struct", "typeParameter", "parameter", "variable",
                                                                "property", "enumMember", "event", "function", "method",
                                                                "macro", "keyword", "modifier", "comment", "string",
                                                                "number", "regexp", "operator", "decorator"})},
                                    {"tokenModifiers", Json::array({"declaration", "definition", "readonly", "static",
                                                                    "deprecated", "abstract", "async", "modification",
                                                                    "documentation", "defaultLibrary"})},
                                    // 只支持相对编码；`overlappingTokenSupport` / `multilineTokenSupport`
                                    // 都是 false，所以服务器不会把 token 拆成跨行或多层重叠的那种形状。
                                    {"formats", Json::array({"relative"})},
                                    {"overlappingTokenSupport", false},
                                    {"multilineTokenSupport", false}}},
                // LSP `textDocument/diagnostic`（**pull 模型**，对应 IDEA 的批处理 Inspection）：
                // 声明后服务器可以只在客户端来问时给诊断；整形用 range/message/severity/source，
                // 外加 `relatedInformation`（折成宿主形状，见 `shape_diagnostics`），
                // 所以这三项如实声明支持；`codeDescription`/`data` 仍不处理，声明为 false。
                {"diagnostic", {{"dynamicRegistration", true},
                                {"relatedInformation", true},
                                {"tagSupport", {{"valueSet", Json::array({1, 2})}}},
                                {"codeDescriptionSupport", false},
                                {"dataSupport", false}}},
                // LSP `textDocument/foldingRange`（IDEA 的 `FoldingBuilder` 那一层）：
                // `lineFoldingOnly: true` 表示客户端只按整行折叠，服务器可以据此别发三列式区间。
                {"foldingRange", {{"dynamicRegistration", true}, {"lineFoldingOnly", true}}},
                // The didChange the client sends is derived from what the server
                // announces (full or incremental), so declaring both is honest.
                {"synchronization", {{"dynamicRegistration", true}, {"willSave", false},
                                     {"willSaveWaitUntil", false}, {"didSave", false}}},
            }},
            // LSP `window` 能力（上游 `LspClientCapabilities.kt:245-249` 就这三项）：
            // `workDoneProgress: true` 是**服务器愿不愿意发 `$/progress` 的开关**，
            // 不声明它，jdt.ls 的“正在导入工程/正在建索引”永远不会报回来。
            {"window", {{"workDoneProgress", true}}},
            {"workspace", {{"configuration", true}, {"symbol", Json::object()},
                           // applyEdit is implemented: the server's edits really are
                           // written through the workspace layer.
                           {"applyEdit", true},
                           {"workspaceEdit", {{"documentChanges", true},
                                              {"resourceOperations", Json::array({"create", "rename", "delete"})},
                                              {"failureHandling", "textOnlyTransactional"}}},
                           {"didChangeConfiguration", {{"dynamicRegistration", true}}},
                           {"workspaceFolders", true},
                           // 文件操作通知：客户端**承诺会发**这四种（IDEA 的 VFS 事件 +
                           // `RefactoringEventListener`）。服务器据此决定是否监听；真发之前
                           // 还会再查服务器自己是否声明了 `workspace.fileOperations.<其一>`。
                           // `willRename` 承诺的是"改名前会问，你可以回一个 WorkspaceEdit 改 import"。
                           //
                           // 这四个键在**客户端能力**里是**布尔值**（LSP 3.16
                           // `WorkspaceClientCapabilities.fileOperations`；javap 核对
                           // org.eclipse.lsp4j_0.23.1：`FileOperationsWorkspaceCapabilities.getDidCreate()
                           // -> Boolean`）。带 filters 的对象是**服务端**能力的形状
                           // （`FileOperationsServerCapabilities.getDidCreate() -> FileOperationOptions`）。
                           // 这里曾经错写成过滤器数组，JDT LS 的 Gson 反序列化直接失败：
                           // "Expected a boolean but was BEGIN_ARRAY ... fileOperations.didCreate"，
                           // 整条 initialize 被回 -32700（Message could not be parsed），
                           // 服务器从未进入 handler —— 表现就是"服务器起来了但 ready 永远 false"。
                           {"fileOperations", {{"didCreate", true},
                                               {"didRename", true},
                                               {"didDelete", true},
                                               {"willRename", true}}}}},
        }},
    };
    // The server-driven `workspace/applyEdit` writes real files through Workspace.
    host->set_document_editor([this](const std::string& uri, const Json& edits, int version) {
        return apply_document_edits(uri, edits, version);
    });
    // Defer didOpen until the initialize handshake completes on the reader thread.
    startup_errors_.erase(language);
    host->start(spec, std::move(params), [this, language](Json result, Json error) {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        if (!error.is_null()) { startup_errors_[language] = std::move(error); return; }
        ready_[language] = true;
        capabilities_[language] = result.is_object() && result.contains("capabilities") &&
                                          result.at("capabilities").is_object()
                                      ? result.at("capabilities") : Json::object();
        const auto host = hosts_.find(language);
        if (host == hosts_.end()) return;
        // Honour the sync kind the server announced: with Incremental a didChange
        // carries a range instead of the whole document.
        const auto& capabilities = capabilities_[language];
        const auto& declared = capabilities.contains("textDocumentSync") ? capabilities.at("textDocumentSync")
                                                                         : Json(nullptr);
        int kind = static_cast<int>(SyncKind::full);
        if (declared.is_number_integer()) kind = declared.get<int>();
        else if (declared.is_object() && declared.contains("change") && declared.at("change").is_number_integer())
            kind = declared.at("change").get<int>();
        host->second->set_sync_kind(kind == static_cast<int>(SyncKind::incremental) ? SyncKind::incremental
                                                                                    : SyncKind::full);
        // 这段跑在 **Host 的读线程**上。补发 didOpen 要写服务器 stdin，而那个写是在 `io_mutex_`
        // 里做的阻塞调用 —— 抱着 `Session::mutex_` 去写，就会和"先拿 io、再等 Session"的路径
        // 互相咬住（2026-09-28 实测：读线程持有 Session 锁 20s+，界面整片"未响应"）。
        // 所以这里只登记，不发送：交回语言服务线程去做。
        const auto post = owner_post_;
        const std::string owned = language;
        // 没有宿主线程可交（离线自测里就是这种情况）时只能就地补发 —— 否则文档永远不发
        // didOpen，握手看起来"没落地"，测试与真实行为会分叉。
        if (post) post([this, owned] { flush_opens(owned); request_project_import(owned); });
        else flush_opens_here(owned);
    });
    hosts_[language] = std::move(host);
    return *hosts_[language];
}

void Session::request_project_import(const std::string& language) {
    // 只在**关掉 Gradle 导入**时才要这一下：导入开着时 JDT 自己会建工程，而 Buildship 导入
    // 又不理会 exclusions（真机实证），所以"关导入 + 主动 import 一次"才是这条工程上走得通的路。
    Host* host = nullptr;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        if (config_.find(language) == config_.end()) return;
        const auto& settings = config_.at(language).settings;
        const auto& gradle = settings.contains("java") && settings.at("java").is_object() && settings.at("java").contains("import")
                                && settings.at("java").at("import").is_object() && settings.at("java").at("import").contains("gradle")
                            ? settings.at("java").at("import").at("gradle") : Json();
        if (!gradle.is_object() || gradle.value("enabled", true)) return;
        const auto found = hosts_.find(language);
        if (found == hosts_.end()) return;
        host = found->second.get();
    }
    // 锁外发（与 flush_opens 同一条纪律：阻塞写只挡这条语言服务线程）。
    host->request("workspace/executeCommand", {{"command", "java.project.import"}, {"arguments", Json::array()}},
                  [](Json, Json) { /* 命令是幂等的，答不答都不影响后续请求 */ });
}

void Session::flush_opens_here(const std::string& language) {
    const auto found = hosts_.find(language);
    if (found == hosts_.end()) return;
    for (auto& [path, doc] : documents_)
        if (doc.language == language && !doc.opened) {
            found->second->did_open(doc.uri, language, doc.version, doc.text);
            doc.opened = true;
        }
}

void Session::flush_opens(const std::string& language) {
    std::vector<std::tuple<std::string, std::string, int, std::string>> to_open;
    Host* host = nullptr;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        const auto found = hosts_.find(language);
        if (found == hosts_.end()) return;
        host = found->second.get();
        for (auto& [path, doc] : documents_)
            if (doc.language == language && !doc.opened) {
                to_open.emplace_back(doc.uri, language, doc.version, doc.text);
                doc.opened = true;
            }
    }
    // 锁已放掉：这里的阻塞写只挡住语言服务线程，既挡不住界面，也不会和读线程抢 Session 锁。
    for (const auto& [uri, language_id, version, text] : to_open) host->did_open(uri, language_id, version, text);
}

}  // namespace lsp
}  // namespace taocode
