// Verifies the build/run console against a real child process: streamed output,
// merged stderr, exit code propagation, stdin line input, and stop().
#include "runner.hpp"

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
#include <mutex>
#include <string>

namespace {
using taocode::Runner;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

struct Collector {
    std::mutex mutex;
    std::condition_variable ready;
    std::string output;
    bool done = false;
    int code = -1;
    void wait(int seconds = 15) {
        std::unique_lock lock(mutex);
        if (!ready.wait_for(lock, std::chrono::seconds(seconds), [&] { return done; }))
            throw std::runtime_error("runner did not finish in time");
    }
};
}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    run("streams stdout and reports exit code", [&] {
        Collector collector;
        Runner runner;
        runner.start({L"cmd.exe", {L"/c", L"echo hello-from-build"}, L""},
                     [&](std::string_view chunk) { std::lock_guard lock(collector.mutex); collector.output.append(chunk); },
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        collector.wait(15);
        check(collector.output.find("hello-from-build") != std::string::npos, "stdout not streamed: " + collector.output);
        check(collector.code == 0, "expected exit code 0, got " + std::to_string(collector.code));
        check(!runner.running(), "runner should not be running after completion");
    });

    run("merges stderr and propagates non-zero exit", [&] {
        Collector collector;
        Runner runner;
        runner.start({L"cmd.exe", {L"/c", L"echo oops 1>&2 & exit 42"}, L""},
                     [&](std::string_view chunk) { std::lock_guard lock(collector.mutex); collector.output.append(chunk); },
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        collector.wait(15);
        check(collector.output.find("oops") != std::string::npos, "stderr not merged: " + collector.output);
        check(collector.code == 42, "expected exit code 42, got " + std::to_string(collector.code));
    });

    run("accepts stdin line input", [&] {
        Collector collector;
        Runner runner;
        // set /p reads a line from stdin; delayed expansion (!VAR!) is required
        // because %VAR% would be substituted at parse time, before set /p runs.
        runner.start({L"cmd.exe", {L"/v:on", L"/c", L"set /p ANSWER= & echo got=!ANSWER!"}, L""},
                     [&](std::string_view chunk) { std::lock_guard lock(collector.mutex); collector.output.append(chunk); },
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        Sleep(300);  // let cmd reach the prompt
        runner.write_line("ping");
        collector.wait(15);
        check(collector.output.find("got=ping") != std::string::npos, "stdin echo missing: " + collector.output);
    });

    run("stop() terminates a long-running process", [&] {
        Collector collector;
        Runner runner;
        runner.start({L"cmd.exe", {L"/c", L"ping -n 30 127.0.0.1 >nul"}, L""},
                     [&](std::string_view) {},
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        check(runner.running(), "runner should be running");
        Sleep(300);
        runner.stop();
        collector.wait(15);
        check(!runner.running(), "runner stopped");
    });

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
