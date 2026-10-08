// 行级 diff 的**对齐内核** —— Myers O(ND) 线性空间算法 + 超阈值时的 Patience 退路。
//
// 上游出处（全在 `platform/util/diff/src/com/intellij/`；每条行号都是 2026-10-06 按参考树逐条
// `grep -n` 复核过的，旧值见 `docs/batch-2026-10-06-mergeverdict.md` §E 的漂移表）：
//   · `Diff.buildChanges`（`util/diff/Diff.kt:15` 收 CharSequence / `:42` 收 IntArray / `:26-38` 收两侧对象数组）：
//     先掐公共前缀 `getStartShift`（Array 版 `Diff.kt:104-112`，IntArray 版 `:125-133`）与公共后缀
//     `getEndCut`（Array 版 `Diff.kt:114-123`，IntArray 版 `:135-143`），**只对中间那段跑算法**；
//     空的一侧直接出结论（`doBuildChangesFast`，`:55-66`）。中间用 `Enumerator` 把行映成整数 id 再比
//     （`diff/util/Enumerator.kt:13-15` 是数组入口、`:17-26` 是那张共用 `numbers` 表赋 id —— 两个数组共用一张表，所以相同的行拿到相同的 id）。
//   · `MyersLCS`（`util/diff/MyersLCS.kt:18-228`）：文件头引的就是 E.W. Myers 1986 那篇
//     *An O(ND) Difference Algorithm and Its Variations*（`MyersLCS.kt:10-11`，其中 `:11` 就是那句论文出处），
//     "O(ND) runtime, O(N) memory"（`:12`）。实现是**分治 + 中间蛇**：每一层正着跑
//     一遍 `d`、反着跑一遍 `d`，两条前沿相遇就以相遇点为界切成左右两半递归
//     （`MyersLCS.kt:90-191`）。V 数组**全程复用**（`:45-46` 各分配一次，之后每层只重写自己要用的区间），
//     所以空间是 O(N) 而不是 O(D²)。
//   · 跑不过阈值时上游抛 `FilesTooBigForDiffException`（`MyersLCS.kt:190`，异常类在
//     `util/diff/FilesTooBigForDiffException.kt`），由 `Diff.doBuildChanges`（`:71`）接住并
//     **改用 Patience**（`Diff.kt:88-97`：`try { MyersLCS…executeWithThreshold() } catch (…) {
//     PatienceIntLCS(…).execute(true) }`）。阈值 = `max(20000 + 10*sqrt(N), DELTA_THRESHOLD_SIZE=20000)`
//     （`MyersLCS.kt:76-78` + `util/diff/DiffConfig.kt:10`）。
//   · Patience 那一侧：`util/diff/PatienceIntLCS.kt:11-159`（分治体 `:38-123`、`checkReduction` `:153-158`）
//     与 `util/diff/UniqueLCS.kt:23-105`（唯一行锚点 + 最长递增子序列）。
//
// **与上游的差异（如实记下，判决书 §B2/§B3 有同一条）**：
//   · 上游在 Myers 之外还有一道 `Reindexer.discardUnique`（`Diff.kt:72-73`：先把"只在一侧出现"的行
//     从比划里摘掉），本仓直接在掐过前后缀的中段上跑；只影响退路的粗细节，不影响合法性。
//   · Patience 自己也嫌大时（`PatienceIntLCS.kt:153-158` 的 `checkReduction` 再抛一次），
//     上游把异常继续外抛（`diff/comparison/iterables/DiffIterableUtil.kt:35/:53` 折成 `DiffTooBigException`）；
//     本仓的最后一级仍是"中间整段视作一块改动"，只认掐出来的公共前后缀 —— 输出仍然是一个
//     **合法的**行对齐，只是粗（判据 `tests/diff-patience.test.mjs` 把这两级都钉住）。
//
// 本仓的 diff 一律是**逐行相等**比较：上游默认档是 `IgnorePolicy.DEFAULT`（bundle 文案就是
// `None`，`platform/diff-api/resources/messages/DiffBundle.properties:277`），写在
// `platform/diff-impl/src/com/intellij/diff/tools/util/base/TextDiffSettingsHolder.kt:47`
// （`IGNORE_POLICY: IgnorePolicy = IgnorePolicy.DEFAULT`；同行 `:46` 是 `HIGHLIGHT_POLICY = BY_WORD`），
// 经 `IgnorePolicy.getComparisonPolicy`（`IgnorePolicy.java:29-35`，2026-10-06 逐行开过：整段 29-35 未漂）落到
// `ComparisonPolicy.DEFAULT`（`platform/util/diff/src/com/intellij/diff/comparison/ComparisonPolicy.kt:5`），
// 所以尾随空格不同**算不同行**，本仓的逐行相等与之一致。
// `TRIM_WHITESPACES`（`ComparisonPolicy.kt:6`）/ `IGNORE_WHITESPACES`（`:7`）/
// `IGNORE_WHITESPACES_CHUNKS`（`IgnorePolicy.java:15`，折档后同走 `IGNORE_WHITESPACES`）三档
// 由调用方把行折成比较键之后再进来比（`src/diffComparison.ts` 的 `comparisonKeys`，
// 消费点 `src/diffSmartLines.ts` 的 `compareLineMatch`），本内核只管"折过的键相等与否"。
//
// **行号订正留痕**（2026-10-06 diffverdict：`tests/b7-verdict.test.mjs:124` 钉死的是本仓**旧注释**里那批坐标，
// 逐条打开参考树 `find -name` + 数行后如下 —— 左 = 原写，右 = 实测；两个以上重载各记各的区间。
// 证据与逐条 `grep -n` 输出见 `docs/batch-2026-10-06-diffverdict.md` §1；本段保留旧值只为留痕，
// 按图索骥请走上面对应的**实测**行号）：
//   · 原写 `Diff.kt:29-41`（buildChanges）→ 实测 `:26-38` 泛型 Array 版、`:42-53` IntArray 版（`:15-17` 收 CharSequence）
//   · 原写 `Diff.kt:118-127`（getStartShift）→ 实测 `:104-112` Array 版、`:125-133` IntArray 版
//   · 原写 `Diff.kt:129-141`（getEndCut）→ 实测 `:114-123` Array 版、`:135-143` IntArray 版
//   · 原写 `Diff.kt:64-75`（doBuildChangesFast）→ 实测 `:55-66`（`:64-75` 现在落在 `Ref` 与 `doBuildChanges` 头上）
//   · 原写 `Diff.kt:96-101`（Myers→Patience 退路）→ 实测 `:88-97`：try 在 `:88`、catch 在 `:93`、`execute(true)` 在 `:95`；
//     `:96-101` 是 `patienceIntLCS.changes` + `reindexer.reindex` + return，不是那条退路本体
//   · 原写 `Enumerator.kt:16-25` → 实测 `:13-15`（数组入口）、`:17-26`（共用 `numbers` 表赋 id；`:10` 才是那张表）
//   · 原写 `MyersLCS.kt:38-42`（"两张 V 全程复用"）→ 实测 `:45-46`（`:44` 是 `totalSequenceLength`；`:38-42` 是次构造器尾巴 + `changes.set`）
//   · 原写 `MyersLCS.kt:64-70`（阈值公式）→ 实测 `:76-78`（`:64-70` 是 `executeLinear` 的尾巴与不限阈值那一档 `:66-73`）
//   · 原写 `MyersLCS.kt:96-190`（分治体）→ 实测 `:90-193`（六参 `execute`；本文件其余处沿用 mergeverdict 记的 `:90-191`，同一段）
//   · 原写 `MyersLCS.kt:175-186`（正序吃公共行）→ 实测 `:200-211`（`commonSubsequenceLengthForward`）
//   · 原写 `MyersLCS.kt:186-188`（超估计抛出）→ 实测 `:188-190`（`throw FilesTooBigForDiffException()` 那行是 `:190`）
//   · 原写 `TrimUtil.kt:53-55`（TRIM 档）→ 实测 `:53-56` 是 `fun trimStart`（`:55` 只是它那个 lambda 行）；
//     策略枚举本体在 `ComparisonPolicy.kt:6`，本仓走调用方折键那条路（见上一段）
//   · **未漂、照旧引**：`MyersLCS.kt:10-11`（文件头的 Myers 1986 出处）、`IgnorePolicy.java:29-35`
//     （`getComparisonPolicy` 整段）、`DiffConfig.kt:10`、`TextDiffSettingsHolder.kt:47`、
//     `DiffBundle.properties:277`（`option.ignore.policy.none=None`）
//   · **没有「假坐标」**：上面这 5 个类（`Diff.kt` / `MyersLCS.kt` / `Enumerator.kt` /
//     `IgnorePolicy.java` / `TrimUtil.kt`）在参考树里都真实存在且唯一，路径见
//     `tests/diff-citations.test.mjs` 的 `BARE_NAMES`；漂的是行号，不是文件。

