// 判据 · `com.intellij.executor` 的**本体落地**（`src/executors.ts`）与它的真实消费点。
//
// 上游依据（逐条开文件核过）：
//   · EP 声明 `platform/execution/resources/intellij.platform.execution.xml:32`
//     `<extensionPoint qualifiedName="com.intellij.executor" interface="com.intellij.execution.Executor" dynamic="true"/>`；
//   · 两条内建贡献 `:48`（`DefaultRunExecutor`，`order="first" id="run"`）与
//     `platform/xdebugger-impl/resources/intellij.platform.debugger.impl.content.xml:36`
//     （`DefaultDebugExecutor`，`order="first,after run" id="debug"`）；
//   · 方法面 `platform/execution/src/com/intellij/execution/Executor.java`
//     （`getId`/`getActionName`/`getStartActionText(name)`/`getDescription`/`getToolWindowId`/
//     `getContextActionId`/`getHelpId`/`isApplicable(project)`/`isSupportedOnTarget`/`shortenNameIfNeeded`）；
//   · 注册表 `ExecutorRegistry.java`（`getExecutorById`）。
//
// 钉四件事：
//   ① EP id 与内建两条的 id/工具窗口/上下文动作 id/帮助 id 逐字取自上游；
//   ② 注册表五个面（register/unregister/adoptFromExtensions/find/all）+ 上游写法（`getId()`）也能挂；
//   ③ `resolve` 三道门（没注册 / isApplicable / isSupportedOnTarget）各有可见原因；
//   ④ 消费点是活的：`src/runActions.ts` 从注册表取执行器、按 `getToolWindowId()` 落窗口、
//      启动文案取 `getStartActionText(name)`；实例行模型带执行器显示名。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BUILTIN_EXECUTORS, DEBUG_EXECUTOR_ID, DEBUG_TOOL_WINDOW_ID, EXECUTOR_EP, RUN_EXECUTOR_ID,
  RUN_TOOL_WINDOW_ID, declareExecutorExtensionPoint, executorById, executorRegistry, executors,
  executorStartActionText, executorToolWindowTitle, normalizeExecutor, registerBundledExecutor,
  registerExecutor, resolveExecutor, shortenNameIfNeeded, toolWindowForExecutor,
} from '../src/executors.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import { runInstanceExecutorName, runInstanceRows, runInstances, setRunInstanceExecutor } from '../src/runInstances.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('EP id 与内建两条执行器的常量逐字取自上游', () => {
  assert.equal(EXECUTOR_EP, 'com.intellij.executor')
  assert.ok(EXTENSIONS.hasExtensionPoint(EXECUTOR_EP), 'EP 必须在宿主里声明')
  declareExecutorExtensionPoint()   // 幂等，不抛
  assert.equal(RUN_EXECUTOR_ID, 'Run')          // DefaultRunExecutor.EXECUTOR_ID = ToolWindowId.RUN
  assert.equal(DEBUG_EXECUTOR_ID, 'Debug')      // DefaultDebugExecutor.EXECUTOR_ID = ToolWindowId.DEBUG
  assert.equal(RUN_TOOL_WINDOW_ID, 'Run')
  assert.equal(DEBUG_TOOL_WINDOW_ID, 'Debug')
  assert.equal(BUILTIN_EXECUTORS.length, 2, '内建只有 Run / Debug 两条')
})

