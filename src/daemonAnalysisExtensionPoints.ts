// daemon 域**分析侧**的三条上游 EP —— 方法面 / 贡献面 / 消费函数（2026-10-07 daemon-analysis lane）。
//
// 与 `src/daemonExtensionPoints.ts` 的分工：那一边留 **EP id 常量**与 `declareDaemonExtensionPoints()`
// 的声明调用（声明必须排在该模块全部常量之后调用 —— 那里的 TDZ 注释写了为什么）；**这边**放这三条
// EP 的接口形状、注册入口与消费函数。拆开的两个理由：① 三条 EP 的接口面与主文件那些「检查项/意图/
// 聚合」的消费面不共一个职责域；② 主文件加这批会越过 900 行的模块上限（`tests/module-size.test.mjs`）。
//
// 上游依据（qualifiedName 逐字取自 plugin.xml 的 `<extensionPoint>` 声明）：
//   · `com.intellij.daemon.externalAnnotatorsFilter` —— `platform/analysis-api/resources/intellij.platform.analysis.xml:23`
//     （`interface="com.intellij.lang.ExternalAnnotatorsFilter"` dynamic="true"；EP 名见
//     `platform/analysis-api/src/com/intellij/lang/ExternalAnnotatorsFilter.java:15` 的 `EXTENSION_POINT_NAME`）。
//     方法面 `isProhibited(ExternalAnnotator annotator, PsiFile file)`（同文件 `:17`）。
//     消费点语义 `ExternalLanguageAnnotators.allForFile`（同目录 `ExternalLanguageAnnotators.java:20-26`）：
//     `ContainerUtil.findAll(annotators, annotator -> !ContainerUtil.exists(filters, filter -> filter.isProhibited(annotator, file)))`
//     —— **任一** filter 说 prohibited，那个 annotator 就不跑。
//   · `com.intellij.implicitUsageProvider` —— 同 XML `:25`
//     （`interface="com.intellij.codeInsight.daemon.ImplicitUsageProvider"` dynamic="true"；EP 名见
//     `platform/analysis-api/src/com/intellij/codeInsight/daemon/ImplicitUsageProvider.java:16` 的 `EP_NAME`）。
//     方法面六个：`isImplicitUsage` / `isImplicitRead` / `isImplicitWrite`（必须实现）与三个 default
//     false 的 `isImplicitlyNotNullInitialized` / `isClassWithCustomizedInitialization` /
//     `isReferencedByAlternativeNames`（同文件 `:19-49`）。消费点语义
//     `platform/analysis-api/src/com/intellij/codeInspection/reference/RefUtil.java:26`（`isImplicitUsage`）/
//     `:36`（`isImplicitRead`）/ `:55`（`isImplicitWrite`）：逐个 provider 问，**任一为真即为真**
//     （`isImplicitWrite` 上游末尾还回落到 `EntryPointsManager`，本仓没有那个服务，如实记账）。
//   · `com.intellij.contributedReferencesAnnotator` —— 同 XML `:30-32`
//     （`beanClass="com.intellij.lang.LanguageExtensionPoint" dynamic="true"` +
//     `<with attribute="implementationClass" implements="com.intellij.lang.annotation.ContributedReferencesAnnotator"/>`）。
//     方法面 `annotate(PsiElement element, List<PsiReference> references, AnnotationHolder holder)`
//     （`platform/analysis-api/src/com/intellij/lang/annotation/ContributedReferencesAnnotator.java:28-31`）；
//     注册面 `ContributedReferencesAnnotators.INSTANCE`（`platform/analysis-api/src/com/intellij/lang/ContributedReferencesAnnotators.java:10-11`，
//     是 `LanguageExtension`，所以带 any 档 `allForLanguageOrAny`）；消费点
//     `HyperlinkAnnotator.annotateContributedReferences`（`platform/lang-impl/src/com/intellij/codeInsight/highlighting/HyperlinkAnnotator.java:76-86`）：
//     先取宿主元素的引用表，再按文件语言取贡献者，逐个 `annotate(element, references, holder)`。
//
// 与上游的如实差异（三条的根因都是「本仓没有 PSI」；方法名与消费口径逐条对位，不另起名字）：
//   · `isProhibited` 的 `annotator` 收成 `ExternalAnnotatorRef`（本仓注解器的身份面 `{ id, languages }`）、
//     `file` 收成 `DaemonFileRef`（工作区相对路径 + 文本 + 语言）—— 上游问的是 `ExternalAnnotator`
//     实例与 `PsiFile`。
//   · `ImplicitUsageProvider` 的 `PsiElement` 收成 `ImplicitUsageElement`（路径 + 0 基行/列 + 名字 +
//     就近行文本 + 整份文本 + 语言 id）：本仓问它的那一拍是「LSP 诊断说这里有未使用符号」，
//     手边只有诊断的位置，没有 PSI 元素；「就近行文本 + 整份文本」是给词法判定用的
//     （上游看 `modifierList` 的注解与 `ReferencesSearch`，本仓看注解名与全文件引用文本）。
//   · `ContributedReferencesAnnotator` 的 `element` 收成 `ContributedReferencesHost`（宿主偏移区间）、
//     `references` 收成 `ContributedReference`（偏移区间 + target）、`holder` 收成
//     `ContributedReferencesHolder`（一个 `add()`，对应上游 `AnnotationHolder.newAnnotation(...).range(...).create()`）。
// 纯数据层：只 import `src/extensionPoints.ts`（宿主）与 `src/daemonExtensionPoints.ts`（EP id 常量
// 与注册入口），不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// 判据：`tests/daemon-analysis-extension-points.test.mjs`。

