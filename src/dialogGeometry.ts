// 对话框尺寸记忆 —— 上游 `DialogWrapper` 的 `getDimensionServiceKey()` / `setSize()` 语义
// （`DialogWrapper.java:1316-1321` 的 key、`:1784-1787` 的 setSize、`:1095` 的恢复路径）：
// 每个对话框一个稳定 key，尺寸存进 DimensionService，下次打开按 key 还原并夹进当前视口。
//
// 本仓的等价物：`<dialog>` + localStorage。消费方（判据 `tests/platform-dialog-geometry-wiring.test.mjs`，
// 那条门禁要求"引了这个模块的对话框必须既读又存、且样式真的能改尺寸"）：
//   · `src/components/ProjectDialog.vue` —— 键 `project-dialog`；
//   · `src/components/SpecialPathsDialog.vue` —— 键 `special-paths-dialog`。
// 两边都配了 CSS `resize: both`：对话框**能拖大**这件事本身是上游 DialogWrapper 的默认行为
// （`DialogWrapperPeerImpl.java:442-443`），没有 resize 的话记忆尺寸读回来永远是那个默认宽，等于没接。
// 与上游的差别：不存位置 —— 本仓对话框由 `showModal()` + `margin:auto` 居中，
// 位置记忆会与居中/小窗口下的自动布局打架；上游 Bounds 记忆也主要用于可停靠窗口。

export interface DialogSize {
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

/** 最小可用尺寸：比它更小的还原值没有意义（上游 DialogWrapper 也有最小尺寸门限）。 */
export const MIN_DIALOG_SIZE: DialogSize = { width: 320, height: 200 }
/** 视口四周留白：还原后的对话框不许贴边（否则边框/阴影被裁）。 */
export const DIALOG_VIEWPORT_MARGIN = 16

export function dialogGeometryKey(name: string): string {
  return `taocode.dialog.${name}`
}

/** 把任意输入规整成合法尺寸；不是有限正数就返回 null（坏数据不还原，不猜）。 */
export function parseDialogSize(raw: unknown): DialogSize | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as { width?: unknown; height?: unknown }
  if (typeof value.width !== 'number' || typeof value.height !== 'number') return null
  if (!Number.isFinite(value.width) || !Number.isFinite(value.height)) return null
  if (value.width <= 0 || value.height <= 0) return null
  return { width: Math.round(value.width), height: Math.round(value.height) }
}

/** 夹进视口：先保最小尺寸，再保「不超出视口 - 留白」；两者冲突时最小尺寸优先。 */
export function clampDialogSize(size: DialogSize, viewport: Viewport): DialogSize {
  const maxWidth = Math.max(MIN_DIALOG_SIZE.width, viewport.width - 2 * DIALOG_VIEWPORT_MARGIN)
  const maxHeight = Math.max(MIN_DIALOG_SIZE.height, viewport.height - 2 * DIALOG_VIEWPORT_MARGIN)
  return {
    width: Math.min(Math.max(size.width, MIN_DIALOG_SIZE.width), maxWidth),
    height: Math.min(Math.max(size.height, MIN_DIALOG_SIZE.height), maxHeight),
  }
}

export interface SizeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 读回尺寸；存储不可用（隐私模式等）或内容坏掉时返回 null。 */
export function loadDialogSize(storage: SizeStorage | null | undefined, key: string): DialogSize | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    return parseDialogSize(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveDialogSize(storage: SizeStorage | null | undefined, key: string, size: DialogSize): void {
  if (!storage) return
  const parsed = parseDialogSize(size)
  if (!parsed) return
  try {
    storage.setItem(key, JSON.stringify(parsed))
  } catch {
    // 存储不可用：本次会话内不记忆，不影响对话框本身。
  }
}

/** 从渲染出来的元素矩形取尺寸（宽高为 0 时返回 null —— 元素已隐藏/未布局）。 */
export function sizeFromRect(rect: { width: number; height: number }): DialogSize | null {
  return parseDialogSize({ width: rect.width, height: rect.height })
}
