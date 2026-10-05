// `src/autoImportNotifications.ts` 的判据：外部系统「项目已更改，是否同步」通知的状态机。
//
// 上游依据（`AutoImportProjectTracker.kt` 的 processChanges 分支 + `AutoImportProjectNotificationAware`
// + `HideProjectRefreshAction`/`ProjectRefreshAction`）：
//   · 项目不是最新、且自动重载被禁用 → `notificationNotify`（挂通知，不是静默跳过）；
//   · 重载被排上 / 项目回到最新 → `notificationExpire(projectId)`；
//   · 「隐藏此通知」= `notificationExpire()` 无参（整条收掉），下一次外部更改再出现；
//   · 「Sync Changes」= `ProjectRefreshAction.Manager.refreshProject`（显式重载）。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTO_IMPORT_HIDE_LABEL, AUTO_IMPORT_SYNC_LABEL,
  autoImportNotice, autoImportVisible, createAutoImportNotifier, expireAllAutoImport, expireAutoImport,
  notifyAutoImport,
} from '../src/autoImportNotifications.ts'

test('登记是去重的、顺序稳定的；撤销只撤一个系统', () => {
  let state = notifyAutoImport({ systems: [] }, 'Gradle')
  assert.deepEqual(state.systems, ['Gradle'])
  state = notifyAutoImport(state, 'Gradle')
  assert.deepEqual(state.systems, ['Gradle'], '同一个系统重复登记不产生第二条')
  state = notifyAutoImport(state, 'Maven')
  assert.deepEqual(state.systems, ['Gradle', 'Maven'])
  state = expireAutoImport(state, 'Gradle')
  assert.deepEqual(state.systems, ['Maven'])
  assert.equal(autoImportVisible(state), true)
  assert.equal(autoImportVisible(state, 'Gradle'), false)
  assert.equal(autoImportVisible(state, 'Maven'), true)
  assert.deepEqual(expireAllAutoImport(), { systems: [] })
  assert.equal(autoImportVisible(expireAllAutoImport()), false)
})

test('通知的文案与按钮对齐上游 bundle（Sync {0} Changes / Hide This Notification）', () => {
  const payload = autoImportNotice(['Gradle', 'Maven'], () => {}, () => {})
  assert.ok(payload)
  assert.equal(payload.error, false)
  assert.equal(payload.displayId, 'external-system:reload:Gradle')
  assert.match(payload.message, /Gradle、Maven 项目结构已更改/)
  assert.equal(payload.detail.length, 1)
  assert.deepEqual(payload.actions.map(action => action.label), [AUTO_IMPORT_SYNC_LABEL, AUTO_IMPORT_HIDE_LABEL])
  // 没有待同步系统就没有通知（上游 isNotificationVisible ⇔ 集合非空）。
  assert.equal(autoImportNotice([], () => {}, () => {}), null)
})

test('宿主：登记即出通知；同一系统再次登记不重复弹', () => {
  const calls = []
  let reloads = 0
  const notifier = createAutoImportNotifier({ notify: (...args) => calls.push(args), reload: () => { reloads += 1 } })
  notifier.invalidate('Gradle')
  assert.equal(calls.length, 1)
  assert.deepEqual(notifier.systems(), ['Gradle'])
  notifier.invalidate('Gradle')
  assert.equal(calls.length, 1, '同一个系统还在待同步时不重复弹（上游集合语义）')
  notifier.invalidate('Maven')
  assert.equal(calls.length, 2, '新增系统要刷新那一条通知')
  assert.match(calls[1][0], /Gradle、Maven/)
})

test('通知文案用 readableName、displayId 用系统 id（名字换中文也还是同一条）', () => {
  const calls = []
  const notifier = createAutoImportNotifier({ notify: (...args) => calls.push(args), reload: () => {} })
  notifier.invalidate('GRADLE', 'Gradle')
  assert.match(calls[0][0], /^Gradle 项目结构已更改/)
  assert.equal(calls[0][4], 'external-system:reload:GRADLE', 'displayId 不跟显示名走')
  assert.deepEqual(notifier.systems(), ['GRADLE'])
})

test('「隐藏此通知」收掉整条，下一次外部更改重新出现', () => {
  const calls = []
  const notifier = createAutoImportNotifier({ notify: (...args) => calls.push(args), reload: () => {} })
  notifier.invalidate('Gradle')
  const hide = calls[0][5][1]
  hide.run()
  assert.equal(notifier.visible(), false, '隐藏 = notificationExpire() 无参')
  assert.deepEqual(notifier.systems(), [])
  notifier.invalidate('Gradle')
  assert.equal(calls.length, 2, '下一次更改必须重新弹（隐藏不是永久抑制）')
})

test('「同步更改」清状态并触发显式重载；expire 只撤一个系统；reset 随项目清空', () => {
  const calls = []
  let reloads = 0
  const notifier = createAutoImportNotifier({ notify: (...args) => calls.push(args), reload: () => { reloads += 1 } })
  notifier.invalidate('Gradle')
  calls[0][5][0].run()
  assert.equal(reloads, 1, 'Sync Changes 走 reload（上游 scheduleProjectRefresh）')
  assert.equal(notifier.visible(), false)

  notifier.invalidate('Gradle')
  notifier.invalidate('Maven')
  notifier.expire('Gradle')
  assert.deepEqual(notifier.systems(), ['Maven'])
  notifier.reset()
  assert.deepEqual(notifier.systems(), [])
})
