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
    Json write(const std::string& relative, const std::string& content,
               const std::string& expectedVersion, const std::string& encoding = "utf-8", bool bom = false);
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

} // namespace taocode
