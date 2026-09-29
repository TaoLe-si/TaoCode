// 假 LSP 服务器的 helper、会话状态与出帧 —— 见 lsp_fake_server.hpp 的模块说明。
#include "lsp_fake_server.hpp"

namespace fake_server {

std::string opened_uri;
std::string document_text;
bool saw_source_paths = false;

namespace {
Sender g_sender;
}  // namespace

void set_sender(Sender send) { g_sender = std::move(send); }
void write_message(const Json& message) {
    if (g_sender) g_sender(message);
}


// A sibling uri in the same directory as `uri`, so the caller can exercise the
// client's uri -> workspace-relative path mapping on a second file.
std::string sibling_of(const std::string& uri, const std::string& name) {
    const auto slash = uri.find_last_of('/');
    return slash == std::string::npos ? "file:///" + name : uri.substr(0, slash + 1) + name;
}

Json range(int start_line, int start_char, int end_line, int end_char) {
    return {{"start", {{"line", start_line}, {"character", start_char}}},
            {"end", {{"line", end_line}, {"character", end_char}}}};
}

Json location(const std::string& uri, int start_line, int start_char, int end_line, int end_char) {
    return {{"uri", uri}, {"range", range(start_line, start_char, end_line, end_char)}};
}

// One UTF-8 code point's byte length from its lead byte.
std::size_t step_of(unsigned char lead) {
    if (lead >= 0xF0) return 4;
    if (lead >= 0xE0) return 3;
    if (lead >= 0xC0) return 2;
    return 1;
}

// LSP (line, character) -> byte offset, with `character` in UTF-16 code units like
// the protocol says. Clamped to the text, so a stale range cannot crash the server.
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
        const auto step = step_of(static_cast<unsigned char>(text[index]));
        units += step == 4 ? 2 : 1;
        index += step;
    }
    return index;
}

// The identifier being typed: the trailing [A-Za-z0-9_] run of the line prefix.
std::string prefix_of(const std::string& text, int line, int character) {
    std::size_t position = 0;
    for (int current = 0; current != line; ++current) {
        const auto newline = text.find('\n', position);
        if (newline == std::string::npos) return {};
        position = newline + 1;
    }
    const auto end = offset_of(text, line, character);
    auto start = end;
    while (start != position) {
        const auto previous = start - 1;
        const unsigned char byte = static_cast<unsigned char>(text[previous]);
        const bool identifier = (byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z') ||
                                (byte >= '0' && byte <= '9') || byte == '_';
        if (!identifier) break;
        start = previous;
    }
    return text.substr(start, end - start);
}

// Replaces [start,end) with `text`, the way a TextDocumentEdit is applied. Edits
// arrive back-to-front, so earlier offsets stay valid.
void splice(std::string& document, const Json& span, const std::string& replacement) {
    const auto start_point = span.contains("start") && span.at("start").is_object() ? span.at("start") : Json::object();
    const auto end_point = span.contains("end") && span.at("end").is_object() ? span.at("end") : Json::object();
    const auto number = [](const Json& point, const char* key) {
        return point.contains(key) && point.at(key).is_number_integer() ? point.at(key).get<int>() : 0;
    };
    const auto from = offset_of(document, number(start_point, "line"), number(start_point, "character"));
    auto to = offset_of(document, number(end_point, "line"), number(end_point, "character"));
    if (to < from) to = from;
    if (from > document.size()) return;
    if (to > document.size()) to = document.size();
    document.replace(from, to - from, replacement);
}

std::string requested(const Json& params) {
    const auto doc = params.contains("textDocument") && params.at("textDocument").is_object()
                         ? params.at("textDocument").value("uri", std::string()) : std::string();
    return doc.empty() ? (opened_uri.empty() ? std::string("file:///fake/Sample.java") : opened_uri) : doc;
}

}  // namespace fake_server
