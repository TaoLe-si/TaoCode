// LSP 会话的**能力查询**与少量设置 —— 从 `lsp_session.cpp` 搬出来的。
//
// 这些成员函数只读 `capabilities_`（或只改几个字段），与 `semantic()` 那条巨大的分派链
// 没有关系。搬走的直接原因：`lsp_session.cpp` 涨到 1472 行，被 `tests/module-size.test.mjs`
// 的 native 上限（1440）拦下 —— 而"上限只能靠拆一次来下调"是那个检查的规则，所以拆，不抬数字。
#include "lsp_session.hpp"
#include "request_trace.hpp"

#include "lsp_host.hpp"
// `provider_for` / `invalid` 在工具层（原 lsp_session.cpp 的匿名 namespace，现 lsp_support.*）——
// 它们落在 `detail` 命名空间里，所以这里要把它引进来（lsp_session.cpp 同样这么做）。
#include "lsp_support.hpp"

using namespace taocode::lsp::detail;

#include <chrono>
#include <filesystem>
#include <mutex>
#include <utility>
#include <vector>

namespace taocode {
namespace lsp {

bool Session::completion_resolve_supported(const std::string& language) const {
    const auto capabilities = capabilities_.find(language);
    if (capabilities == capabilities_.end() || !capabilities->second.is_object()) return false;
    const auto provider = capabilities->second.find("completionProvider");
    if (provider == capabilities->second.end() || !provider->is_object()) return false;
    const auto flag = provider->find("resolveProvider");
    return flag != provider->end() && flag->is_boolean() && flag->get<bool>();
}

bool Session::file_operation_supported(const std::string& language, const char* which) const {
    const auto capabilities = capabilities_.find(language);
    if (capabilities == capabilities_.end() || !capabilities->second.is_object()) return false;
    const auto workspace = capabilities->second.find("workspace");
    if (workspace == capabilities->second.end() || !workspace->is_object()) return false;
    const auto operations = workspace->find("fileOperations");
    if (operations == workspace->end() || !operations->is_object()) return false;
    const auto operation = operations->find(which);
    if (operation == operations->end()) return false;
    // `null` is how a server says "no" for a capability it chose to mention at all;
    // anything object-shaped (the FileOperationRegistrationOptions) means yes.
    return operation->is_object();
}

// `semanticTokensProvider.requests.full.delta`：三层嵌套，缺任何一层都算不支持。
// `semanticTokensProvider` 本身可以是 `true`（只有整份 full）—— 那时按定义没有 delta。
bool Session::workspace_diagnostic_supported(const std::string& language) const {
    const auto capabilities = capabilities_.find(language);
    if (capabilities == capabilities_.end() || !capabilities->second.is_object()) return false;
    const auto provider = capabilities->second.find("diagnosticProvider");
    if (provider == capabilities->second.end() || !provider->is_object()) return false;
    const auto flag = provider->find("workspaceDiagnostics");
    return flag != provider->end() && flag->is_boolean() && flag->get<bool>();
}

bool Session::semantic_delta_supported(const std::string& language) const {
    const auto capabilities = capabilities_.find(language);
    if (capabilities == capabilities_.end() || !capabilities->second.is_object()) return false;
    const auto provider = capabilities->second.find("semanticTokensProvider");
    if (provider == capabilities->second.end() || !provider->is_object()) return false;
    const auto requests = provider->find("requests");
    if (requests == provider->end() || !requests->is_object()) return false;
    const auto full = requests->find("full");
    if (full == requests->end() || !full->is_object()) return false;
    const auto delta = full->find("delta");
    return delta != full->end() && delta->is_boolean() && delta->get<bool>();
}

// LSP 的 `data` 用**服务器自己的 legend**（`semanticTokensProvider.legend`）索引 tokenType /
// tokenModifiers。客户端 `initialize` 声明的那张表只说明"我认这些名字"，不等于服务器用的顺序 ——
// 拿客户端的顺序去解服务器的索引，会把 `declaration` 解成 `deprecated` 之类，整份着色错位
// （实测表现：`Main`/`main`/`args` 凭空画出删除线）。所以这里把**服务端的 legend 原样带出去**，
// 由前端按它解码。
Json Session::semantic_legend(const std::string& language) const {
    const auto capabilities = capabilities_.find(language);
    if (capabilities == capabilities_.end() || !capabilities->second.is_object()) return Json(nullptr);
    const auto provider = capabilities->second.find("semanticTokensProvider");
    if (provider == capabilities->second.end() || !provider->is_object()) return Json(nullptr);
    const auto legend = provider->find("legend");
    return legend != provider->end() && legend->is_object() ? *legend : Json(nullptr);
}

bool Session::prepare_rename_supported(const std::string& language) const {
    const auto capabilities = capabilities_.find(language);
    if (capabilities == capabilities_.end() || !capabilities->second.is_object()) return false;
    const auto provider = capabilities->second.find("renameProvider");
    if (provider == capabilities->second.end() || !provider->is_object()) return false;
    const auto flag = provider->find("prepareProvider");
    return flag != provider->end() && flag->is_boolean() && flag->get<bool>();
}

std::optional<Json> Session::unsupported(const std::string& language, const std::string& kind) const {
    const char* provider = provider_for(kind);
    if (!provider) return std::nullopt;
    const auto capabilities = capabilities_.find(language);
    if (capabilities == capabilities_.end() || !capabilities->second.is_object()) return std::nullopt;
    const auto declared = capabilities->second.find(provider);
    if (declared == capabilities->second.end()) return std::nullopt;
    const bool refused = declared->is_boolean() ? declared->get<bool>() == false
                                                : declared->is_null();
    if (!refused) return std::nullopt;
    return invalid("LSP_UNSUPPORTED", std::string("the ") + language + " server does not support " + provider);
}

// Bounds every request a server fails to answer. Servers started later pick the
// value up in ensure(); the ones already running are updated here.

void Session::set_timeout(std::chrono::milliseconds timeout) {
    std::vector<Host*> live;
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        timeout_ = timeout;
        for (auto& entry : hosts_) live.push_back(entry.second.get());
    }
    for (auto* host : live) host->set_timeout(timeout);
}

void Session::set_root(std::filesystem::path root) {
    {
        taocode::trace::Lock lock(mutex_, __FUNCSIG__);
        root_ = std::move(root);
    }
    std::lock_guard edit(edit_mutex_);
    editor_.reset();  // any cached writer belongs to the previous root
    editor_root_.clear();
}

// "服务器起来了" 与 "服务器可用" 是两件事：`running` 只表示进程还活着，
// `ready` 才表示 initialize 握手成功（服务器收到过 initialized + didOpen）。
// 启动/初始化失败必须带出原因，否则 UI 只能把"Java 没有补全"显示成一片沉默。
Json Session::language_status(const std::string& language) const {
    const auto host = hosts_.find(language);
    const auto ready = ready_.find(language);
    const auto failed = startup_errors_.find(language);
    const bool alive = host != hosts_.end() && host->second->alive();
    Json result{{"running", alive && failed == startup_errors_.end()},
                {"ready", alive && failed == startup_errors_.end() && ready != ready_.end() && ready->second},
                {"configured", has_server(language)}, {"language", language}};
    if (failed != startup_errors_.end()) result["error"] = failed->second;
    else if (host != hosts_.end() && !alive)
        result["error"] = invalid("LSP_CLOSED", "语言服务器已退出，请检查启动命令、服务器运行 JDK 与服务器日志");
    return result;
}
Json forward_arguments(const Json& params) {
    // 参数**整体转发**（只摘掉路由用的四个键），不再手工维护「哪个 kind 读哪些键」的白名单。
    // 那份名单漏一个键（`newPath`、`command`、`previousResultId`、`raw`…）就是只在运行时才暴露的
    // 空功能，而且很难查 —— 各分支只读自己认识的键，多传一个键无害。
    Json arguments = Json::object();
    for (const auto& [key, value] : params.items())
        if (key != "kind" && key != "path" && key != "line" && key != "character") arguments[key] = value;
    return arguments;
}

Json lsp_reply_payload(const Json& id, Json response, Json error) {
    Json payload = {{"id", id}, {"ok", error.is_null()}};
    if (error.is_null()) payload["result"] = std::move(response);
    else payload["error"] = {{"code", "LSP_FAILED"},
        {"message", error.is_object() && error.contains("message") && error.at("message").is_string()
                    ? error.at("message").get<std::string>() : std::string("语言服务请求失败")}};
    return payload;
}


Json Session::status(const std::string& path) {
    taocode::trace::Lock lock(mutex_, __FUNCSIG__);
    return language_status(language_for(path));
}


}  // namespace lsp
}  // namespace taocode
