// Dedicated native regression for the Java launch path. The parent build-validation
// owns compilation and execution; CMakeLists.txt is not modified here, so the test
// takes no arguments: it finds the JDK on PATH and works in a temp directory.
#include "run_host.hpp"
#include "base64.hpp"
#include "text.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;

void check(bool ok, const std::string& reason) {
    if (!ok) throw std::runtime_error(reason);
}

std::wstring environment(const wchar_t* name) {
    const DWORD needed = GetEnvironmentVariableW(name, nullptr, 0);
    if (needed == 0) return {};
    std::wstring value(needed, L'\0');
    GetEnvironmentVariableW(name, value.data(), needed);
    value.resize(wcslen(value.c_str()));
    return value;
}

/** The first `<entry>/bin/javac.exe` on PATH (taocode::jdk::find_all has the same shape). */
fs::path jdk_on_path() {
    const auto path = environment(L"PATH");
    for (std::size_t start = 0; start <= path.size();) {
        const auto end = path.find(L';', start);
        const auto entry = path.substr(start, end == std::wstring::npos ? std::wstring::npos : end - start);
        if (!entry.empty()) {
            const fs::path home = fs::path(entry).parent_path();
            std::error_code error;
            if (fs::exists(home / L"bin" / L"javac.exe", error) && fs::exists(home / L"bin" / L"java.exe", error))
                return home;
        }
        if (end == std::wstring::npos) break;
        start = end + 1;
    }
    return {};
}

struct Events {
    std::mutex mutex;
    std::vector<Json> items;
    auto sink() {
        return [this](Json event) {
            std::lock_guard lock(mutex);
            items.push_back(std::move(event));
        };
    }
    std::vector<Json> snapshot() {
        std::lock_guard lock(mutex);
        return items;
    }
    std::string output(int id) {
        std::string text;
        for (const auto& event : snapshot())
            if (event.value("instance", 0) == id && event.value("event", std::string()) == "run.output")
                text += taocode::base64_decode(event.value("dataB64", std::string()));
        return text;
    }
};

int finish(taocode::run_host::Manager& manager, Events& events, int id, const fs::path& root) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
    while (std::chrono::steady_clock::now() < deadline) {
        for (const auto& [instance, code] : manager.take_pending()) manager.advance(instance, code, root);
        int code = 0;
        bool terminal = false;
        for (const auto& event : events.snapshot()) {
            if (event.value("instance", 0) == id && event.value("event", std::string()) == "run.exit"
                && event.value("remaining", 0) == 0) {
                code = event.value("code", -1);
                terminal = true;
            }
        }
        if (terminal && !manager.any_running()) return code;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    manager.stop(0);
    throw std::runtime_error("native run chain timed out");
}

std::string path_text(const fs::path& path) {
    const auto bytes = path.generic_u8string();
    return {reinterpret_cast<const char*>(bytes.data()), bytes.size()};
}

void write_file(const fs::path& file, const std::string& content) {
    std::ofstream out(file, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("cannot write " + path_text(file));
    out << content;
}
}

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    try {
        const fs::path jdk = jdk_on_path();
        if (jdk.empty()) {
            std::cout << "SKIP java run host regression (no JDK on PATH)\n";
            return 0;
        }
        const fs::path root = fs::temp_directory_path() / L"taocode-java-run-host-test";
        std::error_code error;
        fs::remove_all(root, error);
        fs::create_directories(root, error);
        write_file(root / "Main.java",
            "package app; public class Main { public static void main(String[] a) { "
            "System.out.println(\"JAVA_MAIN_OK\"); for (int i=0; i<a.length; i++) "
            "System.out.println(i+\"=[\"+a[i]+\"]\"); } }");
        write_file(root / "Broken.java", "class Broken { invalid java syntax }");
        const std::string javac = "\"" + path_text(jdk / "bin/javac.exe") + "\"";
        const std::string java = path_text(jdk / "bin/java.exe");
        Events events;
        taocode::run_host::Manager manager(events.sink());

        // No label: an unnamed compile still needs run.started for the console to exist.
        const int unnamed = manager.start({{"command", "echo UNNAMED_BUILD"}, {"shell", true}}, root)
                                .at("instance").get<int>();
        check(finish(manager, events, unnamed, root) == 0, "unnamed command failed");
        bool announced = false;
        for (const auto& item : events.snapshot())
            if (item.value("instance", 0) == unnamed && item.value("event", std::string()) == "run.started")
                announced = true;
        check(announced, "unnamed compile did not emit run.started");

        // Real javac -> java through beforeLaunch, with argv that cmd would damage.
        Json params = {{"label", "Main"}, {"program", java}, {"shell", false},
            {"args", Json::array({"-cp", "classes with spaces", "app.Main", "two words", "", "quote\"inside",
                                  "C:\\trailing path\\"})},
            {"beforeLaunch", Json::array({Json{{"name", "javac"},
                {"command", javac + " -encoding UTF-8 -d \"classes with spaces\" Main.java"}}})}};
        const int id = manager.start(params, root).at("instance").get<int>();
        check(finish(manager, events, id, root) == 0, "compile-then-run failed: " + events.output(id));
        const auto output = events.output(id);
        check(output.find("JAVA_MAIN_OK") != std::string::npos, "Main never ran: " + output);
        for (const std::string& expected : {"0=[two words]", "1=[]", "2=[quote\"inside]", "3=[C:\\trailing path\\]"})
            check(output.find(expected) != std::string::npos, "argv was damaged: " + output);
        check(fs::exists(root / "classes with spaces" / "app" / "Main.class"),
              "javac output directory disagrees with the runtime classpath");

        // A stale Main.class exists now, so a failed compile must still gate the run.
        params["beforeLaunch"] = Json::array({Json{{"name", "broken javac"},
            {"command", javac + " -d \"classes with spaces\" Broken.java"}}});
        const int failed = manager.start(params, root).at("instance").get<int>();
        check(finish(manager, events, failed, root) != 0, "failed javac was reported successful");
        check(events.output(failed).find("JAVA_MAIN_OK") == std::string::npos, "Main ran before a failed compile");

        bool rejected = false;
        try { manager.start({{"program", path_text(root / "missing-java.exe")}, {"shell", false}}, root); }
        catch (const taocode::WorkspaceError&) { rejected = true; }
        check(rejected, "a missing executable must reject the launch");
        const auto all = events.snapshot();
        check(!all.empty() && all.back().value("event", std::string()) == "run.exit"
              && all.back().value("code", 0) == -1, "spawn failure left a running console");

        fs::remove_all(root, error);
        std::cout << "ok   java launch through the run host (javac, java, argv, build gating)\n";
        return 0;
    } catch (const std::exception& failure) {
        std::cout << "FAIL java launch through the run host: " << failure.what() << '\n';
        return 1;
    }
}
