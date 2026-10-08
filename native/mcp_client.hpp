#pragma once

#include <filesystem>
#include <atomic>
#include <map>
#include <memory>

#include "workspace.hpp"

namespace taocode::mcp_client {

class Manager {
public:
    Manager();
    ~Manager();
    Manager(const Manager&) = delete;
    Manager& operator=(const Manager&) = delete;

    Json configure(const Json& settings, const std::filesystem::path& working_directory);
    Json snapshot();
    Json call(const Json& params);
    void stop_all() noexcept;
    void set_cancel_flag(std::atomic<bool>* flag) { cancel_flag_ = flag; }

private:
    struct Connection;
    Json snapshot_unchecked();
    std::map<std::string, std::unique_ptr<Connection>> connections_;
    std::map<std::string, Json> statuses_;
    Json tools_ = Json::array();
    std::atomic<bool>* cancel_flag_{};
};

}  // namespace taocode::mcp_client
