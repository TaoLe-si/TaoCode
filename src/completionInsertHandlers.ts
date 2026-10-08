// 补全的**插入处理器 / 尾类型**（`com.intellij.codeInsight.completion` 的纯逻辑子集）。
//
// 上游坐标（本轮逐字重开对过行号；旧注释里的行号与一条**门禁方向**都是错的，订正见下）：
//   · `AddSpaceInsertHandler.java:44-62` 的 `handleInsert`：完成字符是空格、或在
//     `myIgnoreOnChars` 里就直接返回（`:48`）；否则 `isCharAtSpace` 为假就插一个空格（`:51-53`），
//     为真且 `shouldOverwriteExistingSpace` 就把光标越过那个空格（`:55-57`，默认实现 `:64-66` 恒真）。
//     **行尾也补**：`isCharAtSpace` 是 `document.getTextLength() > startOffset && charAt(startOffset)==' '`
//     （`:68-72`）—— 光标后面没有字符时它是**假**，所以走的是「插一个空格」那一支，不是「什么都不做」。
//   · 订正：`VALID_COMPLETION_CHARS = "\u0000\n\t\r(,.:="`（`:18`）在 `INSTANCE`（`:20-24`）里是
//     `CompositeDeclarativeInsertHandler.withUniversalHandler(VALID_COMPLETION_CHARS, …)` 的**键集**，
//     而 `DeclarativeInsertHandler.kt:26-31` 选 handler 的条件是 `key.contains(context.completionChar)`
//     且 `:35-42` 明确「不给 fallbackInsertHandler」⇒ 它是**白名单**：只有按 `\0 \n \t \r ( , . : =`
//     这些**完成字符**接受条目时才补空格；按空格接受不在名单里 ⇒ 不补。
//     旧注释写成「用 `(`/`,`/`.`/`:`/`=` 接受时**不**补空格」—— 方向是**反的**，本轮改掉。
//     （另注：这条白名单作用在**按下去的那个字符**上，与本仓下面那条「看插入点后继」不是同一档。）
//   · `TailType.java:50-58` 的 `insertChar(editor, tailOffset, c, overwrite)`：
//     `tailOffset == textLength || !overwrite || chars.charAt(tailOffset) != c` ⇒ 插入，随后光标 `+1`
//     （`:46-48` 是 `Editor` 重载；同一份判据里**行尾也算「要插」**，与上面 `isCharAtSpace` 同一方向）。
//   · `FrontendFriendlyTailTypes.kt:30-45` 的 `HumbleSpaceBeforeWordTailType`：
//     `:31-33` 完成字符不是空格才适用；`:35-44` 后继是 `空格 + 字母/@` 时不插，否则
//     `insertChar(navigator, tailOffset, ' ', false)`（overwrite=false ⇒ 即便后继是空格也插）。
//   · `DeclarativeInsertHandler.kt:54-64` 是相对编辑的契约注释、`:82-98` 是应用与光标落点
//     （从大到小替换、光标 = 原偏移 + `offsetToPutCaret`）。
//
// 本仓的落点：LSP 补全在 `src/lspCompletion.ts` 的 `apply` 里按条目种类选一个尾类型，
// 把尾文本并进同一次 dispatch（不是插入条目后再改一次文档，免得留下两个 undo 步）；
// 调用点是 `src/lspCompletion.ts:353`，取的是插入点之后 2 个字符。
// 与上游的差别（写在判词里，不假装一致）：
//   · 上游 LSP 那条路本身**不挂尾类型** —— `LspCompletionItemInsertHandler.kt:23-31` 只做
//     「附加编辑 → 条目自身的 handler → snippet → command」四步（本仓的同一顺序记在
//     `src/lspCompletion.ts:330-333`）。下面这几个尾类型是**本仓替 LSP 条目补的**呈现，
//     上游对应物存在于 PSI 贡献者那一路（`AddSpaceInsertHandler` / `TailType`）。
//   · 本仓没有 `InsertionContext.completionChar`（按 Enter/Tab 还是点选由 CodeMirror 决定，apply
//     拿不到），所以上游那条**完成字符白名单**在本仓落不了地。
//   · 语言插件式的逐语言注册面没有（按 LSP 条目种类给默认尾类型）。
//
// 订正留痕（本轮删掉的一个出口）：本文件原先另有一个 `planSpaceTail`（`AddSpaceInsertHandler` 的
// 字符串版），但它**没有生产者也没有分派点** —— `planTail` 的 switch 里没有那一支、
// `tailForCompletion` 也从不产出它，`src/` 全域只有它自己的判据在调 ⇒ 按「死代码直接删」删除。
// 它原先的注释还把 `VALID_COMPLETION_CHARS` 的方向写反（见上），且把「行尾不补空格」写成事实
// —— 两条都与上游相反。**关键字条目的补空格那一档本来就走活的那条路**：
// `tailForCompletion('keyword', …)` → `{ kind: 'char', char: ' ', overwrite: true }` →
// `planCharTail`，而 `planCharTail('')` 在行尾是**插**（与 `isCharAtSpace`/`insertChar` 同方向），
// 删掉那份重复且写反的实现不改变任何现网行为；那一格由
// `tests/completion-insert-handlers.test.mjs` 钉住（把行尾改回"不补"就红）。
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

/** `TailType.insertChar` 的字符串版（`TailType.java:50-58`）：`tailOffset == textLength`（行尾）、
 *  不开 overwrite、或后继不是同一字符 ⇒ **插**；只有「后继已是同字符且 overwrite」才只把光标后移。
 *  行尾那一格与 `AddSpaceInsertHandler.java:68-72` 的 `isCharAtSpace` 同方向（行尾 ⇒ 要插）。 */
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
