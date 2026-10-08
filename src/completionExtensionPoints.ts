// **lp/completion 域余下两条上游 EP 的宿主接线**（补全排序权重 `com.intellij.weigher` 与
// 补全自信度 `com.intellij.completion.confidence`）。补全贡献者那条（`com.intellij.completion.contributor`）
// 已由 `src/extensionPoints.ts` 声明、`src/completionContributors.ts` 消费，见那里的注释。
//
// 与 `src/daemonExtensionPoints.ts` / `src/editorActionExtensionPoints.ts` 同一形状：
// 「EP 声明 + 注册/注销 + 消费方从注册表取 + bundled 默认贡献者」。
//
// 上游依据（qualifiedName **逐字**取自各 plugin.xml / 各类的 `ExtensionPointName`）：
//   · `com.intellij.weigher` —— `platform/analysis-api/resources/META-INF/Analysis.analyzer.xml:30`
//     （`beanClass="com.intellij.psi.WeigherExtensionPoint"` dynamic="true"）；抽象类
//     `platform/analysis-api/src/com/intellij/psi/Weigher.java:21` 的方法面
//     `weigh(T element, Location location)`（`:35`）；注册键 `key`（`<weigher key="completion">`，
//     见 `platform/analysis-impl/resources/intellij.platform.analysis.impl.xml:128/183` 那一族），
//     消费方 `platform/analysis-api/src/com/intellij/psi/WeighingService.java:14` 的
//     `KeyedExtensionCollector("com.intellij.weigher")` + `getWeighers(key)`。
//     **如实差异**：协调单里写的 `com.intellij.completion.weigher` 在上游**不是 EP**（零命中）——
//     补全相关的那一档是这条 `com.intellij.weigher` 的 `key="completion"`
//     （`WeighingService.java:24` 的 `RELEVANCE_KEY`，`BaseCompletionService.java:213` 遍历它），故按真名落。
//   · `com.intellij.completion.confidence` —— `platform/analysis-api/resources/intellij.platform.analysis.xml:51`
//     （`beanClass="com.intellij.codeInsight.completion.CompletionConfidenceEP"` dynamic="true"）；
//     `CompletionConfidence.java:21` 的方法面 `shouldSkipAutopopup(contextElement, psiFile, offset)`
//     （旧档）/`shouldSkipAutopopup(editor, contextElement, psiFile, offset)`（`:32`），返回
//     `ThreeState`（`YES` = 跳过自动弹出）；取法 `CompletionConfidenceEP.forLanguage(language)`。
//
// 本仓此前：排序权重是 `src/completionSorter.ts` 的**私有注册表**（`REGISTERED` Map +
// `registerCompletionWeigher`），自信度则完全没有落点 —— 两条都不能被第三方按 id 挂进去。
// 本文件补上那一层：EP 声明 + 与上游同名的方法面 + consume 函数；`completionSorter.ts` 的
// `registerCompletionWeigher` 现在同时写 EP、`completionSorterFor` 从 EP 收编（dedup by id），
// `src/lspCompletion.ts` 的自动弹出入口问自信度。
//
// 与上游的如实差异：① 本仓没有 JVM `Comparable`/`ThreeState`，权重键收成 `number|string|null`，
// 自信度收成布尔（`true` = 跳过）；② `Weigher<T, Location>` 的泛型收成 `unknown`（本仓候选是
// `SortableCompletion` 的结构类型）。
//
// 纯数据层：只 import `src/extensionPoints.ts`，便于 `node --test` 直测。
//
// 判据：`tests/completion-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** 两条 EP 的 id（逐字取自上游 `EP_NAME` / `qualifiedName`，见文件头）。 */
export const WEIGHER_EP = 'com.intellij.weigher'
export const COMPLETION_CONFIDENCE_EP = 'com.intellij.completion.confidence'

