// Self-test for the ConPTY engine against a real shell: spawn a pseudo console,
// type a command, see the marker come back verbatim inside the ANSI stream, resize,
// kill, and leave nothing running. Prints "SKIP terminal" and exits 0 only when the
// OS has no ConPTY, so a downlevel machine never reports a false failure.
#include "terminal.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <chrono>
#include <condition_variable>
#include <iostream>
#include <map>
#include <mutex>
#include <string>
#include <string_view>

namespace {
using taocode::WorkspaceError;
using taocode::terminal::Manager;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

std::string escape(const std::string& bytes) {
    std::string text;
    for (const char value : bytes) {
        const auto code = static_cast<unsigned char>(value);
        if (code == '\x1b') text += "<ESC>";
        else if (code == '\r') text += "<CR>";
        else if (code == '\n') text += "<LF>";
        else if (code >= 0x20 && code < 0x7f) text += static_cast<char>(code);
        else {
            text += "<";
            static const char* hex = "0123456789abcdef";
            text += hex[code >> 4];
            text += hex[code & 0x0f];
            text += ">";
        }
    }
    return text;
}

// Monotonically growing byte buffer written by the terminal's reader thread, with
// the condition-variable waits the checks poll (same shape as lsp_session_test.cpp).
struct Sink {
    mutable std::mutex mutex;
    mutable std::condition_variable ready;
    std::string bytes;

    void push(std::string_view chunk) {
        {
            const std::lock_guard lock(mutex);
            bytes.append(chunk);
        }
        ready.notify_all();
    }

    bool printed(int seconds) const {
        std::unique_lock lock(mutex);
        return ready.wait_for(lock, std::chrono::seconds(seconds), [this] { return !bytes.empty(); });
    }

    // The buffer only ever grows, so re-searching it on every wake-up cannot miss a
    // marker that arrives split across two output chunks.
    bool contains(const std::string& needle, int seconds) const {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
        std::unique_lock lock(mutex);
        while (bytes.find(needle) == std::string::npos) {
            if (ready.wait_until(lock, deadline) == std::cv_status::timeout)
                return bytes.find(needle) != std::string::npos;
        }
        return true;
    }

    std::string snapshot() const {
        std::unique_lock lock(mutex);
        return bytes;
    }
};
}  // namespace

int main() {
    // A throwaway terminal says whether this machine has ConPTY at all.
    {
        Manager probe;
        try {
            const int id = probe.create(80, 24, [](int, std::string_view) {});
            probe.kill(id);
        } catch (const WorkspaceError& error) {
            if (error.code != "TERMINAL_UNAVAILABLE") {
                std::cerr << "FAIL terminal probe: " << error.code << " " << error.what() << '\n';
                return 1;
            }
            std::cout << "SKIP terminal: " << error.what() << '\n';
            return 0;
        }
    }

    // Manager owns every shell it spawns and reaps them in its destructor, so no
    // path — not even a thrown check — can orphan a cmd.exe.
    Manager manager;
    std::map<int, Sink> sinks;
    const auto attach = [&](int id) -> Sink& { return sinks[id]; };
    const auto on_output = [&](int id, std::string_view bytes) { attach(id).push(bytes); };
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };
    const auto stopped = [&](int id) {
        for (int tick = 0; tick < 50 && manager.running(id); ++tick) Sleep(100);
        return !manager.running(id);
    };
    int survivor = 0;

    run("create returns a positive id for a live pseudo console", [&] {
        const int id = manager.create(80, 24, on_output);
        check(id > 0, "expected a positive terminal id, got " + std::to_string(id));
        check(manager.running(id), "the new terminal should be running");
        attach(id);
        survivor = id;
    });

    run("typed bytes drive the shell and its output streams back verbatim", [&] {
        const int id = manager.create(80, 24, on_output);
        Sink& sink = attach(id);
        check(sink.printed(5), "the shell never printed a prompt");
        manager.write(id, "echo TAOOKENV_MARKER\r");
        check(sink.contains("TAOOKENV_MARKER", 3), "no marker within 3s of echo: " + escape(sink.snapshot().substr(0, 600)));
        manager.kill(id);
        check(!manager.running(id), "a killed terminal is not running");
    });

    run("resize is accepted by a live terminal", [&] {
        const int id = manager.create(80, 24, on_output);
        attach(id);
        manager.resize(id, 20, 60);
        manager.resize(id, 132, 43);
        manager.kill(id);
    });

    run("kill drops the terminal and stays idempotent", [&] {
        const int id = manager.create(80, 24, on_output);
        attach(id);
        manager.kill(id);
        check(!manager.running(id), "running() is false after kill");
        manager.kill(id);
        bool rejected = false;
        try { manager.write(id, "dir\r"); } catch (const WorkspaceError& error) { rejected = error.code == "TERMINAL_GONE"; }
        check(rejected, "writing to a closed terminal throws TERMINAL_GONE");
    });

    run("a shell that exits by itself stops being reported as running", [&] {
        const int id = manager.create(80, 24, on_output);
        Sink& sink = attach(id);
        check(sink.printed(5), "the shell never printed a prompt");
        manager.write(id, "exit\r");
        check(stopped(id), "the shell was still running 5s after typing exit");
        manager.kill(id);
    });

    run("kill_all leaves nothing running", [&] {
        const int first = manager.create(80, 24, on_output);
        const int second = manager.create(40, 12, on_output);
        attach(first);
        attach(second);
        check(manager.running(first) && manager.running(second), "both terminals are running");
        check(manager.ids().size() >= 2, "the open terminals are listed");
        manager.kill_all();
        check(!manager.running(first) && !manager.running(second), "nothing runs after kill_all");
        check(manager.ids().empty(), "no terminal left behind after kill_all");
    });

    manager.kill(survivor);  // the first terminal deliberately outlived its own check
    check(manager.ids().empty(), "every terminal was reaped");
    std::cout << passed << " passed, " << failures << " failed, " << sinks.size() << " terminals observed\n";
    return failures == 0 ? 0 : 1;
}
