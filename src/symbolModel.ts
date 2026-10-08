// **轻量符号模型** —— 上游 PSI（`PsiElement`/`PsiFile`/`PsiClass`/`PsiPackage` 一族）在本仓的
// 可移植子集。本仓没有 PSI（lp/psi 判 `[-]`），但「按符号的操作」是真实存在的用户可见功能：
//   · 包视图（`ScopeViewTreeModel.visitPackages` 的 flatten / hideEmptyMiddle / abbreviate 三档，
//     上游只在 `isPackage(icon)` 为真时走，见 `platform/lang-impl/src/com/intellij/ide/scopeView/
//     ScopeViewTreeModel.java:594-655`）——需要「这个目录是不是包」的判定；
//   · 按成员抽取/移动（`PsiClass.getMembers`）——需要「类体里有哪些成员」；
//   · 结构化搜索的语法约束（`PatternContext`）——需要「这段命中落在哪个语法节点里」。
//
// 本模块把它们收成**一个符号模型**：输入是语言服务给的 `documentSymbol` 扁平清单（宿主
// `native/lsp_support.cpp` 深度优先展平）+ 文件清单 + 声明文本，输出是：
//   · 符号树与「位置 → 最内层符号」的查询（PSI `findElementAt` 的等价物）；
//   · 类成员清单（`PsiClass.getMembers`）；
//   · 声明的包名（`PsiJavaFile.getPackageName` / 目录约定）；
//   · 包树（上游那三档 PSI 选项的文本层还原）。
//
// **能力降级（如实）**：语言服务没给 `documentSymbol` 时符号树是空的 —— 此时成员/包含链退到
// **词法层**（花括号配对 + 声明头正则，与 `src/refactorMemberMove.ts` 同一档），并在结果里带上
// `source: 'lexical'` 让调用方知道这一份是降级来的，不是不给出结果、也不是假装有 PSI。
//
// 纯数据层：不 import vue/DOM/bridge（结构类型入参），便于单测。
//
// 判据：`tests/symbol-model.test.mjs`。

/** 符号模型的来源（调用方据此知道这一份是语言服务的还是词法降级来的）。 */
export type SymbolSource = 'lsp' | 'lexical'

/** 一个符号节点（`LspDocumentSymbol` 的结构子集 + 子节点）。 */
export interface SymbolNode {
  name: string
  /** LSP `SymbolKind`（spec 编号）。 */
  kind: number
  startLine: number
  startChar: number
  endLine: number
  endChar: number
  detail?: string
  children: SymbolNode[]
}

export interface SymbolTree {
  roots: SymbolNode[]
  source: SymbolSource
}

/** 位置（0 基行、0 基列）。 */
export interface Position { line: number; character: number }

/** 起止比较：起点小者在前；同起点时终点大者（更外层）在前。 */
function before(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line === b.line && a.character <= b.character)
}

/** `child` 是否被 `parent` 的范围**严格包含**（PSI `PsiElement.getTextRange().contains`）。 */
export function rangeContains(parent: SymbolNode, child: SymbolNode): boolean {
  return before({ line: parent.startLine, character: parent.startChar }, { line: child.startLine, character: child.startChar })
    && before({ line: child.endLine, character: child.endChar }, { line: parent.endLine, character: parent.endChar })
}

/**
 * 扁平符号清单 → 符号树（上游 PSI 的父子关系在这里由**范围包含**重建）。
 * 宿主是深度优先展平的（`native/lsp_support.cpp` 的 `collect_symbols`），所以用一摞"还没闭合的
 * 祖先"重建即可 —— 与 `src/outlineView.ts` 的 `treeOf` 同一算法，但这里**不做任何排序**：
 * 符号模型只回答"谁包含谁"，排序是视图的事（`outlineView` 的 `arrange`）。
 */
