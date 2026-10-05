// 通知组（NotificationGroup / NotificationGroupManager / NotificationGroupEP）与
// 「不再显示 / 明天提醒我」（DoNotAskManager / RemindLaterManager）的判据。
//
// 每条断言都指回上游的一行，见断言旁的 file:line。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NOTIFICATION_GROUPS, balloonFadeoutMs, configureDoNotAskOption, noticeGroup, noticeGroupId,
  notificationGroup, notificationGroupTitle, showsBalloon,
} from '../src/notificationGroups.ts'
import {
  MAX_DO_NOT_ASK, REMIND_LATER_DELAY_MS, canRemindLater, canShowNotice, clearAllDoNotAsk, clearDoNotAsk,
  doNotAskNotifications, dueRemindLater, isDoNotAskFor, markDoNotAsk, pendingRemindLater,
  scheduleRemindLater, takeDueRemindLater,
} from '../src/notificationDoNotAsk.ts'
import {
  EVENT_LOG_CLEAR_ALL_LABEL, EVENT_LOG_DO_NOT_ASK_LABEL, EVENT_LOG_DO_NOT_ASK_PROJECT_LABEL,
  EVENT_LOG_MORE_TITLE, EVENT_LOG_REMIND_LABEL, EVENT_LOG_SUGGESTIONS_TITLE, EVENT_LOG_TIMELINE_TITLE,
  doNotAskIdOf, eventLogRowMenu, eventLogSections, matchesNoticeQuery,
} from '../src/notificationEventLog.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** localStorage 的内存实现（node 里没有 window）。 */
function memoryStore() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
}

const entry = (id, extra = {}) => ({ id, message: `m${id}`, error: false, at: '00:00:00', ...extra })

// --- 通知组注册表 ----------------------------------------------------------------------------

// NotificationGroup.kt:18-23「a group ID is enough」+ 各家的 <notificationGroup> 注册行。
test('每条通知组都能查到注册项，未知 id 查不到（上游不给未注册组造默认项）', () => {
  for (const group of NOTIFICATION_GROUPS) assert.equal(notificationGroup(group.id), group)
  assert.equal(notificationGroup('Nope group'), undefined)
  // 表格自身不许有重 id（`NotificationGroup.kt:71-72` 的重复注册会打日志）。
  assert.equal(new Set(NOTIFICATION_GROUPS.map(group => group.id)).size, NOTIFICATION_GROUPS.length)
})

// NotificationsManagerImpl.kt:449 —— BALLOON 10s / STICKY_BALLOON 300s；NONE/TOOL_WINDOW 不弹。
test('displayType 决定弹不弹气球与淡出延时', () => {
  assert.equal(balloonFadeoutMs('BALLOON'), 10000)
  assert.equal(balloonFadeoutMs('STICKY_BALLOON'), 300000)
  assert.equal(balloonFadeoutMs('NONE'), undefined)
  assert.equal(balloonFadeoutMs('TOOL_WINDOW'), undefined)
  assert.equal(showsBalloon('BALLOON'), true)
  assert.equal(showsBalloon('STICKY_BALLOON'), true)
  assert.equal(showsBalloon('NONE'), false)
  assert.equal(showsBalloon('TOOL_WINDOW'), false)
})

// intellij.platform.lsp.impl.xml:48-59 / intellij.gradle.xml:309 / VcsExtensions.xml:320-323
// 逐条核注册项的 displayType 与 isLogByDefault（这些就是上游 XML 里的字面量）。
test('注册表逐条对上上游 XML 的 displayType / isLogByDefault', () => {
  const at = id => notificationGroup(id)
  assert.equal(at('LSP window/showMessage').displayType, 'BALLOON')
  assert.equal(at('LSP window/logMessage: errors, warnings').displayType, 'NONE')
  assert.equal(at('LSP window/logMessage: errors, warnings').isLogByDefault, true)
  assert.equal(at('LSP window/logMessage: info, log; $/logTrace').isLogByDefault, false)
  assert.equal(at('Gradle Notification Group').displayType, 'STICKY_BALLOON')
  assert.equal(at('Vcs Messages').displayType, 'TOOL_WINDOW')
  assert.equal(at('Vcs Messages').toolWindowId, 'Version Control')
  assert.equal(at('Vcs Important Notifications').displayType, 'STICKY_BALLOON')
  assert.equal(at('Vcs Silent Notifications').displayType, 'NONE')
})

