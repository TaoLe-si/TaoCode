// 命名作用域（IDEA `project.scopes`）的模式语言与求值。
//
// 逐条对照的源码：
//   platform/lang-impl/.../scopeChooser/ScopeChooserConfigurable.java   主从编辑器 + 顺序持久化
//   platform/lang-impl/.../scopeChooser/ScopeConfigurable.java          明细页（名称 + 共享 + 模式）
//   platform/lang-impl/.../scopeChooser/ScopeEditorPanel.java           模式框 / Include·Exclude / 计数
//   platform/lang-impl/.../packageSet/lexer/_ScopesLexer.flex           词法（空白是**有效字符**，不跳过）
//   platform/lang-impl/.../packageSet/PackageSetFactoryImpl.java:74-211  语法（Parser）
//   platform/lang-impl/.../packageSet/FilePackageSetParserExtension.java file/ext 两种 scope
//   platform/lang-impl/.../packageSet/ProjectPathPackageSetParserExtension.kt + ProjectPathPatternPackageSet.kt
//   analysis-api/.../packageSet/FilePatternPackageSet.java:39-120        匹配语义 + convertToRegexp
//   analysis-api/.../packageSet/{Union,Intersection,Complement,Invalid}PackageSet.java   getText/优先级
//   analysis-api/.../packageSet/NamedPackageSetReference.java            $name 引用另一个命名作用域
//   analysis-api/.../packageSet/AbstractPackageSet.java                  Invalid 的优先级 = 1
//
// 与 IDEA 的差异（都是本架构没有对应物，不是省事）：
//   * 没有模块实体（IDEA 的 Module）：本仓是单隐式模块，名字取工作区目录名，见 `ScopeContext.moduleName`。
//     证据 `ProjectPatternProvider.createPackageSet`（:82-121）用 `module.getName()` 生成模块模式，
//     而 `PatternBasedPackageSet.matchesModule`（:44-58）在模块模式为空时恒真、不匹配时恒假。
//   * 库判定由 `src/moduleScopes.ts` 的 `ScopeFileSystem` 提供：`ext:` 作用域要求文件**不在** content 内
//     （`FilePatternPackageSet:55-71`），模块模式此时匹配**库名**（`PatternBasedPackageSet.matchesLibrary:87-115`），
//     文件模式匹配「相对库根路径」（`getLibRelativePath`）。没传 `ScopeFileSystem` 的调用方
//     （老宿主/测试）沿用兜底：`ext:` 恒假。
//   * Java 插件注册的 `PatternPackageSetParserExtension`（`java/java-impl/.../PatternPackageSetParserExtension.java:14-50`，
//     作用域 id `src`/`test`/`lib`/`problem` + AspectJ 包模式）走 PSI，本仓用 LSP，故不注册该扩展。

import type { ScopeFileSystem } from './moduleScopes.ts'

/** 词法单元。`_ScopesLexer.flex:20-46` 的返回类型逐一对应。 */
export type ScopeTokenKind =
  | 'identifier' | 'integer' | 'whitespace' | 'oror' | 'andand' | 'excl' | 'minus' | 'tilde'
  | 'lbracket' | 'rbracket' | 'lparenth' | 'rparenth' | 'dot' | 'colon' | 'asterisk' | 'div'
  | 'sharp' | 'bad'

export interface ScopeToken { kind: ScopeTokenKind; text: string; start: number; end: number }

/** `file:` / `ext:` 由 `projectFiles` 区分（`FilePatternPackageSet:28-46`）。 */
export interface ScopeFileSet { kind: 'file'; modulePattern: string | null; pattern: string; projectFiles: boolean }
/** `projectPath:` —— 相对「项目基准目录」而非内容根（`ProjectPathPatternPackageSet.kt:13-33`）。 */
export interface ScopeProjectPathSet { kind: 'projectPath'; pattern: string }
/** `$name` —— 引用另一个命名作用域（`NamedPackageSetReference.java:11-54`）。 */
export interface ScopeNamedRef { kind: 'named'; name: string }
export interface ScopeUnionSet { kind: 'union'; sets: ScopeSet[] }
export interface ScopeIntersectionSet { kind: 'intersection'; sets: ScopeSet[] }
export interface ScopeComplementSet { kind: 'complement'; set: ScopeSet }
/** 解析失败的占位集合：`contains` 恒假、`getText()` 回原文（`InvalidPackageSet.java`）。 */
export interface ScopeInvalidSet { kind: 'invalid'; text: string }

