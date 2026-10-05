// 扩展选区（IDEA 的 Extend Selection 一族，`lp/editor-actions` 判词缺口之一：
// 「选区操作」里的**扩展选区**，以及判决点名的**块注释智能选择器**）。
//
// 上游坐标（判定基准只有上游源码树）：
//   · 驱动 —— `platform/lang-impl/src/com/intellij/codeInsight/editorActions/SelectWordUtil.java:199-212`
//     （`processElement` 遍历 `ExtendWordSelectionHandler.EP_NAME` 的扩展点，收集
//     `canSelect(element)` 为真的那些，按注册顺序逐个跑，**第一个产出区间的就停**（`:211-212` 的 `stop`）。
//   · 扩展点注册顺序（决定谁先赢）—— `platform/lang-impl/resources/intellij.platform.lang.impl.xml`：
//     `NaturalLanguageTextSelectioner` → `WordSelectioner` → `LineCommentSelectioner`
//     → `BlockCommentSelectioner` → `InjectedFileReferenceSelectioner`。
//   · 基类永远补一个词 —— `wordSelection/AbstractWordSelectioner.java:23-33`：
//     先取自己的区间（`canSelect` 为真时），**无条件**再
//     `SelectWordUtil.addWordOrLexemeSelection(camelWords, …)`。
//   · 块注释选择器 —— `wordSelection/BlockCommentSelectioner.java:26-37`：
//     `elementText` 必须以 `blockStart` 开头且以 `blockEnd` 结尾（`:33`），产出的是
//     **去掉两个分隔符之后的内容区间** `[start + blockStart.length, end - blockEnd.length]`（`:35-36`）。
//     它实现的是 `ExtendWordSelectionHandler` 而不是 `AbstractWordSelectioner`，所以这一层**不叠词**。
//   · 行注释选择器 —— `wordSelection/LineCommentSelectioner.java:28-61`：
//     `super.select`（词区间）+ 从当前注释沿**空白**向前/向后走到注释链的首尾（`:33-55`），
//     再 `expandToWholeLine`（`:57-58`）。`expandToWholeLine`
//     （`editorActions/ExtendWordSelectionHandlerBase.java:109-127`）**区间里没有 `\n` 就原样返回**，
//     有换行才对称扩到整行。
//   · 词/词素 —— `addWordOrLexemeSelection` 认两种粒度：整个词，以及驼峰切出来的词素
//     （`isCamelWords()` 为真时）。本仓把这两级都做成层级，按下一次的顺序由内到外。
//
// **与上游的差别（如实写清，不是"顺手修正"）**：
//   1. 上游整个链挂在 **PSI 元素**上（`canSelect(PsiElement)` 问的是"光标处那个元素是不是注释"）。
//      本仓没有语法树，所以「光标处是什么」按**词法**判定：块注释 = 向前找最近的 `blockStart`
//      且其后有配对的 `blockEnd`；行注释 = 光标所在行的行首空白之后是否以已知行注释前缀开头。
//      后果：字符串里的 `/*`、`//` 也会被当成注释边界（与 `src/postFormatProcessors.ts`
//      记的同一个口径），而注释里嵌套的引号不会。
//   2. `NaturalLanguageTextSelectioner`（散文按词扩展）**不做**：它要 `NaturalLanguageText`
//      的分词数据，本仓没有。按扩展点顺序它在 `WordSelectioner` 之前，跳过它不影响
//      「谁先赢」的结论 —— 散文分层在源码类上不是 PSI 注释，两条链互斥。
//   3. `InjectedFileReferenceSelectioner`（注入语言的文件引用）**不做**：注入语言是 IDE 侧
//      的 PSI 机制，本仓的 LSP 链路不产生它。
//   4. `canSelect` 里 `PsiDocCommentBase`（文档注释 `/** */`）在 `BlockCommentSelectioner.java:22`
//      被排除 —— 本仓**照抄**：块注释层不认 `/**` 开头的那种。
//   5. 键位**无法核实**：`$default.xml`（`platform/platform-resources/src/keymaps/$default.xml`）
//      里没有 ExtendSelection 的绑定，全树也没有 `EditorExtendSelectionHandler` 这个类
//      （`editor/actions/` 下搜不到）。所以本模块只提供命令与菜单项，**不挂键位** ——
//      按仓里「无上游依据不编键位」的规矩（见 CodeEditor.vue keymap 里折叠那一族的同款注释）。
import type { CommentStyle } from './commentToggle.ts'