test('组标题是中文包里的取值，取不到时退回组 id 自己（Notification.java:210-215）', () => {
  assert.equal(notificationGroupTitle('LSP window/showMessage'), 'LSP 消息')
  assert.equal(notificationGroupTitle('Gradle Notification Group'), 'Gradle')
  assert.equal(notificationGroupTitle('Vcs Notifications'), 'VCS 通知')
  assert.equal(notificationGroupTitle('未知组'), '未知组')
})

// 本仓四个报出点的 displayId → 组（progressNotices.ts / commitNotification.ts）。
test('本仓报得出的 displayId 都能落到组上，其余算未分组', () => {
  assert.equal(noticeGroupId(entry(1, { displayId: 'lsp:message:java' })), 'LSP window/showMessage')
  assert.equal(noticeGroupId(entry(1, { displayId: 'lsp:log:java' })), 'LSP window/logMessage: errors, warnings')
  assert.equal(noticeGroupId(entry(1, { displayId: 'gradle:sync' })), 'Gradle Notification Group')
  assert.equal(noticeGroupId(entry(1, { displayId: 'vcs.commit' })), 'Vcs Notifications')
  // 自动导入的 displayId 找不到上游注册项 ⇒ 不编一个组。
  assert.equal(noticeGroupId(entry(1, { displayId: 'external-system:reload:gradle' })), undefined)
  assert.equal(noticeGroupId(entry(1)), undefined)
  assert.equal(noticeGroup(entry(1, { displayId: 'lsp:log:java' })).title, 'LSP 日志: 错误、警告')
})

// Notification.java:204-217 configureDoNotAskOption 的两支。
test('「不再显示」记哪个 id：先 displayId，没有才用组 id', () => {
  assert.deepEqual(configureDoNotAskOption({ message: '编译失败', displayId: 'vcs.commit' }), { id: 'vcs.commit', displayName: '编译失败' })
  assert.deepEqual(configureDoNotAskOption({ message: '出错' }, 'Gradle Notification Group'),
    { id: 'Gradle Notification Group', displayName: 'Gradle' })
  assert.equal(configureDoNotAskOption({ message: '孤立通知' }), undefined)
})

// --- DoNotAskManager --------------------------------------------------------------------------

test('「不再显示」分应用级与项目级两张表，判定是二者之一命中', () => {
  const store = memoryStore()
  markDoNotAsk('vcs.commit', '提交失败', false, 'D:/proj', store)
  assert.equal(isDoNotAskFor('vcs.commit', 'D:/other', store), true, '应用级对所有项目生效')
  markDoNotAsk('lsp:log:java', '日志', true, 'D:/proj', store)
  assert.equal(isDoNotAskFor('lsp:log:java', 'D:/proj', store), true)
  assert.equal(isDoNotAskFor('lsp:log:java', 'D:/other', store), false, '项目级只对这个项目生效')
  assert.equal(isDoNotAskFor('', 'D:/proj', store), false)
})

test('抑制表里查得到 id → 那条通知根本不发（canShowFor），不是发了再藏', () => {
  const store = memoryStore()
  const notice = { message: '提交失败', displayId: 'vcs.commit' }
  assert.equal(canShowNotice(notice, 'D:/proj', store), true)
  markDoNotAsk('vcs.commit', '提交失败', false, '', store)
  assert.equal(canShowNotice(notice, 'D:/proj', store), false)
  // 没有 displayId 的孤立通知永远可显示（`configureDoNotAskOption` 返回 null）。
  assert.equal(canShowNotice({ message: '孤立通知' }, 'D:/proj', store), true)
})