test('内建 Run/Debug 的每一个方法面都与上游对位（含默认不覆写的那几格）', () => {
  const run = executorById(RUN_EXECUTOR_ID)
  const debug = executorById(DEBUG_EXECUTOR_ID)
  assert.ok(run && debug)
  assert.equal(run.getToolWindowId?.(), RUN_TOOL_WINDOW_ID, 'DefaultRunExecutor.getToolWindowId() = ToolWindowId.RUN')
  assert.equal(debug.getToolWindowId?.(), DEBUG_TOOL_WINDOW_ID)
  assert.equal(run.getContextActionId?.(), 'RunClass', 'DefaultRunExecutor.getContextActionId()')
  assert.equal(debug.getContextActionId?.(), 'DebugClass')
  assert.equal(run.getHelpId?.(), 'ideaInterface.run')
  assert.equal(debug.getHelpId?.(), 'debugging.DebugWindow')
  assert.equal(run.isSupportedOnTarget?.(), true, '上游两条的 isSupportedOnTarget() 只对自己 id 为真 ⇒ 恒真')
  assert.equal(executorToolWindowTitle(run), 'Run', 'getToolWindowTitle() 默认 = getActionName()')
  assert.equal(executorToolWindowTitle(debug), 'Debug')
  // 上游 `getStartActionText(name)` 覆写后的形状：`Run 'Foo'` / `Debug 'Foo'`。
  assert.equal(executorStartActionText(run, 'App'), "Run 'App'")
  assert.equal(executorStartActionText(debug, 'App'), "Debug 'App'")
  assert.equal(executorStartActionText(run, '   '), 'Run', '空名字只给动作文案（上游 `isEmpty` 那一格）')
  assert.equal(executorStartActionText(undefined, 'App'), '', '没有执行器时不给文案')
})

test('shortenNameIfNeeded 与上游同档：80 上限、中间省略（Executor.java:101-103）', () => {
  const short = 'App'
  assert.equal(shortenNameIfNeeded(short), short)
  const long = 'x'.repeat(120)
  const shortened = shortenNameIfNeeded(long)
  assert.equal(shortened.length, 80, '上限就是注册表默认的 80（run.configuration.max.name.length）')
  assert.ok(shortened.includes('...'), '中间省略号')
  assert.ok(shortened.startsWith('xxxx'), '保留开头')
  assert.ok(shortened.endsWith('xxxx'), '保留结尾')
  assert.equal(shortenNameIfNeeded('abcdefgh', 5), 'a...h', '上限含省略号（maxlength=5 ⇒ 保留 2 个字符）')
})

test('注册表五个面：register / unregister / adoptFromExtensions / find(=getExecutorById) / all', () => {
  const handle = registerExecutor({
    id: 'Profile', getActionName: () => 'Profile', getStartActionText: () => 'Profile',
  }, { source: 'user' })
  try {
    assert.equal(executorRegistry.getExecutorById('Profile')?.getActionName(), 'Profile')
    assert.ok(executorRegistry.registered().some(executor => executor.id === 'Profile'), '内部表看得到')
    assert.ok(executorRegistry.ids().includes('Profile'))
    assert.equal(executorRegistry.adoptFromExtensions(), 0, 'EP 里已是本表登记的项不重复收编')
    assert.equal(handle.dispose(), true, '句柄 dispose 与 unregister 同语义')
    assert.equal(executorById('Profile'), undefined, '注销后消费函数看不见')
  } finally { executorRegistry.unregister('Profile') }
  // 未注册过的 id：注销返回 false（与宿主同口径）。
  assert.equal(executorRegistry.unregister('never.registered'), false)
})

test('adoptFromExtensions 收编「插件直接挂 EP」的贡献（没走 registerExecutor 的那些）', () => {
  // 插件自己往 EP 挂（等价 plugin.xml 的 `<com.intellij.executor implementation="..."/>`）。
  const handle = EXTENSIONS.registerExtension(EXECUTOR_EP, 'plugin.raw', {
    getId: () => 'PluginRaw', getActionName: () => 'Raw', getStartActionText: () => 'Raw',
  }, { source: 'user' })
  try {
    const adopted = executorRegistry.adoptFromExtensions()
    assert.ok(adopted >= 1, '收编条数 >= 1')
    assert.equal(executorById('PluginRaw')?.getActionName(), 'Raw', '收编后按 id 取得到')
    assert.ok(executorRegistry.registered().some(executor => executor.id === 'PluginRaw'))
  } finally {
    handle.dispose()
    executorRegistry.unregister('PluginRaw')
  }
})

