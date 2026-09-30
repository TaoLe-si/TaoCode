#include "lsp_host.hpp"

#include "lsp_children.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace taocode {
namespace lsp {
namespace {

// 服务器两条管道都开 1MB：默认的 4KB 太容易被"不读 stdin 的服务器"（JDT LS 在导入大工程）
// 写满，而出站读侧（我们的读线程）也要靠它吸收服务器成批的结果帧。
constexpr DWORD kPipeBytes = 1u << 20;

// Quotes a command-line token the way CreateProcessW's own parser expects: an
// empty or space/tab-bearing argument has to arrive as one token.
std::wstring quote_argument(const std::wstring& value) {    if (!value.empty() && value.find_first_of(L" \t\"") == std::wstring::npos) return value;
    std::wstring quoted = L"\"";
    for (std::size_t i = 0; i != value.size(); ++i) {
        std::size_t backslashes = 0;
        while (i != value.size() && value[i] == L'\\') { ++backslashes; ++i; }
        if (i == value.size()) { quoted.append(backslashes * 2, L'\\'); break; }
        if (value[i] == L'"') quoted.append(backslashes * 2 + 1, L'\\');
        else quoted.append(backslashes, L'\\');
        quoted.push_back(value[i]);
    }
    quoted.push_back(L'"');
    return quoted;
}

// A kill-on-close job guarantees the server (and anything it spawned) is reaped
// when the IDE goes away: an orphaned clangd/jdtls holding a pipe open is the
// classic leak of this kind of integration. Same approach as native/runner.cpp.
HANDLE create_kill_job(HANDLE process) {
    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    if (!job) return nullptr;
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // Both calls are checked: a job that cannot be configured (or that refuses the
    // process) must not be reported as usable, or stop() would "kill" a job holding
    // nothing and leave the language server running.
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) ||
        !AssignProcessToJobObject(job, process)) {
        CloseHandle(job);
        return nullptr;  // stop() falls back to TerminateProcess on the handle
    }
    return job;
}

}  // namespace

struct Host::Pipe {
    HANDLE stdin_write = nullptr;    // we write requests to the server
    HANDLE stdout_read = nullptr;    // we read responses from the server
    HANDLE process = nullptr;
    HANDLE thread = nullptr;
    HANDLE job = nullptr;            // KILL_ON_JOB_CLOSE, so nothing is orphaned
};

namespace {
// Opens the trace file named by TAOCODE_LSP_TRACE, or returns null. One getenv +
// one fopen per Host, so a normal session pays nothing for this.
std::FILE* open_trace() {
    char* value = nullptr;
    size_t length = 0;
    if (_dupenv_s(&value, &length, "TAOCODE_LSP_TRACE") != 0 || value == nullptr) return nullptr;
    const std::string path(value, length > 0 ? length - 1 : 0);
    free(value);
    if (path.empty()) return nullptr;
    std::FILE* file = nullptr;
    if (fopen_s(&file, path.c_str(), "ab") != 0) return nullptr;
    return file;
}
}  // namespace

Host::Host() : client_([this](std::string_view frame) { enqueue_frame(frame); }), trace_(open_trace()) {}

Host::~Host() {
    stop();
    if (trace_) { std::fclose(static_cast<std::FILE*>(trace_)); trace_ = nullptr; }
}

void Host::enqueue_frame(std::string_view frame) {
    {
        std::lock_guard lock(outbox_mutex_);
        if (writer_stop_) return;  // 服务器已经收掉了，这一帧没有去处
        outbox_.emplace_back(frame);
    }
    outbox_cv_.notify_one();
}

