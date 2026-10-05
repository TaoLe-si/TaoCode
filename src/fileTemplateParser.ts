// 文件模板的**语法引擎**（上游 `platform/lang-impl/src/com/intellij/ide/fileTemplates/` 里
// Velocity 模板文本的子集）。变量表与纯变量展开入口在 `src/fileTemplateVars.ts`；这里补的是
// 那层**模板正文本身**的文法，对应上游三处：
//   · `java-impl/resources/fileTemplates/internal/Class.java.ft:1-6` 的真实模板正文 ——
//     `#if (${PACKAGE_NAME} && ${PACKAGE_NAME} != "")…#end` 与 `#parse("File Header.java")`；
//   · `FileTemplateUtil.java:102-108` 的 `#set` 指令（`ASTSetDirective` 定义属性）与
//     `FileTemplateUtil.java:109-126` 的 `#parse` 指令（单字符串子节点）；
//   · `platform/platform-resources-en-file-templates/src/fileTemplates/default.html:62-67`
//     的 `${DS}` —— 「Dollar sign ($)…用来转义美元符号，使它不被当成模板变量的前缀」。
//
// 与 `src/fileTemplateVars.ts` 的 `expandFileTemplate` 分工：那边是**两遍替换**的简单变量展开
// （先 `${NAME}` 后 `$NAME`），适合不含指令的纯变量文本；这里是**单遍**的完整引擎 —— 单遍是
// `${DS}` 能成立的前提：`${DS}NAME` 必须输出字面量 `$NAME`，两遍替换会把它再展开一次。
//
// 两种错误分开报，对应上游两个不同的类：
//   · `FileTemplateParseError` ← 上游 `FileTemplateParseException`
//     （`FileTemplateBase.java:96-97` 包 `ParseException`：模板**语法**错）；
//   · `TemplateNotFoundError` ← 上游 `ResourceNotFoundException`
//     （`VelocityWrapper.java:83-85`，消息逐字为 `Template not found: <name>`：子模板**缺失**）。

/** 模板语法错误（上游 `FileTemplateParseException`，`FileTemplateParseException.java:4-7`）。 */
export class FileTemplateParseError extends Error {
  /** 1 基行号，指向出错的 `#` 指令。 */
  readonly line: number

  constructor(message: string, line: number) {
    super(line > 0 ? `第 ${line} 行：${message}` : message)
    this.name = 'FileTemplateParseError'
    this.line = line
  }
}

/** `#parse` 的目标模板不存在（上游 `VelocityWrapper.java:84` 的 `ResourceNotFoundException`）。 */
export class TemplateNotFoundError extends Error {
  readonly template: string

  constructor(template: string) {
    super(`Template not found: ${template}`)
    this.name = 'TemplateNotFoundError'
    this.template = template
  }
}

export type TemplateNode =
  | { kind: 'text'; text: string }
  | { kind: 'var'; name: string; line: number }
  | { kind: 'if'; branches: TemplateBranch[]; line: number }
  | { kind: 'set'; name: string; value: string; line: number }
  | { kind: 'parse'; target: string; line: number }

/** `#if` 的一个分支；`condition` 为 null 即 `#else`。 */
export interface TemplateBranch {
  condition: string | null
  body: TemplateNode[]
}

const DIRECTIVES = ['if', 'elseif', 'else', 'end', 'set', 'parse'] as const
type Directive = typeof DIRECTIVES[number]

interface Cursor { source: string; at: number }

function lineAt(source: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset && index < source.length; index++) if (source[index] === '\n') line++
  return line
}

