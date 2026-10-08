// HTTP GET 通道（native/http_client.cpp）的判据。
//
// 这个测试**不真的联网**（CI 与开发机都不该依赖外网）：它钉的是这一格的**边界**——
// 协议白名单、URL 解析、参数校验、以及"网络失败如实回 reason 而不是抛异常/假成功"。
// 真实取数的那一半靠 `http_url_supported` 的判定 + 手动验证（`docs/` 里记了实测过的地址）。
//
// 上游依据：`platform/platform-impl/src/com/intellij/openapi/vfs/http/HttpFileSystemBase.java`
// 与 `HttpVirtualFileImpl`（`pf/vfs` / `ic/vfs` 判词里「http 没有通道」那一条）；
// 本文件只覆盖本仓通道**能兑现的那一格**（取一次正文），缓存/刷新/只读策略在前端。
#include "http_client.hpp"

#include <functional>
#include <iostream>
#include <string>

namespace {

int passed = 0;
int failures = 0;

void check(bool condition, const std::string& message) {
    if (condition) { ++passed; return; }
    ++failures;
    std::cerr << "FAIL " << message << '\n';
}

void run(const std::string& name, const std::function<void()>& body) {
    try { body(); }
    catch (const std::exception& error) {
        ++failures;
        std::cerr << "FAIL " << name << ": " << error.what() << '\n';
    }
}

/** 期望某段代码抛 `WorkspaceError`，且错误码是期望的那个。 */
void expect_error(const std::string& code, const std::function<void()>& body) {
    try {
        body();
    } catch (const taocode::WorkspaceError& error) {
        check(error.code == code, std::string("error code should be ") + code + ", got " + error.code);
        return;
    } catch (const std::exception& error) {
        check(false, std::string("unexpected exception: ") + error.what());
        return;
    }
    check(false, "expected a WorkspaceError, none was thrown");
}

}  // namespace

int main() {
    run("protocol whitelist accepts only http/https with a host", [] {
        check(taocode::http_url_supported("http://example.com/a.ts"), "http with host");
        check(taocode::http_url_supported("https://example.com"), "https with host");
        check(taocode::http_url_supported("HTTP://Example.COM/x"), "scheme is case-insensitive");
        check(taocode::http_url_supported("HtTpS://host/p"), "mixed case scheme");
        // 拒绝档：别的协议、没有主机名、没有 `//`、空串。
        check(!taocode::http_url_supported("file:///C:/x.ts"), "file: is refused");
        check(!taocode::http_url_supported("ftp://host/x"), "ftp: is refused");
        check(!taocode::http_url_supported("javascript:alert(1)"), "javascript: is refused");
        check(!taocode::http_url_supported("C:/Windows/calc.exe"), "a bare path is refused");
        check(!taocode::http_url_supported("http://"), "no host");
        check(!taocode::http_url_supported("http:/host"), "missing //");
        check(!taocode::http_url_supported(""), "empty");
        check(!taocode::http_url_supported("example.com"), "no scheme");
    });

    run("http_get refuses bad input before touching the network", [] {
        // 空 URL 与不受支持的协议是**调用方的编程错误**（不是网络状况）⇒ INVALID_REQUEST 抛出。
        expect_error("INVALID_REQUEST", [] { taocode::http_get({"", 0, 0}); });
        expect_error("INVALID_REQUEST", [] { taocode::http_get({"file:///C:/x.ts", 0, 0}); });
        expect_error("INVALID_REQUEST", [] { taocode::http_get({"javascript:alert(1)", 0, 0}); });
        expect_error("INVALID_REQUEST", [] { taocode::http_get({"ftp://host/x", 0, 0}); });
    });

    run("http_get reports an unreachable host as a reason, not an exception", [] {
        // 意图（不变）：**网络失败要如实说，不许假成功，也不许抛异常**。
        //
        // 为什么不再直接断言「连不上 ⇒ available=false」：原先那版靠 `.invalid`
        // （RFC 2606 保留域名）「永不解析」来制造连接失败，而 `http_get` 用的是
        // `WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY` —— **机器上开了系统代理时，请求会走代理，
        // 代理会对任何 URL 回一个错误响应**（本机实测 502 Bad Gateway）。
        // 于是那一版在直连机器上绿、在开着代理的机器上红，而它绿红都不是在测我们的代码。
        //
        // 改成钉**与环境无关的那条不变量**：回包要么如实说失败（带 reason、不带 content），
        // 要么如实说拿到了响应（带一个数字 status，调用方才分得清 200 与 502）——
        // 两种情况都算「诚实」，唯独「available=true 却没有 status」才是假成功。
        const auto answer = taocode::http_get({"http://taocode-test.invalid:9/x", 1024, 2000});
        check(answer.at("url") == "http://taocode-test.invalid:9/x", "the requested url is echoed back");
        if (answer.at("available") == false) {
            // 直连这一支：连不上 ⇒ 必须说清为什么，且不能夹带正文。
            check(answer.contains("reason") && answer.at("reason").get<std::string>().size() > 0,
                  "a failed fetch says why");
            check(!answer.contains("content"), "no content on failure");
        } else {
            // 走了代理这一支：拿到了响应 ⇒ 必须带数字状态码，否则调用方无从判断成败。
            // 实测代理对保留域名回 502，所以这里**只要求它是数字**，不钉具体值。
            check(answer.contains("status") && answer.at("status").is_number(),
                  "a successful fetch carries a numeric status");
        }
    });

    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}