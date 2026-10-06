// 块注释里回车（`lp/editor-actions` 判决缺项 ② 的 `enter/*` 里本仓还没有的那一条）。
//
// 上游坐标（2026-10-06 逐行核对）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterInBlockCommentHandler.java`
//     `:38-39` 先要语言有 `CodeDocumentationAwareCommenter`，没有就 `Result.Continue`；
//     `:42-43` 再问 `getBlockCommentStartOffset`（`:103-120`）：光标得真的在一个块注释 token 里，
//       `:112` 要求光标**在 `/*` 之后**（`prefixEnd > offset` ⇒ -1），
//       `:114-118` 光标落在收尾 `*/` 里面时也 ⇒ -1；
//     `:48-51` 从 `/*` 到光标这一段以文档注释前缀 `/**` 开头 ⇒ `Result.Continue`（让给文档注释那一族）；
//     `:53-54` `/*` 前面除了空白只能是本行开头（不是从行首起的块注释不处理）；
//     `:62-68` **注释没闭合**且 `CLOSE_COMMENT_ON_ENTER` 开着：在光标行的行尾插
//       `"\n" + 「/* 那一行的缩进」+ " " + "*/"`，随后 `Result.Default`（就按普通回车换行）；
//     `:86-99` 有行前缀 `*` 的那一支：`linePrefix + " "` 落在光标处（`:96`），
//       `caretAdvance = linePrefix.length + 1`（`:97`），`Result.DefaultForceIndent`（`:98`）；
//     `:70-84` TODO 续行的额外缩进依赖 `TodoConfiguration` 的图案表与「多行 TODO」开关 ——
//       本仓的 todo 面板归别的桶，这里**不做**，如实记在报告里。
//   · 注释「写没写完」的默认判据：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/EnterHandler.java:200-210`
//     （没有 `CommentCompleteHandler` 命中时，注释文本必须以 suffix 收尾，否则算没闭合）。
//   · `CLOSE_COMMENT_ON_ENTER` 默认开：`platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:132`
//     （同文件 `:129` `SMART_INDENT_ON_ENTER`、`:130` `INSERT_BRACE_ON_ENTER` 是另两条回车开关的默认值）。
//   · 前缀字面量：`java/java-psi-impl/src/com/intellij/lang/java/JavaCommenter.java:27-28` `/*`、
//     `:32-33` `*/`、`:62-63` `/**`、`:67-68` `*`；`:37-44` 的两个 `getCommentedBlockComment*` 返回
//     null ⇒ Java 的块注释**不嵌套**，本模块的扫描同样不嵌套。
//
// 本仓与上游的差别（架构不等价，按功能还原）：上游用高亮迭代器（token 类型）判断「光标在块注释里」，
// 本仓没有 PSI/token 层 ⇒ 自己做一遍逐字符词法扫描（字符串 / 行注释 / 块注释三种状态），
// 与 `src/enterHandlers.ts` 的 `structuralBraceCounts` 同一口径。判不准的场合一律返回 null，
// 交回 CodeMirror 的 `insertNewlineAndIndent`，不猜。
//
// 文档注释（`/** …`）那一支本模块不接：上游 `:48-51` 就把它让出去了，而接手的
// `EnterAfterJavadocTagHandler.java` 与 `EnterHandler.java:417-428` 的 javadoc 生成要靠 PSI 找方法声明
// —— 本仓没有 PSI，与上游的退出条件保持一致，返回 null（详见报告的「做不到」）。
import type { ChangeSpec } from '@codemirror/state'

/** 块注释的词法（上游 `CodeDocumentationAwareCommenter` 的三个前缀 + 一个后缀）。 */
export interface BlockCommentLexicon {
  // 块注释前后缀，如 `['/*', '*/']`。没有块注释的语言留空。
  block?: [string, string]
  // 文档注释前缀（`/**`）：以它开头的一段不接（`EnterInBlockCommentHandler.java:48-51`）。
  docPrefix?: string
  /** 注释行前缀（`*`）= `getDocumentationCommentLinePrefix`，`:86-99` 那一支用它。 */
  linePrefix?: string
}

const SPACES = ' \t'

// 把本仓的注释标记（`src/commentToggle.ts` 的 `CommentStyle.block`，来源是 CodeMirror 的
// `commentTokens` 语言数据或那张扩展名表）翻成上游 `CodeDocumentationAwareCommenter` 的那三件套。
// 依据 `java/java-psi-impl/src/com/intellij/lang/java/JavaCommenter.java`：`:27-28` `/*`、
// `:32-33` `*/`、`:62-63` 文档注释前缀 `/**`（= 块前缀再添一个 `*`）、`:67-68` 续行前缀 `*`。
// 块前缀不是 `/*` 的语言（lua `--[[`、haskell `{-`、html `<!--`）上游没有对应的文档注释形态 ⇒
// 只给 block：`EnterInBlockCommentHandler.java:86-87` 在 `getDocumentationCommentLinePrefix()`
// 为 null 时本来就不走 `* ` 续行那一支，只剩「没闭合就补闭尾」（`:62-68`）生效。
export function blockLexiconFor(style?: { block?: [string, string] }): BlockCommentLexicon | undefined {
  const block = style?.block
  if (!block) return undefined
  if (block[0] !== '/*') return { block }
  return { block, docPrefix: '/**', linePrefix: '*' }
}

