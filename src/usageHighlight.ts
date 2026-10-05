// 用法高亮的纯规则（上游 `codeInsight/highlighting` 的 `HighlightUsagesHandler` /
// `UsageRanges` / `HighlightManagerImpl` 一族）。
//
// 上游的用户可见行为：把光标放在一个元素上执行「高亮用法」（`HighlightUsagesAction`，
// Ctrl+Shift+F7，`$default.xml` 的 `HighlightUsagesInFile`），文件里所有用法被画上临时高亮；
// Esc 或再执行一次清除。元素由 PSI 给出、用法由 `ReferencesSearch` 找。
//
// 本仓没有 PSI，用**词法标识符**代替元素、用**整词出现**代替引用搜索：
//   · 元素 = 光标处的标识符（`identifierAt`：先看右侧字符、再看左侧，与
//     `TargetElementUtil` 在边界上退一格取元素同效）；选中一个词时以选区文本为准。
//   · 用法 = 文档里的整词出现（`usageRanges`：大小写敏感、词边界判定与
//     `UsageRanges.kt` 的区间语义同层 —— 光标所在那条单独成"当前"）。
//   · **读/写分类**（`usageKinds`）：`UsageRanges.kt:8-13` 有 read / write / readDeclaration /
//     writeDeclaration 四桶，`HighlightUsagesHandlerBase.java:32-33` 只把它落成 myReadUsages /
//     myWriteUsages 两组装饰（`:50-65`：读画 `EditorColors.SEARCH_RESULT_ATTRIBUTES`、写画
//     `WRITE_SEARCH_RESULT_ATTRIBUTES`）。没有 PSI 判定不了"这是不是声明"，本仓用**词法邻域**
//     近似：赋值/复合赋值/自增左操作数、函数与箭头函数的参数、var/let/const/函数的绑定名、
//     for-in/of 的左值、解构与 catch 参数、类字段声明 —— 判据都写在各自分支上。
//   · **注释与字符串里的出现都不算用法**（`ReferencesSearch` 只找真引用）：注释用行/块注释
//     标记挖掉（`commentRanges`），字符串/模板串用 `stringRanges` 挖掉。后者是这个文件相对上一
//     批新增的一块 —— 之前判词点名的「字符串里的出现区分不了」到此为止。
//   · **代码块范围**（`codeBlockRange`）：`AbstractCodeBlockSupportHandler.java:79-83` 的
//     `getCodeBlockRange` 取光标所在**最内层块**；本仓用最内层花括号块承担，无花括号语言退化为
//     整文件（对应上游 `TextRange.EMPTY_RANGE` 之外的"没有块"情形：不缩到空）。
import type { CommentStyle } from './commentToggle.ts'

export interface IdentifierRange { word: string; from: number; to: number }

/** 标识符字符：ASCII 字母数字与 `_`/`$`，以及非 ASCII（Unicode 标识符的近似）。 */
function isWordCharacter(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char) || char.charCodeAt(0) > 127
}

/**
 * 光标处的标识符。偏移右侧是标识符字符就用它，否则退到左侧一个字符
 * （`foo|` 也要取到 `foo`）；两侧都不是 → null（在空白/标点上不高亮）。
 */
export function identifierAt(text: string, offset: number): IdentifierRange | null {
  const at = Math.max(0, Math.min(offset, text.length))
  const right = at < text.length && isWordCharacter(text[at]!) ? at : -1
  const anchor = right >= 0 ? right : at > 0 && isWordCharacter(text[at - 1]!) ? at - 1 : -1
  if (anchor < 0) return null
  let from = anchor
  while (from > 0 && isWordCharacter(text[from - 1]!)) --from
  let to = anchor + 1
  while (to < text.length && isWordCharacter(text[to]!)) ++to
  return { word: text.slice(from, to), from, to }
}

/** 可高亮的词：至少含一个字母 / `_` / `$`（纯数字字面量不是引用，与上游一致地跳过）。 */
export function isHighlightableWord(word: string): boolean {
  return word.length > 0 && /[A-Za-z_$]/.test(word)
}

