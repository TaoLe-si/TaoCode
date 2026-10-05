// 三方合并的**模型与自动解决**（上游 `com.intellij.diff` 里那三样纯算法：
// `ByLineRt.merge` / `ComparisonMergeUtil` / `MergeRangeUtil.getLineMergeType` /
// `MergeResolveUtil.tryResolve`）。
//
// 上游那张三栏窗口（`MergeThreesideViewer`）要的是 **VCS 给的三份内容**（base / left / right）。
// 本仓读不到索引的三阶段内容，但 git 把它自己写进了工作区文件：
//
//     <<<<<<< HEAD
//     我们的内容
//     ||||||| <基线>        ← diff3 风格才有这一段
//     基线内容
//     =======
//     他们的内容
//     >>>>>>> feature/x
//
// 所以本模块把**模型与算法**还原到标记文本上：把每个冲突块拆成三份 → 判冲突类型 →
// 能不能自动解决。三个用户可见的动作因此有了落点（接线在 `src/mergeResolveHost.ts`）：
//
//   · 「解决简单的冲突」（`Diff.MagicResolveConflicts` → `MergeConflictModel.getAutoResolvableChanges`
//     的 `canResolveChangeAutomatically(index, ThreeSide.BASE)` → `ComparisonMergeUtil.tryResolveConflict`）
//     —— 一条冲突只要不是真冲突（两侧都改、且改得不一样）就能自动合掉；
//   · 「应用所有不冲突的更改」（`Diff.ApplyNonConflicts` → `hasNonConflictedChanges`）
//     —— 只把"一侧没动"的那部分并进去，真冲突原样留着；
//   · 逐条「接受左侧/接受右侧」已经在 `src/mergeConflicts.ts`（编辑器里的 `MergeBar`）。
//
// **与上游的一处口径差（如实记）**：上游 `MergeResolveUtil` 用 `ByWordRt` 按**词**判冲突类型，
// 本仓按**行**判（比较的粒度就是本仓的输入粒度）。行级比词级**更保守**：词级能自动合掉的
// "同一行里两处不同的词改动"，行级会当成真冲突留给用户 —— 少自动合，不会合错。
//
// 本模块零依赖（不 import bridge），能被 `node --test` 直接加载。

import { comparisonKey, type ComparisonPolicy } from './diffComparison.ts'
import { compareLineMatch } from './diffSmartLines.ts'
import { parseConflicts, type Conflict } from './mergeConflicts.ts'

/** 上游 `ThreeSide`（`util/ThreeSide.kt`）：左 / 基线 / 右。 */
export type MergeSide = 'left' | 'base' | 'right'

/**
 * 一段改动在**三侧**各自的行区间（上游 `MergeRange`，
 * `platform/util/diff/src/com/intellij/diff/util/MergeRange.kt:6-45`——同名文件在 `plugins/svn4idea/`
 * 下还有一份，引用指前者；
 * 行号是 0 基、半开区间 —— 本仓的行坐标一律 0 基，与 `src/mergeConflicts.ts` 一致）。
 */
export interface MergeRange {
  /** 左（ours）侧。 */
  left: [number, number]
  /** 基线侧。 */
  base: [number, number]
  /** 右（theirs）侧。 */
  right: [number, number]
}

/** `MergeRange.isEmpty`（`platform/util/diff/src/com/intellij/diff/util/MergeRange.kt:44-45`）：三侧都空。 */
export function isEmptyRange(range: MergeRange): boolean {
  return range.left[0] === range.left[1] && range.base[0] === range.base[1] && range.right[0] === range.right[1]
}

/** `MergeConflictType.Type`（`util/MergeConflictType.kt:33-35`）。 */
export type MergeConflictKind = 'inserted' | 'deleted' | 'modified' | 'conflict'

