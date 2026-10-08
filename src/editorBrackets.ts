// 彩虹括号（上游 `platform/analysis-impl/.../RainbowHighlighter.java` 的等价物）。
//
// 上游按括号的**嵌套层级**在几档颜色间循环（`RAINBOW_JB_COLORS_DEFAULT` 五档，
// 亮/暗两套）；本模块在 CodeMirror 里做同一件事：
//   · 纯词法部分 `scanBrackets`：给一段文本里每个括号标出层级（`(`,`[`,`{` 进一层，
//     反向出栈；遇到不配对的反括号按空栈处理，层级取 0 并从 0 继续 —— 坏代码不抛）；
//   · 视图部分 `rainbowBrackets()`：逐可见行算**整篇前缀**的起始层级，把每个括号
//     标成 `.cm-rainbow-0..4`；字符串/注释/正则里的括号用 lezer 语法树排除
//     （`resolveInner` 的祖先名匹配；上游 `RainbowHighlighter` 也是按 PSI 元素跳过
//     非代码区）。模板串 `${}` 里的插值按字符串处理，这是词法层的已知粗化。
//
// 括号**配对高亮**不在这里：CodeMirror `basicSetup` 自带的 `bracketMatching()` 画
// `cm-matchingBracket`/`cm-nonmatchingBracket`，开关是编辑器设置的 `bracketMatching`
// （见 `src/components/CodeEditor.vue` 与 `src/style.css`）；本模块补的是上游缺的那一层。
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { type EditorState, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { rainbowPalette, rgbToHex } from './colorGenerator.ts'
// `com.intellij.lang.braceMatcher`（`PairedBraceMatcher`）的消费端：`<>` 那一对先问 EP（见
// 下面 `hasAngleBraces`），第三方给别的语言登记一对就当场生效。
import { bracePairsFor } from './editorActionExtensionPoints.ts'

/** 上游 `RAINBOW_JB_COLORS_DEFAULT` 是五档。 */
export const RAINBOW_COLORS = 5

/**
 * 五档颜色来自 `src/colorGenerator.ts` 的 `rainbowPalette`（上游
 * `RainbowHighlighter.java:232-234` 那一句 `ColorGenerator.generateLinearColorSequence` 的等价物）
 * —— 锚色就是 `RAINBOW_JB_COLORS_DEFAULT` 的五档（`:47-53`），这里只取锚点档（步长
 * `RAINBOW_COLORS_BETWEEN + 1`），与 `rainbowSlot` 的五档语义一致。
 * 之所以仍走 `colorGenerator`：插值表本身是上游 `ColorGenerator` 的行为，本模块只消费它。
 */
export const RAINBOW_LIGHT_COLORS: readonly string[] = Array.from({ length: RAINBOW_COLORS }, (_, slot) =>
  rgbToHex(rainbowPalette('light')[slot * 5]!))
export const RAINBOW_DARK_COLORS: readonly string[] = Array.from({ length: RAINBOW_COLORS }, (_, slot) =>
  rgbToHex(rainbowPalette('dark')[slot * 5]!))

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSE = new Set([')', ']', '}'])

export interface BracketToken { pos: number; ch: string; depth: number }

/**
 * 一段文本的括号层级（`startDepth` 是这段文本之前已经打开的括号数）。
 * 返回每个括号 token 与扫描结束时的层级（下一段接着用）。
 */
export function scanBrackets(text: string, startDepth = 0): { tokens: BracketToken[]; depth: number } {
  const tokens: BracketToken[] = []
  let depth = Math.max(0, startDepth)
  for (let index = 0; index < text.length; ++index) {
    const ch = text[index]
    if (OPEN[ch]) {
      tokens.push({ pos: index, ch, depth })
      depth += 1
    } else if (CLOSE.has(ch)) {
      depth = Math.max(0, depth - 1)
      tokens.push({ pos: index, ch, depth })
    }
  }
  return { tokens, depth }
}

/** 彩虹档位（层级对上游那五档取模）。 */
export function rainbowSlot(depth: number): number {
  return ((depth % RAINBOW_COLORS) + RAINBOW_COLORS) % RAINBOW_COLORS
}

const LITERAL_NODE = /string|comment|regexp|regex/i

/** 位置是否落在字符串/注释/正则节点里（lezer 树上逐级看祖先名）。 */
function inLiteral(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1)
  for (; node; node = node.parent) {
    if (LITERAL_NODE.test(node.name)) return true
  }
  return false
}

class RainbowState {
  /** 行缓存所属的文档（文档一变整份作废）。 */
  doc: Text | null = null
  /** `lineDepths[i]` = 第 i+1 行**行首**的括号层级；-1 = 还没算过。 */
  lineDepths: number[] = []

