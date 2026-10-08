// `pv/notification` 的 `NotificationSettings.isShouldLog` 门控判据。
// 上游坐标写在 src/notificationLogSetting.ts 的模块头；本文件只核行为形状与真实消费链路。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  GROUP_LOG_OFF_LABEL, GROUP_LOG_ON_LABEL, groupLogsByDefault, groupLogToggleLabel,
  groupShouldLog, overriddenLogGroups, setGroupShouldLog, shouldLogNotice,
} from '../src/notificationLogSetting.ts'

/** localStorage 的内存实现（node 里没有 window）。 */
function memoryStore() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
  }
}

// info/trace 那一组在上游 XML 里是 isLogByDefault="false"（src/notificationGroups.ts:65）。
const INFO_TRACE = 'LSP window/logMessage: info, log; $/logTrace'
// showMessage 那一组是 BALLOON + isLogByDefault=true。
const SHOW_MESSAGE = 'LSP window/showMessage'

test('默认档取注册项的 isLogByDefault；未注册/未分组一律 true（照旧进日志）', () => {
  assert.equal(groupLogsByDefault(INFO_TRACE), false, 'info/trace 组上游就是 isLogByDefault=false')
  assert.equal(groupLogsByDefault(SHOW_MESSAGE), true)
  assert.equal(groupShouldLog(INFO_TRACE, memoryStore()), false, '没覆盖时取默认')
  assert.equal(groupShouldLog('不存在的组', memoryStore()), true, '未注册的组拿不到设置 ⇒ 保持旧行为')
  assert.equal(shouldLogNotice(undefined, memoryStore()), true, '未分组没有设置 ⇒ 进日志')
  assert.equal(shouldLogNotice('', memoryStore()), true)
})

test('用户覆盖优先于默认，且与默认相同就把覆盖删掉（回到默认）', () => {
  const store = memoryStore()
  setGroupShouldLog(INFO_TRACE, true, store)
  assert.equal(groupShouldLog(INFO_TRACE, store), true, '显式打开')
  assert.deepEqual(overriddenLogGroups(store), [INFO_TRACE], '偏离默认的组被记下')
  setGroupShouldLog(INFO_TRACE, false, store)
  assert.equal(groupShouldLog(INFO_TRACE, store), false, '回到默认')
  assert.deepEqual(overriddenLogGroups(store), [], '与默认相同 = 删掉覆盖，不落多余键')
  // 未注册的组不给设置（上游 isRegistered 那道门），写不进去。
  setGroupShouldLog('不存在的组', false, store)
  assert.deepEqual(overriddenLogGroups(store), [])
})

test('行菜单标签随开关变，未注册组不给这一格', () => {
  const store = memoryStore()
  assert.equal(groupLogToggleLabel(INFO_TRACE, store), GROUP_LOG_ON_LABEL, '默认不写日志 ⇒ 菜单给「写入」')
  setGroupShouldLog(INFO_TRACE, true, store)
  assert.equal(groupLogToggleLabel(INFO_TRACE, store), GROUP_LOG_OFF_LABEL)
  assert.equal(groupLogToggleLabel('不存在的组', store), undefined, '未注册组不画这一格')
  assert.equal(groupLogToggleLabel(undefined, store), undefined)
})

test('损坏的存储被读成空覆盖表，不抛错', () => {
  const store = memoryStore()
  store.setItem('taocode.notificationShouldLog', '{ not json')
  assert.deepEqual(overriddenLogGroups(store), [])
  assert.equal(groupShouldLog(INFO_TRACE, store), false, '读不出覆盖就回到默认')
  store.setItem('taocode.notificationShouldLog', JSON.stringify({ [INFO_TRACE]: 'yes', [SHOW_MESSAGE]: false }))
  assert.deepEqual(overriddenLogGroups(store), [SHOW_MESSAGE], '只认布尔值')
})

test('接线门禁：notify/notifyProgress 都过了 shouldLogNotice，且面板有真开关', () => {
  const notifications = readFileSync('src/notifications.ts', 'utf8')
  assert.match(notifications, /import \{ shouldLogNotice \} from '\.\/notificationLogSetting\.ts'/)
  assert.match(notifications, /if \(shouldLogNotice\(noticeGroupId\(entry\)\)\) noticeLog\.value = pushNotice/,
    '普通通知在 pushNotice 之前过门控')
  assert.match(notifications, /if \(!shouldLogNotice\(noticeGroupId\(entry\)\)\) return/,
    '进度型通知（notifyProgress）同样过门控')
  const panel = readFileSync('src/components/EventLogPanel.vue', 'utf8')
  assert.match(panel, /from '\.\.\/notificationLogSetting'/)
  assert.match(panel, /setGroupShouldLog\(groupId, !groupShouldLog\(groupId\)\)/, '面板行菜单是真开关')
  assert.ok(!/taocode\.notificationShouldLog/.test(panel), '存储键只在模块里，组件不硬编码')
})