// **面包屑/导航栏的扩展点**（上游 `com.intellij.ui.breadcrumbs.BreadcrumbsProvider` 一族在本仓的等价物）。
//
// 上游是什么：一条 EP —— `com.intellij.breadcrumbsInfoProvider`，声明在
// `platform/editor-ui-api/resources/intellij.platform.editor.ui.xml:48`
// （`interface="com.intellij.ui.breadcrumbs.BreadcrumbsProvider"` dynamic="true"）；限定名见
// `BreadcrumbsProvider.java:24` 的 `EP_NAME`。接口方法面：`acceptElement(PsiElement)`（`:35`）、
// `getElementInfo(PsiElement)`（`:44`）、`getElementIcon`（`:50`，缺省 null）、
// `getElementTooltip`（`:58`，缺省 null）、`getParent(PsiElement)`（`:66`，缺省 null）、
// `getChildren(PsiElement)`（`:76`，缺省空表）；另 `getLanguages()`（`:29`）与
// `isShownByDefault()`（`:92-94`）。消费点：`BreadcrumbsUtil.java:11` 取全表；
// `EditorSettingsExternalizable.java:471` 与 `BreadcrumbsConfigurable.java:61` 用它建按语言的设置表；
// `StickyLinesLanguageSupport.kt:48` 与 `BreadcrumbsPanel.java:129` 是渲染/监听侧。
//
// 本仓此前：面包屑的**行为**已落在 `src/breadcrumbs.ts`（路径段 + 符号链）+ `src/navToolbarCrumbs.ts`
// （`BreadcrumbsProvider` 数据形状 + `providersForLanguage`/`showByDefaultOf`/`forcedShown`）+
// 渲染 `src/components/BreadcrumbsBar.vue`，判词却写着「`providersForLanguage` 等四条没有生产消费者」
// —— 根因是**没有 EP 宿主**：第三方无法按 id 挂一个 provider，那四条于是只被判据引用。本文件补上：
//   · `com.intellij.breadcrumbsInfoProvider` 用 `src/extensionPoints.ts` 的 `declareExtensionPoint()` 声明；
//   · 贡献形状 = 上游接口的可移植子集（本仓没有 PSI，`PsiElement` 换成 `CrumbInput`，与
//     `src/navToolbarCrumbs.ts` 的 `CrumbInput` 同源）；`getLanguages`/`isShownByDefault`/`getContextActions`
//     逐条保留（`:29`/`:92-94`/`:76` 那一族）；
//   · 消费面 `breadcrumbsProviders()` 从 EP 收表，`adoptBreadcrumbsProviders()` 把它折成
//     `src/navToolbarCrumbs.ts` 的 `BreadcrumbsProvider[]`（于是 `providersForLanguage`/`showByDefaultOf`
//     有了**生产消费者**：EP 收上来的贡献），`shownLanguages()` 汇总所有 provider 声明的语言
//     （对齐 `BreadcrumbsConfigurable.java:61` 的按语言建表）。
//
// 与上游的如实差异：① `PsiElement` → `CrumbInput`（本仓面包屑段的形状）；② `getElementIcon` 返回
// 「令牌名」而不是 Swing `Icon`（本仓不落 hex，交给样式表）；③ `getParent` 归成 `parentKey`
// （本仓段身份是字符串 key）。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测。
//
// 判据：`tests/breadcrumbs-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import type { BreadcrumbsProvider, CrumbInput } from './navToolbarCrumbs.ts'

/** 上游 EP id（逐字取自 `BreadcrumbsProvider.java:24` 的 `EP_NAME`）。 */
export const BREADCRUMBS_INFO_PROVIDER_EP = 'com.intellij.breadcrumbsInfoProvider'

/**
 * 一条面包屑 provider 贡献（上游 `BreadcrumbsProvider` 的可移植子集）。
 * `acceptElement`/`getElementInfo` 是必给的两个（上游非 default），其余按上游 default 缺省。
 */
export interface BreadcrumbsInfoProvider {
  id: string
  /** 负责的语言（上游 `getLanguages()`，`:29`）。 */
  languages: readonly string[]
  acceptElement: (crumb: CrumbInput) => boolean
  getElementInfo: (crumb: CrumbInput) => string
  getElementIcon?: (crumb: CrumbInput) => string | null
  getElementTooltip?: (crumb: CrumbInput) => string | null
  getParent?: (crumb: CrumbInput) => string | null
  getChildren?: (crumb: CrumbInput) => readonly CrumbInput[]
  getContextActions?: (crumb: CrumbInput) => readonly string[]
  /** 上游 `isShownByDefault()`（`:92-94`），缺省 true。 */
  isShownByDefault?: () => boolean
}

