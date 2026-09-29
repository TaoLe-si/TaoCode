// 本地时间的 `strftime` 包装 —— 唯一来源。
//
// 为什么要有这个头文件（2026-09-27 去重）：同一段 `localtime_s` + `strftime` 原先在
// `native/diagnostics.cpp` 里写了 **两遍**（日志行时间戳、打包日志的文件名戳）、
// `native/git.cpp` 里又写了一遍（blame 注解列的日期）。三处只有格式串不同 ——
// 正是"同一件事抄多份必然漂移"的那一类。
//
// 返回**空串**表示时间非法或格式化失败：调用方一律按"没有这个字段"处理，
// 不在日志/注解里留 `1970-01-01` 这种假值。
#pragma once

#include <cstddef>
#include <ctime>
#include <string>

namespace taocode {

/**
 * 把 epoch 秒按 `pattern` 渲染成**本地时间**（IDEA 的日志与注解列都是本地时间）。
 *
 * @param epoch_seconds `<= 0` 视为非法（那是 1970 之前或"没有时间戳"的哨兵值）。
 * @param pattern       `strftime` 格式串，例如 `"%Y-%m-%d %H:%M:%S"`。
 * @param buffer_size   栈上缓冲大小；格式串很长时传大一点。
 */
inline std::string format_local_time(long long epoch_seconds, const char* pattern, std::size_t buffer_size = 40) {
    if (epoch_seconds <= 0 || pattern == nullptr) return {};
    const std::time_t stamp = static_cast<std::time_t>(epoch_seconds);
    std::tm parts{};
    if (localtime_s(&parts, &stamp) != 0) return {};
    std::string buffer(buffer_size, '\0');
    const std::size_t written = std::strftime(buffer.data(), buffer.size(), pattern, &parts);
    if (written == 0) return {};
    buffer.resize(written);
    return buffer;
}

/** 当前时刻，同上。 */
inline std::string format_local_now(const char* pattern, std::size_t buffer_size = 40) {
    return format_local_time(static_cast<long long>(std::time(nullptr)), pattern, buffer_size);
}

}  // namespace taocode
