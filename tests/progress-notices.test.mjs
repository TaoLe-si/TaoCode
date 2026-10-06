// 右下角「通知」列表里的进度行（语言服务 + Gradle 同步）。
//
// 起因（2026-09-29 用户）：「给 LSP 和 gradle 解析都在右下角消息窗口加入进度表示，对照 IDEA 消息窗口」。
// 之前 Gradle 只在状态栏的后台任务里有转圈的一行，跑完也没有任何结论留在消息窗口里；
// 语言服务那条通道更是整条不存在（native 把 `$/progress` 丢了，见 tests/lsp-progress.test.mjs）。
//
// 判据分两层：映射规则（纯函数，能测"同一个 displayId 就地刷新"这类形状）与接线
// （谁在什么时机调用）—— 断链是本项目反复出现过的那类缺陷，光有纯函数全绿照样坏。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GRADLE_NOTICE_ID, gradleFinishedNoticeOf, gradleRunningNoticeOf, lspFinishedNoticeOf, lspNoticeId, lspNoticeOf,
} from '../src/progressNotices.ts'
import { elapsedLabel } from '../src/progressPanel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('进度通知的三条规则：位置不动、跑完留在原地、失败标成错误', () => {
  const notices = read('src/notices.ts')
  assert.match(notices, /export function upsertNotice/, '要有一把"同 displayId 就地替换"的笔')
  assert.match(notices, /next\[index\] = \{ \.\.\.entry, id: entries\[index\]!\.id, at: entries\[index\]!\.at \}/,
    '刷新时 id 与时间都沿用第一次那一拍（列表不重排、时间戳含义是"何时开始"）')
  // 反证：如果刷新走 pushNotice，每来一拍都会把整行挪到最前面 —— 用户看到的就是刷屏。
  assert.ok(notices.indexOf('export function upsertNotice') > notices.indexOf('export function pushNotice'),
    'upsert 要定义在 pushNotice 之后（它复用了那条前插规则）')
  assert.match(read('src/notifications.ts'), /noticeLog\.value = upsertNotice\(noticeLog\.value, \{ \.\.\.entry, id: \+\+noticeSeq, at \}\)/,
    'notifyProgress 分配的 id 要与气球那条共用一个序列')
})

test('Gradle 那一行：跑的时候是进度，结束同一行收成结论', () => {
  const running = gradleRunningNoticeOf(1_000, 'Starting build\n> Configure project :app\n', 'gradlew.bat projects', 76_000)
  assert.equal(running.displayId, GRADLE_NOTICE_ID, '跑完要用同一个 displayId 才能就地刷新')
  assert.equal(running.percent, null, 'CLI 通道没有 progress/total ⇒ 不编百分比')
  assert.equal(running.error, false)
  assert.deepEqual(running.detail, ['已 1 分 15 秒', '> Configure project :app'],
    '行上给的是"已用时间 + 最新一行输出"（IDEA 那一行给的是外部系统的进度文字）')
  // 还没有输出时退回命令行本身 —— 至少看得见"到底在跑什么"。
  assert.equal(gradleRunningNoticeOf(1_000, '', 'gradlew.bat tasks --all', 2_000).detail.at(-1), 'gradlew.bat tasks --all')
  const done = gradleFinishedNoticeOf('', 75)
  assert.equal(done.displayId, GRADLE_NOTICE_ID)
  assert.equal(done.percent, 100, '成功那一拍百分比收在 100')
  assert.equal(done.message, 'Gradle 同步完成（用时 75 秒）')
  const failed = gradleFinishedNoticeOf("An exception occurred applying plugin request — Failed to load the manifest from Github", 75)
  assert.equal(failed.error, true, '失败必须是错误级（列表要变色）')
  assert.equal(failed.percent, null, '失败没有"完成度"可言')
  assert.ok(failed.message.includes('Failed to load the manifest from Github'), '结论行要带上真正的原因')
  // 依赖那条命令复用的是同一行，但文案要说得对。
  assert.equal(gradleFinishedNoticeOf('', 3, '依赖加载').message, '依赖加载完成（用时 3 秒）')
})

test('语言服务那一行：百分比有就有、没有就写进行中；结束行换个标题但同一位置', () => {
  const task = { language: 'java', token: '7', title: 'Importing projects', details: 'AE2VMAddon', percent: 42 }
  assert.deepEqual(lspNoticeOf(task), {
    message: 'Importing projects', error: false, detail: ['AE2VMAddon'],
    displayId: 'lsp:progress:java:7', percent: 42,
  })
  assert.equal(lspNoticeOf({ ...task, percent: -1 }).percent, null, '服务器没给百分比 ⇒ 只是"进行中"')
  assert.deepEqual(lspNoticeOf({ ...task, details: '' }).detail, [], '空细节不要占一行')
  assert.equal(lspFinishedNoticeOf(task).displayId, lspNoticeId('java', '7'), '结束行要与进度行同一个 id 才能原地收掉')
  assert.equal(lspFinishedNoticeOf(task).percent, 100)
})

test('已用时间的口径：<60 秒用秒，过了 60 秒用分秒，没有起点就是空', () => {
  assert.equal(elapsedLabel(0, 5_000), '', '还没开始就没有"已用"')
  assert.equal(elapsedLabel(10_000, 5_000), '', '时钟倒挂（假时钟/时钟回拨）不报负数')
  assert.equal(elapsedLabel(10_000, 10_400), '已 0 秒')
  assert.equal(elapsedLabel(10_000, 75_000), '已 1 分 5 秒')
})

test('接线：谁在什么时候写这一行', () => {
  const host = read('src/gradleHost.ts')
  assert.match(host, /notifyProgress/, 'Gradle 的宿主要把进度与结论写进消息窗口')
  assert.match(host, /gradleRunningNoticeOf\(/, '命令一起来就有一行（不要等第一批输出 —— 网络卡住的那 75 秒里正是最需要看见的时刻）')
  assert.match(host, /watch\(\(\) => gradleSync\.output\.length/, '输出每来一批刷一次')
  assert.match(host, /gradleFinishedNoticeOf\(error, Math\.max\(0, Math\.round/, '同步结束把那一行收成结论')
  // 2026-10-06 复核订正：这里原来钉的是 `job.kind === 'dependencies' ? '依赖加载' : undefined`，
  // 但磁盘上那条三元链已经长成三档（桶 15 给 `kind === 'task'` 也补了结论，
  // `src/gradleHost.ts:520-521`）。**意图不变**（"依赖那条命令也要收成结论"），只是把钉住的
  // 形状改成当前真实的整条链 —— 不放松成 `includes`，仍是一条精确 match。
  assert.match(host, /job\.kind === 'dependencies' \? '依赖加载' : job\.kind === 'task' \? '任务运行' : undefined/,
    '依赖与任务运行那两条命令也要收成结论')
  assert.match(read('src/App.vue'), /isDesktop, workspace, projectSettings, notify, notifyProgress,/,
    '宿主要把 notifyProgress 注进 Gradle 的状态域')
  assert.match(read('src/notifications.ts'), /wireLspProgressNotices\(notifyProgress\)/,
    '语言服务那一边由通知宿主自己挂表（进度表是 bridge 喂的，别处没有更早的时机）')
  assert.match(read('src/components/NoticeList.vue'), /noticeProgressLabel\(entry\)/, '列表要真的把那栏文字画出来')
  assert.match(read('src/style.css'), /\.status-notice-track/, '百分比要有一条带，而不只是文字')
})
