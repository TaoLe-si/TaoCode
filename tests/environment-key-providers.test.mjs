// 内置环境键提供方的判据 —— `src/environmentKeyProviders.ts`。
//
// 上游依据（逐条核过）：
//   · `platform/platform-impl/src/com/intellij/ide/plugins/PluginEnvironmentKeyProvider.kt:16-23`
//     —— 一条键 `enable.disabled.dependent.plugins`、`getRequiredKeys` 空。
//   · `java/execution/openapi/src/com/intellij/execution/environment/JvmEnvironmentKeyProvider.kt:16-22`
//     —— 两条键 `project.jdk` / `project.jdk.name`、`getRequiredKeys` 空。
//   · `platform/platform-api/src/com/intellij/ide/environment/EnvironmentKey.kt:31-33`
//     —— id 语法 `^[a-z0-9]+(\.[a-z0-9]+)*$`。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BUILTIN_ENVIRONMENT_KEY_PROVIDERS, ENABLE_DISABLED_DEPENDENT_PLUGINS, PROJECT_JDK_KEY, PROJECT_JDK_NAME,
  builtinEnvironmentKeys, isValidEnvironmentKeyId, jvmEnvironmentKeyProvider, pluginEnvironmentKeyProvider,
} from '../src/environmentKeyProviders.ts'
import { EnvironmentKeyRegistry, generateEnvironmentKeyStub } from '../src/environmentKeys.ts'

test('id 语法照上游正则', () => {
  assert.equal(isValidEnvironmentKeyId('project.jdk'), true)
  assert.equal(isValidEnvironmentKeyId('enable.disabled.dependent.plugins'), true)
  assert.equal(isValidEnvironmentKeyId('Project.Jdk'), false, '大写不合语法')
  assert.equal(isValidEnvironmentKeyId('project..jdk'), false, '空段不合语法')
  assert.equal(isValidEnvironmentKeyId('.project'), false, '不能以点开头')
})

test('两个内置 provider 的 knownKeys 逐条照上游', () => {
  assert.deepEqual(pluginEnvironmentKeyProvider.knownKeys.map(k => k.id), ['enable.disabled.dependent.plugins'])
  assert.deepEqual(jvmEnvironmentKeyProvider.knownKeys.map(k => k.id), ['project.jdk', 'project.jdk.name'])
  assert.deepEqual(pluginEnvironmentKeyProvider.requiredKeys?.(), [])
  assert.deepEqual(jvmEnvironmentKeyProvider.requiredKeys?.(), [])
})

test('builtinEnvironmentKeys 按 id 排序', () => {
  assert.deepEqual(builtinEnvironmentKeys().map(k => k.id),
    ['enable.disabled.dependent.plugins', 'project.jdk', 'project.jdk.name'])
})

test('注册进 registry 后 isRegistered 为真（消费链路）', () => {
  const registry = new EnvironmentKeyRegistry()
  for (const provider of BUILTIN_ENVIRONMENT_KEY_PROVIDERS) registry.register(provider)
  assert.equal(registry.isRegistered(PROJECT_JDK_KEY), true)
  assert.equal(registry.isRegistered(PROJECT_JDK_NAME), true)
  assert.equal(registry.isRegistered(ENABLE_DISABLED_DEPENDENT_PLUGINS), true)
  assert.deepEqual(registry.requiredKeys(), [], '两个 provider 都没有必需键 ⇒ headless 检查不新增缺失')
})

test('存根生成器列出这两个键', () => {
  const registry = new EnvironmentKeyRegistry()
  for (const provider of BUILTIN_ENVIRONMENT_KEY_PROVIDERS) registry.register(provider)
  const stub = JSON.parse(generateEnvironmentKeyStub(registry.knownKeys()))
  assert.deepEqual(stub.map(entry => entry.key),
    ['enable.disabled.dependent.plugins', 'project.jdk', 'project.jdk.name'])
  assert.ok(stub.every(entry => entry.description.length > 0))
})