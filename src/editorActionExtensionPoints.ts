// **lp/editor-actions 域的扩展点宿主接线** —— 把「字符输入 / 括号配对 / 回车 / 退格」这几族
// 上游本来就是 EP 的接口，按 `src/extensionPoints.ts` 的 `EXTENSIONS` 宿主登记出来，并给出与
// 上游**同名的方法面**（于是按上游接口写的第三方插件能原样挂进来、并在本仓被消费）。
//
// 与 `src/daemonExtensionPoints.ts` / `src/ideViewExtensionPoints.ts` 同一形状：
// 「EP 声明 + 注册/注销 + 消费方从注册表取 + bundled 默认贡献者」。
//
// 上游依据（qualifiedName **逐字**取自各 plugin.xml 的 `<extensionPoint>` 声明；本文件不发明 id）：
//   · `com.intellij.typedHandler` —— `platform/lang-api/resources/intellij.platform.lang.xml:231`
//     （`interface="com.intellij.codeInsight.editorActions.TypedHandlerDelegate"` dynamic="true"）；
//     抽象类 `platform/lang-api/src/com/intellij/codeInsight/editorActions/TypedHandlerDelegate.java:21`
//     （`EP_NAME` 在 `:22`）；方法面 `checkAutoPopup`（`:32`）/`beforeSelectionRemoved`（`:41`）/
//     `newTypingStarted`（`:50`）/`beforeCharTyped`（`:57`）/`charTyped`（`:65`）/
//     `beforeClosingParenInserted`（`:75`）/`beforeClosingQuoteInserted`（`:85`）/
//     `isImmediatePaintingEnabled`（`:89`）；返回档 `Result`（`:93`）= `STOP / CONTINUE / DEFAULT`。
//   · `com.intellij.braceMatcher` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:141`
//     （`beanClass="com.intellij.openapi.fileTypes.FileTypeExtensionPoint"`，**按 fileType**）；
//     接口 `platform/lang-impl/src/com/intellij/codeInsight/highlighting/BraceMatcher.java:35`
//     （`EP_NAME` 在 `:36`）；方法面 `getBraceTokenGroupId`（`:37`）/`isLBraceToken`（`:38`）/
//     `isRBraceToken`（`:39`）/`isPairBraces`（`:40`）/`isStructuralBrace`（`:41`）/
//     `getOppositeBraceTokenType`（`:42`）/`isPairedBracesAllowedBeforeType`（`:43`）/
//     `getCodeConstructStart`（`:50`）。
//   · `com.intellij.lang.braceMatcher` —— `platform/analysis-api/resources/intellij.platform.analysis.xml:36`
//     （`beanClass="com.intellij.lang.LanguageExtensionPoint"`，`with attribute="implementationClass"
//     implements="com.intellij.lang.PairedBraceMatcher"`，**按 language**）；接口
//     `platform/analysis-api/src/com/intellij/lang/PairedBraceMatcher.java:20`；方法面
//     `getPairs`（`:27`）/`isPairedBracesAllowedBeforeType`（`:39`）/`getCodeConstructStart`（`:47`）。
//   · `com.intellij.enterHandlerDelegate` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:399`
//     （`interface="com.intellij.codeInsight.editorActions.enter.EnterHandlerDelegate"` dynamic="true"）；
//     接口 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterHandlerDelegate.java:17`
//     （`EP_NAME` 在 `:18`）；方法面 `Result`（`:25`）= `Default / Continue / DefaultForceIndent /
//     DefaultSkipIndent / Stop`、`invokeInsideIndent`（`:41`）、`preprocessEnter`、`postProcessEnter`。
//     **如实差异**：协调单里写的 `com.intellij.enterHandler` 在上游**不是 EP**（零命中）—— 真名是这条
//     `enterHandlerDelegate`（本仓 `src/enterHandlerOrder.ts` 文件头第 11-13 行也按真名核对过），故按真名落。
//   · `com.intellij.backspaceHandlerDelegate` —— `platform/lang-api/resources/intellij.platform.lang.xml:233`
//     （`interface="com.intellij.codeInsight.editorActions.BackspaceHandlerDelegate"` dynamic="true"）；
//     抽象类 `platform/lang-api/src/com/intellij/codeInsight/editorActions/BackspaceHandlerDelegate.java:16`
//     （`EP_NAME` 在 `:17-18`）；方法面 `beforeCharDeleted`（`:23`）/`charDeleted`（`:33`，返回 true 表示
//     不再做后续处理，例如配对括号/引号的联动删除）。
//
// 本仓此前：这几支各有私有实现 —— 字符输入链在 `src/editorTyping.ts`（引号配对 + 逐语言注册表
// 在 `src/quoteHandlerRegistry.ts`）、括号高亮在 `src/editorBrackets.ts`、配对导航在
// `src/editorMatchBrace.ts`、回车的次序表在 `src/enterHandlerOrder.ts` + `src/enterHandlers.ts` ——
// 但**没有一条能被第三方按 id 挂进去**（`com.intellij.quoteHandler` 那两条已由
// `src/extensionPoints.ts` 声明、`src/quoteHandlerRegistry.ts` 消费，见那里的注释）。本文件补上那一层：
// EP 声明 + 与上游同名的方法面 + consume 函数；内建的几支在各自消费侧作为 bundled 贡献登记。
//
// 与上游的如实差异：① 本仓没有 PSI / `IElementType` / `HighlighterIterator`，括号用**字符**表示
// （`'('` / `')'`…），`isLBraceToken`/`isRBraceToken` 收成「这个字符是不是这一档的左右括号」；
// ② `Editor`/`Project`/`DataContext` 收成可判定的输入形状（路径 + 语言 + 文本 + 行/列 + 字符）；
// ③ `preprocessEnter` 的 `Ref` 出参换成「返回档 + 宿主可读的改动建议」（本仓的落地在
// `src/enterHandlers.ts` 的既有表，EP 委托只决定「要不要让给默认回车 / 停在哪里」）。
//
// 纯数据层：只 import `src/extensionPoints.ts`（不 import vue/DOM/bridge），便于 `node --test` 直测。
//
// 判据：`tests/editor-action-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** 五条 EP 的 id（逐字取自上游 qualifiedName / EP_NAME，见文件头）。 */
export const TYPED_HANDLER_EP = 'com.intellij.typedHandler'
export const BRACE_MATCHER_EP = 'com.intellij.braceMatcher'
export const LANGUAGE_BRACE_MATCHER_EP = 'com.intellij.lang.braceMatcher'
export const ENTER_HANDLER_DELEGATE_EP = 'com.intellij.enterHandlerDelegate'
export const BACKSPACE_HANDLER_DELEGATE_EP = 'com.intellij.backspaceHandlerDelegate'