// 一帧真正落到服务器 stdin 上（可能阻塞）。**只允许写线程调用**：它就是"调用方不会被
// 服务器的读速度卡住"的那条边界。
void Host::write_frame_now(std::string_view frame) {
    if (!pipe_ || !pipe_->stdin_write || pipe_->stdin_write == INVALID_HANDLE_VALUE) {
        if (trace_) {
            std::lock_guard lock(trace_mutex_);
            std::fprintf(static_cast<std::FILE*>(trace_), "WRITE-DROPPED no-pipe bytes=%zu\n", frame.size());
            std::fflush(static_cast<std::FILE*>(trace_));
        }
        return;
    }
    const char* data = frame.data();
    std::size_t remaining = frame.size();
    while (remaining) {
        const auto chunk = remaining > DWORD(1) << 20 ? (DWORD(1) << 20) : static_cast<DWORD>(remaining);
        DWORD written = 0;
        // 一次写超过 200ms 就是"服务器没在读它的 stdin"（管道满，WriteFile 阻塞）。
        // 记的是**写线程的线程 id**：它只挡出站帧，不再挡任何调用方 —— 出了这行就说明
        // 界面请求正在排队（它们现在只在入队上花时间，慢的是这一帧）。
        const auto write_started = std::chrono::steady_clock::now();
        if (!WriteFile(pipe_->stdin_write, data, chunk, &written, nullptr) || !written) {
            if (trace_) {
                std::lock_guard lock(trace_mutex_);
                std::fprintf(static_cast<std::FILE*>(trace_), "WRITE-FAILED err=%lu written=%lu remaining=%zu\n",
                             GetLastError(), written, remaining);
                std::fflush(static_cast<std::FILE*>(trace_));
            }
            return;  // 这一帧断了就丢：服务器侧已经解不成整帧，后面的帧各自完整还能用
        }
        const auto took = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - write_started).count();
        if (took >= 200 && slow_write_hook) slow_write_hook(GetCurrentThreadId(), static_cast<unsigned long>(took), chunk);
        data += written;
        remaining -= written;
    }
    if (trace_) {
        // The LSP header ends at the first CRLFCRLF; the body starts right after it.
        const auto separator = frame.find("\r\n\r\n");
        const auto header = frame.substr(0, separator == std::string_view::npos ? frame.size() : separator);
        const auto body = separator == std::string_view::npos ? std::string_view() : frame.substr(separator + 4);
        const auto marker = body.find("\"method\"");
        std::string name = "?";
        if (marker != std::string_view::npos) {
            const auto open = body.find('\"', marker + 8);
            const auto close = open == std::string_view::npos ? open : body.find('\"', open + 1);
            if (open != std::string_view::npos && close != std::string_view::npos)
                name = std::string(body.substr(open + 1, close - open - 1));
        }
        std::lock_guard lock(trace_mutex_);
        std::fprintf(static_cast<std::FILE*>(trace_), "WRITE method=%s header=[%.*s] bodybytes=%zu\n",
                     name.c_str(), static_cast<int>(header.size()), header.data(), body.size());
        std::fflush(static_cast<std::FILE*>(trace_));
    }
}

