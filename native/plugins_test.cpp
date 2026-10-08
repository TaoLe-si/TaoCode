// 插件清单与安装：对照 IDEA `PluginsConfigurable` 的 Install Plugin from Disk / Uninstall / 启停。
// 覆盖两种安装源（目录、.zip 插件包）、id 推导（清单 id → 源名折叠）、类目字段、以及边界拒绝。
#include "plugins.hpp"

#include "zipstore.hpp"

#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

namespace fs = std::filesystem;
using taocode::Json;
using taocode::WorkspaceError;
using taocode::plugins::Plugin;
using taocode::zip::MemoryEntry;

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

/** 每个用例一个干净的目录（安装会真的写盘，所以要能重复跑）。 */
fs::path scratch(const std::string& name) {
    const fs::path base = fs::temp_directory_path() / L"taocode-plugins-test" / name;
    std::error_code error;
    fs::remove_all(base, error);
    fs::create_directories(base, error);
    return base;
}

void write_file(const fs::path& file, const std::string& content) {
    std::error_code error;
    fs::create_directories(file.parent_path(), error);
    std::ofstream out(file, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("写不了 " + file.string());
    out << content;
}

const char* const sample_manifest = R"({
  "name": "示例插件",
  "version": "1.2",
  "description": "带一个命令与一个模板",
  "category": "工具",
  "vendor": "示例厂商",
  "contributes": {
    "commands": [{"id": "sample.hello", "title": "打招呼", "action": "app.about", "group": "示例"}],
    "templates": [{"key": "Logd", "body": "console.log($x$);", "description": "打印", "languages": ["typescript"]}]
  }
})";

Plugin find_plugin(const std::vector<Plugin>& plugins, const std::string& id) {
    for (const auto& plugin : plugins)
        if (plugin.id == id) return plugin;
    throw std::runtime_error("列表里没有插件 " + id);
}

int failures = 0;

void run(const std::string& name, const std::function<void()>& body) {
    try {
        body();
        std::cout << "ok   " << name << '\n';
    } catch (const std::exception& error) {
        ++failures;
        std::cout << "FAIL " << name << ": " << error.what() << '\n';
    }
}

void expect_code(const char* code, const std::function<void()>& body) {
    try {
        body();
    } catch (const WorkspaceError& error) {
        check(error.code == code, std::string("期望 ") + code + "，实际 " + error.code);
        return;
    }
    throw std::runtime_error(std::string("没有抛 ") + code);
}

/** 把若干条目打成 store 形式的 zip（原生层自己的写入器，读回来由 tar.exe 负责）。 */
fs::path make_package(const fs::path& file, const std::vector<MemoryEntry>& entries) {
    taocode::zip::write_archive(file, entries);
    return file;
}

}  // namespace

