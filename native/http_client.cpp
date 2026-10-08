// 最小 HTTP GET 通道的实现 —— 只依赖 WinHTTP（Windows 系统库）+ nlohmann/json。
// 设计取舍、安全边界与「与上游的差异」写在 native/http_client.hpp 的文件头，这里不重复。
//
// 为什么不用 WinINet（`InternetOpenUrl`）：它挂在每个线程的 internet session 上、会带 IE 的
// 代理与缓存设置，且 `InternetReadFile` 的超时是按"每次调用"计的 —— 一次慢响应能把调用方挂住。
// WinHTTP 是服务型 API：超时四档可分别设（resolve/connect/send/receive），代理走系统设置但
// 不继承 IE 缓存，正是这一格要的。
#include "http_client.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <winhttp.h>

#include <algorithm>
#include <cctype>
#include <limits>
#include <string>
#include <vector>

namespace taocode {

namespace {

constexpr std::size_t kDefaultLimit = 4 * 1024 * 1024;
constexpr std::size_t kDefaultTimeoutMs = 15000;
/** 响应头里 `Content-Type` 的读取上限（正常值几十字节；防一个畸形的超长头）。 */
constexpr DWORD kMaxHeaderChars = 4096;

/** RAII 句柄（WinHTTP 的四种句柄都是 `HINTERNET`，关闭方式相同）。 */
struct InternetHandle {
    HINTERNET value = nullptr;
    InternetHandle() = default;
    explicit InternetHandle(HINTERNET handle) : value(handle) {}
    ~InternetHandle() { if (value) WinHttpCloseHandle(value); }
    InternetHandle(const InternetHandle&) = delete;
    InternetHandle& operator=(const InternetHandle&) = delete;
    InternetHandle(InternetHandle&& other) noexcept : value(other.value) { other.value = nullptr; }
    InternetHandle& operator=(InternetHandle&& other) noexcept {
        if (this != &other) { if (value) WinHttpCloseHandle(value); value = other.value; other.value = nullptr; }
        return *this;
    }
    explicit operator bool() const { return value != nullptr; }
    HINTERNET get() const { return value; }
};

std::string lower_ascii(std::string text) {
    for (auto& character : text)
        if (character >= 'A' && character <= 'Z') character = static_cast<char>(character - 'A' + 'a');
    return text;
}

std::wstring to_wide(const std::string& text) {
    if (text.empty()) return std::wstring();
    const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (size <= 0) return std::wstring();
    std::wstring out(static_cast<std::size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), size);
    return out;
}

/** 一档 WinHTTP 错误的可读原因（`GetLastError` 是调用点刚失败的那一条）。 */
std::string winhttp_error(const char* step) {
    return std::string(step) + "失败（WinHTTP 错误 " + std::to_string(GetLastError()) + "）。";
}

bool valid_header_name(const std::string& name) {
    if (name.empty()) return false;
    for (const unsigned char c : name) {
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') || c == '!' || c == '#' || c == '$' ||
            c == '%' || c == '&' || c == '\'' || c == '*' || c == '+' ||
            c == '-' || c == '.' || c == '^' || c == '_' || c == '`' ||
            c == '|' || c == '~') continue;
        return false;
    }
    return true;
}

/** URL 拆解结果（`WinHttpCrackUrl` 的产物里我们真正要的四格）。 */
struct CrackedUrl {
    bool ok = false;
    std::wstring host;
    std::wstring path;
    INTERNET_PORT port = 0;
    bool secure = false;
    std::string reason;
};

CrackedUrl crack(const std::string& url) {
    CrackedUrl out;
    const auto wide = to_wide(url);
    if (wide.empty()) { out.reason = "URL 不是有效的 UTF-8 文本。"; return out; }
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    parts.dwSchemeLength = static_cast<DWORD>(-1);
    parts.dwHostNameLength = static_cast<DWORD>(-1);
    parts.dwUrlPathLength = static_cast<DWORD>(-1);
    parts.dwExtraInfoLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(wide.c_str(), static_cast<DWORD>(wide.size()), 0, &parts)) {
        out.reason = "URL 解析失败（WinHttpCrackUrl）。";
        return out;
    }
    if (parts.nScheme != INTERNET_SCHEME_HTTP && parts.nScheme != INTERNET_SCHEME_HTTPS) {
        out.reason = "只支持 http / https 地址。";
        return out;
    }
    out.secure = parts.nScheme == INTERNET_SCHEME_HTTPS;
    out.host.assign(parts.lpszHostName, parts.dwHostNameLength);
    out.path.assign(parts.lpszUrlPath, parts.dwUrlPathLength);
    if (parts.dwExtraInfoLength && parts.lpszExtraInfo)
        out.path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
    if (out.path.empty()) out.path = L"/";
    out.port = parts.nPort;
    if (out.host.empty()) { out.reason = "URL 里没有主机名。"; return out; }
    out.ok = true;
    return out;
}

}  // namespace

