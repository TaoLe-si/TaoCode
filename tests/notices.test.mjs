import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NOTICE_LOG_LIMIT, NOTICE_PREVIEW_LIMIT, NOTICES_LABEL,
  noticeButtonText, noticeButtonVisible, noticeLevel, noticePreview, noticeProgressLabel, noticeTitle, pushNotice, upsertNotice,
} from '../src/notices.ts'

const entry = (id, error = false, displayId) => ({ id, message: `m${id}`, error, at: '00:00:00', displayId })

// IdeBundle.properties:2238 toolwindow.stripe.Notifications.
test('the button label is the one IDEA ships', () => {
  assert.equal(NOTICES_LABEL, '通知')
  assert.equal(noticeButtonText(3), '通知 3')
  assert.equal(noticeButtonText(0), '通知')
})

// NotificationEventAction.update — no notifications, no button.
test('the button only exists while there is something to show', () => {
  assert.equal(noticeButtonVisible(0), false)
  assert.equal(noticeButtonVisible(1), true)
})

test('the level is the highest severity in the list', () => {
  assert.equal(noticeLevel([]), 'none')
  assert.equal(noticeLevel([entry(1)]), 'info')
  assert.equal(noticeLevel([entry(1), entry(2, true)]), 'error')
  assert.equal(noticeLevel([entry(2, true), entry(1)]), 'error')
})

test('the tooltip is upstream\'s two strings and nothing else', () => {
  // 上游 `IdeNotificationArea.java:105-107`：提示只有「挂起条数」与「无新通知」两档，
  // 中文包 `localization-zh.jar!messages/UIBundle.properties:265-266`
  // （`status.bar.notifications.widget.no.notification.tooltip=无新通知`、
  //  `status.bar.notifications.widget.tooltip={0} {0, choice, 1\#通知|2\#通知}挂起`）。
  // 本仓旧断言钉的是自造文案「通知中心：最近 N 条，其中含错误」（2026-10-06 桶 statusbar 订正：
  // 上游 tooltip 里没有「错误」这一档，严重度只用于图标上色 ⇒ `noticeLevel`）。
  assert.equal(noticeTitle([]), '无新通知')
  assert.equal(noticeTitle([entry(1)]), '1 通知挂起')
  assert.equal(noticeTitle([entry(1), entry(2)]), '2 通知挂起')
  // 含错误的那一条不改变提示文字 —— 分档只走 `noticeLevel`（App.vue 的 has-error 类）。
  assert.equal(noticeTitle([entry(1), entry(2, true)]), '2 通知挂起')
  assert.equal(noticeLevel([entry(1), entry(2, true)]), 'error', '严重度仍然算得出来，只是不进提示')
})

test('the popup previews the newest entries and stops at the limit', () => {
  assert.equal(NOTICE_PREVIEW_LIMIT, 20)
  assert.deepEqual(noticePreview([entry(3), entry(2), entry(1)]).map(item => item.id), [3, 2, 1])
  const many = Array.from({ length: 30 }, (_, index) => entry(index))
  assert.equal(noticePreview(many).length, NOTICE_PREVIEW_LIMIT)
  assert.equal(noticePreview(many, 2).length, 2)
  assert.equal(noticePreview(many, 0).length, 0)
})

// ShowNotificationCommitResultHandler.kt:97 — the previous notice with the same id is replaced.
test('a notice with a display id replaces the previous one carrying it', () => {
  const first = pushNotice([], entry(1, false, 'commit'))
  assert.deepEqual(first.map(item => item.id), [1])
  const second = pushNotice(first, entry(2, false, 'commit'))
  assert.deepEqual(second.map(item => item.id), [2])
  const other = pushNotice(second, entry(3))
  assert.deepEqual(other.map(item => item.id), [3, 2])
})

test('the log never grows past its limit and keeps the newest first', () => {
  assert.equal(NOTICE_LOG_LIMIT, 200)
  let log = []
  for (let index = 1; index <= NOTICE_LOG_LIMIT + 5; index += 1) log = pushNotice(log, entry(index))
  assert.equal(log.length, NOTICE_LOG_LIMIT)
  assert.equal(log[0].id, NOTICE_LOG_LIMIT + 5)
  assert.equal(log.at(-1).id, 6)
})

// ---------------------------------------------------------------------------
// 进度型通知（右下角消息窗口里那一行）—— 2026-09-29：语言服务与 Gradle 的进度都要能看见。
// 一条**正在推进**的行必须是"同一个对象被反复刷新"，不是每拍重发一条：
// 上游 `pushNotice` 那条 `expirePreviousAndNotify`（ShowNotificationCommitResultHandler.kt:97）
// 是给"同一件事的第二次通知"用的，进度行用它会在列表里上下跳。
// ---------------------------------------------------------------------------

test('进度通知就地刷新：位置、时间、id 都不动，只有内容在动', () => {
  let log = [entry(1), entry(2, false, 'gradle:sync'), entry(3)]
  log = upsertNotice(log, { id: 9, message: '正在同步 Gradle 项目', error: false, at: '99:99:99', displayId: 'gradle:sync', percent: null })
  assert.deepEqual(log.map(item => item.id), [1, 2, 3], '不能因为它在刷新就把整条行挪到最前面')
  assert.equal(log[1].message, '正在同步 Gradle 项目')
  assert.equal(log[1].at, '00:00:00', '时间戳保留第一次那一拍：这一行的含义是"这件事什么时候开始"')
  log = upsertNotice(log, { id: 12, message: 'Gradle 同步完成（用时 75 秒）', error: false, at: '99:99:99', displayId: 'gradle:sync', percent: 100 })
  assert.equal(log.length, 3, '刷新不是追加')
  assert.equal(log[1].message, 'Gradle 同步完成（用时 75 秒）')
})

test('没有同 displayId 的旧行时，进度通知按新条目插入（仍然前插 + 限量）', () => {
  const log = upsertNotice([entry(1)], { id: 2, message: 'Importing projects', error: false, at: '00:00:01', displayId: 'lsp:progress:java:0', percent: 5 })
  assert.deepEqual(log.map(item => item.id), [2, 1])
  assert.equal(upsertNotice([], { id: 3, message: 'x', error: false, at: '' }).length, 1)
})

test('进度文字分三种状态：不是通知 / 进行中 / 百分比', () => {
  assert.equal(noticeProgressLabel({ id: 1, message: 'm', error: false, at: '' }), '', '普通通知没有进度栏')
  assert.equal(noticeProgressLabel({ id: 1, message: 'm', error: false, at: '', percent: null }), '进行中')
  assert.equal(noticeProgressLabel({ id: 1, message: 'm', error: false, at: '', percent: 0 }), '0%')
  assert.equal(noticeProgressLabel({ id: 1, message: 'm', error: false, at: '', percent: 42 }), '42%')
})
