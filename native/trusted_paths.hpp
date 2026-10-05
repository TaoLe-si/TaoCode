// 受信任项目（IDEA `com.intellij.ide.trustedProjects`）在**执行侧的硬边界**。
//
// 前端的拦截（src/trustedProjects.ts）负责把原因说给用户听，但真正的门必须钉在宿主：
// `run.start`（构建 / 运行 / 外部工具）、`term.create`（终端）与调试会话的每次取用都在
// 这里过一遍 `generalSettings.trustedPaths`，前端即使漏了某条入口也执行不了。
// 上游同款：`BuildManager.java:765`、`ExternalSystemUtil.java:310`、`LspClientImpl.kt:314`
// 都是在执行前读 `TrustedProjects.isProjectTrusted`。
//
// 路径归一口径必须与 `src/trustedProjects.ts` 的 `normalizeTrustedPath` 完全一致
// （正斜杠、去尾斜杠、ASCII 小写；盘符根补回斜杠）—— 两份任何一边改了另一边都要跟着改。
#pragma once

#include <string>

#include "workspace.hpp"

namespace taocode {
namespace trusted {

/** 路径归一：正斜杠、去尾斜杠、ASCII 小写（非 ASCII 字节保持原样，见头文件口径说明）。 */
std::string normalize_path(const std::string& path);

/** 信任状态：`unknown` = 清单里没有祖先条目。 */
enum class State { unknown, trusted, untrusted };

/** 最近祖先的答案（上游 `TrustedProjectsStateStorage.getProjectPathTrustedState`）。 */
State state_for(const Json& entries, const std::string& path);

/** 未信任时不执行；`action` 是给用户看的动作名（构建 / 运行 / 终端 / 调试）。 */
void require_trusted(const Json& entries, const std::string& root, const std::string& action);

}  // namespace trusted
}  // namespace taocode
