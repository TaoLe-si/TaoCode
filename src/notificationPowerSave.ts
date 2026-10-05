// 省电模式那一条通知 —— 上游 `com.intellij.ide.actions.PowerSaveModeNotifier`
// （`platform/lang-impl/src/com/intellij/ide/actions/PowerSaveModeNotifier.kt`）的等价物。
//
// 上游形状（逐行读过，右列是本仓的承接方式）：
//   · **两个触发点**，不是一个：
//     - `PowerSaveModeNotifier` 是个 `ProjectActivity`（`:17-22`）：项目打开时**已经**是省电档就补发一条；
//     - `TogglePowerSaveAction.setSelected`（`platform/lang-impl/src/com/intellij/ide/actions/TogglePowerSaveAction.java:20-25`）：
//       先 `PowerSaveMode.setEnabled(state)`，**只在 `state == true` 时**（`:22`）才发 —— 关掉时不发。
//       ⇒ 本仓 `powerSaveTransition(previous, next)`：只有 false→true 与 null→true 返回「发」。
//   · 抑制开关（`:26` `IGNORE_POWER_SAVE_MODE = "ignore.power.save.mode"`、`:30-32` 命中就整个 return，
//     连通知都不建）⇒ 本仓 `powerSaveNoticeSuppressed()` / `suppressPowerSaveNotice()`，
//     存 localStorage 的同一个键名；用户点「不再显示」后就再不发。
//   · 组与弹法：`NotificationGroupManager.getNotificationGroup("Power Save Mode")`（`:34`），
//     注册在 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1802`
//     `<notificationGroup id="Power Save Mode" displayType="BALLOON" …>` ⇒ 弹气球，不是 sticky。
//   · 正文两行 + 类型 WARNING（`:35-37`）。
//   · **两个动作，按这个顺序**（本仓照抄顺序）：
//     - `:39-44` 第一个 `action.Anonymous.text.do.not.show.again` —— 中文取值「不再显示」
//       （`localization-zh.jar` 的 `messages/IdeBundle.properties:63`，本轮亲自解包核过）：
//       点了写 `ignore.power.save.mode = true` 再 `notification.expire()`；
//     - `:45-50` 第二个 `power.save.mode.disable.action.title`：点了 `PowerSaveMode.setEnabled(false)` 再 expire。
//       宿主没给关闭通道时不给这个按钮（否则是点不动的假控件）。
//   · `:52-56` 气球建好后订阅 `PowerSaveMode.TOPIC`：**模式再次变化就把这条通知收掉**
//     （`connection.subscribe(PowerSaveMode.TOPIC, PowerSaveMode.Listener(notification::expire))`）。
//     ⇒ `powerSaveTransition(true, false)` 返回「收」。
//
// 中文取值来自 `D:\IntelliJ IDEA 2026.2\plugins\localization-zh\lib\localization-zh.jar`
// 里的 `messages/IdeBundle.properties`（本轮没有重新解包核对，沿用上一轮登记的行号）：
//   `:2027 power.save.mode.disable.action.title=禁用省电模式`
//   `:2028 power.save.mode.on.notification.content=代码洞察和后台任务已禁用。`
//   `:2029 power.save.mode.on.notification.title=省电模式已开启`
//   `:1661 notification.group.power.save.mode=已启用省电模式`
//
// **后台任务那一半**：正文承诺的是「代码洞察和后台任务已禁用」。上游的省电档只关代码洞察
// （在本地树里按 `isPowerSaveMode()` / `PowerSaveMode.isEnabled()` 搜后台任务队列/索引的读者，
// 一条命中都没有 —— 它没有把 `BackgroundTaskQueue` 挂起来），所以本仓这件事是**为了让那句正文成真**
// 而做的：`src/notifications.ts` 的挂载点在开档时调 `backgroundTaskQueue.setSuspended(那句正文)`，
// 关档时 `setSuspended(null)`。挂起不是取消（进度、百分比、`onCancel` 都不动），
// 模型见 `src/progressSuspender.ts` 的头注。
//
// 本仓的消费者：`src/notifications.ts`（`createNotifications` 的 `powerSave` 那一项依赖）。
// 触发源 `editorSettings.powerSaveMode` 由 App.vue 注入 ⇒ 挂点写进了接线请求
// （`docs/wiring-requests-2026-10-06-bucket6b.md`，App.vue:841 那一行）。