test('上游写法（`getId()` 一族）原样可挂：normalizeExecutor 归一成同一个形状', () => {
  // 照 IDEA 的 `Executor` 子类写：只有方法，没有本仓的 `id` 字段。
  const ideaStyle = {
    getId: () => 'Coverage',
    getActionName: () => 'Run with Coverage',
    getStartActionText: name => (name ? `Run '${name}' with Coverage` : 'Run with Coverage'),
    isApplicable: () => true,
    isSupportedOnTarget: () => false,
  }
  const handle = registerExecutor(ideaStyle, { source: 'user' })
  try {
    assert.equal(executorById('Coverage')?.getActionName(), 'Run with Coverage')
    assert.equal(executorStartActionText(executorById('Coverage'), 'App'), "Run 'App' with Coverage")
    assert.deepEqual(Object.keys(normalizeExecutor(ideaStyle)).includes('id'), true, '归一后带 id')
    // 缺方法/缺 id 的贡献要被挡在外面，而不是挂上去当半成品。
    assert.throws(() => normalizeExecutor({ getId: () => 'X' }), /getActionName/)
    assert.throws(() => normalizeExecutor({ getActionName: () => 'X', getStartActionText: () => 'X' }), /id/)
  } finally { handle.dispose() }
  assert.equal(executorById('Coverage'), undefined)
})

test('order="first" 的插件贡献排到最前；同 id 登记覆盖内建那条', () => {
  const handle = registerExecutor({
    id: 'PluginFirst', getActionName: () => 'First', getStartActionText: () => 'First',
  }, { order: 'first', source: 'user' })
  try {
    assert.equal(executors()[0].id, 'PluginFirst', 'order=first 排最前（内建只按加载顺序在前）')
  } finally { handle.dispose() }

  // 同 id 覆盖：等价上游 `replaceExtension` —— 覆盖后 `find` 取到的是插件那条。
  const override = registerExecutor({
    id: RUN_EXECUTOR_ID, getActionName: () => 'Run (plugin)', getStartActionText: () => 'Run (plugin)',
  }, { source: 'user' })
  try {
    assert.equal(executorById(RUN_EXECUTOR_ID)?.getActionName(), 'Run (plugin)')
  } finally {
    override.dispose()
    registerBundledExecutor(BUILTIN_EXECUTORS[0])   // 还原内建那条
  }
  assert.equal(executorById(RUN_EXECUTOR_ID)?.getActionName(), 'Run', '内建那条被还原')
})

test('resolve 三道门：没注册 / isApplicable 为假 / 目标上不支持，各有可见原因', () => {
  // ① 没注册。
  const missing = resolveExecutor('Nope')
  assert.equal(missing.executor, null)
  assert.match(missing.reason, /没有注册/)

  // ② isApplicable(project) 为假 —— 上游是隐藏动作，本仓要能说出原因。
  const gated = registerExecutor({
    id: 'Gated', getActionName: () => 'Gated', getStartActionText: () => 'Gated',
    isApplicable: project => project.name !== 'locked',
  }, { source: 'user' })
  try {
    assert.equal(resolveExecutor('Gated', { name: 'open' }).executor?.id, 'Gated', '适用时放行')
    const blocked = resolveExecutor('Gated', { name: 'locked' })
    assert.equal(blocked.executor, null)
    assert.match(blocked.reason, /不适用于当前项目/)
  } finally { gated.dispose() }

  // ③ 活动目标不是本机目标、而执行器自报不支持目标。
  const noTarget = registerExecutor({
    id: 'NoTarget', getActionName: () => 'NoTarget', getStartActionText: () => 'NoTarget',
    isSupportedOnTarget: () => false,
  }, { source: 'user' })
  try {
    assert.equal(resolveExecutor('NoTarget', { onTarget: false }).executor?.id, 'NoTarget')
    const blocked = resolveExecutor('NoTarget', { onTarget: true })
    assert.equal(blocked.executor, null)
    assert.match(blocked.reason, /不支持在运行目标上执行/)
  } finally { noTarget.dispose() }

  // 一个坏执行器（isApplicable 抛错）不该把启动链打断：按上游默认档 true 继续。
  const broken = registerExecutor({
    id: 'Broken', getActionName: () => 'Broken', getStartActionText: () => 'Broken',
    isApplicable: () => { throw new Error('boom') },
  }, { source: 'user' })
  try {
    assert.equal(resolveExecutor('Broken', { name: 'x' }).executor?.id, 'Broken')
  } finally { broken.dispose() }
})

