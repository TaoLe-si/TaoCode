#pragma once

#include <cstddef>
#include <filesystem>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

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

    // 保留期：上游只有一个设置 —— advancedSetting `localHistory.daysToKeep`，默认 **5**
    // （platform/lvcs-impl/resources/intellij.platform.lvcs.impl.xml:133；代码兜底同一个数：
    //  platform/lvcs-impl/src/com/intellij/history/core/ChangeListImpl.kt:19-20
    //   DAYS_TO_KEEP_PROPERTY_KEY / DEFAULT_DAYS_TO_KEEP = 5，缺键时 catch 回落到它，见 :127-136）。
    // 本仓先取上游默认并硬在模块里：新增持久化键要六处成对（见 docs/batch-2026-10-06-histdays.md §6），
    // 半条链不如没有。
    inline constexpr static long long default_days_to_keep = 5;
    // ChangeList.kt:42 DEFAULT_INTERVAL_BETWEEN_ACTIVITIES_MILLISECONDS = 12.hours。
    // 单位是毫秒，与 purge 的 period 同单位（PersistentChangeListStorage.kt:321 直接和 delta 比）。
    inline constexpr static long long activity_interval_millis = 12LL * 60LL * 60LL * 1000LL;

    explicit History(std::filesystem::path store_root,
                     std::size_t max_versions_per_file = default_max_versions_per_file,
                     long long days_to_keep = default_days_to_keep);
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
    long long days_to_keep() const noexcept { return days_to_keep_; }
    const std::filesystem::path& store_root() const noexcept { return store_root_; }

private:
    std::filesystem::path store_root_;
    std::size_t max_versions_ = default_max_versions_per_file;
    long long days_to_keep_ = default_days_to_keep;
    mutable std::mutex mutex_;
};

// 本地历史的「按天过期」口径，逐条对齐上游
// platform/lvcs-impl/src/com/intellij/history/core/PersistentChangeListStorage.kt:308-329
// 的 `findFirstObsoleteBlock` —— 它**不是**墙钟差：
//   · `time_millis` 按**新→旧**排列（本仓索引即此序，上游是 getLastRecord() 往回走 :312-325）；
//   · 从最新一条开始往回累加相邻间隔 `delta = time_millis[i-1] - time_millis[i]`；
//     最新那条自己 `delta` 记 0（`:315 prevTimestamp == 0L -> = t`），所以**基准是最新快照的时间戳**，
//     不是当前时间：一条都不写的旧项目不会因为现实里过了 N 天而被清；
//   · `:321 length += if (delta < intervalBetweenActivities) delta else 1` —— 间隔 <12h 累加真实毫秒，
//     **≥12h 只累加字面量 1**（`:320` 的注释把它*称作*一天，单位仍是毫秒，因为 `:323` 要和 period 比大小）；
//     于是跨夜/跨周末的空档几乎不计龄，period=5 天其实是「5 天的活动时长」；
//   · `:323 if (length >= period) return last` —— 累计首次达到 period 的那条起（连同更旧的）过期，
//     上游随后 `:300 deleteRecordsUpTo(firstObsoleteId)` 整段删掉。
// 返回第一个过期条目的下标；全不过期返回 `time_millis.size()`。
std::size_t first_obsolete_index(const std::vector<long long>& time_millis,
                                 long long period_millis, long long interval_millis);

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
