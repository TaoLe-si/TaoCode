#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "workspace.hpp"

namespace taocode {
namespace plugins {

// One command a plugin publishes. `action` must name an action TaoCode already has
// (an id from the frontend action registry): plugins contribute entry points, never
// executable code — loading third-party script into the host would be a sandbox
// escape, not a feature.
struct Command {
    std::string id;
    std::string title;
    std::string action;
    std::string group = "插件";
};

// A live template the plugin ships, validated exactly like a project custom template.
struct Template {
    std::string key;
    std::string body;
    std::string description;
    std::vector<std::string> languages;
};

// A file type the plugin declares — the `com.intellij.fileType` extension point, i.e. one
// `<fileType>` tag (`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeBean.java`).
// Field names mirror the upstream `@Attribute`s 1:1 (`name` :93, `extensions` :101, `fileNames` :108,
// `patterns` :116, `fileNamesCaseInsensitive` :123, `language` :132, `hashBangs` :144,
// `implementationClass` :72, `fieldName` :84). Values stay the raw semicolon-separated strings:
// splitting and matcher construction live in ONE place on the frontend (`parseFileTypeBean`,
// `src/fileTypeRegistry.ts`), so the host cannot grow a second, drifting set of association rules.
struct FileTypeContribution {
    std::string name;                          // required upstream (@RequiredElement) — empty = dropped
    std::string language;                       // bounded to the editor's known language ids
    std::string extensions;                     // "py;pyw"
    std::string file_names;                     // "Makefile"
    std::string patterns;                       // "*.blade.php"
    std::string file_names_case_insensitive;    // "makefile"
    std::string hash_bangs;                     // "python" — content-based, not a name matcher
    std::string implementation_class;           // non-empty = declares a NEW type (FileTypeBean.java:29-30)
    std::string field_name;
};

struct Plugin {
    std::string id;
    std::string name;
    std::string version;
    std::string description;
    // 变更说明 —— 上游清单的 `<change-notes>` 元素（
    // `platform/pluginSystem/parser/impl/src/com/intellij/platform/pluginSystem/parser/impl/PluginXmlConst.kt:42`
    // 的 `CHANGE_NOTES_ELEM = "change-notes"`，读取面同目录 `XmlReader.kt:193` 的
    // `builder.changeNotes = getNullifiedContent(reader)` 那一支，getter 在
    // `platform/core-impl/src/com/intellij/ide/plugins/IdeaPluginDescriptorImpl.kt:195`）。
    // 界面消费点：`platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginDetailsPageComponent.kt:1394`
    // 的 `changeNotesPanel!!.show(getChangeNotes())`（那块面板在 `:847-862` 建，空内容就整块不可见）。
    // 空串 = 清单没写 ⇒ 前端不渲染那一行（不放假控件）。
    std::string change_notes;
    // IDEA 的 `IdeaPluginDescriptor.getDisplayCategory()`：分组用（`InstalledPluginsTab` 按它
    // 分桶，缺省归入 "Other Tools"）。空串表示没写，分组由前端兜底。
    std::string category;
    // 插件厂商 —— 上游清单的 `<vendor>` 元素（`PluginXmlConst.kt:36` `VENDOR_ELEM = "vendor"`，
    // 解析落在 `XmlReader.kt:203-207`；读取面 `IdeaPluginDescriptorImpl.kt:224` `getVendor()`）。
    // 展示与搜索都吃它：`PluginUiModel.kt:52` `val vendor: String?`、
    // 已安装页的 `/vendor:` 属性（`SearchWords.kt:9` + `InstalledPluginsTabSearchResultPanel.kt:87-94`）。
    // 空串 = 清单没写（上游同样允许 null，界面上显示 `(not specified)`，
    // `IdeBundle.properties:455` `plugin.status.not.specified`）。
    std::string vendor;
    std::string path;      // absolute directory
    bool enabled = true;
    std::string error;     // set when the manifest could not be read/validated
    // 清单声明的依赖：`depends`（必需，对应 `PluginDependencies` 的 required）与
    // `optionalDepends`（可选，`IdeaPluginDescriptorImpl` 里 optional="true" 的那一组）。
    // id 必须合法且不能指向自己；重复取第一条、上限 32 条。
    std::vector<std::string> depends;
    std::vector<std::string> optional_depends;
    // 下面四格由 `list()` 在扫完整个插件目录后解出（依赖要看得到别的插件）：
    //   · 必需依赖里**没装**（或清单坏得读不出来）的 id；
    //   · 必需依赖里装了但处于停用状态的 id；
    //   · 反向引用：哪些已装插件在 `depends` 里点名要它（停用/卸载前的警示依据）；
    //   · 依赖不满足的原因（IDEA 里这类插件不会被加载）。空串 = 依赖齐了。
    std::vector<std::string> missing_dependencies;
    std::vector<std::string> disabled_dependencies;
    std::vector<std::string> required_by;
    // 必需依赖构成的循环：分量成员（按 id 排序）。上游 `PluginManagerStateService.kt:175-202`
    // 的 `adaptExclusionReasonAsCycleError` 把成环的插件判为**不可加载**，`CoreBundle.properties:32`
    // 的文案是「Plugins {0} cannot be loaded because they form a dependency cycle」。
    // 可选依赖不进图（上游的解析顺序也只由必需依赖决定）。空 = 不在环上。
    std::vector<std::string> dependency_cycle;
    std::string broken;
    std::vector<Command> commands;
    std::vector<Template> templates;
    // `contributes.fileTypes` — 上游 `<fileType>` EP 的等价物，装载时灌进前端的文件类型注册表。
    std::vector<FileTypeContribution> file_types;
};

// Scans the profile's plugins directory. A directory without a readable manifest is
// reported with `error` instead of being dropped, so a broken plugin is visible.
std::vector<Plugin> list(const std::filesystem::path& directory);

// IDEA PluginsConfigurable › "Install Plugin from Disk"。两种源：
//   · 插件包（`.zip` / `.jar`）—— 解压后取包内清单，包内允许一层顶层目录；
//   · 目录（本仓扩展点的原生形态）—— 必须直接含 plugin.json。
// 落点是 <plugins>/<id>/，id 优先取清单里的 `id`，否则由源名折成（小写、非法字符变 `-`）。
// 已存在则拒绝（不覆盖）。整个过程先落到临时目录再改名：中途失败不会留下半个插件。
void install(const std::filesystem::path& directory, const std::filesystem::path& source);

// IDEA 的 Uninstall：删除 <plugins>/<id>（含 .disabled 标记与全部内容）。
void uninstall(const std::filesystem::path& directory, const std::string& id);

// Enable/disable by writing (or removing) a `.disabled` marker next to the manifest.
// The id is a directory name, so it is validated before it ever reaches the path.
//
// 依赖是连带的（上游 `PluginEnabler` / `UiPluginManager.enablePlugins` 的语义）：
//   · 启用：先把**必需的**依赖逐个启用（递归）；必需依赖缺失时抛
//     `DEPENDENCY_MISSING`（启一个装不起来的插件只会留下坏状态）；必需依赖成环时抛
//     `DEPENDENCY_CYCLE`（上游同样不加载成环的插件，启用只会停在一个装不起来的态里）。
//     可选依赖不动。
//   · 停用：把依赖它的已启用插件一并停用（递归），避免它们停在「依赖已停用」的坏状态。
void set_enabled(const std::filesystem::path& directory, const std::string& id, bool enabled);

Json to_json(const std::vector<Plugin>& plugins);

}  // namespace plugins
}  // namespace taocode
