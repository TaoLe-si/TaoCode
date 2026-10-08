// 「明天提醒我」的**运行中**到点调度 + 「不再询问通知」那张分层清单。
//
// 上游出处（全部是本仓实测的行号）：
//   · `platform/platform-impl/src/com/intellij/notification/impl/RemindLaterManager.kt`
//     - `addSimpleNotification:59-67`：存下记录之后**立刻** `schedule(element, delay)`；
//     - `schedule:115-117`：`AppExecutorUtil.getAppScheduledExecutorService().schedule({ execute(element) }, delay, MILLISECONDS)`
//       —— 应用开着到点就响，不是等下次启动；
//     - `initializeComponent:177-212`：启动时把存着的每条走一遍，`delay > 0` 继续等、否则立刻 `execute`；
//     - `execute:119-171`：先把那条记录从存储里摘掉（`:120`），再重新 notify 一遍。
//   · `platform/platform-impl/src/com/intellij/notification/impl/ui/DoNotAskConfigurableUi.kt`
//     - `getDoNotAskValues:33-51`：应用级 + 项目级两张表合成一列，**按 id 排序**；
//     - `:28`：项目级那条显示成 `name + " (此项目)"`（`notifications.configurable.do.not.ask.project.title`）；
//     - `createComponent:63-70`：工具条**只挂移除**一个动作（`disableUpDownActions()` 关掉上下移动）；
//     - `apply:100-113`：移除 = 按那条来自哪一层调那一层的 `clearDoNotAsk(id)`。
//   · 中文取值取自 `D:\IntelliJ IDEA 2026.2\plugins\localization-zh\lib\localization-zh.jar`
//     里的 `messages/IdeBundle.properties:1710-1720`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  DO_NOT_ASK_EMPTY, DO_NOT_ASK_LIST_ACCESSIBLE_NAME, DO_NOT_ASK_LIST_TITLE, DO_NOT_ASK_PROJECT_TITLE,
  armRemindLater, clearDoNotAskInfo, doNotAskDisplayName, doNotAskInfos, isDoNotAskFor,
  registerRemindLaterRearm, REMIND_LATER_DELAY_MS, scheduleRemindLater,
} from '../src/notificationDoNotAsk.ts'

const root = process.cwd()

/** 假 localStorage（node 里没有真的）。 */
function fakeStore() {
  const map = new Map()
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
}

/** 假定时器：记录排了多少毫秒，手动 `run` 落地。 */
function fakeClock(start = 1_700_000_000_000) {
  let now = start
  const timers = []
  return {
    now: () => now,
    advance: ms => { now += ms },
    at: () => now,
    schedule: (run, delayMs) => {
      const timer = { run, delayMs, firesAt: now + delayMs, cancelled: false }
      timers.push(timer)
      return () => { timer.cancelled = true }
    },
    timers,
    fireNext: () => { const next = timers.find(t => !t.cancelled); if (!next) return false; next.cancelled = true; next.run(); return true },
  }
}

test('到点的记录在启动那一拍立刻补发（initializeComponent 的 delay <= 0 分支）', () => {
  const store = fakeStore()
  const clock = fakeClock()
  // 直接塞一条"昨天就该响"的记录。
  store.setItem('taocode.remindLater', JSON.stringify([{ time: clock.now() - 1000, message: '该同步了', error: false, suggestion: true }]))
  const fired = []
  const cancel = armRemindLater({ onDue: records => fired.push(...records.map(r => r.message)), now: clock.now, schedule: clock.schedule, store })
  assert.deepEqual(fired, ['该同步了'], '到点的不用等定时器')
  assert.equal(clock.timers.length, 0, '补完就没有待定的了')
  assert.equal(store.getItem('taocode.remindLater'), '[]', '发完把记录摘掉（execute 的第一句）')
  cancel()
})

test('未到点的按最早那条排定时，应用开着到点就响（schedule(element, delay)）', () => {
  const store = fakeStore()
  const clock = fakeClock()
  const fired = []
  const cancel = armRemindLater({
    onDue: records => fired.push(...records.map(r => r.message)),
    now: clock.now, schedule: clock.schedule, store,
  })
  // 点「明天提醒我」：延迟固定 1 天（`NotificationsPanel.kt:1119` 的 `1.days`）。
  scheduleRemindLater({ message: '记得回来看不', error: false }, clock.now(), store)
  assert.equal(clock.timers.length, 1, '新排一条就把定时器换到新时刻')
  assert.equal(clock.timers[0].delayMs, REMIND_LATER_DELAY_MS, '间隔 = 1 天')
  assert.deepEqual(fired, [], '还没到点不该响')
  clock.advance(REMIND_LATER_DELAY_MS)
  assert.equal(clock.fireNext(), true)
  assert.deepEqual(fired, ['记得回来看不'], '本次运行内到点就会响（这是之前缺的那半条链）')
  cancel()
})

test('好几条待定排期时按最早的那条定时', () => {
  const store = fakeStore()
  const clock = fakeClock()
  const cancel = armRemindLater({ onDue: () => {}, now: clock.now, schedule: clock.schedule, store })
  scheduleRemindLater({ message: 'A', displayId: 'a' }, clock.now() - REMIND_LATER_DELAY_MS + 3_600_000, store)
  scheduleRemindLater({ message: 'B', displayId: 'b' }, clock.now() - REMIND_LATER_DELAY_MS + 60_000, store)
  assert.equal(clock.timers.at(-1).delayMs, 60_000, '60 秒后那条先到点')
  cancel()
})

