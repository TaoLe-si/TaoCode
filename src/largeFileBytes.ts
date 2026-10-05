// 大文件的**按字节**判定（补齐 `src/largeFileMode.ts` 注释里点名的缺口：「判定按字符数而不是
// 字节数」）。上游 `LargeFileEditorProvider` 拿到的是 VFS 的文件长度（字节）；本仓前端只有已解码
// 文本，所以用码点逐段累加 UTF-8 字节数 —— 对 CJK/emoji 源码，字符数与字节数能差 3–4 倍，
// 「5 MiB 的翻译文件」按字符判会晚 3 倍才降级。
//
// 阈值沿用 `LARGE_FILE_LIMIT`（5 MiB），策略复用 `largeFilePolicy`，这个模块只补「文本 → 字节」。

import { LARGE_FILE_LIMIT, largeFilePolicy, type LargeFilePolicy } from './largeFileMode.ts'

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

/** 按字节判大文件（与 `largeFilePolicy(字符数)` 同一策略）。 */
export function largeFilePolicyForText(text: string): LargeFilePolicy {
  return largeFilePolicy(utf8ByteLength(text))
}

/** 超限了吗（状态栏/提示的布尔问法）。 */
export function isLargeFileText(text: string): boolean {
  return utf8ByteLength(text) >= LARGE_FILE_LIMIT
}

/** 文件大小文案：B / KiB / MiB（一位小数；IDEA 的 `FileUtil.formatFileSize` 同形）。 */
export function formatFileSize(bytes: number): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}
