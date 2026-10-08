// `git.*` 的宿主侧：工作线程 + 每条命令的入参解析 / 回参整形。见 git_routes.hpp 的边界说明。
//
// 2026-10-08 从 native/main.cpp 搬出（main.cpp 贴着 tests/module-size.test.mjs 的 2000 行硬上限，
// 而 `git.*` 是它里面最大的一族：42 个 case 标签、约 178 行分派体，外加那条 100 行的工作线程）。
//
// 搬走的是**实现体**：main.cpp 里 `case "git.x"_h:` 的标签一个都没动 —— 那是
// tests/routing-parity.test.mjs 数方法名的机检锚点（它同时钉着 src/bridge.ts 的 `Method` union
// 与 `is_git_method` 的白名单）。也正因为那张表是机检的，这里**不**另开一张按方法名分派的表：
// 一个方法名对一个同名函数，清单只有 main.cpp 那一份。
//
// 每个函数体都是原分派体逐字搬过来的（只把 `current_root` / `require_repo_root()` 换成入参 `root`，
// 把 `result = ...; break;` 换成 `return ...`），行为、错误码与文案一律未改。
#include "git_routes.hpp"

#include <cstddef>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#include "git.hpp"
#include "text.hpp"

namespace taocode {
namespace git_routes {

namespace fs = std::filesystem;

// ------------------------------------------------------------------ 工作线程

Worker::Worker(std::function<void(const Json&)> run, std::function<HWND()> window,
               std::function<void(Json)> post, unsigned message)
    : run_(std::move(run)), window_(std::move(window)), post_(std::move(post)), message_(message) {}

Worker::~Worker() {
    // 收尾链（`App::close_children` 的「git 工作线程」那一步）已经调过 stop_git()；这里只是兜底：
    // 丢队列 + 等住当前那条命令（git.cpp 给每条命令都设了超时，所以有界）。
    // **不**发任何事件 —— 析构顺序上窗口与 WebView 可能已经不在了。
    {
        std::lock_guard lock(mutex_);
        requests_.clear();
    }
    taocode::git::request_cancel();
    if (thread_.joinable()) thread_.join();
}

// 回复队列原本没有上限（一条回复对应一次请求，天然有界），所以 limit 传 0。
void Worker::queue_git_reply(Json payload) {
    replies_.push(std::move(payload), window_(), message_, 0);
}

void Worker::drain_git() {
    // 这里不做"WebView 在不在"的判断：post_ 那一端（`App::post_json`）自己会丢弃
    // WebView 已经不在的那一次投递，与原来 `if (!webview) return;` 同一结果。
    for (const auto& reply : replies_.take()) post_(reply);
    // The queue emptied out: tell the UI there is no git work in flight, so the
    // status-bar indicator settles even when the last reply was an error.
    std::size_t queued = 0;
    bool busy = false;
    {
        std::lock_guard lock(mutex_);
        queued = requests_.size();
        busy = busy_.load();
    }
    if (!queued && !busy) post_(Json{{"event", "git.progress"}, {"queued", 0}, {"running", false}});
}

void Worker::queue_git_request(const Json& request) {
    bool inherited = false;
    {
        std::lock_guard lock(mutex_);
        requests_.push_back(request);
        if (busy_.load()) inherited = true;  // the running worker will pick this up
        else busy_.store(true);
    }
    // Never under the lock: publish_git_progress() takes the same mutex.
    publish_git_progress();
    if (inherited) return;
    if (thread_.joinable()) thread_.join();
    thread_ = std::thread([this] { git_worker(); });
}

// IDEA's status bar shows the queue behind the running git command: "正在获取
// 变更…（还有 2 个操作）". The counts are real (deque sizes under the lock), so
// the indicator can never claim work that is not there.
void Worker::publish_git_progress() {
    std::size_t queued = 0;
    bool busy = false;
    {
        std::lock_guard lock(mutex_);
        queued = requests_.size();
        busy = busy_.load();
    }
    Json event{{"event", "git.progress"}, {"queued", queued}, {"running", busy}};
    queue_git_reply(std::move(event));
}

// Progress events ride the same marshalling as the git replies（就是同一条队列，
// 前端按有没有 `id` 分辨回复与事件），所以这里直接复用 queue_git_reply。
void Worker::git_worker() {
    for (;;) {
        Json request;
        {
            std::lock_guard lock(mutex_);
            if (requests_.empty()) { busy_.store(false); break; }
            request = std::move(requests_.front());
            requests_.pop_front();
        }
        run_(request);
    }
    // Outside the lock, like every other publish.
    publish_git_progress();
}

// Closing the project or the window drops queued work and waits for the one
// command already running. git.cpp bounds every child with a timeout, so this
// cannot hang on a hung remote — and a half-finished push must not keep running
// against a workspace the UI has already let go of.
void Worker::stop_git() {
    {
        std::lock_guard lock(mutex_);
        requests_.clear();
    }
    taocode::git::request_cancel();
    if (thread_.joinable()) thread_.join();
    busy_.store(false);
    replies_.take();  // 丢掉还没发出去的回复（窗口/项目已经放开了）
    post_(Json{{"event", "git.progress"}, {"queued", 0}, {"running", false}});
}

// ------------------------------------------------------------------ 各条命令

Json status(const std::string& root, const Json& params) {
    const auto repository = fs::path(wide(root));
    if (!taocode::git::available()) return {{"available", false}};
    Json changes = Json::array();
    for (const auto& change : taocode::git::status(repository, params.value("ignored", false)))
        changes.push_back({{"path", change.path}, {"indexStatus", change.index_status}, {"workStatus", change.work_status},
                           {"staged", change.staged}, {"untracked", change.untracked},
                           {"ignored", change.ignored}, {"renameFrom", change.rename_from}});
    const auto branch_names = taocode::git::branches(repository);
    Json branch_track_infos = Json::array();
    for (const auto& info : taocode::git::branch_track_infos(repository, branch_names))
        branch_track_infos.push_back({{"localBranch", info.local_branch}, {"remoteName", info.remote_name},
                                      {"remoteBranch", info.remote_branch}});
    Json result = {{"available", true}, {"head", taocode::git::head(repository)},
                   {"branches", branch_names}, {"branchTrackInfos", std::move(branch_track_infos)},
                   {"changes", std::move(changes)}};
    if (const auto on_branch = taocode::git::is_on_branch(repository)) result["isOnBranch"] = *on_branch;
    return result;
}

Json diff(const std::string& root, const Json& params) {
    // context = diff 的上下文行数（前端从 generalSettings.diffContextLines 传入；0 = git 默认）。
    return {{"diff", taocode::git::diff(fs::path(wide(root)), params.at("path").get<std::string>(),
                                        params.value("staged", false), params.value("base", std::string()),
                                        params.value("context", 0), params.value("whole", false))}};
}

Json patch(const std::string& root, const Json& params) {
    // 本地更改的补丁（IDEA `CreatePatchFromChangesAction` 的输入）：`git diff HEAD`
    // （暂存 + 未暂存）＋ 未跟踪文件按"新文件"接在后面。前端 `src/patchExport.ts` 用它。
    return {{"patch", taocode::git::patch(fs::path(wide(root)), params.value("includeUntracked", true))}};
}

Json diff_sides(const std::string& root, const std::string& method, const Json& params) {
    const auto repository = fs::path(wide(root));
    if (method == "git.compare") return taocode::git::compare(repository, params.at("base").get<std::string>());
    return taocode::git::diff_sides(repository, params.at("path").get<std::string>(),
                                    params.value("staged", false), params.value("base", std::string()),
                                    params.value("context", 0));
}

Json stage(const std::string& root, const std::string& method, const Json& params) {
    const auto repository = fs::path(wide(root));
    const auto path = params.at("path").get<std::string>();
    if (method == "git.stage") taocode::git::stage(repository, path);
    else taocode::git::unstage(repository, path);
    return {{"ok", true}};
}

Json commit(const std::string& root, const Json& params) {
    // 「提交文件…」（CommonCheckinFilesAction.kt:37-53 → CheckinActionUtil.kt:104-106、:135-136）：
    // 非空 = 只有这些路径进这次提交（git commit --only -- <paths>）；缺这个键就是整份暂存区。
    taocode::git::commit(fs::path(wide(root)), params.value("message", std::string()),
                         params.value("amend", false), params.value("signoff", false),
                         params.value("author", std::string()), params.value("authorEmail", std::string()),
                         params.value("paths", std::vector<std::string>()));
    return {{"ok", true}};
}

Json checkout(const std::string& root, const Json& params) {
    taocode::git::checkout(fs::path(wide(root)), params.at("branch").get<std::string>());
    return {{"ok", true}};
}

Json log(const std::string& root, const Json& params) {
    return taocode::git::log(fs::path(wide(root)), params.value("path", std::string()), params.value("limit", 100));
}

Json log_request(const std::string& root, const std::string& method, const Json& params) {
    return taocode::git::log_request(fs::path(wide(root)), method, params);
}

Json pull(const std::string& root) {
    taocode::git::pull(fs::path(wide(root)));
    return {{"ok", true}};
}

Json fetch(const std::string& root) {
    taocode::git::fetch(fs::path(wide(root)));
    return {{"ok", true}};
}

Json push(const std::string& root) {
    taocode::git::push(fs::path(wide(root)));
    return {{"ok", true}};
}

Json rebase(const std::string& root, const Json& params) {
    taocode::git::rebase(fs::path(wide(root)), params.value("branch", std::string()));
    return {{"ok", true}};
}

Json cherry_pick(const std::string& root, const Json& params) {
    taocode::git::cherry_pick(fs::path(wide(root)), params.at("commit").get<std::string>());
    return {{"ok", true}};
}

Json stash(const std::string& root) {
    return taocode::git::stash_list(fs::path(wide(root)));
}

Json stash_save(const std::string& root, const Json& params) {
    taocode::git::stash_save(fs::path(wide(root)), params.value("message", std::string()));
    return {{"ok", true}};
}

Json stash_pop(const std::string& root, const Json& params) {
    // 空 `ref` = 栈顶（原行为）；带 `stash@{n}` = 按序号取回某一条（搁架面板任意一行）。
    taocode::git::stash_pop(fs::path(wide(root)), params.value("ref", std::string()));
    return {{"ok", true}};
}

Json create_branch(const std::string& root, const Json& params) {
    taocode::git::create_branch(fs::path(wide(root)), params.at("name").get<std::string>(), params.value("checkout", false));
    return {{"ok", true}};
}

Json delete_branch(const std::string& root, const Json& params) {
    taocode::git::delete_branch(fs::path(wide(root)), params.at("name").get<std::string>());
    return {{"ok", true}};
}

Json revert(const std::string& root, const Json& params) {
    taocode::git::revert(fs::path(wide(root)), params.at("path").get<std::string>());
    return {{"ok", true}};
}

Json revert_commit(const std::string& root, const Json& params) {
    taocode::git::revert_commit(fs::path(wide(root)), params.at("commit").get<std::string>());
    return {{"ok", true}};
}

Json reset(const std::string& root, const Json& params) {
    return taocode::git::reset(fs::path(wide(root)), params.at("target").get<std::string>(),
                               params.value("mode", std::string("mixed")));
}

Json merge(const std::string& root, const Json& params) {
    taocode::git::merge(fs::path(wide(root)), params.at("branch").get<std::string>());
    return {{"ok", true}};
}

Json tags(const std::string& root) {
    return taocode::git::tag_list(fs::path(wide(root)));
}

Json tag_create(const std::string& root, const Json& params) {
    taocode::git::tag_create(fs::path(wide(root)), params.at("name").get<std::string>(),
                             params.value("target", std::string()));
    return {{"ok", true}};
}

Json tag_delete(const std::string& root, const Json& params) {
    taocode::git::tag_delete(fs::path(wide(root)), params.at("name").get<std::string>());
    return {{"ok", true}};
}

Json ignore(const std::string& root, const Json& params) {
    taocode::git::ignore_path(fs::path(wide(root)), params.at("path").get<std::string>());
    return {{"ok", true}};
}

// IDEA's CommitAuthorComponent reads the repository's configured author; the
// same values are handed back to `git.commit` when the user overrides them.
Json user(const std::string& root) {
    return taocode::git::user(fs::path(wide(root)));
}

// ...and the *authors* completion list comes from the log users (GitCommitOptionsUi.kt:259).
Json authors(const std::string& root) {
    return taocode::git::authors(fs::path(wide(root)));
}

Json diff_hunks(const std::string& root, const Json& params) {
    return taocode::git::diff_hunks(fs::path(wide(root)), params.at("path").get<std::string>(),
                                    params.value("staged", false));
}

Json apply_hunks(const std::string& root, const Json& params) {
    taocode::git::apply_hunks(fs::path(wide(root)), params.at("path").get<std::string>(),
                              params.value("staged", false), params.at("hunks").get<std::vector<int>>(),
                              params.value("reverse", false));
    return {{"ok", true}};
}

Json ahead_behind(const std::string& root) {
    return taocode::git::ahead_behind(fs::path(wide(root)));
}

Json blame(const std::string& root, const Json& params) {
    return taocode::git::blame(fs::path(wide(root)), params.at("path").get<std::string>());
}

Json file_history(const std::string& root, const Json& params) {
    return taocode::git::file_history(fs::path(wide(root)), params.at("path").get<std::string>(),
                                      params.value("limit", 100));
}

Json show_commit(const std::string& root, const Json& params) {
    return taocode::git::show_commit(fs::path(wide(root)), params.at("revision").get<std::string>());
}

Json worktree_list(const std::string& root) {
    return taocode::git::worktree_list(fs::path(wide(root)));
}

Json worktree_add(const std::string& root, const Json& params) {
    const auto repository = fs::path(wide(root));
    taocode::git::worktree_add(repository, params.at("path").get<std::string>(),
                               params.value("branch", std::string()), params.value("newBranch", false));
    // Return the refreshed list so the UI cannot show a stale tree after a
    // mutation it just performed.
    return taocode::git::worktree_list(repository);
}

Json worktree_remove(const std::string& root, const Json& params) {
    const auto repository = fs::path(wide(root));
    taocode::git::worktree_remove(repository, params.at("path").get<std::string>(), params.value("force", false));
    return taocode::git::worktree_list(repository);
}

Json submodules(const std::string& root) {
    return taocode::git::submodule_status(fs::path(wide(root)));
}

Json submodule_update(const std::string& root, const Json& params) {
    const auto repository = fs::path(wide(root));
    taocode::git::submodule_update(repository, params.value("init", true), params.value("recursive", false));
    return taocode::git::submodule_status(repository);
}

// Cancels the git command running on the worker right now. IDEAs
// background-task rows carry a cancel button; git commands are the tasks
// TaoCode runs in the background, so this is that button's backend.
Json cancel() {
    taocode::git::request_cancel();
    return {{"ok", true}};
}

}  // namespace git_routes
}  // namespace taocode