/** 指令只认**行首**（允许前导空白）。这样 `#!/bin/sh`、`#region`、C# 预处理指令都只是普通文本。 */
function directiveAt(source: string, at: number): { name: Directive; after: number } | null {
  if (source[at] !== '#') return null
  for (let index = at - 1; index >= 0; index--) {
    const char = source[index]
    if (char === '\n') break
    if (char !== ' ' && char !== '\t') return null
  }
  const name = /^#([A-Za-z]+)/.exec(source.slice(at))?.[1]
  if (!name || !(DIRECTIVES as readonly string[]).includes(name)) return null
  // `#ifx` 不是 `#if`：指令名后面必须是空白、括号或行尾。
  const after = source[at + 1 + name.length]
  if (after !== undefined && !/[\s(]/.test(after)) return null
  return { name: name as Directive, after: at + 1 + name.length }
}

/** 指令名与 `(` 之间允许有空白（`#if (${A} != "")`、`#parse ("X")` 都合法）。 */
function skipSpaces(source: string, at: number): number {
  let index = at
  while (index < source.length && (source[index] === ' ' || source[index] === '\t')) index++
  return index
}

/**
 * 指令独占一行时把它后面的换行也吃掉（Velocity 的行指令语义）—— 否则 `#end`、`#parse(...)`
 * 每条都会在生成的文件里多留一个空行。指令后面还跟着正文时不动（`Class.java.ft:1` 的
 * `#if (…)package ${PACKAGE_NAME};` 那个换行是正文的一部分）。
 */
function skipDirectiveLineTail(cursor: Cursor): void {
  let index = cursor.at
  while (index < cursor.source.length && (cursor.source[index] === ' ' || cursor.source[index] === '\t')) index++
  if (cursor.source[index] === '\r') index++
  if (cursor.source[index] === '\n') { cursor.at = index + 1; return }
  // 行尾还有别的内容：游标退回到正文起点，让它进 body。
}

/**
 * 读一个带括号参数的指令（`#if` / `#elseif` / `#set` / `#parse`）：跳过指令名后的空白，
 * 做括号配平扫描，返回括号内的正文与结束位置。
 */
function directiveArgs(source: string, from: number, line: number): { args: string; end: number } {
  const open = skipSpaces(source, from)
  if (source[open] !== '(') throw new FileTemplateParseError('指令缺少括号参数。', line)
  let depth = 0
  let quote = ''
  for (let index = open; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === '\\') index++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth === 0) return { args: source.slice(open + 1, index), end: index + 1 }
    }
  }
  throw new FileTemplateParseError('指令的括号没有闭合。', line)
}

/** 剥一层引号（`#parse("X")` 的字符串子节点，`FileTemplateUtil.java:111-114`）。 */
function unquote(raw: string, line: number): string {
  const text = raw.trim()
  if (text.length >= 2) {
    const quote = text[0]
    if ((quote === '"' || quote === "'") && text[text.length - 1] === quote) {
      return text.slice(1, -1).replace(/\\(.)/g, '$1')
    }
  }
  throw new FileTemplateParseError(`#parse 的参数必须是引号里的模板名，收到 ${text || '（空）'}。`, line)
}

/** 读一个变量引用；不是合法引用（`$1`、`$(x)`、`$` 行尾）时返回 null。 */
function readVariableReference(source: string, at: number): { name: string; end: number } | null {
  const braced = /^\$\{([A-Za-z_]\w*)\}/.exec(source.slice(at))
  if (braced) return { name: braced[1], end: at + braced[0].length }
  const bare = /^\$([A-Za-z_]\w*)/.exec(source.slice(at))
  if (bare) return { name: bare[1], end: at + bare[0].length }
  return null
}

/**
 * 解析一段节点序列。遇到 `#if` 递归；遇到 `#elseif`/`#else`/`#end` 时 flush 掉已攒的正文并
 * 返回，**游标留在指令上**由 `parseConditional` 收口 —— 这就是 `#if` 之后那段同行的
 * `package ${PACKAGE_NAME};` 能进 body 的原因（`Class.java.ft:1`）。
 */
