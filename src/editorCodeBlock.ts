// 语句块首尾移动（`lp/editor-actions` 判决缺项 ⑥ 点名的 `CodeBlockStart/End` 一族）。
//
// 用户看到的行为：光标跳到**当前所在代码块**的开头 / 结尾，带 `Shift` 的那两条顺手把途经的文本选上。
//
// 上游坐标（判定基准只有上游源码树）：
//   · 键位 `platform/platform-resources/src/keymaps/$default.xml`：
//     `:569-571` `EditorCodeBlockStart` = Ctrl+[ 、`:315-317` `EditorCodeBlockEnd` = Ctrl+] 、
//     `:318-320` `EditorCodeBlockStartWithSelection` = Ctrl+Shift+[ 、`:824-826` `EditorCodeBlockEndWithSelection` = Ctrl+Shift+]。
//   · 动作类：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockStartAction.java:22-30`
//     （`Handler extends EditorActionHandler.ForEachCaret` ⇒ **逐光标**执行）与同目录的 `CodeBlockEndAction.java`。
//   · 主逻辑 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockUtil.java`：
//     `moveCaretToCodeBlockEnd:35-69` / `moveCaretToCodeBlockStart:71-106`，三支按顺序问：
//       1. `CodeBlockProviders.INSTANCE.forLanguage(...)`（`:41-47`/`:78-84`）—— 语言自己注册的代码块提供者。
//          全树按 EP 名搜只有一条实现：`python/pluginResources/intellij.python.community.impl.xml:673`
//          （`<codeBlockProvider language="Python">`）；EP 声明在
//          `platform/lang-impl/resources/intellij.platform.lang.impl.xml:421`。
//          **Java / C++ / TypeScript 没有注册** ⇒ 这三种语言走上游的第 2、3 支。
//       2. 缩进参考线（`:49-52`/`:86-89`）：`editor.getIndentsModel().getCaretIndentGuide()`，
//          落到 `(guide.endLine, guide.indentLevel)` / `(guide.startLine, …)`，
//          且起点分支还要求参考线不是**从光标行本身开始**（`:87`）。
//       3. 括号扫描 `calcBlockEndOffset:108-120` → `calcBlockEndOffsetFromBraceMatcher:122-174`
//          与 `calcBlockStartOffset:176-188` → `calcBlockStartOffsetFromBraceMatcher:190-238`。
//     落点之后统一 `scrollToCaret(ScrollType.RELATIVE)`（`:61`/`:98`，本仓 `scrollIntoView` 的最小滚动同一档），
//     再按 `isWithSelection` 决定「从原来的 lead 偏移选到落点」还是「清掉选区」（`:63-68`/`:100-105`）。
//   · 什么算括号：`isLStructuralBrace`/`isRStructuralBrace`（`CodeBlockUtil.java:250-256`）=
//     `BraceMatchingUtil.isLBraceToken`（`platform/lang-impl/src/com/intellij/codeInsight/highlighting/BraceMatchingUtil.java:303-313`）
//     **且** `isStructuralBraceToken`（同文件 `:296-301`），两者都转交给语言的 `BraceMatcher`
//     （`platform/lang-impl/src/com/intellij/codeInsight/highlighting/BraceMatcher.java:39-42`）。
//     深度计数器只按**语言**分档（`getBraceType` 取的是 `tokenType.getLanguage()`，`:30-33`），
//     不按括号种类分 ⇒ 上游把 `(`、`[`、`{` 记在同一个 depth 上，本模块照此实现，不改成「按种类配对」。
//
// 本仓用哪一支：第 1 支没有我们这三种语言的实现；第 2 支要一份缩进参考线模型
// （`src/editorIndentGuides.ts` 只画线、不出模型）⇒ 走上游第 3 支的**文本等价**：
// 逐字符扫结构括号（字符串/注释里的不算，与 `src/enterHandlers.ts` 的 `structuralBraceCounts` 同一口径），
// 按 `:140-174` 与 `:210-237` 的循环原样搬。识别不出块时返回 null ⇒ 命令不吞键。

// 第 3 支之外，上游**还要**再问一次「结构支持」那一半并把两支合起来（`CodeBlockUtil.java:110` 与
// `:178` 问的 `CodeBlockSupportHandler.findCodeBlockRange`）。合并规则（`:111-118`/`:179-186`）与
// Python 那一份判据都在 `src/structuralCodeBlock.ts`（那份模块的 B 半，请求
// `docs/wiring-requests-2026-10-06-search2.md` W-1' 就是让本文件来接线的）。
import { findCodeBlockRange, mergeBlockEnd, mergeBlockStart } from './structuralCodeBlock.ts'

const OPENERS = '([{'
const CLOSERS = ')]}'

export interface BraceToken { from: number; kind: 'L' | 'R' }

/** 全文的结构括号 token（跳过字符串与注释；与上游的「高亮器 token」同一档口径）。 */
export function structuralBraceTokens(text: string): BraceToken[] {
  const tokens: BraceToken[] = []
  let string = ''
  let inBlock = false
  for (let at = 0; at < text.length; ++at) {
    const ch = text[at]!
    const next = text[at + 1]
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; ++at }
      continue
    }
    if (string) {
      if (ch === '\\') { ++at; continue }
      if (ch === string) string = ''
      continue
    }
    if (ch === '"' || ch === '\'' || ch === '`') { string = ch; continue }
    if (ch === '/' && next === '/') { const eol = text.indexOf('\n', at); at = eol < 0 ? text.length : eol; continue }
    if (ch === '/' && next === '*') { inBlock = true; ++at; continue }
    if (OPENERS.includes(ch)) tokens.push({ from: at, kind: 'L' })
    else if (CLOSERS.includes(ch)) tokens.push({ from: at, kind: 'R' })
  }
  return tokens
}

