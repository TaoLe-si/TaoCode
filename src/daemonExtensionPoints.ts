// **daemon 域的扩展点宿主接线** —— 把「检查/注解/快速修复/问题提供者」这几族上游本来就是
// EP 的接口，按 `src/extensionPoints.ts` 的 `EXTENSIONS` 宿主登记出来，并给出与上游**同名的方法面**。
//
// 上游依据（qualifiedName 逐字取自各 plugin.xml 的 `<extensionPoint>` 声明）：
//   · `com.intellij.highlightVisitor` —— `platform/analysis-impl/resources/intellij.platform.analysis.impl.xml:40`
//     （`interface="com.intellij.codeInsight.daemon.impl.HighlightVisitor"` dynamic="true"）；
//     `HighlightVisitor.java` 的方法面：`suitableForFile(PsiFile)` / `visit(PsiElement)` /
//     `analyze(PsiFile, boolean, Runnable)` / `needAdditionalPass()`。
//   · `com.intellij.localInspection` —— `platform/analysis-api/resources/META-INF/Analysis.analyzer.xml:17`
//     （`beanClass="com.intellij.codeInspection.LocalInspectionEP"` dynamic="true"）；一条贡献就是
//     `<localInspection shortName="…" displayName="…" groupName="…" enabledByDefault="…" language="…"/>`。
//   · `com.intellij.inspectionToolProvider` —— 同文件 `:25`
//     （`interface="com.intellij.codeInspection.InspectionToolProvider"`）；方法面
//     `getInspectionClasses()`（`InspectionToolProvider.java:18`）。
//   · `com.intellij.intentionAction` —— `platform/analysis-api/resources/META-INF/Analysis.analyzer.xml:7`
//     （`beanClass="com.intellij.codeInsight.intention.IntentionActionBean"`）；方法面是
//     `IntentionAction` 的 `getText()`/`getFamilyName()`/`isAvailable()`/`invoke()`/`startInWriteAction()`。
//   · `com.intellij.errorQuickFixProvider` —— `platform/analysis-impl/resources/intellij.platform.analysis.impl.xml:41`
//     （`interface="com.intellij.codeInsight.daemon.impl.analysis.ErrorQuickFixProvider"`）；方法面
//     `registerErrorQuickFix(HighlightInfo, QuickFixRegistrar)`。
//   · `com.intellij.problemHighlightFilter` —— `platform/analysis-api/resources/intellij.platform.analysis.xml:44`
//     （`interface="com.intellij.codeInsight.daemon.ProblemHighlightFilter"`）；方法面
//     `shouldHighlightFile(PsiFile)` / `shouldProcessFileInBatch(PsiFile)`。
//   · `ProblemsProvider` —— `platform/problemsView/shared/src/com/intellij/analysis/problemsView/ProblemsProvider.kt:7`
//     （`interface ProblemsProvider : Disposable`，成员 `project` + `dispose()`）。**如实差异**：上游
//     `ProblemsProvider` 不是 EP，它在 problems-view 后端按服务/流注册（`ProblemsViewBridge`）；
//     本仓没有那套后端服务，于是把它登记成同名 EP `com.intellij.problemsProvider`，
//     贡献者形状照上游接口（`id` / `project` / `dispose()` / `getProblems()`），消费方按 id 取。
//     这是本仓口径下的等价物，**不是**上游的 XML EP。
//
// 本仓此前：这七支各有私有实现（`src/annotatorRegistry.ts` 已接走注解器那一条 EP；
// `src/problems.ts` 的聚合门控是写死的几档、`src/inspectionProfile.ts` 的工具表只收内建项、
// `src/localIntentions.ts` 的抑制动作只在本模块内合成、`src/junitInspections.ts` 的本地规则是
// 硬编码调用）。第三方（原版 IDEA 插件）按同名 id 挂进来时，**没有任何入口**。本文件补上那一层：
// 声明 EP + 提供与上游同名的方法面 + 暴露 consume 函数；内建的几支在各自消费侧作为 bundled
// 贡献登记（见各 `registerBundled*` 的调用点），于是 EP 里看得见的就是真实在跑的那几条。
//
// 纯数据层：只 import `src/extensionPoints.ts`（不 import vue/DOM/bridge），便于 `node --test` 直测。
//
// 判据：`tests/daemon-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** 前八条 EP 的 id（逐字取自上游 qualifiedName，见文件头）；第三批五条在文件尾。 */
export const HIGHLIGHT_VISITOR_EP = 'com.intellij.highlightVisitor'
export const LOCAL_INSPECTION_EP = 'com.intellij.localInspection'
export const INSPECTION_TOOL_PROVIDER_EP = 'com.intellij.inspectionToolProvider'
export const INTENTION_ACTION_EP = 'com.intellij.intentionAction'
export const ERROR_QUICK_FIX_PROVIDER_EP = 'com.intellij.errorQuickFixProvider'
export const PROBLEM_HIGHLIGHT_FILTER_EP = 'com.intellij.problemHighlightFilter'
export const PROBLEMS_PROVIDER_EP = 'com.intellij.problemsProvider'
/**
 * 检查项合并器（`InspectionElementsMerger`，上游
 * `platform/analysis-api/resources/META-INF/Analysis.analyzer.xml:27`
 * `interface="com.intellij.codeInspection.ex.InspectionElementsMerger"` dynamic="true"）。
 * **如实差异**：协调单里写的 `com.intellij.inspectionElementsProvider` 在上游**不是 EP**（零命中），
 * 真名是这条 `inspectionElementsMerger`（`InspectionElementsMerger.java:32` 的 `EP_NAME`）。它把
 * 「几个旧检查项的设置并进一个新检查项」，让老的 `@SuppressWarnings` 继续生效
 * （`InspectionElementsMerger.java:20-27` 的类注释）；方法面 `getMergedToolName()` /
 * `getSourceToolNames()` / `getSuppressIds()`（`:52-75`）与静态查询 `getMergedToolNames(id)`（`:83-89`）。
 */
