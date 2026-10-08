// 判据 · **内联提示的扩展点**（`src/inlayHintsExtensionPoints.ts`，上游
// `com.intellij.codeInsight.inlayProviderFactory`；提供者那条 `com.intellij.codeInsight.inlayProvider`
// 由 `src/extensionPoints.ts` 声明、`src/inlayProviderRegistry.ts` 消费，这里一并钉住）。
//
// 钉四件事：
//   ① 两条 EP 的 id 与上游 `qualifiedName` / `EP_NAME` 逐字一致，且已在宿主里声明；
//   ② 工厂按 id 注册/注销生效，按语言取提供者；
//   ③ 消费面真的读 EP：`factoryInlayProvidersFor` 把工厂给的提供者整形成注册表形状
//      （`src/inlayProviderRegistry.ts` 的 `collectAll` 收编）；
//   ④ bundled 工厂（urlPath）真的挂上 `inlayProviderFactory`。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS, INLAY_PROVIDER_EP } from '../src/extensionPoints.ts'
import {
  INLAY_PROVIDER_FACTORY_EP,
  factoryInlayProvidersFor,
  factoryProvidersForLanguage,
  inlayHintsProviderFactories,
  registerInlayHintsProviderFactory,
  unregisterInlayHintsProviderFactory,
} from '../src/inlayHintsExtensionPoints.ts'
import { BUNDLED_INLAY_FACTORY_ID, createInlayProviderRegistry } from '../src/inlayProviderRegistry.ts'

const hint = (line, character, label) => ({ line, character, label })

function demoProvider(id, language) {
  return {
    id,
    isLanguageSupported: candidate => candidate === language,
    collect: context => [hint(1, 0, `${id}:${context.language}`)],
  }
}

test('两条 EP 已声明，id 与上游逐字一致', () => {
  assert.equal(INLAY_PROVIDER_FACTORY_EP, 'com.intellij.codeInsight.inlayProviderFactory')
  assert.equal(INLAY_PROVIDER_EP, 'com.intellij.codeInsight.inlayProvider')
  assert.equal(EXTENSIONS.hasExtensionPoint(INLAY_PROVIDER_FACTORY_EP), true)
  assert.equal(EXTENSIONS.hasExtensionPoint(INLAY_PROVIDER_EP), true)
})

test('工厂按 id 注册/注销生效，按语言取提供者', () => {
  const factory = registerInlayHintsProviderFactory({
    id: 'demo.inlayFactory',
    getProvidersInfo: () => [
      { language: 'java', provider: demoProvider('demo.javaHints', 'java') },
      { language: 'typescript', provider: demoProvider('demo.tsHints', 'typescript') },
      { language: '*', provider: demoProvider('demo.anyHints', '*') },
    ],
  })
  try {
    assert.ok(inlayHintsProviderFactories().some(f => f.id === 'demo.inlayFactory'))
    const java = factoryProvidersForLanguage('java').map(p => p.id)
    assert.ok(java.includes('demo.javaHints'))
    assert.ok(java.includes('demo.anyHints'))
    assert.equal(java.includes('demo.tsHints'), false)
    assert.equal(factoryProvidersForLanguage('typescript').map(p => p.id).includes('demo.tsHints'), true)
  } finally {
    factory.dispose()
  }
  assert.equal(factoryProvidersForLanguage('java').some(p => p.id === 'demo.javaHints'), false)
  assert.equal(unregisterInlayHintsProviderFactory('demo.inlayFactory'), false)
})

test('factoryInlayProvidersFor 整形成注册表形状，按 id 去重', () => {
  const factory = registerInlayHintsProviderFactory({
    id: 'demo.inlayFactory.shape',
    getProvidersInfo: () => [
      { language: 'java', provider: demoProvider('demo.javaHints', 'java') },
      { language: 'java', provider: demoProvider('demo.javaHints', 'java') }, // 同 id 去重
      { language: 'java', provider: demoProvider('demo.tsOnly', 'typescript') }, // 不支持 java ⇒ 丢
    ],
  })
  try {
    const shaped = factoryInlayProvidersFor('java')
    const ids = shaped.map(p => p.id)
    assert.equal(ids.filter(id => id === 'demo.javaHints').length, 1, '同 id 应去重')
    assert.equal(ids.includes('demo.tsOnly'), false, '不支持 java 的提供者应丢弃')
    const provider = shaped.find(p => p.id === 'demo.javaHints')
    assert.deepEqual(provider.languages, ['java'])
    assert.equal(provider.isAvailableFor({ path: 'A.java', language: 'java', text: '' }), true)
    assert.deepEqual(provider.collect({ path: 'A.java', language: 'java', text: '' }), [hint(1, 0, 'demo.javaHints:java')])
  } finally { factory.dispose() }
})

test('消费点 collectAll 真的吃工厂给的提供者', () => {
  const factory = registerInlayHintsProviderFactory({
    id: 'demo.inlayFactory.consumed',
    getProvidersInfo: () => [{ language: 'other', provider: demoProvider('demo.consumedHints', 'other') }],
  })
  try {
    const registry = createInlayProviderRegistry([])
    const collected = registry.collectAll({ path: 'x.txt', language: 'other', text: 'hello' })
    assert.ok(collected.some(h => h.label === 'demo.consumedHints:other'), collected.map(h => h.label).join(','))
  } finally { factory.dispose() }
})

test('bundled 工厂挂上 inlayProviderFactory EP', () => {
  assert.ok(inlayHintsProviderFactories().some(f => f.id === BUNDLED_INLAY_FACTORY_ID))
  // 内建工厂给 `*` 语言一条 urlPath 提供者，与 provider EP 上那条同 id（collectAll 按 id 去重）
  const anyLanguage = factoryProvidersForLanguage('other').map(p => p.id)
  assert.ok(anyLanguage.length >= 1)
})
