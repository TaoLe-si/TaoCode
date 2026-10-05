// 成员上移 / 下移（Pull Up / Push Down）的**文本层**模型。
//
// 上游依据（逐条核过本机的上游树）：
//   · 菜单条目：`platform/platform-impl/resources/idea/LangActions.xml:391-392`
//     （`MembersPullUp` / `MemberPushDown`；同一组里 `:393` 的 `InvertBoolean` 本仓不做，
//     见 `src/menus/refactorMenu.ts` 文件头）。这两条在 `platform/platform-resources/src/
//     keymaps/$default.xml` 里**没有**默认键位（按 id 搜过 10 个键位文件），所以本仓也不给它们编键位。
//   · 标题：`platform/refactoring/resources/messages/RefactoringBundle.properties:129`
//     `pull.members.up.title=Pull Members Up`、`:133` `push.members.down.title=Push Members Down`；
//     zh 值取安装目录 `plugins/localization-zh/lib/localization-zh.jar` 的
//     `messages/RefactoringBundle.properties` 同名键 = 向上拉取成员 / 向下推送成员。
//   · 上移对话框抬头：`:56` `pull.up.members.to=P&ull up members of {0} to:`（zh：将{0}的成员向上拉取至）。
//   · 下推对话框：`java/java-impl-refactorings/src/com/intellij/refactoring/memberPushDown/PushDownDialog.java`
//     `:31-36` 的 `MemberSelectionPanel(members.to.be.pushed.down.panel.title, memberInfos, keep.abstract.column.header)`
//     —— 成员勾选表 + 一列「Keep abstract」（zh = 保持抽象，`:262`；面板标题 `:261`）。
//     下推的目标表在 `:202` `classes.to.push.down.members.to=Classes to push down members to {0}`；
//     下推会把源类里的成员删掉这件事上游要单独确认（`:266` `push.down.will.delete.members`）。
//   · 成员勾选表本身：`platform/lang-impl/src/com/intellij/refactoring/ui/MemberSelectionPanel.java`
//     （一棵 JBTtree + 一张带复选框的成员表）—— 本仓等价物是 `classMembers()` 的清单 +
//     `MemberInfo` 上的 `selected` / `keepAbstract` 两个布尔位。
//
// **本仓用什么承接了上游的什么**（架构不等价 ⇒ 用本仓架构还原用户可见功能）：
//   · 上游用 PSI 的 `PsiClass`/`PsiMember` 与 `MoveMembersJavaMixin` 找类、列成员、搬声明
//     → 本仓用**文本层**：`findMemberMoveClasses()` 认花括号语言的 `class`/`interface` 声明头，
//       `classMembers()` 在类体的**顶层**切出成员段（跳过字符串/注释、用 `matchBrace`/`matchParen`
//       跨过方法体与参数表），搬动时只做「源类删这一段 + 目标类插这一段」的文本编辑。
//   · 上游 `MemberPushDownTest` 要求成员在每个子类都存在 —— 本仓同样在目标类已有同名成员时
//     **报错并跳过**，不出两条同名声明。
//   · 上游「查找祖先类」用 `ClassChoosers.buildClassChooser`；本仓的目标由调用方给出
//     （宿主按 `extends` 的名字在工作区里找同名类，找不到就是找不到 —— 不猜）。
//
// **没有 PSI 就拿不到的那部分**（不做，也不放假控件）：跨文件引用改写（上移后子类的调用者
// 改成 `super.`）、可见性下调、`@Override` 注解增删、按类型而非按名字的继承链。
// 这些都要 `PsiClass`/`PsiSearchHelper`，LSP 侧没有对应的入参面。
import type { LspFileEdits, LspTextEdit } from './bridge.ts'
import { matchBrace } from './unwrap.ts'
import { matchParen } from './refactorSignature.ts'

export type MemberMoveDirection = 'up' | 'down'

/** 对话框标题（zh 值来自 `localization-zh.jar` 的同名键；EN 键在上游 `:129`/`:133`）。 */
export const MEMBER_MOVE_TITLES: Record<MemberMoveDirection, string> = {
  up: '向上拉取成员',
  down: '向下推送成员',
}

/** 成员表那一列「Keep abstract」的表头（`:262` keep.abstract.column.header 的 zh 值）。 */
export const KEEP_ABSTRACT_COLUMN = '保持抽象'

