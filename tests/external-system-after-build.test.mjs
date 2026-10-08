// 构建后阶段（AFTER_COMPILE / AFTER_REBUILD）触发任务的判据。
//
// 被测模块：`src/externalSystemAfterBuild.ts`（`ExternalSystemTaskActivator` 的 after 分支等价物）。
// 上游依据：`platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/project/manage/
// ExternalSystemTaskActivator.java:375-398`（Phase 两档）、`:92-129`（`doExecuteBuildPhaseTriggers`
// 的 after 分支走 AFTER_REBUILD + AFTER_COMPILE）、`:223-254`（`runTasksQueue` 串行、首个失败即停，
// 失败文案 `dialog.message.after.build.triggering.task.failed`）；触发点 `ProjectTaskManagerImpl.java:450`
// 的 `if (!result.isAborted() && !result.hasErrors())` = 只在构建成功时跑。
//
// 消费方：`src/runActions.ts:209` 的 `activatedAfterBuildSteps(rebuild)` 与 `:491`
// 的 `runActivatedAfterBuild(runExitCode(...), afterPhases, { runStep, notify })`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { afterBuildPhase, runActivatedAfterBuild } from '../src/externalSystemAfterBuild.ts'

const step = (name, command = name) => ({ name, command })

/** 收集 notify 的桩。 */
function recorder() {
  const calls = []
  return { calls, notify: (message, error) => calls.push({ message, error: Boolean(error) }) }
}

test('重建走 AFTER_REBUILD、编译走 AFTER_COMPILE', () => {
  assert.equal(afterBuildPhase(true), 'afterRebuild')
  assert.equal(afterBuildPhase(false), 'afterCompile')
})

test('没有激活任务：一次都不等构建退出（skipped）', async () => {
  const ran = []
  const out = await runActivatedAfterBuild(Promise.resolve(0), [], {
    runStep: async s => { ran.push(s); return true },
    notify: () => {},
  })
  assert.equal(out, 'skipped')
  assert.deepEqual(ran, [], '空表不该跑任何步骤')
})

test('构建失败（非 0 退出码）：一条都不跑（skipped）', async () => {
  const ran = []
  const { calls, notify } = recorder()
  const out = await runActivatedAfterBuild(Promise.resolve(1), [step('a'), step('b')], {
    runStep: async s => { ran.push(s); return true },
    notify,
  })
  assert.equal(out, 'skipped')
  assert.deepEqual(ran, [], '构建没成功就不该触发 after 任务')
  assert.deepEqual(calls, [], 'skipped 不报错')
})

test('构建成功：按顺序串行跑完（ok）', async () => {
  const order = []
  const { calls, notify } = recorder()
  const out = await runActivatedAfterBuild(Promise.resolve(0), [step('a'), step('b'), step('c')], {
    runStep: async s => { order.push(s.name); return true },
    notify,
  })
  assert.equal(out, 'ok')
  assert.deepEqual(order, ['a', 'b', 'c'], '串行且保序')
  assert.deepEqual(calls, [])
})

test('某条返回假：立刻停下、不再跑后面的，并报一次错（failed）', async () => {
  const order = []
  const { calls, notify } = recorder()
  const out = await runActivatedAfterBuild(Promise.resolve(0), [step('a'), step('b'), step('c')], {
    runStep: async s => { order.push(s.name); return s.name !== 'b' },
    notify,
  })
  assert.equal(out, 'failed')
  assert.deepEqual(order, ['a', 'b'], '失败的那条之后不再跑')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].error, true)
  assert.match(calls[0].message, /b/, '失败文案要点出是哪条任务')
})

test('某条抛错：同样停下并报错（failed），异常不外泄', async () => {
  const order = []
  const { calls, notify } = recorder()
  const out = await runActivatedAfterBuild(Promise.resolve(0), [step('a'), step('boom')], {
    runStep: async s => { order.push(s.name); if (s.name === 'boom') throw new Error('x'); return true },
    notify,
  })
  assert.equal(out, 'failed')
  assert.deepEqual(order, ['a', 'boom'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].error, true)
})

test('等待退出码是异步的：先等它回来再决定跑不跑', async () => {
  let resolveExit
  const exit = new Promise(r => { resolveExit = r })
  const ran = []
  const pending = runActivatedAfterBuild(exit, [step('a')], {
    runStep: async s => { ran.push(s); return true },
    notify: () => {},
  })
  await Promise.resolve()
  assert.deepEqual(ran, [], '退出码还没回来时不该开跑')
  resolveExit(0)
  assert.equal(await pending, 'ok')
  assert.deepEqual(ran, [step('a')])
})