export function buildSymbolTree(symbols: readonly SymbolNode[] | null | undefined): SymbolTree {
  const roots: SymbolNode[] = []
  const stack: SymbolNode[] = []
  for (const raw of symbols ?? []) {
    const node: SymbolNode = { ...raw, children: [] }
    while (stack.length && !rangeContains(stack[stack.length - 1], node)) stack.pop()
    ;(stack.length ? stack[stack.length - 1].children : roots).push(node)
    stack.push(node)
  }
  return { roots, source: (symbols?.length ?? 0) > 0 ? 'lsp' : 'lexical' }
}

/** 深度优先展平（`PsiTreeUtil.processElements` 的等价物；父在子前）。 */
export function flattenSymbols(tree: SymbolTree): SymbolNode[] {
  const out: SymbolNode[] = []
  const visit = (nodes: readonly SymbolNode[]) => {
    for (const node of nodes) { out.push(node); visit(node.children) }
  }
  visit(tree.roots)
  return out
}

/** 位置是否落在符号范围内（终点含：PSI 的 range 是闭区间口径，声明末字符也算在内）。 */
export function positionInSymbol(symbol: SymbolNode, position: Position): boolean {
  return before({ line: symbol.startLine, character: symbol.startChar }, position)
    && before(position, { line: symbol.endLine, character: symbol.endChar })
}

/**
 * 位置处**最内层**的符号链（根在前、最内层在后）—— PSI `findElementAt(offset)` + 逐级
 * `getParent()` 的等价物。起点按行放宽：语言服务把起点取在声明名那一列
 * （`selectionRange`），光标停在缩进/关键字上时列判定会落空（同 `src/structureFollow.ts` 的口径）。
 * 找不到返回空数组（不编一个"文件根"节点出来）。
 */
export function containmentChain(tree: SymbolTree, position: Position): SymbolNode[] {
  const chain: SymbolNode[] = []
  const visit = (nodes: readonly SymbolNode[]): boolean => {
    for (const node of nodes) {
      const own = positionInSymbol(node, position)
        || (node.startLine === position.line && node.endLine >= position.line)
      if (!own) continue
      chain.push(node)
      if (visit(node.children)) return true
      return true
    }
    return false
  }
  visit(tree.roots)
  return chain
}

/**
 * 一个类/接口符号的直接成员（`PsiClass.getMembers` 的等价物）：它的**直接**子符号。
 * 上游 `getMembers` 把方法/字段/内部类都算成员；本仓照 LSP 的 `documentSymbol` 层级，
 * 直接子节点就是成员（语言服务已经把方法与字段放进类型的 children 里）。
 */
export function membersOf(tree: SymbolTree, symbol: SymbolNode): SymbolNode[] {
  const found = flattenSymbols(tree).find(node => node.name === symbol.name && node.startLine === symbol.startLine
    && node.startChar === symbol.startChar && node.endLine === symbol.endLine && node.endChar === symbol.endChar)
  return found ? [...found.children] : []
}

/** 按名找符号（`PsiFile.findClass` / `findElementAt` 之外最常用的一档）。取**第一个**匹配。 */
export function findSymbol(tree: SymbolTree, name: string): SymbolNode | null {
  return flattenSymbols(tree).find(node => node.name === name) ?? null
}

/** 类/接口/枚举/结构体那几档 LSP kind（与 `lspSymbolBridge.CLASS_LIKE_SYMBOL_KINDS` 同源口径）。 */
const CLASS_LIKE_KINDS: ReadonlySet<number> = new Set([5, 10, 11, 23])

export function isTypeSymbol(symbol: SymbolNode): boolean {
  return CLASS_LIKE_KINDS.has(symbol.kind)
}

// ── 声明层：包名与成员段（PSI `PsiJavaFile.getPackageName` / `PsiClass.getMembers` 的文本等价物） ──

/** 支持的声明语法档（与 `src/refactorMemberMove.ts` 的 `BRACE_LANGUAGES` 同一批）。 */
const PACKAGE_LANGUAGES: ReadonlySet<string> = new Set(['java', 'kotlin', 'scala', 'groovy', 'csharp', 'cs', 'go'])

