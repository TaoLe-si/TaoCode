// 工程内查找的**分块发布**（上游 `SearchResults` 的 chunk 流，`SearchResults.java:87` 的
// `CHUNK_TIME_BUDGET_MS = 50` 与 `:256-306` 的 `publish(chunk, first, done, stamp)`）。
//
// 上游为什么这么做：一次搜索可能扫几万个文件，等它全走完再显示，用户面对的就是一个转圈的空白；
// 每攒够一块就先发出来，慢搜索也能**先看到命中**。本仓的宿主侧在 `native/search.cpp` 的
// `preview()` 里按"距上一块的墙钟时间 ≥ 50ms 或攒够 200 条"切块，经 `search.chunk` 事件推回来
// （上游按持有读锁的时长切块，本仓的一次扫描没有读锁，所以按墙钟 + 条数，见 `search.hpp` 的说明）。
//
// 这里只做**认领与累积**：块要认回是哪一次搜索的（`streamId` 由面板给，并发搜索时尤其重要），
// 认不回来的块（用户已经改了查询词/取消了）直接丢掉 —— 与 `src/bridge.ts` 里那两个世代计数器
// 同一种纪律：**迟到的答案不许覆盖更新的结果**。
import { reactive } from 'vue'
import type { SearchPreviewMatch } from './bridge'

/** 搜索块的流状态（面板读它来增量渲染）。 */
export const searchStream = reactive<{
  /** 当前接受的 streamId；0 = 还没有任何流。 */
  id: number
  /** 到此刻为止收到的命中（顺序与一次性结果完全一致）。 */
  matches: SearchPreviewMatch[]
  /** 到此刻为止命中过的文件数。 */
  fileCount: number
  /** 收到过几块（面板据此显示"搜索中 · 已找到 N 条"）。 */
  chunks: number
  /** 当前流是否已经结束（收到最终答复时由面板置位）。 */
  done: boolean
}>({ id: 0, matches: [], fileCount: 0, chunks: 0, done: true })

/** 一次新搜索：认领这个 id 并清空上一轮的累积。 */
export function beginSearchStream(id: number) {
  searchStream.id = id
  searchStream.matches = []
  searchStream.fileCount = 0
  searchStream.chunks = 0
  searchStream.done = false
}

/** 搜索结束（拿到最终答复，或用户取消/出错）：块不再累积。 */
export function endSearchStream() {
  searchStream.done = true
}

/**
 * 处理一条 `search.chunk` 事件；`false` = 不是本通道的消息（调用方继续往下分支）。
 * `streamId` 对不上的块**丢**：那是上一次搜索还在路上的一段，收下就会把新结果搅混。
 */
export function handleSearchChunk(data: { streamId?: number; matches?: unknown; fileCount?: number }): boolean {
  if (searchStream.done) return true
  if (typeof data.streamId !== 'number' || data.streamId !== searchStream.id) return true
  if (Array.isArray(data.matches)) searchStream.matches.push(...(data.matches as SearchPreviewMatch[]))
  if (typeof data.fileCount === 'number') searchStream.fileCount = data.fileCount
  searchStream.chunks++
  return true
}
