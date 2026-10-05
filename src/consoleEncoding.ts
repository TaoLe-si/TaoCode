// 控制台输出编码（上游 `ConsoleEncodingComboBox`，
// `platform/lang-impl/src/com/intellij/execution/console/ConsoleEncodingComboBox.kt`）。
//
// 上游的组合框给控制台选字符集（默认「系统编码」+ 收藏 + 全部可用字符集），选完由
// `ConsoleViewImpl.setEncoding` 重新解码/显示。本仓的输出是**原始字节**（宿主 base64 回传，
// 子进程按自己的代码页打印），所以这里的编码选择直接决定 `src/runInstances.ts` 里
// `TextDecoder` 用哪套字符集解码 —— 选 GBK 才能正确显示 Windows 中文控制台程序的输出。
//
// 与上游的两点差异（如实记录，不假装一致）：
//   · 列表是固定的一组常用字符集（浏览器 TextDecoder 支持的那批），不是「全部可用字符集 + 收藏」；
//   · 默认是 UTF-8 而不是「系统编码」（宿主没有把系统 ANSI 代码页传下来；UTF-8 是跨平台默认）。
// 消费者：RunConsole 的编码选择器 + runInstances 的解码器。判据 tests/console-input.test.mjs。

export interface ConsoleEncoding {
  id: string
  label: string
}

/** TextDecoder 在 Chromium/Node（full-icu）里都支持的常用字符集。 */
export const CONSOLE_ENCODINGS: readonly ConsoleEncoding[] = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'gbk', label: 'GBK（简体中文）' },
  { id: 'gb18030', label: 'GB18030' },
  { id: 'big5', label: 'Big5（繁体中文）' },
  { id: 'shift_jis', label: 'Shift-JIS（日文）' },
  { id: 'euc-kr', label: 'EUC-KR（韩文）' },
  { id: 'windows-1251', label: 'Windows-1251（西里尔）' },
  { id: 'iso-8859-1', label: 'ISO-8859-1（西欧）' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
]

export const DEFAULT_CONSOLE_ENCODING = 'utf-8'
export const CONSOLE_ENCODING_KEY = 'taocode.consoleEncoding'

export function isKnownConsoleEncoding(id: string): boolean {
  return CONSOLE_ENCODINGS.some(entry => entry.id === id)
}

export function consoleEncodingLabel(id: string): string {
  return CONSOLE_ENCODINGS.find(entry => entry.id === id)?.label ?? id
}

/**
 * 建解码器。**流式**（`{stream:true}`）由调用方决定 —— 分块边界会切开多字节字符，
 * 这里只负责给出正确字符集的 decoder；不认识的 id 退回 UTF-8（不抛、不静默成空）。
 */
export function createConsoleDecoder(id: string = DEFAULT_CONSOLE_ENCODING): TextDecoder {
  try {
    return new TextDecoder(id)
  } catch {
    return new TextDecoder(DEFAULT_CONSOLE_ENCODING)
  }
}

export interface EncodingStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 读当前选择（localStorage；不可用/未知值退回默认）。 */
export function readConsoleEncoding(store?: EncodingStore): string {
  try {
    const source = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
    if (!source) return DEFAULT_CONSOLE_ENCODING
    const saved = source.getItem(CONSOLE_ENCODING_KEY)
    return saved && isKnownConsoleEncoding(saved) ? saved : DEFAULT_CONSOLE_ENCODING
  } catch {
    return DEFAULT_CONSOLE_ENCODING
  }
}

export function writeConsoleEncoding(store: EncodingStore | undefined, id: string): void {
  try {
    const target = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
    target?.setItem(CONSOLE_ENCODING_KEY, id)
  } catch { /* 存储不可用时只影响本次会话的持久化 */ }
}
