// 通知组（`pv/notification` 族缺的那一条）—— 上游 `com.intellij.notification.NotificationGroup`
// （`platform/ide-core/src/com/intellij/notification/NotificationGroup.kt:24-30`）、
// `NotificationGroupManager` 与 XML 侧的 `NotificationGroupEP`
// （`platform/ide-core/src/com/intellij/notification/impl/NotificationGroupEP.java`）的等价物。
//
// 上游现在**不再让调用方 new 一个 NotificationGroup**：一组通知在 XML 里注册一次，
// 业务代码只报一个 group id（`NotificationGroup.kt:18-23` 的类注释：
// "notification groups have to be registered in XML, so a group ID is enough"）。
// 本仓没有插件 XML 扩展点，于是这张表就是那批注册项：每一条都注明上游注册它的位置、
// displayType 与它对本仓的通知链意味着什么。
//
// **displayType 在本仓兑现的那一面**：上游用它决定「弹不弹气球」（BALLOON 10 秒后淡出、
// STICKY_BALLOON 300 秒 —— `NotificationsManagerImpl.kt:449`；NONE / TOOL_WINDOW 根本不弹，
// 只进通知中心 —— `NotificationsAnnouncer.kt:85-87` 直接对 NONE 提前返回，不做屏幕阅读器播报）。
// 本仓的气球是 `App.vue` 里那一个 `notice` 字符串，所以这四种类型落到一个**可判定的差别**上：
// 该组要不要占用这个气球（见 src/notifications.ts 的 notify()）。
import type { NoticeEntry } from './notices.ts'
// 通知组的扩展点宿主（上游 `NotificationGroupEP`，`platform/ide-core-impl/resources/intellij.platform.ide.core.impl.xml:27`）：
// 本仓这张内建表作为 bundled 贡献登记进同名 EP，第三方（原版 IDEA 插件）按同一 displayId 挂的
// 通知组与内建组走**同一条查询路径**（见文件末尾的 `notificationGroup()`）。
import { notificationGroupContribution, registerNotificationGroup } from './ideViewExtensionPoints.ts'

/** 上游 `com.intellij.notification.NotificationDisplayType` 的四档（本仓另认 TOOL_WINDOW 一档）。 */
export type NotificationDisplayType = 'BALLOON' | 'STICKY_BALLOON' | 'TOOL_WINDOW' | 'NONE'

/** 一条注册项：id + 显示方式 + 默认是否进通知日志 + 标题。 */
export interface NotificationGroupView {
  /** 注册 id，必须与上游 XML 里的 `notificationGroup id=` 逐字相同。 */
  id: string
  displayType: NotificationDisplayType
  /** 上游 `isLogByDefault`：false = 这条通知默认不写进通知中心（可在设置里打开）。 */
  isLogByDefault: boolean
  /** 组标题（中文包取值，见每条的出处）。`getGroupTitle(groupId)` 的返回值就是它。 */
  title: string
  /** `NotificationsPanel` 把它写进哪个工具窗口（TOOL_WINDOW 组才有）。 */
  toolWindowId?: string
}

/**
 * 本仓的通知生产方注册的全部通知组 —— 逐条对上上游注册它的那一行。
 * 没有在这里出现的 displayId（自动导入的「同步更改」、大文件提示、粘贴历史等）
 * 一律**不登记**：找不到上游对应的注册项就不编一个组，写成"未分组"照旧弹气球。
 */