/**
 * 从声明文本里取**声明的包/命名空间名**（上游 `PsiJavaFile.getPackageName` 的文本等价物）。
 *   · Java/Kotlin/Scala：`package a.b.c`（取到分号或行尾，去掉注解前缀）；
 *   · C#：`namespace A.B {` 或 `namespace A.B;`（文件级命名空间）；
 *   · Go：`package main`。
 * 认不出返回 `null`（**不猜**：按目录名编一个包名就是假功能，上游那条判据是 `isPackage(icon)`，
 * 没有包声明的目录不是包）。
 */
export function declaredPackageName(text: string, language: string): string | null {
  const lang = (language || '').toLowerCase()
  if (!PACKAGE_LANGUAGES.has(lang)) return null
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue
    const java = /^package\s+([A-Za-z_$][\w$.]*)\s*;?\s*$/.exec(line)
    if (java) return java[1]
    const csharp = /^namespace\s+([A-Za-z_$][\w$.]*)\s*[{;]?\s*$/.exec(line)
    if (csharp) return csharp[1]
    const go = /^package\s+([A-Za-z_$][\w$]*)\s*$/.exec(line)
    if (go) return go[1]
  }
  return null
}

/** 一个文件的包归属：声明的包名优先，没有声明时按**目录**（本仓的保守口径）。 */
export function packageOfFile(path: string, declared?: string | null): string {
  if (declared) return declared
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index < 0 ? '' : normalized.slice(0, index)
}

// ── 包视图（上游 `ScopeViewTreeModel.visitPackages` 的三档 PSI 选项） ────────────────────────

export interface PackageViewSettings {
  /** `ProjectView.CompactDirectories` 之外的**包**档：`flattenPackages`（`ScopeViewTreeModel.java:586`）。 */
  flattenPackages?: boolean
  /** `hideEmptyMiddlePackages`（`:587`）：中间层没有文件/非包目录时并进上一层。 */
  hideEmptyMiddlePackages?: boolean
  /** `abbreviatePackageNames`（`GroupByTypeComparator.java:134`）：包名首字母缩写。 */
  abbreviatePackageNames?: boolean
}

export interface PackageNode {
  /** 包名（声明的包名或目录路径）。 */
  name: string
  /** 属于这个包的文件（工作区相对路径，已排序）。 */
  files: string[]
  /** 子包。 */
  children: PackageNode[]
  /** 是不是"中间包"（自身没有文件，只有一个子包 —— `visitPackages` 的 `middle` 那一格）。 */
  middle: boolean
}

/** 缩写一个包名：按 `.`/`/` 分段取首字母（`abbreviatePackageNames` 的文本等价物）。 */
export function abbreviatePackage(name: string): string {
  const separator = name.includes('/') ? '/' : '.'
  return name.split(separator).map(segment => segment.charAt(0)).join(separator)
}

/** 包名的显示名（`abbreviatePackageNames` 开着时缩写；空包名给「(根)」）。 */
export function packageLabel(name: string, settings: PackageViewSettings = {}): string {
  if (name === '') return '(根)'
  return settings.abbreviatePackageNames ? abbreviatePackage(name) : name
}

/**
 * 由「文件 → 包名」建包树（上游 `visitPackages` 那条递归的等价物）。
 *
 * 三档选项逐条对位（`ScopeViewTreeModel.java:594-655`）：
 *   · `flattenPackages`：**不**建中间层节点，包直接平铺（`:594` 的 `!isPackage(icon) || !flattenPackages`
 *     那一支走目录合并，本仓的"包"没有目录合并的对应物 ⇒ 平铺就是把每个包当顶层节点）；
 *   · `hideEmptyMiddlePackages`：`middle`（只有子包、没有文件）的节点并进它的父 ——
 *     `:646-651` 的 `empty`/`middle` 两个标志：没有文件且没有非包子目录时 `empty` 保持真，
 *     含子包时 `middle` 为真 ⇒ `!empty || !middle` 才 consume。
 *   · `abbreviatePackageNames`：只影响**显示名**（`packageLabel`），不改树形。
 *
 * 输入 `declared` 是「路径 → 声明的包名」表（`declaredPackageName` 的产物）；缺项按目录归属。
 * 目录归属的包按 `/` 分段建层，声明的包名按 `.` 分段建层 —— 两种分隔符都还原成同一棵树。
 */
