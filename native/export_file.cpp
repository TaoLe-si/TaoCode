// 导出文件的落盘实现，见 export_file.hpp 的边界说明。
#include "export_file.hpp"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>

#include "text.hpp"

namespace taocode {
namespace export_file {
namespace {

namespace fs = std::filesystem;

void fail(const char* code, const std::string& message) { throw WorkspaceError(code, message); }

/** 展示用的小写扩展名（带点）。 */
std::string lowered_extension(std::string_view name) {
    const auto dot = name.find_last_of('.');
    if (dot == std::string_view::npos) return {};
    std::string extension(name.substr(dot));
    std::transform(extension.begin(), extension.end(), extension.begin(),
                   [](unsigned char character) { return static_cast<char>(std::tolower(character)); });
    return extension;
}

}  // namespace

bool allowed_extension(std::string_view name) {
    const auto extension = lowered_extension(name);
    if (extension.empty()) return false;
    for (const auto allowed : kAllowedExtensions) if (extension == allowed) return true;
    return false;
}

Json write_all(const std::vector<Entry>& entries) {
    if (entries.empty()) fail("INVALID_ARGUMENT", "没有要导出的文件。");
    if (entries.size() > kMaxFiles)
        fail("TOO_MANY_FILES", "一次最多导出 " + std::to_string(kMaxFiles) + " 个文件。");
    std::size_t total = 0;
    for (const auto& entry : entries) {
        if (entry.path.empty()) fail("INVALID_PATH", "导出路径不能为空。");
        const fs::path path = fs::path(wide(entry.path));
        if (!path.is_absolute()) fail("INVALID_PATH", "导出路径必须是绝对路径。");
        std::error_code error;
        // 「是不是目录」先于「扩展名」判：把一个目录当导出目标时报的应当是路径错误，
        // 而不是"只允许 .html"（后者会让人以为只是扩展名写错了）。
        if (fs::is_directory(path, error)) fail("INVALID_PATH", "导出路径是一个目录：" + entry.path);
        if (!allowed_extension(entry.path))
            fail("INVALID_EXTENSION", "只允许导出 .html / .htm 文件：" + entry.path);
        if (!fs::is_directory(path.parent_path(), error))
            fail("NOT_FOUND", "导出目录不存在：" + utf8(path.parent_path().native()));
        // 与其他写路径一致：解析到重解析点的目标可能完全在别处，拒绝。
        if (fs::is_symlink(fs::symlink_status(path, error))) fail("REPARSE_POINT", "不允许写到符号链接上：" + entry.path);
        total += entry.content.size();
    }
    if (total > kMaxBytes) fail("TOO_LARGE", "导出的内容超过 64 MiB，请缩小范围。");

    Json paths = Json::array();
    std::size_t written = 0;
    for (const auto& entry : entries) {
        const fs::path path = fs::path(wide(entry.path));
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        if (!out) fail("IO_ERROR", "无法写入：" + entry.path);
        out.write(entry.content.data(), static_cast<std::streamsize>(entry.content.size()));
        if (!out) fail("IO_ERROR", "写入失败：" + entry.path);
        ++written;
        paths.push_back(utf8(path.native()));
    }
    return {{"written", static_cast<std::int64_t>(written)},
            {"bytes", static_cast<std::int64_t>(total)},
            {"paths", paths}};
}

// `app.writeExportFiles` 的入口：整形放这里，main.cpp 只留一行转发（它贴着机检上限）。
Json write_json(const Json& files) {
    if (!files.is_array()) fail("INVALID_ARGUMENT", "files 必须是数组。");
    std::vector<Entry> entries;
    entries.reserve(files.size());
    for (const auto& item : files)
        entries.push_back({item.at("path").get<std::string>(), item.at("content").get<std::string>()});
    return write_all(entries);
}

}  // namespace export_file
}  // namespace taocode
