// Ctrl+W「按光标取词」（上游动作 `EditorSelectWord` = `SelectWordAtCaretAction`）的**纯逻辑**：
// 给文本 + 光标，算出这一次该选中的区间；再按一次就长到下一档。
//
// 上游坐标（判定基准只有上游源码树）：
//   · 动作类 `platform/lang-impl/src/com/intellij/openapi/editor/actions/SelectWordAtCaretAction.java`：
//     `DefaultHandler.doExecute:42-81` 是真正的取词体；`Handler.doExecute:92-100` 是外面那层
//     「缩进参考线优先」的包装（`:93-95` 有参考线且光标处是空白 ⇒ `selectWithGuide:112-135`，
//     否则落到它包着的 handler）。本仓**只移植 DefaultHandler 这一支**：缩进参考线模型不在本仓
//     （`src/editorIndentGuides.ts` 只画线、不出模型，同 `src/editorCodeBlock.ts:32-33` 记的同一个卡点）。
//   · 取词真源 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/SelectWordUtil.java`：
//     `addWordOrLexemeSelection:57-72`（词素 + 词两级，按这个顺序进 `ranges`）、
//     `getCamelSelectionRange:74-102`（驼峰词素）、
//     `getWordOrLexemeSelectionRange:114-142`（整个词，含 `isLexemeBoundary` 断点）。
//   · 驼峰断点 `platform/platform-impl/src/com/intellij/openapi/editor/actions/EditorActionUtil.java`
//     `isHumpBound:960-974`；`isLexemeBoundary:421-430` 要**高亮器 token 流**，本仓没有 ⇒ 见下。
//   · 标识符字符 `SelectWordUtil.java:31` = `Character.isJavaIdentifierPart`。
//   · 键位 `platform/platform-resources/src/keymaps/$default.xml:831-833` = `control W`。
//
// 连续按的档（`DefaultHandler` 的 `ranges` 列表 + `minimumRange` 兜底，逐档见 `selectWordLevels`）：
// 词素（仅 `isCamelWords`）→ 词 → 整行 → 整篇。上游自带的用例把这条阶梯钉死了：
// `platform/platform-tests/testData/codeInsight/selectWordWithoutPSIAction/test1/after1..after3`
// （nostrud → 整行 → 整篇）与同目录 `camelHumps/after1..after4`
// （Hump → CamelHump$word → 整行 → 整篇）。
//
// 与 `src/editorExtendSelection.ts` 的关系（**不是同一套**）：那个模块移植的是上游
// `SelectWordUtil.processRanges:144-224` 驱动的 `ExtendWordSelectionHandler` 扩展点链
// （词/词素/行注释链/块注释内容，判据挂在 PSI 元素上）；本模块移植的是**没有 PSI 时**的那一支
// （`DefaultHandler`）。上游 `EditorSelectWord` 在
// `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1252-1255` 注册了**两个** handler
// （`psi.select.word` = `SelectWordHandler`，`indent.guide.select.word` = 本动作的 `Handler`）；
// 没有 PSI 文件时 `SelectWordHandler` 落回它包着的 handler，最终到 `DefaultHandler` ——
// 上游 `platform/platform-tests/testSrc/com/intellij/codeInsight/SelectWordWithoutPSITest.java:52-69`
// 测的就是这一支。两者互补，不重复。
//
// 本仓没有的东西（如实登记，不编）：
//   · 引号内 / 注释内**没有**专门档：`DefaultHandler` 完全不认引号与注释标记，它们只是
//     「非标识符字符」⇒ 词那一档在引号处停住。上游「整个字符串字面量」那一档来自 PSI 的
//     `LiteralSelectioner`（`java/java-frontback-impl/resource/intellij.java.frontback.impl.xml:66`），
//     属于 `SelectWordHandler` 那条链，本模块不做。
//   · 缩进参考线档（`selectWithGuide:112-135`）不移植，理由见上。
//   · 密码编辑器档（`:45-48` 全选）留成入参 `password`：本仓编辑器没有密码模式，
//     由宿主按需给；不给就按普通文本走。
//   · 逆动作**不存在**：`platform/platform-impl/src/com/intellij/openapi/editor/actions/
//     UnselectWordAtCaretAction.java:27-31` 的 handler 体是**空的**（`doExecute` 里一句都没有），
//     键位 `$default.xml:754-756` = `control shift W` 绑的是这个空动作 ⇒ 本模块不提供「缩小」，
//     上游自己也没有。宿主若要「按一次退一档」，用 `selectWordLevels` 自己往下走一格。
//   · `SelectWordAtCurrentCaretAction.kt:18-59`（`EditorSelectWordAtCurrentCaret`）**不移植**：
//     `update:23-25` 把自己 `setEnabledAndVisible(false)`（上游把它从所有 UI 藏起来了），
//     唯一的行为差异是 `:36` 的 `HONOR_CAMEL_WORDS` 临时覆盖开关，没有用户可见入口。

