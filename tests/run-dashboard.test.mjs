// exec/run-toolbar 本轮补齐的运行仪表盘（上游 execution/dashboard 的 RunDashboardManager /
// RunDashboardService 的可移植子集）判据：行模型、时长文案、汇总与工具栏接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatRunDuration, runDashboardRows, runDashboardSummary } from '../src/runDashboard.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('时长文案：秒 / 分秒 / 时分', () => {
  assert.equal(formatRunDuration(0), '0s')
  assert.equal(formatRunDuration(999), '0s')
  assert.equal(formatRunDuration(12000), '12s')
  assert.equal(formatRunDuration(65000), '1m 05s')
  assert.equal(formatRunDuration(3600000 + 3 * 60000), '1h 03m')
  assert.equal(formatRunDuration(-5), '0s', '负数不出现 -1s')
})

test('仪表盘行：按起跑顺序、状态四档、时长按 now 算', () => {
  const rows = runDashboardRows([
    { id: 2, label: 'B', running: true, exit: null, startedAt: 1000, pid: 222 },
    { id: 1, label: 'A', running: false, exit: 0, startedAt: 0 },
    { id: 3, label: '', running: false, exit: 3, startedAt: 0 },
    { id: 4, label: 'D', running: false, exit: -1, startedAt: 0 },
  ], 13000)
  assert.deepEqual(rows.map(row => row.id), [1, 2, 3, 4], '按 id（起跑顺序）排序')
  assert.deepEqual(rows.map(row => row.state), ['ok', 'running', 'failed', 'stopped'])
  assert.equal(rows[0].statusText, '已完成')
  assert.equal(rows[1].elapsedText, '12s')
  assert.equal(rows[1].pid, 222)
  assert.equal(rows[2].statusText, '退出码 3')
  assert.equal(rows[3].statusText, '已停止')
  assert.equal(rows[2].title, '运行 3', '没有标签就用「运行 N」')
})

test('汇总文案：按状态计数，空表说清楚', () => {
  assert.equal(runDashboardSummary([]), '还没有运行实例')
  const rows = [
    { state: 'running' }, { state: 'running' }, { state: 'ok' }, { state: 'failed' }, { state: 'stopped' },
  ]
  const summary = runDashboardSummary(rows)
  assert.equal(summary, '2 个在跑 · 1 个已完成 · 1 个失败 · 1 个已停止')
})

test('接线：工具栏有仪表盘按钮/弹层，行可切换实例、在跑的行可停止', () => {
  const toolbar = read('src/components/MainToolbar.vue')
  assert.match(toolbar, /aria-label="运行仪表盘"/)
  assert.match(toolbar, /runDashboardRows\(runInstanceList\(\)\.map\(instance => \(\{/)
  assert.match(toolbar, /focusRunInstance\(id\)/)
  assert.match(toolbar, /request\('run\.stop', \{ instance: id \}\)/)
  assert.match(toolbar, /run-dashboard-summary/)
})
