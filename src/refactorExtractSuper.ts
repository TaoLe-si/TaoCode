// 提取超类 / 提取接口（Extract Superclass / Extract Interface）的**文本层**模型 ——
// lp/refactoring 里 `refactoring/actions/ExtractInterfaceAction` 与 `ExtractSuperclassAction`
// 那一族在本仓的等价物（`src/menus/refactorMenu.ts:103` 的注释曾声称本仓已有落点，
// 但磁盘上没有：只有成员上移/下移会写父类，没有「新建一个声明文件并把成员搬进去」这一条）。
//
// 上游依据（逐条核过本机上游树）：
//   · 动作 id：`platform/platform-impl/resources/idea/LangActions.xml:377-382`
//     （`ExtractClassAction` / `ExtractInterfaceAction` / `ExtractSuperclassAction` /
//      `ExtractModuleAction`，在 IntroduceActionsGroup 子菜单里；`:380` = `ExtractInterface`，
//      `:381` = `ExtractSuperclass`）。两条都**没有**默认键位（`$default.xml` 里按 id 搜不到）。
//   · 对话框基类：`platform/lang-impl/src/com/intellij/refactoring/extractSuperclass/ExtractSuperBaseDialog.java`
//     —— `:59-70` 那几格是「源类 / 新超类名 / 目标包 / JavaDoc 策略 / 提取超类还是子类」，
//     其中 `:63` `myRbExtractSuperclass` / `:64` `myRbExtractSubclass` 是二选一（本仓只做
//     「提取超类」这一支，提取子类不做 —— 见文件末的「不做」）。
//   · 处理器：`java/java-impl-refactorings/src/com/intellij/refactoring/extractSuperclass/ExtractSuperBaseProcessor.java`
//     `:117-125` 的 `performRefactoring`：源类**改名**成新名字、把原名留给新抽出的超类
//     （`myClass.setName(myNewClassName)` 后 `extractSuper(superClassName)` 用**旧名**建超类）；
//     `:113` 找用法决定要不要「把引用改成超类」（`TurnRefsToSuperProcessor`，需要 PSI 搜索）。
//   · 新文件：`java/java-impl-refactorings/src/com/intellij/refactoring/extractSuperclass/ExtractSuperClassUtil.java`
//     的 `extractSuperClass`（在目标包下建一个含新超类声明的新文件）。
//   · 成员选择表：`PullUpDialog.java:111-114` 与 `PushDownDialog.java:31-34` 用的是同一张
//     `MemberSelectionPanel` ⇒ 本仓复用 `src/refactorMemberMove.ts` 的 `classMembers()`/`pickMembers()`，
//     不另起一套成员解析。
//
// **本仓用什么承接了上游的什么**（架构不等价 ⇒ 用本仓架构还原用户可见功能）：
//   · 上游用 PSI 建新 `PsiClass` 并改写引用 → 本仓用**文本层**：算出「新建声明文件的内容」
//     + 「源类改成继承新超类」+ 「从源类体里删掉被抽走的成员段」三条编辑，落盘走既有
//     `applyEditsToFiles`（`file.write` 能建新文件，见 native/workspace.cpp 的 `write`）。
//   · 源类改名那一半**本仓不做**：上游把源类改名再让新超类占原名，那要跨文件符号搜索
//     （`ReferencesSearch`）；本仓只做「原类保持原名 + 继承新超类」，用户可见差别如实写在下面。
//
// **没有 PSI 就拿不到的那部分**（不做，也不放假控件）：
//   · 跨文件引用改写（`TurnRefsToSuperProcessor`：把 `new Child()` 的声明类型改成超类）；
//   · 源类改名（见上）；
//   · 「提取子类」（`ExtractSubclassAction`）与「提取类/模块」（`ExtractClassAction`/`ExtractModuleAction`）；
//   · 继承/实现的精确解析（本仓按 `extends`/`implements` 的文本名字认，不查真实继承链）。
import type { LspFileEdits, LspTextEdit } from './bridge.ts'
import { classMembers, findMemberMoveClasses, pickMembers, reindentMember, type ClassMember, type MemberMoveClass } from './refactorMemberMove.ts'

export type ExtractSuperKind = 'superclass' | 'interface'

/** 对话框标题（zh 取安装目录 `localization-zh.jar` 的 `messages/RefactoringBundle.properties`
 *  `extract.superclass.title` / `extract.interface.title`；EN 键在 `RefactoringBundle.properties:115/:120`）。 */
export const EXTRACT_SUPER_TITLES: Record<ExtractSuperKind, string> = {
  superclass: '提取超类',
  interface: '提取接口',
}

