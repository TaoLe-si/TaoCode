#include "lsp_session.hpp"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace taocode {
namespace lsp {
namespace {

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

// Percent-encode every byte that is not unreserved or a path delimiter we keep,
// so Windows paths with spaces, ':' or CJK become valid file:// URIs.
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

// A real UTF-16 -> UTF-8 conversion would be needed for byte-exact offsets on
// non-ASCII lines; LSP positions are UTF-16 code units, so this is an explicitly
// marked approximation the contract tolerates for the current text-only bridge.
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

// Shaping runs on the server reader thread, so a malformed payload must degrade to
// zeroes instead of throwing out of the message loop. These helpers never index a
// non-object and never assume a key exists.
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

// TextEdit[] -> [{text,startLine,startChar,endLine,endChar}] with 0-based positions.
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

// DocumentSymbol[] (hierarchical: selectionRange + range, recursion through
// `children`) or SymbolInformation[] (flat: location.range) -> one depth-first list.
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
        const auto start = range_corner(*selection, "start");
        const auto end = range_corner(*span, "end");
        out.push_back({{"name", node.at("name")}, {"kind", int_at(node, "kind")}, {"detail", string_at(node, "detail")},
                       {"startLine", int_at(start, "line")}, {"startChar", int_at(start, "character")},
                       {"endLine", int_at(end, "line")}, {"endChar", int_at(end, "character")}});
        if (node.contains("children")) collect_symbols(node.at("children"), out);  // depth-first
    }
}

Json invalid(const std::string& code, const std::string& message) {
    return Json{{"code", code}, {"message", message}};
}

// The ServerCapabilities key a request kind needs. Every kind this session can
// issue has one, which is what makes the "server did not advertise it" check
// below complete instead of best-effort.
const char* provider_for(const std::string& kind) {
    if (kind == "hover") return "hoverProvider";
    if (kind == "completion") return "completionProvider";
    if (kind == "definition") return "definitionProvider";
    if (kind == "rename") return "renameProvider";
    if (kind == "references") return "referencesProvider";
    if (kind == "documentSymbol") return "documentSymbolProvider";
    if (kind == "workspaceSymbol") return "workspaceSymbolProvider";
    if (kind == "signatureHelp") return "signatureHelpProvider";
    if (kind == "codeAction" || kind == "codeActionResolve") return "codeActionProvider";
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
    if (kind == "inlayHint") return "inlayHintProvider";
    return nullptr;
}

// A workspace-relative path is only writable when it stays inside the root: no
// absolute form, no drive letter, no `..`.
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

// LSP (line, character) -> byte offset in UTF-8 text, with `character` counted in
// UTF-16 code units like the protocol says. Clamped, so a range a server computed
// against an older buffer can never run past the end of this one.
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

// ---- shared result shaping for the coding-assistance kinds -------------------
//
// `to_path` is the Session's uri -> workspace-relative mapper, passed in because
// these helpers run on the server reader thread inside a shaped callback.

// WorkspaceEdit -> [{path,textEdits}]. Shared by rename and by every codeAction
// that carries an inline edit, so a multi-file refactor and a quick fix apply the
// exact same way in the UI.
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

// Location[] / LocationLink[] (a bare single object is accepted too) ->
// [{path,line,character}] with 0-based positions. Shared by references,
// implementation and typeDefinition.
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

// A CallHierarchyItem / TypeHierarchyItem ->
// {name,kind,path,detail?,line,character,raw?}. The item is the only thing the
// incoming/outgoing and supertype/subtype requests need, so `with_raw` keeps the
// untouched server object along for the UI to echo back verbatim.
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

// The item arrays both hierarchies answer with (a bare object is accepted too).
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

// CallHierarchyIncomingCall[] (`from`) / CallHierarchyOutgoingCall[] (`to`) ->
// [{name,kind,path,line,character,callLine,callChar}]. Both carry `fromRanges`, the
// span of the call site, so the UI can jump from a caller to where it calls.
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

// A (Command|CodeAction)[]: only the title, the kind and an inline WorkspaceEdit
// matter to the UI, so untitled entries are dropped and every remaining one is
// numbered with `index`. An action whose edit only arrives through
// codeAction/resolve is listed with edits:[] and resolvable:true; `raw_out`, when
// given, collects the untouched server objects so `index` still addresses them
// after a later codeActionResolve request.
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
        if (raw_out) raw_out->push_back(item);
        actions.push_back(std::move(action));
    }
    return actions;
}

