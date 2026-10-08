// EP 判据：`com.intellij.registryKey` 的宿主（`src/registryKeys.ts`）。
//
// 上游依据：EP 声明 `platform/ide-core/resources/intellij.platform.ide.core.xml:38`
// `<extensionPoint qualifiedName="com.intellij.registryKey" beanClass="RegistryKeyBean" dynamic="true"/>`。
// 三件事：① bundled 键仍在；② 第三方按 EP id 挂的键被真实消费点（`registryKeySpec`/`registryRows`/
// `visibleRegistryRows`）拿到；③ EP id 逐字等于上游。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  REGISTRY_KEYS, REGISTRY_KEY_EP, allRegistryKeySpecs, registerRegistryKey, registryKeySpec,
  registryKeysFromExtensions, registryRows, unregisterRegistryKey, visibleRegistryRows,
} from '../src/registryKeys.ts'

const GENERAL = { autoShowProcessPopup: false, fuzzyFileSearch: false }

test('EP id 逐字等于上游 qualifiedName', () => {
  assert.equal(REGISTRY_KEY_EP, 'com.intellij.registryKey')
})

test('bundled 键全部登记在 EP 上', () => {
  const epKeys = new Set(registryKeysFromExtensions().map(spec => spec.key))
  for (const spec of REGISTRY_KEYS) assert.ok(epKeys.has(spec.key), `${spec.key} 在 EP 上`)
  assert.equal(allRegistryKeySpecs().length, REGISTRY_KEYS.length)
})

test('第三方按 EP id 注册后被真实消费点拿到', () => {
  const spec = {
    key: 'acme.feature.enabled', type: 'boolean', defaultValue: 'false',
    description: '第三方实验开关。', restartRequired: false, consumer: 'acme/plugin',
  }
  const handle = registerRegistryKey(spec)
  try {
    assert.equal(registryKeySpec('acme.feature.enabled')?.key, 'acme.feature.enabled', 'registryKeySpec 找得到')
    assert.ok(registryRows(new Map(), GENERAL).some(row => row.key === 'acme.feature.enabled'), '表行里出现')
    assert.ok(visibleRegistryRows(GENERAL, 'acme').some(row => row.key === 'acme.feature.enabled'), '速度搜索找得到')
  } finally {
    handle.dispose()
  }
  assert.equal(registryKeySpec('acme.feature.enabled'), undefined, '注销后找不到')
})

test('unregister 返回真值语义', () => {
  assert.equal(unregisterRegistryKey('does-not-exist'), false)
})