export interface ExtendRange {
  from: number
  to: number
}

export interface ExtendSelectionInput {
  text: string
  /** 选区里**正在长大**的那一端的偏移（`EditorSelection.main.head`）。 */
  head: number
  /** 当前选区；空选区传 `{ from: head, to: head }`。 */
  current: ExtendRange
  /** 这门语言的注释词法（上游 `Commenter` 的两个 getter）。认不出的语言传 null。 */
  style: CommentStyle | null
}

// ── 层级：按上游扩展点顺序，由内到外 ──────────────────────────────────────────

/**
 * 光标处能扩展到的所有层级，**由内到外**排好（同长度的按起点排）。
 * 空数组 = 这一带没有可扩展的层级（命令据此返回 false，不吞键）。
 */
export function extendLevels(input: ExtendSelectionInput): ExtendRange[] {
  const out: ExtendRange[] = []
  const push = (range: ExtendRange | null) => {
    if (!range) return
    if (range.to <= range.from) return
    if (out.some(seen => seen.from === range.from && seen.to === range.to)) return
    out.push(range)
  }
  // ① 词 → ② 词素（驼峰）。`AbstractWordSelectioner.java:31` 两者都在基类里。
  push(lexemeRange(input.text, input.head))
  push(wordRange(input.text, input.head))
  // ② 行注释链（`LineCommentSelectioner.java:57-58`）—— 只在**行注释**这一带才成立。
  push(lineCommentRunRange(input.text, input.head, input.style?.line))
  // ③ 块注释内容（`BlockCommentSelectioner.java:35-36`）—— 注册顺序在行注释之后。
  push(blockCommentContentRange(input.text, input.head, input.style?.block))
  return out.sort((left, right) => (left.to - left.from) - (right.to - right.from) || left.from - right.from)
}

/**
 * 按下一次的下一层（`forward` 决定往右还是往左长）。
 * 没有比当前更大的层级时返回 null —— 调用方返回 false，键继续往下走。
 */
export function extendSelection(input: ExtendSelectionInput, forward: boolean): ExtendRange | null {
  for (const level of extendLevels(input)) {
    // 往右长要 `to` 更大，往左长要 `from` 更小；另一头不动。
    if (forward ? level.to > input.current.to : level.from < input.current.from) {
      return forward ? { from: input.current.from, to: level.to } : { from: level.from, to: input.current.to }
    }
  }
  return null
}

// ── ① 词与词素 ────────────────────────────────────────────────────────────────

/** `JavaCharacter.isJavaIdentifierPart` 的常用子集（字母/数字/`_`/`$`）。 */
function isIdentifierPart(character: string | undefined): boolean {
  return !!character && /[\p{L}\p{N}_$]/u.test(character)
}

/**
 * 光标处的整个词（`SelectWordUtil.addWordOrLexemeSelection` 的「词」那一档）。
 * 光标不在词上时返回 null（上游此时只给空白扩展，见下方注释里的取舍）。
 */
export function wordRange(text: string, head: number): ExtendRange | null {
  if (head < 0 || head > text.length) return null
  // 词可以「右含」光标：光标紧贴词尾时选中那个词（上游 `addWordOrLexemeSelection` 的 `first` 分支）。
  let start = head
  while (start > 0 && isIdentifierPart(text[start - 1])) --start
  let end = head
  while (end < text.length && isIdentifierPart(text[end])) ++end
  if (start === end) return null
  return { from: start, to: end }
}