int main() {
    using namespace taocode::plugins;

    run("空目录：list 返回空而不是报错", [] {
        const fs::path root = scratch("empty");
        const auto plugins = list(root / "plugins");
        check(plugins.empty(), "还没有插件目录时应当是空列表");
    });

    run("目录安装：清单字段（含类目、命令、模板）全部读出来", [] {
        const fs::path root = scratch("dir-install");
        const fs::path source = root / "source" / "sample-plugin";
        write_file(source / "plugin.json", sample_manifest);
        write_file(source / "README.md", "说明");

        const fs::path plugins_dir = root / "plugins";
        install(plugins_dir, source);

        const auto plugins = list(plugins_dir);
        check(plugins.size() == 1, "应当只装了一个插件");
        const Plugin plugin = find_plugin(plugins, "sample-plugin");
        check(plugin.name == "示例插件", "name 没读出来");
        check(plugin.version == "1.2", "version 没读出来");
        check(plugin.description == "带一个命令与一个模板", "description 没读出来");
        check(plugin.category == "工具", "category 没读出来");
        check(plugin.vendor == "示例厂商", "vendor（上游清单的 <vendor> 元素）没读出来");
        check(plugin.enabled, "新装的插件默认是启用的");
        check(plugin.error.empty(), "清单合法时不该有 error");
        check(plugin.commands.size() == 1 && plugin.commands[0].id == "sample.hello", "命令没读出来");
        check(plugin.templates.size() == 1 && plugin.templates[0].key == "Logd", "模板没读出来");
        check(fs::exists(plugins_dir / "sample-plugin" / "README.md"), "插件里的其它文件也要搬过去");
        check(!fs::exists(plugins_dir / ".installing-sample-plugin"), "临时目录要清理干净");
    });

    run("清单里的 id 决定安装目录名（优先级高于源名）", [] {
        const fs::path root = scratch("manifest-id");
        const fs::path source = root / "source" / "whatever";
        write_file(source / "plugin.json", R"({"id": "chosen", "name": "选了 id"})");

        const fs::path plugins_dir = root / "plugins";
        install(plugins_dir, source);
        check(fs::is_directory(plugins_dir / "chosen"), "应当装到清单声明的 id 目录");
        check(find_plugin(list(plugins_dir), "chosen").name == "选了 id", "清单 id 与目录名应当一致");
    });

    run("名字不合规时折成合法 id，而不是拒绝", [] {
        const fs::path root = scratch("fold-name");
        const fs::path source = root / "source" / "My Plugin";
        write_file(source / "plugin.json", R"({"name": "空格目录"})");

        const fs::path plugins_dir = root / "plugins";
        install(plugins_dir, source);
        check(fs::is_directory(plugins_dir / "my-plugin"), "`My Plugin` 应当折成 `my-plugin`");
    });

    run("拒绝：源目录里没有 plugin.json", [] {
        const fs::path root = scratch("no-manifest");
        const fs::path source = root / "source" / "bogus";
        write_file(source / "readme.txt", "不是插件");
        expect_code("INVALID_PLUGIN", [&] { install(root / "plugins", source); });
    });

    run("拒绝：重复安装同名插件", [] {
        const fs::path root = scratch("duplicate");
        const fs::path source = root / "source" / "sample-plugin";
        write_file(source / "plugin.json", sample_manifest);
        const fs::path plugins_dir = root / "plugins";
        install(plugins_dir, source);
        expect_code("ALREADY_EXISTS", [&] { install(plugins_dir, source); });
    });

    run("拒绝：源既不是目录也不是文件", [] {
        const fs::path root = scratch("missing");
        expect_code("NOT_FOUND", [&] { install(root / "plugins", root / "nope"); });
    });

    run("插件包（zip，清单在根）能装上", [] {
        const fs::path root = scratch("zip-root");
        const fs::path package = make_package(root / "sample-plugin-1.0.zip", {
            {"plugin.json", sample_manifest},
            {"lib/notes.txt", "包里的另一个文件"},
        });
        const fs::path plugins_dir = root / "plugins";
        install(plugins_dir, package);

        const Plugin plugin = find_plugin(list(plugins_dir), "sample-plugin-1.0");
        check(plugin.name == "示例插件", "包内清单没读出来");
        check(fs::exists(plugins_dir / "sample-plugin-1.0" / "lib" / "notes.txt"), "包内的文件要一起解开");
        check(!fs::exists(plugins_dir / ".sample-plugin-1.0.unpack"), "解压目录要清理干净");
    });

    run("插件包（zip，清单在唯一的顶层目录里）也能装上", [] {
        const fs::path root = scratch("zip-nested");
        const fs::path package = make_package(root / "Nested Plugin.zip", {
            {"inner/plugin.json", R"({"name": "嵌套包"})"},
            {"inner/lib/a.txt", "x"},
        });
        const fs::path plugins_dir = root / "plugins";
        install(plugins_dir, package);

        // 包名 `Nested Plugin.zip` 折成 `nested-plugin`；目标是目录内容，不该再套一层 `inner`
        const Plugin plugin = find_plugin(list(plugins_dir), "nested-plugin");
        check(plugin.name == "嵌套包", "嵌套包里的清单没读出来");
        check(fs::exists(plugins_dir / "nested-plugin" / "lib" / "a.txt"), "顶层目录里的内容要提上来");
        check(!fs::exists(plugins_dir / "nested-plugin" / "inner"), "不该把打包目录也带进插件里");
    });

    run("拒绝：包里没有 plugin.json", [] {
        const fs::path root = scratch("zip-no-manifest");
        const fs::path package = make_package(root / "bogus.zip", {{"readme.txt", "不是插件"}});
        expect_code("INVALID_PLUGIN", [&] { install(root / "plugins", package); });
    });

    run("拒绝：包内有两个顶层目录（分不清哪个是插件）", [] {
        const fs::path root = scratch("zip-two-roots");
        const fs::path package = make_package(root / "two.zip", {
            {"a/plugin.json", R"({"name": "A"})"},
            {"b/plugin.json", R"({"name": "B"})"},
        });
        expect_code("INVALID_PLUGIN", [&] { install(root / "plugins", package); });
    });

    run("拒绝：不是合法 zip 的文件", [] {
        const fs::path root = scratch("not-a-zip");
        const fs::path bogus = root / "broken.zip";
        write_file(bogus, "这不是 zip");
        expect_code("UNPACK_FAILED", [&] { install(root / "plugins", bogus); });
    });

    run("启停：写/删 .disabled 标记，坏 id 被拒绝", [] {
        const fs::path root = scratch("enable");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "sample-plugin" / "plugin.json", sample_manifest);

        check(find_plugin(list(plugins_dir), "sample-plugin").enabled, "初始应当是启用的");
        set_enabled(plugins_dir, "sample-plugin", false);
        check(!find_plugin(list(plugins_dir), "sample-plugin").enabled, "停用后应当读到 enabled=false");
        set_enabled(plugins_dir, "sample-plugin", true);
        check(find_plugin(list(plugins_dir), "sample-plugin").enabled, "重新启用后应当读到 enabled=true");

        expect_code("INVALID_REQUEST", [&] { set_enabled(plugins_dir, "../escape", false); });
        expect_code("NOT_FOUND", [&] { set_enabled(plugins_dir, "not-installed", false); });
    });

    run("卸载：删掉整个插件目录", [] {
        const fs::path root = scratch("uninstall");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "sample-plugin" / "plugin.json", sample_manifest);
        uninstall(plugins_dir, "sample-plugin");
        check(!fs::exists(plugins_dir / "sample-plugin"), "目录应当被删掉");
        expect_code("NOT_FOUND", [&] { uninstall(plugins_dir, "sample-plugin"); });
    });

    run("坏清单的插件照样列出来，只是带 error", [] {
        const fs::path root = scratch("broken-manifest");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "half-baked" / "plugin.json", "{ 这不是 JSON");
        const Plugin plugin = find_plugin(list(plugins_dir), "half-baked");
        check(!plugin.error.empty(), "坏清单要如实报错而不是被丢掉");
        check(plugin.name == "half-baked", "读不出名字时用 id 顶上");
    });

    run("to_json：category 字段要在（前端分组靠它）", [] {
        const fs::path root = scratch("json");
        const fs::path source = root / "source" / "sample-plugin";
        write_file(source / "plugin.json", sample_manifest);
        const fs::path plugins_dir = root / "plugins";
        install(plugins_dir, source);

        const Json json = to_json(list(plugins_dir));
        check(json.at("plugins").size() == 1, "应当有一条");
        check(json.at("plugins").at(0).at("category").get<std::string>() == "工具", "category 没输出");
        check(json.at("plugins").at(0).at("vendor").get<std::string>() == "示例厂商", "vendor 没输出（前端的 /vendor: 搜索吃它）");
        check(json.at("plugins").at(0).at("id").get<std::string>() == "sample-plugin", "id 没输出");
    });

    run("清单字段剪掉首尾空白；空名字退回 id", [] {
        const fs::path root = scratch("trim-fields");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "trimmed" / "plugin.json", R"({
          "name": "   ",
          "version": " 1.0 ",
          "description": "  有空白  ",
          "category": " 工具 ",
          "contributes": {"commands": [{"id": " hello ", "title": " 打招呼 ", "action": " app.about "}]}
        })");
        const Plugin plugin = find_plugin(list(plugins_dir), "trimmed");
        // 全是空白的 name 与没写一样 ⇒ 用目录名顶上（前端的分组/标题都靠它）。
        check(plugin.name == "trimmed", "空白 name 应当退回 id");
        check(plugin.version == "1.0", "version 的首尾空白要剪掉");
        check(plugin.description == "有空白", "description 的首尾空白要剪掉");
        check(plugin.category == "工具", "category 的首尾空白要剪掉");
        check(plugin.commands.size() == 1, "命令里的空白不该让它被丢掉");
        check(plugin.commands[0].id == "hello" && plugin.commands[0].title == "打招呼" &&
              plugin.commands[0].action == "app.about", "命令字段也要剪空白");
    });

    run("厂商 vendor：去空白、没写与超长都是空串（前端的 /vendor: 与详情行都靠它）", [] {
        const fs::path root = scratch("vendor");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "with_vendor" / "plugin.json", R"({"name": "有厂商", "vendor": "  JetBrains s.r.o.  "})");
        write_file(plugins_dir / "no_vendor" / "plugin.json", R"({"name": "没厂商"})");
        // 与 name/category 同一口径：超过长度上限的值当作没写（`text_or`），不留一个截断的厂商名。
        write_file(plugins_dir / "long_vendor" / "plugin.json",
                   std::string("{\"name\": \"超长厂商\", \"vendor\": \"") + std::string(121, 'x') + "\"}");
        const auto plugins = list(plugins_dir);
        check(find_plugin(plugins, "with_vendor").vendor == "JetBrains s.r.o.", "vendor 的首尾空白要剪掉");
        check(find_plugin(plugins, "no_vendor").vendor.empty(), "清单没写厂商时是空串（详情面板不渲染那一行）");
        check(find_plugin(plugins, "long_vendor").vendor.empty(), "超过 120 字符的厂商与没写同义");
        const Json json = to_json(plugins);
        check(json.at("plugins").at(0).contains("vendor"), "vendor 要进 JSON（前端按它过滤 /vendor:）");
    });

    // 上游 `<change-notes>`：PluginXmlConst.kt:42 的元素名、XmlReader.kt:193 的读取、
    // PluginDetailsPageComponent.kt:1394 的展示（空内容整块不可见）。本仓同口径：没写 = 不渲染。
    run("变更说明 changeNotes：去空白、没写、超长与 1200 的边界（详情面板那一行靠它）", [] {
        const fs::path root = scratch("change-notes");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "with_notes" / "plugin.json",
                   R"({"name": "有说明", "changeNotes": "  这一版修掉了换行符的问题  "})");
        write_file(plugins_dir / "no_notes" / "plugin.json", R"({"name": "没说明"})");
        write_file(plugins_dir / "edge_notes" / "plugin.json",
                   std::string("{\"name\": \"恰好 1200\", \"changeNotes\": \"") + std::string(1200, 'x') + "\"}");
        write_file(plugins_dir / "long_notes" / "plugin.json",
                   std::string("{\"name\": \"超一档\", \"changeNotes\": \"") + std::string(1201, 'x') + "\"}");
        const auto plugins = list(plugins_dir);
        check(find_plugin(plugins, "with_notes").change_notes == "这一版修掉了换行符的问题", "changeNotes 的首尾空白要剪掉");
        check(find_plugin(plugins, "no_notes").change_notes.empty(), "清单没写变更说明时是空串（详情面板不渲染那一行）");
        check(find_plugin(plugins, "edge_notes").change_notes.size() == 1200, "1200 字符是上限内，该整段留下");
        check(find_plugin(plugins, "long_notes").change_notes.empty(), "超过 1200 字符与没写同义（不留半截说明）");
        const Json json = to_json(plugins);
        check(json.at("plugins").at(0).contains("changeNotes"), "changeNotes 要进 JSON（前端详情面板读它）");
        check(json.at("plugins").at(0).at("description").is_string(), "description 与 changeNotes 是两格，不能互相顶替");
    });

    run("重复的命令 id 只留第一条（菜单行 id 不能重复）", [] {
        const fs::path root = scratch("dup-commands");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "dup" / "plugin.json", R"({
          "name": "重复命令",
          "contributes": {"commands": [
            {"id": "run", "title": "第一条", "action": "file.save"},
            {"id": "run", "title": "第二条", "action": "file.saveAs"},
            {"id": "other", "title": "另一条", "action": "file.save"}
          ]}
        })");
        const Plugin plugin = find_plugin(list(plugins_dir), "dup");
        check(plugin.commands.size() == 2, "重复 id 应当只剩一条");
        check(plugin.commands[0].id == "run" && plugin.commands[0].title == "第一条", "重复 id 取第一条");
        check(plugin.commands[1].id == "other", "别的命令不该被牵连");
    });

    run("空白命令字段被丢弃；重复模板 key 只留第一条", [] {
        const fs::path root = scratch("blank-and-dup-templates");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "mixed" / "plugin.json", R"({
          "contributes": {
            "commands": [
              {"id": "", "title": "没有 id", "action": "file.save"},
              {"id": "blank-title", "title": "   ", "action": "file.save"}
            ],
            "templates": [
              {"key": "Logd", "body": "first();", "description": "第一条", "languages": ["typescript"]},
              {"key": "Logd", "body": "second();", "description": "第二条", "languages": ["typescript"]}
            ]
          }
        })");
        const Plugin plugin = find_plugin(list(plugins_dir), "mixed");
        check(plugin.commands.empty(), "空 id / 空标题不能进命令表");
        check(plugin.templates.size() == 1, "重复 key 应当只剩一条");
        check(plugin.templates[0].body == "first();", "重复 key 取第一条");
    });

    run("依赖：缺装与停用分别标记原因；可选依赖缺装不算 broken", [] {
        const fs::path root = scratch("deps-broken");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "app" / "plugin.json",
                   R"({"name": "应用", "depends": ["lib", "helper"], "optionalDepends": ["nice-to-have"]})");
        write_file(plugins_dir / "lib" / "plugin.json", R"({"name": "库"})");

        const auto plugins = list(plugins_dir);
        const Plugin app = find_plugin(plugins, "app");
        check(app.depends.size() == 2, "两个必需依赖都要读出来");
        check(app.optional_depends.size() == 1, "可选依赖也要读出来");
        check(app.missing_dependencies.size() == 1 && app.missing_dependencies[0] == "helper",
              "没装的必需依赖要报 missing，可选依赖缺装不报");
        check(app.disabled_dependencies.empty(), "装着的必需依赖不该报停用");
        check(app.broken.find("helper") != std::string::npos, "broken 原因里要点出缺哪一个");
        check(app.required_by.empty(), "没人依赖 app");
        check(find_plugin(plugins, "lib").required_by.size() == 1 &&
              find_plugin(plugins, "lib").required_by[0] == "app", "反向引用要列出 app");

        set_enabled(plugins_dir, "lib", false);
        const Plugin app_after = find_plugin(list(plugins_dir), "app");
        check(!app_after.enabled, "停用必需依赖会连带停用依赖者（见下一条用例）");
        check(app_after.disabled_dependencies.size() == 1 && app_after.disabled_dependencies[0] == "lib",
              "必需依赖被停用要报 disabled");
        check(app_after.broken.empty(), "连带停用的插件不是 broken —— 它只是被停用了");

        // 手工把 app 的标记拿掉（模拟用户在插件目录里手改 .disabled）：启用着的插件
        // 若必需依赖被停用，就是真正的 broken。
        std::error_code cleanup;
        fs::remove(plugins_dir / "app" / ".disabled", cleanup);
        const Plugin app_forced = find_plugin(list(plugins_dir), "app");
        check(app_forced.enabled, "app 应当被手工改回启用");
        check(app_forced.broken.find("lib") != std::string::npos, "启用着的插件依赖被停用要报 broken");
        check(app_forced.broken.find("helper") != std::string::npos, "缺装的依赖也要并列写进 broken");
    });

    run("启用：连带启用必需依赖（递归），可选依赖不动", [] {
        const fs::path root = scratch("deps-enable");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "a" / "plugin.json",
                   R"({"name": "A", "depends": ["b"], "optionalDepends": ["opt"]})");
        write_file(plugins_dir / "b" / "plugin.json", R"({"name": "B", "depends": ["c"]})");
        write_file(plugins_dir / "c" / "plugin.json", R"({"name": "C"})");
        write_file(plugins_dir / "opt" / "plugin.json", R"({"name": "可选"})");
        set_enabled(plugins_dir, "a", false);
        set_enabled(plugins_dir, "b", false);
        set_enabled(plugins_dir, "c", false);
        set_enabled(plugins_dir, "opt", false);

        set_enabled(plugins_dir, "a", true);
        const auto plugins = list(plugins_dir);
        check(find_plugin(plugins, "a").enabled, "目标插件要启用");
        check(find_plugin(plugins, "b").enabled, "必需依赖要连带启用");
        check(find_plugin(plugins, "c").enabled, "依赖要递归启用（b 的 c）");
        check(!find_plugin(plugins, "opt").enabled, "可选依赖不该被顺手启用");
        check(find_plugin(plugins, "a").broken.empty(), "依赖齐了就不该是 broken");
    });

    run("启用：必需依赖缺装时拒绝（DEPENDENCY_MISSING）", [] {
        const fs::path root = scratch("deps-missing");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "app" / "plugin.json", R"({"name": "应用", "depends": ["lib"]})");
        expect_code("DEPENDENCY_MISSING", [&] { set_enabled(plugins_dir, "app", true); });
    });

    run("停用：连带停用依赖它的插件（递归）", [] {
        const fs::path root = scratch("deps-disable");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "a" / "plugin.json", R"({"name": "A", "depends": ["b"]})");
        write_file(plugins_dir / "b" / "plugin.json", R"({"name": "B", "depends": ["c"]})");
        write_file(plugins_dir / "c" / "plugin.json", R"({"name": "C"})");
        write_file(plugins_dir / "unrelated" / "plugin.json", R"({"name": "无关"})");

        set_enabled(plugins_dir, "c", false);
        const auto plugins = list(plugins_dir);
        check(!find_plugin(plugins, "c").enabled, "被点的插件要停用");
        check(!find_plugin(plugins, "b").enabled, "直接依赖它的插件要连带停用");
        check(!find_plugin(plugins, "a").enabled, "间接依赖它的插件也要连带停用");
        check(find_plugin(plugins, "unrelated").enabled, "无关插件不该被牵连");
        check(find_plugin(plugins, "a").broken.empty(), "连带停用的插件不该留下 broken 状态");
    });

    run("清单依赖：非法 id、自己、重复都丢掉，非数组当没写", [] {
        const fs::path root = scratch("deps-invalid");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "selfish" / "plugin.json",
                   R"({"name": "自恋", "depends": ["selfish", "BAD ID", "lib", "lib"], "optionalDepends": "lib"})");
        write_file(plugins_dir / "lib" / "plugin.json", R"({"name": "库"})");
        const Plugin plugin = find_plugin(list(plugins_dir), "selfish");
        check(plugin.depends.size() == 1 && plugin.depends[0] == "lib",
              "自己、非法 id、重复都要丢掉，只剩 lib");
        check(plugin.optional_depends.empty(), "非数组的可选依赖当没写");
    });

    run("依赖循环：成环的插件标 broken + dependency_cycle，且拒绝启用", [] {
        const fs::path root = scratch("deps-cycle");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "a" / "plugin.json", R"({"name": "A", "depends": ["b"]})");
        write_file(plugins_dir / "b" / "plugin.json", R"({"name": "B", "depends": ["c"]})");
        write_file(plugins_dir / "c" / "plugin.json", R"({"name": "C", "depends": ["a"]})");
        write_file(plugins_dir / "solo" / "plugin.json", R"({"name": "独苗", "depends": ["a"]})");

        const auto plugins = list(plugins_dir);
        const Plugin a = find_plugin(plugins, "a");
        check(a.dependency_cycle.size() == 3, "a 的环上要有三个成员（a、b、c）");
        check(a.dependency_cycle == std::vector<std::string>({"a", "b", "c"}), "环成员按 id 排序");
        check(a.broken.find("循环") != std::string::npos, "broken 里要点名成环");
        check(a.broken.find("a、b、c") != std::string::npos, "broken 里要列出环上的成员");
        check(find_plugin(plugins, "c").dependency_cycle == a.dependency_cycle, "c 在同一个环里");
        // `solo` 依赖环上的插件：它自己不在环里（missing/disabled 都没报），但也加载不了
        // （上游 `Depends on plugin ''{0}'' which was marked as incompatible`）。
        check(find_plugin(plugins, "solo").dependency_cycle.empty(), "不在环上的插件不该被标成环");
        check(find_plugin(plugins, "solo").broken.empty(), "solo 的依赖都装着，所以它自己不是 broken");

        expect_code("DEPENDENCY_CYCLE", [&] { set_enabled(plugins_dir, "a", true); });
    });

    run("依赖循环：停用环上的插件后再启用（环随依赖消失而消失）", [] {
        const fs::path root = scratch("deps-cycle-fixed");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "a" / "plugin.json", R"({"name": "A", "depends": ["b"]})");
        write_file(plugins_dir / "b" / "plugin.json", R"({"name": "B", "depends": ["a"]})");

        set_enabled(plugins_dir, "a", false);
        const Plugin after_disable = find_plugin(list(plugins_dir), "a");
        check(after_disable.dependency_cycle.size() == 2, "停用不解除环（depends 还在清单里）");
        check(after_disable.broken.empty(), "停用的插件不是 broken");

        // 用户改清单去掉环（这是唯一的修法）：此时启用必须放行。
        write_file(plugins_dir / "a" / "plugin.json", R"({"name": "A"})");
        set_enabled(plugins_dir, "a", true);
        const Plugin fixed = find_plugin(list(plugins_dir), "a");
        check(fixed.enabled, "改掉 depends 后应当能启用");
        check(fixed.dependency_cycle.empty(), "环消失了");
        check(fixed.broken.empty(), "没有环就不该报 broken");
    });

    run("依赖循环：坏清单的插件不进环（原因不搅在一起）", [] {
        const fs::path root = scratch("deps-cycle-broken");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "a" / "plugin.json", R"({"name": "A", "depends": ["b"]})");
        write_file(plugins_dir / "b" / "plugin.json", "{ 这不是 JSON");

        const auto plugins = list(plugins_dir);
        check(find_plugin(plugins, "a").dependency_cycle.empty(), "b 清单读不出来，不构成环");
        const Plugin a = find_plugin(plugins, "a");
        check(a.missing_dependencies.size() == 1 && a.missing_dependencies[0] == "b",
              "清单读不出来的依赖算缺装");
        check(a.broken.find("b") != std::string::npos, "broken 报缺装而不是成环");
    });

    run("fileTypes：上游 <fileType> 标签的字段逐个读出来，坏形状与重名丢掉", [] {
        const fs::path root = scratch("file-types");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "ft" / "plugin.json", R"({
  "name": "类型插件",
  "contributes": {
    "fileTypes": [
      {"name": "Groovy", "implementationClass": "org.example.GroovyFileType", "fieldName": "INSTANCE",
       "language": "other", "extensions": "groovy;gy", "fileNames": "Jenkinsfile",
       "patterns": "*.gsl", "fileNamesCaseInsensitive": "build.groovy", "hashBangs": "groovy"},
      {"name": "groovy", "extensions": "dup"},
      {"name": "", "extensions": "x"},
      {"name": "Nothing"},
      {"name": "BadLang", "extensions": "bl", "language": "cobol"},
      {"name": "Json", "fileNames": "jsonl"}
    ]
  }
})");

        const Plugin plugin = find_plugin(list(plugins_dir), "ft");
        // 合法的那条：五个关联属性 + implementationClass/fieldName 全部原样带出（拆分留给前端）。
        check(plugin.file_types.size() == 3, "只该收下合法的三条声明（重名/缺 name/无关联都丢）");
        if (plugin.file_types.empty()) return;
        const auto& first = plugin.file_types[0];
        check(first.name == "Groovy", "name 没读出来");
        check(first.extensions == "groovy;gy", "extensions 该保持分号原样");
        check(first.file_names == "Jenkinsfile", "fileNames 没读出来");
        check(first.patterns == "*.gsl", "patterns 没读出来");
        check(first.file_names_case_insensitive == "build.groovy", "fileNamesCaseInsensitive 没读出来");
        check(first.hash_bangs == "groovy", "hashBangs 没读出来");
        check(first.implementation_class == "org.example.GroovyFileType", "implementationClass 没读出来（前端靠它区分「新类型」与「补关联」）");
        check(first.field_name == "INSTANCE", "fieldName 没读出来");
        // 大小写不敏感的重名：上游是 PluginException（FileTypeBean.java:49-54），这里整条丢掉。
        check(plugin.file_types[1].name == "BadLang", "第二条该是 BadLang，重名的 groovy 要被丢");
        // 语言只认编辑器知道的四种，认不出来就清空（前端回退到 other）。
        check(plugin.file_types[1].language.empty(), "未知语言不该带出去");
        check(plugin.file_types[2].name == "Json" && plugin.file_types[2].file_names == "jsonl",
              "只补关联的声明（没有 implementationClass）也要收");
    });

    run("fileTypes：to_json 把声明按上游属性名带出去", [] {
        const fs::path root = scratch("file-types-json");
        const fs::path plugins_dir = root / "plugins";
        write_file(plugins_dir / "ft" / "plugin.json",
                   R"({"name": "F", "contributes": {"fileTypes": [{"name": "Tpl", "extensions": "tpl", "hashBangs": "tplsh"}]}})");

        const Json json = to_json(list(plugins_dir));
        const auto& entry = json.at("plugins")[0].at("fileTypes")[0];
        check(entry.at("name").get<std::string>() == "Tpl", "fileTypes.name 没进 JSON");
        check(entry.at("extensions").get<std::string>() == "tpl", "fileTypes.extensions 没进 JSON");
        check(entry.at("hashBangs").get<std::string>() == "tplsh", "fileTypes.hashBangs 没进 JSON");
        check(entry.contains("fileNamesCaseInsensitive"), "缺的字段也该给空串，免得前端逐字段判存在");
    });

    run("fileTypes：条数与长度上限（一个手写清单不该把注册表撑爆）", [] {
        const fs::path root = scratch("file-types-limits");
        const fs::path plugins_dir = root / "plugins";
        std::string items;
        for (int index = 0; index < 70; ++index) {
            items += "{\"name\": \"T" + std::to_string(index) + "\", \"extensions\": \"e" + std::to_string(index) + "\"}";
            if (index + 1 < 70) items += ",";
        }
        write_file(plugins_dir / "many" / "plugin.json",
                   R"({"name": "M", "contributes": {"fileTypes": [)" + items + R"(]}})");
        const Plugin plugin = find_plugin(list(plugins_dir), "many");
        check(plugin.file_types.size() == 50, "超过 50 条的声明该被截住");

        const std::string long_extensions(600, 'x');
        write_file(plugins_dir / "long" / "plugin.json",
                   R"({"name": "L", "contributes": {"fileTypes": [{"name": "Big", "extensions":")" +
                   Json(long_extensions).dump() + R"(}]}})");
        const Plugin overlong = find_plugin(list(plugins_dir), "long");
        check(overlong.file_types.empty(), "关联属性超过 500 字符的整条丢掉（text_or 的限长口径）");
    });

    if (failures) {
        std::cout << failures << " 个用例失败\n";
        return 1;
    }
    std::cout << "全部通过\n";
    return 0;
}