export interface TextRange { from: number; to: number }

/**
 * 行/块注释区间（按 `commentTokens` 给的标记逐个扫；字符串里出现的标记会被误判 —— 见模块头）。
 * 未闭合的块注释一直到文末（与词法分析器同效）。
 */
export function commentRanges(text: string, style: CommentStyle | null): TextRange[] {
  if (!style) return []
  const ranges: TextRange[] = []
  let at = 0
  while (at < text.length) {
    if (style.line && text.startsWith(style.line, at)) {
      const end = text.indexOf('\n', at)
      ranges.push({ from: at, to: end < 0 ? text.length : end })
      at = end < 0 ? text.length : end + 1
      continue
    }
    if (style.block && text.startsWith(style.block[0], at)) {
      const close = text.indexOf(style.block[1], at + style.block[0].length)
      const end = close < 0 ? text.length : close + style.block[1].length
      ranges.push({ from: at, to: end })
      at = end
      continue
    }
    ++at
  }
  return ranges
}

export interface UsageOccurrence { from: number; to: number; current: boolean }

/**
 * 读/写分类（`UsageRanges.kt:8-13` 的四桶压成两个画法 + 声明位）。
 * `read`/`write` 对应 `HighlightUsagesHandlerBase` 的 myReadUsages/myWriteUsages；
 * 两个 `*Declaration` 桶上游也留着，本仓只用来在 tooltip 上区分"这是声明处"，
 * 装饰与前两桶同色（上游的 `HighlightUsagesHandler.java:225-227` 判
 * `isDeclarationWriteAccess` 只切 WRITE_SEARCH_RESULT 那一档）。
 */
export type UsageKind = 'read' | 'write' | 'readDeclaration' | 'writeDeclaration'

export interface TypedUsageOccurrence extends UsageOccurrence { kind: UsageKind }

export interface UsageOptions {
  caseSensitive?: boolean
  /** 要跳过的区间（注释、字符串等）—— 与出现区间重叠即不算用法。 */
  skip?: readonly TextRange[]
  /** 单词出现上限（防超长文档画几万个装饰）；达到上限即停。 */
  limit?: number
  /** 光标位置：包含它的一条标为当前。 */
  caret?: number
  /** 只收这个区间内的出现（代码块范围，`AbstractCodeBlockSupportHandler.getCodeBlockRange`）。 */
  within?: TextRange
  /** 逐条判读/写（`usageKinds` 用）；不给时全部当读，与上一批的形状一致。 */
  classify?: (text: string, from: number, to: number) => UsageKind
}

/** 文档里 `word` 的整词出现（按位置升序）。不带读/写分类 —— 上游的读/写在下一段。 */
export function usageRanges(text: string, word: string, options: UsageOptions = {}): UsageOccurrence[] {
  return usageKinds(text, word, options)
}

/** 同 `usageRanges`，但每条带读/写分类（`UsageRanges.kt` 的 `UsageRanges`）。 */
export function usageKinds(text: string, word: string, options: UsageOptions = {}): TypedUsageOccurrence[] {
  if (!word) return []
  const caseSensitive = options.caseSensitive !== false
  const limit = options.limit ?? 1000
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? word : word.toLowerCase()
  const skip = options.skip ?? []
  const scope = options.within ?? { from: 0, to: text.length }
  const out: TypedUsageOccurrence[] = []
  let at = haystack.indexOf(needle)
  while (at >= 0 && out.length < limit) {
    const to = at + word.length
    if (at >= scope.from && to <= scope.to) {
      const before = at > 0 ? text[at - 1]! : ''
      const after = to < text.length ? text[to]! : ''
      if ((!before || !isWordCharacter(before)) && (!after || !isWordCharacter(after))) {
        const skipped = skip.some(range => range.from < to && range.to > at)
        if (!skipped) {
          out.push({
            from: at,
            to,
            current: options.caret !== undefined && at <= options.caret && options.caret < to,
            kind: options.classify ? options.classify(text, at, to) : 'read',
          })
        }
      }
    }
    at = haystack.indexOf(needle, at + 1)
  }
  return out
}