/** `com.intellij.weigher` 的补全注册键（`WeighingService.java:24` 的 `RELEVANCE_KEY`）。 */
export const WEIGHER_KEY_COMPLETION = 'completion'
/** 另一条已知键（`Weigher.java:11` 的 "proximity"），本仓暂未消费，登记出来备第三方用。 */
export const WEIGHER_KEY_PROXIMITY = 'proximity'

/** `weigh()` 的返回：可比较的键，或 `null`/`undefined` = 这一档不参与（照 `Weigher.weigh` 的 `@Nullable`）。 */
export type WeigherKey = number | string | null | undefined

/** 权重的位置上下文（`Weigher<T, Location>` 的 `Location`，本仓只用到已输入前缀）。 */
export interface WeigherLocationLike {
  typedPrefix?: string
}

/**
 * 一条权重（`Weigher.weigh(element, location)` 的同名方法面）。
 * `key` 对应上游 `<weigher key="…">` 的 `key` 属性；`id` 是本仓的贡献身份（同 id 覆盖）。
 */
export interface WeigherContribution {
  id: string
  /** 注册键（`completion` / `proximity` / …）。 */
  key: string
  /** `Weigher.myNegated` 的等价物（升序取反）。 */
  negated?: boolean
  /** 依赖已输入前缀（`LookupElementWeigher.myPrefixDependent`）。 */
  prefixDependent?: boolean
  /** 上游 `weigh(T element, Location location)`。 */
  weigh: (element: unknown, location: WeigherLocationLike) => WeigherKey
  /** 两个非 null 键怎么比较（缺省：数字相减 / 字符串码元序）。 */
  compare?: (left: WeigherKey, right: WeigherKey) => number
}

/** `WeighingService.getWeighers(key)` 的等价物。 */
export function weighersFor(key: string, scope: string = APPLICATION_SCOPE): WeigherContribution[] {
  return EXTENSIONS.extensionsOf<WeigherContribution>(WEIGHER_EP, scope).filter(weigher => weigher.key === key)
}

/** 注册一条权重（同 id 覆盖）。 */
export function registerWeigher(contribution: WeigherContribution, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(WEIGHER_EP, contribution.id, contribution, options)
}

/** 注销一条权重（返回是否真的删掉了）。 */
export function unregisterWeigher(id: string): boolean {
  return EXTENSIONS.unregisterExtension(WEIGHER_EP, id)
}

/** 上游 `CompletionConfidence.ThreeState` 的可移植档（本仓只保留 `yes`/`no`/`unsure` 三值语义）。 */
export type ConfidenceState = 'yes' | 'no' | 'unsure'

/** 自动弹出自信度的上下文（上游 `shouldSkipAutopopup(editor, contextElement, psiFile, offset)` 的替代）。 */
export interface ConfidenceInput {
  path: string
  language: string
  text: string
  line: number
  character: number
}

/**
 * 一条补全自信度（`CompletionConfidence.shouldSkipAutopopup` 的同名方法面）。
 * `yes` = **跳过**自动弹出（上游 `ThreeState.YES`），`no` = 明确要弹，`unsure`/缺省 = 交给后续判断。
 */
export interface CompletionConfidenceContribution {
  id: string
  /** 语言限定（空/缺省 = 任意语言，照 `LanguageExtensionWithAny` 的 any 档）。 */
  languages?: readonly string[]
  shouldSkipAutopopup: (input: ConfidenceInput) => ConfidenceState
}

/** `CompletionConfidenceEP.forLanguage(language)` 的等价物。 */
export function completionConfidences(language: string, scope: string = APPLICATION_SCOPE): CompletionConfidenceContribution[] {
  return EXTENSIONS.extensionsOf<CompletionConfidenceContribution>(COMPLETION_CONFIDENCE_EP, scope)
    .filter(confidence => !confidence.languages || confidence.languages.length === 0 || confidence.languages.includes(language))
}

/** 注册一条自信度（同 id 覆盖）。 */
export function registerCompletionConfidence(
  contribution: CompletionConfidenceContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(COMPLETION_CONFIDENCE_EP, contribution.id, contribution, options)
}