/** 新声明文件里那个类/接口的关键字（`ExtractSuperClassUtil` 建的是 class，接口那一支是 interface）。 */
export const EXTRACT_SUPER_KEYWORD: Record<ExtractSuperKind, string> = {
  superclass: 'class',
  interface: 'interface',
}

/**
 * 本仓支持提取超类/接口的语言档：花括号语言里，本仓**能算成员段**的（与
 * `src/refactorMemberMove.ts` 的 `supportsMemberMove` 同一档）。
 * Python/Go 没有可切分的类体花括号，本仓不做（上游有 `PyExtractSuperclassHelper`，本仓没有等价解析）。
 */
export const EXTRACT_SUPER_LANGUAGES: readonly string[] = ['java', 'kotlin', 'typescript', 'javascript', 'cpp', 'c']

export function supportsExtractSuper(language: string): boolean {
  return EXTRACT_SUPER_LANGUAGES.includes(language)
}

/** 一个被抽出的成员在源类里的声明段（`classMembers()` 的产出，这里只留算编辑要的那几格）。 */
export interface ExtractedMember {
  name: string
  /** 抽象化后的声明文本（接口/抽象超类里的方法体换成 `;`）。 */
  text: string
}

export interface ExtractSuperRequest {
  kind: ExtractSuperKind
  language: string
  /** 源类所在文件（工作区相对路径）。 */
  path: string
  /** 源类文件的全文。 */
  text: string
  /** 源类的类名（用户光标所在的那个类）。 */
  className: string
  /** 新超类/接口的名字。 */
  newName: string
  /** 新声明文件的路径（工作区相对）；与本仓 `Move` 一样由调用方给。 */
  newPath: string
  /** 勾选要抽出的成员名（`classMembers()` 里那些）。 */
  memberNames: readonly string[]
  /** 包名/命名空间（写进新文件的首行；空串不写）。 */
  packageName?: string
}

export interface ExtractSuperResult {
  edits: LspFileEdits[]
  /** 抽出的成员名（按源类里的顺序）。 */
  extracted: string[]
  /** 勾了但在这个类里找不到的成员名。 */
  missing: string[]
  /** 一句也没有做成时的原因（用户看得懂的中文；空数组表示可以）。 */
  errors: string[]
  /** 新声明文件里那个类/接口的完整文本（预览对话框与单测读它）。 */
  newFileText: string
}

/** 新声明文件的首行（有包名就写 `package x;`；Kotlin/TS 用同样的写法，差异如实记在注释里）。 */
function packageHeader(kind: ExtractSuperKind, language: string, packageName: string): string {
  if (!packageName) return ''
  if (language === 'kotlin') return `package ${packageName}\n\n`
  // Java/C/TS 都用 `package`/`namespace` 的文本形态；本仓不解析语言的模块系统，按最常见写法给。
  if (language === 'typescript' || language === 'javascript') return ''
  return `package ${packageName};\n\n`
}

/**
 * 把一条成员声明**抽象化**成超类/接口里的形态：
 *   · 接口：方法体换成 `;`（接口里的方法天生没有体）；字段保留（上游接口里的常量字段带 `public static final`，
 *     本仓不补修饰符 —— 那要语言档的代码风格，如实只做「体换成 `;`」）。
 *   · 超类：成员原样搬过去（本仓不做「保留抽象」那一列 —— 那是 Pull Up 的 `keep.abstract`，
 *     提取超类上游是按原样搬，见 `ExtractSuperClassUtil`）。
 */
function abstractMemberFor(kind: ExtractSuperKind, member: ClassMember): string {
  const source = member.text.replace(/[ \t]*\r?\n$/, '')
  if (kind === 'superclass') return source
  if (member.kind !== 'method') return source
  // 方法：截到第一个顶层 `{`，把体去掉接 `;`（没有体就已经是声明）。
  const braceAt = topLevelBrace(source)
  if (braceAt < 0) return source.replace(/;?\s*$/, ';')
  return `${source.slice(0, braceAt).trimEnd()};`
}

/** 顶层（不在括号/字符串里）第一个 `{` 的下标；找不到返回 -1。 */
function topLevelBrace(source: string): number {
  let depth = 0
  for (let i = 0; i < source.length; ++i) {
    const ch = source[i]!
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(source, i); continue }
    if (ch === '{') return depth === 0 ? i : depth
    if (ch === '(' || ch === '[') depth += 1
    else if (ch === ')' || ch === ']') depth -= 1
  }
  return -1
}