/** EP 声明（幂等）。 */
export function declareBreadcrumbsExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({
    id: BREADCRUMBS_INFO_PROVIDER_EP, name: '面包屑信息提供方', scope: APPLICATION_SCOPE, dynamic: true,
  })
}

declareBreadcrumbsExtensionPoints()

/** 按 id 注册一条贡献。 */
export function registerBreadcrumbsInfoProvider(value: BreadcrumbsInfoProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(BREADCRUMBS_INFO_PROVIDER_EP, value.id, value, options)
}

/** 全部贡献（上游 `BreadcrumbsProvider.EP_NAME.getExtensionList()`，`BreadcrumbsUtil.java:11` 同口径）。 */
export function breadcrumbsInfoProviders(scope: string = APPLICATION_SCOPE): BreadcrumbsInfoProvider[] {
  return EXTENSIONS.extensionsOf<BreadcrumbsInfoProvider>(BREADCRUMBS_INFO_PROVIDER_EP, scope)
}

/**
 * 把 EP 贡献折成 `src/navToolbarCrumbs.ts` 的 `BreadcrumbsProvider` 形状 ——
 * 于是 `providersForLanguage`/`showByDefaultOf` 有了**生产消费者**（此前只被判据引用）。
 */
export function adoptBreadcrumbsProviders(scope: string = APPLICATION_SCOPE): BreadcrumbsProvider[] {
  return breadcrumbsInfoProviders(scope).map(contribution => {
    const icon = contribution.getElementIcon
    const tooltip = contribution.getElementTooltip
    const parent = contribution.getParent
    const children = contribution.getChildren
    const contextActions = contribution.getContextActions
    return {
      languages: contribution.languages,
      accept: crumb => contribution.acceptElement(crumb),
      info: crumb => contribution.getElementInfo(crumb),
      ...(icon ? { icon: (crumb: CrumbInput) => icon(crumb) } : {}),
      ...(tooltip ? { tooltip: (crumb: CrumbInput) => tooltip(crumb) } : {}),
      ...(parent ? { parentKey: (crumb: CrumbInput) => parent(crumb) } : {}),
      ...(children ? { children: (crumb: CrumbInput) => children(crumb) } : {}),
      ...(contextActions ? { contextActions: (crumb: CrumbInput) => contextActions(crumb) } : {}),
      shownByDefault: contribution.isShownByDefault ? contribution.isShownByDefault() : true,
    }
  })
}

/**
 * 全部 provider 声明的语言，按首次出现排序（对齐 `BreadcrumbsConfigurable.java:61` 的按语言建表）。
 */
export function shownLanguages(scope: string = APPLICATION_SCOPE): string[] {
  const seen = new Set<string>()
  for (const contribution of breadcrumbsInfoProviders(scope)) {
    for (const language of contribution.languages) seen.add(language)
  }
  return [...seen]
}

/* ── bundled：本仓内建的按语言 provider 注册 ───────────────────────────────────── */

/**
 * 把宿主已有的**语言 → 段形状**映射挂成 EP 贡献（每个语言一条）。
 * `descriptor` 给这个语言的名字/图标/上下文档（缺省按语言名首字母大写）。
 */
export interface CrumbLanguageDescriptor {
  language: string
  /** 段文字（缺省用 crumb.text）。 */
  info?: (crumb: CrumbInput) => string
  icon?: (crumb: CrumbInput) => string | null
  tooltip?: (crumb: CrumbInput) => string | null
  /** 该语言的面包屑默认显不显示（缺省 true）。 */
  shownByDefault?: boolean
}

export const BUILTIN_BREADCRUMBS_LANGUAGE_PREFIX = 'taocode.breadcrumbs.'

/**
 * 把一批「语言 → 段形状」挂成 `com.intellij.breadcrumbsInfoProvider` 的 bundled 贡献
 * （每个语言一条，id = 前缀 + 语言）。返回注销函数。
 */
export function registerBundledBreadcrumbsProviders(descriptors: readonly CrumbLanguageDescriptor[]): () => void {
  const handles = descriptors.map(descriptor => registerBreadcrumbsInfoProvider({
    id: BUILTIN_BREADCRUMBS_LANGUAGE_PREFIX + descriptor.language,
    languages: [descriptor.language],
    acceptElement: () => true,
    getElementInfo: descriptor.info ?? (crumb => crumb.text),
    ...(descriptor.icon ? { getElementIcon: descriptor.icon } : {}),
    ...(descriptor.tooltip ? { getElementTooltip: descriptor.tooltip } : {}),
    ...(descriptor.shownByDefault === undefined ? {} : { isShownByDefault: () => descriptor.shownByDefault === true }),
  }, { source: 'bundled' }))
  return () => { for (const handle of handles) handle.dispose() }
}