export function packageTreeOf(
  files: readonly string[],
  declared: ReadonlyMap<string, string | null> = new Map(),
  settings: PackageViewSettings = {},
): PackageNode[] {
  // 每个包名 → 属于它的文件。
  const byPackage = new Map<string, string[]>()
  for (const path of files) {
    const name = packageOfFile(path, declared.get(path) ?? null)
    byPackage.set(name, [...(byPackage.get(name) ?? []), path.replace(/\\/g, '/')])
  }
  const separatorOf = (name: string) => (name.includes('.') && !name.includes('/') ? '.' : '/')
  const parentOf = (name: string): string | null => {
    const separator = separatorOf(name)
    const index = name.lastIndexOf(separator)
    return index <= 0 ? (index === 0 ? '' : null) : name.slice(0, index)
  }
  // 补出所有祖先包（`a.b.c` 要有 `a`、`a.b` 两层，即使它们自己没有文件）。
  const names = new Set<string>(byPackage.keys())
  for (const name of [...names]) {
    let parent = parentOf(name)
    while (parent !== null && parent !== '') { names.add(parent); parent = parentOf(parent) }
  }
  // 根目录那一格（包名空串）**留着**：它是"源码根直属文件"的归属（`top.ts` 这类）。
  // 删掉它会让根目录下的文件在包视图里凭空消失 —— 那不是上游的行为（`visitPackages` 里
  // 非包的目录/文件照样由父层列出来），所以这里保留并给显示名「(根)」。没有根文件时它根本
  // 不会进 `names`（`byPackage` 里没有那个键），所以平白多一行的风险不存在。
  const nodes = new Map<string, PackageNode>()
  for (const name of names) nodes.set(name, { name, files: (byPackage.get(name) ?? []).slice().sort(), children: [], middle: false })
  const roots: PackageNode[] = []
  for (const name of [...names].sort()) {
    const node = nodes.get(name)!
    const parent = settings.flattenPackages ? null : parentOf(name)
    const parentNode = parent !== null && parent !== '' ? nodes.get(parent) : undefined
    if (parentNode) parentNode.children.push(node)
    else roots.push(node)
  }
  // `middle`：没有自己的文件、只有子包。`hideEmptyMiddlePackages` 开着时并进父（`visitPackages`）。
  const markMiddle = (node: PackageNode): void => {
    for (const child of node.children) markMiddle(child)
    node.middle = node.files.length === 0 && node.children.length > 0
  }
  for (const root of roots) markMiddle(root)
  if (!settings.hideEmptyMiddlePackages) return roots
  const collapse = (node: PackageNode): PackageNode => {
    let current = node
    while (current.middle && current.children.length === 1) {
      const only = current.children[0]
      current = { ...only, files: [...current.files, ...only.files], children: only.children }
    }
    return { ...current, children: current.children.map(collapse) }
  }
  return roots.map(collapse)
}

/** 包树里"最像这个路径所属包"的节点（`ProjectFileIndex.getPackageNameByDirectory` 的文本等价物）。 */
export function packageNodeOf(roots: readonly PackageNode[], packageName: string): PackageNode | null {
  const walk = (nodes: readonly PackageNode[]): PackageNode | null => {
    for (const node of nodes) {
      if (node.name === packageName) return node
      const nested = walk(node.children)
      if (nested) return nested
    }
    return null
  }
  return walk(roots)
}

