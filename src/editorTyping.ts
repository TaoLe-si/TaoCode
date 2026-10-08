// 编辑器输入链路的**引号**那一半（`lp/editor-actions` 判决缺项 ①：逐语言 `QuoteHandler` 扩展点）。
//
// 上游这一族是**按语言注册**的扩展点，不是一个通用规则：
//   · EP 声明 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:405`
//     （`com.intellij.quoteHandler`，beanClass = `QuoteHandlerEP`）与 `:408`
//     （`com.intellij.lang.quoteHandler`，按语言的版本）；注册面本体
//     `platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandlerEP.java:16-27`
//     （按 `fileType` 取一份 handler，EP 名在 `:18`）。
//   · 接口的四个问法就是下面四条规则的出处
//     （`platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandler.java`；
//     **订正**：这一族的旧注释写的是 `:26-35`/`:37-56`/`:58`，2026-10-06 逐行核对后的真实行号在下面）：
//       `isClosingQuote`（`:40`，接口声明在 `:28`）—— 输入引号**之前**先问「光标是不是正落在一个收尾引号上」，
//         是就只挪光标不再插一个（本仓的 `skip`）；
//       `isOpeningQuote`（`:49`）+ `hasNonClosedLiteral`（`:64`）—— 两者都成立才自动补上配对引号
//         （本仓的 `pair`）；`:51-57` 的类注释写明 `hasNonClosedLiteral` 是**插入之后**才问的；
//       `isInsideLiteral`（`:66`）—— 已经在字面量里面 ⇒ 就按普通字符插（本仓的 `plain`）；
//   · 开关是 `CodeInsightSettings.AUTOINSERT_PAIR_QUOTE`（同一文件 `:10-20` 的类注释），
//     上游一共三处问它：`TypedQuoteImpl.java:66-68`（**关掉就整条不接管** ⇒ 既不补配对、也不跳过收尾引号，
//     敲进去的就是一个普通字符）、`SelectionQuotingTypedHandler.java:35`（选区正好是一个引号时的替换那一支）、
//     `BackspaceHandler.java:135`（退格把 auto-insert 的那一对一起删掉 —— 那一半在退格家族，不在本模块）。
//     **订正（2026-10-06）**：这里原先写「本仓编辑器设置里没有这一条对应项 ⇒ 记在做不到栏」——
//     实际是**有键**（`src/settingsModel.ts:427`，默认 true = 上游 `CodeInsightSettings.java:140`）
//     **有界面**（`src/components/EditorEnterKeysFields.vue:29`）**没有消费方**，正是派单第 3 节禁的假控件。
//     本批把消费方接在本模块的 `smartQuotes` 上（开关关掉 ⇒ `skip`/`pair`/face 那三档都不接管、
//     `wrap` 仍接管，理由见下一条）。宿主那一行已经在编辑器里传了 `props.settings.autoInsertPairQuote`
//     （`src/components/CodeEditor.vue:966`，接线请求 W-1 已闭环）。**注意**：不能只靠「不挂 smartQuotes」实现这条开关 ——
//     本仓挂着 `basicSetup`（`src/components/CodeEditor.vue:3`），它自带 `closeBrackets`，摘掉本模块
//     反而会退回 CodeMirror 那套固定字符集的配对）。
//     **订正（2026-10-06 · editact，判决第②条）**：上面那句「不接管」当时只做到了一半。
//     键位 `return false` 只是把这次输入**让给** `basicSetup`，而 `closeBrackets()` 不是键位而是
//     `EditorView.inputHandler`（`node_modules/codemirror/dist/index.js:61` 把它带进 basicSetup、
//     `node_modules/@codemirror/autocomplete/dist/index.js:1830-1832` = `[inputHandler, bracketState]`、
//     `inputHandler`（`:1844-1856`）对任何用户输入调 `insertBracket`（`:1851`）、`:1795` 的 `defaults.brackets` 含 `"`、
//     `:1990-1994` 的 `handleSame` 补出 `""`）⇒ 关掉开关后用户在 Java 文件里敲 `"` **仍然**得到一对，
//     那一格设置当时仍然观察不到差别。现在 `runQuoteKey` 在关掉时自己把那个普通字符落下去并**吃掉键**
//     （与上游 `TypedQuoteImpl.java:66-68` 之后走 `TypedCharImpl` 普通输入同解）；
//     判据 `tests/editor-enter-switches.test.mjs`（含「放行给 CodeMirror 就会补一对」那条实测前提，
//     所以把实现改回 `return false` 会当场变红）。
//   · 「有选区时用引号把选区包住」是**另一个**开关：`SURROUND_SELECTION_ON_QUOTE_TYPED`
//     （`SelectionQuotingTypedHandler.java:47`，默认 true 在 `CodeInsightSettings.java:137`）。
//     本仓 `EditorSettings` 里没有这一条 ⇒ 不做假设置，`wrap` 那一档恒开（与上游默认一致），如实记在报告里。
//   · 多字符引号（Java 文本块 `"""`）不在这里判：那一档的三个动作（跳过收尾、敲完开引号补配对、
//     光标停位）在 `src/editorQuoteFaces.ts`；`JavaQuoteHandler.java:31` 实现 `MultiCharQuoteHandler`
//     （订正：旧注释写的 `:36` 是别处），`:42-56` 还会挡掉「前一个 token 是字符串转义」那一支 ——
//     本仓用「前面反斜杠是奇数个」近似同一条。
//   · 按语言的注册表：Java 那一条在
//     `java/java-frontback-impl/resource/intellij.java.frontback.impl.xml:74`
//     （`quoteHandler fileType="JAVA" className="…JavaQuoteHandler"`）。
//     C/C++ 与 TS/JS 的 handler 不在社区树里（CLion / 商业 JS 插件）⇒ **无法核实**，表里就不给它们
//     引号规则，那两种语言继续由 CodeMirror 的 `closeBrackets`（固定字符集）承担。
//
// 「有选区时打字把选区包住」对应 `QuoteHandlerEP`/`TypedHandler` 一侧的 `surroundWithQuotes`
// （CodeMirror 的 closeBrackets 也是这么做的），本仓在自己的表里做同一件事，
// 于是**哪些引号参与配对由语言决定**，不再是 CodeMirror 那个固定集合。
//
// 另一半（`insertedText`，文件末尾）是宏录制用的文本提取，与本模块的引号规则无关，保持原样。
import { EditorSelection, EditorState, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { EditorView, ViewUpdate } from '@codemirror/view'
import { FACE_CARET_ADVANCE, faceAction, faceInsertion } from './editorQuoteFaces.ts'
// 「哪门语言注册了 QuoteHandler、它是不是 JavaLike」那张逐语言表，与两条「这一次不补配对」的门槛
// （`TypedQuoteImpl.java:89-97`、`:104-105`、`:117-118`）。
import { isJavaLikeQuoteLanguage, pairInsertionSuppressed } from './quoteHandlerRegistry.ts'
// 扩展点宿主接线（`com.intellij.typedHandler` / `com.intellij.backspaceHandlerDelegate`）：
// 第三方按 id 挂的字符输入 / 退格委托在这里被真实分派（bundled 的 passthrough 委托不改变既有行为）。
import {
  dispatchBackspaceAfter, dispatchBackspaceBefore, dispatchTypedHandler, fileTypeOfLanguage, notifyTypingStarted,
  typedHandlerDelegates, type BackspaceInput, type TypedCharInput, type TypedHandlerDelegateContribution,
} from './editorActionExtensionPoints.ts'
// 选区去引号过滤（`com.intellij.selectionUnquotingFilter`）：第三方按 id 挂的过滤器在这里
// 被真实问到（bundled 恒不跳过 ⇒ 既有「用引号包住选区」的行为逐字不变）。
import { shouldSkipQuoteReplacement } from './editorActionExtraExtensionPoints.ts'

/** 把 CodeMirror 的一次按键整形成扩展点要的输入（`TypedCharInput` / `BackspaceInput`）。 */
function typedInputOf(view: EditorView, ch: string, language: string | undefined, path = ''): TypedCharInput {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  return {
    path, language: language ?? 'other', fileType: fileTypeOfLanguage(language),
    text: view.state.doc.toString(), line: line.number - 1, character: head - line.from, char: ch,
  }
}

/**
 * 与 `typedInputOf` 同一份整形，但直接吃 `EditorState` + 绝对偏移 —— 消费方只有 state
 *（不持有 view）时用；例如 `src/lspCompletion.ts` 的 `context.state` 那一层。
 */
export function typedInputAt(state: EditorState, pos: number, ch: string, language: string | undefined, path = ''): TypedCharInput {
  const head = pos
  const line = state.doc.lineAt(head)
  return {
    path, language: language ?? 'other', fileType: fileTypeOfLanguage(language),
    text: state.doc.toString(), line: line.number - 1, character: head - line.from, char: ch,
  }
}

/**
 * 「敲入 `ch` 之后」的那份输入：上游 `TypedQuoteImpl.handleQuote` 是先 `typeChar(ch)` 再问
 * `beforeClosingQuoteInserted`（`:104-108` 多字符引号那一支 / `:117-118` 单引号那一支），
 * 所以委托看到的正文里**已经有那个开引号**、光标在它后面。
 * `TypedCharInput.char` 放的是**收尾引号串** —— 上游这一问的第一个参数就是它
 *（`beforeClosingQuoteInserted(closingQuote, …)`，见 `editorActionExtensionPoints.ts` 的字段注释）。
 * 只有真注册了实现这一问的委托时才构造（`doc.toString()` 是 O(n)）。
 */
function typedInputAfterChar(view: EditorView, ch: string, closingQuote: string, language: string | undefined): TypedCharInput {
  const state = view.state
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const text = state.doc.toString()
  return {
    path: '', language: language ?? 'other', fileType: fileTypeOfLanguage(language),
    text: text.slice(0, head) + ch + text.slice(head),
    line: line.number - 1, character: head - line.from + ch.length, char: closingQuote,
  }
}

/** 有委托实现了这一问吗？没有就整段不构造输入（整形正文是 O(n)）。 */
function hasTypedFace(
  language: string | undefined, face: keyof TypedHandlerDelegateContribution,
): boolean {
  return typedHandlerDelegates(language ?? 'other').some(delegate => typeof delegate[face] === 'function')
}

/** 一门语言的引号：`single` 参与「插一对 / 跳过收尾 / 包住选区」，`multi` 是多字符引号（不参与配对插入）。 */
export interface QuoteRules {
  single: readonly string[]
  multi: readonly string[]
  // 字符串字面量的连接符：回车切分字面量那一条（`enter/EnterInStringLiteralHandler.java:61-81`）
  // 只有实现 JavaLikeQuoteHandler 的语言才问（同文件 `:39-42`、`:109-114`），Java 给的是 `+`
  // （`java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:83-86`）。
  // 没有这个字段 = 这门语言的字面量不能用回车切开。
  concat?: string
}

/** 表 = 上游 `com.intellij.quoteHandler` 那份按语言的注册表；只有能核到的语言在里面。 */
export const LANGUAGE_QUOTES: Readonly<Record<string, QuoteRules>> = {
  // JavaQuoteHandler.java:31（`MultiCharQuoteHandler`）+ `:39` 的字面量 token 集。
  // `'` 单引号（char 字面量）属不属于那张 `TEXT_LITERALS` 成员表：那张表是 java-psi 的生成物
  // （`java/java-psi-impl/src/com/intellij/psi/impl/source/tree/ElementType.java:84-85` 转发给
  // `SyntaxElementTypes`），本 checkout 里读不到成员清单 ⇒ **无法核实**，不写进表。
  java: { single: ['"'], multi: ['"""'], concat: '+' },
}

export function quotesFor(language: string | undefined): QuoteRules | null {
  if (language === undefined) return null
  return LANGUAGE_QUOTES[language] ?? null
}

/**
 * 这门语言的字符串字面量能不能用回车切开、连接符是什么。
 * `null` = 表里没有这门语言 ⇒ 上游那道 `instanceof JavaLikeQuoteHandler` 的门槛过不去（`JavaLikeQuoteHandler.java:15-17`
 * 读 `getConcatenatableStringTokenTypes()`，Java 那份只有 `STRING_LITERAL`：`JavaQuoteHandler.java:32`），
 * 全社区树里实现 `JavaLikeQuoteHandler` 的就 `JavaQuoteHandler.java:31` 一个。
 * 语言 id 本身拿不到（宿主没给）时也返回 `null` —— 调用方自己决定要不要按默认档走。
 */
export function stringConcatFor(language: string | undefined): string | null {
  return quotesFor(language)?.concat ?? null
}

/** 敲一个引号该做什么：跳过已有收尾 / 补一对 / 包住选区 / 就按普通字符插。 */
export type QuoteAction = 'skip' | 'pair' | 'wrap' | 'plain'

/** 光标前那段里 `ch` 有几处不是转义里的（奇数 = 现在正处在一个没闭合的字面量里）。 */
function unescapedQuotes(line: string, upto: number, ch: string): number {
  let count = 0
  for (let at = 0; at < upto; ++at) {
    if (line[at] !== ch) continue
    let backslashes = 0
    while (at > 0 && line[at - 1 - backslashes] === '\\') ++backslashes
    if (backslashes % 2 === 0) ++count
  }
  return count
}

// 光标紧邻一个**多字符引号**（Java 文本块的 `"""`）：上游为这一档专门开了
// `MultiCharQuoteHandler`（`JavaQuoteHandler.java:31`），因为「一个引号」在这里不成立 ——
// 三个具体动作（跳过收尾 face、敲完开 face 补配对、光标停位）在 `src/editorQuoteFaces.ts` 里判；
// 这里只保留「face 旁边不再按单引号规则配对」这一条兜底。
export function atMultiCharQuote(line: string, caret: number, quotes: QuoteRules): boolean {
  return quotes.multi.some(mark => {
    const ch = mark[0]!
    if (line[caret - 1] !== ch && line[caret] !== ch) return false
    let from = caret
    while (line[from - 1] === ch) --from
    let to = caret
    while (line[to] === ch) ++to
    return to - from >= mark.length
  })
}

/**
 * 敲 `ch` 这个引号时的动作。`line` 是光标所在那一行的文本，`caret` 是行内偏移，
 * `selected` 是有没有选区（上游 `surroundWithQuotes` 那一支），
 * `languageId` 是本仓的语言档（查 `src/quoteHandlerRegistry.ts` 那张逐语言注册表用；不给 = 按
 * 「不是 javaLike」走，只受通用那条门槛管）。
 */
export function quoteAction(
  line: string, caret: number, ch: string, quotes: QuoteRules, selected: boolean, languageId?: string,
): QuoteAction {
  // 多字符引号旁边不自动配对：那是文本块的边界，插进去就成了 `""""…`（`JavaQuoteHandler` 走
  // `MultiCharQuoteHandler` 就是为了这一档）。
  if (atMultiCharQuote(line, caret, quotes)) return 'plain'
  if (!quotes.single.includes(ch)) return 'plain'
  if (selected) return 'wrap'
  // `isClosingQuote`（`QuoteHandler.java:40`）：正对着一个收尾引号 ⇒ 只挪光标。
  // 这一条在 `TypedQuoteImpl.java:80-85` 问，**在**下面那两条门槛**之前** ⇒ 门槛挡不住「跳过收尾引号」。
  if (line[caret] === ch) return 'skip'
  // `isOpeningQuote`（`:49`）+ `hasNonClosedLiteral`（`:64`）：这一行前面引号是偶数个 ⇒ 现在开一个新的，
  // 补上配对；已经是奇数个 ⇒ 在字面量里面，普通插。
  if (unescapedQuotes(line, caret, ch) % 2 !== 0) return 'plain'
  // 补配对之前还要过两条门槛（`TypedQuoteImpl.java:89-97` 的 javaLike token 表 +
  // `:104-105`/`:117-118` 的「光标后面那个字符是标识符字符就不补」），判据与依据在
  // `src/quoteHandlerRegistry.ts`。此前本仓没有这两条 ⇒ 在 `abc|def` 中间敲引号会补出一个收尾引号，
  // 上游不会。
  if (pairInsertionSuppressed(line, caret, isJavaLikeQuoteLanguage(languageId))) return 'plain'
  return 'pair'
}

/**
 * 敲 `ch` 这个引号时**最终**要做的事：先问语言表（`quoteAction`），再按 `AUTOINSERT_PAIR_QUOTE` 降级。
 * 关掉开关 ⇒ `skip`（跳过收尾引号）与 `pair`（补一对）都变成「按普通字符插」
 * （上游 `TypedQuoteImpl.java:66-68` 就是整条 `handleQuote` 直接返回 false）；
 * `wrap` 不受它管 —— 那是另一条开关 `SURROUND_SELECTION_ON_QUOTE_TYPED`
 * （`SelectionQuotingTypedHandler.java:47`，本仓没有那一格设置，见模块头）。
 */
export function quoteActionWithSwitch(
  line: string, caret: number, ch: string, quotes: QuoteRules, selected: boolean, autoInsertPairQuote: boolean,
  languageId?: string,
): QuoteAction {
  const action = quoteAction(line, caret, ch, quotes, selected, languageId)
  if (!autoInsertPairQuote && action !== 'wrap') return 'plain'
  return action
}

/** 所有语言表里出现过的引号（键一次性注册，运行期再按当前语言问表）。 */
export function quotedChars(): string[] {
  const chars = new Set<string>()
  for (const rules of Object.values(LANGUAGE_QUOTES)) for (const ch of rules.single) chars.add(ch)
  return [...chars]
}

/**
 * 敲 `ch` 这个引号时键位真正跑的那一段（`smartQuotes` 的键位体，抽出来是为了能被判据驱动：
 * 见 `tests/editor-enter-switches.test.mjs` —— 「开关关掉」是**这一步**的返回值决定的，
 * 只看 `quoteActionWithSwitch` 那一层的档位看不到「放行给 CodeMirror 之后又补回来」这一截）。
 * 返回 false = 这个键交回下一张键位（`basicSetup`）。
 *
 * **2026-10-06 本 lane 补**：本函数现在是 `com.intellij.typedHandler` 的分派点 —— 开头把
 * `beforeCharTyped` 交给 EP 委托（任一支返回 `STOP` 就整键接管、返回 true），走完本仓逻辑后
 * 再把 `charTyped` 交给 EP 委托。bundled 的委托是 passthrough（`CONTINUE`）⇒ 既有行为逐字不变；
 * 第三方按 id 挂的委托能在这里被真实分派。
 *
 * **2026-10-08 lane lp-editor 补**：`TypedHandler.doExecute` 里另外两问也接上了 —— 有选区时先问
 * `beforeSelectionRemoved`（`:184-186`），补收尾引号之前问 `beforeClosingQuoteInserted`
 *（`:104-108`/`:117-118`），两问都在 `handleQuoteKey` 里。`checkAutoPopup` 那一问在
 * `src/lspCompletion.ts`（它是"打字即弹"那一档的闸）。仍没有派发点的是
 * `beforeClosingParenInserted`（本仓的圆括号插入由 CodeMirror `closeBrackets` 的 inputHandler
 * 做，不经过本模块）与 `isImmediatePaintingEnabled`（绘制档，本仓没有立即绘制这一层）。
 */
export function runQuoteKey(
  view: EditorView, ch: string,
  getLanguage: () => string | undefined, autoInsertPairQuote: () => boolean,
): boolean {
  const language = getLanguage()
  const before = typedInputOf(view, ch, language)
  notifyTypingStarted(before)
  if (dispatchTypedHandler(before, 'beforeCharTyped') === 'STOP') return true
  const handled = handleQuoteKey(view, ch, language, autoInsertPairQuote)
  if (handled) dispatchTypedHandler(typedInputOf(view, ch, language), 'charTyped')
  return handled
}

function handleQuoteKey(
  view: EditorView, ch: string,
  language: string | undefined, autoInsertPairQuote: () => boolean,
): boolean {
  const quotes = quotesFor(language)
  if (!quotes) return false
  // 上游 `TypedQuoteImpl.java:66-68`：`AUTOINSERT_PAIR_QUOTE` 关掉 ⇒ `handleQuote` 直接返回 false
  // ⇒「跳过收尾引号」「补一对」这两档都不发生，敲进去的就是一个普通字符；文本块（face）那一档走的是
  // 同一条链路（`TypedQuoteImpl.java:80-85` 之前先问 handler），所以一起关。
  // 「有选区时包住」是**另一条**开关（`SelectionQuotingTypedHandler.java:47` 的
  // SURROUND_SELECTION_ON_QUOTE_TYPED），本仓没有那一格设置 ⇒ `wrap` 不受这里影响。
  const pairQuote = autoInsertPairQuote()
  const selection = view.state.selection.main
  // 「有选区时先问 `beforeSelectionRemoved`」：`TypedHandler.doExecute:184-186` 在删掉选区
  // **之前**问，任一委托返回 STOP（上游 `handled == true`）就整键交给它 —— 上游此时直接
  // `return`：既不删选区、也不插入、更不配对（连 `beforeCharTyped` 都不问）。本仓只有引号键
  // 走得到这条路（别的字符由 CodeMirror 的 inputHandler 处理，见模块头那条「表里没有的语言
  // 一律返回 false」）；委托实现为空时逐字保持既有行为。
  if (!selection.empty && hasTypedFace(language, 'beforeSelectionRemoved')
      && dispatchTypedHandler(typedInputOf(view, ch, language), 'beforeSelectionRemoved') === 'STOP') {
    return true
  }
  // 多字符引号那一档先问（Java 文本块 `"""`）：跳过收尾 face = `JavaQuoteHandler.java:58-63`，
  // 「刚敲完开 face 补配对」= `:104-108` + `:111-128`，插 `"\n\"\"\""` 与光标停位 = `:134-149`。
  if (selection.empty && pairQuote) {
    for (const face of quotes.multi) {
      const faceStep = faceAction(view.state.doc.toString(), selection.head, face, ch)
      if (faceStep === 'skip') {
        view.dispatch({ selection: EditorSelection.cursor(selection.head + 1), userEvent: 'input' })
        return true
      }
      if (faceStep === 'open') {
        // 补收尾 face 之前问一次 `beforeClosingQuoteInserted`（`TypedQuoteImpl.java:104-108`，
        // 上游把**收尾引号串**当第一个参数传进去）：委托接管（STOP）⇒ 本体只落下敲进来的那个
        // 开引号（上游此刻正文里也正是「一个开 face、没有收尾」）。
        if (hasTypedFace(language, 'beforeClosingQuoteInserted')
            && dispatchTypedHandler(typedInputAfterChar(view, ch, face, language), 'beforeClosingQuoteInserted') === 'STOP') {
          view.dispatch({
            changes: { from: selection.head, insert: ch },
            selection: EditorSelection.cursor(selection.head + ch.length),
            userEvent: 'input',
          })
          return true
        }
        view.dispatch({
          changes: { from: selection.head, insert: ch + faceInsertion(face) },
          selection: EditorSelection.cursor(selection.head + 1 + FACE_CARET_ADVANCE),
          userEvent: 'input',
        })
        return true
      }
    }
  }
  // 开关关掉 ⇒ 这个键**必须由本模块吃掉并只落一个字符**，不能 `return false` 交回下一张键位：
  // `basicSetup` 自带的 `closeBrackets()`（`node_modules/codemirror/dist/index.js:61`）不是键位而是
  // `EditorView.inputHandler`（`node_modules/@codemirror/autocomplete/dist/index.js:1831` = `[inputHandler, bracketState]`、`:1844-1856`），
  // 键位放行只会把这次输入让给它，它照旧补出 `""`（`:1795` 的 `defaults.brackets` 含 `"`、
  // `:1990-1994` 的 `handleSame`）—— 实测见 `tests/editor-enter-switches.test.mjs` 的「前提」那条。
  // 上游没有这层兜底：`TypedQuoteImpl.java:66-68` 直接 return false 之后走 `TypedCharImpl` 的普通输入
  // ⇒ 文档里只多一个字符。这里自己落那一个字符，开关才算真的接进了行为。
  // 只管「这门语言的引号表接管过的那个键」（表里没有的语言仍整条交回 CodeMirror，见模块头）；
  // 多光标时不动它：本模块其余分支都只认 main，在这里吃掉键会让别的光标一个字符都收不到。
  if (!pairQuote && selection.empty && view.state.selection.ranges.length === 1 && quotes.single.includes(ch)) {
    view.dispatch({
      changes: { from: selection.head, insert: ch },
      selection: EditorSelection.cursor(selection.head + ch.length),
      userEvent: 'input.type',
    })
    return true
  }
  const line = view.state.doc.lineAt(selection.head)
  const action = quoteActionWithSwitch(
    line.text, selection.head - line.from, ch, quotes, !selection.empty, pairQuote, language,
  )
  if (action === 'plain') return false
  if (action === 'skip') {
    view.dispatch({ selection: EditorSelection.cursor(selection.head + 1), userEvent: 'input' })
    return true
  }
  if (action === 'wrap') {
    const text = view.state.sliceDoc(selection.from, selection.to)
    const caretLine = view.state.doc.lineAt(selection.head)
    // `com.intellij.selectionUnquotingFilter`（上游 `SelectionQuotingTypedHandler.java:152-157`
    // 的 `shouldSkipReplacementOfQuotesOrBraces`，问在 `:46`/`:52`）：任一过滤说要跳过 ⇒
    // **不包住选区**，就按普通字符落下去（上游返回 `super.beforeSelectionRemoved` / DEFAULT 之后
    // 走 `TypedCharImpl` 的普通输入，结果就是用敲进去的那个字符替换掉选区）。
    // bundled 过滤恒返回 false ⇒ 没有第三方挂进来时这一格与既有行为逐字相同。
    if (shouldSkipQuoteReplacement({
      path: '', language: language ?? '', text: view.state.doc.toString(),
      line: caretLine.number - 1, character: selection.head - caretLine.from,
      selectedText: text, typed: ch,
    })) {
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: ch },
        selection: EditorSelection.cursor(selection.from + ch.length),
        userEvent: 'input',
      })
      return true
    }
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: `${ch}${text}${ch}` },
      selection: { anchor: selection.from + 1, head: selection.to + 1 },
      userEvent: 'input',
    })
    return true
  }
  // 单引号那一支补配对之前的那一问（`TypedQuoteImpl.java:117-118`，第一个参数是
  // `String.valueOf(quote)` = 收尾引号串本身）：委托接管 ⇒ 只落开引号，不补收尾
  //（上游 `handled == true` 时那个 `document.insertString(offset, quoteString)` 不执行）。
  if (hasTypedFace(language, 'beforeClosingQuoteInserted')
      && dispatchTypedHandler(typedInputAfterChar(view, ch, ch, language), 'beforeClosingQuoteInserted') === 'STOP') {
    view.dispatch({
      changes: { from: selection.head, insert: ch },
      selection: EditorSelection.cursor(selection.head + ch.length),
      userEvent: 'input',
    })
    return true
  }
  view.dispatch({
    changes: { from: selection.head, insert: ch + ch },
    selection: EditorSelection.cursor(selection.head + 1),
    userEvent: 'input',
  })
  return true
}

