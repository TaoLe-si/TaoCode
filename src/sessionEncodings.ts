// 会话快照里的**按文件编码记忆** —— 纯形状规则（`src/sessionSnapshot.ts` 与判据共用）。
//
// 上游对照（pf/vfs 的 encoding 一族）：
//   · 按文件编码记忆：`EncodingProjectManagerImpl` 把 `path → charset` 存进 `.idea/encodings.xml`
//     （`getEncoding`/`setEncoding`）；本仓没有工程级存储，会话快照是跨重启能留这一笔的通道。
//   · 两个动作：`ChangeFileEncodingAction`（同一份字节按另一种编码重读）与 `ChooseFileEncodingAction`
//     已经是 `src/editorFileOps.ts` 的「重新按编码读取 / 按编码写回」。
// 崩溃恢复必须按记住的编码读，否则 GBK 文件会被当 UTF-8 读成乱码。

import type { EncodingKey } from './bridge.ts'

/** 与 `src/bridge.ts` 的 `encodingKeys` 同一份合法值（判据交叉核对，防止两份清单漂移）。 */
export const SESSION_ENCODINGS: readonly EncodingKey[] = ['utf-8', 'gbk', 'cp1252', 'system', 'utf-32be', 'utf-32le', 'utf-16le', 'utf-16be']

/** 一个会话条目：标签位置 + 可选草稿 + 可选编码。 */
export interface SessionTabEntry {
  path: string
  line: number
  column: number
  pane: number
  draft?: string
  /** 标签当时的编码（`file.read`/`file.write` 的 `EncodingKey`）。 */
  encoding?: EncodingKey
}

/** 合法编码；不认识的键一律丢掉（不把任意串喂给宿主）。 */
export function sessionEncoding(value: unknown): EncodingKey | undefined {
  return typeof value === 'string' && (SESSION_ENCODINGS as readonly string[]).includes(value) ? value as EncodingKey : undefined
}

/** 快照一条标签（`session_test` 的宿主侧对应物在原生，这里锁形状）。 */
export function sessionTabEntry(tab: { path: string; line: number; column: number; encoding?: unknown }, pane: 0 | 1, draft?: string): SessionTabEntry {
  const encoding = sessionEncoding(tab.encoding)
  return {
    path: tab.path,
    line: tab.line,
    column: tab.column,
    pane,
    ...(draft !== undefined ? { draft } : {}),
    ...(encoding !== undefined ? { encoding } : {}),
  }
}

/** 恢复时读盘的参数：条目带编码就按它读，没带就按宿主默认。 */
export function restoredReadParams(entry: { path: string; encoding?: unknown }): { path: string; encoding?: EncodingKey } {
  const encoding = sessionEncoding(entry.encoding)
  return encoding === undefined ? { path: entry.path } : { path: entry.path, encoding }
}