/** 选区区间。与 `src/editorExtendSelection.ts` 的 `ExtendRange` 结构相同（那里是同一族动作的另一支）。 */
export interface ExtendRange {
  from: number
  to: number
}

export interface SelectWordInput {
  text: string
  /** 光标偏移（上游 `Caret.getOffset()`）。 */
  caret: number
  /** 当前选区（上游 `caret.getSelectionStart()/getSelectionEnd()`）；空选区省略。 */
  current?: ExtendRange
  /** 上游 `editor.getSettings().isCamelWords()`。默认 false —— 上游默认值就是 false，见下。 */
  camelWords?: boolean
  /**
   * 上游 `EditorActionUtil.isLexemeBoundary(editor, offset)`：光标所在语言的高亮器 token 流说
   * 「这个偏移是不是两个词素的边界」。本仓没有 token 流 ⇒ 默认恒 false（等价于上游
   * `getWordOrLexemeSelectionRange` 的 `editor == null` 分支，`SelectWordUtil.java:129`/`:134`）。
   * 宿主能拿到语言服务时传进来，词那一档就会在上游同款断点处停住。
   */
  lexemeBoundary?: (offset: number) => boolean
  /** 上游 `EditorUtil.isPasswordEditor(editor)`（`SelectWordAtCaretAction.java:45-48`）⇒ 全选。 */
  password?: boolean
}

/**
 * `Character.isJavaIdentifierPart` 的等价判定（`SelectWordUtil.java:31` 用的就是它）。
 * JLS 3.8 的构成：字母（`L`，含 CJK 那种 `Lo`）、字母数字（`Nl`）、数字（`Nd`）、
 * 货币符号（`Sc`，`$` 属于它）、连接标点（`Pc`，`_` 属于它）、组合标记（`Mn`/`Mc`），
 * 以及 `isIdentifierIgnorable` 那几个控制/格式区间。
 *
 * 注意两点，都与直觉不同（照上游，不改）：
 *   · CJK 是 `Lo` ⇒ **是**标识符字符 ⇒ 一串汉字算**一个词**（不是「没有词」）。
 *   · `$` 与 `_` 都算标识符字符（`Sc`/`Pc`），所以 `CamelHump$word` 是一个词。
 * 与 `src/editorExtendSelection.ts` 的 `isIdentifierPart`（`/[\p{L}\p{N}_$]/u`）差在：
 * 那边漏了 `Sc`（除 `$` 外的货币符号）、`Pc`（除 `_` 外的连接标点）、`Mn`/`Mc`，
 * 又多算了 `\p{N}` 里的 `No`（如 `²`，Java 不认）。
 */
const IDENTIFIER_PART = /[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Nd}\p{Mn}\p{Mc}\u0000-\u0008\u000E-\u001B\u007F-\u009F]/u

export function isJavaIdentifierPart(character: string | undefined): boolean {
  return !!character && IDENTIFIER_PART.test(character)
}