export const INSPECTION_ELEMENTS_MERGER_EP = 'com.intellij.inspectionElementsMerger'

/** 一条高亮访问器（`HighlightVisitor` 的可移植子集，方法名与上游逐字相同）。 */
export interface HighlightVisitorInput {
  path: string
  text: string
  /** 脏行范围（本仓没有 PSI 的 `PsiFile`，按文本 + 行区间给，与 `src/annotatorRegistry.ts` 同口径）。 */
  dirtyLines?: readonly { start: number; end: number }[] | null
  /** 批处理（`GeneralHighlightingPass` 的 batchMode）—— 交互式的东西在批处理里不产出。 */
  batchMode: boolean
}

export interface HighlightVisitor {
  id: string
  /** `HighlightVisitor.suitableForFile(PsiFile)` —— 这个访问器管不管这份文件。 */
  suitableForFile: (path: string) => boolean
  /** `HighlightVisitor.visit(PsiElement)`（本仓没有 PSI，给整份文本 + 脏行）。 */
  visit: (input: HighlightVisitorInput) => void
  /** `HighlightVisitor.analyze(PsiFile, updateWholeFile, cancelRunnable)`：返回是否真的改了东西。 */
  analyze: (input: HighlightVisitorInput) => boolean
  /** `HighlightVisitor.needAdditionalPass()`。 */
  needAdditionalPass: () => boolean
  /** 语言限定（缺省 = 任意语言，照 `LanguageExtension` 的 `any` 档）。 */
  languages?: readonly string[]
}

/**
 * 一条本地检查的注册项（`LocalInspectionEP` 的字段面：`platform/analysis-api/.../LocalInspectionEP.java`
 * 的 `shortName`/`displayName`/`groupName`/`enabledByDefault`/`language`/`groupPath`）。
 * 本仓不做 PSI 访问器，一条贡献就是一张**规则身份表**（短名 + 显示名 + 组 + 默认启用 + 语言）。
 */
export interface LocalInspectionContribution {
  id: string
  /** `LocalInspectionTool.getShortName()`（也是本仓检查项身份键的 `source`）。 */
  getShortName: () => string
  /** `getDisplayName()`。 */
  getDisplayName: () => string
  /** `getGroupDisplayName()`。 */
  getGroupDisplayName: () => string
  /** `isEnabledByDefault()`（`LocalInspectionEP.enabledByDefault` 缺省 true）。 */
  isEnabledByDefault: () => boolean
  /** `getLanguage()`（本仓按文件扩展名归语言，字符串；空 = 任意语言）。 */
  getLanguage?: () => string
  /** `getGroupPath()`（组路径，用于设置树的层级）。 */
  getGroupPath?: () => readonly string[]
}

/** 一条检查工具提供者（`InspectionToolProvider.getInspectionClasses()` 返回类数组；本仓返回身份表）。 */
export interface InspectionToolProviderContribution {
  id: string
  /** `getInspectionClasses()` —— 本仓给的是这些检查工具的注册项（不是 JVM `Class`）。 */
  getInspectionClasses: () => readonly LocalInspectionContribution[]
}

/** 一条意图/快速修复（`IntentionAction` 的方法面，名字与上游逐字相同）。 */
export interface IntentionActionContribution {
  id: string
  /** `IntentionAction.getText()` —— 弹层里那一行文字。 */
  getText: () => string
  /** `getFamilyName()` —— 设置页按它分组、开关也按它认。 */
  getFamilyName: () => string
  /** `isAvailable(project, editor, file)`（本仓给 `{ path, line, text }` 形状）。 */
  isAvailable: (input: { path: string; line: number; text: string }) => boolean
  /** `invoke(project, editor, file)`（本仓返回要应用的编辑载荷或 null）。 */
  invoke: (input: { path: string; line: number; text: string }) => IntentionInvocation | null
  /** `startInWriteAction()`。 */
  startInWriteAction: () => boolean
}

/** `invoke` 的返回：一条可应用到文件的编辑（与 `LspCodeAction.edits` 同形状的最小面）。 */
export interface IntentionInvocation {
  path: string
  newText: string
  /** 替换的 0 基行区间（`[startLine, endLine]`，含端点；空 = 整文件，照 `src/applyTextEdits.ts` 的口径）。 */
  startLine?: number
  endLine?: number
}

/**
 * 一条错误快速修复提供者（`ErrorQuickFixProvider.registerErrorQuickFix(HighlightInfo, QuickFixRegistrar)`）。
 * 本仓没有 `HighlightInfo`，给诊断的形状；`registrar` 收下这条提供者产出的修复。
 */
export interface ErrorQuickFixProviderContribution {
  id: string
  registerErrorQuickFix: (
    diagnostic: { path: string; line: number; message: string; code?: string; tags?: readonly number[] },
    registrar: (fix: IntentionActionContribution) => void,
  ) => void
}

/**
 * 一条问题高亮过滤器（`ProblemHighlightFilter` 的方法面。
 * `shouldHighlightFile` = 这份文件要不要出诊断；`shouldProcessFileInBatch` = 整工程批处理时算不算它）。
 */