/** 勾选表面板标题：上移用 `:56` 的句式，下推用 `:261` 的面板标题 + `:264` 的「从 {0} 下推」抬头。 */
export function memberMovePanelTitle(direction: MemberMoveDirection, className: string): string {
  return direction === 'up' ? `将${className}的成员向上拉取至:` : `从${className}向下推送成员`
}

/** 花括号语言档（Python/Go 的类没有花括号成员块或没有继承，本仓这两档不做，见文件头）。 */
const BRACE_LANGUAGES: readonly string[] = ['java', 'kotlin', 'typescript', 'javascript', 'cpp', 'c']

export function supportsMemberMove(language: string): boolean {
  return BRACE_LANGUAGES.includes(language)
}

/** 一处类/接口声明。偏移是文档内 0 基字符偏移。 */
export interface MemberMoveClass {
  name: string
  /** `extends`/`:` 后面的第一个类型名（本仓只认这一条单继承边；`implements` 不算上移目标）。 */
  baseName: string | null
  /** 声明头起点（含 `class` 关键字前的修饰符行）。 */
  from: number
  /** 类体**左花括号**与**右花括号**的下标（含括号本身）。 */
  bodyFrom: number
  bodyTo: number
  abstract: boolean
  /** 是 `interface`（成员天生没有实现体）。 */
  isInterface: boolean
  /** 类体缩进（第一个成员行的前导空白；类体空时退回两格）。 */
  indent: string
}

const CLASS_HEAD = /(^|\n)[ \t]*((?:(?:public|private|protected|internal|final|abstract|sealed|open|static|data|export|declare)\s+)*)(class|interface)\s+([A-Za-z_$][\w$]*)/g

/** 找出文本里所有花括号语言的类/接口声明（跳过字符串与注释里的 `class` 字样）。 */
export function findMemberMoveClasses(text: string, language = 'java'): MemberMoveClass[] {
  if (!supportsMemberMove(language)) return []
  const classes: MemberMoveClass[] = []
  CLASS_HEAD.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CLASS_HEAD.exec(text)) !== null) {
    const keyword = match[3]!
    const headerFrom = match.index + match[1]!.length
    // 声明头到左花括号这一段里认 extends / （Kotlin 的）`: Base()`。
    const braceAt = text.indexOf('{', CLASS_HEAD.lastIndex - 1)
    if (braceAt < 0) break
    const between = text.slice(CLASS_HEAD.lastIndex, braceAt)
    // Java/Kotlin/TS 三种写法：`extends Base`、`implements Base`、Kotlin 的 `: Base()`。
    const base = /(?:\b(?:extends|implements)|:)\s*([A-Za-z_$][\w$]*)/.exec(between)
    const bodyTo = matchBrace(text, braceAt)
    if (bodyTo < 0) break
    const first = firstMemberIndent(text, braceAt, bodyTo)
    classes.push({
      name: match[4]!, baseName: keyword === 'interface' && !base ? null : (base?.[1] ?? null),
      from: headerFrom, bodyFrom: braceAt, bodyTo,
      abstract: /\babstract\b/.test(match[2] ?? ''), isInterface: keyword === 'interface',
      indent: first,
    })
    CLASS_HEAD.lastIndex = bodyTo
  }
  return classes
}

/** 类体里第一个成员行的前导空白 = 这个类的成员缩进（搬过去的新行按它对齐）。 */
function firstMemberIndent(text: string, bodyFrom: number, bodyTo: number): string {
  const body = text.slice(bodyFrom + 1, bodyTo)
  const line = body.split('\n').find(entry => entry.trim().length > 0)
  if (line === undefined) return '  '
  const leading = /^[ \t]*/.exec(line)![0]
  // 只有一行的类体（`{ x(); }`）拿不到缩进 —— 退回两格（与 `src/unwrap.ts` 的默认档一致）。
  return /^[\{\}]/.test(line.trim()) ? '  ' : leading
}

export type MemberKind = 'method' | 'field'

/** 勾选表里的一行（上游 `MemberInfo`：成员 + 它的复选位）。 */
export interface ClassMember {
  name: string
  kind: MemberKind
  /** 声明本身带不带 `abstract`（或 interface 里没有实现体的方法）。 */
  abstract: boolean
  static: boolean
  /** 整段声明在文档里的区间（含结尾的 `;` 或方法体的 `}`）。 */
  from: number
  to: number
  text: string
  /** 勾选位（对话框用；模型只读它）。 */
  selected: boolean
  /** 「保持抽象」位（`keep.abstract.column.header`）。 */
  keepAbstract: boolean
}

