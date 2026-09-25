#pragma once

#include <atomic>
#include <filesystem>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace taocode {

// Runs a build/debug/program command as a child process with piped stdio and
// streams merged stdout+stderr to the caller. A reader thread delivers output
// chunks (called on that thread) and a final exit code, so the caller marshals
// to its UI thread exactly like the clone/LSP events do. Line stdin is offered
// for interactive programs; this is a console runner, not a full ANSI terminal.
class Runner {
public:
    struct Spec {
        std::wstring command;
        std::vector<std::wstring> arguments;
        std::filesystem::path working_directory;
    };
    using Output = std::function<void(std::string_view chunk)>;
    using Done = std::function<void(int exit_code)>;

    Runner();
    ~Runner();
    Runner(const Runner&) = delete;
    Runner& operator=(const Runner&) = delete;

    // Throws WorkspaceError("RUN_SPAWN", ...) if the process cannot start.
    void start(const Spec& spec, Output on_output, Done on_done);
    void write_line(const std::string& line);
    void stop() noexcept;
    bool running() const { return running_; }

private:
    void reader_loop();

    std::mutex mutex_;
    void* stdin_write_ = nullptr;   // HANDLE
    void* stdout_read_ = nullptr;   // HANDLE
    void* process_ = nullptr;       // HANDLE
    void* thread_ = nullptr;        // HANDLE
    void* job_ = nullptr;           // HANDLE (kills the whole tree on close/stop)
    std::thread reader_;
    std::atomic<bool> running_{false};
    Output on_output_;
    Done on_done_;
};

}  // namespace taocode
