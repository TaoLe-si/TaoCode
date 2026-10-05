// `ic/application` 的启动命令/激活/预加载判据
// （`src/applicationStarters.ts` + `src/applicationActivation.ts` + `src/preloadingActivities.ts` 与接线）。
//
// 上游依据：
//   · `ApplicationStarter`/`ApplicationStarterEP`（ide-core/.../openapi/application）：
//     `findStarter(key)`、`isInternal`（不进 `--list-commands`）、`main(args)`；
//     `EnvironmentKeyStubGenerator` 的 `COMMAND_NAME = "generateEnvironmentKeysFile"`；
//   · `ApplicationActivationListener` 的三个回调与 `app.deactivation.timeout`（默认 1s）的延迟通知；
//   · `PreloadingActivity.preload/execute`：应用初始化后、项目打开前预热。
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applicationStarters, parseStarterCommandLine, runApplicationStarter } from '../src/applicationStarters.ts'
import { DEACTIVATION_TIMEOUT_MS, createApplicationActivation } from '../src/applicationActivation.ts'
import { registerPreloadingActivity, registeredPreloadingActivities, resetPreloadingActivities, runPreloadingActivities } from '../src/preloadingActivities.ts'

test('启动命令注册表：找命令、list-commands 不列内部命令、未知命令未处理', async () => {
  assert.ok(applicationStarters.find('list-commands'), '内置 list-commands 不在表里')
  assert.ok(applicationStarters.find('generateEnvironmentKeysFile'), '环境键存根启动器不在表里')
  assert.equal(applicationStarters.find('no-such-command'), null)
  const listed = applicationStarters.listCommands()
  assert.ok(listed.some(row => row.startsWith('generateEnvironmentKeysFile')), '存根启动器要出现在命令表里')
  const result = await runApplicationStarter('no-such-command')
  assert.equal(result.handled, false)
  assert.equal(result.exitCode, 1)
})

test('命令行解析：?command=…&args=…（重复 args 保序），没有 command 回 null', () => {
  assert.equal(parseStarterCommandLine(''), null)
  assert.equal(parseStarterCommandLine('?other=1'), null)
  assert.deepEqual(parseStarterCommandLine('?command=list-commands'), { command: 'list-commands', args: [] })
  assert.deepEqual(parseStarterCommandLine('?command=generateEnvironmentKeysFile&args=--stdout&args=--no-descriptions'),
    { command: 'generateEnvironmentKeysFile', args: ['--stdout', '--no-descriptions'] })
})

test('generateEnvironmentKeysFile：--stdout/--no-descriptions/--file 冲突，输出是 JSON 数组', async () => {
  const stdout = await runApplicationStarter('generateEnvironmentKeysFile', ['--stdout'])
  assert.equal(stdout.exitCode, 0)
  assert.deepEqual(JSON.parse(stdout.output), [], '没有注册键时是空数组')
  const conflict = await runApplicationStarter('generateEnvironmentKeysFile', ['--file=x.json', '--stdout'])
  assert.equal(conflict.exitCode, 1)
  assert.match(conflict.error ?? '', /Only one of --file and --stdout/)
  const list = await runApplicationStarter('list-commands')
  assert.match(list.output, /list-commands/)
})

test('激活监听器：焦点进出广播、计数与时间、延迟失活在 1s 内重新激活则撤销', async () => {
  const listeners = []
  const activation = createApplicationActivation(() => 100)
  activation.addApplicationActivationListener({
    applicationActivated: () => listeners.push('activated'),
    applicationDeactivated: () => listeners.push('deactivated'),
    delayedApplicationDeactivated: () => listeners.push('delayed'),
  })
  activation.applicationActivated()
  assert.deepEqual(listeners, ['activated'])
  assert.equal(activation.state.active, true)
  assert.equal(activation.state.activations, 1)
  activation.applicationDeactivated()
  assert.deepEqual(listeners, ['activated', 'deactivated'])
  assert.equal(activation.state.active, false)
  assert.equal(activation.state.deactivations, 1)
  assert.equal(DEACTIVATION_TIMEOUT_MS, 1000)
  // 立刻又激活：延迟失活的定时器要撤销（短暂失焦不算离开）。
  activation.applicationActivated()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(listeners, ['activated', 'deactivated', 'activated'], '延迟回调不该出现')
  activation.dispose()
})

test('延迟失活：过了 app.deactivation.timeout 且没再激活才广播', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const events = []
    const activation = createApplicationActivation()
    activation.addApplicationActivationListener({ delayedApplicationDeactivated: () => events.push('delayed') })
    activation.applicationActivated()
    activation.applicationDeactivated()
    assert.deepEqual(events, [], '刚失活不立刻广播延迟通知')
    mock.timers.tick(DEACTIVATION_TIMEOUT_MS - 1)
    assert.deepEqual(events, [], '没到超时不该广播')
    mock.timers.tick(1)
    assert.deepEqual(events, ['delayed'], '超时后广播一次')
    // 重新激活会撤销在途的延迟通知。
    activation.applicationActivated()
    activation.applicationDeactivated()
    activation.applicationActivated()
    mock.timers.tick(DEACTIVATION_TIMEOUT_MS + 10)
    assert.deepEqual(events, ['delayed'], '1 秒内又激活：不发延迟通知')
    activation.dispose()
  } finally {
    mock.timers.reset()
  }
})

test('预加载活动：顺序跑、单个失败不打断、失败清单可上报', async () => {
  resetPreloadingActivities()
  const order = []
  const failures = []
  registerPreloadingActivity({ id: 'a', preload: () => { order.push('a') } })
  registerPreloadingActivity({ id: 'b', preload: () => { order.push('b'); throw new Error('x') } })
  registerPreloadingActivity({ id: 'c', preload: async () => { order.push('c') } })
  const result = await runPreloadingActivities((activity, error) => failures.push([activity.id, String(error)]))
  assert.deepEqual(order, ['a', 'b', 'c'])
  assert.deepEqual(result.failed.map(item => item.id), ['b'])
  assert.deepEqual(failures, [['b', 'Error: x']])
  assert.deepEqual(registeredPreloadingActivities().map(item => item.id), ['a', 'b', 'c'])
  resetPreloadingActivities()
})

test('接线：focus/blur 广播激活事件；bootstrap 跑预加载；main 认 ?command', () => {
  const appearance = readFileSync('src/appearanceActions.ts', 'utf8')
  assert.ok(appearance.includes('applicationActivation.applicationActivated()'), 'focus 没有广播激活')
  assert.ok(appearance.includes('applicationActivation.applicationDeactivated()'), 'blur 没有广播失活')
  const lifecycle = readFileSync('src/workspaceLifecycle.ts', 'utf8')
  assert.ok(lifecycle.includes('void runPreloadingActivities('), 'bootstrap 没有跑预加载活动')
  assert.ok(lifecycle.includes("id: 'taocode.warmJdkCache'"), 'JDK 预热没有作为预加载活动登记')
  const main = readFileSync('src/main.ts', 'utf8')
  assert.ok(main.includes('parseStarterCommandLine(window.location.search)'), 'main 没有解析 ?command')
  assert.ok(main.includes('runApplicationStarter(starterCommand.command, starterCommand.args)'), 'main 没有跑启动命令')
})