/**
 * 切出类体**顶层**的成员段。跳过字符串/注释；方法体与参数表用 `matchBrace`/`matchParen`
 * 整体跨过，所以嵌套花括号里的 `;` 不会被当成员分隔。
 *
 * 段尾的三种认法（文本层没有 PSI，只能按收尾符号认）：
 *   1. 深度 0 上的 `;`（字段、抽象/接口方法）；
 *   2. 深度 0 上的一对 `{…}`（带实现体的方法、嵌套类型、初始化块）；
 *   3. 深度 0 上的换行，且**上一行不是断行续写**（不以 `= , ( . && :` 等收尾）、
 *      **下一行也不是续写开头** —— 这一条是给 Kotlin/TS 这种可以省分号的语言用的。
 * 相邻声明写在同一行、或跨行断在别的位置时会被并成一段，这是文本层的已知边界。
 */
export function classMembers(text: string, cls: MemberMoveClass): ClassMember[] {
  const members: ClassMember[] = []
  let segStart = statementStart(text, cls.bodyFrom + 1, cls.bodyTo)
  let depth = 0
  let index = segStart
  while (index < cls.bodyTo) {
    const ch = text[index]!
    if (ch === '"' || ch === "'" || ch === '`') { index = skipString(text, index) + 1; continue }
    if (ch === '/' && (text[index + 1] === '/' || text[index + 1] === '*')) { index = statementStart(text, index, cls.bodyTo); continue }
    if (ch === '{') {
      const close = matchBrace(text, index)
      if (close < 0 || close >= cls.bodyTo) break
      pushMember(members, text, segStart, close + 1, cls)
      index = statementStart(text, close + 1, cls.bodyTo); segStart = index; depth = 0
      continue
    }
    if (ch === '(' || ch === '[') {
      const close = ch === '(' ? matchParen(text, index) : matchBracket(text, index, '[', ']')
      if (close < 0 || close >= cls.bodyTo) break
      index = close + 1
      continue
    }
    if (ch === ';') {
      pushMember(members, text, segStart, index + 1, cls)
      index = statementStart(text, index + 1, cls.bodyTo); segStart = index
      continue
    }
    if (ch === '\n' && depth === 0 && statementBreak(text, index, segStart, cls.bodyTo)) {
      pushMember(members, text, segStart, index, cls)
      index = statementStart(text, index, cls.bodyTo); segStart = index
      continue
    }
    index += 1
  }
  // 类体最后一条声明没有分号收尾（Kotlin/TS 的写法）时，段尾落在右花括号上。
  if (segStart < cls.bodyTo && text.slice(segStart, cls.bodyTo).trim())
    pushMember(members, text, segStart, cls.bodyTo, cls)
  return members
}

/** 换行处到底该不该断开这一段声明（见 `classMembers` 的第 3 条认法）。 */
function statementBreak(text: string, newline: number, segStart: number, limit: number): boolean {
  const before = text.slice(segStart, newline)
  if (!before.trim()) return false
  // 上一行以续写符号收尾（`=` `,` `(` `.` `&&` `:` `?` `+` 或注释开头）就别断。
  if (/[=,.(&|:?+\]*/]$/.test(before.trim())) return false
  const next = statementStart(text, newline + 1, limit)
  if (next >= limit) return true
  const ch = text[next]!
  // 下一行是修饰符/类型关键字开头才当作新声明；`)`/`}`/`;` 这类是尾巴。
  return !/[)};,.]/.test(ch)
}

function matchBracket(text: string, open: number, left: string, right: string): number {
  let depth = 0
  for (let i = open; i < text.length; ++i) {
    const ch = text[i]
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i); continue }
    if (ch === left) depth += 1
    else if (ch === right) { depth -= 1; if (depth === 0) return i }
  }
  return -1
}