/**
 * `EditorActionUtil.isHumpBound:960-974` 的逐行等价物（驼峰词素切在哪）。
 * 四条判据原样搬（`isStart` 决定「正在动的那个字符」是 `curr` 还是 `prev`）：
 *   · `isLowerCaseOrDigit(prev) && isUpperCase(curr)` —— `foo|Bar` 的 `B` 前断开；
 *   · `neighbor == '_' && hump != '_'` —— 下划线是断点，但 `__` 本身不算；
 *   · `neighbor == '$' && isLetterOrDigit(hump)` —— `$` 是断点；
 *   · `isUpperCase(prev) && isUpperCase(curr) && isLowerCase(next)` —— `HTTP|Server` 的 `S` 前断开。
 * **字母↔数字之间不断**（上游没有这条判据）——`src/editorExtendSelection.ts` 的
 * `lexemeRange` 在这里与上游不同（它会断），本模块按上游。
 */
export function isHumpBound(text: string, offset: number, isStart: boolean): boolean {
  if (offset <= 0 || offset >= text.length) return false
  const prev = text[offset - 1]!
  const curr = text[offset]!
  const next = offset + 1 < text.length ? text[offset + 1]! : '\u0000' // 0x00 不是小写。
  const hump = isStart ? curr : prev
  const neighbor = isStart ? prev : curr
  return (isLowerCaseOrDigit(prev) && isUpperCase(curr)) ||
    (neighbor === '_' && hump !== '_') ||
    (neighbor === '$' && isLetterOrDigit(hump)) ||
    (isUpperCase(prev) && isUpperCase(curr) && isLowerCase(next))
}

function isLowerCase(character: string): boolean {
  return character.toLowerCase() !== character.toUpperCase() && character === character.toLowerCase()
}

function isUpperCase(character: string): boolean {
  return character.toLowerCase() !== character.toUpperCase() && character === character.toUpperCase()
}

function isLetterOrDigit(character: string): boolean {
  return /[\p{L}\p{Nd}]/u.test(character)
}

function isLowerCaseOrDigit(character: string): boolean {
  return isLowerCase(character) || /\p{Nd}/u.test(character)
}

/** `DefaultHandler:60-61`：光标在文档末尾时**先退一格**；退到 -1 就是「什么都不做」。 */
export function effectiveCaret(text: string, caret: number): number {
  if (caret === text.length) return caret - 1
  return caret
}

/**
 * 光标是否在文档内。上游 `caret.getOffset()` 恒在 `[0, textLength]`，越界值上游没定义
 * （`DefaultHandler:52` 的 `getLineNumber(caretOffset)` 会直接抛）⇒ 本仓把越界当「什么都不做」，
 * 不拿它去猜一个位置。
 */
function caretInDocument(text: string, caret: number): boolean {
  return Number.isInteger(caret) && caret >= 0 && caret <= text.length
}

/**
 * `SelectWordUtil.getCamelSelectionRange:74-102`（驼峰词素那一档）。
 * `:75-77` 越界 ⇒ null（注意：**光标在文档末尾直接 null**，不退格 —— 与词那一档不同）；
 * `:78-81` 光标右邻不是词字符、左邻是 ⇒ 左移一格；
 * `:83-99` 以光标为轴往两边走到驼峰断点；`:96-98` 长度必须 **>= 2**（单字符不给词素档，
 * 免得和词那一档重复）。
 */
export function camelSelectionRange(text: string, caret: number): ExtendRange | null {
  if (caret < 0 || caret >= text.length) return null
  let at = caret
  if (at > 0 && !isJavaIdentifierPart(text[at]) && isJavaIdentifierPart(text[at - 1])) at--
  if (!isJavaIdentifierPart(text[at])) return null

  let start = at
  let end = at + 1
  while (start > 0 && isJavaIdentifierPart(text[start - 1]) && !isHumpBound(text, start, true)) start--
  while (end < text.length && isJavaIdentifierPart(text[end]) && !isHumpBound(text, end, false)) end++
  return start + 1 < end ? { from: start, to: end } : null
}

