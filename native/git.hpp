#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "workspace.hpp"  // WorkspaceError
#include "git_log.hpp"

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
// context：统一 diff 的上下文行数（<=0 = git 默认；对应 IDEA diff 设置 settings.context.lines）。
std::string diff(const std::filesystem::path& repo, const std::string& path, bool staged,
                 const std::string& base = std::string(), int context = 0);
// Same diff, folded into left/right rows for a side-by-side viewer (see history.hpp).
Json diff_sides(const std::filesystem::path& repo, const std::string& path, bool staged,
                const std::string& base = std::string(), int context = 0);
// {files:[{status,path}]} for every file where `base` and HEAD differ.
Json compare(const std::filesystem::path& repo, const std::string& base);
std::string head(const std::filesystem::path& repo);                 // branch name, detached hash, or empty
std::vector<std::string> branches(const std::filesystem::path& repo);
void stage(const std::filesystem::path& repo, const std::string& path);
void unstage(const std::filesystem::path& repo, const std::string& path);
// `amend` rewrites the last commit; an empty message then keeps the original one.
// `signoff` adds Git's Signed-off-by trailer (git commit --signoff), which IDEA
// exposes as the "Sign-off commit" option in the commit options popup.
// `author_name`/`author_email` override the commit author for this commit only
// (git commit --author=…), which is IDEA's CommitAuthorComponent editor; both empty
// means "use the repository configuration".
void commit(const std::filesystem::path& repo, const std::string& message, bool amend = false,
            bool signoff = false, const std::string& author_name = std::string(),
            const std::string& author_email = std::string());
// The repository's configured author, read from `git config --get user.name` /
// `user.email`. Shapes {name, email}; either may be empty when unset.
Json user(const std::filesystem::path& repo);
// The distinct authors that appear in the repository's log, shaped {authors:["Name <email>"]}.
// IDEA feeds these into the commit-author field's completion list (GitCommitOptionsUi.kt:259
// -> VcsUserEditor.getAllUsers -> VcsUserRegistry.users, a set of the log's users); an entry
// with only a name or only an e-mail keeps the shorter form, like VcsUserUtil.getString.
// Best-effort: an empty repository has no log to read and simply yields no authors.
Json authors(const std::filesystem::path& repo);
void checkout(const std::filesystem::path& repo, const std::string& branch);

// History and remote/stash/branch operations. `log` shapes {commits:[{hash,
// shortHash, author, date, subject}]} for a file (empty path = whole repo).
// `stash_list` shapes {entries:[{ref, message}]}. `ahead_behind` shapes
// {available, ahead, behind} against the upstream, best-effort.
Json log(const std::filesystem::path& repo, const std::string& path, int limit);
// Full log for the VCS Log tool window: includes parent hashes and ref names so the
// frontend can draw the commit graph and label branches/tags without a second round-trip.
// Shapes {commits:[{hash, shortHash, author, date, subject, parents:[hash], refs:[{name,type}]}], offset, limit, hasMore}.
Json log_full(const std::filesystem::path& repo, int limit);
void pull(const std::filesystem::path& repo);
void push(const std::filesystem::path& repo);
// Git.Fetch: refresh remote refs without touching the working tree.
void fetch(const std::filesystem::path& repo);
// Git.Rebase: rebase onto the upstream (empty branch) or a named branch.
void rebase(const std::filesystem::path& repo, const std::string& branch);
// Cherry-pick a commit hash onto HEAD (IDEA's VCS Log popup row).
void cherry_pick(const std::filesystem::path& repo, const std::string& commit);
Json stash_list(const std::filesystem::path& repo);
void stash_save(const std::filesystem::path& repo, const std::string& message);
void stash_pop(const std::filesystem::path& repo);
void create_branch(const std::filesystem::path& repo, const std::string& name, bool checkout);
void delete_branch(const std::filesystem::path& repo, const std::string& name);
void merge(const std::filesystem::path& repo, const std::string& branch);
Json ahead_behind(const std::filesystem::path& repo);
// Git.Tag dialog: list / create (optionally at a target ref) / delete tags.
Json tag_list(const std::filesystem::path& repo);                     // {tags:[name]}
void tag_create(const std::filesystem::path& repo, const std::string& name, const std::string& target);
void tag_delete(const std::filesystem::path& repo, const std::string& name);
// IDEA's "Add to .gitignore": append the path as one line (creating the file).
void ignore_path(const std::filesystem::path& repo, const std::string& path);

