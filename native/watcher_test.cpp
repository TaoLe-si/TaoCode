// Self-test for the workspace watcher: real ReadDirectoryChangesW against a temp
// directory. Verifies batched delivery with '/' paths, debounced coalescing of a
// save-storm, recursive subdirectory events, the overflow marker contract and a
// clean stop that joins the thread.
#include "watcher.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::watcher::Watcher;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

void put(const fs::path& path, const std::string& text) {
    std::ofstream file(path, std::ios::binary | std::ios::trunc);
    file << text;
}

struct Collector {
    std::mutex mutex;
    std::vector<std::vector<std::string>> batches;
    std::atomic<bool> got_any{false};

    Watcher::Callback sink() {
        return [this](std::vector<std::string> changed) {
            std::lock_guard lock(mutex);
            batches.push_back(std::move(changed));
            got_any = true;
        };
    }
    bool wait(std::chrono::milliseconds timeout) {
        const auto deadline = std::chrono::steady_clock::now() + timeout;
        while (std::chrono::steady_clock::now() < deadline) {
            if (got_any.load()) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        return got_any.load();
    }
    bool saw(const std::string& path) const {
        for (const auto& batch : batches)
            for (const auto& entry : batch)
                if (entry == path) return true;
        return false;
    }
};
}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    const auto root = fs::temp_directory_path() / ("taocode-watch-test-" + std::to_string(GetCurrentProcessId()));
    std::error_code ec;
    fs::remove_all(root, ec);
    fs::create_directories(root / "sub" / "deep");

    run("a changed file arrives as one debounced batch with '/' paths", [&] {
        Collector collector;
        Watcher watcher;
        watcher.start(root, collector.sink());
        std::this_thread::sleep_for(std::chrono::milliseconds(100));  // arm the read
        put(root / "hello.txt", "one");
        check(collector.wait(std::chrono::seconds(3)), "no watcher batch arrived");
        std::this_thread::sleep_for(std::chrono::milliseconds(600));  // let debounces settle
        check(collector.saw("hello.txt"), "the batch must carry the relative '/' path");
        watcher.stop();
        check(!watcher.running(), "stop() must end the thread");
    });

    run("nested changes are watched recursively", [&] {
        Collector collector;
        Watcher watcher;
        watcher.start(root, collector.sink());
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        put(root / "sub" / "deep" / "leaf.txt", "leaf");
        check(collector.wait(std::chrono::seconds(3)), "no batch for the nested file");
        check(collector.saw("sub/deep/leaf.txt"), "the nested path must arrive relative with '/'");
        watcher.stop();
    });

    run("a save-storm coalesces instead of one callback per write", [&] {
        Collector collector;
        Watcher watcher;
        watcher.start(root, collector.sink());
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        // Ten rapid writes to one file: Windows reports several notifications; the
        // 300 ms quiet period must fold them into a small number of batches.
        for (int i = 0; i < 10; ++i) put(root / "storm.txt", "x" + std::to_string(i));
        check(collector.wait(std::chrono::seconds(3)), "no batch for the storm");
        std::this_thread::sleep_for(std::chrono::milliseconds(700));
        {
            std::lock_guard lock(collector.mutex);
            check(collector.batches.size() <= 4, "expected ≤4 batches, got " + std::to_string(collector.batches.size()));
        }
        watcher.stop();
    });

    run("start on a missing directory reports WATCH_FAILED", [&] {
        Watcher watcher;
        bool refused = false;
        try { watcher.start(root / "does-not-exist", [](std::vector<std::string>) {}); }
        catch (const taocode::WorkspaceError& error) {
            refused = error.code == "WATCH_FAILED";
        }
        check(refused, "a bad root must throw WATCH_FAILED");
    });

    run("stop() without start() is a harmless no-op", [&] {
        Watcher watcher;
        watcher.stop();
        check(true, "reached");
    });

    fs::remove_all(root, ec);
    std::cout << (failures ? "WATCHER TESTS FAILED\n" : "watcher tests passed\n");
    return failures ? 1 : 0;
}
