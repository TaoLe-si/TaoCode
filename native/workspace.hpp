#pragma once

#include <filesystem>
#include <mutex>
#include <stdexcept>
#include <string>
#include <string_view>
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
    // IDEA opens a binary file in a read-only viewer instead of refusing it, and an
    // image file renders as a preview. The bytes travel base64-encoded (JSON is text),
    // capped at `limit` so a 4 GiB artifact cannot reach the renderer. `kind` sniffs
    // the magic bytes so the UI can pick hex vs image without a second round trip.
    Json read_binary(const std::string& relative, std::size_t limit = 1024 * 1024);
    // IDEA's ToggleReadOnlyAttributeAction: flip FILE_ATTRIBUTE_READONLY and report
    // the new state so the editor can lock/unlock the buffer.
    Json set_read_only(const std::string& relative, bool read_only);
    // ConvertToWindows/UnixLineSeparatorsAction: rewrite the file from `content` (the
    // editor buffer, as saved with its own encoding/BOM) with every line ending
    // normalized to "crlf" or "lf"; version-checked and read-only-guarded.
    Json convert_line_separators(const std::string& relative, const std::string& separator,
                                 const std::string& content, const std::string& expectedVersion);
    // `safe_write` is IDEA's "Use "safe write"" (GeneralSettings.isUseSafeWrite,
    // GeneralSettings.kt:92-97): the bytes are written to a sibling temporary file that
    // replaces the target only after the content is verified, so a failed save leaves the
    // original untouched. With it off the target is truncated and written in place, which is
    // what ObjectUtil/SafeWriteRequestor does when the option is off (SafeWriteRequestor
    // .java:12-15). The setting's row is "Back up files before saving"
    // (IdeBundle.properties:85).
    Json write(const std::string& relative, const std::string& content,
               const std::string& expectedVersion, const std::string& encoding = "utf-8",
               bool bom = false, bool safe_write = true);
    // Tree mutations, all confined to the workspace root by the same relative-path
    // guards as read/write (no absolute paths, no '..', no reparse points).
    // IDEA's $Delete on a project-view selection confirms, then removes a populated
    // directory tree as well ("Delete "X" and all of its contents?"), so remove()
    // recurses with the same reparse/size guards the rest of the layer uses.
    Json create(const std::string& relative, bool directory, const std::string& template_kind = "");
    Json rename(const std::string& from, const std::string& to);
    Json remove(const std::string& relative, bool to_trash = false);
    // IDEA's Delete dialog offers "Safe delete (with usage check)"; TaoCode cannot
    // run a language query from the file layer, so the check is a workspace-wide
    // text search for the identifier and the caller decides what to do with it.
    // `relative` names the file being deleted (echoed back as `path`); it does not
    // narrow the scan — a reference can sit anywhere in the workspace. The reply
    // carries scope:"workspace"/kind:"text" so the UI never presents it as a
    // resolved Find Usages, and skips oversized and binary files.
    Json usages_of(const std::string& relative, const std::string& symbol, std::size_t limit = 200);
    // IDEA's project-view Copy + Paste: duplicate a file or a whole directory tree
    // under a new name; the copy is writable (the read-only bit is not carried over).
    Json copy(const std::string& from, const std::string& to);
    // RevealInAction ("Show in Explorer"): opens an Explorer window with the entry
    // selected. Read-only; confined by the same relative-path guards.
    Json reveal(const std::string& relative);
    bool is_open() const;

private:
    std::filesystem::path root_;
    std::vector<std::wstring> excluded_{L".git", L"node_modules", L"build", L"dist"};
    mutable std::mutex mutex_;
};

// RevealFileAction («Show in Explorer») for a path outside any open workspace: the welcome
// screen's recent-project list works on absolute paths and has no workspace yet
// (welcomeScreen/projectActions/RevealProjectDirAction.kt:25-33). Opens the *parent* directory
// with the entry selected, exactly like `RevealFileAction.openFile(Path)` (:170-174).
Json reveal_absolute(const std::string& absolute);

// 用系统默认处理器打开一个**带协议的绝对链接**（`https:` / `mailto:` / …）。
// IDEA 的对应物是 `BrowserUtil.browse`；`OpenUrlHyperlinkInfo`
// （`platform/execution-impl/src/com/intellij/ide/browsers/OpenUrlHyperlinkInfo.java`）就是把
// 控制台/文档里的 URL 交给它。
//
// **只放行带协议前缀的 URL**：`ShellExecuteW(L"open", …)` 对 `"calc.exe"` 或 `"C:\x.exe"`
// 也会照单执行，而这个 `url` 可能来自语言服务器（LSP `documentLink.target` 是服务器给的）——
// 不校验就等于给服务器一个任意命令执行的入口。协议名按 RFC 3986 的 `scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`
// 校验，其余一律拒绝。
Json open_external(const std::string& url);

} // namespace taocode
