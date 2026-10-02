// 弹层的**位置夹取** —— 上游 `AbstractPopup` 定位链的最后一环。
//
// 判决表里这条一直挂在 `popupBounds.ts`（尺寸/位置**记忆**）名下，但记忆与夹取是两件事：
// 记忆管的是"下次弹开回到哪"（`AbstractPopup.storeLocation`，:2320-2324），夹取管的是
// "这一次**这个视口**里放不放得下"（`AbstractPopup` 定位时保证组件完整可见的那段）。
// 状态栏的组件菜单就是被漏掉的那一半：它锚在**窗口最底边**上，16 行高约 480px，
// 早先 `openStatusMenu`（src/notifications.ts）只是把 `clientX/clientY` 原样写进
// `style.left/top`，于是弹层 80% 掉到视口外面 —— 截图里只看得见标题那半条。
// 之前没人发现，是因为整个状态栏压根没渲染过（`showStatusBar` 被 native 的键白名单漏了）。
//
// 上游口径：放不下就**翻到锚点另一侧**（Alignment），两侧都放不下才夹到视口边（margin）。
// 这里照抄这个顺序，不是简单地 `min(y, maxY)` —— 直接夹会把菜单压在锚点上方一大截，
// 视觉上是"菜单飘到了别处"；翻转才是 IDEA 的行为。

/** 锚点（鼠标位置或触发元素的一角）与视口/弹层尺寸，都是 CSS 像素。 */
export interface MenuPlacementInput {
  /** 锚点：右键点或触发点。 */
  x: number
  y: number
  /** 弹层自身尺寸。 */
  width: number
  height: number
  /** 视口尺寸。 */
  viewportWidth: number
  viewportHeight: number
  /** 离视口边至少留这么多像素（默认 4，与 `popupBounds.clampPopupLocation` 一致）。 */
  margin?: number
}

/**
 * 返回弹层左上角该在的位置。
 *
 * 三步，与上游一致：先试原位 → 放不下翻到锚点上方 → 仍放不下夹进视口。
 * 水平方向没有"翻转"这一说（翻过去会盖住右键的那一列），只夹。
 */
export function placeMenu(input: MenuPlacementInput): { x: number; y: number } {
  const margin = input.margin ?? 4
  const width = Math.max(0, input.width)
  const height = Math.max(0, input.height)
  // 视口再小也要给 margin 留位置，否则夹出来的坐标会为负（弹层贴到视口左边外面）。
  const maxX = Math.max(margin, input.viewportWidth - width - margin)
  const maxY = Math.max(margin, input.viewportHeight - height - margin)
  const below = input.y
  const above = input.y - height - margin
  // 下方放得下就下方；否则上方；上方也不够（菜单比视口还高）就交给 maxY 夹。
  const preferredY = below + height + margin <= input.viewportHeight ? below : above
  return {
    x: Math.max(margin, Math.min(input.x, maxX)),
    y: Math.max(margin, Math.min(preferredY, maxY)),
  }
}
