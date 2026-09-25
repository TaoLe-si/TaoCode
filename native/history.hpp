#pragma once

#include <cstddef>
#include <filesystem>
#include <mutex>
#include <string>
#include <string_view>

#include "workspace.hpp"  // taocode::Json, taocode::WorkspaceError

namespace taocode::history {

// 本地历史（Local History）：与 Git 完全无关的、按项目落盘的内容快照库。
//
// The caller owns where the store lives — main.cpp passes
//   %LOCALAPPDATA%\TaoCode\history\<sha256-of-project-root>
// so the engine only ever sees an opaque directory. Layout:
//   <store_root>/files/<sha256(rel-path)>/index.json          (version list, atomic rewrite)
//   <store_root>/files/<sha256(rel-path)>/<epochMillis>-<seq> (raw snapshot bytes, immutable)
// A workspace-relative '/' path is mapped to a hash-named folder, so no user path,
// no encoding and no length hazard ever reaches the file system. Snapshots are read
// back from disk on demand and never cached, so tracking any number of files costs
// the process nothing but the small index it is currently parsing.
// Every IO call uses the \\?\ extended-length namespace and rejects reparse points.
class History {
public:
    inline constexpr static std::size_t default_max_versions_per_file = 50;

    explicit History(std::filesystem::path store_root,
                     std::size_t max_versions_per_file = default_max_versions_per_file);
    History(const History&) = delete;
    History& operator=(const History&) = delete;

    // 记录一次内容快照。幂等：与最新版本内容相同则什么都不写。
    // `reason` is a short label — "save" / "revert" / "external".
    void record(const std::string& rel_path, const std::string& content, const std::string& reason);

    // {entries: [{id, reason, bytes, timeMillis, time}]} — newest first, [] when unknown.
    Json list(const std::string& rel_path) const;

    // {content, version} — `version` is the snapshot's SHA-256 hex, which lets the UI
    // detect a no-op rollback and feed the text through the normal file.write path.
    // Throws WorkspaceError("NOT_FOUND") for an unknown id.
    Json content(const std::string& rel_path, const std::string& id) const;

    // {diff} — unified diff with the snapshot as "before" and `current_content` as
    // "after". Throws WorkspaceError("NOT_FOUND") for an unknown id.
    Json diff(const std::string& rel_path, const std::string& id,
              const std::string& current_content) const;

    // {rows, truncated, header} — the same snapshot-vs-buffer comparison as diff(), but
    // folded into left/right rows for the side-by-side viewer. Both texts are already
    // in hand here, so the rows come straight off the LCS script instead of re-parsing
    // unified text the way the Git path has to.
    Json side_diff(const std::string& rel_path, const std::string& id,
                   const std::string& current_content) const;

    std::size_t max_versions_per_file() const noexcept { return max_versions_; }
    const std::filesystem::path& store_root() const noexcept { return store_root_; }

private:
    std::filesystem::path store_root_;
    std::size_t max_versions_ = default_max_versions_per_file;
    mutable std::mutex mutex_;
};

// 纯函数：LCS 行级 unified diff（约 3 行上下文），供 diff() 与测试复用。
std::string unified_diff(std::string_view before, std::string_view after);

// 纯函数：把同一条行级脚本折叠成左右对齐的并排差异，供 Git 与本地历史共用。
// {rows:[{kind:'equal'|'insert'|'delete'|'change', left:{no,text}?, right:{no,text}?,
//         leftMarks?:[[start,len]], rightMarks?:[[start,len]]}], truncated:bool}
// 行号 1 起；change 行带词级差异区间（字节偏移），并排视图据此高亮。
Json diff_sides(std::string_view before, std::string_view after);

// 同上，但输入是 git diff 的 unified 文本：把它还原成同样的行脚本，Git 侧因此不需要
// 再读工作区文件（避免重复处理长路径/前缀），也不会与 unified 视图给出两种答案。
Json diff_sides_from_unified(const std::string& text);

}  // namespace taocode::history
