// Gradle 宿主支持的实现（见 gradle.hpp 的源码对照与职责说明）。
#include "gradle.hpp"

#include <atomic>
#include <mutex>
#include <thread>
#include <vector>

#include "base64.hpp"
#include "runner.hpp"
#include "text.hpp"  // taocode::wide
#include "text.hpp"  // taocode::wide（命令行整串交给 cmd.exe）

namespace taocode {
namespace gradle {

struct SyncSession::Impl {
    std::unique_ptr<Runner> runner;
    std::mutex mutex;
    // 与 done 回调共享：`cancel()` 之后回调要能告诉宿主"这是被取消的"。
    std::shared_ptr<std::atomic<bool>> cancelled = std::make_shared<std::atomic<bool>>(false);
};

SyncSession::SyncSession() : impl_(std::make_unique<Impl>()) {}
SyncSession::~SyncSession() { cancel(); }

bool SyncSession::running() const { return impl_->runner && impl_->runner->running(); }

void SyncSession::cancel() {
    impl_->cancelled->store(true);
    // `Runner::stop()` 会连子进程树一起杀（内部有 Job Object），所以取消 Gradle 不会留下孤儿 daemon。
    if (impl_->runner) impl_->runner->stop();
}

void SyncSession::start(const std::filesystem::path& root, const std::string& command,
                        const std::vector<std::string>& environment, Emit emit, Done done) {
    if (running()) throw WorkspaceError("BUSY", "已有 Gradle 同步在进行中。");
    std::lock_guard lock(impl_->mutex);
    impl_->cancelled->store(false);
    impl_->runner = std::make_unique<Runner>();
    auto* runner = impl_->runner.get();
    auto cancelled = impl_->cancelled;

    Runner::Spec spec;
    // 命令整串交给 shell：wrapper 是 .bat，用户设置的 gradle 路径也可能带引号。
    spec.command = L"cmd.exe";
    spec.arguments = {L"/d", L"/s", L"/c", taocode::wide(command)};
    spec.working_directory = root;
    // 「Gradle JVM」：`JAVA_HOME` 之类的覆盖叠在继承来的环境之上（见 gradle.hpp 的说明）。
    for (const auto& entry : environment) {
        if (entry.find('=') == std::string::npos) continue;
        spec.environment.push_back(taocode::wide(entry));
    }

    try {
        runner->start(spec,
                      [emit = std::move(emit)](const Runner::Chunk& chunk) { if (emit) emit(chunk.text); },
                      [done = std::move(done), cancelled](int code) { if (done) done(code, cancelled->load()); });
    } catch (const WorkspaceError&) {
        throw;
    } catch (const std::exception& error) {
        throw WorkspaceError("SYNC_SPAWN", std::string("无法启动 Gradle：") + error.what());
    }
}

Json start_sync(SyncSession& session, const std::string& fallback_root, const Json& params,
                const std::function<void(Json)>& emit) {
    const auto root = std::filesystem::path(taocode::wide(params.value("root", fallback_root)));
    const auto command = params.value("command", std::string());
    if (root.empty() || command.empty()) throw WorkspaceError("INVALID_REQUEST", "缺少同步目录或命令。");
    emit({{"event", "gradle.started"}, {"command", command}});
    session.start(root, command, params.value("env", std::vector<std::string>{}),
                  [&emit](std::string_view chunk) {
                      if (chunk.empty()) return;
                      emit({{"event", "gradle.output"}, {"dataB64", base64_encode(chunk)}});
                  },
                  [&emit](int code, bool cancelled) {
                      emit({{"event", "gradle.exit"}, {"code", code}, {"cancelled", cancelled}});
                  });
    return {{"started", true}, {"command", command}};
}

}  // namespace gradle
}  // namespace taocode
