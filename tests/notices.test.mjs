import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NOTICE_LOG_LIMIT, NOTICE_PREVIEW_LIMIT, NOTICES_LABEL,
  noticeButtonText, noticeButtonVisible, noticeLevel, noticePreview, noticeTitle, pushNotice,
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

test('the tooltip spells out the count and whether errors are inside', () => {
  assert.equal(noticeTitle([]), '通知中心：暂无通知')
  assert.equal(noticeTitle([entry(1)]), '通知中心：最近 1 条，无错误')
  assert.equal(noticeTitle([entry(1), entry(2, true)]), '通知中心：最近 2 条，其中含错误')
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
