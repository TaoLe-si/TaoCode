#include "workspace.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::Json;
using taocode::Workspace;
using taocode::WorkspaceError;
constexpr std::size_t max_bytes = 16 * 1024 * 1024;

std::string utf8(std::u8string_view value) {
    return {reinterpret_cast<const char*>(value.data()), value.size()};
}

std::string path_text(const fs::path& path) {
    return utf8(path.generic_u8string());
}

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

template <class Operation>
void expect_error(const std::string& code, Operation&& operation) {
    try {
        operation();
    } catch (const WorkspaceError& error) {
        check(error.code == code, "Expected " + code + ", got " + error.code + ": " + error.what());
        check(std::string(error.what()).size() > 0, "WorkspaceError needs a message");
        return;
    }
    throw std::runtime_error("Expected WorkspaceError: " + code);
}

void put(const fs::path& path, const std::string& content) {
    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    check(stream.is_open(), "Cannot create fixture: " + path_text(path));
    stream.write(content.data(), static_cast<std::streamsize>(content.size()));
    stream.close();
    check(!stream.fail(), "Cannot write fixture: " + path_text(path));
}

std::string get(const fs::path& path) {
    std::ifstream stream(path, std::ios::binary);
    check(stream.is_open(), "Cannot read fixture: " + path_text(path));
    std::string result{std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>()};
    check(!stream.bad(), "Cannot read fixture bytes");
    return result;
}

struct TempRoot {
    fs::path path;
    TempRoot() {
        const auto parent = fs::temp_directory_path();
        const auto prefix = "taocode-workspace-test-" + std::to_string(GetCurrentProcessId()) + "-" +
                            std::to_string(GetTickCount64()) + "-";
        for (unsigned attempt = 0; attempt < 100; ++attempt) {
            auto candidate = parent / (prefix + std::to_string(attempt));
            std::error_code error;
            if (fs::create_directory(candidate, error)) {
                path.swap(candidate);
                return;
            }
            if (error && error != std::errc::file_exists)
                throw std::runtime_error("Cannot create isolated temporary root: " + error.message());
        }
        throw std::runtime_error("Cannot allocate unique temporary root");
    }
    ~TempRoot() {
        if (path.empty()) return;
        std::error_code error;
        fs::remove_all(path, error);
        if (error) std::cerr << "Cleanup failed for " << path_text(path) << ": " << error.message() << '\n';
    }
    TempRoot(const TempRoot&) = delete;
    TempRoot& operator=(const TempRoot&) = delete;
};

struct NativeHandle {
    HANDLE handle;
    ~NativeHandle() { if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle); }
};

bool contains(const Json& entries, const std::string& name) {
    return std::any_of(entries.begin(), entries.end(), [&](const Json& entry) {
        return entry.at("name").get<std::string>() == name;
    });
}

bool make_symlink(const fs::path& link, const fs::path& target, bool directory) {
    const DWORD flags = directory ? SYMBOLIC_LINK_FLAG_DIRECTORY : 0;
    if (CreateSymbolicLinkW(link.c_str(), target.c_str(), flags | 0x2)) return true;
    auto error = GetLastError();
    if (error == ERROR_INVALID_PARAMETER) {
        if (CreateSymbolicLinkW(link.c_str(), target.c_str(), flags)) return true;
        error = GetLastError();
    }
    std::cout << "SKIP symlink " << path_text(link.filename()) << " (Windows error " << error << ")\n";
    return false;
}

} // namespace

