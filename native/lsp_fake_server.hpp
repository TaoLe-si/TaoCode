// 假 LSP 服务器的模块边界。
//
// 拆之前是一个 762 行的单文件：helper、能力声明、35 个请求分支、主循环全挤在一起 ——
// 改一处时锚点不唯一就误删了一大段（见 .workbuddy/memory 当天日志）。现在按职责分：
//   lsp_fake_server.cpp           主循环 + 通知处理 + 命令行开关
//   lsp_fake_server_support.cpp   helper + 会话状态 + 出帧
//   lsp_fake_server_requests.cpp  请求分派（35 个 method 分支，单一职责）
//
// **状态是文件级的**：这是一个单进程单会话的测试夹具（同时只服务一个客户端），
// 把状态当参数穿进 35 个分支只会让每处都多写一个参数，收益为零 —— 所以用具名 namespace
// 的全局变量 + 显式 `extern` 声明，读代码时一眼能看到它们的作用域有多大。
#pragma once

#include "lsp.hpp"

#include <cstddef>
#include <cstdlib>
#include <functional>
#include <iostream>
#include <string>

namespace fake_server {

using taocode::Json;

// 命令行开关：能力声明与同步模式都由它决定。
struct Flags {
    bool incremental = false;              // --incremental
    bool extras = false;                   // --extras
    bool no_terminate = false;             // 以下都是"把这个能力声明成不支持"的开关
    bool no_restart = false;
    bool no_goto = false;
    bool no_completions = false;
    bool no_breakpoint_locations = false;
    bool no_selection_range = false;
    bool no_folding_range = false;
    bool no_resolve = false;
    bool no_pull_diagnostics = false;
    bool no_execute_command = false;
    bool no_file_operations = false;
    bool no_semantic_tokens = false;
    bool no_semantic_delta = false;
    bool no_document_link = false;
    bool no_inline_completion = false;
    bool no_code_lens = false;
    bool no_moniker = false;
    bool no_workspace_diagnostics = false;
    bool stop_on_exception = false;
    bool bare_exception_info = false;
    std::string hang;                      // --hang=<method>：收到就不回答
    // --stall-stdin=<毫秒>：答完 initialize 之后**停止读 stdin** 这么久 —— 真实世界里
    // JDT LS 导入大工程时就是这样。用来验证客户端写文档不会把调用方堵在 WriteFile 上。
    int stall_stdin_ms = 0;
};

// 会话状态（单会话夹具，见文件头说明）。
extern std::string opened_uri;
extern std::string document_text;
extern bool saw_source_paths;

// 出帧：主循环用 set_sender 注入真正的 stdio 写入，请求处理那边只管构造消息。
using Sender = std::function<void(const Json&)>;
void set_sender(Sender send);
void write_message(const Json& message);

// 构造响应用的 helper（原来都在匿名 namespace 里）。
std::string sibling_of(const std::string& uri, const std::string& name);
Json range(int start_line, int start_char, int end_line, int end_char);
Json location(const std::string& uri, int start_line, int start_char, int end_line, int end_char);
std::size_t step_of(unsigned char lead);
std::size_t offset_of(const std::string& text, int line, int character);
std::string prefix_of(const std::string& text, int line, int character);
void splice(std::string& document, const Json& span, const std::string& replacement);
// 请求指向的文档 uri：优先 `params.textDocument.uri`，否则回退到最后一次 didOpen。
std::string requested(const Json& params);

// 请求分派（35 个 method 分支）。`id` 用来构造响应。
void handle_request(const Flags& flags, const std::string& method, const Json& params, const Json& id);

}  // namespace fake_server
