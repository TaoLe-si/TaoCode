// 本地抑制的即时过滤器 —— 问题面板按行「抑制此检查」后，在语言服务下一次推送之前
// 先把这条诊断从面板里隐去（上游 `SuppressIntentionAction` 应用后，daemon 立即重跑、
// 问题列表同步变短；本仓的 LSP 重算有一次往返，这里补上那段空档）。
//
// 生命周期（两条出口，避免「注释被手动删掉后面板还一直藏」）：
//   · **对账**：面板每次拿到**未过滤**的问题表就 `reconcileLocalSuppressions(rows)` ——
//     表里已经不含这个键（语言服务重算后真的不报了）就把记录丢掉；
//   · **超时**：记录只活 `SUPPRESSION_HIDE_MS`（语言服务若在插入注释后仍原样重报，
//     说明它不认这条抑制，面板到点就把行放回来，不无限期隐藏）。
//
// 记录只活在会话内（不落 localStorage）：抑制本身已经写进文件，重启后由语言服务按文件内容
// 决定要不要报，不需要本模块再记。这也是它与 `src/analysisIgnore.ts`（忽略整个文件）的分工。
import { ref } from 'vue'

/** 记账用的最小行形状（`ProblemRow` 的子集，便于单测直接构造）。 */
export interface SuppressibleRow {
  path: string
  line: number
  message: string
  source: string
}

interface SuppressionEntry {
  key: string
  /** 记账时刻（ms）。 */
  at: number
}

/** 一条诊断的记账键：同一行上的不同检查器/不同消息各自独立。 */
export function suppressionRowKey(row: SuppressibleRow): string {
  return [row.path.replace(/\\/g, '/'), row.line, row.source ?? '', row.message].join('\u0000')
}

/** 本地隐去最多持续多久（等待语言服务重算的窗口；超过就认为服务器不认这条抑制）。 */
export const SUPPRESSION_HIDE_MS = 8000

/** 已抑制但还没等到语言服务确认的键（带记账时刻）。 */
export const locallySuppressed = ref<SuppressionEntry[]>([])

export function isLocallySuppressed(row: SuppressibleRow, now = Date.now()): boolean {
  const key = suppressionRowKey(row)
  return locallySuppressed.value.some(entry => entry.key === key && now - entry.at < SUPPRESSION_HIDE_MS)
}

/** 丢掉到期记录（对账与定时器共用）。 */
function expire(now: number): void {
  const next = locallySuppressed.value.filter(entry => now - entry.at < SUPPRESSION_HIDE_MS)
  if (next.length !== locallySuppressed.value.length) locallySuppressed.value = next
}

export function noteLocalSuppression(row: SuppressibleRow, now = Date.now()): void {
  const key = suppressionRowKey(row)
  if (!locallySuppressed.value.some(entry => entry.key === key)) {
    locallySuppressed.value = [...locallySuppressed.value, { key, at: now }]
  }
  // 到点自动失效：没有后续问题表更新时也要把行放回来（浏览器与 Node 都有 setTimeout）。
  // Node 的定时器对象要 unref，否则 `node --test` 会等它到期才退出（测试从毫秒级变 8 秒）。
  if (typeof setTimeout === 'function') {
    const handle = setTimeout(() => expire(Date.now()), SUPPRESSION_HIDE_MS + 50) as unknown as { unref?: () => void }
    if (typeof handle?.unref === 'function') handle.unref()
  }
}

/** 与未过滤的问题表对账：表里不再出现的键 = 语言服务已确认不报，丢掉记录。 */
export function reconcileLocalSuppressions(rows: readonly SuppressibleRow[], now = Date.now()): void {
  if (!locallySuppressed.value.length) return
  const present = new Set(rows.map(suppressionRowKey))
  const next = locallySuppressed.value.filter(entry => present.has(entry.key) && now - entry.at < SUPPRESSION_HIDE_MS)
  if (next.length !== locallySuppressed.value.length) locallySuppressed.value = next
}

export function clearLocalSuppressions(): void {
  locallySuppressed.value = []
}
