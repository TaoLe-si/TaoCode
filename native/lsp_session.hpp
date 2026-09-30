#pragma once

#include <chrono>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "lsp_children.hpp"
#include "lsp_host.hpp"
#include "workspace.hpp"

namespace taocode {
namespace lsp {

// Holds one language-server child per active language and translates between the
// IDE's workspace-relative paths / CodeMirror coordinates and the LSP wire form
// (file:// URIs, 0-based positions, provider-specific result shapes). All host
// callbacks arrive on reader threads; the class is internally serialised and the
// caller receives already-shaped contract JSON.
class Session {
public:
    struct ServerConfig {
        std::wstring command;
        std::vector<std::wstring> arguments;
        std::filesystem::path working_directory;
        Json settings = Json::object();
        Json initialization_options = Json::object();
    };
    // Diagnostics ready for the UI: workspace-relative path + contract-shaped array.
    using DiagnosticsSink = std::function<void(std::string path, Json diagnostics)>;
    // Contract-shaped result or a JSON-RPC error object.
    using ResultHandler = std::function<void(Json result, Json error)>;
    // Fired after the session itself wrote a file (a server-driven workspace edit),
    // so the host can tell the editor to reload it. Optional: with no sink the file
    // is still written.
    using EditSink = std::function<void(std::string path)>;
    // 语言服务发来的 `$/progress`（begin/report/end），已经整形成可以直接发给界面的事件。
    // 上游把这类通知变成一条带百分比的后台任务：LspServerNotificationsHandlerImpl.kt:257-328。
    using ProgressSink = std::function<void(Json payload)>;

    explicit Session(DiagnosticsSink on_diagnostics) : on_diagnostics_(std::move(on_diagnostics)) {}
    ~Session();
    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;

    void configure(std::map<std::string, ServerConfig> servers) { config_ = std::move(servers); }
    void set_root(std::filesystem::path root);
    // 弃养这一代（语言服务线程卡死、Session 进弃养表）时，按它收掉这一代起的服务器进程。
    long generation() const noexcept { return generation_; }
    void set_edit_sink(EditSink on_edit) { on_edit_ = std::move(on_edit); }
    void set_progress_sink(ProgressSink on_progress) { on_progress_ = std::move(on_progress); }

    // 语言服务线程的投递入口（宿主建好 Session 后设置）。读线程上的回调**只记录状态**，
    // 真正的发送交回那条线程：回调一旦抱着 `Session::mutex_` 去写服务器，就会和"在
    // `io_mutex_` 里做阻塞 WriteFile"的调用方互相咬死锁序（2026-09-28 实测：窗口整片"未响应"）。
    void set_owner_post(std::function<void(std::function<void()>)> post) { owner_post_ = std::move(post); }
    // How long a request may stay unanswered before it is failed with TIMEOUT.
    // Applies to every server already running and to any server started later.
    void set_timeout(std::chrono::milliseconds timeout);

    static std::string language_for(const std::string& path);
    bool has_server(const std::string& language) const { return config_.count(language) != 0; }

