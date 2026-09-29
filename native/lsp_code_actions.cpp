// **代码操作与命令执行**这一族请求（`textDocument/codeAction`、`codeAction/resolve`、
// `workspace/executeCommand`）—— 从 `lsp_session.cpp` 的 `semantic()` 分派链里搬出来的。
//
// 为什么单独成文件：这三个 kind 是一条完整的职责（IDEA 的 QuickFixAction 交给
// CommandProcessor —— 编辑先应用，命令后跑），而且是 `pending_actions_` 这个状态的
// **唯一读写方**：codeAction 存下服务器原始对象，codeActionResolve 按 index 取回并回写，
// executeCommand 再从存下的对象里取出 command。把这条链和其余 40 来个互不相干的 kind
// 挤在一个 800 行的分派函数里，改一处就要读 800 行；而"上限只能靠拆一次来下调"
// 是 `tests/module-size.test.mjs` 的规则，所以拆，不抬数字。
//
// 门控（capabilities 判定、文档是否打开）仍然在 `semantic()` 里做完才转交过来，
// 所以这里拿到的 host 一定是这台服务器对这份文档的。
#include "lsp_session.hpp"
#include "request_trace.hpp"

// `action_entries` / `edit_groups` / `has_command` / `invalid` 在工具层（lsp_support.hpp）。
#include "lsp_support.hpp"

using namespace taocode::lsp::detail;

#include <cstddef>
#include <string>
#include <utility>

namespace taocode {
namespace lsp {

// 把 `pending_actions_[path]` 里的第 `index` 条取出来。false 表示这次引用已经过期
// （重新请求过 codeAction、换了文件、或 index 越界），调用方必须报 STALE_ACTION ——
// 拿着一个错的编辑改用户的代码，比明说"过期了"糟糕得多。
bool Session::stored_action(const std::string& path, int index, Json& out) const {
    const auto stored = pending_actions_.find(path);
    if (stored == pending_actions_.end() || !stored->second.is_array() || index < 0) return false;
    const auto position = static_cast<std::size_t>(index);
    if (position >= stored->second.size()) return false;
    out = stored->second[position];
    return true;
}

bool Session::dispatch_code_action(const std::string& kind, const std::string& path, Host& host, const std::string& uri,
                                   const Json& args, int line, int character, ResultHandler& on_result) {
    const auto relative = [this](const std::string& target) { return to_path(target); };
    if (kind == "codeAction") {
        host.request("textDocument/codeAction", {{"textDocument", text_document(uri)},
            {"range", argument_range(args, line, character)},
            {"context", {{"diagnostics", argument_diagnostics(args)}}}},
            [on_result = std::move(on_result), to_path = relative, this, path](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json raw = Json::array();
                const auto actions = action_entries(result, to_path, &raw);
                {
                    // Keep the untouched server objects so codeActionResolve can address
                    // one by the `index` the UI was given (untitled entries were dropped).
                    taocode::trace::Lock lock(mutex_, __FUNCSIG__);
                    pending_actions_[path] = std::move(raw);
                }
                if (actions.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"actions", std::move(actions)}}, Json(nullptr));
            });
        return true;
    }
    // Resolve a lazily-offered CodeAction: the server promised `edit` only on
    // request, so echo the stored object back and reshape whatever comes with it.
    if (kind == "codeActionResolve") {
        const auto index = int_or(args, "index", -1);
        Json action;
        bool stale = true;
        {
            taocode::trace::Lock lock(mutex_, __FUNCSIG__);
            stale = !stored_action(path, index, action);
        }
        // The callback runs OUTSIDE the lock on purpose: it hands control back to the
        // caller, which may immediately ask for another LSP request (and re-enter here).
        if (stale) {
            on_result(Json(nullptr), invalid("STALE_ACTION", "this code action is no longer available"));
            return true;
        }
        if (action.contains("edit")) {  // inline already: no round trip
            Json answer{{"available", true}, {"edits", edit_groups(action.at("edit"), relative)}};
            if (has_command(action)) answer["command"] = true;
            on_result(std::move(answer), Json(nullptr));
            return true;
        }
        host.request("codeAction/resolve", action,
            [on_result = std::move(on_result), to_path = relative, this, path, index](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                const auto edits = result.is_object() && result.contains("edit")
                                       ? edit_groups(result.at("edit"), to_path) : Json::array();
                const bool executable = has_command(result);
                if (result.is_object()) {
                    // The resolved action REPLACES the stored one: it carries the command
                    // and/or `data` the server expects back, so executing it later by
                    // `index` must send this object, not the unfinished original.
                    taocode::trace::Lock lock(mutex_, __FUNCSIG__);
                    const auto stored = pending_actions_.find(path);
                    if (stored != pending_actions_.end() && stored->second.is_array() && index >= 0 &&
                        static_cast<std::size_t>(index) < stored->second.size())
                        stored->second[static_cast<std::size_t>(index)] = result;
                }
                // LSP: an action may carry BOTH an edit and a command (the edit is applied
                // first, the command runs after). So "no edit" no longer means "nothing to
                // do" — an action that resolved into a command is still available.
                if (edits.empty() && !executable) { on_result({{"available", false}}, Json(nullptr)); return; }
                Json answer{{"available", true}, {"edits", std::move(edits)}};
                if (executable) answer["command"] = true;
                on_result(std::move(answer), Json(nullptr));
            });
        return true;
    }
    // WorkspaceCommands: run a server-side command. Two ways in — a bare command id
    // (a caller that already has one), or the `index` of a code action whose stored,
    // possibly already-resolved object carries the Command. IDEA's counterpart is
    // QuickFixAction handing over to CommandProcessor: the edits (if any) are applied
    // by the caller first, then the command runs, which is how servers implement
    // "add the import, then reindex".
    if (kind == "executeCommand") {
        Json command;
        if (args.contains("command")) {
            // A bare id with no arguments means "no arguments": LSP treats `arguments`
            // as optional, and sending an empty array is not the same thing.
            if (!args.at("command").is_string() || args.at("command").get<std::string>().empty()) {
                on_result(Json(nullptr), invalid("NO_COMMAND", "the command id is empty"));
                return true;
            }
            command = {{"command", args.at("command").get<std::string>()}};
            if (args.contains("arguments")) command["arguments"] = args.at("arguments");
        } else if (args.contains("index")) {
            Json action;
            bool stale = true;
            {
                taocode::trace::Lock lock(mutex_, __FUNCSIG__);
                stale = !stored_action(path, int_or(args, "index", -1), action);
            }
            if (stale) {
                on_result(Json(nullptr), invalid("STALE_ACTION", "this code action is no longer available"));
                return true;
            }
            if (!has_command(action)) {
                on_result(Json(nullptr), invalid("NO_COMMAND", "this code action carries no command"));
                return true;
            }
            command = action.at("command");
        } else {
            // Neither form: refusing is the only honest answer. Sending `null` as the
            // command would make the server reject it as a protocol error instead.
            on_result(Json(nullptr), invalid("INVALID_REQUEST", "executeCommand needs a command id or a code action index"));
            return true;
        }
        host.request("workspace/executeCommand", command,
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                // The protocol reply carries no payload of its own. Whatever the command
                // changed reaches the files through the server's workspace/applyEdit
                // reverse request (handled by set_document_editor), so `executed` is the
                // whole contract; `value` is passed along for callers that want it.
                Json answer{{"available", true}, {"executed", true}};
                if (!result.is_null()) answer["value"] = result;
                on_result(std::move(answer), Json(nullptr));
            });
        return true;
    }
    return false;
}

}  // namespace lsp
}  // namespace taocode