export type ScopeSet =
  | ScopeFileSet | ScopeProjectPathSet | ScopeNamedRef
  | ScopeUnionSet | ScopeIntersectionSet | ScopeComplementSet | ScopeInvalidSet

/** `ParsingException` 的等价物：消息里带上 1 基位置（`PackageSetFactoryImpl.java:207-210`）。 */
export class ScopeParseError extends Error {
  readonly position: number
  constructor(message: string, position: number) {
    super(message)
    this.name = 'ScopeParseError'
    this.position = position
  }
}

// CodeInsightBundle.properties:461-464 的文案。
const positionError = (detail: string, position: number): never => {
  throw new ScopeParseError(`${detail} at position ${position}`, position)
}
const TOKEN_EXPECTED = (text: string) => `Unexpected '${text}'`
const PATTERN_EXPECTED = 'Package pattern expected'
const RPARENTH_EXPECTED = "')' expected"

// ---------------------------------------------------------------- 词法

// `IDENTIFIER=[:jletter:] [:jletterdigit:]*`：JFlex 的 jletter = 字母/Nl/`$`/`_`。
const IDENTIFIER = /^[\p{L}\p{Nl}$_][\p{L}\p{Nl}\p{Nd}$_]*/u
const WHITE_SPACE = /^[ \n\r\t\f]+/
const DIGITS = /^[0-9]+/
const SINGLE: Record<string, ScopeTokenKind> = {
  '!': 'excl', '-': 'minus', '~': 'tilde', '[': 'lbracket', ']': 'rbracket',
  '(': 'lparenth', ')': 'rparenth', '.': 'dot', ':': 'colon', '*': 'asterisk',
  '/': 'div', '#': 'sharp',
}

/**
 * 词法分析。**空白是有意义的字符**：flex 文件里它有独立返回类型，解析器把它当作模式文本的
 * 一部分（`FilePackageSetParserExtension.java:62-65` 把 WHITE_SPACE 追加进模式），
 * 所以 `file:*.cpp && file:*.h` 里前一个空格进了模式，后一个空格直接让解析失败。
 * 单个 `&` / `|` 没有规则，落到 `[^]` → BAD_CHARACTER。
 */
export function lexScope(text: string): ScopeToken[] {
  const tokens: ScopeToken[] = []
  const push = (kind: ScopeTokenKind, value: string, start: number) => {
    tokens.push({ kind, text: value, start, end: start + value.length })
  }
  let index = 0
  while (index < text.length) {
    const rest = text.slice(index)
    // JFlex 取最长匹配，因此 `||`/`&&` 先于单字符规则。
    const whitespace = WHITE_SPACE.exec(rest)
    if (whitespace) { push('whitespace', whitespace[0], index); index += whitespace[0].length; continue }
    const identifier = IDENTIFIER.exec(rest)
    if (identifier) { push('identifier', identifier[0], index); index += identifier[0].length; continue }
    const digits = DIGITS.exec(rest)
    if (digits) { push('integer', digits[0], index); index += digits[0].length; continue }
    if (rest.startsWith('||')) { push('oror', '||', index); index += 2; continue }
    if (rest.startsWith('&&')) { push('andand', '&&', index); index += 2; continue }
    const kind = SINGLE[rest[0]]
    if (kind) { push(kind, rest[0], index); index += 1; continue }
    push('bad', rest[0], index)
    index += 1
  }
  return tokens
}

// ---------------------------------------------------------------- 语法