// ── ① 字符输入：`TypedHandlerDelegate`（`com.intellij.typedHandler`） ─────────────────────────

/** 上游 `TypedHandlerDelegate.Result`（`TypedHandlerDelegate.java:93`），三个值逐字。 */
export type TypedHandlerResult = 'STOP' | 'CONTINUE' | 'DEFAULT'

/** 一次「字符敲入」的上下文（上游 `checkAutoPopup`/`charTyped` 那几个入参的可移植替代）。 */
export interface TypedCharInput {
  /** 工作区相对路径。 */
  path: string
  /** 编辑器语言 id（本仓的四档 `java`/`cpp`/`typescript`/`other`）。 */
  language: string
  /** 文件类型名（上游的 `FileType`；缺省由语言折出，见 `fileTypeOfLanguage`）。 */
  fileType?: string
  /** 敲入之后（或之前，见各问法注释）的文档全文。 */
  text: string
  /** 光标行列（0 基）；`character` 是行内偏移。 */
  line: number
  character: number
  /** 被敲入的那个字符。 */
  char: string
}

/**
 * 一条字符输入委托（`TypedHandlerDelegate` 的方法面，名字与上游逐字相同）。
 * 方法都可缺省 —— 不实现的那几问在派发时当作 `CONTINUE`（上游基类的缺省实现就是 `CONTINUE`）。
 */
