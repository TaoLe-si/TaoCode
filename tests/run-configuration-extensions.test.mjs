// 运行配置扩展的插件贡献面（上游 `com.intellij.runConfigurationExtension`）+ 与起跑链的接线。
//
// 上游：`java/execution/impl/resources/intellij.java.execution.impl.xml:62` 声明该 EP，
// 接口 `RunConfigurationExtension`（`java/execution/impl/src/com/intellij/execution/RunConfigurationExtension.java:20-21`
// 的 `EP_NAME`）；`RunConfigurationExtensionManager.patchCommandLine` 在起进程前把同一个
// `GeneralCommandLine` 交给全部扩展（Coverage 插 agent / DevKit 加 VM 参数 / Gradle 改 classpath）。
// 本仓落点 `src/runConfigurationExtensions.ts`，消费点 `src/runActions.ts`（startRun 与调试两条通道）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  RUN_CONFIGURATION_EXTENSION_EP, applyCommandLineToParams, commandLineOf, patchRunCommandLine,
  registerRunConfigurationExtension, runConfigurationExtensions, unregisterRunConfigurationExtension,
} from '../src/runConfigurationExtensions.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('EP id 逐字取自上游 RunConfigurationExtension.EP_NAME 且已声明', () => {
  assert.equal(RUN_CONFIGURATION_EXTENSION_EP, 'com.intellij.runConfigurationExtension')
  assert.ok(EXTENSIONS.hasExtensionPoint(RUN_CONFIGURATION_EXTENSION_EP))
  // 内建没有 bundled 扩展 ⇒ 无插件时链为空（行为与改造前逐字相同）。
  assert.deepEqual(runConfigurationExtensions(), [])
})

test('patchCommandLine 改同一个命令行对象，按注册顺序逐条打补丁', () => {
  const handle = registerRunConfigurationExtension({
    id: 'plugin.coverage',
    isApplicableFor: config => config.type === 'application',
    patchCommandLine: (_config, _runnerSettings, cmdLine, runnerId, executorId) => {
      cmdLine.args.push(`-javaagent:cov.jar:${runnerId}/${executorId}`)
    },
  }, { source: 'user' })
  try {
    const cmdLine = commandLineOf({ command: 'run', program: 'java', args: ['-cp', 'out'], env: [] })
    const result = patchRunCommandLine(
      { name: 'App', type: 'application', command: 'run' }, cmdLine,
      { runnerId: 'GenericProgramRunner', executorId: 'Run' },
    )
    assert.equal(result.error, null)
    assert.deepEqual(result.applied, ['plugin.coverage'])
    assert.deepEqual(cmdLine.args, ['-cp', 'out', '-javaagent:cov.jar:GenericProgramRunner/Run'])
  } finally { handle.dispose() }
  assert.deepEqual(runConfigurationExtensions(), [], '注销后链为空')
})

test('isApplicableFor 为假的扩展不参与；isEnabledFor 说不开就不开', () => {
  const handle = registerRunConfigurationExtension({
    id: 'plugin.only-shell',
    isApplicableFor: config => config.type === 'shell',
    isEnabledFor: () => false,
    patchCommandLine: (_c, _r, cmdLine) => { cmdLine.args.push('should-not-appear') },
  }, { source: 'user' })
  try {
    const cmdLine = commandLineOf({ command: 'x', args: [] })
    const result = patchRunCommandLine(
      { name: 'A', type: 'application', command: 'x' }, cmdLine,
      { runnerId: 'GenericProgramRunner', executorId: 'Run' },
    )
    assert.equal(result.error, null)
    assert.deepEqual(result.applied, [])
    assert.deepEqual(cmdLine.args, [], '不适用的扩展一个字节都不改')
  } finally { handle.dispose() }
})

test('扩展抛错 = 取消这次执行（返回 error，且已打过的补丁仍在）', () => {
  const first = registerRunConfigurationExtension({
    id: 'plugin.ok',
    isApplicableFor: () => true,
    patchCommandLine: (_c, _r, cmdLine) => { cmdLine.args.push('--ok') },
  }, { source: 'user' })
  const second = registerRunConfigurationExtension({
    id: 'plugin.boom',
    isApplicableFor: () => true,
    patchCommandLine: () => { throw new Error('agent 找不到') },
  }, { source: 'user' })
  try {
    const cmdLine = commandLineOf({ command: 'x', args: [] })
    const result = patchRunCommandLine(
      { name: 'A', type: 'shell', command: 'x' }, cmdLine,
      { runnerId: 'GenericProgramRunner', executorId: 'Run' },
    )
    assert.match(result.error, /plugin\.boom/)
    assert.match(result.error, /agent 找不到/)
    assert.deepEqual(result.applied, ['plugin.ok'], '前面成功的那条如实记账')
  } finally { first.dispose(); second.dispose() }
})

test('applyCommandLineToParams 把扩展改过的格子写回启动参数（空数组也写回）', () => {
  const params = { command: 'x', program: 'old', args: ['a'], env: ['A=1'], cwd: 'old' }
  const cmdLine = commandLineOf({ command: 'x', program: 'new', args: [], env: [], cwd: 'new' })
  applyCommandLineToParams(cmdLine, params)
  assert.equal(params.program, 'new')
  assert.deepEqual(params.args, [], '清空参数是合法操作，必须写回')
  assert.deepEqual(params.env, [])
  assert.equal(params.cwd, 'new')
})

test('unregister 对未注册过的 id 返回 false（与宿主同口径）', () => {
  assert.equal(unregisterRunConfigurationExtension('never.registered'), false)
})

test('真实消费点：runActions 的起跑与调试两条通道都过 patchRunCommandLine', () => {
  const actions = read('src/runActions.ts')
  assert.match(actions, /import \{[\s\S]*patchRunCommandLine,[\s\S]*\} from '\.\/runConfigurationExtensions\.ts'/,
    '启动链要引补丁入口')
  assert.match(actions, /const patch = patchRunCommandLine\(extensionConfigOf\(config\), commandLineOf\(params\), \{/,
    '普通运行在 run.start 之前把命令行交给扩展')
  assert.match(actions, /if \(patch\.error\) \{ notify\(patch\.error, true\); return null \}/,
    '扩展抛错就取消这次执行（不走到 run.start）')
  assert.match(actions, /function patchDebugLaunch\(/, '调试那条通道同样有补丁位')
  assert.match(actions, /const patch = patchRunCommandLine\(extensionConfigOf\(config\), cmdLine, \{/,
    '调试适配器命令行也过同一条链')
})
