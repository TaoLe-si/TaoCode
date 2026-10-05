// 复合配置（IDEA `CompoundRunConfiguration`）的**运行顺序**判据。
//
// 这段逻辑原先埋在 `src/runActions.ts` 的宿主里（要 request/notify/workspace），一条判据都写不出来；
// 2026-10-04 抽到 `src/runCompound.ts` 之后，三件容易写错的事才可测：
//   ① 整组预检要在启动**第一个**成员之前做完（含嵌套成员）；
//   ② 失败只回滚**本次启动**的实例（别动用户早就在跑的）；
//   ③ debug 成员要拒绝（本仓 DAP 只有一个会话）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { planCompoundRun, runCompound } from '../src/runCompound.ts'

const config = (name, over = {}) => ({ name, type: 'shell', command: `run-${name}`, ...over })
const shell = () => [config('api'), config('client'), config('probe', { type: 'debug', command: 'debug-probe' })]

test('整组预检：成员存在性/环/字段约束都在启动前被拦下', () => {
  const configs = shell()
  const all = config('all', { type: 'compound', command: '', configurations: ['api', 'client'] })
  assert.deepEqual(planCompoundRun(all, [...configs, all]).members.map(m => m.name), ['api', 'client'])

  const missing = config('bad', { type: 'compound', command: '', configurations: ['nope'] })
  assert.match(planCompoundRun(missing, configs).error, /不存在/)
  const cyclic = config('loop', { type: 'compound', command: '', configurations: ['loop'] })
  assert.match(planCompoundRun(cyclic, configs).error, /自身|循环/)
  const withDebug = config('mixed', { type: 'compound', command: '', configurations: ['api', 'probe'] })
  assert.match(planCompoundRun(withDebug, configs).error, /调试配置/)
  const badEnv = config('badenv', { env: ['NOPE'] })
  assert.match(planCompoundRun(config('c', { type: 'compound', command: '', configurations: ['badenv'] }), [...configs, badEnv]).error, /KEY=VALUE/)
})

test('嵌套复合配置摊平成叶子，共享成员只出现一次', () => {
  const inner = config('inner', { type: 'compound', command: '', configurations: ['client'] })
  const outer = config('outer', { type: 'compound', command: '', configurations: ['api', 'inner'] })
  const plan = planCompoundRun(outer, [...shell(), inner, outer])
  assert.equal(plan.error, null)
  assert.deepEqual(plan.members.map(m => m.name), ['api', 'client'])
})

test('顺序：按成员表依次启动，每个成员用**自己**的启动字段', async () => {
  const api = config('api', { args: ['--port', '1'], cwd: 'api', env: ['A=1'] })
  const client = config('client', { beforeLaunch: [{ name: 'gen', command: 'gen' }] })
  const all = config('all', { type: 'compound', command: '', configurations: ['api', 'client'] })
  const order = []
  const outcome = await runCompound(all, [api, client, all], {
    start: async member => { order.push(member); return order.length },
    stop: async () => { throw new Error('不该回滚') },
  })
  assert.deepEqual(outcome, { started: [1, 2], failed: null })
  assert.deepEqual(order.map(m => m.name), ['api', 'client'])
  assert.deepEqual(order[0].args, ['--port', '1'])
  assert.deepEqual(order[1].beforeLaunch, [{ name: 'gen', command: 'gen' }])
})

test('失败回滚只停本次启动的实例，并且报出是哪个成员失败的', async () => {
  const all = config('all', { type: 'compound', command: '', configurations: ['a', 'b', 'c'] })
  const members = [config('a'), config('b'), config('c')]
  const stopped = []
  const outcome = await runCompound(all, [...members, all], {
    start: async member => (member.name === 'c' ? null : 100 + ['a', 'b'].indexOf(member.name) + 1),
    stop: async instance => { stopped.push(instance) },
  })
  assert.deepEqual(stopped, [101, 102], '只回滚本次起来的那两个')
  assert.equal(outcome.started.length, 2)
  assert.match(outcome.failed, /成员「c」启动失败/)
})

test('回滚时"成员已经自己退出"不算错误（run.stop 抛异常要吞掉）', async () => {
  const all = config('all', { type: 'compound', command: '', configurations: ['a', 'b'] })
  const outcome = await runCompound(all, [config('a'), config('b'), all], {
    start: async member => (member.name === 'b' ? null : 7),
    stop: async () => { throw new Error('RUNTIME_NOT_FOUND') },
  })
  assert.equal(outcome.started.length, 1)
  assert.match(outcome.failed, /启动失败/)
})

test('工作区中途被换掉：不再往下启动，也不当成失败', async () => {
  const all = config('all', { type: 'compound', command: '', configurations: ['a', 'b', 'c'] })
  let live = true
  const started = []
  const outcome = await runCompound(all, [config('a'), config('b'), config('c'), all], {
    start: async member => { started.push(member.name); live = member.name !== 'a'; return started.length },
    stop: async () => { throw new Error('不该回滚') },
    stillCurrent: () => live,
  })
  assert.deepEqual(started, ['a'])
  assert.equal(outcome.failed, null)
})

test('预检失败时一个成员都不启动（顺序日志为空）', async () => {
  const all = config('all', { type: 'compound', command: '', configurations: ['ghost'] })
  const started = []
  const outcome = await runCompound(all, [all], { start: async () => { started.push('x'); return 1 }, stop: async () => {} })
  assert.deepEqual(started, [])
  assert.deepEqual(outcome.started, [])
  assert.match(outcome.failed, /不存在/)
})
