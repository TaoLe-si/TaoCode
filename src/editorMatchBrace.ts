// 「移动到配对的括号」（IDEA `EditorMatchBrace`，Ctrl+Shift+M）—— `lp/editor-actions` 判决缺项 ①
// 里 `BraceMatcher` 那一族的**导航**那一半（配对**高亮**在 `src/editorBrackets.ts` 的
// `angleBraceHighlight`，CodeMirror 的 `bracketMatching()` 承担 `()[]{}`）。
//
// 上游坐标（2026-10-06 逐行核对）：
//   · 动作类与三条规则：`platform/lang-impl/src/com/intellij/codeInsight/editorActions/MatchBraceAction.java:25-32`
//     的类注释 —— 「光标在闭括号上 ⇒ 移到配对**开**括号的开头；光标在开括号上 ⇒ 移到配对**闭**括号的末尾；
//     都不在 ⇒ 从光标回到文件开头，找第一个在光标之前没被配上的左括号」；实现 `:40-51`（`doExecute`
//     取 `getClosestTargetOffset` 的结果再 `moveCaret`），`:58-60` 先问 `BraceMatcher`、再问
//     `CodeBlockSupportHandler`。
//   · 第二问（`CodeBlockSupportHandler`）**在本仓的三种语言里恒为空**（2026-10-06 逐条核，别照着类名编）：
//     `:60` 调的是 `platform/lang-impl/src/com/intellij/codeInsight/highlighting/CodeBlockSupportHandler.java:57-66`
//     的 `findCodeBlockRange`，它按语言取扩展点（EP 声明
//     `platform/lang-impl/resources/intellij.platform.lang.impl.xml:147`、`CodeBlockSupportHandler.java:33` 的
//     `LanguageExtension`），整棵社区树里**只有 Python 注册过这一条**
//     （`python/pluginResources/intellij.python.community.impl.xml:439` →
//     `python/src/com/jetbrains/python/codeInsight/highlighting/PyControlFlowKeywordCodeBlockSupportHandler.kt:16-20`）；
//     Java / C++ / TS / 纯文本都没有 ⇒ 返回 `EMPTY_RANGE`，`MatchBraceAction.java:61-63` 就原样返回第一问的结果
//     ⇒ **本模块只做第一问就是与上游一致的**，没有少做。Python 那一档要给区间就得认
//     `AbstractCodeBlockSupportHandler.java:79-83` 的 `getParentByTokenSet(element, getBlockElementTypes())`
//     （Python 是按缩进的控制流块，
//     `python/python-psi-impl/src/com/jetbrains/python/codeInsight/highlighting/PyControlFlowKeywordMatcher.kt:116` 也这么描述这条动作）
//     ⇒ 没有 PSI 做不了，具体卡点登记在 `docs/batch-2026-10-06-editorinput.md` 的「做不到」。
//   · 动作注册：`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:23`
//     （`<action id="EditorMatchBrace" class="…MatchBraceAction"/>`）。
//   · 键位：`platform/platform-resources/src/keymaps/$default.xml:1146-1148`
//     （`<action id="EditorMatchBrace"><keyboard-shortcut first-keystroke="control shift M"/>`）。
//     另两个 keymap 里同一动作在 `platform/platform-resources/src/keymaps/Mac OS X 10.5+.xml:642`、
//     `Sublime Text.xml:231`；`platform/testFramework/extensions/src/com/intellij/keymap/KeymapsTestCase.java:154`
//     把 `shift control M` 记在 `EditorMatchBrace` 名下，与上面一致。
//   · 哪些括号算「配对」：语言侧的 `PairedBraceMatcher`（`platform/analysis-api/src/com/intellij/lang/PairedBraceMatcher.java`），
//     由 `platform/lang-impl/src/com/intellij/codeInsight/highlighting/PairedBraceMatcherAdapter.java`
//     适配成 `BraceMatcher`。Java 那一份含 `<>`（`java/java-frontback-impl/src/com/intellij/codeInsight/highlighting/JavaPairedBraceMatcher.java:26-34`，
//     已在 `src/editorBrackets.ts` 用过）⇒ 本模块的 `<>` 只给 Java，C/C++ 与 TS 的 matcher
//     不在社区树里（CLion / 商业 JS 插件），按「无法核实」不给。
//
// 本仓的等价物：没有 PSI ⇒ 自己扫一遍全文，把字符串/字符/模板串/行注释/块注释里的括号排除掉
// （与 `src/enterHandlers.ts` 的 `structuralBraceCounts` 同一口径），再按上面那三条给目标位置。
// 配不上对（多余括号、跨不到）返回 null ⇒ 命令返回 false，不动光标，也不弹假的提示。
import { Facet, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { hasAngleBraces, isAngleTypeArgumentList, matchingAnglePair } from './editorBrackets.ts'
// 扩展点登记的自定义括号对（`com.intellij.braceMatcher` / `com.intellij.lang.braceMatcher`）：
// 静态 `()[]{}` 之外的括号由 `extraBraceTarget` 消费（第三方按 id 挂进来就当场生效）。
import { bracePairsFor, type BracePairLike } from './editorActionExtensionPoints.ts'

/** 本仓静态认作括号的六个字符（不走 `extraBraceTarget` 那一档）。 */
const STATIC_BRACE_CHARS = '()[]{}'

/**
 * 编辑器当前语言的 id（`java` / `cpp` / `typescript` / `undefined`）。
 * 上游的 `PairedBraceMatcher` 是按语言注册的扩展点，本仓得有人把「现在这门语言是什么」送进
 * CodeMirror 的状态里；`editingCommands` 那张静态表拿不到组件的 props，所以走 facet。
 * 挂载点（`CodeEditor.vue` 的 extensions）在接线请求里 —— 没挂之前这里读到 `undefined`，
 * 命令照样对 `()[]{}` 生效，只是 Java 的 `<>` 那一档不接管（不假装支持）。
 */
export const editorLanguageId = Facet.define<string, string | undefined>({ combine: values => values.at(-1) })

/** 把这个语言 id 接进编辑器（供 `src/components/CodeEditor.vue` 的接线请求用）。 */
export function editorLanguageIdExtension(language: string | undefined): Extension {
  return language === undefined ? [] : editorLanguageId.of(language)
}

const OPENERS = '([{'
const CLOSERS = ')]}'
const PAIR: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const MIRROR: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/** 结构括号（跳过字符串 / 行注释 / 块注释）的下标表；被跳过的位置记 -1。
 * `extraChars` 是额外认作括号的字符（`com.intellij.braceMatcher` 登记的括号对，见下面
 * `extraBraceTarget`）；缺省空串 ⇒ 只认本仓静态的 `()[]{}`，行为与原来一致。 */
export function braceTokens(text: string, extraChars = ''): number[] {
  const marks: number[] = new Array(text.length).fill(-1)
  let inString = ''
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; ++i) {
    const char = text[i]!
    const next = text[i + 1]
    if (inString) {
      if (char === '\\') { ++i; continue }
      if (char === inString) inString = ''
      continue
    }
    if (inLine) { if (char === '\n') inLine = false; continue }
    if (inBlock) { if (char === '*' && next === '/') { inBlock = false; ++i } continue }
    if (char === '"' || char === '\'' || char === '`') { inString = char; continue }
    if (char === '/' && next === '/') { inLine = true; ++i; continue }
    if (char === '/' && next === '*') { inBlock = true; ++i; continue }
    if (OPENERS.includes(char) || CLOSERS.includes(char) || extraChars.includes(char)) marks[i] = i
  }
  return marks
}

