// Emmet HTML 缩写 → HTML 片段的纯函数端口（无 Vue、无宿主状态）。
//
// 上游坐标（参考树逐行核过，2026-10-07）：
//   词法  `xml/emmet/src/com/intellij/codeInsight/template/emmet/EmmetLexer.java`
//         `:19` DELIMS、`:22` 末尾追加 MARKER、`:31-66` 引号/花括号状态机、`:84-88` `ul+` 特例、
//         `:94-101` 纯数字（且不以 0 开头）→ NumberToken 否则 Identifier、`:135-138` 不闭合返回 null。
//         MARKER = `'\0'`（`ZenCodingTemplate.java:69`）。
//   语法  `EmmetParser.java` `:45-68` parse()（管道过滤器循环）、`:74-102` parseAddOrMore
//         （`^`→climb、`+`→add、`>`→more）、`:104-127` climb/more、`:130-141` parseMul
//         （`*`+数字 → Mul；无数字 → UnaryMul）、`:144-175` parseExpression（括号/文本/模板+文本）。
//         `:185-187` 模板键不是 QName 且无模板 ⇒ null。
//   选择器 `XmlEmmetParser.java` `:56` DEFAULT_TAG=div、`:57` DEFAULT_LOREM_LENGTH=30、
//         `:58` LOREM_PATTERN、`:59` DEFAULT_INLINE_TAG=span、`:66-80` parentChildTagMapping、
//         `:279-291` suggestTagName、`:299-315` 选择器合并（class/id 空格拼接）、`:319-345`
//         parseSelector（`[` 属性表 / `.` / `#`）、`:374` 无 `=` 的属性值 = `%boolean`。
//   节点  `nodes/AddOperationNode.java`（左支 insertSurroundedTextAtTheEnd=false）、
//         `nodes/ClimbUpOperationNode.java:46-56`（祖父在则挂祖父，否则挂原父）、
//         `nodes/MulOperationNode.java:37-43`（totalIterations=重复数）、
//         `nodes/MoreOperationNode.java:41-83`（左为 Mul 时逐份挂；泛型：右支挂到**每一个**左节点）、
//         `nodes/UnaryMulOperationNode.java:26-40`（无包围文本=单份；有=按行逐份）。
//   编号  `ZenCodingUtil.java:28-89` replaceMarkers（`$` 串、`@N` 基数、`@-` 倒数、按 `$` 串长补零、
//         `\` 转义、`$#` 围绕文本）、`:91-94` getValue（值里 `"` → `&quot;`）。
//   渲染  `generators/XmlZenCodingGeneratorImpl.java:124`（未闭合标签补成 `/>` 自闭合）、
//         `nodes/GenerationNode.java:504`（`%boolean` 渲染为裸属性名）。
//   标签表 `xml/xml-parser/src/com/intellij/xml/util/BasicHtmlUtil.java:56-59` EMPTY_TAGS_MAP、
//         `:78-86` POSSIBLY_INLINE_TAGS_MAP。
//   Lorem `generators/LoremGenerator.java:17-44` 词表逐字、`:64-83` generate（公共开头句 + 采样句）、
//         `:85-107` insertCommas、`:109-117` sentence（首词大写 + 结尾字符）、`:130-140` sample
//         （TreeSet：去重且**字典序**；`rand(0, len-1)` 取不到最后一个词——上游如此，照抄）、
//         `:142-145` choice。
//
// 本仓登记差异（不是上游行为，接线时向用户如实说明）：
//   1. 无 live-template 注册表：`a` 这类键展开为裸 `<a></a>`（上游查注册表会带 `href` 等）。
//   2. `X+` 尾缀只支持 parentChildTagMapping 里有的父标签（上游由 `ul+` 等 live 模板提供）。
//   3. Lorem 用确定性 LCG（上游 `new Random()`）；同输入同输出。
//   4. 输出单行、无 `$END$` 光标位、无 HTML schema 属性补全（`TemplateToken.java:100-119` 依赖 PSI）。
//   5. `|filter` 一律抛错：Bem/Comment/Escape/SingleLine/Trim/Xsl 六过滤器未移植。
//   6. 布尔属性只认字面 `[hidden]`（`%boolean`），不做 schema descriptor 推断。

