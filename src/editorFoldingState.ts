// 折叠状态的**存档与重算** —— 上游 `platform/foldings/src/com/intellij/codeInsight/folding/impl/`
// 里的 `DocumentFoldingInfo`（每个文档的折叠状态）+ `UpdateFoldRegionsOperation`（新算的区间怎么并进来）
// 在本仓的等价物。
//
// 上游两条路：带**元素签名**的（靠 `ElementSignatureProvider` 找 PSI 元素 —— 本仓没有 PSI，见判决 §D.2）
// 与**按偏移**的（`myRangeMarkers`，手工折的那些）。本仓只有后者可用，所以：
//   · 存的是「偏移 + 右半行原文」这个**轻签名**（`signature`）—— 原文对不上就不恢复（上游靠
//     `myFile.getTimeStamp()` 挡住"文件在磁盘上变过"的情况，本仓前端拿不到 mtime，用原文当它）；
//   · 存的时机照 `DocumentFoldingInfo.loadFromEditor:91-110`：**折着的**都存；**展开着的**只有当它
//     "本该默认折着"（`kind` 在自动折叠那一族里）才存 —— 那是用户手动把它展开的覆盖状态
//     （上游的 `collapseByDefault == expanded` 那一支）。
//
// 重算那一半照 `UpdateFoldRegionsOperation`：
//   · `removeInvalidRegions`：新算的区间里没有的，旧折叠**删掉**（`:258-` 的 `toRemove`）；
//   · 被删的折叠把状态留在"范围 → 展开状态"那个表里（`rangeToExpandStatusMap`），同一块再回来时
//     按老状态恢复 —— 本仓的等价物是：删之前先 `capture` 进存档，下一次区间回来时恢复那一步会把它放回去；
//   · `shouldExpandNewRegion` 的规矩：**第一次**给某块建区间时，光标落在里面就不折
//     （`caretInsideRange`，`:236-238`）；已经有状态的按老状态办。
import type { Text } from '@codemirror/state'

/** 一段偏移区间。 */
export interface FoldBounds { from: number; to: number }

/** 候选区间（服务端给的 + 语法树的），`kind` 用于"本该默认折着"的判断。 */
export interface FoldCandidate extends FoldBounds { kind?: string }

/** 一条存档：偏移 + 展开状态 + 轻签名。 */
export interface FoldSnapshot extends FoldBounds { expanded: boolean; signature: string }

// ── 会话内的存档（上游存在 workspace 文件的 `CodeFoldingState` 段里；落盘那半登记在判决 §C③） ──────
const saved = new Map<string, FoldSnapshot[]>()

// 上一次重算时已知的候选（带当时的签名）。**为什么要有它**：文档一变，`foldingRanges` 那个 field
// 就被清空，等下一次服务端回话之前，"哪些区间本该默认折着"就无从判断了 —— 而"用户把它展开过"
// 这个覆盖状态正是在重算前采集的。上游那边不需要这一层：它的 `FoldRegion` 对象一直在模型里。
export interface KnownCandidate extends FoldCandidate { signature: string }
const known = new Map<string, KnownCandidate[]>()

export function rememberCandidates(path: string, candidates: readonly KnownCandidate[]): void {
  known.set(path, candidates.map(candidate => ({ ...candidate })))
}

export function knownCandidates(path: string): readonly KnownCandidate[] {
  return known.get(path) ?? []
}

/** 折着的那些区间 → 存档（签名按**当前**文档算）。 */
export function foldedSnapshots(doc: Text, folded: readonly FoldBounds[]): FoldSnapshot[] {
  return folded.map(bounds => ({ from: bounds.from, to: bounds.to, expanded: false, signature: signatureAt(doc, bounds) }))
}

/**
 * 「本该默认折着、现在却展开着」的那些块 —— 按**签名**记（编辑会把偏移推走，签名不会）。
 * 判据照 `DocumentFoldingInfo.loadFromEditor:100-110` 的 `collapseByDefault == expanded` 那一支。
 */
export function unfoldedOverrides(
  path: string,
  foldedSignatures: readonly string[],
  autoCollapseKinds: readonly string[],
): FoldSnapshot[] {
  const out: FoldSnapshot[] = []
  for (const candidate of knownCandidates(path)) {
    if (!candidate.kind || !autoCollapseKinds.includes(candidate.kind)) continue
    if (foldedSignatures.includes(candidate.signature)) continue   // 折着呢 ⇒ 不是"用户展开过"
    out.push({ from: candidate.from, to: candidate.to, expanded: true, signature: candidate.signature })
  }
  return out
}

export function savedFoldState(path: string): readonly FoldSnapshot[] {
  return saved.get(path) ?? []
}

/** 存这份文档的折叠状态（空表就删条目 —— 上游 `writeExternal` 空表也不写）。 */
export function setSavedFoldState(path: string, snapshots: readonly FoldSnapshot[]): void {
  if (snapshots.length) saved.set(path, snapshots.map(snapshot => ({ ...snapshot })))
  else saved.delete(path)
}

/** 只在测试与"文件被外部改过"的场合用。 */
export function clearSavedFoldState(path?: string): void {
  if (path === undefined) saved.clear()
  else saved.delete(path)
}

