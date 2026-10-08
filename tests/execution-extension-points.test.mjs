// 判据 · execution 域的扩展点宿主接线（`src/executionExtensionPoints.ts` + `src/programRunners.ts`）
// —— 上游本来就是 EP 的那几族（`ConfigurationType` / `RunConfigurationProducer` /
// `ProgramRunner` / `BeforeRunTaskProvider` / `ConsoleFolding` / `ConsoleActionsPostProcessor` /
// `Executor` / `RunConfigurationBeforeRunProviderDelegate`）以及它们的同名方法面。
//
// 钉五件事：
//   ① 八条 EP 的 id 逐字等于上游 qualifiedName，且都已在宿主里声明；
//   ② 任务书里写的六个 `com.intellij.execution.*` id 在上游**不存在**（本仓不造假 EP，
//      声明表里也不能有它们）；
//   ③ 每条 EP 的贡献能按 id 注册/覆盖/注销，消费函数看得见（第三方挂的不是死代码）；
//   ④ `order="first"` 的插件贡献排在内建之前（插件能覆盖内建）；
//   ⑤ bundled 默认贡献（Run/Debug 执行器、本仓五个配置类型）如实出现在 EP 里。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** 读本仓源文件（接线判据要核消费点里真的有那一行，不是只看纯函数）。 */
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

import {
  BEFORE_RUN_TASK_PROVIDER_EP, CONFIGURATION_TYPE_EP, CONSOLE_ACTIONS_POST_PROCESSOR_EP,
  CONSOLE_FOLDING_EP, EXECUTOR_EP, PROGRAM_RUNNER_EP, RUN_CONFIGURATION_BEFORE_RUN_PROVIDER_DELEGATE_EP,
  RUN_CONFIGURATION_PRODUCER_EP,
  applyConsoleFoldings, beforeRunTaskProviders, beforeRunTasksFor, configurationTypeById,
  configurationTypes, consoleActionsPostProcessors, consoleFoldings, declareExecutionExtensionPoints,
  executorById, executors, foldableByConsoleFolding, notifyBeforeRunDelegates,
  postProcessConsoleActions, produceRunConfigurationFromContext, registerBeforeRunTaskProvider,
  registerConfigurationType, registerConsoleActionsPostProcessor, registerConsoleFolding,
  registerExecutor, registerRunConfigurationBeforeRunDelegate, registerRunConfigurationProducer,
  runConfigurationBeforeRunDelegates, runConfigurationProducers,
  runConfigurationProducerRegistry, unregisterExecutionExtension,
} from '../src/executionExtensionPoints.ts'
import {
  DEBUG_EXECUTOR_ID, PROGRAM_RUNNER_EP as PROGRAM_RUNNER_EP_FROM_RUNNERS, RUN_EXECUTOR_ID,
  allProgramRunners, programRunnerRegistry, registerProgramRunner,
} from '../src/programRunners.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
// 导入即让 bundled 配置类型登记（消费侧登记，见 `src/runConfigTree.ts`）。
import { RUN_CONFIG_TYPES, runConfigTypeLabel } from '../src/runConfigTree.ts'

test('八条 EP 的 id 逐字取自上游，且已声明', () => {
  assert.equal(CONFIGURATION_TYPE_EP, 'com.intellij.configurationType')
  assert.equal(RUN_CONFIGURATION_PRODUCER_EP, 'com.intellij.runConfigurationProducer')
  assert.equal(PROGRAM_RUNNER_EP, 'com.intellij.programRunner')
  assert.equal(PROGRAM_RUNNER_EP_FROM_RUNNERS, 'com.intellij.programRunner', 'programRunner 只有一份锚')
  assert.equal(BEFORE_RUN_TASK_PROVIDER_EP, 'com.intellij.stepsBeforeRunProvider')
  assert.equal(CONSOLE_FOLDING_EP, 'com.intellij.console.folding')
  assert.equal(CONSOLE_ACTIONS_POST_PROCESSOR_EP, 'com.intellij.consoleActionsPostProcessor')
  assert.equal(EXECUTOR_EP, 'com.intellij.executor')
  assert.equal(RUN_CONFIGURATION_BEFORE_RUN_PROVIDER_DELEGATE_EP, 'com.intellij.runConfigurationBeforeRunProviderDelegate')
  for (const id of [CONFIGURATION_TYPE_EP, RUN_CONFIGURATION_PRODUCER_EP, PROGRAM_RUNNER_EP,
    BEFORE_RUN_TASK_PROVIDER_EP, CONSOLE_FOLDING_EP, CONSOLE_ACTIONS_POST_PROCESSOR_EP,
    EXECUTOR_EP, RUN_CONFIGURATION_BEFORE_RUN_PROVIDER_DELEGATE_EP]) {
    assert.ok(EXTENSIONS.hasExtensionPoint(id), `${id} 应已声明`)
  }
  declareExecutionExtensionPoints()   // 幂等，不抛
})

