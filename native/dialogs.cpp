// 宿主文件对话框与图片读取（见 dialogs.hpp 的判据与源码对照）。**从 main.cpp 搬出**。
#include "dialogs.hpp"

#include "base64.hpp"
#include "text.hpp"
#include <windows.h>
#include <wrl/client.h>
#include <shlobj.h>

#include <fstream>
#include <cwctype>
#include <iterator>
#include <system_error>

namespace taocode {
namespace dialogs {

using Microsoft::WRL::ComPtr;
namespace fs = std::filesystem;
using taocode::utf8;
using taocode::wide;

namespace {

void fail(HRESULT result, const char* operation) {
    if (SUCCEEDED(result)) return;
    throw taocode::WorkspaceError("DIALOG_FAILED", std::string(operation) + " 失败");
}

// IDEA's project choosers open in GeneralLocalSettings.defaultProjectDirectory when it is
// set (WelcomeScreenProjectProvider.kt:231, AttachProjectAction.kt:73) and in the OS
// default otherwise. `SetFolder` has to be handed a folder that exists — combined with
// FOS_PATHMUSTEXIST a stale path makes the dialog fail to appear at all — so a value that
// is not a directory is ignored and the dialog simply opens where it normally would.
void set_initial_folder(IFileOpenDialog* dialog, const std::string& initial) {
    if (initial.empty()) return;
    const fs::path folder = fs::path(wide(initial));
    std::error_code error;
    if (!fs::is_directory(folder, error)) return;
    ComPtr<IShellItem> item;
    if (FAILED(SHCreateItemFromParsingName(folder.c_str(), nullptr, IID_PPV_ARGS(&item)))) return;
    dialog->SetFolder(item.Get());  // best effort: failing here still opens the dialog
}

}  // namespace

std::vector<std::pair<std::string, std::string>> parse_file_filters(const std::string& spec) {
    std::vector<std::pair<std::string, std::string>> filters;
    std::vector<std::string> parts;
    std::string current;
    for (const char character : spec) {
        if (character == '|') { parts.push_back(current); current.clear(); continue; }
        current += character;
    }
    parts.push_back(current);
    // 成对读取：名称 + 通配符；落单的那一段（名称没有通配符）忽略 —— 免得造出列不出文件的过滤器。
    for (std::size_t index = 0; index + 1 < parts.size(); index += 2) {
        if (parts[index].empty() || parts[index + 1].empty()) continue;
        filters.emplace_back(parts[index], parts[index + 1]);
    }
    // 没有任何合法过滤器时给一个兜底：所有文件（否则对话框打开后是空的）。
    if (filters.empty()) filters.emplace_back("所有文件", "*.*");
    return filters;
}

namespace {

/** 过滤器的宽字符形式（`SetFileTypes` 要 COMDLG_FILTERSPEC，且它只在 Show 期间被读）。 */
struct WideFilters {
    std::vector<std::wstring> labels;
    std::vector<std::wstring> patterns;
    std::vector<COMDLG_FILTERSPEC> specs;
};

WideFilters widen(const std::vector<std::pair<std::string, std::string>>& filters) {
    WideFilters out;
    out.labels.reserve(filters.size());
    out.patterns.reserve(filters.size());
    for (const auto& filter : filters) {
        out.labels.push_back(wide(filter.first));
        out.patterns.push_back(wide(filter.second));
    }
    for (std::size_t index = 0; index < filters.size(); ++index)
        out.specs.push_back(COMDLG_FILTERSPEC{out.labels[index].c_str(), out.patterns[index].c_str()});
    return out;
}

std::string selected_path(IFileDialog* dialog, const char* operation) {
    ComPtr<IShellItem> item;
    fail(dialog->GetResult(&item), operation);
    PWSTR path{};
    fail(item->GetDisplayName(SIGDN_FILESYSPATH, &path), operation);
    const fs::path selected(path);
    CoTaskMemFree(path);
    return utf8(selected.native());
}

}  // namespace

Json select_directory(void* window, const wchar_t* title, const std::string& initial) {
    ComPtr<IFileOpenDialog> dialog;
    fail(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)), "Create folder picker");
    DWORD options{};
    fail(dialog->GetOptions(&options), "Get folder options");
    fail(dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR | FOS_DONTADDTORECENT), "Set folder options");
    dialog->SetTitle(title);
    set_initial_folder(dialog.Get(), initial);
    const auto result = dialog->Show(static_cast<HWND>(window));
    if (result == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return nullptr;
    fail(result, "Open folder picker");
    ComPtr<IShellItem> item;
    fail(dialog->GetResult(&item), "Get selected folder");
    PWSTR path{};
    fail(item->GetDisplayName(SIGDN_FILESYSPATH, &path), "Get folder path");
    const fs::path selected(path);
    CoTaskMemFree(path);
    return utf8(selected.native());
}

