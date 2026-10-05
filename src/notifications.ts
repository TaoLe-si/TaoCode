// 通知与状态栏键盘导航 —— 从 App.vue 搬出的一域（150 行，3 个依赖）。
//
// 判据：IDEA 把「消息」分成两半 —— 一闪而过的 balloon（TaoCode 的 `notice`）和常驻的
// **通知中心日志**（`Notifications` widget / 欢迎页通知工具条共用同一份历史），后者的规则
// （`expirePreviousAndNotify`、按 displayId 顶替、前插）在 src/notices.ts，本模块是它的宿主。
// 同一片代码里还有**状态栏的键盘遍历**：IDEA 把状态栏做成 focus cycle root
// （`IdeStatusBarImpl.kt:313-323,863-872,952-962`），左右键在可见且启用的组件间走并两端环绕，
// Escape 回到进入前的组件；规则在 src/statusBarNav.ts，本模块只做 DOM 与注册。
// 两者同处是因为「通知中心」本身就是状态栏里的一个组件，它们的开关状态（`noticeOpen` / `statusMenu`）互相牵制。
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { focusActiveEditor } from './editorFocus.ts'
import { placeMenu } from './menuPlacement.ts'
import { pushNotice, upsertNotice, type NoticeAction, type NoticeEntry } from './notices.ts'
import { playNotificationSound } from './notificationBeeper.ts'
import { armRemindLater, canShowNotice } from './notificationDoNotAsk.ts'
import { balloonFadeoutMs, noticeGroup, showsBalloon, type NotificationDisplayType } from './notificationGroups.ts'
import { clearNoticeStatus, setNoticeStatus } from './statusBarText.ts'
import { focusableWidgets, navigateWidget, resolveRestoreTarget, shouldFocusFirstWidget, type NavDirection } from './statusBarNav.ts'
import { wireLspProgressNotices } from './progressNotices.ts'
// 省电模式那一拍：通知（`PowerSaveModeNotifier`）与后台任务队列的挂起是同一条语义，
// 规则和文案在 src/notificationPowerSave.ts，本模块只做挂载。
import { backgroundTaskQueue } from './backgroundTasks.ts'
import {
  POWER_SAVE_DISPLAY_ID, POWER_SAVE_SUSPEND_REASON, powerSaveNotice, powerSaveNoticeSuppressed,
  powerSaveTransition, suppressPowerSaveNotice,
} from './notificationPowerSave.ts'

export interface NotificationsDeps {
  /** 一闪而过的消息（宿主自持的可写 computed，模板直接绑定）。 */
  notice: { value: string }
  noticeError: { value: boolean }
  noticeAction: { value: (() => void) | null }
  /**
   * 当前工作区根 —— 「不再为此项目显示」写的是**项目级**那张表
   * （`DoNotAskProjectManager`，`DoNotAskManager.kt:29-34`），判定时必须一起查
   * （`Notification.isDoNotAskFor:465-467` 是"项目级 或 应用级"）。
   * 不给就等于没有项目，只查应用级那一张。
   */
  projectRoot?: () => string
  /**
   * 省电模式（`editorSettings.powerSaveMode`）的镜像与关闭通道。
   * 上游的两个触发点都在这里合成了一拍：项目打开时已经是省电档 ⇒ 补发一条
   * （`PowerSaveModeNotifier.kt:17-22` 的 ProjectActivity），动作里切换档 ⇒ 发/收
   * （`TogglePowerSaveAction.java:20-25`）。不给这一项就等于本仓没有这个开关，什么都不发。
   */
  powerSave?: { enabled: () => boolean; turnOff?: () => void }
  /**
   * 气球的存在时长（毫秒）从哪来。默认走通知组的 `displayType`
   * （`notificationGroups.ts` 的 `balloonFadeoutMs`：BALLOON 10 秒、STICKY_BALLOON 300 秒，
   * 上游同一处是 `NotificationsManagerImpl.java:446-449` 的
   * `int delay = displayType == STICKY_BALLOON ? 300000 : 10000; startSmartFadeoutTimer(delay)`）。
   * 判据注入替身可以把 10 秒压成几十毫秒。
   */
  balloonDelayMs?: (displayType: NotificationDisplayType) => number | undefined
}