  /** 逐步向前补缓存，返回第 lineNo 行（1 基）行首的层级。 */
  depthAt(doc: Text, lineNo: number): number {
    if (this.doc !== doc) { this.doc = doc; this.lineDepths = new Array(doc.lines).fill(-1); this.lineDepths[0] = 0 }
    if (this.lineDepths[lineNo - 1] >= 0) return this.lineDepths[lineNo - 1]
    // 往前找最近的已算行，从那里逐行推进。
    let start = lineNo - 2
    while (start > 0 && this.lineDepths[start] < 0) --start
    let depth = this.lineDepths[start] ?? 0
    for (let line = start + 1; line < lineNo; ++line) {
      depth = scanBrackets(doc.line(line).text, depth).depth
      this.lineDepths[line] = depth
    }
    return this.lineDepths[lineNo - 1] ?? 0
  }
}

function buildRainbow(view: EditorView, cache: RainbowState): DecorationSet {
  const state = view.state
  const marks: { from: number; decoration: Decoration }[] = []
  if (!state.doc.length) return Decoration.none
  for (const range of view.visibleRanges) {
    let line = state.doc.lineAt(range.from)
    while (true) {
      const startDepth = cache.depthAt(state.doc, line.number)
      for (const token of scanBrackets(line.text, startDepth).tokens) {
        const pos = line.from + token.pos
        if (inLiteral(state, pos)) continue
        marks.push({ from: pos, decoration: Decoration.mark({ class: `cm-rainbow-${rainbowSlot(token.depth)}` }) })
      }
      if (line.to >= range.to || line.number >= state.doc.lines) break
      line = state.doc.line(line.number + 1)
    }
  }
  return Decoration.set(marks.map(entry => entry.decoration.range(entry.from)), true)
}

/** 彩虹括号扩展：只在设置开着时挂进编辑器（见 `src/components/CodeEditor.vue`）。 */
export function rainbowBrackets(): Extension {  const cache = new RainbowState()
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = buildRainbow(view, cache) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = buildRainbow(update.view, cache)
    }
  }, {
    decorations: plugin => plugin.decorations,
    provide: () => EditorView.baseTheme({
      '&light .cm-rainbow-0': { color: RAINBOW_LIGHT_COLORS[0] },
      '&light .cm-rainbow-1': { color: RAINBOW_LIGHT_COLORS[1] },
      '&light .cm-rainbow-2': { color: RAINBOW_LIGHT_COLORS[2] },
      '&light .cm-rainbow-3': { color: RAINBOW_LIGHT_COLORS[3] },
      '&light .cm-rainbow-4': { color: RAINBOW_LIGHT_COLORS[4] },
      '&dark .cm-rainbow-0': { color: RAINBOW_DARK_COLORS[0] },
      '&dark .cm-rainbow-1': { color: RAINBOW_DARK_COLORS[1] },
      '&dark .cm-rainbow-2': { color: RAINBOW_DARK_COLORS[2] },
      '&dark .cm-rainbow-3': { color: RAINBOW_DARK_COLORS[3] },
      '&dark .cm-rainbow-4': { color: RAINBOW_DARK_COLORS[4] },
    }),
  })
}

// ── 逐语言的尖括号配对（`lp/editor-actions` 判决缺项 ① 里括号那一半） ──────────────────
//
// 上游 `JavaPairedBraceMatcher.java:12` 继承 `PairedBraceAndAnglesMatcher`，`:26-34` 交出
// `lt()` = `JavaTokenType.LT`、`gt()` = `GT`（`:22-24` 的构造器把 `JavaBraceMatcher`、语言、文件类型
// 与那张 TYPE_TOKENS 一起交出去）：Java 把泛型的 `<` `>` 也算**一对括号**
// —— 光标落在任意一侧时两侧一起高亮。**订正**（2026-10-06）：这里原来写的
// `BraceMatcher.findMatchingBracket` 返回 `BraceMatch` 在本 checkout 里搜不到（该目录内
// `findMatchingBracket`/`class BraceMatch` 零命中），是上一任编出来的符号名。真实形状：
// `platform/lang-impl/src/com/intellij/codeInsight/highlighting/BraceMatcher.java:35-40`
// 只有 EP 名 `com.intellij.braceMatcher`（`:36`）与三个问法；配对由
// `BraceMatchingUtil.java:172` 的 `doBraceMatch()`（入口 `:239`/`:248`）算。
// CodeMirror 的 `bracketMatching()` 只认 `()[]{}`，泛型那一对此前在本仓没有落点。
//
// 哪些语言把 `<>` 当括号 = 那张按语言的注册表。社区树里只有 Java 这一条能核到：
// C/C++ 的 matcher 在 CLion（不在开源树）、TS/JS 的在商业插件（`find *BraceMatcher*` 在
// `javascript/` 目录下没有宿主，那个目录本身不存在）⇒ **无法核实**，一律给 false，
// 不按「IDEA 一般是…」补。
export const LANGUAGE_ANGLE_BRACES: Readonly<Record<string, boolean>> = { java: true }