    Json open(const std::string& path, const std::string& text);  // -> { running, ready, configured, language, error? }
    Json status(const std::string& path);
    // 把该语言下已登记但还没同步给服务器的文档补发 didOpen（只在语言服务线程上调）。
    void change(const std::string& path, const std::string& text);
    void flush_opens(const std::string& language);
    // 读线程兜底路径：调用方**已持有** `mutex_`（没有宿主线程可交活儿时的老行为）。
    void flush_opens_here(const std::string& language);
    void close(const std::string& path);
    void request(const std::string& kind, const std::string& path, int line, int character, ResultHandler on_result);
    // Refactor, symbol and coding-assistance queries delivered through the same
    // async callback shape as request().
    // kind: "rename" | "references" | "documentSymbol" | "workspaceSymbol" |
    //       "signatureHelp" | "codeAction" | "codeActionResolve" |
    //       "formatting" | "rangeFormatting" |
    //       "implementation" | "typeDefinition" | "documentHighlight" |
    //       "prepareCallHierarchy" | "callHierarchyIncoming" | "callHierarchyOutgoing" |
    //       "prepareTypeHierarchy" | "typeHierarchySupertypes" | "typeHierarchySubtypes".
    // args (all optional, only the keys named for that kind are read):
    //   rename -> {"newName": string}
    //   workspaceSymbol -> {"query": string}
    //   signatureHelp -> {"triggerKind": 1|2|3}   (default 1)
    //   codeAction -> {"range": LspRange, "diagnostics": LspDiagnostic[]}
    //   codeActionResolve -> {"index": int}   the action from the last codeAction
    //       answered for this path; an action that already carries its edit is
    //       returned without a round trip, otherwise codeAction/resolve is sent.
    //   callHierarchy* / typeHierarchy* -> {"item": object}   the shaped entry (or raw
    //       item) that the matching prepare request returned, echoed back untouched as
    //       the protocol requires.
    //   rangeFormatting -> {"range": LspRange, "tabSize": int, "insertSpaces": bool}
    //   formatting -> {"tabSize": int, "insertSpaces": bool}   (default 4 / true)
    // where LspRange is {"start":{"line":n,"character":n},"end":{...}} in LSP
    // 0-based coordinates; a missing range degenerates to a zero-width one at
    // (line, character). Every other kind ignores args.
    // Line/character are LSP-native (0-based) and every path in the result is
    // workspace-relative with '/' separators.
    void semantic(const std::string& kind, const std::string& path, int line, int character, const Json& args,
                  ResultHandler on_result);
    void shutdown_all() noexcept;
    void set_configuration(const std::string& language, Json settings);

    // 文件操作通知（LSP `workspace/{didCreateFiles, didRenameFiles, didDeleteFiles}`）。
    // 对应 IDEA 的 `RefactoringEventListener` + VFS 事件：不发这些，服务器索引会与磁盘
    // 不一致 —— 用户在 IDE 的文件树里改名/删文件后，服务器仍按旧路径解析。
    // 每条通知只发给**声明了**对应能力的服务器（`workspace.fileOperations.*`），
    // 声明与实发保持一致。
    struct FileOperation {
        std::string path;      // 工作区相对路径，'/' 分隔；创建/删除用它，改名时是新路径
        std::string previous;  // 改名时的旧路径，其余为空
    };
    // kind: "created" | "renamed" | "deleted"
    void announce_file_operations(const std::string& kind, const std::vector<FileOperation>& files);
    // 取消一条语言服务自己报上来的进度（`window/workDoneProgress/cancel`）。
    // 与下面那条 reset 一起住在 native/lsp_session_progress.cpp（本文件贴着机检上限）。
    void cancel_progress(const std::string& language, const std::string& token);
    // 停机：把这一批服务器上在跑的进度整条收掉（界面不能再等一个不会来的 `end`）。
    // 带语言参数的一条用在"只换掉一台服务器"的地方（initialize 失败后重试）。
    void announce_progress_reset();
    void announce_progress_reset(const std::string& language);

private:
    struct Document {
        std::string language;
        std::string uri;
        std::string text;
        int version = 0;
        bool opened = false;
    };
    Host& ensure(const std::string& language);           // caller holds mutex_
    Json language_status(const std::string& language) const;  // caller holds mutex_
    std::string to_uri(const std::string& path) const;    // workspace-relative -> file://
    std::string to_path(const std::string& uri) const;    // file:// -> workspace-relative
    static Json text_document(const std::string& uri) { return {{"uri", uri}}; }
    // `workspace/applyEdit`: splices one document's TextEdit[] (already ordered
    // back-to-front) into the file and writes it through the workspace layer.
    // Returns std::nullopt on success, a reason on failure.
    std::optional<std::string> apply_document_edits(const std::string& uri, const Json& edits, int version);
    // The workspace handle behind those writes, opened lazily for the current root.
    std::shared_ptr<Workspace> editor_workspace(const std::filesystem::path& root);
    // An error when the server explicitly declined the provider `kind` needs.
    // `renameProvider.prepareProvider` 与 `completionProvider.resolveProvider` 都是**嵌套**能力，单独判一次。
    bool prepare_rename_supported(const std::string& language) const;
    bool completion_resolve_supported(const std::string& language) const;
    // `semanticTokensProvider.requests.full.delta` 是**三层嵌套**能力
    // （provider -> requests -> full -> delta），也不在 `provider_for()` 的顶层表里。
    // 没声明就只能整份重取 —— 发 `/full/delta` 会给服务器一个它没承诺支持的请求。
    bool semantic_delta_supported(const std::string& language) const;
    // 服务端 `semanticTokensProvider.legend`：`data` 里的 tokenType/tokenModifiers 索引就是
    // 按**这张表**编的，不是按客户端 `initialize` 声明的那张（两者顺序可以不同，混用会整份错位）。
    Json semantic_legend(const std::string& language) const;
    // `diagnosticProvider.workspaceDiagnostics`：整工程拉取（LSP `workspace/diagnostic`）的
    // 前置条件。`textDocument/diagnostic` **不需要**它 —— 两者共用一个 provider，
    // 用的却是 provider 里不同的字段，所以必须分开判。
    bool workspace_diagnostic_supported(const std::string& language) const;
    // `workspace.fileOperations.<which>` 是三层嵌套能力（`workspace.fileOperations.didRename`），
    // 不在 `provider_for()` 的顶层表里，所以单独判。which: "didCreate"|"didRename"|"didDelete"|"willRename".
    bool file_operation_supported(const std::string& language, const char* which) const;
    std::optional<Json> unsupported(const std::string& language, const std::string& kind) const;  // caller holds mutex_
    // `textDocument/codeAction` / `codeAction/resolve` / `workspace/executeCommand` 这一族
    // （IDEA 的 QuickFixAction -> CommandProcessor）。定义在 lsp_code_actions.cpp：它自成一条
    // 职责，且是 `pending_actions_` 唯一的读写方。返回 true 表示 kind 已被本方法处理。
    // `on_result` 按左值引用收：kind 不属于这一族时要把它原样交还，按值收会让
    // semantic() 后面的分支拿到一个空处理器（std::bad_function_call）。
    bool dispatch_code_action(const std::string& kind, const std::string& path, Host& host, const std::string& uri,
                              const Json& args, int line, int character, ResultHandler& on_result);
    // `pending_actions_[path]` 的第 `index` 条原始 CodeAction。false = 这次引用已过期
    // （重新请求过、换了文件或越界），调用方必须报 STALE_ACTION 而不是接着用。caller holds mutex_。
    bool stored_action(const std::string& path, int index, Json& out) const;

