// Select In（IDEA 的 `SelectInAction`）的目标表、编号与助记符命中规则。纯函数，可单测。
//
// 每一条判据都指到上游源码：
//  · 顺序 = `com.intellij.selectInTarget` 实例按 `getWeight()` **升序**稳定排序
//    （SelectInManager.java:23-27 取表 + :54-61 比较器；默认权重 0 见 SelectInTarget.java:49-51）。
//  · 行号 = 可见列表里的序号，1..9 之后是 **0**，再之后是 A、B…
//    （ActionStepBuilder.java:120-131 `appendAction`；旧版列表弹窗是同一条规则的字符串版：
//     SelectInAction.java:184-195 `numberingText`）。分隔行不占号（:112-117 只对非 separator 计数）。
//  · 不可选的目标**留在表里置灰**，不是删掉：弹窗建的时候 showDisabledActions=true
//    （SelectInAction.java:99-105 第 5 个实参），能否选中由 `isSelectable` 决定（:171-176）。
//  · 数字/字母命中：只在 KEY_TYPED、只接受字母或数字、速度搜索**已有字时不抢键**、命中即吃掉事件
//    （MnemonicsSearch.java:34-46），助记符表大小写各登记一次（:25-31）。

export interface SelectInTargetSpec {
  id: string
  label: string
  weight: number
  selectable: boolean
}

export interface SelectInRow extends SelectInTargetSpec {
  /** 显示在行首独立数字列里的助记符：'1'..'9'、'0'、'A'… */
  number: string
}

/** 上游 ActionStepBuilder.java:120-131 与 SelectInAction.java:184-195 的同一套编号。 */
export function selectInNumber(index: number): string {
  if (index < 9) return String(index + 1)
  if (index === 9) return '0'
  return String.fromCharCode(65 + index - 10) // 'A' + n - 10
}

/** 按权重升序排（同权重保持传入顺序 —— 上游是 `List.sort`，稳定）并编号。 */
export function planSelectIn(targets: readonly SelectInTargetSpec[]): SelectInRow[] {
  return targets.map((target, index) => ({ ...target, index })).sort((a, b) => a.weight - b.weight || a.index - b.index)
    .map((target, number) => ({ id: target.id, label: target.label, weight: target.weight, selectable: target.selectable, number: selectInNumber(number) }))
}

/** 助记符 → 行号。大小写各登记一次（MnemonicsSearch.java:25-31）。 */
export function selectInMnemonics(rows: readonly SelectInRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    map.set(row.number.toUpperCase(), row.id)
    map.set(row.number.toLowerCase(), row.id)
  }
  return map
}

/** `Character.isLetterOrDigit` 的对应判定（MnemonicsSearch.java:39）。 */
export function isLetterOrDigitKey(key: string): boolean {
  return key.length === 1 && /^(?:\p{L}|\p{N})$/u.test(key)
}

/**
 * 按键是否命中某个助记符。速度搜索框里已有字时一律让路（MnemonicsSearch.java:37），
 * 不可选的行也**不**命中：置灰的行没有可执行的动作（SelectInAction.java:171-176）。
 */
export function selectInMnemonicHit(map: ReadonlyMap<string, string>, rows: readonly SelectInRow[], key: string, filter: string): string | null {
  if (filter.trim()) return null
  if (!isLetterOrDigitKey(key)) return null
  const id = map.get(key.toUpperCase())
  if (!id) return null
  return rows.find(row => row.id === id && row.selectable) ? id : null
}

/**
 * 速度搜索过滤。上游用 `NameUtil.MatcherBuilder`/`MinusculeMatcher`（SpeedSearch.java:158-166），
 * 这里是**大小写无关的子串**版：空串放行全部、命中后保持原有（按权重）顺序，这两点与上游一致。
 */
export function filterSelectIn(rows: readonly SelectInRow[], filter: string): SelectInRow[] {
  const needle = filter.trim().toLowerCase()
  if (!needle) return [...rows]
  return rows.filter(row => row.label.toLowerCase().includes(needle))
}

/** 上下键在**可选项**之间移动，跳过置灰行；到达两端不回绕（`ListPopupBaseStep` 的选择行为）。 */
export function moveSelectIn(rows: readonly SelectInRow[], from: number, delta: number): number {
  if (!rows.length) return -1
  let cursor = from
  for (let step = 0; step < rows.length; step++) {
    cursor += delta
    if (cursor < 0 || cursor >= rows.length) return from
    if (rows[cursor]?.selectable) return cursor
  }
  return from
}