function skipString(source: string, open: number): number {
  const quote = source[open]
  let i = open + 1
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue }
    if (source[i] === quote) return i
    ++i
  }
  return source.length
}

/** 偏移 -> LSP 行/列（与 `src/refactorMemberMove.ts` 的 `editOf` 同口径）。 */
function positionOf(text: string, offset: number): { line: number; character: number } {
  const clipped = Math.max(0, Math.min(text.length, offset))
  return {
    line: text.slice(0, clipped).split('\n').length - 1,
    character: clipped - (text.lastIndexOf('\n', clipped - 1) + 1),
  }
}

function editOf(text: string, from: number, to: number, replacement: string): LspTextEdit {
  const start = positionOf(text, from)
  const end = positionOf(text, to)
  return { text: replacement, startLine: start.line, startChar: start.character, endLine: end.line, endChar: end.character }
}

/**
 * 源类声明头里插上 `extends NewName`（超类）/ `implements NewName`（接口）。
 * 认法按语言档：Java/C/TS 在类名后插 `extends`/`implements`；Kotlin 用 `: NewName()` 形态。
 * 返回替换区间与文本；找不到类名就返回 null（调用方报错）。
 */
function inheritEdit(kind: ExtractSuperKind, language: string, text: string, cls: MemberMoveClass, newName: string): LspTextEdit | null {
  const nameAt = text.indexOf(cls.name, cls.from)
  if (nameAt < 0) return null
  const afterName = nameAt + cls.name.length
  // Kotlin：`: Base()` 形态（接口用 `: NewName`，超类用 `: NewName()`）。
  if (language === 'kotlin') {
    const paren = kind === 'superclass' ? `${newName}()` : newName
    // 已有 `:` 就补在后面（`class X : A` → `class X : A, New`），否则插 `: New`。
    const between = text.slice(afterName, cls.bodyFrom)
    const colon = between.indexOf(':')
    if (colon >= 0) {
      const insertAt = afterName + colon + 1
      return editOf(text, insertAt, insertAt, ` ${paren},`)
    }
    return editOf(text, afterName, afterName, ` : ${paren}`)
  }
  // Java/C/TS：`class X extends A implements B`。超类插 `extends`，接口插 `implements`。
  const between = text.slice(afterName, cls.bodyFrom)
  const keyword = kind === 'superclass' ? 'extends' : 'implements'
  const hasExtends = /\bextends\b/.test(between)
  const hasImplements = /\bimplements\b/.test(between)
  if (kind === 'superclass') {
    // 已有 extends：把新超类排在原超类**之前**（新超类是被原超类继承的那一层，本仓不重排继承链，
    // 只把新名字插进 extends 列表首位 —— 与「原类继承新超类」的语义一致）。
    if (hasExtends) {
      const at = afterName + between.indexOf('extends') + 'extends'.length
      return editOf(text, at, at, ` ${newName},`)
    }
    if (hasImplements) {
      const at = afterName + between.indexOf('implements')
      return editOf(text, at, at, `extends ${newName} `)
    }
    return editOf(text, afterName, afterName, ` extends ${newName}`)
  }
  // 接口：已有 implements 就追加，否则在类名后插（有 extends 时排在 extends 子句之后）。
  if (hasImplements) {
    const at = afterName + between.indexOf('implements') + 'implements'.length
    return editOf(text, at, at, ` ${newName},`)
  }
  const anchor = hasExtends ? afterName + extendsClauseEnd(between) : afterName
  return editOf(text, anchor, anchor, `${hasExtends ? ' ' : ' '}implements ${newName}`)
}

/** `extends` 子句的结束偏移（相对 `between` 起点）：到 `implements`/`{` 之前，去掉尾空白。 */
function extendsClauseEnd(between: string): number {
  const implementsAt = between.indexOf('implements')
  const end = implementsAt >= 0 ? implementsAt : between.length
  return end - (between.slice(0, end).length - between.slice(0, end).trimEnd().length)
}

/** 从类体里删掉被抽出的成员段（保留其余成员与缩进）。 */
function removalEdits(text: string, cls: MemberMoveClass, chosen: readonly ClassMember[]): LspTextEdit[] {
  // 逐段删除：段区间已在 `classMembers()` 里算好（含结尾换行）。
  return chosen.map(member => editOf(text, member.from, member.to, ''))
}