    std::mutex mutex_;
    std::mutex edit_mutex_;                               // guards editor_ / on_edit_ (leaf lock)
    // 这一代会话的代号：它起的每台服务器都按这个号登记，弃养这一代时按号收进程
    // （见 lsp_children.hpp —— 弃养的 Session 析构不会跑，Host 手里那个作业对象也就没人关）。
    long generation_ = children::next_generation();
    std::map<std::string, std::unique_ptr<Host>> hosts_;   // by language
    std::map<std::string, bool> ready_;                    // language -> initialize handshake done
    std::map<std::string, Json> startup_errors_;           // preserve spawn/initialize failures for the UI
    std::map<std::string, Json> capabilities_;             // language -> ServerCapabilities
    std::map<std::string, ServerConfig> config_;
    std::map<std::string, Document> documents_;            // by workspace-relative path
    std::map<std::string, Json> pending_actions_;          // path -> last raw CodeAction[]
    std::filesystem::path root_;
    DiagnosticsSink on_diagnostics_;
    EditSink on_edit_;
    ProgressSink on_progress_;
    std::function<void(std::function<void()>)> owner_post_;
    std::shared_ptr<Workspace> editor_;                   // lazily opened for root_
    std::filesystem::path editor_root_;
    std::chrono::milliseconds timeout_ = default_request_timeout;
};

/** file:// URI -> 工作区相对路径（`Session::to_path` 与服务器启动期的回调共用）。 */
std::string uri_to_relative(const std::string& uri, const std::filesystem::path& root);

// `lsp.request` 的两段纯整形：入参整体转发、回参统一包壳。它们既不属于宿主也不属于某个 kind，
// 所以放在 LSP 层 —— 宿主只管路由与投递，形状由 LSP 侧定义（这两段曾长期待在 main.cpp 里）。
Json forward_arguments(const Json& params);
Json lsp_reply_payload(const Json& id, Json response, Json error);

}  // namespace lsp
}  // namespace taocode