// IDEA's "Background Image..." action (Images.SetBackgroundImage): pick an image
// file and hand its bytes to the UI as a data URL. Only real image extensions are
// accepted and the file is size-capped, so this cannot be used as a general
// "read any file" channel.
static bool image_mime_for(const fs::path& path, std::string& mime) {
    auto extension = path.extension().wstring();
    for (auto& ch : extension) ch = static_cast<wchar_t>(std::towlower(ch));
    if (extension == L".png") mime = "image/png";
    else if (extension == L".jpg" || extension == L".jpeg") mime = "image/jpeg";
    else if (extension == L".gif") mime = "image/gif";
    else if (extension == L".webp") mime = "image/webp";
    else if (extension == L".bmp") mime = "image/bmp";
    else if (extension == L".svg") mime = "image/svg+xml";
    else return false;
    return true;
}

Json read_image(const std::filesystem::path& path) {
    std::string mime;
    if (!image_mime_for(path, mime))
        throw taocode::WorkspaceError("INVALID_IMAGE", "只支持 PNG / JPEG / GIF / WebP / BMP / SVG 图片。");
    std::error_code ec;
    const auto size = fs::file_size(path, ec);
    if (ec) throw taocode::WorkspaceError("IO_ERROR", "无法读取该图片文件。");
    if (size == 0 || size > 16ull * 1024 * 1024)
        throw taocode::WorkspaceError("INVALID_IMAGE", "图片必须大于 0 且不超过 16 MiB。");
    std::ifstream stream(path, std::ios::binary);
    if (!stream) throw taocode::WorkspaceError("IO_ERROR", "无法打开该图片文件。");
    const std::string bytes{std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>()};
    return {{"path", utf8(path.native())}, {"mime", mime}, {"bytes", static_cast<std::int64_t>(bytes.size())},
            {"dataUrl", "data:" + mime + ";base64," + base64_encode(bytes)}};
}

Json pick_file(void* window, const wchar_t* title, const std::string& filters, const std::string& initial) {
    ComPtr<IFileOpenDialog> dialog;
    fail(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)), "Create file picker");
    DWORD options{};
    fail(dialog->GetOptions(&options), "Get file options");
    fail(dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_NOCHANGEDIR | FOS_DONTADDTORECENT), "Set file options");
    const auto widened = widen(parse_file_filters(filters));
    fail(dialog->SetFileTypes(static_cast<UINT>(widened.specs.size()), widened.specs.data()), "Set file filters");
    dialog->SetTitle(title);
    set_initial_folder(dialog.Get(), initial);
    const auto result = dialog->Show(static_cast<HWND>(window));
    if (result == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return nullptr;
    fail(result, "Open file picker");
    return selected_path(dialog.Get(), "Get selected file");
}

Json save_file(void* window, const wchar_t* title, const std::string& filters, const std::string& defaultName) {
    ComPtr<IFileSaveDialog> dialog;
    fail(CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)), "Create save dialog");
    DWORD options{};
    fail(dialog->GetOptions(&options), "Get save options");
    fail(dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR | FOS_DONTADDTORECENT | FOS_OVERWRITEPROMPT), "Set save options");
    const auto widened = widen(parse_file_filters(filters));
    fail(dialog->SetFileTypes(static_cast<UINT>(widened.specs.size()), widened.specs.data()), "Set save filters");
    dialog->SetTitle(title);
    if (!defaultName.empty()) dialog->SetFileName(wide(defaultName).c_str());
    const auto result = dialog->Show(static_cast<HWND>(window));
    if (result == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return nullptr;
    fail(result, "Save dialog");
    return selected_path(dialog.Get(), "Get save path");
}

Json pick_image(void* window) {
    ComPtr<IFileOpenDialog> dialog;
    fail(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)), "Create image picker");
    DWORD options{};
    fail(dialog->GetOptions(&options), "Get image options");
    fail(dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_NOCHANGEDIR | FOS_DONTADDTORECENT), "Set image options");
    const COMDLG_FILTERSPEC filters[]{{L"图片", L"*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.svg"}};
    fail(dialog->SetFileTypes(1, filters), "Set image filters");
    dialog->SetTitle(L"选择背景图像");
    const auto result = dialog->Show(static_cast<HWND>(window));
    if (result == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return nullptr;
    fail(result, "Open image picker");
    ComPtr<IShellItem> item;
    fail(dialog->GetResult(&item), "Get selected image");
    PWSTR path{};
    fail(item->GetDisplayName(SIGDN_FILESYSPATH, &path), "Get image path");
    const fs::path selected(path);
    CoTaskMemFree(path);
    return read_image(selected);
}

}  // namespace dialogs
}  // namespace taocode