/**
 * 这门语言把 `<>` 也算一对括号吗。
 *
 * **2026-10-06 本 lane 补**：先问扩展点（`com.intellij.braceMatcher` 与
 * `com.intellij.lang.braceMatcher`，出处见 `src/editorActionExtensionPoints.ts` 文件头）——
 * 第三方为**别的**语言登记一对 `<>` 就当场生效（本仓此前只有写死的 `LANGUAGE_ANGLE_BRACES` 表，
 * 插件挂不进来）。没有任何贡献认领 `<>` 时回落到那张静态表（bundled 的 Java 那一条由
 * `registerBundledEditorActionDefaults()` 登记，所以 Java 仍然为 true，行为不变）。
 */
export function hasAngleBraces(language: string | undefined): boolean {
  if (language === undefined) return false
  for (const pair of bracePairsFor({ language })) {
    if (pair.leftBrace === '<' && pair.rightBrace === '>') return true
  }
  return LANGUAGE_ANGLE_BRACES[language] === true
}

// 「尖括号之间是类型」的那一层判定，上游靠 PSI（`JavaPairedBraceMatcher.java:13-20` 的
// TYPE_TOKENS：空白/注释、标识符、`,`、`@`、`[`、`]`、`?`、`extends`、`super`）。
// 本仓没有 PSI，用词法近似：中间只允许这些字符（嵌套的 `<` `>` 允许 —— 那一对已经由
// `matchingAnglePair` 的平衡扫描配过）—— 这条把 `a + b > c` 那种算式挡掉。
// 近似不出来的场合一律不画高亮，宁缺毋滥。
const TYPE_CONTENT = /^[\w$.,\s@[\]?<>]*$/

/** 两个尖括号之间是否是类型参数表（`JavaPairedBraceMatcher.java:13-20` 那个 TYPE_TOKENS 的词法近似）。 */
export function isAngleTypeArgumentList(text: string, pair: { open: number; close: number }): boolean {
  const inner = text.slice(pair.open + 1, pair.close)
  return inner !== '' && TYPE_CONTENT.test(inner)
}

// 与光标处尖括号配对的另一侧（上游 `BraceMatchingUtil.java:172` `doBraceMatch()` 的文本近似）。
// 光标贴在哪一侧都算：`<│List` / `List│>` 找右手边，`List>│` / `│<List` 找左手边
// —— 与 CodeMirror `bracketMatching` 对 `()[]{}` 的判法同一档。
// 比较表达式（`a < b > c`）会被「`<` 之后紧跟内容、`>` 之前不空着」这条挡掉。
/** 从 `from` 往右做平衡扫描，找到与 `text[from]` 那个 `<` 配对的 `>`；找不到返回 -1。 */
export function scanAngleForward(text: string, from: number): number {
  let depth = 0
  for (let at = from; at < text.length; ++at) {
    if (text[at] === '<') ++depth
    else if (text[at] === '>' && --depth === 0) return at
  }
  return -1
}

/** 从 `from`（一个 `>` 的位置）往左找与它配对的 `<`；找不到返回 -1。 */
export function scanAngleBackward(text: string, from: number): number {
  let depth = 0
  for (let at = from; at >= 0; --at) {
    if (text[at] === '>') ++depth
    else if (text[at] === '<' && --depth === 0) return at
  }
  return -1
}

/** 与光标处尖括号配对的另一侧；认不出返回 null。 */
export function matchingAnglePair(text: string, caret: number): { open: number; close: number } | null {
  const before = text[caret - 1]
  const after = text[caret]
  // 光标挨着 `<`：配对在右手边。
  if (after === '<' || before === '<') {
    const open = after === '<' ? caret : caret - 1
    if (/\s/.test(text[open + 1] ?? '')) return null
    const close = scanAngleForward(text, open)
    return close < 0 ? null : { open, close }
  }
  // 光标挨着 `>`：配对在左手边。
  if (after === '>' || before === '>') {
    const close = before === '>' ? caret - 1 : caret
    if (/\s/.test(text[close - 1] ?? '')) return null
    const open = scanAngleBackward(text, close)
    return open < 0 ? null : { open, close }
  }
  return null
}

/**
 * 尖括号配对高亮：光标落在 `<` 或 `>` 上（或紧邻其后）时把两侧标成 `cm-matchingBracket`
 * —— 复用 CodeMirror 自己那对括号的类名，于是颜色、以及 `html[data-bracket-matching='off']`
 * 那个全局开关（`src/style.css:974-975`）都自动跟上，不新增任何样式规则。
 */
export function angleBraceHighlight(getLanguage: () => string | undefined): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = this.build(view) }
    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged || update.viewportChanged) this.decorations = this.build(update.view)
    }
    build(view: EditorView): DecorationSet {
      if (!hasAngleBraces(getLanguage())) return Decoration.none
      const head = view.state.selection.main.head
      const pair = matchingAnglePair(view.state.doc.toString(), head)
      if (!pair || !isAngleTypeArgumentList(view.state.doc.toString(), pair)) return Decoration.none
      const mark = { class: 'cm-matchingBracket' }
      return Decoration.set([
        Decoration.mark(mark).range(pair.open, pair.open + 1),
        Decoration.mark(mark).range(pair.close, pair.close + 1),
      ].sort((one, other) => one.from - other.from))
    }
  }, { decorations: plugin => plugin.decorations })
}
