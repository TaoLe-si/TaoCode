// **lp/inlay-hints 域第二条上游 EP 的宿主接线**（内联提示工厂
// `com.intellij.codeInsight.inlayProviderFactory`）。内联提示提供者那条
// （`com.intellij.codeInsight.inlayProvider`）已由 `src/extensionPoints.ts` 声明、
// `src/inlayProviderRegistry.ts` 消费，见那里的注释。
//
// 上游依据（qualifiedName / EP_NAME **逐字**取自上游）：
//   · `com.intellij.codeInsight.inlayProviderFactory` ——
//     `platform/lang-api/resources/intellij.platform.lang.xml:155-163`
//     （`<extensionPoint qualifiedName="com.intellij.codeInsight.inlayProviderFactory">`
//     `beanClass="com.intellij.codeInsight.hints.InlayHintsProviderExtensionBean"` dynamic="true"）；
//     接口 `platform/lang-api/src/com/intellij/codeInsight/hints/InlayHintsProviderFactory.kt:14`
//     （`EP` 在 `:32`，`ExtensionPointName("com.intellij.codeInsight.inlayProviderFactory")`）；
//     方法面 `getProvidersInfo(): List<ProviderInfo<*>>`（`:22`）、
//     `getProvidersInfoForLanguage(language): List<InlayHintsProvider<*>>`（`:27`）、
//     `getLanguages(): Iterable<Language>`（`:31`）；`ProviderInfo` = `{ language, provider }`（`:39-44`）。
//     **如实差异**：协调单里写的 `com.intellij.codeInsight.inlayHintsFactory` 在上游**不是 EP**
//     （整树零命中）—— 多语言内联提示的工厂真名是这条 `inlayProviderFactory`，故按真名落。
//
// 本仓此前：内联提示全来自语言服务（`src/editorInlayHints.ts` 的 LSP `textDocument/inlayHint`），
// 本地提供者在 `src/inlayProviderRegistry.ts` 的 `com.intellij.codeInsight.inlayProvider` EP 上，
// **工厂那条 EP 没有宿主** —— 第三方无法用一个工厂一次给多个语言登记提供者。本文件补上：
// EP 声明 + 与上游同名的方法面 + consume 函数 `factoryInlayProvidersFor(language)`；
// 消费点是 `src/inlayProviderRegistry.ts` 的 `collectAll`（按语言把工厂给的提供者并进候选集）。
//
// 纯数据层：只 import `src/extensionPoints.ts`，便于 `node --test` 直测。
//
// 判据：`tests/inlay-hints-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** EP id（逐字取自上游 `InlayHintsProviderFactory.EP`，见文件头）。 */
export const INLAY_PROVIDER_FACTORY_EP = 'com.intellij.codeInsight.inlayProviderFactory'

/** 一条内联提示的最小形状（与 `src/inlayHints.ts` 的 `InlayHintLike` 结构一致，不 import 以保纯数据层）。 */
export interface InlayHintShape {
  line: number
  character: number
  label: string
  kind?: number
  paddingLeft?: boolean
  paddingRight?: boolean
}

/** 工厂给提供者的上下文（上游 `InlayHintsProvider.getCollectorFor` 的入参可移植替代）。 */
export interface InlayFactoryContext {
  path: string
  language: string
  text: string
  authors?: readonly { line: number; author: string }[]
}

/** 一个内联提示提供者（上游 `InlayHintsProvider` 的可移植子集）。 */
export interface InlayHintsProviderLike {
  id: string
  /** `isLanguageSupported(language)`（上游 `InlayHintsProvider.isLanguageSupported`）。 */
  isLanguageSupported: (language: string) => boolean
  /** 收集提示（上游 `getCollectorFor(...).collect(...)` 的展平结果）。 */
  collect: (context: InlayFactoryContext) => readonly InlayHintShape[]
}

/** 上游 `ProviderInfo`（`:39-44`）：语言 + 提供者。 */
export interface InlayFactoryProviderInfo {
  language: string
  provider: InlayHintsProviderLike
}

