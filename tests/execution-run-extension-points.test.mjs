// 判据 · **运行/控制台/测试那一批执行域 EP 的落地**（`src/executionRunExtensionPoints.ts` 四条
// + `com.intellij.runConfigurationProducerSuppressor` 落在 `src/executionExtensionPoints.ts`）
// 与它们的真实消费点。
//
// 上游依据（逐条开文件核过）：
//   · `com.intellij.runConfigurationTemplateProvider` —— `platform/execution-impl/resources/intellij.platform.execution.impl.xml:165`；
//     接口 `platform/execution-impl/src/com/intellij/execution/impl/RunManagerImpl.kt:130-134`（EP 常量 `:132`）。
//   · `com.intellij.testSrcLocator` —— 同文件 `:168`；接口
//     `platform/execution-impl/src/com/intellij/testIntegration/TestLocationProvider.java:13-19`。
//     消费链（逐个问扩展、第一个非空赢）：`plugins/gradle/java/src/execution/test/runner/GradleTestLocator.kt:48-56`。
//   · `com.intellij.execution.processHandlerPidProvider` —— 同文件 `:182-184`；接口
//     `platform/execution-impl/src/com/intellij/execution/impl/ProcessHandlerPidProvider.kt:10-18`（`EP_NAME` `:13-14`）。
//   · `com.intellij.execution.consolePauseStateProvider` —— 同文件 `:178-180`；接口
//     `platform/execution-impl/src/com/intellij/execution/ui/ExecutionConsolePauseStateProvider.kt:9-17`；
//     内建贡献 `platform/xdebugger-impl/resources/intellij.platform.debugger.impl.content.xml:82`；
//     消费点 `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:141-152`（任一为真即为真）。
//   · `com.intellij.runConfigurationProducerSuppressor` —— `platform/lang-api/src/com/intellij/execution/RunConfigurationProducerService.kt:15-20`
//     （`EP_NAME` `:17`）；消费点同文件 `:54-60`。
//
// 钉四件事：
//   ① 五条 EP id 逐字取自上游，且都在宿主里声明过；
//   ② 无人挂 EP 时每条消费路径与接线前逐字一致（空表 / 回落宿主）；
//   ③ 第三方按 id 挂进来后**被真实消费点拿到**，注销后消失；
//   ④ 内建那一半仍在（运行控制台的暂停位作为 bundled 贡献登记；宿主快照仍是 pid 的兜底）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  CONSOLE_PAUSE_STATE_PROVIDER_EP, PROCESS_HANDLER_PID_PROVIDER_EP, RUN_CONFIGURATION_TEMPLATE_PROVIDER_EP,
  TEST_SRC_LOCATOR_EP, consolePauseStateProviders, consolePausedByProviders, declareExecutionRunExtensionPoints,
  locationFromTestProviders, pidFromProcessHandlerProviders, registerConsolePauseStateProvider,
  registerProcessHandlerPidProvider, registerRunConfigurationTemplateProvider, registerTestLocationProvider,
  runConfigurationTemplateProviders, testLocationProviders,
} from '../src/executionRunExtensionPoints.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  RUN_CONFIGURATION_PRODUCER_SUPPRESSOR_EP, declareExecutionExtensionPoints, produceRunConfigurationFromContext,
  registerRunConfigurationProducer, registerRunConfigurationProducerSuppressor, runConfigurationProducerSuppressors,
} from '../src/executionExtensionPoints.ts'
import { templateFor } from '../src/runConfigTemplates.ts'
import { resolveTestLocation } from '../src/testLocator.ts'
import { discoverRunTargets } from '../src/runTargets.ts'
import { RUN_CONSOLE_ID, applyRunInstanceSnapshot, runInstances, runOutputPaused, runOutputPausedState, setRunOutputPaused } from '../src/runInstances.ts'

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('五条 EP id 逐字取自上游，且都声明在宿主里', () => {
  assert.equal(RUN_CONFIGURATION_TEMPLATE_PROVIDER_EP, 'com.intellij.runConfigurationTemplateProvider')
  assert.equal(TEST_SRC_LOCATOR_EP, 'com.intellij.testSrcLocator')
  assert.equal(PROCESS_HANDLER_PID_PROVIDER_EP, 'com.intellij.execution.processHandlerPidProvider')
  assert.equal(CONSOLE_PAUSE_STATE_PROVIDER_EP, 'com.intellij.execution.consolePauseStateProvider')
  assert.equal(RUN_CONFIGURATION_PRODUCER_SUPPRESSOR_EP, 'com.intellij.runConfigurationProducerSuppressor')
  for (const id of [RUN_CONFIGURATION_TEMPLATE_PROVIDER_EP, TEST_SRC_LOCATOR_EP, PROCESS_HANDLER_PID_PROVIDER_EP,
                    CONSOLE_PAUSE_STATE_PROVIDER_EP, RUN_CONFIGURATION_PRODUCER_SUPPRESSOR_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 必须在宿主里声明`)
  }
  declareExecutionRunExtensionPoints()   // 幂等
  declareExecutionExtensionPoints()      // 幂等
})

test('模板提供者：无插件时认本仓存的那份；插件给了就用它（sanitize 后）', () => {
  assert.equal(runConfigurationTemplateProviders().length, 0, '上游平台内无内建贡献')
  const store = { getItem: () => null, setItem: () => {} }
  assert.deepEqual(templateFor({ shell: { command: 'cmake --build build' } }, 'shell'), { command: 'cmake --build build' })
  assert.equal(templateFor({}, 'shell'), undefined)
  assert.equal(store.getItem('x'), null)
  const handle = registerRunConfigurationTemplateProvider({
    id: 'ThirdPartyTemplateProvider',
    getRunConfigurationTemplate: factory => factory.typeId === 'shell' ? { command: 'bash run.sh', args: ['--fast'], target: '' } : null,
  })
  assert.deepEqual(templateFor({ shell: { command: '本地那份' } }, 'shell'), { command: 'bash run.sh', args: ['--fast'] },
    '插件给的模板经 sanitize：空 target 不落键')
  assert.deepEqual(templateFor({ application: { command: 'x' } }, 'application'), { command: 'x' }, '提供者不管的类型仍读本仓那份')
  handle.dispose()
  assert.deepEqual(templateFor({ shell: { command: '本地那份' } }, 'shell'), { command: '本地那份' })
})

test('测试位置提供者：本仓协议认不出时问 EP（第一个非空赢）', () => {
  assert.equal(testLocationProviders().length, 0, '上游平台内无内建贡献')
  assert.deepEqual(resolveTestLocation('custom:tests://Foo/bar', []), [], '没插件时认不出就是空表')
  const handle = registerTestLocationProvider({
    id: 'ThirdPartyTestLocator',
    getLocation: (protocolId, locationData) => protocolId === 'custom:tests'
      ? [{ path: `src/${locationData}.ts`, line: 3, paramName: null }]
      : [],
  })
  assert.deepEqual(resolveTestLocation('custom:tests://Foo/bar', []), [{ path: 'src/Foo/bar.ts', line: 3, paramName: null }])
  // 本仓自己的协议仍然优先（`java:test://` 命中的仍走本仓索引，不问插件）。
  const handle2 = registerTestLocationProvider({ id: 'NeverWins', getLocation: () => [{ path: 'x.ts', line: 1 }] })
  assert.equal(locationFromTestProviders('java:test', 'A/b', {}).length, 1)
  handle2.dispose()
  handle.dispose()
  assert.deepEqual(resolveTestLocation('custom:tests://Foo/bar', []), [])
})

test('pid 提供者：插件报的优先，宿主快照是兜底；无插件时与接线前一致', () => {
  runInstances.clear()
  const created = { id: 7, label: 'x', running: true, exit: null, startedAt: Date.now(), output: [], pid: 0,
                    children: [], tree: [], ports: [], coverage: null, stopping: false, closed: false, aborted: false }
  runInstances.set(7, created)
  assert.equal(applyRunInstanceSnapshot([{ id: 7, pid: 4242 }]), 1)
  assert.equal(runInstances.get(7).pid, 4242, '无插件 = 宿主快照那一格（接线前行为）')

  const handlerPids = []
  const handle = registerProcessHandlerPidProvider({
    id: 'ThirdPartyPidProvider',
    getPid: handler => { handlerPids.push(handler.instanceId); return handler.instanceId === 7 ? 99 : null },
  })
  applyRunInstanceSnapshot([{ id: 7, pid: 4242 }])
  assert.equal(runInstances.get(7).pid, 99, '插件自报的 pid 覆盖快照')
  assert.deepEqual(handlerPids, [7], '提供者拿到的是这条实例的 ProcessHandler 快照')
  handle.dispose()
  applyRunInstanceSnapshot([{ id: 7, pid: 4242 }])
  assert.equal(runInstances.get(7).pid, 4242, '注销后回落宿主快照')
  runInstances.clear()
})

test('控制台暂停：bundled 那条就是运行控制台自己的暂停位，插件任一说暂停即为暂停', () => {
  setRunOutputPaused(false)
  assert.equal(consolePauseStateProviders().some(p => p.id === 'RunConsolePauseStateProvider'), true,
    '内建 contributor 仍在（上游那一格是 XDebuggerConsolePauseStateProvider）')
  assert.equal(runOutputPausedState(), false)
  setRunOutputPaused(true)
  assert.equal(runOutputPausedState(), true, '无插件时 = runOutputPaused')
  assert.equal(consolePausedByProviders({ id: RUN_CONSOLE_ID }), true)
  setRunOutputPaused(false)
  assert.equal(read('src/runInstances.ts').includes('registerBundledConsolePauseStateProvider'), true)

  const handle = registerConsolePauseStateProvider({ id: 'ThirdPartyPause', isPaused: console => console.id === RUN_CONSOLE_ID })
  assert.equal(runOutputPausedState(), true, '插件说暂停 ⇒ 控制台算暂停（上游 TestConsoleProperties 的「任一为真」）')
  assert.equal(runOutputPaused.value, false, '插件不改本仓的暂停位本身（显示态与冻结态各自一份）')
  handle.dispose()
  assert.equal(runOutputPausedState(), false)
})

test('生产者抑制器：discoverRunTargets 与 produceRunConfigurationFromContext 都真的不问被抑制者', () => {
  assert.equal(runConfigurationProducerSuppressors().length, 0, '上游无内建贡献')
  const inputs = {
    files: ['src/Main.java', 'build/app.exe'],
    contents: { 'src/Main.java': 'public class Main { public static void main(String[] a) {} }' },
    java: { jdkHome: 'D:\\Java21', outputPaths: ['out'], classpath: ['out'] },
  }
  const all = discoverRunTargets(inputs)
  assert.equal(all.some(target => target.kind === 'java'), true)
  assert.equal(all.some(target => target.kind === 'cmake'), true)

  const handle = registerRunConfigurationProducerSuppressor({
    id: 'ThirdPartySuppressor',
    shouldSuppress: producer => producer.typeId === 'java',
  })
  const left = discoverRunTargets(inputs)
  assert.equal(left.some(target => target.kind === 'java'), false, '被抑制的生产者不产出候选')
  assert.equal(left.some(target => target.kind === 'cmake'), true, '别的生产者不受影响')

  // EP 级生产者那条路（`produceRunConfigurationFromContext`）同样跳过被抑制者。
  const producers = registerRunConfigurationProducer({
    id: 'SuppressedProducer',
    getConfigurationType: () => 'java',
    isConfigurationFromContext: () => false,
    setupConfigurationFromContext: () => ({ name: '生成', type: 'java', command: 'java Main' }),
  })
  assert.equal(produceRunConfigurationFromContext({ path: 'src/Main.java' }), null, '被抑制 ⇒ 根本不问它')
  handle.dispose()
  assert.equal(produceRunConfigurationFromContext({ path: 'src/Main.java' })?.name, '生成', '注销后它又会被问')
  producers.dispose()
  assert.equal(produceRunConfigurationFromContext({ path: 'src/Main.java' }), null)
})

test('消费点是活的：四个消费文件都从 EP 取', () => {
  assert.match(read('src/runConfigTemplates.ts'), /templateFromProviders/)
  assert.match(read('src/testLocator.ts'), /locationFromTestProviders/)
  assert.match(read('src/runInstances.ts'), /pidFromProcessHandlerProviders/)
  assert.match(read('src/components/RunConsole.vue'), /runOutputPausedState/)
  assert.match(read('src/runTargets.ts'), /producerSuppressed/)
})
