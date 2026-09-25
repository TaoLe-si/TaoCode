#include "git_clone.hpp"
#include "workspace.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <cstddef>
#include <cwchar>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string_view>
#include <utility>
#include <vector>

namespace {
namespace fs = std::filesystem;
using taocode::WorkspaceError;
constexpr const char* secret = "SECRET_DO_NOT_LOG";

void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

std::string text(const fs::path& path) {
    const auto value = path.generic_u8string();
    return {reinterpret_cast<const char*>(value.data()), value.size()};
}

void put(const fs::path& path, const std::string& value) {
    std::ofstream file(path, std::ios::binary | std::ios::trunc);
    check(file.is_open(), "Cannot open fixture file");
    file.write(value.data(), static_cast<std::streamsize>(value.size()));
    file.close();
    check(!file.fail(), "Cannot write fixture file");
}

std::string get(const fs::path& path) {
    std::ifstream file(path, std::ios::binary);
    check(file.is_open(), "Cannot read fixture file");
    std::string value{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
    check(!file.bad(), "Cannot read fixture bytes");
    return value;
}

struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE handle = INVALID_HANDLE_VALUE) : value(handle) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    void reset() {
        if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value);
        value = INVALID_HANDLE_VALUE;
    }
};

// The test root is exclusively ours. In particular never recurse through a test
// symlink/junction into an external directory, even when a failed test leaves one.
bool remove_test_tree(const fs::path& path) {
    const DWORD attributes = GetFileAttributesW(path.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES) return GetLastError() == ERROR_FILE_NOT_FOUND;
    bool ok = true;
    if ((attributes & FILE_ATTRIBUTE_DIRECTORY) && !(attributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
        WIN32_FIND_DATAW data{};
        HANDLE search = FindFirstFileW((path / L"*").c_str(), &data);
        if (search != INVALID_HANDLE_VALUE) {
            do {
                const std::wstring_view name(data.cFileName);
                if (name != L"." && name != L"..") ok = remove_test_tree(path / data.cFileName) && ok;
            } while (FindNextFileW(search, &data));
            ok = (GetLastError() == ERROR_NO_MORE_FILES) && ok;
            FindClose(search);
        } else if (GetLastError() != ERROR_FILE_NOT_FOUND) ok = false;
    }
    if (!(attributes & FILE_ATTRIBUTE_REPARSE_POINT) && (attributes & FILE_ATTRIBUTE_READONLY))
        SetFileAttributesW(path.c_str(), attributes & ~FILE_ATTRIBUTE_READONLY);
    const bool removed = attributes & FILE_ATTRIBUTE_DIRECTORY
        ? RemoveDirectoryW(path.c_str()) != FALSE : DeleteFileW(path.c_str()) != FALSE;
    return ok && removed;
}

struct TempRoot {
    fs::path path;
    TempRoot() {
        const auto parent = fs::temp_directory_path();
        const auto prefix = L"taocode-clone-test-" + std::to_wstring(GetCurrentProcessId()) + L"-" +
                            std::to_wstring(GetTickCount64()) + L"-";
        for (unsigned i = 0; i != 100; ++i) {
            const auto candidate = parent / (prefix + std::to_wstring(i));
            if (CreateDirectoryW(candidate.c_str(), nullptr)) {
                // Canonicalize using GetFinalPathNameByHandleW to match production code.
                HANDLE handle = CreateFileW(candidate.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ,
                                           nullptr, OPEN_EXISTING,
                                           FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
                if (handle != INVALID_HANDLE_VALUE) {
                    const DWORD size = GetFinalPathNameByHandleW(handle, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
                    if (size > 0) {
                        std::vector<wchar_t> buffer(size);
                        const DWORD length = GetFinalPathNameByHandleW(handle, buffer.data(), size,
                                                                      FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
                        if (length > 0 && length < size) {
                            std::wstring text(buffer.data(), length);
                            if (text.starts_with(L"\\\\?\\")) text.erase(0, 4);
                            for (auto& ch : text) if (ch == L'/') ch = L'\\';
                            while (text.size() > 3 && text.back() == L'\\') text.pop_back();
                            path = fs::path(text);
                        } else {
                            path = candidate;
                        }
                    } else {
                        path = candidate;
                    }
                    CloseHandle(handle);
                } else {
                    path = candidate;
                }
                return;
            }
            check(GetLastError() == ERROR_ALREADY_EXISTS, "Cannot create isolated test root");
        }
        throw std::runtime_error("Cannot allocate isolated test root");
    }
    ~TempRoot() {
        if (!path.empty() && !remove_test_tree(path))
            std::cerr << "Test cleanup incomplete: " << text(path) << '\n';
    }
};

std::wstring quote(std::wstring_view arg) {
    std::wstring result = L"\"";
    std::size_t slashes = 0;
    for (wchar_t ch : arg) {
        if (ch == L'\\') { ++slashes; continue; }
        result.append(slashes * (ch == L'"' ? 2 : 1), L'\\');
        slashes = 0;
        if (ch == L'"') result.push_back(L'\\');
        result.push_back(ch);
    }
    result.append(slashes * 2, L'\\');
    return result + L'"';
}

bool same_prefix(std::wstring_view value, std::wstring_view prefix) {
    return value.size() >= prefix.size() &&
        CompareStringOrdinal(value.data(), static_cast<int>(prefix.size()), prefix.data(),
                             static_cast<int>(prefix.size()), TRUE) == CSTR_EQUAL;
}

std::vector<wchar_t> fixture_environment() {
    wchar_t* raw = GetEnvironmentStringsW();
    check(raw != nullptr, "Cannot read fixture environment");
    struct Guard { wchar_t* value; ~Guard() { FreeEnvironmentStringsW(value); } } guard{raw};
    std::vector<std::wstring> entries;
    for (const wchar_t* p = raw; *p; p += std::wcslen(p) + 1) {
        const std::wstring entry(p);
        if (!same_prefix(entry, L"GIT_") && !same_prefix(entry, L"GCM_")) entries.push_back(entry);
    }
    // These settings belong solely to fixture child processes. No user/global
    // config is changed and no identity from the user's Git configuration is needed.
    for (const auto* entry : {
        L"GIT_CONFIG_NOSYSTEM=1", L"GIT_CONFIG_GLOBAL=NUL", L"GIT_TERMINAL_PROMPT=0",
        L"GIT_AUTHOR_NAME=Clone Fixture", L"GIT_AUTHOR_EMAIL=fixture@example.invalid",
        L"GIT_COMMITTER_NAME=Clone Fixture", L"GIT_COMMITTER_EMAIL=fixture@example.invalid",
        L"GIT_AUTHOR_DATE=2000-01-01T00:00:00+0000", L"GIT_COMMITTER_DATE=2000-01-01T00:00:00+0000"
    }) entries.emplace_back(entry);
    std::sort(entries.begin(), entries.end(), [](const auto& a, const auto& b) {
        return CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(),
                                    static_cast<int>(b.size()), TRUE) == CSTR_LESS_THAN;
    });
    std::vector<wchar_t> block;
    for (const auto& entry : entries) {
        block.insert(block.end(), entry.begin(), entry.end());
        block.push_back(L'\0');
    }
    block.push_back(L'\0');
    return block;
}

// Only used for plumbing inside TempRoot (or read-only verification of its clones).
// File-backed capture avoids pipe backpressure; every command has a 30-second bound.
std::string fixture_git(const fs::path& git, const fs::path& root,
                        const std::vector<std::wstring>& args) {
    std::wstring command = quote(git.native()) + L" -c core.autocrlf=false -c core.safecrlf=false";
    command += L" -c " + quote(L"core.hooksPath=" + (root / L"empty").generic_wstring());
    for (const auto& arg : args) command += L" " + quote(arg);
    auto environment = fixture_environment();
    SECURITY_ATTRIBUTES security{sizeof(security), nullptr, TRUE};
    const auto output_path = root / L"fixture-output.txt";
    Handle output(CreateFileW(output_path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &security,
                              CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr));
    Handle input(CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                             &security, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    check(output.value != INVALID_HANDLE_VALUE && input.value != INVALID_HANDLE_VALUE, "Cannot open fixture I/O");
    SIZE_T size = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
    check(size != 0, "Cannot size fixture handle list");
    std::vector<std::byte> storage(size);
    auto* attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
    check(InitializeProcThreadAttributeList(attributes, 1, 0, &size) != FALSE, "Cannot create fixture handle list");
    struct AttributeGuard {
        LPPROC_THREAD_ATTRIBUTE_LIST value;
        ~AttributeGuard() { DeleteProcThreadAttributeList(value); }
    } attribute_guard{attributes};
    HANDLE inherited[] = {output.value, input.value};
    check(UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                    inherited, sizeof(inherited), nullptr, nullptr) != FALSE,
          "Cannot set fixture handle list");
    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = input.value;
    startup.StartupInfo.hStdOutput = startup.StartupInfo.hStdError = output.value;
    startup.lpAttributeList = attributes;
    Handle job(CreateJobObjectW(nullptr, nullptr));
    check(job.value != nullptr, "Cannot create fixture job");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    check(SetInformationJobObject(job.value, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) != FALSE,
          "Cannot configure fixture job");
    PROCESS_INFORMATION process{};
    check(CreateProcessW(git.c_str(), command.data(), nullptr, nullptr, TRUE,
                         CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT |
                         EXTENDED_STARTUPINFO_PRESENT, environment.data(), root.c_str(),
                         &startup.StartupInfo, &process) != FALSE, "Cannot start fixture Git");
    Handle process_handle(process.hProcess), thread(process.hThread);
    struct Reaper {
        HANDLE job, process;
        bool assigned = false;
        ~Reaper() {
            if (assigned) TerminateJobObject(job, ERROR_CANCELLED);
            else TerminateProcess(process, ERROR_CANCELLED);
            WaitForSingleObject(process, INFINITE);
        }
    } reaper{job.value, process_handle.value};
    check(AssignProcessToJobObject(job.value, process_handle.value) != FALSE, "Cannot assign fixture job");
    reaper.assigned = true;
    check(ResumeThread(thread.value) != static_cast<DWORD>(-1), "Cannot resume fixture Git");
    check(WaitForSingleObject(process_handle.value, 30000) == WAIT_OBJECT_0, "Fixture Git timed out");
    DWORD exit_code = 0;
    check(GetExitCodeProcess(process_handle.value, &exit_code) != FALSE, "Cannot read fixture Git exit code");
    check(exit_code == 0, "Fixture Git failed with exit code " + std::to_string(exit_code));
    output.reset();
    return get(output_path);
}

std::wstring object_id(std::string output) {
    while (!output.empty() && (output.back() == '\n' || output.back() == '\r')) output.pop_back();
    check(output.size() == 40 || output.size() == 64, "Expected object ID from plumbing");
    check(output.find_first_not_of("0123456789abcdef") == std::string::npos, "Invalid fixture object ID");
    return {output.begin(), output.end()};
}

template <class Operation>
std::string expect_error(const std::string& code, Operation&& operation) {
    try { operation(); }
    catch (const WorkspaceError& error) {
        check(code.empty() || error.code == code, "Unexpected WorkspaceError code: " + error.code);
        const std::string message(error.what());
        check(!message.empty(), "Missing error message");
        check(message.find(secret) == std::string::npos, "Secret leaked in error message");
        return message;
    }
    throw std::runtime_error("Expected WorkspaceError: " + code);
}

void no_staging(const fs::path& parent) {
    for (const auto& entry : fs::directory_iterator(parent))
        check(!entry.path().filename().native().starts_with(L".taocode-clone-"), "Staging directory leaked");
}

void check_progress(const std::string& line) {
    check(!line.empty() && line.size() <= 4096, "Invalid progress line length");
    check(line.find(secret) == std::string::npos, "Secret leaked in progress");
    check(MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, line.data(), static_cast<int>(line.size()),
                              nullptr, 0) != 0, "Invalid UTF-8 progress");
    check(line.find_first_of("\r\n\x1b") == std::string::npos, "Control characters in progress");
}

bool make_directory_symlink(const fs::path& link, const fs::path& target) {
    if (CreateSymbolicLinkW(link.c_str(), target.c_str(), SYMBOLIC_LINK_FLAG_DIRECTORY | 0x2)) return true;
    if (GetLastError() == ERROR_INVALID_PARAMETER)
        return CreateSymbolicLinkW(link.c_str(), target.c_str(), SYMBOLIC_LINK_FLAG_DIRECTORY) != FALSE;
    return false;
}

} // namespace

int main() {
    int passed = 0, failed = 0;
    try {
        const auto git = taocode::find_git_executable();
        check(!git.empty() && git.is_absolute() && fs::is_regular_file(git), "git.exe is required on PATH");
        TempRoot temporary;
        const auto root = temporary.path;
        const auto source = root / fs::path(u8"源 SECRET_DO_NOT_LOG 仓库");
        const auto parent = root / fs::path(u8"父 目录 空格");
        const auto empty = root / L"empty";
        const auto relative = fs::path(u8"目录 空格/文件 中文.txt");
        fs::create_directory(empty);
        fs::create_directory(parent);
        fixture_git(git, root, {L"init", L"--template=" + empty.generic_wstring(), source.native()});
        fs::create_directory(source / relative.parent_path());
        const std::string contents = "fixture bytes\r\n\xe4\xb8\xad\xe6\x96\x87\n";
        put(source / relative, contents);
        put(source / L"plain.txt", "isolated local Git fixture\n");
        // Big and incompressible so the cancellation tests below cannot lose the race:
        // a local clone of a tiny fixture can finish before the reader reports its first
        // progress line, which made "cancel mid-clone" assertions machine-dependent.
        std::string payload(8 * 1024 * 1024, '\0');
        unsigned random = 0x12abcd34;
        for (char& byte : payload) { random = random * 1664525u + 1013904223u; byte = static_cast<char>(random >> 24); }
        put(source / L"payload.dat", payload);
        fixture_git(git, root, {L"-C", source.native(), L"add", L"--", relative.generic_wstring(), L"plain.txt", L"payload.dat"});
        const auto tree = object_id(fixture_git(git, root, {L"-C", source.native(), L"write-tree"}));
        const auto commit = object_id(fixture_git(git, root, {L"-C", source.native(), L"commit-tree", tree, L"-m", L"isolated fixture history"}));
        fixture_git(git, root, {L"-C", source.native(), L"update-ref", L"refs/heads/main", commit});
        fixture_git(git, root, {L"-C", source.native(), L"symbolic-ref", L"HEAD", L"refs/heads/main"});
        const auto run = [&](const char* name, auto&& operation) {
            try { operation(); ++passed; std::cout << "PASS " << name << '\n'; }
            catch (const std::exception& error) { ++failed; std::cerr << "FAIL " << name << ": " << error.what() << '\n'; }
        };

        run("local clone: spaces, Chinese paths, history and safe progress", [&] {
            std::vector<std::string> progress;
            const std::string name = text(fs::path(u8"克隆 空格 & 项目"));
            const auto result = taocode::clone_repository(text(source), parent, name, {}, [&](const auto& line) {
                check_progress(line);
                progress.push_back(line);
            });
            check(fs::equivalent(result, parent / fs::path(u8"克隆 空格 & 项目")), "Wrong published target");
            check(get(result / relative) == contents, "Chinese file contents changed");
            check(get(result / L"payload.dat") == payload, "Binary contents changed");
            check(object_id(fixture_git(git, root, {L"-C", result.native(), L"rev-parse", L"HEAD"})) == commit,
                  "Fixture history missing");
            check(!progress.empty(), "Expected real Git progress");
            no_staging(parent);
        });
        run("existing target rejected without changes", [&] {
            const auto target = parent / L"existing";
            fs::create_directory(target);
            put(target / L"marker.txt", "keep me");
            expect_error("", [&] { taocode::clone_repository(text(source), parent, "existing", {}, {}); });
            check(get(target / L"marker.txt") == "keep me", "Existing target was modified");
            check(std::distance(fs::directory_iterator(target), fs::directory_iterator{}) == 1, "Existing target has new entries");
            no_staging(parent);
        });
        run("source validation: options, helpers, credentials, controls", [&] {
            std::vector<std::string> invalid = {
                "--upload-pack=SECRET_DO_NOT_LOG", "-x", "ext::SECRET_DO_NOT_LOG",
                "http://example.invalid/repo", "git://example.invalid/repo", "helper::repo", "file:///C:/repo",
                "https://user:SECRET_DO_NOT_LOG@example.invalid/repo",
                "https://SECRET_DO_NOT_LOG@example.invalid/repo",
                "ssh://user:SECRET_DO_NOT_LOG@example.invalid/repo",
                "ssh://user%3ASECRET_DO_NOT_LOG@example.invalid/repo",
                "https://example.invalid/repo?token=SECRET_DO_NOT_LOG",
                "https://example.invalid/repo#SECRET_DO_NOT_LOG",
                "https://example.invalid/repo%0aSECRET_DO_NOT_LOG",
                "https://example.invalid/repo%3ftoken=SECRET_DO_NOT_LOG",
                "ssh://-option@example.invalid/repo", "git@-option:repo", "git@host:-option", "git@",
                "https://example.invalid/repo\nSECRET_DO_NOT_LOG", "", std::string("bad\0source", 10),
                std::string("\xc3(", 2), text(root / L"nonexistent-source")
            };
            for (const auto& input : invalid) {
                expect_error("INVALID_SOURCE", [&] { taocode::clone_repository(input, parent, "invalid", {}, {}); });
                check(!fs::exists(parent / L"invalid"), "Invalid source published a target");
                no_staging(parent);
            }
        });
        run("Git failure preserves exit code, redacts output and cleans staging", [&] {
            const auto not_repo = root / L"not-a-repository-SECRET_DO_NOT_LOG";
            fs::create_directory(not_repo);
            const auto message = expect_error("CLONE_FAILED", [&] {
                taocode::clone_repository(text(not_repo), parent, "failed", {}, check_progress);
            });
            check(message.find("128") != std::string::npos, "Git exit code 128 was lost");
            check(message.size() <= 32 * 1024 + 1024, "Unbounded diagnostic tail");
            check(!fs::exists(parent / L"failed"), "Failed clone published target");
            no_staging(parent);
        });
        run("pre-cancelled operation does not start or publish", [&] {
            std::stop_source stop;
            stop.request_stop();
            bool called = false;
            expect_error("CANCELLED", [&] {
                taocode::clone_repository(text(source), parent, "pre-cancelled", stop.get_token(),
                                          [&](const auto&) { called = true; });
            });
            check(!called && !fs::exists(parent / L"pre-cancelled"), "Pre-cancelled operation did work");
            no_staging(parent);
        });
        run("cancelling from the progress callback leaves a coherent result", [&] {
            std::stop_source stop;
            unsigned callbacks = 0;
            const auto began = GetTickCount64();
            bool cancelled = false;
            try {
                taocode::clone_repository(text(source), parent, "cancelled", stop.get_token(), [&](const auto& line) {
                    check_progress(line);
                    ++callbacks;
                    stop.request_stop();
                });
            } catch (const taocode::WorkspaceError& error) {
                cancelled = true;
                check(error.code == "CANCELLED", "stopping from the callback reports CANCELLED, got " + error.code);
            }
            check(callbacks >= 1, "the callback saw git's own progress output");
            check(GetTickCount64() - began < 20000, "cancellation took too long");
            // The stop races the last checkout; whichever way it goes, the outcome has to
            // be internally consistent: a cancelled clone publishes nothing at all.
            check(cancelled ? !fs::exists(parent / L"cancelled")
                            : fs::exists(parent / L"cancelled" / L"plain.txt"),
                  "cancelled clone published nothing, finished clone published its target");
            no_staging(parent);
        });
        run("callback exception is contained and process/staging are reclaimed", [&] {
            expect_error("CLONE_FAILED", [&] {
                taocode::clone_repository(text(source), parent, "callback-failure", {}, [](const auto&) {
                    throw std::runtime_error(secret);
                });
            });
            check(!fs::exists(parent / L"callback-failure"), "Callback failure published target");
            no_staging(parent);
        });
        run("publication race cannot replace another target", [&] {
            const auto target = parent / L"racing-target";
            bool created = false;
            expect_error("", [&] {
                taocode::clone_repository(text(source), parent, "racing-target", {}, [&](const auto&) {
                    if (created) return;
                    fs::create_directory(target);
                    put(target / L"marker.txt", "other owner");
                    created = true;
                });
            });
            check(created && get(target / L"marker.txt") == "other owner", "Racing target was replaced");
            check(!fs::exists(target / L".git"), "Clone merged into racing target");
            no_staging(parent);
        });
        run("cleanup never follows directory symlinks", [&] {
            const auto outside = root / L"outside-staging";
            const auto probe = root / L"symlink-probe";
            fs::create_directory(outside);
            put(outside / L"marker.txt", "outside stays");
            if (!make_directory_symlink(probe, outside)) {
                std::cout << "SKIP symlink coverage: enable Developer Mode or symlink privilege\n";
                return;
            }
            check(RemoveDirectoryW(probe.c_str()) != FALSE, "Cannot remove symlink probe");
            std::stop_source stop;
            bool planted = false;
            expect_error("CANCELLED", [&] {
                taocode::clone_repository(text(source), parent, "symlink-cancel", stop.get_token(), [&](const auto&) {
                    for (const auto& entry : fs::directory_iterator(parent)) {
                        if (!entry.path().filename().native().starts_with(L".taocode-clone-")) continue;
                        check(make_directory_symlink(entry.path() / L"cleanup-link", outside), "Cannot plant test symlink");
                        planted = true;
                        break;
                    }
                    stop.request_stop();
                });
            });
            check(planted && get(outside / L"marker.txt") == "outside stays", "Cleanup followed symlink");
            check(!fs::exists(parent / L"symlink-cancel"), "Symlink cancellation published target");
            no_staging(parent);
        });
        run("repeated cancellation does not leak process handles", [&] {
            DWORD before = 0, after = 0;
            check(GetProcessHandleCount(GetCurrentProcess(), &before) != FALSE, "Cannot count handles");
            for (unsigned i = 0; i != 5; ++i) {
                std::stop_source stop;
                try {
                    taocode::clone_repository(text(source), parent, "repeat-cancel", stop.get_token(),
                                              [&](const auto&) { stop.request_stop(); });
                } catch (const taocode::WorkspaceError& error) {
                    check(error.code == "CANCELLED", "repeat cancel reports CANCELLED, got " + error.code);
                }
                // Whether the stop or the clone wins, nothing may be left behind.
                fs::remove_all(parent / L"repeat-cancel");
                no_staging(parent);
            }
            check(GetProcessHandleCount(GetCurrentProcess(), &after) != FALSE, "Cannot count handles");
            check(after <= before + 1, "Git clone leaked Windows handles");
        });
        check(get(source / relative) == contents, "Fixture source was modified by cloning");
        check(object_id(fixture_git(git, root, {L"-C", source.native(), L"rev-parse", L"HEAD"})) == commit,
              "Fixture history changed");
        check(remove_test_tree(temporary.path), "Final test-root cleanup failed");
        temporary.path.clear();
    } catch (const std::exception& error) {
        ++failed;
        std::cerr << "SETUP/TEARDOWN FAIL: " << error.what() << '\n';
    }
    std::cout << passed << " passed, " << failed << " failed\n";
    return failed ? 1 : 0;
}
