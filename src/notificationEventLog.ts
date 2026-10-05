// 通知中心（Event Log）的分段与每行那个 ⋮ 菜单 —— 纯逻辑部分。
//
// 上游面板是 `NotificationsPanel`（`platform/platform-impl/src/com/intellij/notification/impl/ui/
// NotificationsPanel.kt`）：上下两段 `NotificationGroupComponent`
// （`:538-613`），标题分别是 `notifications.toolwindow.suggestions`（建议）与
// `notifications.toolwindow.timeline`（时间线）；时间线那一段右侧挂一个「全部清除」
// （`:595-599`）。每段是 `NullableComponent` + `isEmpty()`（`:648-656`）—— **空段不画**。
// 段内每条通知一个 `NotificationComponent`，右边一个 ⋮ 按钮（`:1106-1153`）。
//
// 本仓的通知日志在 `src/notices.ts`（状态栏弹层、欢迎页通知工具条、通知工具窗口共用同一份），
// 这一层只回答两件事：**这条进哪一段**、**那个 ⋮ 里有哪些条目**。

import { canRemindLater } from './notificationDoNotAsk.ts'
import { noticeGroupId } from './notificationGroups.ts'
import type { NoticeEntry } from './notices.ts'

/** 上游两段的标题（中文包 `messages/IdeBundle.properties`）。 */
export const EVENT_LOG_SUGGESTIONS_TITLE = '建议'
export const EVENT_LOG_TIMELINE_TITLE = '时间线'
/** `notifications.toolwindow.timeline.clear.all`。 */
export const EVENT_LOG_CLEAR_ALL_LABEL = '全部清除'
/** ⋮ 按钮的提示：`tooltip.turn.notification.off`。 */
export const EVENT_LOG_MORE_TITLE = '关闭或更改行为'
/** `notifications.toolwindow.remind.tomorrow` / `notifications.toolwindow.dont.show.again.for.this.project` /
 *  `notifications.toolwindow.dont.show.again`（`NotificationBalloonActionProvider.java:201-213`
 *  与 `NotificationsPanel.kt:1122/1133/1139` 两条弹层用的是同一组 key）。 */
export const EVENT_LOG_REMIND_LABEL = '明天提醒我'
export const EVENT_LOG_DO_NOT_ASK_PROJECT_LABEL = '不再为此项目显示'
export const EVENT_LOG_DO_NOT_ASK_LABEL = '不再显示'

export type EventLogSectionId = 'suggestions' | 'timeline'

/** 一条通知在 Event Log 里的宿主数据（在 `NoticeEntry` 之上补两个上游字段）。 */
export interface EventLogEntry extends NoticeEntry {
  /**
   * `Notification.isSuggestionType`：进「建议」段而不是「时间线」段
   * （`NotificationsPanel.kt:1118` 与 `NotificationGroupComponent(mySuggestionType)`）。
   * 本仓的通知生产方目前没有 suggestion 类型（上游那几个都来自本仓没有的插件更新检查），
   * 缺省 false ⇒ 全部落时间线；真出现建议类通知时由生产方带上这个字段即可。
   */
  suggestion?: boolean
}

/** 那一行 ⋮ 菜单里的一个条目（纯描述，宿主给 `run`）。 */
export interface EventLogMenuItem { id: string; label: string; run: () => void }

export interface EventLogSection { id: EventLogSectionId; title: string; entries: EventLogEntry[] }

/**
 * 搜索：`NotificationComponent.matchQuery:1347-1364` —— 大小写无关的子串，
 * 依次看标题、副标题、正文、动作文字。本仓没有标题/副标题字段，于是看
 * `message`、每条 `detail` 与动作文字。
 */
export function matchesNoticeQuery(entry: Pick<EventLogEntry, 'message' | 'detail' | 'actions'>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (entry.message.toLowerCase().includes(needle)) return true
  if (entry.detail?.some(line => line.toLowerCase().includes(needle))) return true
  return Boolean(entry.actions?.some(action => action.label.toLowerCase().includes(needle)))
}

/**
 * 分成两段；空段不画（上游 `isEmpty()` + `NullableComponent`）。
 * 顺序保持 `pushNotice` 的前插（新的一条在最前）。
 */
export function eventLogSections(entries: readonly EventLogEntry[], query = ''): EventLogSection[] {
  const kept = entries.filter(entry => matchesNoticeQuery(entry, query))
  const sections: EventLogSection[] = [
    { id: 'suggestions', title: EVENT_LOG_SUGGESTIONS_TITLE, entries: kept.filter(entry => entry.suggestion) },
    { id: 'timeline', title: EVENT_LOG_TIMELINE_TITLE, entries: kept.filter(entry => !entry.suggestion) },
  ]
  return sections.filter(section => section.entries.length > 0)
}

/**
 * 「不再显示」记的是哪个 id（`Notification.configureDoNotAskOption`：
 * 有 displayId 用它，没有才用组 id，见 src/notificationGroups.ts 的同名函数）。
 */
export function doNotAskIdOf(entry: Pick<EventLogEntry, 'displayId' | 'message'>): string | undefined {
  const id = entry.displayId
  if (id) return id
  return noticeGroupId(entry)
}

/**
 * 那一行 ⋮ 里的条目（`NotificationsPanel.kt:1106-1143` 的顺序与条件）。
 *
 * 上游第一个条目是「设置…」，条件是这个组在设置里注册过（`:1109`）—— 本仓**没有**
 * 通知设置页（`src/settingsTreeMeta.ts` 里没有这一节），画出来就是点不动的假控件，
 * 所以不渲染，登记在报告里。
 *
 * `hooks` 是宿主要提供的那几个副作用：提醒（`scheduleRemindLater`）、按项目/按应用抑制
 * （`markDoNotAsk`）。少给哪个键，对应条目就不出现 —— 与上游"没有 handler 就不给这个动作"
 * 的形状一致（`RemindLaterManager.kt:37-40`）。
 */
export interface EventLogMenuHooks {
  remindTomorrow?: (entry: EventLogEntry) => void
  doNotAskForProject?: (entry: EventLogEntry) => void
  doNotAskForApp?: (entry: EventLogEntry) => void
  /** 这个项目根（空 = 没有项目，于是「不再为此项目显示」没有落点）。 */
  projectRoot?: string
}

export function eventLogRowMenu(entry: EventLogEntry, hooks: EventLogMenuHooks = {}): EventLogMenuItem[] {
  const items: EventLogMenuItem[] = []
  if (hooks.remindTomorrow && canRemindLater(entry, entry.suggestion === true)) {
    items.push({ id: 'remind', label: EVENT_LOG_REMIND_LABEL, run: () => hooks.remindTomorrow?.(entry) })
  }
  if (hooks.doNotAskForProject && hooks.projectRoot) {
    items.push({ id: 'doNotAskProject', label: EVENT_LOG_DO_NOT_ASK_PROJECT_LABEL, run: () => hooks.doNotAskForProject?.(entry) })
  }
  if (hooks.doNotAskForApp) {
    items.push({ id: 'doNotAskApp', label: EVENT_LOG_DO_NOT_ASK_LABEL, run: () => hooks.doNotAskForApp?.(entry) })
  }
  return items
}