// ---------------------------------------------------------------- 读/写分类（词法近似）

/** 赋值类运算符：等号以及所有复合赋值。左边那个操作数是写。 */
const ASSIGNMENT = /^(?:[+\-*/%&|^]|<<|>>>?)?=/
/** 自增/自减：后置 `x++` 里的 `x` 也是写。 */
const INCREMENT = /^(?:\+\+|--)$/

/** 向后跳过空白与 `.`/`?.`/`!` —— 判断"这是不是被访问的那个成员"。 */
function skipAccessors(text: string, at: number): number {
  while (at > 0) {
    const char = text[at - 1]!
    if (/\s/.test(char) || char === '.' || char === '?' || char === '!') --at
    else break
  }
  return at
}

/** 从 `from` 往前的那个非空白字符（到头返回 0 长度哨兵）。 */
function previousToken(text: string, from: number): { char: string; at: number } | null {
  let at = from
  while (at > 0 && /\s/.test(text[at - 1]!)) --at
  if (at === 0) return null
  return { char: text[at - 1]!, at: at - 1 }
}

/** `word` 在 `at` 处是不是一个**绑定名**（声明/参数/左值），而不是对已有名字的读。 */
function isBindingName(text: string, at: number, word: string): boolean {
  const after = skipAccessors(text, at + word.length)
  const next = text[after]
  // `= ` / `==` / `=>` / `,` / `)` / `;` / `]` / `:` 之前：这是一个绑定位。
  if (next === '=' || next === ',' || next === ')' || next === ';' || next === ']' || next === ':' || next === '\n') {
    const previous = previousToken(text, at)
    const lead = previous?.char ?? ''
    if (lead === '(' || lead === ',' || lead === '=') return true
    if (lead === '{' || lead === '[') return true
  }
  if (next === '=' && text[after + 1] === '>') return true
  // 声明关键字：`var x` / `let x` / `const x` / `function x` / `class x`。
  const head = /(^|[^\w$])(var|let|const|function|class|type|interface|enum)\s+$/.exec(text.slice(Math.max(0, at - 24), at + 1))
  if (head) return true
  // `for (const x of xs)` / `for (x in xs)` / `catch (e)`。
  if (/\b(?:for|catch|switch)\s*\([^)]*$/.test(text.slice(Math.max(0, at - 32), at))) return true
  return false
}

/**
 * 一条出现是读还是写（`HighlightUsagesHandler` 的 myReadUsages/myWriteUsages 的词法近似）。
 * 规则集中在这一处，每条都写了它对应上游的哪个判定面。
 */
export function classifyUsage(text: string, from: number, to: number): UsageKind {
  // ① 声明处：绑定名 → writeDeclaration（上游 `HighlightUsagesHandler.java:225-227` 判
  //    `isDeclarationWriteAccess` 后用 WRITE_SEARCH_RESULT 那一档）。
  if (isBindingName(text, from, text.slice(from, to))) return 'writeDeclaration'
  // ② 自增/自减：左边那个是写。
  const after = skipAccessors(text, to)
  if (INCREMENT.test(text.slice(after, after + 2))) return 'write'
  // ③ 赋值 / 复合赋值：跳过访问链后看下一个非空白字符是不是 `=`（`===` 是比较不是赋值）。
  if (ASSIGNMENT.test(text.slice(after, after + 3))) {
    const operator = /^(?:[+\-*/%&|^]|<<|>>>?)?=/.exec(text.slice(after, after + 3))![0]
    if (operator !== '==' && operator !== '===') return 'write'
  }
  // ④ 剩下的按引用算 —— 包括出现在字符串/注释里的（那些已在 `usageKinds` 的 skip 里被挖掉）。
  return 'read'
}

// ---------------------------------------------------------------- 字符串字面量

const STRING_QUOTES = ['"', '\'', '`']

