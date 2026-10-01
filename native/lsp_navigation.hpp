// 「转到声明」这一条（`definition` / `declaration`）—— 从 `native/lsp_session.cpp` 抽出来的一域。
// 那边贴着 1075 行上限，而这条退化的整形（位置收集 + declaration → definition 两跳）自成一段。
#pragma once

#include "lsp_session.hpp"

namespace taocode {
namespace lsp {

/** 只处理 `definition` / `declaration`（含 declaration → definition 的退化）。已处理返回 true。 */
bool Session::dispatch_navigation(const std::string& kind, const std::string& uri, Host& host, const Json& position,
                                  ResultHandler& on_result);

}  // namespace lsp
}  // namespace taocode
