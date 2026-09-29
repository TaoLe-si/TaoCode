// 临时探针：用**生产路径**（native/lsp_config.cpp 的 resolve_servers）拉起内置 JDT LS，
// 并把 initialize 的原始应答与随后收到的所有服务端消息打出来。
// 用途：查清"服务器起来了但没有任何诊断"到底是 initialize 失败、还是 didOpen 没发生。
// 与 lsp_real_test 的区别：这里不判定成功/失败，只把线上事实原样打印。
#include "lsp_session.hpp"

#include "lsp_config.hpp"

#include <windows.h>

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <map>
#include <mutex>
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
}  // namespace

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    const std::string config_dir = env("TAOCODE_PROBE_CONFIG");
    const std::string root_dir = env("TAOCODE_PROBE_ROOT");
    if (config_dir.empty() || root_dir.empty()) {
        std::cerr << "need TAOCODE_PROBE_CONFIG and TAOCODE_PROBE_ROOT\n";
        return 2;
    }

    std::mutex mutex;
    std::condition_variable cv;
    int diagnostics_count = 0;
    Json last_diagnostics;
    Session session([&](std::string path, Json params) {
        std::lock_guard lock(mutex);
        ++diagnostics_count;
        last_diagnostics = std::move(params);
        std::cout << "PROBE diagnostics #" << diagnostics_count << " path=" << path
                  << " count=" << last_diagnostics.size() << '\n';
        cv.notify_all();
    });
    const auto root = fs::path(root_dir);
    session.set_root(root);

    auto servers = taocode::lsp::resolve_servers(fs::path(config_dir), root.string(),
                                                 Json{{"java", Json{{"jdkName", "JavaSE-17"}}}});
    if (!servers.contains("java")) {
        std::cerr << "FAIL resolve_servers found no java server\n";
        return 1;
    }
    session.configure(std::move(servers));

    // 故意写一个类型错误：好服务器必然报诊断。
    const auto opened = session.open("ProbeCheck.java",
                                     "public class ProbeCheck {\n    int value = \"not an int\";\n}\n");
    std::cout << "PROBE open result=" << opened.dump() << '\n';
    {
        std::unique_lock lock(mutex);
        cv.wait_for(lock, std::chrono::seconds(180), [&] { return diagnostics_count > 0; });
    }
    std::cout << "PROBE total diagnostics=" << diagnostics_count << '\n';
    // 把最后一份诊断原样打出来（消息文本来自真实服务器，未经加工）。
    std::cout << "PROBE last=" << last_diagnostics.dump(1).substr(0, 2000) << '\n';
    session.shutdown_all();
    return diagnostics_count > 0 ? 0 : 1;
}