/** 展开失败的原因码（对齐上游 `EmmetException` 的用法：宿主据此出气球迷泡）。 */
export type EmmetHtmlFailure = 'lex' | 'parse' | 'filter'

export class EmmetHtmlError extends Error {
  readonly reason: EmmetHtmlFailure
  constructor(reason: EmmetHtmlFailure, message: string) {
    super(message)
    this.reason = reason
  }
}

// ── 词法（EmmetLexer.java）──────────────────────────────────────────────────────

const EMMET_MARKER = '\0' // ZenCodingTemplate.java:69
const EMMET_DELIMS = `>^+*|()[]{}.#,='" ${EMMET_MARKER}` // EmmetLexer.java:19

type Token =
  | { t: 'id'; text: string }
  | { t: 'num'; n: number }
  | { t: 'str'; text: string } // 含两端引号（:31-46）
  | { t: 'txt'; text: string } // 含两端花括号（:53-66）
  | { t: 'p'; v: string }      // ( ) [ ] = . # , 空格 |
  | { t: 'op'; v: string }     // > ^ + *

/** EmmetLexer.java:20-138 的直译。引号/花括号不闭合返回 null（:135-138）。 */
function lexEmmet(input: string): Token[] | null {
  const text = input + EMMET_MARKER // :22
  const result: Token[] = []
  let builder = ''
  let inQuotes = false
  let inApostrophes = false
  let bracesStack = 0

  const flushWord = () => {
    if (!builder) return
    const asNumber = /^\d+$/.test(builder) ? Number(builder) : NaN
    if (!builder.startsWith('0') && asNumber >= 0) result.push({ t: 'num', n: asNumber })
    else result.push({ t: 'id', text: builder })
    builder = ''
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inQuotes) {
      builder += c
      if (c === '"') { inQuotes = false; result.push({ t: 'str', text: builder }); builder = '' }
      continue
    }
    if (inApostrophes) {
      builder += c
      if (c === "'") { inApostrophes = false; result.push({ t: 'str', text: builder }); builder = '' }
      continue
    }
    if (bracesStack > 0) {
      builder += c
      if (c === '}') {
        bracesStack--
        if (bracesStack === 0) { result.push({ t: 'txt', text: builder }); builder = '' }
      } else if (c === '{') bracesStack++
      continue
    }
    if (!EMMET_DELIMS.includes(c)) { builder += c; continue }
    // 特例：`ul+` 模板（:84-88）—— + 在结尾（MARKER 前）或 `)` 前时并入标识符。
    if (c === '+' && (i === text.length - 2 || text[i + 1] === ')')) { builder += c; continue }
    flushWord()
    if (c === '"') { inQuotes = true; builder += c }
    else if (c === "'") { inApostrophes = true; builder += c }
    else if (c === '{') { bracesStack = 1; builder += c }
    else if (c === '(' || c === ')' || c === '[' || c === ']' || c === '=' || c === '.' ||
             c === '#' || c === ',' || c === ' ' || c === '|') result.push({ t: 'p', v: c })
    else if (c !== EMMET_MARKER) result.push({ t: 'op', v: c })
  }
  if (bracesStack !== 0 || inQuotes || inApostrophes) return null
  return result
}

// ── 标签表（XmlEmmetParser / BasicHtmlUtil）─────────────────────────────────────

/** XmlEmmetParser.java:66-80 逐条（父标签 → 缺省子标签）。 */
export const EMMET_PARENT_CHILD_TAG: Readonly<Record<string, string>> = {
  p: 'span', ul: 'li', ol: 'li', table: 'tr', tr: 'td', tbody: 'tr', thead: 'tr', tfoot: 'tr',
  colgroup: 'col', select: 'option', optgroup: 'option', audio: 'source', video: 'source',
  object: 'param', map: 'area',
}

/** BasicHtmlUtil.java:56-59 逐条（空元素 → 自闭合）。 */
export const EMMET_EMPTY_TAGS: ReadonlySet<string> = new Set([
  'area', 'base', 'basefont', 'br', 'col', 'embed', 'frame', 'hr', 'meta', 'img', 'input',
  'isindex', 'link', 'param', 'source', 'track', 'wbr',
])