/** 注销一条自信度（返回是否真的删掉了）。 */
export function unregisterCompletionConfidence(id: string): boolean {
  return EXTENSIONS.unregisterExtension(COMPLETION_CONFIDENCE_EP, id)
}

/**
 * 这次自动弹出要不要**跳过**：任一贡献返回 `yes` 即跳过（上游 `BaseCompletionService` 收全部
 * confidence、任一 `YES` 就不弹）。一条都没有时返回 false（不因为有 EP 反而把补全关掉）。
 */
export function shouldSkipAutopopup(input: ConfidenceInput, scope: string = APPLICATION_SCOPE): boolean {
  for (const confidence of completionConfidences(input.language, scope)) {
    try {
      if (confidence.shouldSkipAutopopup(input) === 'yes') return true
    } catch {
      // 坏贡献当作 unsure，问下一支。
    }
  }
  return false
}

// ── EP 声明 / 注册 / 注销 ─────────────────────────────────────────────────────────────────

/** 两条 EP 的声明（幂等：重复调用只覆盖同名声明）。 */
export function declareCompletionExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: WEIGHER_EP, name: '权重', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: COMPLETION_CONFIDENCE_EP, name: '补全自信度', scope: APPLICATION_SCOPE, dynamic: true })
  for (const [id, name] of COMPLETION_UI_EXTENSION_POINTS) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

// ── 第二批（2026-10-06 epclose-lp）：弹层动作 / 用量 / 预选 / 字符过滤 / 错误修复命令 ─────────
//
// 上游依据（qualifiedName 与 `ExtensionPointName.create` 的串**逐字**取自上游；本段不发明 id）：
//   · `com.intellij.lookup.actionProvider` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:369`
//     （`interface="com.intellij.codeInsight.lookup.LookupActionProvider"` dynamic="true"）；接口
//     `platform/lang-impl/src/com/intellij/codeInsight/lookup/LookupActionProvider.java:22`（`EP_NAME` 在 `:29`）；
//     方法面 `fillActions(element, lookup, consumer)`（`:36`）—— 给当前候选补一批**上下文动作**
//     （平台内建两条：`LiveTemplateLookupActionProvider`（`:1004`）、
//     `PostfixTemplateLookupActionProvider`（`:1499`））。
//   · `com.intellij.lookup.usageDetails` —— 同文件 `:375`
//     （`interface="com.intellij.codeInsight.lookup.impl.LookupUsageDescriptor"`）；接口
//     `…/lookup/impl/LookupUsageDescriptor.java:19`（`EP_NAME` 在 `:22`）；方法面
//     `getExtensionKey()`（`:28`）与 `getAdditionalUsageData(lookupResultDescriptor)`（`:33`，缺省空表）。
//   · `com.intellij.completion.preselectionBehaviourProvider` —— 同文件 `:367`
//     （`interface="com.intellij.codeInsight.completion.CompletionPreselectionBehaviourProvider"`）；
//     类 `…/completion/CompletionPreselectionBehaviourProvider.java:14`（`EP_NAME` 在 `:17-18`）；
//     方法面 `shouldPreselectFirstSuggestion(parameters)`（`:20`，缺省 true）；静态入口
//     `getExtensions()`（`:24-26`）。语义见类注释 `:11-13`：**只作用于自动弹层**，
//     显式调用的补全一律预选。
//   · `com.intellij.lookup.charFilter` —— `platform/platform-impl/resources/intellij.platform.ide.impl.xml:440`
//     （`interface="com.intellij.codeInsight.lookup.CharFilter"`）；类
//     `platform/platform-impl/src/com/intellij/codeInsight/lookup/CharFilter.java:23`（`EP_NAME` 在 `:28`）；
//     **抽象方法** `acceptChar(char c, int prefixLength, Lookup lookup)`（`:69`，返回 `Result` 或 null）；
//     `Result` 三个值在 `:39-52`：`ADD_TO_PREFIX` / `SELECT_ITEM_AND_FINISH_LOOKUP` / `HIDE_LOOKUP`。
//   · `com.intellij.codeInsight.completion.error.intention` —— 同 lang-impl 文件 `:390`
//     （`interface="com.intellij.codeInsight.completion.command.commands.ErrorFixCommandProvider"`）；
//     接口 `…/completion/command/commands/DirectIntentionCommandProvider.kt:663-670`
//     （`getCommands(psiFile, errorHighlightings, offset)` 在 `:665`，`EP_NAME` 在 `:668`）；
//     消费点（上游）：同文件 `:474` 在 `..` 命令补全里把 `ErrorFixCommandProvider.EP_NAME.extensionList`
//     的 provider 逐个问一遍（`dumbService.filterByDumbAwareness` 过滤）。
//
// 本仓此前：这五条都没有宿主面。落点与消费点：
//   · `lookup.actionProvider` → `src/completionUi.ts` 的 Alt+Enter 键位（`handleLookupActionKey`）；
//   · `lookup.usageDetails` → 同文件 `completionUi` 的「一轮结束」那一拍（`lookupUsageRecords`）；
//   · `preselectionBehaviourProvider` → `src/lspCompletion.ts` 的结果（`selectOnOpen`）；
//   · `lookup.charFilter` → `src/completionUi.ts` 的输入处理器（`charFilterDecision`）；
//   · `error.intention` → `src/completionCommands.ts` 的 `collectCommands`（命令表里追加错误修复命令）。