function parseNodes(cursor: Cursor): TemplateNode[] {
  const nodes: TemplateNode[] = []
  let text = ''
  const flush = () => {
    if (text) { nodes.push({ kind: 'text', text }); text = '' }
  }
  while (cursor.at < cursor.source.length) {
    const char = cursor.source[cursor.at]
    if (char === '$') {
      const reference = readVariableReference(cursor.source, cursor.at)
      if (reference) {
        flush()
        nodes.push({ kind: 'var', name: reference.name, line: lineAt(cursor.source, cursor.at) })
        cursor.at = reference.end
        continue
      }
    }
    if (char === '#') {
      const directive = directiveAt(cursor.source, cursor.at)
      if (directive) {
        const line = lineAt(cursor.source, cursor.at)
        if (directive.name === 'if') { flush(); nodes.push(parseConditional(cursor, directive.after, line)); continue }
        // #elseif / #else / #end：body 到此为止，游标**留在指令上**由 parseConditional 收口。
        flush()
        return nodes
      }
    }
    text += char
    cursor.at++
  }
  flush()
  return nodes
}

/** `#if` / `#elseif` / `#else` / `#end` 一整组。`open` 是指令名之后（即 `(` 应在的位置）。 */
function parseConditional(cursor: Cursor, from: number, line: number): TemplateNode {
  const branches: TemplateBranch[] = []
  const head = directiveArgs(cursor.source, from, line)
  const condition = head.args.trim()
  if (!condition) throw new FileTemplateParseError('#if 的条件不能为空。', line)
  cursor.at = head.end
  skipDirectiveLineTail(cursor)
  branches.push({ condition, body: parseNodes(cursor) })
  for (;;) {
    const at = cursor.at
    const directive = at < cursor.source.length ? directiveAt(cursor.source, at) : null
    if (!directive) break
    const directiveLine = lineAt(cursor.source, at)
    if (directive.name === 'elseif') {
      const next = directiveArgs(cursor.source, directive.after, directiveLine)
      const condition = next.args.trim()
      if (!condition) throw new FileTemplateParseError('#elseif 的条件不能为空。', directiveLine)
      cursor.at = next.end
      skipDirectiveLineTail(cursor)
      branches.push({ condition, body: parseNodes(cursor) })
      continue
    }
    if (directive.name === 'else') {
      cursor.at = at + 5
      skipDirectiveLineTail(cursor)
      branches.push({ condition: null, body: parseNodes(cursor) })
      continue
    }
    if (directive.name === 'end') { cursor.at = at + 4; skipDirectiveLineTail(cursor); return { kind: 'if', branches, line } }
    throw new FileTemplateParseError('#if 与 #else/#elseif 之间不能再出现同级条件指令。', directiveLine)
  }
  throw new FileTemplateParseError('#if 没有配对的 #end。', line)
}

function parseSet(cursor: Cursor, from: number, line: number): TemplateNode {
  const head = directiveArgs(cursor.source, from, line)
  const body = head.args
  const equals = body.indexOf('=')
  if (equals < 0) throw new FileTemplateParseError('#set 的参数需要写成 #set($NAME = 值)。', line)
  const name = body.slice(0, equals).trim().replace(/^\$/, '')
  if (!/^[A-Za-z_]\w*$/.test(name)) throw new FileTemplateParseError(`#set 的变量名 ${name || '（空）'} 不合法。`, line)
  const value = body.slice(equals + 1).trim()
  if (!value) throw new FileTemplateParseError('#set 的值不能为空。', line)
  cursor.at = head.end
  skipDirectiveLineTail(cursor)
  return { kind: 'set', name, value, line }
}

function parseParse(cursor: Cursor, from: number, line: number): TemplateNode {
  const head = directiveArgs(cursor.source, from, line)
  const target = unquote(head.args, line)
  cursor.at = head.end
  skipDirectiveLineTail(cursor)
  return { kind: 'parse', target, line }
}

