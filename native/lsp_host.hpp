#pragma once

#include <atomic>
#include <filesystem>
#include <functional>
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
    void did_open(std::string uri, std::string language_id, int version, std::string text);
    void did_change(std::string uri, int version, std::string full_text);
    void did_close(std::string uri);
    void request(std::string_view method, Json params, Client::Handler on_result);

private:
    struct Pipe;
    void write_frame(std::string_view frame);  // caller holds io_mutex_

    mutable std::recursive_mutex io_mutex_;
    Client client_;
    std::unique_ptr<Pipe> pipe_;
    std::thread reader_;
    std::atomic<bool> alive_{false};
};

}  // namespace lsp
}  // namespace taocode