/** 五条 UI/命令侧 EP 的 id（逐字取自上游，见上）。 */
export const LOOKUP_ACTION_PROVIDER_EP = 'com.intellij.lookup.actionProvider'
export const LOOKUP_USAGE_DETAILS_EP = 'com.intellij.lookup.usageDetails'
export const PRESELECTION_BEHAVIOUR_PROVIDER_EP = 'com.intellij.completion.preselectionBehaviourProvider'
export const LOOKUP_CHAR_FILTER_EP = 'com.intellij.lookup.charFilter'
export const ERROR_FIX_COMMAND_PROVIDER_EP = 'com.intellij.codeInsight.completion.error.intention'

/** 声明用的一览（id + 中文名），`declareCompletionExtensionPoints` 逐个声明。 */
const COMPLETION_UI_EXTENSION_POINTS: readonly (readonly [string, string])[] = [
  [LOOKUP_ACTION_PROVIDER_EP, '弹层动作提供方'],
  [LOOKUP_USAGE_DETAILS_EP, '弹层用量描述符'],
  [PRESELECTION_BEHAVIOUR_PROVIDER_EP, '补全预选行为提供方'],
  [LOOKUP_CHAR_FILTER_EP, '弹层字符过滤器'],
  [ERROR_FIX_COMMAND_PROVIDER_EP, '错误修复命令提供方'],
]

/** 弹层里一条上下文动作（上游 `LookupElementAction` 的可移植替代）。 */
export interface LookupElementActionLike {
  /** 动作文案（上游 `LookupElementAction.getText()`）。 */
  text: string
  /** 图标键（上游 `getIcon()`；本仓按键取图标）。 */
  iconKey?: string
  /** 执行（宿主注入的上下文；本仓没有 AnAction，动作自己带执行体）。 */
  run: (context: LookupActionContext) => void
}