// Stop the git command that is currently running, if any: the child — and, through
// its job object, every process it spawned — is terminated at once. Called from the
// UI thread while git runs on a worker thread, so it is thread-safe and never blocks;
// a call with nothing running is a no-op. Every run() is also bounded by its own
// timeout, so this is the "stop now" path rather than the only guard against a hang.
void request_cancel();

// Partial staging (IDEA's commit diff viewer stage/unstage hunks): `diff_hunks`
// splits the unified diff into selectable hunks; `apply_hunks` re-applies only the
// chosen ones to the index (`--cached`, reversed to unstage).
Json diff_hunks(const std::filesystem::path& repo, const std::string& path, bool staged);
void apply_hunks(const std::filesystem::path& repo, const std::string& path, bool staged,
                 const std::vector<int>& hunks, bool reverse);

// IDEA's Rollback: discard the working-tree changes of one path (`git checkout --
// <path>`), so a botched edit returns to the index/HEAD content without touching
// any other file. Refuses untracked paths (there is nothing to roll back to).
void revert(const std::filesystem::path& repo, const std::string& path);

// IDEA's "Reset Current Branch to…" with the three IDEA-visible modes:
// soft (keep changes staged), mixed (keep changes unstaged), hard (discard all).
// `target` is any commit-ish (a hash, a branch, HEAD~n). The branch name is
// reported back so the UI can confirm what moved.
Json reset(const std::filesystem::path& repo, const std::string& target, const std::string& mode);

// Per-line origin for `path` via `git blame --line-porcelain`:
// {lines:[{line, hash, author, email, date, summary, content}]} with 1-BASED line
// numbers. `hash` is the 8-char short sha; `date` is YYYY-MM-DD (local time).
Json blame(const std::filesystem::path& repo, const std::string& path);

// IDEA's "Show History for File" follows a file across renames (`--follow`), so the
// log keeps going past the commit that moved it. Adds the previous path of each
// commit so the UI can say "renamed from …".
Json file_history(const std::filesystem::path& repo, const std::string& path, int limit);

// What one commit actually changed, as a patch: `git show` with an empty format so
// the header is dropped and only the diff remains. Merge commits are shown against
// their first parent, which is what IDEA's "Show Details" does.
Json show_commit(const std::filesystem::path& repo, const std::string& revision);

// One linked worktree (`git worktree list --porcelain`), i.e. a second checkout of
// the same repository IDEA can open as its own project.
struct Worktree {
    std::string path;
    std::string branch;   // "detached" when the worktree has no branch checked out
    std::string head;     // commit hash
    bool bare = false;
    bool detached = false;
    bool locked = false;
    bool prunable = false;
};
Json worktree_list(const std::filesystem::path& repo);
void worktree_add(const std::filesystem::path& repo, const std::string& path, const std::string& branch, bool new_branch);
void worktree_remove(const std::filesystem::path& repo, const std::string& path, bool force);

// `git submodule status` rows: the submodule's path, the recorded commit and the
// state git reports ('-' uninitialized, '+' differs, 'U' merge conflict).
struct Submodule {
    std::string path;
    std::string commit;
    std::string describe;  // e.g. "v1.2.3-4-gabcdef" when git can name the commit
    char status = ' ';
};
Json submodule_status(const std::filesystem::path& repo);
void submodule_update(const std::filesystem::path& repo, bool init, bool recursive);

}  // namespace git
}  // namespace taocode