/** 游标：`tokenType()` 在末尾返回 null；`getTokenStart()` 在末尾返回文本长度。 */
class Cursor {
  private index = 0
  private readonly tokens: ScopeToken[]
  private readonly source: string
  // 不用 TS 的「构造函数参数属性」：node 的 strip-only 模式不接受那种写法。
  constructor(tokens: ScopeToken[], source: string) {
    this.tokens = tokens
    this.source = source
  }
  current(): ScopeToken | null { return this.tokens[this.index] ?? null }
  kind(): ScopeTokenKind | null { return this.current()?.kind ?? null }
  /** `myLexer.getTokenStart()` */
  start(): number { return this.current()?.start ?? this.source.length }
  /** `buf.charAt(myLexer.getTokenStart())` */
  firstChar(): string { return this.current()?.text[0] ?? '' }
  /** `buf.charAt(myLexer.getTokenEnd())`，越界返回 null。 */
  charAfter(): string | null {
    const token = this.current()
    if (!token || token.end >= this.source.length) return null
    return this.source[token.end]
  }
  advance(): void { if (this.index < this.tokens.length) this.index += 1 }
}

/** `PackageSetFactoryImpl.Parser.parse()`（:81-85）：整串消费完才算成功。 */
function parseProgram(cursor: Cursor): ScopeSet {
  const set = parseUnion()
  const trailing = cursor.current()
  if (trailing) positionError(TOKEN_EXPECTED(trailing.text), trailing.start + 1)
  return set

  // :87-96 —— 并集 `||`
  function parseUnion(): ScopeSet {
    const sets = [parseIntersection()]
    while (cursor.kind() === 'oror') { cursor.advance(); sets.push(parseIntersection()) }
    return unionOf(sets)
  }
  // :98-107 —— 交集 `&&`
  function parseIntersection(): ScopeSet {
    const sets = [parseTerm()]
    while (cursor.kind() === 'andand') { cursor.advance(); sets.push(parseTerm()) }
    return intersectionOf(sets)
  }
  // :109-122 —— `!` / 括号 / `$name` / 模式
  function parseTerm(): ScopeSet {
    if (cursor.kind() === 'excl') { cursor.advance(); return { kind: 'complement', set: parseTerm() } }
    if (cursor.kind() === 'lparenth') return parseParenthesized()
    if (cursor.kind() === 'identifier' && cursor.firstChar() === '$') {
      const name = cursor.current()!.text
      cursor.advance()
      // NamedPackageSetReference.java:14-16 —— 去掉前导 `$`。
      return { kind: 'named', name: name.startsWith('$') ? name.slice(1) : name }
    }
    return parsePattern()
  }
  // :124-144
  function parsePattern(): ScopeSet {
    const scope = parseScope()
    if (scope === null) positionError('Unknown scope type', cursor.start() + 1)
    const modulePattern = parseModulePattern()
    if (cursor.kind() === 'colon') cursor.advance()
    const pattern = parseFilePattern()
    if (scope === 'file' || scope === 'ext') return { kind: 'file', modulePattern, pattern, projectFiles: scope === 'file' }
    return { kind: 'projectPath', pattern }
  }
  // FilePackageSetParserExtension.java:15-33 / ProjectPathPackageSetParserExtension.kt:10-18
  function parseScope(): 'file' | 'ext' | 'projectPath' | null {
    if (cursor.kind() !== 'identifier') return null
    const id = cursor.current()!.text
    const next = cursor.charAfter()
    if (id === 'file' || id === 'ext') {
      // 标识符后面必须紧跟 `:` 或 `[`，否则不是这个扩展的 scope。
      if (next !== ':' && next !== '[') return null
      cursor.advance()
      return id
    }
    if (id === 'projectPath') {
      if (next !== ':') return null
      cursor.advance()
      return id
    }
    return null
  }
  // :152-194 —— `[` ... `]`，内部 token 的文本原样拼回
  function parseModulePattern(): string | null {
    if (cursor.kind() !== 'lbracket') return null
    cursor.advance()
    let pattern = ''
    for (;;) {
      const current = cursor.current()
      if (current === null || current.kind === 'rbracket') { cursor.advance(); break }
      pattern += current.text
      cursor.advance()
    }
    if (pattern === '') positionError(PATTERN_EXPECTED, cursor.start() + 1)
    return pattern
  }
  // FilePackageSetParserExtension.java:41-89 —— 文件模式：连续两个标识符之间必须有分隔
  function parseFilePattern(): string {
    let pattern = ''
    let wasIdentifier = false
    for (;;) {
      const current = cursor.current()
      if (current === null) break
      if (current.kind === 'identifier' || current.kind === 'integer') {
        if (wasIdentifier) positionError(TOKEN_EXPECTED(current.text), current.start + 1)
        wasIdentifier = current.kind === 'identifier'
        pattern += current.text
      } else if (current.kind === 'asterisk') { wasIdentifier = false; pattern += '*' }
      else if (current.kind === 'dot') { wasIdentifier = false; pattern += '.' }
      else if (current.kind === 'whitespace') { wasIdentifier = false; pattern += ' ' }
      else if (current.kind === 'minus') { wasIdentifier = false; pattern += '-' }
      else if (current.kind === 'tilde') { wasIdentifier = false; pattern += '~' }
      else if (current.kind === 'sharp') { wasIdentifier = false; pattern += '#' }
      else if (current.kind === 'div') { wasIdentifier = false; pattern += '/' }
      else break
      cursor.advance()
    }
    if (pattern === '') positionError(PATTERN_EXPECTED, cursor.start() + 1)
    return pattern
  }
  // :196-205
  function parseParenthesized(): ScopeSet {
    cursor.advance()
    const result = parseUnion()
    if (cursor.kind() !== 'rparenth') positionError(RPARENTH_EXPECTED, cursor.start() + 1)
    cursor.advance()
    return result
  }
}

