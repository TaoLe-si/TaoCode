#include "lsp_session.hpp"

#include "lsp_support.hpp"

using namespace taocode::lsp::detail;

#include <memory>

namespace taocode {
namespace lsp {

bool Session::dispatch_navigation(const std::string& kind, const std::string& uri, Host& host, const Json& position,
                                  ResultHandler& on_result) {
    if (kind != "definition" && kind != "declaration") return false;

        // 「转到声明」（IDEA 的 Ctrl+B = GotoDeclaration）：先发 `textDocument/declaration`，
        // 拿不到位置再退到 `textDocument/definition` —— VS Code 的 Java 客户端就是这条退化链，
        // 而 JDT 对**库里**的类型在 definition 上不给位置（真机三个探针：import 行与字段初始化都空、
        // 本地类名有位置 ⇒ 链路本身是通的）。
        auto shared = std::make_shared<ResultHandler>(std::move(on_result));
        const auto collect = [this, shared](Json result, Json error) {
            if (!error.is_null()) { (*shared)(Json(nullptr), std::move(error)); return; }
            Json locations = Json::array();
            const auto add = [this, &locations](const Json& item) {
                if (!item.is_object()) return;
                std::string target_uri;
                const Json* range = nullptr;
                if (item.contains("uri") && item.at("uri").is_string()) {
                    target_uri = item.at("uri").get<std::string>();
                    if (item.contains("range") && item.at("range").is_object()) range = &item.at("range");
                } else if (item.contains("targetUri") && item.at("targetUri").is_string()) {
                    target_uri = item.at("targetUri").get<std::string>();
                    if (item.contains("targetSelectionRange") && item.at("targetSelectionRange").is_object())
                        range = &item.at("targetSelectionRange");
                }
                if (target_uri.empty() || !range || !range->contains("start")) return;
                const auto start = range_corner(*range, "start");
                locations.push_back({{"path", to_path(target_uri)}, {"line", int_at(start, "line")}, {"character", int_at(start, "character")}});
            };
            if (result.is_array()) for (const auto& item : result) add(item);
            else if (result.is_object() && (result.contains("uri") || result.contains("targetUri"))) add(result);
            if (locations.empty()) (*shared)({{"available", false}}, Json(nullptr));
            else (*shared)({{"available", true}, {"locations", std::move(locations)}}, Json(nullptr));
        };
        const auto target = Json{{"textDocument", text_document(uri)}, {"position", position}};
        Host* host_ptr = &host;
        host.request("textDocument/declaration", target, [collect, host_ptr, target](Json result, Json error) {
            // 退化条件是"声明这条没给出位置"：**包括服务器压根不认这个请求**（-32601）与
            // 其它错误 —— definition 是基准，declaration 只是优先项（JDT 认它，假服务器不认）。
            const bool empty = (!error.is_null() && error.value("code", 0) == -32601) ||
                               (error.is_null() && (!result.is_array() || result.empty()));
            if (!empty) { collect(std::move(result), std::move(error)); return; }
            host_ptr->request("textDocument/definition", target, collect);
        });
    return true;
}

}  // namespace lsp
}  // namespace taocode