/** 从 `from` 起跳过空白与注释，落到下一条声明的第一个非空字符。 */
function statementStart(text: string, from: number, limit: number): number {
  let i = from
  while (i < limit) {
    const ch = text[i]!
    if (ch === '/' && text[i + 1] === '/') { i += 2; while (i < limit && text[i] !== '\n') ++i; continue }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close < 0 ? limit : close + 2
      continue
    }
    if (/\s/.test(ch)) { ++i; continue }
    return i
  }
  return limit
}

/** 返回闭引号的下标（跳过转义）。 */
function skipString(text: string, open: number): number {
  const quote = text[open]
  let i = open + 1
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue }
    if (text[i] === quote) return i
    ++i
  }
  return text.length
}

/**
 * 把 `[start,end)` 这一段认成一条成员声明（解析不出名字就丢掉，不硬凑）。
 * 段范围会**往上吃掉紧邻的注释行**（上游搬成员时 JavaDoc 是跟着走的，
 * `RefactoringBundle.properties:263` 的 `push.down.javadoc.panel.title` 就是那一段）。
 */
function pushMember(out: ClassMember[], text: string, start: number, end: number, cls: MemberMoveClass): void {
  const declEnd = Math.min(text.length, text[end] === '\n' ? end + 1 : end)
  const from = declarationStart(text, text.lastIndexOf('\n', start - 1) + 1)
  const raw = text.slice(from, declEnd)
  const body = raw.trim()
  if (!body || /^[{};,]$/.test(body)) return
  const parenAt = topLevelIndex(body, '(')
  const kind: MemberKind = parenAt > 0 && !/^(?:if|for|while|switch|catch|return|do|else|throw|try)\b/.test(body) ? 'method' : 'field'
  let name = ''
  if (kind === 'method') {
    const words = /([A-Za-z_$][\w$]*)\s*$/.exec(body.slice(0, parenAt))
    name = words?.[1] ?? ''
    // 构造头 `constructor(...)`/`X(...)` 也是方法；`new X(...)` 不是。
    if (!name || name === 'new') return
  } else {
    const assign = firstAssign(body)
    const declPart = body.slice(0, assign < 0 ? body.length : assign).replace(/[;,]\s*$/, '')
    name = /([A-Za-z_$][\w$]*)\s*[;:]?\s*$/.exec(declPart)?.[1] ?? ''
    if (!name) return
  }
  out.push({
    name, kind,
    // 接口/abstract 档里「没有实现体的方法」就是抽象的（上游 MemberInfoModel 的 isAbstract 同口径）。
    abstract: cls.isInterface ? kind === 'method' && !/\{/.test(body) : /\babstract\b/i.test(body),
    static: /\bstatic\b/i.test(body),
    from, to: declEnd, text: raw, selected: false, keepAbstract: false,
  })
}

// 往上并掉紧邻的整行注释（`//`、`*`、`/*` 开头，或以块注释收尾符结尾的行）。
function declarationStart(text: string, lineStart: number): number {
  let start = lineStart
  for (;;) {
    if (start <= 0) break
    const previousEnd = start - 1 // 换行符
    const previousStart = text.lastIndexOf('\n', previousEnd - 1) + 1
    const line = text.slice(previousStart, previousEnd).trim()
    if (!line) break
    if (/^(?:\/\/|\*|\/\*)/.test(line) || /\*\/$/.test(line)) { start = previousStart; continue }
    break
  }
  return start
}

/** 第一个不在括号里、也不在字符串里的 `target` 的下标（先比对再改深度，否则永远找不到目标自己）。 */
function topLevelIndex(body: string, target: string): number {
  let depth = 0
  for (let i = 0; i < body.length; ++i) {
    const ch = body[i]
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(body, i); continue }
    if (ch === target && depth === 0) return i
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1
  }
  return -1
}

function firstAssign(body: string): number {
  const index = topLevelIndex(body, '=')
  return index < 0 ? -1 : index
}

/** 按名字取勾选表里选中的那些成员（找不到的名字进 `missing`，不静默丢）。 */
export function pickMembers(members: readonly ClassMember[], names: readonly string[]): { chosen: ClassMember[]; missing: string[] } {
  const chosen: ClassMember[] = []
  const missing: string[] = []
  for (const name of names) {
    const found = members.find(member => member.name === name)
    if (found) chosen.push(found)
    else missing.push(name)
  }
  return { chosen, missing }
}

