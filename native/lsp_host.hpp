#pragma once

#include <atomic>
#include <chrono>
#include <filesystem>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "lsp.hpp"

namespace taocode {
namespace lsp {

// Owns one language-server child process and its two stdio pipes. A reader
// thread decodes the server's stdout and drives a Client; all Client access is
// serialised so the reader thread and the caller never race the pending-request
// map. Handlers (hover result, diagnostics) run on the reader thread — callers
// must marshal to their UI thread exactly like the clone events do.
class Host {
public:
    struct Spec {
        std::filesystem::path executable;
        std::vector<std::wstring> arguments;
        std::filesystem::path working_directory;
    };
    using Ready = Client::Handler;

    Host();
    ~Host();
    Host(const Host&) = delete;
    Host& operator=(const Host&) = delete;

    // Spawns the server and runs the initialize handshake. `on_ready` fires once
    // with the server capabilities (or an error) on the reader thread.
    void start(const Spec& spec, Json initialize_params, Ready on_ready);
    void stop() noexcept;
    bool alive() const { return alive_; }

    void set_diagnostics(Client::Notify handler);
    void set_configuration(Json settings);
    // Wiring used by the session layer: the workspace writer behind
    // `workspace/applyEdit` and the sync kind the server announced.
    void set_document_editor(Client::DocumentEditor editor);
    void set_sync_kind(SyncKind kind);
    // How long a request may stay unanswered before the client fails it itself.
    void set_timeout(std::chrono::milliseconds timeout);
    void did_open(std::string uri, std::string language_id, int version, std::string text);
    void did_change(std::string uri, int version, std::string full_text);
    void did_close(std::string uri);
    // Sends a request and returns the id the server will answer with.
    std::int64_t request(std::string_view method, Json params, Client::Handler on_result);

private:
    struct Pipe;
    // Caret-driven requests: a newer one supersedes the older, which is cancelled
    // instead of holding a pending slot until the 60s deadline. Guarded by its own
    // leaf mutex so a cancellation never happens while io_mutex_ is held.
    static bool is_superseding(std::string_view method);
    std::mutex inflight_mutex_;
    std::map<std::string, std::int64_t> in_flight_;
    void write_frame(std::string_view frame);  // caller holds io_mutex_

    mutable std::recursive_mutex io_mutex_;  // the pipes only: never held while a callback runs
    Client client_;
    std::unique_ptr<Pipe> pipe_;
    std::thread reader_;
    std::atomic<bool> alive_{false};
};

}  // namespace lsp
}  // namespace taocode
