// 通知与状态栏键盘导航 —— 从 App.vue 搬出的一域（150 行，3 个依赖）。
//
// 判据：IDEA 把「消息」分成两半 —— 一闪而过的 balloon（TaoCode 的 `notice`）和常驻的
// **通知中心日志**（`Notifications` widget / 欢迎页通知工具条共用同一份历史），后者的规则
// （`expirePreviousAndNotify`、按 displayId 顶替、前插）在 src/notices.ts，本模块是它的宿主。
// 同一片代码里还有**状态栏的键盘遍历**：IDEA 把状态栏做成 focus cycle root
// （`IdeStatusBarImpl.kt:313-323,863-872,952-962`），左右键在可见且启用的组件间走并两端环绕，
// Escape 回到进入前的组件；规则在 src/statusBarNav.ts，本模块只做 DOM 与注册。
// 两者同处是因为「通知中心」本身就是状态栏里的一个组件，它们的开关状态（`noticeOpen` / `statusMenu`）互相牵制。
import { computed, ref } from 'vue'
import { focusActiveEditor } from './editorFocus.ts'
import { pushNotice, upsertNotice, type NoticeAction, type NoticeEntry } from './notices.ts'
import { clearNoticeStatus, setNoticeStatus } from './statusBarText.ts'
import { focusableWidgets, navigateWidget, resolveRestoreTarget, shouldFocusFirstWidget, type NavDirection } from './statusBarNav.ts'
import { wireLspProgressNotices } from './progressNotices.ts'

export interface NotificationsDeps {
  /** 一闪而过的消息（宿主自持的可写 computed，模板直接绑定）。 */
  notice: { value: string }
  noticeError: { value: boolean }
  noticeAction: { value: (() => void) | null }
}

export function createNotifications(deps: NotificationsDeps) {
  const { notice, noticeError, noticeAction } = deps
// IDEA keeps every notification in a log the status-bar widgets and the welcome screen's
// notification toolbar list (Notifications widget / `createNotificationToolbar`): the transient
// balloon is not the only place a message lives. `notice` stays the balloon; `noticeLog` is that
// history, and its rules live in src/notices.ts so both surfaces share one definition.
const noticeLog = ref<NoticeEntry[]>([])
let noticeSeq = 0
function notify(message: string, error = false, onClick?: () => void, detail?: string[], displayId?: string, actions?: NoticeAction[]) {
  notice.value = message
  noticeError.value = error
  noticeAction.value = onClick ?? null
  noticeActions.value = actions ?? null
  const entry: NoticeEntry = { id: ++noticeSeq, message, error, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }), detail, displayId, actions }
  noticeEntryId.value = entry.id
  // `pushNotice` carries IDEA's `expirePreviousAndNotify` rule (ShowNotificationCommitResultHandler
  // .kt:97): the notification with the same display id is expired first, so repeated commits replace
  // one entry instead of filling the notification centre with history.
  noticeLog.value = pushNotice(noticeLog.value, entry)
  // 通知进状态栏那一段文字（IDEA `ApplicationNotificationsModel` 推 statusMessage，由
  // `StatusPanel.updateText` 显示并**带相对时间**）。`stamp` 用真实 epoch：上游拿它算"刚刚/N 分钟前"。
  setNoticeStatus({ message, stamp: Date.now() })
}
// The commit panel reports its result through `notify` with a display id, so its handler ignores
// the channel's transient-click action.
function notifyFromPanel(message: string, error = false, displayId?: string, detail?: string[]) {
  notify(message, error, undefined, detail, displayId)
}
// 进度型通知：同一个 displayId 就地刷新（跑完由调用方把 percent 收成数字或 null，行就留在列表里）。
function notifyProgress(entry: Omit<NoticeEntry, 'id' | 'at'>) {
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
}
function clearNotices() { noticeLog.value = []; noticeOpen.value = false; clearNoticeStatus() }
// WindowMenu › Notifications（`PlatformActions.xml:726-728`）：CloseFirstNotification 关掉
// **最新**一条 —— `pushNotice` 是前插（`[entry, ...kept]`），所以最新就是下标 0；
// CloseAllNotifications 清空整条日志（复用通知中心的 clearNotices）。
function closeFirstNotification() {
  noticeLog.value = noticeLog.value.slice(1)
  if (!noticeLog.value.length) { noticeOpen.value = false; clearNoticeStatus() }
}
  return {
    noticeLog, noticeOpen, notify, notifyFromPanel, notifyProgress, noticeActions, runNoticeAction, runBalloonAction, expireNotice, statusBarRef, statusWidgets, focusStatusBar,
    restoreFocusFromStatusBar, onStatusBarKeydown, statusMenu, openStatusMenu, clearNotices, closeFirstNotification,
  }
}