export interface TypedHandlerDelegateContribution {
  id: string
  /** 语言限定（空/缺省 = 任意语言，照 `LanguageExtension` 的 any 档）。 */
  languages?: readonly string[]
  /** `checkAutoPopup(char, project, editor, file)` —— 要不要自动弹出补全。 */
  checkAutoPopup?: (input: TypedCharInput) => TypedHandlerResult
  /** `beforeSelectionRemoved(char, project, editor, file)`。 */
  beforeSelectionRemoved?: (input: TypedCharInput) => TypedHandlerResult
  /** `newTypingStarted(char, editor, context)` —— 一次新的输入开始（无返回）。 */
  newTypingStarted?: (input: TypedCharInput) => void
  /** `beforeCharTyped(char, project, editor, file, fileType)`。 */
  beforeCharTyped?: (input: TypedCharInput) => TypedHandlerResult
  /** `charTyped(char, project, editor, file)`。 */
  charTyped?: (input: TypedCharInput) => TypedHandlerResult
  /** `beforeClosingParenInserted(char, project, editor, file)`。 */
  beforeClosingParenInserted?: (input: TypedCharInput) => TypedHandlerResult
  /** `beforeClosingQuoteInserted(quote, project, editor, file)`（本仓 `quote` = `input.char`）。 */
  beforeClosingQuoteInserted?: (input: TypedCharInput) => TypedHandlerResult
  /** `isImmediatePaintingEnabled(editor, c, context)`。 */
  isImmediatePaintingEnabled?: (input: TypedCharInput) => boolean
}

/** 语言 → 上游 fileType 名的粗映射（本仓只有四档语言）。 */
export function fileTypeOfLanguage(language: string | undefined): string {
  switch (language) {
    case 'java': return 'JAVA'
    case 'cpp': return 'CPLUSPLUS'
    case 'typescript': return 'TypeScript'
    default: return 'PLAIN_TEXT'
  }
}

/** 一次派发里被问到的某个问法（票面名，便于诊断）。 */
export type TypedHandlerPhase =
  | 'checkAutoPopup' | 'beforeSelectionRemoved' | 'newTypingStarted' | 'beforeCharTyped'
  | 'charTyped' | 'beforeClosingParenInserted' | 'beforeClosingQuoteInserted'

/** `TypedHandlerDelegate.EP_NAME.getExtensions()` 的等价物（按语言过滤）。 */
export function typedHandlerDelegates(language: string, scope: string = APPLICATION_SCOPE): TypedHandlerDelegateContribution[] {
  return EXTENSIONS.extensionsOf<TypedHandlerDelegateContribution>(TYPED_HANDLER_EP, scope)
    .filter(delegate => !delegate.languages || delegate.languages.length === 0 || delegate.languages.includes(language))
}

/**
 * `TypedHandler.execute` 那个循环的等价物：按注册序逐个问 `phase` 那一问，
 * **第一个非 `CONTINUE`** 的档位说了算（`STOP` ⇒ 这个键到此为止，`DEFAULT` ⇒ 让给默认处理）。
 * 没有委托时返回 `DEFAULT`（不因为有 EP 就改变原有行为）。
 */
export function dispatchTypedHandler(
  input: TypedCharInput, phase: TypedHandlerPhase, scope: string = APPLICATION_SCOPE,
): TypedHandlerResult {
  for (const delegate of typedHandlerDelegates(input.language, scope)) {
    const handler = delegate[phase]
    if (typeof handler !== 'function') continue
    let result: TypedHandlerResult = 'CONTINUE'
    try {
      const raw = (handler as (value: TypedCharInput) => TypedHandlerResult | void)(input)
      if (raw === 'STOP' || raw === 'DEFAULT' || raw === 'CONTINUE') result = raw
    } catch {
      // 第三方委托抛错不能吃掉这次输入：当作 CONTINUE 继续问下一支。
      continue
    }
    if (result !== 'CONTINUE') return result
  }
  return 'DEFAULT'
}

