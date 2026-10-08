// EP 判据：`com.intellij.lang.findUsagesProvider` 的宿主（`src/findUsagesProvider.ts`）。
//
// 上游依据：EP 声明 `platform/indexing-api/resources/intellij.platform.indexing.xml:18`
// `<extensionPoint qualifiedName="com.intellij.lang.findUsagesProvider"
//  beanClass="com.intellij.lang.LanguageExtensionPoint" dynamic="true">`。
// 三件事：① 通用 bundled provider 仍在；② 第三方按 EP id（带 language 属性）挂的 provider 被
// `providersForLanguage`/`findUsagesType` 真实取到；③ EP id 逐字等于上游。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_FIND_USAGES_PROVIDER, FIND_USAGES_PROVIDER_EP, findUsagesProvidersFromExtensions,
  findUsagesType, providersForLanguage, registerFindUsagesProviderExtension,
  unregisterFindUsagesProviderExtension,
} from '../src/findUsagesProvider.ts'

test('EP id 逐字等于上游 qualifiedName', () => {
  assert.equal(FIND_USAGES_PROVIDER_EP, 'com.intellij.lang.findUsagesProvider')
})

test('bundled 通用 provider 仍在 EP 上', () => {
  assert.ok(findUsagesProvidersFromExtensions().some(provider => provider.id === DEFAULT_FIND_USAGES_PROVIDER.id),
    'lsp 通用 provider 挂在 EP 上')
})

test('第三方按语言属性注册后被真实消费点取到', () => {
  const handle = registerFindUsagesProviderExtension({
    id: 'acme-py', languages: ['python'], getType: () => 'acme 元素', searchContext: 0x1,
  })
  try {
    const providers = providersForLanguage('python')
    const acme = providers.find(provider => provider.id === 'acme-py')
    assert.ok(acme, '第三方 provider 进了 python 的 provider 列表')
    assert.equal(findUsagesType({ name: 'x', language: 'python' }), 'acme 元素', '真实消费点用到第三方 getType')
    assert.equal(providers[providers.length - 1].id, DEFAULT_FIND_USAGES_PROVIDER.id, '通用兜底仍在最后')
  } finally {
    handle.dispose()
  }
  assert.equal(providersForLanguage('python').some(provider => provider.id === 'acme-py'), false, '注销后不再出现')
})

test('unregister 返回真值语义', () => {
  assert.equal(unregisterFindUsagesProviderExtension('does-not-exist'), false)
})