test('任务书里六个 com.intellij.execution.* id 上游不存在 —— 不造假 EP', () => {
  // 上游真名分别是 configurationType / runConfigurationProducer / programRunner /
  // stepsBeforeRunProvider / console.folding；executionListener 是 messageBus topic（不是 EP，
  // 落在 `src/executionListeners.ts`）。声明表里不许出现这些名字。
  for (const fake of [
    'com.intellij.execution.runConfigurationType',
    'com.intellij.execution.runConfigurationProducer',
    'com.intellij.execution.programRunner',
    'com.intellij.execution.executionListener',
    'com.intellij.execution.beforeRunTaskProvider',
    'com.intellij.execution.consoleFolding',
  ]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(fake), false, `${fake} 上游不存在，不许声明`)
    assert.equal(EXTENSIONS.unregisterExtension(fake, 'x'), false, `${fake} 上没有贡献`)
  }
})

test('bundled 默认贡献：Run/Debug 执行器与本仓五个配置类型都在 EP 里', () => {
  assert.ok(executors().some(executor => executor.id === RUN_EXECUTOR_ID), 'Run 执行器是贡献之一')
  assert.ok(executors().some(executor => executor.id === DEBUG_EXECUTOR_ID), 'Debug 执行器是贡献之一')
  for (const entry of RUN_CONFIG_TYPES) {
    const found = configurationTypeById(entry.id)
    assert.ok(found, `内建类型 ${entry.id} 应在 configurationType EP 里`)
    assert.equal(found?.getDisplayName(), entry.label, `${entry.id} 的显示名与树里一致`)
  }
})

test('ConfigurationType：第三方按 id 挂进来被 configurationTypeById 取到，order=first 排最前', () => {
  const handle = registerConfigurationType({
    id: 'plugin.custom', getDisplayName: () => '插件类型', getConfigurationTypeDescription: () => '来自插件',
  }, { order: 'first', source: 'user' })
  try {
    assert.equal(configurationTypes()[0].id, 'plugin.custom', 'order=first 的贡献排最前')
    assert.equal(configurationTypeById('plugin.custom')?.getDisplayName(), '插件类型')
    // 未知类型问 EP 拿显示名（消费点 `src/runConfigTree.ts` 的 runConfigTypeLabel）。
    assert.equal(runConfigTypeLabel('plugin.custom'), '插件类型')
  } finally { handle.dispose() }
  assert.equal(configurationTypeById('plugin.custom'), undefined, '注销后消费函数看不见')
  assert.equal(runConfigTypeLabel('plugin.custom'), 'plugin.custom', '未知类型回落原始 id（旧行为）')
})

