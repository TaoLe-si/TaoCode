// 监视表达式（Watches）的**跨会话持久化** —— 上游 `XWatchesView`（`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/frame/XWatchesView.java`）
// 由 `XDebuggerWatchesManagerImpl`（`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/XDebuggerWatchesManagerImpl.java:50`）
// 随项目状态保存：`saveState(WatchesManagerState)` 在 `:123`、`loadState` 在 `:142`，
// 键是**运行配置名**（`getWatchEntries(configurationName)` `:82` / `setWatchEntries` `:87`）。
// 这里把同一件事落到 localStorage：按**项目根**分键（本仓一个项目一份调试会话，没有按配置名分槽的
// `XDebugSession`，与 `src/externalProjectModel.ts` 的任务激活表同一族键策略），
// 关掉应用再打开，Watches 里上次盯的表达式还在。
// （12c 订正：原写「`platform/xdebugger-impl/.../watch/WatchesManager`」—— 参考树里没有 `WatchesManager` 这个类，
// 按文件名（Glob）、按包路径（`xdebugger-impl/ui/.../frame/`）、按语义（`grep -rn "WatchesManagerState"`）三条路各搜过，
// 真名是上面那个 `XDebuggerWatchesManagerImpl`。）
//
// 只存表达式文本：值随会话变，存下来只会是过期数据（上游也是启动时按当前帧重算）。
// 规则纯函数化（解析 / 序列化 / 上限 / 去重），存储对象由调用方传入 —— 单测不需要 window。
//
// 与上游的一处如实差异：IDEA 的 watches 可以分组（`XWatchesTree` 的组节点），
// 本仓是单层列表，分组没落（见 dbg/frames-vars 判词）。

/** 存储键前缀；项目根作为后缀（空根 = 应用级一份，与 IDEA 的 "Default" 项目同一档）。 */
export const DEBUG_WATCHES_KEY = 'taocode.debugWatches'

/** 上限：够盯常用表达式，又不会把 localStorage 塞爆。 */
export const DEBUG_WATCHES_LIMIT = 100

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 项目根归一后拼键（反斜杠统一成 `/`，去尾斜杠；空根退回应用级）。 */
export function watchesStorageKey(root: string): string {
  const normalized = root.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized ? `${DEBUG_WATCHES_KEY}:${normalized}` : DEBUG_WATCHES_KEY
}

/** 解析存下来的数组：坏数据/非字符串条目跳过，trim 后去重（保序），超上限截断。 */
export function parseWatches(raw: string | null | undefined): string[] {
  if (!raw) return []
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const out: string[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue
    const text = entry.trim()
    if (!text || out.includes(text)) continue
    out.push(text)
    if (out.length >= DEBUG_WATCHES_LIMIT) break
  }
  return out
}

export function serializeWatches(list: readonly string[]): string {
  return JSON.stringify(parseWatches(JSON.stringify(list)))
}

/** 读（存储不可用/坏数据 → 空表，不抛）。 */
export function loadWatches(store: StorageLike | null | undefined, root: string): string[] {
  if (!store) return []
  try { return parseWatches(store.getItem(watchesStorageKey(root))) } catch { return [] }
}

/** 写回（存储不可用只影响持久化，不影响会话内的 watches）。 */
export function saveWatches(store: StorageLike | null | undefined, root: string, list: readonly string[]): void {
  if (!store) return
  try { store.setItem(watchesStorageKey(root), serializeWatches(list)) } catch { /* session-only */ }
}