export interface ProblemHighlightFilterContribution {
  id: string
  shouldHighlightFile: (path: string) => boolean
  shouldProcessFileInBatch: (path: string) => boolean
}

/**
 * 一条问题提供者（`ProblemsProvider` 的成员面：`project` + `dispose()`）。
 * `getProblems()` 是本仓给的产出面（上游经 problems-view 后端流式推，本仓按拉取给一排问题）。
 */
export interface ProblemsProviderContribution {
  id: string
  /** 上游 `ProblemsProvider.project`（本仓按工作区根字符串）。 */
  project: string
  /** 上游 `ProblemsProvider.dispose()`（缺省空实现，照上游 `override fun dispose() {}`）。 */
  dispose?: () => void
  /** 本仓产出面：这个提供者当前的问题（空 = 没有）。 */
  getProblems?: () => readonly ProblemLike[]
}

/** 提供者产出的一条问题（与 `src/problems.ts` 的 `ProblemRow` 兼容的最小字段集）。 */
export interface ProblemLike {
  path: string
  line: number
  character?: number
  severity: number
  message: string
  source?: string
}

/**
 * 一条检查项合并器（`InspectionElementsMerger` 的方法面，名字与上游逐字相同）。
 * 上游是抽象类，这里收成一张身份表：新短名 + 被并进来的旧短名（+ 抑制 id）。
 */
export interface InspectionElementsMergerContribution {
  id: string
  /** 上游 `getMergedToolName()` —— 合并后的检查项短名。 */
  getMergedToolName: () => string
  /** 上游 `getSourceToolNames()` —— 被并进来的旧检查项短名。 */
  getSourceToolNames: () => readonly string[]
  /** 上游 `getSuppressIds()` —— 抑制时额外认的 id（空 = 用 `getSourceToolNames()`）。 */
  getSuppressIds?: () => readonly string[]
}

/** `InspectionElementsMerger.EP_NAME.getExtensionList()` 的等价物。 */
export function inspectionElementsMergers(scope: string = APPLICATION_SCOPE): InspectionElementsMergerContribution[] {
  return EXTENSIONS.extensionsOf<InspectionElementsMergerContribution>(INSPECTION_ELEMENTS_MERGER_EP, scope)
}

/**
 * 上游静态 `InspectionElementsMerger.getMergedToolNames(id)`（`:83-89`）：id 命中某个合并器的
 * `getSourceToolNames()` 或 `getSuppressIds()` 时，返回它并进的那些新短名。本仓把它当
 * 「诊断身份键 → 还应一起命中哪些键」的扩展（消费方：`src/inspectionIdentity.ts` 的候选键展开）。
 */
export function mergedToolNamesFor(id: string, scope: string = APPLICATION_SCOPE): string[] {
  if (!id) return []
  const out: string[] = []
  for (const merger of inspectionElementsMergers(scope)) {
    try {
      const sources = merger.getSourceToolNames()
      const suppressIds = merger.getSuppressIds ? merger.getSuppressIds() : []
      const ids = suppressIds.length ? suppressIds : sources
      if (sources.includes(id) || ids.includes(id)) {
        const merged = merger.getMergedToolName()
        if (merged && !out.includes(merged)) out.push(merged)
      }
    } catch {
      // 坏合并器跳过。
    }
  }
  return out
}

/**
 * 十六条 EP 的声明（幂等：重复调用只覆盖同名声明；前八条见文件头，第三批五条见文件中部
 * 「第三批」，第四批三条见文件尾「第四批」）。
 * **调用点在文件尾**：第三/第四批的 EP id 常量在本文件下半部才声明，模块加载期在这里直接调
 * 会撞 TDZ（`ReferenceError: Cannot access 'CHANGE_LOCALITY_DETECTOR_EP' before initialization`，
 * 2026-10-07 pvdm 实测），所以调用必须排在本模块全部 `const` 初始化之后。
 */
