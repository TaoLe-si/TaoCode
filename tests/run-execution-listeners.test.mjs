// ExecutionListener 主题（上游 `com.intellij.execution.ExecutionListener` + `ExecutionManager.EXECUTION_TOPIC`）
// 在本仓的落点：注册表 `src/executionListeners.ts`，事件由 `src/runInstances.ts` 的运行实例状态机发出，
// 起跑的 schedule/starting/notStarted 三条由 `src/runActions.ts` 发。
//
// 上游口径：`platform/execution/src/com/intellij/execution/ExecutionListener.java:13-58`（八个默认空方法）、
// `platform/execution-impl/src/com/intellij/execution/impl/ExecutionManagerImpl.kt:327/335/338/384/1198/1216`
// （六个发信点）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { EXECUTION_LISTENER_EP, EXECUTION_TOPIC, ExecutionListenerRegistry, executionEnvironmentOf, executionListeners, registerExecutionListener } from '../src/executionListeners.ts'
import { handleRunExit, handleRunStarted, markRunInstanceStopping, runInstances, setRunInstanceExecutor } from '../src/runInstances.ts'
import { APPLICATION_SCOPE, EXTENSIONS } from '../src/extensionPoints.ts'
import { PROGRAM_RUNNER_EP, allProgramRunners, registerProgramRunner } from '../src/programRunners.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('topic 名 = 上游的 EXECUTION_TOPIC', () => {
  assert.equal(EXECUTION_TOPIC, 'com.intellij.execution.ExecutionListener')
  const upstream = readFileSync(
    new URL('../../Backup/Downloads/intellij-community-master/intellij-community-master/platform/execution-impl/resources/intellij.platform.execution.impl.xml',
      import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    'utf8',
  )
  assert.match(upstream, new RegExp(`topic="${EXECUTION_TOPIC.replace(/\./g, '\\.')}"`), '上游 xml 里要有这个 topic')
})

test('六个 dispatch 入口按注册顺序发信、载荷对位', () => {
  const registry = new ExecutionListenerRegistry()
  const seen = []
  const off = registry.subscribe({
    processStartScheduled: env => seen.push(['startScheduled', env.executorId, env.runProfile.name]),
    processStarting: (env, handler) => seen.push(['starting', env.instanceId, handler?.pid ?? -1]),
    processNotStarted: (env, cause) => seen.push(['notStarted', env.runProfile.name, cause ?? '']),
    processStarted: (env, handler) => seen.push(['started', env.instanceId, handler.isRunning]),
    processTerminating: (env, handler) => seen.push(['terminating', env.instanceId, handler.isProcessTerminating]),
    processTerminated: (env, handler, code) => seen.push(['terminated', env.instanceId, code]),
  })
  const env = executionEnvironmentOf(7, 'demo', 'Debug', 'shell', 'C:/proj')
  const handler = { instanceId: 7, label: 'demo', pid: 4242, isRunning: true, isProcessTerminating: false, exitCode: null }
  registry.processStartScheduled(env)
  registry.processStarting(env)
  registry.processNotStarted(env, 'boom')
  registry.processStarted(env, handler)
  registry.processTerminating(env, { ...handler, isProcessTerminating: true })
  registry.processTerminated(env, handler, 3)
  assert.deepEqual(seen, [
    ['startScheduled', 'Debug', 'demo'],
    ['starting', 7, -1],
    ['notStarted', 'demo', 'boom'],
    ['started', 7, true],
    ['terminating', 7, true],
    ['terminated', 7, 3],
  ])
  off()
  assert.equal(registry.listenerCount, 0)
})

test('一个监听器抛错不打断其余监听器，也不打断调用方；错误记进 drainErrors', () => {
  const registry = new ExecutionListenerRegistry()
  const calls = []
  registry.subscribe({ processStarted: () => { throw new Error('bad listener') } })
  registry.subscribe({ processStarted: () => calls.push('second') })
  const env = executionEnvironmentOf(1, 'x', 'Run')
  assert.doesNotThrow(() => registry.processStarted(env, { instanceId: 1, label: 'x', pid: 0, isRunning: true, isProcessTerminating: false, exitCode: null }))
  assert.deepEqual(calls, ['second'], '坏监听器后面的照发')
  const errors = registry.drainErrors()
  assert.equal(errors.length, 1)
  assert.equal(errors[0].phase, 'processStarted')
  assert.equal(registry.drainErrors().length, 0, '取走即清空')
})

