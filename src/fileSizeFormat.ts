// 文件大小的两个**纯格式化件**：UTF-8 字节计数与 B / KiB / MiB 文案。
//
// 为什么单独一个模块（原先在 `src/largeFileBytes.ts`）：`src/largeFileViewer.ts`（EP 贡献，
// 拿字节数判 `accept`、拿文案填视图描述）要用这两个函数，而 `src/largeFileBytes.ts` 现在要
// import `src/largeFileViewer.ts`（编辑器侧的降级判定要过 `com.intellij.fileEditorProvider`
// 的 `LargeFileEditor` 支，见那个文件的注释）——两个函数若留在原处，就会形成
// `largeFileBytes → largeFileViewer → largeFileBytes` 的循环。搬到这里后，两边都只依赖本模块，
// 循环被打断；`largeFileBytes.ts` 仍**原样再导出**它们，既有 import 点（`src/components/CodeEditor.vue`
// 与判据）不用动。
//
// 口径与上游：
//   · `utf8ByteLength`：不依赖 `TextEncoder`，逐码点算 —— 纯函数、可在任何环境测。上游
//     `LargeFileEditorProvider.accept` 拿到的是 VFS 的文件长度（字节）；本仓前端只有已解码文本，
//     所以这里补「文本 → 字节」（对 CJK/emoji 源码，字符数与字节数能差 3–4 倍）；
//   · `formatFileSize`：与 IDEA 的 `FileUtil.formatFileSize` 同形（B / KiB / MiB，一位小数）。

/**
 * 文本的 UTF-8 字节数（不依赖 `TextEncoder`，逐码点算 —— 纯函数、可在任何环境测）。
 * 代理对（emoji 等）按 4 字节；Unicode 码点按 UTF-8 的长度表。
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; ++index) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; ++index }
      else bytes += 3
    } else bytes += 3
  }
  return bytes
}

/** 文件大小文案：B / KiB / MiB（一位小数；IDEA 的 `FileUtil.formatFileSize` 同形）。 */
export function formatFileSize(bytes: number): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}
