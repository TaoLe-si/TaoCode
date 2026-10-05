// 「完成当前语句」（IDEA Smart Enter / `EditorCompleteStatement`）的**文本子集**。
//
// 上游：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/smartEnter/SmartEnterAction.java`
//   · 键位 Ctrl+Shift+Enter（`$default.xml:87-89`，动作 id `EditorCompleteStatement`）；
//   · 逐个 `SmartEnterProcessor` 试，谁都处理不了就退回普通回车（`:90-96` `plainEnter`）。
// 真正的处理器按 PSI 补 `)`/`}`/`;` 并把光标放到语句末尾；本仓没有 PSI，所以只做**词法级**
// 的补齐：当前行里未闭合的圆/方/花括号（字符串、字符、行注释里的不算）在行尾补上，
// 落单的块注释补 `*/`。补完光标停在插入内容之后，与上游"光标到语句末尾"一致。
//
// 判不了的场合（行里有多余的右括号、光标在字符串里且没缺括号）返回 null —— 命令据此
// 返回 false，菜单提示"没有可做的改动"，而不是凭空插一个字符。

export interface CompletionEdit {
  /** 从当前行的这个偏移开始替换（行内偏移）。 */
  from: number
  /** 要插入的文本（替换到行尾的空白之前）。 */
  insert: string
}

/**
 * 扫描**当前行**（`lineText`，不含行尾换行），`caret` 是行内偏移。
 * 返回行尾补齐编辑；没有可补的返回 null。
 */
export function completeStatement(lineText: string, caret: number): CompletionEdit | null {
  const limit = Math.max(0, Math.min(caret, lineText.length))
  const stack: string[] = []
  let inBlockComment = false
  let lineCommentAt = -1
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i]!
    const next = lineText[i + 1]
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++ }
      continue
    }
    if (ch === '/' && next === '/') { lineCommentAt = i; break }   // 行注释：后面都不是代码
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue }
    if (ch === '"' || ch === '\'' || ch === '`') { i = skipString(lineText, i); continue }
    if (ch === '(' || ch === '[' || ch === '{') { stack.push(ch); continue }
    if (ch === ')' || ch === ']' || ch === '}') {
      const open = stack.pop()
      if (open === undefined || pairOf(open) !== ch) return null  // 多余的右括号：不敢猜，交给用户
    }
  }
  // 光标之前的未闭合块注释才算"要补的注释"——光标在注释后面时用户已经在往里写了。
  const unterminatedComment = inBlockComment && isInsideBlockComment(lineText, limit)
  if (!stack.length && !unterminatedComment) return null
  // 补在行尾空白之前；行尾有行注释时补在 `//` 之前（补在注释后面等于补了一句死文本）。
  const contentEnd = lineCommentAt >= 0 ? trailingSpaceStart(lineText.slice(0, lineCommentAt)) : trailingSpaceStart(lineText)
  // 光标后面还有代码（同一行里的多语句）时不动，避免把补全插到另一条语句后面。
  if (limit < contentEnd && stack.length) return null
  // 注释先闭合：块注释没闭合时，括号补在 `*/` 之后才是活代码（补在前面会被注释吃掉）。
  const insert = (unterminatedComment ? '*/' : '') + stack.reverse().map(pairOf).join('')
  return { from: contentEnd, insert }
}

/** 从字符串起始引号处跳到闭引号之后的索引（与 `for` 的 `i++` 配合返回闭引号下标）。 */
function skipString(text: string, quoteIndex: number): number {
  const quote = text[quoteIndex]!
  for (let i = quoteIndex + 1; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '\\') { i++; continue }
    if (ch === quote) return i
  }
  return text.length - 1
}

const pairOf = (open: string): string => open === '(' ? ')' : open === '[' ? ']' : '}'

/** 行尾空白之前的位置（补在行尾、而不是空白后面）。 */
function trailingSpaceStart(text: string): number {
  let i = text.length
  while (i > 0 && (text[i - 1] === ' ' || text[i - 1] === '\t')) i--
  return i
}

/** `offset` 之前是否已经进入且没闭合 `/*`（用于判断要不要补 `*​/`）。 */
function isInsideBlockComment(text: string, offset: number): boolean {
  let inComment = false
  for (let i = 0; i < offset; i++) {
    const ch = text[i]!
    const next = text[i + 1]
    if (inComment) { if (ch === '*' && next === '/') { inComment = false; i++ } continue }
    if (ch === '/' && next === '/') return false
    if (ch === '/' && next === '*') { inComment = true; i++ }
    else if (ch === '"' || ch === '\'' || ch === '`') i = skipString(text, i)
  }
  return inComment
}
