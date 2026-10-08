// 文件编码族的**纯规则** —— `src/editorFileOps.ts` / `src/diskSync.ts` 与判据共用。
// 字节本体在宿主（`native/workspace.cpp:139-241`），这里只管「状态该不该留、话该不该说」。
//
// 上游对照（2026-10-06 encod2 本轮自开坐标，逐行实读；树根
// `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · `platform/util/src/com/intellij/openapi/vfs/CharsetToolkit.java:79-83` 五种 BOM 字节，
//     `:86-92` `CHARSET_TO_MANDATORY_BOM` 只收 UTF-16LE/BE + UTF-32BE/LE，
//     `:579` `getPossibleBom = UTF-8 ? UTF8_BOM : MANDATORY.get(charset)`，`:584` `canHaveBom`
//     ⇒ **UTF-8 的 BOM 可选、UTF-16 强制、gbk/cp1252/system 这一类根本没有 BOM 概念**。
//   · `platform/core-api/src/com/intellij/openapi/vfs/VirtualFile.java:507-511` `setCharset`：
//     换编码时 BOM 是**派生量** —— 新编码有强制 BOM 就取它；否则「原本有 BOM 且新编码容得下」才留，
//     留不住就 `setBOM(null)`。⇒ 把带 UTF-8 BOM 的文件切成 GBK，上游的状态是「没有 BOM」。
//   · 读侧「按这档编码解不开字节」在上游不静默：`CharsetToolkit.java:242-261` `guessEncoding`
//     的 `INVALID_UTF8 ⇒ defaultCharset`（注释 `:225-226`），再不行还有 `LoadTextUtil.java:450-457`
//     `getOverriddenCharsetByBOM` 按 BOM 改判；本仓读侧是**严格**的（`native/workspace.cpp:141-142`
//     "never a '?' written over the user's text"），代价就是失败必须说出口，不能默默留着旧缓冲。
import type { EncodingKey } from './bridge.ts'

/** 上游 `getPossibleBom(...) != null` 的那几档；其余编码没有 BOM 这回事。 */
const BOM_CAPABLE: readonly EncodingKey[] = ['utf-8', 'utf-16le', 'utf-16be', 'utf-32be', 'utf-32le']

/** `CHARSET_TO_MANDATORY_BOM`（`CharsetToolkit.java:86-92`）里的那几档：写出去**必定**带 BOM。 */
const MANDATORY_BOM: readonly EncodingKey[] = ['utf-16le', 'utf-16be', 'utf-32be', 'utf-32le']

/** 这档编码能不能带 BOM（对应 `CharsetToolkit.java:579`）。 */
export function encodingHasPossibleBom(encoding: EncodingKey): boolean {
  return BOM_CAPABLE.includes(encoding)
}

/** 这档编码的 BOM 是不是强制的 —— 上游没有给「关掉 UTF-16 的 BOM」这一选（字节序全靠它标记）。 */
export function encodingMandatoryBom(encoding: EncodingKey): boolean {
  return MANDATORY_BOM.includes(encoding)
}

/**
 * BOM 复选框只对「有 BOM 概念、又不强制」的那一档开放（UTF-8）。
 * 强制档给可关的控件 ⇒ 「界面说能关、写出去还是带」；无 BOM 概念的档给可勾的控件
 * ⇒ 勾了什么都不发生。两种都是假控件，所以两边都不开放。
 */
export function encodingBomToggleable(encoding: EncodingKey): boolean {
  return encodingHasPossibleBom(encoding) && !encodingMandatoryBom(encoding)
}

/**
 * 切换编码后这条 BOM 状态还剩什么 —— 上游 `VirtualFile.setCharset:507-511` 的两半：
 * 新编码有强制 BOM 就直接取它（`getMandatoryBom`），否则「原本有且新编码容得下」才留，
 * 容不下就 `setBOM(null)`。
 */
export function bomAfterEncodingSwitch(encoding: EncodingKey, currentBom: boolean): boolean {
  if (encodingMandatoryBom(encoding)) return true
  return encodingHasPossibleBom(encoding) ? currentBom : false
}

/** 宿主「这档编码解不开/编不出这些字节」的错误码（`native/workspace.cpp:173,185,209,215,267,276,278,747`）。 */
const DECODE_FAILURE_CODES: readonly string[] = ['INVALID_UTF8', 'ENCODING_MISMATCH', 'BINARY_FILE', 'ENCODING_LOSS', 'ENCODING_FAILED']

/** 是不是编码类失败（区别于 NOT_FOUND / READ_ONLY / CONFLICT 那些另有归属的码）。 */
export function isDecodeFailureCode(code: unknown): boolean {
  return typeof code === 'string' && DECODE_FAILURE_CODES.includes(code)
}

/** 去重键：同一标签、同一磁盘版本只说一次（磁盘同步每次切标签都跑一趟，不能重复弹）。 */
export function decodeFailureKey(path: string, version: unknown): string {
  return `${path}|${String(version)}`
}

/** 该说的话；不该说时返回 `null`，调用方据此什么都不做。`reason` 传宿主原话（`errorMessage(error)`）。 */
export function decodeFailureNotice(path: string, encoding: EncodingKey, code: unknown, reason?: string): string | null {
  return isDecodeFailureCode(code)
    ? `磁盘上的 ${path} 按 ${encoding} 读不出来：${reason || String(code)}；缓冲区还是旧内容，用「文件编码」换一档编码重读。`
    : null
}
