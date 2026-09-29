// Opt-in proof that the whole C++ stack (Session -> Host -> CreateProcess ->
// Content-Length framing -> real LSP server) works against a genuine third-party
// language server. It SKIPS (exit 0) unless TAOCODE_LSP_REAL=1 so the committed
// suite stays hermetic. Two modes:
//
//   1. 手写命令（适合任何第三方服务器）:
//      set TAOCODE_LSP_REAL=1
//      set TAOCODE_LSP_CMD=node
//      set TAOCODE_LSP_ARGS=<abs>\typescript-language-server\lib\cli.mjs;--stdio
//      set TAOCODE_LSP_ROOT=<a directory whose node_modules contains typescript>
//      set TAOCODE_LSP_LANG=typescript
//      set TAOCODE_LSP_FILE=RealLspCheck.ts
//
//   2. **生产路径**（内置 JDT LS）：不再手写 java 参数，而是让 `resolve_servers` 自己
//      去发现 —— 这一步证明的是"随发行的那一份真的能用"，而不是"我能照 README 拼参数"：
//      set TAOCODE_LSP_REAL=1
//      set TAOCODE_LSP_AUTOCONFIG=<dir containing jdtls\ and jre\>   （例：build-validation）
//      set TAOCODE_LSP_ROOT=<a real Java project directory>
//      set TAOCODE_LSP_LANG=java
//      set TAOCODE_LSP_FILE=RealLspCheck.java
#include "lsp_session.hpp"

#include "lsp_config.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::lsp::Session;

std::string env(const char* name, const std::string& fallback = {}) {
    // _dupenv_s is the checked variant MSVC wants; the POSIX branch keeps the file
    // buildable if it is ever compiled somewhere else.
#if defined(_MSC_VER)
    char* value = nullptr;
    size_t length = 0;
    if (_dupenv_s(&value, &length, name) != 0 || value == nullptr) return fallback;
    const std::string text(value, length > 0 ? length - 1 : 0);
    free(value);
    return text.empty() ? fallback : text;
#else
    const char* value = std::getenv(name);
    return value && *value ? std::string(value) : fallback;
#endif
}
std::vector<std::wstring> split_args(const std::string& raw) {
    std::vector<std::wstring> parts;
    std::string current;
    for (char ch : raw) {
        if (ch == ';') { if (!current.empty()) parts.push_back(fs::path(current).native()); current.clear(); }
        else current.push_back(ch);
    }
    if (!current.empty()) parts.push_back(fs::path(current).native());
    return parts;
}
}  // namespace

