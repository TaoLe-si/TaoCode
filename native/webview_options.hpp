#pragma once

// WebView2 的环境选项（宿主侧）—— 目前只做一件事：**关掉 HTTP 缓存**。
//
// 为什么必须关（2026-09-27 桃实测到的真问题：「你部署的UI全是旧的」）：
// 宿主用 `SetVirtualHostNameToFolderMapping(L"taocode.local", ui, …)`（`native/main.cpp:1726`）
// 把 **exe 旁的 ui 目录**映射成一个虚拟站点，而 WebView2 会按 HTTP 的规则**缓存**这些响应，
// 缓存落在用户数据目录里 —— 本仓的用户数据目录是 `%LOCALAPPDATA%\TaoCode`（持久，重启不清）。
// 于是「重新构建前端 → 重启 exe」看到的仍是**上一次**的页面：旧 `index.html` 引用旧 hash 的 js，
// 磁盘上明明已经是新的（这次排查时 `build/ui/index.html` 与它引用的 `index-CR47DjhQ.js` 都是新的，
// 里面也确实有新功能的字符串 —— 唯一对不上的就是浏览器手里那份缓存）。
//
// ui 是随 exe 分发到本地的资源目录，"每次启动都以磁盘上那份为准"才是对的行为，
// 所以直接传 `--disable-http-cache`（Chromium 的标准开关，对虚拟主机映射同样生效）。
#include <windows.h>

#include <wrl.h>

#include <filesystem>
#include <string>
#include <system_error>

#include "WebView2.h"
#include "WebView2EnvironmentOptions.h"

namespace taocode {

/**
 * 导航用的 URL：`https://taocode.local/index.html?v=<index.html 的修改时间>`。
 *
 * 为什么还要这一层（`--disable-http-cache` 之外）：`SetVirtualHostNameToFolderMapping` 映射的是
 * **虚拟主机**，它的响应不一定会走 Chromium 的 HTTP 缓存开关 —— 实测里"重新构建 + 重启 exe
 * 仍是旧页面"就是这条路径。URL 上带一个**随文件变化的参数**是确定能破缓存的：
 *   · 换 hash 一定重新请求 `index.html`，它引用的带哈希的 js 也就跟着换；
 *   · 同源（`taocode.local`）不变，所以 localStorage / session 都不受影响；
 *   · ui 目录是随 exe 分发的本地资源，读一次的开销可以忽略。
 * 拿不到时间戳（文件不在）就退回不带参数的 URL，交给上面的 `--disable-http-cache`。
 */
inline std::wstring ui_url(const std::filesystem::path& ui_dir) {
    std::wstring url = L"https://taocode.local/index.html";
    std::error_code error;
    const auto stamp = std::filesystem::last_write_time(ui_dir / L"index.html", error);
    if (error) return url;
    url += L"?v=" + std::to_wstring(static_cast<long long>(stamp.time_since_epoch().count()));
    return url;
}

/**
 * 交给 `CreateCoreWebView2EnvironmentWithOptions` 的第三个参数。
 * 拿到之后要**一直持有到环境创建完成**（`Create…` 是异步的），所以调用方拿返回值存变量再 `.Get()`。
 */
inline Microsoft::WRL::ComPtr<ICoreWebView2EnvironmentOptions> webview_environment_options() {
    auto options = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
    if (options) {
        std::wstring arguments = L"--disable-http-cache";
        // 诊断开关：设 TAOCODE_DEBUG_PORT=9333 再启动，就能用 CDP 连进真实运行的
        // 页面取证（加载了哪个 bundle、DOM 状态）。不开端口时与原先完全一致。
        wchar_t port[16]{};
        if (GetEnvironmentVariableW(L"TAOCODE_DEBUG_PORT", port, 16) && *port) {
            arguments += L" --remote-debugging-port=";
            arguments += port;
        }
        options->put_AdditionalBrowserArguments(arguments.c_str());
    }
    return Microsoft::WRL::ComPtr<ICoreWebView2EnvironmentOptions>(options.Get());
}

}  // namespace taocode
