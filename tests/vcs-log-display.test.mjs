// Git 日志**显示档**（§C 前 20 条里"用户可见 + 纯前端"的那两条）：
//   1) 日期列的相对日期 —— 上游 `VcsLogDefaultColumn.Date.getValue`（`ui/table/column/VcsLogDefaultColumn.kt:172-177`）
//      就一行 `DateFormatUtil.formatPrettyDateTime(timeStamp)`，实现与逐条坐标在 `src/vcsLogDisplay.ts`；
//   2) 「列」这一组的成员 = 可动态隐藏的三列，**提交列勾不掉**
//      （`ui/actions/ToggleLogColumnsActionGroup.java:48-51` → `ui/table/column/VcsLogColumnUtil.kt:121-127`
//      → `ui/table/column/VcsLogDefaultColumn.kt:43`；`Commit.isDynamic = false` 同文件 `:89`）。
// 日期档的每一条边界都直接照 `DateFormatUtil.java:137-177` 那段求值顺序写死（分钟档 → 今天 → 昨天 → 绝对）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import {
  PRETTY_DATE_ALLOWED_DEFAULT, PRETTY_DATE_WINDOW_MS, minutesAgoText, prettyLogDate, rint,
} from '../src/vcsLogDisplay.ts'
import { logDate } from '../src/vcsLogGraph.ts'
import { LOG_DYNAMIC_COLUMNS, logRowCopyText, logCommitTooltip } from '../src/vcsLogPresentation.ts'
import { LOG_COLUMNS } from '../src/vcsLogColumns.ts'
import { loadSfc } from './vue-sfc-loader.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const { component: VcsLogTable } = loadSfc('src/components/VcsLogTable.vue')

