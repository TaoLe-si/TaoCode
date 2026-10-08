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
//   · `LspDocumentHighlightCache.kt:6-11`：单槽缓存，命中规则 = `storedOffset == queriedOffset`
//     或查询位置落在任一已存区间内（`matches` 那三条的原文就是本文件 `documentHighlightHit()`）。
//   · `TextRangeAndHighlightKind.kt`：`DocumentHighlight` 列表 → 区间+kind。
//
// 本仓的接线（真实消费链路）：
//   · `src/lspNavigation.ts` 的编辑回调把 `HighlightingSnapshotCache` 挂到 `lspDiagnostics`
//     表上 —— 编辑后按 pending edit 平移/裁剪，等服务端下一次推送覆盖（见那边的注释）；
//   · `src/editorSymbolHighlight.ts` 用本文件的 `documentHighlightHit()` +
//     `src/lspPerFileCache.ts` 的 `LspPerFileCache` 组出 documentHighlight 的结果缓存
//     （上游 `LspRequestExecutor.kt:55` 那份 `documentHighlightCache` 的对应物）；
//   · `src/editorInlayHints.ts` 用本文件的 `HighlightingSnapshotCache` 存 inlayHint 的按文件快照
//     （上游 `LspInlayHintsCache.kt:17-39`，注册在 `LspHighlightingCacheRegistry.kt:31`）；
//   · `remapHighlightRanges()` 是 documentHighlight 与语义着色两条装饰层共用的
//     「编辑后区间跟着走」（本文件 `applyPendingEdit` 下面那一节）。
//
// 订正留痕（本轮自己开树核对）：仓里多处把四条分支引成 `LspCachedHighlighting.kt:38-80`
// （`src/lspHighlightingCache.ts:7`、`src/editorSemanticField.ts:19`、
// `tests/lsp-highlighting-cache.test.mjs:4`、`tests/semantic-highlighting.test.mjs:11`、
// `docs/batch-2026-10-06-lshl.md:17`），实际 `applyPendingEdits` 在 `:41-53`、
// 逐条调整的 `applyPendingEdit`（四条分支 `:65-68`/`:70-75`/`:77-82`/`:84-85`）在 `:55-87`，
// `:33-39` 是那段说明注释。旧引用没有指向别的文件、也没有跨到别的方法，只是起点落在注释尾巴上 ⇒
// 本轮不改那些既有引用（改了会让 `docs/inventory/citation-anchors.json` 的锚点整批重算），
// 新写的引用一律用 `:55-87` 这个准头。
// 与上游的差异（如实）：本仓的 push 事件（`bridge.ts` 的 `lsp.diagnostics`）不带版本号，
// 所以没有上游 :78-88 的版本闸门；下一次推送到达前，调整是近似的。
// （2026-10-06 hlregistry 亲自核过这条还成立：`native/lsp_support.cpp:127-152` 的 `shape_diagnostics`
// 逐条只搬 `range/severity/message/source/code/tags`，`PublishDiagnosticsParams.version` 在宿主这一层
// 就被丢掉了 ⇒ 本文件的 `acceptsPublishedVersion()` 现在没有数据可喂，见报告 §6。）
//
// 订正留痕（2026-10-06 hlregistry，本轮把「修订号」这条路重走了一遍）：
//   · 派单头一条写「本仓还有地方拿 `editor.state.seq` 当修订号」。**实际本仓已经没有了**：
//     `grep -rn "\.seq" src/` 的全部命中是 `src/codeLensCache.ts:57/58/60/92` 与
//     `src/codeLensExtension.ts:47` 的**注释文本**，加上 `codeLensCache.ts` 自己那条缓存记录里
//     叫 `seq` 的私有字段（`:133` 声明、`:222` 读、`:256`/`:273` 写）—— 那个字段是缓存内部的状态，
//     号由调用方 `semanticRevisionOf(editor.state.doc)` 供给（`src/codeLensExtension.ts:417`），
//     不是 `EditorState` 上的属性。`@codemirror/state` 6.7.6 的 `EditorState` 确实没有 `seq`
//     （`node_modules/@codemirror/state/dist/index.d.ts` 零命中），所以下面这一条是真判据：
//     **本文件的 `stamp` 参数必须由调用方给一个「每改一次就换」的号**，仓里现成的号源是
//     `src/semanticHighlighting.ts:346` 的 `semanticRevisionOf(doc)`（文档对象身份）。
//   · 顺着这条查出**本模块自己的**一处真缺陷：`acceptFull`/`acceptUnchanged`/`acceptFailed`
//     原来**无条件**删 `sentStamps`（那份「同一版本已经在飞」的去重标记）。上游删它有三处，
//     每一处都带「这条标记是不是我这一次请求的」这一问：`:122-131`（`finally` 里先问
//     `fileToInFlightRequest[file] === job` 才放开，注释 `:125-128` 明写「更新的那一发接管以后
//     两个条目都属于它，别动」）、`:209` 与 `:236-238`（`remove(file, docModStamp)` 双参 =
//     **只有值也相等才删**）。无条件删的后果是具体的：R1 的请求在飞、文档变成 R2 并已经为 R2
//     发了第二发，这时 R1 的迟到答复被接受闸门挡掉（`:250`/`:173` 这条判据本身是对的），
//     却顺手把 **R2 的去重标记**抹了 ⇒ 下一拍 `pullPlan(path, R2)` 又回 `request` ⇒
//     同一个文档版本向服务器发第二遍，正是上游 `:96-102` 那段注释要拦的「发一次、马上
//     `$/cancelRequest`、再发一次」那一串。本轮改成按值释放。
//   · 另一条同族缺项：`fileEdited` 原来只问「有没有快照」，上游 `:249-253` 问的是
//     「这一份快照里**有没有正在显示的东西**」（`cachedHighlightings.isNullOrEmpty()` 才不记）。
//     空快照（服务端权威回答「这个文件没有提示」）也照记的话，`pendingEdits` 在一次长会话里
//     按编辑次数无界增长，而那些编辑永远不会被应用（没有区间可平移）。本轮按上游补上这一问。

