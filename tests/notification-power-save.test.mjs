// 省电模式那一拍的通知与后台任务挂起 —— 上游 `PowerSaveModeNotifier.kt` +
// `TogglePowerSaveAction.java:20-25` 的判据。规则在 src/notificationPowerSave.ts，
// 挂载在 src/notifications.ts 的 `powerSave` 那一项依赖（触发源 editorSettings.powerSaveMode
// 由 App.vue 注入，见 docs/wiring-requests-2026-10-06-bucket6b.md）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, nextTick, ref } from 'vue'

import {
  IGNORE_POWER_SAVE_MODE, POWER_SAVE_DISABLE_ACTION, POWER_SAVE_DISPLAY_ID, POWER_SAVE_DO_NOT_SHOW_ACTION,
  POWER_SAVE_GROUP_ID, POWER_SAVE_ON_CONTENT, POWER_SAVE_ON_TITLE, POWER_SAVE_SUSPEND_REASON,
  powerSaveNotice, powerSaveNoticeSuppressed, powerSaveTransition, shouldNotifyPowerSave,
  suppressPowerSaveNotice, unsuppressPowerSaveNotice,
} from '../src/notificationPowerSave.ts'
import { createNotifications } from '../src/notifications.ts'
import { backgroundTaskQueue } from '../src/backgroundTasks.ts'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

/** 让队列的 `pump` 跑到它自己那个 await 上（挂起时它就停在那儿）。 */
const tick = (ms = 0) => new Promise(resolve => { setTimeout(resolve, ms) })