/** `MergeConflictType`（`util/MergeConflictType.kt:8-32`）。 */
export interface MergeConflictType {
  type: MergeConflictKind
  /** 左侧改了吗（`isChange(Side.LEFT)`）。 */
  leftChange: boolean
  /** 右侧改了吗。 */
  rightChange: boolean
  /**
   * 能不能自动解决（`canBeResolved()` = `resolutionStrategy != null`）。
   * 上游只有 `MergeConflictResolutionStrategy.TEXT` 这一档纯文本策略可做，
   * SEMANTIC 那一档要 PSI（见 `MergeDiffBuilder.patchConflictTypes`），本仓没有。
   */
  canBeResolved: boolean
}

/** `isChange(ThreeSide)`（`MergeConflictType.kt:25-31`）：BASE 恒为 true。 */
export function isChangeOf(type: MergeConflictType, side: MergeSide): boolean {
  if (side === 'base') return true
  return side === 'left' ? type.leftChange : type.rightChange
}

/** 一侧在某段里的文本（`MergeRangeUtil.compareLineMergeContents` 取的那一段）。 */
function sliceOf(lines: readonly string[], range: [number, number]): string[] {
  return lines.slice(range[0], range[1])
}

/** 两侧某段在给定策略下是否相等（`compareLineMergeContents`，逐行比，长度不同直接 false）。 */
function sameRange(left: readonly string[], leftRange: [number, number], right: readonly string[], rightRange: [number, number], policy: ComparisonPolicy): boolean {
  if (rightRange[1] - rightRange[0] !== leftRange[1] - leftRange[0]) return false
  for (let i = 0; i < leftRange[1] - leftRange[0]; i++) {
    if (comparisonKey(left[leftRange[0] + i] ?? '', policy) !== comparisonKey(right[rightRange[0] + i] ?? '', policy)) return false
  }
  return true
}

/**
 * `MergeRangeUtil.getMergeType`（`util/MergeRangeUtil.kt:15-74`）的逐条移植。
 *
 * `equality` = 按策略比两侧；`trueEquality` = 按 DEFAULT 比两侧（只有 `getLineMergeType` 有，
 * 用来把"按当前策略算相等、按原文不等"的行段分开，见 `ByLineRt.doCompare` 的 `keepIgnoredChanges`）；
 * `conflictResolver` = 真冲突能不能靠纯文本合掉（`canResolveLineConflict` → `tryResolveConflict`）。
 */
function mergeType(
  empty: (side: MergeSide) => boolean,
  equality: (a: MergeSide, b: MergeSide) => boolean,
  trueEquality: ((a: MergeSide, b: MergeSide) => boolean) | null,
  conflictResolver: () => boolean,
): MergeConflictType {
  const isLeftEmpty = empty('left')
  const isBaseEmpty = empty('base')
  const isRightEmpty = empty('right')
  //
  // **`canBeResolved` 的填法**：上游 `MergeConflictType` 有两个构造
  // （`util/MergeConflictType.kt:8-19`）：三参那个把 `resolutionStrategy` 缺省成
  // `DEFAULT`，而 `canBeResolved()` 就是 `resolutionStrategy != null`（`:17-19`）
  // ⇒ **三参构造的 `canBeResolved` 一律 true**；只有显式传 `null` / `canBeResolved = false`
  // 的那两处（`:39` 的插-插冲突、`:70` 的真冲突）是 false。
  if (isBaseEmpty) {
    if (isLeftEmpty) return { type: 'inserted', leftChange: false, rightChange: true, canBeResolved: true }          // --=
    if (isRightEmpty) return { type: 'inserted', leftChange: true, rightChange: false, canBeResolved: true }          // =--
    // =-= 两侧各插一段：相等就都算插入，不等就是**插-插冲突**（上游给 null，不可自动解决 ——
    // `MergeResolveUtil.kt:36-39`：插入顺序无解，排序或按长度取舍都没意义）。
    return equality('left', 'right')
      ? { type: 'inserted', leftChange: true, rightChange: true, canBeResolved: true }
      : { type: 'conflict', leftChange: true, rightChange: true, canBeResolved: false }
  }
  if (isLeftEmpty && isRightEmpty) return { type: 'deleted', leftChange: true, rightChange: true, canBeResolved: true } // -=-
  const unchangedLeft = equality('base', 'left')
  const unchangedRight = equality('base', 'right')
  if (unchangedLeft && unchangedRight) {
    // 两段都"按策略没改"，但按 DEFAULT 至少有一段是真改了（`:53-56` 的 check）。
    const trueUnchangedLeft = trueEquality ? trueEquality('base', 'left') : true
    const trueUnchangedRight = trueEquality ? trueEquality('base', 'right') : true
    return { type: 'modified', leftChange: !trueUnchangedLeft, rightChange: !trueUnchangedRight, canBeResolved: true }
  }
  if (unchangedLeft) return { type: isRightEmpty ? 'deleted' : 'modified', leftChange: false, rightChange: true, canBeResolved: true }
  if (unchangedRight) return { type: isLeftEmpty ? 'deleted' : 'modified', leftChange: true, rightChange: false, canBeResolved: true }
  if (equality('left', 'right')) return { type: 'modified', leftChange: true, rightChange: true, canBeResolved: true }
  const canBeResolved = !isLeftEmpty && !isRightEmpty && conflictResolver()
  return { type: 'conflict', leftChange: true, rightChange: true, canBeResolved }
}

