#pragma once

#include <filesystem>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace taocode {

using Json = nlohmann::json;

class WorkspaceError : public std::runtime_error {
public:
    std::string code;
    WorkspaceError(std::string code, std::string message);
};

class Workspace {
public:
    Json open(const std::filesystem::path& root, const std::vector<std::string>& excluded = {".git", "node_modules", "build", "dist"});
    Json list(const std::string& relative);
    // Text files travel as UTF-8 JSON, so `encoding` ('auto' = BOM sniffing, else
    // 'utf-8' | 'gbk' | 'cp1252' | 'system' | 'utf-16le' | 'utf-16be') selects how the
    // bytes on disk are decoded; read reports the encoding it used and whether the
    // file carried a byte-order mark, and write re-encodes with the same pair.
    Json read(const std::string& relative, const std::string& encoding = "auto");
    // IDEA's ToggleReadOnlyAttributeAction: flip FILE_ATTRIBUTE_READONLY and report
    // the new state so the editor can lock/unlock the buffer.
    Json set_read_only(const std::string& relative, bool read_only);
    // ConvertToWindows/UnixLineSeparatorsAction: rewrite the file from `content` (the
    // editor buffer, as saved with its own encoding/BOM) with every line ending
    // normalized to "crlf" or "lf"; version-checked and read-only-guarded.
    Json convert_line_separators(const std::string& relative, const std::string& separator,
                                 const std::string& content, const std::string& expectedVersion);
    Json write(const std::string& relative, const std::string& content,
               const std::string& expectedVersion, const std::string& encoding = "utf-8", bool bom = false);
    // Tree mutations, all confined to the workspace root by the same relative-path
    // guards as read/write (no absolute paths, no '..', no reparse points). remove
    // deletes a regular file or an EMPTY directory only — never a populated tree.
    Json create(const std::string& relative, bool directory, const std::string& template_kind = "");
    Json rename(const std::string& from, const std::string& to);
    Json remove(const std::string& relative);
    bool is_open() const;

private:
    std::filesystem::path root_;
    std::vector<std::wstring> excluded_{L".git", L"node_modules", L"build", L"dist"};
    mutable std::mutex mutex_;
};

} // namespace taocode
