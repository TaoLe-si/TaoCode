// 通知提示音（`NotificationsBeeper`）与按组的「播放声音」开关的判据。
//
// 上游依据：`platform/platform-impl/src/com/intellij/notification/impl/NotificationsBeeper.kt:12-16`
// （那一拍）、`impl/NotificationSettings.kt:30/44-46/75`（按组、默认关、只写 true、
// isSoundEnabled 恒真）、`impl/ui/NotificationSettingsUi.kt:56-65`（设置页那个复选框）、
// `impl/ui/NotificationsPanel.kt:1109-1116`（条目只对**注册过的组**出现，且排在最前、
// 后面跟一条分隔线）、`platform-api/resources/messages/IdeBundle.properties:1346`
// （`notifications.configurable.play.sound=Play sound`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GROUP_SOUND_OFF_LABEL, GROUP_SOUND_ON_LABEL, MAX_SOUND_GROUPS, TONE_BEEP_COUNT, TONE_FREQUENCY_HZ,
  beep, groupPlaysSound, groupSoundToggleLabel, playNotificationSound, setGroupPlaysSound,
  setNotificationTone, soundEnabledGroups,
} from '../src/notificationBeeper.ts'
import { notificationGroup } from '../src/notificationGroups.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** localStorage 的内存实现（node 里没有 window）。 */
function memoryStore() {
  const map = new Map()
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
}

const GRADLE = 'Gradle Notification Group'
const VCS = 'Vcs Notifications'

// --- 按组的开关：默认关，只写 true ----------------------------------------------------------

test('默认不响：isPlaySound 的默认值是 false（NotificationSettings.kt:30）', () => {
  const store = memoryStore()
  assert.equal(groupPlaysSound(GRADLE, store), false)
  assert.deepEqual(soundEnabledGroups(store), [])
})

test('未注册的组拿不到设置，也就没有声音（NotificationsPanel.kt:1109 的 isRegistered）', () => {
  const store = memoryStore()
  // 存都存不进去：上游 getSettings(groupId) 取不到 settings 时压根没有 isPlaySound 可读。
  setGroupPlaysSound('not a registered group', true, store)
  assert.equal(groupPlaysSound('not a registered group', store), false)
  assert.deepEqual(soundEnabledGroups(store), [])
  assert.equal(groupPlaysSound('', store), false)
})

test('打开后按组生效，且与别的组互不影响', () => {
  const store = memoryStore()
  setGroupPlaysSound(GRADLE, true, store)
  setGroupPlaysSound(VCS, true, store)
  assert.equal(groupPlaysSound(GRADLE, store), true)
  assert.equal(groupPlaysSound(VCS, store), true)
  // 只关一个：另一个还在响（设置页就是逐组一个复选框，NotificationSettingsUi.kt:56-65）。
  setGroupPlaysSound(GRADLE, false, store)
  assert.equal(groupPlaysSound(GRADLE, store), false)
  assert.equal(groupPlaysSound(VCS, store), true)
  assert.deepEqual(soundEnabledGroups(store), [VCS])
})

test('关掉的组是「删键」而不是「写 false」（NotificationSettings.kt:44-46 只在打开时写属性）', () => {
  const store = memoryStore()
  setGroupPlaysSound(GRADLE, true, store)
  setGroupPlaysSound(GRADLE, false, store)
  const raw = store.getItem('taocode.notificationPlaySound')
  assert.equal(raw, '{}')
})

test('存坏了一半只认 true：那几条不丢，其余不当成开', () => {
  const store = memoryStore()
  store.setItem('taocode.notificationPlaySound', JSON.stringify({
    [GRADLE]: 'true', [VCS]: true, 'other': 1,
  }))
  assert.equal(groupPlaysSound(GRADLE, store), false)
  assert.equal(groupPlaysSound(VCS, store), true)
  assert.deepEqual(soundEnabledGroups(store), [VCS])
})

test('存的不是对象就当没存过（不整份抛错）', () => {
  const store = memoryStore()
  for (const raw of ['[1,2]', '"x"', 'null']) {
    store.setItem('taocode.notificationPlaySound', raw)
    assert.equal(groupPlaysSound(GRADLE, store), false)
  }
})

test('组数有上限，超出的丢最旧的', () => {
  const store = memoryStore()
  const ids = Array.from({ length: MAX_SOUND_GROUPS + 5 }, (_, i) => `g${i}`)
  // 前面那些 id 没注册过 ⇒ setGroupPlaysSound 会拒（见上面那条），所以直接测存储层的上限。
  const flags = {}
  for (const id of ids) flags[id] = true
  store.setItem('taocode.notificationPlaySound', JSON.stringify(flags))
  assert.equal(soundEnabledGroups(store).length, MAX_SOUND_GROUPS)
})

// --- 发声判定：NotificationsBeeper.kt:12-16 整条 -------------------------------------------------

test('判定 = 组注册过 且 该组开着声音；响了返回 true', () => {
  const store = memoryStore()
  const displayId = 'gradle:sync'   // → Gradle Notification Group（notificationGroups.ts 的前缀表）
  let beeps = 0
  setNotificationTone(() => { beeps += 1 })
  try {
    assert.equal(playNotificationSound({ displayId }, store), false)
    assert.equal(beeps, 0)
    setGroupPlaysSound(GRADLE, true, store)
    assert.equal(playNotificationSound({ displayId }, store), true)
    assert.equal(beeps, 1)
  } finally { setNotificationTone(null) }
})