export function declareDaemonExtensionPoints(): void {
  for (const [id, name] of [
    [HIGHLIGHT_VISITOR_EP, '高亮访问器'],
    [LOCAL_INSPECTION_EP, '本地检查'],
    [INSPECTION_TOOL_PROVIDER_EP, '检查工具提供者'],
    [INTENTION_ACTION_EP, '意图与快速修复'],
    [ERROR_QUICK_FIX_PROVIDER_EP, '错误快速修复提供者'],
    [PROBLEM_HIGHLIGHT_FILTER_EP, '问题高亮过滤器'],
    [PROBLEMS_PROVIDER_EP, '问题提供者'],
    [INSPECTION_ELEMENTS_MERGER_EP, '检查项合并器'],
    [CHANGE_LOCALITY_DETECTOR_EP, '改动局部性检查器'],
    [PROBLEMS_VIEW_PANEL_PROVIDER_EP, '问题视图页签提供者'],
    [PROBLEMS_VIEW_HIGHLIGHTING_PROBLEM_FACTORY_EP, '问题视图高亮问题工厂'],
    [FRONTEND_PROBLEMS_VIEW_CONTENT_PROVIDER_EP, '问题视图前端内容提供者'],
    [PROBLEMS_VIEW_BRIDGE_EP, '问题视图桥'],
    [EXTERNAL_ANNOTATORS_FILTER_EP, '外部注解器过滤器'],
    [IMPLICIT_USAGE_PROVIDER_EP, '隐式使用提供者'],
    [CONTRIBUTED_REFERENCES_ANNOTATOR_EP, '贡献引用注解器'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

/** 按 id 注册一条贡献（同 id 覆盖，与 `ExtensionPointHost.registerExtension` 同口径）。 */
export function registerDaemonExtension<T>(
  extensionPoint: string,
  id: string,
  value: T,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(extensionPoint, id, value, options)
}

/** 注销一条贡献（返回是否真的删掉了）。 */
export function unregisterDaemonExtension(extensionPoint: string, id: string): boolean {
  return EXTENSIONS.unregisterExtension(extensionPoint, id)
}

// ── 消费面：每支一个 `extensionsOf` 包装（名字与上游取集合的方法同义） ──────────────────────

/** `HighlightVisitor.EP_NAME.getExtensions()` 的等价物。 */
export function highlightVisitors(scope: string = APPLICATION_SCOPE): HighlightVisitor[] {
  return EXTENSIONS.extensionsOf<HighlightVisitor>(HIGHLIGHT_VISITOR_EP, scope)
}

/** 本仓「本地检查」注册表（`LocalInspectionEP` 那一批）。 */
export function localInspectionContributions(scope: string = APPLICATION_SCOPE): LocalInspectionContribution[] {
  return EXTENSIONS.extensionsOf<LocalInspectionContribution>(LOCAL_INSPECTION_EP, scope)
}

/** 全部检查工具提供者的检查项并集（`InspectionToolProvider.getInspectionClasses()` 的合并版）。 */
export function inspectionToolProviderClasses(scope: string = APPLICATION_SCOPE): LocalInspectionContribution[] {
  const out: LocalInspectionContribution[] = []
  for (const provider of EXTENSIONS.extensionsOf<InspectionToolProviderContribution>(INSPECTION_TOOL_PROVIDER_EP, scope))
    out.push(...provider.getInspectionClasses())
  return out
}

/** `IntentionManager.getActiveIntentions` 的等价物（这里只按 EP 取，启用/停用另由 `src/intentionSettings.ts` 门控）。 */
export function intentionActionContributions(scope: string = APPLICATION_SCOPE): IntentionActionContribution[] {
  return EXTENSIONS.extensionsOf<IntentionActionContribution>(INTENTION_ACTION_EP, scope)
}

/** `ErrorQuickFixProvider` 那一批。 */
export function errorQuickFixProviders(scope: string = APPLICATION_SCOPE): ErrorQuickFixProviderContribution[] {
  return EXTENSIONS.extensionsOf<ErrorQuickFixProviderContribution>(ERROR_QUICK_FIX_PROVIDER_EP, scope)
}

/** `ProblemHighlightFilter` 那一批。 */
export function problemHighlightFilters(scope: string = APPLICATION_SCOPE): ProblemHighlightFilterContribution[] {
  return EXTENSIONS.extensionsOf<ProblemHighlightFilterContribution>(PROBLEM_HIGHLIGHT_FILTER_EP, scope)
}

/** `ProblemsProvider` 那一批。 */
export function problemsProviders(scope: string = APPLICATION_SCOPE): ProblemsProviderContribution[] {
  return EXTENSIONS.extensionsOf<ProblemsProviderContribution>(PROBLEMS_PROVIDER_EP, scope)
}

/**
 * 一份文件要不要出诊断：全部注册的 `ProblemHighlightFilter` 都同意才出（上游 `ProblemHighlightFilter`
 * 只要有一条返回 false 就不高亮该文件；`PlatformProblemHighlightFilter` 的默认实现返回 true）。
 * 没有任何过滤器 = 照旧出（不因为有 EP 反而把诊断全关掉）。
 */
export function shouldHighlightFileByFilters(path: string, scope: string = APPLICATION_SCOPE): boolean {
  for (const filter of problemHighlightFilters(scope)) {
    try {
      if (!filter.shouldHighlightFile(path)) return false
    } catch {
      // 第三方过滤器抛错不能拖垮整份文件的高亮：这一条当作「同意」跳过（记在调用方日志侧）。
    }
  }
  return true
}

/** 整工程批处理时一份文件算不算（同上的「都同意才算」口径，方法名照 `shouldProcessFileInBatch`）。 */
export function shouldProcessFileInBatch(path: string, scope: string = APPLICATION_SCOPE): boolean {
  for (const filter of problemHighlightFilters(scope)) {
    try {
      if (!filter.shouldProcessFileInBatch(path)) return false
    } catch {
      // 同上。
    }
  }
  return true
}

/** 汇总全部 `ProblemsProvider` 产出的问题（`dispose()` 过的提供者不再产出，由调用方在移除时调 dispose）。 */
export function problemsFromProviders(scope: string = APPLICATION_SCOPE): ProblemLike[] {
  const out: ProblemLike[] = []
  for (const provider of problemsProviders(scope)) {
    if (typeof provider.getProblems !== 'function') continue
    try {
      out.push(...provider.getProblems())
    } catch {
      // 一个提供者坏了不该吃掉别人的问题。
    }
  }
  return out
}

// ── bundled：把本仓在跑的几支作为贡献登记进来（消费侧调用，重复调用只覆盖同 id） ──────────────

/** 注册一条检查工具提供者贡献（内建的检查项表在 `src/inspectionProfile.ts` / `src/junitInspections.ts`）。 */
export function registerInspectionToolProvider(
  provider: InspectionToolProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(INSPECTION_TOOL_PROVIDER_EP, provider.id, provider, { source: 'bundled', ...options })
}

/** 注册一条本地检查贡献。 */
export function registerLocalInspection(
  contribution: LocalInspectionContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(LOCAL_INSPECTION_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条意图贡献（内建的抑制动作在 `src/localIntentions.ts`）。 */
export function registerIntentionAction(
  contribution: IntentionActionContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(INTENTION_ACTION_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条问题高亮过滤器（内建的两档在 `src/analysisIgnore.ts` / `src/highlightSettingsPerFile.ts`）。 */
export function registerProblemHighlightFilter(
  contribution: ProblemHighlightFilterContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(PROBLEM_HIGHLIGHT_FILTER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条检查项合并器（内建的合并表暂无；第三方把旧检查项的设置并进新项时挂这一条）。 */
export function registerInspectionElementsMerger(
  contribution: InspectionElementsMergerContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(INSPECTION_ELEMENTS_MERGER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

// ── 第三批：daemon 域余下的五条上游 EP（2026-10-07 pvdm） ────────────────────────────────────
//
// 上游依据（qualifiedName 逐字取自各 plugin.xml 的 `<extensionPoint>` 声明）：
//   · `com.intellij.daemon.changeLocalityDetector` —— `platform/analysis-api/resources/intellij.platform.analysis.xml:24`
//     （`interface="com.intellij.codeInsight.daemon.ChangeLocalityDetector"` dynamic="true"）；方法面
//     `getChangeHighlightingDirtyScopeFor(changedElement)`（`ChangeLocalityDetector.java:33`，返回
//     「要重算的那个祖先」或 null）。消费方 `PsiChangeHandler.java:59` 的 `EP_NAME`。
//     出厂两支：`DefaultChangeLocalityDetector`（`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1030`）
//     与 `MultiLineTodoLocalityDetector`（`platform/todo/resources/intellij.platform.todo.xml:53`）。
//   · `com.intellij.problemsViewPanelProvider` —— `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:48`
//     （`interface="com.intellij.analysis.problemsView.toolWindow.ProblemsViewPanelProvider"` area="IDEA_PROJECT"
//     dynamic="true"）；方法面 `create()`（`ProblemsViewPanelProvider.kt:16`）。出厂两支：高亮问题面板与
//     工程错误面板（同文件 `:57,60`）。
//   · `com.intellij.problemsViewHighlightingProblemFactory` —— 同文件 `:52`
//     （`interface="…HighlightingProblemFactory"` dynamic="true"）；方法面
//     `createHighlightingProblem(provider, file, highlighter)`（`HighlightingProblemFactory.kt:21`），
//     出厂 `DefaultHighlightingProblemFactory`（同文件 `:26`，直接 `HighlightingProblem(...)`）。
//   · `com.intellij.frontendProblemsViewContentProvider` ——
//     `platform/problemsView/frontend/resources/intellij.platform.problemView.frontend.xml:32`
//     （`interface="com.intellij.platform.problemsView.frontend.FrontendProblemsViewContentProvider"` dynamic="true"）；
//     方法面 `isAvailable(project)` / `initTabContent(project, content)` / `matchesTabName(tabName)`
//     （`FrontendProblemsViewContentProvider.kt:20-24`）。
//   · `com.intellij.problemsViewBridge` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:119`
//     （`interface="com.intellij.codeInsight.daemon.impl.ProblemsViewBridge"` dynamic="true"）；方法面
//     `toggleCurrentFileProblems(project, virtualFile, document)` 与 `selectHighlighterIfVisible(project, highlighter)`
//     （`ProblemsViewBridge.kt:16-19`）；消费口径是**取第一支**（`:33,38` 的 `extensionList.firstOrNull()`）。
//
// 与上游的如实差异：本仓没有 PSI/`VirtualFile`/`RangeHighlighter`/`Content`，所以
// `getChangeHighlightingDirtyScopeFor` 的入参收成「改到的行区间」、返回收成收窄后的行区间；
// `create()` 返回的是**页签描述**（id + 标题 + 取行函数），不是 Swing 组件；
// `createHighlightingProblem` 收/回本仓的 `ProblemLike`；`initTabContent` 收成「认领这个页签」的布尔。

/** `ChangeLocalityDetector.EP_NAME`（`PsiChangeHandler.java:59`）。 */
export const CHANGE_LOCALITY_DETECTOR_EP = 'com.intellij.daemon.changeLocalityDetector'
/** `ProblemsViewPanelProvider.EP`（`ProblemsViewPanelProvider.kt:11`）。 */
export const PROBLEMS_VIEW_PANEL_PROVIDER_EP = 'com.intellij.problemsViewPanelProvider'
/** `HighlightingProblemFactory.EP_NAME`（`HighlightingProblemFactory.kt:16`）。 */
export const PROBLEMS_VIEW_HIGHLIGHTING_PROBLEM_FACTORY_EP = 'com.intellij.problemsViewHighlightingProblemFactory'
/** `FrontendProblemsViewContentProvider.EP_NAME`（`FrontendProblemsViewContentProvider.kt:28`）。 */
export const FRONTEND_PROBLEMS_VIEW_CONTENT_PROVIDER_EP = 'com.intellij.frontendProblemsViewContentProvider'
/** `ProblemsViewBridge.EP_NAME`（`ProblemsViewBridge.kt:22`）。 */
export const PROBLEMS_VIEW_BRIDGE_EP = 'com.intellij.problemsViewBridge'

/** 一段行区间（0 基、闭区间；与 `src/highlightPasses.ts` 的 `DirtyLineRange` 同形状）。 */
export interface ChangeLocalityRange {
  start: number
  end: number
}

/**
 * 一次改动（上游 `getChangeHighlightingDirtyScopeFor(PsiElement changedElement)` 的入参）。
 * 本仓没有 PSI：`changed` 是**改到的行区间**，`lines` 是该文件按 `\r?\n` 切好的行（词面判定用，
 * 例如「这一带是不是空白/注释」），`language` 是语言 id（`src/annotatorRegistry.ts` 同口径）。
 */
export interface ChangeLocalityInput {
  path: string
  language: string
  text: string
  lines: readonly string[]
  /** 这一拍被改到的行区间（0 基闭区间）。 */
  changed: ChangeLocalityRange
}

/** 一条局部性检查器（`getChangeHighlightingDirtyScopeFor` 的同名方法面）。 */
export interface ChangeLocalityDetectorContribution {
  id: string
  /**
   * 上游 `getChangeHighlightingDirtyScopeFor(changedElement)`：返回要重算的那一段（本仓是行区间），
   * null = 拿不准（上游注释明确「or null if unsure」）⇒ 调用方保留原范围。
   */
  getChangeHighlightingDirtyScopeFor: (input: ChangeLocalityInput) => ChangeLocalityRange | null
}

/** `ChangeLocalityDetector.EP_NAME.getExtensionList()` 的等价物。 */
export function changeLocalityDetectors(scope: string = APPLICATION_SCOPE): ChangeLocalityDetectorContribution[] {
  return EXTENSIONS.extensionsOf<ChangeLocalityDetectorContribution>(CHANGE_LOCALITY_DETECTOR_EP, scope)
}

/**
 * 取**第一支**给出范围的检查器的结果（上游 `PsiChangeHandler` 逐元素问、命中即用）；
 * 全部给 null（或抛错）时原样返回 `changed`。坏检查器只跳过它自己。
 */
export function narrowedChangeLocality(
  input: ChangeLocalityInput, scope: string = APPLICATION_SCOPE,
): ChangeLocalityRange {
  for (const detector of changeLocalityDetectors(scope)) {
    try {
      const range = detector.getChangeHighlightingDirtyScopeFor(input)
      if (range && range.end >= range.start && range.start >= 0) return { start: range.start, end: range.end }
    } catch {
      // 坏检查器拿不准 ⇒ 问下一支。
    }
  }
  return { ...input.changed }
}

/**
 * 把一批脏行范围逐个过 `ChangeLocalityDetector`（本仓接进 `src/highlightPasses.ts` 的
 * `runGeneralHighlightingPass` / `runMainHighlightPasses`）。没有检查器时**原样返回入参的副本**
 * ⇒ 既有行为零改动；有检查器时按它的裁决收窄/放宽那一段。
 */
export function narrowChangeLocalityRanges(
  path: string, language: string, text: string, ranges: readonly ChangeLocalityRange[],
  scope: string = APPLICATION_SCOPE,
): ChangeLocalityRange[] {
  if (!ranges.length) return []
  const detectors = changeLocalityDetectors(scope)
  if (!detectors.length) return ranges.map(range => ({ ...range }))
  const lines = text.split(/\r?\n/)
  return ranges.map(range => narrowedChangeLocality({ path, language, text, lines, changed: range }, scope))
}

/** 注册一条局部性检查器（内建两支的等价物在 `src/changeLocality.ts`）。 */
export function registerChangeLocalityDetector(
  contribution: ChangeLocalityDetectorContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(CHANGE_LOCALITY_DETECTOR_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 问题视图的一个页签（上游 `ProblemsViewTab` 的可移植面：身份 + 标题 + 取行）。 */
export interface ProblemsViewTabView {
  /** 页签 id（上游按 tab 名认，见 `FrontendProblemsViewContentProvider.matchesTabName`）。 */
  id: string
  /** 页签标题（上游 `TabInfo.getTabLabel` 的等价物）。 */
  title: string
  /** 这个页签的问题从哪来（缺省 = 空页签，上游 `create()` 返回 null 的那种不建页签）。 */
  rows?: () => readonly ProblemLike[]
}

/** 一条页签提供者（`ProblemsViewPanelProvider.create()` 的同名方法面）。 */
export interface ProblemsViewPanelProviderContribution {
  id: string
  /** 上游 `create()`：建不出来给 null（那一档页签不出现）。 */
  create: () => ProblemsViewTabView | null
}

/** `ProblemsViewPanelProvider.EP.getExtensionList()` 的等价物。 */
export function problemsViewPanelProviders(scope: string = APPLICATION_SCOPE): ProblemsViewPanelProviderContribution[] {
  return EXTENSIONS.extensionsOf<ProblemsViewPanelProviderContribution>(PROBLEMS_VIEW_PANEL_PROVIDER_EP, scope)
}

/**
 * 全部提供者建出来的页签（上游 `ProblemsViewPanel.getTabs()` 逐 provider `create()`，null 的不收；
 * 同 id 去重、保留第一支）。坏 provider 只跳过它自己。
 */
export function problemsViewTabs(scope: string = APPLICATION_SCOPE): ProblemsViewTabView[] {
  const out: ProblemsViewTabView[] = []
  const seen = new Set<string>()
  for (const provider of problemsViewPanelProviders(scope)) {
    try {
      const tab = provider.create()
      if (!tab || !tab.id || seen.has(tab.id)) continue
      seen.add(tab.id)
      out.push(tab)
    } catch {
      // 坏 provider 不出页签，不吞掉别人的。
    }
  }
  return out
}

/** 注册一条页签提供者（内建两支：高亮问题 / 工程错误，见 `src/problemsViewTabs.ts`）。 */
export function registerProblemsViewPanelProvider(
  contribution: ProblemsViewPanelProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(PROBLEMS_VIEW_PANEL_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/**
 * `createHighlightingProblem(provider, file, highlighter)` 的入参（本仓的形状）：
 * `provider` 是产这条问题的那一档（本仓是 `'lsp'` / `'local'` 或提供者 id），
 * `file`/`highlighter` 收成路径 + 位置 + 严重度（上游的 `VirtualFile`/`RangeHighlighter`）。
 */
export interface HighlightingProblemInput {
  provider: string
  path: string
  line: number
  character?: number
  severity: number
  message: string
  source?: string
  code?: string
  tags?: readonly number[]
}

/** 一条高亮问题工厂（`createHighlightingProblem` 的同名方法面）。 */
export interface ProblemsViewHighlightingProblemFactoryContribution {
  id: string
  /** 上游 `createHighlightingProblem(provider, file, highlighter)`：一条 `HighlightingProblem`。 */
  createHighlightingProblem: (input: HighlightingProblemInput) => ProblemLike
}

/** `HighlightingProblemFactory.EP_NAME.getExtensionList()` 的等价物。 */
export function problemsViewHighlightingProblemFactories(
  scope: string = APPLICATION_SCOPE,
): ProblemsViewHighlightingProblemFactoryContribution[] {
  return EXTENSIONS.extensionsOf<ProblemsViewHighlightingProblemFactoryContribution>(
    PROBLEMS_VIEW_HIGHLIGHTING_PROBLEM_FACTORY_EP, scope)
}

/**
 * 造一条问题节点：**按 id 取第一支工厂**（上游 `HighlightingProblemFactory.EP_NAME` 只有出厂那一支
 * `default`，取的就是 `getExtensionList()` 的第一支；没有工厂时本仓原样把输入折成 `ProblemLike` ——
 * `DefaultHighlightingProblemFactory` 的行为就是这个恒等映射）。坏工厂回落到恒等，不把这条问题丢掉。
 */
export function highlightingProblemOf(
  input: HighlightingProblemInput, scope: string = APPLICATION_SCOPE,
): ProblemLike {
  const fallback = (): ProblemLike => ({
    path: input.path, line: input.line, ...(input.character === undefined ? {} : { character: input.character }),
    severity: input.severity, message: input.message,
    ...(input.source === undefined ? {} : { source: input.source }),
  })
  const factory = problemsViewHighlightingProblemFactories(scope)[0]
  if (!factory) return fallback()
  try {
    const problem = factory.createHighlightingProblem(input)
    return problem && typeof problem.path === 'string' ? problem : fallback()
  } catch {
    return fallback()
  }
}

/** 注册一条高亮问题工厂（内建 `default` 恒等那支由调用方登记）。 */
export function registerProblemsViewHighlightingProblemFactory(
  contribution: ProblemsViewHighlightingProblemFactoryContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(PROBLEMS_VIEW_HIGHLIGHTING_PROBLEM_FACTORY_EP, contribution.id, contribution,
    { source: 'bundled', ...options })
}

/**
 * 一条「前端页签内容」提供者（`isAvailable` / `initTabContent` / `matchesTabName` 的同名方法面）。
 * 上游是「split 模式下用前端模块的组件替换对应页签的内容」；本仓没有组件层，
 * `initTabContent` 收成「认领这个页签」的布尔（认领了由调用方决定怎么渲染）。
 */
export interface FrontendProblemsViewContentProviderContribution {
  id: string
  /** 上游 `isAvailable(project)`（本仓给工作区根）。 */
  isAvailable: (root: string) => boolean
  /** 上游 `matchesTabName(tabName)`。 */
  matchesTabName: (tabName: string) => boolean
  /** 上游 `initTabContent(project, content)`：认领成功给 true。 */
  initTabContent: (input: { root: string; tabName: string }) => boolean
}

/** `FrontendProblemsViewContentProvider.EP_NAME.getExtensionList()` 的等价物。 */
export function frontendProblemsViewContentProviders(
  scope: string = APPLICATION_SCOPE,
): FrontendProblemsViewContentProviderContribution[] {
  return EXTENSIONS.extensionsOf<FrontendProblemsViewContentProviderContribution>(
    FRONTEND_PROBLEMS_VIEW_CONTENT_PROVIDER_EP, scope)
}

/**
 * 这个页签由哪个前端提供者接手（上游 `ProblemsViewToolWindowContentReplacer` 逐 provider 问
 * `isAvailable` + `matchesTabName`，取第一支）。没有接手者给 null（本仓自己渲染）。
 */
export function frontendProblemsViewContentOwner(
  root: string, tabName: string, scope: string = APPLICATION_SCOPE,
): FrontendProblemsViewContentProviderContribution | null {
  for (const provider of frontendProblemsViewContentProviders(scope)) {
    try {
      if (provider.isAvailable(root) && provider.matchesTabName(tabName)) return provider
    } catch {
      // 坏 provider 不接手，问下一支。
    }
  }
  return null
}

/** 让接手的前端提供者初始化这个页签（返回是否真的有人接手）。 */
export function initFrontendProblemsViewTab(
  root: string, tabName: string, scope: string = APPLICATION_SCOPE,
): boolean {
  const owner = frontendProblemsViewContentOwner(root, tabName, scope)
  if (!owner) return false
  try {
    return owner.initTabContent({ root, tabName }) === true
  } catch {
    return false
  }
}

/** 注册一条前端页签内容提供者。 */
export function registerFrontendProblemsViewContentProvider(
  contribution: FrontendProblemsViewContentProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(FRONTEND_PROBLEMS_VIEW_CONTENT_PROVIDER_EP, contribution.id, contribution,
    { source: 'bundled', ...options })
}

/**
 * 一条问题视图桥（`toggleCurrentFileProblems` / `selectHighlighterIfVisible` 的同名方法面）。
 * 上游是「工具窗口那一侧的开关与选中」：显示/隐藏当前文件的问题、在可见时选中某条高亮。
 */
export interface ProblemsViewBridgeContribution {
  id: string
  toggleCurrentFileProblems: (input: { root: string; path: string | null; text: string | null }) => void
  selectHighlighterIfVisible: (input: { root: string; path: string; line: number }) => boolean
}

/** `ProblemsViewBridge.EP_NAME.getExtensionList()` 的等价物。 */
export function problemsViewBridges(scope: string = APPLICATION_SCOPE): ProblemsViewBridgeContribution[] {
  return EXTENSIONS.extensionsOf<ProblemsViewBridgeContribution>(PROBLEMS_VIEW_BRIDGE_EP, scope)
}

/**
 * `ProblemsViewBridge.toggleCurrentFileProblemsIfAvailable` 的等价物（`ProblemsViewBridge.kt:32-34`）：
 * **只调第一支**（上游 `extensionList.firstOrNull()`）；返回是否真的有人接手。
 */
export function toggleCurrentFileProblemsIfAvailable(
  input: { root: string; path: string | null; text: string | null }, scope: string = APPLICATION_SCOPE,
): boolean {
  const bridge = problemsViewBridges(scope)[0]
  if (!bridge) return false
  try {
    bridge.toggleCurrentFileProblems(input)
    return true
  } catch {
    return false
  }
}

/** `selectHighlighterIfVisibleIfAvailable` 的等价物（`:37-39`，同样只调第一支）。 */
export function selectHighlighterIfVisibleIfAvailable(
  input: { root: string; path: string; line: number }, scope: string = APPLICATION_SCOPE,
): boolean {
  const bridge = problemsViewBridges(scope)[0]
  if (!bridge) return false
  try {
    return bridge.selectHighlighterIfVisible(input) === true
  } catch {
    return false
  }
}

/** 注册一条问题视图桥（内建那支在 `src/problemsViewTabs.ts`）。 */
export function registerProblemsViewBridge(
  contribution: ProblemsViewBridgeContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(PROBLEMS_VIEW_BRIDGE_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 另两条 bundled 登记（高亮访问器 / 错误快速修复提供者 / 问题提供者）。 */
export function registerHighlightVisitor(
  contribution: HighlightVisitor,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(HIGHLIGHT_VISITOR_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条错误快速修复提供者（内建的 JUnit 修复在 `src/junitQuickFix.ts`）。 */
export function registerErrorQuickFixProvider(
  contribution: ErrorQuickFixProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(ERROR_QUICK_FIX_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条问题提供者（内建的整工程错误在 `src/workspaceDiagnostics.ts`）。 */
export function registerProblemsProvider(
  contribution: ProblemsProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDaemonExtension(PROBLEMS_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

// ── 第四批：分析侧三条 EP 的 id（方法面/贡献面/消费函数在 `src/daemonAnalysisExtensionPoints.ts`）──
//
// 为什么只留 id 在这里：EP 的**声明**必须与其余十三条同处一处（`declareDaemonExtensionPoints()`
// 逐条声明，见上面那个函数），而方法面与消费函数按职责域拆到了新模块 —— 主文件加整批会越过
// 900 行的模块上限（`tests/module-size.test.mjs`）。三条 EP 的上游出处、方法面对位与如实差异
// 全部写在新模块的文件头，不在这里复制一遍。
//
// `com.intellij.daemon.externalAnnotatorsFilter`（`platform/analysis-api/resources/intellij.platform.analysis.xml:23`）——
// 外部注解器过滤器：任一过滤器说 prohibited，那个注解器在这份文件上就不跑
// （`ExternalLanguageAnnotators.java:20-26`）。
// `com.intellij.implicitUsageProvider`（同 XML `:25`）—— 隐式使用提供者：
// 任一 provider 说隐式使用，「未使用声明」就不报（`RefUtil.java:26,36,55`）。
// `com.intellij.contributedReferencesAnnotator`（同 XML `:30-32`）—— 贡献引用注解器：
// 平台画完自己的链接后，按语言取贡献者补注解（`HyperlinkAnnotator.java:76-86`）。

/** `ExternalAnnotatorsFilter.EXTENSION_POINT_NAME`（`ExternalAnnotatorsFilter.java:15`）。 */
export const EXTERNAL_ANNOTATORS_FILTER_EP = 'com.intellij.daemon.externalAnnotatorsFilter'
/** `ImplicitUsageProvider.EP_NAME`（`ImplicitUsageProvider.java:16`）。 */
export const IMPLICIT_USAGE_PROVIDER_EP = 'com.intellij.implicitUsageProvider'
/** `ContributedReferencesAnnotators.EP_NAME`（`ContributedReferencesAnnotators.java:10-11`）。 */
export const CONTRIBUTED_REFERENCES_ANNOTATOR_EP = 'com.intellij.contributedReferencesAnnotator'

// 模块加载即声明这十六条 EP（见 `declareDaemonExtensionPoints` 的注释：必须放在本文件
// 全部 EP id 常量声明之后，否则撞 TDZ）。
declareDaemonExtensionPoints()
