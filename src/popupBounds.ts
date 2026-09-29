// 浮层的**尺寸与位置记忆** —— IDEA `AbstractPopup` 的 `setDimensionServiceKey` 那一半。
//
// 判决表原把这条记在 `PopupState.java` 名下，核对原文后是误读：`PopupState`（`platform-api/src/
// com/intellij/ui/popup/PopupState.java`，192L）**只管"刚关掉又立刻弹开"的抑制**
// （`isRecentlyHidden()`，registry `ide.popup.hide.show.threshold` 默认 200ms），连一个 size 字段都没有
// （本仓的对应物是 `src/popupState.ts` 的 `createPopupGate`）。
//
// 尺寸/位置记忆在 `AbstractPopup`：
//   · `getStoredSize()`（`platform/platform-impl/src/com/intellij/ui/popup/AbstractPopup.java:3145-3148`）
//     = `key == null ? null : WindowStateService.getSize(key)`；
//   · `storeDimensionSize()`（`:2314-2318`）在弹层关闭/尺寸变化时 `putSize(key, getContentSize())`；
//   · `getStoredLocation()` / `storeLocation()`（`:3140-3143` / `:2320-2324`）同理走 location；
//   · key 由调用方给（`setDimensionServiceKey`，`:594-596`），**是否连位置一起记**是 builder 的
//     `setUseDimensionServiceForXYLocation`（`platform-api/src/com/intellij/openapi/ui/popup/
//     PopupChooserBuilder.java:284-287`、`:444`）—— Search Everywhere 传的就是 `true`
//     （`SearchEverywhereManagerImpl.java:147`），所以它记尺寸**也**记位置。
//
// 「第一次没有存档」是上游明确处理的：`getStoredSize()` 返回 null 时按首选尺寸显示
// （`SearchEverywhereManagerImpl.java:184-188` 就是 `getSize` 为 null 才用 `getPreferredSize()`）。
// 本模块照这条写：读不到存档就返回 null，由调用方用自己的默认值。

/** 一个浮层记下的尺寸与位置（像素）。位置在 `useLocation` 为假时为空。 */
export interface PopupBounds {
  width: number
  height: number
  x?: number
  y?: number
}

/**
 * 把存档文本解析成边界；**任何不认识/越界/非数的值都返回 null**（等于"没有存档"），
 * 于是调用方退回默认尺寸，不会因为坏存档把浮层显示到看不见的地方。
 */
export function parsePopupBounds(raw: string | null, viewport: { width: number; height: number }): PopupBounds | null {
  if (raw === null) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object') return null
  const bounds = value as Record<string, unknown>
  const width = Number(bounds.width)
  const height = Number(bounds.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  // 尺寸不许比视口还大（不然用户会拖出一个关不掉/看不到内容的浮层）。
  const clamped: PopupBounds = { width: Math.min(width, viewport.width), height: Math.min(height, viewport.height) }
  const x = Number(bounds.x)
  const y = Number(bounds.y)
  if (Number.isFinite(x) && Number.isFinite(y)) { clamped.x = x; clamped.y = y }
  return clamped
}

/** 序列化（写入 localStorage 之前）。位置缺失就不写这两个字段。 */
export function serializePopupBounds(bounds: PopupBounds): string {
  const out: Record<string, number> = { width: Math.round(bounds.width), height: Math.round(bounds.height) }
  if (bounds.x !== undefined && bounds.y !== undefined) { out.x = Math.round(bounds.x); out.y = Math.round(bounds.y) }
  return JSON.stringify(out)
}

/**
 * 把记下的位置夹回视口内（上游 `AbstractPopup` 在 `locateWithinScreenBounds` 里做同一件事，
 * Search Everywhere 把它关掉是因为它自己算位置；本仓是 WebView，屏幕变小后旧坐标必须夹回来，
 * 否则窗口一缩浮层就跑到看不见的地方）。
 */
export function clampPopupLocation(bounds: PopupBounds, viewport: { width: number; height: number }): { x: number; y: number } | null {
  if (bounds.x === undefined || bounds.y === undefined) return null
  return {
    x: Math.max(0, Math.min(bounds.x, Math.max(0, viewport.width - bounds.width))),
    y: Math.max(0, Math.min(bounds.y, Math.max(0, viewport.height - bounds.height))),
  }
}
