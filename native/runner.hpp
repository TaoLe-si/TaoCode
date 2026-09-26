#pragma once

#include <atomic>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace taocode {

// Runs a build/debug/program command as a child process with piped stdio and
// streams merged stdout+stderr to the caller. A reader thread delivers output
// chunks (called on that thread) and a final exit code, so the caller marshals
// to its UI thread exactly like the clone/LSP events do. Line stdin is offered
// for interactive programs and is queued onto a writer thread, so typing never
// blocks the UI when the child is not draining its input. This is a console
// runner, not a full ANSI terminal.
class Runner {
public:
    struct Spec {
        std::wstring command;
        std::vector<std::wstring> arguments;
        std::filesystem::path working_directory;
        // Extra environment variables (KEY=VALUE), applied on top of the inherited
        // block. IDEA's Run Configuration "Environment variables" field lands here.
        std::vector<std::wstring> environment;
    };

    // One output callback invocation carries the child's bytes three ways, because
    // child output is bytes in some unknown codepage (cl.exe prints GBK on a zh-CN
    // machine) and JSON is text:
    //   - bytes:   exactly what the child wrote, binary safe, never re-encoded
    //   - dataB64: base64 of `bytes` — the lossless transport (same contract as the
    //              terminal's dataB64), decode it into a Uint8Array and let the UI
    //              decide how to render
    //   - text:    a best-effort UTF-8 rendering for callers that just want a string.
    //              A multi-byte sequence split across two chunks is carried into the
    //              next chunk instead of being turned into mojibake.
    // The implicit conversion to string_view yields `text`, so existing
    // `void(std::string_view)` callbacks keep working untouched.
    struct Chunk {
        std::string_view bytes;
        std::string_view dataB64;
        std::string_view text;
        operator std::string_view() const noexcept { return text; }
    };
    using Output = std::function<void(const Chunk&)>;
    using Done = std::function<void(int exit_code)>;

    Runner();
    ~Runner();
    Runner(const Runner&) = delete;
    Runner& operator=(const Runner&) = delete;

    // Throws WorkspaceError("RUN_SPAWN", ...) if the process cannot start.
    void start(const Spec& spec, Output on_output, Done on_done);
    // Queues one line for the child's stdin and returns immediately; the writer
    // thread drains the queue in order. Input for a child that is gone is dropped.
    void write_line(const std::string& line);
    void stop() noexcept;
    bool running() const { return running_.load(); }
    // OS process id of the live child, or 0 when nothing is running. The DAP
    // `runInTerminal` answer carries it so an adapter can attach to — or kill —
    // the program it just asked the host to start.
    unsigned long process_id() const;

private:
    // Shared with the writer thread: the queue of lines still to be written plus the
    // pipe they go to. It is shared rather than owned by *this* so a writer that
    // cannot be joined in time can be detached without dangling state.
    struct Input {
        std::mutex mutex;
        std::condition_variable ready;
        std::deque<std::string> queue;
        bool open = false;
        void* pipe = nullptr;  // HANDLE, owned by the Input
    };

    void reader_loop();
    static void drain_input(const std::shared_ptr<Input>& input);
    void close_input() noexcept;   // stops accepting input and wakes the writer
    void finish_input() noexcept;  // close_input() plus a bounded join

    std::mutex mutex_;
    std::mutex input_mutex_;    // guards input_/writer_; never held across a join
    void* stdout_read_ = nullptr;   // HANDLE
    void* process_ = nullptr;       // HANDLE
    void* thread_ = nullptr;        // HANDLE
    void* job_ = nullptr;           // HANDLE (kills the whole tree on close/stop)
    std::thread reader_;
    std::thread writer_;
    std::shared_ptr<Input> input_;
    std::atomic<bool> running_{false};
    Output on_output_;
    Done on_done_;
};

}  // namespace taocode
