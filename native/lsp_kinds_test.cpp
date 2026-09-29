// 每个 LSP kind 的**整形**与**门控**都要有用例 —— 这里补的是「重构/语义」之外的那一批：
// foldingRange、documentHighlight、moniker、codeLens、inlineCompletion、documentLink、
// semanticTokens（full / delta / 整份替换三条路）、completion→completionItem/resolve、
// diagnostic（full / unchanged）、prepareRename（可改 / 不可改）、workspaceDiagnostic。
//
// 为什么值得单独一个文件（2026-09-28）：这些用例曾经存在过 630 行，被一次
// `git checkout --` 连带丢弃（见 docs/handoff-2026-09-28-ui-parity.md §4.2）。丢的代价不是
// 「少了几个断言」，而是**同一批 kind 从此没有防回归**：`lsp_session.cpp` 里
// 「加进 kind 表但入口没接」的缺陷形状，正是本项目已经真踩过两次的坑
// （completionItemResolve / diagnostic / prepareRename / foldingRange 四个 kind 曾打到
// 不认识的分支回 LSP_BAD_KIND，前端各自 catch 掉错误 ⇒ 功能在测试里全绿、在界面上全哑）。
//
// 与 `lsp_semantics_test.cpp` 的分工：那个文件钉「重构 + 符号」一族与本仓自己的
// 往返纪律；这里钉剩下每一族的**契约形状**（哪些项必须丢、哪些键必须**不出现**）与
// **能力门控**（服务器没声明就别发出去）。
//
// 断言的重点不是「拿到了东西」，而是那几条**只能靠整形代码保证**的性质：
//   · 该丢的项真的丢了（没有 command 的 codeLens、snippet 形的 inlineCompletion、没有 identifier 的 moniker）；
//   · 该**缺席**的键真的缺席（unchanged 的诊断报告不带 items/diagnostics、delta 不带 data）——
//     补一个空数组上去，等于把「沿用上一份」伪装成「这个文件没问题」；
//   · 服务器没声明能力时回的是 LSP_UNSUPPORTED，而不是一次超时或一个空成功。
#include "lsp_session.hpp"

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
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::lsp::Session;

constexpr const char* kDoc = "src/示例 Sample.java";
constexpr const char* kText = "class Sample {\n    int counter;\n}\n";

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

fs::path self_directory() {
    std::wstring path(32768, L'\0');
    const auto length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    path.resize(length);
    return fs::path(path).parent_path();
}

/** 一次异步往返的共享状态。必须**堆上**：回调可能在调用方的栈帧销毁之后才到。
 *  与 `lsp_semantics_test.cpp` 同一条纪律 —— `notify_all` 只能在**解锁之后**发。 */
struct State {
    std::mutex mutex;
    std::condition_variable cv;
    bool done = false;
    Json result;
    Json error;
};

/** 一个会话 + 一台按需带开关启动的假服务器。开关换一台，能力声明就换一套。 */
struct Harness {
    explicit Harness(std::vector<std::wstring> arguments = {})
        : sink([this](std::string, Json) {
              {
                  std::lock_guard lock(mutex);
                  ++diagnostics;
              }
              cv.notify_all();
          }),
          session(sink) {
        session.set_root(fs::path(L"C:\\Users\\dev\\My Project"));
        Session::ServerConfig config;
        config.command = (self_directory() / L"lsp_fake_server.exe").native();
        config.arguments = std::move(arguments);
        std::map<std::string, Session::ServerConfig> servers;
        servers["java"] = config;
        session.configure(std::move(servers));
    }

    /** 打开文档，并**等到握手落地**。`didOpen` 是延后的（服务器 ready 才发），而假服务器收到
     *  didOpen 一定会 publishDiagnostics —— 所以「等到一条诊断」就是「initialize 的 capabilities
     *  已经存进来」。不等就直接问能力：`unsupported()` 还查不到 provider，门控不生效，
     *  而假服务器的**处理分支**并不看自己的开关，照样答得上来 ⇒ 门控用例会以
     *  「居然拿到了结果」的形式偶发红。这一条不是为了让用例过得去，是要让它**必然**测到门控。 */
    bool open(const std::string& path = kDoc, const std::string& text = kText) {
        std::unique_lock lock(mutex);
        const unsigned before = diagnostics;
        const bool running = session.open(path, text).value("running", false) == true;
        const bool landed = cv.wait_for(lock, std::chrono::seconds(15), [&] { return diagnostics > before; });
        check(running, "the server for " + path + " did not start");
        check(landed, "the initialize handshake never landed for " + path);
        return true;
    }