/** BasicHtmlUtil.java:78-86 逐条（可能是内联的 → 缺省子标签用 span）。 */
const EMMET_POSSIBLY_INLINE: ReadonlySet<string> = new Set([
  'a', 'abbr', 'acronym', 'applet', 'b', 'basefont', 'bdo', 'big', 'br', 'button',
  'cite', 'code', 'del', 'dfn', 'em', 'font', 'i', 'iframe', 'img', 'input', 'ins',
  'kbd', 'label', 'map', 'object', 'q', 's', 'samp', 'select', 'small', 'span', 'strike',
  'strong', 'sub', 'sup', 'textarea', 'tt', 'u', 'var',
])

/** XmlEmmetParser.java:279-291：父标签 → 缺省子标签（映射表 → 内联 → div）。 */
export function suggestEmmetChildTag(parentTag: string | null): string {
  if (parentTag !== null) {
    const mapped = EMMET_PARENT_CHILD_TAG[parentTag]
    if (mapped !== undefined) return mapped
    if (EMMET_POSSIBLY_INLINE.has(parentTag)) return 'span' // DEFAULT_INLINE_TAG（:59）
  }
  return 'div' // DEFAULT_TAG（:56）
}

// ── 编号占位（ZenCodingUtil.java:28-89 直译）───────────────────────────────────

/** `$`/`$$$`/`$@-`/`$@N`/`$#` 的替换。`$#` 仅在 surroundedText 非 null 时消费，否则原样保留。 */
export function replaceNumberMarkers(s: string, numberInIteration: number, totalIterations: number,
                                     surroundedText: string | null): string {
  let by = String(numberInIteration + 1)
  const out: string[] = []
  let markerStart = -1
  let i = 0
  const n = s.length
  while (i <= n) {
    const c = i < n ? s[i]! : ''
    if (c === '\\' && i < n - 1) {
      i++
      out.push(s[i]!)
    } else if (c === '$' && (i === n - 1 || s[i + 1] !== '#')) {
      if (markerStart === -1) markerStart = i
    } else {
      const markersCount = i - markerStart // Java :46 —— 必须在 @ 推进 i **之前**取
      if (markerStart !== -1) {
        let decrement = false
        if (i < n && s[i] === '@') {
          i++
          if (i < n && s[i] === '-') { decrement = true; i++ }
          let base = ''
          while (i < n && s[i]! >= '0' && s[i]! <= '9') { base += s[i]!; i++ }
          const baseInt = Math.max((base ? Number(base) : 0) - 1, 0)
          const byInt = (decrement ? totalIterations - numberInIteration : numberInIteration + 1) + baseInt
          by = String(byInt)
        }
        for (let k = 0; k < markersCount - by.length; k++) out.push('0')
        out.push(by)
        markerStart = -1
      }
      if (i < n) {
        const c2 = s[i]!
        if (c2 === '$' && surroundedText !== null) { out.push(surroundedText); i++ }
        else out.push(c2)
      }
    }
    i++
  }
  return out.join('')
}