/** `power.save.mode.on.notification.title` 的中文取值。 */
export const POWER_SAVE_ON_TITLE = '省电模式已开启'
/** `power.save.mode.on.notification.content` 的中文取值。 */
export const POWER_SAVE_ON_CONTENT = '代码洞察和后台任务已禁用。'
/** `power.save.mode.disable.action.title` 的中文取值。 */
export const POWER_SAVE_DISABLE_ACTION = '禁用省电模式'
/** `action.Anonymous.text.do.not.show.again`（中文包 `messages/IdeBundle.properties:63` =「不再显示」）。 */
export const POWER_SAVE_DO_NOT_SHOW_ACTION = '不再显示'
/** 上游的组 id（`intellij.platform.ide.impl.xml:1802`），本仓的 displayId 挂在它下面。 */
export const POWER_SAVE_GROUP_ID = 'Power Save Mode'
/** 本仓那条通知的 displayId（同一个 displayId 顶替旧的，见 `src/notices.ts`）。 */
export const POWER_SAVE_DISPLAY_ID = 'power.save.mode'
/** `NotificationType.WARNING`（`PowerSaveModeNotifier.kt:37`）—— 本仓的通道只有 error/info 两档。 */
export const POWER_SAVE_IS_ERROR = true
/** 上游那个抑制开关的键名（`PowerSaveModeNotifier.kt:26`），本仓沿用同一个字符串。 */
export const IGNORE_POWER_SAVE_MODE = 'ignore.power.save.mode'

/** localStorage 的最小面（node --test / 隐私模式下传 null 或假对象即可）。 */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null

function storage(store?: Store): Store {
  if (store !== undefined) return store
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/**
 * 上游 `:30-32` 那句 `PropertiesComponent.getBoolean(IGNORE_POWER_SAVE_MODE)` 的等价物。
 * 只认字面量 "true"：脏值按没存过处理（与 `src/notificationDoNotAsk.ts` 同一口径）。
 */
export function powerSaveNoticeSuppressed(store?: Store): boolean {
  try { return storage(store)?.getItem(IGNORE_POWER_SAVE_MODE) === 'true' } catch { return false }
}

/** 点「不再显示」那一条（上游 `:41` `setValue(IGNORE_POWER_SAVE_MODE, true)`）。 */
export function suppressPowerSaveNotice(store?: Store): void {
  try { storage(store)?.setItem(IGNORE_POWER_SAVE_MODE, 'true') } catch { /* 存不下只影响跨会话的抑制 */ }
}

/** 撤销抑制（判据与「恢复默认」用；上游没有这个入口，本仓不画按钮，只是把键清掉）。 */
export function unsuppressPowerSaveNotice(store?: Store): void {
  try { storage(store)?.removeItem(IGNORE_POWER_SAVE_MODE) } catch { /* 同上 */ }
}

export interface PowerSaveNotice {
  message: string
  error: boolean
  displayId: string
  /** 通知自带的那两个按钮（顺序照 `PowerSaveModeNotifier.kt:39` → `:45`）。 */
  actions: Array<{ label: string; run: () => void }>
}

/**
 * 要不要发这条通知：只在**开**的那一拍（`TogglePowerSaveAction.java:22` 的 `if (state)`），
 * 且没被「不再显示」压住（`PowerSaveModeNotifier.kt:30-32`）。
 * `previous === null` 是启动那一拍（`PowerSaveModeNotifier.kt:17-22` 的 ProjectActivity）：
 * 开档启动也补发一条。
 */
export function powerSaveTransition(previous: boolean | null, next: boolean): 'notify' | 'expire' | null {
  if (previous === next) return null
  if (next) return 'notify'
  // 上游 `:56` 那条 TOPIC 监听在**任何**变化上都订阅，关掉时把气球收掉。
  return previous === null ? null : 'expire'
}

/** 旧接口保留：只有「开」才发，且看抑制开关。 */
export function shouldNotifyPowerSave(on: boolean, store?: Store): boolean {
  return powerSaveTransition(null, on) === 'notify' && !powerSaveNoticeSuppressed(store)
}

/**
 * 拼出那一条通知（标题与正文用上游的两行，本仓的条目是一行文字 + 明细行）。
 * `turnOff` 给 null 就是宿主没有关闭通道 ⇒ 不给那第二个按钮（不画点不动的控件）。
 */
export function powerSaveNotice(
  turnOff: (() => void) | null,
  onDoNotShow?: () => void,
): PowerSaveNotice {
  const actions: Array<{ label: string; run: () => void }> = []
  // 顺序照上游：先「不再显示」（`:39-44`），后「禁用省电模式」（`:45-50`）。
  if (onDoNotShow) actions.push({ label: POWER_SAVE_DO_NOT_SHOW_ACTION, run: onDoNotShow })
  if (turnOff) actions.push({ label: POWER_SAVE_DISABLE_ACTION, run: turnOff })
  return {
    message: `${POWER_SAVE_ON_TITLE} ${POWER_SAVE_ON_CONTENT}`,
    error: POWER_SAVE_IS_ERROR,
    displayId: POWER_SAVE_DISPLAY_ID,
    actions,
  }
}

/** 挂起队列时给的那句原因（面板行与通知正文同一句话，见 `src/backgroundTasks.ts` 的 `queueRow`）。 */
export const POWER_SAVE_SUSPEND_REASON = POWER_SAVE_ON_CONTENT