/**
 * 轻签名：起点所在**整行的原文**（去掉行首行尾空白）。
 * 折叠区间的起点常在行中间（花括号后面），行号会随编辑漂移 —— 整行原文不会，而且比"右半行"更能认得出
 * 是哪一块（每块的签名基本唯一）。上游靠 `ElementSignatureProvider` 认 PSI 元素（判决 §D.2），
 * 本仓没有 PSI，这段原文就是它的替身。
 */
export function signatureAt(doc: Text, bounds: FoldBounds): string {
  if (bounds.from < 0 || bounds.from > doc.length) return ''
  return doc.lineAt(Math.min(bounds.from, doc.length)).text.trim()
}

/**
 * 存档这一轮的折叠状态（`DocumentFoldingInfo.loadFromEditor:83-114` 的等价物）：
 * 折着的都记；「本该默认折着却展开着」的按签名记成 `expanded: true`（用户展开过的覆盖）。
 * 上一轮记下的覆盖项保留（`filter(!expanded)` 之外的那些由这次重采）。
 */
export function captureFoldState(
  path: string,
  doc: Text,
  folded: readonly FoldBounds[],
  autoCollapseKinds: readonly string[],
): void {
  setSavedFoldState(path, dedupeSnapshots([
    ...savedFoldState(path).filter(snapshot => !snapshot.expanded),
    ...foldedSnapshots(doc, folded),
    ...unfoldedOverrides(path, folded.map(bounds => signatureAt(doc, bounds)), autoCollapseKinds),
  ]))
}

/**
 * 重算时清掉失效的旧折叠（**先存后删**）：`UpdateFoldRegionsOperation.removeInvalidRegions` 的等价物。
 * 返回要展开的那些；被删的状态留在存档里，同一块再回来时由恢复那一步放回去（上游的
 * `rangeToExpandStatusMap` 干的就是这件事）。
 */
export function dropStaleFolds(
  path: string,
  doc: Text,
  candidates: readonly FoldCandidate[],
  folded: readonly FoldBounds[],
): FoldBounds[] {
  const stale = staleFolds(candidates, folded)
  if (!stale.length) return []
  setSavedFoldState(path, dedupeSnapshots([...savedFoldState(path), ...foldedSnapshots(doc, stale)]))
  return stale
}

/** 合并存档时按区间去重，后进的（更新的）状态赢。 */
export function dedupeSnapshots(snapshots: readonly FoldSnapshot[]): FoldSnapshot[] {
  const out = new Map<string, FoldSnapshot>()
  for (const snapshot of snapshots) out.set(`${snapshot.from}:${snapshot.to}`, snapshot)
  return [...out.values()]
}

/**
 * 恢复计划：
 *   ① 存档里的区间**偏移与签名都对得上** ⇒ 原处放回（`expanded` 为真的展开，用来顶掉自动折叠那一层）；
 *   ② 对不上（区间被编辑推走了、或者存档来自上一次打开）⇒ 拿存档里的签名去**候选**里认回同一块
 *      —— 上游 `DocumentFoldingInfo.computeExpandRanges:146-164` 就是这么按签名找回元素的
 *      （它靠 PSI 元素签名，本仓靠整行原文）。认不回来就放弃（宁可少恢复，不往错的地方塞折叠）。
 */
export function restorePlan(
  doc: Text,
  snapshots: readonly FoldSnapshot[],
  candidates: readonly FoldCandidate[] = [],
): { fold: FoldSnapshot[]; unfold: FoldSnapshot[] } {
  const fold: FoldSnapshot[] = []
  const unfold: FoldSnapshot[] = []
  const claimed = new Set<string>()
  for (const snapshot of snapshots) {
    if (snapshot.from >= 0 && snapshot.to <= doc.length && snapshot.from < snapshot.to
      && signatureAt(doc, snapshot) === snapshot.signature) {
      ;(snapshot.expanded ? unfold : fold).push(snapshot)
      continue
    }
    const moved = candidates.find(candidate => candidate.from < candidate.to
      && !claimed.has(`${candidate.from}:${candidate.to}`)
      && signatureAt(doc, candidate) === snapshot.signature)
    if (!moved) continue
    claimed.add(`${moved.from}:${moved.to}`)
    if (snapshot.expanded) unfold.push({ from: moved.from, to: moved.to, expanded: true, signature: snapshot.signature })
    else fold.push({ from: moved.from, to: moved.to, expanded: false, signature: snapshot.signature })
  }
  return { fold, unfold }
}

/**
 * 重算计划（`UpdateFoldRegionsOperation.removeInvalidRegions` 的等价物）：
 * 新算的候选里**没有**的那些旧折叠要删掉（旧区间已失效）；命中 `caretInsideRange` 的**新**候选不折。
 * 返回要展开的区间，调用方在展开前先 `capture` 一遍（状态留在存档里，区间再回来时按老状态恢复）。
 */
export function staleFolds(candidates: readonly FoldCandidate[], folded: readonly FoldBounds[]): FoldBounds[] {
  const keys = new Set(candidates.map(candidate => `${candidate.from}:${candidate.to}`))
  return folded.filter(bounds => !keys.has(`${bounds.from}:${bounds.to}`))
}

/** 上游 `UpdateFoldRegionsOperation.caretInsideRange`（`:236-238`）：光标在区间里（不撞起点）就不折。 */
export function caretInsideRange(caret: number, bounds: FoldBounds): boolean {
  return bounds.from < caret && caret < bounds.to
}
