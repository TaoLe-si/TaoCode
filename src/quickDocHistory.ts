// 文档浏览器的**前进/后退历史** —— 上游 `DocumentationBrowserHistory` 的等价物。
//
// 上游 `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationBrowserHistory.kt:7-48`
// 构造时收一对 `snapshot: () -> T` / `restore: (T) -> Unit`，内部两个 `Stack<T>`：
//   · `nextPage()`（:43-47）—— 点进新页面：把**当前**快照压进 backStack 并**清空 forwardStack**；
//   · `backward()`（:20-24）—— 先把当前快照压进 forwardStack，再弹 backStack 交给 `restore`；
//   · `forward()`（:31-35）—— 对称；
//   · `canBackward`/`canForward`（:15-18、:26-29）就是「对应栈非空」，
//     `DocumentationBackAction.kt:14` / `DocumentationForwardAction.kt:14` 据此置灰。
// 这里逐条照抄，包括 `backward()` 里「先存后弹」的顺序。
//
// 本仓的「页面」是**一次文档解析的结果**（签名 + 区块 + 链接 + 图片，见 `src/quickDocLayout.ts`）：
// 点一条 `file:` 内部链接会用新的一页换掉当前页，所以历史是真的会被用到的。
//
// 与上游的差异（如实）：上游的 `Stack` 无上限；本仓给了 `limit`（默认 32）并在压栈时裁到上限 ——
// 一个符号可能点出上百条 javadoc 链接，不设限会一直涨。裁的是**最旧**的一端（`shift()`），
// 与 `src/hoverDocumentation.ts` 的每文件 LRU 同一取向。

/** 每条栈的上限（默认 32；见文件头关于无上限的说明）。 */
export const DEFAULT_HISTORY_LIMIT = 32

export interface DocumentationHistory<T> {
  canBackward(): boolean
  /** 后退一页。栈空或 `restore` 抛错时返回 `false`。 */
  backward(): boolean
  canForward(): boolean
  forward(): boolean
  /** 记一次「新页面」：当前页压进 back，forward 清空（上游 `nextPage()`）。 */
  nextPage(): void
  clear(): void
  /** back + forward 的总条数（测试与诊断用）。 */
  size(): number
}

export function createDocumentationHistory<T>(
  snapshot: () => T,
  restore: (value: T) => void,
  limit = DEFAULT_HISTORY_LIMIT,
): DocumentationHistory<T> {
  const back: T[] = []
  const forward: T[] = []
  const cap = Math.max(1, limit)
  /** 压栈并裁到上限：栈顶是最新的，所以丢**末尾**（最旧）那一端。 */
  function push(stack: T[], value: T): void {
    stack.push(value)
    while (stack.length > cap) stack.shift()
  }
  return {
    canBackward: () => back.length > 0,
    backward() {
      if (!back.length) return false
      const previous = back.pop() as T
      // 顺序与上游 `backward()` 逐行一致：先存当前快照，再弹上一页交给 restore。
      push(forward, snapshot())
      restore(previous)
      return true
    },
    canForward: () => forward.length > 0,
    forward() {
      if (!forward.length) return false
      const next = forward.pop() as T
      push(back, snapshot())
      restore(next)
      return true
    },
    nextPage() {
      push(back, snapshot())
      forward.length = 0
    },
    clear() {
      back.length = 0
      forward.length = 0
    },
    size: () => back.length + forward.length,
  }
}