/** `PackageSetFactory.compile(text)`：失败时抛 `ScopeParseError`（带 1 基位置）。 */
export function compileScope(source: string): ScopeSet {
  return parseProgram(new Cursor(lexScope(source), source))
}

// ---------------------------------------------------------------- 构造（含源码的单元素折叠）

/** `UnionPackageSet.create`（:14-17）：0 个非法、1 个直接返回元素。 */
export function unionOf(sets: ScopeSet[]): ScopeSet {
  if (sets.length === 0) throw new Error('empty arguments')
  return sets.length === 1 ? sets[0] : { kind: 'union', sets }
}
/** `IntersectionPackageSet.create`（:15-18）。 */
export function intersectionOf(sets: ScopeSet[]): ScopeSet {
  if (sets.length === 0) throw new Error('empty arguments')
  return sets.length === 1 ? sets[0] : { kind: 'intersection', sets }
}

// ---------------------------------------------------------------- 文本（getText）

/** `getNodePriority()`：FilePattern/ProjectPath/NamedRef = 0，`!`/Invalid = 1，`&&` = 2，`||` = 3。 */
export function scopePriority(set: ScopeSet): number {
  switch (set.kind) {
    case 'file': case 'projectPath': case 'named': return 0
    case 'complement': return 1
    case 'invalid': return 1                                   // AbstractPackageSet 默认 1
    case 'intersection': return 2
    case 'union': return 3
  }
}

/**
 * `getText()` 的等价物 —— 这是**回写**到模式框/持久化的字符串，逐分支对照：
 *   * FilePatternPackageSet:132-144 —— `file`/`ext` + 有模块模式时才有 `[...]` + `:` + 模式
 *   * ProjectPathPatternPackageSet.kt:28 —— `projectPath:` + 模式
 *   * NamedPackageSetReference:51-54 —— `$` + 名字
 *   * CompoundPackageSet:33-39 —— 并集**不加括号**（`StringUtil.join(..., "||")`）
 *   * IntersectionPackageSet:54-63 / ComplementPackageSet:30-39 —— 按优先级补括号
 */