export function createNotifications(deps: NotificationsDeps) {
  const { notice, noticeError, noticeAction } = deps
  const projectRoot = deps.projectRoot ?? (() => '')
// IDEA keeps every notification in a log the status-bar widgets and the welcome screen's
// notification toolbar list (Notifications widget / `createNotificationToolbar`): the transient
// balloon is not the only place a message lives. `notice` stays the balloon; `noticeLog` is that
// history, and its rules live in src/notices.ts so both surfaces share one definition.
const noticeLog = ref<NoticeEntry[]>([])
let noticeSeq = 0
function notify(message: string, error = false, onClick?: () => void, detail?: string[], displayId?: string, actions?: NoticeAction[]) {
  // 「不再显示」的判定点在上游是 `Notification.canShowFor`（`Notification.java:193-202`）——
  // 命中就不发这条，而不是发了再藏。抑制表见 src/notificationDoNotAsk.ts；
  // 查的是**项目级 + 应用级**两张表（`Notification.isDoNotAskFor:465-467`），
  // 所以这里必须把工作区根递进去，否则用户在通知中心点的「不再为此项目显示」不会生效。
  const root = projectRoot()
  if (!canShowNotice({ message, displayId }, root)) return
  const entry: NoticeEntry = { id: ++noticeSeq, message, error, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }), detail, displayId, actions }
  // 通知组决定这一条要不要占用那个一闪而过的气球（`NotificationGroup.displayType`：
  // NONE / TOOL_WINDOW 只进通知中心，见 NotificationsAnnouncer.kt:85-87）。本仓的生产方
  // 落在 `src/notificationGroups.ts` 那张表里；未分组的照旧弹。
  const group = noticeGroup(entry)
  const balloon = !group || showsBalloon(group.displayType)
  if (balloon) {
    notice.value = message
    noticeError.value = error
    noticeAction.value = onClick ?? null
    noticeActions.value = actions ?? null
  }
  noticeEntryId.value = balloon ? entry.id : null
  // 气球的存在时长归通知组管（未分组按 BALLOON 那一档，与上游"注册项决定显示方式"一致）。
  if (balloon) armBalloonFadeout(entry.id, group?.displayType ?? 'BALLOON')
  // `pushNotice` carries IDEA's `expirePreviousAndNotify` rule (ShowNotificationCommitResultHandler
  // .kt:97): the notification with the same display id is expired first, so repeated commits replace
  // one entry instead of filling the notification centre with history.
  noticeLog.value = pushNotice(noticeLog.value, entry)
  // 通知进状态栏那一段文字（IDEA `ApplicationNotificationsModel` 推 statusMessage，由
  // `StatusPanel.updateText` 显示并**带相对时间**）。`stamp` 用真实 epoch：上游拿它算"刚刚/N 分钟前"。
  if (balloon) setNoticeStatus({ message, stamp: Date.now() })
  // `NotificationsBeeper.kt:12-16`：本组开着「播放声音」就响一声（按组、默认关，规则与
  // 存储在 src/notificationBeeper.ts）。响不出声不报错，也不影响上面任何一步。
  playNotificationSound(entry)
}
// The commit panel reports its result through `notify` with a display id, so its handler ignores
// the channel's transient-click action. `actions` 是面板给通知带的那几个按钮（上游
// `appendShowDetailsNotificationActions` 那一套：显示详细信息 / 仍然{0}）。
function notifyFromPanel(message: string, error = false, displayId?: string, detail?: string[], actions?: NoticeAction[]) {
  notify(message, error, undefined, detail, displayId, actions)
}
// 进度型通知：同一个 displayId 就地刷新（跑完由调用方把 percent 收成数字或 null，行就留在列表里）。
function notifyProgress(entry: Omit<NoticeEntry, 'id' | 'at'>) {
  if (!canShowNotice(entry, projectRoot())) return
  const at = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  // id 与气球那条共用一个序列：`upsertNotice` 命中同 displayId 时会沿用旧 id，所以这里给新号即可。
  noticeLog.value = upsertNotice(noticeLog.value, { ...entry, id: ++noticeSeq, at })
}
// 语言服务的 `$/progress` 在消息窗口里那一行：进度表是 bridge 喂的，这里只是它的一个读者
// （映射规则与 Gradle 那行共用 src/progressNotices.ts）。
wireLspProgressNotices(notifyProgress)
// 气球上那排动作按钮（渲染读这条；点完由调用方收掉，与上游 `notification.expire()` 一致）。
const noticeActions = ref<NoticeAction[] | null>(null)
// 气球显示的就是列表里最新那一条：记住它的 id，点动作时才能把**这一条**收掉（下面 `runBalloonAction`）。
const noticeEntryId = ref<number | null>(null)
// --- 气球的存在时长（`NotificationsManagerImpl.java:446-449`）--------------------------------
// 上游那一行给的是「气球活多久」的唯一判据：`int delay = displayType == STICKY_BALLOON ? 300000 : 10000;`
// 然后 `((BalloonImpl) balloon).startSmartFadeoutTimer(delay)`。两个细节都照抄：
//   · **"smart"**：指针停在气球上时不 fade（`BalloonImpl.startSmartFadeoutTimer` 的语义）⇒ 到点先看一眼
//     元素是不是 `:hover`，是就过 1 秒再看，直到指针离开；
//   · **窗口在前台才起表**：外层那个 `frameActivateBalloonListener`（`:445-450`，实现 `:461-463`
//     `if (ApplicationManager.getApplication().isActive()) callback.run()`）⇒ 本仓用 `document.hidden`
//     当同一个探针，界面在后台时不倒计时，回到前台才起表。
// 气球消失**不等于**通知被收掉：那条还留在通知中心（`noticeLog` 不动），与上游"气球 fade、
// 通知进 Event Log"同一形状。
const BALLOON_SELECTOR = '.notice.workspace-notice'
const BALLOON_HOVER_RECHECK_MS = 1000
let balloonFadeoutTimer: ReturnType<typeof setTimeout> | null = null
let balloonVisibilityListener: (() => void) | null = null
function clearBalloonFadeout() {
  if (balloonFadeoutTimer !== null) { clearTimeout(balloonFadeoutTimer); balloonFadeoutTimer = null }
  if (balloonVisibilityListener !== null && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', balloonVisibilityListener)
    balloonVisibilityListener = null
  }
}
function armBalloonFadeout(id: number, displayType: NotificationDisplayType) {
  clearBalloonFadeout()
  const delay = (deps.balloonDelayMs ?? balloonFadeoutMs)(displayType)
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay <= 0) return
  const fadeOrRetry = () => {
    // 已经被下一条顶替、或者用户自己点掉了：这一拍什么都不做。
    if (noticeEntryId.value !== id || !notice.value) { clearBalloonFadeout(); return }
    const balloonElement = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(BALLOON_SELECTOR)
    if (balloonElement?.matches(':hover')) {
      balloonFadeoutTimer = setTimeout(fadeOrRetry, BALLOON_HOVER_RECHECK_MS)
      return
    }
    notice.value = ''
    noticeError.value = false
    noticeAction.value = null
    noticeActions.value = null
    balloonFadeoutTimer = null
  }
  const start = () => { balloonFadeoutTimer = setTimeout(fadeOrRetry, delay) }
  if (typeof document !== 'undefined' && document.hidden) {
    // 上游的 frameActivateBalloonListener：窗口不在前台就不起表。
    balloonVisibilityListener = () => {
      if (document.hidden) return
      balloonVisibilityListener = null
      start()
    }
    document.addEventListener('visibilitychange', balloonVisibilityListener)
    return
  }
  start()
}
onScopeDispose(clearBalloonFadeout)
function runNoticeAction(action: NoticeAction) {
  noticeActions.value = null
  notice.value = ''
  action.run()
}
/**
 * 上游那条告诫（`Notification.java:52`）用的是 `NotificationAction.createSimpleExpiring`：**点完把这条通知
 * 一起收掉**。列表里的按钮在 `NoticeList.vue` 里就是先 `expire` 再 `run`；气球这边以前只收起气球，
 * 于是同一件事在两个面上点出来的结果不一样 —— 这条把它补齐。
 */
