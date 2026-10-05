// DAP 响应的**形状整形**：把适配器给的原始 payload 拍平成 UI 认的那一份。
//
// 为什么单独成文件（2026-10-05 模块化体检）：dap.cpp 贴着机检上限（1790 行，只剩 3 行余量），
// 而这一族只干一件事 —— "响应长什么样"。会话、管道、reader、反向请求钩子那些**机制**仍全在
// dap.cpp；请求的构造与发信也仍在那边。这里既不碰 socket 也不碰状态，所以它能单独读懂。
//
// 三条共同的整形口径（与 dap_inspect.cpp 一致，搬动时一个字没改）：
//   · 缺字段就**不写键**，绝不凭空补默认值 —— 前端拿不到键就不会渲染空行；
//   · 路径统一走 `Client::to_path`（工作区相对 '/'，工作区外原样规范化）；
//   · "空数组是有意义的答案"（IDEA 的 "Cannot find appropriate breakpoint type"）不能当错误上报。
//
// 这层刻意**不带能力判定**：能不能发那个请求是 dap.cpp 那一层的事，这里只管发出去之后怎么整形。
#pragma once

#include <string>
#include <vector>

#include "dap.hpp"

namespace taocode {
namespace dap {

/** 适配器事件 -> UI 认的事件形状（stopped / output / breakpoint / terminated / exited /
 *  module / loadedSource / progress 三相各自拍平；其余原样转发 body）。 */
Json shape_event(const std::string& name, const Json& body);

/** `stackTrace` -> {frames, totalFrames}。适配器少报 totalFrames 时不许报得比交付的还少。 */
Json shape_frames(const Client& client, const Json& body);

/** `scopes` -> {scopes}。 */
Json shape_scopes(const Json& body);

/** `setVariable` / `setExpression` 的回答：一条变量的新值（规范里没有 variables 数组）。 */
Json shape_set_variable(const Json& body);

/** `variables` -> {variables}。 */
Json shape_variables(const Json& body);

/** `exceptionInfo` -> {available, ...}。exceptionId 与 description 都空 = 适配器没答上来，
 *  这时回 available:false，而不是让 UI 显示一张空卡片。 */
Json shape_exception_info(const Json& body);

/** `breakpointLocations` -> {available, locations}。可选数值 <= 0 不写键。 */
Json shape_breakpoint_locations(const Json& body);

/** `completions` -> {available, items}。start/length 要么一起出要么都不出。 */
Json shape_completions(const Json& body);

/** `gotoTargets` -> {targets}。 */
Json shape_goto_targets(const Json& body);

/** 适配器认下来的那些行（它可能把断点挪到下一条真语句上，行号以它为准）。 */
Json verified_lines(const Json& body, const std::vector<int>& requested);

/** 只留下 DAP 认识的字段：1 基行号 + 用户真填了的可选条件。 */
Json normalize_breakpoints(const Json& requested);

/** 请求里的行号（配 verified_lines 用）。 */
std::vector<int> requested_lines(const Json& points);

/** 适配器带解释回过的断点（条件非法、行被挪走）—— UI 在标记旁显示这些。 */
Json breakpoint_messages(const Json& body);

}  // namespace dap
}  // namespace taocode
