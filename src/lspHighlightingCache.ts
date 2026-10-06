// LSP 高亮结果的**区间缓存** —— 上游 `platform/lsp-impl/src/impl/features/highlighting`
// 与 `highlightingCommon` 的可移植子集。
//
// 上游逐类：
//   · `LspCachedHighlighting.kt`：`(TextRange, highlightingInfo)` 二元组 —— 服务端给的高亮
//     落到宿主文档偏移后与载荷一起存。
//   · `LspCachedHighlighting.kt:PendingEdit` + `applyPendingEdits`（:38-80）：文档编辑后
//     先把缓存区间**平移/裁剪**，等服务端下一次权威结果覆盖。四条分支逐一照抄：
//       ① 编辑完全在区间之后 → 不动；
//       ② 编辑完全在区间之前 → 整体右移 `newLength - oldLength`；
//       ③ 编辑被区间包含 → 区间按差值 `grown`（变长/变短）；
//       ④ 与区间部分相交 → **删除**该高亮（位置已不可信，不画错行）。
//   · `LspHighlightingCache.kt`：按文件快照（记 `docModStamp`）、在途请求去重
//     （`fileToStampWhenRequestSent` 同 stamp 只发一次）、响应接受闸门（stamp 变则丢弃并重发）、
//     `Unchanged` 只刷新 stamp 保留内容、`Failed` 保留旧状态下次重试、`invalidate`
//     （服务端强制刷新：取消在飞 + 记 `STALE_DOC_MOD_STAMP`=−1 让下次必发）、
//     `forceFullRepull`、`clearCache`；stamp 用的就是本仓的「内容签名」。
//   · `LspPullResult.kt`：Full / Unchanged / Failed；`aggregateToPullResult` 在
//     `LspClientImpl` 里（任一文档失败 → Failed）。
//   · `LspPublishDiagnosticsCache.kt:44-56,66-101`：push 缓存按 **documentUri** 分桶合并
//     （一个文件可以有多个 LSP 文档）、带版本的通知与当前文档版本不符时**丢弃**
//     （:78-88），未打开的文件不进编辑器显示。
//   · `LspDiagnosticAndLazyQuickFixes.kt:37-54`：quick fix **惰性求值 + 记忆化** ——
//     只有真的要显示修复列表时才去要，之后不再重复请求。
//   · `LspDocumentHighlightCache.kt`：单槽缓存，命中规则 = `storedOffset == queriedOffset`
//     或查询位置落在任一已存区间内。
//   · `TextRangeAndHighlightKind.kt`：`DocumentHighlight` 列表 → 区间+kind。
//
// 本仓的接线（真实消费链路）：`src/lspNavigation.ts` 的编辑回调把它挂到 `lspDiagnostics`
// 表上 —— 编辑后按 pending edit 平移/裁剪，等服务端下一次推送覆盖（见那边的注释）。
// 与上游的差异（如实）：本仓的 push 事件（`bridge.ts` 的 `lsp.diagnostics`）不带版本号，
// 所以没有上游 :78-88 的版本闸门；下一次推送到达前，调整是近似的。

import { registerLspCache } from './lspPerFileCache.ts'

/** 宿主文档偏移区间（上游 `com.intellij.openapi.util.TextRange` 的半开区间）。 */
export interface TextRange { start: number; end: number }

/** `LspCachedHighlighting<T>`。 */
export interface LspCachedHighlighting<T> { textRange: TextRange; highlightingInfo: T }

/** `PendingEdit`（偏移 + 旧长度 + 新长度）。 */
export interface PendingEdit { offset: number; oldLength: number; newLength: number }

/** `LspPullResult.kt` 的三态。 */
export type LspPullResult<T> =
  | { kind: 'full'; items: Array<{ range: TextRange; info: T }> }
  | { kind: 'unchanged' }
  | { kind: 'failed' }

/** 一次拉取里每个文档一条结果；任一失败 → 整次失败（上游 `aggregateToPullResult`）。 */
export function aggregatePullResults<T>(results: readonly (LspPullResult<T> | null)[]): LspPullResult<T> {
  if (results.some(result => result === null || result.kind === 'failed')) return { kind: 'failed' }
  if (results.some(result => result?.kind === 'unchanged')) return { kind: 'unchanged' }
  const items = results.flatMap(result => result && result.kind === 'full' ? result.items : [])
  return { kind: 'full', items }
}

