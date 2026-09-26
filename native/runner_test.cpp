// Verifies the build/run console against a real child process: streamed output,
// merged stderr, exit code propagation, the parent environment plus overrides,
// base64 byte transport with lossless UTF-8 decoding, queued stdin line input that
// never blocks the caller, and stop().
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
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <string>

namespace {
using taocode::Runner;
namespace fs = std::filesystem;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

std::string base64_decode(const std::string& encoded) {
    static const std::string table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string bytes;
    unsigned accumulator = 0;
    int bits = 0;
    for (const char value : encoded) {
        if (value == '=') break;
        const auto digit = table.find(value);
        if (digit == std::string::npos) continue;
        accumulator = (accumulator << 6) | static_cast<unsigned>(digit);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push_back(static_cast<char>((accumulator >> bits) & 0xff));
        }
    }
    return bytes;
}

std::wstring wide(const std::string& text) {
    if (text.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring out(static_cast<std::size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), size);
    return out;
}

std::size_t count(const std::string& text, const std::string& needle) {
    std::size_t found = 0, at = 0;
    for (;;) {
        const auto hit = text.find(needle, at);
        if (hit == std::string::npos) return found;
        ++found;
        at = hit + needle.size();
    }
}

struct Collector {
    std::mutex mutex;
    std::condition_variable ready;
    std::string text;    // what a text-only caller sees (implicit Chunk conversion)
    std::string bytes;   // the same stream decoded from dataB64
    bool done = false;
    int code = -1;

    // Same sink shape the host uses: take the chunk, keep both transports.
    void push(const Runner::Chunk& chunk) {
        std::lock_guard lock(mutex);
        text.append(chunk.text);
        bytes.append(base64_decode(std::string(chunk.dataB64)));
    }
    void wait(int seconds = 15) {
        std::unique_lock lock(mutex);
        if (!ready.wait_for(lock, std::chrono::seconds(seconds), [&] { return done; }))
            throw std::runtime_error("runner did not finish in time");
    }
};

