// 状态栏**中间那段文字**（IDEA 的 `StatusBar.Info.set` 通道）。
//
// 上游链路三跳，逐跳核过：
//   1. `StatusBar.Info.set(text, project, requestor)`（`platform/ide-core/src/com/intellij/openapi/wm/StatusBar.kt:34-45`，
//      `TOPIC` 在 `:30`）→
//      往 `StatusBarInfo.TOPIC` 发 `setInfo(text, requestor)`。
//   2. `IdeStatusBarImpl` 转给 `InfoAndProgressPanel.setText(text, requestor)`
//      （`InfoAndProgressPanel.kt:439-451`）。
//   3. `StatusPanel.updateText(nonLogText)`（仓里有四个同名文件，这里是
//      `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/StatusPanel.java:175-220`）决定最终显示什么 ——
//      本模块的规则全部出自这一步。
//
// `setText` 的两条过滤（`:439-451`），**两条都照抄**：
//   · 空文字只有来自"当前说话人"或通知通道才被接受（前者是它自己清场，后者是通知托管）；
//     别的来源发空串一律忽略 —— 否则任何路过的人都顺手把状态栏擦白。
//   · 返回值 = **是不是通知在托管这段话**，`currentRequestor` 据此更新（`:448`）。
//
// `StatusPanel.updateText`（`:175-220`）的显示规则：
//   · 通知托管（`nonLogText` 为空 **且** 有 statusMessage）→ 显示通知文字，并且当
//     "上一条不是通知托管"（`myDirty`）或这条已过 60 秒时追加 ` (相对时间)`；托管期间
//     每 30_000ms 重算一次时间后缀（`:195-210` 那段 `Runnable`，`alarm.addRequest(this, 30000)` 在 `:208`、
//     60 秒那道判据在 `:200`）。
//   · 否则显示 `nonLogText` 并把 `myDirty` 置 true（`:212-217`）。
//
// 本仓的"通知"就是 `src/notices.ts` 的 `noticeLog`，所以 `setNoticeStatus` 由那边在**有新通知时**
// 调用（IDEA 是 `ApplicationNotificationsModel` 往 statusMessage 里塞）。
//
// 为什么单独成模块：这段文字此前是 App.vue 里硬编码的 `working ? '正在处理…' : '就绪'`，
// **没有任何通道** —— 运行/调试结束之后没有地方能说一句结果。第一个真消费者见
// `src/processTerminated.ts`（IDEA `ProcessTerminatedListener`）。

import { ref } from 'vue'

/** 通知通道的 requestor 名（`platform/platform-impl/src/com/intellij/notification/impl/ApplicationNotificationsModel.kt:20`）。 */
export const EVENT_REQUESTOR = 'notification'

/** 没有通道说话、也没有通知托管时的兜底文字（本仓原有的"就绪"）。 */
export const IDLE_TEXT = '就绪'

/** `myDirty || now - stamp >= 60_000`（`StatusPanel.java:200`）。 */
export const TIME_SUFFIX_AFTER = 60_000
/** 时间后缀的刷新间隔（`StatusPanel.java:208` 的 `alarm.addRequest(this, 30000)`）。 */
export const TIME_SUFFIX_REFRESH = 30_000

/** 一条可显示的通知（上游 `StatusMessage` 的 notification/text/stamp 三件）。 */
export interface StatusNotice {
  message: string
  /** epoch ms = `statusMessage.stamp()`。 */
  stamp: number
}

/**
 * `FormatUtil.formatPrettyDateTime` 的对应物（上游输出 `1 minute ago` 后 `decapitalize`）。
 * 粒度同上游的"刚刚 / 分钟 / 小时 / 天"。
 */
export function relativeStamp(stamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - stamp) / 1000))
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** 通知在状态栏上的一行（`StatusPanel.java:195-210` 的那段 `Runnable`）。 */
export function noticeStatusText(notice: StatusNotice, now: number, needsStamp: boolean): string {
  if (!needsStamp && now - notice.stamp < TIME_SUFFIX_AFTER) return notice.message
  return `${notice.message} (${relativeStamp(notice.stamp, now)})`
}

/**
 * `InfoAndProgressPanel.setText` 的过滤（`:439-451`）。
 * 返回新的 `currentRequestor`；`undefined` = 这次调用被忽略（文字与说话人都不动）。
 */