/** 一条内联提示工厂（`InlayHintsProviderFactory` 的方法面，名字与上游逐字相同）。 */
export interface InlayHintsProviderFactoryContribution {
  id: string
  /** 上游 `getProvidersInfo()`。 */
  getProvidersInfo: () => readonly InlayFactoryProviderInfo[]
  /** 上游 `getProvidersInfoForLanguage(language)`（缺省从 `getProvidersInfo()` 过滤）。 */
  getProvidersInfoForLanguage?: (language: string) => readonly InlayHintsProviderLike[]
  /** 上游 `getLanguages()`（缺省从 `getProvidersInfo()` 折）。 */
  getLanguages?: () => readonly string[]
}

/** `InlayHintsProviderFactory.EP.extensionList` 的等价物。 */
export function inlayHintsProviderFactories(scope: string = APPLICATION_SCOPE): InlayHintsProviderFactoryContribution[] {
  return EXTENSIONS.extensionsOf<InlayHintsProviderFactoryContribution>(INLAY_PROVIDER_FACTORY_EP, scope)
}

/** 注册一条工厂（同 id 覆盖）。 */
export function registerInlayHintsProviderFactory(
  contribution: InlayHintsProviderFactoryContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(INLAY_PROVIDER_FACTORY_EP, contribution.id, contribution, options)
}

/** 注销一条工厂（返回是否真的删掉了）。 */
export function unregisterInlayHintsProviderFactory(id: string): boolean {
  return EXTENSIONS.unregisterExtension(INLAY_PROVIDER_FACTORY_EP, id)
}

/** 某个语言下工厂给出的提供者（上游 `getProvidersInfoForLanguage` 的合并版；坏工厂跳过）。 */
export function factoryProvidersForLanguage(language: string, scope: string = APPLICATION_SCOPE): InlayHintsProviderLike[] {
  const out: InlayHintsProviderLike[] = []
  for (const factory of inlayHintsProviderFactories(scope)) {
    try {
      if (typeof factory.getProvidersInfoForLanguage === 'function') {
        out.push(...factory.getProvidersInfoForLanguage(language))
        continue
      }
      for (const info of factory.getProvidersInfo()) {
        if (info.language === language || info.language === '*') out.push(info.provider)
      }
    } catch {
      // 坏工厂跳过，不影响别的工厂。
    }
  }
  return out
}

/** 工厂提供者在本仓注册表里的形状（`LocalInlayProvider` 的结构等价物，逐字同名同义）。 */
export interface FactoryLocalInlayProvider {
  id: string
  languages: readonly string[]
  isAvailableFor: (context: InlayFactoryContext) => boolean
  collect: (context: InlayFactoryContext) => InlayHintShape[]
}

/**
 * 把某个语言下工厂给出的提供者整形成本仓注册表要的形状。
 * 消费点：`src/inlayProviderRegistry.ts` 的 `collectAll`（把这一排并进候选集、按 id 去重）。
 */
export function factoryInlayProvidersFor(language: string, scope: string = APPLICATION_SCOPE): FactoryLocalInlayProvider[] {
  const out: FactoryLocalInlayProvider[] = []
  const seen = new Set<string>()
  for (const provider of factoryProvidersForLanguage(language, scope)) {
    if (!provider?.id || seen.has(provider.id)) continue
    try {
      if (!provider.isLanguageSupported(language)) continue
    } catch {
      continue
    }
    seen.add(provider.id)
    out.push({
      id: provider.id,
      languages: [language],
      isAvailableFor: context => {
        try { return provider.isLanguageSupported(context.language) } catch { return false }
      },
      collect: context => {
        try { return [...provider.collect(context)] } catch { return [] }
      },
    })
  }
  return out
}

// ── EP 声明 ─────────────────────────────────────────────────────────────────────────────

/** 声明 EP（幂等）。 */
export function declareInlayHintsFactoryExtensionPoint(): void {
  EXTENSIONS.declareExtensionPoint({ id: INLAY_PROVIDER_FACTORY_EP, name: '内联提示工厂', scope: APPLICATION_SCOPE, dynamic: true })
}

declareInlayHintsFactoryExtensionPoint()