const std::string chinese = "\xe4\xbd\xa0\xe5\xa5\xbd";  // 你好
}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    const auto directory = fs::temp_directory_path() / ("taocode-runner-test-" + std::to_string(GetCurrentProcessId()));
    std::error_code ec;
    fs::remove_all(directory, ec);
    fs::create_directories(directory, ec);

    run("streams stdout and reports exit code", [&] {
        Collector collector;
        Runner runner;
        runner.start({L"cmd.exe", {L"/c", L"echo hello-from-build"}, L""},
                     [&](const Runner::Chunk& chunk) { collector.push(chunk); },
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        collector.wait(15);
        check(collector.text.find("hello-from-build") != std::string::npos, "stdout not streamed: " + collector.text);
        check(collector.code == 0, "expected exit code 0, got " + std::to_string(collector.code));
        check(!runner.running(), "runner should not be running after completion");
    });

    run("merges stderr and propagates non-zero exit", [&] {
        Collector collector;
        Runner runner;
        runner.start({L"cmd.exe", {L"/c", L"echo oops 1>&2 & exit 42"}, L""},
                     [&](const Runner::Chunk& chunk) { collector.push(chunk); },
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        collector.wait(15);
        check(collector.text.find("oops") != std::string::npos, "stderr not merged: " + collector.text);
        check(collector.code == 42, "expected exit code 42, got " + std::to_string(collector.code));
    });

    run("the child inherits the parent environment plus the overrides", [&] {
        Collector collector;
        Runner runner;
        Runner::Spec spec{L"cmd.exe", {L"/d", L"/c", L"echo [%TAOCODE_PROBE%][%SystemRoot%]"}, L""};
        spec.environment = {L"TAOCODE_PROBE=from-run-config"};
        runner.start(spec,
                     [&](const Runner::Chunk& chunk) { collector.push(chunk); },
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        collector.wait(15);
        check(collector.text.find("[from-run-config]") != std::string::npos,
              "the override did not reach the child: " + collector.text);
        // SystemRoot is not an override, so a non-empty expansion proves the parent
        // block survived (the old code replaced it entirely).
        check(collector.text.find("[]") == std::string::npos,
              "the parent environment was lost (SystemRoot empty): " + collector.text);
    });

    run("an override wins over the inherited variable of the same key", [&] {
        Collector collector;
        Runner runner;
        Runner::Spec spec{L"cmd.exe", {L"/d", L"/c", L"echo [%TAOCODE_PROBE%]"}, L""};
        spec.environment = {L"taocode_probe=second", L"TAOCODE_PROBE=case-wins"};
        runner.start(spec,
                     [&](const Runner::Chunk& chunk) { collector.push(chunk); },
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        collector.wait(15);
        check(collector.text.find("[case-wins]") != std::string::npos,
              "an override must replace the inherited entry case-insensitively: " + collector.text);
    });

    run("an override replaces the inherited variable instead of duplicating it", [&] {
        // Set in *this* process, so it can only reach the child through the
        // inherited block. The parent value sorts first, so a block that kept both
        // entries would resolve %TAOCODE_INHERITED% to the parent's value.
        SetEnvironmentVariableW(L"TAOCODE_INHERITED", L"aaa-parent");
        Collector collector;
        Runner runner;
        Runner::Spec spec{L"cmd.exe", {L"/d", L"/c", L"echo [%TAOCODE_INHERITED%]"}, L""};
        spec.environment = {L"TAOCODE_INHERITED=zzz-config"};
        runner.start(spec,
                     [&](const Runner::Chunk& chunk) { collector.push(chunk); },
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        collector.wait(15);
        check(collector.text.find("[zzz-config]") != std::string::npos,
              "the override must win over the inherited value: " + collector.text);
        check(collector.text.find("aaa-parent") == std::string::npos,
              "the inherited entry must be replaced, not kept alongside: " + collector.text);
    });

    run("output travels as base64 bytes and decodes to what the child wrote", [&] {
        const auto file = directory / "utf8.txt";
        { std::ofstream out(file, std::ios::binary | std::ios::trunc); out << chinese << "\n"; }
        Collector collector;
        Runner runner;
        const std::wstring command = L"/d /c type \"" + file.wstring() + L"\"";
        runner.start({L"cmd.exe", {command}, L""},
                     [&](const Runner::Chunk& chunk) { collector.push(chunk); },
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        collector.wait(15);
        check(collector.bytes.find(chinese) != std::string::npos, "dataB64 must carry the child's bytes");
        check(collector.text.find(chinese) != std::string::npos, "the text view must carry the same characters");
        check(collector.bytes.find("\xEF\xBF\xBD") == std::string::npos, "bytes must never be re-encoded");
    });

    run("a multi-byte sequence split across chunks is carried, not mangled", [&] {
        // 60 KB of 3-byte characters: the 16 KB reads land in the middle of them.
        std::string body;
        for (int i = 0; i < 20000; ++i) body += chinese;
        const auto file = directory / "big.txt";
        { std::ofstream out(file, std::ios::binary | std::ios::trunc); out << body; }
        Collector collector;
        Runner runner;
        const std::wstring command = L"/d /c type \"" + file.wstring() + L"\"";
        runner.start({L"cmd.exe", {command}, L""},
                     [&](const Runner::Chunk& chunk) { collector.push(chunk); },
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        collector.wait(30);
        check(count(collector.bytes, chinese) == 20000,
              "byte stream lost characters: " + std::to_string(count(collector.bytes, chinese)));
        check(count(collector.text, chinese) == 20000,
              "a split multi-byte sequence was mangled: " + std::to_string(count(collector.text, chinese)) +
                  " of 20000, replacement chars: " + std::to_string(count(collector.text, "\xEF\xBF\xBD")));
    });

    run("accepts stdin line input", [&] {
        Collector collector;
        Runner runner;
        // set /p reads a line from stdin; delayed expansion (!VAR!) is required
        // because %VAR% would be substituted at parse time, before set /p runs.
        runner.start({L"cmd.exe", {L"/v:on", L"/c", L"set /p ANSWER= & echo got=!ANSWER!"}, L""},
                     [&](const Runner::Chunk& chunk) { collector.push(chunk); },
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        Sleep(300);  // let cmd reach the prompt
        runner.write_line("ping");
        collector.wait(15);
        check(collector.text.find("got=ping") != std::string::npos, "stdin echo missing: " + collector.text);
    });

    run("write_line queues instead of blocking on a child that never reads", [&] {
        Collector collector;
        Runner runner;
        runner.start({L"cmd.exe", {L"/c", L"ping -n 20 127.0.0.1 >nul"}, L""},
                     [&](const Runner::Chunk&) {},
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        // Way more than the 64 KB pipe buffer: a synchronous WriteFile would park
        // the caller until the child (which never reads) goes away.
        const std::string line(120, 'x');
        const auto started = std::chrono::steady_clock::now();
        for (int i = 0; i < 1000; ++i) runner.write_line(line);
        const auto elapsed = std::chrono::steady_clock::now() - started;
        check(elapsed < std::chrono::seconds(2),
              "write_line blocked for " + std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count()) + " ms");
        runner.stop();
        collector.wait(15);
        check(!runner.running(), "runner stopped");
    });

    run("stop() terminates a long-running process", [&] {
        Collector collector;
        Runner runner;
        runner.start({L"cmd.exe", {L"/c", L"ping -n 30 127.0.0.1 >nul"}, L""},
                     [&](const Runner::Chunk&) {},
                     [&](int code) { std::lock_guard lock(collector.mutex); collector.code = code; collector.done = true; collector.ready.notify_all(); });
        check(runner.running(), "runner should be running");
        Sleep(300);
        runner.stop();
        collector.wait(15);
        check(!runner.running(), "runner stopped");
    });

    fs::remove_all(directory, ec);
    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
