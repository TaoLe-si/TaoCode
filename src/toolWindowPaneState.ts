// 工具窗口 **pane 的状态对象**（上游 `com.intellij.toolWindow.ToolWindowPaneState` +
// `ToolWindowEntry` + `StripeButtonManager` 里本仓真有消费者的那两件事）。
//
// 上游三个对象：
//   · `ToolWindowPaneState`（`ToolWindowPaneState.kt:13-46`）：`idToSplitProportion`（按窗口 id 存
//     分隔比例）、`maximizedProportion`（被最大化的窗口）、`isStripesOverlaid`，以及
//     `getPreferredSplitProportion(id, defaultValue)` / `addSplitProportion(...)` / `isMaximized(window)`。
//   · `ToolWindowEntry`（`ToolWindowEntry.kt:37-70`）：每个窗口一条（`toolWindow` + `disposable` +
//     `stripeButton` + 三个装饰器 + `balloon`），其中 `stripeButton` 的 setter **有断言**：
//     置非空时原值必须为空、置空时原值必须非空（`:38-45`）—— 也就是"按钮的挂/摘严格配对"。
//   · `StripeButtonManager`：侧条按钮的更新面（图标/可见性/移除）。
//
// **本仓能兑现的是哪两件**（其余判 `[-]`，理由见判决 §G）：
//   ① **"0 = 没存过"那条哨兵**。上游 `getPreferredSplitProportion` 里
//      `if (f == 0f) return defaultValue` —— `Object2FloatOpenHashMap` 对缺失键返回 0，
//      所以 0 被当成"没存过"。本仓的编辑区分栏尺寸本来就是这个语义
//      （`panelResize.ts` 里两处 `if (splitSize.value === 0) … = 一半`），但它是**内联重复**的，
//      没有名字也没有判据。这里把它抽成一个函数，语义与上游逐字对齐。
//   ② **按钮挂/摘严格配对**。上游 `ToolWindowEntry.stripeButton` 的断言防的是
//      "同一个窗口挂了两个按钮"或"摘了两次"。本仓的 `taocode.hiddenStripeButtons` 是同一套状态机
//      （侧栏按钮可移除、再激活即恢复），但没有任何东西在检查配对。这里把契约写成可测的函数。

/**
 * 上游 `getPreferredSplitProportion`（`ToolWindowPaneState.kt:20-29`）：
 * 存过就用存的，否则用默认值。**0 视为"没存过"**（同 `f == 0f` 那条哨兵）。
 *
 * `id === null` 时也走默认值 —— 上游 `idToSplitProportion.getFloat(null)` 对空键同样返回 0，
 * 落到同一个分支。
 */
export function preferredSplitProportion(proportions: Readonly<Record<string, number>>, id: string | null, defaultValue: number): number {
  if (id === null) return defaultValue
  const stored = proportions[id]
  if (typeof stored !== 'number' || stored === 0) return defaultValue
  return stored
}

/**
 * 同一语义的**单值**形态，供"值就在手上、没有表"的调用点用（本仓的编辑区分栏尺寸就是这样：
 * 它是 `splitSize` 一个数字，0 表示用户还没拖过）。
 *
 * `splitSizeOrDefault(0, 350)` ⇒ 350；`splitSizeOrDefault(280, 350)` ⇒ 280。
 */
export function splitSizeOrDefault(stored: number, defaultValue: number): number {
  return stored === 0 ? defaultValue : stored
}

/**
 * 上游 `addSplitProportion`（`:31-38`）：**只有这个窗口处于分栏模式（`info.isSplit`）且组件存在**
 * 才记比例 —— 单栏窗口没有可比的比例，记下来只会污染下一次的读取。
 * 本仓没有"工具窗口内分栏"这个形态（判决 §G 里记着），所以调用方传的 `isSplit` 恒为假时
 * 这个函数就是空操作；保留它是为了让那条守卫**有名字、可测**，而不是散在调用点。
 */
export function withSplitProportion(proportions: Readonly<Record<string, number>>, id: string, proportion: number, isSplit: boolean): Record<string, number> {
  if (!isSplit) return { ...proportions }
  // 上游直接 put（不做 clamp）—— `Splitter.proportion` 本来就保证在 (0,1] 内。
  return { ...proportions, [id]: proportion }
}

/** 上游 `isMaximized(window)`（`:41-44`）：按**窗口身份**比，不是按边。 */
export function isMaximized(maximizedId: string | null, id: string): boolean {
  return maximizedId !== null && maximizedId === id
}

/**
 * 上游 `ToolWindowEntry.stripeButton` 的 setter 断言（`ToolWindowEntry.kt:38-45`）：
 * 挂的时候原值必须为空、摘的时候原值必须非空。违反就是"挂了两个按钮"或"摘了两次" ——
 * 上游用 `assert`（开发期报错，生产期放行），本仓返回一个**结构化的结果**，让调用方决定
 * 是抛还是记日志（宿主那边会 notify）。
 */
export type StripeButtonTransition =
  | { ok: true; next: string | null }
  | { ok: false; reason: 'already-attached' | 'not-attached' }

export function attachStripeButton(current: string | null, next: string): StripeButtonTransition {
  return current === null ? { ok: true, next } : { ok: false, reason: 'already-attached' }
}

export function detachStripeButton(current: string | null): StripeButtonTransition {
  return current === null ? { ok: false, reason: 'not-attached' } : { ok: true, next: null }
}

/**
 * 上游 `ToolWindowEntry.removeStripeButton()`（`:68-70`）：用**窗口自己的**锚点与分栏态去摘。
 * 本仓的等价物是"从侧栏移除按钮"（持久化 `taocode.hiddenStripeButtons`，再激活即恢复）——
 * 这里把"该用哪个键"写成函数：锚点参与键名（同一条窗口换边之后是另一个按钮）。
 */
export function stripeButtonKey(id: string, anchor: string): string {
  return `${id}:${anchor}`
}