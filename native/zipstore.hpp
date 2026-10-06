#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

// 最小 ZIP 写入/读取（store 方法，不压缩）—— 「收集日志并打包」（IDEA `LogPacker.packLogs`）需要的宿主能力。
//
// 对照：`platform/platform-impl/src/com/intellij/ide/actions/CollectZippedLogsAction.kt:87-99`
// 调 `LogPacker.packLogs(project)` 得到 zip 路径，再 `RevealFileAction.openFile(logs)` 显示出来。
//
// 为什么自己写而不是引第三方：本仓的原生层不引压缩库（CMake 只拉 nlohmann/json），而日志是文本，
// **store（method 0）就够**——ZIP 的 store 格式只是"头部 + 原样字节"，不需要 deflate。
// 读取函数是给测试与"校验打包结果"用的，真实有用（README 里也照样能双击打开）。
namespace taocode {
namespace zip {

/** 一个待写条目：压缩包内的名字 + 磁盘上的来源文件。 */
struct Entry {
    std::string name;
    std::filesystem::path source;
};

/**
 * 一个**在内存里**的条目。为什么要它：导出设置只有一份 JSON，先落盘再压是多余的一步；
 * 而日志打包（原用途）本来就是一堆磁盘文件，所以两个重载各干各的、不改老的签名。
 */
struct MemoryEntry {
    std::string name;
    std::string data;
};

/** 把条目写成 zip（store），返回实际写入的条目数。写入失败抛 `std::runtime_error`。 */
std::size_t write_archive(const std::filesystem::path& target, const std::vector<Entry>& entries);

/** 同上，但条目内容来自内存（导出设置用）。 */
std::size_t write_archive(const std::filesystem::path& target, const std::vector<MemoryEntry>& entries);

/**
 * 读回 zip 里的全部条目（name → 原始字节）。用于测试与校验，也是「导入设置归档」的读取口。
 * 只支持 **store（方法 0）**：条目不是 store、或加了密、或把大小写在数据之后（流式打包）时
 * **抛错说清是哪一种**，绝不把压缩字节当内容吐出去 —— 否则调用方（settings_transfer）报出来的
 * 是「设置不是合法的 JSON」，把真原因盖掉。本仓的 writer 只写 store，所以自己的包永远读得出。
 */
std::vector<std::pair<std::string, std::string>> read_archive(const std::filesystem::path& archive);

/** CRC-32（IEEE 802.3，ZIP 用的那个多项式）。单独暴露出来便于单测。 */
std::uint32_t crc32(const std::string& data);

}  // namespace zip
}  // namespace taocode