/** 偏移区间 -> LSP 的行/列编辑（与 `src/refactorSignature.ts` 的 `editOf` 同口径）。 */
function editOf(text: string, from: number, to: number, replacement: string): LspTextEdit {
  const position = (offset: number) => {
    const clipped = Math.max(0, Math.min(text.length, offset))
    return {
      line: text.slice(0, clipped).split('\n').length - 1,
      character: clipped - (text.lastIndexOf('\n', clipped - 1) + 1),
    }
  }
  const start = position(from)
  const end = position(to)
  return { text: replacement, startLine: start.line, startChar: start.character, endLine: end.line, endChar: end.character }
}

/** 整段搬动时按目标类的成员缩进重排（正 delta 补空格、负 delta 削空格）。 */
export function reindentMember(source: string, from: string, to: string): string {
  const delta = to.length - from.length
  return source.replace(/\r\n/g, '\n').split('\n').map(line => {
    if (!line.trim()) return line
    if (delta > 0) return ' '.repeat(delta) + line
    if (delta < 0) return line.slice(Math.min(-delta, /^[ \t]*/.exec(line)![0].length))
    return line
  }).join('\n')
}

/** 「保持抽象」后的声明：方法体换成 `;`，并补上 `abstract` 关键字。 */
export function abstractStubOf(member: ClassMember, language: string): string | null {
  if (member.kind !== 'method') return null
  // 前面的注释行不进抽象声明（`declarationStart` 把它们并进了段范围）。
  const lines = member.text.split('\n')
  while (lines.length && /^\s*(?:\/\/|\/\*|\*)/.test(lines[0]!)) lines.shift()
  const body = lines.join('\n').trim().replace(/;$/, '')
  const braceAt = topLevelIndex(body, '{')
  const head = (braceAt < 0 ? body : body.slice(0, braceAt)).trim()
  if (!/\babstract\b/i.test(head)) {
    // Kotlin 没有 `abstract` 也能声明接口式抽象，但上游那一列只在抽象类里给；这里同样只在 java/kotlin/ts 补词。
    if (!['java', 'kotlin', 'typescript', 'javascript'].includes(language)) return null
    const keywordAt = /^(?:(?:public|private|protected|internal|static|final|override|open|suspend|async)\s+)*/.exec(head)![0]
    return `${keywordAt}abstract ${head.slice(keywordAt.length)};`
  }
  return `${head};`
}

export interface MemberMoveSide {
  path: string
  text: string
  /** 类名（上移时是子类的名字，下推时是基类的名字）。 */
  className: string
}

export interface MemberMoveRequest {
  direction: MemberMoveDirection
  language: string
  source: MemberMoveSide
  target: MemberMoveSide
  /** 勾选表里选中的成员名（次序按勾选表）。 */
  memberNames: readonly string[]
  /** 成员名 -> 要不要「保持抽象」（`keep.abstract.column.header`）。 */
  keepAbstract?: Record<string, boolean>
}

export interface MemberMoveResult {
  /** 目标文件插入 + 源文件删除（交给既有的 `renamePreviewOf` 冲突闸门与 `RefactorPreviewDialog`）。 */
  edits: LspFileEdits[]
  moved: string[]
  /** 目标类里已经有同名成员而没有搬的（上游同样拒绝产生重复声明）。 */
  skipped: string[]
  /** 勾了但在这个类里找不到的成员名。 */
  missing: string[]
  /** 一句也没有做成时的原因（用户看得懂的中文；空数组表示可以搬）。 */
  errors: string[]
  /** 目标类名（对话框抬头里那个 `{0}`）。 */
  targetName: string
}

/**
 * 算出一趟上移/下推的全部文本编辑。
 * 方向只决定「源/目标」谁被删谁被插：上移 = 子类删、父类插；下推 = 父类删、子类插。
 * 两个类可以在同一个文件里，也可以在不同文件里（不同文件时是两条 `LspFileEdits`）。
 */