// SignatureInformation.parameters[].label is either a plain string or a
// [start,end] UTF-16 pair into the signature label; the byte slice is the same
// approximation the rest of the bridge already accepts for non-ASCII lines.
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

// SignatureHelp -> {available, signatures:[{label,documentation?,parameters:[{label}]}],
//                   activeSignature, activeParameter}.
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

// DocumentHighlight[] -> {available, highlights:[{kind,startLine,startChar,endLine,endChar}]}
// with kind 1=text 2=read 3=write (0 when the server omitted it).
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

// TextEdit[] for the single formatted document -> the one-file rename shape.
Json format_shape(const Json& result, std::string path) {
    auto text = text_edits(result);
    if (text.empty()) return Json{{"available", false}};
    return Json{{"available", true},
                {"edits", Json::array({{{"path", std::move(path)}, {"textEdits", std::move(text)}}})}};
}

// A range supplied by the UI (already 0-based), or a zero-width range at the
// caret when the caller only knows the cursor position.
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

// codeAction context: the diagnostics the UI already holds for that range, or an
// empty array. Non-object entries are dropped so a stray element cannot poison
// the request.
Json argument_diagnostics(const Json& args) {
    Json out = Json::array();
    if (args.is_object() && args.contains("diagnostics") && args.at("diagnostics").is_array())
        for (const auto& item : args.at("diagnostics"))
            if (item.is_object()) out.push_back(item);
    return out;
}

// FormattingOptions: the IDE edits with 4 spaces unless the UI says otherwise.
Json format_options(const Json& args) {
    return Json{{"tabSize", int_or(args, "tabSize", 4)}, {"insertSpaces", bool_at(args, "insertSpaces", true)}};
}

}  // namespace

Session::~Session() { shutdown_all(); }

std::string Session::language_for(const std::string& path) {
    const auto extension = extension_of(path);
    if (extension == "java") return "java";
    if (extension == "kt" || extension == "kts") return "kotlin";
    if (extension == "c") return "c";
    if (extension == "cpp" || extension == "cc" || extension == "cxx" || extension == "h" || extension == "hpp" || extension == "hh") return "cpp";
    if (extension == "ts") return "typescript";
    if (extension == "tsx") return "typescriptreact";
    if (extension == "js" || extension == "mjs" || extension == "cjs") return "javascript";
    if (extension == "jsx") return "javascriptreact";
    if (extension == "json") return "json";
    if (extension == "vue") return "vue";
    if (extension == "html") return "html";
    if (extension == "css") return "css";
    if (extension == "rs") return "rust";
    if (extension == "go") return "go";
    if (extension == "py") return "python";
    return extension;
}

std::string Session::to_uri(const std::string& path) const {
    const auto absolute = root_ / std::filesystem::path(std::u8string(path.begin(), path.end()));
    std::string generic = u8_path(absolute);
    // Windows: "C:/dir/file" -> "file:///C%3A/dir/file"; keep the drive colon percent-free.
    std::string encoded = percent_encode(generic);
    const std::string drive_colon = "%3A";
    for (std::size_t pos = encoded.find(drive_colon); pos != std::string::npos; pos = encoded.find(drive_colon, pos)) {
        encoded.replace(pos, drive_colon.size(), ":");
        pos += 1;
    }
    if (encoded.size() >= 1 && encoded[0] == '/') return "file://" + encoded;  // UNC or rooted
    return "file:///" + encoded;
}

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

std::string Session::to_path(const std::string& uri) const {
    return uri_to_relative(uri, root_);
}