/** `newTypingStarted` 那一支（无返回，逐个通知，坏委托跳过）。 */
export function notifyTypingStarted(input: TypedCharInput, scope: string = APPLICATION_SCOPE): number {
  let notified = 0
  for (const delegate of typedHandlerDelegates(input.language, scope)) {
    if (typeof delegate.newTypingStarted !== 'function') continue
    try { delegate.newTypingStarted(input); notified += 1 } catch { /* 坏委托跳过。 */ }
  }
  return notified
}

/** `isImmediatePaintingEnabled`：任一为真即真（缺省 false）。 */
export function immediatePaintingEnabled(input: TypedCharInput, scope: string = APPLICATION_SCOPE): boolean {
  for (const delegate of typedHandlerDelegates(input.language, scope)) {
    if (typeof delegate.isImmediatePaintingEnabled !== 'function') continue
    try { if (delegate.isImmediatePaintingEnabled(input)) return true } catch { /* 坏委托跳过。 */ }
  }
  return false
}

// ── ② 括号配对：`BraceMatcher`（fileType）+ `PairedBraceMatcher`（language） ────────────────

/** 一对括号（上游 `BracePair` 的可移植形状；字符而不是 token）。 */
export interface BracePairLike {
  leftBrace: string
  rightBrace: string
  /** 上游 `BracePair.isStructural()`。 */
  structural: boolean
}

/** 判 `isLBraceToken`/`isRBraceToken` 的上下文（上游 `HighlighterIterator` + `fileText` + `FileType`）。 */
export interface BraceTokenContext {
  /** 全文字本。 */
  text: string
  /** 这个 token 的下标。 */
  offset: number
  /** 语言 / 文件类型名（便于委托自己分流）。 */
  language: string
  fileType: string
}

/** 一条 `BraceMatcher`（fileType-keyed，方法名与上游逐字相同）。 */
export interface BraceMatcherContribution {
  id: string
  /** fileType 限定（空/缺省 = 任意文件类型；上游 bean 的 `fileType` 属性）。 */
  fileType?: string
  getBraceTokenGroupId?: (token: string) => number
  isLBraceToken: (token: string, context: BraceTokenContext) => boolean
  isRBraceToken: (token: string, context: BraceTokenContext) => boolean
  getPairs: () => readonly BracePairLike[]
  isPairBraces?: (left: string, right: string) => boolean
  isStructuralBrace?: (token: string, context: BraceTokenContext) => boolean
  getOppositeBraceTokenType?: (token: string) => string | null
  isPairedBracesAllowedBeforeType?: (leftBrace: string, contextType: string | null) => boolean
  getCodeConstructStart?: (input: { path: string; text: string }, openingBraceOffset: number) => number
}

/** 一条 `PairedBraceMatcher`（language-keyed，方法名与上游逐字相同）。 */
export interface PairedBraceMatcherContribution {
  id: string
  /** 语言限定（空/缺省 = 任意语言；上游 `LanguageExtensionPoint` 的 `language` 属性）。 */
  language?: string
  getPairs: () => readonly BracePairLike[]
  isPairedBracesAllowedBeforeType?: (leftBrace: string, contextType: string | null) => boolean
  getCodeConstructStart?: (input: { path: string; text: string }, openingBraceOffset: number) => number
}

/** `BraceMatcher.EP_NAME` 按文件类型取（本仓按 fileType 名精确匹配；空 fileType 通吃）。 */
export function braceMatchersFor(fileType: string, scope: string = APPLICATION_SCOPE): BraceMatcherContribution[] {
  const upper = fileType.toUpperCase()
  return EXTENSIONS.extensionsOf<BraceMatcherContribution>(BRACE_MATCHER_EP, scope)
    .filter(matcher => !matcher.fileType || matcher.fileType.toUpperCase() === upper)
}

/** `PairedBraceMatcher` 那条 EP 按语言取（空 language 通吃）。 */
export function pairedBraceMatchersFor(language: string, scope: string = APPLICATION_SCOPE): PairedBraceMatcherContribution[] {
  return EXTENSIONS.extensionsOf<PairedBraceMatcherContribution>(LANGUAGE_BRACE_MATCHER_EP, scope)
    .filter(matcher => !matcher.language || matcher.language === language)
}

