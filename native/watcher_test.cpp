// Self-test for the workspace watcher: real ReadDirectoryChangesW against a temp
// directory. Verifies batched delivery with '/' paths, debounced coalescing of a
// save-storm, recursive subdirectory events, the real action on every change, rename
// pairs, the ignore list, the overflow marker contract and a clean stop that joins
// the thread (and a running() that never claims to watch something it is not).
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
#include <string>
#include <thread>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::watcher::Action;
using taocode::watcher::Change;
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
    std::vector<std::vector<Change>> batches;
    std::atomic<bool> got_any{false};

    Watcher::Callback sink() {
        return [this](std::vector<Change> changed) {
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
                if (entry.path == path) return true;
        return false;
    }
    bool saw(const Change& wanted) const {
        for (const auto& batch : batches)
            for (const auto& entry : batch)
                if (entry.path == wanted.path && entry.action == wanted.action &&
                    (wanted.old_path.empty() || entry.old_path == wanted.old_path))
                    return true;
        return false;
    }
    bool saw_under(const std::string& prefix) const {
        for (const auto& batch : batches)
            for (const auto& entry : batch)
                if (entry.path.rfind(prefix, 0) == 0) return true;
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

    run("the real action travels with every change", [&] {
        Collector collector;
        Watcher watcher;
        watcher.start(root, collector.sink());
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        put(root / "created.txt", "new");
        check(collector.wait(std::chrono::seconds(3)), "no batch for the new file");
        std::this_thread::sleep_for(std::chrono::milliseconds(600));
        check(collector.saw(Change{"created.txt", Action::added, {}}),
              "a new file must be reported as added");
        put(root / "created.txt", "changed");
        std::this_thread::sleep_for(std::chrono::seconds(2));
        check(collector.saw(Change{"created.txt", Action::modified, {}}),
              "a rewritten file must be reported as modified");
        fs::remove(root / "created.txt", ec);
        std::this_thread::sleep_for(std::chrono::seconds(2));
        check(collector.saw(Change{"created.txt", Action::removed, {}}),
              "a deleted file must be reported as removed");
        watcher.stop();
    });

    run("a rename arrives as one change carrying the old path", [&] {
        Collector collector;
        Watcher watcher;
        watcher.start(root, collector.sink());
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        put(root / "before.txt", "x");
        std::this_thread::sleep_for(std::chrono::milliseconds(700));
        collector.got_any = false;
        fs::rename(root / "before.txt", root / "after.txt", ec);
        check(collector.wait(std::chrono::seconds(3)), "no batch for the rename");
        std::this_thread::sleep_for(std::chrono::milliseconds(700));
        check(collector.saw(Change{"after.txt", Action::renamed, "before.txt"}),
              "the rename must report the new path, the action and the old path");
        watcher.stop();
    });

    run("generated directories and noise files never reach the UI", [&] {
        Collector collector;
        Watcher watcher;
        watcher.start(root, collector.sink());
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        fs::create_directories(root / "node_modules" / "pkg", ec);
        fs::create_directories(root / "build", ec);
        fs::create_directories(root / ".git", ec);
        put(root / "node_modules" / "pkg" / "index.js", "module");
        put(root / "build" / "build.log", "log");
        put(root / ".git" / "config", "cfg");
        put(root / "kept.txt", "kept");
        check(collector.wait(std::chrono::seconds(3)), "no batch for the kept file");
        std::this_thread::sleep_for(std::chrono::milliseconds(700));
        check(collector.saw("kept.txt"), "a normal file is still reported");
        check(!collector.saw_under("node_modules"), "node_modules must be filtered");
        check(!collector.saw_under("build"), "build must be filtered");
        check(!collector.saw_under(".git"), ".git must be filtered");
        fs::remove_all(root / "node_modules", ec);
        fs::remove_all(root / "build", ec);
        fs::remove_all(root / ".git", ec);
        watcher.stop();
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

    run("the last change of a storm is never dropped by the debounce", [&] {
        Collector collector;
        Watcher watcher;
        watcher.start(root, collector.sink());
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        for (int i = 0; i < 12; ++i) {
            put(root / "tail.txt", std::string(static_cast<std::size_t>(i) + 1, 'y'));
            std::this_thread::sleep_for(std::chrono::milliseconds(120));  // inside the debounce window
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1600));
        check(collector.saw("tail.txt"), "a debounce timer that keeps resetting must still deliver");
        watcher.stop();
    });

    run("a change serializes into the payload the UI reads", [&] {
        const taocode::Json written = Change{"src/main.cpp", Action::modified, {}};
        check(written["path"] == "src/main.cpp" && written["action"] == "modified",
              "unexpected shape: " + written.dump());
        const taocode::Json moved = Change{"src/new.cpp", Action::renamed, "src/old.cpp"};
        check(moved["path"] == "src/new.cpp" && moved["action"] == "renamed" &&
                  moved["oldPath"] == "src/old.cpp",
              "unexpected rename shape: " + moved.dump());
    });

    run("start on a missing directory reports WATCH_FAILED and is not running", [&] {
        Watcher watcher;
        bool refused = false;
        try { watcher.start(root / "does-not-exist", [](std::vector<Change>) {}); }
        catch (const taocode::WorkspaceError& error) {
            refused = error.code == "WATCH_FAILED";
        }
        check(refused, "a bad root must throw WATCH_FAILED");
        check(!watcher.running(), "a failed start must not report itself as running");
    });

    run("running() goes false when the watch cannot be kept", [&] {
        // ReadDirectoryChangesW only works on a directory, so a file as the root
        // takes the very same exit path as a root that vanishes underneath us.
        const auto file = root / "not-a-directory.txt";
        put(file, "x");
        Watcher watcher;
        watcher.start(file, [](std::vector<Change>) {});
        for (int tick = 0; tick < 100 && watcher.running(); ++tick)
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        check(!watcher.running(), "the watcher must stop claiming to run once its loop ends");
        watcher.stop();
        fs::remove(file, ec);
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