test('清除抑制：按 id 清两张表，清空清整个项目', () => {
  const store = memoryStore()
  markDoNotAsk('a', 'A', false, 'D:/proj', store)
  markDoNotAsk('a', 'A', true, 'D:/proj', store)
  assert.equal(isDoNotAskFor('a', 'D:/proj', store), true)
  clearDoNotAsk('a', 'D:/proj', store)
  assert.equal(isDoNotAskFor('a', 'D:/proj', store), false)
  markDoNotAsk('b', 'B', true, 'D:/proj', store)
  clearAllDoNotAsk('D:/proj', store)
  assert.deepEqual([...doNotAskNotifications('D:/proj', store).keys()], [])
})

test('两张表合成一张 id → 显示名（DoNotAskManager.getDoNotAskNotifications），项目级优先', () => {
  const store = memoryStore()
  markDoNotAsk('app-only', '应用级名字', false, 'D:/proj', store)
  markDoNotAsk('both', '项目级名字', true, 'D:/proj', store)
  markDoNotAsk('both', '应用级名字', false, 'D:/proj', store)
  const merged = doNotAskNotifications('D:/proj', store)
  assert.equal(merged.get('app-only'), '应用级名字')
  assert.equal(merged.get('both'), '项目级名字')
})

test('抑制表有上限，写满了丢最旧的（别把 localStorage 塞爆）', () => {
  const store = memoryStore()
  for (let index = 0; index < MAX_DO_NOT_ASK + 5; index += 1) markDoNotAsk(`id${index}`, `n${index}`, false, '', store)
  const all = doNotAskNotifications('', store)
  assert.equal(all.size, MAX_DO_NOT_ASK)
  assert.equal(all.has('id0'), false)
  assert.equal(all.has(`id${MAX_DO_NOT_ASK + 4}`), true)
})

// --- RemindLaterManager -----------------------------------------------------------------------

// NotificationsPanel.kt:1119 的 `1.days`；RemindLaterManager.kt:37-40 的"没有动作才给这个条目"。
test('「明天提醒我」只给建议类且没有动作的通知', () => {
  assert.equal(REMIND_LATER_DELAY_MS, 24 * 60 * 60 * 1000)
  const plain = entry(1)
  assert.equal(canRemindLater(plain, true), true)
  assert.equal(canRemindLater(plain, false), false, '非 suggestion 类型没有这个条目')
  assert.equal(canRemindLater(entry(1, { actions: [{ label: '同步更改', run() {} }] }), true), false)
})

test('排期到点才取出，取出即从存储里删掉（execute:119-121 的 removeContent）', () => {
  const store = memoryStore()
  const now = 1_700_000_000_000
  const record = scheduleRemindLater(entry(1, { displayId: 'vcs.commit' }), now, store)
  assert.equal(record.time, now + REMIND_LATER_DELAY_MS)
  assert.equal(pendingRemindLater(now, store).length, 1)
  assert.equal(dueRemindLater(now, store).length, 0)
  assert.equal(dueRemindLater(now + REMIND_LATER_DELAY_MS, store).length, 1)
  assert.equal(takeDueRemindLater(now + REMIND_LATER_DELAY_MS, store).length, 1)
  assert.equal(pendingRemindLater(now + REMIND_LATER_DELAY_MS, store).length, 0)
})

test('同一个 displayId 反复排期只留最新的一条', () => {
  const store = memoryStore()
  const now = 1_700_000_000_000
  scheduleRemindLater(entry(1, { displayId: 'gradle:sync' }), now, store)
  scheduleRemindLater(entry(2, { displayId: 'gradle:sync' }), now + 1000, store)
  const pending = pendingRemindLater(now, store)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].message, 'm2')
  assert.equal(pending[0].time, now + 1000 + REMIND_LATER_DELAY_MS)
})