Host& Session::ensure(const std::string& language) {
    const auto existing = hosts_.find(language);
    if (existing != hosts_.end()) return *existing->second;
    const auto config = config_.find(language);
    if (config == config_.end()) throw WorkspaceError("LSP_UNAVAILABLE", "no server configured for " + language);

    auto host = std::make_unique<Host>();
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
        Json diagnostics = Json::array();
        if (params.contains("diagnostics") && params.at("diagnostics").is_array()) {
            for (const auto& item : params.at("diagnostics")) {
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
        }
        if (on_diagnostics_) on_diagnostics_(path, std::move(diagnostics));
    });

    Host::Spec spec;
    spec.executable = config->second.command;
    spec.arguments = config->second.arguments;
    spec.working_directory = config->second.working_directory;
    const auto root_uri = root_.empty() ? Json(nullptr) : Json(to_uri(""));
    auto initialization = config->second.initialization_options;
    initialization["settings"] = config->second.settings;
    host->set_configuration(config->second.settings);
    host->set_timeout(timeout_);
    const auto root_name = root_.filename().generic_u8string();
    Json params{
        {"initializationOptions", std::move(initialization)},
        {"workspaceFolders", root_.empty() ? Json(nullptr) : Json::array({{{"uri", root_uri}, {"name", std::string(root_name.begin(), root_name.end())}}})},
        {"clientInfo", {{"name", "TaoCode"}, {"version", "0.1"}}},
        {"rootUri", root_uri},
        {"capabilities", {
            {"textDocument", {
                {"hover", {{"contentFormat", Json::array({"markdown", "plaintext"})}}},
                {"definition", Json::object()},
                // Completion: the item kinds the UI renders and the resolve-driven
                // detail/documentation the item list can ask for. `resolveSupport` is
                // deliberately absent — completionItem/resolve is not implemented, so
                // a server must send everything with the item.
                {"completion", {{"completionItem", {{"snippetSupport", false},
                                                    {"commitCharactersSupport", false},
                                                    {"documentationFormat", Json::array({"markdown", "plaintext"})},
                                                    {"deprecatedSupport", false},
                                                    {"insertReplaceSupport", false}}},
                                {"completionItemKind", {{"valueSet", Json::array({1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
                                                                                 12, 13, 14, 15, 16, 17, 18, 19, 20,
                                                                                 21, 22, 23, 24, 25})}}},
                                {"contextSupport", true}}},
                {"publishDiagnostics", {{"relatedInformation", false}, {"versionSupport", false},
                                        {"dataSupport", true}}},
                // Refactor + symbol capabilities: declaring hierarchical symbol
                // support is what makes real servers answer DocumentSymbol[]
                // instead of the legacy flat SymbolInformation[].
                {"references", Json::object()},
                {"rename", {{"prepareSupport", false}, {"changesAnnotationSupport", Json::object()}}},
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
                // The didChange the client sends is derived from what the server
                // announces (full or incremental), so declaring both is honest.
                {"synchronization", {{"dynamicRegistration", true}, {"willSave", false},
                                     {"willSaveWaitUntil", false}, {"didSave", false}}},
            }},
            {"workspace", {{"configuration", true}, {"symbol", Json::object()},
                           // applyEdit is implemented: the server's edits really are
                           // written through the workspace layer.
                           {"applyEdit", true},
                           {"workspaceEdit", {{"documentChanges", true},
                                              {"resourceOperations", Json::array({"create", "rename", "delete"})},
                                              {"failureHandling", "textOnlyTransactional"}}},
                           {"didChangeConfiguration", {{"dynamicRegistration", true}}},
                           {"workspaceFolders", true}}},
        }},
    };
    // The server-driven `workspace/applyEdit` writes real files through Workspace.
    host->set_document_editor([this](const std::string& uri, const Json& edits, int version) {
        return apply_document_edits(uri, edits, version);
    });
    // Defer didOpen until the initialize handshake completes on the reader thread.
    host->start(spec, std::move(params), [this, language](Json result, Json error) {
        if (!error.is_null()) return;
        std::lock_guard lock(mutex_);
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
        for (auto& [path, doc] : documents_)
            if (doc.language == language && !doc.opened) {
                host->second->did_open(doc.uri, language, doc.version, doc.text);
                doc.opened = true;
            }
    });
    hosts_[language] = std::move(host);
    return *hosts_[language];
}

Json Session::open(const std::string& path, const std::string& text) {
    const auto language = language_for(path);
    std::lock_guard lock(mutex_);
    if (!has_server(language)) return {{"running", false}, {"language", language}};
    Document& doc = documents_[path];
    doc.language = language;
    doc.uri = to_uri(path);
    doc.version = 1;
    doc.text = text;
    doc.opened = false;
    try {
        Host& host = ensure(language);
        if (ready_.count(language) && ready_[language]) { host.did_open(doc.uri, language, doc.version, text); doc.opened = true; }
    } catch (const WorkspaceError&) {
        return {{"running", false}, {"language", language}};
    }
    return {{"running", true}, {"language", language}};
}

void Session::change(const std::string& path, const std::string& text) {
    std::lock_guard lock(mutex_);
    const auto document = documents_.find(path);
    if (document == documents_.end()) return;
    document->second.text = text;
    ++document->second.version;
    const auto host = hosts_.find(document->second.language);
    if (host != hosts_.end() && document->second.opened)
        host->second->did_change(document->second.uri, document->second.version, text);
}