/** 一个改动在**两侧**里的行区间（`DiffIterableUtil.Range`，落在第一侧上）。 */
interface TwoWayRange { start1: number; end1: number; start2: number; end2: number }

/** `compareLineMatch`（= `ByLineRt.doCompare` 的两路）给的是相等段，改动段是它们的补。 */
function changeRangesOf(before: readonly string[], after: readonly string[], policy: ComparisonPolicy): TwoWayRange[] {
  const matches = compareLineMatch(before, after, policy)
  const ranges: TwoWayRange[] = []
  let i1 = 0
  let i2 = 0
  for (const { from, to } of matches) {
    if (from > i1 || to > i2) ranges.push({ start1: i1, end1: from, start2: i2, end2: to })
    i1 = from + 1
    i2 = to + 1
  }
  if (i1 < before.length || i2 < after.length) ranges.push({ start1: i1, end1: before.length, start2: i2, end2: after.length })
  return ranges
}

/** 改动段的补 = 未更改段（`FairDiffIterable.unchanged()`，上游是同一张表的另一半）。 */
function unchangedRangesOf(changes: readonly TwoWayRange[], length1: number, length2: number): TwoWayRange[] {
  const ranges: TwoWayRange[] = []
  let i1 = 0
  let i2 = 0
  for (const change of changes) {
    if (change.start1 > i1 || change.start2 > i2) ranges.push({ start1: i1, end1: change.start1, start2: i2, end2: change.start2 })
    i1 = change.end1
    i2 = change.end2
  }
  if (i1 < length1 || i2 < length2) ranges.push({ start1: i1, end1: length1, start2: i2, end2: length2 })
  return ranges
}

/** `ComparisonMergeUtil.add`（`:79-104`）：两个未更改段相交时把交集标成相等，返回该推进哪一路。 */
function addUnchanged(
  builder: ChangeCollector,
  range1: TwoWayRange,
  range2: TwoWayRange,
): 'left' | 'right' {
  if (range1.end1 <= range2.start1) return 'left'
  if (range2.end1 <= range1.start1) return 'right'
  const startBase = Math.max(range1.start1, range2.start1)
  const endBase = Math.min(range1.end1, range2.end1)
  const count = endBase - startBase
  const startLeft = range1.start2 + (startBase - range1.start1)
  const startRight = range2.start2 + (startBase - range2.start1)
  builder.markEqual(startLeft, startBase, startRight, startLeft + count, endBase, startRight + count)
  return range1.end1 <= range2.end1 ? 'left' : 'right'
}

/** `ComparisonMergeUtil.ChangeBuilder` / `IgnoringChangeBuilder`（`:107-185`）的合并。 */
class ChangeCollector {
  private readonly ranges: MergeRange[] = []
  private index1 = 0
  private index2 = 0
  private index3 = 0
  // 参数属性（`constructor(private readonly …)`）在本仓不能写：`node --test` 直接加载
  // `.ts` 时走的是 strip-only 类型擦除，不支持参数属性（会抛
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）—— 见 `src/breakpointLocations.ts:60` 的同一条备注。
  private readonly trueEquality: ((i1: number, i2: number, i3: number) => boolean) | null
  /** 构造时传 `trueEquality` 的就是 `IgnoringChangeBuilder`（`buildMerge`），否则是 `buildSimple`。 */
  constructor(trueEquality: ((i1: number, i2: number, i3: number) => boolean) | null) { this.trueEquality = trueEquality }