import {
  APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions,
} from './extensionPoints.ts'
// EP id 常量与「按 id 注册一条贡献」的入口留在主文件（那一份是唯一来源，不在这里复制字符串）。
import {
  CONTRIBUTED_REFERENCES_ANNOTATOR_EP, EXTERNAL_ANNOTATORS_FILTER_EP, IMPLICIT_USAGE_PROVIDER_EP,
  registerDaemonExtension,
} from './daemonExtensionPoints.ts'

// ── EP 一：外部注解器过滤器 ─────────────────────────────────────────────────────────────────

/** 一条注解器的身份面（上游 `isProhibited` 的第一个参数是 `ExternalAnnotator` 实例）。 */
export interface ExternalAnnotatorRef {
  /** 注解器 id（本仓 `src/annotatorRegistry.ts` 的 `Annotator.id`）。 */
  id: string
  /** 适用语言（`'*'` = 任意语言，同 `Annotator.languages` 口径）。 */
  languages: readonly string[]
}

/** 一份文件的身份面（上游 `PsiFile` 的可移植面：工作区相对路径 + 文本 + 语言 id）。 */
export interface DaemonFileRef {
  path: string
  text: string
  /** 语言 id（缺省 = 调用方没给，过滤器按需自己判）。 */
  language?: string
}

/** 一条外部注解器过滤器（`ExternalAnnotatorsFilter` 的方法面，方法名与上游逐字相同）。 */
export interface ExternalAnnotatorsFilterContribution {
  id: string
  /** 上游 `isProhibited(annotator, file)`：true = 这个注解器不要在这份文件上跑。 */
  isProhibited: (annotator: ExternalAnnotatorRef, file: DaemonFileRef) => boolean
}

/** `ExternalAnnotatorsFilter.EXTENSION_POINT_NAME.getExtensionList()` 的等价物。 */
export function externalAnnotatorsFilters(scope: string = APPLICATION_SCOPE): ExternalAnnotatorsFilterContribution[] {
  return EXTENSIONS.extensionsOf<ExternalAnnotatorsFilterContribution>(EXTERNAL_ANNOTATORS_FILTER_EP, scope)
}