/**
 * 字符串/模板串的区间（含定界符）。转义用反斜杠跳过，模板串按 `${…}` 配平花括号。
 * 未闭合的一律到行尾（真实词法分析器会报语法错，那不属于本仓这一层）。
 */
export function stringRanges(text: string): TextRange[] {
  const ranges: TextRange[] = []
  let at = 0
  while (at < text.length) {
    const quote = STRING_QUOTES.find(candidate => text.startsWith(candidate, at))
    if (!quote) { ++at; continue }
    let cursor = at + quote.length
    let templateDepth = 0
    while (cursor < text.length) {
      const char = text[cursor]!
      if (char === '\\') { cursor += 2; continue }
      if (quote === '`' && char === '{' && text[cursor + 1] !== '{') { ++templateDepth; ++cursor; continue }
      if (quote === '`' && char === '}' && templateDepth > 0) { --templateDepth; ++cursor; continue }
      if (quote === '`' && templateDepth > 0) { ++cursor; continue }
      if (char === quote) { ++cursor; break }
      if (char === '\n' && quote !== '`') break
      ++cursor
    }
    ranges.push({ from: at, to: cursor })
    at = cursor
  }
  return ranges
}

// ---------------------------------------------------------------- 代码块范围

export interface CodeBlock { from: number; to: number }

/**
 * 光标所在的最内层花括号块（`AbstractCodeBlockSupportHandler.java:79-83` 的 `getCodeBlockRange`）。
 * 找不到（顶层 / 没有花括号）时返回 null —— 调用方据此不做块内收窄，
 * 与上游 `TextRange.EMPTY_RANGE` 的"没有块"含义一致。
 */
export function codeBlockRange(text: string, offset: number): CodeBlock | null {
  const braces: number[] = []
  for (let at = 0; at < Math.min(offset, text.length); ++at) {
    if (text[at] === '{') braces.push(at)
    else if (text[at] === '}' && braces.length) braces.pop()
  }
  const open = braces.length ? braces[braces.length - 1]! : -1
  if (open < 0) return null
  let depth = 0
  for (let at = open; at < text.length; ++at) {
    if (text[at] === '{') ++depth
    else if (text[at] === '}' && --depth === 0) return { from: open, to: at + 1 }
  }
  // 没闭合的块：到文末（与 `commentRanges` 里未闭合块注释的处理同一条口径）。
  return { from: open, to: text.length }
}

// ---------------------------------------------------------------- 状态栏文案

/**
 * `HighlightUsagesHandlerBase.buildStatusText`（:67-79）+ `CodeInsightBundle.properties:64-67`
 * 的四条消息。数到的 `refCount` 是**全部**出现（上游的高亮目标数），0 条时上游给的是 hint
 * 而不是状态栏信息 —— 这里用同一个函数的返回值区分，由调用方决定放到哪。
 */
export function highlightUsagesStatusText(count: number, elementName: string | null, shortcutText: string): string {
  const noun = `${count} ${count === 1 ? 'usage' : 'usages'}`
  if (count > 0) {
    const tail = `(press ${shortcutText} again to remove the highlighting, Escape to remove all highlighting)`
    return elementName !== null ? `${noun} of ${elementName} found ${tail}` : `${noun} found ${tail}`
  }
  return elementName !== null ? `No usages of ${elementName} found` : 'No usages found'
}

/** 上游那条 chooser 的第一个条目（`ChooseOneOrAllRunnable.java:51` + `CodeInsightBundle.properties:62`）。 */
export const CHOOSE_ALL_ENTRY = 'All listed'

/** 选中一个词（或词的一部分）时以它为准；否则取光标处标识符。 */
export function highlightTargetAt(text: string, from: number, to: number): IdentifierRange | null {
  if (to > from) {
    const selected = text.slice(from, to)
    if (isHighlightableWord(selected) && selected.trim() === selected && [...selected].every(isWordCharacter))
      return { word: selected, from, to }
  }
  return identifierAt(text, from)
}