/** 从 `at` 处那个**开**括号往后配：返回闭括号下标，配不上返回 -1。 */
function forwardMatch(marks: readonly number[], text: string, at: number): number {
  const char = text[at]!
  if (!OPENERS.includes(char) || marks[at] < 0) return -1
  let depth = 0
  for (let i = at; i < text.length; ++i) {
    if (marks[i] < 0) continue
    const scan = text[i]!
    if (scan === char) ++depth
    else if (scan === PAIR[char]) { if (--depth === 0) return i }
  }
  return -1
}

/** 从 `at` 处那个**闭**括号往前配：返回开括号下标，配不上返回 -1。 */
function backwardMatch(marks: readonly number[], text: string, at: number): number {
  const char = text[at]!
  if (!CLOSERS.includes(char) || marks[at] < 0) return -1
  const open = MIRROR[char]!
  let depth = 0
  for (let i = at; i >= 0; --i) {
    if (marks[i] < 0) continue
    const scan = text[i]!
    if (scan === char) ++depth
    else if (scan === open) { if (--depth === 0) return i }
  }
  return -1
}

/**
 * 光标**右边**那个字符是括号时给出配对结果（`MatchBraceAction.java:28-29` 的两条 + `:96`
 * 的 `highlighter.createIterator(caretOffset)` —— 上游读的也是光标右边那个 token）。
 * 右边是开括号 ⇒ 返回配对的闭括号；右边是闭括号 ⇒ 返回配对的开括号；不是括号/配不上 ⇒ null。
 */