/**
 * 上游 `ContainerUtil.exists(filters, filter -> filter.isProhibited(annotator, file))`：任一过滤器说
 * prohibited 就是 true。坏过滤器（抛错）当作「不拦」跳过 —— 与 `shouldHighlightFileByFilters`
 * 同一容错口径（上游会往上抛，本仓按「坏的放行」记，差异在此：一个坏贡献不该把分析整条掐掉）。
 */
export function isExternalAnnotatorProhibited(
  annotator: ExternalAnnotatorRef, file: DaemonFileRef, scope: string = APPLICATION_SCOPE,
): boolean {
  for (const filter of externalAnnotatorsFilters(scope)) {
    try {
      if (filter.isProhibited(annotator, file)) return true
    } catch {
      // 坏过滤器不拦。
    }
  }
  return false
}

/**
 * `ExternalLanguageAnnotators.allForFile` 的等价物（`:20-26`）：把注解器表按过滤器筛一遍。
 * 没有注册任何过滤器时**原样返回入参的副本** ⇒ 既有行为零改动。
 */
export function externalAnnotatorsFor<T extends ExternalAnnotatorRef>(
  annotators: readonly T[], file: DaemonFileRef, scope: string = APPLICATION_SCOPE,
): T[] {
  if (!externalAnnotatorsFilters(scope).length) return [...annotators]
  return annotators.filter(annotator => !isExternalAnnotatorProhibited(annotator, file, scope))
}

/** 注册一条外部注解器过滤器（内建三条在 `src/annotatorHighlights.ts`）。 */
export function registerExternalAnnotatorsFilter(
  contribution: ExternalAnnotatorsFilterContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(EXTERNAL_ANNOTATORS_FILTER_EP, contribution.id, contribution,
    { source: 'bundled', ...options })
}

// ── EP 二：隐式使用提供者 ───────────────────────────────────────────────────────────────────

/**
 * 声明形态。上游 provider 在 `PsiElement` 的 `when` 上分档（JUnit 那支分 `PsiParameter` /
 * `PsiEnumConstant` / `PsiMethod` / `PsiField` / `PsiClass`）；本仓按**就近词法**归到这七档之一，
 * 认不出给 `unknown`（`unknown` 只可能被「不挑形态」的 provider 命中）。
 */
export type ImplicitUsageElementKind =
  | 'class' | 'method' | 'field' | 'parameter' | 'enumConstant' | 'local' | 'unknown'

/** 一个可能被报成「未使用」的符号（上游 `PsiElement` 的可移植面）。 */
export interface ImplicitUsageElement {
  /** 工作区相对路径。 */
  path: string
  /** 0 基行号。 */
  line: number
  /** 0 基列号。 */
  column: number
  /** 符号名（取不到给空串 —— provider 据此返回 false，不猜）。 */
  name: string
  kind: ImplicitUsageElementKind
  /** 该行整行文本（上游看 `modifierList` 上的注解，本仓看这一行里有没有注解名）。 */
  lineText: string
  /** 整份文件文本（`@MethodSource("x")` 这类「从别处按名字引用」要扫全文件）。 */
  text: string
  /** 语言 id。 */
  language: string
}

/**
 * 一条隐式使用提供者（`ImplicitUsageProvider` 的方法面，六个方法名与上游逐字相同）。
 * 前三个必须实现（上游是抽象方法），后三个可选（上游是 default false）。
 */
export interface ImplicitUsageProviderContribution {
  id: string
  /** 上游 `isImplicitUsage(element)`：这个元素不该被报成未使用。 */
  isImplicitUsage: (element: ImplicitUsageElement) => boolean
  /** 上游 `isImplicitRead(element)`：不该被报成「赋了值但没人读」。 */
  isImplicitRead: (element: ImplicitUsageElement) => boolean
  /** 上游 `isImplicitWrite(element)`：不该被报成「被读但没人赋值」。 */
  isImplicitWrite: (element: ImplicitUsageElement) => boolean
  /** 上游 default false：隐式初始化成非 null。 */
  isImplicitlyNotNullInitialized?: (element: ImplicitUsageElement) => boolean
  /** 上游 default false：类有源码之外的初始化步骤（注解处理器等）。 */
  isClassWithCustomizedInitialization?: (element: ImplicitUsageElement) => boolean
  /** 上游 default false：可能被**别的名字**引用（改名搜索会漏）。 */
  isReferencedByAlternativeNames?: (element: ImplicitUsageElement) => boolean
}

