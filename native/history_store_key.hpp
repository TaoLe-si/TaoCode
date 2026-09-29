#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace taocode {

// Deterministic 64-bit FNV-1a of the workspace root, hex-encoded, used only as a
// filesystem-safe history folder name. Stable across restarts (unlike std::hash).
// Keep the existing offset basis and byte handling: changing them would orphan stored history.
inline std::string store_hash(const std::string& value) {
    std::uint64_t hash = 1469598103934665603ULL;
    for (const unsigned char ch : value) { hash ^= ch; hash *= 1099511628211ULL; }
    static constexpr char digits[] = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 15; i >= 0; --i) { out[static_cast<std::size_t>(i)] = digits[hash & 15]; hash >>= 4; }
    return out;
}

}  // namespace taocode