/** ZenCodingUtil.java:93 —— 属性值里的 `"` 转成 `&quot;`。 */
function escapeAttrValue(value: string): string {
  return value.replace(/"/g, '&quot;')
}

// ── Lorem（LoremGenerator.java 词表逐字；随机源换确定性 LCG，登记差异 3）────────

const LOREM_COMMON_P = 'lorem ipsum dolor sit amet consectetur adipisicing elit'.split(' ') // :17
const LOREM_WORDS = [
  'exercitationem', 'perferendis', 'perspiciatis', 'laborum', 'eveniet',
  'sunt', 'iure', 'nam', 'nobis', 'eum', 'cum', 'officiis', 'excepturi',
  'odio', 'consectetur', 'quasi', 'aut', 'quisquam', 'vel', 'eligendi',
  'itaque', 'non', 'odit', 'tempore', 'quaerat', 'dignissimos',
  'facilis', 'neque', 'nihil', 'expedita', 'vitae', 'vero', 'ipsum',
  'nisi', 'animi', 'cumque', 'pariatur', 'velit', 'modi', 'natus',
  'iusto', 'eaque', 'sequi', 'illo', 'sed', 'ex', 'et', 'voluptatibus',
  'tempora', 'veritatis', 'ratione', 'assumenda', 'incidunt', 'nostrum',
  'placeat', 'aliquid', 'fuga', 'provident', 'praesentium', 'rem',
  'necessitatibus', 'suscipit', 'adipisci', 'quidem', 'possimus',
  'voluptas', 'debitis', 'sint', 'accusantium', 'unde', 'sapiente',
  'voluptate', 'qui', 'aspernatur', 'laudantium', 'soluta', 'amet',
  'quo', 'aliquam', 'saepe', 'culpa', 'libero', 'ipsa', 'dicta',
  'reiciendis', 'nesciunt', 'doloribus', 'autem', 'impedit', 'minima',
  'maiores', 'repudiandae', 'ipsam', 'obcaecati', 'ullam', 'enim',
  'totam', 'delectus', 'ducimus', 'quis', 'voluptates', 'dolores',
  'molestiae', 'harum', 'dolorem', 'quia', 'voluptatem', 'molestias',
  'magni', 'distinctio', 'omnis', 'illum', 'dolorum', 'voluptatum', 'ea',
  'quas', 'quam', 'corporis', 'quae', 'blanditiis', 'atque', 'deserunt',
  'laboriosam', 'earum', 'consequuntur', 'hic', 'cupiditate',
  'quibusdam', 'accusamus', 'ut', 'rerum', 'error', 'minus', 'eius',
  'ab', 'ad', 'nemo', 'fugit', 'officia', 'at', 'in', 'id', 'quos',
  'reprehenderit', 'numquam', 'iste', 'fugiat', 'sit', 'inventore',
  'beatae', 'repellendus', 'magnam', 'recusandae', 'quod', 'explicabo',
  'doloremque', 'aperiam', 'consequatur', 'asperiores', 'commodi',
  'optio', 'dolor', 'labore', 'temporibus', 'repellat', 'veniam',
  'architecto', 'est', 'esse', 'mollitia', 'nulla', 'a', 'similique',
  'eos', 'alias', 'dolore', 'tenetur', 'deleniti', 'porro', 'facere',
  'maxime', 'corrupti',
]

let loremSeed = 0x2f6e2b1 // 固定初值：同输入同输出（上游 new Random()，登记差异 3）
function loremRand(from: number, to: number): number { // = nextInt(to-from)+from（:159-161）
  loremSeed = (Math.imul(loremSeed, 1664525) + 1013904223) >>> 0
  return from + (loremSeed % (to - from))
}

/** LoremGenerator.java:130-140 —— TreeSet 采样：去重、**字典序**、且取不到最后一个词（照抄）。 */
function loremSample(count: number): string[] {
  const iterations = Math.min(LOREM_WORDS.length, count)
  const picked = new Set<string>()
  while (picked.size < iterations) picked.add(LOREM_WORDS[loremRand(0, LOREM_WORDS.length - 1)]!)
  return [...picked].sort()
}

/** LoremGenerator.java:109-117 —— 首词大写 + 结束字符。 */
function loremSentence(words: string[], end: string): string {
  if (words.length > 0) words[0] = words[0]![0]!.toUpperCase() + words[0]!.slice(1)
  return `${words.join(' ')}${end}`
}

/** LoremGenerator.java:85-107 —— 按句子长度随机插入逗号。 */
function loremInsertCommas(words: string[]): void {
  if (words.length <= 1) return
  const len = words.length
  let total = len > 3 && len <= 6 ? loremRand(0, 1)
    : len > 6 && len <= 12 ? loremRand(0, 2)
    : loremRand(1, 4)
  while (total > 0) {
    const word = words[loremRand(0, words.length - 1)]!
    if (!word.endsWith(',')) words[words.indexOf(word)] = `${word},`
    total--
  }
}

/** LoremGenerator.java:64-83 generate：公共开头句 + 采样句，直到凑满词数。 */
export function generateLorem(wordsCount: number): string {
  loremSeed = 0x2f6e2b1
  const sentences: string[] = []
  let total = 0
  const head = LOREM_COMMON_P.slice(0, Math.min(wordsCount, LOREM_COMMON_P.length))
  if (head.length > 0) {
    if (head.length > 5) head[4] += ','
    total += head.length
    sentences.push(loremSentence(head, '.'))
  }
  while (total < wordsCount) {
    const words = loremSample(Math.min(loremRand(3, 12) * loremRand(1, 5), wordsCount - total))
    total += words.length
    loremInsertCommas(words)
    sentences.push(loremSentence(words, '?!...'[loremRand(0, 3)] ?? '.'))
  }
  return sentences.join(' ')
}

// ── 语法树与递归下降（EmmetParser.java 直译）────────────────────────────────────

type EmmetNode =
  | { k: 'tag'; tag: string | null; attrs: [string, string][] } // tag=null = 纯选择器，生成期按父标签补
  | { k: 'text'; text: string }
  | { k: 'lorem'; words: number }
  | { k: 'add'; l: EmmetNode; r: EmmetNode }
  | { k: 'more'; l: EmmetNode; r: EmmetNode }
  | { k: 'climb'; l: EmmetNode; r: EmmetNode }
  | { k: 'mul'; l: EmmetNode; n: number }
  | { k: 'unarymul'; l: EmmetNode }
  | { k: 'empty' }

const LOREM_PATTERN = /^(lorem|lipsum)(\d*)$/ // XmlEmmetParser.java:58
const TAG_NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_:-]*$/u // QName 简化（上游 XML11Char，登记差异 6 旁注）