/**
 * 退格键位体：把 `com.intellij.backspaceHandlerDelegate` 的 `beforeCharDeleted` / `charDeleted`
 * 交给 EP 委托（上游 `BackspaceHandlerDelegate.java:23`/`:33`）。任一支 `charDeleted` 返回 true
 * = 这一键由委托接手（本仓替它删掉那一个字符、返回 true，跳过 `basicSetup` 的默认退格）；
 * 没有委托接手时返回 false ⇒ CodeMirror 默认退格照旧（bundled 的委托恒返回 false）。
 */
export function runBackspaceKey(view: EditorView, getLanguage: () => string | undefined): boolean {
  const selection = view.state.selection.main
  if (!selection.empty || view.state.selection.ranges.length !== 1) return false
  const head = selection.head
  if (head <= 0) return false
  const line = view.state.doc.lineAt(head)
  const language = getLanguage()
  const input: BackspaceInput = {
    path: '', language: language ?? 'other', text: view.state.doc.toString(),
    offset: head, line: line.number - 1, character: head - line.from,
    char: view.state.doc.sliceString(head - 1, head),
  }
  dispatchBackspaceBefore(input)
  if (!dispatchBackspaceAfter(input)) return false
  view.dispatch({
    changes: { from: head - 1, to: head },
    selection: EditorSelection.cursor(head - 1),
    userEvent: 'delete',
  })
  return true
}

