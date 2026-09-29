#pragma once

#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#include "workspace.hpp"  // Json, WorkspaceError

// 宿主文件对话框与图片读取（从 main.cpp 拆出的一域）。
//
// 判据：这些都是"用 Win32 通用对话框拿一个用户选中的东西"，与 App 的状态机无关 ——
// 拆出来的直接收益是 main.cpp 回到机检上限内（原先是 2223 行 / 上限 2200）。
//
// 对照源码：
//   · 文件夹选择器：IDEA 的 `FileChooser`（`dialog.pickDirectory`）在 Windows 上用
//     `IFileOpenDialog` + `FOS_PICKFOLDERS`；`FOS_PATHMUSTEXIST` 要求传入的初始目录**必须存在**，
//     否则对话框根本打不开（这一点在 `App::set_initial_folder` 的注释里记过）。
//   · 图片选择：IDEA 的「背景图像」（`Images.SetBackgroundImage`）——只接受真实图片扩展名并限大小，
//     免得这条通道变成"读任意文件"的后门。
namespace taocode {
namespace dialogs {

/** 文件夹选择器。`window` 是 HWND（用 `void*` 以免头文件引 windows.h）；取消返回 `nullptr`（Json 空值）。 */
Json select_directory(void* window, const wchar_t* title, const std::string& initial = std::string());

/** 只接受真实图片扩展名、并把文件读成 data URL（`{ mime, dataUrl }`）。 */
Json read_image(const std::filesystem::path& path);

/**
 * 过滤器串 → `{名称, 通配符}` 列表，形如 `"设置归档|*.zip|所有文件|*.*"`。
 *
 * 为什么单独暴露：真正的 `IFileOpenDialog` 调用要窗口与用户交互，测不了；
 * 而"过滤器串解析"是**纯函数**，它错了同样会让对话框列出错误的文件类型（IDEA 的对应物是
 * `ConfigImportHelper.setSettingsFilter` / `ImportSettingsFilenameFilter` 设的那一个过滤器）。
 */
std::vector<std::pair<std::string, std::string>> parse_file_filters(const std::string& spec);

/**
 * 通用"打开文件"对话框（IDEA `FileChooser` 的对应物，导入设置用它）。
 * `filters` 见 `parse_file_filters`；`initial` 是建议的起始目录（可空）。取消返回 `nullptr`。
 */
Json pick_file(void* window, const wchar_t* title, const std::string& filters, const std::string& initial = std::string());

/**
 * 通用"保存文件"对话框（导出设置用它）。`defaultName` 只是预填的文件名。取消返回 `nullptr`。
 */
Json save_file(void* window, const wchar_t* title, const std::string& filters, const std::string& defaultName = std::string());

/** 图片选择器：选中后直接读成 data URL；取消返回 `nullptr`。 */
Json pick_image(void* window);

}  // namespace dialogs
}  // namespace taocode
