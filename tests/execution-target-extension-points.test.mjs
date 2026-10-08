// 判据 · **运行目标那一族的 EP 落地**（`src/executionTargetExtensionPoints.ts`）与它的真实消费点。
//
// 上游依据（逐条开文件核过，写进判词的那几条）：
//   · `com.intellij.executionTargetType` —— `platform/execution/resources/intellij.platform.execution.xml:36-37`；
//     接口 `platform/execution/src/com/intellij/execution/target/TargetEnvironmentType.kt:22`
//     （`isLocalTarget()` `:27`、`isSystemCompatible()` `:32`、`createEnvironmentRequest` `:52`），EP 在 `:71`；
//     内建贡献 `platform/execution-impl/resources/intellij.platform.execution.impl.xml:137`（`EelTargetType`）。
//   · `com.intellij.executionTargetLanguageRuntimeType` —— 同文件 `:38-39`；接口
//     `platform/execution/src/com/intellij/execution/target/LanguageRuntimeType.kt:32`
//     （`isApplicableTo` `:34`、`launchDescription` `:44`、`findLanguageRuntime` `:76`），EP 在 `:77`；
//     内建贡献 `platform/execution-impl/backend/resources/intellij.platform.execution.impl.backend.xml:19`
//     （`JavaLanguageRuntimeType`，`TYPE_ID = "JavaLanguageRuntime"`，`.../java/JavaLanguageRuntimeType.kt:122-123`）。
//   · `com.intellij.executionTargetProvider` —— `platform/lang-api/resources/intellij.platform.lang.xml:141`；
//     接口 `platform/lang-api/src/com/intellij/execution/ExecutionTargetProvider.java:14-22`；
//     内建贡献 `platform/execution-impl/resources/intellij.platform.execution.impl.xml:111`
//     （`DefaultExecutionTargetProvider`，返回单一本机目标）。
//   · `com.intellij.runConfigurationTargetEnvironmentAdjusterFactory` —— 同 execution.xml `:35`；接口
//     `platform/execution/src/com/intellij/execution/target/RunConfigurationTargetEnvironmentAdjuster.kt:35-45`。
//
// 钉四件事：
//   ① 四条 EP id 逐字取自上游，且都在宿主里声明过；
//   ② 内建三条贡献仍在（本机类型 / Java 运行时类型 / 默认目标提供者），**无插件时目标列表逐字不变**；
//   ③ 第三方按 id 挂进 EP 后被 `src/executionTargets.ts` 的真实消费点拿到（目标列表 / 可执行文件解析 /
//      模板折算），注销后消失；
//   ④ 消费点是活的（读源码断言接线存在）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BUILTIN_DEFAULT_TARGET_PROVIDER, BUILTIN_JAVA_LANGUAGE_RUNTIME_TYPE, BUILTIN_LOCAL_TARGET_TYPE,
  EXECUTION_TARGET_LANGUAGE_RUNTIME_TYPE_EP, EXECUTION_TARGET_PROVIDER_EP, EXECUTION_TARGET_TYPE_EP,
  RUN_CONFIGURATION_TARGET_ENVIRONMENT_ADJUSTER_FACTORY_EP, declareExecutionTargetExtensionPoints,
  executionTargetsFromProviders, executionTargetsFromRegisteredTypes, executionTargetProviders,
  executableViaLanguageRuntimeType, isKnownTargetTypeId, languageRuntimeTypeById, registerBundledExecutionTargets,
  registerExecutionTargetProvider, registerLanguageRuntimeType, registerTargetEnvironmentAdjusterFactory,
  registerTargetEnvironmentType, targetEnvironmentAdjusterFactories, targetEnvironmentTypeById,
  targetEnvironmentTypes,
} from '../src/executionTargetExtensionPoints.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  LOCAL_TARGET_ID, applyTargetToTemplateProgram, customExecutionTargets, listExecutionTargets, targetById,
} from '../src/executionTargets.ts'
import { LOCAL_TARGET_TYPE_ID } from '../src/targetEnvironments.ts'
import { JAVA_RUNTIME_ID, PYTHON_RUNTIME_ID } from '../src/languageRuntimes.ts'
import { UNIX_PLATFORM } from '../src/targetPlatform.ts'

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('四条 EP id 逐字取自上游，且都声明在宿主里', () => {
  assert.equal(EXECUTION_TARGET_TYPE_EP, 'com.intellij.executionTargetType')
  assert.equal(EXECUTION_TARGET_LANGUAGE_RUNTIME_TYPE_EP, 'com.intellij.executionTargetLanguageRuntimeType')
  assert.equal(EXECUTION_TARGET_PROVIDER_EP, 'com.intellij.executionTargetProvider')
  assert.equal(RUN_CONFIGURATION_TARGET_ENVIRONMENT_ADJUSTER_FACTORY_EP, 'com.intellij.runConfigurationTargetEnvironmentAdjusterFactory')
  for (const id of [EXECUTION_TARGET_TYPE_EP, EXECUTION_TARGET_LANGUAGE_RUNTIME_TYPE_EP,
                    EXECUTION_TARGET_PROVIDER_EP, RUN_CONFIGURATION_TARGET_ENVIRONMENT_ADJUSTER_FACTORY_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 必须在宿主里声明`)
  }
  declareExecutionTargetExtensionPoints()   // 幂等，不抛
})

test('内建三条贡献仍在：本机类型 isLocalTarget、Java 运行时类型 id/文案、默认提供者给本机目标', () => {
  registerBundledExecutionTargets()   // 幂等
  const local = targetEnvironmentTypeById(LOCAL_TARGET_TYPE_ID)
  assert.ok(local, '本机目标类型必须在注册表里')
  assert.equal(local.getDisplayName().length > 0, true)
  assert.equal(local.isLocalTarget(), true, 'TargetEnvironmentType.isLocalTarget 为真 ⇒ 不新增目标项')
  assert.equal(local.isSystemCompatible(), true)

  const java = languageRuntimeTypeById(JAVA_RUNTIME_ID)
  assert.ok(java, 'Java 语言运行时类型必须在注册表里（上游 JavaLanguageRuntimeType，TYPE_ID 逐字）')
  assert.equal(java.getLaunchDescription(), '运行 Java 应用程序')
  assert.equal(java.isApplicableTo({ name: 'App', type: 'application' }), true)
  assert.equal(java.isApplicableTo({ name: 'Sh', type: 'shell' }), false)

  assert.equal(executionTargetProviders().some(p => p.id === BUILTIN_DEFAULT_TARGET_PROVIDER.id), true)
  const fromDefault = executionTargetsFromProviders({}, { name: 'x' })
    .filter(target => target.id === LOCAL_TARGET_ID)
  assert.equal(fromDefault.length, 1, '默认提供者给一条本机目标（与内建同 id，列表里按 id 去重）')
  // 本机类型不列目标（isLocalTarget）。
  assert.equal(executionTargetsFromRegisteredTypes({}).some(target => target.id === LOCAL_TARGET_ID), false)
  assert.deepEqual(languageRuntimeTypeById('不存在'), undefined)
  assert.deepEqual(targetEnvironmentTypeById('不存在'), undefined)
})

test('无插件时目标列表逐字不变；插件挂进目标提供者后被真实消费点拿到', () => {
  const jdks = [{ home: 'D:\\Java21', name: 'java 21', version: '21' }]
  const base = listExecutionTargets(jdks)
  assert.equal(base.length, 2, '本机 + 1 个 JDK 目标（与接线前一致）')
  assert.equal(base[0].id, LOCAL_TARGET_ID)
  assert.equal(base[1].kind, 'jdk')
  assert.equal(listExecutionTargets([]).length, 1, '默认提供者的本机目标与内建同 id ⇒ 去重后只有一条')

  const handle = registerExecutionTargetProvider({
    id: 'ThirdPartyRemoteTargets',
    getTargets: () => [{ id: 'ssh:prod', name: 'prod (ssh)', kind: 'custom', description: '/srv/app' }],
  })
  const withPlugin = listExecutionTargets(jdks)
  assert.equal(withPlugin.length, 3)
  assert.equal(targetById(withPlugin, 'ssh:prod')?.name, 'prod (ssh)')
  assert.equal(withPlugin[2].id, 'ssh:prod', '插件贡献接在内建之后')
  handle.dispose()
  assert.equal(listExecutionTargets(jdks).length, 2, '注销后回到内建三条')
})

test('插件挂进目标环境类型后被消费：类型 id 被承认、目标列入、目标环境可挂该类型', () => {
  assert.equal(isKnownTargetTypeId('SSHTarget'), false, '未注册的类型不承认')
  assert.equal(isKnownTargetTypeId(LOCAL_TARGET_TYPE_ID), true, '本机类型恒承认')

  const handle = registerTargetEnvironmentType({
    id: 'SSHTarget',
    getDisplayName: () => 'SSH 目标',
    isLocalTarget: () => false,
    createEnvironmentRequest: () => ({
      id: 'target:ssh-1', displayName: 'prod', description: '/srv/app',
      runtimeTypeId: JAVA_RUNTIME_ID, homePath: '/usr/lib/jvm/java-21', platform: UNIX_PLATFORM,
    }),
  })
  assert.equal(isKnownTargetTypeId('SSHTarget'), true)
  const listed = listExecutionTargets([], {})
  const ssh = targetById(listed, 'target:ssh-1')
  assert.ok(ssh, '类型自报的目标必须进列表（executionTargetsFromRegisteredTypes 是消费点）')
  assert.equal(ssh.name, 'prod')
  assert.equal(ssh.javaExecutable, '/usr/lib/jvm/java-21/bin/java', 'Java 形态按平台的 java 路径拼')
  // 该类型的目标环境现在会被 customExecutionTargets 收下（原来是写死 === LocalTarget 被滤掉）。
  const environments = [{
    uuid: 'u1', displayName: 'prod', typeId: 'SSHTarget', projectRootOnTarget: '/srv/app',
    runtimes: [{ typeId: JAVA_RUNTIME_ID, homePath: '/usr/lib/jvm/java-21' }],
  }]
  assert.equal(customExecutionTargets(environments).length, 1, '新类型的环境被接受')
  handle.dispose()
  assert.equal(listExecutionTargets([], {}).length, 1, '注销后只剩本机')
  assert.equal(customExecutionTargets(environments).length, 0, '类型注销后该环境不再被列')
  assert.equal(targetEnvironmentTypes().some(t => t.id === 'SSHTarget'), false)
})

test('语言运行时类型认领可执行文件解析：认领的赢、注销后回落 runtimeExecutable', () => {
  const entry = { typeId: PYTHON_RUNTIME_ID, homePath: '/opt/py' }
  assert.equal(executableViaLanguageRuntimeType(entry, UNIX_PLATFORM), undefined, '没有插件时不由 EP 解析')
  const handle = registerLanguageRuntimeType({
    id: PYTHON_RUNTIME_ID,
    isApplicableTo: () => true,
    getConfigurableDescription: () => 'Python 配置',
    getLaunchDescription: () => '运行 Python 应用',
    getExecutable: () => '/opt/py/bin/python3.12',
  })
  assert.equal(executableViaLanguageRuntimeType(entry, UNIX_PLATFORM), '/opt/py/bin/python3.12')
  // 真实消费点：自定义目标的 javaExecutable/描述走它（`customExecutionTargets`）。
  const environments = [{
    uuid: 'u2', displayName: 'py 目标', typeId: LOCAL_TARGET_TYPE_ID, projectRootOnTarget: '/srv',
    runtimes: [{ typeId: PYTHON_RUNTIME_ID, homePath: '/opt/py' }],
  }]
  assert.equal(customExecutionTargets(environments)[0]?.description, '/opt/py/bin/python3.12')
  handle.dispose()
  assert.equal(executableViaLanguageRuntimeType(entry, UNIX_PLATFORM), undefined)
})

test('调节器工厂先改「目标 → 配置初值」的折算；没有工厂时走内建判定', () => {
  const target = {
    id: 'target:ssh-1', name: 'prod', kind: 'custom',
    runtime: { typeId: JAVA_RUNTIME_ID, homePath: '/usr/lib/jvm/java-21' }, platform: UNIX_PLATFORM,
  }
  assert.deepEqual(applyTargetToTemplateProgram({ program: 'java' }, target), { program: '/usr/lib/jvm/java-21/bin/java' },
    '内建判定：Java 形态换程序')
  assert.equal(targetEnvironmentAdjusterFactories().length, 0, '上游平台内没有内建工厂')

  const handle = registerTargetEnvironmentAdjusterFactory({
    id: 'ThirdPartyAdjuster',
    isEnabledFor: runtime => runtime.typeId === JAVA_RUNTIME_ID,
    createAdjuster: () => ({
      adjust: (template, ref) => ({ program: `/opt/wrapper --target ${ref.name} -- ${template.program ?? ''}`.trim() }),
    }),
  })
  assert.deepEqual(applyTargetToTemplateProgram({ program: 'java' }, target),
    { program: '/opt/wrapper --target prod -- java' }, '工厂认领后由它折算')
  handle.dispose()
  assert.deepEqual(applyTargetToTemplateProgram({ program: 'java' }, target), { program: '/usr/lib/jvm/java-21/bin/java' },
    '注销后回到内建判定')
  // 本机目标不受影响。
  assert.deepEqual(applyTargetToTemplateProgram({ program: 'java' }, { id: LOCAL_TARGET_ID, name: '本地', kind: 'local' }), {})
})

test('消费点是活的：executionTargets.ts / runActions.ts 的接线在源码里', () => {
  const targets = read('src/executionTargets.ts')
  assert.match(targets, /executionTargetsFromProviders/)
  assert.match(targets, /executionTargetsFromRegisteredTypes/)
  assert.match(targets, /executableViaLanguageRuntimeType/)
  assert.match(targets, /adjustViaTargetEnvironmentFactories/)
  assert.match(targets, /isKnownTargetTypeId/)
  const actions = read('src/runActions.ts')
  assert.match(actions, /listExecutionTargets\(await availableJdks\(\), \{[\s\S]*?project: \{[\s\S]*?profile:/,
    '活动目标解析把工作区/配置面交给 EP 提供者')
  // 内建三条的常量确实是上游那两个 id 的取值。
  assert.equal(BUILTIN_LOCAL_TARGET_TYPE.id, LOCAL_TARGET_TYPE_ID)
  assert.equal(BUILTIN_JAVA_LANGUAGE_RUNTIME_TYPE.id, JAVA_RUNTIME_ID)
})
