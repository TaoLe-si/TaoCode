// 补全的**插入处理器 / 尾类型**（`com.intellij.codeInsight.completion` 的纯逻辑子集）。
//
// 上游坐标：
//   · `AddSpaceInsertHandler.java:22-55`：接受条目后，若插入点后继不是空格就补一个空格；
//     已经是空格就把光标越过去（overwrite）。`VALID_COMPLETION_CHARS = "\u0000\n\t\r(,.:="`
//     是**完成字符门禁** —— 用 `(`/`,`/`.`/`:`/`=` 接受时不补空格（那时后面本来就跟这些符号）。
//   · `TailType.java:47-70` 的 `insertChar`：后继已是同一字符且 overwrite ⇒ 不插入、只把光标后移。
//   · `FrontendFriendlyTailTypes.kt:33-49` 的 `HumbleSpaceBeforeWordTailType`：后继是
//     `空格 + 词/@` 时不插；否则**总是**插一个空格（overwrite=false）。
//   · `DeclarativeInsertHandler.kt:64-95`：相对文本编辑 + 应用完成后的光标偏移。
//
// 本仓的落点：LSP 补全在 `src/lspCompletion.ts` 的 `apply` 里按条目种类选一个尾类型，
// 把尾文本并进同一次 dispatch（不是插入条目后再改一次文档，免得留下两个 undo 步）。
// 与上游的差别（写在判词里）：本仓没有 `InsertionContext.completionChar`（用户按 Enter/Tab/
// 点了哪一项由 CodeMirror 决定，apply 拿不到），所以门禁改为看**插入点后继字符**；
// 语言插件式的逐语言注册面没有（按 LSP 条目种类给默认尾类型）。
/** 尾类型：插入点之后要补的东西与光标落点。纯数据，便于单测。 */
export type TailType =
  | { kind: 'none' }
  | { kind: 'char'; char: string; overwrite: boolean }
  | { kind: 'humble-space' }
  | { kind: 'parens' }

export interface TailPlan {
  /** 要插到插入点之后的文本。 */
  insert: string
  /** 尾文本应用完成后，光标相对插入点的偏移（0 = 停在插入点）。 */
  caret: number
}

export const NO_TAIL: TailPlan = { insert: '', caret: 0 }

/** `TailType.insertChar` 的字符串版：后继是同字符且 overwrite ⇒ 只把光标后移一位。 */
export function planCharTail(textAfter: string, char: string, overwrite: boolean): TailPlan {
  if (textAfter === '' || !overwrite || textAfter[0] !== char) return { insert: char, caret: 1 }
  return { insert: '', caret: 1 }
}

/** `HumbleSpaceBeforeWordTailType`：`空格 + 词/@` 时不插，否则总是插一个空格。 */
export function planHumbleSpace(textAfter: string): TailPlan {
  if (textAfter.length > 1 && textAfter[0] === ' ' && (textAfter[1] === '@' || /\p{L}/u.test(textAfter[1]!)))
    return { insert: '', caret: 0 }
  return { insert: ' ', caret: 1 }
}

/** 方法/函数条目：补 `()`，光标落在括号内；后继已是 `(` 时只把光标移进去。 */
export function planParensTail(textAfter: string): TailPlan {
  if (textAfter.startsWith('(')) return { insert: '', caret: 1 }
  return { insert: '()', caret: 1 }
}

/**
 * `AddSpaceInsertHandler` 的字符串版。上游的门禁在**完成字符**上（见文件头）；
 * 这里换成插入点后继：`(`,`,`,`.`,`:`,`=` 与换行/制表符之后不补空格（补了会变成
 * `if (` → 重复空格或 `foo .` 这类脏文本），行尾也不补（没有下一个词要隔开）。
 */
export function planSpaceTail(textAfter: string): TailPlan {
  if (textAfter.startsWith(' ')) return { insert: '', caret: 1 }
  if (textAfter === '' || '(,.:=\n\t\r'.includes(textAfter[0]!)) return NO_TAIL
  return { insert: ' ', caret: 1 }
}

export function planTail(textAfter: string, tail: TailType): TailPlan {
  switch (tail.kind) {
    case 'char': return planCharTail(textAfter, tail.char, tail.overwrite)
    case 'humble-space': return planHumbleSpace(textAfter)
    case 'parens': return planParensTail(textAfter)
    default: return NO_TAIL
  }
}

const IDENTIFIER = /^[\p{L}\p{N}_$]+$/u

/**
 * 按 LSP 条目种类选尾类型。只对**裸标识符**生效：`insertText` 里已带括号/空格（服务端
 * 自己写好的形状、或 snippet —— snippet 在 `lspCompletion.ts` 已被过滤）时不重复加工。
 */
export function tailForCompletion(kind: string, insertText: string): TailType {
  if (!IDENTIFIER.test(insertText)) return { kind: 'none' }
  const normalized = kind.toLowerCase()
  if (normalized === 'keyword') return { kind: 'char', char: ' ', overwrite: true }
  if (normalized === 'method' || normalized === 'function' || normalized === 'constructor') return { kind: 'parens' }
  return { kind: 'none' }
}

/** 一次算出「接受这条补全后插入点之后要做什么」。 */
export function planCompletionTail(textAfter: string, kind: string, insertText: string): TailPlan {
  return planTail(textAfter, tailForCompletion(kind, insertText))
}

// ── `DeclarativeInsertHandler` 的相对文本编辑语义 ──────────────────────────────
// 上游契约（DeclarativeInsertHandler.kt:64-75）：各操作的区间**不许相交**、偏移互相独立
// （不按应用顺序推算），光标偏移按「所有操作都已应用」的假设给出。这里实现同一契约：
// 传入的 from/to 都是在**基准文本**里的坐标，应用后光标 = baseOffset + caretOffset。

export interface RelativeTextEdit { from: number; to: number; insert: string }

export interface DeclarativePlan {
  /** 编辑已应用的文本；契约被违反时原样返回输入。 */
  text: string
  caret: number
  error?: string
}

export function applyRelativeEdits(text: string, baseOffset: number, edits: RelativeTextEdit[], caretOffset: number): DeclarativePlan {
  const absolute = edits
    .map(edit => ({ from: edit.from + baseOffset, to: edit.to + baseOffset, insert: edit.insert }))
    .sort((a, b) => a.from - b.from || a.to - b.to)
  for (let i = 0; i < absolute.length; ++i) {
    const edit = absolute[i]!
    if (edit.from < 0 || edit.to < edit.from || edit.to > text.length)
      return { text, caret: baseOffset, error: '相对编辑越界' }
    if (i > 0 && edit.from < absolute[i - 1]!.to) return { text, caret: baseOffset, error: '相对编辑区间相交' }
  }
  let output = text
  for (let i = absolute.length - 1; i >= 0; --i) {
    const edit = absolute[i]!
    output = output.slice(0, edit.from) + edit.insert + output.slice(edit.to)
  }
  return { text: output, caret: baseOffset + caretOffset }
}