/** 一段连续相等的行：`a[from .. from+count)` 与 `b[to .. to+count)` 逐行相同。 */
export interface AlignedPair { from: number; to: number }

/** 掐公共前缀（`Diff.getStartShift`，`Diff.kt:104-112`）。 */
function startShift(a: readonly string[], b: readonly string[]): number {
  const size = Math.min(a.length, b.length)
  let idx = 0
  while (idx < size && a[idx] === b[idx]) idx++
  return idx
}

/** 掐公共后缀（`Diff.getEndCut`，Array 版 `Diff.kt:114-123`，IntArray 版 `:135-143`）。注意它从 `startShift` 之后才开始数。 */
function endCut(a: readonly string[], b: readonly string[], shift: number): number {
  const size = Math.min(a.length, b.length) - shift
  let idx = 0
  while (idx < size && a[a.length - idx - 1] === b[b.length - idx - 1]) idx++
  return idx
}

/**
 * 上游 `Enumerator`（`diff/util/Enumerator.kt:13-15`）的等价物：两段数组**共用**一张 id 表，
 * 所以内容相同的行拿到同一个整数。id 从 1 起（0 留给 null，上游同）。
 */
function enumerate(a: readonly string[], b: readonly string[]): [Int32Array, Int32Array] {
  const numbers = new Map<string, number>()
  let next = 1
  const run = (lines: readonly string[]) => {
    const out = new Int32Array(lines.length)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      let id = numbers.get(line)
      if (id === undefined) { id = next++; numbers.set(line, id) }
      out[i] = id
    }
    return out
  }
  return [run(a), run(b)]
}

