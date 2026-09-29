// LSP 会话的工具与整形函数（声明在 lsp_support.hpp，模板函数在那边定义）。
#include "lsp_support.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>
#include <vector>

namespace taocode {
namespace lsp {
namespace detail {

std::string lower(std::string value) {
    for (auto& ch : value) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    return value;
}

std::string extension_of(const std::string& path) {
    const auto slash = path.find_last_of("/\\");
    const auto name = slash == std::string::npos ? path : path.substr(slash + 1);
    const auto dot = name.find_last_of('.');
    return dot == std::string::npos ? std::string() : lower(name.substr(dot + 1));
}

std::string percent_encode(const std::string& bytes) {
    static constexpr char hex[] = "0123456789ABCDEF";
    std::string out;
    for (const unsigned char ch : bytes) {
        const bool keep = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') ||
                          ch == '-' || ch == '.' || ch == '_' || ch == '~' || ch == '/' || ch == ':';
        if (keep) out.push_back(static_cast<char>(ch));
        else { out.push_back('%'); out.push_back(hex[ch >> 4]); out.push_back(hex[ch & 0x0F]); }
    }
    return out;
}

std::string percent_decode(const std::string& value) {
    auto hex = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    std::string out;
    for (std::size_t i = 0; i < value.size(); ++i) {
        if (value[i] == '%' && i + 2 < value.size()) {
            const int high = hex(value[i + 1]), low = hex(value[i + 2]);
            if (high >= 0 && low >= 0) { out.push_back(static_cast<char>((high << 4) | low)); i += 2; continue; }
        }
        out.push_back(value[i]);
    }
    return out;
}

std::string u8_path(const std::filesystem::path& path) {
    const auto generic = path.generic_u8string();
    return {reinterpret_cast<const char*>(generic.data()), generic.size()};
}

const char* completion_kind(unsigned number) {
    switch (number) {
        case 1: return "text"; case 2: return "method"; case 3: return "function"; case 4: return "constructor";
        case 5: return "field"; case 6: return "variable"; case 7: return "class"; case 8: return "interface";
        case 9: return "module"; case 10: return "property"; case 11: return "unit"; case 12: return "value";
        case 13: return "enum"; case 14: return "keyword"; case 15: return "snippet"; case 16: return "color";
        case 17: return "file"; case 18: return "reference"; case 19: return "folder"; case 20: return "enum-member";
        case 21: return "constant"; case 22: return "struct"; case 23: return "event"; case 24: return "operator";
        case 25: return "type-parameter"; default: return "text";
    }
}

Json hover_text(const Json& contents) {
    if (contents.is_string()) return contents;
    if (contents.is_object() && contents.contains("value")) return contents.at("value");
    if (contents.is_array()) {
        std::string joined;
        for (const auto& part : contents) {
            const auto text = hover_text(part);
            if (text.is_string()) { if (!joined.empty()) joined += "\n\n"; joined += text.get<std::string>(); }
        }
        return joined;
    }
    return Json(nullptr);
}

Json range_corner(const Json& range, const char* corner) {
    if (range.is_object() && range.contains(corner) && range.at(corner).is_object()) return range.at(corner);
    return Json::object();
}

int int_at(const Json& object, const char* key) {
    return object.is_object() && object.contains(key) && object.at(key).is_number_integer()
               ? object.at(key).get<int>() : 0;
}

bool bool_at(const Json& object, const char* key, bool fallback) {
    return object.is_object() && object.contains(key) && object.at(key).is_boolean() ? object.at(key).get<bool>()
                                                                                     : fallback;
}

int int_or(const Json& object, const char* key, int fallback) {
    return object.is_object() && object.contains(key) && object.at(key).is_number_integer()
               ? object.at(key).get<int>() : fallback;
}

std::string string_at(const Json& object, const char* key) {
    return object.is_object() && object.contains(key) && object.at(key).is_string() ? object.at(key).get<std::string>()
                                                                                     : std::string();
}

Json text_edits(const Json& array) {
    Json out = Json::array();
    if (!array.is_array()) return out;
    for (const auto& item : array) {
        if (!item.is_object() || !item.contains("range")) continue;
        const auto range = item.at("range");
        const auto start = range_corner(range, "start");
        const auto end = range_corner(range, "end");
        out.push_back({{"text", string_at(item, "newText")},
                       {"startLine", int_at(start, "line")}, {"startChar", int_at(start, "character")},
                       {"endLine", int_at(end, "line")}, {"endChar", int_at(end, "character")}});
    }
    return out;
}

Json shape_diagnostics(const Json& array) {
    Json diagnostics = Json::array();
    if (!array.is_array()) return diagnostics;
    for (const auto& item : array) {
        if (!item.is_object() || !item.contains("range") || !item.at("range").is_object()) continue;
        const auto& range = item.at("range");
        const auto start = range_corner(range, "start");
        Json entry{{"line", int_at(start, "line")}, {"character", int_at(start, "character")},
                   {"message", string_at(item, "message")}, {"severity", int_at(item, "severity")}};
        if (entry.at("severity").get<int>() == 0) entry["severity"] = 1;
        if (range.contains("end") && range.at("end").is_object()) {
            const auto end = range_corner(range, "end");
            entry["endLine"] = int_at(end, "line");
            entry["endCharacter"] = int_at(end, "character");
        }
        if (item.contains("source")) entry["source"] = item.at("source");
        diagnostics.push_back(std::move(entry));
    }
    return diagnostics;
}

void collect_symbols(const Json& nodes, Json& out) {
    if (!nodes.is_array()) return;
    const Json blank = Json::object();
    for (const auto& node : nodes) {
        if (!node.is_object() || !node.contains("name") || !node.at("name").is_string()) continue;
        const Json* span = nullptr;
        const Json* selection = nullptr;
        if (node.contains("range") && node.at("range").is_object()) span = &node.at("range");
        if (node.contains("selectionRange") && node.at("selectionRange").is_object())
            selection = &node.at("selectionRange");
        else if (node.contains("location") && node.at("location").is_object() &&
                 node.at("location").contains("range") && node.at("location").at("range").is_object()) {
            span = selection = &node.at("location").at("range");
        } else {
            span = selection = &blank;
        }
        if (span == nullptr) span = selection;
        const auto start = range_corner(*selection, "start");
        const auto end = range_corner(*span, "end");
        out.push_back({{"name", node.at("name")}, {"kind", int_at(node, "kind")}, {"detail", string_at(node, "detail")},
                       {"startLine", int_at(start, "line")}, {"startChar", int_at(start, "character")},
                       {"endLine", int_at(end, "line")}, {"endChar", int_at(end, "character")}});
        // Preserve the navigation/selection range separately from the enclosing
        // declaration end used by outline consumers.
        if (selection->contains("end") && selection->at("end").is_object()) {
            const auto& selection_end = selection->at("end");
            if (selection_end.contains("line") && selection_end.at("line").is_number_integer() &&
                selection_end.contains("character") && selection_end.at("character").is_number_integer()) {
                out.back()["selectionEndLine"] = int_at(selection_end, "line");
                out.back()["selectionEndCharacter"] = int_at(selection_end, "character");
            }
        }
        if (node.contains("children")) collect_symbols(node.at("children"), out);  // depth-first
    }
}

Json invalid(const std::string& code, const std::string& message) {
    return Json{{"code", code}, {"message", message}};
}

// 服务端 `workspace.fileOperations.<op>` 的**过滤器**形状（`FileOperationOptions`）。
// 只有**服务端能力**是这个形状：`org.eclipse.lsp4j.FileOperationsServerCapabilities.getDidCreate()`
// 返回 `FileOperationOptions`（javap 核对 org.eclipse.lsp4j_0.23.1）——客户端能力是布尔值，
// 见 lsp_session.cpp 里 initialize 的能力声明。两者的名字只差 Client/Server，
// 曾经在这里被弄反，导致 JDT LS 的 Gson 在 `$.params.capabilities.workspace.fileOperations.didCreate`
// 上抛 "Expected a boolean but was BEGIN_ARRAY" 并把整条 initialize 判为 -32700。
Json file_operation_filters() {
    return Json::array({
        Json{{"scheme", "file"}, {"pattern", {{"glob", "**/*"}, {"matches", "file"}}}},
        Json{{"scheme", "file"}, {"pattern", {{"glob", "**"}, {"matches", "folder"}}}},
    });
}

const char* provider_for(const std::string& kind) {
    if (kind == "hover") return "hoverProvider";
    if (kind == "completion" || kind == "completionItemResolve") return "completionProvider";
    if (kind == "definition") return "definitionProvider";
    if (kind == "rename" || kind == "prepareRename") return "renameProvider";
    if (kind == "references") return "referencesProvider";
    if (kind == "documentSymbol") return "documentSymbolProvider";
    if (kind == "workspaceSymbol") return "workspaceSymbolProvider";
    if (kind == "signatureHelp") return "signatureHelpProvider";
    if (kind == "codeAction" || kind == "codeActionResolve") return "codeActionProvider";
    // WorkspaceCommands are not a textDocument request, but the server capability
    // that gates them is still a top-level ServerCapabilities entry, so the same
    // "declared false => LSP_UNSUPPORTED" rule applies.
    if (kind == "executeCommand") return "executeCommandProvider";
    if (kind == "formatting") return "documentFormattingProvider";
    if (kind == "rangeFormatting") return "documentRangeFormattingProvider";
    if (kind == "implementation") return "implementationProvider";
    if (kind == "typeDefinition") return "typeDefinitionProvider";
    if (kind == "documentHighlight") return "documentHighlightProvider";
    if (kind == "prepareCallHierarchy" || kind == "callHierarchyIncoming" || kind == "callHierarchyOutgoing")
        return "callHierarchyProvider";
    if (kind == "prepareTypeHierarchy" || kind == "typeHierarchySupertypes" || kind == "typeHierarchySubtypes")
        return "typeHierarchyProvider";
    if (kind == "selectionRange") return "selectionRangeProvider";
    if (kind == "documentLink") return "documentLinkProvider";
    if (kind == "inlineCompletion") return "inlineCompletionProvider";
    if (kind == "codeLens") return "codeLensProvider";
    // `monikerProvider`：符号标识（IDEA 侧的用户可见落点是 Copy Reference）。
    if (kind == "moniker") return "monikerProvider";
    if (kind == "foldingRange") return "foldingRangeProvider";
    if (kind == "diagnostic" || kind == "workspaceDiagnostic") return "diagnosticProvider";
    if (kind == "inlayHint") return "inlayHintProvider";
    // `semanticTokensProvider`：注意它可以是 `true`（只有 full）也可以是对象（legend + requests），
    // 两种情况都算"声明了"，所以沿用同一套"只有显式 false/null 才算拒绝"的判定。
    if (kind == "semanticTokens") return "semanticTokensProvider";
    return nullptr;
}

bool escapes_root(const std::string& relative) {
    if (relative.empty()) return true;
    if (relative.front() == '/' || relative.front() == '\\') return true;
    if (relative.size() >= 2 && std::isalpha(static_cast<unsigned char>(relative[0])) != 0 && relative[1] == ':')
        return true;
    for (std::size_t start = 0; start < relative.size();) {
        const auto slash = relative.find_first_of("/\\", start);
        const auto segment = relative.substr(start, slash == std::string::npos ? slash : slash - start);
        if (segment == "..") return true;
        if (slash == std::string::npos) break;
        start = slash + 1;
    }
    return false;
}

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
        const auto byte = static_cast<unsigned char>(text[index]);
        std::size_t step = 1;
        if (byte >= 0xF0) { step = 4; units += 2; }
        else if (byte >= 0xE0) { step = 3; units += 1; }
        else if (byte >= 0xC0) { step = 2; units += 1; }
        else units += 1;
        index += step;
    }
    return index;
}

bool has_command(const Json& item) {
    if (!item.is_object()) return false;
    const auto command = item.find("command");
    if (command == item.end() || !command->is_object()) return false;
    const auto id = command->find("command");
    return id != command->end() && id->is_string() && !id->get<std::string>().empty();
}

std::string parameter_label(const Json& signature, const Json& parameter) {
    if (!parameter.is_object() || !parameter.contains("label")) return std::string();
    const auto& raw = parameter.at("label");
    if (raw.is_string()) return raw.get<std::string>();
    if (!raw.is_array() || raw.size() < 2 || !raw[0].is_number_integer() || !raw[1].is_number_integer())
        return std::string();
    const auto label = string_at(signature, "label");
    const auto start = raw[0].get<std::int64_t>(), end = raw[1].get<std::int64_t>();
    if (start < 0 || end < start || static_cast<std::size_t>(end) > label.size()) return std::string();
    return label.substr(static_cast<std::size_t>(start), static_cast<std::size_t>(end - start));
}

Json signature_shape(const Json& result) {
    Json signatures = Json::array();
    if (result.is_object() && result.contains("signatures") && result.at("signatures").is_array())
        for (const auto& item : result.at("signatures")) {
            if (!item.is_object()) continue;
            const auto label = string_at(item, "label");
            if (label.empty()) continue;
            Json parameters = Json::array();
            if (item.contains("parameters") && item.at("parameters").is_array())
                for (const auto& parameter : item.at("parameters"))
                    parameters.push_back({{"label", parameter_label(item, parameter)}});
            Json signature{{"label", label}, {"parameters", std::move(parameters)}};
            if (item.contains("documentation") && !item.at("documentation").is_null()) {
                const auto text = hover_text(item.at("documentation"));
                if (text.is_string()) signature["documentation"] = text;
            }
            signatures.push_back(std::move(signature));
        }
    if (signatures.empty()) return Json{{"available", false}};
    return Json{{"available", true},
                {"signatures", std::move(signatures)},
                {"activeSignature", int_at(result, "activeSignature")},
                {"activeParameter", int_at(result, "activeParameter")}};
}

Json highlight_shape(const Json& result) {
    Json highlights = Json::array();
    if (result.is_array())
        for (const auto& item : result) {
            if (!item.is_object()) continue;
            const Json span = item.contains("range") && item.at("range").is_object() ? item.at("range") : Json::object();
            const auto start = range_corner(span, "start");
            const auto end = range_corner(span, "end");
            highlights.push_back({{"kind", int_at(item, "kind")},
                                  {"startLine", int_at(start, "line")}, {"startChar", int_at(start, "character")},
                                  {"endLine", int_at(end, "line")}, {"endChar", int_at(end, "character")}});
        }
    if (highlights.empty()) return Json{{"available", false}};
    return Json{{"available", true}, {"highlights", std::move(highlights)}};
}

Json format_shape(const Json& result, std::string path) {
    auto text = text_edits(result);
    if (text.empty()) return Json{{"available", false}};
    return Json{{"available", true},
                {"edits", Json::array({{{"path", std::move(path)}, {"textEdits", std::move(text)}}})}};
}

Json argument_range(const Json& args, int line, int character) {
    if (args.is_object() && args.contains("range") && args.at("range").is_object()) {
        const auto& candidate = args.at("range");
        const auto corner = [&candidate](const char* name) {
            return candidate.contains(name) && candidate.at(name).is_object();
        };
        if (corner("start") && corner("end")) return candidate;
    }
    const auto point = Json{{"line", line}, {"character", character}};
    return Json{{"start", point}, {"end", std::move(point)}};
}

Json argument_diagnostics(const Json& args) {
    Json out = Json::array();
    if (args.is_object() && args.contains("diagnostics") && args.at("diagnostics").is_array())
        for (const auto& item : args.at("diagnostics"))
            if (item.is_object()) out.push_back(item);
    return out;
}

Json format_options(const Json& args) {
    return Json{{"tabSize", int_or(args, "tabSize", 4)}, {"insertSpaces", bool_at(args, "insertSpaces", true)}};
}

}  // namespace detail
}  // namespace lsp
}  // namespace taocode