export function acceptStatusText(text: string | null, requestor: string | null, current: string | null): string | null | undefined {
  if ((text === null || text === '') && requestor !== current && requestor !== EVENT_REQUESTOR) return undefined
  return requestor
}

export interface StatusTextInput {
  /** 通道当前说的话（`InfoAndProgressPanel.statusPanel.text`）；null/空 = 没有说话。 */
  text: string | null
  /** 最近一条通知（没有就是 null）。 */
  notice: StatusNotice | null
  now: number
  /** 上一条显示的**不是**通知托管文字（`myDirty`）。 */
  dirty: boolean
}

/** `StatusPanel.updateText`（`:168-213`）的结果。`managed` = 显示的是通知托管文字。 */
export function statusBarDisplay(input: StatusTextInput): { text: string; managed: boolean; timeText: string | null } {
  const managed = (input.text === null || input.text === '') && input.notice !== null
  if (!managed) return { text: input.text ?? '', managed: false, timeText: null }
  const shown = noticeStatusText(input.notice!, input.now, input.dirty)
  const suffix = shown.slice(input.notice!.message.length)
  return { text: shown, managed: true, timeText: suffix || null }
}

// ——— 状态（上游的 currentRequestor / myDirty / myTimeText 三个字段）———
// `myTimeText` 在本仓不落模块状态：时间后缀已经在 `statusBarDisplay` 里拼进 `display.text`，
// 原来那个模块级 `timeText` 只服务一条没有消费者的读口（`statusTextTimeSuffix()`，
// 2026-10-06 桶 status2 删除），留着就是一份没人读的第二个真相。

let currentRequestor: string | null = null
let pendingText = ''
let notice: StatusNotice | null = null
let dirty = true
let managed = false
let timer: ReturnType<typeof setInterval> | null = null

/** 状态栏中间那段文字（模板绑定它）。 */
export const statusText = ref(IDLE_TEXT)

function stopTimer() {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

/** `alarm.addRequest(this, 30000)`：托管期间每 30 秒重算时间后缀（`:190-201`）。 */
function startTimer() {
  if (timer !== null) return
  timer = setInterval(() => {
    if (!managed || notice === null) { stopTimer(); return }
    statusText.value = noticeStatusText(notice, Date.now(), false) || IDLE_TEXT
  }, TIME_SUFFIX_REFRESH)
}

function render(now: number) {
  const display = statusBarDisplay({ text: pendingText, notice, now, dirty })
  statusText.value = display.text || IDLE_TEXT
  managed = display.managed
  if (managed) { dirty = false; startTimer() } else stopTimer()
}

/** `StatusBar.Info.set`。`requestor` 缺省 null = 无主来源。 */
export function setStatusText(text: string | null, requestor: string | null = null, now = Date.now()): void {
  const next = acceptStatusText(text, requestor, currentRequestor)
  if (next === undefined) return
  currentRequestor = next
  pendingText = text ?? ''
  render(now)
}

/** 通知通道（`ApplicationNotificationsModel`）：新通知进状态栏，没有通知就退回通道文字。 */
export function setNoticeStatus(next: StatusNotice | null, now = Date.now()): void {
  if (next !== null) currentRequestor = EVENT_REQUESTOR
  notice = next
  render(now)
}

/** 通知被清空/过期时调用：回到通道自己说的话。 */
export function clearNoticeStatus(now = Date.now()): void {
  notice = null
  render(now)
}

/** 忙但没人说话时的兜底（本仓原有文案）。 */
export const BUSY_TEXT = '正在处理…'

/**
 * 状态栏中段最终显示什么：通道说过话就以通道为准，否则按忙/闲兜底。
 * 放在这里而不是 App.vue 的 computed 里 —— 「通道静默」的判据（`IDLE_TEXT` 是唯一哨兵）
 * 与通道本身同处一个模块，宿主只留一行调用（模板里直接写 `statusLabel(working)`；
 * 它内部读 `statusText` 这个 ref，渲染期读到就会建立依赖）。
 */
export function statusLabel(working: boolean): string {
  return statusText.value !== IDLE_TEXT ? statusText.value : working ? BUSY_TEXT : IDLE_TEXT
}

/** 测试用：把状态清回初始态。 */
export function resetStatusText(now = Date.now()): void {
  currentRequestor = null
  pendingText = ''
  notice = null
  dirty = true
  stopTimer()
  render(now)
}