/**
 * 驼峰词素（`isCamelWords()` 那一档）：`getValueName` 那种切法 —— 大小写切换处、
 * 以及「字母↔数字」处断开，`FOO_BAR` 的下划线也算断点。
 * 光标不在词内时返回 null。
 */
export function lexemeRange(text: string, head: number): ExtendRange | null {
  const word = wordRange(text, head)
  if (!word) return null
  // 光标必须在词**内部**（紧贴词尾时上游给的是整个词，不是词素）。
  if (head <= word.from || head >= word.to) return null
  const isBoundary = (index: number) => {
    if (index <= word.from) return true
    const previous = text[index - 1]!
    const current = text[index]!
    if (isIdentifierPart(previous) !== isIdentifierPart(current)) return true
    if (previous === '_' || current === '_') return true
    const previousUpper = previous.toUpperCase() === previous && previous.toLowerCase() !== previous
    const currentUpper = current.toUpperCase() === current && current.toLowerCase() !== current
    // `fooBar` 的 `B` 前面断开；`FOOBar` 的 `B` 前面**不**断（连续全大写算一个词素）。
    return currentUpper && !previousUpper
  }
  // 左端 = 最后一个 `<= head` 的断点（没有就用词首）；右端 = 它之后第一个断点（没有就用词尾）。
  // 不能从 `word.from`/`word.to` 起「往回走」：那两个位置自己就是边界，一步都走不动。
  let start = word.from
  for (let index = word.from + 1; index <= head; ++index) if (isBoundary(index)) start = index
  let end = word.to
  for (let index = start + 1; index < word.to; ++index) {
    if (isBoundary(index)) { end = index; break }
  }
  return start === end ? null : { from: start, to: end }
}

// ── ② 行注释链 ────────────────────────────────────────────────────────────────

/**
 * `LineCommentSelectioner.select`（`:33-58`）的文本等价物：沿**空白**向前/向后走到注释链首尾，
 * 再 `expandToWholeLine`。
 *
 * 词法判定：某行算「这一段」当且仅当它的行首空白之后以 `prefix` 开头；算「空白」当且仅当整行只有空白
 * （`LineCommentSelectioner.java:39`/`:51` 的 `!(e instanceof PsiWhiteSpace)` 那一半）。
 * `expandToWholeLine`（`ExtendWordSelectionHandlerBase.java:117-119`）：链里**只有一行**时
 * 原样返回那行注释自己（不含行首空白、去掉行尾空白）；有多行才对称扩到整行边界。
 */
export function lineCommentRunRange(text: string, head: number, prefix?: string): ExtendRange | null {
  if (!prefix) return null
  const headLine = lineStartAt(text, head)
  const commentAt = headLine + leadingWhitespace(text, headLine)
  if (!text.startsWith(prefix, commentAt)) return null
  if (head < commentAt + prefix.length) return null

  let first = headLine
  let last = lineEndAt(text, head)
  let lines = 1
  while (first > 0) {
    const previousStart = lineStartAt(text, first - 1)
    if (!isLineCommentLine(text, previousStart, prefix) && !isBlankLine(text, previousStart)) break
    first = previousStart
    ++lines
  }
  while (last < text.length) {
    const nextStart = last + 1
    if (nextStart >= text.length) break
    if (!isLineCommentLine(text, nextStart, prefix) && !isBlankLine(text, nextStart)) break
    last = lineEndAt(text, nextStart)
    ++lines
  }

  // `expandToWholeLine`（`ExtendWordSelectionHandlerBase.java:117-119`）：区间里**没有换行**就
  // 原样返回注释元素自己 —— 起点是前缀处（不是行首空白），终点去掉行尾空白。
  // 判据用**行数**而不是「首尾偏移相等」：`first` 是行首、`last` 是行尾，单行时两者也永远不相等。
  if (lines === 1) {
    let end = last
    while (end > commentAt && (text[end - 1] === ' ' || text[end - 1] === '\t')) --end
    return { from: commentAt, to: end }
  }
  // 多行：对称扩到整行边界（`getExpandedRange` 的两端）。
  return { from: first, to: Math.min(text.length, last + 1) }
}

