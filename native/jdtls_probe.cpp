// 临时探针：用**生产路径**（native/lsp_config.cpp 的 resolve_servers）拉起内置 JDT LS，
// 并把 initialize 的原始应答与随后收到的所有服务端消息打出来。
// 用途：查清"服务器起来了但没有任何诊断"到底是 initialize 失败、还是 didOpen 没发生。
// 与 lsp_real_test 的区别：这里不判定成功/失败，只把线上事实原样打印。
//
// 2026-10-01 扩成「外部解析 / 库类型跳转」那条线的诊断口（都走环境变量，不改生产代码）：
//   TAOCODE_PROBE_SETTINGS=<projects.json 路径>  把该项目**在应用里的设置**原样交给 resolve_servers
//        （链接工程 / Gradle 开关 / 源根 / 类路径都在里面 —— 不传就只剩 java 那一档默认值）
//   TAOCODE_PROBE_FILE=<工作区相对路径>          打开这个真实文件（默认写一个合成的 ProbeCheck.java）
//   TAOCODE_PROBE_POS=<line>:<char>              definition/typeDefinition/declaration 的探针位置（0 基）
//   TAOCODE_PROBE_COMMANDS=<逗号分隔>            要问 JDT 的只读命令（默认三条工程状态命令）
#include "lsp_session.hpp"

#include "lsp_config.hpp"

#include <windows.h>

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::lsp::Session;

std::string env(const char* name, const std::string& fallback = {}) {
    char* value = nullptr;
    size_t length = 0;
    if (_dupenv_s(&value, &length, name) != 0 || value == nullptr) return fallback;
    const std::string text(value, length > 0 ? length - 1 : 0);
    free(value);
    return text.empty() ? fallback : text;
}

std::vector<std::string> split(const std::string& text, char separator) {
    std::vector<std::string> parts;
    std::istringstream stream(text);
    std::string part;
    while (std::getline(stream, part, separator))
        if (!part.empty()) parts.push_back(part);
    return parts;
}

/** 该项目在应用里的设置（`projects.json` 的 `perProject[root]`）；拿不到就返回空对象。 */
Json project_settings(const std::string& store_path, const std::string& root) {
    if (store_path.empty()) return Json::object();
    std::ifstream stream(store_path, std::ios::binary);
    if (!stream) return Json::object();
    try {
        const Json document = Json::parse(stream);   // 具名对象：range-for 的子表达式会悬垂（lsp_config.cpp 那个真缺陷）
        const Json per_project = document.value("perProject", Json::object());
        for (const auto& [key, value] : per_project.items())
            if (key == root) return value;
    } catch (const Json::exception&) {
        return Json::object();
    }
    return Json::object();
}

