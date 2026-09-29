#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "workspace.hpp"  // Json

// 设置的导出 / 导入（IDEA `ExportImportGroup` 的对应物）—— 宿主侧。
//
// 对照源码（`platform/configuration-store-impl/src/`）：
//   · `ExportSettingsAction.kt:54-66`：`saveFile.outputStream().use { exportSettings(markedComponents, it) }`
//     —— **打包成一个归档**写到用户选定的文件（IDEA 用 zip；见 `:58-61` 与 `platform/util` 的 `Compressor`）。
//   · `ImportSettingsAction.kt:47-70`：先用文件选择器拿一个 zip / 目录，**校验**（`:58-65`
//     `validateSelectedFiles` → `ConfigImportHelper.isConfigDirectory`，以及 `ImportSettingsFilenameFilter`），
//     再导入；导入成功后会提示重启。
//   · 两者都**不碰"最近项目"**：IDEA 导的是"可导出组件"（settings/configuration 文件），
//     recentProjects 不在导出清单里。所以本模块也只带走 `settings` / `general` / `perProject`，
//     导入时**保留调用方原有的最近项目列表**。
//   · `RestoreDefaultSettingsAction`：把设置恢复成出厂默认（TaoCode 的对应物 = 写回 `empty_document()`）。
//
// 为什么归档里是**一份 JSON** 而不是 IDEA 那样每个组件一个文件：TaoCode 的应用状态本来就是**一个**
// 文件（`projects.json`，见 projects.cpp 顶部的注释），拆成一堆文件反而与真实存储不一致。
namespace taocode {
namespace settings_transfer {

/** 归档条目的名字（写在 zip 里）。 */
inline constexpr char kEntryName[] = "taocode-settings.json";

/** 归档格式标记 —— 导入时用它拒绝"随便一个 zip"。 */
inline constexpr char kFormat[] = "taocode-settings";

/** 格式版本（将来改结构时用它做迁移）。 */
inline constexpr int kVersion = 1;

/**
 * 把一个应用状态文档打包成设置归档，写到 `file`。
 * 返回 `{path, entry, bytes, components}`（components = 带走了哪几段，给 UI 显示"导出了什么"）。
 */
Json export_archive(const Json& document, const std::filesystem::path& file);

/**
 * 读回一个设置归档并**校验**内容，返回可导入的三段 `{settings, general, perProject}`。
 *
 * 校验复用 settings_schema 的补丁校验器（`validate_editor_patch` / `validate_general_patch` /
 * `validate_project_patch`），所以"坏归档"在**写盘之前**就被拒绝 —— 不能像 IDEA 那样先落盘再重启时才发现。
 */
Json read_archive(const std::filesystem::path& file);

/**
 * 只读**摘要**（不写盘）：`{path, components, projects, exportedAt}`。
 *
 * 为什么要它：导入前得先让用户看到"这个包里有什么"，而**确认之前不能动任何东西**。
 * 所以 UI 的流程是 `read_archive_summary`（校验 + 摘要）→ 用户确认 → `import_settings`（写盘）。
 * 这条路径比 IDEA 的强：IDEA 是"先导入、重启时才发现坏包"（`ImportSettingsAction` 之后要重启）。
 */
Json read_archive_summary(const std::filesystem::path& file);

}  // namespace settings_transfer
}  // namespace taocode