// --- 通知中心的两段与 ⋮ 菜单 ---------------------------------------------------------------------

test('两段标题与那三个动作的文案逐条等于中文包取值', () => {
  assert.equal(EVENT_LOG_SUGGESTIONS_TITLE, '建议')
  assert.equal(EVENT_LOG_TIMELINE_TITLE, '时间线')
  assert.equal(EVENT_LOG_CLEAR_ALL_LABEL, '全部清除')
  assert.equal(EVENT_LOG_REMIND_LABEL, '明天提醒我')
  assert.equal(EVENT_LOG_DO_NOT_ASK_PROJECT_LABEL, '不再为此项目显示')
  assert.equal(EVENT_LOG_DO_NOT_ASK_LABEL, '不再显示')
  assert.equal(EVENT_LOG_MORE_TITLE, '关闭或更改行为')
})

// NotificationsPanel.kt:538-613：两个 NotificationGroupComponent，空段不画。
test('空段不画；建议与时间线分开，顺序保持前插', () => {
  assert.deepEqual(eventLogSections([]), [])
  assert.deepEqual(eventLogSections([entry(1)]).map(section => section.id), ['timeline'])
  const mixed = eventLogSections([entry(1), entry(2, { suggestion: true }), entry(3)])
  assert.deepEqual(mixed.map(section => section.id), ['suggestions', 'timeline'])
  assert.deepEqual(mixed[0].entries.map(item => item.id), [2])
  assert.deepEqual(mixed[1].entries.map(item => item.id), [1, 3])
})

// NotificationComponent.matchQuery:1347-1364（大小写无关子串，看正文/明细/动作文字）。
test('搜索是正文、明细、动作文字上的大小写无关子串', () => {
  const row = entry(1, { detail: ['第一行明细'], actions: [{ label: '复制日志', run() {} }] })
  assert.equal(matchesNoticeQuery(row, 'm1'), true)
  assert.equal(matchesNoticeQuery(row, '明细'), true)
  assert.equal(matchesNoticeQuery(row, '复制'), true)
  assert.equal(matchesNoticeQuery(row, '不存在'), false)
  assert.equal(matchesNoticeQuery(row, '  '), true, '空查询全中')
  assert.deepEqual(eventLogSections([row], '明细').flatMap(section => section.entries.map(item => item.id)), [1])
  assert.deepEqual(eventLogSections([row], '不存在'), [])
})

// NotificationsPanel.kt:1106-1143 的 ⋮ 菜单顺序与条件。
test('⋮ 菜单按上游顺序给条目，缺落点的那几项不出现', () => {
  const suggestion = entry(1, { suggestion: true })
  const plain = entry(2)
  const withAction = entry(3, { suggestion: true, actions: [{ label: '同步更改', run() {} }] })
  const hooks = { projectRoot: 'D:/proj', remindTomorrow() {}, doNotAskForProject() {}, doNotAskForApp() {} }
  assert.deepEqual(eventLogRowMenu(suggestion, hooks).map(item => item.label), [EVENT_LOG_REMIND_LABEL, EVENT_LOG_DO_NOT_ASK_PROJECT_LABEL, EVENT_LOG_DO_NOT_ASK_LABEL])
  assert.deepEqual(eventLogRowMenu(plain, hooks).map(item => item.label), [EVENT_LOG_DO_NOT_ASK_PROJECT_LABEL, EVENT_LOG_DO_NOT_ASK_LABEL])
  assert.deepEqual(eventLogRowMenu(withAction, hooks).map(item => item.label), [EVENT_LOG_DO_NOT_ASK_PROJECT_LABEL, EVENT_LOG_DO_NOT_ASK_LABEL], '带动作的建议不给「明天提醒我」')
  // 没有项目根 ⇒「不再为此项目显示」没有落点，不渲染。
  assert.deepEqual(eventLogRowMenu(suggestion, { ...hooks, projectRoot: '' }).map(item => item.label), [EVENT_LOG_REMIND_LABEL, EVENT_LOG_DO_NOT_ASK_LABEL])
  // 宿主没给某个副作用 ⇒ 对应条目不出现（与「没有 handler 就不给动作」同形）。
  assert.deepEqual(eventLogRowMenu(plain, { projectRoot: 'D:/proj' }).map(item => item.label), [])
})