void Session::close(const std::string& path) {
    Host* host = nullptr;
    std::string uri;
    {
        std::lock_guard lock(mutex_);
        const auto document = documents_.find(path);
        if (document == documents_.end()) return;
        uri = document->second.uri;
        const auto found = hosts_.find(document->second.language);
        if (found != hosts_.end() && document->second.opened) {
            host = found->second.get();
            document->second.opened = false;
        }
    }
    // Inform the server the document is closed (LSP lifecycle); not doing so leaves
    // stale diagnostics on JDT/TS after a tab closes. Then drop local state.
    if (host) host->did_close(uri);
    std::lock_guard lock(mutex_);
    documents_.erase(path);
    pending_actions_.erase(path);
}

void Session::request(const std::string& kind, const std::string& path, int line, int character, ResultHandler on_result) {
    Host* host = nullptr;
    std::string uri;
    Json declined;
    {
        std::lock_guard lock(mutex_);
        const auto document = documents_.find(path);
        if (document == documents_.end()) declined = invalid("LSP_CLOSED", "document is not open");
        else {
            const auto found = hosts_.find(document->second.language);
            if (found == hosts_.end()) declined = invalid("LSP_UNAVAILABLE", "no language server");
            // A server that explicitly declined the provider gets a clear error
            // instead of a request it will only refuse.
            else if (const auto missing = unsupported(document->second.language, kind)) declined = Json(*missing);
            else {
                host = found->second.get();
                uri = document->second.uri;
            }
        }
    }
    // Every early answer is delivered outside the lock: a handler is allowed to
    // come straight back into the session.
    if (!declined.is_null()) { on_result(Json(nullptr), std::move(declined)); return; }
    const auto position = Json{{"line", line}, {"character", character}};
    if (kind == "hover") {
        host->request("textDocument/hover", {{"textDocument", text_document(uri)}, {"position", position}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                if (!result.is_object() || !result.contains("contents") || result.at("contents").is_null())
                    on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"contents", hover_text(result.at("contents"))}}, Json(nullptr));
            });
    } else if (kind == "definition") {
        host->request("textDocument/definition", {{"textDocument", text_document(uri)}, {"position", position}},
            [this, on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
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
                if (locations.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"locations", std::move(locations)}}, Json(nullptr));
            });
    } else if (kind == "completion") {
        host->request("textDocument/completion", {{"textDocument", text_document(uri)},
            {"position", position}, {"context", {{"triggerKind", 1}}}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json items = Json::array();
                const Json* source = nullptr;
                if (result.is_array()) source = &result;
                else if (result.is_object() && result.contains("items")) source = &result.at("items");
                if (source) {
                    for (const auto& item : *source) {
                        if (!item.is_object() || !item.contains("label")) continue;
                        Json entry{{"label", item.at("label")}, {"kind", completion_kind(item.value("kind", 1))}};
                        if (item.contains("detail") && item.at("detail").is_string()) entry["detail"] = item.at("detail");
                        if (item.contains("insertText") && item.at("insertText").is_string()) entry["apply"] = item.at("insertText");
                        items.push_back(std::move(entry));
                    }
                }
                on_result({{"available", true}, {"items", std::move(items)}}, Json(nullptr));
            });
    } else {
        on_result(Json(nullptr), Json{{"code", "LSP_BAD_KIND"}, {"message", "unknown request kind"}});
    }
}

void Session::set_configuration(const std::string& language, Json settings) {
    Host* host = nullptr;
    {
        std::lock_guard lock(mutex_);
        const auto config = config_.find(language);
        if (config == config_.end()) return;
        config->second.settings = settings;
        const auto found = hosts_.find(language);
        if (found != hosts_.end()) host = found->second.get();
    }
    if (host) host->set_configuration(std::move(settings));
}

