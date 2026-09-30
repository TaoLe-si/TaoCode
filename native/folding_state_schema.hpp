// 折叠状态落盘的校验（`ProjectSettings.foldingState`）—— 形状与上限见 .cpp 的头部说明。
#pragma once

#include "settings_schema.hpp"

#include <cstdint>

namespace taocode {

/** 校验一段 `foldingState`（项目级设置的一部分）。不合法时抛 `INVALID_SETTINGS`。 */
void validate_folding_state(const Json& value);

} // namespace taocode