  add(start1: number, start2: number, start3: number, end1: number, end2: number, end3: number): void {
    if (start1 === end1 && start2 === end2 && start3 === end3) return
    this.ranges.push({ left: [start1, end1], base: [start2, end2], right: [start3, end3] })
  }

  /** `processChange`（`:144-146` / `:150-158`）。 */
  private processChange(start1: number, start2: number, start3: number, end1: number, end2: number, end3: number): void {
    if (!this.trueEquality) { this.add(start1, start2, start3, end1, end2, end3); return }
    // `IgnoringChangeBuilder.addIgnoredChanges`：把"按 DEFAULT 两侧都等于基线"的行段从改动里剔掉。
    const last = this.ranges[this.ranges.length - 1]
    const unchangedStart1 = last ? last.left[1] : 0
    const unchangedStart2 = last ? last.base[1] : 0
    const unchangedStart3 = last ? last.right[1] : 0
    this.addIgnored(unchangedStart1, unchangedStart2, unchangedStart3, start1, start2, start3)
    this.add(start1, start2, start3, end1, end2, end3)
  }

  /** `addIgnoredChanges`（`:160-184`）：把改动段里"其实没改"的等行段单独切成改动。 */
  private addIgnored(start1: number, start2: number, start3: number, end1: number, end2: number, end3: number): void {
    const count = end2 - start2
    let firstIgnored = -1
    for (let i = 0; i < count; i++) {
      const ignored = !this.trueEquality!(start1 + i, start2 + i, start3 + i)
      if (ignored && firstIgnored === -1) firstIgnored = i
      if (!ignored && firstIgnored !== -1) {
        this.add(start1 + firstIgnored, start2 + firstIgnored, start3 + firstIgnored, start1 + i, start2 + i, start3 + i)
        firstIgnored = -1
      }
    }
    if (firstIgnored !== -1) this.add(start1 + firstIgnored, start2 + firstIgnored, start3 + firstIgnored, start1 + count, start2 + count, start3 + count)
  }

  markEqual(start1: number, start2: number, start3: number, end1: number, end2: number, end3: number): void {
    this.processChange(this.index1, this.index2, this.index3, start1, start2, start3)
    this.index1 = end1
    this.index2 = end2
    this.index3 = end3
  }

  finish(length1: number, length2: number, length3: number): MergeRange[] {
    this.processChange(this.index1, this.index2, this.index3, length1, length2, length3)
    return this.ranges
  }
}

/**
 * 三方行级对齐（上游 `ComparisonManagerImpl.mergeLines`（`:102-113`）→ `ByLineRt.merge`
 * （`ByLineRt.kt:44-54`）→ `ByLineRt.doCompare(..., keepIgnoredChanges = true)`（`:87-120`）
 * → `ComparisonMergeUtil.buildMerge` / `buildSimple`）。
 *
 * 返回的是**改动段**列表（未按行排序也无需：上游同样按生成序返回）。
 */
export function buildMergeRanges(left: readonly string[], base: readonly string[], right: readonly string[], policy: ComparisonPolicy = 'default'): MergeRange[] {
  // 上游比的是 (base, left) 与 (base, right) 两路（`doCompare` 的 `:102-108`），基线是第一侧。
  const changes1 = changeRangesOf(base, left, policy)
  const changes2 = changeRangesOf(base, right, policy)
  const unchanged1 = unchangedRangesOf(changes1, base.length, left.length)
  const unchanged2 = unchangedRangesOf(changes2, base.length, right.length)
  // `keepIgnoredChanges && policy != DEFAULT` 才带 trueEquality（`doCompare` 的 `:110-119`）。
  const trueEquality = policy === 'default' ? null : (i1: number, i2: number, i3: number) =>
    comparisonKey(left[i1] ?? '', 'default') === comparisonKey(base[i2] ?? '', 'default')
    && comparisonKey(base[i2] ?? '', 'default') === comparisonKey(right[i3] ?? '', 'default')
  const builder = new ChangeCollector(trueEquality)
  let i1 = 0
  let i2 = 0
  while (i1 < unchanged1.length && i2 < unchanged2.length) {
    const side = addUnchanged(builder, unchanged1[i1]!, unchanged2[i2]!)
    if (side === 'left') i1++; else i2++
  }
  return builder.finish(left.length, base.length, right.length)
}