/**
 * `SelectWordUtil.getWordOrLexemeSelectionRange:114-142`（整个词那一档）。
 * `:117` 空文档 ⇒ null；`:118-122` 光标在末尾或「右邻非词字符、左邻是词字符」⇒ 左移一格；
 * `:124-139` 往两边走到词字符尽头，途中遇到 `isLexemeBoundary` 就停（上游把 `editor` 传进去，
 * 本仓由 `lexemeBoundary` 入参承接；不给就等价上游 `editor == null`，`SelectWordUtil.java:129`/`:134`）。
 * `:141` 光标处不是词字符 ⇒ null。
 */
export function wordSelectionRange(
  text: string,
  caret: number,
  lexemeBoundary?: (offset: number) => boolean,
): ExtendRange | null {
  const length = text.length
  if (length === 0) return null
  let at = caret
  if (at === length || (at > 0 && !isJavaIdentifierPart(text[at]) && isJavaIdentifierPart(text[at - 1]))) at--
  if (!isJavaIdentifierPart(text[at])) return null

  const boundary = (offset: number) => lexemeBoundary ? lexemeBoundary(offset) : false
  let start = at
  let end = at
  while (start > 0 && isJavaIdentifierPart(text[start - 1]) && !boundary(start)) start--
  while (end < length && isJavaIdentifierPart(text[end]) && (end === start || !boundary(end))) end++
  return { from: start, to: end }
}

/** `Document.getLineStartOffset`：前一个换行之后。 */
function lineStartOffset(text: string, offset: number): number {
  let at = Math.min(Math.max(0, offset), text.length)
  while (at > 0 && text[at - 1] !== '\n') at--
  return at
}

/** `Document.getLineEndOffset`：**不含**行分隔符（`\r\n` 两个都不含，`DocumentImpl.java:145`）。 */
function lineEndOffset(text: string, offset: number): number {
  const start = lineStartOffset(text, offset)
  const index = text.indexOf('\n', start)
  let end = index < 0 ? text.length : index
  if (end > start && text[end - 1] === '\r') end--
  return end
}

/** `DefaultHandler:66-67`：`new TextRange(getLineStartOffset(line), getLineEndOffset(line))`。 */
export function caretLineRange(text: string, caret: number): ExtendRange {
  const at = Math.min(Math.max(0, caret), text.length)
  return { from: lineStartOffset(text, at), to: lineEndOffset(text, at) }
}

/** `Document.getLineNumber`。 */
function lineNumberOf(text: string, offset: number): number {
  let lines = 0
  const end = Math.min(Math.max(0, offset), text.length)
  for (let at = 0; at < end; ++at) if (text[at] === '\n') ++lines
  return lines
}

/** `Document.getLineCount`（空文档是 1 行）。 */
function lineCountOf(text: string): number {
  let lines = 1
  for (let at = 0; at < text.length; ++at) if (text[at] === '\n') ++lines
  return lines
}

/**
 * `DefaultHandler:56-67` 那个 `ranges` 列表，**顺序即优先级**：
 * 词素（仅 `isCamelWords`）→ 词 → 整行。`SelectWordUtil.addWordOrLexemeSelection:62-71`
 * 的 `!range.equals(camelRange)` 去重也照做。
 * `caret` 收的是**原始**光标偏移，`effectiveCaret` 在内部做（上游 `:60` 那一次退格）。
 * 空文档或退格后为负 ⇒ 空数组。
 */
export function wordSelectionRanges(input: SelectWordInput): ExtendRange[] {
  const text = input.text
  if (!caretInDocument(text, input.caret)) return []
  const caret = effectiveCaret(text, input.caret)
  if (caret < 0) return []
  const ranges: ExtendRange[] = []
  const camelRange = input.camelWords ? camelSelectionRange(text, caret) : null
  if (camelRange) ranges.push(camelRange)
  const word = wordSelectionRange(text, caret, input.lexemeBoundary)
  if (word && !(camelRange && camelRange.from === word.from && camelRange.to === word.to)) ranges.push(word)
  ranges.push(caretLineRange(text, caret))
  return ranges
}

