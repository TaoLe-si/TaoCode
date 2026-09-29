// 项目层原生测试的共用夹具：临时根目录、文件读写、断言与用例登记。
//
// 为什么提出来：`projects_test.cpp`（项目/设置/最近项目/运行配置…）与
// `project_file_colors_test.cpp`（`.idea` 里两层文件颜色 XML）测的是**两个模块**，
// 共用的只是这些夹具。头文件是它们的唯一交集，放在这里两个测试目标都能包含。
#ifndef TAOCODE_PROJECT_TEST_SUPPORT_HPP
#define TAOCODE_PROJECT_TEST_SUPPORT_HPP

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

#include "projects.hpp"

namespace taocode::test {

namespace fs = std::filesystem;
using taocode::Json;
using taocode::ProjectStore;
using taocode::Workspace;
using taocode::WorkspaceError;
using taocode::create_project;
using taocode::project_destination;

inline std::string utf8(std::u8string_view value) {
    return {reinterpret_cast<const char*>(value.data()), value.size()};
}

inline std::string text(const fs::path& path) { return utf8(path.generic_u8string()); }
inline fs::path path_from(const std::string& value) { return fs::path(std::u8string(value.begin(), value.end())); }

inline void check(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

template <class Operation>
void expect_error(const std::string& code, Operation&& operation) {
    try {
        operation();
    } catch (const WorkspaceError& error) {
        check(error.code == code, "Expected " + code + ", got " + error.code + ": " + error.what());
        check(*error.what() != '\0', "WorkspaceError must explain its failure");
        return;
    }
    throw std::runtime_error("Expected WorkspaceError: " + code);
}

inline void put(const fs::path& path, const std::string& bytes) {
    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    check(stream.is_open(), "Cannot create test fixture: " + text(path));
    stream.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    stream.close();
    check(!stream.fail(), "Cannot write test fixture: " + text(path));
}

inline std::string get(const fs::path& path) {
    std::ifstream stream(path, std::ios::binary);
    check(stream.is_open(), "Cannot read test fixture: " + text(path));
    std::string result{std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>()};
    check(!stream.bad(), "Cannot read fixture bytes");
    return result;
}

inline std::vector<std::string> names(const fs::path& directory) {
    std::vector<std::string> result;
    for (const auto& entry : fs::directory_iterator(directory)) result.push_back(text(entry.path().filename()));
    std::sort(result.begin(), result.end());
    return result;
}

inline Json open_result(const fs::path& path) {
    Workspace workspace;
    return workspace.open(path);
}

/**
 * 临时根目录。路径经 `GetFinalPathNameByHandleW` 规范化，与生产代码取规范路径的方式一致 ——
 * 不这么做，临时目录的 8.3 短名会让「相对路径必须拒绝」这类断言随机失败。
 */
struct TempRoot {
    fs::path path;
    TempRoot() {
        const auto prefix = "taocode-projects-test-" + std::to_string(GetCurrentProcessId()) + "-" +
                            std::to_string(GetTickCount64()) + "-";
        for (unsigned attempt = 0; attempt != 100; ++attempt) {
            auto candidate = fs::temp_directory_path() / (prefix + std::to_string(attempt));
            std::error_code error;
            if (fs::create_directory(candidate, error)) {
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
                            std::wstring canonical(buffer.data(), length);
                            if (canonical.starts_with(L"\\\\?\\")) canonical.erase(0, 4);
                            for (auto& ch : canonical) if (ch == L'/') ch = L'\\';
                            while (canonical.size() > 3 && canonical.back() == L'\\') canonical.pop_back();
                            candidate = fs::path(canonical);
                        }
                    }
                    CloseHandle(handle);
                }
                path.swap(candidate);
                return;
            }
            if (error && error != std::errc::file_exists)
                throw std::runtime_error("Cannot create isolated temporary root: " + error.message());
        }
        throw std::runtime_error("Cannot allocate a temporary test directory");
    }
    ~TempRoot() {
        std::error_code error;
        fs::remove_all(path, error);
        if (error) std::cerr << "Cleanup failed for " << text(path) << ": " << error.message() << '\n';
    }
    TempRoot(const TempRoot&) = delete;
    TempRoot& operator=(const TempRoot&) = delete;
};

/** 占住一个文件句柄，用来制造 `FILE_BUSY`（共享冲突）。 */
struct NativeHandle {
    HANDLE value;
    ~NativeHandle() { if (value != INVALID_HANDLE_VALUE) CloseHandle(value); }
};

inline bool symlink(const fs::path& link, const fs::path& target, bool directory) {
    const DWORD flags = directory ? SYMBOLIC_LINK_FLAG_DIRECTORY : 0;
    if (CreateSymbolicLinkW(link.c_str(), target.c_str(), flags | 0x2)) return true;
    auto error = GetLastError();
    if (error == ERROR_INVALID_PARAMETER) {
        if (CreateSymbolicLinkW(link.c_str(), target.c_str(), flags)) return true;
        error = GetLastError();
    }
    std::cout << "SKIP symlink " << text(link.filename()) << " (Windows error " << error << ")\n";
    return false;
}

/** 用例登记：每个 `run` 就是一个断言组，失败不中断后面的用例。 */
class Report {
public:
    template <class Operation>
    void run(const char* name, Operation&& operation) {
        try {
            operation();
            ++passed_;
            std::cout << "PASS " << name << '\n';
        } catch (const std::exception& error) {
            ++failures_;
            std::cerr << "FAIL " << name << ": " << error.what() << '\n';
        }
    }
    int summary() const {
        std::cout << passed_ << " passed, " << failures_ << " failed\n";
        return failures_ == 0 ? 0 : 1;
    }

private:
    int passed_ = 0;
    int failures_ = 0;
};

} // namespace taocode::test

#endif