export const NOTIFICATION_GROUPS: readonly NotificationGroupView[] = [
  {
    id: 'LSP window/showMessage',
    displayType: 'BALLOON',
    isLogByDefault: true,
    title: 'LSP 消息',
    // 平台/lsp-impl/resources/intellij.platform.lsp.impl.xml:48-51（displayType="BALLOON"）
    // + LspBundle.properties `notification.group.lsp.message`；组 id 见
    // LspServerNotificationsHandlerImpl.kt:461-464 的注释「必须与 intellij.platform.lsp.xml
    // 里的 notificationGroup id 相同」。本仓由 progressNotices.ts 的
    // `lsp:message:<语言>` 报出（`lspLogSummary` 那条消息同样落这里）。
  },
  {
    id: 'LSP window/logMessage: errors, warnings',
    displayType: 'NONE',
    isLogByDefault: true,
    title: 'LSP 日志: 错误、警告',
    // intellij.platform.lsp.impl.xml:52-55（displayType="NONE"，未给 isLogByDefault = 默认 true）
    // + LspBundle.properties `notification.group.lsp.log.errors.warnings`。
    // 组 id 见 LspServerNotificationsHandlerImpl.kt:466-470（「不弹气球，只写通知工具窗口」）。
    // 本仓由 progressNotices.ts 的 `lsp:log:<语言>` 报出。
  },
  {
    id: 'LSP window/logMessage: info, log; $/logTrace',
    displayType: 'NONE',
    isLogByDefault: false,
    title: 'LSP 日志: 信息、跟踪',
    // intellij.platform.lsp.impl.xml:56-59（displayType="NONE" isLogByDefault="false"）
    // + LspBundle.properties `notification.group.lsp.log.info.trace`。
    // 本仓没有对应的报出点（语言服务的信息级日志不进通知中心），登记它是为了让
    // `notificationGroup()` 对上游已注册的 id 都有答案，而不是只登记用得上的那几个。
  },
  {
    id: 'Gradle Notification Group',
    displayType: 'STICKY_BALLOON',
    isLogByDefault: true,
    title: 'Gradle',
    // plugins/gradle/plugin-resources/intellij.gradle.xml:309
    // （displayType="STICKY_BALLOON"）+ GradleBundle.properties `notification.group.gradle`。
    // 本仓由 progressNotices.ts 的 GRADLE_NOTICE_ID = 'gradle:sync' 报出。
  },
  {
    id: 'Vcs Notifications',
    displayType: 'BALLOON',
    isLogByDefault: true,
    title: 'VCS 通知',
    // platform/vcs-impl/resources/META-INF/VcsExtensions.xml:322（displayType="BALLOON"）
    // + VcsBundle.properties `notification.group.vcs.notifications`。
    // 本仓由提交面板的结果通知报出（src/commitNotification.ts 的 COMMIT_NOTIFICATION_ID
    // = 'vcs.commit'，即 ShowNotificationCommitResultHandler 那条「同 displayId 顶替」的链）。
  },
  {
    id: 'Vcs Messages',
    displayType: 'TOOL_WINDOW',
    isLogByDefault: true,
    toolWindowId: 'Version Control',
    title: 'VCS 消息',
    // VcsExtensions.xml:320（displayType="TOOL_WINDOW" toolWindowId="Version Control"）
    // + VcsBundle.properties `notification.group.vcs.messages`。
    // 本仓暂无报出点（提交/同步的过程消息都归上面那条），登记它是为了 TOOL_WINDOW
    // 这一档有真实对照可查，而不是凭空写一档类型。
  },
  {
    id: 'Vcs Important Notifications',
    displayType: 'STICKY_BALLOON',
    isLogByDefault: true,
    title: 'VCS 重要消息',
    // VcsExtensions.xml:321（displayType="STICKY_BALLOON"）
    // + VcsBundle.properties `notification.group.vcs.important.messages`。
  },
  {
    id: 'Vcs Silent Notifications',
    displayType: 'NONE',
    isLogByDefault: true,
    title: 'VCS 静默通知',
    // VcsExtensions.xml:323（displayType="NONE"）+ VcsBundle.properties
    // `notification.group.vcs.silent.notifications`。
  },
  {
    id: 'Power Save Mode',
    displayType: 'BALLOON',
    isLogByDefault: true,
    title: '已启用省电模式',
    // platform/platform-impl/resources/intellij.platform.ide.impl.xml:1802
    // `<notificationGroup id="Power Save Mode" displayType="BALLOON" bundle="messages.IdeBundle"
    //  key="notification.group.power.save.mode"/>`；标题取中文包
    // `localization-zh.jar` 的 `messages/IdeBundle.properties:1661`。
    // 本仓由 src/notificationPowerSave.ts 的 POWER_SAVE_DISPLAY_ID = 'power.save.mode' 报出
    //（BALLOON ⇒ 它既弹气球也进通知中心，判据 tests/notification-power-save.test.mjs）。
  },
]

const BY_ID = new Map(NOTIFICATION_GROUPS.map(group => [group.id, group]))

// 把这张内建表登记进 `com.intellij.notificationGroup` EP（bundled 贡献，重复装配只覆盖同 id）。
// 于是「注册在 XML 里的内建组」与「第三方按 id 挂的组」在 EP 里是同一批条目，消费侧只有一条路径。
for (const group of NOTIFICATION_GROUPS) {
  registerNotificationGroup({
    id: group.id,
    getDisplayId: () => group.id,
    getDisplayType: () => group.displayType,
    isLogByDefault: () => group.isLogByDefault,
    getToolWindowId: () => group.toolWindowId,
    getTitle: () => group.title,
  })
}