/**
 * 连续按 Ctrl+W 的**完整阶梯**（含 `DefaultHandler:71` 那个兜底的整篇区间），由内到外。
 * 宿主拿它当「本地取词栈」用（LSP `selectionRange` 不可用时的回退栈 ——
 * `src/lspFeatureMatrix.ts:67` 已经这么声称，但宿主 `CodeEditor.vue` 的 `adjustSelection`
 * 失败时只是把栈置空、没有本地栈，这一段就是补上它）。
 *
 * 与 `wordSelectionRanges` 的差别只有一处：**去掉相邻的等长区间**。上游那份 `ranges` 是允许
 * 重复的（单行文件里词 = 整行 = 整篇），但栈要能「按一次长一级」，重复项会让 `index + 1` 拿到
 * 同一个区间。去重只影响栈的形状，不影响 `selectWordAtCaret`（那边本来就按 `contains` 收窄）。
 *
 * 上游默认 `isCamelWords` 是 false（`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/
 * EditorSettingsExternalizable.java:119` 的 `IS_CAMEL_WORDS = false`），所以默认阶梯是
 * 词 → 整行 → 整篇，与上游用例 `test1/after1..after3` 逐档一致。
 */
export function selectWordLevels(input: SelectWordInput): ExtendRange[] {
  const text = input.text
  if (input.password) return [{ from: 0, to: text.length }]
  if (!caretInDocument(text, input.caret) || effectiveCaret(text, input.caret) < 0) return []
  const levels: ExtendRange[] = []
  for (const range of wordSelectionRanges(input)) {
    const last = levels[levels.length - 1]
    if (!last || !equals(last, range)) levels.push(range)
  }
  const whole = { from: 0, to: text.length }
  const last = levels[levels.length - 1]
  if (!last || !equals(last, whole)) levels.push(whole)
  return levels
}

function contains(outer: ExtendRange, inner: ExtendRange): boolean {
  return outer.from <= inner.from && inner.to <= outer.to
}

function equals(left: ExtendRange, right: ExtendRange): boolean {
  return left.from === right.from && left.to === right.to
}

/**
 * `DefaultHandler.doExecute:42-81` 的逐行等价物：返回**这一次**该设的选区；
 * 返回 null = 上游那两个「什么都不做」的 `return`（`:52-54` 行号越界、`:61` 退格后为负）。
 *
 * 上游那段挑选（`:69-80`）不是「取最小包含区间」，而是：
 * `minimumRange` 从整篇起步（`:71`），按 `ranges` 顺序扫，遇到
 * 「包含当前选区、且不等于当前选区、且还在 `minimumRange` 里」的就把 `minimumRange` 收窄（`:72-78`）。
 * 因为 `ranges` 由内到外递增，结果等价于「**最小的、严格大于当前选区的包含区间**」；
 * 没有这样的区间时保持整篇 —— 这正是 after3 → after4（整行 → 整篇）那一跳。
 */
export function selectWordAtCaret(input: SelectWordInput): ExtendRange | null {
  const text = input.text
  if (input.password) return { from: 0, to: text.length }
  if (!caretInDocument(text, input.caret)) return null
  if (lineNumberOf(text, input.caret) >= lineCountOf(text)) return null
  const caret = effectiveCaret(text, input.caret)
  if (caret < 0) return null

  const current = input.current ?? { from: input.caret, to: input.caret }
  let minimum: ExtendRange = { from: 0, to: text.length }
  for (const range of wordSelectionRanges(input)) {
    if (contains(range, current) && !equals(range, current) && contains(minimum, range)) minimum = range
  }
  return minimum
}