test('工具窗口路由取 getToolWindowId()：Debug 进调试视图、其余进运行面板', () => {
  assert.equal(toolWindowForExecutor(executorById(RUN_EXECUTOR_ID)), RUN_TOOL_WINDOW_ID)
  assert.equal(toolWindowForExecutor(executorById(DEBUG_EXECUTOR_ID)), DEBUG_TOOL_WINDOW_ID)
  assert.equal(toolWindowForExecutor(undefined), RUN_TOOL_WINDOW_ID, '认不出执行器时按运行面板兜底')
  const handle = registerExecutor({
    id: 'Custom', getActionName: () => 'Custom', getStartActionText: () => 'Custom',
    getToolWindowId: () => '',   // 自报空窗口 ⇒ 按默认档
  }, { source: 'user' })
  try { assert.equal(toolWindowForExecutor(executorById('Custom')), RUN_TOOL_WINDOW_ID) } finally { handle.dispose() }
})

test('真实消费点：runActions 从注册表取执行器、按 getToolWindowId 落窗口、启动文案取 getStartActionText', () => {
  const actions = read('src/runActions.ts')
  assert.match(actions, /import \{[\s\S]*resolveExecutor[\s\S]*\} from '\.\/executors\.ts'/, '必须引注册表那一支')
  assert.match(actions, /function selectExecutor\(id: string\)/, '执行器选择要走一个入口')
  assert.match(actions, /return resolveExecutor\(id, \{/, '判定交给注册表的 resolve')
  assert.match(actions, /onTarget: readActiveExecutionTargetId\(\) !== LOCAL_TARGET_ID/,
    'isSupportedOnTarget 只在活动目标不是本机时才有意义')
  assert.match(actions, /function showExecutorToolWindow\(executor: ExecutorContribution \| undefined\)/)
  assert.match(actions, /toolWindowForExecutor\(executor\) === DEBUG_TOOL_WINDOW_ID/, '按执行器自报的工具窗口落位')
  assert.match(actions, /showExecutorToolWindow\(executor\)/, '调试路径不能再写死 explorer/leftView 两行')
  assert.match(actions, /notify\(`\$\{executorStartActionText\(executor, found\.name\)\} —— \$\{launch\.program\}`\)/,
    '启动文案取执行器的 getStartActionText(configurationName)')
  assert.match(actions, /const selection = selectExecutor\(executorId\)/, '运行/调试两条都在同一入口解析')
})

test('真实消费点：实例行模型带执行器显示名（getActionName），认不出时回落 id', () => {
  setRunInstanceExecutor(9101, RUN_EXECUTOR_ID, 'application')
  assert.equal(runInstanceExecutorName(9101), 'Run')
  setRunInstanceExecutor(9102, 'plugin.unknown', 'application')
  assert.equal(runInstanceExecutorName(9102), 'plugin.unknown', '注册表认不出时给 id，不给空串')
  assert.equal(runInstanceExecutorName(9103), '', '没登记过的实例没有执行器名')

  const handle = registerExecutor({
    id: 'plugin.exec', getActionName: () => '插件执行器', getStartActionText: () => '插件执行器',
  }, { source: 'user' })
  try {
    setRunInstanceExecutor(9104, 'plugin.exec', 'application')
    assert.equal(runInstanceExecutorName(9104), '插件执行器', '第三方执行器的名字被真实取到')
    runInstances.set(9104, { id: 9104, label: 'Plugin#1', running: false, exit: 0, startedAt: Date.now(), output: [] })
    const row = runInstanceRows().find(candidate => candidate.id === 9104)
    assert.equal(row?.executor, '插件执行器', '行模型（RunConsole/仪表盘的输入）里有这一格')
  } finally {
    handle.dispose()
    for (const id of [9101, 9102, 9104]) runInstances.delete(id)
  }
})
