// Tool-window layouts, ported from IDEA's `ToolWindowDefaultLayoutManager` and the WindowMenu
// `LayoutsGroup` (`PlatformActions.xml:641-651`).
//
// The model is the source's, not invented:
// - a layout is a named snapshot of the tool windows' placement, order, visibility and size
//   (`ToolWindowDefaultLayoutManager.kt:70-77` stores the sorted window descriptors plus the
//   unified weights of a `DesktopLayout`);
// - there is always an *active* layout name (:54-58);
// - the factory default answers to the empty name and is never stored in the map
//   (`FACTORY_DEFAULT_LAYOUT_NAME = ""`, :47; `loadState` removes such an entry again in case the
//   storage is corrupted, :117);
// - saving over the factory default is impossible — `setLayout` renames it to
//   `INITIAL_LAYOUT_NAME` = "Custom" (:46, :76-82);
// - `RestoreDefaultLayout` (Shift+F12, `$default.xml:864-866`) reapplies the *active* layout
//   (`RestoreDefaultLayoutAction.java:41-47`), `RestoreFactoryDefaultLayout` switches the active
//   name to the factory default (`RestoreFactoryDefaultLayoutAction.kt:29-35`),
//   `StoreDefaultLayout` writes the current state into the active layout
//   (`StoreNamedLayoutAction.kt:22-25`) and `StoreNewLayout` prompts for a name and writes a new
//   one (`StoreNewLayoutAction.kt:25-32`);
// - a name must be non-blank, no longer than `ide.max.tool.window.layout.name.length` (registry
//   default 50, `registry.properties:2198`) and not already taken. A taken name keeps the OK
//   button enabled and is refused when it is pressed, while a too long name shows its error
//   immediately (`LayoutNameInputDialog.kt:84-118`).
import { resolveContentUiType, type ToolWindowContentUiType } from './toolWindowContentUi.ts'

/** `ToolWindowDefaultLayoutManager.FACTORY_DEFAULT_LAYOUT_NAME` (:47). */
export const FACTORY_LAYOUT_NAME = ''
/** `ToolWindowDefaultLayoutManager.INITIAL_LAYOUT_NAME` (:46) — where the factory default goes when it is saved over. */
export const INITIAL_LAYOUT_NAME = '自定义'
/** `ide.max.tool.window.layout.name.length` (`registry.properties:2198`). */
export const MAX_LAYOUT_NAME_LENGTH = 50

export type ToolWindowSide = 'left' | 'right' | 'bottom'

/**
 * One snapshot of the tool window layout.
 *
 * 上游 `ToolWindowDefaultLayoutManager` 存的是每个窗口的 `WindowInfo`（`WindowInfoImpl` 的
 * `anchor`/`order`/`isShowStripeButton`/`contentUiType`/`isVisible`/`weight`…），不是三张投影表 ——
 * 所以「从侧栏移除的按钮」（`isShowStripeButton = false`）与「每个内容的标签形态」
 * （`contentUiType`）也属于布局快照：恢复一套命名布局时它们要跟着回来。
 */
export interface ToolLayout {
  explorer: boolean
  bottom: boolean
  view: string
  tab: string
  anchors: Record<string, ToolWindowSide>
  order: Record<string, string[]>
  sizes: Record<string, number>
  /** 被「从侧栏移除」（`RemoveStripeButtonAction`）摘掉按钮的窗口 id。 */
  hidden: string[]
  /** 显式设过标签形态的内容（`WindowInfo.contentUiType`）；没设过的不进快照，保持各自现状。 */
  uiTypes: Record<string, ToolWindowContentUiType>
}

/** The persisted store: the active name plus every named layout. */
export interface ToolLayoutStore {
  active: string
  layouts: Record<string, ToolLayout>
}