function shiftForward(text: string, from: number, chars: string): number {
  let at = from
  while (at < text.length && chars.includes(text[at]!)) ++at
  return at
}

function shiftBackward(text: string, from: number, chars: string): number {
  let at = from
  while (at >= 0 && chars.includes(text[at]!)) --at
  return at
}

// 从 `start`（一个 `/*` 的下标）往后找闭尾，返回 `*/` 的**起始**下标；没有闭尾返回 -1
// （块注释不嵌套，见文件头的 `JavaCommenter.java:37-44`）。
// 注：本文件的注释一律用 `//`。**实测口径**（2026-10-06，`build-tmp/probe.ts` 两个最小样例）：
// TypeScript 的块注释**不嵌套** —— 正文里的 `/*` 什么都不做（`/** a /* b */` 之后的代码仍然是活的、
// 照常报类型错），但正文里的 `*/` 会**提前闭合**注释，后面的中文被当代码读 ⇒ TS1002/TS1161，
// 而语法错会中断整棵树的语义检查（今晚这个文件一次造出 65 条级联错）。
export function blockCommentClose(text: string, start: number, lexicon: BlockCommentLexicon): number {
  const open = lexicon.block?.[0]
  const close = lexicon.block?.[1]
  if (!open || !close) return -1
  return text.indexOf(close, start + open.length)
}

// 包含 `caret` 的那个块注释（`getBlockCommentStartOffset`，`:103-120` 的词法版）。
// 返回 `{ start: '/*' 的下标, close: '*/' 的下标（未闭合 -1） }`；不在块注释里 ⇒ `start: -1`。
//
// 扫描认三件事：字符串里的 `/*` 不算、行注释里的不算、块注释本身不嵌套。
export function blockCommentAt(text: string, caret: number, lexicon: BlockCommentLexicon): { start: number; close: number } {
  const open = lexicon.block?.[0]
  const close = lexicon.block?.[1]
  if (!open || !close) return { start: -1, close: -1 }
  let inString = ''
  let inLineComment = false
  for (let i = 0; i < text.length; ++i) {
    const char = text[i]!
    const next = text[i + 1]
    if (inString) {
      if (char === '\\') { i++; continue }
      if (char === inString) inString = ''
      continue
    }
    if (inLineComment) {
      if (char === '\n') inLineComment = false
      continue
    }
    // 字符串里的 `/*` 不算注释（上游由高亮迭代器保证，本仓自己扫）—— 与 `enterHandlers.ts`
    // 的 `structuralBraceCounts` 同一口径。
    if (char === '"' || char === '\'' || char === '`') { inString = char; continue }
    if (char !== '/' || (next !== '*' && next !== '/')) continue
    if (next === '/') { inLineComment = true; i++; continue }
    const closeAt = blockCommentClose(text, i, lexicon)
    const end = closeAt < 0 ? text.length : closeAt + close.length
    if (caret >= i && caret <= end) return { start: i, close: closeAt }
    i = end - 1
  }
  return { start: -1, close: -1 }
}

// `getBlockCommentStartOffset`（`:103-120`）的三条退出条件都过一遍：
// 在块注释里、光标在 `/*` 之后（`:112`）、不在收尾 `*/` 里面（`:114-118`）。
// 不成立返回 -1。
export function blockCommentStartOffset(text: string, caret: number, lexicon: BlockCommentLexicon): number {
  const open = lexicon.block?.[0]
  const close = lexicon.block?.[1]
  if (!open || !close) return -1
  const { start, close: closeAt } = blockCommentAt(text, caret, lexicon)
  if (start < 0) return -1
  if (start + open.length > caret) return -1                       // `:112` prefixEnd > offset
  if (closeAt >= 0 && caret > closeAt) return -1                    // `:114-118` 落在 */ 里面
  return start
}

// 这条块注释闭合了吗（`EnterHandler.java:207-210` 的默认判据：注释文本必须以 suffix 收尾）。
// 词法层等价问法：从 `/*` 往后找得到 `*/`。
export function blockCommentComplete(text: string, start: number, lexicon: BlockCommentLexicon): boolean {
  return blockCommentClose(text, start, lexicon) >= 0
}