/**
 * `applyPendingEdits`（LspCachedHighlighting.kt:38-80）的逐条移植。
 * 纯函数；不做去重合并（上游 `MultiMap` 里的编辑按到达顺序依次应用）。
 */
export function applyPendingEdits<T>(highlightings: readonly LspCachedHighlighting<T>[], edits: readonly PendingEdit[]): LspCachedHighlighting<T>[] {
  if (!edits.length) return [...highlightings]
  let updated = [...highlightings]
  for (const edit of edits) updated = applyPendingEdit(updated, edit)
  return updated
}

function applyPendingEdit<T>(highlightings: readonly LspCachedHighlighting<T>[], edit: PendingEdit): LspCachedHighlighting<T>[] {
  const editOldEnd = edit.offset + edit.oldLength
  const out: LspCachedHighlighting<T>[] = []
  for (const highlighting of highlightings) {
    const range = highlighting.textRange
    // ① 编辑完全在区间之后：不动。
    if (edit.offset >= range.end) { out.push(highlighting); continue }
    // ② 编辑完全在区间之前：整体右移。
    if (editOldEnd <= range.start) {
      const delta = edit.newLength - edit.oldLength
      out.push({ textRange: { start: range.start + delta, end: range.end + delta }, highlightingInfo: highlighting.highlightingInfo })
      continue
    }
    // ③ 编辑被区间包含：按差值 grown（区间先起点后终点，永远是合法半开区间）。
    if (edit.offset >= range.start && editOldEnd <= range.end) {
      out.push({ textRange: { start: range.start, end: Math.max(range.start, range.end + edit.newLength - edit.oldLength) }, highlightingInfo: highlighting.highlightingInfo })
      continue
    }
    // ④ 部分相交：区间已不可信，删除（不画错行）—— 等价上游 `iterator.remove()`。
  }
  return out
}

// ---------------------------------------------------------------- 文本位置换算（诊断/高亮的行列 ↔ 偏移）

/** 每行起始偏移（0 基行）。 */
export function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; ++index) if (text.charCodeAt(index) === 10) starts.push(index + 1)
  return starts
}

/** (line, character)（0 基，LSP 约定）→ 偏移；越界夹到合法范围。 */
export function offsetOfPosition(text: string, line: number, character: number): number {
  const starts = lineStartsOf(text)
  const row = Math.min(Math.max(0, Math.trunc(line)), starts.length - 1)
  const start = starts[row]!
  const end = row + 1 < starts.length ? starts[row + 1]! - 1 : text.length
  return Math.min(Math.max(start, start + Math.max(0, Math.trunc(character))), end)
}

/** 偏移 → (line, character)（0 基）。 */
export function positionOfOffset(text: string, offset: number): { line: number; character: number } {
  const starts = lineStartsOf(text)
  const clamped = Math.min(Math.max(0, offset), text.length)
  let line = 0
  while (line + 1 < starts.length && starts[line + 1]! <= clamped) ++line
  return { line, character: clamped - starts[line]! }
}

/** 一次编辑的最小表示：公共前缀/后缀之外的一段（等价的 `DocumentEvent`）。 */
export function textEditBetween(oldText: string, newText: string): PendingEdit {
  let prefix = 0
  const max = Math.min(oldText.length, newText.length)
  while (prefix < max && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) ++prefix
  let suffix = 0
  while (suffix < max - prefix
    && oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)) ++suffix
  return { offset: prefix, oldLength: oldText.length - prefix - suffix, newLength: newText.length - prefix - suffix }
}

/**
 * 文档「内容签名」（FNV-1a + 长度）—— 上游用 `Document.modificationStamp`（一个也会碰撞的整数），
 * 本仓没有 PSI 修改计数，用这个便宜的变更检测值当 stamp。
 */
export function contentStamp(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; ++index) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (Math.imul(hash >>> 0, 31) ^ text.length) >>> 0
}

// ---------------------------------------------------------------- 按文件快照的缓存（LspHighlightingCache）