/** 模板正文 → 节点树。语法错抛 `FileTemplateParseError`。 */
export function parseFileTemplate(source: string): TemplateNode[] {
  const cursor: Cursor = { source, at: 0 }
  const nodes: TemplateNode[] = []
  for (;;) {
    // parseNodes 遇到非 #if 的指令就停下并把游标留在指令上，这里逐个收口。
    nodes.push(...parseNodes(cursor))
    if (cursor.at >= source.length) return nodes
    const directive = directiveAt(source, cursor.at)
    if (!directive) return nodes
    const line = lineAt(source, cursor.at)
    if (directive.name === 'if') nodes.push(parseConditional(cursor, directive.after, line))
    else if (directive.name === 'set') nodes.push(parseSet(cursor, directive.after, line))
    else if (directive.name === 'parse') nodes.push(parseParse(cursor, directive.after, line))
    else throw new FileTemplateParseError(`#${directive.name} 没有对应的 #if。`, line)
  }
}

// ---- 条件/值求值（`#if` 的条件与 `#set` 的值共用一套） ----

export type Operand = { type: 'string'; value: string } | { type: 'number'; value: number } | { type: 'bool'; value: boolean }

const TRUE: Operand = { type: 'bool', value: true }
const FALSE: Operand = { type: 'bool', value: false }

function truthy(value: Operand): boolean {
  if (value.type === 'bool') return value.value
  if (value.type === 'number') return value.value !== 0
  return value.value !== '' && value.value !== 'false'
}

function asText(value: Operand): string {
  return String(value.value)
}

function asNumber(value: Operand): number | null {
  if (value.type === 'number') return value.value
  if (value.type === 'bool') return value.value ? 1 : 0
  const text = value.value.trim()
  if (text === '') return null
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null
}

const OPERATORS = ['&&', '||', '==', '!=', '<=', '>='] as const
const COMPARISONS = new Set<string>(['==', '!=', '<', '>', '<=', '>='])

/** 词法：null = 输入结束（调用方据此决定「还要一个值」还是「这条链到此为止」）。 */
function readOperand(cursor: Cursor, variables: Record<string, string>): Operand | null {
  const source = cursor.source
  while (cursor.at < source.length && /\s/.test(source[cursor.at])) cursor.at++
  if (cursor.at >= source.length) return null
  const pair = source.slice(cursor.at, cursor.at + 2)
  const operator = OPERATORS.find(candidate => candidate === pair)
  if (operator) { cursor.at += 2; return { type: 'string', value: operator } }
  const single = source[cursor.at]
  if (single === '!' || single === '<' || single === '>') { cursor.at++; return { type: 'string', value: single } }
  if (single === '(') { cursor.at++; return { type: 'string', value: '(' } }
  if (single === ')' || single === ',') { cursor.at++; return { type: 'string', value: single } }
  if (single === '"' || single === "'") {
    let index = cursor.at + 1
    let text = ''
    while (index < source.length && source[index] !== single) {
      if (source[index] === '\\') index++
      text += source[index]
      index++
    }
    if (index >= source.length) throw new FileTemplateParseError('条件里的字符串没有闭合。', 0)
    cursor.at = index + 1
    return { type: 'string', value: text }
  }
  if (single === '$') {
    const reference = readVariableReference(source, cursor.at)
    if (reference) {
      cursor.at = reference.end
      // 条件里没定义的变量算空串：`Class.java.ft:1` 的 `#if (${PACKAGE_NAME} && …)`
      // 在推不出包名时就靠这个为假。
      const value = variables[reference.name]
      return { type: 'string', value: value === undefined ? '' : value }
    }
  }
  const number = /^-?\d+(\.\d+)?/.exec(source.slice(cursor.at))
  if (number) { cursor.at += number[0].length; return { type: 'number', value: Number(number[0]) } }
  const word = /^[A-Za-z_]\w*/.exec(source.slice(cursor.at))
  if (word) {
    cursor.at += word[0].length
    if (word[0] === 'true') return TRUE
    if (word[0] === 'false') return FALSE
    if (word[0] === 'null') return { type: 'string', value: '' }
    return { type: 'string', value: word[0] }
  }
  throw new FileTemplateParseError(`条件里无法识别的字符「${single}」。`, 0)
}