/** 假 localStorage（node 里没有；`storage()` 走的是 `typeof localStorage === 'undefined'` 那一支）。 */
function installStore() {
  const map = new Map()
  globalThis.localStorage = {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
  return map
}

// --- 纯规则 -------------------------------------------------------------------------------

test('只有「开」的那一拍发通知，关的那一拍只收尾', () => {
  // TogglePowerSaveAction.java:22 的 `if (state)` —— 关掉时不发。
  assert.equal(powerSaveTransition(false, true), 'notify')
  assert.equal(powerSaveTransition(true, false), 'expire')
  assert.equal(powerSaveTransition(true, true), null)
  assert.equal(powerSaveTransition(false, false), null)
  // PowerSaveModeNotifier.kt:17-22 的 ProjectActivity：开档启动（previous === null）补发一条。
  assert.equal(powerSaveTransition(null, true), 'notify')
  // 关档启动（previous === null）既不发也不"收"一条不存在的气球。
  assert.equal(powerSaveTransition(null, false), null)
})

test('「不再显示」写的是上游那个键名，命中就不再发', () => {
  const map = installStore()
  try {
    unsuppressPowerSaveNotice()
    assert.equal(powerSaveNoticeSuppressed(), false)
    assert.equal(shouldNotifyPowerSave(true), true)
    suppressPowerSaveNotice()
    assert.equal(map.get(IGNORE_POWER_SAVE_MODE), 'true')
    assert.equal(powerSaveNoticeSuppressed(), true)
    assert.equal(shouldNotifyPowerSave(true), false, '抑制命中时不该发（PowerSaveModeNotifier.kt:30-32）')
    assert.equal(shouldNotifyPowerSave(false), false, '关档本来就不发')
    // 脏值按没存过处理。
    map.set(IGNORE_POWER_SAVE_MODE, 'yes')
    assert.equal(powerSaveNoticeSuppressed(), false)
  } finally { map.clear() }
})

test('通知的两个按钮按上游顺序，没有关闭通道时只给一个', () => {
  const run = () => {}
  const both = powerSaveNotice(run, run)
  assert.deepEqual(both.actions.map(a => a.label), [POWER_SAVE_DO_NOT_SHOW_ACTION, POWER_SAVE_DISABLE_ACTION])
  // 宿主没把关闭通道交过来时不给「禁用省电模式」—— 不画点不动的按钮。
  assert.deepEqual(powerSaveNotice(null, run).actions.map(a => a.label), [POWER_SAVE_DO_NOT_SHOW_ACTION])
  assert.deepEqual(powerSaveNotice(null).actions, [])
  assert.equal(both.message, `${POWER_SAVE_ON_TITLE} ${POWER_SAVE_ON_CONTENT}`)
  assert.equal(both.displayId, POWER_SAVE_DISPLAY_ID, '同一个 displayId 才能顶替旧的（src/notices.ts）')
  assert.equal(both.error, true, 'NotificationType.WARNING（PowerSaveModeNotifier.kt:37）')
  // 队列那一行的挂起原因与通知正文是同一句话：正文说"后台任务已禁用"，界面上就得看得见它被挂起了。
  assert.equal(POWER_SAVE_SUSPEND_REASON, POWER_SAVE_ON_CONTENT)
})

// --- 挂载（真实生产模块：src/notifications.ts）--------------------------------------------

function mount(enabled) {
  const balloon = { value: '' }
  const balloonError = { value: false }
  const balloonAction = { value: null }
  let turnOffCalls = 0
  // 触发源必须是**响应式**的：App.vue 给的是 `editorSettings.value.powerSaveMode`，
  // `watch` 靠这个才跑得动（普通对象它看不见）。
  const state = ref(enabled)
  // `watch(..., { immediate: true })` 会在 createNotifications 里同步跑第一拍，
  // 所以 state 必须在进 scope 之前就建好。
  const scope = effectScope()
  const api = scope.run(() => createNotifications({
    notice: balloon,
    noticeError: balloonError,
    noticeAction: balloonAction,
    powerSave: { enabled: () => state.value, turnOff: () => { turnOffCalls += 1; state.value = false } },
  }))
  return { api, state, balloon, scope, turnOff: () => turnOffCalls }
}

test('开省电：发那条通知（两个按钮）+ 后台任务队列挂起', async () => {
  installStore()
  const { api, state, balloon, scope } = mount(false)
  try {
    assert.equal(api.noticeLog.value.length, 0, '关档启动不该发（previous === null && !on）')
    assert.equal(backgroundTaskQueue.isSuspended(), false)
    state.value = true
    await nextTick()
    const entry = api.noticeLog.value.find(item => item.displayId === POWER_SAVE_DISPLAY_ID)
    assert.ok(entry, '开档没有把通知发进通知中心')
    assert.equal(entry.message, `${POWER_SAVE_ON_TITLE} ${POWER_SAVE_ON_CONTENT}`)
    assert.equal(entry.error, true)
    assert.deepEqual(entry.actions.map(a => a.label), [POWER_SAVE_DO_NOT_SHOW_ACTION, POWER_SAVE_DISABLE_ACTION])
    assert.equal(balloon.value, entry.message, 'BALLOON 组（intellij.platform.ide.impl.xml:1802）要弹气球')
    assert.equal(backgroundTaskQueue.isSuspended(), true, '正文那句「后台任务已禁用」在本仓必须是真的')
    // 挂起之后入队的那条**不该开跑**，并且队列那一行要带上挂起原因
    //（`src/backgroundTasks.ts` 的 `queueRow`，面板画的就是它）。
    let started = false
    void backgroundTaskQueue.run({ title: '排队的活', run: async () => { started = true } })
    await tick(0)
    const row = backgroundTaskQueue.queueRow.value
    assert.ok(row, '挂起期间有任务排队时必须有那一行')
    assert.match(row.detail, new RegExp(POWER_SAVE_SUSPEND_REASON), '队列那一行没有带挂起原因')
    assert.equal(started, false, '挂起期间队列不该开新任务')
    backgroundTaskQueue.clear()
  } finally { scope.stop(); backgroundTaskQueue.setSuspended(null); backgroundTaskQueue.clear() }
})

test('关省电：把那条收掉并恢复队列；「不再显示」按下去之后不再发', async () => {
  const map = installStore()
  const { api, state, scope } = mount(false)
  try {
    state.value = true
    await nextTick()
    assert.equal(api.noticeLog.value.length, 1)
    state.value = false
    await nextTick()
    assert.equal(api.noticeLog.value.length, 0, '模式变化要收掉那条（PowerSaveModeNotifier.kt:52-56）')
    assert.equal(backgroundTaskQueue.isSuspended(), false, '关档必须把队列放回去')

    state.value = true
    await nextTick()
    const entry = api.noticeLog.value.find(item => item.displayId === POWER_SAVE_DISPLAY_ID)
    entry.actions[0].run()   // 「不再显示」= 上游第一个动作（:39-44）
    assert.equal(map.get(IGNORE_POWER_SAVE_MODE), 'true')

    state.value = false
    await nextTick()
    state.value = true
    await nextTick()
    assert.equal(api.noticeLog.value.length, 0, '抑制命中后不该再发（:30-32）')
    assert.equal(backgroundTaskQueue.isSuspended(), true, '抑制的是通知，不是省电档本身')
  } finally { scope.stop(); backgroundTaskQueue.setSuspended(null); backgroundTaskQueue.clear() }
})

test('「禁用省电模式」那个按钮接的是宿主给的关闭通道', async () => {
  installStore()
  const { api, state, scope, turnOff } = mount(false)
  try {
    state.value = true
    await nextTick()
    const entry = api.noticeLog.value.find(item => item.displayId === POWER_SAVE_DISPLAY_ID)
    entry.actions[1].run()
    assert.equal(turnOff(), 1, '按钮没有真的走关闭通道')
    assert.equal(state.value, false)
    await nextTick()
    assert.equal(backgroundTaskQueue.isSuspended(), false)
  } finally { scope.stop(); backgroundTaskQueue.setSuspended(null); backgroundTaskQueue.clear() }
})

test('接线：组表里有 Power Save Mode 这一组，弹法是 BALLOON，displayId 认得它', async () => {
  const { notificationGroup, noticeGroup, showsBalloon } = await import('../src/notificationGroups.ts')
  const group = notificationGroup(POWER_SAVE_GROUP_ID)
  assert.ok(group, '通知组表里没有 Power Save Mode 这一组（intellij.platform.ide.impl.xml:1802）')
  assert.equal(group.displayType, 'BALLOON')
  assert.equal(showsBalloon(group.displayType), true)
  assert.equal(noticeGroup({ displayId: POWER_SAVE_DISPLAY_ID })?.id, POWER_SAVE_GROUP_ID,
    'power.save.mode 这条通知没有归到它上游那个组下面')
  const mountSource = read('../src/notifications.ts')
  assert.match(mountSource, /powerSaveNotice\(/, 'notifications.ts 没有挂省电那一拍')
  assert.match(mountSource, /backgroundTaskQueue\.setSuspended\(/, '省电没有接后台任务队列')
  const panel = read('../src/progressPanel.ts')
  assert.match(panel, /cancelCurrentAndAwait\(\)/, '进度面板的取消没有等任务收尾')
})
