// 假 LSP 服务器的主循环、通知处理与命令行开关。
// helper/状态见 lsp_fake_server_support.cpp，请求分派见 lsp_fake_server_requests.cpp ——
// 三者按职责分开（原来挤在一个 762 行的文件里，改一处误删过一大段）。
#include "lsp_fake_server.hpp"

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
using namespace fake_server;

namespace {
// 真正往 stdout 写一帧（请求处理那边通过 write_message 走 set_sender 注入的这条路）。
void write_frame(const Json& message) {
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
}  // namespace

int main(int argc, char** argv) {
    const std::vector<std::string> switches(argv + 1, argv + argc);
    // 开关收进一个结构体：能力声明与同步模式都读它。
    Flags flags;
    flags.incremental = std::find(switches.begin(), switches.end(), std::string("--incremental")) != switches.end();
    flags.no_selection_range =
        std::find(switches.begin(), switches.end(), std::string("--no-selection-range")) != switches.end();
    // 同理：关掉 foldingRangeProvider，用来验证客户端的"服务器没这个能力就不发请求"。
    flags.no_folding_range =
        std::find(switches.begin(), switches.end(), std::string("--no-folding-range")) != switches.end();
    // 关掉 completionProvider.resolveProvider：验证客户端不会把 resolve 发给不支持的服务器。
    flags.no_resolve =
        std::find(switches.begin(), switches.end(), std::string("--no-resolve")) != switches.end();
    // 关掉 pull 诊断能力：客户端应当退回推送模型（既有的 publishDiagnostics 路径）。
    flags.no_pull_diagnostics =
        std::find(switches.begin(), switches.end(), std::string("--no-pull-diagnostics")) != switches.end();
    // 把 executeCommandProvider 声明成 false：客户端应当在本地就拒绝 executeCommand，
    // 报 LSP_UNSUPPORTED，而不是发出去等服务器报错。
    flags.no_execute_command =
        std::find(switches.begin(), switches.end(), std::string("--no-execute-command")) != switches.end();
    // 不声明 semanticTokensProvider（或声明成 false）：客户端不该发 semanticTokens 请求。
    flags.no_semantic_tokens =
        std::find(switches.begin(), switches.end(), std::string("--no-semantic-tokens")) != switches.end();
    // 声明 diagnosticProvider 只支持单文件（`workspaceDiagnostics: false`）：
    // 客户端就该拒发 `workspace/diagnostic`。
    flags.no_workspace_diagnostics =
        std::find(switches.begin(), switches.end(), std::string("--no-workspace-diagnostics")) != switches.end();
    // 关掉 monikerProvider：客户端不该发 moniker 请求。
    const bool no_moniker =
        std::find(switches.begin(), switches.end(), std::string("--no-moniker")) != switches.end();
    // 关掉 codeLensProvider：客户端不该发 codeLens 请求。
    flags.no_moniker =
        std::find(switches.begin(), switches.end(), std::string("--no-moniker")) != switches.end();
    flags.no_code_lens =
        std::find(switches.begin(), switches.end(), std::string("--no-code-lens")) != switches.end();
    // 关掉 inlineCompletionProvider：客户端不该发行内补全请求。
    flags.no_inline_completion =
        std::find(switches.begin(), switches.end(), std::string("--no-inline-completion")) != switches.end();
    // documentLinkProvider 声明成 false：客户端不该发 documentLink 请求。
    flags.no_document_link =
        std::find(switches.begin(), switches.end(), std::string("--no-document-link")) != switches.end();
    // 声明 semanticTokensProvider 但 `requests.full.delta = false`：客户端只能整份重取，
    // 即使它手上有一个 resultId 也不该发 `/full/delta`。
    flags.no_semantic_delta =
        std::find(switches.begin(), switches.end(), std::string("--no-semantic-delta")) != switches.end();
    // 不声明 workspace.fileOperations：客户端就不该发 did*/willRename 文件操作通知。
    flags.no_file_operations =
        std::find(switches.begin(), switches.end(), std::string("--no-file-operations")) != switches.end();
    // --hang=<method>: that method is accepted and never answered, so the client's
    // request deadline is the only thing that can end the wait.
    for (const auto& option : switches)
        if (option.rfind("--hang=", 0) == 0) flags.hang = option.substr(7);
    for (const auto& option : switches)
        if (option.rfind("--stall-stdin=", 0) == 0) flags.stall_stdin_ms = std::atoi(option.c_str() + 14);
    // 把真正的 stdio 写入注入给请求处理那边（它只管构造消息，见 lsp_fake_server.hpp）。
    // **漏了这一行服务器的请求就全部石沉大海** —— 编译期看不出来，只有跑起来才发现
    // （拆这个文件时真的漏过一次，lsp_host_test 立刻红了）。
    set_sender(write_frame);
    MessageReader reader;
    std::vector<char> buffer(16384);
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
                    // 一条 `$/progress`（begin → report(40%) → end）：真实服务器在建索引/导工程时
                    // 就是这个形状，客户端必须把它转出去而不是丢弃（见 lsp.cpp 的通知分支）。
                    write_frame(Json{{"jsonrpc", "2.0"}, {"method", "$/progress"},
                                     {"params", {{"token", "fake-index"}, {"value", {{"kind", "begin"},
                                                                                      {"title", "Indexing"},
                                                                                      {"cancellable", false}}}}}});
                    write_frame(Json{{"jsonrpc", "2.0"}, {"method", "$/progress"},
                                     {"params", {{"token", "fake-index"}, {"value", {{"kind", "report"},
                                                                                      {"message", "12 of 30 files"},
                                                                                      {"percentage", 40}}}}}});
                    write_frame(Json{{"jsonrpc", "2.0"}, {"method", "$/progress"},
                                     {"params", {{"token", "fake-index"}, {"value", {{"kind", "end"},
                                                                                      {"message", "done"}}}}}});
                    // 工程级的一条消息（`window/showMessage`，type=2 警告）：真实 jdt.ls 用它报
                    // "Gradle 导入失败"那类问题，客户端必须转出去而不是丢掉。
                    write_frame(Json{{"jsonrpc", "2.0"}, {"method", "window/showMessage"},
                                     {"params", {{"type", 2}, {"message", "fake import failure"}}}});
                    write_frame(Json{{"jsonrpc", "2.0"}, {"method", "textDocument/publishDiagnostics"}, {"params",
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
                        else if (!flags.incremental)
                            document_text = change.value("text", std::string());
                        // In incremental mode a bare {text} change is not a valid
                        // Incremental sync, so it is dropped: a client that promised
                        // ranges but sent the whole document shows up as stale text
                        // in the completion answer instead of passing silently.
                    }
                } else if (notification == "textDocument/didClose") {
                    document_text.clear();
                } else if (notification == "workspace/didCreateFiles" || notification == "workspace/didRenameFiles" ||
                           notification == "workspace/didDeleteFiles") {
                    // A notification carries no reply, so the only way a test can observe
                    // one without contorting the protocol is to have the server publish
                    // what it received. Each file operation becomes one diagnostic on the
                    // document it names, with the method and both uris in the message.
                    const Json files = params.contains("files") && params.at("files").is_array()
                                           ? params.at("files") : Json::array();
                    for (const auto& file : files) {
                        if (!file.is_object()) continue;
                        const auto new_uri = file.value("newUri", std::string());
                        const auto old_uri = file.value("oldUri", std::string());
                        const auto uri = new_uri.empty() ? file.value("uri", std::string()) : new_uri;
                        if (uri.empty()) continue;
                        const auto recorded = old_uri.empty() ? notification + " " + uri
                                                              : notification + " " + old_uri + " -> " + uri;
                        write_frame({{"jsonrpc", "2.0"}, {"method", "textDocument/publishDiagnostics"},
                                       {"params", {{"uri", uri}, {"diagnostics", Json::array({
                                           {{"range", range(0, 0, 0, 1)}, {"severity", 3}, {"message", recorded}}})}}}});
                    }
                }
                continue;
            }
            const auto method = inbound.at("method").get<std::string>();
            // `--hang=<method>`：收到这个请求就永不回答，用来测客户端的超时。
            if (!flags.hang.empty() && method == flags.hang) continue;
            const auto id = inbound.at("id");
            const Json params = inbound.contains("params") && inbound.at("params").is_object()
                                    ? inbound.at("params") : Json::object();
            handle_request(flags, method, params, id);
            // 答完 initialize 就"去忙了"：不读 stdin（真实 jdtls 导入大工程时就是这样）。
            // 客户端这期间发来的帧会把管道写满 —— 只有把写放到自己的线程上，调用方才不会被堵住。
            if (method == "initialize" && flags.stall_stdin_ms > 0) Sleep(static_cast<DWORD>(flags.stall_stdin_ms));
        }
    }
    return 0;
}