function runBalloonAction(action: NoticeAction) {
  const id = noticeEntryId.value
  noticeEntryId.value = null
  runNoticeAction(action)
  if (id !== null) expireNotice(id)
}
function expireNotice(id: number) {
  noticeLog.value = noticeLog.value.filter(entry => entry.id !== id)
  if (noticeEntryId.value === id) noticeEntryId.value = null
  if (!noticeLog.value.length) { noticeOpen.value = false; clearNoticeStatus() }
}
const noticeOpen = ref(false)
// --- Status bar keyboard navigation (IdeStatusBarImpl.kt:313-323,863-872,952-962) -------------
// IDEA makes the status bar a focus cycle root (:313) whose traversal order is the visible+enabled
// widgets in visual order (:874-880,901-902,953), adds RIGHT/LEFT to the traversal keys (:317-322)
// and wraps at both ends (:955-959). `focusFirstWidget` (:863-872) — reached through
// `FocusStatusBarAction` (status/FocusStatusBarAction.kt:10-21) — enters the bar; Escape walks back
// out through `restoreFocusToPreviousComponent` (:579-596). The rules themselves live in
// `src/statusBarNav.ts` so they are testable without a DOM.
const statusBarRef = ref<HTMLElement>()
let statusBarFocusBefore: HTMLElement | null = null
const STATUS_WIDGET_SELECTOR = '.statusbar button:not([disabled]), .statusbar [tabindex="0"]:not([disabled])'
// Rows *inside* a popup are not widgets: IDEA's traversal walks the components injected into the
// three panels, and the popup contents are reached through the popup's own focus cycle
// (ProcessPopup.java:98-100 sets up its own FocusTraversalPolicy).
const STATUS_POPUP_SELECTOR = '.status-progress-list, .status-toolwindows-popup, .status-widget-menu, .status-notice-list'
function statusWidgets(): HTMLElement[] {
  const root = statusBarRef.value
  if (!root) return []
  const candidates = [...root.querySelectorAll<HTMLElement>(STATUS_WIDGET_SELECTOR)]
    .filter(element => !element.closest(STATUS_POPUP_SELECTOR))
    .map(element => ({ element, hidden: element.offsetParent === null, disabled: element instanceof HTMLButtonElement && element.disabled }))
  return focusableWidgets(candidates).map(entry => entry.element)
}
function focusStatusBar() {
  const widgets = statusWidgets()
  const active = document.activeElement as HTMLElement | null
  const inside = Boolean(active && statusBarRef.value?.contains(active))
  if (!shouldFocusFirstWidget(inside, widgets.length)) return
  if (!inside) statusBarFocusBefore = active
  widgets[0].focus()
}
function restoreFocusFromStatusBar() {
  const saved = statusBarFocusBefore
  statusBarFocusBefore = null
  const usable = Boolean(saved?.isConnected && !(saved as HTMLButtonElement).disabled)
  if (resolveRestoreTarget(Boolean(saved), usable) === 'previous' && saved) { saved.focus(); return }
  // `:583-590` — the saved owner is gone, so the focus goes back to the editor component.
  // 走共用助手：隐藏面板里的那个 `.cm-content` focus() 会无声失败（见 src/editorFocus.ts）。
  focusActiveEditor()
}
function onStatusBarKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented) { restoreFocusFromStatusBar(); return }
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  const widgets = statusWidgets()
  if (widgets.length < 2) return
  const active = document.activeElement as HTMLElement | null
  const direction: NavDirection = event.key === 'ArrowRight' ? 'next' : 'previous'
  const next = navigateWidget(active ? widgets.indexOf(active) : -1, widgets.length, direction)
  if (next < 0) return
  event.preventDefault()
  widgets[next].focus()
}
const statusMenu = ref<{ x: number; y: number } | null>(null)
function openStatusMenu(event: MouseEvent) {
  // Never hijack the menu while a status chip has its own action menu open.
  event.preventDefault()
  statusMenu.value = { x: event.clientX, y: event.clientY }
  // 状态栏贴着窗口**底边**，而组件菜单有 16 行（约 480px 高）。原样拿 clientY 定位的话菜单
  // 80% 掉到视口外，只剩标题那半条看得见（真机截图 build/ui-statusbar-menu.png 就是这样）。
  // 渲染完量一次真实尺寸再夹回来 —— 翻转/夹取的口径见 src/menuPlacement.ts。
  void nextTick(() => {
    const current = statusMenu.value
    const el = document.querySelector<HTMLElement>('.status-widget-menu')
    if (!current || !el) return
    const box = el.getBoundingClientRect()
    const placed = placeMenu({ ...current, width: box.width, height: box.height,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight })
    if (placed.x !== current.x || placed.y !== current.y) statusMenu.value = placed
  })
}
function clearNotices() { noticeLog.value = []; noticeOpen.value = false; clearNoticeStatus() }
// WindowMenu › Notifications（`PlatformActions.xml:726-728`）：CloseFirstNotification 关掉
// **最新**一条 —— `pushNotice` 是前插（`[entry, ...kept]`），所以最新就是下标 0；
// CloseAllNotifications 清空整条日志（复用通知中心的 clearNotices）。
function closeFirstNotification() {
  noticeLog.value = noticeLog.value.slice(1)
  if (!noticeLog.value.length) { noticeOpen.value = false; clearNoticeStatus() }
}
// 「明天提醒我」的到点调度（上游 `RemindLaterManager`）分两支，本仓现在两支都接上了：
//   · 启动那一支 `initializeComponent:177-212` —— 存着的每条走一遍，`delay > 0` 继续等、
//     `delay <= 0` 立刻 `execute(element)`（`:119-171`，把同一条通知重新 notify 一遍）；
//   · 运行中那一支 `schedule(element, delay)`（`:115-117`，`addSimpleNotification:66` 排完就定好时）
//     —— 之前**只有**启动那一支，于是"明天提醒我"在本次运行里永远不会响。
// `armRemindLater` 把两支合成一件事（见 src/notificationDoNotAsk.ts 的那一节），
// 并在事件作用域结束时撤掉定时器。
const cancelRemindLaterAlarm = armRemindLater({
  onDue: records => { for (const record of records) notify(record.message, record.error, undefined, record.detail, record.displayId) },
})
onScopeDispose(cancelRemindLaterAlarm)
  // --- 省电模式（`PowerSaveModeNotifier` + `TogglePowerSaveAction.java:20-25`）----------------------------
  // 上游这一拍做三件事，本仓逐条对上：
  //   ① 开档时发那条 WARNING 通知（`TogglePowerSaveAction.java:22` 只在 `state == true` 时发；
  //      `PowerSaveModeNotifier.kt:17-22` 是项目打开时的 ProjectActivity ⇒ 本仓用 `immediate: true` 的首拍）；
  //   ② `ignore.power.save.mode` 命中就整个不发（`PowerSaveModeNotifier.kt:30-32`）；
  //   ③ 模式再变就把气球收掉（`:52-56` 那条 `PowerSaveMode.TOPIC` 监听）⇒ 关档那一拍走 `expireNotice`。
  // 另外正文那句「代码洞察和后台任务已禁用」在本仓是**真做**的：队列挂起（`setSuspended`），
  // 不是取消；理由与差别写在 src/notificationPowerSave.ts 的头注。
  const powerSave = deps.powerSave
  if (powerSave) {
    let previous: boolean | null = null
    const stopPowerSaveWatch = watch(() => powerSave.enabled(), on => {
      const first = previous === null
      const step = powerSaveTransition(previous, on)
      previous = on
      // 首拍且是关档：上游启动时没有"恢复队列"这一说，别去动它（也不会有人看见）。
      if (!first || on) backgroundTaskQueue.setSuspended(on ? POWER_SAVE_SUSPEND_REASON : null)
      if (step === 'expire') {
        const stale = noticeLog.value.find(entry => entry.displayId === POWER_SAVE_DISPLAY_ID)
        if (stale) expireNotice(stale.id)
        return
      }
      if (step !== 'notify' || powerSaveNoticeSuppressed()) return
      const notice = powerSaveNotice(powerSave.turnOff ?? null, () => { suppressPowerSaveNotice() })
      notify(notice.message, notice.error, undefined, undefined, notice.displayId, notice.actions)
    }, { immediate: true })
    onScopeDispose(stopPowerSaveWatch)
  }
  return {
    noticeLog, noticeOpen, notify, notifyFromPanel, notifyProgress, noticeActions, runNoticeAction, runBalloonAction, expireNotice, statusBarRef, statusWidgets, focusStatusBar,
    restoreFocusFromStatusBar, onStatusBarKeydown, statusMenu, openStatusMenu, clearNotices, closeFirstNotification,
  }
}