// **重命名/重构的扩展点**（上游 `com.intellij.refactoring.rename.*` 与 `RefactoringHelper`、
// `QualifiedNameProvider` 一族在本仓的等价物）。
//
// 上游是什么：重命名那一族有六条 EP，id 逐字取自各类的 `ExtensionPointName.create`：
//   · `com.intellij.renameInputValidator` —— `RenameInputValidator.java:19`，方法面
//     `boolean isInputValid(String newName, PsiElement element, ProcessingContext ctx)`（`:30`）；
//   · `com.intellij.nameSuggestionProvider` —— `NameSuggestionProvider.java:17`，方法面
//     `SuggestedNameInfo getSuggestedNames(PsiElement element, PsiElement ctx, Set<String> result)`（`:30`），
//     静态入口 `suggestNames(...)`（`:32-38`）遍历全部贡献；
//   · `com.intellij.renameHandler` —— `RenameHandler.java:13`，方法面
//     `boolean isAvailableOnDataContext(DataContext)`（`:18`）+ `isRenaming(...)`（`:23`）；
//   · `com.intellij.vetoRenameCondition` —— 声明在
//     `platform/refactoring/resources/intellij.platform.refactoring.xml:40`（`interface="com.intellij.openapi.util.Condition"`），
//     限定名见 `PsiElementRenameHandler.java:49` 的 `VETO_RENAME_CONDITION_EP`，
//     命中即拒绝重命名（`Condition<? super PsiElement>`）；
//   · `com.intellij.automaticRenamerFactory` —— `AutomaticRenamerFactory.java:19`，方法面
//     `boolean isApplicable()` / `AutomaticRenamer createRenamer(...)`；
//   · `com.intellij.refactoring.helper` —— `RefactoringHelper.java:18`，方法面
//     `T prepareOperation(UsageInfo[], List<PsiElement>)`（`:26`）+ `void performOperation(Project, T)`（`:43`）；
//   · `com.intellij.qualifiedNameProvider` / `com.intellij.virtualFileQualifiedNameProvider` ——
//     `QualifiedNameProvider.java:15` / `VirtualFileQualifiedNameProvider.java:14`，方法面
//     `String getQualifiedName(PsiElement)`（`:21`）/ 文件侧同名。
//
// 本仓此前：重命名名字校验是 `src/refactorPreview.ts` 的 `validateRenameName`（纯函数）+ 宿主
// `src/appRenameRules.ts` 的 `renameNameProblem`，**没有插件 EP 宿主** —— 第三方无法按 id 挂一个
// 名字校验器/名字建议器/否决条件/重命名处理器。本文件补上那一层，方法是：
//   · 七条 EP 用 `src/extensionPoints.ts` 的 `EXTENSIONS.declareExtensionPoint()` 声明；
//   · 贡献形状 = 上游接口的**可移植子集**（本仓没有 PSI，`PsiElement` 换成路径 + 语言 + 当前名）；
//   · 内置的语言关键字校验 **作为 bundled 贡献**挂进 `renameInputValidator`，名字建议（按语言给
//     驼峰/蛇形候选）挂进 `nameSuggestionProvider`，`src/refactorPreview.ts` 的 `validateRenameName`
//     由宿主 `invalidRenameName` computed 调用；因此内置规则在 EP 里看得见，不是私有分支。
//
// 与上游的如实差异：① 本仓没有 PSI，`PsiElement`/`ProcessingContext` 用 `RenameSubject`（路径 +
// 语言 + 当前名）；② `UsageInfo[]` 换成 `RefactoringUsage`（路径 + 行 + 一段文本），
// `prepareOperation`/`performOperation` 是同签名同语义的同步版；③ `QualifiedNameProvider`
// 的上游签名是 `PsiElement`，本仓是「语言 + 名字 + 上下文路径」，由
// `src/copyPathActions.ts` 的「复制引用」链消费。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测（与 `gotoByNameContributors.ts` 同一纪律）。
//
// 判据：`tests/refactor-rename-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** 七条 EP 的 id（逐字取自上游各自的 `ExtensionPointName.create`，见文件头逐行出处）。 */
export const RENAME_INPUT_VALIDATOR_EP = 'com.intellij.renameInputValidator'
export const NAME_SUGGESTION_PROVIDER_EP = 'com.intellij.nameSuggestionProvider'
export const RENAME_HANDLER_EP = 'com.intellij.renameHandler'
export const VETO_RENAME_CONDITION_EP = 'com.intellij.vetoRenameCondition'
export const AUTOMATIC_RENAMER_FACTORY_EP = 'com.intellij.automaticRenamerFactory'
export const REFACTORING_HELPER_EP = 'com.intellij.refactoring.helper'
export const QUALIFIED_NAME_PROVIDER_EP = 'com.intellij.qualifiedNameProvider'
export const VIRTUAL_FILE_QUALIFIED_NAME_PROVIDER_EP = 'com.intellij.virtualFileQualifiedNameProvider'
/**
 * 重构元素监听者提供者（`RefactoringElementListenerProvider`，上游
 * `platform/refactoring/resources/intellij.platform.refactoring.xml:54`
 * `interface="com.intellij.refactoring.listeners.RefactoringElementListenerProvider"` area="IDEA_PROJECT"
 * dynamic="true"）；接口 `platform/analysis-api/src/com/intellij/refactoring/listeners/
 * RefactoringElementListenerProvider.java:26`（`EP_NAME` 在 `:28-29`）；方法面
 * `getListener(PsiElement): RefactoringElementListener`（`:35`），监听者面是
 * `elementRenamed(PsiElement)` / `elementMoved(PsiElement)`。
 */
