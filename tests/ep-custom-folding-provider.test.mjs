// 判据 · 自定义折叠 provider 的**插件贡献面**（`com.intellij.customFoldingProvider` EP）。
//
// 上游那两条 provider 是 plugin.xml 里的 `<com.intellij.customFoldingProvider implementation="…"/>`
// （`platform/core-api/resources/intellij.platform.core.xml:40` 声明；
// 限定名见 `CustomFoldingProvider.java:18`），宿主启动时由 `getAllProviders()` 全收。
// 本仓没有插件 XML 解析器，改由扩展点宿主（`src/extensionPoints.ts`）承载。这个判据钉三件事：
//   ① EP 已声明，id 与上游 qualifiedName 逐字一致（写错插件挂不上）；
//   ② 本仓 bundled 的三条 provider 仍以 bundled 贡献登记（消费者拿得到）；
//   ③ 第三方按同一个 EP id 挂进来的 provider，经 `adoptFromExtensions()` 收编后能被**真实消费点**
//      `markerKindOf` 认出来（不是"登记了没人消费"的死 EP）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { CUSTOM_FOLDING_PROVIDER_EP, EXTENSIONS } from '../src/extensionPoints.ts'
import {
  CUSTOM_FOLDING_PROVIDERS, CUSTOM_FOLDING_PROVIDER_REGISTRY, customFoldingProviders, markerKindOf,
} from '../src/customFoldingProviders.ts'

test('自定义折叠 provider 的 EP id 与上游逐字一致（com.intellij.customFoldingProvider）', () => {
  assert.equal(CUSTOM_FOLDING_PROVIDER_EP, 'com.intellij.customFoldingProvider')
  assert.equal(EXTENSIONS.hasExtensionPoint(CUSTOM_FOLDING_PROVIDER_EP), true)
})

test('bundled 三条 provider 仍在注册表与 EP 里（默认贡献者没丢）', () => {
  const live = customFoldingProviders().map(provider => provider.id || provider.description)
  for (const provider of CUSTOM_FOLDING_PROVIDERS)
    assert.ok(live.includes(provider.id || provider.description), `bundled provider「${provider.description}」不在注册表里`)
  assert.ok(CUSTOM_FOLDING_PROVIDER_REGISTRY.size >= CUSTOM_FOLDING_PROVIDERS.length)
  const fromEp = EXTENSIONS.extensionsOf(CUSTOM_FOLDING_PROVIDER_EP).length
  assert.ok(fromEp >= CUSTOM_FOLDING_PROVIDERS.length, 'bundled provider 没登记进 EP')
})

test('第三方按 EP id 挂进来的 provider 被收编，且被真实消费点 markerKindOf 认出来', () => {
  const provider = {
    id: 'ThirdPartyFolding', description: '第三方折叠',
    startString: 'third ?', endString: 'endthird',
    start: /^third\b/, end: /^endthird\b/, placeholder: /^third\b([\s\S]*)$/,
  }
  const handle = EXTENSIONS.registerExtension(CUSTOM_FOLDING_PROVIDER_EP, provider.id, provider)
  try {
    assert.ok(CUSTOM_FOLDING_PROVIDER_REGISTRY.adoptFromExtensions() >= 1)
    const start = markerKindOf('third 说明')
    assert.equal(start?.provider.id, 'ThirdPartyFolding', 'markerKindOf 没从注册表里拿到第三方 provider')
    assert.equal(start?.kind, 'start')
    assert.equal(markerKindOf('endthird')?.kind, 'end')
    assert.equal(markerKindOf('endthird')?.provider.id, 'ThirdPartyFolding')
  } finally {
    handle.dispose()
    CUSTOM_FOLDING_PROVIDER_REGISTRY.unregister('ThirdPartyFolding')
  }
  // 摘掉之后消费点不再认它。
  assert.equal(markerKindOf('third 说明'), null)
})

test('消费点走注册表（不是直接读常量表）', async () => {
  const { readFileSync } = await import('node:fs')
  const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
  const registry = read('src/customFoldingProviders.ts')
  assert.match(registry, /for \(const provider of customFoldingProviders\(\)\)/)
  assert.match(registry, /from '\.\/extensionPoints\.ts'/)
  assert.match(read('src/customFoldingSurround.ts'), /customFoldingProviders/)
})
