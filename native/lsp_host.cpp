#include "lsp_host.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <cstddef>
#include <memory>
#include <string>
#include <vector>

namespace taocode {
namespace lsp {

struct Host::Pipe {
    HANDLE stdin_write = nullptr;    // we write requests to the server
    HANDLE stdout_read = nullptr;    // we read responses from the server
    HANDLE process = nullptr;
    HANDLE thread = nullptr;
};

Host::Host() : client_([this](std::string_view frame) { write_frame(frame); }) {}

Host::~Host() { stop(); }

void Host::write_frame(std::string_view frame) {
    if (!pipe_ || !pipe_->stdin_write || pipe_->stdin_write == INVALID_HANDLE_VALUE) return;
    const char* data = frame.data();
    std::size_t remaining = frame.size();
    while (remaining) {
        const auto chunk = remaining > DWORD(1) << 20 ? (DWORD(1) << 20) : static_cast<DWORD>(remaining);
        DWORD written = 0;
        if (!WriteFile(pipe_->stdin_write, data, chunk, &written, nullptr) || !written) return;
        data += written;
        remaining -= written;
    }
}

void Host::start(const Spec& spec, Json initialize_params, Ready on_ready) {
    std::lock_guard lock(io_mutex_);
    if (alive_) return;

    SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE stdin_read = nullptr, stdout_write = nullptr;
    pipe_ = std::make_unique<Pipe>();
    if (!CreatePipe(&stdin_read, &pipe_->stdin_write, &inheritable, 0)) throw WorkspaceError("LSP_SPAWN", "无法创建标准输入管道");
    if (!CreatePipe(&pipe_->stdout_read, &stdout_write, &inheritable, 0)) { CloseHandle(stdin_read); CloseHandle(pipe_->stdin_write); pipe_.reset(); throw WorkspaceError("LSP_SPAWN", "无法创建标准输出管道"); }

    // A command line is required by CreateProcessW; build it from the executable plus arguments.
    std::wstring command = L"\"" + spec.executable.native() + L"\"";
    for (const auto& argument : spec.arguments) command += L" " + argument;
    std::vector<wchar_t> mutable_command(command.begin(), command.end());
    mutable_command.push_back(L'\0');

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = stdin_read;
    startup.hStdOutput = stdout_write;
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION info{};
    const auto working = spec.working_directory.empty() ? nullptr : spec.working_directory.c_str();
    const BOOL created = CreateProcessW(spec.executable.c_str(), mutable_command.data(), nullptr, nullptr, TRUE,
                                        CREATE_NO_WINDOW, nullptr, working, &startup, &info);
    CloseHandle(stdin_read);
    CloseHandle(stdout_write);
    if (!created) {
        const auto error = GetLastError();
        CloseHandle(pipe_->stdin_write);
        CloseHandle(pipe_->stdout_read);
        pipe_.reset();
        throw WorkspaceError("LSP_SPAWN", "无法启动语言服务器（Windows 错误 " + std::to_string(error) + "）");
    }
    pipe_->process = info.hProcess;
    pipe_->thread = info.hThread;

    alive_ = true;
reader_ = std::thread([this]() {
        std::vector<char> buffer(16384);
        MessageReader stream;
        for (;;) {
            DWORD available = 0;
            if (!PeekNamedPipe(pipe_->stdout_read, nullptr, 0, nullptr, &available, nullptr)) break;
            if (!available) {
                if (!alive_) break;
                Sleep(2);
                continue;
            }
            const auto want = available > buffer.size() ? buffer.size() : available;
            DWORD got = 0;
            if (!ReadFile(pipe_->stdout_read, buffer.data(), static_cast<DWORD>(want), &got, nullptr) || !got) break;
            try {
                std::lock_guard io(io_mutex_);
                stream.feed({buffer.data(), got});
                while (const auto message = stream.next()) client_.receive(*message);
            } catch (const WorkspaceError&) {
                // A malformed frame aborts the reader. Lock order matters: io_mutex_
                // is released by this scope before fail_pending acquires client.mutex_.
                break;
            }
        }
        // The server pipe went EOF (server exited) or we hit a protocol error.
        // Mark the host dead so subsequent requests fail with a clear error rather
        // than silently dropping their write.
        alive_ = false;
        client_.fail_pending("LSP_CLOSED");
    });

    client_.start(std::move(initialize_params), [handler = std::move(on_ready)](Json result, Json error) {
        // Runs on the reader thread; it must never tear the host down itself.
        // The caller observes the error and calls stop() from its own thread.
        handler(std::move(result), std::move(error));
    });
}

void Host::stop() noexcept {
    bool was_alive;
    {
        std::lock_guard lock(io_mutex_);
        was_alive = alive_;
        alive_ = false;
    }
    if (reader_.joinable()) reader_.join();
    std::lock_guard lock(io_mutex_);
    if (pipe_) {
        if (pipe_->stdin_write) CloseHandle(pipe_->stdin_write);
        if (pipe_->stdout_read) CloseHandle(pipe_->stdout_read);
        if (was_alive && pipe_->process) {
            // Give the server a moment to exit on its own after the pipes closed, then reclaim it.
            WaitForSingleObject(pipe_->process, 2000);
            if (WaitForSingleObject(pipe_->process, 0) == WAIT_TIMEOUT) TerminateProcess(pipe_->process, 0);
        }
        if (pipe_->process) CloseHandle(pipe_->process);
        if (pipe_->thread) CloseHandle(pipe_->thread);
        pipe_.reset();
    }
}

void Host::set_configuration(Json settings) {
    std::lock_guard lock(io_mutex_);
    client_.set_configuration(std::move(settings));
}

void Host::set_diagnostics(Client::Notify handler) {
    std::lock_guard lock(io_mutex_);
    client_.on_diagnostics(std::move(handler));
}

void Host::did_open(std::string uri, std::string language_id, int version, std::string text) {
    std::lock_guard lock(io_mutex_);
    if (alive_) client_.did_open(uri, language_id, version, text);
}

void Host::did_change(std::string uri, int version, std::string full_text) {
    std::lock_guard lock(io_mutex_);
    if (alive_) client_.did_change(uri, version, full_text);
}

void Host::did_close(std::string uri) {
    std::lock_guard lock(io_mutex_);
    if (alive_) client_.did_close(uri);
}

void Host::request(std::string_view method, Json params, Client::Handler on_result) {
    std::lock_guard lock(io_mutex_);
    if (!alive_) { on_result(Json(nullptr), Json{{"code", -32001}, {"message", "Language server is not running"}}); return; }
    client_.request(method, std::move(params), std::move(on_result));
}

}  // namespace lsp
}  // namespace taocode