// ── 结构化搜索的语法约束（`PatternContext` 的文本等价物） ─────────────────────────────────

/**
 * 命中区间是否落在某个**语法节点**里（结构化搜索 `within`/`contains` 的语法树级作用域，
 * 上游 `PatternContext` 判的是 PSI 上下文）。本仓的等价物：把命中区间交给符号树，
 * 看有没有一个符号的范围包住它，并按 LSP kind 收窄到调用方要的档位。
 * `kinds` 为空 = 任意符号都算。
 */
export function rangeWithinSymbol(
  tree: SymbolTree, range: { startLine: number; startChar: number; endLine: number; endChar: number },
  kinds: readonly number[] = [],
): SymbolNode | null {
  const allowed = kinds.length ? new Set(kinds) : null
  let best: SymbolNode | null = null
  const visit = (nodes: readonly SymbolNode[]) => {
    for (const node of nodes) {
      const covers = before({ line: node.startLine, character: node.startChar }, { line: range.startLine, character: range.startChar })
        && before({ line: range.endLine, character: range.endChar }, { line: node.endLine, character: node.endChar })
      if (!covers) continue
      // 取**最内层**：候选换了更小的就更新（`covers` 是传递的，走到更深的节点只会更小）。
      if (!allowed || allowed.has(node.kind)) best = node
      // **无论这一层收不收，都要往下走** —— 范围落在类型节点里、类型不在 allowed 里时，
      // 它里面的方法可能才是命中方要的那一档；第一版在这里提前 return，于是「只在方法里搜」
      // 对任何落进类里的命中都判成"不在"，是反的。
      visit(node.children)
    }
  }
  visit(tree.roots)
  return best
}

// ── 词法降级：没有 documentSymbol 时的花括号成员段 ─────────────────────────────────────────

export interface LexicalSpan { name: string; startLine: number; endLine: number; header: string }

/**
 * 词法层的**类体成员段**（语言服务没给 `documentSymbol` 时的降级口径，与
 * `src/refactorMemberMove.ts` 的 `classMembers` 同一档：花括号配对 + 声明头正则）。
 * 只认花括号语言；`{` 与 `}` 配对时跳过字符串/注释（简化的词法状态机，够这一档用）。
 * 返回空数组 = 这一份文本里没有可识别的成员段（**不猜**）。
 */
export function lexicalMemberSpans(text: string, language: string): LexicalSpan[] {
  const lang = (language || '').toLowerCase()
  if (!['java', 'kotlin', 'typescript', 'javascript', 'cpp', 'c', 'csharp', 'cs'].includes(lang)) return []
  const lines = String(text ?? '').split(/\r?\n/)
  const spans: LexicalSpan[] = []
  // 先找类体范围（`class X {` … 配对 `}`），再在类体内按顶层 `;`/`}` 切成员。
  for (let line = 0; line < lines.length; line++) {
    const header = /^\s*(?:export\s+)?(?:public|private|protected|static|final|abstract|open|internal|sealed|partial|\s)*\s*(?:class|interface|enum|struct|record)\s+([A-Za-z_$][\w$]*)/.exec(lines[line])
    if (!header) continue
    const open = lines[line].indexOf('{', header.index + header[0].length)
    if (open < 0) continue
    const endLine = matchingBraceLine(lines, line, open)
    if (endLine < 0) continue
    for (const member of topLevelMembers(lines, line + 1, endLine)) {
      spans.push({ name: member.name, startLine: member.startLine, endLine: member.endLine, header: member.header })
    }
    line = endLine
  }
  return spans
}