/** `MergeRangeUtil.getLineMergeType`（`util/MergeRangeUtil.kt:92-107`）。 */
export function mergeLineType(
  range: MergeRange,
  left: readonly string[], base: readonly string[], right: readonly string[],
  policy: ComparisonPolicy = 'default',
): MergeConflictType {
  const lines = { left, base, right }
  return mergeType(
    side => range[side][0] === range[side][1],
    (a, b) => sameRange(lines[a], range[a], lines[b], range[b], policy),
    (a, b) => sameRange(lines[a], range[a], lines[b], range[b], 'default'),
    () => tryResolveConflict(sliceOf(left, range.left), sliceOf(base, range.base), sliceOf(right, range.right), policy) !== null,
  )
}

/** 某段的三侧文本（`MergeRangeUtil.canResolveLineConflict` 的 `getLinesContent`）。 */
export function rangeTexts(range: MergeRange, left: readonly string[], base: readonly string[], right: readonly string[]): { left: string[]; base: string[]; right: string[] } {
  return { left: sliceOf(left, range.left), base: sliceOf(base, range.base), right: sliceOf(right, range.right) }
}

/**
 * 自动解决一段三方内容（上游 `MergeResolveUtil.SimpleHelper`，`MergeResolveUtil.kt:70-160`）。
 *
 * 走法：三方对齐得到改动段 → 段**之前**那段按 DEFAULT 判（没改就取基线，改了取动的那一侧）→
 * 段**本身**按 `policy` 判（不是真冲突就取动的那一侧；是真冲突就返回 null —— 宁可交给用户）。
 * 返回 null = 解决不了（上游 `:132` 的 `if (type.type == Type.CONFLICT) return false`）。
 */
export function tryResolveConflict(left: readonly string[], base: readonly string[], right: readonly string[], policy: ComparisonPolicy = 'default'): string[] | null {
  const changes = buildMergeRanges(left, base, right, policy)
  const result: string[] = []
  let last1 = 0
  let last2 = 0
  let last3 = 0
  const nextRange = (end1: number, end2: number, end3: number): MergeRange => {
    const range: MergeRange = { left: [last1, end1], base: [last2, end2], right: [last3, end3] }
    last1 = end1
    last2 = end2
    last3 = end3
    return range
  }
  const append = (range: MergeRange, side: MergeSide) => {
    result.push(...sliceOf(side === 'left' ? left : side === 'base' ? base : right, range[side]))
  }
  for (const change of changes) {
    appendBase(nextRange(change.left[0], change.base[0], change.right[0]))
    const conflictRange = nextRange(change.left[1], change.base[1], change.right[1])
    const type = mergeLineType(conflictRange, left, base, right, policy)
    if (type.type === 'conflict') return null
    append(conflictRange, type.leftChange ? 'left' : 'right')
  }
  appendBase(nextRange(left.length, base.length, right.length))
  return result

  /** `appendBase`（`:108-128`）：这一段用 **DEFAULT** 判。 */
  function appendBase(range: MergeRange): void {
    if (isEmptyRange(range)) return
    const unchanged = sameRange(base, range.base, left, range.left, 'default') && sameRange(base, range.base, right, range.right, 'default')
    if (unchanged) { append(range, 'base'); return }
    const type = mergeLineType(range, left, base, right, 'default')
    if (type.leftChange) append(range, 'left')
    else if (type.rightChange) append(range, 'right')
    else append(range, 'base')
  }
}

