// 通知上的动作按钮（上游 `Notification.addAction`）。
//
// 起因：Gradle 同步失败以前只是消息窗口里的一行灰字 —— 用户看完还得自己去工具条上点「同步」。
// IDEA 的那批通知是带按钮的：
//   · Gradle 通知组本身就是 `displayType="STICKY_BALLOON"`（`plugins/gradle/plugin-resources/intellij.gradle.xml:309`，
//     组名 = `GradleBundle.properties:320` `notification.group.gradle=Gradle`）；
//   · 动作的形状见 `GradleBundle.properties:343-345`（Migrate / Ignore / Learn more）；
//   · 点击顺序由 `LspServerNotificationsHandlerImpl.kt:443-454` 给出：addAction 的回调里先
//     `notification.expire()` 再做事 —— 点完还挂在列表里的通知就是没收起的弹窗。
//   · 本仓这些按钮都是"点完就完"的，用的正是上游推荐的那个形状：`Notification.java:52` 写着
//     「别在 HTML 里放链接，用 addAction / NotificationAction.createSimpleExpiring」——
//     **Expiring** 就是点完把这条通知收掉，所以气球与列表两处都得收，不能只藏气球。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noticeLevel, noticeTitle, pushNotice } from '../src/notices.ts'
import { createNotifications } from '../src/notifications.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const entry = (over = {}) => ({ id: 1, message: 'm', error: false, at: '00:00:00', ...over })

/** 通知宿主：三个气球字段由宿主自持，所以这里给一对可写的壳。 */
function host() {
  const notice = { value: '' }
  const noticeError = { value: false }
  const noticeAction = { value: null }
  return { api: createNotifications({ notice, noticeError, noticeAction }), notice }
}

test('动作与进度行共用同一份通知条目模型', () => {
  const withActions = pushNotice([], entry({ displayId: 'gradle:fail', actions: [{ label: '重新同步', run: () => {} }] }))
  assert.equal(withActions[0].actions.length, 1)
  assert.equal(pushNotice([], entry()).actions, undefined, '没有动作的通知不该占一行按钮位')
})

test('notify 把动作带上气球与列表；气球那条点完把通知本身收掉', () => {
  const ran = []
  const { api, notice } = host()
  api.notify('Gradle 同步失败：拉不到 manifest', true, undefined, undefined, undefined, [{ label: '重新同步', run: () => ran.push(1) }])
  assert.equal(notice.value, 'Gradle 同步失败：拉不到 manifest')
  assert.equal(api.noticeLog.value[0].actions[0].label, '重新同步', '列表里也要带着同一组按钮')
  assert.equal(api.noticeActions.value.length, 1, '气球要能画出同一组按钮')
  api.runBalloonAction(api.noticeActions.value[0])
  assert.deepEqual(ran, [1], '动作确实跑了')
  assert.equal(notice.value, '', '执行时气球一起收掉')
  assert.equal(api.noticeActions.value, null)
  assert.equal(api.noticeLog.value.length, 0, '上游用的是 createSimpleExpiring：点完这条通知就没了，不是只收气球')
})

test('列表里点旧那条的按钮，不会把最新那条（还挂在气球上）一起收掉', () => {
  const ran = []
  const { api } = host()
  api.notify('第一条：依赖加载失败', true, undefined, undefined, undefined, [{ label: '重新同步', run: () => ran.push(1) }])
  api.notify('第二条', true)
  const older = api.noticeLog.value[1]
  api.expireNotice(older.id)   // NoticeList.vue 的按钮先 expire 再 run，顺序在两处一致
  api.runNoticeAction(older.actions[0])
  assert.deepEqual(ran, [1])
  assert.deepEqual(api.noticeLog.value.map(item => item.message), ['第二条'], '只收点那一条')
  // 反证：气球若还显示着「第二条」，runBalloonAction 不能拿上一条的 id 去收它。
  api.runBalloonAction({ label: 'noop', run: () => ran.push(2) })
  assert.deepEqual(ran, [1, 2])
  assert.equal(api.noticeLog.value.length, 0)
})

