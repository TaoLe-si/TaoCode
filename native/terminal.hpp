#pragma once

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
class Manager {
public:
    using OutputCb = std::function<void(int id, std::string_view bytes)>;

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
    void write(int id, std::string_view bytes);
    void resize(int id, int cols, int rows);
    void kill(int id);  // terminates the whole process tree; idempotent
    bool running(int id) const;  // false once the shell has exited by itself
    std::vector<int> ids() const;  // open terminals, including shells that exited
    void kill_all();               // app shutdown: no shell is left behind

private:
    struct Session;  // one shell + pseudo console + reader thread
    std::unique_ptr<Session> take(int id);
    static void reap(std::unique_ptr<Session> session);

    mutable std::mutex mutex_;
    std::map<int, std::unique_ptr<Session>> sessions_;
    int next_id_ = 1;
};

}  // namespace taocode::terminal