/** 一个冲突块的三份文本（`Conflict` → base / ours / theirs 的**行数组**）。 */
export interface ConflictSides {
  /** diff3 的基线（没有 `|||||||` 段时为空数组）。 */
  base: string[]
  /** 左侧（ours）。 */
  left: string[]
  /** 右侧（theirs）。 */
  right: string[]
}

/** 从一段文本与一个冲突块里取三份（`parseConflicts` 给的是行区间，这里取文本）。 */
export function conflictSides(lines: readonly string[], conflict: Conflict): ConflictSides {
  return {
    base: conflict.baseLine === null ? [] : lines.slice(conflict.baseLine + 1, conflict.middleLine),
    left: lines.slice(conflict.ours.from, conflict.ours.to),
    right: lines.slice(conflict.theirs.from, conflict.theirs.to),
  }
}

/** 一个冲突块能不能自动解决（`MergeConflictModel.hasAutoResolvableConflictedChanges` 的判据落到单块上）。 */
export function canAutoResolve(sides: ConflictSides, policy: ComparisonPolicy = 'default'): boolean {
  return tryResolveConflict(sides.left, sides.base, sides.right, policy) !== null
}

/** 解决一段文本里的**全部**冲突块；`onlyNonConflicts` = 只合"一侧没动"的（`Diff.ApplyNonConflicts`）。 */
export interface ResolveConflictsResult {
  /** 解决后的全文（没解决的块原样留着标记）。 */
  text: string
  /** 合掉了几处。 */
  resolved: number
  /** 还剩几处真冲突。 */
  remaining: number
}

/**
 * 逐块过一遍：能自动合的换成合掉的内容，不能的原样保留。
 *
 * `onlyNonConflicts = false`（`Diff.MagicResolveConflicts` 的口径）：凡是能自动合的都合。
 * `onlyNonConflicts = true`（`Diff.ApplyNonConflicts` 的口径）：**只**合 `type !== 'conflict'` 的，
 * 也就是"一侧没动、另一侧改了"那种 —— 相当于只落 base 上确定的那一半。
 */
export function resolveConflictsInText(content: string, onlyNonConflicts = false, policy: ComparisonPolicy = 'default'): ResolveConflictsResult {
  const lines = content.split('\n')
  const conflicts = parseConflicts(content)
  const out: string[] = []
  let cursor = 0
  let resolved = 0
  for (const conflict of conflicts) {
    for (let i = cursor; i < conflict.startLine; i++) out.push(lines[i]!)
    const sides = conflictSides(lines, conflict)
    // `type !== 'conflict'` 的判据就是"两侧没同时改成不一样的东西"（`MergeRangeUtil.getMergeType`）。
    const type = mergeType(
      () => false,
      (a, b) => {
        const texts = { left: sides.left, base: sides.base, right: sides.right }
        return sameRange(texts[a], [0, texts[a].length], texts[b], [0, texts[b].length], policy)
      },
      null,
      () => canAutoResolve(sides, policy),
    )
    const take = onlyNonConflicts ? type.type !== 'conflict' : type.canBeResolved
    if (take) {
      const merged = tryResolveConflict(sides.left, sides.base, sides.right, policy)
      if (merged) {
        out.push(...merged)
        resolved++
        cursor = conflict.endLine + 1
        continue
      }
    }
    out.push(...lines.slice(conflict.startLine, conflict.endLine + 1))
    cursor = conflict.endLine + 1
  }
  for (let i = cursor; i < lines.length; i++) out.push(lines[i]!)
  return { text: out.join('\n'), resolved, remaining: conflicts.length - resolved }
}

// —— 文案（中文取随 IDE 发货的 `localization-zh.jar` 的 `messages/ActionsBundle.properties`，
//    英文取上游 `platform-resources-en/.../ActionsBundle.properties:1678-1681`）——

/** `action.Diff.MagicResolveConflicts.text` = 解决简单的冲突。 */
export const RESOLVE_SIMPLE_CONFLICTS_TEXT = '解决简单的冲突'
/** `action.Diff.ApplyNonConflicts.text` = 应用所有不冲突的更改。 */
export const APPLY_NON_CONFLICTS_TEXT = '应用所有不冲突的更改'
