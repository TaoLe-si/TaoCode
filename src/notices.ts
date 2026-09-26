// The notification centre shared by the status bar and the welcome screen.
//
// IDEA keeps one notification list per application and renders it in two places: the status bar
// widget (`IdeStatusBarImpl.kt`, `NotificationsWidgetFactory`) and the welcome screen's
// notification toolbar — `WelcomeScreenComponentFactory.createNotificationToolbar` (:399-451)
// builds it from `IdeMessagePanel.getAction()` plus `NotificationEventAction`
// (`welcomeScreen/NotificationEventAction.kt:24-81`), which is placed by
// `ProjectsTabFactory.kt:126-131` in the last row of the projects tab, right-aligned.
//
// `NotificationEventAction` contributes the rules ported here: the button is enabled and visible
// only while notifications exist (`update`: `isEnabledAndVisible = notificationTypes.isNotEmpty()`),
// its text is `toolwindow.stripe.Notifications` (IdeBundle.properties:2238 = "Notifications"), and
// the icon reflects whether there is anything to see
// (`getNotificationIcon` :371-384 — in the New UI `NOTIFICATION_ICON.getInfoIcon(!types.isEmpty())`).

export const NOTICE_LOG_LIMIT = 200
export const NOTICE_PREVIEW_LIMIT = 20
/** IdeBundle.properties:2238 `toolwindow.stripe.Notifications`. */
export const NOTICES_LABEL = '通知'

export interface NoticeEntry {
  id: number
  message: string
  error: boolean
  at: string
  detail?: string[]
  displayId?: string
}

export type NoticeLevel = 'error' | 'info' | 'none'

/** The highest severity in the list — what the status-bar chip colours itself by. */
export function noticeLevel(entries: readonly NoticeEntry[]): NoticeLevel {
  if (!entries.length) return 'none'
  return entries.some(entry => entry.error) ? 'error' : 'info'
}

/** `NotificationEventAction.update`: nothing to show means no button at all. */
export function noticeButtonVisible(count: number): boolean {
  return count > 0
}

/** `NotificationEventAction.update` — `IdeBundle toolwindow.stripe.Notifications`. */
export function noticeButtonText(count: number, label = NOTICES_LABEL): string {
  return count > 0 ? `${label} ${count}` : label
}

/** The tooltip spells out what the icon alone cannot: the count and whether errors are inside. */
export function noticeTitle(entries: readonly NoticeEntry[]): string {
  const level = noticeLevel(entries)
  if (level === 'none') return '通知中心：暂无通知'
  const suffix = level === 'error' ? '其中含错误' : '无错误'
  return `通知中心：最近 ${entries.length} 条，${suffix}`
}

/** The rows the popup shows (`noticeLog.slice(0, NOTICE_PREVIEW_LIMIT)`). */
export function noticePreview(entries: readonly NoticeEntry[], limit = NOTICE_PREVIEW_LIMIT): NoticeEntry[] {
  return entries.slice(0, Math.max(0, limit))
}

/**
 * Drop the previous notice carrying the same `displayId` and prepend the new one — IDEA's
 * `expirePreviousAndNotify` (`ShowNotificationCommitResultHandler.kt:97`).
 */
export function pushNotice(entries: readonly NoticeEntry[], entry: NoticeEntry, limit = NOTICE_LOG_LIMIT): NoticeEntry[] {
  const kept = entry.displayId ? entries.filter(existing => existing.displayId !== entry.displayId) : entries
  return [entry, ...kept].slice(0, limit)
}