void Session::semantic(const std::string& kind, const std::string& path, int line, int character, const Json& args,
                       ResultHandler on_result) {
    Host* host = nullptr;
    std::string uri;
    Json declined;
    {
        std::lock_guard lock(mutex_);
        if (kind == "workspaceSymbol") {
            // Server-wide query: no document required. Use the language implied by
            // `path` when the caller knows one, else any configured/running server.
            auto language = language_for(path);
            if (language.empty()) {
                if (!hosts_.empty()) language = hosts_.begin()->first;
                else if (!config_.empty()) language = config_.begin()->first;
            }
            const auto found = hosts_.find(language);
            if (found != hosts_.end()) host = found->second.get();
            else if (!language.empty() && config_.count(language) != 0) {
                try {
                    host = &ensure(language);
                } catch (const WorkspaceError& error) {
                    declined = invalid(error.code, error.what());
                }
            }
            if (declined.is_null() && !host) declined = invalid("LSP_UNAVAILABLE", "no language server");
            if (declined.is_null())
                if (const auto missing = unsupported(language, kind)) declined = Json(*missing);
        } else {
            const auto document = documents_.find(path);
            if (document == documents_.end()) declined = invalid("LSP_CLOSED", "document is not open");
            else {
                const auto found = hosts_.find(document->second.language);
                if (found == hosts_.end()) declined = invalid("LSP_UNAVAILABLE", "no language server");
                else if (const auto missing = unsupported(document->second.language, kind)) declined = Json(*missing);
                else {
                    host = found->second.get();
                    uri = document->second.uri;
                }
            }
        }
    }
    if (!declined.is_null()) { on_result(Json(nullptr), std::move(declined)); return; }

    const auto position = Json{{"line", line}, {"character", character}};
    const auto relative = [this](const std::string& target) { return to_path(target); };
    if (kind == "rename") {
        host->request("textDocument/rename", {{"textDocument", text_document(uri)}, {"position", position},
            {"newName", string_at(args, "newName")}},
            [on_result = std::move(on_result), to_path = relative](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                const auto groups = edit_groups(result, to_path);
                if (groups.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"edits", std::move(groups)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "references") {
        host->request("textDocument/references", {{"textDocument", text_document(uri)}, {"position", position},
            {"context", {{"includeDeclaration", true}}}},
            [on_result = std::move(on_result), to_path = relative](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                const auto refs = ref_entries(result, to_path);
                if (refs.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"refs", std::move(refs)}}, Json(nullptr));
            });
        return;
    }
    // Go-to-implementations and go-to-type: a Location[] answered exactly like
    // references, so the UI reuses the same reference-list panel.
    if (kind == "implementation" || kind == "typeDefinition") {
        host->request(kind == "implementation" ? "textDocument/implementation" : "textDocument/typeDefinition",
            {{"textDocument", text_document(uri)}, {"position", position}},
            [on_result = std::move(on_result), to_path = relative](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                const auto refs = ref_entries(result, to_path);
                if (refs.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"refs", std::move(refs)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "documentSymbol") {
        host->request("textDocument/documentSymbol", {{"textDocument", text_document(uri)}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json symbols = Json::array();
                const Json nodes = result.is_array() ? result : Json::array({result});
                collect_symbols(nodes, symbols);
                if (symbols.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"symbols", std::move(symbols)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "workspaceSymbol") {
        host->request("workspace/symbol", {{"query", string_at(args, "query")}},
            [this, on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json symbols = Json::array();
                if (result.is_array())
                    for (const auto& item : result) {
                        // SymbolInformation carries location; an unresolved workspace
                        // symbol does not, so it has no jump target and is skipped.
                        if (!item.is_object() || !item.contains("location") || !item.at("location").is_object()) continue;
                        const auto& location = item.at("location");
                        if (!location.contains("uri") || !location.at("uri").is_string()) continue;
                        const auto start = range_corner(location.value("range", Json::object()), "start");
                        symbols.push_back({{"name", string_at(item, "name")}, {"kind", int_at(item, "kind")},
                                           {"path", to_path(location.at("uri").get<std::string>())},
                                           {"line", int_at(start, "line")}, {"character", int_at(start, "character")}});
                    }
                if (symbols.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"symbols", std::move(symbols)}}, Json(nullptr));
            });
        return;
    }
    // Signature help: the caret alone is enough, but the UI may say which trigger
    // asked for it (1 invoked, 2 typed a character, 3 content change).
    if (kind == "signatureHelp") {
        host->request("textDocument/signatureHelp", {{"textDocument", text_document(uri)}, {"position", position},
            {"context", {{"triggerKind", int_or(args, "triggerKind", 1)}}}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                on_result(signature_shape(result), Json(nullptr));
            });
        return;
    }
    if (kind == "codeAction") {
        host->request("textDocument/codeAction", {{"textDocument", text_document(uri)},
            {"range", argument_range(args, line, character)},
            {"context", {{"diagnostics", argument_diagnostics(args)}}}},
            [on_result = std::move(on_result), to_path = relative, this, path](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json raw = Json::array();
                const auto actions = action_entries(result, to_path, &raw);
                {
                    // Keep the untouched server objects so codeActionResolve can address
                    // one by the `index` the UI was given (untitled entries were dropped).
                    std::lock_guard lock(mutex_);
                    pending_actions_[path] = std::move(raw);
                }
                if (actions.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"actions", std::move(actions)}}, Json(nullptr));
            });
        return;
    }
    // Resolve a lazily-offered CodeAction: the server promised `edit` only on
    // request, so echo the stored object back and reshape whatever comes with it.
    if (kind == "codeActionResolve") {
        const auto index = int_or(args, "index", -1);
        Json action;
        bool stale = true;
        {
            std::lock_guard lock(mutex_);
            const auto stored = pending_actions_.find(path);
            if (stored != pending_actions_.end() && stored->second.is_array() && index >= 0 &&
                static_cast<std::size_t>(index) < stored->second.size()) {
                action = stored->second[static_cast<std::size_t>(index)];
                stale = false;
            }
        }
        if (stale) {
            on_result(Json(nullptr), invalid("STALE_ACTION", "this code action is no longer available"));
            return;
        }
        if (action.contains("edit")) {  // inline already: no round trip
            on_result({{"available", true}, {"edits", edit_groups(action.at("edit"), relative)}}, Json(nullptr));
            return;
        }
        host->request("codeAction/resolve", action,
            [on_result = std::move(on_result), to_path = relative](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                const auto edits = result.is_object() && result.contains("edit")
                                       ? edit_groups(result.at("edit"), to_path) : Json::array();
                if (edits.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"edits", std::move(edits)}}, Json(nullptr));
            });
        return;
    }
    // Call hierarchy: prepare answers with the item(s) at the position, and the
    // incoming/outgoing requests must echo one of those items straight back.
    if (kind == "prepareCallHierarchy" || kind == "prepareTypeHierarchy") {
        host->request(kind == "prepareCallHierarchy" ? "textDocument/prepareCallHierarchy" : "textDocument/prepareTypeHierarchy",
            {{"textDocument", text_document(uri)}, {"position", position}},
            [on_result = std::move(on_result), to_path = relative](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                const auto items = hier_items(result, to_path);
                if (items.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"items", std::move(items)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "callHierarchyIncoming" || kind == "callHierarchyOutgoing" ||
        kind == "typeHierarchySupertypes" || kind == "typeHierarchySubtypes") {
        if (!args.contains("item")) { on_result(Json(nullptr), invalid("INVALID_REQUEST", "the hierarchy item is missing")); return; }
        const Json& handed = args.at("item");
        // Accept either the shaped entry (whose `raw` is the server object) or a raw
        // item, so the UI never has to guess which layer produced it.
        const Json item = handed.is_object() && handed.contains("raw") && handed.at("raw").is_object()
                              ? handed.at("raw") : handed;
        const std::string method = kind == "callHierarchyIncoming" ? "callHierarchy/incomingCalls"
                                   : kind == "callHierarchyOutgoing" ? "callHierarchy/outgoingCalls"
                                   : kind == "typeHierarchySupertypes" ? "typeHierarchy/supertypes"
                                                                       : "typeHierarchy/subtypes";
        const bool calls = kind.rfind("callHierarchy", 0) == 0;
        const char* item_key = kind == "callHierarchyIncoming" ? "from" : "to";
        host->request(method, {{"item", item}},
            [on_result = std::move(on_result), to_path = relative, calls, item_key](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                // Call requests wrap each node with its call-site ranges; the type
                // hierarchy answers with a plain item array.
                const Json entries = calls ? call_entries(result, to_path, item_key) : hier_items(result, to_path);
                if (entries.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {calls ? "calls" : "items", std::move(entries)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "formatting" || kind == "rangeFormatting") {
        const auto options = format_options(args);
        Json params{{"textDocument", text_document(uri)}, {"options", options}};
        if (kind == "rangeFormatting") params["range"] = argument_range(args, line, character);
        host->request(kind == "formatting" ? "textDocument/formatting" : "textDocument/rangeFormatting",
            std::move(params),
            [on_result = std::move(on_result), to_path = relative, uri](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                on_result(format_shape(result, to_path(uri)), Json(nullptr));
            });
        return;
    }
    if (kind == "documentHighlight") {
        host->request("textDocument/documentHighlight", {{"textDocument", text_document(uri)}, {"position", position}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                on_result(highlight_shape(result), Json(nullptr));
            });
        return;
    }
    // Selection ranges: walk the innermost SelectionRange's parent chain into an
    // ordered innermost->outermost list, so the UI can grow/shrink a selection.
    if (kind == "selectionRange") {
        host->request("textDocument/selectionRange", {{"textDocument", text_document(uri)}, {"positions", Json::array({position})}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json ranges = Json::array();
                const Json* node = nullptr;
                if (result.is_array() && !result.empty()) node = &result.front();
                else if (result.is_object()) node = &result;
                int guard = 0;
                while (node && node->is_object() && node->contains("range") && node->at("range").is_object() && guard++ < 128) {
                    const auto& span = node->at("range");
                    const auto start = range_corner(span, "start");
                    const auto end = range_corner(span, "end");
                    ranges.push_back({{"startLine", int_at(start, "line")}, {"startChar", int_at(start, "character")},
                                      {"endLine", int_at(end, "line")}, {"endChar", int_at(end, "character")}});
                    node = (node->contains("parent") && node->at("parent").is_object()) ? &node->at("parent") : nullptr;
                }
                if (ranges.empty()) on_result({{"available", false}}, Json(nullptr));
                else on_result({{"available", true}, {"ranges", std::move(ranges)}}, Json(nullptr));
            });
        return;
    }
    if (kind == "inlayHint") {
        const Json viewport{{"start", {{"line", 0}, {"character", 0}}}, {"end", {{"line", 1000000}, {"character", 0}}}};
        host->request("textDocument/inlayHint", {{"textDocument", text_document(uri)}, {"range", viewport}},
            [on_result = std::move(on_result)](Json result, Json error) {
                if (!error.is_null()) { on_result(Json(nullptr), std::move(error)); return; }
                Json hints = Json::array();
                if (result.is_array()) for (const auto& item : result) {
                    if (!item.is_object() || !item.contains("position") || !item.at("position").is_object()) continue;
                    std::string label;
                    if (item.contains("label")) {
                        const auto& raw = item.at("label");
                        if (raw.is_string()) label = raw.get<std::string>();
                        else if (raw.is_array()) for (const auto& part : raw) if (part.is_object()) label += string_at(part, "value");
                    }
                    if (label.empty()) continue;
                    const auto& pos = item.at("position");
                    Json hint{{"line", int_at(pos, "line")}, {"character", int_at(pos, "character")}, {"label", label}};
                    if (bool_at(item, "paddingLeft", false)) hint["paddingLeft"] = true;
                    if (bool_at(item, "paddingRight", false)) hint["paddingRight"] = true;
                    if (item.contains("kind") && item.at("kind").is_number_integer()) hint["kind"] = item.at("kind");
                    hints.push_back(std::move(hint));
                }
                on_result(Json{{"available", !hints.empty()}, {"hints", std::move(hints)}}, Json(nullptr));
            });
        return;
    }
    on_result(Json(nullptr), invalid("LSP_BAD_KIND", "unknown semantic kind"));
}

// An error when the server explicitly declined the provider `kind` needs, so the
// UI is told why nothing came back instead of getting an empty success-shaped
// result. A server that said nothing at all (or whose handshake has not landed)
// is still asked: plenty of real servers implement more than they advertise.
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
        std::lock_guard lock(mutex_);
        timeout_ = timeout;
        for (auto& entry : hosts_) live.push_back(entry.second.get());
    }
    for (auto* host : live) host->set_timeout(timeout);
}

void Session::set_root(std::filesystem::path root) {
    {
        std::lock_guard lock(mutex_);
        root_ = std::move(root);
    }
    std::lock_guard edit(edit_mutex_);
    editor_.reset();  // any cached writer belongs to the previous root
    editor_root_.clear();
}

// The workspace handle behind server-driven edits. Opened on first use and then
// kept, so a burst of quick fixes pays the (one-off) tree walk only once. A
// shared handle: switching the root replaces it, but an edit already in flight on
// a reader thread keeps its own reference alive.
std::shared_ptr<Workspace> Session::editor_workspace(const std::filesystem::path& root) {
    std::lock_guard lock(edit_mutex_);
    if (!editor_ || editor_root_ != root) {
        auto candidate = std::make_shared<Workspace>();
        candidate->open(root);
        editor_ = std::move(candidate);
        editor_root_ = root;
    }
    return editor_;
}

// `workspace/applyEdit`, one document. `edits` arrive already sorted back to
// front, so splicing them in order can never invalidate a later edit's offsets.
std::optional<std::string> Session::apply_document_edits(const std::string& uri, const Json& edits, int version) {
    std::filesystem::path root;
    std::string text;
    bool tracked = false;
    {
        std::lock_guard lock(mutex_);
        root = root_;
        const auto document = documents_.find(uri_to_relative(uri, root_));
        if (document != documents_.end()) {
            // The server's view of an open document is the text we last synced, not
            // whatever is on disk; edits computed against it land on that text.
            if (version >= 0 && version != document->second.version)
                return "the document changed since the server read it (version " + std::to_string(version) +
                       " vs " + std::to_string(document->second.version) + ")";
            text = document->second.text;
            tracked = true;
        }
    }
    const auto relative = uri_to_relative(uri, root);
    // Reject anything the workspace layer would refuse: no absolute paths, no
    // drive letters, no `..`, so a hostile or buggy server cannot write outside.
    if (escapes_root(relative)) return "the edit targets " + uri + ", which is outside the workspace root";
    if (root.empty()) return "no workspace root is open, so the edit cannot be applied";

    Json current;
    try {
        current = editor_workspace(root)->read(relative, "utf-8");
    } catch (const WorkspaceError& error) {
        return std::string("cannot read ") + relative + ": " + error.what();
    } catch (const std::exception& error) {
        return std::string("cannot read ") + relative + ": " + error.what();
    }
    if (!tracked) text = current.value("content", std::string());
    if (!current.contains("version") || !current.at("version").is_string())
        return std::string("cannot read ") + relative;

    std::size_t cursor = text.size();  // edits are back-to-front: walk once, from the end
    for (const auto& edit : edits) {
        if (!edit.is_object() || !edit.contains("range") || !edit.at("range").is_object()) continue;
        const auto& range = edit.at("range");
        const auto start = range.contains("start") && range.at("start").is_object() ? range.at("start") : Json::object();
        const auto end = range.contains("end") && range.at("end").is_object() ? range.at("end") : Json::object();
        const auto line_at = [](const Json& point, const char* key) {
            return point.contains(key) && point.at(key).is_number_integer() ? point.at(key).get<int>() : 0;
        };
        const auto from = offset_of(text, line_at(start, "line"), line_at(start, "character"));
        auto to = offset_of(text, line_at(end, "line"), line_at(end, "character"));
        if (to < from) to = from;
        if (from > text.size()) continue;
        if (to > text.size()) to = text.size();
        if (from > cursor) continue;  // out of order or overlapping: skip rather than corrupt
        const auto replacement = edit.contains("newText") && edit.at("newText").is_string()
                                     ? edit.at("newText").get<std::string>() : std::string();
        text.replace(from, to - from, replacement);
        cursor = from;
    }

    try {
        editor_workspace(root)->write(relative, text, current.at("version").get<std::string>(),
                                      current.value("encoding", std::string("utf-8")),
                                      current.value("bom", false));
    } catch (const WorkspaceError& error) {
        return std::string("cannot write ") + relative + ": " + error.what();
    } catch (const std::exception& error) {
        return std::string("cannot write ") + relative + ": " + error.what();
    }
    {
        std::lock_guard lock(mutex_);
        const auto document = documents_.find(relative);
        if (document != documents_.end()) {
            document->second.text = text;   // keep the server's view and the file in step
            ++document->second.version;
        }
    }
    EditSink sink;
    {
        std::lock_guard lock(edit_mutex_);
        sink = on_edit_;
    }
    if (sink) sink(relative);
    return std::nullopt;
}

void Session::shutdown_all() noexcept {
    // The reader thread of a live host calls back into this session (diagnostics,
    // the deferred didOpen, code-action bookkeeping), and Host::stop() joins that
    // thread. Joining while holding mutex_ therefore deadlocks every single time,
    // so the hosts are moved out under the lock and stopped with it released.
    std::vector<std::unique_ptr<Host>> doomed;
    {
        std::lock_guard lock(mutex_);
        doomed.reserve(hosts_.size());
        for (auto& [language, host] : hosts_) doomed.push_back(std::move(host));
        hosts_.clear();
        documents_.clear();
        pending_actions_.clear();
        ready_.clear();
        capabilities_.clear();
    }
    for (auto& host : doomed) {
        if (!host) continue;
        try {
            host->request("shutdown", Json(nullptr), [](Json, Json) {});
        } catch (...) {
            // A host that cannot even take the request is stopped below anyway.
        }
        host->stop();  // joins the reader thread; mutex_ is NOT held here
    }
}

}  // namespace lsp
}  // namespace taocode
