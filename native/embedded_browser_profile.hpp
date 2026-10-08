#pragma once

#include <windows.h>
#include <wrl.h>
#include <WebView2.h>
#include <filesystem>
#include <functional>
#include <memory>

namespace taocode {

class EmbeddedBrowserProfile {
public:
    EmbeddedBrowserProfile();
    ~EmbeddedBrowserProfile();
    EmbeddedBrowserProfile(const EmbeddedBrowserProfile&) = delete;
    EmbeddedBrowserProfile& operator=(const EmbeddedBrowserProfile&) = delete;

    void start(HWND owner, const std::filesystem::path& user_data_folder, bool allow_insecure_certificates);
    bool set_allow_insecure_certificates(bool allow);
    void clear_data(const char* mode, std::function<void(bool)> completed);
    void close() noexcept;

private:
    struct State;
    std::shared_ptr<State> state_;
};

}  // namespace taocode