class EmmetParser {
  private pos = 0
  private readonly tokens: Token[]
  constructor(tokens: Token[]) { this.tokens = tokens }

  private peek(): Token | null { return this.tokens[this.pos] ?? null }

  /** EmmetParser.java:45-68 parse()。过滤器未移植 ⇒ 一律抛错（登记差异 5）。 */
  parse(): EmmetNode | null {
    let result = this.parseAddOrMore()
    if (result === null) return null
    while (true) {
      const token = this.peek()
      if (!(token?.t === 'p' && token.v === '|')) return result
      this.pos++
      const filter = this.peek()
      if (filter?.t !== 'id') return null
      throw new EmmetHtmlError('filter', `过滤器 |${filter.text} 未移植（Bem/Comment/Escape/SingleLine/Trim/Xsl 均不在本仓）`)
    }
    return result
  }

  /** EmmetParser.java:74-102。 */
  private parseAddOrMore(): EmmetNode | null {
    const mul = this.parseMul(this.parseExpression())
    const op = this.peek()
    if (!(op?.t === 'op')) return mul
    if (op.v === '^') return this.parseClimbUp(mul)
    if (op.v === '+') {
      this.pos++
      const add2 = this.parseAddOrMore()
      return add2 === null ? mul : { k: 'add', l: mul ?? EMPTY, r: add2 }
    }
    if (op.v === '>') return this.parseMore(mul)
    return null
  }

  /** EmmetParser.java:104-111。 */
  private parseClimbUp(left: EmmetNode | null): EmmetNode | null {
    this.pos++
    const right = this.parseAddOrMore()
    return right === null ? left : { k: 'climb', l: left ?? EMPTY, r: right }
  }

  /** EmmetParser.java:113-120。 */
  private parseMore(left: EmmetNode | null): EmmetNode | null {
    this.pos++
    const right = this.parseAddOrMore()
    return right === null ? left : { k: 'more', l: left ?? EMPTY, r: right }
  }

  /** EmmetParser.java:130-141。 */
  private parseMul(expression: EmmetNode | null): EmmetNode | null {
    const op = this.peek()
    if (expression !== null && op?.t === 'op' && op.v === '*') {
      this.pos++
      const num = this.peek()
      if (num?.t === 'num') { this.pos++; return { k: 'mul', l: expression, n: num.n } }
      return { k: 'unarymul', l: expression }
    }
    return expression
  }

  /** EmmetParser.java:144-175。 */
  private parseExpression(): EmmetNode | null {
    const token = this.peek()
    if (token?.t === 'p' && token.v === '(') {
      this.pos++
      const add = this.parseAddOrMore()
      if (add === null) return null
      const closing = this.peek()
      if (!(closing?.t === 'p' && closing.v === ')')) return null
      this.pos++
      return add
    }
    if (token?.t === 'txt') { this.pos++; return { k: 'text', text: token.text } }
    const template = this.parseTemplate()
    if (template === null) return null
    const after = this.peek()
    if (after?.t === 'txt') { this.pos++; return { k: 'more', l: template, r: { k: 'text', text: after.text } } }
    return template
  }

