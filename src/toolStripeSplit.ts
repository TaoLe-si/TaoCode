// 侧条上的**后半组**（side tool / split 按钮）—— IDEA `AbstractDroppableStripe` 的那条分组规则。
//
// 上游依据（本机参考树，逐行数过）：
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractDroppableStripe.kt:57-72`
//     `createButtonLayoutComparator`：第一判据是 `windowDescriptor.isSplit` —— 「side buttons in the end」
//     （`:59-62`），只有两侧 `isSplit` 相同才比 `order`（`:68-70`，`-1` 当成 `Int.MAX_VALUE`，`:74-77`）。
//     其中 `:63-67` 那一支「新 UI 的 BOTTOM 且非水平条纹取反序」作用在**方形按钮的底部条纹**上；
//     本仓底部那一排是**内容标签**（`TabbedPaneContentUI` 那一条，见 `src/toolWindowContentUi.ts`），
//     不是 `StripeV2(BOTTOM)` ⇒ 不套这一支，登记为有意差异。
//   · 同文件 `:98-111` + `:571-623`（`getButtonsToLayOut`）：新 UI 的左/右竖直条纹把后半组
//     **收在一条 `StripeButtonSeparator` 之后** —— 分隔件插在"第一个 split 按钮之前"
//     （`:592-597`），插在**第 0 位**时（整条都是后半组）不画（`:602-609`）。
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/StripeButtonSeparator.kt:15-39`：
//     首选尺寸 32×11（`:22-23`），画的是一条**居中**的 24×1 线（`:31-35`），颜色
//     `ToolWindow.Stripe.separatorColor`（`:36`；`platform/util/ui/src/com/intellij/util/ui/JBUI.java:1151-1155`，
//     拖拽态换成 `ToolWindow.Stripe.DragAndDrop.separatorColor`）。
//   · 写入点：`AbstractDroppableStripe.kt:250-256` 的 `finishDrop` 把落点算成
//     `isSplit` 再交给 `setSideToolAndAnchor`；`:463-469` 是那条判据的原文 ——
//     **落点矩形在分隔线之下就是后半组**。
//
// `isSplit` 的初值不是用户拖出来的，是注册期定的：EP 的 `secondary`
// （`ToolWindowSetInitializer.kt:368` 的 `sideTool = bean.secondary || bean.side`
//   → `RegisterToolWindowTask.sideTool` → `DesktopLayout.kt:46`），
// 读法在 `src/toolWindowManager.ts` 的 `toolWindowSplitDefault`。
//
// 本文件只放**纯规则**（比较、分隔件位置、落点判定、分隔件的尺寸），两边都不碰 DOM 与存档：
// 消费方是 `src/toolWindowStripes.ts`（排布 + 存档）、`src/toolStripeDrag.ts`（落点）与
// `src/components/ToolStripe.vue`（画那一条线）。

/** `StripeButtonSeparator.getPreferredSize()`（`StripeButtonSeparator.kt:22-23`）：32×11。 */
export const STRIPE_SEPARATOR_HEIGHT_PX = 11
/** 画出来的线宽 `JBUI.scale(24)`（`:31`）。 */
export const STRIPE_SEPARATOR_LINE_WIDTH_PX = 24
/** 画出来的线高 `JBUI.scale(1)`（`:32`）。 */
export const STRIPE_SEPARATOR_LINE_THICKNESS_PX = 1

/**
 * 条纹比较器的第一判据（`:59-62`）：后半组排在后面。
 * 返回值 < 0 ⇒ `a` 在前。同组内按进来的次序（= `WindowInfo.order`，`src/toolWindowStripes.ts`
 * 的顺序表已经是它排好的结果）⇒ 这里是**稳定**分组，不重排同组按钮。
 */
export function splitStripeButtonsLast<T extends string>(ids: readonly T[], isSplit: (id: T) => boolean): T[] {
  const primary: T[] = []
  const side: T[] = []
  for (const id of ids) (isSplit(id) ? side : primary).push(id)
  return [...primary, ...side]
}

/**
 * 分隔件画在第几个按钮**之前**（`getButtonsToLayOut:592-597`：插在第一个 split 按钮前面）。
 *
 * 两种「不画」的情况逐条抄上游：
 *   · 一个后半组都没有（`:593` 那个循环没命中 ⇒ `separator.isVisible = false`）⇒ null；
 *   · 第一个后半组就在第 0 位（整条都是后半组，`:602-609` 在非拖拽态把分隔件摘掉）⇒ null。
 * 传进来的 `ids` 必须是**已经分好组**的那一份（`splitStripeButtonsLast` 的输出），
 * 上游同样是先 `tools.sortWith(comparator)` 再找分隔件位置（`:590-597`）。
 */
export function stripeSeparatorIndex<T extends string>(ids: readonly T[], isSplit: (id: T) => boolean): number | null {
  const at = ids.findIndex(id => isSplit(id))
  return at > 0 ? at : null
}

/**
 * 拖放的落点算不算「放进后半组」（`:463-469` 的 `data.isSplit = drawRectangle.y > separator.y`）。
 *
 * 上游比的是像素，本仓的落点是离散的行标记（`ToolStripe.vue` 的 `stripe-drop-marker`，
 * 由 `src/toolStripeDrag.ts` 记「插在哪个按钮之前」），所以这里比的是**下标**：
 * 落点在分隔件所在槽位或其之后 ⇒ 后半组。
 * `separatorIndex = null`（这一侧还没有后半组）时返回 `null` = **不改这一位**：
 * 上游在那种情况下也会把分隔件临时挂出来当落点（`:613-617`），但那是靠鼠标压在**分隔件本体**上
 * 才成立的（`tryDroppingOnGap`），行标记模型给不出"压在缝上"这一档 ⇒ 不猜，保持原值。
 */
export function splitForDrop(separatorIndex: number | null, insertIndex: number): boolean | null {
  if (separatorIndex === null) return null
  return insertIndex >= separatorIndex
}