// MyersLCS.kt:76-78 —— max(20000 + 10*sqrt(N), DELTA_THRESHOLD_SIZE=20000 / DiffConfig.kt:10)
const DELTA_THRESHOLD_SIZE = 20000
function deltaThreshold(count1: number, count2: number): number {
  return Math.max(20000 + Math.floor(10 * Math.sqrt(count1 + count2)), DELTA_THRESHOLD_SIZE)
}

/** 上游 `FilesTooBigForDiffException`（`util/diff/FilesTooBigForDiffException.kt`，抛出点 `MyersLCS.kt:188-190`）。 */
class FilesTooBigForDiff extends Error {
  constructor() { super('diff: 差异量超过阈值') }
}

/** `MyersLCS` 的移植。逐行内容已换成整数 id，所以相等判断就是一次整数比较。 */
class MyersAligner {
  private readonly first: Int32Array
  private readonly second: Int32Array
  private readonly forward: Int32Array
  private readonly backward: Int32Array

  constructor(first: Int32Array, second: Int32Array) {
    this.first = first
    this.second = second
    // MyersLCS.kt:45-46：整段共用两张 V，全程不重新分配 —— 这正是"线性空间"的由来。
    const total = first.length + second.length
    this.forward = new Int32Array(total + 1)
    this.backward = new Int32Array(total + 1)
  }