/** 查注册项；未知 id 返回 undefined（**不是**先造一个组 —— 上游未注册就拿不到设置）。 */
export function notificationGroup(id: string): NotificationGroupView | undefined {
  const known = BY_ID.get(id)
  if (known) return known
  // 内建表里没有的：查 EP 里第三方挂的组（同一份 `ExtensionPointHost`，与内建走同一条查询路径）。
  const contributed = notificationGroupContribution(id)
  if (!contributed) return undefined
  return {
    id: contributed.getDisplayId(),
    displayType: contributed.getDisplayType(),
    isLogByDefault: contributed.isLogByDefault(),
    title: contributed.getTitle(),
    ...(contributed.getToolWindowId?.() ? { toolWindowId: contributed.getToolWindowId() } : {}),
  }
}

/**
 * `NotificationGroup.getGroupTitle(groupId)` 的等价物（`Notification.java:210-215` 用它给
 * 「不再显示」那条记一个能看懂的显示名；取不到时上游退回 groupId 自己）。
 */
export function notificationGroupTitle(id: string): string {
  return BY_ID.get(id)?.title ?? id
}

/** `NotificationsManagerImpl.kt:449` 的两个延时；NONE/TOOL_WINDOW 不弹，返回 undefined。 */
export function balloonFadeoutMs(displayType: NotificationDisplayType): number | undefined {
  if (displayType === 'NONE' || displayType === 'TOOL_WINDOW') return undefined
  return displayType === 'STICKY_BALLOON' ? 300000 : 10000
}

/** 这个组要不要占用一闪而过的那个气球。 */
export function showsBalloon(displayType: NotificationDisplayType): boolean {
  return displayType === 'BALLOON' || displayType === 'STICKY_BALLOON'
}

/**
 * displayId 前缀 → 组 id。只登记本仓**真的报得出**的那几个 displayId
 * （`progressNotices.ts` 的 `lsp:message:` / `lsp:log:` 与 `gradle:sync`、
 * `commitNotification.ts` 的 `vcs.commit`）。
 * 认不出来的 displayId 返回 undefined = 未分组 = 保持旧行为（弹气球 + 进日志）。
 */
const GROUP_BY_DISPLAY_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ['lsp:message:', 'LSP window/showMessage'],
  // info/trace 那一档必须排在 `lsp:log:` **前面**（表是首个命中，顺序就是优先级），否则会被抢进 errors/warnings 组。
  // 上游 `LspServerNotificationsHandlerImpl.kt:402-403`（Info/Log 级落 LOG_INFO_TRACE）与 `:476`（组 id 字面值）。
  ['lsp:log:info:', 'LSP window/logMessage: info, log; $/logTrace'],
  ['lsp:log:', 'LSP window/logMessage: errors, warnings'],
  ['gradle:', 'Gradle Notification Group'],
  ['vcs.commit', 'Vcs Notifications'],
  ['power.save.mode', 'Power Save Mode'],
]

/** 一条通知归属哪个组（undefined = 未分组）。 */
export function noticeGroupId(entry: Pick<NoticeEntry, 'displayId'>): string | undefined {
  const displayId = entry.displayId
  if (!displayId) return undefined
  return GROUP_BY_DISPLAY_PREFIX.find(([prefix]) => displayId === prefix || displayId.startsWith(prefix))?.[1]
}

/** 一条通知的组（未分组时 undefined）。 */
export function noticeGroup(entry: Pick<NoticeEntry, 'displayId'>): NotificationGroupView | undefined {
  const id = noticeGroupId(entry)
  return id ? BY_ID.get(id) : undefined
}

/**
 * `Notification.configureDoNotAskOption`（`Notification.java:204-217`）：
 *   · 有 displayId 且没显式设过 → id = displayId，显示名 = 通知标题；
 *   · 否则 → id = groupId，显示名 = `getGroupTitle(groupId)`，取不到就用 groupId 自己。
 * 本仓的通知没有单独的标题字段（一行就是 `message`），所以"显示名"取 `message`。
 */
export function configureDoNotAskOption(
  entry: Pick<NoticeEntry, 'displayId' | 'message'>, groupId?: string,
): { id: string; displayName: string } | undefined {
  if (entry.displayId) return { id: entry.displayId, displayName: entry.message }
  if (groupId) return { id: groupId, displayName: notificationGroupTitle(groupId) }
  return undefined
}
