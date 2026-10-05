// 引入形参对象（Introduce Parameter Object）的**文本层**模型。
//
// 上游依据（逐条核过本机上游树）：
//   · 菜单条目：`platform/platform-impl/resources/idea/LangActions.xml:372`（`IntroduceParameterObject`，
//     在 `IntroduceActionsGroup` 里，位于 `IntroduceParameter`(:368) 之后、`ExtractMethod`(:373) 之前）。
//   · 平台侧处理器/对话框：`platform/lang-impl/src/com/intellij/refactoring/introduceParameterObject/`
//     （`IntroduceParameterObjectProcessor.java` / `AbstractIntroduceParameterObjectDialog.java` /
//     `IntroduceParameterObjectClassDescriptor.java` / `IntroduceParameterObjectDelegate.java`）；
//     Java 侧表单 `java/java-impl-refactorings/src/com/intellij/refactoring/introduceparameterobject/`
//     （`IntroduceParameterObjectDialog.java` / `ParameterObjectBuilder.java`）。
//   · 对话框**字段次序**（本仓照抄）：`AbstractIntroduceParameterObjectDialog.java:66-105` 的三行网格 ——
//     第 0 行「Method to extract parameters from」（`RefactoringBundle.properties:398`）面板里是源方法那一栏
//     （`:396`）与「Keep method as delegate」复选框（`:482`）；第 1 行「Introduce parameter class」
//     （`border.title.introduce.parameter.class`，zh = 形参类）；第 2 行「Parameters to extract」
//     （`border.title.introduce.parameters.to.extract`，zh = 要提取的形参）。
//   · 标题：`:399` `refactoring.introduce.parameter.object.title`（zh 包 = 引入形参对象）。
//   · 用法清单：`:395` `…references.to.be.modified`（zh = 要修改的引用）→ 本仓交给 `src/refactorPreview.ts`
//     那棵预览树，不另画一套。
//   · 撤销栈那一行：`:397` `…command.name=Introduced parameter class {0} for {1}()`。
//   · 键位：上游 `IntroduceParameterObject` 在 `platform/platform-resources/src/keymaps/$default.xml`
//     里**没有**默认键位（按 id 搜过键位表），本仓不替它编一个。
//
// **本仓用什么承接了上游的什么**（架构不等价 ⇒ 用本仓架构还原用户可见功能）：
//   · 上游 `PsiMethod` 形参表 → `src/refactorSignature.ts` 的 `parseSignature()`（与「更改签名」同一份解析）。
//   · 上游 `ParameterObjectBuilder` 造 PSI 类 → 本仓按语言档**生成一段声明文本**（`PARAMETER_OBJECT_TEMPLATES`），
//     插在源声明那一行之前；字段名/类型都从原形参表带走。
//   · 上游把方法体里的 `param` 用法改成 `obj.param` → 本仓在方法体区间内按词边界替换，
//     并用 `src/nonCodeUsages.ts` 的 `nonCodeRanges()` 跳过字符串/注释里的那些出现。
//   · 上游调用点改写 → 本仓 `findCallSites()`（文本扫描，注释里的同名调用不改）。
//   · 「使方法保持为委托」需要**重载**（旧签名与新签名共存）⇒ 只有 java/kotlin 这一档成立；
//     TS/JS/Python/Go/C 没有同名重载，所以那边**不给这个复选框**（`supportsDelegate()`），
//     而不是画一个点了没反应的框。
//   · 只有 **typescript / java / kotlin / python** 四档有声明模板：Go/C/C++ 没有对象字面量
//     或没有可文本生成的构造语法，javascript 的形参表不带类型 ⇒ 直接报错不做（见 `parameterObjectEdits`）。
import {
  findCallSites, matchParen, parseSignature, renderParam,
  type ParsedSignature, type SignatureFileText, type SignatureParam,
} from './refactorSignature.ts'
import { matchBrace } from './unwrap.ts'
import { nonCodeRanges } from './nonCodeUsages.ts'
import { validateRenameName } from './refactorPreview.ts'
import type { LspFileEdits, LspTextEdit } from './bridge.ts'