/** 光标所在行的行首下标（`DocumentUtil.getLineStartOffset` 的等价物，`:63`/`:72`）。 */
function lineStartOf(text: string, at: number): number {
  const index = text.lastIndexOf('\n', at - 1)
  return index < 0 ? 0 : index + 1
}

/** 光标所在行的行尾下标（不含换行，`DocumentUtil.getLineEndOffset` 的等价物，`:63`/`:75`）。 */
function lineEndOf(text: string, at: number): number {
  const index = text.indexOf('\n', at)
  return index < 0 ? text.length : index
}

/** 下一行的行首（`:90` 的 `getLineStartOffset(getLineNumber(start) + 1)`）。 */
function nextLineStart(text: string, at: number): number {
  const index = text.indexOf('\n', at)
  return index < 0 ? text.length : index + 1
}

export interface BlockCommentEnterResult {
  /** 先落地的编辑（**绝对偏移**），之后由调用方执行「普通回车」（上游的 Result.Default*）。 */
  edits: ChangeSpec[]
  /** 回车之后光标还要往后挪的字符数（`caretAdvance`，`:97`）。 */
  caretAdvance: number
  /** `true` = 上游的 `Result.DefaultForceIndent`（`:98`）；`false` = `Result.Default`（`:67`）。 */
  forceIndent: boolean
}

/**
 * 块注释里回车的主入口（`preprocessEnter` 的文本子集，`:31-101`）。
 * 上游每一处 `Result.Continue` 在这里都是 null —— 交回默认回车。
 *
 * `closeOnEnter` = 上游 `CodeInsightSettings.CLOSE_COMMENT_ON_ENTER`（默认 true，
 * `CodeInsightSettings.java:132`；开关问在 `EnterInBlockCommentHandler.java:62`，`* ` 续行那一支不受它管）。
 * **订正（2026-10-06 复核）**：这里原先写「本仓 `EditorSettings` 里没有这一条对应项」—— 实际是**有键**
 * （`src/settingsModel.ts:429`，默认 true）**有界面**（`src/components/EditorEnterKeysFields.vue:33`）
 * **没有消费方**。缺的那一半现在接上了：`src/enterHandlers.ts` 把 `EnterLanguage.blockCloseOnEnter ?? true`
 * 传进这个实参；宿主递 `props.settings.closeCommentOnEnter` 的那一行在保留文件里
 * ⇒ `docs/wiring-requests-2026-10-06-editorinput.md` R1。不传时按上游默认 true 走，行为一格不变。
 */
export function enterInBlockComment(
  text: string, caret: number, lexicon: BlockCommentLexicon, closeOnEnter = true,
): BlockCommentEnterResult | null {
  const open = lexicon.block?.[0]
  const close = lexicon.block?.[1]
  if (!open || !close) return null                                          // `:38-39`
  const start = blockCommentStartOffset(text, caret, lexicon)
  if (start < 0) return null                                                // `:42-43`
  if (lexicon.docPrefix && text.slice(start, caret).startsWith(lexicon.docPrefix)) return null  // `:48-51`
  const beforeWhitespace = shiftBackward(text, start - 1, SPACES)
  if (beforeWhitespace >= 0 && text[beforeWhitespace] !== '\n') return null // `:53-54`

  // `:62-68` 注释没闭合 ⇒ 光标行的行尾补「缩进 + */」，回车本身走默认的（Result.Default）。
  if (closeOnEnter && !blockCommentComplete(text, start, lexicon)) {
    const indent = text.slice(beforeWhitespace + 1, start)
    return { edits: [{ from: lineEndOf(text, caret), insert: `\n${indent} ${close}` }], caretAdvance: 0, forceIndent: false }
  }

  const linePrefix = lexicon.linePrefix
  if (!linePrefix) return null                                              // `:86-87`
  // `:89-91` 光标已经在这条注释的第二行及以后 ⇒ 参照点是「`/*` 那一行的下一行」的第一个非空白字符；
  // 光标还在起始行上时参照点就是光标。那里必须是 `*`，否则不接。
  const startLine = lineStartOf(text, start)
  const caretLine = lineStartOf(text, caret)
  const refOffset = caretLine > startLine ? nextLineStart(text, startLine) : caret
  const prefixAt = shiftForward(text, refOffset, SPACES)
  if (!text.startsWith(linePrefix, prefixAt)) return null                   // `:91`
  // `:92-96` 吃掉光标到行尾之间的空白（续行那一段），换成 `* `。
  let endOffset = shiftForward(text, caret, SPACES)
  if (endOffset < text.length && text[endOffset] !== '\n') endOffset = caret
  const replaceTo = endOffset > caret ? endOffset : caret
  return {
    edits: [{ from: caret, to: replaceTo, insert: `${linePrefix} ` }],
    caretAdvance: linePrefix.length + 1,                                     // `:97`
    forceIndent: true,                                                       // `:98`
  }
}