export const REFACTORING_ELEMENT_LISTENER_PROVIDER_EP = 'com.intellij.refactoring.elementListenerProvider'

/** 一次重构元素事件的载荷（上游 `PsiElement` 的可移植替代：路径 + 语言 + 名字）。 */
export interface RefactoringElementInput {
  path: string
  language: string
  /** 元素名（重命名前的旧名）。 */
  name: string
  /** 新名（重命名事件才有）。 */
  newName?: string
}

/** 一个重构元素监听者（`RefactoringElementListener` 的方法面，名字与上游逐字相同）。 */
export interface RefactoringElementListenerLike {
  elementRenamed?: (element: RefactoringElementInput) => void
  elementMoved?: (element: RefactoringElementInput) => void
}

/** 一条监听者提供者（`RefactoringElementListenerProvider.getListener(element)` 的同名方法面）。 */
export interface RefactoringElementListenerProviderContribution {
  id: string
  /** 上游 `getListener(PsiElement)` —— 认领这个元素就返回一个监听者，否则 null。 */
  getListener: (element: RefactoringElementInput) => RefactoringElementListenerLike | null
}

/**
 * 被改名的对象（上游 `PsiElement` 的可移植替代）：路径 + 语言 + 当前名。
 * `kind` 是 `class`/`method`/`field` 一档的粗分类，供建议器挑候选形态（本仓从 LSP 符号 kind 折过来）。
 */
export interface RenameSubject {
  path: string
  language: string
  /** 当前名（可为空串：还没解析出名字时）。 */
  currentName: string
  /** 粗分类（缺省 `symbol`）。 */
  kind?: string
}

/** 一次重命名的重命名输入校验上下文（上游 `ProcessingContext` 的最小子集）。 */
export interface RenameValidationContext {
  /** 全部待改位置（路径 + 行 + 列）。 */
  readonly locations: readonly { path: string; line: number; character: number }[]
  /** 是不是「搜索注释与字符串」那一档开着。 */
  readonly searchInComments: boolean
}

/** 上游 `RenameInputValidator`（`RenameInputValidator.java:18-30`）的可移植子集。 */
export interface RenameInputValidator {
  id: string
  /** 支持的语言（空数组 = 任何语言都过；上游按 `RenameInputValidatorEx.getLanguage()` 过滤）。 */
  languages?: readonly string[]
  /** 返回错误文案（空串 = 合法，与本仓 `invalidRenameName` 的契约一致）。 */
  isInputValid: (newName: string, subject: RenameSubject, context: RenameValidationContext) => string
}

/** 上游 `SuggestedNameInfo`（只保留名字列表这一格）。 */
export interface SuggestedNames {
  names: readonly string[]
}

/** 上游 `NameSuggestionProvider`（`NameSuggestionProvider.java:16-30`）的可移植子集。 */
export interface NameSuggestionProvider {
  id: string
  languages?: readonly string[]
  /** 把建议名**并入** `result`（上游签名同：`Set<String> result` 是入参也是出参）。 */
  getSuggestedNames: (subject: RenameSubject, result: string[]) => void
}

