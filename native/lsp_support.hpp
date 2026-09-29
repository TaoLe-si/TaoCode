// LSP 会话用到的**工具与整形**（原 `lsp_session.cpp` 里的一个匿名 namespace，537 行）。
//
// 拆出来的原因：`lsp_session.cpp` 涨到 1973 行，被 `tests/module-size.test.mjs` 的 native 上限
// （1950）拦下 —— 而"上限只能靠拆一次来下调"是那个检查的规则，所以拆，不抬数字。
//
// 这里面的东西都是**纯工具**（Json 取值/整形、路径与 uri 互转、文本编辑应用），没有任何状态。
// 模板函数（`action_entries` 那几个，接收 `to_path` 回调）按 C++ 的规矩必须定义在头文件里，
// 其余函数的定义在 `lsp_support.cpp`。
// **顺序有要求**：普通函数的声明必须排在模板定义**之前** —— 模板定义在本头文件里，
// 它用到的 `text_edits`/`range_corner`/`string_at` 得先被声明（第一次拆出来时就踩了这个）。
#pragma once

#include "lsp.hpp"

#include <filesystem>
#include <string>
#include <utility>

namespace taocode {
namespace lsp {
namespace detail {

std::string lower(std::string value);
std::string extension_of(const std::string& path);
std::string percent_encode(const std::string& bytes);
std::string percent_decode(const std::string& value);
std::string u8_path(const std::filesystem::path& path);
const char* completion_kind(unsigned number);
Json hover_text(const Json& contents);
Json range_corner(const Json& range, const char* corner);
int int_at(const Json& object, const char* key);
bool bool_at(const Json& object, const char* key, bool fallback);
int int_or(const Json& object, const char* key, int fallback);
std::string string_at(const Json& object, const char* key);
Json text_edits(const Json& array);
Json shape_diagnostics(const Json& array);
void collect_symbols(const Json& nodes, Json& out);
Json invalid(const std::string& code, const std::string& message);
Json file_operation_filters();
const char* provider_for(const std::string& kind);
bool escapes_root(const std::string& relative);
std::size_t offset_of(const std::string& text, int line, int character);
bool has_command(const Json& item);
std::string parameter_label(const Json& signature, const Json& parameter);
Json signature_shape(const Json& result);
Json highlight_shape(const Json& result);
Json format_shape(const Json& result, std::string path);
Json argument_range(const Json& args, int line, int character);
Json argument_diagnostics(const Json& args);
Json format_options(const Json& args);

template <class ToPath>
Json edit_groups(const Json& result, ToPath&& to_path) {
    Json groups = Json::array();
    const auto add = [&groups, &to_path](const std::string& target, const Json& edits) {
        auto text = text_edits(edits);
        if (target.empty() || text.empty()) return;
        groups.push_back({{"path", to_path(target)}, {"textEdits", std::move(text)}});
    };
    if (result.is_object()) {
        // WorkspaceEdit.changes: uri -> TextEdit[].
        if (result.contains("changes") && result.at("changes").is_object())
            for (const auto& entry : result.at("changes").items())
                add(entry.key(), entry.value());
        // ... or the anchored documentChanges form (TextDocumentEdit only;
        // create/rename/delete file operations carry no edits to apply).
        for (const char* key : {"documentChanges", "documentedChanges"}) {
            if (!result.contains(key) || !result.at(key).is_array()) continue;
            for (const auto& change : result.at(key)) {
                if (!change.is_object() || !change.contains("edits")) continue;
                const auto document = change.contains("textDocument") && change.at("textDocument").is_object()
                                          ? change.at("textDocument").value("uri", std::string()) : std::string();
                add(document, change.at("edits"));
            }
        }
    }
    return groups;
}

template <class ToPath>
Json ref_entries(const Json& result, ToPath&& to_path) {
    Json refs = Json::array();
    const Json single = result.is_object() ? Json::array({result}) : Json::array();
    const Json& items = result.is_array() ? result : single;  // no copy on the common path
    for (const auto& item : items) {
        if (!item.is_object()) continue;
        std::string target;
        const Json* span = nullptr;
        const auto link = [&item](const char* uri_key, const char* range_key) {
            return item.contains(uri_key) && item.at(uri_key).is_string() && item.contains(range_key) &&
                   item.at(range_key).is_object();
        };
        if (link("uri", "range")) { target = item.at("uri").get<std::string>(); span = &item.at("range"); }
        else if (link("targetUri", "targetSelectionRange")) {
            target = item.at("targetUri").get<std::string>(); span = &item.at("targetSelectionRange");
        }
        if (target.empty() || !span || !span->is_object()) continue;
        refs.push_back({{"path", to_path(target)}, {"line", int_at(range_corner(*span, "start"), "line")},
                        {"character", int_at(range_corner(*span, "start"), "character")}});
    }
    return refs;
}

template <class ToPath>
Json hier_item(const Json& item, ToPath&& to_path, bool with_raw) {
    if (!item.is_object()) return Json(nullptr);
    const auto name = string_at(item, "name");
    if (name.empty()) return Json(nullptr);
    Json shaped{{"name", name}, {"kind", int_or(item, "kind", 0)}};
    if (item.contains("uri") && item.at("uri").is_string()) shaped["path"] = to_path(item.at("uri").get<std::string>());
    const auto detail = string_at(item, "detail");
    if (!detail.empty()) shaped["detail"] = detail;
    if (item.contains("selectionRange") && item.at("selectionRange").is_object()) {
        const auto& span = item.at("selectionRange");
        shaped["line"] = int_at(range_corner(span, "start"), "line");
        shaped["character"] = int_at(range_corner(span, "start"), "character");
    }
    if (with_raw) shaped["raw"] = item;
    return shaped;
}

template <class ToPath>
Json hier_items(const Json& result, ToPath&& to_path) {
    Json items = Json::array();
    const Json single = result.is_object() ? Json::array({result}) : Json::array();
    for (const auto& item : (result.is_array() ? result : single)) {
        auto shaped = hier_item(item, to_path, true);
        if (!shaped.is_null()) items.push_back(std::move(shaped));
    }
    return items;
}

template <class ToPath>
Json call_entries(const Json& result, ToPath&& to_path, const char* item_key) {
    Json calls = Json::array();
    if (!result.is_array()) return calls;
    for (const auto& entry : result) {
        if (!entry.is_object() || !entry.contains(item_key)) continue;
        auto shaped = hier_item(entry.at(item_key), to_path, true);
        if (shaped.is_null()) continue;
        if (entry.contains("fromRanges") && entry.at("fromRanges").is_array() && !entry.at("fromRanges").empty() &&
            entry.at("fromRanges").front().is_object()) {
            const auto& span = entry.at("fromRanges").front();
            shaped["callLine"] = int_at(range_corner(span, "start"), "line");
            shaped["callChar"] = int_at(range_corner(span, "start"), "character");
        }
        calls.push_back(std::move(shaped));
    }
    return calls;
}

template <class ToPath>
Json action_entries(const Json& result, ToPath&& to_path, Json* raw_out = nullptr) {
    Json actions = Json::array();
    if (!result.is_array()) return actions;
    for (const auto& item : result) {
        if (!item.is_object()) continue;
        const auto title = string_at(item, "title");
        if (title.empty()) continue;
        const bool has_edit = item.contains("edit");
        Json action{{"title", title},
                    {"index", static_cast<int>(actions.size())},
                    {"edits", has_edit ? edit_groups(item.at("edit"), to_path) : Json::array()}};
        if (item.contains("kind") && item.at("kind").is_string()) action["kind"] = item.at("kind");
        // The UI distinguishes IDEA's "quick fix" actions from intentions by what the
        // server itself declares: isPreferred, or a diagnostics backlink.
        if (item.contains("isPreferred") && item.at("isPreferred").is_boolean())
            action["preferred"] = item.at("isPreferred");
        if (item.contains("diagnostics") && item.at("diagnostics").is_array() && !item.at("diagnostics").empty())
            action["linkedDiagnostics"] = true;
        // Resolve can only fill an action the server left unfinished, and it needs
        // something to act on (a command and/or server-supplied `data`).
        action["resolvable"] = !has_edit && (item.contains("command") || item.contains("data"));
        // A CodeAction that carries a non-empty Command is executable on the server
        // through workspace/executeCommand (IDEA: QuickFixAction -> CommandProcessor).
        // The UI needs to know BEFORE it offers the action, otherwise an action with
        // no edit looks like "nothing to apply" instead of "the server will do it".
        if (has_command(item)) action["command"] = true;
        if (raw_out) raw_out->push_back(item);
        actions.push_back(std::move(action));
    }
    return actions;
}

}  // namespace detail
}  // namespace lsp
}  // namespace taocode
