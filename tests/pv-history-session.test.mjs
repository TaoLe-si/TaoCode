// 本地历史补上的两条：时间线的**时段分组**与**跨文件 / 目录级的会话视图**。
// 上游坐标见 src/historyTimeline.ts 与 src/historySessions.ts 的文件头。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { HISTORY_PERIOD_LABELS, RECENT_PERIOD_HOURS, isRecentSnapshot, timelineRows } from '../src/historyTimeline.ts'
import {
  HISTORY_SESSION_PATH_LIMIT, buildSessionFiles, filterSessionFiles, sessionCandidatePaths,
  sessionRevertPlan, withinDirectory,
} from '../src/historySessions.ts'

const HOUR = 60 * 60 * 1000
const NOW = 1_760_000_000_000
const snap = (id, hoursAgo) => ({ id, reason: 'save', bytes: 12, timeMillis: NOW - hoursAgo * HOUR, time: id })

test('12 小时窗就是上游的 RECENT_PERIOD=12', () => {
  assert.equal(RECENT_PERIOD_HOURS, 12)
  assert.equal(isRecentSnapshot(NOW - 11 * HOUR, NOW), true)
  assert.equal(isRecentSnapshot(NOW - 13 * HOUR, NOW), false)
  // 恰好 12 小时按上游的严格小于算，不算近期。
  assert.equal(isRecentSnapshot(NOW - 12 * HOUR, NOW), false)
})

test('时段标题：只有第一条近期快照挂「最近」', () => {
  const rows = timelineRows([snap('a', 1), snap('b', 3)], NOW)
  assert.deepEqual(rows.map(row => row.period), ['recent', null])
})

test('分界行挂「更早」，之后的行不再挂（上游那个 break）', () => {
  const rows = timelineRows([snap('a', 1), snap('b', 13), snap('c', 20)], NOW)
  assert.deepEqual(rows.map(row => row.period), ['recent', 'older', null])
})

test('一条近期都没有时首行挂「旧的更改」', () => {
  const rows = timelineRows([snap('a', 13), snap('b', 20)], NOW)
  assert.deepEqual(rows.map(row => row.period), ['old', null])
})

test('三档标题的文案都在（不拿英文凑）', () => {
  assert.match(HISTORY_PERIOD_LABELS.recent, /12 小时/)
  assert.equal(HISTORY_PERIOD_LABELS.older, '更早')
  assert.equal(HISTORY_PERIOD_LABELS.old, '旧的更改')
})

test('会话候选路径：当前文件在最前，变更集与重命名前身跟后，去重并限量', () => {
  const changes = [{ path: 'src/b.ts', renameFrom: 'src/a.ts' }, { path: 'src/c.ts' }, { path: 'src/b.ts' }]
  assert.deepEqual(sessionCandidatePaths(changes, 'src/z.ts'), ['src/z.ts', 'src/b.ts', 'src/a.ts', 'src/c.ts'])
  // 当前文件本身也在变更集里时不重复列。
  assert.deepEqual(sessionCandidatePaths(changes, 'src/b.ts'), ['src/b.ts', 'src/a.ts', 'src/c.ts'])
  const many = Array.from({ length: 80 }, (_, index) => ({ path: `f${index}.ts` }))
  assert.equal(sessionCandidatePaths(many, 'me.ts').length, HISTORY_SESSION_PATH_LIMIT)
  // 没有当前文件（对话框刚从项目根打开）时只列变更集，不塞一个空路径进去。
  assert.deepEqual(sessionCandidatePaths([{ path: 'x.ts' }], ''), ['x.ts'])
})

test('会话行：丢掉没有历史的，按各自最新快照从新到旧', () => {
  const files = buildSessionFiles([
    { path: 'old.ts', entries: [snap('o1', 30)] },
    { path: 'empty.ts', entries: [] },
    { path: 'new.ts', entries: [snap('n1', 1), snap('n2', 5)] },
  ])
  assert.deepEqual(files.map(file => file.path), ['new.ts', 'old.ts'])
  assert.equal(files[0].versions, 2)
  assert.equal(files[0].latestTime, 'n1')
})

test('目录过滤按路径段比，不把 src/app 撞成 src/application', () => {
  assert.equal(withinDirectory('src/app/x.ts', 'src/app'), true)
  assert.equal(withinDirectory('src/app/x.ts', 'src/app/'), true)
  assert.equal(withinDirectory('src/application/x.ts', 'src/app'), false)
  assert.equal(withinDirectory('src/app', 'src/app'), true)
  assert.equal(withinDirectory('anything.ts', ''), true)
  const files = buildSessionFiles([
    { path: 'src/app/a.ts', entries: [snap('a', 1)] },
    { path: 'src/application/b.ts', entries: [snap('b', 1)] },
  ])
  assert.deepEqual(filterSessionFiles(files, 'src/app').map(file => file.path), ['src/app/a.ts'])
  assert.equal(filterSessionFiles(files, '').length, 2)
})

test('会话回滚清单：每个文件取边界之前的最后一版，已是最新版的不动', () => {
  const files = [
    { path: 'a.ts', entries: [snap('a3', 1), snap('a2', 6), snap('a1', 20)] },
    { path: 'b.ts', entries: [snap('b1', 1)] },
    { path: 'c.ts', entries: [snap('c2', 2), snap('c1', 40)] },
  ]
  const plan = sessionRevertPlan(files, NOW - 10 * HOUR)
  // 边界是「10 小时前」那一刻：a.ts 的 a3(1h)/a2(6h) 都发生在边界**之后**，边界那一刻
  // 文件内容还是 a1(20h)；b.ts 在边界之后才有历史 → 不进清单；c.ts 回到 c1(40h)。
  assert.deepEqual(plan.map(step => `${step.path}:${step.entry.id}`), ['a.ts:a1', 'c.ts:c1'])
  // 边界就是最新版时：没有任何文件需要动。
  assert.deepEqual(sessionRevertPlan(files, NOW + HOUR), [])
})

test('面板真的接上了时段标题与会话视图（不是死代码）', () => {
  const panel = readFileSync('src/components/HistoryPanel.vue', 'utf8')
  // 钉的是**挂点**（渲染表达式 / 事件绑定），不是符号名 —— 只 import 不用的假接线要能被照出来。
  assert.match(panel, /\{\{ HISTORY_PERIOD_LABELS\[item\.period\] \}\}/, '时段标题真的渲染出来')
  assert.match(panel, /items: timelineRows\(/, '每节的时间线由分组函数算')
  assert.match(panel, /hist-period/, '时段标题有自己的样式')
  assert.match(panel, /sessionCandidatePaths\(changedPaths, props\.path\)/, '会话路径集来自 git 变更集')
  assert.match(panel, /sessionRevertPlan\(sources\.map/, '「恢复整个会话」用的是同一份清单')
  assert.match(panel, /filterSessionFiles\(sessionFiles\.value, directory\.value\)/, '目录过滤真的过滤')
  assert.match(panel, /@click="select\(item\.path, item\.entry, item\.followed\)"/, '会话里的行也按自己的路径取差异')
  assert.match(panel, /mode = 'session'/, '两种视图模式可切')
})
