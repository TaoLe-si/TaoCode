#pragma once

#include "workspace.hpp"

#include <atomic>
#include <exception>
#include <functional>
#include <thread>
#include <utility>

namespace taocode {

class WorkspaceSearchFileTask {
public:
    using Publish = std::function<void(Json)>;

    ~WorkspaceSearchFileTask() { stop(); }

    void start(Workspace& workspace, Json id, Publish publish) {
        stop();
        cancelled_.store(false);
        busy_.store(true);
        auto* instance = &workspace;
        thread_ = std::thread([this, instance, id = std::move(id), publish = std::move(publish)]() noexcept {
            Json reply{{"id", id}, {"ok", false}};
            try {
                reply["result"] = instance->search_files([this] { return cancelled_.load(); });
                reply["ok"] = true;
            } catch (const WorkspaceError& error) {
                reply["error"] = {{"code", error.code}, {"message", error.what()}};
            } catch (const std::exception&) {
                reply["error"] = {{"code", "SEARCH_FAILED"}, {"message", "工作区文件搜索失败。"}};
            }
            busy_.store(false);
            publish(std::move(reply));
        });
    }

    bool cancel() {
        const bool requested = busy_.load();
        cancelled_.store(true);
        return requested;
    }

    void stop() {
        cancelled_.store(true);
        if (thread_.joinable()) thread_.join();
        busy_.store(false);
    }

private:
    std::thread thread_;
    std::atomic<bool> busy_{false};
    std::atomic<bool> cancelled_{false};
};

}  // namespace taocode
