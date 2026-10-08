#include "embedded_browser_profile.hpp"

#include <atomic>
#include <memory>
#include <string>
#include <string_view>

namespace taocode {
namespace {

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
namespace fs = std::filesystem;

struct ProfileState {
    HWND host{};
    bool closed{};
    bool ready{};
    bool certificate_policy_ready{};
    bool allow_insecure_certificates{};
    ComPtr<ICoreWebView2Environment> environment;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> webview;
    ComPtr<ICoreWebView2_13> webview13;
    ComPtr<ICoreWebView2Profile2> profile;
    ComPtr<ICoreWebView2_14> webview14;
    EventRegistrationToken certificate_error_token{};
};

}  // namespace

struct EmbeddedBrowserProfile::State : ProfileState {};

EmbeddedBrowserProfile::EmbeddedBrowserProfile() : state_(std::make_shared<State>()) {}

EmbeddedBrowserProfile::~EmbeddedBrowserProfile() { close(); }

void EmbeddedBrowserProfile::start(HWND owner, const fs::path& user_data_folder, bool allow_insecure_certificates) {
    const auto state = state_;
    if (state->closed || state->host) return;
    state->allow_insecure_certificates = allow_insecure_certificates;
    state->host = CreateWindowExW(0, L"STATIC", L"", WS_POPUP, 0, 0, 1, 1, owner, nullptr,
                                  GetModuleHandleW(nullptr), nullptr);
    if (!state->host) return;

    const auto result = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, user_data_folder.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [state](HRESULT status, ICoreWebView2Environment* environment) -> HRESULT {
                if (state->closed || FAILED(status) || !environment) return S_OK;
                state->environment = environment;
                const auto create = environment->CreateCoreWebView2Controller(
                    state->host,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [state](HRESULT created, ICoreWebView2Controller* controller) -> HRESULT {
                            if (state->closed || FAILED(created) || !controller) return S_OK;
                            state->controller = controller;
                            controller->put_IsVisible(FALSE);
                            if (FAILED(controller->get_CoreWebView2(&state->webview)) || !state->webview) return S_OK;

                            ComPtr<ICoreWebView2Profile> profile;
                            if (SUCCEEDED(state->webview.As(&state->webview13)) && state->webview13 &&
                                SUCCEEDED(state->webview13->get_Profile(&profile)) && profile)
                                profile.As(&state->profile);
                            state->webview.As(&state->webview14);
                            if (state->webview14) {
                                state->certificate_policy_ready = SUCCEEDED(state->webview14->add_ServerCertificateErrorDetected(
                                    Callback<ICoreWebView2ServerCertificateErrorDetectedEventHandler>(
                                        [state](ICoreWebView2*, ICoreWebView2ServerCertificateErrorDetectedEventArgs* args) -> HRESULT {
                                            if (!args) return S_OK;
                                            args->put_Action(state->allow_insecure_certificates
                                                ? COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW
                                                : COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_DEFAULT);
                                            return S_OK;
                                        }).Get(),
                                    &state->certificate_error_token));
                            }
                            if (!state->certificate_policy_ready) state->allow_insecure_certificates = false;
                            state->ready = state->profile.Get() != nullptr;
                            return S_OK;
                        }).Get());
                return FAILED(create) ? create : S_OK;
            }).Get());
    (void)result;
}

bool EmbeddedBrowserProfile::set_allow_insecure_certificates(bool allow) {
    const auto state = state_;
    if (!state || state->closed) return false;
    if (!allow && !state->ready) {
        state->allow_insecure_certificates = false;
        return true;
    }
    if (!state->ready) return false;
    if (allow && !state->certificate_policy_ready) return false;
    state->allow_insecure_certificates = allow;
    if (!allow && state->webview14) {
        state->webview14->ClearServerCertificateErrorActions(
            Callback<ICoreWebView2ClearServerCertificateErrorActionsCompletedHandler>(
                [](HRESULT) -> HRESULT { return S_OK; }).Get());
    }
    return true;
}

void EmbeddedBrowserProfile::clear_data(const char* mode, std::function<void(bool)> completed) {
    const auto state = state_;
    if (!state || state->closed || !state->ready || !state->profile || !mode) {
        completed(false);
        return;
    }

    COREWEBVIEW2_BROWSING_DATA_KINDS kinds{};
    if (std::string_view(mode) == "cache") {
        kinds = static_cast<COREWEBVIEW2_BROWSING_DATA_KINDS>(
            COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE |
            COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE |
            COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS);
    } else if (std::string_view(mode) == "all") {
        kinds = static_cast<COREWEBVIEW2_BROWSING_DATA_KINDS>(
            COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_SITE |
            COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE);
    } else {
        completed(false);
        return;
    }

    const auto callback = std::make_shared<std::function<void(bool)>>(std::move(completed));
    const auto completed_once = std::make_shared<std::atomic<bool>>(false);
    const auto result = state->profile->ClearBrowsingData(
        kinds,
        Callback<ICoreWebView2ClearBrowsingDataCompletedHandler>(
            [state, callback, completed_once](HRESULT status) -> HRESULT {
                if (!completed_once->exchange(true)) (*callback)(!state->closed && SUCCEEDED(status));
                return S_OK;
            }).Get());
    if (FAILED(result) && !completed_once->exchange(true)) (*callback)(false);
}

void EmbeddedBrowserProfile::close() noexcept {
    const auto state = state_;
    if (!state || state->closed) return;
    state->closed = true;
    state->ready = false;
    if (state->webview14 && state->certificate_error_token.value)
        state->webview14->remove_ServerCertificateErrorDetected(state->certificate_error_token);
    if (state->controller) state->controller->Close();
    state->webview14.Reset();
    state->webview13.Reset();
    state->webview.Reset();
    state->profile.Reset();
    state->controller.Reset();
    state->environment.Reset();
    if (state->host && IsWindow(state->host)) DestroyWindow(state->host);
    state->host = nullptr;
}

}  // namespace taocode