test('RunConfigurationProducer：setupConfigurationFromContext 非空即被 produceRunConfigurationFromContext 选中', () => {
  const handle = registerRunConfigurationProducer({
    id: 'plugin.producer',
    getConfigurationType: () => 'application',
    isConfigurationFromContext: config => config.name === 'from-context',
    setupConfigurationFromContext: context => (context.path?.endsWith('.java') ? {
      name: 'from-context', type: 'application', command: 'java', program: 'Main',
    } : null),
  }, { order: 'first', source: 'user' })
  try {
    const produced = produceRunConfigurationFromContext({ path: 'src/Main.java', text: '' })
    assert.equal(produced?.name, 'from-context')
    assert.equal(produceRunConfigurationFromContext({ path: 'a.txt' }), null, '插件不认的上下文返回 null')
    assert.equal(runConfigurationProducers()[0].id, 'plugin.producer')
    assert.ok(runConfigurationProducerRegistry.find('plugin.producer'))
  } finally { handle.dispose() }
  assert.equal(produceRunConfigurationFromContext({ path: 'src/Main.java' }), null, '注销后不再产出')
})

test('BeforeRunTaskProvider：createTask/canExecuteTask 决定 beforeRunTasksFor 的结果', () => {
  const handle = registerBeforeRunTaskProvider({
    id: 'plugin.build',
    getId: () => 'plugin.build',
    getName: () => '构建',
    createTask: config => (config.type === 'shell' ? { name: '构建', command: 'make' } : null),
    canExecuteTask: config => config.command !== 'skip',
  }, { source: 'user' })
  try {
    const tasks = beforeRunTasksFor({ name: 'A', type: 'shell', command: 'run' })
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].command, 'make')
    assert.equal(tasks[0].providerId, 'plugin.build')
    assert.deepEqual(beforeRunTasksFor({ name: 'A', type: 'shell', command: 'skip' }), [], 'canExecuteTask 说不跑就不跑')
    assert.deepEqual(beforeRunTasksFor({ name: 'A', type: 'application', command: 'run' }), [], 'createTask 说不建就不建')
    assert.ok(beforeRunTaskProviders().some(provider => provider.id === 'plugin.build'))
  } finally { handle.dispose() }
})

test('ConsoleFolding：shouldFoldLine 认下的行折进上一行（applyConsoleFoldings 是真消费点）', () => {
  const handle = registerConsoleFolding({
    id: 'plugin.fold',
    shouldFoldLine: (_root, line) => line.startsWith('\tat '),
    shouldBeAttachedToThePreviousLine: () => true,
  }, { source: 'user' })
  try {
    assert.equal(foldableByConsoleFolding('\tat foo()'), true)
    const folded = applyConsoleFoldings([
      { text: 'Exception in thread main' },
      { text: '\tat foo()' },
      { text: '\tat bar()' },
      { text: 'done' },
    ])
    assert.deepEqual(folded.map(line => line.text), ['Exception in thread main', 'done'], '两条栈帧折进首行')
    assert.equal(folded[0].count, 3, '折叠计数记在首行上')
    assert.ok(consoleFoldings().some(folding => folding.id === 'plugin.fold'))
  } finally { handle.dispose() }
  // 无贡献时逐字原样返回（内建没有 bundled 折叠贡献 ⇒ 行为零变化）。
  const plain = [{ text: 'a' }, { text: 'b' }]
  assert.deepEqual(applyConsoleFoldings(plain), plain)
})

test('ConsoleActionsPostProcessor：postProcess 链式改造默认动作清单', () => {
  const handle = registerConsoleActionsPostProcessor({
    id: 'plugin.actions',
    postProcess: actions => [...actions, { id: 'plugin.extra', title: '插件动作' }],
  }, { source: 'user' })
  try {
    const result = postProcessConsoleActions([{ id: 'clear', title: '清空' }])
    assert.deepEqual(result.map(action => action.id), ['clear', 'plugin.extra'])
    assert.ok(consoleActionsPostProcessors().some(processor => processor.id === 'plugin.actions'))
  } finally { handle.dispose() }
})

test('Executor：executorById 取内建 Run/Debug，第三方可挂同名方法面的执行器', () => {
  assert.equal(executorById('Run')?.getActionName(), 'Run')
  assert.equal(executorById('Debug')?.getActionName(), 'Debug')
  const handle = registerExecutor({
    id: 'Profile', getActionName: () => 'Profile', getStartActionText: () => 'Profile',
  }, { order: 'first', source: 'user' })
  try {
    assert.equal(executorById('Profile')?.getActionName(), 'Profile')
    assert.equal(executors()[0].id, 'Profile', 'order=first 排最前')
  } finally { handle.dispose() }
  assert.equal(executorById('Profile'), undefined)
})

