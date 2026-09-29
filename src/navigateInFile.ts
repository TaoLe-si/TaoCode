// IDEA 的 Navigate → Navigate in File → 下一个/上一个方法（`MethodDown` / `MethodUp`）。
//
// 已核实的依据：
//   · 动作 `MethodDownAction` / `MethodUpAction`
//     （`platform/lang-impl/src/com/intellij/codeInsight/navigation/actions/MethodDownAction.java` / `MethodUpAction.java`）
//   · 动作 id `MethodDown` / `MethodUp`（`platform/lang-impl/resources/idea/PriorityEditorLangActions.xml:38-39`）
//   · 菜单位置 `NavigateInFileGroup`（`platform/platform-impl/resources/idea/PlatformActions.xml:620-628`）
//   · 算法 `MethodUpDownUtil.getNavigationOffsets`（`platform/lang-impl/src/com/intellij/codeInsight/navigation/MethodUpDownUtil.java:24`）
//   · 选择 `MethodDownHandler:23-31` / `MethodUpHandler:23-30`
//   · 前置条件 `MethodUpAction.checkValidForFile`：文件要有 `TreeBasedStructureViewBuilder`（即**有结构视图**）
//
// **两个容易搞错的忠实细节**（TaoCode 早先的实现两处都不对，这里更正）：
//
// 1. 名字叫 "Method"，但挑的是**结构视图里的所有元素**，不只是方法 ——
//    `addStructureViewElements`（`:61-73`）对结构树的每个子元素**递归**收集 `getTextOffset()`，
//    只跳过重复项与不属于当前文件的元素。所以类、字段、嵌套结构**都算**导航点。
//    TaoCode 的 `documentSymbol` 响应正好是结构视图的等价物（且已按深度优先拍平，见 lsp_semantics_test）。
// 2. `$MethodDown` / `$MethodUp` **没有默认快捷键** ——
//    `grep -rn 'actionId="$MethodDown"' --include=*.xml` 零命中。IDEA 里只有菜单项，键位交给用户自绑。
//    所以菜单里也不该写 keys（写了就等于宣称"这是 IDEA 的键"）。
//
// 选择规则本身：`offset > caretOffset` **且** 目标 `line > caretLine`（`MethodDownHandler:27-29`）。
// 后者让"同一行上更靠右的符号"不算下一个方法 —— 两个条件在行序排列下等价于"行号严格更大"，
// 这里按行号实现（文档位置的最小可比单位）。

/** 结构视图里的一个导航点。`kind` 只用于提示文案，**不参与筛选**（见模块注释第 1 条）。 */
export interface NavigationPoint {
  name: string
  line: number
}

/** LSP `DocumentSymbol` 的最小形状（原生层已按深度优先拍平）。 */
export interface NavigationSymbol {
  name: string
  kind?: number
  startLine?: number
}

/**
 * 收集导航点：**所有**符号的起始行（去重、升序）。
 * 不做 kind 过滤 —— 这正是 IDEA 的行为（`addStructureViewElements` 收结构树的全部子元素）。
 */
export function navigationPoints(symbols: readonly NavigationSymbol[] | undefined): NavigationPoint[] {
  if (!Array.isArray(symbols)) return []
  const seen = new Set<number>()
  const points: NavigationPoint[] = []
  for (const symbol of symbols) {
    const line = symbol?.startLine
    if (!Number.isInteger(line) || (line as number) < 0) continue
    if (seen.has(line as number)) continue          // 同一行有多个符号只留一个（IDEA 也用集合去重）
    seen.add(line as number)
    points.push({ name: symbol.name ?? '', line: line as number })
  }
  return points.sort((left, right) => left.line - right.line)
}

export type NavigationDirection = 1 | -1

/**
 * 从光标行找下一个（`1`）/ 上一个（`-1`）导航点。
 * 到头时返回 `undefined` —— 调用方据此提示"已经是最后一个"，而不是绕回去
 * （IDEA 的 handler 直接 `return null`，不循环）。
 */
export function navigateFrom(points: readonly NavigationPoint[], caretLine: number, direction: NavigationDirection): NavigationPoint | undefined {
  if (!Number.isInteger(caretLine)) return undefined
  return direction === 1
    ? points.find(point => point.line > caretLine)
    : [...points].reverse().find(point => point.line < caretLine)
}

/** 到位/到底的提示文案。 */
export function describeNavigationBoundary(direction: NavigationDirection): string {
  return direction === 1 ? '已经是最后一个方法。' : '已经是第一个方法。'
}
