#pragma once

#include <vector>

#include "workspace.hpp"

namespace taocode {

namespace fs = std::filesystem;

// Checks only the parent path, never enumerates it. No destination is reserved.
fs::path project_destination(const fs::path& parent, const std::string& name);

/**
 * 喂给 JDT LS 的 `settings.java`：项目 JDK（runtimes）、源根/输出目录，以及
 * 「构建工具 › Gradle」那一栏（`java.import.gradle.*`）—— 少了最后一项，服务器会用自己的
 * JRE 去起 Gradle，老 Gradle 起不来，工程模型就永远建不起来（表现为没有补全/没有语义着色）。
 *
 * @param java        项目设置里的 `java` 段
 * @param build_tools 项目设置里的 `buildTools` 段（只看 `gradle` 子段）
 */
// `extra_libraries`：磁盘派生出来的外部类路径兜底（没有 Gradle 导入时用磁盘上已有的 jar 解析外部），
// 见 native/projects.cpp 的 `default_referenced_libraries`。
Json java_lsp_settings(const Json& java, const Json& build_tools, const std::vector<std::string>& extra_libraries = {});
std::vector<std::string> default_referenced_libraries(const std::filesystem::path& root);

// The editor settings a fresh profile starts with, and the fallback for any key a
// state file written by an older build does not carry. Exported so tests assert
// against the real defaults instead of a copy that drifts.
Json editor_defaults();
Json general_defaults(); // GeneralSettingsState data-class defaults (GeneralSettings.kt:227-266).

// Source: RecentProjectMetaInfo.activationTimestamp — wall-clock seconds since
// the Unix epoch in UTC, mirroring what IDEA stores next to displayName.
std::int64_t utc_now_epoch();

// Publishes a project template without replacing anything; does not open/record it.
fs::path create_project(const fs::path& parent, const std::string& name,
                        const std::string& kind);

class ProjectStore {
public:
    explicit ProjectStore(fs::path state_file);
    Json state();
    void opened(const Json& workspace);
    void closed();
    Json forget(const std::string& path); // Returns the public state; keeps project files/settings.
    Json forget_many(const std::vector<std::string>& paths); // Mirrors RecentProjectsManagerBase.removePathsFromGroups + removePath fan-out.
    Json update_settings(const Json& patch); // Returns the complete editor settings.
    Json update_general(const Json& patch); // Mirrors GeneralSettings (ide.general.xml); returns the complete general state.
    // File colors read IDEA .idea/workspace.xml + .idea/fileColors.xml first.
    // An absent layer file falls back to legacy JSON; malformed XML throws.
    Json project_settings(const std::string& root);
    // Stage application JSON first, publish XML, then commit JSON; roll XML back
    // on failure. Incomplete rollback reports recovery paths. No crash-atomicity.
    // Existing XML is never overwritten by implicit legacy migration.
    Json update_project_settings(const std::string& root, const Json& patch);
    /**
     * 设置导出/导入/恢复默认（IDEA `ExportImportGroup`，见 native/settings_transfer.hpp）。
     * `export_settings` 把当前状态打包成归档写到 `file`；`import_settings` 读回、**校验**、
     * 写进状态文件（保留原有的最近项目列表）并返回新的公开状态；`reset_settings` 写回出厂默认。
     */
    Json export_settings(const fs::path& file);
    Json import_settings(const fs::path& file);
    Json reset_settings();

private:
    // Reload under the process lock on every operation: no stale per-instance cache,
    // and no in-memory state can be committed before a successful disk replacement.
    fs::path state_file_;
};

} // namespace taocode