/** 被服务端强制刷新过的 stamp：绝不等于真实内容签名，保证下一次 `pullPlan` 会发请求。 */
export const STALE_DOC_STAMP = -1

/** 上游 `DIAGNOSTICS_QUIESCENCE_DELAY` / `LOW_PRIORITY_QUIESCENCE_DELAY`。 */
export const DIAGNOSTICS_QUIESCENCE_MS = 250
export const LOW_PRIORITY_QUIESCENCE_MS = 300

interface Snapshot<T> { stamp: number | string; cached: LspCachedHighlighting<T>[] }

/** `pullPlan` 的结论：发请求 / 同版本已发过去重 / 缓存已是最新。 */
export type PullPlan = 'request' | 'dedup' | 'fresh'

/**
 * `LspHighlightingCache.kt` 的状态机（去掉协程与锁，stamp 由调用方给 = 内容签名）。
 * 一个实例管一种高亮（语义 token / 诊断 / 文档链接…），按文件存快照。
 */
export class HighlightingSnapshotCache<T> {
  private readonly snapshots = new Map<string, Snapshot<T>>()
  private readonly pendingEdits = new Map<string, PendingEdit[]>()
  private readonly sentStamps = new Map<string, number | string>()
  private readonly staleStamp: number | string
  private readonly quiescenceMs: number

  constructor(options: { staleStamp?: number | string; quiescenceDelayMs?: number } = {}) {
    this.staleStamp = options.staleStamp ?? STALE_DOC_STAMP
    this.quiescenceMs = options.quiescenceDelayMs ?? LOW_PRIORITY_QUIESCENCE_MS
    // 参与批量作废：语言服务重启或服务器发 `workspace/…/refresh` 时整族清掉
    // （注册表与两个触发点见 `src/lspPerFileCache.ts`，分派见 `src/lspProgress.ts`）。
    registerLspCache(this)
  }

  /** 上游 `quiescenceDelay`：首次拉取不走静默窗口。 */
  quiescenceDelayFor(file: string): number {
    return this.snapshots.has(file) || this.sentStamps.has(file) ? this.quiescenceMs : 0
  }

  /**
   * `getHighlightings` 的调度判定（同步版）：stamp 与快照不同 → 该发请求；
   * 同一 stamp 已发过 → 去重；快照就是这个 stamp → 已最新。
   */
  pullPlan(file: string, stamp: number | string): PullPlan {
    const snapshot = this.snapshots.get(file)
    if (snapshot && snapshot.stamp === stamp && stamp !== this.staleStamp) return 'fresh'
    if (this.sentStamps.get(file) === stamp) return 'dedup'
    this.sentStamps.set(file, stamp)
    return 'request'
  }

  /** 文档编辑：记一条 pending edit（没有快照就什么都不用调整）。 */
  fileEdited(file: string, edit: PendingEdit): void {
    if (!this.snapshots.has(file)) return
    this.pendingEdits.set(file, [...(this.pendingEdits.get(file) ?? []), edit])
  }

  /**
   * 取该文件当前的已调整区间（同 `getHighlightings`）：应用并清空 pending edits。
   * 若快照比当前 stamp 旧，调用方应先按 `pullPlan` 发请求；现有内容照旧返回（不闪断）。
   */
  highlightingsFor(file: string): LspCachedHighlighting<T>[] {
    const snapshot = this.snapshots.get(file)
    if (!snapshot) return []
    const adjusted = applyPendingEdits(snapshot.cached, this.pendingEdits.get(file) ?? [])
    this.snapshots.set(file, { stamp: snapshot.stamp, cached: adjusted })
    this.pendingEdits.delete(file)
    return adjusted
  }

  snapshotStamp(file: string): number | string | null {
    return this.snapshots.get(file)?.stamp ?? null
  }

  /** 接受一次 Full 响应：stamp 与请求时一致才提交（上游 `responseReceived` 的闸门）。 */
  acceptFull(file: string, stamp: number | string, currentStamp: number | string, highlightings: readonly LspCachedHighlighting<T>[]): boolean {
    this.sentStamps.delete(file)
    if (stamp !== currentStamp) return false
    this.snapshots.set(file, { stamp, cached: [...highlightings] })
    this.pendingEdits.delete(file)
    return true
  }