/** 上游 `RenameHandler`（`RenameHandler.java:12-23`）的可移植子集。 */
export interface RenameHandler {
  id: string
  /** 这一档在当前位置可用吗（上游 `isAvailableOnDataContext`）。 */
  isAvailableOnDataContext: (subject: RenameSubject) => boolean
  /** 是不是「正在重命名」那半（上游 `isRenaming`，缺省假）。 */
  isRenaming?: (subject: RenameSubject) => boolean
}

/** 上游 `Condition<? super PsiElement>`（`vetoRenameCondition`）：返回真即**否决**这次重命名。 */
export interface VetoRenameCondition {
  id: string
  veto: (subject: RenameSubject) => boolean
}

/** 上游 `AutomaticRenamerFactory`（`AutomaticRenamerFactory.java:19`）的可移植子集。 */
export interface AutomaticRenamerFactory {
  id: string
  /** 这个工厂对当前对象适用吗（上游 `isApplicable`）。 */
  isApplicable: (subject: RenameSubject) => boolean
  /** 候选名（上游 `createRenamer(...).getAllPossibleNames()`，本仓直接给名字表）。 */
  suggestedNames: (subject: RenameSubject) => readonly string[]
  /** 随重命名一并处理的**派生名**（上游 renamer 的 `getElements()`，本仓给「旧名 → 新名」对）。 */
  companionRenames?: (oldName: string, newName: string) => readonly { from: string; to: string }[]
}

/** 上游 `UsageInfo` 的可移植替代：一处用法。 */
export interface RefactoringUsage {
  path: string
  line: number
  /** 该处用法的文本（预览/描述用）。 */
  text: string
}

/**
 * 上游 `RefactoringHelper<T>`（`RefactoringHelper.java:17-43`）的可移植子集。
 * 本仓没有 `Project`，`performOperation` 的第二参换成「本仓能改的落地钩子」`RefactorSink`。
 */
export interface RefactorSink {
  /** 把一处文本替换写进目标文件（本仓的 `applyEdits` 等价面）。 */
  replace: (path: string, line: number, text: string) => void
}

export interface RefactoringHelper<T> {
  id: string
  /** 准备期：从用法集算出操作数据（上游 `prepareOperation`）。 */
  prepareOperation: (usages: readonly RefactoringUsage[], subject: RenameSubject) => T
  /** 执行期：把操作数据落盘（上游 `performOperation(Project, T)`）。 */
  performOperation: (data: T, sink: RefactorSink) => void
}

/** 上游 `QualifiedNameProvider`（`QualifiedNameProvider.java:14-24`）的可移植子集。 */
export interface QualifiedNameProvider {
  id: string
  languages?: readonly string[]
  /** 限定名（上游 `getQualifiedName(PsiElement)`）。 */
  getQualifiedName: (subject: RenameSubject) => string
}

/** 上游 `VirtualFileQualifiedNameProvider`（文件侧同名 EP）的可移植子集。 */
export interface VirtualFileQualifiedNameProvider {
  id: string
  /** 文件的限定名（本仓按工作区根算相对路径，`src/copyPathActions.ts` 的「来自源根的路径」同源）。 */
  getQualifiedName: (path: string, root: string) => string
}

/** 七条 EP 的声明（幂等：重复调用只覆盖同名声明）。 */
export function declareRefactorRenameExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: RENAME_INPUT_VALIDATOR_EP, name: '重命名输入校验器', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: NAME_SUGGESTION_PROVIDER_EP, name: '名字建议提供方', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: RENAME_HANDLER_EP, name: '重命名处理器', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: VETO_RENAME_CONDITION_EP, name: '重命名否决条件', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: AUTOMATIC_RENAMER_FACTORY_EP, name: '自动重命名工厂', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: REFACTORING_HELPER_EP, name: '重构助手', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: QUALIFIED_NAME_PROVIDER_EP, name: '限定名提供方', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: VIRTUAL_FILE_QUALIFIED_NAME_PROVIDER_EP, name: '文件限定名提供方', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: REFACTORING_ELEMENT_LISTENER_PROVIDER_EP, name: '重构元素监听者提供方', scope: APPLICATION_SCOPE, dynamic: true })
}

declareRefactorRenameExtensionPoints()