export function memberMoveEdits(request: MemberMoveRequest): MemberMoveResult {
  const empty: MemberMoveResult = { edits: [], moved: [], skipped: [], missing: [], errors: [], targetName: request.target.className }
  const errors: string[] = []
  if (!request.memberNames.length) errors.push('没有勾选要搬动的成员。')
  const sourceClasses = findMemberMoveClasses(request.source.text, request.language)
  const targetClasses = request.target.path === request.source.path
    ? sourceClasses : findMemberMoveClasses(request.target.text, request.language)
  const source = sourceClasses.find(cls => cls.name === request.source.className)
  const target = targetClasses.find(cls => cls.name === request.target.className)
  if (!source) errors.push(`在 ${request.source.path} 里找不到类「${request.source.className}」的声明。`)
  if (!target) errors.push(`在 ${request.target.path} 里找不到类「${request.target.className}」的声明。`)
  if (source && target && source.name === target.name) errors.push('源类与目标类是同一个类。')
  if (source && request.direction === 'up' && !source.baseName) errors.push(`「${source.name}」没有父类，无法向上拉取成员。`)
  if (errors.length) return { ...empty, errors }

  const members = classMembers(request.source.text, source!)
  const { chosen, missing } = pickMembers(members, request.memberNames)
  if (!chosen.length) return { ...empty, missing, errors: ['没有可搬动的成员（勾选的名字在这个类里都不存在）。'] }

  const targetMembers = classMembers(request.target.text, target!)
  const already = new Set(targetMembers.map(member => `${member.kind}:${member.name}`))
  const moved: string[] = [], skipped: string[] = [], missingText: string[] = []
  const sourceEdits: LspTextEdit[] = []
  for (const member of chosen) {
    if (already.has(`${member.kind}:${member.name}`)) { skipped.push(member.name); continue }
    const keep = Boolean(request.keepAbstract?.[member.name])
    if (keep && !target!.abstract && !target!.isInterface)
      errors.push(`「${member.name}」要保留抽象声明，但「${target!.name}」不是抽象类。`)
    const stub = keep ? abstractStubOf(member, request.language) : null
    if (keep && !stub) errors.push(`「${member.name}」所在的「${request.language}」档没法生成抽象声明。`)
    moved.push(member.name)
    // 源类：整段删掉（连它那一行的换行），或按「保持抽象」那一列换成抽象声明。
    sourceEdits.push(editOf(request.source.text, member.from, member.to,
      keep ? `${target!.indent}${stub}\n` : ''))
    // 目标类：在类体右花括号前插一段，按目标类的成员缩进重排。
    missingText.push(reindentMember(member.text.replace(/[ \t]*\r?\n$/, ''), leadingIndent(member.text), target!.indent))
  }
  if (errors.length) return { ...empty, moved, skipped, missing, errors }

  // 按文件合并（同类里上移/下推时源与目标是同一个 path，一个文件只能有一条 LspFileEdits）。
  const before = request.target.text.slice(0, target!.bodyTo)
  const insertion = missingText.join('\n')
  const byPath = new Map<string, LspTextEdit[]>()
  const push = (path: string, edit: LspTextEdit) => byPath.set(path, [...(byPath.get(path) ?? []), edit])
  for (const edit of sourceEdits) push(request.source.path, edit)
  if (insertion) push(request.target.path,
    editOf(request.target.text, target!.bodyTo, target!.bodyTo, `${/\n$/.test(before) ? '' : '\n'}${insertion}\n`))
  const fileEdits: LspFileEdits[] = [...byPath].map(([path, textEdits]) => ({ path, textEdits: textEdits.sort(byPosition) }))
  return { edits: fileEdits, moved, skipped, missing, errors: [], targetName: target!.name }
}

function byPosition(left: LspTextEdit, right: LspTextEdit): number {
  return left.startLine - right.startLine || left.startChar - right.startChar
}

function leadingIndent(source: string): string {
  return /^[ \t]*/.exec(source)![0]
}

/**
 * 完成后的提示（本仓没有 IntelliJ 的 `RefactoringSupportProvider` 弹窗，只有一句状态栏文案）。
 * 上移与下推的措辞分开写，因为下推会真的删掉源类里的声明（`:266` push.down.will.delete.members 的顾虑）。
 */
export function memberMoveNotice(direction: MemberMoveDirection, className: string, targetName: string, result: MemberMoveResult): string {
  const verb = direction === 'up' ? '向上拉取' : '向下推送'
  const parts = [`已把 ${result.moved.length} 个成员从「${className}」${verb}到「${targetName}」。`]
  if (result.skipped.length) parts.push(`「${result.skipped.join('、')}」在目标类里已存在，没有搬。`)
  if (result.missing.length) parts.push(`没找到「${result.missing.join('、')}」。`)
  return parts.join('')
}
