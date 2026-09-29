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
        check(json.at("plugins").at(0).at("id").get<std::string>() == "sample-plugin", "id 没输出");
    });

    if (failures) {
        std::cout << failures << " 个用例失败\n";
        return 1;
    }
    std::cout << "全部通过\n";
    return 0;
}
