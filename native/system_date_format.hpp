#pragma once

#include "workspace.hpp"

namespace taocode {

// The Windows user's regional patterns. A null result means the UI should use
// its locale-based SHORT/MEDIUM formatter fallback.
Json system_date_time_formats();

}  // namespace taocode