export function emptyLayoutStore(): ToolLayoutStore {
  return { active: FACTORY_LAYOUT_NAME, layouts: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Tolerant parse of one stored layout; anything unusable falls back to `fallback` field by field. */
export function normalizeToolLayout(raw: unknown, fallback: ToolLayout): ToolLayout {
  if (!isRecord(raw)) return fallback
  const anchors: Record<string, ToolWindowSide> = { ...fallback.anchors }
  if (isRecord(raw.anchors))
    for (const [id, side] of Object.entries(raw.anchors))
      if (side === 'left' || side === 'right' || side === 'bottom') anchors[id] = side
  const order: Record<string, string[]> = { ...fallback.order }
  if (isRecord(raw.order))
    for (const [side, list] of Object.entries(raw.order))
      if (Array.isArray(list)) order[side] = list.filter((id): id is string => typeof id === 'string')
  const sizes: Record<string, number> = { ...fallback.sizes }
  if (isRecord(raw.sizes))
    for (const [key, value] of Object.entries(raw.sizes))
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) sizes[key] = value
  // 兜底对象可能是旧快照（没有这两个字段）—— 逐字段解析的老规矩：读不出来就用空值。
  const hidden: string[] = Array.isArray(fallback.hidden) ? [...fallback.hidden] : []
  if (Array.isArray(raw.hidden))
    hidden.splice(0, hidden.length, ...raw.hidden.filter((id): id is string => typeof id === 'string'))
  const uiTypes: Record<string, ToolWindowContentUiType> = { ...(fallback.uiTypes ?? {}) }
  if (isRecord(raw.uiTypes))
    for (const [id, value] of Object.entries(raw.uiTypes)) uiTypes[id] = resolveContentUiType(value)
  return {
    explorer: typeof raw.explorer === 'boolean' ? raw.explorer : fallback.explorer,
    bottom: typeof raw.bottom === 'boolean' ? raw.bottom : fallback.bottom,
    view: typeof raw.view === 'string' ? raw.view : fallback.view,
    tab: typeof raw.tab === 'string' ? raw.tab : fallback.tab,
    anchors,
    order,
    sizes,
    hidden,
    uiTypes,
  }
}

/**
 * Tolerant parse of the whole store. A blank or missing active name means the factory default is
 * active, and a layout stored under that name is dropped the way `loadState` drops it (:117).
 */
export function normalizeLayoutStore(raw: unknown): ToolLayoutStore {
  if (!isRecord(raw)) return emptyLayoutStore()
  const stored: Record<string, unknown> = isRecord(raw.layouts) ? raw.layouts : {}
  const layouts: Record<string, ToolLayout> = {}
  for (const [name, value] of Object.entries(stored)) {
    if (!name.trim()) continue
    layouts[name] = value as ToolLayout
  }
  const active = typeof raw.active === 'string' && raw.active.trim() ? raw.active : FACTORY_LAYOUT_NAME
  return { active: active in layouts ? active : FACTORY_LAYOUT_NAME, layouts }
}

/** The names the layout list shows, in the order they were created (Kotlin map key order, :60). */
export function layoutNames(store: ToolLayoutStore): string[] {
  return Object.keys(store.layouts)
}

export function isFactoryLayoutActive(store: ToolLayoutStore): boolean {
  return store.active === FACTORY_LAYOUT_NAME
}

/** `getLayoutCopy()` (:62): the active layout, or the factory default when it is the active one. */
export function resolveLayout(store: ToolLayoutStore, factory: ToolLayout): ToolLayout {
  if (isFactoryLayoutActive(store)) return factory
  return store.layouts[store.active] ?? factory
}

/** `activeLayoutName = value` (:54-58) followed by applying the new layout. */
export function setActiveLayout(store: ToolLayoutStore, name: string): ToolLayoutStore {
  if (name && !(name in store.layouts)) return store
  return { active: name, layouts: store.layouts }
}

/**
 * `setLayout(name, layout)` (:70-82): saving over the factory default makes the layout
 * non-default by moving it to `INITIAL_LAYOUT_NAME`, and the name becomes the active one.
 */
export function saveLayout(store: ToolLayoutStore, name: string, layout: ToolLayout): ToolLayoutStore {
  const target = name.trim() ? name : INITIAL_LAYOUT_NAME
  return { active: target, layouts: { ...store.layouts, [target]: layout } }
}

/** `renameLayout` (:84-87). Renaming to an existing name is refused by the dialog, not here. */
export function renameLayout(store: ToolLayoutStore, from: string, to: string): ToolLayoutStore {
  const name = to.trim()
  if (!name || !(from in store.layouts) || name === from) return store
  const layouts: Record<string, ToolLayout> = {}
  for (const [key, value] of Object.entries(store.layouts)) layouts[key === from ? name : key] = value
  return { active: store.active === from ? name : store.active, layouts }
}

/** `deleteLayout` (:89-91). Deleting the active layout would leave it dangling, so it is refused. */
export function deleteLayout(store: ToolLayoutStore, name: string): ToolLayoutStore {
  if (store.active === name || !(name in store.layouts)) return store
  const layouts = { ...store.layouts }
  delete layouts[name]
  return { active: store.active, layouts }
}

/**
 * `LayoutNameValidator.checkInput` (`LayoutNameInputDialog.kt:84-118`): the message the dialog
 * shows next to the field, or `null` when the name may be used.
 */
export function layoutNameError(name: string, existing: readonly string[], maxLength = MAX_LAYOUT_NAME_LENGTH): string | null {
  if (!name.trim()) return null
  if (name.length > maxLength) return `名称最多 ${maxLength} 个字符。`
  if (existing.includes(name)) return '同名布局已存在。'
  return null
}
