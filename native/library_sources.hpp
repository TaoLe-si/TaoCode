// 「库类型的源码」—— 从工程里已有的 `*-sources.jar` 里把某个全限定名的 `.java` 取出来，
// 让「转到定义 / 快速定义」在库类型上也有源码可看（IDEA 靠**源码附件**做同一件事）。
//
// 为什么走这条路（2026-10-01 的真机结论，探针 `jdtls_probe` 在 AE2 工程上跑的原始输出）：
//   · JDT 的 `hover` 能解析库类型并带上 javadoc（说明我们的 `.classpath` sourcepath 生效了）：
//     `{"contents":"net.minecraftforge.common.config.Configuration\n\nThis class offers advanced…"}`；
//   · 但 `textDocument/definition` / `declaration` / `typeDefinition` 对**库里**的类型不给位置
//     （definition 空手而归，typeDefinition 在服务端忙时直接超时）—— 上一轮已用三个探针确认过；
//   · 服务端还特别忙：`java.project.getAll` 回报 6 个工程（除了链接的那个，还有 4 个没链接的同级
//     工程 + 一个 invisible project），`java.import.exclusions` **挡不住**（发了也一样），
//     它为此推了 2100+ 批诊断 —— 所以"等 JDT 自己给库位置"不是一条能收敛的路。
// 于是等价物由客户端自己做：全限定名 → `a/b/C.java` → 在工程里真实存在的 `*-sources.jar` 里找它。
//
// 解压用 Windows 自带的 bsdtar（与 `native/plugins.cpp:146` 同一招：deflate 交给它，
// 原生层不引压缩库），解到 profile 的缓存目录并置**只读**位（IDEA 的库源码编辑器也是只读的）。
#pragma once

#include <filesystem>
#include <cstddef>
#include <string>
#include <vector>

#include "workspace.hpp"  // Json

namespace taocode {

/** 「库类型的源码」查找结果。`available=false` 时其余字段为空。 */
struct LibrarySource {
    bool available = false;
    std::string path;     // 解出来的 .java 绝对路径（profile 缓存里，只读）
    std::string jar;      // 命中的 sources jar（绝对路径）
    std::string entry;    // jar 内的条目名（`a/b/C.java`）
    std::string content;  // 该文件的文本（UTF-8）
    std::string reason;   // 没找到时的一句话（给日志/提示，不猜）
};

/**
 * 在 `root` 下所有 `*-sources.jar` 里查 `qualifier`（如 `net.minecraftforge.common.config.Configuration`）
 * 对应的源码。命中就解到 `cache_root`（已存在且内容相同时直接复用）。
 *
 * 只认合法全限定名（点分段、标识符字符），jar 数与单文件大小都有上限 —— 输入来自服务端文本，
 * 不设上限就是一个能被 hover 文本牵着走的路径遍历口子。
 */
LibrarySource find_library_source(const std::filesystem::path& root, const std::filesystem::path& cache_root,
                                  const std::string& qualifier);

/** 把 `find_library_source` 的结果整形成桥接层要的形状（`{available, path, jar, entry, content, reason}`）。 */
Json library_source_json(const LibrarySource& source);

}  // namespace taocode
