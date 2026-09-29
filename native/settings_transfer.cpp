// 设置导出/导入的实现，见 settings_transfer.hpp 的源码对照。
#include "settings_transfer.hpp"

#include <chrono>
#include <ctime>
#include <stdexcept>

#include "settings_schema.hpp"
#include "text.hpp"
#include "zipstore.hpp"

namespace taocode {
namespace settings_transfer {
namespace {

using taocode::utf8;

void fail(const char* code, const std::string& message) { throw WorkspaceError(code, message); }

/** ISO-8601 的本地时间（导出时间写进归档，方便用户认哪个包是新的）。 */
std::string stamp() {
    const auto now = std::chrono::system_clock::now();
    const std::time_t seconds = std::chrono::system_clock::to_time_t(now);
    std::tm local{};
    localtime_s(&local, &seconds);
    char buffer[32]{};
    std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%S", &local);
    return buffer;
}

/** 带进归档的三段 —— 与 `empty_document()` 的键名一致（导入时直接按这些键取）。 */
constexpr const char* kSections[] = {"settings", "general", "perProject"};

/** 某一段的默认值（段内补默认值时用；`perProject` 的默认是空映射）。 */
Json defaults_for(std::string_view section) {
    if (section == "settings") return editor_defaults_impl();
    if (section == "general") return general_defaults_impl();
    return Json::object();
}

Json exportable(const Json& document) {
    Json out = Json::object();
    for (const char* section : kSections) {
        const auto found = document.find(section);
        // `general` 在老文件里可能不存在（那时还没这一层），缺失就当空对象 —— 导入端会补默认值。
        out[section] = found == document.end() || found->is_null() ? Json::object() : *found;
    }
    return out;
}

}  // namespace

Json export_archive(const Json& document, const std::filesystem::path& file) {
    if (file.empty()) fail("INVALID_PATH", "请选择导出位置。");
    if (!document.is_object()) fail("INVALID_ARGUMENT", "没有可导出的设置。");
    Json payload{{"format", kFormat}, {"version", kVersion}, {"exportedAt", stamp()}};
    payload["document"] = exportable(document);
    const auto bytes = payload.dump(2);
    try {
        zip::write_archive(file, std::vector<zip::MemoryEntry>{{kEntryName, bytes}});
    } catch (const std::exception& error) {
        fail("EXPORT_FAILED", std::string("写入设置归档失败：") + error.what());
    }
    Json components = Json::array();
    for (const char* section : kSections) components.push_back(section);
    return {{"path", utf8(file.native())}, {"entry", kEntryName},
            {"bytes", static_cast<std::int64_t>(bytes.size())}, {"components", components}};
}

Json read_archive_summary(const std::filesystem::path& file) {
    const auto imported = read_archive(file);
    Json components = Json::array();
    for (const char* section : kSections)
        if (imported.contains(section)) components.push_back(section);
    return {{"path", utf8(file.native())},
            {"components", components},
            {"projects", imported.value("projects", std::int64_t{0})},
            {"exportedAt", imported.value("exportedAt", std::string())}};
}

Json read_archive(const std::filesystem::path& file) {
    if (file.empty()) fail("INVALID_PATH", "请选择要导入的设置归档。");
    std::error_code error;
    if (!std::filesystem::is_regular_file(file, error)) fail("NOT_FOUND", "找不到这个设置归档。");
    std::vector<std::pair<std::string, std::string>> entries;
    try {
        entries = zip::read_archive(file);
    } catch (const std::exception& failure) {
        fail("INVALID_SETTINGS_ARCHIVE", std::string("这不是一个可读的设置归档：") + failure.what());
    }
    const std::string* payload = nullptr;
    for (const auto& entry : entries) {
        if (entry.first == kEntryName) payload = &entry.second;
    }
    if (payload == nullptr) fail("INVALID_SETTINGS_ARCHIVE", std::string("归档里没有 ") + kEntryName + "。");
    Json parsed;
    try {
        parsed = Json::parse(*payload);
    } catch (const Json::exception&) {
        fail("INVALID_SETTINGS_ARCHIVE", "归档里的设置不是合法的 JSON。");
    }
    if (!parsed.is_object() || parsed.value("format", std::string()) != kFormat)
        fail("INVALID_SETTINGS_ARCHIVE", "归档格式不对（缺少 format 标记）。");
    if (parsed.value("version", 0) > kVersion)
        fail("INVALID_SETTINGS_ARCHIVE", "这个归档来自更新的版本，当前版本读不了。");
    const auto found = parsed.find("document");
    if (found == parsed.end() || !found->is_object())
        fail("INVALID_SETTINGS_ARCHIVE", "归档里没有 document 段。");
    const Json& document = *found;

    // 逐段处理：**只带出现在归档里的段**（IDEA 的导入同样只换包里有的组件，没给的段保持不动）。
    // 段内则与读盘同一套规则：先补默认值，再剪掉不认识的键，最后校验值域。
    Json out = Json::object();
    for (const char* section : kSections) {
        const auto section_value = document.find(section);  // 不叫 found：外面已有同名的 document 查找结果（-Wshadow）
        if (section_value == document.end()) continue;
        if (!section_value->is_object()) fail("INVALID_SETTINGS_ARCHIVE", std::string(section) + " 必须是对象。");
        Json value = defaults_for(section);
        fill_defaults(value, *section_value);
        if (std::string_view(section) == "settings") {
            // 与 projects.cpp 读盘一样：旧版本写过、新版本已删的键不能让文件变成损坏（IDEA 的
            // XmlSerializer 忽略未知标签），剪掉之后再做值域校验。
            prune_unknown(value, EDITOR_SETTING_KEYS);
            validate_editor_patch(value);
        } else if (std::string_view(section) == "general") {
            prune_unknown(value, GENERAL_SETTING_KEYS);
            validate_general_patch(value);
        } else {
            for (auto iterator = value.begin(); iterator != value.end(); ++iterator) {
                if (!iterator.value().is_object())
                    fail("INVALID_SETTINGS_ARCHIVE", "每个项目的设置必须是对象。");
                validate_project_patch(iterator.value());
            }
        }
        out[section] = value;
    }
    if (out.empty()) fail("INVALID_SETTINGS_ARCHIVE", "归档里没有任何可导入的设置段。");
    out["exportedAt"] = parsed.value("exportedAt", std::string());
    out["projects"] = out.contains("perProject") ? static_cast<std::int64_t>(out.at("perProject").size()) : 0;
    return out;
}

}  // namespace settings_transfer
}  // namespace taocode