import type { ChangeSet } from '@codemirror/state'

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
 *
 * 订正留痕（2026-10-06 hlregistry）：**这个值不等于上游那颗号**，只能用在「拿正文重新换算行列」
 * 这类真的只需要内容同源的地方（本仓现存唯一的生产用法是 `src/lspNavigation.ts:239/246` 给
 * push 诊断的区间做本地重锚）。上游那颗号的口径是「**改一次就换一个**」，与内容是否真的不同无关
 * （`platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:171` 每次
 * `replaceString` 领一个新号；`src/documentRevisions.ts:22-28` 把这三条口径逐字写在那本账上）。
 * 内容哈希在「删掉几个字又敲回去」时**不换号** ⇒ 缓存判定为 `fresh`、不发重取，而服务端那一侧
 * 已经收到过两次 `didChange`、答案可能已经不同。要给缓存当 stamp 用的号源是本仓的
 * `src/semanticHighlighting.ts:346` 的 `semanticRevisionOf(doc)`（CodeMirror 的 `Text` 不可变，
 * 换一次正文就换一个对象 ⇒ 对象身份即号），`src/editorInlayHints.ts:230/259`、
 * `src/codeLensExtension.ts:417/437` 走的都是这条路。
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

/**
 * 上游 `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt`
 * companion object 里那两个静默窗口（quiescence = 「文档得先稳定这么久才发拉取」的等待值）：
 *   · `:321` `DIAGNOSTICS_QUIESCENCE_DELAY: Duration = 250.milliseconds`（`:316-320` 给的理由是
 *     诊断是用户在等的东西，比低优先级那一档短，但仍要吃得下 100-200ms 的打字节奏）；
 *   · `:328` `LOW_PRIORITY_QUIESCENCE_DELAY: Duration = 300.milliseconds` —— `:324-327` 原文把这一族
 *     点名成 "Semantic tokens, document links, folding, code lens, inlay hints, and colors"，
 *     即打字期间可以等的全部拉取，**code lens 就在这一族里**（本仓 `src/codeLens.ts` 的编辑档
 *     用的就是下面这个常量，不再自己另写一个数）；
 *   · `:52` `protected open val quiescenceDelay: Duration get() = LOW_PRIORITY_QUIESCENCE_DELAY`
 *     是子类缺省取用的那一条引用 —— 它和 `:328` 是**同一个数**，不是"另一档 300"。
 * 两个数都只管静默窗口这一件事：首次拉取绕开窗口（`:146` 的 `!isFirstPullFor(file)`，
 * 判断本身在 `:161`），所以文件打开延迟不受这两个数影响。
 *
 * 订正留痕（2026-10-06 hlcache300）：审计单把 "`changeMs = 400`，上游那一对是 300" 记在本文件名下 ——
 * 本文件没有 `changeMs`（只有上面这两个 250/300，本来就和上游 `:321`/`:328` 同源）。那个 400 实际在
 * `src/codeLens.ts:245` 的 `CODE_LENS_REFRESH.changeMs`，同处注释自称"与其它 LSP 能力同档"；
 * 本轮按上游 `:328` 把它对齐成 300，见那边的注释与 `tests/code-lens-refresh.test.mjs`。
 */
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
  /**
   * 上游 `LspHighlightingCache.kt:55` 的 `internal open val supportsPull: Boolean get() = true`：
   * `false` = 这一族的结果由服务端**推**过来、客户端从不为它发拉取（上游唯一的一条 `false` 是
   * `LspPublishDiagnosticsCache.kt:31`，注册在注册表 `:26`）。它有两个读者：
   *   · 调度：上游 `getHighlightings` 的 `:69` 那句 `if (supportsPull && …)` —— 非拉取族**永不**排重取；
   *   · 注册表扇出：`LspHighlightingCacheRegistry.kt:54-56` 的 `invalidatePulledResults(file)`
   *     只对 `supportsPull` 的那几条做 `forceFullRepull`（推的那一条由服务端自己重发）。
   * 本仓这两个读者目前都只到第二个（第一个读者要 `pullPlan` 不改返回值形状，见报告 §6 的取舍），
   * 所以这一格现在是**注册表用的真值**，不是摆设：默认 `true` 与上游缺省一致，
   * push 那一族（`src/lspNavigation.ts:217` 的 `diagnosticRanges`）应显式传 `false` ——
   * 那个调用点不是本代理的可写面，已按规约写成接线请求（R3）。
   */
  readonly supportsPull: boolean

  constructor(options: { staleStamp?: number | string; quiescenceDelayMs?: number; supportsPull?: boolean } = {}) {
    this.staleStamp = options.staleStamp ?? STALE_DOC_STAMP
    this.quiescenceMs = options.quiescenceDelayMs ?? LOW_PRIORITY_QUIESCENCE_MS
    this.supportsPull = options.supportsPull ?? true
    // 参与批量作废：语言服务重启或服务器发 `workspace/…/refresh` 时整族清掉
    // （注册表与两个触发点见 `src/lspPerFileCache.ts` 的 `:24-57`，分派在 `src/lspServerMessages.ts`
    // 的 `handleRefresh`；留痕：这里原来写「分派见 `src/lspProgress.ts`」，那个文件只做进度条与
    // 消息的表，不作废缓存 —— 同一条订正 `src/lspPerFileCache.ts:36-38` 已经记过一遍）。
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

  /** 文档编辑：记一条 pending edit。 */
  fileEdited(file: string, edit: PendingEdit): void {
    // 上游 `LspHighlightingCache.kt:249-253`：记不记这一条，问的是「这一份快照里**还有东西在显示**」
    // （`if (!fileToCachedHighlightingsSnapshot[file]?.cachedHighlightings.isNullOrEmpty())`），
    // 不是「有没有快照」。空快照（服务端权威回答「这个文件这一族没有结果」）没有区间可平移，
    // 记下来只会让 `pendingEdits` 在一次长会话里按编辑次数无界增长。
    const snapshot = this.snapshots.get(file)
    if (!snapshot || snapshot.cached.length === 0) return
    this.pendingEdits.set(file, [...(this.pendingEdits.get(file) ?? []), edit])
  }

  /** 这一族当前攒了几条待应用的 pending edit（判据与排查用；上游 `fileToPendingEdits[file]` 的长度）。 */
  pendingEditCount(file: string): number {
    return this.pendingEdits.get(file)?.length ?? 0
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

  /**
   * 释放「这一版本已经在飞」的去重标记 —— **只有这一发自己占着标记时才释放**。
   * 上游删它的三处都带这一问：`:122-131`（`finally` 里先确认 `fileToInFlightRequest[file] === job`
   * 才放开槽与去重闸，注释 `:125-128` 明写「更新的那一发接管以后，两个条目都属于它 ⇒ 别动」）、
   * `:209` 与 `:236-238`（`fileToStampWhenRequestSent.remove(file, docModStamp)` 是**双参** remove
   * = 键与值都对上才删）。无条件删会把**别人**（为更新版本发的那一发）的标记抹掉，
   * 于是下一拍 `pullPlan` 又回 `request` ⇒ 同一个文档版本向服务器发第二遍。
   */
  private releaseSentStamp(file: string, stamp: number | string): void {
    if (this.sentStamps.get(file) === stamp) this.sentStamps.delete(file)
  }

  /** 接受一次 Full 响应：stamp 与请求时一致才提交（上游 `responseReceived` 的闸门）。 */
  acceptFull(file: string, stamp: number | string, currentStamp: number | string, highlightings: readonly LspCachedHighlighting<T>[]): boolean {
    // 上游 `:170-177` 的拒绝分支也要放开自己那一发的标记（答复已经被闸门挡掉，这一次请求到此为止），
    // 但不许动更新那一发的标记 —— 顺序与 `:236-238` 一致：先按值释放，再决定是否提交快照。
    this.releaseSentStamp(file, stamp)
    if (stamp !== currentStamp) return false
    this.snapshots.set(file, { stamp, cached: [...highlightings] })
    this.pendingEdits.delete(file)
    return true
  }

  /** 接受 `Unchanged`：只刷新 stamp 与在途标记，保留内容与 pending edits。没有快照则不接受。 */
  acceptUnchanged(file: string, stamp: number | string, currentStamp: number | string): boolean {
    this.releaseSentStamp(file, stamp)
    const snapshot = this.snapshots.get(file)
    if (!snapshot || stamp !== currentStamp) return false
    this.snapshots.set(file, { stamp, cached: snapshot.cached })
    return true
  }

  /**
   * 失败：清在途标记，保留旧快照，下一次 `pullPlan` 会重发。
   * 上游这一条走的是 `:112`（`Failed` 什么都不做）+ `:121-132` 的 `finally` ⇒ 释放的仍然是
   * **按值**那一条（`:129` 的 `remove(file, docModStamp)`）。所以调用方应当把发请求时那个 stamp
   * 一起传进来；不带 stamp 的旧写法只能退化成无条件释放（会把更新那一发的标记一起抹掉，
   * 也就是上面那条注释里要防的事），本仓现存三个调用点 `src/editorInlayHints.ts:246/248/257`
   * 都是这种，已写成接线请求 R2。
   */
  acceptFailed(file: string, stamp?: number | string): void {
    if (stamp === undefined) { this.sentStamps.delete(file); return }
    this.releaseSentStamp(file, stamp)
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

  /**
   * 强制整份重取。上游 `LspHighlightingCache.kt:274-280` 的基类实现就是 `invalidate(file)` 本身，
   * 「连可以答 unchanged 的凭据一起丢弃」那一半在**子类**的 override 里
   * （`highlighting/LspPullDiagnosticsCache.kt:100-110`：先 `fileToResultIds.remove(file)` 再 `invalidate`；
   * 本仓的 `resultId` 不在缓存里，见接线请求 R1 的附带说明）。
   * 留痕：这一条原来引成 `:230-236`（那是 `applyServerHighlightings`，与"丢凭据"无关）。
   */
  forceFullRepull(file: string): void {
    this.invalidate(file)
  }

  clearCache(): void {
    this.snapshots.clear()
    this.pendingEdits.clear()
    this.sentStamps.clear()
  }
}

// ---------------------------------------------------------------- 编辑后「区间跟着走」（CodeMirror 版）

/**
 * `applyPendingEdit`（`LspCachedHighlighting.kt:55-87`，四条分支写在 `:33-39` 那段注释里）在 CodeMirror
 * 这一侧的等价物：这里能拿到 `ChangeSet.mapPos`（精确映射），上游只有按 diff 长度近似。
 * 语义与上游逐条对得上：
 *   · 编辑在区间之前 ⇒ 整体右移（`:70-75`）；编辑在区间之后 ⇒ 不动（`:65-68`）；
 *   · 编辑落在区间之内 ⇒ 区间随插入变长 / 随删除变短（`:77-82` 的 `grown`）；
 *   · 编辑把区间吃掉 ⇒ 映射后零宽，这里丢掉不画（`:84-85` 的 `iterator.remove()`）。
 * 两端都**朝内容内侧**映射（`mapPos(start, +1)` / `mapPos(end, -1)`）：插在区间前后的字符不会被染进
 * 这一条，与上游「编辑落在区间开始处算『在区间之前』⇒ 整体右移」同口径。
 *
 * 为什么装饰层必须做这一步（用户可见的那一半）：上游 `LspClientImpl.kt:215-220` 的注释原话是
 * 「不做这一步，编辑之前应用上的高亮会一直停在旧偏移上，直到下一次 daemon pass」—— 本仓服务端答案
 * 只在取用的那一刻与文档同源，之后全靠这里跟着 `ChangeSet` 走。
 *
 * 消费方：`src/editorSymbolHighlight.ts`（documentHighlight 的区间）与
 * `src/editorSemanticField.ts`（语义着色的区间）。
 */
export function remapHighlightRanges<T>(
  items: readonly T[],
  changes: ChangeSet,
  rangeOf: (item: T) => TextRange,
  withRange: (item: T, range: TextRange) => T,
): T[] {
  const out: T[] = []
  for (const item of items) {
    const range = rangeOf(item)
    const start = changes.mapPos(range.start, 1)
    const end = changes.mapPos(range.end, -1)
    if (end <= start) continue
    out.push(withRange(item, { start, end }))
  }
  return out
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

/**
 * `LspDocumentHighlightCache.kt:8-10` 的 `matches`：同偏移，或查询点落在任一已存区间内。
 * 生产消费方是 `src/editorSymbolHighlight.ts` 的那份结果缓存（上游 `LspRequestExecutor.kt:55`
 * 登记进 `allCaches` 的 `documentHighlightCache`）—— 光标在同一条引用上来回挪不再重发请求。
 */
export function documentHighlightHit(storedOffset: number, stored: readonly TextRange[], queriedOffset: number): boolean {
  return storedOffset === queriedOffset || stored.some(range => queriedOffset >= range.start && queriedOffset <= range.end)
}

/** `TextRangeAndHighlightKind.fromDocumentHighlights`：过滤掉不能落在文档里的区间由调用方做。 */
export function textRangeAndHighlightKind<K>(highlights: readonly { range: TextRange; kind: K }[]): Array<{ textRange: TextRange; kind: K }> {
  return highlights.map(highlight => ({ textRange: highlight.range, kind: highlight.kind }))
}