  /** EmmetParser.java:177-193 + XmlEmmetParser 覆写侧。 */
  private parseTemplate(): EmmetNode | null {
    const token = this.peek()
    const bareSelector = token?.t === 'p' && (token.v === '.' || token.v === '#' || token.v === '[')
    if (token?.t !== 'id' && !bareSelector) return null
    const key = token?.t === 'id' ? token.text : ''
    if (token?.t === 'id') this.pos++

    // `ul+` 特例（词法 :84-88 已并入标识符）：只支持 parentChildTagMapping 里有的父标签（差异 2）。
    if (key.endsWith('+')) {
      const base = key.slice(0, -1)
      const child = EMMET_PARENT_CHILD_TAG[base]
      if (child === undefined || !TAG_NAME_PATTERN.test(base)) return null
      return { k: 'more', l: { k: 'tag', tag: base, attrs: this.parseSelectors() }, r: { k: 'tag', tag: child, attrs: [] } }
    }

    const lorem = LOREM_PATTERN.exec(key)
    if (lorem) return { k: 'lorem', words: lorem[2] ? Number(lorem[2]) : 30 } // DEFAULT_LOREM_LENGTH（:57）
    if (key !== '' && !TAG_NAME_PATTERN.test(key)) return null // :185-187
    return { k: 'tag', tag: key === '' ? null : key, attrs: this.parseSelectors() }
  }

  /** XmlEmmetParser.java:299-345：`.` `#` `[...]` 循环；class/id 空格拼接（:305-312）。
   *  合并容器 = LinkedHashMap 语义：按**首见**顺序，class/id 累加，普通属性同名替换（保位）。 */
  private parseSelectors(): [string, string][] {
    const merged: [string, string[]][] = []
    const slotFor = (name: string): string[] => {
      const existing = merged.find(entry => entry[0] === name)
      if (existing !== undefined) return existing[1]
      const values: string[] = []
      merged.push([name, values])
      return values
    }
    const putPlain = (name: string, value: string) => {
      const existing = merged.find(entry => entry[0] === name)
      if (existing !== undefined) {
        merged[merged.indexOf(existing)] = [name, [value]]
      } else {
        merged.push([name, [value]])
      }
    }
    while (true) {
      const token = this.peek()
      if (token?.t === 'p' && token.v === '[') {
        this.pos++
        for (const [name, value] of this.parseAttributeList()) putPlain(name, value)
        const closing = this.peek()
        if (!(closing?.t === 'p' && closing.v === ']')) break
        this.pos++
        continue
      }
      if (token?.t === 'p' && (token.v === '.' || token.v === '#')) {
        const isClass = token.v === '.'
        this.pos++
        const value = this.attributeValueOfToken(this.peek(), false)
        if (value !== '') this.pos++
        slotFor(isClass ? 'class' : 'id').push(value)
        continue
      }
      break
    }
    return merged.map(([name, values]) => [name, values.join(' ')] as [string, string])
  }

  /** XmlEmmetParser.java:349-364：属性表，逗号/空格分隔。 */
  private parseAttributeList(): [string, string][] {
    const attrs: [string, string][] = []
    while (true) {
      const attr = this.parseAttribute()
      if (attr === null) break
      attrs.push(attr)
      const token = this.peek()
      if (!(token?.t === 'p' && (token.v === ',' || token.v === ' '))) break
      this.pos++
    }
    return attrs
  }

  /** XmlEmmetParser.java:366-396：`name.`（点后缀=布尔 :370-376）/ `name=value` / `name`（空值）
   *  / 裸值（挂 %default，无 schema 推断默认属性名 —— 登记差异 6）。 */
  private parseAttribute(): [string, string] | null {
    const position = this.pos
    const name = this.parseAttributeName()
    if (name !== null && name !== '') {
      const token = this.peek()
      if (token?.t === 'p' && token.v === '.') {
        if (this.isEndOfAttribute(this.tokens[this.pos + 1] ?? null)) {
          this.pos++ // 过掉点
          return [name, '%boolean']
        }
      } else {
        if (token?.t === 'p' && token.v === '=') {
          this.pos++
          return [name, this.parseAttributeValue()]
        }
        return [name, '']
      }
    }
    this.pos = position
    const implied = this.parseAttributeValue()
    if (implied !== '') return ['%default', implied]
    return null
  }

