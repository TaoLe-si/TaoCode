// 行级 diff 的**对齐内核** —— Myers O(ND) 线性空间算法。
//
// 上游出处（`platform/util/diff/src/com/intellij/util/diff/` 与 `platform/util/diff/src/com/intellij/diff/util/`）：
//   · `Diff.buildChanges`（`Diff.kt:29-41`）：先掐公共前缀 `getStartShift`（`:118-127`）与
//     公共后缀 `getEndCut`（`:129-141`），**只对中间那段跑算法**；空的一侧直接出结论
//     （`doBuildChangesFast`，`:64-75`）。中间用 `Enumerator` 把行映成整数 id 再比
//     （`Diff.kt:80-85`；`Enumerator.kt:16-25`，两个数组共用一张表，所以相同的行拿到相同的 id）。
//   · `MyersLCS`（`MyersLCS.kt:16-228`）：文件头引的就是 E.W. Myers 1986 那篇
//     *An O(ND) Difference Algorithm and Its Variations*（`MyersLCS.kt:10-11`），
//     "O(ND) runtime, **O(N) memory**"（`:12`）。实现是**分治 + 中间蛇**：每一层正着跑
//     一遍 `d`、反着跑一遍 `d`，两条前沿相遇就以相遇点为界切成左右两半递归
//     （`MyersLCS.kt:96-190`）。V 数组**全程复用**、每层只重写自己要用的区间
//     （`MyersLCS.kt:38-42`），所以空间是 O(N) 而不是 O(D²)。
//   · 跑不过阈值时上游抛 `FilesTooBigForDiffException`（`MyersLCS.kt:186-188`），
//     由 `Diff.doBuildChanges` 接住并**改用 Patience**（`Diff.kt:96-101`）。
//     阈值 = `max(20000 + 10*sqrt(N), DiffConfig.DELTA_THRESHOLD_SIZE=20000)`（`MyersLCS.kt:64-70`）。
//
// **与上游的差异（如实记下，判决书 §E 有同一张表）**：本仓不实现 Patience —— 退路是
// "掐掉前后公共段之后，中间整段视作一整块改动"（`alignLines` 捕获
// `FilesTooBigForDiff` 后走的那条分支）。
// 输出仍然是一个**合法的**行对齐（前后公共段照旧成对，中间没有等行），只是粗；
// 上游那条路会给出更细的等行。触发条件是差异量超过两万以上，正常编辑不会碰到。
//
// 本仓的 diff 一律是**逐行相等**比较：上游默认档是 `IgnorePolicy.DEFAULT`（bundle 文案就是
// `None`，`DiffBundle.properties:277`），写在 `TextDiffSettingsHolder.kt:47`
// （`IGNORE_POLICY = IgnorePolicy.DEFAULT`），经 `IgnorePolicy.getComparisonPolicy`
// （`IgnorePolicy.java:29-35`）落到 `ComparisonPolicy.DEFAULT`，所以尾随空格不同**算不同行**，
// 本仓的逐行相等与之一致。`ComparisonPolicy.TRIM_WHITESPACES` 那一档（`TrimUtil.kt:53-55`）
// 本仓**没有做**，判在判决书 §C。

/** 一段连续相等的行：`a[from .. from+count)` 与 `b[to .. to+count)` 逐行相同。 */
export interface AlignedPair { from: number; to: number }

/** 掐公共前缀（`Diff.getStartShift`，`Diff.kt:118-127`）。 */
function startShift(a: readonly string[], b: readonly string[]): number {
  const size = Math.min(a.length, b.length)
  let idx = 0
  while (idx < size && a[idx] === b[idx]) idx++
  return idx
}

/** 掐公共后缀（`Diff.getEndCut`，`Diff.kt:129-141`）。注意它从 `startShift` 之后才开始数。 */
function endCut(a: readonly string[], b: readonly string[], shift: number): number {
  const size = Math.min(a.length, b.length) - shift
  let idx = 0
  while (idx < size && a[a.length - idx - 1] === b[b.length - idx - 1]) idx++
  return idx
}