test('RunConfigurationBeforeRunProviderDelegate：notifyBeforeRunDelegates 把环境交给代理', () => {
  const seen = []
  const handle = registerRunConfigurationBeforeRunDelegate({
    id: 'plugin.delegate', beforeRun: env => seen.push(env),
  }, { source: 'user' })
  try {
    notifyBeforeRunDelegates({ configName: 'App', executorId: 'Run' })
    assert.deepEqual(seen, [{ configName: 'App', executorId: 'Run' }])
    assert.ok(runConfigurationBeforeRunDelegates().some(delegate => delegate.id === 'plugin.delegate'))
  } finally { handle.dispose() }
  notifyBeforeRunDelegates({ configName: 'App', executorId: 'Run' })
  assert.equal(seen.length, 1, '注销后不再通知')
})

test('ProgramRunner EP：第三方 runner 按 id 挂进来被 allProgramRunners 取到（内建在前）', () => {
  const runner = {
    runnerId: 'PluginRunner', executorId: 'Run',
    canRun: (executorId, config) => executorId === 'Run' && config.name === 'plugin-only',
    refusalReason: () => '插件 runner 不认这条配置。',
  }
  const dispose = registerProgramRunner(runner, 'plugin.runner')
  try {
    const all = allProgramRunners()
    assert.ok(all.some(candidate => candidate.runnerId === 'PluginRunner'), '插件 runner 出现在表里')
    assert.equal(all[0].runnerId, 'GenericProgramRunner', '内建排在前（第一个认下的赢不变）')
    assert.ok(programRunnerRegistry.find('PluginRunner'))
    assert.equal(programRunnerRegistry.adoptFromExtensions(), 0, 'EP 里已登记的项不重复收编')
  } finally { dispose() }
  assert.ok(!allProgramRunners().some(candidate => candidate.runnerId === 'PluginRunner'), '注销后不见')
})

test('unregister 对未注册过的 id 返回 false（与宿主同口径）', () => {
  assert.equal(unregisterExecutionExtension(CONFIGURATION_TYPE_EP, 'never.registered'), false)
})

test('真实消费点：produceRunConfigurationFromContext 接进 runActions 的上下文链路', () => {
  const actions = read('src/runActions.ts')
  assert.match(actions, /produceRunConfigurationFromContext\([\s\S]*?path: tab\.path[\s\S]*?\}\)\n/,
    'runContextConfiguration 要真的问一遍插件生产者')
  assert.match(actions, /\{ root: workspace\.value\?\.root \?\? null, name: workspace\.value\?\.name \?\? null \}/,
    '第二格是项目面（抑制器要看它）')
  assert.match(actions, /if \(produced\) \{ await runProducedConfiguration\(produced, debug, tab\.path\); return \}/,
    '插件认下即用它的配置（认不下才落到内置启发式）')
  assert.match(actions, /async function runProducedConfiguration\(produced: ProducedRunConfiguration, debug: boolean, sourcePath: string\)/,
    '产出的配置要走同一条 startRun 启动链')
  assert.match(actions, /await startRun\(temporary, RUN_EXECUTOR_ID\)/, '产出物折成临时配置后交给 startRun')
})

test('真实消费点：postProcessConsoleActions 接进 RunConsole 工具条', () => {
  const view = read('src/components/RunConsole.vue')
  assert.match(view, /import \{ postProcessConsoleActions, type ConsoleActionLike \} from '\.\.\/executionExtensionPoints\.ts'/,
    '控制台面板要引后处理链')
  assert.match(view, /postProcessConsoleActions\(BUILTIN_CONSOLE_ACTIONS\)/, '默认动作交给后处理链')
  assert.match(view, /v-for="action in pluginConsoleActions"/, '插件加的动作渲染成工具条条目')
  assert.match(view, /function runConsoleAction\(action: ConsoleActionLike\)/, '点了要真的执行 perform()')
})