test('点了菜单项就跑对应的副作用', () => {
  const ran = []
  const row = entry(1, { displayId: 'vcs.commit' })
  for (const item of eventLogRowMenu(row, { projectRoot: 'D:/proj', remindTomorrow: () => ran.push('remind'), doNotAskForProject: () => ran.push('project'), doNotAskForApp: () => ran.push('app') })) item.run()
  assert.deepEqual(ran, ['project', 'app'])
  assert.equal(doNotAskIdOf(row), 'vcs.commit')
  assert.equal(doNotAskIdOf(entry(2, { displayId: 'lsp:log:java' })), 'lsp:log:java')
  assert.equal(doNotAskIdOf(entry(3)), undefined)
})

// --- 接线：气球的分组判定与「不再显示」过滤都在通知宿主里 ------------------------------------------

test('通知宿主按组决定弹不弹气球，并让「不再显示」挡住后续同一条', () => {
  const host = readFileSync(join(root, 'src/notifications.ts'), 'utf8')
  // `Notification.canShowFor` 的判定在 notify 与 notifyProgress 两处。
  assert.equal(host.match(/canShowNotice\(/g).length, 2, 'notify 与 notifyProgress 各一处')
  // 组决定气球：NONE 组（LSP 日志）不再占用那个一闪而过的气球。
  assert.match(host, /const balloon = !group \|\| showsBalloon\(group\.displayType\)/)
  // 启动补「明天提醒我」到点的那几条 —— 这一拍上一轮搬进了 `armRemindLater`（同一个函数还接上了
  // 运行中的到点调度，见 `tests/notification-remind-later.test.mjs`），锚点跟着改指新落点。
  assert.match(host, /armRemindLater\(\{/, '通知宿主没装「明天提醒我」的到点调度')
  const ask = readFileSync(join(root, 'src/notificationDoNotAsk.ts'), 'utf8')
  assert.match(ask, /takeDueRemindLater\(at, alarm\.store\)/, '到点的那几条仍然被取走重播')
})

test('通知工具窗口挂的是 EventLogPanel，状态栏弹层仍是 NoticeList', () => {
  const view = readFileSync(join(root, 'src/components/ToolWindowView.vue'), 'utf8')
  assert.match(view, /<EventLogPanel v-else-if="view === 'notifications'"/)
  assert.match(view, /import EventLogPanel from '\.\/EventLogPanel\.vue'/)
  const app = readFileSync(join(root, 'src/App.vue'), 'utf8')
  assert.match(app, /<NoticeList /, '状态栏那个弹层还在')
})

test('EventLogPanel 的样式只走 tokens，且图标按钮带 title 与 aria-label', () => {
  const panel = readFileSync(join(root, 'src/components/EventLogPanel.vue'), 'utf8')
  assert.doesNotMatch(panel, /#([0-9a-fA-F]{6})\b/, '不许出现裸 hex')
  assert.doesNotMatch(panel, /cubic-bezier|\d+ms\b/, '不许硬编码时长')
  assert.match(panel, /:title="EVENT_LOG_MORE_TITLE"/)
  assert.match(panel, /:aria-label=/)
  assert.match(panel, /<MoreHorizontal :size="iconSize\.menu" \/>/, '图标走 lucide + iconSize 阶梯')
})