  /** MyersLCS.kt:200-211 —— 从 (oldIndex,newIndex) 往前（正序）吃公共行。 */
  private commonForward(oldIndex: number, newIndex: number, maxLength: number): number {
    const limit = Math.min(maxLength, Math.min(this.first.length - oldIndex, this.second.length - newIndex))
    let x = oldIndex, y = newIndex
    while (x - oldIndex < limit && this.first[x] === this.second[y]) { x++; y++ }
    return x - oldIndex
  }

  /** MyersLCS.kt:213-224 —— 从 (oldIndex,newIndex) 往后（倒序）吃公共行。 */
  private commonBackward(oldIndex: number, newIndex: number, maxLength: number): number {
    const limit = Math.min(maxLength, Math.min(oldIndex, newIndex) + 1)
    let x = oldIndex, y = newIndex
    while (oldIndex - x < limit && this.first[x] === this.second[y]) { x--; y-- }
    return oldIndex - x
  }

  /**
   * `MyersLCS.execute`（`:96-190`）的直译。求 `[oldStart,oldEnd) × [newStart,newEnd)` 的公共行，
   * 按**从前往后**的顺序回调 `emit(start1, start2, count)`。
   * 返回 false 表示差异量超出 `differenceEstimate`（对应上游抛异常）。
   */
  run(
    oldStart: number, oldEnd: number, newStart: number, newEnd: number,
    differenceEstimate: number,
    emit: (start1: number, start2: number, count: number) => void,
  ): boolean {
    if (oldStart > oldEnd || newStart > newEnd) return true
    if (oldStart >= oldEnd || newStart >= newEnd) return true   // 一侧空 ⇒ 没有公共行

    const oldLength = oldEnd - oldStart
    const newLength = newEnd - newStart
    this.forward[newLength + 1] = 0                            // MyersLCS.kt:98-99
    this.backward[newLength + 1] = 0
    const halfD = (differenceEstimate + 1) >> 1
    const delta = oldLength - newLength
    const deltaOdd = delta % 2 !== 0
    let td = -1, xx = 0, kk = 0

    search: for (let d = 0; d <= halfD; d++) {
      // MyersLCS.kt:109-110：把 k 平移成非负下标，并按奇偶夹出合法区间。
      const L = newLength + Math.max(-d, -newLength + ((d ^ newLength) & 1))
      const R = newLength + Math.min(d, oldLength - ((d ^ oldLength) & 1))

      for (let k = L; k <= R; k += 2) {                        // 正向，:112-121
        let x = (k === L || (k !== R && this.forward[k - 1] < this.forward[k + 1]))
          ? this.forward[k + 1]
          : this.forward[k - 1] + 1
        const y = x - k + newLength
        x += this.commonForward(oldStart + x, newStart + y, Math.min(oldEnd - oldStart - x, newEnd - newStart - y))
        this.forward[k] = x
      }

      if (deltaOdd) {                                           // 奇数差：正反两前沿在这一层相遇
        for (let k = L; k <= R; k += 2) {                      // MyersLCS.kt:123-136
          if (k < oldLength - (d - 1) || k > oldLength + (d - 1)) continue
          if (this.forward[k] + this.backward[newLength + oldLength - k] >= oldLength) {
            xx = this.forward[k]; kk = k; td = 2 * d - 1
            break search
          }
        }
      }

      for (let k = L; k <= R; k += 2) {                        // 反向，:135-144
        let x = (k === L || (k !== R && this.backward[k - 1] < this.backward[k + 1]))
          ? this.backward[k + 1]
          : this.backward[k - 1] + 1
        const y = x - k + newLength
        x += this.commonBackward(oldEnd - 1 - x, newEnd - 1 - y, Math.min(oldEnd - oldStart - x, newEnd - newStart - y))
        this.backward[k] = x
      }

      if (!deltaOdd) {                                          // 偶数差，:146-156
        for (let k = L; k <= R; k += 2) {
          if (k < oldLength - d || k > oldLength + d) continue
          if (this.forward[oldLength + newLength - k] + this.backward[k] >= oldLength) {
            xx = oldLength - this.backward[k]; kk = oldLength + newLength - k; td = 2 * d
            break search
          }
        }
      }
    }

    if (td > 1) {                                               // MyersLCS.kt:164-169
      const yy = xx - kk + newLength
      const oldDiff = (td + 1) >> 1
      // 左半先跑 —— 递归天然按从前往后的顺序吐等行，调用方不需要再排序。
      if (xx > 0 && yy > 0) {
        if (!this.run(oldStart, oldStart + xx, newStart, newStart + yy, oldDiff, emit)) return false
      }
      if (oldStart + xx < oldEnd && newStart + yy < newEnd) {
        if (!this.run(oldStart + xx, oldEnd, newStart + yy, newEnd, td - oldDiff, emit)) return false
      }
      return true
    }
    if (td >= 0) {                                              // MyersLCS.kt:170-187
      let x = oldStart, y = newStart
      while (x < oldEnd && y < newEnd) {
        const common = this.commonForward(x, y, Math.min(oldEnd - x, newEnd - y))
        if (common > 0) {
          emit(x, y, common)
          x += common
          y += common
        } else if (oldEnd - oldStart > newEnd - newStart) {
          x++
        } else {
          y++
        }
      }
      return true
    }
    return false                                                // MyersLCS.kt:188-190：超估计
  }
}