/** `ImplicitUsageProvider.EP_NAME.getExtensionList()` 的等价物。 */
export function implicitUsageProviders(scope: string = APPLICATION_SCOPE): ImplicitUsageProviderContribution[] {
  return EXTENSIONS.extensionsOf<ImplicitUsageProviderContribution>(IMPLICIT_USAGE_PROVIDER_EP, scope)
}

/** 六个方法面的公共循环（`RefUtil` 那三个函数逐个对位；可选方法没实现 = false，照上游 default）。 */
function anyImplicitUsageProviderSays(
  scope: string,
  method: 'isImplicitUsage' | 'isImplicitRead' | 'isImplicitWrite'
    | 'isImplicitlyNotNullInitialized' | 'isClassWithCustomizedInitialization' | 'isReferencedByAlternativeNames',
  element: ImplicitUsageElement,
): boolean {
  for (const provider of implicitUsageProviders(scope)) {
    const fn = provider[method]
    if (typeof fn !== 'function') continue
    try {
      if ((fn as (value: ImplicitUsageElement) => boolean)(element) === true) return true
    } catch {
      // 坏 provider 只跳过它自己（上游会往上抛，本仓按「不拦」记）。
    }
  }
  return false
}

/** `RefUtil.isImplicitUsage`（`RefUtil.java:26`）：任一 provider 为真即为真。 */
export function isImplicitUsage(element: ImplicitUsageElement, scope: string = APPLICATION_SCOPE): boolean {
  return anyImplicitUsageProviderSays(scope, 'isImplicitUsage', element)
}

/** `RefUtil.isImplicitRead`（`RefUtil.java:36`）。 */
export function isImplicitRead(element: ImplicitUsageElement, scope: string = APPLICATION_SCOPE): boolean {
  return anyImplicitUsageProviderSays(scope, 'isImplicitRead', element)
}

/** `RefUtil.isImplicitWrite`（`RefUtil.java:55`；上游末尾回落的 `EntryPointsManager` 本仓没有）。 */
export function isImplicitWrite(element: ImplicitUsageElement, scope: string = APPLICATION_SCOPE): boolean {
  return anyImplicitUsageProviderSays(scope, 'isImplicitWrite', element)
}

/** 上游 default false 的三个查询面（没有 provider 实现时一律 false，与上游 default 同口径）。 */
export function isImplicitlyNotNullInitialized(element: ImplicitUsageElement, scope: string = APPLICATION_SCOPE): boolean {
  return anyImplicitUsageProviderSays(scope, 'isImplicitlyNotNullInitialized', element)
}

export function isClassWithCustomizedInitialization(element: ImplicitUsageElement, scope: string = APPLICATION_SCOPE): boolean {
  return anyImplicitUsageProviderSays(scope, 'isClassWithCustomizedInitialization', element)
}

export function isReferencedByAlternativeNames(element: ImplicitUsageElement, scope: string = APPLICATION_SCOPE): boolean {
  return anyImplicitUsageProviderSays(scope, 'isReferencedByAlternativeNames', element)
}

/** 注册一条隐式使用提供者（内建那支 = JUnit 5 的词法子集，见 `src/junitImplicitUsage.ts`）。 */
export function registerImplicitUsageProvider(
  contribution: ImplicitUsageProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(IMPLICIT_USAGE_PROVIDER_EP, contribution.id, contribution,
    { source: 'bundled', ...options })
}

// ── EP 三：贡献引用注解器 ───────────────────────────────────────────────────────────────────