/**
 * 按语言的引号键位：`getLanguage` 传取值函数（编辑器换文件时才定得下语言），
 * `autoInsertPairQuote` 传上游那条开关（缺省 = 恒开 = 上游默认值 `CodeInsightSettings.java:140`）。
 * 当前语言不在表里（C++/TS/纯文本）时**一律返回 false**，CodeMirror 的 `closeBrackets` 原样接管，
 * 本模块不抢它的行为。
 *
 * 键位表除引号外还挂了 `Backspace`（`com.intellij.backspaceHandlerDelegate` 的分派点，见
 * `runBackspaceKey`）：没有委托接手时返回 false，CodeMirror 默认退格逐字不变。
 */
export function smartQuotes(
  getLanguage: () => string | undefined, autoInsertPairQuote: () => boolean = () => true,
): Extension {
  return Prec.high(keymap.of([
    ...quotedChars().map(ch => ({
      key: ch,
      run: (view: EditorView): boolean => runQuoteKey(view, ch, getLanguage, autoInsertPairQuote),
    })),
    { key: 'Backspace', run: (view: EditorView): boolean => runBackspaceKey(view, getLanguage) },
  ]))
}

/**
 * 从 CodeMirror 的一次更新里取出「用户敲进去的文本」。
 *
 * 用途：宏录制（IDEA 的 `ActionMacroManager.KeyPostProcessor` → `ActionMacro.appendKeyPressed`）
 * 要把输入的文字录进宏。CodeMirror 的 `update.changes` 里既可能是插入也可能是删除，
 * 这里只取**插入**的部分并拼成一串（连续输入在 src/macros.ts 的 `appendTyping` 里合并成一条）。
 * 被 `src/components/CodeEditor.vue` 消费；纯函数部分在 tests/macros*.test.mjs 里测。
 */
export function insertedText(update: ViewUpdate): string {
  if (!update.docChanged) return ''
  let text = ''
  update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => { text += inserted.toString() })
  return text
}
