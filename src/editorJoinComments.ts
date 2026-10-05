// 注释里的「合并行」（`lp/editor-actions` 判决缺项 ⑥ 点名的 `CommentJoinLinesHandler`）。
//
// Ctrl+Shift+J 落在注释里时，IDEA 不是把两行简单粘成一串，而是
//   · **吃掉第二行的行注释前缀**（`// aaa` + `// bbb` → `// aaa bbb`）；
//   · 吃掉块注释每行开头的 `*`（`/* 说明\n * 第二行\n */` → `/* 说明 第二行 */`）；
//   · 合并后**超过右边距**时不把整行拉上来，只把不越界的那部分搬上去（`region` 里的说法是
//     "Respect right margin"）；
//   · 这些都不适用时才退回普通粘连。
//
// 上游坐标（判定基准只有上游源码树）：
//   · 键位：`platform/platform-resources/src/keymaps/$default.xml:82-84` `EditorJoinLines` = Ctrl+Shift+J。
//   · 动作实现：`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:278` 是普通版
//     （`JoinLinesAction`），但语言侧把处理器整个换掉了：
//     `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1265`
//     `<editorActionHandler action="EditorJoinLines" implementationClass="…JoinLinesHandler"/>`；
//     注释那一支是同一个文件 `:1676` 的 `<joinLinesHandler implementation="…CommentJoinLinesHandler" order="last"/>`。
//   · 两个偏移怎么取（本模块的 `start`/`end` 与它逐字对齐）：
//     `platform/lang-impl/src/com/intellij/codeInsight/editorActions/JoinLinesHandler.java:209-211`
//     —— `start` = 从行尾往回跳过空白，`end` = 从下一行行首跳过 `" \t\n"`；
//     `:214` 的门槛（两侧都得有内容：`start > 0` 且前一个字符不是换行）、`:216-225` 逐个问委托、
//     `:227-229` 委托不认（`CANNOT_JOIN`）时才算这一对被跳过。
//   · 注释委托本体：`CommentJoinLinesHandler.java:31-33`（两侧都在注释里，否则 `CANNOT_JOIN`）、
//     `:41-46`（块注释续行的行首 `*`，`*/` 结尾且下一个字符不是 `/` 才吃）、
//     `:47-57`（行文档注释前缀，Java 是 `///`：`java/java-psi-impl/src/com/intellij/lang/java/JavaCommenter.java:99-100`）、
//     `:58-89`（两行**相邻的行注释**：吃前缀 + 尊重右边距那段）、`:92-93`（收尾：相邻或同一注释内 → 粘一个空格，否则什么都不插）。
//   · 右边距：`platform/code-style-api/src/com/intellij/psi/codeStyle/CodeStyleSettings.java:430`
//     `public int RIGHT_MARGIN = 120`（本仓没有逐语言的代码风格设置面 ⇒ 用这个默认档，
//     并把「按设置覆盖」留成入参，见 `joinCommentLines` 的 `margin`）。
//
// 与本仓既有实现的关系：`src/editorCommands.ts` 的 `joinLinesCommand` 是普通粘连那一档
// （等价于 `JoinLinesAction.java:40-51`）。本模块只补注释那一档，并且**只在整段选区都是注释时**
// 才接管 —— 半段注释半段代码时上游要按行分别问委托，本仓一次命令只做一种，退回去
// 至少不会把代码行粘坏（这条差别在报告的「做不到」栏里有记录）。

/** 一门语言的注释词法（`Commenter` 里本模块用得着的那三个 getter）。 */
export interface JoinCommentStyle {
  /** 行注释前缀（`Commenter.getLineCommentPrefix`）。 */
  line?: string
  /** 块注释前后缀（`getBlockCommentPrefix` / `getBlockCommentSuffix`）。 */
  block?: readonly [string, string]
  /** 行文档注释前缀（`CodeDocumentationAwareCommenter.getDocumentationLineCommentPrefixes`，`:105-107`）。 */
  docLines?: readonly string[]
  /**
   * 这门语言有 raw string（C++ 的 `R"(…)"`）：里面的 `//` 与不成对的引号都不该当注释/字面量边界。
   * 上游由 PSI 认，本仓按开关跳过整段。C++ 的注释标记本身在
   * `cpp/openapi/src/com/intellij/language/cpp/psi/CppCommenter.java:13-15`（`//` 与 `/* … *\/`）。
   */
  rawStrings?: boolean
}

/** Java 的行文档注释是 `///`（JavaCommenter.java:99-100）；其余语言**无法核实**，不给。 */
export const JOIN_DOC_LINE_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  java: ['///'],
}

export interface CommentSpan { from: number; to: number; kind: 'line' | 'block' }

const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'

/** 从 `at` 往右跳过这些字符（`StringUtil.skipWhitespaceForward` / `CharArrayUtil.shiftForward`）。 */
export function skipForward(text: string, at: number, chars: string): number {
  let out = Math.max(0, at)
  while (out < text.length && chars.includes(text[out]!)) ++out
  return out
}