/** 需要一个值时用这个包装：输入结束 = 语法错。 */
function requireOperand(cursor: Cursor, variables: Record<string, string>): Operand {
  const value = readOperand(cursor, variables)
  if (value === null) throw new FileTemplateParseError('条件在这里就结束了。', 0)
  return value
}

/** 偷看一个 token：是 `keyword` 就消费掉并返回 true，否则回退游标。 */
function accept(cursor: Cursor, variables: Record<string, string>, keyword: string): boolean {
  const mark = cursor.at
  const token = readOperand(cursor, variables)
  if (token && token.type === 'string' && token.value === keyword) return true
  cursor.at = mark
  return false
}

function compare(operator: string, left: Operand, right: Operand): Operand {
  const a = asNumber(left)
  const b = asNumber(right)
  const both = a !== null && b !== null
  const x = both ? (a as number) : asText(left)
  const y = both ? (b as number) : asText(right)
  switch (operator) {
    case '==': return x === y ? TRUE : FALSE
    case '!=': return x !== y ? TRUE : FALSE
    case '<': return x < y ? TRUE : FALSE
    case '>': return x > y ? TRUE : FALSE
    case '<=': return x <= y ? TRUE : FALSE
    default: return x >= y ? TRUE : FALSE
  }
}

function parseOr(cursor: Cursor, variables: Record<string, string>): Operand {
  let left = parseAnd(cursor, variables)
  while (accept(cursor, variables, '||')) {
    const right = parseAnd(cursor, variables)
    left = truthy(left) || truthy(right) ? TRUE : FALSE
  }
  return left
}

function parseAnd(cursor: Cursor, variables: Record<string, string>): Operand {
  let left = parseComparison(cursor, variables)
  while (accept(cursor, variables, '&&')) {
    const right = parseComparison(cursor, variables)
    left = truthy(left) && truthy(right) ? TRUE : FALSE
  }
  return left
}

function parseComparison(cursor: Cursor, variables: Record<string, string>): Operand {
  const left = parseUnary(cursor, variables)
  const mark = cursor.at
  const token = readOperand(cursor, variables)
  if (token && token.type === 'string' && COMPARISONS.has(token.value)) {
    return compare(token.value, left, parseUnary(cursor, variables))
  }
  cursor.at = mark
  return left
}

function parseUnary(cursor: Cursor, variables: Record<string, string>): Operand {
  if (accept(cursor, variables, '!')) return truthy(parseUnary(cursor, variables)) ? FALSE : TRUE
  const mark = cursor.at
  const token = readOperand(cursor, variables)
  if (token && token.type === 'string' && token.value === '(') {
    const inner = parseOr(cursor, variables)
    if (!accept(cursor, variables, ')')) throw new FileTemplateParseError('条件里括号没有闭合。', 0)
    return inner
  }
  cursor.at = mark
  return requireOperand(cursor, variables)
}

/** 求值一条表达式文本（`#if` 的条件与 `#set` 的值共用）。 */
export function evaluateExpression(expression: string, variables: Record<string, string>): Operand {
  return parseOr({ source: expression, at: 0 }, variables)
}

// ---- 渲染 ----

export interface RenderContext {
  /** 变量值。`DS` 由引擎自己处理成字面量 `$`，不在这里求。 */
  variables: Record<string, string>
  /** `#parse` 的目标解析（上游 `VelocityWrapper.java:82` 走 Includes 方案）。返回 undefined = 找不到。 */
  resolveInclude?: (name: string) => string | undefined
}

export interface RenderResult {
  text: string
  /** 模板引用了、但本次没给值的变量（上游 `FileTemplateBase.getUnsetAttributes`，`:89-99`）。 */
  unset: string[]
  /** 递归包含时被跳过的目标（成环；上游 `FileTemplateUtil.java:120` 的 `visitedIncludes` 同样不重入）。 */
  skipped: string[]
}

