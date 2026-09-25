#include "lsp.hpp"

#include <cstdint>
#include <iostream>
#include <optional>
#include <string>
#include <vector>

namespace {
using taocode::Json;
using taocode::WorkspaceError;
using taocode::lsp::MessageReader;
namespace lsp = taocode::lsp;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

template <class Operation>
void expect_protocol(Operation&& operation) {
    try {
        operation();
    } catch (const WorkspaceError& error) {
        check(error.code == "LSP_PROTOCOL", "expected LSP_PROTOCOL, got " + error.code + ": " + error.what());
        return;
    }
    throw std::runtime_error("expected an LSP_PROTOCOL error, none was thrown");
}

// Captures the frames a Client writes and decodes them back, so tests can assert
// on the exact JSON-RPC the client emits without a real server.
struct Harness {
    std::vector<std::string> frames;
    MessageReader reader;
    taocode::lsp::Client client{[this](std::string_view frame) { frames.emplace_back(frame); }};

    std::vector<Json> drain() {
        for (const auto& frame : frames) reader.feed(frame);
        frames.clear();
        std::vector<Json> written;
        while (const auto message = reader.next()) written.push_back(*message);
        return written;
    }
};

}  // namespace

int main() {
    int failures = 0;
    int passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try {
            operation();
            ++passed;
            std::cout << "PASS " << name << '\n';
        } catch (const std::exception& error) {
            ++failures;
            std::cerr << "FAIL " << name << ": " << error.what() << '\n';
        }
    };

    run("single message round-trips", [&] {
        const Json outbound = lsp::make_notification("window/logMessage", {{"type", 3}, {"message", "hello"}});
        MessageReader reader;
        reader.feed(lsp::encode_message(outbound));
        const auto inbound = reader.next();
        check(inbound.has_value(), "a complete frame must yield a message");
        check(*inbound == outbound, "decoded message must equal the encoded message");
        check(!reader.next().has_value(), "the buffer must be drained after one message");
    });

    run("request builder carries id and method", [&] {
        const Json outbound = lsp::make_request(7, "textDocument/hover", {{"textDocument", {{"uri", "file:///a"}}}});
        MessageReader reader;
        reader.feed(lsp::encode_message(outbound));
        const auto message = *reader.next();
        check(message.at("id") == 7, "id must round-trip");
        check(message.at("method") == "textDocument/hover", "method must round-trip");
        check(message.at("jsonrpc") == "2.0", "jsonrpc version must be present");
    });

    run("multiple frames in one feed drain in order", [&] {
        std::string stream = lsp::encode_message(lsp::make_notification("a", Json::object()));
        stream += lsp::encode_message(lsp::make_notification("b", Json::object()));
        stream += lsp::encode_message(lsp::make_notification("c", Json::object()));
        MessageReader reader;
        reader.feed(stream);
        check(reader.next()->at("method") == "a", "first message");
        check(reader.next()->at("method") == "b", "second message");
        check(reader.next()->at("method") == "c", "third message");
        check(!reader.next().has_value(), "no message remains");
    });

    run("byte-at-a-time reassembly including UTF-8", [&] {
        const Json outbound = lsp::make_notification("textDocument/didOpen",
                                                {{"textDocument", {{"uri", "file:///中/文.java"}, {"languageId", "java"}}}});
        const std::string frame = lsp::encode_message(outbound);
        MessageReader reader;
        std::optional<Json> message;
        std::size_t consumed = 0;
        for (const char ch : frame) {
            reader.feed(std::string_view(&ch, 1));
            ++consumed;
            if (const auto candidate = reader.next()) {
                message = candidate;
                break;
            }
        }
        check(message.has_value(), "the message must complete on its final byte");
        check(consumed == frame.size(), "the frame must complete only after every byte is fed");
        check(*message == outbound, "multibyte body must reassemble exactly");
    });

    run("partial frames wait for more bytes", [&] {
        const std::string frame = lsp::encode_message(lsp::make_notification("x", Json::object()));
        const auto separator = frame.find("\r\n\r\n");
        MessageReader reader;
        reader.feed(frame.substr(0, separator));  // header line, blank line not yet arrived
        check(!reader.next().has_value(), "an unterminated header must not parse");
        reader.feed("\r\n\r\n");                  // headers complete, body still empty
        check(!reader.next().has_value(), "headers without the full body must not parse");
        reader.feed(frame.substr(separator + 4));  // the body arrives
        check(reader.next().has_value(), "the message completes once the body arrives");
        check(!reader.next().has_value(), "and the buffer drains");
    });

    run("Content-Type and header whitespace are tolerated", [&] {
        const std::string body = R"({"method":"ping","id":1})";
        MessageReader reader;
        reader.feed("Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length :   " +
                    std::to_string(body.size()) + "\r\n\r\n" + body);
        const auto message = reader.next();
        check(message.has_value(), "a case-insensitive, space-padded content-length must be honoured");
        check(message->at("method") == "ping", "body must decode");
    });

    run("protocol faults reject cleanly", [&] {
        expect_protocol([&] { MessageReader r; r.feed("X-Odd: 1\r\n\r\n{}"); r.next(); });              // missing length
        expect_protocol([&] { MessageReader r; r.feed("Content-Length: two\r\n\r\n{}"); r.next(); });   // non-numeric
        expect_protocol([&] { MessageReader r; r.feed("Content-Length: 0\r\n\r\n"); r.next(); });       // zero
        expect_protocol([&] { MessageReader r; r.feed("Content-Length: 3\r\n\r\n{[}"); r.next(); });    // bad JSON
        expect_protocol([&] { MessageReader r; r.feed("Content-Length: 2\r\nContent-Length: 3\r\n\r\n{}"); r.next(); });  // duplicate
        expect_protocol([&] { MessageReader r; r.feed("Content-Length: 1000000000\r\n\r\nx"); r.next(); });  // over the limit
        expect_protocol([&] { MessageReader r; r.feed(std::string(lsp::max_header_bytes + 8, 'A')); r.next(); });  // no terminator
    });

    run("message classification", [&] {
        check(lsp::is_response({{"jsonrpc", "2.0"}, {"id", 1}, {"result", Json::object()}}), "result is a response");
        check(lsp::is_response({{"jsonrpc", "2.0"}, {"id", 1}, {"error", {{"code", -32601}, {"message", "x"}}}}), "error is a response");
        check(lsp::is_server_request({{"jsonrpc", "2.0"}, {"id", 2}, {"method", "workspace/applyEdit"}}), "id+method is a server request");
        check(lsp::is_notification({{"jsonrpc", "2.0"}, {"method", "textDocument/publishDiagnostics"}, {"params", Json::object()}}), "method without id is a notification");
        check(!lsp::is_notification({{"jsonrpc", "2.0"}, {"id", 3}, {"method", "x"}}), "a request is not a notification");
        check(!lsp::is_response({{"jsonrpc", "2.0"}, {"id", 3}, {"method", "x"}}), "a server request is not a response");
    });

    run("initialize handshake emits request then initialized", [&] {
        Harness h;
        int callbacks = 0;
        h.client.start({{"capabilities", Json::object()}}, [&](Json, Json error) { ++callbacks; check(error.is_null(), "initialize must succeed"); });
        auto written = h.drain();
        check(written.size() == 1, "only the initialize request is sent before a reply");
        check(written[0].at("method") == "initialize", "first frame is initialize");
        check(written[0].contains("id"), "initialize is a request");
        check(!h.client.ready(), "not ready until the server replies");
        h.client.receive({{"jsonrpc", "2.0"}, {"id", written[0].at("id")}, {"result", {{"capabilities", Json::object()}}}});
        written = h.drain();
        check(written.size() == 1 && written[0].at("method") == "initialized" && !written[0].contains("id"), "initialized notification follows");
        check(h.client.ready(), "client is ready after the handshake");
        check(callbacks == 1, "start callback fired exactly once");
    });

    run("start twice is a protocol fault", [&] {
        Harness h;
        h.client.start(Json::object(), [](Json, Json) {});
        h.drain();
        expect_protocol([&] { h.client.start(Json::object(), [](Json, Json) {}); });
    });

    run("responses correlate by id and errors surface", [&] {
        Harness h;
        h.client.start(Json::object(), [](Json, Json) {});
        h.drain();
        h.client.receive({{"jsonrpc", "2.0"}, {"id", 1}, {"result", Json::object()}});
        h.drain();  // flush the initialized notification before issuing feature requests
        int hover_hits = 0, other_hits = 0;
        h.client.request("textDocument/hover", Json::object(), [&](Json result, Json error) {
            ++hover_hits;
            check(error.is_null(), "hover must succeed");
            check(result.at("contents").get<std::string>() == "hi", "result delivered");
        });
        h.client.request("textDocument/definition", Json::object(), [&](Json, Json error) {
            ++other_hits;
            check(!error.is_null(), "error delivered for failed request");
            check(error.at("code").get<int>() == -32601, "server error code preserved");
        });
        auto written = h.drain();
        check(written.size() == 2, "two feature requests written");
        const auto hover_id = written[0].at("id");
        const auto def_id = written[1].at("id");
        // Out-of-order replies must still hit the right callback.
        h.client.receive({{"jsonrpc", "2.0"}, {"id", def_id}, {"error", {{"code", -32601}, {"message", "no"}}}});
        check(other_hits == 1 && hover_hits == 0, "definition callback fired only");
        h.client.receive({{"jsonrpc", "2.0"}, {"id", hover_id}, {"result", {{"contents", "hi"}}}});
        check(hover_hits == 1, "hover callback fired");
        h.client.receive({{"jsonrpc", "2.0"}, {"id", hover_id}, {"result", Json::object()}});  // replayed
        check(hover_hits == 1, "a duplicate response for a completed id is ignored");
    });

    run("publishDiagnostics notification routes to handler", [&] {
        Harness h;
        Json delivered = nullptr;
        h.client.on_diagnostics([&](Json params) { delivered = std::move(params); });
        h.client.receive({{"jsonrpc", "2.0"}, {"method", "textDocument/publishDiagnostics"}, {"params", {{"uri", "file:///a"}, {"diagnostics", Json::array()}}}});
        check(delivered != nullptr && delivered.at("uri") == "file:///a", "diagnostics params forwarded");
    });

    run("server requests are auto-answered", [&] {
        Harness h;
        h.client.receive({{"jsonrpc", "2.0"}, {"id", 50}, {"method", "client/registerCapability"}, {"params", Json::object()}});
        h.client.receive({{"jsonrpc", "2.0"}, {"id", "server-string-id"}, {"method", "client/somethingUnimplemented"}});
        auto written = h.drain();
        check(written.size() == 2, "one response per server request");
        check(written[0].at("id") == 50 && written[0].contains("result"), "registerCapability gets a null result");
        check(written[1].at("id") == "server-string-id" && written[1].at("error").at("code") == -32601, "unknown method preserves the id type and gets MethodNotFound");
    });

    run("workspace/configuration answers nested sections and live updates", [&] {
        Harness h;
        h.client.set_configuration({{"java", {{"project", {{"sourcePaths", Json::array({"src"})}}}}}});
        h.client.start(Json::object(), [](Json, Json) {});
        auto written = h.drain();
        check(written.size() == 1 && written[0].at("method") == "initialize", "configuration does not send before initialized");
        h.client.receive({{"jsonrpc", "2.0"}, {"id", written[0].at("id")}, {"result", Json::object()}});
        written = h.drain();
        check(written.size() == 2 && written[1].at("method") == "workspace/didChangeConfiguration" &&
                  written[1].at("params").at("settings").at("java").at("project").at("sourcePaths")[0] == "src",
              "initialized handshake is followed by the current settings");
        h.client.receive({{"jsonrpc", "2.0"}, {"id", 70}, {"method", "workspace/configuration"},
                          {"params", {{"items", Json::array({{{"section", "java.project.sourcePaths"}}, {{"section", "java.missing"}}})}}}});
        written = h.drain();
        check(written.size() == 1 && written[0].at("result").size() == 2 &&
                  written[0].at("result")[0][0] == "src" && written[0].at("result")[1].is_null(),
              "each requested section receives its own value or null");
        h.client.set_configuration({{"java", {{"project", {{"sourcePaths", Json::array({"main/src"})}}}}}});
        written = h.drain();
        check(written.size() == 1 && written[0].at("method") == "workspace/didChangeConfiguration" &&
                  written[0].at("params").at("settings").at("java").at("project").at("sourcePaths")[0] == "main/src",
              "a ready client publishes configuration changes immediately");
    });

    run("shutdown emits shutdown request then exit notification", [&] {
        Harness h;
        h.client.start(Json::object(), [](Json, Json) {});
        h.drain();
        h.client.receive({{"jsonrpc", "2.0"}, {"id", 1}, {"result", Json::object()}});
        h.drain();
        h.client.shutdown([](Json, Json error) { check(error.is_null(), "shutdown succeeded"); });
        auto written = h.drain();
        check(written.size() == 1 && written[0].at("method") == "shutdown", "shutdown request sent");
        h.client.receive({{"jsonrpc", "2.0"}, {"id", written[0].at("id")}, {"result", Json(nullptr)}});
        written = h.drain();
        check(written.size() == 1 && written[0].at("method") == "exit" && !written[0].contains("id"), "exit notification sent");
        check(h.client.state() == lsp::Client::State::stopped, "client reaches stopped");
    });

    run("did_close writes a textDocument/didClose notification", [&] {
        // Editor lifecycle: closing a tab must send didClose so the server drops
        // its stale buffer and diagnostics (matches LSP spec, IDEA's Session.close).
        Harness h;
        h.client.start(Json::object(), [](Json, Json) {});
        h.drain();
        h.client.receive({{"jsonrpc", "2.0"}, {"id", 1}, {"result", Json::object()}});
        h.drain();
        h.client.did_close("file:///workspace/Main.java");
        auto written = h.drain();
        check(written.size() == 1 && written[0].at("method") == "textDocument/didClose", "didClose is sent");
        check(written[0].at("params").at("textDocument").at("uri").get<std::string>() == "file:///workspace/Main.java",
              "the closing uri is the document's, not the workspace's");
    });

run("fail_pending answers pending requests when the server dies", [&] {
        // Regression: an unreadable or exited server must not leave pending_ entries
        // that no one will ever resolve; every outstanding request gets an error
        // immediately rather than hanging the bridge forever.
        Harness h;
        h.client.start(Json::object(), [](Json, Json) {});
        h.drain();
        h.client.receive({{"jsonrpc", "2.0"}, {"id", 1}, {"result", Json::object()}});
        h.drain();
        std::vector<std::pair<Json, bool>> delivered;
        for (int i = 0; i < 3; ++i) {
            h.client.request("test/feature/" + std::to_string(i), Json::object(),
                [&delivered](Json result, Json error) { delivered.push_back({result, error.is_null()}); });
        }
        h.client.fail_pending("LSP_CLOSED");
        check(delivered.size() == 3, "every pending request was answered (got " + std::to_string(delivered.size()) + ")");
        for (auto& [_, ok] : delivered) check(!ok, "the answers report failure, not success");
    });

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
