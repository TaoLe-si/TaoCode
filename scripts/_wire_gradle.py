# 一次性脚本：把 Gradle 同步通道接进 native/main.cpp（事件队列 + 路由 + 成员）。
import io

APP = r'D:\TaoCode\native\main.cpp'
text = io.open(APP, encoding='utf-8').read()


def rep(old, new, count=1):
    global text
    assert text.count(old) == count, (old[:60], text.count(old))
    text = text.replace(old, new, count)


# 1) include
rep('#include "dialogs.hpp"', '#include "dialogs.hpp"\n#include "gradle.hpp"')

# 2) 事件消息常量（WM_APP + 9 已被 watch_restart 占用）
rep('constexpr UINT watch_restart_message = WM_APP + 9;',
    'constexpr UINT watch_restart_message = WM_APP + 9;\n'
    'constexpr UINT gradle_event_message = WM_APP + 10;')

# 3) 成员：事件队列 + 同步会话
rep('    std::unique_ptr<taocode::session::SessionStore> sessions;  // crash-recovery drafts, per profile',
    '    std::unique_ptr<taocode::session::SessionStore> sessions;  // crash-recovery drafts, per profile\n'
    '    // Gradle 同步：独立于"运行控制台"的通道（IDEA 的 Gradle 同步也不占运行按钮）。\n'
    '    std::unique_ptr<taocode::gradle::SyncSession> gradle_sync;\n'
    '    std::mutex gradle_mutex;\n'
    '    std::deque<Json> gradle_events;')

# 4) queue_gradle + drain_gradle：放在 drain_search 之前
rep('    void drain_search() {',
    '''    void queue_gradle(Json payload) {
        {
            std::lock_guard lock(gradle_mutex);
            gradle_events.push_back(std::move(payload));
            if (gradle_events.size() > 4096) gradle_events.erase(gradle_events.begin(), gradle_events.begin() + 1024);
        }
        PostMessageW(window, gradle_event_message, 0, 0);
    }

    void drain_gradle() {
        std::deque<Json> events;
        { std::lock_guard lock(gradle_mutex); events.swap(gradle_events); }
        if (webview) for (const auto& event : events) post_json(event);
    }

    void drain_search() {''')

# 5) window_proc：事件 case
rep('        case search_event_message:',
    '        case gradle_event_message:\n'
    '            app->drain_gradle();\n'
    '            break;\n'
    '        case search_event_message:')

# 6) 启动时创建会话（与 projects/sessions 一起）
rep('            taocode::diagnostics::init(app.profile, taocode::kAppVersion);',
    '            taocode::diagnostics::init(app.profile, taocode::kAppVersion);\n'
    '            app.gradle_sync = std::make_unique<taocode::gradle::SyncSession>();')

# 7) 路由：gradle.detect / gradle.sync / gradle.cancel / gradle.state
rep('            case "app.quit"_h:',
    '''            // Gradle 识别（`GradleConstants` 的脚本名/wrapper，等价于 IDEA 打开项目时的探测）。
            case "gradle.detect"_h: {
                const auto root = params.contains("root")
                    ? std::filesystem::path(taocode::wide(params.at("root").get<std::string>()))
                    : std::filesystem::path(taocode::wide(current_root));
                result = taocode::gradle::detect(root);
                break;
            }
            // 同步：跑一条 Gradle 命令（wrapper 优先，命令行由前端 src/gradle.ts 组装），
            // 输出与退出码走 `gradle.output` / `gradle.exit` 事件 —— 与运行控制台分开。
            case "gradle.sync"_h: {
                if (!gradle_sync) throw taocode::WorkspaceError("NOT_READY", "Gradle 通道尚未初始化。");
                const auto root = std::filesystem::path(taocode::wide(params.value("root", current_root)));
                const auto command = params.value("command", std::string());
                if (root.empty() || command.empty()) throw taocode::WorkspaceError("INVALID_REQUEST", "缺少同步目录或命令。");
                queue_gradle({{"event", "gradle.started"}, {"command", command}});
                gradle_sync->start(root, command,
                    [this](std::string_view chunk) {
                        if (chunk.empty()) return;
                        queue_gradle({{"event", "gradle.output"}, {"dataB64", base64_encode(chunk)}});
                    },
                    [this](int code, bool cancelled) {
                        queue_gradle({{"event", "gradle.exit"}, {"code", code}, {"cancelled", cancelled}});
                    });
                result = {{"started", true}, {"command", command}};
                break;
            }
            case "gradle.cancel"_h: {
                if (gradle_sync) gradle_sync->cancel();
                result = {{"cancelled", true}};
                break;
            }
            case "gradle.state"_h: {
                result = {{"running", gradle_sync && gradle_sync->running()}};
                break;
            }
            case "app.quit"_h:''')

io.open(APP, 'w', encoding='utf-8', newline='\n').write(text)
print('main.cpp gradle wiring ok', text.count('\n'), 'lines')