test('cancel() 之后不再有定时器落地', () => {
  const store = fakeStore()
  const clock = fakeClock()
  const fired = []
  const cancel = armRemindLater({ onDue: r => fired.push(...r), now: clock.now, schedule: clock.schedule, store })
  scheduleRemindLater({ message: 'C', error: false }, clock.now(), store)
  cancel()
  assert.equal(clock.timers.at(-1).cancelled, true, '注销时撤掉待定定时器')
  clock.advance(REMIND_LATER_DELAY_MS)
  assert.equal(fired.length, 0)
})

test('registerRemindLaterRearm：宿主没注册时排期也不炸', () => {
  const store = fakeStore()
  registerRemindLaterRearm(null)
  const clock = fakeClock()
  assert.doesNotThrow(() => scheduleRemindLater({ message: 'D', error: false }, clock.now(), store))
})

// --- 「不再询问通知」那张清单 -------------------------------------------------------------------

test('清单分层：应用级 + 项目级，按 id 排序，项目级带（此项目）后缀', () => {
  const store = fakeStore()
  const project = 'D:/proj'
  scheduleNothing(store)
  // 手写两张表，绕开上限丢最旧那段逻辑（那是另一条判据管的）。
  store.setItem('taocode.doNotAsk', JSON.stringify({ 'vcs.commit': '提交结果', 'zeta.last': 'Zeta 更新' }))
  store.setItem('taocode.doNotAsk:D:/proj', JSON.stringify({ 'gradle:sync': 'Gradle 同步' }))
  const rows = doNotAskInfos(project, store)
  assert.deepEqual(rows.map(row => row.id), ['gradle:sync', 'vcs.commit', 'zeta.last'], '按 id 排序（getDoNotAskValues 的 sortedBy(id)）')
  assert.deepEqual(rows.map(row => row.forProject), [true, false, false])
  assert.equal(doNotAskDisplayName(rows[0]), `Gradle 同步 (${DO_NOT_ASK_PROJECT_TITLE})`)
  assert.equal(doNotAskDisplayName(rows[1]), '提交结果')
})

function scheduleNothing(store) { store.setItem('taocode.remindLater', '[]') }

test('移除只清它自己那一层（apply 里按 forProject 分派）', () => {
  const store = fakeStore()
  const project = 'D:/proj'
  store.setItem('taocode.doNotAsk', JSON.stringify({ 'vcs.commit': '提交结果' }))
  store.setItem('taocode.doNotAsk:D:/proj', JSON.stringify({ 'gradle:sync': 'Gradle 同步' }))
  clearDoNotAskInfo({ id: 'gradle:sync', name: 'Gradle 同步', forProject: true }, project, store)
  assert.equal(isDoNotAskFor('gradle:sync', project, store), false, '项目级那条被解掉了')
  assert.equal(isDoNotAskFor('vcs.commit', project, store), true, '应用级那条不受影响')
  clearDoNotAskInfo({ id: 'vcs.commit', name: '提交结果', forProject: false }, project, store)
  assert.equal(isDoNotAskFor('vcs.commit', project, store), false)
})

test('文案抄中文包取值（不再询问通知: / 此项目 / 未配置通知）', () => {
  assert.equal(DO_NOT_ASK_LIST_TITLE, '不再询问通知:')
  assert.equal(DO_NOT_ASK_LIST_ACCESSIBLE_NAME, '不再询问通知')
  assert.equal(DO_NOT_ASK_PROJECT_TITLE, '此项目')
  assert.equal(DO_NOT_ASK_EMPTY, '未配置通知')
})

test('接线：清单挂在通知工具窗口，移除按钮是真动作', () => {
  const panel = readFileSync(join(root, 'src/components/EventLogPanel.vue'), 'utf8')
  assert.match(panel, /doNotAskInfos\(props\.root\)/, '清单没读那张分层表')
  assert.match(panel, /clearDoNotAskInfo\(info, props\.root\)/, '移除按钮没接解除抑制')
  assert.match(panel, /:aria-label="`\$\{DO_NOT_ASK_LIST_ACCESSIBLE_NAME\}（\$\{suppressed\.length\}）`"/, '开关缺可及名')
  // 装饰性图标（外层按钮已有 aria-label）走 lucide + iconSize 阶梯，并由可及性 lane 统一加 aria-hidden。
  assert.match(panel, /<BellOff aria-hidden="true" :size="iconSize\.menu" \/>/, '图标走 lucide + iconSize 阶梯')
})

test('接线：通知宿主把项目根喂进抑制判定（不然「不再为此项目显示」点了没用）', () => {
  const host = readFileSync(join(root, 'src/notifications.ts'), 'utf8')
  assert.match(host, /if \(!canShowNotice\(\{ message, displayId \}, root\)\) return/, 'notify 查了项目级那张表')
  assert.match(host, /canShowNotice\(entry, projectRoot\(\)\)/, '进度型通知同样要查')
  assert.match(host, /armRemindLater\(\{/, '运行中的到点调度没装上')
  assert.match(host, /onScopeDispose\(cancelRemindLaterAlarm\)/, '定时器没有随作用域撤掉')
})