/**
 * 上游 `UniqueLCS`（`platform/util/diff/src/com/intellij/util/diff/UniqueLCS.kt:23-95`）：
 * 只把**两侧各只出现一次**的行当锚点（`:29-57` 那两遍扫描：第一遍把"出现过第二次"的 key 标成 `-1`、
 * 第二遍把"在二侧也出现第二次"的锚点同样退回 `-1`），再对锚点求**最长递增子序列**
 * （`:63-81`，`sequence` / `lastElement` / `predecessor` 三张表），`:83-94` 回溯成两组下标。
 * 一个锚点都没有时返回 null（`:59-61`）—— 上游据此退回 Myers（`PatienceIntLCS.kt:73-77`）。
 */
function uniqueLcs(first: Int32Array, second: Int32Array,
  start1: number, count1: number, start2: number, count2: number): [Int32Array, Int32Array] | null {
  /** 上游的 `Int2ObjectOpenHashMap`（`:26`）：key → `offset1 + 1`，`-1` = 出现过不止一次。 */
  const map = new Map<number, number>()
  const match = new Int32Array(count1)

  for (let i = 0; i < count1; i++) {
    const value = map.get(first[start1 + i]!) ?? 0
    if (value === -1) continue
    map.set(first[start1 + i]!, value === 0 ? i + 1 : -1)
  }

  let count = 0
  for (let i = 0; i < count2; i++) {
    const value = map.get(second[start2 + i]!) ?? 0
    if (value === 0 || value === -1) continue
    if (match[value - 1] === 0) {
      match[value - 1] = i + 1
      count++
    } else {
      // 二侧也是重复行 ⇒ 这个锚点作废（上游 `:52-56`，同时把 key 标成 -1 免得再被认领）。
      match[value - 1] = 0
      map.set(second[start2 + i]!, -1)
      count--
    }
  }

  if (count === 0) return null

  const sequence = new Int32Array(count)
  const lastElement = new Int32Array(count)
  const predecessor = new Int32Array(count1)

  let length = 0
  for (let i = 0; i < count1; i++) {
    if (match[i] === 0) continue
    const j = insertionPoint(sequence, match[i]!, length)
    if (j === length || match[i]! < sequence[j]!) {
      sequence[j] = match[i]!
      lastElement[j] = i
      predecessor[i] = j > 0 ? lastElement[j - 1]! : -1
      if (j === length) length++
    }
  }

  const ret: [Int32Array, Int32Array] = [new Int32Array(length), new Int32Array(length)]
  let at = length - 1
  let curr = lastElement[length - 1]!
  while (curr !== -1) {
    ret[0][at] = curr
    ret[1][at] = match[curr]! - 1
    at--
    curr = predecessor[curr]!
  }
  return ret
}