/** 从 `at` 往左跳过空白（`StringUtil.skipWhitespaceBackward`）。 */
export function skipBackward(text: string, at: number): number {
  let out = Math.min(at, text.length)
  while (out > 0 && isSpace(text[out - 1])) --out
  return out
}

// 字符串字面量里的 `//` 不是注释：扫注释时先跳过字面量。
// 上游量的是 PSI 的 token 边界（`findElementAt` 给的就是「这个偏移属于哪个 token」），
// 文本层只能自己维护字面量状态 ⇒ 这里按引号那一档做：
//   · `"` / `'` 不跨行（Java/C++ 的字符串与字符字面量都不含裸换行，行尾即作废）；
//   · `` ` `` 跨行直到下一个未转义的 `` ` ``（JS/TS 的模板串）；
//   · **撇号陷阱**：不在字面量里时 `can't` 的那个 `'` 不是字符串开头（Java/C++ 的字符字面量一定闭合），
//     只有已经由 `"` 或 `` ` `` 进了字面量，才认 `'`（Rust 的生命期 `'a` 同理）。
//   · C++/Rust 的 raw string（`R"( ... )"`）里可以出现 `//` 与不成对的引号：上游的 PSI 认得，
//     纯文本扫认不出 ⇒ 由 `JoinCommentStyle.rawStrings` 显式开启跳过。

/** 逐段扫出全文的注释区间（上游那一步靠 PSI 的 `PsiComment`，本仓只有文本）。 */
export function commentSpans(text: string, style: JoinCommentStyle): CommentSpan[] {
  const spans: CommentSpan[] = []
  const line = style.line
  const open = style.block?.[0]
  const close = style.block?.[1]
  let string = ''
  for (let at = 0; at < text.length;) {
    const ch = text[at]!
    const next = text[at + 1]
    if (string) {
      if (ch === '\\') { at += 2; continue }
      if (ch === string) { string = ''; ++at; continue }
      if (ch === '\n' && string !== '`') { string = ''; continue }
      ++at
      continue
    }
    if (style.rawStrings && ch === 'R' && next === '"') {
      const end = text.indexOf(')"', at + 3)
      at = end < 0 ? text.length : end + 2
      continue
    }
    if (ch === '"' || ch === '`') { string = ch; ++at; continue }
    if (line && text.startsWith(line, at)) {
      const end = indexOfOrNull(text, '\n', at) ?? text.length
      spans.push({ from: at, to: end, kind: 'line' })
      at = end
      continue
    }
    if (open && close && text.startsWith(open, at)) {
      const end = indexOfOrNull(text, close, at + open.length)
      const to = end === null ? text.length : end + close.length
      spans.push({ from: at, to, kind: 'block' })
      at = to
      continue
    }
    ++at
  }
  return spans
}

function indexOfOrNull(text: string, needle: string, from: number): number | null {
  const at = text.indexOf(needle, from)
  return at < 0 ? null : at
}

/** 落在注释里的那一段（`PsiTreeUtil.getNonStrictParentOfType(findElementAt(offset), PsiComment.class)`）。 */
export function spanAt(spans: readonly CommentSpan[], offset: number): CommentSpan | null {
  for (const span of spans) if (span.from <= offset && offset < span.to) return span
  return null
}

export interface JoinStep { text: string; caret: number }

/** 一次合并的完整结果：整篇新文本、光标位置，以及**替换范围**与该范围的新内容。 */
export interface JoinResult extends JoinStep { from: number; to: number; filled: string }

// 行首偏移表（每次落地一个编辑后重算，注释行数量小，代价可以接受）。
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; ++i) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

/**
 * 合并第 `line` 行与它的下一行（`JoinLinesHandler.java:209-211` 取偏移 +
 * `CommentJoinLinesHandler.java` 的四支判定）。注释之外 ⇒ null（上游的 `CANNOT_JOIN`）。
 */