    /** 走 `semantic()` 这个统一入口：位置型kind 由它转交，两个入口合起来覆盖全表。 */
    std::pair<Json, Json> call(const std::string& kind, const std::string& path, int line, int character,
                               const Json& args = Json::object()) {
        auto state = std::make_shared<State>();
        session.semantic(kind, path, line, character, args, [state](Json payload, Json failure) {
            {
                std::lock_guard lock(state->mutex);
                state->result = std::move(payload);
                state->error = std::move(failure);
                state->done = true;
            }
            state->cv.notify_all();
        });
        std::unique_lock lock(state->mutex);
        check(state->cv.wait_for(lock, std::chrono::seconds(15), [&] { return state->done; }),
              "callback never fired for " + kind);
        return {std::move(state->result), std::move(state->error)};
    }

    /** 成功路径的简写：出错就直接把错误消息抛出去。 */
    Json ok(const std::string& kind, const std::string& path, int line, int character,
            const Json& args = Json::object()) {
        auto [result, error] = call(kind, path, line, character, args);
        check(error.is_null(), kind + " reported an error: " + error.dump());
        check(!result.is_null(), kind + " returned a null payload");
        return result;
    }

    /** 门控路径的简写：必须是 LSP_UNSUPPORTED，且没有成功负载。 */
    void refused(const std::string& kind, const Json& args = Json::object()) {
        auto [result, error] = call(kind, kDoc, 0, 0, args);
        check(result.is_null(), kind + " must not produce a payload when the server declined it");
        check(!error.is_null(), kind + " was not refused at all");
        check(error.value("code", std::string()) == "LSP_UNSUPPORTED",
              kind + " failed as " + error.value("code", std::string()) + ", expected LSP_UNSUPPORTED");
    }

    void shutdown() { session.shutdown_all(); }

    // 顺序有意义：同步原语必须在 `session` **之前**构造（诊断回调会用到它们）。
    std::mutex mutex;
    std::condition_variable cv;
    unsigned diagnostics = 0;
    Session::DiagnosticsSink sink;
    Session session;
};

const Json& item_by_label(const Json& items, const std::string& label) {
    for (const auto& item : items)
        if (item.value("label", std::string()) == label) return item;
    throw std::runtime_error("no item labelled " + label);
}
}  // namespace