/** 对话框标题（zh 值取 `localization-zh.jar` 的 `refactoring.introduce.parameter.object.title`）。 */
export const PARAMETER_OBJECT_TITLE = '引入形参对象'
/** 三块面板的标题，次序照 `AbstractIntroduceParameterObjectDialog.java:66-105` 的第 0/1/2 行。 */
export const PARAMETER_OBJECT_PANELS = ['要提取形参的方法', '形参类', '要提取的形参'] as const
/** 复选框文案（`:482` keep.method.as.delegate 的 zh 值，助记符按本仓惯例去掉）。 */
export const KEEP_AS_DELEGATE_LABEL = '使方法保持为委托'
/** 用法清单的分组标题（`:395` references.to.be.modified 的 zh 值）。 */
export const REFERENCES_TO_MODIFY_LABEL = '要修改的引用'

/** 有声明模板的语言档（其余语言档报错不做，见文件头）。 */
export const PARAMETER_OBJECT_LANGUAGES = ['typescript', 'java', 'kotlin', 'python'] as const

/** 「使方法保持为委托」只在有重载的语言档上给（上游那一条复选框也只在 Java/Groovy 表单里出现）。 */
export function supportsDelegate(language: string): boolean {
  return language === 'java' || language === 'kotlin'
}

/** 撤销栈里那一行的文案（`:397` 的 `{0}` = 新类名、`{1}` = 方法名）。 */
export function parameterObjectCommandName(className: string, methodName: string): string {
  return `为 ${methodName}() 引入了形参类 ${className}`
}

/** 形参类的一个字段（名字 + 类型文本 + 默认值）。 */
export interface ParameterObjectField { name: string; type: string; defaultValue: string }

function fieldsOf(params: readonly SignatureParam[]): ParameterObjectField[] {
  return params.map(param => ({ name: param.name, type: param.type, defaultValue: param.defaultValue }))
}