test('运行实例状态机发 Starting/Started/Terminating/Terminated（executor 与配置类型按登记）', () => {
  const seen = []
  const off = executionListeners.subscribe({
    processStarted: (env, handler) => seen.push(['started', env.executorId, env.runProfile.name, env.runProfile.type, handler.pid]),
    processTerminating: (env, handler) => seen.push(['terminating', env.instanceId, handler.isProcessTerminating]),
    processTerminated: (env, handler, code) => seen.push(['terminated', env.runProfile.name, code]),
  })
  try {
    setRunInstanceExecutor(9301, 'Debug', 'shell')
    handleRunStarted({ instance: 9301, label: 'cfg A' })
    markRunInstanceStopping(9301)
    handleRunExit({ instance: 9301, code: 7, aborted: true })
    assert.deepEqual(seen, [
      ['started', 'Debug', 'cfg A', 'shell', 0],
      ['terminating', 9301, true],
      ['terminated', 'cfg A', 7],
    ])
  } finally {
    off()
    runInstances.delete(9301)
    executionListeners.drainErrors()
  }
})

test('没登记 executor 的实例按 Run 兜底，label 空时给出占位名', () => {
  const seen = []
  const off = executionListeners.subscribe({ processStarted: env => seen.push([env.executorId, env.runProfile.name]) })
  try {
    handleRunStarted({ instance: 9302 })
    assert.deepEqual(seen, [['Run', 'Run #9302']])
  } finally {
    off()
    runInstances.delete(9302)
  }
})

test('runActions 起跑链路接上 schedule/starting/notStarted 三条 + 登记 executor', () => {
  const src = read('src/runActions.ts')
  assert.match(src, /executionListeners\.processStartScheduled\(runEnv\)/)
  assert.match(src, /executionListeners\.processStarting\(runEnv\)/)
  assert.match(src, /executionListeners\.processNotStarted\(runEnv, errorMessage\(error\)\)/)
  // 实例登记的 executorId 仍出自 `com.intellij.executor` 表：2026-10-07（executors lane）起走
  // `src/runActions.ts` 的 `selectExecutor` 解析出的那条执行器，不再是第二份 id 字面量。
  assert.match(src, /setRunInstanceExecutor\(started\.instance, executor\.getId\(\), config\.type\)/)
})

test('runInstances 事件链路接上 started/terminating/terminated 三条', () => {
  const src = read('src/runInstances.ts')
  assert.match(src, /executionListeners\.processStarted\(/)
  assert.match(src, /executionListeners\.processTerminating\(/)
  assert.match(src, /executionListeners\.processTerminated\(/)
})

test('ExecutionListener 暴露成 EP：插件经 EXTENSIONS 注册的监听器会被单例发到', () => {
  assert.equal(EXECUTION_LISTENER_EP, EXECUTION_TOPIC)
  assert.ok(EXTENSIONS.hasExtensionPoint(EXECUTION_LISTENER_EP), 'EP 必须已声明')
  const seen = []
  const dispose = registerExecutionListener({ processStarted: env => seen.push(env.runProfile.name) }, 'test.exec.listener')
  try {
    executionListeners.processStarted(executionEnvironmentOf(1, 'plugged', 'Run'), {
      instanceId: 1, label: 'plugged', pid: 0, isRunning: true, isProcessTerminating: false, exitCode: null,
    })
    assert.deepEqual(seen, ['plugged'])
    assert.equal(executionListeners.listenerCount, 1)
  } finally { dispose() }
  assert.equal(executionListeners.listenerCount, 0)
})

test('ProgramRunner 暴露成 EP：插件贡献的 runner 进匹配链且内建仍优先', () => {
  assert.equal(PROGRAM_RUNNER_EP, 'com.intellij.programRunner')
  assert.ok(EXTENSIONS.hasExtensionPoint(PROGRAM_RUNNER_EP))
  const pluginRunner = { runnerId: 'MyPluginRunner', executorId: 'Run', canRun: () => false, refusalReason: () => 'no' }
  const dispose = registerProgramRunner(pluginRunner, 'test.plugin.runner')
  try {
    assert.ok(allProgramRunners().some(runner => runner.runnerId === 'MyPluginRunner'), '插件 runner 要在表里')
    assert.equal(allProgramRunners()[0].runnerId, 'GenericProgramRunner', '内建在前')
  } finally { dispose() }
  assert.ok(!allProgramRunners().some(runner => runner.runnerId === 'MyPluginRunner'))
})

test('两个 EP 的方法面/插件面在本仓扩展点宿主里注册（协调者新规：缺口要给插件可调用接口）', () => {
  assert.ok(EXTENSIONS.extensionPointIds().includes(EXECUTION_LISTENER_EP))
  assert.ok(EXTENSIONS.extensionPointIds().includes(PROGRAM_RUNNER_EP))
  assert.equal(typeof APPLICATION_SCOPE, 'string')
  const exec = read('src/executionListeners.ts')
  for (const method of ['processStartScheduled', 'processStarting', 'processNotStarted', 'processStarted', 'processTerminating', 'processTerminated']) {
    assert.match(exec, new RegExp(method), `上游方法名 ${method} 必须在监听器面上`)
  }
})