export function pairedBraceIndex(marks: readonly number[], text: string, caret: number): { at: number; kind: 'open' | 'close' } | null {
  if (marks[caret] === undefined || marks[caret] < 0) return null
  const char = text[caret]!
  if (OPENERS.includes(char)) {
    const close = forwardMatch(marks, text, caret)
    return close < 0 ? null : { at: close, kind: 'open' }
  }
  if (CLOSERS.includes(char)) {
    const open = backwardMatch(marks, text, caret)
    return open < 0 ? null : { at: open, kind: 'close' }
  }
  return null
}

/**
 * 三条规则里的第三条（`MatchBraceAction.java:30` 的类注释 + `:93-110` 的实现）：光标不在任何括号上时，
 * 回到文件开头找「在光标之前没被配上的左括号」里最内层的那一个（从 0 扫到光标、栈顶剩下的那个）。
 * `:91` 写明返回的是**那个开括号的起始 offset**。没有返回 -1。
 */
export function innermostUnclosedOpener(marks: readonly number[], text: string, caret: number): number {
  const stack: number[] = []
  for (let i = 0; i < caret && i < text.length; ++i) {
    if (marks[i] < 0) continue
    const char = text[i]!
    if (OPENERS.includes(char)) stack.push(i)
    else if (CLOSERS.includes(char)) {
      const last = stack[stack.length - 1]
      if (last !== undefined && PAIR[text[last]!] === char) stack.pop()
    }
  }
  return stack.length ? stack[stack.length - 1]! : -1
}

/**
 * 目标光标位置（绝对偏移），按上游那三条（`MatchBraceAction.java:25-31`）：
 * 光标在闭括号上 ⇒ 配对的开括号**开头**；光标在开括号上 ⇒ 配对的闭括号**末尾**（闭括号后一位）；
 * 都不在 ⇒ 最内层未闭合左括号本身的起始 offset（`:91` 就是这个含义，不是它的闭括号）。
 * `angle` = 这门语言把 `<>` 也算括号（Java）。
 *
 * 贴法与上游一致：只读光标**右边**那个字符（`MatchBraceAction.java:96`）。刚敲完一个 `{` 时光标在它
 * 右边 ⇒ 走第三条（`:93-110`），结果是把光标退回那个 `{` —— 上游同一条规则就是这么算的，
 * 不另加「左边也认」的便利档。
 */
export function matchBraceTarget(text: string, caret: number, angle = false, extraPairs: readonly BracePairLike[] = []): number | null {
  // `<>` 那一档先问（Java 的泛型）：光标挨着哪一侧就跳到另一侧的外沿。
  if (angle) {
    const pair = matchingAnglePair(text, caret)
    if (pair && isAngleTypeArgumentList(text, pair)) {
      if (caret <= pair.open) return pair.close + 1
      if (caret > pair.close) return pair.open
      return caret <= pair.open + 1 ? pair.close + 1 : pair.open
    }
  }
  const marks = braceTokens(text)
  const found = pairedBraceIndex(marks, text, caret)
  if (found) return found.kind === 'open' ? found.at + 1 : found.at
  // 第三条：光标不在括号上 ⇒ 最内层未闭合的左括号本身的位置。
  const opener = innermostUnclosedOpener(marks, text, caret)
  if (opener >= 0) return opener
  // 静态 `()[]{}` 都没接住：问扩展点登记的自定义括号对（`com.intellij.braceMatcher`）。
  return extraBraceTarget(text, caret, extraPairs)
}