/**
 * 上游 `UniqueLCS.binarySearch`（`UniqueLCS.kt:101-105`）：Java 的 `binarySearch` 找不到时返回
 * `-(插入点) - 1`，那句 `check(i < 0)` 就是"值必定不在序列里"（锚点两侧唯一，天然不会重复）。
 * 这里直接返回插入点，并把那条 check 留着 —— 一旦重复就是上面的唯一性判定出了问题。
 */
function insertionPoint(sequence: Int32Array, value: number, length: number): number {
  let lo = 0
  let hi = length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sequence[mid] === value) throw new Error('diff: 唯一行锚点序列里出现重复')
    if (sequence[mid]! < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * 上游 `PatienceIntLCS`（`platform/util/diff/src/com/intellij/util/diff/PatienceIntLCS.kt:11-159`）：
 * **唯一行锚点分治**。`execute(failOnSmallReduction)` 对应 `:30-35`（true ⇒ 阈值计数器取 2，
 * 由 `Diff.kt:95` 在"Myers 已经抛过一次"这条退路上使用），递归体是 `:38-123`：
 *   1. 某一侧空 ⇒ 整段都是改动（`:48-51`），没有等行；
 *   2. 掐公共前缀 `matchForward`（`:125-133`）与公共后缀 `matchBackward`（`:135-143`）——
 *      掐出来的那些行都是等行；
 *   3. 掐完还有一侧空 ⇒ 收摊（`:63-65`）；
 *   4. 找唯一行锚点（`:70-71`）：有锚点就把锚点之间的子段各自递归（`:86-120`），
 *      一个锚点都没有就交给不限阈值的 Myers（`:75-76` 的 `executeLinear`）；
 *   5. `checkReduction`（`:153-158`）：子问题没把**任一侧**减到原规模的一半以下就再抛
 *      `FilesTooBigForDiffException` —— 上游据此承认"这份差异连 Patience 都治不了"。
 *
 * 与上游的唯一差别是记账方式：上游记"哪些行是改动"（两个 `BitSet`，`:145-148`），再由
 * `Reindexer.reindex`（`Reindexer.kt`）还原成 LCS；本仓**按序直接收集等行对**（前后缀、锚点、
 * 以及内层 Myers 吐出的那些），没被收集的行就等价于上游"被 set 的位"。锚点两侧各只有一行，
 * 所以 `emit` 的 `count` 恒为 1；顺序天然由前到后，调用方不需要再排。
 */
class PatienceAligner {
  private readonly first: Int32Array
  private readonly second: Int32Array
  private readonly total1: number
  private readonly total2: number
  private readonly matches: AlignedPair[] = []

  constructor(first: Int32Array, second: Int32Array) {
    this.first = first
    this.second = second
    this.total1 = first.length
    this.total2 = second.length
  }

  /** `PatienceIntLCS.execute`（`:30-35`）：`failOnSmallReduction` ⇒ 计数器 2，否则 -1（不查）。 */
  execute(failOnSmallReduction: boolean): AlignedPair[] {
    this.run(0, this.total1, 0, this.total2, failOnSmallReduction ? 2 : -1)
    return this.matches
  }

  private run(start1: number, count1: number, start2: number, count2: number, thresholdCheckCounter: number): void {
    if (count1 === 0 && count2 === 0) return
    if (count1 === 0 || count2 === 0) return   // 上游 `:48-51` addChange：全是改动，没有等行

    const startOffset = this.matchForward(start1, count1, start2, count2)
    let s1 = start1 + startOffset
    let s2 = start2 + startOffset
    let c1 = count1 - startOffset
    let c2 = count2 - startOffset
    for (let i = 0; i < startOffset; i++) this.matches.push({ from: start1 + i, to: start2 + i })

    const endOffset = this.matchBackward(s1, c1, s2, c2)
    c1 -= endOffset
    c2 -= endOffset
    /** 公共后缀也是等行；行号在两侧都排在中间段之后，所以放到最后再吐。 */
    const emitTail = (): void => {
      for (let i = 0; i < endOffset; i++) this.matches.push({ from: s1 + c1 + i, to: s2 + c2 + i })
    }

    if (c1 === 0 || c2 === 0) { emitTail(); return }

    let counter = thresholdCheckCounter
    if (counter === 0) this.checkReduction(c1, c2)
    counter = Math.max(-1, counter - 1)

    const matching = uniqueLcs(this.first, this.second, s1, c1, s2, c2)
    if (matching === null) {
      if (counter >= 0) this.checkReduction(c1, c2)
      // 上游 `:75-76`：`MyersLCS(...).executeLinear()` —— 同一棵树，但**不带阈值**。
      // `run` 的 `differenceEstimate` 就是那个"允许的差异上限"，给到 `2*(n+m)+1` 等于不设限。
      new MyersAligner(this.first, this.second).run(s1, s1 + c1, s2, s2 + c2, 2 * (c1 + c2) + 1,
        (from1, from2, count) => {
          for (let i = 0; i < count; i++) this.matches.push({ from: from1 + i, to: from2 + i })
        })
      emitTail()
      return
    }

    const matched = matching[0].length
    if (matched === 0) throw new Error('diff: 唯一行锚点为空')   // 上游 `:84` 的 `check(matched > 0)`

    this.run(s1, matching[0][0]!, s2, matching[1][0]!, counter)
    for (let i = 1; i < matched; i++) {
      const gapStart1 = matching[0][i - 1]! + 1
      const gapStart2 = matching[1][i - 1]! + 1
      const gap1 = matching[0][i]! - gapStart1
      const gap2 = matching[1][i]! - gapStart2
      // 锚点本身：唯一行、两侧各一行，就是一对等行（上游"没被 set 的位"）。
      this.matches.push({ from: s1 + matching[0][i - 1]!, to: s2 + matching[1][i - 1]! })
      if (gap1 > 0 || gap2 > 0) this.run(s1 + gapStart1, gap1, s2 + gapStart2, gap2, counter)
    }
    const last1 = matching[0][matched - 1]!
    const last2 = matching[1][matched - 1]!
    this.matches.push({ from: s1 + last1, to: s2 + last2 })
    const rest1 = last1 === c1 - 1 ? 0 : c1 - (last1 + 1)
    const rest2 = last2 === c2 - 1 ? 0 : c2 - (last2 + 1)
    if (rest1 > 0 || rest2 > 0) this.run(s1 + last1 + 1, rest1, s2 + last2 + 1, rest2, counter)
    emitTail()
  }

  private matchForward(start1: number, count1: number, start2: number, count2: number): number {
    const size = Math.min(count1, count2)
    let idx = 0
    for (let i = 0; i < size; i++) {
      if (this.first[start1 + i] !== this.second[start2 + i]) break
      ++idx
    }
    return idx
  }

  private matchBackward(start1: number, count1: number, start2: number, count2: number): number {
    const size = Math.min(count1, count2)
    let idx = 0
    for (let i = 1; i <= size; i++) {
      if (this.first[start1 + count1 - i] !== this.second[start2 + count2 - i]) break
      ++idx
    }
    return idx
  }

  /** `PatienceIntLCS.checkReduction`（`:153-158`）：子问题没把任一侧减到原规模一半以下 ⇒ 再抛。 */
  private checkReduction(count1: number, count2: number): void {
    if (count1 * 2 < this.total1) return
    if (count2 * 2 < this.total2) return
    throw new FilesTooBigForDiff()
  }
}

/**
 * 把 `a` 与 `b` 对齐成若干段连续相等的行，**按 `from` 升序**返回。
 *
 * 口径照 `Diff.buildChanges`（`Diff.kt:15` 收 CharSequence / `Diff.kt:42` 收 IntArray）：
 * 先掐公共前后缀，中间段交给 Myers。退路阈值与上游同一套公式（`MyersLCS.kt:76-78`）。
 */
export function alignLines(a: readonly string[], b: readonly string[]): AlignedPair[] {
  const out: AlignedPair[] = []
  if (a.length === 0 || b.length === 0) return out

  const shift = startShift(a, b)
  const cut = endCut(a, b, shift)
  /** 掐出来的公共前缀行 —— 无论中间段走 Myers 还是走退路，它们都得排在最前面。 */
  const pushPrefix = () => {
    for (let i = 0; i < shift; i++) out.push({ from: i, to: i })
  }
  /** 掐出来的公共后缀行 —— 排在最后。 */
  const pushSuffix = () => {
    for (let i = 0; i < cut; i++) out.push({ from: a.length - cut + i, to: b.length - cut + i })
  }

  // 掐完前后缀后剩下的就是"真正可能不同"的那一段（`Diff.kt:55` 的 `doBuildChangesFast` 空侧快路径）。
  const midA = a.slice(shift, a.length - cut)
  const midB = b.slice(shift, b.length - cut)
  if (midA.length === 0 || midB.length === 0) {
    pushPrefix()
    pushSuffix()
    return out
  }

  const [ids1, ids2] = enumerate(midA, midB)
  const threshold = deltaThreshold(midA.length, midB.length)
  const pairs: AlignedPair[] = []
  /** Myers 是否真的跑完了（上游那里对应 `executeWithThreshold` 没抛异常，`Diff.kt:89-91`）。 */
  let aligned = false
  try {
    aligned = new MyersAligner(ids1, ids2).run(0, midA.length, 0, midB.length, threshold, (s1, s2, count) => {
      for (let i = 0; i < count; i++) pairs.push({ from: shift + s1 + i, to: shift + s2 + i })
    })
  } catch (error) {
    if (!(error instanceof FilesTooBigForDiff)) throw error
    aligned = false
  }
  if (!aligned) {
    // `Diff.kt:93-97`：Myers 那一路超阈值（上游抛 `FilesTooBigForDiffException`，本仓 `run` 返回 false）
    // 之后**改走 Patience**，且带 `execute(true)`（`failOnSmallReduction`）—— 与 `USE_PATIENCE_ALG`
    // 那条"Patience 当主算法"的路（`Diff.kt:82-86`，本仓不涉及：那个开关在上游是 `false`，
    // `DiffConfig.kt:8`）不是一回事。
    pairs.length = 0
    try {
      for (const pair of new PatienceAligner(ids1, ids2).execute(true)) pairs.push({ from: shift + pair.from, to: shift + pair.to })
    } catch (error) {
      if (!(error instanceof FilesTooBigForDiff)) throw error
      // 上游到这里就把异常继续往外抛（`Diff.buildChanges` → `DiffIterableUtil.diff` 折成
      // `DiffTooBigException`，`DiffIterableUtil.kt:35/:53`）。本仓的调用方（行级比对与逐词高亮都算）
      // 没有"这份差异太大所以不画"这条 UI 语义，所以最后一级仍是原来的粗退路：
      // **中间整段视作一块改动**，只认掐出来的公共前后缀。这条差登记在判决簿 §B3。
      pairs.length = 0
    }
  }

  pushPrefix()
  for (const pair of pairs) out.push(pair)
  pushSuffix()
  return out
}
