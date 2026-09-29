#include "project_settings_state.hpp"

#include <array>
#include <cstdint>
#include <iterator>
#include <set>
#include <vector>

namespace taocode::project_settings {
namespace {

std::string stored_path(const Json& value) {
    if (!value.is_string()) fail("STATE_CORRUPT", "A stored project path is not a string.");
    return utf8_path(absolute_path(from_utf8(value.get_ref<const std::string&>()), true));
}

bool valid_timestamp(const std::string& value) {
    if (value.size() != 20 || value[4] != '-' || value[7] != '-' || value[10] != 'T' ||
        value[13] != ':' || value[16] != ':' || value[19] != 'Z') return false;
    for (std::size_t i = 0; i != value.size(); ++i) {
        if (i == 4 || i == 7 || i == 10 || i == 13 || i == 16 || i == 19) continue;
        if (value[i] < '0' || value[i] > '9') return false;
    }
    const auto number = [&](std::size_t start, std::size_t length) {
        unsigned result = 0;
        for (std::size_t i = start; i < start + length; ++i) result = result * 10 + value[i] - '0';
        return result;
    };
    const auto year = number(0, 4), month = number(5, 2), day = number(8, 2);
    constexpr unsigned days[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (year < 1601 || month < 1 || month > 12 || day < 1 || number(11, 2) > 23 ||
        number(14, 2) > 59 || number(17, 2) > 59) return false;
    const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    return day <= days[month - 1] + (month == 2 && leap ? 1u : 0u);
}

Json validate_document(Json value) {
    try {
        known_keys(value, {"recentProjects", "settings", "general", "lastProject", "perProject"}, "STATE_CORRUPT");
        if (value.contains("settings")) prune_unknown(value["settings"], EDITOR_SETTING_KEYS);
        if (value.contains("general")) prune_unknown(value["general"], GENERAL_SETTING_KEYS);
        if (!value.contains("recentProjects") || !value.at("recentProjects").is_array() ||
            value.at("recentProjects").size() > recent_limit || !value.contains("settings") ||
            !value.contains("lastProject"))
            fail("STATE_CORRUPT", "The saved project state has an invalid schema.");
        validate_editor_patch(value.at("settings"));
        const Json fallbacks = editor_defaults_impl();
        for (const auto& entry : fallbacks.items())
            if (!value["settings"].contains(entry.key())) value["settings"][entry.key()] = entry.value();
        // General settings need the same migration as editor settings. A sparse
        // legacy component must not make the first update dereference a missing timeout.
        if (value.contains("general")) {
            validate_general_patch(value.at("general"));
            auto general = general_defaults_impl();
            general.update(value.at("general"));
            value["general"] = std::move(general);
        }
        std::vector<std::string> paths;
        for (auto& recent : value.at("recentProjects")) {
            known_keys(recent, {"name", "path", "lastOpened", "available", "displayName",
                                "projectName", "activationTimestamp", "branchName"}, "STATE_CORRUPT");
            if (!recent.contains("name") || !recent.at("name").is_string() ||
                recent.at("name").get_ref<const std::string&>().empty() ||
                !valid_utf8(recent.at("name").get_ref<const std::string&>()) ||
                !recent.contains("path") || !recent.contains("lastOpened") ||
                !recent.at("lastOpened").is_string() ||
                !valid_timestamp(recent.at("lastOpened").get_ref<const std::string&>()) ||
                (recent.contains("available") && !recent.at("available").is_boolean()) ||
                (recent.contains("displayName") &&
                 (!recent.at("displayName").is_string() ||
                  !valid_utf8(recent.at("displayName").get_ref<const std::string&>()))) ||
                (recent.contains("projectName") &&
                 (!recent.at("projectName").is_string() ||
                  !valid_utf8(recent.at("projectName").get_ref<const std::string&>()))) ||
                (recent.contains("activationTimestamp") &&
                 (!recent.at("activationTimestamp").is_number_integer() ||
                  recent.at("activationTimestamp").get<int64_t>() < 0)) ||
                (recent.contains("branchName") &&
                 (!recent.at("branchName").is_string() ||
                  !valid_utf8(recent.at("branchName").get_ref<const std::string&>()))))
                fail("STATE_CORRUPT", "A saved recent project is invalid.");
            const auto path = stored_path(recent.at("path"));
            for (const auto& existing : paths) {
                if (equal_name(from_utf8(existing).native(), from_utf8(path).native()))
                    fail("STATE_CORRUPT", "Duplicate saved project paths.");
            }
            paths.push_back(path);
            recent["path"] = path;
            recent.erase("available"); // Availability is never trusted from disk.
        }
        if (!value.at("lastProject").is_null()) value["lastProject"] = stored_path(value.at("lastProject"));
        if (!value.contains("perProject")) value["perProject"] = Json::object();
        if (!value.at("perProject").is_object()) fail("STATE_CORRUPT", "perProject must be a map.");
        Json projects = Json::object();
        std::set<std::wstring, decltype([](const std::wstring& a, const std::wstring& b) {
            return CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(),
                                        static_cast<int>(b.size()), TRUE) == CSTR_LESS_THAN;
        })> keys;
        for (auto it = value.at("perProject").begin(); it != value.at("perProject").end(); ++it) {
            const auto path = stored_path(Json(it.key()));
            if (!keys.insert(from_utf8(path).native()).second)
                fail("STATE_CORRUPT", "Duplicate per-project settings paths.");
            // Old null fields take defaults rather than invalidating the profile.
            for (auto field = it.value().begin(); field != it.value().end();)
                field = field.value().is_null() ? it.value().erase(field) : std::next(field);
            validate_project_patch(it.value());
            if (!it.value().contains("excludedDirs")) fail("STATE_CORRUPT", "Incomplete per-project settings.");
            projects[path] = it.value();
        }
        value["perProject"] = std::move(projects);
        return value;
    } catch (const WorkspaceError& error) {
        if (error.code == "STATE_CORRUPT") throw;
        fail("STATE_CORRUPT", "The saved configuration is invalid; the original file was kept.");
    } catch (const Json::exception&) {
        fail("STATE_CORRUPT", "The saved configuration is invalid; the original file was kept.");
    }
}

std::string read_state_bytes(HANDLE handle) {
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(handle, &size)) win_error("Cannot inspect configuration size");
    if (size.QuadPart < 0 || size.QuadPart > static_cast<LONGLONG>(state_limit))
        fail("STATE_CORRUPT", "The configuration exceeds the 1 MiB limit; the original file was kept.");
    std::string result;
    result.reserve(static_cast<std::size_t>(size.QuadPart));
    std::array<char, 65536> buffer{};
    for (;;) {
        DWORD count = 0;
        if (!ReadFile(handle, buffer.data(), static_cast<DWORD>(buffer.size()), &count, nullptr))
            win_error("Cannot read application configuration");
        if (!count) break;
        if (count > state_limit - result.size()) fail("STATE_CORRUPT", "The configuration exceeds 1 MiB.");
        result.append(buffer.data(), count);
    }
    return result;
}

} // namespace