int main() {
    int failures = 0, passed = 0;
    const auto run = [&](const std::string& name, auto&& operation) {
        try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
    };

    // ---------------------------------------------------------------- 整形：默认那台什么能力都开的服务器
    Harness full;
    run("foldingRange 收下两种形状，单行区间丢掉", [&] {
        check(full.open(), "java server starts");
        const auto result = full.ok("foldingRange", kDoc, 0, 0);
        check(result.at("available") == true, "folds are available");
        const auto& ranges = result.at("ranges");
        check(ranges.size() == 2, "two ranges, got " + std::to_string(ranges.size()));
        check(ranges[0].at("startLine") == 0 && ranges[0].at("endLine") == 9, "the line-only range");
        check(!ranges[0].contains("startChar") && !ranges[0].contains("kind"),
              "没有的字段不该被凭空补出来（前端按缺省判断）");
        check(ranges[1].at("startLine") == 12 && ranges[1].at("endLine") == 14 &&
                  ranges[1].at("startChar") == 4 && ranges[1].at("endChar") == 1 &&
                  ranges[1].at("kind") == "comment", "the column + kind range survives");
    });

    run("documentHighlight 的两条区间锚在请求位置上", [&] {
        const auto result = full.ok("documentHighlight", kDoc, 6, 3);
        const auto& highlights = result.at("highlights");
        check(result.at("available") == true && highlights.size() == 2, "two highlights");
        check(highlights[0].at("kind") == 2 && highlights[0].at("startLine") == 6 &&
                  highlights[0].at("startChar") == 2 && highlights[0].at("endLine") == 6 &&
                  highlights[0].at("endChar") == 8, "the read highlight is on the caret line");
        check(highlights[1].at("kind") == 3 && highlights[1].at("startLine") == 7,
              "the write highlight is on the next line");
    });

    run("moniker 丢掉没有 identifier 的那条，unique 如实带出", [&] {
        const auto result = full.ok("moniker", kDoc, 0, 0);
        const auto& monikers = result.at("monikers");
        check(result.at("available") == true && monikers.size() == 2,
              "三条里只该留两条，got " + std::to_string(monikers.size()));
        check(monikers[0].at("identifier") == "Sample.counter" && monikers[0].at("scheme") == "taocode" &&
                  monikers[0].at("unique") == true, "the unique moniker");
        check(monikers[1].at("identifier") == "counter" && monikers[1].at("unique") == false,
              "unique:false 必须原样出去：它表示同名符号可能有多个");
    });

    run("codeLens 丢掉没有 command 的条目，arguments 可选", [&] {
        const auto result = full.ok("codeLens", kDoc, 0, 0);
        const auto& items = result.at("items");
        check(result.at("available") == true && items.size() == 2,
              "三条里只该留两条，got " + std::to_string(items.size()));
        check(items[0].at("title") == "3 usages" && items[0].at("command") == "showUsages",
              "title 与 command 名都来自 command 对象");
        check(items[0].at("arguments").size() == 1 &&
                  items[0].at("arguments")[0].get<std::string>().find("Sample") != std::string::npos,
              "arguments 原样透传，点击时才能直接转成 workspace/executeCommand");
        check(!items[1].contains("arguments"), "服务器没给 arguments 就不要补一个空数组");
        check(items[1].at("range").at("startLine") == 3 && items[1].at("range").at("endChar") == 6,
              "四个角都整形出来");
    });

    run("inlineCompletion 丢弃 snippet 形，保留 plainText 与字符串", [&] {
        const auto result = full.ok("inlineCompletion", kDoc, 0, 0);
        const auto& items = result.at("items");
        check(result.at("available") == true && items.size() == 2,
              "三项里只该留两项（snippet 不展开就是往代码里写占位符），got " + std::to_string(items.size()));
        check(items[0].at("insertText") == "countLocal()" && items[0].at("filterText") == "countLocal",
              "字符串形的 insertText");
        check(items[0].at("range").at("startLine") == 2 && items[0].at("range").at("startChar") == 4 &&
                  items[0].at("range").at("endLine") == 2 && items[0].at("range").at("endChar") == 7,
              "替换区间四角完整");
        check(items[1].at("insertText") == " += 1" && !items[1].contains("range"),
              "plainText 形取 value；没给 range 就不补");
        // 位置敏感项：行号 > 0 时服务器多给一条 —— 证明 position 真的发出去了。
        const auto deeper = full.ok("inlineCompletion", kDoc, 3, 0);
        check(deeper.at("items").size() == 3, "行号带上去了，got " + std::to_string(deeper.at("items").size()));
    });

    run("documentLink 保留没有 target 的那条（能显示 tooltip）", [&] {
        const auto result = full.ok("documentLink", kDoc, 0, 0);
        const auto& links = result.at("links");
        check(result.at("available") == true && links.size() == 3, "三条都该留着");
        check(links[0].at("target") == "https://example.com/issues/42" && links[0].at("tooltip") == "打开 issue 42",
              "完整的一条");
        check(links[0].at("startLine") == 0 && links[0].at("startChar") == 2 && links[0].at("endChar") == 27,
              "range 直接放在项上（不像 definition 包在 location 里）");
        check(!links[2].contains("target") && links[2].contains("tooltip"),
              "没有 target 的项：保留区间与 tooltip，能不能点由前端判");
    });

    run("semanticTokens 整份取：legend 来自服务器", [&] {
        const auto result = full.ok("semanticTokens", kDoc, 0, 0);
        check(result.at("available") == true && result.at("kind") == "full", "没有 previousResultId 就是 full");
        check(result.at("resultId") == "fake-tokens-1", "resultId 要带出去，下一次才能问 delta");
        check(result.at("data").size() == 15, "五个整数一组 × 3 个 token");
        const auto& legend = result.at("legend");
        check(legend.at("tokenTypes").size() == 23 && legend.at("tokenModifiers").size() == 10,
              "解码必须用**服务端**那张表，索引才是服务端那个顺序");
    });

    run("semanticTokens delta：edits 有、data 没有", [&] {
        const auto result = full.ok("semanticTokens", kDoc, 0, 0, Json{{"previousResultId", "fake-tokens-1"}});
        check(result.at("kind") == "delta", "有 previousResultId 且服务器声明了 delta → 走 /full/delta");
        check(result.at("resultId") == "fake-tokens-2", "新的 resultId");
        const auto& edits = result.at("edits");
        check(edits.size() == 1 && edits[0].at("start") == 10 && edits[0].at("deleteCount") == 5 &&
                  edits[0].at("data").size() == 5, "edits 的三个字段都整形出来");
        check(!result.contains("data"),
              "delta 回答里没有 data 就不要补 —— 空 data 会让前端把整份着色清空重来");
    });

    run("semanticTokens delta 对不上号时按整份替换处理", [&] {
        const auto result = full.ok("semanticTokens", kDoc, 0, 0, Json{{"previousResultId", "stale-id"}});
        check(result.at("kind") == "delta", "客户端发的是 delta 请求");
        check(result.at("data").size() == 15, "服务器有权回整份 data（联合类型的另一支）");
        check(result.at("edits").empty(), "这一支没有 edits，但键必须存在且为空数组：前端据此只换不叠");
    });

    run("completion 的 raw 原样喂给 completionItem/resolve，补齐文档与 import", [&] {
        const auto completion = full.ok("completion", kDoc, 0, 6);
        const auto& item = item_by_label(completion.at("items"), "counter");
        check(item.contains("raw") && item.at("raw").contains("data"),
              "raw 必须是服务器给的原始项（resolve 靠里面的 data 找回条目）");
        const auto marker = item.at("raw").at("data").value("marker", std::string());
        check(!marker.empty() && item.at("detail") == marker, "detail 里带着前缀与位置，证明同步与位置都到了服务器");

        const auto resolved = full.ok("completionItemResolve", kDoc, 0, 6, Json{{"raw", item.at("raw")}});
        check(resolved.at("available") == true && resolved.at("supported") == true, "resolve 成功");
        check(resolved.at("detail") == "resolved:" + marker, "解析后的 detail 覆盖式带回");
        check(resolved.at("documentation") == "docs for counter", "documentation 走与 hover 同一套展平");
        const auto& edits = resolved.at("additionalTextEdits");
        check(edits.size() == 1 && edits[0].at("text") == "import counter;\n" &&
                  edits[0].at("startLine") == 0 && edits[0].at("endChar") == 0,
              "接受这一项时要一并做的编辑（自动 import），形状与格式化返回的同一套");
    });

    run("pull 诊断 full：items 与推送同一套整形", [&] {
        const auto result = full.ok("diagnostic", kDoc, 0, 0);
        check(result.at("available") == true && result.at("supported") == true, "pull 诊断可用");
        check(result.at("kind") == "full", "没有 previousResultId 就是 full");
        check(result.at("resultId") == "fake-result-1", "resultId 要带出去，下一次才能拿它换 unchanged");
        const auto& items = result.at("items");
        check(items.size() == 1 && items[0].at("line") == 1 && items[0].at("character") == 2 &&
                  items[0].at("endLine") == 1 && items[0].at("endCharacter") == 5 &&
                  items[0].at("severity") == 2 && items[0].at("message") == "pull diagnostic" &&
                  items[0].at("source") == "fake", "四个角 + severity + source 都在");
    });

    run("pull 诊断 unchanged：不得伪装成「这个文件没诊断」", [&] {
        const auto result = full.ok("diagnostic", kDoc, 0, 0, Json{{"previousResultId", "fake-result-1"}});
        check(result.at("kind") == "unchanged", "服务器说没变就是没变");
        check(result.at("resultId") == "fake-result-1", "unchanged 也要把 resultId 带回来");
        check(!result.contains("items"),
              "unchanged 补一个空 items，等于把上一批诊断从问题面板里抹掉");
    });

    run("prepareRename 的三种形态：range+placeholder / null", [&] {
        const auto ok = full.ok("prepareRename", kDoc, 0, 6);
        check(ok.at("available") == true && ok.at("supported") == true, "此处可以改名");
        check(ok.at("startLine") == 0 && ok.at("startChar") == 6 && ok.at("endLine") == 0 && ok.at("endChar") == 12,
              "改名范围");
        check(ok.at("placeholder") == "originalName", "服务器给的占位名");

        const auto declined = full.ok("prepareRename", kDoc, 0, 99);
        check(declined.at("available") == false && declined.at("supported") == true,
              "null = 此处不能改名，但 prepareRename 本身是支持的（前端据此报错而不是跳过预校验）");
        check(!declined.contains("startLine"), "不可改名的位置不该带出半个范围");
    });

    run("整工程诊断把 full 与 unchanged 分开带出去", [&] {
        const auto first = full.ok("workspaceDiagnostic", "", 0, 0);
        check(first.at("available") == true, "workspace 诊断可用");
        const auto& reports = first.at("items");
        check(reports.size() == 2, "两个文件，got " + std::to_string(reports.size()));
        check(reports[0].at("kind") == "full" && reports[0].at("resultId") == "ws-1" &&
                  reports[0].at("diagnostics").size() == 1 &&
                  reports[0].at("diagnostics")[0].at("message") == "workspace diagnostic",
              "full 报告带诊断");
        check(reports[0].at("path") == kDoc, "uri 换回工作区相对路径");
        check(reports[1].at("kind") == "full" && reports[1].at("diagnostics").empty(),
              "没有 previousResultIds 时第二条也是 full，且 items 为空 → 真的没诊断");

        const auto again = full.ok("workspaceDiagnostic", "", 0, 0,
                                   Json{{"previousResultIds", Json::array({Json{{"path", kDoc}, {"value", "ws-1"}}})}});
        const auto& second = again.at("items")[1];
        check(second.at("kind") == "unchanged" && !second.contains("diagnostics"),
              "unchanged 的报告没有 items，整形也不该补 diagnostics 键");
    });

    full.shutdown();

    // ---------------------------------------------------------------- 门控：服务器没声明就别把请求发出去
    // 每一条都换一台带开关的服务器：门控读的是 initialize 里的能力声明，
    // 复用上一台会话等于没测。
    run("--no-folding-range：foldingRange 在本地就被拒", [] { Harness s({L"--no-folding-range"}); s.open(); s.refused("foldingRange"); s.shutdown(); });
    run("--no-moniker：moniker 在本地就被拒", [] { Harness s({L"--no-moniker"}); s.open(); s.refused("moniker"); s.shutdown(); });
    run("--no-code-lens：codeLens 在本地就被拒", [] { Harness s({L"--no-code-lens"}); s.open(); s.refused("codeLens"); s.shutdown(); });
    run("--no-document-link：documentLink 在本地就被拒", [] { Harness s({L"--no-document-link"}); s.open(); s.refused("documentLink"); s.shutdown(); });
    run("--no-inline-completion：inlineCompletion 在本地就被拒", [] { Harness s({L"--no-inline-completion"}); s.open(); s.refused("inlineCompletion"); s.shutdown(); });
    run("--no-semantic-tokens：semanticTokens 在本地就被拒（provider 声明成 null）", [] {
        Harness s({L"--no-semantic-tokens"}); s.open(); s.refused("semanticTokens"); s.shutdown();
    });
    run("--no-workspace-diagnostics：workspaceDiagnostic 在本地就被拒（嵌套字段）", [] {
        Harness s({L"--no-workspace-diagnostics"}); s.open();
        // 顶层 diagnosticProvider 还在，所以 unsupported() 查不到 —— 必须由这条分支自己再判一次。
        auto [result, error] = s.call("workspaceDiagnostic", "", 0, 0);
        check(result.is_null() && !error.is_null() && error.value("code", std::string()) == "LSP_UNSUPPORTED",
              "provider 对象在、但 workspaceDiagnostics:false —— 发出去只会被服务器拒");
        s.shutdown();
    });
    run("--no-resolve：completionItemResolve 回 supported:false 而不是错误", [] {
        Harness s({L"--no-resolve"}); s.open();
        const auto result = s.ok("completionItemResolve", kDoc, 0, 6, Json{{"raw", Json{{"label", "counter"}}}});
        check(result.at("supported") == false && result.at("available") == false,
              "服务器没开 resolveProvider：前端照用补全项里已有的信息，这不是失败");
        s.shutdown();
    });
    run("--no-semantic-delta：有 previousResultId 也只能整份取", [] {
        Harness s({L"--no-semantic-delta"}); s.open();
        const auto result = s.ok("semanticTokens", kDoc, 0, 0, Json{{"previousResultId", "fake-tokens-1"}});
        check(result.at("kind") == "full", "requests.full.delta 为 false 时不许发 /full/delta");
        s.shutdown();
    });
    run("provider 整个**缺席**时仍然要问一次（缺席 ≠ 拒绝）", [] {
        // 与上面几条的分别刻意在 `lsp_session.cpp` 的门控注释里：
        // 服务器**显式声明** false/null ⇒ 客户端本地拒发（LSP_UNSUPPORTED）；
        // 服务器**什么都没说** ⇒ 照问，因为不少真服务器实现的比声明的多。
        // `--no-pull-diagnostics` 就是不声明 `diagnosticProvider`，所以这里必须**拿到结果**；
        // 拿不到（被本地拒了）才是回归。
        Harness s({L"--no-pull-diagnostics"}); s.open();
        const auto result = s.ok("diagnostic", kDoc, 0, 0);
        check(result.at("supported") == true && result.at("kind") == "full" &&
                  result.at("items").size() == 1, "没声明也要问得回来，答案照常整形");
        s.shutdown();
    });

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
