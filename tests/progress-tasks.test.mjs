// 并发任务表 / 心跳 / 子任务进度 / 后台任务收尾的判据（`src/progressTasks.ts`）。
//
// 上游依据：`ConcurrentTasksProgressManager`（并发任务合并）、`PingProgress`（心跳式进度）、
// `SubTaskProgressIndicator`（子任务占父任务的 start/end 分数区间）、
// `BackgroundTaskUtil.executeWithProgress`（跑完无论如何收尾）。消费链路：整工程检查
// （`src/workspaceInspection.ts`）登记一行，`src/progressPanel.ts` 把它画进后台任务列表。
import test from 'node:test'
import assert from 'node:assert/strict'

const {
  ConcurrentTasksProgressManager, backgroundTaskManager, beginBackgroundTask, reportBackgroundTask,
  endBackgroundTask, aggregatePercent, createPingProgress, PING_INTERVAL_MS,
  subTaskRange, mapSubFraction, SubTaskProgress, runBackgroundTask,
} = await import('../src/progressTasks.ts')
const { runWorkspaceInspection, WORKSPACE_INSPECTION_TASK_ID } = await import('../src/workspaceInspection.ts')

test('并发任务表：按开始时间排序、当前任务是最早那个、update 只覆盖发出来的字段', () => {
  let clock = 1000
  const manager = new ConcurrentTasksProgressManager(() => clock)
  manager.begin('a', '任务 A', { detail: '第一步' })
  clock = 2000
  manager.begin('b', '任务 B')
  assert.deepEqual(manager.tasks().map(task => task.id), ['a', 'b'])
  assert.equal(manager.primaryTask().id, 'a')
  assert.equal(manager.get('a').percent, -1, '没有百分比 = 不确定式')
  manager.update('a', { detail: '第二步', percent: 40 })
  assert.equal(manager.get('a').detail, '第二步')
  assert.equal(manager.get('a').percent, 40)
  manager.update('a', { title: '任务 A2' })
  assert.equal(manager.get('a').title, '任务 A2')
  assert.equal(manager.get('a').detail, '第二步', '没发的字段沿用旧值')
  // 同 id 再 begin 只覆盖标题，不重置开始时间（并发合并语义）。
  manager.begin('a', '任务 A3')
  assert.equal(manager.get('a').startedAt, 1000)
  manager.end('a')
  assert.deepEqual(manager.tasks().map(task => task.id), ['b'])
  manager.end('missing')     // 幂等
  manager.clear()
  assert.equal(manager.size, 0)
})

test('合并百分比：全体都有百分比才给平均，否则不确定', () => {
  assert.equal(aggregatePercent([]), -1)
  assert.equal(aggregatePercent([{ percent: 10 }, { percent: 20 }]), 15)
  assert.equal(aggregatePercent([{ percent: 10 }, { percent: -1 }]), -1)
})

test('进程级任务表的便捷包装', () => {
  beginBackgroundTask('t', '进程级任务', { detail: 'x' })
  reportBackgroundTask('t', { percent: 50 })
  assert.equal(backgroundTaskManager.get('t').percent, 50)
  endBackgroundTask('t')
  assert.equal(backgroundTaskManager.get('t'), null)
})

test('心跳：start 幂等、stop 停表；用注入的定时器不开真定时', () => {
  let ticks = 0
  let scheduled = null
  let cleared = 0
  const ping = createPingProgress({
    intervalMs: PING_INTERVAL_MS,
    onTick: () => { ticks++ },
    setIntervalFn: handler => { scheduled = handler; return 7 },
    clearIntervalFn: () => { cleared++ },
  })
  assert.equal(ping.isRunning(), false)
  ping.start()
  assert.equal(ticks, 1, 'start 立刻跳一拍')
  assert.equal(ping.isRunning(), true)
  ping.start()
  assert.equal(ticks, 1, '重复 start 不叠定时器')
  scheduled()
  assert.equal(ticks, 2)
  ping.tick()
  assert.equal(ticks, 3)
  ping.stop()
  assert.equal(cleared, 1)
  assert.equal(ping.isRunning(), false)
  ping.stop()
  assert.equal(cleared, 1, '重复 stop 不重复清')
})

test('子任务：区间夹住、折进父进度、finish 落在区间右端', () => {
  assert.deepEqual(subTaskRange(-1, 2), { start: 0, end: 1 })
  assert.deepEqual(subTaskRange(0.5, 0.25), { start: 0.5, end: 0.5 })
  assert.equal(mapSubFraction({ start: 0.25, end: 0.75 }, 0.5), 0.5)
  assert.equal(mapSubFraction({ start: 0.25, end: 0.75 }, 2), 0.75)
  const sub = new SubTaskProgress(0.4, 0.8)
  assert.equal(sub.parentFraction(), 0.4)
  assert.ok(Math.abs(sub.setFraction(0.5) - 0.6) < 1e-9)
  assert.equal(sub.finish(), 0.8)
})

test('runBackgroundTask：登记一行、report 更新、异常也收尾', async () => {
  const manager = new ConcurrentTasksProgressManager(() => 0)
  const seen = []
  const value = await runBackgroundTask({
    manager, id: 'x', title: '跑一个任务',
    task: async (report, signal) => {
      report({ detail: '半路', percent: 50 })
      seen.push(manager.get('x').detail, signal.aborted)
      return 42
    },
  })
  assert.equal(value, 42)
  assert.deepEqual(seen, ['半路', false])
  assert.equal(manager.get('x'), null, '跑完收掉')
  await assert.rejects(runBackgroundTask({
    manager, id: 'x', title: '会炸的任务',
    task: async () => { throw new Error('boom') },
  }), /boom/)
  assert.equal(manager.get('x'), null, '异常也收掉，界面里不留转圈的行')
})

test('整工程检查在任务表里登记一行，跑完/失败都收掉', async () => {
  let gate = null
  const pending = runWorkspaceInspection({
    query: () => new Promise(resolve => { gate = resolve }),
    diagnostics: new Map(),
    resultIds: new Map(),
  })
  const row = backgroundTaskManager.get(WORKSPACE_INSPECTION_TASK_ID)
  assert.ok(row, '检查期间状态栏列表能看到这一行')
  assert.equal(row.title, '正在检查代码')
  assert.equal(row.percent, -1, '整工程诊断拿不到总量 → 不确定式')
  gate({ available: false })
  const outcome = await pending
  assert.equal(outcome.ok, false)
  assert.equal(backgroundTaskManager.get(WORKSPACE_INSPECTION_TASK_ID), null, '跑完收掉')

  await assert.rejects(runWorkspaceInspection({
    query: async () => { throw new Error('连接断了') },
    diagnostics: new Map(),
    resultIds: new Map(),
  }), /连接断了/)
  assert.equal(backgroundTaskManager.get(WORKSPACE_INSPECTION_TASK_ID), null, '出错也收掉')
})