int main() {
    int failures = 0;
    int passed = 0;
    try {
        TempRoot temporary;
        const auto root = temporary.path / fs::path(u8"中文项目");
        const auto outside = temporary.path / "outside";
        fs::create_directory(root);
        fs::create_directory(outside);
        const auto chinese_directory = fs::path(u8"中文目录");
        const auto chinese_file = fs::path(u8"中文.txt");
        fs::create_directory(root / chinese_directory);
        for (const auto* name : {"z-dir", "a-dir", ".settings", ".git", "node_modules", "build", "dist"})
            fs::create_directory(root / name);
        for (const auto* name : {"build", "dist", "node_modules", ".git"})
            put(root / ".settings" / name, "visible file");
        put(root / ".env", "VISIBLE=yes\r\n");
        put(root / "z.txt", "z");
        put(root / "a.txt", "a");
        put(root / "build.txt", "visible");
        put(outside / "secret.txt", "outside-original");
        const std::string bom = "\xEF\xBB\xBF";
        const auto original_text = bom + utf8(u8"第一行\r\n第二行\r\n");
        put(root / chinese_directory / chinese_file, original_text);
        const auto relative_chinese = utf8(u8"中文目录/中文.txt");
        Workspace workspace;
        std::string opened_root;

        const auto run = [&](const std::string& name, auto&& operation) {
            try {
                operation();
                ++passed;
                std::cout << "PASS " << name << '\n';
            } catch (const std::exception& error) {
                ++failures;
                std::cerr << "FAIL " << name << ": " << error.what() << '\n';
            }
        };

        run("unopened workspace", [&] {
            check(!workspace.is_open(), "Workspace starts closed");
            expect_error("NOT_OPEN", [&] { workspace.list(""); });
            expect_error("NOT_OPEN", [&] { workspace.read("a.txt"); });
            expect_error("NOT_OPEN", [&] { workspace.write("a.txt", "new", "old"); });
            expect_error("NOT_FOUND", [&] { workspace.open(temporary.path / "missing"); });
            check(!workspace.is_open(), "Failed first open must stay closed");
        });

        run("UTF-8 open and sorted filtered listing", [&] {
            const auto opened = workspace.open(root);
            check(workspace.is_open(), "Workspace should be open");
            check(opened.at("name") == utf8(u8"中文项目"), "UTF-8 workspace name");
            opened_root = opened.at("root").get<std::string>();
            check(fs::path(std::u8string(opened_root.begin(), opened_root.end())).is_absolute(), "Root must be absolute");
            check(fs::equivalent(fs::path(std::u8string(opened_root.begin(), opened_root.end())), root), "Root must identify selected directory");
            const auto entries = opened.at("entries");
            check(entries.is_array(), "Entries must be an array");
            check(entries == workspace.list(""), "Open entries must match root listing");
            check(entries == workspace.list("."), "Dot means workspace root");
            for (const auto* name : {".git", "node_modules", "build", "dist"})
                check(!contains(entries, name), "Ignored directory was listed");
            check(contains(entries, ".env") && contains(entries, ".settings"), "Other dotfiles must be visible");
            check(contains(entries, "build.txt"), "Similar file names must be visible");
            bool saw_file = false;
            std::string previous;
            std::string previous_kind;
            for (const auto& entry : entries) {
                const auto kind = entry.at("kind").get<std::string>();
                const auto name = entry.at("name").get<std::string>();
                check(kind == "directory" || kind == "file", "Unexpected entry kind");
                if (kind == "file") saw_file = true;
                else check(!saw_file, "Directories must sort before files");
                if (kind == previous_kind) check(previous < name, "Names must be sorted");
                check(entry.at("path") == name, "Root entry paths must be relative");
                previous = name;
                previous_kind = kind;
            }
            const auto nested = workspace.list(utf8(u8"中文目录"));
            check(nested.size() == 1 && nested[0].at("path") == relative_chinese,
                  "Nested paths must use UTF-8 and forward slashes");
            const auto special_files = workspace.list(".settings");
            for (const auto* name : {".git", "node_modules", "build", "dist"})
                check(contains(special_files, name), "Ignore rules apply only to directories");
        });

        run("project exclusion settings are applied transactionally", [&] {
            check(contains(workspace.open(root, {}).at("entries"), ".git"), "Empty exclusions should show .git");
            const auto filtered = workspace.open(root, {".settings", "a-dir"}).at("entries");
            check(!contains(filtered, ".settings") && !contains(filtered, "a-dir"), "Configured directories must be hidden");
            check(contains(filtered, "build"), "Default exclusions must not leak between projects");
            expect_error("INVALID_SETTINGS", [&] { workspace.open(root, {"../outside"}); });
            check(workspace.list("") == filtered, "Invalid settings must not alter the open workspace");
            workspace.open(root);
        });

        run("BOM CRLF UTF-8 read and successful save", [&] {
            const auto before = workspace.read(utf8(u8"中文目录\\中文.txt"));
            check(before.at("path") == relative_chinese, "Read path must be normalized");
            // The byte-order mark belongs to the file, not to the text: it must not
            // appear as a U+FEFF character the user can edit.
            check(before.at("content") == utf8(u8"第一行\r\n第二行\r\n"), "BOM is decoded away, CRLF stays byte-exact");
            check(before.at("encoding") == "utf-8" && before.at("bom") == true, "read reports the encoding and the mark");
            const auto version = before.at("version").get<std::string>();
            check(version.size() == 64 && std::all_of(version.begin(), version.end(), [](char ch) {
                return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f');
            }), "Version must be lowercase SHA256 hex");
            const auto changed = utf8(u8"保存成功\r\n中文路径\r\n");
            const auto saved = workspace.write(relative_chinese, changed, version, "utf-8", true);
            check(saved.at("bytes").get<std::size_t>() == changed.size() + bom.size(), "Save reports UTF-8 bytes plus the mark");
            check(saved.at("version") != version, "Changed content needs a new fingerprint");
            check(get(root / chinese_directory / chinese_file) == bom + changed, "Save must restore the exact byte layout");
            const auto after = workspace.read(relative_chinese);
            check(after.at("content") == changed && after.at("version") == saved.at("version"), "Save/read agreement");
            const auto unchanged = workspace.write(relative_chinese, changed, after.at("version").get<std::string>(), "utf-8", true);
            check(unchanged == saved, "Identical content must retain its version");
            const auto entries = workspace.list(utf8(u8"中文目录"));
            check(entries.size() == 1, "Successful save must clean temporary and backup files");
        });

        run("GBK text decodes for the editor and re-encodes on save", [&] {
            const std::string gbk_bytes("\xD6\xD0\xCE\xC4\xB2\xE2\xCA\xD4", 8);   // 中文测试
            const auto gbk_text = utf8(u8"中文测试");
            put(root / "gbk.txt", gbk_bytes);
            const auto decoded = workspace.read("gbk.txt", "gbk");
            check(decoded.at("content") == gbk_text, "GBK bytes became the right characters: " + decoded.at("content").get<std::string>());
            check(decoded.at("encoding") == "gbk" && decoded.at("bom") == false, "the read reports the encoding it used");
            // Auto-detection must not pretend GBK is UTF-8: it fails, and the UI offers
            // the encoding choice instead of showing mojibake.
            expect_error("INVALID_UTF8", [&] { workspace.read("gbk.txt"); });
            const auto saved_text = gbk_text + " ok";
            const auto saved = workspace.write("gbk.txt", saved_text, decoded.at("version").get<std::string>(), "gbk", false);
            check(saved.at("encoding") == "gbk", "the save echoes the encoding");
            check(get(root / "gbk.txt") == gbk_bytes + " ok", "saving wrote GBK bytes, not UTF-8");
            check(workspace.read("gbk.txt", "gbk").at("content") == saved_text, "the GBK round trip is stable");
        });

        run("UTF-16 files are detected by their byte-order mark", [&] {
            // "A中" as byte pairs; spelled with char lists because \x escapes are greedy.
            const std::string le_body{'A', '\x00', '\x2D', 'N'};
            const std::string be_body{'\x00', 'A', 'N', '\x2D'};
            put(root / "utf16le.txt", std::string("\xFF\xFE") + le_body);
            put(root / "utf16be.txt", std::string("\xFE\xFF") + be_body);
            put(root / "utf16odd.txt", std::string("\xFF\xFE") + "A");
            const auto le = workspace.read("utf16le.txt");
            const auto be = workspace.read("utf16be.txt");
            check(le.at("content") == utf8(u8"A中"), "UTF-16LE decoded: " + le.at("content").get<std::string>());
            check(le.at("encoding") == "utf-16le" && le.at("bom") == true, "the little-endian mark was honoured");
            check(be.at("content") == utf8(u8"A中") && be.at("encoding") == "utf-16be", "big-endian mark honoured");
            // NUL bytes are ordinary in UTF-16, so the binary guard must not fire here.
            const auto saved = workspace.write("utf16le.txt", utf8(u8"A中B"), le.at("version").get<std::string>(), "utf-16le", true);
            check(get(root / "utf16le.txt") == std::string("\xFF\xFE") + le_body + std::string{'B', '\x00'},
                  "UTF-16LE bytes rewritten with the mark");
            check(saved.at("encoding") == "utf-16le", "the save reports the encoding");
            expect_error("ENCODING_MISMATCH", [&] { workspace.read("utf16odd.txt"); });
        });

        run("unencodable text and unknown encodings are refused", [&] {
            put(root / "codepage.txt", "plain");
            const auto text = workspace.read("codepage.txt");
            const auto version = text.at("version").get<std::string>();
            // U+03A9 has no CP1252 byte; WideCharToMultiByte would quietly emit '?'.
            expect_error("ENCODING_LOSS", [&] { workspace.write("codepage.txt", utf8(u8"Ω"), version, "cp1252", false); });
            check(get(root / "codepage.txt") == "plain", "a refused save left the file untouched");
            expect_error("INVALID_ENCODING", [&] { workspace.read("codepage.txt", "ucs2"); });
            check(workspace.write("codepage.txt", "sys", version, "system", false).at("encoding") == "system",
                  "the system code page is selectable");
            check(get(root / "codepage.txt") == "sys", "ASCII round-trips through the system code page");
        });

        run("known SHA256 and empty content", [&] {
            put(root / "hash.txt", "abc");
            const auto abc = workspace.read("hash.txt");
            check(abc.at("version") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                  "SHA256 abc test vector");
            const auto empty = workspace.write("hash.txt", "", abc.at("version").get<std::string>());
            check(empty.at("version") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                  "SHA256 empty test vector");
            check(empty.at("bytes") == 0 && get(root / "hash.txt").empty(), "Empty files can be saved");
        });

        run("external edits cause CONFLICT without overwrite", [&] {
            put(root / "conflict.txt", "initial");
            const auto stale = workspace.read("conflict.txt").at("version").get<std::string>();
            put(root / "conflict.txt", "external edit");
            const auto entries = workspace.list("");
            expect_error("CONFLICT", [&] { workspace.write("conflict.txt", "editor edit", stale); });
            check(get(root / "conflict.txt") == "external edit", "Conflict must preserve external changes");
            check(workspace.list("") == entries, "Conflict must not leave temporary files");
            const std::string binary_change("external\0edit", 13);
            put(root / "conflict.txt", binary_change);
            expect_error("CONFLICT", [&] { workspace.write("conflict.txt", "editor edit", stale); });
            check(get(root / "conflict.txt") == binary_change, "Binary external changes must not be overwritten");
        });

        run("all APIs reject traversal absolute drive ADS and malformed paths", [&] {
            const std::vector<std::string> invalid{
                "../outside/secret.txt", "../" + path_text(root.filename()) + "/a.txt",
                "a-dir/../../outside/secret.txt", "a-dir/../a.txt", "..\\outside\\secret.txt",
                path_text(outside / "secret.txt"), "/absolute", "\\rooted", "C:relative", "C:/absolute",
                "\\\\server\\share\\file", "\\\\?\\C:\\file", "a.txt:secret", "a.txt::$DATA",
                "CON", "NUL.txt", "COM1", "a.txt.", "a.txt ", "wild*card", "question?",
                std::string("a.txt\0ignored", 13), std::string("bad\xC0\xAF", 5)
            };
            for (const auto& path : invalid) {
                expect_error("INVALID_PATH", [&] { workspace.list(path); });
                expect_error("INVALID_PATH", [&] { workspace.read(path); });
                expect_error("INVALID_PATH", [&] { workspace.write(path, "unsafe", "stale"); });
            }
            check(get(outside / "secret.txt") == "outside-original", "Outside file must remain untouched");
        });

        run("binary and invalid UTF-8 are rejected without changing files", [&] {
            put(root / "binary.bin", std::string("hello\0world", 11));
            expect_error("BINARY_FILE", [&] { workspace.read("binary.bin"); });
            put(root / "valid.txt", "valid");
            const auto version = workspace.read("valid.txt").at("version").get<std::string>();
            expect_error("BINARY_FILE", [&] { workspace.write("valid.txt", std::string("x\0y", 3), version); });
            const std::vector<std::string> invalid{
                "\xC0\xAF", "\xED\xA0\x80", "\xF4\x90\x80\x80", "\xE2\x82", "\x80", "\xFE"
            };
            for (const auto& bytes : invalid) {
                put(root / "invalid.txt", bytes);
                expect_error("INVALID_UTF8", [&] { workspace.read("invalid.txt"); });
                expect_error("INVALID_UTF8", [&] { workspace.write("valid.txt", bytes, version); });
                check(get(root / "valid.txt") == "valid", "Invalid saves must leave original bytes intact");
            }
            const std::string four_byte = "\xF0\x90\x80\x80";
            put(root / "unicode.txt", four_byte);
            check(workspace.read("unicode.txt").at("content") == four_byte, "Valid four-byte UTF-8 must work");
        });

        run("16 MiB inclusive read and write limit", [&] {
            const std::string limit(max_bytes, 'a');
            const std::string oversized(max_bytes + 1, 'b');
            put(root / "limit.txt", limit);
            const auto before = workspace.read("limit.txt");
            check(before.at("content").get<std::string>().size() == max_bytes, "Exactly 16 MiB must be readable");
            const auto saved = workspace.write("limit.txt", limit, before.at("version").get<std::string>());
            check(saved.at("bytes").get<std::size_t>() == max_bytes, "Exactly 16 MiB must be writable");
            expect_error("FILE_TOO_LARGE", [&] {
                workspace.write("limit.txt", oversized, saved.at("version").get<std::string>());
            });
            check(get(root / "limit.txt") == limit, "Oversized write must not damage original");
            put(root / "large.txt", oversized);
            expect_error("FILE_TOO_LARGE", [&] { workspace.read("large.txt"); });
            expect_error("FILE_TOO_LARGE", [&] { workspace.write("large.txt", "small", "unknown"); });
        });

        run("only existing regular files may be saved", [&] {
            expect_error("NOT_FOUND", [&] { workspace.read("missing.txt"); });
            expect_error("NOT_FOUND", [&] { workspace.write("missing.txt", "new", ""); });
            check(!fs::exists(root / "missing.txt"), "Write must not create a new target");
            expect_error("NOT_FILE", [&] { workspace.read("a-dir"); });
            expect_error("NOT_FILE", [&] { workspace.write("a-dir", "new", ""); });
            expect_error("NOT_FILE", [&] { workspace.read(""); });
            expect_error("NOT_FILE", [&] { workspace.write(".", "new", ""); });
            expect_error("NOT_DIRECTORY", [&] { workspace.list("a.txt"); });
        });

        run("ReplaceFileW failure preserves original and cleans owned temporaries", [&] {
            put(root / "locked.txt", "keep original");
            const auto version = workspace.read("locked.txt").at("version").get<std::string>();
            const auto entries = workspace.list("");
            NativeHandle blocker{CreateFileW((root / "locked.txt").c_str(), GENERIC_READ,
                                              FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
                                              FILE_ATTRIBUTE_NORMAL, nullptr)};
            check(blocker.handle != INVALID_HANDLE_VALUE, "Cannot open delete-sharing blocker");
            expect_error("FILE_BUSY", [&] { workspace.write("locked.txt", "do not commit", version); });
            check(get(root / "locked.txt") == "keep original", "Failed replacement must preserve original");
            check(workspace.list("") == entries, "Failed replacement must clean its temporary files");
        });

        run("failed open retains previous workspace", [&] {
            const auto entries = workspace.list("");
            expect_error("NOT_FOUND", [&] { workspace.open(temporary.path / "does-not-exist"); });
            expect_error("NOT_DIRECTORY", [&] { workspace.open(root / "a.txt"); });
            expect_error("INVALID_PATH", [&] { workspace.open(fs::path{}); });
            check(workspace.is_open() && workspace.list("") == entries, "Failed open must retain previous state");
            check(workspace.read("a.txt").at("content") == "a", "Failed open must not switch root");
        });

        run("2000 entry limit is explicit and open is transactional", [&] {
            const auto crowded = root / "crowded";
            fs::create_directory(crowded);
            for (unsigned i = 0; i < 2000; ++i) put(crowded / (std::to_string(i) + ".txt"), "");
            check(workspace.list("crowded").size() == 2000, "Exactly 2000 entries are allowed");
            put(crowded / "overflow.txt", "");
            expect_error("TOO_MANY_ENTRIES", [&] { workspace.list("crowded"); });
            expect_error("TOO_MANY_ENTRIES", [&] { workspace.open(crowded); });
            check(workspace.read("a.txt").at("content") == "a", "Listing failure during open must preserve old root");
            check(workspace.open(root).at("root") == opened_root, "Root must remain consistent");
        });

        run("symlinks never expose internal or external targets", [&] {
            const auto external_link = root / "external-link";
            if (make_symlink(external_link, outside, true)) {
                check(!contains(workspace.list(""), "external-link"), "Directory links must be skipped");
                expect_error("REPARSE_POINT", [&] { workspace.list("external-link"); });
                expect_error("REPARSE_POINT", [&] { workspace.read("external-link/secret.txt"); });
                expect_error("REPARSE_POINT", [&] { workspace.write("external-link/secret.txt", "unsafe", "old"); });
                expect_error("REPARSE_POINT", [&] { workspace.open(external_link); });
                check(workspace.read("a.txt").at("content") == "a", "Rejected link open must retain workspace");
            }
            if (make_symlink(root / "internal-link", root / "a-dir", true)) {
                expect_error("REPARSE_POINT", [&] { workspace.list("internal-link"); });
                check(!contains(workspace.list(""), "internal-link"), "Even in-root links must be skipped");
            }
            if (make_symlink(root / "file-link.txt", outside / "secret.txt", false)) {
                check(!contains(workspace.list(""), "file-link.txt"), "File links must be skipped");
                expect_error("REPARSE_POINT", [&] { workspace.read("file-link.txt"); });
                expect_error("REPARSE_POINT", [&] { workspace.write("file-link.txt", "unsafe", "old"); });
            }
            check(get(outside / "secret.txt") == "outside-original", "Symlink targets must remain unchanged");
        });

        run("file create, rename and delete stay confined to the root", [&] {
            check(workspace.create("created.txt", false).at("directory").get<bool>() == false, "create returns file kind");
            check(fs::exists(root / "created.txt"), "created file exists on disk");
            check(get(root / "created.txt").empty(), "a created file starts empty");
            check(contains(workspace.list(""), "created.txt"), "the new file appears in the listing");
            workspace.create("newdir", true);
            check(fs::is_directory(root / "newdir"), "created directory exists");
            expect_error("EXISTS", [&] { workspace.create("created.txt", false); });
            expect_error("EXISTS", [&] { workspace.create("newdir", true); });
            expect_error("INVALID_PATH", [&] { workspace.create("../escaped.txt", false); });
            expect_error("INVALID_PATH", [&] { workspace.create("C:/absolute.txt", false); });
            expect_error("INVALID_PATH", [&] { workspace.create("", false); });

            put(root / "rensrc.txt", "payload");
            check(workspace.rename("rensrc.txt", "rendst.txt").at("renamed").get<bool>() == true, "rename reports success");
            check(!fs::exists(root / "rensrc.txt"), "rename removed the source");
            check(get(root / "rendst.txt") == "payload", "rename preserved the content");
            expect_error("EXISTS", [&] { workspace.rename("rendst.txt", "created.txt"); });
            expect_error("NOT_FOUND", [&] { workspace.rename("missing.txt", "whatever.txt"); });
            expect_error("INVALID_PATH", [&] { workspace.rename("rendst.txt", "../out.txt"); });

            workspace.remove("created.txt");
            check(!fs::exists(root / "created.txt"), "deleted file is gone");
            workspace.remove("newdir");
            check(!fs::exists(root / "newdir"), "an empty directory can be deleted");
            // IDEA's $Delete removes a populated directory tree after its confirm
            // dialog, so remove() recurses (reparse points still refused elsewhere).
            fs::create_directories(root / "nonempty" / "nested");
            put(root / "nonempty" / "inner.txt", "x");
            put(root / "nonempty" / "nested" / "deep.txt", "y");
            workspace.remove("nonempty");
            check(!fs::exists(root / "nonempty"), "a populated directory tree is removed");
            expect_error("NOT_FOUND", [&] { workspace.remove("gone.txt"); });
            expect_error("INVALID_PATH", [&] { workspace.remove(".."); });
        });

        run("copy duplicates files and directory trees inside the root", [&] {
            put(root / "copysrc.txt", "copy me");
            check(workspace.copy("copysrc.txt", "copydst.txt").at("copied").get<bool>() == true, "copy reports success");
            check(get(root / "copydst.txt") == "copy me", "the copy carries the content");
            check(fs::exists(root / "copysrc.txt"), "the source survives a copy");
            expect_error("EXISTS", [&] { workspace.copy("copysrc.txt", "copydst.txt"); });
            expect_error("NOT_FOUND", [&] { workspace.copy("missing.txt", "nowhere.txt"); });
            expect_error("INVALID_PATH", [&] { workspace.copy("copysrc.txt", "../outside.txt"); });

            fs::create_directories(root / "treecopy" / "inner");
            put(root / "treecopy" / "top.txt", "T");
            put(root / "treecopy" / "inner" / "deep.txt", "D");
            workspace.copy("treecopy", "treecopy-clone");
            check(get(root / "treecopy-clone" / "top.txt") == "T", "tree copy keeps nested files");
            check(get(root / "treecopy-clone" / "inner" / "deep.txt") == "D", "tree copy recurses");
            check(fs::is_directory(root / "treecopy" / "inner"), "the source tree survives");

            // A read-only source must still produce a writable copy (IDEA's paste).
            put(root / "ro-src.txt", "locked");
            workspace.set_read_only("ro-src.txt", true);
            workspace.copy("ro-src.txt", "ro-dst.txt");
            check((GetFileAttributesW((root / "ro-dst.txt").c_str()) & FILE_ATTRIBUTE_READONLY) == 0,
                  "a copied file never inherits the read-only bit");
        });

        run("read-only attribute round-trips through read and file.readOnly", [&] {
            put(root / "locked.txt", "content");
            check(workspace.read("locked.txt").at("readOnly").get<bool>() == false, "a fresh file is writable");
            check(workspace.set_read_only("locked.txt", true).at("readOnly").get<bool>() == true, "toggle reports the new state");
            check((GetFileAttributesW((root / "locked.txt").c_str()) & FILE_ATTRIBUTE_READONLY) != 0, "the attribute is on disk");
            check(workspace.read("locked.txt").at("readOnly").get<bool>() == true, "read surfaces the flag for the editor");
            // Save still works at the OS level (ReplaceFileW clears the flag); IDEA, not
            // the host, is what blocks editing a read-only buffer.
            const auto version = workspace.read("locked.txt").at("version").get<std::string>();
            workspace.write("locked.txt", "edited", version);
            check(get(root / "locked.txt") == "edited", "write replaced the content");
            check(workspace.set_read_only("locked.txt", false).at("readOnly").get<bool>() == false, "toggle back to writable");
            expect_error("INVALID_PATH", [&] { workspace.set_read_only("../outside.txt", true); });
            expect_error("NOT_FOUND", [&] { workspace.set_read_only("missing.txt", true); });
        });

        run("line separators convert on disk with version and read-only guards", [&] {
            // The caller passes the LF-joined editor buffer, like CodeMirror's doc.
            put(root / "crlf.txt", "a\r\nb\r\n");
            const auto doc = workspace.read("crlf.txt");
            check(doc.at("content").get<std::string>() == "a\r\nb\r\n", "read keeps the CRLF bytes");
            const auto to_lf = workspace.convert_line_separators("crlf.txt", "lf", "a\nb\n", doc.at("version").get<std::string>());
            check(to_lf.at("changed").get<bool>() == true, "conversion reports a change");
            check(get(root / "crlf.txt") == "a\nb\n", "the file now uses LF");
            const auto again = workspace.read("crlf.txt");
            check(workspace.convert_line_separators("crlf.txt", "lf", "a\nb\n", again.at("version").get<std::string>()).at("changed").get<bool>() == false,
                  "an already-converted file changes nothing");
            check(again.at("version").get<std::string>() == to_lf.at("version").get<std::string>(), "no-op keeps the version");
            expect_error("CONFLICT", [&] { workspace.convert_line_separators("crlf.txt", "crlf", "a\nb\n", "stale"); });
            expect_error("INVALID_SETTINGS", [&] { workspace.convert_line_separators("crlf.txt", "mac", "a\nb\n", "whatever"); });
            expect_error("INVALID_PATH", [&] { workspace.convert_line_separators("../out.txt", "lf", "x", "v"); });
            workspace.set_read_only("crlf.txt", true);
            expect_error("READ_ONLY", [&] { workspace.convert_line_separators("crlf.txt", "crlf", "a\nb\n", again.at("version").get<std::string>()); });
            workspace.set_read_only("crlf.txt", false);
            const auto back = workspace.convert_line_separators("crlf.txt", "crlf", "a\nb\n", again.at("version").get<std::string>());
            check(back.at("changed").get<bool>() == true, "converting back reports a change");
            check(get(root / "crlf.txt") == "a\r\nb\r\n", "converting back restores CRLF");
            // The rewrite is a save of the buffer: UTF-8 bytes with the new endings.
            const auto gbk_text = std::string("\xC4\xE3\xBA\xC3\r\n\xCA\xC0\xBD\xE7\r\n", 12);  // 你好 / 世界 in GBK
            put(root / "gbk.txt", gbk_text);
            const auto gbk = workspace.read("gbk.txt", "gbk");
            check(gbk.at("encoding") == "gbk", "the fixture reads as GBK on request");
            const auto gbk_lf = workspace.convert_line_separators("gbk.txt", "lf", gbk.at("content").get<std::string>(), gbk.at("version").get<std::string>());
            check(gbk_lf.at("changed").get<bool>() == true, "GBK conversion changes bytes");
            check(get(root / "gbk.txt") == "\xE4\xBD\xA0\xE5\xA5\xBD\n\xE4\xB8\x96\xE7\x95\x8C\n", "the buffer is written back as UTF-8 with LF");
            const auto reread = workspace.read("gbk.txt", "utf-8");
            check(reread.at("content").get<std::string>().find('\n') != std::string::npos &&
                      reread.at("content").get<std::string>().find('\r') == std::string::npos,
                  "re-read shows LF-only lines");
        });
    } catch (const std::exception& error) {
        ++failures;
        std::cerr << "FAIL setup: " << error.what() << '\n';
    }
    std::cout << passed << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