export function joinCommentBreak(
  text: string, line: number, style: JoinCommentStyle, margin: number, spans?: readonly CommentSpan[],
): JoinStep | null {
  const starts = lineStarts(text)
  if (line < 0 || line + 1 >= starts.length) return null
  const lineEnd = starts[line + 1]! - 1                      // 该行 `\n` 的位置（末行时 = text.length）
  const nextLineEnd = starts[line + 2] !== undefined ? starts[line + 2]! - 1 : text.length
  // `:210` start = 行尾往回跳空白；`:211` end = 换行之后跳过 " \t\n"。
  let start = skipBackward(text, lineEnd)
  let end = skipForward(text, Math.min(lineEnd + 1, text.length), ' \t\n')
  // `:214` 的门槛：起始行得有内容（前一个字符不能是换行），且 `end` 没跑出下一行末尾。
  if (start <= 0 || text[start - 1] === '\n' || end >= nextLineEnd) return null
  // `:31-33` 两侧都得在注释里。
  const all = spans ?? commentSpans(text, style)
  const prev = spanAt(all, start - 1)
  const next = spanAt(all, end)
  if (!prev || !next) return null
  const sameComment = prev.from === next.from && prev.to === next.to
  const blockSuffix = style.block?.[1]
  let adjacent = false
  // `:41-46` 块注释续行的行首 `*`（`*/` 收尾且下一个字符不是 `/` ⇒ 那是续行星号，不是收尾）。
  if (blockSuffix === '*/' && text[end] === '*' && end + 1 < text.length && text[end + 1] !== '/') {
    end = skipForward(text, end + 1, ' \t')
  } else if (sameComment && style.docLines?.length) {
    // `:47-57` 行文档注释前缀（Java 的 `///`）。
    for (const prefix of style.docLines) {
      if (!text.startsWith(prefix, end)) continue
      end = skipForward(text, end + prefix.length, ' \t')
      break
    }
  } else if (!sameComment && !(blockSuffix && text.slice(Math.max(0, start - blockSuffix.length), start) === blockSuffix)) {
    // `:58-64` 相邻的两个行注释：吃掉第二行的前缀与其后的空白。
    const prefix = style.line
    if (!prefix || !text.startsWith(prefix, end)) return null
    adjacent = true
    end = skipForward(text, end + prefix.length, ' \t')
    // `:65-87` 合并后会越过右边距 ⇒ 只搬不越界的那一截（按词边界往回退）。
    const lineLength = start - starts[line]!
    const tail = nextLineEnd - end
    if (lineLength <= margin && lineLength + tail + 1 > margin) {
      let allowedEnd = end + margin - lineLength - 1
      while (allowedEnd > end && !isSpace(text[allowedEnd])) --allowedEnd
      if (allowedEnd <= end) return { text, caret: end }      // `:77-80`「只挪光标，不动文本」
      const movedEnd = skipBackward(text, allowedEnd)
      const moved = text.slice(end, movedEnd)
      const lineBreak = text.indexOf('\n', start)
      // `:84-86`：先删第二行搬走的那段，再把第一行行尾到换行之间换成 `" " + moved`。
      const afterDelete = text.slice(0, end) + text.slice(allowedEnd + 1)
      const replaced = afterDelete.slice(0, start) + ` ${moved}` + afterDelete.slice(lineBreak)
      return { text: replaced, caret: start + 1 + moved.length + (end - lineBreak) }
    }
  }
  // `:92-93` 收尾：相邻行注释或同一注释内部 ⇒ 粘一个空格，否则直接接上。
  const insert = adjacent || sameComment ? ' ' : ''
  const joined = text.slice(0, start) + insert + text.slice(end)
  return { text: joined, caret: start + insert.length }
}

/** 偏移所在行（0 基）。 */
function lineAt(starts: readonly number[], offset: number): number {
  let line = 0
  while (line + 1 < starts.length && starts[line + 1]! <= offset) ++line
  return line
}

/**
 * 把 `from`…`to` 之间的行按**注释语义**合并（`CommentJoinLinesHandler` 的一条命令）。
 * 返回 null = 注释委托管不着（调用方退回普通粘连）。
 * `margin` 是右边距（上游 `CodeStyleSettings.RIGHT_MARGIN` 默认 120，见 `:430`）。
 * `from`/`to` 是**整块**的替换范围（首行行首 ⇒ 末行行尾，`filled` 是它的新内容）；
 * 光标落在合并后那一行的末尾。
 */
export function joinCommentLines(
  text: string, from: number, to: number, style: JoinCommentStyle, margin = 120,
): JoinResult | null {
  if (!style.line && !style.block) return null
  const starts = lineStarts(text)
  const first = lineAt(starts, from)
  // 空选区 = 把光标行与它的**下一行**接起来（普通档 `joinLinesCommand` 同一条语义，也是
  // `JoinLinesHandler.java:196-202` 的 `myLine`/`lineCount` 那一档）；有选区 = 选区跨到的那些行。
  const last = to > from ? lineAt(starts, Math.max(from, to - 1)) : first + 1
  // 至少要有**一个**换行处可合，并且末行得真的存在（光标在最后一行时无可合并）。
  if (last <= first || last > starts.length - 1) return null
  const blockFrom = starts[first]!
  const blockTo = last + 1 < starts.length ? starts[last + 1]! - 1 : text.length
  const spans = commentSpans(text, style)
  // 范围内每一个换行处（`first` … `last-1`）都得归注释委托管，否则整条命令退回普通粘连。
  for (let line = first; line < last; ++line) {
    if (!joinCommentBreak(text, line, style, margin, spans)) return null
  }
  let work = text
  // 每次都合并「首行之后那个换行」：一次命令把整段收拢（普通版 `joinLinesCommand` 同一条语义）。
  // 右边距那一支不减少行数，靠「文本没变化就停」兜住。
  for (let step = 0; step < last - first; ++step) {
    const result = joinCommentBreak(work, first, style, margin)
    if (!result || result.text === work) break
    work = result.text
  }
  if (work === text) return null
  const filled = work.slice(blockFrom, blockFrom + (blockTo - blockFrom) + (work.length - text.length))
  return { text: work, caret: blockFrom + filled.length, from: blockFrom, to: blockTo, filled }
}
