// 见 trusted_paths.hpp 的判据与上游对照。纯字符串逻辑，不碰文件系统。
#include "trusted_paths.hpp"

#include <algorithm>
#include <cctype>

namespace taocode {
namespace trusted {

std::string normalize_path(const std::string& raw) {
    // 先去掉首尾空白（清单里存的是磁盘路径，空白只可能来自手改的 JSON）。
    std::size_t begin = 0, end = raw.size();
    while (begin < end && (raw[begin] == ' ' || raw[begin] == '\t')) ++begin;
    while (end > begin && (raw[end - 1] == ' ' || raw[end - 1] == '\t')) --end;
    std::string path = raw.substr(begin, end - begin);
    for (char& ch : path) {
        if (ch == '\\') ch = '/';
        else ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    while (path.size() > 1 && path.back() == '/') path.pop_back();
    // 盘符根（`c:/`）去掉尾斜杠后成了 `c:`，它不再是任何路径的祖先 —— 补回一个斜杠。
    if (path.size() == 2 && path[1] == ':' && path[0] >= 'a' && path[0] <= 'z') path += '/';
    return path;
}

namespace {

bool inside(const std::string& child, const std::string& ancestor) {
    if (ancestor.empty()) return false;
    if (child == ancestor) return true;
    if (ancestor.back() == '/') return child.rfind(ancestor, 0) == 0;
    return child.size() > ancestor.size() && child.compare(0, ancestor.size(), ancestor) == 0 && child[ancestor.size()] == '/';
}

}  // namespace

State state_for(const Json& entries, const std::string& path) {
    const std::string normalized = normalize_path(path);
    if (normalized.empty() || !entries.is_array()) return State::unknown;
    State best = State::unknown;
    std::size_t best_length = 0;
    for (const auto& entry : entries) {
        if (!entry.is_object() || !entry.contains("path") || !entry.at("path").is_string()) continue;
        const std::string ancestor = normalize_path(entry.at("path").get<std::string>());
        if (!inside(normalized, ancestor)) continue;
        // 越具体越优先（上游取 nameCount 最大的祖先）；等长时后写的赢不了，保持首个。
        if (ancestor.size() <= best_length) continue;
        best_length = ancestor.size();
        const bool trusted = entry.contains("trusted") && entry.at("trusted").is_boolean() && entry.at("trusted").get<bool>();
        best = trusted ? State::trusted : State::untrusted;
    }
    return best;
}

void require_trusted(const Json& entries, const std::string& root, const std::string& action) {
    if (root.empty()) return;  // 没打开项目：各自的 NOT_OPEN 检查负责报错。
    if (state_for(entries, root) == State::trusted) return;
    // 文案与前端 `trustBlockedMessage` 同口径：说清是哪条路、怎么解。
    throw WorkspaceError("UNTRUSTED_PROJECT",
                         "安全模式：" + root + " 尚未被信任，已阻止" + action +
                             "。在项目打开时选择「信任并打开」，或先关闭再用受信任的方式重开。");
}

}  // namespace trusted
}  // namespace taocode