const LITERAL_DOLLAR = '$'

function renderNodes(
  nodes: readonly TemplateNode[],
  scope: Map<string, string>,
  unset: Set<string>,
  context: RenderContext,
  visiting: Set<string>,
  skipped: string[],
): string {
  let out = ''
  const variables = () => Object.fromEntries(scope)
  for (const node of nodes) {
    if (node.kind === 'text') { out += node.text; continue }
    if (node.kind === 'var') {
      if (node.name === 'DS') { out += LITERAL_DOLLAR; continue }
      const value = scope.get(node.name)
      if (value === undefined) unset.add(node.name)
      else out += value
      continue
    }
    if (node.kind === 'set') {
      scope.set(node.name, asText(evaluateExpression(node.value, variables())))
      continue
    }
    if (node.kind === 'if') {
      for (const branch of node.branches) {
        if (branch.condition !== null && !truthy(evaluateExpression(branch.condition, variables()))) continue
        out += renderNodes(branch.body, scope, unset, context, visiting, skipped)
        break
      }
      continue
    }
    if (visiting.has(node.target)) { skipped.push(node.target); continue }
    const included = context.resolveInclude?.(node.target)
    if (included === undefined) throw new TemplateNotFoundError(node.target)
    const nextVisiting = new Set(visiting)
    nextVisiting.add(node.target)
    out += renderNodes(parseFileTemplate(included), scope, unset, context, nextVisiting, skipped)
  }
  return out
}

/** 渲染模板正文。语法错抛 `FileTemplateParseError`，子模板缺失抛 `TemplateNotFoundError`。 */
export function renderFileTemplate(source: string, context: RenderContext): RenderResult {
  const unset = new Set<string>()
  const skipped: string[] = []
  const text = renderNodes(
    parseFileTemplate(source),
    new Map(Object.entries(context.variables)),
    unset,
    context,
    new Set(),
    skipped,
  )
  return { text, unset: [...unset], skipped }
}

export interface AttributeScan {
  /** 模板引用了但没有 `#set` 定义的变量（上游 `FileTemplateUtil.collectAttributes` 的 `referenced`）。 */
  referenced: string[]
  /** 模板用 `#set` 定义的变量（同上的 `defined`）。 */
  defined: string[]
  /** `#parse` 引用的目标，按出现顺序去重。 */
  includes: string[]
}

function scanNodes(
  nodes: readonly TemplateNode[],
  scan: AttributeScan,
  visited: Set<string>,
  resolveInclude?: (name: string) => string | undefined,
): void {
  for (const node of nodes) {
    if (node.kind === 'text') continue
    if (node.kind === 'var') { scan.referenced.push(node.name); continue }
    if (node.kind === 'set') { scan.defined.push(node.name); continue }
    if (node.kind === 'if') {
      for (const branch of node.branches) scanNodes(branch.body, scan, visited, resolveInclude)
      continue
    }
    if (visited.has(node.target)) continue
    scan.includes.push(node.target)
    const included = resolveInclude?.(node.target)
    if (included === undefined) continue
    visited.add(node.target)
    scanNodes(parseFileTemplate(included), scan, visited, resolveInclude)
  }
}

/** 模板正文引用了哪些变量 / 子模板（设置面的「这个模板要哪些值」与 `getUnsetAttributes` 同源）。 */
export function scanTemplateAttributes(source: string, resolveInclude?: (name: string) => string | undefined): AttributeScan {
  const scan: AttributeScan = { referenced: [], defined: [], includes: [] }
  scanNodes(parseFileTemplate(source), scan, new Set(), resolveInclude)
  return {
    referenced: [...new Set(scan.referenced)].filter(name => name !== 'DS' && !scan.defined.includes(name)),
    defined: [...new Set(scan.defined)],
    includes: [...new Set(scan.includes)],
  }
}