/**
 * 这门语言 / 这个文件类型下登记的全部括号对（两条 EP 合起来，去重）。
 * 消费方：`src/editorBrackets.ts` 的 `hasAngleBraces`（`<>` 那一档）与
 * `src/editorMatchBrace.ts` 的额外括号对。没有贡献时返回空数组 ⇒ 本仓既有行为零改动。
 */
export function bracePairsFor(
  input: { language?: string; fileType?: string }, scope: string = APPLICATION_SCOPE,
): BracePairLike[] {
  const fileType = input.fileType ?? fileTypeOfLanguage(input.language)
  const out: BracePairLike[] = []
  const seen = new Set<string>()
  const push = (pair: BracePairLike) => {
    if (!pair?.leftBrace || !pair.rightBrace) return
    const key = `${pair.leftBrace}\u0000${pair.rightBrace}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(pair)
  }
  for (const matcher of braceMatchersFor(fileType, scope)) {
    try { for (const pair of matcher.getPairs()) push(pair) } catch { /* 坏委托跳过。 */ }
  }
  if (input.language !== undefined) {
    for (const matcher of pairedBraceMatchersFor(input.language, scope)) {
      try { for (const pair of matcher.getPairs()) push(pair) } catch { /* 坏委托跳过。 */ }
    }
  }
  return out
}

/** 登记的括号对里有没有「左右分别是这两个字符」这一对（`isPairBraces` 的合并版）。 */
export function isRegisteredBracePair(
  left: string, right: string, input: { language?: string; fileType?: string }, scope: string = APPLICATION_SCOPE,
): boolean {
  return bracePairsFor(input, scope).some(pair => pair.leftBrace === left && pair.rightBrace === right)
}

// ── ③ 回车：`EnterHandlerDelegate`（`com.intellij.enterHandlerDelegate`） ─────────────────────

/** 上游 `EnterHandlerDelegate.Result`（`EnterHandlerDelegate.java:25`），五个值逐字。 */
export type EnterDelegateResult = 'Default' | 'Continue' | 'DefaultForceIndent' | 'DefaultSkipIndent' | 'Stop'

/** 一次回车上下文（上游 `preprocessEnter(PsiFile, Editor, Ref caretOffset, Ref caretAdvance, DataContext, handler)` 的可移植替代）。 */
export interface EnterInput {
  path: string
  language: string
  /** 回车**之前**的文档全文。 */
  text: string
  /** 光标绝对偏移（`caretOffset`，上游可改；本仓委托返回值里给 `caretOffsetDelta`）。 */
  offset: number
  /** 0 基行号。 */
  line: number
  /** 行内偏移。 */
  character: number
}

/** 一条回车委托（`EnterHandlerDelegate` 的方法面，名字与上游逐字相同）。 */
export interface EnterHandlerDelegateContribution {
  id: string
  languages?: readonly string[]
  /** `preprocessEnter(...)` —— 返回档位；`caretOffsetDelta`/`caretAdvance` 是本仓给出的两个可改量。 */
  preprocessEnter: (input: EnterInput) => { result: EnterDelegateResult; caretOffsetDelta?: number; caretAdvance?: number }
  /** `postProcessEnter(file, editor, dataContext)` —— 换行之后通知（无返回）。 */
  postProcessEnter?: (input: EnterInput) => void
  /** `invokeInsideIndent(newLineCharOffset, editor, dataContext)`（缺省 false）。 */
  invokeInsideIndent?: (input: EnterInput) => boolean
}

/** `EnterHandlerDelegate.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function enterHandlerDelegates(language: string, scope: string = APPLICATION_SCOPE): EnterHandlerDelegateContribution[] {
  return EXTENSIONS.extensionsOf<EnterHandlerDelegateContribution>(ENTER_HANDLER_DELEGATE_EP, scope)
    .filter(delegate => !delegate.languages || delegate.languages.length === 0 || delegate.languages.includes(language))
}

/** 一条被命中的回车委托 + 它给的档与两个可改量。 */
export interface EnterDelegateHit {
  delegate: EnterHandlerDelegateContribution
  result: EnterDelegateResult
  caretOffsetDelta: number
  caretAdvance: number
}

/**
 * `EnterHandler.java:136-153` 那个循环的 EP 版：按注册序逐个问 `preprocessEnter`，
 * **第一个非 `Continue` 的档**说了算（`Stop` 表示连原 handler 都不跑）；都不接管返回 null。
 */
export function dispatchEnterDelegate(input: EnterInput, scope: string = APPLICATION_SCOPE): EnterDelegateHit | null {
  for (const delegate of enterHandlerDelegates(input.language, scope)) {
    let outcome: { result: EnterDelegateResult; caretOffsetDelta?: number; caretAdvance?: number }
    try {
      outcome = delegate.preprocessEnter(input)
    } catch {
      // 坏委托当作 Continue，问下一支。
      continue
    }
    if (!outcome || outcome.result === 'Continue') continue
    return {
      delegate,
      result: outcome.result,
      caretOffsetDelta: outcome.caretOffsetDelta ?? 0,
      caretAdvance: outcome.caretAdvance ?? 0,
    }
  }
  return null
}

/** 换行之后逐个通知（`postProcessEnter`；坏委托跳过）。 */
export function notifyEnterPostProcess(input: EnterInput, scope: string = APPLICATION_SCOPE): number {
  let notified = 0
  for (const delegate of enterHandlerDelegates(input.language, scope)) {
    if (typeof delegate.postProcessEnter !== 'function') continue
    try { delegate.postProcessEnter(input); notified += 1 } catch { /* 坏委托跳过。 */ }
  }
  return notified
}

// ── ④ 退格：`BackspaceHandlerDelegate`（`com.intellij.backspaceHandlerDelegate`） ─────────────

/** 一次退格上下文（上游 `beforeCharDeleted`/`charDeleted` 的 `(char, PsiFile, Editor)` 的可移植替代）。 */
export interface BackspaceInput {
  path: string
  language: string
  /** 退格**之前**的文档全文。 */
  text: string
  /** 光标绝对偏移（将被删掉的字符在 `offset - 1`）。 */
  offset: number
  line: number
  character: number
  /** 即将被删掉的那个字符。 */
  char: string
}

/** 一条退格委托（`BackspaceHandlerDelegate` 的方法面，名字与上游逐字相同）。 */
export interface BackspaceHandlerDelegateContribution {
  id: string
  languages?: readonly string[]
  /** `beforeCharDeleted(char, file, editor)` —— 默认删字符之前。 */
  beforeCharDeleted?: (input: BackspaceInput) => void
  /** `charDeleted(char, file, editor)` —— 返回 true 表示不再做后续处理（配对联动等）。 */
  charDeleted: (input: BackspaceInput) => boolean
}

/** `BackspaceHandlerDelegate.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function backspaceHandlerDelegates(language: string, scope: string = APPLICATION_SCOPE): BackspaceHandlerDelegateContribution[] {
  return EXTENSIONS.extensionsOf<BackspaceHandlerDelegateContribution>(BACKSPACE_HANDLER_DELEGATE_EP, scope)
    .filter(delegate => !delegate.languages || delegate.languages.length === 0 || delegate.languages.includes(language))
}

/** 默认删字符之前逐个通知（`beforeCharDeleted`；坏委托跳过）。 */
export function dispatchBackspaceBefore(input: BackspaceInput, scope: string = APPLICATION_SCOPE): number {
  let notified = 0
  for (const delegate of backspaceHandlerDelegates(input.language, scope)) {
    if (typeof delegate.beforeCharDeleted !== 'function') continue
    try { delegate.beforeCharDeleted(input); notified += 1 } catch { /* 坏委托跳过。 */ }
  }
  return notified
}

/**
 * `charDeleted` 的合并版：**任一**为真即真（上游任一委托返回 true 就跳过后续处理）。
 * 没有委托时返回 false（不接管退格）。
 */
export function dispatchBackspaceAfter(input: BackspaceInput, scope: string = APPLICATION_SCOPE): boolean {
  for (const delegate of backspaceHandlerDelegates(input.language, scope)) {
    try { if (delegate.charDeleted(input)) return true } catch { /* 坏委托跳过。 */ }
  }
  return false
}

// ── EP 声明 / 注册 / 注销 ─────────────────────────────────────────────────────────────────

/** 五条 EP 的声明（幂等：重复调用只覆盖同名声明）。 */
export function declareEditorActionExtensionPoints(): void {
  for (const [id, name] of [
    [TYPED_HANDLER_EP, '字符输入委托'],
    [BRACE_MATCHER_EP, '括号配对器（按文件类型）'],
    [LANGUAGE_BRACE_MATCHER_EP, '括号配对器（按语言）'],
    [ENTER_HANDLER_DELEGATE_EP, '回车委托'],
    [BACKSPACE_HANDLER_DELEGATE_EP, '退格委托'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareEditorActionExtensionPoints()

/** 按 id 注册一条贡献（同 id 覆盖，与宿主同口径）。 */
export function registerEditorActionExtension<T>(
  extensionPoint: string, id: string, value: T, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(extensionPoint, id, value, options)
}

/** 注销一条贡献（返回是否真的删掉了）。 */
export function unregisterEditorActionExtension(extensionPoint: string, id: string): boolean {
  return EXTENSIONS.unregisterExtension(extensionPoint, id)
}

// ── bundled：把本仓在跑的几支作为默认贡献登记进来（消费侧调用，重复调用只覆盖同 id）──────────

/** 本仓内建的文件类型括号对（`()[]{}` 三对；`()[]{}` 是 CodeMirror `bracketMatching` 的固定集合）。 */
export const BUNDLED_FILE_TYPE_BRACE_MATCHER_ID = 'taocode.braceMatcher.fileType.builtin'
/** 本仓内建的 Java 尖括号对（`<>`；`src/editorBrackets.ts` 的 `LANGUAGE_ANGLE_BRACES` 同源）。 */
export const BUNDLED_LANGUAGE_BRACE_MATCHER_ID = 'taocode.braceMatcher.language.java'
/** 本仓内建的字符输入委托（passthrough：本仓的输入行为在 `src/editorTyping.ts`，见文件尾说明）。 */
export const BUNDLED_TYPED_HANDLER_ID = 'taocode.typedHandler.bundled'
/** 本仓内建的回车委托（passthrough：本仓的回车行为在 `src/enterHandlerOrder.ts` 的表）。 */
export const BUNDLED_ENTER_HANDLER_ID = 'taocode.enterHandlerDelegate.bundled'
/** 本仓内建的退格委托（passthrough：本仓退格走 CodeMirror 默认）。 */
export const BUNDLED_BACKSPACE_HANDLER_ID = 'taocode.backspaceHandlerDelegate.bundled'

/** 内建：文件类型括号对 `()[]{}`（上游 `<braceMatcher fileType=…>` 的等价物）。 */
export function builtinFileTypeBraceMatcher(): BraceMatcherContribution {
  const pairs: readonly BracePairLike[] = [
    { leftBrace: '(', rightBrace: ')', structural: true },
    { leftBrace: '[', rightBrace: ']', structural: true },
    { leftBrace: '{', rightBrace: '}', structural: true },
  ]
  const isLeft = (token: string) => pairs.some(pair => pair.leftBrace === token)
  const isRight = (token: string) => pairs.some(pair => pair.rightBrace === token)
  return {
    id: BUNDLED_FILE_TYPE_BRACE_MATCHER_ID,
    getBraceTokenGroupId: token => isLeft(token) ? 0 : isRight(token) ? 1 : -1,
    isLBraceToken: token => isLeft(token),
    isRBraceToken: token => isRight(token),
    getPairs: () => pairs,
    isPairBraces: (left, right) => pairs.some(pair => pair.leftBrace === left && pair.rightBrace === right),
    isStructuralBrace: token => isLeft(token) || isRight(token),
    getOppositeBraceTokenType: token => {
      const left = pairs.find(pair => pair.leftBrace === token)
      if (left) return left.rightBrace
      const right = pairs.find(pair => pair.rightBrace === token)
      return right ? right.leftBrace : null
    },
    isPairedBracesAllowedBeforeType: () => true,
  }
}

/** 内建：Java 的尖括号对 `<>`（`src/editorBrackets.ts:161` 的静态表搬到这里当默认贡献）。 */
export function builtinJavaAngleBraceMatcher(): PairedBraceMatcherContribution {
  const pairs: readonly BracePairLike[] = [
    { leftBrace: '(', rightBrace: ')', structural: true },
    { leftBrace: '[', rightBrace: ']', structural: true },
    { leftBrace: '{', rightBrace: '}', structural: true },
    { leftBrace: '<', rightBrace: '>', structural: false },
  ]
  return {
    id: BUNDLED_LANGUAGE_BRACE_MATCHER_ID,
    language: 'java',
    getPairs: () => pairs,
    isPairedBracesAllowedBeforeType: () => true,
  }
}

/** 内建：字符输入委托 —— 本仓的输入链（引号配对）在 `src/editorTyping.ts` 里，这里给一个
 *  passthrough 贡献，保证 EP 里有一条 bundled 项、且第三方委托能排在它前面或后面。 */
export function builtinTypedHandlerDelegate(): TypedHandlerDelegateContribution {
  return {
    id: BUNDLED_TYPED_HANDLER_ID,
    charTyped: () => 'CONTINUE',
    checkAutoPopup: () => 'CONTINUE',
  }
}

/** 内建：回车委托 —— 本仓的回车次序表在 `src/enterHandlerOrder.ts`，这里给 passthrough。 */
export function builtinEnterHandlerDelegate(): EnterHandlerDelegateContribution {
  return {
    id: BUNDLED_ENTER_HANDLER_ID,
    preprocessEnter: () => ({ result: 'Continue' }),
  }
}

/** 内建：退格委托 —— 本仓退格走 CodeMirror 默认，这里给 passthrough（不接管）。 */
export function builtinBackspaceHandlerDelegate(): BackspaceHandlerDelegateContribution {
  return {
    id: BUNDLED_BACKSPACE_HANDLER_ID,
    charDeleted: () => false,
  }
}

/** 注册一条字符输入委托（缺省 bundled）。 */
export function registerTypedHandlerDelegate(
  contribution: TypedHandlerDelegateContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtension(TYPED_HANDLER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条文件类型括号配对器（缺省 bundled）。 */
export function registerBraceMatcher(
  contribution: BraceMatcherContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtension(BRACE_MATCHER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条语言括号配对器（缺省 bundled）。 */
export function registerPairedBraceMatcher(
  contribution: PairedBraceMatcherContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtension(LANGUAGE_BRACE_MATCHER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条回车委托（缺省 bundled）。 */
export function registerEnterHandlerDelegate(
  contribution: EnterHandlerDelegateContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtension(ENTER_HANDLER_DELEGATE_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条退格委托（缺省 bundled）。 */
export function registerBackspaceHandlerDelegate(
  contribution: BackspaceHandlerDelegateContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerEditorActionExtension(BACKSPACE_HANDLER_DELEGATE_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/**
 * 登记本仓在跑的那几支默认贡献（幂等：同 id 覆盖）。
 * 内建括号对与上游 `<braceMatcher>` / `<lang.braceMatcher>` 的默认注册一一对应；
 * 字符输入 / 回车 / 退格三支是 passthrough（本仓的实际行为在各消费点，见各自的函数注释）。
 */
export function registerBundledEditorActionDefaults(): void {
  registerBraceMatcher(builtinFileTypeBraceMatcher())
  registerPairedBraceMatcher(builtinJavaAngleBraceMatcher())
  registerTypedHandlerDelegate(builtinTypedHandlerDelegate())
  registerEnterHandlerDelegate(builtinEnterHandlerDelegate())
  registerBackspaceHandlerDelegate(builtinBackspaceHandlerDelegate())
}

registerBundledEditorActionDefaults()
