// `.idea` 里两层文件颜色的原生回归（`project_file_colors` 模块）。
//
// 为什么单独一个可执行文件：文件颜色有自己的两层归属（localFileColors → workspace.xml 的
// `FileColors`，fileColors → fileColors.xml 的 `SharedFileColors`）和它自己的失败码
// （FILE_COLORS_XML_ERROR / 回滚），与项目设置本体不是同一件事；混在 `projects_test.cpp` 里
// 只会让两边都超出行数上限。共用夹具在 project_test_support.hpp。
#include "project_test_support.hpp"
#include "project_file_colors.hpp"

namespace {

using namespace taocode;
using taocode::test::check;
using taocode::test::expect_error;
using taocode::test::get;
using taocode::test::NativeHandle;
using taocode::test::names;
using taocode::test::open_result;
using taocode::test::path_from;
using taocode::test::put;
using taocode::test::Report;
using taocode::test::TempRoot;
using taocode::test::text;
namespace fs = std::filesystem;

} // namespace

int main() {
    Report report;
    TempRoot temporary;
    const auto run = [&](const char* name, auto&& operation) { report.run(name, std::forward<decltype(operation)>(operation)); };

    run("file-color XML preserves both layers and unrelated components", [&] {
        const auto project = create_project(temporary.path, "xml-components", "empty");
        const auto idea = project / ".idea";
        fs::create_directory(idea);
        const auto local_file = idea / "workspace.xml", shared_file = idea / "fileColors.xml";
        const std::string local_xml =
            "<?xml version=\"1.0\"?><project version=\"4\" extra=\"keep\">"
            "<!--before--><component name=\"Other\"><option name=\"untouched\" value=\"yes\" /></component>"
            "<component name=\"FileColors\"><fileColor scope=\"first\" color=\"Blue\"></fileColor>"
            "<fileColor scope=\"second\" color=\"Rose\" /></component>"
            "<component name=\"After\"><nested><![CDATA[a < b]]></nested></component><?keep data?></project>";
        const std::string shared_xml =
            "<project version=\"4\"><component name=\"SharedFileColors\">"
            "<fileColor scope=\"team\" color=\"Green\" /></component><component name=\"TeamOther\" /></project>";
        put(local_file, local_xml);
        put(shared_file, shared_xml);
        const auto file = temporary.path / "xml-components.json";
        ProjectStore store(file);
        const auto root = text(project);
        const Json local = Json::array({{{"scope", "first"}, {"color", "Blue"}},
                                        {{"scope", "second"}, {"color", "Rose"}}});
        const Json shared = Json::array({{{"scope", "team"}, {"color", "Green"}}});
        check(store.project_settings(root).at("localFileColors") == local, "Both XML element forms retain local order");
        check(store.project_settings(root).at("fileColors") == shared, "SharedFileColors reads from fileColors.xml");
        const Json changed = Json::array({{{"scope", "new & <scope>"}, {"color", "#abcd"}}});
        store.update_project_settings(root, {{"localFileColors", changed}});
        check(get(shared_file) == shared_xml, "Local-only edits must not rewrite the shared layer");
        const auto saved = get(local_file);
        for (const auto* retained : {"extra=\"keep\"", "<!--before-->", "name=\"Other\"", "value=\"yes\"",
                                     "name=\"After\"", "<![CDATA[a < b]]>", "<?keep data?>"})
            check(saved.find(retained) != std::string::npos, std::string("Unrelated XML content lost: ") + retained);
        check(ProjectStore(file).project_settings(root).at("localFileColors") == changed, "Escaped attributes round-trip");
        ProjectStore other_profile(temporary.path / "xml-other-profile.json");
        check(other_profile.project_settings(root).at("fileColors") == shared, "XML is project-owned, not profile-owned");
        store.update_project_settings(root, {{"localFileColors", Json::array()}});
        check(store.project_settings(root).at("localFileColors").empty() && get(shared_file) == shared_xml,
              "Clearing local colors preserves team colors");
        const auto disk = Json::parse(get(file)).at("perProject").begin().value();
        check(!disk.contains("fileColors") && !disk.contains("localFileColors"), "XML colors have no JSON shadow");
    });

    run("legacy file-color migration respects existing XML and absent layers", [&] {
        const auto project = create_project(temporary.path, "xml-migration", "empty");
        const auto idea = project / ".idea";
        fs::create_directory(idea);
        const auto file = temporary.path / "xml-migration.json";
        const Json local = Json::array({{{"scope", "personal"}, {"color", "Blue"}}});
        const Json shared = Json::array({{{"scope", "legacy-team"}, {"color", "Gray"}}});
        // 老版本把两层都写在 JSON 里（没有 XML 层时它们就是唯一来源）。
        Json legacy = {{"recentProjects", Json::array()}, {"settings", taocode::editor_defaults()},
                       {"lastProject", nullptr}, {"perProject", Json::object()}};
        legacy["perProject"][text(project)] = {{"excludedDirs", Json::array()},
            {"localFileColors", local}, {"fileColors", shared}};
        put(file, legacy.dump());
        const std::string team_xml = "<project version=\"4\"><component name=\"TeamOnly\" /></project>";
        put(idea / "fileColors.xml", team_xml);
        ProjectStore store(file);
        check(store.project_settings(text(project)).at("fileColors").empty(), "An existing XML file with no colors overrides legacy JSON");
        check(store.project_settings(text(project)).at("localFileColors") == local && !fs::exists(idea / "workspace.xml"),
              "Reading an absent layer falls back to JSON without migration");
        store.update_project_settings(text(project), {{"excludedDirs", Json::array({"out"})}});
        check(get(idea / "fileColors.xml") == team_xml, "Implicit migration never overwrites an existing XML layer");
        check(ProjectStore(file).project_settings(text(project)).at("localFileColors") == local, "Absent local XML migrates without loss");
    });

    run("XML publication rolls back when application persistence fails", [&] {
        const auto project = create_project(temporary.path, "xml-rollback", "empty");
        const auto idea = project / ".idea";
        fs::create_directory(idea);
        const auto local_file = idea / "workspace.xml", shared_file = idea / "fileColors.xml";
        const std::string original = "<project version=\"4\"><component name=\"Other\" /></project>";
        put(local_file, original);
        const Json rules = Json::array({{{"scope", "changed"}, {"color", "Blue"}}});
        const Json patch = {{"localFileColors", rules}, {"fileColors", rules}};
        bool attempted_application = false;
        expect_error("FILE_BUSY", [&] {
            save_project_settings_layers(project, Json::object(), patch, [&] {
                attempted_application = true;
                throw WorkspaceError("FILE_BUSY", "Injected failure after both XML publications");
            });
        });
        check(attempted_application, "Rollback regression must exercise a failure after XML publication");
        check(get(local_file) == original && !fs::exists(shared_file), "Rollback restores original bytes and removes newly created layers");
        check(names(idea) == std::vector<std::string>({"workspace.xml"}), "Successful rollback leaves no staging files");
    });

    run("busy or malformed second XML layer cannot partially publish", [&] {
        const auto project = create_project(temporary.path, "xml-preflight", "empty");
        const auto idea = project / ".idea";
        fs::create_directory(idea);
        const auto local_file = idea / "workspace.xml", shared_file = idea / "fileColors.xml";
        const std::string original = "<project version=\"4\"><component name=\"Other\" /></project>";
        put(local_file, original);
        put(shared_file, original);
        const Json rules = Json::array({{{"scope", "changed"}, {"color", "Blue"}}});
        const Json patch = {{"localFileColors", rules}, {"fileColors", rules}};
        ProjectStore store(temporary.path / "xml-preflight.json");
        {
            NativeHandle blocker{CreateFileW(shared_file.c_str(), GENERIC_READ, FILE_SHARE_READ,
                                             nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr)};
            check(blocker.value != INVALID_HANDLE_VALUE, "Cannot lock the shared XML layer");
            expect_error("FILE_BUSY", [&] { store.update_project_settings(text(project), patch); });
            check(get(local_file) == original && get(shared_file) == original, "Sharing preflight leaves both layers untouched");
        }
        put(shared_file, "<project><component");
        expect_error("FILE_COLORS_XML_ERROR", [&] { store.update_project_settings(text(project), patch); });
        check(get(local_file) == original, "Malformed shared XML cannot damage local XML");
    });

    run("file colors round-trip named and RGB/RGBA colors and reject invalid entries", [&] {
        const auto file = temporary.path / "file-colors.json";
        ProjectStore store(file);
        const auto root = open_result(create_project(temporary.path, "file-colors", "empty")).at("root").get<std::string>();
        check(store.project_settings(root).at("fileColors").empty(), "no file colors by default");

        // nlohmann 的老坑：内层 `{k1,v1,k2,v2}` 会被当成**数组**，对象必须写成
        // `{{k1,v1},{k2,v2}}` 两个二元对（下面每条配置都是这个形状）。
        // 数组顺序就是优先级（`FileColorsModel.findConfigurationWithScopeFilter` 首个命中就返回），
        // 所以这条 round-trip 必须保序。
        const Json colors = Json::array({
            {{"scope", "生成物"}, {"color", "Gray"}},
            {{"scope", "源码"}, {"color", "Blue"}},
            {{"scope", "rgb"}, {"color", "#ff0000"}},
            {{"scope", "rgba"}, {"color", "0x11223344"}},
            {{"scope", "short"}, {"color", "abc"}},
            {{"scope", "short-alpha"}, {"color", "#abcd"}},
        });
        check(store.update_project_settings(root, {{"fileColors", colors}}).at("fileColors") == colors,
              "FileColorConfiguration entries round-trip in the stored order");
        const auto reloaded_colors = store.project_settings(root).at("fileColors");
        check(reloaded_colors == colors, "the order is the priority and must survive a round-trip; actual=" + reloaded_colors.dump() +
              "; XML=" + get(path_from(root) / ".idea" / "fileColors.xml"));

        // 颜色名只认那七个（`FileColorManagerImpl.ourDefaultColors` 的键）；其余一律拒绝。
        const std::vector<Json> rejected{
            "not-an-array",
            Json::array({42}),                                            // 元素不是对象
            Json::array({{{"scope", "生成物"}, {"color", "#ff000z"}}}),  // malformed hex
            Json::array({{{"scope", "生成物"}, {"color", "cyan"}}}),     // 不在那七个里
            Json::array({{{"scope", "生成物"}}}),                        // 少 color
            Json::array({{{"color", "Blue"}}}),                          // 少 scope
            Json::array({{{"scope", 1}, {"color", "Blue"}}}),            // 形状不对
            Json::array({{{"scope", "生成物"}, {"color", "Blue"}, {"x", 1}}}),  // 未知键
            Json::array({{{"scope", "a"}, {"color", "Blue"}}, {{"scope", "a"}, {"color", "Rose"}}}),  // 同名两条
        };
        for (const auto& patch : rejected) expect_error("INVALID_SETTINGS", [&] { store.update_project_settings(root, {{"fileColors", patch}}); });
        check(store.project_settings(root).at("fileColors") == colors, "a rejected fileColors patch changes nothing");
    });

    return report.summary();
}