/** 问动作/过滤/用量时的上下文（上游 `Lookup` + `LookupElement` 的可移植替代）。 */
export interface LookupActionContext {
  /** 当前文件路径。 */
  path: string
  /** 语言 id（未知留空 —— 与其它 EP 同一口径：未知不按语言收窄）。 */
  language: string
  /** 已打出来的前缀（上游 `lookup.getPrefixLength()` 那段文本）。 */
  prefix: string
  /** 选中的候选项显示文本（上游 `element.getLookupString()`）。 */
  lookupString: string
  /** 候选项类型档（本仓的 `Completion.type`）。 */
  itemKind?: string
  /** 这一轮是自动弹出还是显式调用（`Lookup` 的 auto-popup 档；拿不到时留空 = 按自动档）。 */
  autoPopup?: boolean
  /** 这一轮是怎么结束的：`accepted` / `cancelled` / `replaced`（上游 `LookupResultDescriptor`）。 */
  outcome: 'accepted' | 'cancelled' | 'replaced'
}

/** 一条弹层动作提供方（方法名与上游逐字相同）。 */
export interface LookupActionProviderContribution {
  id: string
  languages?: readonly string[]
  /** `fillActions(element, lookup, consumer)` —— 本仓把 consumer 换成「返回一个列表」。 */
  fillActions: (context: LookupActionContext) => readonly LookupElementActionLike[]
}

/** `LookupActionProvider.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function lookupActionProviders(language: string, scope: string = APPLICATION_SCOPE): LookupActionProviderContribution[] {
  return EXTENSIONS.extensionsOf<LookupActionProviderContribution>(LOOKUP_ACTION_PROVIDER_EP, scope)
    .filter(contribution => completionAcceptsLanguage(contribution, language))
}

/**
 * 收集当前候选项的上下文动作（上游 `fillActions` 逐个 provider 塞进 consumer）。
 * 消费点：`src/completionUi.ts` 的 Alt+Enter 键位 —— 有动作就吃掉这一键、跑第一条
 * （上游是弹一个动作菜单；本仓的自绘弹层里没有二级菜单位，**第一条即执行**，如实登记）。
 */
export function lookupActionsFor(context: LookupActionContext, scope: string = APPLICATION_SCOPE): LookupElementActionLike[] {
  const out: LookupElementActionLike[] = []
  for (const provider of lookupActionProviders(context.language, scope)) {
    try { out.push(...provider.fillActions(context)) } catch { /* 坏 provider 跳过。 */ }
  }
  return out
}

/** 一条弹层用量描述符（方法名与上游逐字相同）。 */
export interface LookupUsageDescriptorContribution {
  id: string
  /** `getExtensionKey()`（上游要求它是 `completion.finished` 事件里的一个白名单键）。 */
  getExtensionKey: () => string
  /** `getAdditionalUsageData(lookupResultDescriptor)`（缺省空表）。 */
  getAdditionalUsageData?: (context: LookupActionContext) => readonly (readonly [string, unknown])[]
}

/** `LookupUsageDescriptor.EP_NAME.getExtensionList()` 的等价物。 */
export function lookupUsageDescriptors(scope: string = APPLICATION_SCOPE): LookupUsageDescriptorContribution[] {
  return EXTENSIONS.extensionsOf<LookupUsageDescriptorContribution>(LOOKUP_USAGE_DETAILS_EP, scope)
}

/**
 * 一轮补全结束时收集用量（上游 `LookupUsageTracker` 在 `completion.finished` 上收这一批）。
 * 消费点：`src/completionUi.ts` 的 `completionLayout` 插件 —— 弹层从"开着"变成"关了"
 * 那一拍（`endCompletionIfRoundOver`）把记录交给宿主注入的接收器（本仓没有远端统计通道，
 * 接收器缺省是空操作，如实登记）。
 */
export function lookupUsageRecord(
  context: LookupActionContext, scope: string = APPLICATION_SCOPE,
): { key: string; data: [string, unknown][] }[] {
  const out: { key: string; data: [string, unknown][] }[] = []
  for (const descriptor of lookupUsageDescriptors(scope)) {
    let data: [string, unknown][] = []
    if (typeof descriptor.getAdditionalUsageData === 'function') {
      try { data = descriptor.getAdditionalUsageData(context).map(pair => [pair[0], pair[1]] as [string, unknown]) } catch { data = [] }
    }
    try { out.push({ key: descriptor.getExtensionKey(), data }) } catch { /* 坏描述符跳过。 */ }
  }
  return out
}

