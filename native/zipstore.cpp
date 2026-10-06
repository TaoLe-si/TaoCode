// 最小 ZIP（store）实现，见 zipstore.hpp 的说明。
#include "zipstore.hpp"

#include <chrono>
#include <cstring>
#include <ctime>
#include <fstream>
#include <stdexcept>

namespace taocode {
namespace zip {
namespace {

std::vector<std::uint8_t>& put16(std::vector<std::uint8_t>& out, std::uint16_t value) {
    out.push_back(static_cast<std::uint8_t>(value & 0xFF));
    out.push_back(static_cast<std::uint8_t>((value >> 8) & 0xFF));
    return out;
}

std::vector<std::uint8_t>& put32(std::vector<std::uint8_t>& out, std::uint32_t value) {
    out.push_back(static_cast<std::uint8_t>(value & 0xFF));
    out.push_back(static_cast<std::uint8_t>((value >> 8) & 0xFF));
    out.push_back(static_cast<std::uint8_t>((value >> 16) & 0xFF));
    out.push_back(static_cast<std::uint8_t>((value >> 24) & 0xFF));
    return out;
}

/** ZIP 内的"最后修改时间"是 MS-DOS 的 16 位日期/时间对。 */
void dos_stamp(std::uint16_t& time, std::uint16_t& date) {
    const auto now = std::chrono::system_clock::now();
    const std::time_t seconds = std::chrono::system_clock::to_time_t(now);
    std::tm local{};
    localtime_s(&local, &seconds);
    time = static_cast<std::uint16_t>((local.tm_hour << 11) | (local.tm_min << 5) | (local.tm_sec / 2));
    date = static_cast<std::uint16_t>(((local.tm_year - 80) << 9) | ((local.tm_mon + 1) << 5) | local.tm_mday);
}

std::string read_file(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("无法读取 " + path.string());
    std::string data((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    return data;
}

std::uint32_t load32(const std::string& data, std::size_t at) {
    if (at + 4 > data.size()) throw std::runtime_error("zip 截断");
    return static_cast<std::uint8_t>(data[at])
        | (static_cast<std::uint32_t>(static_cast<std::uint8_t>(data[at + 1])) << 8)
        | (static_cast<std::uint32_t>(static_cast<std::uint8_t>(data[at + 2])) << 16)
        | (static_cast<std::uint32_t>(static_cast<std::uint8_t>(data[at + 3])) << 24);
}

std::uint16_t load16(const std::string& data, std::size_t at) {
    if (at + 2 > data.size()) throw std::runtime_error("zip 截断");
    return static_cast<std::uint16_t>(static_cast<std::uint8_t>(data[at])
        | (static_cast<std::uint16_t>(static_cast<std::uint8_t>(data[at + 1])) << 8));
}

}  // namespace

std::uint32_t crc32(const std::string& data) {
    static std::uint32_t table[256];
    static bool ready = false;
    if (!ready) {
        for (std::uint32_t index = 0; index < 256; ++index) {
            std::uint32_t value = index;
            for (int bit = 0; bit < 8; ++bit)
                value = (value & 1) ? (0xEDB88320u ^ (value >> 1)) : (value >> 1);
            table[index] = value;
        }
        ready = true;
    }
    std::uint32_t crc = 0xFFFFFFFFu;
    for (const unsigned char byte : data) crc = table[(crc ^ byte) & 0xFF] ^ (crc >> 8);
    return crc ^ 0xFFFFFFFFu;
}

namespace {

/** 真正写盘的那一层：条目内容已经就位。两个公开重载都归到这里。 */
std::size_t write_raw(const std::filesystem::path& target, const std::vector<std::pair<std::string, std::string>>& entries) {
    std::vector<std::uint8_t> out;
    struct Central {
        std::string name;
        std::uint32_t crc = 0;
        std::uint32_t size = 0;
        std::uint32_t offset = 0;
    };
    std::vector<Central> central;
    std::uint16_t time = 0, date = 0;
    dos_stamp(time, date);
    std::size_t written = 0;

    for (const auto& entry : entries) {
        const std::string& data = entry.second;
        const auto offset = static_cast<std::uint32_t>(out.size());
        const auto crc = crc32(data);
        const auto size = static_cast<std::uint32_t>(data.size());
        const auto name_size = static_cast<std::uint16_t>(entry.first.size());

        // local file header：PK\x03\x04
        put32(out, 0x04034b50u);
        put16(out, 20);        // version needed
        put16(out, 0x0800);    // flag: 文件名是 UTF-8
        put16(out, 0);         // method: store
        put16(out, time);
        put16(out, date);
        put32(out, crc);
        put32(out, size);      // compressed size = 原大小（store）
        put32(out, size);
        put16(out, name_size);
        put16(out, 0);         // extra length
        out.insert(out.end(), entry.first.begin(), entry.first.end());
        out.insert(out.end(), data.begin(), data.end());

        central.push_back({entry.first, crc, size, offset});
        ++written;
    }

    const auto central_offset = static_cast<std::uint32_t>(out.size());
    for (const auto& item : central) {
        put32(out, 0x02014b50u);  // central directory header
        put16(out, 20);           // version made by
        put16(out, 20);           // version needed
        put16(out, 0x0800);
        put16(out, 0);            // method
        put16(out, time);
        put16(out, date);
        put32(out, item.crc);
        put32(out, item.size);
        put32(out, item.size);
        put16(out, static_cast<std::uint16_t>(item.name.size()));
        put16(out, 0);            // extra
        put16(out, 0);            // comment
        put16(out, 0);            // disk number
        put16(out, 0);            // internal attrs
        put32(out, 0);            // external attrs
        put32(out, item.offset);
        out.insert(out.end(), item.name.begin(), item.name.end());
    }
    const auto central_size = static_cast<std::uint32_t>(out.size()) - central_offset;

    put32(out, 0x06054b50u);  // end of central directory
    put16(out, 0);            // this disk
    put16(out, 0);            // disk with central directory
    put16(out, static_cast<std::uint16_t>(central.size()));
    put16(out, static_cast<std::uint16_t>(central.size()));
    put32(out, central_size);
    put32(out, central_offset);
    put16(out, 0);            // comment length

    std::error_code error;
    if (!target.parent_path().empty()) std::filesystem::create_directories(target.parent_path(), error);
    std::ofstream file(target, std::ios::binary | std::ios::trunc);
    if (!file) throw std::runtime_error("无法写入 " + target.string());
    file.write(reinterpret_cast<const char*>(out.data()), static_cast<std::streamsize>(out.size()));
    if (!file) throw std::runtime_error("写入 zip 失败 " + target.string());
    return written;
}

}  // namespace

std::size_t write_archive(const std::filesystem::path& target, const std::vector<Entry>& entries) {
    std::vector<std::pair<std::string, std::string>> raw;
    raw.reserve(entries.size());
    for (const auto& entry : entries) raw.emplace_back(entry.name, read_file(entry.source));
    return write_raw(target, raw);
}

std::size_t write_archive(const std::filesystem::path& target, const std::vector<MemoryEntry>& entries) {
    std::vector<std::pair<std::string, std::string>> raw;
    raw.reserve(entries.size());
    for (const auto& entry : entries) raw.emplace_back(entry.name, entry.data);
    return write_raw(target, raw);
}

std::vector<std::pair<std::string, std::string>> read_archive(const std::filesystem::path& archive) {
    const std::string data = read_file(archive);
    std::vector<std::pair<std::string, std::string>> entries;
    for (std::size_t at = 0; at + 4 <= data.size();) {
        const auto signature = load32(data, at);
        if (signature == 0x04034b50u) {
            // 本地文件头里先问三件「能不能读」的事，再动数据。原来的实现只看签名与大小，
            // 于是 deflate（method 8，几乎所有外部工具打的包）会**原样吐出压缩字节**：
            // 调用方拿到的是乱码，报出来的错是「设置不是合法的 JSON」，把真原因盖掉了。
            // ZIP 的字段口径见 zipstore.hpp 的注释与 APPNOTE 的 local header 表：
            // 通用位标志在偏移 6、压缩方法在偏移 8、压缩后大小在偏移 18。
            const auto flag = load16(data, at + 6);
            const auto method = load16(data, at + 8);
            if (method != 0)
                throw std::runtime_error("条目用了压缩方法 " + std::to_string(method) +
                                         "，本仓的 zip 读取只支持 store（方法 0）");
            // bit 0 = 加密；bit 3 = 大小写在条目尾部的 data descriptor 里，本地头里的两个
            // 大小字段是 0 ⇒ 无法定位下一条目的起点，只能明确拒掉（不是"读出来是空的"）。
            if ((flag & 0x0001u) != 0) throw std::runtime_error("条目是加密的，读不了");
            if ((flag & 0x0008u) != 0) throw std::runtime_error("条目把大小写在数据之后（流式打包），读不了");
            const auto size = load32(data, at + 18);
            const auto name_size = load16(data, at + 26);
            const auto extra_size = load16(data, at + 28);
            const auto name_at = at + 30;
            const auto data_at = name_at + name_size + extra_size;
            if (data_at + size > data.size()) throw std::runtime_error("zip 条目越界");
            entries.emplace_back(data.substr(name_at, name_size), data.substr(data_at, size));
            at = data_at + size;
            continue;
        }
        if (signature == 0x02014b50u || signature == 0x06054b50u) break;
        throw std::runtime_error("zip 结构异常");
    }
    return entries;
}

}  // namespace zip
}  // namespace taocode
