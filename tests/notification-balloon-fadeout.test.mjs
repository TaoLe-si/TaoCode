// 气球的存在时长 —— 上游 `NotificationsManagerImpl.java:446-449`：
// `int delay = displayType == NotificationDisplayType.STICKY_BALLOON ? 300000 : 10000;`
// 然后 `((BalloonImpl) balloon).startSmartFadeoutTimer(delay)`；
// 起表那一步包在 `frameActivateBalloonListener`（同文件 `:445-450`，实现 `:461-463`
// `if (ApplicationManager.getApplication().isActive()) callback.run()`）里 —— 窗口不在前台不倒计时。
// 本仓的承接在 `src/notifications.ts`（`armBalloonFadeout`），档位表在 `src/notificationGroups.ts`
// 的 `balloonFadeoutMs`（这条函数此前**只有测试在读、生产链上是空的**）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope } from 'vue'

import { createNotifications } from '../src/notifications.ts'
import { POWER_SAVE_DISPLAY_ID } from '../src/notificationPowerSave.ts'

/** `progressNotices.ts` 的 `GRADLE_NOTICE_ID`（STICKY_BALLOON 组，`intellij.gradle.xml:309`）；
 *  这里写死字符串而不 import 那个模块 —— 它牵着 bridge，测试进程会被宿主轮询拖住。 */
const GRADLE_DISPLAY_ID = 'gradle:sync'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const wait = (ms = 0) => new Promise(resolve => { setTimeout(resolve, ms) })

/** 把 10 秒 / 300 秒压成 10 / 300 毫秒，比例不变。 */
const compressedMs = (displayType) => (displayType === 'STICKY_BALLOON' ? 300 : 10)

function mount(options = {}) {
  const notice = { value: '' }
  const noticeError = { value: false }
  const noticeAction = { value: null }
  const scope = effectScope()
  const api = scope.run(() => createNotifications({
    notice, noticeError, noticeAction, balloonDelayMs: options.balloonDelayMs ?? compressedMs,
  }))
  return { api, notice, noticeError, scope }
}

test('BALLOON 那一档按时收起气球，但通知仍留在通知中心', async () => {
  const { api, notice, scope } = mount()
  try {
    api.notify('省电模式那条', true, undefined, undefined, POWER_SAVE_DISPLAY_ID)
    assert.equal(notice.value, '省电模式那条', 'BALLOON 组要先占用气球')
    await wait(40)
    assert.equal(notice.value, '', '气球到点该收（上游 BALLOON = 10 秒）')
    const entry = api.noticeLog.value.find(item => item.displayId === POWER_SAVE_DISPLAY_ID)
    assert.ok(entry, '气球 fade 掉不能把通知从通知中心一起删掉')
  } finally { api.clearNotices(); scope.stop() }
})

test('STICKY_BALLOON 那一档活得比 BALLOON 久（300 秒 vs 10 秒的比例）', async () => {
  const sticky = mount()
  const balloon = mount()
  try {
    sticky.api.notify('Gradle 同步完了', false, undefined, undefined, GRADLE_DISPLAY_ID)
    balloon.api.notify('普通气球', false)
    await wait(40)
    assert.equal(balloon.notice.value, '', 'BALLOON 档早该收')
    assert.equal(sticky.notice.value, 'Gradle 同步完了', 'STICKY_BALLOON 不能跟着 10 秒一起收')
  } finally { sticky.api.clearNotices(); sticky.scope.stop(); balloon.api.clearNotices(); balloon.scope.stop() }
})

test('下一条气球顶替时，上一条的定时器作废', async () => {
  const { api, notice, scope } = mount()
  try {
    api.notify('普通气球', false)                    // BALLOON 档 = 10 毫秒
    await wait(1)
    api.notify('Gradle 同步完了', false, undefined, undefined, GRADLE_DISPLAY_ID)  // STICKY = 300 毫秒
    await wait(40)                                   // 前一条那 10 毫秒早就过了
    assert.equal(notice.value, 'Gradle 同步完了', '旧定时器把新气球收掉了')
    assert.equal(api.noticeLog.value.length, 2, '两条通知都该留在通知中心')
  } finally { api.clearNotices(); scope.stop() }
})

test('窗口在后台时不起表，回到前台才起（上游的 frameActivateBalloonListener）', async () => {
  const listeners = []
  const previousDocument = globalThis.document
  globalThis.document = {
    hidden: true,
    querySelector: () => null,
    addEventListener: (name, listener) => { if (name === 'visibilitychange') listeners.push(listener) },
    removeEventListener: name => { if (name === 'visibilitychange') listeners.length = 0 },
  }
  const { api, notice, scope } = mount()
  try {
    api.notify('后台时来的通知', false)
    await wait(40)
    assert.equal(notice.value, '后台时来的通知', '界面在后台就不该倒计时（上游同一个判据）')
    assert.equal(listeners.length, 1, '没有等到前台就起表的监听')
    globalThis.document.hidden = false
    for (const listener of listeners.splice(0)) listener()
    await wait(40)
    assert.equal(notice.value, '', '回到前台后才起表，到点收起')
  } finally {
    api.clearNotices(); scope.stop()
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('接线：气球时长真的从组表读，不是又一个只过自己测试的函数', () => {
  const source = read('../src/notifications.ts')
  assert.match(source, /if \(balloon\) armBalloonFadeout\(entry\.id/, 'notify() 没有给气球起表')
  assert.match(source, /deps\.balloonDelayMs \?\? balloonFadeoutMs/, '气球时长没有退回组表')
  assert.match(source, /matches\(':hover'\)/, '上游的 smart fadeout（指针停着不 fade）没有承接')
})