function isLineCommentLine(text: string, lineStart: number, prefix: string): boolean {
  const at = lineStart + leadingWhitespace(text, lineStart)
  return text.startsWith(prefix, at)
}

function isBlankLine(text: string, lineStart: number): boolean {
  return leadingWhitespace(text, lineStart) >= lineEndAt(text, lineStart)
}

function leadingWhitespace(text: string, lineStart: number): number {
  let at = lineStart
  while (at < text.length && (text[at] === ' ' || text[at] === '\t')) ++at
  return at - lineStart
}

/** 行首偏移（`head` 落在 `\r` 上时也算同一行）。 */
function lineStartAt(text: string, head: number): number {
  let at = Math.min(Math.max(0, head), text.length)
  while (at > 0 && text[at - 1] !== '\n') --at
  return at
}

/** 行尾偏移（不含换行符）。 */
function lineEndAt(text: string, head: number): number {
  const start = lineStartAt(text, head)
  const index = text.indexOf('\n', start)
  let end = index < 0 ? text.length : index
  if (end > start && text[end - 1] === '\r') --end
  return end
}

// ── ③ 块注释内容（判决点名的「块注释智能选择器」）────────────────────────────────

/**
 * `BlockCommentSelectioner.select`（`:26-37`）的文本等价物。
 *
 * 上游那三道门逐条照抄：
 *   · `:28-31` 语言没有 `Commenter`、或 `blockStart`/`blockEnd` 任一为 null ⇒ 不选；
 *   · `:33` 元素文本必须以 `blockStart` 开头**且**以 `blockEnd` 结尾（没闭合的注释不选）；
 *   · `:22` 的 `PsiDocCommentBase`（文档注释）被 `canSelect` 排除 ⇒ 斜杠星号打头、
 *     第三个字符又是星号（且第四个不是斜杠）的那种不选。
 * 产出 `[块注释起点 + open.length, 块注释终点 - close.length]`，即**两个分隔符之间的内容**。
 */
export function blockCommentContentRange(
  text: string,
  head: number,
  block?: readonly [string, string],
): ExtendRange | null {
  if (!block) return null
  const [open, close] = block
  if (!open || !close) return null
  const found = blockCommentAt(text, head, open, close)
  if (!found) return null
  // `[elementRange.start + blockStart.length, elementRange.end - blockEnd.length]`，而
  // `elementRange.end` 就是收尾分隔符的**末尾**，所以右端 = 收尾分隔符的**起点**。
  return { from: found.openAt + open.length, to: found.closeAt }
}

/**
 * 找到包住 `head` 的那个块注释；找不到返回 null。
 * 向前找最近的 `open`，再向后找配对的 `close`，光标必须落在两个分隔符**之间**。
 * 字符串字面量里的块注释起始标记也会被算进来 —— 与 `src/postFormatProcessors.ts`
 * 记的同一个取舍。
 */
function blockCommentAt(
  text: string,
  head: number,
  open: string,
  close: string,
): { openAt: number; closeAt: number } | null {
  // 注意 `at` 必须**单调递减**：`lastIndexOf(open, -1)` 会把 fromIndex 夹到 0，
  // 于是 `at === 0` 时下一轮又拿到 0 —— 那是死循环，不是"没找到"。
  for (let at = text.lastIndexOf(open, Math.max(0, head - 1)); at >= 0; at = at === 0 ? -1 : text.lastIndexOf(open, at - 1)) {
    // `:33` 的「必须以 blockEnd 结尾」：没配上的 `/*` 不算注释起点。
    const closeAt = text.indexOf(close, at + open.length)
    if (closeAt < 0) return null
    if (head < at + open.length || head > closeAt) continue  // 光标不在这个块的内容里
    // `:22` 排除 `/**` 文档注释。`open` = `/*` 时，第三个字符是 `*` 且第四个不是 `/`。
    if (open === '/*' && text[at + 2] === '*' && text[at + 3] !== '/') continue
    return { openAt: at, closeAt }
  }
  return null
}
