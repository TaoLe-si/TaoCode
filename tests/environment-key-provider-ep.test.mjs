// EP 判据：`com.intellij.environmentKeyProvider` 的宿主（`src/environmentKeyProviders.ts`）。
//
// 上游依据：EP 声明 `platform/platform-api/resources/intellij.platform.ide.xml:153`
// `<extensionPoint qualifiedName="com.intellij.environmentKeyProvider"
//  interface="com.intellij.ide.environment.EnvironmentKeyProvider" dynamic="true"/>`
// 与 `EnvironmentKeyProvider.kt:24` 的 `ExtensionPointName`。三件事：
//   ① bundled 提供方仍在（两个内置 provider 仍在 EP 上）；
//   ② 第三方按 EP id 注册后被**真实消费点**拿到（`environmentKeyProvidersFromExtensions()`
//      → `EnvironmentKeyRegistry.register` → `isRegistered`/`requiredKeys`）；
//   ③ EP id 逐字等于上游。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ENVIRONMENT_KEY_PROVIDER_EP, environmentKeyProvidersFromExtensions,
  jvmEnvironmentKeyProvider, pluginEnvironmentKeyProvider,
  registerEnvironmentKeyProvider, unregisterEnvironmentKeyProvider,
} from '../src/environmentKeyProviders.ts'
import { EnvironmentKeyRegistry, environmentKey } from '../src/environmentKeys.ts'
import { requiredKeysOf } from '../src/startupActivities.ts'

test('EP id 逐字等于上游 qualifiedName', () => {
  assert.equal(ENVIRONMENT_KEY_PROVIDER_EP, 'com.intellij.environmentKeyProvider')
})

test('bundled 贡献仍在：两个内置提供方都在 EP 上', () => {
  const providers = environmentKeyProvidersFromExtensions()
  assert.ok(providers.includes(pluginEnvironmentKeyProvider), 'plugin 内置提供方仍在 EP 上')
  assert.ok(providers.includes(jvmEnvironmentKeyProvider), 'jvm 内置提供方仍在 EP 上')
})

test('第三方按 EP id 注册后被真实消费点拿到', () => {
  const acmeKey = environmentKey('acme.custom.key', 'Third-party key.')
  const handle = registerEnvironmentKeyProvider('acme', {
    knownKeys: [acmeKey],
    requiredKeys: () => [acmeKey],
  })
  try {
    const providers = environmentKeyProvidersFromExtensions()
    assert.ok(providers.some(provider => provider.knownKeys.some(key => key.id === 'acme.custom.key')),
      '第三方提供方进了 EP 集合')
    // 真实消费点：workspaceLifecycle 把 EP 集合灌进 EnvironmentKeyRegistry。
    const registry = new EnvironmentKeyRegistry()
    for (const provider of providers) registry.register(provider)
    assert.equal(registry.isRegistered(acmeKey), true, '注册后 isRegistered 为真')
    assert.deepEqual(requiredKeysOf(providers).map(key => key.id).includes('acme.custom.key'), true,
      '第三方必需键被 headless 检查看到')
  } finally {
    handle.dispose()
  }
  assert.equal(environmentKeyProvidersFromExtensions().some(
    provider => provider.knownKeys.some(key => key.id === 'acme.custom.key')), false, '注销后不再收编')
})

test('unregister 返回真值语义', () => {
  assert.equal(unregisterEnvironmentKeyProvider('does-not-exist'), false)
})
