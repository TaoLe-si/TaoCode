#pragma once

#include <condition_variable>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "workspace.hpp"

namespace taocode::terminal {

// ConPTY engine: every terminal is a real interactive console process (%COMSPEC%,
// normally cmd.exe) attached to a Windows pseudo console, so the shell renders its
// own ANSI/VT into a pipe that we stream verbatim to xterm.js. Bytes are carried
// untouched in both directions — nothing is decoded, stripped or re-encoded here,
// because the front end owns terminal semantics and the raw stream is not reliably
// UTF-8. create/resize/kill/kill_all run on the caller (UI) thread; the output
// callback fires on that terminal's own reader thread and must not re-enter.
// Keystrokes are queued and written by a per-terminal writer thread, so a shell
// that stops reading its input can never freeze the window.
class Manager {
public:
    using OutputCb = std::function<void(int id, std::string_view bytes)>;
    // Fires once a shell exits by itself (never for kill/kill_all), on that
    // terminal's reader thread, with the shell's real exit code. The terminal is
    // already out of ids() when it runs, so its slot is free for the next one.
    // A code of -1 means the process was still alive when the pseudo console closed
    // and had to be terminated with the rest of the job.
    using ExitCb = std::function<void(int id, int exit_code)>;

    // Out of line: both touch the terminal map, whose value type is only complete
    // inside the .cpp. The destructor closes every terminal, so nothing outlives us.
    Manager();
    ~Manager();
    Manager(const Manager&) = delete;
    Manager& operator=(const Manager&) = delete;

    // Spawns a shell in a cols x rows pseudo console and returns its id (positive,
    // never reused). The overload chooses the shell's starting folder (empty keeps
    // ours). Throws WorkspaceError "TERMINAL_UNAVAILABLE" without ConPTY,
    // "TERMINAL_SPAWN" when the pseudo console or shell cannot start,
    // "TERMINAL_SIZE" for a bad size, "TERMINAL_LIMIT" above 64 open terminals.
    int create(int cols, int rows, OutputCb on_output);
    int create(int cols, int rows, std::wstring working_directory, OutputCb on_output);

    // Raw keystrokes into the pseudo console (UTF-8/ANSI bytes from xterm.js) and
    // the matching window size. Both throw "TERMINAL_GONE" for an unknown id; a
    // write to an exited shell is dropped and a rejected resize is transient.
    // write() only queues: it returns immediately even if the shell is not reading.
    void write(int id, std::string_view bytes);
    void resize(int id, int cols, int rows);
    void kill(int id);  // terminates the whole process tree; idempotent
    bool running(int id) const;  // false once the shell has exited by itself
    std::vector<int> ids() const;  // open terminals; a shell that exited is dropped
    void kill_all();               // app shutdown: no shell is left behind
    void on_exit(ExitCb callback);  // nullptr clears it

private:
    // Queued keystrokes plus the write end of the input pipe. Shared with the
    // writer thread so a session that has to be abandoned can detach that thread
    // without leaving it with a dangling queue.
    struct Input {
        std::mutex mutex;
        std::condition_variable ready;
        std::deque<std::string> queue;
        bool open = false;
        void* pipe = nullptr;  // HANDLE, owned by the Input
    };

    struct Session;  // one shell + pseudo console + reader thread
    std::unique_ptr<Session> take(int id);
    void reap_zombies();  // destroys the sessions whose shell already exited
    static void reap(std::unique_ptr<Session> session);
    static void drain_input(const std::shared_ptr<Input>& input);

    mutable std::mutex mutex_;
    std::map<int, std::unique_ptr<Session>> sessions_;
    std::vector<std::unique_ptr<Session>> zombies_;  // shells that exited on their own
    ExitCb on_exit_;
    int next_id_ = 1;
};

}  // namespace taocode::terminal
