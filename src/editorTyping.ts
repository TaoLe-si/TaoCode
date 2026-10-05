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
//     本仓编辑器设置里**没有**这一条对应项 ⇒ 记在报告的「做不到」栏，不假装接了。
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
import { EditorSelection, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { EditorView, ViewUpdate } from '@codemirror/view'
import { FACE_CARET_ADVANCE, faceAction, faceInsertion } from './editorQuoteFaces.ts'

/** 一门语言的引号：`single` 参与「插一对 / 跳过收尾 / 包住选区」，`multi` 是多字符引号（不参与配对插入）。 */
export interface QuoteRules {
  single: readonly string[]
  multi: readonly string[]
}

/** 表 = 上游 `com.intellij.quoteHandler` 那份按语言的注册表；只有能核到的语言在里面。 */
export const LANGUAGE_QUOTES: Readonly<Record<string, QuoteRules>> = {
  // JavaQuoteHandler.java:31（`MultiCharQuoteHandler`）+ `:39` 的字面量 token 集。
  // `'` 单引号（char 字面量）属不属于那张 `TEXT_LITERALS` 成员表：那张表是 java-psi 的生成物
  // （`java/java-psi-impl/src/com/intellij/psi/impl/source/tree/ElementType.java:84-85` 转发给
  // `SyntaxElementTypes`），本 checkout 里读不到成员清单 ⇒ **无法核实**，不写进表。
  java: { single: ['"'], multi: ['"""'] },
}

export function quotesFor(language: string | undefined): QuoteRules | null {
  if (language === undefined) return null
  return LANGUAGE_QUOTES[language] ?? null
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
 * `selected` 是有没有选区（上游 `surroundWithQuotes` 那一支）。
 */
export function quoteAction(line: string, caret: number, ch: string, quotes: QuoteRules, selected: boolean): QuoteAction {
  // 多字符引号旁边不自动配对：那是文本块的边界，插进去就成了 `""""…`（`JavaQuoteHandler` 走
  // `MultiCharQuoteHandler` 就是为了这一档）。
  if (atMultiCharQuote(line, caret, quotes)) return 'plain'
  if (!quotes.single.includes(ch)) return 'plain'
  if (selected) return 'wrap'
  // `isClosingQuote`（`QuoteHandler.java:40`）：正对着一个收尾引号 ⇒ 只挪光标。
  if (line[caret] === ch) return 'skip'
  // `isOpeningQuote`（`:49`）+ `hasNonClosedLiteral`（`:64`）：这一行前面引号是偶数个 ⇒ 现在开一个新的，
  // 补上配对；已经是奇数个 ⇒ 在字面量里面（`isInsideLiteral`，`:58`），普通插。
  return unescapedQuotes(line, caret, ch) % 2 === 0 ? 'pair' : 'plain'
}

/** 所有语言表里出现过的引号（键一次性注册，运行期再按当前语言问表）。 */
export function quotedChars(): string[] {
  const chars = new Set<string>()
  for (const rules of Object.values(LANGUAGE_QUOTES)) for (const ch of rules.single) chars.add(ch)
  return [...chars]
}

/**
 * 按语言的引号键位：`getLanguage` 传取值函数（编辑器换文件时才定得下语言）。
 * 当前语言不在表里（C++/TS/纯文本）时**一律返回 false**，CodeMirror 的 `closeBrackets` 原样接管，
 * 本模块不抢它的行为。
 */
export function smartQuotes(getLanguage: () => string | undefined): Extension {
  return Prec.high(keymap.of(quotedChars().map(ch => ({
    key: ch,
    run: (view: EditorView): boolean => {
      const quotes = quotesFor(getLanguage())
      if (!quotes) return false
      const selection = view.state.selection.main
      // 多字符引号那一档先问（Java 文本块 `"""`）：跳过收尾 face = `JavaQuoteHandler.java:58-63`，
      // 「刚敲完开 face」= `:104-108` + `:111-128`，插 `"\n\"\"\""` 与光标停位 = `:134-149`。
      if (selection.empty) {
        for (const face of quotes.multi) {
          const faceStep = faceAction(view.state.doc.toString(), selection.head, face, ch)
          if (faceStep === 'skip') {
            view.dispatch({ selection: EditorSelection.cursor(selection.head + 1), userEvent: 'input' })
            return true
          }
          if (faceStep === 'open') {
            view.dispatch({
              changes: { from: selection.head, insert: ch + faceInsertion(face) },
              selection: EditorSelection.cursor(selection.head + 1 + FACE_CARET_ADVANCE),
              userEvent: 'input',
            })
            return true
          }
        }
      }
      const line = view.state.doc.lineAt(selection.head)
      const action = quoteAction(line.text, selection.head - line.from, ch, quotes, !selection.empty)
      if (action === 'plain') return false
      if (action === 'skip') {
        view.dispatch({ selection: EditorSelection.cursor(selection.head + 1), userEvent: 'input' })
        return true
      }
      if (action === 'wrap') {
        const text = view.state.sliceDoc(selection.from, selection.to)
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: `${ch}${text}${ch}` },
          selection: { anchor: selection.from + 1, head: selection.to + 1 },
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
    },
  }))))
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
