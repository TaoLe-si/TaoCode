#pragma once

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "lsp_host.hpp"

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

    explicit Session(DiagnosticsSink on_diagnostics) : on_diagnostics_(std::move(on_diagnostics)) {}
    ~Session();
    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;

    void configure(std::map<std::string, ServerConfig> servers) { config_ = std::move(servers); }
    void set_root(std::filesystem::path root) { root_ = std::move(root); }

    static std::string language_for(const std::string& path);
    bool has_server(const std::string& language) const { return config_.count(language) != 0; }

    Json open(const std::string& path, const std::string& text);  // -> { running, language }
    void change(const std::string& path, const std::string& text);
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

private:
    struct Document {
        std::string language;
        std::string uri;
        std::string text;
        int version = 0;
        bool opened = false;
    };
    Host& ensure(const std::string& language);           // caller holds mutex_
    std::string to_uri(const std::string& path) const;    // workspace-relative -> file://
    std::string to_path(const std::string& uri) const;    // file:// -> workspace-relative
    static Json text_document(const std::string& uri) { return {{"uri", uri}}; }

    std::mutex mutex_;
    std::map<std::string, std::unique_ptr<Host>> hosts_;   // by language
    std::map<std::string, bool> ready_;                    // language -> initialize handshake done
    std::map<std::string, ServerConfig> config_;
    std::map<std::string, Document> documents_;            // by workspace-relative path
    std::map<std::string, Json> pending_actions_;          // path -> last raw CodeAction[]
    std::filesystem::path root_;
    DiagnosticsSink on_diagnostics_;
};

}  // namespace lsp
}  // namespace taocode