/** 一条预选行为提供方（方法名与上游逐字相同）。 */
export interface PreselectionBehaviourProviderContribution {
  id: string
  languages?: readonly string[]
  /** `shouldPreselectFirstSuggestion(parameters)`（缺省 true）。 */
  shouldPreselectFirstSuggestion: (context: LookupActionContext) => boolean
}

/** `CompletionPreselectionBehaviourProvider.getExtensions()` 的等价物（按语言过滤）。 */
export function preselectionBehaviourProviders(
  language: string, scope: string = APPLICATION_SCOPE,
): PreselectionBehaviourProviderContribution[] {
  return EXTENSIONS.extensionsOf<PreselectionBehaviourProviderContribution>(PRESELECTION_BEHAVIOUR_PROVIDER_EP, scope)
    .filter(contribution => completionAcceptsLanguage(contribution, language))
}

/**
 * 这次弹层要不要预选第一条：**任一**贡献说不要就不要（上游是"有一个 provider 说 false 就不选"，
 * 因为平台的默认值 true 由"没有 provider"来表达）；显式调用的补全**一律预选**
 * （类注释 `CompletionPreselectionBehaviourProvider.java:11-13`）。
 * `autoPopup` 缺省（拿不到那一格）按自动档走 —— 这一族本来就是管自动弹层那一档的。
 * 消费点：`src/lspCompletion.ts` 的结果对象（`selectOnOpen`）。
 */
export function shouldPreselectFirstSuggestion(
  context: LookupActionContext, scope: string = APPLICATION_SCOPE,
): boolean {
  if (context.autoPopup === false) return true
  for (const provider of preselectionBehaviourProviders(context.language, scope)) {
    try {
      if (provider.shouldPreselectFirstSuggestion(context) === false) return false
    } catch { /* 坏 provider 跳过。 */ }
  }
  return true
}

/** `CharFilter.Result` 三个值（`CharFilter.java:39-52`），逐字。 */
export type CharFilterResult = 'ADD_TO_PREFIX' | 'SELECT_ITEM_AND_FINISH_LOOKUP' | 'HIDE_LOOKUP'

/** 一条字符过滤器（抽象方法名与上游逐字相同）。 */
export interface CharFilterContribution {
  id: string
  languages?: readonly string[]
  /** `acceptChar(c, prefixLength, lookup)` —— null = 交给下一个过滤器。 */
  acceptChar: (char: string, prefixLength: number, context: LookupActionContext) => CharFilterResult | null
}

/** `CharFilter.EP_NAME.getExtensionList()` 的等价物（按语言过滤；上游这条 EP 不分语言）。 */
export function lookupCharFilters(language: string, scope: string = APPLICATION_SCOPE): CharFilterContribution[] {
  return EXTENSIONS.extensionsOf<CharFilterContribution>(LOOKUP_CHAR_FILTER_EP, scope)
    .filter(contribution => completionAcceptsLanguage(contribution, language))
}

/**
 * 打字时问一遍过滤器（上游 `LookupImpl` 在输入到来时逐个问，第一个非 null 说了算）。
 * 没有贡献或都不认返回 null ⇒ 调用方走本仓原来的行为。
 * 消费点：`src/completionUi.ts` 的 `completionCharFilter`（`EditorView.inputHandler`）。
 */
export function charFilterDecision(
  char: string, prefixLength: number, context: LookupActionContext, scope: string = APPLICATION_SCOPE,
): CharFilterResult | null {
  for (const filter of lookupCharFilters(context.language, scope)) {
    try {
      const result = filter.acceptChar(char, prefixLength, context)
      if (result) return result
    } catch { /* 坏过滤器跳过。 */ }
  }
  return null
}

