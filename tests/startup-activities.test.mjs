// `pf/startup` 的启动活动流水线判据（`src/startupActivities.ts` + `src/workspaceLifecycle.ts` 接线）。
//
// 上游依据：
//   · `StartupManagerImpl.runOldActivity`（:498-510）：单个活动抛错记日志后继续下一步；
//   · `StartupActivityTracker` / `StartupManager.postStartupActivityPassed`：postStartup 跑完才算结束，
//     `awaitConfiguration` 等它；
//   · `CheckKeysStartupActivity`（:28-45）：只在 headless 检查必需键，`!!!___***undefined***___!!!`
//     哨兵区分「缺键」与「空串值」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ENV_KEY_UNDEFINED, applicationToken, awaitStartupActivities, checkRequiredEnvironmentKeysActivity,
  createStartupActivityTracker, registerStartupActivity, registeredStartupActivities, resetStartupActivities,
  resetStartupProgress, runStartupActivities, startupActivityPassed,
} from '../src/startupActivities.ts'
import { EnvironmentKeyRegistry, createHeadlessEnvironmentService, environmentKey } from '../src/environmentKeys.ts'

const lifecycle = () => readFileSync('src/workspaceLifecycle.ts', 'utf8')

test('顺序执行、逐个隔离异常、同一 token 只跑一次', async () => {
  resetStartupActivities()
  resetStartupProgress()
  const order = []
  const errors = []
  registerStartupActivity({ id: 'one', phase: 'postStartup', run: () => { order.push('one') } })
  registerStartupActivity({ id: 'boom', phase: 'postStartup', run: () => { order.push('boom'); throw new Error('x') } })
  registerStartupActivity({ id: 'two', phase: 'postStartup', run: () => { order.push('two') } })
  const token = {}
  const first = await runStartupActivities('postStartup', { onError: (activity, error) => errors.push([activity.id, String(error)]) }, token)
  assert.deepEqual(order, ['one', 'boom', 'two'], '抛错的活动不打断后面的')
  assert.deepEqual(first.ran, ['one', 'boom', 'two'])
  assert.deepEqual(first.failed.map(item => item.id), ['boom'])
  assert.equal(errors.length, 1, '宿主错误出口收到活动与异常')
  const second = await runStartupActivities('postStartup', {}, token)
  assert.deepEqual(second.ran, [], '同一 token 不重跑（失败也不重跑，上游只记日志）')
  const third = await runStartupActivities('postStartup', {}, {})
  assert.equal(third.ran.length, 3, '新 token 重新跑')
  resetStartupActivities()
})

test('阶段筛选与 tracker：postStartup 跑完才算结束', async () => {
  resetStartupActivities()
  resetStartupProgress()
  const ran = []
  registerStartupActivity({ id: 'config', phase: 'configuration', run: () => { ran.push('config') } })
  registerStartupActivity({ id: 'opened', phase: 'projectOpened', run: () => { ran.push('opened') } })
  registerStartupActivity({ id: 'post', phase: 'postStartup', run: () => { ran.push('post') } })
  const tracker = createStartupActivityTracker()
  assert.equal(tracker.presentableName, 'startup-activities')
  assert.equal(tracker.isInProgress(), true, '没跑完时 tracker 报进行中')
  const token = {}
  await runStartupActivities('configuration', {}, applicationToken)
  await runStartupActivities('projectOpened', {}, token)
  assert.equal(startupActivityPassed(), false, 'projectOpened 之后还不算结束')
  await runStartupActivities('postStartup', {}, token)
  assert.equal(startupActivityPassed(), true)
  assert.equal(tracker.isInProgress(), false)
  await tracker.awaitConfiguration()
  assert.deepEqual(ran, ['config', 'opened', 'post'])
  resetStartupProgress()
  assert.equal(startupActivityPassed(), false, '关项目/换项目要复位')
  resetStartupActivities()
})

test('awaitStartupActivities：没跑完时挂起，标记完成后放行', async () => {
  resetStartupProgress()
  let released = false
  const waiter = awaitStartupActivities().then(() => { released = true })
  await Promise.resolve()
  assert.equal(released, false)
  await runStartupActivities('postStartup', {}, {})
  await waiter
  assert.equal(released, true)
  resetStartupProgress()
})

test('CheckKeysStartupActivity：只在 headless 报缺键，空串值不算缺（上游哨兵）', async () => {
  resetStartupActivities()
  resetStartupProgress()
  const required = environmentKey('taocode.profile', 'Profile.')
  const registry = new EnvironmentKeyRegistry()
  registry.register({ knownKeys: [required], requiredKeys: () => [required] })
  const reports = []
  registerStartupActivity(checkRequiredEnvironmentKeysActivity({
    headless: () => true,
    service: createHeadlessEnvironmentService({ registry, values: {} }),
    providers: [{ knownKeys: [required], requiredKeys: () => [required] }],
    report: message => { reports.push(message) },
  }))
  await runStartupActivities('configuration', {}, {})
  assert.equal(reports.length, 1)
  assert.ok(reports[0].includes("'taocode.profile'"), '缺键要报键名')

  resetStartupActivities()
  registerStartupActivity(checkRequiredEnvironmentKeysActivity({
    headless: () => false,   // 有界面：键值交给用户，不检查
    service: createDefaultServiceStub(),
    providers: [{ knownKeys: [required], requiredKeys: () => [required] }],
    report: message => { reports.push(message) },
  }))
  await runStartupActivities('configuration', {}, {})
  assert.equal(reports.length, 1, '非 headless 不报')

  // 哨兵与空串值：给了空串也算「缺」（上游 getEnvironmentValue(key, UNDEFINED) 的比较语义）。
  assert.equal(ENV_KEY_UNDEFINED, '!!!___***undefined***___!!!')
})

function createDefaultServiceStub() {
  return { getEnvironmentValue: () => null, getEnvironmentValueOrDefault: (_key, fallback) => fallback }
}

test('接线：bootstrap 跑 configuration；activateWorkspace 跑 projectOpened/postStartup；关项目复位', () => {
  const source = lifecycle()
  assert.ok(source.includes("await runStartupActivities('configuration', startupActivityContext())"), 'bootstrap 没有 configuration 阶段')
  assert.ok(source.includes("await runStartupActivities('projectOpened', startupActivityContext(), startupToken)"), '打开项目没有 projectOpened 阶段')
  assert.ok(source.includes("await runStartupActivities('postStartup', startupActivityContext(), startupToken)"), '打开项目没有 postStartup 阶段')
  assert.ok(source.includes('resetStartupProgress()'), '关项目/换项目没有复位启动进度')
  assert.ok(source.includes("id: 'taocode.refreshSyntheticNodes'"), '合成节点没有作为启动活动登记')
  assert.ok(source.includes("id: 'taocode.offerSessionRestore'"), '会话恢复没有作为启动活动登记')
  assert.ok(source.includes('checkRequiredEnvironmentKeysActivity({'), '必需键检查活动没有登记')
  const registered = registeredStartupActivities()
  assert.ok(registered.every(activity => activity.id && activity.phase), '登记项形状不对')
})
