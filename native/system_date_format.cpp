#include "system_date_format.hpp"

#include "text.hpp"

#include <optional>
#include <string>
#include <windows.h>

namespace taocode {
namespace {

std::optional<std::wstring> locale_pattern(LCTYPE type) {
    const int capacity = GetLocaleInfoEx(LOCALE_NAME_USER_DEFAULT, type, nullptr, 0);
    if (capacity <= 1) return std::nullopt;
    std::wstring value(static_cast<std::size_t>(capacity), L'\0');
    const int length = GetLocaleInfoEx(LOCALE_NAME_USER_DEFAULT, type, value.data(), capacity);
    if (length <= 1) return std::nullopt;
    value.resize(static_cast<std::size_t>(length - 1));
    return value;
}

std::optional<std::wstring> user_locale_name() {
    wchar_t value[LOCALE_NAME_MAX_LENGTH]{};
    const int length = GetUserDefaultLocaleName(value, LOCALE_NAME_MAX_LENGTH);
    if (length <= 1) return std::nullopt;
    return std::wstring(value, static_cast<std::size_t>(length - 1));
}

}  // namespace

Json system_date_time_formats() {
    const auto date = locale_pattern(LOCALE_SSHORTDATE);
    const auto short_time = locale_pattern(LOCALE_SSHORTTIME);
    const auto medium_time = locale_pattern(LOCALE_STIMEFORMAT);
    const auto locale = user_locale_name();
    if (!date || !short_time || !medium_time || !locale) return nullptr;
    try {
        return Json{{"datePattern", utf8(*date)},
                    {"shortTimePattern", utf8(*short_time)},
                    {"mediumTimePattern", utf8(*medium_time)},
                    {"locale", utf8(*locale)}};
    } catch (...) {
        return nullptr;
    }
}

}  // namespace taocode
