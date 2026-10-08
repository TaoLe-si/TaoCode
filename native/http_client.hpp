// 最小的 **HTTP GET 通道**（宿主侧）—— 上游 `HttpFileSystemBase` / `HttpVirtualFileImpl`
// （`platform/platform-impl/src/com/intellij/openapi/vfs/http/`）与 `RemoteFileManagerImpl` 一族
// 在本仓的**取数那一半**。
//
// 为什么要有它（判词 `pf/vfs` / `ic/vfs` / `pf/file-editor` 反复出现的「http/wsl 没有通道」）：
//   · 前端的 `index.html` CSP 是 `connect-src 'self' ws://127.0.0.1:5173` —— WebView2 里
//     `fetch('https://…')` 被 CSP 直接拦掉，浏览器侧**做不到**跨源取数；
//   · 宿主（Win32 进程）没有这个限制，所以「打开 http:// 链接的只读文件」这件事只能由宿主取数。
//   本文件用系统自带的 **WinHTTP**（`winhttp.lib`，与 `shell32` 一样是 Windows 系统库）做一件
//   最小的事：GET 一个 http/https URL，把正文（或错误）原样交给调用方。
//
// 安全边界（与 `native/workspace.cpp` 的 `open_external` 同一档纪律 —— 拒绝没有协议前缀的东西）：
//   · **只认 http / https**：`file:`、`ftp:`、`javascript:` 等一律拒（前两者另有通道/不适用，
//     后者是脚本注入）。协议大小写不敏感。
//   · **不跟随跨协议重定向**：WinHTTP 的默认策略已禁 https→http 的降级（`WINHTTP_OPTION_REDIRECT_POLICY`
//     默认 `DISALLOW_HTTPS_TO_HTTP`），这里显式设成 `WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS`
//     之外的那一档不必要 —— 用默认档并**读回最终 URL**，让调用方知道真实取的是哪儿。
//   · **大小上限**：默认 4 MiB（与 `file.readBinary` 的默认档同一数量级），超了截断并置 `truncated`
//     —— 一个 500 MiB 的响应不该把桥上的 JSON 撑爆。
//   · **超时**：默认 15 秒（resolve/connect/send/receive 四档各一份），到点整条失败而不是挂着。
//
// 与上游的差异（如实）：上游 `HttpVirtualFile` 是一个**可刷新、可缓存、可写回**的虚拟文件，
// 还带 `RemoteFileManager` 的凭证与代理；本文件只有"取一次正文"这一格 —— 它是那条 VFS 的
// **最小可用子集**，不是它的等价物。缓存/刷新/只读策略落在前端 `src/remoteFiles.ts`。
#pragma once

#include <cstddef>
#include <functional>
#include <map>
#include <string>
#include <string_view>
#include <stop_token>

#include "workspace.hpp"  // Json

namespace taocode {

/** `http_get` 的入参与结果（结果形状见 `http_get` 的注释）。 */
struct HttpRequest {
    /** 完整 URL（`http://…` / `https://…`，大小写不敏感）。 */
    std::string url;
    /** 正文大小上限（0 = 用默认 4 MiB）。 */
    std::size_t limit = 0;
    /** 整条请求的超时毫秒（0 = 用默认 15000）。 */
    std::size_t timeout_ms = 0;
    /** POST UTF-8 正文。 */
    std::string body;
    /** 额外请求头。 */
    std::map<std::string, std::string> headers;
};

/**
 * 取一个 URL 的正文。
 *
 * 成功：`{available:true, url, finalUrl, status, contentType, bytes, truncated, content}`
 *   · `url` = 请求的地址；`finalUrl` = 重定向之后的地址（没重定向时与 `url` 同）；
 *   · `status` = HTTP 状态码；`contentType` = `Content-Type` 头（没有就是空串）；
 *   · `bytes` = 实际收到的字节数；`truncated` = 是否撞上限；
 *   · `content` = 正文（按 UTF-8 直读；二进制响应交给调用方自己判断 —— 本函数不猜编码）。
 * 失败：`{available:false, url, reason}` —— **不抛异常**（网络失败是常态，调用方要能显示原因），
 *   但**参数不合法**（协议不是 http/https、URL 为空）抛 `WorkspaceError("INVALID_REQUEST")`：
 *   那是调用方的编程错误，不是网络状况。
 */
Json http_get(const HttpRequest& request);

/** 发一次 POST，返回形状与 `http_get` 相同。请求头/正文不写入 trace 或响应元数据。 */
Json http_post(const HttpRequest& request);

/** 发一次 POST；2xx 正文按原始字节增量交给回调，非 2xx 正文留在返回值中。 */
Json http_post_stream(const HttpRequest& request, const std::function<void(std::string_view)>& on_chunk,
                      std::stop_token stop_token);

/** 这条 URL 能不能交给 `http_get`（协议是 http/https）。纯判定，不发请求 —— 供测试与前端口径对照。 */
bool http_url_supported(const std::string& url);

}  // namespace taocode