  /** XmlEmmetParser.java:101-129：属性名 = 标识符与 +/- 连拼（`data-x` 这类）。 */
  private parseAttributeName(): string | null {
    let name = ''
    while (true) {
      const token = this.peek()
      if (token === null) break
      if (token.t === 'id') name += token.text
      else if (token.t === 'op' && (token.v === '+' || token.v === '-')) name += token.v
      else break
      this.pos++
    }
    return name === '' ? null : name
  }

  /** XmlEmmetParser.java:398-412：值 = 连拼标识符/数字/引号串/文本/操作符/`.`/`#`，遇 空格/`]`/`,` 止。 */
  private parseAttributeValue(): string {
    let value = ''
    while (true) {
      const token = this.peek()
      value += this.attributeValueOfToken(token, true)
      if (this.isEndOfAttribute(token)) break
      this.pos++
    }
    return value
  }

  /** XmlEmmetParser.java:414-417：null / 空格 / `]` / `,` 都算属性值结束。 */
  private isEndOfAttribute(token: Token | null): boolean {
    return token === null || (token.t === 'p' && (token.v === ' ' || token.v === ']' || token.v === ','))
  }

  /** XmlEmmetParser.java:141-152：引号串去引号；文本保花括号；操作符仅在 allowOperations 时计入。 */
  private attributeValueOfToken(token: Token | null, allowOperations: boolean): string {
    if (token === null) return ''
    if (token.t === 'str') return token.text.slice(1, -1)
    if (token.t === 'txt') return token.text
    if (token.t === 'id') return token.text
    if (token.t === 'num') return String(token.n)
    if (allowOperations && token.t === 'op') return token.v
    if (token.t === 'p' && (token.v === '.' || token.v === '#')) return token.v
    return ''
  }
}

const EMPTY: EmmetNode = { k: 'empty' }

// ── 生成（四个操作节点 + GenerationNode 的挂接规则直译）────────────────────────

interface GenNode {
  tag: string | null // null = 纯文本节点
  attrs: [string, string][]
  voidTag: boolean
  text: string | null
  children: GenNode[]
  parent: GenNode | null
}

function genTag(node: Extract<EmmetNode, { k: 'tag' }>, parent: GenNode | null, iter: number,
                total: number, surrounded: string | null): GenNode {
  const tag = node.tag ?? suggestEmmetChildTag(parent?.tag ?? null)
  // `%default`（裸 `[=值]`）要靠 HTML schema 推断默认属性名（TemplateToken.java:100-119），本仓无 PSI
  // ⇒ 丢弃该项（登记差异 6）。
  const attrs: [string, string][] = node.attrs
    .filter(([name]) => name !== '%default')
    .map(([name, raw]) =>
      [name, escapeAttrValue(replaceNumberMarkers(raw, iter, total, surrounded))])
  return { tag, attrs, voidTag: EMMET_EMPTY_TAGS.has(tag.toLowerCase()), text: null, children: [], parent }
}