std::string read_text(const fs::path& file) {
    std::ifstream stream(file, std::ios::binary);
    std::ostringstream out;
    out << stream.rdbuf();
    return out.str();
}
}  // namespace

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    const std::string config_dir = env("TAOCODE_PROBE_CONFIG");
    const std::string root_dir = env("TAOCODE_PROBE_ROOT");
    if (config_dir.empty() || root_dir.empty()) {
        std::cerr << "need TAOCODE_PROBE_CONFIG and TAOCODE_PROBE_ROOT\n";
        return 2;
    }
    const std::string probe_file = env("TAOCODE_PROBE_FILE");
    const std::string probe_pos = env("TAOCODE_PROBE_POS", "0:0");
    const auto position = split(probe_pos, ':');
    const int probe_line = position.size() > 0 ? std::atoi(position[0].c_str()) : 0;
    const int probe_char = position.size() > 1 ? std::atoi(position[1].c_str()) : 0;
    auto commands = split(env("TAOCODE_PROBE_COMMANDS",
                              "java.project.getAll,java.project.sourcePaths,java.project.getSettings"), ',');

    std::mutex mutex;
    std::condition_variable cv;
    int diagnostics_count = 0;
    Json last_diagnostics;
    std::string last_path;
    Session session([&](std::string path, Json params) {
        std::lock_guard lock(mutex);
        ++diagnostics_count;
        last_path = std::move(path);
        last_diagnostics = std::move(params);
        std::cout << "PROBE diagnostics #" << diagnostics_count << " path=" << last_path
                  << " count=" << last_diagnostics.size() << '\n';
        cv.notify_all();
    });
    const auto root = fs::path(root_dir);
    session.set_root(root);

    const auto settings = project_settings(env("TAOCODE_PROBE_SETTINGS"), root_dir);
    std::cout << "PROBE settings=" << (settings.is_null() || settings.empty() ? std::string("(空)") : settings.dump().substr(0, 400)) << '\n';
    auto servers = taocode::lsp::resolve_servers(fs::path(config_dir), root.string(), settings);
    if (!servers.contains("java")) {
        std::cerr << "FAIL resolve_servers found no java server\n";
        return 1;
    }
    session.configure(std::move(servers));

    // 打开探针文件：给了 TAOCODE_PROBE_FILE 就读磁盘上的真实文件，否则写一个合成的带错文件。
    std::string opened_path = probe_file;
    std::string opened_text;
    if (probe_file.empty()) {
        opened_path = "ProbeCheck.java";
        opened_text = "public class ProbeCheck {\n    int value = \"not an int\";\n}\n";
    } else {
        opened_text = read_text(root / fs::path(std::u8string(probe_file.begin(), probe_file.end())));
        std::cout << "PROBE file=" << probe_file << " bytes=" << opened_text.size() << '\n';
    }
    const auto opened = session.open(opened_path, opened_text);
    std::cout << "PROBE open result=" << opened.dump() << '\n';
    {
        std::unique_lock lock(mutex);
        cv.wait_for(lock, std::chrono::seconds(180), [&] { return diagnostics_count > 0; });
    }
    std::cout << "PROBE total diagnostics=" << diagnostics_count << '\n';
    // 把最后一份诊断原样打出来（消息文本来自真实服务器，未经加工）。
    std::cout << "PROBE last=" << last_diagnostics.dump(1).substr(0, 2000) << '\n';

    if (!probe_file.empty()) {
        // 一次异步往返的等待器（回调可能在本函数栈帧之后到达 —— 状态放堆上）。
        const auto ask = [&](const std::string& kind, const Json& args) {
            struct State { std::mutex mutex; std::condition_variable cv; bool done = false; Json result, error; };
            auto state = std::make_shared<State>();
            session.semantic(kind, opened_path, probe_line, probe_char, args, [state](Json result, Json error) {
                {
                    std::lock_guard lock(state->mutex);
                    state->result = std::move(result);
                    state->error = std::move(error);
                    state->done = true;
                }
                state->cv.notify_all();
            });
            std::unique_lock lock(state->mutex);
            if (!state->cv.wait_for(lock, std::chrono::seconds(120), [&] { return state->done; }))
                return std::string("<超时>");
            if (!state->error.is_null()) return std::string("ERROR ") + state->error.dump();
            return state->result.dump();
        };
        const auto request = [&](const std::string& kind) {
            struct State { std::mutex mutex; std::condition_variable cv; bool done = false; Json result, error; };
            auto state = std::make_shared<State>();
            session.request(kind, opened_path, probe_line, probe_char, [state](Json result, Json error) {
                {
                    std::lock_guard lock(state->mutex);
                    state->result = std::move(result);
                    state->error = std::move(error);
                    state->done = true;
                }
                state->cv.notify_all();
            });
            std::unique_lock lock(state->mutex);
            if (!state->cv.wait_for(lock, std::chrono::seconds(120), [&] { return state->done; }))
                return std::string("<超时>");
            if (!state->error.is_null()) return std::string("ERROR ") + state->error.dump();
            return state->result.dump();
        };
        // 拉一次这个文件的诊断：`non-project file` 那句原文就是"它到底有没有进工程"的判据。
        std::cout << "PROBE diagnostic=" << ask("diagnostic", Json::object()).substr(0, 1500) << '\n';
        for (const auto& command : commands)
            std::cout << "PROBE command " << command << "=" << ask("executeCommand", Json{{"command", command}, {"arguments", Json::array()}}).substr(0, 2000) << '\n';
        std::cout << "PROBE definition=" << request("definition").substr(0, 800) << '\n';
        std::cout << "PROBE typeDefinition=" << ask("typeDefinition", Json::object()).substr(0, 800) << '\n';
        std::cout << "PROBE hover=" << request("hover").substr(0, 400) << '\n';
    }

    session.shutdown_all();
    return diagnostics_count > 0 ? 0 : 1;
}