  /** 接受 `Unchanged`：只刷新 stamp 与在途标记，保留内容与 pending edits。没有快照则不接受。 */
  acceptUnchanged(file: string, stamp: number | string, currentStamp: number | string): boolean {
    this.sentStamps.delete(file)
    const snapshot = this.snapshots.get(file)
    if (!snapshot || stamp !== currentStamp) return false
    this.snapshots.set(file, { stamp, cached: snapshot.cached })
    return true
  }

  /** 失败：清在途标记，保留旧快照，下一次 `pullPlan` 会重发。 */
  acceptFailed(file: string): void {
    this.sentStamps.delete(file)
  }

  /**
   * 服务端强制刷新（`workspace/.../refresh`）：在飞请求作废、记 STALE stamp，
   * 但**保留当前内容**直到新结果到达（不闪断）。
   */
  invalidate(file: string): void {
    this.sentStamps.delete(file)
    const snapshot = this.snapshots.get(file)
    if (!snapshot) return
    this.snapshots.set(file, { stamp: this.staleStamp, cached: snapshot.cached })
  }

  /** 强制整份重取（`:230-236`：连「可以答 unchanged」的凭据一起丢弃）。 */
  forceFullRepull(file: string): void {
    this.invalidate(file)
  }

  clearCache(): void {
    this.snapshots.clear()
    this.pendingEdits.clear()
    this.sentStamps.clear()
  }
}

// ---------------------------------------------------------------- 诊断专用（LspPublishDiagnosticsCache）

/** `LspPublishDiagnosticsCache.kt:88-95`：一个文件下按 documentUri 分桶，取出时全量合并。 */
export function mergePublishedDiagnostics<T>(byUri: Map<string, readonly T[]>, uri: string, items: readonly T[]): T[] {
  byUri.set(uri, items)
  return [...byUri.values()].flatMap(list => [...list])
}

/**
 * `LspPublishDiagnosticsCache.kt:78-88`：**已打开**文件的推送带版本号且与当前文档版本不符时丢弃
 * （旧版本的诊断不显示，等服务端重发）。未打开的文件不比版本 —— 没有编辑，不会出现视觉错位。
 */
export function acceptsPublishedVersion(declaredVersion: number | null | undefined, currentVersion: number | null, fileOpen: boolean): boolean {
  if (!fileOpen || declaredVersion === null || declaredVersion === undefined) return true
  if (currentVersion === null) return true
  return declaredVersion === currentVersion
}

// ---------------------------------------------------------------- 惰性 quick fix（LspDiagnosticAndLazyQuickFixes）

export interface LazyQuickFixes<T> {
  /** 首次调用执行 `compute`，之后返回同一结果（上游记忆化）。 */
  get(): T[]
  /** 已经算过了吗（测试与调试用）。 */
  readonly computed: boolean
}

/** `LspDiagnosticAndLazyQuickFixes.kt:37-54`：只有真要显示时才求值，之后不重复请求。 */
export function createLazyQuickFixes<T>(compute: () => T[]): LazyQuickFixes<T> {
  let cached: T[] | null = null
  return {
    get(): T[] {
      if (cached === null) cached = compute()
      return cached
    },
    get computed(): boolean { return cached !== null },
  }
}

// ---------------------------------------------------------------- 文档高亮相位的命中规则

/** `LspDocumentHighlightCache.kt` 的 `matches`：同偏移或查询点落在任一已存区间内。 */
export function documentHighlightHit(storedOffset: number, stored: readonly TextRange[], queriedOffset: number): boolean {
  return storedOffset === queriedOffset || stored.some(range => queriedOffset >= range.start && queriedOffset <= range.end)
}

/** `TextRangeAndHighlightKind.fromDocumentHighlights`：过滤掉不能落在文档里的区间由调用方做。 */
export function textRangeAndHighlightKind<K>(highlights: readonly { range: TextRange; kind: K }[]): Array<{ textRange: TextRange; kind: K }> {
  return highlights.map(highlight => ({ textRange: highlight.range, kind: highlight.kind }))
}