/** 本仓的一条错误修复命令（上游 `CompletionCommand` 的可移植子集：文案 + 优先级 + 执行）。 */
export interface ErrorFixCommandLike {
  /** 条目标题（上游 `CompletionCommand.presentableName`）。 */
  label: string
  /** 右侧灰字（快捷键/来源）。 */
  detail?: string
  /** 排序键（越大越靠前；本仓命令表用 0..N 的相对档）。 */
  priority?: number
  /** 执行。 */
  run?: () => void
}

/** 问错误修复命令的上下文（上游 `(PsiFile, List<HighlightInfo>, int offset)` 的可移植替代）。 */
export interface ErrorFixCommandInput {
  path: string
  language: string
  text: string
  offset: number
  /** 这个位置上的诊断（本仓是 LSP 诊断的严重度 + 消息）。 */
  errors: readonly { severity?: number; message: string }[]
}

/** 一条错误修复命令提供方（方法名与上游逐字相同）。 */
export interface ErrorFixCommandProviderContribution {
  id: string
  languages?: readonly string[]
  /** `getCommands(psiFile, errorHighlightings, offset)`。 */
  getCommands: (input: ErrorFixCommandInput) => readonly ErrorFixCommandLike[]
}

/** `ErrorFixCommandProvider.EP_NAME.extensionList` 的等价物（按语言过滤）。 */
export function errorFixCommandProviders(
  language: string, scope: string = APPLICATION_SCOPE,
): ErrorFixCommandProviderContribution[] {
  return EXTENSIONS.extensionsOf<ErrorFixCommandProviderContribution>(ERROR_FIX_COMMAND_PROVIDER_EP, scope)
    .filter(contribution => completionAcceptsLanguage(contribution, language))
}

/**
 * `DirectIntentionCommandProvider.kt:474` 那个循环的等价物：把各 provider 的命令接成一串。
 * 消费点：`src/completionCommands.ts` 的 `collectCommands`（命令表里追加错误修复命令）。
 */
export function errorFixCommands(
  input: ErrorFixCommandInput, scope: string = APPLICATION_SCOPE,
): ErrorFixCommandLike[] {
  const out: ErrorFixCommandLike[] = []
  for (const provider of errorFixCommandProviders(input.language, scope)) {
    try { out.push(...provider.getCommands(input)) } catch { /* 坏 provider 跳过。 */ }
  }
  return out
}

/** 语言过滤（与 `src/editorActionExtraExtensionPoints.ts` 同一口径：未知不收窄）。 */
function completionAcceptsLanguage(contribution: { languages?: readonly string[] }, language: string): boolean {
  const list = contribution.languages
  if (!list || list.length === 0) return true
  if (!language || language === 'other') return true
  return list.includes(language)
}