/** 一条引用（上游 `PsiReference` 的可移植面：文件内偏移区间 + 目标）。 */
export interface ContributedReference {
  /** 偏移区间（半开）。 */
  from: number
  to: number
  /** 引用的目标（上游 `reference.resolve()` 的产物；本仓是文本目标，可以是 URL 或路径）。 */
  target?: string
  description?: string
}

/** 贡献者产出的一条注解（上游这几条注解都是「可点」的引用位置 ⇒ `kind` 固定 hyperlink）。 */
export interface ContributedReferenceAnnotation {
  from: number
  to: number
  kind: 'hyperlink'
  target?: string
  description?: string
  /** 缺省 `information`（上游由 `holder.newAnnotation(severity, …)` 给，本仓给可选面）。 */
  severity?: 'information' | 'warning' | 'weakWarning' | 'error'
}

/** 收注解的容器（上游 `AnnotationHolder` 的可移植面）。 */
export interface ContributedReferencesHolder {
  /** 上游 `holder.newAnnotation(...).range(...).create()` 的收口。 */
  add: (annotation: ContributedReferenceAnnotation) => void
}

/**
 * 宿主元素（上游 `PsiLanguageInjectionHost` / `HintedReferenceHost` / `ContributedReferenceHost`）。
 * 本仓能给它「带引用的宿主」的只有注释与字符串字面量，落到这里是**注释的偏移区间**。
 */
export interface ContributedReferencesHost {
  path: string
  /** 整份文件文本（`from`/`to` 都按它算）。 */
  text: string
  from: number
  to: number
  language: string
}

/** 一条贡献引用注解器（`ContributedReferencesAnnotator` 的方法面，方法名与上游逐字相同）。 */
export interface ContributedReferencesAnnotatorContribution {
  id: string
  /** 上游 `annotate(element, references, holder)`。 */
  annotate: (
    element: ContributedReferencesHost,
    references: readonly ContributedReference[],
    holder: ContributedReferencesHolder,
  ) => void
}

/** `ContributedReferencesAnnotators.INSTANCE.getExtensionList()` 的等价物。 */
export function contributedReferencesAnnotators(
  scope: string = APPLICATION_SCOPE,
): ContributedReferencesAnnotatorContribution[] {
  return EXTENSIONS.extensionsOf<ContributedReferencesAnnotatorContribution>(CONTRIBUTED_REFERENCES_ANNOTATOR_EP, scope)
}

/**
 * `HyperlinkAnnotator.annotateContributedReferences` 的等价物（`:76-86`）：逐个贡献者问一遍，
 * 收下它们往 holder 里加的注解。坏贡献者只跳过它自己（上游会往上抛，差异在此）。
 * 收下的注解做两道收口：区间必须非空、必须落在**宿主区间**内 —— 贡献者的契约是「给这个元素上
 * 的引用补注解」，越界的那条会画到别处（本仓的宿主是注释，画出去就是画到代码上）。
 */
export function contributedReferenceAnnotations(
  element: ContributedReferencesHost,
  references: readonly ContributedReference[],
  scope: string = APPLICATION_SCOPE,
): ContributedReferenceAnnotation[] {
  const out: ContributedReferenceAnnotation[] = []
  const holder: ContributedReferencesHolder = {
    add: annotation => {
      if (!annotation || !(annotation.to > annotation.from)) return
      if (annotation.from < element.from || annotation.to > element.to) return
      out.push({ ...annotation, kind: 'hyperlink' })
    },
  }
  for (const annotator of contributedReferencesAnnotators(scope)) {
    try {
      annotator.annotate(element, references, holder)
    } catch {
      // 坏贡献者只跳自己，别人的注解照收。
    }
  }
  return out
}

/** 注册一条贡献引用注解器（内建那支 = 注释里的文件路径链接，见 `src/commentFileLinks.ts`）。 */
export function registerContributedReferencesAnnotator(
  contribution: ContributedReferencesAnnotatorContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(CONTRIBUTED_REFERENCES_ANNOTATOR_EP, contribution.id, contribution,
    { source: 'bundled', ...options })
}
