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
  /**
   * 0-100 = 确定式（画一条带百分比的进度条）；`null` = **进行中但没有百分比**；
   * 缺省（undefined）= 这根本不是一条进度通知。
   * 三种状态要分开：IDEA 的进度行在 `total <= 0` 时是 indeterminate
   * （`ExternalSystemTaskProgressIndicatorUpdater.kt` 的 `if (total <= 0) indicator.setIndeterminate(true)`），
   * 跑完之后那条行就只剩文字，不再是个"永远在转"的东西。
   */
  percent?: number | null
  /**
   * 通知自带的那几个按钮。上游是 `Notification.addAction(AnAction)`：
   * 点了动作的人自己负责把通知收掉 —— `LspServerNotificationsHandlerImpl.kt:443-454` 就是
   * `getNotificationGroup(...).also { notification -> notification.addAction(AnAction(label) { ...; notification.expire() }) }`；
   * Gradle 那边同一形状（`GradleBundle.properties:343-345` 的 Migrate / Ignore / Learn more）。
   */
  actions?: NoticeAction[]
}

/** 一条通知上的一个动作（`AnAction` 的最小可用投影：文字 + 点了做什么）。 */
export interface NoticeAction { label: string; run: () => void }

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

/**
 * 进度通知的"就地更新"：同一个 `displayId` 已经存在就**原位替换内容**（保留位置与 id，
 * 于是列表不会每来一拍就重排），否则按 `pushNotice` 的规矩新插一条。
 *
 * 这里刻意和 `pushNotice` 的 `expirePreviousAndNotify`（先删旧的再前插）不同：那条规则是给
 * "同一件事的第二次通知"用的（提交结果那类），而一条**正在推进**的进度每 100ms 换一次文字时
 * 不该在列表里跳来跳去 —— 上游对应的是同一个 `Notification` 对象被反复刷新，不是重发。
 */
export function upsertNotice(entries: readonly NoticeEntry[], entry: NoticeEntry, limit = NOTICE_LOG_LIMIT): NoticeEntry[] {
  if (!entry.displayId) return pushNotice(entries, entry, limit)
  const index = entries.findIndex(existing => existing.displayId === entry.displayId)
  if (index < 0) return pushNotice(entries, entry, limit)
  const next = [...entries]
  // `at` 保留第一次那条的时间：进度行的时间戳应该是"这件事什么时候开始"。
  next[index] = { ...entry, id: entries[index]!.id, at: entries[index]!.at }
  return next
}

/** 一行进度通知右侧的文字；没有百分比就是"进行中"。 */
export function noticeProgressLabel(entry: NoticeEntry): string {
  if (entry.percent === undefined) return ''
  return entry.percent === null ? '进行中' : `${entry.percent}%`
}