/** 注册一条弹层动作提供方。 */
export function registerLookupActionProvider(
  contribution: LookupActionProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(LOOKUP_ACTION_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条弹层用量描述符。 */
export function registerLookupUsageDescriptor(
  contribution: LookupUsageDescriptorContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(LOOKUP_USAGE_DETAILS_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条预选行为提供方。 */
export function registerPreselectionBehaviourProvider(
  contribution: PreselectionBehaviourProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(PRESELECTION_BEHAVIOUR_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条字符过滤器。 */
export function registerLookupCharFilter(
  contribution: CharFilterContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(LOOKUP_CHAR_FILTER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条错误修复命令提供方。 */
export function registerErrorFixCommandProvider(
  contribution: ErrorFixCommandProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(ERROR_FIX_COMMAND_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

declareCompletionExtensionPoints()

// ── bundled：把本仓在跑的那几支作为默认贡献登记进来 ─────────────────────────────────────────

/**
 * 本仓内建的补全相关性权重（上游 `LspCompletionWeigher`，注册在
 * `platform/lsp-impl/resources/intellij.platform.lsp.impl.xml:86-89` 的 `<weigher key="completion">`）。
 * `id` 取默认链里的 `completion` 档同名 ⇒ `completionSorterFor` 收编时按 id 去重，不会重复插档；
 * 它同时**如实**出现在 EP 里，第三方按 `key="completion"` 挂自己的权重能参与同一档。
 */
export const BUNDLED_COMPLETION_WEIGHER_ID = 'completion'

/** 内建的补全相关性权重：有 `sortText` 的按它降序，没有的返回 null（落 nulls 桶）。 */
export function builtinCompletionWeigher(): WeigherContribution {
  return {
    id: BUNDLED_COMPLETION_WEIGHER_ID,
    key: WEIGHER_KEY_COMPLETION,
    negated: true,
    prefixDependent: true,
    weigh: element => {
      const sortText = (element as { sortText?: unknown } | null | undefined)?.sortText
      return typeof sortText === 'string' ? sortText : null
    },
  }
}

/** 登记本仓在跑的默认权重（幂等：同 id 覆盖）。 */
export function registerBundledCompletionDefaults(): void {
  registerWeigher(builtinCompletionWeigher(), { source: 'bundled' })
  registerLookupActionProvider(builtinLookupActionProvider(), { source: 'bundled' })
  registerLookupUsageDescriptor(builtinLookupUsageDescriptor(), { source: 'bundled' })
  registerLookupCharFilter(builtinLookupCharFilter(), { source: 'bundled' })
  registerErrorFixCommandProvider(builtinErrorFixCommandProvider(), { source: 'bundled' })
}

/** 内建弹层动作提供方 id（passthrough：本仓弹层没有上下文动作菜单，见函数注释）。 */
export const BUNDLED_LOOKUP_ACTION_PROVIDER_ID = 'taocode.lookupActionProvider.bundled'
/** 内建用量描述符 id（passthrough：本仓没有远端统计通道）。 */
export const BUNDLED_LOOKUP_USAGE_DESCRIPTOR_ID = 'taocode.lookupUsageDescriptor.bundled'
/** 内建字符过滤器 id（passthrough：不认任何字符 ⇒ 本仓原行为照旧）。 */
export const BUNDLED_LOOKUP_CHAR_FILTER_ID = 'taocode.lookupCharFilter.bundled'
/** 内建错误修复命令提供方 id（passthrough：不给命令）。 */
export const BUNDLED_ERROR_FIX_COMMAND_PROVIDER_ID = 'taocode.errorFixCommandProvider.bundled'

/** 内建弹层动作提供方 —— 一条都不给（本仓的弹层没有 Alt+Enter 动作菜单；
 *  它存在的意义是让 EP 里有一条 bundled 项、第三条按 id 挂的提供方能被真实取到）。 */
export function builtinLookupActionProvider(): LookupActionProviderContribution {
  return { id: BUNDLED_LOOKUP_ACTION_PROVIDER_ID, fillActions: () => [] }
}

/** 内建用量描述符 —— `completion.finished` 事件在本仓没有远端通道，键与数据都空着。 */
export function builtinLookupUsageDescriptor(): LookupUsageDescriptorContribution {
  return {
    id: BUNDLED_LOOKUP_USAGE_DESCRIPTOR_ID,
    getExtensionKey: () => 'taocode.completion.finished',
    getAdditionalUsageData: () => [],
  }
}

/** 内建字符过滤器 —— 恒 null（不认任何字符 ⇒ 调用方走本仓原来的输入行为）。 */
export function builtinLookupCharFilter(): CharFilterContribution {
  return { id: BUNDLED_LOOKUP_CHAR_FILTER_ID, acceptChar: () => null }
}

/** 内建错误修复命令提供方 —— 不给命令（本仓的命令表来自动作注册表，见 `src/completionCommands.ts`）。 */
export function builtinErrorFixCommandProvider(): ErrorFixCommandProviderContribution {
  return { id: BUNDLED_ERROR_FIX_COMMAND_PROVIDER_ID, getCommands: () => [] }
}

registerBundledCompletionDefaults()