// 写线程：出站帧的唯一写出者。`WriteFile` 到不读 stdin 的服务器（大工程在导入/索引时
// 就是这样）会阻塞，阻塞的代价不能落在调用方身上 —— 那条唯一的语言服务线程一旦停在这里，
// `status`、诊断、补全、折叠全部排队，而界面上的表现只是"语言服务没有响应"（2026-09-30
// 在 3GB 工程上实测：宿主全程只发得出一次 initialize，握手完成后一个 didOpen 都没出去）。
// 换到本线程以后：调用方只入队（微秒级），真正慢的写也**不持有任何调用方的锁**。
// `pipe_` 不在这里加锁：它只在 start() 里建立、在 stop() 里关闭，而 stop() 会先 join 本线程。
void Host::pump_writes() {
    for (;;) {
        std::string frame;
        {
            std::unique_lock lock(outbox_mutex_);
            outbox_cv_.wait(lock, [this] { return writer_stop_ || !outbox_.empty(); });
            if (outbox_.empty()) {
                if (writer_stop_) return;
                continue;
            }
            frame = std::move(outbox_.front());
            outbox_.pop_front();
        }
        write_frame_now(frame);
    }
}
void Host::start(const Spec& spec, Json initialize_params, Ready on_ready) {
    std::lock_guard lock(io_mutex_);
    if (alive_) return;
    {
        // 同一台 Host 可以在 stop() 之后重新 start()：把上一次的收尾标记与残留帧清掉。
        std::lock_guard outbox(outbox_mutex_);
        writer_stop_ = false;
        outbox_.clear();
    }

    SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE stdin_read = nullptr, stdout_write = nullptr;
    pipe_ = std::make_unique<Pipe>();
    // CreatePipe 的 size=0 给的是默认 4KB。服务器在导入大工程时不读 stdin，4KB 立刻写满 ——
    // 1MB 让出站帧基本都能先落进管道（真正的保证是写线程，见 pump_writes）。
    if (!CreatePipe(&stdin_read, &pipe_->stdin_write, &inheritable, kPipeBytes)) throw WorkspaceError("LSP_SPAWN", "无法创建标准输入管道");
    if (!CreatePipe(&pipe_->stdout_read, &stdout_write, &inheritable, kPipeBytes)) { CloseHandle(stdin_read); CloseHandle(pipe_->stdin_write); pipe_.reset(); throw WorkspaceError("LSP_SPAWN", "无法创建标准输出管道"); }

    // One command line, and NO lpApplicationName: that is what makes CreateProcessW
    // run its normal search (PATH included), so a bare "clangd" / "pyright" /
    // "jdtls" the user merely has on PATH starts. An absolute path works the same
    // way because the first token is quoted.
    std::wstring command = quote_argument(spec.executable.native());
    for (const auto& argument : spec.arguments) command += L" " + quote_argument(argument);
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
    // CREATE_SUSPENDED so the child cannot spawn anything before it is inside the
    // kill-on-close job below.
    const BOOL created = CreateProcessW(nullptr, mutable_command.data(), nullptr, nullptr, TRUE,
                                        CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, working, &startup, &info);
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
    pipe_->job = create_kill_job(info.hProcess);
    // 登记这台进程：作业对象只在**句柄关闭**时才收进程，而弃养的一代永远不会走到那一步
    // （见 lsp_children.hpp）。stop() 会注销 —— 正常收尾走原来的 2s 优雅退出。
    children::register_child(generation_, pipe_->job, pipe_->process);
    ResumeThread(info.hThread);

    alive_ = true;
    // 写线程先起来，再开始读：出站帧（含 initialize）只入队，由它按序写出。
    writer_ = std::thread([this]() { pump_writes(); });
    reader_ = std::thread([this]() {
        std::vector<char> buffer(16384);
        MessageReader stream;
        std::vector<Json> batch;
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
            if (trace_) {
                // 读取侧只记字节数：帧内容由 MessageReader 解出来，原样 dump 只用于
                // 「服务器回了什么错误帧」这类一次性排查。
                std::lock_guard lock(trace_mutex_);
                std::fprintf(static_cast<std::FILE*>(trace_), "READ bytes=%lu\n", got);
                std::fflush(static_cast<std::FILE*>(trace_));
            }
            try {
                stream.feed({buffer.data(), got});
                // Frames are cut out under the lock; dispatching happens WITHOUT it.
                // Callbacks then run on this thread with no lock of ours held, which
                // is what lets a callback re-enter the Session (Session::mutex_ ->
                // io_mutex_) without deadlocking against a caller doing the reverse.
                {
                    std::lock_guard io(io_mutex_);
                    while (const auto message = stream.next()) batch.push_back(*message);
                }
                for (const auto& message : batch) client_.receive(message);
                batch.clear();
            } catch (const WorkspaceError&) {
                // A malformed frame aborts the reader rather than desynchronising.
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
    // 两个线程都在用 pipe_，而写线程可能正卡在 WriteFile 里（服务器不读 stdin）。先让它把
    // 队尾那几帧（`exit` 之类）发出去 —— 只等一小会儿，然后 CancelSynchronousIo 打断那次写，
    // 之后才轮到关句柄。被打断的那一帧只写出去半截：这台服务器马上就要被收掉，不碍事。
    {
        std::unique_lock lock(outbox_mutex_);
        outbox_cv_.wait_for(lock, std::chrono::milliseconds(300), [this] { return outbox_.empty(); });
        writer_stop_ = true;
        outbox_.clear();
    }
    outbox_cv_.notify_all();
    if (writer_.joinable()) {
        CancelSynchronousIo(writer_.native_handle());
        writer_.join();
    }
    if (reader_.joinable()) reader_.join();
    std::lock_guard lock(io_mutex_);
    if (pipe_) {
        if (pipe_->stdin_write) CloseHandle(pipe_->stdin_write);
        if (pipe_->stdout_read) CloseHandle(pipe_->stdout_read);
        if (was_alive && pipe_->process) {
            // Give the server a moment to exit on its own after the pipes closed,
            // then reclaim it — the job takes the whole tree with it.
            WaitForSingleObject(pipe_->process, 2000);
            if (WaitForSingleObject(pipe_->process, 0) == WAIT_TIMEOUT) {
                if (pipe_->job) TerminateJobObject(pipe_->job, 0);
                else TerminateProcess(pipe_->process, 0);
            }
        }
        if (pipe_->process) CloseHandle(pipe_->process);
        if (pipe_->thread) CloseHandle(pipe_->thread);
        // 这台自己收过尾就从登记表摘掉，别留给"弃养那一代"再收一次（句柄值可能已被系统复用）。
        children::unregister_child(pipe_->job);
        if (pipe_->job) CloseHandle(pipe_->job);
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

void Host::set_progress(Client::Notify handler) {
    std::lock_guard lock(io_mutex_);
    client_.on_progress(std::move(handler));
}

void Host::set_server_message(Client::Notify handler) {
    std::lock_guard lock(io_mutex_);
    client_.on_server_message(std::move(handler));
}

void Host::set_document_editor(Client::DocumentEditor editor) {
    std::lock_guard lock(io_mutex_);
    client_.set_document_editor(std::move(editor));
}

void Host::set_sync_kind(SyncKind kind) {
    std::lock_guard lock(io_mutex_);
    client_.set_sync_kind(kind);
}

void Host::set_timeout(std::chrono::milliseconds timeout) {
    std::lock_guard lock(io_mutex_);
    client_.set_timeout(timeout);
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

bool Host::is_superseding(std::string_view method) {
    // The caret moved: only the newest answer matters, and IDEA cancels the older one.
    return method == "textDocument/hover" || method == "textDocument/completion" ||
           method == "textDocument/signatureHelp" || method == "textDocument/documentHighlight";
}

std::int64_t Host::request(std::string_view method, Json params, Client::Handler on_result) {
    const std::string key(method);
    const bool supersede = is_superseding(method);
    std::int64_t stale = 0;
    if (supersede) {
        std::lock_guard lookup_lock(inflight_mutex_);
        const auto found = in_flight_.find(key);
        if (found != in_flight_.end()) stale = found->second;
    }
    // Deliberately outside io_mutex_: cancelling answers the previous caller, whose
    // handler may re-enter this host.
    if (stale) client_.cancel(stale);
    std::lock_guard lock(io_mutex_);
    if (!alive_) {
        on_result(Json(nullptr), Json{{"code", -32001}, {"message", "Language server is not running"}});
        return 0;
    }
    const auto id = client_.request(method, std::move(params), std::move(on_result));
    if (supersede) {
        std::lock_guard record_lock(inflight_mutex_);
        in_flight_[key] = id;
    }
    return id;
}

void Host::notify(std::string_view method, Json params) {
    // No reply is expected, so there is nothing to record and nothing to cancel:
    // only the pipe lock matters, so the frame cannot interleave with a request.
    std::lock_guard lock(io_mutex_);
    if (!alive_) return;
    client_.notify(method, std::move(params));
}

}  // namespace lsp
}  // namespace taocode