/* ── 按 id 注册/注销（每条 EP 一个薄封装，形状与 `gotoByNameContributors.ts` 一致）────────── */

function register<T extends { id: string }>(ep: string, value: T, options: RegisterExtensionOptions): ExtensionHandle {
  return EXTENSIONS.registerExtension(ep, value.id, value, options)
}

export function registerRenameInputValidator(value: RenameInputValidator, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(RENAME_INPUT_VALIDATOR_EP, value, options)
}
export function registerNameSuggestionProvider(value: NameSuggestionProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(NAME_SUGGESTION_PROVIDER_EP, value, options)
}
export function registerRenameHandler(value: RenameHandler, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(RENAME_HANDLER_EP, value, options)
}
export function registerVetoRenameCondition(value: VetoRenameCondition, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(VETO_RENAME_CONDITION_EP, value, options)
}
export function registerAutomaticRenamerFactory(value: AutomaticRenamerFactory, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(AUTOMATIC_RENAMER_FACTORY_EP, value, options)
}
export function registerRefactoringHelper<T>(value: RefactoringHelper<T>, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(REFACTORING_HELPER_EP, value, options)
}
export function registerQualifiedNameProvider(value: QualifiedNameProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(QUALIFIED_NAME_PROVIDER_EP, value, options)
}
export function registerVirtualFileQualifiedNameProvider(value: VirtualFileQualifiedNameProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(VIRTUAL_FILE_QUALIFIED_NAME_PROVIDER_EP, value, options)
}

/** 注册一条重构元素监听者提供者。 */
export function registerRefactoringElementListenerProvider(
  value: RefactoringElementListenerProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return register(REFACTORING_ELEMENT_LISTENER_PROVIDER_EP, value, options)
}

/* ── 重构元素监听者：消费面（重构落地后通知）────────────────────────────────────── */

/** `RefactoringElementListenerProvider.EP_NAME.getExtensionList()` 的等价物。 */
export function refactoringElementListenerProviders(scope: string = APPLICATION_SCOPE): RefactoringElementListenerProviderContribution[] {
  return EXTENSIONS.extensionsOf<RefactoringElementListenerProviderContribution>(REFACTORING_ELEMENT_LISTENER_PROVIDER_EP, scope)
}

/** 认领这个元素的全部监听者（各 provider 的 `getListener` 合并；坏 provider 跳过）。 */
export function refactoringElementListeners(element: RefactoringElementInput, scope: string = APPLICATION_SCOPE): RefactoringElementListenerLike[] {
  const out: RefactoringElementListenerLike[] = []
  for (const provider of refactoringElementListenerProviders(scope)) {
    try {
      const listener = provider.getListener(element)
      if (listener) out.push(listener)
    } catch {
      // 坏 provider 跳过。
    }
  }
  return out
}

/**
 * 重构落地后通知（上游 `RefactoringElementListener.elementRenamed` / `elementMoved`）：
 * 逐个监听者调对应那一支，坏监听者跳过，返回真的被通知到的条数。
 * 消费点：`src/semanticActions.ts` 的 `writeRename`（符号重命名落地后）。
 */
export function notifyRefactoringElementListeners(
  element: RefactoringElementInput, event: 'renamed' | 'moved', scope: string = APPLICATION_SCOPE,
): number {
  let notified = 0
  for (const listener of refactoringElementListeners(element, scope)) {
    const handler = event === 'renamed' ? listener.elementRenamed : listener.elementMoved
    if (typeof handler !== 'function') continue
    try { handler(element); notified += 1 } catch { /* 坏监听者跳过。 */ }
  }
  return notified
}

/* ── 消费面：按语言过滤后的全部贡献 ───────────────────────────────────────────── */

/** 语言过滤（上游按每个贡献自己的 `getLanguage()` 决定参不参与；空 `languages` 视为通吃）。 */
function acceptsLanguage(contribution: { languages?: readonly string[] }, language: string): boolean {
  const list = contribution.languages
  return !list || list.length === 0 || list.includes(language)
}

