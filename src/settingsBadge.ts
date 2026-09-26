// IDEA's "new options" dot in the settings tree, ported from
// platform/platform-impl/src/com/intellij/openapi/options/newEditor/:
//
//   SettingsNewBadgeRecorder.kt:10-19  the persisted counter, its key and its maximum
//   SettingsNewBadgeState.kt:19-56     hasNewOptions / markOpened, including the propagation
//                                      down a composite configurable's children
//   SettingsTreeView.java:536-540      selecting a page records it as opened and repaints
//   SettingsTreeView.java:674-680      the per-node cache of that answer
//   SettingsTreeView.java:791-794      the dot is drawn on a leaf, or on a collapsed group
//
// A page marked as carrying new options shows a dot until it has been opened once; the count is
// persisted per page under IDEA's own key `settings.new.badge.shown.count.<id>` with `MAX_SHOWS`
// as the "already seen" value.

/** `SettingsNewBadgeRecorder.kt:10` — the key IDEA writes into `PropertiesComponent`. */
export const NEW_BADGE_KEY_PREFIX = 'settings.new.badge.shown.count.'
/** `SettingsNewBadgeRecorder.kt:11` — a page is "seen" after a single visit. */
export const MAX_SHOWS = 1
/** `IdeBundle.properties:3355` `badge.text.new=New` (TaoCode's UI is Chinese). */
export const NEW_BADGE_TEXT = '新'
/**
 * The pages whose IDEA counterpart implements `Configurable.NewOptions`. In this IDEA checkout the
 * only implementor is `EditorAppearanceConfigurable.kt:69-72` (Settings › Editor › General ›
 * Appearance), whose option set — line numbers, indent guides, whitespaces, caret/appearance —
 * lives in TaoCode's 编辑器 page.
 */
export const NEW_OPTION_PAGES: readonly string[] = ['editor']

export type BadgeCounts = Readonly<Record<string, number>>

/** `SettingsNewBadgeState.kt:53-56`: only a configurable that declares itself new qualifies. */
export function isNewOptions(page: string, newPages: readonly string[] = NEW_OPTION_PAGES): boolean {
  return newPages.includes(page)
}

/** `SettingsNewBadgeState.kt:47-51`: the dot stays while the page has been shown fewer than MAX times. */
export function showNewOptions(page: string, counts: BadgeCounts, newPages: readonly string[] = NEW_OPTION_PAGES): boolean {
  if (!isNewOptions(page, newPages)) return false
  return (counts[page] ?? 0) < MAX_SHOWS
}

/**
 * `SettingsNewBadgeState.kt:32-36`: a parent reports new options when any of its children does, so a
 * collapsed group can announce that something inside it is new.
 */
export function showNewOptionsInGroup(children: readonly string[], counts: BadgeCounts, newPages: readonly string[] = NEW_OPTION_PAGES): boolean {
  return children.some(child => showNewOptions(child, counts, newPages))
}

/** `SettingsTreeView.java:791`: the dot is drawn on a leaf, or on a node that is not expanded. */
export function showNewBadgeDot(hasNewOptions: boolean, leaf: boolean, expanded: boolean): boolean {
  return hasNewOptions && (leaf || !expanded)
}

/**
 * `SettingsNewBadgeState.markOpened` (:39-45) — returns the new counts and whether anything
 * changed, so the caller only writes to storage when the page really was new.
 */
export function markOpened(page: string, counts: BadgeCounts, newPages: readonly string[] = NEW_OPTION_PAGES): { counts: BadgeCounts; changed: boolean } {
  if (!isNewOptions(page, newPages)) return { counts, changed: false }
  if ((counts[page] ?? 0) >= MAX_SHOWS) return { counts, changed: false }
  return { counts: { ...counts, [page]: MAX_SHOWS }, changed: true }
}

/** IDEA persists each id under its own key (`SettingsNewBadgeRecorder.kt:13-15`). */
export function badgeStorageKey(page: string, prefix = 'taocode.'): string {
  return `${prefix}${NEW_BADGE_KEY_PREFIX}${page}`
}

/** `PropertiesComponent.getInt(key, 0)` — anything unreadable falls back to "never shown". */
export function parseBadgeCount(value: string | null): number {
  if (value === null) return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