test('expire 只收那一条；收光了通知中心自己关', () => {
  const { api } = host()
  api.notify('第一条')
  api.notify('第二条', true)
  assert.equal(api.noticeOpen.value, false)
  // 前插 = 最新在头一条（`pushNotice` 的形状）；先收掉那条**没错误**的，看芯片颜色跟不跟着剩下那条走。
  const [newest, older] = api.noticeLog.value
  assert.deepEqual([newest.message, older.message], ['第二条', '第一条'])
  api.expireNotice(older.id)
  assert.deepEqual(api.noticeLog.value.map(item => item.message), ['第二条'])
  assert.equal(noticeLevel(api.noticeLog.value), 'error', '芯片的变色跟着剩下那条，不能被收掉的那条带跑')
  // 提示文字是上游那两句（`IdeNotificationArea.java:105-107`，中文包「N 通知挂起」），
  // 这里要钉的是"**条数跟着剩下那条走**"，形状随 2026-10-06 的文案订正一起换成仍精确的整句匹配。
  assert.match(noticeTitle(api.noticeLog.value), /^1 通知挂起$/, '收掉一条后提示里的条数要跟着变')
  api.noticeOpen.value = true
  api.expireNotice(newest.id)
  assert.equal(api.noticeOpen.value, false, '最后一条被收走时弹层没有内容可展示，要自己关')
})

// ---------------------------------------------------------------------------
// 接线：三处渲染点都得真的接上（少一处就是"按钮在但点了没反应"）
// ---------------------------------------------------------------------------

test('状态栏弹层、通知工具窗口、气球都接上了同一组动作', () => {
  const list = read('src/components/NoticeList.vue')
  assert.match(list, /emit\('expire', entry\.id\); emit\('run', action\)/, '列表按钮要先 expire 再执行（上游那个顺序）')
  assert.match(list, /entry\.actions\?\.length/, '没有动作的通知不占按钮位')
  const app = read('src/App.vue')
  assert.match(app, /@expire="expireNotice" @run="runNoticeAction"/, '状态栏那个弹层要接住事件')
  assert.match(app, /class="subtle-button notice-action" @click\.stop="runBalloonAction\(action\)"/, '气球上也要有同一组按钮')
  const view = read('src/components/ToolWindowView.vue')
  assert.match(view, /@expire="ctx\.onExpireNotice\?\.\(\$event\)" @run="ctx\.onRunNoticeAction\?\.\(\$event\)"/,
    '通知工具窗口是第二份列表，按钮不能只在一处生效')
  assert.match(read('src/toolViewContext.ts'), /onRunNoticeAction: runNoticeAction, onExpireNotice: expireNotice/)
  assert.match(read('src/style.css'), /\.notice-action \{/, '按钮要有自己的字号，不与正文抢')
})

test('Gradle 失败那条通知自带「重新同步 / 打开构建脚本 / 构建工具设置」', () => {
  const gradleHost = read('src/gradleHost.ts')
  assert.match(gradleHost, /function notifyFailure\(directory: string, label: string, error: string\): void/, '失败要发一条带按钮的通知，不只是灰字')
  for (const label of ['重新同步', '打开构建脚本', '构建工具设置']) {
    assert.ok(gradleHost.includes(`label: '${label}'`), `失败通知少了「${label}」这个动作`)
  }
  // 2026-10-06 复核订正（与 `tests/progress-notices.test.mjs` 同一处）：桶 15 给 `kind === 'task'`
  // 也补了结论，磁盘上是一条**三档**的三元链（`src/gradleHost.ts:519-521`）。这两条断言原来钉的是
  // 两档那一版 ⇒ 钉的形状过时了，不是意图变了：意图仍然是「每一条命令的失败都经过 notifyFailure
  // 这个出口、都带自己的中文标签」。改成仍精确的整句匹配，不放松成 includes。
  assert.match(gradleHost,
    /notifyFailure\(job\.directory, job\.kind === 'sync' \? 'Gradle 同步' : job\.kind === 'dependencies' \? '依赖加载' : '任务运行', error\)/,
    '同步/依赖/任务运行三条命令的失败都要发出去，且各带自己的标签')
  assert.match(gradleHost,
    /job\.kind === 'dependencies' \? '依赖加载' : job\.kind === 'task' \? '任务运行' : undefined/,
    '进度行的结论也要按同一条链给标签')
  // 本仓没有本地文档，就不放「Learn more」那类按钮：凭空发明的链接比没有按钮更糟。
  assert.equal(/了解更多|help\.jetbrains|https?:\/\/[a-z]/i.test(gradleHost), false, '不许出现凭空造的帮助链接')
})
