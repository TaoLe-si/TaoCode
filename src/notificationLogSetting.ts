// 通知组的「要不要写进通知中心」这一档（`pv/notification` 判词里 `NotificationSettings.isShouldLog`
// 那条缺）。
//
// 上游形状（逐条开过）：
//   · `platform/platform-impl/src/com/intellij/notification/impl/NotificationSettings.kt:26`
//     —— `var isShouldLog: Boolean` 是逐组的设置；序列化时**只在 false 时**落
//     `shouldLog="false"` 属性（`:40`），读回时缺属性默认 true（`:55`
//     `"false" != getAttributeValue("shouldLog")`）。默认值本身来自注册项的 `isLogByDefault`。
//   · `platform/platform-impl/src/com/intellij/notification/impl/NotificationsManagerImpl.java:205`
//     —— `if (!settings.isShouldLog() && (displayType == NONE || popupSuppressed || !SHOW_BALLOONS))
//     notification.expire();` 这一档的语义是：**不写日志**（上游 `expire()` 把这条从通知中心拿掉）。
//     本仓的等价动作是「不进 `noticeLog`」（气球那一路由 displayType 单独管，见
//     `src/notificationGroups.ts` 的 `showsBalloon`）。
//   · 用户面：`.../impl/ui/NotificationSettingsUi.kt` 的「Log」一列，编辑的就是这个布尔。
//
// 本仓的默认档 = 注册项的 `isLogByDefault`（`src/notificationGroups.ts:28` 那个字段，
// 逐条抄自上游 XML）。用户在通知中心的行菜单里可以逐组改（与 `src/notificationBeeper.ts`
// 的「播放声音」同一形状、同一存储口径：只在**偏离默认**时落一条覆盖）。
//
// 与上游的差异（如实写）：上游的 `expire()` 会把已经进过日志的那条也撤掉；本仓这条门控
// 在**推送前**生效（`src/notifications.ts` 的 `notify()` 里 `pushNotice` 之前），所以
// 已经进了日志的历史条目不会因为事后关掉这一组而消失 —— 关掉后**新来的**才不进。
import { notificationGroup, type NotificationGroupView } from './notificationGroups.ts'

/** localStorage 的最小面（node --test 与隐私模式下传 null / 假对象即可）。 */
type Store = Pick<Storage, 'getItem' | 'setItem'> | null

const SHOULD_LOG_KEY = 'taocode.notificationShouldLog'

/** 覆盖表上限（注册项就那么几个，留一档余量）。 */
export const MAX_LOG_OVERRIDES = 64

function storage(store?: Store): Store {
  if (store !== undefined) return store
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** 读出来的覆盖表：组 id → 用户显式设的 shouldLog 布尔。 */
function readOverrides(target: Store): Record<string, boolean> {
  try {
    const raw = target?.getItem(SHOULD_LOG_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'boolean') continue
      if (Object.keys(out).length >= MAX_LOG_OVERRIDES) break
      out[id] = value
    }
    return out
  } catch { return {} }
}

function writeOverrides(target: Store, overrides: Record<string, boolean>): void {
  const kept = Object.keys(overrides).slice(-MAX_LOG_OVERRIDES)
  const out: Record<string, boolean> = {}
  for (const id of kept) out[id] = overrides[id] === true
  try { target?.setItem(SHOULD_LOG_KEY, JSON.stringify(out)) } catch { /* 存不下就只剩本次会话 */ }
}

/** 这一组**默认**要不要写进通知中心（注册项的 `isLogByDefault`，未注册返回 true = 未分组照旧进日志）。 */
export function groupLogsByDefault(groupId: string): boolean {
  return notificationGroup(groupId)?.isLogByDefault ?? true
}

/**
 * 这一组**现在**要不要写进通知中心：用户覆盖优先，否则取默认。
 * 未注册的组（拿不到设置，上游 `getSettings` 同一形状）返回 true —— 本仓未分组通知保持旧行为。
 */
export function groupShouldLog(groupId: string, store?: Store): boolean {
  if (!groupId) return true
  const override = readOverrides(storage(store))[groupId]
  return override === undefined ? groupLogsByDefault(groupId) : override
}

/** 设置页/行菜单里那一格点了之后写什么（与注册项默认相同就把覆盖删掉，回到默认）。 */
export function setGroupShouldLog(groupId: string, shouldLog: boolean, store?: Store): void {
  if (!groupId || !notificationGroup(groupId)) return
  const target = storage(store)
  const overrides = readOverrides(target)
  if (shouldLog === groupLogsByDefault(groupId)) delete overrides[groupId]
  else overrides[groupId] = shouldLog
  writeOverrides(target, overrides)
}

/** 用户显式改过的组（设置页列出「哪些偏离了默认」时用）。 */
export function overriddenLogGroups(store?: Store): string[] {
  return Object.keys(readOverrides(storage(store)))
}

/**
 * 这一条通知该不该进通知中心（`NotificationsManagerImpl.java:205` 那条门控的本仓等价物）。
 * `groupId` 为空（未分组）一律 true —— 未分组没有设置，照旧写日志。
 */
export function shouldLogNotice(groupId: string | undefined, store?: Store): boolean {
  return !groupId || groupShouldLog(groupId, store)
}

/** 行菜单里那一格的文字（开/关两档，与 `notificationBeeper.ts` 的 `GROUP_SOUND_*_LABEL` 同形状）。 */
export const GROUP_LOG_ON_LABEL = '写入通知中心（本组）'
export const GROUP_LOG_OFF_LABEL = '不写入通知中心（本组）'

/** 未注册的组不给这一格（同上游 `isRegistered` 那道门）。 */
export function groupLogToggleLabel(groupId: string | undefined, store?: Store): string | undefined {
  if (!groupId || !notificationGroup(groupId)) return undefined
  return groupShouldLog(groupId, store) ? GROUP_LOG_OFF_LABEL : GROUP_LOG_ON_LABEL
}

/** 调试/判据用的组快照（不参与生产路径）。 */
export function logGroupView(groupId: string): NotificationGroupView | undefined {
  return notificationGroup(groupId)
}