/** 第一个 `from >= offset` 的 token 下标；没有则 = tokens.length。 */
function indexAtOrAfter(tokens: readonly BraceToken[], offset: number): number {
  let low = 0
  let high = tokens.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (tokens[mid]!.from < offset) low = mid + 1
    else high = mid
  }
  return low
}

/** 最后一个 `from < offset` 的 token 下标；没有则 = -1。 */
function indexBefore(tokens: readonly BraceToken[], offset: number): number {
  return indexAtOrAfter(tokens, offset) - 1
}

/**
 * `calcBlockEndOffsetFromBraceMatcher:122-174`：从光标往右找到「关掉当前块」的那个右括号。
 * 返回该括号的**后一个偏移**（`isBeforeLBrace` 那支，光标正好压在一个左括号上时块尾算到右括号之后）
 * 或该括号的**起始偏移**（其余情况），扫不到返回 null（上游的 -1）。
 */
export function blockEndOffset(text: string, caret: number): number | null {
  const tokens = structuralBraceTokens(text)
  const index = indexAtOrAfter(tokens, caret)
  // 迭代器停在哪个 token 上（`:126`）：光标正好压着一个括号 token 时 `moved` 从 false 起，
  // 停在别的 token（标识符、空白）时第一轮是空转、`moved` 立刻变 true —— 这一档差别决定了
  // 光标紧贴右括号时那一个括号算不算「关掉块」（上游不算，`:149` 的 `if (moved)` 挡住了）。
  const onBrace = index < tokens.length && tokens[index]!.from === caret
  // `:132-135` 前置那一支：停在左括号上 ⇒ depth 从 -1 起，落点取 token 末尾。
  const beforeLeft = onBrace && tokens[index]!.kind === 'L'
  let depth = beforeLeft ? -1 : 0
  let moved = !onBrace
  for (let at = index; at < tokens.length; ++at) {
    const token = tokens[at]!
    if (token.kind === 'R') {
      if (moved) {
        if (depth === 0) return beforeLeft ? token.from + 1 : token.from
        --depth
      }
    } else {
      ++depth
    }
    moved = true
  }
  return null
}

/**
 * `calcBlockStartOffsetFromBraceMatcher:190-238`：从光标往左找「开出当前块」的那个左括号。
 * 光标正好压在右括号上时落点取右括号本身（`:237` 的 `isAfterRBrace ? getStart() : getEnd()`），
 * 其余情况落在左括号**之后**，扫不到返回 null。
 */
export function blockStartOffset(text: string, caret: number): number | null {
  const offset = caret - 1
  if (offset < 0) return null
  const tokens = structuralBraceTokens(text)
  const index = indexBefore(tokens, caret)
  // `:201-205`：起始位置压着右括号 ⇒ depth 从 -1 起，落点用那个右括号本身。
  // 与右手边那一支同理：光标没压在括号上时第一轮是空转，`moved` 一开始就是 true。
  const onBrace = index >= 0 && tokens[index]!.from === offset
  const afterRight = onBrace && tokens[index]!.kind === 'R'
  let depth = afterRight ? -1 : 0
  let moved = !onBrace
  for (let at = index; at >= 0; --at) {
    const token = tokens[at]!
    if (token.kind === 'L') {
      if (moved) {
        if (depth === 0) return afterRight ? token.from : token.from + 1
        --depth
      }
    } else {
      ++depth
    }
    moved = true
  }
  return null
}

/**
 * 光标要落到哪儿（null = 这里没有代码块，命令不吞键）。
 *
 * 上游把两支合起来：括号扫描（`calcBlockEndOffsetFromBraceMatcher`/`…StartOffsetFrom…`，本文件的
 * `blockEndOffset`/`blockStartOffset`）与结构支持（`CodeBlockUtil.java:110`/`:178` 问的
 * `CodeBlockSupportHandler.findCodeBlockRange`），块尾取 `Math.min`（`:118`）、块首取 `Math.max`（`:186`），
 * 某一支没有时用另一支（`:111-113`/`:114-116`、`:179-181`/`:182-184`）。合并规则住在
 * `src/structuralCodeBlock.ts` 的 `mergeBlockEnd`/`mergeBlockStart`，本函数只负责接线。
 *
 * `language` 是编辑器的语言档（本仓现成通道 = `src/editorMatchBrace.ts:51` 的 `editorLanguageId` facet）。
 * 传空/不传 ⇒ 不问结构那半，结果与接线前**逐字一致**：本仓编辑器只认 Java/C++/TS/JSON/HTML/CSS
 * （`src/editorLanguage.ts:15-21`），而这棵社区树里注册 `codeBlockSupportHandler` 的语言只有 Python
 * （`python/pluginResources/intellij.python.community.impl.xml:439`）⇒ 上游对我们能打开的每种语言都返回
 * `EMPTY_RANGE`，合并自动退化成「只用括号扫描」。**不是少做**，如实记着。
 */
export function codeBlockTarget(text: string, caret: number, forward: boolean, language = ''): number | null {
  const structural = findCodeBlockRange(text, caret, language)
  return forward
    ? mergeBlockEnd(blockEndOffset(text, caret), structural)
    : mergeBlockStart(blockStartOffset(text, caret), structural)
}