export function scopeText(set: ScopeSet): string {
  switch (set.kind) {
    case 'file': {
      const head = set.projectFiles ? 'file' : 'ext'
      const module = set.modulePattern ? `[${set.modulePattern}]` : ''
      return `${head}${module}:${set.pattern}`
    }
    case 'projectPath': return `projectPath:${set.pattern}`
    case 'named': return `$${set.name}`
    case 'invalid': return set.text
    case 'union': return set.sets.map(scopeText).join('||')
    case 'complement': {
      const inner = scopeText(set.set)
      return scopePriority(set.set) > scopePriority(set) ? `!(${inner})` : `!${inner}`
    }
    case 'intersection': {
      const own = scopePriority(set)
      return set.sets.map(inner => {
        const body = scopeText(inner)
        return scopePriority(inner) > own ? `(${body})` : body
      }).join('&&')
    }
  }
}

// ---------------------------------------------------------------- 匹配

/**
 * `FilePatternPackageSet.convertToRegexp`（:73-120）逐字符复刻：
 *   单个未闭合 `*` → `.*`；连续两个 `*` → 不跨分隔符的 `[^/]*`；
 *   `//` → 递归 `/(.*\/)?`；单个 `/` 转义；`.` 转义。
 */
export function convertToRegexp(pattern: string, separator = '/'): string {
  let out = ''
  let index = 0
  let isAfterSeparator = false
  let isAfterAsterisk = false
  while (index < pattern.length) {
    const current = pattern[index]
    if (current !== separator && isAfterSeparator) {
      out += `\\${separator}`
      isAfterSeparator = false
    }
    if (current !== '*' && isAfterAsterisk) {
      out += '.*'
      isAfterAsterisk = false
    }
    if (current === '*') {
      if (!isAfterAsterisk) isAfterAsterisk = true
      else { out += `[^\\${separator}]*`; isAfterAsterisk = false }
    } else if (current === separator) {
      if (isAfterSeparator) {
        out += `\\${separator}(.*\\${separator})?`
        isAfterSeparator = false
      } else {
        isAfterSeparator = true
      }
    } else {
      if (current === '.') out += '\\'
      out += current
    }
    index += 1
  }
  if (isAfterAsterisk) out += `[^\\${separator}]*`
  return out
}

/** `PatternBasedPackageSet.convertToPattern`（:72-88）：模块名模式，`*` → `.*`，其余元字符转义。 */
export function convertModulePattern(pattern: string): string {
  let out = ''
  for (const current of pattern) {
    if (current === ' ' || /[\p{L}\p{Nd}_]/u.test(current)) out += current
    else if (current === '*') out += '.*'
    else out += `\\${current}`
  }
  return out
}

const full = (body: string) => new RegExp(`^(?:${body})$`)

export interface ScopeContext {
  /** 单隐式模块的名字（取工作区目录名）；`file[Name]:` 用它比对，见文件头说明。 */
  moduleName?: string
  /** `$name` 的解析表：作用域名 → 表达式。 */
  lookup?: (name: string) => ScopeSet | null
  /**
   * 内容根/库/SDK 的文件系统视图（`src/moduleScopes.ts` 的 `scopeFileSystem`）。
   * 传了才能求值 `file[库名, ext:...]` 与「相对内容根」的路径；不传时 `ext:` 恒假、
   * content 内路径按工作区相对路径匹配（单内容根 `''` 时的等价行为）。
   */
  fileSystem?: ScopeFileSystem
}

/**
 * 路径是否落在作用域内。`path` 是工作区相对路径、`/` 分隔。
 * `isDirectory` 对应源码里 `virtualFile.isDirectory()` 时给相对路径补 `/`（`FilePatternPackageSet:69`）。
 */
