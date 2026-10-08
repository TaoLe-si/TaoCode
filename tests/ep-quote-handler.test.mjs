// 判据 · 引号 handler 的**插件贡献面**（`com.intellij.quoteHandler` / `com.intellij.lang.quoteHandler`）。
//
// 上游那 20 条注册写在 plugin.xml 里，分挂两条 EP：按 fileType 的 `com.intellij.quoteHandler`
// （`QuoteHandlerEP.java:18`）与按 language 的 `com.intellij.lang.quoteHandler`
// （`LanguageQuoteHandling.java:15`）。本仓没有插件 XML 解析器，改由扩展点宿主承载。
// 这个判据钉三件事：
//   ① 两条 EP 已声明，id 与上游 qualifiedName 逐字一致；
//   ② 本仓 bundled 的 20 条注册仍以 bundled 贡献登记，消费点拿得到（JAVA 仍是 javaLike）；
//   ③ 第三方按同一个 EP id 挂进来的注册，被 `adoptFromExtensions()` 收编后能被**真实消费点**
//      `isJavaLikeQuoteLanguage`（`src/editorTyping.ts` 实际调的那个）拿到。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS, LANGUAGE_QUOTE_HANDLER_EP, QUOTE_HANDLER_EP } from '../src/extensionPoints.ts'
import {
  QUOTE_HANDLER_REGISTRATIONS, QUOTE_HANDLER_REGISTRY, isJavaLikeQuoteLanguage,
  quoteHandlerKey, quoteRegistrationForLanguage,
} from '../src/quoteHandlerRegistry.ts'

test('两条引号 handler EP 的 id 与上游逐字一致', () => {
  assert.equal(QUOTE_HANDLER_EP, 'com.intellij.quoteHandler')
  assert.equal(LANGUAGE_QUOTE_HANDLER_EP, 'com.intellij.lang.quoteHandler')
  assert.equal(EXTENSIONS.hasExtensionPoint(QUOTE_HANDLER_EP), true)
  assert.equal(EXTENSIONS.hasExtensionPoint(LANGUAGE_QUOTE_HANDLER_EP), true)
})

test('bundled 20 条注册仍在（默认贡献者没丢），且能被消费点取到', () => {
  assert.equal(QUOTE_HANDLER_REGISTRY.size >= QUOTE_HANDLER_REGISTRATIONS.length, true)
  for (const registration of QUOTE_HANDLER_REGISTRATIONS)
    assert.ok(QUOTE_HANDLER_REGISTRY.find(quoteHandlerKey(registration)), `bundled 注册「${registration.key}」不在注册表里`)
  const java = quoteRegistrationForLanguage('java')
  assert.equal(java?.key, 'JAVA')
  assert.equal(java?.javaLike, true)
  assert.equal(isJavaLikeQuoteLanguage('java'), true)
})

test('第三方按 EP id 挂进来的注册被收编，且被真实消费点 isJavaLikeQuoteLanguage 拿到', () => {
  assert.equal(isJavaLikeQuoteLanguage('typescript'), false, '前置：本仓 bundled 表里 typescript 没有引号 handler 档案')
  const registration = {
    key: 'TypeScript', via: 'fileType', javaLike: true, multiChar: false, repoLanguage: 'typescript',
    registration: 'third-party/plugin.xml:1', className: 'com.third.party.TsQuoteHandler',
  }
  const handle = EXTENSIONS.registerExtension(QUOTE_HANDLER_EP, quoteHandlerKey(registration), registration)
  try {
    assert.ok(QUOTE_HANDLER_REGISTRY.adoptFromExtensions() >= 1)
    assert.equal(isJavaLikeQuoteLanguage('typescript'), true, '消费点没从注册表拿到第三方注册')
    assert.equal(quoteRegistrationForLanguage('typescript')?.className, 'com.third.party.TsQuoteHandler')
  } finally {
    handle.dispose()
    QUOTE_HANDLER_REGISTRY.unregister(quoteHandlerKey(registration))
  }
  assert.equal(isJavaLikeQuoteLanguage('typescript'), false, '摘掉后消费点不再认它')
})

test('按 language 的那条 EP 也能收编（走 com.intellij.lang.quoteHandler）', () => {
  const registration = {
    key: 'PlainSpike', via: 'language', javaLike: false, multiChar: false, repoLanguage: null,
    registration: 'third-party/plugin.xml:2', className: 'com.third.party.PlainQuoteHandler',
  }
  const handle = EXTENSIONS.registerExtension(LANGUAGE_QUOTE_HANDLER_EP, quoteHandlerKey(registration), registration)
  try {
    assert.ok(QUOTE_HANDLER_REGISTRY.adoptFromExtensions() >= 1)
    assert.equal(QUOTE_HANDLER_REGISTRY.find(quoteHandlerKey(registration))?.className, 'com.third.party.PlainQuoteHandler')
  } finally {
    handle.dispose()
    QUOTE_HANDLER_REGISTRY.unregister(quoteHandlerKey(registration))
  }
})

test('消费点走注册表（不是直接读常量数组）', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../src/quoteHandlerRegistry.ts', import.meta.url), 'utf8')
  assert.match(source, /quoteHandlerRegistrations\(\)\.find/)
  assert.match(source, /from '\.\/extensionPoints\.ts'/)
  assert.match(readFileSync(new URL('../src/editorTyping.ts', import.meta.url), 'utf8'), /isJavaLikeQuoteLanguage/)
})