/** 从 `(line, column)` 的 `{` 找配对 `}` 所在行；找不到 -1（跳过字符串/注释）。 */
function matchingBraceLine(lines: readonly string[], line: number, column: number): number {
  let depth = 0
  let quote = ''
  for (let current = line; current < lines.length; current++) {
    const text = lines[current]
    for (let index = current === line ? column : 0; index < text.length; index++) {
      const char = text[index]
      if (quote) {
        if (char === '\\') { index++; continue }
        if (char === quote) quote = ''
        continue
      }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue }
      if (char === '/' && text[index + 1] === '/') break
      if (char === '{') depth++
      else if (char === '}') { depth--; if (depth === 0) return current }
    }
  }
  return -1
}

/** 类体内的顶层成员段：从一条"声明头"到它的 `;` 或方法体的配对 `}`。 */
function topLevelMembers(lines: readonly string[], from: number, to: number): LexicalSpan[] {
  const out: LexicalSpan[] = []
  let index = from
  while (index < to) {
    const header = lines[index].trim()
    if (!header || header.startsWith('//') || header.startsWith('*') || header.startsWith('/*') || header === '}' || header === ';') { index++; continue }
    const start = index
    // 方法：这一行有 `(` 且以 `{` 结束（或后续行才出现 `{`）。
    const openBrace = lines[index].indexOf('{')
    if (openBrace >= 0) {
      const end = matchingBraceLine(lines, index, openBrace)
      if (end < 0) break
      out.push({ name: memberName(header), startLine: start, endLine: end, header })
      index = end + 1
      continue
    }
    // 字段：一直吃到 `;`（可能跨行）。
    let cursor = index
    while (cursor < to && !lines[cursor].includes(';')) cursor++
    out.push({ name: memberName(header), startLine: start, endLine: Math.min(cursor, to), header })
    index = cursor + 1
  }
  return out
}

/** 成员名：声明头里最后一个标识符（`public int count` → `count`，`void run()` → `run`）。 */
function memberName(header: string): string {
  const withoutModifiers = header.replace(/^(?:public|private|protected|static|final|abstract|open|internal|override|virtual|async|\s)+/, '')
  const paren = /([A-Za-z_$][\w$]*)\s*\(/.exec(withoutModifiers)
  if (paren) return paren[1]
  const words = withoutModifiers.match(/[A-Za-z_$][\w$]*/g) ?? []
  return words.length ? words[words.length - 1] : ''
}

/**
 * 一份文件的符号模型：优先用语言服务的 `documentSymbol`，没有就退到词法层。
 * 这是"按符号的操作"的统一入口 —— 包视图、成员抽取、结构化搜索的语法约束都从这里取。
 */
export interface FileSymbolModel {
  path: string
  tree: SymbolTree
  /** 词法降级时的成员段（`source === 'lsp'` 时为空数组）。 */
  lexical: LexicalSpan[]
  /** 声明的包名（认不出为 null）。 */
  packageName: string | null
}

export function buildFileSymbolModel(input: {
  path: string
  language: string
  text: string
  symbols?: readonly SymbolNode[] | null
}): FileSymbolModel {
  const tree = buildSymbolTree(input.symbols)
  return {
    path: input.path,
    tree,
    lexical: tree.source === 'lsp' ? [] : lexicalMemberSpans(input.text, input.language),
    packageName: declaredPackageName(input.text, input.language),
  }
}

/**
 * 一个文件里"可被按符号操作"的成员清单：LSP 有就用符号树的类型成员，否则用词法成员段。
 * 返回的每一项都带 `source`，调用方（重构/包视图）能如实说这一份是降级的。
 */
export function fileMembers(model: FileSymbolModel): Array<{ name: string; kind: number | null; startLine: number; source: SymbolSource }> {
  if (model.tree.source === 'lsp') {
    return flattenSymbols(model.tree)
      .filter(isTypeSymbol)
      .flatMap(type => type.children.map(child => ({ name: child.name, kind: child.kind as number | null, startLine: child.startLine, source: 'lsp' as SymbolSource })))
  }
  return model.lexical.map(span => ({ name: span.name, kind: null, startLine: span.startLine, source: 'lexical' as SymbolSource }))
}