export function scopeMatches(
  set: ScopeSet, path: string, isDirectory = false,
  context: ScopeContext = {}, seen: ReadonlySet<string> = new Set(),
): boolean {
  switch (set.kind) {
    case 'invalid': return false
    case 'complement': return !scopeMatches(set.set, path, isDirectory, context, seen)
    case 'union': return set.sets.some(inner => scopeMatches(inner, path, isDirectory, context, seen))
    case 'intersection': return set.sets.every(inner => scopeMatches(inner, path, isDirectory, context, seen))
    // FilePatternPackageSet.java:49-71：先判 content（`isInContent(file) != myProjectFiles` 为假即出局），
    // 再取相对内容根（或相对库根）的路径，目录补 `/`，最后整串匹配。
    case 'file': {
      const fileSystem = context.fileSystem
      if (set.projectFiles) {
        if (path === '') return false
        if (fileSystem && !fileSystem.isInContent(path)) return false
        if (!moduleMatches(set.modulePattern, context)) return false
        // 没有 fileSystem 时路径本身就是内容根相对路径（本仓单内容根 = 工作区根）。
        const relativePath = fileSystem?.contentRelativePath(path) ?? path
        const relative = isDirectory ? `${relativePath}/` : relativePath
        return full(convertToRegexp(set.pattern)).test(relative)
      }
      // `ext:`：文件必须在 content **外**，模块模式匹配库名/SDK 名，文件模式匹配相对库根路径。
      if (!fileSystem) return false                 // 没有内容根/库视图的调用方：兜底恒假
      if (path === '' || fileSystem.isInContent(path)) return false
      if (!libraryMatches(set.modulePattern, path, fileSystem)) return false
      const libraryRelative = fileSystem.libraryRelativePath(path)
      if (libraryRelative === null) return false     // 不在任何已知库根里：上游 getRelativePath 给 ""，同样不匹配
      const relative = isDirectory ? `${libraryRelative}/` : libraryRelative
      return full(convertToRegexp(set.pattern)).test(relative)
    }
    // ProjectPathPatternPackageSet.kt:16-22：去掉前导 `/` 后按同一套通配符匹配项目基准目录相对路径。
    case 'projectPath': {
      const relative = isDirectory ? `${path}/` : path
      return full(convertToRegexp(set.pattern.replace(/^\/+/, ''))).test(relative)
    }
    // NamedPackageSetReference.java:19-44：在持有者里按名字找作用域再求值；找不到的引用恒假。
    case 'named': {
      if (seen.has(set.name)) return false            // 自引用/环：按"找不到"处理，绝不递归爆栈
      const resolved = context.lookup?.(set.name)
      if (!resolved) return false
      const next = new Set(seen)
      next.add(set.name)
      return scopeMatches(resolved, path, isDirectory, context, next)
    }
  }
}

/** `PatternBasedPackageSet.matchesModule`（:44-58）：模块模式为空 → 恒真；有则必须匹配模块名。 */
function moduleMatches(modulePattern: string | null, context: ScopeContext): boolean {
  if (!modulePattern) return true
  if (context.moduleName === undefined) return false
  return full(convertModulePattern(modulePattern)).test(context.moduleName)
}

/**
 * `PatternBasedPackageSet.matchesLibrary`（:87-115）：content 外的文件按**库名**匹配
 * （库没有名字时上游退到 presentable name 的文件名；本仓的库名就是那条 glob 模式），
 * 文件在 SDK 根里时按 JDK 名匹配。
 */
function libraryMatches(modulePattern: string | null, path: string, fileSystem: ScopeFileSystem): boolean {
  if (!modulePattern) return true
  const name = fileSystem.libraryNameOf(path) ?? fileSystem.jdkName
  if (name === null) return false
  return full(convertModulePattern(modulePattern)).test(name)
}

// ---------------------------------------------------------------- Include / Exclude 按钮的合并

const textsEqual = (a: ScopeSet, b: ScopeSet) => scopeText(a) === scopeText(b)

/**
 * `ScopeEditorPanel.processComplementaryScope`（:611-645）：把「已存在的相反集合」消掉。
 * 源码用共享的 `boolean[] append` 跨递归传标志，这里把标志顺着返回值传回去，语义一致。
 */