/**
 * 静态 `()[]{}` 之外**登记**的括号对（`com.intellij.braceMatcher` / `com.intellij.lang.braceMatcher`
 * 的 `getPairs()`）的配对导航。与 `matchBraceTarget` 的前三条同形（光标右边是括号 ⇒ 跳到另一侧；
 * 都不在 ⇒ 最内层未闭合的开括号），只是括号集合换成登记表里的那些。
 *
 * 本仓静态的 `()[]{}` 不走这里（那三对仍由上面的快路径处理）⇒ 没有第三方登记时
 * `extraPairs` 为空、本函数恒返回 null，既有行为零改动。
 */
export function extraBraceTarget(text: string, caret: number, extraPairs: readonly BracePairLike[]): number | null {
  const pairs = extraPairs.filter(pair =>
    pair?.leftBrace && pair.rightBrace && pair.leftBrace !== pair.rightBrace
    && !STATIC_BRACE_CHARS.includes(pair.leftBrace) && !STATIC_BRACE_CHARS.includes(pair.rightBrace))
  if (!pairs.length) return null
  const pairOf = new Map<string, string>()
  const mirror = new Map<string, string>()
  const extraChars: string[] = []
  for (const pair of pairs) {
    pairOf.set(pair.leftBrace, pair.rightBrace)
    mirror.set(pair.rightBrace, pair.leftBrace)
    extraChars.push(pair.leftBrace, pair.rightBrace)
  }
  const marks = braceTokens(text, extraChars.join(''))
  const isOpen = (ch: string | undefined): boolean => ch !== undefined && pairOf.has(ch)
  const isClose = (ch: string | undefined): boolean => ch !== undefined && mirror.has(ch)
  const forward = (at: number): number => {
    const open = text[at]!
    if (marks[at] < 0) return -1
    let depth = 0
    for (let i = at; i < text.length; ++i) {
      if (marks[i] < 0) continue
      const scan = text[i]!
      if (scan === open) ++depth
      else if (scan === pairOf.get(open)) { if (--depth === 0) return i }
    }
    return -1
  }
  const backward = (at: number): number => {
    const close = text[at]!
    if (marks[at] < 0) return -1
    const open = mirror.get(close)!
    let depth = 0
    for (let i = at; i >= 0; --i) {
      if (marks[i] < 0) continue
      const scan = text[i]!
      if (scan === close) ++depth
      else if (scan === open) { if (--depth === 0) return i }
    }
    return -1
  }
  if (caret < text.length && isOpen(text[caret])) {
    const close = forward(caret)
    return close < 0 ? null : close + 1
  }
  if (caret < text.length && isClose(text[caret])) {
    const open = backward(caret)
    return open < 0 ? null : open
  }
  // 第三条：最内层未闭合的开括号（只在这张登记表上。
  const stack: number[] = []
  for (let i = 0; i < caret && i < text.length; ++i) {
    if (marks[i] < 0) continue
    const char = text[i]!
    if (isOpen(char)) stack.push(i)
    else if (isClose(char)) {
      const last = stack[stack.length - 1]
      if (last !== undefined && pairOf.get(text[last]!) === char) stack.pop()
    }
  }
  return stack.length ? stack[stack.length - 1]! : null
}

/**
 * `EditorMatchBrace` 的命令本体：把光标移到配对的括号那一侧。
 * 多光标与有选区时按主光标算（上游 `MyHandler extends EditorActionHandler.ForEachCaret`
 * 是**每个**光标各算一次，`MatchBraceAction.java:40`；本仓先按主光标，不假装支持多光标）。
 */
export function matchBraceCommand(view: EditorView): boolean {
  const { state } = view
  const head = state.selection.main.head
  const language = state.facet(editorLanguageId)
  // 扩展点登记的自定义括号对（`com.intellij.braceMatcher` / `com.intellij.lang.braceMatcher`）：
  // 没有第三方登记时 `bracePairsFor` 只剩 bundled 的 `()[]{}`（静态快路径已处理）⇒ 行为不变。
  const extraPairs = bracePairsFor({ language })
  const target = matchBraceTarget(state.doc.toString(), head, hasAngleBraces(language), extraPairs)
  if (target === null || target === head) return false
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true, userEvent: 'editor.match-brace' })
  return true
}