test('未分组（displayId 认不出来）一律不响', () => {
  const store = memoryStore()
  let beeps = 0
  setNotificationTone(() => { beeps += 1 })
  try {
    assert.equal(playNotificationSound({}, store), false)
    assert.equal(playNotificationSound({ displayId: 'sync.settings' }, store), false)
    assert.equal(beeps, 0)
  } finally { setNotificationTone(null) }
})

test('响不出声不抛错（没有 Web Audio / 被自动播放策略挡着）', () => {
  setNotificationTone(() => { throw new Error('no audio device') })
  try {
    assert.doesNotThrow(() => beep())
  } finally { setNotificationTone(null) }
})

test('默认发声器在 node 里安静返回（globalThis 没有 AudioContext）', () => {
  setNotificationTone(null)
  assert.equal(typeof globalThis.AudioContext, 'undefined')
  assert.doesNotThrow(() => beep())
})

test('默认发声器：两声 880Hz 的短正弦，带起振/落下包络', () => {
  const started = []
  const stopped = []
  const ramps = []
  const connected = { oscToGain: 0, gainToCtx: 0 }
  const param = value => ({
    value,
    setValueAtTime: (v, at) => ramps.push(['set', v, at]),
    linearRampToValueAtTime: (v, at) => ramps.push(['ramp', v, at]),
  })
  let closed = 0
  const Ctx = class {
    state = 'running'
    currentTime = 10
    createOscillator() {
      return {
        frequency: param(TONE_FREQUENCY_HZ), type: 'sine',
        connect: () => { connected.oscToGain += 1 },
        start: at => started.push(at), stop: at => stopped.push(at),
      }
    }
    createGain() {
      return { gain: param(0), connect: () => { connected.gainToCtx += 1 } }
    }
    close() { closed += 1 }
  }
  const scope = globalThis
  scope.AudioContext = Ctx
  setNotificationTone(null)
  try { beep() } finally { delete scope.AudioContext; setNotificationTone(null) }

  assert.equal(started.length, TONE_BEEP_COUNT)
  assert.equal(stopped.length, TONE_BEEP_COUNT)
  // 两声之间要隔开：第二声的起点严格晚于第一声。
  assert.ok(started[1] > started[0])
  assert.equal(connected.oscToGain, TONE_BEEP_COUNT)
  assert.equal(connected.gainToCtx, TONE_BEEP_COUNT)
  // 每声两条斜坡（起振 + 落下）—— 没有斜坡就是直角波，会「咔」。
  assert.equal(ramps.filter(entry => entry[0] === 'ramp').length, TONE_BEEP_COUNT * 2)
  assert.equal(closed, 1)
})

// --- 通知中心那一行 ⋮ 里的条目（NotificationsPanel.kt:1109-1116）-------------------------------

test('注册过的组才给声音条目，label 随开关状态变', () => {
  const store = memoryStore()
  const displayId = 'gradle:sync'
  assert.equal(groupSoundToggleLabel({ displayId }, store), GROUP_SOUND_ON_LABEL)
  setGroupPlaysSound(GRADLE, true, store)
  assert.equal(groupSoundToggleLabel({ displayId }, store), GROUP_SOUND_OFF_LABEL)
})

test('未分组的行没有这个条目（同上游 isRegistered 那道门）', () => {
  const store = memoryStore()
  assert.equal(groupSoundToggleLabel({}, store), undefined)
  assert.equal(groupSoundToggleLabel({ displayId: 'sync.settings' }, store), undefined)
})

// --- 接线：响的那一拍真的落在 notify 链上 -----------------------------------------------------

test('接线：notifications.ts 的 notify 会走发声判定', () => {
  const source = readFileSync(join(root, 'src/notifications.ts'), 'utf8')
  assert.match(source, /import \{ playNotificationSound \} from '\.\/notificationBeeper\.ts'/)
  // 落在「不再显示」的判定之后、气球/状态栏那一段之后 —— 被抑制的通知不响。
  const guard = source.indexOf('if (!canShowNotice(')
  const beepAt = source.indexOf('playNotificationSound(entry)')
  assert.ok(guard >= 0 && beepAt > guard, '发声判定必须在 canShowNotice 之后')
})

test('接线：通知中心的 ⋮ 菜单接上了那个开关（EventLogPanel）', () => {
  const source = readFileSync(join(root, 'src/components/EventLogPanel.vue'), 'utf8')
  assert.match(source, /setGroupPlaysSound/)
  assert.match(source, /groupSoundToggleLabel/)
  // 上游：设置项排最前、后面跟一条分隔线（NotificationsPanel.kt:1110 / :1115）。
  assert.match(source, /return sound \? \[sound, \.\.\.rest\] : rest/)
  assert.match(source, /index === 1 && hasGroupSound\(entry\)/)
})

test('模块头引用的上游文件都在判据里出现过的地方', () => {
  const source = readFileSync(join(root, 'src/notificationBeeper.ts'), 'utf8')
  assert.match(source, /NotificationsBeeper\.kt:12-16/)
  assert.match(source, /NotificationSettings\.kt:30/)
  assert.match(source, /NotificationsPanel\.kt:1109/)
  // 每个注册过的组都能被查到设置（上游 getSettings 认的是 group id，不是 displayId）。
  assert.equal(notificationGroup(GRADLE)?.displayType, 'STICKY_BALLOON')
})