function processComplementaryScope(
  current: ScopeSet, added: ScopeSet, checkComplementSet: boolean, append: boolean,
): { set: ScopeSet | null; append: boolean } {
  if (current.kind === 'complement' && textsEqual(current.set, added)) {
    // `!x` 里加 `x`：包含语义下这条规则被抵消。
    return { set: null, append: checkComplementSet ? false : append }
  }
  if (textsEqual(current, added)) {
    return { set: null, append: checkComplementSet ? append : false }
  }
  if (current.kind === 'union' || current.kind === 'intersection') {
    const processed: ScopeSet[] = []
    for (const inner of current.sets) {
      const result = processComplementaryScope(inner, added, checkComplementSet, append)
      append = result.append
      if (result.set !== null) processed.push(result.set)
    }
    if (processed.length === 0) return { set: null, append }
    return { set: current.kind === 'union' ? unionOf(processed) : intersectionOf(processed), append }
  }
  return { set: current, append }
}

/**
 * `ScopeEditorPanel.doIncludeSelected`（:583-609）。
 * 返回 `null` 表示作用域被抵消成空（源码里 `myCurrentScope = null`，模式框随即清空）。
 */
export function includeInto(current: ScopeSet | null, added: ScopeSet): ScopeSet | null {
  if (current === null) return added
  if (current.kind === 'invalid') return current.text === '' ? added : unionOf([current, added])
  const simplified = processComplementaryScope(current, added, true, true)
  if (!simplified.append) return simplified.set
  if (simplified.set === null) return added
  const sets = simplified.set.kind === 'union' ? simplified.set.sets : [simplified.set]
  return unionOf([...sets, added])
}

/** `ScopeEditorPanel.doExcludeSelected`（:545-574）。 */
export function excludeFrom(current: ScopeSet | null, removed: ScopeSet): ScopeSet | null {
  const complement: ScopeSet = { kind: 'complement', set: removed }
  if (current === null) return complement
  if (current.kind === 'invalid') {
    return current.text === '' ? complement : intersectionOf([current, complement])
  }
  const simplified = processComplementaryScope(current, removed, false, true)
  if (!simplified.append) return simplified.set
  if (simplified.set === null) return complement
  const sets = simplified.set.kind === 'intersection' ? simplified.set.sets : [simplified.set]
  return intersectionOf([...sets, complement])
}

// ---------------------------------------------------------------- 求值入口（带错误捕获）

export interface CompiledScope { text: string; set: ScopeSet; error: string | null; position: number | null }

/**
 * 从「名字 → 模式文本」表构造 `$名字` 的解析表。
 * 对照 `NamedScopesHolder.getScope`（:167-173）与 `NamedPackageSetReference.contains`（:19-44）：
 * 查不到、或者那条自己的模式解析不了，引用就恒不匹配。环由 `scopeMatches` 的 seen 集合挡住。
 */
export function scopeLookup(entries: readonly { name: string; pattern: string }[]): (name: string) => ScopeSet | null {
  return (name: string) => {
    const entry = entries.find(item => item.name === name)
    if (!entry) return null
    const compiled = compileScopeText(entry.pattern)
    return compiled.error ? null : compiled.set
  }
}

/**
 * `ScopeEditorPanel.onTextChange`（:432-452）：文本 → 要么编译成功（`error === null`），
 * 要么变成 `InvalidPackageSet` 并记住错误消息与位置（位置用于 `label.scope.editor.caret.position`）。
 */
export function compileScopeText(text: string): CompiledScope {
  // `if (!StringUtil.isEmpty(text))`（:438）—— 空文本不进编译器，直接是一个空的 InvalidPackageSet，
  // 且**不算错误**（`myErrorMessage = null`），状态栏显示 "0 of N files"。
  if (text === '') return { text, set: { kind: 'invalid', text: '' }, error: null, position: null }
  try {
    return { text, set: compileScope(text), error: null, position: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const position = error instanceof ScopeParseError ? error.position : null
    return { text, set: { kind: 'invalid', text }, error: message, position }
  }
}