export function renameInputValidators(language: string, scope: string = APPLICATION_SCOPE): RenameInputValidator[] {
  return EXTENSIONS.extensionsOf<RenameInputValidator>(RENAME_INPUT_VALIDATOR_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

export function nameSuggestionProviders(language: string, scope: string = APPLICATION_SCOPE): NameSuggestionProvider[] {
  return EXTENSIONS.extensionsOf<NameSuggestionProvider>(NAME_SUGGESTION_PROVIDER_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

export function renameHandlers(subject: RenameSubject, scope: string = APPLICATION_SCOPE): RenameHandler[] {
  return EXTENSIONS.extensionsOf<RenameHandler>(RENAME_HANDLER_EP, scope)
    .filter(handler => handler.isAvailableOnDataContext(subject))
}

export function automaticRenamerFactories(subject: RenameSubject, scope: string = APPLICATION_SCOPE): AutomaticRenamerFactory[] {
  return EXTENSIONS.extensionsOf<AutomaticRenamerFactory>(AUTOMATIC_RENAMER_FACTORY_EP, scope)
    .filter(factory => factory.isApplicable(subject))
}

export function refactoringHelpers(scope: string = APPLICATION_SCOPE): RefactoringHelper<unknown>[] {
  return EXTENSIONS.extensionsOf<RefactoringHelper<unknown>>(REFACTORING_HELPER_EP, scope)
}

/** 全部否决条件（顺序按 EP 排序）。 */
export function vetoRenameConditions(scope: string = APPLICATION_SCOPE): VetoRenameCondition[] {
  return EXTENSIONS.extensionsOf<VetoRenameCondition>(VETO_RENAME_CONDITION_EP, scope)
}

/**
 * 汇总校验：把全部 applicable 校验器的第一条非空错误返回（空串 = 合法）。
 * 顺序同 EP，命中即停 —— 与上游「逐个 provider 调、第一个拒绝就拒」同效。
 */
export function validateRenameInput(
  newName: string,
  subject: RenameSubject,
  context: RenameValidationContext,
  scope: string = APPLICATION_SCOPE,
): string {
  for (const validator of renameInputValidators(subject.language, scope)) {
    const problem = validator.isInputValid(newName, subject, context)
    if (problem) return problem
  }
  return ''
}

/** 全部建议名合并后去重（上游 `NameSuggestionProvider.suggestNames` 的 `Set<String> result` 同义）。 */
export function suggestedNamesFor(subject: RenameSubject, scope: string = APPLICATION_SCOPE): string[] {
  const result: string[] = []
  for (const provider of nameSuggestionProviders(subject.language, scope)) {
    provider.getSuggestedNames(subject, result)
  }
  return [...new Set(result)]
}

/** 是否被任一否决条件拦下（任一返回真即拦）。 */
export function renameVetoedBy(subject: RenameSubject, scope: string = APPLICATION_SCOPE): VetoRenameCondition | null {
  for (const condition of vetoRenameConditions(scope)) {
    if (condition.veto(subject)) return condition
  }
  return null
}

/** 把「旧名 → 新名」的全部派生改名对收齐（自动重命名工厂的 companionRenames 合并）。 */
export function companionRenamesFor(
  subject: RenameSubject, oldName: string, newName: string, scope: string = APPLICATION_SCOPE,
): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  for (const factory of automaticRenamerFactories(subject, scope)) {
    if (factory.companionRenames) out.push(...factory.companionRenames(oldName, newName))
  }
  return out
}

/** 按语言取第一条可用的限定名（空串 = 没有 provider 管这门语言）。 */
export function qualifiedNameOf(subject: RenameSubject, scope: string = APPLICATION_SCOPE): string {
  for (const provider of EXTENSIONS.extensionsOf<QualifiedNameProvider>(QUALIFIED_NAME_PROVIDER_EP, scope)) {
    if (acceptsLanguage(provider, subject.language)) return provider.getQualifiedName(subject)
  }
  return ''
}

/** 文件限定名（取第一条；空串 = 没有 provider）。 */
export function fileQualifiedNameOf(path: string, root: string, scope: string = APPLICATION_SCOPE): string {
  const providers = EXTENSIONS.extensionsOf<VirtualFileQualifiedNameProvider>(VIRTUAL_FILE_QUALIFIED_NAME_PROVIDER_EP, scope)
  return providers.length ? providers[0].getQualifiedName(path, root) : ''
}

/* ── bundled：本仓内建的重命名规则作为 EP 贡献 ─────────────────────────────────── */

export const BUILTIN_NAME_VALIDATOR_ID = 'taocode.renameInputValidator.builtin'
export const BUILTIN_NAME_SUGGESTION_ID = 'taocode.nameSuggestionProvider.camelSnake'
export const BUILTIN_QUALIFIED_NAME_ID = 'taocode.qualifiedNameProvider.dotPath'
export const BUILTIN_FILE_QUALIFIED_NAME_ID = 'taocode.virtualFileQualifiedNameProvider.sourceRoot'

/** 本仓内建的名字校验：空/空白/非标识符/语言关键字（`src/refactorPreview.ts` 的 `validateRenameName` 同规则）。 */
export function builtinRenameInputValidator(languageKeywords: (language: string) => readonly string[]): RenameInputValidator {
  const IDENTIFIER = /^[$\p{L}_][$\p{L}\p{N}_]*$/u
  return {
    id: BUILTIN_NAME_VALIDATOR_ID,
    isInputValid(newName, subject) {
      const trimmed = newName.trim()
      if (!trimmed) return '名字不能为空。'
      if (/\s/.test(trimmed)) return '名字不能包含空白字符。'
      if (!IDENTIFIER.test(trimmed)) return '名字必须是合法标识符（字母、数字、下划线，不能以数字开头）。'
      if (languageKeywords(subject.language).includes(trimmed)) {
        return `「${trimmed}」是${subject.language}关键字，不能用作名字。`
      }
      return ''
    },
  }
}

/** 驼峰/蛇形/帕斯卡三档候选名（IDEA `NameSuggestionProvider` 的常见形态，本仓从名字切词后重排）。 */
export function builtinNameSuggestionProvider(): NameSuggestionProvider {
  return {
    id: BUILTIN_NAME_SUGGESTION_ID,
    getSuggestedNames(subject, result) {
      const words = splitNameWords(subject.currentName)
      if (words.length < 2) return
      const lower = words.map(word => word.toLowerCase())
      result.push(lower.join('_'))
      result.push(lower.map((word, index) => index === 0 ? word : capitalize(word)).join(''))
      result.push(words.map(capitalize).join(''))
    },
  }
}

/** 点分隔的限定名（本仓没有 PSI，直接给 `路径#名字` 形态，供「复制引用」链取）。 */
export function builtinQualifiedNameProvider(): QualifiedNameProvider {
  return {
    id: BUILTIN_QUALIFIED_NAME_ID,
    getQualifiedName: subject => subject.currentName ? `${stripExtension(subject.path)}#${subject.currentName}` : stripExtension(subject.path),
  }
}

/** 来自源根的路径（`src/copyPathActions.ts` 的 `sourceRootPathText` 同源）。 */
export function builtinFileQualifiedNameProvider(): VirtualFileQualifiedNameProvider {
  return {
    id: BUILTIN_FILE_QUALIFIED_NAME_ID,
    getQualifiedName(path, root) {
      const normalizedRoot = root.replace(/[\\/]+$/, '')
      const normalized = path.replace(/\\/g, '/')
      const prefix = normalizedRoot.replace(/\\/g, '/') + '/'
      return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized
    },
  }
}

function splitNameWords(name: string): string[] {
  if (!name) return []
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-./\\]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function capitalize(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word
}

function stripExtension(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const base = path.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? path.slice(0, slash + 1) + base.slice(0, dot) : path
}

/**
 * 把本仓内建的四条作为 bundled 贡献挂上（返回注销句柄）。宿主在拿到语言关键字表之后调一次即可；
 * 重复调用只覆盖同 id 的旧贡献。`src/semanticActions.ts` 的 `invalidRenameName` computed 可改为
 * 走 `validateRenameInput(...)`，从而把「按 id 挂进来的第三方校验器」一并纳入。
 */
export function registerBundledRefactorRenameContributions(
  languageKeywords: (language: string) => readonly string[],
  options: RegisterExtensionOptions = {},
): () => void {
  const bundled: RegisterExtensionOptions = { source: 'bundled', ...options }
  const handles = [
    registerRenameInputValidator(builtinRenameInputValidator(languageKeywords), bundled),
    registerNameSuggestionProvider(builtinNameSuggestionProvider(), bundled),
    registerQualifiedNameProvider(builtinQualifiedNameProvider(), bundled),
    registerVirtualFileQualifiedNameProvider(builtinFileQualifiedNameProvider(), bundled),
  ]
  return () => { for (const handle of handles) handle.dispose() }
}