LoadedState load_state(const fs::path& file) {
    LoadedState loaded;
    loaded.parent = pin_directory(file.parent_path(), Missing::allow);
    if (!loaded.parent.exists) return loaded;
    loaded.original = Handle(CreateFileW(api_path(loaded.parent.path / file.filename()).c_str(),
                                        GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr,
                                        OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT |
                                        FILE_FLAG_BACKUP_SEMANTICS, nullptr));
    if (!loaded.original) {
        const auto error = GetLastError();
        if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) return loaded;
        win_error("Cannot open application configuration", error);
    }
    const auto info = file_info(loaded.original.get());
    reject_reparse(info);
    if ((info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || GetFileType(loaded.original.get()) != FILE_TYPE_DISK)
        fail("STATE_CORRUPT", "The configuration is not a regular file; it was not changed.");
    const auto bytes = read_state_bytes(loaded.original.get());
    try {
        // Reject ambiguous duplicate JSON keys and bound parser nesting as well as bytes.
        std::vector<std::set<std::string>> objects;
        const auto callback = [&](int depth, Json::parse_event_t event, Json& parsed) {
            if (depth > 32) fail("STATE_CORRUPT", "Configuration JSON is nested too deeply.");
            if (event == Json::parse_event_t::object_start) objects.emplace_back();
            else if (event == Json::parse_event_t::key) {
                if (objects.empty() || !objects.back().insert(parsed.get<std::string>()).second)
                    fail("STATE_CORRUPT", "Configuration JSON contains a duplicate key.");
            } else if (event == Json::parse_event_t::object_end) objects.pop_back();
            return true;
        };
        loaded.document = validate_document(Json::parse(bytes, callback));
    } catch (const Json::exception&) {
        fail("STATE_CORRUPT", "Cannot parse saved configuration; the original file was kept.");
    }
    return loaded;
}

PreparedState prepare_state(const fs::path& file, LoadedState& loaded, const Json& next) {
    const auto bytes = next.dump(2) + '\n';
    if (bytes.size() > state_limit) fail("STATE_TOO_LARGE", "The configuration would exceed 1 MiB.");
    if (!loaded.parent.exists) loaded.parent = pin_directory(file.parent_path(), Missing::create);
    auto temporary = temporary_object(loaded.parent.path, false);
    write_and_flush(temporary.handle.get(), bytes);
    const bool had_original = static_cast<bool>(loaded.original);
    loaded.original.reset();
    const auto target = loaded.parent.path / file.filename();
    if (had_original) {
        // Probe DELETE before publishing XML: Windows otherwise reports a busy
        // replace as ACCESS_DENIED. This is a preflight, not a cross-process CAS.
        Handle reservation(CreateFileW(api_path(target).c_str(), DELETE,
                                       FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                       nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
        if (!reservation) win_error("Cannot replace application configuration");
        reject_reparse(file_info(reservation.get()));
    } else {
        require_absent(target);
    }
    return {std::move(temporary), target, had_original};
}

void commit_state(PreparedState& prepared) {
    rename_handle(prepared.temporary.handle.get(), prepared.target, prepared.had_original);
    prepared.temporary.cleanup = false;
    // Nothing that can fail or allocate is done after the atomic replacement.
}

void save_state(const fs::path& file, LoadedState& loaded, const Json& next) {
    auto prepared = prepare_state(file, loaded, next);
    commit_state(prepared);
}

} // namespace taocode::project_settings