/**
 * 上游 `Enumerator`（`Enumerator.kt:16-25`）的等价物：两段数组**共用**一张 id 表，
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

// MyersLCS.kt:64-70 —— max(20000 + 10*sqrt(N), DELTA_THRESHOLD_SIZE=20000 / DiffConfig.kt:10)
const DELTA_THRESHOLD_SIZE = 20000
function deltaThreshold(count1: number, count2: number): number {
  return Math.max(20000 + Math.floor(10 * Math.sqrt(count1 + count2)), DELTA_THRESHOLD_SIZE)
}

/** 上游 `FilesTooBigForDiffException`（`Diff.kt:15` 抛出点 / `MyersLCS.kt:186-188`）。 */
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
    // MyersLCS.kt:38-42：整段共用两张 V，全程不重新分配 —— 这正是"线性空间"的由来。
    const total = first.length + second.length
    this.forward = new Int32Array(total + 1)
    this.backward = new Int32Array(total + 1)
  }

  /** MyersLCS.kt:175-186 —— 从 (oldIndex,newIndex) 往前（正序）吃公共行。 */
  private commonForward(oldIndex: number, newIndex: number, maxLength: number): number {
    const limit = Math.min(maxLength, Math.min(this.first.length - oldIndex, this.second.length - newIndex))
    let x = oldIndex, y = newIndex
    while (x - oldIndex < limit && this.first[x] === this.second[y]) { x++; y++ }
    return x - oldIndex
  }

  /** MyersLCS.kt:188-198 —— 从 (oldIndex,newIndex) 往后（倒序）吃公共行。 */
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
    this.forward[newLength + 1] = 0                            // MyersLCS.kt:104-105
    this.backward[newLength + 1] = 0
    const halfD = (differenceEstimate + 1) >> 1
    const delta = oldLength - newLength
    const deltaOdd = delta % 2 !== 0
    let td = -1, xx = 0, kk = 0

    search: for (let d = 0; d <= halfD; d++) {
      // MyersLCS.kt:110-111：把 k 平移成非负下标，并按奇偶夹出合法区间。
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
        for (let k = L; k <= R; k += 2) {                      // MyersLCS.kt:123-133
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

    if (td > 1) {                                               // MyersLCS.kt:158-164
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
    if (td >= 0) {                                              // MyersLCS.kt:165-184
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
    return false                                                // MyersLCS.kt:186-188：超估计
  }
}

/**
 * 把 `a` 与 `b` 对齐成若干段连续相等的行，**按 `from` 升序**返回。
 *
 * 口径照 `Diff.buildChanges`（`Diff.kt:29-41`）：先掐公共前后缀，中间段交给 Myers。
 * 退路阈值与上游同一套公式（`MyersLCS.kt:64-70`）。
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

  // 掐完前后缀后剩下的就是"真正可能不同"的那一段（`Diff.kt:64-75` 的空侧快路径）。
  const midA = a.slice(shift, a.length - cut)
  const midB = b.slice(shift, b.length - cut)
  if (midA.length === 0 || midB.length === 0) {
    pushPrefix()
    pushSuffix()
    return out
  }

  const [ids1, ids2] = enumerate(midA, midB)
  const threshold = deltaThreshold(midA.length, midB.length)
  const aligner = new MyersAligner(ids1, ids2)
  const pairs: AlignedPair[] = []
  let aligned = false
  try {
    aligned = aligner.run(0, midA.length, 0, midB.length, threshold, (s1, s2, count) => {
      for (let i = 0; i < count; i++) pairs.push({ from: shift + s1 + i, to: shift + s2 + i })
    })
  } catch (error) {
    if (!(error instanceof FilesTooBigForDiff)) throw error
    aligned = false
  }

  pushPrefix()
  if (aligned) {
    for (const pair of pairs) out.push(pair)
  }
  // aligned 为 false 时中间整段视作一整块改动（上游此处改用 Patience，见 `Diff.kt:96-101`）。
  pushSuffix()
  return out
}