int main() {
    // Unbuffered: this harness is the tool for "the server answered X or nothing at all",
    // and a crash mid-run must still leave the progress visible.
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    if (env("TAOCODE_LSP_REAL") != "1") {
        std::cout << "SKIP lsp_real_test (set TAOCODE_LSP_REAL=1 to run against a real server)\n";
        return 0;
    }
    const std::string language = env("TAOCODE_LSP_LANG", "typescript");
    const std::string filename = env("TAOCODE_LSP_FILE", "RealLspCheck.ts");

    std::mutex mutex;
    std::condition_variable cv;
    bool got_diagnostics = false, got_hover = false;
    Json diagnostics, hover_payload;
    Session session([&](std::string, Json params) {
        std::lock_guard lock(mutex);
        diagnostics = std::move(params);
        got_diagnostics = true;
        cv.notify_all();
    });
    const auto root = fs::path(env("TAOCODE_LSP_ROOT", "."));
    session.set_root(root);

    // 生产路径：走 `resolve_servers`（`TaoCode.lsp.json` → PATH 发现 → 内置 JDT LS），
    // 与 IDE 里 `configure_lsp()` 用的是**同一段**逻辑。手写参数那条路留着给别的服务器。
    const std::string autoconfig = env("TAOCODE_LSP_AUTOCONFIG");
    if (!autoconfig.empty()) {
        // TAOCODE_LSP_JDK：把项目 JDK 传进去（bundled 方案下它只进 java.configuration.runtimes
        // 参与编译 —— 服务器本体仍跑随发行的 JRE）。用它验证 runtimes 归一后诊断真的出现。
        taocode::Json settings{{"java",
            {{"jdkHome", env("TAOCODE_LSP_JDK")},
             {"jdkName", "JavaSE-17"},
             // 产品路径里 javaDefaults 会把空 sourcePaths 填成 ['src']（IDEA 的纯 Java 约定），这里对齐。
             {"sourcePaths", taocode::Json::array({"src"})}}}};
        // TAOCODE_LSP_GRADLE_JDK：把「构建工具 › Gradle JVM」也一起给，用来做**同一份二进制**的
        // 前后对照 —— 不给就是改动前的形状（服务器只会用自己的 JRE 去起 Gradle）。
        const auto gradle_java = env("TAOCODE_LSP_GRADLE_JDK");
        if (!gradle_java.empty()) settings["buildTools"] = {{"gradle", {{"gradleJvm", gradle_java}}}};
        auto servers = taocode::lsp::resolve_servers(fs::path(autoconfig), root.string(), settings);
        if (!servers.contains(language)) {
            std::cerr << "FAIL resolve_servers 没能为 " << language << " 找到服务器（内置那份没被发现）\n";
            return 1;
        }
        const auto& chosen = servers.at(language);
        if (!chosen.command.empty())
            std::cout << "INFO 自动发现的 " << language << " 服务器：" << fs::path(chosen.command).filename().string()
                      << "（" << chosen.arguments.size() << " 个参数）\n";
        session.configure(std::move(servers));
    } else {
        const std::string command = env("TAOCODE_LSP_CMD");
        if (command.empty()) { std::cerr << "FAIL TAOCODE_LSP_CMD is required\n"; return 1; }
        Session::ServerConfig config;
        config.command = fs::path(command).native();
        config.arguments = split_args(env("TAOCODE_LSP_ARGS"));
        std::map<std::string, Session::ServerConfig> servers;
        servers[language] = config;
        session.configure(std::move(servers));
    }

    // A deliberate type error, phrased for the language under test. The Java file also
    // carries a member-access expression so the completion request below has a real target.
    const std::string source = language == "java"
        ? "public class RealLspCheck {\n    int value = \"not an int\";\n    int size() { String text = \"abc\"; return text.length(); }\n}\n"
        : "export const value: number = \"definitely not a number\";\nexport const other = value + 1;\n";
    const auto opened = session.open(filename, source);
    if (opened.value("running", false) != true) { std::cerr << "FAIL server did not start\n"; return 1; }

    const auto wait_for = [&](bool& flag, int seconds) {
        std::unique_lock lock(mutex);
        return cv.wait_for(lock, std::chrono::seconds(seconds), [&] { return flag; });
    };
    // 隐形工程（无 pom/gradle 的裸目录）导入完成前，服务器会先对工作区目录发一条
    // **空**诊断；文件自己的诊断要等导入+编译完才来（实测 .metadata/.log 里
    // "1 problems reported" 晚于第一条空发布）。等**非空**诊断，别把第一条空当结论。
    bool nonempty = false;
    {
        std::unique_lock lock(mutex);
        nonempty = cv.wait_for(lock, std::chrono::seconds(150),
                               [&] { return got_diagnostics && !diagnostics.empty(); });
    }
    if (!nonempty) {
        std::cerr << (got_diagnostics ? "FAIL real server published only empty diagnostics within 150s\n"
                                      : "FAIL no diagnostics from real server within 150s\n");
        return 1;
    }
    const bool found = !diagnostics.empty();
    std::cout << (found ? "PASS" : "FAIL") << " real server (" << language << ") published " << diagnostics.size()
              << " diagnostic(s); first: " << (diagnostics.empty() ? std::string("(none)") : diagnostics[0].value("message", std::string())) << '\n';

    session.request("hover", filename, 0, 20, [&](Json result, Json) {
        std::lock_guard lock(mutex);
        hover_payload = result;
        got_hover = true;
        cv.notify_all();
    });
    if (wait_for(got_hover, 20))
        std::cout << "PASS hover answered: " << (hover_payload.contains("contents") ? hover_payload.at("contents").dump() : std::string("(none)")) << '\n';
    else
        std::cerr << "INFO hover did not answer in time\n";

    // 代码补全：用户的原话是"没有代码补全提示"，所以这里必须量**真实服务器**给回的条目数，
    // 而不是只证明"请求发出去了"。目标是 `text.length()` 里那个点号之后 —— 有工程模型
    // （或至少 JDK）才会回 `length`。
    if (language == "java") {
        std::size_t completion_line = 0, completion_character = 0, target = 0;
        for (std::size_t index = 0; index < source.size(); ++index)
            if (source.compare(index, 5, "text.") == 0) { target = index + 5; break; }
        if (target == 0) { std::cerr << "FAIL the Java sample lost its completion target\n"; return 1; }
        {
            for (std::size_t index = 0; index < target; ++index)
                if (source[index] == '\n') ++completion_line;
            const auto line_start = source.rfind('\n', target) == std::string::npos ? 0 : source.rfind('\n', target) + 1;
            completion_character = target - line_start;
        }
        Json completion;
        bool got_completion = false;
        session.request("completion", filename, static_cast<int>(completion_line), static_cast<int>(completion_character),
                        [&](Json result, Json error) {
                            std::lock_guard lock(mutex);
                            completion = error.is_null() ? result : Json();
                            got_completion = true;
                            cv.notify_all();
                        });
        if (!wait_for(got_completion, 30)) { std::cerr << "FAIL completion never replied\n"; return 1; }
        const auto items = completion.value("items", Json::array());
        // JDT LS 给方法的 label 是带括号的 `length()`（字段才是裸名），所以判据是"以 length 开头"，
        // 不是"等于 length"—— 后者会把一次正常的补全误判成失败。
        bool has_length = false;
        for (const auto& item : items)
            if (item.value("label", std::string()).rfind("length", 0) == 0) has_length = true;
        std::cout << (has_length ? "PASS" : "FAIL") << " completion returned " << items.size() << " item(s)"
                  << (has_length ? " including `length…`" : " but not `length…`") << '\n';
        if (!has_length) {
            // 失败必须能看出服务器到底给了什么：全是关键字 = 语义引擎没参与（工程模型还没建好），
            // 有一堆成员却没有 `length` = 位置或文档版本不对。`kind` 在契约里是**名字字符串**，
            // 按整数取会抛 type_error，把这个诊断进程自己弄崩。
            std::string labels;
            for (std::size_t index = 0; index < items.size(); ++index)
                labels += (index ? ", " : "") + items[index].value("label", std::string()) + "/" + items[index].value("kind", std::string());
            std::cout << "  labels: " << labels << '\n';
        }
        if (!has_length) return 1;
    }

    session.shutdown_all();
    return found ? 0 : 1;
}