/** 形参没写类型时按默认值猜一个（`true`→boolean、`3`→number、`"x"`→string；猜不到就 unknown，不编一个假类型）。 */
function typeFromDefault(defaultValue: string): string {
  const value = defaultValue.trim()
  if (/^(?:true|false)$/i.test(value)) return 'boolean'
  if (/^-?\d/.test(value)) return 'number'
  if (/^['"`]/.test(value)) return 'string'
  return 'unknown'
}

/** 各语言档的形参类声明（本仓只生成「数据载体」，不生成 getter/setter —— 那要 PSI 与命名规范）。 */
const PARAMETER_OBJECT_TEMPLATES: Record<string, (className: string, fields: readonly ParameterObjectField[]) => string> = {
  typescript: (name, fields) => `interface ${name} {\n${fields
    .map(field => `  ${field.name}: ${field.type || typeFromDefault(field.defaultValue)}`)
    .join('\n')}\n}`,
  java: (name, fields) => `class ${name} {\n${fields
    .map(field => `  ${field.type || 'Object'} ${field.name};`)
    .join('\n')}\n\n  ${name}(${fields.map(field => `${field.type || 'Object'} ${field.name}`).join(', ')}) {\n${fields
    .map(field => `    this.${field.name} = ${field.name};`)
    .join('\n')}\n  }\n}`,
  kotlin: (name, fields) => `data class ${name}(\n${fields
    .map(field => `  val ${field.name}: ${field.type || 'Any?'}`)
    .join(',\n')}\n)`,
  python: (name, fields) => `class ${name}:\n    def __init__(self, ${fields
    .map(field => `${field.name}${field.defaultValue ? ` = ${field.defaultValue}` : ' = None'}`)
    .join(', ')}):\n${fields
    .map(field => `        self.${field.name} = ${field.name}`)
    .join('\n')}`,
}

export interface ParameterObjectRequest {
  path: string
  text: string
  /** 由 `parseSignature()` 解析的那一条声明（对话框打开时解析一次，之后一路用它）。 */
  parsed: ParsedSignature
  className: string
  /** 勾选表里选中的形参名（次序按勾选表）。 */
  paramNames: readonly string[]
  /** 「使方法保持为委托」（`:482`）。 */
  keepAsDelegate: boolean
  /** 调用点扫描范围（与「更改签名」同一份：打开的缓冲 + 工作区源文件）。 */
  files: readonly SignatureFileText[]
}

export interface ParameterObjectResult {
  edits: LspFileEdits[]
  /** 新生成的形参类声明文本（预览区与撤销栈那一行都读它）。 */
  classDeclaration: string
  /** 被抽进对象里的形参。 */
  wrapped: string[]
  /** 留在参数表里的形参。 */
  kept: string[]
  /** 改写了几处调用点（不含声明处）。 */
  callSites: number
  errors: string[]
}

/** 一条声明的方法体区间；抽象/接口声明没有体时返回 null。 */
function bodyRange(text: string, parsed: ParsedSignature): { from: number; to: number } | null {
  // Python 的方法体是缩进块，没有花括号 —— 按「比声明行更缩进的连续行」取。
  if (parsed.language === 'python') return pythonBodyRange(text, parsed)
  const argsEnd = matchParen(text, parsed.argsFrom)
  if (argsEnd < 0) return null
  const open = text.indexOf('{', argsEnd)
  if (open < 0) return null
  const close = matchBrace(text, open)
  if (close < 0) return null
  return { from: open, to: close }
}

/** Python：从声明行末尾往后，凡是更缩进的行都算体（含空行），遇到退回同缩进就停。 */
function pythonBodyRange(text: string, parsed: ParsedSignature): { from: number; to: number } | null {
  const lineEnd = text.indexOf('\n', parsed.argsTo)
  if (lineEnd < 0) return null
  const declLineStart = text.lastIndexOf('\n', parsed.headerFrom - 1) + 1
  const declIndent = /^[ \t]*/.exec(text.slice(declLineStart))![0].length
  let cursor = lineEnd + 1
  let last = lineEnd + 1
  let sawBody = false
  while (cursor < text.length) {
    const next = text.indexOf('\n', cursor)
    const end = next < 0 ? text.length : next
    const line = text.slice(cursor, end)
    if (line.trim()) {
      const indent = /^[ \t]*/.exec(line)![0].length
      if (indent <= declIndent) break
      sawBody = true
      last = end
    }
    if (next < 0) break
    cursor = next + 1
  }
  return sawBody ? { from: lineEnd + 1, to: last } : null
}

/** 偏移区间 -> LSP 行/列编辑（与 `src/refactorSignature.ts` 的 `editOf` 同口径）。 */
function editOf(text: string, from: number, to: number, replacement: string): LspTextEdit {
  const position = (offset: number) => ({
    line: text.slice(0, offset).split('\n').length - 1,
    character: offset - (text.lastIndexOf('\n', offset - 1) + 1),
  })
  const start = position(from)
  const end = position(to)
  return { text: replacement, startLine: start.line, startChar: start.character, endLine: end.line, endChar: end.character }
}

function byPosition(left: LspTextEdit, right: LspTextEdit): number {
  return left.startLine - right.startLine || left.startChar - right.startChar
}

/** 词边界查找（`_` 与 `$` 也算词字符），只在 `[from, to)` 里找；找不到返回 -1。 */
export function indexOfWord(text: string, word: string, from: number, to: number): number {
  let index = from
  for (;;) {
    const at = text.indexOf(word, index)
    if (at < 0 || at >= to) return -1
    const before = text[at - 1] ?? '\n'
    const after = text[at + word.length] ?? '\n'
    if (!/[\w$]/.test(before) && !/[\w$]/.test(after)) return at
    index = at + word.length
  }
}

function inside(ranges: readonly { from: number; to: number }[], at: number): boolean {
  return ranges.some(range => at >= range.from && at < range.to)
}

/** 勾选表里那些形参（按勾选次序）；没勾的按原次序留下；勾了却不存在的进 `missing`。 */
export function splitWrappedParams(parsed: ParsedSignature, paramNames: readonly string[]):
  { wrapped: SignatureParam[]; kept: SignatureParam[]; missing: string[] } {
  const wrapped: SignatureParam[] = []
  const missing: string[] = []
  for (const name of paramNames) {
    const found = parsed.params.find(param => param.name === name)
    if (found && !wrapped.includes(found)) wrapped.push(found)
    else if (!found) missing.push(name)
  }
  const chosen = new Set(wrapped.map(param => param.name))
  return { wrapped, kept: parsed.params.filter(param => !chosen.has(param.name)), missing }
}

/** 对象形参的名字：类名的小驼峰形（上游默认字段名的口径）。 */
export function objectNameFor(kept: readonly SignatureParam[], className: string): string {
  const candidate = className.charAt(0).toLowerCase() + className.slice(1)
  return kept.some(param => param.name === candidate) ? `${candidate}Object` : candidate
}

/** 新参数表文本：留下的形参原样 + 末尾追加对象形参。 */
export function parameterObjectParams(parsed: ParsedSignature, kept: readonly SignatureParam[], objectParam: SignatureParam): string {
  const parts = kept.map(param => renderParam(param, parsed.language))
  parts.push(renderParam(objectParam, parsed.language))
  return `(${parts.join(', ')})`
}

/** 调用点里那一段实参打包成「传进形参类」的形式。 */
export function wrapArguments(parsed: ParsedSignature, className: string, wrapped: readonly SignatureParam[],
  wrappedPositions: readonly number[], args: readonly string[]): string {
  const values = wrappedPositions.map(position => args[position] ?? '')
  const filled = values.map((value, index) => value.trim() ? value : (wrapped[index]!.defaultValue || wrapped[index]!.name))
  switch (parsed.language) {
    case 'java': return `new ${className}(${filled.join(', ')})`
    case 'kotlin': return `${className}(${wrapped.map((param, index) => `${param.name} = ${filled[index]}`).join(', ')})`
    case 'python': return `${className}(${wrapped.map((param, index) => `${param.name}=${filled[index]}`).join(', ')})`
    default: return `{${wrapped.map((param, index) => `${param.name}: ${filled[index]}`).join(', ')}}`
  }
}

/** 「使方法保持为委托」生成的那条旧签名声明（转调新签名；只有 java/kotlin 有重载才成立）。 */
function delegateDeclaration(text: string, parsed: ParsedSignature, body: { from: number; to: number },
  objectParam: SignatureParam, className: string): string {
  const indent = /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', parsed.headerFrom - 1) + 1))![0]
  const parts = parsed.params.map(param => renderParam(param, parsed.language))
  const argumentsText = objectLiteralFromParams(parsed, objectParam, className)
  const returns = parsed.returnType !== null && parsed.returnType !== '' && !/^(?:void|unit)$/i.test(parsed.returnType)
  // java 的返回类型在名字之前（`headerFrom..argsFrom` 这一刀正好把修饰符+返回类型+名字切齐）。
  const header = text.slice(parsed.headerFrom, parsed.argsFrom)
  const signature = parsed.language === 'java'
    ? `${header}(${parts.join(', ')})`
    : `${header}(${parts.join(', ')})${parsed.returnType ? `: ${parsed.returnType}` : ''}`
  return `${indent}${signature} {\n${indent}  ${returns ? 'return ' : ''}${parsed.name}(${argumentsText});\n${indent}}\n`
}

/** 委托声明里的对象实参：把旧形参名字直接喂给形参类的构造/字面量。 */
function objectLiteralFromParams(parsed: ParsedSignature, objectParam: SignatureParam, className: string): string {
  const wrapped: SignatureParam[] = parsed.params
  const positions = parsed.params.map((_, index) => index)
  const args = parsed.params.map(param => param.name)
  void objectParam
  return wrapArguments(parsed, className, wrapped, positions, args)
}

/** 形参类名/勾选本身的校验（上游对话框 `validateAndCommitData` 那一档）。 */
export function validateParameterObject(parsed: ParsedSignature, className: string, wrappedCount: number): string {
  if (wrappedCount === 0) return '没有勾选要抽进形参对象的形参。'
  if (wrappedCount === parsed.params.length && parsed.params.length < 2) return '至少要留一个形参在参数表里（只有一个形参时抽对象没有意义）。'
  const name = className.trim()
  const invalid = validateRenameName(name, parsed.language)
  if (invalid) return invalid
  if (parsed.params.some(param => param.name === name)) return `形参类名「${name}」与形参重名。`
  if (name === parsed.name) return `形参类名「${name}」与方法名重名。`
  return ''
}

/**
 * 算出「引入形参对象」的全部文本编辑。
 * ① 源声明那一行之前插入形参类声明；② 参数表换成「留下的形参 + 一个对象形参」；
 * ③ 方法体里对被抽走形参的引用换成 `对象名.形参`；④ 每个调用点的实参打包；
 * ⑤ 勾了「使方法保持为委托」时另发一条旧签名的转发声明。
 */
export function parameterObjectEdits(request: ParameterObjectRequest): ParameterObjectResult {
  const { parsed, text, path } = request
  const language = parsed.language
  const empty: ParameterObjectResult = {
    edits: [], classDeclaration: '', wrapped: [], kept: [], callSites: 0, errors: [],
  }
  const errors: string[] = []
  const { wrapped, kept, missing } = splitWrappedParams(parsed, request.paramNames)
  if (missing.length) errors.push(`这些形参不在「${parsed.name}」的参数表里：${missing.join('、')}。`)
  const invalid = validateParameterObject(parsed, request.className, wrapped.length)
  if (invalid) errors.push(invalid)
  if (!PARAMETER_OBJECT_LANGUAGES.includes(language as (typeof PARAMETER_OBJECT_LANGUAGES)[number]))
    errors.push(`「${language}」档没有形参类声明的生成规则，不做（不生成看不懂的代码）。`)
  if (request.keepAsDelegate && !supportsDelegate(language))
    errors.push(`「使方法保持为委托」需要方法重载，「${language}」档没有重载。`)
  if (errors.length) return { ...empty, wrapped: wrapped.map(p => p.name), kept: kept.map(p => p.name), errors }

  const className = request.className.trim()
  const classDeclaration = PARAMETER_OBJECT_TEMPLATES[language]!(className, fieldsOf(wrapped))
  const objectParam: SignatureParam = {
    name: objectNameFor(kept, className),
    type: language === 'python' ? '' : className,
    defaultValue: '', variadic: false, originalIndex: -1,
  }
  const argsText = parameterObjectParams(parsed, kept, objectParam)
  const body = bodyRange(text, parsed)

  const declaration: LspTextEdit[] = []
  // ① 类声明插在源声明那一行之前（连同那一行原本的缩进）。
  const lineStart = text.lastIndexOf('\n', parsed.headerFrom - 1) + 1
  const lineIndent = /^[ \t]*/.exec(text.slice(lineStart))![0]
  declaration.push(editOf(text, lineStart, lineStart, `${classDeclaration.split('\n')
    .map(line => `${lineIndent}${line}`).join('\n')}\n`))
  // ② 参数表整段换掉。
  declaration.push(editOf(text, parsed.argsFrom, parsed.argsTo + 1, argsText))
  // ③ 方法体里的引用换成 `对象名.形参`（跳过字符串/注释，跳过已经是成员访问的那一处）。
  if (body) {
    const nonCode = nonCodeRanges(text).filter(range => range.from >= body.from && range.to <= body.to)
    for (const param of wrapped) {
      let searchFrom = body.from
      for (;;) {
        const at = indexOfWord(text, param.name, searchFrom, body.to)
        if (at < 0) break
        searchFrom = at + param.name.length
        if (inside(nonCode, at)) continue
        // 前面是 `.` 的那一处是别人的成员（`other.name`），不是这个形参。
        if (text[at - 1] === '.') continue
        declaration.push(editOf(text, at, at + param.name.length, `${objectParam.name}.${param.name}`))
      }
    }
  }

  const byPath = new Map<string, LspTextEdit[]>()
  byPath.set(path, declaration.sort(byPosition))
  // ④ 调用点：声明自身那一处（同一个 argsFrom）不是调用点。
  const wrappedPositions = wrapped.map(param => parsed.params.indexOf(param))
  let callSites = 0
  for (const file of request.files) {
    const sites = findCallSites(file.path, file.text, parsed.name, file.nonCode ?? [])
    for (const site of sites) {
      if (file.path === path && site.argsFrom === parsed.argsFrom) continue
      const literal = wrapArguments(parsed, className, wrapped, wrappedPositions, site.args)
      const keptArgs = kept.map(param => site.args[parsed.params.indexOf(param)] ?? param.defaultValue)
      const nextArgs = [literal, ...keptArgs.filter(Boolean)]
      const edits = byPath.get(file.path) ?? []
      edits.push(editOf(file.text, site.argsFrom, site.argsTo + 1, `(${nextArgs.join(', ')})`))
      byPath.set(file.path, edits)
      callSites += 1
    }
  }
  // ⑤ 委托声明（旧签名转发到新签名）。
  if (request.keepAsDelegate && body) {
    const delegate = delegateDeclaration(text, parsed, body, objectParam, className)
    const edits = byPath.get(path)!
    edits.push(editOf(text, body.to + 1, body.to + 1, `\n${delegate}`))
  }
  return {
    edits: [...byPath].map(([targetPath, textEdits]) => ({ path: targetPath, textEdits: textEdits.sort(byPosition) })),
    classDeclaration, wrapped: wrapped.map(p => p.name), kept: kept.map(p => p.name), callSites, errors: [],
  }
}

/** 宿主对话框用的「按光标位置解析」入口（与「更改签名」共用同一份文本层解析）。 */
export function parseForParameterObject(text: string, offset: number, language: string): ParsedSignature | null {
  return parseSignature(text, offset, language)
}