bool http_url_supported(const std::string& url) {
    // 与 `crack` 同一口径的最轻判定：按协议前缀判（大小写不敏感），不发请求、不建句柄。
    const auto scheme_end = url.find(':');
    if (scheme_end == std::string::npos || scheme_end == 0) return false;
    const auto scheme = lower_ascii(url.substr(0, scheme_end));
    if (scheme != "http" && scheme != "https") return false;
    // `http://` 之后必须还有东西（`http://` 本身没有主机名，交给 `crack` 报错太晚）。
    const auto rest = url.substr(scheme_end + 1);
    if (rest.rfind("//", 0) != 0) return false;
    return rest.size() > 2;
}

static Json http_request(const HttpRequest& request, const char* method,
                         const std::function<void(std::string_view)>& on_chunk = {},
                         std::stop_token stop_token = {}) {
    if (request.url.empty()) throw WorkspaceError("INVALID_REQUEST", "HTTP URL 不能为空。");
    if (!http_url_supported(request.url))
        throw WorkspaceError("INVALID_REQUEST", "只支持 http / https 地址（本通道不发别的协议）。");
    if (std::string(method) != "GET" && std::string(method) != "POST")
        throw WorkspaceError("INVALID_REQUEST", "HTTP 方法不受支持。");
    if (request.body.size() > std::numeric_limits<DWORD>::max())
        throw WorkspaceError("INVALID_REQUEST", "HTTP 正文超过宿主接口上限。");

    std::wstring additional_headers;
    for (const auto& [name, value] : request.headers) {
        if (!valid_header_name(name) || value.find_first_of("\r\n\0", 0, 3) != std::string::npos)
            throw WorkspaceError("INVALID_REQUEST", "HTTP 请求头格式不合法。");
        const auto wide_header = to_wide(name + ": " + value + "\r\n");
        if (wide_header.empty()) throw WorkspaceError("INVALID_REQUEST", "HTTP 请求头不是有效的 UTF-8 文本。");
        additional_headers += wide_header;
    }
    if (additional_headers.size() > std::numeric_limits<DWORD>::max())
        throw WorkspaceError("INVALID_REQUEST", "HTTP 请求头超过宿主接口上限。");
    const std::size_t limit = request.limit == 0 ? kDefaultLimit : request.limit;
    const std::size_t timeout = request.timeout_ms == 0 ? kDefaultTimeoutMs : request.timeout_ms;

    Json answer{{"available", false}, {"url", request.url}};
    const auto parts = crack(request.url);
    if (!parts.ok) { answer["reason"] = parts.reason; return answer; }

    InternetHandle session(WinHttpOpen(L"TaoCode/0.1", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                                       WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session) { answer["reason"] = winhttp_error("创建 WinHTTP 会话"); return answer; }
    WinHttpSetTimeouts(session.get(), static_cast<int>(timeout), static_cast<int>(timeout),
                       static_cast<int>(timeout), static_cast<int>(timeout));

    InternetHandle connection(WinHttpConnect(session.get(), parts.host.c_str(), parts.port, 0));
    if (!connection) { answer["reason"] = winhttp_error("连接主机"); return answer; }

    const DWORD flags = parts.secure ? WINHTTP_FLAG_SECURE : 0;
    const auto wide_method = to_wide(method);
    InternetHandle request_handle(WinHttpOpenRequest(connection.get(), wide_method.c_str(), parts.path.c_str(),
                                                     nullptr, WINHTTP_NO_REFERER,
                                                     WINHTTP_DEFAULT_ACCEPT_TYPES, flags));
    if (!request_handle) { answer["reason"] = winhttp_error("构造 HTTP 请求"); return answer; }
    // 跟随重定向，但**不**允许 https → http 的降级（WinHTTP 的默认策略就是这个；显式写出来
    // 是为了下一个人改代码时看见这条边界，见 http_client.hpp 的文件头）。
    DWORD redirect_policy = WINHTTP_OPTION_REDIRECT_POLICY_DISALLOW_HTTPS_TO_HTTP;
    WinHttpSetOption(request_handle.get(), WINHTTP_OPTION_REDIRECT_POLICY, &redirect_policy, sizeof(redirect_policy));

    const DWORD body_size = static_cast<DWORD>(request.body.size());
    LPVOID body_data = request.body.empty() ? WINHTTP_NO_REQUEST_DATA : const_cast<char*>(request.body.data());
    if (!WinHttpSendRequest(request_handle.get(),
                            additional_headers.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : additional_headers.c_str(),
                            static_cast<DWORD>(additional_headers.size()), body_data, body_size, body_size, 0)) {
        answer["reason"] = winhttp_error("发送请求"); return answer;
    }
    if (!WinHttpReceiveResponse(request_handle.get(), nullptr)) {
        answer["reason"] = winhttp_error("接收响应"); return answer;
    }

    DWORD status = 0;
    DWORD status_size = sizeof(status);
    if (!WinHttpQueryHeaders(request_handle.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                             WINHTTP_HEADER_NAME_BY_INDEX, &status, &status_size, WINHTTP_NO_HEADER_INDEX)) {
        answer["reason"] = winhttp_error("读取状态码"); return answer;
    }
    std::string content_type;
    {
        std::vector<wchar_t> buffer(kMaxHeaderChars, L'\0');
        DWORD size = static_cast<DWORD>(buffer.size() * sizeof(wchar_t));
        if (WinHttpQueryHeaders(request_handle.get(), WINHTTP_QUERY_CONTENT_TYPE,
                                WINHTTP_HEADER_NAME_BY_INDEX, buffer.data(), &size, WINHTTP_NO_HEADER_INDEX)) {
            const std::wstring wide(buffer.data(), size / sizeof(wchar_t));
            if (const int bytes = WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()),
                                                      nullptr, 0, nullptr, nullptr); bytes > 0) {
                content_type.resize(static_cast<std::size_t>(bytes));
                WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()),
                                    content_type.data(), bytes, nullptr, nullptr);
            }
        }
    }
    // 最终 URL（重定向之后）。取不到就与请求地址同 —— 不编一个假地址出来。
    std::string final_url = request.url;
    {
        std::vector<wchar_t> buffer(kMaxHeaderChars, L'\0');
        DWORD size = static_cast<DWORD>(buffer.size() * sizeof(wchar_t));
        if (WinHttpQueryOption(request_handle.get(), WINHTTP_OPTION_URL, buffer.data(), &size)) {
            const std::wstring wide(buffer.data(), size / sizeof(wchar_t));
            if (const int bytes = WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()),
                                                      nullptr, 0, nullptr, nullptr); bytes > 0) {
                final_url.assign(static_cast<std::size_t>(bytes), '\0');
                WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()),
                                    final_url.data(), bytes, nullptr, nullptr);
            }
        }
    }

    std::string body;
    bool truncated = false;
    std::uint64_t received = 0;
    const bool stream_success = static_cast<bool>(on_chunk) && status >= 200 && status < 300;
    for (;;) {
        if (stop_token.stop_requested()) {
            answer["cancelled"] = true;
            answer["reason"] = "请求已取消。";
            return answer;
        }
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(request_handle.get(), &available)) {
            answer["reason"] = winhttp_error("查询可读字节"); return answer;
        }
        if (available == 0) break;
        const std::size_t room = stream_success ? available : (limit > body.size() ? limit - body.size() : 0);
        if (room == 0) { truncated = true; break; }
        const DWORD take = static_cast<DWORD>(std::min<std::size_t>(stream_success ? std::min<std::size_t>(room, 8192) : room, available));
        std::string chunk(take, '\0');
        DWORD got = 0;
        if (!WinHttpReadData(request_handle.get(), chunk.data(), take, &got)) {
            answer["reason"] = winhttp_error("读取响应正文"); return answer;
        }
        chunk.resize(got);
        received += got;
        if (stream_success && got > 0) on_chunk(chunk);
        else body += chunk;
        if (got == 0) break;
        if (!stream_success && body.size() >= limit) { truncated = true; break; }
    }

    answer["available"] = true;
    answer["finalUrl"] = std::move(final_url);
    answer["status"] = static_cast<std::uint32_t>(status);
    answer["contentType"] = std::move(content_type);
    answer["bytes"] = received;
    answer["truncated"] = truncated;
    answer["content"] = std::move(body);
    return answer;
}

Json http_get(const HttpRequest& request) {
    HttpRequest get = request;
    get.body.clear();
    get.headers.clear();
    return http_request(get, "GET");
}

Json http_post(const HttpRequest& request) {
    return http_request(request, "POST");
}

Json http_post_stream(const HttpRequest& request, const std::function<void(std::string_view)>& on_chunk,
                      std::stop_token stop_token) {
    return http_request(request, "POST", on_chunk, stop_token);
}

}  // namespace taocode