const MINUTE = 60_000
const HOUR = 60 * MINUTE
/** 固定一个"今天"的时刻做参照（本地时区）：上游也用本地 `Calendar`（`DateFormatUtil.java:141`）。 */
const NOW = new Date(2026, 9, 6, 15, 30, 0).getTime()   // 2026-10-06 15:30 本地
const iso = (year, month, day, hour, minute, second = 0) => {
  const pad = value => String(value).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`
}

test('上游出厂：相对日期档默认开着，窗口是 61 分钟（HOUR + MINUTE）', () => {
  assert.equal(PRETTY_DATE_ALLOWED_DEFAULT, true, 'DateTimeFormatManager.java:25 myPrettyFormattingAllowed = true')
  assert.equal(PRETTY_DATE_WINDOW_MS, 61 * MINUTE, 'DateFormatUtil.java:157 的 delta <= HOUR + MINUTE')
})

test('分钟档四档：ChoiceFormat 的 [0,1)/[1,2)/[2,60)/[60,∞)', () => {
  // UtilBundle.properties:2 = {0,choice, 0#Moments|1#A minute|2#{0,number} minutes|60#1 hour} ago
  assert.equal(minutesAgoText(0), '刚刚')
  assert.equal(minutesAgoText(1), '1 分钟前')
  assert.equal(minutesAgoText(2), '2 分钟前')
  assert.equal(minutesAgoText(59), '59 分钟前')
  assert.equal(minutesAgoText(60), '1 小时前')
})

test('rint 是 Math.rint（.5 取偶），不是四舍五入：上游 :158 用的就是 rint', () => {
  assert.equal(rint(0.5), 0, '0.5 → 0（偶数）')
  assert.equal(rint(1.5), 2, '1.5 → 2')
  assert.equal(rint(2.5), 2, '2.5 → 2（round 会给 3 ⇒ 这里必须不同）')
  assert.equal(rint(3.5), 4)
  assert.equal(rint(4.4), 4)
  assert.equal(rint(4.6), 5)
})

test('日期格：30 秒 = 刚刚、5 分钟 = 5 分钟前、61 分钟整仍在窗口内、61 分钟零 1 秒出窗', () => {
  assert.equal(prettyLogDate(iso(2026, 10, 6, 15, 29, 30), NOW), '刚刚', '30 秒 → rint(0.5)=0 → Moments ago')
  assert.equal(prettyLogDate(iso(2026, 10, 6, 15, 28, 31), NOW), '1 分钟前', '89 秒 → rint(1.483)=1')
  assert.equal(prettyLogDate(iso(2026, 10, 6, 15, 28, 30), NOW), '2 分钟前', '90 秒 → rint(1.5)=2（取偶往上）')
  assert.equal(prettyLogDate(iso(2026, 10, 6, 15, 25), NOW), '5 分钟前')
  assert.equal(prettyLogDate(iso(2026, 10, 6, 14, 29), NOW), '1 小时前', '恰好 61 分钟：rint(61)=61 → 后一档')
  // 出窗（>61 分钟）后落回"今天"那一档（同一自然日）
  assert.equal(prettyLogDate(iso(2026, 10, 6, 14, 28), NOW), `今天 ${logDate(iso(2026, 10, 6, 14, 28)).slice(11)}`)
})

test('今天 / 昨天 / 更早：昨天跨年也算昨天，更早走绝对档', () => {
  const nowNewYear = new Date(2026, 0, 1, 8, 0, 0).getTime()
  assert.equal(prettyLogDate(iso(2025, 12, 31, 23, 50), nowNewYear), '昨天 23:50',
    '上游 :168-169 特判的「今天是 1 月 1 日、提交在去年 12 月 31 日」')
  assert.equal(prettyLogDate(iso(2026, 10, 5, 9, 12), NOW), '昨天 09:12')
  assert.equal(prettyLogDate(iso(2026, 9, 29, 10, 0), NOW), logDate(iso(2026, 9, 29, 10, 0)), '更早 = 绝对档一字不变')
  assert.equal(prettyLogDate(iso(2026, 10, 6, 0, 5), NOW), '今天 00:05')
})

test('闸门关掉走绝对档；读不懂的时间戳不空那一格（本仓选择，上游 timeStamp<0 才给空）', () => {
  assert.equal(prettyLogDate(iso(2026, 10, 6, 15, 25), NOW, false), logDate(iso(2026, 10, 6, 15, 25)))
  assert.equal(prettyLogDate('不是日期', NOW), '不是日期', '原样给回，不把一格好端端的日期变成空白')
})

test('未来 1 分钟的提交不进分钟档（上游 delta >= 0 那一半），但仍在「今天」里', () => {
  assert.equal(prettyLogDate(iso(2026, 10, 6, 15, 31), NOW), '今天 15:31')
})

test('「列」这一组不含提交列，且表格把旧存档里残留的 commit 按「没勾」处理', () => {
  assert.deepEqual(LOG_DYNAMIC_COLUMNS, ['author', 'hash', 'date'], '上游 listOf(Author, Hash, Date)')
  assert.deepEqual(LOG_COLUMNS.filter(column => !LOG_DYNAMIC_COLUMNS.includes(column)), ['commit'])
  const table = read('src/components/VcsLogTable.vue')
  assert.match(table, /const hiddenForLayout = computed\(\(\) => \(props\.hidden \?\? \[\]\)\.filter\(column => column !== 'commit'\)\)/,
    '组件里那一层过滤是判据本体，不靠模型兜')
  assert.match(table, /:hidden="hiddenForLayout"/, '表头（VcsLogColumns）与行单元格吃同一份')
  assert.match(table, /hash: commit\.hash, shortHash: commit\.shortHash \}, hiddenForLayout\.value\)/,
    'Ctrl+C 的可见列口径也用这份（提交列恒看得见 ⇒ 主题恒在复制出去的那行里）')
  assert.match(table, /shortHash: commit\.shortHash \},\s*\n\s*hiddenForLayout\.value,/,
    '速度搜索比的是可见列，也用这份')
  // 模型这一侧：commit 混进 hidden 时（旧存档）主题照旧在行文本与 tooltip 里 —— 与组件那层过滤同一口径的反证。
  const row = { subject: '主题一', author: 'Tao', date: '5 分钟前', hash: 'a'.repeat(40), shortHash: 'aaaaaaa' }
  assert.equal(logRowCopyText(row, []).includes('主题一'), true)
  assert.equal(logCommitTooltip(row).split('\n')[0], '主题一')
})

test('日期档真的接到表格上：5 分钟前那一格画的是分钟档，同一条字符串也在行 tooltip 里（SSR 渲真组件）', async () => {
  const commit = (offsetMs, hash) => ({
    hash, shortHash: hash, author: 'Tao', subject: `提交 ${hash}`, parents: [], refs: [],
    date: new Date(Date.now() - offsetMs).toISOString(),
  })
  const recent = commit(5 * MINUTE, 'r1'.padEnd(40, '0'))
  const html = await renderToString(createSSRApp({
    render: () => h(VcsLogTable, { commits: [recent], selected: recent.hash, root: 'D:/p' }),
  }))
  const cell = html.match(/class="date"[^>]*>([^<]*)</)?.[1] ?? ''
  assert.match(cell, /^\d+ 分钟前$/, `日期格要出分钟档，实得「${cell}」`)
  const title = html.match(/<div[^>]*class="log-row[^>]*"[^>]*title="([^"]*)"/)?.[1] ?? ''
  assert.ok(title.includes(cell), 'tooltip 用的就是那一格的同一个字符串（不是另算一份绝对日期）')
})

test('旧提交仍走绝对档、勾掉日期列时那一格整个不画（SSR 渲真组件）', async () => {
  const old = {
    hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'Tao', date: '2026-09-29T10:00:00+08:00',
    subject: '九月的提交', parents: [], refs: [],
  }
  const shown = await renderToString(createSSRApp({
    render: () => h(VcsLogTable, { commits: [old], selected: old.hash, root: 'D:/p' }),
  }))
  assert.match(shown.match(/class="date"[^>]*>([^<]*)</)?.[1] ?? '', /^2026-09-29 \d{2}:\d{2}$/, '绝对档一字不变')
  const hiddenDate = await renderToString(createSSRApp({
    render: () => h(VcsLogTable, { commits: [old], selected: old.hash, root: 'D:/p', hidden: ['date'] }),
  }))
  assert.ok(!hiddenDate.includes('class="date"'), '勾掉的日期列连单元格都不出现')
  // 提交列勾不掉：旧存档里留着 commit 这条时，主题、作者、日期、哈希四格都还在。
  const hiddenCommit = await renderToString(createSSRApp({
    render: () => h(VcsLogTable, { commits: [old], selected: old.hash, root: 'D:/p', hidden: ['commit'] }),
  }))
  assert.ok(hiddenCommit.includes('九月的提交'), '残留的 commit 勾不隐藏主体格')
  assert.ok(!/--commit-width:0px/.test(hiddenCommit),
    '提交列不参与"勾掉 ⇒ 宽度归零"那一套（残留的 commit 到了 VcsLogColumns 也得余量列的宽度），实得：'
    + (hiddenCommit.match(/--commit-width:[^;]*/)?.[0] ?? '没有这个变量'))
  assert.ok(hiddenCommit.includes('class="author"') && hiddenCommit.includes('class="date"') && hiddenCommit.includes('class="hash"'),
    '其余三列不受那条残留影响')
})