function expandNode(node: EmmetNode, parent: GenNode | null, iter: number, total: number,
                    surrounded: string | null, insertAtEnd: boolean): GenNode[] {
  switch (node.k) {
    case 'empty': return []
    case 'text': {
      const inner = node.text.slice(1, -1) // TextToken 含花括号（EmmetLexer.java:53-66）
      const replaced = replaceNumberMarkers(inner, iter, total, surrounded)
      return [{ tag: null, attrs: [], voidTag: false, text: replaced, children: [], parent }]
    }
    case 'lorem':
      return [{ tag: null, attrs: [], voidTag: false, text: generateLorem(node.words), children: [], parent }]
    case 'tag': {
      const gen = genTag(node, parent, iter, total, surrounded)
      // ZenCodingUtil.java:24-26 + insertSurroundedTextAtTheEnd：无处安放的围选文本落到正文末尾。
      if (insertAtEnd && surrounded !== null &&
          !node.attrs.some(([, raw]) => raw.includes('$#'))) gen.text = surrounded
      return [gen]
    }
    case 'add': { // AddOperationNode：左支不吃 insertAtEnd，右支吃。
      const left = expandNode(node.l, parent, iter, total, surrounded, false)
      return [...left, ...expandNode(node.r, parent, iter, total, surrounded, insertAtEnd)]
    }
    case 'mul': { // MulOperationNode:37-43
      const result: GenNode[] = []
      for (let i = 0; i < node.n; i++) result.push(...expandNode(node.l, parent, i, node.n, surrounded, insertAtEnd))
      return result
    }
    case 'unarymul': // UnaryMulOperationNode:26-40
      if (surrounded === null) return expandNode(node.l, parent, iter, total, null, insertAtEnd)
      return surrounded.split('\n').flatMap(line => expandNode(node.l, parent, iter, total, line, insertAtEnd))
    case 'more': {
      // MoreOperationNode:41-83：左为 Mul 时逐份 i；右支挂到每一个左节点（:79-83）。
      if (node.l.k === 'mul') {
        const result: GenNode[] = []
        for (let i = 0; i < node.l.n; i++) {
          const parents = expandNode(node.l.l, parent, i, total, surrounded, insertAtEnd)
          for (const parentNode of parents) {
            parentNode.children.push(...expandNode(node.r, parentNode, i, total, surrounded, insertAtEnd))
          }
          result.push(...parents)
        }
        return result
      }
      if (node.l.k === 'unarymul' && surrounded !== null) {
        const lines = surrounded.split('\n')
        const result: GenNode[] = []
        for (let i = 0; i < lines.length; i++) {
          const parents = expandNode(node.l.l, parent, i, lines.length, lines[i], insertAtEnd)
          for (const parentNode of parents) {
            parentNode.children.push(...expandNode(node.r, parentNode, i, lines.length, lines[i], insertAtEnd))
          }
          result.push(...parents)
        }
        return result
      }
      const lefts = expandNode(node.l, parent, iter, total, surrounded, insertAtEnd)
      if (lefts.length === 0) return expandNode(node.r, parent, iter, total, surrounded, insertAtEnd)
      for (const left of lefts) left.children.push(...expandNode(node.r, left, iter, total, surrounded, insertAtEnd))
      return lefts
    }
    case 'climb': { // ClimbUpOperationNode:46-56：祖父在则挂祖父（不进返回值），否则挂原父。
      const result = expandNode(node.l, parent, iter, total, surrounded, insertAtEnd)
      const grandParent = parent?.parent ?? null
      if (grandParent !== null) grandParent.children.push(...expandNode(node.r, grandParent, iter, total, surrounded, insertAtEnd))
      else result.push(...expandNode(node.r, parent, iter, total, surrounded, insertAtEnd))
      return result
    }
  }
}

// ── 渲染（XmlZenCodingGeneratorImpl / GenerationNode 的字符串化）───────────────

function renderGen(node: GenNode): string {
  if (node.tag === null) return node.text ?? ''
  const attrs = node.attrs.map(([name, value]) =>
    value === '%boolean' ? name : `${name}="${value}"`).join(' ') // GenerationNode.java:504
  const open = `<${node.tag}${attrs ? ` ${attrs}` : ''}`
  if (node.voidTag) return `${open}/>` // XmlZenCodingGeneratorImpl.java:124（补 "/>" 自闭合）
  const inner = `${node.text ?? ''}${node.children.map(renderGen).join('')}`
  return `${open}>${inner}</${node.tag}>`
}

// ── 公开入口 ────────────────────────────────────────────────────────────────────

export interface EmmetHtmlOptions {
  /** 围绕文本（SurroundWithEmmet）：`$#` 的替换源；`X*`（无数字）按行逐份。 */
  surroundedText?: string
  /** 无 `$#` 落点时把围选文本追加到正文末尾（上游 insertSurroundedTextAtTheEnd）。 */
  insertSurroundedTextAtEnd?: boolean
}

/** Emmet HTML 缩写 → HTML 片段。词法/语法失败抛 `EmmetHtmlError`（宿主出气球迷泡）。 */
export function expandEmmetHtml(abbreviation: string, options: EmmetHtmlOptions = {}): string {
  const surrounded = options.surroundedText !== undefined ? options.surroundedText : null
  const tokens = lexEmmet(abbreviation)
  if (tokens === null) throw new EmmetHtmlError('lex', '缩写里的引号或花括号没有闭合')
  const ast = new EmmetParser(tokens).parse()
  if (ast === null) throw new EmmetHtmlError('parse', '这不是一个合法的 Emmet 缩写')
  const tops = expandNode(ast, null, 0, 1, surrounded, options.insertSurroundedTextAtEnd ?? false)
  return tops.map(renderGen).join('')
}
