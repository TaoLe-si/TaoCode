#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "workspace.hpp"  // WorkspaceError

namespace taocode {
namespace git {

struct Change {
    std::string path;          // repo-relative, '/' separators
    std::string index_status;  // porcelain X (staged)
    std::string work_status;   // porcelain Y (unstaged)
    bool staged = false;
    bool untracked = false;
    std::string rename_from;   // set for renames/copies
};

bool available();
std::vector<Change> status(const std::filesystem::path& repo);
// With a non-empty `base`, the diff compares the two tips (`git diff HEAD base`), so the
// other side's files read as additions and files only this side has read as deletions —
// IDEA's compare view. Otherwise it is the staged/unstaged working-tree state.
std::string diff(const std::filesystem::path& repo, const std::string& path, bool staged,
                 const std::string& base = std::string());
// Same diff, folded into left/right rows for a side-by-side viewer (see history.hpp).
Json diff_sides(const std::filesystem::path& repo, const std::string& path, bool staged,
                const std::string& base = std::string());
// {files:[{status,path}]} for every file where `base` and HEAD differ.
Json compare(const std::filesystem::path& repo, const std::string& base);
std::string head(const std::filesystem::path& repo);                 // branch name, detached hash, or empty
std::vector<std::string> branches(const std::filesystem::path& repo);
void stage(const std::filesystem::path& repo, const std::string& path);
void unstage(const std::filesystem::path& repo, const std::string& path);
// `amend` rewrites the last commit; an empty message then keeps the original one.
void commit(const std::filesystem::path& repo, const std::string& message, bool amend = false);
void checkout(const std::filesystem::path& repo, const std::string& branch);

// History and remote/stash/branch operations. `log` shapes {commits:[{hash,
// shortHash, author, date, subject}]} for a file (empty path = whole repo).
// `stash_list` shapes {entries:[{ref, message}]}. `ahead_behind` shapes
// {available, ahead, behind} against the upstream, best-effort.
Json log(const std::filesystem::path& repo, const std::string& path, int limit);
// Full log for the VCS Log tool window: includes parent hashes and ref names so the
// frontend can draw the commit graph and label branches/tags without a second round-trip.
// Shapes {commits:[{hash, shortHash, author, date, subject, parents:[hash], refs:[name]}]}.
Json log_full(const std::filesystem::path& repo, int limit);
void pull(const std::filesystem::path& repo);
void push(const std::filesystem::path& repo);
Json stash_list(const std::filesystem::path& repo);
void stash_save(const std::filesystem::path& repo, const std::string& message);
void stash_pop(const std::filesystem::path& repo);
void create_branch(const std::filesystem::path& repo, const std::string& name, bool checkout);
void merge(const std::filesystem::path& repo, const std::string& branch);
Json ahead_behind(const std::filesystem::path& repo);

// Per-line origin for `path` via `git blame --line-porcelain`:
// {lines:[{line, hash, author, content}]} with 1-BASED line numbers.
Json blame(const std::filesystem::path& repo, const std::string& path);

}  // namespace git
}  // namespace taocode
