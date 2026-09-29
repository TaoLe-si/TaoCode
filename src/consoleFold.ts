// 控制台行折叠（IDEA ConsoleConfigurable，`ConsoleConfigurable.java:43-73`）：
// 设置里有两个列表 —— 「要折叠的行」(console.fold.console.lines) 与「不折叠的例外」(console.fold.exceptions)。
// IDEA 的行为是：连续重复且命中折叠规则、且不命中例外的行，合并成一条并显示出现次数。
// 这里抽成纯函数，便于测试与复用（运行输出、操作输出都用它）。
// 从 App.vue 拆出（桃 2026-09-27：模块化）。

export interface FoldableLine {
  text: string
  /** 附加信息（如解析出的构建问题），随行保留。 */
  issue?: unknown
}

/** 折叠后的行：原行 + 折叠次数（>1 时渲染 ×N）。 */
export type FoldedLine<T extends FoldableLine> = T & { count?: number }

/**
 * @param lines       原始行（顺序保留）
 * @param foldRules   命中这些子串的行才参与折叠；**为空表示不折叠任何内容**（默认）
 * @param exceptions  命中这些子串的行永不折叠
 * @param limit       折叠后保留的最大行数（从末尾截取，等价于"只看最后 N 行"）
 */
export function foldConsoleLines<T extends FoldableLine>(
  lines: readonly T[],
  foldRules: readonly string[],
  exceptions: readonly string[] = [],
  limit = 2000,
): FoldedLine<T>[] {
  const rules = foldRules.map(rule => rule.trim()).filter(Boolean)
  const skips = exceptions.map(rule => rule.trim()).filter(Boolean)
  // 没有折叠规则时不做任何合并（IDEA 默认空列表 = 不折叠）。
  const folded: FoldedLine<T>[] = rules.length === 0 ? [...lines] : []
  if (rules.length) {
    for (const line of lines) {
      const eligible = !skips.some(skip => line.text.includes(skip)) && rules.some(rule => line.text.includes(rule))
      const last = folded[folded.length - 1]
      if (eligible && last && last.text === line.text && !skips.some(skip => last.text.includes(skip))) {
        // 连续重复且都命中折叠规则：累加计数，不再追加新行。
        last.count = (last.count ?? 1) + 1
        continue
      }
      folded.push({ ...line })
    }
  }
  return folded.length > limit ? folded.slice(-limit) : folded
}