/**
 * 算出一趟「提取超类 / 提取接口」的全部文本编辑：
 *   ① 新建声明文件（`newPath`）—— 内含新超类/接口与抽出的成员；
 *   ② 源类声明头插上 `extends`/`implements`；
 *   ③ 源类体里删掉被抽出的成员段。
 * 三条都落在同一份 `LspFileEdits` 列表里（新文件那条的 `textEdits` 是「从空文件插入全文」，
 * 与 `file.write` 建新文件同形）。
 */
export function extractSuperEdits(request: ExtractSuperRequest): ExtractSuperResult {
  const empty: ExtractSuperResult = { edits: [], extracted: [], missing: [], errors: [], newFileText: '' }
  const errors: string[] = []
  if (!supportsExtractSuper(request.language)) {
    errors.push(`「${request.language}」档没有花括号类成员的文本层解析，提取超类/接口不做。`)
    return { ...empty, errors }
  }
  const newName = request.newName.trim()
  if (!newName) errors.push('新超类/接口名不能为空。')
  else if (!/^[A-Za-z_$][\w$]*$/.test(newName)) errors.push(`「${newName}」不是合法的类型名。`)
  if (!request.newPath.trim()) errors.push('新声明文件路径不能为空。')
  if (request.newPath === request.path) errors.push('新声明文件不能与源文件是同一个路径。')
  if (!request.memberNames.length) errors.push('没有勾选要抽出的成员。')
  if (errors.length) return { ...empty, errors }

  const classes = findMemberMoveClasses(request.text, request.language)
  const cls = classes.find(candidate => candidate.name === request.className)
  if (!cls) return { ...empty, errors: [`在 ${request.path} 里找不到类「${request.className}」的声明。`] }

  const members = classMembers(request.text, cls)
  const { chosen, missing } = pickMembers(members, request.memberNames)
  if (!chosen.length) return { ...empty, missing, errors: ['没有可抽出的成员（勾选的名字在这个类里都不存在）。'] }

  // 新文件正文：包名 + 声明头 + 逐条成员（按源类的缩进重排，两格）。
  const indent = '  '
  const body = chosen.map(member => {
    const abstracted = abstractMemberFor(request.kind, member)
    return reindentMember(abstracted, leadingIndent(member.text), indent)
  }).join('\n\n')
  const keyword = EXTRACT_SUPER_KEYWORD[request.kind]
  const newFileText = `${packageHeader(request.kind, request.language, request.packageName ?? '')}`
    + `${keyword} ${newName} {\n${body ? `${body}\n` : ''}}\n`

  const inherit = inheritEdit(request.kind, request.language, request.text, cls, newName)
  if (!inherit) return { ...empty, missing, errors: [`认不出「${request.className}」的类名位置，无法加继承子句。`] }

  const sourceEdits = [...removalEdits(request.text, cls, chosen), inherit]
    .sort((left, right) => left.startLine - right.startLine || left.startChar - right.startChar)
  const edits: LspFileEdits[] = [
    { path: request.path, textEdits: sourceEdits },
    { path: request.newPath, textEdits: [{ text: newFileText, startLine: 0, startChar: 0, endLine: 0, endChar: 0 }] },
  ]
  return { edits, extracted: chosen.map(member => member.name), missing, errors: [], newFileText }
}

function leadingIndent(source: string): string {
  return /^[ \t]*/.exec(source)![0]
}

/**
 * 完成后的提示（本仓没有 `RefactoringSupportProvider` 弹窗，只有一句状态栏文案）。
 * 与成员上移的 `memberMoveNotice` 分开写：这里多出「新文件建在哪」这件事。
 */
export function extractSuperNotice(kind: ExtractSuperKind, className: string, newName: string, newPath: string, result: ExtractSuperResult): string {
  const parts = [`已从「${className}」抽出 ${result.extracted.length} 个成员到新${kind === 'interface' ? '接口' : '超类'}「${newName}」（${newPath}）。`]
  if (result.missing.length) parts.push(`没找到「${result.missing.join('、')}」。`)
  return parts.join('')
}

/**
 * 新声明文件的默认路径：与源文件同目录、文件名 = 新名字 + 源文件的扩展名
 * （上游把新文件建在「目标包」目录下，默认就是源类所在目录，见 `ExtractSuperBaseDialog` 的
 *  `myTargetDirectory` 初值）。
 */
export function defaultNewPath(sourcePath: string, newName: string): string {
  const slash = sourcePath.lastIndexOf('/')
  const dir = slash < 0 ? '' : sourcePath.slice(0, slash + 1)
  const file = slash < 0 ? sourcePath : sourcePath.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  const extension = dot < 0 ? '' : file.slice(dot)
  return `${dir}${newName}${extension}`
}